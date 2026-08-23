# Social activity design QA

## Comparison target

- Source visual truth: `docs/design-qa/social-activity-2026-08-22/source-option-1.png`
- Browser implementation: `docs/design-qa/social-activity-2026-08-22/implementation-v2.png`
- Focused comparison: `docs/design-qa/social-activity-2026-08-22/comparison-v2.png`
- Viewport: 1536 x 1024 CSS pixels at device scale 1
- Source pixels: 1596 x 985
- Implementation pixels: 1536 x 1024
- Normalization: the source panel and implementation panel were cropped to their visible card bounds and normalized to 1440 x 535 before the side-by-side comparison.
- State: light theme, complete X collection, 24-hour view, CLUTCH fixture

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation preserves the source's strong count-first hierarchy, compact report typography, restrained weights, and monospaced evidence metadata. The project name is inserted from the bound report identity rather than hard-coded UI copy.
- Spacing and layout rhythm: the title, toggle, lead metric, movement, score, supporting metrics, chart, and source note follow the source order and density. The implementation uses the report's existing panel radius, border, and spacing tokens so it fits the surrounding design language.
- Colors and visual tokens: the selected source's white report surface, neutral controls, black text, and green activity accents map to existing ARGUS theme tokens. Green communicates activity emphasis here and is explicitly separated from the safety verdict.
- Image and asset fidelity: the source has no photographic or illustrative asset. Interface icons use the project's existing Phosphor icon library. The chart is generated from the saved hourly data rather than a decorative image.
- Copy and content: the implementation retains the source's plain-language lead, comparison, activity score disclaimer, account breadth, post volume, concentration, capture time, and source basis. It adds an expandable exact-query receipt and honest partial and unavailable states.
- Accessibility and interaction: the 24-hour and 7-day controls expose `aria-pressed`; the chart has an accessible summary; the seven-day state was exercised in the browser and updated both the lead metric and pressed state.

## Focused evidence

The focused side-by-side comparison was required because the full source includes a report shell while the local harness isolates the new section. It confirms that the main card hierarchy, metric grouping, activity-score treatment, green histogram, and source footer match the selected direction. The source mock depicts more bars than a literal hourly 24-hour view; the implementation intentionally renders 24 hourly buckets so the label and data window agree.

## Comparison history

### Iteration 1

- Finding: P2, the histogram inherited the neutral interaction token and rendered black, while the selected design uses green activity bars.
- Finding: P2, the activity score was oversized plain text instead of the compact bordered score treatment in the source.
- Finding: P2, the lead sentence said "this project" instead of naming the bound project, weakening the report-specific read.
- Fixes: mapped histogram bars to the ARGUS brand-green token, adopted the compact bordered score treatment, removed the extra eyebrow, and used the bound project name in the lead sentence.
- Post-fix evidence: `docs/design-qa/social-activity-2026-08-22/implementation-v2.png` and `docs/design-qa/social-activity-2026-08-22/comparison-v2.png`.

## Primary interactions and runtime checks

- Switched from 24 hours to 7 days in the browser.
- Verified `aria-pressed="true"` on the seven-day control.
- Verified the lead changed to the seven-day account breadth.
- Checked browser console errors after the final reload: none from the application.

## Follow-up polish

- P3: the generated source uses a denser chart whose apparent time span conflicts with its 24-hour label. The implementation favors data correctness with one bar per captured hour.

final result: passed
