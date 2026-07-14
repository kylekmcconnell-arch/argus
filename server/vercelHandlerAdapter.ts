import type { IncomingMessage, ServerResponse } from "node:http";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_BODY_BYTES = 16 * 1024;

export type VercelStyleHandler = (
  req: VercelRequest,
  res: VercelResponse,
) => void | Promise<void>;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const rawChunk of req) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function serveVercelHandler(
  req: IncomingMessage,
  res: ServerResponse,
  handler: VercelStyleHandler,
): Promise<void> {
  let body: string;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "request_too_large" }));
    return;
  }

  let statusCode = 200;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      res.setHeader(name, value);
      return response;
    },
    json(value: unknown) {
      res.statusCode = statusCode;
      if (!res.hasHeader("content-type")) res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(value));
      return response;
    },
  } as unknown as VercelResponse;

  const request = Object.assign(req, { body: body || undefined }) as VercelRequest;
  await handler(request, response);
}
