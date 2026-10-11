import type { MovableStatus, TaskStatus } from "../types";

/** A ticket moves to Archive after this many days with no movement. */
export const IDLE_ARCHIVE_DAYS = 7;

/** After this many days in Archive, the ticket is marked until someone opens it. */
export const ARCHIVE_VISIT_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ArchiveFields {
  status: TaskStatus;
  lastWorkedAt: string;
}

export function latestWorkAt(
  task: { lastWorkedAt?: string | null; updatedAt?: string },
  commentTimes: string[] = [],
): string {
  const stamps = [task.lastWorkedAt, ...commentTimes].filter((stamp): stamp is string => Boolean(stamp));
  if (stamps.length === 0) return task.updatedAt ?? "";
  return stamps.reduce((latest, stamp) => (stamp > latest ? stamp : latest));
}

export function archiveDueAt(lastWorkedAt: string): Date {
  return new Date(new Date(lastWorkedAt).getTime() + IDLE_ARCHIVE_DAYS * DAY_MS);
}

export function archiveNeedsVisit(
  task: { status: TaskStatus; archivedAt?: string | null; archiveVisitedAt?: string | null },
  now = new Date(),
): boolean {
  if (task.status !== "archived" || !task.archivedAt) return false;
  const due = new Date(task.archivedAt).getTime() + ARCHIVE_VISIT_DAYS * DAY_MS;
  if (!Number.isFinite(due) || now.getTime() < due) return false;
  if (!task.archiveVisitedAt) return true;
  return new Date(task.archiveVisitedAt).getTime() < due;
}

export function shouldArchive(task: ArchiveFields, now: Date): boolean {
  if (task.status === "archived" || !task.lastWorkedAt) return false;
  const due = archiveDueAt(task.lastWorkedAt).getTime();
  return Number.isFinite(due) && due <= now.getTime();
}

export function formatIdleLeft(lastWorkedAt: string, now = new Date()): string {
  const remaining = archiveDueAt(lastWorkedAt).getTime() - now.getTime();
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return "No comments or resolution for 7 days. Moves to archive.";
  }
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const days = Math.floor(remaining / day);
  const hours = Math.floor((remaining % day) / hour);
  if (days >= 1) {
    const dayLabel = days === 1 ? "1 day" : `${days} days`;
    return hours > 0
      ? `${dayLabel} ${hours}h left if no one comments or resolves it`
      : `${dayLabel} left if no one comments or resolves it`;
  }
  if (hours >= 1) return `${hours}h left if no one comments or resolves it`;
  const minutes = Math.max(1, Math.ceil(remaining / minute));
  return `${minutes}m left if no one comments or resolves it`;
}

export function statusAfterMove(
  current: TaskStatus,
  next: MovableStatus,
  closedAt: string | null,
  now: Date,
): { status: MovableStatus; closedAt: string | null } {
  if (next === "closed") {
    return {
      status: "closed",
      closedAt: current === "closed" && closedAt ? closedAt : now.toISOString(),
    };
  }
  return { status: next, closedAt: null };
}
