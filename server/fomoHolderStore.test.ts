import { afterEach, expect, it, vi } from "vitest";
vi.mock("../api/_auth.js",()=>({serviceCredentials:()=>({url:"https://storage.example",key:"fixture"}),serviceHeaders:()=>({})}));
import { importFomoWalletSweep, readStoredFomo } from "./fomoHolderStore";
const address="0x1111111111111111111111111111111111111111";
const generatedAt="2026-09-24T00:00:00Z";
const row={chain:"base",address,state:"hit",fomo:{id:"one",handle:"trader",evmAddress:address}};
const sweep=(rows:unknown[])=>JSON.stringify({generatedAt,rows});
afterEach(()=>vi.useRealTimers());
it("imports only exact wallet receipts and hashes the original receipt",()=>{
  const result=importFomoWalletSweep(sweep([row,{...row,state:"budget"}]),Date.parse(generatedAt));
  expect(result).toHaveLength(1); expect(result[0]).toMatchObject({chain:"base",address,state:"reported",label:"trader"});
  expect(result[0].receiptHash).toHaveLength(64);
  for(const bad of [{...row,chain:"evm"},{...row,address:"0x2222222222222222222222222222222222222222"},{state:"hit",handle:"trader"}]) expect(()=>importFomoWalletSweep(sweep([bad]),Date.parse(generatedAt))).toThrow();
});
it("rejects duplicates, future receipts, and changed Solana case",()=>{
  expect(()=>importFomoWalletSweep(sweep([row,row]),Date.parse(generatedAt))).toThrow();
  expect(()=>importFomoWalletSweep(sweep([row]),0)).toThrow();
  const sol="So11111111111111111111111111111111111111112";
  expect(()=>importFomoWalletSweep(sweep([{chain:"solana",address:sol,state:"hit",fomo:{id:"one",handle:"trader",solanaAddress:sol.toLowerCase()}}]),Date.parse(generatedAt))).toThrow();
});
it("reads only the current workspace and requested chain, retaining original observation dates",async()=>{
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  const observation=importFomoWalletSweep(sweep([row]))[0];
  const db={organization_id:"org-a",chain:row.chain,address,captured_at:generatedAt,source_url:observation.sourceUrl,receipt_hash:observation.receiptHash,state:"reported",label:"trader"};
  const request=vi.fn(async(_url: string | URL | Request, _init?: RequestInit)=>new Response(JSON.stringify([db])));
  const result=await readStoredFomo("org-a","base",[address],request);
  expect(result.rows[0].capturedAt).toBe(generatedAt);
  const url=new URL(request.mock.calls[0][0]); expect(url.searchParams.get("organization_id")).toBe("eq.org-a"); expect(url.searchParams.get("chain")).toBe("eq.base");
  expect((await readStoredFomo("org-b","base",[address],request)).state).toBe("unavailable");
});
it("missing organization makes no storage request; failure cannot masquerade as a miss",async()=>{
  const request=vi.fn(async()=>new Response("{}",{status:503}));
  expect((await readStoredFomo(undefined,"base",[address],request)).state).toBe("not-configured"); expect(request).not.toHaveBeenCalled();
  expect((await readStoredFomo("one","base",[address],request)).state).toBe("unavailable");
});
