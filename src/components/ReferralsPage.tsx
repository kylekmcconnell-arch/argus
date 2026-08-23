import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CoinsIcon,
  CopyIcon,
  CurrencyDollarIcon,
  GiftIcon,
  LinkIcon,
  ShareNetworkIcon,
  TrendUpIcon,
  UsersThreeIcon,
  WalletIcon,
} from "@phosphor-icons/react";
import { ArgusMark } from "./ArgusMark";
import { ReferralLeaderboard } from "./ReferralLeaderboard";
import { DEFAULT_REVENUE_SHARE, type LeaderboardRow, type RevenueShareSplit } from "../lib/growth";

interface ReferralCommission {
  earnedCents: number;
  creditCents: number;
  cashCents: number;
  payableCashCents: number;
}

export interface ReferralSnapshot {
  access: "member" | "waitlist";
  credit: { balance: number } | null;
  referral: {
    code: string;
    publicName: string;
    qualified: number;
    rank: number;
    bonusPerQualifiedReferral: number;
    leaderboard: LeaderboardRow[];
    commission: ReferralCommission;
    revenueShare: RevenueShareSplit;
  };
}

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(cents: number): string {
  return USD.format(Math.max(0, cents) / 100);
}

export function ReferralsPage({ initialData = null }: { initialData?: ReferralSnapshot | null }) {
  const [data, setData] = useState<ReferralSnapshot | null>(initialData);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    void fetch("/api/account-growth", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as ReferralSnapshot & { message?: string };
        if (!response.ok) throw new Error(body.message || "Referral details could not be loaded.");
        if (active) setData(body);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        if (controller.signal.aborted) setError("Referral details took too long to load. Try again.");
        else setError(loadError instanceof Error ? loadError.message : "Referral details could not be loaded.");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [initialData]);

  const referralLink = useMemo(() => (
    data ? `${window.location.origin}/?view=join&ref=${data.referral.code}` : ""
  ), [data]);

  const copyLink = async () => {
    if (!referralLink) return;
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  };

  const commission = data?.referral.commission ?? { earnedCents: 0, creditCents: 0, cashCents: 0, payableCashCents: 0 };
  const revenueShare = data?.referral.revenueShare ?? DEFAULT_REVENUE_SHARE;
  const investigationCreditsEarned = data
    ? data.referral.qualified * data.referral.bonusPerQualifiedReferral
    : 0;

  return (
    <div className="workspace-frame">
      <div className="referral-workspace">
      {error ? (
        <div role="alert" className="rounded-lg border border-avoid/30 bg-avoid/5 px-4 py-3 text-[12.5px] text-avoid">{error}</div>
      ) : !data ? (
        <div role="status" className="panel flex min-h-64 items-center justify-center text-[13.5px] text-ink-dim">
          Loading your referral workspace…
        </div>
      ) : (
        <>
          <header className="referral-earnings-hero">
            <div className="referral-earnings-story">
              <div className="flex items-center gap-3">
                <ArgusMark size={46} live motion="focused" />
                <div className="eyebrow text-signal-lift">ARGUS member network</div>
              </div>
              <h1 className="mt-8 max-w-3xl text-[clamp(38px,5vw,70px)] font-medium leading-[0.96] tracking-[-0.045em] text-ink">
                Investigate more.<br />Earn when your network does.
              </h1>
              <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-ink-dim">
                Invite trusted investigators. Every qualified referral earns {data.referral.bonusPerQualifiedReferral} investigation credits, and referred subscriptions return {revenueShare.commissionPercent}% to you as ARGUS credits and cash.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5" aria-label="Referral reward terms">
                <span className="referral-term"><CoinsIcon size={17} weight="duotone" aria-hidden />+{data.referral.bonusPerQualifiedReferral} investigation credits</span>
                <span className="referral-term"><CurrencyDollarIcon size={17} weight="duotone" aria-hidden />{revenueShare.commissionPercent}% subscription reward</span>
              </div>
            </div>

            <section className="referral-earnings-card" aria-labelledby="referral-earnings-title">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="eyebrow text-on-signal/70">Your referral rewards</div>
                  <h2 id="referral-earnings-title" className="mt-2 text-[15px] font-medium text-on-signal">Total earned</h2>
                </div>
                <TrendUpIcon size={26} weight="duotone" className="text-on-signal" aria-hidden />
              </div>
              <div className="mt-5 text-[clamp(38px,4vw,58px)] font-semibold leading-none tracking-[-0.04em] text-on-signal">
                {money(commission.earnedCents)}
              </div>
              <div className="referral-earnings-breakdown">
                <div>
                  <span><CoinsIcon size={18} weight="duotone" aria-hidden />ARGUS credit value</span>
                  <strong>{money(commission.creditCents)}</strong>
                  <small>{revenueShare.creditSplitPercent}% of subscription rewards</small>
                </div>
                <div>
                  <span><CurrencyDollarIcon size={18} weight="duotone" aria-hidden />Cash earned</span>
                  <strong>{money(commission.cashCents)}</strong>
                  <small>{revenueShare.cashSplitPercent}% of subscription rewards</small>
                </div>
              </div>
              <div className="referral-payout-state">
                <WalletIcon size={18} weight="duotone" aria-hidden />
                <span>
                  <strong>{revenueShare.cashPayoutsActive ? `${money(commission.payableCashCents)} ready for payout` : "Cash balance is being tracked"}</strong>
                  <small>{revenueShare.cashPayoutsActive ? "Eligible cash can be paid out." : "Cash payouts are not active yet. Your earned balance stays recorded."}</small>
                </span>
              </div>
            </section>
          </header>

          <section className="referral-invite-card" aria-labelledby="personal-referral-title">
            <div className="referral-invite-copy">
              <div className="eyebrow">Your invite link</div>
              <h2 id="personal-referral-title" className="mt-1 text-[24px] font-medium tracking-[-0.025em] text-ink">Bring a trusted investigator into ARGUS</h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-ink-dim">
                A referral qualifies after access is verified. If they subscribe later, their eligible subscription value contributes to your credits and cash earnings.
              </p>
            </div>
            <span className="chip tint-signal self-start">Code {data.referral.code}</span>
            <div className="referral-link-control">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Referral link</span>
                <LinkIcon size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input readOnly value={referralLink} className="field mono w-full py-3.5 pl-11 pr-3 text-[12.5px]" />
              </label>
              <button type="button" onClick={() => void copyLink()} className="btn-primary flex min-h-12 items-center justify-center gap-2 px-5 text-[12.5px]">
                {copied ? <CheckIcon size={17} aria-hidden /> : <CopyIcon size={17} aria-hidden />}
                {copied ? "Copied" : "Copy invite link"}
              </button>
            </div>
          </section>

          <section className="referral-metric-grid" aria-label="Referral performance">
            <article className="referral-metric-card">
              <span className="referral-metric-icon"><UsersThreeIcon size={21} weight="duotone" aria-hidden /></span>
              <div className="stat-label">Qualified referrals</div>
              <div className="referral-metric-value">{data.referral.qualified}</div>
              <p>verified investigators</p>
            </article>
            <article className="referral-metric-card is-signal">
              <span className="referral-metric-icon"><CoinsIcon size={21} weight="duotone" aria-hidden /></span>
              <div className="stat-label">Investigation credits earned</div>
              <div className="referral-metric-value">+{investigationCreditsEarned}</div>
              <p>{data.referral.bonusPerQualifiedReferral} for every qualified referral</p>
            </article>
            <article className="referral-metric-card">
              <span className="referral-metric-icon"><WalletIcon size={21} weight="duotone" aria-hidden /></span>
              <div className="stat-label">Available credits</div>
              <div className="referral-metric-value">{data.credit?.balance.toFixed(1) ?? "0.0"}</div>
              <p>ready for investigations</p>
            </article>
            <article className="referral-metric-card">
              <span className="referral-metric-icon"><ArrowUpRightIcon size={21} weight="duotone" aria-hidden /></span>
              <div className="stat-label">Network rank</div>
              <div className="referral-metric-value">#{data.referral.rank}</div>
              <p>among verified referrers</p>
            </article>
          </section>

          <section className="referral-how-it-works" aria-labelledby="referral-reward-model-title">
            <div>
              <div className="eyebrow">Reward model</div>
              <h2 id="referral-reward-model-title" className="mt-1 text-[24px] font-medium tracking-[-0.025em] text-ink">One referral. Two ways to earn.</h2>
            </div>
            <div className="referral-reward-steps">
              <article><span>01</span><GiftIcon size={23} weight="duotone" aria-hidden /><strong>They qualify</strong><p>You receive {data.referral.bonusPerQualifiedReferral} investigation credits as soon as their access is verified.</p></article>
              <article><span>02</span><TrendUpIcon size={23} weight="duotone" aria-hidden /><strong>They subscribe</strong><p>You earn {revenueShare.commissionPercent}% of eligible subscription value attributed to your referral.</p></article>
              <article><span>03</span><WalletIcon size={23} weight="duotone" aria-hidden /><strong>You earn credits + cash</strong><p>{revenueShare.creditSplitPercent}% becomes ARGUS credit value and {revenueShare.cashSplitPercent}% is tracked as cash earned.</p></article>
            </div>
          </section>

          <section className="mt-9" aria-labelledby="referral-board-title">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <div className="eyebrow">Member network</div>
                <h2 id="referral-board-title" className="mt-1 text-[24px] font-medium tracking-[-0.025em] text-ink">Referral leaderboard</h2>
                <p className="mt-1 text-[12.5px] text-ink-dim">See who is growing the network and what that growth has earned.</p>
              </div>
              <ShareNetworkIcon size={24} className="text-signal-lift" aria-hidden />
            </div>
            <ReferralLeaderboard
              rows={data.referral.leaderboard}
              empty="No qualified referrals yet. Share your link to start the board."
              bonusPerQualifiedReferral={data.referral.bonusPerQualifiedReferral}
            />
          </section>
        </>
      )}
      </div>
    </div>
  );
}
