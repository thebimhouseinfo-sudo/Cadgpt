;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : CADGPT_LOAD_SMOKE.lsp
;;; Module      : CadGPT System Test
;;; Command     : CADGPT_LOAD_SMOKE
;;; Description : Safe no-op command used only to verify AutoLISP load/dispatch.
;;;
;;; Usage       :
;;; 1. Load in a blank CadGPT test drawing.
;;; 2. Run CADGPT_LOAD_SMOKE if command dispatch is being checked.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── MAIN COMMAND ─────────────────────────────────────────────────────────────
(defun c:CADGPT_LOAD_SMOKE (/)
  (princ "\n[CADGPT] AutoLISP load smoke command executed successfully.")
  (princ)
)

(princ "\n[TBH] CadGPT AutoLISP load smoke fixture loaded. Type 'CADGPT_LOAD_SMOKE' to run.")
(princ)
