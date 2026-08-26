# ARGUS canonical report design QA

**Source visual truth**

- `.codex-audit/order-audit/02-decision-and-scores.png`
- `.codex-audit/order-audit/04-score-composition.png`
- Both source captures are 1280 × 720 px at the desktop report state.

**Rendered implementation**

- Production URL: `https://argus-one-flax.vercel.app/?s=%40earnonhood&kind=person`
- `.codex-audit/design-qa/implementation-opening.png`
- `.codex-audit/design-qa/implementation-composition.png`
- `.codex-audit/design-qa/implementation-people.png`
- Browser CSS viewport: 1280 × 720.
- The in-app browser capture service returned 1024 × 720 raster captures. Full-view comparisons therefore use the left 1024 px of each 1280 × 720 source capture; this is a crop normalization, not a page-scale comparison.
- Combined comparisons:
  - `.codex-audit/design-qa/comparison-opening.jpg`
  - `.codex-audit/design-qa/comparison-composition.jpg`
  - `.codex-audit/design-qa/comparison-credible.png`

**State**

- Signed-in owner workspace.
- Saved EARN project report, version 13, light mode.
- Canonical Style 2 report presentation.

**Findings**

- No actionable P0, P1, or P2 visual mismatch remains.
- Typography is darker and larger than the prior report while preserving the existing ARGUS type system. The state-of-the-house title, narrative, score labels, composition rows, and disclosure summaries are legible at the tested desktop viewport.
- Layout rhythm is now decision-first and progressive: state of the house and dual scores, score composition, one decision brief, product, people, market, social, connections, then evidence appendices. The main document has no horizontal overflow at 1280 px (`documentElement.scrollWidth === innerWidth === 1280`).
- Color usage follows the existing semantic tokens. The green accent distinguishes “The state of the house” from the subject name without creating a new visual language.
- Image quality is preserved. The people section renders the saved real profile image (one image for the one named EARN contributor); no placeholder art was introduced.
- Copy and content remain evidence-bound. The opening explicitly says when the saved report lacks a source-backed product explanation. Social activity, notable mentions, and the unverified accusation stage remain present and clearly separated from scored findings.
- The decision-evidence cards now reserve a separate line for support/source metadata and use one readable card column inside each half of the decision brief. The source/title collision shown in the Aug 26 reference is gone at the tested 1280 × 900 constrained viewport.
- The detached desktop status rail is absent from the canonical report. This removes the contradictory `Caution` card shown alongside `7/7 checks finished` and the duplicate `Check next` card; unresolved questions remain in the full-width `What to check next` section inside the decision brief.

**Primary interactions tested**

- Sticky table-of-contents links: Decision, Score, Product, People, Market, Social, Connections, Evidence & method.
- Score composition navigation and visible six-dimension table.
- Evidence appendix disclosure opens successfully.
- People section shows the named contributor, role source, avatar, and review action.
- Social section shows 24-hour activity, seven-day conversation, notable accounts, and the unverified accusation stage.

**Console check**

- Browser console warnings/errors after navigation and disclosure interaction: none.

**Full-view comparison evidence**

- `comparison-opening.jpg` shows the simplified sticky navigation and unchanged dual-score opening hierarchy.
- `comparison-composition.jpg` shows the score composition moved directly after the opening, with less dead space and a full-width readable table.

**Focused region comparison evidence**

- Opening and score composition were reviewed separately because the score labels and row typography are too small to judge reliably in a single full-page capture.
- People and social sections were verified directly in the rendered DOM and with `implementation-people.png`; this confirmed the photo, social counts, notable mentions, and accusation content.

**Comparison history**

- Initial rendered comparison: no post-render P0/P1/P2 mismatch found. The prior implementation issues—duplicated decision narratives, out-of-order navigation, repeated score explanations, and expanded evidence density—were corrected before this blocking comparison.
- Post-fix evidence: `comparison-opening.jpg`, `comparison-composition.jpg`, and the measured no-overflow browser state.
- Aug 26 overlap correction: `comparison-credible.png` places the reported overlap beside the production correction. Production DOM measurements confirm a single 372.9 px card column in `What looks credible`, no `.report-experience-rail`, and no browser console warnings or errors.

**Follow-up polish**

- P3: the report can later replace the product-summary fallback once a new EARN scan captures a stronger first-party description. This is a data-quality follow-up, not a layout defect.

final result: passed
