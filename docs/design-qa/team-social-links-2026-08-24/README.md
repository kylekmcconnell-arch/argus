# Team social-link QA

## Comparison target

- Source visual truth: `reference-team-card.png`, captured from the user's EARN report where the resolved team card had no public-profile destination.
- Browser-rendered implementation: `implementation-team-links.png`.
- Combined review: `comparison.png`, with the source above the implementation.
- State: light-theme saved report, desktop report rail, team section visible.

## Result

The existing ARGUS team-card hierarchy, provenance color, spacing, typography,
and report rail remain unchanged. Compact profile controls now appear below a
person only when that frozen team record contains a valid identity-bound X,
LinkedIn, GitHub, or Hugging Face profile. The controls use the existing
Phosphor icon set, report tokens, keyboard focus treatment, and external-link
behavior.

No display-name search link or inferred profile is produced. LinkedIn company
pages, malformed URLs, wrong-host developer links, and model-only identity
links remain hidden.

## Browser and automated checks

- The preview rendered the saved X profile links for two team records and exposed descriptive accessible names.
- The team grid remains two columns on desktop and collapses to one column below the existing small breakpoint.
- Focused component and dossier-scope tests cover valid links, deduplication, malformed URLs, company pages, and model-only link stripping.

final result: passed
