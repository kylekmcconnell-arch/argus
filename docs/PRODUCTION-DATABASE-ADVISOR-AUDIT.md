# Production database advisor audit

Audited: 2026-08-23

Supabase project: `mpjpmgdklxpzggypmpwn`

GitHub issue: [#182](https://github.com/kylekmcconnell-arch/argus/issues/182)

This audit separates actionable database findings from recommendations that do
not justify a production change yet. It records the decision without treating
the dashboard as a source editor. The migration and executable contract in the
repository remain the reviewable source of truth.

## Security advisor

The advisor reported nine RLS-enabled tables without policies:

- `auth_request_limits`
- `credit_ledger`
- `entity_facts`
- `feedback_items`
- `provider_cache`
- `referral_attributions`
- `referral_commissions`
- `referral_profiles`
- `waitlist_signups`

All nine were already service-only at audit time: `service_role` had table
privileges while `anon` and `authenticated` had none. They were not exposed to
browser clients. The remediation preserves that boundary and adds explicit
false policies for both browser roles as defense in depth. It does not grant a
new privilege or expose a row.

## Foreign-key indexes

The performance advisor identified eleven foreign keys without a leading
index. Production statistics had been collecting since 2026-06-30. The audited
tables showed real activity, including 8,021 writes and 8,181 index scans on
`usage_events`, 57,105 index scans on `report_versions`, and 3,988 index scans
on `audit_log`. The migration adds one narrow index for each reported key.

These indexes support referential actions and direct actor/creator lookups. No
existing index is removed.

## Findings deliberately not changed

- **Unused indexes:** zero scans alone are not enough evidence for deletion.
  An index may protect an infrequent production path or have had no opportunity
  to run within the current statistics window. Keep them until a representative
  workload and query plan prove removal safe.
- **Auth database connections:** the advisor reports an absolute maximum of ten
  Auth connections. This is a capacity setting, not a current correctness or
  security failure. Change it to a percentage only alongside an observed pool
  constraint or planned database-size increase.
- **Production deployment:** this repository change does not apply the migration.
  Deployment requires explicit owner approval through the protected database
  workflow.
