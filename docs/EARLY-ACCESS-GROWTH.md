# ARGUS Early Access, Pricing, Feedback, and Referrals

Status: draft implementation contract, August 21, 2026.

## Product model

ARGUS meters standard investigations with investigation credits instead of exposing raw provider dollars. Current 30-day production evidence shows an average provider cost of about $1.11 per saved report, a median of $0.97, and a p90 of $2.26. Credits keep the user experience stable while preserving enough price headroom for variance, support, storage, retries, and fixed infrastructure.

### Proposed launch pricing

| Plan | Monthly price | Included investigations | Seats | Daily guardrail | Additional credits |
| --- | ---: | ---: | ---: | ---: | ---: |
| Early access | $0 | 10 one-time | 1 | 3/day | not sold |
| Analyst | $99 | 25/month | 1 | 10/day | $39 per 10 |
| Team | $299 | 100/month | 5 | 30/day | $35 per 10 |
| Enterprise | custom | contract | custom | contract | contract |

A full rescan may later consume more than one credit after sufficient live cost data exists. The first implementation keeps the unit understandable: one standard investigation equals one credit.

Prices are configuration, not an accounting source of truth. Paid checkout remains disabled until a billing provider, product/price IDs, webhook fulfillment, refund handling, and tax treatment are verified end to end.

## Signup and passkeys

1. An owner invites an early tester through the existing workspace access flow.
2. The tester proves email possession with the existing single-use link.
3. ARGUS prompts the confirmed user to register a passkey.
4. Subsequent sign-in prefers the discoverable passkey. Email link remains a recovery path.
5. Workspace membership, role, activation, and credit entitlement remain server-owned.

Supabase passkeys are experimental as of this implementation. The relying-party ID must be selected once and kept stable. Production should use the canonical ARGUS domain; previews need allowed origins under the same RP ID or a separate preview Auth project.

## Early-access credits and limits

- Every active tester receives an idempotent 10-credit starting grant when their growth account is first opened.
- Existing server-side daily investigation limits continue to constrain abuse during the first test phase.
- Credit deductions are not enforced until the reserve/finalize path is wired to scan lifecycle events and seeded accounts have been reviewed.
- The credit ledger is append-only. Adjustments and refunds are new rows, never balance rewrites.

## Feedback to Claude

A persistent hover button is available to authenticated users. A submission records:

- exact route and optional report version;
- viewport and document title;
- user-selected priority;
- immutable submitter and workspace;
- Claude assignment and lifecycle status.

Owners manage the queue as To do, Planned, In progress, Done, or Won't do. “Assigned to Claude” is task routing, not permission for autonomous production changes.

## Referrals

### Access leaderboard

Every active member gets a referral code. Attribution occurs once, after the referred user has authenticated and received workspace access. Qualified referrals:

- add two ARGUS credits to the referrer;
- increase the referrer's leaderboard position;
- cannot be self-referrals;
- cannot be reassigned after first attribution.

### Subscription revenue share

Proposed default: a referrer earns 20% of collected subscription revenue from a referred customer. Of that commission:

- 25% is issued as ARGUS credits;
- 75% is tracked as cash.

Cash payouts remain held until identity verification, tax forms, sanctions checks, minimum payout thresholds, refund/chargeback reversals, and jurisdiction rules are implemented. The database records immutable commission rows by source invoice so webhook retries cannot pay twice.

## Security properties

- Authorization never reads editable user metadata.
- Product tables are RLS-enabled and not directly granted to anon or authenticated roles.
- Browser clients use authenticated ARGUS APIs; service credentials remain server-only.
- Starting grants, referral claims, and future invoice commissions use idempotency keys.
- Public leaderboard rows expose referral codes and counts, never email addresses.
- Feedback updates require owner access.

## Activation checklist

1. Enable Supabase Auth Passkeys.
2. Set RP display name to ARGUS.
3. Set the stable RP ID to the canonical production domain.
4. Add production and explicitly approved preview origins.
5. Apply the growth-foundation database migration.
6. Deploy the preview and complete passkey create/sign-in/recovery tests.
7. Confirm early-access grant and referral attribution idempotency.
8. Select billing provider and create live/test products.
9. Add checkout, verified webhook fulfillment, refunds, and commission reversals.
10. Complete legal review for affiliate cash payouts before activation.
