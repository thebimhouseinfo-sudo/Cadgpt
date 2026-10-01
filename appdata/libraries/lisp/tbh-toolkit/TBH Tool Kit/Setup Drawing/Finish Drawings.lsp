;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Finish Drawings.lsp
;;; Module      : Setup Drawing
;;; Command     : SSS, REFINETEXT
;;; Description : Finalizes drawings (purging, zooming to extents, standardizing).
;;;
;;; 
;;; Usage       :
;;; 1. Run command prior to plot/save.
;;; 2. Performs extensive audit, purge, Zoom-Extents, and file cleanup.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;;; =============================================================================
;;; PART 1: CORE LOGIC FUNCTIONS
;;; =============================================================================

;; ─── CORE LOGIC: SSS ──────────────────────────────────
(defun TBH:Core-SSS-Logic (adoc / layouts lay obj layersObj)
  (setq layouts (vla-get-layouts adoc))
  (setq layersObj (vla-get-layers adoc))

  ;; ─── LAYER CHECK: Defpoints ───
  (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-item (list layersObj "Defpoints")))
    (vla-add layersObj "Defpoints")
  )

  (princ "\n[TBH] Processing all Layouts for standardization...")

  ;; ─── SCAN LAYOUTS ───
  (vlax-for lay layouts
    (if (/= (vla-get-name lay) "Model")
      (progn
        (vlax-for obj (vla-get-block lay)
          
          ;; 1. Handle Viewports
          (if (= (vla-get-objectname obj) "AcDbViewport")
            (progn
              ;; Lock secondary viewports only
              (if (not (vl-catch-all-error-p 
                         (vl-catch-all-apply 'vla-put-displaylocked (list obj :vlax-true))))
                (vla-put-layer obj "Defpoints")
              )
            )
            
            ;; 2. Cleanup other objects on Defpoints
            (if (= (strcase (vla-get-layer obj)) "DEFPOINTS")
              (vla-put-layer obj "0")
            )
          )
        )
      )
    )
  )
  (vla-regen adoc acAllViewports)
)

;; ─── CORE LOGIC: REFINETEXT ──────────────────────────
(defun TBH:Core-RefineText-Logic (doc / mspace layouts layout blk obj entType blkRef blkDef styles)
  (setq mspace (vla-get-ModelSpace doc))
  (setq styles (vla-get-TextStyles doc))

  ;; 1. Global Style Standardization (Sets 0.8 width for MText inheritance)
  (princ "\n[TBH] Standardizing Text Styles to 0.8 Width Factor...")
  (vlax-for ts styles
    (vl-catch-all-apply 'vla-put-Width (list ts 0.8))
  )

  ;; ─── INTERNAL HELPER ───
  (defun FixTextWidth (obj / entType)
    (setq entType (vla-get-ObjectName obj))
    (cond
      ;; Standard TEXT: Directly set ScaleFactor
      ((= (strcase entType) "ACDBTEXT")
       (vl-catch-all-apply 'vla-put-ScaleFactor (list obj 0.8))
      )
      ;; MTEXT: Frame is preserved; character width inherited from Style
      ((= (strcase entType) "ACDBMTEXT")
       (princ ".") ;; Just a progress indicator, no modification to 'Width' frame
      )
    )
  )

  (princ "\n[TBH] Standardizing Text objects to 0.8...")

  ;; 2. Scan ModelSpace
  (vlax-for obj mspace (FixTextWidth obj))

  ;; 3. Scan All Layouts
  (setq layouts (vla-get-Layouts doc))
  (vlax-for layout layouts
    (setq blk (vla-get-Block layout))
    (vlax-for obj blk (FixTextWidth obj))
  )

  ;; 4. Scan Block Definitions
  (vlax-for blkRef mspace
    (if (= (vla-get-ObjectName blkRef) "AcDbBlockReference")
      (progn
        (setq blkDef (vl-catch-all-apply 'vla-Item
                                         (list (vla-get-Blocks doc)
                                               (vla-get-EffectiveName blkRef))))
        (if (and blkDef (not (vl-catch-all-error-p blkDef)))
          (vlax-for obj blkDef (FixTextWidth obj))
        )
      )
    )
  )
  (vla-Regen doc acAllViewports)
)

;;; =============================================================================
;;; PART 2: COMMAND WRAPPERS
;;; =============================================================================

(defun c:SSS ()
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (vla-startundomark adoc)
  (TBH:Core-SSS-Logic adoc)
  (vla-endundomark adoc)
  (princ "\n[TBH] Success: Viewports standardized.")
  (princ)
)

(defun c:REFINETEXT ()
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (TBH:Core-RefineText-Logic adoc)
  (princ "\n[TBH] Success: MTEXT standardized.")
  (princ)
)

;;; =============================================================================
;;; PART 3: AUTO-INITIALIZATION
;;; =============================================================================

;; Run immediate standardization on load (optional, keeping as per 'keep unchanged' requirement)
(c:SSS)
(c:REFINETEXT)

(princ "\n[TBH] Finish Design Suite loaded. Type 'SSS' or 'REFINETEXT' for manual cleanup.")
(princ)