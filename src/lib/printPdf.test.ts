import { describe, expect, it } from "vitest";
import { reportPdfFilename } from "./printPdf";

const AUG_13 = new Date(2026, 7, 13);

describe("reportPdfFilename", () => {
  it("names the file subject_date_Argus_Forensic_due_diligence", () => {
    expect(reportPdfFilename("Kermit", AUG_13)).toBe("Kermit_2026-08-13_Argus_Forensic_due_diligence");
  });

  it("strips the @/$ sigil from handles and tickers", () => {
    expect(reportPdfFilename("$KERMIT", AUG_13)).toBe("KERMIT_2026-08-13_Argus_Forensic_due_diligence");
    expect(reportPdfFilename("@stanikulechov", AUG_13)).toBe("stanikulechov_2026-08-13_Argus_Forensic_due_diligence");
  });

  it("replaces filename-hostile characters with single dashes", () => {
    expect(reportPdfFilename("Kermit the Frog / v2", AUG_13)).toBe("Kermit-the-Frog-v2_2026-08-13_Argus_Forensic_due_diligence");
  });

  it("keeps unicode project names", () => {
    expect(reportPdfFilename("Café Noir", AUG_13)).toBe("Café-Noir_2026-08-13_Argus_Forensic_due_diligence");
  });

  it("falls back to `report` when the subject sanitises to nothing", () => {
    expect(reportPdfFilename("@ /", AUG_13)).toBe("report_2026-08-13_Argus_Forensic_due_diligence");
  });

  it("zero-pads single-digit months and days", () => {
    expect(reportPdfFilename("x", new Date(2026, 0, 5))).toBe("x_2026-01-05_Argus_Forensic_due_diligence");
  });
});
