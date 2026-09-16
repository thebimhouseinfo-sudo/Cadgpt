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

const COMMON_LISP_ONLY_FORMS = [
  "let",
  "let*",
  "flet",
  "labels",
  "macrolet",
  "defmacro",
  "defpackage",
  "in-package",
  "defclass",
  "defgeneric",
  "defmethod",
  "loop",
  "dolist",
  "dotimes",
  "do",
  "do*",
  "setf",
  "psetf",
  "incf",
  "decf",
  "push",
  "pop",
  "multiple-value-bind",
  "multiple-value-setq",
  "handler-case",
  "unwind-protect",
  "destructuring-bind",
  "with-open-file",
  "with-output-to-string",
];

const COMMON_LISP_LAMBDA_KEYWORDS = [
  "optional",
  "rest",
  "key",
  "aux",
  "body",
  "whole",
  "environment",
];

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

function locationAt(source: string, index: number): { line: number; column: number } {
  const prefix = source.slice(0, Math.max(0, index));
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function headerField(source: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`^;;;\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return match?.[1]?.trim() || null;
}

function checkAutoLispDialect(clean: string, source: string, diagnostics: LispDiagnostic[]): void {
  for (const form of COMMON_LISP_ONLY_FORMS) {
    const escaped = form.replace("*", "\\*");
    const regex = new RegExp(`\\(\\s*${escaped}(?=[\\s()])`, "gi");
    for (const match of clean.matchAll(regex)) {
      const loc = locationAt(source, match.index ?? 0);
      diagnostics.push({
        severity: "error",
        code: "COMMON_LISP_FORM",
        message: `\`${form}\` is not an AutoLISP form. Rewrite this using AutoLISP/Visual LISP constructs.`,
        ...loc,
      });
    }
  }

  const keywordPattern = COMMON_LISP_LAMBDA_KEYWORDS.join("|");
  const keywordRegex = new RegExp(`&(?:${keywordPattern})\\b`, "gi");
  for (const match of clean.matchAll(keywordRegex)) {
    const loc = locationAt(source, match.index ?? 0);
    diagnostics.push({
      severity: "error",
      code: "COMMON_LISP_LAMBDA_KEYWORD",
      message: `\`${match[0]}\` is Common Lisp lambda-list syntax. AutoLISP declares locals after \`/\` in the defun argument list.`,
      ...loc,
    });
  }

  for (const match of clean.matchAll(/#'/g)) {
    const loc = locationAt(source, match.index ?? 0);
    diagnostics.push({
      severity: "error",
      code: "COMMON_LISP_READER_SYNTAX",
      message: "`#'` function reader shorthand is not AutoLISP syntax. Use an AutoLISP-compatible quoted symbol or `(function (lambda ...))` where appropriate.",
      ...loc,
    });
  }
}

function checkLibraryStyle(
  source: string,
  commands: string[],
  diagnostics: LispDiagnostic[],
  fileName?: string
): void {
  const hasHeaderStart = /;;;\s*TBH-HEADER-START/i.test(source);
  const hasHeaderEnd = /;;;\s*TBH-HEADER-END/i.test(source);
  if (!hasHeaderStart || !hasHeaderEnd) {
    diagnostics.push({
      severity: "error",
      code: "MISSING_TBH_HEADER",
      message: "Production AutoLISP must use the canonical TBH-HEADER-START/TBH-HEADER-END metadata block.",
    });
    return;
  }

  const fileField = headerField(source, "File");
  const moduleField = headerField(source, "Module");
  const commandField = headerField(source, "Command");
  const descriptionField = headerField(source, "Description");

  for (const [name, value] of [
    ["File", fileField],
    ["Module", moduleField],
    ["Command", commandField],
    ["Description", descriptionField],
  ] as const) {
    if (!value) {
      diagnostics.push({
        severity: "error",
        code: "MISSING_TBH_HEADER_FIELD",
        message: `TBH header is missing required \`${name}\` metadata.`,
      });
    }
  }

  if (fileName && fileField && fileField.toLowerCase() !== fileName.toLowerCase()) {
    diagnostics.push({
      severity: "warning",
      code: "HEADER_FILENAME_MISMATCH",
      message: `TBH header File is \`${fileField}\` but the repository file is \`${fileName}\`.`,
    });
  }

  if (commandField && commands.length) {
    const normalized = commandField.toUpperCase();
    for (const command of commands) {
      if (!new RegExp(`(^|[^A-Z0-9_-])${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9_-]|$)`).test(normalized)) {
        diagnostics.push({
          severity: "error",
          code: "HEADER_COMMAND_MISMATCH",
          message: `Public command ${command} is not declared in the TBH header Command field.`,
        });
      }
    }
  }

  if (commands.length && !/\[TBH\]/i.test(source)) {
    diagnostics.push({
      severity: "warning",
      code: "NO_TBH_LOAD_BANNER",
      message: "Public command file has no TBH load banner; keep new command files consistent with the library scaffold.",
    });
  }

  if (commands.length && !/\(\s*princ\s*\)\s*$/i.test(source.trim())) {
    diagnostics.push({
      severity: "warning",
      code: "NO_QUIET_FILE_END",
      message: "Public command file should normally end with a quiet `(princ)` like the TBH library scaffold.",
    });
  }

  if (/\bTODO\b/i.test(source)) {
    diagnostics.push({
      severity: "warning",
      code: "TODO_MARKER",
      message: "Source still contains TODO markers; remove or resolve them before declaring the command complete.",
    });
  }
}

/**
 * Lightweight AutoLISP reader-aware validation.
 *
 * It intentionally validates AutoLISP/Visual LISP rather than generic Lisp.
 * Comments and strings are masked before dialect/structure checks. Runtime CAD
 * behavior remains the responsibility of load/run/postcondition gates.
 */
export function validateLispSource(
  source: string,
  expectedCommands: string[] = [],
  options: { enforceLibraryStyle?: boolean; fileName?: string } = {}
): LispValidationResult {
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

  checkAutoLispDialect(clean, source, diagnostics);

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
      severity: "error",
      code: "COM_WITHOUT_VL_LOAD_COM",
      message: "Visual LISP/ActiveX APIs are used but `(vl-load-com)` was not found.",
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

  if (options.enforceLibraryStyle !== false) {
    checkLibraryStyle(source, commands, diagnostics, options.fileName);
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

function cleanCommentValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function makeScaffold(args: {
  fileName: string;
  module: string;
  command: string;
  description: string;
  mutating: boolean;
  usesCom: boolean;
}): string {
  const fileName = args.fileName.trim();
  const module = cleanCommentValue(args.module);
  const command = args.command.trim().toUpperCase();
  const description = cleanCommentValue(args.description);
  const prefix = command.toLowerCase().replace(/[^a-z0-9]/g, "") || "cmd";
  const comLine = args.usesCom ? "\n(vl-load-com)\n" : "";

  const body = args.mutating
    ? `(defun c:${command} (/ *error* cmde undo-open)\n\n  (defun *error* (errmsg)\n    (if (not (member errmsg '(\"Function cancelled\" \"quit / exit abort\" \"console break\")))\n      (princ (strcat \"\\n[Error] \" errmsg))\n    )\n    (if undo-open (command \"_.undo\" \"_end\"))\n    (if cmde (setvar 'CMDECHO cmde))\n    (princ)\n  )\n\n  (setq cmde (getvar 'CMDECHO))\n  (setvar 'CMDECHO 0)\n  (command \"_.undo\" \"_begin\")\n  (setq undo-open T)\n\n  ;; Implement command logic here.\n\n  (if undo-open\n    (progn\n      (command \"_.undo\" \"_end\")\n      (setq undo-open nil)\n    )\n  )\n  (if cmde (setvar 'CMDECHO cmde))\n  (princ \"\\n[Done] Command complete.\")\n  (princ)\n)`
    : `(defun c:${command} (/ )\n\n  ;; Implement command logic here.\n\n  (princ \"\\n[Done] Command complete.\")\n  (princ)\n)`;

  return `;;; =============================================================================\n;;; TBH-HEADER-START\n;;;\n;;; File        : ${fileName}\n;;; Module      : ${module}\n;;; Command     : ${command}\n;;; Description : ${description}\n;;;\n;;; Usage       :\n;;; 1. Run '${command}'.\n;;; 2. Follow command prompts.\n;;; TBH-HEADER-END\n;;; =============================================================================\n${comLine}\n;; =============================================================================\n;; Helpers\n;; =============================================================================\n\n;; Prefix helper functions with ${prefix}: to avoid global symbol collisions.\n\n;; =============================================================================\n;; Main command\n;; =============================================================================\n\n${body}\n\n(princ \"\\n[TBH] ${description} loaded. Type '${command}' to start.\")\n(princ)\n`;
}

export function registerLispHarnessTools(server: McpServer): void {
  server.registerTool(
    "lisp_scaffold",
    {
      title: "Create Canonical AutoLISP Scaffold",
      description: "Return the canonical TBH AutoLISP command skeleton derived from the existing library. Use this before creating a new command draft.",
      inputSchema: {
        file_name: z.string().regex(/^[^\\/]+\.lsp$/i),
        module: z.string().min(1).max(120),
        command: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
        description: z.string().min(1).max(500),
        mutating: z.boolean().optional().default(true),
        uses_com: z.boolean().optional().default(true),
      },
    },
    async ({ file_name, module, command, description, mutating, uses_com }) => {
      try {
        const content = makeScaffold({
          fileName: file_name,
          module,
          command,
          description,
          mutating,
          usesCom: uses_com,
        });
        return toolResult("lisp_scaffold", {
          file_name,
          command: command.toUpperCase(),
          content,
          next: "Create the working file under appdata/lisp-draft/**, replace implementation placeholders, then run lisp_draft_validate before CAD load/testing.",
        });
      } catch (error) {
        return toolError("lisp_scaffold", error);
      }
    }
  );

  server.registerTool(
    "lisp_validate",
    {
      title: "Validate Permanent AutoLISP Source",
      description: "Validate AutoLISP dialect, TBH library structure, command contracts, and static source safety for one permanent .lsp file under lisp/**.",
      inputSchema: {
        path: z.string().min(1),
        expected_commands: z.array(z.string().min(1)).max(50).optional().default([]),
        enforce_library_style: z.boolean().optional().default(true),
      },
    },
    async ({ path: input, expected_commands, enforce_library_style }) => {
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
        const result = validateLispSource(source, expected_commands, {
          enforceLibraryStyle: enforce_library_style,
          fileName: path.basename(target),
        });
        return toolResult(
          "lisp_validate",
          { path: relative, dialect: "AutoLISP/Visual LISP", library_style: enforce_library_style ? "TBH" : "not-enforced", ...result },
          result.valid ? "AutoLISP/TBH static validation passed" : "AutoLISP/TBH static validation failed"
        );
      } catch (error) {
        return toolError("lisp_validate", error);
      }
    }
  );
}
