import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAuditRunContext } from "../auditRunContext";
import { checkFollow, resetFollowScanMemo } from "./x";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

beforeEach(() => {
  resetFollowScanMemo();
  vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
});

afterEach(() => {
  resetFollowScanMemo();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function followStub(answer: unknown, opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    if (opts.fail) return json({ error: "upstream" }, 502);
    return json(answer);
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

// Two lanes ask "does this account follow the subject" about the same pair: the
// notable-follower pass and the endorser pass. Before the memo, whether that
// cost one metered call or two came down to whether the first was still in
// flight when the second asked, so a fast provider doubled the bill and the
// same audit was not reproducible.
describe("a follow answer is bought once per scan", () => {
  it("serves a repeat question from the scan's own answer", async () => {
    const calls = followStub({ data: { following: true, followed_by: false } });

    const first = await checkFollow("@vitalikbuterin", "@uniswap");
    const second = await checkFollow("vitalikbuterin", "uniswap");

    expect(first).toEqual(second);
    expect(first?.following).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("costs one call whether the askers overlap in time or not", async () => {
    const calls = followStub({ data: { following: true, followed_by: false } });

    const concurrent = await Promise.all([
      checkFollow("@a16zcrypto", "@uniswap"),
      checkFollow("@a16zcrypto", "@uniswap"),
    ]);
    const later = await checkFollow("@a16zcrypto", "@uniswap");

    expect(concurrent[0]).toEqual(concurrent[1]);
    expect(later).toEqual(concurrent[0]);
    expect(calls).toHaveLength(1);
  });

  it("keeps distinct pairs distinct", async () => {
    const calls = followStub({ data: { following: true, followed_by: false } });

    await checkFollow("@paradigm", "@uniswap");
    await checkFollow("@uniswap", "@paradigm");

    expect(calls).toHaveLength(2);
  });

  it("never remembers a failed read as an answer", async () => {
    const calls = followStub(null, { fail: true });

    expect(await checkFollow("@zhusu", "@uniswap")).toBeNull();
    const afterFirst = calls.length;
    expect(await checkFollow("@zhusu", "@uniswap")).toBeNull();

    // A blip must not freeze into "does not follow" for the rest of the scan.
    // twFetch retries internally, so what matters is that the second ask went
    // back to the provider at all rather than being served a remembered null.
    expect(afterFirst).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it("does not carry one subject's answers into the next scan", async () => {
    const calls = followStub({ data: { following: true, followed_by: false } });

    await checkFollow("@balajis", "@uniswap");
    resetFollowScanMemo();
    await checkFollow("@balajis", "@uniswap");

    expect(calls).toHaveLength(2);
  });

  it("never shares an in-flight answer between concurrent audit contexts", async () => {
    const calls = followStub({ data: { following: true, followed_by: false } });

    const answers = await Promise.all([
      withAuditRunContext({ scanId: "scan-a" }, () => checkFollow("@a16z", "@uniswap")),
      withAuditRunContext({ scanId: "scan-b" }, () => checkFollow("@a16z", "@uniswap")),
    ]);

    expect(answers[0]).toEqual(answers[1]);
    expect(calls).toHaveLength(2);
  });
});
