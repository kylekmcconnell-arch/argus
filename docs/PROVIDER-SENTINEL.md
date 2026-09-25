# Provider sentinel

`/api/health` only reports whether keys are *set*. The provider sentinel checks
whether they *work*. Every 15 minutes it makes the cheapest real
authenticated request to each configured provider, stores the result, and
emails the owner when something breaks, recovers, or runs low on credit.

- Cron: `GET /api/provider-sentinel` (in `vercel.json`, every 15 min, guarded by `CRON_SECRET`).
- Manual run: owner `POST /api/provider-sentinel` (`?costly=1` also runs the paid probes).
- Status read: owner `GET /api/provider-status` (current state, 24h history, last run).
- Dashboard: sidebar **Admin → API status** (or `/?apis`), owner only.
- Code: `server/sentinel/` (`probes.ts`, `classify.ts`, `alerts.ts`, `store.ts`, `run.ts`).

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CRON_SECRET` | yes (already set for threat-recheck) | – | Authenticates the Vercel cron call. |
| `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (or service-role key) | yes (already set) | – | Stores status, history and the alert log. |
| `SENTINEL_ALERT_EMAILS` | for email | – | Comma-separated recipients. |
| `RESEND_API_KEY` | for email (already used elsewhere) | – | Sends alerts. Without it, alerts are logged and recorded as undelivered; the dashboard still works. |
| `RESEND_FROM` | no | `ARGUS <onboarding@resend.dev>` | Sender on a verified Resend domain. |
| `ARGUS_APP_ORIGIN` | no | – | Adds a dashboard link to alert emails. |
| `SENTINEL_LOW_USD` | no | `20` | Low-credit alert when a USD balance/remaining limit is below this. |
| `SENTINEL_LOW_QUOTA_PCT` | no | `10` | Low-credit alert when remaining quota is below this % of the limit. |
| `SENTINEL_COSTLY_INTERVAL_HOURS` | no | `6` | How often the paid probes run. |
| `SENTINEL_DISABLED_PROBES` | no | – | Comma-separated probe ids to skip entirely (e.g. `arkham,x-api`). |

The provider keys themselves are the ones the app already reads (`XAI_API_KEY`,
`SERPER_API_KEY`, ...). A provider without its key is shown as *not configured*
and never alerts.

## Applying the migration

`supabase/migrations/20260925180000_provider_sentinel.sql` creates
`provider_status`, `provider_checks` (pruned after 30 days), `provider_alerts`
(pruned after 90 days) and `provider_sentinel_runs` (pruned after 30 days). All
four have RLS enabled with no policies and are revoked from `anon` and
`authenticated`; only the service role reads or writes them.

Apply it through the normal migration workflow (for example `supabase db push`
against project `mpjpmgdklxpzggypmpwn`, or the Supabase migration pipeline).
Until it is applied, `/api/provider-status` answers 503
`sentinel_tables_unavailable` and the cron run still probes but stores nothing
and sends no alerts (alerts need the previous state to detect transitions).

## Statuses and alerts

Each check is `ok | degraded | down | not_configured`, with a machine reason
(`missing_key, auth_invalid, out_of_credits, rate_limited, timeout,
provider_error_5xx, unexpected_response`), a short sanitized detail (HTTP status
+ provider message, never the key), latency, and any balance/quota. A separate
`low_credit` flag is raised when a balance or quota crosses the thresholds.

Alerts fire on transitions only: healthy → down/degraded, degraded → down,
down/degraded → ok (recovered), and low-credit newly raised. The same
provider+kind is emailed at most once per 6 hours. All alerts from one run go
in a single email, e.g. `[Argus] 2 APIs down, 1 low on credit`.

## Probes and cost

Probe timeout is 8s; all probes run in parallel.

| Probe | Endpoint | Cost per check |
| --- | --- | --- |
| xai | `GET api.x.ai/v1/api-key` | Free (key introspection; also flags blocked team/key) |
| anthropic (optional) | `GET api.anthropic.com/v1/models?limit=1` | Free. Cannot see credit balance. |
| twitterapi | `GET api.twitterapi.io/oapi/my/info` | Free; reports credits (≈USD at 100k credits/USD) |
| serper | `GET google.serper.dev/account`, fallback `POST /search` (num=1) | **Costly (6h)**: free if the account endpoint answers, else 1 credit (~$0.001) |
| openrouter (optional) | `GET openrouter.ai/api/v1/key` | Free; remaining key limit in USD |
| helius | `POST mainnet.helius-rpc.com` `getHealth` | 1 Helius plan credit (~2.9k/month); no USD |
| etherscan | `GET api.etherscan.io/v2/api` account balance | Free (daily call allowance) |
| arkham | `GET api.arkm.com/intelligence/address/0x…dEaD` | **Costly (6h)**: one lookup against the API allowance |
| pdl | `GET api.peopledatalabs.com/v5/person/enrich` for a reserved `.invalid` email | Free (404; PDL bills only 200 matches) |
| github | `GET api.github.com/rate_limit` | Free (not counted) |
| coingecko | `GET pro-api.coingecko.com/api/v3/key` | Free; monthly call quota |
| cryptorank | `GET api.cryptorank.io/v2/currencies?symbol=BTC&limit=1` | **Costly (6h)**: 1 plan credit |
| gmgn | `GET openapi.gmgn.ai/v1/token/info` (wSOL) | **Costly (6h)**: one read; no published price |
| fomoscan | `GET api.fomoscan.sh/v2/me` | Free (0 CU); compute units left |
| monid | `GET api.monid.ai/v1/wallet/balance` | Free; USD wallet balance |
| supabase | `GET {SUPABASE_URL}/rest/v1/argus_members?limit=1` | Free |
| resend (optional) | `GET api.resend.com/domains` | Free (send-only keys count as valid) |
| companies-house (optional) | `GET …/search/companies?items_per_page=1` | Free |
| openalex (optional) | `GET api.openalex.org/works?per_page=1` | Free (daily allowance) |
| courtlistener (optional) | `GET …/api/rest/v4/courts/?page_size=1` | Free |
| opencorporates (optional) | `GET api.opencorporates.com/v0.4/account_status` | Free; calls left this month |
| safebrowsing (optional) | `POST safebrowsing.googleapis.com/v4/threatMatches:find` | Free |
| x-api (optional) | `GET api.x.com/2/users/by/username/XDevelopers` | **Costly (6h)**: one billed read on pay-per-use plans |

A costly probe that is failing is rechecked every run (not every 6h) so a
recovery is noticed quickly. `chart-signals` is not probed (custom service with
no standard health route).
