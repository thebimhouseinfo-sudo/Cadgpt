import { createHmac, randomBytes } from "node:crypto";
import type { Request } from "express";

const LOGICAL_KEY_SECRET = randomBytes(32);

function firstHeader(
  value: string | string[] | undefined
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function logicalConversationKeyFromRequest(
  req: Request
): string | null {
  const raw = firstHeader(req.headers["x-openai-session"]);
  if (!raw || !raw.trim()) return null;
  const digest = createHmac("sha256", LOGICAL_KEY_SECRET)
    .update(raw.trim(), "utf8")
    .digest("hex");
  return `openai-session:${digest}`;
}
