// Development-only fixture harness for the interactive dossier
// (?design-preview=dossier). The production reading document lives in
// src/components/DossierReport.tsx and is wired to live reports. This file
// must stay DEV-only and must keep calling the frozen @dynexcoin fixture —
// never become the default App.
import { DossierReport } from "../components/DossierReport";
import fixture from "./dynexReportFixture.json";

export function DossierPreview() {
  return <DossierReport payload={fixture as unknown as Record<string, unknown>} theatrical />;
}
