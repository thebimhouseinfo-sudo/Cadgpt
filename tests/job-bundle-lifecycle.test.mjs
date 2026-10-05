import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function reasoningJob(title) {
  return [
    `# Job: ${title}`,
    "## Goal",
    "Exercise Job bundle lifecycle.",
    "## Preconditions",
    "Managed Job library exists.",
    "## Step 1",
    "preferred_tools: cad__cad_load_lisp_file",
    "success_criteria: helper preserved",
    "failure_handling: stop",
    "output: bundle evidence",
    "## Validation",
    "Verify package bytes.",
    "",
  ].join("\n");
}

test("Job checkout and promotion preserve lisp/** and dynamic-lisp/** as one hash-guarded bundle", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-bundle-")
  );
  const previousRoot =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  const callbacks = new Map();
  const fakeServer = {
    registerTool(name, _config, callback) {
      callbacks.set(name, callback);
    },
  };

  try {
    const {
      registerJobAuthoringTools,
      registerJobDiscoveryTools,
    } = await import(
      "../dist/cadgpt/tools/jobs.js"
    );
    registerJobDiscoveryTools(fakeServer);
    registerJobAuthoringTools(fakeServer);

    const registryRoot = path.join(
      tempRoot,
      "registry",
      "user"
    );
    const managedRoot = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "project-jobs"
    );
    const sourceRoot = path.join(
      managedRoot,
      "source-job"
    );
    await fs.mkdir(
      path.join(sourceRoot, "lisp"),
      { recursive: true }
    );
    await fs.mkdir(
      path.join(sourceRoot, "dynamic-lisp"),
      { recursive: true }
    );
    await fs.mkdir(registryRoot, {
      recursive: true,
    });
    await fs.mkdir(
      path.join(
        tempRoot,
        "workspace",
        "job-draft"
      ),
      { recursive: true }
    );

    const jobContent =
      reasoningJob("Source Job");
    const staticHelper =
      "(defun cadgpt-test-static () (princ))\n";
    const dynamicHelper =
      "(defun c:TESTDYNAMIC () (princ))\n";

    await fs.writeFile(
      path.join(sourceRoot, "JOB.md"),
      jobContent,
      "utf8"
    );
    await fs.writeFile(
      path.join(
        sourceRoot,
        "lisp",
        "system-collector.lsp"
      ),
      staticHelper,
      "utf8"
    );
    await fs.writeFile(
      path.join(
        sourceRoot,
        "dynamic-lisp",
        "derived.lsp"
      ),
      dynamicHelper,
      "utf8"
    );

    await fs.writeFile(
      path.join(registryRoot, "libraries.json"),
      JSON.stringify({
        version: 1,
        libraries: [
          {
            id: "project-jobs",
            kind: "job",
            enabled: true,
            managed_path:
              "appdata/libraries/jobs/project-jobs",
          },
        ],
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(
        registryRoot,
        "capabilities.json"
      ),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "source-job",
            kind: "job",
            library_id: "project-jobs",
            relative_path:
              "source-job/JOB.md",
            title: "Source Job",
          },
        ],
      }),
      "utf8"
    );

    const getJob = callbacks.get("job_get");
    const checkout = callbacks.get("job_checkout");
    const validate =
      callbacks.get("job_draft_validate");
    const promote =
      callbacks.get("job_promote_draft");
    assert.equal(typeof getJob, "function");
    assert.equal(typeof checkout, "function");
    assert.equal(typeof validate, "function");
    assert.equal(typeof promote, "function");

    const managed = await getJob({
      id: "source-job",
    });
    assert.match(
      managed.structuredContent?.data
        ?.bundle_sha256 ?? "",
      /^[a-f0-9]{64}$/
    );
    assert.deepEqual(
      managed.structuredContent?.data
        ?.bundle_files,
      [
        "JOB.md",
        "dynamic-lisp/derived.lsp",
        "lisp/system-collector.lsp",
      ]
    );

    const draft = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "project-jobs",
      "create-system",
      "JOB.md"
    );
    const checkedOut = await checkout({
      registry_id: "source-job",
      draft_path: draft,
      overwrite_existing: false,
    });
    assert.equal(
      checkedOut.isError,
      undefined,
      JSON.stringify(checkedOut)
    );
    assert.equal(
      await fs.readFile(
        path.join(
          path.dirname(draft),
          "lisp",
          "system-collector.lsp"
        ),
        "utf8"
      ),
      staticHelper
    );
    assert.equal(
      await fs.readFile(
        path.join(
          path.dirname(draft),
          "dynamic-lisp",
          "derived.lsp"
        ),
        "utf8"
      ),
      dynamicHelper
    );
    assert.equal(
      checkedOut.structuredContent?.data
        ?.source_bundle_sha256,
      checkedOut.structuredContent?.data
        ?.draft_bundle_sha256
    );

    const validation = await validate({
      path: draft,
    });
    assert.equal(
      validation.structuredContent?.data
        ?.bundle_sha256,
      checkedOut.structuredContent?.data
        ?.draft_bundle_sha256
    );

    const changedStatic =
      "(defun cadgpt-test-static () (princ \"updated\"))\n";
    await fs.writeFile(
      path.join(
        path.dirname(draft),
        "lisp",
        "system-collector.lsp"
      ),
      changedStatic,
      "utf8"
    );
    const changedValidation = await validate({
      path: draft,
    });
    assert.notEqual(
      changedValidation.structuredContent?.data
        ?.bundle_sha256,
      validation.structuredContent?.data
        ?.bundle_sha256
    );

    const target = path.join(
      managedRoot,
      "create-system",
      "JOB.md"
    );
    const promoted = await promote({
      draft_path: draft,
      target_path: target,
      library_id: "project-jobs",
      relative_path:
        "create-system/JOB.md",
      metadata: {
        id: "create-system",
        title: "Create System",
        class_name: "workflow.user",
        subclass: "reasoning",
        tags: ["fixture"],
        summary: "Bundle lifecycle fixture",
        status: "active",
        risk: "medium",
      },
      overwrite: false,
      test_evidence:
        "collector test passed",
      final_validation_evidence:
        "bundle validated",
      user_accepted: true,
    });
    assert.equal(
      promoted.isError,
      undefined,
      JSON.stringify(promoted)
    );
    assert.equal(
      await fs.readFile(
        path.join(
          path.dirname(target),
          "lisp",
          "system-collector.lsp"
        ),
        "utf8"
      ),
      changedStatic
    );
    assert.equal(
      await fs.readFile(
        path.join(
          path.dirname(target),
          "dynamic-lisp",
          "derived.lsp"
        ),
        "utf8"
      ),
      dynamicHelper
    );
    assert.equal(
      promoted.structuredContent?.data
        ?.managed_bundle_sha256,
      changedValidation.structuredContent?.data
        ?.bundle_sha256
    );

    const promotedGet = await getJob({
      id: "create-system",
    });
    assert.equal(
      promotedGet.structuredContent?.data
        ?.bundle_sha256,
      promoted.structuredContent?.data
        ?.managed_bundle_sha256
    );

    await fs.writeFile(
      path.join(
        path.dirname(target),
        "lisp",
        "system-collector.lsp"
      ),
      "(princ \"external drift\")\n",
      "utf8"
    );
    const staleOverwrite = await promote({
      draft_path: draft,
      target_path: target,
      library_id: "project-jobs",
      relative_path:
        "create-system/JOB.md",
      metadata: {
        id: "create-system",
        title: "Create System",
        class_name: "workflow.user",
        subclass: "reasoning",
        tags: ["fixture"],
        summary: "Bundle lifecycle fixture",
        status: "active",
        risk: "medium",
      },
      overwrite: true,
      expected_target_bundle_sha256:
        promoted.structuredContent.data
          .managed_bundle_sha256,
      test_evidence: "retest",
      final_validation_evidence:
        "revalidation",
      user_accepted: true,
    });
    assert.equal(
      staleOverwrite.isError,
      true,
      JSON.stringify(staleOverwrite)
    );
    assert.match(
      JSON.stringify(staleOverwrite),
      /RESOURCE_CONFLICT: managed Job bundle changed/
    );
  } finally {
    if (previousRoot === undefined) {
      delete process.env.CADGPT_APPDATA_ROOT;
    } else {
      process.env.CADGPT_APPDATA_ROOT =
        previousRoot;
    }
    await fs.rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
});
