// Verdict + role presentation metadata used across the report UI.
import { SubjectClass } from "../engine";

export interface VerdictMeta {
  label: string;
  color: string; // css var
  glow: string;
  blurb: string;
}

export const VERDICT_META: Record<string, VerdictMeta> = {
  PASS: { label: "PASS", color: "var(--color-pass)", glow: "rgba(22,163,74,0.08)", blurb: "Withstands scrutiny. 70–100." },
  CAUTION: { label: "CAUTION", color: "var(--color-caution)", glow: "rgba(217,119,6,0.08)", blurb: "Proceed with named reservations. 40–69." },
  FAIL: { label: "FAIL", color: "var(--color-fail)", glow: "rgba(234,88,12,0.08)", blurb: "Does not clear the bar. 0–39." },
  AVOID: { label: "AVOID", color: "var(--color-avoid)", glow: "rgba(220,38,38,0.09)", blurb: "A disqualifying finding caps the score." },
  UNVERIFIABLE_IDENTITY: { label: "UNVERIFIABLE", color: "var(--color-unverifiable)", glow: "rgba(124,58,237,0.08)", blurb: "Suspected impersonation blocks a verdict." },
  INCOMPLETE: { label: "INCOMPLETE", color: "var(--color-ink-faint)", glow: "transparent", blurb: "Not enough evidence recorded." },
};

export function verdictMeta(v: string): VerdictMeta {
  return VERDICT_META[v] ?? VERDICT_META.INCOMPLETE;
}

export const ROLE_META: Record<SubjectClass, { label: string; glyph: string }> = {
  [SubjectClass.FOUNDER]: { label: "Founder", glyph: "⚒" },
  [SubjectClass.KOL]: { label: "KOL", glyph: "📡" },
  [SubjectClass.INVESTOR]: { label: "Investor", glyph: "◈" },
  [SubjectClass.ADVISOR]: { label: "Advisor", glyph: "✦" },
  [SubjectClass.AGENCY]: { label: "Agency", glyph: "⛭" },
  [SubjectClass.MEMBER]: { label: "Member", glyph: "○" },
};

// Human labels for axis keys.
export const AXIS_LABELS: Record<string, string> = {
  F1_identity_verifiability: "Identity & verifiability",
  F2_track_record: "Track record",
  F3_repeat_backing: "Repeat backing",
  F4_build_substance: "Build substance",
  F5_reputation_integrity: "Reputation & integrity",
  F6_network_quality: "Network quality",
  K1_identity_roster: "Identity & roster",
  K2_call_performance: "Call performance",
  K3_disclosure_deletion: "Disclosure & deletion",
  K4_onchain_conduct: "On-chain conduct",
  K5_cabal_fud: "Cabal & FUD",
  I1_identity_legitimacy: "Identity & legitimacy",
  I2_portfolio_quality: "Portfolio quality",
  I3_fund_scale_tier: "Fund scale & tier",
  I4_testimonial_corroboration: "Testimonial corroboration",
  I5_reputation_fud: "Reputation & FUD",
  AD1_identity_verifiability: "Identity & verifiability",
  AD2_advised_outcomes: "Advised outcomes",
  AD3_relationship_corroboration: "Relationship corroboration",
  AD4_advisory_conduct: "Advisory conduct",
  AD5_reputation_fud: "Reputation & FUD",
  AG1_identity_legitimacy: "Identity & legitimacy",
  AG2_client_outcomes: "Client outcomes",
  AG3_service_integrity: "Service integrity",
  AG4_reputation_fud: "Reputation & FUD",
  ME1_identity: "Identity",
  ME2_role_authenticity: "Role authenticity",
  ME3_conduct_reputation: "Conduct & reputation",
};

export const CAP_LABELS: Record<string, string> = {
  prior_rug_as_principal: "Prior rug as principal",
  wallet_sold_into_promo: "Wallet sold into own promotion",
  paid_to_shill_confirmed_rug: "Paid to shill a confirmed rug",
  contradicted_testimonial: "Contradicted testimonial",
  predatory_terms_verified: "Verified predatory terms",
  claimed_advisory_contradicted: "Advisory claim contradicted",
  advised_rug_with_allocation: "Paid advisor to a confirmed rug",
  market_manipulation_services: "Market-manipulation services",
  deception_confirmed: "Confirmed deception finding",
  investigator_verified_fraud: "Investigator-verified fraud",
};

export function axisLabel(k: string): string {
  return AXIS_LABELS[k] ?? k;
}
export function capLabel(k: string): string {
  return CAP_LABELS[k] ?? k;
}
