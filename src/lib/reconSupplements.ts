import type { Recon } from "../collect/recon";
import type { WebPerson } from "./investigation";

/** Run the paid deep-team supplement only with a capability for this version. */
export async function fetchReconWebTeam(
  siteUrl: string,
  projectName: string,
  recon: Recon,
  panelCostToken?: string,
): Promise<WebPerson[]> {
  if (!panelCostToken) return [];

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
    if (!response.ok) return [];
    const body = await response.json() as { people?: WebPerson[] };
    return Array.isArray(body.people) ? body.people : [];
  } catch {
    return [];
  }
}
