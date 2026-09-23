// Offline receipt ingestion only: no provider requests or paid backfills.
import { readFile, writeFile } from "node:fs/promises";
import { appendStudyPage, readStudyLedger, studyCoverage, PLATFORMS, type StudyPage } from "../server/launchpads/study.js";
const [command, ledgerPath, pagePath, outputPath] = process.argv.slice(2);
if (!ledgerPath || !["init", "status", "append"].includes(command)) throw new Error("Usage: tsx scripts/launchpad-study.ts init <new-ledger> | status <ledger> | append <ledger> <page.json> <new-ledger>");
if (command === "init") {
  await writeFile(ledgerPath, JSON.stringify({ version: 1, receipts: [] }, null, 2) + "\n", { flag: "wx" });
} else {
  const ledger = readStudyLedger(JSON.parse(await readFile(ledgerPath, "utf8")));
  if (command === "append") {
    if (!pagePath || !outputPath) throw new Error("Append requires a page and a new output path; previous ledgers are immutable");
    const next = appendStudyPage(ledger, JSON.parse(await readFile(pagePath, "utf8")) as StudyPage);
    await writeFile(outputPath, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
  } else {
    const coverage = studyCoverage(ledger);
    console.log(JSON.stringify({ coverage, missingPlatforms: PLATFORMS.filter(p => !coverage.some(c => c.platform === p)),
      limitations: ["Coverage and attribution are source claims, not independent verification.", "No Arkham/Fomo enrichment or historical outcome evaluation is implied.", "Missing listings mean unchecked; they do not mean unlisted."] }, null, 2));
  }
}
