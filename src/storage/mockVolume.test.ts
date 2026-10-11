import { describe, expect, it } from "vitest";
import { emptySnapshot, type Snapshot } from "./snapshot";
import { mergeMockVolume } from "./mockVolume";

function sample(): Snapshot {
  const snapshot = emptySnapshot();
  snapshot.users = [
    { id: "user-alex", name: "Alex Morgan" },
    { id: "user-jordan", name: "Jordan Lee" },
    { id: "user-sam", name: "Sam Patel" },
  ];
  snapshot.projects = [
    {
      id: "project-billing",
      name: "Billing",
      color: "#3d7ea6",
      client: "Harbour & Co",
      deadline: "2026-10-20",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  snapshot.tasks = [
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
      escalatedToId: null,
      escalationSeenAt: null,
      ticketNumber: 1,
      issueType: "improvement",
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
    },
  ];
  return snapshot;
}

describe("mock volume", () => {
  it("adds five projects and about 70 issues on each without touching existing work", () => {
    const snapshot = sample();
    expect(mergeMockVolume(snapshot)).toBe(true);
    const mockProjects = snapshot.projects.filter((project) => project.id.startsWith("mock-"));
    expect(mockProjects).toHaveLength(5);
    expect(new Set(snapshot.projects.map((project) => project.color)).size).toBe(snapshot.projects.length);
    expect(snapshot.users).toHaveLength(10);
    for (const project of mockProjects) {
      const count = snapshot.tasks.filter((task) => task.projectId === project.id).length;
      expect(count).toBeGreaterThanOrEqual(68);
      expect(count).toBeLessThanOrEqual(72);
    }
    expect(snapshot.tasks.find((task) => task.id === "task-invoice")?.title).toBe("Invoice export fails for March");
    expect(mergeMockVolume(snapshot)).toBe(false);
    expect(snapshot.tasks.filter((task) => task.id === "task-invoice")).toHaveLength(1);
  });
});