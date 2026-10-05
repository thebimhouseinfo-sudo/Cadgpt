import test from "node:test";
import assert from "node:assert/strict";

test("production MCP stable surface registers all Job/runtime helper capabilities before connect", async () => {
  const {
    createMcpServer,
    disposeMcpServerRuntime,
  } = await import(
    "../dist/cadgpt/server-factory.js"
  );

  const server = createMcpServer(
    "tool-surface-contract"
  );

  try {
    const registered =
      Object.keys(
        server._registeredTools ?? {}
      ).sort();

    const required = [
      "drawing_job_result_location",
      "drawing_metadata_location",
      "human_power_start",
      "human_power_status",
      "human_power_stop",
      "file_delete",
      "job_dynamic_lisp_patch",
      "job_dynamic_lisp_prepare",
      "job_local_compat_mark_checked",
      "job_local_compat_status",
      "job_runtime_finish",
      "job_runtime_prepare",
      "job_system_acquire",
      "job_system_release",
    ];

    for (const tool of required) {
      assert.ok(
        registered.includes(tool),
        `missing stable production tool: ${tool}`
      );
    }
  } finally {
    await disposeMcpServerRuntime(
      server,
      { preserveSessionState: true }
    );
  }
});
