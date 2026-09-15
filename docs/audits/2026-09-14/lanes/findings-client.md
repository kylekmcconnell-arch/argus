# Client lane findings (run state machine, persistence queue, report presentation)

Checkout: /Users/kyle/Documents/ARGUS/.claude/worktrees/review-main @ 042a271. All line refs are on this checkout.
Probe tests were written as `*.probe-client.test.ts(x)`, run with `npx vitest run`, and deleted afterwards (5/5 passed; results quoted per finding). No other file was touched.

Severity legend: P1 = wrong conclusion / spend / security, P2 = functional defect, P3 = hygiene.

---

## F-C1 (P1, confidence high, repro confirmed) — A Grok-guessed website is laundered into "the project site": its team names become founders and "claims the project made", and paid team discovery runs against it

**Files**
- src/lib/investigation.ts:323-331 (knowledge fallback), :328 (`siteUrl = id.website`), :356 (`runRecon(siteUrl)`), :460-463 (`deriveFounders`, `founderNote`, `onDone` payload)
- src/components/InvestigationReport.tsx:1127-1133 (founders -> `publishedTeamClaims` with source "project-attributed role"), :1945 (`<project> names X as Founder. The project made these claims`), :970 (`projectDomain` derived from `siteUrl`, used to filter Monid basic facts)
- src/App.tsx:798 (`fetchReconWebTeam(inv.siteUrl, ...)` paid supplement keyed to the persisted version)
- api/token-identity.ts:42-45,114 (server returns Grok's `website` with no binding to the contract; confidence may be "low")

**Mechanism.** When DexScreener/CoinGecko give no site or no X handle, `streamInvestigation` asks `/api/token-identity` (Grok knowledge) and, if a `website` comes back, assigns it straight to `siteUrl` (line 328). The step log says "Suggested ... bindings still require verification", but the code then treats the URL exactly like an official DexScreener-linked site: it renders it with `runRecon`, promotes `recon.team.names` and X links on that page into `founders` with `source: "site"`, writes `founderNote = "Named on the project site: ..."`, and emits an `Investigation` that carries no marker that the site was model-suggested. The report renders those people as "<Project> names Alice as Founder. The project made these claims", `projectDomain` (line 970) is derived from the same URL and used to decide which Monid basic facts are retained, and after persistence App spends the `panelCostToken` on `/api/recon-team` for that domain. The X-handle side of the same fallback IS gated (binding check at :385-411, mismatch -> audit skipped), but the website side has no equivalent gate.

**Failure scenario.** Token `$MEME` at 0x9999... has no socials. Grok answers with the namesake project's site (a different project with the same name, or a squatter). Recon of that site names "Alice Namesake, Bob Namesake". The saved immutable investigation states the token's team is Alice and Bob "named on the project site", the report says the project itself made those claims, and the workspace pays for a deep-team search of the wrong company. This violates the bounded-attribution invariant (a namesake cannot lend identity to the subject).

**Repro (passed).** Mocked `auditToken` -> token with `socials: []`; `/api/token-identity` -> `{ website: "https://namesake-project.example", confidence: "low" }`; `runRecon` -> team named. Result: `inv.siteUrl === "https://namesake-project.example"`, `inv.founders` = Alice/Bob/@alice_namesake all with `source: "site"`, `founderNote` starts "Named on the project site: Alice Namesake, Bob Namesake", and `JSON.stringify(inv)` contains no "model|lead|unverified|suggested" marker.

**Fix.** Record provenance on the investigation (e.g. `siteUrlOrigin: "token-sources" | "model_lead"`), and for a model-suggested site: (a) require a binding before it can be "the project site" (site content publishes the exact contract, or the verified project X bio links the domain; recon already extracts `tokenSignals`/socials so an on-site CA match is cheap), (b) until bound, keep `recon` as a lead only: no `founders` from it, `founderNote` must say "a model-suggested site (unverified)", `publishedTeamClaims` must not include them, and (c) do not spend `fetchReconWebTeam` on an unbound domain (App.tsx:798 should check the origin flag).

---

## F-C2 (P2, confidence high, repro confirmed) — AuthGate unmounts the entire App on every Supabase access-token refresh (~hourly), silently destroying the current view, the session result cache, and unsaved Case Brief drafts

**Files**
- src/auth.tsx:238-249 (`onAuthStateChange` -> `shouldRevalidateSession` -> `validate`), :199-209 (`validate` starts with `setProfile(null)` + `setLoading(true)`), :349 (`if (loading)` renders GateShell), :372 (children only render when `value` is non-null)
- src/lib/authenticatedFetch.ts:7-14 (`shouldRevalidateSession` returns true whenever the token string changes)
- src/App.tsx:471 (`resultCache` is a `useRef` inside App), :447-456 (Case Brief dirty guard lives in App refs)

**Mechanism.** The Supabase client is created with `autoRefreshToken: true`. Every refresh emits `TOKEN_REFRESHED` with a *new* `access_token`, so `shouldRevalidateSession(next, validated, pending)` is true, and `validate()` runs. `validate` synchronously does `setProfile(null)`, which makes `value` null, and `setLoading(true)`, so `AuthGate` renders the "Verifying secure access..." shell and unmounts `{children}` (the whole `<App/>`). When `/api/session` answers, a brand-new `App` mounts with `initialFromUrl()` state. The comment on `shouldRevalidateSession` only anticipates the repeated-`SIGNED_IN` case (same token); the refreshed-token case was not considered. Module-scoped runners survive, but `resultCache`, `privRef`, `personRunBaseline`, the current phase/report, and the CaseBriefPanel (with its `beforeunload` protection, which does not fire for a React unmount) do not.

**Failure scenario.** Analyst opens ARGUS, runs a 2-minute audit, reads the report and starts typing a Case Brief. ~55-60 min after sign-in the token refreshes: the page flashes to "Verifying secure access...", then lands on Home. The brief draft is gone with no confirm dialog (the App-level `window.confirm` guard is bypassed because nothing called `closeCaseBriefForNavigation`). A just-finished scan whose save `failed` (kept only in `resultCache` with its real score, per App.tsx:936-950) is no longer reachable. If `/api/session` is slow or errors, the analyst is shown "Access not provisioned" mid-session.

**Repro (passed).** Rendered `<AuthGate><AppProbe/></AuthGate>` with a mocked Supabase client: after `SIGNED_IN(token-A)` + `/api/session` 200, `APP-MOUNTED` is rendered (mounts=1). After `TOKEN_REFRESHED(token-B)` the container shows "Verifying secure access" and not `APP-MOUNTED` (unmounts=1); after the second `/api/session` resolves, mounts=2 (a fresh App instance).

**Fix.** Keep children mounted during re-validation: do not `setProfile(null)`/`setLoading(true)` when a profile is already loaded and the session user id is unchanged; re-validate in the background and only tear down on a real sign-out or a 401/403 from `/api/session`. Alternatively short-circuit `shouldRevalidateSession` for `TOKEN_REFRESHED` events whose `session.user.id` equals the validated one (the token is already installed in `currentAccessToken` at line 241).

---

## F-C3 (P2, confidence high) — After an SSE drop the client declares "This scan produced no new report, and nothing was saved" within ~6 s while the server keeps running and persists; "Run the scan again" then starts a second paid audit

**Files**
- src/App.tsx:1127-1174 (`onLiveError`: 4 polls x 1.5 s), :1172 (`rescan-failed`), :1991 (copy "nothing was saved for this subject"), :2030/2051 ("Run the scan again" -> `onAudit` -> new `startPersonAudit`)
- src/lib/live.ts:78 (inactivity watchdog 90 s -> `onError`), :127 ("stream closed before finishing")
- src/lib/runner.ts:225-230 (`onError` marks the run `error` and drops it; a later `startPersonAudit` creates a new run)
- api/audit.ts:314 ("The investigation continues and persists even if the client disconnects.")

**Mechanism.** A person audit can run up to `DEEP_INVESTIGATION_MAX_DURATION_SECONDS = 600`. If the SSE connection dies (proxy idle cut, tab throttling, network blip) the client gets `onError` (immediately on close, or after 90 s of silence), then `onLiveError` polls `fetchReport` four times over ~6 s looking for a version newer than the baseline. The server explicitly keeps collecting and persists on its own schedule (api/audit.ts:314), typically minutes later. After 6 s the client asserts a negative it cannot know ("produced no new report ... nothing was saved"), sets `caseNotice.reason = "rescan-failed"`, and the primary button re-runs `onAudit`, which starts a *new* run because the old one is `status: "error"`. There is no server-side dedupe visible from this lane for a second concurrent audit of the same handle.

**Failure scenario.** Stream drops at t=40 s of a 4-minute audit. At t~46 s the analyst is told nothing was saved and clicks "Run the scan again": two full paid collections now run; at t~4 min the first lands as version N+1 and at t~8 min the second lands as N+2 (with a fresh case-family/log row). The recents rail and Dossiers show two runs the analyst believes were one failed + one good.

**Fix.** Treat a stream drop as "in progress, disconnected": keep polling (with backoff) for the length of the server budget or until a newer version appears, show "the connection dropped; the server is still collecting - this page will update", and make the retry button re-attach/poll rather than re-launch until the server run is known to be dead. At minimum change the copy to "ARGUS could not confirm a saved result yet" and disable relaunch for a cooldown equal to the remaining server budget.

---

## F-C4 (P2, confidence high, repro confirmed) — A running scan cannot be re-attached from most entry points because run keys and click refs use different identity forms; the click silently falls through to the previous stored report

**Files**
- src/lib/scanrunner.ts:58 (`getScanRun` keys by `norm(ref)`), :77-79 / :138-140 (run keyed by `tokenSubjectIdentity(input.chain, input.ref)?.ref ?? norm(input.ref)`)
- src/App.tsx:1255-1259 (`onOpenRecent` looks up `getScanRun("investigation"|"token", ref)` with whatever ref the caller passed), :1268-1305 (falls through to `lookup.report` and `showCached` of the stored version)
- src/App.tsx:828 / :860 (`logAudit` writes `ref: inv.token.address` / `d.address` - bare), src/lib/reports.ts:293 (server rows store chain-qualified `ref`), src/components/Sidebar.tsx:542 (recents pass `e.ref ?? e.query`)
- src/App.tsx:579-596 (`onInvestigationRescan` starts the rescan from the chain-qualified ref)

**Mechanism.** Three ref forms coexist: bare address (audit-log rows, `Report`/`TokenReport` rescans via `onAudit(bare)`), `chain:address` (durable case subjects, `InvestigationReport` rescan input, Dossiers), and the raw DexScreener URL (`norm(href)` when pasted). `getScanRun` matches only an exact normalized string. `onOpenRecent` therefore finds a running scan only when the caller happens to use the same form the run was started with. When it misses, the code proceeds as if no collector were running and renders the stored (older) report as the case, with no notice that a rescan is in flight.

**Failure scenario (repro passed).** Analyst hits "Rescan" on an investigation report (run key `investigation:public:ethereum:0x...aa`), navigates to Radar, then clicks the case in Recent cases (ref `0x...aa`). `getScanRun("investigation","0x...aa")` is `undefined`; `fetchReportState` returns the previous version; the analyst is shown the old score as the current case while the paid rescan continues invisibly. Same for a scan started from a DexScreener URL (run.ref `dexscreener.com/solana/<pair>`) clicked later by its canonical `solana:<mint>` ref.

**Fix.** Make `getScanRun` and the run key both go through one canonicalizer that (a) tries `tokenSubjectIdentity` on `chain:address`, (b) falls back to matching the bare address against the address component of every running key, and (c) for DexScreener-URL inputs re-keys the run once `auditToken` resolves the canonical (chain, address) (the runner already knows it on completion). `onOpenRecent` should also scan `activeScanRuns()` by subject before trusting the durable report.

---

## F-C5 (P3, confidence high) — Startup reconciliation of the recents rail never matches token/investigation rows (chain-qualified vs bare refs), so the stale-chip bug it was written to fix persists for every token case

**Files**
- src/lib/auditlog.ts:329-350 (`hydrateSharedLog` calls `reconcileAuditOutcome(report.ref, kind, ...)` with the server list's `ref`), :266 / :281 (`norm` strips only `@`/`$`, matches `norm(e.ref ?? e.query) === target`)
- src/lib/reports.ts:293 (`syncReport` sends `ref = payloadTokenIdentity(...).ref` = `chain:address`); api/report.ts:85,1014 (`normRef = normalizeSubjectRef` keeps the `chain:` prefix; list returns the stored `ref`)
- src/App.tsx:828 / :860 (`logAudit` rows use bare `inv.token.address` / `d.address`)

**Mechanism.** For tokens/investigations the server list row has `ref: "ethereum:0xabc..."` while the local/shared audit-log rows have `ref: "0xabc..."`. `norm()` does not strip the chain, so `rows.findIndex(...)` never matches and `reconcileAuditOutcome` is a no-op for every token case. The person path works because both sides use the handle.

**Failure scenario.** A token rescan completes but its version does not become the active projection (e.g. lower completeness); the local row keeps the rescan's verdict/score forever; the rail chip shows "72 - checks open" while opening the case shows the active "85 - complete" - the exact mismatch the comment at :251-259 describes.

**Fix.** Normalize both sides with `normalizeSubjectRef` and compare on the address component when either side is chain-qualified (or write chain-qualified refs into `logAudit` and migrate `norm` to `normalizeSubjectRef` + address-suffix match).

---

## F-C6 (P3, confidence high, repro confirmed; overlaps #379 cost accounting) — A refused credit reservation is receipted as `collection_failed` with `creditsCharged: 1`

**Files**
- src/lib/scanrunner.ts:92 / :157 (`reserveInvestigationCredit` inside the same `try` as collection), :117-126 / :185-193 (catch -> `failureCode: "collection_failed"`)
- src/lib/scanReceipts.ts:33 (`creditsCharged: 1` hardcoded on every receipt); api/scan-receipt.ts:40 (server also hardcodes 1)
- src/lib/investigationCredits.ts:17-25 (429 -> "no credits left ... no credit was taken")

**Mechanism.** The reservation POST and the provider pipeline share one catch. When the reservation itself is rejected (429 exhausted, 5xx), the client writes a receipt that says the run failed *during collection* and that one credit was charged - both false (no providers were started, the server said no credit was taken). Repro: reservation rejected -> `finishScanReceipt` called with `{status:"failed", failureCode:"collection_failed"}`.

**Fix.** Give the reservation its own catch that emits `failureCode: "credit_reservation_failed"` (or no receipt at all, since nothing was reserved), and make `creditsCharged` come from the reservation response (`chargedCredits`) rather than a literal.

---

## F-C7 (P3, confidence high) — Token threat leg: the 120 s race then launches a second, unbounded threat scan while the first is still running; `cancelRun` never aborts the threat leg

**Files**
- src/lib/runner.ts:148-151 (`Promise.race([threatLeg, 120 s])`), :164-183 (`if (!scan)` retry with `{ force: true }`, no timeout), :243-249 (`cancelRun` aborts only the SSE), :106-124 (`threatLeg` has no AbortController)

**Mechanism.** The race resolves `null` both when the leg *failed/empty* and when it is merely *slow*. The retry does not check `threatSettled`, so a slow first scan and the forced second scan run concurrently against the same token (both call the server-backed threat endpoints and `/api/x`), and the retry has no wall clock at all, so "never block a finished person audit indefinitely" is not actually guaranteed. `cancelRun` deletes the run but the threat leg keeps spending and calling `pushStep` on a detached run.

**Fix.** Pass an `AbortSignal` into `threatScan` and abort it on both the 120 s timeout and `cancelRun`; only retry when `threatSettled && !scan`; bound the retry with the same race.

---

## F-C8 (P3, confidence high) — Unbounded fetches inside the run state machine can leave a scan "running" forever and block any new scan of that subject

**Files**
- src/lib/investigationCredits.ts:14 (`fetch("/api/investigation-credit")` with no `signal`), src/lib/scanrunner.ts:92/:157 (awaited before any deadline applies; `startTokenScan`/`startInvestigationScan` return the existing run while `status === "running"`)
- src/lib/investigation.ts:181 (`fetch("/api/deployer-origin...")` with no timeout; `streamInvestigation` has no inactivity watchdog, unlike `streamAudit`)

**Mechanism.** A stalled reservation request (serverless cold start hang, proxy) never rejects; the run stays `running` with 0 steps, the sidebar shows "scanning..." indefinitely, and every subsequent attempt to scan that ref returns the same stuck run (idempotent-by-key). The only recovery is `cancelScanRun`, which writes a "cancelled" receipt. Same for the deployer-origin call mid-investigation.

**Fix.** `AbortSignal.timeout(15_000)` on the reservation, `AbortSignal.timeout(30_000)` (or the token controller's signal) on `/api/deployer-origin`, and a `deadlineAt` check in the runner that flips a run to `error` if it has produced no step for N seconds.

---

## F-C9 (P3, confidence medium) — `onOpenRecent` evicts a just-persisted in-session result when the server projection lags

**Files**
- src/App.tsx:1235-1244 (`lookup.status === "open" && !lookup.report` -> only `pending`/`failed` session results survive; otherwise `clearCachedRef` and "immutable projection is temporarily unavailable")

**Mechanism.** After `syncReport` succeeds the session cache holds `persistence.state === "persisted"` with the real payload. If `/api/report?ref=` returns the case as open but with no active report yet (activation is a separate RPC per api/audit.ts:190-192; eventual consistency), the fresh persisted result is deleted from `resultCache` and the analyst is dead-ended, even though the client holds the exact payload and version id it just received.

**Fix.** Treat `persisted` like `pending` in that branch (show the cached result with its receipt) instead of clearing it.

---

## F-C10 (P3, confidence medium) — Shared watchlist hydration merges unvalidated rows; a row without `snapshot` crashes the Watchlist page

**Files**
- src/lib/watchlist.ts:81 (only `w && w.id` is checked before `save(merged)`), src/components/WatchlistPage.tsx:15-20 / :202 (`presentationFor(baseline)` reads `snapshot.verdict`)

**Mechanism.** Any analyst's older client (or a malformed `/api/report?watches=1` row) that lacks `snapshot`/`kind` is persisted into every browser's localStorage on hydrate; rendering throws and the page falls to the error boundary until the row is removed by hand. Related to #381 but a distinct crash path.

**Fix.** Validate `kind`, `label`, and `snapshot.verdict` in `hydrateSharedWatchlist` (mirror `parseStoredCaseSubjects`) and drop malformed rows.

---

## Looked suspicious, verified OK (do not re-check)

- **XSS via evidence hrefs.** No `dangerouslySetInnerHTML`/`innerHTML` anywhere in `src`. Most links go through `safeSourceLink` (Report.tsx:907), `safeHttpUrl` (BasicFactsPanel.tsx:143), `normalizedPublicUrl` (InvestigationReport.tsx:144), `safeUrl` (ArgusEyeAssistant.tsx:160), `safeHref` (reportExport.ts:41). The few raw bindings (Report.tsx:4522 `link_evidence_url`, :4781 `evidence_url`; TokenReport.tsx:722 `socials[].url`; InvestigationReport.tsx:699, 2354, 2388) are covered by React 19.2's built-in `javascript:` URL block (present in node_modules/react-dom/cjs/react-dom-client.production.js: "React has blocked a javascript: URL as a security precaution"). `data:` top-level navigations are browser-blocked. The `.doc` export escapes every value and only links through `safeHref`.
- **URL params.** `?s`, `?t`, `?inv`, `?site`, `?live`, `?version` are only ever placed in `URLSearchParams`; `?live` and `?s` are read-only opens; `?t`/`?inv` pass `allowLaunch=false` (the ticker chooser's buttons are explicit analyst actions). `?threat` is dropped from the URL on every non-threat phase.
- **JSON.parse.** All localStorage parses are inside try/catch (auditlog.ts:76-84, watchlist.ts:31-37, graph/store.ts:31-38); a malformed SSE frame in live.ts:120 throws into the catch that settles the stream with `onError`, so it cannot hang.
- **StrictMode / double effects.** Runs are module-scoped and idempotent per key (runner.ts:73, scanrunner.ts:80/141); URL boot is guarded by `urlBootStartedRef`; the `?version` effect has a cancel flag.
- **Run-id guards on late setState.** `tokenData`/`investigationData`/`logPerson` gate every cache/state write on `scanId` via `settleCachedScan` and `persistence.scanId` comparisons; `InvestigationRun` honours `expectedRunId`; `onAudit`/`onOpenRecent`/`onSafeAuditMode` all check `safeAuditRequestRef` after every await.
- **Persistence queue.** `enqueueReportPersistence` serializes per subject; `syncReport` retries reuse one `clientRunId`; a failed save yields `persistence.state = "failed"` and the reports render "pending"/"failed" from that single object, with `versionContext` (server truth) taking precedence - badges cannot disagree.
- **Private/public run collision.** Person runs are keyed by handle only (runner.ts:73) but every launch path checks `run.priv !== priv` and shows the privacy-conflict notice.
- **Auth-before-session race at boot.** `App` mounts only after `/api/session` validates and `currentAccessToken` is installed (auth.tsx:241), so boot fetches carry the bearer; the 401 path refreshes once. The only auth defect is the refresh remount (F-C2).
- **"Positive from missing data".** Hero chips require `checked-empty` for "Sanctions clear"/"No official token"; `personChecks` records an empty associates list as unknown ("an empty dossier is not a confirmed clean result"); `tokenChecks` keeps unavailable/unknown/checked-empty distinct; `presentPublicReport` withholds PASS on partial coverage.
- **Known issues touched, not re-reported.** `scoreMatchesVerdict` band gaps (#323); `tokenReportText` printing the numeric score even when policy withholds it (#318); `tokenFromPromotions` attaching a merely-promoted token's threat leg (#371); shared watchlist being localStorage-first (#381). None appear fixed on this checkout.
