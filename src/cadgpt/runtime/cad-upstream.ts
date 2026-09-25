import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { getRepoRoot } from "../lib/path-security.js";

export type CadUpstreamPhase = "sleeping" | "prepare" | "active";

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

class CadUpstream {
  private phase: CadUpstreamPhase = "sleeping";
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private lastError: string | null = null;
  private connecting: Promise<void> | null = null;

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
      this.rememberError(error);
      await this.shutdown();
      throw error;
    }
  }

  async prepare(): Promise<{ host: unknown; drawings: unknown }> {
    this.phase = "prepare";
    try {
      await this.connect();
      if (!this.client) throw new Error("CAD MCP client did not connect");
      const host = await this.client.callTool({
        name: "cad_host_status",
        arguments: {},
      });
      const drawings = await this.client.callTool({
        name: "acad_list_open_documents",
        arguments: {},
      });
      this.lastError = null;
      return { host, drawings };
    } catch (error) {
      this.rememberError(error);
      await this.shutdown();
      this.phase = "sleeping";
      throw error;
    }
  }

  promotePreparedToActive(): void {
    if (this.phase === "prepare" && this.client && this.transport) {
      this.phase = "active";
    }
  }

  async deactivate(): Promise<void> {
    this.phase = "sleeping";
    await this.shutdown();
    this.lastError = null;
  }

  async connect(force = false): Promise<void> {
    if (this.phase === "sleeping") {
      throw new Error("CAD MCP is sleeping. It may be prepared for read-only launch discovery or activated by CAD work; AutoCAD must already be running.");
    }
    if (this.client && this.transport && !force) return;
    if (this.connecting && !force) return this.connecting;
    if (force) await this.shutdown();

    this.connecting = (async () => {
      const client = new Client({ name: "cadgpt-cad-upstream", version: "0.1.0" });
      const transport = new StdioClientTransport({
        command: this.python,
        args: [this.entry],
        cwd: getRepoRoot(),
        stderr: "pipe",
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
        this.lastError = null;
        console.log(`[CAD MCP] connected; ${this.tools.length} tool(s) discovered`);
      } catch (error) {
        await transport.close().catch(() => undefined);
        this.rememberError(error);
        throw error;
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

    try {
      return await this.client.callTool({ name, arguments: args });
    } catch (error) {
      const message = this.rememberError(error);
      await this.shutdown();
      throw new Error(`CAD MCP call '${name}' failed; upstream was reset and will reconnect on the next call while AutoCAD remains active. Original error: ${message}`);
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
    if (transport) await transport.close().catch(() => undefined);
  }
}

export const cadUpstream = new CadUpstream();
