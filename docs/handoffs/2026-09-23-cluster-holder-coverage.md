# Top-25 relationship tracing

Issue #525; canonical Argus product route. The on-demand EVM and Solana relationship traces now use the same top-25 holder observation builder as reports. EVM first attempts the configured free explorer; a ten-row GoPlus fallback remains explicitly partial. Unknown contract wallets and arbitrary provider tags no longer cause silent exclusion. Solana token accounts are deduplicated and grouped only by explicit reported owners; global owner ranking remains unconfirmed. Each response includes the frozen holder sample and registry matches beside its separate tracing coverage.

Shared funding and transfers remain relationship leads, not common-control proof. The 45-second processing deadline begins before holder collection; existing authentication, signed panel capability, cost attribution and bounded concurrency remain intact. Client cluster wallet objects are normalized into address strings.

Native ESM dependency tests now include holder and clustering routes. They exposed extensionless shared-module imports, corrected in this change. Offline regression tests verify rank 25, unknown contracts, explorer failure/ten-holder coverage and Solana owner aggregation. Full quality: 5,288 passing tests plus one expected failure, seven canaries, 21 calibration cases, all types. Build passed. No paid provider calls or live bulk collection ran.

Rollout: required protected-main checks. Rollback: revert code; no migration. Remaining acceptance gap: actual complete ranked provider coverage and budgeted identity enrichment, not merely a configured target of 25.
