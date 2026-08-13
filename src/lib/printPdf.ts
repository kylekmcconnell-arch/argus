// Export-PDF runs through the browser's print dialog, which suggests
// document.title as the filename — so every report used to save as the site
// title ("ARGUS_ forensic due diligence"). Stamp a per-report name while the
// dialog is open, then restore the title.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function reportPdfFilename(subject: string, when: Date = new Date()): string {
  const name = subject
    .replace(/^[@$]+/, "")
    .replace(/[^\p{L}\p{N}.-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    || "report";
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return `${name}_${date}_Argus_Forensic_due_diligence`;
}

// Shared-lib rule: this file is also compiled by the DOM-less server tsconfig,
// so browser globals are reached through typed globalThis (see theme.ts).
export function printReportPdf(subject: string): void {
  const g = globalThis as typeof globalThis & {
    window?: { print: () => void };
    document?: { title: string };
  };
  if (!g.window || !g.document) return;
  const previous = g.document.title;
  g.document.title = reportPdfFilename(subject);
  try {
    g.window.print();
  } finally {
    g.document.title = previous;
  }
}
