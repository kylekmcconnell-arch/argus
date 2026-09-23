import type { Dossier } from "../src/data/dossier";
import type { TraceStep } from "../src/data/evidence";
import { canonicalAddress } from "../src/lib/assetIdentity.js";
import { tokenFromVerifiedProjectToken, tokenFromBio, tokenFromPromotions } from "../src/lib/projectTokenLeg.js";

type ThreatRuntime = typeof import("../server/threatRuntime");
let runtime: Promise<ThreatRuntime> | undefined;
async function loadRuntime(): Promise<ThreatRuntime> {
  const specifier = "./_threatlib.mjs";
  return runtime ??= import(/* @vite-ignore */ specifier) as Promise<ThreatRuntime>;
}

export interface TokenCompletionOptions {
  authorization: string;
  panelToken?: string;
  deadlineAt: number;
  emit: (step: TraceStep) => void;
}

/** Complete the identity-bound sidecar before the server saves the dossier. */
export async function completeProjectToken(
  dossier: Dossier,
  options: TokenCompletionOptions,
  loader: () => Promise<ThreatRuntime> = loadRuntime,
): Promise<void> {
  const candidate = tokenFromVerifiedProjectToken(dossier.projectToken)
    ?? tokenFromBio(dossier.bio)
    ?? tokenFromPromotions(dossier.evidence?.promotions);
  const finish = (state: NonNullable<Dossier["tokenAssessment"]>["state"], note: string) => {
    dossier.tokenAssessment = { owner: "server", state, completedAt: new Date().toISOString() };
    dossier.threatNote = note;
  };
  if (!candidate) {
    finish("unattributed", "No token could be attributed to this subject from verified identity evidence, its bio or its claimed promotions. No name-match token was attached.");
    return;
  }
  dossier.threat = null;
  dossier.threatBinding = candidate.binding;
  const budget = Math.min(180_000, options.deadlineAt - Date.now());
  if (budget <= 0) {
    finish("unavailable", "Project evidence was collected, but no time remained for the linked-token assessment within this scan's deadline.");
    return;
  }
  // Never trust request Host/Origin as a destination for the user's bearer.
  const host = process.env.VERCEL_URL || "argus-one-flax.vercel.app";
  if (!/^[a-z0-9][a-z0-9.-]*\.vercel\.app$/i.test(host) || !/^Bearer\s+\S+$/i.test(options.authorization) || !options.panelToken) {
    finish("unavailable", "The server could not establish an authenticated token-assessment route. Project evidence is preserved; token safety remains unassessed.");
    return;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const chain = candidate.binding === "canonical" ? dossier.projectToken?.chain?.trim().toLowerCase() : undefined;
  options.emit({ phase: "ARGUS · Threat", label: "Checking the linked token", detail: `Completing the token assessment on the server, attributed via ${candidate.source}.`, source: "argus", tone: "neutral" });
  try {
    const scan = await Promise.race([
      (async () => {
        const lib = await loader();
        controller.signal.throwIfAborted();
        return lib.withThreatNet({
          base: `https://${host}`,
          headers: {
            authorization: options.authorization,
            "x-argus-panel-token": options.panelToken!,
            ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}),
          },
          signal: controller.signal,
        }, () => lib.threatScan({ kind: "token", ref: candidate.address, via: candidate.via },
          (step) => { if (!controller.signal.aborted) options.emit(step); },
          { force: true, chain: chain || undefined, signal: controller.signal }));
      })(),
      new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, budget); }),
    ]);
    if (scan && canonicalAddress(scan.address) === canonicalAddress(candidate.address)
      && (!chain || scan.chain.toLowerCase() === chain)) {
      dossier.threat = scan;
      finish("complete", `Token attributed via ${candidate.source}. $${scan.symbol}: ${scan.call.verdict} · ${scan.call.risk}/100 risk.`);
    } else {
      finish("unavailable", "Project evidence was collected, but the linked-token assessment did not return a completed result for the attributed contract and chain. Token safety remains unassessed.");
    }
  } catch {
    finish("unavailable", "Project evidence was collected, but the linked-token assessment failed. Token safety remains unassessed.");
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
