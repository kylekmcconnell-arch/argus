# Deep launch analysis — issue #397

Route: canonical ARGUS. Baseline: 5079c9e (PR #396). The shared Production/Developer report renders one supplemental panel for saved Robinhood token and investigation reports.

## Behavior

An explicit action runs the same dependency-free module packaged in `skills/robinhood-chain-research-analyst`. Reading a saved panel does not spend provider requests. POST requires analyst/owner membership and the existing workspace supplemental allowance (default 100 requests/day). The handler derives chain/address from the tenant-scoped immutable report version; browser endpoints and address hints are ignored. Viewer GET access remains read-only. Private/unsaved and public share views cannot start work.

The runner verifies mainnet chain ID, pins the head block/hash, reads code, owner(), supply and the EIP-1967 implementation slot, discovers creation via Blockscout with Sourcify fallback, checks the successful receipt against its block and optionally requests a bounded call trace. It never labels coincident transfers as buys or coordination. Registry attribution is distinguished from on-chain observations. Endpoint credentials and provider error bodies are excluded. Dollar cost remains unknown; request count is measured.

Default ceilings: 20 requests / 32 seconds; hard ceilings 24 requests / 40 seconds, 7 seconds per request and 1 MB decompressed response. The runner does not sign transactions, hold wallet keys or call a model. Configured RPC URLs are server environment values; public endpoints work with coverage limits. The archive endpoint is independently chain-checked.

Stored runs are separate from report payloads and scores. A service-only lease serializes attempts by workspace, immutable version and tool version. Completed results are reused; failed or abandoned attempts may be retried. Old failed attempts are retained. Late writes require their exact still-running run ID, so they cannot overwrite a replacement attempt.

## Initial scope and limits

This is an ARGUS implementation inspired by the linked skill specification, not a hosted third-party tool. PONS curve state, graduation, fee attribution, v4 custody, sell simulation, full holder reconstruction and tokenized-equity rights analysis are not implemented by this initial runner. These remain explicit coverage gaps. The standalone skill guides interpretation of the retained evidence and exposes the same executable helper used by the API.

One live public-endpoint probe demonstrated Blockscout HTTP403 handling. A follow-up with the independently verified Sourcify fallback recovered the creation transaction and receipt: five observations in 12 requests. Public debug_traceTransaction was unsupported and recorded as such. No score was changed.

## Rollout

Apply `20260910174609_deep_launch_research.sql` before the application. Existing reports, scoring and identity migrations remain untouched. New storage and claim function are service-role only, with composite organization/version FK and RLS. Run database and application guards, typecheck, build and native Node import validation; then release through protected main. Verify authenticated lookup and a single explicit panel action. If necessary, restore the previous immutable app deployment while retaining additive storage and saved evidence.

Optional configured providers: ROBINHOOD_RPC_URL and ROBINHOOD_ARCHIVE_RPC_URL. No new paid subscription or credential is provisioned by this change. The selected provider must support chain4663; missing historical/trace capability is a gap, not an adverse token finding.
