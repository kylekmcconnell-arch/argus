// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../reports/argus/__fixtures__/altcoinist-v4.json";
import type { ThreatScan } from "../threat/types";
const mocks = vi.hoisted(() => ({ threatScan:vi.fn(), aiCodeRead:vi.fn(), behindLedger:vi.fn(), sharedReceiptStats:vi.fn() }));
vi.mock("../threat/scan", () => ({threatScan:mocks.threatScan}));
vi.mock("../threat/codereview", () => ({aiCodeRead:mocks.aiCodeRead}));
vi.mock("../threat/behindledger", () => ({behindLedger:mocks.behindLedger}));
vi.mock("../threat/receipts", () => ({receiptStats:()=>({flagged:0,checked:0,confirmedDead:0}),sharedReceiptStats:mocks.sharedReceiptStats}));
import { ThreatReport, EmbeddedThreatScan, ProjectMarketIntelligence } from "./ThreatScanPage";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root, element:HTMLDivElement;
const scan = fixture.payload.threat as unknown as ThreatScan;
beforeEach(()=>{element=document.createElement("div");document.body.append(element);root=createRoot(element);vi.clearAllMocks();});
afterEach(()=>{act(()=>root.unmount());element.remove();vi.unstubAllGlobals();});
it("renders frozen embedded checks without live providers or duplicate report actions",async()=>{
  const request=vi.fn().mockRejectedValue(new Error("Unexpected request"));vi.stubGlobal("fetch",request);
  await act(async()=>{root.render(<ThreatReport scan={scan} embedded />);});
  expect(element.textContent).toContain("Contract risk evidence");
  expect(element.textContent).not.toContain("export PDF");
  expect(mocks.aiCodeRead).not.toHaveBeenCalled();expect(mocks.behindLedger).not.toHaveBeenCalled();expect(mocks.sharedReceiptStats).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
});
it("keeps project market evidence frozen until supplemental reads are explicitly enabled",async()=>{
  await act(async()=>{root.render(<ProjectMarketIntelligence scan={scan} />);});
  expect(mocks.behindLedger).not.toHaveBeenCalled();
  expect(element.textContent).not.toContain("run detection");
});
it("rejects a cached scan on the wrong chain and preserves the requested chain on fallback",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({hit:true,scan:{...scan,chain:"ethereum"}}))));
  mocks.threatScan.mockResolvedValue(null);
  await act(async()=>{root.render(<EmbeddedThreatScan address={scan.address} chain="base"/>);});
  expect(mocks.threatScan).toHaveBeenCalledWith(expect.objectContaining({chain:"base",ref:scan.address}),expect.any(Function));
  expect(element.textContent).toContain("unavailable");
});
