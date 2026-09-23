/* Browser-only half of Export brief: hand the generated PDF to the viewer as
   an application/pdf download. Kept out of briefPdf.ts, which the DOM-less
   server build also compiles. */

import { buildBriefPdf } from "./briefPdf";
import type { ReportView } from "./view";

export async function downloadBriefPdf(view: ReportView, filename: string): Promise<void> {
  const bytes = await buildBriefPdf(view);
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
