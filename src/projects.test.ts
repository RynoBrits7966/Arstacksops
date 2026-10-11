import { describe, expect, it } from "vitest";
import {
  compareDeadlinePriority,
  isColorTaken,
  isDeadlinePriority,
  isPastDeadline,
  nextProjectColor,
  sortProjects,
} from "./projects";

describe("sortProjects", () => {
  it("puts the soonest deadline first and N/A last", () => {
    const sorted = sortProjects([
      { name: "Zulu", deadline: null },
      { name: "Bravo", deadline: "2026-12-01" },
      { name: "Alpha", deadline: "2026-10-01" },
      { name: "Charlie", deadline: null },
    ]);
    expect(sorted.map((project) => project.name)).toEqual(["Alpha", "Bravo", "Charlie", "Zulu"]);
  });
});

describe("project colours", () => {
  it("skips a colour another project already uses", () => {
    expect(isColorTaken(["#3d7ea6"], "#3D7EA6")).toBe(true);
    expect(nextProjectColor(["#eb8536", "#3d7ea6"])).toBe("#2f7d4a");
    expect(isColorTaken(["#2f7d4a"], nextProjectColor(["#3d7ea6"]))).toBe(false);
  });
});

describe("deadline priority", () => {
  const now = new Date(2026, 9, 8);

  it("flags a deadline within 10 days, including one already past", () => {
    expect(isDeadlinePriority("2026-10-18", now)).toBe(true);
    expect(isDeadlinePriority("2026-10-07", now)).toBe(true);
    expect(isDeadlinePriority("2026-10-19", now)).toBe(false);
    expect(isDeadlinePriority(null, now)).toBe(false);
  });

  it("sorts the closest deadline above one that is not due soon", () => {
    expect(compareDeadlinePriority("2026-10-12", "2026-12-01", now)).toBeLessThan(0);
    expect(compareDeadlinePriority("2026-10-07", "2026-10-15", now)).toBeLessThan(0);
    expect(compareDeadlinePriority(null, "2026-10-15", now)).toBeGreaterThan(0);
  });
});

describe("isPastDeadline", () => {
  it("treats an earlier calendar day as overdue", () => {
    const now = new Date(2026, 9, 8);
    expect(isPastDeadline("2026-10-07", now)).toBe(true);
    expect(isPastDeadline("2026-10-08", now)).toBe(false);
  });
});
