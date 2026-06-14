"""
ARGUS-P v2 core: entity resolution, schema, KB cross-reference.

Entity resolution is the FROZEN contract shared across all ARGUS modules.
Do not change the join-key formats here without versioning and re-keying
the entire knowledge base.
"""

import re
import glob

# --------------------------------------------------------------------------
# Frozen entity-resolution contract
# --------------------------------------------------------------------------

_HANDLE_TAIL = re.compile(r'@?([A-Za-z0-9_]{2,30})$')

def normalize_x_handle(raw: str) -> str:
    raw = raw.strip()
    m = re.search(r'(?:x\.com|twitter\.com)/([A-Za-z0-9_]{2,30})', raw, re.I)
    if m:
        return '@' + m.group(1).lower()
    m = _HANDLE_TAIL.match(raw)
    if m:
        return '@' + m.group(1).lower()
    raise ValueError(f"cannot normalize handle: {raw!r}")

def normalize_gh(raw: str) -> str:
    m = re.search(r'github\.com/([A-Za-z0-9-]{1,39})', raw, re.I)
    name = m.group(1) if m else raw.strip().lstrip('@')
    return 'gh:' + name.lower()


# --------------------------------------------------------------------------
# Schema (extends the FUD-ledger database; v2 supersedes the v1 person tables)
# --------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS audits (
    audit_id        TEXT PRIMARY KEY,
    handle          TEXT NOT NULL,
    display_name    TEXT,
    subject_class   TEXT,                     -- primary role (backward compatible)
    roles           TEXT,                     -- all held roles, comma-joined
    class_confidence TEXT,                     -- router confidence or 'operator-set'
    started_at      TEXT NOT NULL,
    completed_at    TEXT,
    identity_confidence TEXT,
    kb_hit          INTEGER DEFAULT 0,
    roster_hit      INTEGER DEFAULT 0,
    roster_price    TEXT,
    score_total     INTEGER,
    verdict         TEXT,
    cap_applied     TEXT,
    report_json     TEXT
);

CREATE TABLE IF NOT EXISTS identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_key TEXT NOT NULL,
    linkage_evidence TEXT,
    linkage_confidence TEXT,
    account_created TEXT,
    prior_handles TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS associates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    associate_key TEXT NOT NULL,
    relation TEXT,
    in_cabal_kb INTEGER DEFAULT 0,
    evidence_url TEXT,
    notes TEXT
);

-- KOL: promotion / shill ledger
CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    contract_address TEXT,
    chain TEXT,
    promo_date TEXT,
    promo_url TEXT,
    price_at_promo REAL,
    mcap_at_promo REAL,
    perf_7d REAL,
    perf_30d REAL,
    perf_current REAL,
    baseline_perf_30d REAL,                    -- chain/ecosystem baseline for relative perf
    outcome_was_rug INTEGER DEFAULT 0,         -- promoted token later confirmed a rug
    paid_promo INTEGER DEFAULT 0,
    still_promoting INTEGER,
    post_deleted INTEGER DEFAULT 0,
    deletion_evidence TEXT,
    disclosure TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    address TEXT NOT NULL,
    chain TEXT NOT NULL,
    link_tier TEXT,
    link_evidence_url TEXT,
    activity_summary TEXT,
    sold_into_own_promo INTEGER DEFAULT 0,
    scam_adjacent_flow INTEGER DEFAULT 0,
    positive_signals TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    gh_key TEXT NOT NULL,
    ownership_evidence TEXT,
    ownership_confidence TEXT,
    repos_original INTEGER,
    repos_forked INTEGER,
    activity_summary TEXT,
    quality_notes TEXT
);

-- FOUNDER: venture history with full outcome taxonomy and backing data
CREATE TABLE IF NOT EXISTS ventures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    role TEXT,
    period TEXT,
    outcome TEXT,                              -- VentureOutcome value
    acquirer TEXT,                             -- who bought it, if acquired
    deal_type TEXT,                            -- strategic / financial / acquihire / asset
    deal_value_usd REAL,
    investors_json TEXT,                       -- prior backers of this venture
    current_backers_json TEXT,                 -- backers of the CURRENT venture (for repeat-backing)
    repeat_backing INTEGER DEFAULT 0,
    evidence_url TEXT,
    notes TEXT
);

-- INVESTOR: fund records
CREATE TABLE IF NOT EXISTS funds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    fund_name TEXT,
    vintage TEXT,
    target_size_usd REAL,
    raised_usd REAL,
    tier TEXT,                                 -- FundTier value
    lp_disclosure TEXT,                        -- known / partial / undisclosed
    source_db TEXT,                            -- pitchbook / crunchbase / angellist / self
    source_url TEXT,
    notes TEXT
);

-- INVESTOR / FOUNDER: testimonial & relationship corroboration
CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    claimed_endorser_handle TEXT,
    claimed_endorser_name TEXT,
    claimed_project TEXT,
    claimed_relationship TEXT,                 -- portfolio / advisor_to_subject / investor_in_subject / partner
    appears_at TEXT,                           -- where the claim is published (subject's own surface)
    follows_subject INTEGER,                   -- 0/1, null = unknown
    public_acknowledgment TEXT,                -- none / mention / thanks / endorsement
    relationship_corroborated INTEGER,         -- 0/1, null = unknown
    sentiment TEXT,                            -- positive / neutral / negative / none
    fud_present INTEGER DEFAULT 0,
    corroboration_verdict TEXT,                -- TestimonialVerdict value
    evidence_url TEXT,
    notes TEXT
);

-- ADVISOR: advised-project record with relationship corroboration
CREATE TABLE IF NOT EXISTS advised_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    project_name TEXT,
    project_handle TEXT,
    claimed_role TEXT,                         -- advisor / board / strategic
    appears_at TEXT,                           -- where the advisory claim is published
    paid_or_allocated INTEGER DEFAULT 0,       -- received a token/equity allocation
    project_outcome TEXT,                      -- VentureOutcome value of the project
    follows_subject INTEGER,
    public_acknowledgment TEXT,                -- none / mention / thanks / endorsement
    relationship_corroborated INTEGER,
    sentiment TEXT,
    fud_present INTEGER DEFAULT 0,
    corroboration_verdict TEXT,                -- TestimonialVerdict value
    evidence_url TEXT,
    notes TEXT
);

-- AGENCY: client engagements
CREATE TABLE IF NOT EXISTS client_engagements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    client_name TEXT,
    service_type TEXT,                         -- pr / kol_mgmt / market_making / raids / growth
    period TEXT,
    client_outcome TEXT,                       -- VentureOutcome value of the client project
    manipulation_service_flag INTEGER DEFAULT 0,  -- wash trading / bot networks / fake engagement
    evidence_url TEXT,
    notes TEXT
);

-- Shared findings ledger (append-only, evidence-disciplined)
CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_id TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    claim TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_date TEXT NOT NULL,
    source_author TEXT,
    verification_status TEXT NOT NULL,
    independent_source_count INTEGER DEFAULT 0,
    polarity INTEGER DEFAULT -1,
    recorded_at TEXT NOT NULL
);

CREATE VIEW IF NOT EXISTS findings_publishable AS
    SELECT * FROM findings
    WHERE independent_source_count >= 1
      AND verification_status IN ('Verified','Reported');
"""


# --------------------------------------------------------------------------
# KB cross-reference (Step P0)
# --------------------------------------------------------------------------

_HANDLE_SCAN = re.compile(r'@([A-Za-z0-9_]{2,30})')
_URL_SCAN    = re.compile(r'(?:x\.com|twitter\.com)/([A-Za-z0-9_]{2,30})', re.I)
_PRICE_RE    = re.compile(r'(?:\$|usd[t]?\s*)\s*([\d,]+(?:\.\d+)?)', re.I)

def kb_crossref(handle: str, kb_dir: str = '/mnt/project') -> dict:
    import pandas as pd
    key = normalize_x_handle(handle).lstrip('@')
    hits = []
    for f in sorted(glob.glob(f'{kb_dir}/*.xlsx')):
        try:
            sheets = pd.read_excel(f, sheet_name=None, header=None, dtype=str)
        except Exception:
            continue
        for sheet, df in sheets.items():
            df = df.fillna('')
            mask = df.apply(lambda col: col.astype(str).str.contains(key, case=False, regex=False))
            for idx, row in df[mask.any(axis=1)].iterrows():
                row_text = ' | '.join(str(v) for v in row.values if str(v).strip())
                found = set(h.lower() for h in _HANDLE_SCAN.findall(row_text))
                found |= set(h.lower() for h in _URL_SCAN.findall(row_text))
                if key.lower() in found or key.lower() in row_text.lower().split():
                    pm = _PRICE_RE.search(row_text)
                    hits.append({'file': f.split('/')[-1], 'sheet': sheet,
                                 'row_index': int(idx), 'row_text': row_text[:500],
                                 'price_hint': pm.group(0).strip() if pm else None})
    prices = [h['price_hint'] for h in hits if h['price_hint']]
    return {'handle': '@' + key, 'kb_hit': len(hits) > 0, 'hit_count': len(hits),
            'distinct_files': sorted({h['file'] for h in hits}),
            'roster_hit': len(prices) > 0, 'roster_prices': prices, 'hits': hits}
