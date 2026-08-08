import type { Recon } from "../collect/recon";
import type {
  WebPerson,
  WebPersonEvidenceKind,
  WebPersonProvider,
  WebTeamDiscoveryResult,
} from "./investigation";

const PROVIDERS = new Set<WebPersonProvider>(["grok", "twitterapi", "github"]);
const EVIDENCE_KINDS = new Set<WebPersonEvidenceKind>([
  "team_attribution",
  "project_association",
  "code_contribution",
  "model_candidate",
]);

export const emptyWebTeamDiscovery = (attempted: boolean, providerFailed = false): WebTeamDiscoveryResult => ({
  available: false,
  attempted,
  completed: false,
  partial: false,
  providerFailed,
  people: [],
  providers: [],
});

function personLinkedInUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return undefined;
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return undefined;
    if (!/^\/in\/[^/?#]+\/?$/i.test(parsed.pathname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizePerson(value: unknown): WebPerson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const role = typeof raw.role === "string" ? raw.role.trim() : "";
  if (!name || !role) return null;
  const provider = typeof raw.provider === "string" && PROVIDERS.has(raw.provider as WebPersonProvider)
    ? raw.provider as WebPersonProvider
    : undefined;
  const evidenceKind = typeof raw.evidenceKind === "string" && EVIDENCE_KINDS.has(raw.evidenceKind as WebPersonEvidenceKind)
    ? raw.evidenceKind as WebPersonEvidenceKind
    : "model_candidate";
  const deterministic = raw.evidence_origin === "deterministic";
  const linkedin = personLinkedInUrl(raw.linkedin);
  return {
    name,
    role,
    ...(typeof raw.handle === "string" && /^@[A-Za-z0-9_]{2,30}$/.test(raw.handle) ? { handle: raw.handle } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(typeof raw.evidence === "string" && raw.evidence.trim() ? { evidence: raw.evidence.trim() } : {}),
    ...(provider ? { provider } : {}),
    evidence_origin: deterministic ? "deterministic" : "model_lead",
    artifact_verified: deterministic && raw.artifact_verified === true,
    evidenceKind,
    ...(Array.isArray(raw.developerProfiles) ? { developerProfiles: raw.developerProfiles as WebPerson["developerProfiles"] } : {}),
  };
}

export function normalizeWebTeamDiscovery(value: unknown): WebTeamDiscoveryResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyWebTeamDiscovery(true, true);
  const body = value as Record<string, unknown>;
  const people = Array.isArray(body.people)
    ? body.people.map(normalizePerson).filter((person): person is WebPerson => person !== null)
    : [];
  const providers = Array.isArray(body.providers)
    ? body.providers.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const raw = entry as Record<string, unknown>;
        if (typeof raw.provider !== "string" || !PROVIDERS.has(raw.provider as WebPersonProvider)) return [];
        if (raw.status !== "succeeded" && raw.status !== "partial" && raw.status !== "failed") return [];
        const status = raw.status as "succeeded" | "partial" | "failed";
        return [{ provider: raw.provider as WebPersonProvider, status }];
      })
    : [];
  return {
    available: body.available === true,
    attempted: body.attempted === true,
    completed: body.completed === true,
    partial: body.partial === true,
    providerFailed: body.providerFailed === true,
    people,
    providers,
  };
}

/** Run the paid deep-team supplement only with a capability for this version. */
export async function fetchReconWebTeam(
  siteUrl: string,
  projectName: string,
  recon: Recon,
  panelCostToken?: string,
): Promise<WebTeamDiscoveryResult> {
  if (!panelCostToken) return emptyWebTeamDiscovery(false);

  try {
    const host = new URL(siteUrl).hostname.replace(/^www\./, "");
    const qs = new URLSearchParams({
      domain: host,
      name: projectName || "",
      names: recon.team.names.slice(0, 8).join(","),
    });
    const noise = /^(home|share|intent|i|status|explore|search|hashtag|messages)$/i;
    const xHandle = recon.socials
      .map((social) => social.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1])
      .find((handle) => handle && !noise.test(handle));
    if (xHandle) qs.set("x", xHandle);

    const githubOrg = recon.socials
      .map((social) => social.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
      .find((org) => org && !/^(orgs|sponsors|topics|features|about)$/i.test(org));
    if (githubOrg) qs.set("gh", githubOrg);

    const response = await fetch(`/api/recon-team?${qs}`, {
      headers: {
        "x-argus-panel-context": "required",
        "x-argus-panel-token": panelCostToken,
      },
    });
    if (!response.ok) return emptyWebTeamDiscovery(true, true);
    return normalizeWebTeamDiscovery(await response.json());
  } catch {
    return emptyWebTeamDiscovery(true, true);
  }
}
