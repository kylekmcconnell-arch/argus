import { useEffect, useRef, useState } from "react";

// Analyst augmentation: add a piece the scan missed, verify it, publish it. The
// verification (ARGUS confirms the GitHub/site/handle/contract actually exists on
// source) is what keeps this from being a way to feed the report false "facts" —
// only things that check out go live, and they're shared across analysts.
type Aug = { type: string; value: string; label: string; url?: string; detail?: string; by: string; at: number };
type SubmitState = "idle" | "submitting" | "verified" | "rejected";

const TYPES: { key: string; label: string; placeholder: string }[] = [
  { key: "github", label: "GitHub", placeholder: "github.com/username  or  username" },
  { key: "website", label: "Website", placeholder: "project.xyz" },
  { key: "x", label: "X account", placeholder: "@handle" },
  { key: "contract", label: "Token / contract", placeholder: "0x…  or  Solana mint" },
];

const enc = encodeURIComponent;
const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };
const ICON: Record<string, string> = { github: "GitHub", website: "Site", x: "X", contract: "Token", wallet: "Wallet" };

export function AddInfo({ subject }: { subject: string }) {
  const [items, setItems] = useState<Aug[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("github");
  const [value, setValue] = useState("");
  const [by, setBy] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [reason, setReason] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !subject) return;
    ran.current = true;
    fetch(`/api/augment?subject=${enc(subject)}`).then((r) => r.json()).then((d) => setItems(d?.items ?? [])).catch(() => { /* offline */ });
  }, [subject]);

  const submit = async () => {
    const v = value.trim();
    if (!v || state === "submitting") return;
    setState("submitting"); setReason("");
    try {
      const r = await fetch(`/api/augment?subject=${enc(subject)}&type=${enc(type)}&value=${enc(v)}${by.trim() ? `&by=${enc(by.trim())}` : ""}`);
      const d = await r.json();
      if (d?.verified) {
        setItems(d.items ?? []);
        setState("verified"); setValue("");
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("rejected"); setReason(d?.reason ?? "could not be verified");
      }
    } catch { setState("rejected"); setReason("network error"); }
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Add missing info</span>
        {items.length > 0 && <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: "var(--color-pass)14", color: "var(--color-pass)" }}>{items.length} verified addition{items.length === 1 ? "" : "s"}</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line/60 p-4">
          {/* published additions */}
          {items.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  <span className="mono text-[9.5px] uppercase text-ink-faint">{ICON[it.type] ?? it.type}</span>
                  {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="text-signal hover:underline">{it.label}</a> : <span className="text-ink">{it.label}</span>}
                  {it.detail && <span className="text-[10.5px] text-ink-faint">{it.detail}</span>}
                  <span className="ml-auto text-[10px] text-ink-faint">by {it.by} · {ago(it.at)}</span>
                </div>
              ))}
            </div>
          )}

          {/* add form */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line">
              {TYPES.map((t) => (
                <button key={t.key} onClick={() => setType(t.key)} className="px-2.5 py-1.5 text-[11.5px] transition" style={type === t.key ? { background: "var(--color-signal)", color: "#fff" } : { color: "var(--color-ink-dim)" }}>{t.label}</button>
              ))}
            </div>
            <input
              value={value}
              onChange={(e) => { setValue(e.target.value); if (state === "rejected") setState("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={TYPES.find((t) => t.key === type)?.placeholder}
              className="mono min-w-0 flex-1 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-2"
            />
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="you (optional)" className="w-24 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-faint" />
            <button onClick={submit} disabled={state === "submitting" || !value.trim()} className="btn-primary shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">
              {state === "submitting" ? "verifying…" : "Submit"}
            </button>
          </div>

          {/* status line */}
          {state === "submitting" && <p className="mt-2 text-[11.5px] text-ink-faint">Submitted — verifying it exists on source before publishing…</p>}
          {state === "verified" && <p className="mt-2 text-[11.5px]" style={{ color: "var(--color-pass)" }}>✓ Verified and published to the report.</p>}
          {state === "rejected" && <p className="mt-2 text-[11.5px]" style={{ color: "var(--color-caution)" }}>⚠ Not published — {reason}. ARGUS only publishes additions it can independently verify.</p>}
          {state === "idle" && <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">Add something the scan missed. ARGUS confirms it exists on source (the GitHub resolves, the site loads, the token trades) before it goes live — a claim it can't verify is never published.</p>}
        </div>
      )}
    </div>
  );
}
