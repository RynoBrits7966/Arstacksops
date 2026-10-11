import { describe, expect, it } from "vitest";
import { blankHierarchy } from "../backlog/model";
import { compareIssues } from "./sort";
import type { Project, Task, User } from "../types";

function task(patch: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    ...blankHierarchy(),
    projectId: "billing",
    assigneeId: "user-sam",
    acceptedAt: null,
    escalatedToId: null,
    escalationSeenAt: null,
    description: "",
    status: "in_progress",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastWorkedAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...patch,
  };
}

const projects: Project[] = [
  { id: "billing", name: "Billing", color: "#3d7ea6", client: "", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: "field", name: "Field App", color: "#eb8536", client: "", deadline: null, createdAt: "2026-10-01T00:00:00.000Z" },
];

const users: User[] = [
  { id: "user-sam", name: "Sam Patel" },
  { id: "user-alex", name: "Alex Morgan" },
];

describe("issue header sort", () => {
  const items = [
    task({ id: "b", title: "Pins", issueType: "bug", issueSeverity: "minor", projectId: "field", assigneeId: "user-alex" }),
    task({ id: "a", title: "Invoice", issueType: "improvement", issueSeverity: "critical" }),
    task({ id: "c", title: "Layout", issueType: null, issueSeverity: null, assigneeId: "" }),
  ];

  it("sorts issue type A to Z, treating an unset type as Review", () => {
    const titles = [...items]
      .sort((a, b) => compareIssues(a, b, { column: "issueType", direction: "asc" }, projects, users))
      .map((item) => item.title);
    expect(titles).toEqual(["Pins", "Invoice", "Layout"]);
  });

  it("puts unset severity last when the direction flips", () => {
    const titles = [...items]
      .sort((a, b) => compareIssues(a, b, { column: "severity", direction: "desc" }, projects, users))
      .map((item) => item.title);
    expect(titles).toEqual(["Pins", "Invoice", "Layout"]);
  });

  it("sorts assignees and leaves unassigned at the bottom", () => {
    const titles = [...items]
      .sort((a, b) => compareIssues(a, b, { column: "assignee", direction: "asc" }, projects, users))
      .map((item) => item.title);
    expect(titles).toEqual(["Pins", "Invoice", "Layout"]);
  });
});
