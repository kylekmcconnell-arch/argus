import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicText,
  fetchPublicTextWithRecovery,
  fetchCompatibleResponseStatus,
  isPublicIpAddress,
  validatedPublicUrl,
  type PinnedRequestOptions,
} from "./publicWeb";

const publicLookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);

describe("public web evidence fetcher", () => {
  it("normalizes non-standard Node HTTP statuses before constructing a Response", () => {
    expect(fetchCompatibleResponseStatus(200)).toBe(200);
    expect(fetchCompatibleResponseStatus(599)).toBe(599);
    expect(fetchCompatibleResponseStatus(700)).toBe(403);
    expect(fetchCompatibleResponseStatus(999)).toBe(403);
    expect(fetchCompatibleResponseStatus(101)).toBe(502);
    expect(fetchCompatibleResponseStatus(undefined)).toBe(502);
  });

  it("rejects private, loopback, and reserved addresses", () => {
    expect(isPublicIpAddress("127.0.0.1")).toBe(false);
    expect(isPublicIpAddress("10.0.0.4")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("192.0.0.8")).toBe(false);
    expect(isPublicIpAddress("192.0.66.220")).toBe(true);
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

  it("identifies ARGUS with a professional contact-bearing user agent", async () => {
    const requestMock = vi.fn(async (_url: URL, options: PinnedRequestOptions) => {
      expect(options.headers["user-agent"]).toBe(
        "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)",
      );
      return new Response("SEC evidence", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    await expect(fetchPublicText("https://www.sec.gov/Archives/edgar/data/1679788", {
      request: requestMock,
      lookup: publicLookup,
    })).resolves.toEqual(expect.objectContaining({ status: "ok" }));
    expect(requestMock).toHaveBeenCalledTimes(1);
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

  it("recovers a validated 403 evidence page through the bounded Jina reader", async () => {
    const readerBytes = [
      "Title: Example evidence",
      "URL Source: https://example.com/evidence",
      "Markdown Content:",
      "Brian Armstrong is the co-founder and CEO of Coinbase.",
    ].join("\n");
    const requestMock = vi.fn(async (url: URL, options: PinnedRequestOptions) => {
      if (url.hostname === "example.com") return new Response("Cloudflare", { status: 403 });
      expect(url.toString()).toBe("https://r.jina.ai/https://example.com/evidence");
      expect(options.headers.accept).toBe("text/plain,text/markdown;q=0.9");
      return new Response(readerBytes, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    });

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence#source", {
      request: requestMock,
      lookup: publicLookup,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      url: "https://example.com/evidence",
      host: "example.com",
      retrievalMethod: "reader_recovery",
      retrievalProvider: "jina-reader",
      retrievalUrl: "https://r.jina.ai/https://example.com/evidence",
      text: expect.stringContaining("co-founder and CEO of Coinbase"),
      contentHash: createHash("sha256").update(Buffer.from(readerBytes)).digest("hex"),
      capturedAt: "2026-07-13T12:00:00.000Z",
    }));
  });

  it("recovers an explicit HTTP 200 Cloudflare interstitial through the bounded Jina reader", async () => {
    const source = "https://example.com/evidence";
    const challenge = `<!doctype html><html><head><title>Just a moment...</title></head>
      <body>Enable JavaScript and cookies to continue<script src="/cdn-cgi/challenge-platform/run.js"></script></body></html>`;
    const requestMock = vi.fn(async (url: URL) => url.hostname === "example.com"
      ? new Response(challenge, { status: 200, headers: { "content-type": "text/html" } })
      : new Response(`Title: Evidence\nURL Source: ${source}\nMarkdown Content:\nVerified source text.`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      url: source,
      retrievalMethod: "reader_recovery",
      retrievalProvider: "jina-reader",
    }));
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("retries one transient reader 422 before accepting exact-source evidence", async () => {
    const source = "https://example.com/evidence";
    let readerAttempts = 0;
    const requestMock = vi.fn(async (url: URL) => {
      if (url.hostname === "example.com") return new Response("Cloudflare", { status: 403 });
      readerAttempts += 1;
      return readerAttempts === 1
        ? new Response("reader warming", { status: 422 })
        : new Response(`Title: Evidence\nURL Source: ${source}\nMarkdown Content:\nVerified source text.`, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
    });
    const wait = vi.fn(async () => undefined);

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
      wait,
    });

    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      url: source,
      retrievalMethod: "reader_recovery",
    }));
    expect(wait).toHaveBeenCalledWith(750);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("stops after one retry when the reader remains transiently unavailable", async () => {
    const source = "https://example.com/evidence";
    const requestMock = vi.fn(async (url: URL) => (
      url.hostname === "example.com"
        ? new Response("Cloudflare", { status: 403 })
        : new Response("reader warming", { status: 422 })
    ));
    const wait = vi.fn(async () => undefined);

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
      wait,
    });

    expect(result).toEqual({ status: "failed", reason: "reader_recovery_failed_http_422" });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(750);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("does not send a query-bearing URL to the reader when HTTP 200 contains a challenge", async () => {
    const source = "https://example.com/evidence?share=secret";
    const requestMock = vi.fn(async () => new Response("<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/run.js'></script></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }));

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason: "anti_bot_challenge" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([404, 410, 500, 503])("does not proxy a non-recoverable HTTP %s response", async (status) => {
    const requestMock = vi.fn(async () => new Response("origin failure", { status }));

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason: `http_${status}` });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "unsupported content",
      response: () => new Response("binary", { status: 200, headers: { "content-type": "image/png" } }),
      reason: "unsupported_content_type",
    },
    {
      label: "an oversized response",
      response: () => new Response("oversized", { status: 200, headers: { "content-type": "text/plain", "content-length": "1500001" } }),
      reason: "response_too_large",
    },
  ])("does not proxy $label", async ({ response, reason }) => {
    const requestMock = vi.fn(async () => response());

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("does not send a query-bearing evidence URL to the reader", async () => {
    const seenUrls: string[] = [];
    const requestMock = vi.fn(async (url: URL) => {
      seenUrls.push(url.toString());
      return new Response("Cloudflare", { status: 403 });
    });

    const result = await fetchPublicTextWithRecovery(
      "https://example.com/private/share-token-abc?share=secret123&code=oauth456",
      { request: requestMock, lookup: publicLookup },
    );

    expect(result).toEqual({ status: "failed", reason: "http_403" });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(seenUrls).toEqual([
      "https://example.com/private/share-token-abc?share=secret123&code=oauth456",
    ]);
  });

  it.each([
    "https://example.com/share/4f7a27e96c3b4afda2dd87d2f07d9e31",
    "https://example.com/evidence/share-token-AbCdEfGhIjKlMnOpQrStUvWx12345678",
  ])("does not send a capability-shaped path to the reader: %s", async (source) => {
    const requestMock = vi.fn(async () => new Response("Cloudflare", { status: 403 }));

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason: "http_403" });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("allows reader recovery for a public web3 transaction hash path", async () => {
    const source = "https://example.com/tx/4f7a27e96c3b4afda2dd87d2f07d9e31";
    const requestMock = vi.fn(async (url: URL) => url.hostname === "example.com"
      ? new Response("Cloudflare", { status: 403 })
      : new Response(`URL Source: ${source}\n\nTransaction evidence`, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }));

    const result = await fetchPublicTextWithRecovery(source, {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual(expect.objectContaining({ status: "ok", retrievalProvider: "jina-reader" }));
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("rejects reader content whose declared URL Source differs from the original evidence URL", async () => {
    const requestMock = vi.fn(async (url: URL) => {
      if (url.hostname === "example.com") return new Response("Cloudflare", { status: 403 });
      return new Response([
        "Title: Redirected content",
        "URL Source: https://attacker.example/fake",
        "Markdown Content:",
        "Content that must not inherit example.com provenance.",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason: "reader_source_mismatch" });
    expect(result).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("host");
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a reader HTTP redirect even when the final body declares the original source", async () => {
    const requestMock = vi.fn(async (url: URL) => {
      if (url.hostname === "example.com") return new Response("Cloudflare", { status: 403 });
      if (url.pathname === "/https://example.com/evidence") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://r.jina.ai/https://example.com/reader-redirect" },
        });
      }
      return new Response([
        "Title: Redirected reader page",
        "URL Source: https://example.com/evidence",
        "Markdown Content:",
        "This arrived through an unexpected reader redirect.",
      ].join("\n"), {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    });

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "failed", reason: "reader_redirect_mismatch" });
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("records direct retrieval without invoking the reader", async () => {
    const requestMock = vi.fn(async () => new Response("Direct evidence", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual(expect.objectContaining({
      status: "ok",
      retrievalMethod: "direct",
      retrievalProvider: "origin",
      retrievalUrl: "https://example.com/evidence",
    }));
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("never sends an unsafe original URL to the reader proxy", async () => {
    const requestMock = vi.fn(async () => new Response("should not run", { status: 200 }));

    const result = await fetchPublicTextWithRecovery("http://169.254.169.254/latest/meta-data", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "rejected", reason: "unsafe_or_unresolvable_url" });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("does not proxy a direct fetch rejected for an unsafe redirect", async () => {
    const requestMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));

    const result = await fetchPublicTextWithRecovery("https://example.com/evidence", {
      request: requestMock,
      lookup: publicLookup,
    });

    expect(result).toEqual({ status: "rejected", reason: "unsafe_redirect" });
    expect(requestMock).toHaveBeenCalledTimes(1);
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
