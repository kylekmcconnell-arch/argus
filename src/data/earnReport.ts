import type { Finding } from "../engine/audit";

export const EARN_CHAIN = "robinhood";
export const EARN_CONTRACT = "0xA3b6AEe90017b72c0812dC1e013De70eB2917ba3";

export const EARN_ACCUSATION_SOURCE_URL = "https://www.sotwe.com/peoofleov2";
export const EARN_ACCUSATION_CLAIM = "@earnonhood (scam accusation lead): EARNONHOOD Stolen tech. Scam beware";

export const EARN_SUBJECT_LEADS: Finding[] = [{
  finding_type: "AdverseLead",
  claim: EARN_ACCUSATION_CLAIM,
  source_url: EARN_ACCUSATION_SOURCE_URL,
  source_date: "",
  source_author: "Sotwe profile",
  verification_status: "Rumor",
  independent_source_count: 1,
  polarity: -1,
  evidence_origin: "model_lead",
  artifact_verified: false,
  finding_scope: {
    scope: "direct_subject",
    target_entity_key: "@earnonhood",
    target_entity_type: "project",
    relationship_to_subject: "self",
  },
}];

export function isCanonicalEarnToken(chain?: string | null, address?: string | null): boolean {
  return chain?.trim().toLowerCase() === EARN_CHAIN
    && address?.trim().toLowerCase() === EARN_CONTRACT.toLowerCase();
}
