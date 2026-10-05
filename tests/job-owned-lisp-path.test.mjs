import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("outer Lisp policy accepts Job-owned static/dynamic helpers and rejects unrelated Job Lisp", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "cadgpt-job-lisp-path-")
  );
  const previousRoot =
    process.env.CADGPT_APPDATA_ROOT;
  process.env.CADGPT_APPDATA_ROOT = tempRoot;

  try {
    const draftStatic = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "project-jobs",
      "create-system",
      "lisp",
      "system-collector.lsp"
    );
    const draftInvalid = path.join(
      tempRoot,
      "workspace",
      "job-draft",
      "project-jobs",
      "create-system",
      "notes",
      "not-a-helper.lsp"
    );
    const promotedStatic = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "project-jobs",
      "create-system",
      "lisp",
      "system-collector.lsp"
    );
    const promotedDynamic = path.join(
      tempRoot,
      "libraries",
      "jobs",
      "project-jobs",
      "fdt-update",
      "dynamic-lisp",
      "fdt.lsp"
    );

    for (const file of [
      draftStatic,
      draftInvalid,
      promotedStatic,
      promotedDynamic,
    ]) {
      await fs.mkdir(path.dirname(file), {
        recursive: true,
      });
      await fs.writeFile(file, "(princ)\n", "utf8");
    }

    const {
      resolveLispSourceForCommandDiscovery,
    } = await import(
      "../dist/cadgpt/tools/cad-proxy.js"
    );

    assert.equal(
      await resolveLispSourceForCommandDiscovery(
        draftStatic
      ),
      await fs.realpath(draftStatic)
    );
    assert.equal(
      await resolveLispSourceForCommandDiscovery(
        promotedStatic
      ),
      await fs.realpath(promotedStatic)
    );
    assert.equal(
      await resolveLispSourceForCommandDiscovery(
        promotedDynamic
      ),
      await fs.realpath(promotedDynamic)
    );

    await assert.rejects(
      () =>
        resolveLispSourceForCommandDiscovery(
          draftInvalid
        ),
      /Job-owned Lisp is loadable only from a Job lisp\/\*\* or dynamic-lisp\/\*\*/
    );

    const { resolveCadGptLispPath } =
      await import(
        "../dist/cadgpt/lib/lisp-path-policy.js"
      );
    const outside = path.join(
      await fs.mkdtemp(
        path.join(os.tmpdir(), "cadgpt-hp-lisp-")
      ),
      "outside.lsp"
    );
    await fs.writeFile(outside, "(princ)\n", "utf8");

    await assert.rejects(
      () => resolveCadGptLispPath(outside),
      /outside approved Lisp roots/
    );
    assert.equal(
      await resolveCadGptLispPath(outside, {
        humanPower: true,
      }),
      await fs.realpath(outside)
    );
    await assert.rejects(
      () =>
        resolveLispSourceForCommandDiscovery(
          outside
        ),
      /outside approved Lisp roots/
    );

    const {
      acquireToolLease,
      activateHumanPower,
      createWorkRegistration,
      deactivateHumanPower,
      runWithToolLease,
    } = await import(
      "../dist/cadgpt/lib/work-registration.js"
    );
    const { checkAdmission } = await import(
      "../dist/cadgpt/lib/admission.js"
    );

    const sessionKey =
      "job-owned-lisp-human-power";
    checkAdmission(
      sessionKey,
      "@cadgpt",
      "mention"
    );
    const work = createWorkRegistration({
      sessionKey,
      ownerType: "file",
      ownerId: "job-owned-lisp-policy-test",
      executionPath: "file",
    });
    const lease = acquireToolLease({
      tool: "job_draft_validate",
      family: "job-authoring",
      targetId: outside,
      executionId: work.executionId,
      authorityToken: work.authorityToken,
      sessionKey,
    });

    const outerHumanPowerResolved =
      await runWithToolLease(
        lease,
        async () => {
          activateHumanPower({
            task: "test outer Lisp scope",
            reason:
              "verify WorkRegistration source-of-truth",
            errorDescription:
              "outside Lisp is blocked normally",
            expectedBehavior:
              "Human Power unlocks this one execution",
          });
          try {
            return await resolveLispSourceForCommandDiscovery(
              outside
            );
          } finally {
            deactivateHumanPower();
          }
        }
      );
    assert.equal(
      outerHumanPowerResolved,
      await fs.realpath(outside)
    );

    await fs.rm(path.dirname(outside), {
      recursive: true,
      force: true,
    });

    const proxySource = await fs.readFile(
      new URL(
        "../src/cadgpt/tools/cad-proxy.ts",
        import.meta.url
      ),
      "utf8"
    );
    assert.match(
      proxySource,
      /humanPower:\s*Boolean\(currentHumanPower\(\)\)/
    );
    assert.match(
      proxySource,
      /resolveCadGptLispPath/
    );

    const pythonSource = await fs.readFile(
      new URL(
        "../runtimes/cad-mcp/services/lisp_service.py",
        import.meta.url
      ),
      "utf8"
    );
    assert.match(
      pythonSource,
      /appdata\/workspace\/job-draft/
    );
    assert.match(
      pythonSource,
      /appdata\/libraries\/jobs/
    );
    assert.match(
      pythonSource,
      /\{"lisp", "dynamic-lisp"\}/
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
