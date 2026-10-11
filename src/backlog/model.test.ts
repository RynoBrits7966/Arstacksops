import { describe, expect, it } from "vitest";
import { blankHierarchy, buildRows, descendantIds, matchesQuery, moveSibling, parentError, wouldCycle } from "./model";
import type { Project, Task } from "../types";

function task(patch: Partial<Task> & Pick<Task, "id" | "title" | "projectId">): Task {
  return {
    ...blankHierarchy(),
    assigneeId: "",
    acceptedAt: null,
    escalatedToId: null,
    escalationSeenAt: null,
    description: "",
    status: "new",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastWorkedAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...patch,
  };
}

const projects: Project[] = [
  {
    id: "project-billing",
    name: "Billing",
    color: "#3d7ea6",
    client: "Harbour & Co",
    deadline: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

describe("hierarchy rules", () => {
  const epic = task({ id: "E-1", title: "Portal", projectId: "project-billing", workItemType: "epic" });
  const feature = task({
    id: "F-1",
    title: "Login",
    projectId: "project-billing",
    workItemType: "feature",
    parentId: "E-1",
  });
  const story = task({
    id: "US-1",
    title: "Sign in",
    projectId: "project-billing",
    workItemType: "user_story",
    parentId: "F-1",
  });

  it("allows a task at project level and under a user story", () => {
    expect(parentError("task", null, "project-billing")).toBeNull();
    expect(parentError("task", story, "project-billing")).toBeNull();
    expect(parentError("bug", epic, "project-billing")).toMatch(/requirement/);
  });

  it("rejects a feature without an epic and a parent in another project", () => {
    expect(parentError("feature", null, "project-billing")).toMatch(/main goal/);
    const other = { ...epic, projectId: "project-field" };
    expect(parentError("feature", other, "project-billing")).toMatch(/same project/);
  });

  it("detects cycles and lists descendants", () => {
    const items = [epic, feature, story];
    expect(wouldCycle(items, "E-1", "US-1")).toBe(true);
    expect(wouldCycle(items, "US-1", null)).toBe(false);
    expect(descendantIds(items, "E-1")).toEqual(["F-1", "US-1"]);
  });

  it("reorders siblings without moving other items", () => {
    const first = task({ id: "T-1", title: "One", projectId: "project-billing", order: 0 });
    const second = task({ id: "T-2", title: "Two", projectId: "project-billing", order: 1 });
    const other = task({ id: "T-3", title: "Child", projectId: "project-billing", parentId: "US-1", order: 0 });
    const next = moveSibling([first, second, other], "T-2", "up");
    expect(next?.find((item) => item.id === "T-2")?.order).toBe(0);
    expect(next?.find((item) => item.id === "T-1")?.order).toBe(1);
    expect(next?.find((item) => item.id === "T-3")?.order).toBe(0);
    expect(moveSibling([first, second], "T-1", "up")).toBeNull();
  });
});

describe("backlog rows", () => {
  const epic = task({ id: "E-1", title: "Portal", projectId: "project-billing", workItemType: "epic", order: 0 });
  const storyTask = task({
    id: "T-9",
    title: "Reset password",
    projectId: "project-billing",
    parentId: "E-1",
    order: 0,
    tags: ["login"],
  });

  it("keeps ancestors when a descendant matches and marks them as context", () => {
    const { rows, forcedOpen } = buildRows(
      [epic, storyTask],
      projects,
      "project-billing",
      {
        text: "password",
        type: "all",
        status: "all",
        assigneeId: "all",
        priority: "all",
        tag: "all",
        includeArchived: false,
      },
      new Set(),
    );
    expect(rows.map((row) => (row.kind === "item" ? row.task.id : row.project.id))).toEqual(["E-1", "T-9"]);
    expect(rows[0]).toMatchObject({ kind: "item", ancestorOnly: true });
    expect(rows[1]).toMatchObject({ kind: "item", ancestorOnly: false });
    expect(forcedOpen.has("E-1")).toBe(true);
    expect(matchesQuery(storyTask, { text: "", type: "review", status: "all", assigneeId: "all", priority: "all", tag: "login", includeArchived: false })).toBe(true);
    expect(matchesQuery({ ...storyTask, issueType: "bug" }, { text: "", type: "bug", status: "all", assigneeId: "all", priority: "all", tag: "login", includeArchived: false })).toBe(true);
    expect(matchesQuery(storyTask, { text: "", type: "new_feature", status: "all", assigneeId: "all", priority: "all", tag: "all", includeArchived: false })).toBe(false);
  });

  it("hides collapsed descendants until the parent is expanded", () => {
    const feature = task({
      id: "F-1",
      title: "Accounts",
      projectId: "project-billing",
      workItemType: "feature",
      parentId: "E-1",
    });
    const collapsed = buildRows([epic, feature], projects, "project-billing", {
      text: "",
      type: "all",
      status: "all",
      assigneeId: "all",
      priority: "all",
      tag: "all",
      includeArchived: false,
    }, new Set());
    expect(collapsed.rows.filter((row) => row.kind === "item").map((row) => row.kind === "item" && row.task.id)).toEqual(["E-1"]);
    const open = buildRows([epic, feature], projects, "project-billing", {
      text: "",
      type: "all",
      status: "all",
      assigneeId: "all",
      priority: "all",
      tag: "all",
      includeArchived: false,
    }, new Set(["E-1"]));
    expect(open.rows.filter((row) => row.kind === "item")).toHaveLength(2);
  });
});

describe("backlog column sort", () => {
  const query = {
    text: "",
    type: "all" as const,
    status: "all" as const,
    assigneeId: "all" as const,
    priority: "all" as const,
    tag: "all" as const,
    includeArchived: true,
  };

  it("sorts state from New through Archive, then reverses", () => {
    const items = [
      task({ id: "A", title: "Closed one", projectId: "project-billing", status: "closed" }),
      task({ id: "B", title: "New one", projectId: "project-billing", status: "new" }),
      task({ id: "C", title: "Progress one", projectId: "project-billing", status: "in_progress" }),
      task({ id: "D", title: "Archive one", projectId: "project-billing", status: "archived" }),
    ];
    const ascending = buildRows(items, projects, "project-billing", query, new Set(), { column: "state", direction: "asc" });
    expect(ascending.rows.map((row) => row.kind === "item" && row.task.status)).toEqual([
      "new",
      "in_progress",
      "closed",
      "archived",
    ]);
    const descending = buildRows(items, projects, "project-billing", query, new Set(), { column: "state", direction: "desc" });
    expect(descending.rows.map((row) => row.kind === "item" && row.task.status)).toEqual([
      "archived",
      "closed",
      "in_progress",
      "new",
    ]);
  });
});
