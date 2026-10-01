;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Round Duct Transition.lsp
;;; Module      : Draw\Create
;;; Command     : T2
;;; Description : Draws round duct reducers and transitions.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Enter Start Diameter and End Diameter.
;;; 3. Input length and place fitting.
;;; TBH-HEADER-END
;;; =============================================================================
(vl-load-com)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*DT:Type*))   (setq *DT:Type*   "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul*  0))
(if (not (boundp '*T2:W1*))     (setq *T2:W1*     600.0))
(if (not (boundp '*T2:W2*))     (setq *T2:W2*     400.0))
(if (not (boundp '*T2:Debug*))  (setq *T2:Debug*  T))

;; ─── DEPENDENCIES ───────────────────────────────────
(defun t2:load-deps (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if fp (load fp)))))


;; ─── HELPERS ────────────────────────────────────────
(defun t2:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos (strlen delim) 1))))
  (append lst (list str)))

(defun t2:norm-type (tp)
  (if (= (type tp) 'STR) (strcase tp) "SA"))

(defun t2:lo (tp)
  (cdr (assoc (t2:norm-type tp)
    '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra")
      ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))

(defun t2:ls (tp / lo)
  (setq lo (t2:lo tp))
  (if lo (strcat lo "-shading") "Hvacduct-sa-shading"))

(defun t2:safe-layer (lay)
  (if (= (type lay) 'STR) lay "Hvacduct-sa"))

(defun t2:ensure-ltype (name /)
  (if (and (= (type name) 'STR) (not (tblsearch "LTYPE" name)))
    (progn
      (vl-catch-all-apply 'vl-cmdf (list "_.-LINETYPE" "_Load" name "acad.lin" ""))
      (if (not (tblsearch "LTYPE" name))
        (vl-catch-all-apply 'vl-cmdf (list "_.-LINETYPE" "_Load" name "acadiso.lin" ""))))))

(defun t2:dbg (msg)
  ;; ╔══ DEBUG-START ══════════════════════════════════════════════
  ;; ║ Runtime trace for T2 command flow and value inspection.
  ;; ╚══ DEBUG-END ════════════════════════════════════════════════
  (if *T2:Debug* (princ (strcat "\n[T2-DEBUG] " msg))))

(defun t2:resolve-rot (p1 p2 / dx dy)
  ;; Horizontal rule:
  ;; - connect left side of horizontal duct  => 180 deg
  ;; - connect right side of horizontal duct => 0 deg
  ;; Non-horizontal keeps geometric angle.
  (setq dx (- (car p2) (car p1))
        dy (- (cadr p2) (cadr p1)))
  (if (<= (abs dy) 1e-8)
    (if (< dx 0.0) pi 0.0)
    (angle p1 p2)))

(defun t2:norm-ang (a)
  (while (< a 0.0) (setq a (+ a (* 2.0 pi))))
  (while (>= a (* 2.0 pi)) (setq a (- a (* 2.0 pi))))
  a)

(defun t2:readable-ang (a / d)
  (setq a (t2:norm-ang a)
        d (* 180.0 (/ a pi)))
  (if (and (>= d 100.0) (<= d 270.0))
    (t2:norm-ang (+ a pi))
    a))

(defun t2:text-style (sty)
  (if (tblsearch "STYLE" sty) sty "Standard"))

(defun t2:text-height () 100.0)

(defun t2:text-width-factor () 0.8)

(defun t2:text-oblique (sty)
  (if (= sty "HVACSI") 0.2618 0.0))

(defun t2:dxf-put (code val ed)
  (if (assoc code ed)
    (subst (cons code val) (assoc code ed) ed)
    (append ed (list (cons code val)))))

(defun t2:update-text-world (ent pt ang / ed)
  (if (and ent pt)
    (progn
      (setq ed (entget ent))
      (setq ed (t2:dxf-put 10 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (t2:dxf-put 11 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (t2:dxf-put 50 ang ed))
      (entmod ed)
      (entupd ent))))

(defun t2:bring-to-front (ent)
  (if (and ent (entget ent))
    (vl-catch-all-apply 'vl-cmdf (list "_.DRAWORDER" ent "" "_Front"))))

(defun t2:make-text-preview (txt sty pt txtAng just / ent obl)
  (setq sty (t2:text-style sty)
        obl (t2:text-oblique sty))
  (setq ent
    (entmakex
      (list '(0 . "TEXT") '(8 . "Hvacduct-Text")
            (cons 10 pt) (cons 40 (t2:text-height)) (cons 41 (t2:text-width-factor))
            (cons 1 txt) (cons 7 sty) (cons 72 just) '(73 . 2)
            (cons 11 pt) (cons 50 txtAng) (cons 51 obl))))
  (if ent (entupd ent))
  (t2:bring-to-front ent)
  ent)

(defun t2:place-text-preview (ent msg pt ang / ev done key quick-angles quick-idx)
  (t2:update-text-world ent pt ang)
  (setq quick-angles (list 0.0 (/ pi 6.0) (/ pi 4.0) (/ pi 3.0) (/ pi 2.0))
        quick-idx 0)
  (prompt (strcat "\n" msg " [Move mouse, ','=CW, '.'=CCW, SPACE=Toggle 0°/30°/45°/60°/90°, Click=Place, ESC=Cancel]: "))
  (setq done nil)
  (while (not done)
    (setq ev (grread T 15 0))
    (cond
      ((= (car ev) 5)
        (setq pt (cadr ev))
        (t2:update-text-world ent pt ang))
      ((= (car ev) 3)
        (setq pt (cadr ev))
        (t2:update-text-world ent pt ang)
        (setq done T))
      ((= (car ev) 2)
        (setq key (cadr ev))
        (cond
          ((= key 44)
            (setq ang (t2:norm-ang (- ang (/ pi 36.0))))
            (t2:update-text-world ent pt ang))
          ((= key 46)
            (setq ang (t2:norm-ang (+ ang (/ pi 36.0))))
            (t2:update-text-world ent pt ang))
          ((= key 32)
            (setq quick-idx (rem (1+ quick-idx) 5))
            (setq ang (nth quick-idx quick-angles))
            (t2:update-text-world ent pt ang)
            (prompt (strcat "\n[" (cond ((= quick-idx 0) "0°") ((= quick-idx 1) "30°") ((= quick-idx 2) "45°") ((= quick-idx 3) "60°") (T "90°")) "]")))
          ((= key 27)
            (setq done 'cancel))))))
  (if (eq done 'cancel) nil (list pt ang)))

(defun t2:add-text-tag (txt sty base-pt ang just msg / ghost res obl)
  (setq ghost (t2:make-text-preview txt sty base-pt ang just))
  (setq res (t2:place-text-preview ghost msg base-pt ang))
  (if ghost (entdel ghost))
  (if res
    (progn
      (setq base-pt (car res)
            ang     (cadr res)
            sty     (t2:text-style sty)
            obl     (t2:text-oblique sty))
      (entmake
        (list '(0 . "TEXT") '(8 . "Hvacduct-Text")
              (cons 10 (list (car base-pt) (cadr base-pt) 0.0))
              (cons 40 (t2:text-height)) (cons 41 (t2:text-width-factor)) (cons 1 txt)
              (cons 7 sty) (cons 72 just) '(73 . 2)
              (cons 11 (list (car base-pt) (cadr base-pt) 0.0))
              (cons 50 ang) (cons 51 obl)))
          res)))

(defun t2:type-tag (w1 w2 oy / top1 top2 bot1 bot2 tol top-flat bot-flat)
  ;; ET/ET  : symmetric about PS-PE axis (local oy = 0)
  ;; SL/ET  : one side straight (top or bottom 4 points collinear)
  ;; UNEQ   : all other cases
  (setq tol 1e-6
        top1 (/ w1 2.0)
        bot1 (- (/ w1 2.0))
        top2 (+ oy (/ w2 2.0))
        bot2 (- oy (/ w2 2.0))
        top-flat (equal top1 top2 tol)
        bot-flat (equal bot1 bot2 tol))
  (cond
    ((equal oy 0.0 tol) "ET/ET")
    ((or top-flat bot-flat) "SL/ET")
    (T "UNEQ")))

(defun t2:init (tp / ad lays l-insul)
  (setq tp   (t2:norm-type tp)
        ad   (vla-get-ActiveDocument (vlax-get-acad-object))
        lays (vla-get-Layers ad))
  ;; Only create missing styles. Existing styles stay untouched.
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))
  (if (not (tblsearch "STYLE" "HVACSI"))
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACSI" "Arial Narrow|b0|i1|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))
  (foreach ln (list (t2:lo tp) (t2:ls tp)
                    "Hvacduct-Text" "Hvacduct-Insul" "Hvacins" "HVACDUCT-FLANGE")
    (if (and ln (not (tblsearch "LAYER" ln)))
      (vl-catch-all-apply 'vla-Add (list lays ln))))
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul))
    (vl-catch-all-apply 'vla-put-Color (list l-insul 118)))
  (t2:ensure-ltype "VSDD")
  (t2:ensure-ltype "Ins"))

(defun t2:get-insul (idx)
  (cond
    ((= idx 0) '("" 0 "SOLID" 1.0 0.0 0 0))
    ((= idx 1) '("INT25"   25 "INS25I"  1.0       0.0  2 1))
    ((= idx 2) '("INT50"   50 "INS50I"  1.0       0.0  2 1))
    ((= idx 3) '("INT75"   75 "INS75I"  40.0      0.0  2 1))
    ((= idx 4) '("INT100" 100 "INS100I" 1.0       45.0 2 1))
    ((= idx 5) '("EXT25"   25 "ANSI31"  43.478261 0.0  1 2))
    ((= idx 6) '("EXT50"   50 "ANSI32"  15.0      0.0  1 2))
    ((= idx 7) '("EXT75"   75 "ANSI34"  22.222222 0.0  1 2))
    (T         '("" 0 "SOLID" 1.0 0.0 0 0))))

;; ─── RDv2 BLOCK PARSING ─────────────────────────────
;;  Block name format:  RDv2-{System}-{L}L-D{Diameter}[-InsPrefix]

(defun t2:extract-system (bn / parts)
  (if (and (= (type bn) 'STR) (wcmatch bn "RDv2-*"))
    (progn
      (setq parts (t2:split bn "-"))
      (if (>= (length parts) 2) (nth 1 parts) nil))
    nil))

(defun t2:extract-width (bn / parts dtok)
  ;; Returns round duct diameter from "D{Diameter}" token (index 3) or nil
  (if (and (= (type bn) 'STR) (wcmatch bn "RDv2-*"))
    (progn
      (setq parts (t2:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq dtok (nth 3 parts))
          (if (= (substr dtok 1 1) "D")
            (atof (substr dtok 2))
            nil))
        nil))
    nil))

(defun t2:extract-length (bn / parts tok)
  ;; Returns round duct length from "{Length}L" token (index 2) or nil
  (if (and (= (type bn) 'STR) (wcmatch bn "RDv2-*"))
    (progn
      (setq parts (t2:split bn "-"))
      (if (>= (length parts) 3)
        (progn
          (setq tok (nth 2 parts))
          (if (wcmatch tok "*L")
            (atof (substr tok 1 (1- (strlen tok))))
            nil))
        nil))
    nil))

(defun t2:extract-insulation (bn / parts insStr insMap)
  (setq insMap '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4)
                 ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  (if (and (= (type bn) 'STR) (wcmatch bn "RDv2-*"))
    (progn
      (setq parts (t2:split bn "-"))
      (if (>= (length parts) 5)
        (progn
          (setq insStr (nth 4 parts))
          (if (assoc insStr insMap) (cdr (assoc insStr insMap)) 0))
        0))
    0))

(defun t2:scan-duct-near (pt / ss ent ed bn sys w ins ang dlen ip ep d1 d2 face-rot)
  ;; Return (list sys diam ins face-rot) from the nearest RDv2 block within 150 mm.
  ;; Returns nil if nothing found.
  (setq ss (ssget "C"
                  (list (- (car pt) 150.0) (- (cadr pt) 150.0) 0.0)
                  (list (+ (car pt) 150.0) (+ (cadr pt) 150.0) 0.0)
                  '((0 . "INSERT") (2 . "RDv2-*"))))
  (if ss
    (progn
      (setq ent (ssname ss 0)
            ed  (entget ent)
            bn  (cdr (assoc 2 ed))
            ang (cond ((assoc 50 ed) (cdr (assoc 50 ed))) (T 0.0)))
      (if (= (type bn) 'STR)
        (progn
          (setq sys (t2:extract-system bn)
                w   (t2:extract-width  bn)
                ins (t2:extract-insulation bn)
                dlen (t2:extract-length bn)
                ip   (cdr (assoc 10 ed)))
          (if (and ip dlen)
            (setq ep (list (+ (car ip) (* dlen (cos ang)))
                           (+ (cadr ip) (* dlen (sin ang)))
                           0.0))
            (setq ep nil))
          ;; Determine which duct end the user picked.
          ;; If near insertion/start face => fitting should point opposite duct axis.
          (if (and ip ep)
            (progn
              (setq d1 (distance pt ip)
                    d2 (distance pt ep)
                    face-rot (if (<= d1 d2) (+ ang pi) ang)))
            (setq face-rot ang))
          (if (and sys w) (list sys w ins face-rot) nil))
        nil))
    nil))

;; ─── GEOMETRY (local coords) ────────────────────────
;;  Origin = start face centre (0 0).
;;  Axis   = +X (block drawn horizontally; INSERT is rotated by caller).
;;
;;  Fitting outline follows 8 points:
;;  P1 → P2 → P3 → P4 → P7 → P8 → P9 → P10 (closed)
;;  where: P1-P2 = P3-P4 = P7-P8 = P9-P10 = 50 mm (max, clamped by L/2)
;;  and end-face center offset in local Y is oy (derived from picked PE).
;;  Centreline:    (0 0) → (L 0)

(defun t2:body-pts (w1 w2-face l oy / os x2 x3 top1 bot1 top2 bot2)
  (setq os (min 50.0 (/ l 2.0))
        x2 os
        x3 (- l os)
        top1 (/ w1 2.0)
        bot1 (- (/ w1 2.0))
  top2 (+ oy (/ w2-face 2.0))
  bot2 (- oy (/ w2-face 2.0)))

  (list
    (list 0.0 top1 0.0)    ;; P1
    (list x2  top1 0.0)    ;; P2
    (list x3  top2 0.0)    ;; P3
    (list l   top2 0.0)    ;; P4
    (list l   bot2 0.0)    ;; P7
    (list x3  bot2 0.0)    ;; P8
    (list x2  bot1 0.0)    ;; P9
    (list 0.0 bot1 0.0)    ;; P10
  ))

;; Insulation outline:  mode=1 internal (shrink), mode=2 external (grow)
(defun t2:insul-pts (w1 w2 l thk mode / d)
  (setq d (if (= mode 1) thk (- thk)))
  (list
    (list 0.0 (- (/ w1  2.0) d) 0.0)   ;; P1-ins
    (list 0.0 (+ (/ w1 -2.0) d) 0.0)   ;; P2-ins
    (list l   (+ (/ w2 -2.0) d) 0.0)   ;; P3-ins
    (list l   (- (/ w2  2.0) d) 0.0))) ;; P4-ins

;; ─── LOW-LEVEL draw helpers ─────────────────────────
(defun t2:enmake-pline (lay pts closed color ltype / lst i)
  (setq lay (t2:safe-layer lay))
  (setq lst (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity")
                  (cons 8 lay) (cons 62 color) (cons 6 ltype)
                  '(100 . "AcDbPolyline")
                  (cons 90 (length pts))
                  (cons 70 (if closed 1 0))
                  '(43 . 0.0)))
  (setq i 0)
  (while (< i (length pts))
    (setq lst (append lst (list (cons 10 (nth i pts)))))
    (setq i (1+ i)))
  (entmake lst))

(defun t2:enmake-line (lay p1 p2 color ltype)
  (entmake
    (list '(0 . "LINE") '(100 . "AcDbEntity")
          (cons 8 (t2:safe-layer lay)) (cons 62 color) (cons 6 ltype)
          '(100 . "AcDbLine")
          (cons 10 p1) (cons 11 p2))))

(defun t2:shift-pt-y (pt dy)
  (list (car pt) (+ (cadr pt) dy) (if (caddr pt) (caddr pt) 0.0)))

;; ─── HATCH INTO NAMED BLOCK ─────────────────────────
(defun t2:add-hatch-to-block (bname lay pat scl angdeg tp-h pts color bottom
                              / ad blks bdef hobj flat spts pline loop i
                                extdict sorttable objs)
  (setq ad   (vla-get-ActiveDocument (vlax-get-acad-object))
        blks (vla-get-Blocks ad)
        bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp-h pat :vlax-false 0)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vl-catch-all-apply 'vla-put-Layer        (list hobj lay))
          (vl-catch-all-apply 'vla-put-Color        (list hobj color))
          (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl))
          (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angdeg 180.0) pi)))
          (setq flat '())
          (foreach p pts (setq flat (append flat (list (car p) (cadr p)))))
          (setq spts (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length flat)))))
          (vlax-safearray-fill spts flat)
          (setq pline (vla-AddLightWeightPolyline bdef spts))
          (vla-put-Closed pline :vlax-true)
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0)))
          (vlax-safearray-put-element loop 0 pline)
          (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop))
          (vl-catch-all-apply 'vla-Evaluate        (list hobj))
          (vl-catch-all-apply 'vla-Delete          (list pline))
          (if bottom
            (progn
              (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list bdef)))
              (if (not (vl-catch-all-error-p extdict))
                (progn
                  (setq sorttable
                    (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS")))
                  (if (vl-catch-all-error-p sorttable)
                    (setq sorttable
                      (vl-catch-all-apply 'vla-AddObject
                        (list extdict "ACAD_SORTENTS" "AcDbSortentsTable"))))
                  (if (not (vl-catch-all-error-p sorttable))
                    (progn
                      (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0)))
                      (vlax-safearray-put-element objs 0 hobj)
                      (vl-catch-all-apply 'vla-MoveToBottom (list sorttable objs))))))))
          T)))))

;; ─── BLOCK GENERATION ───────────────────────────────
(defun t2:get-ins-prefix (idx / r)
  ;; ╔══ DEBUG-START ══════════════════════════════════════════════
  ;; ║ Use local insulation table to avoid hard dependency on dt:get-insul.
  ;; ║ Expected: always returns string prefix or empty string.
  ;; ╚══ DEBUG-END ════════════════════════════════════════════════
  (setq r (t2:get-insul idx))
  (if (and (listp r) (= (type (car r)) 'STR)) (car r) ""))

(defun t2:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun t2:block-name (tp w1 w2 l oy insidx end-bare-p / prf)
  (setq prf (t2:get-ins-prefix insidx))
  (strcat "T2v10-" (t2:norm-type tp) "-"
          (rtos w1 2 0) "x" (rtos w2 2 0) "-L" (rtos l 2 0)
          "-OY" (rtos oy 2 0)
          (if end-bare-p "-EB" "")
          (if (= prf "") "" (strcat "-" prf))
          (t2:rand-sfx)))

(defun t2:make-block (bname tp w1 w2 l oy insidx end-bare-p
                      / idata thk pat scl patang tph mode
                        lo ls body hbody d d-end w2-face topIns botIns p4 p7 p5 p6)
  (setq idata  (t2:get-insul insidx)
        thk    (nth 1 idata)
        pat    (nth 2 idata)
        scl    (nth 3 idata)
        patang (nth 4 idata)
        tph    (nth 5 idata)
        mode   (nth 6 idata)
        lo     (t2:safe-layer (t2:lo tp))
        ls     (t2:ls tp)
          ;; Special case: START internal insulation + END bare duct.
          ;; End face clear size must equal D2, so end outer face becomes D2 + 2*thk.
          w2-face (if (and end-bare-p (= mode 1)) (+ w2 (* 2.0 thk)) w2)
          body   (t2:body-pts w1 w2-face l oy)
        ;; body already in CCW order: P1→P2→P3→P4→P7→P8→P9→P10
        hbody  body)
        (t2:dbg (strcat "body-face sizes: w1=" (rtos w1 2 0)
            " w2=" (rtos w2 2 0)
            " w2-face=" (rtos w2-face 2 0)))

  ;; Open block definition
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0")
                 '(100 . "AcDbBlockBegin") (cons 2 bname)
                 '(70 . 0) '(10 0.0 0.0 0.0)))

  ;; Outline polyline (closed trapezoid)
  (t2:enmake-pline lo hbody T 256 "ByLayer")

  ;; Centreline from PS to actual PE of the T2 fitting.
  ;; PE in local coordinates is (L, oy), not (L, 0).
  (t2:enmake-line lo '(0.0 0.0 0.0) (list l oy 0.0) 1 "VSDD")

  ;; Insulation outline lines (on Hvacins layer)
  (if (> mode 0)
    (progn
      ;; Internal: shrink inward. External: grow outward.
      (setq d (if (= mode 1) thk (- thk)))
    ;; Special case: START internal insulation + END bare duct.
    ;; At PE face, clear section must equal D2, while outer face is D2 + 2*thk.
    (setq d-end (if (and end-bare-p (= mode 1)) thk d))
    ;; End-face insulation points:
    ;; P5 = P4 shifted toward center by thk (internal) / outward (external)
    ;; P6 = P7 shifted toward center by thk (internal) / outward (external)
    (setq p4 (nth 3 body)
      p7 (nth 4 body)
      p5 (t2:shift-pt-y p4 (- d-end))
      p6 (t2:shift-pt-y p7 d-end))
    (t2:dbg (strcat "ins(mode=" (itoa mode) ", thk=" (rtos thk 2 0) ", d=" (rtos d 2 0)
            ", d-end=" (rtos d-end 2 0)
            ", end-bare=" (if end-bare-p "T" "nil")
            ") P5=" (vl-princ-to-string p5)
            " P6=" (vl-princ-to-string p6)))
      ;; Top insulation polyline follows P1->P2->P3->P4 and shifts toward center by -d in Y.
      (setq topIns
        (list (t2:shift-pt-y (nth 0 body) (- d))
              (t2:shift-pt-y (nth 1 body) (- d))
              (t2:shift-pt-y (nth 2 body) (- d))
        p5))
      ;; Bottom insulation polyline follows P10->P9->P8->P7 and shifts toward center by +d in Y.
      (setq botIns
        (list (t2:shift-pt-y (nth 7 body) d)
              (t2:shift-pt-y (nth 6 body) d)
              (t2:shift-pt-y (nth 5 body) d)
        p6))
      (t2:enmake-pline "Hvacins" topIns nil 256 "Ins")
      (t2:enmake-pline "Hvacins" botIns nil 256 "Ins")))

  ;; Close block
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))

  ;; Hatches (insulation first so shading ends up on top visually)
  (if (> mode 0)
    (t2:add-hatch-to-block bname "Hvacduct-Insul" pat scl patang tph hbody 256 T))
  (t2:add-hatch-to-block bname ls "SOLID" 1.0 0.0 0 hbody 256 T)
  T)

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:T2 (/ pt-start pt-end
               scan1 scan2
               det-sys det-w1 det-ins det-w2 det-ang det-ins2
               w1 w2 l rot bn
               l-auto l-inp dx dy ux uy oy
               vx vy dotf dotb end-bare-p
               ins-ok type-tag len-tag tag-ang tag-base type-res)

  ;; ╔══ DEBUG-START ══════════════════════════════════════════════
  ;; ║ Entry trace for T2 run.
  ;; ╚══ DEBUG-END ════════════════════════════════════════════════
  (t2:dbg (strcat "Command start. *DT:Type*=" (if (= (type *DT:Type*) 'STR) *DT:Type* "<nil>")
                  " *DT:Insul*=" (itoa (fix *DT:Insul*))))

  (t2:load-deps)
  (vl-catch-all-apply 'dts:ensure-defaults nil)
  (vl-catch-all-apply 'dts:sync-shape (list "RECT"))

  ;; ── B1: pick start point (centre of duct-1 face) ──────────────────────
  (setq pt-start (getpoint "\n[T2] Pick START – centre of duct-1 face: "))
  (if (null pt-start) (progn (princ "\n[T2] Cancelled.") (exit)))

  ;; ── B1: pick end point (centre of duct-2 face) ────────────────────────
  (setq pt-end (getpoint pt-start "\n[T2] Pick END   – centre of duct-2 face: "))
  (if (null pt-end) (progn (princ "\n[T2] Cancelled.") (exit)))

  ;; ── Auto-detect from RDv2 blocks near each picked point ───────────────
  (setq scan1 (t2:scan-duct-near pt-start)
        scan2 (t2:scan-duct-near pt-end))
  (t2:dbg (strcat "scan1=" (vl-princ-to-string scan1) " scan2=" (vl-princ-to-string scan2)))

  ;; Inherit system / D1 / insulation from duct near start
  (if scan1
    (progn
      (setq det-sys (nth 0 scan1)
        det-w1  (nth 1 scan1)
        det-ins (nth 2 scan1)
        det-ang (nth 3 scan1))
      (princ (strcat "\n[T2] Detected at start → Sys:" det-sys
             "  D1:" (rtos det-w1 2 0)
                     "  Insul:" (rtos det-ins 2 0))))
    (progn
      (setq det-sys (if (= (type *DT:Type*) 'STR) *DT:Type* "SA")
            det-w1  *T2:W1*
      det-ins *DT:Insul*
      det-ang nil)
      (princ "\n[T2] No RDv2 near start – using session defaults.")))

  ;; Inherit D2 from duct near end
  (if (and scan2 (nth 1 scan2))
    (progn
      (setq det-w2 (nth 1 scan2)
            det-ins2 (nth 2 scan2))
      (princ (strcat "\n[T2] Detected at end   → D2:" (rtos det-w2 2 0))))
    (setq det-w2 det-w1
          det-ins2 det-ins))
  (t2:dbg (strcat "det-sys=" det-sys
                  " det-w1=" (rtos det-w1 2 2)
                  " det-w2=" (rtos det-w2 2 2)
                  " det-ins=" (itoa (fix det-ins))
                  " det-ins2=" (itoa (fix det-ins2))
                  " face-rot=" (if det-ang (rtos (* (/ 180.0 pi) det-ang) 2 2) "nil")))

    ;; ── Two-step flow: auto-assign D1/D2 (no extra prompts) ──────────────
    (setq w1 det-w1
      w2 det-w2
      *T2:W1* w1
      *T2:W2* w2)

        ;; ── Compute axis rotation and auto geometric length ───────────────────
        ;; Priority: use actual picked START face orientation from RDv2.
        (setq dx (- (car pt-end) (car pt-start))
          dy (- (cadr pt-end) (cadr pt-start)))
        (if det-ang
          (setq rot det-ang)
      (setq rot (t2:resolve-rot pt-start pt-end)))

        (setq rot (t2:norm-ang rot)
          ux  (cos rot)
          uy  (sin rot)
          l-auto (abs (+ (* dx ux) (* dy uy)))
          ;; local Y of PE in T2 frame (start face center = 0)
          ;; matches coordinate examples: top2 = oy + D2/2, bot2 = oy - D2/2
          oy (+ (* dx (- uy)) (* dy ux)))
    (t2:dbg (strcat "rot(deg)=" (rtos (* (/ 180.0 pi) rot) 2 2)))
    (t2:dbg (strcat "l-auto(projection)=" (rtos l-auto 2 2)
        "  ps-pe=" (rtos (distance pt-start pt-end) 2 2)))
    (t2:dbg (strcat "oy(local)=" (rtos oy 2 2)))

    ;; ── Step 3: optional numeric L input ──────────────────────────────────
    ;; - Enter/Space (no numeric input): use auto geometric length to PE.
    ;; - Numeric input: enforce that value as face-to-face spacing L.
    (initget 6)
    (setq l-inp (getreal (strcat "\n[T2] Length L <" (rtos l-auto 2 0) ">: ")))
    (if l-inp (setq l l-inp) (setq l l-auto))

  (if (< l 1.0)
    (progn
      (princ "\n[T2] Error: Start and End points are too close.")
      (exit)))

  ;; Update session globals
  (setq *DT:Type*  det-sys
        *DT:Insul* det-ins)

  ;; ── Initialise layers, build block if not already cached ──────────────
  (t2:init det-sys)

  (setq end-bare-p (and (> det-ins 0) (< det-ins 5) (= det-ins2 0)))
  (setq bn (t2:block-name det-sys w1 w2 l oy det-ins end-bare-p))
  (t2:dbg (strcat "block-name=" bn))
  (if (not (tblsearch "BLOCK" bn))
    (t2:make-block bn det-sys w1 w2 l oy det-ins end-bare-p))

  ;; ── Insert block at start point, rotated along duct axis ──────────────
  (setq ins-ok
    (entmake
      (list '(0 . "INSERT") '(100 . "AcDbEntity")
            (cons 8 (t2:safe-layer (t2:lo det-sys)))
            '(62 . 256) '(6 . "ByLayer")
            '(100 . "AcDbBlockReference")
            (cons 2 bn)
            (cons 10 pt-start)
            '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)
            (cons 50 rot))))
  (if ins-ok
    (progn
      (princ (strcat "\n[T2] Placed: "
                     "D" (rtos w1 2 0) " → D" (rtos w2 2 0)
                     "  L=" (rtos l 2 0)
                     "  Sys=" det-sys))
      (setq type-tag (t2:type-tag w1 w2 oy)
            len-tag  (strcat (rtos l 2 0) "L")
        tag-ang  0.0
            tag-base (polar pt-start (angle pt-start pt-end) (/ (max l 200.0) 2.0)))
      (t2:dbg (strcat "type-tag=" type-tag " len-tag=" len-tag
                      " tag-ang=" (rtos (* (/ 180.0 pi) tag-ang) 2 2)))
      (setq type-res
        (t2:add-text-tag type-tag "HVACS" tag-base tag-ang 1 "[T2] Place TYPE tag"))
      (if type-res
        (t2:add-text-tag len-tag "HVACSI" (car type-res) (cadr type-res) 1 "[T2] Place LENGTH tag")
        (princ "\n[T2] TYPE tag skipped.")))
    (princ "\n[T2] Error: Block insertion failed."))

  (princ))

(princ "\n[TBH] T2 (Round Transition) loaded.  Type T2 to start.")
(princ)
