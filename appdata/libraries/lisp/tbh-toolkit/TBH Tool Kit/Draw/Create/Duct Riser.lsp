;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Duct Riser.lsp
;;; Module      : Draw
;;; Command     : DRR, R1, R2
;;; Description : Draws a duct riser symbol (outline + hatch + insulation).
;;;               Inherits system type and insulation from DTS globals.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;;; =============================================================================
;;; RECTANGULAR RISER (R1)
;;; =============================================================================

;;; ─── GLOBALS ─────────────────────────────────────────────────────────────────
(if (not (boundp '*DT:Type*))  (setq *DT:Type*  "SA"))
(if (not (boundp '*DT:Insul*)) (setq *DT:Insul* 0))
(if (not (boundp '*DT:W*))     (setq *DT:W*     200.0))
(if (not (boundp '*DT:H*))     (setq *DT:H*     200.0))

;;; ─── 1. LOAD DTS ─────────────────────────────────────────────────────────────
(defun riser:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn (setq fp (findfile "Duct Type Setting.lsp")) (if (and fp (findfile fp)) (load fp)))))

;;; ─── 2. NORMALISE ────────────────────────────────────────────────────────────
(defun riser:norm-insul (val / n)
  (setq n (cond ((numberp val) (fix val))
                ((= (type val) 'STR) (atoi val))
                (T 0)))
  (if (or (< n 0) (> n 7)) 0 n))

(defun riser:rand-sfx (/ ms frac chars r1 r2)
  (setq ms (itoa (abs (fix (getvar "MILLISECS")))) 
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0))))
        chars "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  (setq r1 (substr chars (1+ (rem (fix (getvar "MILLISECS")) 26)) 1))
  (setq r2 (substr chars (1+ (rem (fix (/ (getvar "MILLISECS") 13)) 26)) 1))
  (strcat "-R" (substr ms (max 1 (- (strlen ms) 4))) (substr frac 1 (min 4 (strlen frac))) r1 r2))

;;; ─── 3. LAYER NAMES ──────────────────────────────────────────────────────────
;;; Derived from *DT:Type* at runtime — always reflects current DTS state

(defun riser:layer-duct ()
  ;; e.g. "Hvacduct-ra" when *DT:Type* = "RA"
  (strcat "Hvacduct-" (strcase *DT:Type* T)))

(defun riser:layer-shading ()
  (strcat (riser:layer-duct) "-shading"))

(defun riser:layer-insul-hatch ()
  ;; Shared insulation hatch layer, bylayer
  "Hvacduct-Insul")

(defun riser:layer-insul-out ()
  ;; EXT border outline, linetype Ins
  "Hvacins")

;;; ─── 4. INSULATION DATA ──────────────────────────────────────────────────────
;;; Returns: (type thickness pattern scale)
;;;   type    : "BARE" | "INT" | "EXT"
;;;   thickness: mm (0 for bare)
;;;   pattern : hatch pattern name for INT (empty for BARE/EXT)
;;;   scale   : hatch pattern scale
(defun riser:get-insul (idx / n)
  (setq n (riser:norm-insul idx))
  (cond
    ((= n 0) (list "BARE"   0   ""       1.0  0.0))
    ((= n 1) (list "INT"   25   "INS25I" 1.0  0.0))
    ((= n 2) (list "INT"   50   "INS50I" 1.0  0.0))
    ((= n 3) (list "INT"   75   "INS75I" 40.0 0.0))
    ((= n 4) (list "INT"  100   "INS100I" 1.0 45.0))
    ((= n 5) (list "EXT"   25   "ANSI31" 43.4 0.0))
    ((= n 6) (list "EXT"   50   "ANSI32" 15.0 0.0))
    ((= n 7) (list "EXT"   75   "ANSI34" 22.2 0.0))
    (T       (list "BARE"   0   ""       1.0  0.0))))

(defun ri:itype  (d) (nth 0 d))
(defun ri:ithick (d) (nth 1 d))
(defun ri:ipat   (d) (nth 2 d))
(defun ri:iscale (d) (nth 3 d))
(defun ri:iangle (d) (nth 4 d))

;;; ─── 5. LAYER INIT ───────────────────────────────────────────────────────────
(defun riser:ensure-layer (lname ltype color / doc layers lay)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object))
        layers (vla-get-Layers doc))
  (if (not (tblsearch "LAYER" lname))
    (progn
      (setq lay (vla-Add layers lname))
      (if ltype
        (vl-catch-all-apply 'vla-put-Linetype (list lay ltype)))
      (if color
        (vl-catch-all-apply 'vla-put-Color (list lay color)))))
  lname)

(defun riser:init-layers (/ doc)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (foreach lt '("Ins" "HD" "HIDDEN") 
    (if (not (tblsearch "LTYPE" lt)) 
      (vl-catch-all-apply 'vla-load (list (vla-get-Linetypes doc) lt "acad.lin"))))
  (riser:ensure-layer (riser:layer-duct)         nil nil)
  (riser:ensure-layer (riser:layer-shading)      nil nil)
  (riser:ensure-layer (riser:layer-insul-hatch)  nil 118)
  (riser:ensure-layer (riser:layer-insul-out)    "Ins" nil))

;;; ─── 6. GEOMETRY ─────────────────────────────────────────────────────────────
;;; Block-local coords, origin = riser centre = 0,0
;;; Axis: x right, y up (standard CAD)
;;; m1=TL  m2=TR  m3=BR  m4=BL

(defun riser:corners (w h / hw hh)
  (setq hw (/ w 2.0)  hh (/ h 2.0))
  (list (list (- hw)  hh)   ; m1 TL
        (list    hw   hh)   ; m2 TR
        (list    hw (- hh)) ; m3 BR
        (list (- hw)(- hh)))) ; m4 BL

(defun riser:m5 (corners / m2 m4 dx dy)
  ;; m5 on diagonal m2→m4, from m4 toward m2 by 1/6 of |m4m2|
  (setq m2 (nth 1 corners)
        m4 (nth 3 corners)
        dx (/ (- (car  m2) (car  m4)) 6.0)
        dy (/ (- (cadr m2) (cadr m4)) 6.0))
  (list (+ (car  m4) dx)
        (+ (cadr m4) dy)))

(defun riser:shadow-pts (corners / m1 m3 m4 m5)
  ;; Quad m1-m5-m3-m4 : touches left edge (m1m4) and bottom edge (m3m4)
  (setq m1 (nth 0 corners)
        m3 (nth 2 corners)
        m4 (nth 3 corners)
        m5 (riser:m5 corners))
  (list m1 m5 m3 m4))

;;; ─── 7. ENTMAKE PRIMITIVES ───────────────────────────────────────────────────
(defun riser:make-lwpline (pts layer closed color ltype / data p)
  (setq data
    (append
      (list (cons 0   "LWPOLYLINE")
            (cons 100 "AcDbEntity")
            (cons 8   layer)
            (cons 100 "AcDbPolyline")
            (cons 90  (length pts))
            (cons 70  (if closed 1 0))
            (cons 43  0.0))
      (apply 'append
        (mapcar '(lambda (p)
                   (list (cons 10 (list (float (car p)) (float (cadr p))))))
                pts))))
  (if color (setq data (append data (list (cons 62 color)))))
  (if ltype (setq data (append data (list (cons 6 ltype)))))
  (entmake data))

(defun riser:make-line (p1 p2 layer color / data)
  (setq data
    (list (cons 0   "LINE")
          (cons 100 "AcDbEntity")
          (cons 8   layer)
          (cons 100 "AcDbLine")
          (cons 10  (list (car p1)(cadr p1) 0.0))
          (cons 11  (list (car p2)(cadr p2) 0.0))))
  (if color (setq data (append data (list (cons 62 color)))))
  (entmake data))

;;; ─── 8. HATCH VIA VLA ────────────────────────────────────────────────────────
;;; Adds a hatch directly into an existing block definition.
;;; pts = list of 2D points for the outer boundary loop.
;;; color = nil (bylayer) or ACI integer.
(defun riser:add-hatch (bname layer pattern scale color angdeg pts /
                        doc blkcol blkobj ptarr pl hatch loopobj i
                        extdict sorttable objs)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object))
        blkcol (vla-get-Blocks doc)
        blkobj (vla-Item blkcol bname))

  ;; Flat double array for AddLightWeightPolyline
  (setq ptarr (vlax-make-safearray vlax-vbDouble
                (cons 0 (1- (* 2 (length pts)))))
        i 0)
  (foreach p pts
    (vlax-safearray-put-element ptarr i      (float (car  p)))
    (vlax-safearray-put-element ptarr (1+ i) (float (cadr p)))
    (setq i (+ i 2)))

  ;; Temp boundary polyline in block
  (setq pl (vla-AddLightWeightPolyline blkobj ptarr))
  (vla-put-Closed pl :vlax-true)
  (vla-put-Layer  pl layer)

  ;; Create hatch object
  (setq hatch (vla-AddHatch blkobj
                1 ; acHatchPatternTypePredefined
                pattern
                :vlax-false
                0 ; acHatchObject
                ))
  (vla-put-Layer hatch layer)
  (if color (vla-put-color hatch color))
  (if (not (= (strcase pattern) "SOLID"))
    (progn
      (vl-catch-all-apply 'vla-put-PatternScale (list hatch (float scale)))
      (if angdeg (vl-catch-all-apply 'vla-put-PatternAngle (list hatch (* (/ angdeg 180.0) pi))))))

  ;; Outer loop
  (setq loopobj
    (vlax-make-variant
      (vlax-safearray-fill
        (vlax-make-safearray vlax-vbObject '(0 . 0))
        (list pl))))
  (vla-AppendOuterLoop hatch loopobj)
  (vla-Evaluate hatch)

  ;; Delete temp pline boundary
  (vla-Delete pl)

  ;; Move to bottom
  (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list blkobj)))
  (if (not (vl-catch-all-error-p extdict))
    (progn 
      (setq sorttable (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS")))
      (if (vl-catch-all-error-p sorttable) 
        (setq sorttable (vl-catch-all-apply 'vla-AddObject (list extdict "ACAD_SORTENTS" "AcDbSortentsTable"))))
      (if (not (vl-catch-all-error-p sorttable)) 
        (progn 
          (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0))) 
          (vlax-safearray-put-element objs 0 hatch) 
          (vla-MoveToBottom sorttable objs)
        )
      )
    )
  )

  hatch)

;;; ─── 9. BLOCK NAME ───────────────────────────────────────────────────────────
(defun riser:block-name (w h insul-idx)
  (strcat "RI_" *DT:Type*
          "_W" (itoa (fix w))
          "_H" (itoa (fix h))
          "_I" (itoa (riser:norm-insul insul-idx))
          (riser:rand-sfx)))

;;; ─── 10. BUILD BLOCK DEFINITION ──────────────────────────────────────────────
(defun riser:make-block (bname w h insul-data /
                         ld ls lih lio
                         itype ithick ipat iscl iang
                         mc ic
                         m1 m2 m3 m4
                         i1 i2 i3 i4
                         cross1-a cross1-b cross2-a cross2-b blkcol blkobj l1 l2)

  (setq ld    (riser:layer-duct)
        ls    (riser:layer-shading)
        lih   (riser:layer-insul-hatch)
        lio   (riser:layer-insul-out)
        itype  (ri:itype  insul-data)
        ithick (ri:ithick insul-data)
        ipat   (ri:ipat   insul-data)
        iscl   (ri:iscale insul-data)
        iang   (ri:iangle insul-data))

  ;; Metal rect corners
  (setq mc (riser:corners w h)
        m1 (nth 0 mc) m2 (nth 1 mc)
        m3 (nth 2 mc) m4 (nth 3 mc))

  ;; INT: inner cross-section corners
  (if (= itype "INT")
    (progn
      (setq ic (riser:corners (- w (* 2 ithick)) (- h (* 2 ithick))))
      (setq i1 (nth 0 ic) i2 (nth 1 ic)
            i3 (nth 2 ic) i4 (nth 3 ic))))

  ;; EXT: outer insulation border corners
  (if (= itype "EXT")
    (setq ic (riser:corners (+ w (* 2 ithick)) (+ h (* 2 ithick)))))

  ;; Diagonal endpoints: draw inside i-rect if INT, else inside m-rect
  (if (= itype "INT")
    (setq cross1-a i1 cross1-b i3
          cross2-a i2 cross2-b i4)
    (setq cross1-a m1 cross1-b m3
          cross2-a m2 cross2-b m4))

  ;; ── BLOCK HEADER ──────────────────────────────────────────────────────────
  (entmake
    (list (cons 0   "BLOCK")
          (cons 100 "AcDbEntity")
          (cons 8   ld)
          (cons 100 "AcDbBlockBegin")
          (cons 2   bname)
          (cons 70  0)
          (cons 10  '(0.0 0.0 0.0))))

  ;; ── OUTLINE ENTITIES (z-order: entmake order = draw order bottom→top) ─────

  ;; [5] Metal outline m1m2m3m4 — layer duct, bylayer
  (riser:make-lwpline mc ld T nil nil)

  ;; [6] INT inner outline i1i2i3i4 — layer duct, bylayer
  (if (= itype "INT")
    (riser:make-lwpline ic ld T nil nil))

  ;; [7] EXT border — layer Hvacins, bylayer, no hatch for riser
  (if (= itype "EXT")
    (riser:make-lwpline ic lio T nil "Ins"))

  ;; ── BLOCK END ─────────────────────────────────────────────────────────────
  (entmake
    (list (cons 0   "ENDBLK")
          (cons 100 "AcDbEntity")
          (cons 8   ld)
          (cons 100 "AcDbBlockEnd")))

  ;; ── HATCHES VIA VLA ───────────────────────────────────────────────────────
  ;; Added after block close; MoveToBottom sends them to back iteratively.
  ;; Z-Order (Top to Bottom): Shadow, Solid ic, Pattern mc, Solid mc.

  ;; [1] Shadow hatch — layer shading, solid, color 8, no outline
  (vl-catch-all-apply 'riser:add-hatch
    (list bname ls "SOLID" 1.0 8 0.0
          (riser:shadow-pts (if (= itype "INT") ic mc))))

  ;; [2] Solid hatch i1i2i3i4 — layer shading, bylayer
  (if (= itype "INT")
    (vl-catch-all-apply 'riser:add-hatch
      (list bname ls "SOLID" 1.0 nil 0.0 ic)))

  ;; [3] Pattern hatch m1m2m3m4 — layer insul-hatch, pattern
  ;; Only for internal insulation per user request
  (if (and (= itype "INT") (> ithick 0) (not (= ipat "")))
    (vl-catch-all-apply 'riser:add-hatch
      (list bname lih ipat iscl nil iang mc)))

  ;; [4] Solid hatch m1m2m3m4 — layer shading, bylayer
  (vl-catch-all-apply 'riser:add-hatch
    (list bname ls "SOLID" 1.0 nil 0.0 mc))

  ;; ── DIAGONALS VIA VLA (Drawn last to stay on top) ─────────────────────────
  (setq blkcol (vla-get-Blocks (vla-get-ActiveDocument (vlax-get-acad-object)))
        blkobj (vla-Item blkcol bname))
  (setq l1 (vla-AddLine blkobj (vlax-3d-point (car cross1-a) (cadr cross1-a) 0.0) (vlax-3d-point (car cross1-b) (cadr cross1-b) 0.0)))
  (vla-put-Layer l1 ld)
  (vla-put-Color l1 1)
  (setq l2 (vla-AddLine blkobj (vlax-3d-point (car cross2-a) (cadr cross2-a) 0.0) (vlax-3d-point (car cross2-b) (cadr cross2-b) 0.0)))
  (vla-put-Layer l2 ld)
  (vla-put-Color l2 1)

  T)

;;; ─── 11. INSERT BLOCK ────────────────────────────────────────────────────────
(defun riser:insert-block (bname cx cy layer / doc ms ins)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object))
        ms  (vla-get-ModelSpace doc))
  (setq ins
    (vla-InsertBlock ms
      (vlax-3d-point cx cy 0.0)
      bname
      1.0 1.0 1.0
      0.0))
  (if layer (vl-catch-all-apply 'vla-put-Layer (list ins layer)))
  ins)

;;; ─── 12. LIVE ROTATE ─────────────────────────────────────────────────────────
(defun riser:rotate-block (ins cx cy / ent res)
  (setq ent (vlax-vla-object->ename ins))
  (princ "\n[R1] Specify rotation angle: ")
  (setvar "CMDECHO" 1)
  (setq res (vl-catch-all-apply 'vl-cmdf (list "_.ROTATE" ent "" (list cx cy) pause)))
  (setvar "CMDECHO" 0)
  (if (vl-catch-all-error-p res)
    (progn
      (vla-Delete ins)
      (setq ins nil)))
  ins)

;;; ─── 13. MAIN COMMAND ────────────────────────────────────────────────────────
(defun c:R1 (/ old-echo cpt cx cy w h
               insul-idx insul-data bname ins)

  (setq old-echo (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  ;; Load DTS
  (riser:load-dts)
  (if (not (boundp 'dts:ensure-defaults)) (vl-catch-all-apply 'load (list "Duct Type Setting.lsp")))
  (vl-catch-all-apply 'dts:ensure-defaults '())

  (princ (strcat "\n[R1] System=" *DT:Type*
                 "  Insul=" (itoa *DT:Insul*)))

  ;; Pick centre
  (setq cpt (getpoint "\n[R1] Pick riser centre: "))
  (if (null cpt)
    (progn (setvar "CMDECHO" old-echo) (princ) (exit)))
  (setq cx (car cpt)  cy (cadr cpt))

  ;; Width
  (initget 6)
  (setq w (getreal (strcat "\n[R1] Width W <" (rtos *DT:W* 2 0) ">: ")))
  (if w (setq *DT:W* w) (setq w *DT:W*))

  ;; Height
  (initget 6)
  (setq h (getreal (strcat "\n[R1] Height H <" (rtos *DT:H* 2 0) ">: ")))
  (if h (setq *DT:H* h) (setq h *DT:H*))

  ;; Insulation
  (setq insul-idx  (riser:norm-insul *DT:Insul*)
        insul-data (riser:get-insul  insul-idx))

  ;; Block name
  (setq bname (riser:block-name w h insul-idx))

  ;; Ensure layers exist
  (riser:init-layers)

  ;; Build block def only if not already defined
  (if (not (tblsearch "BLOCK" bname))
    (vl-catch-all-apply 'riser:make-block
      (list bname w h insul-data)))

  ;; Insert at picked point
  (setq ins (riser:insert-block bname cx cy (riser:layer-duct)))

  ;; Live rotate
  (if ins (riser:rotate-block ins cx cy))

  (setvar "CMDECHO" old-echo)
  (princ))

;;; =============================================================================
;;; ROUND RISER (R2)
;;; =============================================================================

;;; ─── GLOBALS ─────────────────────────────────────────────────────────────────
(if (not (boundp '*DT:Type*))  (setq *DT:Type*  "SA"))
(if (not (boundp '*DT:Insul*)) (setq *DT:Insul* 0))
(if (not (boundp '*DT:D*))     (setq *DT:D*     200.0))

;;; ─── 1. LOAD DTS ─────────────────────────────────────────────────────────────
(defun rriser:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn (setq fp (findfile "Duct Type Setting.lsp"))
           (if (and fp (findfile fp)) (load fp)))))

;;; ─── 2. NORMALISE ────────────────────────────────────────────────────────────
(defun rriser:norm-insul (val / n)
  (setq n (cond ((numberp val) (fix val))
                ((= (type val) 'STR) (atoi val))
                (T 0)))
  (if (or (< n 0) (> n 7)) 0 n))

(defun rriser:rand-sfx (/ ms frac chars r1 r2)
  (setq ms    (itoa (abs (fix (getvar "MILLISECS"))))
        frac  (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0))))
        chars "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  (setq r1 (substr chars (1+ (rem (fix (getvar "MILLISECS")) 26)) 1))
  (setq r2 (substr chars (1+ (rem (fix (/ (getvar "MILLISECS") 13)) 26)) 1))
  (strcat "-R" (substr ms (max 1 (- (strlen ms) 4)))
               (substr frac 1 (min 4 (strlen frac))) r1 r2))

;;; ─── 3. LAYER NAMES ──────────────────────────────────────────────────────────
(defun rriser:layer-duct ()
  (strcat "Hvacduct-" (strcase *DT:Type* T)))

(defun rriser:layer-shading ()
  (strcat (rriser:layer-duct) "-shading"))

(defun rriser:layer-insul-hatch ()
  "Hvacduct-Insul")

(defun rriser:layer-insul-out ()
  "Hvacins")

;;; ─── 4. INSULATION DATA ──────────────────────────────────────────────────────
(defun rriser:get-insul (idx / n)
  (setq n (rriser:norm-insul idx))
  (cond
    ((= n 0) (list "BARE"   0   ""       1.0  0.0))
    ((= n 1) (list "INT"   25   "INS25I" 1.0  0.0))
    ((= n 2) (list "INT"   50   "INS50I" 1.0  0.0))
    ((= n 3) (list "INT"   75   "INS75I" 40.0 0.0))
    ((= n 4) (list "INT"  100   "INS100I" 1.0 45.0))
    ((= n 5) (list "EXT"   25   "ANSI31" 43.4 0.0))
    ((= n 6) (list "EXT"   50   "ANSI32" 15.0 0.0))
    ((= n 7) (list "EXT"   75   "ANSI34" 22.2 0.0))
    (T       (list "BARE"   0   ""       1.0  0.0))))

(defun rri:itype  (d) (nth 0 d))
(defun rri:ithick (d) (nth 1 d))
(defun rri:ipat   (d) (nth 2 d))
(defun rri:iscale (d) (nth 3 d))
(defun rri:iangle (d) (nth 4 d))

;;; ─── 5. LAYER INIT ───────────────────────────────────────────────────────────
(defun rriser:ensure-layer (lname ltype color / doc layers lay)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object))
        layers (vla-get-Layers doc))
  (if (not (tblsearch "LAYER" lname))
    (progn
      (setq lay (vla-Add layers lname))
      (if ltype (vl-catch-all-apply 'vla-put-Linetype (list lay ltype)))
      (if color (vl-catch-all-apply 'vla-put-Color   (list lay color)))))
  lname)

(defun rriser:init-layers (/ doc)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  ;; Load CENTER, Ins, HD, HIDDEN linetype if needed
  (foreach lt '("Vsdd" "CENTER" "CENTER2" "Ins" "HD" "HIDDEN")
    (if (not (tblsearch "LTYPE" lt))
      (vl-catch-all-apply 'vla-load
        (list (vla-get-Linetypes doc) lt "acad.lin"))))
  (rriser:ensure-layer (rriser:layer-duct)         nil nil)
  (rriser:ensure-layer (rriser:layer-shading)      nil nil)
  (rriser:ensure-layer (rriser:layer-insul-hatch)  nil 118)
  (rriser:ensure-layer (rriser:layer-insul-out)    "Ins" nil)
  ;; Centre line layer: color red (1), linetype Vsdd
  (rriser:ensure-layer "RRISER_CENTER" "Vsdd" 1))

;;; ─── 6. BLOCK NAME ───────────────────────────────────────────────────────────
(defun rriser:block-name (D insul-idx)
  (strcat "RRI_" *DT:Type*
          "_D" (itoa (fix D))
          "_I" (itoa (rriser:norm-insul insul-idx))
          (rriser:rand-sfx)))

;;; ─── 6. VLA HATCH ────────────────────────────────────────────────────────────
;;; Adds SOLID hatch into block using a temp LWPOLY with bulge as boundary.
;;; pts-bulge = list of (x y bulge) for each vertex.
(defun rriser:add-hatch-bulge (bname layer color pts-bulge /
                               doc blkcol blkobj
                               ptarr bulgarr pl hatch loopobj i
                               extdict sorttable objs)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object))
        blkcol (vla-get-Blocks doc)
        blkobj (vla-Item blkcol bname))

  ;; Build flat coordinate array for AddLightWeightPolyline
  (setq ptarr (vlax-make-safearray vlax-vbDouble
                (cons 0 (1- (* 2 (length pts-bulge)))))
        i 0)
  (foreach pb pts-bulge
    (vlax-safearray-put-element ptarr i      (float (car  pb)))
    (vlax-safearray-put-element ptarr (1+ i) (float (cadr pb)))
    (setq i (+ i 2)))

  ;; Add temp boundary pline
  (setq pl (vla-AddLightWeightPolyline blkobj ptarr))
  (vla-put-Closed pl :vlax-true)
  (vla-put-Layer  pl layer)

  ;; Set bulge on each vertex
  (setq i 0)
  (foreach pb pts-bulge
    (vla-SetBulge pl i (float (caddr pb)))
    (setq i (1+ i)))

  ;; Create SOLID hatch
  (setq hatch (vla-AddHatch blkobj 1 "SOLID" :vlax-false 0))
  (vla-put-Layer hatch layer)
  (if color (vla-put-color hatch color))

  ;; Append boundary loop
  (setq loopobj
    (vlax-make-variant
      (vlax-safearray-fill
        (vlax-make-safearray vlax-vbObject '(0 . 0))
        (list pl))))
  (vla-AppendOuterLoop hatch loopobj)
  (vla-Evaluate hatch)

  ;; Delete temp boundary pline
  (vla-Delete pl)

  ;; Send hatch to bottom of draw order
  (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list blkobj)))
  (if (not (vl-catch-all-error-p extdict))
    (progn
      (setq sorttable (vl-catch-all-apply 'vla-GetObject
                        (list extdict "ACAD_SORTENTS")))
      (if (vl-catch-all-error-p sorttable)
        (setq sorttable (vl-catch-all-apply 'vla-AddObject
                          (list extdict "ACAD_SORTENTS" "AcDbSortentsTable"))))
      (if (not (vl-catch-all-error-p sorttable))
        (progn
          (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0)))
          (vla-MoveToBottom sorttable objs)))))
  hatch)

;;; Adds a hatch into block using a temp circle as boundary.
(defun rriser:add-hatch-circle (bname layer pattern scale color angdeg cx cy radius /
                                doc blkcol blkobj circ hatch loopobj
                                extdict sorttable objs)
  (setq doc    (vla-get-ActiveDocument (vlax-get-acad-object))
        blkcol (vla-get-Blocks doc)
        blkobj (vla-Item blkcol bname))

  ;; Temp boundary circle
  (setq circ (vla-AddCircle blkobj (vlax-3d-point cx cy 0.0) radius))
  (vla-put-Layer circ layer)

  ;; Create hatch object
  (setq hatch (vla-AddHatch blkobj 1 pattern :vlax-false 0))
  (vla-put-Layer hatch layer)
  (if color (vla-put-color hatch color))
  (if (not (= (strcase pattern) "SOLID"))
    (progn
      (vl-catch-all-apply 'vla-put-PatternScale (list hatch (float scale)))
      (if angdeg (vl-catch-all-apply 'vla-put-PatternAngle (list hatch (* (/ angdeg 180.0) pi))))))

  ;; Outer loop
  (setq loopobj
    (vlax-make-variant
      (vlax-safearray-fill
        (vlax-make-safearray vlax-vbObject '(0 . 0))
        (list circ))))
  (vla-AppendOuterLoop hatch loopobj)
  (vla-Evaluate hatch)

  ;; Delete temp circle boundary
  (vla-Delete circ)

  ;; Move to bottom
  (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list blkobj)))
  (if (not (vl-catch-all-error-p extdict))
    (progn 
      (setq sorttable (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS")))
      (if (vl-catch-all-error-p sorttable) 
        (setq sorttable (vl-catch-all-apply 'vla-AddObject (list extdict "ACAD_SORTENTS" "AcDbSortentsTable"))))
      (if (not (vl-catch-all-error-p sorttable)) 
        (progn 
          (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0))) 
          (vlax-safearray-put-element objs 0 hatch) 
          (vla-MoveToBottom sorttable objs)
        )
      )
    )
  )
  hatch)

;;; ─── 7. ENTMAKE PRIMITIVES ───────────────────────────────────────────────────
;;; LWPOLYLINE with per-vertex bulge
;;; verts = list of (x y bulge)
(defun rriser:make-lwpoly-bulge (verts layer closed color / data)
  (setq data
    (append
      (list (cons 0   "LWPOLYLINE")
            (cons 100 "AcDbEntity")
            (cons 8   layer)
            (cons 100 "AcDbPolyline")
            (cons 90  (length verts))
            (cons 70  (if closed 1 0))
            (cons 43  0.0))
      (apply 'append
        (mapcar '(lambda (v)
                   (list (cons 10 (list (float (car v)) (float (cadr v))))
                         (cons 42 (float (caddr v)))))
                verts))))
  (if color (setq data (append data (list (cons 62 color)))))
  (entmake data))

;;; Circle via entmake
(defun rriser:make-circle (cx cy r layer color ltype / data)
  (setq data
    (list (cons 0   "CIRCLE")
          (cons 100 "AcDbEntity")
          (cons 8   layer)
          (cons 100 "AcDbCircle")
          (cons 10  (list (float cx) (float cy) 0.0))
          (cons 40  (float r))))
  (if color (setq data (append data (list (cons 62 color)))))
  (if ltype (setq data (append data (list (cons 6  ltype)))))
  (entmake data))

;;; Line via entmake
(defun rriser:make-line (x1 y1 x2 y2 layer color ltype / data)
  (setq data
    (list (cons 0   "LINE")
          (cons 100 "AcDbEntity")
          (cons 8   layer)
          (cons 100 "AcDbLine")
          (cons 10  (list (float x1) (float y1) 0.0))
          (cons 11  (list (float x2) (float y2) 0.0))))
  (if color (setq data (append data (list (cons 62 color)))))
  (if ltype (setq data (append data (list (cons 6  ltype)))))
  (entmake data))

;;; ─── 8. BUILD BLOCK ──────────────────────────────────────────────────────────
;;; All geometry in block-local coords, origin = riser centre.
;;; P2=(0,+R)  P4=(0,-R)  P0=(0,0)
(defun rriser:make-block (bname D insul-data /
                          ld ls lih lio lc R R-air R-ext max-r
                          itype ithick ipat iscl iang
                          pt2 pt4 pt0
                          verts over blkcol blkobj l1 l2)

  (setq ld    (rriser:layer-duct)
        ls    (rriser:layer-shading)
        lih   (rriser:layer-insul-hatch)
        lio   (rriser:layer-insul-out)
        lc    "RRISER_CENTER"
        itype  (rri:itype  insul-data)
        ithick (rri:ithick insul-data)
        ipat   (rri:ipat   insul-data)
        iscl   (rri:iscale insul-data)
        iang   (rri:iangle insul-data))

  (setq R (/ D 2.0))
  
  (if (= itype "INT")
    (setq R-air (- R ithick))
    (setq R-air R))
    
  (if (= itype "EXT")
    (setq R-ext (+ R ithick)))

  (setq pt2  (list 0.0  R-air   )   ; top
        pt4  (list 0.0 (- R-air))   ; bottom
        pt0  (list 0.0 0.0  )   ; centre
        ;; verts: (x y bulge)
        verts (list (list 0.0  R-air    1.0)   ; P2 Seg1 CCW large arc LEFT
                    (list 0.0 (- R-air) 1.0)   ; P4 Seg2 CCW small arc RIGHT
                    (list 0.0 0.0      -1.0))) ; P0 Seg3 CW  small arc LEFT

  ;; BLOCK HEADER
  (entmake
    (list (cons 0   "BLOCK")
          (cons 100 "AcDbEntity")
          (cons 8   ld)
          (cons 100 "AcDbBlockBegin")
          (cons 2   bname)
          (cons 70  0)
          (cons 10  '(0.0 0.0 0.0))))

  ;; [1] Profile LWPOLY with bulge (Yin-Yang) — layer duct, bylayer
  (rriser:make-lwpoly-bulge verts ld T nil)

  ;; [2] Bounding circle for air passage (INT only) — layer duct, bylayer
  (if (= itype "INT")
    (rriser:make-circle 0.0 0.0 R-air ld nil nil))

  ;; [3] Bounding circle for metal duct — layer duct, bylayer
  (rriser:make-circle 0.0 0.0 R ld nil nil)

  ;; [4] EXT border — layer Hvacins, bylayer, linetype Ins
  (if (= itype "EXT")
    (rriser:make-circle 0.0 0.0 R-ext lio nil "Ins"))

  ;; Calculate centre lines span
  (setq over 50.0)   ; each side extends radius + 50
  (setq max-r (if (= itype "EXT") R-ext R))

  ;; BLOCK END
  (entmake
    (list (cons 0   "ENDBLK")
          (cons 100 "AcDbEntity")
          (cons 8   ld)
          (cons 100 "AcDbBlockEnd")))

  ;; HATCHES VIA VLA (Added after block close, MoveToBottom sends to back iteratively)
  ;; Visual Z-Order (Top to Bottom): Yin-Yang, Solid ic, Pattern mc, Solid mc.

  ;; [H1] Yin-Yang hatch — layer shading, solid, color 254
  (vl-catch-all-apply 'rriser:add-hatch-bulge
    (list bname ls 254 verts))

  ;; [H2] Solid hatch for air passage (INT only) — layer shading, bylayer
  (if (= itype "INT")
    (vl-catch-all-apply 'rriser:add-hatch-circle
      (list bname ls "SOLID" 1.0 nil 0.0 0.0 0.0 R-air)))

  ;; [H3] Pattern hatch for insulation (INT only) — layer insul-hatch, pattern
  (if (and (= itype "INT") (> ithick 0) (not (= ipat "")))
    (vl-catch-all-apply 'rriser:add-hatch-circle
      (list bname lih ipat iscl nil iang 0.0 0.0 R)))

  ;; [H4] Solid hatch for duct background — layer shading, bylayer
  (vl-catch-all-apply 'rriser:add-hatch-circle
    (list bname ls "SOLID" 1.0 nil 0.0 0.0 0.0 R))

  ;; [5] Centre lines via VLA (Drawn last to stay on top)
  (setq blkcol (vla-get-Blocks (vla-get-ActiveDocument (vlax-get-acad-object)))
        blkobj (vla-Item blkcol bname))
  (setq l1 (vla-AddLine blkobj (vlax-3d-point (- (+ max-r over)) 0.0 0.0) (vlax-3d-point (+ max-r over) 0.0 0.0)))
  (vla-put-Layer l1 lc)
  (vla-put-Color l1 1)
  (vla-put-Linetype l1 "Vsdd")
  (setq l2 (vla-AddLine blkobj (vlax-3d-point 0.0 (- (+ max-r over)) 0.0) (vlax-3d-point 0.0 (+ max-r over) 0.0)))
  (vla-put-Layer l2 lc)
  (vla-put-Color l2 1)
  (vla-put-Linetype l2 "Vsdd")

  T)

;;; ─── 9. INSERT BLOCK ─────────────────────────────────────────────────────────
(defun rriser:insert-block (bname cx cy layer / doc ms ins)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object))
        ms  (vla-get-ModelSpace doc))
  (setq ins
    (vla-InsertBlock ms
      (vlax-3d-point cx cy 0.0)
      bname 1.0 1.0 1.0 0.0))
  (if layer (vl-catch-all-apply 'vla-put-Layer (list ins layer)))
  ins)

;;; ─── 10. LIVE ROTATE ──────────────────────────────────────────────────────────
(defun rriser:rotate-block (ins cx cy / ent res)
  (setq ent (vlax-vla-object->ename ins))
  (princ "\n[R2] Specify rotation angle: ")
  (setvar "CMDECHO" 1)
  (setq res (vl-catch-all-apply 'vl-cmdf
              (list "_.ROTATE" ent "" (list cx cy) pause)))
  (setvar "CMDECHO" 0)
  (if (vl-catch-all-error-p res)
    (progn (vla-Delete ins) (setq ins nil)))
  ins)

;;; ─── 11. MAIN COMMAND ────────────────────────────────────────────────────────
(defun c:R2 (/ old-echo cpt cx cy D
                 insul-idx insul-data bname ins)

  (setq old-echo (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  ;; Load DTS
  (rriser:load-dts)
  (vl-catch-all-apply 'dts:ensure-defaults '())

  (princ (strcat "\n[R2] System=" *DT:Type*
                 "  Insul=" (itoa *DT:Insul*)))

  ;; Pick centre
  (setq cpt (getpoint "\n[R2] Pick riser centre: "))
  (if (null cpt)
    (progn (setvar "CMDECHO" old-echo) (princ) (exit)))
  (setq cx (car cpt)  cy (cadr cpt))

  ;; Diameter
  (initget 6)
  (setq D (getreal (strcat "\n[R2] Diameter D <" (rtos *DT:D* 2 0) ">: ")))
  (if D (setq *DT:D* D) (setq D *DT:D*))

  ;; Insulation
  (setq insul-idx  (rriser:norm-insul *DT:Insul*)
        insul-data (rriser:get-insul  insul-idx))

  ;; Block name
  (setq bname (rriser:block-name D insul-idx))

  ;; Ensure layers
  (rriser:init-layers)

  ;; Build block
  (if (not (tblsearch "BLOCK" bname))
    (vl-catch-all-apply 'rriser:make-block (list bname D insul-data)))

  ;; Insert
  (setq ins (rriser:insert-block bname cx cy (rriser:layer-duct)))

  ;; Live rotate
  (if ins (rriser:rotate-block ins cx cy))

  (setvar "CMDECHO" old-echo)
  (princ))

;;; =============================================================================
;;; DUCT RISER MENU (DRR)
;;; =============================================================================
(defun c:DRR (/ choice)
  (initget "1 2")
  (setq choice (getkword "\nCreate: [1=Rectangular Riser / 2=Round Riser] <1>: "))
  (if (null choice) (setq choice "1"))
  (cond
    ((= choice "1") (c:R1))
    ((= choice "2") (c:R2)))
  (princ)
)

;;; ─── AUTO LOAD ───────────────────────────────────────────────────────────────
(princ "\n[DRR] Duct Riser commands loaded. Type DRR, R1, or R2 to start.")
(princ)
