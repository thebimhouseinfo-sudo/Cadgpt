#!/usr/bin/env node

/**
 * Legacy compatibility entrypoint.
 *
 * CadGPT no longer has a separate polling wake-agent/full-core split. The
 * always-on process is the slim admission/control MCP in index.ts. Keeping this
 * shim prevents an old local Scheduled Task or shortcut from resurrecting the
 * former AutoCAD-polling behavior during migration.
 */
console.warn(
  "[CadGPT] dist/wake-agent.js is deprecated; starting the slim admission/control plane instead."
);
await import("./index.js");
