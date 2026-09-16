import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveAllowedPath, toRepoRelative } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

export interface LispDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface LispValidationResult {
  valid: boolean;
  sha256: string;
  bytes: number;
  lines: number;
  commands: string[];
  functions: string[];
  diagnostics: LispDiagnostic[];
  stats: {
    paren_pairs: number;
    max_depth: number;
    uses_com: boolean;
    uses_command: boolean;
    uses_setvar: boolean;
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
}

function extractDefuns(clean: string): { commands: string[]; functions: string[] } {
  const functions: string[] = [];
  const commands: string[] = [];
  const regex = /\(\s*defun\s+([^\s()]+)/gi;
  for (const match of clean.matchAll(regex)) {
    const symbol = match[1];
    functions.push(symbol);
    if (/^c:/i.test(symbol)) commands.push(symbol.slice(2).toUpperCase());
  }
  return { commands: uniqueSorted(commands), functions: uniqueSorted(functions) };
}

/**
 * Lightweight AutoLISP reader-aware validation.
 *
 * This is intentionally not a full evaluator. It understands line comments,
 * strings/escapes, and parenthesis structure so it avoids the false positives
 * caused by raw character counting. Runtime CAD behavior is validated later by
 * load/run/postcondition gates.
 */
export function validateLispSource(source: string, expectedCommands: string[] = []): LispValidationResult {
  const diagnostics: LispDiagnostic[] = [];
  const stack: Array<{ line: number; column: number }> = [];
  let line = 1;
  let column = 0;
  let inString = false;
  let stringStart = { line: 1, column: 1 };
  let escaped = false;
  let inComment = false;
  let parenPairs = 0;
  let maxDepth = 0;
  let clean = "";

  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    column += 1;

    if (inComment) {
      if (ch === "\n") {
        inComment = false;
        clean += "\n";
        line += 1;
        column = 0;
      } else {
        clean += " ";
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        clean += " ";
      } else if (ch === "\\") {
        escaped = true;
        clean += " ";
      } else if (ch === '"') {
        inString = false;
        clean += " ";
      } else {
        clean += ch === "\n" ? "\n" : " ";
        if (ch === "\n") {
          line += 1;
          column = 0;
        }
      }
      continue;
    }

    if (ch === ";") {
      inComment = true;
      clean += " ";
      continue;
    }

    if (ch === '"') {
      inString = true;
      stringStart = { line, column };
      clean += " ";
      continue;
    }

    if (ch === "(") {
      stack.push({ line, column });
      maxDepth = Math.max(maxDepth, stack.length);
      clean += ch;
      continue;
    }

    if (ch === ")") {
      if (!stack.length) {
        diagnostics.push({
          severity: "error",
          code: "UNMATCHED_CLOSE_PAREN",
          message: "Closing parenthesis has no matching opening parenthesis.",
          line,
          column,
        });
      } else {
        stack.pop();
        parenPairs += 1;
      }
      clean += ch;
      continue;
    }

    clean += ch;
    if (ch === "\n") {
      line += 1;
      column = 0;
    }
  }

  if (inString) {
    diagnostics.push({
      severity: "error",
      code: "UNCLOSED_STRING",
      message: "String literal is not closed before end of file.",
      line: stringStart.line,
      column: stringStart.column,
    });
  }

  for (const opening of stack.slice(-5)) {
    diagnostics.push({
      severity: "error",
      code: "UNCLOSED_PAREN",
      message: "Opening parenthesis is not closed before end of file.",
      line: opening.line,
      column: opening.column,
    });
  }
  if (stack.length > 5) {
    diagnostics.push({
      severity: "error",
      code: "UNCLOSED_PAREN_MORE",
      message: `${stack.length - 5} additional opening parentheses are not closed.`,
    });
  }

  const { commands, functions } = extractDefuns(clean);
  const commandCounts = new Map<string, number>();
  const commandRegex = /\(\s*defun\s+c:([^\s()]+)/gi;
  for (const match of clean.matchAll(commandRegex)) {
    const command = match[1].toUpperCase();
    commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
  }
  for (const [command, count] of commandCounts) {
    if (count > 1) {
      diagnostics.push({
        severity: "error",
        code: "DUPLICATE_PUBLIC_COMMAND",
        message: `Public command ${command} is defined ${count} times in the same file.`,
      });
    }
  }

  const expected = uniqueSorted(expectedCommands.map((value) => value.toUpperCase()));
  for (const command of expected) {
    if (!commands.includes(command)) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_EXPECTED_COMMAND",
        message: `Expected public command ${command} was not found.`,
      });
    }
  }

  const usesCom = /\b(?:vla-|vlax-|vl-catch-all-apply|vlax-get-acad-object)/i.test(clean);
  const hasVlLoadCom = /\(\s*vl-load-com\s*\)/i.test(clean);
  if (usesCom && !hasVlLoadCom) {
    diagnostics.push({
      severity: "warning",
      code: "COM_WITHOUT_VL_LOAD_COM",
      message: "Visual LISP/COM APIs are used but `(vl-load-com)` was not found.",
    });
  }

  const usesSetvar = /\(\s*setvar\b/i.test(clean);
  const hasErrorHandler = /\(\s*defun\s+\*error\*/i.test(clean);
  if (usesSetvar && !hasErrorHandler) {
    diagnostics.push({
      severity: "warning",
      code: "SETVAR_WITHOUT_ERROR_HANDLER",
      message: "The file changes system variables but no local `*error*` handler was found.",
    });
  }

  const usesCommand = /\(\s*command(?:-s)?\b/i.test(clean);
  if (usesCommand) {
    diagnostics.push({
      severity: "warning",
      code: "COMMAND_API_USED",
      message: "The file uses `(command)`/`(command-s)`; verify that direct DXF/VLA APIs are not safer for this operation.",
    });
  }

  if (!commands.length) {
    diagnostics.push({
      severity: "warning",
      code: "NO_PUBLIC_COMMAND",
      message: "No `c:` public command was found. This is valid for helper/library files but should be intentional.",
    });
  }

  return {
    valid: !diagnostics.some((item) => item.severity === "error"),
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    bytes: Buffer.byteLength(source, "utf8"),
    lines: source.split(/\r?\n/).length,
    commands,
    functions,
    diagnostics,
    stats: {
      paren_pairs: parenPairs,
      max_depth: maxDepth,
      uses_com: usesCom,
      uses_command: usesCommand,
      uses_setvar: usesSetvar,
    },
  };
}

export function registerLispHarnessTools(server: McpServer): void {
  server.registerTool(
    "lisp_validate",
    {
      title: "Validate AutoLISP Source",
      description: "Run CadGPT's static AutoLISP harness against one .lsp file under lisp/** before loading it into AutoCAD.",
      inputSchema: {
        path: z.string().min(1),
        expected_commands: z.array(z.string().min(1)).max(50).optional().default([]),
      },
    },
    async ({ path: input, expected_commands }) => {
      try {
        const target = await resolveAllowedPath(input);
        const relative = toRepoRelative(target);
        if (!(relative === "lisp" || relative.startsWith("lisp/"))) {
          throw new Error("lisp_validate only accepts files under lisp/**");
        }
        if (path.extname(target).toLowerCase() !== ".lsp") {
          throw new Error("lisp_validate only accepts .lsp files");
        }
        const source = await fs.readFile(target, "utf8");
        const result = validateLispSource(source, expected_commands);
        return toolResult("lisp_validate", { path: relative, ...result }, result.valid ? "AutoLISP static validation passed" : "AutoLISP static validation failed");
      } catch (error) {
        return toolError("lisp_validate", error);
      }
    }
  );
}
