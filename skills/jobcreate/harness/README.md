# Job authoring harness — V5

Follow `../SKILL.md` and `knowledge/jobs/JOB_RULES.md`. The harness supports the requested operation; it does not impose sequential J0–J8 gates.

- Reuse registered capabilities for ordinary task execution; use Temp for one-off helpers.
- Explicit reusable authoring uses final owned source via `v5_source_create` / `v5_source_update`, current SHA and exact saved-source authorization.
- Read the actual `JOB.md`, bindings and owned helper dependencies when diagnosing a Job. Preserve business semantics.
- Run the exact source through supported execution tools. Distinguish static/source checks, simulated backend tests and native CAD evidence.
- Publish with `v5_source_publish` only when requested. No checkout, draft or promotion stage is required.
- Stop/report real failures and partial outputs. Keep source repairable. Compatibility warnings are diagnostic only.
