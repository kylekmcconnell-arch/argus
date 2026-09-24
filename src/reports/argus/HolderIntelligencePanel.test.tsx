import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HolderIntelligencePanel } from "./HolderIntelligencePanel";
import { buildHolderIntelligence } from "../../lib/holderIntelligence";
const snapshot = buildHolderIntelligence({ chain: "base", tokenAddress: "0x1111111111111111111111111111111111111111", capturedAt: "2026-09-23", source: "fixture", ranked: true, rows: [] });
it("does not reinterpret legacy reports as completed top-25 checks", () => {
  expect(renderToStaticMarkup(<HolderIntelligencePanel />)).toContain("did not record the top-25 index check");
});
it("hides workspace history by default for shared and private report surfaces", () => {
  const html = renderToStaticMarkup(<HolderIntelligencePanel snapshot={snapshot} />);
  expect(html).not.toContain("Read workspace history");
  expect(html).toContain("collection unavailable");
  expect(html).toContain("Arkham identity coverage: not-run");
  expect(html).toContain("Fomo stored-evidence coverage: not-run");
});
it("offers explicitly requested history separately from frozen evidence", () => {
  const html = renderToStaticMarkup(<HolderIntelligencePanel snapshot={snapshot} allowHistory />);
  expect(html).toContain("Read workspace history");
  expect(html).toContain("Separate from this frozen report");
});
