import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReportLaneOwnership } from "./report-lane-ownership-policy.mjs";

test("Kyle can edit only the Kyle report lane", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/kyle/report-lane.css"],
  }).ok, true);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/enigma/report-lane.css"],
  }).ok, false);
});

test("Enigma can edit only the Enigma report lane", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "Enigma-Fund",
    baseRef: "main",
    files: ["src/reports/enigma/report-lane.css"],
  }).ok, true);
  assert.equal(evaluateReportLaneOwnership({
    actor: "Enigma-Fund",
    baseRef: "main",
    files: ["src/reports/kyle/report-lane.css"],
  }).ok, false);
});

test("each staging branch rejects the other owner", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "Enigma-Fund",
    baseRef: "codex/staging-kyle-reports",
    files: ["README.md"],
  }).ok, false);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "codex/staging-enigma",
    files: ["README.md"],
  }).ok, false);
});

test("shared report changes need the other owner's approval", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/components/Report.tsx"],
  }).ok, false);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/components/Report.tsx"],
    approvals: ["Enigma-Fund"],
  }).ok, true);
});

test("only Kyle can change the enforcement policy", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "Enigma-Fund",
    baseRef: "main",
    files: ["scripts/check-report-lane-ownership.mjs"],
  }).ok, false);
});

test("Kyle can repair only enforcement files on either staging branch", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "codex/staging-enigma",
    files: ["scripts/report-lane-ownership-policy.mjs"],
  }).ok, true);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "codex/staging-enigma",
    files: ["scripts/report-lane-ownership-policy.mjs", "README.md"],
  }).ok, false);
});
