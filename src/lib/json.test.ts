import { describe, expect, it } from "vitest";
import { arr, bool, isRecord, num, rec, str } from "./json";

// These assertions exist to pin the helpers to the coercions the `any` call
// sites already performed. If one of them changes, a file narrowed onto these
// helpers would start reading provider payloads differently, which is the one
// outcome this work must not produce.

describe("isRecord", () => {
  it("accepts plain objects only", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("x")).toBe(false);
  });
});

describe("rec", () => {
  it("mirrors optional chaining into a missing object", () => {
    expect(rec({ a: 1 })).toEqual({ a: 1 });
    expect(rec(null).missing).toBeUndefined();
    expect(rec([]).missing).toBeUndefined();
    expect(rec("nope").missing).toBeUndefined();
  });

  it("returns the same reference for a real record", () => {
    const source = { a: 1 };
    expect(rec(source)).toBe(source);
  });
});

describe("arr", () => {
  it("mirrors Array.isArray(x) ? x : []", () => {
    expect(arr([1, 2])).toEqual([1, 2]);
    expect(arr(null)).toEqual([]);
    expect(arr({ length: 2 })).toEqual([]);
  });
});

describe("str", () => {
  it("mirrors String(x ?? \"\")", () => {
    expect(str("a")).toBe("a");
    expect(str(null)).toBe("");
    expect(str(undefined)).toBe("");
    expect(str(0)).toBe("0");
    expect(str(false)).toBe("false");
  });
});

describe("num", () => {
  it("mirrors Number(x ?? 0)", () => {
    expect(num(2)).toBe(2);
    expect(num("2")).toBe(2);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
  });

  it("keeps NaN for a present non-numeric value rather than inventing a zero", () => {
    expect(Number.isNaN(num("abc"))).toBe(true);
  });
});

describe("bool", () => {
  it("mirrors !!x", () => {
    expect(bool(1)).toBe(true);
    expect(bool(0)).toBe(false);
    expect(bool("")).toBe(false);
    expect(bool(undefined)).toBe(false);
  });
});
