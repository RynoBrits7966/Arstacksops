import { blankHierarchy, descendantIds, isTicketType, moveSibling, parentError, wouldCycle } from "../backlog/model";
import { cleanPlatforms, formatTicketId, nextTicketNumber } from "../issues/keys";
import { isColorTaken } from "../projects";
import { STATUS_LABELS } from "../statuses";
import { latestWorkAt, archiveNeedsVisit, shouldArchive, statusAfterMove } from "./archive";
import { readIndexedDb } from "./readIndexedDb";
import {
  SNAPSHOT_VERSION,
  blobToBase64,
  buildSnapshot,
  emptySnapshot,
  inspectImport,
  toComment,
  type Snapshot,
  type StoredAttachment,
  type StoredComment,
  type StoredVoice,
} from "./snapshot";
import type { ProjectInput, TaskStore } from "./taskStore";
import type {
  Attachment,
  ChecklistItem,
  DetailCategory,
  IssueSeverity,
  IssueType,
  MovableStatus,
  Platform,
  Priority,
  Project,
  Severity,
  Task,
  VoiceNote,
  WorkItemType,
} from "../types";

const STORE_KEY = "arstacksops.data.v1";
const BACKUP_KEY = "arstacksops.backup.v1";
const FLAT_BACKUP_KEY = "arstacksops.backup.flat-issues.v1";
const PRE_IMPORT_KEY = "arstacksops.backup.pre-import";
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_BYTES = 8 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i;
const ID_PREFIX: Record<WorkItemType, string> = {
  epic: "E",
  feature: "F",
  user_story: "US",
  task: "T",
  bug: "B",
};

export interface WorkItemInput {
  workItemType: WorkItemType;
  title: string;
  projectId: string;
  assigneeId: string;
  dueDate: string | null;
  parentId: string | null;
  description?: string;
  priority?: Priority | null;
  tags?: string[];
  storyPoints?: number | null;
  estimateHours?: number | null;
  acceptanceCriteria?: string;
  severity?: Severity | null;
  environment?: string;
  stepsToReproduce?: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  issueType?: IssueType | null;
  platforms?: Platform[];
  issueSeverity?: IssueSeverity | null;
  affectedArea?: string;
  detailCategory?: DetailCategory | null;
  actorId?: string;
}

export interface WorkItemPatch {
  title?: string;
  description?: string;
  status?: MovableStatus;
  projectId?: string;
  assigneeId?: string;
  parentId?: string | null;
  priority?: Priority | null;
  dueDate?: string | null;
  tags?: string[];
  storyPoints?: number | null;
  estimateHours?: number | null;
  acceptanceCriteria?: string;
  checklist?: ChecklistItem[];
  severity?: Severity | null;
  environment?: string;
  stepsToReproduce?: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  githubLinks?: string[];
  issueType?: IssueType | null;
  platforms?: Platform[];
  issueSeverity?: IssueSeverity | null;
  affectedArea?: string;
  detailCategory?: DetailCategory | null;
  actorId?: string;
}

let cache: Snapshot | null = null;
let loading: Promise<void> | null = null;
let recoveryError: Error | null = null;
let remoteVersion = 0;
let saveChain: Promise<void> = Promise.resolve();

export class AuthRequiredError extends Error {
  constructor() {
    super("Sign in required");
    this.name = "AuthRequiredError";
  }
}

/** Drop the in-memory board so the next sign-in loads the shared workspace again. */
export function closeWorkspace() {
  cache = null;
  loading = null;
  remoteVersion = 0;
  recoveryError = null;
}

function usesSharedWorkspace(): boolean {
  return typeof window !== "undefined";
}

function keepFlatBackup(raw: string) {
  if (localStorage.getItem(FLAT_BACKUP_KEY)) return;
  localStorage.setItem(FLAT_BACKUP_KEY, raw);
}

async function persist() {
  if (!cache) return;
  if (!usesSharedWorkspace()) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(cache));
    } catch {
      throw new Error("Could not save in this browser. The change was not stored. Browser storage may be full.");
    }
    return;
  }
  const run = saveChain.then(() => saveSharedWorkspace());
  saveChain = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
}

async function projectAction(path: string, extra: Record<string, unknown> = {}) {
  await ensure();
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: remoteVersion, ...extra }),
  });
  const body = (await response.json().catch(() => null)) as { message?: string; version?: number; snapshot?: unknown } | null;
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw new Error(body?.message ?? "Could not update the project.");
  const built = buildSnapshot(body?.snapshot);
  if (!built.ok) throw new Error(built.message);
  cache = built.snapshot;
  remoteVersion = typeof body?.version === "number" ? body.version : remoteVersion;
}

async function saveSharedWorkspace() {
  if (!cache) return;
  const response = await fetch("/api/workspace", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ version: remoteVersion, snapshot: cache }),
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (response.status === 409) {
    throw new Error("Someone else updated the board. Reload the page and try again.");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "Could not save the shared board. The change was not stored.");
  }
  const saved = (await response.json()) as { version: number };
  remoteVersion = saved.version;
}

async function commit<T>(change: (draft: Snapshot) => T): Promise<T> {
  if (!cache) throw new Error("Browser storage is not open");
  const previous = structuredClone(cache);
  const previousVersion = remoteVersion;
  try {
    const result = change(cache);
    await persist();
    return result;
  } catch (error) {
    cache = previous;
    remoteVersion = previousVersion;
    throw error;
  }
}

async function voiceFromBlob(voice: VoiceNote | null): Promise<StoredVoice | null> {
  if (!voice) return null;
  if (voice.blob.size > MAX_VOICE_BYTES) throw new Error("Voice notes must be 8 MB or smaller");
  return {
    mimeType: voice.mimeType,
    durationMs: voice.durationMs,
    dataBase64: await blobToBase64(voice.blob),
  };
}

async function backupFromIndexedDb(): Promise<Record<string, unknown> | null> {
  const dump = await readIndexedDb();
  if (!dump) return null;
  if (dump.projects.length === 0 && dump.tasks.length === 0 && dump.users.length === 0) return null;
  const comments: StoredComment[] = [];
  for (const item of dump.comments) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!record) continue;
    const voiceRecord =
      record.voice && typeof record.voice === "object" ? (record.voice as Record<string, unknown>) : null;
    const blob = voiceRecord?.blob instanceof Blob ? voiceRecord.blob : null;
    comments.push({
      id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
      taskId: typeof record.taskId === "string" ? record.taskId : "",
      authorId: typeof record.authorId === "string" ? record.authorId : "",
      body: typeof record.body === "string" ? record.body : "",
      mentionIds: Array.isArray(record.mentionIds) ? record.mentionIds.filter((id) => typeof id === "string") : [],
      readByIds: Array.isArray(record.readByIds) ? record.readByIds.filter((id) => typeof id === "string") : [],
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
      voice: blob
        ? {
            mimeType: typeof voiceRecord?.mimeType === "string" ? voiceRecord.mimeType : blob.type,
            durationMs: typeof voiceRecord?.durationMs === "number" ? voiceRecord.durationMs : 0,
            dataBase64: await blobToBase64(blob),
          }
        : null,
    });
  }
  const attachments: StoredAttachment[] = [];
  for (const item of dump.attachments) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!record || !(record.blob instanceof Blob)) continue;
    attachments.push({
      id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
      taskId: typeof record.taskId === "string" ? record.taskId : "",
      fileName: typeof record.fileName === "string" ? record.fileName : "screenshot",
      mimeType: typeof record.mimeType === "string" ? record.mimeType : record.blob.type,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
      dataBase64: await blobToBase64(record.blob),
    });
  }
  return {
    source: "indexeddb",
    takenAt: new Date().toISOString(),
    version: SNAPSHOT_VERSION,
    users: dump.users,
    projects: dump.projects,
    tasks: dump.tasks,
    comments,
    attachments,
  };
}

async function loadSharedWorkspace() {
  const response = await fetch("/api/workspace", { credentials: "include" });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw new Error("Could not load the shared board.");
  const body = (await response.json()) as { version: number; snapshot: unknown };
  const built = buildSnapshot(body.snapshot);
  if (!built.ok) throw new Error(built.message);
  cache = built.snapshot;
  remoteVersion = body.version;
}

async function load() {
  if (recoveryError) throw recoveryError;
  if (usesSharedWorkspace()) {
    await loadSharedWorkspace();
    return;
  }
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    throw new Error("Could not read browser storage.");
  }
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      recoveryError = new Error("Saved data in this browser could not be read. It was left unchanged.");
      throw recoveryError;
    }
    const built = buildSnapshot(parsed);
    if (!built.ok) {
      recoveryError = new Error(built.message);
      throw recoveryError;
    }
    cache = built.snapshot;
    if (built.changed) {
      try {
        keepFlatBackup(raw);
      } catch {
        cache = null;
        throw new Error(
          "Could not back up existing data before updating it. Nothing was replaced. Free some space in this browser and reload.",
        );
      }
      try {
        await persist();
      } catch {
        cache = null;
        throw new Error("Could not finish updating saved data in this browser. Your previous copy was left in place.");
      }
    }
    return;
  }
  const backup = await backupFromIndexedDb();
  if (backup) {
    try {
      if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      keepFlatBackup(JSON.stringify(backup));
    } catch {
      throw new Error(
        "Could not back up existing data before updating it. Nothing was replaced. Free some space in this browser and reload.",
      );
    }
    const built = buildSnapshot(backup);
    if (!built.ok) {
      recoveryError = new Error(built.message);
      throw recoveryError;
    }
    cache = built.snapshot;
    try {
      await persist();
    } catch {
      cache = null;
      throw new Error("Could not save the updated data in this browser. Your previous data was left in place.");
    }
    return;
  }
  cache = emptySnapshot();
  try {
    await persist();
  } catch {
    cache = null;
    throw new Error("Could not create browser storage for this app. Nothing was deleted.");
  }
}

async function ensure() {
  if (cache) return;
  if (!loading) {
    loading = load().finally(() => {
      loading = null;
    });
  }
  await loading;
  if (!cache) throw recoveryError ?? new Error("Could not open browser storage");
}

function cloneTask(task: Task): Task {
  return structuredClone(task);
}

function requireTask(draft: Snapshot, id: string): Task {
  const task = draft.tasks.find((item) => item.id === id);
  if (!task) throw new Error("Task not found");
  return task;
}

function allocateId(draft: Snapshot, type: WorkItemType): string {
  const taken = new Set(draft.tasks.map((task) => task.id));
  let number = Math.max(1, draft.nextSeq);
  let id = `${ID_PREFIX[type]}-${number}`;
  while (taken.has(id)) {
    number += 1;
    id = `${ID_PREFIX[type]}-${number}`;
  }
  draft.nextSeq = number + 1;
  return id;
}

function nextOrder(draft: Snapshot, projectId: string, parentId: string | null, excludeId?: string): number {
  const orders = draft.tasks
    .filter((task) => task.id !== excludeId && task.projectId === projectId && task.parentId === parentId)
    .map((task) => task.order);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

function logActivity(task: Task, authorId: string, message: string, at: string) {
  task.activity = [...task.activity, { id: crypto.randomUUID(), at, authorId, message }];
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
  if (input.deadline !== null && !DAY_PATTERN.test(input.deadline)) throw new Error("Enter a deadline or choose N/A");
  return { name, color: input.color.toLowerCase(), client, deadline: input.deadline };
}

function cleanTags(tags: string[]): string[] {
  const next = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  if (next.length > 12) throw new Error("Use 12 tags or fewer");
  if (next.some((tag) => tag.length > 24)) throw new Error("Tags must be 24 characters or fewer");
  return next;
}

function cleanLinks(links: string[]): string[] {
  const next = links.map((link) => link.trim()).filter(Boolean);
  if (next.some((link) => !/^https?:\/\/\S+$/i.test(link))) {
    throw new Error("Links must start with http:// or https://");
  }
  return next;
}

function cleanDue(value: string | null): string | null {
  if (!value) return null;
  if (!DAY_PATTERN.test(value)) throw new Error("Enter a deadline or leave it empty");
  return value;
}

function cleanPoints(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error("Story points must be a whole number");
  return value;
}

function cleanHours(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 9999) throw new Error("Estimated hours must be a positive number");
  return value;
}

function assertAssignee(draft: Snapshot, type: WorkItemType, assigneeId: string) {
  if (!assigneeId) {
    if (isTicketType(type)) throw new Error("Choose an assignee");
    return;
  }
  if (!draft.users.some((user) => user.id === assigneeId)) throw new Error("Choose a teammate");
}

function assertParent(draft: Snapshot, task: Pick<Task, "id" | "workItemType" | "projectId">, parentId: string | null) {
  const parent = parentId ? (draft.tasks.find((item) => item.id === parentId) ?? null) : null;
  if (parentId && !parent) throw new Error("Choose a parent in this project");
  if (parentId === task.id) throw new Error("A work item cannot be its own parent");
  const reason = parentError(task.workItemType, parent, task.projectId);
  if (reason) throw new Error(reason);
  if (wouldCycle(draft.tasks, task.id, parentId)) throw new Error("That parent would create a cycle");
}

function applyProjectMove(draft: Snapshot, task: Task, projectId: string) {
  if (!draft.projects.some((project) => project.id === projectId)) throw new Error("Choose a project");
  if (task.projectId === projectId) return;
  const ids = new Set([task.id, ...descendantIds(draft.tasks, task.id)]);
  for (const item of draft.tasks) {
    if (ids.has(item.id)) item.projectId = projectId;
  }
  task.parentId = null;
  let number = nextTicketNumber(draft.tasks, projectId, ids);
  const moved = draft.tasks
    .filter((item) => ids.has(item.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const item of moved) {
    item.ticketNumber = number;
    number += 1;
  }
}

function applyStatus(task: Task, status: MovableStatus, now: Date) {
  if (task.status === "archived") throw new Error("Archived tasks stay in Archive until you delete them");
  if (status === "escalated") throw new Error("Choose who to escalate this to");
  if (status === task.status) return;
  const moved = statusAfterMove(task.status, status, task.closedAt, now);
  task.status = moved.status;
  task.closedAt = moved.closedAt;
  task.escalatedToId = null;
  task.escalationSeenAt = null;
  task.lastWorkedAt = now.toISOString();
}

function toAttachment(stored: StoredAttachment): Attachment {
  return {
    id: stored.id,
    taskId: stored.taskId,
    fileName: stored.fileName,
    mimeType: stored.mimeType,
    createdAt: stored.createdAt,
    blob: base64ToBlob(stored.dataBase64, stored.mimeType),
  };
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function removeRelated(draft: Snapshot, ids: Set<string>) {
  draft.tasks = draft.tasks.filter((task) => !ids.has(task.id));
  draft.comments = draft.comments.filter((comment) => !ids.has(comment.taskId));
  draft.attachments = draft.attachments.filter((attachment) => !ids.has(attachment.taskId));
}

export const taskStore: TaskStore & {
  createWorkItem(input: WorkItemInput): Promise<Task>;
  createIssue(input: {
    title: string;
    description: string;
    projectId: string;
    assigneeId: string;
    issueType: IssueType;
    platforms: Platform[];
    issueSeverity: IssueSeverity | null;
    stepsToReproduce?: string;
    expectedBehaviour?: string;
    actualBehaviour?: string;
    affectedArea?: string;
    detailCategory?: DetailCategory | null;
    actorId?: string;
  }): Promise<Task>;
  updateWorkItem(id: string, patch: WorkItemPatch): Promise<Task>;
  moveWorkItem(id: string, direction: "up" | "down", actorId: string): Promise<void>;
  exportSnapshot(): Promise<string>;
  importSnapshot(json: string): Promise<void>;
} = {
  seedDemo: async () => {
    await ensure();
  },
  listUsers: async () => {
    await ensure();
    return cache!.users.map((user) => ({ ...user })).sort((a, b) => a.name.localeCompare(b.name));
  },
  listProjects: async () => {
    await ensure();
    return cache!.projects.map((project) => ({
      ...project,
      client: project.client ?? "",
      signOff: project.signOff ?? null,
    }));
  },
  createProject: async (input) => {
    await ensure();
    const fields = projectFields(input);
    return commit((draft) => {
      if (isColorTaken(draft.projects.map((project) => project.color), fields.color)) {
        throw new Error("That colour is already used by another project");
      }
      const project: Project = {
        id: crypto.randomUUID(),
        ...fields,
        createdAt: new Date().toISOString(),
        signOff: null,
      };
      draft.projects.push(project);
      return project;
    });
  },
  updateProject: async (id, patch) => {
    await ensure();
    const fields = projectFields(patch);
    return commit((draft) => {
      const current = draft.projects.find((project) => project.id === id);
      if (!current) throw new Error("Project not found");
      const taken = draft.projects.filter((project) => project.id !== id).map((project) => project.color);
      if (isColorTaken(taken, fields.color)) throw new Error("That colour is already used by another project");
      Object.assign(current, fields);
      return { ...current };
    });
  },
  deleteProject: async (id, password) => {
    await projectAction(`/api/projects/${encodeURIComponent(id)}/delete`, { password });
  },
  signOffProject: async (id) => {
    await projectAction(`/api/projects/${encodeURIComponent(id)}/sign-off`);
    const project = cache?.projects.find((item) => item.id === id);
    if (!project) throw new Error("That project is no longer on the board.");
    return { ...project, signOff: project.signOff ?? null };
  },
  reopenProject: async (id) => {
    await projectAction(`/api/projects/${encodeURIComponent(id)}/reopen`);
    const project = cache?.projects.find((item) => item.id === id);
    if (!project) throw new Error("That project is no longer on the board.");
    return { ...project, signOff: project.signOff ?? null };
  },
  listTasks: async () => {
    await ensure();
    return cache!.tasks.map(cloneTask);
  },
  createTask: async (input) =>
    taskStore.createWorkItem({
      workItemType: "task",
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      dueDate: null,
      parentId: null,
      issueType: "improvement",
    }),
  createIssue: async (input: {
    title: string;
    description: string;
    projectId: string;
    assigneeId: string;
    issueType: IssueType;
    platforms: Platform[];
    issueSeverity: IssueSeverity | null;
    stepsToReproduce?: string;
    expectedBehaviour?: string;
    actualBehaviour?: string;
    affectedArea?: string;
    detailCategory?: DetailCategory | null;
    actorId?: string;
  }) =>
    taskStore.createWorkItem({
      workItemType: input.issueType === "bug" ? "bug" : "task",
      title: input.title,
      description: input.description,
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      dueDate: null,
      parentId: null,
      issueType: input.issueType,
      platforms: cleanPlatforms(input.platforms),
      issueSeverity: input.issueSeverity,
      stepsToReproduce: input.stepsToReproduce,
      expectedBehaviour: input.expectedBehaviour,
      actualBehaviour: input.actualBehaviour,
      affectedArea: input.affectedArea,
      detailCategory: input.detailCategory ?? null,
      actorId: input.actorId,
    }),
  createWorkItem: async (input) => {
    await ensure();
    const title = input.title.trim();
    if (!title) throw new Error("Title is required");
    const dueDate = cleanDue(input.dueDate);
    return commit((draft) => {
      if (!draft.projects.some((project) => project.id === input.projectId)) throw new Error("Choose a project");
      assertAssignee(draft, input.workItemType, input.assigneeId);
      const id = allocateId(draft, input.workItemType);
      assertParent(draft, { id, workItemType: input.workItemType, projectId: input.projectId }, input.parentId);
      const now = new Date().toISOString();
      const task: Task = {
        ...blankHierarchy(),
        id,
        projectId: input.projectId,
        assigneeId: input.assigneeId,
        acceptedAt: null,
        escalatedToId: null,
        escalationSeenAt: null,
        title,
        description: (input.description ?? "").trim(),
        status: "new",
        createdAt: now,
        updatedAt: now,
        lastWorkedAt: now,
        closedAt: null,
        ticketNumber: nextTicketNumber(draft.tasks, input.projectId),
        issueType:
          input.issueType !== undefined
            ? input.issueType
            : input.workItemType === "bug"
              ? "bug"
              : input.workItemType === "task"
                ? "improvement"
                : null,
        issueSeverity: input.issueSeverity ?? null,
        platforms: cleanPlatforms(input.platforms),
        affectedArea: (input.affectedArea ?? "").trim(),
        detailCategory: input.detailCategory ?? null,
        workItemType: input.workItemType,
        parentId: input.parentId,
        order: nextOrder(draft, input.projectId, input.parentId),
        tags: cleanTags(input.tags ?? []),
        priority: input.priority ?? null,
        dueDate,
        storyPoints: input.workItemType === "user_story" ? cleanPoints(input.storyPoints) : null,
        estimateHours:
          input.workItemType === "task" || input.workItemType === "bug" ? cleanHours(input.estimateHours) : null,
        acceptanceCriteria: input.workItemType === "user_story" ? (input.acceptanceCriteria ?? "").trim() : "",
        severity: input.workItemType === "bug" ? (input.severity ?? null) : null,
        environment: input.workItemType === "bug" ? (input.environment ?? "").trim() : "",
        stepsToReproduce: input.workItemType === "bug" ? (input.stepsToReproduce ?? "").trim() : "",
        expectedBehaviour: input.workItemType === "bug" ? (input.expectedBehaviour ?? "").trim() : "",
        actualBehaviour: input.workItemType === "bug" ? (input.actualBehaviour ?? "").trim() : "",
      };
      logActivity(task, input.actorId ?? "", "Created", now);
      draft.tasks.push(task);
      return cloneTask(task);
    });
  },
  updateTask: async (id, patch) => taskStore.updateWorkItem(id, patch),
  updateWorkItem: async (id, patch) => {
    await ensure();
    return commit((draft) => {
      const task = requireTask(draft, id);
      if (patch.status && task.status === "archived") {
        throw new Error("Archived tasks stay in Archive until you delete them");
      }
      const title = patch.title !== undefined ? patch.title.trim() : task.title;
      if (!title) throw new Error("Title is required");
      const now = new Date();
      const notes: string[] = [];
      if (patch.projectId && patch.projectId !== task.projectId) {
        applyProjectMove(draft, task, patch.projectId);
        const project = draft.projects.find((item) => item.id === patch.projectId);
        notes.push(
          `Moved to ${project?.name ?? "another project"}. Ticket id is now ${formatTicketId(project?.name, task.ticketNumber)}`,
        );
      }
      if (patch.parentId !== undefined && patch.parentId !== task.parentId) {
        assertParent(draft, task, patch.parentId);
        task.parentId = patch.parentId;
        task.order = nextOrder(draft, task.projectId, task.parentId, task.id);
        notes.push(patch.parentId ? "Changed parent" : "Moved to the project level");
      }
      if (patch.assigneeId !== undefined && patch.assigneeId !== task.assigneeId) {
        assertAssignee(draft, task.workItemType, patch.assigneeId);
        task.assigneeId = patch.assigneeId;
        notes.push("Changed assignee");
      }
      if (patch.status && patch.status !== task.status) {
        applyStatus(task, patch.status, now);
        notes.push(`State changed to ${STATUS_LABELS[patch.status]}`);
      }
      if (title !== task.title) notes.push("Updated title");
      task.title = title;
      if (patch.description !== undefined && patch.description.trim() !== task.description) {
        task.description = patch.description.trim();
        notes.push("Updated description");
      }
      if (patch.priority !== undefined) task.priority = patch.priority;
      if (patch.dueDate !== undefined) task.dueDate = cleanDue(patch.dueDate);
      if (patch.tags) task.tags = cleanTags(patch.tags);
      if (patch.storyPoints !== undefined) task.storyPoints = cleanPoints(patch.storyPoints);
      if (patch.estimateHours !== undefined) task.estimateHours = cleanHours(patch.estimateHours);
      if (patch.acceptanceCriteria !== undefined) task.acceptanceCriteria = patch.acceptanceCriteria.trim();
      if (patch.checklist) task.checklist = patch.checklist;
      if (patch.severity !== undefined) task.severity = patch.severity;
      if (patch.environment !== undefined) task.environment = patch.environment.trim();
      if (patch.stepsToReproduce !== undefined) task.stepsToReproduce = patch.stepsToReproduce.trim();
      if (patch.expectedBehaviour !== undefined) task.expectedBehaviour = patch.expectedBehaviour.trim();
      if (patch.actualBehaviour !== undefined) task.actualBehaviour = patch.actualBehaviour.trim();
      if (patch.githubLinks) task.githubLinks = cleanLinks(patch.githubLinks);
      if (patch.issueType !== undefined && patch.issueType !== task.issueType) {
        task.issueType = patch.issueType;
        notes.push("Updated issue type");
      }
      if (patch.platforms !== undefined) {
        const platforms = cleanPlatforms(patch.platforms);
        if (platforms.join() !== (task.platforms ?? []).join()) {
          task.platforms = platforms;
          notes.push("Updated platform");
        }
      }
      if (patch.issueSeverity !== undefined && patch.issueSeverity !== task.issueSeverity) {
        task.issueSeverity = patch.issueSeverity;
        notes.push("Updated severity");
      }
      if (patch.affectedArea !== undefined) task.affectedArea = patch.affectedArea.trim();
      if (patch.detailCategory !== undefined) task.detailCategory = patch.detailCategory;
      if (
        notes.length === 0 &&
        (patch.priority !== undefined ||
          patch.dueDate !== undefined ||
          patch.tags !== undefined ||
          patch.storyPoints !== undefined ||
          patch.estimateHours !== undefined ||
          patch.acceptanceCriteria !== undefined ||
          patch.checklist !== undefined ||
          patch.severity !== undefined ||
          patch.environment !== undefined ||
          patch.stepsToReproduce !== undefined ||
          patch.expectedBehaviour !== undefined ||
          patch.actualBehaviour !== undefined ||
          patch.githubLinks !== undefined ||
          patch.affectedArea !== undefined ||
          patch.detailCategory !== undefined)
      ) {
        notes.push("Updated details");
      }
      const stamp = now.toISOString();
      task.updatedAt = stamp;
      if (notes.length > 0) logActivity(task, patch.actorId ?? "", notes.join(". "), stamp);
      return cloneTask(task);
    });
  },
  moveWorkItem: async (id, direction, actorId) => {
    await ensure();
    commit((draft) => {
      const next = moveSibling(draft.tasks, id, direction);
      if (!next) return;
      draft.tasks = next;
      const task = requireTask(draft, id);
      const stamp = new Date().toISOString();
      task.updatedAt = stamp;
      logActivity(task, actorId, direction === "up" ? "Moved up" : "Moved down", stamp);
    });
  },
  acceptTask: async (id, userId) => {
    await ensure();
    return commit((draft) => {
      const task = requireTask(draft, id);
      if (task.status === "archived") throw new Error("Archived tasks stay in Archive until you delete them");
      if (task.assigneeId !== userId) throw new Error("Only the tagged teammate can accept");
      if (task.acceptedAt) return cloneTask(task);
      const now = new Date().toISOString();
      task.status = "in_progress";
      task.acceptedAt = now;
      task.escalatedToId = null;
      task.escalationSeenAt = null;
      task.closedAt = null;
      task.updatedAt = now;
      task.lastWorkedAt = now;
      logActivity(task, userId, "Accepted", now);
      return cloneTask(task);
    });
  },
  escalateTask: async (id, userId) => {
    await ensure();
    if (!userId) throw new Error("Choose who to escalate this to");
    return commit((draft) => {
      const task = requireTask(draft, id);
      if (task.status === "archived") throw new Error("Archived tasks stay in Archive until you delete them");
      const user = draft.users.find((item) => item.id === userId);
      if (!user) throw new Error("Choose a teammate");
      const now = new Date();
      const moved = statusAfterMove(task.status, "escalated", task.closedAt, now);
      const stamp = now.toISOString();
      task.status = moved.status;
      task.closedAt = moved.closedAt;
      task.escalatedToId = userId;
      task.escalationSeenAt = null;
      task.updatedAt = stamp;
      task.lastWorkedAt = stamp;
      logActivity(task, "", `Escalated to ${user.name}`, stamp);
      return cloneTask(task);
    });
  },
  markEscalationSeen: async (id, userId) => {
    await ensure();
    if (!userId) return false;
    return commit((draft) => {
      const task = draft.tasks.find((item) => item.id === id);
      if (!task || task.escalatedToId !== userId || task.escalationSeenAt) return false;
      task.escalationSeenAt = new Date().toISOString();
      return true;
    });
  },
  markArchiveVisited: async (id, now = new Date()) => {
    await ensure();
    return commit((draft) => {
      const task = draft.tasks.find((item) => item.id === id);
      if (!task || !archiveNeedsVisit(task, now)) return false;
      task.archiveVisitedAt = now.toISOString();
      return true;
    });
  },
  listAllComments: async () => {
    await ensure();
    return cache!.comments.map(toComment);
  },
  listComments: async (taskId) => {
    await ensure();
    return cache!.comments
      .filter((comment) => comment.taskId === taskId)
      .map(toComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  addComment: async (taskId, input) => {
    await ensure();
    const text = input.body.trim();
    if (!text && !input.voice) throw new Error("Write a comment or record a voice note");
    if (!input.authorId) throw new Error("Choose who is commenting");
    const voice = await voiceFromBlob(input.voice);
    return commit((draft) => {
      const task = requireTask(draft, taskId);
      const comment: StoredComment = {
        id: crypto.randomUUID(),
        taskId,
        authorId: input.authorId,
        body: text,
        mentionIds: [...new Set(input.mentionIds)],
        readByIds: [input.authorId],
        voice,
        createdAt: new Date().toISOString(),
      };
      task.updatedAt = comment.createdAt;
      task.lastWorkedAt = comment.createdAt;
      logActivity(task, input.authorId, "Comment added", comment.createdAt);
      draft.comments.push(comment);
      return toComment(comment);
    });
  },
  markMentionsRead: async (taskId, userId) => {
    await ensure();
    if (!userId) return false;
    return commit((draft) => {
      let changed = false;
      for (const comment of draft.comments) {
        if (comment.taskId !== taskId) continue;
        if (!comment.mentionIds.includes(userId) || comment.readByIds.includes(userId)) continue;
        comment.readByIds = [...comment.readByIds, userId];
        changed = true;
      }
      return changed;
    });
  },
  listAttachments: async (taskId) => {
    await ensure();
    return cache!.attachments
      .filter((item) => item.taskId === taskId)
      .map(toAttachment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  addAttachment: async (taskId, file) => {
    await ensure();
    const image = file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
    if (!image) throw new Error("Choose an image file");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("Screenshots must be 8 MB or smaller");
    const dataBase64 = await blobToBase64(file);
    return commit((draft) => {
      const task = requireTask(draft, taskId);
      const attachment: StoredAttachment = {
        id: crypto.randomUUID(),
        taskId,
        fileName: file.name || "screenshot",
        mimeType: file.type || "application/octet-stream",
        createdAt: new Date().toISOString(),
        dataBase64,
      };
      task.updatedAt = attachment.createdAt;
      task.lastWorkedAt = attachment.createdAt;
      logActivity(task, "", "Screenshot added", attachment.createdAt);
      draft.attachments.push(attachment);
      return toAttachment(attachment);
    });
  },
  deleteTask: async (id) => {
    await ensure();
    commit((draft) => {
      if (!draft.tasks.some((task) => task.id === id)) throw new Error("Task not found");
      const ids = new Set([id, ...descendantIds(draft.tasks, id)]);
      removeRelated(draft, ids);
    });
  },
  archiveExpired: async (now = new Date()) => {
    await ensure();
    commit((draft) => {
      const commentTimes = new Map<string, string[]>();
      for (const comment of draft.comments) {
        const times = commentTimes.get(comment.taskId) ?? [];
        times.push(comment.createdAt);
        commentTimes.set(comment.taskId, times);
      }
      const stamp = now.toISOString();
      for (const task of draft.tasks) {
        const lastWorkedAt = latestWorkAt(task, commentTimes.get(task.id) ?? []);
        if (shouldArchive({ status: task.status, lastWorkedAt }, now)) {
          task.status = "archived";
          task.updatedAt = stamp;
          task.archivedAt = stamp;
          task.archiveVisitedAt = null;
        }
      }
    });
  },
  exportSnapshot: async () => {
    await ensure();
    return JSON.stringify(cache, null, 2);
  },
  importSnapshot: async (json) => {
    await ensure();
    const inspected = inspectImport(json);
    if (!inspected.ok) throw new Error(inspected.errors.join("\n"));
    const previous = structuredClone(cache!);
    try {
      localStorage.setItem(PRE_IMPORT_KEY, JSON.stringify(previous));
    } catch {
      throw new Error("Could not back up the current data before import. Nothing was replaced.");
    }
    cache = inspected.snapshot;
    try {
      persist();
    } catch (error) {
      cache = previous;
      try {
        persist();
      } catch {
        cache = previous;
      }
      throw error;
    }
  },
};
