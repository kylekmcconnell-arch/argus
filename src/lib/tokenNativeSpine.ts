// Token-native reading spine: bound unique-ids first, then Enigma's token
// chapters. Count-true and evidence-bound only. Display name is never a bind
// key. Company handle and founder scores never become token unique-ids.

import type { ProjectTokenSnapshot } from "../data/evidence";
import type { TokenDossier } from "../token/audit";
import type { ProvenanceState } from "./provenance";

export type TokenUniqueIdKind =
  | "contract"
  | "chain"
  | "coingecko"
  | "official_x"
  | "official_site";

export interface TokenUniqueIdRow {
  kind: TokenUniqueIdKind;
  label: string;
  value: string;
  href?: string;
  provenance: ProvenanceState;
}

export interface TokenUniqueIdInput {
  /** Required for a launched-product bind. Token-as-subject scans omit this. */
  verified?: boolean;
  address?: string | null;
  chain?: string | null;
  coingeckoId?: string | null;
  /** Token official X only. Never a company or founder handle by fallback. */
  officialX?: string | null;
  /** Token official site only. Never a company domain by fallback. */
  officialSite?: string | null;
}

const SOURCED: ProvenanceState = { tier: "sourced" };

const trim = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

export function normalizeOfficialX(value: string | null | undefined): string | null {
  const raw = trim(value).replace(/^@/, "");
  if (!raw || /^(https?:\/\/)/i.test(raw)) return null;
  const handle = raw.match(/^(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})/i)?.[1]
    ?? (/^[A-Za-z0-9_]{1,15}$/.test(raw) ? raw : null);
  return handle ? `@${handle}` : null;
}

export function uniqueIdHeading(count: number): string {
  return `${count} bound unique-id${count === 1 ? "" : "s"}.`;
}

/**
 * Recorded launched-product unique-ids only. Missing fields stay missing.
 * `requireVerified` is the project-token gate: an unverified snapshot must
 * not print a contract or CoinGecko id as if it were bound.
 */
export function boundTokenUniqueIds(
  input: TokenUniqueIdInput,
  opts: { requireVerified?: boolean } = {},
): TokenUniqueIdRow[] {
  if (opts.requireVerified && input.verified !== true) return [];

  const rows: TokenUniqueIdRow[] = [];
  const address = trim(input.address);
  const chain = trim(input.chain);
  const gecko = trim(input.coingeckoId);
  const officialX = normalizeOfficialX(input.officialX);
  const site = trim(input.officialSite);
  const officialSite = /^https?:\/\//i.test(site) ? site : "";

  if (address) {
    rows.push({
      kind: "contract",
      label: "Contract address",
      value: address,
      provenance: SOURCED,
    });
  }
  if (chain) {
    rows.push({
      kind: "chain",
      label: "Chain",
      value: chain,
      provenance: SOURCED,
    });
  }
  if (gecko) {
    rows.push({
      kind: "coingecko",
      label: "CoinGecko id",
      value: gecko,
      href: `https://www.coingecko.com/en/coins/${encodeURIComponent(gecko)}`,
      provenance: SOURCED,
    });
  }
  if (officialX) {
    rows.push({
      kind: "official_x",
      label: "Official X",
      value: officialX,
      href: `https://x.com/${officialX.slice(1)}`,
      provenance: SOURCED,
    });
  }
  if (officialSite) {
    rows.push({
      kind: "official_site",
      label: "Official site",
      value: officialSite.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""),
      href: officialSite,
      provenance: SOURCED,
    });
  }
  return rows;
}

function tokenOfficialSite(d: TokenDossier): string | null {
  const fromSocials = d.socials.find((link) =>
    link.label === "site" && /^https?:\/\//i.test(link.url));
  return fromSocials?.url ?? d.cg?.homepage ?? null;
}

/** Token-as-subject scan: the contract is the subject, so CA/chain are bound. */
export function uniqueIdsFromTokenDossier(d: TokenDossier): TokenUniqueIdRow[] {
  return boundTokenUniqueIds({
    address: d.address,
    chain: d.chain,
    coingeckoId: d.cg?.id ?? null,
    officialX: d.projectX ?? d.cg?.twitter ?? null,
    officialSite: tokenOfficialSite(d),
  });
}

/** Launched-product bind on a project/account report. Company handle is never a fallback. */
export function uniqueIdsFromProjectToken(
  token: ProjectTokenSnapshot | null | undefined,
): TokenUniqueIdRow[] {
  if (!token || token.verified !== true) return [];
  return boundTokenUniqueIds({
    verified: true,
    address: token.address,
    chain: token.chain,
    coingeckoId: token.coingeckoId ?? null,
    officialX: token.officialX ?? null,
    officialSite: token.homepage ?? null,
  }, { requireVerified: true });
}

/**
 * Investigation reading layer. Prefer the launched-product snapshot when it is
 * verified. Fall back to the token dossier's own recorded ids. Never take the
 * company handle or company website as a token unique-id.
 */
export function uniqueIdsForInvestigation(input: {
  token: TokenDossier;
  projectToken?: ProjectTokenSnapshot | null;
}): TokenUniqueIdRow[] {
  const launched = uniqueIdsFromProjectToken(input.projectToken);
  if (launched.length) {
    const fromScan = uniqueIdsFromTokenDossier(input.token);
    const seen = new Set(launched.map((row) => row.kind));
    return [...launched, ...fromScan.filter((row) => !seen.has(row.kind))];
  }
  return uniqueIdsFromTokenDossier(input.token);
}
