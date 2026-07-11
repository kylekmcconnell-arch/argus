# ARGUS P0 trust-foundation rollout

This release replaces shared-password access and mutable, client-attested
reports with verified workspace identities, role enforcement, immutable report
versions, evidence provenance, truthful check states, and capability-based
public sharing.

## What is enforced

- Supabase magic-link identity with confirmed-email checks.
- Server-owned `owner`, `analyst`, and `viewer` workspace roles.
- Tenant scoping on cases, reports, graph contributions, audit events, usage,
  evidence, and share links.
- Daily investigation limits plus weighted API budgets before paid work starts.
- Immutable report versions with idempotent run IDs and attestation state.
- Server-derived contributors, verdict projections, and evidence provenance.
- Public report cards backed by random capability links; URL parameters cannot
  forge a title, verdict, score, or report subject.
- Model-discovered claims remain leads until a provider artifact verifies them.
- Incomplete required axes produce an incomplete result, not a fabricated score.

## Safe rollout order

1. Confirm the intended Supabase project before linking or pushing anything.
2. Back up the production database.
3. Apply `supabase/migrations/20260710180507_argus_auth_case_foundation.sql`
   with the Supabase CLI. The migration is additive and retains the legacy
   unique indexes so the current production application can continue running
   during rollout.
4. Configure the following server variables in Preview first:

   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY` (preferred opaque `sb_secret_*` credential)
   - `ARGUS_OWNER_EMAILS` with the first approved owner email
   - `ARGUS_APP_ORIGIN` with the exact public Preview/Production origin
   - optionally `ARGUS_ANALYST_EMAILS` / `ARGUS_VIEWER_EMAILS` as emergency
     bootstrap fallbacks

5. Configure the public build variables:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP=true`

6. Deploy a Preview and have the first approved owner complete one magic-link
   sign-in. Verify that `/api/session` shows the `owner` role and intended workspace.
7. Open **Audit log → Workspace access**. Invite every additional owner, analyst,
   and viewer from inside ARGUS; verify the invitation email and assigned role.
8. Set `VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP=false`, rebuild the Preview, and verify
   that an unapproved email cannot create an account or access a workspace.
9. Exercise one person audit, one token audit, report reopen, graph read, audit-log
   read, and a capability share before promoting the same build to Production.
10. After the production smoke test, remove the legacy
   `SUPABASE_SERVICE_ROLE_KEY` if `SUPABASE_SECRET_KEY` is active.

## Required verification

Run locally before each promotion:

```sh
npm run typecheck
npm test
npx vite build
npx supabase db reset --local
npx supabase db lint --local --level warning
npm audit --omit=dev
```

Expected access checks:

- Anonymous requests to protected `/api/*` routes return `401`.
- Inactive or unprovisioned identities return `403`.
- Viewers can read but cannot run or mutate investigations.
- Analysts can investigate and write but cannot perform owner-only deletion or
  reclassification.
- Untrusted CORS preflights do not receive `Access-Control-Allow-Origin`.
- A report-card request without a valid share capability returns `400`/`404`.
- Replaying the same immutable run ID returns the original report version.

## Rollback

The migration is expand-only for this release. If the application rollout has a
problem, promote the previous application deployment and leave the new tables
and nullable tenant columns in place. Do not destructively roll the database
back while either application version may still be serving traffic.

## Next hardening tranche

- Split the current approximately 904 kB browser bundle by product area.
- Pay down the repository-wide historical ESLint backlog; P0-touched files pass
  scoped lint except the pre-existing explicit-`any` debt in the X adapter.
- Add calibrated golden-case regression sets for known-good, ambiguous, and scam
  founders/tokens, then track false-pass and false-avoid rates per methodology
  version.
- Add production observability for provider latency, unavailability, report
  persistence failures, quota denials, and evidence coverage drift.
- Remove the temporary legacy cross-tenant unique indexes after every deployed
  writer uses organization-scoped conflict keys.
