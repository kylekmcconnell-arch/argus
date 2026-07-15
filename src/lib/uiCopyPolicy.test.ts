// Vitest runs this policy check in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the tracked source list.
import { execFileSync } from "node:child_process";
// @ts-expect-error -- test-only access to checked-in source files.
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../", import.meta.url);
const emDash = String.fromCodePoint(0x2014);

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function isCopyNode(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.StringLiteral
    || node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    || node.kind === ts.SyntaxKind.TemplateHead
    || node.kind === ts.SyntaxKind.TemplateMiddle
    || node.kind === ts.SyntaxKind.TemplateTail
    || node.kind === ts.SyntaxKind.JsxText;
}

describe("ARGUS UI copy policy", () => {
  it("keeps authored runtime copy free of em dashes", () => {
    const trackedFiles = String(execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" }));
    const files: string[] = trackedFiles
      .split("\n")
      .filter((file: string) => /^(?:src|api|server)\/.+\.tsx?$/.test(file) || file === "middleware.ts");
    const violations: string[] = [];

    for (const file of files) {
      const sourceText = readFileSync(new URL(file, repoRoot), "utf8");
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind(file));

      function visit(node: ts.Node): void {
        if (isCopyNode(node)) {
          const rawText = sourceText.slice(node.getStart(source), node.getEnd());
          if (rawText.includes(emDash)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
            violations.push(`${file}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(source);
    }

    expect(violations, `Replace em dashes in authored runtime copy:\n${violations.join("\n")}`).toEqual([]);
    // Parses every tracked src/api/server TS file with the TypeScript compiler,
    // so the default 5s cap is too tight (and tightens as the repo grows). The
    // generous timeout keeps the assertion meaningful rather than load-flaky.
  }, 30_000);
});
