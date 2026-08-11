import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cacheGetJson, cacheSetJson, waitUntil } = vi.hoisted(() => ({
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  waitUntil: vi.fn((p: Promise<unknown>) => { void p.catch(() => {}); }),
}));
vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson }));
vi.mock("@vercel/functions", () => ({ waitUntil }));

import handler, { allowedChat, extractRef, formatScanMessage } from "./telegram";

function response() {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

async function run(headers: Record<string, string>, body: unknown, method = "POST") {
  const { res, captured } = response();
  await handler({ method, headers, body } as any, res as any);
  return captured;
}

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "hook-secret";
  process.env.TELEGRAM_BOT_TOKEN = "12345:token";
  cacheGetJson.mockResolvedValue(null);
  cacheSetJson.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_ALLOWED_CHATS;
});

describe("webhook gate", () => {
  it("401s without the Telegram secret header", async () => {
    const c = await run({}, { update_id: 1 });
    expect(c.status).toBe(401);
  });

  it("401s on a WRONG secret", async () => {
    const c = await run({ "x-telegram-bot-api-secret-token": "nope" }, { update_id: 1 });
    expect(c.status).toBe(401);
  });

  it("fails closed when the secret env is unset (bot unconfigured)", async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const c = await run({ "x-telegram-bot-api-secret-token": "" }, { update_id: 1 });
    expect(c.status).toBe(401);
  });

  it("ACKs 200 immediately on a valid update and processes via waitUntil", async () => {
    const c = await run({ "x-telegram-bot-api-secret-token": "hook-secret" }, { update_id: 2, message: { chat: { id: 1 }, text: "/help" } });
    expect(c.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("dedupes a retried update_id without reprocessing", async () => {
    cacheGetJson.mockResolvedValueOnce({ at: 1 });
    const c = await run({ "x-telegram-bot-api-secret-token": "hook-secret" }, { update_id: 3, message: { chat: { id: 1 }, text: "hi" } });
    expect(c.status).toBe(200);
    expect(c.body.dedup).toBe(true);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("rejects non-POST", async () => {
    const c = await run({ "x-telegram-bot-api-secret-token": "hook-secret" }, {}, "GET");
    expect(c.status).toBe(405);
  });
});

describe("allowlist", () => {
  it("is closed by default (no env = nobody allowed)", () => {
    expect(allowedChat(123)).toBe(false);
  });
  it("allows listed chats only", () => {
    process.env.TELEGRAM_ALLOWED_CHATS = "123, -100456";
    expect(allowedChat(123)).toBe(true);
    expect(allowedChat("-100456")).toBe(true);
    expect(allowedChat(789)).toBe(false);
  });
});

describe("extractRef", () => {
  const EVM = "0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3";
  it("takes /scan <addr>", () => expect(extractRef(`/scan ${EVM}`)).toBe(EVM));
  it("takes /scan@BotName <addr>", () => expect(extractRef(`/scan@ArgusBot ${EVM}`)).toBe(EVM));
  it("finds a bare EVM address in text", () => expect(extractRef(`what about ${EVM} ?`)).toBe(EVM));
  it("finds a Solana mint", () => expect(extractRef("So11111111111111111111111111111111111111112")).toBe("So11111111111111111111111111111111111111112"));
  it("finds a dexscreener link", () => expect(extractRef("https://dexscreener.com/base/0xabc")).toMatch(/^https:\/\/dexscreener\.com/));
  it("ignores plain chatter", () => expect(extractRef("gm what did you think of the launch")).toBe(null));
});

describe("formatScanMessage", () => {
  it("renders the verdict card with escaped content and the deep link", () => {
    const scan = {
      address: "0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3",
      chain: "base", symbol: "KUPO", name: "Kupo <script>",
      dossier: { liquidityUsd: 75700, mcap: 81300, socials: [], cg: null, address: "0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3", chain: "base" },
      call: { verdict: "SAFE", risk: 0, action: "No mechanical red flags", flags: [], warnings: [], positives: ["Verified contract", "CA in X bio"] },
      code: { ai: null },
    } as never;
    const out = formatScanMessage(scan);
    expect(out).toContain("<b>$KUPO</b>");
    expect(out).toContain("SAFE");
    expect(out).toContain("&lt;script&gt;"); // name is escaped
    expect(out).toContain("?threat=0xb2ece11a988a54a79675d4b827fc9ac419fb4ba3");
    expect(out).toContain("not financial advice");
    expect(out).toContain("DexScreener"); // constructible link present even with no socials
  });
});
