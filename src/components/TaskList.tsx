import { formatIdleLeft, latestWorkAt } from "../storage/archive";
import { formatDay, formatWhen } from "../format";
import { formatDeadline, isDeadlinePriority } from "../projects";
import { STATUS_LABELS } from "../statuses";
import type { Comment, Project, Task, User } from "../types";

interface TaskListProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  currentUserId: string;
  comments: Comment[];
  unreadTaskIds: Set<string>;
  emptyLabel: string;
  onOpen: (id: string) => void;
}

export function TaskList({
  tasks,
  projects,
  users,
  currentUserId,
  comments,
  unreadTaskIds,
  emptyLabel,
  onOpen,
}: TaskListProps) {
  if (tasks.length === 0) {
    return <p className="empty">{emptyLabel}</p>;
  }

  return (
    <div className="wi-table">
      <div className="wi-head">
        <span>Title</span>
        <span>State</span>
        <span>Client</span>
        <span>Assigned</span>
        <span>Project</span>
        <span>Updated</span>
      </div>
      <ul className="task-list">
        {tasks.map((task) => {
          const project = projects.find((item) => item.id === task.projectId);
          const assignee = users.find((user) => user.id === task.assigneeId);
          const unread = unreadTaskIds.has(task.id);
          const escalatedTo = users.find((user) => user.id === task.escalatedToId);
          const waitingOnYou =
            task.status === "escalated" &&
            task.escalatedToId === currentUserId &&
            !task.escalationSeenAt;
          const updated =
            task.status === "archived" && task.closedAt
              ? `Closed ${formatDay(task.closedAt)}`
              : formatWhen(task.updatedAt);
          const dueSoon = project?.deadline ? isDeadlinePriority(project.deadline) : false;
          const workedAt = latestWorkAt(
            task,
            comments.filter((comment) => comment.taskId === task.id).map((comment) => comment.createdAt),
          );
          return (
            <li key={task.id}>
              <button
                className={dueSoon ? "task-row priority" : "task-row"}
                type="button"
                onClick={() => onOpen(task.id)}
              >
                <span className="task-title">
                  <span className="type-mark" style={{ background: project?.color ?? "#eb8536" }} />
                  {task.title}
                  {unread || waitingOnYou ? (
                    <span
                      className="bang"
                      title={
                        waitingOnYou
                          ? "This was escalated to you"
                          : "A tagged teammate has not read a comment"
                      }
                    >
                      !
                    </span>
                  ) : null}
                </span>
                <span className="status-pill">{STATUS_LABELS[task.status]}</span>
                <span className="task-client">{project?.client || "—"}</span>
                <span className="task-assignee">
                  {assignee
                    ? task.acceptedAt
                      ? `@${assignee.name}`
                      : `Waiting @${assignee.name}`
                    : "—"}
                </span>
                <span className="task-project">
                  {project?.name ?? "No project"}
                  <span className={dueSoon ? "due-soon" : "muted"}>
                    {project ? (project.deadline ? formatDeadline(project.deadline) : "N/A") : ""}
                  </span>
                </span>
                <span className="task-meta">
                  {updated}
                  {escalatedTo ? <span>To @{escalatedTo.name}</span> : null}
                  {task.status !== "archived" ? (
                    <span className="idle-left">{formatIdleLeft(workedAt)}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
