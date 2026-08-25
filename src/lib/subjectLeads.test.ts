import { describe, expect, it } from "vitest";
import type { Finding } from "../engine/audit";
import { speakerHandleFromLead } from "./subjectLeads";

const lead = (source_url: string, source_author?: string): Finding => ({
  finding_type: "AdverseLead",
  claim: "an unverified accusation",
  source_url,
  source_date: "",
  ...(source_author ? { source_author } : {}),
  verification_status: "Rumor",
  independent_source_count: 1,
  polarity: -1,
});

describe("speakerHandleFromLead", () => {
  it("reads the speaker from an X status URL or an @author", () => {
    expect(speakerHandleFromLead(lead("https://x.com/zachxbt/status/123"))).toBe("zachxbt");
    expect(speakerHandleFromLead(lead("https://twitter.com/DefiDad/status/9", "@DefiDad"))).toBe("defidad");
    expect(speakerHandleFromLead(lead("https://example.com/complaint"))).toBeNull();
    expect(speakerHandleFromLead(lead("https://x.com/search?q=clutch"))).toBeNull();
  });
});
