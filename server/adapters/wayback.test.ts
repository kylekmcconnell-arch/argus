// The archive exists to hold what a live page no longer shows. These tests pin
// the consequence: a name scrubbed from a team page is absent from the NEWEST
// capture by definition, so reading only the newest capture is reading the one
// page guaranteed to have lost the evidence.
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCost, withCostLedger } from "../cost";
import { archiveCorroborationLabels, archivedAffiliation } from "./wayback";

const CDX = "https://web.archive.org/cdx/search/cdx";
const HEADER = ["urlkey", "timestamp", "original", "mimetype", "statuscode", "digest", "length"];

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/**
 * A fake archive: which capture timestamps exist per path, and what each capture
 * said. A numeric page value stands for an HTTP failure on that capture.
 */
function archive(index: Record<string, string[]>, pages: Record<string, string | number>) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith(CDX)) {
      const target = new URL(url).searchParams.get("url") ?? "";
      const stamps = index[target] ?? [];
      return json([
        HEADER,
        ...stamps.map((ts) => [`org,example)/`, ts, `https://${target}`, "text/html", "200", `d${ts}`, "100"]),
      ]);
    }
    const ts = url.match(/\/web\/(\d{14})id_\//)?.[1] ?? "";
    const page = pages[ts];
    if (typeof page === "number") return html("archive error", page);
    return html(page ?? "");
  });
}

const roster = "<h2>Our Team</h2><p>Kyle McConnell, Founder of Example</p>";
const scrubbed = "<h2>Our Team</h2><p>Example is hiring.</p>";

function snapshotTimestamps(fetchMock: ReturnType<typeof archive>): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input).match(/\/web\/(\d{14})id_\//)?.[1])
    .filter((ts): ts is string => Boolean(ts));
}

describe("archived affiliation across the capture history", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("finds a tie that only the older captures still show, and dates the disappearance", async () => {
    const fetchMock = archive(
      { "example.org/team": ["20180301120000", "20200301120000", "20220301120000", "20240301120000"] },
      {
        "20180301120000": roster,
        "20200301120000": roster,
        "20220301120000": scrubbed,
        "20240301120000": scrubbed,
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    // The newest capture no longer names him. The 2020 capture does, and that is
    // the whole point of asking an archive anything.
    expect(result).toMatchObject({ where: "team", year: "2020" });
    expect(result?.url).toContain("20200301120000");
    expect(result?.disappearance).toMatchObject({
      lastSeen: "2020-03-01",
      newestChecked: "2024-03-01",
      capturesChecked: 4,
    });
    // Both dates are reported, and the inference is not.
    expect(result?.disappearance?.note).toContain("2020-03-01");
    expect(result?.disappearance?.note).toContain("2024-03-01");
    expect(result?.disappearance?.note).not.toMatch(/\b(removed|scrubbed|resigned|no longer works|was fired)\b/i);
  });

  it("does not report a disappearance when the newest capture still names both", async () => {
    const fetchMock = archive(
      { "example.org/team": ["20180301120000", "20200301120000", "20220301120000", "20240301120000"] },
      {
        "20180301120000": roster,
        "20200301120000": roster,
        "20220301120000": roster,
        "20240301120000": roster,
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    expect(result).toMatchObject({ where: "team", year: "2024" });
    expect(result?.disappearance).toBeUndefined();
    // A page that scrubbed nothing costs exactly what it cost before: one read.
    // Only a silent newest capture buys the walk back through the history.
    expect(snapshotTimestamps(fetchMock)).toEqual(["20240301120000"]);
  });

  it("does not report a disappearance when the newest capture could not be read", async () => {
    // An unread capture is not measured. It cannot support "and then he was gone".
    const fetchMock = archive(
      { "example.org/team": ["20180301120000", "20200301120000", "20220301120000", "20240301120000"] },
      {
        "20180301120000": roster,
        "20200301120000": roster,
        "20220301120000": scrubbed,
        "20240301120000": 503,
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await archivedAffiliation("example.org", "Kyle McConnell", "Example"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ where: "team", year: "2020" });
    expect(captured.result?.disappearance).toBeUndefined();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "wayback",
      op: "snapshot-fetch",
      calls: 4,
      failed: 1,
      meta: expect.stringContaining("http_503"),
    }));
  });

  it("samples a bounded spread of a long history, always including the oldest capture", async () => {
    const stamps = ["2013", "2014", "2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]
      .map((y) => `${y}0301120000`);
    const pages = Object.fromEntries(stamps.map((ts) => [ts, ts.startsWith("2013") ? roster : scrubbed]));
    const fetchMock = archive({ "example.org/team": stamps }, pages);
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    const read = snapshotTimestamps(fetchMock);
    expect(read.length).toBeLessThanOrEqual(4); // bounded: twelve years of captures cost a fixed handful
    expect(read).toContain("20130301120000"); // the oldest, where a scrubbed name survives
    expect(read).toContain("20240301120000"); // and the newest, so the comparison is real
    expect(result).toMatchObject({ year: "2013" });
    expect(result?.disappearance).toMatchObject({ lastSeen: "2013-03-01", newestChecked: "2024-03-01" });
  });

  it("asks the index for one capture per year using a single collapse field", async () => {
    // Verified against the live CDX endpoint: it honours the FIRST collapse field
    // and silently ignores any others, so pairing this with collapse=digest hands
    // back the entire unbounded index and the year bound quietly does nothing.
    const fetchMock = archive({ "example.org/team": ["20200301120000"] }, { "20200301120000": roster });
    vi.stubGlobal("fetch", fetchMock);

    await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    const cdxUrl = String(fetchMock.mock.calls[0][0]);
    expect(cdxUrl.match(/collapse=/g) ?? []).toHaveLength(1);
    expect(cdxUrl).toContain("collapse=timestamp:4");
  });

  it("uses Arquivo.pt when Wayback is unavailable and does not publish a recovered outage", async () => {
    const timestamp = "20200301120000";
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith(CDX)) throw new TypeError("network unavailable");
      if (url.startsWith("https://arquivo.pt/wayback/cdx")) {
        return new Response(`${JSON.stringify({ timestamp, url: "https://example.org/team", status: "200" })}\n`, {
          status: 200,
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      if (url.startsWith("https://arquivo.pt/wayback/")) return html(roster);
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await archivedAffiliation("example.org", "Kyle McConnell", "Example"),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ provider: "arquivo", year: "2020", where: "team" });
    expect(captured.result?.url).toContain("arquivo.pt/wayback/20200301120000/");
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "wayback",
      op: "cdx-search",
      status: "partial",
      failed: 0,
      meta: "recovered_by_arquivo_after_transport_error",
    }));
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "arquivo",
      op: "snapshot-fetch",
      status: "succeeded",
      meta: "subject_and_venture_match",
    }));
  });

  it("falls back to /about and still reads its older captures", async () => {
    const fetchMock = archive(
      {
        "example.org/team": [],
        "example.org/about": ["20190301120000", "20240301120000"],
      },
      { "20190301120000": roster, "20240301120000": scrubbed },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    expect(result).toMatchObject({ where: "about", year: "2019" });
    expect(result?.disappearance?.note).toContain("about");
  });

  it("still returns nothing when no sampled capture names both the subject and the venture", async () => {
    const fetchMock = archive(
      {
        "example.org/team": ["20180301120000", "20240301120000"],
        "example.org/about": ["20200301120000"],
      },
      {
        "20180301120000": "<p>Kyle McConnell joined an unrelated startup.</p>",
        "20240301120000": scrubbed,
        "20200301120000": scrubbed,
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    expect(result).toBeNull();
  });
});

// The corroboration line orchestrate records. It lives beside the sampler so the
// wording cannot outrun what the sampler actually read.
describe("archive corroboration labels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("records the dated absence alongside the corroboration, without inferring a departure", async () => {
    const fetchMock = archive(
      { "example.org/team": ["20200301120000", "20240301120000"] },
      { "20200301120000": roster, "20240301120000": scrubbed },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));
    const labels = archiveCorroborationLabels(result!);

    expect(labels[0]).toBe("archived team page (2020)");
    // The second label is the fact the sampler established: which capture was
    // read and found silent. Never that the person left.
    expect(labels[1]).toContain("2024-03-01");
    expect(labels[1]).toContain("most recent one read");
    expect(labels.join(" ")).not.toMatch(/\b(left|departed|resigned|removed|no longer)\b/i);
  });

  it("says nothing extra when the newest capture still names both", async () => {
    const fetchMock = archive(
      { "example.org/team": ["20200301120000", "20240301120000"] },
      { "20200301120000": roster, "20240301120000": roster },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(() => archivedAffiliation("example.org", "Kyle McConnell", "Example"));

    // No disappearance was measured, so no second clause is invented for it.
    expect(archiveCorroborationLabels(result!)).toEqual(["archived team page (2024)"]);
  });
});
