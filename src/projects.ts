import type { Project } from "./types";

export const PROJECT_COLORS = [
  "#eb8536",
  "#3d7ea6",
  "#2f7d4a",
  "#c23b4a",
  "#6b4c9a",
  "#c9a227",
  "#1f7a8c",
  "#d46a8a",
];

export function isColorTaken(used: string[], color: string): boolean {
  const needle = color.trim().toLowerCase();
  return used.some((item) => item.trim().toLowerCase() === needle);
}

export function nextProjectColor(used: string[]): string {
  const free = PROJECT_COLORS.find((color) => !isColorTaken(used, color));
  if (free) return free;
  let n = 0;
  while (isColorTaken(used, `#${n.toString(16).padStart(6, "0")}`)) n += 1;
  return `#${n.toString(16).padStart(6, "0")}`;
}

export function isSignedOff(project: Pick<Project, "signOff">): boolean {
  return project.signOff != null;
}

export function sortProjects<T extends Pick<Project, "name" | "deadline">>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    if (a.deadline && b.deadline) {
      const byDate = a.deadline.localeCompare(b.deadline);
      return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
    }
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function formatDeadline(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${date}`;
}

export function isPastDeadline(day: string, now = new Date()): boolean {
  return day < todayKey(now);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tickets for a project this close to its deadline, including overdue, sort first and show in red. */
export const DEADLINE_PRIORITY_DAYS = 10;

export function daysUntilDeadline(day: string, now = new Date()): number {
  const [year, month, date] = day.split("-").map(Number);
  const deadline = new Date(year, month - 1, date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((deadline.getTime() - today.getTime()) / DAY_MS);
}

export function isDeadlinePriority(day: string | null, now = new Date()): boolean {
  if (!day) return false;
  return daysUntilDeadline(day, now) <= DEADLINE_PRIORITY_DAYS;
}

/** Negative when `a` should appear above `b`. Deadlines outside the priority window stay in their usual order. */
export function compareDeadlinePriority(
  a: string | null,
  b: string | null,
  now = new Date(),
): number {
  const rank = (day: string | null) =>
    day && isDeadlinePriority(day, now) ? daysUntilDeadline(day, now) : null;
  const aRank = rank(a);
  const bRank = rank(b);
  if (aRank === null && bRank === null) return 0;
  if (aRank === null) return 1;
  if (bRank === null) return -1;
  return aRank - bRank;
}
