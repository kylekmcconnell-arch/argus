import { describe, expect, it } from "vitest";
import { detectScannerEvasion, scannerEvasionClaim, sourceComments } from "./scannerEvasion";

// The real MUMU source shape: a launch-factory template whose own comment
// states the goal. Pulled verbatim from Blockscout on 2026-07-27.
const MUMU_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LunchTokenPlain {
    // test variant: removing the anti-snipe transfer hook makes GMGN stop flagging "honeypot / TradeRestriction".
    uint256 public totalSupply;
}`;

describe("detectScannerEvasion", () => {
  it("catches a comment that names a scanner and states intent to stop it flagging", () => {
    const findings = detectScannerEvasion(MUMU_SOURCE);
    expect(findings).toHaveLength(1);
    expect(findings[0].detectors).toContain("GMGN");
    expect(findings[0].quote).toContain("stop flagging");
    expect(scannerEvasionClaim(findings[0])).toContain("documents defeating GMGN");
    expect(scannerEvasionClaim(findings[0])).toContain("weaker evidence than usual");
  });

  it("requires BOTH a detection surface and intent, so ordinary security talk never fires", () => {
    // Names a scanner, no evasion intent.
    expect(detectScannerEvasion(`// audited by GoPlus and TokenSniffer before launch`)).toEqual([]);
    // Asserting the token is not a honeypot is not evasion.
    expect(detectScannerEvasion(`// this is not a honeypot, sells are always permitted`)).toEqual([]);
    // Evasion words with no detector and no flagging verb.
    expect(detectScannerEvasion(`// avoid reentrancy; prevent overflow on transfer`)).toEqual([]);
    // Flagging verb without a detection surface.
    expect(detectScannerEvasion(`// prevents the owner from being flagged as the treasury`)).toEqual([]);
  });

  it("reads the other phrasings a deployer would plausibly use", () => {
    expect(detectScannerEvasion(`/* hides the tax so honeypot detection does not flag it */`)).toHaveLength(1);
    expect(detectScannerEvasion(`// disabled so rug checkers no longer mark the pair`)).toHaveLength(1);
    expect(detectScannerEvasion(`// bypasses DEXTools detection of the blacklist`)).toHaveLength(1);
  });

  it("ignores licence headers and returns nothing for empty or absent source", () => {
    expect(sourceComments(`// SPDX-License-Identifier: MIT`)).toEqual([]);
    expect(detectScannerEvasion(null)).toEqual([]);
    expect(detectScannerEvasion("")).toEqual([]);
    expect(detectScannerEvasion("contract A { uint x; }")).toEqual([]);
  });

  it("dedupes repeats and caps how many it reports", () => {
    const repeated = Array.from({ length: 6 }, (_, i) =>
      `// variant ${i}: bypasses honeypot detection so it is not flagged`).join("\n");
    expect(detectScannerEvasion(repeated).length).toBeLessThanOrEqual(3);
    const twice = `// bypasses honeypot detection so it is not flagged\n// bypasses honeypot detection so it is not flagged`;
    expect(detectScannerEvasion(twice)).toHaveLength(1);
  });
});
