import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUNTIME_MODULES = [
  "./early-buyers.ts",
  "./holders.ts",
  "./deployer-origin.ts",
  "./deployer.ts",
  "./funder.ts",
  "./cluster.ts",
  "./evm-cluster.ts",
  "../server/adapters/gmgn.ts",
];

describe("production forensic route imports", () => {
  it.each(RUNTIME_MODULES)("uses Node ESM-resolvable local imports in %s", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    const localSpecifiers = [...source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)]
      .map((match) => match[1]);

    expect(localSpecifiers.length).toBeGreaterThan(0);
    expect(localSpecifiers.filter((specifier) => !specifier.endsWith(".js"))).toEqual([]);
  });
});
