import type { Snapshot } from "../src/storage/snapshot";
import type { ProjectSignOff } from "../src/types";

export type SnapshotChange =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; reason: "missing" | "already-signed-off" | "already-active" };

export function guardProjectWrite(previous: Snapshot, incoming: Snapshot): Snapshot {
  const incomingIds = new Set(incoming.projects.map((project) => project.id));
  const removed = previous.projects.find((project) => !incomingIds.has(project.id));
  if (removed) {
    throw new Error("A project can only be removed with Delete project.");
  }
  const stored = new Map(previous.projects.map((project) => [project.id, project.signOff ?? null]));
  return {
    ...incoming,
    projects: incoming.projects.map((project) => ({
      ...project,
      signOff: stored.has(project.id) ? (stored.get(project.id) ?? null) : null,
    })),
  };
}

export function removeProject(snapshot: Snapshot, projectId: string): SnapshotChange {
  if (!snapshot.projects.some((project) => project.id === projectId)) {
    return { ok: false, reason: "missing" };
  }
  const taskIds = new Set(snapshot.tasks.filter((task) => task.projectId === projectId).map((task) => task.id));
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      projects: snapshot.projects.filter((project) => project.id !== projectId),
      tasks: snapshot.tasks.filter((task) => task.projectId !== projectId),
      comments: snapshot.comments.filter((comment) => !taskIds.has(comment.taskId)),
      attachments: snapshot.attachments.filter((attachment) => !taskIds.has(attachment.taskId)),
    },
  };
}

export function signOffProject(snapshot: Snapshot, projectId: string, signOff: ProjectSignOff): SnapshotChange {
  const project = snapshot.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, reason: "missing" };
  if (project.signOff) return { ok: false, reason: "already-signed-off" };
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      projects: snapshot.projects.map((item) => (item.id === projectId ? { ...item, signOff } : item)),
    },
  };
}

export function reopenProject(snapshot: Snapshot, projectId: string): SnapshotChange {
  const project = snapshot.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, reason: "missing" };
  if (!project.signOff) return { ok: false, reason: "already-active" };
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      projects: snapshot.projects.map((item) => (item.id === projectId ? { ...item, signOff: null } : item)),
    },
  };
}
