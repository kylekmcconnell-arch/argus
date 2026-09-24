import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dexByToken: vi.fn(async () => []), apiFetch: vi.fn() }));
vi.mock("../token/sources", async importOriginal => ({ ...await importOriginal<object>(), dexByToken: mocks.dexByToken }));
vi.mock("./net", () => ({ apiFetch: mocks.apiFetch }));
import { launchProvenance } from "./launch";
import type { TokenDossier } from "../token/audit";
const token = { chain: "robinhood", address: "0x1111111111111111111111111111111111111ba3", dexId: "uniswap" } as TokenDossier;
afterEach(() => vi.clearAllMocks());
it("does not grant LP protection or creator-fee assumptions to a suffix-only match", async () => {
  mocks.apiFetch.mockResolvedValue(new Response("{}"));
  expect(await launchProvenance(token)).toMatchObject({ kind: "unknown", venue: null, lpDisposition: "unknown", creatorFees: null, attribution: { state: "candidate" } });
});
it("retains confirmed venue and observed conduct without asserting custody of an unverified pool", async () => {
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ creatorVenue: "bankr", creatorFees: { evidence: "verified-events", claimCount: 3, claimedTokens: 100, usage: "dump", note: "Observed fixture claim and sale." } })));
  expect(await launchProvenance(token)).toMatchObject({ kind: "launchpad", venue: "bankr", lpDisposition: "unknown", creatorFees: { claimCount: 3, usage: "dump" }, attribution: { state: "confirmed" } });
});
it("does not reinterpret a provider failure as a direct fair launch", async () => {
  mocks.apiFetch.mockRejectedValue(new Error("offline"));
  expect(await launchProvenance({ ...token, address: "0x1111111111111111111111111111111111111111" })).toMatchObject({ kind: "unknown", venue: null });
});

it("does not promote unverified transfer observations into creator conduct", async () => {
  for (const evidence of [undefined, "transfer-only"]) {
    mocks.apiFetch.mockResolvedValue(Response.json({ creatorVenue: "bankr", creatorFees: { evidence, claimCount: 3, claimedTokens: 100, usage: "dump", note: "Transfers only." } }));
    expect((await launchProvenance(token))?.creatorFees).toMatchObject({ usage: "unknown", claimCount: null });
  }
});
