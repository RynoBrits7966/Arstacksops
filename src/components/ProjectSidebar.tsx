import { useState } from "react";
import type { FormEvent } from "react";
import {
  PROJECT_COLORS,
  formatDeadline,
  isColorTaken,
  isDeadlinePriority,
  nextProjectColor,
  sortProjects,
} from "../projects";
import { taskStore } from "../storage/localStore";
import type { Project, Task, User } from "../types";

interface ProjectSidebarProps {
  projects: Project[];
  tasks: Task[];
  users: User[];
  currentUserId: string;
  onUserChange: (userId: string) => void;
  selectedId: string | "all";
  onSelect: (id: string | "all") => void;
  onChanged: () => Promise<void>;
}

export function ProjectSidebar({
  projects,
  tasks,
  users,
  currentUserId,
  onUserChange,
  selectedId,
  onSelect,
  onChanged,
}: ProjectSidebarProps) {
  const [adding, setAdding] = useState(false);
  const ordered = sortProjects(projects);
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/ar-mark.png" alt="" />
        <div>
          <h1>ARStacksOps</h1>
          <p>Work items</p>
        </div>
      </div>

      <label className="working-as">
        Working as
        <select value={currentUserId} onChange={(event) => onUserChange(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </label>

      <div className="side-head">
        <h2>Projects</h2>
        <button className="side-add" type="button" onClick={() => setAdding((open) => !open)}>
          {adding ? "Close" : "Add project"}
        </button>
      </div>

      {adding ? (
        <ProjectFields
          submitLabel="Save project"
          color={nextProjectColor(projects.map((project) => project.color))}
          takenColors={projects.map((project) => project.color)}
          onSubmit={async (input) => {
            const project = await taskStore.createProject(input);
            setAdding(false);
            onSelect(project.id);
            await onChanged();
          }}
        />
      ) : null}

      <div className="project-list" role="list">
        <button
          className={selectedId === "all" ? "project-row active" : "project-row"}
          type="button"
          onClick={() => onSelect("all")}
        >
          <span className="swatch-dot all" aria-hidden="true" />
          <span>
            <strong>All projects</strong>
            <span className="project-meta">
              {tasks.length} {tasks.length === 1 ? "issue" : "issues"}
            </span>
          </span>
        </button>
        {ordered.map((project) => {
          const count = tasks.filter((task) => task.projectId === project.id).length;
          const dueSoon = project.deadline ? isDeadlinePriority(project.deadline) : false;
          return (
            <button
              key={project.id}
              className={selectedId === project.id ? "project-row active" : "project-row"}
              type="button"
              onClick={() => onSelect(project.id)}
            >
              <span className="swatch-dot" style={{ background: project.color }} aria-hidden="true" />
              <span>
                <strong>{project.name}</strong>
                <span className="project-meta">{project.client || "No client yet"}</span>
                <span className={dueSoon ? "project-meta due-soon" : "project-meta"}>
                  {project.deadline ? `Due ${formatDeadline(project.deadline)}` : "N/A"}
                  {" · "}
                  {count} {count === 1 ? "issue" : "issues"}
                </span>
              </span>
            </button>
          );
        })}
        {ordered.length === 0 ? (
          <p className="side-empty">Add a project, then log tickets against it.</p>
        ) : null}
      </div>

      {selected ? (
        <section className="side-edit">
          <h2>Project details</h2>
          <ProjectFields
            key={selected.id}
            submitLabel="Save changes"
            name={selected.name}
            color={selected.color}
            client={selected.client}
            deadline={selected.deadline}
            takenColors={projects.filter((project) => project.id !== selected.id).map((project) => project.color)}
            onSubmit={async (input) => {
              await taskStore.updateProject(selected.id, input);
              await onChanged();
            }}
          />
        </section>
      ) : null}
    </aside>
  );
}

interface ProjectFieldsProps {
  name?: string;
  color: string;
  client?: string;
  deadline?: string | null;
  takenColors: string[];
  submitLabel: string;
  onSubmit: (input: {
    name: string;
    color: string;
    client: string;
    deadline: string | null;
  }) => Promise<void>;
}

function ProjectFields({
  name = "",
  color,
  client = "",
  deadline,
  takenColors,
  submitLabel,
  onSubmit,
}: ProjectFieldsProps) {
  const [projectName, setProjectName] = useState(name);
  const [projectClient, setProjectClient] = useState(client);
  const [projectColor, setProjectColor] = useState(color);
  const [noDeadline, setNoDeadline] = useState(deadline === null);
  const [projectDeadline, setProjectDeadline] = useState(deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        name: projectName,
        color: projectColor,
        client: projectClient,
        deadline: noDeadline ? null : projectDeadline,
      });
      if (!name) {
        setProjectName("");
        setProjectClient("");
        setProjectDeadline("");
        setNoDeadline(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="side-form" onSubmit={handleSubmit}>
      <label>
        Project name
        <input
          value={projectName}
          onChange={(event) => setProjectName(event.target.value)}
          required
          maxLength={80}
          placeholder="App or project"
        />
      </label>
      <label>
        Client
        <input
          value={projectClient}
          onChange={(event) => setProjectClient(event.target.value)}
          required
          maxLength={80}
          placeholder="Which client is this for?"
        />
      </label>
      <fieldset>
        <legend>Colour</legend>
        <div className="swatches">
          {PROJECT_COLORS.map((swatch) => {
            const taken = isColorTaken(takenColors, swatch);
            const selected = projectColor.toLowerCase() === swatch;
            return (
              <button
                key={swatch}
                className={selected ? "swatch selected" : "swatch"}
                type="button"
                style={{ background: swatch }}
                aria-label={taken ? `${swatch} already used` : swatch}
                aria-pressed={selected}
                disabled={taken}
                title={taken ? "Already used" : swatch}
                onClick={() => setProjectColor(swatch)}
              />
            );
          })}
          <label className="custom-color">
            Custom
            <input
              type="color"
              value={normalizeColor(projectColor)}
              onChange={(event) => setProjectColor(event.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={noDeadline}
          onChange={(event) => setNoDeadline(event.target.checked)}
        />
        N/A, no deadline
      </label>
      <label>
        Deadline
        <input
          type="date"
          value={noDeadline ? "" : projectDeadline}
          disabled={noDeadline}
          required={!noDeadline}
          onChange={(event) => setProjectDeadline(event.target.value)}
        />
      </label>
      {isColorTaken(takenColors, projectColor) ? (
        <p className="form-error">That colour is already used by another project.</p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button
        className="primary"
        type="submit"
        disabled={busy || !projectClient.trim() || isColorTaken(takenColors, projectColor)}
      >
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

function normalizeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#eb8536";
}
