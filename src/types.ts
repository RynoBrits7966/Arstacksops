export type TaskStatus =
  | "new"
  | "in_progress"
  | "resolved"
  | "escalated"
  | "closed"
  | "archived";

export type MovableStatus = Exclude<TaskStatus, "archived">;

export interface Project {
  id: string;
  name: string;
  color: string;
  client: string;
  /** Calendar day YYYY-MM-DD, or null when the deadline is N/A. */
  deadline: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
}

export type WorkItemType = "epic" | "feature" | "user_story" | "task" | "bug";

export type Priority = "low" | "medium" | "high" | "critical";

/** Older bug scale. Kept on stored records and not shown as the issue severity. */
export type Severity = "low" | "medium" | "high" | "critical";

export type IssueType = "bug" | "ui" | "improvement" | "new_feature" | "question" | "review";

export type IssueSeverity = "critical" | "major" | "minor";

/** Where the issue shows up. A ticket can be on more than one. */
export type Platform = "web" | "backend" | "ios" | "android";

export type DetailCategory =
  | "spacing"
  | "alignment"
  | "typography"
  | "colour"
  | "sizing"
  | "responsiveness"
  | "other";

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface ActivityEntry {
  id: string;
  at: string;
  authorId: string;
  message: string;
}

export interface Task {
  id: string;
  projectId: string;
  assigneeId: string;
  acceptedAt: string | null;
  /** Teammate chosen when the ticket moves to Escalated. */
  escalatedToId: string | null;
  /** Set when that teammate opens the ticket. */
  escalationSeenAt: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** Last comment, screenshot, or status change. Title edits do not reset the archive clock. */
  lastWorkedAt: string;
  closedAt: string | null;
  /** Project-scoped sequence. Shown with the project name, for example Billing-1. */
  ticketNumber: number;
  /** Flat classification. Older unset records are shown as Review. */
  issueType: IssueType | null;
  /** Web, backend, iOS, Android. Empty on tickets logged before this field existed. */
  platforms: Platform[];
  /** When the ticket entered Archive. */
  archivedAt: string | null;
  /** Set when someone opens an Archive ticket that has been waiting 3 days. */
  archiveVisitedAt: string | null;
  /** Critical, major, or minor. Null when it has not been set. */
  issueSeverity: IssueSeverity | null;
  /** Page or component for a UI / Detailing issue. */
  affectedArea: string;
  detailCategory: DetailCategory | null;
  workItemType: WorkItemType;
  parentId: string | null;
  order: number;
  tags: string[];
  priority: Priority | null;
  /** Item deadline YYYY-MM-DD, separate from the project deadline. */
  dueDate: string | null;
  storyPoints: number | null;
  estimateHours: number | null;
  acceptanceCriteria: string;
  checklist: ChecklistItem[];
  activity: ActivityEntry[];
  severity: Severity | null;
  environment: string;
  stepsToReproduce: string;
  expectedBehaviour: string;
  actualBehaviour: string;
  githubLinks: string[];
}

export interface VoiceNote {
  mimeType: string;
  blob: Blob;
  durationMs: number;
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  readByIds: string[];
  voice: VoiceNote | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  createdAt: string;
  blob: Blob;
}
