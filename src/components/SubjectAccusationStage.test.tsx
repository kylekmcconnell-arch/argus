// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../engine/audit";
import type { SocialActivityAdverseMention } from "../data/socialActivity";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./PfpCheck", () => ({
  PfpCheck: () => null,
  PfpAvatar: ({ handle }: { handle?: string }) => <span>{handle ? `pfp:${handle}` : "pfp"}</span>,
}));

import { SubjectAccusationStage } from "./SubjectAccusationStage";

const lead: Finding = {
  finding_type: "AdverseLead",
  claim: "@alice (rug pull accusation lead): a complaint thread names the subject.",
  source_url: "https://x.com/zachxbt/status/123456789",
  source_date: "",
  source_author: "@zachxbt",
  verification_status: "Rumor",
  independent_source_count: 1,
  polarity: -1,
  evidence_origin: "model_lead",
  artifact_verified: false,
  finding_scope: {
    scope: "direct_subject",
    target_entity_key: "@alice",
    target_entity_type: "person",
    relationship_to_subject: "self",
  },
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SubjectAccusationStage", () => {
  it("renders a source-triaged accusation lead with verification guidance and a source link", () => {
    act(() => {
      root.render(<SubjectAccusationStage leads={[lead]} subject="@alice" />);
    });
    expect(container.textContent).toContain("1 warning · not scored");
    expect(container.textContent).toContain("Uncorroborated");
    expect(container.textContent).toContain("Original social post");
    expect(container.textContent).toContain("Find an original post, independent report, or first-party response.");
    expect(container.textContent).toContain("rug pull accusation lead");
    expect(container.textContent).toContain("pfp:zachxbt");
    expect(container.querySelector('a[href="https://x.com/zachxbt/status/123456789"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Confirmed findings");
  });

  it("renders direct warning posts by claim type without presenting audience as credibility", () => {
    const socialLead: SocialActivityAdverseMention = {
      postId: "2093131220574179642",
      handle: "@devs_hunter",
      displayName: "Devs Hunter",
      text: "SCAM token, don't buy. 58.3% bundled in 38 fresh wallets from the same funding source.",
      tweetUrl: "https://x.com/devs_hunter/status/2093131220574179642?s=20",
      createdAt: "2026-08-27T20:10:00.000Z",
      followers: 7_219,
      category: "wallet_cluster",
      specificity: "specific",
      signals: ["scam warning", "wallet bundling claim", "fresh-wallet claim"],
    };
    act(() => {
      root.render(<SubjectAccusationStage leads={[]} socialLeads={[socialLead]} subject="@bandoscash" />);
    });
    expect(container.textContent).toContain("Warnings people are sharing");
    expect(container.textContent).toContain("Ownership and trading claims");
    expect(container.textContent).toContain("7,219 followers · audience size, not credibility");
    expect(container.textContent).toContain("Post verified · claim uncorroborated");
    expect(container.textContent).toContain("Specific, checkable claims1");
    expect(container.querySelector('a[href="https://x.com/devs_hunter/status/2093131220574179642?s=20"]')).not.toBeNull();
  });
});
