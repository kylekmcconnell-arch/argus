// OFAC SDN name screen for a resolved real person. GET /api/sanctions-name?name=<full name>
//
// Address screening (api/sanctions) catches a sanctioned WALLET; this catches a
// sanctioned PERSON by name — a founder, funder, or named associate on the US
// Treasury SDN list. Source: OpenSanctions' free bulk mirror of us_ofac_sdn
// (targets.simple.csv, ~7MB, public). We fetch once, build a normalized index of
// every sanctioned individual's name + aliases, cache it, and require an EXACT
// normalized full-name (or full-alias) match — surname-only matching would light
// up on every common name, so we don't do it. A hit is a hard AVOID; framed, like
// the legal screen, as "verify the identity match — a name is not a person."
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 25 };

const SRC = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv";
const IDX_KEY = "ofacname:v2";

// Fold accents, drop honorifics + punctuation, collapse whitespace. The two sides
// of a comparison must normalize identically for an exact match to mean anything.
function norm(s: string): string {
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(mr|mrs|ms|dr|prof|sir|dame|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Parse the first `n` CSV fields of one line, respecting double-quoted fields
// (fields can contain commas). We only need schema(1), name(2), aliases(3).
function firstFields(line: string, n: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (out.length < n && i <= line.length) {
    let field = "";
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 2; continue; }
          i++; break;
        }
        field += line[i++];
      }
      if (line[i] === ",") i++;
    } else {
      while (i < line.length && line[i] !== ",") field += line[i++];
      if (line[i] === ",") i++;
    }
    out.push(field);
  }
  return out;
}

async function sanctionedNames(): Promise<Set<string>> {
  const cached = await cacheGetJson<{ names: string }>(IDX_KEY);
  if (cached?.names) return new Set(cached.names.split("\n"));
  const set = new Set<string>();
  const r = await fetch(SRC, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) return set;
  const text = await r.text();
  const lines = text.split("\n");
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (!line || line.indexOf('"Person"') === -1) continue;
    const [, schema, name, aliases] = firstFields(line, 4);
    if (schema !== "Person") continue;
    for (const raw of [name, ...(aliases ? aliases.split(";") : [])]) {
      const nm = norm(raw || "");
      // Require a real multi-token name — a single mononym is too collision-prone.
      if (nm && nm.indexOf(" ") !== -1) set.add(nm);
    }
  }
  if (set.size) await cacheSetJson(IDX_KEY, { names: [...set].join("\n") });
  return set;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = (typeof req.query.name === "string" ? req.query.name : "").trim().replace(/^@/, "").slice(0, 80);
  const q = norm(name);
  if (q.split(" ").filter(Boolean).length < 2) { res.status(200).json({ available: false, note: "Sanctions screen needs a resolved real name." }); return; }
  try {
    const set = await sanctionedNames();
    if (!set.size) { res.status(200).json({ available: false, note: "OFAC SDN list unavailable." }); return; }
    // Exact full-name (or full-alias) match only. Also try the reversed order,
    // since transliterated lists flip given/family order inconsistently.
    const toks = q.split(" ");
    const reversed = [toks[toks.length - 1], ...toks.slice(0, -1)].join(" ");
    const sanctioned = set.has(q) || set.has(reversed);
    res.status(200).json({ available: true, name, listSize: set.size, sanctioned, list: "US Treasury OFAC SDN" });
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Sanctions name screen failed." });
  }
}
