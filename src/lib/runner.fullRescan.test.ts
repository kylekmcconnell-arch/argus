import { afterEach, describe, expect, it, vi } from "vitest";

const live = vi.hoisted(() => ({
  streamAudit: vi.fn(() => vi.fn()),
}));

vi.mock("./live", () => ({ streamAudit: live.streamAudit }));

import { cancelRun, getRun, startPersonAudit } from "./runner";

afterEach(() => {
  cancelRun("@same-subject");
  live.streamAudit.mockClear();
});

describe("background full-rescan mode guard", () => {
  it("does not let a running standard scan fulfill a full-rescan request", () => {
    const standard = startPersonAudit("@same-subject");
    const attemptedFresh = startPersonAudit("@same-subject", false, "investment_due_diligence", {
      force: true,
    });

    expect(standard.fresh).toBe(false);
    expect(attemptedFresh.startConflict).toBe("full-rescan-waits-for-standard");
    expect(getRun("@same-subject")).toBe(standard);
    expect(live.streamAudit).toHaveBeenCalledTimes(1);
  });

  it("may reuse a running full rescan for a standard viewer without spending twice", () => {
    const fresh = startPersonAudit("@same-subject", false, "investment_due_diligence", {
      force: true,
    });
    const attached = startPersonAudit("@same-subject");

    expect(fresh.fresh).toBe(true);
    expect(attached).toBe(fresh);
    expect(attached.startConflict).toBeUndefined();
    expect(live.streamAudit).toHaveBeenCalledTimes(1);
  });
});
