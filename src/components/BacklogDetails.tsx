import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PRIORITIES, PRIORITY_LABEL, TYPE_HINT, TYPE_LABEL, descendantIds, parentChoices } from "../backlog/model";
import { formatWhen } from "../format";
import { archiveNeedsVisit } from "../storage/archive";
import { taskStore } from "../storage/localStore";
import { MOVE_TARGETS, STATUS_LABELS } from "../statuses";
import type { ChecklistItem, Priority, Project, Severity, Task, User } from "../types";
import { Comments } from "./Comments";
import { Screenshots } from "./Screenshots";
import { UserPicker } from "./UserPicker";
import { WorkTypeIcon } from "./WorkTypeIcon";

interface BacklogDetailsProps {
  task: Task;
  tasks: Task[];
  projects: Project[];
  users: User[];
  currentUserId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

interface Draft {
  title: string;
  description: string;
  assigneeId: string;
  parentId: string;
  priority: Priority | "";
  dueDate: string;
  tags: string[];
  storyPoints: string;
  estimateHours: string;
  acceptanceCriteria: string;
  checklist: ChecklistItem[];
  severity: Severity | "";
  environment: string;
  stepsToReproduce: string;
  expectedBehaviour: string;
  actualBehaviour: string;
  githubLinks: string;
}

function draftFrom(task: Task): Draft {
  return {
    title: task.title,
    description: task.description,
    assigneeId: task.assigneeId,
    parentId: task.parentId ?? "",
    priority: task.priority ?? "",
    dueDate: task.dueDate ?? "",
    tags: task.tags,
    storyPoints: task.storyPoints === null ? "" : String(task.storyPoints),
    estimateHours: task.estimateHours === null ? "" : String(task.estimateHours),
    acceptanceCriteria: task.acceptanceCriteria,
    checklist: task.checklist,
    severity: task.severity ?? "",
    environment: task.environment,
    stepsToReproduce: task.stepsToReproduce,
    expectedBehaviour: task.expectedBehaviour,
    actualBehaviour: task.actualBehaviour,
    githubLinks: task.githubLinks.join("\n"),
  };
}

export function BacklogDetails({ task, tasks, projects, users, currentUserId, onClose, onChanged }: BacklogDetailsProps) {
  const [draft, setDraft] = useState(() => draftFrom(task));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateToId, setEscalateToId] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [checkInput, setCheckInput] = useState("");
  const nested = descendantIds(tasks, task.id);
  const needsAccept = task.workItemType === "task" || task.workItemType === "bug";
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftFrom(task));
  const parents = parentChoices(tasks, task.projectId, task.workItemType, task.id);
  const assignee = users.find((user) => user.id === task.assigneeId);
  const project = projects.find((item) => item.id === task.projectId);

  useEffect(() => {
    setDraft(draftFrom(task));
    setSaved(false);
    setConfirmingDelete(false);
    setError(null);
  }, [task.id]);

  useEffect(() => {
    if (!archiveNeedsVisit(task)) return;
    taskStore.markArchiveVisited(task.id).then((seen) => {
      if (seen) void onChanged();
    }).catch(() => undefined);
  }, [task.id, task.status, task.archivedAt, task.archiveVisitedAt, onChanged]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || escalateOpen) return;
      event.preventDefault();
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function requestClose() {
    if (dirty && !window.confirm("Close without saving changes?")) return;
    onClose();
  }

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const savedTask = await taskStore.updateWorkItem(task.id, {
        title: draft.title,
        description: draft.description,
        assigneeId: draft.assigneeId,
        parentId: draft.parentId || null,
        priority: draft.priority || null,
        dueDate: draft.dueDate || null,
        tags: draft.tags,
        storyPoints: draft.storyPoints === "" ? null : Number(draft.storyPoints),
        estimateHours: draft.estimateHours === "" ? null : Number(draft.estimateHours),
        acceptanceCriteria: draft.acceptanceCriteria,
        checklist: draft.checklist,
        severity: draft.severity || null,
        environment: draft.environment,
        stepsToReproduce: draft.stepsToReproduce,
        expectedBehaviour: draft.expectedBehaviour,
        actualBehaviour: draft.actualBehaviour,
        githubLinks: draft.githubLinks.split("\n"),
        actorId: currentUserId,
      });
      setDraft(draftFrom(savedTask));
      setSaved(true);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this work item");
    } finally {
      setBusy(false);
    }
  }

  async function changeState(status: (typeof MOVE_TARGETS)[number]) {
    if (status === "escalated") {
      setEscalateOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await taskStore.updateTask(task.id, { status, actorId: currentUserId });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the state");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEscalate() {
    if (!escalateToId) return;
    setBusy(true);
    setError(null);
    try {
      await taskStore.escalateTask(task.id, escalateToId);
      setEscalateOpen(false);
      setEscalateToId("");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not escalate");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await taskStore.acceptTask(task.id, currentUserId);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not accept");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await taskStore.deleteTask(task.id);
      onClose();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this work item");
      setBusy(false);
    }
  }

  const stateOptions = MOVE_TARGETS.filter(
    (status) => status === task.status || !needsAccept || task.acceptedAt !== null || status !== "in_progress",
  );

  return (
    <aside className="details-panel" aria-label="Work item details">
      <form onSubmit={save}>
        <div className="details-head">
          <p className="details-id">
            <WorkTypeIcon type={task.workItemType} />
            <span title={TYPE_HINT[task.workItemType]}>{TYPE_LABEL[task.workItemType]}</span>
            <span className="id-code">{task.id}</span>
            {project ? <span>{project.name}</span> : null}
          </p>
          <div className="form-actions">
            {saved && !dirty ? (
              <span className="saved-flag" role="status">
                Saved
              </span>
            ) : null}
            {dirty ? <span className="unsaved-flag">Unsaved changes</span> : null}
            <button className="primary" type="submit" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button className="quiet" type="button" onClick={requestClose}>
              Close
            </button>
          </div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <label>
          Title
          <input value={draft.title} onChange={(event) => patch("title", event.target.value)} required />
        </label>
        <div className="form-grid">
          <label>
            State
            <select
              value={task.status === "archived" ? "" : task.status}
              disabled={busy || task.status === "archived"}
              onChange={(event) => changeState(event.target.value as (typeof MOVE_TARGETS)[number])}
            >
              {task.status === "archived" ? <option value="">Archive</option> : null}
              {stateOptions.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select value={draft.assigneeId} onChange={(event) => patch("assigneeId", event.target.value)}>
              {needsAccept ? null : <option value="">Unassigned</option>}
              {needsAccept && !draft.assigneeId ? <option value="">Choose a teammate</option> : null}
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Deadline
            <input type="date" value={draft.dueDate} onChange={(event) => patch("dueDate", event.target.value)} />
          </label>
          <label>
            Priority
            <select
              value={draft.priority}
              onChange={(event) => patch("priority", event.target.value as Priority | "")}
            >
              <option value="">None</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {needsAccept && !task.acceptedAt && task.status !== "archived" ? (
          <div className="form-actions">
            <p className="muted">
              {assignee ? `${assignee.name} needs to accept this before it can move to In Progress.` : "Choose an assignee, then they can accept it."}
            </p>
            {task.assigneeId === currentUserId ? (
              <button className="primary" type="button" onClick={accept} disabled={busy}>
                Accept
              </button>
            ) : null}
          </div>
        ) : null}
        <label>
          Parent
          <select value={draft.parentId} onChange={(event) => patch("parentId", event.target.value)}>
            {task.workItemType === "feature" || task.workItemType === "user_story" ? null : (
              <option value="">No parent — project level</option>
            )}
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {TYPE_LABEL[parent.workItemType]}: {parent.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea value={draft.description} onChange={(event) => patch("description", event.target.value)} rows={4} />
        </label>
        {task.workItemType === "user_story" ? (
          <>
            <label>
              Story points
              <input
                type="number"
                min={0}
                step={1}
                value={draft.storyPoints}
                onChange={(event) => patch("storyPoints", event.target.value)}
              />
            </label>
            <label>
              Acceptance criteria
              <textarea
                value={draft.acceptanceCriteria}
                onChange={(event) => patch("acceptanceCriteria", event.target.value)}
                rows={3}
              />
            </label>
          </>
        ) : null}
        {task.workItemType === "task" || task.workItemType === "bug" ? (
          <label>
            Estimated hours
            <input
              type="number"
              min={0}
              step="0.5"
              value={draft.estimateHours}
              onChange={(event) => patch("estimateHours", event.target.value)}
            />
          </label>
        ) : null}
        {task.workItemType === "bug" ? (
          <fieldset className="bug-fields">
            <legend>Bug details</legend>
            <label>
              Severity
              <select
                value={draft.severity}
                onChange={(event) => patch("severity", event.target.value as Severity | "")}
              >
                <option value="">None</option>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABEL[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Environment
              <input value={draft.environment} onChange={(event) => patch("environment", event.target.value)} />
            </label>
            <label>
              Reproduction steps
              <textarea
                value={draft.stepsToReproduce}
                onChange={(event) => patch("stepsToReproduce", event.target.value)}
                rows={3}
              />
            </label>
            <label>
              Expected behaviour
              <textarea
                value={draft.expectedBehaviour}
                onChange={(event) => patch("expectedBehaviour", event.target.value)}
                rows={2}
              />
            </label>
            <label>
              Actual behaviour
              <textarea
                value={draft.actualBehaviour}
                onChange={(event) => patch("actualBehaviour", event.target.value)}
                rows={2}
              />
            </label>
          </fieldset>
        ) : null}
        <div className="tag-editor">
          <span className="field-label">Tags</span>
          <div className="tag-row">
            {draft.tags.map((tag) => (
              <button
                key={tag}
                className="tag-pill"
                type="button"
                onClick={() => patch("tags", draft.tags.filter((item) => item !== tag))}
              >
                {tag} <span aria-hidden="true">×</span>
                <span className="visually-hidden">Remove tag {tag}</span>
              </button>
            ))}
          </div>
          <input
            value={tagInput}
            placeholder="Add a tag and press Enter"
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const next = tagInput.trim();
              if (!next || draft.tags.includes(next)) return;
              patch("tags", [...draft.tags, next]);
              setTagInput("");
            }}
          />
        </div>
        <div className="checklist">
          <span className="field-label">Checklist</span>
          <ul>
            {draft.checklist.map((item) => (
              <li key={item.id}>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      patch(
                        "checklist",
                        draft.checklist.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)),
                      )
                    }
                  />
                  <span>{item.label}</span>
                </label>
                <button
                  className="quiet tiny"
                  type="button"
                  onClick={() => patch("checklist", draft.checklist.filter((entry) => entry.id !== item.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <input
              value={checkInput}
              placeholder="Add a checklist item"
              onChange={(event) => setCheckInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const label = checkInput.trim();
                if (!label) return;
                patch("checklist", [...draft.checklist, { id: crypto.randomUUID(), label, done: false }]);
                setCheckInput("");
              }}
            />
          </div>
        </div>
        <label>
          GitHub issue or pull request
          <textarea
            value={draft.githubLinks}
            onChange={(event) => patch("githubLinks", event.target.value)}
            rows={2}
            placeholder="https://github.com/…"
          />
        </label>
        <div className="danger-zone">
          {confirmingDelete ? (
            <>
              <p>
                {nested.length > 0
                  ? `Delete “${task.title}” and ${nested.length} item${nested.length === 1 ? "" : "s"} nested under it? Their comments and screenshots are deleted too.`
                  : `Delete “${task.title}”? Its comments and screenshots are deleted too.`}
              </p>
              <div className="form-actions">
                <button className="danger" type="button" onClick={remove} disabled={busy}>
                  Delete
                </button>
                <button className="quiet" type="button" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button className="danger" type="button" onClick={() => setConfirmingDelete(true)}>
              Delete
            </button>
          )}
        </div>
      </form>
      {needsAccept ? <Screenshots taskId={task.id} /> : null}
      <Comments taskId={task.id} users={users} currentUserId={currentUserId} onChanged={onChanged} />
      <section className="activity-log">
        <h2>Activity</h2>
        {task.activity.length === 0 ? <p className="muted">No activity yet.</p> : null}
        <ul>
          {[...task.activity].reverse().map((entry) => {
            const author = users.find((user) => user.id === entry.authorId);
            return (
              <li key={entry.id}>
                <strong>{author?.name ?? "Team"}</strong>
                <span>{entry.message}</span>
                <time dateTime={entry.at}>{formatWhen(entry.at)}</time>
              </li>
            );
          })}
        </ul>
      </section>
      {escalateOpen ? (
        <div className="escalate-layer" role="presentation">
          <div className="escalate-dialog" role="dialog" aria-labelledby="backlog-escalate-heading">
            <h2 id="backlog-escalate-heading">Escalate to</h2>
            <p className="muted">Choose who should see this. They get a mark on Escalated until they open it.</p>
            <UserPicker
              users={users}
              selectedIds={escalateToId ? [escalateToId] : []}
              onToggle={(user) => setEscalateToId(user.id)}
              label="Team members"
            />
            <div className="form-actions">
              <button className="primary" type="button" onClick={confirmEscalate} disabled={busy || !escalateToId}>
                Escalate
              </button>
              <button className="quiet" type="button" onClick={() => setEscalateOpen(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
