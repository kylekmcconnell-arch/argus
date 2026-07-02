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
  try {
    recordCall("crunchbase", "org-search", 0, "plan-billed");
    const res = await fetch(`${BASE}/searches/organizations`, {
      method: "POST",
      headers: { "X-cb-user-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        field_ids: ["identifier", "funding_total", "num_funding_rounds", "investor_identifiers", "acquirer_identifier"],
        query: [{ type: "predicate", field_id: "identifier", operator_id: "contains", values: [name] }],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const e = d.entities?.[0]?.properties;
    if (!e) return null;
    return {
      name: e.identifier?.value,
      fundingTotal: e.funding_total?.value_usd,
      rounds: e.num_funding_rounds,
      investors: (e.investor_identifiers ?? []).map((i: any) => i.value),
      acquirer: e.acquirer_identifier?.value,
    };
  } catch {
    return null;
  }
}

export const crunchbaseAdapter: Adapter = {
  id: "crunchbase",
  label: "Crunchbase",
  available: () => !!env("CRUNCHBASE_API_KEY"),
  async run(ctx: CollectContext) {
    if (!ctx.evidence.ventures.length) return;
    ctx.emit({ phase: "Founder", label: "Verify funding", detail: `Cross-referencing ${ctx.evidence.ventures.length} venture(s) against Crunchbase…`, tone: "neutral" });
    for (const v of ctx.evidence.ventures) {
      const org = await lookupOrganization(v.project_name);
      if (!org) {
        ctx.emit({ phase: "Founder", label: v.project_name, detail: "no Crunchbase record found for claimed venture", source: "crunchbase", tone: "warn" });
        continue;
      }
      if (org.investors?.length) v.investors = Array.from(new Set([...(v.investors ?? []), ...org.investors]));
      if (org.acquirer && !v.acquirer) v.acquirer = org.acquirer;
      ctx.emit({ phase: "Founder", label: v.project_name, detail: `verified · ${org.rounds ?? 0} rounds, backers: ${(org.investors ?? []).slice(0, 3).join(", ") || "n/a"}`, source: "crunchbase", tone: "good" });
    }
  },
};
