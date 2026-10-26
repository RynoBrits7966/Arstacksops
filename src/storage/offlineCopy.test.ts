import { describe, expect, it } from "vitest";
import { emptySnapshot } from "./snapshot";
import { isNetworkFailure, planBoardOpen, type OfflineCopy } from "./offlineCopy";

function copy(dirty: boolean): OfflineCopy {
  const snapshot = emptySnapshot();
  return { version: 3, synced: snapshot, draft: snapshot, dirty };
}

describe("planBoardOpen", () => {
  it("keeps a dirty local draft to merge when the server is reachable", () => {
    const local = copy(true);
    const remote = emptySnapshot();
    expect(planBoardOpen({ ok: true, version: 4, snapshot: remote }, local)).toEqual({
      action: "merge",
      version: 4,
      snapshot: remote,
      local,
    });
  });

  it("uses the server board when nothing is waiting on this device", () => {
    const remote = emptySnapshot();
    expect(planBoardOpen({ ok: true, version: 4, snapshot: remote }, copy(false))).toEqual({
      action: "use-remote",
      version: 4,
      snapshot: remote,
    });
  });

  it("opens the saved board when the network is down", () => {
    const local = copy(true);
    expect(planBoardOpen({ ok: false, auth: false, network: true }, local)).toEqual({
      action: "use-local",
      copy: local,
    });
  });

  it("asks for a first online visit when this device has no saved board", () => {
    expect(planBoardOpen({ ok: false, auth: false, network: true }, null)).toEqual({ action: "wait-online" });
  });

  it("does not treat a signed-out response as an offline board", () => {
    expect(planBoardOpen({ ok: false, auth: true, network: false }, copy(true))).toEqual({ action: "sign-in" });
  });
});

describe("isNetworkFailure", () => {
  it("recognises a failed fetch", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new Error("Could not save the shared board. The change was not stored."))).toBe(false);
  });
});
