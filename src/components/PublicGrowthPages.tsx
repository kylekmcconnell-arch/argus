import { useEffect, useState, type FormEvent } from "react";
import { ArgusMark } from "./ArgusMark";
import { ReferralLeaderboard } from "./ReferralLeaderboard";
import {
  ARGUS_PLANS,
  DEFAULT_REVENUE_SHARE,
  type ArgusPlan,
  type LeaderboardRow,
  type RevenueShareSplit,
} from "../lib/growth";

interface PublicBoard {
  leaderboard: Array<Omit<LeaderboardRow, "code" | "isCurrentUser"> & { codeTail: string; isCurrentUser?: boolean }>;
  revenueShare: RevenueShareSplit;
  pricing: { plans: ArgusPlan[]; checkoutActive: boolean };
}

function money(usd: number): string {
  return usd ? `$${usd}` : "Free";
}

export function PublicNav({ current }: { current: "leaderboard" | "pricing" | "join" }) {
  const link = (view: string, label: string) => (
    <a
      href={`/?view=${view}`}
      className={`text-[12.5px] ${current === view ? "font-medium text-ink" : "text-ink-dim hover:text-ink"}`}
    >
      {label}
    </a>
  );
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
      <a href="/" className="flex items-center gap-2.5 text-ink">
        <ArgusMark size={28} />
        <span className="text-[18px] font-semibold tracking-tight">ARGUS</span>
      </a>
      <nav className="flex items-center gap-4">
        {link("leaderboard", "Leaderboard")}
        {link("pricing", "Pricing")}
        {link("join", "Request access")}
        <a href="/" className="btn-primary px-3 py-1.5 text-[12.5px]">Sign in</a>
      </nav>
    </header>
  );
}

export function PricingGrid({ plans, checkoutActive }: { plans: readonly ArgusPlan[]; checkoutActive: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {plans.map((plan) => (
        <article key={plan.id} className="panel flex flex-col p-4">
          <div className="text-[15px] font-medium text-ink">{plan.name}</div>
          <div className="mt-2 text-[32px] font-semibold text-ink">
            {money(plan.monthlyUsd)}
            {plan.monthlyUsd > 0 && <span className="ml-1 text-[11px] font-normal text-ink-faint">/ month</span>}
          </div>
          <p className="mt-2 min-h-10 text-[12.5px] leading-relaxed text-ink-dim">{plan.description}</p>
          <ul className="mt-3 space-y-1 text-[12.5px] text-ink-dim">
            <li>{plan.investigationCredits} investigation credits</li>
            <li>{plan.seats} {plan.seats === 1 ? "seat" : "seats"}</li>
            <li>{plan.dailyLimit} investigations/day guardrail</li>
            {"extraPack" in plan && plan.extraPack && (
              <li>{`$${plan.extraPack.usd} per ${plan.extraPack.credits} extra credits`}</li>
            )}
          </ul>
          {plan.monthlyUsd > 0 && (
            <button type="button" disabled={!checkoutActive} className="btn-primary mt-4 w-full py-2 text-[12.5px] disabled:opacity-50">
              {checkoutActive ? "Continue to checkout" : "Billing connection pending"}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

export function PublicLeaderboardPage() {
  const [data, setData] = useState<PublicBoard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/leaderboard", { signal: AbortSignal.timeout(12_000) })
      .then(async (response) => {
        const body = await response.json() as PublicBoard & { message?: string };
        if (!response.ok) throw new Error(body.message || "Leaderboard could not be loaded.");
        if (active) setData(body);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Leaderboard could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="min-h-screen bg-void text-ink">
      <PublicNav current="leaderboard" />
      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <div className="eyebrow">Early access</div>
        <h1 className="display mt-2 text-[32px] text-ink md:text-[44px]">Referral leaderboard</h1>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
          Refer investigators to climb the board. Higher rank means earlier ARGUS access.
          After someone you referred subscribes, you earn {DEFAULT_REVENUE_SHARE.commissionPercent}% of that subscription:
          {` ${DEFAULT_REVENUE_SHARE.creditSplitPercent}% as ARGUS credits and ${DEFAULT_REVENUE_SHARE.cashSplitPercent}% as cash.`}
          Cash stays held until payout compliance is live.
        </p>
        {error && <div role="alert" className="mt-5 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12.5px] text-avoid">{error}</div>}
        <div className="mt-6">
          {!data && !error ? (
            <div role="status" className="py-12 text-center text-[13.5px] text-ink-dim">Loading the board…</div>
          ) : (
            <ReferralLeaderboard
              rows={(data?.leaderboard || []).map((row) => ({ ...row, isCurrentUser: Boolean(row.isCurrentUser) }))}
              empty="No qualified referrals yet. Be the first to share a link."
            />
          )}
        </div>
      </main>
    </div>
  );
}

export function PublicPricingPage() {
  return (
    <div className="min-h-screen bg-void text-ink">
      <PublicNav current="pricing" />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="eyebrow">Pricing</div>
        <h1 className="display mt-2 text-[32px] text-ink md:text-[44px]">Investigation credits, not raw API bills</h1>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
          One credit funds one standard investigation. Early testers start with a 10-credit budget and a 3/day guardrail.
          Extra credit packs will be available once billing is connected.
        </p>
        <div className="mt-8">
          <PricingGrid plans={ARGUS_PLANS} checkoutActive={false} />
        </div>
      </main>
    </div>
  );
}

export function JoinPage() {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [publicName, setPublicName] = useState("");
  const [email, setEmail] = useState("");
  const [referralCode, setReferralCode] = useState(params.get("ref")?.trim().toUpperCase() || "");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicName: publicName.trim(),
          email: email.trim().toLowerCase(),
          referralCode: referralCode.trim().toUpperCase() || undefined,
          returnTo: "/",
        }),
      });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message || "Signup could not be started.");
      setMessage(body.message || "If this email can join, a secure ARGUS link is on its way.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Signup could not be started.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-void text-ink">
      <PublicNav current="join" />
      <main className="mx-auto w-full max-w-[420px] px-5 py-12">
        <div className="eyebrow">Passkey signup</div>
        <h1 className="display-sm mt-2 text-[24px] text-ink">Request early access</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">
          Prove your email, then create a passkey. Rank on the referral board determines who gets in first.
        </p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-3">
          <label className="block text-[12.5px] font-medium text-ink-dim" htmlFor="join-name">Public name</label>
          <input
            id="join-name"
            required
            minLength={2}
            maxLength={40}
            value={publicName}
            onChange={(event) => setPublicName(event.target.value)}
            placeholder="How you appear on the board"
            className="field w-full px-3 py-2.5 text-[13.5px]"
          />
          <label className="block text-[12.5px] font-medium text-ink-dim" htmlFor="join-email">Email</label>
          <input
            id="join-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="mono field w-full px-3 py-2.5 text-[13.5px]"
          />
          <label className="block text-[12.5px] font-medium text-ink-dim" htmlFor="join-ref">Referral code (optional)</label>
          <input
            id="join-ref"
            value={referralCode}
            onChange={(event) => setReferralCode(event.target.value.toUpperCase())}
            placeholder="From a teammate's link"
            className="mono field w-full px-3 py-2.5 text-[13.5px]"
          />
          <button type="submit" disabled={sending} className="btn-primary mt-2 w-full py-2.5 text-[13.5px] disabled:opacity-40">
            {sending ? "Sending secure link…" : "Email me a signup link"}
          </button>
        </form>
        {message && <div className="mt-4 rounded-lg border border-signal/30 bg-signal/5 px-3 py-2.5 text-[12.5px] text-signal-lift" role="status">{message}</div>}
        {error && <div className="mt-4 rounded-lg border border-avoid/30 bg-avoid/5 px-3 py-2.5 text-[12.5px] text-avoid" role="alert">{error}</div>}
        <p className="mt-5 text-[11px] leading-relaxed text-ink-faint">
          After you open the email link, ARGUS will ask you to create a passkey. Product access is granted by rank and owner admission, not by signup alone.
        </p>
      </main>
    </div>
  );
}
