// ARGUS Telegram bot - the threat scanner as a chat command.
//
// Send a contract address (or /scan <address>) and the bot runs the REAL
// threat pipeline - the same auditToken + threatScan + judge the app runs,
// executed server-side - and replies with the verdict card plus a deep link to
// the full report. No watered-down "bot version" of the scan exists.
//
// Security model (defense in depth, all fail closed):
//   1. Telegram itself authenticates with TELEGRAM_WEBHOOK_SECRET via the
//      x-telegram-bot-api-secret-token header (set at setWebhook time).
//   2. Only chats in TELEGRAM_ALLOWED_CHATS (comma-separated ids) may scan -
//      an unknown chat is told its id so Enigma can allowlist it. Default: closed.
//   3. The pipeline's callbacks into our own /api routes carry the
//      INTERNAL_API_SECRET bearer (middleware's server-to-server branch).
//
// Telegram retries a webhook on non-200, so the handler ACKs immediately and
// finishes the scan via waitUntil; update_id dedupe absorbs any retry overlap.
import { waitUntil } from "@vercel/functions";
import type { VercelRequest, VercelResponse } from "@vercel/node";

import { cacheGetJson, cacheSetJson } from "./_cache.js";

// The pipeline ships as a pre-bundled single-file ESM lib (api/_threatlib.mjs,
// built by scripts/build-threatlib.mjs during `npm run build`). Vercel's
// function builder transpiles api/*.ts but does NOT bundle imports reaching
// outside api/, so a static ../src import dies at runtime with
// ERR_MODULE_NOT_FOUND under "type": "module". Dynamic import of an in-dir
// .mjs (real file, real extension) resolves under any builder. The computed
// specifier keeps tsc from resolving a file that only exists post-build.
type ThreatLib = typeof import("../src/threat/serverScan");
let libPromise: Promise<ThreatLib> | null = null;
function threatLib(): Promise<ThreatLib> {
  if (!libPromise) {
    const specifier = "./_threatlib.mjs";
    libPromise = import(/* @vite-ignore */ specifier) as Promise<ThreatLib>;
  }
  return libPromise;
}

export const config = { maxDuration: 300 };

const APP_URL = "https://argus-one-flax.vercel.app";
const TG = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(token: string, method: string, body: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(TG(token, method), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    return await r.json();
  } catch { return null; }
}

const HELP = [
  "<b>ARGUS threat scanner</b>",
  "Send a contract address (EVM or Solana) or a dexscreener.com link and I run the full ARGUS threat scan: contract code, liquidity custody, launch provenance, holders, sell structure, site safety, and X-bio authenticity.",
  "",
  "Commands:",
  "/scan &lt;address&gt; - scan a token",
  "(or just paste the address)",
  "",
  "<i>research only · not financial advice</i>",
].join("\n");

// Extract the scannable ref from a message: /scan arg, bare address, or a
// dexscreener link anywhere in the text.
export function extractRef(text: string): string | null {
  const t = text.trim();
  const cmd = t.match(/^\/scan(?:@\w+)?\s+(\S+)/i);
  if (cmd) return cmd[1];
  const ds = t.match(/https?:\/\/(?:www\.)?dexscreener\.com\/\S+/i);
  if (ds) return ds[0];
  const evm = t.match(/0x[0-9a-fA-F]{40}\b/);
  if (evm) return evm[0];
  // Solana mint: whole-token base58 (avoid matching random words - length >= 32)
  const sol = t.match(/(?:^|\s)([1-9A-HJ-NP-Za-km-z]{32,44})(?:\s|$)/);
  if (sol) return sol[1];
  return null;
}

export function allowedChat(chatId: number | string): boolean {
  const raw = process.env.TELEGRAM_ALLOWED_CHATS ?? "";
  const set = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return set.has(String(chatId));
}

async function processUpdate(token: string, update: any): Promise<void> {
  const msg = update?.message ?? update?.channel_post;
  const chatId = msg?.chat?.id;
  const text: string = String(msg?.text ?? "").trim();
  if (chatId == null || !text) return;

  if (!allowedChat(chatId)) {
    await tg(token, "sendMessage", {
      chat_id: chatId, parse_mode: "HTML",
      text: `This ARGUS bot is private. Ask the operator to allowlist this chat:\n<code>${esc(String(chatId))}</code>`,
    });
    return;
  }

  if (/^\/(start|help)/i.test(text)) {
    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: HELP, disable_web_page_preview: true });
    return;
  }

  const ref = extractRef(text);
  if (!ref) {
    await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: "Send a contract address (0x… or a Solana mint) or a dexscreener.com link, or /help.", disable_web_page_preview: true });
    return;
  }

  const sent = await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `\u{1F50E} Scanning <code>${esc(ref.slice(0, 60))}</code>… (30–60s)`, disable_web_page_preview: true });
  const progressId = sent?.result?.message_id;

  try {
    const lib = await threatLib();
    // Point the pipeline's /api callbacks at this deployment with internal auth.
    const internal = process.env.INTERNAL_API_SECRET;
    const base = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : APP_URL;
    lib.configureThreatNet(base, internal ? { authorization: `Bearer ${internal}` } : {});

    const input = lib.resolveInput(ref);
    const scan = input.kind === "token" ? await lib.threatScan(input) : null;
    if (!scan) {
      const failText = input.kind !== "token"
        ? "That does not resolve to a token. Send the contract address itself."
        : "Scan failed - the address did not resolve to a live market (no DexScreener pair), or the resolver refused to report on a different token than you asked for.";
      if (progressId) await tg(token, "editMessageText", { chat_id: chatId, message_id: progressId, parse_mode: "HTML", text: esc(failText) });
      else await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: esc(failText) });
      return;
    }
    // The ARGUS engine AI read (same as the app's panel) - best-effort.
    try {
      scan.code.ai = await lib.aiCodeRead(scan.chain, scan.address, scan.code, { verdict: scan.call.verdict, risk: scan.call.risk });
    } catch { /* keyless/timeout - the mechanical verdict stands */ }

    const textOut = lib.formatScanMessage(scan);
    if (progressId) {
      const edited = await tg(token, "editMessageText", { chat_id: chatId, message_id: progressId, parse_mode: "HTML", text: textOut, disable_web_page_preview: true });
      if (!edited?.ok) await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: textOut, disable_web_page_preview: true });
    } else {
      await tg(token, "sendMessage", { chat_id: chatId, parse_mode: "HTML", text: textOut, disable_web_page_preview: true });
    }
  } catch {
    const err = "Scan crashed - try again in a minute, or open the app directly: " + `${APP_URL}/?threat=${encodeURIComponent(ref)}`;
    if (progressId) await tg(token, "editMessageText", { chat_id: chatId, message_id: progressId, text: err });
    else await tg(token, "sendMessage", { chat_id: chatId, text: err });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const got = String(req.headers["x-telegram-bot-api-secret-token"] ?? "");
  // Fail closed: unset secret or token = bot not configured = reject.
  if (!secret || !token || got !== secret) { res.status(401).json({ error: "unauthorized" }); return; }

  const update = req.body as any;
  const updateId = update?.update_id;
  if (typeof updateId === "number") {
    // Telegram retries on slow ACKs; absorb duplicates.
    const key = `tg-update:${updateId}`;
    if (await cacheGetJson(key)) { res.status(200).json({ ok: true, dedup: true }); return; }
    await cacheSetJson(key, { at: Date.now() });
  }

  // ACK now; scan after. Telegram only needs the 200.
  waitUntil(processUpdate(token, update));
  res.status(200).json({ ok: true });
}
