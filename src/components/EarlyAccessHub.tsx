import { useEffect, useRef, useState } from "react";
import { CopyIcon, MedalIcon, WalletIcon, XIcon } from "@phosphor-icons/react";

interface Plan {
  id: string;
  name: string;
  monthlyUsd: number;
  investigationCredits: number;
  seats: number;
  dailyLimit: number;
  description: string;
  extraPack?: { credits: number; usd: number };
}
interface AccountSnapshot {
  credit: {
    balance: number;
    startingGrant: number;
    ledger: Array<{ amount: number; reason: string; createdAt: string }>;
  };
  referral: {
    code: string;
    qualified: number;
    bonusPerQualifiedReferral: number;
    leaderboard: Array<{ rank: number; code: string; referrals: number; isCurrentUser: boolean }>;
    commission: {
      earnedCents: number;
      creditCents: number;
      cashCents: number;
      payableCashCents: number;
    };
    revenueShare: {
      commissionPercent: number;
      creditSplitPercent: number;
      cashSplitPercent: number;
      cashPayoutsActive: boolean;
    };
  };
  pricing: {
    currency: string;
    creditDefinition: string;
    plans: Plan[];
    checkoutActive: boolean;
  };
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function EarlyAccessHub() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = async () => {
    try {
      const response = await fetch("/api/account-growth", { signal: AbortSignal.timeout(12_000) });
      const body = await response.json() as AccountSnapshot & { message?: string };
      if (!response.ok) throw new Error(body.message || "Account details could not be loaded.");
      setData(body);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Account details could not be loaded.");
    }
  };

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const code = params.get("ref")?.trim().toUpperCase();
    if (!code) return;
    void fetch("/api/account-growth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ referralCode: code }),
    }).finally(() => {
      params.delete("ref");
      const next = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", next);
      void load();
    });
  }, []);

  const open = () => {
    void load();
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();
  const referralLink = data ? `${window.location.origin}/?ref=${data.referral.code}` : "";

  const copy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="fixed bottom-4 left-4 z-50 flex min-h-10 items-center gap-2 rounded-full border border-line bg-panel px-3.5 py-2 text-[12.5px] font-medium text-ink shadow-lg transition hover:border-signal/60 hover:bg-panel-2 lg:left-[264px]"
        aria-label="Open credits, pricing, and referrals"
      >
        <WalletIcon size={17} aria-hidden />
        <span>{data ? `${data.credit.balance.toFixed(1)} credits` : "Credits"}</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="early-access-title"
        className="m-auto max-h-[88dvh] w-[min(920px,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-void p-0 text-ink shadow-2xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-void/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="eyebrow">Early access account</div>
            <h2 id="early-access-title" className="display-sm mt-1 text-[22px] text-ink">Credits, pricing, and referrals</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close account panel" className="rounded-md p-2 text-ink-dim hover:bg-panel hover:text-ink">
            <XIcon size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {error && <div role="alert" className="rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12.5px] text-avoid">{error}</div>}
          {!data ? (
            <div role="status" className="py-12 text-center text-[13px] text-ink-dim">Loading account…</div>
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-3">
                <div className="stat-tile">
                  <div className="stat-label">Available</div>
                  <div className="stat-value mt-1">{data.credit.balance.toFixed(1)}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">investigation credits</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Qualified referrals</div>
                  <div className="stat-value mt-1">{data.referral.qualified}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">+{data.referral.bonusPerQualifiedReferral} credits each</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Referral earnings</div>
                  <div className="stat-value mt-1">{money(data.referral.commission.earnedCents)}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">cash payouts activate after compliance setup</div>
                </div>
              </section>

              <section>
                <h3 className="text-[14px] font-medium text-ink">Your referral link</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                  Qualified referrals move you up the board and add test credits. Revenue share is configured at {data.referral.revenueShare.commissionPercent}% of referred subscription revenue: {data.referral.revenueShare.creditSplitPercent}% of the commission as ARGUS credits and {data.referral.revenueShare.cashSplitPercent}% as cash.
                </p>
                <div className="mt-3 flex gap-2">
                  <input readOnly value={referralLink} aria-label="Referral link" className="field mono min-w-0 flex-1 px-3 py-2 text-[12px]" />
                  <button type="button" onClick={() => void copy()} className="btn-primary flex items-center gap-2 px-3 py-2 text-[12px]">
                    <CopyIcon size={15} aria-hidden /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2">
                  <MedalIcon size={18} className="text-signal-lift" aria-hidden />
                  <h3 className="text-[14px] font-medium text-ink">Referral leaderboard</h3>
                </div>
                <div className="panel mt-3 overflow-hidden">
                  {data.referral.leaderboard.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[12px] text-ink-faint">No qualified referrals yet.</div>
                  ) : data.referral.leaderboard.map((row) => (
                    <div key={row.code} className={`flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 ${row.isCurrentUser ? "bg-signal/5" : ""}`}>
                      <span className="mono w-8 text-[12px] text-ink-faint">#{row.rank}</span>
                      <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-ink">{row.code}{row.isCurrentUser ? " · you" : ""}</span>
                      <span className="mono text-[12px] text-ink-dim">{row.referrals}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-[14px] font-medium text-ink">Proposed pricing</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                  One credit funds one standard investigation. Prices are based on the current provider-cost distribution and remain in test mode until billing is connected.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {data.pricing.plans.map((plan) => (
                    <article key={plan.id} className="panel flex flex-col p-4">
                      <div className="text-[13.5px] font-medium text-ink">{plan.name}</div>
                      <div className="mt-2 text-[24px] font-semibold text-ink">
                        {plan.monthlyUsd ? `$${plan.monthlyUsd}` : "Free"}
                        {plan.monthlyUsd > 0 && <span className="ml-1 text-[11px] font-normal text-ink-faint">/ month</span>}
                      </div>
                      <p className="mt-2 min-h-10 text-[11.5px] leading-relaxed text-ink-dim">{plan.description}</p>
                      <ul className="mt-3 space-y-1 text-[11.5px] text-ink-dim">
                        <li>{plan.investigationCredits} investigation credits</li>
                        <li>{plan.seats} {plan.seats === 1 ? "seat" : "seats"}</li>
                        <li>{plan.dailyLimit} investigations/day guardrail</li>
                        {plan.extraPack && <li>{`$${plan.extraPack.usd} per ${plan.extraPack.credits} extra credits`}</li>}
                      </ul>
                      {plan.monthlyUsd > 0 && (
                        <button type="button" disabled className="btn-primary mt-4 w-full py-2 text-[12px] disabled:opacity-50">
                          Billing connection pending
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
