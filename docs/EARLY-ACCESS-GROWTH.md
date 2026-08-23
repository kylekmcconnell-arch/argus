# ARGUS Early Access, Pricing, Feedback, and Referrals

Status: app on `main`; waitlist/credit SQL pending first GitHub→Supabase deploy. Continues #86 / #88.

## Product model

ARGUS meters standard investigations with investigation credits instead of exposing raw provider dollars. Current 30-day production evidence shows an average provider cost of about $1.11 per saved report, a median of $0.97, and a p90 of $2.26. Credits keep the user experience stable while preserving enough price headroom for variance, support, storage, retries, and fixed infrastructure.

### Launch pricing

| Plan | Monthly price | Included investigations | Seats | Daily guardrail | Additional credits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Early access | $0 | 10 one-time | 1 | 3/day | not sold |
| Analyst | $129 | 20/month | 1 | 8/day | $59 per 10 |
| Team | $399 | 60/month | 5 | 20/day | $59 per 10 |
| Enterprise | custom | contract | custom | contract | contract |

A full rescan may later consume more than one credit after sufficient live cost data exists. The first implementation keeps the unit understandable: one standard investigation equals one credit.

Prices are configuration, not an accounting source of truth. Paid checkout remains disabled until a billing provider, product/price IDs, webhook fulfillment, refund handling, and tax treatment are verified end to end.

### Pricing basis

The launch prices are a hypothesis that must be replaced or confirmed by the measured beta cycle. They use the current 30-day cost snapshot and conservatively reserve the configured 20% referral commission before calculating contribution margin.

| Offer | Net revenue after referral share | Provider cost at average | Margin at average | Provider cost at p90 | Margin at p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Analyst · 20 credits | $103.20 | $22.20 | 78.5% | $45.20 | 56.2% |
| Team · 60 credits | $319.20 | $66.60 | 79.1% | $135.60 | 57.5% |
| Extra pack · 10 credits | $47.20 | $11.10 | 76.5% | $22.60 | 52.1% |

These are contribution margins before fixed subscriptions, infrastructure, support, storage, retries, payment processing, refunds, and taxes. The executable pricing test prevents any configured paid offer from falling below 50% at the recorded p90 provider cost after referral share.

Market context is deliberately secondary to measured ARGUS cost. [Nansen Pro](https://academy.nansen.ai/en/help/articles/9412804-about-nansen-pro) is currently $49/month annually or $69 monthly for a broad self-service analytics product. [Messari](https://messari.io/pricing) places institutional diligence and advanced APIs in its enterprise offering. ARGUS is positioned between those products: fewer units than a dashboard subscription, but each unit produces a saved, source-bound due-diligence report.

## Signup and passkeys

1. Anyone can request early access at `/?view=join` with a public board name and email.
2. ARGUS emails a one-time link. Opening it proves email possession and places the person on the waitlist, not in the product.
3. ARGUS then asks them to register a passkey. Subsequent sign-in prefers the discoverable passkey. Email remains recovery.
4. Rank on the public referral leaderboard (`/?view=leaderboard`) determines earlier product access. Owners can admit a waitlist identity from Access and activity.
5. Admitted testers receive workspace membership, the 10-credit starting grant, and the early-access daily guardrail.

Supabase passkeys are experimental. The relying-party ID must be selected once and kept stable. Production should use the canonical ARGUS domain; previews need allowed origins under the same RP ID or a separate preview Auth project.

## Early-access credits and limits

- Every admitted tester receives an idempotent 10-credit starting grant.
- Owners can add five test credits from Access and activity. Each server request is capped at 10 credits and protected by a client-generated idempotency key.
- Non-owner investigations debit one credit and remain under the 3/day early-access guardrail unless `ARGUS_DAILY_INVESTIGATION_LIMIT` is set.
- Credit exhaustion fails closed. Daily quota still fails open on storage blips.
- The credit ledger is append-only. Adjustments and refunds are new rows, never balance rewrites.
- Extra credit packs are listed on pricing. Checkout stays off until billing is authorized.
- A 20-person cohort has a maximum initial allocation of 200 reports: about $222 at the current average provider cost or $452 at p90. This is the beta reserve, not a user charge.

## Feedback to Claude

A persistent hover button is available to authenticated members. A submission records:

- exact route and optional report version;
- viewport and document title;
- user-selected priority;
- immutable submitter and workspace;
- Claude assignment and lifecycle status.

Owners manage the queue as To do, Planned, In progress, Done, or Won't do, including a Done checkbox. "Assigned to Claude" is task routing, not permission for autonomous production changes.

## Referrals

### Access leaderboard

Every waitlist identity and admitted member gets a referral code. Attribution occurs once after the referred person authenticates. Qualified referrals:

- increase leaderboard rank (ties break to the earlier signup);
- add two ARGUS credits to the referrer once that referrer has an organization;
- cannot be self-referrals;
- cannot be reassigned after first attribution.

Public rows expose public names, ranks, access state, and counts. They never expose email addresses.

Authenticated members also have a first-class Referrals workspace in the main sidebar. Opening it calls the existing account growth endpoint, which creates a missing referral profile before returning the member's personal link. The workspace keeps the public board access-focused: ranks, qualified referrals, investigation credits, access state, and masked code tails. It does not expose commission, cash, or payout controls.

### Subscription revenue share

Default: a referrer earns 20% of collected subscription revenue from a referred customer. Of that commission:

- 25% is issued as ARGUS credits;
- 75% is tracked as cash.

Cash payouts remain held until identity verification, tax forms, sanctions checks, minimum payout thresholds, refund/chargeback reversals, and jurisdiction rules are implemented. The database records immutable commission rows by source invoice so webhook retries cannot pay twice.

## Security properties

- Authorization never reads editable user metadata.
- Product tables are RLS-enabled and not directly granted to anon or authenticated roles.
- Browser clients use authenticated ARGUS APIs; service credentials remain server-only.
- Starting grants, referral claims, and future invoice commissions use idempotency keys.
- Join and sign-in share hashed IP/email rate limits and generic success copy.
- Feedback updates and waitlist admission require owner access.

## Activation checklist

1. Enable Supabase Auth Passkeys.
2. Set RP display name to ARGUS.
3. Set the stable RP ID to the canonical production domain.
4. Add production and explicitly approved preview origins.
5. Apply the growth-foundation and waitlist/credit migrations through the
   GitHub pipeline below. Do not paste SQL by hand.
6. Deploy the preview and complete passkey create/sign-in/recovery tests.
7. Confirm early-access grant, credit debit, and referral attribution idempotency.
8. Select billing provider and create live/test products.
9. Add checkout, verified webhook fulfillment, refunds, and commission reversals.
10. Complete legal review for affiliate cash payouts before activation.

## Agent production pipeline

Agents do not log into Supabase or Vercel. They open a GitHub PR. After review
and merge to `main`:

1. **App:** Vercel already deploys `kylekmcconnell-arch/argus` from `main`.
2. **Database:** Supabase GitHub integration, project `mpjpmgdklxpzggypmpwn`,
   **Deploy to production** on, **Automatic branching** off, working directory
   `.`. New files under `supabase/migrations/` apply on that merge.
3. **Billing:** stays disabled. No Stripe, checkout, or cash payouts.

Schema work belongs in a new timestamped file in `supabase/migrations/`. Keep
it additive and re-runnable. Product membership, credits, and waitlist rules
stay server-owned.

Production already applied the growth foundation as `20260821135838` and
`20260821135903`. The repo files use those versions. After that history match,
the integrator still has to record `20260720120000_entity_facts_knowledge`
against a table that already exists, then apply
`20260821200000_growth_waitlist_credits`.

Optional fallback if the integration cannot run: GitHub environment
`Production` secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, then
**Actions → Production Supabase** with `confirm_production=apply-production-argus`.
Do not put those values in Vercel env files or chat.
