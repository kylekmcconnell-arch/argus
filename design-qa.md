# ARGUS founder-attribution consistency QA

- Final result: passed
- Reviewed state: frozen STONKBROKER investigation with a project-published founder attribution and no independent person/control corroboration
- Browser CSS viewport: 1280 × 720 at 1× density
- Source visual truth: `/var/folders/h7/6njc4p9d12s5cjfrwk2sr2080000gn/T/codex-clipboard-888c6a1d-8f68-443b-9f14-b9a9e6a17230.png` (1487 × 1058)
- Browser implementation capture: `/tmp/argus-founder-attribution-qa.png` (970 × 720 visible in-app capture)
- Focused side-by-side comparison: `/tmp/argus-founder-attribution-comparison.png` (830 × 635)
- Capture normalization: the fixed assistant was shifted left in the development fixture only because the in-app browser screenshot crops the 1280 px CSS viewport to 970 output pixels. The production `right: 1.25rem` position was restored before build.

## Findings

No actionable P0, P1, or P2 issues remain. The report and assistant now distinguish four separate facts consistently: the role the project publicly attributes, independent corroboration of that role, the person's civil identity, and ownership/control evidence.

## Required fidelity surfaces

- Fonts and typography: existing ARGUS display, body, mono, chip, and eyebrow styles are preserved. The longer evidence-boundary explanation wraps without truncation at the 390 px assistant width.
- Spacing and layout rhythm: the added attribution-source link fits inside the existing `What matters now` card without crowding the evidence-state row or composer.
- Colors and visual tokens: `PROJECT ATTRIBUTED` uses the existing signal/context treatment rather than green verification or caution-red speculation.
- Image quality and asset fidelity: no new raster assets were required. The source link uses the repository's Phosphor icon system.
- Copy and content: `Clutch Markets identifies @0xSimpleFarmer as Founder` is stated directly. The next sentence limits the claim to first-party role attribution and separately names unresolved civil identity, legal ownership, wallet control, and operational authority.

## Full-view comparison evidence

The saved report remains visible below the floating assistant. The report hero and People section now state the project-attributed founder rather than falling back to `no founder` language. The People section labels the source as a project-attributed role and exposes the exact attribution link.

## Focused comparison evidence

The focused comparison preserves the selected mock's blue Eye header, compact evidence card, source-aware answer surface, prompts, and composer. The revised content adds a bounded role-evidence state and source link without changing the selected interaction model.

## Comparison history

1. P1: the Eye said `Verify who is actually behind` and labeled the known project attribution `OPEN LEAD`. Fixed with a direct project-attribution conclusion and `PROJECT ATTRIBUTED` evidence state.
2. P1: the report said `No verified team` even though it displayed a project-published founder. Fixed the hero, noticed rail, and People section to name the attributed founder while preserving the independent-corroboration boundary.
3. P1: frozen-report Q&A omitted nested investigation team attributions, so a founder question could answer as if the report knew nothing. Added bounded `projectAttributions` to the immutable evidence packet and allowlisted the first-party attribution source only for that precise claim.
4. P2: the report presented project-attributed people beside speculative search candidates under similar `verify` language. Split `Project-attributed team` from `Possible people to verify` and retained verdict exclusion for both where appropriate.
5. P2: the obsolete separate Eye workspace still contained the old conflated semantics even though it was no longer rendered. Removed that dead component to prevent reintroduction.
6. P1: the investigation header collapsed the protocol/company site and token landing page into one website, hiding `clutch.markets` and binding company evidence to STONKBROKER's domain. Verified first-party fact citations now recover the project site; the header shows `Clutch Markets site` and `$STONKBROKER site` as separate links.
7. P1: the floating Eye looked like an investigator but behaved like single-turn support chat over a person-shaped summary. It now receives a bounded report-wide investigation packet, retains multi-turn conversational context as non-evidence, and renders a conclusion, reasoning chain, uncertainties, decisive evidence, citations, and follow-up composer.

## Interaction and runtime checks

- Floating Eye remains open over the unchanged report and connections graph.
- Project attribution source opens from both the People section and the Eye.
- Eye questions remain bound to the immutable `reportVersionId`.
- The Q&A system prompt explicitly forbids downgrading project attribution to speculation or upgrading it to independent identity/control proof.
- Production founder question returned: `CLUTCH publicly identifies @0xsimplefarmer as its founder ... This is a first-party project attribution, not independently verified proof of legal identity or operational control.`
- Local rendered-link inspection confirmed separate `https://clutch.markets/` and `https://stonkbrokers.io/` header anchors. Production deployment `dpl_2ii9p92pShSjrSyie3WRKV2vRRTf` reached Ready and received the `argus-one-flax.vercel.app` alias.
- Five focused suites passed: 50 tests.
- Full typecheck, scoped lint, production build, and `git diff --check` passed.

## Follow-up polish

No P3 follow-up is required for this correction.

final result: passed
