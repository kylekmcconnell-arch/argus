import { describe, it, expect } from "vitest";
import { reciprocalTokenProof } from "./accountTokenBinding";
import type { PublicTextDocument } from "./publicWeb";
const address = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const doc = (text: string): PublicTextDocument => ({status:"ok",url:"https://example.com",host:"example.com",text,contentHash:"hash",capturedAt:"2026-09-10",contentType:"text/html"});
describe("reciprocal exact-chain account binding",()=>{
 it("accepts an exact account and explorer contract published on the account-linked domain",()=>{expect(reciprocalTokenProof(doc(`<a href="https://x.com/example">X</a><a href="https://basescan.org/token/${address}">Token</a>`),"https://example.com","example",address,"base")).toMatchObject({contentHash:"hash"});});
 it.each([`https://x.com/example_other`, `https://x.com/example/status/123`, `https://x.com.evil.org/example`])("rejects an inexact reciprocal account %s",url=>{expect(reciprocalTokenProof(doc(`${url} https://basescan.org/token/${address}`),"https://example.com","example",address,"base")).toBeNull();});
 it("rejects wrong chain, changed host and bare-address mentions",()=>{
  expect(reciprocalTokenProof(doc(`https://x.com/example https://etherscan.io/token/${address}`),"https://example.com","example",address,"base")).toBeNull();
  expect(reciprocalTokenProof(doc(`https://x.com/example https://basescan.org/token/${address}`),"https://other.com","example",address,"base")).toBeNull();
  expect(reciprocalTokenProof(doc(`https://x.com/example ${address}`),"https://example.com","example",address,"base")).toBeNull();
 });
});
