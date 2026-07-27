import { describe, expect, it, vi } from "vitest";
import {
  collectDomainRegistration,
  deriveLaunchWindow,
  monthsBetween,
  registrationEventDate,
} from "./domainAge";

const rdap = (events: Array<{ eventAction: string; eventDate: string }>) => ({
  ok: true,
  status: 200,
  json: async () => ({ events }),
}) as Response;

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

describe("collectDomainRegistration", () => {
  it("follows redirects and reports the registration date and age", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      rdap([{ eventAction: "registration", eventDate: "2019-04-15T00:11:31Z" }]));
    const outcome = await collectDomainRegistration("https://www.venice.ai/about", fetchMock as unknown as typeof fetch, new Date("2026-07-27T00:00:00Z"));

    expect(outcome).toMatchObject({
      available: true,
      value: { domain: "venice.ai", registeredAt: "2019-04-15T00:11:31Z", ageMonths: 87 },
    });
    // rdap.org redirects to the authoritative registry; without this the lookup fails.
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "follow" });
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
