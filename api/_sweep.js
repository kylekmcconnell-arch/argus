// server/providerDeadline.ts
import { AsyncLocalStorage } from "node:async_hooks";
var context = new AsyncLocalStorage();
var deadlineFetch = (input, init) => {
  const signal = context.getStore();
  signal?.throwIfAborted();
  return globalThis.fetch(input, { ...init, signal: signal ? AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) : init?.signal });
};

// server/sweep.ts
import { createHash } from "node:crypto";

// server/config.ts
function env(key) {
  return process.env[key];
}
var GROK_ANALYST_MODEL = process.env.ARGUS_GROK_ANALYST_MODEL || process.env.ARGUS_GROK_MODEL || "grok-4-fast";
var ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";
var DISCOVERY_MODEL = process.env.ARGUS_DISCOVERY_MODEL || ANALYST_MODEL;

// src/lib/subjectRef.ts
var EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
var SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function normalizeSubjectRef(value) {
  const clean = (value ?? "").trim().replace(/^https?:\/\//i, "").replace(/^[@$]+/, "").replace(/\/$/, "");
  const qualified = clean.match(/^([a-z0-9_-]+):(.+)$/i);
  if (qualified && (EVM_ADDRESS.test(qualified[2]) || SOLANA_ADDRESS.test(qualified[2]) || !/^https?$/i.test(qualified[1]) && /^[A-Za-z0-9._-]{10,128}$/.test(qualified[2]))) {
    return `${qualified[1].toLowerCase()}:${EVM_ADDRESS.test(qualified[2]) ? qualified[2].toLowerCase() : qualified[2]}`;
  }
  if (SOLANA_ADDRESS.test(clean)) return clean;
  if (EVM_ADDRESS.test(clean)) return clean.toLowerCase();
  return clean.toLowerCase();
}

// src/lib/tokenIdentity.ts
var aliases = { eth: "ethereum", "1": "ethereum", "8453": "base", "42161": "arbitrum", "10": "optimism", "137": "polygon", "56": "bsc", "43114": "avalanche" };
function tokenSubjectIdentity(chain, address) {
  if (typeof chain !== "string" || typeof address !== "string") return null;
  const rawChain = chain.trim().toLowerCase();
  const network = aliases[rawChain] ?? rawChain;
  const clean = address.trim();
  if (!/^[a-z0-9_-]{1,40}$/.test(network)) return null;
  const evm = /^0x[0-9a-f]{40}$/i.test(clean);
  const evmNetwork = /^(ethereum|base|arbitrum|optimism|polygon|bsc|avalanche|fantom|cronos|linea|scroll|mantle|zksync|blast|celo|gnosis|sonic|abstract|pulsechain|berachain|unichain|opbnb|polygonzkevm)$/.test(network);
  if (network === "solana" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean) : evmNetwork ? !evm : !/^[A-Za-z0-9._-]{10,128}$/.test(clean)) return null;
  const normalized = evm ? normalizeSubjectRef(clean) : clean;
  return { chain: network, address: normalized, ref: `${network}:${normalized}` };
}

// src/lib/fomoHolderEvidence.ts
var FOMO_REUSE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
function validFomoObservation(row) {
  const identity = tokenSubjectIdentity(row?.chain, row?.address);
  if (!identity || row.chain !== "solana" && !/^0x[0-9a-f]{40}$/.test(row.address) || identity.chain !== row.chain || identity.address !== row.address || row.chain === "evm" || !Number.isFinite(Date.parse(row.capturedAt)) || !/^[a-f0-9]{64}$/.test(row.receiptHash) || !["reported", "unlabelled"].includes(row.state) || row.state === "reported" && (typeof row.label !== "string" || !row.label.trim() || row.label.length > 200)) return false;
  return row.sourceUrl === `https://api.fomoscan.sh/v2/user/wallet/${encodeURIComponent(row.address)}`;
}
function attachStoredFomo(snapshot, evidence, readAt) {
  const unavailable = (state2) => ({ ...snapshot, enrichment: { ...snapshot.enrichment, fomo: state2 } });
  if (!evidence || !Array.isArray(evidence.rows) || !Number.isFinite(Date.parse(readAt))) return unavailable("unavailable");
  if (evidence.state !== "available") return unavailable(evidence.state === "not-configured" ? "not-configured" : "unavailable");
  const requested = new Set(snapshot.rows.map((row) => row.address));
  const map = /* @__PURE__ */ new Map();
  for (const row of evidence.rows) {
    if (!validFomoObservation(row) || row.chain !== snapshot.chain || !requested.has(row.address) || map.has(row.address)) return unavailable("unavailable");
    const age = Date.parse(readAt) - Date.parse(row.capturedAt);
    if (age < 0 || age > FOMO_REUSE_MAX_AGE_MS) continue;
    map.set(row.address, row);
  }
  const rows = snapshot.rows.map((row) => {
    const observation = map.get(row.address);
    return !observation ? row : { ...row, identities: [...(row.identities ?? []).filter((item) => item.provider !== "fomo"), {
      provider: "fomo",
      state: observation.state,
      label: observation.label,
      twitter: observation.twitter,
      capturedAt: observation.capturedAt,
      sourceUrl: observation.sourceUrl,
      receiptHash: observation.receiptHash,
      scope: "provider-address-label"
    }] };
  });
  const state = map.size === 0 ? "no-stored-evidence" : map.size === rows.length ? "complete" : "partial";
  return { ...snapshot, rows, enrichment: { ...snapshot.enrichment, fomo: state } };
}

// src/lib/holderEnrichment.ts
function attachHolderIdentities(snapshot, batch) {
  const validTime = Number.isFinite(Date.parse(batch?.capturedAt));
  if (!validTime || batch?.chain !== snapshot.chain || batch.provider !== "arkham" || batch.scope !== "provider-address-label" || !["complete", "partial", "unavailable", "not-configured"].includes(batch.state) || !Array.isArray(batch.rows) || batch.rows.length > 25) return snapshot;
  const requested = new Set(snapshot.rows.map((row) => tokenSubjectIdentity(snapshot.chain, row.address)?.ref));
  const readings = /* @__PURE__ */ new Map();
  for (const row of batch.rows) {
    const id = tokenSubjectIdentity(batch.chain, row?.address);
    if (!id || !requested.has(id.ref) || readings.has(id.ref) || !["reported", "unlabelled", "unavailable"].includes(row.state)) return snapshot;
    readings.set(id.ref, row);
  }
  const rows = snapshot.rows.map((row) => {
    const reading = readings.get(tokenSubjectIdentity(snapshot.chain, row.address).ref);
    return { ...row, identities: [{
      provider: "arkham",
      capturedAt: batch.capturedAt,
      sourceUrl: "https://api.arkm.com/intelligence/address_enriched/batch/all",
      scope: batch.scope,
      state: reading?.state === "reported" && (typeof reading.label !== "string" || !reading.label.trim()) ? "unavailable" : reading?.state ?? "unavailable",
      ...reading?.state === "reported" && typeof reading.label === "string" && reading.label.trim() ? {
        label: reading.label.slice(0, 200),
        ...typeof reading.entityType === "string" ? { entityType: reading.entityType.slice(0, 80) } : {},
        ...typeof reading.twitter === "string" ? { twitter: reading.twitter.slice(0, 100) } : {}
      } : {}
    }] };
  });
  const answered = rows.filter((row) => row.identities[0].state !== "unavailable").length;
  const state = batch.state === "not-configured" ? "not-configured" : !answered ? "unavailable" : answered === rows.length ? "complete" : "partial";
  return { ...snapshot, rows, enrichment: { ...snapshot.enrichment, arkham: state } };
}
async function enrichHolderSnapshot(snapshot, collect) {
  if (!snapshot.rows.length) return snapshot;
  try {
    const batch = await collect(snapshot.chain, snapshot.rows.map((row) => row.address));
    const enriched = attachHolderIdentities(snapshot, batch);
    const result = enriched === snapshot ? { ...snapshot, enrichment: { ...snapshot.enrichment, arkham: "unavailable" } } : enriched;
    return batch.storedFomo ? attachStoredFomo(result, batch.storedFomo, batch.capturedAt) : result;
  } catch {
    return { ...snapshot, enrichment: { ...snapshot.enrichment, arkham: "unavailable" } };
  }
}
function holderIdentityRoute(fetchImpl2 = fetch) {
  return async (chain, addresses) => {
    const response = await fetchImpl2("/api/holder-enrichment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chain, addresses }),
      signal: AbortSignal.timeout(16e3)
    });
    if (!response.ok) throw new Error("Holder enrichment unavailable");
    return await response.json();
  };
}

// src/data/cabals.ts
var RH = "robinhood";
var SOL = "solana";
var BASE = "base";
var CABALS = [
  {
    id: "rh-hades-polyhedge-2026-09-21",
    name: "Hades / Polyhedge privacy launch",
    kind: "privacy-farm",
    intent: "unestablished",
    summary: "$HADES (Robinhood Chain, Pons v2, 2026-09-21) sells 'private transfers' through hades.exchange. The site is a white-label client for Houdini Swap - the bundle carries HOUDINI_AMOUNT_BELOW_MINIMUM, HOUDINI_TRANSFER_NOT_FOUND and the useXmr routing toggle, and its backend is a hosted app at hades-api-production.up.railway.app - while the token metadata and X bio claim original engineering ('built by the OGs growing up on tors and onions', 'true cypherpunks'). No contract of the product exists on chain and the token has no role in it. Incubator @polyhedge (joined 2026-02, 'Consumer Trading Lab', first product Hades, second teased as Elysium) is anonymous. The creator wallet was funded from a Binance-sourced Ethereum wallet and bridged over Across 32 minutes before launch - no mixer anywhere in its own trail - dev-bought 2.07% and locked it for two years (RobinhoodLocker id 525, unlock 2028-09-22); no fee claims, no sells. The launch bundle (four wallets, 11.3% in one second at 16:54:34 UTC, all exited) traced to chain-wide sniper bots funded through Robinhood's distribution wallet, not to the team. Indexed so the next privacy launch sharing this copy, this backend pattern or this incubator is recognised as the same hands. Intent unestablished: a wrapper sold as original is a disclosure finding, not proof of a rug.",
    firstSeen: "2026-09-21",
    lastSeen: "2026-09-25",
    wallets: [
      { chain: RH, address: "0x5ded38b5b4cbb97a44323609156c3e182e5202ad", role: "deployer", label: "HADES creator (Pons v2 launch sender; dev buy locked)", evidence: "Pons v2 creation tx 0x0bddaf35cc003d9ac953000da673b1e0fae5e473d8702c7ed959f3effd82ab60 (2026-09-21 16:37 UTC); received 20,694,817 HADES in the launch tx; locked all of it in RobinhoodLocker 0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f on 2026-09-22 18:45 (Locked id 525, unlockTime 1853260200). Three transactions total, no claims, no sells; read Robinhood Blockscout 2026-09-24." },
      { chain: "ethereum", address: "0x5ded38b5b4cbb97a44323609156c3e182e5202ad", role: "deployer", label: "Same creator key on Ethereum: received 0.0443 ETH and bridged 0.044 ETH to Robinhood Chain via Across, 32 minutes before launch", evidence: "Ethereum: 0.0443 ETH in from 0xdea91d11 at 2026-09-21 16:05 UTC; depositV3 to Across SpokePool 0x5c7bcd6e at 16:09 (depositId 4631938, originChainId 1); filled on Robinhood Chain in 0x09ff0313162f16ffbc80578801b1e0b9ae83f32c451eb7fed47142bdacbfe672 at 16:09:38. Two Ethereum transactions total. Read Etherscan + Robinhood Blockscout 2026-09-25." },
      { chain: "ethereum", address: "0xdea91d119e625fd556b57a85ebf7cda9688ddcbb", role: "hub", label: "Funded the creator on Ethereum; 4,306-transaction wallet first funded 0.5 ETH by Binance 14 on 2026-05-17", evidence: "Sent 0.0443 ETH to 0x5ded38b5 at 2026-09-21 16:05 UTC. First inbound 0.5 ETH from 0x28c6c06298d514db089934071355e5743bf21d60 (Binance 14) on 2026-05-17 17:23; USDT/USDC transfers and 4,306 transactions since; 2.33 ETH balance on 2026-09-25. No mixer, bridge-hop or privacy tool anywhere in the trail: the team that sells private transfers funded its launch from a KYC exchange through an everyday wallet. Read Etherscan 2026-09-25." }
    ],
    accounts: [
      { handle: "hades_privacy", role: "project", label: "Project account; joined September 2026; bio 'Real Privacy. Built by Real Trenchers. Incubated by @polyhedge'", evidence: "x.com/hades_privacy read 2026-09-24: 618 followers, 7 following, CA in bio." },
      { handle: "polyhedge", role: "cofounder", label: "Incubator; joined February 2026; 'Consumer Trading Lab', 'First Product Out: @hades_privacy', 'Elysium' teased", evidence: "x.com/polyhedge read 2026-09-24: 245 followers, 7 following, no names." }
    ],
    launches: [
      { chain: RH, address: "0x923d915ddf0fe60c04addac68e13f0d5af03164f", symbol: "HADES", name: "Hades", launchedAt: "2026-09-21", venue: "pons-v2", outcome: "unestablished", note: "Privacy-transfer token whose product is a Houdini Swap white-label; copy claims original engineering. Dev allocation locked two years; launch bundle was third-party sniper bots.", evidence: "api/product-probe on https://hades.exchange/ (bundle /assets/index-YHk1MDq3.js: HOUDINI_ error namespace, useXmr, backend hades-api-production.up.railway.app); token metadata description in the creation calldata; sniper funding traced to 0xf70da97812cb96acdf810712aa562db8dfa3dbef (Robinhood distribution wallet, 2.13M txs) on 2026-09-18." }
    ]
  },
  {
    "id": "base-catalyst-suite-2026-09-23",
    "name": "Base Catalyst launch suite",
    "kind": "infra",
    "intent": "unestablished",
    "summary": "Six market registrations on 2026-09-23 were recovered from the same Base registry. Their successful launch transactions share a sender and factory. Catalyst\u2019s receipt identifies a USDC pair, hook and liquidity seeder. Shared infrastructure and a launch sender do not establish malicious intent, beneficial ownership, custody guarantees or project quality. Fee escrow, payout routing and subsequent conduct remain unverified.",
    "firstSeen": "2026-09-23",
    "lastSeen": "2026-09-24",
    "wallets": [
      {
        "chain": "base",
        "address": "0xe45ab753c9fe96913b1e221e472426770771a95a",
        "role": "deployer",
        "label": "Sender of the six observed registration transactions",
        "evidence": "All six successful transactions listed in docs/launchpads/receipts/catalyst-2026-09-24.json have this sender; read Base Blockscout 2026-09-24. Transaction sender is not a verified real-world identity."
      },
      {
        "chain": "base",
        "address": "0x4d958575d15cb719f1caf65af04c0fd749e63f69",
        "role": "launch-contract",
        "label": "Factory / launch transaction target",
        "evidence": "Catalyst mint recipient and launch transaction target in https://base.blockscout.com/tx/0xf38e2e43e485ab243f6cd047aee077cee0595fad103169c905c1339428bd0ae0; read 2026-09-24. No custody or controller inference."
      },
      {
        "chain": "base",
        "address": "0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "role": "launch-contract",
        "label": "Market registry",
        "evidence": "MarketRegistered event, log 61 in https://base.blockscout.com/tx/0xf38e2e43e485ab243f6cd047aee077cee0595fad103169c905c1339428bd0ae0; read 2026-09-24. No custody or controller inference."
      },
      {
        "chain": "base",
        "address": "0xfd2823fbf019e9d4a121544590e00705fdae80f0",
        "role": "launch-contract",
        "label": "Liquidity seeder",
        "evidence": "ModifyLiquidity sender in logs 64\u201371 and MarketSeeded emitter at log 73 in https://base.blockscout.com/tx/0xf38e2e43e485ab243f6cd047aee077cee0595fad103169c905c1339428bd0ae0; read 2026-09-24. No custody or controller inference."
      },
      {
        "chain": "base",
        "address": "0x0d5d83c5a1d27654d12670bb07461971a5aba8cc",
        "role": "launch-contract",
        "label": "Pool hook",
        "evidence": "Initialize hooks field in log 62 in https://base.blockscout.com/tx/0xf38e2e43e485ab243f6cd047aee077cee0595fad103169c905c1339428bd0ae0; read 2026-09-24. No custody or controller inference."
      }
    ],
    "accounts": [],
    "launches": [
      {
        "chain": "base",
        "address": "0xca7a1e31b36779cf32acb18714ab26982cf36b05",
        "symbol": "CATALYST",
        "name": "CATALYST",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0xf0bac62dd4fd04dc26c9bc9ded68f16c515ab71c09bb87e8e546b7ce83c0ccb9; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0xf38e2e43e485ab243f6cd047aee077cee0595fad103169c905c1339428bd0ae0, block 51681332, registry log 61, 2026-09-23T08:26:51.000000Z; successful sender/target read 2026-09-24."
      },
      {
        "chain": "base",
        "address": "0xca7a365c7f33a04874ff621bd6b68043c034014e",
        "symbol": "APPLEOG",
        "name": "APPLEOG",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0xe69166e6da4b5cbbb9d7f2b6f9bb9b56a26d58f587c16cb465180a33ccc3135f; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0xbdf5bda7d907344c2d8f20105d6083177707775f58553266b3d4a26976e576b5, block 51696917, registry log 129, 2026-09-23T17:06:21.000000Z; successful sender/target read 2026-09-24."
      },
      {
        "chain": "base",
        "address": "0xca7a011bd9d2c2aa82a4367c71e713ea0e78f75d",
        "symbol": "MUSEVERSE",
        "name": "MUSEVERSE",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0xc50d25dccf38db0e3d2714b748f21937dac37b2ec1e37c9c53a6e0e52d7bf0e7; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0x33c0cb2cf6bade6593b3f1722e4f608f9900c76bb04fa0d89f698c3031847a2e, block 51697158, registry log 664, 2026-09-23T17:14:23.000000Z; successful sender/target read 2026-09-24."
      },
      {
        "chain": "base",
        "address": "0xca7ac088485c7c68f81eb60614f200797905aaa2",
        "symbol": "BASEDPRIVACY",
        "name": "BASEDPRIVACY",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0x5c3e216e0629d47f3e1d75bcc5e58923dab108494379f937bd4af607d70b5203; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0xe1705f079a97168a913c3ec3b975b996d15cc82e5c9d33482de3935c93d43b89, block 51697539, registry log 871, 2026-09-23T17:27:05.000000Z; successful sender/target read 2026-09-24."
      },
      {
        "chain": "base",
        "address": "0xca7ae68bbc9437cd5b93e543533b7a8e375d66bc",
        "symbol": "GROKCOIN",
        "name": "GROKCOIN",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0xda8fb1006b6838f3435aa7e6266860dcaf2606300391e3005e7326cbbfa334f7; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0x7a8cf60d88cefebdd585393d772b0c6e1c821acb3b0f658a1e8cdc5760303f37, block 51698300, registry log 577, 2026-09-23T17:52:27.000000Z; successful sender/target read 2026-09-24."
      },
      {
        "chain": "base",
        "address": "0xca7a548d5a73bb396fafe229447643ef1082fe0d",
        "symbol": "BASEDGPUS",
        "name": "BASEDGPUS",
        "launchedAt": "2026-09-23",
        "venue": "Unnamed Base suite, registry 0x98c9c7e416977ae5585595ef530bb05f1c7dd3f3",
        "outcome": "unestablished",
        "note": "Observed market registration with pool ID 0xe025a4f7554cab8213cabebfde59511316d7283a3e99596ad82f1968940a76cc; lifecycle, custody, creator fees and trading conduct remain unverified.",
        "evidence": "https://base.blockscout.com/tx/0x9c8773cb1a7fba82e1f74cdd6c57e4ba4903826a3344406fc407c69a187c675b, block 51698390, registry log 368, 2026-09-23T17:55:27.000000Z; successful sender/target read 2026-09-24."
      }
    ]
  },
  {
    id: "rh-lemonfun-fee-farm",
    name: "$LEMON (Lemon.fun) creator fee farm",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "The same in-token fee model as rh-wirebot-fee-farm, on the same launchpad family, one week earlier. The launch was clean on its mechanics: no bonding curve, the full billion straight to the pair, and the deployer bought 2.0 percent in the launch transaction for 0.028 ETH. The extraction is the fee stream the launchpad pays in the token: 46,881,851 tokens, 4.69 percent of supply, arrived at the deployer across roughly 396 payments. The deployer holds none of it. It burned 10,000,000 and pushed the remaining 57M out to five wallets, four of which forwarded everything to the swap router 0xbdbae060 and one of which sold 22.8M straight into the pair. All five are empty or near empty now. Tagged nefarious on the same basis as the wire bot record: continuous extraction paid in the token, sold into the token's own market through intermediaries, with the deployer's own sell record left clean. The 1 percent burn is the one point in the operator's favour.",
    firstSeen: "2026-07-25",
    lastSeen: "2026-09-20",
    wallets: [
      { chain: RH, address: "0x2f75a321b571006ac11674aa7bbda890e16d6c25", role: "deployer", label: "creator wallet: claims the fee stream, distributes, never sells directly", evidence: "sent launch tx 0x48a82224ef11e3b49902c03f962bb64a74fd828b843774a18883c31e0759104d to factory 0x2ba793fd at 2026-07-25 12:46:57 UTC paying 0.028 ETH and receiving 20,037,911 tokens (2.0%) from the pair; received 46,881,851 more from fee contract 0xc10309cf03bc81c121a8270e3a28e159a9296903 across 398 inbound transfers; sent all 66,932,210 back out in 10 transfers; nonce 1,913, holds 0 tokens, read 2026-09-20" },
      { chain: RH, address: "0xd120c6eeb3024721908dfe641689350323c90301", role: "off-ramp", label: "largest fee recipient", evidence: "received 20,000,000 from the deployer and forwarded 10,000,000 to router 0xbdbae060 and 9,922,223 onward; holds 0, read 2026-09-20" },
      { chain: RH, address: "0x5655e9bfdbce8d4a73ead52a6afb9df5002888f7", role: "off-ramp", label: "fee recipient, routed out in full", evidence: "received 12,433,831 from the deployer and sent 14,257,514 to router 0xbdbae060; holds 0, read 2026-09-20" },
      { chain: RH, address: "0x880efd2803ad382963fef923cb714226e2840555", role: "off-ramp", label: "fee recipient, routed out in full", evidence: "received 10,000,000 from the deployer and sent 10,000,000 to router 0xbdbae060; holds 0, read 2026-09-20" },
      { chain: RH, address: "0x851dc4d0a2c03b08c0c748bc16a1a52dbc1316ca", role: "off-ramp", label: "fee recipient, routed out in full", evidence: "received 10,000,000 from the deployer and sent 10,874,779 to router 0xbdbae060; holds 0, read 2026-09-20" },
      { chain: RH, address: "0xef2c099803fff879443009722aa2b9c46e020ab6", role: "off-ramp", label: "fee recipient that sold straight into the pair", evidence: "received 4,420,676 from the deployer and sent 39,510,017 out in total, of which 22,819,498 went directly into the pair 0x01fe057d; EIP-7702 account, holds 262,594, read 2026-09-20" }
    ],
    accounts: [
      { handle: "lemondotfun", role: "project", label: "Lemon.fun project account", evidence: "the token's listed X account, with a Telegram at t.me/lemondotfun, carried on the DexScreener pair for 0xf0e17e54 (read 2026-09-20)" }
    ],
    launches: [
      { chain: RH, address: "0xf0e17e54239cd945cd7bea471a3a2ca6a8c7f7a3", symbol: "LEMON", name: "Lemon.fun", launchedAt: "2026-07-25", venue: "unknown factory 0x2ba793fd69bf251fd1af90b576be8b9fa6be46db", outcome: "fee-farmed", note: "No bonding curve: the full 1,000,000,000 went to the pair inside the launch transaction, and the deployer's only allocation was the 2.0 percent it bought there. About 255,000 USD fully diluted against 61,200 USD of liquidity, down 20 percent on the day of the read. The fee stream is 4.69 percent of supply and has been sold through five intermediary wallets; 1 percent was burned.", evidence: "launch transaction and Transfer logs read from Robinhood RPC on 2026-09-20; launch block 19,020,802 located by timestamp binary search; deployer, fee contract and recipient flows traced by topic-filtered getLogs across blocks 19,020,802 to 67,950,000; DexScreener for market state" }
    ],
    related: ["rh-wirebot-fee-farm"]
  },
  {
    id: "base-b20-serial-launcher-58d0fdcb",
    name: "Base B20 and o1 serial launcher",
    kind: "launch-farm",
    intent: "unestablished",
    summary: "One Base wallet has pushed 35 tokens through the B20 and o1 factories between 2026-07-17 and 2026-09-15, and lives on the creator fee stream those factories pay in ETH. Thirty-two of the 35 were abandoned at the mint with no live pair and single-digit holder counts; only O1DOLL, Sparkplug and Zuckasaurus trade at all, and only O1DOLL has real depth. The names lean on borrowed identity, including ELON, COINBASE, COBIE and BALD, and several are launched twice within days of each other, such as TRILLIONS, BAPU and MACBOOK. Income is 10.08 ETH across 125 fee claims measured by balance delta, swept to one controller wallet that has taken 13.36 ETH from it. What is absent is extraction from holders: no allocation at any launch, fees paid in ETH rather than in the tokens, and no trace of the deployer holding or selling its own launches. Recorded as unestablished rather than nefarious for that reason. The volume and the borrowed names are the reason it is indexed at all, so the next launch from this wallet is recognised.",
    firstSeen: "2026-07-17",
    lastSeen: "2026-09-20",
    wallets: [
      { chain: BASE, address: "0x58d0fdcb58a82a0eae59bd1487dfc5b71f88abfc", role: "deployer", label: "serial launcher and fee claimant", evidence: "sender of 35 createLaunch transactions across the B20 factories 0xa52ad458 and 0xff70918e and the o1 factory 0x1176122e between 2026-07-17 and 2026-09-15; 125 fee claims on the escrows 0xa2cbd906 and 0x1d8c991a delivering 10.0776 ETH measured by balance delta at each claim block; holds 0.0366 ETH; its only token flows are the METAc quote asset and address-poisoning spam, never its own launches, read 2026-09-20" },
      { chain: BASE, address: "0x85ce096548ead95e625d37e1a711baa817e8ed7b", role: "off-ramp", label: "controller wallet that funds the deployer and receives the fees", evidence: "received 13.3592 ETH from the deployer and sent it 0.015 ETH back; note two address-poisoning lookalikes appear in the deployer's counterparty list, 0x85ceef797763b8d1706b34895871229ba765ed7b and 0x85cea55c82a5b4f52192f76761125d4f6fd41d7b, which mimic this address at both ends and are not it; read 2026-09-20" }
    ],
    accounts: [],
    launches: [
      { chain: BASE, address: "0xb200000000000000000000986020255bd8315b01", symbol: "ELON", name: "Space Man", launchedAt: "2026-07-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-07-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000f558106335ebad8401", symbol: "COINBASE", name: "The Everything Exchange", launchedAt: "2026-07-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 2 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-07-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000002616193cac026fda01", symbol: "D", name: "D coin", launchedAt: "2026-07-27", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 2 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-07-27; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000007f2fbd4594ac5e4601", symbol: "Sparkplug", name: "Base cat", launchedAt: "2026-08-15", venue: "b20-launchpad 0xa52ad458", outcome: "organic", note: "81 holders, about 11,200 USD of liquidity, barely trading", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-15; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb20000000000000000000058b36c53255fcb5f01", symbol: "Trillions", name: "Trillions", launchedAt: "2026-08-16", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-16; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000e3daccc2dddd09d501", symbol: "Catslam", name: "Catslam Makhachev", launchedAt: "2026-08-16", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-16; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000002973890049ec3aad01", symbol: "BASESZN", name: "Base Szn", launchedAt: "2026-08-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 7 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000005b978da30e6f2e6201", symbol: "unnamed", name: "unnamed B20 token", launchedAt: "2026-08-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000767cfe0d53ca049601", symbol: "unnamed", name: "unnamed B20 token", launchedAt: "2026-08-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000fe053f82506f0f0d01", symbol: "COBIE", name: "BaseApp Man", launchedAt: "2026-08-17", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 3 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-17; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000001e4c69d5e5e4b12501", symbol: "BALD", name: "Believe in Bald", launchedAt: "2026-08-18", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-18; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000002e646b86580db31e01", symbol: "BUILDER", name: "Base Builder", launchedAt: "2026-08-18", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 2 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-18; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000d5b21475e86cc82201", symbol: "BULL", name: "Base Bull", launchedAt: "2026-08-18", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-18; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb20000000000000000000062effc15271a3ea401", symbol: "Augup", name: "Augup", launchedAt: "2026-08-19", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-19; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000d5c9729ae132e64701", symbol: "Upgust", name: "Upgust", launchedAt: "2026-08-19", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-19; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000a061ba52ee15e9a001", symbol: "O1DOLL", name: "O1 Doll", launchedAt: "2026-08-20", venue: "b20-launchpad 0xa52ad458", outcome: "organic", note: "319 holders, about 43,900 USD of liquidity and 107,000 USD fully diluted, the only one of the 35 with real depth", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-20; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000ef3f917982266f8901", symbol: "CATE", name: "Catecoin", launchedAt: "2026-08-21", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 1 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-21; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000f3283573ce61ab7401", symbol: "Cate", name: "Cate coin", launchedAt: "2026-08-21", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 1 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-21; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb20000000000000000000028c8b2d67229903601", symbol: "CATS", name: "Cats", launchedAt: "2026-08-23", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 1 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-23; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000000ba21fd556a9ceea01", symbol: "Hit", name: "Base hit", launchedAt: "2026-08-28", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 4 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-28; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000a4375986a894d52801", symbol: "Agent", name: "Call my agent", launchedAt: "2026-08-28", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 2 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-28; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000be7f96503f4cc07f01", symbol: "unnamed", name: "unnamed B20 token", launchedAt: "2026-08-28", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the b20 factory on 2026-08-28; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000dc6b015769cc69ec01", symbol: "Zuckasaurus", name: "Zuckasaurus", launchedAt: "2026-08-28", venue: "b20-launchpad 0xff70918e", outcome: "organic", note: "52 holders, about 11,300 USD of liquidity and 367 USD of daily volume; named after a Facebook privacy mascot, its only listed link is a news article, and the deployer never appears in its transfer ledger", evidence: "createLaunch from 0x58d0fdcb via the b20-v2 factory on 2026-08-28; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000501ad7a2dd5be9f301", symbol: "AiFi", name: "AiFi", launchedAt: "2026-09-01", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-01; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000007fcb1c81ac966bc501", symbol: "TRILLIONS", name: "Trillions", launchedAt: "2026-09-01", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-01; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000e432e6f021ecae3b01", symbol: "TRILLIONS", name: "Trillions", launchedAt: "2026-09-01", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-01; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000296c1d94e84d0f4b01", symbol: "BAPU", name: "BaseApu", launchedAt: "2026-09-03", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-03; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000002d029a14a4aff5f401", symbol: "unnamed", name: "unnamed B20 token", launchedAt: "2026-09-03", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-03; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000407de45bb3444ad001", symbol: "BAPU", name: "Blue Apu", launchedAt: "2026-09-03", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-03; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000f039966fa8ecc90401", symbol: "MIM", name: "Magic Internet Money", launchedAt: "2026-09-03", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-03; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000002a55c3bbaf8fcbb701", symbol: "MACBOOK", name: "Hunter Biden's Macbook", launchedAt: "2026-09-09", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-09; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb2000000000000000000008ac24c56ce4e08aa01", symbol: "MO", name: "Hunter Biden's Dog", launchedAt: "2026-09-09", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-09; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000c907224c1a0963b401", symbol: "MACBOOK", name: "Macbook", launchedAt: "2026-09-09", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-09; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb200000000000000000000418972026830771d01", symbol: "Cashdog", name: "Cashdog", launchedAt: "2026-09-15", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-15; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" },
      { chain: BASE, address: "0xb20000000000000000000085240c01dbceed2401", symbol: "CashDoge", name: "CashDoge", launchedAt: "2026-09-15", venue: "o1", outcome: "unestablished", note: "Abandoned at the mint: 0 holders and no live pair a month on.", evidence: "createLaunch from 0x58d0fdcb via the o1 factory on 2026-09-15; token metadata and holder count from Base Blockscout, market state from DexScreener, both read 2026-09-20" }
    ]
  },
  {
    id: "rh-wirebot-fee-farm",
    name: "$wire (wire bot) creator fee farm",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "A Robinhood Chain token whose operator lives on the launchpad's creator fee stream, paid in the token itself and sold back into the token's own market through two intermediary wallets. The launch mechanics were clean: no bonding curve, the full billion went straight to the pair, the deployer bought 1.44 percent in the launch transaction and took no allocation, and there is no honeypot, no tax and no liquidity pull. What followed is the record: the deployer has claimed 84.3M tokens, 8.43 percent of supply, in 210 payments worth about 52,000 USD at the prices on the days they arrived, and was still claiming on 2026-09-20. It has never sold a token itself. It forwards to a sink wallet that sells into the pair and passes the rest to a second wallet that also sells, together about 78,000 USD at sale-time prices. Indexed nefarious for the combination of continuous extraction at that scale and the two-hop routing that leaves the deployer's own sell record empty, which is what separates it from a creator who simply claims fees. Holders are the counterparty to the stream, and the token is down 99 percent from its peak. The judgement is on the operator, not the launch: the 84 percent fall across 2026-09-18 and 09-19 was 886 wallets selling, not an operator dump.",
    firstSeen: "2026-07-17",
    lastSeen: "2026-09-20",
    wallets: [
      { chain: RH, address: "0xfe4b46c8dbdf982a4f68c5268de440d1db790920", role: "deployer", label: "creator wallet: claims the fee stream, never sells", evidence: "sent launch tx 0x274e45dc79f3b3074cc262d95d81034afdd85ac717c432e685094d7b0df0c1ff to factory 0x0c37a24f at 2026-07-17 19:04:11 UTC paying 0.0205 ETH and receiving 14,395,208 tokens (1.44%) from the pair; received 84,349,332 tokens in 210 payments from fee contract 0x31ca5e10; its visible transaction history is 260 fee claims plus one setFeeRedirect call; forwarded 63,661,037 to 0xf7b84493; zero attributed sales into the pair across 314,399 transfers; holds 0 tokens and 0.0004 ETH, read 2026-09-20" },
      { chain: RH, address: "0xf7b844930315e6b0b20268ec0f69553232eafcd0", role: "off-ramp", label: "first-hop wallet that sells the fee stream", evidence: "received 63,661,037 tokens from the deployer; 71,163,310 attributed sales into the pair worth about 25,100 USD at sale-time prices, and forwarded 43,420,226 to 0xa58bdd0a; EOA, nonce 185, holds 0, read 2026-09-20" },
      { chain: RH, address: "0xa58bdd0ab5ebbb8dc425090fea8fd0ba969c1668", role: "off-ramp", label: "second-hop seller", evidence: "received 43,420,226 tokens from 0xf7b84493 and sold 84,887,615 directly into the pair, about 53,300 USD at sale-time prices, read 2026-09-20" }
    ],
    accounts: [
      { handle: "wirebotRH", role: "project", label: "$wire (wire bot) project account", evidence: "the token's listed X account, with a Telegram at t.me/rh_wirebot, carried on every DexScreener pair for 0x8ecea3d0 (read 2026-09-20). Not to be confused with a separate token also called Wire, 0x15f3d1ba06aeeb26470bf4995305f58082a20859, account wireonrh, launched on the same chain 2026-09-18 and unrelated to this cluster." }
    ],
    launches: [
      { chain: RH, address: "0x8ecea3d0e648db646d824aa51eedeb16ac3d6878", symbol: "wire", name: "wire bot", launchedAt: "2026-07-17", venue: "unknown factory 0x0c37a24f5d23a486fa692d1500881d698b1f77a4", outcome: "fee-farmed", note: "No bonding curve: the full 1,000,000,000 supply went to the pair inside the launch transaction. Peaked 2026-07-21 and is down 99 percent from there, including 84 percent across 2026-09-18 and 09-19 on rising volume. That fall was dispersed across 886 selling wallets with the top ten at 29.5 percent, and the deployer sold nothing in the window, so the fee stream is a persistent drag rather than the trigger. Over the token's life 12,378 wallets have sold with the top ten at 9.7 percent of flow, the pair holds 25.6 percent of supply and 3,912 wallets carry a balance. The factory has launched roughly 1,896 tokens.", evidence: "314,399 transfers read from Robinhood RPC logs over blocks 12,356,072 to 67,869,616 on 2026-09-20; sales attributed by walking router hops inside each transaction after classifying every busy address with eth_getCode; GeckoTerminal daily and hourly candles for the price path" }
    ]
  },
  {
    id: "base-b20-basecat-creator",
    name: "BaseCat creator's Base launch series",
    kind: "launch-farm",
    intent: "benign",
    summary: "One Base wallet deployed fourteen tokens in seven weeks and lives on creator fees rather than on token supply. Ten were abandoned at the mint with no pool and no transfers, two launches never traded, one collapsed, and one, BASECAT, became a real market. The operator has claimed 233 ETH of BASECAT creator fees and swept 244 ETH to a second wallet that bridges off Base through Relay. What is absent is the usual farm behaviour: no creator allocation at any launch, no self-snipe, no sale into any of his own tokens, and on the apple-emoji launch he spent essentially all of the fee income buying the token back and burning it. Indexed as benign because nothing in the flows shows holders being sold into; the record is here because the scale of the fee extraction and the ten-token deployment pattern are worth recognising on the next launch.",
    firstSeen: "2026-07-21",
    lastSeen: "2026-09-17",
    wallets: [
      { chain: BASE, address: "0x48c7ab8f293d0c55fd4a95764ffabcfddc240faf", role: "deployer", label: "creator of all fourteen tokens and the fee recipient", evidence: "sole sender of every createLaunch and deployToken call in its 572-tx history (2026-07-18 to 2026-09-17); receives creator fees via 169 claims on the B20 fee escrow 0xa2cbd906 totalling 233.234 ETH measured by balance delta, plus 17.62 AAPLc on the o1 launch; holds 0.0097 ETH and no token balances, read 2026-09-17" },
      { chain: BASE, address: "0x60578f65353cb00d5b6834ce2cc39b816df74fcc", role: "off-ramp", label: "sweep wallet, 500 ETH in and 496 ETH out", evidence: "received 243.85 ETH from the creator across 95 transfers 2026-08-16 to 2026-09-17 and 179.61 ETH from the Relay solver; forwarded 232.51 ETH to the RelayDepository 0x4cd00e38 and the rest to 39 other addresses; Blockscout tx history read 2026-09-17" }
    ],
    accounts: [],
    launches: [
      { chain: BASE, address: "0x3115ee557dcbe36e95beb132ed570dd2adeb06b4", symbol: "Comma club", name: "triple comma club", launchedAt: "2026-07-21", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x1d30a3d803376db3d0e449d24b0ce8c86111f444", symbol: "154,279,092", name: "154,279,092", launchedAt: "2026-07-21", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x0c0d7808763703b60c99ee68790f184677a5224d", symbol: "corgi cafe", name: "corgi cafe", launchedAt: "2026-07-22", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x01c54fa7bef071195cdd22298c0fa3476540a9fe", symbol: "Based Jimothy", name: "Based Jimothy", launchedAt: "2026-07-23", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x313cb52b8f5b03813f7566a728522613659487ab", symbol: "BSC", name: "Bitcoin Security Consortium", launchedAt: "2026-07-23", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x0e0e9a8e17c8703834e83335e0a3431a78060eab", symbol: "US500", name: "US500", launchedAt: "2026-07-30", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x0251e5b197726550e12d4dfe78ce73536186b36b", symbol: "Tenders", name: "Chicken tenders", launchedAt: "2026-07-31", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x355aef5a9a70d871df95c6790805056621ff6178", symbol: "Base app cat", name: "Base app cat", launchedAt: "2026-08-11", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x3a00113239029e57f36785890cf06fbd48f0eb68", symbol: "Pipe", name: "Based pipe", launchedAt: "2026-08-12", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0x36be58b068a75a7f23ea79e3a0dd9cb16f802268", symbol: "Plumber", name: "Plumber", launchedAt: "2026-08-12", venue: "unknown factory 0xb1900f41", outcome: "unestablished", note: "Deployed with a 1,000,000,000 supply and then abandoned: no pool, no market, and not one transfer after the mint.", evidence: "creation call from 0x48c7ab8f to 0xb1900f41 read 2026-09-17; Blockscout token counters show 0 transfers and 0 to 2 holders" },
      { chain: BASE, address: "0xb200000000000000000000d3677a2bddb1184d01", symbol: "Plumbing", name: "Plumbing", launchedAt: "2026-08-12", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "Reached a pool but never a market: 44 holders, about 11,400 USD of liquidity and no daily volume a month later.", evidence: "createLaunch tx 0xd7d9e08f\u2026 2026-08-12 00:47 UTC; DexScreener and GeckoTerminal read 2026-09-17" },
      { chain: BASE, address: "0xb200000000000000000000c10035691f52d62601", symbol: "Absolute", name: "Absolute bald", launchedAt: "2026-08-12", venue: "b20-launchpad 0xa52ad458", outcome: "unestablished", note: "13 holders and no live pool; the launch never traded.", evidence: "createLaunch tx 0xc2b77d01\u2026 2026-08-12 02:24 UTC; Blockscout token page read 2026-09-17" },
      { chain: BASE, address: "0xb2000000000000000000004c27f6523082f41d01", symbol: "BASECAT", name: "Basecat", launchedAt: "2026-08-15", venue: "b20-launchpad 0xa52ad458", outcome: "organic", note: "The one launch of the series that held: 4,720 holders, about 615,000 USD of liquidity and 487,000 USD of daily volume a month on, with the price up on the day. The creator never held or sold a single BASECAT token; his entire take is the creator fee stream of 233 ETH.", evidence: "createLaunch tx 0xa3416ee4\u2026 2026-08-15 18:03 UTC; 169 fee claims 2026-08-15 to 2026-09-17 measured by balance delta at each claim block; GeckoTerminal read 2026-09-17" },
      { chain: BASE, address: "0xb200000000000000000000d6af5c3d433de36601", symbol: "APPLE-EMOJI", name: "apple emoji token (name and symbol are the apple emoji)", launchedAt: "2026-09-08", venue: "o1", outcome: "organic", note: "Paired against AAPLc, the tokenized Apple stock, rather than ETH. Peaked five hours after the 16:55 UTC launch and is down 97.6 percent from that high. The collapse was launch snipers flipping, not the operator: sales attribute to 1,415 wallets with the top ten holding only 11 percent, and the creator sold nothing. He instead spent 16.87 of his 17.62 AAPLc of fees buying 39,119,746 tokens back off the market and burning them, which is 3.91 percent of supply now sitting at the burn address.", evidence: "createLaunch tx 0x8905e2ed\u2026 2026-09-08 16:55 UTC; 15,866 transfers merged from Base RPC logs and Blockscout over blocks 51047087 to 51442136, read 2026-09-17; burn balance confirmed by balanceOf" }
    ]
  },
  {
    id: "rh-machi-taiwan",
    name: "Machi Big Brother's $TAIWAN launch",
    kind: "launch-farm",
    intent: "unestablished",
    summary: "Jeffrey Huang, @machibigbrother, deployed $TAIWAN on Robinhood Chain from his public wallet machibigbrother.eth on 2026-08-31 and announced it on X the next day as 'Taiwan Coin paired with Taiwan Semiconductor Manufacturing', then on 2026-09-03 as 'my Mona Lisa'. He took no allocation at the mint: the full billion went to the launch hook and he bought his position on the open market. He then promoted the token on FOMO while buying, and began selling nine days after launch. Every sale from the FomoScan-verified wallet bridged to Solana as USDC, and two of the four Solana tokens he posted theses about on 09-13 and 09-14 were first acquired by his Solana wallet after those proceeds landed. He has since fully exited. On 2026-09-19 he claimed 5,886,504 tokens, 0.59 percent of supply, as creator fees from the launchpad fee contract, and in the same hour bought 19,108,118 more through the Robinhood app, moving the price up 27 percent on 36,158 USD of volume. On 2026-09-23 00:00 UTC he sold the entire 33,994,623 in one transaction, routed into TSM and out as 27,125 STANDARD worth about 5,350 USD, and the price did not move. The FomoScan wallet emptied its last 8,000,001 through the Relay router between 09-18 and 09-20. Both wallets now hold zero; only the 1,000,000 parked in a fresh EOA on 09-07 remains. Across the two wallets he acquired 49,909,964 tokens, 5.0 percent of supply, and has sold all of it. Intent stays unestablished, not nefarious: he claimed a fee stream and is now the largest single seller on the token, but he is still roughly 15,000 USD down on it overall, he posted nothing about it during the exit window, and the 92 percent collapse happened on 09-11, twelve days before he sold. The selling that took the token down 92 percent from its peak was dispersed across 5,373 wallets, with the top ten accounting for 6.6 percent of sell flow and his own wallet ranked 238th.",
    firstSeen: "2026-08-31",
    lastSeen: "2026-09-23",
    wallets: [
      { chain: RH, address: "0x020ca66c30bec2c4fe3861a94e4db4a498a35872", role: "deployer", label: "machibigbrother.eth, the public wallet that launched $TAIWAN", evidence: "sent the launch tx 0xccbfd848a241472a46ae0a640eb0e59946e7580ac22393521a678ab79db7fd1d to factory 0x22e99278 at 2026-08-31 17:46 UTC, which minted 1,000,000,000 to hook 0xeb7c0347; ENS forward resolution of machibigbrother.eth returns this address; bought 10,435,660 tokens through the swap hub on 09-03 and 09-04, sold 435,660 on 09-07 08:40 and moved 1,000,000 to the fresh EOA 0x5fc7030f875851fd6fe4c8f199b009b1908b9ef4 (nonce 0, still holds them). On 09-19 07:18 it received 5,886,504 as creator fees from Doppler's initializer 0x4e346895 (LONG's creator-fee path), contradicting the earlier read that there was no creator income, then bought 19,108,118 in six transactions through RobinHoodSettler 0x6aa80dbb between 07:36 and 07:45, taking the hourly candle from 0.00014663 to 0.00018609. On 09-23 00:00:34 UTC it sold all 33,994,623 in tx 0x3bbdc03e92a90858e5cfb4f929df8546f0e11e8ef30a46d3108c3e2a8a4ada84, receiving 27,125.467 STANDARD (0x88ad8ddf1e3898412146a534538d418c6f8a9062, about 5,350 USD); that single sale is 17.3 percent of all sell flow into the pool between 09-17 and 09-23. Holds 0 TAIWAN and 0.1308 ETH, down from 2.30, read 2026-09-23" },
      { chain: RH, address: "0x3205c07eb8d4f59fa709d64ca68c51d427094be4", role: "kol-wallet", label: "FomoScan-verified trading wallet of FOMO account machibigbrother", evidence: "FomoScan record for FOMO account machibigbrother, display name Machi Big Brother (read 2026-09-17; FOMO stores no X link, so the binding rests on the account name, and no direct transfer links this address to machibigbrother.eth). EIP-7702 account, Simple7702Account delegate 0xe6cae83b. Bought 14,479,681 $TAIWAN in 20 buys 09-01 to 09-07 for about 12,825 USD and sold 6,479,680 in six sales 09-09 13:51 to 09-17 11:18 for about 3,563 USD, each sale routed $TAIWAN into TSM and bridged to Solana as USDC (Relay requests, 1,206.42 USDC total). It then emptied the remaining 8,000,001 through the same Relay router in four transfers on 09-18 13:17, 09-18 16:29, 09-20 13:05 and 09-20 16:32. Total in and total out are both 14,479,681; holds 0 TAIWAN and 0 ETH, read 2026-09-23" },
      { chain: SOL, address: "CvmrvyKfkJQtGNVKzaJ6H337CN9F2vxrLsZZnmjP2omq", role: "kol-wallet", label: "FomoScan-verified Solana wallet, destination of the $TAIWAN sale proceeds", evidence: "FomoScan record for FOMO account machibigbrother (read 2026-09-17); holds all four Solana tokens he posted theses about on 09-13 and 09-14, of which HneTUS79 was first acquired 09-10 17:22 and AmPojoiS 09-12 22:04, both after the 09-09 and 09-10 $TAIWAN sales bridged in" }
    ],
    accounts: [
      { handle: "machibigbrother", role: "kol", label: "Jeffrey Huang, 223.4k followers on X, creator and promoter of $TAIWAN", evidence: "X posts 2026-09-01 'Taiwan Coin paired with Taiwan Semiconductor Manufacturing' and 2026-09-03 'I am addicted to creating coins but I have now created my Mona Lisa. $TAIWAN'; FOMO theses on the token 09-06 16:57 'We are building the world's largest $TSM reserve. Long your longs.' and 09-07 04:03 'There is no ai without Taiwan', posted while buying and two days before he began selling; neither of his wallets holds any TSM, so the reserve being built sits in the pool, not with him; read 2026-09-17" }
    ],
    launches: [
      { chain: RH, address: "0xaa0b48defde440b8445ba45db88cb076cf261e18", symbol: "TAIWAN", name: "Taiwan Coin", launchedAt: "2026-08-31", venue: "LONG (app.long.xyz), LongLauncher 0x22e99278308b393ea1260859b181ad7e78f5eeed over the Doppler Airlock 0xeb7c0347; the creator fee is paid by Doppler's initializer 0x4e346895 in both pool tokens", outcome: "organic", note: "Paired against tokenized TSM rather than ETH. Peaked 20 hours after launch and is down 92 percent from that high, at about 104,000 USD of liquidity and a 146,000 USD valuation on 2026-09-23. No allocation at the mint and no self-snipe, but the launchpad did pay the creator 5,886,504 tokens in fees on 09-19. The 92 percent decline came from dispersed selling across 5,373 attributed wallets, top ten at 6.6 percent of flow, and the single worst day was 09-11, when the price fell from 0.00071 to 0.00019. The creator's own selling began 2026-09-09 and finished on 09-23; in the 09-17 to 09-23 window he is the largest single seller at 17.3 percent of sell flow, against 195,953,724 sold and 175,339,298 bought across about 69 and 65 wallets.", evidence: "156,948 transfers merged from Robinhood RPC logs over blocks 51,053,350 to 65,718,843, read 2026-09-17; sales attributed by walking router hops inside each tx; GeckoTerminal hourly candles for the price path" }
    ]
  },
  {
    id: "rh-meme-amc",
    name: "A Meme Coin ($MEME) and its AMC campaign",
    kind: "launch-farm",
    intent: "unestablished",
    summary: "$MEME launched on Robinhood Chain on 2026-09-03 through factory 0x22e99278, the venue behind $TAIWAN, and on 2026-09-19 repositioned itself as a campaign to 'Fix AMC' ahead of AMC's 2026-09-24 annual meeting. Distribution is the flattest indexed on this chain: 31,023 holders, the top ten non-pool holders at 14.96 percent of supply, no creator allocation and no launch-block snipe. The deployer bought 1.18 percent of supply for 0.1 ETH 37 seconds after launch and has drawn a recurring creator fee paid in the token, 5.01M across 28 claims through 2026-09-21. It never sold from its own address. It forwarded 17.62M to intermediaries that are now empty: 5.0M sold into the pool, 0.47M sold through the Robinhood app settler, 6.08M bridged out through Relay. That is the same routing as rh-wirebot-fee-farm and rh-lemonfun-fee-farm. Intent is recorded as unestablished, not nefarious, because the stream is small, 0.50 percent of supply against 4.69 and 8.43 percent on those two, and holders have not been sold into at scale. No project address holds tokenized AMC in any meaningful amount, so the campaign is not backed by a position that could be voted.",
    firstSeen: "2026-09-03",
    lastSeen: "2026-09-21",
    wallets: [
      { chain: RH, address: "0xa72a5b06927badb020d235f5f43ce56507ab2399", role: "deployer", label: "$MEME deployer and creator-fee recipient", evidence: "sent launch tx 0x75c36932619070f16f65bd7d252f689a4e6cf7d170a99ee72774d56f4315e41e (block 53,697,172, 2026-09-03 20:30 UTC) to factory 0x22e99278, which minted 1,000,000,000 to hook 0xeb7c0347; bought 11,816,778 at block +371 in tx 0xc72f60f08d9133d698b396381e56c04cb2a8afe6dbf04d083bdedc9cc81e478d, 0.1 ETH through RelayRouterV3 0xb92fe925; received 5,010,685 in 28 creator-fee claims (selector 0x817db73b) from Doppler's initializer 0x4e346895, LONG's creator-fee path, between 2026-09-04 and 2026-09-21; 17,940,485 in, 17,621,349 out, zero sent to the pool; holds 319,135 and 0.11 ETH, nonce 100, read 2026-09-21. Also holds 1.08B NEB, 430M SIGNAL, 273M SCOUT, 249M TERRA and 98M SZN, none with any market." },
      { chain: RH, address: "0x8e74a2b037d29934d12c04becccb627a7883acb7", role: "farm", label: "$MEME forwarding wallet A, sold into the pool", evidence: "received 12,029,478 from the deployer 2026-09-04 04:34 to 16:25; sent 5,000,000 to PoolManager 0x8366a39c in 15 transfers, 4,683,059 through proxy 0xdeadc0de, 1,846,419 through RelayRouterV3 and 500,000 to swap router 0xbdbae060, last transfer 2026-09-05 00:24; holds zero, read 2026-09-21" },
      { chain: RH, address: "0x8bc35bf8844123c93d8399f3c35f232ce201b328", role: "off-ramp", label: "$MEME forwarding wallet B, bridged out", evidence: "received 4,700,053, of which 3,296,638 from the deployer on 2026-09-04 and 09-05; sent 4,232,318 through RelayRouterV3 0xb92fe925 in 11 transfers and sold 467,735 through RobinHoodSettler 0x39b38686, last transfer 2026-09-05 03:49; holds zero, read 2026-09-21" }
    ],
    accounts: [
      { handle: "amemecoinrh", role: "project", label: "A Meme Coin project account, 12.3k followers, follows three", evidence: "listed on every DexScreener pair for 0x385f4f8a; pinned post 2026-09-19 'Today, A $MEME Coin gets a new mission. Fix @AMCTheatres.' quoting Vlad Tenev's 2026-09-14 post on voting for Robinhood Stock Tokens; 2026-09-20 post lists the 2026-09-24 AMC annual meeting; read 2026-09-21" }
    ],
    launches: [
      { chain: RH, address: "0x385f4f8ae47651ce5f58f5265395a669f8281e18", symbol: "MEME", name: "A Meme Coin", launchedAt: "2026-09-03", venue: "LONG (app.long.xyz), LongLauncher 0x22e99278308b393ea1260859b181ad7e78f5eeed over the Doppler Airlock 0xeb7c0347; LONG tokens carry the vanity suffix 1e18", outcome: "unestablished", note: "EIP-1167 clone of implementation 0x3be8b97f; one mint, no burns, no mint or rename function. Peaked at 0.063651 USD on 2026-09-13 and set a new low of 0.025312 on 2026-09-21, down 59 percent, with daily volume falling from 11.7M to 2.4M USD. About 2.0M USD of its 4.22M headline liquidity is the AMC/MEME pool, where MEME is the quote asset. Blockscout indexes the symbol as AMC while the contract returns MEME, so explorer balance views list it beside the real tokenized AMC 0x05a3d1cd.", evidence: "Blockscout holders, counters and per-address token transfers, and Robinhood RPC reads of name, symbol, supply and the mint log, all read 2026-09-21; GeckoTerminal hourly candles for pool 0x46525dc1 from 2026-09-13" }
    ]
  },
  {
    "id": "rh-volume-ring-2026-09-22",
    "name": "Robinhood Chain study direct-deployment cohort, September 2026",
    "kind": "launch-farm",
    "intent": "unestablished",
    "summary": "The handoff reported 31 tokens and 32 wallets. Its archived attribution snapshot actually contains 32 direct-deployment token records dated 2026-09-21 through 2026-09-23; all are indexed here alongside 33 reported deployer/funder wallets. This is a research cohort, not a proven single operator or wash-trading ring. High turnover, shared code sizes and names do not establish common control or malicious intent. Records retain the archived source and are not a fresh chain audit. The reported 31-token membership and underlying trading/identity evidence still need reconciliation. Do not automatically exclude this cohort from rankings.",
    "firstSeen": "2026-09-21",
    "lastSeen": "2026-09-23",
    "wallets": [
      {
        "chain": "robinhood",
        "address": "0x361bcf4b707695494db2b71f541af33776280876",
        "role": "hub",
        "label": "funder of two template-A deployers",
        "evidence": "first-funder of CRAIL's deployer 0x5b93b427 (0.2 ETH, 2026-09-22 12:29) and PROUTE's deployer 0xb016fc9c (0.2 ETH, 2026-09-22 18:38), read on Blockscout 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0xc96aa6ad793bc744beb11a9afd1813470ca194dc",
        "role": "hub",
        "label": "JEV's deployer, which also funds the template-B set",
        "evidence": "deployed JEV 0x675279fe on 2026-09-22 and sent 16.0916 ETH to RIG's deployer 0xef7659ed at 2026-09-22 17:11; NODIUM's deployer 0x2f10b576 was funded 12.8454 ETH the same evening; read on Blockscout 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0x37aafcf68fbb35ad01c4bd2e92feced835f62525",
        "role": "deployer",
        "label": "PGREM deployer, template A",
        "evidence": "direct CREATE of 0xb57ed3c7 on 2026-09-22; funded 0.4 ETH by 0xB3352958 at 08:52; nonce 17, 0 ETH left; PGREM shows 23.17M USD of 24h volume on 170,098 USD of liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0x5b93b4270f7144c49e38aaa41e0accfd1b242a10",
        "role": "deployer",
        "label": "CRAIL deployer, template A",
        "evidence": "direct CREATE of 0xc8d8d13e on 2026-09-22; funded by 0x361bcf4b; nonce 18, 0 ETH left; 18.60M USD volume on 171,481 USD liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0xb016fc9c2df06e4554cec3b2c326786c8fb90419",
        "role": "deployer",
        "label": "PROUTE deployer, template A",
        "evidence": "direct CREATE of 0x7af49cb4 on 2026-09-22; funded by 0x361bcf4b; nonce 16, 0 ETH left; 9.64M USD volume on 65,781 USD liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0xef7659ede76d13dd82ececfe2d07a40e63b015dd",
        "role": "deployer",
        "label": "RIG deployer, template B",
        "evidence": "direct CREATE of 0x4c7c1f29 on 2026-09-22; funded 16.09 ETH by JEV's deployer 0xc96aa6ad; 2.40M USD volume on 832 USD liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0x2f10b57688f4a2b008ac91386cc6db0d1b0d635b",
        "role": "deployer",
        "label": "NODIUM deployer, template B",
        "evidence": "direct CREATE of 0x753bd40e on 2026-09-22; funded 12.85 ETH by 0xb12B8dab at 19:36; 2.55M USD volume on 691 USD liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0xfa1aa1a5f7055043004e1ffb3f1c783a0951cc5d",
        "role": "deployer",
        "label": "deployer of the musebook name-clone",
        "evidence": "direct CREATE of 0x17e900c2 named musebook on 2026-09-22, cloning Bankr's musebook 0x91a2dae9; 15.17M USD volume on 2,806 USD liquidity, read 2026-09-23"
      },
      {
        "chain": "robinhood",
        "address": "0x9654dcefe2d62b8688a6580d613a0ff0c42ad264",
        "role": "deployer",
        "label": "Reported BTC deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x30ed6a37665c50f799125923185b0fc171d36f0c: reported deployer 0x9654dcefe2d62b8688a6580d613a0ff0c42ad264, mint block 69162900. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x479fe30e4c17b442381d6543defb815af200c0e2",
        "role": "deployer",
        "label": "Reported HITBUY deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x4d8a95531f6e05cc2a6300485f5048ea5379d14d: reported deployer 0x479fe30e4c17b442381d6543defb815af200c0e2, mint block 70243525. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x4c14744b7e25154f034f1173384552f95e81d5f4",
        "role": "deployer",
        "label": "Reported PKRT deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x6a603bcd27c2913dc76802bd0f4f136ca7253cf0: reported deployer 0x4c14744b7e25154f034f1173384552f95e81d5f4, mint block 69450584. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xed930abfc05c27ecda0458679b6b47ac0cc508e7",
        "role": "deployer",
        "label": "Reported Euler deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xa2508b15ab16826c720631b9afa0a90c453ae8a4: reported deployer 0xed930abfc05c27ecda0458679b6b47ac0cc508e7, mint block 70153204. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x8baf803542ed4fd6f088cf3000cc0639df368626",
        "role": "deployer",
        "label": "Reported NOSH deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xabe99cf268cdc8bd70a71a5283fdacbcb36714fd: reported deployer 0x8baf803542ed4fd6f088cf3000cc0639df368626, mint block 70093885. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xfbad78588ce0a3219bfa7c50568e5c6b95c08922",
        "role": "deployer",
        "label": "Reported Agrippa deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x10f5ba270b0b5da5a4d21369f2c74a300bb16a8b: reported deployer 0xfbad78588ce0a3219bfa7c50568e5c6b95c08922, mint block 69972255. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x62e92bfb0a77c36bf8eb66a93efdf8033ca820ef",
        "role": "deployer",
        "label": "Reported HOOD6900 deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x8d5c42c096344e3ad4d5fcac8fe7a4b4ffca0150: reported deployer 0x62e92bfb0a77c36bf8eb66a93efdf8033ca820ef, mint block 69877221. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x58897b5ab5e9765978da46d265ebc9557ce30c7b",
        "role": "deployer",
        "label": "Reported CAPYTL deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xe5d808900343c08c8c464aee9196f07d6aff92ca: reported deployer 0x58897b5ab5e9765978da46d265ebc9557ce30c7b, mint block 70379712. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x7cdeaba11cf0bd75e9d2d1ab06d6c14729ce1a54",
        "role": "deployer",
        "label": "Reported GROK deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x55683371036401f8cae676c260efcde9be36a7f4: reported deployer 0x7cdeaba11cf0bd75e9d2d1ab06d6c14729ce1a54, mint block 69695369. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x0bdd9fdc80712f91371bcbd62cf9b11196550976",
        "role": "deployer",
        "label": "Reported PURRF deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x91737810403b892364edf677344e2719f9083f21: reported deployer 0x0bdd9fdc80712f91371bcbd62cf9b11196550976, mint block 70233496. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x1eecdbe695ed2a0e84c5837a2c6020caddfe25b6",
        "role": "deployer",
        "label": "Reported BTC deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x95e7b9b1bdb96748cdfdc2efe1234f849b6136ed: reported deployer 0x1eecdbe695ed2a0e84c5837a2c6020caddfe25b6, mint block 69649581. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xc331b714e923c6dda38cb3d319a6fc93f84c9906",
        "role": "deployer",
        "label": "Reported TTV deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xd79e23da4d8e8df3eb740bc04a10601a9886a44e: reported deployer 0xc331b714e923c6dda38cb3d319a6fc93f84c9906, mint block 69728775. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x6ef732b723eb6b37a3b19a9c3dfc7f86d8cae6bc",
        "role": "deployer",
        "label": "Reported Grace deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x589be08a24f853baf0e54e0eb56192e0dacfc60f: reported deployer 0x6ef732b723eb6b37a3b19a9c3dfc7f86d8cae6bc, mint block 70083640. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xb0d5517f0347f8b7e9d7b09c9a8d220aa6c4012f",
        "role": "deployer",
        "label": "Reported KCAT deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x6bb7a811e5d542e8cfaeaca2e9d56c35d9078dc4: reported deployer 0xb0d5517f0347f8b7e9d7b09c9a8d220aa6c4012f, mint block 69631233. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xb941e8b20677e7b96c25f941a4c5a20575c88aa0",
        "role": "deployer",
        "label": "Reported GREEN deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x983eb0bc4274919671fce93164f5c3e1af2f9be5: reported deployer 0xb941e8b20677e7b96c25f941a4c5a20575c88aa0, mint block 69091403. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xd8e1e83e0344564dac0f4bf200582892c1f3c96b",
        "role": "deployer",
        "label": "Reported ShinyHunters deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x9d2a08c3fc38f51c3a9dff56fa552f884e78659e: reported deployer 0xd8e1e83e0344564dac0f4bf200582892c1f3c96b, mint block 70348891. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xa3f1caedea8cd046e403f030cb927b53fb4c1f5f",
        "role": "deployer",
        "label": "Reported SI deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x50c35c073e95d7e4143847502806f3bb1cf46059: reported deployer 0xa3f1caedea8cd046e403f030cb927b53fb4c1f5f, mint block 69841267. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xd701f910f7fdb70ed9ba30239a852f847788a3dd",
        "role": "deployer",
        "label": "Reported PURRF deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x6ef17777216eefdbc8906c80877b46a8a3cdd4ad: reported deployer 0xd701f910f7fdb70ed9ba30239a852f847788a3dd, mint block 69647658. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xffd8486bab7f66bf1f34ac9d6f3edd354052b998",
        "role": "deployer",
        "label": "Reported FCAT deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x1608502531e59c2aa5168921d3850285624c17f6: reported deployer 0xffd8486bab7f66bf1f34ac9d6f3edd354052b998, mint block 69742017. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x55b89ad05eaec513db581bf1fb91e732d3b7d378",
        "role": "deployer",
        "label": "Reported BOBCOIN deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x86259b991f25c94135d4b5150da16fb2908b0730: reported deployer 0x55b89ad05eaec513db581bf1fb91e732d3b7d378, mint block 69937855. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x9246c887d2525120e90496e4b64754fe252661c8",
        "role": "deployer",
        "label": "Reported SI deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xb805bdcf7abc82c8c1d8d0ec4ed71ff67b58f048: reported deployer 0x9246c887d2525120e90496e4b64754fe252661c8, mint block 69762109. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xfd2f0ff6fe83865cd87b481b3c7d888390a9ab79",
        "role": "deployer",
        "label": "Reported SHIB deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0xd136b862ebbb1bd362a637ed67b7b0efe1052e7f: reported deployer 0xfd2f0ff6fe83865cd87b481b3c7d888390a9ab79, mint block 70051367. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x5ce16e2fd63b11ea391249b2bfb0419a98fa6142",
        "role": "deployer",
        "label": "Reported BET deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x1df7abb9d130e373f00bb1edec798cd4194a3845: reported deployer 0x5ce16e2fd63b11ea391249b2bfb0419a98fa6142, mint block 69897461. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0x96068378dffec0f017f763f7131ab11e0688766b",
        "role": "deployer",
        "label": "Reported GTC deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x179bf4b6b504f1e067512c0a171ff9a07d22cdc9: reported deployer 0x96068378dffec0f017f763f7131ab11e0688766b, mint block 69797559. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      },
      {
        "chain": "robinhood",
        "address": "0xa6b5b90390d8f802842da2bf59cbf75a1d864bfb",
        "role": "deployer",
        "label": "Reported Tweenix deployer",
        "evidence": "Archived 2026-09-23 study, docs/launchpads/data/attribution.json entry 0x135f8f75ec9605517cc0ff008a0f216445e23ecd: reported deployer 0xa6b5b90390d8f802842da2bf59cbf75a1d864bfb, mint block 69641432. Reindexed 2026-09-24; no new RPC verification or beneficial-owner inference."
      }
    ],
    "accounts": [],
    "launches": [
      {
        "chain": "robinhood",
        "address": "0xb57ed3c7ffeaa75ceb6c772cb7a3be422782e250",
        "symbol": "PGREM",
        "name": "PGREM",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69526662; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xb57ed3c7ffeaa75ceb6c772cb7a3be422782e250, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x30ed6a37665c50f799125923185b0fc171d36f0c",
        "symbol": "BTC",
        "name": "BTC",
        "launchedAt": "2026-09-21",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69162900; reported bytecode length 2721 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x30ed6a37665c50f799125923185b0fc171d36f0c, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xc8d8d13eea8a47bc265f4f26c8b5b72425b611c2",
        "symbol": "CRAIL",
        "name": "CRAIL",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69655651; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xc8d8d13eea8a47bc265f4f26c8b5b72425b611c2, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x4d8a95531f6e05cc2a6300485f5048ea5379d14d",
        "symbol": "HITBUY",
        "name": "HITBUY",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70243525; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x4d8a95531f6e05cc2a6300485f5048ea5379d14d, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x6a603bcd27c2913dc76802bd0f4f136ca7253cf0",
        "symbol": "PKRT",
        "name": "PKRT",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69450584; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x6a603bcd27c2913dc76802bd0f4f136ca7253cf0, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x17e900c2a7a16695431469a40ea060d508edd6d2",
        "symbol": "musebook",
        "name": "musebook",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69582652; reported bytecode length 1786 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x17e900c2a7a16695431469a40ea060d508edd6d2, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xa2508b15ab16826c720631b9afa0a90c453ae8a4",
        "symbol": "Euler",
        "name": "Euler",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70153204; reported bytecode length 3554 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xa2508b15ab16826c720631b9afa0a90c453ae8a4, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xabe99cf268cdc8bd70a71a5283fdacbcb36714fd",
        "symbol": "NOSH",
        "name": "NOSH",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70093885; reported bytecode length 3554 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xabe99cf268cdc8bd70a71a5283fdacbcb36714fd, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x7af49cb48abbf70d11d786d99242173698119892",
        "symbol": "PROUTE",
        "name": "PROUTE",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69875899; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x7af49cb48abbf70d11d786d99242173698119892, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x10f5ba270b0b5da5a4d21369f2c74a300bb16a8b",
        "symbol": "Agrippa",
        "name": "Agrippa",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69972255; reported bytecode length 3580 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x10f5ba270b0b5da5a4d21369f2c74a300bb16a8b, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x8d5c42c096344e3ad4d5fcac8fe7a4b4ffca0150",
        "symbol": "HOOD6900",
        "name": "HOOD6900",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69877221; reported bytecode length 3554 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x8d5c42c096344e3ad4d5fcac8fe7a4b4ffca0150, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xe5d808900343c08c8c464aee9196f07d6aff92ca",
        "symbol": "CAPYTL",
        "name": "CAPYTL",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70379712; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xe5d808900343c08c8c464aee9196f07d6aff92ca, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x55683371036401f8cae676c260efcde9be36a7f4",
        "symbol": "GROK",
        "name": "GROK",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69695369; reported bytecode length 3554 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x55683371036401f8cae676c260efcde9be36a7f4, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x91737810403b892364edf677344e2719f9083f21",
        "symbol": "PURRF",
        "name": "PURRF",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70233496; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x91737810403b892364edf677344e2719f9083f21, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x95e7b9b1bdb96748cdfdc2efe1234f849b6136ed",
        "symbol": "BTC",
        "name": "BTC",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69649581; reported bytecode length 1906 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x95e7b9b1bdb96748cdfdc2efe1234f849b6136ed, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xd79e23da4d8e8df3eb740bc04a10601a9886a44e",
        "symbol": "TTV",
        "name": "TTV",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69728775; reported bytecode length 3426 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xd79e23da4d8e8df3eb740bc04a10601a9886a44e, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x589be08a24f853baf0e54e0eb56192e0dacfc60f",
        "symbol": "Grace",
        "name": "Grace",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70083640; reported bytecode length 4509 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x589be08a24f853baf0e54e0eb56192e0dacfc60f, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x6bb7a811e5d542e8cfaeaca2e9d56c35d9078dc4",
        "symbol": "KCAT",
        "name": "KCAT",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69631233; reported bytecode length 12749 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x6bb7a811e5d542e8cfaeaca2e9d56c35d9078dc4, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x983eb0bc4274919671fce93164f5c3e1af2f9be5",
        "symbol": "GREEN",
        "name": "GREEN",
        "launchedAt": "2026-09-21",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69091403; reported bytecode length 3017 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x983eb0bc4274919671fce93164f5c3e1af2f9be5, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x9d2a08c3fc38f51c3a9dff56fa552f884e78659e",
        "symbol": "ShinyHunters",
        "name": "ShinyHunters",
        "launchedAt": "2026-09-23",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70348891; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x9d2a08c3fc38f51c3a9dff56fa552f884e78659e, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x50c35c073e95d7e4143847502806f3bb1cf46059",
        "symbol": "SI",
        "name": "SI",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69841267; reported bytecode length 3580 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x50c35c073e95d7e4143847502806f3bb1cf46059, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x753bd40e11921abf2a1a01a05ddc836c61753bc1",
        "symbol": "NODIUM",
        "name": "NODIUM",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69910624; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x753bd40e11921abf2a1a01a05ddc836c61753bc1, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x6ef17777216eefdbc8906c80877b46a8a3cdd4ad",
        "symbol": "PURRF",
        "name": "PURRF",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69647658; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x6ef17777216eefdbc8906c80877b46a8a3cdd4ad, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x4c7c1f29bc6be6c51d372f4edb3f68e77e34ab40",
        "symbol": "RIG",
        "name": "RIG",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69824087; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x4c7c1f29bc6be6c51d372f4edb3f68e77e34ab40, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x1608502531e59c2aa5168921d3850285624c17f6",
        "symbol": "FCAT",
        "name": "FCAT",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69742017; reported bytecode length 3854 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x1608502531e59c2aa5168921d3850285624c17f6, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x86259b991f25c94135d4b5150da16fb2908b0730",
        "symbol": "BOBCOIN",
        "name": "BOBCOIN",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69937855; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x86259b991f25c94135d4b5150da16fb2908b0730, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xb805bdcf7abc82c8c1d8d0ec4ed71ff67b58f048",
        "symbol": "SI",
        "name": "SI",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69762109; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xb805bdcf7abc82c8c1d8d0ec4ed71ff67b58f048, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0xd136b862ebbb1bd362a637ed67b7b0efe1052e7f",
        "symbol": "SHIB",
        "name": "SHIB",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 70051367; reported bytecode length 1998 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0xd136b862ebbb1bd362a637ed67b7b0efe1052e7f, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x1df7abb9d130e373f00bb1edec798cd4194a3845",
        "symbol": "BET",
        "name": "BET",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69897461; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x1df7abb9d130e373f00bb1edec798cd4194a3845, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x675279fe3259dcd20b1520399d2977dad042bf3f",
        "symbol": "JEV",
        "name": "JEV",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69809612; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x675279fe3259dcd20b1520399d2977dad042bf3f, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x179bf4b6b504f1e067512c0a171ff9a07d22cdc9",
        "symbol": "GTC",
        "name": "GTC",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69797559; reported bytecode length 4655 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x179bf4b6b504f1e067512c0a171ff9a07d22cdc9, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      },
      {
        "chain": "robinhood",
        "address": "0x135f8f75ec9605517cc0ff008a0f216445e23ecd",
        "symbol": "Tweenix",
        "name": "Tweenix",
        "launchedAt": "2026-09-22",
        "venue": "Direct deploy reported in the 2026-09-23 study",
        "outcome": "unestablished",
        "note": "Archived mint block 69641432; reported bytecode length 1764 bytes. Similar bytecode length is not a code hash or evidence of common control. Price, liquidity, custody and conduct require current independent evidence.",
        "evidence": "docs/launchpads/data/attribution.json entry 0x135f8f75ec9605517cc0ff008a0f216445e23ecd, captured for the 2026-09-23 study; reindexed 2026-09-24 without fresh chain verification."
      }
    ]
  },
  {
    id: "rh-snipe-infra",
    name: "Robinhood Chain snipe infrastructure",
    kind: "infra",
    intent: "nefarious",
    summary: "Buy bundlers and a sell executor written by one EOA and rented across several launch farms. Presence of these contracts in a launch window means a professional sniping service touched the launch, whoever the deployer was.",
    firstSeen: "2026-09-07",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0xca33026341691f48a3067e22febcbd54f0cb5de2", role: "infra-author", label: "author of bundlers and executor", evidence: "Blockscout creator of 0x1e43ce00, 0x14b9a544, 0xb06983db; 6,131 txs by 2026-09-13, mostly GasliteDrop airdropETH; self-funded via GasliteDrop 2026-09-11" },
      { chain: RH, address: "0x1e43ce0055b35373cb108e67586fd3b19ee32618", role: "bundler-contract", label: "buy bundler (method 0x960900de)", evidence: "LEBRON block+1 buy 2026-09-12 tx 0x21bb0c30\u2026; 50+ distinct EOA callers since 2026-09-07 on AAPL/RBLX/PLTR-paired Pons launches" },
      { chain: RH, address: "0x14b9a544e8c179fc2040d3089dcc73baf25aa8f9", role: "bundler-contract", label: "buy bundler (method 0x6f49227e)", evidence: "SYNAPSE block+1 buy 2026-09-14 03:38:12; 4,227 txs; token transfers on NFLX, NVDA, QQQ, SPY, MSFT, CBBTC launches" },
      { chain: RH, address: "0xb06983db4fad9cd94efbf9088c364ebcacde1214", role: "executor-contract", label: "sell executor (method 0xd816eb0b)", evidence: "LEBRON sells 2026-09-12 blocks +25..+46 via 55 relayer EOAs; SYNAPSE rotation 2026-09-14 blocks +26..+77; PRISM sells 2026-09-02" },
      { chain: RH, address: "0xe68d0bbc023de3febda04f413db23ce9c5ea1934", role: "bundler-contract", label: "GasliteDrop (airdropETH) - neutral tool, the funding primitive every farm uses", evidence: "verified GasliteDrop; sender of an airdropETH batch that funds a deployer is the operator hub" }
    ],
    accounts: [],
    launches: []
  },
  {
    id: "rh-farm-lebron",
    name: "LEBRON self-snipe farm (Base to Binance exit)",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "One hub funded the deployer and the sniper in a single GasliteDrop batch. The sniper bought 88.5% of supply and dumped in 5 seconds into the Pons 100% anti-snipe tax; the deployer claimed the confiscated proceeds as creator tax 11 minutes later and bridged them to Base and into Binance.",
    firstSeen: "2026-09-12",
    lastSeen: "2026-09-12",
    wallets: [
      { chain: RH, address: "0xccfb5e8f8db1b50ffa37ab9527d25f78e3e10ae7", role: "hub", evidence: "GasliteDrop airdropETH tx 0x21ea633f\u2026 at 2026-09-12 17:30:24 UTC: 30.11 ETH to 18 wallets (29.72 sniper, 0.045 deployer, 0.0245 x16 burners); swept burners back 18:47" },
      { chain: RH, address: "0xe0bcad36fd0c2f0af1796f18aa291e232102d46c", role: "off-ramp", evidence: "received 124,048 USDG from the deployer 2026-09-12, swapped to ~49 ETH on UniversalRouter 19:19-19:20, 16 Relay deposits to Base recipients that swept into Binance 73 / Binance Dep; 119 ETH out that day" },
      { chain: RH, address: "0x169cb3caed0fe9327cc4419a1646d1edf5999f14", role: "deployer", evidence: "creation tx 0x8eb502eb\u2026 18:31:46; claimed 127,763 USDG from PonsV2FeeEscrow at block +6580; burned nothing, sold 1% dev bag at +5 min" },
      { chain: RH, address: "0x1dd6e1f6e2d1696a88998cff9fc150cab4c3601a", role: "sniper", evidence: "paid 68,136 USDG into bundler 0x1e43ce00 at block +1, took 71.4% curve + 17% pool; 8 direct sells" },
      { chain: RH, address: "0x1dd6e1f6e2d1696a88998cff9fc150cab4c3601a", role: "farm", label: "also received rotated tokens", evidence: "recv 11.41% / sent 11.41% via executor" },
      { chain: RH, address: "0xbdccde803ac7717676458f0740a7c53c17197e51", role: "farm", evidence: "received 5.72% at block +1, sold all via executor by +43; funded 0.0245 ETH in the hub batch" },
      { chain: RH, address: "0xe4ba8af095a20672b6832d1a69cad1daddb6d347", role: "farm", evidence: "hub batch burner, 4.95% in, all out by block +40" },
      { chain: RH, address: "0x1b4791bc33580830ed48eedbcdc8ba0aa2b55346", role: "farm", evidence: "hub batch burner, 4.96% in, all out by block +43" },
      { chain: RH, address: "0xdd873322d2a8d32c7416e592c537a2dae3547223", role: "farm", evidence: "hub batch burner, 4.78% in, all out by block +44" },
      { chain: RH, address: "0x45909e304e9a2bd90511e0907a9f37e19bc73feb", role: "farm", evidence: "hub batch burner, 5.45% in, all out by block +46" },
      { chain: RH, address: "0xc8dcf7e90657f70adb9782a51552911ff57cd192", role: "farm", evidence: "hub batch burner, 5.30% in, all out by block +43" },
      { chain: RH, address: "0x2d8930c3b4ffa7e54f7c5da5d5f7b5cd8d67e8d5", role: "farm", evidence: "hub batch burner, 7.06% in, all out by block +44" },
      { chain: RH, address: "0x3602a8cf6a8ab9c063d35f929af128d52187b04b", role: "farm", evidence: "hub batch burner, 4.29% in, all out by block +43" },
      { chain: RH, address: "0x2a8453afb11995ac5a71e5307bad63f58ded6bb5", role: "farm", evidence: "hub batch burner, 4.55% in, all out by block +41" },
      { chain: RH, address: "0xa6278f659e09beacb8236dcf59f444ecd9756abc", role: "farm", evidence: "hub batch burner, 5.16% in, all out by block +37" },
      { chain: RH, address: "0xcdb0281e04a86880728744b03b3cd9dcb2d05e23", role: "farm", evidence: "hub batch burner, 3.78% in, all out by block +38" },
      { chain: RH, address: "0xd1a499f63dd8c03e3aef936851749df9290b26c9", role: "farm", evidence: "hub batch burner, 3.27% in, all out by block +37" },
      { chain: RH, address: "0x7dc5b3ebf88ca398e99b159415307ef135c81327", role: "farm", evidence: "hub batch burner, 3.33% in, all out by block +39" },
      { chain: RH, address: "0xd3401e2ccc12b01e8f5addcbd2f7921fc0475d98", role: "farm", evidence: "hub batch burner, 3.78% in, all out by block +38" },
      { chain: "base", address: "0x3304e22ddaa22bcdc5fca2269b418046ae7b566a", role: "off-ramp", label: "Binance 73 hot wallet (destination, not operator)", evidence: "Basescan name tag; all 16 Relay recipients forwarded here or to Binance Dep 0x487cab40\u2026" }
    ],
    accounts: [],
    launches: [
      { chain: RH, address: "0xd553996e73a50501a940ea771b328998a7ac2478", symbol: "LEBRON", name: "King James", launchedAt: "2026-09-12T18:31:46Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "88.5% of supply bought by the operator at launch and dumped in 5 s; hook tax recycled to the deployer as creator tax; liquidity left at ~$5k", evidence: "RPC transfer logs blocks 61319910..61347834; PonsV2FeeEscrow claim to deployer; Relay API request ids on 16 deposits" }
    ],
    related: ["rh-snipe-infra"]
  },
  {
    id: "rh-farm-prism",
    name: "PRISM fee farm (Solana exit)",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "Deployer and a block-2 buyer funded from one hub; the buyer scalped the curve and the deployer harvested creator fees 82 times in 11 days, routing them out through Relay to Solana. The product front end (Prism Finance) is real; the token's fee stream is the extraction.",
    firstSeen: "2026-09-02",
    lastSeen: "2026-09-13",
    wallets: [
      { chain: RH, address: "0x45f4a022dd3758bdf8421e3293fc04f7f775fd2f", role: "hub", evidence: "GasliteDrop batches funding deployer 0xfa2e1109 (2026-09-05 0.787 ETH) and sniper 0xeaad34d9 (2026-09-05, 09-06); 53 txs; refilled by deployer, 0x252e7031, 0x9787ce57 and the Relay solver" },
      { chain: RH, address: "0xfa2e1109b1eba2ab27f1f6497a32daf42ce52bcc", role: "deployer", evidence: "launchAndBuy 2026-09-02 16:52:52; 82 PonsV2FeeEscrow claims (~24 ETH) by 2026-09-12; 15 ETH swapped to USDG, 6.4 ETH to 0x9787ce57; holds 37,404 USDG" },
      { chain: RH, address: "0xeaad34d90867b8e6d7694656520d9631eaf3abc8", role: "sniper", evidence: "bought 22% at block +2, sold back into the curve within 8 s partly via executor 0xb06983db; 211 txs bot wallet (Tiptoe trades)" },
      { chain: RH, address: "0x9787ce5701f98f83a669642de5b5df42a6d50085", role: "off-ramp", evidence: "6 RelayDepository deposits 2026-09-02..09-12 resolving to Solana recipients ED5P2EzE\u2026, CbJer8UY\u2026, V1SXh1c5\u2026, 4rp49ATu\u2026; holds 15,283 USDG + 11.8 ETH" },
      { chain: RH, address: "0xdd84ed843bb62d1e3f070e7f026ea26cae2dbfa6", role: "fee-beneficiary", evidence: "sole recipient of the deployer's 82 post-claim GasliteDrop forwards (dust amounts); forwards on via GasliteDrop" },
      { chain: RH, address: "0x252e7031", role: "farm", label: "prefix only - full address unresolved", evidence: "22 txs since 2026-09-02, sends to the hub and to 0x9787ce57; approves PRISM" }
    ],
    accounts: [
      { handle: "TradeOnPrism", role: "project", label: "Prism Finance (prismfinance.net)", evidence: "bio carries the PRISM CA; Space with @0xmonco 2026-09-12; the fee recipient is the farm deployer, not the product" }
    ],
    launches: [
      { chain: RH, address: "0x71d389c48e29996bd8e20778f87fb915c1ffdcc2", symbol: "PRISM", name: "Prism Finance", launchedAt: "2026-09-02T16:52:52Z", venue: "pons-v2", outcome: "fee-farmed", note: "no team wallet held or sold after launch day; extraction is the creator-fee stream, decaying with volume", evidence: "RPC transfer logs 2026-09-02..09-13 (55,230 transfers); Blockscout claim history; Relay API on off-ramp deposits" }
    ],
    related: ["rh-snipe-infra"]
  },
  {
    id: "rh-farm-synapse-hub",
    name: "Curve-scalping farm behind the SYNAPSE launch",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "A hub that has run 36 GasliteDrop batches since July 25 and one a day since September 7. It funds a deployer and a sniper together, the sniper takes 20% at block +1, the bag is rotated through ten fresh wallets during the curve phase and sold back before graduation, so the Pons anti-snipe tax never applies. Proceeds recycle into the hub; no bridge exit found yet.",
    firstSeen: "2026-07-25",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0xafb1d47ce1af439c5833bb4f6eb4978722df2fca", role: "hub", evidence: "airdropETH tx 0x12c3b8b7\u2026 2026-09-14 02:49:36: 0.495 ETH sniper, 0.054 deployer; 36 batches since 2026-07-25; refilled by one-off EOAs 0xdb7de2bb, 0xcb9941ed, 0x5f5bd211, 0x9588b414 and the Relay solver" },
      { chain: RH, address: "0x7253f5e07eec688535832fe3197ac683865a2844", role: "deployer", evidence: "launchAndBuy 2026-09-14 03:38:11 (tx 0xd69ddae9\u2026); burned the 1% allocation at 04:25; creator-fee recipient per creation tx, unclaimed at last check" },
      { chain: RH, address: "0x18beccfb74ca0777c9e67f1f20de574260c3ca4f", role: "sniper", evidence: "0.44 ETH into bundler 0x14b9a544 at 03:38:12, received 20.00% at block +1, pushed to executor in 10 chunks by 03:38:19; 4.4 ETH lifetime GasliteDrop funding, reused" },
      { chain: RH, address: "0x58f8c54d6f7817451ed7a997bfc8720540cf2b32", role: "farm", evidence: "re-issued 2.69% inside an executor sell tx, sold to curve at block +320, 0.120 ETH from curve; ETH inflows from six other Pons curves; sweeps via GasliteDrop" },
      { chain: RH, address: "0x6bd48152948e2ff00990acd0f8845d35692972dd", role: "farm", evidence: "2.58% rotated, 0.168 ETH from curve" },
      { chain: RH, address: "0xbafd1e2744a64bf1a6e6acb2f8d4c5ab8d9814bb", role: "farm", evidence: "2.38% rotated, 0.116 ETH from curve" },
      { chain: RH, address: "0x4b9bba0e83f977ac2dadbcdf7a1988fae24f98d9", role: "farm", evidence: "2.18% rotated, 0.123 ETH from curve; also the tx sender of the executor sells" },
      { chain: RH, address: "0x53e60ff72ade7682ff9100049ab9c30d9f738640", role: "farm", evidence: "1.99% rotated, 0.073 ETH from curve" },
      { chain: RH, address: "0xc9e7d61395f1f1038b391341876f512f9528ed13", role: "farm", evidence: "1.90% rotated, 0.099 ETH from curve" },
      { chain: RH, address: "0xf4ca4ddd5702d8cbb1085577f4cffaeb6eb23208", role: "farm", evidence: "1.76% rotated; curve ETH not visible on the sampled explorer page" },
      { chain: RH, address: "0x453e469a75117a8681cfb6306ef607e95a0b0232", role: "farm", evidence: "1.23% rotated, 0.050 ETH from curve" },
      { chain: RH, address: "0x216e947c3f3c09d8e3016987ee4a73e9c2e61fcf", role: "farm", evidence: "1.23% rotated, 0.074 ETH from curve; third recipient (dust) of the hub batch" },
      { chain: RH, address: "0x509abc1b6fd5df9a848ec07b96e73c047da701a8", role: "farm", evidence: "1.01% rotated; curve ETH not visible on the sampled explorer page" }
    ],
    accounts: [
      { handle: "synepsepad", role: "project", label: "Synapse (usesynapse.ink), AI-model launchpad on Pons", evidence: "pinned post claims the CA; its docs name treasury 0x8940fde8\u2026 as fee recipient, but the creation tx names the farm deployer" }
    ],
    launches: [
      { chain: RH, address: "0xe96184c99b3a3b89c907ea0753c5fde9e3c572ab", symbol: "SYNAPSE", name: "Synapse Protocol", launchedAt: "2026-09-14T03:38:11Z", venue: "pons-v2", outcome: "curve-scalped", note: "20% taken at block +1 and returned to the curve within 32 s for +0.38 ETH; post-graduation market was organic (1,311 distinct buyers in 70 min)", evidence: "RPC transfer logs blocks 62494534..62554552 (42,200 transfers); Blockscout internal txs on farm wallets" }
    ],
    related: ["rh-snipe-infra"]
  },
  {
    id: "rh-honeypot-factory-8fc191",
    name: "Serial honeypot factory 0x8fc191da",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "One EOA deploys a custom ERC-20 straight to a Uniswap v2 WETH pool roughly once a day, keeps 100% of the LP tokens, lets only its own wallet sell, waits for buys, then calls removeLiquidityETHSupportingFeeOnTransferTokens minutes before deploying the next one and bridges the ETH out through LiFi/Across. Five tokens in four days.",
    firstSeen: "2026-09-11",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0x8fc191daa5ac8eb3b30066ffa554d999fe35885e", role: "deployer", label: "deployer and sole LP holder", evidence: "created JUGGERNAUT 09-11, EMBERCAT 09-12, STONKINU 09-13, ZZZCAT 09-13, DOGEGPT 09-14 (direct EOA deploys, unverified, custom actionPair() call after each); removeLiquidity 09-12 10:48, 09-13 01:30, 09-13 12:01, 09-14 01:26; LiFi swapAndStartBridgeTokensViaAcrossV4 09-12 (0.3 ETH), 09-13 (1.0 ETH); holds 316227766016836933 of 316227766016837933 DOGEGPT LP units" },
      { chain: RH, address: "0x10d28597e09fec92eae3715b25967bd3d07ae335", role: "farm", label: "whitelisted seller (hardcoded in DOGEGPT bytecode)", evidence: "top EOA holder of DOGEGPT (8.2% of supply) funded by the deployer; address is a PUSH20 constant in the token bytecode; eth_call transfer to the pair succeeds from this wallet and reverts from every other holder tested 2026-09-14" },
      { chain: RH, address: "0x8993033c6558be8fde430a2674744ec5ecba8a12", role: "farm", label: "helper address hardcoded in DOGEGPT bytecode", evidence: "PUSH20 constant in the token bytecode; the deployer sent it 2 transactions; calls to execute/multicall/claim/actionPair from it revert on 2026-09-14" },
      { chain: RH, address: "0xdf058ad7f6eeb608d7f668797e87f74278376f0c", role: "farm", label: "helper address hardcoded in DOGEGPT bytecode", evidence: "PUSH20 constant in the token bytecode; the deployer sent it 1 transaction; calls to execute/multicall/claim/actionPair from it revert on 2026-09-14" }
    ],
    accounts: [],
    launches: [
      { chain: RH, address: "0x26becab467bf74a3e09c095c30427acbd6544608", symbol: "DOGEGPT", name: "DOGEGPT", launchedAt: "2026-09-14T01:29:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "honeypot", note: "101 buys and 0 sells in the first 6 h; non-whitelisted transfers to the pair revert; deployer holds all LP; 89 holders, ~$79k liquidity at read time. Bytecode read (3,339 bytes, unverified, decimals 8): standard ERC-20 selectors plus actionPair(address) [deployer-only, sets the pair], execute(address[],uint256), multicall(address[],uint256), claim(address[],uint256) [all revert from every caller tried, owner is zero], and transfer(address,address,uint256) [returns success for any caller and any amount, a silent no-op]; transferFrom enforces allowance; one CALL, no DELEGATECALL, no SELFDESTRUCT, no ETH held; hardcoded addresses are the deployer, the whitelisted seller, two helper EOAs and the canonical Uniswap V2 factory 0x6b75d8af\u20269a80 (pair derived with CREATE2). Sell path is a recipient check against the pair: transfer to the pair reverts unless the sender is the whitelisted wallet; transfers to plain addresses succeed. No function can reach a holder's ETH or other tokens", evidence: "eth_getCode disassembly and openchain selector lookup 2026-09-14; eth_call simulations from 3 holders, the deployer, the whitelisted wallet, both helper addresses and a random EOA; pair LP balanceOf; DexScreener txns; Blockscout deployer tx list" },
      { chain: RH, address: "0xaf72f6237674830778082a4566167b4ba4f1e04b", symbol: "ZZZCAT", name: "ZZZCAT", launchedAt: "2026-09-13T12:07:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "48 buys, 1 sell, liquidity 0 and price -100% after removeLiquidity 09-14 01:26", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0xdc1a9f464dcb4a1dfdae34253939fdb509b081bf", symbol: "STONKINU", name: "STONKINU", launchedAt: "2026-09-13T01:36:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "liquidity $8 after removeLiquidity 09-13 12:01", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0x038f31900fcde52884456a47bbd2bb308bda8064", symbol: "EMBERCAT", name: "EMBERCAT", launchedAt: "2026-09-12T11:08:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "liquidity $2 after removeLiquidity 09-13 01:30", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0x3adde168a09132b95f25f52119a440b2bf9b32d0", symbol: "JUGGERNAUT", name: "JUGGERNAUT", launchedAt: "2026-09-11T16:03:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "no pair left on DexScreener after removeLiquidity 09-12 10:48", evidence: "deployer removeLiquidity tx timeline 2026-09-14" }
    ]
  },
  {
    id: "rh-snipe-ring-0xb33eb167",
    name: "0xb33eb167 block+24 snipe ring",
    kind: "snipe-ring",
    intent: "unestablished",
    summary: "Seven wallets bought 15.4% of the token 0xb33eb167 in the same block 2.4 seconds after launch through the Pons app proxy, in seven separate transactions. Six dumped after graduation. All seven are funded by prior Pons trading through the same proxy rather than by a GasliteDrop batch, and none of the rented snipe contracts appear, so this reads as independent bots racing the launch, not the deployer's own cluster. Kept as a ring because same-block entry with shared funding rails is coordination even without an operator. The brand behind the launch is recycled: the same X account and name sold an Ethereum token in 2022-2023 that went dark in 2024, and the 2026 site never mentions it.",
    firstSeen: "2022-11-01",
    // the Ethereum predecessor; the Robinhood Chain ring itself is 2026-09-09
    lastSeen: "2026-09-15",
    wallets: [
      { chain: RH, address: "0x709b3fa0f8c85cff157fb92b045ae02321b0483b", role: "sniper", evidence: "1.94% at block +24 tx 0x64f3f890\u2026; sold 1.94% into the pool after graduation" },
      { chain: RH, address: "0x4a00bd844a0420ef7e6ef66392c2b47e8106aabd", role: "sniper", evidence: "1.82% at block +24 tx 0x215c211a\u2026; sold all; ETH inflows from TransparentUpgradeableProxy (Pons app) 2026-09-09 17:19-17:21" },
      { chain: RH, address: "0x04730fea4731717db4879ad16e897f9fe7a6cc7d", role: "sniper", evidence: "1.72% at block +24 tx 0xbebfeded\u2026; sold all; funded through the Pons proxy 2026-09-09 17:19-17:21" },
      { chain: RH, address: "0xb2dc08af65272ef5b53c04887dbab360d6249865", role: "sniper", evidence: "2.27% at block +24 tx 0x3de8a8cf\u2026; sold 1.70%" },
      { chain: RH, address: "0xce90934a71b57e2a280a129dc36f2eb9c0d1d5c8", role: "sniper", evidence: "2.23% at block +24 tx 0x7e803a21\u2026; sold 1.12%" },
      { chain: RH, address: "0xf8a0c331f3dc4fb7693f49a9586ec88f2cdaea43", role: "sniper", label: "still holding", evidence: "3.22% at block +24 tx 0x05633da3\u2026; holds 1.35% on 2026-09-14; active Pons trader since 2026-07-28" },
      { chain: RH, address: "0x0e28d6a22f48ad65b2aae44b9be8c5016377ef8d", role: "sniper", evidence: "2.17% at block +24 tx 0x6552e137\u2026; sold 1.09%; passed 1.09% to 0xf8a0c331 at 17:39" },
      { chain: RH, address: "0xb9f98bf3bcf48b538b682ab16262a81fb19f9690", role: "farm", label: "ring side wallet", evidence: "received 1.61% from ring wallet 0xf8a0c331 at 17:36 on launch day, sold 1.40%" },
      { chain: RH, address: "0x1206d27741c771e573a915848f9c2c2bb4c2d3dc", role: "farm", label: "ring side wallet", evidence: "received 1.12% from ring wallet 0xce90934a at 17:38 on launch day, sold 1.12%" },
      { chain: RH, address: "0x7a8cf45f286d9dfb32156a6a20f45503e958f062", role: "farm", label: "ring side wallet", evidence: "received 1.35% from ring wallet 0xf8a0c331 at 17:41 on launch day, sold 1.35%" },
      { chain: RH, address: "0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6", role: "deployer", label: "token deployer, net buyer", evidence: "launchAndBuy 2026-09-09 17:35:06 took 2.53% (1% allocation + buy); moved that 2.53% to 0xd0f7d8c6\u2026 at 18:06 (still held there); bought a further ~2.8% from the pool 09-09..09-12; zero sells through 2026-09-14" },
      { chain: RH, address: "0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f", role: "deployer", label: "deployer allocation holder", evidence: "received the deployer's 2.53% launch allocation 2026-09-09 18:06; no outflows through 2026-09-14" }
    ],
    accounts: [],
    launches: [
      { chain: "ethereum", address: "0xe61f6e39711cec14f8d6c637c2f4568baa9ff7ee", symbol: "withheld", name: "2022 Ethereum predecessor of the same brand (name withheld)", launchedAt: "2022-11-01T00:00:00Z", venue: "uniswap-v2 with a Unicrypt LP lock", outcome: "unestablished", note: "The earlier token behind the same brand and X account, described on its explorer page as a research platform for pro traders and institutions; 100M supply, MIT-licensed OpenZeppelin ERC-20 verified 2022-11-01. Roadmap promised V2 by end of Q1 2023 and a paid-research MVP (Medium, early 2023); the LP lock was extended in Jan 2023; the site went offline in Aug 2024 and the token reads $0.00 with 520 holders on 2026-09-15. Not a rug read (LP was locked and no pull was found); an abandoned project whose brand was relaunched on Robinhood Chain in Sept 2026 without disclosure", evidence: "Etherscan token page 0xE61F6e39711cEc14f8D6c637c2f4568bAA9FF7Ee read 2026-09-15 (name and symbol withheld, 520 holders, links); verified source header naming the project's site, Telegram and X account (withheld); the project's GitHub smart-contract repo, two commits 2022-12-02 by its dev account; X post 1613594707824869376 (2023-01-12); the project's Medium MVP update" },
      { chain: RH, address: "0xb33eb16782776b4d738c0fd643577cb0284db610", symbol: "withheld", name: "Robinhood Chain builder-discovery token (name withheld)", launchedAt: "2026-09-09T17:35:06Z", venue: "pons-v2", outcome: "organic", note: "Pons V2, graduated in 7 min; 15.4% taken by seven same-block wallets at +24 and mostly dumped post-graduation; deployer 0xfdfbcae9\u2026 bought 1.53% with the launch, holds ~1.2%, used a RobinhoodLocker lock and one Relay deposit, no fee-escrow claims on its first page; 527 distinct pool buyers and 242% turnover in the first 3.4 h; ~$144k cap, ~$35k liquidity on 2026-09-14. Ongoing-selling read over 4.6 days (456% cumulative turnover): the ring and its three side wallets sold 13.8% of supply, 12.3 points of it on launch day and 0.2% in the last 24 h; the deployer never sold and is a net buyer; last 24 h was 44% sold vs 47% bought across 95 sellers, none launch-connected", evidence: "creation tx 0x53baa96a\u2026; RPC transfer logs blocks 58729102..58849101 (launch) and 58729102..latest on 2026-09-14 (15,381 transfers); Blockscout internal txs on the ring wallets; DexScreener 2026-09-14" }
    ]
  },
  {
    id: "altcoinist-ring",
    name: "Altcoinist / Tibbir promo ring",
    kind: "promo-ring",
    intent: "benign",
    summary: "A social trading collective around @Altcoinist ($ALTT) and its co-founder that finds and pushes Robinhood Chain memecoins early: $TIBBIR, $PONS, $CASHCAT, $LFI, then $FIH and $WRESTLER. Coordinated attention, not coordinated launches: the tokens they back have different deployers and factories, and the two top-holder wallets shared by FIH and WRESTLER are the only on-chain bridge found so far.",
    firstSeen: "2026-08-22",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0x2344eee2d839a83412760a0ba43e6324c34a7c5f", role: "holder-bridge", label: "manual trader holding both ring tokens", evidence: "top-50 holder of both FIH (1.68%) and WRESTLER (1.53%) on 2026-09-14; EOA holding 10.9 ETH, 500+ txs, trades through KyberSwap MetaAggregationRouterV2 and the 0x AllowanceHolder; held WRESTLER since launch day 2026-09-03; sold 1.53% of WRESTLER in 40 pieces on 2026-09-14/15 (0.86% inside the 13:30 UTC drop) and 1.10% of FIH at 10:42 UTC on 2026-09-15; no transfers or shared funders with the WRESTLER arbitrage bots" },
      { chain: RH, address: "0x2977b96b4235330075165ca5e3b0ef563745c354", role: "sniper", label: "launch-scalping bot wallet (also the FIH/WRESTLER holder bridge)", evidence: "top-50 holder of both FIH and WRESTLER on 2026-09-14; EOA with 6,945 txs and 0.009 ETH on 2026-09-15, approving a stream of PonsV2LauncherToken / PonsLauncherToken / LaunchToken contracts and trading through the unverified router 0xeF161b8b\u2026 (25 of its last 50 txs), the same router that flows curve-phase buys on PRISM and 0xb33eb167; ETH funded by that router, 0x0630dfBd\u2026 and the Pons proxy; sold 0.10% of WRESTLER on 2026-09-14/15. No transfers or shared funders with the WRESTLER arbitrage bots 0xed4728d8\u2026, 0x636d3380\u2026, 0x6da432f6\u2026" },
      { chain: RH, address: "0xbbfd5b62d83554c57674b27aee5b8a5228ded5a5", role: "deployer", label: "FIH creator (via launch factory 0xd9ec2db5\u2026)", evidence: "creation tx 0xec3a15b6\u2026 2026-07-01 20:44:19 paid 0.0005 ETH to the factory; bought 2.00% at block +2052 (~3.5 min) and holds 0.00% on 2026-09-14; 929 txs, 32.5 ETH" },
      { chain: RH, address: "0x059ae3cd996c5a0db82783224cb19ae5dc598c5e", role: "deployer", label: "WRESTLER creator (via the o1 Launchpad factory 0xce9c48cf\u2026)", evidence: "creation tx 0xeaf4478a\u2026 2026-09-03 03:24:21 paid 0.001 ETH to the launcher; holds 0.43% on 2026-09-14; 114 txs, 0.09 ETH" },
      { chain: SOL, address: "DVFYHVKFYLxws4bV97va6EceVRrKjddHSWYq3is4ad49", role: "kol-wallet", label: "@Altcoinist FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account Altcoinist (read 2026-09-17; FOMO holds no X link, binding rests on the name and the $TIBBIR bio). FOMO cash flow all-time net -$7.6k on $180k volume, 125 trades. He posted 8 FOMO theses on FIH and WRESTLER 2026-09-07 to 09-17." },
      { chain: RH, address: "0xccdeb7744e778992bfbff798f239638b76448e75", role: "kol-wallet", label: "@Altcoinist FOMO-verified EVM wallet", evidence: "FomoScan record for FOMO account Altcoinist (read 2026-09-17). Not yet traced against FIH, WRESTLER, TIBBIR, PONS or CASHCAT flows." },
      { chain: SOL, address: "4CH1wgHqyirN8KR3o9L8oYNpDtRmDccCtiRJjnjLtnYp", role: "kol-wallet", label: "@lowcap_hunter FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account lowcap_hunter, X link https://x.com/lowcap_hunter (read 2026-09-17). FOMO cash flow all-time net -$32.7k on $1.41M volume, 4,312 trades." },
      { chain: RH, address: "0x517b826b1902f9d44edaa2259afaa7e6e4b23b3b", role: "kol-wallet", label: "@lowcap_hunter FOMO-verified EVM wallet", evidence: "FomoScan record for FOMO account lowcap_hunter (read 2026-09-17). Not yet traced against ring token flows." }
    ],
    accounts: [
      { handle: "Altcoinist", role: "promoter", label: "Altcoinist \xB7 $ALTT \xB7 103k followers", evidence: "pinned 2026-08-22: 'Be Early. $TIBBIR 1339x $PONS 838x $CASHCAT 314x $LFI 77x'; $FIH calls 08-25..09-07 ('100% organic OG coin'); $WRESTLER calls 09-07 and 09-13 (Novogratz / GLXY narrative)" },
      { handle: "KonstantinSebeo", role: "cofounder", label: "ALT BRAH \xB7 co-founder Altcoinist", evidence: "bio: Co-founder @Altcoinist | $ALTT | @alphabaseindex; credited by ring members as the one who 'called $WRESTLER'" },
      { handle: "theunipcs", role: "kol", label: "Unipcs (Bonk Guy) \xB7 315k followers", evidence: "Altcoinist replies recommending $FIH to him 2026-09-02 and 09-07; ring members reply to him with $TIBBIR $WALLET $WRESTLER" },
      { handle: "0x7_anderson", role: "member", label: "Anderson \xB7 Base / Virtuals", evidence: "2026-09-06 post: 'Altbrah called $WRESTLER \u2026 attention proxy for $GLXY'; appeared in Vlad Tenev's who-to-follow 2026-09-10" },
      { handle: "wrestler_galaxy", role: "project", label: "$WRESTLER project account", evidence: "bio carries the CA and 'paired with tokenized GLXY'; posts fee buyback-and-burn tallies" },
      { handle: "FIHonRH", role: "project", label: "Fih In Hood (the small 0xd51c58f1 token, not the $1.4M FIH)", evidence: "bio CA 0xd51c58f1\u2026; joined 2026-07; the main FIH's DexScreener social is Vlad Tenev's 2024 frog post" },
      { handle: "lowcap_hunter", role: "member", evidence: "2026-09-10: 'top holders are $TIBBIR whales who caught it sub 1M'" },
      { handle: "DjGriffith", role: "member", evidence: "in Altcoinist's $FIH reply threads 08-30 and 09-02; in Vlad Tenev's who-to-follow 2026-09-10" }
    ],
    launches: [
      { chain: RH, address: "0x4b3a3ff4ec9d289727e24a8152f406bada44264d", symbol: "FIH", name: "Frog In Hood", launchedAt: "2026-07-01T20:44:19Z", venue: "launch factory 0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb (unverified, 93k txs) with verified LaunchLocker 0x7f03effbd7ceb22a3f80dd468f67ef27826acd85, both by 0x7e035fb0\u2026; full supply to a Uniswap v3 WETH pool", outcome: "organic", note: "100% of supply seeded into the v3 pool in the creation tx; position NFT 1169 moved factory -> LaunchLocker in the same tx and is still owned by the locker; first buy at block +38 (4 s, 0.43%), no block with 3+ buyers, 72 distinct buyers in the first hour, largest early buy 0.44%; deployer bought 2% at +3.5 min and has since sold it; 13.17% of supply burned; ~$1.4M cap, 1,439 holders on 2026-09-14", evidence: "creation tx 0xec3a15b6\u2026 receipt (ERC-721 transfers on Uniswap V3 Positions NFT-V1 0x73991a25\u2026); NFPM ownerOf(1169) 2026-09-14; RPC transfer logs blocks 870291..910290" },
      { chain: RH, address: "0xab528169dcc80d68837a33b1e2b866bb7d7ee301", symbol: "WRESTLER", name: "Wrestler", launchedAt: "2026-09-03T03:24:21Z", venue: "o1 (o1 Launchpad Launch Factory 0xce9c48cfa068947f77738c81be406b53338e5b0d, which Blockscout verifies under the source name RWAERC20LaunchpadFactory, deployed by o1's 0xaa8d6f5a\u2026; the o1 Launch Hook 0x0310cfebe1d7a69f2414f6595bbe9d17c5342acc is the supply custodian; full supply straight into a Uniswap v4 pool quoted in tokenized GLXY, no bonding curve; not Pons; identified as o1 from docs.o1.exchange production contracts 2026-09-16)", outcome: "organic", note: "100% of supply moved into the v4 PoolManager in the creation tx; first buy at block +183 (18 s); 5 distinct buyers and 10 buys in the first hour, largest 3.78% (sold back at +390); no block with 3+ buyers; pool still held 94% after an hour. Volume arrived days later with the Altcoinist calls (Sep 7 onward, $5M+/day by Sep 13); 2.55% of supply burned, consistent with the stated fee buyback-and-burn; deployer holds 0.43%; ~$0.9M cap, 1,821 holders on 2026-09-14", evidence: "creation tx 0xeaf4478a\u2026 receipt; RPC transfer logs blocks 53098347..53138346; DexScreener pair history; balanceOf(dead) 2026-09-14" },
      { chain: RH, address: "0xa944c6aee0aba6cc7345287f37c7daa8075c8dcb", symbol: "TIBBIR", name: "Ribbita by Virtuals (Robinhood bridge)", launchedAt: "2026-07-11T00:00:00Z", venue: "bridged Virtuals token (origin Solana/Base)", outcome: "unestablished", note: "$180M+ cap on Robinhood, $270M on Solana; the ring's anchor position", evidence: "DexScreener 2026-09-14; Blockscout creator 0xf2dc25b8\u2026" },
      { chain: RH, address: "0x39dbed3a2bd333467115de45665cc57f813c4571", symbol: "PONS", name: "Pons", launchedAt: "2026-07-01T00:00:00Z", venue: "pons", outcome: "unestablished", note: "launchpad token the ring calls; shares 4 top-50 holders with CASHCAT", evidence: "Altcoinist pinned 2026-08-22; holder overlap read 2026-09-14" },
      { chain: RH, address: "0x020bfc650a365f8bb26819deaabf3e21291018b4", symbol: "CASHCAT", name: "Cash Cat", launchedAt: "2026-06-01T00:00:00Z", venue: "pons", outcome: "unestablished", note: "followed by Vlad Tenev 2026-09; shares 4 top-50 holders with PONS", evidence: "Altcoinist pinned 2026-08-22; holder overlap read 2026-09-14" }
    ]
  },
  {
    id: "sol-park-pumpswap-pool-factory",
    name: "STONKS PARK / PumpSwap drained-pool factory",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "The pump.fun creator of $PARK (STONKS PARK) is the coin-creator fee sink of a same-day PumpSwap pool factory: ten throwaway wallets opened pools with 191 to 451 SOL each, ran bot volume for 2 to 26 minutes, then drained every pool to zero, while $PARK itself was bought 44.65% in its first 20 slots by an eight-wallet fresh-funded bundle plus sniper bots. The project X account is a 2024 memecoin handle renamed 13 times.",
    firstSeen: "2026-09-14",
    lastSeen: "2026-09-16",
    wallets: [
      { chain: SOL, address: "CBbRS6xr6KSjYzPgH7pQnVvy42GXbhWk1Z2WMejJa99X", role: "deployer", label: "PARK creator and coin-creator fee sink of the pool factory", evidence: "funded 1.379 SOL from the MEXC hot wallet ASTyfSima4\u2026 on 2026-09-14 22:57 UTC (tx TtUrWiPm8h\u2026); created PARK 2026-09-15 14:41:13 UTC with a 0.809 SOL dev buy (tx 5nXuSTbwmC\u2026), holds 27.53M PARK (2.87%) on 2026-09-16 with no creator-fee claim; named as coin_creator (create_pool account 21) in ten PumpSwap pools created 2026-09-15 14:50 to 21:32 UTC and referenced by swaps on ten more pools on 2026-09-16" },
      { chain: SOL, address: "HCEtGKAaKTqH5AhgNwuH8Enf9C6qpCEH9T7ctX5sfMtc", role: "deployer", label: "PumpSwap pool creator for Aigob", evidence: "created the pool for 5NK9STFaivRDScQnF5VwE7zwdEfFpKRd3BwhPPYuBAGS at 2026-09-15T14:50:40Z depositing 191.7 SOL (tx 3Ycuq1veGFj4\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "HU2MFdEZzxU68t1qEbPtJARH9ku9YHBfiRtkCQjG2ZqY", role: "deployer", label: "PumpSwap pool creator for XIDRAG", evidence: "created the pool for BfRMi3osCEn76huxCMiPqvyfWz9YwzfzdViMa83Bmoon at 2026-09-15T14:53:14Z depositing 441.1 SOL (tx 3dGcn1LNXJTX\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "Gf7adCBCyUt3EfFP7xtxMzSLShXjBZ44Zk2dBjfd1SgN", role: "deployer", label: "PumpSwap pool creator for ROBAI", evidence: "created the pool for AbEtvmjR9afBvjVY4hxzqLxN3xmFoCwAEXCofVgmoon at 2026-09-15T15:06:22Z depositing 372.4 SOL (tx 3Kiv9FrLmSKe\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "DDe2JJPAmEMZoacK8beY71BYsMz7fWos5pWfLHoKj3Pk", role: "deployer", label: "PumpSwap pool creator for MLBWC", evidence: "created the pool for CeHRqHs1adSwco4nGfRnC47ME8EdUVMhCce5HVABBAGS at 2026-09-15T15:09:35Z depositing 351.3 SOL (tx fpZqpBi3GtpZ\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "9Nin9rBdPtC5YtzAyan8XxkskrG5D6ZzG8kApCYUpJAC", role: "deployer", label: "PumpSwap pool creator for Tayrock", evidence: "created the pool for DtA6FUsUY4nK9HLYr8L3sZRNQUPKZfLxhtMB9qvJpump at 2026-09-15T15:51:30Z depositing 335.1 SOL (tx H7hw4KeCkUQC\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "9FNHre7R3Sm5DQHA3r7Fux9ABUL21UwmTmse5x7hUhE1", role: "deployer", label: "PumpSwap pool creator for DRONKRA", evidence: "created the pool for Ap8gWjgA9YdJQpMTeyAEqn6YP7rP3UC82GDvYWYipump at 2026-09-15T16:04:51Z depositing 421.2 SOL (tx HHM3MeUbvnk3\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "4nTdq49rcf9WUZDnmYNpdBnzmom4htc7srfQiT2bRXzN", role: "deployer", label: "PumpSwap pool creator for IRSPYGL", evidence: "created the pool for 8qhtfGY1v6WtK75WgMGaWcw1DUT3rXEu5R9LPQqVbonk at 2026-09-15T20:55:47Z depositing 450.9 SOL (tx 4fMftHUgjdVr\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "3n74UMjHoGy1xSiPuFRegMvgorcHviq4kRAh3GmRPePc", role: "deployer", label: "PumpSwap pool creator for ORBCROWN", evidence: "created the pool for G5QriGjyai2hkwC1Vw6rBm8jQZaib7kceecayKCoBAGS at 2026-09-15T21:09:29Z depositing 401.0 SOL (tx 4awtrUJtE1Va\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "CwXYLnAi7qXScpQMLQ1fMzhaTzg6oXuYsfUND1PjcLno", role: "deployer", label: "PumpSwap pool creator for Uclcrab", evidence: "created the pool for HFKHqyJroRgU9j9hVya2rqm48T5WJwrU1KStygwABAGS at 2026-09-15T21:19:06Z depositing 400.6 SOL (tx 3wCQ458SrD2T\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "ECmgGJqYLDVfmanhqB3oUU8huqPMCDur3MYu1596wxFf", role: "deployer", label: "PumpSwap pool creator for Dunworm", evidence: "created the pool for 5mwnJgccHmRBv5HkqaQ3zs83nnGABR6p2L9UscRSBAGS at 2026-09-15T21:32:33Z depositing 415.4 SOL (tx 54Jx3m4ExoAi\u2026) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "C1k65UizER9Xzywq91igjqzP1TVkyM2S1RPPbHtpxxce", role: "sniper", label: "launch-bundle wallet (1.925% in the first 13 slots)", evidence: "fresh wallet (7 txs) funded 0.781 SOL by iGdFcQoyR2\u2026 at 2026-09-15 09:43 UTC, 4.5 to 5 hours before launch; bought 1.925% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "2NriqKBAJbTev2De33TiAvrypgKrS8ZBomVYVnxBtkaa", role: "sniper", label: "launch-bundle wallet (2.488% in the first 13 slots)", evidence: "fresh wallet (7 txs) funded 0.893 SOL by 83yG2brNva\u2026 at 2026-09-15 09:42 UTC, 4.5 to 5 hours before launch; bought 2.488% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "EZKyWYGsXZ8RS5uz6skfCCYBPqp7GSdHHCfNbgsGDoDQ", role: "sniper", label: "launch-bundle wallet (2.053% in the first 13 slots)", evidence: "fresh wallet (9 txs) funded 0.707 SOL by 41uCv6a1JP\u2026 at 2026-09-15 09:45 UTC, 4.5 to 5 hours before launch; bought 2.053% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "DoJq1bYbWcr2RFhufkdUfvC39F8SmrbrLvAsjbcG6YBe", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.075 SOL by B48kNVXs4Y\u2026 at 2026-09-15 09:57 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "6MRhWx53DFj2u9L23wQRUWQt3YqRhQhBe1E75cdBWW9J", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.084 SOL by iGdFcQoyR2\u2026 at 2026-09-15 10:01 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "4AGFvMCSEXF78fyf6xAdvjFHkgCvXUXpctVaG2m2CQKb", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.061 SOL by BmFdpraQhk\u2026 at 2026-09-15 09:59 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "76A9MvgRNturJikyv8RJjhF12iaafT1nedC3pdffufjt", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (3 txs) funded 1.034 SOL by 41uCv6a1JP\u2026 at 2026-09-15 10:01 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.811% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" },
      { chain: SOL, address: "3C66znKxJAKzG9EKUn6jkzEaRxMRWX9B6qh5qHwAgQrU", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.051 SOL by 83yG2brNva\u2026 at 2026-09-15 09:56 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk\u2026 history)" }
    ],
    accounts: [
      { handle: "stonkspark", role: "project", label: "$PARK project account (recycled serial-memecoin handle)", evidence: "joined May 2024, 331 followers and 8 following on 2026-09-16; GMGN rename history shows 13 renames with twelve 2024 Solana memecoin handles (grammahsol, studymillis, paralympicssol, jimmyspysol, ribsolana, retardblinders, donnieonsol, harry_solana1, irs_onsolana, sam_catman1, salsa_sol1, barrybutchersol) and 3 deleted tweets; posted animated episodes 2026-09-15 and 09-16 and paid DexScreener ads ($598 Dex Paid)" }
    ],
    launches: [
      { chain: SOL, address: "7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5", symbol: "PARK", name: "STONKS PARK", launchedAt: "2026-09-15T14:41:13Z", venue: "pump.fun (Token-2022 mint), graduated to PumpSwap 2026-09-16 12:53 UTC with the LP burned", outcome: "curve-scalped", note: "43 buys in the first 20 slots took 44.65% of supply; slot 0 and 1 took 10.84% including the 2.75% dev buy; eight fresh wallets funded about 1.05 SOL each from five high-throughput hubs 5 hours before launch took 10.5% (five bought an identical 0.811% in slot +13) and all but one exited by slot +20; early buyers bought 41.2% and held 1.9% on 2026-09-16; post-graduation tape 35,298 txs in the first hour on about 920 holders and $26k liquidity; graduation took 22 hours", evidence: "bonding-curve account 7fQP9eZk6xPVULLETYEfcHFQYSA1sbYQnd3BxJWMeD6C signature history (3,880 txs) and first 150 trades decoded 2026-09-16; mint signature count 40,000+ from 2026-09-16 13:32 UTC; GMGN 2026-09-16: snipers 4.04%, bundler 17.3%, dev 2.75%" },
      { chain: SOL, address: "5NK9STFaivRDScQnF5VwE7zwdEfFpKRd3BwhPPYuBAGS", symbol: "Aigob", name: "TRUMP GUARDRAIL GOBLIN", launchedAt: "2026-09-15T14:50:40Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 191.7 SOL by HCEtGKAaKT\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3Ycuq1veGFj4\u2026 at 2026-09-15T14:50:40Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "BfRMi3osCEn76huxCMiPqvyfWz9YwzfzdViMa83Bmoon", symbol: "XIDRAG", name: "XIANGHAI DRAGON", launchedAt: "2026-09-15T14:53:14Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 441.1 SOL by HU2MFdEZzx\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3dGcn1LNXJTX\u2026 at 2026-09-15T14:53:14Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "AbEtvmjR9afBvjVY4hxzqLxN3xmFoCwAEXCofVgmoon", symbol: "ROBAI", name: "Roblox Puppet", launchedAt: "2026-09-15T15:06:22Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 372.4 SOL by Gf7adCBCyU\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3Kiv9FrLmSKe\u2026 at 2026-09-15T15:06:22Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "CeHRqHs1adSwco4nGfRnC47ME8EdUVMhCce5HVABBAGS", symbol: "MLBWC", name: "MLB WILDCARD", launchedAt: "2026-09-15T15:09:35Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 351.3 SOL by DDe2JJPAmE\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx fpZqpBi3GtpZ\u2026 at 2026-09-15T15:09:35Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "DtA6FUsUY4nK9HLYr8L3sZRNQUPKZfLxhtMB9qvJpump", symbol: "Tayrock", name: "Taylor Rocket", launchedAt: "2026-09-15T15:51:30Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 335.1 SOL by 9Nin9rBdPt\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx H7hw4KeCkUQC\u2026 at 2026-09-15T15:51:30Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "Ap8gWjgA9YdJQpMTeyAEqn6YP7rP3UC82GDvYWYipump", symbol: "DRONKRA", name: "NATO DRONE KRAKEN", launchedAt: "2026-09-15T16:04:51Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 421.2 SOL by 9FNHre7R3S\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx HHM3MeUbvnk3\u2026 at 2026-09-15T16:04:51Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "8qhtfGY1v6WtK75WgMGaWcw1DUT3rXEu5R9LPQqVbonk", symbol: "IRSPYGL", name: "Iran Spyglass", launchedAt: "2026-09-15T20:55:47Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 450.9 SOL by 4nTdq49rcf\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 4fMftHUgjdVr\u2026 at 2026-09-15T20:55:47Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "G5QriGjyai2hkwC1Vw6rBm8jQZaib7kceecayKCoBAGS", symbol: "ORBCROWN", name: "Orbit Crown", launchedAt: "2026-09-15T21:09:29Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 401.0 SOL by 3n74UMjHoG\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 4awtrUJtE1Va\u2026 at 2026-09-15T21:09:29Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "HFKHqyJroRgU9j9hVya2rqm48T5WJwrU1KStygwABAGS", symbol: "Uclcrab", name: "CHAMPIONS CRAB", launchedAt: "2026-09-15T21:19:06Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 400.6 SOL by CwXYLnAi7q\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3wCQ458SrD2T\u2026 at 2026-09-15T21:19:06Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "5mwnJgccHmRBv5HkqaQ3zs83nnGABR6p2L9UscRSBAGS", symbol: "Dunworm", name: "DUNE SANDWORM", launchedAt: "2026-09-15T21:32:33Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 415.4 SOL by ECmgGJqYLD\u2026 naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 54Jx3m4ExoAi\u2026 at 2026-09-15T21:32:33Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" }
    ]
  },
  {
    id: "rh-farm-idx9000",
    name: "IDX9000 self-launch and dividend pivot",
    kind: "launch-farm",
    intent: "nefarious",
    summary: "One operator launched the same IDX token twice on Pons V2 within fifteen minutes, buying 36% and then 30% of supply in the creation transactions and selling every token back into the curve within minutes, then claimed the confiscated creator tax and bridged 2.59 ETH to BNB Chain. An hour before the last exit the deployer redirected the token's creator-fee stream to a Pons holder-rewards escrow, and the website, X account and a paid caller appeared after that, selling the token as a SPY-dividend index. The exit wallet re-entered with a small position nine minutes before the domain was registered.",
    firstSeen: "2026-09-14",
    lastSeen: "2026-09-16",
    wallets: [
      { chain: RH, address: "0x5cfdc3ee06936ea4d0522eaa444a863d89bf39d6", role: "deployer", label: "IDX deployer (EIP-7702 account, 69 txs)", evidence: "funded 0.5 ETH at 2026-09-14 03:50 UTC from the 5,845 ETH hot wallet 0x53091256\u2026; launched 0x8db9cbfa\u2026 at 04:52 with a 36.4% dev buy for 2.516 SPY and sold it by 04:57; launched 0xcd4e70bf\u2026 at 05:02:50 via PonsV2LaunchAndBuy with a 30.11% dev buy for 1.898 SPY (tx 0xff312ea8\u2026), sold 7.53%, 7.45% and 5.13% into the curve at 05:04 to 05:05, 7.49% at 14:39 to 14:48 and 2.51% into the graduated pool at 15:40; six PonsV2FeeEscrow claimToken calls took 1.137 SPY plus 0.132 SPY on the first token; called PonsV2LaunchFactory.transferCreatorFeeRecipient to escrow 0xaa10a1ca\u2026 at 16:37:05; last tx 16:40; holds 0" },
      { chain: RH, address: "0xe00244b4f2f63b034dbf9d3e88cdfd606ad950df", role: "off-ramp", label: "exit wallet on BNB Chain and Robinhood, serial Pons sniper", evidence: "recipient of all seven deployer RelayDepository deposits (2.5946 ETH, 9.07 BNB) resolved via api.relay.link on 2026-09-16; the same address on Robinhood Chain has 1,587 txs since 2026-07-09, 34 Relay bridge-outs and approvals on dozens of PonsV2LauncherTokens; bought 0.39% of IDX at 2026-09-14 17:37 UTC and held 0.37% on 2026-09-16 while receiving the SPY holder drips" },
      { chain: RH, address: "0xde42eaab9559311dca35ea946091021c69f557a3", role: "kol-wallet", label: "@YusufGemz FOMO-verified EVM wallet (FomoScan attribution)", evidence: "FomoScan record for FOMO account YusufGemz (read 2026-09-17; FOMO holds no X link, binding rests on the name and the $500-$10K challenge bio matching his X). Bought 22.8M IDX through RelayRouterV3 0xb92fe925 in six buys 2026-09-14 16:35-19:58 UTC, the first 3.6 h before his first public $IDX call at 20:12; moved 16.5M to 0xff218593 before the call and 6.1M after; holds 1.13M; 9 txs, 0 ETH on Robinhood (funds arrive bridged). Also received 555K PONSAN in the 8 h before his 2026-09-05 PONSAN call (small)." },
      { chain: RH, address: "0xff2185935502c11811268a443f7651c3db5d3145", role: "kol-wallet", label: "@YusufGemz second wallet (EIP-7702 account, delegate 0xe8b12077\u2026)", evidence: "received IDX only from 0xde42eaab (22.06M across 2026-09-14 17:17 to 2026-09-16 13:01) and 3.6M from router 0x8366a39c; sold 23.8M IDX in 1M-lot chunks to contract 0x36dc95f1 from 2026-09-15 14:32 UTC (18 h after the first call) through the 2026-09-16 11:11 and 17:09 calls; 57 txs, 0.47 ETH (read 2026-09-17)" },
      { chain: SOL, address: "EkeSXXNqPc5bvxeLgPmAQoVjwTPUB4k8hzNHDmfQ4S9p", role: "kol-wallet", label: "@YusufGemz FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account YusufGemz (read 2026-09-17); FOMO cash flow 30 d net -$985 on $94k volume, 359 trades. Not yet traced against his Solana calls." }
    ],
    accounts: [
      { handle: "IDX_RH", role: "project", label: "$IDX9000 project account (appeared after the exit)", evidence: "joined September 2026; 45 posts by 2026-09-16 in a two-hour cadence framing IDX9000 as an index; follows MEADGod, ponsdotfamily, RobinhoodApp and RobinhoodCrypto; domain index9000.xyz registered on Namecheap 2026-09-14 17:46 UTC, 66 minutes after the deployer's last transaction" },
      { handle: "YusufGemz", role: "kol", label: "Yusuf \xB7 paid caller (34.4k followers, Telegram channel)", evidence: "first $IDX mention 2026-09-14 20:12 UTC ('My $SPX friend never miss') at about an $80k cap, then four more calls to 2026-09-16 17:09 ('$1M next', 'Quant told me next phase coming') riding the cap from $227k to $435k; bio 'Alpha Frontrunner', private Telegram ('YG CABAL'); backtest of 28 priced calls 2026-08-31 to 09-16: median +24 h -15%, +72 h -18%, 20 of 28 under water at +72 h, $PONSAN -99%, $4AI -90%, $DOGE-1 -97% after 'called it early in the YG cabal' posts (RESEARCH.md, KOL call backtest)" }
    ],
    launches: [
      { chain: RH, address: "0x8db9cbfa0c1a4bb474db19c5d92590f5b03f70eb", symbol: "IDX", name: "IDX (first attempt)", launchedAt: "2026-09-14T04:52:36Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "36.4% dev buy for 2.516 SPY in the creation tx, sold in two transactions at 04:56 and 04:57 UTC, creator tax claimed at 04:57 and 0.367 ETH bridged out at 04:58; never graduated, no DexScreener pair", evidence: "deployer token-transfer history on Blockscout read 2026-09-16" },
      { chain: RH, address: "0xcd4e70bfd73952123449e453f08c12e44ab89e58", symbol: "IDX", name: "IDX9000", launchedAt: "2026-09-14T05:02:50Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "curve quoted in tokenized SPY; 30.11% dev buy sold in full by 15:40 UTC; 25 wallets took 23.97% in blocks +54 to +61 and three later buy clusters landed within four blocks of each dev sell; graduated 15:40 UTC with 8.16% in PonsV2LaunchLocker (position 2697526); creator-fee recipient moved to the Pons holder-rewards escrow 0xaa10a1ca\u2026 at 16:37, which has paid SPY to holders every 90 minutes since; on 2026-09-16 Robinhood-app retail bought 18.5% of supply in 24 h through RobinHoodSettler while aggregator and MEV bots sold 53%", evidence: "transfer logs from block 62544585 read 2026-09-16 via rpc.mainnet.chain.robinhood.com; PonsV2LaunchFactory.transferCreatorFeeRecipient decoded on Blockscout; DexScreener 2026-09-16: $358k cap, $49k liquidity, $235k 24h volume, 540 holders" }
    ]
  }
];
var walletKey = (chain, address) => `${chain.trim().toLowerCase()}:${chain.trim().toLowerCase() === "solana" ? address.trim() : address.trim().toLowerCase()}`;
var walletIndex = null;
var launchIndex = null;
var handleIndex = null;
function buildIndexes() {
  walletIndex = /* @__PURE__ */ new Map();
  launchIndex = /* @__PURE__ */ new Map();
  handleIndex = /* @__PURE__ */ new Map();
  for (const cabal of CABALS) {
    for (const wallet of cabal.wallets) {
      if (!/^0x[0-9a-f]{40}$/i.test(wallet.address) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.address)) continue;
      const k = walletKey(wallet.chain, wallet.address);
      const matches = walletIndex.get(k) ?? [];
      matches.push({ cabal, wallet });
      walletIndex.set(k, matches);
    }
    for (const launch of cabal.launches) {
      launchIndex.set(walletKey(launch.chain, launch.address), { cabal, launch });
    }
    for (const account of cabal.accounts) {
      const h = account.handle.replace(/^@/, "").toLowerCase();
      const list = handleIndex.get(h) ?? [];
      list.push({ cabal, account });
      handleIndex.set(h, list);
    }
  }
}
function findCabalWallets(chain, address) {
  if (!chain || !address) return [];
  if (!walletIndex) buildIndexes();
  return [...walletIndex.get(walletKey(chain, address)) ?? []];
}
var CABAL_REGISTRY_VERSION = (() => {
  let hash = 2166136261;
  for (const char of JSON.stringify(CABALS)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `curated-${(hash >>> 0).toString(16)}`;
})();

// src/lib/marketAddresses.ts
var SOLANA_CEX_WALLETS = {
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Binance",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": "Binance",
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": "Binance",
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: "Coinbase",
  H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS: "Coinbase",
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": "Coinbase",
  FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5: "Kraken",
  AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS: "OKX",
  "5VVBHtk2QQBy5rZ2pBdgcb4yj9DBYy8tDksBs2pWnUKr": "Bybit",
  "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": "Gate.io",
  "6gnCPhXtLnUD76HjQuSYPENLSZdG8RvDB1pTLM5aLSss": "MEXC"
};
var EVM_CEX_WALLETS = {
  "0x28c6c06298d514db089934071355e5743bf21d60": "Binance",
  "0x21a31ee1afc51d94c2efccaa2092ad1028285549": "Binance",
  "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": "Binance",
  "0x56eddb7aa87536c09ccc2793473599fd21a8b17f": "Binance",
  "0xf977814e90da44bfa03b6295a0616a897441acec": "Binance",
  "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": "Coinbase",
  "0x503828976d22510aad0201ac7ec88293211d23da": "Coinbase",
  "0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740": "Coinbase",
  "0x3cc936b795a188f0e246cbb2d74c5bd190aecf18": "OKX",
  "0x2b5634c42055806a59e9107ed44d43c426e58258": "Kucoin",
  "0x0d0707963952f2fba59dd06f2b425ace40b492fe": "Gate.io",
  "0xf89d7b9c864f589bbF53a82105107622B35EaA40": "Bybit",
  // Merged from the EVM deployer route, which had been carrying a longer list of
  // its own. Every one of these is exchange custody, so holder concentration was
  // counting them as insider wallets on any token they hold float in.
  "0x9696f59e4d72e237be84ffd425dcad154bf96976": "Binance",
  "0x4976a4a02f38326660d17bf34b431dc6e2eb2327": "Binance",
  "0x0681d8db095565fe8a346fa0277bffde9c0edbbf": "Binance",
  "0xddb1b4c4fb1e19bd353bc07d1d46c87d67b8e1e0": "Coinbase",
  "0x3cd751e6b0078be393132286c442345e5dc49699": "Coinbase",
  "0xeb2629a2734e272bcc07bda959863f316f4bd4cf": "Coinbase",
  "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": "Coinbase",
  "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": "Kraken",
  "0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13": "Kraken",
  "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": "OKX",
  "0x236f9f97e0e62388479bf9e5ba4889e46b0273c3": "OKX",
  "0x1522900b6dafac587d499a862861c0869be6e428": "Bitfinex"
};
var EVM_MARKET_CONTRACTS = {
  "0x000000000004444c5dc75cb358380d2e3de08a90": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x498581ff718922c3f8e6a244956af099b2652b2b": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x360e68faccca8ca495c1b759fd9eee466db9fb32": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x9a13f98cb987694c9f086b1f5eb990eea8264ec3": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x67366782805870060151383f4bbff9dab53e5cd6": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df": { label: "Uniswap V4 PoolManager", kind: "pool" },
  "0x8366a39cc670b4001a1121b8f6a443a643e40951": { label: "Uniswap V4 PoolManager (Robinhood Chain)", kind: "pool" },
  "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544": { label: "Doppler LP custody (Robinhood Chain)", kind: "locker" },
  "0xbdf938149ac6a781f94faa0ed45e6a0e984c6544": { label: "Doppler LP custody (Base)", kind: "locker" },
  "0x267444d099b10fb5ed7c3cc7b7c767adca574952": { label: "Pons v2 launch locker", kind: "locker" },
  "0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f": { label: "RobinhoodLocker", kind: "locker" }
};
var normalize = (address) => {
  const value = String(address ?? "").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : value;
};
var lookup = (map, address) => {
  const direct = map[address];
  if (direct) return direct;
  const lowered = normalize(address);
  for (const [candidate, name] of Object.entries(map)) {
    if (normalize(candidate) === lowered) return name;
  }
  return void 0;
};
function classifyMarketAddress(address, context2 = {}) {
  const value = String(address ?? "").trim();
  if (!value) return null;
  const pool = (context2.poolAddresses ?? []).some((candidate) => normalize(candidate) === normalize(value));
  if (pool) return { label: "liquidity pool", kind: "pool" };
  const exchange = lookup(SOLANA_CEX_WALLETS, value) ?? lookup(EVM_CEX_WALLETS, value);
  if (exchange) return { label: exchange, kind: "exchange" };
  const market = EVM_MARKET_CONTRACTS[normalize(value)];
  if (market) return market;
  const known = context2.knownAccounts?.[value];
  const type = String(known?.type ?? "").toUpperCase();
  if (type === "AMM" || type === "MARKET" || type === "POOL") {
    return { label: known?.name?.trim() || "liquidity pool", kind: "pool" };
  }
  if (type === "LOCKER" || type === "VAULT") {
    return { label: known?.name?.trim() || "locked vault", kind: "locker" };
  }
  if (type === "EXCHANGE" || type === "CEX") {
    return { label: known?.name?.trim() || "exchange", kind: "exchange" };
  }
  return null;
}

// src/lib/holderIntelligence.ts
var HOLDER_TARGET = 25;
function buildHolderIntelligence(input) {
  const identity = tokenSubjectIdentity(input.chain, input.tokenAddress);
  const chain = identity?.chain ?? input.chain;
  const notes = [];
  let invalidRows = 0;
  const unique = /* @__PURE__ */ new Map();
  const accounts = /* @__PURE__ */ new Set();
  for (const row of input.rows) {
    const address = input.aggregateOwners ? row.owner : row.address;
    const key = tokenSubjectIdentity(chain, address);
    if (!key || !identity || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100) {
      invalidRows++;
      continue;
    }
    const account = tokenSubjectIdentity(chain, row.address)?.ref;
    if (!account || accounts.has(account)) {
      invalidRows++;
      continue;
    }
    accounts.add(account);
    const previous = unique.get(key.ref);
    if (previous) {
      if (input.aggregateOwners && previous.address !== row.address) previous.percent += row.percent;
      else invalidRows++;
    } else unique.set(key.ref, { ...row, address: row.address, ...input.aggregateOwners ? { owner: key.address } : {} });
  }
  const all = [...unique.values()].sort((a, b) => b.percent - a.percent);
  const consistent = all.reduce((sum, row) => sum + row.percent, 0) <= 100.01;
  if (!consistent) notes.push("Provider rows exceed total supply; percentages are not a valid concentration measure.");
  if (invalidRows) notes.push(`${invalidRows} invalid or duplicate provider rows were not used; coverage is incomplete.`);
  if (input.aggregateOwners) notes.push("Token accounts were grouped by their reported owners. Owners outside this provider sample may rank higher.");
  if (!input.ranked) notes.push("The provider sample does not establish the globally largest 25 holders.");
  const rows = all.slice(0, HOLDER_TARGET).map((row, index) => {
    const address = row.owner ?? row.address;
    const market = classifyMarketAddress(address, { poolAddresses: input.poolAddresses, knownAccounts: input.knownAccounts });
    const burn = /^0x0{40}$/i.test(address) || /^0x0{36}dead$/i.test(address);
    const matches = findCabalWallets(chain, address).map(({ cabal, wallet }) => ({
      registryId: cabal.id,
      name: cabal.name,
      role: wallet.role,
      label: wallet.label ?? wallet.role,
      evidence: wallet.evidence,
      lastSeen: cabal.lastSeen,
      intent: cabal.intent,
      attribution: "curated-record"
    }));
    return {
      ...row,
      address,
      rank: index + 1,
      role: market?.kind ?? (burn ? "burn" : row.isContract ? "unclassified-contract" : "unattributed"),
      roleEvidence: market?.label ?? (burn ? "Exact burn address" : null),
      matches
    };
  });
  const complete = input.ranked && !input.aggregateOwners && consistent && !invalidRows && (rows.length === HOLDER_TARGET || input.completeUniverse === true);
  if (!complete) notes.push(`${rows.length}/${HOLDER_TARGET} addresses examined; the requested holder investigation remains incomplete.`);
  return {
    version: 1,
    chain,
    tokenAddress: identity?.address ?? input.tokenAddress,
    capturedAt: input.capturedAt,
    source: input.source,
    sourceUrl: input.sourceUrl ?? null,
    block: input.block ?? null,
    registryVersion: CABAL_REGISTRY_VERSION,
    target: HOLDER_TARGET,
    status: !rows.length ? "unavailable" : complete ? "complete" : "partial",
    ranking: input.aggregateOwners ? "observed-owners" : input.ranked ? "ranked-addresses" : "unranked-sample",
    examined: rows.length,
    matched: rows.filter((row) => row.matches.length).length,
    supplyCoveredPct: consistent ? rows.reduce((sum, row) => sum + row.percent, 0) : null,
    invalidRows,
    notes,
    enrichment: { arkham: "not-run", fomo: "not-run" },
    rows
  };
}

// src/threat/net.ts
var legacyContext;
var contextForRequest;
function hasThreatApiContext() {
  return !!(contextForRequest?.() ?? legacyContext)?.base;
}

// src/lib/officialXProfile.ts
var X_RESERVED_PATHS = /* @__PURE__ */ new Set([
  "i",
  "home",
  "search",
  "intent",
  "share",
  "hashtag",
  "explore",
  "settings",
  "messages",
  "notifications",
  "compose",
  "login",
  "signup",
  "privacy",
  "tos",
  "about",
  "download",
  "jobs",
  "help"
]);
function officialXProfileHandle(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["https:", "http:"].includes(url.protocol) || host !== "x.com" && host !== "twitter.com") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length !== 1) return null;
    const handle = segments[0];
    if (!/^[A-Za-z0-9_]{2,30}$/.test(handle) || X_RESERVED_PATHS.has(handle.toLowerCase())) return null;
    return handle;
  } catch {
    return null;
  }
}

// src/lib/decisionBoundary.ts
var CAP_BOUNDARIES = {
  honeypot_confirmed: {
    ceiling: 10,
    controllingFact: "The saved tradeability evidence shows that holders may not be able to sell.",
    unlockCondition: "A fresh successful buy-and-sell receipt, together with contract evidence showing the restriction is gone, must replace the failed result.",
    evidenceArea: "contract"
  },
  cannot_sell_all: {
    ceiling: 10,
    controllingFact: "The contract does not allow a holder to sell their full balance.",
    unlockCondition: "A fresh trade receipt must show a full-balance sell succeeds and the contract restriction no longer applies.",
    evidenceArea: "contract"
  },
  owner_can_modify_balance: {
    ceiling: 20,
    controllingFact: "An active controller can directly change holder balances.",
    unlockCondition: "A current chain receipt must show that the balance-changing authority was permanently removed or cannot be exercised.",
    evidenceArea: "contract"
  },
  balance_mutable_authority: {
    ceiling: 20,
    controllingFact: "An active authority can rewrite token balances.",
    unlockCondition: "A current chain receipt must show that the balance-mutating authority was permanently revoked.",
    evidenceArea: "contract"
  },
  serial_scammer_creator: {
    ceiling: 25,
    controllingFact: "The attributed creator wallet has previously created tokens recorded as honeypots.",
    unlockCondition: "Primary creation records must reattribute this token to a different wallet, or the source record behind the prior honeypot link must be corrected.",
    evidenceArea: "contract"
  },
  mint_authority_active: {
    ceiling: 35,
    controllingFact: "More tokens can still be created by an active mint authority.",
    unlockCondition: "A current chain receipt must show that the mint authority was permanently revoked.",
    evidenceArea: "contract"
  },
  freeze_authority_active: {
    ceiling: 35,
    controllingFact: "An active freeze authority can stop token accounts from moving funds.",
    unlockCondition: "A current chain receipt must show that the freeze authority was permanently revoked.",
    evidenceArea: "contract"
  },
  reclaimable_ownership: {
    ceiling: 35,
    controllingFact: "The saved contract record shows hidden or reclaimable ownership control.",
    unlockCondition: "A current contract-authority receipt must show that ownership cannot be hidden, reclaimed, or exercised.",
    evidenceArea: "contract"
  },
  single_wallet_majority_supply: {
    ceiling: 39,
    controllingFact: "One assessed non-market wallet controls at least half of the token supply.",
    unlockCondition: "A comparable current holder register must show that no non-market wallet holds a majority of supply.",
    evidenceArea: "holders"
  },
  documented_scanner_concealment: {
    ceiling: 55,
    controllingFact: "The verified contract source documents behavior intended to conceal activity from scanners.",
    unlockCondition: "New verified source code and matching deployed-bytecode receipts must show that the concealment behavior was removed.",
    evidenceArea: "contract"
  },
  single_wallet_concentration: {
    ceiling: 69,
    controllingFact: "One assessed non-market wallet holds at least a quarter of the token supply.",
    unlockCondition: "A comparable current holder register must show the largest non-market wallet below the concentration threshold.",
    evidenceArea: "holders"
  },
  few_wallet_concentration: {
    ceiling: 69,
    controllingFact: "The three largest assessed material wallets hold at least 60% of supply between them.",
    unlockCondition: "A comparable current holder register must show those wallets below the concentration threshold.",
    evidenceArea: "holders"
  },
  ofac_sanctioned_address: {
    ceiling: 5,
    controllingFact: "A wallet bound to this report matched a current sanctions record.",
    unlockCondition: "A current official sanctions record must show the address is no longer designated, or primary attribution evidence must correct the address binding.",
    evidenceArea: "contract"
  }
};
var MARKET_CANNOT_OVERRIDE = "Higher price, volume, liquidity, followers, or social activity cannot override this safety limit.";
function largestHeadroom(axes) {
  const ranked = axes.filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0).map((axis) => ({ axis, points: Math.max(0, axis.weight - axis.score) })).sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}
function largestContribution(axes) {
  const ranked = axes.filter((axis) => Number.isFinite(axis.score) && Number.isFinite(axis.weight) && axis.weight > 0).map((axis) => ({ axis, points: Math.max(0, axis.score) })).sort((a, b) => b.points - a.points || a.axis.key.localeCompare(b.axis.key));
  return ranked[0] && ranked[0].points > 0 ? ranked[0] : null;
}
function areaForAxis(axis) {
  if (!axis) return "method";
  if (axis.key === "T1") return "liquidity";
  if (axis.key === "T2" || axis.key === "T3") return "contract";
  if (axis.key === "T4") return "holders";
  if (axis.key === "T5" || axis.key === "T6") return "market";
  return "method";
}
function deriveTokenDecisionBoundary(input) {
  if (input.score === null || !Number.isFinite(input.score)) return null;
  const score = Math.max(0, Math.min(100, Math.round(input.score)));
  if (input.capApplied) {
    const rule = CAP_BOUNDARIES[input.capApplied.toLowerCase()];
    if (!rule) {
      return {
        schemaVersion: 1,
        kind: "unknown_cap",
        controllingFact: "A saved safety limit controls this result, but this report does not contain a public explanation for that limit.",
        boundary: `The saved score is ${score}/100. ARGUS will not infer the missing ceiling.`,
        willNotChange: MARKET_CANNOT_OVERRIDE,
        unlockCondition: "Open the methodology receipt for the saved limit before treating this result as movable.",
        evidenceArea: "method"
      };
    }
    return {
      schemaVersion: 1,
      kind: "cap",
      controllingFact: rule.controllingFact,
      boundary: `This finding caps the score at ${rule.ceiling}/100, even if every other scored area improves.`,
      willNotChange: MARKET_CANNOT_OVERRIDE,
      unlockCondition: rule.unlockCondition,
      evidenceArea: rule.evidenceArea
    };
  }
  if (score < 70) {
    const threshold = score < 40 ? 40 : 70;
    const nextVerdict = score < 40 ? "CAUTION" : "PASS";
    const gap = threshold - score;
    const headroom = largestHeadroom(input.axes);
    const headroomCopy = !headroom ? "The saved axes contain no unused scoring headroom." : headroom.points >= gap ? `${headroom.axis.label} has ${headroom.points} points of unused headroom on paper, enough to cross the boundary only if new evidence earns those points.` : `${headroom.axis.label} has the most unused headroom at ${headroom.points} points, so no single scored area can cross the boundary by itself.`;
    return {
      schemaVersion: 1,
      kind: "threshold",
      controllingFact: `${gap} evidence-backed point${gap === 1 ? "" : "s"} separate this score from ${nextVerdict}.`,
      boundary: headroomCopy,
      willNotChange: "Price movement, volume, or social attention alone does not add points to this saved report.",
      unlockCondition: `A new scan must verify enough changed evidence to add ${gap} point${gap === 1 ? "" : "s"}; arithmetic headroom is not a prediction.`,
      evidenceArea: areaForAxis(headroom?.axis)
    };
  }
  const buffer = score - 69;
  const contribution = largestContribution(input.axes);
  const pressure = contribution && contribution.points >= buffer ? `${contribution.axis.label} contributes ${contribution.points} points and is large enough by itself to erase that buffer if its evidence materially deteriorates.` : "No single scored area is large enough by itself to erase the current buffer.";
  return {
    schemaVersion: 1,
    kind: "buffer",
    controllingFact: `${buffer} point${buffer === 1 ? "" : "s"} separate this score from falling below PASS.`,
    boundary: pressure,
    willNotChange: "Short-term price or social movement does not change the saved PASS result.",
    unlockCondition: "Only a new scan with materially different verified evidence can move this boundary.",
    evidenceArea: areaForAxis(contribution?.axis)
  };
}

// src/graph/network.ts
var EVM_ADDRESS2 = /^0x[0-9a-f]+$/i;
var SOLANA_ADDRESS2 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function normalizeChain(chain) {
  return String(chain).trim().toLowerCase();
}
function normalizeAddress(chain, address) {
  const value = String(address).trim();
  return normalizeChain(chain) !== "solana" && EVM_ADDRESS2.test(value) ? value.toLowerCase() : value;
}
function tokenEntityKey(chain, address) {
  return `token:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function walletEntityKey(chain, address) {
  return `wallet:${normalizeChain(chain)}:${normalizeAddress(chain, address)}`;
}
function canonical(raw) {
  const value = String(raw).trim();
  let m = value.match(/^token:([^:]+):(.+)$/i);
  if (m) return tokenEntityKey(m[1], m[2]);
  m = value.match(/^(?:wallet|holder|funder):([^:]+):(.+)$/i);
  if (m) return walletEntityKey(m[1], m[2]);
  m = value.match(/^(?:token|mint):(.+)$/i);
  if (m && EVM_ADDRESS2.test(m[1])) return tokenEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS2.test(m[1])) return tokenEntityKey("solana", m[1]);
  m = value.match(/^(?:wallet|holder|funder):(.+)$/i);
  if (m && EVM_ADDRESS2.test(m[1])) return walletEntityKey("evm", m[1]);
  if (m && SOLANA_ADDRESS2.test(m[1])) return walletEntityKey("solana", m[1]);
  m = value.match(/^([^:]+):(.+)$/);
  if (m && (EVM_ADDRESS2.test(m[2]) || normalizeChain(m[1]) === "solana" && SOLANA_ADDRESS2.test(m[2]))) {
    return walletEntityKey(m[1], m[2]);
  }
  if (SOLANA_ADDRESS2.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower;
  return lower.replace(/^@/, "");
}
var GENERIC_KEYS = /* @__PURE__ */ new Set([
  "site",
  "website",
  "web",
  "twitter",
  "x",
  "telegram",
  "discord",
  "github",
  "docs",
  "documentation",
  "medium",
  "linktree",
  "whitepaper",
  "mail",
  "email",
  "youtube",
  "tiktok",
  "instagram",
  "reddit",
  "facebook",
  "warpcast",
  "farcaster",
  "coingecko",
  "dexscreener",
  "linkedin",
  "blog",
  "other",
  "unknown"
]);
var isGenericKey = (raw) => GENERIC_KEYS.has(canonical(raw));
var CONTEXT_ONLY_EDGE_TYPES = /* @__PURE__ */ new Set([
  "INVESTED_IN",
  "AFFILIATED_WITH",
  "ARKHAM_ENTITY",
  "ARKHAM_RISK_CONTEXT",
  "ARKHAM_TRANSACTION_CONTEXT"
]);
function contextOnlyNodeKeys(contribution, resolve) {
  const byNode = /* @__PURE__ */ new Map();
  for (const edge of contribution.edges) {
    const type = String(edge.type).toUpperCase();
    for (const endpoint of [resolve(edge.src), resolve(edge.dst)]) {
      const types = byNode.get(endpoint) ?? [];
      types.push(type);
      byNode.set(endpoint, types);
    }
  }
  return new Set([...byNode.entries()].filter(([, types]) => types.length > 0 && types.every((type) => CONTEXT_ONLY_EDGE_TYPES.has(type))).map(([key]) => key));
}
function buildAliasResolver(contributions) {
  const targets = /* @__PURE__ */ new Map();
  const add = (alias2, subject) => {
    const a = canonical(alias2);
    if (!a) return;
    const set = targets.get(a) ?? /* @__PURE__ */ new Set();
    set.add(subject);
    targets.set(a, set);
  };
  const DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
  for (const c of contributions) {
    const rawSubject = c.nodes.find((n) => n.subject)?.key ?? c.handle;
    const subj = canonical(String(rawSubject));
    const addressBacked = subj.startsWith("token:");
    if (String(c.handle).startsWith("$")) add(c.handle, subj);
    if (!addressBacked) continue;
    for (const alias2 of c.aliases ?? []) add(alias2, subj);
    const subjectNode = c.nodes.find((n) => n.subject);
    if (subjectNode) {
      if (typeof subjectNode.label === "string") add(subjectNode.label, subj);
      if (typeof subjectNode.symbol === "string") add("$" + subjectNode.symbol.replace(/^\$/, ""), subj);
    }
    for (const e of c.edges) {
      if (canonical(e.src) !== subj) continue;
      const dst = String(e.dst);
      if (e.type === "TEAM" && dst.startsWith("@")) add(dst, subj);
      else if (e.type === "LINKS" && DOMAIN.test(dst)) add(dst, subj);
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const [alias2, ids] of targets) if (ids.size === 1) unique.set(alias2, [...ids][0]);
  return (key) => {
    const id = canonical(key);
    return unique.get(id) ?? id;
  };
}
function subjectConnections(handle, contributions, max = 12) {
  const resolve = buildAliasResolver(contributions);
  const me = resolve(handle);
  const mine = /* @__PURE__ */ new Map();
  for (const c of contributions) {
    if (resolve(c.handle) !== me) continue;
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      const label = typeof n.label === "string" && n.label.trim() ? n.label : String(n.key);
      if (k !== me && !contextOnly.has(k)) mine.set(k, { label, type: String(n.type) });
    }
  }
  if (!mine.size) return [];
  const byOther = /* @__PURE__ */ new Map();
  const ensure = (id, label, verdict) => {
    if (!byOther.has(id)) byOther.set(id, { label, verdict, ties: /* @__PURE__ */ new Map(), direct: false });
    return byOther.get(id);
  };
  for (const c of contributions) {
    const other = resolve(c.handle);
    if (other === me) continue;
    const otherLabel = c.aliases?.[0] ?? (typeof c.nodes.find((n) => n.subject)?.label === "string" ? String(c.nodes.find((n) => n.subject).label) : c.handle);
    const contextOnly = contextOnlyNodeKeys(c, resolve);
    if (mine.has(other)) {
      const e = ensure(other, otherLabel, c.verdict);
      e.direct = true;
    }
    for (const n of c.nodes) {
      if (isGenericKey(String(n.key))) continue;
      const k = resolve(n.key);
      if (k !== me && k !== other && mine.has(k) && !contextOnly.has(k)) {
        const e = ensure(other, otherLabel, c.verdict);
        e.ties.set(k, { key: k, label: mine.get(k).label, type: mine.get(k).type });
      }
    }
  }
  return [...byOther.entries()].map(([, v]) => ({ other: v.label, otherVerdict: v.verdict, ties: [...v.ties.values()], direct: v.direct })).filter((x) => x.ties.length > 0 || x.direct).sort((a, b) => Number(b.direct) - Number(a.direct) || b.ties.length - a.ties.length).slice(0, max);
}

// src/lib/priceHistory.ts
var NETWORK = {
  solana: "solana",
  ethereum: "eth",
  eth: "eth",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  polygon: "polygon_pos",
  "polygon_pos": "polygon_pos",
  avalanche: "avax",
  avax: "avax",
  optimism: "optimism",
  fantom: "ftm",
  sui: "sui",
  ton: "ton",
  tron: "tron",
  blast: "blast",
  sei: "sei-evm"
};
var PERIOD_SECONDS = { day: 86400, hour: 3600 };
var VOLUME_WINDOW_MAX = 7;
var GT = "https://api.geckoterminal.com/api/v2";
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
function readCandle(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const ts = finiteNumber(row[0]);
  const close = finiteNumber(row[4]);
  if (ts === void 0 || close === void 0) return null;
  const high = finiteNumber(row[2]);
  const low = finiteNumber(row[3]);
  const volumeUsd = finiteNumber(row[5]);
  return {
    ts,
    close,
    ...high === void 0 ? {} : { high },
    ...low === void 0 ? {} : { low },
    ...volumeUsd === void 0 || volumeUsd < 0 ? {} : { volumeUsd }
  };
}
function candleRange(series, last) {
  const measured = series.filter((candle) => candle.high !== void 0 && candle.low !== void 0 && candle.low > 0 && candle.low <= candle.close && candle.high >= candle.close);
  if (!measured.length) return {};
  const high = Math.max(...measured.map((candle) => candle.high));
  const low = Math.min(...measured.map((candle) => candle.low));
  return {
    range: {
      high,
      low,
      drawdownFromHighPct: high > 0 ? (last - high) / high * 100 : 0,
      measuredPoints: measured.length,
      ...measured.length === series.length ? {
        highs: measured.map((candle) => candle.high),
        lows: measured.map((candle) => candle.low)
      } : {}
    }
  };
}
function volumeWindow(candles) {
  const measured = candles.filter((candle) => candle.volumeUsd !== void 0);
  return {
    usd: measured.reduce((total, candle) => total + candle.volumeUsd, 0),
    candles: candles.length,
    measured: measured.length
  };
}
function volumeTrend(series) {
  const width = Math.min(VOLUME_WINDOW_MAX, Math.floor(series.length / 2));
  if (width < 2) return {};
  const recent = volumeWindow(series.slice(series.length - width));
  const prior = volumeWindow(series.slice(series.length - width * 2, series.length - width));
  if (!recent.measured || !prior.measured || prior.usd <= 0) return {};
  return {
    volume: {
      recent,
      prior,
      changePct: (recent.usd - prior.usd) / prior.usd * 100,
      isFloor: recent.measured < recent.candles || prior.measured < prior.candles
    }
  };
}
function windowShape(series, count, timeframe) {
  const period = PERIOD_SECONDS[timeframe];
  const span = series[series.length - 1].ts - series[0].ts;
  if (!period || span <= 0) return {};
  const spanPeriods = Math.round(span / period) + 1;
  if (spanPeriods < count) return {};
  return { spanPeriods, windowIsPartial: count < spanPeriods };
}
function summarizeCandles(candles, timeframe) {
  const series = [...candles].sort((left, right) => left.ts - right.ts).filter((candle) => candle.close > 0);
  if (!series.length) return null;
  const points = series.map((candle) => candle.close);
  const first = points[0];
  const last = points[points.length - 1];
  const peak = Math.max(...points);
  return {
    points,
    first,
    last,
    peak,
    changePct: first > 0 ? (last - first) / first * 100 : 0,
    drawdownPct: peak > 0 ? (last - peak) / peak * 100 : 0,
    ...candleRange(series, last),
    ...volumeTrend(series),
    ...windowShape(series, points.length, timeframe)
  };
}
async function gt(path, fetchImpl2 = fetch) {
  try {
    const r = await fetchImpl2(`${GT}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8e3)
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
async function topPool(network, address, fetchImpl2 = fetch) {
  const d = await gt(`/networks/${network}/tokens/${address}/pools?page=1`, fetchImpl2);
  const rows = record(d).data;
  const first = Array.isArray(rows) ? record(rows[0]) : {};
  const attributes = record(first.attributes);
  const id = typeof attributes.address === "string" ? attributes.address : typeof first.id === "string" ? first.id : void 0;
  return id ? id.replace(`${network}_`, "") : null;
}
async function fetchPriceHistory(address, chain, pairAddress, fetchImpl2 = fetch) {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || await topPool(network, address, fetchImpl2);
  if (!pool) return null;
  for (const timeframe of ["day", "hour"]) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${timeframe}?aggregate=1&limit=200&currency=usd`, fetchImpl2);
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const candles = Array.isArray(rawList) ? rawList.map(readCandle).filter((candle) => candle !== null) : [];
    if (candles.length < 3) continue;
    const summary = summarizeCandles(candles, timeframe);
    if (!summary || summary.points.length < 3) continue;
    return { ...summary, timeframe, capturedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  return null;
}
async function fetchOhlcv(address, chain, pairAddress, timeframe) {
  const network = NETWORK[chain?.toLowerCase()] ?? chain?.toLowerCase();
  if (!network || !address) return null;
  const pool = pairAddress || await topPool(network, address);
  if (!pool) return null;
  for (const tf of timeframe ? [timeframe] : ["day", "hour"]) {
    const d = await gt(`/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=1&limit=200&currency=usd`);
    const rawList = record(record(record(d).data).attributes).ohlcv_list;
    const candles = (Array.isArray(rawList) ? rawList.map(readCandle).filter((candle) => candle !== null) : []).filter((candle) => candle.close > 0).sort((left, right) => left.ts - right.ts);
    if (candles.length < 3) continue;
    return { candles, timeframe: tf };
  }
  return null;
}

// src/lib/providerCapabilities.ts
var ENABLED_VALUE = /^(?:1|true|on|enabled)$/i;
var DISABLED_VALUE = /^(?:0|false|off|disabled)$/i;
function arkhamProviderEnabled() {
  const raw = String(import.meta.env?.VITE_ARKHAM_PROVIDER_ENABLED ?? "").trim();
  if (!raw) return true;
  if (DISABLED_VALUE.test(raw)) return false;
  return ENABLED_VALUE.test(raw);
}

// src/token/scannerEvasion.ts
var DETECTOR_PATTERNS = [
  [/\bgmgn\b/i, "GMGN"],
  [/\bhoneypot\.is\b/i, "honeypot.is"],
  [/\btoken\s*sniffer\b/i, "TokenSniffer"],
  [/\bgo\s*plus\b/i, "GoPlus"],
  [/\bquick\s*intel\b/i, "QuickIntel"],
  [/\bde\.fi\b|\bdefi\s*scanner\b/i, "De.Fi scanner"],
  [/\bdex\s*tools\b/i, "DEXTools"],
  [/\brug\s*(?:check|checker|screen)s?\b/i, "rug checker"],
  [/\bhoneypot\b/i, "honeypot detection"],
  [/\btrade\s*restriction\b/i, "trade-restriction detection"],
  [/\bscanner?s?\b|\bdetector\b|\bbot\s*checks?\b/i, "automated scanners"]
];
var CONCEALMENT_INTENT = [
  /\b(?:hide|hides|hidden|hiding|mask|masks|masked|disguise|disguises|obfuscate|obfuscates|conceal|conceals|spoof|spoofs|fake|fakes)\b/i,
  /\b(?:bypass|bypasses|evade|evades|evasion|dodge|dodges|trick|tricks|fool|fools|defeat|defeats)\b/i
];
var EVASION_INTENT = [
  /\b(?:stop|stops|stopped|prevent|prevents|avoid|avoids|bypass|bypasses|evade|evades|dodge|defeat|suppress)\b/i,
  /\bso\s+(?:it|they|we)\s+(?:do(?:es)?n'?t|won'?t|will\s+not|no\s+longer)\b/i,
  /\b(?:not|never|no\s+longer)\s+(?:get\s+)?(?:flag\w*|detect\w*|mark\w*|catch|caught|picked\s+up)\b/i,
  /\b(?:hide|hides|hidden|mask|masks|disguise)\b/i
];
var FLAGGING_VERB = /\b(?:flag|flags|flagged|flagging|detect|detects|detected|detection|mark|marks|marked|trigger|triggers|caught|catch|report|reports|classif\w*)\b/i;
var COMMENT = /\/\/[^\n\r]{4,400}|\/\*[\s\S]{4,1200}?\*\//g;
function cleanComment(raw) {
  return raw.replace(/^\s*\/\*+/, "").replace(/\*+\/\s*$/, "").replace(/^\s*\/\/+/gm, "").replace(/^\s*\*+/gm, "").replace(/\s+/g, " ").trim();
}
function sourceComments(source) {
  const out = [];
  for (const match of source.matchAll(COMMENT)) {
    const text = cleanComment(match[0]);
    if (text.length < 12) continue;
    if (/^SPDX-License-Identifier/i.test(text)) continue;
    out.push(text);
  }
  return out;
}
function detectScannerEvasion(source) {
  if (!source || typeof source !== "string") return [];
  const findings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const comment of sourceComments(source)) {
    const detectors = [...new Set(
      DETECTOR_PATTERNS.filter(([pattern]) => pattern.test(comment)).map(([, name]) => name)
    )];
    if (!detectors.length) continue;
    if (!EVASION_INTENT.some((pattern) => pattern.test(comment))) continue;
    if (!FLAGGING_VERB.test(comment)) continue;
    const key = comment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = CONCEALMENT_INTENT.some((pattern) => pattern.test(comment)) ? "concealment" : "tuning";
    findings.push({ quote: comment.slice(0, 300), detectors, kind });
    if (findings.length >= 3) break;
  }
  return findings;
}
function scannerEvasionClaim(finding) {
  const surfaces = finding.detectors.slice(0, 2).join(" and ");
  if (finding.kind === "concealment") {
    return `The verified contract source documents concealing behaviour from ${surfaces}: "${finding.quote}" The behaviour stays and the detector is blinded to it, so a clean contract result here is not evidence the behaviour is absent.`;
  }
  return `The deployer writes about ${surfaces} in the contract source: "${finding.quote}" Read as stated, the flagged behaviour was removed rather than hidden, so the clean scanner result is accurate. It is recorded because a deployer iterating against scanner heuristics is worth knowing, not because it is misconduct.`;
}

// src/token/cloneCheck.ts
var ORDERING_MARGIN_MS = 6e4;
var BURST_WINDOW_MS = 15 * 6e4;
var DEFAULT_LOOKUP_LIMIT = 8;
var LOOKUP_CONCURRENCY = 4;
var SEARCH_TIMEOUT_MS = 8e3;
var LOOKUP_TIMEOUT_MS = 9e3;
var EVM_ADDRESS3 = /^0x[0-9a-f]{40}$/i;
var INVISIBLE = new RegExp("[\\u200B-\\u200F\\u2060\\uFEFF]|\\p{Cc}", "gu");
function normalizeTicker(symbol) {
  if (!symbol || typeof symbol !== "string") return "";
  return symbol.normalize("NFKC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim().toUpperCase();
}
function mintKey(chain, address) {
  return `${chain}:${EVM_ADDRESS3.test(address) ? address.toLowerCase() : address}`;
}
async function rugcheckFirstSeen(mint, chain, fetchImpl2 = fetch) {
  if (chain !== "solana") return null;
  try {
    const response = await fetchImpl2(
      `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const body = await response.json();
    const at = typeof body?.detectedAt === "string" ? Date.parse(body.detectedAt) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}
async function searchSameTicker(symbol, fetchImpl2) {
  try {
    const response = await fetchImpl2(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }
    );
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body?.pairs) ? body.pairs : [];
  } catch {
    return null;
  }
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function foldByMint(pairs, ticker) {
  const byMint = /* @__PURE__ */ new Map();
  const deepestPool = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    const chain = pair.chainId;
    if (!address || !chain) continue;
    if (normalizeTicker(pair.baseToken?.symbol) !== ticker) continue;
    const key = mintKey(chain, address);
    const created = num(pair.pairCreatedAt);
    const liquidity = num(pair.liquidity?.usd);
    const row = byMint.get(key);
    if (!row) {
      byMint.set(key, {
        mint: address,
        chain,
        pairCreatedAt: created,
        firstSeenAt: created,
        firstSeenBasis: created === null ? "unknown" : "listing",
        liquidityUsd: liquidity,
        marketCapUsd: num(pair.marketCap) ?? num(pair.fdv),
        url: pair.url ?? null
      });
      deepestPool.set(key, liquidity ?? -1);
      continue;
    }
    if (created !== null && (row.pairCreatedAt === null || created < row.pairCreatedAt)) {
      row.pairCreatedAt = created;
      row.firstSeenAt = created;
      row.firstSeenBasis = "listing";
    }
    if (liquidity !== null) row.liquidityUsd = (row.liquidityUsd ?? 0) + liquidity;
    if (liquidity !== null && liquidity > (deepestPool.get(key) ?? -1)) {
      deepestPool.set(key, liquidity);
      row.marketCapUsd = num(pair.marketCap) ?? num(pair.fdv) ?? row.marketCapUsd;
      if (pair.url) row.url = pair.url;
    }
  }
  return byMint;
}
function lookupTargets(audited, peers, limit) {
  const auditedAt = audited.firstSeenAt;
  const earlier = peers.filter((peer) => peer.firstSeenAt !== null && (auditedAt === null || peer.firstSeenAt < auditedAt)).sort((a, b) => (a.firstSeenAt ?? 0) - (b.firstSeenAt ?? 0));
  const deepest = [...peers].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  const picked = [audited];
  const seen = /* @__PURE__ */ new Set([mintKey(audited.chain, audited.mint)]);
  for (const candidate of [...earlier, ...deepest]) {
    if (picked.length >= limit) break;
    const key = mintKey(candidate.chain, candidate.mint);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
  }
  return picked;
}
async function applyCreationTimes(targets, resolve, fetchImpl2) {
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const row = targets[cursor++];
      const createdAt = await resolve(row.mint, row.chain, fetchImpl2).catch(() => null);
      if (createdAt === null) continue;
      if (row.pairCreatedAt === null || createdAt <= row.pairCreatedAt + ORDERING_MARGIN_MS) {
        row.firstSeenBasis = "creation";
      }
      row.firstSeenAt = row.firstSeenAt === null ? createdAt : Math.min(row.firstSeenAt, createdAt);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, targets.length) }, worker));
}
var usd = (value) => `$${Math.round(value).toLocaleString("en-US")}`;
var plural = (count, one, many) => count === 1 ? one : many;
function describeSpan(ms, round) {
  const span = Math.max(0, ms);
  if (span < 90 * 6e4) {
    const minutes = Math.max(1, round(span / 6e4));
    return `${minutes} ${plural(minutes, "minute", "minutes")}`;
  }
  if (span < 48 * 36e5) {
    const hours = Math.max(1, round(span / 36e5));
    return `${hours} ${plural(hours, "hour", "hours")}`;
  }
  const days = Math.max(1, round(span / 864e5));
  return `${days} ${plural(days, "day", "days")}`;
}
var COUNT_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so that count is a floor.";
var SWEEP_IS_A_FLOOR = "A clone with no liquidity pool is often not listed at all, so this sweep can miss one.";
var CHECK_ADDRESS = "Check the contract address before you buy.";
function earliestNote(ticker, auditedAt, clones) {
  const burst = clones.filter((clone) => clone.firstSeenAt !== null && clone.firstSeenAt <= auditedAt + BURST_WINDOW_MS);
  const rest2 = clones.length - burst.length;
  const tail = rest2 > 0 ? ` ${rest2} more ${plural(rest2, "has", "have")} used the ticker since. ${COUNT_IS_A_FLOOR}` : ` ${COUNT_IS_A_FLOOR}`;
  if (!burst.length) {
    return `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}, every one of them first seen after this mint. ${CHECK_ADDRESS}${tail}`;
  }
  const window = describeSpan(
    Math.max(...burst.map((clone) => (clone.firstSeenAt ?? auditedAt) - auditedAt)),
    Math.ceil
  );
  const deepest = Math.max(...burst.map((clone) => clone.liquidityUsd ?? 0));
  const money = deepest > 0 ? `, the largest holding ${usd(deepest)} of liquidity` : ", none of them with any liquidity";
  return `${burst.length} other ${plural(burst.length, "token", "tokens")} using the ticker $${ticker} appeared within ${window} of this one${money}. ${CHECK_ADDRESS}${tail}`;
}
function laterNote(ticker, gapMs, audited, earliest) {
  const theirs = earliest.liquidityUsd ?? 0;
  const ours = audited.liquidityUsd ?? 0;
  let money = "";
  if (theirs > 0) {
    money = ours > 0 ? `, holding ${usd(theirs)} of liquidity against this mint's ${usd(ours)}` : `, holding ${usd(theirs)} of liquidity where this mint has none`;
  }
  return `This is not the first mint using the ticker $${ticker}. Another appeared ${describeSpan(gapMs, Math.floor)} earlier at ${earliest.mint}${money}. ${CHECK_ADDRESS} Which mint the project itself issued is not something these timestamps settle.`;
}
async function checkForClones(input, options = {}) {
  const fetchImpl2 = options.fetchImpl ?? fetch;
  const resolveCreatedAt = options.resolveCreatedAt ?? rugcheckFirstSeen;
  const limit = options.lookupLimit ?? DEFAULT_LOOKUP_LIMIT;
  const ticker = normalizeTicker(input.symbol);
  const chain = input.chain;
  const callerPairCreatedAt = num(input.pairCreatedAt);
  const callerLiquidity = num(input.liquidityUsd);
  if (!ticker || !input.mint || !chain) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: "There is no ticker to sweep for, so no same ticker mint has been ruled in or out."
    };
  }
  const pairs = await searchSameTicker(ticker, fetchImpl2);
  if (pairs === null) {
    return {
      audited: "unresolved",
      clones: [],
      checked: false,
      note: `The ticker sweep for $${ticker} did not complete, so no same ticker mint has been ruled in or out.`
    };
  }
  const byMint = foldByMint(pairs, ticker);
  const auditedKey = mintKey(chain, input.mint);
  const audited = byMint.get(auditedKey) ?? {
    mint: input.mint,
    chain,
    pairCreatedAt: callerPairCreatedAt,
    firstSeenAt: callerPairCreatedAt,
    firstSeenBasis: callerPairCreatedAt === null ? "unknown" : "listing",
    liquidityUsd: callerLiquidity,
    marketCapUsd: null,
    url: null
  };
  if (callerPairCreatedAt !== null && (audited.pairCreatedAt === null || callerPairCreatedAt < audited.pairCreatedAt)) {
    audited.pairCreatedAt = callerPairCreatedAt;
    audited.firstSeenAt = audited.firstSeenAt === null ? callerPairCreatedAt : Math.min(audited.firstSeenAt, callerPairCreatedAt);
    audited.firstSeenBasis = "listing";
  }
  if (callerLiquidity !== null) audited.liquidityUsd = callerLiquidity;
  byMint.set(auditedKey, audited);
  const clones = [...byMint.values()].filter((row) => mintKey(row.chain, row.mint) !== auditedKey);
  if (!clones.length) {
    return {
      audited: "only",
      clones: [],
      checked: true,
      note: `No other mint using the ticker $${ticker} is listed on dexscreener. ${SWEEP_IS_A_FLOOR}`
    };
  }
  await applyCreationTimes(lookupTargets(audited, clones, limit), resolveCreatedAt, fetchImpl2);
  clones.sort((a, b) => (a.firstSeenAt ?? Infinity) - (b.firstSeenAt ?? Infinity));
  const auditedAt = audited.firstSeenAt;
  const dated = clones.filter((clone) => clone.firstSeenAt !== null);
  const cohort = `${clones.length} other ${plural(clones.length, "mint uses", "mints use")} the ticker $${ticker}`;
  if (auditedAt === null || !dated.length) {
    return {
      audited: "unresolved",
      clones,
      checked: true,
      note: `${cohort}. There is no public creation record to order them against this mint, so which came first is unsettled. ${CHECK_ADDRESS}`
    };
  }
  const earliest = dated[0];
  if (earliest.firstSeenAt + ORDERING_MARGIN_MS <= auditedAt) {
    const gap = auditedAt - earliest.firstSeenAt;
    if (audited.firstSeenBasis !== "creation") {
      return {
        audited: "unresolved",
        clones,
        checked: true,
        note: `${cohort}, and one at ${earliest.mint} has a public record ${describeSpan(gap, Math.floor)} older than this mint's first listing. A first listing can trail a mint by hours, so that does not establish which was minted first. ${CHECK_ADDRESS}`
      };
    }
    return {
      audited: "later",
      clones,
      checked: true,
      earliestMint: earliest.mint,
      note: laterNote(ticker, gap, audited, earliest)
    };
  }
  if (auditedAt + ORDERING_MARGIN_MS <= earliest.firstSeenAt) {
    return {
      audited: "earliest",
      clones,
      checked: true,
      earliestMint: audited.mint,
      note: earliestNote(ticker, auditedAt, clones)
    };
  }
  return {
    audited: "unresolved",
    clones,
    checked: true,
    note: `${cohort}, first seen within ${describeSpan(Math.abs(auditedAt - earliest.firstSeenAt), Math.ceil)} of this one, too close together to order. ${CHECK_ADDRESS}`
  };
}

// src/lib/retry.ts
async function retryFetch(input, init, attempts = 3, fetchImpl2 = fetch) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      init?.signal?.throwIfAborted();
      const res = await fetchImpl2(input, init);
      if (res.ok || res.status !== 429 && res.status < 500) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * 2 ** i));
  }
  throw lastErr;
}
async function retryFetchWithFreshTimeout(input, timeoutMs, init = {}, attempts = 2, fetchImpl2 = fetch) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchImpl2(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status !== 429 && response.status < 500) return response;
      lastErr = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastErr = error;
    }
    if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** i));
  }
  throw lastErr;
}

// src/token/sources.ts
var GOPLUS_CHAIN = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  zksync: "324",
  linea: "59144",
  scroll: "534352",
  // Robinhood Chain (Arbitrum stack, mainnet Jul 2026). GoPlus has covered it
  // since launch; ARGUS simply never asked, which left every token on this
  // chain with no safety data, no creator, and therefore no sanctions screen.
  robinhood: "4663"
};
var GOPLUS_UNSORTED_HOLDER_CHAINS = /* @__PURE__ */ new Set(["robinhood"]);
var BLOCKSCOUT_API = {
  robinhood: "https://robinhoodchain.blockscout.com"
};
var BLOCKSCOUT_HOLDER_API = {
  ...BLOCKSCOUT_API,
  base: "https://base.blockscout.com",
  ethereum: "https://eth.blockscout.com"
};
function blockscoutHolderSourceUrl(chain, address) {
  const base = BLOCKSCOUT_HOLDER_API[chain.trim().toLowerCase()];
  return base ? `${base}/api/v2/tokens/${encodeURIComponent(address)}/holders` : null;
}
async function blockscoutContractSource(chain, address, fetchImpl2 = fetch) {
  const base = BLOCKSCOUT_API[chain];
  if (!base) return null;
  try {
    const response = await fetchImpl2(`${base}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(9e3) });
    if (!response.ok) return null;
    const body = await response.json();
    const sourceCode = typeof body?.source_code === "string" ? body.source_code : "";
    if (!sourceCode) return null;
    return {
      name: typeof body?.name === "string" ? body.name : null,
      isVerified: body?.is_verified === true,
      sourceCode: sourceCode.slice(0, 4e5)
    };
  } catch {
    return null;
  }
}
async function blockscoutHolders(chain, address, fetchImpl2 = fetch) {
  const chainKey = chain.trim().toLowerCase();
  const base = BLOCKSCOUT_HOLDER_API[chainKey];
  if (!base) return null;
  const holderSourceUrl = blockscoutHolderSourceUrl(chainKey, address);
  if (!holderSourceUrl) return null;
  try {
    const [tokenRes, holderRes] = await Promise.all([
      fetchImpl2(`${base}/api/v2/tokens/${address}`, { signal: AbortSignal.timeout(9e3) }),
      fetchImpl2(holderSourceUrl, { signal: AbortSignal.timeout(9e3) })
    ]);
    if (!tokenRes.ok || !holderRes.ok) return null;
    const meta = await tokenRes.json();
    const supply = Number(meta?.total_supply ?? 0);
    if (!Number.isFinite(supply) || supply <= 0) return null;
    const body = await holderRes.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const rows = [];
    for (const item of items) {
      const value = Number(item?.value ?? 0);
      const hash = item?.address?.hash;
      if (!hash || !Number.isFinite(value) || value <= 0) continue;
      rows.push({ address: hash, percent: value / supply * 100, isContract: item.address?.is_contract === true });
      if (rows.length >= HOLDER_TARGET) break;
    }
    return rows;
  } catch {
    return null;
  }
}
async function dexByTokenResult(address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pairs: [] };
    const d = await res.json();
    if (d.pairs !== null && !Array.isArray(d.pairs)) return { ok: false, pairs: [] };
    if (d.pairs?.some((p) => !p || typeof p.chainId !== "string" || typeof p.baseToken?.address !== "string")) return { ok: false, pairs: [] };
    return { ok: true, pairs: d.pairs ?? [] };
  } catch {
    return { ok: false, pairs: [] };
  }
}
var CG_PLATFORM = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  avalanche: "avalanche",
  fantom: "fantom"
};
var CG_DEX = /uniswap|pancake|raydium|sushi|curve|balancer|orca|meteora|aerodrome|camelot|quickswap|trader.?joe|\bdex\b/i;
function cleanBlurb(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let s = raw.replace(/<[^>]+>/g, " ").replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_`>#]+/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > 1600) s = `${s.slice(0, 1597).replace(/\s+\S*$/, "").trim()}\u2026`;
  return s;
}
var CG_TIER1 = /binance|coinbase|kraken|okx|bybit|kucoin|gate|crypto\.?com|bitget|upbit|huobi|htx|mexc/i;
async function coingeckoToken(chain, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  const plat = CG_PLATFORM[chain] ?? chain;
  try {
    const res = await request(`https://api.coingecko.com/api/v3/coins/${plat}/contract/${address}?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (res.status === 404) return { listed: false, id: null, rank: null, mcapUsd: null, marketCount: 0, cexCount: 0, cexNames: [], homepage: null, twitter: null, image: null, description: null, categories: [] };
    if (!res.ok) return null;
    const d = await res.json();
    const tickers = d.tickers ?? [];
    const markets = new Set(tickers.map((t) => t.market?.name).filter(Boolean));
    const cex = new Set(tickers.filter((t) => !CG_DEX.test(t.market?.identifier || t.market?.name || "")).map((t) => t.market?.name).filter(Boolean));
    const cexNames = [...cex].sort((a, b) => (CG_TIER1.test(b) ? 1 : 0) - (CG_TIER1.test(a) ? 1 : 0)).slice(0, 12);
    const homepageValue = (d.links?.homepage ?? []).find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    const homepage = typeof homepageValue === "string" ? homepageValue : null;
    const tw = typeof d.links?.twitter_screen_name === "string" ? d.links.twitter_screen_name.replace(/^@/, "").trim() : "";
    const twitter = /^[A-Za-z0-9_]{2,30}$/.test(tw) ? tw : null;
    const image = d.image?.large ?? d.image?.small ?? d.image?.thumb ?? null;
    const athPrice = d.market_data?.ath?.usd;
    const athDate = d.market_data?.ath_date?.usd;
    const athDrawdown = d.market_data?.ath_change_percentage?.usd;
    const ath = athPrice != null || athDate != null || athDrawdown != null ? {
      priceUsd: typeof athPrice === "number" && Number.isFinite(athPrice) ? athPrice : null,
      date: typeof athDate === "string" && athDate.trim() ? athDate : null,
      drawdownPct: typeof athDrawdown === "number" && Number.isFinite(athDrawdown) ? athDrawdown : null
    } : null;
    return {
      listed: true,
      id: typeof d.id === "string" && d.id ? d.id : null,
      rank: d.market_cap_rank ?? null,
      mcapUsd: d.market_data?.market_cap?.usd ?? null,
      marketCount: markets.size,
      cexCount: cex.size,
      cexNames,
      homepage,
      twitter,
      image,
      description: cleanBlurb(d.description?.en),
      categories: (d.categories ?? []).filter((c) => typeof c === "string" && c.trim().length > 0).slice(0, 12),
      ath
    };
  } catch {
    return null;
  }
}
async function dexByPairResult(chain, pair, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`, {
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return { ok: false, pair: null };
    const d = await res.json();
    return { ok: true, pair: d.pair ?? d.pairs?.[0] ?? null };
  } catch {
    return { ok: false, pair: null };
  }
}
function pickPair(pairs, wantAddress) {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const exact = byLiq.find((p) => p.baseToken?.address === wantAddress);
    if (exact) return exact;
    const match = /^0x[0-9a-f]{40}$/i.test(wantAddress) ? byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase()) : void 0;
    if (match) return match;
    return null;
  }
  return byLiq[0];
}
function hasCompleteGoplusTradeability(result) {
  const reported = (value) => typeof value === "string" && value.trim().length > 0;
  return result?.is_in_dex === "1" && reported(result.buy_tax) && reported(result.sell_tax) && reported(result.cannot_sell_all);
}
async function honeypotIs(chainId, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = await res.json();
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((flag) => typeof flag === "string" ? flag : flag.description ?? flag.flag ?? String(flag))
    };
  } catch {
    return null;
  }
}
async function goplusSolana(mint, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  try {
    const res = await request(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = await res.json();
    const row = d.result?.[mint];
    return row ?? null;
  } catch {
    return null;
  }
}
var SOLANA_ADDRESS3 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function supplySharePercent(amount, supply) {
  const balance = Number(amount);
  const total = Number(supply);
  if (!Number.isFinite(balance) || balance < 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const percent = balance / total * 100;
  return percent >= 0 && percent <= 100 ? percent : null;
}
function lockedShare(lpLockedPct, markets) {
  const percent = boundedPercent(lpLockedPct);
  if (percent == null) return null;
  if (percent > 0) return percent;
  const marketsSeen = Array.isArray(markets) ? markets.length : 0;
  return marketsSeen > 0 ? percent : null;
}
function boundedPercent(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const percent = Number(value);
  if (!Number.isFinite(percent)) return null;
  return percent >= 0 && percent <= 100 ? percent : null;
}
function finiteCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}
function parseKnownAccounts(value) {
  const accounts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return accounts;
  for (const [address, entry] of Object.entries(value)) {
    if (!address.trim() || !entry || typeof entry !== "object") continue;
    const record2 = entry;
    accounts[address] = {
      ...typeof record2.name === "string" ? { name: record2.name } : {},
      ...typeof record2.type === "string" ? { type: record2.type } : {}
    };
  }
  return accounts;
}
function largestInsiderClusterPercent(networks) {
  const measured = networks.map((network) => network.percent).filter((percent) => percent != null);
  return measured.length ? Math.max(...measured) : null;
}
async function rugcheckReport(mint, fetchImpl2 = fetch) {
  try {
    const res = await retryFetchWithFreshTimeout(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`, 15e3, {
      headers: { accept: "application/json" }
    }, 2, fetchImpl2);
    if (!res.ok) return null;
    const d = await res.json();
    const creator = typeof d?.creator === "string" && SOLANA_ADDRESS3.test(d.creator.trim()) ? d.creator.trim() : null;
    const supply = d?.token?.supply;
    const networks = Array.isArray(d?.insiderNetworks) ? d.insiderNetworks : [];
    return {
      creator,
      topHolders: (Array.isArray(d.topHolders) ? d.topHolders : []).flatMap((row) => {
        const pct2 = boundedPercent(row.pct);
        return typeof row.address === "string" && typeof row.owner === "string" && pct2 != null ? [{ address: row.address, owner: row.owner, percent: pct2 }] : [];
      }),
      // With no creator there is nobody for a balance to belong to, and a bare
      // zero would read as "the creator sold out" rather than "not measured".
      creatorPercent: creator ? supplySharePercent(d?.creatorBalance, supply) : null,
      lpLockedPct: lockedShare(d?.lpLockedPct, d?.markets),
      rugged: d?.rugged === true,
      knownAccounts: parseKnownAccounts(d?.knownAccounts),
      insiderNetworks: networks.map((network) => ({
        // Null, not zero. A cluster whose wallet count RugCheck did not report
        // is not a cluster of nobody, and "0 linked wallets" is the reading that
        // would talk a reader out of looking.
        size: finiteCount(network?.size ?? network?.activeAccounts),
        percent: supplySharePercent(network?.tokenAmount, supply)
      })),
      graphInsidersDetected: finiteCount(d?.graphInsidersDetected)
    };
  } catch {
    return null;
  }
}
async function goplus(chainId, address, fetchImpl2 = fetch) {
  const request = (url, init) => retryFetch(url, init, 3, fetchImpl2);
  const once = async () => {
    try {
      const res = await request(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`);
      if (!res.ok) return null;
      const d = await res.json();
      return d.result?.[address.toLowerCase()] ?? d.result?.[address] ?? null;
    } catch {
      return null;
    }
  };
  let row = await once();
  if (row && !(row.holders && row.holders.length)) {
    await new Promise((r) => setTimeout(r, 700));
    const retry = await once();
    if (retry?.holders?.length) row = retry;
  }
  return row;
}

// src/token/audit.ts
function deployerRoleLabel(attribution, form = "title") {
  const proven = attribution?.kind === "deployer";
  const base = proven ? "Deployer" : "Creator or authority";
  return form === "wallet" ? `${base} wallet` : base;
}
var EVM_ADDRESS4 = /^0x[0-9a-fA-F]{40}$/;
function sameWalletAddress(a, b) {
  if (EVM_ADDRESS4.test(a) && EVM_ADDRESS4.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}
var SEVERE_RISK_CATEGORY = /sanction|hack|theft|exploit|ransom|scam|phish|stolen|fraud|terror/i;
var FACTORY_ATTRIBUTION_METHOD = "contract factory";
function deployerWalletAddress(d) {
  if (!d.deployer) return null;
  if (d.deployerAttribution?.method === FACTORY_ATTRIBUTION_METHOD) return null;
  return d.deployer;
}
async function resolveTokenSystem(chain, address, fetchImpl2 = fetch) {
  if (chain !== "base" || !/^0xb20[0-9a-f]{37}$/i.test(address)) return void 0;
  try {
    const r = await fetchImpl2(`/api/bytecode?address=${encodeURIComponent(address)}&chain=base`, { signal: AbortSignal.timeout(12e3) });
    if (!r.ok) return void 0;
    const data = await r.json();
    if (!data || typeof data !== "object") return void 0;
    const result = data;
    return result.available === true && result.system === "b20" && result.chain === chain && String(result.address).toLowerCase() === address.toLowerCase() ? "b20" : void 0;
  } catch {
    return void 0;
  }
}
async function resolveEvmCreatorKind(chain, creator, fetchImpl2 = fetch) {
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return "unknown";
  try {
    const r = await fetchImpl2(`/api/bytecode?address=${encodeURIComponent(creator)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(12e3) });
    if (!r.ok) return "unknown";
    const d = await r.json();
    if (d?.available !== true || typeof d.isContract !== "boolean") return "unknown";
    return d.isContract ? "contract" : "wallet";
  } catch {
    return "unknown";
  }
}
async function screenDeployerRisk(address, fetchImpl2 = fetch) {
  if (!arkhamProviderEnabled()) return void 0;
  if (!address || address.length < 8) return void 0;
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return void 0;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const r = await fetchImpl2(`/api/deployer-risk?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(18e3) });
    if (!r.ok) return { available: false, paths: [], completedAt };
    const d = await r.json();
    if (d?.available !== true) return { available: false, paths: [], completedAt };
    return {
      available: true,
      paths: Array.isArray(d.paths) ? d.paths : [],
      briefing: d.briefing,
      completedAt
    };
  } catch {
    return { available: false, paths: [], completedAt };
  }
}
var SIGNED_THE_CREATION = /* @__PURE__ */ new Set(["mint feePayer", "creation-tx fee payer"]);
async function resolveDeployerViaRoute(mint, fetchImpl2 = fetch) {
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return null;
  try {
    const r = await fetchImpl2(`/api/resolve-deployer?mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(2e4) });
    if (!r.ok) return null;
    const d = await r.json();
    const address = typeof d?.deployer === "string" ? d.deployer.trim() : "";
    if (!address) return null;
    const via = typeof d?.via === "string" && d.via.trim() ? d.via.trim() : "resolver";
    return { address, source: "helius", method: via, kind: SIGNED_THE_CREATION.has(via) ? "deployer" : "attributed" };
  } catch {
    return null;
  }
}
async function screenAddressSanctions(chain, addresses, fetchImpl2 = fetch) {
  const unique = [...new Set(addresses.filter((a) => typeof a === "string" && a.length > 8))].slice(0, 40);
  if (!unique.length) {
    return {
      available: false,
      checked: 0,
      sanctioned: [],
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      reason: "no_screenable_addresses"
    };
  }
  const origin = globalThis.location?.origin;
  if (!origin && !hasThreatApiContext()) return void 0;
  const completedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    const r = await fetchImpl2(
      `/api/sanctions?addresses=${encodeURIComponent(unique.join(","))}&chain=${encodeURIComponent(chain)}`,
      { signal: AbortSignal.timeout(9e3) }
    );
    if (!r.ok) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
    const d = await r.json();
    if (d?.available !== true) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
    return {
      available: true,
      checked: typeof d.checked === "number" ? d.checked : unique.length,
      listSize: typeof d.listSize === "number" ? d.listSize : void 0,
      sanctioned: Array.isArray(d.sanctioned) ? d.sanctioned.filter((a) => typeof a === "string") : [],
      completedAt
    };
  } catch {
    return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" };
  }
}
function washSignatureFor(m) {
  const volumeKnown = Number.isFinite(m.vol24) && m.vol24 >= 0;
  const depthKnown = Number.isFinite(m.liquidityUsd) && m.liquidityUsd >= 0;
  const vol = volumeKnown ? m.vol24 : 0;
  const liq = depthKnown ? m.liquidityUsd : 0;
  const ratio = liq > 0 ? vol / liq : 0;
  const txns = (m.buys ?? 0) + (m.sells ?? 0);
  const lowDepth = volumeKnown && vol >= 1e4 && (!depthKnown || liq < 1e3);
  const turnover = ratio >= 100 && txns >= 20;
  const churn = ratio >= 15 && m.pc24 != null && Number.isFinite(m.pc24) && Math.abs(m.pc24) < 10 && txns >= 50;
  if (!lowDepth && !turnover && !churn) return { wash: false, anomaly: false, ratio, rationale: "", claim: "" };
  const rationale = lowDepth ? `Liquidity anomaly: $${Math.round(vol).toLocaleString()} reported 24h volume; ${depthKnown ? `$${Math.round(liq).toLocaleString()} current pool liquidity` : "current pool liquidity unavailable"}. Volume/depth ratio is ${liq > 0 ? `${ratio.toFixed(1)}x` : "not measurable"}.` : `Turnover anomaly: 24h volume/current liquidity ${ratio.toFixed(1)}x${churn ? ` with ${m.pc24.toFixed(1)}% net price change` : ""}.`;
  return {
    wash: false,
    anomaly: true,
    ratio,
    rationale,
    claim: `${rationale} Daily volume and current depth cover different observation periods. Check historical liquidity and participant-level trades; these aggregates do not establish coordinated trading.`
  };
}
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var num2 = (s) => s == null || s === "" ? null : Number(s);
var t1 = (s) => s === "1";
var solFlag = (x) => x?.status === "1";
function band(score) {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}
function handleFromUrl(url) {
  const handle = officialXProfileHandle(url);
  return handle ? "@" + handle.toLowerCase() : null;
}
var isBurnAddr = (a) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
var isBurnTag = (t) => /null|burn|dead|0x0{4,}/i.test(t ?? "");
function evmSafety(gp, sim, tokenAddress) {
  const s = sim;
  const goplusTradeabilityAssessed = hasCompleteGoplusTradeability(gp);
  const simulationCompleted = s?.simSuccess === true;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  let lpBurnedPct = 0, lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  let lpRowsSeen = 0, lpSelfPct = 0;
  const selfAddress = (tokenAddress ?? "").trim().toLowerCase();
  for (const h of gp?.lp_holders ?? []) {
    const pct2 = Number(h.percent) * 100;
    if (!Number.isFinite(pct2) || pct2 < 0 || pct2 > 100) continue;
    lpRowsSeen += 1;
    if (selfAddress && (h.address ?? "").trim().toLowerCase() === selfAddress) lpSelfPct += pct2;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct2;
    else if (h.is_locked === 1) lpLockedPct += pct2;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct2);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  const lpRowsAreSelfReferential = lpRowsSeen > 0 && lpSelfPct >= 50 && lpBurnedPct + lpLockedPct === 0;
  const creatorShare = num2(gp?.creator_percent);
  const ownerAddressReported = typeof gp?.owner_address === "string";
  const ownerAddress = (gp?.owner_address ?? "").trim();
  const hiddenOwner = t1(gp?.hidden_owner);
  const takeBack = t1(gp?.can_take_back_ownership);
  return {
    available: !!gp && Object.values(gp).some((v) => v != null && v !== "") || simulationCompleted,
    contractPropertiesAssessed: !!gp && [gp.is_open_source, gp.is_mintable, gp.transfer_pausable, gp.selfdestruct].every((v) => v === "0" || v === "1") && typeof gp.owner_address === "string",
    taxesAssessed: simulationCompleted ? Number.isFinite(s?.buyTax) && Number.isFinite(s?.sellTax) : [num2(gp?.buy_tax), num2(gp?.sell_tax)].every((v) => v != null && Number.isFinite(v) && v >= 0),
    holderCountAssessed: num2(gp?.holder_count) != null && Number.isFinite(num2(gp?.holder_count)),
    simChecked: simulationCompleted,
    tradeabilityAssessed: simulationCompleted || goplusTradeabilityAssessed,
    tradeabilityMethod: simulationCompleted ? "simulation" : goplusTradeabilityAssessed ? "goplus-screen" : void 0,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
    serialScammerCreator: t1(gp?.honeypot_with_same_creator),
    mintable: t1(gp?.is_mintable),
    freezable: false,
    nonTransferable: false,
    // GoPlus omits owner_address when it cannot detect an owner (unmeasured,
    // not renounced), reports the visible 0x0 while hidden_owner says a
    // concealed controller survives the renounce, and can_take_back_ownership
    // says the renounce is reversible. "Renounced" is only true when the owner
    // was measured AND no owner power survives; every other case leaves the
    // owner-power vectors (balance rewrite, blacklist, tax change) live.
    ownerAssessed: ownerAddressReported,
    ownerRenounced: ownerAddressReported && (ownerAddress === "" || /^0x0+$/.test(ownerAddress)) && !hiddenOwner && !takeBack,
    takeBack,
    hiddenOwner,
    selfdestruct: t1(gp?.selfdestruct),
    pausable: t1(gp?.transfer_pausable),
    openSource: t1(gp?.is_open_source),
    cannotSellAll: t1(gp?.cannot_sell_all),
    metadataMutable: false,
    buyTax: s?.simSuccess ? s.buyTax : (num2(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num2(gp?.sell_tax) ?? 0) * 100,
    holderCount: num2(gp?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: t1(gp?.is_proxy),
    slippageModifiable: t1(gp?.slippage_modifiable) || t1(gp?.personal_slippage_modifiable),
    blacklist: t1(gp?.is_blacklisted),
    tradingCooldown: t1(gp?.trading_cooldown),
    externalCall: t1(gp?.external_call),
    ownerChangeBalance: t1(gp?.owner_change_balance),
    creatorPercent: (creatorShare ?? 0) * 100,
    creatorPercentAssessed: creatorShare != null && Number.isFinite(creatorShare),
    lpAssessed: lpRowsSeen > 0 && !lpRowsAreSelfReferential
  };
}
function recordObservedTradeability(safety, market) {
  if (safety.tradeabilityAssessed || market.buys24h <= 0 || market.sells24h <= 0 || market.liquidityUsd <= 0) {
    return safety;
  }
  return {
    ...safety,
    tradeabilityAssessed: true,
    tradeabilityMethod: "observed-market",
    observedBuys24h: market.buys24h,
    observedSells24h: market.sells24h
  };
}
function solanaSafety(sol) {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  let lpRowsSeen = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct2 = Number(h.percent) * 100;
    if (!Number.isFinite(pct2) || pct2 < 0 || pct2 > 100) continue;
    lpRowsSeen += 1;
    if (h.is_locked === 1) lpLockedPct += pct2;
    else lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct2);
  }
  const lpLocked = lpLockedPct >= 50;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol && Object.values(sol).some((v) => v != null && v !== ""),
    contractPropertiesAssessed: !!sol && [sol.mintable?.status, sol.freezable?.status, sol.metadata_mutable?.status].every((v) => v === "0" || v === "1") && Array.isArray(sol.transfer_hook),
    taxesAssessed: sol?.transfer_fee != null && typeof sol.transfer_fee === "object",
    holderCountAssessed: num2(sol?.holder_count) != null && Number.isFinite(num2(sol?.holder_count)),
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
    serialScammerCreator: false,
    // GoPlus's same-creator honeypot flag is EVM-only
    mintable,
    freezable,
    nonTransferable: sol?.non_transferable === "1",
    ownerAssessed: [sol?.mintable?.status, sol?.freezable?.status].every((v) => v === "0" || v === "1"),
    ownerRenounced: !mintable && !freezable,
    // both authorities revoked
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: solFlag(sol?.closable),
    pausable: false,
    openSource: true,
    // n/a on Solana SPL; not penalised
    cannotSellAll: false,
    metadataMutable: solFlag(sol?.metadata_mutable),
    buyTax: 0,
    sellTax: 0,
    holderCount: num2(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct: 0,
    lpLockedPct,
    lpTopUnlockedEoaPct,
    lpAssessed: lpRowsSeen > 0,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    // GoPlus has no creator balance on this chain. The audit fills it in from
    // RugCheck once a creator resolves; until then it stays unmeasured, because
    // a hardcoded 0 published "creator holds nothing" about every Solana token.
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0,
    creatorPercentAssessed: false
  };
}
function emptySafety() {
  return {
    available: false,
    contractPropertiesAssessed: false,
    simChecked: false,
    honeypot: false,
    honeypotOnchain: false,
    serialScammerCreator: false,
    mintable: false,
    freezable: false,
    nonTransferable: false,
    ownerRenounced: false,
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: false,
    pausable: false,
    openSource: false,
    cannotSellAll: false,
    metadataMutable: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 0,
    topHolderPct: null,
    lpLocked: false,
    lpBurnedPct: 0,
    lpLockedPct: 0,
    lpTopUnlockedEoaPct: 0,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0,
    creatorPercentAssessed: false,
    lpAssessed: false
  };
}
var _cache = /* @__PURE__ */ new Map();
var CACHE_TTL = 6e4;
async function auditToken(input, emit, opts) {
  if (input.kind !== "token") return null;
  const cacheRef = input.via === "evm" ? input.ref.toLowerCase() : input.ref;
  const key = `${opts?.chain ?? input.chain ?? ""}:${input.via}:${cacheRef}:${opts?.skipSim ? 1 : 0}:${opts?.collectSocialActivity ? 1 : 0}:${opts?.collectShipping ? 1 : 0}`;
  const hit = opts?.force ? void 0 : _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.d;
  const signal = opts?.deadlineAt != null ? AbortSignal.any([...opts.signal ? [opts.signal] : [], AbortSignal.timeout(Math.max(0, opts.deadlineAt - Date.now()))]) : opts?.signal;
  signal?.throwIfAborted();
  const baseFetch = opts?.fetchImpl ?? fetch;
  const fetchImpl2 = (url, init) => {
    signal?.throwIfAborted();
    return baseFetch(url, { ...init, signal: signal ? AbortSignal.any([signal, ...init?.signal ? [init.signal] : []]) : init?.signal });
  };
  const d = await runTokenAudit(input, emit, { ...opts, signal, fetchImpl: fetchImpl2 });
  signal?.throwIfAborted();
  _cache.set(key, { at: Date.now(), d });
  return d;
}
async function runTokenAudit(input, emit, opts) {
  if (input.kind !== "token") return null;
  const fetcher = opts?.fetchImpl ?? fetch;
  const trace = [];
  const step = (s2) => {
    opts?.signal?.throwIfAborted();
    trace.push(s2);
    emit?.(s2);
  };
  step({ phase: "P0 \xB7 Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener\u2026`, tone: "neutral" });
  let pair = null;
  let allPairs = [];
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) {
      const resolved = await dexByPairResult(m[1], m[2], fetcher);
      if (!resolved.ok) throw new Error("token_market_unavailable");
      pair = resolved.pair;
      if (pair && (pair.chainId !== m[1] || !sameWalletAddress(pair.pairAddress ?? "", m[2]))) throw new Error("token_market_identity_mismatch");
    }
    if (!pair && m) {
      const resolved = await dexByTokenResult(m[2], fetcher);
      if (!resolved.ok) throw new Error("token_market_unavailable");
      allPairs = resolved.pairs.filter((p) => p.chainId === m[1]);
      pair = pickPair(allPairs, m[2]);
    }
  } else {
    const resolved = await dexByTokenResult(input.ref, fetcher);
    if (!resolved.ok) throw new Error("token_market_unavailable");
    allPairs = resolved.pairs.filter((p) => input.via === "solana" ? p.chainId === "solana" : p.chainId !== "solana");
    if (opts?.chain ?? input.chain) allPairs = allPairs.filter((p) => p.chainId === (opts?.chain ?? input.chain));
    pair = pickPair(allPairs, input.ref);
  }
  if (!pair && input.via === "solana" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.ref)) {
    pair = { chainId: "solana", dexId: "unlisted", pairAddress: "", baseToken: { address: input.ref, name: input.ref, symbol: "TOKEN" } };
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 \xB7 Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }
  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const fullyDilutedValuation = pair.fdv ?? pair.marketCap ?? 0;
  const vol24 = pair.volume?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const pc24 = pair.priceChange?.h24 ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 864e5 : void 0;
  const wash = washSignatureFor({ vol24, liquidityUsd: pair.liquidity?.usd ?? NaN, pc24: pair.priceChange?.h24 ?? null, buys, sells });
  const volLiq = wash.ratio;
  const volumeAnomaly = wash.anomaly;
  step({ phase: "Market", label: `$${pair.baseToken.symbol}`, detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`, source: "dexscreener", tone: liquidityUsd < 15e3 ? "warn" : "neutral" });
  const gpChain = GOPLUS_CHAIN[chain];
  let safety = emptySafety();
  let gpEvm = null;
  let sol = null;
  let explorerHolders = null;
  let contractSource = null;
  let deployerAttribution = null;
  let rugcheck = null;
  let lpLockSource = "goplus";
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders\u2026", tone: "neutral" });
    sol = await goplusSolana(address, fetcher);
    safety = solanaSafety(sol);
    if (pair.dexId === "unlisted") {
      if (!safety.available) return null;
      pair.baseToken.name = sol?.metadata?.name || input.ref;
      pair.baseToken.symbol = sol?.metadata?.symbol || "TOKEN";
    }
    const goplusCreator = (sol?.creators ?? []).map((c) => c?.address).find((a) => typeof a === "string" && a.trim().length > 0)?.trim() ?? null;
    const routeResolver = goplusCreator || opts?.skipSim ? Promise.resolve(null) : resolveDeployerViaRoute(address, fetcher).catch(() => null);
    const [routed, rug] = await Promise.all([
      routeResolver,
      rugcheckReport(address, fetcher).catch(() => null)
    ]);
    rugcheck = rug;
    deployerAttribution = goplusCreator ? { address: goplusCreator, source: "goplus", method: "metadata creator", kind: "attributed" } : routed ?? (rug?.creator ? { address: rug.creator, source: "rugcheck", method: "creator field", kind: "attributed" } : null);
    if (deployerAttribution && rug?.creator === deployerAttribution.address && rug.creatorPercent != null) {
      safety = { ...safety, creatorPercent: rug.creatorPercent, creatorPercentAssessed: true };
    }
    if (!safety.lpAssessed && rug?.lpLockedPct != null) {
      safety = { ...safety, lpLockedPct: rug.lpLockedPct, lpLocked: rug.lpLockedPct >= 50, lpAssessed: true };
      lpLockSource = "rugcheck";
      step({
        phase: "Contract",
        label: "LP lock",
        detail: `RugCheck reports ${rug.lpLockedPct.toFixed(1)}% of the liquidity locked.`,
        source: "rugcheck",
        tone: rug.lpLockedPct >= 50 ? "good" : "warn"
      });
    }
    step(deployerAttribution ? {
      phase: "Contract",
      label: deployerRoleLabel(deployerAttribution),
      detail: `${deployerAttribution.address} via ${deployerAttribution.source} ${deployerAttribution.method}${safety.creatorPercentAssessed ? `, holding ${safety.creatorPercent.toFixed(2)}% of supply` : ", holdings not reported"}.`,
      source: deployerAttribution.source,
      tone: "neutral"
    } : { phase: "Contract", label: "Deployer unresolved", detail: "No source named a creator for this mint, so deployer forensics could not run.", tone: "warn" });
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders\u2026" : "GoPlus + honeypot.is buy/sell simulation\u2026", tone: "neutral" });
    const [gp, sim, explorer, source, system] = await Promise.all([
      goplus(gpChain, address, fetcher),
      opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address, fetcher),
      // Where GoPlus cannot order holders, the chain's own explorer is the
      // only correct distribution source. Runs in parallel: no added latency.
      blockscoutHolders(chain, address, fetcher),
      // What the deployer wrote about their own contract. Free, and the only
      // place an intent to defeat safety scanners is ever stated outright.
      blockscoutContractSource(chain, address, fetcher),
      resolveTokenSystem(chain, address, fetcher)
    ]);
    gpEvm = gp;
    explorerHolders = explorer;
    contractSource = source;
    safety = { ...evmSafety(gp, sim, address), ...system ? { system } : {} };
    safety = recordObservedTradeability(safety, { buys24h: buys, sells24h: sells, liquidityUsd });
    const evmCreator = gp?.creator_address?.trim();
    const evmOwner = gp?.owner_address?.trim();
    const creatorKind = evmCreator && !sameWalletAddress(evmCreator, address) ? await resolveEvmCreatorKind(chain, evmCreator, fetcher) : "unknown";
    deployerAttribution = evmCreator ? creatorKind === "contract" ? { address: evmCreator, source: "goplus", method: FACTORY_ATTRIBUTION_METHOD, kind: "attributed" } : { address: evmCreator, source: "goplus", method: "contract creator", kind: "deployer" } : evmOwner && !/^0x0+$/.test(evmOwner) ? { address: evmOwner, source: "goplus", method: "current owner", kind: "attributed" } : null;
    if (creatorKind === "contract") {
      step({
        phase: "Contract",
        label: "Factory-minted",
        detail: `The creator record ${evmCreator.slice(0, 10)}\u2026 is a contract (a launchpad factory), not a wallet. Deployer history, sell-structure and funding-trace checks are not attributed to it.`,
        source: "goplus",
        tone: "neutral"
      });
    }
    if (explorerHolders?.length) {
      safety = { ...safety, topHolderPct: explorerHolders[0].percent };
    } else if (GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain)) {
      safety = { ...safety, topHolderPct: null };
    }
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }
  const findings = [];
  const caps = [];
  const s = safety;
  let cg = null;
  if (!opts?.skipSim) {
    step({ phase: "Corroborate", label: "CoinGecko cross-check", detail: "Independent listing, CEX markets, market-cap vs FDV\u2026", tone: "neutral" });
    cg = await coingeckoToken(chain, address, fetcher);
  }
  const provablySellable = sells >= 10 && liquidityUsd >= 25e4;
  const broadlyTraded = (cg?.cexCount ?? 0) >= 5 || provablySellable;
  if (s.available) {
    if (s.honeypot) {
      const simOnly = !s.honeypotOnchain && !s.cannotSellAll;
      if (simOnly && broadlyTraded) {
        const why = (cg?.cexCount ?? 0) >= 5 ? `${cg.cexCount} centralized markets` : `${sells} on-chain sells against $${Math.round(liquidityUsd).toLocaleString()} liquidity in 24h`;
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it. ARGUS treats this as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([10, "cannot_sell_all"]);
    const cexN = cg?.cexCount ?? 0;
    const mcap = fdv;
    const established = cexN >= 5 || cexN >= 3 && mcap >= 1e7 || cexN >= 1 && mcap >= 1e8;
    const authorityTone = established ? "warn" : "bad";
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup. Confirm the controller." : "";
    if (s.mintable) {
      if (!established) caps.push([35, "mint_authority_active"]);
      findings.push({ claim: `Mint authority is live: supply can be minted.${govNote}`, tone: authorityTone, source: chain === "solana" ? "goplus-sol" : "goplus" });
    }
    if (s.freezable) {
      if (!established) caps.push([35, "freeze_authority_active"]);
      findings.push({ claim: `Freeze authority is live: the team can freeze token accounts.${govNote}`, tone: authorityTone, source: "goplus-sol" });
    }
    if (s.takeBack || s.hiddenOwner) {
      if (s.hiddenOwner) {
        caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: "Hidden owner detected.", tone: "bad", source: "goplus" });
      } else {
        if (!established) caps.push([35, "reclaimable_ownership"]);
        findings.push({ claim: `Ownership can be reclaimed after renouncement.${govNote}`, tone: authorityTone, source: "goplus" });
      }
    }
    if (s.selfdestruct) findings.push({ claim: "Contract can self-destruct / be closed.", tone: "bad", source: "goplus" });
    for (const evasion of detectScannerEvasion(contractSource?.sourceCode)) {
      const concealed = evasion.kind === "concealment";
      findings.push({ claim: scannerEvasionClaim(evasion), tone: concealed ? "bad" : "warn", source: "contract source" });
      if (concealed) caps.push([55, "documented_scanner_concealment"]);
    }
    if (s.serialScammerCreator) {
      caps.push([25, "serial_scammer_creator"]);
      findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", tone: "bad", source: "goplus" });
    }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Buying and selling worked in the test (${s.buyTax.toFixed(0)}% buy fee / ${s.sellTax.toFixed(0)}% sell fee).`, tone: "good", source: "honeypot.is" });
    if (s.ownerAssessed !== false && s.ownerRenounced && !s.hiddenOwner && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    const ownerActive = !s.ownerRenounced || s.hiddenOwner || s.takeBack;
    const ownerNote = s.ownerAssessed === false ? " The owner could not be identified, so this control is treated as live." : "";
    if (s.ownerChangeBalance && ownerActive) {
      if (broadlyTraded) {
        findings.push({ claim: "GoPlus flags an owner-modify-balance capability, but broad CEX listing and deep liquidity indicate it is a governance/upgrade artifact, not an active threat.", tone: "warn", source: "argus" });
      } else {
        caps.push([20, "owner_can_modify_balance"]);
        findings.push({ claim: `Owner can modify holder balances directly; they can zero your wallet.${ownerNote}`, tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? `Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders.${ownerNote}` : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: `Tax is modifiable: a low tax now can be raised toward 100% after you buy.${ownerNote}`, tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: `Owner can blacklist addresses, so your wallet can be blocked from selling.${ownerNote}`, tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: `Trading cooldown is enforceable, so sells can be delayed.${ownerNote}`, tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls, so behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    const creatorHolder = deployerAttribution && deployerAttribution.kind !== "deployer" ? "The creator or authority wallet" : "Creator";
    if (s.creatorPercent >= 5) findings.push({ claim: `${creatorHolder} still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: chain === "solana" ? "rugcheck" : "goplus" });
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else {
          caps.push([20, "balance_mutable_authority"]);
          findings.push({ claim: "Balance-mutable authority is active. The controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" });
        }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured: a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }
    const lockedByRugcheck = lpLockSource === "rugcheck";
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) and permanently removed; it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: lockedByRugcheck ? `RugCheck reports liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).` : `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: lpLockSource });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet and can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet and removable at will.`, tone: "warn", source: "goplus" });
    else if (s.lpAssessed) findings.push({ claim: lockedByRugcheck ? `RugCheck reports only ~${s.lpLockedPct.toFixed(0)}% of the liquidity locked. Most liquidity is not protected by a verified lock or burn and may be removable.` : "The LP records reviewed do not show meaningful lock or burn protection. Whoever controls the liquidity may be able to remove it.", tone: "warn", source: lpLockSource });
    else findings.push({ claim: "Liquidity protection is unverified. ARGUS could not confirm that the pool's liquidity is locked or permanently burned. Until a locker record with an unlock date, a burn transaction, or equivalent on-chain custody proof is verified, whoever controls the liquidity may be able to remove it.", tone: "warn", source: "argus" });
  }
  if (rugcheck?.rugged) {
    findings.push({
      claim: "RugCheck flags this token as rugged. That is RugCheck's own verdict on the mint, not an on-chain event ARGUS reproduced.",
      tone: "bad",
      source: "rugcheck"
    });
    step({ phase: "Contract", label: "Rugged flag", detail: "RugCheck flags this mint as rugged.", source: "rugcheck", tone: "bad" });
  }
  const insiderClusterPct = rugcheck ? largestInsiderClusterPercent(rugcheck.insiderNetworks) : null;
  const linkedWallets = rugcheck?.graphInsidersDetected ?? null;
  const megaHolderBase = s.holderCount >= 5e4;
  if (!megaHolderBase && insiderClusterPct != null && linkedWallets != null && linkedWallets >= 15) {
    if (insiderClusterPct >= 30) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} wallets to a common funding source, and its largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "bad",
        source: "rugcheck"
      });
    } else if (insiderClusterPct >= 12) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} connected wallets, whose largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "warn",
        source: "rugcheck"
      });
    }
  }
  if (pair.liquidity?.usd != null && Number.isFinite(pair.liquidity.usd) && liquidityUsd < 15e3) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  if (volumeAnomaly) findings.push({ claim: wash.claim, tone: "warn", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h. The token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 1e5) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity. This is a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({
        claim: "No CoinGecko asset was matched. DEX market and trading data are still on record, but a global market-cap rank is not available.",
        tone: "warn",
        source: "coingecko + dexscreener"
      });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap, creating a large unlock or dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }
  const evmHolders = explorerHolders ? explorerHolders.map((holder) => ({
    address: holder.address,
    percent: String(holder.percent / 100),
    is_contract: holder.isContract ? 1 : 0
  })) : GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) ? [] : gpEvm?.holders ?? [];
  const rawHolders = chain === "solana" ? sol?.holders ?? [] : evmHolders;
  const poolAddresses = [
    ...pair?.pairAddress ? [pair.pairAddress] : [],
    ...allPairs.map((candidate) => candidate.pairAddress).filter((value) => Boolean(value))
  ];
  const knownAccounts = rugcheck?.knownAccounts;
  const marketRows = [];
  const walletRows = rawHolders.filter((h) => {
    const address2 = h.address ?? h.account ?? "";
    const market = classifyMarketAddress(address2, { poolAddresses, knownAccounts });
    if (!market) return true;
    const percent = Number(h.percent) * 100;
    marketRows.push({
      address: address2,
      percent: Number.isFinite(percent) ? percent : 0,
      label: market.label,
      kind: market.kind,
      labelledByRugcheck: Boolean(knownAccounts?.[address2]?.type)
    });
    return false;
  });
  const eoaHolders = walletRows.filter((h) => !/^0x(?:0{40}|0{36}dead)$/i.test(h.address ?? h.account ?? ""));
  const topSum = eoaHolders.slice(0, 25).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && rawHolders.every((h) => Number.isFinite(Number(h.percent)) && Number(h.percent) >= 0) && rawHolders.reduce((sum, h) => sum + Number(h.percent) * 100, 0) <= 101;
  const topWalletPct = eoaHolders.length ? Math.max(...eoaHolders.map((h) => Number(h.percent) * 100)) : null;
  const concentrationTopPct = topWalletPct;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  const materialWalletPcts = holdersReliable ? eoaHolders.map((h) => Number(h.percent) * 100).filter((pct2) => Number.isFinite(pct2) && pct2 >= 1).sort((a, b) => b - a) : [];
  const bundleCount = materialWalletPcts.length;
  const topThreeMaterialPct = Math.round(
    materialWalletPcts.slice(0, 3).reduce((total2, pct2) => total2 + pct2, 0)
  );
  const bundleRisk = !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-market wallets each hold at least 1% and up to 15 of the largest non-market wallets hold ~${insiderPct}% combined. This holder snapshot does not establish whether the wallets coordinated.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus"
    });
  }
  if (holdersReliable && topWalletPct != null) {
    if (topWalletPct >= 50) caps.push([39, "single_wallet_majority_supply"]);
    else if (topWalletPct >= 25) caps.push([69, "single_wallet_concentration"]);
  }
  if (holdersReliable && topThreeMaterialPct >= 60) {
    caps.push([69, "few_wallet_concentration"]);
  }
  if (marketRows.length) {
    const named = marketRows.slice(0, 3).map((row) => `${row.label} (${row.percent.toFixed(1)}%)`).join(", ");
    const viaRugcheck = marketRows.some((row) => row.labelledByRugcheck);
    findings.push({
      claim: `Excluded from concentration: ${named}. These are the market itself, not wallets that can dump.${viaRugcheck ? " The labelled venues are RugCheck's own account labels." : ""}`,
      tone: "good",
      source: viaRugcheck ? "rugcheck" : chain === "solana" ? "goplus-sol" : "goplus"
    });
  }
  const axes = [];
  let aT1 = liquidityUsd < 2e3 ? 2 : liquidityUsd < 1e4 ? 6 : liquidityUsd < 5e4 ? 12 : liquidityUsd < 25e4 ? 18 : 22;
  let lpNote = "";
  if (s.lpBurnedPct >= 50) {
    aT1 = clamp(aT1 + 3, 0, 24);
    lpNote = ", LP burned";
  } else if (s.lpLockedPct >= 50) {
    aT1 = clamp(aT1 + 2, 0, 24);
    lpNote = ", LP locked";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 80) {
    aT1 = clamp(aT1 - 6, 0, 24);
    lpNote = ", LP in one unlocked wallet";
  } else if (s.available && s.lpTopUnlockedEoaPct >= 50) {
    aT1 = clamp(aT1 - 4, 0, 24);
    lpNote = ", LP mostly in one wallet";
  } else if (s.available && s.lpAssessed) {
    aT1 = clamp(aT1 - 3, 0, 24);
    lpNote = ", LP not locked";
  } else if (s.available) {
    lpNote = ", liquidity protection unverified";
  }
  axes.push({ key: "T1", label: "Liquidity & lock", score: aT1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${lpNote}.` });
  let aT2 = 26;
  if (!s.available) aT2 = 9;
  else if (chain === "solana") {
    if (s.metadataMutable) aT2 -= 8;
    if (!s.ownerRenounced) aT2 -= 6;
    if (s.transferHook) aT2 -= 8;
  } else {
    if (!s.openSource && s.system !== "b20") aT2 -= 8;
    if (s.pausable) aT2 -= 8;
    if (s.selfdestruct) aT2 -= 10;
    if (!s.ownerRenounced) aT2 -= 4;
    if (s.proxy) aT2 -= s.ownerRenounced ? 3 : 6;
    if (s.externalCall) aT2 -= 3;
    if (!s.ownerRenounced && (s.blacklist || s.tradingCooldown)) aT2 -= 3;
  }
  aT2 = clamp(aT2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: aT2, weight: 26, rationale: s.available ? chain === "solana" ? `${s.ownerRenounced ? "authorities revoked" : "mint/freeze authority active"}${s.metadataMutable ? ", metadata mutable" : ""}.` : `${s.system === "b20" ? "B20 system asset; no per-token source" : s.openSource ? "verified source" : "unverified source"}, ${s.ownerRenounced ? "ownership renounced" : "owner active"}${s.pausable ? ", pausable" : ""}.` : "On-chain safety not verifiable keyless on this chain." });
  const tax = s.buyTax + s.sellTax;
  let aT3 = !s.available ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (s.cannotSellAll || s.nonTransferable) aT3 = 0;
  if (s.slippageModifiable && !s.ownerRenounced) aT3 = clamp(aT3 - 5, 0, 12);
  if (s.transferFee) aT3 = clamp(aT3 - 5, 0, 12);
  const solanaTaxRationale = s.transferFee ? "a Token-2022 transfer fee is configured on this mint." : "no Token-2022 transfer fee is configured.";
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? chain === "solana" ? solanaTaxRationale : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.` : "Tax not verifiable keyless." });
  const topPct = holdersReliable ? concentrationTopPct : null;
  let aT4 = s.holderCount < 50 ? 3 : s.holderCount < 500 ? 7 : s.holderCount < 5e3 ? 11 : 14;
  if (topPct != null) {
    if (topPct > 50) aT4 -= 8;
    else if (topPct > 25) aT4 -= 4;
    else if (topPct > 10) aT4 -= 2;
    else aT4 += 2;
  }
  if (bundleRisk === "high") aT4 = clamp(aT4 - 8, 0, 16);
  else if (bundleRisk === "elevated") aT4 = clamp(aT4 - 4, 0, 16);
  if (s.creatorPercent >= 15) aT4 = clamp(aT4 - 5, 0, 16);
  else if (s.creatorPercent >= 5) aT4 = clamp(aT4 - 2, 0, 16);
  aT4 = clamp(aT4, 0, 16);
  const t4Note = !s.available ? "Holder data not verifiable keyless." : !holdersReliable ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.` : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct < 10 ? topPct.toFixed(2) : topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% across ${bundleCount} non-market wallets holding at least 1% each` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });
  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: volumeAnomaly ? wash.rationale : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells (DexScreener, the selected pair, rolling 24h).` });
  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url }))
  ];
  const hasWebsite = socials.some((x) => /^https?:\/\//i.test(x.url) && !/x\.com|twitter\.com|t\.me|discord|github/i.test(x.url));
  const hasTwitter = socials.some((x) => /x\.com|twitter/i.test(x.url) || /twitter|^x$/i.test(x.label));
  if (cg?.homepage && !hasWebsite) socials.push({ label: "site", url: cg.homepage });
  if (cg?.twitter && !hasTwitter) socials.push({ label: "twitter", url: `https://x.com/${cg.twitter}` });
  let aT6 = ageDays == null ? 4 : ageDays < 1 ? 2 : ageDays < 7 ? 4 : ageDays < 30 ? 6 : ageDays < 180 ? 8 : 10;
  if (socials.length) aT6 = clamp(aT6 + 1, 0, 10);
  if (cg?.cexCount) aT6 = clamp(aT6 + 2, 0, 10);
  axes.push({ key: "T6", label: "Maturity & presence", score: aT6, weight: 10, rationale: `${ageDays != null ? (ageDays < 1 ? "<1 day" : Math.round(ageDays) + " days") + " old" : "age unknown"}${socials.length ? `, ${socials.length} socials` : ", no socials"}${cg?.cexCount ? `, ${cg.cexCount} CEX listings` : cg && !cg.listed ? ", not on CoinGecko" : ""}.` });
  const measured = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const assessed = [
    measured(pair.liquidity?.usd),
    s.contractPropertiesAssessed === true,
    s.taxesAssessed === true,
    s.holderCountAssessed === true && holdersReliable,
    measured(pair.volume?.h24) && measured(pair.liquidity?.usd) && measured(pair.txns?.h24?.buys) && measured(pair.txns?.h24?.sells) && typeof pair.priceChange?.h24 === "number" && Number.isFinite(pair.priceChange.h24),
    measured(pair.pairCreatedAt)
  ];
  for (const [index, axis] of axes.entries()) {
    axis.nominalWeight = axis.weight;
    axis.assessed = assessed[index];
    const measurementPaths = [
      ["marketEvidence.liquidityUsd"],
      ["safety.contractPropertiesAssessed"],
      ["safety.taxesAssessed"],
      ["safety.holderCountAssessed", "topHolders"],
      ["marketEvidence.vol24", "marketEvidence.liquidityUsd", "priceChange"],
      ["marketEvidence.ageDays"]
    ];
    axis.evidenceRefs = axis.assessed ? measurementPaths[index] : [];
    if (!axis.assessed) {
      axis.weight = 0;
      axis.score = 0;
      axis.rationale = "Evidence needed to assess this area was not returned. Excluded from the score.";
    }
  }
  const assessedWeight = axes.reduce((sum, axis) => sum + axis.weight, 0);
  const assessment = { assessedWeight, applicableWeight: 100, provisional: assessedWeight < 100, gaps: axes.filter((axis) => !axis.assessed).map((axis) => axis.label) };
  const raw = assessedWeight > 0 ? Math.round(100 * axes.reduce((a, x) => a + x.score, 0) / assessedWeight) : null;
  let capApplied = null;
  let score = raw;
  let verdict;
  if (caps.length) {
    const [ceiling, key] = caps.reduce((m, c) => c[0] < m[0] ? c : m);
    score = raw == null ? null : Math.min(raw, ceiling);
    capApplied = key;
    verdict = ceiling <= 10 ? "AVOID" : score == null ? "UNVERIFIABLE" : band(score);
  } else verdict = score == null ? "UNVERIFIABLE" : band(score);
  const projectX = handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) || handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u))) || (cg?.twitter ? "@" + cg.twitter : null);
  opts?.signal?.throwIfAborted();
  const socialActivity = projectX && opts?.collectSocialActivity ? await opts.collectSocialActivity({
    handle: projectX,
    ticker: pair.baseToken.symbol,
    projectName: pair.baseToken.name,
    contractAddress: pair.baseToken.address
  }, { fetchImpl: fetcher, deadlineAt: opts?.deadlineAt }).catch(() => void 0) : void 0;
  const githubOrg = socials.map((x) => x.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1]).find((g) => !!g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing|apps|collections)$/i.test(g));
  let shipping;
  if (githubOrg && opts?.collectShipping) {
    step({ phase: "Corroborate", label: "Development", detail: `Reading github.com/${githubOrg}: cadence, committers, substance, whether the code reaches production.`, tone: "neutral" });
    opts?.signal?.throwIfAborted();
    shipping = await opts.collectShipping(githubOrg, {
      fetchImpl: fetcher,
      deadlineAt: opts?.deadlineAt,
      token: { address, chain, deployer: deployerAttribution?.address ?? null },
      sectorText: [pair.baseToken.name, cg?.description].filter(Boolean).join(" \xB7 ") || null
    }).catch(() => void 0);
    if (shipping) {
      step({ phase: "Corroborate", label: "Development read", detail: shipping.headline, tone: shipping.grade === "stalled" ? "bad" : shipping.grade === "thin" ? "warn" : shipping.grade === "unknown" ? "neutral" : "good" });
      if (shipping.market === "price-without-shipping") findings.push({ claim: "The token's price rose over the last quarter while commits to the linked repositories fell: the move is not backed by visible development.", tone: "warn", source: "github" });
      if (shipping.leadDeparted) findings.push({ claim: "The lead committer of the prior two months has stopped while the repository carried on: a departure signal, not yet a departure.", tone: "warn", source: "github" });
      if (shipping.grade === "stalled") findings.push({ claim: `Development has stalled in the linked GitHub: ${shipping.headline}`, tone: "warn", source: "github" });
      if (shipping.grade === "shipping-team" && shipping.live === "live") findings.push({ claim: `A team is shipping and the code is reaching production: ${shipping.headline}`, tone: "good", source: "github" });
    } else {
      step({ phase: "Corroborate", label: "Development read", detail: `github.com/${githubOrg} could not be read; the development lane is unassessed, not failed.`, tone: "neutral" });
    }
  }
  const deployer = deployerAttribution?.address ?? null;
  const deployerRole = deployerRoleLabel(deployerAttribution, "wallet");
  let topHolders = rawHolders.slice(0, HOLDER_TARGET).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || void 0,
    isContract: h.is_contract === 1 || h.is_contract === "1",
    marketKind: classifyMarketAddress(h.address ?? h.account ?? "", { poolAddresses, knownAccounts })?.kind
  })).filter((h) => h.address);
  let holderIntelligence = buildHolderIntelligence({
    chain,
    tokenAddress: address,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    source: explorerHolders ? "blockscout" : chain === "solana" && rugcheck?.topHolders?.length ? "rugcheck" : "goplus",
    sourceUrl: explorerHolders ? blockscoutHolderSourceUrl(chain, address) : chain === "solana" && rugcheck?.topHolders?.length ? `https://api.rugcheck.xyz/v1/tokens/${address}/report` : `https://api.gopluslabs.io/api/v1/${chain === "solana" ? "solana/token_security" : `token_security/${gpChain}`}?contract_addresses=${address}`,
    rows: chain === "solana" && rugcheck?.topHolders?.length ? rugcheck.topHolders : topHolders,
    ranked: chain !== "solana" && !GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) || Boolean(explorerHolders),
    aggregateOwners: chain === "solana" && Boolean(rugcheck?.topHolders?.length),
    poolAddresses,
    ...knownAccounts ? { knownAccounts } : {}
  });
  if (opts?.enrichHolders || arkhamProviderEnabled()) {
    holderIntelligence = await enrichHolderSnapshot(holderIntelligence, opts?.enrichHolders ?? holderIdentityRoute(fetcher));
  }
  if (chain === "solana" && rugcheck?.topHolders?.length) {
    topHolders = holderIntelligence.rows.map((row) => ({ address: row.address, percent: row.percent }));
  }
  const screenFn = opts?.screenSanctions ?? ((chain2, addresses) => screenAddressSanctions(chain2, addresses, fetcher));
  const deployerRiskFn = opts?.screenDeployerRisk ?? ((address2) => screenDeployerRisk(address2, fetcher));
  const deployerRiskEnabled = Boolean(opts?.screenDeployerRisk) || arkhamProviderEnabled();
  step({
    phase: "Screen",
    label: "Deployer forensics",
    detail: deployerRiskEnabled ? "Screening deployer and top holders against OFAC, and tracing funding provenance." : "Screening deployer and top holders against OFAC.",
    tone: "neutral"
  });
  opts?.signal?.throwIfAborted();
  const deployerWallet = deployerWalletAddress({ deployer, deployerAttribution: deployerAttribution ?? void 0 });
  const [sanctionsScreen, deployerRisk, priceHistory] = await Promise.all([
    screenFn(chain, [deployer, ...topHolders.map((h) => h.address)], fetcher, opts?.signal),
    // Best-effort enrichment: a deployer-risk failure must never break a scan
    // (unlike OFAC, it carries no verdict cap), so it always degrades to undefined.
    // Contract-as-wallet gate: do not Arkham-risk the token mint/CA, or the
    // factory that minted it, as if it were a team wallet.
    deployerWallet && deployerRiskEnabled && !sameWalletAddress(deployerWallet, address) ? deployerRiskFn(deployerWallet).catch(() => void 0) : Promise.resolve(void 0),
    fetchPriceHistory(address, chain, pair.pairAddress, fetcher).catch(() => null)
  ]);
  if (deployerRisk?.available && deployerRisk.paths.length) {
    for (const p of deployerRisk.paths.slice(0, 3)) {
      const severe = SEVERE_RISK_CATEGORY.test(p.category ?? "");
      const who = p.seedName || p.category || "a flagged entity";
      const hopStr = p.hops ? `, ${p.hops} hop${p.hops === 1 ? "" : "s"} away` : "";
      const amt = p.usd >= 1 ? `~$${Math.round(p.usd).toLocaleString()} ` : "";
      findings.push({
        claim: p.direction === "backward" ? `${deployerRole} received ${amt}traceable to ${who}${hopStr}. ${severe ? "This is a serious funding-provenance risk." : "Worth scrutiny on where the launch capital came from."}` : `${deployerRole} sent ${amt}to ${who}${hopStr}. ${severe ? "This is a serious counterparty risk." : "Worth scrutiny on where the funds moved."}`,
        tone: severe ? "bad" : "warn",
        source: "arkham"
      });
    }
    const lead = deployerRisk.paths[0];
    step({ phase: "Finalize", label: "Funding trace", detail: `${deployerRole} ${lead.direction === "backward" ? "funded via" : "exposed to"} ${lead.seedName || lead.category || "a flagged entity"}${lead.hops ? ` (${lead.hops} hop${lead.hops === 1 ? "" : "s"})` : ""}.`, tone: SEVERE_RISK_CATEGORY.test(lead.category ?? "") ? "bad" : "warn" });
  }
  if (sanctionsScreen?.available && sanctionsScreen.sanctioned.length) {
    findings.push({
      claim: sanctionsScreen.sanctioned.length === 1 ? `OFAC SDN hit: screened address ${sanctionsScreen.sanctioned[0].slice(0, 10)}\u2026 is on the US Treasury sanctions list. Touching this token is a legal-exposure risk.` : `OFAC SDN hit: ${sanctionsScreen.sanctioned.length} screened addresses are on the US Treasury sanctions list. Touching this token is a legal-exposure risk.`,
      tone: "bad",
      source: "ofac"
    });
    score = score == null ? null : Math.min(score, 5);
    capApplied = "ofac_sanctioned_address";
    verdict = "AVOID";
    step({ phase: "Finalize", label: "OFAC sanctions", detail: `${sanctionsScreen.sanctioned.length} sanctioned address(es): verdict forced to AVOID.`, tone: "bad" });
  }
  const cloneCheck = pair.dexId === "unlisted" && pair.baseToken.symbol === "TOKEN" ? null : await checkForClones({
    mint: address,
    symbol: pair.baseToken.symbol,
    chain,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    liquidityUsd
  }, { fetchImpl: fetcher }).catch(() => null);
  if (cloneCheck?.checked && cloneCheck.clones.length) {
    if (cloneCheck.audited === "later") {
      findings.push({ claim: cloneCheck.note, tone: "bad", source: "dexscreener" });
    } else {
      findings.push({
        claim: `${cloneCheck.clones.length} other ${cloneCheck.clones.length === 1 ? "mint trades" : "mints trade"} under the ticker $${pair.baseToken.symbol}. Verify you hold the address in this report before buying.`,
        tone: "warn",
        source: "dexscreener"
      });
    }
    step({
      phase: "Finalize",
      label: "Ticker collision",
      detail: cloneCheck.note,
      tone: cloneCheck.audited === "later" ? "bad" : "warn"
    });
  }
  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployerAttribution, topHolders, socials);
  const decisionBoundary = deriveTokenDecisionBoundary({ score, capApplied, axes });
  const headline = assessment.provisional && !capApplied ? `Score based on ${assessedWeight}/100 of the assessment weight. Evidence gaps: ${assessment.gaps.join(", ")}.` : buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} \xB7 ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });
  return {
    address,
    chain,
    dexId: pair.dexId,
    dexLabels: pair.labels ?? [],
    pairAddress: pair.pairAddress,
    symbol: pair.baseToken.symbol,
    name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? void 0,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : void 0,
    mcap: fdv,
    fdv: fullyDilutedValuation,
    liquidityUsd,
    vol24,
    ageDays,
    marketEvidence: {
      mcap: pair.marketCap != null && Number.isFinite(pair.marketCap),
      fdv: pair.fdv != null && Number.isFinite(pair.fdv),
      liquidityUsd: pair.liquidity?.usd != null && Number.isFinite(pair.liquidity.usd),
      vol24: pair.volume?.h24 != null && Number.isFinite(pair.volume.h24),
      ageDays: pair.pairCreatedAt != null && Number.isFinite(pair.pairCreatedAt)
    },
    // Keep the raw instant, not just the day count derived from it above. The
    // operator trace ages the deployer wallet against this launch, and a wallet
    // minutes older than the token it launched is 0 days old in every direction.
    pairCreatedAt: pair.pairCreatedAt ?? null,
    priceChange: pair.priceChange,
    ...priceHistory ? { priceHistory } : {},
    // The pool exclusion has to reach the number a reader actually sees. Leaving
    // the raw provider top holder on the dossier put "top holder 37%" on the same
    // page as the finding explaining that the 37% line is the pool itself.
    verdict,
    score,
    assessment,
    capApplied,
    headline,
    axes,
    ...decisionBoundary ? { decisionBoundary } : {},
    safety: { ...s, topHolderPct: concentrationTopPct },
    socials,
    holdersAssessed: holdersReliable,
    projectX,
    ...socialActivity ? { socialActivity } : {},
    ...shipping ? { shipping } : {},
    deployer,
    ...deployerAttribution ? { deployerAttribution } : {},
    topHolders,
    holderIntelligence,
    insiderPct,
    bundleCount,
    bundleRisk,
    cg,
    graph,
    findings,
    trace,
    live: true,
    safetyChecked: s.available,
    sanctionsScreen,
    deployerRisk,
    ...cloneCheck ? { cloneCheck } : {}
  };
}
function buildGraph(chain, address, symbol, verdict, projectX, attribution, holders, socials) {
  const center = tokenEntityKey(chain, address);
  const nodes = [{
    type: "Token",
    key: center,
    label: "$" + symbol,
    symbol,
    chain,
    address,
    subject: true,
    was_rug: verdict === "AVOID"
  }];
  const edges = [];
  if (projectX) {
    const projectXSourceUrl = socials.find((social) => {
      const handle = social.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1];
      return Boolean(handle && `@${handle}`.toLowerCase() === projectX.toLowerCase());
    })?.url;
    nodes.push({ type: "Person", key: projectX });
    edges.push({
      src: center,
      dst: projectX,
      type: "TEAM",
      ...projectXSourceUrl ? { source_url: projectXSourceUrl, evidence_origin: "deterministic", artifact_verified: true } : {}
    });
  }
  if (attribution) {
    const k = walletEntityKey(chain, attribution.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + attribution.address.slice(0, 8), chain, address: attribution.address });
    edges.push({
      src: center,
      dst: k,
      type: attribution.kind === "deployer" ? "DEPLOYED_BY" : "ATTRIBUTED_CREATOR",
      source: attribution.source,
      .../^https?:\/\//i.test(attribution.source) ? { source_url: attribution.source, evidence_origin: "deterministic", artifact_verified: true } : {}
    });
  }
  holders.slice(0, HOLDER_TARGET).forEach((h) => {
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({
      src: center,
      dst: k,
      type: "HELD_BY",
      ...h.percent > 25 ? { risk: "high_concentration" } : {}
    });
  });
  socials.slice(0, 3).forEach((x) => {
    const xh = x.url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i)?.[1];
    const key = xh ? "@" + xh : x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1];
    if (!key || projectX && key.toLowerCase() === projectX.toLowerCase()) return;
    nodes.push({ type: "Company", key });
    edges.push({
      src: center,
      dst: key,
      type: "LINKS",
      source_url: x.url,
      evidence_origin: "deterministic",
      artifact_verified: true
    });
  });
  return { nodes, edges };
}
function buildHeadline(verdict, cap, s, liq, projectX) {
  if (cap === "ofac_sanctioned_address") return "A screened address is on the US Treasury OFAC sanctions list. Touching this token is a legal-exposure risk. Do not touch.";
  if (s.honeypot) return s.nonTransferable ? "Non-transferable: holders are locked in. Do not touch." : "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Mint authority is live, the team can dilute holders to zero.";
  if (cap === "freeze_authority_active") return "Freeze authority is live, the team can freeze your tokens at any time.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (cap === "owner_can_modify_balance") return "Owner can rewrite holder balances, they can zero your wallet at will.";
  if (cap === "balance_mutable_authority") return "A balance-mutable authority can rewrite your token balance at will.";
  if (verdict === "PASS") return `Clears the forensic bar: ${s.ownerRenounced ? "authorities revoked" : "owned"}, ${s.lpLocked ? "LP locked" : "tradeable"}, with real depth${projectX ? `. Team: ${projectX}` : "."}`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${liq < 15e3 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!s.available) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}

// server/cost.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";
var PRICE = {
  // Fallback only. Successful xAI responses now return their exact billed
  // cost in usage.cost_in_usd_ticks, which always takes precedence. Grok 4.3
  // is the current redirect target for retired grok-4-fast model slugs.
  grokIn: 1.25 / 1e6,
  grokOut: 2.5 / 1e6,
  grokToolCall: 5 / 1e3,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  claudeWebSearch: 10 / 1e3,
  haikuIn: 1 / 1e6,
  haikuOut: 5 / 1e6,
  serperQuery: 1 / 1e3,
  twitterapiCall: 2e-4,
  pdlMatch: 0.1,
  heliusCall: 1e-4
};
var createState = () => ({
  ledger: /* @__PURE__ */ new Map(),
  grok: { in: 0, out: 0, calls: 0, sources: 0 },
  claude: { in: 0, out: 0, calls: 0 }
});
var auditCostState = new AsyncLocalStorage2();
var fallbackState = createState();
var currentState = () => auditCostState.getStore() ?? fallbackState;
function withCostLedger(work) {
  return auditCostState.run(createState(), work);
}
var round4 = (n) => Math.round(n * 1e4) / 1e4;
function getCost() {
  const { ledger, grok, claude } = currentState();
  const lines = [...ledger.values()].map((l) => ({ ...l, usd: round4(l.usd) })).sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    schemaVersion: 1,
    usd: round2(total),
    grokUsd: round2(grokUsd),
    claudeUsd: round2(claudeUsd),
    grokCalls: grok.calls,
    claudeCalls: claude.calls,
    sources: grok.sources,
    estimated: true,
    calls: lines
  };
}

// src/lib/reportCheckContract.ts
var TOKEN_REQUIRED_CHECK_IDS = /* @__PURE__ */ new Set([
  "contract-safety",
  "buy-sell-simulation",
  "holder-distribution",
  "wallet-clustering",
  "market-intelligence",
  "ofac-sanctions-address"
]);
var INVESTIGATION_REQUIRED_CHECK_IDS = /* @__PURE__ */ new Set([
  ...TOKEN_REQUIRED_CHECK_IDS,
  "trust-graph-connections"
]);
var TOKEN_REQUIRED_CHECK_LABELS = Object.freeze({
  "contract-safety": "Contract safety",
  "buy-sell-simulation": "Tradeability check",
  "holder-distribution": "Holder distribution",
  "wallet-clustering": "Wallet clustering",
  "market-intelligence": "Market intelligence",
  "ofac-sanctions-address": "OFAC sanctions screen",
  "trust-graph-connections": "Trust-graph reconciliation"
});
var TOKEN_SUPPLEMENTAL_CHECK_IDS = /* @__PURE__ */ new Set([
  "operator-funding-trace",
  "deployer-trail-evm",
  "bytecode-fingerprint-evm",
  "documents-audits",
  "news-press",
  "github-forensics",
  "trust-graph-connections"
]);
var PERSON_SUPPLEMENTAL_CHECK_IDS = /* @__PURE__ */ new Set([
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "news-press",
  "project-leadership-currency",
  "founder-repeat-backing",
  "investor-fund-scale"
]);
function isUnboundInvestigationGraphRow(check, checkId) {
  return checkId === "trust-graph-connections" && check.provider === "project-account-audit" && check.retryable === false;
}
function applyReportCheckContract(kind, checks) {
  const requiredIds = kind === "investigation" ? INVESTIGATION_REQUIRED_CHECK_IDS : TOKEN_REQUIRED_CHECK_IDS;
  const normalized = checks.map((check) => {
    const checkId = check.checkId?.trim() ?? "";
    if (kind === "token" || kind === "investigation") {
      if (kind === "investigation" && isUnboundInvestigationGraphRow(check, checkId)) {
        return { ...check, decisionCritical: false };
      }
      if (checkId && requiredIds.has(checkId)) {
        return { ...check, decisionCritical: true };
      }
      if (checkId && TOKEN_SUPPLEMENTAL_CHECK_IDS.has(checkId)) {
        return { ...check, decisionCritical: false };
      }
      return {
        ...check,
        ...check.decisionCritical === void 0 ? {} : { decisionCritical: check.decisionCritical }
      };
    }
    if (check.decisionCritical !== void 0) return { ...check };
    return {
      ...check,
      decisionCritical: !checkId || !PERSON_SUPPLEMENTAL_CHECK_IDS.has(checkId)
    };
  });
  if (kind === "person") return normalized;
  const present = new Set(normalized.map((check) => check.checkId).filter(Boolean));
  const missingRequired = [...requiredIds].filter((checkId) => !present.has(checkId)).map((checkId) => ({
    checkId,
    label: TOKEN_REQUIRED_CHECK_LABELS[checkId] ?? checkId,
    status: "unknown",
    decisionCritical: true,
    note: "required completion outcome was not saved"
  }));
  return [...normalized, ...missingRequired];
}
function hasExplicitReportCheckContract(kind, checks) {
  if (kind === "token" || kind === "investigation") {
    const ids = new Set(checks.map((check) => check.checkId).filter(Boolean));
    const requiredIds = kind === "investigation" ? INVESTIGATION_REQUIRED_CHECK_IDS : TOKEN_REQUIRED_CHECK_IDS;
    return [...requiredIds].every((checkId) => ids.has(checkId));
  }
  return checks.length > 0 && checks.every((check) => typeof check.decisionCritical === "boolean") && checks.some((check) => check.decisionCritical === true);
}

// src/lib/scanChecklist.ts
var POST_SCAN_ENRICHMENT_CHECK_IDS = /* @__PURE__ */ new Set([
  "deployer-trail-evm",
  "bytecode-fingerprint-evm"
]);
function decisionCriticalChecks(checks) {
  const hasExplicitCriticality = checks.some((check) => check.decisionCritical !== void 0);
  return hasExplicitCriticality ? checks.filter((check) => check.decisionCritical === true && (check.checkId !== "operator-funding-trace" || arkhamProviderEnabled()) && (!check.checkId || !POST_SCAN_ENRICHMENT_CHECK_IDS.has(check.checkId))) : checks;
}
var SUCCESSFUL = /* @__PURE__ */ new Set(["confirmed", "reported", "finding", "checked-empty"]);
var NEVER_WAIVE_RECORDED = /* @__PURE__ */ new Set(["confirmed", "finding", "checked-empty", "complete"]);
var UNKNOWN_OR_FAILED = /* @__PURE__ */ new Set(["unknown", "unavailable", "stale"]);
function neverWaiveCheckRecorded(checkId, status) {
  return checkId === "organization-registration" ? status === "confirmed" : NEVER_WAIVE_RECORDED.has(status);
}
var NEVER_WAIVE_CHECK_IDS = /* @__PURE__ */ new Set([
  "identity-resolution",
  "ofac-sanctions-name",
  // Person-name checks are not substitutes for the audited company's own
  // legal-entity and sanctions questions.
  "organization-registration",
  "organization-sanctions",
  // A sanctioned deployer or holder wallet is a legal-exposure flag no market
  // signal can offset; the address screen is never waivable on token subjects.
  "ofac-sanctions-address",
  "trust-graph-connections",
  // An unresolved token/security candidacy is a capital-risk unknown (the core
  // scam vector), never an enrichment gap.
  "founder-asset-distinction"
]);
var CLEARANCE_COVERAGE_FLOOR_PERCENT = 100;
function coveragePercentOf(recorded, applicable) {
  if (!(applicable > 0)) return 0;
  return Math.floor(recorded / applicable * 1e3) / 10;
}
function clearanceCoverage(checks) {
  const governing = decisionCriticalChecks(checks);
  const applicableRows = governing.filter((check) => check.status !== "not-applicable");
  const recordedRows = applicableRows.filter((check) => SUCCESSFUL.has(check.status));
  const hasStableIds = applicableRows.some((check) => typeof check.checkId === "string" && check.checkId);
  const openNeverWaive = hasStableIds ? applicableRows.filter((check) => check.checkId && NEVER_WAIVE_CHECK_IDS.has(check.checkId) && !neverWaiveCheckRecorded(check.checkId, check.status)).map((check) => check.checkId) : [];
  const applicable = applicableRows.length;
  const recorded = recordedRows.length;
  const recordedPercent = coveragePercentOf(recorded, applicable);
  const sufficient = applicable > 0 && (hasStableIds ? openNeverWaive.length === 0 && recordedPercent >= CLEARANCE_COVERAGE_FLOOR_PERCENT : recorded === applicable);
  return { applicable, recorded, openNeverWaive, recordedPercent, sufficient };
}
var shortAddr = (address) => address.length > 12 ? `${address.slice(0, 5)}\u2026${address.slice(-4)}` : address;
function contractSafetyConcerns(dossier) {
  const safety = dossier.safety;
  const concerns = [];
  if (safety.serialScammerCreator) concerns.push("prior honeypots by creator");
  if (safety.honeypot || safety.honeypotOnchain) concerns.push("honeypot indicator");
  if (safety.nonTransferable || safety.cannotSellAll) concerns.push("transfer restriction");
  if (safety.mintable) concerns.push("mint authority active");
  if (safety.freezable) concerns.push("freeze authority active");
  if (safety.contractPropertiesAssessed !== false && !safety.ownerRenounced) concerns.push(dossier.chain === "solana" ? "authorities retained" : "owner active");
  if (safety.hiddenOwner || safety.takeBack) concerns.push("owner-control risk");
  if (safety.contractPropertiesAssessed !== false && dossier.chain !== "solana" && !safety.openSource) concerns.push("source not verified");
  if (safety.selfdestruct) concerns.push("contract can self-destruct/close");
  if (safety.pausable) concerns.push("transfers can be paused");
  if (safety.proxy) concerns.push("upgradeable proxy");
  if (safety.metadataMutable) concerns.push("metadata mutable");
  if (safety.balanceMutable || safety.ownerChangeBalance) concerns.push("balances can be changed");
  if (safety.transferHook || safety.transferFee) concerns.push("programmable transfer controls");
  if (safety.slippageModifiable) concerns.push("tax/slippage modifiable");
  if (safety.blacklist || safety.tradingCooldown) concerns.push("wallet/trading restrictions");
  if (safety.externalCall) concerns.push("external calls enabled");
  return concerns;
}
function contractSafetyNote(dossier) {
  const concerns = contractSafetyConcerns(dossier);
  if (concerns.length) return concerns.slice(0, 3).join(" \xB7 ");
  return "provider response recorded; no surfaced contract-control concern";
}
var outcomeNotRecorded = "completion outcome not recorded";
var CHAIN_DISPLAY_NAMES = Object.freeze({
  robinhood: "Robinhood Chain",
  ethereum: "Ethereum",
  base: "Base",
  solana: "Solana",
  arbitrum: "Arbitrum",
  bsc: "BNB Chain",
  polygon: "Polygon"
});
function chainDisplayName(chain) {
  const key = (chain ?? "").trim().toLowerCase();
  if (!key) return "this chain";
  return CHAIN_DISPLAY_NAMES[key] ?? `the ${key} chain`;
}
function shippingCheck(dossier, outcomeNotRecorded2) {
  const ship = dossier.shipping;
  const linked = (dossier.socials ?? []).some((x) => /github\.com\//i.test(x.url));
  if (ship && ship.grade !== "unknown") {
    const finding = ship.grade === "stalled" || ship.market === "price-without-shipping" || ship.leadDeparted || ship.stars === "suspect" || ship.claimsUnsupported >= 2 && ship.claimsUnsupported > ship.claimsSupported;
    return {
      checkId: "github-forensics",
      decisionCritical: true,
      label: "GitHub forensics",
      status: finding ? "finding" : "confirmed",
      note: `${ship.headline} ${ship.distinctHuman} human committer${ship.distinctHuman === 1 ? "" : "s"}, cadence ${ship.cadenceStatus}, code ${ship.live === "live" ? "reaching production" : ship.live === "committed-only" ? "committed only" : ship.live === "deploys-without-code" ? "shipped from an unseen source" : "production status unread"}; ${ship.reposRead} repos and ${ship.commitsRead} commits read.`
    };
  }
  if (ship) return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unavailable", note: "a GitHub account is linked but could not be read" };
  if (linked) return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unknown", note: `a GitHub account is linked; ${outcomeNotRecorded2}` };
  return { checkId: "github-forensics", decisionCritical: true, label: "GitHub forensics", status: "unknown", note: "no public repository is linked from the project's official sources; teams that build in private are read through on-chain deploys instead" };
}
function tokenChecks(dossier) {
  const evm = dossier.chain !== "solana";
  const safety = dossier.safety;
  const checks = [];
  checks.push(
    safety.contractPropertiesAssessed === true || contractSafetyConcerns(dossier).length > 0 ? {
      checkId: "contract-safety",
      decisionCritical: true,
      label: "Contract safety",
      status: contractSafetyConcerns(dossier).length ? "finding" : "confirmed",
      note: contractSafetyNote(dossier)
    } : {
      checkId: "contract-safety",
      decisionCritical: true,
      label: "Contract safety",
      status: "unavailable",
      note: `complete contract-control evidence was not recorded for ${dossier.chain}; individual ownership or trading observations do not complete this check`
    }
  );
  const tradeabilityAssessed = safety.tradeabilityAssessed === true || safety.simChecked;
  const tradeabilityFinding = safety.honeypot || safety.cannotSellAll || safety.blacklist || safety.pausable || safety.tradingCooldown || safety.ownerChangeBalance;
  const tradeabilityNote = safety.tradeabilityMethod === "observed-market" ? `${(safety.observedBuys24h ?? 0).toLocaleString()} buys and ${(safety.observedSells24h ?? 0).toLocaleString()} sells were recorded in the selected pool over 24 hours. Trading occurred, but this does not rule out wallet-specific restrictions.${tradeabilityFinding ? " Contract controls can still restrict particular holders or future trading." : ""}` : safety.tradeabilityMethod === "goplus-screen" ? `GoPlus tradeability screen completed \xB7 buy ${safety.buyTax}% \xB7 sell ${safety.sellTax}%` : `Buy and sell simulation completed \xB7 buy ${safety.buyTax}% \xB7 sell ${safety.sellTax}%`;
  checks.push(
    tradeabilityAssessed ? {
      checkId: "buy-sell-simulation",
      decisionCritical: true,
      label: "Tradeability check",
      status: tradeabilityFinding ? "finding" : "confirmed",
      note: tradeabilityNote
    } : evm ? safety.available ? { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "unknown", note: outcomeNotRecorded } : { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "unavailable", note: `no tradeability provider or two-sided market receipt covers ${chainDisplayName(dossier.chain)}` } : { checkId: "buy-sell-simulation", decisionCritical: true, label: "Tradeability check", status: "not-applicable", note: "Solana: static flags only" }
  );
  const holderCount = safety.holderCount || dossier.topHolders.length;
  const topHolderPct = safety.topHolderPct ?? dossier.topHolders.find((h) => !h.isContract)?.percent ?? null;
  checks.push(
    holderCount > 0 ? {
      checkId: "holder-distribution",
      decisionCritical: true,
      label: "Holder distribution",
      status: (topHolderPct ?? 0) > 50 ? "finding" : "confirmed",
      note: `${holderCount.toLocaleString()} holder${holderCount === 1 ? "" : "s"} \xB7 top ${topHolderPct == null ? "unknown" : `${Math.round(topHolderPct)}%`}`
    } : safety.available ? { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unknown", note: "safety data returned, but no holder-query outcome was recorded" } : { checkId: "holder-distribution", decisionCritical: true, label: "Holder distribution", status: "unavailable", note: "holder provider response unavailable" }
  );
  const hasHolderRows = dossier.topHolders.length > 0;
  const hasClusteringOutcome = hasHolderRows && (dossier.holdersAssessed === true || dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" || dossier.bundleCount > 0 || dossier.insiderPct > 0);
  checks.push(
    hasClusteringOutcome ? {
      checkId: "wallet-clustering",
      decisionCritical: true,
      label: "Wallet clustering",
      status: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? "finding" : "confirmed",
      note: dossier.bundleRisk === "elevated" || dossier.bundleRisk === "high" ? `${dossier.bundleCount} concentrated wallets \xB7 ~${Math.round(dossier.insiderPct)}% (${dossier.bundleRisk} risk)` : `${dossier.topHolders.length} assessed non-market holder rows; no elevated concentration surfaced`
    } : hasHolderRows ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "holder rows exist, but clustering completion/reliability is not recorded" } : safety.available ? { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unknown", note: "no holder rows available to establish a clustering result" } : { checkId: "wallet-clustering", decisionCritical: true, label: "Wallet clustering", status: "unavailable", note: "requires holder-provider data" }
  );
  const deployerRisk = dossier.deployerRisk;
  const backwardRisk = deployerRisk?.available ? deployerRisk.paths.filter((path) => path.direction === "backward") : [];
  checks.push(
    deployerRisk?.available ? backwardRisk.length ? {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "finding",
      note: `Deployer funding traced on Arkham: exposure to ${backwardRisk[0].seedName || backwardRisk[0].category || "a flagged entity"}${backwardRisk[0].hops ? ` (${backwardRisk[0].hops} hop${backwardRisk[0].hops === 1 ? "" : "s"})` : ""}`,
      provider: "arkham",
      completedAt: deployerRisk.completedAt
    } : {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "confirmed",
      // "funding source" is inbound only (backward); any outbound exposure
      // still surfaces as a finding, so this note does not overclaim.
      note: dossier.deployer ? `Deployer ${shortAddr(dossier.deployer)} funding traced on Arkham; no flagged-entity funding source surfaced` : "Deployer funding traced on Arkham; no flagged-entity funding source surfaced",
      provider: "arkham",
      completedAt: deployerRisk.completedAt
    } : arkhamProviderEnabled() ? {
      checkId: "operator-funding-trace",
      decisionCritical: true,
      label: "Operator / funding trace",
      status: "unknown",
      note: dossier.deployer ? `deployer ${shortAddr(dossier.deployer)} resolved; trace ${outcomeNotRecorded}` : `deployer unresolved; trace ${outcomeNotRecorded}`
    } : {
      checkId: "operator-funding-trace",
      decisionCritical: false,
      label: "Operator / funding trace",
      status: "not-applicable",
      note: "Supplemental provider trace is currently disabled and does not affect report readiness"
    }
  );
  checks.push(evm ? { checkId: "deployer-trail-evm", decisionCritical: false, label: "Creator wallet details", status: "unknown", note: "Checked after the saved score; the latest wallet result is shown below" } : { checkId: "deployer-trail-evm", decisionCritical: false, label: "Creator wallet details", status: "not-applicable", note: "Solana" });
  checks.push(evm ? { checkId: "bytecode-fingerprint-evm", decisionCritical: false, label: "Known scam code comparison", status: "unknown", note: "Checked after the saved score; the latest contract-code result is shown below" } : { checkId: "bytecode-fingerprint-evm", decisionCritical: false, label: "Known scam code comparison", status: "not-applicable", note: "Solana" });
  checks.push(
    dossier.cg?.listed ? {
      checkId: "market-intelligence",
      decisionCritical: true,
      label: "Market intelligence",
      status: dossier.cg.cexCount > 0 ? "confirmed" : "finding",
      note: `CoinGecko listing \xB7 ${dossier.cg.cexCount} CEX listing${dossier.cg.cexCount === 1 ? "" : "s"}${dossier.cg.rank ? ` \xB7 rank #${dossier.cg.rank}` : ""}`
    } : dossier.cg ? { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "checked-empty", note: "CoinGecko returned no matching asset" } : { checkId: "market-intelligence", decisionCritical: true, label: "Market intelligence", status: "unknown", note: outcomeNotRecorded }
  );
  const sanctionsScreen = dossier.sanctionsScreen;
  checks.push(
    sanctionsScreen?.available ? {
      checkId: "ofac-sanctions-address",
      decisionCritical: true,
      label: "OFAC sanctions screen",
      status: sanctionsScreen.sanctioned.length ? "finding" : "confirmed",
      note: sanctionsScreen.sanctioned.length ? `${sanctionsScreen.sanctioned.length} of ${sanctionsScreen.checked} screened addresses are on the US Treasury SDN list` : `${sanctionsScreen.checked} address${sanctionsScreen.checked === 1 ? "" : "es"} (deployer + top holders) screened against the${sanctionsScreen.listSize ? ` ${sanctionsScreen.listSize.toLocaleString()}-entry` : ""} OFAC SDN list; no matches`,
      provider: "ofac-sdn",
      completedAt: sanctionsScreen.completedAt
    } : sanctionsScreen?.reason === "no_screenable_addresses" ? {
      checkId: "ofac-sanctions-address",
      decisionCritical: true,
      label: "OFAC sanctions screen",
      status: "unavailable",
      // A rescan cannot conjure addresses this chain never exposed, so
      // the report must not offer one as the remedy.
      retryable: false,
      note: `No creator or holder address could be resolved on ${chainDisplayName(dossier.chain)}, so there was nothing to screen against the sanctions list. This is a coverage limit of that chain, not a clean result.`,
      provider: "ofac-sdn",
      completedAt: sanctionsScreen.completedAt
    } : sanctionsScreen ? { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unavailable", note: "The U.S. sanctions list was unavailable, so this check did not finish" } : { checkId: "ofac-sanctions-address", decisionCritical: true, label: "OFAC sanctions screen", status: "unknown", note: `token creator + largest holders; ${outcomeNotRecorded}` }
  );
  checks.push({ checkId: "documents-audits", decisionCritical: true, label: "Documents & audits", status: "unknown", note: `whitepaper, security audits, and documents; ${outcomeNotRecorded}` });
  checks.push({ checkId: "news-press", decisionCritical: true, label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(shippingCheck(dossier, outcomeNotRecorded));
  checks.push({ checkId: "trust-graph-connections", decisionCritical: true, label: "Trust-graph reconciliation", status: "unknown", note: `shared token creators or funders with flagged projects; ${outcomeNotRecorded}` });
  return checks;
}
var INVESTIGATION_CHECK_BRIDGE = [
  { tokenCheckId: "news-press", tokenLabel: "News & press", projectCheckId: "news-press", projectLabel: "News & press" },
  { tokenCheckId: "github-forensics", tokenLabel: "GitHub forensics", projectCheckId: "code-footprint-github", projectLabel: "Code footprint (GitHub)" },
  { tokenCheckId: "documents-audits", tokenLabel: "Documents & audits", projectCheckId: "project-transparency", projectLabel: "Transparency and disclosures" },
  { tokenCheckId: "trust-graph-connections", tokenLabel: "Trust-graph reconciliation", projectCheckId: "trust-graph-connections", projectLabel: "Trust-graph connections" }
];
function reconcileInvestigationChecks(tokenRows, tokenAddress, projectAccount, projectAccountAudit, projectAccountBinding) {
  const rows = tokenRows.map((row) => ({ ...row }));
  const projectRows = projectAccount?.checkRuns;
  if (!projectRows || !projectRows.length) {
    if (projectAccountAudit) {
      const note = projectAccountAudit.state === "complete" ? "Embedded project-account audit completed without a stored check ledger." : projectAccountAudit.note;
      const unbound = projectAccountAudit.state === "unavailable";
      for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
        const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
        if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
        target.status = "unavailable";
        target.note = note;
        target.provider = "project-account-audit";
        if (unbound) target.retryable = false;
      }
    }
    return rows;
  }
  const handle = (projectAccount?.handle ?? "").trim();
  const provenance = handle ? `the bound project account scan (${handle})` : "the bound project account scan";
  const annotateOpenBridgeRows = (reason) => {
    for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
      const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
      if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
      target.note = reason;
    }
    return rows;
  };
  const binding = projectRows.find((row) => row.checkId === "project-token-identity" || row.label === "Canonical project token");
  const projectSideConfirmed = binding?.status === "confirmed";
  const normalizeHandle = (value) => String(value ?? "").replace(/^@/, "").trim().toLowerCase();
  const tokenSideVerified = Boolean(
    projectAccountBinding && projectAccountBinding.status === "verified" && normalizeHandle(projectAccount?.handle) && normalizeHandle(projectAccountBinding.handle) === normalizeHandle(projectAccount?.handle)
  );
  if (!projectSideConfirmed && !tokenSideVerified) {
    if (!binding) {
      return annotateOpenBridgeRows(
        `resolves through ${provenance}, which recorded no canonical-token binding check, so its outcomes cannot be credited to this token`
      );
    }
    return annotateOpenBridgeRows(
      `resolves through ${provenance}, but that scan did not confirm this project's canonical token (${binding.note ?? `binding status: ${binding.status}`}), so its outcomes cannot be credited to this token`
    );
  }
  const boundAddress = (projectAccount?.projectToken?.address ?? "").trim().toLowerCase();
  const subjectAddress = (tokenAddress ?? "").trim().toLowerCase();
  if (boundAddress && boundAddress !== subjectAddress) {
    return annotateOpenBridgeRows(
      `resolves through ${provenance}, but that scan bound a different token contract (${boundAddress.slice(0, 10)}\u2026), so its outcomes cannot be credited to this token`
    );
  }
  const creditLicense = projectSideConfirmed ? "" : ` \xB7 account\u2194token binding verified from the token side (${projectAccountBinding?.via === "linked-page" ? "CA published on the account's linked page" : "CA published by the account's X bio"})`;
  for (const bridge of INVESTIGATION_CHECK_BRIDGE) {
    const target = rows.find((row) => row.checkId === bridge.tokenCheckId || row.label === bridge.tokenLabel);
    if (!target || !UNKNOWN_OR_FAILED.has(target.status)) continue;
    const source = projectRows.find((row) => row.checkId === bridge.projectCheckId || row.label === bridge.projectLabel);
    if (!source) continue;
    if (!SUCCESSFUL.has(source.status)) {
      target.note = `resolves through ${provenance}, where it also did not finish (${source.status}${source.note ? `: ${source.note}` : ""})`;
      continue;
    }
    target.status = source.status;
    target.note = `recorded on ${provenance}${creditLicense}: ${source.note ?? "completed"}`;
    if (source.provider) target.provider = source.provider;
    if (source.completedAt) target.completedAt = source.completedAt;
    if (typeof source.sourceCount === "number") target.sourceCount = source.sourceCount;
  }
  return rows;
}
function personChecks(opts) {
  const { identityConfidence, realName, roles, hasAssociates } = opts;
  const resolved = identityConfidence === "Confirmed" || identityConfidence === "Probable";
  const checks = [];
  checks.push(
    identityConfidence === "Confirmed" ? { label: "Identity resolution", status: "confirmed", note: "confirmed confidence" } : identityConfidence ? { label: "Identity resolution", status: "finding", note: `${identityConfidence.toLowerCase()} confidence` } : { label: "Identity resolution", status: "unknown", note: outcomeNotRecorded }
  );
  checks.push({ label: "Profile-photo authenticity", status: "unknown", note: `AI / stock / celebrity / logo; ${outcomeNotRecorded}` });
  checks.push({ label: "Code footprint (GitHub)", status: "unknown", note: `resolved from handle / name / bio; ${outcomeNotRecorded}` });
  checks.push({ label: "Identity continuity", status: "unknown", note: `prior handles, cross-platform accounts; ${outcomeNotRecorded}` });
  checks.push(hasAssociates ? { label: "Affiliations & associates", status: "confirmed", note: "associate records present in the dossier" } : { label: "Affiliations & associates", status: "unknown", note: "no collection outcome recorded; an empty dossier is not a confirmed clean result" });
  checks.push(roles.includes("KOL") ? { label: "Promoted-token performance", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Promoted-token performance", status: "not-applicable", note: "not a KOL" });
  checks.push(roles.includes("INVESTOR") ? { label: "Portfolio track record", status: "unknown", note: `eligible by role; ${outcomeNotRecorded}` } : { label: "Portfolio track record", status: "not-applicable", note: "not a fund/investor" });
  const projectChecks = [
    { label: "Canonical project token", status: "unknown", note: outcomeNotRecorded },
    { label: "Product and website substance", status: "unknown", note: outcomeNotRecorded },
    { label: "Project team identity", status: "unknown", note: outcomeNotRecorded },
    { label: "Backing and partners", status: "unknown", note: outcomeNotRecorded },
    { label: "Traction and liveness", status: "unknown", note: outcomeNotRecorded },
    { label: "Transparency and disclosures", status: "unknown", note: outcomeNotRecorded }
  ];
  checks.push(...projectChecks.map((check) => roles.includes("PROJECT") ? check : { ...check, status: "not-applicable", note: "not a project account" }));
  checks.push({ label: "News & press", status: "unknown", note: outcomeNotRecorded });
  checks.push(resolved && realName ? { label: "US legal history", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "US legal history", status: "not-applicable", note: "needs a resolved real name" });
  checks.push(resolved && realName ? { label: "OFAC sanctions (name)", status: "unknown", note: `eligible by resolved name; ${outcomeNotRecorded}` } : { label: "OFAC sanctions (name)", status: "not-applicable", note: "needs a resolved real name" });
  checks.push({ label: "Trust-graph connections", status: "unknown", note: `ties to other audited subjects; ${outcomeNotRecorded}` });
  return checks;
}

// src/lib/reports.ts
function reportChecks(kind, payload) {
  if (kind === "token") {
    const dossier = payload;
    const checks = dossier.versionContext ? dossier.versionContext.checks.map((check) => ({ ...check })) : tokenChecks(dossier);
    return applyReportCheckContract("token", checks);
  }
  if (kind === "investigation") {
    const investigation = payload;
    const base = investigation.versionContext ? investigation.versionContext.checks.map((check) => ({ ...check })) : tokenChecks(investigation.token);
    return applyReportCheckContract("investigation", reconcileInvestigationChecks(
      base,
      investigation.token.address,
      investigation.projectAccount,
      investigation.projectAccountAudit,
      investigation.projectAccountBinding
    ));
  }
  if (kind === "person") {
    const dossier = payload;
    if (Array.isArray(dossier.checkRuns) && dossier.checkRuns.length) {
      return dossier.checkRuns.map((check) => ({ ...check }));
    }
    if (dossier.versionContext) {
      return dossier.versionContext.checks.map((check) => ({ ...check }));
    }
    return personChecks({
      identityConfidence: dossier.report.identity_confidence ?? void 0,
      realName: (dossier.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
      roles: dossier.report.roles ?? [],
      hasAssociates: (dossier.evidence.associates ?? []).length > 0
    });
  }
  return [];
}
function reportCompleteness(kind, payload, checks = reportChecks(kind, payload)) {
  const tokenAssessment = payload && typeof payload === "object" ? kind === "token" ? payload.assessment : kind === "investigation" ? payload.token?.assessment : void 0 : void 0;
  if (tokenAssessment?.provisional) return "partial";
  const dossier = kind === "person" ? payload : null;
  if (dossier?.checkRuns?.length && dossier.completeness_state === "failed") return "failed";
  if (dossier?.checkRuns?.length && dossier.completeness_state === "partial" && !hasExplicitReportCheckContract("person", checks)) return "partial";
  const contractedChecks = kind === "site" ? checks : applyReportCheckContract(kind, checks);
  if (kind !== "site") return clearanceCoverage(contractedChecks).sufficient ? "complete" : "partial";
  const inScope = checks.filter((check) => check.status !== "not-applicable");
  return inScope.length > 0 && inScope.every(
    (check) => check.status === "confirmed" || check.status === "reported" || check.status === "finding" || check.status === "checked-empty"
  ) ? "complete" : "partial";
}

// src/threat/shipping.ts
var DAY = 864e5;
var BOT_NAME = /\[bot\]$|^(github-actions|dependabot|renovate|snyk-bot|greenkeeper|mergify|semantic-release|codecov|imgbot)/i;
var NOREPLY = /noreply\.github\.com$|^noreply@|^no-reply@/i;
var MIRROR_HEADLINE = /^(sync(ed|ing)?|mirror(ed)?|export(ed)?|publish(ed)?|import(ed)?)\b.*\b(from|to|of)\b|^sync from\b|^automated sync\b/i;
var GENERIC_HEADLINE = /^(update|updates|updated|fix|fixes|fixed|wip|changes|change|misc|stuff|test|tests|tmp|temp|asdf|\.+|init|initial commit|first commit|commit|save|cleanup|minor)\.?$/i;
var DOCS_HEADLINE = /\b(docs?|readme|typo|changelog|license|comment(s)?)\b/i;
var AI_TRAILER = /co-authored-by:[^\n]*\b(claude|copilot|chatgpt|openai|cursor|codex|devin|gemini|aider|sweep|windsurf)\b|generated with \[?claude|🤖 generated with|made with (cursor|copilot)/i;
var SHIP_CLAIM = /\b(launch(ed|ing|es)?|releas(ed|e|es|ing)|shipp(ed|ing)|v\d+(\.\d+)+|mainnet|is live|now live|went live|deploy(ed|ing)|beta|alpha|new version|update is (out|live)|rolled out|rolling out)\b/i;
var PERMISSIVE = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|MPL-2\.0|Unlicense|CC0-1\.0|0BSD|Zlib)$/i;
var COPYLEFT = /^(GPL|AGPL|LGPL)/i;
var SOURCE_AVAILABLE = /^(BUSL|BSL|SSPL|Elastic|Commons-Clause)/i;
var MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
var ROADMAP_RE = new RegExp(`\\b(Q[1-4]\\s*['\u2019]?(?:20)?\\d{2}|H[12]\\s*['\u2019]?(?:20)?\\d{2}|(?:${MONTHS})\\.?\\s+20\\d{2}|(?:end of|by|before|in)\\s+20\\d{2})\\b`, "gi");
var BULK_LINES = 1500;
var BULK_FILES = 15;
var TRIVIAL_LINES = 5;
var pct = (n, d) => d > 0 ? Math.round(n / d * 1e3) / 10 : 0;
var round1 = (n) => Math.round(n * 10) / 10;
var median = (xs) => {
  if (!xs.length) return void 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
var parse = (iso) => iso ? Date.parse(iso) : NaN;
var isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
function committerKind(c) {
  const name = c.authorName ?? "";
  if (BOT_NAME.test(name) || BOT_NAME.test(c.authorLogin ?? "")) return "bot";
  if (MIRROR_HEADLINE.test(c.headline) && (NOREPLY.test(c.authorKey) || !c.authorKey.includes("@"))) return "mirror";
  return "human";
}
function positionOf(value, med) {
  if (!Number.isFinite(med) || med <= 0) return "unknown";
  if (value < med * 0.5) return "below";
  if (value > med * 1.5) return "above";
  return "within";
}
function statusFromDays(days) {
  if (days == null) return "unknown";
  if (days <= 7) return "shipping";
  if (days <= 30) return "active";
  if (days <= 60) return "quiet";
  return "dormant";
}
function licenseClass(id) {
  if (!id) return "none";
  if (PERMISSIVE.test(id)) return "permissive";
  if (COPYLEFT.test(id)) return "copyleft";
  if (SOURCE_AVAILABLE.test(id)) return "source-available";
  return "unknown";
}
function roadmapDue(phrase, fallbackYearFrom) {
  const p = phrase.trim().toLowerCase().replace(/['’]/g, "");
  const year = (y) => y.length === 2 ? 2e3 + Number(y) : Number(y);
  let m = p.match(/^q([1-4])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 3, 0, 23, 59, 59);
  m = p.match(/^h([12])\s*(\d{2,4})$/);
  if (m) return Date.UTC(year(m[2]), Number(m[1]) * 6, 0, 23, 59, 59);
  m = p.match(new RegExp(`^(${MONTHS})\\.?\\s+(\\d{4})$`));
  if (m) {
    const idx = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(m[1].slice(0, 3));
    return Date.UTC(Number(m[2]), idx + 1, 0, 23, 59, 59);
  }
  m = p.match(/(\d{4})$/);
  if (m) return Date.UTC(Number(m[1]), 12, 0, 23, 59, 59);
  return fallbackYearFrom ? parse(fallbackYearFrom) : NaN;
}
function extractRoadmapClaims(text, max = 12) {
  if (!text) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?•\n])\s+|\s{2,}|\s[-–—]\s/);
  for (const sentence of sentences) {
    const hits = sentence.match(ROADMAP_RE);
    if (!hits) continue;
    const due = roadmapDue(hits[0]);
    if (!Number.isFinite(due)) continue;
    const clean = sentence.trim().slice(0, 160);
    const key = `${hits[0].toLowerCase()}|${clean.toLowerCase().slice(0, 60)}`;
    if (seen.has(key) || clean.length < 12) continue;
    seen.add(key);
    out.push({ text: clean, due: new Date(due).toISOString() });
    if (out.length >= max) break;
  }
  return out;
}
function assessShipping(input) {
  const nowMs = parse(input.now);
  const windowMs = input.windowDays * DAY;
  const windowStart = nowMs - windowMs;
  const evidence = [];
  const caveats = [];
  const commits = input.commits.filter((c) => Number.isFinite(parse(c.date)) && parse(c.date) >= windowStart && parse(c.date) <= nowMs + DAY).sort((a, b) => parse(a.date) - parse(b.date));
  const weekCount = Math.max(1, Math.ceil(input.windowDays / 7));
  const weeks = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = nowMs - (i + 1) * 7 * DAY;
    const end = start + 7 * DAY;
    const n = commits.filter((c) => parse(c.date) >= start && parse(c.date) < end).length;
    weeks.push({ weekStart: isoDate(start), commits: n });
  }
  const activeWeeks = weeks.filter((w) => w.commits > 0).length;
  const lastCommitMs = commits.length ? parse(commits[commits.length - 1].date) : NaN;
  const pushTimes = input.repos.map((r) => parse(r.pushedAt)).filter((t) => Number.isFinite(t) && t <= nowMs + DAY);
  const lastPushMs = pushTimes.length ? Math.max(...pushTimes) : NaN;
  const recencyMs = Number.isFinite(lastCommitMs) ? lastCommitMs : lastPushMs;
  const lastCommitDaysAgo = Number.isFinite(recencyMs) ? Math.max(0, Math.round((nowMs - recencyMs) / DAY)) : void 0;
  const gaps = [];
  for (let i = 1; i < commits.length; i++) gaps.push((parse(commits[i].date) - parse(commits[i - 1].date)) / DAY);
  if (commits.length) gaps.push((nowMs - lastCommitMs) / DAY);
  const longestGapDays = gaps.length ? round1(Math.max(...gaps)) : void 0;
  const medianGapDays = gaps.length ? round1(median(gaps) ?? 0) : void 0;
  const releasesInWindow = input.repos.reduce((n, r) => n + r.releases.filter((rel) => parse(rel.publishedAt) >= windowStart && parse(rel.publishedAt) <= nowMs + DAY).length, 0);
  const status = input.repos.length === 0 && commits.length === 0 ? "unknown" : statusFromDays(lastCommitDaysAgo);
  const roster = /* @__PURE__ */ new Map();
  const last30Start = nowMs - 30 * DAY;
  const prior60Start = nowMs - 90 * DAY;
  const identities = input.identities ?? {};
  for (const c of commits) {
    const kind = committerKind(c);
    const key = kind === "mirror" ? `mirror:${c.authorKey}` : c.authorKey;
    let row = roster.get(key);
    if (!row) {
      const createdMs = parse(c.authorAccountCreatedAt);
      row = {
        key,
        name: c.authorName || c.authorLogin || c.authorKey,
        login: c.authorLogin,
        commits: 0,
        sharePct: 0,
        kind,
        accountCreatedAt: c.authorAccountCreatedAt,
        freshAccount: Number.isFinite(createdMs) && createdMs >= windowStart,
        last30: 0,
        prior60: 0
      };
      roster.set(key, row);
    }
    row.commits++;
    const t = parse(c.date);
    if (t >= last30Start) row.last30++;
    else if (t >= prior60Start) row.prior60++;
    if (!row.login && c.authorLogin) row.login = c.authorLogin;
  }
  for (const row of roster.values()) {
    const id = row.login ? identities[row.login.toLowerCase()] : void 0;
    if (!id) continue;
    if (id.twitter) row.twitter = id.twitter.replace(/^@/, "");
    if (id.company) row.company = id.company;
    if (id.website) row.website = id.website;
    if (id.orgs?.length) row.orgs = id.orgs.slice(0, 5);
    if (id.name && (!row.name || row.name === row.login)) row.name = id.name;
    if (id.createdAt && !row.accountCreatedAt) {
      row.accountCreatedAt = id.createdAt;
      row.freshAccount = parse(id.createdAt) >= windowStart;
    }
  }
  const rows = [...roster.values()].sort((a, b) => b.commits - a.commits);
  const total = commits.length;
  for (const r of rows) r.sharePct = pct(r.commits, total);
  const humans = rows.filter((r) => r.kind === "human");
  const humanCommits = humans.reduce((n, r) => n + r.commits, 0);
  const botCommits = rows.filter((r) => r.kind === "bot").reduce((n, r) => n + r.commits, 0);
  const mirrorCommits = rows.filter((r) => r.kind === "mirror").reduce((n, r) => n + r.commits, 0);
  const attributable = humanCommits + mirrorCommits;
  const top1SharePct = attributable ? pct(Math.max(...rows.filter((r) => r.kind !== "bot").map((r) => r.commits)), attributable) : 0;
  const hhi = attributable ? Math.round(rows.filter((r) => r.kind !== "bot").reduce((s, r) => s + Math.pow(r.commits / attributable, 2), 0) * 1e3) / 1e3 : 0;
  let concentration;
  if (total === 0) concentration = "unknown";
  else if (humans.length === 0) concentration = "unattributed";
  else if (top1SharePct >= 85) concentration = "single-author";
  else if (top1SharePct >= 50) concentration = "lead-plus";
  else concentration = "team";
  const priorLead = [...humans].sort((a, b) => b.prior60 - a.prior60)[0];
  const priorTotal = humans.reduce((n, r) => n + r.prior60, 0);
  const recentTotal = humans.reduce((n, r) => n + r.last30, 0);
  const leadPriorSharePct = priorLead && priorTotal ? pct(priorLead.prior60, priorTotal) : 0;
  const departed = !!priorLead && priorLead.prior60 >= 5 && priorLead.last30 === 0 && recentTotal >= 3;
  const goneQuiet = humans.filter((h) => h.prior60 >= 3 && h.last30 === 0).map((h) => h.login ? `@${h.login}` : h.name);
  const churnDetail = !priorLead || priorTotal === 0 ? "Not enough history before the last 30 days to read committer churn." : departed ? `${priorLead.login ? `@${priorLead.login}` : priorLead.name} wrote ${leadPriorSharePct}% of the prior 60 days' commits and none in the last 30 while ${recentTotal} commits landed from others: the lead has stopped and the repository has not.` : goneQuiet.length ? `${goneQuiet.length} committer${goneQuiet.length === 1 ? "" : "s"} active in the prior 60 days ${goneQuiet.length === 1 ? "has" : "have"} no commits in the last 30 (${goneQuiet.slice(0, 3).join(", ")}).` : `${priorLead.login ? `@${priorLead.login}` : priorLead.name} carried ${leadPriorSharePct}% of the prior 60 days and is still committing (${priorLead.last30} in the last 30).`;
  const measured = commits.filter((c) => c.additions != null && c.deletions != null);
  const lines = measured.map((c) => (c.additions ?? 0) + (c.deletions ?? 0));
  const files = measured.map((c) => c.files ?? 0).filter((n) => n > 0);
  const trivial = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) <= TRIVIAL_LINES).length;
  const docsOnly = commits.filter((c) => DOCS_HEADLINE.test(c.headline) && !/\b(feat|feature|add|implement|fix)\b/i.test(c.headline)).length;
  const bulkDrops = measured.filter((c) => (c.additions ?? 0) + (c.deletions ?? 0) >= BULK_LINES && (c.files ?? 0) >= BULK_FILES);
  const substance = {
    measuredCommits: measured.length,
    medianLinesChanged: median(lines),
    meanLinesChanged: lines.length ? Math.round(lines.reduce((a, b) => a + b, 0) / lines.length) : void 0,
    medianFiles: median(files),
    trivialSharePct: measured.length ? pct(trivial, measured.length) : void 0,
    docsOnlySharePct: total ? pct(docsOnly, total) : void 0,
    bulkDropCount: bulkDrops.length
  };
  const aiTrailerCount = commits.filter((c) => AI_TRAILER.test(`${c.headline}
${c.body ?? ""}`)).length;
  const generic = commits.filter((c) => GENERIC_HEADLINE.test(c.headline.trim())).length;
  const mirroredSharePct = total ? pct(mirrorCommits, total) : 0;
  const authorshipEvidence = [];
  let authorship;
  if (total === 0) authorship = "unknown";
  else if (mirroredSharePct >= 80) {
    authorship = "mirrored";
    authorshipEvidence.push(`${mirroredSharePct}% of commits are sync/mirror exports from a private repository, so the public history says who published, not who wrote.`);
  } else {
    const aiShare = pct(aiTrailerCount, total);
    const genericShare = pct(generic, total);
    if (aiShare >= 30 || bulkDrops.length >= 3 && genericShare >= 30) authorship = "machine-heavy";
    else if (aiShare > 0 || genericShare >= 30 || bulkDrops.length >= 2) authorship = "mixed";
    else authorship = "hand-authored";
    if (aiTrailerCount) authorshipEvidence.push(`${aiTrailerCount} commit${aiTrailerCount === 1 ? "" : "s"} carry an AI co-author trailer (Claude, Copilot, Cursor or similar).`);
    if (genericShare >= 30) authorshipEvidence.push(`${genericShare}% of commit messages are placeholders ("update", "fix", "wip").`);
    if (bulkDrops.length) authorshipEvidence.push(`${bulkDrops.length} bulk drop${bulkDrops.length === 1 ? "" : "s"} of ${BULK_LINES}+ lines across ${BULK_FILES}+ files landed as single commits.`);
    if (authorship === "hand-authored") authorshipEvidence.push("Commit messages are specific and the change sizes are incremental, consistent with hand-authored work.");
  }
  const forks = input.repos.filter((r) => r.isFork).map((r) => ({ repo: r.nameWithOwner, parent: r.parent ?? "unknown upstream" }));
  const templates = input.repos.filter((r) => r.isTemplate).map((r) => r.nameWithOwner);
  const forkSharePct = input.repos.length ? pct(forks.length, input.repos.length) : 0;
  const bulkImports = [];
  for (const r of input.repos) {
    const first = commits.find((c) => c.repo === r.nameWithOwner);
    if (!first) continue;
    const opensWithDrop = (first.additions ?? 0) >= BULK_LINES && (first.files ?? 0) >= BULK_FILES && parse(r.createdAt) >= windowStart;
    if (opensWithDrop) bulkImports.push(r.nameWithOwner);
  }
  let origin;
  if (input.repos.length === 0) origin = "unknown";
  else if (forkSharePct >= 80 || forks.length > 0 && forks.length === input.repos.length) origin = "derivative";
  else if (forks.length > 0 || bulkImports.length > 0) origin = "partly-derivative";
  else origin = "original";
  const sample = input.stargazers ?? [];
  const starTotal = input.repos.reduce((n, r) => n + r.stars, 0);
  const starEvidence = [];
  let starVerdict;
  let lowActivitySharePct;
  let burstSharePct;
  let burstWindowStart;
  let historyStars;
  let launchBurst = false;
  const flagship = input.repos.find((r) => r.nameWithOwner === (input.starHistoryRepo ?? input.stargazerRepo)) ?? [...input.repos].sort((a, b) => b.stars - a.stars)[0];
  const proportion = (() => {
    if (!flagship || flagship.stars < 100) return null;
    const forkRatio = flagship.forks / flagship.stars;
    const watchRatio = flagship.watchers != null ? flagship.watchers / flagship.stars : void 0;
    const commitsOnFlagship = commits.filter((c) => c.repo === flagship.nameWithOwner).length;
    const thinWork = commitsOnFlagship < 5 && (flagship.commitsInWindow ?? commitsOnFlagship) < 5;
    const disproportionate = forkRatio < 0.02 && (watchRatio == null || watchRatio < 0.01) && (thinWork || flagship.stars >= 1e3);
    const line = `${flagship.nameWithOwner} has ${flagship.stars} stars against ${flagship.forks} forks${flagship.watchers != null ? ` and ${flagship.watchers} watchers` : ""}${thinWork ? " with under five commits in the window" : ""}.`;
    return { disproportionate, line };
  })();
  const history = (input.starHistory ?? []).filter((d) => Number.isFinite(parse(d.date)) && Number.isFinite(d.stars) && d.stars >= 0).sort((a, b) => parse(a.date) - parse(b.date));
  if (history.length) {
    historyStars = history.reduce((n, d) => n + d.stars, 0);
    if (historyStars >= 30) {
      let best = 0;
      let bestStart = history[0].date;
      for (let i = 0; i < history.length; i++) {
        let n = 0;
        for (let j = i; j < history.length && parse(history[j].date) - parse(history[i].date) < 3 * DAY; j++) n += history[j].stars;
        if (n > best) {
          best = n;
          bestStart = history[i].date;
        }
      }
      burstSharePct = pct(best, historyStars);
      burstWindowStart = bestStart;
      const repoAgeAtBurstDays = flagship ? (parse(bestStart) - parse(flagship.createdAt)) / DAY : void 0;
      launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    }
  }
  if (starTotal === 0) {
    starVerdict = "none";
    starEvidence.push("No stars on the reviewed repositories, so there is nothing to authenticate.");
  } else if (sample.length >= 20) {
    const low = sample.filter((s) => {
      const created = parse(s.createdAt);
      const starred = parse(s.starredAt);
      const youngAccount = Number.isFinite(created) && Number.isFinite(starred) && starred - created <= 30 * DAY;
      const empty = (s.repos ?? 1) === 0 && (s.followers ?? 1) === 0;
      return youngAccount || empty;
    }).length;
    lowActivitySharePct = pct(low, sample.length);
    const times = sample.map((s) => parse(s.starredAt)).filter(Number.isFinite).sort((a, b) => a - b);
    let best = 0;
    let bestStart = times[0];
    for (let i = 0, j = 0; i < times.length; i++) {
      while (times[i] - times[j] > 72 * 36e5) j++;
      const n = i - j + 1;
      if (n > best) {
        best = n;
        bestStart = times[j];
      }
    }
    burstSharePct = pct(best, times.length);
    burstWindowStart = Number.isFinite(bestStart) ? new Date(bestStart).toISOString() : void 0;
    const sampledRepo = input.repos.find((r) => r.nameWithOwner === input.stargazerRepo);
    const repoAgeAtBurstDays = sampledRepo && Number.isFinite(bestStart) ? (bestStart - parse(sampledRepo.createdAt)) / DAY : void 0;
    launchBurst = repoAgeAtBurstDays != null && repoAgeAtBurstDays <= 30;
    const suspect = lowActivitySharePct >= 40 || burstSharePct >= 50 && !launchBurst;
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${lowActivitySharePct}% of ${sample.length} sampled stargazers are low-activity accounts (created within 30 days of starring, or no repos and no followers).`);
    starEvidence.push(`${burstSharePct}% of sampled stars landed inside one 72-hour window${launchBurst ? " during the repository's first month, which is a normal launch pattern" : ""}.`);
    if (suspect) starEvidence.push("This is the signature StarScout (Six Million Suspected Fake Stars, ICSE 2026) associates with purchased stars.");
  } else if (burstSharePct != null && historyStars != null && flagship) {
    const timedBurst = burstSharePct >= 50 && !launchBurst;
    const softBurst = burstSharePct >= 30 && !launchBurst;
    const suspect = timedBurst || softBurst && !!proportion?.disproportionate || !!proportion?.disproportionate && burstSharePct >= 15;
    starVerdict = suspect ? "suspect" : "organic";
    starEvidence.push(`${burstSharePct}% of ${flagship.nameWithOwner}'s ${historyStars.toLocaleString("en-US")} stars arrived inside one three-day window starting ${burstWindowStart}${launchBurst ? ", inside the repository's first month, which is a normal launch pattern" : ""}.`);
    if (proportion) starEvidence.push(proportion.line + (proportion.disproportionate ? " Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone." : ""));
    if (suspect) starEvidence.push("A star burst outside launch week, with nothing else growing alongside it, is the lockstep signature StarScout associates with purchased stars. GitHub no longer exposes who starred, so the accounts themselves cannot be checked.");
    else starEvidence.push("Star timing is spread across the history; the accounts behind the stars are no longer readable since GitHub restricted stargazer lists in June 2026.");
  } else if (proportion) {
    starVerdict = proportion.disproportionate ? "suspect" : "insufficient";
    starEvidence.push(`No star history or stargazer sample was available, so the read is proportional: ${proportion.line}`);
    if (proportion.disproportionate) starEvidence.push("Organic attention brings forks, watchers and contributors along with stars; this repository has the stars alone.");
    else starEvidence.push("The proportions are ordinary; nothing here separates bought stars from earned ones without the star history.");
  } else {
    starVerdict = "insufficient";
    starEvidence.push(historyStars != null && historyStars < 30 ? `The star history holds ${historyStars} star${historyStars === 1 ? "" : "s"}; a timing read needs at least 30.` : `Only ${sample.length} stargazer${sample.length === 1 ? "" : "s"} could be sampled; a star-authenticity read needs at least 20.`);
  }
  const hyg = {
    reposReviewed: input.repos.length,
    withLicense: input.repos.filter((r) => !!r.license).length,
    withReadme: input.repos.filter((r) => r.hasReadme).length,
    withCi: input.repos.filter((r) => r.hasCi).length,
    withTests: input.repos.filter((r) => r.hasTests).length,
    archived: input.repos.filter((r) => r.isArchived).length,
    openIssues: input.repos.reduce((n, r) => n + (r.openIssues ?? 0), 0),
    openPullRequests: input.repos.reduce((n, r) => n + (r.openPullRequests ?? 0), 0)
  };
  let hygieneVerdict = "unknown";
  if (input.repos.length) {
    const score = [hyg.withLicense, hyg.withReadme, hyg.withCi, hyg.withTests].filter((n) => n > 0).length;
    hygieneVerdict = score >= 3 ? "maintained" : score >= 1 ? "partial" : "neglected";
  }
  const price = (input.priceSeries ?? []).filter((p) => Number.isFinite(p.close) && Number.isFinite(parse(p.date)) && parse(p.date) >= windowStart).sort((a, b) => parse(a.date) - parse(b.date));
  let marketRead = "insufficient";
  let priceChangePct;
  let commitTrendPct;
  let marketDetail = "Not enough price history or commits to compare the chart with the commit log.";
  if (price.length >= 4 && total > 0) {
    priceChangePct = round1((price[price.length - 1].close - price[0].close) / price[0].close * 100);
    const mid = nowMs - windowMs / 2;
    const firstHalf = commits.filter((c) => parse(c.date) < mid).length;
    const secondHalf = total - firstHalf;
    commitTrendPct = firstHalf > 0 ? round1((secondHalf - firstHalf) / firstHalf * 100) : secondHalf > 0 ? 100 : 0;
    const shippingUp = secondHalf >= firstHalf && secondHalf > 0;
    const shippingDown = secondHalf < firstHalf * 0.5;
    if (priceChangePct <= -15 && shippingUp) {
      marketRead = "shipping-into-weakness";
      marketDetail = `Price is down ${Math.abs(priceChangePct)}% over the window while commits held or rose (${firstHalf} then ${secondHalf} per half): the team kept building through the drawdown.`;
    } else if (priceChangePct >= 30 && (shippingDown || secondHalf === 0)) {
      marketRead = "price-without-shipping";
      marketDetail = `Price is up ${priceChangePct}% while commits fell (${firstHalf} then ${secondHalf} per half): the move is not backed by visible development.`;
    } else if (priceChangePct >= 0 && shippingUp) {
      marketRead = "aligned-up";
      marketDetail = `Price (${priceChangePct >= 0 ? "+" : ""}${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) rose together.`;
    } else if (priceChangePct < 0 && shippingDown) {
      marketRead = "aligned-down";
      marketDetail = `Price (${priceChangePct}%) and commit cadence (${firstHalf} then ${secondHalf} per half) fell together: a project going quiet, not one being ignored.`;
    } else {
      marketRead = "mixed";
      marketDetail = `Price moved ${priceChangePct >= 0 ? "+" : ""}${priceChangePct}% with commits at ${firstHalf} then ${secondHalf} per half: no clean relationship.`;
    }
  } else if (total === 0 && price.length >= 4) {
    priceChangePct = round1((price[price.length - 1].close - price[0].close) / price[0].close * 100);
    marketRead = priceChangePct >= 30 ? "price-without-shipping" : "insufficient";
    marketDetail = priceChangePct >= 30 ? `Price is up ${priceChangePct}% over a window with no commits at all.` : "No commits in the window, so there is no development to set against the chart.";
  }
  const claimsIn = (input.claims ?? []).filter((c) => SHIP_CLAIM.test(c.text) && Number.isFinite(parse(c.date)));
  const releases = input.repos.flatMap((r) => r.releases.map((rel) => ({ ...rel, repo: r.nameWithOwner })));
  const graded = claimsIn.map((claim) => {
    const at = parse(claim.date);
    const matchedCommits = commits.filter((c) => parse(c.date) >= at - 7 * DAY && parse(c.date) <= at + 2 * DAY).length;
    const rel = releases.find((r) => Math.abs(parse(r.publishedAt) - at) <= 7 * DAY);
    const grade2 = rel || matchedCommits >= 3 ? "supported" : matchedCommits > 0 ? "context" : "unsupported";
    return { ...claim, grade: grade2, matchedCommits, matchedRelease: rel?.tag };
  });
  const supported = graded.filter((g) => g.grade === "supported").length;
  const context2 = graded.filter((g) => g.grade === "context").length;
  const unsupported = graded.filter((g) => g.grade === "unsupported").length;
  const claimDetail = !graded.length ? "No shipping claims were found in the project's posts inside the window." : `${graded.length} shipping claim${graded.length === 1 ? "" : "s"} in the project's posts: ${supported} backed by a release or a burst of commits, ${context2} near light activity, ${unsupported} with nothing in the public repositories within a week.`;
  let peers;
  if (input.peers && input.peers.repos.length) {
    const subject = {
      commitsInWindow: total,
      authorsInWindow: humans.length,
      stars: starTotal
    };
    const med = {
      commitsInWindow: median(input.peers.repos.map((r) => r.commitsInWindow)) ?? 0,
      authorsInWindow: median(input.peers.repos.map((r) => r.authorsInWindow)) ?? 0,
      stars: median(input.peers.repos.map((r) => r.stars)) ?? 0
    };
    const position = {
      commits: positionOf(subject.commitsInWindow, med.commitsInWindow),
      authors: positionOf(subject.authorsInWindow, med.authorsInWindow),
      stars: positionOf(subject.stars, med.stars)
    };
    const word = (p) => p === "below" ? "below" : p === "above" ? "above" : p === "within" ? "in line with" : "not comparable to";
    peers = {
      sector: input.peers.sector,
      label: input.peers.label,
      subject,
      median: med,
      position,
      rows: input.peers.repos,
      detail: `Against ${input.peers.label} (${input.peers.repos.map((r) => r.nameWithOwner).join(", ")}): ${subject.commitsInWindow} commits is ${word(position.commits)} the peer median of ${Math.round(med.commitsInWindow)}, ${subject.authorsInWindow} human author${subject.authorsInWindow === 1 ? "" : "s"} is ${word(position.authors)} the median of ${Math.round(med.authorsInWindow)}, and ${starTotal} stars is ${word(position.stars)} the median of ${Math.round(med.stars)}.`
    };
  }
  const deploys = (input.deploys ?? []).filter((d) => Number.isFinite(parse(d.date)) && parse(d.date) >= windowStart);
  const publishes = (input.packages ?? []).flatMap((pk) => pk.versions.filter((v) => Number.isFinite(parse(v.date)) && parse(v.date) >= windowStart).map((v) => ({ ...v, name: pk.name })));
  const releaseTimes = input.repos.flatMap((r) => r.releases.map((rel) => parse(rel.publishedAt))).filter((t) => Number.isFinite(t) && t <= nowMs + DAY);
  const followsCode = (t) => releaseTimes.some((r) => t >= r && t - r <= 14 * DAY) || commits.filter((c) => parse(c.date) <= t && t - parse(c.date) <= 14 * DAY).length >= 3;
  const codeToChain = [...deploys.map((d) => parse(d.date)), ...publishes.map((p) => parse(p.date))].filter(followsCode).length;
  const verifiedDeploys = deploys.filter((d) => d.verified).length;
  let liveVerdict;
  if (!input.deploys && !input.packages) liveVerdict = "unknown";
  else if ((deploys.length || publishes.length) && codeToChain > 0) liveVerdict = "live";
  else if (deploys.length || publishes.length) liveVerdict = "deploys-without-code";
  else liveVerdict = total > 0 ? "committed-only" : "unknown";
  const liveDetail = liveVerdict === "unknown" ? "No deployer history or package registry was read, so whether the code reached production is not known." : liveVerdict === "live" ? `${deploys.length} on-chain deploy${deploys.length === 1 ? "" : "s"}${verifiedDeploys ? ` (${verifiedDeploys} verified)` : ""} and ${publishes.length} package publish${publishes.length === 1 ? "" : "es"} in the window; ${codeToChain} followed a release or a burst of commits within two weeks, so the public code is what is going live.` : liveVerdict === "deploys-without-code" ? `${deploys.length} deploy${deploys.length === 1 ? "" : "s"} and ${publishes.length} publish${publishes.length === 1 ? "" : "es"} in the window with no matching activity in the public repositories: the shipping happens somewhere this read cannot see.` : `${total} commits in the window and no on-chain deploy or package publish: work committed, nothing visibly shipped to users yet.`;
  const prsSampled = input.repos.reduce((n, r) => n + (r.pullRequestsSampled ?? 0), 0);
  const externalPrs = input.repos.reduce((n, r) => n + (r.externalPullRequests ?? 0), 0);
  const issuesSampled = input.repos.reduce((n, r) => n + (r.issuesSampled ?? 0), 0);
  const externalIssues = input.repos.reduce((n, r) => n + (r.externalIssues ?? 0), 0);
  const activeForks = input.repos.reduce((n, r) => n + (r.activeForks ?? 0), 0);
  const packageDownloads = (input.packages ?? []).reduce((n, pk) => pk.downloadsLastMonth == null ? n : (n ?? 0) + pk.downloadsLastMonth, void 0);
  const externalPrSharePct = prsSampled ? pct(externalPrs, prsSampled) : void 0;
  const externalIssueSharePct = issuesSampled ? pct(externalIssues, issuesSampled) : void 0;
  let adoptionVerdict = "unknown";
  const adoptionRead = prsSampled > 0 || issuesSampled > 0 || input.repos.some((r) => r.activeForks != null) || packageDownloads != null;
  if (adoptionRead) {
    const strong = externalPrs >= 3 || (packageDownloads ?? 0) >= 1e3 || activeForks >= 5;
    const some = externalPrs >= 1 || externalIssues >= 3 || (packageDownloads ?? 0) >= 100 || activeForks >= 1;
    adoptionVerdict = strong ? "used" : some ? "noticed" : "unused";
  }
  const adoptionDetail = !adoptionRead ? "No pull-request, issue, fork or download data was read." : `${externalPrs} of ${prsSampled} sampled pull requests and ${externalIssues} of ${issuesSampled} sampled issues came from outside the team; ${activeForks} fork${activeForks === 1 ? "" : "s"} pushed to in the window${packageDownloads != null ? `; ${packageDownloads.toLocaleString("en-US")} package downloads last month` : ""}. ${adoptionVerdict === "used" ? "Outsiders are contributing, which is the hardest attention signal to fake." : adoptionVerdict === "noticed" ? "Some outside attention, not yet outside contribution." : "Nobody outside the team is contributing, filing or forking."}`;
  const flagshipForHealth = flagship ?? input.repos[0];
  const ci = flagshipForHealth?.ciState ?? "unknown";
  const licenseId = flagshipForHealth?.license;
  const license = flagshipForHealth ? licenseClass(licenseId) : "unknown";
  const auditInTree = input.repos.some((r) => r.hasAudit);
  const lockfileAgeDays = flagshipForHealth?.lockfileUpdatedAt && Number.isFinite(parse(flagshipForHealth.lockfileUpdatedAt)) ? Math.max(0, Math.round((nowMs - parse(flagshipForHealth.lockfileUpdatedAt)) / DAY)) : void 0;
  let healthVerdict = "unknown";
  if (input.repos.length) {
    let good = 0;
    let bad = 0;
    if (ci === "success") good++;
    else if (ci === "failure") bad++;
    if (license === "permissive") good++;
    else if (license === "none") bad++;
    if (auditInTree) good++;
    if (lockfileAgeDays != null) {
      if (lockfileAgeDays <= 90) good++;
      else if (lockfileAgeDays > 365) bad++;
    }
    healthVerdict = bad === 0 && good >= 2 ? "sound" : bad >= 2 ? "poor" : "mixed";
  }
  const healthDetail = !input.repos.length ? "No repository to assess." : [
    ci === "success" ? "Latest default-branch checks pass" : ci === "failure" ? "Latest default-branch checks FAIL" : ci === "pending" ? "Latest checks still running" : "No check status exposed",
    license === "permissive" ? `${licenseId} licence (permissive)` : license === "copyleft" ? `${licenseId} licence (copyleft; derivative work must be shared)` : license === "source-available" ? `${licenseId} (source-available, not open source)` : license === "none" ? "no licence file, so the code cannot legally be reused" : `${licenseId ?? "unrecognised"} licence`,
    auditInTree ? "an audit report is in the tree" : "no audit report in the tree",
    lockfileAgeDays != null ? `dependencies last locked ${lockfileAgeDays} days ago` : "no lockfile read"
  ].join("; ") + ".";
  const weeklyMap = /* @__PURE__ */ new Map();
  let trendSource = "none";
  for (const r of input.repos) for (const w of r.weeklyCommits ?? []) {
    weeklyMap.set(w.weekStart, (weeklyMap.get(w.weekStart) ?? 0) + w.commits);
    trendSource = "provider-weekly";
  }
  if (trendSource === "none" && commits.length) {
    for (const w of weeks) weeklyMap.set(w.weekStart, w.commits);
    trendSource = "window-commits";
  }
  const trendKeys = [...weeklyMap.keys()].sort().slice(-52);
  const weekOf = (t) => trendKeys.find((k, i) => t >= parse(k) && (i === trendKeys.length - 1 || t < parse(trendKeys[i + 1])));
  const priceByWeek = /* @__PURE__ */ new Map();
  for (const pt of input.priceSeries ?? []) {
    const k = weekOf(parse(pt.date));
    if (k) {
      priceByWeek.set(k, [...priceByWeek.get(k) ?? [], pt.close]);
    }
  }
  const releasesByWeek = /* @__PURE__ */ new Map();
  for (const t of releaseTimes) {
    const k = weekOf(t);
    if (k) releasesByWeek.set(k, (releasesByWeek.get(k) ?? 0) + 1);
  }
  const deploysByWeek = /* @__PURE__ */ new Map();
  for (const d of input.deploys ?? []) {
    const k = weekOf(parse(d.date));
    if (k) deploysByWeek.set(k, (deploysByWeek.get(k) ?? 0) + 1);
  }
  const trendWeeks = trendKeys.map((k) => ({ weekStart: k, commits: weeklyMap.get(k) ?? 0, price: median(priceByWeek.get(k) ?? []), releases: releasesByWeek.get(k) ?? 0, deploys: deploysByWeek.get(k) ?? 0 }));
  const lifeCommits = trendWeeks.reduce((n, w) => n + w.commits, 0);
  const activeWeeksLife = trendWeeks.filter((w) => w.commits > 0).length;
  const trendDetail = trendSource === "none" ? "No weekly history was read." : `${lifeCommits} commits across ${activeWeeksLife} of the last ${trendWeeks.length} weeks${trendSource === "window-commits" ? " (window only; the provider's yearly statistics were not available)" : ""}.`;
  const roadmapClaims = extractRoadmapClaims(input.docsText).map((c) => {
    const due = parse(c.due);
    const from = due - 30 * DAY;
    const to = due + 30 * DAY;
    const rel = releaseTimes.filter((t) => t >= from && t <= to).length;
    const dep = deploys.filter((d) => parse(d.date) >= from && parse(d.date) <= to).length;
    const com = commits.filter((c2) => parse(c2.date) >= from && parse(c2.date) <= to).length;
    const weekly = trendWeeks.filter((w) => parse(w.weekStart) >= from - 7 * DAY && parse(w.weekStart) <= to).reduce((n, w) => n + w.commits, 0);
    let grade2;
    let evidence2;
    if (due > nowMs) {
      grade2 = "pending";
      evidence2 = `Due ${c.due.slice(0, 10)}; not yet reached.`;
    } else if (rel || dep) {
      grade2 = "met";
      evidence2 = `${rel} release${rel === 1 ? "" : "s"} and ${dep} deploy${dep === 1 ? "" : "s"} within a month of ${c.due.slice(0, 10)}.`;
    } else if (com >= 5 || weekly >= 10) {
      grade2 = "met";
      evidence2 = `${Math.max(com, weekly)} commits within a month of ${c.due.slice(0, 10)}; no tagged release or deploy to name.`;
    } else if (due < windowStart - 30 * DAY && trendSource !== "provider-weekly") {
      grade2 = "unclear";
      evidence2 = `Due ${c.due.slice(0, 10)}, before this read's history begins.`;
    } else {
      grade2 = "missed";
      evidence2 = `Nothing in the repositories within a month of ${c.due.slice(0, 10)}.`;
    }
    return { text: c.text, due: c.due, grade: grade2, evidence: evidence2 };
  });
  const roadmapMet = roadmapClaims.filter((c) => c.grade === "met").length;
  const roadmapMissed = roadmapClaims.filter((c) => c.grade === "missed").length;
  const roadmapPending = roadmapClaims.filter((c) => c.grade === "pending").length;
  const roadmapDetail = !input.docsText ? "No roadmap or docs text was read." : !roadmapClaims.length ? "The docs carry no dated promises to check." : `${roadmapClaims.length} dated promise${roadmapClaims.length === 1 ? "" : "s"} in the docs: ${roadmapMet} met, ${roadmapMissed} missed, ${roadmapPending} still ahead.`;
  const cohort = input.cohort && input.cohort.size > 0 ? {
    ...input.cohort,
    detail: `Among ${input.cohort.size} ${input.cohort.label}: ${total} commits sits ${input.cohort.percentileCommits != null ? `at the ${Math.round(input.cohort.percentileCommits)}th percentile` : `against a median of ${Math.round(input.cohort.medianCommits)}`}, ${humans.length} human author${humans.length === 1 ? "" : "s"} ${input.cohort.percentileAuthors != null ? `at the ${Math.round(input.cohort.percentileAuthors)}th` : `against a median of ${Math.round(input.cohort.medianAuthors)}`}${input.cohort.shippingSharePct != null ? `; ${Math.round(input.cohort.shippingSharePct)}% of the cohort is still shipping` : ""}.`
  } : void 0;
  const commitsCounted = input.repos.reduce((n, r) => n + (r.commitsInWindow ?? 0), 0);
  const historyRepos = new Set(commits.map((c) => c.repo)).size;
  const coverageNotes = [...input.readNotes ?? []];
  if (input.reposTotal != null && input.reposTotal > input.repos.length) coverageNotes.push(`${input.repos.length} of ${input.reposTotal} repositories reviewed (most recently pushed first).`);
  if (commitsCounted > total) coverageNotes.push(`${total} of ${commitsCounted} window commits read in detail; cadence and authorship come from the read set, the count from the provider.`);
  if (!input.starHistory?.length && starTotal > 0) coverageNotes.push("No star history was read; the star read is proportional.");
  if (!input.identities) coverageNotes.push("Committer accounts were not resolved to X handles or employers.");
  if (!input.deploys && !input.packages) coverageNotes.push("No on-chain deployer history or package registry was joined.");
  if (!input.priceSeries?.length) coverageNotes.push("No price series was joined; the chart-versus-commits read is empty.");
  if (!input.claims?.length) coverageNotes.push("No project posts were joined; shipping claims were not graded.");
  if (!input.docsText) coverageNotes.push("No roadmap or docs text was joined.");
  let grade;
  if (status === "unknown") grade = "unknown";
  else if (status === "dormant") grade = "stalled";
  else if (total < 10 || total < 30 && substance.medianLinesChanged != null && substance.medianLinesChanged < 10 && releasesInWindow === 0) grade = "thin";
  else if (concentration === "team" || concentration === "lead-plus") grade = "shipping-team";
  else grade = "shipping-solo";
  const who = concentration === "team" ? `${humans.length} people` : concentration === "lead-plus" ? `${humans.length} people with one carrying ${top1SharePct}%` : concentration === "single-author" ? "one person" : concentration === "unattributed" ? "an unattributed mirror account" : "nobody visible";
  const headline = grade === "unknown" ? `No public code activity could be read for ${input.target}.` : grade === "stalled" ? `Development has stalled: last commit ${lastCommitDaysAgo} days ago.` : grade === "thin" ? `Thin development: ${total} commit${total === 1 ? "" : "s"} in ${input.windowDays} days from ${who}.` : grade === "shipping-team" ? `Shipping as a team: ${total} commits in ${input.windowDays} days from ${who}.` : `Shipping, but it is ${who}: ${total} commits in ${input.windowDays} days.`;
  let delta;
  if (input.previous) {
    const prev = input.previous;
    const changePct = prev.totalCommits > 0 ? round1((total - prev.totalCommits) / prev.totalCommits * 100) : void 0;
    const stalled = (prev.grade === "shipping-team" || prev.grade === "shipping-solo") && (grade === "stalled" || grade === "thin" || status === "quiet" || status === "dormant");
    const parts = [];
    if (prev.grade !== grade) parts.push(`grade ${shippingGradeLabel(prev.grade).toLowerCase()} \u2192 ${shippingGradeLabel(grade).toLowerCase()}`);
    if (changePct != null) parts.push(`commits ${prev.totalCommits} \u2192 ${total} (${changePct >= 0 ? "+" : ""}${changePct}%)`);
    else if (prev.totalCommits !== total) parts.push(`commits ${prev.totalCommits} \u2192 ${total}`);
    if (prev.distinctHuman !== humans.length) parts.push(`human committers ${prev.distinctHuman} \u2192 ${humans.length}`);
    if (prev.cadenceStatus !== status) parts.push(`cadence ${prev.cadenceStatus} \u2192 ${status}`);
    delta = {
      capturedAt: prev.capturedAt,
      grade: { from: prev.grade, to: grade },
      commits: { from: prev.totalCommits, to: total, changePct },
      humans: { from: prev.distinctHuman, to: humans.length },
      cadence: { from: prev.cadenceStatus, to: status },
      stalled,
      detail: parts.length ? `Since the report of ${prev.capturedAt.slice(0, 10)}: ${parts.join("; ")}.${stalled ? " The project was shipping then and is not now." : ""}` : `Unchanged since the report of ${prev.capturedAt.slice(0, 10)}.`
    };
  }
  evidence.push(`${total} commits across ${activeWeeks} of ${weekCount} weeks; last activity ${lastCommitDaysAgo != null ? `${lastCommitDaysAgo} day${lastCommitDaysAgo === 1 ? "" : "s"} ago` : "unknown"}${longestGapDays != null ? `; longest gap ${longestGapDays} days` : ""}.`);
  if (rows.length) evidence.push(`${humans.length} human committer${humans.length === 1 ? "" : "s"}${botCommits ? `, ${pct(botCommits, total)}% bot commits` : ""}${mirrorCommits ? `, ${mirroredSharePct}% mirrored` : ""}; top author holds ${top1SharePct}% of attributable commits.`);
  if (substance.medianLinesChanged != null) evidence.push(`Median commit changes ${substance.medianLinesChanged} lines${substance.medianFiles != null ? ` across ${substance.medianFiles} files` : ""}; ${substance.trivialSharePct}% are trivial (${TRIVIAL_LINES} lines or fewer).`);
  if (releasesInWindow) evidence.push(`${releasesInWindow} tagged release${releasesInWindow === 1 ? "" : "s"} in the window.`);
  if (forks.length) evidence.push(`${forks.length} of ${input.repos.length} repositories are forks: ${forks.slice(0, 3).map((f) => `${f.repo.split("/")[1]} \u2190 ${f.parent}`).join("; ")}.`);
  if (bulkImports.length) evidence.push(`${bulkImports.length} repositor${bulkImports.length === 1 ? "y opens" : "ies open"} with a bulk code drop rather than incremental history: ${bulkImports.join(", ")}.`);
  evidence.push(...authorshipEvidence);
  if (starVerdict === "suspect") evidence.push(`Star authenticity is suspect: ${starEvidence[0]}`);
  if (departed) evidence.push(churnDetail);
  if (liveVerdict === "live" || liveVerdict === "deploys-without-code") evidence.push(liveDetail);
  if (adoptionVerdict === "used") evidence.push(adoptionDetail);
  if (roadmapMissed) evidence.push(`${roadmapMissed} dated roadmap promise${roadmapMissed === 1 ? "" : "s"} passed with nothing in the repositories to show for ${roadmapMissed === 1 ? "it" : "them"}.`);
  if (ci === "failure") evidence.push("The latest default-branch checks fail.");
  if (delta?.stalled) evidence.push(delta.detail);
  const fresh = humans.filter((h) => h.freshAccount);
  if (fresh.length) caveats.push(`${fresh.length} committer account${fresh.length === 1 ? " was" : "s were"} created inside the window; new accounts are not new people, but they carry no history to check.`);
  if (authorship === "mirrored") caveats.push("A mirrored repository can hide a real team or a single contractor equally well; ask for the private repository's contributor list.");
  if (input.repos.length && input.repos.every((r) => parse(r.createdAt) >= windowStart)) caveats.push("Every reviewed repository was created inside the window, so cadence cannot be distinguished from a launch push.");
  if (starVerdict === "insufficient") caveats.push(starEvidence[0]);
  return {
    target: input.target,
    windowDays: input.windowDays,
    grade,
    headline,
    evidence,
    caveats,
    cadence: { status, totalCommits: total, activeWeeks, weeks, lastCommitDaysAgo, longestGapDays, medianGapDays, releasesInWindow },
    committers: {
      concentration,
      distinctHuman: humans.length,
      distinctAll: rows.length,
      top1SharePct,
      botSharePct: total ? pct(botCommits, total) : 0,
      mirrorSharePct: mirroredSharePct,
      hhi,
      roster: rows.slice(0, 25),
      churn: { leadLogin: priorLead?.login, leadName: priorLead?.name, leadPriorSharePct, leadLast30: priorLead?.last30 ?? 0, departed, goneQuiet, detail: churnDetail }
    },
    substance,
    authorship: { verdict: authorship, aiTrailerCount, genericMessageSharePct: total ? pct(generic, total) : void 0, bulkDropCount: bulkDrops.length, mirroredSharePct, evidence: authorshipEvidence },
    origin: { verdict: origin, forks, forkSharePct, templates, bulkImports },
    stars: { verdict: starVerdict, total: starTotal, sampled: sample.length, repo: input.starHistoryRepo ?? input.stargazerRepo, lowActivitySharePct, burstSharePct, burstWindowStart, historyStars, launchBurst, evidence: starEvidence },
    hygiene: { verdict: hygieneVerdict, ...hyg },
    market: { read: marketRead, priceChangePct, commitTrendPct, detail: marketDetail },
    claims: { graded, supported, context: context2, unsupported, detail: claimDetail },
    ...peers ? { peers } : {},
    ...cohort ? { cohort } : {},
    live: { verdict: liveVerdict, deploysInWindow: deploys.length, verifiedDeploys, publishesInWindow: publishes.length, codeToChain, detail: liveDetail },
    adoption: { verdict: adoptionVerdict, externalPrSharePct, externalIssueSharePct, externalPrs, externalIssues, activeForks, packageDownloadsLastMonth: packageDownloads, packages: (input.packages ?? []).map((pk) => `${pk.registry}:${pk.name}`), detail: adoptionDetail },
    health: { verdict: healthVerdict, ci, license, licenseId, auditInTree, lockfileAgeDays, detail: healthDetail },
    trend: { weeks: trendWeeks, lifeCommits, activeWeeksLife, source: trendSource, detail: trendDetail },
    roadmap: { claims: roadmapClaims, met: roadmapMet, missed: roadmapMissed, pending: roadmapPending, detail: roadmapDetail },
    ...delta ? { delta } : {},
    coverage: { reposTotal: input.reposTotal, reposRead: input.repos.length, historyRepos, commitsCounted, commitsRead: total, starHistoryDays: input.starHistory?.length ?? 0, weeklyStatsRead: trendSource === "provider-weekly", identitiesRead: Object.keys(identities).length, windowDays: input.windowDays, notes: coverageNotes }
  };
}
function summarizeShipping(a, capturedAt) {
  return {
    version: 1,
    target: a.target,
    capturedAt,
    windowDays: a.windowDays,
    grade: a.grade,
    headline: a.headline,
    cadenceStatus: a.cadence.status,
    totalCommits: a.cadence.totalCommits,
    activeWeeks: a.cadence.activeWeeks,
    distinctHuman: a.committers.distinctHuman,
    concentration: a.committers.concentration,
    authorship: a.authorship.verdict,
    origin: a.origin.verdict,
    stars: a.stars.verdict,
    market: a.market.read,
    claimsSupported: a.claims.supported,
    claimsUnsupported: a.claims.unsupported,
    live: a.live.verdict,
    adoption: a.adoption.verdict,
    health: a.health.verdict,
    leadDeparted: a.committers.churn.departed,
    reposRead: a.coverage.reposRead,
    commitsRead: a.coverage.commitsRead,
    releasesInWindow: a.cadence.releasesInWindow,
    committers: a.committers.roster.slice(0, 12).map((c) => ({
      name: c.name,
      ...c.login ? { login: c.login } : {},
      commits: c.commits,
      sharePct: c.sharePct,
      kind: c.kind,
      freshAccount: c.freshAccount,
      ...c.accountCreatedAt ? { accountCreatedAt: c.accountCreatedAt } : {},
      last30: c.last30,
      prior60: c.prior60,
      ...c.twitter ? { twitter: c.twitter } : {},
      ...c.company ? { company: c.company } : {},
      ...c.orgs && c.orgs.length ? { orgs: c.orgs } : {}
    })),
    goneQuiet: a.committers.churn.goneQuiet,
    churnDetail: a.committers.churn.detail,
    license: a.health.license,
    ...a.health.licenseId ? { licenseId: a.health.licenseId } : {},
    ci: a.health.ci,
    auditInTree: a.health.auditInTree,
    ...a.health.lockfileAgeDays != null ? { lockfileAgeDays: a.health.lockfileAgeDays } : {},
    ...a.substance.medianLinesChanged != null ? { medianLinesChanged: a.substance.medianLinesChanged } : {},
    ...a.substance.medianFiles != null ? { medianFiles: a.substance.medianFiles } : {},
    ...a.substance.trivialSharePct != null ? { trivialSharePct: a.substance.trivialSharePct } : {},
    bulkDropCount: a.substance.bulkDropCount,
    aiTrailerCount: a.authorship.aiTrailerCount,
    ...a.authorship.genericMessageSharePct != null ? { genericMessageSharePct: a.authorship.genericMessageSharePct } : {},
    mirrorSharePct: a.committers.mirrorSharePct,
    starsTotal: a.stars.total,
    ...a.stars.burstSharePct != null ? { starBurstSharePct: a.stars.burstSharePct } : {},
    ...a.stars.burstWindowStart ? { starBurstWindowStart: a.stars.burstWindowStart } : {},
    ...a.stars.launchBurst != null ? { starLaunchBurst: a.stars.launchBurst } : {},
    starHistoryDays: a.coverage.starHistoryDays,
    externalPrs: a.adoption.externalPrs,
    externalIssues: a.adoption.externalIssues,
    activeForks: a.adoption.activeForks,
    ...a.adoption.packageDownloadsLastMonth != null ? { packageDownloadsLastMonth: a.adoption.packageDownloadsLastMonth } : {},
    ...a.adoption.packages.length ? { packages: a.adoption.packages } : {},
    deploysInWindow: a.live.deploysInWindow,
    publishesInWindow: a.live.publishesInWindow,
    codeToChain: a.live.codeToChain,
    ...a.peers ? {
      peerSector: a.peers.label,
      peerPositionCommits: a.peers.position.commits,
      peerPositionAuthors: a.peers.position.authors,
      peerPositionStars: a.peers.position.stars
    } : {},
    ...a.cohort ? {
      cohortLabel: a.cohort.label,
      cohortSize: a.cohort.size,
      ...a.cohort.percentileCommits != null ? { cohortPercentileCommits: a.cohort.percentileCommits } : {},
      ...a.cohort.shippingSharePct != null ? { cohortShippingSharePct: a.cohort.shippingSharePct } : {}
    } : {},
    roadmapMet: a.roadmap.met,
    roadmapMissed: a.roadmap.missed,
    roadmapPending: a.roadmap.pending,
    coverageNotes: a.coverage.notes,
    ...a.coverage.reposTotal != null ? { reposTotal: a.coverage.reposTotal } : {},
    commitsCounted: a.coverage.commitsCounted,
    hygiene: a.hygiene.verdict,
    trendWeeks: a.trend.weeks.slice(-52).map((week) => ({
      weekStart: week.weekStart,
      commits: week.commits,
      releases: week.releases,
      deploys: week.deploys,
      ...week.price != null ? { price: week.price } : {}
    })),
    trendSource: a.trend.source,
    top1SharePct: a.committers.top1SharePct,
    botSharePct: a.committers.botSharePct
  };
}
function shippingGradeLabel(grade) {
  switch (grade) {
    case "shipping-team":
      return "Shipping \xB7 team";
    case "shipping-solo":
      return "Shipping \xB7 solo";
    case "thin":
      return "Thin";
    case "stalled":
      return "Stalled";
    default:
      return "Unread";
  }
}

// src/threat/shippingCollect.ts
var GQL = "https://api.github.com/graphql";
var REST = "https://api.github.com";
var NPM_REGISTRY = "https://registry.npmjs.org";
var NPM_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-month";
var PYPI_REGISTRY = "https://pypi.org/pypi";
var PYPI_DOWNLOADS = "https://pypistats.org/api/packages";
var CRATES_REGISTRY = "https://crates.io/api/v1/crates";
var API_VERSION = "2026-03-10";
var GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
var LOGIN_RE = GITHUB_LOGIN_RE;
var NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
var PYPI_NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]{0,80}[A-Za-z0-9])?$/;
var CRATE_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
var WINDOW_DAYS = 90;
var OWNER_REPOS = 10;
var OWNER_REPOS_FALLBACK = 5;
var HISTORY_REPOS = 4;
var HISTORY_PER_REPO = 100;
var IDENTITY_MAX = 25;
var PACKAGES_MAX = 3;
var STAR_HISTORY_PAGES = 4;
var STAR_HISTORY_MIN_STARS = 30;
var LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "foundry.lock"];
var gh = (key) => ({ authorization: `Bearer ${key}`, "user-agent": "argus-due-diligence" });
var fetchImpl = (...args) => fetch(...args);
async function graphql(query, variables, key, usage) {
  usage.calls += 1;
  const r = await fetchImpl(GQL, {
    method: "POST",
    headers: { ...gh(key), "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12e3)
  });
  if (!r.ok) throw new Error(`GitHub GraphQL ${r.status}`);
  const body = await r.json();
  const hard = (body.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (hard.length) throw new Error(`GitHub GraphQL: ${hard[0].message}`);
  if (!body.data) throw new Error("GitHub GraphQL returned no data");
  usage.succeeded += 1;
  return body.data;
}
async function rest(path, key, usage) {
  usage.calls += 1;
  const r = await fetchImpl(REST + path, {
    headers: { ...gh(key), accept: "application/vnd.github+json", "x-github-api-version": API_VERSION },
    signal: AbortSignal.timeout(9e3)
  });
  if (r.status === 202) {
    usage.succeeded += 1;
    return { status: 202, data: null };
  }
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const data = await r.json();
  usage.succeeded += 1;
  return { status: r.status, data };
}
async function keyless(url, usage) {
  usage.calls += 1;
  try {
    const r = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(8e3) });
    if (!r.ok) return null;
    const data = await r.json();
    usage.succeeded += 1;
    return data;
  } catch {
    return null;
  }
}
function flattenWeeks(rows) {
  const out = [];
  for (const row of rows) {
    if (typeof row?.week !== "number" || !Array.isArray(row.days)) continue;
    row.days.forEach((n, i) => {
      if (typeof n === "number" && Number.isFinite(n)) out.push({ date: new Date((row.week + i * 86400) * 1e3).toISOString().slice(0, 10), stars: n });
    });
  }
  return out;
}
async function readStarHistory(full, key, usage) {
  const out = [];
  for (let page = 1; page <= STAR_HISTORY_PAGES; page++) {
    const { data: rows } = await rest(`/repos/${full}/stargazers/history?per_page=30&page=${page}`, key, usage);
    if (!Array.isArray(rows)) throw new Error("GitHub star history had an invalid shape");
    out.push(...flattenWeeks(rows));
    if (rows.length < 30) break;
  }
  return out;
}
async function readWeeklyCommits(full, key, usage) {
  const { status, data } = await rest(`/repos/${full}/stats/commit_activity`, key, usage);
  if (status === 202 || !Array.isArray(data)) return null;
  return data.filter((w) => typeof w?.week === "number" && typeof w.total === "number").map((w) => ({ weekStart: new Date(w.week * 1e3).toISOString().slice(0, 10), commits: w.total })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
var REPO_FIELDS = `
  nameWithOwner isFork isTemplate isArchived description
  parent { nameWithOwner }
  createdAt pushedAt stargazerCount forkCount
  watchers { totalCount }
  primaryLanguage { name }
  licenseInfo { spdxId }
  releases(first: 12, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt } }
  openIssues: issues(states: OPEN) { totalCount }
  openPrs: pullRequests(states: OPEN) { totalCount }
  prSample: pullRequests(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  issueSample: issues(last: 20, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { authorAssociation createdAt } }
  forks(first: 12, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { pushedAt } }
  readme: object(expression: "HEAD:README.md") { ... on Blob { byteSize } }
  workflows: object(expression: "HEAD:.github/workflows") { ... on Tree { entries { name } } }
  testDir: object(expression: "HEAD:test") { ... on Tree { entries { name } } }
  testsDir: object(expression: "HEAD:tests") { ... on Tree { entries { name } } }
  auditsDir: object(expression: "HEAD:audits") { ... on Tree { entries { name } } }
  auditDir: object(expression: "HEAD:audit") { ... on Tree { entries { name } } }
  pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
  pyproject: object(expression: "HEAD:pyproject.toml") { ... on Blob { text } }
  cargo: object(expression: "HEAD:Cargo.toml") { ... on Blob { text } }
  defaultBranchRef { target { ... on Commit {
    history(since: $since, until: $until) { totalCount }
    statusCheckRollup { state }
    ${LOCKFILES.map((f, i) => `lock${i}: history(first: 1, path: ${JSON.stringify(f)}) { nodes { committedDate } }`).join("\n    ")}
  } } }
`;
var INSIDER = /* @__PURE__ */ new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
var isExternal = (assoc) => !!assoc && !INSIDER.has(assoc);
function packageNameOf(text) {
  if (!text || text.length > 2e5) return void 0;
  try {
    const pkg = JSON.parse(text);
    if (pkg.private === true) return void 0;
    return typeof pkg.name === "string" && NPM_NAME_RE.test(pkg.name) ? pkg.name : void 0;
  } catch {
    return void 0;
  }
}
function tomlNameUnder(text, tables, valid) {
  if (!text || text.length > 2e5) return void 0;
  for (const table of tables) {
    const start = text.indexOf(`[${table}]`);
    if (start < 0) continue;
    const body = text.slice(start + table.length + 2);
    const end = body.search(/\n\s*\[/);
    const section = end >= 0 ? body.slice(0, end) : body;
    const m = section.match(/^\s*name\s*=\s*"([^"]+)"/m);
    if (m && valid.test(m[1])) return m[1];
  }
  return void 0;
}
function normaliseRepo(r, since) {
  const target = r.defaultBranchRef?.target;
  const ciRaw = target?.statusCheckRollup?.state;
  const ciState = ciRaw === "SUCCESS" ? "success" : ciRaw === "FAILURE" || ciRaw === "ERROR" ? "failure" : ciRaw === "PENDING" || ciRaw === "EXPECTED" ? "pending" : "unknown";
  const lockDates = LOCKFILES.map((_, i) => target?.[`lock${i}`]?.nodes?.[0]?.committedDate).filter((d) => !!d).sort();
  const sinceMs = Date.parse(since);
  const prs = r.prSample?.nodes ?? [];
  const issues = r.issueSample?.nodes ?? [];
  const hasEntries = (t) => (t?.entries?.length ?? 0) > 0;
  return {
    nameWithOwner: r.nameWithOwner,
    isFork: !!r.isFork,
    parent: r.parent?.nameWithOwner,
    isTemplate: !!r.isTemplate,
    isArchived: !!r.isArchived,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt ?? void 0,
    stars: r.stargazerCount ?? 0,
    forks: r.forkCount ?? 0,
    watchers: r.watchers?.totalCount,
    language: r.primaryLanguage?.name,
    license: r.licenseInfo?.spdxId ?? void 0,
    description: r.description ?? void 0,
    releases: (r.releases?.nodes ?? []).filter((n) => n.publishedAt).map((n) => ({ tag: n.tagName, publishedAt: n.publishedAt })),
    releaseCount: r.releases?.totalCount ?? 0,
    commitsInWindow: target?.history?.totalCount,
    hasReadme: (r.readme?.byteSize ?? 0) > 0,
    hasCi: hasEntries(r.workflows ?? null),
    hasTests: hasEntries(r.testDir ?? null) || hasEntries(r.testsDir ?? null),
    hasAudit: hasEntries(r.auditsDir ?? null) || hasEntries(r.auditDir ?? null),
    openIssues: r.openIssues?.totalCount,
    openPullRequests: r.openPrs?.totalCount,
    ciState,
    lockfileUpdatedAt: lockDates.length ? lockDates[lockDates.length - 1] : void 0,
    packageName: packageNameOf(r.pkg?.text),
    pypiName: tomlNameUnder(r.pyproject?.text, ["project", "tool.poetry"], PYPI_NAME_RE),
    crateName: tomlNameUnder(r.cargo?.text, ["package"], CRATE_NAME_RE),
    pullRequestsSampled: prs.length,
    externalPullRequests: prs.filter((p) => isExternal(p.authorAssociation)).length,
    issuesSampled: issues.length,
    externalIssues: issues.filter((p) => isExternal(p.authorAssociation)).length,
    activeForks: (r.forks?.nodes ?? []).filter((f) => f.pushedAt && Date.parse(f.pushedAt) >= sinceMs).length
  };
}
function normaliseCommit(c, repo) {
  const email = (c.author?.email ?? "").trim().toLowerCase();
  const login = c.author?.user?.login;
  const name = (c.author?.name ?? "").trim();
  return {
    sha: c.oid,
    date: c.committedDate,
    authorKey: email || (login ? login.toLowerCase() : name.toLowerCase()),
    authorName: name || void 0,
    authorLogin: login ?? void 0,
    authorAccountCreatedAt: c.author?.user?.createdAt,
    additions: c.additions,
    deletions: c.deletions,
    files: c.changedFilesIfAvailable ?? void 0,
    headline: c.messageHeadline,
    body: c.messageBody ?? void 0,
    repo
  };
}
var alias = (i) => `r${i}`;
var splitRepo = (full) => {
  const [owner, name] = full.split("/");
  return { owner, name };
};
async function readOwnerRepoList(owner, key, usage) {
  const q = `query($login: String!) { light: repositoryOwner(login: $login) { repositories(first: ${OWNER_REPOS}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount nodes { nameWithOwner } } } }`;
  const d = await graphql(q, { login: owner }, key, usage);
  if (!d.light) throw new Error("owner_not_found");
  return { names: (d.light.repositories?.nodes ?? []).map((n) => n.nameWithOwner), total: d.light.repositories?.totalCount ?? 0 };
}
async function readOwnerRepos(owner, since, until, key, usage, notes) {
  const query = (first) => `query($login: String!, $since: GitTimestamp!, $until: GitTimestamp) { repositoryOwner(login: $login) { repositories(first: ${first}, orderBy: { field: PUSHED_AT, direction: DESC }, ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount nodes { ${REPO_FIELDS} } } } }`;
  const edgeTimeout = (e) => /GraphQL 50[234]/.test(String(e));
  let d;
  try {
    d = await graphql(query(OWNER_REPOS), { login: owner, since, until }, key, usage);
  } catch (e) {
    if (!edgeTimeout(e)) throw e;
    try {
      d = await graphql(query(OWNER_REPOS_FALLBACK), { login: owner, since, until }, key, usage);
      notes?.push(`GitHub timed out on the wide read; only the ${OWNER_REPOS_FALLBACK} most recently pushed repositories were reviewed.`);
    } catch (e2) {
      if (!edgeTimeout(e2)) throw e2;
      const { names, total } = await readOwnerRepoList(owner, key, usage);
      const repos = [];
      for (const full of names.slice(0, OWNER_REPOS_FALLBACK)) {
        try {
          const one = await readSingleRepo(full, since, until, key, usage);
          repos.push(...one.repos);
        } catch (e3) {
          if (!edgeTimeout(e3)) throw e3;
          notes?.push(`${full} could not be read even on its own.`);
        }
      }
      notes?.push(`GitHub timed out on the organisation read twice; ${repos.length} of ${total} repositories were read one at a time.`);
      return { repos, total };
    }
  }
  if (!d.repositoryOwner) throw new Error("owner_not_found");
  return { repos: (d.repositoryOwner.repositories?.nodes ?? []).map((r) => normaliseRepo(r, since)), total: d.repositoryOwner.repositories?.totalCount ?? 0 };
}
async function readSingleRepo(full, since, until, key, usage) {
  const { owner, name } = splitRepo(full);
  const q = `query($owner: String!, $name: String!, $since: GitTimestamp!, $until: GitTimestamp) { repository(owner: $owner, name: $name) { ${REPO_FIELDS} } }`;
  const d = await graphql(q, { owner, name, since, until }, key, usage);
  return d.repository ? { repos: [normaliseRepo(d.repository, since)], total: 1 } : { repos: [], total: 0 };
}
var HISTORY_PER_REPO_FALLBACK = 40;
var HISTORY_FIELDS_OF = (first) => `
  nameWithOwner
  defaultBranchRef { target { ... on Commit { history(first: ${first}, since: $since, until: $until) { nodes {
    oid committedDate additions deletions changedFilesIfAvailable messageHeadline messageBody
    author { name email user { login createdAt } }
  } } } } }
`;
async function readHistory(repos, since, until, key, usage, notes) {
  if (!repos.length) return [];
  const edgeTimeout = (e) => /GraphQL 50[234]/.test(String(e));
  const collect = (d) => {
    const out2 = [];
    for (const node of Object.values(d)) {
      if (!node) continue;
      for (const c of node.defaultBranchRef?.target?.history?.nodes ?? []) out2.push(normaliseCommit(c, node.nameWithOwner));
    }
    return out2;
  };
  const one = (r, i, first) => {
    const { owner, name } = splitRepo(r.nameWithOwner);
    return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${HISTORY_FIELDS_OF(first)} }`;
  };
  try {
    const q = `query($since: GitTimestamp!, $until: GitTimestamp) { ${repos.map((r, i) => one(r, i, HISTORY_PER_REPO)).join("\n")} }`;
    return collect(await graphql(q, { since, until }, key, usage));
  } catch (e) {
    if (!edgeTimeout(e)) throw e;
  }
  const out = [];
  let trimmed = 0;
  for (const r of repos) {
    let got = null;
    for (const first of [HISTORY_PER_REPO, HISTORY_PER_REPO_FALLBACK]) {
      try {
        got = collect(await graphql(`query($since: GitTimestamp!, $until: GitTimestamp) { ${one(r, 0, first)} }`, { since, until }, key, usage));
        if (first !== HISTORY_PER_REPO) trimmed++;
        break;
      } catch (e) {
        if (!edgeTimeout(e)) throw e;
      }
    }
    if (got) out.push(...got);
    else notes?.push(`${r.nameWithOwner}'s commit history could not be read even on its own.`);
  }
  notes?.push(`GitHub timed out on the batched history read; repositories were read one at a time${trimmed ? `, ${trimmed} with ${HISTORY_PER_REPO_FALLBACK} commits instead of ${HISTORY_PER_REPO}` : ""}.`);
  return out;
}
async function readIdentities(logins, key, usage) {
  const out = {};
  const wanted = [...new Set(logins.map((l) => l.toLowerCase()))].filter((l) => LOGIN_RE.test(l)).slice(0, IDENTITY_MAX);
  if (!wanted.length) return out;
  const parts = wanted.map((login, i) => `u${i}: user(login: ${JSON.stringify(login)}) { login name twitterUsername company websiteUrl createdAt followers { totalCount } organizations(first: 5) { nodes { login } } }`);
  const d = await graphql(`{ ${parts.join("\n")} }`, {}, key, usage);
  for (const u of Object.values(d)) {
    if (!u?.login) continue;
    out[u.login.toLowerCase()] = {
      login: u.login,
      name: u.name ?? void 0,
      twitter: u.twitterUsername ?? void 0,
      company: u.company?.trim() || void 0,
      website: u.websiteUrl ?? void 0,
      orgs: (u.organizations?.nodes ?? []).map((o) => o.login),
      followers: u.followers?.totalCount,
      createdAt: u.createdAt
    };
  }
  return out;
}
async function readPackages(declared, usage) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { registry, name } of declared) {
    const k = `${registry}:${name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (out.length >= PACKAGES_MAX) break;
    if (registry === "npm") {
      const enc = encodeURIComponent(name).replace("%40", "@");
      const meta = await keyless(`${NPM_REGISTRY}/${enc}`, usage);
      if (!meta?.time) continue;
      const versions = Object.entries(meta.time).filter(([v]) => v !== "created" && v !== "modified").map(([version, date]) => ({ version, date })).filter((v) => Number.isFinite(Date.parse(v.date)));
      const dl = await keyless(`${NPM_DOWNLOADS}/${enc}`, usage);
      out.push({ name, registry, versions, downloadsLastMonth: typeof dl?.downloads === "number" ? dl.downloads : void 0 });
    } else if (registry === "pypi") {
      const meta = await keyless(`${PYPI_REGISTRY}/${encodeURIComponent(name)}/json`, usage);
      if (!meta?.releases) continue;
      const versions = Object.entries(meta.releases).map(([version, files]) => ({ version, date: files?.[0]?.upload_time_iso_8601 ?? "" })).filter((v) => Number.isFinite(Date.parse(v.date)));
      const dl = await keyless(`${PYPI_DOWNLOADS}/${encodeURIComponent(name)}/recent`, usage);
      out.push({ name, registry, versions, downloadsLastMonth: typeof dl?.data?.last_month === "number" ? dl.data.last_month : void 0 });
    } else {
      const meta = await keyless(`${CRATES_REGISTRY}/${encodeURIComponent(name)}`, usage);
      if (!meta?.versions) continue;
      const versions = meta.versions.map((v) => ({ version: v.num, date: v.created_at })).filter((v) => Number.isFinite(Date.parse(v.date)));
      out.push({ name, registry, versions, downloadsLastMonth: typeof meta.crate?.recent_downloads === "number" ? Math.round(meta.crate.recent_downloads / 3) : void 0 });
    }
  }
  return out;
}
async function readPeers(sector, since, key, usage, cache) {
  const ck = `ghpeers:${sector.id}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}:v1`;
  const cached = cache ? await cache.get(ck) : null;
  if (cached) return cached;
  const parts = sector.repos.map((full, i) => {
    const { owner, name } = splitRepo(full);
    return `${alias(i)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner stargazerCount defaultBranchRef { target { ... on Commit { history(first: 100, since: $since) { totalCount nodes { author { email user { login } } } } } } } }`;
  });
  const q = `query($since: GitTimestamp!) { ${parts.join("\n")} }`;
  const d = await graphql(q, { since }, key, usage);
  const rows = [];
  for (const node of Object.values(d)) {
    if (!node) continue;
    const h = node.defaultBranchRef?.target?.history;
    const authors = /* @__PURE__ */ new Set();
    for (const c of h?.nodes ?? []) {
      const k = c.author?.user?.login?.toLowerCase() || c.author?.email?.toLowerCase();
      if (k && !/\[bot\]|noreply\.github\.com$/i.test(k)) authors.add(k);
    }
    rows.push({ nameWithOwner: node.nameWithOwner, commitsInWindow: h?.totalCount ?? 0, authorsInWindow: authors.size, stars: node.stargazerCount ?? 0 });
  }
  if (rows.length && cache) await cache.set(ck, rows);
  return rows;
}
async function collectShipping(opts) {
  const { target, key, usage } = opts;
  if (opts.fetchImpl) fetchImpl = opts.fetchImpl;
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const windowDays = opts.windowDays ?? WINDOW_DAYS;
  const pointInTime = !!opts.pointInTime || opts.now != null && Date.now() - opts.now.getTime() > 36e5;
  const since = new Date(now.getTime() - windowDays * 864e5).toISOString();
  const until = pointInTime ? now.toISOString() : null;
  const readNotes = [];
  const { repos, total: reposTotal } = opts.kind === "repo" ? await readSingleRepo(target, since, until, key, usage) : await readOwnerRepos(target, since, until, key, usage, readNotes);
  const ranked = [...repos].sort((a, b) => Number(a.isFork) - Number(b.isFork) || (b.commitsInWindow ?? 0) - (a.commitsInWindow ?? 0));
  const active = ranked.filter((r) => (r.commitsInWindow ?? 0) > 0).slice(0, HISTORY_REPOS);
  const commits = await readHistory(active, since, until, key, usage, readNotes);
  let identities;
  const logins = [...new Set(commits.map((c) => c.authorLogin).filter((l) => !!l && !/\[bot\]$/i.test(l)))];
  if (logins.length) {
    try {
      identities = await readIdentities(logins, key, usage);
    } catch {
      readNotes.push("Committer accounts could not be resolved.");
    }
  }
  if (!pointInTime) {
    let pending = 0;
    for (const r of active) {
      try {
        const weekly = await readWeeklyCommits(r.nameWithOwner, key, usage);
        if (weekly) r.weeklyCommits = weekly;
        else pending++;
      } catch {
        pending++;
      }
    }
    if (pending) readNotes.push(`Yearly commit statistics were still being computed for ${pending} repositor${pending === 1 ? "y" : "ies"}; the trend uses the window's commits there.`);
  } else {
    readNotes.push("Point-in-time read: yearly commit statistics and peer baselines were not read.");
  }
  const flagship = [...repos].sort((a, b) => b.stars - a.stars)[0];
  let starHistory;
  if (flagship && flagship.stars >= STAR_HISTORY_MIN_STARS) {
    try {
      const days = await readStarHistory(flagship.nameWithOwner, key, usage);
      const cut = until ? days.filter((d) => d.date <= until.slice(0, 10)) : days;
      if (cut.length) starHistory = cut;
    } catch {
      readNotes.push("The star history could not be read; the star read is proportional.");
    }
  }
  readNotes.push("GitHub restricted stargazer lists to repository admins on 2026-06-30, so the accounts behind the stars are not readable.");
  let packages;
  const declared = repos.flatMap((r) => [
    ...r.packageName ? [{ registry: "npm", name: r.packageName }] : [],
    ...r.pypiName ? [{ registry: "pypi", name: r.pypiName }] : [],
    ...r.crateName ? [{ registry: "crates", name: r.crateName }] : []
  ]);
  if (declared.length && !pointInTime) {
    packages = await readPackages(declared, usage);
    if (!packages.length) packages = void 0;
  }
  let peers;
  if (opts.sector && !pointInTime) {
    try {
      const rows = await readPeers(opts.sector, since, key, usage, opts.peerCache);
      if (rows.length) peers = { sector: opts.sector.id, label: opts.sector.label, repos: rows };
    } catch {
      readNotes.push("The sector baseline could not be read.");
    }
  }
  return {
    target,
    kind: opts.kind === "user" ? "user" : "org",
    now: now.toISOString(),
    windowDays,
    repos,
    reposTotal,
    commits,
    ...identities ? { identities } : {},
    ...starHistory && flagship ? { starHistory, starHistoryRepo: flagship.nameWithOwner } : {},
    ...packages ? { packages } : {},
    ...peers ? { peers } : {},
    readNotes
  };
}

// src/threat/shippingPeers.ts
var PEER_SECTORS = [
  {
    id: "dex",
    label: "leading decentralized exchanges",
    keywords: /\b(dex|decentrali[sz]ed exchange|swap|amm|liquidity pool|router|aggregator|concentrated liquidity)\b/i,
    repos: ["Uniswap/v4-core", "Uniswap/interface", "aerodrome-finance/contracts"]
  },
  {
    id: "perps",
    label: "leading perpetuals and derivatives venues",
    keywords: /\b(perp(etual)?s?|derivatives?|leverage|futures|options?|margin trading)\b/i,
    repos: ["gmx-io/gmx-synthetics", "dydxprotocol/v4-chain", "velocity-exchange/protocol-v2"]
  },
  {
    id: "lending",
    label: "leading lending protocols",
    keywords: /\b(lend(ing)?|borrow(ing)?|money market|collateral|cdp|vault(s)? yield)\b/i,
    repos: ["aave-dao/aave-v3-origin", "morpho-org/morpho-blue", "compound-finance/comet"]
  },
  {
    id: "ai-agents",
    label: "leading crypto AI-agent frameworks",
    keywords: /\b(ai agents?|agentic|autonomous agents?|llm|virtuals|eliza|agent framework|ai[- ]powered)\b/i,
    repos: ["elizaOS/eliza", "coinbase/agentkit", "Virtual-Protocol/protocol-contracts"]
  },
  {
    id: "analytics",
    label: "leading crypto analytics and research tooling",
    keywords: /\b(analytics|research|intelligence|dashboard|screener|scanner|discovery|data platform|on-?chain data|builder[- ]intelligence)\b/i,
    repos: ["santiment/sanbase2", "electric-capital/open-dev-data", "DefiLlama/defillama-server"]
  },
  {
    id: "trading-tools",
    label: "leading open trading bots and exchange libraries",
    keywords: /\b(trading bot|market[- ]mak(er|ing)|sniper|copy[- ]trad(e|ing)|signals?|backtest|algo(rithmic)? trading|terminal)\b/i,
    repos: ["hummingbot/hummingbot", "freqtrade/freqtrade", "ccxt/ccxt"]
  },
  {
    id: "nft",
    label: "leading NFT infrastructure",
    keywords: /\b(nfts?|collectibles?|erc-?721|erc-?1155|marketplace|mint(ing)? pass|pfp)\b/i,
    repos: ["ProjectOpenSea/seaport", "manifoldxyz/creator-core-solidity", "immutable/ts-immutable-sdk"]
  },
  {
    id: "infra",
    label: "leading chain and rollup infrastructure",
    keywords: /\b(rollup|l2|layer[- ]?2|sequencer|node client|rpc|bridge|interop|infrastructure|chain)\b/i,
    repos: ["OffchainLabs/nitro", "ethereum-optimism/optimism", "paradigmxyz/reth"]
  },
  {
    id: "wallet",
    label: "leading self-custody wallets",
    keywords: /\b(wallets?|self[- ]custody|smart account|account abstraction|passkeys?)\b/i,
    repos: ["rainbow-me/rainbow", "MetaMask/metamask-extension", "RabbyHub/Rabby"]
  },
  {
    id: "stablecoin",
    label: "leading stablecoin and payments issuers",
    keywords: /\b(stablecoins?|payments?|remittance|usd-?pegged|fiat on-?ramp|synthetic dollar)\b/i,
    repos: ["circlefin/stablecoin-evm", "sky-ecosystem/dss", "paxosglobal/pyusd-contract"]
  },
  {
    id: "prediction",
    label: "leading prediction-market protocols",
    keywords: /\b(prediction markets?|binary options|outcome tokens?|betting|wager)\b/i,
    repos: ["Polymarket/ctf-exchange", "gnosis/conditional-tokens-contracts", "Azuro-protocol/Azuro-v2-public"]
  }
];
function detectPeerSector(text) {
  const hay = (text ?? "").slice(0, 4e3);
  if (!hay.trim()) return null;
  let best = null;
  for (const sector of PEER_SECTORS) {
    const re = new RegExp(sector.keywords.source, "gi");
    const hits = hay.match(re)?.length ?? 0;
    if (hits > 0 && (!best || hits > best.hits)) best = { sector, hits };
  }
  return best?.sector ?? null;
}

// src/threat/deployTrail.ts
var ETHERSCAN = "https://api.etherscan.io/v2/api";
var CHAINID = {
  ethereum: 1,
  bsc: 56,
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  avalanche: 43114,
  fantom: 250,
  linea: 59144,
  scroll: 534352
};
var BLOCKSCOUT = {
  robinhood: "https://robinhoodchain.blockscout.com/api",
  gnosis: "https://gnosis.blockscout.com/api"
};
var MAX_RECORDS = 50;
var isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(s);
function deployTrailReadable(chain, etherscanKey) {
  const c = chain.toLowerCase();
  return !!BLOCKSCOUT[c] || !!CHAINID[c] && !!etherscanKey;
}
async function readDeployTrail(opts) {
  const chain = opts.chain.toLowerCase();
  const wallet = opts.wallet.trim();
  if (!isAddr(wallet)) return null;
  const f = opts.fetchImpl ?? fetch;
  const params = { module: "account", action: "txlist", address: wallet, startblock: "0", endblock: "99999999", page: "1", offset: "10000", sort: "asc" };
  let url;
  if (BLOCKSCOUT[chain]) url = `${BLOCKSCOUT[chain]}?${new URLSearchParams(params)}`;
  else if (CHAINID[chain] && opts.etherscanKey) url = `${ETHERSCAN}?${new URLSearchParams({ chainid: String(CHAINID[chain]), apikey: opts.etherscanKey, ...params })}`;
  else return null;
  try {
    const r = await f(url, { headers: { accept: "application/json", "user-agent": "argus-due-diligence" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 12e3) });
    if (!r.ok) return null;
    const body = await r.json();
    const rows = Array.isArray(body.result) ? body.result : [];
    if (!rows.length && !(body.status === "0" && /no transactions found/i.test(`${body.message} ${body.result}`)) && body.status !== "1") return null;
    const seen = /* @__PURE__ */ new Map();
    for (const value of rows) {
      const tx = value ?? {};
      const to = String(tx.to ?? "");
      const created = String(tx.contractAddress ?? "");
      const from = String(tx.from ?? "").toLowerCase();
      const ts = Number(tx.timeStamp);
      if (!to && created && isAddr(created) && from === wallet.toLowerCase() && !seen.has(created.toLowerCase())) {
        seen.set(created.toLowerCase(), Number.isFinite(ts) && ts > 0 ? new Date(ts * 1e3).toISOString() : "");
      }
    }
    return [...seen.entries()].filter(([, at]) => at).map(([address, at]) => ({ address, at })).slice(-MAX_RECORDS);
  } catch {
    return null;
  }
}

// server/shippingSummary.ts
var collectShippingSummary = async (githubOrg, options) => {
  const key = env("GITHUB_TOKEN");
  if (!key) return void 0;
  const usage = { calls: 0, succeeded: 0 };
  const fetchImpl2 = options?.fetchImpl;
  const token = options?.token;
  const etherscanKey = env("ETHERSCAN_API_KEY") || void 0;
  const [input, series, trail] = await Promise.all([
    collectShipping({ target: githubOrg, kind: "org", key, usage, sector: detectPeerSector(options?.sectorText ?? null), ...fetchImpl2 ? { fetchImpl: fetchImpl2 } : {} }),
    token?.address && token.chain ? fetchOhlcv(token.address, token.chain, void 0, "day").catch(() => null) : Promise.resolve(null),
    token?.deployer && token.chain && deployTrailReadable(token.chain, etherscanKey) ? readDeployTrail({ chain: token.chain, wallet: token.deployer, etherscanKey, ...fetchImpl2 ? { fetchImpl: fetchImpl2 } : {} }) : Promise.resolve(null)
  ]);
  const priceSeries = series?.candles.length ? series.candles.map((c) => ({ date: new Date(c.ts < 1e12 ? c.ts * 1e3 : c.ts).toISOString(), close: c.close })) : void 0;
  const deploys = trail ? trail.map((d) => ({ address: d.address, date: d.at, kind: "create" })) : void 0;
  const notes = [...input.readNotes ?? []];
  if (token?.address && !priceSeries) notes.push("The token's daily price series could not be read, so the chart-versus-commits read is empty.");
  if (token?.deployer && token.chain && !deployTrailReadable(token.chain, etherscanKey)) notes.push(`No explorer is configured for ${token.chain}, so the deployer's creations were not joined.`);
  return summarizeShipping(assessShipping({ ...input, readNotes: notes, ...priceSeries ? { priceSeries } : {}, ...deploys ? { deploys } : {} }), (/* @__PURE__ */ new Date()).toISOString());
};

// server/sweep.ts
var MAX_TOKEN_CHECKS = 15;
var TOKEN_CHECK_RESERVE_MS = 2e4;
var SHIPPING_GRADES = /* @__PURE__ */ new Set(["shipping-team", "shipping-solo"]);
function creds() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
var headers = (key) => ({
  apikey: key,
  ...key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${key}` },
  "content-type": "application/json"
});
var sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 24);
async function pg(c, path, init) {
  try {
    const r = await deadlineFetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c.key), ...init?.headers }, signal: AbortSignal.timeout(1e4) });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch {
    return null;
  }
}
async function telegram(text) {
  const token = env("TELEGRAM_BOT_TOKEN");
  const chat = env("TELEGRAM_CHAT_ID");
  if (!token || !chat) return;
  try {
    await deadlineFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
      signal: AbortSignal.timeout(8e3)
    });
  } catch {
  }
}
function runSweep(organizationId, options = {}) {
  return withCostLedger(async () => {
    const result = await runSweepInLedger(organizationId, options);
    return { ...result, cost: getCost() };
  });
}
async function runSweepInLedger(organizationId, options) {
  const c = creds();
  if (!c) return { checked: 0, alerts: [], note: "no backend configured", unavailable: true };
  if (!organizationId) return { checked: 0, alerts: [], note: "organization required", unavailable: true };
  const orgFilter = `organization_id=eq.${encodeURIComponent(organizationId)}`;
  const watchRows = await pg(c, `reports?select=ref,payload&${orgFilter}&kind=eq.watch&order=ts.desc&limit=100`);
  const watches = (watchRows ?? []).map((r) => r.payload?.item).filter(Boolean);
  if (!watches.length) return { checked: 0, alerts: [], note: "watchlist empty" };
  const graphRows = await pg(c, `graph_contributions?select=handle,verdict,nodes,edges&${orgFilter}&order=updated_at.desc&limit=300`);
  const contributions = (graphRows ?? []).map((x) => ({ handle: x.handle, verdict: x.verdict ?? void 0, nodes: x.nodes ?? [], edges: x.edges ?? [] }));
  const openCaseRows = await pg(c, `cases?select=canonical_ref&${orgFilter}&status=eq.open&kind=in.(person,token,investigation)&limit=500`);
  const openCases = new Set((openCaseRows ?? []).map((row) => normalizeSubjectRef(row.canonical_ref)).filter(Boolean));
  const found = [];
  let tokenChecks2 = 0;
  let deferred = 0;
  const deadlineAt = options.deadlineAt;
  const remainingMs = () => deadlineAt == null ? Number.POSITIVE_INFINITY : deadlineAt - Date.now();
  for (const w of watches) {
    const tokenCheckWanted = w.kind === "token" && openCases.has(normalizeSubjectRef(w.id)) && tokenChecks2 < MAX_TOKEN_CHECKS;
    if (tokenCheckWanted && remainingMs() < TOKEN_CHECK_RESERVE_MS) deferred++;
    if (tokenCheckWanted && remainingMs() >= TOKEN_CHECK_RESERVE_MS) {
      tokenChecks2++;
      const input = { kind: "token", ref: w.id.includes(":") ? w.id.split(":")[1] : w.id, chain: w.chain, via: w.via ?? "evm" };
      const d = await auditToken(input, void 0, {
        skipSim: true,
        collectShipping: collectShippingSummary,
        ...deadlineAt != null ? { deadlineAt: Math.min(deadlineAt - TOKEN_CHECK_RESERVE_MS / 2, Date.now() + 6e4) } : {}
      }).catch(() => null);
      if (d && w.snapshot) {
        const s = w.snapshot;
        if (s.verdict && d.verdict !== s.verdict) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `verdict ${s.verdict} \u2192 ${d.verdict}${d.score != null ? ` (${d.score})` : ""}`, at: Date.now() });
        } else if (typeof s.score === "number" && typeof d.score === "number" && s.score - d.score >= 12) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `score dropped ${s.score} \u2192 ${d.score}`, at: Date.now() });
        }
        if (typeof s.liquidityUsd === "number" && s.liquidityUsd > 5e3 && (d.liquidityUsd ?? 0) < s.liquidityUsd * 0.5) {
          found.push({ subject: w.id, label: w.label, type: "drift", detail: `liquidity halved: $${Math.round(s.liquidityUsd).toLocaleString()} \u2192 $${Math.round(d.liquidityUsd ?? 0).toLocaleString()}`, at: Date.now() });
        }
        if (s.shipping && d.shipping) {
          const was = s.shipping;
          const now = d.shipping;
          const stalled = SHIPPING_GRADES.has(was.grade) && (now.grade === "stalled" || now.grade === "thin" || now.cadenceStatus === "dormant" || now.cadenceStatus === "quiet");
          const halved = was.totalCommits >= 10 && now.totalCommits <= was.totalCommits * 0.4;
          const lost = was.distinctHuman >= 2 && now.distinctHuman <= Math.floor(was.distinctHuman / 2);
          if (stalled || halved || lost || now.leadDeparted) {
            const parts = [
              stalled ? `grade ${was.grade} \u2192 ${now.grade}` : "",
              halved ? `commits ${was.totalCommits} \u2192 ${now.totalCommits} per quarter` : "",
              lost ? `human committers ${was.distinctHuman} \u2192 ${now.distinctHuman}` : "",
              now.leadDeparted ? "lead committer has stopped" : ""
            ].filter(Boolean);
            found.push({ subject: w.id, label: w.label, type: "stall", detail: `development stalled: ${parts.join("; ")}`, at: Date.now() });
          }
        }
        const item = {
          ...w,
          snapshot: {
            verdict: d.verdict,
            score: d.score,
            completenessState: reportCompleteness("token", d),
            liquidityUsd: d.liquidityUsd,
            mcap: d.mcap,
            ...d.shipping ? { shipping: { grade: d.shipping.grade, cadenceStatus: d.shipping.cadenceStatus, totalCommits: d.shipping.totalCommits, distinctHuman: d.shipping.distinctHuman, leadDeparted: d.shipping.leadDeparted } } : {}
          }
        };
        await pg(c, "reports?on_conflict=organization_id,ref,kind", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ organization_id: organizationId, ref: normalizeSubjectRef(w.id), kind: "watch", query: w.label, payload: { item }, ts: (/* @__PURE__ */ new Date()).toISOString() })
        });
      }
    }
    const bad = subjectConnections(w.id, contributions, 24).filter((x) => x.otherVerdict === "FAIL" || x.otherVerdict === "AVOID");
    if (bad.length) {
      const key = bad.map((b) => b.other).sort().join(",");
      found.push({ subject: w.id, label: w.label, type: "ring", detail: `connected to ${bad.map((b) => `${b.other} (${b.otherVerdict})`).join(", ")}${bad[0].ties.length ? ` via ${bad[0].ties.slice(0, 3).map((t) => t.label).join(", ")}` : ""}::${sha(key)}`, at: Date.now() });
    }
  }
  const fresh = [];
  for (const a of found) {
    const detail = a.detail.split("::")[0];
    const ref = "al:" + sha(`${a.subject}|${a.type}|${a.detail}`);
    const inserted = await pg(c, "reports?on_conflict=organization_id,ref,kind", {
      method: "POST",
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ organization_id: organizationId, ref, kind: "alert", query: a.label, payload: { subject: a.subject, label: a.label, type: a.type, detail, at: a.at }, ts: (/* @__PURE__ */ new Date()).toISOString() })
    });
    if (Array.isArray(inserted) && inserted.length > 0) fresh.push({ ...a, detail });
  }
  if (fresh.length) {
    await telegram(`ARGUS sweep: ${fresh.length} new alert${fresh.length === 1 ? "" : "s"}
` + fresh.map((a) => `\u2022 ${a.label}: ${a.detail}`).join("\n"));
  }
  return { checked: watches.length, alerts: fresh, ...deferred ? { deferred, note: `${deferred} token check${deferred === 1 ? "" : "s"} deferred: sweep time budget reached` } : {} };
}
export {
  runSweep
};
