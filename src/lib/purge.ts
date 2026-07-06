// Full start-from-scratch removal of one audited subject, everywhere it lives:
// the audit log (local + shared, all contributors), the persistent stored
// report, and the subject's trust-graph contribution. After a purge the subject
// vanishes from Recent scores, the directories (Founders/Projects/KOLs/VCs),
// the graph categories, and cached report opens — a fresh audit starts clean.
import { removeSubjectRows } from "./auditlog";
import { removeContribution } from "../graph/store";

export function purgeSubject(ref: string): void {
  removeSubjectRows(ref);
  removeContribution(ref);
  void fetch(`/api/report?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => { /* offline */ });
}
