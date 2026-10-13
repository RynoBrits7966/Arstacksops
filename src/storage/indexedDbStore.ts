import { blankHierarchy } from "../backlog/model";
import { isColorTaken } from "../projects";
import type { Attachment, Comment, Project, Task, User, VoiceNote } from "../types";
import { normalizeTask } from "./snapshot";
import { latestWorkAt, shouldArchive, statusAfterMove } from "./archive";
import type { ProjectInput, TaskStore, UpdateTaskInput } from "./taskStore";

const DB_NAME = "arstacksops";
const DB_VERSION = 3;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("tasks")) {
        db.createObjectStore("tasks", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("comments")) {
        const comments = db.createObjectStore("comments", { keyPath: "id" });
        comments.createIndex("taskId", "taskId", { unique: false });
      }
      if (!db.objectStoreNames.contains("attachments")) {
        const attachments = db.createObjectStore("attachments", { keyPath: "id" });
        attachments.createIndex("taskId", "taskId", { unique: false });
      }
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("users")) {
        db.createObjectStore("users", { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("Reload the page to finish opening browser storage"));
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Could not open browser storage"));
    };
  });
  return dbPromise;
}

function sharedBoardOnly(): Promise<never> {
  return Promise.reject(new Error("Sign-off and deletion run on the shared board."));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

export const taskStore: TaskStore = {
  seedDemo,
  listUsers,
  listProjects,
  createProject,
  updateProject,
  deleteProject: sharedBoardOnly,
  signOffProject: sharedBoardOnly,
  reopenProject: sharedBoardOnly,
  listTasks,
  createTask,
  updateTask,
  acceptTask,
  escalateTask,
  markEscalationSeen,
  markArchiveVisited,
  listAllComments,
  listComments,
  addComment,
  markMentionsRead,
  listAttachments,
  addAttachment,
  deleteTask,
  archiveExpired,
};

function listTasks(): Promise<Task[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
        request.onsuccess = () => {
          const tasks = (request.result as Task[]).map((task, index) => {
            const normalized = normalizeTask(
              {
                ...task,
                projectId: task.projectId ?? "",
                assigneeId: task.assigneeId ?? "",
                acceptedAt: task.acceptedAt ?? null,
                escalatedToId: task.escalatedToId ?? null,
                escalationSeenAt: task.escalationSeenAt ?? null,
                lastWorkedAt: task.lastWorkedAt ?? task.updatedAt,
              },
              index,
            ).task;
            return normalized;
          });
          tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          resolve(tasks);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

function listProjects(): Promise<Project[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction("projects", "readonly").objectStore("projects").getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as Project[]).map((project) => ({
              ...project,
              client: project.client ?? "",
            })),
          );
        request.onerror = () => reject(request.error);
      }),
  );
}

function createProject(input: ProjectInput): Promise<Project> {
  let project: Project;
  try {
    project = {
      id: crypto.randomUUID(),
      ...projectFields(input),
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    return Promise.reject(error);
  }
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const store = db.transaction("projects", "readwrite").objectStore("projects");
        const existing = store.getAll();
        existing.onerror = () => reject(existing.error);
        existing.onsuccess = () => {
          if (isColorTaken((existing.result as Project[]).map((item) => item.color), project.color)) {
            reject(new Error("That colour is already used by another project"));
            return;
          }
          const request = store.put(project);
          request.onsuccess = () => resolve(project);
          request.onerror = () => reject(request.error);
        };
      }),
  );
}

function updateProject(id: string, patch: ProjectInput): Promise<Project> {
  let fields: ReturnType<typeof projectFields>;
  try {
    fields = projectFields(patch);
  } catch (error) {
    return Promise.reject(error);
  }
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        const store = tx.objectStore("projects");
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const current = request.result as Project | undefined;
          if (!current) {
            reject(new Error("Project not found"));
            return;
          }
          const others = store.getAll();
          others.onerror = () => reject(others.error);
          others.onsuccess = () => {
            const taken = (others.result as Project[])
              .filter((item) => item.id !== id)
              .map((item) => item.color);
            if (isColorTaken(taken, fields.color)) {
              reject(new Error("That colour is already used by another project"));
              return;
            }
            const next: Project = { ...current, ...fields };
            const putRequest = store.put(next);
            putRequest.onsuccess = () => resolve(next);
            putRequest.onerror = () => reject(putRequest.error);
          };
        };
      }),
  );
}

function clientName(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 80);
}

function projectFields(input: ProjectInput): Pick<Project, "name" | "color" | "client" | "deadline"> {
  const name = input.name.trim();
  const client = clientName(input.client);
  if (!name) throw new Error("Project name is required");
  if (!client) throw new Error("Client is required");
  if (!COLOR_PATTERN.test(input.color)) throw new Error("Choose a colour");
  if (input.deadline !== null && !DAY_PATTERN.test(input.deadline)) {
    throw new Error("Enter a deadline or choose N/A");
  }
  return { name, color: input.color.toLowerCase(), client, deadline: input.deadline };
}

function createTask(input: {
  title: string;
  description: string;
  projectId: string;
  assigneeId: string;
}): Promise<Task> {
  const title = input.title.trim();
  if (!title) return Promise.reject(new Error("Title is required"));
  if (!input.projectId) return Promise.reject(new Error("Choose a project"));
  if (!input.assigneeId) return Promise.reject(new Error("Tag a teammate"));
  const now = new Date().toISOString();
  const task: Task = {
    ...blankHierarchy(),
    id: crypto.randomUUID(),
    projectId: input.projectId,
    assigneeId: input.assigneeId,
    acceptedAt: null,
    escalatedToId: null,
    escalationSeenAt: null,
    title,
    description: input.description.trim(),
    status: "new",
    createdAt: now,
    updatedAt: now,
    lastWorkedAt: now,
    closedAt: null,
  };
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "projects", "users"], "readwrite");
        const projectRequest = tx.objectStore("projects").get(input.projectId);
        const userRequest = tx.objectStore("users").get(input.assigneeId);
        projectRequest.onerror = () => reject(projectRequest.error);
        userRequest.onerror = () => reject(userRequest.error);
        let projectOk = false;
        let userOk = false;
        const finish = () => {
          if (!projectOk || !userOk) return;
          const request = tx.objectStore("tasks").put(task);
          request.onsuccess = () => resolve(task);
          request.onerror = () => reject(request.error);
        };
        projectRequest.onsuccess = () => {
          if (!projectRequest.result) {
            reject(new Error("Choose a project"));
            return;
          }
          projectOk = true;
          finish();
        };
        userRequest.onsuccess = () => {
          if (!userRequest.result) {
            reject(new Error("Tag a teammate"));
            return;
          }
          userOk = true;
          finish();
        };
      }),
  );
}

function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "projects"], "readwrite");
        const store = tx.objectStore("tasks");
        const request = store.get(id);
        request.onerror = () => reject(request.error ?? new Error("Could not read task"));
        request.onsuccess = () => {
          const task = request.result as Task | undefined;
          if (!task) {
            reject(new Error("Task not found"));
            return;
          }
          if (patch.status && task.status === "archived") {
            reject(new Error("Archived tasks stay in Archive until you delete them"));
            return;
          }
          const title = patch.title !== undefined ? patch.title.trim() : task.title;
          if (!title) {
            reject(new Error("Title is required"));
            return;
          }
          const now = new Date();
          let status = task.status;
          let closedAt = task.closedAt;
          let escalatedToId = task.escalatedToId ?? null;
          let escalationSeenAt = task.escalationSeenAt ?? null;
          let lastWorkedAt = task.lastWorkedAt ?? task.updatedAt;
          if (patch.status && patch.status !== task.status) {
            if (patch.status === "escalated") {
              reject(new Error("Choose who to escalate this to"));
              return;
            }
            const moved = statusAfterMove(task.status, patch.status, task.closedAt, now);
            status = moved.status;
            closedAt = moved.closedAt;
            escalatedToId = null;
            escalationSeenAt = null;
            lastWorkedAt = now.toISOString();
          }
          const projectId = patch.projectId !== undefined ? patch.projectId : (task.projectId ?? "");
          const next: Task = {
            ...task,
            projectId,
            escalatedToId,
            escalationSeenAt,
            title,
            description:
              patch.description !== undefined ? patch.description.trim() : task.description,
            status,
            closedAt,
            updatedAt: now.toISOString(),
            lastWorkedAt,
          };
          const save = () => {
            const putRequest = store.put(next);
            putRequest.onsuccess = () => resolve(next);
            putRequest.onerror = () => reject(putRequest.error);
          };
          if (patch.projectId) {
            const projectRequest = tx.objectStore("projects").get(patch.projectId);
            projectRequest.onerror = () => reject(projectRequest.error);
            projectRequest.onsuccess = () => {
              if (!projectRequest.result) {
                reject(new Error("Choose a project"));
                return;
              }
              save();
            };
            return;
          }
          save();
        };
      }),
  );
}

function listAllComments(): Promise<Comment[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction("comments", "readonly").objectStore("comments").getAll();
        request.onsuccess = () =>
          resolve((request.result as Comment[]).map(normalizeComment));
        request.onerror = () => reject(request.error);
      }),
  );
}

function listComments(taskId: string): Promise<Comment[]> {
  return listByTaskId<Comment>("comments", taskId).then((comments) =>
    comments.map(normalizeComment).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

const MAX_VOICE_BYTES = 8 * 1024 * 1024;

function addComment(
  taskId: string,
  input: { body: string; authorId: string; mentionIds: string[]; voice: VoiceNote | null },
): Promise<Comment> {
  const text = input.body.trim();
  if (!text && !input.voice) return Promise.reject(new Error("Write a comment or record a voice note"));
  if (!input.authorId) return Promise.reject(new Error("Choose who is commenting"));
  if (input.voice && input.voice.blob.size > MAX_VOICE_BYTES) {
    return Promise.reject(new Error("Voice notes must be 8 MB or smaller"));
  }
  const comment: Comment = {
    id: crypto.randomUUID(),
    taskId,
    authorId: input.authorId,
    body: text,
    mentionIds: [...new Set(input.mentionIds)],
    readByIds: [input.authorId],
    voice: input.voice,
    createdAt: new Date().toISOString(),
  };
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "comments"], "readwrite");
        const taskRequest = tx.objectStore("tasks").get(taskId);
        taskRequest.onerror = () => reject(taskRequest.error);
        taskRequest.onsuccess = () => {
          const task = taskRequest.result as Task | undefined;
          if (!task) {
            reject(new Error("Task not found"));
            return;
          }
          tx.objectStore("tasks").put({
            ...task,
            updatedAt: comment.createdAt,
            lastWorkedAt: comment.createdAt,
          });
          const putRequest = tx.objectStore("comments").put(comment);
          putRequest.onsuccess = () => resolve(comment);
          putRequest.onerror = () => reject(putRequest.error);
        };
      }),
  );
}

function acceptTask(id: string, userId: string): Promise<Task> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("tasks", "readwrite");
        const store = tx.objectStore("tasks");
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const task = request.result as Task | undefined;
          if (!task) {
            reject(new Error("Task not found"));
            return;
          }
          if (task.status === "archived") {
            reject(new Error("Archived tasks stay in Archive until you delete them"));
            return;
          }
          if (task.assigneeId !== userId) {
            reject(new Error("Only the tagged teammate can accept"));
            return;
          }
          if (task.acceptedAt) {
            resolve({
              ...task,
              projectId: task.projectId ?? "",
              assigneeId: task.assigneeId ?? "",
              acceptedAt: task.acceptedAt,
            });
            return;
          }
          const now = new Date().toISOString();
          const next: Task = {
            ...task,
            projectId: task.projectId ?? "",
            assigneeId: task.assigneeId,
            status: "in_progress",
            acceptedAt: now,
            escalatedToId: null,
            escalationSeenAt: null,
            closedAt: null,
            updatedAt: now,
            lastWorkedAt: now,
          };
          const putRequest = store.put(next);
          putRequest.onsuccess = () => resolve(next);
          putRequest.onerror = () => reject(putRequest.error);
        };
      }),
  );
}

function escalateTask(id: string, userId: string): Promise<Task> {
  if (!userId) return Promise.reject(new Error("Choose who to escalate this to"));
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "users"], "readwrite");
        const store = tx.objectStore("tasks");
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const task = request.result as Task | undefined;
          if (!task) {
            reject(new Error("Task not found"));
            return;
          }
          if (task.status === "archived") {
            reject(new Error("Archived tasks stay in Archive until you delete them"));
            return;
          }
          const userRequest = tx.objectStore("users").get(userId);
          userRequest.onerror = () => reject(userRequest.error);
          userRequest.onsuccess = () => {
            if (!userRequest.result) {
              reject(new Error("Choose a teammate"));
              return;
            }
            const now = new Date();
            const moved = statusAfterMove(task.status, "escalated", task.closedAt, now);
            const next: Task = {
              ...task,
              status: moved.status,
              closedAt: moved.closedAt,
              escalatedToId: userId,
              escalationSeenAt: null,
              updatedAt: now.toISOString(),
              lastWorkedAt: now.toISOString(),
            };
            const putRequest = store.put(next);
            putRequest.onsuccess = () => resolve(next);
            putRequest.onerror = () => reject(putRequest.error);
          };
        };
      }),
  );
}

function markEscalationSeen(id: string, userId: string): Promise<boolean> {
  if (!userId) return Promise.resolve(false);
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("tasks", "readwrite");
        const store = tx.objectStore("tasks");
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const task = request.result as Task | undefined;
          if (!task || task.escalatedToId !== userId || task.escalationSeenAt) {
            resolve(false);
            return;
          }
          const putRequest = store.put({
            ...task,
            escalationSeenAt: new Date().toISOString(),
          });
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => reject(putRequest.error);
        };
      }),
  );
}

function markArchiveVisited(id: string, now = new Date()): Promise<boolean> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("tasks", "readwrite");
        const store = tx.objectStore("tasks");
        const request = store.get(id);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const task = request.result as Task | undefined;
          if (!task || task.status !== "archived" || !task.archivedAt) {
            resolve(false);
            return;
          }
          const due = new Date(task.archivedAt).getTime() + 3 * 24 * 60 * 60 * 1000;
          const visited = task.archiveVisitedAt ? new Date(task.archiveVisitedAt).getTime() : 0;
          if (now.getTime() < due || visited >= due) {
            resolve(false);
            return;
          }
          const putRequest = store.put({ ...task, archiveVisitedAt: now.toISOString() });
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => reject(putRequest.error);
        };
      }),
  );
}

function markMentionsRead(taskId: string, userId: string): Promise<boolean> {
  if (!userId) return Promise.resolve(false);
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("comments", "readwrite");
        const store = tx.objectStore("comments");
        const request = store.index("taskId").getAll(taskId);
        let changed = false;
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          for (const raw of request.result as Comment[]) {
            const comment = normalizeComment(raw);
            if (!comment.mentionIds.includes(userId) || comment.readByIds.includes(userId)) {
              continue;
            }
            changed = true;
            store.put({ ...comment, readByIds: [...comment.readByIds, userId] });
          }
        };
        tx.oncomplete = () => resolve(changed);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function listUsers(): Promise<User[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction("users", "readonly").objectStore("users").getAll();
        request.onsuccess = () => {
          const users = request.result as User[];
          users.sort((a, b) => a.name.localeCompare(b.name));
          resolve(users);
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

function seedDemo(): Promise<void> {
  return listProjects().then((projects) => {
    if (projects.length > 0) return;
    const createdAt = "2026-10-07T16:00:00.000Z";
    const updatedAt = "2026-10-08T16:30:00.000Z";
    const users: User[] = [
      { id: "user-alex", name: "Alex Morgan" },
      { id: "user-sam", name: "Sam Patel" },
      { id: "user-jordan", name: "Jordan Lee" },
    ];
    const demoProjects: Project[] = [
      {
        id: "project-billing",
        name: "Billing",
        color: "#3d7ea6",
        client: "Harbour & Co",
        deadline: "2026-10-20",
        createdAt,
      },
      {
        id: "project-field",
        name: "Field App",
        color: "#2f7d4a",
        client: "North Range",
        deadline: null,
        createdAt,
      },
    ];
    const tasks: Task[] = [
      {
        ...blankHierarchy(),
        id: "task-invoice",
        projectId: "project-billing",
        assigneeId: "user-sam",
        acceptedAt: null,
        escalatedToId: null,
        escalationSeenAt: null,
        title: "Invoice export fails for March",
        description: "The March batch stops halfway. Sam still needs to accept this ticket.",
        status: "new",
        createdAt: updatedAt,
        updatedAt,
        lastWorkedAt: updatedAt,
        closedAt: null,
      },
      {
        ...blankHierarchy(),
        id: "task-pins",
        projectId: "project-field",
        assigneeId: "user-alex",
        acceptedAt: createdAt,
        escalatedToId: null,
        escalationSeenAt: null,
        title: "Map pins drop offline",
        description: "Pins disappear after the device goes offline. Alex already accepted.",
        status: "in_progress",
        createdAt,
        updatedAt,
        lastWorkedAt: updatedAt,
        closedAt: null,
      },
    ];
    const comments: Comment[] = [
      {
        id: "comment-pins",
        taskId: "task-pins",
        authorId: "user-jordan",
        body: "@Alex Morgan the pins still vanish after a refresh.",
        mentionIds: ["user-alex"],
        readByIds: ["user-jordan"],
        voice: null,
        createdAt: updatedAt,
      },
    ];
    return openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(["users", "projects", "tasks", "comments"], "readwrite");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          for (const user of users) tx.objectStore("users").put(user);
          for (const project of demoProjects) tx.objectStore("projects").put(project);
          for (const task of tasks) tx.objectStore("tasks").put(task);
          for (const comment of comments) tx.objectStore("comments").put(comment);
        }),
    );
  });
}

function normalizeComment(comment: Comment): Comment {
  return {
    ...comment,
    authorId: comment.authorId ?? "",
    mentionIds: comment.mentionIds ?? [],
    readByIds: comment.readByIds ?? [],
    voice: comment.voice?.blob ? comment.voice : null,
  };
}

function listAttachments(taskId: string): Promise<Attachment[]> {
  return listByTaskId<Attachment>("attachments", taskId).then((items) =>
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );
}

function addAttachment(taskId: string, file: File): Promise<Attachment> {
  if (!isImageFile(file)) return Promise.reject(new Error("Choose an image file"));
  if (file.size > MAX_IMAGE_BYTES) {
    return Promise.reject(new Error("Screenshots must be 8 MB or smaller"));
  }
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    taskId,
    fileName: file.name || "screenshot",
    mimeType: file.type || "application/octet-stream",
    createdAt: new Date().toISOString(),
    blob: file,
  };
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "attachments"], "readwrite");
        const taskRequest = tx.objectStore("tasks").get(taskId);
        taskRequest.onerror = () => reject(taskRequest.error);
        taskRequest.onsuccess = () => {
          const task = taskRequest.result as Task | undefined;
          if (!task) {
            reject(new Error("Task not found"));
            return;
          }
          tx.objectStore("tasks").put({
            ...task,
            updatedAt: attachment.createdAt,
            lastWorkedAt: attachment.createdAt,
          });
          const putRequest = tx.objectStore("attachments").put(attachment);
          putRequest.onsuccess = () => resolve(attachment);
          putRequest.onerror = () => reject(putRequest.error);
        };
      }),
  );
}

function deleteTask(id: string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "comments", "attachments"], "readwrite");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore("tasks").delete(id);
        deleteRelated(tx.objectStore("comments"), id);
        deleteRelated(tx.objectStore("attachments"), id);
      }),
  );
}

function deleteRelated(store: IDBObjectStore, taskId: string): void {
  const request = store.index("taskId").getAllKeys(taskId);
  request.onsuccess = () => {
    for (const key of request.result) store.delete(key);
  };
}

function archiveExpired(now = new Date()): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["tasks", "comments"], "readwrite");
        const store = tx.objectStore("tasks");
        const taskRequest = store.getAll();
        const commentRequest = tx.objectStore("comments").getAll();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        taskRequest.onerror = () => reject(taskRequest.error);
        commentRequest.onerror = () => reject(commentRequest.error);
        let taskRows: Task[] | null = null;
        let commentRows: Comment[] | null = null;
        const finish = () => {
          if (!taskRows || !commentRows) return;
          const commentTimes = new Map<string, string[]>();
          for (const comment of commentRows) {
            const times = commentTimes.get(comment.taskId) ?? [];
            times.push(comment.createdAt);
            commentTimes.set(comment.taskId, times);
          }
          const stamp = now.toISOString();
          for (const task of taskRows) {
            const lastWorkedAt = latestWorkAt(task, commentTimes.get(task.id) ?? []);
            if (shouldArchive({ status: task.status, lastWorkedAt }, now)) {
              store.put({ ...task, status: "archived", updatedAt: stamp, archivedAt: stamp, archiveVisitedAt: null });
            }
          }
        };
        taskRequest.onsuccess = () => {
          taskRows = taskRequest.result as Task[];
          finish();
        };
        commentRequest.onsuccess = () => {
          commentRows = commentRequest.result as Comment[];
          finish();
        };
      }),
  );
}

function listByTaskId<T>(storeName: "comments" | "attachments", taskId: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db
          .transaction(storeName, "readonly")
          .objectStore(storeName)
          .index("taskId")
          .getAll(taskId);
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      }),
  );
}
