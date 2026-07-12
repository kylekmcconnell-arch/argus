# ARGUS Option 3 design QA

- Reference: `/Users/kyle/.codex/generated_images/019f4d0d-40c7-7022-bdd6-3c28cb336218/exec-fe781513-8ed4-4642-a392-b05c1d2c3925.png`
- Production: `https://argus-one-flax.vercel.app`
- Authenticated state: Kyle owner session, frozen `@gakonst` person report, snapshot v11
- Desktop viewport: 1488 × 1012 virtual viewport; the in-app compositor records the left 1002px while DOM measurements confirm the full 1488px layout
- Mobile viewport: 390 × 844

## Comparison evidence

- Full reference / desktop / mobile comparison: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12/comparison-full.png`
- Same-slice reference / production comparison: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12/comparison-focused-top.png`
- Final desktop capture: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12/person-report-desktop-1488x1012-final.png`
- Final mobile capture: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12/person-report-mobile-390x844-final.png`
- Final home capture: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12/home-mobile-390x844-final.png`

## Fidelity review

- Typography: passed. ARGUS display, interface, and mono roles remain consistent; report identity and verdict now carry the intended Option 3 hierarchy.
- Layout and spacing: passed. Desktop renders identity first with immutable metadata in the right column; mobile renders identity before verdict and uses a separate, scrollable action row.
- Color and tokens: passed. Existing ARGUS void/panel/line tokens are preserved, with verdict-aware pass/caution/avoid treatments.
- Assets and icons: passed. Source avatars are preserved and interface glyphs use Phosphor rather than emoji, text symbols, or approximate SVGs.
- Content: passed. Verdict rationale, confidence limits, open questions, source provenance, coverage, and freshness use recorded report data. Adverse verdicts now lead with adverse drivers and show positive evidence only as counterweight.
- Responsive and accessibility: passed. 390px page width has no document overflow; the main canvas hides accidental overflow while intentional action/section scrollers remain keyboard-operable with hidden scrollbars. Drawer dialog semantics, focus trap, Escape close, focus restoration, skip link, and graph keyboard paths are covered.

## Interaction verification

- Authenticated report and home loaded from production.
- Mobile navigation drawer opened, trapped focus, closed with Escape, and restored trigger focus.
- Report section links resolve to real targets; the sticky section bar remains at the top of the canvas without overlapping the anchored section.
- Case library loaded 25 active / 2 archived cases; People, Projects, Sites, and search filters were exercised.
- Provider page distinguishes configured credentials, observed request health, cached results, and missing optional sources.
- No paid investigation was submitted during QA.
- Production browser console errors: none.

## Iterations resolved

- Pass 1 P1: mobile header actions clipped the primary CTA. Fixed with a dedicated horizontal action row.
- Pass 1 P1/P2: mobile decision content followed report metadata. Fixed order to identity → verdict → readiness → immutable metadata.
- Pass 1 P2: inconsistent text glyphs. Replaced with Phosphor icons.
- Pass 2 P1: adverse verdict narratives used positive evidence polarity. Made verdict narrative and counterweight selection verdict-aware and added regressions.
- Pass 2 P1: two-row sticky header could collide with section navigation. Header is now non-sticky and the section bar owns the sticky position.
- Pass 2 P1: cached or historical provider usage could appear Healthy. Configuration is now evaluated first and cache hits are explicitly not provider requests.
- Pass 2 P2: token Relationships linked to contract panels. Moved the anchor to Team & provenance / graph.
- Pass 3 P1: desktop overview ordering put metadata before identity. Reset the identity grid order at the desktop breakpoint.
- Pass 3 P2: the main canvas exposed an accidental mobile horizontal scrollbar. Main overflow is now clipped while intentional horizontal controls remain usable.

## Dark-first theme and investigation-motion QA

- Production deployment: `dpl_HsStkPh3NZEpkRk3ncPcv2eDpHWZ` · Ready · aliased to `https://argus-one-flax.vercel.app`.
- Default-theme behavior: passed. Missing, invalid, or unavailable storage resolves to dark; the explicit light preference is restored before paint. The live control updates `data-theme`, native `color-scheme`, browser `theme-color`, its action label/icon, and persisted preference together.
- Color hierarchy: passed. Dark uses a midnight-blue void rather than flat black; raised panels use restrained depth and an inner highlight. Light uses an off-white canvas and white panels. Text, control boundaries, and primary-button pairs are covered by automated WCAG contrast assertions in both themes.
- Investigation progress: passed. The live canvas shows only observed evidence-event count, unique source-tagged evidence, review flags, latest event, and real investigation hop. Synthetic completion percentages and unobserved provider claims are absent.
- Motion: passed. The live eye ring runs at 2.2s, the active-stage pulse at 2s, and the evidence-ledger sweep at 1.4s. New evidence rises in briefly. Reduced-motion removes animated utilities, sweep/pulse behavior, SMIL, and smooth auto-scrolling while preserving the same state information.
- Resolution truthfulness: passed. Subject resolution is labeled as pre-acquisition, reports zero observed events/sources, and explicitly says provider acquisition has not started.
- Responsive behavior: passed. Investigation, resolution, home, and report states have no document-level overflow at 390 × 844; the investigation ledger remains intentionally scrollable.
- Authenticated production: passed. Dark report, dark/light home, theme persistence, drawer close/focus restoration, and the existing owner session were exercised without submitting a paid provider run. Browser console errors and warnings: none.

### Theme and motion comparison evidence

- Option 3 / current production report: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/option3-prod-report-comparison.png`
- Previous / refined mobile home: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/home-before-after-mobile.png`
- Dark / light investigation state: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/investigation-dark-light-mobile-comparison.png`
- Final dark investigation: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/investigation-dark-mobile-final.png`
- Final subject resolution: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/resolution-dark-mobile-final.png`
- Live production dark home: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/prod-home-dark-mobile.png`
- Live production light home: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/prod-home-light-mobile.png`
- Live production dark report: `/Users/kyle/Documents/ARGUS/.artifacts/ui-qa-2026-07-12-theme/prod-report-dark-mobile-final.png`

### Verification summary

- Unit/integration: 106 files, 1,008 tests passed.
- Typecheck: application, collector server, and API configurations passed.
- Production build: passed.
- Focused lint for all substantive theme, progress, routing, and test changes: passed. Repository-wide lint remains blocked by a separate local `.claude/worktrees/visual-overhaul` dependency resolution and pre-existing lint debt outside this iteration.
- Vercel runtime scan: no failed requests from this release. One Node `url.parse()` deprecation warning from a dependency was classified as an error-level log on a successful `304` report request.

## v3.0 copy and homepage cleanup QA

- Production deployment: `dpl_FdFfaS76WD4v1ePB8qEDMJLgT2pN` · Ready · aliased to `https://argus-one-flax.vercel.app`.
- Homepage focus: passed. The live-token sample row and `$PEPE`, `$SHIB`, and `$UNI` shortcuts are absent. The investigation form now flows directly into the evidence-output panel on mobile and the decision-coverage section on desktop.
- Version label: passed. The authenticated desktop sidebar renders `v3.0`; the prior `v2.2` label is absent.
- Copy policy: passed. Authored runtime copy contains no literal em dashes across `src`, `api`, `server`, or middleware. Missing values use `N/A`; prose uses contextual periods, commas, colons, or middle dots. Third-party title parsing still recognizes em dashes through escaped `\u2014` compatibility patterns.
- Responsive layout: passed. The 1440 × 1000 desktop and 390 × 844 mobile pages have no document-level horizontal overflow. Removing the sample row leaves intentional, balanced spacing at both breakpoints.
- Accessibility and runtime: passed. Existing semantic controls and labels remain intact. The authenticated production browser console reports no warnings or errors, and no paid investigation was submitted during QA.

### v3.0 comparison evidence

- Desktop before / production after: `/Users/kyle/Documents/ARGUS/artifacts/home-v3-desktop-before-after.png`
- Mobile before / production after: `/Users/kyle/Documents/ARGUS/artifacts/home-v3-mobile-before-after.png`
- Final production desktop: `/Users/kyle/Documents/ARGUS/artifacts/home-after-v3-desktop.png`
- Final production mobile: `/Users/kyle/Documents/ARGUS/artifacts/home-after-v3-mobile.png`

### v3.0 verification summary

- Unit and integration: 107 files, 1,009 tests passed.
- Typecheck: application, collector server, and API configurations passed.
- Production build: passed locally and on Vercel.
- Runtime copy policy: passed.
- Focused lint for the homepage, sidebar, authentication, routing, and policy-test changes: passed.
- Vercel error scan: no error-level logs found for this deployment.

No open P0, P1, or P2 visual or functional issues remain in the reviewed flows.

final result: passed
