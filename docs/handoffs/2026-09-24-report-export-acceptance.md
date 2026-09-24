# Export evidence and reference acceptance

Follow-up to #537 and #538. Presentation 2026-09-24.3 includes the full-width Decision coverage row. The document serializer omitted team social links and holder intelligence and stated identity was resolved through the roster. It now preserves safe recorded X/LinkedIn/Telegram/email links, separates source access from identity, excludes model-found identity links, and carries captured holder rows with coverage, dates and registry/provider attribution. Exporting a frozen report never reads current workspace research or providers.

A named acceptance matrix covers person sources/failures, non-X research, namesakes, private/shared/saved/export paths, Catalyst registry records, SPIKE B20 handling, rank 25 and partial holder history. Required verify CI invokes the matrix in addition to the existing full tests, canaries and calibration. Missing named tests fail the acceptance command. These are offline semantic/interaction checks, not proof of live provider coverage or screenshot equivalence on every device.

Validation: 169 checks across 15 reference suites passed locally before full quality/build. Full protected CI is required before merge. Rollback is code-only; no migration and no historical report mutation.

Final local quality: 5,371 tests passed with one existing expected failure, all type projects, offline canaries/calibration and production build. The named acceptance command is also an explicit step in protected verify CI.
