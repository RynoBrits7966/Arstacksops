import { isWorkItemType, parentError, wouldCycle } from "../backlog/model";
import { assignTicketNumbers, cleanPlatforms, isDetailCategory, resolveIssueSeverity, resolveIssueType } from "../issues/keys";
import type {
  ActivityEntry,
  ChecklistItem,
  Comment,
  DetailCategory,
  Priority,
  Project,
  ProjectSignOff,
  Severity,
  Task,
  TaskStatus,
  User,
  WorkItemType,
} from "../types";

export const SNAPSHOT_VERSION = 1;

export interface StoredVoice {
  mimeType: string;
  durationMs: number;
  dataBase64: string;
}

export interface StoredComment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  readByIds: string[];
  voice: StoredVoice | null;
  createdAt: string;
}

export interface StoredAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  dataBase64: string;
}

export interface Snapshot {
  version: 1;
  nextSeq: number;
  users: User[];
  projects: Project[];
  tasks: Task[];
  comments: StoredComment[];
  attachments: StoredAttachment[];
}

const STATUSES = new Set<TaskStatus>(["new", "in_progress", "resolved", "escalated", "closed", "archived"]);
const PRIORITIES = new Set<Priority>(["low", "medium", "high", "critical"]);
const SEVERITIES = new Set<Severity>(["low", "medium", "high", "critical"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function emptySnapshot(): Snapshot {
  return { version: 1, nextSeq: 1, users: [], projects: [], tasks: [], comments: [], attachments: [] };
}

/** Keep a local edit when the shared board moved on, without dropping anyone else's records. */
export function rebaseSnapshot(base: Snapshot, local: Snapshot, server: Snapshot): Snapshot {
  return {
    ...server,
    nextSeq: Math.max(server.nextSeq, local.nextSeq),
    users: server.users,
    projects: rebaseRecords(base.projects, local.projects, server.projects),
    tasks: rebaseRecords(base.tasks, local.tasks, server.tasks),
    comments: rebaseRecords(base.comments, local.comments, server.comments),
    attachments: rebaseRecords(base.attachments, local.attachments, server.attachments),
  };
}

function rebaseRecords<T extends { id: string }>(base: T[], local: T[], server: T[]): T[] {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const serverIds = new Set(server.map((item) => item.id));
  const merged = server.flatMap((item) => {
    const mine = localById.get(item.id);
    const original = baseById.get(item.id);
    if (!mine) return sameRecord(original, item) ? [] : [item];
    if (!original || sameRecord(mine, original)) return [item];
    if (sameRecord(item, original)) return [mine];
    return [item];
  });
  for (const item of local) {
    if (!serverIds.has(item.id) && !baseById.has(item.id)) merged.push(item);
  }
  return merged;
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

export function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function checklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || typeof record.label !== "string") return [];
    return [{ id: record.id, label: record.label, done: record.done === true }];
  });
}

function activity(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string" || typeof record.message !== "string") return [];
    return [
      {
        id: record.id,
        at: typeof record.at === "string" ? record.at : "",
        authorId: typeof record.authorId === "string" ? record.authorId : "",
        message: record.message,
      },
    ];
  });
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeTask(raw: unknown, index: number): { task: Task; changed: boolean } {
  const record = asRecord(raw) ?? {};
  let changed = asRecord(raw) === null;
  const id = typeof record.id === "string" && record.id ? record.id : `recovered-${index + 1}`;
  if (id !== record.id) changed = true;
  const workItemType: WorkItemType = isWorkItemType(record.workItemType) ? record.workItemType : "task";
  if (record.workItemType !== workItemType) changed = true;
  const parentId = typeof record.parentId === "string" && record.parentId ? record.parentId : null;
  if (record.parentId !== parentId && record.parentId !== undefined) changed = true;
  if (record.parentId === undefined) changed = true;
  const status: TaskStatus = STATUSES.has(record.status as TaskStatus) ? (record.status as TaskStatus) : "new";
  if (record.status !== status) changed = true;
  const priority = PRIORITIES.has(record.priority as Priority) ? (record.priority as Priority) : null;
  if (record.priority !== priority && record.priority !== undefined && record.priority !== null) changed = true;
  if (record.priority === undefined) changed = true;
  const dueDate = typeof record.dueDate === "string" && DAY.test(record.dueDate) ? record.dueDate : null;
  if (record.dueDate !== dueDate && record.dueDate !== undefined) changed = true;
  if (record.dueDate === undefined) changed = true;
  const order = typeof record.order === "number" && Number.isFinite(record.order) ? record.order : null;
  if (order === null) changed = true;
  const tags = stringList(record.tags);
  if (!Array.isArray(record.tags)) changed = true;
  if (!Array.isArray(record.checklist) || !Array.isArray(record.activity) || !Array.isArray(record.githubLinks)) {
    changed = true;
  }
  if (typeof record.acceptanceCriteria !== "string") changed = true;
  const severity = SEVERITIES.has(record.severity as Severity) ? (record.severity as Severity) : null;
  const issueType = resolveIssueType(record.issueType, workItemType);
  if (issueType.changed) changed = true;
  const issueSeverity = resolveIssueSeverity(record.issueSeverity);
  if (issueSeverity.changed) changed = true;
  const detailCategory: DetailCategory | null = isDetailCategory(record.detailCategory) ? record.detailCategory : null;
  if (record.detailCategory !== detailCategory && record.detailCategory != null) changed = true;
  if (record.detailCategory === undefined) changed = true;
  const affectedArea = typeof record.affectedArea === "string" ? record.affectedArea : "";
  if (typeof record.affectedArea !== "string") changed = true;
  const ticketNumber =
    typeof record.ticketNumber === "number" && Number.isInteger(record.ticketNumber) && record.ticketNumber > 0
      ? record.ticketNumber
      : 0;
  if (ticketNumber === 0) changed = true;
  const now = new Date(0).toISOString();
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : now;
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
  const platforms = cleanPlatforms(record.platforms);
  if (JSON.stringify(record.platforms ?? []) !== JSON.stringify(platforms)) changed = true;
  const archivedAt = status === "archived" ? (typeof record.archivedAt === "string" ? record.archivedAt : updatedAt) : null;
  const archiveVisitedAt =
    status === "archived" && typeof record.archiveVisitedAt === "string" ? record.archiveVisitedAt : null;
  if ((record.archivedAt ?? null) !== archivedAt) changed = true;
  if ((record.archiveVisitedAt ?? null) !== archiveVisitedAt) changed = true;
  const task: Task = {
    ...(record as unknown as Task),
    id,
    projectId: typeof record.projectId === "string" ? record.projectId : "",
    assigneeId: typeof record.assigneeId === "string" ? record.assigneeId : "",
    acceptedAt: typeof record.acceptedAt === "string" ? record.acceptedAt : null,
    escalatedToId: typeof record.escalatedToId === "string" ? record.escalatedToId : null,
    escalationSeenAt: typeof record.escalationSeenAt === "string" ? record.escalationSeenAt : null,
    title: typeof record.title === "string" ? record.title : "Untitled",
    description: typeof record.description === "string" ? record.description : "",
    status,
    createdAt,
    updatedAt,
    lastWorkedAt: typeof record.lastWorkedAt === "string" ? record.lastWorkedAt : updatedAt,
    closedAt: typeof record.closedAt === "string" ? record.closedAt : null,
    ticketNumber,
    issueType: issueType.value,
    platforms,
    archivedAt,
    archiveVisitedAt,
    issueSeverity: issueSeverity.value,
    affectedArea,
    detailCategory,
    workItemType,
    parentId,
    order: order ?? index,
    tags,
    priority,
    dueDate,
    storyPoints: optionalNumber(record.storyPoints),
    estimateHours: optionalNumber(record.estimateHours),
    acceptanceCriteria: typeof record.acceptanceCriteria === "string" ? record.acceptanceCriteria : "",
    checklist: checklist(record.checklist),
    activity: activity(record.activity),
    severity,
    environment: typeof record.environment === "string" ? record.environment : "",
    stepsToReproduce: typeof record.stepsToReproduce === "string" ? record.stepsToReproduce : "",
    expectedBehaviour: typeof record.expectedBehaviour === "string" ? record.expectedBehaviour : "",
    actualBehaviour: typeof record.actualBehaviour === "string" ? record.actualBehaviour : "",
    githubLinks: stringList(record.githubLinks),
  };
  return { task, changed };
}

function repairParents(tasks: Task[]): boolean {
  let changed = false;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    if (!task.parentId) continue;
    const parent = byId.get(task.parentId) ?? null;
    const reason = parent ? parentError(task.workItemType, parent, task.projectId) : "Missing parent";
    if (reason || wouldCycle(tasks, task.id, task.parentId)) {
      task.parentId = null;
      changed = true;
    }
  }
  return changed;
}

function assignMissingOrder(tasks: Task[]): boolean {
  let changed = false;
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = `${task.projectId}::${task.parentId ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const missing = group.filter((task) => !Number.isFinite(task.order));
    if (missing.length === 0) continue;
    let next = group.reduce((max, task) => (Number.isFinite(task.order) ? Math.max(max, task.order) : max), -1) + 1;
    missing.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const task of missing) {
      task.order = next;
      next += 1;
      changed = true;
    }
  }
  return changed;
}

function normalizeSignOff(value: unknown): ProjectSignOff | null {
  const record = asRecord(value);
  if (!record || typeof record.userId !== "string" || typeof record.name !== "string" || typeof record.at !== "string") {
    return null;
  }
  if (!record.userId || !record.name || !record.at) return null;
  return { userId: record.userId, name: record.name, at: record.at };
}

function normalizeProject(raw: unknown): Project | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") return null;
  return {
    ...(record as unknown as Project),
    id: record.id,
    name: record.name,
    color: typeof record.color === "string" ? record.color : "#3d7ea6",
    client: typeof record.client === "string" ? record.client : "",
    deadline: typeof record.deadline === "string" ? record.deadline : null,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    signOff: normalizeSignOff(record.signOff),
  };
}

function normalizeUser(raw: unknown): User | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "string" || typeof record.name !== "string") return null;
  return { id: record.id, name: record.name };
}

function normalizeComment(raw: unknown, index: number): StoredComment | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = typeof record.id === "string" && record.id ? record.id : `comment-recovered-${index + 1}`;
  const voiceRecord = asRecord(record.voice);
  const voice =
    voiceRecord && typeof voiceRecord.dataBase64 === "string"
      ? {
          mimeType: typeof voiceRecord.mimeType === "string" ? voiceRecord.mimeType : "audio/webm",
          durationMs: typeof voiceRecord.durationMs === "number" ? voiceRecord.durationMs : 0,
          dataBase64: voiceRecord.dataBase64,
        }
      : null;
  return {
    id,
    taskId: typeof record.taskId === "string" ? record.taskId : "",
    authorId: typeof record.authorId === "string" ? record.authorId : "",
    body: typeof record.body === "string" ? record.body : "",
    mentionIds: stringList(record.mentionIds),
    readByIds: stringList(record.readByIds),
    voice,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
  };
}

function normalizeAttachment(raw: unknown, index: number): StoredAttachment | null {
  const record = asRecord(raw);
  if (!record || typeof record.dataBase64 !== "string") return null;
  return {
    id: typeof record.id === "string" && record.id ? record.id : `file-recovered-${index + 1}`,
    taskId: typeof record.taskId === "string" ? record.taskId : "",
    fileName: typeof record.fileName === "string" ? record.fileName : "screenshot",
    mimeType: typeof record.mimeType === "string" ? record.mimeType : "application/octet-stream",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString(),
    dataBase64: record.dataBase64,
  };
}

export function buildSnapshot(
  raw: unknown,
  mode: "migrate" | "import" = "migrate",
): { ok: true; snapshot: Snapshot; changed: boolean } | { ok: false; message: string } {
  const record = asRecord(raw);
  if (!record) return { ok: false, message: "Saved data in this browser could not be read. It was left unchanged." };
  if (!Array.isArray(record.tasks) || !Array.isArray(record.projects)) {
    return { ok: false, message: "Saved data in this browser could not be read. It was left unchanged." };
  }
  let changed = record.version !== SNAPSHOT_VERSION;
  const tasks: Task[] = [];
  record.tasks.forEach((item, index) => {
    const normalized = normalizeTask(item, index);
    if (normalized.changed) changed = true;
    tasks.push(normalized.task);
  });
  if (mode === "migrate" && repairParents(tasks)) changed = true;
  if (assignMissingOrder(tasks)) changed = true;
  if (assignTicketNumbers(tasks)) changed = true;
  const projects = record.projects.map(normalizeProject).filter((item): item is Project => item !== null);
  if (projects.length !== record.projects.length) changed = true;
  const users = Array.isArray(record.users)
    ? record.users.map(normalizeUser).filter((item): item is User => item !== null)
    : [];
  const comments = Array.isArray(record.comments)
    ? record.comments.map(normalizeComment).filter((item): item is StoredComment => item !== null)
    : [];
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.map(normalizeAttachment).filter((item): item is StoredAttachment => item !== null)
    : [];
  const nextSeq = typeof record.nextSeq === "number" && record.nextSeq > 0 ? record.nextSeq : 1;
  return {
    ok: true,
    changed,
    snapshot: { version: 1, nextSeq, users, projects, tasks, comments, attachments },
  };
}

export function hierarchyIssues(snapshot: Snapshot): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const projects = new Set(snapshot.projects.map((project) => project.id));
  for (const task of snapshot.tasks) {
    if (ids.has(task.id)) errors.push(`Work item ${task.id} is listed more than once.`);
    ids.add(task.id);
    if (!projects.has(task.projectId)) errors.push(`${task.id} points at a missing project.`);
    if (!STATUSES.has(task.status)) errors.push(`${task.id} has an unknown state.`);
    if (!isWorkItemType(task.workItemType)) errors.push(`${task.id} has an unknown work item type.`);
  }
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
  for (const task of snapshot.tasks) {
    if (!task.parentId) {
      const reason = parentError(task.workItemType, null, task.projectId);
      if (reason) errors.push(`${task.title}: ${reason}`);
      continue;
    }
    const parent = byId.get(task.parentId);
    if (!parent) {
      errors.push(`${task.title} points at a missing parent.`);
      continue;
    }
    const reason = parentError(task.workItemType, parent, task.projectId);
    if (reason) errors.push(`${task.title}: ${reason}`);
    if (wouldCycle(snapshot.tasks, task.id, task.parentId)) errors.push(`${task.title} would create a cycle.`);
  }
  return errors;
}

export function inspectImport(json: string): { ok: true; snapshot: Snapshot } | { ok: false; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["This file is not valid JSON."] };
  }
  const built = buildSnapshot(parsed, "import");
  if (!built.ok) return { ok: false, errors: [built.message] };
  const errors = hierarchyIssues(built.snapshot);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, snapshot: built.snapshot };
}

export function toComment(stored: StoredComment): Comment {
  return {
    id: stored.id,
    taskId: stored.taskId,
    authorId: stored.authorId,
    body: stored.body,
    mentionIds: stored.mentionIds,
    readByIds: stored.readByIds,
    createdAt: stored.createdAt,
    voice: stored.voice
      ? {
          mimeType: stored.voice.mimeType,
          durationMs: stored.voice.durationMs,
          blob: base64ToBlob(stored.voice.dataBase64, stored.voice.mimeType),
        }
      : null,
  };
}
