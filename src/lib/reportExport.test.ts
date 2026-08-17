import { describe, it, expect } from "vitest";
import { reportToHtml, reportFilename } from "./reportExport";
import { buildReport, SUBJECTS } from "../data/subjects";
import type { Dossier } from "../data/dossier";
import type { ThreatScan } from "../threat/types";
import type { TokenDossier } from "../token/audit";

// Drive off the real fixtures so the serializer is tested against the same
// Dossier shape the app renders.
const dossiers = SUBJECTS.map((s) => buildReport(s));
const first = dossiers[0];

describe("reportToHtml", () => {
  it("produces a self-contained HTML document with the subject and verdict", () => {
    const html = reportToHtml(first);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("ARGUS");
    expect(html).toContain(first.report.audit_id);
    // composite verdict label surfaces (UNVERIFIABLE_IDENTITY renders as UNVERIFIABLE)
    const label = first.report.composite_verdict === "UNVERIFIABLE_IDENTITY" ? "UNVERIFIABLE" : first.report.composite_verdict;
    expect(html).toContain(label);
  });

  it("renders every fixture without throwing and inlines its own CSS + no external assets", () => {
    for (const d of dossiers) {
      const html = reportToHtml(d);
      expect(html).toContain("<style>");
      // fully self-contained: no external stylesheet/script/img references
      expect(html).not.toMatch(/<link[^>]+href|<img|src=["']https?:/i);
    }
  });

  it("escapes HTML metacharacters so injected text can't break the document", () => {
    const evil = "<script>alert('x')</script> & \"quotes\"";
    const d: Dossier = { ...first, display_name: evil, bio: evil, headline: evil };
    const html = reportToHtml(d);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    // the injected close-tag must not appear verbatim
    expect(html).not.toContain("</script>alert");
  });

  it("embeds a print trigger only when autoPrint is set", () => {
    expect(reportToHtml(first, { autoPrint: true })).toContain("window.print()");
    expect(reportToHtml(first)).not.toContain("window.print()");
  });

  it("includes the generated stamp in the footer when supplied", () => {
    const html = reportToHtml(first, { generatedAt: "2026-07-07 12:00 UTC" });
    expect(html).toContain("Generated 2026-07-07 12:00 UTC");
  });

  it("renders the token threat leg when the full scan carried one", () => {
    const threat: ThreatScan = {
      address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
      chain: "ethereum",
      symbol: "PEPE",
      name: "Pepe",
      dossier: { liquidityUsd: 20_410_000, mcap: 1_070_000_000 } as TokenDossier,
      call: {
        verdict: "SAFE",
        risk: 0,
        action: "No mechanical red flags (not financial advice)",
        flags: [],
        warnings: ["37% of supply is concentrated in 9 non-contract wallets (pools excluded)"],
        positives: ["Ownership renounced — no owner powers remain"],
      },
      code: {
        checked: true,
        verified: true,
        origin: "sourcify",
        contractName: "PepeToken",
        compiler: null,
        stats: { functions: 27, gatedFunctions: 4, dangerHits: 1, isProxy: false, loc: 700 },
        flags: [{ id: "blacklist", severity: "high", title: "Blacklist machinery", detail: "The contract keeps an address blocklist and checks it on transfers.", file: "contracts/PepeToken.sol", line: 595, excerpt: "" }],
        tokenomics: null,
        ai: null,
      },
      deployer: { address: "0xfbfEaF0DA0F2fdE5c66dF570133aE35f3eB58c9A", serialHoneypoter: false, priorScans: [], priorRugs: 0 },
      tokenomics: {
        pools: [{ address: "0xpool", label: "UniV2", pct: 5.2 }],
        cexHeld: [],
        rewardPools: [],
        lp: { status: "unconfirmed", burnedPct: 0, lockedPct: 0, unlockedTopPct: 0, lockers: [], note: "Lock not confirmed by standard tools." },
        tax: { buy: 0, sell: 0, destinations: [], note: "No buy or sell tax.", tone: "neutral" },
        burn: { burnedSupplyPct: 1.6, hasBurnFunction: true, hasAutoBurn: false, ongoing: false, addresses: [], note: "~1.6% of total supply burned." },
        realHolderTopPct: 9,
        note: "",
      },
      classification: { kind: "meme", confidence: "high", label: "MEME COIN", signals: [], lens: "judged as a meme: distribution and tradability over utility claims" },
      checks: [{ key: "honeypot", category: "honeypot", label: "Can holders sell?", status: "pass", detail: "Real sell simulated successfully" }],
      deep: { rugcheck: null, honeypot: null, meta: null, fingerprint: null, clones: [], xchain: null, migration: null, launch: null, verification: null, sellers: null, site: null },
      scannedAt: 0,
    } as ThreatScan;
    const d: Dossier = { ...first, threat, threatNote: "Token attributed via the contract in the subject's own bio." };
    const html = reportToHtml(d);
    expect(html).toContain("Project token · threat scan");
    expect(html).toContain("SAFE · $PEPE");
    expect(html).toContain("Token attributed via the contract in the subject&#39;s own bio.");
    expect(html).toContain("PepeToken.sol");
    expect(html).toContain("595");
    expect(html).toContain("Everything we checked");
    expect(html).toContain("No buy or sell tax.");
    expect(html).toContain("$20.41M liquidity");
  });

  it("prints the skip reason when the threat leg ran dry, and nothing for pre-fold-in dossiers", () => {
    const skipped: Dossier = { ...first, threat: null, threatNote: "No project token could be attributed to this subject." };
    expect(reportToHtml(skipped)).toContain("No project token could be attributed");
    expect(reportToHtml(first)).not.toContain("Project token · threat scan");
  });

  it("lists publishable findings when present", () => {
    const withFindings = dossiers.find((d) => d.report.publishable_findings.length > 0);
    if (!withFindings) return; // no fixture carries findings — nothing to assert
    const html = reportToHtml(withFindings);
    expect(html).toContain("Publishable findings");
    expect(html).toContain(withFindings.report.publishable_findings[0].claim.slice(0, 20));
  });
});

describe("reportFilename", () => {
  const AUG_13 = new Date(2026, 7, 13);

  it("names the file subject_date_Argus_Forensic_due_diligence", () => {
    expect(reportFilename({ handle: "@Foo_Bar" } as Dossier, "pdf", AUG_13)).toBe("Foo_Bar_2026-08-13_Argus_Forensic_due_diligence.pdf");
    expect(reportFilename({ handle: "$WEIRD/name!" } as Dossier, "doc", AUG_13)).toBe("WEIRD-name_2026-08-13_Argus_Forensic_due_diligence.doc");
  });

  it("falls back to a stable base when no handle exists", () => {
    expect(reportFilename({ handle: "" } as Dossier, "doc", AUG_13)).toBe("audit_2026-08-13_Argus_Forensic_due_diligence.doc");
  });
});
