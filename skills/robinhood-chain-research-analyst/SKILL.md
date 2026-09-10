---
name: robinhood-chain-research-analyst
description: Collect reproducible Robinhood Chain token creation evidence, pinned contract state and bounded internal-call traces for launch due diligence.
---

Use the executable runner for an exact Robinhood mainnet token address. For names or tickers, establish the exact address from official sources before running. Never substitute a same-address asset on another chain.

Run `node scripts/run.mjs --address 0x… --output /absolute/new-result.json` from this skill directory. Node 22 or newer is required. The output filename must not already exist. The runner uses public endpoints by default; optional server environment variables `ROBINHOOD_RPC_URL` and `ROBINHOOD_ARCHIVE_RPC_URL` enable configured providers. `--no-trace` skips the internal-call trace request. There are no model API calls, wallet keys or write transactions.

Read [evidence.md](references/evidence.md) before interpreting findings. Keep source-attributed creation discovery separate from receipt/trace corroboration. Report the saved block/hash, timestamps, request count and gaps. Only cite findings supported by the retained observation IDs. Do not turn coincident transfers into proven coordinated buyers, or an owner getter into a full permissions audit.

This initial executable covers contract code, owner getter, supply, EIP-1967 implementation slot, explorer creation discovery, receipt transfers and optional call traces. It does **not** implement full PONS lifecycle analysis, v4 liquidity custody, fee-recipient attribution, sell simulation, complete holder reconstruction or tokenized-equity rights analysis. Broader investigations require separately verified evidence. Never present this package as the completed capabilities advertised by the original prompt.

ARGUS runs this same module through its authenticated Deep launch analysis action, saves results separately against an immutable report version, and does not change the score. Run only on explicit request; reuse saved output instead of repeating requests without a reason.
