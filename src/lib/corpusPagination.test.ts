import { expect, it } from "vitest";
import { readAllCorpusRows } from "./corpusPagination";
it("accounts for more than 1000 rows even when the server silently caps pages", async () => {
  const all = Array.from({ length: 1503 }, (_, n) => ({ id: String(n + 1).padStart(6, "0"), display_query: "Duplicate name" }));
  const result = await readAllCorpusRows("reports?select=id", async (path) => {
    const cursor = new URL(`https://db.example/${path}`).searchParams.get("id")?.slice(3) ?? "";
    return all.filter((r) => r.id > cursor).slice(0, 100);
  });
  expect(result).toEqual(all);
});
it("fails instead of silently repeating or truncating a broken cursor", async () => {
  await expect(readAllCorpusRows("reports?select=id", async () => [{ id: "same" }])).rejects.toThrow("cursor failed");
});
