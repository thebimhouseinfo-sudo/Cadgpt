# CadGPT Strict Workflow Execution Harness

This is an execution-scope policy, not a new Job type, Job Builder workflow, compatibility migration, or a replacement for the promoted `JOB.md`. Apply it to an already selected Custom Job branch, approved Temp Job plan, and direct Job invocation. Planning/authoring is a separate activity.

## Established workflow is the execution boundary

- For a Custom Reasoning Job, the **current promoted `JOB.md` returned by `job_runtime_prepare`** is the exclusive step/branch/stop-point contract. For a Temp Job, use the **user-approved plan**. For a Direct Job, dispatch its existing executor without inserting model-directed stages.
- After the applicable workflow/branch is established, **EXECUTE its steps in order**. Do not plan an alternative workflow, reopen design decisions, add background research, or create precautionary stages unless an explicit step or required safety check calls for them.
- A named step may need a small technical choice (e.g., the correct registered batch tool). Choose the narrowest valid executor and continue. Internal PLAN/REVIEW is bounded to **HOW to satisfy the current step**, never permission to add WHAT to do.
- Run only the entry-condition reads, preconditions, branch checks, actions, postconditions, and cleanup explicitly required by the current contract. If a branch says "load Lisp then stop", verify the load and stop. Do not advance to later stages or revisit a previously settled branch.

## No speculative CAD audits

- Do not scan drawings, enumerate unrelated entities, audit previous test objects, trace old handles, reconcile historical mapping files, or inspect legacy outputs **unless the selected step explicitly needs those facts**.
- If the required metadata/result already satisfies a step's named input condition, proceed to its next specified operation. Do not revalidate the same information through geometry or another information source just because tools exist.
- A step that explicitly asks to check existing CAD objects still requires that check, but only to the stated scope and acceptance condition. Do not expand a bounded existence test into a general drawing/history audit.
- The fresh-CAD-state requirement still applies when the user asks for the drawing's **current live state**, or the workflow specifically requires live CAD observation; stored metadata must not be falsely represented as a live CAD observation.

## Failure and verification boundaries

- Verify each step's **specified success criterion**, including actual tool success/readback. No new full-drawing verification sweep unless the contract requires it. A tool returning `loaded=false` is not a successful Lisp load.
- On a failed required condition, stale/invalid target identity, denied access, missing required data, or tool error: report the original fact/error and **stop at that step**. Do not invent repairs, branch switches, data overwrite, or a fallback workflow.
- Incidental anomalies that do not affect a required current step are not new work. Do not investigate them; at most note them concisely at the end when relevant.
- Changes to a fixed workflow must be explicitly requested and promoted through the existing Job authoring process. A Temp Job cannot silently rewrite a Custom Job's workflow. Preserve authorized drawing/result edits and their normal safety boundaries.

## User-visible behavior

- Keep the response concise: report the verified step or precise blocker, then proceed. Do not narrate speculative subplans, internal deliberation, unsolicited audits, or imagined future stages.
- Once the user has approved the selected plan/choice, do not ask again for the same permission. Ask only for a decision actually required by the workflow or a material deviation from its scope.
