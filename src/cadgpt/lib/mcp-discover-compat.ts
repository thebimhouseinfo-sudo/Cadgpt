/**
 * Compatibility shim for MCP 2026-07-28 clients probing a legacy/stateful
 * MCP SDK v1 server.
 *
 * Modern clients may send stateless server/discover before falling back to
 * the legacy initialize handshake. Return JSON-RPC MethodNotFound over HTTP
 * 200 without creating a session.
 */

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: -32601;
    message: string;
  };
}

function requestId(body: unknown): string | number | null {
  if (typeof body !== "object" || body === null || !("id" in body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

export function isServerDiscoverRequest(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return (body as { method?: unknown }).method === "server/discover";
}

export function buildLegacyDiscoverFallback(body: unknown): JsonRpcErrorResponse | null {
  if (!isServerDiscoverRequest(body)) return null;
  return {
    jsonrpc: "2.0",
    id: requestId(body),
    error: {
      code: -32601,
      message: 'method not found: "server/discover"',
    },
  };
}
