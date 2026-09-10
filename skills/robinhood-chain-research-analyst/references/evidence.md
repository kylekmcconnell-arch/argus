# Evidence and scope

Design inspiration: [563's research-skill prompt](https://x.com/563defi/status/2097731184402759902). This is an ARGUS implementation of a bounded subset, not a third-party hosted service or a claim of endorsement.

Network authority: [Robinhood connecting documentation](https://docs.robinhood.com/chain/connecting/), checked 2026-09-10. Mainnet chain ID is 4663; testnet 46630 is intentionally unsupported by this runner. Public RPC is rate-limited; a configured provider is recommended for production volumes. The runner checks `eth_chainId` before collecting and independently checks a different archive endpoint.

Creation discovery: [Blockscout getcontractcreation](https://docs.blockscout.com/devs/apis/rpc/contract), with [Sourcify deployment lookup](https://docs.sourcify.dev/blog/apiv2-lookup-endpoints/) as an independent fallback. Validate the returned chain and contract address; never assume the first indexer row belongs to the requested token. A factory attribution needs a matching successful internal CREATE/CREATE2 frame before treating the immediate creator as corroborated.

The runner retains normalized evidence, method/parameters, SHA-256 hashes of full JSON result values, observation time and pinned block identities. Bytecode and large traces are represented by hashes and bounded summaries. These are reproducible query records, not a full raw-archive export. Traces retain at most 120 frames; creation receipts retain at most 100 matching transfers. Event values are raw integer units to avoid floating-point and decimals assumptions.

`owner()` can be absent or misleading; a zero EIP-1967 implementation slot excludes neither alternative proxies nor privileged roles. Transfer events can be minting/distribution and do not establish purchases. Call selectors and value transfers alone do not identify a launch fee or its beneficiary. No inference in this initial version affects an ARGUS score.

Limits: 20 requests and 32 seconds by default, hard ceilings 24 and 40 seconds; each request at most 7 seconds and 1 MB decompressed JSON. Unsupported methods, rate limits, failed reads and exhausted budgets are recorded gaps. Provider response bodies and configured endpoint URLs never enter error text. Dollar cost remains unknown rather than being inferred as zero.
