# Navigation consolidation audit

## Verdict

The original sidebar presented specialist engines as separate products even though New Investigation already routes token and website inputs through them. Radar is different: it discovers subjects before the user has chosen what to investigate. Watchlist is the monitoring destination, and its sweep alerts belong with the watched subjects that produced them.

## Steps

1. **Current sidebar — needs simplification**  
   Evidence: `01-current-sidebar.png`  
   New Investigation already accepts a handle, contract, project, or website, but Threat scan and Website check repeat those entry points. Alerts are separated from the Watchlist sweep that creates them.

2. **Consolidated Watchlist — healthy**  
   Evidence: `02-consolidated-watchlist.png`  
   The primary navigation keeps Radar for discovery and Watchlist for monitoring. Recent sweep alerts sit below watched subjects, state that monitoring is manual, retain severity treatment, open the affected subject, and can be dismissed.

3. **Mobile navigation — healthy**  
   Evidence: `03-mobile-navigation.png`  
   The same simplified hierarchy fits the existing modal navigation drawer. No removed specialist destination reappears at the narrow breakpoint.

## Functional findings

- Radar is not redundant. It reads DexScreener's trending and newly listed feeds, scans up to 16 candidates in parallel, orders riskier results first, and opens a selected token as an investigation.
- Website intelligence is already part of New Investigation. Website subjects route through the existing retrieval, recovery, project, team, token-pivot, and persistence pipeline.
- Threat intelligence is already part of New Investigation. Token reports reuse the same threat pipeline and cached threat report as the former standalone entry surface.
- Alerts are not background monitoring. They are persisted results from a manual Watchlist sweep, so Watchlist is the correct place to read and dismiss them.

## Accessibility and evidence limits

- The desktop sidebar exposes a named Primary navigation region. The mobile drawer exposes a modal ARGUS navigation dialog with explicit open and close controls.
- Recent alerts use a named region and heading, and dismiss controls have subject-specific accessible names.
- Screenshots cannot prove full keyboard order, focus restoration, or screen-reader output. Existing mobile drawer and supporting truth-state tests cover structure and state handling; hands-on assistive-technology testing remains outside this audit.
