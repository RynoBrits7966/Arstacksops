import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { TYPE_HINT, TYPE_LABEL, WORK_ITEM_TYPES, parentChoices, parentError } from "../backlog/model";
import { taskStore } from "../storage/localStore";
import type { Priority, Project, Task, User, WorkItemType } from "../types";
import { WorkTypeIcon } from "./WorkTypeIcon";

interface CreateWorkItemProps {
  projects: Project[];
  tasks: Task[];
  users: User[];
  defaultProjectId: string;
  presetParentId: string | null;
  actorId: string;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}

export function CreateWorkItem({
  projects,
  tasks,
  users,
  defaultProjectId,
  presetParentId,
  actorId,
  onClose,
  onCreated,
}: CreateWorkItemProps) {
  const titleId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const preset = presetParentId ? tasks.find((task) => task.id === presetParentId) ?? null : null;
  const initialType: WorkItemType = preset?.workItemType === "user_story" ? "task" : preset?.workItemType === "feature" ? "user_story" : preset?.workItemType === "epic" ? "feature" : "task";
  const [workItemType, setWorkItemType] = useState<WorkItemType>(initialType);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(preset?.projectId || defaultProjectId || projects[0]?.id || "");
  const [dueDate, setDueDate] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [description, setDescription] = useState("");
  const [parentId, setParentId] = useState(presetParentId ?? "");
  const [priority, setPriority] = useState<Priority | "">("");
  const [tags, setTags] = useState("");
  const [storyPoints, setStoryPoints] = useState("");
  const [estimateHours, setEstimateHours] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const typeOptions = preset ? childTypes(preset.workItemType) : WORK_ITEM_TYPES;
  const needsParent = workItemType === "feature" || workItemType === "user_story";
  const parents = parentChoices(tasks, projectId, workItemType);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const chosenParent = parentId ? tasks.find((task) => task.id === parentId) ?? null : null;
    const parentMessage = parentError(workItemType, chosenParent, projectId);
    if (parentMessage) {
      setError(parentMessage);
      return;
    }
    setBusy(true);
    try {
      const created = await taskStore.createWorkItem({
        workItemType,
        title,
        projectId,
        assigneeId,
        dueDate: dueDate || null,
        parentId: parentId || null,
        description,
        priority: priority || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        storyPoints: storyPoints === "" ? null : Number(storyPoints),
        estimateHours: estimateHours === "" ? null : Number(estimateHours),
        acceptanceCriteria,
        actorId,
      });
      await onCreated(created.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add the work item");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer" role="presentation">
      <form
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={handleSubmit}
      >
        <div className="sheet-head">
          <h2 id={titleId}>Add work item</h2>
          <button className="quiet" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted">A task or bug can stand on its own. Main goals and requirements are optional.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <label>
          Title
          <input
            ref={titleRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <div className="form-grid">
          <label>
            Type
            <select
              value={workItemType}
              onChange={(event) => {
                const next = event.target.value as WorkItemType;
                setWorkItemType(next);
                if (preset) return;
                setParentId("");
              }}
            >
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                if (!preset) setParentId("");
              }}
              disabled={Boolean(preset)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Deadline
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label>
            Assignee
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              required={workItemType === "task" || workItemType === "bug"}
            >
              <option value="">{workItemType === "task" || workItemType === "bug" ? "Choose a teammate" : "Unassigned"}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="field-hint">
          <WorkTypeIcon type={workItemType} /> {TYPE_HINT[workItemType]}
        </p>
        {needsParent ? (
          <label>
            Parent
            <select value={parentId} onChange={(event) => setParentId(event.target.value)} required disabled={parents.length === 0}>
              <option value="">{workItemType === "feature" ? "Choose a main goal" : "Choose a functionality"}</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.title}
                </option>
              ))}
            </select>
            {parents.length === 0 ? (
              <span className="field-hint">
                {workItemType === "feature"
                  ? "Nothing to choose yet. Add a main goal in this project first. A functionality has to sit under one."
                  : "Nothing to choose yet. Add a functionality in this project first. A requirement has to sit under one."}
              </span>
            ) : null}
          </label>
        ) : null}
        <details className="more-details">
          <summary>More details</summary>
          <label>
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
          </label>
          {!needsParent && workItemType !== "epic" ? (
            <label>
              Parent
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">No parent — project level</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as Priority | "")}>
              <option value="">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Tags
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Comma-separated"
            />
          </label>
          {workItemType === "user_story" ? (
            <>
              <label>
                Story points
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={storyPoints}
                  onChange={(event) => setStoryPoints(event.target.value)}
                />
              </label>
              <label>
                Acceptance criteria
                <textarea
                  value={acceptanceCriteria}
                  onChange={(event) => setAcceptanceCriteria(event.target.value)}
                  rows={3}
                />
              </label>
            </>
          ) : null}
          {workItemType === "task" || workItemType === "bug" ? (
            <label>
              Estimated hours
              <input
                type="number"
                min={0}
                step="0.5"
                value={estimateHours}
                onChange={(event) => setEstimateHours(event.target.value)}
              />
            </label>
          ) : null}
        </details>
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy || projects.length === 0}>
            {busy ? "Adding…" : "Add work item"}
          </button>
          <button className="quiet" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function childTypes(parentType: WorkItemType): WorkItemType[] {
  if (parentType === "epic") return ["feature"];
  if (parentType === "feature") return ["user_story"];
  if (parentType === "user_story") return ["task", "bug"];
  return ["task"];
}
