;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Mitered Elbow.lsp
;;; Module      : Draw\Create
;;; Command     : E11, MITEREDELBOW
;;; Description : Draws mitered rectangular elbows.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Specify Width and Height.
;;; 3. Pick Start and end direction for 90-degree bend.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*DT:Type*))   (setq *DT:Type* "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul* 0))
(if (not (boundp '*E11:W1*))    (setq *E11:W1* 400.0))
(if (not (boundp '*E11:W2*))    (setq *E11:W2* 400.0))
(if (not (boundp '*E11:T1*))    (setq *E11:T1* 100.0))
(if (not (boundp '*E11:T2*))    (setq *E11:T2* 100.0))
(if (not (boundp '*E11:Hand*))  (setq *E11:Hand* "Left"))

;; ─── DEPENDENCIES ───────────────────────────────────
(defun e11:load-deps (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if (and fp (findfile fp)) (load fp))))
  (if (not (boundp '*DT:MaxLen*))
    (progn
      (setq fp (findfile "Rectangular duct.lsp"))
      (if (and fp (findfile fp)) (load fp)))))

;; ─── HELPERS ────────────────────────────────────────
(defun e11:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos (strlen delim) 1))))
  (append lst (list str)))

(defun e11:norm-type (tp)
  (if (= (type tp) 'STR)
    (strcase tp)
    "SA"))

(defun e11:type-layer (tp)
  (cdr (assoc (e11:norm-type tp) '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra") ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))

(defun e11:safe-layer (lay) (if lay lay "Hvacduct-sa"))
(defun e11:vane-ltype () (if (tblsearch "LTYPE" "INCS") "INCS" "ByLayer"))

(defun e11:init (tp / ad lays l-insul)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq lays (vla-get-Layers ad))
  (foreach ln (list (e11:type-layer tp) (strcat (e11:type-layer tp) "-shading") "Hvacduct-Text" "Hvacduct-Insul" "Hvacins" "HVACDUCT-FLANGE")
    (if (and ln (not (tblsearch "LAYER" ln))) (vl-catch-all-apply 'vla-Add (list lays ln))))
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) (vl-catch-all-apply 'vla-put-Color (list l-insul 118)))
  (if (not (tblsearch "STYLE" "HVACS"))
    (command "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))

;; ─── GEOMETRY ───────────────────────────────────────
(defun e11:v+ (a b) (list (+ (car a) (car b)) (+ (cadr a) (cadr b)) 0.0))
(defun e11:v- (a b) (list (- (car a) (car b)) (- (cadr a) (cadr b)) 0.0))
(defun e11:v* (v s) (list (* (car v) s) (* (cadr v) s) 0.0))
(defun e11:dot (a b) (+ (* (car a) (car b)) (* (cadr a) (cadr b))))
(defun e11:len (v) (distance '(0.0 0.0 0.0) v))
(defun e11:unit (v / l) (setq l (e11:len v)) (if (> l 1e-9) (e11:v* v (/ 1.0 l)) '(0.0 0.0 0.0)))
(defun e11:tan (ang / c) (setq c (cos ang)) (if (equal c 0.0 1e-12) 0.0 (/ (sin ang) c)))

(defun e11:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa))) (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

(defun e11:norm-ang (ang)
  (while (< ang 0.0) (setq ang (+ ang (* 2.0 pi))))
  (while (>= ang (* 2.0 pi)) (setq ang (- ang (* 2.0 pi))))
  ang)

(defun e11:dist-pt-seg (p a b / ab ap t q)
  (setq ab (e11:v- b a) ap (e11:v- p a) t 0.0)
  (if (> (e11:dot ab ab) 1e-9) (setq t (/ (e11:dot ap ab) (e11:dot ab ab))))
  (if (< t 0.0) (setq t 0.0)) (if (> t 1.0) (setq t 1.0))
  (setq q (e11:v+ a (e11:v* ab t))) (distance p q))

(defun e11:points-local (w1 w2 t1 t2 hand / pts p1 p2 cx cy)
  ;; Define geometry first, then recenter so block origin = center of entering face (P1-P2)
  (setq pts
    (if (= (strcase hand) "RIGHT")
  (list (cons 1 (list w1 0.0 0.0))
    (cons 2 (list 0.0 0.0 0.0))
    (cons 3 (list 0.0 (+ w2 t2) 0.0))
    (cons 4 (list (+ w1 t1) (+ w2 t2) 0.0))
    (cons 5 (list (+ w1 t1) t2 0.0))
    (cons 6 (list w1 t2 0.0)))
  (list (cons 1 (list (- w1) 0.0 0.0))
    (cons 2 (list 0.0 0.0 0.0))
    (cons 3 (list 0.0 (+ w2 t2) 0.0))
    (cons 4 (list (- (+ w1 t1)) (+ w2 t2) 0.0))
    (cons 5 (list (- (+ w1 t1)) t2 0.0))
    (cons 6 (list (- w1) t2 0.0)))))
  (setq p1 (cdr (assoc 1 pts))
    p2 (cdr (assoc 2 pts))
    cx (/ (+ (car p1) (car p2)) 2.0)
    cy (/ (+ (cadr p1) (cadr p2)) 2.0))
  (mapcar
    '(lambda (pr)
   (cons (car pr)
     (list (- (car (cdr pr)) cx)
       (- (cadr (cdr pr)) cy)
       0.0)))
    pts))

(defun e11:pt (idx pts) (cdr (assoc idx pts)))
(defun e11:get-ins-prefix (idx / _r) 
  (setq _r (vl-catch-all-apply 'dt:get-insul (list idx)))
  (if (vl-catch-all-error-p _r)
    ""
    (car _r)))

(defun e11:enmake-pline (lay pts bulges closed color ltype / lst i)
  (setq lst (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) (cons 62 color) (cons 6 ltype) '(100 . "AcDbPolyline") (cons 90 (length pts)) (cons 70 (if closed 1 0)) '(43 . 0.0)))
  (setq i 0)
  (while (< i (length pts))
    (setq lst (append lst (list (cons 10 (nth i pts)))))
    (if (and bulges (< i (length bulges))) (setq lst (append lst (list (cons 42 (nth i bulges))))))
    (setq i (1+ i)))
  (entmake lst))

;; ─── BLOCK GENERATION ───────────────────────────────
(defun e11:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun e11:block-name (tp w1 w2 t1 t2 hand insidx / prf)
  (setq prf (e11:get-ins-prefix insidx))
  (strcat "E11v13-" (strcase tp) "-" (rtos w1 2 0) "x" (rtos w2 2 0) "-T" (rtos t1 2 0) "x" (rtos t2 2 0) "-" (if (= (strcase hand) "RIGHT") "R" "L") (if (= prf "" ) "" (strcat "-" prf)) (e11:rand-sfx)))

(defun e11:draw-flange (lay p1 p2 uvec fl ft / ang vvec)
  (setq lay "HVACDUCT-FLANGE" ang (angle p1 p2) vvec (list (cos ang) (sin ang) 0.0))
  (e11:enmake-pline lay
    (list (list (- (car p1) (* ft (car vvec))) (- (cadr p1) (* ft (cadr vvec))) 0.0) p1 (list (- (car p1) (* fl (car uvec))) (- (cadr p1) (* fl (cadr uvec))) 0.0) (list (- (car p2) (* fl (car uvec))) (- (cadr p2) (* fl (cadr uvec))) 0.0) p2 (list (+ (car p2) (* ft (car vvec))) (+ (cadr p2) (* ft (cadr vvec))) 0.0))
    nil nil 8 "ByLayer"))

(defun e11:line-int (a1 a2 b1 b2 / x1 y1 x2 y2 x3 y3 x4 y4 den px py)
  (setq x1 (car a1) y1 (cadr a1) x2 (car a2) y2 (cadr a2) x3 (car b1) y3 (cadr b1) x4 (car b2) y4 (cadr b2))
  (setq den (- (* (- x1 x2) (- y3 y4)) (* (- y1 y2) (- x3 x4))))
  (if (equal den 0.0 1e-9) a2 (progn (setq px (/ (- (* (- (* x1 y2) (* y1 x2)) (- x3 x4)) (* (- x1 x2) (- (* x3 y4) (* y3 x4)))) den) py (/ (- (* (- (* x1 y2) (* y1 x2)) (- y3 y4)) (* (- y1 y2) (- (* x3 y4) (* y3 x4)))) den)) (list px py 0.0))))

(defun e11:left-normal (a b / v) (setq v (e11:unit (e11:v- b a))) (list (- (cadr v)) (car v) 0.0))

(defun e11:offset-open3 (a b c dist side / n1 n2 a1 b1 b2 c2 bi)
  (setq n1 (e11:v* (e11:left-normal a b) (* dist side)) n2 (e11:v* (e11:left-normal b c) (* dist side)) a1 (e11:v+ a n1) b1 (e11:v+ b n1) b2 (e11:v+ b n2) c2 (e11:v+ c n2) bi (e11:line-int a1 b1 b2 c2))
  (list a1 bi c2))

(defun e11:add-hatch-to-block (bname lay pat scl angdeg tp-h pts bulges color bottom / ad blks bdef hobj flat spts pline loop i extdict sorttable objs)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) blks (vla-get-Blocks ad) bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp-h pat :vlax-false 0)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vl-catch-all-apply 'vla-put-Layer (list hobj lay)) (vl-catch-all-apply 'vla-put-Color (list hobj color)) (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl)) (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angdeg 180.0) pi)))
          (setq flat '()) (foreach p pts (setq flat (append flat (list (car p) (cadr p)))))
          (setq spts (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length flat))))) (vlax-safearray-fill spts flat)
          (setq pline (vla-AddLightWeightPolyline bdef spts)) (vla-put-Closed pline :vlax-true)
          (if bulges (progn (setq i 0) (while (< i (length bulges)) (vla-SetBulge pline i (nth i bulges)) (setq i (1+ i)))))
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element loop 0 pline)
          (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop)) (vl-catch-all-apply 'vla-Evaluate (list hobj)) (vl-catch-all-apply 'vla-Delete (list pline))
          (if bottom (progn (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list bdef))) (if (not (vl-catch-all-error-p extdict)) (progn (setq sorttable (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS"))) (if (vl-catch-all-error-p sorttable) (setq sorttable (vl-catch-all-apply 'vla-AddObject (list extdict "ACAD_SORTENTS" "AcDbSortentsTable")))) (if (not (vl-catch-all-error-p sorttable)) (progn (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element objs 0 hobj) (vl-catch-all-apply 'vla-MoveToBottom (list sorttable objs))))))))
          T)))))

(defun e11:draw-insul-lines (pts thk mode hand / p1 p2 p3 p4 p5 p6 s-outer s-inner outer inner)
  (if (> mode 0)
    (progn
      (setq p1 (e11:pt 1 pts) p2 (e11:pt 2 pts) p3 (e11:pt 3 pts) p4 (e11:pt 4 pts) p5 (e11:pt 5 pts) p6 (e11:pt 6 pts))
      (if (= (strcase hand) "RIGHT") (setq s-outer (if (= mode 1) -1.0 1.0) s-inner (if (= mode 1) 1.0 -1.0)) (setq s-outer (if (= mode 1) 1.0 -1.0) s-inner (if (= mode 1) -1.0 1.0)))
      (setq outer (e11:offset-open3 p2 p3 p4 thk s-outer) inner (e11:offset-open3 p1 p6 p5 thk s-inner))
      (e11:enmake-pline "Hvacins" outer nil nil 256 "Ins") (e11:enmake-pline "Hvacins" inner nil nil 256 "Ins"))))

(defun e11:draw-vane-arc (lay mid dir p6 / nrm leftn to6 sgn theta halfch bulge a b)
  (setq nrm (list (- (cadr dir)) (car dir) 0.0) leftn (list (- (cadr nrm)) (car nrm) 0.0) to6 (e11:v- p6 mid) sgn (if (>= (e11:dot leftn to6) 0.0) 1.0 -1.0) theta 1.0 halfch (* 100.0 (sin (/ theta 2.0))) bulge (* sgn (e11:tan (/ theta 4.0))) a (e11:v- mid (e11:v* nrm halfch)) b (e11:v+ mid (e11:v* nrm halfch)))
  (e11:enmake-pline lay (list a b) (list bulge) nil 1 (e11:vane-ltype)))

(defun e11:draw-vanes (lay p6 p3 / vaneLT dir seglen gap usable count i d mid)
  (setq vaneLT (e11:vane-ltype) dir (e11:unit (e11:v- p3 p6)))
  (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 1) (cons 6 vaneLT) '(100 . "AcDbLine") (cons 10 (list (car p6) (cadr p6) 0.0)) (cons 11 (list (car p3) (cadr p3) 0.0))))
  (setq seglen (distance p6 p3) gap 35.0 usable (- seglen 140.0) count (fix (/ usable 100.0)))
  (if (< count 3) (setq count 3))
  (setq i 0) (while (< i count) (setq d (+ 70.0 (* i 100.0))) (if (< d (- seglen 60.0)) (progn (setq mid (e11:v+ p6 (e11:v* dir d))) (e11:draw-vane-arc lay mid dir p6))) (setq i (1+ i))))

(defun e11:make-block (bname tp w1 w2 t1 t2 hand / lay shd idata thk pat scl patang tph mode pts p1 p2 p3 p4 p5 p6 poly)
  (setq lay (e11:safe-layer (e11:type-layer tp)) shd (strcat lay "-shading"))
  (setq idata (vl-catch-all-apply 'dt:get-insul (list *DT:Insul*)))
  (if (vl-catch-all-error-p idata)
    (setq idata '("" 0 "SOLID" 1.0 0.0 0 0)))
  (setq
        thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) patang (nth 4 idata) tph (nth 5 idata) mode (nth 6 idata))
  (setq pts (e11:points-local w1 w2 t1 t2 hand) poly (mapcar '(lambda (pr) (cdr pr)) pts) p1 (e11:pt 1 pts) p2 (e11:pt 2 pts) p3 (e11:pt 3 pts) p4 (e11:pt 4 pts) p5 (e11:pt 5 pts) p6 (e11:pt 6 pts))
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  (e11:enmake-pline lay poly nil T 256 "ByLayer")
  (e11:draw-flange lay p1 p2 '(0.0 -1.0 0.0) (if (boundp '*DT:FL*) *DT:FL* 35.0) (if (boundp '*DT:FT*) *DT:FT* 35.0))
  (e11:draw-flange lay p5 p4 (if (= (strcase hand) "RIGHT") '(1.0 0.0 0.0) '(-1.0 0.0 0.0)) (if (boundp '*DT:FL*) *DT:FL* 35.0) (if (boundp '*DT:FT*) *DT:FT* 35.0))
  (e11:draw-insul-lines pts thk mode hand) (e11:draw-vanes lay p6 p3)
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))
  (if (> mode 0) (e11:add-hatch-to-block bname "Hvacduct-Insul" pat scl patang tph poly nil 256 T))
  (e11:add-hatch-to-block bname shd "SOLID" 1.0 0.0 0 poly nil 256 T)
  T)

;; ─── ANNOTATION ────────────────────────────────────
(defun e11:tht-text (t1 t2) (if (or (/= t1 100.0) (/= t2 100.0)) (strcat (rtos t1 2 0) "x" (rtos t2 2 0) " THT") ""))
(defun e11:add-tht-text (txt / pt ent) (if (/= txt "") (progn (setq pt (getpoint (strcat "\nSpecify THT text position for [" txt "]: "))) (if pt (progn (entmake (list '(0 . "TEXT") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car pt) (cadr pt) 0.0) '(40 . 100.0) '(41 . 0.8) (cons 1 txt) '(7 . "HVACS") '(72 . 1) '(73 . 2) (list 11 (car pt) (cadr pt) 0.0) '(50 . 0.0))) (setq ent (entlast)) (princ "\nRotate THT text visually: ") (command "_.rotate" ent "" pt pause))))))

;; ─── EDIT LOGIC ────────────────────────────────────
(defun e11:parse-name (bn / parts dims ts) 
  (setq parts (e11:split bn "-")) 
  (if (>= (length parts) 5) 
    (progn (setq dims (e11:split (nth 2 parts) "x") ts (e11:split (vl-string-subst "" "T" (nth 3 parts)) "x")) 
           (list (cons 'ver (nth 0 parts)) (cons 'type (nth 1 parts)) (cons 'w1 (atof (nth 0 dims))) (cons 'w2 (atof (nth 1 dims))) (cons 't1 (atof (nth 0 ts))) (cons 't2 (atof (nth 1 ts))) (cons 'hand (if (= (strcase (nth 4 parts)) "R") "Right" "Left")))) nil))

(defun e11:pick-side (edata pick ip ang / pts p1 p5 p6 d1 d2) (setq pts (e11:points-local (cdr (assoc 'w1 edata)) (cdr (assoc 'w2 edata)) (cdr (assoc 't1 edata)) (cdr (assoc 't2 edata)) (cdr (assoc 'hand edata))) p1 (e11:xf (car (e11:pt 1 pts)) (cadr (e11:pt 1 pts)) ip ang) p5 (e11:xf (car (e11:pt 5 pts)) (cadr (e11:pt 5 pts)) ip ang) p6 (e11:xf (car (e11:pt 6 pts)) (cadr (e11:pt 6 pts)) ip ang) d1 (e11:dist-pt-seg pick p1 p6) d2 (e11:dist-pt-seg pick p5 p6)) (if (<= d1 d2) 't1 't2))

(defun e11:dt-face-distance (ent base axis / ed bn ip ang parts dims pl w c1 c2 d1 d2) (setq ed (entget ent) bn (cdr (assoc 2 ed))) (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*")) (progn (setq ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)) parts (e11:split bn "-") dims (e11:split (nth 2 parts) "x") pl (atof (nth 0 dims)) w (atof (nth 1 dims)) c1 (e11:xf 0.0 (- (/ w 2.0)) ip ang) c2 (e11:xf pl (- (/ w 2.0)) ip ang) d1 (e11:dot (e11:v- c1 base) axis) d2 (e11:dot (e11:v- c2 base) axis)) (cond ((and (> d1 0.0) (> d2 0.0)) (min d1 d2)) ((> d1 0.0) d1) ((> d2 0.0) d2) (T nil))) nil))

;; ─── DRAW MODE HELPERS ─────────────────────────────
(defun e11:extract-system (block-name / parts sys p)
  (if (and (= (type block-name) 'STR) (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e11:split block-name "-"))
      (if (>= (length parts) 2)
        (progn
          (setq sys (nth 1 parts))
          (setq p (vl-string-search "_" sys))
          (if p (substr sys 1 p) sys))
        nil))
    nil))

(defun e11:extract-dims (block-name / parts dims lenS)
  (if (and (= (type block-name) 'STR) (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e11:split block-name "-"))
      (if (>= (length parts) 3)
        (progn
          (setq dims (e11:split (nth 2 parts) "x"))
          (if (= (length dims) 3)
            (progn
              (setq lenS (vl-string-subst "" "L" (nth 0 dims)))
              (list (atof lenS) (atof (nth 1 dims)) (atof (nth 2 dims))))
            nil))
        nil))
    nil))

(defun e11:extract-insulation (block-name / parts insStr insMap)
  (setq insMap '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4)
                 ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  (if (and (= (type block-name) 'STR) (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e11:split block-name "-"))
      (if (>= (length parts) 4)
        (progn
          (setq insStr (nth 3 parts))
          (if (assoc insStr insMap) (cdr (assoc insStr insMap)) 0))
        0))
    0))

(defun e11:get-duct-endpoint (duct-insertion duct-length duct-rotation / dx dy)
  (if (and duct-insertion duct-length duct-rotation)
    (progn
      (setq dx (* duct-length (cos duct-rotation)))
      (setq dy (* duct-length (sin duct-rotation)))
      (list (+ (car duct-insertion) dx) (+ (cadr duct-insertion) dy) 0.0))
    nil))

;; With new local coordinates, block origin is already at entering-face center.
(defun e11:center-to-corner (pt-center w1 hand rot)
  (list (car pt-center) (cadr pt-center) 0.0))

(defun e11:update-block (ent data t1 t2 / ed ip ang bn-new lay txt) (setq ed (entget ent) ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)) bn-new (e11:block-name (cdr (assoc 'type data)) (cdr (assoc 'w1 data)) (cdr (assoc 'w2 data)) t1 t2 (cdr (assoc 'hand data)) *DT:Insul*) lay (e11:safe-layer (e11:type-layer (cdr (assoc 'type data))))) (if (not (tblsearch "BLOCK" bn-new)) (e11:make-block bn-new (cdr (assoc 'type data)) (cdr (assoc 'w1 data)) (cdr (assoc 'w2 data)) t1 t2 (cdr (assoc 'hand data)))) (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed)) (setq ed (subst (cons 8 lay) (assoc 8 ed) ed)) (entmod ed) (entupd ent) (setq txt (e11:tht-text t1 t2)) (e11:add-tht-text txt))

(defun e11:edit-one (/ sel ent ed bn data ip ang pick side method dval base axis pts newv t1 t2) 
  (setq sel (entsel "\nSelect Mitered Elbow to Edit: ")) 
  (if sel (progn (setq ent (car sel) ed (entget ent) bn (cdr (assoc 2 ed))) 
                 (if (and (= (type bn) 'STR) (wcmatch (strcase bn) "E11V*-*")) 
                   (progn (setq data (e11:parse-name bn) ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)) pick (getpoint "\nClick near the throat edge to modify: ")) 
                          (if pick (progn (setq side (e11:pick-side data pick ip ang) pts (e11:points-local (cdr (assoc 'w1 data)) (cdr (assoc 'w2 data)) (cdr (assoc 't1 data)) (cdr (assoc 't2 data)) (cdr (assoc 'hand data)))) 
                                          (if (= side 't1) (progn (setq base (e11:xf (car (e11:pt 1 pts)) (cadr (e11:pt 1 pts)) ip ang) axis (e11:unit (e11:v- (e11:xf (car (e11:pt 6 pts)) (cadr (e11:pt 6 pts)) ip ang) base)))) 
                                                          (progn (setq base (e11:xf (car (e11:pt 5 pts)) (cadr (e11:pt 5 pts)) ip ang) axis (e11:unit (e11:v- (e11:xf (car (e11:pt 6 pts)) (cadr (e11:pt 6 pts)) ip ang) base))))) 
                                          (initget "Value PickDuct") (setq method (getkword (strcat "\nChange " (if (= side 't1) "Throat 1" "Throat 2") " by [Value/PickDuct] <Value>: "))) 
                                          (if (null method) (setq method "Value")) 
                                          (if (= method "PickDuct") (progn (setq sel (entsel "\nSelect duct block to align throat with: ")) (if sel (setq dval (e11:dt-face-distance (car sel) base axis)))) 
                                                          (progn (initget 6) (setq newv (getreal (strcat "\nEnter new value for " (if (= side 't1) "Throat 1" "Throat 2") ": "))) (setq dval newv))) 
                                          (if (and dval (> dval 0.0)) (progn (setq t1 (cdr (assoc 't1 data)) t2 (cdr (assoc 't2 data))) (if (= side 't1) (setq t1 dval) (setq t2 dval)) (e11:update-block ent data t1 t2) (princ (strcat "\n[E11] Updated " (if (= side 't1) "Throat 1" "Throat 2") " = " (rtos dval 2 0)))) (princ "\n[E11] Error: Invalid throat value.")))) 
                   (princ "\n[E11] Error: Selected object is not an E11 elbow."))))))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:E11 (/ kw hand ip w1 w2 bn txt ref ss
                t1in t2in w2in
                duct-ss duct-ent duct-ed duct-bn dims dlen
                det-type duct-rot duct-start duct-end d-start d-end conn-side elbow-rot
                preview-ref loop ev cd vl preview-ip)
  (e11:load-deps)
  (vl-catch-all-apply 'dts:ensure-defaults nil)
  (vl-catch-all-apply 'dts:sync-shape (list "RECT"))

  ;; B1: Draw/Setting
  (initget "Draw Setting")
  (setq kw (getkword "\nB1 - Action [Draw/Setting] <Draw>: "))
  (if (null kw) (setq kw "Draw"))

  ;; Setting mode: only update throat defaults
  (if (= kw "Setting")
    (progn
      (initget 6)
      (setq t1in (getreal (strcat "\nB2 - Throat T1 <" (rtos *E11:T1* 2 0) ">: ")))
      (if t1in (setq *E11:T1* t1in))
      (initget 6)
      (setq t2in (getreal (strcat "\nB2 - Throat T2 <" (rtos *E11:T2* 2 0) ">: ")))
      (if t2in (setq *E11:T2* t2in))
      (princ (strcat "\n[E11] Saved defaults: T1=" (rtos *E11:T1* 2 0) " | T2=" (rtos *E11:T2* 2 0)))
    )
  )

  ;; Draw mode (default)
  (if (= kw "Draw")
    (progn
      ;; B2: Pick placement position (center of duct end)
      (setq ip (getpoint "\nB2 - Pick center point at duct end: "))
      (if ip
        (progn
          ;; Find DTv9 near pick point to auto-inherit
          (setq duct-ss (ssget "C"
                               (list (- (car ip) 100.0) (- (cadr ip) 100.0) 0.0)
                               (list (+ (car ip) 100.0) (+ (cadr ip) 100.0) 0.0)
                               '((0 . "INSERT") (2 . "DTv9-*"))))

          (if duct-ss
            (progn
              (setq duct-ent (ssname duct-ss 0)
                    duct-ed  (entget duct-ent)
                    duct-bn  (cdr (assoc 2 duct-ed)))
              (setq dims (e11:extract-dims duct-bn))
              (if dims
                (progn
                  ;; Auto system/insulation/width with W1=W duct
                  (setq dlen (nth 0 dims)
                        w1   (nth 1 dims))
                  (setq *E11:W1* w1)

                  (setq det-type (e11:extract-system duct-bn))
                  (if (= (type det-type) 'STR)
                    (setq *DT:Type* det-type))
                  (if (not (= (type *DT:Type*) 'STR))
                    (setq *DT:Type* "SA"))
                  (setq *DT:Type* (e11:norm-type *DT:Type*))
                  (setq *DT:Insul* (e11:extract-insulation duct-bn))

                  (princ (strcat "\n[Auto-detect] System: " *DT:Type* " | Insul: " (itoa *DT:Insul*) " | W1: " (rtos *E11:W1* 2 0)))
                  (e11:init *DT:Type*)

                  ;; Ask W2, default = W1
                  (initget 6)
                  (setq w2in (getreal (strcat "\nB3 - Width W2 <" (rtos *E11:W1* 2 0) ">: ")))
                  (if w2in
                    (setq *E11:W2* w2in)
                    (setq *E11:W2* *E11:W1*))

                  ;; Rotation logic: source duct rotation +/- 90 degrees.
                  ;; Example: duct rot 0 -> left end = 90 deg, right end = 270 deg.
                  (setq duct-rot (cdr (assoc 50 duct-ed)))
                  (if (not duct-rot) (setq duct-rot 0.0))
                  (setq duct-start (cdr (assoc 10 duct-ed))
                        duct-end   (e11:get-duct-endpoint duct-start dlen duct-rot)
                        d-start    (distance ip duct-start)
                        d-end      (distance ip duct-end)
                        conn-side  (if (<= d-start d-end) "LeftEnd" "RightEnd")
                    elbow-rot  (e11:norm-ang
                         (if (= conn-side "LeftEnd")
                                       (+ duct-rot (/ pi 2.0))
                                       (- duct-rot (/ pi 2.0)))))

                  ;; Toggle + click place (similar E1 behavior)
                  (setq hand *E11:Hand*)
                  (setq loop T preview-ref nil)
                  (while loop
                    (setq bn (e11:block-name *DT:Type* *E11:W1* *E11:W2* *E11:T1* *E11:T2* hand *DT:Insul*))
                    (if (not (tblsearch "BLOCK" bn))
                      (e11:make-block bn *DT:Type* *E11:W1* *E11:W2* *E11:T1* *E11:T2* hand))

                    (setq preview-ip (e11:center-to-corner ip *E11:W1* hand elbow-rot))
                    (if preview-ref (entdel preview-ref))
                    (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity")
                                       (cons 8 (e11:safe-layer (e11:type-layer *DT:Type*)))
                                       '(62 . 1) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                                       (cons 2 bn) (cons 10 preview-ip)
                                       '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)
                                       (cons 50 elbow-rot)))
                      (setq preview-ref (entlast)))

                    (princ (strcat "\n[E11] Preview Hand=" hand " | SPACE=Toggle | Click=Place | ESC=Cancel"))
                    (setq ev (grread T 15 0) cd (car ev) vl (cadr ev))
                    (cond
                      ;; Click -> finalize placement
                      ((= cd 3)
                       (setq loop nil)
                       (if preview-ref (entdel preview-ref))
                       (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity")
                                          (cons 8 (e11:safe-layer (e11:type-layer *DT:Type*)))
                                          '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                                          (cons 2 bn) (cons 10 preview-ip)
                                          '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)
                                          (cons 50 elbow-rot)))
                         (progn
                           (setq ref (entlast))
                           (setq txt (e11:tht-text *E11:T1* *E11:T2*))
                           (e11:add-tht-text txt)
                           (setq *E11:Hand* hand)
                           (princ (strcat "\n[E11] Placed: " bn)))
                         (princ "\n[E11] Error: Block insertion failed.")))
                      ;; SPACE -> toggle
                      ((and (= cd 2) (= vl 32))
                       (setq hand (if (= (strcase hand) "RIGHT") "Left" "Right")))
                      ;; ESC -> cancel
                      ((and (= cd 2) (= vl 27))
                       (setq loop nil)
                       (if preview-ref (entdel preview-ref))
                       (princ "\n[E11] Cancelled."))
                    )
                  )
                )
                (princ "\n[E11] Error: Cannot parse DTv9 dimensions."))
            )
            (princ "\n[E11] Error: No DTv9 duct found near picked point."))
        )
        (princ "\n[E11] Cancelled."))
    )
  )
  (princ)
)

(defun c:MITEREDELBOW () (c:E11))

(princ "\n[TBH] Mitered Elbow loaded. Type 'E11' to start.")
(princ)
