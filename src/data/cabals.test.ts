import { describe, expect, it } from "vitest";
import {
  CABALS, cabalAssociates, describeCabalHit, findCabalHandle, findCabalLaunch, findCabalWallet,
} from "./cabals";

const EVM = /^0x[0-9a-f]{40}$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

describe("cabal registry shape", () => {
  it("has unique ids and dated evidence on every wallet and launch", () => {
    const ids = new Set<string>();
    for (const c of CABALS) {
      expect(ids.has(c.id), `duplicate cabal id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(c.firstSeen <= c.lastSeen).toBe(true);
      for (const w of c.wallets) expect(w.evidence.length, `${c.id} ${w.address} needs evidence`).toBeGreaterThan(10);
      for (const l of c.launches) {
        expect(l.evidence.length, `${c.id} ${l.symbol} needs evidence`).toBeGreaterThan(10);
        expect(() => new Date(l.launchedAt).toISOString()).not.toThrow();
      }
      for (const r of c.related ?? []) expect(CABALS.some((x) => x.id === r), `${c.id} relates to unknown ${r}`).toBe(true);
    }
  });

  it("keeps EVM addresses lowercase and full-length, except explicitly labelled prefixes", () => {
    for (const c of CABALS) {
      for (const w of c.wallets) {
        if (w.address.startsWith("0x") && w.address.length === 42) expect(w.address).toMatch(EVM);
        else if (w.address.startsWith("0x")) expect(w.label ?? "").toMatch(/prefix/i);
      }
      for (const l of c.launches) expect(l.address).toMatch(l.chain === "solana" ? BASE58 : EVM);
    }
  });

  it("carries no handle with a leading @", () => {
    for (const c of CABALS) for (const a of c.accounts) expect(a.handle.startsWith("@")).toBe(false);
  });
});

describe("lookups", () => {
  it("matches a farm wallet exactly, case-insensitively, and only on its chain", () => {
    const hit = findCabalWallet("robinhood", "0x1DD6E1F6E2D1696A88998CFF9FC150CAB4C3601A");
    expect(hit?.cabal.id).toBe("rh-farm-lebron");
    expect(hit?.wallet.role).toBe("sniper");
    expect(findCabalWallet("base", "0x1dd6e1f6e2d1696a88998cff9fc150cab4c3601a")).toBeNull();
  });

  it("resolves a Solana mint and its factory wallets case-insensitively", () => {
    const hit = findCabalLaunch("solana", "7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5");
    expect(hit?.cabal.id).toBe("sol-park-pumpswap-pool-factory");
    expect(hit?.launch.outcome).toBe("curve-scalped");
    expect(findCabalWallet("solana", "cbbrs6xr6ksjyzpgh7pqnvvy42gxbhwk1z2wmejja99x")?.wallet.role).toBe("deployer");
    expect(findCabalWallet("robinhood", "CBbRS6xr6KSjYzPgH7pQnVvy42GXbhWk1Z2WMejJa99X")).toBeNull();
  });

  it("never matches a prefix-only record", () => {
    expect(findCabalWallet("robinhood", "0x252e7031")).toBeNull();
  });

  it("resolves an indexed launch and its outcome", () => {
    const hit = findCabalLaunch("robinhood", "0xE96184C99B3A3B89C907ea0753C5fDE9E3C572Ab");
    expect(hit?.launch.symbol).toBe("SYNAPSE");
    expect(hit?.launch.outcome).toBe("curve-scalped");
    expect(hit?.cabal.intent).toBe("nefarious");
  });

  it("finds the shared infrastructure separately from the farms that rent it", () => {
    const exec = findCabalWallet("robinhood", "0xb06983db4fad9cd94efbf9088c364ebcacde1214");
    expect(exec?.cabal.kind).toBe("infra");
    expect(CABALS.filter((c) => c.related?.includes("rh-snipe-infra")).length).toBeGreaterThanOrEqual(3);
  });

  it("resolves an X handle with or without @ and keeps benign rings benign", () => {
    const hits = findCabalHandle("@altcoinist");
    expect(hits.length).toBe(1);
    expect(hits[0].cabal.kind).toBe("promo-ring");
    expect(hits[0].cabal.intent).toBe("benign");
  });

  it("emits cabal associates flagged for the trust graph, excluding the subject", () => {
    const assoc = cabalAssociates("altcoinist-ring", "@Altcoinist");
    expect(assoc.length).toBeGreaterThan(3);
    expect(assoc.every((a) => a.in_cabal_kb === true)).toBe(true);
    expect(assoc.some((a) => a.associate_handle.toLowerCase() === "@altcoinist")).toBe(false);
    expect(assoc.find((a) => a.associate_handle === "@wrestler_galaxy")?.kind).toBe("org");
  });

  it("describes a hit in one sentence without an em dash", () => {
    const hit = findCabalWallet("robinhood", "0xafb1d47ce1af439c5833bb4f6eb4978722df2fca")!;
    const s = describeCabalHit(hit);
    expect(s).toContain("hub");
    // U+2014, written as an escape so this file itself passes the copy policy.
    expect(s).not.toContain("\u2014");
  });
});
