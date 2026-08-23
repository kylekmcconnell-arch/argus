import type { CollectTokenSocialActivityFn } from "../token/audit";
import type { SocialActivitySnapshot } from "../data/socialActivity";

export const collectTokenSocialActivity: CollectTokenSocialActivityFn = async (identity) => {
  const response = await fetch("/api/social-activity", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(identity),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`social_activity_http_${response.status}`);
  return await response.json() as SocialActivitySnapshot;
};
