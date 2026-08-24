// Crunchbase adapter. Funding/venture truth: rounds, investors, acquirers — the
// raw material for F2 track record, F3 repeat backing, I2 portfolio quality.
// Gated on CRUNCHBASE_API_KEY. Full entity resolution (which orgs belong to the
// subject) is an agent step; this adapter verifies named orgs and their funding.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";
import { env } from "../config";

const BASE = "https://api.crunchbase.com/api/v4";

export async function lookupOrganization(name: string) {
  const key = env("CRUNCHBASE_API_KEY");
  if (!key) return null;
  const meta = "plan-billed";
  let res: Response;
  try {
    res = await fetch(`${BASE}/searches/organizations`, {
      method: "POST",
      headers: { "X-cb-user-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        field_ids: ["identifier", "funding_total", "num_funding_rounds", "investor_identifiers", "acquirer_identifier"],
        query: [{ type: "predicate", field_id: "identifier", operator_id: "contains", values: [name] }],
        limit: 1,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    recordCall("crunchbase", "org-search", 0, `${meta} · transport_error`, "failed");
    return null;
  }
  if (!res.ok) {
    recordCall("crunchbase", "org-search", 0, `${meta} · http_${res.status}`, "failed");
    return null;
  }

  let value: unknown;
  try { value = await res.json(); }
  catch {
    recordCall("crunchbase", "org-search", 0, `${meta} · response_json_error`, "failed");
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    recordCall("crunchbase", "org-search", 0, `${meta} · result_shape_error`, "partial");
    return null;
  }
  const d = value as { entities?: Array<{ properties?: Record<string, unknown> }> };
  if (!Array.isArray(d.entities)) {
    recordCall("crunchbase", "org-search", 0, `${meta} · result_shape_error`, "partial");
    return null;
  }
  if (!d.entities.length) {
    recordCall("crunchbase", "org-search", 0, `${meta} · no_match`, "succeeded");
    return null;
  }
  const e = d.entities[0]?.properties;
  const identifier = e?.identifier && typeof e.identifier === "object" && !Array.isArray(e.identifier)
    ? e.identifier as Record<string, unknown>
    : null;
  const resolvedName = identifier?.value;
  if (!e || typeof e !== "object" || typeof resolvedName !== "string" || !resolvedName.trim()) {
    recordCall("crunchbase", "org-search", 0, `${meta} · result_shape_error`, "partial");
    return null;
  }
  const rawInvestors = e.investor_identifiers;
  const investorShapeOkay = rawInvestors == null || Array.isArray(rawInvestors);
  const investors = (Array.isArray(rawInvestors) ? rawInvestors : [])
    .map((investor: unknown) => investor && typeof investor === "object" && !Array.isArray(investor)
      ? (investor as Record<string, unknown>).value
      : undefined)
    .filter((value: unknown): value is string => typeof value === "string" && !!value.trim());
  recordCall(
    "crunchbase",
    "org-search",
    0,
    investorShapeOkay ? meta : `${meta} · incomplete_investor_shape`,
    investorShapeOkay ? "succeeded" : "partial",
  );
  return {
    name: resolvedName,
    fundingTotal: e.funding_total && typeof e.funding_total === "object" && !Array.isArray(e.funding_total)
      ? (e.funding_total as Record<string, unknown>).value_usd
      : undefined,
    rounds: typeof e.num_funding_rounds === "number" ? e.num_funding_rounds : undefined,
    investors,
    acquirer: e.acquirer_identifier && typeof e.acquirer_identifier === "object" && !Array.isArray(e.acquirer_identifier)
      && typeof (e.acquirer_identifier as Record<string, unknown>).value === "string"
      ? (e.acquirer_identifier as Record<string, unknown>).value as string
      : undefined,
  };
}

export const crunchbaseAdapter: Adapter = {
  id: "crunchbase",
  label: "Crunchbase",
  available: () => !!env("CRUNCHBASE_API_KEY"),
  async run(ctx: CollectContext) {
    if (!ctx.evidence.ventures.length) return;
    ctx.emit({ phase: "Founder", label: "Verify funding", detail: `Cross-referencing ${ctx.evidence.ventures.length} venture(s) against Crunchbase…`, tone: "neutral" });
    let matched = 0;
    for (const v of ctx.evidence.ventures) {
      const org = await lookupOrganization(v.project_name);
      if (!org) {
        ctx.emit({ phase: "Founder", label: v.project_name, detail: "no Crunchbase record found for claimed venture", source: "crunchbase", tone: "warn" });
        continue;
      }
      matched += 1;
      if (org.investors?.length) v.investors = Array.from(new Set([...(v.investors ?? []), ...org.investors]));
      if (org.acquirer && !v.acquirer) v.acquirer = org.acquirer;
      ctx.emit({ phase: "Founder", label: v.project_name, detail: `verified · ${org.rounds ?? 0} rounds, backers: ${(org.investors ?? []).slice(0, 3).join(", ") || "n/a"}`, source: "crunchbase", tone: "good" });
    }
    // An organization record proves that the company exists, not that this
    // audited person/fund invested in or founded it. The source-agnostic
    // portfolio verifier owns vc-portfolio-track-record and requires an actual
    // relationship statement before completing that check.
    ctx.emit({
      phase: "Founder",
      label: "Crunchbase enrichment complete",
      detail: `${matched}/${ctx.evidence.ventures.length} named organization${ctx.evidence.ventures.length === 1 ? "" : "s"} matched; company records were treated as enrichment, not relationship proof.`,
      source: "crunchbase",
      tone: "neutral",
    });
  },
};
