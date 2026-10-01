;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : NestedRemove.lsp
;;; Module      : Special
;;; Command     : NR
;;; Description : Removes deeply nested entities from block definitions.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select block to inspect.
;;; 3. Removes unwanted nested blocks/geometries without requiring explosive detaching.
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:NR ( / e )
  (vl-load-com)
  (if (setq e (car (nentsel "\nSelect nested object to remove: ")))
    (progn
      (vla-delete (vlax-ename->vla-object e))
      (vla-regen (vla-get-activedocument (vlax-get-acad-object)) acactiveviewport)
      (princ "\n[OK] Nested object removed.")
    )
    (princ "\n[Cancel] No object selected.")
  )
  (princ)
)

(princ "\n[TBH] Nested Remove Tool loaded. Type 'NR' to start.")
(princ)