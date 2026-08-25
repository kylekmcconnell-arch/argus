// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../engine/audit";

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
  it("renders a people-card rumor with speaker pfp, quote, cannot-verify stamp, and source link", () => {
    act(() => {
      root.render(<SubjectAccusationStage leads={[lead]} subject="@alice" />);
    });
    expect(container.textContent).toContain("unconfirmed · not scored");
    expect(container.textContent).toContain("We cannot verify this.");
    expect(container.textContent).toContain("rug pull accusation lead");
    expect(container.textContent).toContain("pfp:zachxbt");
    expect(container.querySelector('a[href="https://x.com/zachxbt/status/123456789"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Confirmed findings");
  });
});
