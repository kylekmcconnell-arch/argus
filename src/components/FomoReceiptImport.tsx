import { useState } from "react";
interface ReceiptSummary { observations: number; labelled: number; unlabelled: number; capturedAt: string | null; receiptHash: string | null; note?: string }
export function FomoReceiptImport() {
  const [raw, setRaw] = useState("");
  const [summary, setSummary] = useState<ReceiptSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(apply: boolean) {
    setBusy(true); setMessage("");
    if (!apply) setSummary(null);
    try {
      const response = await fetch("/api/fomo-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt: raw, apply }) });
      const body = await response.json();
      if (!response.ok || !body.available) throw new Error(response.status === 403 ? "Only workspace owners can import receipts." : body.message || "Import is unavailable.");
      setSummary(body);
      if (apply) { setMessage(body.note); setRaw(""); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import is unavailable."); }
    finally { setBusy(false); }
  }
  return <section className="panel mt-5 p-4" aria-label="Fomo receipt import">
    <h2 className="text-base font-medium">Import Fomo wallet evidence</h2>
    <p className="mt-1 text-sm text-ink-dim">Owner-only import of existing wallet-resolution receipts. No paid lookups. Provider labels retain their observation date; previous reports are unchanged.</p>
    <label className="mt-3 block text-sm">Wallet receipt JSON
      <input type="file" accept="application/json,.json" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; setSummary(null); setRaw(""); setMessage("");
        if (!file) return;
        if (file.size > 1_000_000) { setMessage("Receipt must be smaller than 1 MB."); return; }
        setBusy(true);
        try { setRaw(await file.text()); } catch { setMessage("File could not be read."); }
        finally { setBusy(false); }
      }} />
    </label>
    <button className="mt-3 mr-4 underline" disabled={busy || !raw} onClick={() => void submit(false)}>Validate receipt</button>
    <button className="mt-3 underline" disabled={busy || !raw || !summary?.observations} onClick={() => void submit(true)}>Import validated receipt</button>
    {summary && <p className="mt-3 text-sm">{summary.observations} observations: {summary.labelled} labelled, {summary.unlabelled} without a provider label. Captured {summary.capturedAt ?? "Not recorded"}. Receipt {summary.receiptHash}.</p>}
    {message && <p className="mt-2 text-sm" role="status">{message}</p>}
  </section>;
}
