;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : FlexConn.lsp
;;; Module      : HVAC
;;; Command     : FC
;;; Description : Creates, edits, and converts Flexible Connection blocks.
;;;               Supports 2-step precise placement:
;;;               1. Fixed Insertion at picked point + Flip (SPACE).
;;;               2. Precise Rotation using native getangle (OSnap supported).
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── UTILITIES ───────────────────────────────────────

(defun fc:rand-sfx (/ ms fr)
  (setq ms (itoa (abs (fix (getvar "MILLISECS"))))
        fr (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-" (substr ms (max 1 (- (strlen ms) 4))) (substr fr 1 (min 4 (strlen fr)))))

(defun fc:ensure-layer (lay)
  (if (not (tblsearch "LAYER" lay))
    (vla-add (vla-get-layers (vla-get-activedocument (vlax-get-acad-object))) lay)))

(defun fc:ensure-style ()
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))))

;; ─── GEOMETRY HELPERS (ACTIVEX) ──────────────────────

(defun fc:add-vla-rect (bDef x1 y1 x2 y2 lay / pts poly)
  (setq pts (vlax-make-safearray vlax-vbDouble '(0 . 7)))
  (vlax-safearray-fill pts (list x1 y1 x2 y1 x2 y2 x1 y2))
  (setq poly (vla-AddLightWeightPolyline bDef pts))
  (vla-put-Closed poly :vlax-true)
  (vla-put-Layer poly lay)
  poly)

(defun fc:add-vla-wave (bDef x1 y1 x2 y2 amp lay / pts fitPoints spl)
  (setq pts (list x1 y1 0.0
                  (+ x1 amp) (+ y1 7.5) 0.0
                  (- x1 amp) (+ y1 22.5) 0.0
                  (+ x1 amp) (+ y1 37.5) 0.0
                  (- x1 amp) (+ y1 52.5) 0.0
                  (+ x1 amp) (+ y1 67.5) 0.0
                  x1 y2 0.0))
  (setq fitPoints (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length pts)))))
  (vlax-safearray-fill fitPoints pts)
  (setq spl (vla-AddSpline bDef fitPoints (vlax-3d-point '(0 0 0)) (vlax-3d-point '(0 0 0))))
  (vla-put-Layer spl lay)
  spl)

;; ─── BLOCK CREATION ──────────────────────────────────

(defun fc:make-block (bname w h is-section extIns intIns / ad doc blks bDef lay hw L1 L2 S1 S2 hatch outer sizeAtt tag-val exAtt inAtt)
  (setq ad (vlax-get-acad-object)
        doc (vla-get-ActiveDocument ad)
        blks (vla-get-Blocks doc)
        lay "Hvac-FlexConn"
        hw (/ w 2.0))
  
  (fc:ensure-layer lay)
  (fc:ensure-style)
  
  (setq bDef (vla-Add blks (vlax-3d-point '(0 0 0)) bname))
  
  ;; Bottom & Top Rects
  (fc:add-vla-rect bDef (- hw) 0.0 hw 37.5 lay)
  (fc:add-vla-rect bDef (- hw) 112.5 hw 150.0 lay)
  
  ;; Mid section boundaries
  (setq L1 (vla-AddLine bDef (vlax-3d-point (list (- hw) 37.5 0)) (vlax-3d-point (list hw 37.5 0))))
  (setq L2 (vla-AddLine bDef (vlax-3d-point (list (- hw) 112.5 0)) (vlax-3d-point (list hw 112.5 0))))
  (vla-put-Layer L1 lay) (vla-put-Layer L2 lay)
  
  (setq S1 (fc:add-vla-wave bDef (- hw) 37.5 (- hw) 112.5 -20.0 lay))
  (setq S2 (fc:add-vla-wave bDef hw 37.5 hw 112.5 20.0 lay))
  
  ;; Hatch mid section
  (setq hatch (vla-AddHatch bDef acHatchPatternTypePreDefined "INS50I" :vlax-true))
  (vla-put-PatternAngle hatch (/ pi 2.0))
  (vla-put-PatternScale hatch 0.5)
  (vla-put-Color hatch 254)
  (vla-put-Layer hatch lay)
  
  (setq outer (vlax-make-safearray vlax-vbObject '(0 . 3)))
  (vlax-safearray-fill outer (list L1 S2 L2 S1))
  (vla-AppendOuterLoop hatch outer)
  (vla-Evaluate hatch)

  ;; Attribute SIZE
  (setq tag-val (strcat (rtos (+ w 5.0) 2 0) "x" (rtos (+ h 5.0) 2 0)))
  (setq sizeAtt (vla-AddAttribute bDef 100.0 0 "Size" (vlax-3d-point '(0 75 0)) "SIZE" tag-val))
  (vla-put-Alignment sizeAtt acAlignmentMiddleCenter)
  (vla-put-TextAlignmentPoint sizeAtt (vlax-3d-point '(0 75 0)))
  (vla-put-StyleName sizeAtt "HVACS")
  (vla-put-ScaleFactor sizeAtt 0.8)
  (vla-put-Color sizeAtt 7)
  (vla-put-Layer sizeAtt lay)

  ;; Store external/internal insulation independently for DT.
  (setq exAtt (vla-AddAttribute bDef 100.0 1 "EXTINSU"
                                 (vlax-3d-point '(0 62 0)) "EXTINSU"
                                 (if (and (numberp extIns) (> extIns 0.0))
                                   (rtos extIns 2 0) "")))
  (vla-put-Alignment exAtt acAlignmentMiddleCenter)
  (vla-put-TextAlignmentPoint exAtt (vlax-3d-point '(0 62 0)))
  (vla-put-StyleName exAtt "HVACS")
  (vla-put-ScaleFactor exAtt 0.6)
  (vla-put-Color exAtt 7)
  (vla-put-Layer exAtt lay)

  (setq inAtt (vla-AddAttribute bDef 100.0 1 "INTINSU"
                                 (vlax-3d-point '(0 52 0)) "INTINSU"
                                 (if (and (numberp intIns) (> intIns 0.0))
                                   (rtos intIns 2 0) "")))
  (vla-put-Alignment inAtt acAlignmentMiddleCenter)
  (vla-put-TextAlignmentPoint inAtt (vlax-3d-point '(0 52 0)))
  (vla-put-StyleName inAtt "HVACS")
  (vla-put-ScaleFactor inAtt 0.6)
  (vla-put-Color inAtt 7)
  (vla-put-Layer inAtt lay)

  ;; Attribute EQM (Hidden)
  (vla-AddAttribute bDef 100.0 1 "EQM" (vlax-3d-point '(0 0 0)) "EQM" "-")
  
  bDef)

;; ─── COMMAND LOGIC ───────────────────────────────────

(defun fc:get-size (obj / atts s w h)
  (setq atts (vlax-invoke obj 'GetAttributes))
  (foreach att atts
    (if (= (strcase (vla-get-TagString att)) "SIZE")
      (setq s (vla-get-TextString att))))
  (if (and s (vl-string-search "X" (strcase s)))
    (progn
      (setq s (strcase s)
            w (- (atof (substr s 1 (vl-string-search "X" s))) 5.0)
            h (- (atof (substr s (+ 2 (vl-string-search "X" s)))) 5.0))
      (list w h))
    nil))

(defun fc:get-ins-data (obj / atts att tag extIns intIns)
  (setq extIns 0.0
        intIns 0.0
        atts (vl-catch-all-apply 'vlax-invoke (list obj 'GetAttributes)))
  (if (not (vl-catch-all-error-p atts))
    (foreach att atts
      (setq tag (strcase (vla-get-TagString att)))
      (cond
        ((= tag "EXTINSU") (setq extIns (atof (vla-get-TextString att))))
        ((= tag "INTINSU") (setq intIns (atof (vla-get-TextString att)))))))
  (list (max 0.0 extIns) (max 0.0 intIns)))

(defun fc:create-new (/ p0 w h bname ins done gr gr-type gr-pt scY rot old-attreq old-attdia)
  (setq p0 (getpoint "\n[FC] Base point (Insertion): "))
  (if (not p0) (exit))
  (setq w (getreal "\n[FC] Width (W): "))
  (setq h (getreal "\n[FC] Height (H): "))
  (if (or (not w) (not h)) (exit))
  (setq bname (strcat "FlexConn" (fc:rand-sfx)))
  ;; Keep insulation data hidden and use neutral defaults during insertion.
  (fc:make-block bname w h nil 0.0 0.0)
  
  ;; Suppress attributes panel
  (setq old-attreq (getvar "ATTREQ") old-attdia (getvar "ATTDIA"))
  (setvar "ATTREQ" 0) (setvar "ATTDIA" 0)
  
  ;; Insert at fixed point p0
  (vl-cmdf "_.INSERT" bname "_S" 1.0 "_R" 0.0 p0)
  (setq ins (vlax-ename->vla-object (entlast)) scY 1.0 done nil)
  (vla-put-Layer ins "Hvac-FlexConn")
  
  ;; Step 1: Flip at fixed position
  (princ "\n[FC] SPACE to flip, click to continue...")
  (while (not done)
    (setq gr (grread T 2 0) gr-type (car gr) gr-pt (cadr gr))
    (cond
      ((= gr-type 3) (setq done T))
      ((and (= gr-type 2) (= gr-pt 32)) (setq scY (* scY -1.0)) (vla-put-YScaleFactor ins scY))
      ((and (= gr-type 2) (= gr-pt 13)) (setq done T))
      ((and (= gr-type 2) (= gr-pt 27)) (vla-delete ins) (setvar "ATTREQ" old-attreq) (setvar "ATTDIA" old-attdia) (exit))))
  
  ;; Step 2: Precise Rotation (with Preview)
  (princ "\n[FC] Click to set direction (OSnap supported)...")
  (vl-cmdf "_.ROTATE" (vlax-vla-object->ename ins) "" p0 pause)
  
  (setvar "ATTREQ" old-attreq) (setvar "ATTDIA" old-attdia)
  (princ "\n[FC] Done."))

(defun fc:edit (/ ent obj size insData extIns intIns w h bname p0 scY)
  (setq ent (car (entsel "\n[FC] Select FlexConn to edit: ")))
  (if (not ent) (exit))
  (setq obj (vlax-ename->vla-object ent))
  (setq size (fc:get-size obj))
  (if (not size) (progn (princ "\n[FC] Not a valid FlexConn block.") (exit)))
  (setq insData (fc:get-ins-data obj)
        extIns (car insData)
        intIns (cadr insData))
  
  (setq w (getreal (strcat "\n[FC] New Width (W) <" (rtos (car size) 2 0) ">: ")))
  (if (not w) (setq w (car size)))
  (setq h (getreal (strcat "\n[FC] New Height (H) <" (rtos (cadr size) 2 0) ">: ")))
  (if (not h) (setq h (cadr size)))
  (initget 4)
  (setq extIns (getreal (strcat "\n[FC] External insulation EXTINSU <" (rtos extIns 2 0) ">: ")))
  (if (null extIns) (setq extIns (car insData)))
  (initget 4)
  (setq intIns (getreal (strcat "\n[FC] Internal insulation INTINSU <" (rtos intIns 2 0) ">: ")))
  (if (null intIns) (setq intIns (cadr insData)))
  
  (setq bname (strcat "FlexConn" (fc:rand-sfx))
        p0 (vlax-safearray->list (vlax-variant-value (vla-get-InsertionPoint obj))))
  (fc:make-block bname w h nil extIns intIns)
  (vla-put-Name obj bname)
  (vla-put-Layer obj "Hvac-FlexConn")
  (foreach att (vlax-invoke obj 'GetAttributes)
     (cond
       ((= (strcase (vla-get-TagString att)) "SIZE")
        (vla-put-TextString att (strcat (rtos (+ w 5.0) 2 0) "x" (rtos (+ h 5.0) 2 0))))
       ((= (strcase (vla-get-TagString att)) "EXTINSU")
        (vla-put-TextString att (if (> extIns 0.0) (rtos extIns 2 0) "")))
       ((= (strcase (vla-get-TagString att)) "INTINSU")
        (vla-put-TextString att (if (> intIns 0.0) (rtos intIns 2 0) "")))))
  (princ "\n[FC] Updated."))

(defun fc:view-section (/ ent obj size insData bname w h h_new w_new)
  (setq ent (car (entsel "\n[FC] Select FlexConn for Section: ")))
  (if (not ent) (exit))
  (setq obj (vlax-ename->vla-object ent))
  (setq size (fc:get-size obj))
  (if (not size) (progn (princ "\n[FC] Not a valid FlexConn block.") (exit)))
  (setq insData (fc:get-ins-data obj))
  
  (setq w (car size) h (cadr size))
  (setq w_new h h_new w)
  
  (setq bname (strcat "FlexSection" (fc:rand-sfx)))
  (fc:make-block bname w_new h_new T (car insData) (cadr insData))
  (vla-put-Name obj bname)
  (vla-put-Layer obj "Hvac-FlexConn")
  (foreach att (vlax-invoke obj 'GetAttributes)
     (if (= (strcase (vla-get-TagString att)) "SIZE")
       (vla-put-TextString att (strcat (rtos (+ w_new 5.0) 2 0) "x" (rtos (+ h_new 5.0) 2 0)))))
  (princ "\n[FC] Converted to Section."))

(defun c:FC (/ kw)
  (vl-load-com)
  (initget "1 2 3 C E S")
  (setq kw (getkword "\n[FC] Flexible Connection: [1=Create New / 2=Edit / 3=View Section] <1>: "))
  (cond
    ((or (null kw) (= kw "1") (= kw "C")) (fc:create-new))
    ((or (= kw "2") (= kw "E")) (fc:edit))
    ((or (= kw "3") (= kw "S")) (fc:view-section))
  )
  (princ)
)

(princ "\n[TBH] Flexible Connection (FC) loaded.")
(princ)
