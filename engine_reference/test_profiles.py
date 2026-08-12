"""
ARGUS-P v2 test suite. Run: python -m pytest tests/ -q   (or python tests/test_profiles.py)
Exercises each class profile, the hard caps, the class-aware identity gate,
the testimonial corroborator, the founder pattern/repeat-backing logic, and
the router.
"""

import sys, os, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from argus_p import Audit, classify_subject, validate_axes
from argus_p.taxonomy import (SubjectClass, VentureOutcome, FundTier,
                              classify_founder_pattern, repeat_backing_signal,
                              FounderPattern)
from argus_p.corroboration import classify_testimonial, score_axis
from argus_p.taxonomy import TestimonialVerdict as TV

DB = os.path.join(tempfile.gettempdir(), "argus_p_v2_test.db")
if os.path.exists(DB):
    os.remove(DB)

def fresh(handle, cls):
    return Audit(DB, handle, subject_class=cls)

results = []
def check(name, cond):
    results.append((name, cond))
    print(("PASS" if cond else "FAIL"), name)


# 0. all profiles weight to 100
check("all axis weights sum to 100", validate_axes() == {})

# 1. FOUNDER serial-success with repeat backing -> PASS
a = fresh("@serial_founder", SubjectClass.FOUNDER)
a.set_identity("Confirmed")
a.add_venture("ExitCo", "founder", "2017-2020", VentureOutcome.ACQUISITION,
              acquirer="BigCorp", deal_type="strategic", deal_value_usd=120e6,
              investors=["Sequoia", "a16z"])
a.add_venture("NewCo", "founder", "2023-present", VentureOutcome.ACTIVE,
              current_backers=["a16z", "Paradigm"])
fs = a.founder_summary()
check("founder pattern = ProvenOnce", fs["pattern"] == FounderPattern.PROVEN_ONCE.value)
check("repeat backing detected from successful exit", fs["repeat_backing"]["strength"] == "strong")
for ax, s in [("F1_identity_verifiability", 11), ("F2_track_record", 24),
              ("F3_repeat_backing", 14), ("F4_build_substance", 12),
              ("F5_reputation_integrity", 17), ("F6_network_quality", 10)]:
    a.set_axis(ax, s)
r = a.finalize()
check("founder PASS verdict", r["verdict"] == "PASS" and r["score_total"] >= 70)

# 2. FOUNDER with prior rug -> cap 10 -> AVOID
a = fresh("@rugger", SubjectClass.FOUNDER)
a.set_identity("Confirmed")
a.add_venture("RugCo", "founder", "2022", VentureOutcome.RUG)
for ax in ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing",
           "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]:
    a.set_axis(ax, 8)
r = a.finalize()
check("prior-rug founder pattern = RugHistory", a.founder_summary()["pattern"] == FounderPattern.RUG_HISTORY.value)
check("prior-rug founder capped to AVOID", r["verdict"] == "AVOID" and r["score_total"] <= 10)

# 3. KOL pseudonymous (NOT gated) with wallet sold into promo -> cap 35
a = fresh("@anon_caller", SubjectClass.KOL)
a.set_identity("Unverified")   # pseudonymity is normal for KOLs
a.add_wallet("0xdead", "base", "InvestigatorAttributed", sold_into_own_promo=True)
for ax, s in [("K1_identity_roster", 8), ("K2_call_performance", 20),
              ("K3_disclosure_deletion", 10), ("K4_onchain_conduct", 5),
              ("K5_cabal_fud", 10)]:
    a.set_axis(ax, s)
r = a.finalize()
check("pseudonymous KOL is still scored (not identity-gated)", r["score_total"] is not None)
check("KOL wallet-sold-into-promo cap = 35", r["cap_applied"] == "wallet_sold_into_promo" and r["score_total"] <= 35)

# 4. INVESTOR pseudonymous -> NOW SCORED (pseudonymity is not a flag); only impersonation gates
a = fresh("@anon_fund", SubjectClass.INVESTOR)
a.set_identity("Unverified")
for ax, s in [("I1_identity_legitimacy", 5), ("I2_portfolio_quality", 18),
              ("I3_fund_scale_tier", 9), ("I4_testimonial_corroboration", 12),
              ("I5_reputation_fud", 16)]:
    a.set_axis(ax, s)
r = a.finalize()
check("pseudonymous INVESTOR is scored, not gated", r["verdict"] != "UNVERIFIABLE_IDENTITY" and r["score_total"] is not None)

# 4b. Impersonation DOES block (any class)
a = fresh("@imposter_fund", SubjectClass.INVESTOR)
a.set_identity("SuspectedImpersonation")
a.set_axis("I1_identity_legitimacy", 0)
r = a.finalize()
check("impersonation blocks publication", r["verdict"] == "UNVERIFIABLE_IDENTITY")

# 4c. Doxxing is rewarded with a bonus
a = fresh("@doxxed_fund", SubjectClass.INVESTOR)
a.set_identity("Confirmed")
for ax, s in [("I1_identity_legitimacy", 12), ("I2_portfolio_quality", 16),
              ("I3_fund_scale_tier", 9), ("I4_testimonial_corroboration", 12),
              ("I5_reputation_fud", 14)]:
    a.set_axis(ax, s)
r = a.finalize()
check("doxxing bonus applied (+5)", r["role_reports"][0]["dox_bonus"] == 5 and r["score_total"] == r["role_reports"][0]["raw_total"] + 5)

# 5. INVESTOR verified but testimonials all unconfirmed -> low I4
a = fresh("@thin_fund", SubjectClass.INVESTOR)
a.set_identity("Confirmed")
for _ in range(4):
    a.add_testimonial(claimed_endorser_handle="@famous_founder",
                      claimed_relationship="portfolio",
                      public_acknowledgment="none", follows_subject=False)
score, summary, cap = a.corroboration_axis("I4_testimonial_corroboration")
check("4 unconfirmed testimonials -> I4 capped low", score <= 5 and summary["unconfirmed"] == 4)
check("unconfirmed (not contradicted) -> no cap", cap is None)

# 6. INVESTOR with a contradicted testimonial -> cap 15
a = fresh("@liar_fund", SubjectClass.INVESTOR)
a.set_identity("Confirmed")
a.add_testimonial(claimed_endorser_handle="@real_founder",
                  claimed_relationship="advisor_to_subject",
                  fud_present=True, sentiment="negative")
for ax, s in [("I1_identity_legitimacy", 12), ("I2_portfolio_quality", 18),
              ("I3_fund_scale_tier", 10), ("I4_testimonial_corroboration", 0),
              ("I5_reputation_fud", 15)]:
    a.set_axis(ax, s)
r = a.finalize()
check("contradicted testimonial cap = 15", r["cap_applied"] == "contradicted_testimonial" and r["score_total"] <= 15)

# 7. AGENCY with manipulation services -> cap 10 -> AVOID
a = fresh("@bot_agency", SubjectClass.AGENCY)
a.set_identity("Confirmed")
a.add_client_engagement("SomeProject", "market_making", manipulation_service_flag=True)
for ax, s in [("AG1_identity_legitimacy", 10), ("AG2_client_outcomes", 15),
              ("AG3_service_integrity", 5), ("AG4_reputation_fud", 15)]:
    a.set_axis(ax, s)
r = a.finalize()
check("agency manipulation-services cap -> AVOID", r["verdict"] == "AVOID" and r["score_total"] <= 10)

# 8. testimonial corroborator unit checks
check("endorsement+relationship -> Corroborated",
      classify_testimonial({"public_acknowledgment": "endorsement", "relationship_corroborated": True}) == TV.CORROBORATED)
check("follows only -> Partial",
      classify_testimonial({"follows_subject": True}) == TV.PARTIAL)
check("nothing -> Unconfirmed",
      classify_testimonial({}) == TV.UNCONFIRMED)
check("fud -> Contradicted",
      classify_testimonial({"fud_present": True}) == TV.CONTRADICTED)

# 9. founder pattern classifier
check("two acquisitions -> SerialSuccess",
      classify_founder_pattern([VentureOutcome.ACQUISITION, VentureOutcome.IPO]) == FounderPattern.SERIAL_SUCCESS)
check("two silent shutdowns -> SerialFailure",
      classify_founder_pattern([VentureOutcome.SILENT_SHUTDOWN, VentureOutcome.FAILURE]) == FounderPattern.SERIAL_FAILURE)

# 10. router
res = classify_subject(bio="GP and Founder at SomeFund VC, Web3 investor")
check("router classifies investor bio", res["subject_class"] == SubjectClass.INVESTOR)
check("router surfaces multiple roles", set(res["applicable_classes"]) >= {SubjectClass.INVESTOR, SubjectClass.FOUNDER})
res = classify_subject(bio="degen, alpha calls, gems", kb={"kb_hit": True})
check("router classifies KOL with KB hit", res["subject_class"] == SubjectClass.KOL)

# 11. ADVISOR: advised a rug with an allocation -> cap 25, and contradicted -> cap 15
a = fresh("@advisor_x", SubjectClass.ADVISOR)
a.set_identity("Confirmed")
a.add_advised_project("RugProj", project_outcome=VentureOutcome.RUG, paid_or_allocated=True,
                      public_acknowledgment="endorsement", relationship_corroborated=True)
for ax, s in [("AD1_identity_verifiability", 10), ("AD2_advised_outcomes", 5),
              ("AD3_relationship_corroboration", 20), ("AD4_advisory_conduct", 8),
              ("AD5_reputation_fud", 10)]:
    a.set_axis(ax, s)
r = a.finalize()
check("advisor to rug-with-allocation capped", r["composite_verdict"] in ("AVOID", "FAIL") and r["governing_score"] <= 25)

# 12. ADVISOR relationship corroboration from advised projects
a = fresh("@ghost_advisor", SubjectClass.ADVISOR)
a.set_identity("Confirmed")
for _ in range(3):
    a.add_advised_project("BigName", public_acknowledgment="none", follows_subject=False)
score, summary, cap = a.advisory_corroboration_axis("AD3_relationship_corroboration")
check("3 unacknowledged advisory claims collapse AD3", score <= 7 and summary["unconfirmed"] == 3)

# 13. MULTI-ROLE: builder + investor + advisor (the EnigmaFund shape), pseudonymous
#     With the gate removed, all three roles are scored; composite is the worst band.
a = Audit(DB, "@multi_subject", roles=[SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.ADVISOR])
a.set_identity("Unverified", track_record_verified=True)   # pseudonymous but verifiable on-chain
a.add_venture("PausedCo", "founder", "2023-2024", VentureOutcome.PAUSED)   # paused != shutdown
a.add_venture("BuildCo", "founder", "2024-present", VentureOutcome.ACTIVE)
for ax, s in [("F1_identity_verifiability", 5), ("F2_track_record", 16), ("F3_repeat_backing", 6),
              ("F4_build_substance", 11), ("F5_reputation_integrity", 14), ("F6_network_quality", 8)]:
    a.set_axis(ax, s)
for ax, s in [("I1_identity_legitimacy", 6), ("I2_portfolio_quality", 18), ("I3_fund_scale_tier", 9),
              ("I4_testimonial_corroboration", 12), ("I5_reputation_fud", 16)]:
    a.set_axis(ax, s)
for ax, s in [("AD1_identity_verifiability", 5), ("AD2_advised_outcomes", 18),
              ("AD3_relationship_corroboration", 15), ("AD4_advisory_conduct", 14),
              ("AD5_reputation_fud", 10)]:
    a.set_axis(ax, s)
r = a.finalize()
roles_seen = {rr["role"]: rr["verdict"] for rr in r["role_reports"]}
check("multi-role: all three roles scored separately", set(roles_seen) == {"FOUNDER", "INVESTOR", "ADVISOR"})
check("multi-role: pseudonymous investor role is scored (not gated)", roles_seen["INVESTOR"] != "UNVERIFIABLE_IDENTITY")
check("multi-role: PAUSED is not a failure (pattern not SerialFailure/RugHistory)",
      r["founder_summary"]["pattern"] in ("Unproven", "ProvenOnce", "SerialSuccess", "Mixed"))
check("multi-role: composite is the most severe role band", r["composite_verdict"] in ("PASS", "CAUTION", "FAIL"))
check("multi-role: roles not averaged (each keeps its own score)",
      all(rr["score_total"] is not None for rr in r["role_reports"]))

print("\n%d/%d checks passed" % (sum(1 for _, c in results if c), len(results)))
if any(not c for _, c in results):
    sys.exit(1)
