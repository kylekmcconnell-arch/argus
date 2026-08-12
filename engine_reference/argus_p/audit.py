"""
ARGUS-P v2 audit orchestrator (multi-role).

A subject can hold several roles at once (the common case: a builder who also
invests and advises). Each held role is scored on its own track with its own
axes, caps and identity rule; the composite verdict is governed by the most
severe role and nothing is averaged across roles.
"""

import sqlite3
import json
import hashlib
from datetime import datetime, timezone

from .core import SCHEMA, normalize_x_handle, normalize_gh
from .taxonomy import (SubjectClass, HARD_IDENTITY_GATE_CLASSES, IDENTITY_CONFIDENCE,
                       VERIFICATION_STATUS, WALLET_LINK_TIERS, VentureOutcome,
                       classify_founder_pattern, repeat_backing_signal, DOX_BONUS)
from .profiles import get_profile, effective_caps, class_for_axis, SHARED_CAPS
from . import corroboration


VERDICT_BANDS = [("PASS", 70, 100), ("CAUTION", 40, 69), ("FAIL", 0, 39)]

# Composite ordering. The governing role is the most severe across held roles.
# AVOID (a confirmed disqualifying finding) outranks UNVERIFIABLE_IDENTITY
# (assessment blocked pending identity resolution).
SEVERITY = {"AVOID": 5, "UNVERIFIABLE_IDENTITY": 4, "FAIL": 3,
            "CAUTION": 2, "PASS": 1, "INCOMPLETE": 0}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _as_class(x):
    return x if isinstance(x, SubjectClass) else SubjectClass(x)


class Audit:
    def __init__(self, db_path, handle, subject_class=None, roles=None,
                 display_name=None, class_confidence=None):
        self.db = sqlite3.connect(db_path)
        self.db.executescript(SCHEMA)
        self.handle = normalize_x_handle(handle)

        if roles:
            self.roles = [_as_class(r) for r in roles]
        elif subject_class is not None:
            self.roles = [_as_class(subject_class)]
        else:
            self.roles = []
        # primary role kept for backward-compatible single-role references
        self.subject_class = self.roles[0] if self.roles else None

        self.audit_id = "PA-" + hashlib.sha1((self.handle + _now()).encode()).hexdigest()[:12].upper()
        self.db.execute(
            "INSERT INTO audits (audit_id, handle, display_name, subject_class, roles, "
            "class_confidence, started_at) VALUES (?,?,?,?,?,?,?)",
            (self.audit_id, self.handle, display_name,
             self.subject_class.value if self.subject_class else None,
             ",".join(r.value for r in self.roles) if self.roles else None,
             class_confidence, _now()))
        self.db.commit()
        self.axis_scores = {}

    # -- role assignment --
    def set_roles(self, roles, confidence=None):
        self.roles = [_as_class(r) for r in roles]
        self.subject_class = self.roles[0] if self.roles else None
        self.db.execute("UPDATE audits SET subject_class=?, roles=?, class_confidence=? "
                        "WHERE audit_id=?",
                        (self.subject_class.value if self.subject_class else None,
                         ",".join(r.value for r in self.roles), confidence, self.audit_id))
        self.db.commit()

    def add_role(self, role):
        role = _as_class(role)
        if role not in self.roles:
            self.roles.append(role)
            self.set_roles(self.roles)

    # backward-compatible single-role setter
    def set_class(self, subject_class, confidence=None):
        self.set_roles([subject_class], confidence)

    # -- identity --
    def set_identity(self, confidence, kb=None, track_record_verified=False):
        assert confidence in IDENTITY_CONFIDENCE
        self.track_record_verified = bool(track_record_verified)
        self.db.execute(
            "UPDATE audits SET identity_confidence=?, kb_hit=?, roster_hit=?, roster_price=? "
            "WHERE audit_id=?",
            (confidence, int(bool(kb and kb.get("kb_hit"))),
             int(bool(kb and kb.get("roster_hit"))),
             json.dumps(kb.get("roster_prices")) if kb else None, self.audit_id))
        self.db.commit()

    def add_platform(self, platform, platform_key, linkage_evidence, linkage_confidence,
                     account_created=None, prior_handles=None, notes=None):
        self.db.execute(
            "INSERT INTO identities (audit_id, platform, platform_key, linkage_evidence, "
            "linkage_confidence, account_created, prior_handles, notes) VALUES (?,?,?,?,?,?,?,?)",
            (self.audit_id, platform, platform_key, linkage_evidence, linkage_confidence,
             account_created, json.dumps(prior_handles or []), notes))
        self.db.commit()

    def add_associate(self, associate_handle, relation, in_cabal_kb=False,
                      evidence_url=None, notes=None):
        self.db.execute(
            "INSERT INTO associates (audit_id, associate_key, relation, in_cabal_kb, "
            "evidence_url, notes) VALUES (?,?,?,?,?,?)",
            (self.audit_id, normalize_x_handle(associate_handle), relation,
             int(in_cabal_kb), evidence_url, notes))
        self.db.commit()

    # -- KOL --
    def add_promotion(self, **kw):
        cols = ("ticker", "contract_address", "chain", "promo_date", "promo_url",
                "price_at_promo", "mcap_at_promo", "perf_7d", "perf_30d", "perf_current",
                "baseline_perf_30d", "outcome_was_rug", "paid_promo", "still_promoting",
                "post_deleted", "deletion_evidence", "disclosure", "notes")
        self.db.execute(
            f"INSERT INTO promotions (audit_id,{','.join(cols)}) VALUES (?{',?'*len(cols)})",
            [self.audit_id] + [kw.get(c) for c in cols])
        self.db.commit()

    def add_wallet(self, address, chain, link_tier, link_evidence_url=None,
                   activity_summary=None, sold_into_own_promo=False,
                   scam_adjacent_flow=False, positive_signals=None, notes=None):
        assert link_tier in WALLET_LINK_TIERS
        self.db.execute(
            "INSERT INTO wallets (audit_id, address, chain, link_tier, link_evidence_url, "
            "activity_summary, sold_into_own_promo, scam_adjacent_flow, positive_signals, notes) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, address, chain, link_tier, link_evidence_url, activity_summary,
             int(sold_into_own_promo), int(scam_adjacent_flow), positive_signals, notes))
        self.db.commit()

    # -- FOUNDER --
    def add_repo(self, gh_key, ownership_evidence, ownership_confidence,
                 repos_original=0, repos_forked=0, activity_summary=None, quality_notes=None):
        self.db.execute(
            "INSERT INTO repos (audit_id, gh_key, ownership_evidence, ownership_confidence, "
            "repos_original, repos_forked, activity_summary, quality_notes) VALUES (?,?,?,?,?,?,?,?)",
            (self.audit_id, normalize_gh(gh_key), ownership_evidence, ownership_confidence,
             repos_original, repos_forked, activity_summary, quality_notes))
        self.db.commit()

    def add_venture(self, project_name, role, period, outcome, acquirer=None, deal_type=None,
                    deal_value_usd=None, investors=None, current_backers=None,
                    evidence_url=None, notes=None):
        if not isinstance(outcome, VentureOutcome):
            outcome = VentureOutcome(outcome)
        self.db.execute(
            "INSERT INTO ventures (audit_id, project_name, role, period, outcome, acquirer, "
            "deal_type, deal_value_usd, investors_json, current_backers_json, evidence_url, notes) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, project_name, role, period, outcome.value, acquirer, deal_type,
             deal_value_usd, json.dumps(investors or []), json.dumps(current_backers or []),
             evidence_url, notes))
        self.db.commit()

    def founder_summary(self):
        rows = self.db.execute(
            "SELECT outcome, acquirer, investors_json, current_backers_json FROM ventures "
            "WHERE audit_id=?", (self.audit_id,)).fetchall()
        outcomes = [r[0] for r in rows]
        ventures = [{"outcome": r[0], "acquirer": r[1],
                     "investors": json.loads(r[2] or "[]"),
                     "current_backers": json.loads(r[3] or "[]")} for r in rows]
        return {"pattern": classify_founder_pattern(outcomes).value,
                "repeat_backing": repeat_backing_signal(ventures)}

    # -- INVESTOR --
    def add_fund(self, fund_name, vintage=None, target_size_usd=None, raised_usd=None,
                 tier=None, lp_disclosure=None, source_db=None, source_url=None, notes=None):
        tier_v = tier.value if hasattr(tier, "value") else tier
        self.db.execute(
            "INSERT INTO funds (audit_id, fund_name, vintage, target_size_usd, raised_usd, "
            "tier, lp_disclosure, source_db, source_url, notes) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, fund_name, vintage, target_size_usd, raised_usd, tier_v,
             lp_disclosure, source_db, source_url, notes))
        self.db.commit()

    def add_testimonial(self, claimed_endorser_handle=None, claimed_endorser_name=None,
                        claimed_project=None, claimed_relationship=None, appears_at=None,
                        follows_subject=None, public_acknowledgment=None,
                        relationship_corroborated=None, sentiment=None, fud_present=False,
                        evidence_url=None, notes=None):
        verdict = corroboration.classify_testimonial({
            "public_acknowledgment": public_acknowledgment,
            "relationship_corroborated": relationship_corroborated,
            "follows_subject": follows_subject,
            "sentiment": sentiment,
            "fud_present": fud_present,
        })
        self.db.execute(
            "INSERT INTO testimonials (audit_id, claimed_endorser_handle, claimed_endorser_name, "
            "claimed_project, claimed_relationship, appears_at, follows_subject, "
            "public_acknowledgment, relationship_corroborated, sentiment, fud_present, "
            "corroboration_verdict, evidence_url, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, claimed_endorser_handle, claimed_endorser_name, claimed_project,
             claimed_relationship, appears_at,
             None if follows_subject is None else int(follows_subject),
             public_acknowledgment,
             None if relationship_corroborated is None else int(relationship_corroborated),
             sentiment, int(bool(fud_present)), verdict.value, evidence_url, notes))
        self.db.commit()
        return verdict

    # -- ADVISOR --
    def add_advised_project(self, project_name, project_handle=None, claimed_role="advisor",
                            appears_at=None, paid_or_allocated=False, project_outcome=None,
                            follows_subject=None, public_acknowledgment=None,
                            relationship_corroborated=None, sentiment=None, fud_present=False,
                            evidence_url=None, notes=None):
        if project_outcome is not None and isinstance(project_outcome, VentureOutcome):
            project_outcome = project_outcome.value
        verdict = corroboration.classify_testimonial({
            "public_acknowledgment": public_acknowledgment,
            "relationship_corroborated": relationship_corroborated,
            "follows_subject": follows_subject,
            "sentiment": sentiment,
            "fud_present": fud_present,
        })
        self.db.execute(
            "INSERT INTO advised_projects (audit_id, project_name, project_handle, claimed_role, "
            "appears_at, paid_or_allocated, project_outcome, follows_subject, public_acknowledgment, "
            "relationship_corroborated, sentiment, fud_present, corroboration_verdict, evidence_url, "
            "notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, project_name, project_handle, claimed_role, appears_at,
             int(bool(paid_or_allocated)), project_outcome,
             None if follows_subject is None else int(follows_subject),
             public_acknowledgment,
             None if relationship_corroborated is None else int(relationship_corroborated),
             sentiment, int(bool(fud_present)), verdict.value, evidence_url, notes))
        self.db.commit()
        return verdict

    def advised_outcome_summary(self):
        rows = self.db.execute("SELECT project_outcome, paid_or_allocated FROM advised_projects "
                               "WHERE audit_id=?", (self.audit_id,)).fetchall()
        n = len(rows)
        rugs = sum(1 for o, _ in rows if o == "Rug")
        rugs_paid = sum(1 for o, paid in rows if o == "Rug" and paid)
        successes = sum(1 for o, _ in rows if o in ("IPO", "Acquisition"))
        return {"advised": n, "rugs": rugs, "rugs_with_allocation": rugs_paid,
                "successes": successes}

    # -- AGENCY --
    def add_client_engagement(self, client_name, service_type, period=None,
                              client_outcome=None, manipulation_service_flag=False,
                              evidence_url=None, notes=None):
        if client_outcome is not None and isinstance(client_outcome, VentureOutcome):
            client_outcome = client_outcome.value
        self.db.execute(
            "INSERT INTO client_engagements (audit_id, client_name, service_type, period, "
            "client_outcome, manipulation_service_flag, evidence_url, notes) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (self.audit_id, client_name, service_type, period, client_outcome,
             int(bool(manipulation_service_flag)), evidence_url, notes))
        self.db.commit()

    # -- shared findings --
    def add_finding(self, finding_type, claim, source_url, source_date, verification_status,
                    independent_source_count=0, source_author=None, polarity=-1):
        assert verification_status in VERIFICATION_STATUS
        self.db.execute(
            "INSERT INTO findings (audit_id, finding_type, claim, source_url, source_date, "
            "source_author, verification_status, independent_source_count, polarity, recorded_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?)",
            (self.audit_id, finding_type, claim, source_url, source_date, source_author,
             verification_status, independent_source_count, polarity, _now()))
        self.db.commit()

    # -- scoring --
    def set_axis(self, axis, score, rationale=""):
        role = class_for_axis(axis)
        assert role in self.roles, f"axis {axis} belongs to {role.value}, not a held role"
        w = get_profile(role)["axes"][axis]
        self.axis_scores[axis] = {"score": max(0.0, min(float(score), w)),
                                  "weight": w, "rationale": rationale, "role": role.value}

    def corroboration_axis(self, axis="I4_testimonial_corroboration"):
        """Score the investor testimonial axis from recorded testimonials."""
        w = get_profile(SubjectClass.INVESTOR)["axes"][axis]
        rows = self.db.execute(
            "SELECT corroboration_verdict FROM testimonials WHERE audit_id=?",
            (self.audit_id,)).fetchall()
        ts = [{"corroboration_verdict": r[0]} for r in rows]
        return corroboration.score_axis(ts, w)

    def advisory_corroboration_axis(self, axis="AD3_relationship_corroboration"):
        """Score the advisor relationship-corroboration axis from advised projects."""
        w = get_profile(SubjectClass.ADVISOR)["axes"][axis]
        rows = self.db.execute(
            "SELECT corroboration_verdict FROM advised_projects WHERE audit_id=?",
            (self.audit_id,)).fetchall()
        ts = [{"corroboration_verdict": r[0]} for r in rows]
        return corroboration.score_axis(ts, w)

    # -- cap detection --
    def _shared_caps_triggered(self):
        cur = self.db.cursor()
        keys = []
        def has(ftype, status, n=1):
            return cur.execute(
                "SELECT COUNT(*) FROM findings WHERE audit_id=? AND finding_type=? AND "
                "verification_status=? AND independent_source_count>=?",
                (self.audit_id, ftype, status, n)).fetchone()[0] > 0
        if has("DeceptionFinding", "Verified"):
            keys.append("deception_confirmed")
        if has("InvestigatorCallout", "Verified", 2):
            keys.append("investigator_verified_fraud")
        return keys

    def _role_caps_triggered(self, role):
        cur = self.db.cursor()
        keys = []
        if role == SubjectClass.FOUNDER:
            if cur.execute("SELECT COUNT(*) FROM ventures WHERE audit_id=? AND outcome='Rug'",
                           (self.audit_id,)).fetchone()[0]:
                keys.append("prior_rug_as_principal")
        elif role == SubjectClass.KOL:
            if cur.execute("SELECT COUNT(*) FROM wallets WHERE audit_id=? AND sold_into_own_promo=1 "
                           "AND link_tier IN ('SelfDoxxed','InvestigatorAttributed')",
                           (self.audit_id,)).fetchone()[0]:
                keys.append("wallet_sold_into_promo")
            if cur.execute("SELECT COUNT(*) FROM promotions WHERE audit_id=? AND paid_promo=1 "
                           "AND outcome_was_rug=1", (self.audit_id,)).fetchone()[0]:
                keys.append("paid_to_shill_confirmed_rug")
        elif role == SubjectClass.INVESTOR:
            if cur.execute("SELECT COUNT(*) FROM testimonials WHERE audit_id=? AND "
                           "corroboration_verdict='Contradicted'", (self.audit_id,)).fetchone()[0]:
                keys.append("contradicted_testimonial")
            if cur.execute("SELECT COUNT(*) FROM findings WHERE audit_id=? AND "
                           "finding_type='PredatoryTerms' AND verification_status='Verified'",
                           (self.audit_id,)).fetchone()[0]:
                keys.append("predatory_terms_verified")
        elif role == SubjectClass.ADVISOR:
            if cur.execute("SELECT COUNT(*) FROM advised_projects WHERE audit_id=? AND "
                           "corroboration_verdict='Contradicted'", (self.audit_id,)).fetchone()[0]:
                keys.append("claimed_advisory_contradicted")
            if cur.execute("SELECT COUNT(*) FROM advised_projects WHERE audit_id=? AND "
                           "project_outcome='Rug' AND paid_or_allocated=1",
                           (self.audit_id,)).fetchone()[0]:
                keys.append("advised_rug_with_allocation")
        elif role == SubjectClass.AGENCY:
            if cur.execute("SELECT COUNT(*) FROM client_engagements WHERE audit_id=? AND "
                           "manipulation_service_flag=1", (self.audit_id,)).fetchone()[0]:
                keys.append("market_manipulation_services")
        return keys

    def _identity_blocks(self, role, identity):
        # Pseudonymity never blocks. Only genuine impersonation / identity fraud
        # blocks publication, and it does so for every class.
        return identity == "SuspectedImpersonation"

    # -- finalize --
    def finalize(self):
        identity = self.db.execute(
            "SELECT identity_confidence FROM audits WHERE audit_id=?",
            (self.audit_id,)).fetchone()[0]
        shared_keys = self._shared_caps_triggered()
        dox_bonus = DOX_BONUS.get(identity, 0)   # reward verifiable real-world identity

        role_reports = []
        for role in self.roles:
            axes = {ax: a for ax, a in self.axis_scores.items()
                    if class_for_axis(ax) == role}
            if not axes:
                role_reports.append({"role": role.value, "verdict": "INCOMPLETE",
                                     "raw_total": None, "score_total": None,
                                     "cap_applied": None, "dox_bonus": dox_bonus, "axes": {}})
                continue
            raw = round(sum(a["score"] for a in axes.values()))
            base = raw + dox_bonus
            caps = effective_caps(role)
            triggered = [(caps[k], k) for k in self._role_caps_triggered(role)]
            triggered += [(SHARED_CAPS[k], k) for k in shared_keys]
            if triggered:
                ceiling, applied = min(triggered, key=lambda x: x[0])
                total = min(base, ceiling)
            else:
                ceiling, applied, total = None, None, min(100, base)

            if self._identity_blocks(role, identity):
                verdict, published = "UNVERIFIABLE_IDENTITY", None
            elif applied and ceiling <= 10:
                verdict, published = "AVOID", total
            else:
                published = total
                verdict = next(n for n, lo, hi in VERDICT_BANDS if lo <= total <= hi)
            role_reports.append({"role": role.value, "axes": axes, "raw_total": raw,
                                 "dox_bonus": dox_bonus, "cap_applied": applied,
                                 "score_total": published, "verdict": verdict})

        scored = [r for r in role_reports if r["verdict"] != "INCOMPLETE"]
        if scored:
            governing = max(scored, key=lambda r: SEVERITY[r["verdict"]])
            composite = governing["verdict"]
            gov_role = governing["role"]
            gov_score = governing["score_total"]
        else:
            composite, gov_role, gov_score = "INCOMPLETE", None, None

        report = {
            "audit_id": self.audit_id, "handle": self.handle,
            "roles": [r.value for r in self.roles],
            "identity_confidence": identity,
            "role_reports": role_reports,
            "composite_verdict": composite,
            "governing_role": gov_role,
            "governing_score": gov_score,
            # backward-compatible single-role aliases
            "verdict": composite,
            "score_total": gov_score,
            "cap_applied": governing["cap_applied"] if scored else None,
            "publishable_findings": self._publishable(),
            "finalized_at": _now(),
        }
        if SubjectClass.FOUNDER in self.roles:
            report["founder_summary"] = self.founder_summary()
        if SubjectClass.ADVISOR in self.roles:
            report["advised_summary"] = self.advised_outcome_summary()

        self.db.execute(
            "UPDATE audits SET completed_at=?, score_total=?, verdict=?, cap_applied=?, "
            "report_json=? WHERE audit_id=?",
            (report["finalized_at"], gov_score, composite,
             governing["cap_applied"] if scored else None,
             json.dumps(report), self.audit_id))
        self.db.commit()
        return report

    def _publishable(self):
        cur = self.db.execute("SELECT * FROM findings_publishable WHERE audit_id=?",
                              (self.audit_id,))
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    # -- Panoptes export --
    def to_panoptes(self):
        nodes = [{"type": "Person", "key": self.handle,
                  "roles": [r.value for r in self.roles]}]
        edges = []
        for r in self.db.execute("SELECT associate_key, relation, in_cabal_kb FROM associates "
                                 "WHERE audit_id=?", (self.audit_id,)):
            nodes.append({"type": "Person", "key": r[0], "in_cabal_kb": bool(r[2])})
            edges.append({"src": self.handle, "dst": r[0], "type": "ASSOCIATES_WITH", "relation": r[1]})
        for r in self.db.execute("SELECT project_name, outcome FROM ventures WHERE audit_id=?",
                                 (self.audit_id,)):
            nodes.append({"type": "Company", "key": r[0], "outcome": r[1]})
            edges.append({"src": self.handle, "dst": r[0], "type": "FOUNDED", "outcome": r[1]})
        for r in self.db.execute("SELECT ticker, contract_address, outcome_was_rug FROM promotions "
                                 "WHERE audit_id=?", (self.audit_id,)):
            key = r[1] or ("$" + r[0])
            nodes.append({"type": "Company", "key": key, "was_rug": bool(r[2])})
            edges.append({"src": self.handle, "dst": key, "type": "PROMOTED"})
        for r in self.db.execute("SELECT claimed_endorser_handle, corroboration_verdict, "
                                 "claimed_relationship FROM testimonials WHERE audit_id=?",
                                 (self.audit_id,)):
            if r[0]:
                nodes.append({"type": "Person", "key": r[0]})
                edges.append({"src": r[0], "dst": self.handle, "type": "CLAIMED_ENDORSEMENT",
                              "verdict": r[1], "claimed_relation": r[2]})
        for r in self.db.execute("SELECT project_name, project_handle, corroboration_verdict, "
                                 "project_outcome FROM advised_projects WHERE audit_id=?",
                                 (self.audit_id,)):
            key = r[1] or r[0]
            nodes.append({"type": "Company", "key": key, "outcome": r[3]})
            edges.append({"src": self.handle, "dst": key, "type": "ADVISED",
                          "verdict": r[2], "outcome": r[3]})
        for r in self.db.execute("SELECT client_name, manipulation_service_flag FROM "
                                 "client_engagements WHERE audit_id=?", (self.audit_id,)):
            nodes.append({"type": "Company", "key": r[0]})
            edges.append({"src": self.handle, "dst": r[0], "type": "SERVICED",
                          "manipulation": bool(r[1])})
        for r in self.db.execute("SELECT address, chain, link_tier FROM wallets WHERE audit_id=?",
                                 (self.audit_id,)):
            key = f"{r[1]}:{r[0]}"
            nodes.append({"type": "Identity", "subtype": "Wallet", "key": key, "link_tier": r[2]})
            edges.append({"src": self.handle, "dst": key, "type": "CONTROLS_WALLET", "tier": r[2]})
        for r in self.db.execute("SELECT claim, source_url, verification_status FROM findings "
                                 "WHERE audit_id=? AND finding_type='DeceptionFinding'",
                                 (self.audit_id,)):
            key = "DF-" + hashlib.sha1(r[0].encode()).hexdigest()[:10]
            nodes.append({"type": "DeceptionFinding", "key": key, "claim": r[0],
                          "source": r[1], "status": r[2]})
            edges.append({"src": key, "dst": self.handle, "type": "FLAGS", "permanent": True})
        return {"nodes": nodes, "edges": edges}
