import { blankHierarchy } from "../backlog/model";
import { PROJECT_COLORS } from "../projects";
import type { Snapshot } from "./snapshot";
import type { DetailCategory, IssueSeverity, IssueType, Project, Task, TaskStatus, User } from "../types";

const EXTRA_USERS: User[] = [
  { id: "user-riley", name: "Riley Chen" },
  { id: "user-morgan", name: "Morgan Blake" },
  { id: "user-casey", name: "Casey Nguyen" },
  { id: "user-avery", name: "Avery Brooks" },
  { id: "user-quinn", name: "Quinn Hassan" },
  { id: "user-drew", name: "Drew Okonkwo" },
  { id: "user-parker", name: "Parker Singh" },
];

const MOCK_PROJECTS: { id: string; name: string; client: string; deadline: string | null }[] = [
  { id: "mock-dispatch", name: "Dispatch", client: "Northline Freight", deadline: "2026-10-15" },
  { id: "mock-portal", name: "Client portal", client: "Kite & Co", deadline: "2026-11-02" },
  { id: "mock-checkout", name: "Checkout", client: "Lumen Market", deadline: "2026-10-06" },
  { id: "mock-roster", name: "Roster", client: "Bright Clinic", deadline: null },
  { id: "mock-warehouse", name: "Warehouse", client: "Oak Yard", deadline: "2026-12-01" },
];

const ISSUES_PER_PROJECT = 70;

const TYPE_CYCLE: IssueType[] = ["bug", "ui", "improvement", "bug", "improvement"];
const SEVERITY_CYCLE: (IssueSeverity | null)[] = ["critical", "major", "major", "minor", "minor", null];
const STATUS_CYCLE: TaskStatus[] = [
  "new",
  "new",
  "in_progress",
  "in_progress",
  "in_progress",
  "resolved",
  "resolved",
  "escalated",
  "closed",
  "archived",
];
const DETAIL_CYCLE: DetailCategory[] = [
  "spacing",
  "alignment",
  "typography",
  "colour",
  "sizing",
  "responsiveness",
  "other",
];

const TITLES = [
  "Save drops the last line",
  "Button sits on the total",
  "Filter forgets the project",
  "Header wraps on a phone",
  "Export skips March",
  "Empty state has no action",
  "Search ignores the ticket id",
  "Modal closes on the first click",
  "Table columns collide",
  "Colour of the overdue date is faint",
  "Keyboard focus skips the assign field",
  "Refresh loses the open issue",
];

function stamp(daysAgo: number, hours: number): string {
  const date = new Date(Date.UTC(2026, 9, 8, 16, 0, 0));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(date.getUTCHours() - hours);
  return date.toISOString();
}

function issueTitle(projectName: string, index: number): string {
  return `${TITLES[index % TITLES.length]} on ${projectName}`;
}

/** Adds five projects, extra people, and about 70 issues on each new project. Existing records stay. Safe to run again. */
export function mergeMockVolume(snapshot: Snapshot): boolean {
  if (snapshot.projects.some((project) => project.id.startsWith("mock-"))) return false;

  for (const user of EXTRA_USERS) {
    if (!snapshot.users.some((item) => item.id === user.id)) snapshot.users.push({ ...user });
  }

  const usedColors = snapshot.projects.map((project) => project.color);
  const projects: Project[] = MOCK_PROJECTS.map((project, index) => {
    const color = PROJECT_COLORS.find((item) => !usedColors.includes(item)) ?? `#${(index + 3).toString(16).padStart(6, "0")}`;
    usedColors.push(color);
    return {
      id: project.id,
      name: project.name,
      client: project.client,
      color,
      deadline: project.deadline,
      createdAt: stamp(20, index),
    };
  });
  snapshot.projects.push(...projects);

  const people = snapshot.users.map((user) => user.id);
  const tasks: Task[] = [];
  for (const project of projects) {
    for (let index = 0; index < ISSUES_PER_PROJECT; index += 1) {
      const issueType = TYPE_CYCLE[index % TYPE_CYCLE.length];
      const issueSeverity = SEVERITY_CYCLE[index % SEVERITY_CYCLE.length];
      const status = STATUS_CYCLE[index % STATUS_CYCLE.length];
      const assigneeId = people[index % people.length] ?? people[0] ?? "";
      const createdAt = stamp(index % 12, index % 8);
      const recent = stamp(index % 4, index % 5);
      const workedAt = status === "archived" ? stamp(12, 2) : recent;
      const escalatedToId = status === "escalated" ? people[(index + 3) % people.length] ?? null : null;
      const task: Task = {
        ...blankHierarchy(),
        id: `${project.id}-${index + 1}`,
        projectId: project.id,
        assigneeId,
        acceptedAt: status === "new" ? null : createdAt,
        escalatedToId,
        escalationSeenAt: status === "escalated" && index % 2 === 0 ? null : status === "escalated" ? recent : null,
        title: issueTitle(project.name, index),
        description:
          issueType === "bug"
            ? "Something that used to work now fails for this project."
            : issueType === "ui"
              ? "The layout is off in the place named below."
              : "A requested change for this project.",
        status,
        createdAt,
        updatedAt: recent,
        lastWorkedAt: workedAt,
        closedAt: status === "closed" || status === "archived" ? recent : null,
        ticketNumber: index + 1,
        issueType,
        issueSeverity,
        affectedArea: issueType === "ui" ? `${project.name} / ${TITLES[index % TITLES.length]}` : "",
        detailCategory: issueType === "ui" ? DETAIL_CYCLE[index % DETAIL_CYCLE.length] : null,
        workItemType: issueType === "bug" ? "bug" : "task",
        order: index,
        stepsToReproduce: issueType === "bug" ? "Open the screen, follow the usual path, and watch the result." : "",
        expectedBehaviour: issueType === "bug" ? "The action completes and the screen stays aligned." : "",
        actualBehaviour: issueType === "bug" ? "The action stops or the layout slips." : "",
        checklist:
          index % 6 === 0
            ? [
                { id: `${project.id}-${index + 1}-a`, label: "Confirm on desktop", done: true },
                { id: `${project.id}-${index + 1}-b`, label: "Confirm on a phone", done: false },
              ]
            : [],
        activity: [{ id: `${project.id}-${index + 1}-made`, at: createdAt, authorId: assigneeId, message: "Created" }],
      };
      tasks.push(task);
    }
  }
  snapshot.tasks.push(...tasks);
  return true;
}
