# Session handoff, 2026-09-23: what shipped, what is open, what Astra should cross-check

Written 2026-09-24 for Astra. Everything here landed on `main` on 2026-09-23 unless marked otherwise. Commit hashes are the squash commits on `main`.

## 1. Shipped to main

### Scanner logic

| PR | Commit | What changed | Files | Cross-check |
|---|---|---|---|---|
| #515 | `8687e38` | **Venue resolver + creator-fee conduct tracer.** Tokens resolve to their launchpad from fingerprints (LONG `…1e18`, Bankr `…ba3`, Pons v1/v2, Doppler, StonkBrokers, o1). "Paid in" (token / quote / mixed) is a *note only*, never a demerit. A warning fires only when the creator is observed claiming and selling the token leg with no buyback or burn. Robinhood tracer reads the claimer's own feed and classifies conduct hold / buyback / buyback-burn / dump. | `src/threat/launch.ts`, `api/launch.ts`, `src/threat/scan.ts`, `src/threat/types.ts`, `src/components/ThreatScanPage.tsx` (one "Paid in" row, claim counts on the Creator fees row; no styling) | Scan $MEME `0x385F…1e18` (robinhood): expect venue **long**, paid in *token and USDG*, conduct **dump**, 26 claims. Scan $MOTION `0xB0Fe…17e2`: expect **hold**. |
| #516 | `49f7b0f` | **Volume-to-liquidity guard.** `washSignatureFor()` in `src/token/audit.ts`: volume with no pool (< $1K liq, ≥ $10K vol) → fake-volume; ratio ≥ 100 with ≥ 20 txns → cycled-volume; ratio ≥ 15, flat price, ≥ 50 txns → wash-trade. Every printed volume figure carries its ratio. | `src/token/audit.ts`, `src/threat/scan.ts`, `src/lib/verdictNarrative.ts`, `src/token/washSignature.test.ts` | Trading-activity rationale must read "24h vol/liquidity 38.5x …" style, never "136x times". A zero-liquidity pool must no longer read as clean. |
| #517 | `0bdbdfb` | **o1 on Base across all five suites.** `o1BaseAnnouncementVenue` probes every Base announcement registry from o1's machine-readable suite list, current first, token pinned to `topic1` (`CreatorRegistered(address indexed token, address indexed creator)`). 10 calls worst case → 5. | `api/launch.ts`, `api/launch.o1base.test.ts` | Scan $SPIKE `0xb200…e4d01` (base): Launch panel must say venue **o1**, bonded to ETH, paid in the quote asset. Needs a Base-capable Etherscan key (see §3). |
| #518 | `a6106d4` | **Base B20 assets read as a system standard.** A B20 token holds a 1-byte `0xef` marker; there is no per-token source to verify. `api/bytecode` answers `system:"b20"` with **no fingerprint** (a shared hash would make every B20 asset a clone of every other). `scan.ts` folds it into `CodeReview.system`; no "UNVERIFIED contract" demerit; a positive states the power surface is the authority reads. | `api/bytecode.ts`, `src/threat/deepsources.ts`, `src/threat/scan.ts`, `src/threat/types.ts`, `src/components/ThreatScanPage.tsx` (one copy paragraph), `src/lib/reportExport.ts` | Re-scan $SPIKE: "The code, read" header must say **B20 system asset - no per-token code**, no UNVERIFIED warning. Not touched: T2 "Contract safety" in `audit.ts` still reads GoPlus `is_open_source`. |
| #505 | `acf6dae` | Self-referential GoPlus LP list (the token as its own LP holder) reads as unmeasured, not unlocked. | `src/token/audit.ts` | — |
| #503 | `9dadc10` | Flaky projectToken namesake test no longer resolves binance.com through the SSRF guard. | `server/adapters/projectToken.test.ts` | — |

### Registry, research, docs

| PR | Commit | What |
|---|---|---|
| #510 | `0b83379` | `rh-machi-taiwan` and `rh-meme-amc` name **LONG** (LongLauncher `0x22e99278…` over Doppler Airlock `0xeb7c0347…`) as venue. New nefarious cluster `rh-volume-ring-2026-09-22`: 31 tokens, 3 bytecode templates, 100–5,000× volume/liquidity, hubs `0x361bcf4b…`, `0xc96aa6ad…`. Fingerprint table and fee-model rule in `src/threat/RESEARCH.md`. |
| #501 | `b59a9bf` | Machi correction: creator income 5,886,504 TAIWAN on 09-19; full exit 09-23 (`0x3bbdc03e…`). |
| #500 | `d4aa9f7` | $AILE research note. |
| #511 | `1b8569e` | Eight-platform launchpad study under `docs/launchpads/` with `data/{pools,attribution,native_tokens}.json`. |
| #514 | `195dbb7` | `docs/handoffs/2026-09-23-launchpad-study.md`. |

Older PRs merged in the same cleanup pass, not authored that day: #504, #477, #410, #509. Left open with a comment: #412.

### CI

| PR | Commit | What |
|---|---|---|
| #519 | `d0a5968` | `database` job: ghcr.io login with `GITHUB_TOKEN`, docker `max-concurrent-downloads: 2`, six-attempt exponential backoff, 25-minute budget. |
| #522 | `deed4fa` | `SUPABASE_INTERNAL_IMAGE_REGISTRY=public.ecr.aws` on the job. |
| #524 | `15617ab` | Pre-stage all thirteen pinned Supabase images from ECR Public with backoff and tag them under the ghcr names, so the pinned CLI (2.109.1, which ignored the override in some runs and hard-codes `pg_prove`) finds them locally. Image list is in the workflow; bump it when `supabase/setup-cli` is bumped. |

Cause: ghcr.io returned `toomanyrequests: allowed 44000/minute` on nine consecutive runs, a burst limit on parallel layer pulls that authentication alone did not clear.

## 2. Analyses delivered (no code)

- **$SPIKE** `0xb20000000000000000000070F6c1A66D7C1e4d01` (Base). Launched 2026-08-13 on o1's historical "timestamp v2" suite (factory `0xa52ad458…`), dormant 41 days, then bot-opened 2026-09-23 12:03 UTC: eight wallets, 0.04 ETH each, one private router `0xC7827556…`, consecutive block positions; the wallets hold 3.5–11.2 ETH each. Narrative account @SPIKE_ONBASE joined September 2026 and posted 25 minutes *after* the first buy. Creator `0x7B9Dc249…` never claimed: **9.80 ETH** sits in o1 FeeEscrow `0xa2cBD906…`. Holders flat (largest 2.3%).
- **$CATALYST** `0xcA7A1E31b36779cf32acb18714Ab26982CF36B05` (Base). Created 2026-09-23 08:26 UTC on an unnamed, unverified suite (factory `0x4d958575…`, seeder `0xFD2823Fb…`, hook `0x0d5D83c5…`, fee escrow `0x78740784…`, registry `0x98C9C7e4…`; every token minted has the `0xca7a` prefix). One EOA `0xe45AB753…` launched all six markets; deployer and funders share one payout contract `0x4b5c7108…`. Not bundled, no insider allocation, no rug observed; 1% swap fee in USDC, $16.3K accrued, nothing withdrawn. Risk is custody in unverified contracts. **Not in the venue table** – add once it has a name.

## 3. Ops

- Etherscan key upgraded to **Lite** ($49/mo). Set locally in `.env.local` and in Vercel Production as a *Sensitive* variable (so `vercel env pull` writes it as `""` – that is redaction, not an empty value). Production redeployed; o1 probe verified end to end on $SPIKE.
- `vercel env pull` appended `.env*` to `.gitignore`; harmless, not committed.

## 4. The report-design mismatch (not touched; Astra owns it)

Observed on every token report (SPIKE, CATALYST): inside the new shell's Decision chapter, `src/components/TokenReport.tsx` (around L430–535) renders old-design blocks verbatim under `rd-legacy`: `SnapshotEvidenceControl` ("SAVED REPORT V1"), the `investigation-story-cover` header with `ProjectLinks` and "Copy summary", `InvestigationDecisionCanvas` (mono-caps "TOKEN SAFETY CHECKS / WHAT IS STILL OPEN / FINISHED CHECKS"), and `ReportActionsRow` (pill SHARE / EXPORT PDF). Introduced by #480 on 09-20. Project and person reports (`Report.tsx`) hide their legacy case behind the collapsed "The full case behind this decision" disclosure instead.

Secondary: `LaunchPanel` and its siblings in `ThreatScanPage.tsx` still use the old `panel` / `mono` styling under "Contract risk checks" in Evidence & method, and #515 makes the Launch panel render on far more tokens than before.

New-design vocabulary: `src/reports/argus/primitives.tsx` (`Panel`, `ChapterHead`, `Badge`, `ReviewBanner`, `LegacySection`) and `argus-report.css` under `.argus-rd` (`score-card`, `metric-strip`, `signal-row`, `plain-table`, `reading-line`, `subtle-note`).

#521 "Restore approved token report design and evidence context" merged 20:14 UTC from the Enigma-Fund account; assumed to be Astra's fix. Not reviewed here.

## 5. Open PRs not authored in this session

#513 contextual project diligence · #508 omit incomplete DexScreener swap counts · #507 fail closed on market caps above $20T · #506 inert pause flags / unclassified LP · #412 UNI-style market figures.

## 6. Cross-check list for Astra

1. Scan $SPIKE on production: Launch panel venue **o1**, "Paid in: the quote asset (ETH)", Launch window "9 same-block buyers"; Code header "B20 system asset"; Trading-activity rationale carries "vol/liquidity …x".
2. Scan $MEME on Robinhood: venue **long**, conduct **dump** with claim count; risk points come from the conduct warning, not the fee model.
3. Confirm the Vercel Production `ETHERSCAN_API_KEY` is the Lite key (a Base `getLogs` call returns data, not "Free API access is not supported").
4. Confirm the `database` CI job passes twice in a row on `main` with images staged from `public.ecr.aws`.
5. Review whether the "Paid in" row and the B20 copy paragraph added to `ThreatScanPage.tsx` fit the restyled panel, or should move into the new primitives.
6. Decide whether the CATALYST suite gets a venue entry and a registry note.
