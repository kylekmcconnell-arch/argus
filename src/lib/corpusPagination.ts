export async function readAllCorpusRows(path: string, readPage: (path: string) => Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  // Stable IDs and keyset pagination avoid offset drift and server row caps.
  let cursor = "";
  for (let page = 0; page < 10000; page++) {
    const batch = await readPage(`${path}&order=id.asc&limit=500${cursor ? `&id=gt.${encodeURIComponent(cursor)}` : ""}`);
    if (!batch.length) return rows;
    const last = batch[batch.length - 1].id;
    if (typeof last !== "string" || last <= cursor) throw new Error("Report corpus cursor failed to advance");
    rows.push(...batch);
    cursor = last;
  }
  throw new Error("Report corpus safety bound reached; refusing a truncated summary");
}

