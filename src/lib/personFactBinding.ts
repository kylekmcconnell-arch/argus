import type { BasicFact } from "../data/evidence";
import { canonicalOfficialWebsite } from "./fundScaleEvidence";

/** A pseudonym can have an attributable track record without a public legal name. */
export function personFactBindsAccount(fact: BasicFact, profile: { handle: string; website?: string; identity_binding?: string }): boolean {
  const handle = profile.handle.replace(/^@/, "").toLowerCase();
  const key = fact.subjectKey?.replace(/^x:/, "").replace(/^@/, "").toLowerCase();
  if (!handle || (key && key !== handle)) return false;
  if (profile.identity_binding) return true;
  const official = canonicalOfficialWebsite(profile.website)?.domain;
  return fact.sources.some(source => {
    if (!source.artifactVerified) return false;
    const text = source.excerpt.toLowerCase();
    const at = text.indexOf(`@${handle}`);
    if (at >= 0 && !/[a-z0-9_]/.test(text[at + handle.length + 1] ?? "")) return true;
    return Boolean(official && source.sourceClass === "official_subject" && canonicalOfficialWebsite(source.url)?.domain === official);
  });
}
