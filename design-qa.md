# State of the House brand-accent differentiation - design QA

## Evidence

- User reference context: `/Users/kyle/Downloads/Screenshot 2026-08-26 at 11.43.15 AM.png`
- Tested implementation: `http://127.0.0.1:4173/?design-preview=earn-dual-score`
- Visual state: light theme, sticky contents bar visible, canonical dual-score report opening.

## Comparison

The previous opening rendered the project name and “The state of the house” with nearly identical black display treatment, causing the report chapter to read like a repeated identity title. The revised treatment preserves EARN as the black subject name and assigns only “The state of the house” the existing ARGUS brand green.

This follows the selected Auric reference’s two-tone editorial hierarchy while using ARGUS’s own brand token rather than introducing a new color. The change is deliberately limited to the narrative headline; green evidence dots and pass scores retain their existing semantic meaning elsewhere.

## Verification

- Computed light-theme accent: `rgb(0, 168, 107)` from `--color-brand`.
- The project name remains `--color-ink`.
- Heading wrapping, score-card alignment, and sticky navigation remain unchanged.
- Browser check reports no horizontal overflow, Vite overlay, or visible runtime error.
- The heading remains large display text, so the brand-green contrast is suitable for its size.

final result: passed
