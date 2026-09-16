import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { getRepoRoot } from "../lib/path-security.js";

export interface CadUpstreamStatus {
  connected: boolean;
  tool_count: number;
  pid: number | null;
  last_error: string | null;
  python: string;
  entry: string;
}

class CadUpstream {
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

  async connect(force = false): Promise<void> {
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
        this.lastError = error instanceof Error ? error.message : String(error);
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
    await this.connect(force);
    if (force && this.client) {
      const listed = await this.client.listTools();
      this.tools = listed.tools ?? [];
    }
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connect();
    if (!this.client) throw new Error("CAD MCP client is not connected");
    return this.client.callTool({ name, arguments: args });
  }

  status(): CadUpstreamStatus {
    const transportWithPid = this.transport as (StdioClientTransport & { pid?: number }) | null;
    return {
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
