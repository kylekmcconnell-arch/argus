-- Stage cohort for the shipping read (api/shipping-cohort.ts) selects saved
-- token reports by chain and by the presence of a frozen development read:
--   kind = 'token' AND payload->>'chain' = $1 AND payload->'shipping' IS NOT NULL
-- Neither predicate had an index, so the query seq-scanned the reports table
-- for the organisation. A partial expression index on the chain, limited to
-- token rows that carry the read, keeps the cohort cheap as the table grows.
create index if not exists reports_token_chain_shipping_idx
  on public.reports (organization_id, (payload->>'chain'))
  where kind = 'token' and payload ? 'shipping';
