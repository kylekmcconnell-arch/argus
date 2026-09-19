import { Report } from "../components/Report";
import { storedPersonDossier, type StoredReport } from "../lib/reports";
import fixture from "../reports/argus/__fixtures__/altcoinist-v4.json";

/* Development-only harness for the ARGUS report design.
   ?design-preview=argus-report            owner view of the saved Altcoinist v4 report
   ?design-preview=argus-report&mode=share recipient (read-only) view
   The scroll container mirrors the workspace's main pane so sticky chrome
   behaves exactly as it does inside the app shell. */
export function ArgusReportPreview() {
  const share = new URLSearchParams(window.location.search).get("mode") === "share";
  const dossier = storedPersonDossier(fixture as unknown as StoredReport);
  return (
    <div className="flex h-screen overflow-hidden bg-void">
      <main className="thin-scroll flex-1 overflow-x-hidden overflow-y-auto">
        <Report
          dossier={dossier}
          onReset={() => undefined}
          shareView={share}
          {...(share ? {} : { onRescan: () => undefined, onAudit: () => undefined })}
        />
      </main>
    </div>
  );
}
