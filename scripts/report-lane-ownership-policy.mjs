export const REPORT_LANE_OWNERS = Object.freeze({
  kyle: "kylekmcconnell-arch",
  enigma: "Enigma-Fund",
});

export const REPORT_LANE_BRANCHES = Object.freeze({
  "codex/staging-kyle-reports": REPORT_LANE_OWNERS.kyle,
  "codex/staging-enigma": REPORT_LANE_OWNERS.enigma,
});

const SHARED_REPORT_PATHS = [
  "src/reports/shared/",
  "src/components/Report.tsx",
  "src/components/TokenReport.tsx",
  "src/components/InvestigationReport.tsx",
  "src/components/ReportCanvasPrimitives.tsx",
  "src/components/InvestigationDecisionCanvas.tsx",
  "src/components/ScoreComposition.tsx",
  "src/components/ScoreRing.tsx",
  "src/components/SocialActivityPanel.tsx",
  "src/components/SubjectAccusationStage.tsx",
  "src/components/EarnReportStyle2.tsx",
  "src/components/EarnReportStyle2.css",
  "src/index.css",
  "src/main.tsx",
];

const POLICY_PATHS = [
  ".github/CODEOWNERS",
  ".github/workflows/report-lane-ownership.yml",
  "scripts/check-report-lane-ownership.mjs",
  "scripts/report-lane-ownership-policy.mjs",
  "scripts/report-lane-ownership-policy.test.mjs",
];

const pathMatches = (file, pattern) => pattern.endsWith("/")
  ? file.startsWith(pattern)
  : file === pattern;

const changedUnder = (files, prefix) => files.filter((file) => file.startsWith(prefix));
const changedShared = (files) => files.filter((file) => SHARED_REPORT_PATHS.some((pattern) => pathMatches(file, pattern)));
const changedPolicy = (files) => files.filter((file) => POLICY_PATHS.some((pattern) => pathMatches(file, pattern)));

export function evaluateReportLaneOwnership({ actor, baseRef, files, approvals = [] }) {
  const normalizedActor = String(actor ?? "").trim();
  const normalizedApprovals = new Set(approvals.map((approval) => String(approval).trim().toLowerCase()));
  const errors = [];
  const branchOwner = REPORT_LANE_BRANCHES[baseRef];

  if (branchOwner && normalizedActor.toLowerCase() !== branchOwner.toLowerCase()) {
    errors.push(`${baseRef} is owned by @${branchOwner}; @${normalizedActor || "unknown"} cannot edit this staging branch.`);
  }

  const kyleFiles = changedUnder(files, "src/reports/kyle/");
  const enigmaFiles = changedUnder(files, "src/reports/enigma/");
  const sharedFiles = changedShared(files);
  const policyFiles = changedPolicy(files);

  if (kyleFiles.length > 0 && normalizedActor.toLowerCase() !== REPORT_LANE_OWNERS.kyle.toLowerCase()) {
    errors.push(`Kyle-owned report files can only be changed by @${REPORT_LANE_OWNERS.kyle}: ${kyleFiles.join(", ")}`);
  }
  if (enigmaFiles.length > 0 && normalizedActor.toLowerCase() !== REPORT_LANE_OWNERS.enigma.toLowerCase()) {
    errors.push(`Enigma-owned report files can only be changed by @${REPORT_LANE_OWNERS.enigma}: ${enigmaFiles.join(", ")}`);
  }
  if (policyFiles.length > 0 && normalizedActor.toLowerCase() !== REPORT_LANE_OWNERS.kyle.toLowerCase()) {
    errors.push(`Report-lane enforcement can only be changed by @${REPORT_LANE_OWNERS.kyle}: ${policyFiles.join(", ")}`);
  }

  if (sharedFiles.length > 0) {
    const requiredReviewer = normalizedActor.toLowerCase() === REPORT_LANE_OWNERS.enigma.toLowerCase()
      ? REPORT_LANE_OWNERS.kyle
      : REPORT_LANE_OWNERS.enigma;
    if (!normalizedApprovals.has(requiredReviewer.toLowerCase())) {
      errors.push(`Shared report files require approval from @${requiredReviewer}: ${sharedFiles.join(", ")}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      actor: normalizedActor,
      baseRef,
      changedFiles: files.length,
      kyleFiles,
      enigmaFiles,
      sharedFiles,
      policyFiles,
    },
  };
}
