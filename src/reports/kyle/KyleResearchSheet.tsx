import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  FileText,
  LockKey,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { Avatar } from "../../components/Avatar";
import { fetchReportState } from "../../lib/reports";

export interface KyleResearchTarget {
  id: string;
  name: string;
  image: string | null;
  entityType: string;
  sourceReport: string;
  reason: string;
  estimateMinutes: string;
  costMin: number;
  costMax: number;
  privateSurcharge: number;
  query: string;
  reportKind: "person" | "token";
  researchMode?: "verified" | "exploratory";
}

interface AccountGrowthResponse {
  credit?: { balance?: number } | null;
}

type SheetPhase = "confirm" | "running" | "complete";

const PROGRESS_STEPS = [
  { at: 12, label: "Resolving identity and known aliases" },
  { at: 34, label: "Searching first-party and independent sources" },
  { at: 58, label: "Following organizations, wallets, and control links" },
  { at: 82, label: "Testing claims against saved evidence" },
  { at: 100, label: "Decision file ready" },
];

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function KyleResearchSheet({
  target,
  onClose,
  onRun,
  onOpenSaved,
  onOpenCompleted,
  previewBalance,
}: {
  target: KyleResearchTarget;
  onClose: () => void;
  onRun: (privateSearch: boolean) => void;
  onOpenSaved?: (() => void) | undefined;
  onOpenCompleted?: (() => void) | undefined;
  previewBalance?: number | undefined;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<SheetPhase>("confirm");
  const [privateSearch, setPrivateSearch] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [balance, setBalance] = useState<number | null>(previewBalance ?? null);
  const [balanceState, setBalanceState] = useState<"loading" | "ready" | "unavailable">(previewBalance == null ? "loading" : "ready");
  const [savedState, setSavedState] = useState<"loading" | "available" | "unavailable">(
    onOpenSaved && previewBalance == null ? "loading" : "unavailable",
  );
  const maximum = target.costMax + (privateSearch ? target.privateSurcharge : 0);
  const minimum = target.costMin + (privateSearch ? target.privateSurcharge : 0);
  const currentStep = PROGRESS_STEPS[progressIndex] ?? PROGRESS_STEPS[0];

  useEffect(() => {
    originRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => originRef.current?.focus();
  }, []);

  useEffect(() => {
    if (previewBalance != null) return;
    const controller = new AbortController();
    void fetch("/api/account-growth", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Balance unavailable");
        const body = await response.json() as AccountGrowthResponse;
        if (typeof body.credit?.balance !== "number") throw new Error("Balance unavailable");
        setBalance(body.credit.balance);
        setBalanceState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBalanceState("unavailable");
      });
    return () => controller.abort();
  }, [previewBalance]);

  useEffect(() => {
    if (!onOpenSaved || previewBalance != null) return;
    let active = true;
    void fetchReportState(target.query, target.reportKind)
      .then((result) => {
        if (active) setSavedState(result.status === "open" && result.report ? "available" : "unavailable");
      })
      .catch(() => {
        if (active) setSavedState("unavailable");
      });
    return () => { active = false; };
  }, [onOpenSaved, previewBalance, target.query, target.reportKind]);

  useEffect(() => {
    if (phase !== "running") return;
    const timers = PROGRESS_STEPS.slice(1).map((_, index) => window.setTimeout(() => {
      const next = index + 1;
      setProgressIndex(next);
      if (next === PROGRESS_STEPS.length - 1) setPhase("complete");
    }, (index + 1) * 760));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "running") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, phase]);

  const costLine = useMemo(() => `${minimum.toFixed(1)}–${maximum.toFixed(1)} credits`, [maximum, minimum]);
  const exploratory = target.researchMode === "exploratory";

  const confirm = () => {
    setPhase("running");
    setProgressIndex(0);
    window.setTimeout(() => onRun(privateSearch), 320);
  };

  return (
    <div className="kyle-research-backdrop" role="presentation" onMouseDown={phase === "running" ? undefined : onClose}>
      <aside
        ref={sheetRef}
        className="kyle-research-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyle-research-sheet-title"
        aria-describedby="kyle-research-sheet-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="kyle-research-sheet-header">
          <div className="kyle-research-sheet-identity">
            <Avatar src={target.image} letter={(target.name.replace(/^[@$]/, "")[0] ?? "?").toUpperCase()} size={54} rounded="rounded-full" letterClass="text-base" />
            <div>
              <p className="mono">{target.entityType} · surfaced in the {target.sourceReport} report</p>
              <h2 id="kyle-research-sheet-title">{exploratory ? "Explore" : "Investigate"} {target.name}</h2>
            </div>
          </div>
          <button ref={closeRef} type="button" className="kyle-research-sheet-close" onClick={onClose} aria-label={phase === "running" ? "Continue investigation in background" : "Close research sheet"}><X size={18} weight="bold" /></button>
        </header>

        {phase === "confirm" && (
          <div className="kyle-research-sheet-content">
            <section className="kyle-research-why">
              <p className="mono">Why this may matter</p>
              <strong id="kyle-research-sheet-description">{target.reason}</strong>
              {exploratory && <small>ARGUS will start from this exact public identifier. The relationship shown in the current report remains unverified unless the fresh investigation independently confirms it.</small>}
            </section>

            <div className="kyle-research-paths">
              <section className="kyle-research-path">
                <div><FileText size={20} weight="duotone" /><span><strong>Open saved report</strong><small>Existing ARGUS evidence · no charge</small></span></div>
                {savedState === "available" && onOpenSaved
                  ? <button type="button" onClick={onOpenSaved}>Open free report</button>
                  : <span className="kyle-research-unavailable">{savedState === "loading" ? "Checking saved reports…" : "No saved report yet"}</span>}
              </section>
              <section className="kyle-research-path is-fresh">
                <div><MagnifyingGlass size={20} weight="duotone" /><span><strong>{exploratory ? "Run exploratory investigation" : "Run fresh investigation"}</strong><small>{exploratory ? "Resolve identity first, then follow web, social, entity, and control evidence" : "New web, social, entity, and control evidence"}</small></span></div>
                <strong>{costLine}</strong>
              </section>
            </div>

            <dl className="kyle-research-facts">
              <div><dt><Clock size={16} />Estimated completion</dt><dd>{target.estimateMinutes}</dd></div>
              <div><dt>Current balance</dt><dd>{balanceState === "loading" ? "Checking…" : balanceState === "ready" && balance != null ? `${money(balance)} credits` : "Unavailable"}</dd></div>
            </dl>

            <label className="kyle-research-private">
              <input type="checkbox" checked={privateSearch} onChange={(event) => setPrivateSearch(event.target.checked)} />
              <span><LockKey size={18} weight="duotone" /><span><strong>Private search</strong><small>Do not save this investigation to shared history or the relationship web.</small></span></span>
              <b>+{target.privateSurcharge.toFixed(1)}</b>
            </label>

            <div className="kyle-research-charge-note" role="note">
              ARGUS charges the actual investigation usage, never more than the maximum shown here.
            </div>

            <div className="kyle-research-sheet-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary" onClick={confirm} disabled={balanceState === "ready" && balance != null && balance < maximum}>{exploratory ? "Explore lead" : "Run investigation"} · up to {maximum.toFixed(1)} credits</button>
            </div>
          </div>
        )}

        {phase === "running" && (
          <div className="kyle-research-progress" aria-live="polite">
            <div className="kyle-research-progress-orbit"><MagnifyingGlass size={28} weight="duotone" /><span>{currentStep.at}%</span></div>
            <p className="mono">Live investigation</p>
            <h3>{currentStep.label}</h3>
            <div className="kyle-research-progress-track"><i style={{ width: `${currentStep.at}%` }} /></div>
            <p>This scan will keep running if you close this sheet or continue reading the {target.sourceReport} report.</p>
            <button type="button" className="btn-secondary" onClick={onClose}>Continue in background</button>
          </div>
        )}

        {phase === "complete" && (
          <div className="kyle-research-progress is-complete" aria-live="polite">
            <CheckCircle size={48} weight="duotone" />
            <p className="mono">Investigation complete</p>
            <h3>{target.name} is ready.</h3>
            <p>The new decision file is available without losing your place in the {target.sourceReport} investigation.</p>
            <div className="kyle-research-sheet-actions">
              <button type="button" className="btn-secondary" onClick={onClose}><ArrowLeft size={16} />Back to {target.sourceReport}</button>
              <button type="button" className="btn-primary" onClick={onOpenCompleted ?? onClose}>Open report</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
