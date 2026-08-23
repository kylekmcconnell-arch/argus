import { readFile } from "node:fs/promises";
import { parseBetaQualityRow, summarizeBetaQuality } from "../src/lib/betaQuality";

const input = process.argv[2];
if (!input) throw new Error("Usage: npm run beta:measure -- path/to/private-export.jsonl");

const lines = (await readFile(input, "utf8")).split(/\r?\n/).filter((line) => line.trim());
const rows = lines.map((line, index) => {
  try {
    return parseBetaQualityRow(JSON.parse(line));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid row";
    throw new Error(`Invalid data on line ${index + 1}: ${detail}.`, { cause: error });
  }
});

process.stdout.write(`${JSON.stringify(summarizeBetaQuality(rows), null, 2)}\n`);
