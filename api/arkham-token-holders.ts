// Arkham token-holder entities. GET /api/arkham-token-holders?address=<token>&chain=<chain>
//
// Raw holder lists can make one owner look like several independent holders.
// Arkham's groupByEntity view joins addresses it attributes to the same real-
// world actor. This route preserves both views so the UI can say "Arkham groups
// at least 4 visible wallets under Entity X" without treating exchange custody
// as one beneficial owner.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";
import { providerAddressKey } from "../src/lib/providerAddress.js";

export const config = { maxDuration: 20 };

const BASE = "https://api.arkm.com/token/holders/";
const SERVICE_TYPES = new Set(["cex", "dex", "bridge", "defi", "exchange", "pool", "protocol"]);

type RawTag = { id?: unknown; label?: unknown; rank?: unknown };
type RawEntity = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  service?: unknown;
  addresses?: unknown;
  populatedTags?: unknown;
};

export type ArkhamHolderEntity = {
  id: string;
  name: string;
  type?: string;
  percent: number;
  usd: number;
  balance: number;
  observedWallets: number;
  knownWallets?: number;
  isService: boolean;
  tags: string[];
};

export type ArkhamHolderGroups = {
  available: boolean;
  entities: ArkhamHolderEntity[];
  knownEntityPercent: number;
  groupedEntityCount: number;
  largestNonService?: ArkhamHolderEntity;
};

const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const percent = (value: unknown): number => {
  const parsed = number(value);
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
};

function chainName(raw: string): string | null {
  const value = raw.trim().toLowerCase();
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

function flattenRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>)
    .flatMap((rows) => Array.isArray(rows) ? rows : [])
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

function countKnownWallets(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const total = Object.values(value as Record<string, unknown>)
    .reduce<number>((sum, addresses) => sum + (Array.isArray(addresses) ? addresses.length : 0), 0);
  return total > 0 ? total : undefined;
}

function entityTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as RawTag[])
    .filter((tag) => text(tag?.label))
    .sort((a, b) => number(a?.rank) - number(b?.rank))
    .map((tag) => text(tag.label))
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 4);
}

export function shapeArkhamHolderGroups(payload: unknown): ArkhamHolderGroups {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const addressRows = flattenRows(body.addressTopHolders);
  const entityRows = flattenRows(body.entityTopHolders);
  const observedByEntity = new Map<string, number>();

  for (const row of addressRows) {
    const address = row.address && typeof row.address === "object"
      ? row.address as Record<string, unknown>
      : {};
    const entity = address.arkhamEntity && typeof address.arkhamEntity === "object"
      ? address.arkhamEntity as RawEntity
      : null;
    const id = text(entity?.id).toLowerCase();
    if (id) observedByEntity.set(id, (observedByEntity.get(id) ?? 0) + 1);
  }

  const entities: ArkhamHolderEntity[] = [];
  const seen = new Set<string>();
  for (const row of entityRows) {
    const entity = row.entity && typeof row.entity === "object" ? row.entity as RawEntity : null;
    const id = text(entity?.id).toLowerCase();
    const name = text(entity?.name);
    if (!entity || !id || !name || seen.has(id)) continue;
    seen.add(id);
    const type = text(entity.type).toLowerCase() || undefined;
    entities.push({
      id,
      name,
      type,
      percent: Math.max(0, Math.min(100, percent(row.pctOfCap))),
      usd: Math.max(0, number(row.usd)),
      balance: Math.max(0, number(row.balance)),
      observedWallets: observedByEntity.get(id) ?? 0,
      knownWallets: countKnownWallets(entity.addresses),
      isService: entity.service === true || (type ? SERVICE_TYPES.has(type) : false),
      tags: entityTags(entity.populatedTags),
    });
  }

  entities.sort((a, b) => b.percent - a.percent || b.usd - a.usd);
  const top = entities.slice(0, 12);
  return {
    available: true,
    entities: top,
    knownEntityPercent: Math.min(100, top.reduce((sum, entity) => sum + entity.percent, 0)),
    groupedEntityCount: top.filter((entity) => entity.observedWallets > 1).length,
    largestNonService: top.find((entity) => !entity.isService),
  };
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
  if (!chain) { res.status(400).json({ error: "supported chain required" }); return; }

  const cacheKey = `arkham-token-holders:${chain}:${providerAddressKey(address)}:v1`;
  const cached = await cacheGetJson<ArkhamHolderGroups>(cacheKey);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  let succeeded = 0;
  try {
    const response = await fetch(
      `${BASE}${encodeURIComponent(chain)}/${encodeURIComponent(address)}?groupByEntity=true&limit=100&offset=0`,
      { headers: { "API-Key": key }, redirect: "follow", signal: AbortSignal.timeout(14000) },
    );
    if (!response.ok) {
      res.status(200).json({ available: false, note: `Arkham ${response.status}` });
      return;
    }
    const output = shapeArkhamHolderGroups(await response.json());
    succeeded = 1;
    await cacheSetJson(cacheKey, output);
    res.status(200).json(output);
  } catch (error) {
    res.status(200).json({ available: false, error: String(error), note: "Arkham holder grouping failed." });
  } finally {
    await attachPanelCost(auth.organizationId, panelCostVersionId, {
      provider: "arkham",
      op: "panel:arkham-token-holders",
      calls: 1,
      usd: 0,
      meta: "subscription/keyed",
      initiatedBy: auth.userId,
      status: succeeded ? "succeeded" : "failed",
    });
  }
}
