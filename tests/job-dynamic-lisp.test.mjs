import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Job dynamic Lisp seeds once, patches exact sections, and reuses persisted state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cadgpt-job-dynamic-lisp-"));
  const previousRoot = process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const { registerJobDynamicLispTools } = await import(
    "../dist/cadgpt/tools/job-dynamic-lisp.js"
  );
  const callbacks = new Map();
  registerJobDynamicLispTools({
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  });

  try {
    const registryRoot = path.join(tempRoot, "registry", "user");
    const lispRoot = path.join(tempRoot, "libraries", "lisp", "working-lisp");
    const jobRoot = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "project-jobs",
      "fdt-update"
    );
    await fs.mkdir(registryRoot, { recursive: true });
    await fs.mkdir(lispRoot, { recursive: true });
    await fs.mkdir(jobRoot, { recursive: true });

    await fs.writeFile(
      path.join(registryRoot, "libraries.json"),
      JSON.stringify({
        version: 1,
        libraries: [
          {
            id: "working-lisp",
            kind: "lisp",
            enabled: true,
            managed_path: "appdata/libraries/lisp/working-lisp",
          },
          {
            id: "project-jobs",
            kind: "job",
            enabled: true,
            managed_path: "appdata/libraries/jobs/project-jobs",
          },
        ],
      }),
      "utf8"
    );

    const source = [
      "(defun c:FDT (/ table)",
      "  (setq table '((0 100) (101 200)))",
      "  (princ \"\\nFDT ready\")",
      "  (princ))",
      "(princ)",
      "",
    ].join("\n");

    await fs.writeFile(path.join(lispRoot, "fdt.lsp"), source, "utf8");
    await fs.writeFile(
      path.join(jobRoot, "JOB.md"),
      [
        "# Job: FDT Update",
        "## Goal",
        "Update FDT sizing data.",
        "## Preconditions",
        "Registered FDT source exists.",
        "## Step 1",
        "preferred_tools: job_dynamic_lisp_prepare, job_dynamic_lisp_patch",
        "success_criteria: dynamic copy updated",
        "failure_handling: stop",
        "output: persistent dynamic Lisp",
        "## Validation",
        "Verify load and result.",
        "",
      ].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(registryRoot, "capabilities.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "fdt-source",
            kind: "lisp",
            library_id: "working-lisp",
            relative_path: "fdt.lsp",
            semantic_status: "curated",
          },
          {
            id: "fdt-update",
            kind: "job",
            library_id: "project-jobs",
            relative_path: "fdt-update/JOB.md",
            title: "FDT Update",
          },
        ],
      }),
      "utf8"
    );

    const prepare = callbacks.get("job_dynamic_lisp_prepare");
    const patch = callbacks.get("job_dynamic_lisp_patch");
    assert.equal(typeof prepare, "function");
    assert.equal(typeof patch, "function");

    const seeded = await prepare({
      job_id: "fdt-update",
      source_lisp_id: "fdt-source",
    });
    assert.equal(
      seeded.structuredContent?.data?.reused,
      false,
      JSON.stringify(seeded)
    );
    assert.equal(seeded.structuredContent?.data?.byte_for_byte_seed, true);
    const dynamicPath =
      seeded.structuredContent?.data?.dynamic_lisp_absolute_path;
    assert.equal(await fs.readFile(dynamicPath, "utf8"), source);

    const beforeHash = seeded.structuredContent?.data?.sha256;
    const oldTable = "(setq table '((0 100) (101 200)))";
    const newTable = "(setq table '((0 80) (81 160) (161 250)))";
    const patched = await patch({
      job_id: "fdt-update",
      relative_path: "dynamic-lisp/fdt.lsp",
      expected_sha256: beforeHash,
      replacements: [
        {
          section: "FDT sizing ranges",
          old_text: oldTable,
          new_text: newTable,
          replace_all: false,
        },
      ],
    });
    assert.equal(
      patched.structuredContent?.data?.syntax_valid,
      true,
      JSON.stringify(patched)
    );
    assert.equal(
      patched.structuredContent?.data?.preserved_unmatched_source,
      true
    );

    const updated = await fs.readFile(dynamicPath, "utf8");
    assert.equal(updated, source.replace(oldTable, newTable));
    const updatedHash = sha256(updated);
    assert.equal(
      patched.structuredContent?.data?.sha256_after,
      updatedHash
    );

    const reused = await prepare({
      job_id: "fdt-update",
      source_lisp_id: "fdt-source",
    });
    assert.equal(
      reused.structuredContent?.data?.reused,
      true,
      JSON.stringify(reused)
    );
    assert.equal(
      await fs.readFile(dynamicPath, "utf8"),
      updated,
      "prepare must not recopy source over persisted Job state"
    );

    const invalid = await patch({
      job_id: "fdt-update",
      relative_path: "dynamic-lisp/fdt.lsp",
      expected_sha256: updatedHash,
      replacements: [
        {
          section: "broken test",
          old_text: newTable,
          new_text: "(setq table '((0 80)",
          replace_all: false,
        },
      ],
    });
    assert.equal(invalid.isError, true, JSON.stringify(invalid));
    assert.match(
      JSON.stringify(invalid),
      /JOB_DYNAMIC_LISP_PATCH_INVALID/
    );
    assert.equal(
      await fs.readFile(dynamicPath, "utf8"),
      updated,
      "invalid patch must not mutate persisted dynamic Lisp"
    );

    const proxySource = await fs.readFile(
      new URL("../src/cadgpt/tools/cad-proxy.ts", import.meta.url),
      "utf8"
    );
    assert.match(proxySource, /appdata\/libraries\/jobs\//);
    assert.match(proxySource, /Job-owned dynamic-lisp/);

    const serviceSource = await fs.readFile(
      new URL("../runtimes/cad-mcp/services/lisp_service.py", import.meta.url),
      "utf8"
    );
    assert.match(serviceSource, /appdata\/libraries\/jobs/);
    assert.match(serviceSource, /appdata\/workspace\/job-draft/);
    assert.match(
      serviceSource,
      /Job-owned LISP is loadable only from a Job lisp\/\*\* or dynamic-lisp\/\*\* folder/
    );
  } finally {
    if (previousRoot === undefined) delete process.env.CADGPT_APPDATA_ROOT;
    else process.env.CADGPT_APPDATA_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
