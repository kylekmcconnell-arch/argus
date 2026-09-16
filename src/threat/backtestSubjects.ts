// Turning saved reports into backtest subjects. Every saved token or
// investigation report that carries a frozen development read names a GitHub
// target, a chain, an address and the capture date: exactly a backtest
// subject with `asOf` at capture. Pure, so the script that reads the database
// and the test that does not share one rule.

export interface BacktestSubject {
  label: string;
  target: string;
  kind: "org" | "repo";
  chain: string;
  address: string;
  asOf: string;
  note?: string;
}

/** One saved report row as the reports table projects it (token fields at the root or under `token`). */
export interface SavedReportRow {
  ref: string;
  kind: string;
  symbol?: string | null;
  chain?: string | null;
  address?: string | null;
  shipping?: { target?: string; capturedAt?: string; grade?: string } | null;
  tsymbol?: string | null;
  tchain?: string | null;
  taddress?: string | null;
  tshipping?: SavedReportRow["shipping"];
}

export function subjectsFromReports(rows: SavedReportRow[], existing: BacktestSubject[], opts: { now?: number; minAgeDays?: number } = {}): { merged: BacktestSubject[]; added: BacktestSubject[] } {
  const now = opts.now ?? Date.now();
  const cutoff = now - (opts.minAgeDays ?? 30) * 864e5;
  const seen = new Set(existing.map((s) => `${s.target.toLowerCase()}|${s.address.toLowerCase()}`));
  const added: BacktestSubject[] = [];
  // Oldest capture first, so the row kept for a subject carries the longest horizon.
  const ordered = [...rows].sort((a, b) => {
    const at = (r: SavedReportRow) => Date.parse((r.kind === "token" ? r.shipping : r.tshipping)?.capturedAt ?? "") || 0;
    return at(a) - at(b);
  });
  for (const row of ordered) {
    const ship = row.kind === "token" ? row.shipping : row.tshipping;
    const symbol = row.kind === "token" ? row.symbol : row.tsymbol;
    const chain = row.kind === "token" ? row.chain : row.tchain;
    const address = row.kind === "token" ? row.address : row.taddress;
    if (!ship?.target || !ship.capturedAt || !chain || !address || ship.grade === "unknown") continue;
    const at = Date.parse(ship.capturedAt);
    if (!Number.isFinite(at) || at > cutoff) continue;
    const k = `${ship.target.toLowerCase()}|${address.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    added.push({
      label: (symbol || ship.target).toUpperCase().slice(0, 12),
      target: ship.target,
      kind: ship.target.includes("/") ? "repo" : "org",
      chain,
      address,
      asOf: ship.capturedAt.slice(0, 10),
      note: `from saved ${row.kind} report; graded ${ship.grade} at capture`,
    });
  }
  return { merged: [...existing, ...added], added };
}
