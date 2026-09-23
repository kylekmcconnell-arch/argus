import { afterEach, expect, it, vi } from "vitest";
import { withThreatNet } from "./threatRuntime";
import { apiFetch } from "../src/threat/net";
afterEach(() => vi.unstubAllGlobals());
it("isolates concurrent organizations and keeps credentials off external requests", async () => {
  const sent: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { sent.push({ url: String(url), headers: new Headers(init?.headers) }); return new Response("{}"); }));
  await Promise.all(["one", "two"].map(org => withThreatNet({ base: `https://${org}.vercel.app`, headers: { authorization: `Bearer ${org}`, "x-argus-panel-token": org } }, async () => {
    await Promise.resolve();
    await apiFetch("/api/sanctions", { headers: { "content-type": "application/json" } });
    await apiFetch("https://public.example/data");
  })));
  for (const org of ["one", "two"]) {
    const request = sent.find(row => row.url === `https://${org}.vercel.app/api/sanctions`)!;
    expect(request.headers.get("authorization")).toBe(`Bearer ${org}`);
    expect(request.headers.get("x-argus-panel-token")).toBe(org);
  }
  for (const external of sent.filter(row => row.url.startsWith("https://public.example"))) {
    expect(external.headers.has("authorization")).toBe(false);
    expect(external.headers.has("x-argus-panel-token")).toBe(false);
  }
});
it("prevents requests after deadline and disallows authenticated redirects", async () => {
  const fetcher = vi.fn(async () => new Response("{}")); vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  await withThreatNet({ base: "https://one.vercel.app", headers: { authorization: "Bearer one" }, signal: controller.signal }, async () => {
    await apiFetch("/api/sanctions");
    expect(fetcher).toHaveBeenCalledWith("https://one.vercel.app/api/sanctions", expect.objectContaining({ redirect: "error" }));
    controller.abort();
    expect(() => apiFetch("/api/code-review")).toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("runs sanctions and creator checks without a browser when authenticated transport exists", async () => {
  const { screenAddressSanctions, resolveEvmCreatorKind } = await import("../src/token/audit");
  const address = "0x1234567890abcdef1234567890abcdef12345678";
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("sanctions")
    ? { available: true, sanctioned: [address], checked: 1 }
    : { available: true, isContract: true })));
  vi.stubGlobal("fetch", fetcher);
  await withThreatNet({ base: "https://one.vercel.app", headers: { authorization: "Bearer one" } }, async () => {
    const sanctions = await screenAddressSanctions("ethereum", [address], apiFetch);
    expect(sanctions?.sanctioned).toEqual([address]);
    expect(await resolveEvmCreatorKind("ethereum", address, apiFetch)).toBe("contract");
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
