import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { resolveAllowedPath, toCadgptPath } from "../lib/path-security.js";
import { toolError, toolResult } from "../lib/tool-result.js";

export type LispAuthoringProfile = "syntax" | "cadgpt" | "tbh";

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
  "let", "let*", "flet", "labels", "macrolet", "defmacro", "defpackage", "in-package",
  "defclass", "defgeneric", "defmethod", "loop", "dolist", "dotimes", "do", "do*", "setf",
  "psetf", "incf", "decf", "push", "pop", "multiple-value-bind", "multiple-value-setq",
  "handler-case", "unwind-protect", "destructuring-bind", "with-open-file", "with-output-to-string",
];
const COMMON_LISP_LAMBDA_KEYWORDS = ["optional", "rest", "key", "aux", "body", "whole", "environment"];
const REQUIRED_HEADER_FIELDS = [
  "File", "Module", "Command", "Description", "Inputs", "Effects", "Interaction",
  "Risk", "Dependencies", "Notes", "Revision",
];

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
      diagnostics.push({
        severity: "error",
        code: "COMMON_LISP_FORM",
        message: `\`${form}\` is not an AutoLISP form. Rewrite this using AutoLISP/Visual LISP constructs.`,
        ...locationAt(source, match.index ?? 0),
      });
    }
  }

  const keywordRegex = new RegExp(`&(?:${COMMON_LISP_LAMBDA_KEYWORDS.join("|")})\\b`, "gi");
  for (const match of clean.matchAll(keywordRegex)) {
    diagnostics.push({
      severity: "error",
      code: "COMMON_LISP_LAMBDA_KEYWORD",
      message: `\`${match[0]}\` is Common Lisp lambda-list syntax. AutoLISP declares locals after \`/\` in defun arguments.`,
      ...locationAt(source, match.index ?? 0),
    });
  }

  for (const match of clean.matchAll(/#'/g)) {
    diagnostics.push({
      severity: "error",
      code: "COMMON_LISP_READER_SYNTAX",
      message: "`#'` function reader shorthand is not AutoLISP syntax.",
      ...locationAt(source, match.index ?? 0),
    });
  }
}

function checkAuthoringStyle(
  source: string,
  commands: string[],
  diagnostics: LispDiagnostic[],
  profile: Exclude<LispAuthoringProfile, "syntax">,
  fileName?: string
): void {
  const brand = profile === "tbh" ? "TBH" : "CADGPT";
  const start = new RegExp(`;;;\\s*${brand}-HEADER-START`, "i");
  const end = new RegExp(`;;;\\s*${brand}-HEADER-END`, "i");
  if (!start.test(source) || !end.test(source)) {
    diagnostics.push({
      severity: "error",
      code: `MISSING_${brand}_HEADER`,
      message: `${brand} authoring profile requires the canonical ${brand}-HEADER-START/${brand}-HEADER-END metadata block.`,
    });
    return;
  }

  for (const field of REQUIRED_HEADER_FIELDS) {
    if (!headerField(source, field)) {
      diagnostics.push({
        severity: "error",
        code: `MISSING_${brand}_HEADER_FIELD`,
        message: `${brand} header is missing required \`${field}\` metadata.`,
      });
    }
  }

  const fileField = headerField(source, "File");
  if (fileName && fileField && fileField.toLowerCase() !== fileName.toLowerCase()) {
    diagnostics.push({
      severity: "warning",
      code: "HEADER_FILENAME_MISMATCH",
      message: `Header File is \`${fileField}\` but the actual file is \`${fileName}\`.`,
    });
  }

  const commandField = headerField(source, "Command");
  if (commandField && commands.length) {
    const normalized = commandField.toUpperCase();
    for (const command of commands) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(^|[^A-Z0-9_-])${escaped}([^A-Z0-9_-]|$)`).test(normalized)) {
        diagnostics.push({ severity: "error", code: "HEADER_COMMAND_MISMATCH", message: `Public command ${command} is not declared in the header Command field.` });
      }
    }
  }

  if (commands.length && !/\(\s*princ\s*\)\s*$/i.test(source.trim())) {
    diagnostics.push({ severity: "warning", code: "NO_QUIET_FILE_END", message: "Public command file should normally end with a quiet `(princ)`." });
  }
  if (/\bTODO\b/i.test(source)) {
    diagnostics.push({ severity: "warning", code: "TODO_MARKER", message: "Source still contains TODO markers." });
  }
}

export function validateLispSource(
  source: string,
  expectedCommands: string[] = [],
  options: { profile?: LispAuthoringProfile; fileName?: string } = {}
): LispValidationResult {
  const diagnostics: LispDiagnostic[] = [];
  const stack: Array<{ line: number; column: number }> = [];
  let line = 1;
  let column = 0;
  let inString = false;
  let escaped = false;
  let inComment = false;
  let stringStart = { line: 1, column: 1 };
  let parenPairs = 0;
  let maxDepth = 0;
  let clean = "";

  for (let index = 0; index < source.length; index++) {
    const ch = source[index];
    column += 1;
    if (inComment) {
      if (ch === "\n") { inComment = false; clean += "\n"; line += 1; column = 0; }
      else clean += " ";
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; clean += " "; }
      else if (ch === "\\") { escaped = true; clean += " "; }
      else if (ch === '"') { inString = false; clean += " "; }
      else {
        clean += ch === "\n" ? "\n" : " ";
        if (ch === "\n") { line += 1; column = 0; }
      }
      continue;
    }
    if (ch === ";") { inComment = true; clean += " "; continue; }
    if (ch === '"') { inString = true; stringStart = { line, column }; clean += " "; continue; }
    if (ch === "(") { stack.push({ line, column }); maxDepth = Math.max(maxDepth, stack.length); clean += ch; continue; }
    if (ch === ")") {
      if (!stack.length) diagnostics.push({ severity: "error", code: "UNMATCHED_CLOSE_PAREN", message: "Closing parenthesis has no matching opening parenthesis.", line, column });
      else { stack.pop(); parenPairs += 1; }
      clean += ch;
      continue;
    }
    clean += ch;
    if (ch === "\n") { line += 1; column = 0; }
  }

  if (inString) diagnostics.push({ severity: "error", code: "UNCLOSED_STRING", message: "String literal is not closed before end of file.", ...stringStart });
  for (const opening of stack.slice(-5)) diagnostics.push({ severity: "error", code: "UNCLOSED_PAREN", message: "Opening parenthesis is not closed before end of file.", ...opening });
  if (stack.length > 5) diagnostics.push({ severity: "error", code: "UNCLOSED_PAREN_MORE", message: `${stack.length - 5} additional opening parentheses are not closed.` });

  checkAutoLispDialect(clean, source, diagnostics);
  const { commands, functions } = extractDefuns(clean);

  const commandCounts = new Map<string, number>();
  for (const match of clean.matchAll(/\(\s*defun\s+c:([^\s()]+)/gi)) {
    const command = match[1].toUpperCase();
    commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
  }
  for (const [command, count] of commandCounts) {
    if (count > 1) diagnostics.push({ severity: "error", code: "DUPLICATE_PUBLIC_COMMAND", message: `Public command ${command} is defined ${count} times in the same file.` });
  }

  for (const command of uniqueSorted(expectedCommands.map((value) => value.toUpperCase()))) {
    if (!commands.includes(command)) diagnostics.push({ severity: "error", code: "MISSING_EXPECTED_COMMAND", message: `Expected public command ${command} was not found.` });
  }

  const usesCom = /\b(?:vla-|vlax-|vl-catch-all-apply|vlax-get-acad-object)/i.test(clean);
  if (usesCom && !/\(\s*vl-load-com\s*\)/i.test(clean)) {
    diagnostics.push({ severity: "error", code: "COM_WITHOUT_VL_LOAD_COM", message: "Visual LISP/ActiveX APIs are used but `(vl-load-com)` was not found." });
  }

  const usesSetvar = /\(\s*setvar\b/i.test(clean);
  if (usesSetvar && !/\(\s*defun\s+\*error\*/i.test(clean)) {
    diagnostics.push({ severity: "warning", code: "SETVAR_WITHOUT_ERROR_HANDLER", message: "The file changes system variables but no local `*error*` handler was found." });
  }

  const usesCommand = /\(\s*command(?:-s)?\b/i.test(clean);
  if (usesCommand) diagnostics.push({ severity: "warning", code: "COMMAND_API_USED", message: "The file uses `(command)`/`(command-s)`; verify whether direct DXF/VLA APIs are safer." });
  if (!commands.length) diagnostics.push({ severity: "warning", code: "NO_PUBLIC_COMMAND", message: "No `c:` public command was found. This is valid for helper/library files but should be intentional." });

  const profile = options.profile ?? "syntax";
  if (profile !== "syntax") checkAuthoringStyle(source, commands, diagnostics, profile, options.fileName);

  return {
    valid: !diagnostics.some((item) => item.severity === "error"),
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    bytes: Buffer.byteLength(source, "utf8"),
    lines: source.split(/\r?\n/).length,
    commands,
    functions,
    diagnostics,
    stats: { paren_pairs: parenPairs, max_depth: maxDepth, uses_com: usesCom, uses_command: usesCommand, uses_setvar: usesSetvar },
  };
}

function cleanCommentValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function profileForLibrary(libraryId?: string | null): Exclude<LispAuthoringProfile, "syntax"> {
  return libraryId?.trim().toLowerCase() === "tbh-toolkit" ? "tbh" : "cadgpt";
}

export function makeAuthoringHeader(args: {
  profile: Exclude<LispAuthoringProfile, "syntax">;
  fileName: string;
  module: string;
  command: string;
  description: string;
  inputs?: string;
  effects?: string;
  interaction?: string;
  risk?: string;
  dependencies?: string;
  notes?: string;
  revision?: string;
}): string {
  const brand = args.profile === "tbh" ? "TBH" : "CADGPT";
  return `;;; =============================================================================\n;;; ${brand}-HEADER-START\n;;;\n;;; File         : ${cleanCommentValue(args.fileName)}\n;;; Module       : ${cleanCommentValue(args.module)}\n;;; Command      : ${cleanCommentValue(args.command).toUpperCase()}\n;;; Description  : ${cleanCommentValue(args.description)}\n;;; Inputs       : ${cleanCommentValue(args.inputs || "As prompted by the command.")}\n;;; Effects      : ${cleanCommentValue(args.effects || "See implementation and registry metadata.")}\n;;; Interaction  : ${cleanCommentValue(args.interaction || "Interactive unless documented otherwise.")}\n;;; Risk         : ${cleanCommentValue(args.risk || "Medium; verify on an approved drawing.")}\n;;; Dependencies : ${cleanCommentValue(args.dependencies || "AutoLISP/Visual LISP as used by implementation.")}\n;;; Notes        : ${cleanCommentValue(args.notes || "Maintain behavior and registry metadata together when edited by CadGPT.")}\n;;; Revision     : ${cleanCommentValue(args.revision || "Managed by CadGPT write-lisp workflow.")}\n;;;\n;;; ${brand}-HEADER-END\n;;; =============================================================================`;
}

export function applyAuthoringHeader(source: string, args: Parameters<typeof makeAuthoringHeader>[0]): string {
  const header = makeAuthoringHeader(args);
  const knownHeader = /;;; ={20,}\r?\n;;; (?:TBH|CADGPT)-HEADER-START[\s\S]*?;;; (?:TBH|CADGPT)-HEADER-END\r?\n;;; ={20,}\r?\n?/i;
  if (knownHeader.test(source)) return source.replace(knownHeader, `${header}\n`);
  return `${header}\n\n${source.replace(/^\uFEFF/, "")}`;
}

function makeScaffold(args: {
  profile: Exclude<LispAuthoringProfile, "syntax">;
  fileName: string;
  module: string;
  command: string;
  description: string;
  mutating: boolean;
  usesCom: boolean;
}): string {
  const command = args.command.trim().toUpperCase();
  const prefix = command.toLowerCase().replace(/[^a-z0-9]/g, "") || "cmd";
  const header = makeAuthoringHeader({
    profile: args.profile,
    fileName: args.fileName,
    module: args.module,
    command,
    description: args.description,
    inputs: "Command prompts / selection as required.",
    effects: args.mutating ? "May modify the current drawing; validate declared postconditions." : "Read/report only unless implementation is intentionally changed.",
    interaction: "Interactive unless implementation is explicitly non-interactive.",
    risk: args.mutating ? "Medium; test on an approved drawing before production use." : "Low.",
    dependencies: args.usesCom ? "Visual LISP COM (`vl-load-com`)." : "AutoLISP.",
  });
  const comLine = args.usesCom ? "\n(vl-load-com)\n" : "";
  const body = args.mutating
    ? `(defun c:${command} (/ *error* cmde undo-open)\n  (defun *error* (errmsg)\n    (if (not (member errmsg '(\"Function cancelled\" \"quit / exit abort\" \"console break\")))\n      (princ (strcat \"\\n[Error] \" errmsg)))\n    (if undo-open (command \"_.undo\" \"_end\"))\n    (if cmde (setvar 'CMDECHO cmde))\n    (princ))\n  (setq cmde (getvar 'CMDECHO))\n  (setvar 'CMDECHO 0)\n  (command \"_.undo\" \"_begin\")\n  (setq undo-open T)\n\n  ;; Implement command logic here.\n\n  (if undo-open (progn (command \"_.undo\" \"_end\") (setq undo-open nil)))\n  (if cmde (setvar 'CMDECHO cmde))\n  (princ \"\\n[Done] Command complete.\")\n  (princ))`
    : `(defun c:${command} (/ )\n  ;; Implement command logic here.\n  (princ \"\\n[Done] Command complete.\")\n  (princ))`;
  const brand = args.profile === "tbh" ? "TBH" : "CADGPT";
  return `${header}\n${comLine}\n;; =============================================================================\n;; Helpers\n;; =============================================================================\n\n;; Prefix helper functions with ${prefix}: to avoid global symbol collisions.\n\n;; =============================================================================\n;; Main command\n;; =============================================================================\n\n${body}\n\n(princ \"\\n[${brand}] ${cleanCommentValue(args.description)} loaded. Type '${command}' to start.\")\n(princ)\n`;
}

export function registerLispHarnessTools(server: McpServer): void {
  server.registerTool(
    "lisp_scaffold",
    {
      title: "Create Canonical AutoLISP Scaffold",
      description: "Create CadGPT's canonical AutoLISP scaffold. Default profile is CadGPT; target_library_id=tbh-toolkit is the deliberate TBH header exception.",
      inputSchema: {
        file_name: z.string().regex(/^[^\\/]+\.lsp$/i),
        module: z.string().min(1).max(120),
        command: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
        description: z.string().min(1).max(500),
        target_library_id: z.string().optional(),
        mutating: z.boolean().optional().default(true),
        uses_com: z.boolean().optional().default(true),
      },
    },
    async ({ file_name, module, command, description, target_library_id, mutating, uses_com }) => {
      try {
        const profile = profileForLibrary(target_library_id);
        const content = makeScaffold({ profile, fileName: file_name, module, command, description, mutating, usesCom: uses_com });
        return toolResult("lisp_scaffold", {
          file_name,
          command: command.toUpperCase(),
          authoring_profile: profile,
          content,
          next: "Create the working file with file_create using an absolute path under the approved Lisp draft root, implement it with absolute-path mutations, then run lisp_draft_validate before CAD load/testing.",
        });
      } catch (error) {
        return toolError("lisp_scaffold", error);
      }
    }
  );

  server.registerTool(
    "lisp_validate",
    {
      title: "Validate Managed AutoLISP Source",
      description: "Validate AutoLISP correctness/safety for a managed Lisp Library file. Header/style enforcement is opt-in via profile; imported Lisp is normally validated with profile=syntax and remains unmodified.",
      inputSchema: {
        path: z.string().min(1),
        expected_commands: z.array(z.string().min(1)).max(50).optional().default([]),
        profile: z.enum(["syntax", "cadgpt", "tbh"]).optional().default("syntax"),
      },
    },
    async ({ path: input, expected_commands, profile }) => {
      try {
        const target = await resolveAllowedPath(input);
        const virtual = toCadgptPath(target).replaceAll("\\", "/");
        if (!virtual.toLowerCase().startsWith("appdata/libraries/lisp/") || path.extname(target).toLowerCase() !== ".lsp") {
          throw new Error("lisp_validate accepts only managed .lsp files under appdata/libraries/lisp/**");
        }
        const source = await fs.readFile(target, "utf8");
        const result = validateLispSource(source, expected_commands, { profile, fileName: path.basename(target) });
        return toolResult("lisp_validate", { path: virtual, dialect: "AutoLISP/Visual LISP", authoring_profile: profile, ...result }, result.valid ? "AutoLISP static validation passed" : "AutoLISP static validation failed");
      } catch (error) {
        return toolError("lisp_validate", error);
      }
    }
  );
}
