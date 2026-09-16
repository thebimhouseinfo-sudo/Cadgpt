import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { getRepoRoot } from "../lib/path-security.js";

export interface CadUpstreamStatus {
  enabled: boolean;
  connected: boolean;
  tool_count: number;
  pid: number | null;
  last_error: string | null;
  python: string;
  entry: string;
}

class CadUpstream {
  private enabled = false;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Tool[] = [];
  private lastError: string | null = null;
  private connecting: Promise<void> | null = null;

  private get python(): string {
    return process.env.CAD_MCP_PYTHON || path.join(".venv-cad", "Scripts", "python.exe");
  }

  private get entry(): string {
    return process.env.CAD_MCP_ENTRY || path.join("runtimes", "cad-mcp", "main.py");
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
    this.enabled = true;
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

  async deactivate(): Promise<void> {
    this.enabled = false;
    await this.shutdown();
    this.lastError = null;
  }

  async connect(force = false): Promise<void> {
    if (!this.enabled) {
      throw new Error("CAD MCP is sleeping because AutoCAD is not currently detected. Start AutoCAD and open a drawing first.");
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
      enabled: this.enabled,
      connected: Boolean(this.client && this.transport),
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
