import { describe, expect, it } from "vitest";
import { unreadMentionIds } from "./mentions";

describe("unreadMentionIds", () => {
  it("keeps a tagged person until they have read the comment", () => {
    expect(
      unreadMentionIds({ mentionIds: ["alex", "sam"], readByIds: ["sam"] }),
    ).toEqual(["alex"]);
  });

  it("is empty once every tagged person has read it", () => {
    expect(unreadMentionIds({ mentionIds: ["alex"], readByIds: ["alex"] })).toEqual([]);
  });
});
