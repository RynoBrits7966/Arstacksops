import type { DetailCategory, IssueSeverity, IssueType, Platform, Project, Task, WorkItemType } from "../types";

export const ISSUE_TYPES: IssueType[] = ["bug", "ui", "improvement", "new_feature", "question", "review"];

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  bug: "Bug",
  ui: "UI / Detailing",
  improvement: "Improvement",
  new_feature: "New Feature",
  question: "Question/Clarification",
  review: "Review",
};

/** Label for a stored type. Older unset records use the Review name. */
export function issueTypeLabel(type: IssueType | null): string {
  return type ? ISSUE_TYPE_LABEL[type] : ISSUE_TYPE_LABEL.review;
}

export const PLATFORMS: Platform[] = ["web", "backend", "ios", "android"];

export const PLATFORM_LABEL: Record<Platform, string> = {
  web: "Web",
  backend: "Backend",
  ios: "iOS",
  android: "Android",
};

export function isPlatform(value: unknown): value is Platform {
  return value === "web" || value === "backend" || value === "ios" || value === "android";
}

/** Keep known platforms, in the standard order, with no duplicates. */
export function cleanPlatforms(value: unknown): Platform[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter(isPlatform));
  return PLATFORMS.filter((platform) => chosen.has(platform));
}

export const ISSUE_SEVERITIES: IssueSeverity[] = ["critical", "major", "minor"];

export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
};

export const DETAIL_CATEGORIES: DetailCategory[] = [
  "spacing",
  "alignment",
  "typography",
  "colour",
  "sizing",
  "responsiveness",
  "other",
];

export const DETAIL_CATEGORY_LABEL: Record<DetailCategory, string> = {
  spacing: "Spacing",
  alignment: "Alignment",
  typography: "Typography",
  colour: "Colour",
  sizing: "Sizing",
  responsiveness: "Responsiveness",
  other: "Other",
};

export function isIssueType(value: unknown): value is IssueType {
  return (
    value === "bug" ||
    value === "ui" ||
    value === "improvement" ||
    value === "new_feature" ||
    value === "question" ||
    value === "review"
  );
}

export function isIssueSeverity(value: unknown): value is IssueSeverity {
  return value === "critical" || value === "major" || value === "minor";
}

export function isDetailCategory(value: unknown): value is DetailCategory {
  return (
    value === "spacing" ||
    value === "alignment" ||
    value === "typography" ||
    value === "colour" ||
    value === "sizing" ||
    value === "responsiveness" ||
    value === "other"
  );
}

/** Map a stored work-item type onto the flat issue type. A chosen issue type is left alone. */
export function resolveIssueType(
  current: unknown,
  workItemType: WorkItemType,
): { value: IssueType | null; changed: boolean } {
  if (isIssueType(current)) return { value: current, changed: false };
  if (current === null) return { value: "review", changed: true };
  if (workItemType === "bug") return { value: "bug", changed: true };
  if (workItemType === "task") return { value: "improvement", changed: true };
  return { value: "review", changed: true };
}

/** Keep Critical, Major, or Minor. Anything else, including the older scale, stays unset. */
export function resolveIssueSeverity(current: unknown): { value: IssueSeverity | null; changed: boolean } {
  if (isIssueSeverity(current) || current === null) return { value: current, changed: false };
  return { value: null, changed: true };
}

export function formatTicketId(projectName: string | undefined, ticketNumber: number): string {
  const name = projectName?.trim() || "Project";
  const number = Number.isInteger(ticketNumber) && ticketNumber > 0 ? ticketNumber : 0;
  return `${name}-${number}`;
}

export function nextTicketNumber(
  tasks: Pick<Task, "id" | "projectId" | "ticketNumber">[],
  projectId: string,
  exceptIds?: Set<string>,
): number {
  let max = 0;
  for (const task of tasks) {
    if (task.projectId !== projectId || exceptIds?.has(task.id)) continue;
    if (Number.isInteger(task.ticketNumber) && task.ticketNumber > max) max = task.ticketNumber;
  }
  return max + 1;
}

/** Fill missing ticket numbers per project. Existing numbers are kept, so this can run again. */
export function assignTicketNumbers(tasks: Task[]): boolean {
  let changed = false;
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const group = groups.get(task.projectId) ?? [];
    group.push(task);
    groups.set(task.projectId, group);
  }
  for (const group of groups.values()) {
    const used = new Set<number>();
    for (const task of group) {
      if (Number.isInteger(task.ticketNumber) && task.ticketNumber > 0) used.add(task.ticketNumber);
    }
    const missing = group
      .filter((task) => !(Number.isInteger(task.ticketNumber) && task.ticketNumber > 0))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    let number = 1;
    for (const task of missing) {
      while (used.has(number)) number += 1;
      task.ticketNumber = number;
      used.add(number);
      number += 1;
      changed = true;
    }
  }
  return changed;
}

export function projectName(projects: Project[], projectId: string): string {
  return projects.find((project) => project.id === projectId)?.name ?? "Project";
}
