import { afterEach, describe, expect, it, vi } from "vitest";
import { o1BaseAnnouncementVenue } from "./launch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const B20_TOKEN = "0xb20aa11f3a344924f8e34b1b6cf27fabbcc9d4f1";

describe("o1BaseAnnouncementVenue", () => {
  it("never spends a call on a non-B20 address (o1 Base tokens are B20 system assets)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await o1BaseAnnouncementVenue("0x1111111111111111111111111111111111111111", "k")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attributes o1 when the announcement registry carries a log referencing the token", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url).toContain("chainid=8453");
      expect(url).toContain("address=0xab1243c97a37361115d5cef7666bf49ad2fb6baa");
      expect(url).toContain(B20_TOKEN.slice(2));
      return new Response(JSON.stringify({ result: [{ topics: ["0xdead"] }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await o1BaseAnnouncementVenue(B20_TOKEN, "k")).toBe("o1");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("walks every Base suite, current first, and a miss on all of them is null, never a guess", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      void input;
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await o1BaseAnnouncementVenue(B20_TOKEN, "k")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("address=0xab1243c97a37361115d5cef7666bf49ad2fb6baa");
    for (const url of urls) {
      expect(url).toContain("topic1=");
      expect(url).not.toContain("topic2=");
    }
  });

  it("still attributes a token launched on a historical suite ($SPIKE, timestamp v2, 2026-08-13)", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const hit = url.includes("address=0xabdcbe060724b9bef5a2daad017d9ea3ed72de28");
      return new Response(JSON.stringify({ result: hit ? [{ topics: ["0xca4d"] }] : [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await o1BaseAnnouncementVenue("0xb20000000000000000000070f6c1a66d7c1e4d01", "k")).toBe("o1");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("treats an upstream failure as unattributed rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    expect(await o1BaseAnnouncementVenue(B20_TOKEN, "k")).toBeNull();
  });
});
