import type {
  EntityContinuitySnapshot,
  EntityContinuitySource,
  EntityLifecycleEvent,
  TokenLineageNode,
} from "../../src/data/evidence";
import type { CollectContext } from "./types";
import { groundedSearch, groundedSearchProvisioned } from "./groundedSearch";

type OrganicResult = { title: string; url: string; snippet: string };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

function host(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function officialHosts(ctx: CollectContext): Set<string> {
  const values = [
    ctx.evidence.profile.website,
    ctx.evidence.projectToken?.homepage,
    ...(ctx.evidence.subjectOrientation?.sourceUrls ?? []),
  ].filter((value): value is string => Boolean(value));
  return new Set(values.map(host).filter(Boolean));
}

function sourceClass(url: string, official: Set<string>): EntityContinuitySource["sourceClass"] {
  const hostname = host(url);
  if ([...official].some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`))) return "first_party";
  if (/etherscan\.io$|solscan\.io$|basescan\.org$|arbiscan\.io$/.test(hostname)) return "explorer";
  if (/sec\.gov$|justice\.gov$|ftc\.gov$|europa\.eu$/.test(hostname)) return "regulator";
  if (/kucoin\.com$|mexc\.com$|binance\.com$|coinbase\.com$|kraken\.com$|bitget\.com$/.test(hostname)) return "exchange";
  return "secondary";
}

export function buildEntityContinuityQueries(subject: string, ticker?: string | null): string[] {
  const token = ticker?.trim() ? ` ${ticker.trim().replace(/^\$/, "")}` : "";
  return [
    `what happened to ${subject}`,
    `${subject} formerly rebrand predecessor`,
    `${subject}${token} token migration swap`,
    `${subject}${token} old contract new contract`,
    `${subject}${token} migration contract exchange support`,
  ];
}

function parseJson(raw: string): Record<string, unknown> | null {
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return record(JSON.parse(candidate)); } catch { return null; }
}

function admittedUrls(value: unknown, organicUrls: Set<string>): string[] {
  return strings(value).map(canonicalUrl).filter((url) => organicUrls.has(url));
}

function validKind(value: unknown): EntityLifecycleEvent["kind"] | null {
  const allowed: EntityLifecycleEvent["kind"][] = ["predecessor", "rebrand", "token_migration", "contract_replacement", "exchange_handling", "architecture_change", "current_status"];
  return typeof value === "string" && allowed.includes(value as EntityLifecycleEvent["kind"])
    ? value as EntityLifecycleEvent["kind"]
    : null;
}

/** Parse model extraction fail-closed: every retained claim must cite a URL Serper actually returned. */
export function normalizeEntityContinuity(
  raw: string,
  subject: string,
  organic: readonly OrganicResult[],
  official: ReadonlySet<string>,
  currentToken?: { name?: string; ticker?: string; contract?: string; chain?: string },
): EntityContinuitySnapshot | null {
  const parsed = parseJson(raw);
  if (!parsed) return null;
  const organicByUrl = new Map(organic.map((item) => [canonicalUrl(item.url), item] as const));
  const organicUrls = new Set(organicByUrl.keys());
  const sources = [...organicByUrl.entries()].map(([url, result]) => ({
    url,
    title: result.title,
    sourceClass: sourceClass(url, new Set(official)),
  } satisfies EntityContinuitySource));
  const primaryUrls = new Set(sources.filter((source) => source.sourceClass !== "secondary").map((source) => source.url));

  const events: EntityLifecycleEvent[] = (Array.isArray(parsed.events) ? parsed.events : [])
    .map(record)
    .map((event): EntityLifecycleEvent | null => {
      const kind = validKind(event.kind);
      const sourceUrls = admittedUrls(event.sourceUrls, organicUrls);
      const title = nullableString(event.title);
      const detail = nullableString(event.detail);
      if (!kind || !title || !detail || !sourceUrls.some((url) => primaryUrls.has(url))) return null;
      return { date: nullableString(event.date), kind, title, detail, sourceUrls };
    })
    .filter((event): event is EntityLifecycleEvent => Boolean(event));

  const lineage: TokenLineageNode[] = (Array.isArray(parsed.tokenLineage) ? parsed.tokenLineage : [])
    .map(record)
    .map((node): TokenLineageNode | null => {
      const sourceUrls = admittedUrls(node.sourceUrls, organicUrls);
      const name = nullableString(node.name);
      const status = node.status === "predecessor" || node.status === "migration" || node.status === "current" ? node.status : null;
      if (!name || !status || !sourceUrls.some((url) => primaryUrls.has(url))) return null;
      return {
        name,
        ticker: nullableString(node.ticker),
        contract: nullableString(node.contract),
        chain: nullableString(node.chain),
        status,
        validFrom: nullableString(node.validFrom),
        validTo: nullableString(node.validTo),
        sourceUrls,
      };
    })
    .filter((node): node is TokenLineageNode => Boolean(node));

  if (currentToken?.contract && !lineage.some((node) => node.contract?.toLowerCase() === currentToken.contract!.toLowerCase())) {
    const currentSources = sources.filter((source) => source.sourceClass === "first_party").map((source) => source.url);
    if (currentSources.length) lineage.push({
      name: currentToken.name || subject,
      ticker: currentToken.ticker ?? null,
      contract: currentToken.contract,
      chain: currentToken.chain ?? null,
      status: "current",
      validFrom: null,
      validTo: null,
      sourceUrls: currentSources.slice(0, 2),
    });
  }

  const predecessor = lineage.find((node) => node.status === "predecessor");
  const current = lineage.find((node) => node.status === "current");
  const migration = lineage.find((node) => node.status === "migration");
  const historicalAliases = [...new Set([
    ...strings(parsed.historicalAliases),
    predecessor?.name,
    predecessor?.ticker,
  ].filter((value): value is string => Boolean(value)).map((value) => value.trim()))];
  const lifecycleFound = historicalAliases.length > 0 || events.some((event) => event.kind === "rebrand" || event.kind === "token_migration") || Boolean(predecessor);
  const hasPrimary = primaryUrls.size > 0;
  if (!lifecycleFound && !hasPrimary) return null;

  const primarySourceCount = sources.filter((source) => source.sourceClass !== "secondary").length;
  const complete = !lifecycleFound || Boolean(
    predecessor?.contract
    && current?.contract
    && nullableString(parsed.migrationRatio)
    && events.some((event) => event.kind === "rebrand")
    && events.some((event) => event.kind === "token_migration"),
  );
  return {
    subject,
    historicalAliases,
    predecessorName: nullableString(parsed.predecessorName) ?? predecessor?.name ?? null,
    oldTicker: nullableString(parsed.oldTicker) ?? predecessor?.ticker ?? null,
    oldContract: nullableString(parsed.oldContract) ?? predecessor?.contract ?? null,
    migrationRatio: nullableString(parsed.migrationRatio),
    migrationDate: nullableString(parsed.migrationDate),
    replacementContract: nullableString(parsed.replacementContract) ?? current?.contract ?? null,
    migrationContract: nullableString(parsed.migrationContract) ?? migration?.contract ?? null,
    currentStatus: nullableString(parsed.currentStatus),
    architectureChanges: strings(parsed.architectureChanges),
    exchangeHandling: strings(parsed.exchangeHandling),
    tokenLineage: lineage,
    events,
    sources,
    aliasSearches: [],
    marketHistory: lineage.filter((node): node is TokenLineageNode & { status: "predecessor" | "current" } => node.status !== "migration").map((node) => ({
      ticker: node.ticker,
      contract: node.contract,
      status: node.status,
      sourceUrls: node.sourceUrls,
    })),
    coverage: {
      required: Boolean(currentToken?.contract),
      state: complete ? "complete" : "partial",
      reason: complete
        ? "Historical aliases, migration mechanics and both sides of the token lineage were recovered from primary records."
        : "A lifecycle signal was found, but one or more predecessor, contract, migration-ratio or dated-event fields remain unresolved.",
      primarySourceCount,
      searchedAt: new Date().toISOString(),
    },
  };
}

const EXTRACTION_SYSTEM = `You extract entity and token lifecycle evidence from supplied web results. Return JSON only. Never infer a contract, ratio, date, alias, architecture change or status. Every event and tokenLineage node must include sourceUrls copied exactly from supplied pages. Prefer official project documents, official exchange notices, explorers and regulators. Secondary reporting is a lead only. Schema: {historicalAliases:string[], predecessorName:string|null, oldTicker:string|null, oldContract:string|null, migrationRatio:string|null, migrationDate:string|null, replacementContract:string|null, migrationContract:string|null, currentStatus:string|null, architectureChanges:string[], exchangeHandling:string[], tokenLineage:[{name,ticker,contract,chain,status:"predecessor"|"migration"|"current",validFrom,validTo,sourceUrls:string[]}], events:[{date,kind:"predecessor"|"rebrand"|"token_migration"|"contract_replacement"|"exchange_handling"|"architecture_change"|"current_status",title,detail,sourceUrls:string[]}]}`;

export async function collectEntityContinuity(ctx: CollectContext): Promise<EntityContinuitySnapshot> {
  const subject = ctx.evidence.projectToken?.name || ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name;
  const currentToken = ctx.evidence.projectToken ? {
    name: ctx.evidence.projectToken.name,
    ticker: ctx.evidence.projectToken.symbol,
    contract: ctx.evidence.projectToken.address,
    chain: ctx.evidence.projectToken.chain,
  } : ctx.tokenAddress ? {
    name: subject,
    ticker: ctx.tokenSymbol,
    contract: ctx.tokenAddress,
    chain: ctx.tokenChain,
  } : undefined;
  const searchedAt = new Date().toISOString();
  if (!groundedSearchProvisioned()) return {
    subject, historicalAliases: [], predecessorName: null, oldTicker: null, oldContract: null,
    migrationRatio: null, migrationDate: null, replacementContract: currentToken?.contract ?? null,
    migrationContract: null, currentStatus: null, architectureChanges: [], exchangeHandling: [], tokenLineage: [], events: [], sources: [], aliasSearches: [], marketHistory: [],
    coverage: { required: Boolean(currentToken?.contract), state: currentToken?.contract ? "unavailable" : "not_applicable", reason: "Lifecycle search requires Serper and a configured extraction model.", primarySourceCount: 0, searchedAt },
  };

  const organic: OrganicResult[] = [];
  const raw = await groundedSearch(EXTRACTION_SYSTEM, `Recover the full predecessor, rebrand, migration and contract history for ${subject}${currentToken?.ticker ? ` ($${currentToken.ticker})` : ""}. Challenge any clean-new-token framing and keep project architecture changes distinct from token price performance.`, {
    cacheKey: `entity-continuity:${subject.toLowerCase()}:${currentToken?.contract?.toLowerCase() ?? "none"}`,
    queries: buildEntityContinuityQueries(subject, currentToken?.ticker),
    onOrganicResults: (results) => organic.push(...results),
  });
  const snapshot = raw ? normalizeEntityContinuity(raw, subject, organic, officialHosts(ctx), currentToken) : null;
  if (!snapshot) return {
    subject, historicalAliases: [], predecessorName: null, oldTicker: null, oldContract: null,
    migrationRatio: null, migrationDate: null, replacementContract: currentToken?.contract ?? null,
    migrationContract: null, currentStatus: null, architectureChanges: [], exchangeHandling: [], tokenLineage: [], events: [], sources: organic.map((item) => ({ url: canonicalUrl(item.url), title: item.title, sourceClass: sourceClass(item.url, officialHosts(ctx)) })), aliasSearches: [], marketHistory: [],
    coverage: { required: Boolean(currentToken?.contract), state: currentToken?.contract ? "partial" : "not_applicable", reason: "Lifecycle searches completed but did not yield a primary-source-grounded predecessor or a verified no-predecessor record.", primarySourceCount: 0, searchedAt },
  };

  if (snapshot.historicalAliases.length) {
    const aliasOrganic: OrganicResult[] = [];
    const aliasQueries = snapshot.historicalAliases.flatMap((alias) => [
      `"${alias}" team founders leadership`,
      `"${alias}" security audit exploit incident`,
      `"${alias}" token contract market price history`,
      `"${alias}" legal regulatory governance`,
    ]).slice(0, 8);
    await groundedSearch(
      "Find primary-source records under historical project aliases. Return JSON only: {summary:string, sourceUrls:string[]}. Do not make claims without exact supplied URLs.",
      `Repeat team, security, audit, incident, legal, governance and market-history discovery for the historical aliases of ${subject}: ${snapshot.historicalAliases.join(", ")}.`,
      {
        cacheKey: `entity-continuity-aliases:${snapshot.historicalAliases.map((alias) => alias.toLowerCase()).sort().join(":")}`,
        queries: aliasQueries,
        onOrganicResults: (results) => aliasOrganic.push(...results),
      },
    );
    const urls = [...new Set(aliasOrganic.map((item) => canonicalUrl(item.url)))];
    snapshot.aliasSearches = snapshot.historicalAliases.map((alias) => ({
      alias,
      categories: ["team", "security", "market", "legal", "audit", "incident"],
      sourceUrls: urls,
    }));
    for (const result of aliasOrganic) {
      const url = canonicalUrl(result.url);
      if (!snapshot.sources.some((source) => source.url === url)) snapshot.sources.push({ url, title: result.title, sourceClass: sourceClass(url, officialHosts(ctx)) });
    }
  }
  return snapshot;
}
