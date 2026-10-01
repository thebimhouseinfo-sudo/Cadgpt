;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Color-bylayer-byblock.lsp
;;; Module      : Special
;;; Command     : COLORBYBLOCK, COLORBYLAYER
;;; Description : Changes selection colors to ByLayer or ByBlock.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select objects.
;;; 3. Strips hardcoded colors and strictly applies ByLayer/ByBlock properties.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun Internal_ChangeBlockColor (key / adoc)
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (vla-startundomark adoc)
  
  (princ (strcat "\nStandardizing color " (if (= key 0) "to ByBlock..." "to ByLayer...") " Please wait."))

  (vlax-for blkDef (vla-get-blocks adoc)
    (vlax-for item blkDef
      (if (vlax-write-enabled-p item)
        (if (= key 0)
          (vla-put-color item 0)    ; ByBlock
          (vla-put-color item 256)  ; ByLayer
        )
      )
    )
  )

  (vla-endundomark adoc)
  (vla-regen adoc acallviewports)
  (princ "\n[Done] All block definitions standardized.")
  (princ)
)

;; ─── COMMANDS ───

(defun c:COLORBYBLOCK ()
  (Internal_ChangeBlockColor 0)
)

(defun c:COLORBYLAYER ()
  (Internal_ChangeBlockColor 1)
)

(princ "\n[TBH] Block Color Standardization loaded. Commands: COLORBYBLOCK, COLORBYLAYER")
(princ)
