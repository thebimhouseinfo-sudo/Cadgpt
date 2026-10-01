# CadGPT Lessons Log

Append-only project log for real CadGPT/AutoCAD incidents, workarounds, surprising model behavior, and reusable discoveries.

This is **raw evidence**, not runtime policy. Entries do not change ChatGPT behavior automatically. Promote only stable conclusions into `WORKING_KNOWLEDGE.md`.

Recommended entry fields:

```text
date
context / drawing / task
observed behavior
expected behavior
error / evidence
workaround (if any)
root cause (if known)
candidate lesson
status = OPEN | UNDERSTOOD | PROMOTED
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
