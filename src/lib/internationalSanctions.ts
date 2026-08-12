// Non-US sanctions screening: EU, UN, and UK (FCDO) consolidated lists, run
// alongside the existing US Treasury OFAC SDN name screen (see collectOfacName
// in offchainEvidence.ts). This complements OFAC — it does not replace it.
//
// All three lists are consumed from OpenSanctions in the same
// `targets.simple.csv` shape the OFAC screen already uses, so this reuses the
// proven person-name parser (parseOfacPersonNames) and the same normalization
// and exact + reversed-name matching. OpenSanctions aggregates the official
// primary sources:
//   - EU  eu_fsf            ← EC/FISMA Consolidated Financial Sanctions List
//   - UN  un_sc_sanctions   ← UN Security Council Consolidated List
//   - UK  gb_fcdo_sanctions ← FCDO UK Sanctions List (OFSI ConList closed 2026-01-28)
//
// Using OpenSanctions (rather than three different agency XML schemas + the EU
// magic token + the UN 302-blob redirect) keeps a single format and matches the
// data source the OFAC screen already trusts.
import {
  normalizeResolvedName,
  normalizeSanctionsName,
  parseOfacPersonNames,
  type OffchainAttempt,
  type OffchainAttemptStatus,
} from "./offchainEvidence";

type Fetcher = typeof fetch;

export interface SanctionsListSpec {
  key: "eu" | "un" | "uk";
  label: string;
  slug: string;
  /**
   * Sanity floor on the parsed person-name index. A successful pull is well
   * above this; a value below it means a truncated or header-only download and
   * is reported as an unavailable list rather than a false "no match".
   * Floors sit safely under observed counts (EU ~4.3k, UN ~0.7k, UK ~4.0k).
   */
  minNames: number;
}

export const INTERNATIONAL_SANCTIONS_LISTS: readonly SanctionsListSpec[] = [
  { key: "eu", label: "EU Consolidated Financial Sanctions", slug: "eu_fsf", minNames: 1_500 },
  { key: "un", label: "UN Security Council Consolidated", slug: "un_sc_sanctions", minNames: 300 },
  { key: "uk", label: "UK Sanctions List (FCDO)", slug: "gb_fcdo_sanctions", minNames: 1_500 },
];

export const openSanctionsDatasetUrl = (slug: string): string =>
  `https://data.opensanctions.org/datasets/latest/${slug}/targets.simple.csv`;

export interface SanctionsListResult {
  key: SanctionsListSpec["key"];
  label: string;
  sourceUrl: string;
  available: boolean;
  listSize: number;
  sanctioned: boolean;
}

export type InternationalSanctionsPayload =
  | {
      available: true;
      name: string;
      results: SanctionsListResult[];
      /** matched on ANY available list */
      sanctioned: boolean;
      /** labels of lists that produced a name match */
      matchedLists: string[];
      /** labels of lists actually screened (index loaded) */
      screenedLists: string[];
    }
  | { available: false; note: string };

export interface InternationalSanctionsCollection {
  value: InternationalSanctionsPayload;
  attempts: OffchainAttempt[];
  status: OffchainAttemptStatus;
}

const aggregateStatus = (attempts: readonly OffchainAttempt[]): OffchainAttemptStatus => {
  if (!attempts.length) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "failed")) return "failed";
  return "partial";
};

async function loadListNames(
  list: SanctionsListSpec,
  fetcher: Fetcher,
): Promise<{ names: Set<string>; attempt: OffchainAttempt }> {
  const operation = `${list.slug}-name-index`;
  let response: Response;
  try {
    response = await fetcher(openSanctionsDatasetUrl(list.slug), { signal: AbortSignal.timeout(20000) });
  } catch {
    return { names: new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: "transport_error" } };
  }
  if (!response.ok) {
    return { names: new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: `http_${response.status}` } };
  }
  let csv: string;
  try {
    csv = await response.text();
  } catch {
    return { names: new Set(), attempt: { provider: "opensanctions", operation, status: "failed", detail: "response_text_error" } };
  }
  const names = parseOfacPersonNames(csv);
  const valid = names.size >= list.minNames;
  return {
    names: valid ? names : new Set(),
    attempt: {
      provider: "opensanctions",
      operation,
      status: valid ? "succeeded" : "partial",
      detail: valid ? `${names.size}_names` : `undersized_index_${names.size}`,
    },
  };
}

/**
 * Screen a resolved real name against the EU, UN, and UK consolidated sanctions
 * lists. Returns availability per list so a partial provider outage never reads
 * as a clean screen. Never throws — every failure becomes an unavailable list.
 */
export async function collectInternationalSanctions(
  rawName: string,
  options: { fetcher?: Fetcher } = {},
): Promise<InternationalSanctionsCollection> {
  const name = normalizeResolvedName(rawName);
  const query = normalizeSanctionsName(name);
  if (query.split(" ").filter(Boolean).length < 2) {
    return {
      value: { available: false, note: "Sanctions screen needs a resolved real name." },
      attempts: [],
      status: "succeeded",
    };
  }

  const fetcher = options.fetcher ?? fetch;
  const tokens = query.split(" ");
  const reversed = [tokens[tokens.length - 1], ...tokens.slice(0, -1)].join(" ");

  const loaded = await Promise.all(
    INTERNATIONAL_SANCTIONS_LISTS.map((list) =>
      loadListNames(list, fetcher).then((result) => ({ list, ...result })),
    ),
  );
  const attempts = loaded.map((entry) => entry.attempt);
  const results: SanctionsListResult[] = loaded.map(({ list, names }) => ({
    key: list.key,
    label: list.label,
    sourceUrl: openSanctionsDatasetUrl(list.slug),
    available: names.size > 0,
    listSize: names.size,
    sanctioned: names.has(query) || names.has(reversed),
  }));

  const screened = results.filter((result) => result.available);
  if (!screened.length) {
    return {
      value: { available: false, note: "EU, UN, and UK sanctions lists were all unavailable." },
      attempts,
      status: aggregateStatus(attempts),
    };
  }
  const matched = screened.filter((result) => result.sanctioned);
  return {
    value: {
      available: true,
      name,
      results,
      sanctioned: matched.length > 0,
      matchedLists: matched.map((result) => result.label),
      screenedLists: screened.map((result) => result.label),
    },
    attempts,
    status: aggregateStatus(attempts),
  };
}

export interface SanctionsScreenSummary {
  /** ScanCheck-compatible status for the wiring layer. */
  status: "finding" | "checked-empty" | "unavailable";
  note: string;
}

/**
 * Pure formatter: map a collection outcome to a ScanCheck status + note, mirroring
 * the OFAC note style. Kept here so the wiring layer (offchain.ts) stays a
 * one-liner and this module is testable without the collector's internals.
 */
export function describeInternationalSanctions(
  collection: InternationalSanctionsCollection,
): SanctionsScreenSummary {
  const { value } = collection;
  if (!value.available) {
    return { status: "unavailable", note: value.note };
  }
  if (value.sanctioned) {
    return {
      status: "finding",
      note: `exact full-name or alias match on ${value.matchedLists.join(", ")}; identity match requires review`,
    };
  }
  return {
    status: "checked-empty",
    note: `exact full-name and reversed-name screen completed against ${value.screenedLists.join(", ")} with no match`,
  };
}
