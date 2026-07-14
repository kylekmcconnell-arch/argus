import { describe, expect, it } from "vitest";
import { authEnvironmentErrors } from "./authEnvContract";

const production = {
  VERCEL_ENV: "production",
  SUPABASE_URL: "https://project.supabase.co",
  VITE_SUPABASE_URL: "https://project.supabase.co/",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_same",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_same",
  SUPABASE_SECRET_KEY: "sb_secret_server_only",
  ARGUS_APP_ORIGIN: "https://argus.example",
  VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP: "false",
};

describe("production auth environment contract", () => {
  it("accepts one Supabase project with bootstrap disabled", () => {
    expect(authEnvironmentErrors(production)).toEqual([]);
  });

  it("fails closed when browser and server projects differ", () => {
    expect(authEnvironmentErrors({
      ...production,
      VITE_SUPABASE_URL: "https://other.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_other",
    })).toEqual(expect.arrayContaining([
      "server and browser Supabase URLs must use the same project",
      "server and browser Supabase publishable keys must match",
    ]));
  });

  it("requires server credentials and forbids production bootstrap", () => {
    expect(authEnvironmentErrors({
      ...production,
      SUPABASE_SECRET_KEY: "",
      VITE_ARGUS_ALLOW_BOOTSTRAP_SIGNUP: "true",
    })).toEqual(expect.arrayContaining([
      "a server-only Supabase credential is required",
      "bootstrap signup must be disabled in production",
    ]));
  });

  it("rejects a server credential anywhere in the browser key path", () => {
    expect(authEnvironmentErrors({
      ...production,
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_leaked",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_leaked",
      SUPABASE_SECRET_KEY: "sb_secret_leaked",
    })).toEqual(expect.arrayContaining([
      "SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential",
      "VITE_SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential",
      "the browser Supabase key must not match a server-only credential",
    ]));
  });

  it("rejects a legacy service-role JWT as a publishable key", () => {
    const payload = globalThis.btoa(JSON.stringify({ role: "service_role" }));
    const serviceRoleJwt = `header.${payload}.signature`;
    expect(authEnvironmentErrors({
      ...production,
      SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
      VITE_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
    })).toEqual(expect.arrayContaining([
      "SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential",
      "VITE_SUPABASE_PUBLISHABLE_KEY must not contain a server-only credential",
    ]));
  });

  it("rejects Supabase URLs that contain a path, query, or fragment", () => {
    expect(authEnvironmentErrors({
      ...production,
      SUPABASE_URL: "https://project.supabase.co/rest/v1",
      VITE_SUPABASE_URL: "https://project.supabase.co/?leak=true",
      ARGUS_APP_ORIGIN: "https://argus.example/#fragment",
    })).toEqual(expect.arrayContaining([
      "SUPABASE_URL must be a valid HTTPS origin",
      "VITE_SUPABASE_URL must be a valid HTTPS origin",
      "ARGUS_APP_ORIGIN must be a valid HTTPS origin",
    ]));
  });

  it("does not block a deliberately unconfigured local build", () => {
    expect(authEnvironmentErrors({ VERCEL_ENV: "development" })).toEqual([]);
  });
});
