import { describe, expect, it } from "vitest";
import { isBarend, isRyno } from "./people";

describe("staff checks", () => {
  it("recognises Barend and Ryno by their accounts", () => {
    expect(isBarend("Barend@arstacks.co.za")).toBe(true);
    expect(isBarend("ryno@arstacks.co.za")).toBe(false);
    expect(isRyno("ryno@arstacks.co.za")).toBe(true);
    expect(isRyno("barend@arstacks.co.za")).toBe(false);
  });
});
