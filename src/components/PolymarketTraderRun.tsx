import { useEffect, useState } from "react";
import { PolymarketTraderReport, type RecordAnalysisView, type TraderRecordView } from "./PolymarketTraderReport";

/**
 * The Polymarket trader lane, mounted.
 *
 * The four pieces underneath were built separately: the adapter reads the
 * wallet, record.ts derives the shape of its curve, /api/polymarket-trader
 * serves both, and PolymarketTraderReport renders them. This is the only file
 * that joins them to a user, and it deliberately computes nothing: every figure
 * on screen came off the route, which got it from the two modules, so one fact
 * is worded in exactly one place.
 *
 * It follows FindWallet's WalletRow rather than the panel components: the route
 * is scan-time and keyless, there is no persisted report version to bind a panel
 * token to, and a plain fetch is the whole contract.
 *
 * A lookup that did not complete is NOT a wallet with no record. Those two are
 * rendered differently on purpose, because collapsing them is how a page tells a
 * reader that an unanswered question was answered.
 */

interface TraderPayload {
  wallet: string;
  available: boolean;
  partial?: boolean;
  record?: TraderRecordView;
  analysis?: RecordAnalysisView;
  note?: string;
  error?: string;
}

type State =
  | { phase: "loading" }
  | { phase: "ready"; record: TraderRecordView; analysis: RecordAnalysisView }
  | { phase: "unavailable"; note: string };

/**
 * The one sentence a failed lookup is allowed. It says what was not established
 * and refuses to imply the opposite: an unread wallet is unread, not clean and
 * not empty.
 */
const LOOKUP_FAILED =
  "Polymarket's public endpoints did not answer for this wallet, so nothing about its trading record was established either way. That is a gap in this scan, not a finding about the wallet. Try again in a moment.";

export function PolymarketTraderRun({ wallet, onReset }: { wallet: string; onReset?: () => void }) {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let live = true;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const res = await fetch(`/api/polymarket-trader?wallet=${encodeURIComponent(wallet)}`);
        const body = (await res.json().catch(() => null)) as TraderPayload | null;
        if (!live) return;
        // The route answers 400 with the adapter's own refusal sentence, which is
        // worded better than anything this component could invent, so it is shown
        // verbatim rather than replaced by a generic failure.
        if (!res.ok) {
          setState({ phase: "unavailable", note: body?.error || LOOKUP_FAILED });
          return;
        }
        if (!body || body.available === false || !body.record || !body.analysis) {
          setState({ phase: "unavailable", note: body?.note ? `${body.note} ${LOOKUP_FAILED}` : LOOKUP_FAILED });
          return;
        }
        setState({ phase: "ready", record: body.record, analysis: body.analysis });
      } catch {
        if (live) setState({ phase: "unavailable", note: LOOKUP_FAILED });
      }
    })();
    return () => { live = false; };
  }, [wallet]);

  return (
    <div className="workspace-frame">
      {state.phase === "loading" && (
        <section className="panel px-4 py-4 sm:px-5" role="status" aria-live="polite">
          <p className="eyebrow">Polymarket record</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
            Reading this wallet's public record: the leaderboard for profit and volume, the data API for the open book
            and its activity, and the daily profit series for the curve.
          </p>
          <span className="scan-bar mt-3 block w-full" aria-hidden />
        </section>
      )}

      {state.phase === "unavailable" && (
        <section className="panel px-4 py-4 sm:px-5" aria-label="Polymarket record unavailable">
          <p className="eyebrow">Polymarket record</p>
          <div className="finding tint-caution mt-3 px-4 py-3" role="note">
            <p className="text-[12.5px] leading-relaxed text-ink-dim">{state.note}</p>
          </div>
        </section>
      )}

      {/*
        No claim and no comparison: a wallet reached this page from a pasted
        profile link, with no post and no quoted figure behind it. The panel then
        leads with the verified figures instead of manufacturing a verdict, which
        is the correct output for a record nobody made a claim about.
      */}
      {state.phase === "ready" && <PolymarketTraderReport record={state.record} analysis={state.analysis} />}

      {onReset && (
        <button type="button" onClick={onReset} className="btn-ghost mt-4 text-[12px]">
          New search
        </button>
      )}
    </div>
  );
}

export default PolymarketTraderRun;
