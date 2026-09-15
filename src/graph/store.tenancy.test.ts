import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphContribution } from "./network";
import {
  clearGraphStoreForSignOut,
  getContributions,
  graphStoreOrganization,
  hydrateCommunityGraph,
  recordContribution,
  setGraphStoreOrganization,
} from "./store";

const store = new Map<string, string>();

function contribution(handle: string): GraphContribution {
  return {
    handle,
    nodes: [{ type: "Person", key: handle, subject: true }],
    edges: [],
  };
}

function stubFetch(remote: GraphContribution[] = []) {
  const posts: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ available: true, contributions: remote }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return posts;
}

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  clearGraphStoreForSignOut();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("organization-scoped browser graph cache", () => {
  it("stamps every recorded contribution with the bound organization and keys the cache by it", () => {
    stubFetch();
    setGraphStoreOrganization("org-a");
    recordContribution(contribution("@alice"));

    expect([...store.keys()]).toEqual(["argus:graphstore:org-a"]);
    const rows = JSON.parse(store.get("argus:graphstore:org-a")!) as Array<{ handle: string; organizationId?: string }>;
    expect(rows).toEqual([expect.objectContaining({ handle: "@alice", organizationId: "org-a" })]);
    expect(getContributions().map((c) => c.handle)).toEqual(["@alice"]);
  });

  it("never lets one organization's cached rows be read or backfilled into another organization", async () => {
    stubFetch();
    setGraphStoreOrganization("org-a");
    recordContribution(contribution("@org_a_subject"));

    // Sign-out on a shared machine, then a member of another org signs in.
    clearGraphStoreForSignOut();
    expect(graphStoreOrganization()).toBeNull();
    expect(store.has("argus:graphstore:org-a")).toBe(false);

    const posts = stubFetch([contribution("@org_b_remote")]);
    setGraphStoreOrganization("org-b");
    await hydrateCommunityGraph();

    expect(getContributions().map((c) => c.handle)).toEqual(["@org_b_remote"]);
    expect(posts).toEqual([]);
  });

  it("backfills only rows stamped with the current organization, even if another tenant's rows are in the slot", async () => {
    // A row written under org-a somehow sitting in org-b's slot (a hand edit,
    // or a client from before stamping) is not org-b's to backfill.
    store.set("argus:graphstore:org-b", JSON.stringify([
      { ...contribution("@leaked_from_a"), organizationId: "org-a" },
      { ...contribution("@unstamped") },
      { ...contribution("@org_b_local"), organizationId: "org-b" },
    ]));
    const posts = stubFetch([]);
    setGraphStoreOrganization("org-b");
    await hydrateCommunityGraph();

    expect(getContributions().map((c) => c.handle)).toEqual(["@org_b_local"]);
    expect(posts.map((p) => p.handle)).toEqual(["@org_b_local"]);
    expect(posts[0]).not.toHaveProperty("organizationId");
  });

  it("ignores the pre-tenancy unscoped cache and drops it once an organization binds", async () => {
    store.set("argus:graphstore", JSON.stringify([contribution("@legacy")]));
    const posts = stubFetch([]);
    setGraphStoreOrganization("org-a");
    await hydrateCommunityGraph();

    expect(getContributions()).toEqual([]);
    expect(posts).toEqual([]);
    expect(store.has("argus:graphstore")).toBe(false);
  });

  it("re-hydrates for the new organization when the bound organization changes", async () => {
    stubFetch([contribution("@remote_a")]);
    setGraphStoreOrganization("org-a");
    await hydrateCommunityGraph();
    expect(getContributions().map((c) => c.handle)).toEqual(["@remote_a"]);

    stubFetch([contribution("@remote_b")]);
    setGraphStoreOrganization("org-b");
    expect(getContributions()).toEqual([]);
    await hydrateCommunityGraph();
    expect(getContributions().map((c) => c.handle)).toEqual(["@remote_b"]);
  });

  it("does nothing while no organization is bound", async () => {
    const posts = stubFetch([contribution("@remote")]);
    recordContribution(contribution("@unbound"));
    await hydrateCommunityGraph();

    expect(getContributions()).toEqual([]);
    expect([...store.keys()]).toEqual([]);
    // The server still scopes a live contribution to the authenticated org.
    expect(posts.map((p) => p.handle)).toEqual(["@unbound"]);
  });
});
