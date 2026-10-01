;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Duct Tag.lsp
;;; Module      : Annotation
;;; Command     : DTAG
;;; Description : Tags a duct with elevation (BOD=rect, COD=round).
;;;               Supports live-preview move+rotate (with OSnap), ATT linking,
;;;               and automatic elevation calculation from a reference duct.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS ─────────────────────────────────────────
(if (not (boundp '*DTAG:Layer*)) (setq *DTAG:Layer* "Hvac-TagHeights"))

;; Tag geometry (mm): 655 x 170, R50, left-cell=285, right-cell=370
(setq dtag:TW 655.0  dtag:TH 170.0  dtag:TR 50.0
      dtag:W1 285.0  dtag:W2 370.0)

;; ─── SMALL HELPERS ───────────────────────────────────
(defun dtag:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R" (substr ms (max 1 (- (strlen ms) 4)))
               (substr frac 1 (min 4 (strlen frac)))))

(defun dtag:ensure-setup (/ ad lays)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) lays (vla-get-Layers ad))
  (if (not (tblsearch "LAYER" *DTAG:Layer*))
    (vl-catch-all-apply 'vla-Add (list lays *DTAG:Layer*)))
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))))

(defun dtag:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa)))
        (+ (cadr ip) (* bx sa) (* by ca))
        0.0))

(defun dtag:del (e) (if (and e (entget e)) (vl-catch-all-apply 'entdel (list e))))

;; ─── ATTRIB ACCESS ───────────────────────────────────

(defun dtag:get-att (ins-ent tag / e ed done result)
  (setq e (entnext ins-ent) done nil result "")
  (while (and e (not done))
    (setq ed (entget e))
    (cond
      ((= (cdr (assoc 0 ed)) "ATTRIB")
        (if (= (strcase (cdr (assoc 2 ed))) (strcase tag))
          (setq result (cdr (assoc 1 ed)))))
      ((= (cdr (assoc 0 ed)) "SEQEND")
        (setq done T)))
    (if (not done) (setq e (entnext e))))
  result)

(defun dtag:set-att (ins-ent tag new-val / e ed)
  (setq e (entnext ins-ent))
  (while e
    (setq ed (entget e))
    (cond
      ((= (cdr (assoc 0 ed)) "ATTRIB")
        (if (= (strcase (cdr (assoc 2 ed))) (strcase tag))
          (progn
            (entmod (subst (cons 1 new-val) (assoc 1 ed) ed))
            (entupd e)
            (setq e nil))))
      ((= (cdr (assoc 0 ed)) "SEQEND")
        (setq e nil)))
    (if e (setq e (entnext e)))))

;; ─── DUCT DETECTION ──────────────────────────────────

(defun dtag:detect (bn)
  (cond
    ((wcmatch bn "DTv9-*") (list "RECT"  "BOD" "BOD"))
    ((wcmatch bn "RDv2-*") (list "ROUND" "COD" "COD"))
    (T nil)))

;; Parse height from SIZE attrib:
;;   Rect: "600x400"  → search "x" → take part after → 400
;;   Round: "300%%c"  → no "x" → strip %%c suffix → 300 (diameter = height)
(defun dtag:parse-height (size-str / pos)
  (if (and size-str (/= size-str ""))
    (progn
      ;; Search lowercase "x" (not strcase, to avoid "X" mismatch)
      (setq pos (vl-string-search "x" size-str))
      (if pos
        ;; Rect: "WxH" → H is substring after "x"
        (atof (substr size-str (+ pos 2)))
        (progn
          ;; Round: "D%%c" or plain number → strip %% and everything after
          (setq pos (vl-string-search "%" size-str))
          (if pos
            (atof (substr size-str 1 pos))
            (atof size-str)))))   ; fallback: parse whole string
    nil))

;; ─── ELEVATION CALCULATION ───────────────────────────
;;
;; dtype / ref-dtype : "RECT" or "ROUND"
;; stored value      : BOD for RECT, COD for ROUND
;; setup-val         : positive = setup, negative = setdown

(defun dtag:calc-elev (dtype h1 ref-dtype ref-elev h2 align setup-val
                        / bod2 cod2 tod2 result)
  ;; Build reference box
  (cond
    ((= ref-dtype "RECT")
      (setq bod2 ref-elev
            cod2 (+ ref-elev (/ h2 2.0))
            tod2 (+ ref-elev h2)))
    ((= ref-dtype "ROUND")
      (setq cod2 ref-elev
            bod2 (- ref-elev (/ h2 2.0))
            tod2 (+ ref-elev (/ h2 2.0)))))
  ;; Compute stored value for target duct
  (cond
    ((= align "CL")
      (cond
        ((= dtype "RECT")  (setq result (+ (- cod2 (/ h1 2.0)) setup-val)))
        ((= dtype "ROUND") (setq result (+ cod2 setup-val)))))
    ((= align "BL")
      (cond
        ((= dtype "RECT")  (setq result (+ bod2 setup-val)))
        ((= dtype "ROUND") (setq result (+ bod2 (/ h1 2.0) setup-val)))))
    ((= align "TL")
      (cond
        ((= dtype "RECT")  (setq result (+ (- tod2 h1) setup-val)))
        ((= dtype "ROUND") (setq result (+ tod2 (- (/ h1 2.0)) setup-val))))))
  result)

;; ─── BLOCK DEFINITION ────────────────────────────────

(defun dtag:make-block (bname label-txt value-txt / lay W H R W1 W2 hw hh b x0)
  (setq lay *DTAG:Layer*
        W dtag:TW  H dtag:TH  R dtag:TR  W1 dtag:W1  W2 dtag:W2
        hw (/ W 2.0)  hh (/ H 2.0)  b 0.41421356)

  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") (cons 8 lay)
                 '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0)
                 '(10 0.0 0.0 0.0)))

  ;; Rounded rect: 8-vertex CCW LWPOLYLINE centred at (0,0)
  (entmake
    (append
      (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay)
            '(62 . 256) '(6 . "ByLayer")
            '(100 . "AcDbPolyline") '(90 . 8) '(70 . 1) '(43 . 0.0))
      (list (cons 10 (list (+ (- hw) R) (- hh))) '(42 . 0.0))
      (list (cons 10 (list (- hw R) (- hh))) (cons 42 b))
      (list (cons 10 (list hw (+ (- hh) R))) '(42 . 0.0))
      (list (cons 10 (list hw (- hh R))) (cons 42 b))
      (list (cons 10 (list (- hw R) hh)) '(42 . 0.0))
      (list (cons 10 (list (+ (- hw) R) hh)) (cons 42 b))
      (list (cons 10 (list (- hw) (- hh R))) '(42 . 0.0))
      (list (cons 10 (list (- hw) (+ (- hh) R))) (cons 42 b))))

  ;; Divider at -hw+W1
  (setq x0 (+ (- hw) W1))
  (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbLine")
                 (list 10 x0 (- hh) 0.0) (list 11 x0 hh 0.0)))

  ;; ATTDEF LABEL — left cell centre
  (setq x0 (+ (- hw) (/ W1 2.0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                 (list 10 x0 0.0 0.0) '(40 . 100.0) '(41 . 0.8)
                 (cons 1 label-txt) '(7 . "HVACS") '(72 . 1)
                 (list 11 x0 0.0 0.0)
                 '(100 . "AcDbAttributeDefinition")
                 '(2 . "LABEL") '(3 . "LABEL") '(70 . 0) '(74 . 2)))

  ;; ATTDEF VALUE — right cell centre
  (setq x0 (+ (- hw) W1 (/ W2 2.0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                 (list 10 x0 0.0 0.0) '(40 . 100.0) '(41 . 0.8)
                 (cons 1 value-txt) '(7 . "HVACS") '(72 . 1)
                 (list 11 x0 0.0 0.0)
                 '(100 . "AcDbAttributeDefinition")
                 '(2 . "VALUE") '(3 . "VALUE") '(70 . 0) '(74 . 2)))

  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd"))))

;; ─── INSERT TAG ──────────────────────────────────────

(defun dtag:insert (bname ip rot label-txt value-txt / lay W W1 W2 hw lx rx wpt)
  (setq lay *DTAG:Layer*
        W dtag:TW  W1 dtag:W1  W2 dtag:W2  hw (/ W 2.0))

  (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                 (cons 2 bname) (cons 10 ip)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)
                 (cons 50 rot) '(70 . 0) '(66 . 1)))

  (setq lx (+ (- hw) (/ W1 2.0)) wpt (dtag:xf lx 0.0 ip rot))
  (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                 (list 10 (car wpt) (cadr wpt) 0.0)
                 '(40 . 100.0) '(41 . 0.8) (cons 1 label-txt) (cons 50 rot)
                 '(7 . "HVACS") '(72 . 1)
                 (list 11 (car wpt) (cadr wpt) 0.0)
                 '(100 . "AcDbAttribute") '(2 . "LABEL") '(70 . 0) '(74 . 2)))

  (setq rx (+ (- hw) W1 (/ W2 2.0)) wpt (dtag:xf rx 0.0 ip rot))
  (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                 (list 10 (car wpt) (cadr wpt) 0.0)
                 '(40 . 100.0) '(41 . 0.8) (cons 1 value-txt) (cons 50 rot)
                 '(7 . "HVACS") '(72 . 1)
                 (list 11 (car wpt) (cadr wpt) 0.0)
                 '(100 . "AcDbAttribute") '(2 . "VALUE") '(70 . 0) '(74 . 2)))

  (entmake (list '(0 . "SEQEND") (cons 8 lay)))
  (entlast))

;; ─── GRREAD LOOP (move + rotate with OSnap preview) ──
;;
;; mode = "MOVE"   → update insertion point each frame
;; mode = "ROTATE" → update rotation angle, keep ip fixed
;;
;; grread T 4 0  — bit 4 enables OSnap tracking so type-5 coords ARE snapped.
;; Returns (ip rot) after user clicks.

;; Update an existing tag INSERT in-place via entmod (keeps entity stable → OSnap works)
(defun dtag:update-tag (ins-ent ip rot / ed e attred tag bx wpt W W1 W2 hw)
  (setq W dtag:TW  W1 dtag:W1  W2 dtag:W2  hw (/ W 2.0))
  ;; UPDATE INSERT position + rotation
  (setq ed (entget ins-ent))
  (setq ed (subst (cons 10 (list (car ip) (cadr ip) 0.0)) (assoc 10 ed) ed))
  (setq ed (subst (cons 50 rot) (assoc 50 ed) ed))
  (entmod ed)
  (entupd ins-ent)
  ;; UPDATE each ATTRIB position + rotation
  (setq e (entnext ins-ent))
  (while e
    (setq attred (entget e))
    (cond
      ((= (cdr (assoc 0 attred)) "ATTRIB")
        (setq tag (strcase (cdr (assoc 2 attred))))
        (setq bx (cond ((= tag "LABEL") (+ (- hw) (/ W1 2.0)))
                       ((= tag "VALUE") (+ (- hw) W1 (/ W2 2.0)))
                       (T 0.0)))
        (setq wpt (dtag:xf bx 0.0 ip rot))
        (setq attred (subst (cons 10 (list (car wpt) (cadr wpt) 0.0)) (assoc 10 attred) attred))
        (setq attred (subst (cons 11 (list (car wpt) (cadr wpt) 0.0)) (assoc 11 attred) attred))
        (setq attred (subst (cons 50 rot) (assoc 50 attred) attred))
        (entmod attred)
        (entupd e))
      ((= (cdr (assoc 0 attred)) "SEQEND")
        (setq e nil)))
    (if e (setq e (entnext e)))))

;; Preview loop: MOVE or ROTATE with live entmod preview + OSnap via grread bit 4
;; ins-ent-in: optional existing entity to reuse (nil = create new)
;; Returns (list ip rot ins-ent)
(defun dtag:preview-loop (mode bname ip0 rot0 label-txt value-txt ins-ent-in
                           / ins-ent gr-res gr-type gr-pt ip rot done)
  (setq ip ip0  rot rot0)
  ;; Reuse existing entity or create a fresh one
  (if ins-ent-in
    (progn (setq ins-ent ins-ent-in) (dtag:update-tag ins-ent ip rot))
    (setq ins-ent (dtag:insert bname ip rot label-txt value-txt)))
  (setq done nil)
  (while (not done)
    (setq gr-res  (grread T 6 0) ; 4 (osnap) + 2 (keyboard)
          gr-type (car gr-res)
          gr-pt   (cadr gr-res))
    (cond
      ;; Mouse move → update via entmod
      ((= gr-type 5)
        (if (listp gr-pt)
          (progn
            (cond
              ((= mode "MOVE")
                (setq ip (list (car gr-pt) (cadr gr-pt) 0.0)))
              ((= mode "ROTATE")
                (if (> (distance ip (list (car gr-pt) (cadr gr-pt))) 1.0)
                  (setq rot (angle ip (list (car gr-pt) (cadr gr-pt) 0.0))))))
            (dtag:update-tag ins-ent ip rot))))
      
      ;; Keyboard input
      ((= gr-type 2)
        (cond
          ((= gr-pt 32) ; SPACE -> toggle 45 deg
            (setq rot (rem (+ rot (/ pi 4.0)) (* 2.0 pi)))
            (dtag:update-tag ins-ent ip rot))
          ((= gr-pt 13) ; ENTER -> confirm
            (setq done T))
          ((= gr-pt 27) ; ESC -> cancel
            (dtag:del ins-ent)
            (princ "\n[DTAG] Cancelled.")
            (exit))))

      ;; Left click → confirm and exit loop
      ((= gr-type 3)
        (if (listp gr-pt)
          (cond
            ((= mode "MOVE")
              (setq ip (list (car gr-pt) (cadr gr-pt) 0.0)))
            ((= mode "ROTATE")
              (if (> (distance ip (list (car gr-pt) (cadr gr-pt))) 1.0)
                (setq rot (angle ip (list (car gr-pt) (cadr gr-pt) 0.0)))))))
        (dtag:update-tag ins-ent ip rot)
        (setq done T))

      ;; ESC / right-click → cancel
      ((or (= gr-type 25) (= gr-type 11))
        (dtag:del ins-ent)
        (princ "\n[DTAG] Cancelled.")
        (princ)
        (exit))))
  (list ip rot ins-ent))

;; ─── CALCULATION WIZARD ──────────────────────────────

(defun dtag:run-calc (duct-ent dtype att-tag
                       / h1 size1 ref-sel ref-ent ref-ed ref-bn
                         ref-info ref-dtype ref-att-tag ref-elev ref-h2
                         align-kw setup-kw setup-val result-val kw)

  ;; H1 — from target duct SIZE ATT
  (setq size1 (dtag:get-att duct-ent "SIZE")
        h1    (dtag:parse-height size1))
  (if (null h1)
    (progn
      (initget 6)
      (setq h1 (getreal "\n[DTAG] Enter height/diameter of target duct H1: "))))
  (if (null h1) (progn (princ "\n[DTAG] Cancelled.") (exit)))
  (princ (strcat "\n[DTAG] H1=" (rtos h1 2 0)))

  ;; Reference duct — loop until valid duct with elevation is chosen
  (setq ref-ent nil)
  (while (null ref-ent)
    (setq ref-sel (entsel "\n[DTAG] Click REFERENCE duct (must have elevation): "))
    (if (null ref-sel) (progn (princ "\n[DTAG] Cancelled.") (exit)))
    (setq ref-ent (car ref-sel)
          ref-ed  (entget ref-ent)
          ref-bn  (cdr (assoc 2 ref-ed)))
    (setq ref-info (dtag:detect ref-bn))
    (if (null ref-info)
      (progn
        (princ (strcat "\n[DTAG] Not a recognised duct: " ref-bn ". Pick again."))
        (setq ref-ent nil))
      (progn
        (setq ref-dtype   (nth 0 ref-info)
              ref-att-tag (nth 2 ref-info))
        (setq ref-elev (dtag:get-att ref-ent ref-att-tag))
        (if (or (null ref-elev) (= ref-elev "") (= ref-elev "---"))
          (progn
            (princ "\n[DTAG] Reference duct has NO elevation. Pick another (ESC to quit).")
            (setq ref-ent nil))
          (setq ref-elev (atof ref-elev))))))

  ;; H2 — auto from reference duct SIZE ATT
  (setq size1 (dtag:get-att ref-ent "SIZE")
        ref-h2 (dtag:parse-height size1))
  (if ref-h2
    (princ (strcat "\n[DTAG] H2 auto-detected: " (rtos ref-h2 2 0)))
    (progn
      (initget 6)
      (setq ref-h2 (getreal "\n[DTAG] Enter height/diameter of reference duct H2: "))
      (if (null ref-h2) (progn (princ "\n[DTAG] Cancelled.") (exit)))))
  (princ (strcat "\n[DTAG] Ref=" ref-dtype " Elev=" (rtos ref-elev 2 0)
                 " H2=" (rtos ref-h2 2 0)))

  ;; Alignment
  (initget "1 2 3 CL BL TL")
  (setq kw (getkword
    "\n[DTAG] Alignment [1=CenterLine / 2=BottomLine / 3=TopLine] <1=CenterLine>: "))
  (if (null kw) (setq kw "1"))
  (setq align-kw
    (cond ((or (= kw "1") (= kw "CL")) "CL")
          ((or (= kw "2") (= kw "BL")) "BL")
          ((or (= kw "3") (= kw "TL")) "TL")
          (T "CL")))
  (princ (strcat "\n[DTAG] Alignment: " align-kw))

  ;; Offset
  (initget "1 2 3 No Setup Setdown")
  (setq kw (getkword
    "\n[DTAG] Offset [1=No Offset / 2=Setup (up) / 3=Setdown (down)] <1>: "))
  (if (null kw) (setq kw "1"))
  (setq setup-kw
    (cond ((or (= kw "1") (= kw "No"))      "No")
          ((or (= kw "2") (= kw "Setup"))   "Setup")
          ((or (= kw "3") (= kw "Setdown")) "Setdown")
          (T "No")))
  (setq setup-val 0.0)
  (cond
    ((= setup-kw "Setup")
      (initget 6)
      (setq setup-val (getreal "\n[DTAG] Setup height (mm, positive): "))
      (if (null setup-val) (setq setup-val 0.0)))
    ((= setup-kw "Setdown")
      (initget 6)
      (setq setup-val (getreal "\n[DTAG] Setdown depth (mm, positive, stored as negative): "))
      (if (null setup-val) (setq setup-val 0.0))
      (setq setup-val (- setup-val))))

  ;; Calculate
  (setq result-val
    (dtag:calc-elev dtype h1 ref-dtype ref-elev ref-h2 align-kw setup-val))
  (if (null result-val)
    (progn (princ "\n[DTAG] Calculation failed.") "---")
    (progn
      (princ (strcat "\n[DTAG] → " att-tag " = " (rtos result-val 2 0)))
      (dtag:set-att duct-ent att-tag (rtos result-val 2 0))
      (rtos result-val 2 0))))

;; ─── MAIN COMMAND ────────────────────────────────────

(defun c:DTAG (/ sel ent ed bn info dtype label att-tag val kw
                 bname ip0 rot res ins-ent done-rot gr-res gr-type gr-pt)

  (dtag:ensure-setup)

  ;; STEP 1: pick duct
  (if (and *TG_SELECTED_ENTITY* (entget *TG_SELECTED_ENTITY*))
    (setq ent *TG_SELECTED_ENTITY*)
    (progn
      (setq sel (entsel "\n[DTAG] Select duct to tag: "))
      (if (null sel) (progn (princ "\n[DTAG] Cancelled.") (princ) (exit)))
      (setq ent (car sel))
    )
  )
  (setq ed (entget ent)
        bn (cdr (assoc 2 ed)))

  (if (not (= (cdr (assoc 0 ed)) "INSERT"))
    (progn (princ "\n[DTAG] Not a block INSERT.") (princ) (exit)))

  (setq info (dtag:detect bn))
  (if (null info)
    (progn (princ (strcat "\n[DTAG] Unrecognised duct: " bn)) (princ) (exit)))

  (setq dtype   (nth 0 info)
        label   (nth 1 info)
        att-tag (nth 2 info))

  ;; STEP 2: elevation value
  (setq val (dtag:get-att ent att-tag))
  (if (or (null val) (= val "") (= val "---"))
    (progn
      (initget "1 2")
      (setq kw (getkword
        "\n[DTAG] Elevation ATT is empty. [1=Calc elevation / 2=Place empty tag] <1>: "))
      (if (null kw) (setq kw "1"))
      (if (= kw "1")
        (setq val (dtag:run-calc ent dtype att-tag))
        (setq val "")))
    (princ (strcat "\n[DTAG] " label " = " val)))

  ;; STEP 3: build block definition
  (setq bname (strcat "DTag-" label (dtag:rand-sfx)))
  (dtag:make-block bname label val)

  ;; Initial position = duct insertion point
  (setq ip0 (cdr (assoc 10 ed)))
  (if (= (length ip0) 2) (setq ip0 (append ip0 '(0.0))))

  ;; STEP 4: MOVE & ROTATE preview
  (princ "\n[DTAG] Move to position, SPACE to rotate, click to place: ")
  (setq res    (dtag:preview-loop "MOVE" bname ip0 0.0 label val nil)
        ip0     (nth 0 res)
        rot     (nth 1 res)
        ins-ent (nth 2 res))

  (princ (strcat "\n[DTAG] Tag placed | " label "=" val
                 " | Rot=" (rtos (* rot (/ 180.0 pi)) 2 1) "°"))
  (princ))

(princ "\n[TBH] Duct Tag loaded. Command: DTAG")
(princ)
