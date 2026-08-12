import { afterEach, describe, expect, it } from "vitest";
import { captureTimestamp } from "./captureTime";

const priorMode = process.env.ARGUS_EVAL_MODE;
const priorCapturedAt = process.env.ARGUS_EVAL_CAPTURED_AT;

afterEach(() => {
  if (priorMode === undefined) delete process.env.ARGUS_EVAL_MODE;
  else process.env.ARGUS_EVAL_MODE = priorMode;
  if (priorCapturedAt === undefined) delete process.env.ARGUS_EVAL_CAPTURED_AT;
  else process.env.ARGUS_EVAL_CAPTURED_AT = priorCapturedAt;
});

describe("captureTimestamp", () => {
  it("uses the recording boundary for a replay", () => {
    process.env.ARGUS_EVAL_MODE = "replay";
    process.env.ARGUS_EVAL_CAPTURED_AT = "2026-07-20T14:11:12Z";
    expect(captureTimestamp()).toBe("2026-07-20T14:11:12.000Z");
  });

  it("does not accept a malformed replay clock", () => {
    process.env.ARGUS_EVAL_MODE = "replay";
    process.env.ARGUS_EVAL_CAPTURED_AT = "not-a-date";
    expect(Number.isFinite(Date.parse(captureTimestamp()))).toBe(true);
  });
});
