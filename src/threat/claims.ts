// Claim verdicts: the project's own statements (api/claims) held against the
// evidence the scan already has - the product's client and API, the launch
// trace, the creator fee trace, the sell tape, the holder table. Each claim
// gets one of four answers. "Contradicted" is a finding: the copy and the
// evidence disagree. "Unrealised" is a promise with no mechanism behind it
// yet. "Unverifiable" is stated as such rather than silently passed.
import type { ClaimVerdict, LaunchProvenance, ProductAuthenticity, ProjectClaim, SellStructure } from "./types";
import type { TokenomicsView } from "./tokenomics";

export interface ClaimEvidence {
  product: ProductAuthenticity | null;
  launch: LaunchProvenance | null;
  sellers: SellStructure | null;
  tokenomics: TokenomicsView | null;
  // Market rows of kind "locker" among the top holders, as a share of supply.
  lockedHolderPct: number;
  deployerMixerHop: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function judgeClaims(claims: ProjectClaim[], ev: ClaimEvidence): ClaimVerdict[] {
  const out: ClaimVerdict[] = [];
  const product = ev.product;
  const shownProviders = new Set([
    ...(product?.providers.map((p) => norm(p.name)) ?? []),
    ...(product?.api?.providers.map(norm) ?? []),
  ]);
  const snipeBuyers = ev.launch?.snipe?.sameBlockBuyers ?? null;
  const snipePct = ev.launch?.snipe?.pctOfSupply ?? null;
  const tapeSnipers = ev.sellers?.topSellers.filter((t) => t.sameBlockSniper).length ?? 0;
  const cf = ev.launch?.creatorFees ?? null;

  for (const claim of claims) {
    const push = (status: ClaimVerdict["status"], evidence: string) => out.push({ claim, status, evidence });
    switch (claim.kind) {
      case "router": {
        if (!product) { push("unverifiable", "The product's client could not be read, so the routing claim stands untested."); break; }
        const named = claim.names.filter((n) => !/peer\.xyz|zkp2p|certik|hashlock|pashov/i.test(n));
        if (product.read === "white-label") {
          const missing = named.filter((n) => !shownProviders.has(norm(n)));
          const shown = product.providers.map((p) => p.name).join(", ");
          if (missing.length) push("contradicted", `The client and its API expose ${shown} only${product.api?.service ? ` (service "${product.api.service}")` : ""}; ${missing.join(", ")} appear${missing.length === 1 ? "s" : ""} nowhere in the code. One provider, one quote, no route legs.`);
          else if (named.length) push("confirmed", `The named providers (${named.join(", ")}) are what the client loads.`);
          else push("contradicted", `The client and its API expose a single provider (${shown}) and a single quote object - a wrapper, not a router across protocols.`);
        } else if (product.read === "self-hosted") {
          push("unverifiable", `The client carries ${product.contractsInApp} contract address${product.contractsInApp === 1 ? "" : "es"} of its own; which protocols they route through was not read.`);
        } else push("unverifiable", "The client shows neither its own contracts nor a known provider; the routing claim cannot be tested from it.");
        break;
      }
      case "original": {
        if (!product) { push("unverifiable", "No readable product to set the claim against."); break; }
        if (product.read === "white-label") push("contradicted", `The product is a white-label front-end for ${product.providers.map((p) => p.name).join(", ")} (${product.providers.flatMap((p) => p.evidence).slice(0, 3).join(", ")}).`);
        else if (product.read === "self-hosted") push("confirmed", `The client references ${product.contractsInApp} contract address${product.contractsInApp === 1 ? "" : "es"} of its own and no third-party provider.`);
        else push("unverifiable", "The client could not be read well enough to say whose engineering it is.");
        break;
      }
      case "fees-to-holders": {
        const dests = ev.tokenomics?.tax.destinations ?? [];
        if (dests.some((d) => /reflection|rwa-distribution|buyback|burn/.test(d))) { push("confirmed", `The contract's own tax routes to ${dests.join(", ")} - the mechanism exists in code.`); break; }
        if (!cf) { push("unverifiable", "No creator fee stream was read for this venue."); break; }
        const claims = cf.quoteClaims?.count ?? cf.claimCount ?? 0;
        if (claims === 0) { push("unrealised", `No creator fee claims observed yet${cf.platformPays ? " - fees accrue in the venue's escrow unclaimed" : ""}; a distribution promise with no distribution behind it so far.`); break; }
        if (cf.usage === "buyback" || cf.usage === "buyback-burn" || cf.usage === "lp-add") push("confirmed", `${claims} claim${claims === 1 ? "" : "s"} and the creator ${cf.usage === "lp-add" ? "added liquidity" : "bought the token back"}: ${cf.note}`);
        else if (cf.usage === "dump") push("contradicted", `${claims} claim${claims === 1 ? "" : "s"} and the proceeds were sold or moved on, not returned to holders: ${cf.note}`);
        else push("unrealised", `${claims} claim${claims === 1 ? "" : "s"} observed and the proceeds are held; nothing has reached holders or a buyback yet.`);
        break;
      }
      case "dev-locked": {
        if (ev.lockedHolderPct > 0) push("confirmed", `${ev.lockedHolderPct.toFixed(2)}% of supply sits in a recognised locker contract.`);
        else if (ev.tokenomics?.lp.status === "launchpad-locked" || ev.tokenomics?.lp.status === "locked") push("unverifiable", "The pool's liquidity is locked by the venue, but no team allocation was found in a recognised locker - the lock claimed here is not the LP lock.");
        else push("unverifiable", "No recognised locker holds a material share; the lock could not be found on chain.");
        break;
      }
      case "no-snipers": {
        if (snipeBuyers != null && snipeBuyers >= 3) push("contradicted", `${snipeBuyers} same-block buyers took ~${snipePct?.toFixed(0) ?? "?"}% of supply in the launch window (${ev.launch?.snipe?.window ?? "first blocks"}).`);
        else if (tapeSnipers >= 2) push("contradicted", `${tapeSnipers} launch-block snipers are in the sell tape and have exited.`);
        else if (snipeBuyers != null) push("confirmed", `${snipeBuyers} same-block buyer${snipeBuyers === 1 ? "" : "s"} in the launch window.`);
        else push("unverifiable", "No launch-window trace was available.");
        break;
      }
      case "no-custody": {
        if (product?.read === "white-label" && product.providers.some((p) => p.kind === "mixer" || p.kind === "instant-exchange")) push("contradicted", `The ${product.providers.map((p) => p.name).join(", ")} leg takes custody of funds mid-transfer; the front-end holding nothing does not make the route non-custodial.`);
        else if (product?.read === "self-hosted") push("unverifiable", "Own contracts in the client; custody terms were not read from them.");
        else push("unverifiable", "No product read to set the custody claim against.");
        break;
      }
      case "compliance":
        push("unverifiable", product?.read === "white-label" ? `Screening, if any, is ${product.providers.map((p) => p.name).join(", ")}'s; nothing of the product's own exists to screen.` : "Screening claims are not observable from the client or the chain.");
        break;
      case "audit":
        push("unverifiable", claim.names.length ? `Names ${claim.names.join(", ")}; no audit record was fetched.` : "No auditor named; no audit record was fetched.");
        break;
      case "doxxed":
        push("unverifiable", "Identity claims are tested by the people checks, not here.");
        break;
      case "partnership":
        push("unverifiable", claim.names.length ? `Names ${claim.names.join(", ")}; no partner-side confirmation was fetched.` : "No partner-side confirmation was fetched.");
        break;
    }
  }
  return out;
}

// Points for the judge: contradicted claims are findings; unrealised ones are
// warnings. Capped so a copy-heavy site cannot sink a token on wording alone.
export function claimsScore(verdicts: ClaimVerdict[]): { points: number; flags: string[]; warnings: string[]; positives: string[] } {
  const flags: string[] = []; const warnings: string[] = []; const positives: string[] = [];
  let points = 0;
  const label = (c: ProjectClaim) => `${c.kind.replace(/-/g, " ")} claim (${c.source})`;
  for (const v of verdicts) {
    const quote = v.claim.text.length > 140 ? `${v.claim.text.slice(0, 137)}…` : v.claim.text;
    if (v.status === "contradicted") { points += 8; flags.push(`Contradicted ${label(v.claim)}: "${quote}" - ${v.evidence}`); }
    else if (v.status === "unrealised") warnings.push(`Unrealised ${label(v.claim)}: "${quote}" - ${v.evidence}`);
    else if (v.status === "confirmed") positives.push(`Confirmed ${label(v.claim)}: ${v.evidence}`);
  }
  return { points: Math.min(points, 24), flags, warnings, positives };
}
