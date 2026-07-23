import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecording, matchKey, scrubUrl, scrubVolatile, withRecordedFetch } from "./evalHarness";

let dir: string;
let realFetch: typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "argus-eval-"));
  realFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// A stand-in pipeline: two distinct calls, one repeated call with different
// responses per attempt, and a body carrying volatile local state (timestamp +
// uuid) that will differ on replay.
async function pipeline(now: string, runId: string): Promise<string[]> {
  const out: string[] = [];
  const first = await fetch("https://provider.example/search?q=uniswap&api_key=sk-secret", {
    method: "POST",
    body: JSON.stringify({ prompt: "who founded uniswap", at: now, runId }),
  });
  out.push(await first.text());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const retry = await fetch("https://provider.example/score", {
      method: "POST",
      body: JSON.stringify({ packet: "same evidence", at: now, runId }),
    });
    out.push(await retry.text());
  }
  return out;
}

describe("eval harness record/replay", () => {
  it("replays a recorded run byte-identically with zero live fetches, despite volatile drift", async () => {
    const live = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/search")) return new Response('{"answer":"hayden"}', { status: 200, headers: { "content-type": "application/json" } });
      return new Response(`{"score":${live.mock.calls.length}}`, { status: 200, headers: { "content-type": "application/json" } });
    });
    globalThis.fetch = live as unknown as typeof fetch;

    const recorded = await withRecordedFetch("record", dir, () =>
      pipeline("2026-07-23T10:00:00.000Z", "3e4a1b2c-0000-4000-8000-000000000001"));
    expect(recorded.recordedCalls).toBe(3);
    expect(live).toHaveBeenCalledTimes(3);

    // Replay with a DIFFERENT clock and run id; live fetch must never fire.
    const liveDuringReplay = vi.fn(async () => new Response("must-not-run", { status: 500 }));
    globalThis.fetch = liveDuringReplay as unknown as typeof fetch;
    const replayed = await withRecordedFetch("replay", dir, () =>
      pipeline("2026-08-01T23:59:59.000Z", "ffffffff-1111-4222-8333-444444444444"));

    expect(liveDuringReplay).not.toHaveBeenCalled();
    expect(replayed.result).toEqual(recorded.result);
    expect(replayed.fidelity.exactHits).toBe(3);
    expect(replayed.fidelity.misses).toHaveLength(0);
    // Repeated identical requests replay their distinct responses in order.
    expect(replayed.result[1]).not.toEqual(replayed.result[2]);
  });

  it("never persists request headers and redacts sensitive query params", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    await withRecordedFetch("record", dir, async () => {
      await fetch("https://provider.example/data?q=x&api_key=sk-live-123&token=t0&access_token=access-live&client_secret=client-live&authorization=query-live", {
        method: "GET",
        headers: { authorization: "Bearer sk-live-123", "x-api-key": "sk-live-123" },
      });
      return null;
    });
    const raw = readFileSync(join(dir, "calls.jsonl"), "utf8");
    expect(raw).not.toContain("sk-live-123");
    expect(raw).not.toContain("access-live");
    expect(raw).not.toContain("client-live");
    expect(raw).not.toContain("query-live");
    expect(raw).not.toContain("Bearer");
    expect(raw).toContain("api_key=REDACTED");
    expect(raw).toContain("token=REDACTED");
    expect(raw).toContain("access_token=REDACTED");
    expect(raw).toContain("client_secret=REDACTED");
    expect(raw).toContain("authorization=REDACTED");
    expect(loadRecording(dir)).toHaveLength(1);
  });

  it("falls back to url-tier matching when a prompt changed, and reports it", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"v":1}', { status: 200 })) as unknown as typeof fetch;
    await withRecordedFetch("record", dir, async () => {
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"old wording"}' });
      return null;
    });
    globalThis.fetch = vi.fn(async () => new Response("must-not-run", { status: 500 })) as unknown as typeof fetch;
    const replay = await withRecordedFetch("replay", dir, async () => {
      const res = await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"NEW wording"}' });
      return res.text();
    });
    expect(replay.result).toBe('{"v":1}');
    expect(replay.fidelity.exactHits).toBe(0);
    expect(replay.fidelity.urlFallbackHits).toBe(1);
  });

  it("consumes a recording once across both exact and URL tiers", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"v":1}', { status: 200 })) as unknown as typeof fetch;
    await withRecordedFetch("record", dir, async () => {
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"old"}' });
      return null;
    });
    globalThis.fetch = vi.fn(async () => new Response("must-not-run", { status: 500 })) as unknown as typeof fetch;

    await expect(withRecordedFetch("replay", dir, async () => {
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"changed"}' });
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"old"}' });
      return null;
    })).rejects.toThrow(/eval replay miss/);
  });

  it("throws when an extra identical call exceeds the recorded call count", async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"v":1}', { status: 200 })) as unknown as typeof fetch;
    await withRecordedFetch("record", dir, async () => {
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"same"}' });
      return null;
    });
    globalThis.fetch = vi.fn(async () => new Response("must-not-run", { status: 500 })) as unknown as typeof fetch;

    await expect(withRecordedFetch("replay", dir, async () => {
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"same"}' });
      await fetch("https://provider.example/score", { method: "POST", body: '{"prompt":"same"}' });
      return null;
    })).rejects.toThrow(/eval replay miss/);
  });

  it("throws loudly on a miss unless the host is in the live allowlist", async () => {
    globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    await withRecordedFetch("record", dir, async () => null);

    await expect(withRecordedFetch("replay", dir, async () => {
      await fetch("https://unrecorded.example/x");
      return null;
    })).rejects.toThrow(/eval replay miss/);

    const liveLane = vi.fn(async () => new Response('{"serper":true}', { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = liveLane as unknown as typeof fetch;
    const allowed = await withRecordedFetch("replay", dir, async () => {
      const res = await fetch("https://google.serper.dev/search", { method: "POST", body: '{"q":"x"}' });
      return res.text();
    }, { allowLiveHosts: ["serper.dev"] });
    expect(allowed.result).toBe('{"serper":true}');
    expect(allowed.fidelity.liveAllowed).toBe(1);
    expect(readFileSync(join(dir, "live-lane.jsonl"), "utf8")).toContain("serper");
  });

  it("can force only an exact recorded analyst tool request live for repeated-input variance checks", async () => {
    globalThis.fetch = vi.fn(async () => new Response("recorded", { status: 200 })) as unknown as typeof fetch;
    const body = JSON.stringify({
      prompt: "identical",
      tool_choice: { type: "tool", name: "record_verdict" },
    });
    await withRecordedFetch("record", dir, async () => {
      await fetch("https://api.anthropic.com/v1/messages", { method: "POST", body });
      return null;
    });
    const live = vi.fn(async () => new Response("fresh-live", { status: 200 }));
    globalThis.fetch = live as unknown as typeof fetch;

    const replay = await withRecordedFetch("replay", dir, async () => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body,
      });
      return response.text();
    }, { forceLiveTools: ["record_verdict"] });

    expect(replay.result).toBe("fresh-live");
    expect(replay.fidelity.exactHits).toBe(0);
    expect(replay.fidelity.liveForced).toBe(1);
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("scrub helpers normalize volatile values and preserve stable text", () => {
    const scrubbed = scrubVolatile('{"at":"2026-07-23T10:00:00.000Z","epoch":1769212800000,"id":"3e4a1b2c-0000-4000-8000-000000000001","stable":"captured 2026-07-22"}');
    expect(scrubbed).not.toContain("2026-07-23T10");
    expect(scrubbed).not.toContain("1769212800000");
    expect(scrubbed).not.toContain("3e4a1b2c");
    expect(scrubbed).toContain('"stable":"captured 2026-07-22"');
    expect(scrubUrl("https://a.example/p?key=s&q=ok")).toBe("https://a.example/p?key=REDACTED&q=ok");
    expect(matchKey("post", "https://a.example/p", "{}")).toBe(matchKey("POST", "https://a.example/p", "{}"));
  });
});
