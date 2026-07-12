# ARGUS visual system — the canon

UI copy does not use em dashes. Choose a period, colon, comma, or middle dot by context.

This is the binding style contract for every component in `src/`. It exists because a
visual audit (2026-07-11) found 5 verdict-badge idioms, 5 external-link styles, 3 avatar
implementations, 25+ font sizes, three parallel status→color maps, and a broken
`var(--color-x)14` alpha hack silently rendering nothing in 8 files. One concept, one idiom.

The identity: **a forensic instrument, not a SaaS dashboard.** Deep-navy operations room,
one royal-blue signal, verdicts that read like stamped findings. Density over decoration
(REPORT-UX-AUDIT.md P2); critical metadata legible at arm's length (P1).

## 1 · Typography

Fonts (loaded in `index.html`):
- **Archivo** (variable, `wdth` 62–125, `wght` 100–900) — all UI text. The expanded width
  (`.display` class) is the brand voice: wordmark, page titles, verdict words, hero.
- **Geist Mono** — all data: handles, addresses, hashes, scores, timestamps, chips, eyebrows.
- Sora is removed.

The ramp — the ONLY font sizes allowed (Tailwind arbitrary values, exact px):

| step | class | use |
|---|---|---|
| 10px | `text-[10px]` | absolute floor. True footnotes only. NEVER for decision-critical data. |
| 11px | `text-[11px]` | metadata rows, chip labels, provenance, timestamps |
| 12.5px | `text-[12.5px]` | secondary body, list rows, descriptions |
| 13.5px | `text-[13.5px]` | primary body, nav, buttons |
| 15px | `text-[15px]` | card/panel titles, leads |
| 18px | `text-[18px]` | section heroes, sub-verdicts |
| 24px | `text-[24px]` | page H1 (every page, no exceptions) |
| 32px | `text-[32px]` | report subject names, big stats |
| 44px | `text-[44px]` | landing hero, verdict words |

Sweep rule — a deterministic decision table, not judgment (tie-break: the LARGER step):

| legacy | maps to |
|---|---|
| 7.5, 8, 8.5, 9 | 10 — and if the text is semantic (see closed list below) → 11 |
| 9.5, 10, 10.5 | 11 if the element (or nearest styled ancestor in the same JSX expression) is mono/uppercase/tracking-* or renders a timestamp/address/hash/count; else 11 anyway — 10 survives ONLY on `.chip-sm`/`.stat-label`-style non-semantic footnotes |
| 11.5 | 11 if mono/uppercase/data; else 12.5 |
| 12, 13 | 12.5, 13.5 |
| 14, 14.5 | 13.5 if nav/button/body; 15 if a card or panel title |
| 15, 16 | 15 |
| 18, 19, 20, 21, 22 | 18 |
| 24, 26, 28, 30 | 24 if a page H1; 32 if a subject name or hero stat |
| 34 | 32 (44 only for the landing hero / verdict words) |

SVG text: minimum 9. **Semantic metadata closed list** (never smaller than 11px, never
`ink-faint`, always `.chip` (with tint), `.verdict-pill`, or `font-medium` text): verdict
words, readiness/coverage labels (INCOMPLETE/PARTIAL/…), risk categories
(hacker/mixer/sanctioned), sanctions-hit badges, hard-cap labels, attribution-confidence
chips, "own token" / "rugged" / drift-alert flags. These use `.chip` + tint or
`.verdict-pill` — never `.chip-sm`.

## 2 · Color

Token NAMES are frozen (`--color-void/panel/panel-2/sidebar/line/line-2/control-line/ink/
ink-dim/ink-faint/signal/signal-dim/signal-lift/on-signal/accent-tint/pass/caution/fail/avoid/unverifiable`). Values are
tuned in `src/index.css` for both themes — components never hardcode color.

The signal family has three jobs: `signal` is the accessible primary fill/focus color,
`signal-dim` is its pressed/strong-fill partner, and `signal-lift` is blue text/icons on
dark surfaces. Never use `signal-dim` for small text in dark mode. `control-line` is the
minimum-contrast boundary for inputs and outlined buttons; `line` and `line-2` remain
quieter structural dividers. `on-signal` is the theme-stable foreground for primary
signal fills.

The palette is deliberately off-stock (no default Tailwind hex anywhere) — don't
reintroduce stock values. `fail` (magenta-rose) vs `avoid` (alarm red) is load-bearing:
`.verdict-pill.tint-fail` renders a hollow dot so the split survives 11px and CVD.

Hard rules:
- **NEVER** `rgba(...)` literals, hex literals, or `"var(--color-x)14"`/`` `${color}66` ``
  string-alpha (invalid CSS on vars; breaks light theme on hex). Use the tint utilities below.
- **Dynamic color escape hatch — the ONE permitted style-prop color edit:** when the color
  is a runtime expression (variable, ternary, map lookup like `verdictMeta(...).color`),
  convert to `className="… tint-var"` + `style={{ "--tint": expr }}` and strip any
  string-alpha suffix. When the value is a CONSTANT (`var(--color-X)`, hex, rgba), delete
  the style prop and use the matching `.tint-X` / `text-X` utility instead.
- Semantic mapping is fixed: pass=confirmed-good · caution=warn/partial · avoid=disqualifying
  (sanctions hits, hacker/mixer ties, AVOID verdicts — always `avoid`, never `fail`) ·
  fail=failed-verdict scores · unverifiable=couldn't-establish · signal=brand/interactive.
- Kind coloring canon (directories + admin agree): person=`signal`, token/investigation
  =`unverifiable`, site=`pass`, kol=`caution`, vc=`ink-dim`.

Tint utilities (defined in index.css via `color-mix`; text is mixed toward ink so every
pair holds AA in both themes):
- `.tint-pass` / `.tint-caution` / `.tint-avoid` / `.tint-fail` / `.tint-signal` /
  `.tint-unverifiable` / `.tint-neutral` / `.tint-var` — tinted bg + border + AA text.
- Composition is cascade-safe: `.chip`, `.verdict-pill`, `.btn-chip`, `.finding` consume
  `var(--tint, neutral)` themselves, so `chip tint-avoid` works regardless of order.

## 3 · Component idioms (classes in index.css)

Rhythm rule: `.panel` is the ONLY bordered container. Interiors are ledger-style —
borderless washes + hairline `divide-y divide-line/60` rows — never box-in-box-in-box.

- `.panel` — the ONE card. `.panel-inset` — borderless interior wash (no border, 6px
  radius). Never bare `bg-panel/70|/40|/30`.
- `.finding` — the ONE grid-breaking idiom, reserved for decision-critical rows:
  square corners, 2px left rail + tint wash (`finding tint-avoid` for a sanctions hit,
  `finding tint-caution` for the INCOMPLETE readiness band). Use it for: sanctions hits,
  risk-path rows, hard-cap findings, readiness bands, RingAlert. Nothing else.
- `.eyebrow` — the ONE section header. A panel has ONE header. Demotion is deterministic:
  if an inner panel's own label duplicates the outer `Section` header case-insensitively,
  delete the inner element; otherwise convert it to `<div className="text-[12.5px]
  text-ink-dim">` keeping the text verbatim. Never delete an element referenced by
  `aria-labelledby` or asserted in a `*.test.tsx` — convert those instead.
- `.chip` — the ONE badge geometry, mono 11px uppercase + tint class. `.chip-sm` (10px)
  for non-semantic footnotes ONLY — never paired with a tint.
- `.verdict-pill` — the ONE verdict treatment (dot + stamped word; hollow dot on fail),
  `.verdict-pill-lg` 13.5px. Hero verdict words are NOT pills: `.display` 32–44px
  UPPERCASE in the semantic color.
- Buttons: `.btn-primary` · `.btn-secondary` · `.btn-ghost` · `.btn-chip` (mono 11px
  row-level CTA, min-height 24px). Tint allowlist for `.btn-chip tint-signal`: buttons
  that start/re-run a scan or panel or pivot to a new audit — "Run audit", "Rescan",
  "Re-check", "Sweep now", "audit →", "full audit →", "trace →", "open →", "run panel"
  / "analyze" CTAs on paid panels. Everything else stays neutral.
- `.stat-tile` — label ABOVE value (`.stat-label` 10px mono uppercase / `.stat-value`
  15px mono), borderless wash. One orientation everywhere.
- `.link-ext` — external links (arrow ships via `::after` — REMOVE literal `↗` glyphs
  when applying it). Internal pivots keep `→` suffix via `.btn-chip`.
- `.empty-state` — the ONE empty treatment.
- Avatars: use `Avatar.tsx` (or match it exactly): `rounded-md` tile, letter fallback
  `bg-panel-2 text-signal`. Sizes h-6/h-8/h-9 only.
- Focus: global two-layer `:focus-visible` ring ships in index.css — remove per-component
  `focus:outline-none` hacks; inputs use `.field`.
- Motion: `.rise-in` on page/report mounts; `.scan-bar` replaces the three duplicated
  private scan-keyframe copies; existing `.sweep`/`.scan-line` for consoles. CSS motion,
  Tailwind pulse/ping/spin/bounce utilities, and smooth scrolling are all visually
  disabled under `prefers-reduced-motion`.

## 4 · Structure

- Shell: no static announcement bar (ServiceAlert remains the only banner). Sidebar nav is
  grouped (Investigate / Directories / Intelligence / Workspace) with an active left-rail
  accent, not a filled pill.
- Page header: H1 24px `.display` + 13.5px ink-dim intro, `mt-1.5`, then content. Every page.
- Report hero: subject identity → verdict block (ring + 44px display verdict word +
  readiness band as a first-class tinted strip) → readiness stat tiles. The readiness
  band uses `tint-caution` when INCOMPLETE/PARTIAL, `tint-pass` when ready — the copy and
  logic come from `decisionReadiness.ts` untouched.

## 5 · What a visual pass must never touch

Data fetching, `panelCostToken` / `fetchPanelJson` / `requiredPanelHeaders` /
`PanelRequestNotice` **conditions** (restyle the box only), `recordForensicEntities` graph
writes and key conventions, `decisionReadiness` / `reportVersion` / `scanChecklist` logic
and copy, CaseBrief save/conflict machine, auth flows, run/subscribe wiring, layout math in
TrustGraph/NetworkGraph/HolderBubbleMap (colors/labels only), ARIA/roles (only add, never
remove), and all self-hide contracts. className and markup-order changes only.
