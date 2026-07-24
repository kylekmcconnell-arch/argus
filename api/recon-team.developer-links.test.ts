import { describe, expect, it } from "vitest";
import { profileDeveloperLinks } from "./recon-team";

describe("recon team developer profile links", () => {
  it("uses direct GitHub and Hugging Face links published on the person's X profile", () => {
    const links = profileDeveloperLinks({
      description: "Founder. Code: https://github.com/venice-dev Models: https://huggingface.co/venice-ai",
      profile_bio: {
        entities: {
          url: { urls: [{ expanded_url: "https://github.com/venice-dev" }] },
        },
      },
    }, "@builder");

    expect(links).toEqual([
      {
        provider: "github",
        url: "https://github.com/venice-dev",
        sourceUrl: "https://x.com/builder",
      },
      {
        provider: "huggingface",
        url: "https://huggingface.co/venice-ai",
        sourceUrl: "https://x.com/builder",
      },
    ]);
  });

  it("does not turn unrelated profile URLs or text into developer identities", () => {
    expect(profileDeveloperLinks({
      website: "https://venice.ai",
      description: "Founder and open-source fan. Find me on GitHub under some name.",
    }, "builder")).toEqual([]);
  });
});
