import { useEffect, useRef, useState } from "react";
import { CHALLENGE_EVENT, requestChallengeAsk, type ChallengeDetail } from "../lib/challenge";

// The structured challenge dialog. A challenger first says WHO they are: part
// of the subject's own team, or a community member. Team claims are gated by a
// domain-bound email verification (the server checks the domain against the
// FROZEN report's verified official site and emails a single-use link), which
// protects startups from impersonation and gives a verified team correction a
// higher confirmation level. Two text fields, distinct on purpose: "What's
// wrong here?" corrects THIS report; "Where did this go wrong?" describes how
// the system's logic erred and routes to ARGUS's global methodology learning.

const MAX_FILES = 3;
const MAX_FILE_BYTES = 2_000_000;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);

type Attachment = { name: string; type: string; dataUrl: string };

type VerifyState =
  | { step: "idle" }
  | { step: "sending" }
  | { step: "waiting"; verificationId: string }
  | { step: "verified"; verificationId: string }
  | { step: "failed"; note: string };

export function ChallengeDialog({
  subject,
  reportVersionId,
  officialDomain,
}: {
  subject: string;
  reportVersionId?: string;
  /** Display-only hint for the email field; the server re-derives and enforces the real domain. */
  officialDomain?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState("");
  const [role, setRole] = useState<"community" | "team">("community");
  const [email, setEmail] = useState("");
  const [verify, setVerify] = useState<VerifyState>({ step: "idle" });
  const [whatsWrong, setWhatsWrong] = useState("");
  const [whereWrong, setWhereWrong] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileNote, setFileNote] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [submitNote, setSubmitNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const onChallenge = (event: Event) => {
      const detail = (event as CustomEvent<ChallengeDetail>).detail;
      setContext(detail?.context ?? "");
      setSubmitState("idle");
      setSubmitNote("");
      setOpen(true);
    };
    window.addEventListener(CHALLENGE_EVENT, onChallenge);
    return () => window.removeEventListener(CHALLENGE_EVENT, onChallenge);
  }, []);

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
  }, []);

  if (!open) return null;

  const startVerification = async () => {
    if (!reportVersionId) {
      setVerify({ step: "failed", note: "This report has no saved version id, so team verification cannot run here." });
      return;
    }
    setVerify({ step: "sending" });
    try {
      const response = await fetch("/api/report-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_verification", subject, reportVersionId, email: email.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { available?: boolean; verificationId?: string; note?: string; error?: string };
      if (!response.ok || body.available === false || !body.verificationId) {
        setVerify({ step: "failed", note: body.note ?? body.error ?? "The verification email could not be sent." });
        return;
      }
      const verificationId = body.verificationId;
      setVerify({ step: "waiting", verificationId });
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await fetch(`/api/report-challenge?action=status&id=${encodeURIComponent(verificationId)}`);
          const statusBody = await status.json().catch(() => ({})) as { verified?: boolean; expired?: boolean };
          if (statusBody.verified) {
            setVerify({ step: "verified", verificationId });
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
          } else if (statusBody.expired) {
            setVerify({ step: "failed", note: "The verification link expired. Send a new one." });
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
          }
        } catch { /* keep polling */ }
      }, 4000);
    } catch {
      setVerify({ step: "failed", note: "The verification request failed. Try again." });
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFileNote("");
    for (const file of Array.from(list)) {
      if (files.length >= MAX_FILES) { setFileNote(`At most ${MAX_FILES} files.`); break; }
      if (!FILE_TYPES.has(file.type)) { setFileNote(`${file.name}: only png, jpeg, webp, pdf, or plain text.`); continue; }
      if (file.size > MAX_FILE_BYTES) { setFileNote(`${file.name}: larger than 2MB.`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (dataUrl) setFiles((current) => current.length < MAX_FILES ? [...current, { name: file.name, type: file.type, dataUrl }] : current);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const teamReady = role !== "team" || verify.step === "verified";
  const canSubmit = whatsWrong.trim().length > 0 && teamReady && submitState !== "sending";

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitState("sending");
    try {
      const response = await fetch("/api/report-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          subject,
          reportVersionId,
          context,
          role,
          whatsWrong: whatsWrong.trim(),
          whereWrong: whereWrong.trim(),
          ...(role === "team" && verify.step === "verified"
            ? { email: email.trim().toLowerCase(), verificationId: verify.verificationId }
            : {}),
          files,
        }),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; emailVerified?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setSubmitState("error");
        setSubmitNote(body.error ?? "The challenge could not be recorded. Try again.");
        return;
      }
      setSubmitState("done");
      setSubmitNote(body.emailVerified
        ? "Recorded with team-verified standing. Corrections from the verified team carry a higher confirmation level in review."
        : "Recorded. An ARGUS reviewer will check it against the saved evidence.");
      setWhatsWrong("");
      setWhereWrong("");
      setFiles([]);
    } catch {
      setSubmitState("error");
      setSubmitNote("The challenge could not be recorded. Try again.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Challenge this report" data-testid="challenge-dialog">
      <div className="panel mt-10 w-full max-w-xl bg-paper px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ink">Challenge this report</h3>
            {context && <p className="mt-1 text-[12px] text-ink-dim">About: {context}</p>}
          </div>
          <button type="button" className="btn-chip text-[12px]" onClick={() => setOpen(false)}>Close</button>
        </div>

        <label className="mt-3 block text-[12px] font-medium text-ink" htmlFor="challenge-role">Who is challenging?</label>
        <select
          id="challenge-role"
          className="input mt-1 w-full text-[13px]"
          value={role}
          onChange={(event) => setRole(event.target.value === "team" ? "team" : "community")}
        >
          <option value="community">I am a community member</option>
          <option value="team">I am part of the {subject} team</option>
        </select>

        {role === "team" && (
          <div className="mt-2 rounded border border-line/70 px-3 py-2">
            <p className="text-[12px] text-ink-dim">
              Team corrections are verified so nobody can pose as {subject}. Enter a work email
              {officialDomain ? ` on ${officialDomain}` : " on the company domain"}; ARGUS emails a one-time link, and once you
              click it this form submits with team-verified standing.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="email"
                className="input min-w-[14rem] flex-1 text-[13px]"
                placeholder={officialDomain ? `you@${officialDomain}` : "you@company.com"}
                value={email}
                onChange={(event) => { setEmail(event.target.value); if (verify.step !== "idle") setVerify({ step: "idle" }); }}
                aria-label="Team work email"
              />
              <button
                type="button"
                className="btn-chip text-[12px]"
                disabled={verify.step === "sending" || verify.step === "waiting" || verify.step === "verified" || !email.includes("@")}
                onClick={() => void startVerification()}
              >
                {verify.step === "sending" ? "Sending…" : verify.step === "waiting" ? "Email sent" : "Send verification email"}
              </button>
            </div>
            {verify.step === "waiting" && <p className="mt-1 text-[12px] text-ink-dim">Waiting for you to click the link in your inbox. This form updates by itself.</p>}
            {verify.step === "verified" && <p className="mt-1 text-[12px] font-medium text-signal-lift">Verified as {email.trim()}. Your correction will carry team-verified standing.</p>}
            {verify.step === "failed" && <p className="mt-1 text-[12px] text-avoid">{verify.note}</p>}
          </div>
        )}

        <label className="mt-3 block text-[12px] font-medium text-ink" htmlFor="challenge-whats-wrong">What&apos;s wrong here?</label>
        <textarea
          id="challenge-whats-wrong"
          className="input mt-1 w-full text-[13px]"
          rows={4}
          placeholder="What the report gets wrong, and what the correct information is."
          value={whatsWrong}
          onChange={(event) => setWhatsWrong(event.target.value)}
        />

        <label className="mt-3 block text-[12px] font-medium text-ink" htmlFor="challenge-where-wrong">Where did this go wrong?</label>
        <p className="text-[11px] text-ink-dim">Optional: how ARGUS&apos;s logic made this mistake. This goes to overall system learning, beyond this one report, so the same mistake is not repeated anywhere.</p>
        <textarea
          id="challenge-where-wrong"
          className="input mt-1 w-full text-[13px]"
          rows={3}
          placeholder="For example: the system trusted a namesake account, or read a paused program as active."
          value={whereWrong}
          onChange={(event) => setWhereWrong(event.target.value)}
        />

        <div className="mt-3">
          <label className="block text-[12px] font-medium text-ink" htmlFor="challenge-files">Corroborating files</label>
          <p className="text-[11px] text-ink-dim">Up to {MAX_FILES} files (png, jpeg, webp, pdf, or plain text; 2MB each) attached as evidence.</p>
          <input
            id="challenge-files"
            ref={fileInputRef}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.webp,.pdf,.txt"
            className="mt-1 text-[12px]"
            onChange={(event) => addFiles(event.target.files)}
          />
          {files.length > 0 && (
            <ul className="mt-1 text-[12px] text-ink-dim">
              {files.map((file) => (
                <li key={file.name} className="flex items-center gap-2">
                  <span>{file.name}</span>
                  <button type="button" className="underline" onClick={() => setFiles((current) => current.filter((entry) => entry !== file))}>remove</button>
                </li>
              ))}
            </ul>
          )}
          {fileNote && <p className="mt-1 text-[12px] text-avoid">{fileNote}</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-chip text-[12px] font-medium" disabled={!canSubmit} onClick={() => void submit()}>
            {submitState === "sending" ? "Recording…" : "Submit challenge"}
          </button>
          <button
            type="button"
            className="btn-chip text-[12px]"
            onClick={() => { setOpen(false); requestChallengeAsk(context || `the report on ${subject}`); }}
          >
            Ask ARGUS Eye about this first
          </button>
        </div>
        {role === "team" && verify.step !== "verified" && (
          <p className="mt-1 text-[11px] text-ink-dim">Team challenges submit once the email is verified.</p>
        )}
        {submitNote && <p className={`mt-2 text-[12px] ${submitState === "error" ? "text-avoid" : "text-signal-lift"}`}>{submitNote}</p>}
      </div>
    </div>
  );
}
