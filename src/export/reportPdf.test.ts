import { describe, expect, it } from "vitest";
import { blankHierarchy } from "../backlog/model";
import type { Project, Task, User } from "../types";
import { buildReportPdf } from "./reportPdf";

function task(patch: Partial<Task> & Pick<Task, "id" | "title" | "projectId">): Task {
  return {
    ...blankHierarchy(),
    assigneeId: "user-sam",
    acceptedAt: null,
    escalatedToId: null,
    escalationSeenAt: null,
    description: "Stops halfway",
    status: "in_progress",
    createdAt: "2026-10-08T16:30:00.000Z",
    updatedAt: "2026-10-08T16:30:00.000Z",
    lastWorkedAt: "2026-10-08T16:30:00.000Z",
    closedAt: null,
    ticketNumber: 1,
    ...patch,
  };
}

const projects: Project[] = [
  {
    id: "billing",
    name: "Billing",
    color: "#3d7ea6",
    client: "Harbour & Co",
    deadline: "2026-10-20",
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

const users: User[] = [{ id: "user-sam", name: "Sam Patel" }];

describe("report pdf", () => {
  it("builds a readable PDF of the tickets", () => {
    const pdf = buildReportPdf({
      projects,
      users,
      exportedAt: new Date("2026-10-11T15:00:00.000Z"),
      tasks: [task({ id: "invoice", title: "Invoice export fails for March", projectId: "billing" })],
    });
    const text = new TextDecoder().decode(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Invoice export fails for March");
    expect(text).toContain("Billing-1");
    expect(text).toContain("Harbour & Co");
    expect(text).toContain("Sam Patel");
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("continues onto another page when the list is long", () => {
    const tasks = Array.from({ length: 80 }, (_, index) =>
      task({
        id: `t-${index}`,
        title: `Longer ticket title number ${index} that should wrap onto the page`,
        projectId: "billing",
        ticketNumber: index + 1,
        description: "A requested change for this project that needs a second line in the export.",
      }),
    );
    const text = new TextDecoder().decode(buildReportPdf({ projects, users, tasks }));
    expect(text).toContain("/Count 6");
    expect(text).toContain("Page 2");
  });
});
