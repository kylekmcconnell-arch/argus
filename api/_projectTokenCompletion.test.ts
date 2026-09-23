import { afterEach, expect, it, vi } from "vitest";
import type { Dossier } from "../src/data/dossier";
import { completeProjectToken } from "./_projectTokenCompletion";

const address = "0x1234567890abcdef1234567890abcdef12345678";
const dossier = () => ({ bio: "A privacy protocol", projectToken: { verified: true, address, chain: "ethereum", verification: "official_domain" }, evidence: {} } as unknown as Dossier);
const options = () => ({ authorization: "Bearer analyst-test", panelToken: "test-capability", deadlineAt: Date.now() + 300_000, emit: vi.fn() });
function runtime(scan: unknown) {
  const threatScan = vi.fn().mockResolvedValue(scan);
  const withThreatNet = vi.fn((_context, run) => run());
  const loader = vi.fn(async () => ({ threatScan, withThreatNet }) as unknown as typeof import("../server/threatRuntime"));
  return { loader, threatScan, withThreatNet };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("finishes the attributed contract and chain under the caller's scoped capability", async () => {
  vi.stubEnv("VERCEL_URL", "test-deployment.vercel.app");
  const scan = { address, chain: "ethereum", symbol: "TEST", call: { verdict: "CAUTION", risk: 40 } };
  const lib = runtime(scan); const d = dossier();
  await completeProjectToken(d, options(), lib.loader);
  expect(d.threat).toBe(scan);
  expect(d.tokenAssessment?.state).toBe("complete");
  expect(d.threatBinding).toBe("canonical");
  expect(lib.threatScan).toHaveBeenCalledWith({ kind: "token", ref: address, via: "evm" }, expect.any(Function), expect.objectContaining({ force: true, chain: "ethereum" }));
  expect(lib.withThreatNet).toHaveBeenCalledWith(expect.objectContaining({ base: "https://test-deployment.vercel.app", headers: expect.objectContaining({ authorization: "Bearer analyst-test", "x-argus-panel-token": "test-capability" }) }), expect.any(Function));
});
it.each([{ address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", chain: "ethereum" }, { address, chain: "base" }])("refuses a completed result for the wrong asset", async (scan) => {
  const d = dossier(); const lib = runtime(scan);
  await completeProjectToken(d, options(), lib.loader);
  expect(d.threat).toBeNull(); expect(d.tokenAssessment?.state).toBe("unavailable");
});
it("does not use a token name match when attribution is absent", async () => {
  const d = { bio: "We make privacy software", evidence: {} } as Dossier;
  const lib = runtime(null);
  await completeProjectToken(d, options(), lib.loader);
  expect(lib.loader).not.toHaveBeenCalled(); expect(d.tokenAssessment?.state).toBe("unattributed");
});
it("preserves promotion provenance instead of relabelling it canonical", async () => {
  const d = { bio: "Researcher", evidence: { promotions: [{ contract_address: address, chain: "ethereum" }] } } as unknown as Dossier;
  const lib = runtime(null); await completeProjectToken(d, options(), lib.loader);
  expect(d.threatBinding).toBe("promotion"); expect(d.tokenAssessment?.state).toBe("unavailable");
});
it("starts no provider work after the persistence reserve begins", async () => {
  const d = dossier(); const lib = runtime(null);
  await completeProjectToken(d, { ...options(), deadlineAt: Date.now() - 1 }, lib.loader);
  expect(lib.loader).not.toHaveBeenCalled(); expect(d.tokenAssessment?.state).toBe("unavailable");
});
it("bounds a hung scanner and aborts its scoped network", async () => {
  vi.useFakeTimers(); const d = dossier(); const lib = runtime(null);
  lib.threatScan.mockImplementation(() => new Promise(() => {}));
  const completed = completeProjectToken(d, { ...options(), deadlineAt: Date.now() + 1000 }, lib.loader);
  await vi.advanceTimersByTimeAsync(1000); await completed;
  expect(d.tokenAssessment?.state).toBe("unavailable");
  expect(lib.withThreatNet.mock.calls[0][0].signal.aborted).toBe(true);
});
it("fails closed without an ordinary user capability or a trusted deployment host", async () => {
  const lib = runtime(null);
  await completeProjectToken(dossier(), { ...options(), panelToken: undefined }, lib.loader);
  vi.stubEnv("VERCEL_URL", "attacker.example");
  await completeProjectToken(dossier(), options(), lib.loader);
  expect(lib.loader).not.toHaveBeenCalled();
});
it("keeps project evidence on scanner failure without copying raw failure data", async () => {
  const d = dossier(); const lib = runtime(null);
  lib.threatScan.mockRejectedValue(new Error("private provider transcript"));
  await completeProjectToken(d, options(), lib.loader);
  expect(d.bio).toBe("A privacy protocol"); expect(d.tokenAssessment?.state).toBe("unavailable");
  expect(JSON.stringify(d)).not.toContain("private provider transcript");
});
