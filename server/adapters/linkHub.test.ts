import { describe, expect, it } from "vitest";
import { isLinkHubUrl, resolveLinkHubWebsite } from "./linkHub";

const page = (text: string) => ({ status: "ok", text });
const stub = (pages: Record<string, { status: string; text?: string }>) =>
  async (url: string) => pages[url] ?? { status: "failed" };

describe("isLinkHubUrl", () => {
  it("recognizes link aggregator hosts and nothing else", () => {
    expect(isLinkHubUrl("https://linktr.ee/orbitgroup_ai")).toBe(true);
    expect(isLinkHubUrl("https://linktr.ee/")).toBe(true);
    expect(isLinkHubUrl("https://beacons.ai/someone")).toBe(true);
    expect(isLinkHubUrl("https://orbitgroup.ai")).toBe(false);
    expect(isLinkHubUrl("not a url")).toBe(false);
    expect(isLinkHubUrl(undefined)).toBe(false);
  });
});

describe("resolveLinkHubWebsite", () => {
  const hubText = [
    "Orbit links",
    "https:\\/\\/x.com\\/orbitgroup_ai",
    "https:\\/\\/orbitgroup.ai\\/launch",
    "https://discord.gg/orbit",
    "https://dexscreener.com/base/0xabc",
  ].join(" ");
  const siteText = "Orbit. Burn-rate-based fundraising. Follow https://x.com/orbitgroup_ai";

  it("dereferences a bare hub root through /<handle> and verifies the backlink both ways", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page(hubText),
      "https://orbitgroup.ai/": page(siteText),
    }));
    expect(resolved).toEqual({
      website: "https://orbitgroup.ai/",
      hubUrl: "https://linktr.ee/orbitgroup_ai",
    });
  });

  it("uses a stated hub path as-is", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/orbitgroup_ai", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page(hubText),
      "https://orbitgroup.ai/": page(siteText),
    }));
    expect(resolved?.website).toBe("https://orbitgroup.ai/");
  });

  it("rejects a hub page that does not link the audited handle", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page("https://x.com/someoneelse https://orbitgroup.ai/"),
    }));
    expect(resolved).toBeNull();
  });

  it("fails closed when several external sites qualify and none match the brand stem", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page(
        "https://x.com/orbitgroup_ai https://shop.example https://blogplace.example",
      ),
    }));
    expect(resolved).toBeNull();
  });

  it("prefers the unique brand-stem match over other external links", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page(
        "https://x.com/orbitgroup_ai https://orbitgroup.ai/home https://merchstore.example/orbit",
      ),
      "https://orbitgroup.ai/": page(siteText),
    }));
    expect(resolved?.website).toBe("https://orbitgroup.ai/");
  });

  it("rejects a candidate site that never links the handle back", async () => {
    const resolved = await resolveLinkHubWebsite("https://linktr.ee/", "@orbitgroup_ai", stub({
      "https://linktr.ee/orbitgroup_ai": page(hubText),
      "https://orbitgroup.ai/": page("A page with no social links at all."),
    }));
    expect(resolved).toBeNull();
  });

  it("returns null for a non-hub website", async () => {
    expect(await resolveLinkHubWebsite("https://orbitgroup.ai", "@orbitgroup_ai", stub({}))).toBeNull();
  });
});
