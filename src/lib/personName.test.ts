import { describe, expect, it } from "vitest";
import { isPlausiblePersonRosterIdentity, isPlausiblePersonRosterName } from "./personName";

describe("person roster names", () => {
  it("admits real and pseudonymous human names", () => {
    expect(isPlausiblePersonRosterName("Stani Kulechov")).toBe(true);
    expect(isPlausiblePersonRosterName("Dr. Anna Müller")).toBe(true);
    expect(isPlausiblePersonRosterName("J. Smith")).toBe(true);
    expect(isPlausiblePersonRosterName("@S0Ldev")).toBe(true);
  });

  it("rejects organizations, job titles, and prose", () => {
    expect(isPlausiblePersonRosterName("Clutch Markets")).toBe(false);
    expect(isPlausiblePersonRosterName("Paradigm Capital")).toBe(false);
    expect(isPlausiblePersonRosterName("Chief Technical Officer")).toBe(false);
    expect(isPlausiblePersonRosterName("Alice is building the protocol")).toBe(false);
    expect(isPlausiblePersonRosterName("Meet the team: our founders")).toBe(false);
  });

  // A screen name with a digit is the normal case for a crypto operator, and no
  // human-name shape can admit it. The handle the subject's own edge bound is
  // the unique id, so the row has to survive its display name.
  it("keeps a first-party handle whose display name is a pseudonymous screen name", () => {
    expect(isPlausiblePersonRosterName("S0Ldev")).toBe(false);
    expect(isPlausiblePersonRosterIdentity({
      name: "S0Ldev",
      handle: "@S0Ldev",
      handleBoundBySubject: true,
    })).toBe(true);
    expect(isPlausiblePersonRosterIdentity({
      name: "blknoiz06",
      handle: "@blknoiz06",
      handleBoundBySubject: true,
    })).toBe(true);
  });

  it("still rejects prose, titles, and organizations behind a first-party handle", () => {
    expect(isPlausiblePersonRosterIdentity({
      name: "Meet the team behind the protocol",
      handle: "@someproject",
      handleBoundBySubject: true,
    })).toBe(false);
    expect(isPlausiblePersonRosterIdentity({
      name: "founder",
      handle: "@someproject",
      handleBoundBySubject: true,
    })).toBe(false);
    expect(isPlausiblePersonRosterIdentity({
      name: "Labs",
      handle: "@somelabs",
      handleBoundBySubject: true,
    })).toBe(false);
  });

  it("judges a candidate the subject never bound on its name alone", () => {
    expect(isPlausiblePersonRosterIdentity({ name: "S0Ldev", handle: "@S0Ldev" })).toBe(false);
    expect(isPlausiblePersonRosterIdentity({
      name: "S0Ldev",
      handle: "@S0Ldev",
      handleBoundBySubject: false,
    })).toBe(false);
    expect(isPlausiblePersonRosterIdentity({ name: "Stani Kulechov" })).toBe(true);
  });
});
