// ARGUS pays PeopleDataLabs (about $0.10 a head, three heads at most) to ask
// whether the leadership a project claims still claims the project back. The
// answer landed on evidence.leaderDepartures and stopped there: the Dossier did
// not carry the field, so nothing downstream could ever render it. These tests
// pin the field onto the frozen payload.
import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence, type CollectedEvidence } from "./evidence";

const departures = (): NonNullable<CollectedEvidence["leaderDepartures"]> => [
  {
    name: "Ada Okafor",
    role: "Co-Founder",
    linkedin: "linkedin.com/in/ada-okafor",
    state: "departed",
    summary: "Ada Okafor no longer lists Orbit as a current role: the record ends March 2024 (Co-Founder).",
    ended: "2024-03",
  },
  {
    name: "Bram Vos",
    role: "CTO",
    state: "current",
    summary: "Bram Vos still lists CTO at Orbit as a current role, held since January 2021.",
  },
];

function projectEvidence(rows?: CollectedEvidence["leaderDepartures"]) {
  const evidence = emptyEvidence("@orbit");
  evidence.roles = [SubjectClass.PROJECT];
  if (rows) evidence.leaderDepartures = rows;
  return evidence;
}

describe("assembleDossier leadership currency", () => {
  it("carries every checked leader, their state, end date and profile URL", () => {
    const dossier = assembleDossier(projectEvidence(departures()), true);

    expect(dossier.leaderDepartures).toEqual(departures());
  });

  it("copies the rows instead of aliasing the mutable evidence bag", () => {
    const evidence = projectEvidence(departures());
    const dossier = assembleDossier(evidence, true);

    evidence.leaderDepartures![0].state = "current";
    expect(dossier.leaderDepartures?.[0].state).toBe("departed");
  });

  it("omits the field entirely when the paid lookup never ran", () => {
    expect(assembleDossier(projectEvidence(), true).leaderDepartures).toBeUndefined();
    expect(assembleDossier(projectEvidence([]), true).leaderDepartures).toBeUndefined();
  });
});
