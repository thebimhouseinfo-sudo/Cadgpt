import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLegacyDiscoverFallback,
  isServerDiscoverRequest,
} from "../dist/cadgpt/lib/mcp-discover-compat.js";

test("server/discover returns stateless MethodNotFound fallback", () => {
  const body = { jsonrpc: "2.0", id: 7, method: "server/discover", params: {} };
  assert.equal(isServerDiscoverRequest(body), true);
  assert.deepEqual(buildLegacyDiscoverFallback(body), {
    jsonrpc: "2.0",
    id: 7,
    error: {
      code: -32601,
      message: 'method not found: "server/discover"',
    },
  });
});

test("non-discover requests are untouched", () => {
  const body = { jsonrpc: "2.0", id: 8, method: "initialize", params: {} };
  assert.equal(isServerDiscoverRequest(body), false);
  assert.equal(buildLegacyDiscoverFallback(body), null);
});
