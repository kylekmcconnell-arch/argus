import { expect, it } from "vitest";
import type { Dossier } from "../data/dossier";
import { projectAccountResultError } from "./projectAccountResult";

const company = { handle: "@hades_privacy", display_name: "Hades", bio: "Privacy protocol", report: { roles: ["PROJECT"] } } as unknown as Dossier;
it("accepts the exact company account, never a namesake or its founder's score", () => {
  expect(projectAccountResultError(company, "HADES_PRIVACY")).toBeNull();
  expect(projectAccountResultError(company, "hades_mining")).toContain("does not match");
  expect(projectAccountResultError({ ...company, report: { ...company.report, roles: ["FOUNDER" as never] } }, "hades_privacy")).toContain("person methodology");
});
