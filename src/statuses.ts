import type { MovableStatus, TaskStatus } from "./types";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  resolved: "Resolved",
  escalated: "Escalated",
  closed: "Closed",
  archived: "Archive",
};

export const TAB_ORDER: TaskStatus[] = [
  "new",
  "in_progress",
  "resolved",
  "escalated",
  "closed",
  "archived",
];

export const MOVE_TARGETS: MovableStatus[] = [
  "new",
  "in_progress",
  "resolved",
  "escalated",
  "closed",
];

export const TAB_NOTES: Record<TaskStatus, string> = {
  new: "Just logged. If nobody comments or changes the status for 7 days, it moves to Archive.",
  in_progress: "Someone is working on these. A comment or a status change keeps them here.",
  resolved: "Marked resolved. A comment or a status change starts the 7 days over.",
  escalated: "Hand it to a teammate. They see a mark on it until they open it.",
  closed: "Closed for now. If nobody comments or changes the status for 7 days, it moves to Archive.",
  archived: "Quiet for 7 days. They stay until you delete them. After 3 days here, a mark shows until someone opens the ticket.",
};
