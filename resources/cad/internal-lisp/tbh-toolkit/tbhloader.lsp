;;; CadGPT official TBH Toolkit loader
;;; This file is intentionally excluded from the bundled Lisp registry.
;;; It is loaded only by the official internal direct Job "tbh".
;;;
;;; CadGPT's verified Lisp bridge sets *cadgpt-load-dir* to this file's
;;; absolute directory for the duration of the load. Child paths stay
;;; portable relative to this toolkit root.

(vl-load-com)

(if (or (not (boundp '*cadgpt-load-dir*))
        (null *cadgpt-load-dir*)
        (= *cadgpt-load-dir* ""))
  (error "TBH loader requires CadGPT verified load context.")
)

(setq *cadgpt-tbh-load-files* '(
  "TBH Tool Kit/Annotation/AttModSuiteV1-1.lsp"
  "TBH Tool Kit/Annotation/Change leader properties.lsp"
  "TBH Tool Kit/Annotation/Duct Tag.lsp"
  "TBH Tool Kit/Annotation/EQM Tag.lsp"
  "TBH Tool Kit/Annotation/Flex connection Tag.lsp"
  "TBH Tool Kit/Annotation/MEP Properties.lsp"
  "TBH Tool Kit/Annotation/MEP Tag.lsp"
  "TBH Tool Kit/Annotation/NumIncV3-9.lsp"
  "TBH Tool Kit/Demolition/Hatch Demolition.LSP"
  "TBH Tool Kit/Draw/Auto Connect.lsp"
  "TBH Tool Kit/Draw/Create/Bend Up Down.lsp"
  "TBH Tool Kit/Draw/Create/Blade Damper.lsp"
  "TBH Tool Kit/Draw/Create/Boot.lsp"
  "TBH Tool Kit/Draw/Create/Duct Riser.lsp"
  "TBH Tool Kit/Draw/Create/Endcap.lsp"
  "TBH Tool Kit/Draw/Create/FlexConn.lsp"
  "TBH Tool Kit/Draw/Create/Flexible Duct.lsp"
  "TBH Tool Kit/Draw/Create/Grille.lsp"
  "TBH Tool Kit/Draw/Create/Mitered Elbow.lsp"
  "TBH Tool Kit/Draw/Create/Penetration.lsp"
  "TBH Tool Kit/Draw/Create/Pipework.lsp"
  "TBH Tool Kit/Draw/Create/Rec Elbow.lsp"
  "TBH Tool Kit/Draw/Create/Rec to Round.lsp"
  "TBH Tool Kit/Draw/Create/Rect Duct Transition.lsp"
  "TBH Tool Kit/Draw/Create/Rectangular duct.lsp"
  "TBH Tool Kit/Draw/Create/Round Duct Transition.lsp"
  "TBH Tool Kit/Draw/Create/Round Duct.LSP"
  "TBH Tool Kit/Draw/Create/Round Elbow.LSP"
  "TBH Tool Kit/Draw/Duct Checker.lsp"
  "TBH Tool Kit/Draw/Duct Path.lsp"
  "TBH Tool Kit/Draw/Duct Sizer.lsp"
  "TBH Tool Kit/Draw/Duct Type Setting.lsp"
  "TBH Tool Kit/Draw/Modify/Align.lsp"
  "TBH Tool Kit/Draw/Modify/Change Duct Type.lsp"
  "TBH Tool Kit/Draw/Modify/Match MEP Properties.lsp"
  "TBH Tool Kit/Draw/Modify/Modify Duct.lsp"
  "TBH Tool Kit/Draw/Others/Change Layer.lsp"
  "TBH Tool Kit/Draw/Others/Hidden duct.lsp"
  "TBH Tool Kit/Draw/Others/Tapper.lsp"
  "TBH Tool Kit/Setup Drawing/Chuanhoadrawing.lsp"
  "TBH Tool Kit/Setup Drawing/Copy2Layouts.lsp"
  "TBH Tool Kit/Setup Drawing/Finish Drawings.lsp"
  "TBH Tool Kit/Setup Drawing/Layout Reference Tools.lsp"
  "TBH Tool Kit/Setup Drawing/Split Viewport.lsp"
  "TBH Tool Kit/Setup Drawing/TabSortV2-2.lsp"
  "TBH Tool Kit/Setup Drawing/Viewport-lock-unlock.lsp"
  "TBH Tool Kit/Setup Xref/CleanAll.lsp"
  "TBH Tool Kit/Setup Xref/CleanATT.lsp"
  "TBH Tool Kit/Setup Xref/CleanMtext.lsp"
  "TBH Tool Kit/Setup Xref/PurgeReconciledLayers.lsp"
  "TBH Tool Kit/Setup Xref/XrefLayerMapper_v3.2.lsp"
  "TBH Tool Kit/Special/Block to layer 0.LSP"
  "TBH Tool Kit/Special/Circular Wipeout.lsp"
  "TBH Tool Kit/Special/Color-bylayer-byblock.lsp"
  "TBH Tool Kit/Special/Export Layers.lsp"
  "TBH Tool Kit/Special/Flexconn Takeoff.lsp"
  "TBH Tool Kit/Special/Grille takeoff.lsp"
  "TBH Tool Kit/Special/Join Polyline.lsp"
  "TBH Tool Kit/Special/Match Hatch.lsp"
  "TBH Tool Kit/Special/NestedRemove.lsp"
  "TBH Tool Kit/Special/TBH Calc.lsp"
  "TBH Tool Kit/TBH_Block_Library.lsp"
  "TBH Tool Kit/TBH_Manager.lsp"
))

(foreach *cadgpt-tbh-relative* *cadgpt-tbh-load-files*
  (setq *cadgpt-tbh-file*
    (strcat *cadgpt-load-dir* "/" *cadgpt-tbh-relative*)
  )
  (setq *cadgpt-tbh-result*
    (vl-catch-all-apply 'load (list *cadgpt-tbh-file*))
  )
  (if (vl-catch-all-error-p *cadgpt-tbh-result*)
    (error
      (strcat
        "TBH child load failed: "
        *cadgpt-tbh-relative*
        " :: "
        (vl-catch-all-error-message *cadgpt-tbh-result*)
      )
    )
  )
)

(setq *cadgpt-tbh-load-files* nil)
(setq *cadgpt-tbh-relative* nil)
(setq *cadgpt-tbh-file* nil)
(setq *cadgpt-tbh-result* nil)
(princ)
