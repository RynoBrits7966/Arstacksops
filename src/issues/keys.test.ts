import { describe, expect, it } from "vitest";
import { formatTicketId, nextTicketNumber, resolveIssueSeverity, resolveIssueType } from "./keys";

describe("issue classification", () => {
  it("maps bugs and tasks once, and names an unset type Review", () => {
    expect(resolveIssueType(undefined, "bug")).toEqual({ value: "bug", changed: true });
    expect(resolveIssueType(undefined, "task")).toEqual({ value: "improvement", changed: true });
    expect(resolveIssueType(undefined, "epic")).toEqual({ value: "review", changed: true });
    expect(resolveIssueType("ui", "task")).toEqual({ value: "ui", changed: false });
    expect(resolveIssueType(null, "feature")).toEqual({ value: "review", changed: true });
    expect(resolveIssueType("new_feature", "task")).toEqual({ value: "new_feature", changed: false });
    expect(resolveIssueType("question", "task")).toEqual({ value: "question", changed: false });
    expect(resolveIssueType("review", "epic")).toEqual({ value: "review", changed: false });
  });

  it("does not copy the older severity scale", () => {
    expect(resolveIssueSeverity("high")).toEqual({ value: null, changed: true });
    expect(resolveIssueSeverity("critical")).toEqual({ value: "critical", changed: false });
    expect(resolveIssueSeverity(null)).toEqual({ value: null, changed: false });
  });

  it("formats a ticket id from the project name and number", () => {
    expect(formatTicketId("Billing", 1)).toBe("Billing-1");
    expect(formatTicketId("Field App", 12)).toBe("Field App-12");
    expect(
      nextTicketNumber(
        [
          { id: "a", projectId: "billing", ticketNumber: 1 },
          { id: "b", projectId: "field", ticketNumber: 9 },
        ],
        "billing",
      ),
    ).toBe(2);
  });
});