import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  COLUMNS,
  EMPTY_QUERY,
  PRIORITIES,
  PRIORITY_LABEL,
  TYPE_LABEL,
  allowedChildTypes,
  buildRows,
  columnTemplate,
  estimateLabel,
  isQueryActive,
  isTicketType,
  type BacklogQuery,
  type BacklogSort,
  type ColumnId,
} from "../backlog/model";
import { formatWhen } from "../format";
import { ISSUE_TYPE_LABEL, ISSUE_TYPES, isIssueType } from "../issues/keys";
import { buildReportPdf } from "../export/reportPdf";
import { sortProjects } from "../projects";
import { archiveNeedsVisit } from "../storage/archive";
import { taskStore } from "../storage/localStore";
import { STATUS_LABELS, TAB_ORDER } from "../statuses";
import type { Project, Task, User } from "../types";
import { BacklogDetails } from "./BacklogDetails";
import { CreateWorkItem } from "./CreateWorkItem";
import { WorkTypeIcon } from "./WorkTypeIcon";

const FILTER_KEY = "arstacksops.backlog.filters";
const EXPANDED_KEY = "arstacksops.backlog.expanded";
const COLUMNS_KEY = "arstacksops.backlog.columns";
const SORT_KEY = "arstacksops.backlog.sort";

interface BacklogViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  currentUserId: string;
  projectFilter: string | "all";
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => Promise<void>;
}

function loadQuery(): BacklogQuery {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return EMPTY_QUERY;
    const stored = { ...EMPTY_QUERY, ...JSON.parse(raw) } as BacklogQuery;
    if (stored.type !== "all" && !isIssueType(stored.type)) stored.type = "all";
    return stored;
  } catch {
    return EMPTY_QUERY;
  }
}

function loadSort(): BacklogSort | null {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BacklogSort;
    const known = COLUMNS.some((column) => column.id === parsed.column);
    if (!known || (parsed.direction !== "asc" && parsed.direction !== "desc")) return null;
    return { column: parsed.column, direction: parsed.direction };
  } catch {
    return null;
  }
}

function loadColumns(): ColumnId[] {
  try {
    const raw = localStorage.getItem(COLUMNS_KEY);
    const parsed = raw ? (JSON.parse(raw) as ColumnId[]) : null;
    const stored = Array.isArray(parsed) ? parsed : COLUMNS.map((column) => column.id);
    const required = COLUMNS.filter((column) => !column.hideable).map((column) => column.id);
    return COLUMNS.map((column) => column.id).filter((id) => stored.includes(id) || required.includes(id));
  } catch {
    return COLUMNS.map((column) => column.id);
  }
}

export function BacklogView({
  tasks,
  projects,
  users,
  currentUserId,
  projectFilter,
  selectedId,
  onSelect,
  onChanged,
}: BacklogViewProps) {
  const orderedProjects = sortProjects(projects);
  const [query, setQuery] = useState<BacklogQuery>(loadQuery);
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(orderedProjects));
  const projectKey = orderedProjects.map((project) => project.id).join("|");
  const [columns, setColumns] = useState<ColumnId[]>(loadColumns);
  const [sort, setSort] = useState<BacklogSort | null>(loadSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [presetParentId, setPresetParentId] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = isQueryActive(query);
  const { rows } = useMemo(
    () => buildRows(tasks, orderedProjects, projectFilter, query, expanded, sort, users),
    [tasks, orderedProjects, projectFilter, query, expanded, sort, users],
  );
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const scoped = tasks.filter((task) => projectFilter === "all" || task.projectId === projectFilter);
  const counted = scoped.filter((task) => query.includeArchived || task.status !== "archived");
  const ticketCount = counted.filter((task) => isTicketType(task.workItemType)).length;
  const otherCount = counted.length - ticketCount;
  const tags = [...new Set(scoped.flatMap((task) => task.tags))].sort((a, b) => a.localeCompare(b));
  const projectName =
    projectFilter === "all" ? "all projects" : (projects.find((project) => project.id === projectFilter)?.name ?? "this project");

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify(query));
  }, [query]);

  useEffect(() => {
    if (localStorage.getItem(EXPANDED_KEY) || !projectKey) return;
    setExpanded((current) => {
      const ids = projectKey.split("|");
      if (ids.every((id) => current.has(`project:${id}`))) return current;
      const next = new Set(current);
      for (const id of ids) next.add(`project:${id}`);
      return next;
    });
  }, [projectKey]);

  useEffect(() => {
    if (selectedId && !tasks.some((task) => task.id === selectedId)) onSelect(null);
  }, [tasks, selectedId, onSelect]);

  useEffect(() => {
    if (sort) localStorage.setItem(SORT_KEY, JSON.stringify(sort));
    else localStorage.removeItem(SORT_KEY);
  }, [sort]);

  function cycleSort(column: ColumnId) {
    setSort((current) => {
      if (!current || current.column !== column) return { column, direction: "asc" };
      if (current.direction === "asc") return { column, direction: "desc" };
      return null;
    });
  }

  function writeExpanded(next: Set<string>) {
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeExpanded(next);
  }

  function expandAll() {
    const next = new Set<string>(orderedProjects.map((project) => `project:${project.id}`));
    for (const task of tasks) {
      if (tasks.some((child) => child.parentId === task.id)) next.add(task.id);
    }
    writeExpanded(next);
  }

  function collapseAll() {
    writeExpanded(new Set());
  }

  function clearFilters() {
    setQuery(EMPTY_QUERY);
  }

  function exportData() {
    setBackupError(null);
    try {
      const pdf = buildReportPdf({ projects, tasks, users });
      const body = new ArrayBuffer(pdf.byteLength);
      new Uint8Array(body).set(pdf);
      const url = URL.createObjectURL(new Blob([body], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "arstacksops.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setBackupError(caught instanceof Error ? caught.message : "Could not export");
    }
  }

  function onTableKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest("input, textarea, select")) return;
    const ids = rows.flatMap((row) => (row.kind === "item" ? [row.task.id] : []));
    if (ids.length === 0) return;
    const currentId = target.closest("[data-item-id]")?.getAttribute("data-item-id") ?? selectedId;
    const index = Math.max(0, ids.indexOf(currentId ?? ""));
    const nextIndex = event.key === "ArrowDown" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1);
    const nextId = ids[nextIndex];
    if (!nextId) return;
    event.preventDefault();
    onSelect(nextId);
    scrollRef.current
      ?.querySelector<HTMLButtonElement>(`[data-item-id="${CSS.escape(nextId)}"] .title-button`)
      ?.focus();
  }

  const visibleColumns = COLUMNS.filter((column) => columns.includes(column.id));
  const showTable = rows.some((row) => row.kind === "item") || (projectFilter === "all" && rows.length > 0);

  return (
    <div className="backlog-page">
      <div className="backlog-toolbar">
        <label className="search-field">
          <span>Search</span>
          <input
            value={query.text}
            onChange={(event) => setQuery({ ...query, text: event.target.value })}
            placeholder="Title, ID, or tag"
          />
        </label>
        <button className="primary" type="button" onClick={() => { setPresetParentId(null); setCreating(true); }} disabled={projects.length === 0}>
          Add work item
        </button>
        <button className={active ? "quiet filter-active" : "quiet"} type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
          Filters{active ? " · on" : ""}
        </button>
        <button className="quiet" type="button" onClick={expandAll}>
          Expand all
        </button>
        <button className="quiet" type="button" onClick={collapseAll}>
          Collapse all
        </button>
        <button className="quiet" type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen((open) => !open)}>
          Columns
        </button>
        <button className="quiet" type="button" onClick={exportData}>
          Export PDF
        </button>
      </div>
      {filtersOpen ? (
          <div className="filter-panel backlog-filters">
            <label>
              Issue type
              <select value={query.type} onChange={(event) => setQuery({ ...query, type: event.target.value as BacklogQuery["type"] })}>
                <option value="all">All types</option>
                {ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>{ISSUE_TYPE_LABEL[type]}</option>
                ))}
              </select>
            </label>
            <label>
              State
              <select value={query.status} onChange={(event) => setQuery({ ...query, status: event.target.value as BacklogQuery["status"] })}>
                <option value="all">All states</option>
                {TAB_ORDER.map((status) => (
                  <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select value={query.assigneeId} onChange={(event) => setQuery({ ...query, assigneeId: event.target.value })}>
                <option value="all">Anyone</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select value={query.priority} onChange={(event) => setQuery({ ...query, priority: event.target.value as BacklogQuery["priority"] })}>
                <option value="all">Any priority</option>
                <option value="none">No priority</option>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>
                ))}
              </select>
            </label>
            <label>
              Tag
              <select value={query.tag} onChange={(event) => setQuery({ ...query, tag: event.target.value })}>
                <option value="all">Any tag</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </label>
            <label className="check-line archive-toggle">
              <input
                type="checkbox"
                checked={query.includeArchived}
                onChange={(event) => setQuery({ ...query, includeArchived: event.target.checked })}
              />
              Include archived
            </label>
          </div>
      ) : null}
      {columnsOpen ? (
        <div className="filter-panel column-picker" role="group" aria-label="Visible columns">
          {COLUMNS.map((column) => (
            <label key={column.id} className="check-line">
              <input
                type="checkbox"
                checked={columns.includes(column.id)}
                disabled={!column.hideable}
                onChange={() => {
                  const next = columns.includes(column.id)
                    ? columns.filter((id) => id !== column.id)
                    : COLUMNS.map((item) => item.id).filter((id) => columns.includes(id) || id === column.id);
                  setColumns(next);
                  localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
                }}
              />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}
      <div className="filter-chips">
        <p className="count-note">
          {ticketCount} {ticketCount === 1 ? "task or bug" : "tasks and bugs"}
          {otherCount === 1
            ? " · 1 main goal, functionality, or requirement"
            : otherCount > 1
              ? ` · ${otherCount} main goals, functionalities, and requirements`
              : ""}
        </p>
        {active ? (
          <button className="tag-pill" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>
      {backupError ? <p className="form-error banner">{backupError}</p> : null}
      <div className="backlog-body">
        <div className="backlog-scroll" ref={scrollRef} onKeyDown={onTableKey}>
          {projects.length === 0 ? (
            <div className="empty-state">
              <h2>Add a project first</h2>
              <p>Use Add project in the left pane. Then you can add a task or bug here.</p>
            </div>
          ) : null}
          {projects.length > 0 && !showTable ? (
            <div className="empty-state">
              {active ? (
                <>
                  <h2>No matches</h2>
                  <p>Nothing in {projectName} matches the current search or filters.</p>
                  <button className="primary" type="button" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <h2>No work items in {projectName}</h2>
                  <p>Add a task or bug to get started. You can group work under a main goal later.</p>
                  <button className="primary" type="button" onClick={() => { setPresetParentId(null); setCreating(true); }}>
                    Add work item
                  </button>
                </>
              )}
            </div>
          ) : null}
          {showTable ? (
            <div className="backlog-table" style={{ ["--cols" as string]: columnTemplate(columns) }} role="table" aria-label="Backlog">
              <div className="backlog-row backlog-head" role="row">
                {visibleColumns.map((column) => {
                  const activeSort = sort?.column === column.id ? sort.direction : null;
                  return (
                    <div
                      key={column.id}
                      role="columnheader"
                      aria-sort={activeSort === "asc" ? "ascending" : activeSort === "desc" ? "descending" : "none"}
                    >
                      <button className="sort-header" type="button" onClick={() => cycleSort(column.id)}>
                        {column.label}
                        <span aria-hidden="true">{activeSort === "asc" ? "↑" : activeSort === "desc" ? "↓" : ""}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
              {rows.map((row) =>
                row.kind === "project" ? (
                  <div className="backlog-row project-heading" role="row" key={row.project.id}>
                    <div role="cell">
                      <button
                        className="chevron"
                        type="button"
                        aria-expanded={expanded.has(`project:${row.project.id}`) || active}
                        onClick={() => toggleExpanded(`project:${row.project.id}`)}
                      >
                        <Caret open={expanded.has(`project:${row.project.id}`) || active} />
                        <span className="visually-hidden">{expanded.has(`project:${row.project.id}`) ? "Collapse" : "Expand"} {row.project.name}</span>
                      </button>
                      <span className="swatch-dot" style={{ background: row.project.color }} aria-hidden="true" />
                      <strong>{row.project.name}</strong>
                      <span className="muted">{row.project.client || "No client yet"}</span>
                    </div>
                  </div>
                ) : (
                  <div
                    className={
                      row.task.id === selectedId
                        ? "backlog-row is-selected"
                        : row.ancestorOnly
                          ? "backlog-row is-context"
                          : "backlog-row"
                    }
                    role="row"
                    key={row.task.id}
                    data-item-id={row.task.id}
                  >
                    {columns.includes("order") ? (
                      <div role="cell" className="order-cell">
                        <span>{siblingPosition(tasks, row.task)}</span>
                        <button className="tiny" type="button" aria-label={`Move ${row.task.title} up`} disabled={siblingPosition(tasks, row.task) <= 1} onClick={() => void move(row.task.id, "up")}>
                          ↑
                        </button>
                        <button className="tiny" type="button" aria-label={`Move ${row.task.title} down`} disabled={isLastSibling(tasks, row.task)} onClick={() => void move(row.task.id, "down")}>
                          ↓
                        </button>
                      </div>
                    ) : null}
                    {columns.includes("id") ? (
                      <div role="cell" className="id-cell" title={row.task.id}>{row.task.id}</div>
                    ) : null}
                    {columns.includes("type") ? (
                      <div role="cell" className="type-cell">
                        <WorkTypeIcon type={row.task.workItemType} />
                        {TYPE_LABEL[row.task.workItemType]}
                      </div>
                    ) : null}
                    <div role="cell" className="title-cell" style={{ paddingLeft: row.depth * 16 }}>
                      {row.hasChildren ? (
                        <button className="chevron" type="button" aria-expanded={expanded.has(row.task.id) || (active && row.hasChildren)} onClick={() => toggleExpanded(row.task.id)}>
                          <Caret open={expanded.has(row.task.id) || (active && row.hasChildren)} />
                          <span className="visually-hidden">{expanded.has(row.task.id) ? "Collapse" : "Expand"} {row.task.title}</span>
                        </button>
                      ) : null}
                      <button className="title-button" type="button" onClick={() => onSelect(row.task.id)}>
                        {row.task.title}
                        {archiveNeedsVisit(row.task) ? (
                          <span className="bang" title="In Archive for 3 days. Open it.">
                            !
                          </span>
                        ) : null}
                      </button>
                      {allowedChildTypes(row.task.workItemType).length > 0 ? (
                        <button
                          className="tiny add-child"
                          type="button"
                          onClick={() => {
                            setPresetParentId(row.task.id);
                            setCreating(true);
                          }}
                        >
                          Add child
                        </button>
                      ) : null}
                      {row.ancestorOnly ? <span className="context-pill">Shown for context</span> : null}
                    </div>
                    {columns.includes("state") ? (
                      <div role="cell" className="state-cell">
                        <span className={`state-dot ${row.task.status}`} aria-hidden="true" />
                        {STATUS_LABELS[row.task.status]}
                      </div>
                    ) : null}
                    {columns.includes("tags") ? (
                      <div role="cell" className="tag-cell">
                        {row.task.tags.map((tag) => (
                          <span key={tag} className="tag-pill quiet-pill">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                    {columns.includes("estimate") ? <div role="cell">{estimateLabel(row.task)}</div> : null}
                    {columns.includes("priority") ? (
                      <div role="cell">{row.task.priority ? PRIORITY_LABEL[row.task.priority] : "—"}</div>
                    ) : null}
                    {columns.includes("assignee") ? (
                      <div role="cell">{users.find((user) => user.id === row.task.assigneeId)?.name ?? "—"}</div>
                    ) : null}
                    {columns.includes("updated") ? <div role="cell">{formatWhen(row.task.updatedAt)}</div> : null}
                  </div>
                ),
              )}
            </div>
          ) : null}
        </div>
        {selected ? (
          <BacklogDetails
            key={selected.id}
            task={selected}
            tasks={tasks}
            projects={orderedProjects}
            users={users}
            currentUserId={currentUserId}
            onClose={() => onSelect(null)}
            onChanged={onChanged}
          />
        ) : null}
      </div>
      {creating ? (
        <CreateWorkItem
          projects={orderedProjects}
          tasks={tasks}
          users={users}
          defaultProjectId={projectFilter === "all" ? orderedProjects[0]?.id ?? "" : projectFilter}
          presetParentId={presetParentId}
          actorId={currentUserId}
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            setCreating(false);
            onSelect(id);
            if (presetParentId) writeExpanded(new Set(expanded).add(presetParentId));
            await onChanged();
          }}
        />
      ) : null}
    </div>
  );

  async function move(id: string, direction: "up" | "down") {
    setBackupError(null);
    try {
      await taskStore.moveWorkItem(id, direction, currentUserId);
      await onChanged();
    } catch (caught) {
      setBackupError(caught instanceof Error ? caught.message : "Could not reorder");
    }
  }
}

function readExpanded(projects: Project[]): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return new Set(projects.map((project) => `project:${project.id}`));
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set(projects.map((project) => `project:${project.id}`));
  }
  return new Set(projects.map((project) => `project:${project.id}`));
}

function siblingPosition(tasks: Task[], task: Task): number {
  const group = tasks
    .filter((item) => item.projectId === task.projectId && item.parentId === task.parentId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return group.findIndex((item) => item.id === task.id) + 1;
}

function isLastSibling(tasks: Task[], task: Task): boolean {
  const group = tasks.filter((item) => item.projectId === task.projectId && item.parentId === task.parentId);
  return siblingPosition(tasks, task) >= group.length;
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={open ? "caret open" : "caret"}>
      <path d="M4 2.2 8.2 6 4 9.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
