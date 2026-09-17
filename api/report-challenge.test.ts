import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  loadExactVersionReport: vi.fn(),
}));

vi.mock("./_auth.js", async () => {
  const actual = await vi.importActual<typeof import("./_auth.js")>("./_auth.js");
  return {
    ...actual,
    requireArgusAuth: harness.requireArgusAuth,
    serviceCredentials: harness.serviceCredentials,
  };
});

vi.mock("./report.js", () => ({
  loadExactVersionReport: harness.loadExactVersionReport,
}));

import handler, {
  emailDomainMatchesOfficial,
  officialDomainFromReportPayload,
  validateAttachments,
} from "./report-challenge";

const REPORT_VERSION_ID = "1d4b3030-de29-4633-a281-beb9672c4a00";
const VERIFICATION_ID = "2e5c4141-ef3a-4744-b392-cfca783d5b11";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

const AUTH = {
  userId: "00000000-0000-4000-8000-00000000aaaa",
  email: "analyst@argus.example",
  organizationId: ORGANIZATION_ID,
  role: "viewer",
  displayName: "Analyst",
};

function responseCapture() {
  const captured: { status?: number; body?: unknown; text?: string; headers: Record<string, string> } = { headers: {} };
  const response = {
    status(code: number) { captured.status = code; return response; },
    json(body: unknown) { captured.body = body; return response; },
    send(text: string) { captured.text = text; return response; },
    setHeader(key: string, value: string) { captured.headers[key] = value; return response; },
  };
  return { captured, response };
}

const request = (method: string, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) =>
  ({ method, body, query, headers: { host: "argus.example" } });

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  harness.requireArgusAuth.mockClear();
  harness.loadExactVersionReport.mockReset();
  harness.requireArgusAuth.mockResolvedValue(AUTH);
  harness.serviceCredentials.mockReturnValue({ url: "https://db.example", key: "service-key" });
  vi.stubEnv("RESEND_API_KEY", "resend-key");
  vi.stubEnv("ARGUS_APP_ORIGIN", "https://argus.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("officialDomainFromReportPayload", () => {
  it("prefers the verified token homepage over the profile website", () => {
    expect(officialDomainFromReportPayload({
      website: "https://old-site.example/",
      projectToken: { homepage: "https://definitive.fi/" },
    })).toBe("definitive.fi");
    expect(officialDomainFromReportPayload({ website: "https://www.definitive.fi/" })).toBe("definitive.fi");
    expect(officialDomainFromReportPayload({})).toBeNull();
  });
});

describe("emailDomainMatchesOfficial", () => {
  it("accepts the exact apex and its subdomains, nothing else", () => {
    expect(emailDomainMatchesOfficial("kyle@definitive.fi", "definitive.fi")).toBe(true);
    expect(emailDomainMatchesOfficial("ops@mail.definitive.fi", "definitive.fi")).toBe(true);
    expect(emailDomainMatchesOfficial("kyle@definitive.fi.attacker.example", "definitive.fi")).toBe(false);
    expect(emailDomainMatchesOfficial("kyle@notdefinitive.fi", "definitive.fi")).toBe(false);
    expect(emailDomainMatchesOfficial("no-at-sign", "definitive.fi")).toBe(false);
  });
});

describe("validateAttachments", () => {
  const png = (bytes: number) => `data:image/png;base64,${"A".repeat(Math.ceil(bytes * 4 / 3))}`;

  it("accepts allowlisted types under the caps and rejects everything else", () => {
    expect(validateAttachments(undefined)).toEqual([]);
    expect(validateAttachments([{ name: "proof.png", type: "image/png", dataUrl: png(1000) }])).toHaveLength(1);
    expect(validateAttachments([{ name: "run.exe", type: "application/x-msdownload", dataUrl: "data:application/x-msdownload;base64,AAAA" }])).toBeNull();
    expect(validateAttachments([{ name: "big.png", type: "image/png", dataUrl: png(2_400_000) }])).toBeNull();
    expect(validateAttachments([1, 2, 3, 4].map((n) => ({ name: `f${n}.png`, type: "image/png", dataUrl: png(10) })))).toBeNull();
    // declared type must match the data URL's own type
    expect(validateAttachments([{ name: "proof.png", type: "image/png", dataUrl: "data:application/pdf;base64,AAAA" }])).toBeNull();
  });
});

describe("request_verification", () => {
  it("refuses an email whose domain does not match the frozen report's official site", async () => {
    harness.loadExactVersionReport.mockResolvedValue({
      caseStatus: "open",
      report: { kind: "person", ref: "@definitivefi", query: "Definitive", payload: { website: "https://www.definitive.fi/" } },
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "request_verification", subject: "@definitivefi", reportVersionId: REPORT_VERSION_ID, email: "impostor@attacker.example",
    }) as never, response as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ available: false });
    expect(String((captured.body as { note?: string }).note)).toContain("definitive.fi");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports unconfigured email verification as a visible gap, not an error", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "request_verification", subject: "@definitivefi", reportVersionId: REPORT_VERSION_ID, email: "kyle@definitive.fi",
    }) as never, response as never);
    expect(captured.body).toMatchObject({ available: false });
    expect(String((captured.body as { note?: string }).note)).toContain("not configured");
  });

  it("stores a hashed, expiring verification and emails the one-time link", async () => {
    harness.loadExactVersionReport.mockResolvedValue({
      caseStatus: "open",
      report: { kind: "person", ref: "@definitivefi", query: "Definitive", payload: { website: "https://www.definitive.fi/" } },
    });
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      if (url.includes("/rest/v1/challenge_verifications")) return jsonResponse([{ id: VERIFICATION_ID }]);
      if (url.includes("api.resend.com")) return jsonResponse({ id: "email" });
      return jsonResponse([]);
    }));
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "request_verification", subject: "@definitivefi", reportVersionId: REPORT_VERSION_ID, email: "Kyle@Definitive.fi",
    }) as never, response as never);
    expect(captured.body).toMatchObject({ available: true, verificationId: VERIFICATION_ID });

    const insert = calls.find((call) => call.url.includes("challenge_verifications"))!;
    expect(insert.body.email).toBe("kyle@definitive.fi");
    expect(insert.body.email_domain).toBe("definitive.fi");
    expect(String(insert.body.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    const email = calls.find((call) => call.url.includes("api.resend.com"))!;
    expect(String(email.body.subject)).toContain("Definitive team");
    const text = String(email.body.text);
    expect(text).toContain("verifying information on ARGUS for the public");
    const token = text.match(/token=([0-9a-f]{64})/)?.[1];
    expect(token).toBeDefined();
    // the emailed token is never stored in plaintext
    expect(insert.body.token_hash).not.toBe(token);
  });
});

describe("submit", () => {
  it("never records a team challenge without a completed, matching verification", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("challenge_verifications")) return jsonResponse([]);
      return jsonResponse([]);
    }));
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "submit", subject: "@definitivefi", role: "team", whatsWrong: "The funding total is stale.",
      email: "kyle@definitive.fi", verificationId: VERIFICATION_ID,
    }) as never, response as never);
    expect(captured.status).toBe(403);
  });

  it("records a verified team challenge, spends the verification once, and routes the learning note", async () => {
    const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, method, body });
      if (url.includes("challenge_verifications") && method === "GET") {
        return jsonResponse([{
          id: VERIFICATION_ID, email: "kyle@definitive.fi", subject_ref: "@definitivefi",
          verified_at: "2026-09-17T12:00:00Z", consumed_at: null, expires_at: "2126-01-01T00:00:00Z",
        }]);
      }
      if (url.includes("report_challenges") && method === "POST") return jsonResponse([{ id: "cccccccc-0000-4000-8000-000000000001" }]);
      return jsonResponse([]);
    }));
    vi.stubEnv("ARGUS_ADMIN_EMAIL", "admin@argus.example");
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "submit", subject: "@definitivefi", reportVersionId: REPORT_VERSION_ID, context: "Funding total",
      role: "team", whatsWrong: "The funding total is stale.", whereWrong: "The system trusted a 2024 aggregator row over the dated press release.",
      email: "kyle@definitive.fi", verificationId: VERIFICATION_ID, files: [],
    }) as never, response as never);
    expect(captured.body).toMatchObject({ ok: true, emailVerified: true });

    const consume = calls.find((call) => call.method === "PATCH" && call.url.includes("challenge_verifications"));
    expect(consume?.body.consumed_at).toBeDefined();
    const insert = calls.find((call) => call.method === "POST" && call.url.includes("report_challenges"))!;
    expect(insert.body).toMatchObject({ challenger_role: "team", email_verified: true, whats_wrong: "The funding total is stale." });
    const learning = calls.filter((call) => call.url.includes("api.resend.com"))
      .map((call) => String(call.body.subject));
    expect(learning.some((subject) => subject.includes("system learning"))).toBe(true);
  });

  it("records a community challenge without any email machinery", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      if (String(input).includes("report_challenges")) return jsonResponse([{ id: "cccccccc-0000-4000-8000-000000000002" }]);
      return jsonResponse([]);
    }));
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "submit", subject: "@definitivefi", role: "community", whatsWrong: "The team section misses the CTO.",
    }) as never, response as never);
    expect(captured.body).toMatchObject({ ok: true, emailVerified: false });
    expect(calls.some((call) => call.url.includes("challenge_verifications"))).toBe(false);
  });

  it("rejects an attachment set that violates the caps", async () => {
    const { captured, response } = responseCapture();
    await handler(request("POST", {
      action: "submit", subject: "@definitivefi", role: "community", whatsWrong: "See files.",
      files: [{ name: "run.exe", type: "application/x-msdownload", dataUrl: "data:application/x-msdownload;base64,AAAA" }],
    }) as never, response as never);
    expect(captured.status).toBe(400);
  });
});

describe("confirm link", () => {
  it("verifies a live token once and refuses expired or consumed ones, without bearer auth", async () => {
    const token = "a".repeat(64);
    const rows: Record<string, unknown>[] = [{
      id: VERIFICATION_ID, expires_at: "2126-01-01T00:00:00Z", verified_at: null, consumed_at: null, email_domain: "definitive.fi",
    }];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return jsonResponse(rows);
      return jsonResponse([]);
    }));
    const { captured, response } = responseCapture();
    await handler(request("GET", {}, { action: "confirm", token }) as never, response as never);
    expect(captured.status).toBe(200);
    expect(captured.text).toContain("Verified");
    expect(harness.requireArgusAuth).not.toHaveBeenCalled();

    rows[0].consumed_at = "2026-09-17T13:00:00Z";
    const second = responseCapture();
    await handler(request("GET", {}, { action: "confirm", token }) as never, second.response as never);
    expect(second.captured.status).toBe(410);
  });
});
