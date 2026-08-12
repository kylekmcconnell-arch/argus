import { useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CheckCircle,
  Eye,
  LinkSimple,
  ShieldWarning,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import type { BasicFactLead } from "../data/evidence";
import type { Investigation } from "../lib/investigation";
import { projectLeadIsRelevant } from "../lib/projectLeadRelevance";

interface EyeAnswer {
  id: string;
  question: string;
  answer: string;
  citations: string[];
  reasoningSteps: string[];
  uncertainties: string[];
  whatWouldChange: string[];
  investigationRoute?: {
    intent: string;
    reasoningMode: string;
    inheritedIntent: boolean;
    answerMode: string;
    explanation: string;
    delegates: string[];
    blockedBy: string[];
    unresolvedQuestions: Array<{ id: string; prompt: string; state: string; materiality: string }>;
    evidenceFocus: Array<{ id: string; headline: string; polarity: string; evidenceState: string }>;
    /** Relevant signals left out of the packet. Never a high-severity adverse one. */
    evidenceFocusOmitted?: number;
    changeConditions: string[];
    claimChains: Array<{
      signalId: string;
      lineageState: string;
      inferenceBoundary: string;
      measurementCount: number;
      sourceCount: number;
      counterSignalIds: string[];
    }>;
  };
  state: "loading" | "ready" | "error";
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function projectLeads(inv: Investigation): BasicFactLead[] {
  const account = inv.projectAccount as (NonNullable<Investigation["projectAccount"]> & { basicFactLeads?: BasicFactLead[] }) | null;
  return account?.basicFactLeads ?? [];
}

function projectLabel(inv: Investigation): string {
  return inv.projectAccount?.display_name || inv.projectAccount?.handle || inv.token.name || `$${inv.token.symbol}`;
}

export function ArgusEyeAssistant({
  inv,
  reportVersionId,
}: {
  inv: Investigation;
  reportVersionId?: string;
}) {
  const [open, setOpen] = useState(() => (
    typeof window !== "undefined" && window.location.hash === "#argus-eye"
  ));
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<EyeAnswer[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const loading = answers.at(-1)?.state === "loading";

  const intelligence = useMemo<{
    headline: string;
    detail: string;
    status: string;
    tone: "pass" | "context" | "caution";
    rejectedLead?: BasicFactLead;
    person: string;
    sourceUrl?: string;
  }>(() => {
    const verifiedTeam = [
      ...(inv.projectAccount?.webTeam ?? []),
      ...(inv.webTeam ?? []),
    ].filter((member) => member.artifact_verified === true);
    const founder = verifiedTeam.find((member) => /founder|creator/i.test(member.role));
    const publishedFounder = (inv.projectAccount?.evidence.associates ?? []).find((associate) => (
      /^team:/i.test(associate.relation ?? "")
      && /founder|creator/i.test(associate.relation ?? "")
    ));
    const subject = inv.projectAccount ? {
      handle: inv.projectAccount.handle,
      display_name: inv.projectAccount.display_name,
      website: inv.siteUrl,
    } : null;
    const rejectedLead = subject
      ? projectLeads(inv).find((lead) => !projectLeadIsRelevant(subject, lead))
      : undefined;
    const label = projectLabel(inv);

    if (founder) {
      return {
        headline: `Trace ${founder.name}'s real influence on ${label}`,
        detail: `${founder.name} is source-bound as ${founder.role}. The report does not treat that attribution as proof of legal control, ownership, or wallet control.`,
        status: "Source bound",
        tone: "pass" as const,
        rejectedLead,
        person: founder.name,
      };
    }
    if (publishedFounder) {
      const role = String(publishedFounder.relation).replace(/^team:\s*/i, "");
      return {
        headline: `${label} identifies ${publishedFounder.associate_key} as ${role}`,
        detail: `This establishes the project's own published role attribution. Independent corroboration of the person behind the handle, legal ownership, wallet control, and operational authority remains open.`,
        status: "Project attributed",
        tone: "context" as const,
        rejectedLead,
        person: publishedFounder.associate_key,
        sourceUrl: publishedFounder.evidence_url,
      };
    }
    return {
      headline: `Resolve the people controlling ${label}`,
      detail: "The frozen report does not yet contain an independently verified founder or operator. Start with official historical claims, then corroborate them outside the project.",
      status: "Unresolved",
      tone: "caution" as const,
      rejectedLead,
      person: label,
    };
  }, [inv]);

  const ask = async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || !reportVersionId || loading) return;
    const id = `${Date.now()}-${answers.length}`;
    setQuestion("");
    setAnswers((current) => [...current, {
      id,
      question: q,
      answer: "Tracing the claim through the frozen report…",
      citations: [],
      reasoningSteps: [],
      uncertainties: [],
      whatWouldChange: [],
      state: "loading",
    }]);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: inv.projectX || `$${inv.token.symbol}`,
          question: q,
          reportVersionId,
          history: answers
            .filter((turn) => turn.state === "ready")
            .slice(-6)
            .map((turn) => ({ question: turn.question, answer: turn.answer })),
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        answer?: unknown;
        note?: unknown;
        citations?: unknown;
        reasoningSteps?: unknown;
        uncertainties?: unknown;
        whatWouldChange?: unknown;
        investigationRoute?: unknown;
      };
      const responseText = typeof body.answer === "string" && body.answer.trim()
        ? body.answer
        : typeof body.note === "string" && body.note.trim()
          ? body.note
          : "The frozen evidence does not establish an answer.";
      const citations = Array.isArray(body.citations)
        ? body.citations.map(safeUrl).filter((url): url is string => Boolean(url)).slice(0, 6)
        : [];
      const strings = (value: unknown, max: number) => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, max)
        : [];
      const rawRoute = body.investigationRoute !== null && typeof body.investigationRoute === "object"
        ? body.investigationRoute as Record<string, unknown>
        : null;
      const unresolvedQuestions = Array.isArray(rawRoute?.unresolvedQuestions)
        ? rawRoute.unresolvedQuestions
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
          .map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            prompt: typeof item.prompt === "string" ? item.prompt : "",
            state: typeof item.state === "string" ? item.state : "",
            materiality: typeof item.materiality === "string" ? item.materiality : "",
          }))
          .filter((item) => item.prompt)
          .slice(0, 4)
        : [];
      // Parsed before the display slice so the omitted count can include what
      // THIS component hides as well as what the server left out of the packet.
      const parsedFocus = Array.isArray(rawRoute?.evidenceFocus)
        ? rawRoute.evidenceFocus
          .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
          .map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            headline: typeof item.headline === "string" ? item.headline : "",
            polarity: typeof item.polarity === "string" ? item.polarity : "",
            evidenceState: typeof item.evidenceState === "string" ? item.evidenceState : "",
          }))
          .filter((item) => item.headline)
        : [];
      const serverOmitted = typeof rawRoute?.evidenceFocusOmitted === "number"
        && Number.isFinite(rawRoute.evidenceFocusOmitted)
        && rawRoute.evidenceFocusOmitted > 0
        ? Math.floor(rawRoute.evidenceFocusOmitted)
        : 0;
      const investigationRoute = rawRoute ? {
        intent: typeof rawRoute.intent === "string" ? rawRoute.intent : "general_diligence",
        reasoningMode: typeof rawRoute.reasoningMode === "string" ? rawRoute.reasoningMode : "answer_question",
        inheritedIntent: rawRoute.inheritedIntent === true,
        answerMode: typeof rawRoute.answerMode === "string" ? rawRoute.answerMode : "synthesize_saved_evidence",
        explanation: typeof rawRoute.explanation === "string" ? rawRoute.explanation : "",
        delegates: strings(rawRoute.delegates, 8),
        blockedBy: strings(rawRoute.blockedBy, 5),
        unresolvedQuestions,
        evidenceFocus: parsedFocus.slice(0, 5),
        evidenceFocusOmitted: serverOmitted + Math.max(0, parsedFocus.length - 5),
        changeConditions: strings(rawRoute.changeConditions, 5),
        claimChains: Array.isArray(rawRoute.claimChains)
          ? rawRoute.claimChains
            .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item))
            .map((item) => ({
              signalId: typeof item.signalId === "string" ? item.signalId : "",
              lineageState: typeof item.lineageState === "string" ? item.lineageState : "partial",
              inferenceBoundary: typeof item.inferenceBoundary === "string" ? item.inferenceBoundary : "",
              measurementCount: Array.isArray(item.measurements) ? item.measurements.length : 0,
              sourceCount: Array.isArray(item.sources) ? item.sources.length : 0,
              counterSignalIds: strings(item.counterSignalIds, 4),
            }))
            .filter((item) => item.signalId)
            .slice(0, 5)
          : [],
      } : undefined;
      setAnswers((current) => current.map((turn) => turn.id === id ? {
        ...turn,
        answer: responseText,
        citations,
        reasoningSteps: strings(body.reasoningSteps, 6),
        uncertainties: strings(body.uncertainties, 5),
        whatWouldChange: strings(body.whatWouldChange, 5),
        investigationRoute,
        state: response.ok ? "ready" : "error",
      } : turn));
    } catch {
      setAnswers((current) => current.map((turn) => turn.id === id ? {
        ...turn,
        answer: "ARGUS could not reach the frozen report evidence.",
        state: "error",
      } : turn));
    }
  };

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) window.setTimeout(() => inputRef.current?.focus(), 0);
      return next;
    });
  };

  return (
    <div className="fixed bottom-4 right-4 z-[70] sm:bottom-5 sm:right-5" data-testid="argus-eye-assistant">
      {open && (
        <section
          id="argus-eye-panel"
          role="dialog"
          aria-label="Ask ARGUS Eye about this report"
          className="mb-3 flex max-h-[min(640px,calc(100vh-96px))] w-[min(390px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-signal/30 bg-panel shadow-[0_24px_70px_rgba(10,24,52,0.22)]"
        >
          <header className="flex min-h-12 items-center gap-2 bg-signal px-3.5 text-on-signal">
            <Eye size={18} weight="duotone" aria-hidden="true" />
            <div className="min-w-0">
              <p className="mono text-[10px] font-semibold uppercase tracking-[0.11em]">ARGUS EYE</p>
              <p className="truncate text-[10px] opacity-80">Talk to the report-wide reasoning layer</p>
            </div>
            <span className="mono ml-auto rounded border border-white/25 px-1.5 py-0.5 text-[8.5px] uppercase tracking-[0.08em]">Evidence bound</span>
            <button type="button" onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10" aria-label="Close ARGUS Eye">
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </header>

          <div className="thin-scroll overflow-y-auto px-3.5 py-3.5">
            <div className="rounded-xl border border-line bg-panel-2/65 p-3">
              <div className="flex items-start gap-2.5">
                <Sparkle size={16} weight="duotone" className="mt-0.5 shrink-0 text-signal-lift" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="eyebrow">What matters now</p>
                  <p className="mt-1 text-[12.5px] font-semibold leading-snug text-ink">{intelligence.headline}</p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">{intelligence.detail}</p>
                  {intelligence.sourceUrl && (
                    <a href={intelligence.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-medium text-signal-lift hover:underline">
                      <LinkSimple size={12} aria-hidden="true" /> Open project attribution
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center border-t border-line/70 pt-2.5">
                {intelligence.tone === "pass"
                  ? <CheckCircle size={15} weight="fill" className="mr-1.5 text-pass" aria-hidden="true" />
                  : <ShieldWarning size={15} weight="duotone" className="mr-1.5 text-caution" aria-hidden="true" />}
                <span className="text-[10.5px] text-ink-faint">Role evidence state</span>
                <span className={`chip ml-auto ${intelligence.tone === "pass" ? "tint-pass" : intelligence.tone === "context" ? "tint-signal" : "tint-caution"}`}>{intelligence.status}</span>
              </div>
            </div>

            {intelligence.rejectedLead && (
              <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-avoid/20 bg-avoid/5 px-3 py-2.5">
                <ShieldWarning size={15} weight="duotone" className="mt-0.5 shrink-0 text-avoid" aria-hidden="true" />
                <p className="text-[10.5px] leading-relaxed text-ink-dim">
                  <span className="font-semibold text-ink">Conflict rejected:</span> {intelligence.rejectedLead.sourceTitle || intelligence.rejectedLead.value} did not bind to this project's canonical identity.
                </p>
              </div>
            )}

            {answers.length === 0 && (
              <div className="mt-3 grid gap-1.5" aria-label="Suggested questions">
                {[
                  "Give me the investment thesis and strongest counter-thesis.",
                  `Trace the strongest connections around ${intelligence.person}.`,
                  "Challenge the conclusion and tell me what would change it.",
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void ask(prompt)}
                    disabled={!reportVersionId}
                    className="group flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-left text-[11px] leading-snug text-ink-dim transition hover:border-signal/35 hover:bg-signal-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">{prompt}</span>
                    <ArrowUp size={13} className="rotate-45 text-ink-faint transition group-hover:text-signal-lift" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}

            {answers.length > 0 && (
              <div className="mt-3 space-y-3" aria-live="polite">
                {answers.map((answer) => (
                  <div key={answer.id} className="space-y-2.5">
                    <div className="ml-7 rounded-xl rounded-br-sm bg-signal-soft px-3 py-2 text-[11.5px] leading-relaxed text-ink">{answer.question}</div>
                    <div className="mr-2 rounded-xl rounded-bl-sm border border-line bg-panel-2 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Eye size={14} weight="duotone" className="text-signal-lift" aria-hidden="true" />
                    <span className="mono text-[9px] uppercase tracking-[0.09em] text-ink-faint">Report-wide conclusion</span>
                  </div>
                  <p className={`mt-1.5 text-[11.5px] leading-relaxed ${answer.state === "error" ? "text-caution" : "text-ink-dim"}`}>{answer.answer}</p>
                  {answer.reasoningSteps.length > 0 && (
                    <div className="mt-2.5 border-t border-line/70 pt-2.5">
                      <p className="eyebrow">Reasoning chain</p>
                      <ol className="mt-1.5 space-y-1.5">
                        {answer.reasoningSteps.map((step, index) => (
                          <li key={`${index}-${step}`} className="flex gap-2 text-[10.5px] leading-relaxed text-ink-dim">
                            <span className="mono flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-signal/25 text-[8px] text-signal-lift">{index + 1}</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {answer.investigationRoute && (
                    <details className="mt-2.5 rounded-lg border border-signal/20 bg-signal-soft/45 px-2.5 py-2" open={answer.investigationRoute.answerMode === "investigate_evidence_gap"}>
                      <summary className="cursor-pointer text-[10.5px] font-medium text-signal-lift">How ARGUS routed this question</summary>
                      <div className="mt-1.5 space-y-1.5 text-[10.5px] leading-relaxed text-ink-dim">
                        <p>{answer.investigationRoute.explanation}</p>
                        <p className="mono text-[9.5px] text-ink-faint">{answer.investigationRoute.intent.replaceAll("_", " ")} · {answer.investigationRoute.reasoningMode.replaceAll("_", " ")} · {answer.investigationRoute.answerMode.replaceAll("_", " ")}</p>
                        {answer.investigationRoute.inheritedIntent && (
                          <p className="text-ink-faint">This follow-up inherits the prior question's decision goal. Earlier answers were not treated as evidence.</p>
                        )}
                        {answer.investigationRoute.delegates.length > 0 && (
                          <p><span className="font-medium text-ink">Specialists:</span> {answer.investigationRoute.delegates.join(" · ")}</p>
                        )}
                        {answer.investigationRoute.blockedBy.length > 0 && (
                          <p className="text-caution"><span className="font-medium">Identity gates:</span> {answer.investigationRoute.blockedBy.join(" · ")}</p>
                        )}
                        {answer.investigationRoute.evidenceFocus.length > 0 && (
                          <div className="border-t border-signal/15 pt-1.5">
                            <p className="font-medium text-ink">Evidence selected for this question</p>
                            <ul className="mt-1 space-y-1">
                              {answer.investigationRoute.evidenceFocus.map((item) => (
                                <li key={item.id}>
                                  • {item.headline} <span className="text-ink-faint">({item.evidenceState} · {item.polarity})</span>
                                  {answer.investigationRoute?.claimChains.find((chain) => chain.signalId === item.id) && (() => {
                                    const chain = answer.investigationRoute!.claimChains.find((candidate) => candidate.signalId === item.id)!;
                                    return (
                                      <span className="mt-0.5 block pl-2 text-[9.5px] text-ink-faint">
                                        {chain.lineageState} lineage · {chain.measurementCount} measurements · {chain.sourceCount} sources{chain.counterSignalIds.length ? ` · ${chain.counterSignalIds.length} counterweights` : ""}
                                        {chain.inferenceBoundary && (
                                          <details className="mt-0.5">
                                            <summary className="cursor-pointer text-signal-lift">Reasoning boundary</summary>
                                            <span className="mt-0.5 block leading-relaxed">{chain.inferenceBoundary}</span>
                                          </details>
                                        )}
                                      </span>
                                    );
                                  })()}
                                </li>
                              ))}
                            </ul>
                            {(answer.investigationRoute.evidenceFocusOmitted ?? 0) > 0 && (
                              <p className="mt-1 text-ink-faint">
                                {answer.investigationRoute.evidenceFocusOmitted} further saved signal
                                {answer.investigationRoute.evidenceFocusOmitted === 1 ? " was" : "s were"} relevant but not
                                carried into this answer. Every high-severity adverse signal is always included.
                              </p>
                            )}
                          </div>
                        )}
                        {answer.investigationRoute.unresolvedQuestions.length > 0 && (
                          <ul className="space-y-1 border-t border-signal/15 pt-1.5">
                            {answer.investigationRoute.unresolvedQuestions.map((item) => (
                              <li key={item.id}>• {item.prompt} <span className="text-ink-faint">({item.materiality} · {item.state})</span></li>
                            ))}
                          </ul>
                        )}
                        {answer.investigationRoute.changeConditions.length > 0 && (
                          <details className="border-t border-signal/15 pt-1.5">
                            <summary className="cursor-pointer font-medium text-ink">Decisive evidence boundary</summary>
                            <ul className="mt-1 space-y-1">
                              {answer.investigationRoute.changeConditions.map((condition) => <li key={condition}>• {condition}</li>)}
                            </ul>
                          </details>
                        )}
                      </div>
                    </details>
                  )}
                  {answer.uncertainties.length > 0 && (
                    <div className="mt-2.5 rounded-lg border border-caution/20 bg-caution/5 px-2.5 py-2">
                      <p className="eyebrow">What remains uncertain</p>
                      <ul className="mt-1 space-y-1 text-[10.5px] leading-relaxed text-ink-dim">
                        {answer.uncertainties.map((gap) => <li key={gap}>• {gap}</li>)}
                      </ul>
                    </div>
                  )}
                  {answer.whatWouldChange.length > 0 && (
                    <details className="mt-2.5 border-t border-line/70 pt-2">
                      <summary className="cursor-pointer text-[10.5px] font-medium text-signal-lift">What would change this conclusion?</summary>
                      <ul className="mt-1.5 space-y-1 text-[10.5px] leading-relaxed text-ink-dim">
                        {answer.whatWouldChange.map((change) => <li key={change}>• {change}</li>)}
                      </ul>
                    </details>
                  )}
                  {answer.citations.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line/70 pt-2">
                      {answer.citations.map((url, index) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="chip inline-flex items-center gap-1 normal-case tracking-normal text-signal-lift hover:border-signal/40">
                          <LinkSimple size={11} aria-hidden="true" /> Source {index + 1}
                        </a>
                      ))}
                    </div>
                  )}
                    </div>
                  </div>
                ))}
                </div>
            )}
          </div>

          <form className="border-t border-line bg-panel px-3 py-3" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-2 p-1.5 focus-within:border-signal/45 focus-within:ring-2 focus-within:ring-signal/10">
              <textarea
                ref={inputRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void ask();
                  }
                }}
                disabled={!reportVersionId}
                rows={2}
                placeholder={reportVersionId ? "Ask a follow-up, trace a connection, or challenge a claim…" : "Save this report to ask ARGUS"}
                className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-60"
                aria-label="Ask ARGUS Eye"
              />
              <button type="submit" disabled={!question.trim() || !reportVersionId || loading} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal text-on-signal transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send question">
                <ArrowUp size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <p className="mt-2 text-center text-[9.5px] leading-snug text-ink-faint">The Eye reasons across this report's frozen evidence and remembers this conversation. It will not fill evidence gaps with guesses.</p>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="argus-eye-panel"
        className={`ml-auto flex h-13 items-center gap-2 rounded-full border px-3.5 shadow-[0_12px_34px_rgba(28,82,196,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(28,82,196,0.34)] ${open ? "border-signal/30 bg-panel text-signal-lift" : "border-signal bg-signal text-on-signal"}`}
        aria-label={open ? "Hide ARGUS Eye" : "Ask ARGUS Eye about this report"}
      >
        <Eye size={21} weight="duotone" aria-hidden="true" />
        <span className="mono pr-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">ARGUS EYE</span>
      </button>
    </div>
  );
}
