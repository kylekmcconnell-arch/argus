import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import type { CheckObservation, CollectContext } from "./types";
import { collectProfilePhoto, fetchTrustedProfileImage } from "./profilePhoto";

const imageBytes = new Uint8Array(300).map((_, index) => index % 251);
imageBytes.set([0xff, 0xd8, 0xff], 0);
const imageHash = createHash("sha256").update(imageBytes).digest("hex");

function context(): { ctx: CollectContext; checks: CheckObservation[] } {
  const evidence = emptyEvidence("@alice");
  evidence.profile.avatar_source_state = "resolved";
  evidence.profile.avatar_url = "https://pbs.twimg.com/profile_images/123/avatar.jpg";
  const checks: CheckObservation[] = [];
  return {
    checks,
    ctx: {
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: (observation) => checks.push(observation),
    },
  };
}

function imageResponse(headers: Record<string, string> = {}) {
  return new Response(imageBytes, {
    status: 200,
    headers: { "content-type": "image/jpeg", ...headers },
  });
}

function visionResponse(input: Record<string, unknown>) {
  return new Response(JSON.stringify({
    content: [{ type: "tool_use", name: "record_profile_photo", input }],
    usage: { input_tokens: 100, output_tokens: 20 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("frozen profile-photo integrity collector", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retains the exact inspected bytes and hashes a conclusive visual result", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(visionResponse({
        classification: "real_candid",
        confidence: 0.91,
        is_real_person: true,
        flag: false,
        tells: ["natural background"],
        note: "A visually plausible personal photograph.",
      })));
    const { ctx, checks } = context();

    const attempt = await collectProfilePhoto(ctx);

    expect(attempt.status).toBe("succeeded");
    expect(ctx.evidence.profileAuthenticity).toMatchObject({
      classification: "real_candid",
      confidence: 0.91,
      flag: false,
      imageContentHash: imageHash,
      mediaType: "image/jpeg",
    });
    expect(ctx.evidence.profileAuthenticity?.imageData).toBe(
      `data:image/jpeg;base64,${Buffer.from(imageBytes).toString("base64")}`,
    );
    expect(ctx.evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      kind: "profile_photo",
      provider: "claude-vision",
      sourceContentHash: imageHash,
      match: "observed",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      id: "profile-photo-authenticity",
      status: "checked-empty",
    }));
  });

  it("derives a review lead from the validated classification, never a contradictory model flag", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(visionResponse({
        classification: "ai_generated",
        confidence: 0.94,
        is_real_person: true,
        flag: false,
        tells: ["warped earring", "melted background"],
        note: "Visible synthetic-image indicators warrant review.",
      })));
    const { ctx, checks } = context();

    await collectProfilePhoto(ctx);

    expect(ctx.evidence.profileAuthenticity).toMatchObject({ classification: "ai_generated", flag: true });
    expect(ctx.evidence.profile.identity_confidence).toBe("Unverified");
    expect(ctx.evidence.findings).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({
      id: "profile-photo-authenticity",
      status: "finding",
      note: expect.stringContaining("not identity proof"),
    }));
  });

  it("fails closed for low-confidence or unclear model output", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(visionResponse({
        classification: "studio_or_stock",
        confidence: 0.42,
        is_real_person: true,
        flag: true,
        tells: [],
        note: "The image is ambiguous.",
      })));
    const { ctx, checks } = context();

    const attempt = await collectProfilePhoto(ctx);

    expect(attempt.status).toBe("partial");
    expect(ctx.evidence.profileAuthenticity?.flag).toBe(false);
    expect(ctx.evidence.sourceArtifacts[0]).toMatchObject({ match: "candidate" });
    expect(checks).toContainEqual(expect.objectContaining({ status: "unavailable" }));
  });

  it("does not turn provider or schema failures into a clean conclusion", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(visionResponse({
        classification: "real_candid",
        confidence: 2,
        is_real_person: true,
        flag: false,
        tells: [],
        note: "Invalid confidence.",
      })));
    const { ctx, checks } = context();

    const attempt = await collectProfilePhoto(ctx);

    expect(attempt.status).toBe("failed");
    expect(ctx.evidence.profileAuthenticity).toBeUndefined();
    expect(ctx.evidence.sourceArtifacts).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ status: "unavailable" }));
  });

  it("records an explicit official no-photo response without requiring vision", async () => {
    const { ctx, checks } = context();
    ctx.evidence.profile.avatar_source_state = "none";
    delete ctx.evidence.profile.avatar_url;
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const attempt = await collectProfilePhoto(ctx);

    expect(attempt.status).toBe("succeeded");
    expect(fetcher).not.toHaveBeenCalled();
    expect(ctx.evidence.profileAuthenticity).toMatchObject({
      provider: "twitterapi",
      classification: "no_photo",
      flag: false,
    });
    expect(checks).toContainEqual(expect.objectContaining({ status: "checked-empty" }));
  });
});

describe("trusted profile-image acquisition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    "http://pbs.twimg.com/avatar.jpg",
    "https://user:pass@pbs.twimg.com/avatar.jpg",
    "https://pbs.twimg.com:444/avatar.jpg",
    "https://127.0.0.1/avatar.jpg",
    "https://example.com/avatar.jpg",
  ])("rejects an untrusted image URL before fetching: %s", async (url) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(await fetchTrustedProfileImage(url)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects redirects away from trusted Twitter image hosts", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    }));
    vi.stubGlobal("fetch", fetcher);

    expect(await fetchTrustedProfileImage("https://pbs.twimg.com/avatar.jpg")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects non-images and oversized bodies", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("not an image", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(imageResponse({ "content-length": "750001" }));
    vi.stubGlobal("fetch", fetcher);

    expect(await fetchTrustedProfileImage("https://pbs.twimg.com/first.jpg")).toBeNull();
    expect(await fetchTrustedProfileImage("https://pbs.twimg.com/second.jpg")).toBeNull();
  });
});
