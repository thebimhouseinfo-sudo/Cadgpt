import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { getRepoRoot } from "../lib/path-security.js";
import {
  currentHumanPower,
  currentToolLease,
} from "../lib/work-registration.js";

export type CadUpstreamPhase = "sleeping" | "active";

export interface CadUpstreamStatus {
  enabled: boolean;
  connected: boolean;
  phase: CadUpstreamPhase;
  tool_count: number;
  pid: number | null;
  last_error: string | null;
  python: string;
  entry: string;
}

const STDERR_TAIL_MAX = 16 * 1024;

function appendStderrTail(current: string, chunk: unknown): string {
  const text =
    typeof chunk === "string"
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk ?? "");
  const next = current + text;
  return next.length <= STDERR_TAIL_MAX
    ? next
    : next.slice(next.length - STDERR_TAIL_MAX);
}

function enrichCadError(error: unknown, stderrTail: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = stderrTail.trim();
  if (!stderr || message.includes(stderr)) {
    return error instanceof Error ? error : new Error(message);
  }
  return new Error(`${message}\nCAD MCP stderr:\n${stderr}`, {
    cause: error instanceof Error ? error : undefined,
  });
}

/** Keep CAD MCP alive across ordinary Job transitions; isolate Human Power. */
export function shouldResetCadUpstreamForContext(input: {
  connected: boolean;
  requestedExecutionId: string | null;
  requestedHumanPower: boolean;
  connectedExecutionId: string | null;
  connectedHumanPower: boolean;
}): boolean {
  if (!input.connected || !input.requestedExecutionId) return false;
  if (input.connectedHumanPower !== input.requestedHumanPower) return true;
  return input.requestedHumanPower &&
    input.connectedExecutionId !== null &&
    input.connectedExecutionId !== input.requestedExecutionId;
}

class CadUpstream {
  private phase: CadUpstreamPhase = "sleeping";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private lastError: string | null = null;
  private connecting: Promise<void> | null = null;
  private connectedExecutionId: string | null = null;
  private connectedHumanPower = false;

  private get python(): string {
    const configured =
      process.env.CAD_MCP_PYTHON ||
      path.join(".venv-cad", "Scripts", "python.exe");
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(getRepoRoot(), configured);
  }

  private get entry(): string {
    const configured =
      process.env.CAD_MCP_ENTRY ||
      path.join("runtimes", "cad-mcp", "main.py");
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(getRepoRoot(), configured);
  }

  private rememberError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    return message;
  }

  cachedTools(): Tool[] {
    return [...this.tools];
  }

  async activate(): Promise<Tool[]> {
    this.phase = "active";
    try {
      await this.connect();
      if (!this.client) throw new Error("CAD MCP client did not connect");
      const listed = await this.client.listTools();
      this.tools = listed.tools ?? [];
      this.lastError = null;
      return [...this.tools];
    } catch (error) {
      this.phase = "sleeping";
      this.rememberError(error);
      await this.shutdown();
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    this.phase = "sleeping";
    await this.shutdown();
    this.lastError = null;
  }

  async connect(force = false): Promise<void> {
    if (this.phase === "sleeping") {
      throw new Error("CAD MCP is sleeping. It activates only after confirmed CAD work; AutoCAD must already be running.");
    }

    let requestedExecutionId: string | null = null;
    let requestedHumanPower = false;
    try {
      const lease = currentToolLease();
      requestedExecutionId = lease.workId;
      requestedHumanPower = Boolean(currentHumanPower());
    } catch {
      requestedExecutionId = null;
      requestedHumanPower = false;
    }

    // In normal (non-Human-Power) work, the Python CAD MCP process is
    // execution-independent. Reusing it avoids costly process respawns on
    // every Job/chat handoff. Human Power is execution-scoped and MUST still
    // restart the process on mode or owning-execution changes.
    const contextChanged = shouldResetCadUpstreamForContext({
      connected: Boolean(this.client && this.transport),
      requestedExecutionId,
      requestedHumanPower,
      connectedExecutionId: this.connectedExecutionId,
      connectedHumanPower: this.connectedHumanPower,
    });
    if (contextChanged) {
      await this.shutdown();
    }

    if (this.client && this.transport && !force) return;
    if (this.connecting && !force) return this.connecting;
    if (force) await this.shutdown();

    this.connecting = (async () => {
      const connectionStartedAt = Date.now();
      const client = new Client({
        name: "cadgpt-cad-upstream",
        version: "0.1.0",
      });
      const humanPower = currentHumanPower();
      let humanPowerExecutionId = "";
      if (humanPower) {
        try {
          humanPowerExecutionId = currentToolLease().workId;
        } catch {
          humanPowerExecutionId = "";
        }
      }
      const childEnv = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string"
        )
      );
      childEnv.CADGPT_HUMAN_POWER = humanPower ? "1" : "0";
      if (humanPowerExecutionId) {
        childEnv.CADGPT_HUMAN_POWER_EXECUTION_ID =
          humanPowerExecutionId;
      } else {
        delete childEnv.CADGPT_HUMAN_POWER_EXECUTION_ID;
      }
      const transport = new StdioClientTransport({
        command: this.python,
        args: [this.entry],
        cwd: getRepoRoot(),
        env: childEnv,
        stderr: "pipe",
      });
      let stderrTail = "";
      const stderr = transport.stderr;
      stderr?.on("data", (chunk) => {
        stderrTail = appendStderrTail(stderrTail, chunk);
        const text = Buffer.isBuffer(chunk)
          ? chunk.toString("utf8")
          : String(chunk ?? "");
        if (text.trim()) {
          console.error("[CAD MCP stderr]", text.trimEnd());
        }
      });

      const timeoutMs = Math.max(1000, Number(process.env.CAD_MCP_CONNECT_TIMEOUT_MS || 15000));
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(transport),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`CAD MCP connection timed out after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);
        const listed = await client.listTools();
        this.client = client;
        this.transport = transport;
        this.tools = listed.tools ?? [];
        this.connectedExecutionId = requestedExecutionId;
        this.connectedHumanPower = requestedHumanPower;
        this.lastError = null;
        console.log(`[CAD MCP] connected; ${this.tools.length} tool(s) discovered`);
        const connectMs = Date.now() - connectionStartedAt;
        if (connectMs >= 3000) {
          console.warn(`[CAD LATENCY] upstream_connect_ms=${connectMs}`);
        }
      } catch (error) {
        await transport.close().catch(() => undefined);
        const enriched = enrichCadError(error, stderrTail);
        this.rememberError(enriched);
        throw enriched;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async listTools(force = false): Promise<Tool[]> {
    try {
      await this.connect(force);
      if (force && this.client) {
        const listed = await this.client.listTools();
        this.tools = listed.tools ?? [];
      }
      return [...this.tools];
    } catch (error) {
      this.rememberError(error);
      await this.shutdown();
      throw error;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    if (!this.client) throw new Error("CAD MCP client is not connected");

    const callStartedAt = Date.now();
    try {
      return await this.client.callTool({ name, arguments: args });
    } catch (error) {
      const message = this.rememberError(error);
      await this.shutdown();
      throw new Error(`CAD MCP call '${name}' failed; upstream was reset and will reconnect on the next call while AutoCAD remains active. Original error: ${message}`);
    } finally {
      const callMs = Date.now() - callStartedAt;
      if (callMs >= 5000) {
        // Instrument real upstream delay without logging tool arguments or
        // CAD entity data. The tool name is a declared MCP capability.
        console.warn(`[CAD LATENCY] upstream_tool=${name} rpc_ms=${callMs}`);
      }
    }
  }

  status(): CadUpstreamStatus {
    const transportWithPid = this.transport as (StdioClientTransport & { pid?: number }) | null;
    return {
      enabled: this.phase !== "sleeping",
      connected: Boolean(this.client && this.transport),
      phase: this.phase,
      tool_count: this.tools.length,
      pid: transportWithPid?.pid ?? null,
      last_error: this.lastError,
      python: this.python,
      entry: this.entry,
    };
  }

  async shutdown(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.connectedExecutionId = null;
    this.connectedHumanPower = false;
    if (transport) await transport.close().catch(() => undefined);
  }
}

export const cadUpstream = new CadUpstream();
