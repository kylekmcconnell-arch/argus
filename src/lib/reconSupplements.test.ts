import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReconWebTeam } from "./reconSupplements";
import type { Recon } from "../collect/recon";

const recon = {
  team: { names: ["Alice"] },
  socials: [{ label: "@argus", url: "https://x.com/argus" }],
} as Recon;

describe("fetchReconWebTeam", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not call the paid endpoint without a persisted-version capability", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReconWebTeam("https://argus.test", "Argus", recon)).resolves.toMatchObject({
      attempted: false,
      completed: false,
      people: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the signed site capability when deep-team discovery is allowed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchReconWebTeam("https://argus.test", "Argus", recon, "signed-site-token");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/recon-team?"),
      expect.objectContaining({
        headers: {
          "x-argus-panel-context": "required",
          "x-argus-panel-token": "signed-site-token",
        },
      }),
    );
  });

  it("preserves row provenance and route coverage while rejecting spoofed person links", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      available: true,
      attempted: true,
      completed: false,
      partial: true,
      providerFailed: true,
      providers: [
        { provider: "grok", status: "succeeded" },
        { provider: "twitterapi", status: "failed" },
      ],
      people: [
        {
          name: "Ada Candidate",
          handle: "@ada",
          role: "Founder",
          linkedin: "https://www.linkedin.com/in/ada-candidate",
          provider: "grok",
          evidence_origin: "model_lead",
          artifact_verified: false,
          evidenceKind: "model_candidate",
        },
        {
          name: "Bad Link",
          handle: "@badlink",
          role: "Team",
          linkedin: "https://linkedin.example/in/bad-link",
          provider: "twitterapi",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "project_association",
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchReconWebTeam("https://argus.test", "Argus", recon, "signed-site-token");

    expect(result).toMatchObject({
      attempted: true,
      completed: false,
      partial: true,
      providerFailed: true,
      providers: [
        { provider: "grok", status: "succeeded" },
        { provider: "twitterapi", status: "failed" },
      ],
      people: [
        {
          name: "Ada Candidate",
          provider: "grok",
          evidence_origin: "model_lead",
          artifact_verified: false,
          evidenceKind: "model_candidate",
          linkedin: "https://www.linkedin.com/in/ada-candidate",
        },
        {
          name: "Bad Link",
          provider: "twitterapi",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "project_association",
        },
      ],
    });
    expect(result.people[1].linkedin).toBeUndefined();
  });
});
