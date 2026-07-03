import { useRef, useState } from "react";
import { recordContribution, walletContribution, knownAddresses } from "../graph/store";
import { explorer, shortAddr } from "../lib/wallets";
import { FunderSweep } from "./FunderSweep";
import { ScoreTicker } from "./ScoreTicker";
import { PrivateToggle } from "./PrivateToggle";

// ── Find wallet ─────────────────────────────────────────────────────────────
// Sleuth-style clue box: paste a handle, an ENS/.sol name, a full or PARTIAL
// address, or drop a screenshot, and ARGUS resolves it to wallet address(es) —
// then lets you trace each one on-chain. The bridge from the people side to the
// money side, with a real front door.
//   - handle / name / full address -> /api/find-wallet (Farcaster + bio + ENS)
//   - partial 0x71C0…A04e          -> matched against your accumulated graph
//   - screenshot                   -> /api/ocr-clue (Claude vision) -> resolve each

type Wallet = { address: string; chain: string; source: string };
type Match = { address: string; chain: "evm" | "solana"; tiedTo: string[] };
type Card = {
  id: number;
  clue: string;
  status: "loading" | "done";
  kind: "resolved" | "partial";
  wallets?: Wallet[];
  matches?: Match[];
  note?: string;
};

const SAMPLES = ["vitalik.eth", "@jessepollak", "toly.sol", "@brian_armstrong"];
const handleLike = (s: string) => /^@?[A-Za-z0-9_]{2,30}$/.test(s.trim()) && !s.includes(".");

// A clue is "partial" when it's a truncated address: an ellipsis form, or a bare
// 0x prefix shorter than a full 40-nibble address.
function isPartial(clue: string): boolean {
  const t = clue.trim();
  if (/(?:…|\.{2,})/.test(t) && /0x|[0-9a-fA-F]{4}/.test(t)) return true;
  return /^0x[a-fA-F0-9]{1,39}$/.test(t);
}
function parsePartial(s: string): { head: string; tail: string } {
  const parts = s.trim().split(/\s*(?:…|\.{2,})\s*/);
  const clean = (x: string) => x.replace(/[^0-9a-zA-Zx]/g, "").toLowerCase();
  return { head: clean(parts[0] ?? ""), tail: parts.length > 1 ? clean(parts[parts.length - 1] ?? "") : "" };
}
function matchPartial(clue: string): Match[] {
  const { head, tail } = parsePartial(clue);
  if (head.length < 3) return [];
  return knownAddresses().filter((k) => {
    const a = k.address.toLowerCase();
    return a.startsWith(head) && (!tail || a.endsWith(tail));
  });
}

async function fetchResolved(clue: string): Promise<{ wallets: Wallet[]; note?: string }> {
  try {
    const res = await fetch(`/api/find-wallet?q=${encodeURIComponent(clue.replace(/^@/, ""))}`);
    const d = await res.json();
    return { wallets: Array.isArray(d.wallets) ? d.wallets : [], note: d.note };
  } catch {
    return { wallets: [], note: "Resolver unreachable." };
  }
}

export function FindWallet({ onAudit, onReset, onOpenRecent }: { onAudit: (q: string) => void; onReset: () => void; onOpenRecent?: (ref: string) => void }) {
  const [input, setInput] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [priv, setPriv] = useState(false);
  const idRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (id: number, next: Partial<Card>) =>
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...next } : c)));

  async function resolveClue(clue: string) {
    const trimmed = clue.trim();
    if (!trimmed) return;
    const id = ++idRef.current;
    const partial = isPartial(trimmed);
    setCards((cs) => [{ id, clue: trimmed, status: "loading", kind: partial ? "partial" : "resolved" }, ...cs]);
    if (partial) {
      const matches = matchPartial(trimmed);
      patch(id, {
        status: "done",
        matches,
        note: matches.length ? undefined : "No address in your graph matches that fragment. Audit more subjects to grow the index.",
      });
      return;
    }
    const { wallets, note } = await fetchResolved(trimmed);
    patch(id, { status: "done", wallets, note: wallets.length ? undefined : note ?? "No wallet could be resolved from this clue." });
    if (wallets.length && !priv) { // private: don't record the resolution to the trust graph
      const c = walletContribution(trimmed, wallets);
      if (c) recordContribution(c);
    }
  }

  async function submit() {
    const clue = input.trim();
    if (!clue || busy) return;
    setBusy(true);
    setBanner(null);
    setInput("");
    await resolveClue(clue);
    setBusy(false);
  }

  async function readImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    setBusy(true);
    setBanner("Reading the screenshot for wallet clues…");
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/ocr-clue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const d = await res.json();
      const clues: string[] = Array.isArray(d.clues) ? d.clues : [];
      if (!clues.length) {
        setBanner(d.note ? `Screenshot read, but no wallet clue found (${d.note}).` : "No wallet address, name, or handle was visible in that screenshot.");
      } else {
        setBanner(`Read ${clues.length} clue${clues.length === 1 ? "" : "s"} from the screenshot: ${clues.join(", ")}`);
        for (const clue of clues) await resolveClue(clue);
      }
    } catch {
      setBanner("Couldn't read that screenshot.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative min-h-full pb-24"
      onPaste={(e) => {
        const img = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image/"));
        if (img) { const f = img.getAsFile(); if (f) readImage(f); }
      }}
    >
      <ScoreTicker onOpen={onOpenRecent ?? onAudit} label="Recent audits · click to open the report" />
      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Home
          </button>
          <span className="mono text-[11px] text-ink-faint">/ find wallet</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5">
        <div className="mt-6">
          <h1 className="text-[24px] font-medium tracking-[-0.02em] text-ink">Find wallet</h1>
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-dim">
            Turn a clue into a wallet. Paste an X handle, an ENS / basename / .sol name, a full or partial address,
            or drop a screenshot. ARGUS resolves it via Farcaster-verified addresses, self-disclosed bios, and name
            records, then lets you trace each wallet on-chain.
          </p>
        </div>

        {/* clue box */}
        <div
          className={`mt-5 rounded-xl border bg-panel p-3 transition ${dragOver ? "border-signal" : "border-line"}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readImage(f); }}
        >
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="@handle, vitalik.eth, toly.sol, 0x71C0…A04e"
              className="mono min-w-0 flex-1 bg-transparent px-2 py-2 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button onClick={() => fileRef.current?.click()} title="Upload a screenshot" className="shrink-0 rounded-md border border-line px-2 py-2 text-ink-dim transition hover:text-ink">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16l4.6-4.6a2 2 0 0 1 2.8 0L16 16M14 14l1.6-1.6a2 2 0 0 1 2.8 0L20 14M4 20h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2zM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" /></svg>
            </button>
            <PrivateToggle on={priv} onToggle={setPriv} className="shrink-0 py-2" />
            <button onClick={submit} disabled={busy || !input.trim()} className="btn-primary shrink-0 px-4 py-2 text-[13px] font-medium disabled:opacity-40">
              {busy ? "Resolving…" : "Resolve"}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readImage(f); e.target.value = ""; }} />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
            <span className="text-[10.5px] text-ink-faint">try</span>
            {SAMPLES.map((s) => (
              <button key={s} onClick={() => resolveClue(s)} className="mono rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-dim transition hover:text-ink">{s}</button>
            ))}
            <span className="ml-auto text-[10.5px] text-ink-faint">drop or paste a screenshot to OCR it</span>
          </div>
        </div>

        {banner && (
          <div className="mt-3 rounded-lg border border-line bg-panel/60 px-3 py-2 text-[12px] text-ink-dim">{banner}</div>
        )}

        {/* results */}
        <div className="mt-4 space-y-3">
          {cards.map((card) => (
            <div key={card.id} className="rounded-xl border border-line bg-panel p-4">
              <div className="flex items-center gap-2">
                <span className="mono text-[13px] text-ink">{card.clue}</span>
                <span className="text-[10.5px] text-ink-faint">{card.kind === "partial" ? "partial address · matched against your graph" : "resolve"}</span>
                {card.status === "loading" && <span className="text-[10.5px] text-ink-faint">· resolving…</span>}
                {handleLike(card.clue) && (
                  <button onClick={() => onAudit(card.clue)} className="mono ml-auto rounded-md border px-2 py-0.5 text-[11px] transition" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>full audit →</button>
                )}
              </div>

              {/* resolved wallets */}
              {card.wallets && card.wallets.length > 0 && (
                <div className="mt-3 space-y-2">
                  {card.wallets.map((w) => <WalletRow key={w.address} w={w} onAudit={onAudit} />)}
                </div>
              )}

              {/* partial matches */}
              {card.matches && card.matches.length > 0 && (
                <div className="mt-3 space-y-2">
                  {card.matches.map((m) => (
                    <div key={m.address} className="rounded-lg border border-line bg-void/40 p-2.5">
                      <div className="flex items-center gap-2">
                        <ChainBadge chain={m.chain} />
                        <a href={explorer(m)} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-signal underline-offset-2 hover:underline">{shortAddr(m.address)}</a>
                        <CopyBtn text={m.address} />
                      </div>
                      <div className="mt-1 text-[11px] text-ink-faint">tied to {m.tiedTo.join(", ")}</div>
                    </div>
                  ))}
                </div>
              )}

              {card.note && <p className="mt-2 text-[12px] text-ink-faint">{card.note}</p>}
            </div>
          ))}
        </div>

        {cards.length === 0 && !busy && (
          <div className="mt-10 text-center text-[12.5px] text-ink-faint">
            {priv
              ? "Private mode: resolutions run but are not recorded to your trust graph."
              : "Resolved wallets are recorded into your trust graph, so a handle you resolve here bridges to any token audit that touches the same wallet."}
          </div>
        )}
      </div>
    </div>
  );
}

function ChainBadge({ chain }: { chain: string }) {
  return (
    <span className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-ink-faint">
      {chain === "solana" ? "SOL" : "EVM"}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
      className="text-[10.5px] text-ink-faint transition hover:text-ink"
      title="Copy full address"
    >
      {done ? "copied" : "copy"}
    </button>
  );
}

// One resolved wallet: address, source, explorer link, and (Solana) an on-chain
// funding-trail trace via /api/deployer — who funded it, its age, tokens minted —
// plus a serial-launch sweep (the wallet's own launches + deployers it seeded).
function WalletRow({ w, onAudit }: { w: Wallet; onAudit?: (q: string) => void }) {
  const [trail, setTrail] = useState<any | null>(null);
  const [tracing, setTracing] = useState(false);
  const trace = async () => {
    if (tracing || trail) return;
    setTracing(true);
    try {
      const res = await fetch(`/api/deployer?wallet=${encodeURIComponent(w.address)}`);
      const d = await res.json();
      setTrail(d?.available === false ? { note: d.note ?? "Funding trail unavailable." } : d);
    } catch {
      setTrail({ note: "Trace failed." });
    } finally {
      setTracing(false);
    }
  };
  const unconfirmed = /unconfirmed/i.test(w.source);
  return (
    <div className="rounded-lg border border-line bg-void/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ChainBadge chain={w.chain} />
        <a href={explorer(w)} target="_blank" rel="noreferrer" className="mono text-[12.5px] text-signal underline-offset-2 hover:underline">{shortAddr(w.address)}</a>
        <CopyBtn text={w.address} />
        <span className={`text-[11px] ${unconfirmed ? "text-caution" : "text-ink-faint"}`}>{w.source}</span>
        {w.chain === "solana" && (
          <button onClick={trace} disabled={tracing} className="mono ml-auto rounded-md border border-line px-2 py-0.5 text-[10.5px] text-ink-dim transition hover:text-ink disabled:opacity-50">
            {tracing ? "tracing…" : trail ? "traced" : "trace funding →"}
          </button>
        )}
      </div>
      {trail && (
        <div className="mt-2 border-t border-line pt-2 text-[11.5px] leading-relaxed text-ink-dim">
          {trail.note && <div>{trail.note}</div>}
          {(trail.tokensCreated != null || trail.walletAgeDays != null) && (
            <div className="mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ink-faint">
              {trail.walletAgeDays != null && <span>age {trail.walletAgeDays}d</span>}
              {trail.tokensCreated != null && <span>{trail.tokensCreated} token{trail.tokensCreated === 1 ? "" : "s"} minted{trail.serialDeployer ? " · serial" : ""}</span>}
              {trail.terminatesAtCex && trail.origin?.label && <span className="text-signal-dim">funds → {trail.origin.label}</span>}
            </div>
          )}
        </div>
      )}
      {w.chain === "solana" && <FunderSweep wallet={w.address} onAudit={onAudit} />}
    </div>
  );
}
