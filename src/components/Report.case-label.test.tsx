// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import { buildReport, SUBJECTS } from "../data/subjects";
import type { ReportVersionContext } from "../lib/reportVersion";
import { publicCaseLabel } from "../lib/caseLabel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => null }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => null }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => null, PfpAvatar: () => null }));
vi.mock("./PersonGithub", () => ({ PersonGithub: () => null }));
vi.mock("./VcReport", () => ({ VcReport: () => null }));
vi.mock("./KolReport", () => ({ KolReport: () => null }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: () => null }));
vi.mock("./NewsSection", () => ({ NewsSection: () => null }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => null }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./ArgusEyeAssistant", () => ({ ArgusEyeAssistant: () => null }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

const CASE_ID = "aaf133f8-7a13-4df0-ae17-000000000008";
const CASE_LABEL = publicCaseLabel(CASE_ID)!;

function versionContext(version: number, reportVersionId: string): ReportVersionContext {
  return {
    caseId: CASE_ID,
    reportVersionId,
    version,
    completenessState: "partial",
    attestationState: "server_collected",
    methodologyVersion: "test-v1",
    createdAt: "2026-08-25T12:00:00.000Z",
    checks: [{ label: "Identity resolution", status: "confirmed" }],
  };
}

function savedDossier(version: number, auditId: string): Dossier {
  const base = buildReport(SUBJECTS[1]);
  return {
    ...base,
    report: { ...base.report, audit_id: auditId },
    versionContext: versionContext(version, `version-${version}`),
  };
}

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

describe("saved report case identity", () => {
  it("renders the same case label for v8 and v9 of one case, with different report IDs", () => {
    const v8 = savedDossier(8, "PA-AAF133F87A134DF0AE17");
    const v9 = savedDossier(9, "PA-A74E3B463FCB43C89558");

    act(() => {
      root.render(<Report dossier={v8} onReset={() => {}} onAudit={() => {}} />);
    });
    const header8 = container.querySelector('[aria-label^="Case "]')?.textContent ?? "";
    const details8 = container.querySelector('[aria-label="Saved report details"]')?.textContent ?? "";
    expect(header8).toContain(`/ ${CASE_LABEL}`);
    expect(header8).not.toContain("PA-A74E3B463FCB43C89558");
    expect(details8).toContain(`Case${CASE_LABEL}`);
    expect(details8).toContain("Report IDPA-AAF133F87A134DF0AE17");
    expect(details8).not.toContain("PA-A74E3B463FCB43C89558");

    act(() => {
      root.render(<Report dossier={v9} onReset={() => {}} onAudit={() => {}} />);
    });
    const header9 = container.querySelector('[aria-label^="Case "]')?.textContent ?? "";
    const details9 = container.querySelector('[aria-label="Saved report details"]')?.textContent ?? "";
    expect(header9).toContain(`/ ${CASE_LABEL}`);
    expect(header9).toBe(header8);
    expect(details9).toContain(`Case${CASE_LABEL}`);
    expect(details9).toContain("Report IDPA-A74E3B463FCB43C89558");
    expect(details9).not.toContain("Report IDPA-AAF133F87A134DF0AE17");
  });
});
