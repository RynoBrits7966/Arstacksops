import { describe, expect, it } from "vitest";
import { blankHierarchy } from "../backlog/model";
import type { Project, Task, User } from "../types";
import { buildReportXlsx, workbookFilename } from "./reportXlsx";
import { unzipStore } from "./zip";

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

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

const billing: Project = {
  id: "billing",
  name: "Billing",
  color: "#3d7ea6",
  client: "Harbour & Co",
  deadline: "2026-10-20",
  createdAt: "2026-10-01T00:00:00.000Z",
};

const field: Project = {
  id: "field",
  name: "Field App",
  color: "#eb8536",
  client: "North Range",
  deadline: null,
  createdAt: "2026-10-02T00:00:00.000Z",
};

const users: User[] = [{ id: "user-sam", name: "Sam Patel" }];

function text(entries: { name: string; data: Uint8Array }[], name: string): string {
  const entry = entries.find((item) => item.name === name);
  expect(entry).toBeTruthy();
  return new TextDecoder().decode(entry?.data ?? new Uint8Array());
}

describe("report workbook", () => {
  it("builds an xlsx of one project's issues and embeds its screenshot", () => {
    const bytes = buildReportXlsx({
      projects: [billing],
      users,
      tasks: [task({ id: "invoice", title: "Invoice export fails for March", projectId: "billing", ticketNumber: 3 })],
      photos: [
        {
          taskId: "invoice",
          fileName: "march.png",
          mimeType: "image/png",
          createdAt: "2026-10-08T16:40:00.000Z",
          bytes: PNG,
        },
      ],
    });
    expect(workbookFilename("Billing")).toBe("Billing.xlsx");
    const entries = unzipStore(bytes);
    const issues = text(entries, "xl/worksheets/sheet1.xml");
    const photos = text(entries, "xl/worksheets/sheet2.xml");
    const drawing = text(entries, "xl/drawings/drawing1.xml");
    expect(issues).toContain("Invoice export fails for March");
    expect(issues).toContain("Billing-3");
    expect(issues).toContain("Harbour &amp; Co");
    expect(issues).toContain("Sam Patel");
    expect(issues).toContain("march.png");
    expect(photos).toContain("xl/media/image1.png");
    expect(drawing).toContain('r:embed="rId1"');
    expect(entries.find((entry) => entry.name === "xl/media/image1.png")?.data).toEqual(PNG);
    expect(text(entries, "[Content_Types].xml")).toContain("image/png");
  });

  it("includes every project and keeps a photo Excel cannot embed inside the file", () => {
    const heic = new TextEncoder().encode("heic-photo-bytes");
    const bytes = buildReportXlsx({
      projects: [field, billing],
      users,
      tasks: [
        task({ id: "gate", title: "Gate photo is sideways", projectId: "field", ticketNumber: 1 }),
        task({ id: "invoice", title: "Invoice export fails for March", projectId: "billing", ticketNumber: 2 }),
      ],
      photos: [
        {
          taskId: "gate",
          fileName: "gate.heic",
          mimeType: "image/heic",
          createdAt: "2026-10-08T16:40:00.000Z",
          bytes: heic,
        },
      ],
    });
    expect(workbookFilename(null)).toBe("arstacksops-all-projects.xlsx");
    const entries = unzipStore(bytes);
    const issues = text(entries, "xl/worksheets/sheet1.xml");
    const photos = text(entries, "xl/worksheets/sheet2.xml");
    expect(issues).toContain("Gate photo is sideways");
    expect(issues).toContain("Invoice export fails for March");
    expect(issues).toContain("Field App-1");
    expect(issues).toContain("Billing-2");
    expect(photos).toContain("xl/media/image1.heic");
    expect(photos).toContain("Open xl/media/image1.heic");
    expect(entries.find((entry) => entry.name === "xl/media/image1.heic")?.data).toEqual(heic);
    expect(entries.some((entry) => entry.name === "xl/drawings/drawing1.xml")).toBe(false);
  });

  it("still produces a workbook when a project has no issues or screenshots", () => {
    const entries = unzipStore(buildReportXlsx({ projects: [billing], users, tasks: [], photos: [] }));
    expect(text(entries, "xl/worksheets/sheet1.xml")).toContain("No issues yet.");
    expect(text(entries, "xl/worksheets/sheet2.xml")).toContain("No screenshots on these issues.");
  });
});
