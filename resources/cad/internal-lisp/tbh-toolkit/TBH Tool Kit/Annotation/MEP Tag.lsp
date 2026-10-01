;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : MEP Tag.lsp
;;; Module      : Annotation
;;; Command     : TG
;;; Description : Unified router command to tag Ducts, Equipment, and Grilles.
;;;               Detects object type by layer and invokes DTAG, ETAG, or GT.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; Global convention for pre-selection
(setq *TG_SELECTED_ENTITY* nil)

(defun c:TG (/ ent obj lay kw)
  (vl-load-com)
  
  (princ "\n[TG] Select object to tag (Duct/EQM/Grille): ")
  (setq ent (car (entsel)))
  
  (if (not ent)
    (progn (princ "\n[TG] Cancelled.") (exit))
  )
  
  (setq obj (vlax-ename->vla-object ent)
        lay (vla-get-layer obj))
  
  ;; Set global for sub-commands to pick up
  (setq *TG_SELECTED_ENTITY* ent)
  
  (cond
    ;; DUCT detection: Hvacduct-sa, ra, oa, ea, ta
    ((or (wcmatch (strcase lay) "HVACDUCT-*")
         (wcmatch (strcase (vla-get-effectivename obj)) "DT*,RD*"))
     (if (and c:DTAG)
       (c:DTAG)
       (princ "\n[TG] Error: Duct Tag.lsp not loaded.")))
    
    ;; EQUIPMENT detection: Hvacequip or Hvac-Equip
    ((wcmatch (strcase lay) "HVACEQUIP,HVAC-EQUIP")
     (if (and c:ETAG)
       (c:ETAG)
       (princ "\n[TG] Error: EQM TAG.lsp not loaded.")))
    
    ;; GRILLE detection: Hvac-SAGrille, RAGrille, OAGrille, EAGrille, TAGrille
    ((wcmatch (strcase lay) "HVAC-SAGRILLE,HVAC-RAGRILLE,HVAC-OAGRILLE,HVAC-EAGRILLE,HVAC-TAGRILLE")
     (if (and c:GT)
       (c:GT)
       (princ "\n[TG] Error: MEP Properties.lsp not loaded.")))
    
    ;; UNRECOGNIZED
    (T
     (princ (strcat "\n[TG] Layer '" lay "' not recognized."))
     (initget "1 2")
     (setq kw (getkword "\nTag as: [1=EQM / 2=Grille] / Enter to Exit: "))
     (cond
       ((= kw "1")
        (vla-put-layer obj "Hvacequip")
        (if c:ETAG (c:ETAG) (princ "\n[TG] Command ETAG not found.")))
       ((= kw "2")
        (if c:GT (c:GT) (princ "\n[TG] Command GT not found.")))
       (T (setq *TG_SELECTED_ENTITY* nil))
     )
    )
  )
  
  ;; Cleanup global variable
  (setq *TG_SELECTED_ENTITY* nil)
  (princ)
)

(princ "\n[TBH] MEP Tag (TG) loaded.")
(princ)
