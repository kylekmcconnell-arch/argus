import { useId, type ReactNode } from "react";
import type {
  EvmAuthorityRelation,
  EvmCodeObservation,
  EvmControlRealitySnapshot,
  EvmImplementationEvidence,
} from "../data/evmControlReality";

function words(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timestampLabel(value: string | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed).replace("24:", "00:") + " UTC";
}

function accountCodeLabel(accountType: EvmCodeObservation["accountType"] | "unknown"): string {
  if (accountType === "contract") return "Deployed bytecode returned";
  if (accountType === "no_code") return "No deployed bytecode returned";
  return "Bytecode state unavailable";
}

const RELATION_LABEL: Record<EvmAuthorityRelation, string> = {
  target_owner: "Target owner() response",
  proxy_admin: "ERC-1967 admin slot",
  proxy_admin_owner: "Proxy admin owner() response",
  beacon_owner: "Beacon owner() response",
};

const IMPLEMENTATION_EVIDENCE_LABEL: Record<EvmImplementationEvidence, string> = {
  eip_1167_runtime: "Address extracted from EIP-1167 runtime",
  erc_1967_implementation_slot: "Address returned by ERC-1967 implementation slot",
  erc_1967_beacon_call: "Address returned by beacon implementation()",
};

function Definition({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 bg-panel px-3.5 py-3">
      <dt className="text-[10.5px] uppercase tracking-[0.07em] text-ink-faint">{label}</dt>
      <dd className={`${mono ? "mono break-all" : ""} mt-1 text-[12px] leading-relaxed text-ink`}>{children}</dd>
    </div>
  );
}

function ReceiptIds({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="text-ink-faint">No receipt ID recorded</span>;
  return (
    <span className="flex flex-wrap gap-1.5">
      {ids.map((id) => <code key={id} className="chip normal-case tracking-normal">{id}</code>)}
    </span>
  );
}

function CodeObservation({ observation }: { observation: EvmCodeObservation }) {
  return (
    <dl className="mt-2 grid gap-px overflow-hidden rounded-lg bg-line/60 sm:grid-cols-2">
      <Definition label="Bytecode state">{accountCodeLabel(observation.accountType)}</Definition>
      <Definition label="Runtime byte length" mono>{observation.byteLength.toLocaleString("en-US")}</Definition>
      <Definition label="Code receipt" mono>{observation.receiptId}</Definition>
      <Definition label="SHA-256 fingerprint" mono>{observation.sha256Fingerprint ?? "Not recorded"}</Definition>
    </dl>
  );
}

function disclosureSummary(label: string, count?: number): ReactNode {
  return (
    <span className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 text-[12.5px] font-medium text-ink hover:bg-panel-2/60">
      <span>{label}</span>
      {count != null && <span className="mono text-[10.5px] text-ink-faint">{count}</span>}
    </span>
  );
}

function stateCopy(snapshot: EvmControlRealitySnapshot): string {
  if (snapshot.state === "observed") {
    return "The collector saved direct standard-slot and standard-interface responses at one captured block.";
  }
  if (snapshot.state === "not_contract") {
    return "The saved eth_getCode response returned no deployed bytecode for the target at the captured block.";
  }
  return snapshot.note ?? "The fixed-block control read did not return a usable contract observation.";
}

export function EvmControlSurfacePanel({
  snapshot,
  id = "evm-control-surface",
}: {
  snapshot: EvmControlRealitySnapshot;
  id?: string;
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `${generatedId}-title`;
  const providerHost = snapshot.capture?.providerHost ?? snapshot.chainIdentity?.providerHost;
  const proxy = snapshot.proxy;
  const observedSafeResponses = snapshot.safeCompatibleMultisigs.filter((entry) => entry.state === "observed").length;
  const stateTone = snapshot.state === "observed" ? "tint-signal" : "tint-caution";

  return (
    <section id={id} className="report-section mt-6 scroll-mt-28" aria-labelledby={titleId} data-testid="evm-control-surface">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Fixed-block EVM control surface</p>
          <h2 id={titleId} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            What the standard contract paths returned
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            Raw, score-neutral observations from the saved report only. This panel makes no network call and does not reconstruct current contract state.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <span className={`chip ${stateTone}`}>{words(snapshot.state)}</span>
          <span className="chip tint-neutral">Point in time</span>
          <span className="chip tint-pass">Saved snapshot only</span>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="border-b border-line/70 px-4 py-4 sm:px-5">
          <p className="text-[13px] leading-relaxed text-ink">{stateCopy(snapshot)}</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
            Standard slots and interfaces are a bounded read. They do not establish an EOA, how many keys or people control it, an official Safe deployment, a complete permission map, exploitability, or immutability.
          </p>
        </div>

        <dl className="grid gap-px bg-line/60 sm:grid-cols-2 lg:grid-cols-3" aria-label="Fixed-block capture identity">
          <Definition label="Chain">
            {snapshot.chain}
            {snapshot.chainIdentity && (
              <span className="mt-1 block text-[10.5px] text-ink-faint">
                Expected {snapshot.chainIdentity.expectedChainId}; observed {snapshot.chainIdentity.observedChainId ?? "not decoded"}; {words(snapshot.chainIdentity.state)}
              </span>
            )}
          </Definition>
          <Definition label="Saved canonical target" mono>{snapshot.target}</Definition>
          <Definition label="Captured block" mono>
            {snapshot.capture ? `#${snapshot.capture.blockNumber.toLocaleString("en-US")}` : "Not recorded"}
            {snapshot.capture && <span className="mt-1 block break-all text-[10.5px] text-ink-faint">{snapshot.capture.blockHash}</span>}
          </Definition>
          <Definition label="Block time">{timestampLabel(snapshot.capture?.blockTimestamp)}</Definition>
          <Definition label="RPC provider host" mono>{providerHost ?? "Not recorded"}</Definition>
          <Definition label="Collection receipt">
            {snapshot.collection.rpcCalls.toLocaleString("en-US")} RPC call{snapshot.collection.rpcCalls === 1 ? "" : "s"}
            <span className="mt-1 block text-[10.5px] text-ink-faint">Direct chain RPC; no model calls; no scoring impact</span>
          </Definition>
        </dl>

        <div className="border-t border-line/70 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Target bytecode at captured block</p>
            {snapshot.targetCode && <span className="chip ml-auto">{accountCodeLabel(snapshot.targetCode.accountType)}</span>}
          </div>
          {snapshot.targetCode ? (
            <CodeObservation observation={snapshot.targetCode} />
          ) : (
            <p className="panel-inset mt-2 px-3 py-2.5 text-[12px] leading-relaxed text-ink-faint">No target bytecode observation was saved.</p>
          )}
          {snapshot.targetCode?.accountType === "no_code" && (
            <p className="mt-2 text-[11px] leading-relaxed text-caution">No deployed bytecode at this block does not identify the account as an EOA or establish who controls it.</p>
          )}
        </div>

        <div className="border-t border-line/70 px-4 py-4 sm:px-5">
          <div className="grid gap-2 sm:grid-cols-3" aria-label="Control observation counts">
            <div className="panel-inset px-3 py-2.5">
              <p className="text-[10.5px] text-ink-faint">Implementation candidates</p>
              <p className="mono mt-1 text-[17px] font-semibold text-ink">{proxy?.implementationCandidates.length ?? 0}</p>
            </div>
            <div className="panel-inset px-3 py-2.5">
              <p className="text-[10.5px] text-ink-faint">Authority addresses</p>
              <p className="mono mt-1 text-[17px] font-semibold text-ink">{snapshot.authorities.length}</p>
            </div>
            <div className="panel-inset px-3 py-2.5">
              <p className="text-[10.5px] text-ink-faint">Safe-compatible responses</p>
              <p className="mono mt-1 text-[17px] font-semibold text-ink">{observedSafeResponses}</p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <details className="panel-inset overflow-hidden" data-testid="proxy-observations">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {disclosureSummary("Standard proxy, beacon, and implementation observations", proxy?.implementationCandidates.length ?? 0)}
              </summary>
              <div className="border-t border-line/60 px-4 py-4">
                {proxy ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip tint-neutral">{words(proxy.state)}</span>
                      {proxy.indicators.map((indicator) => <span key={indicator} className="chip">{words(indicator)}</span>)}
                    </div>
                    {proxy.beacon && (
                      <div className="panel-inset mt-3 px-3 py-2.5">
                        <p className="eyebrow">ERC-1967 beacon slot</p>
                        <p className="mono mt-1 break-all text-[12px] text-ink">{proxy.beacon.address}</p>
                        <p className="mt-1 text-[10.5px] text-ink-faint">Receipt <code>{proxy.beacon.receiptId}</code></p>
                      </div>
                    )}
                    {proxy.admin && (
                      <div className="panel-inset mt-2 px-3 py-2.5">
                        <p className="eyebrow">ERC-1967 admin slot</p>
                        <p className="mono mt-1 break-all text-[12px] text-ink">{proxy.admin.address}</p>
                        <p className="mt-1 text-[10.5px] text-ink-faint">Receipt <code>{proxy.admin.receiptId}</code></p>
                      </div>
                    )}
                    {proxy.implementationCandidates.length > 0 ? (
                      <ol className="mt-3 space-y-2" aria-label="Implementation candidates">
                        {proxy.implementationCandidates.map((candidate, index) => (
                          <li key={`${candidate.address}:${candidate.evidence}:${index}`} className="panel-inset px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="eyebrow">Candidate {index + 1}</span>
                              <span className="chip ml-auto">{words(candidate.evidence)}</span>
                            </div>
                            <p className="mono mt-2 break-all text-[12px] text-ink">{candidate.address}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{IMPLEMENTATION_EVIDENCE_LABEL[candidate.evidence]}</p>
                            {candidate.extractionProof && <p className="mono mt-2 break-all text-[10.5px] text-ink-faint">Extraction proof: {candidate.extractionProof}</p>}
                            {candidate.code && <CodeObservation observation={candidate.code} />}
                            <div className="mt-2 text-[10.5px] text-ink-faint"><ReceiptIds ids={candidate.receiptIds} /></div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">No implementation candidate was returned by the bounded standard checks.</p>
                    )}
                    <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">A missing standard indicator does not establish immutability. Custom upgrade and routing paths are outside this read.</p>
                  </>
                ) : (
                  <p className="text-[12px] leading-relaxed text-ink-faint">No standard proxy assessment was saved.</p>
                )}
              </div>
            </details>

            <details className="panel-inset overflow-hidden" data-testid="authority-observations">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {disclosureSummary("Authority addresses and owner() probe responses", snapshot.authorities.length)}
              </summary>
              <div className="border-t border-line/60 px-4 py-4">
                {snapshot.ownerProbes.length > 0 && (
                  <div>
                    <p className="eyebrow">Exact owner() probe responses</p>
                    <ol className="mt-2 space-y-2">
                      {snapshot.ownerProbes.map((probe, index) => (
                        <li key={`${probe.subject}:${probe.purpose}:${index}`} className="panel-inset px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="chip">{words(probe.purpose)}</span>
                            <span className="chip tint-neutral">{words(probe.state)}</span>
                          </div>
                          <p className="mono mt-2 break-all text-[11px] text-ink">Subject: {probe.subject}</p>
                          {probe.owner && <p className="mono mt-1 break-all text-[11px] text-ink">Returned owner: {probe.owner}</p>}
                          <p className="mono mt-1 break-all text-[10.5px] text-ink-faint">Receipt: {probe.receiptId}</p>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className={snapshot.ownerProbes.length > 0 ? "mt-4" : ""}>
                  <p className="eyebrow">Recorded authority addresses</p>
                  {snapshot.authorities.length > 0 ? (
                    <ol className="mt-2 space-y-2">
                      {snapshot.authorities.map((authority, index) => (
                        <li key={`${authority.address}:${index}`} className="panel-inset px-3 py-3">
                          <p className="mono break-all text-[12px] text-ink">{authority.address}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {authority.relations.map((relation) => <span key={relation} className="chip">{RELATION_LABEL[relation]}</span>)}
                            <span className="chip tint-neutral">{accountCodeLabel(authority.accountType)}</span>
                          </div>
                          <div className="mt-2 text-[10.5px] text-ink-faint"><ReceiptIds ids={authority.receiptIds} /></div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">No authority address was returned by the saved standard-role probes.</p>
                  )}
                  <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">owner() and standard admin slots are named-role observations only. They are not a complete permission map and do not identify a number of keys or people.</p>
                </div>
              </div>
            </details>

            <details className="panel-inset overflow-hidden" data-testid="safe-compatible-observations">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {disclosureSummary("Safe-compatible interface responses", snapshot.safeCompatibleMultisigs.length)}
              </summary>
              <div className="border-t border-line/60 px-4 py-4">
                {snapshot.safeCompatibleMultisigs.length > 0 ? (
                  <ol className="space-y-2">
                    {snapshot.safeCompatibleMultisigs.map((multisig, index) => (
                      <li key={`${multisig.address}:${index}`} className="panel-inset px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="mono min-w-0 break-all text-[12px] text-ink">{multisig.address}</p>
                          <span className="chip ml-auto tint-neutral">{words(multisig.state)}</span>
                        </div>
                        <dl className="mt-3 grid gap-px overflow-hidden rounded-lg bg-line/60 sm:grid-cols-2">
                          <Definition label="getThreshold() response" mono>{multisig.threshold ?? "Not returned"}</Definition>
                          <Definition label="getOwners() response count" mono>{multisig.owners?.length ?? "Not returned"}</Definition>
                        </dl>
                        {multisig.owners && (
                          <div className="mt-3">
                            <p className="eyebrow">Returned owner addresses</p>
                            {multisig.owners.length > 0 ? (
                              <ol className="mt-1.5 space-y-1">
                                {multisig.owners.map((owner, ownerIndex) => <li key={`${owner}:${ownerIndex}`} className="mono break-all text-[11px] text-ink-dim">{owner}</li>)}
                              </ol>
                            ) : (
                              <p className="mt-1.5 text-[11px] text-ink-faint">The decoded response contained no owner addresses.</p>
                            )}
                          </div>
                        )}
                        <div className="mt-3 text-[10.5px] text-ink-faint"><ReceiptIds ids={multisig.receiptIds} /></div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[12px] leading-relaxed text-ink-faint">No Safe-compatible interface response was saved.</p>
                )}
                <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">A valid getOwners() or getThreshold() response is interface compatibility evidence only. It does not authenticate an official Safe deployment.</p>
              </div>
            </details>

            <details className="panel-inset overflow-hidden" data-testid="control-receipt-ledger">
              <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                {disclosureSummary("Open complete fixed-block receipt ledger", snapshot.receipts.length + (snapshot.chainIdentity ? 1 : 0))}
              </summary>
              <div className="border-t border-line/60">
                {snapshot.chainIdentity && (
                  <article className="border-b border-line/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip">eth_chainId</span>
                      <span className="chip tint-neutral">{words(snapshot.chainIdentity.state)}</span>
                      <code className="mono ml-auto text-[10.5px] text-ink-faint">{snapshot.chainIdentity.id}</code>
                    </div>
                    <dl className="mt-2 grid gap-x-5 gap-y-1 text-[11px] sm:grid-cols-2">
                      <div><dt className="inline text-ink-faint">Provider: </dt><dd className="mono inline break-all text-ink-dim">{snapshot.chainIdentity.providerHost}</dd></div>
                      <div><dt className="inline text-ink-faint">Expected: </dt><dd className="mono inline text-ink-dim">{snapshot.chainIdentity.expectedChain} {snapshot.chainIdentity.expectedChainId}</dd></div>
                      <div><dt className="inline text-ink-faint">Observed: </dt><dd className="mono inline text-ink-dim">{snapshot.chainIdentity.observedChainId ?? "Not decoded"}</dd></div>
                      <div><dt className="inline text-ink-faint">Raw result: </dt><dd className="mono inline break-all text-ink-dim">{snapshot.chainIdentity.rawResult ?? "Not retained"}</dd></div>
                    </dl>
                  </article>
                )}
                {snapshot.receipts.length > 0 ? snapshot.receipts.map((receipt, index) => (
                  <article key={`${receipt.id}:${index}`} className="border-b border-line/60 px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip">{receipt.method}</span>
                      <span className={`chip ${receipt.state === "returned" ? "tint-pass" : "tint-caution"}`}>{words(receipt.state)}</span>
                      <code className="mono ml-auto break-all text-[10.5px] text-ink-faint">{receipt.id}</code>
                    </div>
                    <dl className="mt-2 grid gap-x-5 gap-y-1 text-[11px] sm:grid-cols-2">
                      <div><dt className="inline text-ink-faint">Target: </dt><dd className="mono inline break-all text-ink-dim">{receipt.target}</dd></div>
                      <div><dt className="inline text-ink-faint">Block: </dt><dd className="mono inline text-ink-dim">#{receipt.blockNumber.toLocaleString("en-US")}</dd></div>
                      <div className="sm:col-span-2"><dt className="inline text-ink-faint">Block hash: </dt><dd className="mono inline break-all text-ink-dim">{receipt.blockHash}</dd></div>
                      {receipt.locator && <div className="sm:col-span-2"><dt className="inline text-ink-faint">Locator: </dt><dd className="mono inline break-all text-ink-dim">{receipt.locator}</dd></div>}
                      {receipt.byteLength != null && <div><dt className="inline text-ink-faint">Bytes: </dt><dd className="mono inline text-ink-dim">{receipt.byteLength.toLocaleString("en-US")}</dd></div>}
                      {receipt.resultSha256 && <div className="sm:col-span-2"><dt className="inline text-ink-faint">Result SHA-256: </dt><dd className="mono inline break-all text-ink-dim">{receipt.resultSha256}</dd></div>}
                      {receipt.rawResult && <div className="sm:col-span-2"><dt className="inline text-ink-faint">Raw result: </dt><dd className="mono inline break-all text-ink-dim">{receipt.rawResult}</dd></div>}
                    </dl>
                  </article>
                )) : (
                  <p className="px-4 py-3 text-[12px] leading-relaxed text-ink-faint">No control read receipt was saved.</p>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className="border-t border-line/70 px-4 py-4 sm:px-5" aria-label="Control surface limitations">
          <p className="eyebrow text-caution">Limits of this read</p>
          {snapshot.limitations.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {snapshot.limitations.map((limitation, index) => (
                <li key={`${limitation}:${index}`} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-dim">
                  <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-caution" />
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">No collector-specific limitation text was saved. The bounded standard-interface limits stated above still apply.</p>
          )}
          {snapshot.note && snapshot.state !== "unavailable" && <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">Collector note: {snapshot.note}</p>}
        </div>
      </div>
    </section>
  );
}
