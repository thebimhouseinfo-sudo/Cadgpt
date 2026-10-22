# JobCreate — implementation and verification

Use the V5 contract in `knowledge/jobs/JOB_RULES.md` and `../SKILL.md`. Implement directly in the intended owned source folder. No draft, checkout, mandatory simulated TEST or promotion stage is required before a legitimate first RUN.

Verify the behavior actually changed: read the current Job definition, prepare owned runtime, execute the relevant safe step and inspect its declared result. Retain real partial output/error diagnostics for repair. Do not replay a non-idempotent CAD mutation whose completion is unknown.

Static validation and a Python/MCP regression demonstrate source behavior only. Actual AutoCAD LOAD/run, geometry changes and Save need native evidence. If unavailable, report exactly what was checked and mark native outcomes unverified; do not pretend success or demand a new ceremony before source repair.

Preserve business rules and entity/data scope. Test the relevant failure path, foreign-owner denial and any concurrency affected by the change. Do not invent a global drawing scan or exhaustive validation outside the Job's real success contract. Publication is explicit metadata discovery, not a substitute for runtime evidence and not a prerequisite for execution.
