;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Viewport-lock-unlock.lsp
;;; Module      : Setup Drawing
;;; Command     : VPLK, VPULK
;;; Description : Toggles viewport display locking to prevent accidental zooming.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select viewports.
;;; 3. Instantly locks/unlocks display scale to prevent accidental panning.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── COMMAND: VPLK (Lock All) ───
(defun c:VPLK ()
  (SSVPLock (ssget "_X" '((0 . "VIEWPORT"))) :vlax-true)
  (princ "\n[Done] All Viewports in the drawing are now LOCKED.")
  (princ)
)

;; ─── COMMAND: VPULK (Unlock All) ───
(defun c:VPULK ()
  (SSVPLock (ssget "_X" '((0 . "VIEWPORT"))) :vlax-false)
  (princ "\n[Done] All Viewports in the drawing are now UNLOCKED.")
  (princ)
)

;; ─── INTERNAL HELPER ───
(defun SSVPLock (ss lock / i)
  (if ss
    (progn
      (setq i 0)
      (repeat (sslength ss)
        (vla-put-displaylocked
          (vlax-ename->vla-object (ssname ss i))
          lock
        )
        (setq i (1+ i))
      )
      t
    )
  )
)

(princ "\n[TBH] Viewport Lock/Unlock Tool loaded. Type 'VPLK' or 'VPULK' to start.")
(princ)