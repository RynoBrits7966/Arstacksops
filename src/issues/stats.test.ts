import { describe, expect, it } from "vitest";
import { blankHierarchy } from "../backlog/model";
import type { Task } from "../types";
import { busiestLabel, severityCounts, typeCounts } from "./stats";

function issue(patch: Partial<Task> & Pick<Task, "id">): Task {
  return {
    ...blankHierarchy(),
    projectId: "billing",
    assigneeId: "user-sam",
    acceptedAt: null,
    escalatedToId: null,
    escalationSeenAt: null,
    title: patch.id,
    description: "",
    status: "new",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    lastWorkedAt: "2026-10-01T00:00:00.000Z",
    closedAt: null,
    ...patch,
  };
}

describe("issue statistics", () => {
  const tasks = [
    issue({ id: "a", issueType: "bug", issueSeverity: "critical" }),
    issue({ id: "b", issueType: "bug", issueSeverity: "major" }),
    issue({ id: "c", issueType: "ui", issueSeverity: null }),
    issue({ id: "d", issueType: null, issueSeverity: null }),
  ];

  it("counts types and severities, including items that are still unset", () => {
    expect(typeCounts(tasks).map((row) => [row.label, row.count])).toEqual([
      ["Bugs", 2],
      ["UI / Detailing", 1],
      ["Improvements", 0],
      ["New features", 0],
      ["Questions / Clarifications", 0],
      ["Review", 1],
    ]);
    expect(severityCounts(tasks).map((row) => [row.label, row.count])).toEqual([
      ["Critical", 1],
      ["Major", 1],
      ["Minor", 0],
      ["Not set", 2],
    ]);
  });

  it("names the largest group", () => {
    expect(busiestLabel(typeCounts(tasks))).toBe("Bugs has the most, with 2.");
    expect(busiestLabel(severityCounts(tasks))).toBe("Not set has the most, with 2.");
    expect(busiestLabel(typeCounts([]))).toBeNull();
  });
});
