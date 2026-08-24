import { describe, expect, it, vi } from "vitest";
import { getCost, providerFailureLines, withCostLedger } from "../cost";
import {
  collectDomainRegistration,
  deriveLaunchWindow,
  monthsBetween,
  registrationEventDate,
  resolveDomainScope,
} from "./domainAge";

const rdap = (events: Array<{ eventAction: string; eventDate: string }>) => ({
  ok: true,
  status: 200,
  json: async () => ({ events }),
}) as Response;

const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("registrationEventDate", () => {
  it("takes the registration event and ignores transfers and expirations", () => {
    // The shape venice.ai actually returns.
    expect(registrationEventDate([
      { eventAction: "transfer", eventDate: "2025-04-30T22:59:37.435Z" },
      { eventAction: "expiration", eventDate: "2027-04-15T00:11:31Z" },
      { eventAction: "registration", eventDate: "2019-04-15T00:11:31Z" },
      { eventAction: "last changed", eventDate: "2025-05-09T13:00:48.624Z" },
    ])).toBe("2019-04-15T00:11:31Z");
    expect(registrationEventDate([{ eventAction: "expiration", eventDate: "2027-01-01" }])).toBeNull();
    expect(registrationEventDate(undefined)).toBeNull();
  });
});

describe("resolveDomainScope", () => {
  it("reduces a hostname to the name a registry actually sells", () => {
    // app.uniswap.org is the live case: the .org registry answers this one 400.
    expect(resolveDomainScope("https://app.uniswap.org/#/swap")).toMatchObject({
      hostname: "app.uniswap.org",
      registrable: "uniswap.org",
    });
    expect(resolveDomainScope("docs.example.com")).toMatchObject({ registrable: "example.com" });
    expect(resolveDomainScope("https://www.venice.ai/about")).toMatchObject({
      hostname: "venice.ai",
      registrable: "venice.ai",
    });
    expect(resolveDomainScope("uniswap.org:443")).toMatchObject({ registrable: "uniswap.org" });
  });

  it("stops one label deeper under a suffix registries sell at the third level", () => {
    expect(resolveDomainScope("https://docs.example.co.uk/guide")).toMatchObject({ registrable: "example.co.uk" });
    expect(resolveDomainScope("shop.example.com.au")).toMatchObject({ registrable: "example.com.au" });
    // The suffix itself is nobody's registration.
    expect(resolveDomainScope("co.uk")).toMatchObject({ registrable: null });
  });

  it("refuses to hand a hosting platform's registration to the project on it", () => {
    expect(resolveDomainScope("https://someproject.github.io/docs")).toMatchObject({
      hostname: "someproject.github.io",
      registrable: null,
      sharedHost: "github.io",
    });
    expect(resolveDomainScope("someproject.vercel.app")).toMatchObject({ sharedHost: "vercel.app" });
  });

  it("has nothing to query for a bare label or an address", () => {
    expect(resolveDomainScope("localhost")).toMatchObject({ registrable: null });
    expect(resolveDomainScope("203.0.113.10")).toMatchObject({ registrable: null });
    expect(resolveDomainScope(null)).toMatchObject({ hostname: "", registrable: null });
  });
});

describe("collectDomainRegistration", () => {
  it("follows redirects and reports the registration date and age", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return rdap([{ eventAction: "registration", eventDate: "2019-04-15T00:11:31Z" }]);
    });
    const outcome = await collectDomainRegistration("https://www.venice.ai/about", fetchMock as unknown as typeof fetch, new Date("2026-07-27T00:00:00Z"));

    expect(outcome).toMatchObject({
      available: true,
      value: { domain: "venice.ai", registeredAt: "2019-04-15T00:11:31Z", ageMonths: 87 },
    });
    // rdap.org redirects to the authoritative registry; without this the lookup fails.
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "follow" });
  });

  it("asks the registry about the registrable domain and still names the subdomain", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return rdap([{ eventAction: "registration", eventDate: "2018-11-26T05:33:07.549Z" }]);
    });
    const outcome = await collectDomainRegistration(
      "https://app.uniswap.org/#/swap",
      fetchMock as unknown as typeof fetch,
      new Date("2026-08-01T00:00:00Z"),
    );

    // Live RDAP answers app.uniswap.org with 400 and uniswap.org with 200.
    // .org hits PIR first; rdap.org remains the bootstrap fallback.
    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect([
      "https://rdap.publicinterestregistry.org/rdap/domain/uniswap.org",
      "https://rdap.org/domain/uniswap.org",
    ]).toContain(requested);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "follow" });
    expect(outcome).toMatchObject({
      available: true,
      value: { domain: "uniswap.org", hostname: "app.uniswap.org", registeredAt: "2018-11-26T05:33:07.549Z" },
    });
  });

  it("still ages a domain when rdap.org hangs and the TLD registry answers", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: "follow" });
      const href = String(url);
      if (href.includes("rdap.org")) throw timeoutError();
      if (href.includes("rdap.publicinterestregistry.org/rdap/domain/dynexcoin.org")) {
        return rdap([{ eventAction: "registration", eventDate: "2021-09-07T00:00:00Z" }]);
      }
      throw new Error(`unexpected url ${href}`);
    });
    const outcome = await collectDomainRegistration(
      "https://dynexcoin.org",
      fetchMock as unknown as typeof fetch,
      new Date("2026-08-17T00:00:00Z"),
    );

    expect(outcome).toMatchObject({
      available: true,
      value: { domain: "dynexcoin.org", registeredAt: "2021-09-07T00:00:00Z" },
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("rdap.publicinterestregistry.org"))).toBe(true);
  });

  it("records timeout rather than a generic transport error when every RDAP hop times out", async () => {
    const cost = await withCostLedger(async () => {
      const outcome = await collectDomainRegistration(
        "https://dynexcoin.org",
        (async () => { throw timeoutError(); }) as unknown as typeof fetch,
      );
      expect(outcome).toMatchObject({ available: false, reason: "unavailable" });
      expect((outcome as { note: string }).note).toMatch(/timed out/i);
      return getCost();
    });

    expect(cost.calls.find((line) => line.provider === "rdap")).toMatchObject({
      status: "failed",
      meta: "timeout",
    });
  });

  it("treats an RDAP 400 as a question it declined, not a provider failure", async () => {
    const cost = await withCostLedger(async () => {
      const outcome = await collectDomainRegistration(
        "unsupported.example",
        (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch,
      );
      expect(outcome).toMatchObject({ available: false, reason: "not_applicable" });
      expect((outcome as { note: string }).note).toContain("unsupported.example");
      return getCost();
    });

    // The red "source problems" notice reads exactly this list.
    expect(providerFailureLines(cost)).toEqual([]);
    expect(cost.calls.find((line) => line.provider === "rdap")).toMatchObject({ status: "succeeded", failed: 0 });
  });

  it("does not age a project by its hosting platform's domain", async () => {
    const fetchMock = vi.fn(async () => rdap([{ eventAction: "registration", eventDate: "2013-03-08T00:00:00Z" }]));
    const outcome = await collectDomainRegistration("https://someproject.github.io", fetchMock as unknown as typeof fetch);

    expect(outcome).toMatchObject({ available: false, reason: "not_applicable" });
    // github.io's own 2013 registration is GitHub's, and it is never asked for.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Reducing to the last two labels is only safe where the apex belongs to the
  // project. A storefront or page builder answers RDAP with its OWN decades-old
  // registration (myshopify.com: 2006-03-03, checked live), and handing that to
  // the tenant ages a site that may be days old.
  it("does not age a project by the page builder or storefront it rents", async () => {
    const fetchMock = vi.fn(async () => rdap([{ eventAction: "registration", eventDate: "2006-03-03T03:01:37Z" }]));
    for (const site of ["https://mystore.myshopify.com", "https://theproject.framer.website"]) {
      const outcome = await collectDomainRegistration(site, fetchMock as unknown as typeof fetch);
      expect(outcome).toMatchObject({ available: false, reason: "not_applicable" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("separates a missing record from an outage, and needs a domain at all", async () => {
    const missing = await collectDomainRegistration(
      "nowhere.example",
      (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch,
    );
    expect(missing).toMatchObject({ available: false, reason: "not_found" });

    const down = await collectDomainRegistration(
      "nowhere.example",
      (async () => { throw new Error("offline"); }) as unknown as typeof fetch,
    );
    expect(down).toMatchObject({ available: false, reason: "unavailable" });

    const none = await collectDomainRegistration(null, (async () => rdap([])) as unknown as typeof fetch);
    expect(none).toMatchObject({ available: false, reason: "no_domain" });
  });
});

describe("deriveLaunchWindow", () => {
  it("brackets the public footprint and calls out a wide gap", () => {
    const window = deriveLaunchWindow("2019-04-15T00:00:00Z", "2023-05-01T00:00:00Z");
    expect(window).toMatchObject({ earliestSource: "domain", latestSource: "account" });
    expect(window?.summary).toContain("Public footprint starts April 2019, when the domain was registered");
    expect(window?.summary).toContain("the X account followed May 2023");
    expect(window?.summary).toContain("4 years apart");
  });

  it("reads the other order when the account came first", () => {
    const window = deriveLaunchWindow("2026-01-10T00:00:00Z", "2025-11-01T00:00:00Z");
    expect(window?.earliestSource).toBe("account");
    expect(window?.summary).toContain("the X account was created");
    expect(window?.summary).toContain("Both surfaces appeared within months");
  });

  it("returns nothing when either date is missing", () => {
    expect(deriveLaunchWindow(null, "2023-05-01T00:00:00Z")).toBeNull();
    expect(deriveLaunchWindow("2019-04-15T00:00:00Z", undefined)).toBeNull();
  });
});

describe("monthsBetween", () => {
  it("counts whole elapsed months", () => {
    expect(monthsBetween("2026-01-15T00:00:00Z", new Date("2026-07-27T00:00:00Z"))).toBe(6);
    expect(monthsBetween("2026-07-28T00:00:00Z", new Date("2026-07-27T00:00:00Z"))).toBe(0);
  });
});
