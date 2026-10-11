import { describe, expect, it } from "vitest";
import { buildSnapshot, hierarchyIssues, inspectImport } from "./snapshot";

describe("snapshot migration", () => {
  it("keeps existing ids and defaults a missing type to task at project level", () => {
    const first = buildSnapshot({
      projects: [{ id: "project-billing", name: "Billing", color: "#3d7ea6", client: "Harbour & Co", deadline: "2026-10-20", createdAt: "2026-10-07T00:00:00.000Z" }],
      users: [{ id: "user-sam", name: "Sam Patel" }],
      tasks: [
        {
          id: "task-invoice",
          projectId: "project-billing",
          assigneeId: "user-sam",
          title: "Invoice export fails for March",
          description: "Stops halfway",
          status: "in_progress",
          createdAt: "2026-10-08T16:30:00.000Z",
          updatedAt: "2026-10-08T16:30:00.000Z",
          lastWorkedAt: "2026-10-08T16:30:00.000Z",
          closedAt: null,
          acceptedAt: "2026-10-08T16:30:00.000Z",
        },
      ],
      comments: [],
      attachments: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.snapshot.tasks[0]).toMatchObject({
      id: "task-invoice",
      title: "Invoice export fails for March",
      description: "Stops halfway",
      status: "in_progress",
      assigneeId: "user-sam",
      workItemType: "task",
      parentId: null,
    });
    const second = buildSnapshot(first.snapshot);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.changed).toBe(false);
    expect(second.snapshot.tasks[0].id).toBe("task-invoice");
    expect(second.snapshot.tasks[0].issueType).toBe("improvement");
    expect(second.snapshot.tasks[0].issueSeverity).toBeNull();
    expect(second.snapshot.tasks[0].ticketNumber).toBe(1);
  });

  it("preserves a valid type and detaches an invalid parent", () => {
    const built = buildSnapshot({
      projects: [{ id: "p1", name: "One", color: "#3d7ea6", client: "A", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" }],
      tasks: [
        { id: "bug-1", projectId: "p1", title: "Crash", status: "new", workItemType: "bug", parentId: "missing", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.tasks[0].workItemType).toBe("bug");
    expect(built.snapshot.tasks[0].parentId).toBeNull();
  });

  it("rejects an import that would create a cycle", () => {
    const result = inspectImport(
      JSON.stringify({
        version: 1,
        projects: [{ id: "p1", name: "One", color: "#3d7ea6", client: "A", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" }],
        tasks: [
          { id: "E-1", projectId: "p1", title: "Epic", status: "new", workItemType: "epic", parentId: "F-1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", order: 0 },
          { id: "F-1", projectId: "p1", title: "Feature", status: "new", workItemType: "feature", parentId: "E-1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", order: 0 },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/cycle|epic/i);
  });

  it("reports unreadable JSON without a snapshot", () => {
    const result = inspectImport("{");
    expect(result.ok).toBe(false);
  });
});

describe("hierarchyIssues", () => {
  it("flags a parent in another project", () => {
    const built = buildSnapshot({
      projects: [
        { id: "p1", name: "One", color: "#3d7ea6", client: "A", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
        { id: "p2", name: "Two", color: "#2f7d4a", client: "B", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
      ],
      tasks: [
        { id: "E-1", projectId: "p1", title: "Epic", status: "new", workItemType: "epic", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", order: 0 },
        { id: "F-1", projectId: "p2", title: "Feature", status: "new", workItemType: "feature", parentId: "E-1", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", order: 0 },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.snapshot.tasks.find((task) => task.id === "F-1")?.parentId).toBeNull();
    const snapshot = built.snapshot;
    snapshot.tasks = snapshot.tasks.map((task) => (task.id === "F-1" ? { ...task, parentId: "E-1" } : task));
    expect(hierarchyIssues(snapshot).join(" ")).toMatch(/same project/);
  });

  it("classifies tasks and bugs, names unset types Review, and keeps ticket numbers on a second pass", () => {
    const built = buildSnapshot({
      projects: [
        { id: "billing", name: "Billing", color: "#3d7ea6", client: "Harbour & Co", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
        { id: "field", name: "Field App", color: "#eb8536", client: "North Range", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
      ],
      tasks: [
        { id: "task-invoice", projectId: "billing", title: "Invoice", status: "in_progress", workItemType: "task", severity: "high", parentId: null, createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z" },
        { id: "bug-1", projectId: "billing", title: "Crash", status: "new", workItemType: "bug", parentId: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "E-1", projectId: "field", title: "Portal", status: "new", workItemType: "epic", parentId: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "kept", projectId: "field", title: "Already typed", status: "new", workItemType: "task", issueType: "ui", issueSeverity: "minor", ticketNumber: 4, parentId: null, createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z" },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const byId = Object.fromEntries(built.snapshot.tasks.map((task) => [task.id, task]));
    expect(byId["bug-1"]).toMatchObject({ issueType: "bug", issueSeverity: null, ticketNumber: 1, parentId: null });
    expect(byId["task-invoice"]).toMatchObject({ issueType: "improvement", issueSeverity: null, severity: "high", ticketNumber: 2, parentId: null });
    expect(byId["E-1"]).toMatchObject({ issueType: "review", issueSeverity: null, workItemType: "epic", ticketNumber: 1 });
    expect(byId.kept).toMatchObject({ issueType: "ui", issueSeverity: "minor", ticketNumber: 4, parentId: null, workItemType: "task" });
    const again = buildSnapshot(built.snapshot);
    expect(again.ok && again.changed).toBe(false);
  });
});
