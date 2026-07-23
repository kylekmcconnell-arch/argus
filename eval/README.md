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
