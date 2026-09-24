# Fomo evidence reaches holder reports

Issues #525 and #537. Presentation 2026-09-24.4.

The workspace now has an append-only Fomo wallet-observation index. The importer validates existing wallet sweep receipts without provider requests; `npm run fomo:import -- receipt.json organization-uuid` validates only, and `--apply` imports idempotently through service credentials. Only exact-chain wallet-resolution hits and misses qualify. Unscoped `evm`, handle-only files, mismatched returned wallets, future timestamps and duplicate wallet rows are rejected. Hashes identify the imported file, not provider authenticity. Sweep timestamps are batch completion times, not per-request timestamps. Raw provider responses remain private.

Fresh browser token scans, server token scans and server project holder scans read the current organization's stored observations alongside Arkham. Stored labels retain their original date and receipt hash. The 30-day reuse window is a conservative product policy, not a provider freshness guarantee. Missing, stale and failed storage coverage remain explicit. Labels never change scores, curated group memberships or ownership claims. Opening a saved report does not query the store or modify its frozen evidence. Private/shared surfaces only show their frozen snapshot.

The Fomo person adapter no longer attaches a wallet on a same-name FOMO account without a provider-recorded matching X link. FOMO handles and X handles are separate identity namespaces. Solana deduplication now preserves case.

No bulk collection or production import ran for this change. The index initially contributes no observations until an authorized receipt is imported. Paid collection remains gated by a numerical CU cap. This closes the ingestion path, not complete holder coverage or validated trading signals.

Validation includes exact chain/address joins, rank 25, immutable originals, stale/future receipts, storage tenant isolation, unavailable versus missing records, named identity rejection, and executable database privilege/immutability checks. Protected CI and production migration/deployment gate release. Rollback removes the read/import entry points; append-only receipts can remain archived.

Follow-up validation requires a 20-byte EVM address on every non-Solana Fomo receipt, including custom-chain names. The generic token identifier accepts broader formats for custom chains, so it was insufficient on its own at this provider boundary. Regression cases cover both the importer and frozen-evidence validation.
