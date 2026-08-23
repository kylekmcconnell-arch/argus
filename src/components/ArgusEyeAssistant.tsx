import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Eye,
  LinkSimple,
  ShieldWarning,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import type { BasicFactLead } from "../data/evidence";
import type { Investigation } from "../lib/investigation";
import { CHALLENGE_EVENT, type ChallengeDetail } from "../lib/challenge";
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
    authorizationPreview?: {
      gapId: string;
      gapPrompt: string;
      taskIds: string[];
      timeBudgetSeconds: number;
      estimatedCostCeilingUsd: number;
    };
  };
  followUp?: {
    state: "running" | "proposed" | "partial" | "promoted" | "rolled_back" | "error";
    note?: string;
    authorizationId?: string;
    proposedReportVersionId?: string;
    reviewPath?: string;
    observedCostUsd?: number;
    costOutcome?: string;
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
  subject,
  reportVersionId,
  anchorId = "argus-eye",
}: {
  inv?: Investigation;
  subject?: string;
  reportVersionId?: string;
  anchorId?: string;
}) {
  const [open, setOpen] = useState(() => (
    typeof window !== "undefined" && window.location.hash === "#argus-eye"
  ));
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<EyeAnswer[]>([]);
  const [challengeContext, setChallengeContext] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextAnswerId = useRef(0);
  const loading = answers.at(-1)?.state === "loading";
  const requestSubject = subject || inv?.projectX || (inv ? `$${inv.token.symbol}` : "this report");

  const intelligence = useMemo<{
    headline: string;
    detail: string;
    rejectedLead?: BasicFactLead;
    sourceUrl?: string;
  }>(() => {
    if (!inv) {
      return {
        headline: reportVersionId
          ? `Ask anything about the saved report for ${requestSubject}.`
          : `Save this report to ask questions about ${requestSubject}.`,
        detail: "ARGUS answers from the information saved in this report and says when the evidence is missing.",
      };
    }
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
        headline: `${founder.name} is listed as ${founder.role}, but that does not prove they control ${label}.`,
        detail: `ARGUS verified the published role. It did not find enough evidence to confirm legal ownership or control of the project's wallets.`,
        rejectedLead,
      };
    }
    if (publishedFounder) {
      const role = String(publishedFounder.relation).replace(/^team:\s*/i, "");
      return {
        headline: `${label} says ${publishedFounder.associate_key} is ${role}. ARGUS has not independently confirmed who controls the project.`,
        detail: `The role comes from the project's own account. The report does not yet confirm the person's identity, legal ownership, or control of the project's wallets.`,
        rejectedLead,
        sourceUrl: publishedFounder.evidence_url,
      };
    }
    return {
      headline: `ARGUS could not confirm who controls ${label}.`,
      detail: "The saved report does not contain enough independent evidence to verify a founder or operator.",
      rejectedLead,
    };
  }, [inv, reportVersionId, requestSubject]);

  useEffect(() => {
    const onChallenge = (event: Event) => {
      const detail = (event as CustomEvent<ChallengeDetail>).detail;
      if (!detail?.context) return;
      setChallengeContext(detail.context);
      setOpen(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener(CHALLENGE_EVENT, onChallenge);
    return () => window.removeEventListener(CHALLENGE_EVENT, onChallenge);
  }, []);

  const ask = async (preset?: string) => {
    const q = (preset ?? question).trim();
    if (!q || !reportVersionId || loading) return;
    const routedQuestion = challengeContext ? `[Challenging: ${challengeContext}] ${q}` : q;
    nextAnswerId.current += 1;
    const id = String(nextAnswerId.current);
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
          subject: requestSubject,
          question: routedQuestion,
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
        authorizationPreview: (() => {
          const preview = rawRoute.authorizationPreview !== null && typeof rawRoute.authorizationPreview === "object"
            ? rawRoute.authorizationPreview as Record<string, unknown>
            : null;
          const previewTaskIds = strings(preview?.taskIds, 8);
          return preview
            && typeof preview.gapId === "string"
            && typeof preview.gapPrompt === "string"
            && typeof preview.timeBudgetSeconds === "number"
            && typeof preview.estimatedCostCeilingUsd === "number"
            && previewTaskIds.length
            ? {
                gapId: preview.gapId,
                gapPrompt: preview.gapPrompt,
                taskIds: previewTaskIds,
                timeBudgetSeconds: preview.timeBudgetSeconds,
                estimatedCostCeilingUsd: preview.estimatedCostCeilingUsd,
              }
            : undefined;
        })(),
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

  const authorizeFollowUp = async (answer: EyeAnswer) => {
    const preview = answer.investigationRoute?.authorizationPreview;
    if (!preview || !reportVersionId || answer.followUp?.state === "running") return;
    setAnswers((current) => current.map((turn) => turn.id === answer.id
      ? { ...turn, followUp: { state: "running", note: "Running the bounded specialist plan…" } }
      : turn));
    try {
      const response = await fetch("/api/gap-investigation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceReportVersionId: reportVersionId,
          gapId: preview.gapId,
          taskIds: preview.taskIds,
          timeBudgetSeconds: preview.timeBudgetSeconds,
          acceptedCostCeilingUsd: preview.estimatedCostCeilingUsd,
        }),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const followUpState = body.status === "proposed" ? "proposed" : body.status === "partial" ? "partial" : "error";
      setAnswers((current) => current.map((turn) => turn.id === answer.id ? {
        ...turn,
        followUp: {
          state: response.ok ? followUpState : "error",
          note: typeof body.note === "string" ? body.note : response.ok
            ? "The proposed report version is inactive until an analyst promotes it."
            : "The bounded investigation could not produce a proposal.",
          authorizationId: typeof body.authorizationId === "string" ? body.authorizationId : undefined,
          proposedReportVersionId: typeof body.proposedReportVersionId === "string" ? body.proposedReportVersionId : undefined,
          reviewPath: typeof body.reviewPath === "string" ? body.reviewPath : undefined,
          observedCostUsd: typeof body.observedCostUsd === "number" ? body.observedCostUsd : undefined,
          costOutcome: typeof body.costOutcome === "string" ? body.costOutcome : undefined,
        },
      } : turn));
    } catch {
      setAnswers((current) => current.map((turn) => turn.id === answer.id
        ? { ...turn, followUp: { state: "error", note: "ARGUS could not complete the bounded investigation." } }
        : turn));
    }
  };

  const mutateFollowUp = async (answer: EyeAnswer, action: "promote" | "rollback") => {
    const authorizationId = answer.followUp?.authorizationId;
    if (!authorizationId) return;
    if (action === "promote" && !window.confirm("Promote this reviewed proposal to the active report?")) return;
    try {
      const response = await fetch("/api/gap-investigation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorizationId, action }),
      });
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      setAnswers((current) => current.map((turn) => turn.id === answer.id ? {
        ...turn,
        followUp: response.ok
          ? {
              ...turn.followUp,
              state: action === "promote" ? "promoted" : "rolled_back",
              note: action === "promote"
                ? "The proposal passed the guarded activation path and is now active."
                : "The proposal was rolled back and remains inactive.",
            }
          : { ...turn.followUp, state: "error", note: typeof body.note === "string" ? body.note : "The proposal action failed." },
      } : turn));
    } catch {
      setAnswers((current) => current.map((turn) => turn.id === answer.id
        ? { ...turn, followUp: { ...turn.followUp, state: "error", note: "ARGUS could not update the proposal." } }
        : turn));
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
    <div id={anchorId} className="argus-eye-assistant fixed z-[70]" data-testid="argus-eye-assistant">
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
              <p className="truncate text-[10px] opacity-80">Ask about this report</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10" aria-label="Close ARGUS Eye">
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </header>

          <div className="thin-scroll overflow-y-auto px-3.5 py-3.5">
            {challengeContext && (
              <div className="mb-2.5 flex items-start gap-2 rounded-lg border border-caution/25 bg-caution/5 px-3 py-2.5">
                <ShieldWarning size={15} weight="duotone" className="mt-0.5 shrink-0 text-caution" aria-hidden="true" />
                <p className="min-w-0 flex-1 text-[10.5px] leading-relaxed text-ink-dim">
                  <span className="font-semibold text-ink">Focus:</span> {challengeContext}
                </p>
                <button type="button" onClick={() => setChallengeContext(null)} aria-label="Clear challenge context" className="text-[10px] text-ink-faint transition hover:text-ink">Clear</button>
              </div>
            )}
            <div className="rounded-xl border border-line bg-panel-2/65 p-3">
              <div className="flex items-start gap-2.5">
                <Sparkle size={16} weight="duotone" className="mt-0.5 shrink-0 text-signal-lift" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="eyebrow">Start here</p>
                  <p className="mt-1 text-[12.5px] font-semibold leading-snug text-ink">{intelligence.headline}</p>
                </div>
              </div>
              <details className="mt-2.5 border-t border-line/70 pt-2.5">
                <summary className="cursor-pointer text-[10.5px] font-medium text-signal-lift">Why ARGUS says this</summary>
                <div className="mt-1.5 space-y-2 text-[10.5px] leading-relaxed text-ink-dim">
                  <p>{intelligence.detail}</p>
                  {intelligence.rejectedLead && (
                    <p>ARGUS ignored an unrelated search result: {intelligence.rejectedLead.sourceTitle || intelligence.rejectedLead.value}.</p>
                  )}
                  {intelligence.sourceUrl && (
                    <a href={intelligence.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-signal-lift hover:underline">
                      <LinkSimple size={12} aria-hidden="true" /> View the project's statement
                    </a>
                  )}
                </div>
              </details>
            </div>

            {answers.length === 0 && (
              <div className="mt-3 grid gap-1.5" aria-label="Suggested questions">
                {[
                  "Is this worth the risk?",
                  "What is the biggest concern?",
                  "What could change the conclusion?",
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
                    <span className="mono text-[9px] uppercase tracking-[0.09em] text-ink-faint">Answer</span>
                  </div>
                  <p className={`mt-1.5 text-[11.5px] leading-relaxed ${answer.state === "error" ? "text-caution" : "text-ink-dim"}`}>{answer.answer}</p>
                  {(answer.reasoningSteps.length > 0 || answer.citations.length > 0) && (
                    <details className="mt-2.5 border-t border-line/70 pt-2.5">
                      <summary className="cursor-pointer text-[10.5px] font-medium text-signal-lift">Why this answer</summary>
                      <ol className="mt-1.5 space-y-1.5">
                        {answer.reasoningSteps.map((step, index) => (
                          <li key={`${index}-${step}`} className="flex gap-2 text-[10.5px] leading-relaxed text-ink-dim">
                            <span className="mono flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-signal/25 text-[8px] text-signal-lift">{index + 1}</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                      {answer.citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {answer.citations.map((url, index) => (
                            <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="chip inline-flex items-center gap-1 normal-case tracking-normal text-signal-lift hover:border-signal/40">
                              <LinkSimple size={11} aria-hidden="true" /> Source {index + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </details>
                  )}
                  {answer.investigationRoute && (
                    <details className="mt-2.5 rounded-lg border border-signal/20 bg-signal-soft/45 px-2.5 py-2">
                      <summary className="cursor-pointer text-[10.5px] font-medium text-signal-lift">Evidence checked</summary>
                      <div className="mt-1.5 space-y-1.5 text-[10.5px] leading-relaxed text-ink-dim">
                        <p>{answer.investigationRoute.explanation}</p>
                        {answer.investigationRoute.inheritedIntent && (
                          <p className="text-ink-faint">This follows from your previous question. Earlier answers were not treated as evidence.</p>
                        )}
                        {answer.investigationRoute.evidenceFocus.length > 0 && (
                          <div className="border-t border-signal/15 pt-1.5">
                            <p className="font-medium text-ink">Information used</p>
                            <ul className="mt-1 space-y-1">
                              {answer.investigationRoute.evidenceFocus.map((item) => (
                                <li key={item.id}>
                                  • {item.headline}
                                  {answer.investigationRoute?.claimChains.find((chain) => chain.signalId === item.id) && (() => {
                                    const chain = answer.investigationRoute!.claimChains.find((candidate) => candidate.signalId === item.id)!;
                                    return (
                                      <span className="mt-0.5 block pl-2 text-[9.5px] text-ink-faint">
                                        Checked against {chain.sourceCount} source{chain.sourceCount === 1 ? "" : "s"} and {chain.measurementCount} saved fact{chain.measurementCount === 1 ? "" : "s"}.
                                        {chain.inferenceBoundary && (
                                          <details className="mt-0.5">
                                            <summary className="cursor-pointer text-signal-lift">What this does not prove</summary>
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
                                {answer.investigationRoute.evidenceFocusOmitted} other relevant saved item
                                {answer.investigationRoute.evidenceFocusOmitted === 1 ? " was" : "s were"} not shown here. Serious risks are always included.
                              </p>
                            )}
                          </div>
                        )}
                        {answer.investigationRoute.unresolvedQuestions.length > 0 && (
                          <div className="border-t border-signal/15 pt-1.5">
                            <p className="font-medium text-ink">Still unanswered</p>
                            <ul className="mt-1 space-y-1">
                            {answer.investigationRoute.unresolvedQuestions.map((item) => (
                              <li key={item.id}>• {item.prompt}</li>
                            ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  )}
                  {answer.investigationRoute?.authorizationPreview && (
                    <div className="mt-2.5 rounded-lg border border-caution/25 bg-caution/5 px-2.5 py-2.5">
                      <p className="text-[10.5px] font-semibold text-ink">Bounded evidence-gap investigation</p>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-dim">
                        {answer.investigationRoute.authorizationPreview.gapPrompt}
                      </p>
                      <p className="mono mt-1.5 text-[9px] uppercase tracking-[0.06em] text-ink-faint">
                        {answer.investigationRoute.authorizationPreview.taskIds.length} saved task{answer.investigationRoute.authorizationPreview.taskIds.length === 1 ? "" : "s"}
                        {" · "}{Math.round(answer.investigationRoute.authorizationPreview.timeBudgetSeconds / 60)} minute limit
                        {" · "}${answer.investigationRoute.authorizationPreview.estimatedCostCeilingUsd.toFixed(2)} estimated ceiling
                      </p>
                      {!answer.followUp && (
                        <button
                          type="button"
                          onClick={() => void authorizeFollowUp(answer)}
                          className="mt-2 rounded-md bg-caution px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:opacity-90"
                        >
                          Authorize investigation
                        </button>
                      )}
                      {answer.followUp && (
                        <div className="mt-2 border-t border-caution/20 pt-2 text-[10.5px] leading-relaxed text-ink-dim">
                          <p>{answer.followUp.note}</p>
                          {typeof answer.followUp.observedCostUsd === "number" && (
                            <p className="mt-1 text-ink-faint">
                              Observed estimated cost ${answer.followUp.observedCostUsd.toFixed(2)}
                              {answer.followUp.costOutcome === "estimate_exceeded"
                                ? " · approved ceiling reached; the proposal remains inactive and needs more evidence"
                                : " · within ceiling"}
                            </p>
                          )}
                          {(answer.followUp.state === "proposed" || answer.followUp.state === "partial") && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {answer.followUp.reviewPath && (
                                <a href={answer.followUp.reviewPath} className="rounded-md border border-signal/25 px-2 py-1 text-[10px] font-medium text-signal-lift hover:bg-signal-soft">
                                  Review proposed report
                                </a>
                              )}
                              <button type="button" onClick={() => void mutateFollowUp(answer, "promote")} className="rounded-md bg-signal px-2 py-1 text-[10px] font-semibold text-on-signal">
                                Promote after review
                              </button>
                              <button type="button" onClick={() => void mutateFollowUp(answer, "rollback")} className="rounded-md border border-line px-2 py-1 text-[10px] text-ink-dim">
                                Roll back
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {answer.uncertainties.length > 0 && (
                    <div className="mt-2.5 rounded-lg border border-caution/20 bg-caution/5 px-2.5 py-2">
                      <details>
                        <summary className="cursor-pointer text-[10.5px] font-medium text-caution">What ARGUS could not confirm</summary>
                        <ul className="mt-1 space-y-1 text-[10.5px] leading-relaxed text-ink-dim">
                          {answer.uncertainties.map((gap) => <li key={gap}>• {gap}</li>)}
                        </ul>
                      </details>
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
                placeholder={reportVersionId ? "Ask anything about this report…" : "Save this report to ask ARGUS"}
                className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[11.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:opacity-60"
                aria-label="Ask ARGUS Eye"
              />
              <button type="submit" disabled={!question.trim() || !reportVersionId || loading} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal text-on-signal transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send question">
                <ArrowUp size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="argus-eye-panel"
        className={`floating-brand-launcher ml-auto flex h-13 items-center gap-2 rounded-full border px-3.5 transition hover:-translate-y-0.5 ${open ? "brightness-95" : ""}`}
        aria-label={open ? "Hide ARGUS Eye" : "Ask ARGUS Eye about this report"}
      >
        <Eye size={21} weight="duotone" aria-hidden="true" />
        <span className="mono pr-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">ARGUS EYE</span>
      </button>
    </div>
  );
}
