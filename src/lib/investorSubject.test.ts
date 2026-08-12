import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { isInstitutionalInvestorAccount, isOrganizationAccount } from "./investorSubject";

const subject = (overrides: Partial<{ handle: string; display_name: string; resolved_name: string; bio: string }> = {}) => ({
  roles: [SubjectClass.INVESTOR],
  profile: {
    handle: "@theformsvc",
    display_name: "TheForms Ventures",
    bio: "We back founders building infrastructure for what comes next.",
    ...overrides,
  },
});

describe("isInstitutionalInvestorAccount", () => {
  it("separates fund accounts from individual investors", () => {
    expect(isInstitutionalInvestorAccount(subject())).toBe(true);
    expect(isInstitutionalInvestorAccount(subject({
      handle: "@1scottrupp",
      display_name: "Scott Rupp",
      resolved_name: "Scott Rupp",
      bio: "Founding General Partner, BITKRAFT Ventures.",
    }))).toBe(false);
  });

  it("does not classify non-investor brand accounts as funds", () => {
    expect(isInstitutionalInvestorAccount({
      ...subject(),
      roles: [SubjectClass.PROJECT],
    })).toBe(false);
  });

  it("recognizes an agency brand without turning an individual consultant into an organization", () => {
    expect(isOrganizationAccount({
      roles: [SubjectClass.AGENCY],
      profile: {
        handle: "@acmegrowth",
        display_name: "Acme Growth Studio",
        bio: "We help companies grow through product and marketing.",
      },
    })).toBe(true);
    expect(isOrganizationAccount({
      roles: [SubjectClass.AGENCY],
      profile: {
        handle: "@janedoe",
        display_name: "Jane Doe",
        resolved_name: "Jane Doe",
        bio: "Growth consultant and advisor.",
      },
    })).toBe(false);
  });
});
