import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VISIT_DAYS,
  IDLE_ARCHIVE_DAYS,
  archiveNeedsVisit,
  formatIdleLeft,
  latestWorkAt,
  shouldArchive,
  statusAfterMove,
} from "./archive";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function movedDaysBefore(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

describe("shouldArchive", () => {
  it("keeps a ticket that moved 6 days ago", () => {
    expect(shouldArchive({ status: "in_progress", lastWorkedAt: movedDaysBefore(6) }, NOW)).toBe(false);
  });

  it("archives any ticket with no movement for 7 days", () => {
    for (const status of ["new", "in_progress", "resolved", "escalated", "closed"] as const) {
      expect(shouldArchive({ status, lastWorkedAt: movedDaysBefore(IDLE_ARCHIVE_DAYS) }, NOW)).toBe(true);
    }
  });

  it("stays one millisecond before 7 days", () => {
    const lastWorkedAt = new Date(NOW.getTime() - IDLE_ARCHIVE_DAYS * DAY_MS + 1).toISOString();
    expect(shouldArchive({ status: "new", lastWorkedAt }, NOW)).toBe(false);
  });

  it("leaves tickets that are already in Archive", () => {
    expect(shouldArchive({ status: "archived", lastWorkedAt: movedDaysBefore(30) }, NOW)).toBe(false);
  });
});

describe("archiveNeedsVisit", () => {
  it("marks an archived ticket after 3 days until someone opens it", () => {
    const archivedAt = movedDaysBefore(ARCHIVE_VISIT_DAYS);
    expect(archiveNeedsVisit({ status: "archived", archivedAt, archiveVisitedAt: null }, NOW)).toBe(true);
    expect(archiveNeedsVisit({ status: "archived", archivedAt, archiveVisitedAt: NOW.toISOString() }, NOW)).toBe(false);
  });

  it("stays quiet for the first 3 days in Archive", () => {
    const archivedAt = new Date(NOW.getTime() - ARCHIVE_VISIT_DAYS * DAY_MS + 1).toISOString();
    expect(archiveNeedsVisit({ status: "archived", archivedAt, archiveVisitedAt: null }, NOW)).toBe(false);
    expect(archiveNeedsVisit({ status: "closed", archivedAt, archiveVisitedAt: null }, NOW)).toBe(false);
  });
});

describe("formatIdleLeft", () => {
  it("counts the days left before archive", () => {
    expect(formatIdleLeft(movedDaysBefore(2), NOW)).toBe(
      "5 days left if no one comments or resolves it",
    );
  });

  it("says the wait is over when 7 days have passed", () => {
    expect(formatIdleLeft(movedDaysBefore(7), NOW)).toBe(
      "No comments or resolution for 7 days. Moves to archive.",
    );
  });
});

describe("latestWorkAt", () => {
  it("keeps a ticket alive when a comment is newer than the last status change", () => {
    const comment = movedDaysBefore(1);
    expect(
      latestWorkAt({ lastWorkedAt: movedDaysBefore(8), updatedAt: movedDaysBefore(8) }, [comment]),
    ).toBe(comment);
    expect(
      shouldArchive(
        { status: "in_progress", lastWorkedAt: latestWorkAt({ lastWorkedAt: movedDaysBefore(8) }, [comment]) },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("statusAfterMove", () => {
  it("records when a task is closed", () => {
    expect(statusAfterMove("in_progress", "closed", null, NOW)).toEqual({
      status: "closed",
      closedAt: NOW.toISOString(),
    });
  });

  it("keeps the original closed time while the task stays closed", () => {
    const closedAt = "2026-09-01T00:00:00.000Z";
    expect(statusAfterMove("closed", "closed", closedAt, NOW)).toEqual({
      status: "closed",
      closedAt,
    });
  });

  it("clears the closed time when a task leaves Closed", () => {
    expect(statusAfterMove("closed", "in_progress", "2026-09-01T00:00:00.000Z", NOW)).toEqual({
      status: "in_progress",
      closedAt: null,
    });
  });
});
