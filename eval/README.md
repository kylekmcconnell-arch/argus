# ARGUS eval recordings

`npm run eval:record -- @handle` runs ONE paid live audit with every provider
response frozen to `recordings/<slug>/calls.jsonl` (request headers are never
stored; sensitive query params are redacted). `npm run eval:replay -- @handle`
re-runs the identical pipeline offline against the frozen traffic and asserts
`expectations.json`, so model swaps, prompt changes, and discovery re-routes
are measured for free.

Recordings contain fetched page text and provider responses. They are
gitignored by default; commit a recording only after checking it for anything
sensitive.

## What a recording can and cannot outlive

Provider calls are matched on the URL, so a recording keeps replaying them
across code changes. Analyst calls are matched on the request body, and the
request body is the evidence packet, so ANY change to what ARGUS collects or
how it words a check invalidates every recorded model response at once.

`uniswap` is in that state as of 2026-08-01: 167 provider calls still match
exactly and 22 more match on the URL tier, while the analyst calls miss and the
run therefore ends INCOMPLETE. It is still useful for exercising collection and
the deterministic scoring paths offline. It cannot currently gate a verdict,
and restoring that costs one paid re-record.

Two things were trimmed from it by hand, both safe and both verified to drop no
unique match key. The 9 MB JavaScript bundle body was cut to the first 256 KB,
which is all a capped read now sees anyway, and five rows that duplicated an
existing exact-match key were removed. Do not hand-edit a recording without
checking the key set before and after.
