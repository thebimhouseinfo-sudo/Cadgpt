import fs from "node:fs/promises";
import path from "node:path";

import {
  validateLispSource,
  type LispAuthoringProfile,
} from "../src/cadgpt/tools/lisp-harness.ts";

type Options = {
  profile: LispAuthoringProfile;
  expectedCommands: string[];
  files: string[];
};

function usage(): never {
  console.error(
    [
      "CadGPT AutoLISP syntax preflight",
      "",
      "Usage:",
      "  npm run test:lisp-syntax -- <file.lsp> [more.lsp ...] [--profile=syntax|cadgpt|tbh] [--expect=CMD1,CMD2]",
      "",
      "Examples:",
      '  npm run test:lisp-syntax -- "resources/cad/CADGPT_LOAD_SMOKE.lsp" --profile=cadgpt --expect=CADGPT_LOAD_SMOKE',
      '  npm run test:lisp-syntax -- "C:\\path\\to\\draft.lsp" --profile=cadgpt',
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  let profile: LispAuthoringProfile = "syntax";
  let expectedCommands: string[] = [];
  const files: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--profile=")) {
      const value = arg.slice("--profile=".length).toLowerCase();
      if (value !== "syntax" && value !== "cadgpt" && value !== "tbh") usage();
      profile = value;
      continue;
    }
    if (arg.startsWith("--expect=")) {
      expectedCommands = arg
        .slice("--expect=".length)
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith("--")) usage();
    files.push(arg);
  }

  if (!files.length) usage();
  return { profile, expectedCommands, files };
}

function formatLocation(line?: number, column?: number): string {
  if (!line) return "";
  return column ? `:${line}:${column}` : `:${line}`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let failed = false;

  for (const input of options.files) {
    const target = path.resolve(input);
    if (path.extname(target).toLowerCase() !== ".lsp") {
      console.error(`FAIL ${target}: expected a .lsp file`);
      failed = true;
      continue;
    }

    let source: string;
    try {
      source = await fs.readFile(target, "utf8");
    } catch (error) {
      console.error(`FAIL ${target}: ${error instanceof Error ? error.message : String(error)}`);
      failed = true;
      continue;
    }

    const result = validateLispSource(source, options.expectedCommands, {
      profile: options.profile,
      fileName: path.basename(target),
    });

    if (result.valid) {
      console.log(
        `PASS ${target} | profile=${options.profile} | commands=${result.commands.join(",") || "(none)"} | sha256=${result.sha256}`
      );
      for (const diagnostic of result.diagnostics.filter((item) => item.severity === "warning")) {
        console.log(
          `  WARN ${diagnostic.code}${formatLocation(diagnostic.line, diagnostic.column)}: ${diagnostic.message}`
        );
      }
      continue;
    }

    failed = true;
    console.error(`FAIL ${target} | profile=${options.profile} | sha256=${result.sha256}`);
    for (const diagnostic of result.diagnostics) {
      const prefix = diagnostic.severity === "error" ? "ERROR" : "WARN";
      console.error(
        `  ${prefix} ${diagnostic.code}${formatLocation(diagnostic.line, diagnostic.column)}: ${diagnostic.message}`
      );
    }
  }

  if (failed) process.exitCode = 1;
}

await main();
