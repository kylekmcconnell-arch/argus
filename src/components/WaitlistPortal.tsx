import { useEffect, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import { ReferralLeaderboard } from "./ReferralLeaderboard";
import { PricingGrid } from "./PublicGrowthPages";
import type { ArgusPlan, LeaderboardRow, RevenueShareSplit } from "../lib/growth";

interface WaitlistAccount {
  access: "waitlist";
  referral: {
    code: string;
    publicName: string;
    qualified: number;
    rank: number;
    bonusPerQualifiedReferral: number;
    leaderboard: LeaderboardRow[];
    revenueShare: RevenueShareSplit;
  };
  pricing: { plans: ArgusPlan[]; checkoutActive: boolean };
}

export function WaitlistPortal({
  displayName,
  onEnrollPasskey,
  passkeyBusy,
  passkeyError,
  onSignOut,
}: {
  displayName: string;
  onEnrollPasskey: () => Promise<void>;
  passkeyBusy: boolean;
  passkeyError: string;
  onSignOut: () => Promise<void>;
}) {
  const [data, setData] = useState<WaitlistAccount | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/account-growth", { signal: AbortSignal.timeout(12_000) })
      .then(async (response) => {
        const body = await response.json() as WaitlistAccount & { message?: string };
        if (!response.ok) throw new Error(body.message || "Waitlist details could not be loaded.");
        if (active) setData(body);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Waitlist details could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  const referralLink = data ? `${window.location.origin}/?view=join&ref=${data.referral.code}` : "";
  const copy = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="min-h-screen bg-void px-5 py-10 text-ink">
      <main className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="eyebrow">Waitlist</div>
            <h1 className="display-sm mt-2 text-[24px] text-ink">You're in the queue, {displayName}</h1>
            <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
              Create a passkey for the next visit. Share your referral link: every qualified signup moves you up the board, and higher rank gets earlier ARGUS access.
            </p>
          </div>
          <button type="button" onClick={() => void onSignOut()} className="btn-chip">Sign out</button>
        </div>

        <section className="panel mt-6 p-4">
          <h2 className="text-[15px] font-medium text-ink">Create your passkey</h2>
          <p className="mt-1 text-[12.5px] text-ink-dim">Face ID, Touch ID, Windows Hello, or a hardware key. Your email link stays available for recovery.</p>
          {passkeyError && <p className="mt-2 text-[12.5px] text-avoid" role="alert">{passkeyError}</p>}
          <button type="button" onClick={() => void onEnrollPasskey()} disabled={passkeyBusy} className="btn-primary mt-3 px-4 py-2 text-[12.5px] disabled:opacity-40">
            {passkeyBusy ? "Opening passkey…" : "Create passkey"}
          </button>
        </section>

        {error && <div role="alert" className="mt-5 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12.5px] text-avoid">{error}</div>}

        {data && (
          <>
            <section className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="stat-tile">
                <div className="stat-label">Your rank</div>
                <div className="stat-value mt-1">#{data.referral.rank}</div>
                <div className="mt-1 text-[11px] text-ink-faint">lower is earlier access</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Qualified referrals</div>
                <div className="stat-value mt-1">{data.referral.qualified}</div>
                <div className="mt-1 text-[11px] text-ink-faint">+{data.referral.bonusPerQualifiedReferral} credits each after admission</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Revenue share</div>
                <div className="stat-value mt-1">{data.referral.revenueShare.commissionPercent}%</div>
                <div className="mt-1 text-[11px] text-ink-faint">{data.referral.revenueShare.creditSplitPercent}% credits · {data.referral.revenueShare.cashSplitPercent}% cash</div>
              </div>
            </section>

            <section className="mt-6">
              <h2 className="text-[15px] font-medium text-ink">Your referral link</h2>
              <div className="mt-3 flex gap-2">
                <input readOnly value={referralLink} aria-label="Referral link" className="field mono min-w-0 flex-1 px-3 py-2 text-[12.5px]" />
                <button type="button" onClick={() => void copy()} className="btn-primary flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <CopyIcon size={15} aria-hidden /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-[15px] font-medium text-ink">Referral leaderboard</h2>
              <div className="mt-3">
                <ReferralLeaderboard rows={data.referral.leaderboard} empty="No qualified referrals yet." />
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-[15px] font-medium text-ink">Proposed pricing</h2>
              <p className="mt-1 text-[12.5px] text-ink-dim">Checkout stays off until billing is connected. Extra credits will be purchasable from these packs.</p>
              <div className="mt-3">
                <PricingGrid plans={data.pricing.plans} checkoutActive={data.pricing.checkoutActive} />
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
