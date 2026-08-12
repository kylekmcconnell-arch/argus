import { describe, expect, it } from "vitest";
import { parseEvalHarnessArgs } from "./evalHarnessArgs";

describe("parseEvalHarnessArgs", () => {
  it("does not treat a spaced allow-live host list as another subject", () => {
    const parsed = parseEvalHarnessArgs([
      "@uniswap",
      "--allow-live",
      "google.serper.dev,openrouter.ai",
    ]);

    expect(parsed.subjects).toEqual(["@uniswap"]);
    expect(parsed.allowLiveHosts).toEqual(["google.serper.dev", "openrouter.ai"]);
  });

  it("supports equals syntax and an explicit force-live variance lane", () => {
    const parsed = parseEvalHarnessArgs([
      "@uniswap",
      "--allow-live=google.serper.dev",
      "--force-live-tool",
      "record_verdict",
      "--all",
    ]);

    expect(parsed.subjects).toEqual(["@uniswap"]);
    expect(parsed.allowLiveHosts).toEqual(["google.serper.dev"]);
    expect(parsed.forceLiveTools).toEqual(["record_verdict"]);
    expect(parsed.flags.has("--all")).toBe(true);
  });
});
