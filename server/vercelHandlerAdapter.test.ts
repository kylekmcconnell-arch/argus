import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { serveVercelHandler, type VercelStyleHandler } from "./vercelHandlerAdapter";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("local Vercel handler adapter", () => {
  it("preserves the request host, origin, and JSON body for approved sign-in", async () => {
    const handler: VercelStyleHandler = async (req, res) => {
      expect(req.headers.host).toMatch(/^127\.0\.0\.1:/);
      expect(req.headers.origin).toBe(`http://${req.headers.host}`);
      expect(JSON.parse(String(req.body))).toEqual({ email: "enigma@enigma-fund.com" });
      res.status(202).json({ ok: true });
    };
    const server = createServer((req, res) => {
      void serveVercelHandler(req, res, handler);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;

    const response = await fetch(`${origin}/api/signin`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: "enigma@enigma-fund.com" }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
