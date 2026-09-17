;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : CleanAll.lsp
;;; Module       : Setup Xref
;;; Command      : CLEANALL
;;; Description  : Deletes AcDbSolid, AcDbTrace, AcDb3dFace, SOLID-pattern hatches and wipeouts from all block definitions/spaces, then regenerates the drawing.
;;; Inputs       : None.
;;; Effects      : Globally deletes matching geometry across drawing/block definitions and regenerates all viewports.
;;; Interaction  : Non-interactive.
;;; Risk         : High; destructive global cleanup across block definitions and spaces.
;;; Dependencies : Visual LISP COM (`vl-load-com`).
;;; Notes        : Does not purge DGN linetypes, regapps or other unreferenced data; metadata now follows current implementation.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:CLEANALL ( / doc blkTbl blkDef obj entType)
  (vl-load-com)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq blkTbl (vla-get-Blocks doc))

  (princ "\nCleaning SOLIDs, WIPEOUTs, and SOLID HATCHes from all spaces and block definitions...")

  (vlax-for blkDef blkTbl
    (vlax-for obj blkDef
      (setq entType (vla-get-ObjectName obj))
      (if (member entType '("AcDbSolid" "AcDbTrace" "AcDb3dFace"))
        (vl-catch-all-apply 'vla-delete (list obj))
      )
      (if (= (strcase entType) "ACDBHATCH")
        (if (vl-string-search "SOLID" (strcase (vla-get-PatternName obj)))
          (vl-catch-all-apply 'vla-delete (list obj))
        )
      )
      (if (= entType "AcDbWipeout")
        (vl-catch-all-apply 'vla-delete (list obj))
      )
    )
  )

  (vla-Regen doc acAllViewports)
  (princ "\n[Done] Clean All process complete. SOLID objects and Wipeouts removed.")
  (princ)
)

(princ "\n[TBH] Global Drawing Cleanup Tool loaded. Type 'CLEANALL' to start.")
(princ)
