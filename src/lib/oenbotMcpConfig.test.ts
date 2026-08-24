// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in Cursor MCP client config.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mcp = JSON.parse(
  readFileSync(new URL("../../.cursor/mcp.json", import.meta.url), "utf8"),
) as {
  mcpServers?: {
    oenbot?: {
      url?: string;
      command?: string;
      headers?: Record<string, string>;
    };
  };
};

describe("Cursor OENBOT MCP client", () => {
  it("points at /api/mcp with Access service-token env placeholders", () => {
    const server = mcp.mcpServers?.oenbot;
    expect(server?.url).toBe("https://oenbot.com/api/mcp");
    expect(server?.url).not.toBe("https://oenbot.com/mcp");
    expect(server?.command).toBeUndefined();
    expect(server?.headers?.["CF-Access-Client-Id"]).toBe(
      "${env:OENBOT_CLOUD_AGENT_ACCESS_CLIENT_ID}",
    );
    expect(server?.headers?.["CF-Access-Client-Secret"]).toBe(
      "${env:OENBOT_CLOUD_AGENT_ACCESS_CLIENT_SECRET}",
    );
    for (const value of Object.values(server?.headers ?? {})) {
      expect(value).toMatch(/^\$\{env:[A-Z0-9_]+\}$/u);
    }
  });
});
