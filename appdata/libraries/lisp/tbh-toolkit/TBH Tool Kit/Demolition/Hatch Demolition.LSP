;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Hatch Demolition.LSP
;;; Module      : Demolition
;;; Command     : HDEMO
;;; Description : Applies standardized demolition hatching patterns to selected regions.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select boundary curve or region.
;;; 3. The specified demolition hatching pattern is generated.
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:HDEMO (/ oldEcho oldLayer ss i ent)
  (setq oldEcho (getvar "CMDECHO"))
  (setq oldLayer (getvar "CLAYER"))
  (setvar "CMDECHO" 0)

  ;; ─── LAYER CHECK ───
  (if (not (tblsearch "LAYER" "DemoDuct-EquipHatch"))
    (progn
      (command "._-LAYER" "_N" "DemoDuct-EquipHatch" "")
      (princ "\n[Notice] Created layer 'DemoDuct-EquipHatch'.")))

  ;; ─── SELECTION & PROCESSING ───
  (princ "\nSelect boundaries to Hatch (Boundaries will be deleted after): ")
  (if (setq ss (ssget '((0 . "CIRCLE,LWPOLYLINE,POLYLINE,ELLIPSE,SPLINE"))))
    (progn
      (setq i 0)
      (while (< i (sslength ss))
        (setq ent (ssname ss i))
        
        ;; Create Hatch: Pattern=ANSI31, Scale=25, Angle=0
        (command "._-HATCH" 
                 "Properties" "ANSI31" 25.0 0.0 
                 "Select" ent "" "")
        
        ;; Change Layer to DemoDuct-EquipHatch
        (command "._CHPROP" (entlast) "" "Layer" "DemoDuct-EquipHatch" "")

        ;; Delete Boundary
        (entdel ent)
        
        (setq i (1+ i))
      )
      (princ (strcat "\n[Done] Finished hatching and deleted " (itoa (sslength ss)) " boundaries."))
    )
    (princ "\n[Error] No valid objects selected.")
  )

  ;; ─── RESTORE STATE ───
  (setvar "CMDECHO" oldEcho)
  (princ)
)

(princ "\n[TBH] Hatch Demolition Tool loaded. Type 'HDEMO' to start.")
(princ)