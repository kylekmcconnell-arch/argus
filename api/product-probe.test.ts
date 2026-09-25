import { describe, expect, it } from "vitest";

import { probeText } from "./product-probe";

// Shape of the $HADES front-end (hades.exchange, 2026-09-24): a React client
// for Houdini Swap on a Railway backend, sold as original engineering.
const HTML = `<html><head><title>Hades - Private Gates. Unseen</title><script src="/assets/index-YHk1MDq3.js"></script></head>
<body><h1>Privacy is a Human Right.</h1><p>Securely move assets across different chains and addresses. Privately.</p>
<p>Built by the OGs growing up on tors and onions, not the corposlop we have now. True privacy, built by true cypherpunks.</p></body></html>`;
const BUNDLE = `const ow="https://hades-api-production.up.railway.app".replace(/\\/$/,"");if(e!=="HOUDINI_AMOUNT_BELOW_MINIMUM")return null;
e.code==="HOUDINI_TRANSFER_NOT_FOUND"?localStorage.removeItem(Qw):ie(pT(e));pw({fromTokenId:l.id,toTokenId:d.id,amount:h,useXmr:y})`;

describe("product probe", () => {
  it("names the provider behind a white-label privacy front-end and quotes the originality claims", () => {
    const r = probeText("https://hades.exchange/", HTML, [BUNDLE]);
    expect(r.privacyProduct).toBe(true);
    expect(r.read).toBe("white-label");
    expect(r.providers.map((p) => p.name)).toEqual(["Houdini Swap"]);
    expect(r.providers[0].evidence).toContain("HOUDINI_AMOUNT_BELOW_MINIMUM");
    expect(r.paasHosts).toEqual(["hades-api-production.up.railway.app"]);
    expect(r.originalityClaims.join(" ")).toMatch(/cypherpunks/);
    expect(r.contractsInApp).toBe(0);
    expect(r.note).toMatch(/client for Houdini Swap/);
    expect(r.note).toMatch(/copy claims original engineering/);
  });

  it("reads a client that carries its own contracts and no provider as self-hosted", () => {
    const bundle = `const POOL="0x1234567890abcdef1234567890abcdef12345678";const VAULT="0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";fetch("https://quotes.exampleapi.net/quote")`;
    const r = probeText("https://example.org/", `<html><script src="/app.js"></script><body>Private swaps</body></html>`, [bundle]);
    expect(r.read).toBe("self-hosted");
    expect(r.contractsInApp).toBe(2);
    expect(r.providers).toEqual([]);
    expect(r.backendHosts).toEqual(["quotes.exampleapi.net"]);
  });

  it("does not read a privacy word in the copy as a provider, and an unreadable bundle as anything", () => {
    const r = probeText("https://example.org/", `<html><body>We are a mixer alternative with stealth addresses.</body></html>`, []);
    expect(r.privacyProduct).toBe(true);
    expect(r.read).toBe("unknown");
    expect(r.providers).toEqual([]);
    expect(r.note).toMatch(/No readable application bundle/);
  });

  it("is not a privacy product when neither page nor copy sells privacy", () => {
    const r = probeText("https://example.org/", `<html><body>A meme coin for frogs.</body></html>`, ["console.log(1)"]);
    expect(r.privacyProduct).toBe(false);
    expect(r.read).toBe("unknown");
  });
});
