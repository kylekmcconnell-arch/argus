// Pure calibration runner: score every golden case through the real engine and
// report drift. Used by both the CLI (calibrate.ts) and the vitest guard.

import { assembleDossier } from "../data/dossier";
import { GOLDEN, type GoldenCase, type GroundTruth } from "./golden";

export interface CaseResult {
  name: string;
  note: string;
  groundTruth: GroundTruth;
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
  if (c.expect.governing !== undefined && actual.governing !== c.expect.governing)
    mismatches.push(`governing ${actual.governing} != ${c.expect.governing}`);
  if (c.expect.cap !== undefined && actual.cap !== c.expect.cap)
    mismatches.push(`cap ${actual.cap} != ${c.expect.cap}`);
  if (c.expect.score === null && actual.score !== null)
    mismatches.push(`score ${actual.score} != null`);
  if (c.expect.score && (
    actual.score === null || actual.score < c.expect.score.min || actual.score > c.expect.score.max
  )) {
    mismatches.push(`score ${actual.score} outside ${c.expect.score.min}-${c.expect.score.max}`);
  }
  return {
    name: c.name,
    note: c.note,
    groundTruth: c.groundTruth,
    pass: mismatches.length === 0,
    expected: c.expect,
    actual,
    mismatches,
  };
}

export interface QualitySummary {
  byGroundTruth: Record<GroundTruth, number>;
  falsePasses: string[];
  falseAvoids: string[];
  unsafeConclusions: string[];
  identityMisses: string[];
}

export function summarizeQuality(results: CaseResult[]): QualitySummary {
  const byGroundTruth: Record<GroundTruth, number> = {
    clean: 0,
    harmful: 0,
    "insufficient-evidence": 0,
    "identity-fraud": 0,
  };
  for (const result of results) byGroundTruth[result.groundTruth] += 1;
  return {
    byGroundTruth,
    falsePasses: results
      .filter((result) => result.groundTruth === "harmful" && ["PASS", "CAUTION"].includes(result.actual.verdict))
      .map((result) => result.name),
    falseAvoids: results
      .filter((result) => result.groundTruth === "clean" && ["FAIL", "AVOID", "UNVERIFIABLE_IDENTITY"].includes(result.actual.verdict))
      .map((result) => result.name),
    unsafeConclusions: results
      .filter((result) => result.groundTruth === "insufficient-evidence" && result.actual.verdict !== "INCOMPLETE")
      .map((result) => result.name),
    identityMisses: results
      .filter((result) => result.groundTruth === "identity-fraud" && result.actual.verdict !== "UNVERIFIABLE_IDENTITY")
      .map((result) => result.name),
  };
}

export function runCalibration(): {
  results: CaseResult[];
  passed: number;
  total: number;
  quality: QualitySummary;
} {
  const results = GOLDEN.map(runCase);
  return {
    results,
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    quality: summarizeQuality(results),
  };
}
