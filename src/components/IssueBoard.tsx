import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { descendantIds } from "../backlog/model";
import { formatWhen } from "../format";
import {
  DETAIL_CATEGORIES,
  DETAIL_CATEGORY_LABEL,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_LABEL,
  ISSUE_TYPES,
  ISSUE_TYPE_LABEL,
  PLATFORM_LABEL,
  formatTicketId,
  isIssueType,
  issueTypeLabel,
} from "../issues/keys";
import { ISSUE_COLUMNS, compareIssues, isIssueColumn, type IssueColumn, type IssueSort } from "../issues/sort";
import { archiveNeedsVisit } from "../storage/archive";
import { taskStore } from "../storage/localStore";
import { STATUS_LABELS, TAB_NOTES, TAB_ORDER } from "../statuses";
import type {
  Comment,
  DetailCategory,
  IssueSeverity,
  IssueType,
  Platform,
  Project,
  Task,
  TaskStatus,
  User,
} from "../types";
import { IssueDetails } from "./IssueDetails";
import { PlatformField } from "./PlatformField";

const FILTER_KEY = "arstacksops.issue.filters";
const SORT_KEY = "arstacksops.issue.sort";

function loadSort(): IssueSort | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(SORT_KEY) ?? "") as IssueSort;
    if (!isIssueColumn(parsed.column) || (parsed.direction !== "asc" && parsed.direction !== "desc")) return null;
    return { column: parsed.column, direction: parsed.direction };
  } catch {
    return null;
  }
}

type TypeFilter = "all" | IssueType;
type SeverityFilter = "all" | IssueSeverity | "unset";

interface StoredFilters {
  query: string;
  type: TypeFilter;
  severity: SeverityFilter;
  assignee: string;
}

function readFilters(): StoredFilters {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "") as Partial<StoredFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      type: (() => {
        const stored = parsed.type as unknown;
        if (stored === "unclassified") return "review";
        return isIssueType(stored) ? stored : "all";
      })(),
      severity:
        parsed.severity === "critical" ||
        parsed.severity === "major" ||
        parsed.severity === "minor" ||
        parsed.severity === "unset"
          ? parsed.severity
          : "all",
      assignee: typeof parsed.assignee === "string" ? parsed.assignee : "all",
    };
  } catch {
    return { query: "", type: "all", severity: "all", assignee: "all" };
  }
}

interface IssueBoardProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  comments: Comment[];
  currentUserId: string;
  projectFilter: string | "all";
  tab: TaskStatus;
  selectedId: string | null;
  unreadTaskIds: Set<string>;
  onTab: (status: TaskStatus) => void;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
}

export function IssueBoard({
  tasks,
  projects,
  users,
  comments,
  currentUserId,
  projectFilter,
  tab,
  selectedId,
  unreadTaskIds,
  onTab,
  onSelect,
  onChanged,
}: IssueBoardProps) {
  const [filters, setFilters] = useState<StoredFilters>(readFilters);
  const [sort, setSort] = useState<IssueSort | null>(loadSort);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (sort) localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    else localStorage.removeItem(SORT_KEY);
  }, [sort]);

  function cycleSort(column: IssueColumn) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  function openTicket(id: string) {
    if (selectedId && id !== selectedId) return;
    onSelect(id);
  }

  function updateFilters(patch: Partial<StoredFilters>) {
    setFilters((current) => {
      const next = { ...current, ...patch };
      localStorage.setItem(FILTER_KEY, JSON.stringify(next));
      return next;
    });
  }

  const inProject = tasks.filter((task) => projectFilter === "all" || task.projectId === projectFilter);
  const inTab = inProject.filter((task) => task.status === tab);
  const visible = inTab.filter((task) => {
    const project = projects.find((item) => item.id === task.projectId);
    const ticketId = formatTicketId(project?.name, task.ticketNumber).toLowerCase();
    const query = filters.query.trim().toLowerCase();
    if (
      query &&
      !task.title.toLowerCase().includes(query) &&
      !task.description.toLowerCase().includes(query) &&
      !ticketId.includes(query)
    ) {
      return false;
    }
    if (filters.type === "review" && task.issueType !== "review" && task.issueType !== null) return false;
    if (filters.type !== "all" && filters.type !== "review" && task.issueType !== filters.type) return false;
    if (filters.severity === "unset" && task.issueSeverity) return false;
    if (filters.severity !== "all" && filters.severity !== "unset" && task.issueSeverity !== filters.severity) {
      return false;
    }
    if (filters.assignee !== "all" && task.assigneeId !== filters.assignee) return false;
    return true;
  });
  const rows = sort ? [...visible].sort((a, b) => compareIssues(a, b, sort, projects, users)) : visible;
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const filtersActive =
    filters.query.trim() !== "" || filters.type !== "all" || filters.severity !== "all" || filters.assignee !== "all";

  return (
    <div className="issue-board">
      <div className="board-bar">
        <label className="issue-search">
          <span className="visually-hidden">Search issues</span>
          <input
            value={filters.query}
            onChange={(event) => updateFilters({ query: event.target.value })}
            placeholder="Search title or ticket id"
            type="search"
          />
        </label>
        <button className="primary" type="button" onClick={() => setCreating(true)}>
          Create issue
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="Issue state">
        {TAB_ORDER.map((status) => {
          const count = inProject.filter((task) => task.status === status).length;
          const waiting =
            status === "escalated" &&
            inProject.some(
              (task) => task.status === "escalated" && task.escalatedToId === currentUserId && !task.escalationSeenAt,
            );
          const archiveWaiting = status === "archived" && inProject.some((task) => archiveNeedsVisit(task));
          return (
            <button
              key={status}
              className={tab === status ? "tab active" : "tab"}
              type="button"
              role="tab"
              aria-selected={tab === status}
              onClick={() => {
                if (selected && selected.status !== status) onSelect(null);
                onTab(status);
              }}
            >
              {STATUS_LABELS[status]}
              <span className="count">{count}</span>
              {waiting || archiveWaiting ? (
                <span
                  className="bang"
                  title={archiveWaiting ? "A ticket has been in Archive for 3 days" : "An issue was escalated to you"}
                >
                  !
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="issue-filters">
        <label>
          Type
          <select value={filters.type} onChange={(event) => updateFilters({ type: event.target.value as TypeFilter })}>
            <option value="all">All types</option>
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
            value={filters.severity}
            onChange={(event) => updateFilters({ severity: event.target.value as SeverityFilter })}
          >
            <option value="all">All severities</option>
            {ISSUE_SEVERITIES.map((level) => (
              <option key={level} value={level}>
                {ISSUE_SEVERITY_LABEL[level]}
              </option>
            ))}
            <option value="unset">Not set</option>
          </select>
        </label>
        <label>
          State
          <select
            value={tab}
            onChange={(event) => {
              const status = event.target.value as TaskStatus;
              if (selected && selected.status !== status) onSelect(null);
              onTab(status);
            }}
          >
            {TAB_ORDER.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignee
          <select value={filters.assignee} onChange={(event) => updateFilters({ assignee: event.target.value })}>
            <option value="all">Anyone</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tab-note">{TAB_NOTES[tab]}</p>
      <div className={selected ? "issue-layout with-detail" : "issue-layout"}>
        <div className="issue-table-wrap">
          {visible.length === 0 ? (
            <div className="empty-state">
              <p>{inProject.length === 0 ? "No issues in this project yet." : `Nothing in ${STATUS_LABELS[tab]} matches.`}</p>
              {filtersActive ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => updateFilters({ query: "", type: "all", severity: "all", assignee: "all" })}
                >
                  Clear filters
                </button>
              ) : (
                <button className="primary" type="button" onClick={() => setCreating(true)}>
                  Create issue
                </button>
              )}
            </div>
          ) : (
            <div className="issue-table" role="table" aria-label="Issues">
              <div className="issue-head" role="row">
                {ISSUE_COLUMNS.map((column) => {
                  const activeSort = sort?.column === column.id ? sort.direction : null;
                  return (
                    <span
                      key={column.id}
                      role="columnheader"
                      aria-sort={activeSort === "asc" ? "ascending" : activeSort === "desc" ? "descending" : "none"}
                    >
                      <button className="sort-header" type="button" onClick={() => cycleSort(column.id)}>
                        {column.label}
                        <span aria-hidden="true">{activeSort === "asc" ? "↑" : activeSort === "desc" ? "↓" : ""}</span>
                      </button>
                    </span>
                  );
                })}
              </div>
              <ul>
                {rows.map((task) => (
                  <IssueRow
                    key={task.id}
                    task={task}
                    projects={projects}
                    users={users}
                    currentUserId={currentUserId}
                    selected={task.id === selectedId}
                    unread={unreadTaskIds.has(task.id)}
                    onOpen={() => openTicket(task.id)}
                  />
                ))}
              </ul>
            </div>
          )}
          {filtersActive && visible.length > 0 ? (
            <p className="count-note count-inline">
              Showing {visible.length} of {inTab.length} in {STATUS_LABELS[tab]}.
            </p>
          ) : null}
        </div>
        {selected ? (
          <IssueDetails
            key={selected.id}
            task={selected}
            projects={projects}
            users={users}
            currentUserId={currentUserId}
            comments={comments}
            linkedCount={descendantIds(tasks, selected.id).length}
            onClose={() => onSelect(null)}
            onMoved={async (status) => {
              onTab(status);
              await onChanged();
            }}
            onRefresh={onChanged}
          />
        ) : null}
      </div>
      {creating ? (
        <CreateIssue
          projects={projects}
          users={users}
          currentUserId={currentUserId}
          defaultProjectId={projectFilter === "all" ? (projects[0]?.id ?? "") : projectFilter}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            onSelect(null);
            onTab("new");
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function IssueRow({
  task,
  projects,
  users,
  currentUserId,
  selected,
  unread,
  onOpen,
}: {
  task: Task;
  projects: Project[];
  users: User[];
  currentUserId: string;
  selected: boolean;
  unread: boolean;
  onOpen: () => void;
}) {
  const project = projects.find((item) => item.id === task.projectId);
  const assignee = users.find((user) => user.id === task.assigneeId);
  const waiting = task.status === "escalated" && task.escalatedToId === currentUserId && !task.escalationSeenAt;
  const parked = archiveNeedsVisit(task);
  const flagged = parked || waiting || unread;
  const flagTitle = parked
    ? "In Archive for 3 days. Open it."
    : waiting
      ? "This was escalated to you"
      : "A tagged teammate has not read a comment";
  return (
    <li role="row">
      <button
        className={`issue-row${selected ? " selected" : ""}${parked ? " needs-visit" : ""}`}
        type="button"
        onClick={onOpen}
      >
        <span className="issue-title">
          <span className="ticket-id">{formatTicketId(project?.name, task.ticketNumber)}</span>
          <span>{task.title}</span>
          {flagged ? (
            <span className="bang" title={flagTitle}>
              !
            </span>
          ) : null}
        </span>
        <span>
          <span className={`badge badge-${task.issueType ?? "review"}`}>{issueTypeLabel(task.issueType)}</span>
        </span>
        <span className="platform-cell">
          {(task.platforms ?? []).length === 0 ? (
            <span className="muted">—</span>
          ) : (
            task.platforms.map((platform) => (
              <span key={platform} className={`badge badge-${platform}`}>
                {PLATFORM_LABEL[platform]}
              </span>
            ))
          )}
        </span>
        <span>
          {task.issueSeverity ? (
            <span className={`badge badge-${task.issueSeverity}`}>{ISSUE_SEVERITY_LABEL[task.issueSeverity]}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </span>
        <span>{STATUS_LABELS[task.status]}</span>
        <span>{assignee?.name ?? "Unassigned"}</span>
        <span>
          <span className="type-mark" style={{ background: project?.color ?? "#eb8536" }} />
          {project?.name ?? "Unknown project"}
        </span>
        <span>{formatWhen(task.updatedAt)}</span>
      </button>
    </li>
  );
}

function CreateIssue({
  projects,
  users,
  currentUserId,
  defaultProjectId,
  onClose,
  onCreated,
}: {
  projects: Project[];
  users: User[];
  currentUserId: string;
  defaultProjectId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId);
  const [issueType, setIssueType] = useState<IssueType | "">("");
  const [issueSeverity, setIssueSeverity] = useState<IssueSeverity | "">("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [affectedArea, setAffectedArea] = useState("");
  const [detailCategory, setDetailCategory] = useState<DetailCategory | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const projectName = projects.find((item) => item.id === projectId)?.name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!issueType || !issueSeverity) {
      setError("Choose an issue type and a severity.");
      return;
    }
    if (platforms.length === 0) {
      setError("Choose at least one platform.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await taskStore.createIssue({
        title,
        description,
        projectId,
        assigneeId,
        issueType,
        platforms,
        issueSeverity,
        stepsToReproduce: steps,
        expectedBehaviour: expected,
        actualBehaviour: actual,
        affectedArea,
        detailCategory: detailCategory || null,
        actorId: currentUserId,
      });
      await onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the issue");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-layer" role="presentation" onMouseDown={onClose}>
      <form
        className="sheet"
        role="dialog"
        aria-labelledby="create-issue-heading"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="sheet-head">
          <h2 id="create-issue-heading">Create issue</h2>
          <button className="ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {projectName ? (
          <p className="ticket-id">The ticket id starts with the project name, for example {projectName}-1.</p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        <label>
          Title
          <input value={title} onChange={(event) => setTitle(event.target.value)} required autoFocus />
        </label>
        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Issue type
          <select value={issueType} onChange={(event) => setIssueType(event.target.value as IssueType | "")} required>
            <option value="">Choose a type</option>
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
            required
          >
            <option value="">Choose a severity</option>
            {ISSUE_SEVERITIES.map((level) => (
              <option key={level} value={level}>
                {ISSUE_SEVERITY_LABEL[level]}
              </option>
            ))}
          </select>
        </label>
        <PlatformField value={platforms} onChange={setPlatforms} />
        <label>
          Assigned to
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} required>
            <option value="">Choose a teammate</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
        </label>
        <details className="more-details" open={issueType === "bug" || issueType === "ui"}>
          <summary>More details</summary>
          {issueType === "bug" ? (
            <>
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
            </>
          ) : null}
          {issueType === "ui" ? (
            <>
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
            </>
          ) : null}
          {issueType !== "bug" && issueType !== "ui" ? (
            <p className="muted">Reproduction steps and visual details appear here when the type needs them.</p>
          ) : null}
        </details>
        <div className="dialog-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Adding…" : "Create issue"}
          </button>
        </div>
      </form>
    </div>
  );
}
