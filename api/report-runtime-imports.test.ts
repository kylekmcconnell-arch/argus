import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Vite resolves extensionless imports that native Node ESM rejects. Inspect
// emitted runtime edges recursively, including shared helpers outside api/.
describe("report API native ESM dependency graph", () => {
  it.each(["report", "share", "gap-investigation", "x-authenticity", "v1/token", "deep-launch"])(
    "%s has deployable transitive runtime imports",
    (route) => {
      const seen = new Set<string>();
      const failures: string[] = [];
      function visit(file: string) {
        if (seen.has(file)) return;
        seen.add(file);
        const source = readFileSync(file, "utf8");
        const output = file.endsWith(".ts") ? ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText : source;
        const syntax = ts.createSourceFile(file, output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
        function inspect(node: ts.Node) {
          const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            ? node.moduleSpecifier
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0] : undefined;
          if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
            const ref = specifier.text;
            if (!/\.m?js$/.test(ref)) failures.push(`${file}: ${ref} needs a .js or .mjs suffix`);
            const jsFile = resolve(dirname(file), ref);
            const tsFile = jsFile.replace(/\.js$/, ".ts");
            const next = existsSync(tsFile) ? tsFile : jsFile;
            if (!existsSync(next)) failures.push(`${file}: ${ref} is missing`);
            else visit(next);
          }
          ts.forEachChild(node, inspect);
        }
        inspect(syntax);
      }
      visit(resolve("api", `${route}.ts`));
      expect(seen.size).toBeGreaterThan(1);
      expect(failures).toEqual([]);
    },
  );
});
