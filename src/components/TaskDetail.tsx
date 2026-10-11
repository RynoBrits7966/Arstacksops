import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Comments } from "./Comments";
import { Screenshots } from "./Screenshots";
import { UserPicker } from "./UserPicker";
import { formatDay, formatWhen } from "../format";
import { formatDeadline, isDeadlinePriority } from "../projects";
import { formatIdleLeft, latestWorkAt } from "../storage/archive";
import { taskStore } from "../storage/localStore";
import { MOVE_TARGETS, STATUS_LABELS } from "../statuses";
import type { Comment, MovableStatus, Project, Task, TaskStatus, User } from "../types";

interface TaskDetailProps {
  task: Task;
  projects: Project[];
  users: User[];
  currentUserId: string;
  commentCount: number;
  comments: Comment[];
  nestedCount: number;
  onBack: () => void;
  onMoved: (status: TaskStatus) => Promise<void>;
  onDeleted: () => Promise<void>;
  onActivity: () => Promise<void>;
}

const FORM_ID = "work-item-form";

export function TaskDetail({
  task,
  projects,
  users,
  currentUserId,
  commentCount,
  comments,
  nestedCount,
  onBack,
  onMoved,
  onDeleted,
  onActivity,
}: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [projectId, setProjectId] = useState(task.projectId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateToId, setEscalateToId] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setProjectId(task.projectId);
    setConfirmingDelete(false);
    setEscalateOpen(false);
    setBusy(false);
    setError(null);
  }, [task]);

  useEffect(() => {
    if (task.escalatedToId !== currentUserId || task.escalationSeenAt) return;
    let cancelled = false;
    taskStore
      .markEscalationSeen(task.id, currentUserId)
      .then((changed) => {
        if (!cancelled && changed) return onActivity();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [task.id, task.escalatedToId, task.escalationSeenAt, currentUserId, onActivity]);

  const project = projects.find((item) => item.id === task.projectId);
  const selectedProject = projects.find((item) => item.id === projectId) ?? project;
  const assignee = users.find((user) => user.id === task.assigneeId);
  const escalatedTo = users.find((user) => user.id === task.escalatedToId);
  const dirty =
    title.trim() !== task.title ||
    description.trim() !== task.description ||
    projectId !== task.projectId;
  const stateOptions = MOVE_TARGETS.filter(
    (status) => status === task.status || task.acceptedAt !== null || status !== "in_progress",
  );
  const commentLabel = commentCount === 1 ? "1 comment" : `${commentCount} comments`;

  async function saveDetails(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await taskStore.updateTask(task.id, { title, description, projectId, actorId: currentUserId });
      await onMoved(task.status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the task");
    } finally {
      setSaving(false);
    }
  }

  function chooseStatus(status: MovableStatus) {
    if (status === "escalated") {
      setEscalateToId(task.escalatedToId ?? "");
      setEscalateOpen(true);
      return;
    }
    void moveTo(status);
  }

  async function confirmEscalate() {
    if (!escalateToId) return;
    setError(null);
    setBusy(true);
    try {
      await taskStore.escalateTask(task.id, escalateToId);
      setEscalateOpen(false);
      await onMoved("escalated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not escalate the task");
    } finally {
      setBusy(false);
    }
  }

  async function moveTo(status: MovableStatus) {
    if (status === task.status) return;
    setError(null);
    setBusy(true);
    try {
      await taskStore.updateTask(task.id, { status, actorId: currentUserId });
      await onMoved(status);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not move the task");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      await taskStore.acceptTask(task.id, currentUserId);
      await onMoved("in_progress");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not accept the task");
      setBusy(false);
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await taskStore.deleteTask(task.id);
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the task");
      setBusy(false);
    }
  }

  return (
    <article className="work-item">
      <form id={FORM_ID} onSubmit={saveDetails} />
      <div className="work-top">
        <button className="back-link" type="button" onClick={onBack}>
          ← Back to work items
        </button>
        <div className="work-titlebar">
          <span className="type-mark" style={{ background: project?.color ?? "#eb8536" }} />
          <div className="work-title-block">
            <span className="type-label">Task</span>
            <input
              className="work-title"
              form={FORM_ID}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              aria-label="Title"
            />
            <p className="work-sub">
              {selectedProject?.client || "Set the client on the project"}
              {" · "}
              {assignee ? `@${assignee.name}` : "No one tagged"}
              {" · "}
              {task.acceptedAt ? "Accepted" : "Waiting to accept"}
              {" · "}
              {commentLabel}
            </p>
            {task.status !== "archived" ? (
              <p className="idle-left">
                {formatIdleLeft(
                  latestWorkAt(
                    task,
                    comments.filter((comment) => comment.taskId === task.id).map((comment) => comment.createdAt),
                  ),
                )}
              </p>
            ) : null}
          </div>
          <button className="primary" type="submit" form={FORM_ID} disabled={saving || busy || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="meta-grid">
          <label>
            State
            {task.status === "archived" ? (
              <span className="meta-value">Archive</span>
            ) : (
              <select
                value={task.status}
                disabled={busy}
                onChange={(event) => chooseStatus(event.target.value as MovableStatus)}
              >
                {stateOptions.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            )}
          </label>
          <div className="meta-field">
            <span className="meta-name">Client</span>
            <span className="meta-value">{selectedProject?.client || "Set this on the project"}</span>
          </div>
          <label>
            Project
            <select
              form={FORM_ID}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="meta-field">
            <span className="meta-name">Assigned</span>
            <span className="meta-value">@{assignee?.name ?? "someone"}</span>
            {task.status !== "archived" && !task.acceptedAt ? (
              currentUserId === task.assigneeId ? (
                <button className="primary compact" type="button" onClick={accept} disabled={busy}>
                  Accept
                </button>
              ) : (
                <span className="muted">Switch to {assignee?.name ?? "that teammate"} to accept.</span>
              )
            ) : null}
          </div>
          <div className="meta-field">
            <span className="meta-name">Deadline</span>
            <span
              className={
                selectedProject?.deadline && isDeadlinePriority(selectedProject.deadline)
                  ? "meta-value due-soon"
                  : "meta-value"
              }
            >
              {selectedProject?.deadline ? formatDeadline(selectedProject.deadline) : "N/A"}
            </span>
          </div>
        </div>
      </div>

      <div className="work-main">
        <section className="block">
          <h2>Description</h2>
          <textarea
            form={FORM_ID}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={6}
            placeholder="What is going on, and what should the teammate know?"
          />
        </section>
        <Comments
          taskId={task.id}
          users={users}
          currentUserId={currentUserId}
          onChanged={onActivity}
        />
      </div>

      <aside className="work-rail">
        <section className="block">
          <h2>Planning</h2>
          <dl className="facts">
            <div>
              <dt>Created</dt>
              <dd>{formatWhen(task.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatWhen(task.updatedAt)}</dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>
                {task.acceptedAt && assignee
                  ? `${formatWhen(task.acceptedAt)} by @${assignee.name}`
                  : "Not yet"}
              </dd>
            </div>
            {task.status === "escalated" && escalatedTo ? (
              <div>
                <dt>Escalated to</dt>
                <dd>
                  @{escalatedTo.name}
                  {task.escalationSeenAt ? "" : " has not opened this yet"}
                </dd>
              </div>
            ) : null}
            {task.status !== "archived" ? (
              <div>
                <dt>Archive</dt>
                <dd className="idle-left">
                  {formatIdleLeft(
                    latestWorkAt(
                      task,
                      comments.filter((comment) => comment.taskId === task.id).map((comment) => comment.createdAt),
                    ),
                  )}
                </dd>
              </div>
            ) : null}
            {task.status === "archived" && task.closedAt ? (
              <div>
                <dt>Closed</dt>
                <dd>{formatDay(task.closedAt)}</dd>
              </div>
            ) : null}
          </dl>
          {task.status === "archived" ? (
            <div className="rail-actions">
              <p className="muted">This task stays in Archive until you delete it.</p>
              {confirmingDelete ? (
                <div className="form-actions">
                  <p className="muted">
                    {nestedCount > 0
                      ? `This deletes the archived ticket and ${nestedCount} item${nestedCount === 1 ? "" : "s"} nested under it, including their comments and screenshots.`
                      : "This deletes the archived ticket, including its comments and screenshots."}
                  </p>
                  <button className="danger" type="button" onClick={remove} disabled={busy}>
                    Delete task
                  </button>
                  <button
                    className="quiet"
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="danger" type="button" onClick={() => setConfirmingDelete(true)}>
                  Delete from Archive
                </button>
              )}
            </div>
          ) : null}
        </section>
        <Screenshots taskId={task.id} />
      </aside>
      {escalateOpen ? (
        <div className="escalate-layer" role="presentation">
          <div className="escalate-dialog" role="dialog" aria-labelledby="escalate-heading">
            <h2 id="escalate-heading">Escalate to</h2>
            <p className="muted">Choose who should see this. They get a mark on Escalated until they open it.</p>
            <UserPicker
              users={users}
              selectedIds={escalateToId ? [escalateToId] : []}
              onToggle={(user) => setEscalateToId(user.id)}
              label="Team members"
            />
            <div className="form-actions">
              <button className="primary" type="button" onClick={confirmEscalate} disabled={busy || !escalateToId}>
                {busy ? "Saving…" : "Escalate"}
              </button>
              <button className="quiet" type="button" onClick={() => setEscalateOpen(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
