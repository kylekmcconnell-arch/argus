import { useEffect, useMemo, useState } from "react";
import { CheckIcon, CopyIcon, LinkIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { ArgusMark } from "./ArgusMark";
import { ReferralLeaderboard } from "./ReferralLeaderboard";
import type { LeaderboardRow } from "../lib/growth";

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
  };
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

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="overflow-hidden rounded-xl border border-line-2 bg-sidebar px-5 py-6 text-ink shadow-sm sm:px-7 sm:py-8">
        <div className="flex items-center gap-4 sm:gap-5">
          <ArgusMark size={52} live motion="focused" />
          <div className="min-w-0">
            <div className="eyebrow text-signal-lift">Member network</div>
            <h1 className="display mt-1 text-[32px] leading-none tracking-[-0.02em] text-ink sm:text-[44px]">
              ARGUS <span className="text-ink-dim">REFERRALS</span>
            </h1>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
          Invite trusted investigators. Each qualified referral moves you up the access board and adds investigation credits to your workspace.
        </p>
      </header>

      {error ? (
        <div role="alert" className="mt-5 rounded-lg border border-avoid/30 bg-avoid/5 px-4 py-3 text-[12.5px] text-avoid">{error}</div>
      ) : !data ? (
        <div role="status" className="panel mt-5 flex min-h-44 items-center justify-center text-[13.5px] text-ink-dim">
          Loading your referral workspace…
        </div>
      ) : (
        <>
          <section className="panel mt-5 p-4 sm:p-5" aria-labelledby="personal-referral-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="eyebrow">Personal referral link</div>
                <h2 id="personal-referral-title" className="mt-1 text-[18px] font-medium text-ink">Share your Argus access link</h2>
                <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-dim">
                  Your code is created automatically and stays attached to your account. A referral qualifies after the invited investigator verifies access.
                </p>
              </div>
              <span className="chip tint-signal self-start lg:self-auto">Code {data.referral.code}</span>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Referral link</span>
                <LinkIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input readOnly value={referralLink} className="field mono w-full py-2.5 pl-9 pr-3 text-[12.5px]" />
              </label>
              <button type="button" onClick={() => void copyLink()} className="btn-primary flex min-h-10 items-center justify-center gap-2 px-4 text-[12.5px]">
                {copied ? <CheckIcon size={16} aria-hidden /> : <CopyIcon size={16} aria-hidden />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </section>

          <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Referral performance">
            <div className="stat-tile"><div className="stat-label">Board rank</div><div className="stat-value mt-1">#{data.referral.rank}</div><div className="mt-1 text-[11px] text-ink-faint">among verified referrers</div></div>
            <div className="stat-tile"><div className="stat-label">Qualified referrals</div><div className="stat-value mt-1">{data.referral.qualified}</div><div className="mt-1 text-[11px] text-ink-faint">verified investigators</div></div>
            <div className="stat-tile"><div className="stat-label">Credits earned</div><div className="stat-value mt-1">{data.referral.qualified * data.referral.bonusPerQualifiedReferral}</div><div className="mt-1 text-[11px] text-ink-faint">{data.referral.bonusPerQualifiedReferral} per qualified referral</div></div>
            <div className="stat-tile"><div className="stat-label">Available credits</div><div className="stat-value mt-1">{data.credit?.balance.toFixed(1) ?? "0.0"}</div><div className="mt-1 text-[11px] text-ink-faint">ready for investigations</div></div>
          </section>

          <section className="mt-7" aria-labelledby="referral-board-title">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <div className="eyebrow">Network standing</div>
                <h2 id="referral-board-title" className="mt-1 text-[18px] font-medium text-ink">Referral leaderboard</h2>
              </div>
              <ShareNetworkIcon size={22} className="text-signal-lift" aria-hidden />
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
  );
}
