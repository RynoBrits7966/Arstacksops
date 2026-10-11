import type { IssueSeverity, IssueType, Task } from "../types";

export interface CountRow {
  id: string;
  label: string;
  count: number;
  tone: IssueType | IssueSeverity | "unset";
}

const TYPE_ROWS: { id: IssueType; label: string; tone: CountRow["tone"] }[] = [
  { id: "bug", label: "Bugs", tone: "bug" },
  { id: "ui", label: "UI / Detailing", tone: "ui" },
  { id: "improvement", label: "Improvements", tone: "improvement" },
  { id: "new_feature", label: "New features", tone: "new_feature" },
  { id: "question", label: "Questions / Clarifications", tone: "question" },
  { id: "review", label: "Review", tone: "review" },
];

const SEVERITY_ROWS: { id: IssueSeverity | "unset"; label: string; tone: CountRow["tone"] }[] = [
  { id: "critical", label: "Critical", tone: "critical" },
  { id: "major", label: "Major", tone: "major" },
  { id: "minor", label: "Minor", tone: "minor" },
  { id: "unset", label: "Not set", tone: "unset" },
];

export function typeCounts(tasks: Task[]): CountRow[] {
  return TYPE_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    tone: row.tone,
    count: tasks.filter((task) => (row.id === "review" ? task.issueType === "review" || task.issueType === null : task.issueType === row.id)).length,
  }));
}

export function severityCounts(tasks: Task[]): CountRow[] {
  return SEVERITY_ROWS.map((row) => ({
    id: row.id,
    label: row.label,
    tone: row.tone,
    count: tasks.filter((task) => (row.id === "unset" ? task.issueSeverity === null : task.issueSeverity === row.id)).length,
  }));
}

export function busiestLabel(rows: CountRow[]): string | null {
  const ranked = [...rows].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const top = ranked[0];
  if (!top || top.count === 0) return null;
  const tied = ranked.filter((row) => row.count === top.count);
  if (tied.length > 1) return `${tied.map((row) => row.label).join(" and ")} are tied at ${top.count}.`;
  return `${top.label} has the most, with ${top.count}.`;
}
