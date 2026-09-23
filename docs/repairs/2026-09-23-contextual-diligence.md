# Contextual project diligence repair

Tracking: https://github.com/kylekmcconnell-arch/argus/issues/512
Related: #440, #472.

## Problem and resulting behavior

The SSR report exposed four independently reproduced defects: report identity appeared only in the footer; open questions offered only a section-wide challenge; the summary inflector changed “supplies” into “supplie”; and incomplete provider output was displayed as a partially answered question despite containing no answer.

The presentation now shows the immutable report ID at the top, provides an individual challenge and saved evidence basis for every question, fixes the inflection, and distinguishes unanswered research from an actual partial answer. Presentation version: 2026-09-23.2. Historical scores and frozen evidence remain unchanged.

The collector also excluded homepages from roster extraction, truncated team text after 5,000 characters, and returned immediately after matching a bio contract to a DEX pool. Future scans now extract directly supported homepage roles, retain bounded role-bearing passages, and perform an exact-contract CoinGecko enrichment. Additional token deployments carry chain, address, URL and capture time. They do not establish bridge safety or a product's chain footprint. The primary chain/address remains unchanged. A mismatched registry record is rejected.

## Applicability decision

Applicability is source-bound, determined before scoring and frozen with the dossier. A ticker, “pump” suffix, display-name match or model lead cannot establish an exemption.

- A disclosed fair launch does not require venture funding. P4 is omitted and the denominator renormalized when no financing, backer or operating relationship is established. Named backers or later financing retain P4. Verified adverse evidence prevents this exemption.
- Explicitly prelaunch products without contrary live-product evidence, operating metrics or user-fund/security evidence defer P5. The live token remains assessed. Alpha/beta alone is not an exemption.
- Optional fair-launch funding, governance, private treasury, legal-entity, public-security and vesting questions are contextual rather than mandatory missing disclosures when no relevant fact is present. Published commitments remain assessable.
- Audits are scoped to the deployed programs and funds at risk. A launchpad's audit is not blanket assurance for custom code, OFTs or a later product. The patch does not mark a token “audited” merely because it used a launchpad.
- Mint/freeze/upgrade authority, pooled-fund control, attributed legal events and security incidents remain relevant. Corporate boards do not apply automatically to every token.
- Market-cap/FDV equality is not evidence of no locks, no insider holdings or no future minting. Existing supply-ratio evidence remains bounded and no vesting conclusion is synthesized from it.
- A homepage openly saying “coming soon” is a development-stage disclosure, not adverse SiteNotLive evidence. A parked page remains a separate condition; contradictory live-product promises retain their own evidence path.

## SSR source review

Public pages read on 2026-09-23:

- https://strategic-super-reserve.com/about identifies January 19, 2025 as the original token launch, names Enigma, JRA and Alex with project roles, and describes locked supply. Token launch and organizational founding are distinct dates unless the source equates them. The user's corrected date is January 19, 2025.
- https://strategic-super-reserve.com/ also publishes the team. The fetched footer includes a Cayman address, which alone does not establish an exact incorporated legal entity. Do not invent an entity name from that address.
- https://www.coingecko.com/en/coins/strategic-super-reserve records a rebrand and contract migration. New contract age must not reset project age.
- Current website text includes live-product language and illustrative demo labels. It must be reconciled with the stated forthcoming product, rather than silently choosing either account. Historical Reserve products, current token deployments and future SSR.fun availability need separate dated evidence.

No founders, legal names, funding amounts, date, product status or addresses were hardcoded into production data. SSR is a regression scenario, not an exception list. A fresh, authorized scan after deployment is still required to verify current provider behavior and produce a new scored report version.

## Verification and rollout

Regression coverage includes homepage-only pseudonymous rosters after a long marketing prefix; matching and mismatched contract enrichment; three-chain registry projection; per-question challenge opening; visible report IDs; the supply typo; source-bound exemptions; later financing; beta with live funds; and neutral prelaunch disclosures. Existing saved scores are preserved.

Deploy through the repository's normal reviewed PR and required CI. The database gate must pass before merging. Do not update existing report_versions or rescan merely to hide the defective historical result. Roll back through a code revert; old report versions remain available.

Local verification: 484 test files passed; 5,210 tests passed plus one expected failure. Typecheck, production build, source-of-truth contract, seven offline canaries and 21 calibration cases passed. PostgreSQL CI remains a required pre-merge gate.
