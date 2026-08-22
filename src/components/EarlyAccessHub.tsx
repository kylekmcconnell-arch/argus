import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CopyIcon, WalletIcon, XIcon } from "@phosphor-icons/react";
import { ReferralLeaderboard } from "./ReferralLeaderboard";
import { PricingGrid } from "./PricingGrid";
import type { ArgusPlan, LeaderboardRow, RevenueShareSplit } from "../lib/growth";

interface AccountSnapshot {
  access: "member" | "waitlist";
  credit: {
    balance: number;
    startingGrant: number;
    dailyLimit: number;
    ledger: Array<{ amount: number; reason: string; createdAt: string }>;
  } | null;
  referral: {
    code: string;
    publicName: string;
    qualified: number;
    rank: number;
    bonusPerQualifiedReferral: number;
    leaderboard: LeaderboardRow[];
    commission: {
      earnedCents: number;
      creditCents: number;
      cashCents: number;
      payableCashCents: number;
    };
    revenueShare: RevenueShareSplit;
  };
  pricing: {
    currency: string;
    creditDefinition: string;
    plans: ArgusPlan[];
    checkoutActive: boolean;
  };
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(cents / 100);
}

export function EarlyAccessHub({ triggerRoot }: { triggerRoot: Element | null }) {
  const [data, setData] = useState<AccountSnapshot | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  const open = () => {
    void load();
    setIsOpen(true);
  };
  const close = () => setIsOpen(false);
  const referralLink = data ? `${window.location.origin}/?view=join&ref=${data.referral.code}` : "";

  const copy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      {triggerRoot ? createPortal(
        <button
          type="button"
          onClick={open}
          className="mt-1 flex min-h-9 w-full items-center gap-2.5 rounded-md border border-line/80 bg-panel/45 px-2.5 py-2 text-[12.5px] font-medium text-ink-dim transition hover:border-signal/45 hover:bg-panel hover:text-ink"
          aria-label="Open credits, pricing, and referrals"
        >
          <WalletIcon size={17} className="text-ink-faint" aria-hidden />
          <span>{data?.credit ? `${data.credit.balance.toFixed(1)} credits` : "Credits"}</span>
        </button>,
        triggerRoot,
      ) : null}

      {isOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={close}
        >
          <dialog
            open
            aria-modal="true"
            aria-labelledby="early-access-title"
            className="relative m-0 max-h-[88dvh] w-[min(1080px,100%)] overflow-y-auto rounded-xl border border-line bg-void p-0 text-ink shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-line bg-void/95 px-5 py-4 backdrop-blur">
          <div>
            <div className="eyebrow">Early access account</div>
            <h2 id="early-access-title" className="display-sm mt-1 text-[24px] text-ink">Credits, pricing, and referrals</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close account panel" className="rounded-md p-2 text-ink-dim hover:bg-panel hover:text-ink">
            <XIcon size={18} aria-hidden />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {error && <div role="alert" className="rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12.5px] text-avoid">{error}</div>}
          {!data ? (
            <div role="status" className="py-12 text-center text-[13.5px] text-ink-dim">Loading account…</div>
          ) : (
            <>
              <section className="grid gap-3 sm:grid-cols-4">
                <div className="stat-tile">
                  <div className="stat-label">Available</div>
                  <div className="stat-value mt-1">{data.credit ? data.credit.balance.toFixed(1) : "0.0"}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">
                    {data.credit ? `${data.credit.startingGrant} starting · ${data.credit.dailyLimit}/day` : "investigation credits"}
                  </div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Board rank</div>
                  <div className="stat-value mt-1">#{data.referral.rank}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">earlier rank, earlier access</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Qualified referrals</div>
                  <div className="stat-value mt-1">{data.referral.qualified}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">+{data.referral.bonusPerQualifiedReferral} credits each</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label">Referral earnings</div>
                  <div className="stat-value mt-1">{money(data.referral.commission.earnedCents)}</div>
                  <div className="mt-1 text-[11px] text-ink-faint">{data.referral.revenueShare.creditSplitPercent}% credits · {data.referral.revenueShare.cashSplitPercent}% cash held</div>
                </div>
              </section>

              <section>
                <h3 className="text-[15px] font-medium text-ink">Your referral link</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
                  Qualified referrals move you up the board. Revenue share is {data.referral.revenueShare.commissionPercent}% of referred subscription value, paid as {data.referral.revenueShare.creditSplitPercent}% ARGUS credits and {data.referral.revenueShare.cashSplitPercent}% cash.
                </p>
                <div className="mt-3 flex gap-2">
                  <input readOnly value={referralLink} aria-label="Referral link" className="field mono min-w-0 flex-1 px-3 py-2 text-[12.5px]" />
                  <button type="button" onClick={() => void copy()} className="btn-primary flex items-center gap-2 px-3 py-2 text-[12.5px]">
                    <CopyIcon size={15} aria-hidden /> {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </section>

              <section>
                <h3 className="text-[15px] font-medium text-ink">Referral leaderboard</h3>
                <div className="mt-3">
                  <ReferralLeaderboard rows={data.referral.leaderboard} empty="No qualified referrals yet." />
                </div>
              </section>

              <section>
                <h3 className="text-[15px] font-medium text-ink">Pricing</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">
                  One credit funds one standard investigation. Extra packs are listed so testers can pay for more once billing is connected.
                </p>
                <div className="mt-3">
                  <PricingGrid plans={data.pricing.plans} checkoutActive={data.pricing.checkoutActive} />
                </div>
              </section>
            </>
          )}
        </div>
          </dialog>
        </div>
      )}
    </>
  );
}
