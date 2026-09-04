// @ts-expect-error -- test-only access to checked-in stylesheets.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("./", import.meta.url);

describe("Kyle lane stylesheets", () => {
  it("scope every rule to both the Kyle lane and the promoted Production lane", () => {
    const files: string[] = readdirSync(dir).filter((file: string) => file.endsWith(".css"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const css: string = readFileSync(new URL(file, dir), "utf8");
      const bare = css.split(":is([data-report-lane=\"kyle\"], [data-report-lane=\"production\"])").join("");
      expect(bare, `${file} has a rule scoped to the Kyle lane only`).not.toContain("[data-report-lane=\"kyle\"]");
      expect(css).toContain("[data-report-lane=\"production\"]");
    }
  });
});
