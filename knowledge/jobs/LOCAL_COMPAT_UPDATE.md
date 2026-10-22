# V5 Local Custom Job Compatibility — Diagnostic Only

This file describes the **legacy epoch marker**, not a Job migration step. The binding rules are in `knowledge/jobs/JOB_RULES.md` and the human-approved V5 theory. Existing epoch remains readable for backward compatibility only.

`JOB_LOCAL_COMPAT_EPOCH = 2` is the historical marker, not a release gate.

The lightweight `job_local_compat_status` tool may report `update_required`, `pending_actions` and historical `blocked_job_ids`. In V5 these are **warnings and historical signals**, never blockers to creating, editing, running or safely repairing a User Job. No mandatory `jobcreate CONTRACT UPDATE` scan, checkout, re-validation, mock TEST or promotion is required before RUN.

When a user specifically requests compatibility analysis, inspect only the relevant real managed Job packages, their current `JOB.md`, declared runtime assumptions and actual bindings. The check may identify genuine incompatibility in the owned `runtime/`, results or Python/Lisp helper references. Report the specific finding and, when explicitly requested, use Builder direct in-place editing with `v5_source_update`; do not automatically rewrite business steps, import/copy foreign helper source, or manipulate other Jobs' results. Source edits do not publish implicitly. Refresh an existing registration explicitly with `v5_source_publish` when publication is requested.

Legacy registered `.py` Jobs remain available through their compatibility execution adapter. Existing old `JOB.md` steps are read fresh, and any real failure is handled through the V5 STOP/REPORT contract. The runtime's Drawing Anchor authority, owned file scopes, verified CAD load/run, Save and write-isolation are always required.

The epoch marker is **not** an independent source of truth and must not be used to demand any additional Job lifecycle stage. Source CI is developer diagnostics, not real CAD acceptance.
