;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : CleanATT.lsp
;;; Module      : Setup Xref
;;; Command     : CATT
;;; Description : Resets and cleans rogue block attributes.
;;;
;;; Usage       :
;;; 1. Run command.
;;; 2. Select corrupted blocks.
;;; 3. Fixes duplicated tags and normalizes attribute constraints.
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
