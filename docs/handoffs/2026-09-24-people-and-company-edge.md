# Company identity, person diligence and product edge

Initial implementation record. Superseded by [the completed redesign and research record](2026-09-25-diligence-redesign.md).

Related issue: #537. Route: ARGUS canonical product. Local continuation of the intelligence-program checkout; no publication, deployment or paid collection was performed.

## Changed behavior

Web team discovery now requests the LinkedIn employer's actual website and a comparison of business activity. A conflicting employer domain or activity rejects the candidate. LinkedIn candidates lacking that comparison are omitted; other candidates require an official-site source or a post on the exact company account. This applies to site search, X-content model discovery and reverse role search. Cache keys were versioned and include company context. Provider-frozen official team posts remain an independent path. Management enrichment uses the X profile website ahead of a token homepage.

This is a conservative candidate filter, not independent verification of LinkedIn: the returned employer fields are model discovery output, and matching candidates remain unverified leads. A full provider-fetched employer receipt and explicit rejected-candidate ledger are still needed. Alternate/rebranded domains currently need independent support; the filter intentionally does not guess equivalence. The synthetic Hades Privacy / Hades Mining regression asserts that three same-name wrong-domain employees are excluded and that an official-site pseudonym can survive.

Person reports gained a separate background and track-record chapter, with identity state, roles, ventures, collaborators, engineering, credentials, legal events and disclosed control/wallet evidence. Existing evidence appendices and website access outcomes are preserved. Firms retain their organization presentation. A resolved name without an exact-account identity binding is not shown as a linked public identity. Unresolved identity is not automatically classified as deliberate pseudonymity. Navigation and presentation version were updated (2026-09-24.5).

The research ledger now asks about attributable GitHub work, collaborators, public wallet attribution, relevant public military history and credentials, role-specific contributions and outcomes. These additions use existing evidence predicates and collection budgets. GitHub, collaboration and wallet coverage are optional rather than mandatory founder score requirements. Private identity exposure, leaked contact data, speculative wallet joins and name-only adverse matches are excluded by the research instructions. No new criminal, military or private-data collector was added.

Company Decision pages gained an early “What's their edge?” panel preserving sourced product claims, contradictory passages and dates. Product research now asks for mechanism and differentiation, including mixer/FHE/zero-knowledge/TEE/MPC/hybrid privacy architecture, what is hidden, trust assumptions, limitations and implementation versus roadmap. The panel does not infer a moat or privacy guarantee from a primitive. Existing reports with no such evidence disclose the gap rather than retroactively inventing it. This iteration presents source passages; a dedicated independently verified comparative-moat synthesis remains future work.

## Verification and limits

Hades-specific saved evidence was not supplied or modified. No claim is made that Hades uses any particular privacy mechanism or that shlok's identity or employment has been independently confirmed. Historical report data and scores were not rewritten. The person dossier remains bounded by existing collection and public evidence; it is not a completed comprehensive background investigation or a new automated relationship-graph extractor.

Validation covers wrong-domain employers, missing employer evidence, incompatible businesses, lookalike domains, first-party pseudonyms, identity-link absence, preserved contradictions and unknown product mechanism. Full local test suite, type projects, source-of-truth contract, offline canaries, calibration and production bundle were run; see the task result for final counts. Live provider, production database and production UI acceptance were not run.

Rollout requires protected repository checks and the existing authorized release workflow. Rollback removes the new presentation and query/filter changes and rebuilds the collector; frozen reports remain intact.
