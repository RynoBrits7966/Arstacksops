import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FormEvent } from "react";
import { formatWhen } from "../format";
import {
  DETAIL_CATEGORIES,
  DETAIL_CATEGORY_LABEL,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABEL,
  ISSUE_TYPES,
  ISSUE_TYPE_LABEL,
  formatTicketId,
} from "../issues/keys";
import { formatDeadline, isDeadlinePriority } from "../projects";
import { archiveNeedsVisit, formatIdleLeft, latestWorkAt } from "../storage/archive";
import { taskStore } from "../storage/localStore";
import { MOVE_TARGETS, STATUS_LABELS } from "../statuses";
import type {
  Comment,
  DetailCategory,
  IssueSeverity,
  IssueType,
  MovableStatus,
  Platform,
  Project,
  Task,
  User,
} from "../types";
import { Comments } from "./Comments";
import { PlatformField } from "./PlatformField";
import { Screenshots } from "./Screenshots";
import { UserPicker } from "./UserPicker";

export interface IssueLeaveHandle {
  confirmLeave: () => Promise<boolean>;
}

interface IssueDetailsProps {
  task: Task;
  projects: Project[];
  users: User[];
  currentUserId: string;
  comments: Comment[];
  linkedCount: number;
  onClose: () => void;
  onMoved: (status: Task["status"]) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export const IssueDetails = forwardRef<IssueLeaveHandle, IssueDetailsProps>(function IssueDetails({
  task,
  projects,
  users,
  currentUserId,
  comments,
  linkedCount,
  onClose,
  onMoved,
  onRefresh,
}, ref) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [projectId, setProjectId] = useState(task.projectId);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId);
  const [issueType, setIssueType] = useState<IssueType>(task.issueType ?? "review");
  const [platforms, setPlatforms] = useState<Platform[]>(task.platforms ?? []);
  const [issueSeverity, setIssueSeverity] = useState<IssueSeverity | "">(task.issueSeverity ?? "");
  const [steps, setSteps] = useState(task.stepsToReproduce);
  const [expected, setExpected] = useState(task.expectedBehaviour);
  const [actual, setActual] = useState(task.actualBehaviour);
  const [affectedArea, setAffectedArea] = useState(task.affectedArea);
  const [detailCategory, setDetailCategory] = useState<DetailCategory | "">(task.detailCategory ?? "");
  const [checklist, setChecklist] = useState(task.checklist);
  const [checkDraft, setCheckDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateToId, setEscalateToId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description);
    setProjectId(task.projectId);
    setAssigneeId(task.assigneeId);
    setIssueType(task.issueType ?? "review");
    setPlatforms(task.platforms ?? []);
    setIssueSeverity(task.issueSeverity ?? "");
    setSteps(task.stepsToReproduce);
    setExpected(task.expectedBehaviour);
    setActual(task.actualBehaviour);
    setAffectedArea(task.affectedArea);
    setDetailCategory(task.detailCategory ?? "");
    setChecklist(task.checklist);
    setCheckDraft("");
    setError(null);
    setSaving(false);
    setBusy(false);
    setEscalateOpen(false);
  }, [task]);

  useEffect(() => {
    if (task.escalatedToId !== currentUserId || task.escalationSeenAt) return;
    taskStore.markEscalationSeen(task.id, currentUserId).then(() => onRefresh()).catch(() => undefined);
  }, [task.id, task.escalatedToId, task.escalationSeenAt, currentUserId, onRefresh]);

  useEffect(() => {
    if (!archiveNeedsVisit(task)) return;
    taskStore.markArchiveVisited(task.id).then((seen) => {
      if (seen) void onRefresh();
    }).catch(() => undefined);
  }, [task.id, task.status, task.archivedAt, task.archiveVisitedAt, onRefresh]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const project = projects.find((item) => item.id === task.projectId);
  const assignee = users.find((user) => user.id === task.assigneeId);
  const ticketId = formatTicketId(project?.name, task.ticketNumber);
  const dirty =
    title.trim() !== task.title ||
    description.trim() !== task.description ||
    projectId !== task.projectId ||
    assigneeId !== task.assigneeId ||
    (issueType || "review") !== (task.issueType ?? "review") ||
    platforms.join() !== (task.platforms ?? []).join() ||
    (issueSeverity || null) !== task.issueSeverity ||
    steps.trim() !== task.stepsToReproduce ||
    expected.trim() !== task.expectedBehaviour ||
    actual.trim() !== task.actualBehaviour ||
    affectedArea.trim() !== task.affectedArea ||
    (detailCategory || null) !== task.detailCategory ||
    JSON.stringify(checklist) !== JSON.stringify(task.checklist);
  const stateOptions = MOVE_TARGETS.filter(
    (status) => status === task.status || task.acceptedAt !== null || status !== "in_progress",
  );

  async function persistIssue(): Promise<boolean> {
    setError(null);
    setSaving(true);
    try {
      await taskStore.updateTask(task.id, {
        title,
        description,
        projectId,
        assigneeId,
        issueType: issueType || "review",
        platforms,
        issueSeverity: issueSeverity || null,
        stepsToReproduce: steps,
        expectedBehaviour: expected,
        actualBehaviour: actual,
        affectedArea,
        detailCategory: detailCategory || null,
        checklist,
        actorId: currentUserId,
      });
      await onRefresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the issue");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await persistIssue();
  }

  const leaveState = useRef({ dirty: false, saving: false, persistIssue });
  leaveState.current = { dirty, saving, persistIssue };

  useImperativeHandle(ref, () => ({
    confirmLeave: () => {
      if (leaveResolver.current || leaveState.current.saving) return Promise.resolve(false);
      if (!leaveState.current.dirty) return Promise.resolve(true);
      return new Promise((resolve) => {
        leaveResolver.current = resolve;
        setLeaveOpen(true);
      });
    },
  }));

  useEffect(() => () => {
    leaveResolver.current?.(false);
    leaveResolver.current = null;
  }, []);

  useEffect(() => {
    if (!leaveOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setLeaveOpen(false);
      const resolve = leaveResolver.current;
      leaveResolver.current = null;
      resolve?.(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [leaveOpen]);

  function settleLeave(allowed: boolean) {
    setLeaveOpen(false);
    const resolve = leaveResolver.current;
    leaveResolver.current = null;
    resolve?.(allowed);
  }

  async function saveAndLeave() {
    const saved = await leaveState.current.persistIssue();
    settleLeave(saved);
  }

  function chooseStatus(status: MovableStatus) {
    if (status === "escalated") {
      setEscalateToId(task.escalatedToId ?? "");
      setEscalateOpen(true);
      return;
    }
    void moveTo(status);
  }

  async function moveTo(status: MovableStatus) {
    setError(null);
    setBusy(true);
    try {
      await taskStore.updateTask(task.id, { status, actorId: currentUserId });
      await onMoved(status);
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
      await onMoved("escalated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not escalate the issue");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await taskStore.acceptTask(task.id, currentUserId);
      await onMoved("in_progress");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not accept the issue");
      setBusy(false);
    }
  }

  async function remove() {
    const linked =
      linkedCount > 0
        ? ` ${linkedCount} older linked record${linkedCount === 1 ? "" : "s"} stored under it will be removed as well.`
        : "";
    if (!window.confirm(`Delete ${ticketId}? Comments and screenshots go with it.${linked}`)) return;
    setBusy(true);
    try {
      await taskStore.deleteTask(task.id);
      await onRefresh();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the issue");
      setBusy(false);
    }
  }

  function addCheck() {
    const label = checkDraft.trim();
    if (!label) return;
    setChecklist((items) => [...items, { id: crypto.randomUUID(), label, done: false }]);
    setCheckDraft("");
  }

  return (
    <aside className={expanded ? "issue-details is-expanded" : "issue-details"} aria-label="Issue details">
      <form onSubmit={save}>
        <div className="issue-details-head">
          <div className="issue-details-actions">
            <button className="back-link" type="button" onClick={onClose}>
              Close
            </button>
            <button className="quiet" type="button" aria-pressed={expanded} onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Exit full screen" : "Full screen"}
            </button>
          </div>
          <p className="ticket-id ticket-id-large">{ticketId}</p>
          <button className="primary" type="submit" disabled={saving || busy || !dirty}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>
        <div className="issue-meta">
          <label>
            Issue type
            <select value={issueType} onChange={(event) => setIssueType(event.target.value as IssueType)}>
              {ISSUE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ISSUE_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select
              value={issueSeverity}
              onChange={(event) => setIssueSeverity(event.target.value as IssueSeverity | "")}
            >
              <option value="">Not set</option>
              {ISSUE_SEVERITIES.map((level) => (
                <option key={level} value={level}>
                  {ISSUE_SEVERITY_LABEL[level]}
                </option>
              ))}
            </select>
          </label>
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
          <label>
            Assigned to
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} required>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PlatformField value={platforms} onChange={setPlatforms} />
        {task.status !== "archived" && !task.acceptedAt ? (
          currentUserId === task.assigneeId ? (
            <button className="primary compact" type="button" onClick={accept} disabled={busy}>
              Accept
            </button>
          ) : (
            <p className="muted">Switch to {assignee?.name ?? "the assignee"} to accept. That moves it to In Progress.</p>
          )
        ) : null}
        {task.status !== "archived" ? (
          <p className="idle-left">
            {formatIdleLeft(
              latestWorkAt(
                task,
                comments.filter((comment) => comment.taskId === task.id).map((comment) => comment.createdAt),
              ),
            )}
          </p>
        ) : archiveNeedsVisit(task) ? (
          <p className="idle-left">In Archive for 3 days. Opening it clears this mark.</p>
        ) : null}
        <p className={project?.deadline && isDeadlinePriority(project.deadline) ? "due-soon" : "muted"}>
          {project?.client || "Set the client on the project"}
          {" · "}
          {project?.deadline ? `Due ${formatDeadline(project.deadline)}` : "Deadline N/A"}
        </p>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </label>
        {issueType === "bug" ? (
          <div className="issue-extra">
            <h3>Bug details</h3>
            <label>
              Reproduction steps
              <textarea value={steps} onChange={(event) => setSteps(event.target.value)} rows={3} />
            </label>
            <label>
              Expected behaviour
              <textarea value={expected} onChange={(event) => setExpected(event.target.value)} rows={2} />
            </label>
            <label>
              Actual behaviour
              <textarea value={actual} onChange={(event) => setActual(event.target.value)} rows={2} />
            </label>
          </div>
        ) : null}
        {issueType === "ui" ? (
          <div className="issue-extra">
            <h3>UI / Detailing</h3>
            <label>
              Affected page or component
              <input value={affectedArea} onChange={(event) => setAffectedArea(event.target.value)} />
            </label>
            <label>
              Detail category
              <select
                value={detailCategory}
                onChange={(event) => setDetailCategory(event.target.value as DetailCategory | "")}
              >
                <option value="">Choose a category</option>
                {DETAIL_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {DETAIL_CATEGORY_LABEL[category]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="issue-extra">
          <h3>Checklist</h3>
          <ul className="check-list">
            {checklist.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() =>
                      setChecklist((items) =>
                        items.map((entry) => (entry.id === item.id ? { ...entry, done: !entry.done } : entry)),
                      )
                    }
                  />
                  {item.label}
                </label>
                <button
                  className="tiny"
                  type="button"
                  onClick={() => setChecklist((items) => items.filter((entry) => entry.id !== item.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="check-add">
            <input
              value={checkDraft}
              onChange={(event) => setCheckDraft(event.target.value)}
              placeholder="Add a checklist item"
              aria-label="Checklist item"
            />
            <button className="ghost" type="button" onClick={addCheck}>
              Add
            </button>
          </div>
        </div>
        <button className="danger-text" type="button" onClick={remove} disabled={busy}>
          Delete issue
        </button>
      </form>
      <Screenshots taskId={task.id} />
      <Comments taskId={task.id} users={users} currentUserId={currentUserId} onChanged={onRefresh} />
      <section className="issue-extra">
        <h3>Activity</h3>
        {task.activity.length === 0 ? <p className="muted">No activity yet.</p> : null}
        <ul className="activity-list">
          {[...task.activity].reverse().map((entry) => (
            <li key={entry.id}>
              <span>{entry.message}</span>
              <span className="muted">{formatWhen(entry.at)}</span>
            </li>
          ))}
        </ul>
      </section>
      {leaveOpen ? (
        <div className="escalate-layer" role="presentation">
          <div className="escalate-dialog" role="dialog" aria-labelledby="leave-heading">
            <h2 id="leave-heading">Save changes to {ticketId}?</h2>
            <p className="muted">Save or discard these edits before leaving this ticket.</p>
            <div className="dialog-actions">
              <button className="ghost" type="button" onClick={() => settleLeave(false)} disabled={saving}>
                Cancel
              </button>
              <button className="quiet" type="button" onClick={() => settleLeave(true)} disabled={saving}>
                Discard
              </button>
              <button className="primary" type="button" onClick={() => void saveAndLeave()} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {escalateOpen ? (
        <div className="escalate-layer" role="presentation">
          <div className="escalate-dialog" role="dialog" aria-labelledby="escalate-heading">
            <h2 id="escalate-heading">Escalate to</h2>
            <UserPicker
              users={users}
              selectedIds={escalateToId ? [escalateToId] : []}
              onToggle={(user) => setEscalateToId((current) => (current === user.id ? "" : user.id))}
              label="Teammate"
            />
            <div className="dialog-actions">
              <button className="ghost" type="button" onClick={() => setEscalateOpen(false)}>
                Cancel
              </button>
              <button className="primary" type="button" onClick={confirmEscalate} disabled={busy || !escalateToId}>
                Escalate
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
});
