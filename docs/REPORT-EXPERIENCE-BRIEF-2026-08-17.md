# ARGUS report experience — design brief

Date: 2026-08-17
From: Kyle
Status: direction brief. Not a spec to implement literally. Read section 7 before writing code.
Reference: https://precurion.com (studied 2026-08-17; findings below are from its live DOM, not guesswork)

## 1. The ask, in one paragraph

An ARGUS report should feel like opening an interactive dossier that somebody prepared for
you, not like loading a dashboard. It should tell a story in a deliberate order, assemble
itself as you read down it, and let you push on any claim to go deeper — with the deeper
layers being where paid credits get spent. Today the report is a tall stack of panels that
all arrive at once. We want a document that presents itself.

This brief is about **structure, sequence, and mechanics.** It is explicitly *not* a
licence to restyle ARGUS to look like Precurion. See section 7.

## 2. The one idea worth stealing

Precurion ships three CSS custom properties that decide the colour of every number on the
page:

```css
--provenance-sourced:  var(--green);   /* lifted from a document */
--provenance-computed: #8b8d8d;        /* derived by the system */
--provenance-missing:  #b45309;        /* nobody has evidenced this */
```

Every figure in their file is coloured by **where it came from**, not by whether it is
good or bad. A reader learns the vocabulary in about four seconds and then reads the whole
document through it. Grey means "we worked this out." Green means "a document says so."
Amber means "this is a hole."

That is ARGUS's evidence contract, rendered. We already have the richer version of this
model in data — `verified`, `corroborated`, `conflicted`, `lead`, `unanswered`,
`checked_empty`, `unavailable`, `partial`, `failed` — and `ARGUS-SOURCE-OF-TRUTH.md`
already forbids letting an absence artifact masquerade as support. But visually that
distinction currently lives in exactly one place: `BasicFactsPanel.tsx`, which maps
`corroborated → "Confirmed twice" / tint-pass`. Everywhere else, a hard-sourced number and
an inferred one look identical.

**Precurion has the design language and invented data. We have real evidence and no
language for it.** Closing that gap is the highest-value thing in this brief, and it is
worth doing even if we ship none of the scroll choreography.

Provenance is orthogonal to verdict. A number can be RUG-flagged *and* fully sourced.
Do not collapse the provenance ramp into the existing pass/caution/fail semantics — that
mapping is frozen in `DESIGN.md` and means something else.

## 3. How their page actually works (decoded from the DOM)

Not a scroll library, and not CSS scroll-timelines — `animation-timeline` count is zero.
It is a small number of deliberate, hand-built primitives.

**One pinned stage.** Exactly one `position: sticky` element on the whole page:
`.sticky.top-0.h-svh.overflow-hidden`. Its parent track is 3024px against a 720px
viewport, so the stage holds for ~4.2 screens while the narrative advances around it. The
document stays put; the story moves.

**The page is authored as named beats.** Nine `data-screen-label` values, in order:
`Hero → The file → Reach → Reach → Audit → What it costs you → Timing → Vision → Close`.
Someone wrote the outline before the components. That is the reason it reads like a
presentation instead of a feature list.

**The artifact is a composed document, not a screenshot.** Slots are named via `data-cs`:
`wrap`, `box`, `frame`, `rail`, `bar`, `sheet`, then content blocks `blk-mast`, `request`,
`blk-facility`, `blk-case`, `sup-0`, `sup-1`, and activity rows `row-appraisal`,
`row-recompute`, `row-tied`, `row-case`. Scrolling reveals these in sequence — masthead,
then the request, then the facility terms, then the case, then individual supporting
points. **The document writes itself in front of you, in the order a human would write
it.** That is the entire "feels alive" effect. It is not particle effects; it is sequencing.

**Shared values are tracked entities, not text.** `data-slot-value="ltv"` appears eight
times across the page, always on the same figure (65%). When the story says the credit
agent recomputed LTV, the number morphs between positions rather than re-rendering.
Paired with `data-slot-rect`, this is a FLIP animation (measure first rect, measure last,
invert, play). **A fact keeps its identity as the story moves it around.**

**Reveal state is an attribute, not a transition.** `data-settled="true|false"` per
element; computed `transition-duration` is `0s` everywhere, and `document.getAnimations()`
reports 4–9 running Web Animations at any time. IntersectionObserver flips the attribute,
WAAPI plays the reveal. Named keyframes: `ps-draw`, `ps-uncover`, `ps-drift`, `hd-in`,
`mark-breathe` — draw and uncover, like ink and paper.

**Jumping breaks it, on purpose.** Programmatic `scrollTo` past the pinned section renders
blank: content sits at rest state until its reveal fires. Worth knowing because it is a
real hazard — see the acceptance criteria in section 9 about deep links and print.

**They respect reduced motion.** Three `prefers-reduced-motion` media blocks. Non-negotiable
for us too.

## 4. The rabbit-hole pattern

Their provenance drill-down is the closest thing on the page to what we want from paid
depth. Click a figure and you get:

> **Provenance · Amount**
> "…a facility in the principal amount of Thirty-Eight Million Dollars ($38,000,000),
> advanced in a single drawing…"
> Facility agreement · p. 1
> Extracted from source · 14:02
> Checked against the term sheet · 14:06
> Accepted by a person · 16:40

The exact passage, the document and page, and the **chain of custody with times** —
machine extracted it, machine cross-checked it, a named human accepted it. That is
precisely ARGUS's evidence contract (exact passage, stable URL, retrieval time, provider
state, verification state) with a UI wrapped around it. We can populate every one of those
rows from data we already persist.

Their Sources table is the other half: 14 documents, each with a **"facts cited" count**
(61, 24, 11…) totalling 197. It inverts the usual source list — instead of "here are our
sources," it is "here is how much weight each document is currently carrying." A document
carrying 61 facts that turns out to be wrong is a much louder signal than a row in a
bibliography.

## 5. Mapping onto ARGUS

| Precurion | ARGUS equivalent |
|---|---|
| The credit file (one deal) | The report (one subject: token, founder, project, wallet) |
| Facility terms block | Verdict + score + the headline metrics |
| "What supports it" / "What is unresolved" | Already exists as the investment case + open questions |
| Provenance drill-down | Evidence row: passage, URL, retrieval time, provider state |
| Sources table with citation counts | The immutable evidence catalog — **add the citation count** |
| Activity feed (agent-by-agent, timestamped) | The live scan console + check runs |
| Chain of custody (extracted → checked → accepted) | Evidence state transitions, already persisted |

The mapping is close enough to be suspicious of. Resist copying their *sections*; copy
their *discipline* — narrative order, one pinned artifact, named slots, provenance colour,
progressive assembly.

Note the threat scanner and the person/founder engine have different natural stories. A
token report's spine is chronological (how it launched → who bought → who has been selling
→ what the code permits → verdict). A founder report's spine is the six investor questions
in `ARGUS-SOURCE-OF-TRUTH.md`. **Do not force one template over both.** Build the
primitives once; author the beats separately.

## 6. Credits and progressive depth

The free layer must be a complete, honest report on its own. The paid layer buys **more
investigation**, never the removal of a curtain from work already done.

This is a product-integrity rule, not a UX preference. ARGUS's governing defect is "a
sentence a reader believes that the evidence does not establish" — and a credit gate is a
new and very effective way to commit it. Specifically:

- **Never tease a finding that does not exist.** "Unlock 3 more risk factors" when the
  deeper scan might return nothing is a lie with a price tag. Offer the *work*
  ("trace the top 20 holders' funding sources — 5 credits"), and be explicit that it may
  come back empty. An honest empty result is a legitimate thing to have paid for.
- **A gate is not an absence.** A locked module must never render in the same visual
  language as `unanswered` or `checked_empty`. Those mean "we looked and found nothing";
  a gate means "we have not looked." Conflating them corrupts the evidence contract at
  the exact point the user is deciding to trust us.
- **Never gate a safety screen.** `ARGUS-SOURCE-OF-TRUTH.md` designates never-waive checks
  (identity resolution, OFAC, trust-graph connections, related-asset distinction). If a
  scan is a RUG or a person fails a sanctions screen, that is free, loud, and immediate.
  Selling access to a warning we are already holding is indefensible.
- **Price before the click**, cost after, always reversible-looking. No surprise debits.

Naming hazard: `credit` is already heavily used in this codebase to mean *crediting
evidence to a check* (`scanChecklist.ts`, `lib/reports.ts`, `InvestigationReport.tsx`).
Pick a distinct identifier for the currency — `spendUnits`, `scanCredits`, something
greppable — or the confusion will be permanent.

## 7. What NOT to copy — read this before styling anything

`DESIGN.md` is a **binding style contract**, written after a visual audit found 5 verdict-badge
idioms, 25+ font sizes, and three parallel status→colour maps. It is not advisory.

It mandates: graphite-black intelligence room, one royal-blue signal, Archivo + Geist Mono,
a frozen token-name list, a nine-step font ramp with no other sizes permitted, and no hex
or `rgba()` literals anywhere.

Precurion is warm paper (`--surface-canvas: #faf7f2`), Young Serif display, and a green
accent. **Adopting that look would violate the contract on every axis at once.** Do not
do it as a side effect of this work.

So:
- **Take:** the pinned-stage structure, named narrative beats, slot-based progressive
  assembly, FLIP-morphing shared values, the provenance drill-down, the citation-count
  sources table, reduced-motion discipline.
- **Do not take:** the palette, the serif, the paper texture, the section copy.
- **Needs Kyle's explicit sign-off before starting:** the provenance colour ramp. It adds
  a new semantic colour family, and `DESIGN.md` freezes token names. It is the best idea
  here and it is also a contract amendment — propose the token names and get them approved
  rather than shipping them into `src/index.css` and asking later.

If any of this brief conflicts with `DESIGN.md`, `DESIGN.md` wins until Kyle amends it.

## 8. Suggested build sequence

Do not start with choreography. Start with the thing that is true.

1. **Provenance as data → UI.** One primitive that renders any value with its evidence
   state. Adopt it in one report end to end (`TokenReport.tsx` is the smallest at 798
   lines; `Report.tsx` is 4,479 and should not be first). Ship it flat, no animation.
2. **The drill-down.** Passage + source + chain of custody, opening from any provenanced
   value. Still no choreography. This alone makes the report feel investigable.
3. **Sources table with citation counts.** Cheap, high signal, mostly existing data.
4. **Narrative beats.** Author the outline for one report type as named screens before
   building anything. If the outline is not compelling as a list of headings, no amount of
   motion will save it.
5. **Progressive assembly.** IntersectionObserver + `data-settled` + WAAPI. One reveal
   primitive, used everywhere, with a reduced-motion path that is a plain instant render.
6. **The pinned stage.** Last, and only for the highest-value sequence.
7. **Credits.** Only once depth is real enough to be worth paying for.

Steps 1–3 are worth shipping even if 4–7 never happen.

## 9. Acceptance criteria

- Every displayed decision value carries a provenance state, and a sourced value is
  visually distinguishable from a derived one at 11px and in CVD simulation.
- A gated module is never visually confusable with `unanswered`, `checked_empty`, or
  `unavailable`.
- `prefers-reduced-motion: reduce` renders the complete report immediately with no
  scroll-dependent reveals. Not a faster animation — no animation.
- Deep links land correctly: `/?s=<handle>` and threat deep links must render their target
  fully without the reader having to scroll a section into view first. **Precurion fails
  this** — verify it explicitly.
- Print / Export PDF produces the whole report. Enigma's PDF export (`3d94b3e`,
  `a1a2f73`, `463b356`) is shipped and working; scroll reveals must not regress it.
  Test the export at step 5, not at the end.
- Keyboard and screen-reader reachable: no fact obtainable only by scrolling an animation.
- Existing gates stay green — `npm run quality` (`truth:check`, `canary:offline`,
  `calibrate`, `test`, `typecheck`) plus a production build.
- Per the continuous-update rule, material report-UX changes update
  `ARGUS-SOURCE-OF-TRUTH.md` and the relevant benchmark doc in the same change set.

## 10. Open questions for Kyle

1. Which report type is the pilot — token (Enigma's active surface, smaller file) or
   founder (the original thesis, richer evidence)?
2. Is the provenance colour ramp approved as a `DESIGN.md` amendment, and with what token
   names?
3. What is the credit unit worth, and what is the cheapest paid action? That determines
   whether depth is sold per-module or per-investigation.
4. Does this land as one branch or a sequence of PRs? Steps 1–3 are independently
   shippable and would be easier to review separately.
