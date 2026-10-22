# AutoLISP harness — V5

Use `../SKILL.md`. Work directly on the explicit reusable owner's source or session-owned Temp source. Do not impose numbered lifecycle gates or checkout/promotion stages.

Validate the exact text/path with the shared Lisp validator, diagnose concrete errors, then use verified load/run against the intended bound drawing. A static PASS, queued command or successful transport response is not evidence that AutoCAD loaded or executed the command. Inspect `loaded`, command evidence and the relevant postcondition.

Use the task's authorized drawing. If a separate destructive test has no authorized target, clarify that decision; do not require a new drawing choice for every edit. If a requested disposable test drawing cannot be created, report the failure rather than switching to a live drawing.

Stop/report failures with the exact file, command, document identity and available error/log evidence. Preserve repairable source and report when native verification remains unavailable. Source publication is optional and explicit.
