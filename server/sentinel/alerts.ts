// Pure alert logic for the provider sentinel: which results are transitions
// worth an email, which of those were already sent inside the de-duplication
// window, and what the combined email says. No I/O.
import { probeById } from "./probes.js";
import type { AlertKind, ProbeResult, ProviderStatusRow, SentAlertRow, SentinelAlert, SentinelReason, SentinelStatus } from "./types.js";

export const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000;

const FAILING: ReadonlySet<SentinelStatus> = new Set(["down", "degraded"]);

/** Plain-English "what's wrong + how to fix it" for one provider state. */
export function adviceFor(provider: string, status: SentinelStatus, reason: SentinelReason | null | undefined, httpStatus?: number | null, lowCredit = false): string {
  const def = probeById(provider);
  // A probe with alternative key names (Supabase) names the key, not the URL.
  const envName = def?.anyEnv?.[0] ?? def?.env[0] ?? "the provider key";
  const console = def?.console ? ` (${def.console})` : "";
  if (status === "ok") {
    return lowCredit ? `Balance is below the alert threshold. Top up before it runs out${console}.` : "Working normally.";
  }
  switch (reason) {
    case "missing_key":
      return `Not configured. Set ${envName} in Vercel to enable this provider.`;
    case "auth_invalid":
      return `Key rejected${httpStatus ? ` (${httpStatus})` : ""}. Rotate ${envName} in Vercel and redeploy${console}.`;
    case "out_of_credits":
      return `Out of credits or billing blocked. Top up or fix billing${console}.`;
    case "rate_limited":
      return "Rate limited. Usually clears on its own; if it persists, reduce call volume or upgrade the plan.";
    case "timeout":
      return "No answer within the probe timeout. Likely a provider outage or network issue; check the provider's status page.";
    case "provider_error_5xx":
      return `Provider-side error${httpStatus ? ` (${httpStatus})` : ""}. Nothing to change on our side; check the provider's status page.`;
    case "unexpected_response":
    default:
      return `Unexpected response${httpStatus ? ` (${httpStatus})` : ""}. The provider API may have changed; check the adapter and the provider's changelog.`;
  }
}

function failingKind(status: SentinelStatus): AlertKind | null {
  return status === "down" ? "down" : status === "degraded" ? "degraded" : null;
}

/**
 * Compare fresh results with the stored previous state and return the alert
 * each transition warrants:
 *  - healthy/unknown -> down or degraded, and degraded -> down: a failure alert
 *  - down/degraded -> ok: recovered
 *  - low-credit flag false/unknown -> true: low_credit
 * A steady state produces nothing. `not_configured` never alerts.
 */
export function detectTransitions(results: readonly ProbeResult[], previous: ReadonlyMap<string, Pick<ProviderStatusRow, "status" | "low_credit">>): SentinelAlert[] {
  const alerts: SentinelAlert[] = [];
  for (const result of results) {
    if (result.status === "not_configured") continue;
    const prior = previous.get(result.provider);
    const priorStatus = prior?.status;
    const base = { provider: result.provider, label: result.label, status: result.status, reason: result.reason, detail: result.detail };
    const kind = failingKind(result.status);
    if (kind) {
      const worsened = !priorStatus || priorStatus === "ok" || priorStatus === "not_configured" || (priorStatus === "degraded" && result.status === "down");
      if (worsened) alerts.push({ ...base, kind, advice: adviceFor(result.provider, result.status, result.reason, result.httpStatus) });
      continue;
    }
    if (result.status === "ok" && priorStatus && FAILING.has(priorStatus)) {
      alerts.push({ ...base, kind: "recovered", advice: "Working again." });
    }
    if (result.status === "ok" && result.lowCredit && !prior?.low_credit) {
      alerts.push({ ...base, kind: "low_credit", advice: adviceFor(result.provider, "ok", undefined, undefined, true) });
    }
  }
  return alerts;
}

/** Drop alerts whose (provider, kind) was already sent within the window. */
export function dedupeAlerts(alerts: readonly SentinelAlert[], sent: readonly SentAlertRow[], now: Date, windowMs = ALERT_DEDUPE_MS): SentinelAlert[] {
  const cutoff = now.getTime() - windowMs;
  const recent = new Set(
    sent.filter((row) => Date.parse(row.sent_at) > cutoff).map((row) => `${row.provider}\u0000${row.kind}`),
  );
  return alerts.filter((alert) => !recent.has(`${alert.provider}\u0000${alert.kind}`));
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function alertSubject(alerts: readonly SentinelAlert[]): string {
  const down = alerts.filter((alert) => alert.kind === "down").length;
  const degraded = alerts.filter((alert) => alert.kind === "degraded").length;
  const low = alerts.filter((alert) => alert.kind === "low_credit").length;
  const recovered = alerts.filter((alert) => alert.kind === "recovered").length;
  const parts = [
    down ? `${plural(down, "API")} down` : "",
    degraded ? `${plural(degraded, "API")} degraded` : "",
    low ? `${low} low on credit` : "",
    recovered ? `${recovered} recovered` : "",
  ].filter(Boolean);
  return `[Argus] ${parts.join(", ") || "provider status update"}`;
}

const KIND_HEADING: Record<AlertKind, string> = {
  down: "DOWN",
  degraded: "DEGRADED",
  low_credit: "LOW CREDIT",
  recovered: "RECOVERED",
};
const KIND_ORDER: AlertKind[] = ["down", "degraded", "low_credit", "recovered"];

export function alertText(alerts: readonly SentinelAlert[], dashboardUrl?: string): string {
  const lines: string[] = ["Argus API sentinel detected provider changes:", ""];
  for (const kind of KIND_ORDER) {
    const group = alerts.filter((alert) => alert.kind === kind);
    if (!group.length) continue;
    lines.push(`${KIND_HEADING[kind]}`);
    for (const alert of group) {
      lines.push(`- ${alert.label}: ${alert.detail}`);
      lines.push(`  Fix: ${alert.advice}`);
    }
    lines.push("");
  }
  if (dashboardUrl) lines.push(`Dashboard: ${dashboardUrl}`);
  lines.push("Alerts for the same provider and kind are sent at most once every 6 hours.");
  return lines.join("\n");
}

export function alertRecipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}
