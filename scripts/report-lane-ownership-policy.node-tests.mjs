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

test("short-lived main branches are not coupled to a staging hostname", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "Enigma-Fund",
    baseRef: "main",
    files: ["README.md"],
  }).ok, true);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["README.md"],
  }).ok, true);
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

test("Production promotion needs the other owner's approval", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/production/reportLane.ts"],
  }).ok, false);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/production/reportLane.ts"],
    approvals: ["Enigma-Fund"],
  }).ok, true);
});

test("Raw Evidence changes need the other owner's approval", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/raw/reportLane.ts"],
  }).ok, false);
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["src/reports/raw/reportLane.ts"],
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

test("Kyle can repair enforcement files on main", () => {
  assert.equal(evaluateReportLaneOwnership({
    actor: "kylekmcconnell-arch",
    baseRef: "main",
    files: ["scripts/report-lane-ownership-policy.mjs"],
  }).ok, true);
});
