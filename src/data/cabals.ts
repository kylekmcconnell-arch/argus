// Curated cabal registry: clusters of wallets, X accounts and launches that
// were traced together on-chain. This is the one place ARGUS keeps hand-verified
// cluster knowledge; the trust graph reads it through `in_cabal_kb`, the token
// scanner reads it through the lookup helpers below, and the notable-follower
// check reads the handles through server/adapters/notableAccounts.ts.
//
// Rules for adding a record:
// - Every wallet and launch carries a dated `evidence` string that names the
//   artifact it was read from (tx hash, explorer page, RPC log range). A cluster
//   claim without evidence is a lead, not a record, and belongs in RESEARCH.md.
// - `intent` is a judgement about the CLUSTER, not about any token. A benign
//   promo ring can push a token that later rugs; a nefarious farm can hit an
//   honest project's launch (SYNAPSE). The launch `outcome` carries the token
//   read; the cabal `intent` carries the operator read.
// - EVM addresses are lowercase; Solana base58 addresses keep their case (lookups
//   compare case-insensitively); chains use the dossier vocabulary
//   ("robinhood", "base", "solana"). Handles carry no "@".
// - Shared infrastructure (bundlers, executors) is its own cabal of kind
//   "infra" so two operators renting the same contract are not merged into one.

import type { AssociateInput } from "../engine/audit";

export type CabalKind =
  | "launch-farm"
  | "promo-ring"
  | "infra"
  | "snipe-ring"; // same-block buyers at launch with no tie to the deployer found
export type CabalIntent = "nefarious" | "benign" | "unestablished";

export type WalletRole =
  | "hub" // funds deployers and snipers, receives proceeds back
  | "deployer"
  | "sniper" // launch-block or block+1 buyer
  | "farm" // rotation / dump wallet, emptied after the launch
  | "off-ramp" // wallet that bridges or deposits proceeds
  | "fee-beneficiary"
  | "bundler-contract"
  | "executor-contract"
  | "infra-author" // EOA that deployed the shared contracts
  | "holder-bridge" // EOA that sits in the top holders of two ring tokens
  | "kol-wallet"; // wallet a caller or promoter verified for themself (FomoScan or self-doxxed), traded around their own calls

export type AccountRole = "project" | "cofounder" | "promoter" | "kol" | "member";

export type LaunchOutcome =
  | "self-sniped-and-dumped"
  | "curve-scalped"
  | "fee-farmed"
  | "honeypot" // non-whitelisted holders cannot sell; LP still in the pool
  | "liquidity-pulled" // deployer removed the LP after the honeypot filled
  | "organic"
  | "unestablished";

export interface CabalWallet {
  chain: string;
  address: string;
  role: WalletRole;
  label?: string;
  evidence: string;
}

export interface CabalAccount {
  handle: string;
  role: AccountRole;
  label?: string;
  evidence: string;
}

export interface CabalLaunch {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  launchedAt: string; // ISO date, UTC
  venue: string; // "pons-v2", "uniswap-v2 custom", "unknown factory <addr>"
  outcome: LaunchOutcome;
  note: string;
  evidence: string;
}

export interface Cabal {
  id: string;
  name: string;
  kind: CabalKind;
  intent: CabalIntent;
  summary: string;
  firstSeen: string;
  lastSeen: string;
  wallets: CabalWallet[];
  accounts: CabalAccount[];
  launches: CabalLaunch[];
  /** ids of other cabals this one rents from or overlaps with */
  related?: string[];
}

const RH = "robinhood";
const SOL = "solana";

export const CABALS: Cabal[] = [
  {
    id: "rh-snipe-infra",
    name: "Robinhood Chain snipe infrastructure",
    kind: "infra",
    intent: "nefarious",
    summary:
      "Buy bundlers and a sell executor written by one EOA and rented across several launch farms. Presence of these contracts in a launch window means a professional sniping service touched the launch, whoever the deployer was.",
    firstSeen: "2026-09-07",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0xca33026341691f48a3067e22febcbd54f0cb5de2", role: "infra-author", label: "author of bundlers and executor", evidence: "Blockscout creator of 0x1e43ce00, 0x14b9a544, 0xb06983db; 6,131 txs by 2026-09-13, mostly GasliteDrop airdropETH; self-funded via GasliteDrop 2026-09-11" },
      { chain: RH, address: "0x1e43ce0055b35373cb108e67586fd3b19ee32618", role: "bundler-contract", label: "buy bundler (method 0x960900de)", evidence: "LEBRON block+1 buy 2026-09-12 tx 0x21bb0c30…; 50+ distinct EOA callers since 2026-09-07 on AAPL/RBLX/PLTR-paired Pons launches" },
      { chain: RH, address: "0x14b9a544e8c179fc2040d3089dcc73baf25aa8f9", role: "bundler-contract", label: "buy bundler (method 0x6f49227e)", evidence: "SYNAPSE block+1 buy 2026-09-14 03:38:12; 4,227 txs; token transfers on NFLX, NVDA, QQQ, SPY, MSFT, CBBTC launches" },
      { chain: RH, address: "0xb06983db4fad9cd94efbf9088c364ebcacde1214", role: "executor-contract", label: "sell executor (method 0xd816eb0b)", evidence: "LEBRON sells 2026-09-12 blocks +25..+46 via 55 relayer EOAs; SYNAPSE rotation 2026-09-14 blocks +26..+77; PRISM sells 2026-09-02" },
      { chain: RH, address: "0xe68d0bbc023de3febda04f413db23ce9c5ea1934", role: "bundler-contract", label: "GasliteDrop (airdropETH) - neutral tool, the funding primitive every farm uses", evidence: "verified GasliteDrop; sender of an airdropETH batch that funds a deployer is the operator hub" },
    ],
    accounts: [],
    launches: [],
  },
  {
    id: "rh-farm-lebron",
    name: "LEBRON self-snipe farm (Base to Binance exit)",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "One hub funded the deployer and the sniper in a single GasliteDrop batch. The sniper bought 88.5% of supply and dumped in 5 seconds into the Pons 100% anti-snipe tax; the deployer claimed the confiscated proceeds as creator tax 11 minutes later and bridged them to Base and into Binance.",
    firstSeen: "2026-09-12",
    lastSeen: "2026-09-12",
    wallets: [
      { chain: RH, address: "0xccfb5e8f8db1b50ffa37ab9527d25f78e3e10ae7", role: "hub", evidence: "GasliteDrop airdropETH tx 0x21ea633f… at 2026-09-12 17:30:24 UTC: 30.11 ETH to 18 wallets (29.72 sniper, 0.045 deployer, 0.0245 x16 burners); swept burners back 18:47" },
      { chain: RH, address: "0xe0bcad36fd0c2f0af1796f18aa291e232102d46c", role: "off-ramp", evidence: "received 124,048 USDG from the deployer 2026-09-12, swapped to ~49 ETH on UniversalRouter 19:19-19:20, 16 Relay deposits to Base recipients that swept into Binance 73 / Binance Dep; 119 ETH out that day" },
      { chain: RH, address: "0x169cb3caed0fe9327cc4419a1646d1edf5999f14", role: "deployer", evidence: "creation tx 0x8eb502eb… 18:31:46; claimed 127,763 USDG from PonsV2FeeEscrow at block +6580; burned nothing, sold 1% dev bag at +5 min" },
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
      { chain: "base", address: "0x3304e22ddaa22bcdc5fca2269b418046ae7b566a", role: "off-ramp", label: "Binance 73 hot wallet (destination, not operator)", evidence: "Basescan name tag; all 16 Relay recipients forwarded here or to Binance Dep 0x487cab40…" },
    ],
    accounts: [],
    launches: [
      { chain: RH, address: "0xd553996e73a50501a940ea771b328998a7ac2478", symbol: "LEBRON", name: "King James", launchedAt: "2026-09-12T18:31:46Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "88.5% of supply bought by the operator at launch and dumped in 5 s; hook tax recycled to the deployer as creator tax; liquidity left at ~$5k", evidence: "RPC transfer logs blocks 61319910..61347834; PonsV2FeeEscrow claim to deployer; Relay API request ids on 16 deposits" },
    ],
    related: ["rh-snipe-infra"],
  },
  {
    id: "rh-farm-prism",
    name: "PRISM fee farm (Solana exit)",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "Deployer and a block-2 buyer funded from one hub; the buyer scalped the curve and the deployer harvested creator fees 82 times in 11 days, routing them out through Relay to Solana. The product front end (Prism Finance) is real; the token's fee stream is the extraction.",
    firstSeen: "2026-09-02",
    lastSeen: "2026-09-13",
    wallets: [
      { chain: RH, address: "0x45f4a022dd3758bdf8421e3293fc04f7f775fd2f", role: "hub", evidence: "GasliteDrop batches funding deployer 0xfa2e1109 (2026-09-05 0.787 ETH) and sniper 0xeaad34d9 (2026-09-05, 09-06); 53 txs; refilled by deployer, 0x252e7031, 0x9787ce57 and the Relay solver" },
      { chain: RH, address: "0xfa2e1109b1eba2ab27f1f6497a32daf42ce52bcc", role: "deployer", evidence: "launchAndBuy 2026-09-02 16:52:52; 82 PonsV2FeeEscrow claims (~24 ETH) by 2026-09-12; 15 ETH swapped to USDG, 6.4 ETH to 0x9787ce57; holds 37,404 USDG" },
      { chain: RH, address: "0xeaad34d90867b8e6d7694656520d9631eaf3abc8", role: "sniper", evidence: "bought 22% at block +2, sold back into the curve within 8 s partly via executor 0xb06983db; 211 txs bot wallet (Tiptoe trades)" },
      { chain: RH, address: "0x9787ce5701f98f83a669642de5b5df42a6d50085", role: "off-ramp", evidence: "6 RelayDepository deposits 2026-09-02..09-12 resolving to Solana recipients ED5P2EzE…, CbJer8UY…, V1SXh1c5…, 4rp49ATu…; holds 15,283 USDG + 11.8 ETH" },
      { chain: RH, address: "0xdd84ed843bb62d1e3f070e7f026ea26cae2dbfa6", role: "fee-beneficiary", evidence: "sole recipient of the deployer's 82 post-claim GasliteDrop forwards (dust amounts); forwards on via GasliteDrop" },
      { chain: RH, address: "0x252e7031", role: "farm", label: "prefix only - full address unresolved", evidence: "22 txs since 2026-09-02, sends to the hub and to 0x9787ce57; approves PRISM" },
    ],
    accounts: [
      { handle: "TradeOnPrism", role: "project", label: "Prism Finance (prismfinance.net)", evidence: "bio carries the PRISM CA; Space with @0xmonco 2026-09-12; the fee recipient is the farm deployer, not the product" },
    ],
    launches: [
      { chain: RH, address: "0x71d389c48e29996bd8e20778f87fb915c1ffdcc2", symbol: "PRISM", name: "Prism Finance", launchedAt: "2026-09-02T16:52:52Z", venue: "pons-v2", outcome: "fee-farmed", note: "no team wallet held or sold after launch day; extraction is the creator-fee stream, decaying with volume", evidence: "RPC transfer logs 2026-09-02..09-13 (55,230 transfers); Blockscout claim history; Relay API on off-ramp deposits" },
    ],
    related: ["rh-snipe-infra"],
  },
  {
    id: "rh-farm-synapse-hub",
    name: "Curve-scalping farm behind the SYNAPSE launch",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "A hub that has run 36 GasliteDrop batches since July 25 and one a day since September 7. It funds a deployer and a sniper together, the sniper takes 20% at block +1, the bag is rotated through ten fresh wallets during the curve phase and sold back before graduation, so the Pons anti-snipe tax never applies. Proceeds recycle into the hub; no bridge exit found yet.",
    firstSeen: "2026-07-25",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0xafb1d47ce1af439c5833bb4f6eb4978722df2fca", role: "hub", evidence: "airdropETH tx 0x12c3b8b7… 2026-09-14 02:49:36: 0.495 ETH sniper, 0.054 deployer; 36 batches since 2026-07-25; refilled by one-off EOAs 0xdb7de2bb, 0xcb9941ed, 0x5f5bd211, 0x9588b414 and the Relay solver" },
      { chain: RH, address: "0x7253f5e07eec688535832fe3197ac683865a2844", role: "deployer", evidence: "launchAndBuy 2026-09-14 03:38:11 (tx 0xd69ddae9…); burned the 1% allocation at 04:25; creator-fee recipient per creation tx, unclaimed at last check" },
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
      { chain: RH, address: "0x509abc1b6fd5df9a848ec07b96e73c047da701a8", role: "farm", evidence: "1.01% rotated; curve ETH not visible on the sampled explorer page" },
    ],
    accounts: [
      { handle: "synepsepad", role: "project", label: "Synapse (usesynapse.ink), AI-model launchpad on Pons", evidence: "pinned post claims the CA; its docs name treasury 0x8940fde8… as fee recipient, but the creation tx names the farm deployer" },
    ],
    launches: [
      { chain: RH, address: "0xe96184c99b3a3b89c907ea0753c5fde9e3c572ab", symbol: "SYNAPSE", name: "Synapse Protocol", launchedAt: "2026-09-14T03:38:11Z", venue: "pons-v2", outcome: "curve-scalped", note: "20% taken at block +1 and returned to the curve within 32 s for +0.38 ETH; post-graduation market was organic (1,311 distinct buyers in 70 min)", evidence: "RPC transfer logs blocks 62494534..62554552 (42,200 transfers); Blockscout internal txs on farm wallets" },
    ],
    related: ["rh-snipe-infra"],
  },
  {
    id: "rh-honeypot-factory-8fc191",
    name: "Serial honeypot factory 0x8fc191da",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "One EOA deploys a custom ERC-20 straight to a Uniswap v2 WETH pool roughly once a day, keeps 100% of the LP tokens, lets only its own wallet sell, waits for buys, then calls removeLiquidityETHSupportingFeeOnTransferTokens minutes before deploying the next one and bridges the ETH out through LiFi/Across. Five tokens in four days.",
    firstSeen: "2026-09-11",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0x8fc191daa5ac8eb3b30066ffa554d999fe35885e", role: "deployer", label: "deployer and sole LP holder", evidence: "created JUGGERNAUT 09-11, EMBERCAT 09-12, STONKINU 09-13, ZZZCAT 09-13, DOGEGPT 09-14 (direct EOA deploys, unverified, custom actionPair() call after each); removeLiquidity 09-12 10:48, 09-13 01:30, 09-13 12:01, 09-14 01:26; LiFi swapAndStartBridgeTokensViaAcrossV4 09-12 (0.3 ETH), 09-13 (1.0 ETH); holds 316227766016836933 of 316227766016837933 DOGEGPT LP units" },
      { chain: RH, address: "0x10d28597e09fec92eae3715b25967bd3d07ae335", role: "farm", label: "whitelisted seller (hardcoded in DOGEGPT bytecode)", evidence: "top EOA holder of DOGEGPT (8.2% of supply) funded by the deployer; address is a PUSH20 constant in the token bytecode; eth_call transfer to the pair succeeds from this wallet and reverts from every other holder tested 2026-09-14" },
      { chain: RH, address: "0x8993033c6558be8fde430a2674744ec5ecba8a12", role: "farm", label: "helper address hardcoded in DOGEGPT bytecode", evidence: "PUSH20 constant in the token bytecode; the deployer sent it 2 transactions; calls to execute/multicall/claim/actionPair from it revert on 2026-09-14" },
      { chain: RH, address: "0xdf058ad7f6eeb608d7f668797e87f74278376f0c", role: "farm", label: "helper address hardcoded in DOGEGPT bytecode", evidence: "PUSH20 constant in the token bytecode; the deployer sent it 1 transaction; calls to execute/multicall/claim/actionPair from it revert on 2026-09-14" },
    ],
    accounts: [],
    launches: [
      { chain: RH, address: "0x26becab467bf74a3e09c095c30427acbd6544608", symbol: "DOGEGPT", name: "DOGEGPT", launchedAt: "2026-09-14T01:29:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "honeypot", note: "101 buys and 0 sells in the first 6 h; non-whitelisted transfers to the pair revert; deployer holds all LP; 89 holders, ~$79k liquidity at read time. Bytecode read (3,339 bytes, unverified, decimals 8): standard ERC-20 selectors plus actionPair(address) [deployer-only, sets the pair], execute(address[],uint256), multicall(address[],uint256), claim(address[],uint256) [all revert from every caller tried, owner is zero], and transfer(address,address,uint256) [returns success for any caller and any amount, a silent no-op]; transferFrom enforces allowance; one CALL, no DELEGATECALL, no SELFDESTRUCT, no ETH held; hardcoded addresses are the deployer, the whitelisted seller, two helper EOAs and the canonical Uniswap V2 factory 0x6b75d8af…9a80 (pair derived with CREATE2). Sell path is a recipient check against the pair: transfer to the pair reverts unless the sender is the whitelisted wallet; transfers to plain addresses succeed. No function can reach a holder's ETH or other tokens", evidence: "eth_getCode disassembly and openchain selector lookup 2026-09-14; eth_call simulations from 3 holders, the deployer, the whitelisted wallet, both helper addresses and a random EOA; pair LP balanceOf; DexScreener txns; Blockscout deployer tx list" },
      { chain: RH, address: "0xaf72f6237674830778082a4566167b4ba4f1e04b", symbol: "ZZZCAT", name: "ZZZCAT", launchedAt: "2026-09-13T12:07:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "48 buys, 1 sell, liquidity 0 and price -100% after removeLiquidity 09-14 01:26", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0xdc1a9f464dcb4a1dfdae34253939fdb509b081bf", symbol: "STONKINU", name: "STONKINU", launchedAt: "2026-09-13T01:36:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "liquidity $8 after removeLiquidity 09-13 12:01", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0x038f31900fcde52884456a47bbd2bb308bda8064", symbol: "EMBERCAT", name: "EMBERCAT", launchedAt: "2026-09-12T11:08:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "liquidity $2 after removeLiquidity 09-13 01:30", evidence: "DexScreener 2026-09-14; deployer removeLiquidity tx timeline" },
      { chain: RH, address: "0x3adde168a09132b95f25f52119a440b2bf9b32d0", symbol: "JUGGERNAUT", name: "JUGGERNAUT", launchedAt: "2026-09-11T16:03:00Z", venue: "direct EOA deploy, uniswap-v2 WETH", outcome: "liquidity-pulled", note: "no pair left on DexScreener after removeLiquidity 09-12 10:48", evidence: "deployer removeLiquidity tx timeline 2026-09-14" },
    ],
  },
  {
    id: "rh-snipe-ring-0xb33eb167",
    name: "0xb33eb167 block+24 snipe ring",
    kind: "snipe-ring",
    intent: "unestablished",
    summary:
      "Seven wallets bought 15.4% of the token 0xb33eb167 in the same block 2.4 seconds after launch through the Pons app proxy, in seven separate transactions. Six dumped after graduation. All seven are funded by prior Pons trading through the same proxy rather than by a GasliteDrop batch, and none of the rented snipe contracts appear, so this reads as independent bots racing the launch, not the deployer's own cluster. Kept as a ring because same-block entry with shared funding rails is coordination even without an operator. The brand behind the launch is recycled: the same X account and name sold an Ethereum token in 2022-2023 that went dark in 2024, and the 2026 site never mentions it.",
    firstSeen: "2022-11-01", // the Ethereum predecessor; the Robinhood Chain ring itself is 2026-09-09
    lastSeen: "2026-09-15",
    wallets: [
      { chain: RH, address: "0x709b3fa0f8c85cff157fb92b045ae02321b0483b", role: "sniper", evidence: "1.94% at block +24 tx 0x64f3f890…; sold 1.94% into the pool after graduation" },
      { chain: RH, address: "0x4a00bd844a0420ef7e6ef66392c2b47e8106aabd", role: "sniper", evidence: "1.82% at block +24 tx 0x215c211a…; sold all; ETH inflows from TransparentUpgradeableProxy (Pons app) 2026-09-09 17:19-17:21" },
      { chain: RH, address: "0x04730fea4731717db4879ad16e897f9fe7a6cc7d", role: "sniper", evidence: "1.72% at block +24 tx 0xbebfeded…; sold all; funded through the Pons proxy 2026-09-09 17:19-17:21" },
      { chain: RH, address: "0xb2dc08af65272ef5b53c04887dbab360d6249865", role: "sniper", evidence: "2.27% at block +24 tx 0x3de8a8cf…; sold 1.70%" },
      { chain: RH, address: "0xce90934a71b57e2a280a129dc36f2eb9c0d1d5c8", role: "sniper", evidence: "2.23% at block +24 tx 0x7e803a21…; sold 1.12%" },
      { chain: RH, address: "0xf8a0c331f3dc4fb7693f49a9586ec88f2cdaea43", role: "sniper", label: "still holding", evidence: "3.22% at block +24 tx 0x05633da3…; holds 1.35% on 2026-09-14; active Pons trader since 2026-07-28" },
      { chain: RH, address: "0x0e28d6a22f48ad65b2aae44b9be8c5016377ef8d", role: "sniper", evidence: "2.17% at block +24 tx 0x6552e137…; sold 1.09%; passed 1.09% to 0xf8a0c331 at 17:39" },
      { chain: RH, address: "0xb9f98bf3bcf48b538b682ab16262a81fb19f9690", role: "farm", label: "ring side wallet", evidence: "received 1.61% from ring wallet 0xf8a0c331 at 17:36 on launch day, sold 1.40%" },
      { chain: RH, address: "0x1206d27741c771e573a915848f9c2c2bb4c2d3dc", role: "farm", label: "ring side wallet", evidence: "received 1.12% from ring wallet 0xce90934a at 17:38 on launch day, sold 1.12%" },
      { chain: RH, address: "0x7a8cf45f286d9dfb32156a6a20f45503e958f062", role: "farm", label: "ring side wallet", evidence: "received 1.35% from ring wallet 0xf8a0c331 at 17:41 on launch day, sold 1.35%" },
      { chain: RH, address: "0xfdfbcae9ed23dc88757a48b2c0cc3910e6c1afa6", role: "deployer", label: "token deployer, net buyer", evidence: "launchAndBuy 2026-09-09 17:35:06 took 2.53% (1% allocation + buy); moved that 2.53% to 0xd0f7d8c6… at 18:06 (still held there); bought a further ~2.8% from the pool 09-09..09-12; zero sells through 2026-09-14" },
      { chain: RH, address: "0xd0f7d8c6e9f6d80c297bebe4f7fd1b9c8125c32f", role: "deployer", label: "deployer allocation holder", evidence: "received the deployer's 2.53% launch allocation 2026-09-09 18:06; no outflows through 2026-09-14" },
    ],
    accounts: [
    ],
    launches: [
      { chain: "ethereum", address: "0xe61f6e39711cec14f8d6c637c2f4568baa9ff7ee", symbol: "withheld", name: "2022 Ethereum predecessor of the same brand (name withheld)", launchedAt: "2022-11-01T00:00:00Z", venue: "uniswap-v2 with a Unicrypt LP lock", outcome: "unestablished", note: "The earlier token behind the same brand and X account, described on its explorer page as a research platform for pro traders and institutions; 100M supply, MIT-licensed OpenZeppelin ERC-20 verified 2022-11-01. Roadmap promised V2 by end of Q1 2023 and a paid-research MVP (Medium, early 2023); the LP lock was extended in Jan 2023; the site went offline in Aug 2024 and the token reads $0.00 with 520 holders on 2026-09-15. Not a rug read (LP was locked and no pull was found); an abandoned project whose brand was relaunched on Robinhood Chain in Sept 2026 without disclosure", evidence: "Etherscan token page 0xE61F6e39711cEc14f8D6c637c2f4568bAA9FF7Ee read 2026-09-15 (name and symbol withheld, 520 holders, links); verified source header naming the project's site, Telegram and X account (withheld); the project's GitHub smart-contract repo, two commits 2022-12-02 by its dev account; X post 1613594707824869376 (2023-01-12); the project's Medium MVP update" },
      { chain: RH, address: "0xb33eb16782776b4d738c0fd643577cb0284db610", symbol: "withheld", name: "Robinhood Chain builder-discovery token (name withheld)", launchedAt: "2026-09-09T17:35:06Z", venue: "pons-v2", outcome: "organic", note: "Pons V2, graduated in 7 min; 15.4% taken by seven same-block wallets at +24 and mostly dumped post-graduation; deployer 0xfdfbcae9… bought 1.53% with the launch, holds ~1.2%, used a RobinhoodLocker lock and one Relay deposit, no fee-escrow claims on its first page; 527 distinct pool buyers and 242% turnover in the first 3.4 h; ~$144k cap, ~$35k liquidity on 2026-09-14. Ongoing-selling read over 4.6 days (456% cumulative turnover): the ring and its three side wallets sold 13.8% of supply, 12.3 points of it on launch day and 0.2% in the last 24 h; the deployer never sold and is a net buyer; last 24 h was 44% sold vs 47% bought across 95 sellers, none launch-connected", evidence: "creation tx 0x53baa96a…; RPC transfer logs blocks 58729102..58849101 (launch) and 58729102..latest on 2026-09-14 (15,381 transfers); Blockscout internal txs on the ring wallets; DexScreener 2026-09-14" },
    ],
  },
  {
    id: "altcoinist-ring",
    name: "Altcoinist / Tibbir promo ring",
    kind: "promo-ring",
    intent: "benign",
    summary:
      "A social trading collective around @Altcoinist ($ALTT) and its co-founder that finds and pushes Robinhood Chain memecoins early: $TIBBIR, $PONS, $CASHCAT, $LFI, then $FIH and $WRESTLER. Coordinated attention, not coordinated launches: the tokens they back have different deployers and factories, and the two top-holder wallets shared by FIH and WRESTLER are the only on-chain bridge found so far.",
    firstSeen: "2026-08-22",
    lastSeen: "2026-09-14",
    wallets: [
      { chain: RH, address: "0x2344eee2d839a83412760a0ba43e6324c34a7c5f", role: "holder-bridge", label: "manual trader holding both ring tokens", evidence: "top-50 holder of both FIH (1.68%) and WRESTLER (1.53%) on 2026-09-14; EOA holding 10.9 ETH, 500+ txs, trades through KyberSwap MetaAggregationRouterV2 and the 0x AllowanceHolder; held WRESTLER since launch day 2026-09-03; sold 1.53% of WRESTLER in 40 pieces on 2026-09-14/15 (0.86% inside the 13:30 UTC drop) and 1.10% of FIH at 10:42 UTC on 2026-09-15; no transfers or shared funders with the WRESTLER arbitrage bots" },
      { chain: RH, address: "0x2977b96b4235330075165ca5e3b0ef563745c354", role: "sniper", label: "launch-scalping bot wallet (also the FIH/WRESTLER holder bridge)", evidence: "top-50 holder of both FIH and WRESTLER on 2026-09-14; EOA with 6,945 txs and 0.009 ETH on 2026-09-15, approving a stream of PonsV2LauncherToken / PonsLauncherToken / LaunchToken contracts and trading through the unverified router 0xeF161b8b… (25 of its last 50 txs), the same router that flows curve-phase buys on PRISM and 0xb33eb167; ETH funded by that router, 0x0630dfBd… and the Pons proxy; sold 0.10% of WRESTLER on 2026-09-14/15. No transfers or shared funders with the WRESTLER arbitrage bots 0xed4728d8…, 0x636d3380…, 0x6da432f6…" },
      { chain: RH, address: "0xbbfd5b62d83554c57674b27aee5b8a5228ded5a5", role: "deployer", label: "FIH creator (via launch factory 0xd9ec2db5…)", evidence: "creation tx 0xec3a15b6… 2026-07-01 20:44:19 paid 0.0005 ETH to the factory; bought 2.00% at block +2052 (~3.5 min) and holds 0.00% on 2026-09-14; 929 txs, 32.5 ETH" },
      { chain: RH, address: "0x059ae3cd996c5a0db82783224cb19ae5dc598c5e", role: "deployer", label: "WRESTLER creator (via the o1 Launchpad factory 0xce9c48cf…)", evidence: "creation tx 0xeaf4478a… 2026-09-03 03:24:21 paid 0.001 ETH to the launcher; holds 0.43% on 2026-09-14; 114 txs, 0.09 ETH" },
      { chain: SOL, address: "DVFYHVKFYLxws4bV97va6EceVRrKjddHSWYq3is4ad49", role: "kol-wallet", label: "@Altcoinist FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account Altcoinist (read 2026-09-17; FOMO holds no X link, binding rests on the name and the $TIBBIR bio). FOMO cash flow all-time net -$7.6k on $180k volume, 125 trades. He posted 8 FOMO theses on FIH and WRESTLER 2026-09-07 to 09-17." },
      { chain: RH, address: "0xccdeb7744e778992bfbff798f239638b76448e75", role: "kol-wallet", label: "@Altcoinist FOMO-verified EVM wallet", evidence: "FomoScan record for FOMO account Altcoinist (read 2026-09-17). Not yet traced against FIH, WRESTLER, TIBBIR, PONS or CASHCAT flows." },
      { chain: SOL, address: "4CH1wgHqyirN8KR3o9L8oYNpDtRmDccCtiRJjnjLtnYp", role: "kol-wallet", label: "@lowcap_hunter FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account lowcap_hunter, X link https://x.com/lowcap_hunter (read 2026-09-17). FOMO cash flow all-time net -$32.7k on $1.41M volume, 4,312 trades." },
      { chain: RH, address: "0x517b826b1902f9d44edaa2259afaa7e6e4b23b3b", role: "kol-wallet", label: "@lowcap_hunter FOMO-verified EVM wallet", evidence: "FomoScan record for FOMO account lowcap_hunter (read 2026-09-17). Not yet traced against ring token flows." },
    ],
    accounts: [
      { handle: "Altcoinist", role: "promoter", label: "Altcoinist · $ALTT · 103k followers", evidence: "pinned 2026-08-22: 'Be Early. $TIBBIR 1339x $PONS 838x $CASHCAT 314x $LFI 77x'; $FIH calls 08-25..09-07 ('100% organic OG coin'); $WRESTLER calls 09-07 and 09-13 (Novogratz / GLXY narrative)" },
      { handle: "KonstantinSebeo", role: "cofounder", label: "ALT BRAH · co-founder Altcoinist", evidence: "bio: Co-founder @Altcoinist | $ALTT | @alphabaseindex; credited by ring members as the one who 'called $WRESTLER'" },
      { handle: "theunipcs", role: "kol", label: "Unipcs (Bonk Guy) · 315k followers", evidence: "Altcoinist replies recommending $FIH to him 2026-09-02 and 09-07; ring members reply to him with $TIBBIR $WALLET $WRESTLER" },
      { handle: "0x7_anderson", role: "member", label: "Anderson · Base / Virtuals", evidence: "2026-09-06 post: 'Altbrah called $WRESTLER … attention proxy for $GLXY'; appeared in Vlad Tenev's who-to-follow 2026-09-10" },
      { handle: "wrestler_galaxy", role: "project", label: "$WRESTLER project account", evidence: "bio carries the CA and 'paired with tokenized GLXY'; posts fee buyback-and-burn tallies" },
      { handle: "FIHonRH", role: "project", label: "Fih In Hood (the small 0xd51c58f1 token, not the $1.4M FIH)", evidence: "bio CA 0xd51c58f1…; joined 2026-07; the main FIH's DexScreener social is Vlad Tenev's 2024 frog post" },
      { handle: "lowcap_hunter", role: "member", evidence: "2026-09-10: 'top holders are $TIBBIR whales who caught it sub 1M'" },
      { handle: "DjGriffith", role: "member", evidence: "in Altcoinist's $FIH reply threads 08-30 and 09-02; in Vlad Tenev's who-to-follow 2026-09-10" },
    ],
    launches: [
      { chain: RH, address: "0x4b3a3ff4ec9d289727e24a8152f406bada44264d", symbol: "FIH", name: "Frog In Hood", launchedAt: "2026-07-01T20:44:19Z", venue: "launch factory 0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb (unverified, 93k txs) with verified LaunchLocker 0x7f03effbd7ceb22a3f80dd468f67ef27826acd85, both by 0x7e035fb0…; full supply to a Uniswap v3 WETH pool", outcome: "organic", note: "100% of supply seeded into the v3 pool in the creation tx; position NFT 1169 moved factory -> LaunchLocker in the same tx and is still owned by the locker; first buy at block +38 (4 s, 0.43%), no block with 3+ buyers, 72 distinct buyers in the first hour, largest early buy 0.44%; deployer bought 2% at +3.5 min and has since sold it; 13.17% of supply burned; ~$1.4M cap, 1,439 holders on 2026-09-14", evidence: "creation tx 0xec3a15b6… receipt (ERC-721 transfers on Uniswap V3 Positions NFT-V1 0x73991a25…); NFPM ownerOf(1169) 2026-09-14; RPC transfer logs blocks 870291..910290" },
      { chain: RH, address: "0xab528169dcc80d68837a33b1e2b866bb7d7ee301", symbol: "WRESTLER", name: "Wrestler", launchedAt: "2026-09-03T03:24:21Z", venue: "o1 (o1 Launchpad Launch Factory 0xce9c48cfa068947f77738c81be406b53338e5b0d, which Blockscout verifies under the source name RWAERC20LaunchpadFactory, deployed by o1's 0xaa8d6f5a…; the o1 Launch Hook 0x0310cfebe1d7a69f2414f6595bbe9d17c5342acc is the supply custodian; full supply straight into a Uniswap v4 pool quoted in tokenized GLXY, no bonding curve; not Pons; identified as o1 from docs.o1.exchange production contracts 2026-09-16)", outcome: "organic", note: "100% of supply moved into the v4 PoolManager in the creation tx; first buy at block +183 (18 s); 5 distinct buyers and 10 buys in the first hour, largest 3.78% (sold back at +390); no block with 3+ buyers; pool still held 94% after an hour. Volume arrived days later with the Altcoinist calls (Sep 7 onward, $5M+/day by Sep 13); 2.55% of supply burned, consistent with the stated fee buyback-and-burn; deployer holds 0.43%; ~$0.9M cap, 1,821 holders on 2026-09-14", evidence: "creation tx 0xeaf4478a… receipt; RPC transfer logs blocks 53098347..53138346; DexScreener pair history; balanceOf(dead) 2026-09-14" },
      { chain: RH, address: "0xa944c6aee0aba6cc7345287f37c7daa8075c8dcb", symbol: "TIBBIR", name: "Ribbita by Virtuals (Robinhood bridge)", launchedAt: "2026-07-11T00:00:00Z", venue: "bridged Virtuals token (origin Solana/Base)", outcome: "unestablished", note: "$180M+ cap on Robinhood, $270M on Solana; the ring's anchor position", evidence: "DexScreener 2026-09-14; Blockscout creator 0xf2dc25b8…" },
      { chain: RH, address: "0x39dbed3a2bd333467115de45665cc57f813c4571", symbol: "PONS", name: "Pons", launchedAt: "2026-07-01T00:00:00Z", venue: "pons", outcome: "unestablished", note: "launchpad token the ring calls; shares 4 top-50 holders with CASHCAT", evidence: "Altcoinist pinned 2026-08-22; holder overlap read 2026-09-14" },
      { chain: RH, address: "0x020bfc650a365f8bb26819deaabf3e21291018b4", symbol: "CASHCAT", name: "Cash Cat", launchedAt: "2026-06-01T00:00:00Z", venue: "pons", outcome: "unestablished", note: "followed by Vlad Tenev 2026-09; shares 4 top-50 holders with PONS", evidence: "Altcoinist pinned 2026-08-22; holder overlap read 2026-09-14" },
    ],
  },
  {
    id: "sol-park-pumpswap-pool-factory",
    name: "STONKS PARK / PumpSwap drained-pool factory",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "The pump.fun creator of $PARK (STONKS PARK) is the coin-creator fee sink of a same-day PumpSwap pool factory: ten throwaway wallets opened pools with 191 to 451 SOL each, ran bot volume for 2 to 26 minutes, then drained every pool to zero, while $PARK itself was bought 44.65% in its first 20 slots by an eight-wallet fresh-funded bundle plus sniper bots. The project X account is a 2024 memecoin handle renamed 13 times.",
    firstSeen: "2026-09-14",
    lastSeen: "2026-09-16",
    wallets: [
      { chain: SOL, address: "CBbRS6xr6KSjYzPgH7pQnVvy42GXbhWk1Z2WMejJa99X", role: "deployer", label: "PARK creator and coin-creator fee sink of the pool factory", evidence: "funded 1.379 SOL from the MEXC hot wallet ASTyfSima4… on 2026-09-14 22:57 UTC (tx TtUrWiPm8h…); created PARK 2026-09-15 14:41:13 UTC with a 0.809 SOL dev buy (tx 5nXuSTbwmC…), holds 27.53M PARK (2.87%) on 2026-09-16 with no creator-fee claim; named as coin_creator (create_pool account 21) in ten PumpSwap pools created 2026-09-15 14:50 to 21:32 UTC and referenced by swaps on ten more pools on 2026-09-16" },
      { chain: SOL, address: "HCEtGKAaKTqH5AhgNwuH8Enf9C6qpCEH9T7ctX5sfMtc", role: "deployer", label: "PumpSwap pool creator for Aigob", evidence: "created the pool for 5NK9STFaivRDScQnF5VwE7zwdEfFpKRd3BwhPPYuBAGS at 2026-09-15T14:50:40Z depositing 191.7 SOL (tx 3Ycuq1veGFj4…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "HU2MFdEZzxU68t1qEbPtJARH9ku9YHBfiRtkCQjG2ZqY", role: "deployer", label: "PumpSwap pool creator for XIDRAG", evidence: "created the pool for BfRMi3osCEn76huxCMiPqvyfWz9YwzfzdViMa83Bmoon at 2026-09-15T14:53:14Z depositing 441.1 SOL (tx 3dGcn1LNXJTX…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "Gf7adCBCyUt3EfFP7xtxMzSLShXjBZ44Zk2dBjfd1SgN", role: "deployer", label: "PumpSwap pool creator for ROBAI", evidence: "created the pool for AbEtvmjR9afBvjVY4hxzqLxN3xmFoCwAEXCofVgmoon at 2026-09-15T15:06:22Z depositing 372.4 SOL (tx 3Kiv9FrLmSKe…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "DDe2JJPAmEMZoacK8beY71BYsMz7fWos5pWfLHoKj3Pk", role: "deployer", label: "PumpSwap pool creator for MLBWC", evidence: "created the pool for CeHRqHs1adSwco4nGfRnC47ME8EdUVMhCce5HVABBAGS at 2026-09-15T15:09:35Z depositing 351.3 SOL (tx fpZqpBi3GtpZ…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "9Nin9rBdPtC5YtzAyan8XxkskrG5D6ZzG8kApCYUpJAC", role: "deployer", label: "PumpSwap pool creator for Tayrock", evidence: "created the pool for DtA6FUsUY4nK9HLYr8L3sZRNQUPKZfLxhtMB9qvJpump at 2026-09-15T15:51:30Z depositing 335.1 SOL (tx H7hw4KeCkUQC…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "9FNHre7R3Sm5DQHA3r7Fux9ABUL21UwmTmse5x7hUhE1", role: "deployer", label: "PumpSwap pool creator for DRONKRA", evidence: "created the pool for Ap8gWjgA9YdJQpMTeyAEqn6YP7rP3UC82GDvYWYipump at 2026-09-15T16:04:51Z depositing 421.2 SOL (tx HHM3MeUbvnk3…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "4nTdq49rcf9WUZDnmYNpdBnzmom4htc7srfQiT2bRXzN", role: "deployer", label: "PumpSwap pool creator for IRSPYGL", evidence: "created the pool for 8qhtfGY1v6WtK75WgMGaWcw1DUT3rXEu5R9LPQqVbonk at 2026-09-15T20:55:47Z depositing 450.9 SOL (tx 4fMftHUgjdVr…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "3n74UMjHoGy1xSiPuFRegMvgorcHviq4kRAh3GmRPePc", role: "deployer", label: "PumpSwap pool creator for ORBCROWN", evidence: "created the pool for G5QriGjyai2hkwC1Vw6rBm8jQZaib7kceecayKCoBAGS at 2026-09-15T21:09:29Z depositing 401.0 SOL (tx 4awtrUJtE1Va…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "CwXYLnAi7qXScpQMLQ1fMzhaTzg6oXuYsfUND1PjcLno", role: "deployer", label: "PumpSwap pool creator for Uclcrab", evidence: "created the pool for HFKHqyJroRgU9j9hVya2rqm48T5WJwrU1KStygwABAGS at 2026-09-15T21:19:06Z depositing 400.6 SOL (tx 3wCQ458SrD2T…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "ECmgGJqYLDVfmanhqB3oUU8huqPMCDur3MYu1596wxFf", role: "deployer", label: "PumpSwap pool creator for Dunworm", evidence: "created the pool for 5mwnJgccHmRBv5HkqaQ3zs83nnGABR6p2L9UscRSBAGS at 2026-09-15T21:32:33Z depositing 415.4 SOL (tx 54Jx3m4ExoAi…) with the PARK creator as coin_creator; pool SOL vault read 0.00 on 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "C1k65UizER9Xzywq91igjqzP1TVkyM2S1RPPbHtpxxce", role: "sniper", label: "launch-bundle wallet (1.925% in the first 13 slots)", evidence: "fresh wallet (7 txs) funded 0.781 SOL by iGdFcQoyR2… at 2026-09-15 09:43 UTC, 4.5 to 5 hours before launch; bought 1.925% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "2NriqKBAJbTev2De33TiAvrypgKrS8ZBomVYVnxBtkaa", role: "sniper", label: "launch-bundle wallet (2.488% in the first 13 slots)", evidence: "fresh wallet (7 txs) funded 0.893 SOL by 83yG2brNva… at 2026-09-15 09:42 UTC, 4.5 to 5 hours before launch; bought 2.488% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "EZKyWYGsXZ8RS5uz6skfCCYBPqp7GSdHHCfNbgsGDoDQ", role: "sniper", label: "launch-bundle wallet (2.053% in the first 13 slots)", evidence: "fresh wallet (9 txs) funded 0.707 SOL by 41uCv6a1JP… at 2026-09-15 09:45 UTC, 4.5 to 5 hours before launch; bought 2.053% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "DoJq1bYbWcr2RFhufkdUfvC39F8SmrbrLvAsjbcG6YBe", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.075 SOL by B48kNVXs4Y… at 2026-09-15 09:57 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "6MRhWx53DFj2u9L23wQRUWQt3YqRhQhBe1E75cdBWW9J", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.084 SOL by iGdFcQoyR2… at 2026-09-15 10:01 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "4AGFvMCSEXF78fyf6xAdvjFHkgCvXUXpctVaG2m2CQKb", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.061 SOL by BmFdpraQhk… at 2026-09-15 09:59 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "76A9MvgRNturJikyv8RJjhF12iaafT1nedC3pdffufjt", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (3 txs) funded 1.034 SOL by 41uCv6a1JP… at 2026-09-15 10:01 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.811% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
      { chain: SOL, address: "3C66znKxJAKzG9EKUn6jkzEaRxMRWX9B6qh5qHwAgQrU", role: "sniper", label: "launch-bundle wallet (0.811% in the first 13 slots)", evidence: "fresh wallet (5 txs) funded 1.051 SOL by 83yG2brNva… at 2026-09-15 09:56 UTC, 4.5 to 5 hours before launch; bought 0.811% of PARK within 13 slots of slot 447275242; holds 0.0% on 2026-09-16 16:00 UTC (bonding-curve account 7fQP9eZk… history)" },
    ],
    accounts: [
      { handle: "stonkspark", role: "project", label: "$PARK project account (recycled serial-memecoin handle)", evidence: "joined May 2024, 331 followers and 8 following on 2026-09-16; GMGN rename history shows 13 renames with twelve 2024 Solana memecoin handles (grammahsol, studymillis, paralympicssol, jimmyspysol, ribsolana, retardblinders, donnieonsol, harry_solana1, irs_onsolana, sam_catman1, salsa_sol1, barrybutchersol) and 3 deleted tweets; posted animated episodes 2026-09-15 and 09-16 and paid DexScreener ads ($598 Dex Paid)" },
    ],
    launches: [
      { chain: SOL, address: "7gKKy2p1SaMkRFPX7caF96YpfuMMpDj82ZpjaffuvaU5", symbol: "PARK", name: "STONKS PARK", launchedAt: "2026-09-15T14:41:13Z", venue: "pump.fun (Token-2022 mint), graduated to PumpSwap 2026-09-16 12:53 UTC with the LP burned", outcome: "curve-scalped", note: "43 buys in the first 20 slots took 44.65% of supply; slot 0 and 1 took 10.84% including the 2.75% dev buy; eight fresh wallets funded about 1.05 SOL each from five high-throughput hubs 5 hours before launch took 10.5% (five bought an identical 0.811% in slot +13) and all but one exited by slot +20; early buyers bought 41.2% and held 1.9% on 2026-09-16; post-graduation tape 35,298 txs in the first hour on about 920 holders and $26k liquidity; graduation took 22 hours", evidence: "bonding-curve account 7fQP9eZk6xPVULLETYEfcHFQYSA1sbYQnd3BxJWMeD6C signature history (3,880 txs) and first 150 trades decoded 2026-09-16; mint signature count 40,000+ from 2026-09-16 13:32 UTC; GMGN 2026-09-16: snipers 4.04%, bundler 17.3%, dev 2.75%" },
      { chain: SOL, address: "5NK9STFaivRDScQnF5VwE7zwdEfFpKRd3BwhPPYuBAGS", symbol: "Aigob", name: "TRUMP GUARDRAIL GOBLIN", launchedAt: "2026-09-15T14:50:40Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 191.7 SOL by HCEtGKAaKT… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3Ycuq1veGFj4… at 2026-09-15T14:50:40Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "BfRMi3osCEn76huxCMiPqvyfWz9YwzfzdViMa83Bmoon", symbol: "XIDRAG", name: "XIANGHAI DRAGON", launchedAt: "2026-09-15T14:53:14Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 441.1 SOL by HU2MFdEZzx… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3dGcn1LNXJTX… at 2026-09-15T14:53:14Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "AbEtvmjR9afBvjVY4hxzqLxN3xmFoCwAEXCofVgmoon", symbol: "ROBAI", name: "Roblox Puppet", launchedAt: "2026-09-15T15:06:22Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 372.4 SOL by Gf7adCBCyU… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3Kiv9FrLmSKe… at 2026-09-15T15:06:22Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "CeHRqHs1adSwco4nGfRnC47ME8EdUVMhCce5HVABBAGS", symbol: "MLBWC", name: "MLB WILDCARD", launchedAt: "2026-09-15T15:09:35Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 351.3 SOL by DDe2JJPAmE… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx fpZqpBi3GtpZ… at 2026-09-15T15:09:35Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "DtA6FUsUY4nK9HLYr8L3sZRNQUPKZfLxhtMB9qvJpump", symbol: "Tayrock", name: "Taylor Rocket", launchedAt: "2026-09-15T15:51:30Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 335.1 SOL by 9Nin9rBdPt… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx H7hw4KeCkUQC… at 2026-09-15T15:51:30Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "Ap8gWjgA9YdJQpMTeyAEqn6YP7rP3UC82GDvYWYipump", symbol: "DRONKRA", name: "NATO DRONE KRAKEN", launchedAt: "2026-09-15T16:04:51Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 421.2 SOL by 9FNHre7R3S… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx HHM3MeUbvnk3… at 2026-09-15T16:04:51Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "8qhtfGY1v6WtK75WgMGaWcw1DUT3rXEu5R9LPQqVbonk", symbol: "IRSPYGL", name: "Iran Spyglass", launchedAt: "2026-09-15T20:55:47Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 450.9 SOL by 4nTdq49rcf… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 4fMftHUgjdVr… at 2026-09-15T20:55:47Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "G5QriGjyai2hkwC1Vw6rBm8jQZaib7kceecayKCoBAGS", symbol: "ORBCROWN", name: "Orbit Crown", launchedAt: "2026-09-15T21:09:29Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 401.0 SOL by 3n74UMjHoG… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 4awtrUJtE1Va… at 2026-09-15T21:09:29Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "HFKHqyJroRgU9j9hVya2rqm48T5WJwrU1KStygwABAGS", symbol: "Uclcrab", name: "CHAMPIONS CRAB", launchedAt: "2026-09-15T21:19:06Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 400.6 SOL by CwXYLnAi7q… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 3wCQ458SrD2T… at 2026-09-15T21:19:06Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
      { chain: SOL, address: "5mwnJgccHmRBv5HkqaQ3zs83nnGABR6p2L9UscRSBAGS", symbol: "Dunworm", name: "DUNE SANDWORM", launchedAt: "2026-09-15T21:32:33Z", venue: "PumpSwap create_pool by a throwaway wallet (no pump.fun curve), fake launchpad address suffix", outcome: "liquidity-pulled", note: "pool opened with 415.4 SOL by ECmgGJqYLD… naming the PARK creator as coin_creator; drained to 0.00 SOL within minutes; DexScreener still quoted a multi-million market cap on zero liquidity on 2026-09-16", evidence: "create_pool tx 54Jx3m4ExoAi… at 2026-09-15T21:32:33Z; pool WSOL vault balance 0.00 read 2026-09-16 16:00 UTC" },
    ],
  },
  {
    id: "rh-farm-idx9000",
    name: "IDX9000 self-launch and dividend pivot",
    kind: "launch-farm",
    intent: "nefarious",
    summary:
      "One operator launched the same IDX token twice on Pons V2 within fifteen minutes, buying 36% and then 30% of supply in the creation transactions and selling every token back into the curve within minutes, then claimed the confiscated creator tax and bridged 2.59 ETH to BNB Chain. An hour before the last exit the deployer redirected the token's creator-fee stream to a Pons holder-rewards escrow, and the website, X account and a paid caller appeared after that, selling the token as a SPY-dividend index. The exit wallet re-entered with a small position nine minutes before the domain was registered.",
    firstSeen: "2026-09-14",
    lastSeen: "2026-09-16",
    wallets: [
      { chain: RH, address: "0x5cfdc3ee06936ea4d0522eaa444a863d89bf39d6", role: "deployer", label: "IDX deployer (EIP-7702 account, 69 txs)", evidence: "funded 0.5 ETH at 2026-09-14 03:50 UTC from the 5,845 ETH hot wallet 0x53091256…; launched 0x8db9cbfa… at 04:52 with a 36.4% dev buy for 2.516 SPY and sold it by 04:57; launched 0xcd4e70bf… at 05:02:50 via PonsV2LaunchAndBuy with a 30.11% dev buy for 1.898 SPY (tx 0xff312ea8…), sold 7.53%, 7.45% and 5.13% into the curve at 05:04 to 05:05, 7.49% at 14:39 to 14:48 and 2.51% into the graduated pool at 15:40; six PonsV2FeeEscrow claimToken calls took 1.137 SPY plus 0.132 SPY on the first token; called PonsV2LaunchFactory.transferCreatorFeeRecipient to escrow 0xaa10a1ca… at 16:37:05; last tx 16:40; holds 0" },
      { chain: RH, address: "0xe00244b4f2f63b034dbf9d3e88cdfd606ad950df", role: "off-ramp", label: "exit wallet on BNB Chain and Robinhood, serial Pons sniper", evidence: "recipient of all seven deployer RelayDepository deposits (2.5946 ETH, 9.07 BNB) resolved via api.relay.link on 2026-09-16; the same address on Robinhood Chain has 1,587 txs since 2026-07-09, 34 Relay bridge-outs and approvals on dozens of PonsV2LauncherTokens; bought 0.39% of IDX at 2026-09-14 17:37 UTC and held 0.37% on 2026-09-16 while receiving the SPY holder drips" },
      { chain: RH, address: "0xde42eaab9559311dca35ea946091021c69f557a3", role: "kol-wallet", label: "@YusufGemz FOMO-verified EVM wallet (FomoScan attribution)", evidence: "FomoScan record for FOMO account YusufGemz (read 2026-09-17; FOMO holds no X link, binding rests on the name and the $500-$10K challenge bio matching his X). Bought 22.8M IDX through RelayRouterV3 0xb92fe925 in six buys 2026-09-14 16:35-19:58 UTC, the first 3.6 h before his first public $IDX call at 20:12; moved 16.5M to 0xff218593 before the call and 6.1M after; holds 1.13M; 9 txs, 0 ETH on Robinhood (funds arrive bridged). Also received 555K PONSAN in the 8 h before his 2026-09-05 PONSAN call (small)." },
      { chain: RH, address: "0xff2185935502c11811268a443f7651c3db5d3145", role: "kol-wallet", label: "@YusufGemz second wallet (EIP-7702 account, delegate 0xe8b12077…)", evidence: "received IDX only from 0xde42eaab (22.06M across 2026-09-14 17:17 to 2026-09-16 13:01) and 3.6M from router 0x8366a39c; sold 23.8M IDX in 1M-lot chunks to contract 0x36dc95f1 from 2026-09-15 14:32 UTC (18 h after the first call) through the 2026-09-16 11:11 and 17:09 calls; 57 txs, 0.47 ETH (read 2026-09-17)" },
      { chain: SOL, address: "EkeSXXNqPc5bvxeLgPmAQoVjwTPUB4k8hzNHDmfQ4S9p", role: "kol-wallet", label: "@YusufGemz FOMO-verified Solana wallet", evidence: "FomoScan record for FOMO account YusufGemz (read 2026-09-17); FOMO cash flow 30 d net -$985 on $94k volume, 359 trades. Not yet traced against his Solana calls." },
    ],
    accounts: [
      { handle: "IDX_RH", role: "project", label: "$IDX9000 project account (appeared after the exit)", evidence: "joined September 2026; 45 posts by 2026-09-16 in a two-hour cadence framing IDX9000 as an index; follows MEADGod, ponsdotfamily, RobinhoodApp and RobinhoodCrypto; domain index9000.xyz registered on Namecheap 2026-09-14 17:46 UTC, 66 minutes after the deployer's last transaction" },
      { handle: "YusufGemz", role: "kol", label: "Yusuf · paid caller (34.4k followers, Telegram channel)", evidence: "first $IDX mention 2026-09-14 20:12 UTC ('My $SPX friend never miss') at about an $80k cap, then four more calls to 2026-09-16 17:09 ('$1M next', 'Quant told me next phase coming') riding the cap from $227k to $435k; bio 'Alpha Frontrunner', private Telegram ('YG CABAL'); backtest of 28 priced calls 2026-08-31 to 09-16: median +24 h -15%, +72 h -18%, 20 of 28 under water at +72 h, $PONSAN -99%, $4AI -90%, $DOGE-1 -97% after 'called it early in the YG cabal' posts (RESEARCH.md, KOL call backtest)" },
    ],
    launches: [
      { chain: RH, address: "0x8db9cbfa0c1a4bb474db19c5d92590f5b03f70eb", symbol: "IDX", name: "IDX (first attempt)", launchedAt: "2026-09-14T04:52:36Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "36.4% dev buy for 2.516 SPY in the creation tx, sold in two transactions at 04:56 and 04:57 UTC, creator tax claimed at 04:57 and 0.367 ETH bridged out at 04:58; never graduated, no DexScreener pair", evidence: "deployer token-transfer history on Blockscout read 2026-09-16" },
      { chain: RH, address: "0xcd4e70bfd73952123449e453f08c12e44ab89e58", symbol: "IDX", name: "IDX9000", launchedAt: "2026-09-14T05:02:50Z", venue: "pons-v2", outcome: "self-sniped-and-dumped", note: "curve quoted in tokenized SPY; 30.11% dev buy sold in full by 15:40 UTC; 25 wallets took 23.97% in blocks +54 to +61 and three later buy clusters landed within four blocks of each dev sell; graduated 15:40 UTC with 8.16% in PonsV2LaunchLocker (position 2697526); creator-fee recipient moved to the Pons holder-rewards escrow 0xaa10a1ca… at 16:37, which has paid SPY to holders every 90 minutes since; on 2026-09-16 Robinhood-app retail bought 18.5% of supply in 24 h through RobinHoodSettler while aggregator and MEV bots sold 53%", evidence: "transfer logs from block 62544585 read 2026-09-16 via rpc.mainnet.chain.robinhood.com; PonsV2LaunchFactory.transferCreatorFeeRecipient decoded on Blockscout; DexScreener 2026-09-16: $358k cap, $49k liquidity, $235k 24h volume, 540 holders" },
    ],
  },
];

// ---- lookups ----

const walletKey = (chain: string, address: string) => `${chain.trim().toLowerCase()}:${address.trim().toLowerCase()}`;

export interface CabalWalletHit { cabal: Cabal; wallet: CabalWallet }
export interface CabalLaunchHit { cabal: Cabal; launch: CabalLaunch }
export interface CabalAccountHit { cabal: Cabal; account: CabalAccount }

let walletIndex: Map<string, CabalWalletHit> | null = null;
let launchIndex: Map<string, CabalLaunchHit> | null = null;
let handleIndex: Map<string, CabalAccountHit[]> | null = null;

function buildIndexes() {
  walletIndex = new Map();
  launchIndex = new Map();
  handleIndex = new Map();
  for (const cabal of CABALS) {
    for (const wallet of cabal.wallets) {
      // A prefix-only record (address shorter than 42 chars) is documentation,
      // never a match: exact-match only, the same rule marketAddresses.ts keeps.
      if (!/^0x[0-9a-f]{40}$/i.test(wallet.address) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet.address)) continue;
      const k = walletKey(wallet.chain, wallet.address);
      if (!walletIndex.has(k)) walletIndex.set(k, { cabal, wallet });
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

/** Exact-match lookup of a wallet against every cabal. Chain is required. */
export function findCabalWallet(chain: string | null | undefined, address: string | null | undefined): CabalWalletHit | null {
  if (!chain || !address) return null;
  if (!walletIndex) buildIndexes();
  return walletIndex!.get(walletKey(chain, address)) ?? null;
}

/** Exact-match lookup of a token contract against indexed launches. */
export function findCabalLaunch(chain: string | null | undefined, address: string | null | undefined): CabalLaunchHit | null {
  if (!chain || !address) return null;
  if (!launchIndex) buildIndexes();
  return launchIndex!.get(walletKey(chain, address)) ?? null;
}

/** All cabals an X handle appears in (a KOL can sit in more than one ring). */
export function findCabalHandle(handle: string | null | undefined): CabalAccountHit[] {
  if (!handle) return [];
  if (!handleIndex) buildIndexes();
  return handleIndex!.get(handle.replace(/^@/, "").toLowerCase()) ?? [];
}

export function cabalById(id: string): Cabal | null {
  return CABALS.find((c) => c.id === id) ?? null;
}

/**
 * The handles of a cabal as trust-graph associates, flagged `in_cabal_kb` so
 * src/graph/network.ts marks them and the cabal forms without a second
 * audited subject. `subjectHandle` is excluded so a subject is never its own
 * associate.
 */
export function cabalAssociates(cabalId: string, subjectHandle?: string): AssociateInput[] {
  const cabal = cabalById(cabalId);
  if (!cabal) return [];
  const self = subjectHandle?.replace(/^@/, "").toLowerCase();
  return cabal.accounts
    .filter((a) => a.handle.toLowerCase() !== self)
    .map((a) => ({
      associate_handle: `@${a.handle}`,
      relation: `${a.role} · ${cabal.name}`,
      kind: a.role === "project" ? "org" : "person",
      in_cabal_kb: true,
      notes: a.evidence,
      // Registry rows are hand-traced against on-chain and X artifacts, so
      // they are graph-eligible; they are never a model lead.
      evidence_origin: "human_verified",
      artifact_verified: true,
      provider: CABAL_REGISTRY_PROVIDER,
    }));
}

export const CABAL_REGISTRY_PROVIDER = "argus-cabal-registry";
export const CABAL_MEMBERSHIP_FINDING = "CabalMembership";

/**
 * Everything the audit should ingest for a subject handle that appears in the
 * registry: its cabal-mates as associates, plus one finding per NEFARIOUS
 * cabal so the membership shows in the report and not only in the graph.
 * Benign rings contribute associates only (a disclosure, never a penalty).
 */
export function cabalEvidenceForSubject(handle: string | null | undefined): {
  associates: AssociateInput[];
  findings: CabalMembershipFinding[];
} {
  const hits = findCabalHandle(handle);
  const associates: AssociateInput[] = [];
  const findings: CabalMembershipFinding[] = [];
  const seen = new Set<string>();
  for (const { cabal, account } of hits) {
    for (const a of cabalAssociates(cabal.id, handle ?? undefined)) {
      const k = a.associate_handle.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      associates.push(a);
    }
    if (cabal.intent !== "nefarious") continue;
    findings.push({
      finding_type: CABAL_MEMBERSHIP_FINDING,
      claim: `@${account.handle} is recorded as ${account.role} of the ${cabal.name} (${cabal.kind.replace(/-/g, " ")}): ${account.evidence}`,
      source_url: `argus://cabals/${cabal.id}`,
      source_date: cabal.lastSeen,
      source_author: CABAL_REGISTRY_PROVIDER,
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "human_verified",
      artifact_verified: true,
      provider: CABAL_REGISTRY_PROVIDER,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: `@${account.handle}`,
        target_entity_type: account.role === "project" ? "project" : "person",
        relationship_to_subject: "self",
      },
    });
  }
  return { associates, findings };
}

export interface CabalMembershipFinding {
  finding_type: typeof CABAL_MEMBERSHIP_FINDING;
  claim: string;
  source_url: string;
  source_date: string;
  source_author: string;
  verification_status: "Verified";
  independent_source_count: number;
  polarity: -1;
  evidence_origin: "human_verified";
  artifact_verified: true;
  provider: string;
  finding_scope: {
    scope: "direct_subject";
    target_entity_key: string;
    target_entity_type: "project" | "person";
    relationship_to_subject: "self";
  };
}

/** Short, second-person sentence for scanner copy. */
export function describeCabalHit(hit: CabalWalletHit): string {
  const c = hit.cabal;
  const n = c.launches.length;
  const role = hit.wallet.label ?? hit.wallet.role;
  return `${role} wallet of the ${c.name} (${c.intent} cluster${n ? `, ${n} indexed launch${n === 1 ? "" : "es"}` : ""}; last seen ${c.lastSeen})`;
}
