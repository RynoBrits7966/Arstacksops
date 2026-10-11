import { ISSUE_SEVERITIES, PLATFORM_LABEL, issueTypeLabel } from "./keys";
import { TAB_ORDER } from "../statuses";
import type { Project, Task, User } from "../types";

export const ISSUE_COLUMNS = [
  { id: "title", label: "Title" },
  { id: "issueType", label: "Issue Type" },
  { id: "platform", label: "Platform" },
  { id: "severity", label: "Severity" },
  { id: "state", label: "State" },
  { id: "assignee", label: "Assigned To" },
  { id: "project", label: "Project" },
  { id: "updated", label: "Updated" },
] as const;

export type IssueColumn = (typeof ISSUE_COLUMNS)[number]["id"];

export interface IssueSort {
  column: IssueColumn;
  direction: "asc" | "desc";
}

export function isIssueColumn(value: unknown): value is IssueColumn {
  return ISSUE_COLUMNS.some((column) => column.id === value);
}

/** Compare two issues for a header click. Blank values stay at the bottom in both directions. */
export function compareIssues(
  a: Task,
  b: Task,
  sort: IssueSort,
  projects: Project[],
  users: User[],
): number {
  const left = sortKey(a, sort.column, projects, users);
  const right = sortKey(b, sort.column, projects, users);
  if (left.empty !== right.empty) return left.empty ? 1 : -1;
  let result = 0;
  if (left.value < right.value) result = -1;
  else if (left.value > right.value) result = 1;
  else result = a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  if (sort.direction === "desc" && !left.empty && !right.empty) return -result;
  return result;
}

function sortKey(
  task: Task,
  column: IssueColumn,
  projects: Project[],
  users: User[],
): { empty: boolean; value: string | number } {
  switch (column) {
    case "title":
      return { empty: false, value: task.title.toLocaleLowerCase() };
    case "issueType":
      return { empty: false, value: issueTypeLabel(task.issueType).toLocaleLowerCase() };
    case "platform": {
      const text = (task.platforms ?? []).map((platform) => PLATFORM_LABEL[platform]).join(", ");
      return { empty: text === "", value: text.toLocaleLowerCase() };
    }
    case "severity":
      return task.issueSeverity
        ? { empty: false, value: ISSUE_SEVERITIES.indexOf(task.issueSeverity) }
        : { empty: true, value: 0 };
    case "state":
      return { empty: false, value: TAB_ORDER.indexOf(task.status) };
    case "assignee": {
      const name = users.find((user) => user.id === task.assigneeId)?.name ?? "";
      return { empty: name === "", value: name.toLocaleLowerCase() };
    }
    case "project": {
      const name = projects.find((project) => project.id === task.projectId)?.name ?? "";
      return { empty: name === "", value: name.toLocaleLowerCase() };
    }
    case "updated":
      return { empty: false, value: task.updatedAt };
  }
}
