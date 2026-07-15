import { describe, expect, it } from "vitest";
import { collectSecurityAudits } from "./securityAudits";

const page = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

const fetcherFor = (routes: Record<string, string | number>): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return typeof body === "number" ? new Response("", { status: body }) : page(body);
      }
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

const SECURITY_PAGE = `
  <html><body>
    <h1>Security</h1>
    <p>Audited by Trail of Bits and OpenZeppelin. 65 audits total.</p>
    <a href="https://www.trailofbits.com/publications/aave-v3">Trail of Bits report</a>
    <a href="https://www.openzeppelin.com/security-audits/aave">OpenZeppelin report</a>
  </body></html>`;

describe("collectSecurityAudits (auditor-domain corroboration hop)", () => {
  it("upgrades an auditor claim only when the auditor's own page names the subject", async () => {
    const result = await collectSecurityAudits("Aave", "https://aave.com", [], {
      fetcher: fetcherFor({
        "https://aave.com/security": SECURITY_PAGE,
        "https://www.trailofbits.com/": "<html><body>Our security audit of the Aave protocol v3 covered ...</body></html>",
        // OpenZeppelin page loads but never names the subject.
        "https://www.openzeppelin.com/": "<html><body>We audit many protocols.</body></html>",
      }),
    });
    expect(result.available).toBe(true);
    expect(result.securityPageUrl).toBe("https://aave.com/security");
    expect(result.selfAttested).toEqual(expect.arrayContaining(["Trail of Bits", "OpenZeppelin"]));
    expect(result.corroborated).toHaveLength(1);
    expect(result.corroborated[0]).toMatchObject({ auditor: "Trail of Bits" });
    expect(result.corroborated[0].excerpt.toLowerCase()).toContain("aave");
  });

  it("keeps a self-attesting security page as leads only when no auditor site confirms", async () => {
    const result = await collectSecurityAudits("RugCoin", "https://rugcoin.example", [], {
      fetcher: fetcherFor({
        "https://rugcoin.example/security":
          '<html><body>Audited by Trail of Bits! <a href="https://www.trailofbits.com/">proof</a></body></html>',
        "https://www.trailofbits.com/": "<html><body>Publications about real clients only.</body></html>",
      }),
    });
    expect(result.available).toBe(true);
    expect(result.selfAttested).toEqual(["Trail of Bits"]);
    expect(result.corroborated).toEqual([]);
  });

  it("returns unavailable when no candidate page names a known auditor", async () => {
    const result = await collectSecurityAudits("Aave", "https://aave.com", [], {
      fetcher: fetcherFor({ "https://aave.com/security": "<html><body>We take security seriously.</body></html>" }),
    });
    expect(result.available).toBe(false);
    expect(result.corroborated).toEqual([]);
  });

  it("uses DeFiLlama candidate links and never throws on transport failures", async () => {
    const result = await collectSecurityAudits("Aave", undefined, ["https://aave.com/security"], {
      fetcher: fetcherFor({
        "https://aave.com/security": SECURITY_PAGE,
        "https://www.trailofbits.com/": 503,
        "https://www.openzeppelin.com/": 503,
      }),
    });
    expect(result.available).toBe(true);
    expect(result.corroborated).toEqual([]);
    expect(result.selfAttested.length).toBeGreaterThan(0);
  });

  it("never corroborates from an incident writeup on the auditor's site", async () => {
    const result = await collectSecurityAudits("RugCoin", "https://rugcoin.example", [], {
      fetcher: fetcherFor({
        "https://rugcoin.example/security":
          '<html><body>Audited by Trail of Bits. <a href="https://www.trailofbits.com/blog/rugcoin">see</a></body></html>',
        "https://www.trailofbits.com/":
          "<html><body>Postmortem: how the RugCoin exploit drained $40M from users.</body></html>",
      }),
    });
    expect(result.available).toBe(true);
    expect(result.corroborated).toEqual([]);
    expect(result.selfAttested).toEqual(["Trail of Bits"]);
  });

  it("mints one corroboration per auditor page even when sister brands share it", async () => {
    const shared = '<html><body>Security. Spearbit and Cantina engaged. ' +
      '<a href="https://cantina.xyz/competitions/aave-v3">report</a></body></html>';
    const result = await collectSecurityAudits("Aave", "https://aave.com", [], {
      fetcher: fetcherFor({
        "https://aave.com/security": shared,
        "https://cantina.xyz/": "<html><body>Aave V3 competition: security review results.</body></html>",
      }),
    });
    expect(result.corroborated).toHaveLength(1);
  });
});
