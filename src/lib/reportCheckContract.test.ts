import { describe, expect, it } from "vitest";
import { clearanceCoverage, decisionCriticalChecks, type ScanCheck } from "./scanChecklist";
import {
  applyReportCheckContract,
  PERSON_SUPPLEMENTAL_CHECK_IDS,
  TOKEN_REQUIRED_CHECK_IDS,
} from "./reportCheckContract";

const row = (checkId: string, status: ScanCheck["status"], decisionCritical?: boolean): ScanCheck => ({
  checkId,
  label: checkId,
  status,
  ...(decisionCritical === undefined ? {} : { decisionCritical }),
});

describe("canonical report check contracts", () => {
  it("keeps the required token contract explicit and stable", () => {
    expect([...TOKEN_REQUIRED_CHECK_IDS]).toEqual([
      "contract-safety",
      "buy-sell-simulation",
      "holder-distribution",
      "wallet-clustering",
      "market-intelligence",
      "ofac-sanctions-address",
      "trust-graph-connections",
    ]);
  });

  it("does not let supplemental token enrichment withhold completion", () => {
    const checks = applyReportCheckContract("token", [
      row("contract-safety", "confirmed"),
      row("buy-sell-simulation", "confirmed"),
      row("holder-distribution", "confirmed"),
      row("wallet-clustering", "confirmed"),
      row("market-intelligence", "checked-empty"),
      row("ofac-sanctions-address", "checked-empty"),
      row("trust-graph-connections", "checked-empty"),
      row("documents-audits", "unavailable", true),
      row("news-press", "unknown", true),
      row("github-forensics", "stale", true),
      row("operator-funding-trace", "unavailable", true),
    ]);

    expect(decisionCriticalChecks(checks).map((check) => check.checkId)).toEqual([...TOKEN_REQUIRED_CHECK_IDS]);
    expect(clearanceCoverage(checks).sufficient).toBe(true);
  });

  it("still fails closed when a required token safety check is open", () => {
    const checks = applyReportCheckContract("investigation", [
      ...[...TOKEN_REQUIRED_CHECK_IDS].map((id) => row(id, id === "ofac-sanctions-address" ? "unavailable" : "confirmed")),
      row("news-press", "confirmed"),
    ]);

    expect(clearanceCoverage(checks).sufficient).toBe(false);
    expect(clearanceCoverage(checks).openNeverWaive).toContain("ofac-sanctions-address");
  });

  it("normalizes known legacy person enrichment without waiving role safety rows", () => {
    const checks = applyReportCheckContract("person", [
      row("identity-resolution", "confirmed"),
      row("ofac-sanctions-name", "checked-empty"),
      row("trust-graph-connections", "checked-empty"),
      row("adverse-screen", "checked-empty"),
      row("profile-photo-authenticity", "unavailable"),
      row("news-press", "unknown"),
    ]);

    expect([...PERSON_SUPPLEMENTAL_CHECK_IDS]).toContain("profile-photo-authenticity");
    expect(decisionCriticalChecks(checks).map((check) => check.checkId)).toEqual([
      "identity-resolution",
      "ofac-sanctions-name",
      "trust-graph-connections",
      "adverse-screen",
    ]);
  });
});
