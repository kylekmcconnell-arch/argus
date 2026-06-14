// Pure calibration runner: score every golden case through the real engine and
// report drift. Used by both the CLI (calibrate.ts) and the vitest guard.

import { assembleDossier } from "../data/dossier";
import { GOLDEN, type GoldenCase } from "./golden";

export interface CaseResult {
  name: string;
  note: string;
  pass: boolean;
  expected: GoldenCase["expect"];
  actual: { verdict: string; governing: string | null; cap: string | null; score: number | null };
  mismatches: string[];
}

export function runCase(c: GoldenCase): CaseResult {
  const report = assembleDossier(c.evidence, false).report;
  const actual = {
    verdict: report.composite_verdict,
    governing: report.governing_role,
    cap: report.cap_applied,
    score: report.governing_score,
  };
  const mismatches: string[] = [];
  if (actual.verdict !== c.expect.verdict) mismatches.push(`verdict ${actual.verdict} != ${c.expect.verdict}`);
  if (c.expect.governing && actual.governing !== c.expect.governing)
    mismatches.push(`governing ${actual.governing} != ${c.expect.governing}`);
  if (c.expect.cap !== undefined && actual.cap !== c.expect.cap)
    mismatches.push(`cap ${actual.cap} != ${c.expect.cap}`);
  return { name: c.name, note: c.note, pass: mismatches.length === 0, expected: c.expect, actual, mismatches };
}

export function runCalibration(): { results: CaseResult[]; passed: number; total: number } {
  const results = GOLDEN.map(runCase);
  return { results, passed: results.filter((r) => r.pass).length, total: results.length };
}
