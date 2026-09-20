import { useEffect, useId, useRef, useState } from "react";
import { useArgusReport } from "./context";
import { challengeBody, challengeContextLine, type ChallengeTarget } from "./challengeText";

/* Finding-specific challenge, inline (design §9). The form attaches the case,
   frozen version, section and exact finding automatically and submits through
   the existing review workflow (/api/report-challenge), which authenticates
   every request on the server and never changes a published score. Team
   claims keep the domain-bound email verification. */

const MAX_FILES = 3;
const MAX_FILE_BYTES = 2_000_000;
const FILE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"]);
const REASONS = [
  "Incorrect fact",
  "Score or calculation",
  "Missing evidence",
  "Outdated information",
  "Wrong identity or attribution",
  "Other",
] as const;

type Attachment = { name: string; type: string; dataUrl: string };
type VerifyState =
  | { step: "idle" }
  | { step: "sending" }
  | { step: "waiting"; verificationId: string }
  | { step: "verified"; verificationId: string }
  | { step: "failed"; note: string };

export function ChallengeForm({ target }: { target: ChallengeTarget }) {
  const report = useArgusReport();
  const idBase = useId();
  const [reason, setReason] = useState<string>(REASONS[0]);
  const [role, setRole] = useState<"community" | "team">("community");
  const [email, setEmail] = useState("");
  const [verify, setVerify] = useState<VerifyState>({ step: "idle" });
  const [explanation, setExplanation] = useState("");
  const [evidence, setEvidence] = useState("");
  const [whereWrong, setWhereWrong] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [fileNote, setFileNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [note, setNote] = useState("");
  const explanationRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
  }, []);

  // Unsubmitted text is never silently discarded by leaving the page.
  useEffect(() => {
    const dirty = state !== "done" && Boolean(explanation.trim() || evidence.trim() || whereWrong.trim() || files.length);
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [evidence, explanation, files.length, state, whereWrong]);

  const startVerification = async () => {
    if (!report.reportVersionId) {
      setVerify({ step: "failed", note: "This report has no saved version id, so team verification cannot run here." });
      return;
    }
    setVerify({ step: "sending" });
    try {
      const response = await fetch("/api/report-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request_verification", subject: report.subjectRef, reportVersionId: report.reportVersionId, email: email.trim() }),
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
        } catch {
          // Keep polling; the next tick retries.
        }
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const field = explanationRef.current;
    if (!explanation.trim()) {
      field?.setCustomValidity("Please explain the issue.");
      field?.reportValidity();
      return;
    }
    if (!teamReady || state === "sending") return;
    setState("sending");
    setNote("");
    try {
      const response = await fetch("/api/report-challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          subject: report.subjectRef,
          reportVersionId: report.reportVersionId,
          context: challengeContextLine(target, report.version),
          role,
          whatsWrong: challengeBody({ reason, explanation, evidence, claim: target.claim, version: report.version }),
          whereWrong: whereWrong.trim(),
          ...(role === "team" && verify.step === "verified"
            ? { email: email.trim().toLowerCase(), verificationId: verify.verificationId }
            : {}),
          files,
        }),
      });
      const body = await response.json().catch(() => ({})) as { ok?: boolean; emailVerified?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setState("error");
        setNote(response.status === 401 || response.status === 403
          ? "Sign in to ARGUS to submit a challenge."
          : body.error ?? "The challenge could not be recorded. Try again.");
        return;
      }
      setState("done");
      setNote(body.emailVerified
        ? "Recorded with team-verified standing. An ARGUS reviewer will check it against the saved evidence; the saved score is unchanged until a reviewed correction creates a new version."
        : "Recorded. An ARGUS reviewer will check it against the saved evidence; the saved score is unchanged until a reviewed correction creates a new version.");
      setExplanation("");
      setEvidence("");
      setWhereWrong("");
      setFiles([]);
    } catch {
      setState("error");
      setNote("The challenge could not be recorded. Try again.");
    }
  };

  const id = (suffix: string) => `${idBase}-${suffix}`;

  return (
    <form className="challenge-form" onSubmit={(event) => void submit(event)} noValidate>
      <div className="eyebrow">Request a review</div>
      <h2 className="dialog-title">Challenge: {target.title}</h2>
      <p className="dialog-body">Explain what is incorrect or missing. Include dated evidence so a reviewer can assess the finding.</p>
      <details className="challenge-context">
        <summary>Finding being challenged{report.version ? ` · saved version ${report.version}` : ""}</summary>
        <p>{target.claim}</p>
        <p>Finding ID {target.id}{report.caseLabel ? ` · Case ${report.caseLabel}` : ""} · Report {report.auditId}</p>
      </details>

      <label htmlFor={id("reason")}>What needs review?</label>
      <select id={id("reason")} value={reason} onChange={(event) => setReason(event.target.value)}>
        {REASONS.map((value) => <option key={value}>{value}</option>)}
      </select>

      <label htmlFor={id("role")}>Who is challenging?</label>
      <select id={id("role")} value={role} onChange={(event) => setRole(event.target.value === "team" ? "team" : "community")}>
        <option value="community">I am a community member</option>
        <option value="team">I am part of the {report.subjectName} team</option>
      </select>
      {role === "team" && (
        <div className="team-verify">
          <p>
            Team corrections are verified so nobody can pose as {report.subjectName}. Enter a work email
            {report.officialDomain ? ` on ${report.officialDomain}` : " on the company domain"}; ARGUS emails a one-time link, and once you click it this form submits with team-verified standing.
          </p>
          <div className="verify-row">
            <input
              type="email"
              value={email}
              aria-label="Team work email"
              placeholder={report.officialDomain ? `you@${report.officialDomain}` : "you@company.com"}
              onChange={(event) => { setEmail(event.target.value); if (verify.step !== "idle") setVerify({ step: "idle" }); }}
            />
            <button
              type="button"
              className="btn"
              disabled={verify.step === "sending" || verify.step === "waiting" || verify.step === "verified" || !email.includes("@")}
              onClick={() => void startVerification()}
            >
              {verify.step === "sending" ? "Sending…" : verify.step === "waiting" ? "Email sent" : verify.step === "verified" ? "Verified" : "Send verification email"}
            </button>
          </div>
          {verify.step === "waiting" && <p className="subtle-note">Waiting for you to click the link in your inbox. This form updates by itself.</p>}
          {verify.step === "verified" && <p className="challenge-status">Verified as {email.trim()}.</p>}
          {verify.step === "failed" && <p className="challenge-status error">{verify.note}</p>}
        </div>
      )}

      <label htmlFor={id("explanation")}>Your explanation <span>(required)</span></label>
      <textarea
        ref={explanationRef}
        id={id("explanation")}
        name="explanation"
        required
        maxLength={3000}
        rows={4}
        placeholder="What should change, and why?"
        value={explanation}
        onChange={(event) => { setExplanation(event.target.value); event.target.setCustomValidity(""); }}
      />

      <label htmlFor={id("evidence")}>Evidence links or references <span>(optional)</span></label>
      <textarea
        id={id("evidence")}
        name="evidence"
        maxLength={2000}
        rows={3}
        placeholder="Paste source URLs, dates, block numbers or document references."
        value={evidence}
        onChange={(event) => setEvidence(event.target.value)}
      />

      <label htmlFor={id("files")}>Corroborating files <span>(optional)</span></label>
      <p className="field-hint">Up to {MAX_FILES} files (png, jpeg, webp, pdf or plain text; 2MB each).</p>
      <input id={id("files")} ref={fileInputRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.txt" onChange={(event) => addFiles(event.target.files)} />
      {files.length > 0 && (
        <ul className="compact-list">
          {files.map((file) => (
            <li key={file.name}>
              {file.name}{" "}
              <button type="button" className="textbtn" onClick={() => setFiles((current) => current.filter((entry) => entry !== file))}>remove</button>
            </li>
          ))}
        </ul>
      )}
      {fileNote && <p className="challenge-status error">{fileNote}</p>}

      <label htmlFor={id("where")}>Where did this go wrong? <span>(optional)</span></label>
      <p className="field-hint">How ARGUS's logic made this mistake. This goes to system-wide learning, beyond this one report.</p>
      <textarea
        id={id("where")}
        maxLength={3000}
        rows={2}
        placeholder="For example: the system trusted a namesake account, or read a paused program as active."
        value={whereWrong}
        onChange={(event) => setWhereWrong(event.target.value)}
      />

      <div className="challenge-actions">
        <button className="btn primary" type="submit" disabled={state === "sending" || !teamReady}>
          {state === "sending" ? "Recording…" : "Submit challenge"}
        </button>
      </div>
      {role === "team" && verify.step !== "verified" && <p className="subtle-note">Team challenges submit once the email is verified.</p>}
      <p className="subtle-note">A challenge is reviewed against the saved evidence. It never changes the saved score by itself; an accepted correction produces a new report version with its rationale.</p>
      <p className={`challenge-status${state === "error" ? " error" : ""}`} role="status">{note}</p>
    </form>
  );
}

/** Shared recipients read freely; starting a challenge needs an account. */
export function SignupGate() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="share-panel">
      <div className="eyebrow">Shared report · read only</div>
      <h2 className="dialog-title">Sign up to challenge this finding.</h2>
      <p className="dialog-body">You can explore the full report without an account. Create an ARGUS account or sign in to start a challenge.</p>
      <a className="btn primary" href={`${origin}/`} target="_blank" rel="noopener noreferrer">Sign up / Sign in to ARGUS →</a>
    </div>
  );
}
