// The ARGUS engine response parser lives in api/code-review.ts (server-side). It's a
// pure function, so we test it here to lock down the robustness contract: a
// clean JSON reply, a fenced block, and raw prose must all yield a usable read
// rather than the old hard "unparseable output" failure.
import { describe, expect, it } from "vitest";
import { parseReview } from "../../api/code-review";

describe("parseReview", () => {
  it("parses a clean JSON reply", () => {
    const r = parseReview('{"summary":"Fixed-supply ERC-20, no mint. Safe.","dissent":"cleaner"}');
    expect(r?.summary).toBe("Fixed-supply ERC-20, no mint. Safe.");
    expect(r?.dissent).toBe("cleaner");
  });

  it("parses JSON wrapped in prose", () => {
    const r = parseReview('Here is my read:\n{"summary":"Has a live mint.","dissent":"darker"}\nHope that helps.');
    expect(r?.summary).toBe("Has a live mint.");
    expect(r?.dissent).toBe("darker");
  });

  it("normalizes an invalid dissent value to null", () => {
    const r = parseReview('{"summary":"Reads clean.","dissent":"maybe"}');
    expect(r?.dissent).toBeNull();
  });

  it("falls back to raw prose as the summary when there is no JSON", () => {
    const prose = "I read the full source. It is a fixed-supply token with no admin keys. The code is clean.";
    const r = parseReview(prose);
    expect(r?.summary).toBe(prose);
    expect(r?.dissent).toBeNull();
  });

  it("infers dissent from prose when only one direction is mentioned", () => {
    const r = parseReview("The mechanical flags overstate this — the code reads cleaner than the score.");
    expect(r?.dissent).toBe("cleaner");
  });

  it("strips a ```json fence when the body isn't valid JSON", () => {
    const r = parseReview("```json\nnot really json, just prose in a fence\n```");
    expect(r?.summary).toBe("not really json, just prose in a fence");
  });

  it("returns null on empty input", () => {
    expect(parseReview("")).toBeNull();
    expect(parseReview("   ")).toBeNull();
  });

  it("caps an overlong summary", () => {
    const r = parseReview(JSON.stringify({ summary: "x".repeat(5000), dissent: null }));
    expect(r!.summary.length).toBe(4000);
  });
});
