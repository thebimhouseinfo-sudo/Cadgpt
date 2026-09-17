;;; =============================================================================
;;; CADGPT-HEADER-START
;;;
;;; File         : CADGPT_LOAD_SMOKE.lsp
;;; Module       : CadGPT System Test
;;; Command      : CADGPT_LOAD_SMOKE
;;; Description  : Safe no-op command used only to verify AutoLISP load/dispatch.
;;; Inputs       : None.
;;; Effects      : Prints a success message only; no drawing mutation.
;;; Interaction  : Non-interactive.
;;; Risk         : Low.
;;; Dependencies : Visual LISP runtime.
;;; Notes        : Internal CadGPT fixture; not a user Lisp capability.
;;; Revision     : Maintained with CadGPT core.
;;;
;;; CADGPT-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun c:CADGPT_LOAD_SMOKE (/)
  (princ "\n[CADGPT] AutoLISP load smoke command executed successfully.")
  (princ)
)

(princ "\n[CADGPT] AutoLISP load smoke fixture loaded. Type 'CADGPT_LOAD_SMOKE' to run.")
(princ)
