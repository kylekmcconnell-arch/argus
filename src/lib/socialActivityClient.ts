import type { CollectTokenSocialActivityFn } from "../token/audit";
import type { SocialActivitySnapshot } from "../data/socialActivity";

export const collectTokenSocialActivity: CollectTokenSocialActivityFn = async (identity, options) => {
  const response = await (options?.fetchImpl ?? fetch)("/api/social-activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(identity),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`social_activity_http_${response.status}`);
  return await response.json() as SocialActivitySnapshot;
};

export function scanScopedFetch(runKey?: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (runKey && typeof input === "string" && (input.startsWith("/api/social-activity") || input.startsWith("/api/x-authenticity"))) headers.set("x-argus-scan-key", runKey);
    return fetch(input, { ...init, headers });
  };
}
