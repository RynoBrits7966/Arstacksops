import { taskStore } from "../storage/localStore";
import type { Attachment, Project, Task, User } from "../types";
import { buildReportXlsx, workbookFilename, type ReportPhoto } from "./reportXlsx";

export async function buildScopedWorkbook(input: {
  projects: Project[];
  tasks: Task[];
  users: User[];
  allProjects: boolean;
}): Promise<{ filename: string; bytes: Uint8Array }> {
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const attachments = (await taskStore.listAllAttachments()).filter((item) => taskIds.has(item.taskId));
  const photos = await Promise.all(attachments.map(toPhoto));
  return {
    filename: workbookFilename(input.allProjects || input.projects.length !== 1 ? null : (input.projects[0]?.name ?? null)),
    bytes: buildReportXlsx({ projects: input.projects, tasks: input.tasks, users: input.users, photos }),
  };
}

async function toPhoto(attachment: Attachment): Promise<ReportPhoto> {
  return {
    taskId: attachment.taskId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    createdAt: attachment.createdAt,
    bytes: new Uint8Array(await attachment.blob.arrayBuffer()),
  };
}
