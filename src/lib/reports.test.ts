import { describe, it, expect } from "vitest";
import { entityKey, groupReportsByEntity, type ReportListing } from "./reports";

const R = (kind: ReportListing["kind"], ref: string, query?: string, verdict?: string, score?: number): ReportListing =>
  ({ kind, ref, query, verdict, score });

describe("entityKey", () => {
  it("keys token/investigation by the $SYMBOL query, person/site by ref", () => {
    expect(entityKey(R("token", "0xabc123", "$RECC"))).toBe("recc");
    expect(entityKey(R("investigation", "0xabc123", "$RECC"))).toBe("recc");
    expect(entityKey(R("person", "@reccfinance"))).toBe("reccfinance");
    expect(entityKey(R("site", "https://recc.finance/team"))).toBe("recc.finance");
  });
});

describe("groupReportsByEntity", () => {
  // Resolver stand-in for buildAliasResolver: the audits' edges unioned the token
  // ($RECC -> recc), its handle and its domain onto one canonical id.
  const resolve = (k: string) => (["recc", "reccfinance", "recc.finance"].includes(k) ? "recc" : k);

  it("collapses the token, person, and site audits of one project into a single group", () => {
    const reports = [
      R("token", "0xabc", "$RECC", "AVOID", 22),
      R("person", "@reccfinance", "@reccfinance", "CAUTION", 55),
      R("site", "recc.finance", "recc.finance", "PASS", 70),
    ];
    const groups = groupReportsByEntity(reports, resolve);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((r) => r.kind).sort()).toEqual(["person", "site", "token"]);
  });

  it("keeps unrelated audits as their own single-report groups", () => {
    const reports = [
      R("token", "0xabc", "$RECC"),
      R("person", "@someoneelse"),
      R("token", "0xdef", "$OTHER"),
    ];
    const groups = groupReportsByEntity(reports, resolve);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it("preserves newest-first input order across groups", () => {
    const reports = [
      R("person", "@newest"),
      R("token", "0xabc", "$RECC"),
      R("site", "recc.finance"), // joins the $RECC group, doesn't jump ahead
      R("token", "0xold", "$OLDEST"),
    ];
    const groups = groupReportsByEntity(reports, resolve);
    // order: @newest group, then the recc group (first seen at index 1), then $OLDEST
    expect(groups.map((g) => entityKey(g[0]))).toEqual(["newest", "recc", "oldest"]);
    expect(groups[1]).toHaveLength(2); // token + site unified
  });
});
