// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { Recon } from "../collect/recon";
import { reconReportText } from "../lib/reconReportText";

const snapshotVersionId = "00000000-0000-4000-8000-000000000255";

function recon(): Recon {
  return {
    retrieval: { url: "https://argus.example/path", status: "rendered" },
    title: "Argus Example",
    identityLine: "A named project site was retrieved.",
    verdict: { verdict: "PASS", score: 84, reasons: [], capApplied: null },
  } as unknown as Recon;
}

describe("site recon copied evidence links", () => {
  it("links an immutable snapshot to the exact version and labels it accurately", () => {
    const text = reconReportText(recon(), { reportVersionId: snapshotVersionId, version: 4 }, "https://argus.test");

    expect(text).toContain(`https://argus.test/?version=${snapshotVersionId}`);
    expect(text).toContain("ARGUS saved report v4");
    expect(text).not.toContain("?site=");
    expect(text).not.toContain("audited live");
  });

  it("labels a private unsaved recon without implying persistence", () => {
    const text = reconReportText(recon(), { privateSession: true }, "https://argus.test");

    expect(text).not.toContain("?site=");
    expect(text).not.toContain("https://argus.test/");
    expect(text).toContain("private / not saved");
  });
});
