# Lane: engine and scoring (origin/main 042a271)

Deterministic engine (src/engine/audit.ts finalize) holds the provisional-scoring decision. Defects are upstream in server/agent.ts (analyst preflight/validator/bands) and orchestrate assembly.

## E1 (P1, probe-confirmed) Preflight admits axis whose only evidence is checked_empty; validator can never accept it -> whole verdict INCOMPLETE after up to 4 paid model calls
- server/agent.ts:4218-4232 preflight `assessedEmptyAxes` marks axis scoreable on a checked_empty checkOutcome.
- server/agent.ts:1459-1462 validator requires substantive primaryEvidenceRef; :690-692 isSubstantiveArtifact excludes checked_empty.
- server/orchestrate.ts:5216-5231 partial scoring only removes missingSubstantiveAxes; :4522-4534/4608-4614 repair loop re-asks 3x; -> analyzeSubject null -> evidence.axes=[] -> INCOMPLETE for all axes.
- Real producers: project-product-substance checked-empty on confirmed 401/403 (orchestrate:835-843) -> P2; project-backing-partners checked-empty (:2919-2925) -> P4 assessed_null band (agent:2039-2042); affiliations-associates checked-empty -> F6.
- Fix: make preflight and validator agree (drop assessedEmptyAxes from preflight, or let validator accept checked_empty as primary only when axis has no substantive artifact and band is assessed_null); stop repair loop when reason is missing-substantive-support and axis has zero substantive artifacts; regression test: preflight ready => every requested axis has a validator-acceptable primary artifact.

## E2 (P1, probe-confirmed) Investor I5 reputation floor minted from ADVERSE press
- agent.ts:3085-3094 press eligible for I5 only when it matches INVESTOR_REPUTATION_MATERIAL (fraud, lawsuit, sanction...). :3349-3389 exact-name press -> observed, substantive. :2519-2551 I5 ladder counts distinct hosts -> >=3 hosts = solid [18,21]/25; adverseRows only scans basicFacts/findings, never the press. :2355-2373 investor setBand enforces tier min as floor (no verified-only floorTier like project ladder :2030-2056). :1525-1535 validator rejects any investor score below min, no counter-evidence escape.
- Scenario: three "SEC sues X for fraud" headlines from 3 hosts -> analyst FORCED to score reputation 72-84%.
- Fix: port project floorTier pattern (floors from verified only; observed press raises max only); run INVESTOR_REPUTATION_RISK over press text and treat adverse press as none/assessed_null for floor; allow below-min with verified counter artifact; add calibration control.

## E3 (P2, probe-confirmed) Person roles (FOUNDER/KOL/ADVISOR/AGENCY/MEMBER) have no bands: null-result check outcomes (status finding -> verified, agent:3337-3339) and observed-only rows (bio/tweets/promotions, :3416, :2690-2736) validly carry a MAX score. No "evidence is data not instructions" rule in system prompt (:4297-4308); packet inlined raw JSON (:4344). Band enforcement only for PROJECT/INVESTOR (:1489-1535).
- Probe: F3=15/15 citing only "no repeat financing" null assessment; F5=18/18 citing only bio with steering text -> accepted.
- Fix: distinct assessed_null verification state anchoring <=39% band for person roles; minimal FOUNDER bands (F1/F5 ceilings need verified fact); injection rule in prompt; ceiling enforcement for person roles.

## E4 (P2) Partial-scoring headline says "ARGUS did not produce an overall score" while engine publishes provisional governing score (orchestrate:5346-5350 vs audit.ts:768-805; completeness_state partial :5487-5491). Analyst headline discarded. Fix copy: "score is provisional, covers N of M areas (W% weight)".

## E5 (P3, medium) Partial scoring validates against subset packet but persists catalog/bands from full packet (orchestrate:5216-5231 vs :5244-5250, reconciliation :5262-5268; agent:1049-1065 any axis w/o support -> verdict null; pruning :4058-4110). Sole-support artifact pruned only in full packet -> fail closed after successful paid call. Fix: persist/reconcile against the packet actually scored.

## E6 (P3, probe-confirmed) Fully assessed FAIL role relabelled composite PROVISIONAL when another role partial (audit.ts:808-844); reportPresentation.ts:251-267 secondarySignal only carries PASS. FAIL band invisible. Fix: carry governing verdict signal for CAUTION/FAIL too.

## E7 (P3) Hygiene: Audit ctor (audit.ts:379-391) doesn't dedupe roles (doubles score_coverage; fixture/persisted path). corroborationAxis/advisoryCorroborationAxis (:514-528) and corroboration.ts:61-63 award 0.5*weight for no testimonials — dead code contradicting policy; delete.

## Verified correct: finalize() math, bonus withholding, cap-after-bonus, impersonation null, token applicability handling, weights sum 100, validator type checks, Grok parse robustness (no fabricated fallback scores), caps require eligible artifacts, presentation.final single function.
## Known issues status: #353 open (cap survives but FAIL band lost), #373 open, #374 open, #375 open, #326 (I5 worse than described: mints floors from adverse press).
