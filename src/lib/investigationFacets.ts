import type { Investigation } from "./investigation";
import type { ScanCheck } from "./scanChecklist";
import { TOKEN_REQUIRED_CHECK_IDS } from "./reportCheckContract.js";

export interface InvestigationFacet {
  key: "token" | "project" | "supplemental";
  label: string;
  state: "complete" | "partial" | "unavailable";
  note: string;
}
const answered = (c: ScanCheck) => ["confirmed", "reported", "finding", "checked-empty", "not-applicable"].includes(c.status);
/** Keep the useful token result while explicitly accounting for omitted scope. */
export function investigationFacets(inv: Investigation, checks: readonly ScanCheck[]): InvestigationFacet[] {
  const core = checks.filter(c => TOKEN_REQUIRED_CHECK_IDS.has(c.checkId ?? ""));
  const complete = [...TOKEN_REQUIRED_CHECK_IDS].every(id => core.some(c => c.checkId === id && answered(c))) && !inv.token.assessment?.provisional;
  const extra = checks.filter(c => !TOKEN_REQUIRED_CHECK_IDS.has(c.checkId ?? "") && c.checkId !== "trust-graph-connections");
  const project = inv.projectAccount;
  const projectComplete = inv.projectAccountAudit?.state === "complete" && project != null
    && project.completeness_state === "complete";
  return [
    { key: "token", label: "Token safety", state: complete ? "complete" : "partial", note: complete ? "Core token checks complete." : "Score uses assessed token evidence; some core checks remain open." },
    { key: "project", label: "Project diligence", state: projectComplete ? "complete" : project ? "partial" : "unavailable", note: project ? (projectComplete ? "Project audit checks complete." : "Project audit has evidence gaps; see its required checks.") : inv.projectAccountAudit?.note || "Project identity has not been resolved." },
    { key: "supplemental", label: "Supplemental research", state: extra.length && extra.every(answered) ? "complete" : "partial", note: `${extra.filter(answered).length}/${extra.length} recorded supplemental checks answered.` },
  ];
}
