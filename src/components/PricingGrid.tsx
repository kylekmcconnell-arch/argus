import type { ArgusPlan } from "../lib/growth";

function money(usd: number): string {
  return usd ? `$${usd}` : "Free";
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
              {checkoutActive ? "Continue to checkout" : "Billing not active"}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
