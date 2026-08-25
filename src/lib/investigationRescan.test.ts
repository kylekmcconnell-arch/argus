import { describe, expect, it } from "vitest";
import { formatInvestigationRescanError, resolveInvestigationRescanInput } from "./investigationRescan";

describe("resolveInvestigationRescanInput", () => {
  it("accepts the EARN Robinhood contract as a runnable rescan target", () => {
    expect(resolveInvestigationRescanInput("0xa3b6aee90017b72c0812dc1e013de70eb2917ba3")).toEqual({
      ok: true,
      input: { kind: "token", ref: "0xa3b6aee90017b72c0812dc1e013de70eb2917ba3", via: "evm" },
    });
  });

  it("explains a missing address instead of treating Rescan as a no-op", () => {
    const blocked = resolveInvestigationRescanInput("");
    expect(blocked).toEqual({
      ok: false,
      address: "(empty)",
      reason: "the stored report has no contract address to scan.",
    });
    if (blocked.ok) throw new Error("expected a blocked rescan");
    expect(formatInvestigationRescanError(blocked.address, blocked.reason)).toContain("Address used: (empty)");
  });

  it("explains why a stored $ticker cannot start a forced rescan", () => {
    const blocked = resolveInvestigationRescanInput("$EARN");
    expect(blocked).toMatchObject({
      ok: false,
      address: "$EARN",
    });
    if (blocked.ok) throw new Error("expected a blocked rescan");
    expect(blocked.reason).toContain("$ticker");
    expect(formatInvestigationRescanError(blocked.address, blocked.reason)).toBe(
      `Rescan could not start. Address used: $EARN. ${blocked.reason}`,
    );
  });
});
