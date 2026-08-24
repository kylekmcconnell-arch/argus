import { describe, expect, it } from "vitest";

import { drainerHit } from "./site-safety";

// Regression: kupo.gg (a legit BNKR-ecosystem trading terminal with an embedded
// self-custody wallet) was flagged as a drainer because its inlined JS i18n
// bundle contains "Recovery phrase (12 words)" and "Export Private Key / Never
// share this". Those are wallet-management + safety copy, not a phishing ask.
describe("drainerHit - visible-text, ask-gated", () => {
  it("does NOT flag a wallet terminal's i18n bundle strings (kupo.gg repro)", () => {
    const body = `<!doctype html><title>Kupo | Pulse</title>
      <div id="root"></div>
      <script>window.__I18N__={"walletManager.newAddress":"New address",
        "walletManager.recoveryPhrase":"Recovery phrase (12 words)",
        "walletManager.generateWallet":"Generate wallet",
        "exportKey.title":"Export Private Key",
        "exportKey.warning":"Never share this with anyone. It controls your wallet."}</script>`;
    expect(drainerHit(body)).toBe(false);
  });

  it("does NOT flag visible self-custody safety copy", () => {
    const body = `<main><h1>Your keys, your coins</h1>
      <p>Kupo never asks for your seed phrase. Export your private key and keep it offline.</p>
      <p>Write down your 12 words and store them safely.</p></main>`;
    expect(drainerHit(body)).toBe(false);
  });

  it("DOES flag a real phishing ask (enter your seed phrase to continue)", () => {
    const body = `<main><h2>Wallet validation required</h2>
      <label>Enter your 12-word secret recovery phrase to continue</label>
      <input name="phrase"/></main>`;
    expect(drainerHit(body)).toBe(true);
  });

  it("DOES flag 'paste your private key to restore'", () => {
    const body = `<form><p>Paste your private key to restore access to your funds.</p></form>`;
    expect(drainerHit(body)).toBe(true);
  });

  it("DOES flag a wallet-compromised scare banner", () => {
    const body = `<div>Warning: your wallet has been flagged. Verify now to avoid suspension.</div>`;
    expect(drainerHit(body)).toBe(true);
  });

  it("DOES flag a named drainer kit fingerprint", () => {
    // named-kit tell lives in visible text after strip? keep it visible too:
    const visible = `<h1>inferno drainer</h1>`;
    expect(drainerHit(visible)).toBe(true);
  });

  it("still needs TWO weak tells to flag", () => {
    expect(drainerHit(`<p>verify your wallet</p>`)).toBe(false);
    expect(drainerHit(`<p>verify your wallet and claim your airdrop</p>`)).toBe(true);
  });
});
