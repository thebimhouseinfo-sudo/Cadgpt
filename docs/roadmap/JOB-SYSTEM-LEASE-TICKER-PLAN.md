# Job SYSTEM Lease + Add-in Ticker Plan

Status: CR PASS after source simulation.

## Goal

Allow a User Reasoning Job to hand off an independent data-processing tail after it has finished collecting everything it needs from CAD, while keeping the implementation minimal.

## Fixed boundaries

- Do not redesign CAD MCP / WorkRegistration / existing per-call ToolLease.
- Do not change Direct Job behavior.
- Do not change Write Lisp or CAD MCP development workflows.
- Do not add Job registry metadata such as `has_backend`.
- Do not add percent/phase/heartbeat progress.
- Do not migrate existing User Jobs or bump `JOB_LOCAL_COMPAT_EPOCH`.
- The Job source decides whether it has a backend tail. Job Builder only teaches the contract.

## Contract

A background-capable Job explicitly calls:

```text
job_system_acquire
... independent SYSTEM/file processing ...
job_system_release
```

The SYSTEM tool id is exactly the canonical Job id. No random suffix is used.

`job_system_acquire` must do more than publish UI state. It hands off the current Job runtime authority from the foreground execution to the SYSTEM lease:

- detach the current `JobRuntimeContext` from `execution_id`;
- preserve its Job runtime write root;
- preserve its own result write root(s);
- snapshot the drawing metadata root(s) already authorized before handoff for read access;
- keep the Job package/root owned so a second run of the same Job remains `JOB_RUNTIME_BUSY`.

After handoff, replacing/cleaning the foreground WorkRegistration must not clean the detached Job runtime.

Background file calls use `tool_id=<job_id>` instead of the stale foreground work handle. Only filesystem tools gain this alternate authority path. CAD and every other tool family keep the current work-handle contract.

`job_system_release` validates the owning logical session, cleans the detached Job runtime ownership, removes the SYSTEM lease, and therefore marks the Job done.

Runtime restart/crash intentionally clears all in-memory SYSTEM leases. The next run reuses the same Job id.

## Add-in

Extend the existing one-second add-in control poll with active background Job names.

- 0 active Jobs: ticker row collapsed.
- 1 active Job: static `<Job name> — Processing`.
- multiple active Jobs: one horizontal marquee/ticker line.
- when a Job disappears after a successful poll: show `<Job name> — Done` briefly, then remove it.
- a control-plane timeout/error must preserve the previous ticker state and must never imply Done.

The add-in never receives the SYSTEM authority token/tool id beyond the non-secret canonical Job id already used as identity.

## Required tests

1. acquire detaches runtime from foreground execution;
2. foreground replacement/cleanup does not clean detached runtime;
3. Job B can prepare/run while Job A owns a SYSTEM lease;
4. different Jobs can hold SYSTEM leases concurrently;
5. same Job cannot start again while its SYSTEM lease owns the Job root;
6. background file read/write succeeds only inside its preserved scope;
7. background write to another Job result is rejected;
8. stale/wrong-session release is rejected;
9. release removes lease and cleans ownership;
10. runtime restart semantics require no persisted recovery;
11. add-in payload contains active Job names only;
12. ticker remains one row, handles multiple Jobs, and does not infer Done from poll failure.

## Job Builder rule

When an authored/refined Job has an independent processing tail after all CAD-dependent data and final result location are already resolved, Job Builder inserts the acquire/release contract around that tail and guarantees release in a `finally`/equivalent failure path. Jobs without such a tail are unchanged.
