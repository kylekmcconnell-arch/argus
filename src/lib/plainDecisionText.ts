import { publicCheckLabel, publicCheckNote } from "./plainLanguage";
import { publicFindingTitle, publicIntelligenceText } from "./intelligencePresentation";

/**
 * Reader-facing wording for a decision item. Every lane that renders the
 * decision brief speaks this same plain language, so a share card, an export
 * and the report page describe one finding with one sentence.
 */
export function plainDecisionText(value: string): string {
  return publicIntelligenceText(publicCheckNote(publicFindingTitle(publicCheckLabel(value))))
    .trim()
    .replace(/^Resolve deployer trail$/i, "Who created the token")
    .replace(/^Resolve bytecode fingerprint$/i, "Copied contract code")
    .replace(/^Check deployer trail$/i, "Who created the token")
    .replace(/^Check bytecode fingerprint$/i, "Copied contract code")
    .replace(/^Resolve wallet clustering$/i, "Connected holder wallets")
    .replace(/^Resolve operator\s*\/\s*funding trace$/i, "Where the token creator’s funds came from")
    .replace(/^Resolve holder distribution$/i, "Large holder distribution")
    .replace(/^Corroborated on CoinGecko/i, "Listed on a major market registry")
    .replace(/\bWallet clustering\b/gi, "Connected holder wallets")
    .replace(/\bSell simulation passed \(buy ([\d.]+)% \/ sell ([\d.]+)%\)\./gi, "Buying and selling worked in the test ($1% buy fee / $2% sell fee).")
    .replace(/\bBuy\s*\/\s*sell simulation\b/gi, "Buy and sell test")
    .replace(/\bHolder distribution\b/gi, "Large holders")
    .replace(/\bContract safety\b/gi, "Contract controls")
    .replace(/\bmint authority active\s*·\s*owner active\b/gi, "more tokens can be created · contract owner still has control")
    .replace(/\bMint authority is live:\s*supply can be minted\.\s*/gi, "More tokens can still be created. ")
    .replace(/\bOn a token with real centralized-exchange listings this is typically a governed emissions\/ops mechanism, not a rug setup\.\s*/gi, "For a token listed on major exchanges, this may be part of normal operations rather than a scam. ")
    .replace(/\bConfirm the controller\./gi, "Check who controls this power.")
    .replace(/\bLiquidity does not appear locked or burned\./gi, "Trading funds are not locked away, so they could still be removed.")
    .replace(/\bcentralized markets\b/gi, "centralized exchange listings")
    .replace(/holder rows analyzed/gi, "holder wallets checked")
    .replace(/no elevated concentration surfaced/gi, "no unusual wallet concentration found")
    .replace(/redeployed-rug clone check;\s*completion outcome not recorded/gi, "We could not finish checking whether the contract copies code from a known scam.")
    .replace(/completion outcome not recorded/gi, "This check did not finish.")
    .replace(/\s+/g, " ")
    .trim();
}

