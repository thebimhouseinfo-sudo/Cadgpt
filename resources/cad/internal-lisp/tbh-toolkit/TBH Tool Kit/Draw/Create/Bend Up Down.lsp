;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Bend Up Down.lsp
;;; Module      : Draw\Create
;;; Command     : BE, E1U, E1D, E11U, E11D, EB
;;; Description : Draws vertical up/down bends and elbows for duct systems.
;;;
;;; Usage       :
;;; 1. BE   - New bend workflow. Select Radius/Mitered, pick duct end,
;;;           enter angle for Radius only, then Space toggles Up/Down.
;;; 2. E1U  - Direct radius elbow Up.
;;; 3. E1D  - Direct radius elbow Down.
;;; 4. E11U - Direct 90-degree mitered elbow Up.
;;; 5. E11D - Direct 90-degree mitered elbow Down.
;;; 6. EB   - Legacy master command: select elbow type and Up/Down first.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS & DEFAULTS ──────────────────────────────
(if (not (boundp '*DT:Type*))   (setq *DT:Type* "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul* 0))
(if (not (boundp '*DT:W*))      (setq *DT:W* 600.0))
(if (not (boundp '*DT:H*))      (setq *DT:H* 400.0))
(if (not (boundp '*EUD:Angle*)) (setq *EUD:Angle* 90.0))
(if (not (boundp '*DT:FL*))     (setq *DT:FL* 35.0))
(if (not (boundp '*DT:FT*))     (setq *DT:FT* 35.0))

;; ─── HELPERS ────────────────────────────────────────

(defun eud:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn 
      (setq fp (findfile "Duct Type Setting.lsp")) 
      (if (and fp (findfile fp)) 
        (load fp)
      )
    )
  )
)

(defun eud:split (str delim / pos lst)
  (setq lst '()) 
  (while (setq pos (vl-string-search delim str)) 
    (setq lst (append lst (list (substr str 1 pos)))) 
    (setq str (substr str (+ pos (strlen delim) 1)))) 
  (append lst (list str))
)

(defun eud:rand-sfx (/ ms frac chars r1 r2)
  (setq ms (itoa (abs (fix (getvar "MILLISECS")))) 
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0))))
        chars "ABCDEFGHIJKLMNOPQRSTUVWXYZ")
  (setq r1 (substr chars (1+ (rem (fix (getvar "MILLISECS")) 26)) 1))
  (setq r2 (substr chars (1+ (rem (fix (/ (getvar "MILLISECS") 13)) 26)) 1))
  (strcat "-R" (substr ms (max 1 (- (strlen ms) 4))) (substr frac 1 (min 4 (strlen frac))) r1 r2)
)

(defun eud:norm-type (tp) 
  (strcase (if tp tp "SA"))
)

(defun eud:lo (tp) 
  (cdr (assoc (eud:norm-type tp) '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra") ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta"))))
)

(defun eud:ls (tp / lo) 
  (setq lo (eud:lo tp)) 
  (if lo (strcat lo "-shading") "Hvacduct-sa-shading")
)

(defun eud:safe-layer (lay) 
  (if (= (type lay) 'STR) lay "Hvacduct-sa")
)

(defun eud:init (tp / ad lays l-insul)
  (setq tp (eud:norm-type tp) 
        ad (vla-get-ActiveDocument (vlax-get-acad-object)) 
        lays (vla-get-Layers ad))
  (foreach ln (list (eud:lo tp) (eud:ls tp) "Hvacduct-Text" "Hvacduct-Insul" "Hvacins" "HVACDUCT-FLANGE")
    (if (and ln (not (tblsearch "LAYER" ln))) 
      (vl-catch-all-apply 'vla-Add (list lays ln))
    )
  )
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) 
    (vl-catch-all-apply 'vla-put-Color (list l-insul 118))
  )
  (if (not (tblsearch "STYLE" "HVACS")) 
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))
  )
  (foreach lt '("Ins" "HD" "HIDDEN") 
    (if (not (tblsearch "LTYPE" lt)) 
      (vl-catch-all-apply 'vla-load (list (vla-get-Linetypes ad) lt "acad.lin"))
    )
  )
)

(defun eud:get-insul (idx)
  (cond ((= idx 0) '("" 0 "SOLID" 1.0 0.0 0 0)) 
        ((= idx 1) '("INT25" 25 "INS25I" 1.0 0.0 2 1)) 
        ((= idx 2) '("INT50" 50 "INS50I" 1.0 0.0 2 1)) 
        ((= idx 3) '("INT75" 75 "INS75I" 40.0 0.0 2 1)) 
        ((= idx 4) '("INT100" 100 "INS100I" 1.0 45.0 2 1)) 
        ((= idx 5) '("EXT25" 25 "ANSI31" 43.4 0.0 1 2)) 
        ((= idx 6) '("EXT50" 50 "ANSI32" 15.0 0.0 1 2)) 
        ((= idx 7) '("EXT75" 75 "ANSI34" 22.2 0.0 1 2)) 
        (T '("" 0 "SOLID" 1.0 0.0 0 0)))
)

(defun eud:enmake-pline (lay pts closed color ltype / lst i)
  (setq lay (eud:safe-layer lay)) 
  (if (not color) (setq color 256)) 
  (if (not ltype) (setq ltype "ByLayer"))
  (setq lst (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) (cons 62 color) (cons 6 ltype) '(100 . "AcDbPolyline") (cons 90 (length pts)) (cons 70 (if closed 1 0)) '(43 . 0.0)))
  (setq i 0) 
  (while (< i (length pts)) 
    (setq lst (append lst (list (cons 10 (nth i pts))))) 
    (setq i (1+ i))
  )
  (entmake lst)
)

(defun eud:draw-flange (lay p1 p2 fl ft / ang uvec)
  (setq lay (eud:safe-layer lay) 
        ang (angle p1 p2) 
        uvec (list (cos (+ ang (/ pi 2.0))) (sin (+ ang (/ pi 2.0)))))
  (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 8) '(100 . "AcDbPolyline") '(90 . 6) '(70 . 0) (cons 10 (list (- (car p1) (* ft (cos ang))) (- (cadr p1) (* ft (sin ang))))) (cons 10 p1) (cons 10 (list (+ (car p1) (* fl (car uvec))) (+ (cadr p1) (* fl (cadr uvec))))) (cons 10 (list (+ (car p2) (* fl (car uvec))) (+ (cadr p2) (* fl (cadr uvec))))) (cons 10 p2) (cons 10 (list (+ (car p2) (* ft (cos ang))) (- (cadr p2) (* ft (sin ang)))))))
)

(defun eud:add-hatch-to-block (bname lay pat scl angdeg color pts / ad blks bdef hobj flat spts pline loop extdict sorttable objs)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) 
        blks (vla-get-Blocks ad) 
        bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn 
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef 0 pat :vlax-false)))
      (if (not (vl-catch-all-error-p hobj))
        (progn 
          (vla-put-Layer hobj lay) 
          (vla-put-Color hobj color) 
          (vla-put-PatternScale hobj scl) 
          (vla-put-PatternAngle hobj (* (/ angdeg 180.0) pi))
          (setq flat '()) 
          (foreach p pts (setq flat (append flat (list (car p) (cadr p))))) 
          (setq spts (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length flat))))) 
          (vlax-safearray-fill spts flat) 
          (setq pline (vla-AddLightWeightPolyline bdef spts)) 
          (vla-put-Closed pline :vlax-true) 
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0))) 
          (vlax-safearray-put-element loop 0 pline) 
          (vla-AppendOuterLoop hobj loop) 
          (vla-Evaluate hobj) 
          (vla-Delete pline)
          (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list bdef)))
          (if (not (vl-catch-all-error-p extdict))
            (progn 
              (setq sorttable (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS")))
              (if (vl-catch-all-error-p sorttable) 
                (setq sorttable (vl-catch-all-apply 'vla-AddObject (list extdict "ACAD_SORTENTS" "AcDbSortentsTable")))
              )
              (if (not (vl-catch-all-error-p sorttable)) 
                (progn 
                  (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0))) 
                  (vlax-safearray-put-element objs 0 hobj) 
                  (vl-catch-all-apply 'vla-MoveToBottom (list sorttable objs))
                )
              )
            )
          )
          hobj
        )
      )
    )
  )
)

;; ─── GEOMETRY MATH ──────────────────────────────────

(defun eud:calc-seg1 (ang h / rad)
  (setq ang (abs ang))
  (setq rad (+ 50.0 (/ h 2.0)))
  (if (equal (cos (/ (* ang pi) 360.0)) 0.0 1e-9)
    rad
    (* rad (/ (sin (/ (* ang pi) 360.0)) (cos (/ (* ang pi) 360.0))))
  )
)

(defun eud:calc-seg2 (ang h)
  (setq ang (abs ang)) 
  (if (< ang 90.0) (* (+ h 200.0) (sin (* ang (/ pi 180.0)))) h)
)

;; ─── BLOCK GENERATION ───────────────────────────────

(defun eud:make-block (bname tp w h ang rot mode insidx fixed-s1 / s1 s2 lo ls fl ft totL ltp idata thk pat scl mode_ins p2 i2 i4 i5 i7 p3 p4 p5 p6 p7 d_color d_lt flip_y pm pt1_i pt2_i pt3_i pt4_i)
  (setq tp (eud:norm-type tp) lo (eud:safe-layer (eud:lo tp)) ls (eud:ls tp) fl *DT:FL* ft *DT:FT*)
  (if fixed-s1 (setq s1 fixed-s1) (setq s1 (eud:calc-seg1 ang h)))
  (setq s2 (eud:calc-seg2 ang h) totL (+ s1 s2) ltp (if (tblsearch "LTYPE" "ins") "ins" "HIDDEN") idata (eud:get-insul insidx) thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) mode_ins (nth 6 idata))
  (setq p2 (list 0.0 (/ w 2.0)) p7 (list 0.0 (- (/ w 2.0))) p3 (list s1 (/ w 2.0)) p6 (list s1 (- (/ w 2.0))) p4 (list totL (/ w 2.0)) p5 (list totL (- (/ w 2.0))))
  
  (setq d_color 2 d_lt (if (tblsearch "LTYPE" "ins") "ins" "HIDDEN"))
  (if (and (= mode "UP") (member insidx '(0 5 6 7))) 
    (setq d_color 256 d_lt "ByLayer")
  )

  (setq flip_y (or (< (cos rot) -0.001) (and (< (abs (cos rot)) 0.001) (< (sin rot) -0.001))))

  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  (eud:draw-flange "HVACDUCT-FLANGE" p2 p7 fl ft)
  
  (eud:enmake-pline lo (list p2 p4 p5 p7) T 256 "ByLayer")
  (entmake (list '(0 . "LINE") (cons 8 lo) (cons 62 d_color) (cons 6 d_lt) (cons 10 p3) (cons 11 p6)))

  (if (member insidx '(0 5 6 7))
    (progn 
      (if (not flip_y)
        (progn 
          (setq pm (list (+ s1 (* 0.25 s2)) (+ (- (/ w 2.0)) (* 0.25 w)) 0.0))
          (if (not (and (= mode "UP") (member insidx '(0 5 6 7)))) 
            (eud:enmake-pline lo (list p3 pm p5) nil d_color d_lt)
          )
        )
        (progn 
          (setq pm (list (- totL (* 0.25 s2)) (+ (/ w 2.0) (* -0.25 w)) 0.0))
          (if (not (and (= mode "UP") (member insidx '(0 5 6 7))))
            (eud:enmake-pline lo (list p5 pm p3) nil d_color d_lt)
          )
        )
      )
      (if (= mode "UP")
        (progn 
          (entmake (list '(0 . "LINE") (cons 8 lo) '(62 . 1) (cons 10 p3) (cons 11 p5)))
          (entmake (list '(0 . "LINE") (cons 8 lo) '(62 . 1) (cons 10 p6) (cons 11 p4)))
        )
      )
    )
  )

  (if (> insidx 0)
    (progn
      (if (= mode_ins 1) 
        (setq i2 (list 0.0 (- (/ w 2.0) thk)) i4 (list (- totL thk) (- (/ w 2.0) thk)) i5 (list (- totL thk) (+ (- (/ w 2.0)) thk)) i7 (list 0.0 (+ (- (/ w 2.0)) thk)))
        (setq i2 (list 0.0 (+ (/ w 2.0) thk)) i4 (list (+ totL thk) (+ (/ w 2.0) thk)) i5 (list (+ totL thk) (- (- (/ w 2.0)) thk)) i7 (list 0.0 (- (- (/ w 2.0)) thk)))
      )
      (eud:enmake-pline "Hvacins" (list i2 i4 i5 i7) nil 256 ltp)
    )
  )

  (if (member insidx '(1 2 3 4))
    (progn 
      (setq pt1_i (list (+ s1 thk) (- (/ w 2.0) thk)))
      (setq pt2_i (list (- totL thk) (- (/ w 2.0) thk)))
      (setq pt3_i (list (- totL thk) (+ (- (/ w 2.0)) thk)))
      (setq pt4_i (list (+ s1 thk) (+ (- (/ w 2.0)) thk)))
      
      (if (= mode "DOWN")
        (setq d_color 2 d_lt "ins")
        (setq d_color 256 d_lt "ByLayer")
      )
      (eud:enmake-pline lo (list pt1_i pt2_i pt3_i pt4_i) T d_color d_lt)
      
      (if (= mode "DOWN")
        (if (not flip_y)
          (progn 
            (setq pm (list (+ (+ s1 thk) (* 0.25 (- (- totL thk) (+ s1 thk)))) (+ (+ (- (/ w 2.0)) thk) (* 0.25 (- (- (/ w 2.0) thk) (+ (- (/ w 2.0)) thk)))) 0.0))
            (eud:enmake-pline lo (list pt1_i pm pt3_i) nil d_color d_lt)
          )
          (progn 
            (setq pm (list (- (- totL thk) (* 0.25 (- (- totL thk) (+ s1 thk)))) (- (- (/ w 2.0) thk) (* 0.25 (- (- (/ w 2.0) thk) (+ (- (/ w 2.0)) thk)))) 0.0))
            (eud:enmake-pline lo (list pt3_i pm pt1_i) nil d_color d_lt)
          )
        )
      )

      (if (= mode "UP")
        (progn 
          (entmake (list '(0 . "LINE") (cons 8 lo) '(62 . 1) (cons 10 pt1_i) (cons 11 pt3_i)))
          (entmake (list '(0 . "LINE") (cons 8 lo) '(62 . 1) (cons 10 pt4_i) (cons 11 pt2_i)))
        )
      )
    )
  )

  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))

  (if (member insidx '(0 5 6 7))
    (progn 
      (if (and (= mode "UP") (member insidx '(0 5 6 7)))
        (if (not flip_y)
          (progn 
            (setq pm (list (+ s1 (* 0.25 s2)) (+ (- (/ w 2.0)) (* 0.25 w)) 0.0))
            (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 8 (list p3 pm p5 p6))
          )
          (progn 
            (setq pm (list (- totL (* 0.25 s2)) (+ (/ w 2.0) (* -0.25 w)) 0.0))
            (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 8 (list p5 pm p3 p4))
          )
        )
      )
    )
    (progn 
      (if (= mode "UP")
        (progn 
          (setq pt1_i (list (+ s1 thk) (- (/ w 2.0) thk)))
          (setq pt2_i (list (- totL thk) (- (/ w 2.0) thk)))
          (setq pt3_i (list (- totL thk) (+ (- (/ w 2.0)) thk)))
          (setq pt4_i (list (+ s1 thk) (+ (- (/ w 2.0)) thk)))
          (if (not flip_y)
            (progn 
              (setq pm (list (+ (+ s1 thk) (* 0.25 (- (- totL thk) (+ s1 thk)))) (+ (+ (- (/ w 2.0)) thk) (* 0.25 (- (- (/ w 2.0) thk) (+ (- (/ w 2.0)) thk)))) 0.0))
              (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 8 (list pt1_i pm pt3_i pt4_i))
            )
            (progn 
              (setq pm (list (- (- totL thk) (* 0.25 (- (- totL thk) (+ s1 thk)))) (- (- (/ w 2.0) thk) (* 0.25 (- (- (/ w 2.0) thk) (+ (- (/ w 2.0)) thk)))) 0.0))
              (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 8 (list pt3_i pm pt1_i pt2_i))
            )
          )
        )
      )
    )
  )

  (if (and (= mode "UP") (member insidx '(1 2 3 4)))
    (progn 
      (setq pt1_i (list (+ s1 thk) (- (/ w 2.0) thk)))
      (setq pt2_i (list (- totL thk) (- (/ w 2.0) thk)))
      (setq pt3_i (list (- totL thk) (+ (- (/ w 2.0)) thk)))
      (setq pt4_i (list (+ s1 thk) (+ (- (/ w 2.0)) thk)))
      (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 256 (list pt1_i pt2_i pt3_i pt4_i))
    )
  )

  (if (> insidx 0) 
    (progn 
      (setq pat (nth 2 idata) scl (nth 3 idata))
      (if (and (= mode "UP") (member insidx '(5 6 7)))
        (eud:add-hatch-to-block bname "Hvacduct-Insul" pat scl 0.0 256 (list p2 p3 p6 p7))
        (eud:add-hatch-to-block bname "Hvacduct-Insul" pat scl 0.0 256 (list p2 p4 p5 p7))
      )
    )
  )

  (eud:add-hatch-to-block bname (eud:ls tp) "SOLID" 1.0 0.0 256 (list p2 p4 p5 p7))
)

;; ─── MAIN COMMAND ───────────────────────────────────

(defun eud:extract-dims (bn / parts dims) 
  (if (and bn (wcmatch bn "DTv9-*")) 
    (progn 
      (setq parts (eud:split bn "-")) 
      (if (>= (length parts) 3) 
        (progn 
          (setq dims (eud:split (nth 2 parts) "x")) 
          (if (= (length dims) 3) 
            (list (atof (nth 0 dims)) (atof (nth 1 dims)) (atof (nth 2 dims))) 
            nil
          )
        ) 
        nil
      )
    ) 
    nil
  )
)

(defun eud:extract-system (bn / parts sys p) 
  (if (and bn (wcmatch bn "DTv9-*")) 
    (progn 
      (setq parts (eud:split bn "-")) 
      (if (>= (length parts) 2) 
        (progn 
          (setq sys (nth 1 parts)) 
          (setq p (vl-string-search "_" sys)) 
          (if p (substr sys 1 p) sys)
        ) 
        nil
      )
    ) 
    nil
  )
)

(defun eud:extract-insul (bn / parts ins-map ins-str) 
  (setq ins-map '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4) ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7))) 
  (if (and bn (wcmatch bn "DTv9-*")) 
    (progn 
      (setq parts (eud:split bn "-")) 
      (if (>= (length parts) 4) 
        (progn 
          (setq ins-str (nth 3 parts)) 
          (if (assoc ins-str ins-map) (cdr (assoc ins-str ins-map)) 0)
        ) 
        0
      )
    ) 
    0
  )
)

(defun eud:get-duct-insertion-point (ed) 
  (cdr (assoc 10 ed))
)

(defun eud:get-duct-endpoint (ip len rot) 
  (list (+ (car ip) (* len (cos rot))) (+ (cadr ip) (* len (sin rot))) 0.0)
)

(defun eud:norm-angle (ang)
  (while (< ang 0.0) (setq ang (+ ang (* 2.0 pi))))
  (while (>= ang (* 2.0 pi)) (setq ang (- ang (* 2.0 pi))))
  ang
)

(defun eud:auto-flip-yscale (rot / a tol)
  (setq a (eud:norm-angle rot) tol 1e-6)
  (if (or (and (> a tol) (<= a (+ (/ pi 2.0) tol))) (and (> a (+ pi tol)) (<= a (+ (* 1.5 pi) tol)))) -1.0 1.0)
)

(defun eud:set-insert-block (ent bname / ed pair)
  (setq ed (entget ent))
  (setq pair (assoc 2 ed))
  (if pair
    (progn
      (entmod (subst (cons 2 bname) pair ed))
      (entupd ent)
    )
  )
  (princ)
)

(defun eud:confirm-bend-direction (ent bn-up bn-down / done ev mode)
  (setq done nil mode "UP")
  (princ "\n[BE] Direction: UP. Press Space to toggle Up/Down, click or Enter to finish: ")
  (while (not done)
    (setq ev (grread T 13 0))
    (cond
      ((and (= (car ev) 2) (= (cadr ev) 32))
        (if (= mode "UP")
          (progn
            (setq mode "DOWN")
            (eud:set-insert-block ent bn-down)
            (princ "\n[BE] Direction: DOWN.")
          )
          (progn
            (setq mode "UP")
            (eud:set-insert-block ent bn-up)
            (princ "\n[BE] Direction: UP.")
          )
        )
      )
      ((and (= (car ev) 2) (= (cadr ev) 13)) (setq done T))
      ((= (car ev) 3) (setq done T))
      ((and (= (car ev) 2) (= (cadr ev) 27))
        (entdel ent)
        (setq done T mode nil)
        (princ "\n[BE] Cancelled.")
      )
    )
  )
  mode
)

(defun eud:main (mode is-sq / pt1 w h ang duct-ss duct-ent duct-ed dn dims sys ins rot bn bn-temp temp-ent d-len d-ip d-ep d-rot d-start d-end fixed-s1 yscale)
  (eud:load-dts) 
  (if (not (boundp 'dts:ensure-defaults)) (load "Duct Type Setting.lsp")) 
  (dts:ensure-defaults)
  (princ (strcat "\n[" (if is-sq "E11" "E1") (if (= mode "UP") "U" "D") "] Pick duct end center point:"))
  (setq pt1 (getpoint "\nStart Point: "))
  (if pt1
    (progn 
      (setq duct-ss (ssget "C" (list (- (car pt1) 50.0) (- (cadr pt1) 50.0)) (list (+ (car pt1) 50.0) (+ (cadr pt1) 50.0)) '((0 . "INSERT") (2 . "DTv9-*"))))
      (if duct-ss
        (progn 
          (setq duct-ent (ssname duct-ss 0) duct-ed (entget duct-ent) dn (cdr (assoc 2 duct-ed))) 
          (setq dims (eud:extract-dims dn) sys (eud:extract-system dn) ins (eud:extract-insul dn)) 
          (if dims (progn (setq d-len (nth 0 dims) w (nth 1 dims) h (nth 2 dims) *DT:W* w *DT:H* h))) 
          (if sys (setq *DT:Type* sys)) 
          (if ins (setq *DT:Insul* ins)) 
          (setq d-rot (cdr (assoc 50 duct-ed)) d-ip (eud:get-duct-insertion-point duct-ed) d-ep (eud:get-duct-endpoint d-ip d-len d-rot))
          (setq d-start (distance pt1 d-ip) d-end (distance pt1 d-ep))
          (setq rot (if (<= d-start d-end) (+ d-rot pi) d-rot))
          (princ (strcat "\nDetected: " *DT:Type* " " (rtos w 2 0) "x" (rtos h 2 0) (if (> ins 0) " w/ Insul" "")))
        )
        (progn 
          (setq w (getreal (strcat "\nWidth W <" (rtos *DT:W* 2 0) ">: "))) 
          (if w (setq *DT:W* w) (setq w *DT:W*)) 
          (setq h (getreal (strcat "\nHeight H <" (rtos *DT:H* 2 0) ">: "))) 
          (if h (setq *DT:H* h) (setq h *DT:H*))
          (setq rot 0.0)
        )
      )
      
      (if is-sq
        (progn 
          (setq ang 90.0) 
          (setq fixed-s1 (getreal "\nThroat length <100>: ")) 
          (if (not fixed-s1) (setq fixed-s1 100.0))
          (setq bn (strcat "E11" mode "-" *DT:Type* "-" (rtos w 2 0) "x" (rtos h 2 0) "-TL" (rtos fixed-s1 2 0) (eud:rand-sfx)))
        )
        (progn 
          (initget 6) 
          (setq ang (getreal (strcat "\nElbow Angle <" (rtos *EUD:Angle* 2 0) ">: "))) 
          (if ang (setq *EUD:Angle* ang) (setq ang *EUD:Angle*))
          (setq bn (strcat "E1" mode "-" *DT:Type* "-" (rtos w 2 0) "x" (rtos h 2 0) "-A" (rtos ang 2 0) (eud:rand-sfx)))
          (setq fixed-s1 nil)
        )
      )

      (eud:init *DT:Type*) 

      (if (not duct-ss)
        (progn
          (setq bn-temp (strcat "TMP" (eud:rand-sfx)))
          (eud:make-block bn-temp *DT:Type* w h ang 0.0 mode *DT:Insul* fixed-s1)
          (entmake (list '(0 . "INSERT") (cons 8 (eud:safe-layer (eud:lo *DT:Type*))) (cons 2 bn-temp) (cons 10 pt1) (cons 41 1.0) (cons 42 1.0) (cons 43 1.0) (cons 50 0.0)))
          (setq temp-ent (entlast))
          (princ "\nSpecify rotation angle: ")
          (setvar "CMDECHO" 1)
          (vl-catch-all-apply 'vl-cmdf (list "_.ROTATE" temp-ent "" pt1 pause))
          (setvar "CMDECHO" 0)
          (if (entget temp-ent)
            (progn
              (setq rot (cdr (assoc 50 (entget temp-ent))))
              (entdel temp-ent)
            )
            (setq rot 0.0)
          )
        )
      )

      (eud:make-block bn *DT:Type* w h ang rot mode *DT:Insul* fixed-s1)

      (setq yscale (eud:auto-flip-yscale rot))
      (if (entmake (list '(0 . "INSERT") (cons 8 (eud:safe-layer (eud:lo *DT:Type*))) (cons 2 bn) (cons 10 pt1) (cons 41 1.0) (cons 42 yscale) (cons 43 1.0) (cons 50 rot))) 
        (princ (strcat "\n[" (if is-sq "E11" "E1") mode "] Success."))
        (princ "\n[ERROR] Failed.")
      )
    )
  )
  (princ)
)

(defun c:E1U () (eud:main "UP" nil)) 
(defun c:E1D () (eud:main "DOWN" nil))
(defun c:E11U () (eud:main "UP" T))
(defun c:E11D () (eud:main "DOWN" T))

(defun c:EB (/ etype edir is-sq mode)
  (initget "1 2")
  (setq etype (getkword "\nSelect elbow type [1:Radius / 2:Mitered] <1>: "))
  (if (or (not etype) (= etype "1")) (setq etype "Radius") (setq etype "Mitered"))
  
  (initget "1 2")
  (setq edir (getkword "\nSelect direction [1:Up / 2:Down] <1>: "))
  (if (or (not edir) (= edir "1")) (setq edir "Up") (setq edir "Down"))
  
  (setq is-sq (if (= etype "Mitered") T nil))
  (setq mode (if (= edir "Up") "UP" "DOWN"))
  
  (eud:main mode is-sq)
)

(defun c:BE (/ etype is-sq pt1 w h ang duct-ss duct-ent duct-ed dn dims sys ins rot d-len d-ip d-ep d-rot d-start d-end fixed-s1 suffix bn-up bn-down yscale ins-ent final-mode bn-temp temp-ent)
  (eud:load-dts)
  (if (not (boundp 'dts:ensure-defaults)) (load "Duct Type Setting.lsp"))
  (dts:ensure-defaults)

  (initget "1 2")
  (setq etype (getkword "\nSelect bend type [1:Radius / 2:Mitered] <1>: "))
  (setq is-sq (= etype "2"))

  (princ "\n[BE] Pick duct end center point:")
  (setq pt1 (getpoint "\nStart Point: "))
  (if pt1
    (progn
      (setq duct-ss (ssget "C" (list (- (car pt1) 50.0) (- (cadr pt1) 50.0)) (list (+ (car pt1) 50.0) (+ (cadr pt1) 50.0)) '((0 . "INSERT") (2 . "DTv9-*"))))
      (if duct-ss
        (progn
          (setq duct-ent (ssname duct-ss 0)
                duct-ed (entget duct-ent)
                dn (cdr (assoc 2 duct-ed))
                dims (eud:extract-dims dn)
                sys (eud:extract-system dn)
                ins (eud:extract-insul dn))
          (if dims
            (progn
              (setq d-len (nth 0 dims) w (nth 1 dims) h (nth 2 dims) *DT:W* w *DT:H* h)
            )
          )
          (if sys (setq *DT:Type* sys))
          (if ins (setq *DT:Insul* ins))
          (setq d-rot (cdr (assoc 50 duct-ed))
                d-ip (eud:get-duct-insertion-point duct-ed)
                d-ep (eud:get-duct-endpoint d-ip d-len d-rot)
                d-start (distance pt1 d-ip)
                d-end (distance pt1 d-ep)
                rot (if (<= d-start d-end) (+ d-rot pi) d-rot))
          (princ (strcat "\nDetected: " *DT:Type* " " (rtos w 2 0) "x" (rtos h 2 0) (if (> *DT:Insul* 0) " w/ Insul" "")))
        )
        (progn
          (setq w (getreal (strcat "\nWidth W <" (rtos *DT:W* 2 0) ">: ")))
          (if w (setq *DT:W* w) (setq w *DT:W*))
          (setq h (getreal (strcat "\nHeight H <" (rtos *DT:H* 2 0) ">: ")))
          (if h (setq *DT:H* h) (setq h *DT:H*))
          (setq rot 0.0)
        )
      )

      (if is-sq
        (setq ang 90.0 fixed-s1 100.0)
        (progn
          (initget 6)
          (setq ang (getreal (strcat "\nElbow Angle <" (rtos *EUD:Angle* 2 0) ">: ")))
          (if ang (setq *EUD:Angle* ang) (setq ang *EUD:Angle*))
          (setq fixed-s1 nil)
        )
      )

      (setq suffix (eud:rand-sfx))
      (if is-sq
        (progn
          (setq bn-up (strcat "E11UP-" *DT:Type* "-" (rtos *DT:W* 2 0) "x" (rtos *DT:H* 2 0) "-TL" (rtos fixed-s1 2 0) suffix))
          (setq bn-down (strcat "E11DOWN-" *DT:Type* "-" (rtos *DT:W* 2 0) "x" (rtos *DT:H* 2 0) "-TL" (rtos fixed-s1 2 0) suffix))
        )
        (progn
          (setq bn-up (strcat "E1UP-" *DT:Type* "-" (rtos *DT:W* 2 0) "x" (rtos *DT:H* 2 0) "-A" (rtos ang 2 0) suffix))
          (setq bn-down (strcat "E1DOWN-" *DT:Type* "-" (rtos *DT:W* 2 0) "x" (rtos *DT:H* 2 0) "-A" (rtos ang 2 0) suffix))
        )
      )

      (eud:init *DT:Type*)

      (if (not duct-ss)
        (progn
          (setq bn-temp (strcat "TMP" (eud:rand-sfx)))
          (eud:make-block bn-temp *DT:Type* *DT:W* *DT:H* ang 0.0 "UP" *DT:Insul* fixed-s1)
          (entmake (list '(0 . "INSERT") (cons 8 (eud:safe-layer (eud:lo *DT:Type*))) (cons 2 bn-temp) (cons 10 pt1) (cons 41 1.0) (cons 42 1.0) (cons 43 1.0) (cons 50 0.0)))
          (setq temp-ent (entlast))
          (princ "\nSpecify rotation angle: ")
          (setvar "CMDECHO" 1)
          (vl-catch-all-apply 'vl-cmdf (list "_.ROTATE" temp-ent "" pt1 pause))
          (setvar "CMDECHO" 0)
          (if (entget temp-ent)
            (progn
              (setq rot (cdr (assoc 50 (entget temp-ent))))
              (entdel temp-ent)
            )
            (setq rot 0.0)
          )
        )
      )

      (eud:make-block bn-up *DT:Type* *DT:W* *DT:H* ang rot "UP" *DT:Insul* fixed-s1)
      (eud:make-block bn-down *DT:Type* *DT:W* *DT:H* ang rot "DOWN" *DT:Insul* fixed-s1)

      (setq yscale (eud:auto-flip-yscale rot))
      (if (entmake (list '(0 . "INSERT") (cons 8 (eud:safe-layer (eud:lo *DT:Type*))) (cons 2 bn-up) (cons 10 pt1) (cons 41 1.0) (cons 42 yscale) (cons 43 1.0) (cons 50 rot)))
        (progn
          (setq ins-ent (entlast))
          (setq final-mode (eud:confirm-bend-direction ins-ent bn-up bn-down))
          (if final-mode
            (princ (strcat "\n[BE] " (if is-sq "Mitered" "Radius") " bend " final-mode " complete."))
          )
        )
        (princ "\n[ERROR] Failed.")
      )
    )
  )
  (princ)
)

(princ "\n[TBH] Vertical Elbows loaded. Type 'BE' for bend workflow or 'EB' for legacy command.") 
(princ)