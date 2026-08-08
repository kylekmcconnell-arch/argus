import { describe, expect, it } from "vitest";
import type { Dossier } from "../data/dossier";
import { projectWebSurfaces } from "./projectWebSurfaces";

function dossier(): Dossier {
  return {
    website: "https://stonkbrokers.cash",
    basicFacts: [
      {
        status: "verified",
        sources: [
          { url: "https://clutch.markets/terms", sourceClass: "official_subject", relation: "supports", artifactVerified: true },
          { url: "https://docs.clutch.markets/perps", sourceClass: "official_subject", relation: "supports", artifactVerified: true },
        ],
      },
      {
        status: "corroborated",
        sources: [
          { url: "https://clutch.markets/", sourceClass: "official_subject", relation: "supports", artifactVerified: true },
          { url: "https://x.com/clutchmarkets", sourceClass: "official_subject", relation: "supports", artifactVerified: true },
        ],
      },
      {
        status: "lead",
        sources: [{ url: "https://wrong.example", sourceClass: "official_subject", relation: "supports", artifactVerified: true }],
      },
    ],
  } as unknown as Dossier;
}

describe("projectWebSurfaces", () => {
  it("recovers the project site from verified official citations without treating the token site as the same surface", () => {
    expect(projectWebSurfaces(dossier())).toEqual([{ host: "clutch.markets", url: "https://clutch.markets" }]);
  });
});
