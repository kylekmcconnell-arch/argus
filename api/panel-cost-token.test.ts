import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issuePanelCostToken, issueScanPanelToken, resolvePanelCostVersion, resolvePanelGrant } from "./_cache.js";

const ORG_ID = "00000000-0000-4000-8000-000000000101";
const OTHER_ORG_ID = "00000000-0000-4000-8000-000000000102";
const VERSION_ID = "00000000-0000-4000-8000-000000000201";

const originalEnv = {
  tokenSecret: process.env.PANEL_COST_TOKEN_SECRET,
  supabaseSecret: process.env.SUPABASE_SECRET_KEY,
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_KEY,
};

function restore(name: string, value: string | undefined) {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  process.env.PANEL_COST_TOKEN_SECRET = "panel-cost-test-secret";
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
});

afterEach(() => {
  vi.useRealTimers();
  restore("PANEL_COST_TOKEN_SECRET", originalEnv.tokenSecret);
  restore("SUPABASE_SECRET_KEY", originalEnv.supabaseSecret);
  restore("SUPABASE_SERVICE_ROLE_KEY", originalEnv.serviceRole);
  restore("SUPABASE_SERVICE_KEY", originalEnv.serviceKey);
});

describe("panel-cost attribution tokens", () => {
  it("resolves only for the exact authenticated organization and version", () => {
    const token = issuePanelCostToken(ORG_ID, VERSION_ID);

    expect(token).toEqual(expect.any(String));
    expect(resolvePanelCostVersion(ORG_ID, token)).toBe(VERSION_ID);
    expect(resolvePanelCostVersion(OTHER_ORG_ID, token)).toBeUndefined();
  });

  it("refuses to issue capabilities for non-UUID tenant or version identifiers", () => {
    expect(issuePanelCostToken("org-1", VERSION_ID)).toBeUndefined();
    expect(issuePanelCostToken(ORG_ID, "0x1111111111111111111111111111111111111111")).toBeUndefined();
  });

  it("rejects payload and signature tampering", () => {
    const token = issuePanelCostToken(ORG_ID, VERSION_ID)!;
    const [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const changedPayload = Buffer.from(JSON.stringify({ ...decoded, report: "00000000-0000-4000-8000-000000000202" })).toString("base64url");
    const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(resolvePanelCostVersion(ORG_ID, `${changedPayload}.${signature}`)).toBeUndefined();
    expect(resolvePanelCostVersion(ORG_ID, `${payload}.${changedSignature}`)).toBeUndefined();
  });

  it("expires after thirty minutes", () => {
    const token = issuePanelCostToken(ORG_ID, VERSION_ID);

    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(resolvePanelCostVersion(ORG_ID, token)).toBe(VERSION_ID);

    vi.advanceTimersByTime(1);
    expect(resolvePanelCostVersion(ORG_ID, token)).toBeUndefined();
  });

  it("fails closed without a server-held signing secret", () => {
    delete process.env.PANEL_COST_TOKEN_SECRET;

    expect(issuePanelCostToken(ORG_ID, VERSION_ID)).toBeUndefined();
    expect(resolvePanelCostVersion(ORG_ID, "anything")).toBeUndefined();
  });

  it("can use the existing Supabase service secret as the signing key", () => {
    delete process.env.PANEL_COST_TOKEN_SECRET;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

    const token = issuePanelCostToken(ORG_ID, VERSION_ID);
    expect(resolvePanelCostVersion(ORG_ID, token)).toBe(VERSION_ID);
  });
});

const RUN_KEY = "scan-run-key-12345";

describe("scan-scoped panel capability", () => {
  it("entitles a panel opened before the report exists, without naming a version", () => {
    // A panel opened DURING a scan has no report version to present, which is
    // why paid panel routes could not require a capability at all (#356).
    const token = issueScanPanelToken(ORG_ID, RUN_KEY);

    expect(token).toEqual(expect.any(String));
    expect(resolvePanelGrant(ORG_ID, token)).toEqual({ scanRunKey: RUN_KEY });
    // It must never be usable to nominate a version for cost attribution.
    expect(resolvePanelCostVersion(ORG_ID, token)).toBeUndefined();
  });

  it("is bound to the issuing organization", () => {
    const token = issueScanPanelToken(ORG_ID, RUN_KEY);

    expect(resolvePanelGrant(OTHER_ORG_ID, token)).toBeNull();
  });

  it("expires with the same short life as the version capability", () => {
    const token = issueScanPanelToken(ORG_ID, RUN_KEY);

    vi.setSystemTime(new Date("2026-07-11T12:29:00.000Z"));
    expect(resolvePanelGrant(ORG_ID, token)).toEqual({ scanRunKey: RUN_KEY });

    vi.setSystemTime(new Date("2026-07-11T12:31:00.000Z"));
    expect(resolvePanelGrant(ORG_ID, token)).toBeNull();
  });

  it("refuses a run key that is not one we could have issued", () => {
    expect(issueScanPanelToken(ORG_ID, "")).toBeUndefined();
    expect(issueScanPanelToken(ORG_ID, "has spaces")).toBeUndefined();
    expect(issueScanPanelToken(ORG_ID, "x".repeat(201))).toBeUndefined();
    expect(issueScanPanelToken("not-a-uuid", RUN_KEY)).toBeUndefined();
  });

  it("refuses a forged or altered capability", () => {
    const token = issueScanPanelToken(ORG_ID, RUN_KEY)!;
    const [payload, signature] = token.split(".");

    expect(resolvePanelGrant(ORG_ID, `${payload}x.${signature}`)).toBeNull();
    expect(resolvePanelGrant(ORG_ID, payload)).toBeNull();
    expect(resolvePanelGrant(ORG_ID, `${payload}.${"A".repeat(43)}`)).toBeNull();
  });

  it("reads a version capability through the same grant resolver", () => {
    // One admission check can accept either capability.
    const versionToken = issuePanelCostToken(ORG_ID, VERSION_ID);

    expect(resolvePanelGrant(ORG_ID, versionToken)).toEqual({ reportVersionId: VERSION_ID });
    expect(resolvePanelGrant(ORG_ID, "not-a-token")).toBeNull();
    expect(resolvePanelGrant(ORG_ID, undefined)).toBeNull();
  });
});
