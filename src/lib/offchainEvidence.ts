// Shared, server-safe provider clients for the frozen off-chain person checks.
//
// These functions deliberately separate the public API payload from provider
// attempt metadata. Existing API handlers can return `value` unchanged, while
// the core collector uses `attempts` to distinguish a valid empty result from a
// provider failure before the immutable report is published.

export type OffchainAttemptStatus = "succeeded" | "partial" | "failed";

export interface OffchainAttempt {
  provider: "google-news" | "courtlistener" | "opensanctions";
  operation: string;
  status: OffchainAttemptStatus;
  detail?: string;
}

export interface OffchainCollection<T> {
  value: T;
  attempts: OffchainAttempt[];
  status: OffchainAttemptStatus;
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string | null;
  publishedAt: number | null;
}

export interface NewsPayload {
  available: true;
  query: string;
  articles: NewsArticle[];
}

export interface NewsCollection extends OffchainCollection<NewsPayload> {
  /** Per-article match provenance kept outside the public API payload. */
  matches: Record<string, "exact_name" | "exact_handle">;
}

export interface LegalCase {
  caseName: string;
  court: string;
  date: unknown;
  docket: unknown;
  url: string | null;
  nameInCase: boolean;
}

export type LegalPayload =
  | {
      available: true;
      name: string;
      total: unknown;
      cases: LegalCase[];
      asParty: number;
    }
  | { available: false; note: string; error?: string };

export type OfacPayload =
  | {
      available: true;
      name: string;
      listSize: number;
      sanctioned: boolean;
      list: "US Treasury OFAC SDN";
    }
  | { available: false; note: string; error?: string };

export interface OfacCollection extends OffchainCollection<OfacPayload> {
  /** SHA-256 of the sorted normalized person-name index used for this screen. */
  indexHash?: string;
}

export interface OfacNameCache {
  read(): Promise<string | null>;
  write(names: string): Promise<void>;
}

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const aggregateStatus = (attempts: readonly OffchainAttempt[]): OffchainAttemptStatus => {
  if (!attempts.length) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "succeeded")) return "succeeded";
  if (attempts.every((attempt) => attempt.status === "failed")) return "failed";
  return "partial";
};

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const decode = (value: string) =>
  value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, "").trim();

const tag = (block: string, name: string): string | null => {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decode(match[1].replace(/<!\[CDATA\[|\]\]>/g, "")) : null;
};

interface ParsedNewsArticle extends NewsArticle {
  blob: string;
}

async function searchNewsPhrase(
  phrase: string,
  fetcher: Fetcher,
): Promise<{ articles: ParsedNewsArticle[]; attempt: OffchainAttempt }> {
  const scoped = `"${phrase}" (crypto OR token OR web3 OR blockchain OR NFT)`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(scoped)}&hl=en-US&gl=US&ceid=US:en`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)" },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "transport_error" },
    };
  }
  if (!response.ok) {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: `http_${response.status}` },
    };
  }

  let xml: string;
  try {
    xml = await response.text();
  } catch {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "response_text_error" },
    };
  }
  if (!/<(?:rss|feed)\b/i.test(xml) || !/<(?:channel|entry)\b/i.test(xml)) {
    return {
      articles: [],
      attempt: { provider: "google-news", operation: "rss-search", status: "failed", detail: "response_xml_error" },
    };
  }
  const items = xml.split(/<item>/).slice(1).map((block) => block.split("</item>")[0]);
  const articles = items
    .map((block): ParsedNewsArticle => {
      const rawTitle = tag(block, "title") ?? "";
      const source = tag(block, "source") ?? (rawTitle.includes(" - ") ? rawTitle.split(" - ").pop() ?? "" : "");
      const title = source && rawTitle.endsWith(` - ${source}`)
        ? rawTitle.slice(0, -(source.length + 3))
        : rawTitle;
      const link = tag(block, "link");
      const published = tag(block, "pubDate");
      const description = tag(block, "description") ?? "";
      const parsedDate = published ? Date.parse(published) : Number.NaN;
      return {
        title,
        source,
        url: link,
        publishedAt: Number.isFinite(parsedDate) ? parsedDate : null,
        blob: `${title} ${description}`.toLowerCase(),
      };
    })
    .filter((article) => Boolean(article.title && article.url));
  const invalidItems = items.length - articles.length;
  const status: OffchainAttemptStatus = invalidItems === 0
    ? "succeeded"
    : articles.length
      ? "partial"
      : "failed";

  return {
    articles,
    attempt: {
      provider: "google-news",
      operation: "rss-search",
      status,
      detail: invalidItems ? `dropped_${invalidItems}_invalid_items` : `${articles.length}_results`,
    },
  };
}

export function normalizeNewsSubject(rawName: string, rawHandle: string): {
  name: string;
  handle: string;
  phrases: string[];
} | null {
  const name = rawName
    .trim()
    .replace(/[^\p{L}\p{N}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const handleCandidate = rawHandle.trim().replace(/^@/, "");
  const handle = /^[A-Za-z0-9_]{1,30}$/.test(handleCandidate) ? handleCandidate : "";
  if (!name && !handle) return null;

  const phrases: string[] = [];
  if (name && name.split(/\s+/).length >= 2) phrases.push(name);
  if (handle) phrases.push(handle);
  if (!phrases.length && name) phrases.push(name);
  return { name, handle, phrases: [...new Set(phrases)] };
}

function containsExactPhrase(value: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, "iu").test(value);
}

export async function collectNews(
  rawName: string,
  rawHandle: string,
  fetcher: Fetcher = fetch,
): Promise<NewsCollection> {
  const subject = normalizeNewsSubject(rawName, rawHandle);
  if (!subject) throw new Error("news subject required");

  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  const attempts: OffchainAttempt[] = [];
  const matches: NewsCollection["matches"] = {};
  for (const phrase of subject.phrases) {
    const result = await searchNewsPhrase(phrase, fetcher);
    attempts.push(result.attempt);
    const normalizedPhrase = phrase.toLowerCase();
    for (const article of result.articles.filter((candidate) => containsExactPhrase(candidate.blob, normalizedPhrase))) {
      const key = (article.url ?? article.title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      matches[key] = subject.handle && normalizedPhrase === subject.handle.toLowerCase()
        ? "exact_handle"
        : "exact_name";
      articles.push({
        title: article.title,
        source: article.source,
        url: article.url,
        publishedAt: article.publishedAt,
      });
    }
  }
  articles.sort((left, right) => (right.publishedAt ?? 0) - (left.publishedAt ?? 0));
  return {
    value: {
      available: true,
      query: subject.phrases[0] ?? subject.name,
      articles: articles.slice(0, 10),
    },
    attempts,
    status: aggregateStatus(attempts),
    matches,
  };
}

export function normalizeResolvedName(value: string): string {
  return value.trim().replace(/^@/, "").slice(0, 80);
}

export function isPlausibleFullName(value: string): boolean {
  return normalizeResolvedName(value).split(/\s+/).filter(Boolean).length >= 2;
}

const normalizedWords = (value: string): string[] =>
  value
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Core findings require the whole resolved name, never a surname collision. */
export function legalCaptionHasFullName(caseName: string, resolvedName: string): boolean {
  const nameWords = normalizedWords(resolvedName);
  if (nameWords.length < 2) return false;
  const caption = ` ${normalizedWords(caseName).join(" ")} `;
  const forward = ` ${nameWords.join(" ")} `;
  const reverse = ` ${[nameWords.at(-1)!, ...nameWords.slice(0, -1)].join(" ")} `;
  return caption.includes(forward) || caption.includes(reverse);
}

const COURTLISTENER = "https://www.courtlistener.com/api/rest/v4/search/";

export async function collectLegalCases(
  rawName: string,
  fetcher: Fetcher = fetch,
): Promise<OffchainCollection<LegalPayload>> {
  const name = normalizeResolvedName(rawName);
  if (!isPlausibleFullName(name)) {
    return {
      value: { available: false, note: "Legal screen needs a resolved real name." },
      attempts: [],
      status: "succeeded",
    };
  }

  const url = `${COURTLISTENER}?q=${encodeURIComponent(`"${name}"`)}&type=r&order_by=${encodeURIComponent("dateFiled desc")}`;
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { "user-agent": "ARGUS due-diligence (contact via argus)" },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    return {
      value: { available: false, error: String(error), note: "Legal screen failed." },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: "transport_error" }],
      status: "failed",
    };
  }
  if (!response.ok) {
    return {
      value: { available: false, note: `CourtListener ${response.status}` },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: `http_${response.status}` }],
      status: "failed",
    };
  }

  let parsed: JsonRecord;
  try {
    parsed = asRecord(await response.json()) ?? {};
  } catch (error) {
    return {
      value: { available: false, error: String(error), note: "Legal screen failed." },
      attempts: [{ provider: "courtlistener", operation: "case-search", status: "failed", detail: "response_json_error" }],
      status: "failed",
    };
  }

  const resultShapeValid = Array.isArray(parsed.results);
  const rows = resultShapeValid ? parsed.results as unknown[] : [];
  let malformedRows = 0;
  // CourtListener commonly returns attorney/document matches before a named
  // party caption. Keep the full first result page so a relevant caption in a
  // later row is not silently discarded before the core full-name filter.
  const cases = rows.slice(0, 20).flatMap((candidate): LegalCase[] => {
    const row = asRecord(candidate);
    if (!row) {
      malformedRows += 1;
      return [];
    }
    const rawCaseName = typeof row.caseName === "string"
      ? row.caseName
      : typeof row.case_name_full === "string"
        ? row.case_name_full
        : "";
    const caseName = rawCaseName.trim().slice(0, 90);
    if (!caseName) {
      malformedRows += 1;
      return [];
    }
    const absoluteUrl = typeof row.docket_absolute_url === "string"
      && row.docket_absolute_url.startsWith("/")
      && !row.docket_absolute_url.startsWith("//")
      ? row.docket_absolute_url
      : null;
    const court = typeof row.court === "string"
      ? row.court
      : typeof row.court_citation_string === "string"
        ? row.court_citation_string
        : "";
    return [{
      caseName,
      court: court.slice(0, 60),
      date: row.dateFiled ?? row.dateTerminated ?? null,
      docket: row.docketNumber ?? null,
      url: absoluteUrl ? `https://www.courtlistener.com${absoluteUrl}` : null,
      nameInCase: legalCaptionHasFullName(caseName, name),
    }];
  });
  const countValid = typeof parsed.count === "number" && Number.isFinite(parsed.count) && parsed.count >= 0;
  const total = countValid
    ? Math.floor(parsed.count as number)
    : cases.length;
  const resultCountMismatch = total > 0 && rows.length === 0;
  const truncated = total > cases.length || rows.length > cases.length || (typeof parsed.next === "string" && Boolean(parsed.next));
  const value: LegalPayload = {
    available: true,
    name,
    total: parsed.count ?? cases.length,
    cases,
    asParty: cases.filter((item) => item.nameInCase).length,
  };
  const attemptStatus: OffchainAttemptStatus = !resultShapeValid || resultCountMismatch || (rows.length > 0 && cases.length === 0)
    ? "failed"
    : !countValid || malformedRows || truncated
      ? "partial"
      : "succeeded";
  const attempt: OffchainAttempt = {
    provider: "courtlistener",
    operation: "case-search",
    status: attemptStatus,
    detail: !resultShapeValid
      ? "result_shape_error"
      : resultCountMismatch
        ? "result_count_mismatch"
        : !countValid
          ? "invalid_result_count"
          : malformedRows
            ? `dropped_${malformedRows}_invalid_results`
            : truncated
              ? `${cases.length}_of_${total}_results`
              : `${cases.length}_results`,
  };
  return { value, attempts: [attempt], status: attempt.status };
}

const OFAC_SOURCE = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";
const OFAC_MIN_PERSON_NAMES = 5_000;

export const OFAC_SOURCE_URL = OFAC_SOURCE;

export function normalizeSanctionsName(value: string): string {
  return value
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(mr|mrs|ms|dr|prof|sir|dame|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstCsvFields(line: string, count: number): string[] {
  const fields: string[] = [];
  let index = 0;
  while (fields.length < count && index <= line.length) {
    let field = "";
    if (line[index] === '"') {
      index += 1;
      while (index < line.length) {
        if (line[index] === '"') {
          if (line[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        field += line[index];
        index += 1;
      }
      if (line[index] === ",") index += 1;
    } else {
      while (index < line.length && line[index] !== ",") {
        field += line[index];
        index += 1;
      }
      if (line[index] === ",") index += 1;
    }
    fields.push(field);
  }
  return fields;
}

export function parseOfacPersonNames(csv: string): Set<string> {
  const names = new Set<string>();
  const lines = csv.split("\n");
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !line.includes('"Person"')) continue;
    const [, schema, name, aliases] = firstCsvFields(line, 4);
    if (schema !== "Person") continue;
    for (const raw of [name, ...(aliases ? aliases.split(";") : [])]) {
      const normalized = normalizeSanctionsName(raw || "");
      if (normalized && normalized.includes(" ")) names.add(normalized);
    }
  }
  return names;
}

async function loadOfacNames(
  fetcher: Fetcher,
  cache?: OfacNameCache,
): Promise<{ names: Set<string>; attempts: OffchainAttempt[]; indexHash?: string }> {
  try {
    const cached = await cache?.read();
    if (cached) {
      const names = new Set(cached.split("\n").filter(Boolean));
      if (names.size >= OFAC_MIN_PERSON_NAMES) {
        return {
          names,
          attempts: [],
          indexHash: await sha256([...names].sort().join("\n")),
        };
      }
    }
  } catch {
    // Cache availability cannot change the provider result.
  }

  let response: Response;
  try {
    response = await fetcher(OFAC_SOURCE, { signal: AbortSignal.timeout(20000) });
  } catch {
    return {
      names: new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: "transport_error" }],
    };
  }
  if (!response.ok) {
    return {
      names: new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: `http_${response.status}` }],
    };
  }

  let csv: string;
  try {
    csv = await response.text();
  } catch {
    return {
      names: new Set(),
      attempts: [{ provider: "opensanctions", operation: "ofac-name-index", status: "failed", detail: "response_text_error" }],
    };
  }
  const names = parseOfacPersonNames(csv);
  const validIndex = names.size >= OFAC_MIN_PERSON_NAMES;
  const attempt: OffchainAttempt = {
    provider: "opensanctions",
    operation: "ofac-name-index",
    status: validIndex ? "succeeded" : "partial",
    detail: validIndex ? `${names.size}_names` : `undersized_index_${names.size}`,
  };
  if (validIndex) {
    try {
      await cache?.write([...names].sort().join("\n"));
    } catch {
      // Cache writes are best-effort; the observed provider result is still valid.
    }
  }
  return {
    names: validIndex ? names : new Set(),
    attempts: [attempt],
    ...(validIndex ? { indexHash: await sha256([...names].sort().join("\n")) } : {}),
  };
}

export async function collectOfacName(
  rawName: string,
  options: { fetcher?: Fetcher; cache?: OfacNameCache } = {},
): Promise<OfacCollection> {
  const name = normalizeResolvedName(rawName);
  const query = normalizeSanctionsName(name);
  if (query.split(" ").filter(Boolean).length < 2) {
    return {
      value: { available: false, note: "Sanctions screen needs a resolved real name." },
      attempts: [],
      status: "succeeded",
    };
  }

  const loaded = await loadOfacNames(options.fetcher ?? fetch, options.cache);
  if (!loaded.names.size) {
    return {
      value: { available: false, note: "OFAC SDN list unavailable." },
      attempts: loaded.attempts,
      status: aggregateStatus(loaded.attempts),
    };
  }
  const tokens = query.split(" ");
  const reversed = [tokens[tokens.length - 1], ...tokens.slice(0, -1)].join(" ");
  return {
    value: {
      available: true,
      name,
      listSize: loaded.names.size,
      sanctioned: loaded.names.has(query) || loaded.names.has(reversed),
      list: "US Treasury OFAC SDN",
    },
    attempts: loaded.attempts,
    status: aggregateStatus(loaded.attempts),
    indexHash: loaded.indexHash,
  };
}
