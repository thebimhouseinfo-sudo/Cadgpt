;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : CleanATT.lsp
;;; Module       : Setup Xref
;;; Command      : CATT
;;; Description  : Clears text values from attributes attached to user-selected attributed block references.
;;; Inputs       : User selection of INSERT entities with attributes.
;;; Effects      : Sets each selected attribute TextString to an empty string.
;;; Interaction  : Interactive.
;;; Risk         : Medium; selected attribute text values are destructively cleared.
;;; Dependencies : Visual LISP COM (`vl-load-com`).
;;; Notes        : Does not repair duplicate tags or attribute constraints; metadata now follows current implementation.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:CATT (/ ss i ename obj attrs vAttr)
  (vl-load-com)
  (princ "\nSelect Blocks to clear Attribute values: ")
  (setq ss (ssget '((0 . "INSERT") (66 . 1))))

  (if ss
    (progn
      (setq i 0)
      (while (< i (sslength ss))
        (setq ename (ssname ss i))
        (setq obj (vlax-ename->vla-object ename))
        (setq attrs (vlax-invoke obj 'GetAttributes))
        (foreach vAttr attrs
          (vla-put-textstring vAttr "")
        )
        (setq i (1+ i))
      )
      (princ (strcat "\n[Done] Cleared attribute values for " (itoa (sslength ss)) " Blocks."))
    )
    (princ "\n[Error] No Blocks with attributes selected.")
  )
  (princ)
)

(princ "\n[TBH] Clear Block Attributes tool loaded. Type 'CATT' to start.")
(princ)
