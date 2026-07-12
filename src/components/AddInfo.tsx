import { useEffect, useRef, useState } from "react";

// Analyst augmentation: add a piece the scan missed, verify it, publish it. The
// verification (ARGUS confirms the GitHub/site/handle/contract actually exists on
// source) is what keeps this from being a way to feed the report false "facts" —
// only things that check out go live, and they're shared across analysts.
type Aug = { id: string; type: string; status?: "live" | "pending"; why?: string; value: string; label: string; url?: string; detail?: string; by: string; at: number };
type SubmitState = "idle" | "submitting" | "live" | "pending" | "rejected";
type SubjectKind = "person" | "token" | "investigation" | "site";

const TYPES: { key: string; label: string; placeholder: string }[] = [
  { key: "github", label: "GitHub", placeholder: "github.com/username  or  username" },
  { key: "website", label: "Website", placeholder: "project.xyz" },
  { key: "x", label: "X account", placeholder: "@handle" },
  { key: "contract", label: "Token / contract", placeholder: "0x…  or  Solana mint" },
];

const ago = (ms: number) => { const d = Math.floor((Date.now() - ms) / 86400000); return d <= 0 ? "today" : d === 1 ? "1d ago" : `${d}d ago`; };
const ICON: Record<string, string> = { github: "GitHub", website: "Site", x: "X", contract: "Token", wallet: "Wallet" };

export function AddInfo({ subject, subjectKind, canonicalRef, subjectGraphKey }: { subject: string; subjectKind: SubjectKind; canonicalRef: string; subjectGraphKey?: string }) {
  const [items, setItems] = useState<Aug[]>([]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("github");
  const [value, setValue] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [reason, setReason] = useState("");
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
  }, []);

  useEffect(() => {
    if (!subject || !canonicalRef) return;
    const controller = new AbortController();
    if (feedbackTimer.current !== null) {
      window.clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setItems([]);
      setState("idle");
      setReason("");
    });
    const params = new URLSearchParams({ subject, subjectKind, canonicalRef });
    fetch(`/api/augment?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setItems((d?.items ?? []).filter((item: Aug) => item.type !== "link")))
      .catch(() => { /* offline or superseded */ });
    return () => controller.abort();
  }, [subject, subjectKind, canonicalRef]);

  const submit = async () => {
    const v = value.trim();
    if (!v || state === "submitting") return;
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    setState("submitting"); setReason("");
    try {
      const r = await fetch("/api/augment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, subjectKind, canonicalRef, subjectGraphKey, type, value: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.verified) {
        setItems((d.items ?? []).filter((item: Aug) => item.type !== "link"));
        setValue("");
        if (d.status === "pending") { setState("pending"); setReason(d.why ?? "held for review"); }
        else {
          setState("live");
          feedbackTimer.current = window.setTimeout(() => {
            setState("idle");
            feedbackTimer.current = null;
          }, 2500);
        }
      } else {
        setState("rejected"); setReason(d?.reason ?? d?.error ?? "could not be verified");
      }
    } catch { setState("rejected"); setReason("network error"); }
  };

  // Live additions show on the report; pending ones are awaiting approval.
  const live = items.filter((it) => it.status !== "pending");
  const pending = items.filter((it) => it.status === "pending");

  return (
    <div className="panel">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        <span className="eyebrow">Add missing info</span>
        {live.length > 0 && <span className="chip tint-pass">{live.length} published</span>}
        {pending.length > 0 && <span className="chip tint-caution">{pending.length} pending</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="border-t border-line/60 p-4">
          {/* published additions */}
          {live.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {live.map((it) => (
                <div key={it.id} className="flex items-center gap-2 text-[12.5px]">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-pass)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  <span className="mono text-[11px] uppercase text-ink-faint">{ICON[it.type] ?? it.type}</span>
                  {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="link-ext">{it.label}</a> : <span className="text-ink">{it.label}</span>}
                  {it.detail && <span className="text-[11px] text-ink-faint">{it.detail}</span>}
                  <span className="ml-auto text-[11px] text-ink-faint">by {it.by} · {ago(it.at)}</span>
                </div>
              ))}
            </div>
          )}

          {/* add form */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line">
              {TYPES.map((t) => (
                <button type="button" aria-pressed={type === t.key} key={t.key} onClick={() => setType(t.key)} className={`px-2.5 py-1.5 text-[12.5px] transition ${type === t.key ? "bg-signal text-white" : "text-ink-dim"}`}>{t.label}</button>
              ))}
            </div>
            <input
              value={value}
              aria-label={`${TYPES.find((t) => t.key === type)?.label ?? "Information"} to add`}
              onChange={(e) => { setValue(e.target.value); if (state === "rejected") setState("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder={TYPES.find((t) => t.key === type)?.placeholder}
              className="field mono min-w-0 flex-1 px-2.5 py-1.5 text-[12.5px]"
            />
            <button type="button" onClick={submit} disabled={state === "submitting" || !value.trim()} className="btn-primary shrink-0 px-3 py-1.5 text-[12.5px] font-medium">
              {state === "submitting" ? "verifying…" : "Submit"}
            </button>
          </div>

          {/* status line */}
          <div aria-live="polite">
            {state === "submitting" && <p className="mt-2 text-[12.5px] text-ink-faint">Submitted — verifying it exists on source, then checking it can be proven…</p>}
            {state === "live" && <p className="mt-2 text-[12.5px] text-pass">Verified and published live.</p>}
            {state === "pending" && <p className="mt-2 text-[12.5px] text-caution">Queued for owner review — {reason}. It exists, but ARGUS couldn't auto-prove it's this subject's, so it remains unpublished until an owner approves it in AdminOps.</p>}
            {state === "rejected" && <p className="mt-2 text-[12.5px] text-caution">Rejected — {reason}. The target has to actually exist on source.</p>}
          </div>
          {state === "idle" && <p className="mt-2 text-[11px] leading-snug text-ink-faint">Add something the scan missed. If ARGUS can prove it (e.g. the GitHub links back to this X) it publishes live; if it only verifies the thing exists but can't tie it to this subject, it's held for your approval. A target that doesn't exist is rejected.</p>}
        </div>
      )}
    </div>
  );
}
