import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicText,
  isPublicIpAddress,
  validatedPublicUrl,
  type PinnedRequestOptions,
} from "./publicWeb";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("public web evidence fetcher", () => {
  it("rejects private, loopback, and reserved addresses", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.4")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("192.168.1.10")).toBe(false);
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    for (const address of [
      "::127.0.0.1",
      "::10.0.0.1",
      "fec0::1",
      "64:ff9b::7f00:1",
      "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
      "2002:7f00:1::",
      "2001:db8::1",
    ]) expect(isPublicIpAddress(address)).toBe(false);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("accepts a credential-free public web URL", async () => {
    const url = await validatedPublicUrl("https://example.com/evidence", undefined, publicLookup);
    expect(url?.toString()).toBe("https://example.com/evidence");
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "https://localhost/private",
    "https://user:secret@example.com/evidence",
    "https://example.com/evidence?X-Amz-Signature=secret",
    "https://example.com/evidence?%58%2DGoog%2DCredential=secret",
    "file:///etc/passwd",
  ])("rejects unsafe source %s", async (source) => {
    expect(await validatedPublicUrl(source, undefined, publicLookup)).toBeNull();
  });

  it("rejects a public hostname when DNS resolves to a private address", async () => {
    const privateLookup = vi.fn(async () => [{ address: "10.0.0.5", family: 4 }]);
    expect(await validatedPublicUrl("https://example.com/evidence", undefined, privateLookup)).toBeNull();
  });

  it("revalidates redirects and blocks a redirect into loopback", async () => {
    const requestMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));
    const result = await fetchPublicText("https://example.com/start", { request: requestMock, lookup: publicLookup });
    expect(result).toEqual({ status: "rejected", reason: "unsafe_redirect" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("pins the validated public address into the actual connection lookup", async () => {
    const rebindingLookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const requestMock = vi.fn(async (_url: URL, options: PinnedRequestOptions) => {
      const connectedAddresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        options.lookup("example.com", { all: true }, (error, address, family) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(Array.isArray(address) ? address : [{ address, family: family ?? 0 }]);
        });
      });
      expect(connectedAddresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return new Response("<html><body>Evidence</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const result = await fetchPublicText("https://example.com/evidence", {
      request: requestMock,
      lookup: rebindingLookup,
    });

    expect(result.status).toBe("ok");
    // A vulnerable transport would call DNS again here and receive 10.0.0.5.
    expect(rebindingLookup).toHaveBeenCalledTimes(1);
  });

  it("revalidates DNS before opening every redirect hop", async () => {
    const rebindingLookup = vi.fn()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const requestMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "/redirected" },
    }));

    const result = await fetchPublicText("https://example.com/start", {
      request: requestMock,
      lookup: rebindingLookup,
    });

    expect(result).toEqual({ status: "rejected", reason: "unsafe_redirect" });
    expect(rebindingLookup).toHaveBeenCalledTimes(2);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("freezes the exact fetched bytes and final URL", async () => {
    const requestMock = vi.fn(async () => new Response("<html><body>Evidence</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));
    const result = await fetchPublicText("https://example.com/evidence#fragment", {
      request: requestMock,
      lookup: publicLookup,
      now: () => new Date("2026-07-11T12:00:00.000Z"),
    });
    expect(result).toMatchObject({
      status: "ok",
      url: "https://example.com/evidence",
      host: "example.com",
      capturedAt: "2026-07-11T12:00:00.000Z",
    });
    if (result.status === "ok") expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts markdown evidence pages as bounded public text", async () => {
    const requestMock = vi.fn(async () => new Response("# Jupiter\n\nJupiter was co-founded by Meow.", {
      status: 200,
      headers: { "content-type": "text/markdown; charset=utf-8" },
    }));
    const result = await fetchPublicText("https://docs.jup.ag/tokenomics.md", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      contentType: "text/markdown",
      text: expect.stringContaining("co-founded by Meow"),
    }));
  });

  it("returns a bounded failure when the response stream breaks", async () => {
    const requestMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.error(new Error("socket reset")); },
    }), { status: 200, headers: { "content-type": "text/html" } }));
    await expect(fetchPublicText("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    })).resolves.toEqual({ status: "failed", reason: "response_stream_error" });
  });
});
