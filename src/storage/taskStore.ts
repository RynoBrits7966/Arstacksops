import type {
  Attachment,
  Comment,
  DetailCategory,
  IssueSeverity,
  IssueType,
  MovableStatus,
  Platform,
  Project,
  Task,
  User,
  VoiceNote,
} from "../types";

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: MovableStatus;
  projectId?: string;
  assigneeId?: string;
  issueType?: IssueType | null;
  platforms?: Platform[];
  issueSeverity?: IssueSeverity | null;
  affectedArea?: string;
  detailCategory?: DetailCategory | null;
  stepsToReproduce?: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  checklist?: Task["checklist"];
  /** Person currently chosen in Working as. Not an account login. */
  actorId?: string;
}

export interface ProjectInput {
  name: string;
  color: string;
  client: string;
  deadline: string | null;
}

/**
 * The only storage API the screens use.
 * A later database can replace the browser implementation of this interface.
 */
export interface TaskStore {
  seedDemo(): Promise<void>;
  listUsers(): Promise<User[]>;
  listProjects(): Promise<Project[]>;
  createProject(input: ProjectInput): Promise<Project>;
  updateProject(id: string, patch: ProjectInput): Promise<Project>;
  listTasks(): Promise<Task[]>;
  createTask(input: {
    title: string;
    description: string;
    projectId: string;
    assigneeId: string;
  }): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  acceptTask(id: string, userId: string): Promise<Task>;
  escalateTask(id: string, userId: string): Promise<Task>;
  markEscalationSeen(id: string, userId: string): Promise<boolean>;
  markArchiveVisited(id: string, now?: Date): Promise<boolean>;
  listAllComments(): Promise<Comment[]>;
  listComments(taskId: string): Promise<Comment[]>;
  addComment(
    taskId: string,
    input: { body: string; authorId: string; mentionIds: string[]; voice: VoiceNote | null },
  ): Promise<Comment>;
  markMentionsRead(taskId: string, userId: string): Promise<boolean>;
  listAttachments(taskId: string): Promise<Attachment[]>;
  addAttachment(taskId: string, file: File): Promise<Attachment>;
  deleteTask(id: string): Promise<void>;
  archiveExpired(now?: Date): Promise<void>;
}
