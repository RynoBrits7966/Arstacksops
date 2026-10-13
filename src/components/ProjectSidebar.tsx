import { useState } from "react";
import type { FormEvent } from "react";
import { ProjectLifecycle } from "./ProjectLifecycle";
import {
  PROJECT_COLORS,
  formatDeadline,
  isColorTaken,
  isDeadlinePriority,
  isSignedOff,
  nextProjectColor,
  sortProjects,
} from "../projects";
import { taskStore } from "../storage/localStore";
import type { Project, Task } from "../types";

interface ProjectSidebarProps {
  projects: Project[];
  tasks: Task[];
  sessionName: string;
  onSignOut: () => void;
  selectedId: string | "all";
  onSelect: (id: string | "all") => void;
  onChanged: () => Promise<void>;
}

export function ProjectSidebar({
  projects,
  tasks,
  sessionName,
  onSignOut,
  selectedId,
  onSelect,
  onChanged,
}: ProjectSidebarProps) {
  const [adding, setAdding] = useState(false);
  const [list, setList] = useState<"active" | "completed">("active");
  const [notice, setNotice] = useState<string | null>(null);
  const ordered = sortProjects(projects);
  const active = ordered.filter((project) => !isSignedOff(project));
  const completed = ordered.filter((project) => isSignedOff(project));
  const visible = list === "completed" ? completed : active;
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const activeIssueCount = tasks.filter((task) => active.some((project) => project.id === task.projectId)).length;

  return (
    <aside className="sidebar">
      <div className="side-sticky">
        <div className="brand">
          <img src="/ar-mark.png" alt="" />
          <div>
            <h1>ARStacksOps</h1>
            <p>Work items</p>
          </div>
        </div>

        <div className="signed-in">
          <span>Signed in as {sessionName}</span>
          <button className="quiet" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>

        <div className="side-head">
          <h2>Projects</h2>
          <button className="side-add" type="button" onClick={() => setAdding((open) => !open)}>
            {adding ? "Close" : "Add project"}
          </button>
        </div>

        <div className="side-tabs" role="tablist" aria-label="Project list">
          <button
            className={list === "active" ? "tab active" : "tab"}
            type="button"
            role="tab"
            aria-selected={list === "active"}
            onClick={() => {
              setList("active");
              if (selected && isSignedOff(selected)) onSelect("all");
            }}
          >
            Active
          </button>
          <button
            className={list === "completed" ? "tab active" : "tab"}
            type="button"
            role="tab"
            aria-selected={list === "completed"}
            onClick={() => setList("completed")}
          >
            Completed
          </button>
        </div>
        {notice ? <p className="project-meta">{notice}</p> : null}
      </div>

      <div className="side-scroll">
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
        {list === "active" ? (
          <button
            className={selectedId === "all" ? "project-row active" : "project-row"}
            type="button"
            onClick={() => onSelect("all")}
          >
            <span className="swatch-dot all" aria-hidden="true" />
            <span>
              <strong>All projects</strong>
              <span className="project-meta">
                {activeIssueCount} {activeIssueCount === 1 ? "issue" : "issues"}
              </span>
            </span>
          </button>
        ) : null}
        {visible.map((project) => {
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
                  {project.signOff
                    ? `Signed off by ${project.signOff.name}`
                    : project.deadline
                      ? `Due ${formatDeadline(project.deadline)}`
                      : "N/A"}
                  {" · "}
                  {count} {count === 1 ? "issue" : "issues"}
                </span>
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="side-empty">
            {list === "completed" ? "Signed-off projects will appear here." : "Add a project, then log tickets against it."}
          </p>
        ) : null}
      </div>

      {selected ? (
        <section className="side-edit" key={selected.id}>
          <h2>Project details</h2>
          <ProjectLifecycle
            project={selected}
            onChanged={onChanged}
            onDeleted={(name) => {
              setNotice(`Deleted ${name}.`);
              setList("active");
              onSelect("all");
            }}
            onSignedOff={(name) => {
              setNotice(`${name} signed off and moved to Completed.`);
              setList("completed");
            }}
            onReopened={(name) => {
              setNotice(`${name} is active again.`);
              setList("active");
            }}
          />
          <ProjectFields
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
      </div>
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
