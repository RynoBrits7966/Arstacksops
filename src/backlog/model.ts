import { TAB_ORDER } from "../statuses";
import type { IssueType, Priority, Project, Task, TaskStatus, User, WorkItemType } from "../types";

export const WORK_ITEM_TYPES: WorkItemType[] = ["epic", "feature", "user_story", "task", "bug"];

export const TYPE_LABEL: Record<WorkItemType, string> = {
  epic: "Main Goal",
  feature: "Functionality",
  user_story: "Requirement",
  task: "Task",
  bug: "Bug",
};

export const TYPE_HINT: Record<WorkItemType, string> = {
  epic: "A large objective we want to achieve.",
  feature: "A capability the software should provide.",
  user_story: "A specific behaviour or outcome the software must support.",
  task: "A piece of work to complete.",
  bug: "Something that is broken or behaves incorrectly.",
};

export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export type ColumnId =
  | "order"
  | "id"
  | "type"
  | "title"
  | "state"
  | "tags"
  | "estimate"
  | "priority"
  | "assignee"
  | "updated";

export const COLUMNS: { id: ColumnId; label: string; hideable: boolean; width: string }[] = [
  { id: "order", label: "Order", hideable: true, width: "104px" },
  { id: "id", label: "ID", hideable: true, width: "168px" },
  { id: "type", label: "Work Item Type", hideable: false, width: "156px" },
  { id: "title", label: "Title", hideable: false, width: "minmax(280px, 1.8fr)" },
  { id: "state", label: "State", hideable: false, width: "128px" },
  { id: "tags", label: "Tags", hideable: true, width: "140px" },
  { id: "estimate", label: "Estimate", hideable: true, width: "104px" },
  { id: "priority", label: "Priority", hideable: true, width: "112px" },
  { id: "assignee", label: "Assigned To", hideable: false, width: "160px" },
  { id: "updated", label: "Updated", hideable: true, width: "176px" },
];

export function isWorkItemType(value: unknown): value is WorkItemType {
  return value === "epic" || value === "feature" || value === "user_story" || value === "task" || value === "bug";
}

export function isTicketType(type: WorkItemType | undefined): boolean {
  return type === "task" || type === "bug" || type === undefined;
}

export function blankHierarchy(): Pick<
  Task,
  | "ticketNumber"
  | "issueType"
  | "platforms"
  | "archivedAt"
  | "archiveVisitedAt"
  | "issueSeverity"
  | "affectedArea"
  | "detailCategory"
  | "workItemType"
  | "parentId"
  | "order"
  | "tags"
  | "priority"
  | "dueDate"
  | "storyPoints"
  | "estimateHours"
  | "acceptanceCriteria"
  | "checklist"
  | "activity"
  | "severity"
  | "environment"
  | "stepsToReproduce"
  | "expectedBehaviour"
  | "actualBehaviour"
  | "githubLinks"
> {
  return {
    ticketNumber: 0,
    issueType: null,
    platforms: [],
    archivedAt: null,
    archiveVisitedAt: null,
    issueSeverity: null,
    affectedArea: "",
    detailCategory: null,
    workItemType: "task",
    parentId: null,
    order: 0,
    tags: [],
    priority: null,
    dueDate: null,
    storyPoints: null,
    estimateHours: null,
    acceptanceCriteria: "",
    checklist: [],
    activity: [],
    severity: null,
    environment: "",
    stepsToReproduce: "",
    expectedBehaviour: "",
    actualBehaviour: "",
    githubLinks: [],
  };
}

/** Types that may sit directly under a parent. Null means a project-level item. */
export function allowedChildTypes(parentType: WorkItemType | null): WorkItemType[] {
  if (parentType === null) return ["epic", "task", "bug"];
  if (parentType === "epic") return ["feature"];
  if (parentType === "feature") return ["user_story"];
  if (parentType === "user_story") return ["task", "bug"];
  return [];
}

export function parentChoices(
  tasks: Task[],
  projectId: string,
  childType: WorkItemType,
  childId?: string,
): Task[] {
  const blocked = new Set(childId ? [childId, ...descendantIds(tasks, childId)] : []);
  return tasks
    .filter(
      (task) => task.projectId === projectId && !blocked.has(task.id) && parentError(childType, task, projectId) === null,
    )
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function parentError(
  childType: WorkItemType,
  parent: Task | null,
  childProjectId: string,
): string | null {
  if (!parent) {
    if (childType === "feature") return "A functionality belongs under a main goal.";
    if (childType === "user_story") return "A requirement belongs under a functionality.";
    return null;
  }
  if (parent.projectId !== childProjectId) {
    return "A work item and its parent must be in the same project.";
  }
  if (childType === "epic") return "A main goal stays at the top of the project.";
  if (childType === "feature" && parent.workItemType !== "epic") return "A functionality belongs under a main goal.";
  if (childType === "user_story" && parent.workItemType !== "feature") {
    return "A requirement belongs under a functionality.";
  }
  if ((childType === "task" || childType === "bug") && parent.workItemType !== "user_story") {
    return "A task or bug belongs under a requirement, or at the project level.";
  }
  return null;
}

export function wouldCycle(tasks: Pick<Task, "id" | "parentId">[], id: string, parentId: string | null): boolean {
  if (!parentId) return false;
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === id || seen.has(current)) return true;
    seen.add(current);
    current = tasks.find((task) => task.id === current)?.parentId ?? null;
  }
  return false;
}

export function descendantIds(tasks: Pick<Task, "id" | "parentId">[], id: string): string[] {
  const result: string[] = [];
  const walk = (parentId: string) => {
    for (const task of tasks) {
      if (task.parentId === parentId) {
        result.push(task.id);
        walk(task.id);
      }
    }
  };
  walk(id);
  return result;
}

export function siblingsOf(tasks: Task[], task: Pick<Task, "id" | "projectId" | "parentId">): Task[] {
  return tasks
    .filter((item) => item.projectId === task.projectId && item.parentId === task.parentId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function moveSibling(tasks: Task[], id: string, direction: "up" | "down"): Task[] | null {
  const task = tasks.find((item) => item.id === id);
  if (!task) return null;
  const group = siblingsOf(tasks, task);
  const index = group.findIndex((item) => item.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= group.length) return null;
  const reordered = group.slice();
  const [item] = reordered.splice(index, 1);
  reordered.splice(target, 0, item);
  const orderOf = new Map(reordered.map((entry, position) => [entry.id, position]));
  return tasks.map((entry) => (orderOf.has(entry.id) ? { ...entry, order: orderOf.get(entry.id) ?? entry.order } : entry));
}

export interface BacklogQuery {
  text: string;
  type: IssueType | "all";
  status: TaskStatus | "all";
  assigneeId: string | "all";
  priority: Priority | "all" | "none";
  tag: string | "all";
  includeArchived: boolean;
}

export const EMPTY_QUERY: BacklogQuery = {
  text: "",
  type: "all",
  status: "all",
  assigneeId: "all",
  priority: "all",
  tag: "all",
  includeArchived: false,
};

export function isQueryActive(query: BacklogQuery): boolean {
  return (
    query.text.trim() !== "" ||
    query.type !== "all" ||
    query.status !== "all" ||
    query.assigneeId !== "all" ||
    query.priority !== "all" ||
    query.tag !== "all" ||
    query.includeArchived
  );
}

export function matchesQuery(task: Task, query: BacklogQuery): boolean {
  if (!query.includeArchived && task.status === "archived") return false;
  if (query.type !== "all" && (task.issueType ?? "review") !== query.type) return false;
  if (query.status !== "all" && task.status !== query.status) return false;
  if (query.assigneeId !== "all" && task.assigneeId !== query.assigneeId) return false;
  if (query.priority === "none") {
    if (task.priority !== null) return false;
  } else if (query.priority !== "all" && task.priority !== query.priority) {
    return false;
  }
  if (query.tag !== "all" && !task.tags.includes(query.tag)) return false;
  const text = query.text.trim().toLowerCase();
  if (!text) return true;
  const haystack = [task.title, task.id, task.description, ...task.tags].join(" ").toLowerCase();
  return haystack.includes(text);
}

export interface ItemRow {
  kind: "item";
  task: Task;
  depth: number;
  hasChildren: boolean;
  ancestorOnly: boolean;
}

export interface ProjectRow {
  kind: "project";
  project: Project;
}

export type BacklogRow = ItemRow | ProjectRow;

function byOrder(a: Task, b: Task): number {
  return a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export interface BacklogSort {
  column: ColumnId;
  direction: "asc" | "desc";
}

export function compareTasks(a: Task, b: Task, sort: BacklogSort, users: User[] = []): number {
  const left = sortKey(a, sort.column, users);
  const right = sortKey(b, sort.column, users);
  if (left.empty !== right.empty) return left.empty ? 1 : -1;
  let result = 0;
  if (left.value < right.value) result = -1;
  else if (left.value > right.value) result = 1;
  else result = a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  if (sort.direction === "desc" && !left.empty && !right.empty) return -result;
  return result;
}

function sortKey(task: Task, column: ColumnId, users: User[]): { empty: boolean; value: string | number } {
  switch (column) {
    case "state":
      return { empty: false, value: TAB_ORDER.indexOf(task.status) };
    case "type":
      return { empty: false, value: TYPE_LABEL[task.workItemType].toLocaleLowerCase() };
    case "title":
      return { empty: false, value: task.title.toLocaleLowerCase() };
    case "id":
      return { empty: false, value: task.id.toLocaleLowerCase() };
    case "order":
      return { empty: false, value: task.order };
    case "updated":
      return { empty: false, value: task.updatedAt };
    case "assignee": {
      const name = users.find((user) => user.id === task.assigneeId)?.name ?? "";
      return { empty: name === "", value: name.toLocaleLowerCase() };
    }
    case "priority":
      return task.priority
        ? { empty: false, value: PRIORITIES.indexOf(task.priority) }
        : { empty: true, value: 0 };
    case "tags": {
      const text = [...task.tags].sort((left, right) => left.localeCompare(right)).join(", ");
      return { empty: text === "", value: text.toLocaleLowerCase() };
    }
    case "estimate": {
      const amount = task.storyPoints ?? task.estimateHours;
      return amount === null ? { empty: true, value: 0 } : { empty: false, value: amount };
    }
  }
}

export function buildRows(
  tasks: Task[],
  projects: Project[],
  projectFilter: string | "all",
  query: BacklogQuery,
  expanded: ReadonlySet<string>,
  sort: BacklogSort | null = null,
  users: User[] = [],
): { rows: BacklogRow[]; forcedOpen: Set<string> } {
  const filterActive = isQueryActive(query);
  const scopedProjects =
    projectFilter === "all" ? projects : projects.filter((project) => project.id === projectFilter);
  const rows: BacklogRow[] = [];
  const forcedOpen = new Set<string>();

  for (const project of scopedProjects) {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const matching = new Set(projectTasks.filter((task) => matchesQuery(task, query)).map((task) => task.id));
    const visible = new Set<string>(matching);
    if (filterActive) {
      for (const id of matching) {
        let parentId = projectTasks.find((task) => task.id === id)?.parentId ?? null;
        while (parentId) {
          visible.add(parentId);
          forcedOpen.add(parentId);
          parentId = projectTasks.find((task) => task.id === parentId)?.parentId ?? null;
        }
      }
    } else {
      for (const task of projectTasks) {
        if (query.includeArchived || task.status !== "archived") visible.add(task.id);
      }
    }

    const childIds = (parentId: string | null) =>
      projectTasks.filter((task) => task.parentId === parentId && visible.has(task.id)).sort(byOrder);

    const hasVisibleChild = (id: string) => childIds(id).length > 0;

    if (projectFilter === "all") {
      if (!filterActive || childIds(null).length > 0 || projectTasks.some((task) => visible.has(task.id))) {
        rows.push({ kind: "project", project });
      }
      const projectKey = `project:${project.id}`;
      const projectOpen = filterActive || expanded.has(projectKey);
      if (filterActive && projectTasks.some((task) => visible.has(task.id))) forcedOpen.add(projectKey);
      if (!projectOpen && !filterActive) continue;
      if (filterActive && !projectTasks.some((task) => visible.has(task.id))) continue;
    }

    if (sort) {
      const items = projectTasks
        .filter((task) => visible.has(task.id))
        .sort((left, right) => compareTasks(left, right, sort, users));
      for (const task of items) {
        rows.push({
          kind: "item",
          task,
          depth: 0,
          hasChildren: false,
          ancestorOnly: filterActive && !matching.has(task.id),
        });
      }
      continue;
    }

    const walk = (parentId: string | null, depth: number) => {
      for (const task of childIds(parentId)) {
        const children = hasVisibleChild(task.id);
        const open = children && (filterActive ? forcedOpen.has(task.id) || expanded.has(task.id) : expanded.has(task.id));
        rows.push({
          kind: "item",
          task,
          depth,
          hasChildren: children,
          ancestorOnly: filterActive && !matching.has(task.id),
        });
        if (open) walk(task.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  return { rows, forcedOpen };
}

export function estimateLabel(task: Task): string {
  if (task.workItemType === "user_story" && task.storyPoints !== null) return `${task.storyPoints} pts`;
  if ((task.workItemType === "task" || task.workItemType === "bug") && task.estimateHours !== null) {
    return `${task.estimateHours}h`;
  }
  return "—";
}

export function columnTemplate(visible: ColumnId[]): string {
  return COLUMNS.filter((column) => visible.includes(column.id))
    .map((column) => column.width)
    .join(" ");
}
