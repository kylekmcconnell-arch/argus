import { useEffect, useRef, useState } from "react";
import { recordForensicEntities, getContributions } from "../graph/store";

// Contract bytecode fingerprint (/api/bytecode, EVM only). Shows the rug-enabling
// capabilities baked into the deployed code (a callable mint / blacklist / pause)
// and — the compounding part — checks whether this exact code has been seen before
// under another ticker. Byte-identical contracts are the same trap; if the twin
// was flagged AVOID, this one is too. Records a code:<fp> graph node so the bridge
// forms automatically across audits. Cheap (one RPC), so it auto-runs.
type Cap = { selector: string; name: string; risk: "bad" | "warn" | "info" };
type Data = { available: boolean; isContract?: boolean; isToken?: boolean; proxy?: boolean; implementation?: string | null; fingerprint?: string; codeSize?: number; capabilities?: Cap[]; verdict?: { tone: string; line: string }; note?: string };
type Twin = { handle: string; verdict?: string };

export function BytecodeForensics({ address, chain, symbol, record = true }: { address: string; chain: string; symbol?: string; record?: boolean }) {
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
          if (record) {
            recordForensicEntities(symbol ? `$${symbol}` : `token:${address}`, [
              { key: fpKey, type: "Identity", subtype: "Bytecode", edgeType: "SAME_BYTECODE", label: `code ${d.fingerprint.slice(0, 8)}` },
            ]);
          }
        }
      } catch { /* non-fatal */ }
      setState("done");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chain === "solana") return null;
  if (state === "loading") return <div className="panel p-4 text-[12.5px] text-ink-faint">checking whether this contract copies known scam code…</div>;
  if (!data || data.available === false || data.isContract === false) {
    // Only render a note if there's something honest to say (EOA / unsupported chain).
    if (data && (data.isContract === false || data.note)) {
      return (
        <div className="panel p-4">
          <span className="eyebrow">Copied contract code</span>
          <p className="mt-1.5 text-[12.5px] text-ink-dim">{data.note}</p>
        </div>
      );
    }
    return null;
  }

  const v = data.verdict;
  const badTwin = twins.find((t) => t.verdict === "AVOID" || t.verdict === "FAIL");
  const caps = data.capabilities ?? [];
  // Capabilities in a contract are NEUTRAL facts (plenty of legit tokens can mint
  // for emissions / pause for upgrades). Only a byte-identical clone of a KNOWN-BAD
  // token is genuinely alarming — reserve red for that; everything else is a calm,
  // informational panel.
  const alarm = !!badTwin;

  return (
    <div className={`panel p-4 ${alarm ? "tint-var" : ""}`} style={alarm ? ({ "--tint": "var(--color-avoid)" } as React.CSSProperties) : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Copied contract code</span>
        {data.fingerprint && <span className="mono text-[11px] text-ink-faint">{data.fingerprint}</span>}
        {data.proxy && data.implementation && (
          <a href={`https://etherscan.io/address/${data.implementation}`} target="_blank" rel="noreferrer" title={`implementation ${data.implementation}`} className="link-ext mono rounded border border-line px-1.5 py-0.5 text-[11px]">proxy → impl</a>
        )}
        {typeof data.codeSize === "number" && <span className="mono ml-auto text-[11px] text-ink-faint">{data.codeSize.toLocaleString()} bytes</span>}
      </div>

      {/* Twin match is the ONLY real headline here — a known-bad clone. */}
      {badTwin ? (
        <p className="mt-2 text-[12.5px] font-medium leading-relaxed text-avoid">
          Byte-identical to {badTwin.handle}, which was flagged {badTwin.verdict}. This is the same contract redeployed under a new ticker.
        </p>
      ) : twins.length > 0 ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">
          Shares identical code with {twins.slice(0, 3).map((t) => t.handle).join(", ")}. It was deployed from the same template.
        </p>
      ) : v ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{v.line}</p>
      ) : null}

      {caps.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">What the contract can do <span className="normal-case text-ink-faint/70">(not automatically dangerous; check who controls each ability)</span></div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {caps.map((c) => (
              <span key={c.selector} title={c.selector} className="chip">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
