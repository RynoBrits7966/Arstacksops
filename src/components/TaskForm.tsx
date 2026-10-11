import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { UserPicker } from "./UserPicker";
import { taskStore } from "../storage/localStore";
import type { Project, User } from "../types";

interface TaskFormProps {
  projects: Project[];
  users: User[];
  defaultProjectId: string;
  onCreated: () => Promise<void>;
}

export function TaskForm({ projects, users, defaultProjectId, onCreated }: TaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");

  useEffect(() => {
    if (defaultProjectId) setProjectId(defaultProjectId);
  }, [defaultProjectId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosenProject = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await taskStore.createTask({
        title,
        description,
        projectId: chosenProject,
        assigneeId,
      });
      setTitle("");
      setDescription("");
      setAssigneeId("");
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card create-form" onSubmit={handleSubmit}>
      <div className="create-head">
        <span className="type-label">Task</span>
        <h2>New work item</h2>
      </div>
      {projects.length === 0 ? (
        <p className="muted">Add a project on the left before logging a ticket.</p>
      ) : (
        <label>
          Project
          <select
            value={chosenProject}
            onChange={(event) => setProjectId(event.target.value)}
            required
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          maxLength={160}
          placeholder="What needs doing?"
          disabled={projects.length === 0}
        />
      </label>
      <UserPicker
        users={users}
        selectedIds={assigneeId ? [assigneeId] : []}
        onToggle={(user) => setAssigneeId(user.id)}
        label="Tag a teammate with @"
      />
      <label>
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Add any detail you want to keep with the task"
          disabled={projects.length === 0}
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="form-actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || projects.length === 0 || !assigneeId}
        >
          {busy ? "Creating…" : "Create task"}
        </button>
      </div>
    </form>
  );
}
