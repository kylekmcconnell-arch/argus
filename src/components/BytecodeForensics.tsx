import { useEffect, useRef, useState } from "react";
import { recordForensicEntities, getContributions } from "../graph/store";

// Contract bytecode fingerprint (/api/bytecode, EVM only). Shows the rug-enabling
// capabilities baked into the deployed code (a callable mint / blacklist / pause)
// and — the compounding part — checks whether this exact code has been seen before
// under another ticker. Byte-identical contracts are the same trap; if the twin
// was flagged AVOID, this one is too. Records a code:<fp> graph node so the bridge
// forms automatically across audits. Cheap (one RPC), so it auto-runs.
const TONE: Record<string, string> = { bad: "var(--color-avoid)", warn: "var(--color-caution)", good: "var(--color-pass)", info: "var(--color-ink-faint)" };
type Cap = { selector: string; name: string; risk: "bad" | "warn" | "info" };
type Data = { available: boolean; isContract?: boolean; isToken?: boolean; fingerprint?: string; codeSize?: number; capabilities?: Cap[]; verdict?: { tone: string; line: string }; note?: string };
type Twin = { handle: string; verdict?: string };

export function BytecodeForensics({ address, chain, symbol }: { address: string; chain: string; symbol?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [twins, setTwins] = useState<Twin[]>([]);
  const [state, setState] = useState<"loading" | "done">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (chain === "solana") { setState("done"); return; }
    (async () => {
      try {
        const r = await fetch(`/api/bytecode?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`);
        const d: Data = await r.json();
        setData(d);
        if (d?.available && d.isContract && d.fingerprint) {
          const fpKey = `code:${d.fingerprint}`;
          // Twin lookup BEFORE recording, so we don't match ourselves: any other
          // audited subject whose graph carries this exact code fingerprint.
          const me = (symbol ? `$${symbol}` : "").toLowerCase();
          const found: Twin[] = [];
          for (const c of getContributions()) {
            if (c.handle.toLowerCase() === me) continue;
            if (c.nodes.some((n) => String(n.key).toLowerCase() === fpKey)) found.push({ handle: c.handle, verdict: c.verdict });
          }
          setTwins(found);
          // Record the fingerprint so future audits of a clone bridge to this one.
          recordForensicEntities(symbol ? `$${symbol}` : `token:${address}`, [
            { key: fpKey, type: "Identity", subtype: "Bytecode", edgeType: "SAME_BYTECODE", label: `code ${d.fingerprint.slice(0, 8)}` },
          ]);
        }
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chain === "solana") return null;
  if (state === "loading") return <div className="rounded-xl border border-line bg-panel p-4 text-[11.5px] text-ink-faint">fingerprinting the contract bytecode…</div>;
  if (!data || data.available === false || data.isContract === false) {
    // Only render a note if there's something honest to say (EOA / unsupported chain).
    if (data && (data.isContract === false || data.note)) {
      return (
        <div className="rounded-xl border border-line bg-panel p-4">
          <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Bytecode fingerprint</span>
          <p className="mt-1.5 text-[12px] text-ink-dim">{data.note}</p>
        </div>
      );
    }
    return null;
  }

  const v = data.verdict;
  const color = TONE[v?.tone ?? "good"];
  const badTwin = twins.find((t) => t.verdict === "AVOID" || t.verdict === "FAIL");
  const caps = data.capabilities ?? [];

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: v?.tone === "good" && !badTwin ? "var(--color-line)" : `${badTwin ? "var(--color-avoid)" : color}55`, background: v?.tone === "good" && !badTwin ? "var(--color-panel)" : `${badTwin ? "var(--color-avoid)" : color}0d` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Bytecode fingerprint</span>
        {data.fingerprint && <span className="mono text-[10px] text-ink-faint">{data.fingerprint}</span>}
        {typeof data.codeSize === "number" && <span className="mono ml-auto text-[10px] text-ink-faint">{data.codeSize.toLocaleString()} bytes</span>}
      </div>

      {/* Twin match is the headline when present — a known-bad clone is the strongest signal here. */}
      {badTwin ? (
        <p className="mt-2 text-[12.5px] font-medium leading-relaxed" style={{ color: "var(--color-avoid)" }}>
          Byte-identical to {badTwin.handle}, which was flagged {badTwin.verdict}. This is the same contract redeployed under a new ticker.
        </p>
      ) : twins.length > 0 ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          Shares identical code with {twins.slice(0, 3).map((t) => t.handle).join(", ")} — deployed from the same template.
        </p>
      ) : null}

      {v && <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: v.tone === "good" ? "var(--color-ink-dim)" : color }}>{v.line}</p>}

      {caps.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {caps.map((c) => (
            <span key={c.selector} title={c.selector} className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${TONE[c.risk]}1a`, color: TONE[c.risk] }}>
              {c.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
