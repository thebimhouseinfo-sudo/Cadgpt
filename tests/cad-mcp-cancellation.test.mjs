import test from "node:test";
import assert from "node:assert/strict";

test("long CAD tools bypass the MCP SDK's 60-second request cancellation", async () => {
  const { cadUpstream, CAD_MCP_TOOL_REQUEST_TIMEOUT_MS } = await import(
    "../dist/cadgpt/runtime/cad-upstream.js"
  );
  const originalConnect = cadUpstream.connect;
  const originalClient = cadUpstream.client;
  const originalPhase = cadUpstream.phase;
  let called = null;
  try {
    cadUpstream.phase = "active";
    cadUpstream.connect = async () => {};
    cadUpstream.client = {
      callTool: async (params, schema, options) => {
        called = { params, schema, options };
        return { content: [{ type: "text", text: "ok" }] };
      },
    };

    const result = await cadUpstream.callTool("cad_load_lisp", { path: "approved.lsp" });
    assert.equal(result.content[0].text, "ok");
    assert.equal(called.params.name, "cad_load_lisp");
    assert.equal(called.schema, undefined, "SDK 1.30 request options are the third argument");
    assert.equal(called.options.timeout, CAD_MCP_TOOL_REQUEST_TIMEOUT_MS);
    assert.equal(CAD_MCP_TOOL_REQUEST_TIMEOUT_MS, 2147483647);
  } finally {
    cadUpstream.connect = originalConnect;
    cadUpstream.client = originalClient;
    cadUpstream.phase = originalPhase;
  }
});
