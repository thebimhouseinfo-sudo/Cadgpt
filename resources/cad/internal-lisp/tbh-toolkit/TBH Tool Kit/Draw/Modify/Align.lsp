;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Align.lsp
;;; Module      : Draw\Modify
;;; Command     : AL
;;; Description : Aligns objects and blocks to standard grids or specific axes.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select objects to align.
;;; 3. Pick alignment reference line or block basepoint.
;;; TBH-HEADER-END
;;; =============================================================================
(defun c:AL (/ *error* ref-p1 ref-p2 ref-ang loop ss i ent obj
               proj delta xlineObj doc dot mode
               ref-ent tmp-info hatchLayers target-ent t1 t2)

  (vl-load-com)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (vla-StartUndoMark doc)

  ;; ===============================
  ;; HELPER FUNCTIONS
  ;; ===============================
  (defun dot (v1 v2) (apply '+ (mapcar '* v1 v2)))

  ;; Get edge info (P1, P2) in World space
  (defun get-edge-info (sel / ent p-pick obj p1 p2 m param deriv tmp)
    (setq ent (car sel)
          p-pick (cadr sel)
          obj (vlax-ename->vla-object ent))
    
    (if (> (length sel) 2)
      (progn ;; Nested inside Block
        (setq m (caddr sel)
              tmp (vla-copy obj))
        (vla-TransformBy tmp (vlax-tmatrix m))
        (setq p1 (vlax-curve-getClosestPointTo tmp p-pick)
              param (vlax-curve-getParamAtPoint tmp p1)
              deriv (vlax-curve-getFirstDeriv tmp param)
              p2 (mapcar '+ p1 deriv))
        (vla-delete tmp)
        (list p1 p2)
      )
      (progn ;; Single object
        (setq p1 (vlax-curve-getClosestPointTo obj p-pick)
              param (vlax-curve-getParamAtPoint obj p1)
              deriv (vlax-curve-getFirstDeriv obj param)
              p2 (mapcar '+ p1 deriv))
        (list p1 p2)
      )
    )
  )

  ;; Hide/Show SHADING layers
  (defun ToggleShadingLayers (show / layName curLay)
    (setq curLay (getvar "CLAYER"))
    (if (not show)
      (progn
        (setq hatchLayers nil)
        (vlax-for lay (vla-get-Layers doc)
          (setq layName (vla-get-Name lay))
          (if (and (wcmatch (strcase layName) "*-SHADING")
                   (/= (strcase layName) (strcase curLay)))
            (if (= (vla-get-Freeze lay) :vlax-false)
              (progn (vla-put-Freeze lay :vlax-true) (setq hatchLayers (cons lay hatchLayers))))
          )
        )
        (if hatchLayers (vla-Regen doc acActiveViewport))
      )
      (progn
        (foreach lay hatchLayers (vl-catch-all-apply '(lambda () (vla-put-Freeze lay :vlax-false))))
        (setq hatchLayers nil)
        (vla-Regen doc acActiveViewport)
      )
    )
  )

  (defun *error* (msg)
    (ToggleShadingLayers T)
    (if (and xlineObj (not (vlax-erased-p xlineObj))) (vla-delete xlineObj))
    (vla-EndUndoMark doc)
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\n❌ Error: " msg))
    )
    (princ)
  )

  ;; ===============================
  ;; STEP 1: DEFINE REFERENCE LINE
  ;; ===============================
  (initget "1 2")
  (setq mode (getkword "\nSelect mode [1: Select edge / 2: Draw 2 points] <1>: "))
  
  ;; Default is mode 1 (Select)
  (if (or (null mode) (= mode "1")) (setq mode "Select") (setq mode "Draw"))

  (if (= mode "Select")
    (progn ;; MODE 1: SELECT EDGE
      (ToggleShadingLayers nil)
      (setq ref-ent (nentselp "\n[Mode 1] Pick reference edge (Block/Line): "))
      (if (not ref-ent) (progn (ToggleShadingLayers T) (exit)))
      (setq tmp-info (get-edge-info ref-ent)
            ref-p1 (car tmp-info)
            ref-p2 (cadr tmp-info))
    )
    (progn ;; MODE 2: DRAW 2 POINTS
      (setq ref-p1 (getpoint "\n[Mode 2] Pick point 1 for Ref Line: "))
      (if (not ref-p1) (exit))
      (setq ref-p2 (getpoint ref-p1 "\n[Mode 2] Pick point 2 for Ref Line: "))
      (if (not ref-p2) (exit))
    )
  )

  (setq ref-ang (angle ref-p1 ref-p2))
  (setq xlineObj (vla-AddXLine (vla-get-ModelSpace doc) (vlax-3d-point ref-p1) (vlax-3d-point ref-p2)))
  (vla-put-Color xlineObj 1)

  ;; ===============================
  ;; STEP 2: ALIGN OBJECTS
  ;; ===============================
  (setq loop T)
  (while loop
    (princ (strcat "\n--- Current mode: " mode " ---"))
    (setq ss (ssget "_:L"))
    (if (null ss)
      (setq loop nil)
      (progn
        (if (= mode "Select")
          (progn ;; Mode 1: Click edge
            (setq target-ent (nentselp "\nPick edge ON OBJECT to Align: "))
            (if target-ent
              (setq tmp-info (get-edge-info target-ent)
                    t1 (car tmp-info)
                    t2 (cadr tmp-info))
              (setq t1 nil)
            )
          )
          (progn ;; Mode 2: Pick 2 points manually
            (setq t1 (getpoint "\nPick point 1 on object (Base): "))
            (if t1 (setq t2 (getpoint t1 "\nPick point 2 on object (Direction): ")))
          )
        )

        (if (and t1 t2 (not (equal t1 t2 1e-8)))
          (progn
            ;; Calculate geometry to project point t1 onto XLine
            (setq ap (mapcar '- t1 ref-p1)
                  ab (mapcar '- ref-p2 ref-p1)
                  denom (apply '+ (mapcar '* ab ab))
                  proj (mapcar '+ ref-p1 (mapcar '(lambda (v) (* v (/ (dot ap ab) denom))) ab)))

            (setq target-ang (angle t1 t2))
            ;; Flip vector direction if user clicked opposite to reference
            (if (< (dot (mapcar '- ref-p2 ref-p1) (mapcar '- t2 t1)) 0)
              (setq target-ang (+ target-ang pi))
            )
            (setq delta (- ref-ang target-ang))

            ;; Execute Move & Rotate
            (setq i 0)
            (repeat (sslength ss)
              (setq obj (vlax-ename->vla-object (ssname ss i)))
              (vla-move obj (vlax-3d-point t1) (vlax-3d-point proj))
              (vla-rotate obj (vlax-3d-point proj) delta)
              (setq i (1+ i))
            )
            (princ "\n✅ Done.")
          )
          (princ "\n⚠️ Operation cancelled.")
        )
      )
    )
  )

  ;; FINISH
  (ToggleShadingLayers T)
  (if (and xlineObj (not (vlax-erased-p xlineObj))) (vla-delete xlineObj))
  (vla-EndUndoMark doc)
  (princ "\n--- ALIGN COMPLETED ---")
  (princ)
)