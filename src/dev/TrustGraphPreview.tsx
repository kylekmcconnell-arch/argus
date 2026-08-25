import { TrustGraph } from "../components/TrustGraph";

// The live EARN investigation web Kyle circled: subject @earnonhood and the
// two recorded edges only. Do not add people, wallets, or hops.
const earnNodes = [
  { type: "Person", key: "@earnonhood", subject: true },
  { type: "Identity", subtype: "Wallet", key: "robinhood:0xa3b6aee90017b72c0812dc1e013de70eb2917ba3" },
  { type: "Person", key: "Tharmas", label: "Tharmas" },
];

const earnEdges = [
  { src: "@earnonhood", dst: "robinhood:0xa3b6aee90017b72c0812dc1e013de70eb2917ba3", type: "CONTROLS_WALLET" },
  { src: "@earnonhood", dst: "Tharmas", type: "TEAM" },
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
          <TrustGraph nodes={earnNodes} edges={earnEdges} onAudit={() => undefined} />
        </section>
      </div>
    </main>
  );
}
