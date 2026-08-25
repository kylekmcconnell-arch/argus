import { TrustGraph } from "../components/TrustGraph";

// Presentation harness only. Nodes and edges match the TrustGraph contract
// tests so the preview does not invent a live-report web.
const nodes = [
  { type: "Person", key: "@subject", subject: true, label: "Subject" },
  { type: "Person", key: "@peer" },
  { type: "Company", key: "@fund", label: "Fund" },
  { type: "Company", key: "project.example", label: "Project" },
  { type: "Identity", subtype: "Wallet", key: "wallet:base:0xdef" },
  { type: "Person", key: "@rival" },
];

const edges = [
  { src: "@subject", dst: "@peer", type: "ASSOCIATES_WITH", verdict: "Unconfirmed", source_url: "https://x.com/peer/status/1" },
  { src: "@subject", dst: "@fund", type: "AFFILIATED_WITH", verdict: "Confirmed" },
  { src: "@fund", dst: "project.example", type: "INVESTED_IN", verdict: "Confirmed" },
  { src: "@subject", dst: "wallet:base:0xdef", type: "HELD_BY", verdict: "Contradicted" },
  { src: "@subject", dst: "@rival", type: "ASSOCIATES_WITH", verdict: "Contradicted" },
];

export function TrustGraphPreview() {
  return (
    <main className="min-h-screen bg-void px-5 py-8 text-ink">
      <div className="mx-auto max-w-[980px]">
        <header>
          <p className="eyebrow">Connections</p>
          <h1 className="display mt-1 text-[24px]">How these people and wallets connect</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-dim">
            The graph shows recorded links. A link by itself does not mean wrongdoing.
          </p>
        </header>
        <section className="panel mt-6 p-4">
          <div className="eyebrow mb-2">Connection map · select a person, wallet, or project to inspect it</div>
          <TrustGraph nodes={nodes} edges={edges} onAudit={() => undefined} onOpenProject={() => undefined} />
        </section>
      </div>
    </main>
  );
}
