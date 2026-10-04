# CadGPT Error Log

Append-only project error log for real CadGPT/AutoCAD failures, incorrect model behavior, routing mistakes, tool failures, latency regressions, workarounds, and other defects observed during actual use.

This is **raw product evidence**, not runtime policy. Its primary purpose is to support future CadGPT app improvement. Entries do not change ChatGPT behavior automatically. When an incident also reveals stable CAD operating knowledge, that knowledge may separately be promoted into `WORKING_KNOWLEDGE.md`.

Recommended entry fields:

```text
date
context / drawing / task
observed behavior
expected behavior
error / evidence
workaround (if any)
root cause (if known)
candidate improvement
status = OPEN | TRIAGED | FIXED | KNOWLEDGE_PROMOTED
```

---

## 2026-10-01 — Visual reference was interpreted as image generation instead of CAD drawing work

**Observed behavior:** With CG/CadGPT active, the user attached a fan drawing reference and asked to redraw it. The assistant generated/considered an image path instead of treating the request as geometry to be created in the bound AutoCAD drawing.

**Expected behavior:** Once CG is active with a bound drawing, drawing/editing language defaults to AutoCAD execution unless the user explicitly asks for an external image/render.

**Candidate lesson:** Active CadGPT workspace changes the default output destination for draw/create/modify requests to the bound drawing.

**Status:** PROMOTED to `WORKING_KNOWLEDGE.md`.

---

## 2026-10-01 — Repeated CAD-state question reused conversation result instead of reading CAD

**Observed behavior:** A repeated layer-count question could be answered from prior conversation context even though live CAD authority/state had changed.

**Expected behavior:** Current CAD facts require a fresh same-turn CAD read.

**Candidate lesson:** Conversation memory is never a substitute for live CAD state.

**Status:** PROMOTED to `WORKING_KNOWLEDGE.md`.

---

## 2026-10-01 — Internal Direct Job failure caused model workaround and extra latency

**Observed behavior:** When the official `tbh` Direct Job reported a load failure/timeout, the model attempted a lower-level Lisp-load workaround, making execution longer and obscuring the real Job result.

**Expected behavior:** Internal Direct Job execution is authoritative. A failure should be surfaced and fixed at the Job/tooling layer rather than bypassed.

**Candidate lesson:** Do not automatically bypass a failed Internal Direct Job with lower-level CAD/Lisp tools.

**Status:** PROMOTED to `WORKING_KNOWLEDGE.md`.


---

## 2026-10-05 — CAD MCP Lisp loader resolved a different AppData root than CadGPT core

**Observed behavior:** `cad_load_lisp_file` rejected a real Job-owned Lisp under `%LOCALAPPDATA%\CadGPT\workspace\job-draft\...\lisp\...` as outside approved roots even though the whitelist included Job-owned Lisp folders.

**Expected behavior:** TypeScript core, Tray, and Python CAD-MCP must resolve the same canonical AppData root. On Windows, unset/legacy `CADGPT_APPDATA_ROOT` resolves to `%LOCALAPPDATA%\CadGPT`.

**Root cause:** Python `lisp_service.py` still defaulted to repository-local `appdata` when the environment override was absent, while the rest of CadGPT had migrated to LocalAppData.

**Candidate improvement:** Keep one canonical AppData resolver contract across runtimes and regression-test the unset-environment Windows path.

**Status:** FIXED in source; awaiting live AutoCAD verification.

---

## 2026-10-05 — Drawing Anchor regenerated across admissions

**Observed behavior:** The same open DWG produced different `drawing_anchor` values on later CadGPT admissions.

**Expected behavior:** Drawing Anchor is write-once/read-many. Once present in the DWG, later binds only read it and never replace it.

**Root cause:** The first native storage adapter used a NOD extension-dictionary layout that did not provide reliable persistence evidence in live admission testing.

**Candidate improvement:** Store `CADGPT_DRAWING_ANCHOR` inside a CadGPT-owned hard-owner dictionary under the Named Objects Dictionary; probe read-only before generation/write and migrate any valid legacy anchor without changing its value.

**Status:** FIXED in source; awaiting live AutoCAD verification.
