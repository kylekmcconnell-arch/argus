// Arkham money-flow story. GET /api/arkham-money-flow?address=<wallet>&chain=<chain>
//
// The existing holdings and counterparty panels answer "what is here now?" and
// "who has interacted with it?" This route adds the missing sequence: lifetime
// inflow/outflow totals plus the recent large transfers that explain where the
// wallet's money moved. Exchange transfers are observations, never proof of a
// sale, and the response keeps that distinction for the UI.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";

export const config = { maxDuration: 25 };

const FLOW = "https://api.arkm.com/flow/address/";
const TRANSFERS = "https://api.arkm.com/transfers";

type RawEntity = { id?: unknown; name?: unknown; type?: unknown; populatedTags?: unknown };
type RawAddress = {
  address?: unknown;
  arkhamEntity?: RawEntity | null;
  arkhamLabel?: { name?: unknown } | null;
  depositServiceID?: unknown;
};

export type MoneyFlowEvent = {
  id: string;
  at: string;
  direction: "in" | "out";
  usd: number;
  token: string;
  amount: number;
  chain: string;
  counterparty: string;
  counterpartyAddress?: string;
  counterpartyType?: string;
  counterpartyEntityId?: string;
  counterpartyTags: string[];
  isExchange: boolean;
  transactionHash?: string;
};

export type MoneyFlowStory = {
  available: boolean;
  activeSince?: string;
  lifetimeInflowUsd: number;
  lifetimeOutflowUsd: number;
  lifetimeNetUsd: number;
  last30dInflowUsd: number;
  last30dOutflowUsd: number;
  events: MoneyFlowEvent[];
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;

function chainName(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const aliases: Record<string, string> = {
    eth: "ethereum",
    sol: "solana",
    bnb: "bsc",
    binance: "bsc",
    arbitrum_one: "arbitrum",
  };
  const normalized = aliases[value] ?? value;
  return /^[a-z0-9_-]{2,32}$/.test(normalized) ? normalized : null;
}

function rawTags(entity: RawEntity | null | undefined): string[] {
  if (!Array.isArray(entity?.populatedTags)) return [];
  return (entity.populatedTags as { label?: unknown; rank?: unknown }[])
    .filter((tag) => text(tag?.label))
    .sort((a, b) => number(a?.rank) - number(b?.rank))
    .map((tag) => text(tag.label))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 4);
}

function addressName(address: RawAddress): string {
  return text(address.arkhamEntity?.name)
    || text(address.arkhamLabel?.name)
    || text(address.depositServiceID)
    || text(address.address);
}

function flattenFlow(value: unknown): Array<{ time: string; inflow: number; outflow: number; cumulativeInflow: number; cumulativeOutflow: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>)
    .flatMap((rows) => Array.isArray(rows) ? rows : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row) => ({
      time: text(row.time),
      inflow: Math.max(0, number(row.inflow)),
      outflow: Math.max(0, number(row.outflow)),
      cumulativeInflow: Math.max(0, number(row.cumulativeInflow)),
      cumulativeOutflow: Math.max(0, number(row.cumulativeOutflow)),
    }))
    .filter((row) => row.time && Number.isFinite(Date.parse(row.time)));
}

function flowTotals(value: unknown): Omit<MoneyFlowStory, "available" | "events"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { lifetimeInflowUsd: 0, lifetimeOutflowUsd: 0, lifetimeNetUsd: 0, last30dInflowUsd: 0, last30dOutflowUsd: 0 };
  }
  let lifetimeInflowUsd = 0;
  let lifetimeOutflowUsd = 0;
  let activeSince: string | undefined;
  let last30dInflowUsd = 0;
  let last30dOutflowUsd = 0;
  const cutoff = Date.now() - 30 * 86400000;

  for (const rows of Object.values(value as Record<string, unknown>)) {
    const chainRows = flattenFlow({ chain: rows }).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    if (!chainRows.length) continue;
    const first = chainRows[0];
    const last = chainRows[chainRows.length - 1];
    lifetimeInflowUsd += last.cumulativeInflow;
    lifetimeOutflowUsd += last.cumulativeOutflow;
    if (!activeSince || Date.parse(first.time) < Date.parse(activeSince)) activeSince = first.time;
    for (const row of chainRows) {
      if (Date.parse(row.time) >= cutoff) {
        last30dInflowUsd += row.inflow;
        last30dOutflowUsd += row.outflow;
      }
    }
  }

  return {
    activeSince,
    lifetimeInflowUsd,
    lifetimeOutflowUsd,
    lifetimeNetUsd: lifetimeInflowUsd - lifetimeOutflowUsd,
    last30dInflowUsd,
    last30dOutflowUsd,
  };
}

export function shapeMoneyFlowEvents(payload: unknown, baseAddress: string): MoneyFlowEvent[] {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as { transfers?: unknown }
    : {};
  if (!Array.isArray(body.transfers)) return [];
  const base = providerAddressKey(baseAddress);
  const events: MoneyFlowEvent[] = [];
  const seen = new Set<string>();

  for (const raw of body.transfers as Record<string, unknown>[]) {
    const from = raw?.fromAddress && typeof raw.fromAddress === "object" ? raw.fromAddress as RawAddress : {};
    const to = raw?.toAddress && typeof raw.toAddress === "object" ? raw.toAddress as RawAddress : {};
    const fromBase = providerAddressKey(text(from.address)) === base;
    const toBase = providerAddressKey(text(to.address)) === base;
    if (fromBase === toBase) continue;
    const direction: "in" | "out" = fromBase ? "out" : "in";
    const counterparty = direction === "out" ? to : from;
    const counterpartyEntity = counterparty.arkhamEntity;
    const at = text(raw.blockTimestamp);
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    const transactionHash = text(raw.transactionHash) || text(raw.id);
    const token = text(raw.tokenSymbol) || text(raw.tokenName) || text(raw.assetId) || "token";
    const id = [
      transactionHash || at,
      direction,
      token,
      text(counterparty.address),
      number(raw.unitValue),
      number(raw.historicalUSD),
    ].join(":");
    if (seen.has(id)) continue;
    seen.add(id);
    const type = text(counterpartyEntity?.type).toLowerCase();
    const depositService = text(counterparty.depositServiceID);
    events.push({
      id,
      at,
      direction,
      usd: Math.max(0, number(raw.historicalUSD)),
      token,
      amount: Math.max(0, number(raw.unitValue)),
      chain: text(raw.chain),
      counterparty: addressName(counterparty),
      counterpartyAddress: text(counterparty.address) || undefined,
      counterpartyType: type || undefined,
      counterpartyEntityId: text(counterpartyEntity?.id) || undefined,
      counterpartyTags: rawTags(counterpartyEntity),
      isExchange: type === "cex" || !!depositService,
      transactionHash: transactionHash || undefined,
    });
  }

  return events
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.usd - a.usd)
    .slice(0, 12);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const key = process.env.ARKHAM_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Arkham not configured." }); return; }
  const address = (typeof req.query.address === "string" ? req.query.address : "").trim();
  const chain = chainName(typeof req.query.chain === "string" ? req.query.chain : "");
  if (!address || address.length < 8) { res.status(400).json({ error: "address required" }); return; }

  const cacheKey = `arkham-money-flow:${chain ?? "all"}:${providerAddressKey(address)}:v1`;
  const cached = await cacheGetJson<MoneyFlowStory>(cacheKey);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  let calls = 0;
  let succeeded = 0;
  const get = async (url: string): Promise<unknown | null> => {
    calls += 1;
    try {
      const response = await fetch(url, {
        headers: { "API-Key": key },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) return null;
      const body = await response.json();
      succeeded += 1;
      return body;
    } catch {
      return null;
    }
  };

  try {
    const chainQuery = chain ? `?chains=${encodeURIComponent(chain)}` : "";
    const transferQuery = new URLSearchParams({
      base: address,
      flow: "all",
      timeLast: "365d",
      usdGte: "1000",
      sortKey: "time",
      sortDir: "desc",
      limit: "60",
      offset: "0",
    });
    if (chain) transferQuery.set("chains", chain);
    const [flow, transfers] = await Promise.all([
      get(`${FLOW}${encodeURIComponent(address)}${chainQuery}`),
      get(`${TRANSFERS}?${transferQuery.toString()}`),
    ]);
    if (!flow && !transfers) {
      res.status(200).json({ available: false, note: "Arkham money-flow lookup failed." });
      return;
    }
    const output: MoneyFlowStory = {
      available: true,
      ...flowTotals(flow),
      events: shapeMoneyFlowEvents(transfers, address),
    };
    await cacheSetJson(cacheKey, output);
    res.status(200).json(output);
  } catch (error) {
    res.status(200).json({ available: false, error: String(error), note: "Arkham money-flow lookup failed." });
  } finally {
    if (calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "arkham",
        op: "panel:arkham-money-flow",
        calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: succeeded === calls ? "succeeded" : succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
