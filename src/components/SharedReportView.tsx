import { useEffect, useState } from "react";
import { ArgusMark } from "./ArgusMark";
import { Report } from "./Report";
import { TokenReport } from "./TokenReport";
import { InvestigationReport } from "./InvestigationReport";
import {
  storedInvestigation,
  storedPersonDossier,
  storedTokenDossier,
  type StoredReport,
} from "../lib/reports";

/* The read-only share view: the whole interactive report, opened by a share
   capability instead of an account. Everything that reads works — expandable
   composition rows, receipt popovers, section jumps, PDF export. Everything
   that acts on the workspace does not exist here: no challenge console, no
   ask-the-report, no rescan, no add-info, no watch. The report components
   enforce that through their shareView prop; this wrapper never passes the
   handlers those actions would need. */

const noop = () => {};

type ShareState =
  | { phase: "loading" }
  | { phase: "unavailable"; message: string }
  | { phase: "ready"; report: StoredReport; expiresAt: string | null };

export function SharedReportView({ token }: { token: string }) {
  const [state, setState] = useState<ShareState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/shared-report?${new URLSearchParams({ share: token }).toString()}`,
          { cache: "no-store", signal: AbortSignal.timeout(20_000) },
        );
        const body = await response.json().catch(() => ({})) as {
          report?: StoredReport | null;
          expiresAt?: string | null;
          message?: string;
        };
        if (cancelled) return;
        if (!response.ok || !body.report) {
          setState({
            phase: "unavailable",
            message: body.message ?? "This share link is no longer available. Ask the sender for a fresh one.",
          });
          return;
        }
        setState({ phase: "ready", report: body.report, expiresAt: body.expiresAt ?? null });
      } catch {
        if (!cancelled) {
          setState({ phase: "unavailable", message: "The shared report could not be loaded. Check the connection and try again." });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-3">
        <span className="flex items-center gap-2">
          <ArgusMark size={20} />
          <span className="display-sm text-[15px] text-ink">ARGUS</span>
        </span>
        <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-ink-faint">
          Shared report · read-only
          {state.phase === "ready" && state.expiresAt ? ` · link expires ${state.expiresAt.slice(0, 10)}` : ""}
        </span>
      </header>
      {state.phase === "loading" && (
        <p className="mono px-5 py-16 text-center text-[12px] uppercase tracking-wider text-ink-faint" aria-live="polite">
          Opening the shared report…
        </p>
      )}
      {state.phase === "unavailable" && (
        <div className="mx-auto max-w-md px-5 py-16 text-center">
          <h1 className="display-sm text-[18px] text-ink">This link does not open a report</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{state.message}</p>
        </div>
      )}
      {state.phase === "ready" && (
        state.report.kind === "investigation" ? (
          <InvestigationReport
            inv={storedInvestigation(state.report)}
            onAudit={noop}
            onReset={noop}
            onOpenToken={noop}
            onOpenProjectAccount={noop}
            shareView
          />
        ) : state.report.kind === "token" ? (
          <TokenReport
            dossier={storedTokenDossier(state.report)}
            onReset={noop}
            onAudit={noop}
            onRescan={noop}
            shareView
          />
        ) : state.report.kind === "person" ? (
          <Report
            dossier={storedPersonDossier(state.report)}
            onReset={noop}
            shareView
          />
        ) : (
          <div className="mx-auto max-w-md px-5 py-16 text-center">
            <h1 className="display-sm text-[18px] text-ink">This report type has no shared view yet</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">Ask the sender for the summary card link instead.</p>
          </div>
        )
      )}
      <footer className="border-t border-line/70 px-5 py-4">
        <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
          ARGUS forensic due diligence · research, not financial advice · this view cannot change the report
        </p>
      </footer>
    </div>
  );
}
