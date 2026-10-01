;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Rectangular duct.lsp
;;; Module      : Draw\Create
;;; Command     : D1, DRAWDUCT
;;; Description : Draws rectangular ducts with automated segmenting and insulation.
;;;
;;; 
;;; Usage       :
;;; 1. Run 'D1'.
;;; 2. Choose action [Draw/Change/DTS].
;;; 3. Pick Start point and End point.
;;; 4. Enter Width (W) and Height (H).
;;; 5. Generates blocks with accurate sizing, layers, and insulation.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── DEPENDENCIES ───────────────────────────────────
(defun dt:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      ;; Attempt to find setting script in search path
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if (and fp (findfile fp)) 
        (load fp) 
        (princ "\n[DTS] Warning: 'Duct Type Setting.lsp' not found in search paths.")))))

(dt:load-dts)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*DT:MaxLen*)) (setq *DT:MaxLen* 1400.0))
(if (not (boundp '*DT:Type*))   (setq *DT:Type*   "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul*  0))
(if (not (boundp '*DT:W*))      (setq *DT:W*      600.0))
(if (not (boundp '*DT:H*))      (setq *DT:H*      400.0))
(if (not (boundp '*DT:FL*))     (setq *DT:FL*     35.0))
(if (not (boundp '*DT:FT*))     (setq *DT:FT*     35.0))
(if (not (boundp '*DT:MARGIN*)) (setq *DT:MARGIN* 50.0))

;; ─── HELPERS ────────────────────────────────────────
(defun dt:split (str delim / pos lst)
  (setq lst '()) 
  (while (setq pos (vl-string-search delim str)) 
    (setq lst (append lst (list (substr str 1 pos)))) 
    (setq str (substr str (+ pos (strlen delim) 1)))) 
  (append lst (list str)))

(defun dt:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun dt:lo (tp) (cdr (assoc (strcase tp) '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra") ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))
(defun dt:ls (tp) (strcat (dt:lo tp) "-shading"))

(defun dt:init (tp / ad lays l-insul)
  (setq ad (vla-get-activedocument (vlax-get-acad-object)) lays (vla-get-layers ad))
  (foreach ln (list (dt:lo tp) (dt:ls tp) "Hvacduct-Text" "Hvacduct-Insul" "Hvacins")
    (if (not (tblsearch "LAYER" ln)) (vl-catch-all-apply 'vla-add (list lays ln))))
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) (vl-catch-all-apply 'vla-put-color (list l-insul 118)))
  (if (not (tblsearch "STYLE" "HVACS")) (command "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))
  (if (not (tblsearch "STYLE" "HVACSI")) (command "_-STYLE" "HVACSI" "Arial Narrow|b0|i1|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))

(defun dt:get-insul (idx)
  ;; Format: (Prefix Thick Pattern Scale Angle CustomType(1/2) Mode(0=none, 1=Int, 2=Ext))
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

(defun dt:xf (bx by ip ang / ca sa) (setq ca (cos ang) sa (sin ang)) (list (+ (car ip) (* bx ca) (- (* by sa))) (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

(defun dt:hatch-in-block (lay plen w / cx cy)
  (setq cx (/ plen 2.0) cy (/ (- w) 2.0))
  (if (not (entmake (list '(0 . "HATCH") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbHatch") (list 10 0.0 0.0 0.0) '(210 0.0 0.0 1.0) '(2 . "SOLID") '(70 . 1) '(71 . 0) '(91 . 1) '(92 . 1) '(93 . 4) '(72 . 1) (list 10 0.0 0.0) (list 11 plen 0.0) '(72 . 1) (list 10 plen 0.0) (list 11 plen (- w)) '(72 . 1) (list 10 plen (- w)) (list 11 0.0 (- w)) '(72 . 1) (list 10 0.0 (- w)) (list 11 0.0 0.0) '(97 . 0) '(75 . 0) '(76 . 1) '(98 . 1) (list 10 cx cy 0.0))))
    (entmake (list '(0 . "SOLID") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer") (list 10 0.0 0.0 0.0) (list 11 plen 0.0 0.0) (list 12 0.0 (- w) 0.0) (list 13 plen (- w) 0.0)))))

(defun dt:hatch-insul (bname lay pat scl angDeg tp_h plen w / ad blks bdef hobj pts pline loop success)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) blks (vla-get-Blocks ad) bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp_h pat :vlax-false 0))) (if (not (vl-catch-all-error-p hobj)) (progn (vl-catch-all-apply 'vla-put-Layer (list hobj lay)) (vl-catch-all-apply 'vla-put-Color (list hobj 256)) (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl)) (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angDeg 180.0) pi))) (setq pts (vlax-make-safearray vlax-vbDouble '(0 . 7))) (vlax-safearray-fill pts (list 0.0 0.0 plen 0.0 plen (- w) 0.0 (- w))) (setq pline (vla-AddLightWeightPolyline bdef pts)) (vla-put-Closed pline :vlax-true) (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element loop 0 pline) (if (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop)))) (progn (vl-catch-all-apply 'vla-Evaluate (list hobj)) (setq success T))) (vl-catch-all-apply 'vla-Delete (list pline))))))
  success)

(defun dt:flanges (lay plen w ecMode / fl ft make-poly)
  (setq fl *DT:FL* ft *DT:FT*)
  (defun make-poly (pts) (entmake (append (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 8) '(6 . "ByLayer") '(100 . "AcDbPolyline") (cons 90 (length pts)) '(70 . 0) '(43 . 0.0)) (mapcar '(lambda (pt) (cons 10 pt)) pts))))
  (if (/= ecMode 2) (make-poly (list (list 0.0 ft) (list 0.0 0.0) (list fl 0.0) (list fl (- w)) (list 0.0 (- w)) (list 0.0 (- 0.0 w ft)))))
  (if (/= ecMode 1) (make-poly (list (list plen ft) (list plen 0.0) (list (- plen fl) 0.0) (list (- plen fl) (- w)) (list plen (- w)) (list plen (- 0.0 w ft))))))

(defun dt:make-attdef (tag txt sty px py att / j72 j74 obl)
  (setq j72 0 j74 0)
  (cond
    ((= att 1)  (setq j72 0 j74 3))
    ((= att 5)  (setq j72 0 j74 2))
    ((= att 9)  (setq j72 2 j74 1))
    ((= att 13) (setq j72 2 j74 2)))
  (setq obl (if (= sty "HVACSI") 0.2618 0.0))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 px py 0.0) '(40 . 100.0) '(41 . 0.8) (cons 51 obl) (cons 1 txt) (cons 7 sty) (cons 72 j72) (list 11 px py 0.0) '(100 . "AcDbAttributeDefinition") (cons 2 tag) (cons 3 tag) '(70 . 0) (cons 74 j74))))

(defun dt:make-attrib (tag txt sty bx by att ip insAng txtAng / j72 j74 wpt obl)
  (setq j72 0 j74 0)
  (cond
    ((= att 1)  (setq j72 0 j74 3))
    ((= att 5)  (setq j72 0 j74 2))
    ((= att 9)  (setq j72 2 j74 1))
    ((= att 13) (setq j72 2 j74 2)))
  (setq obl (if (= sty "HVACSI") 0.2618 0.0) wpt (dt:xf bx by ip insAng))
  (entmake (list '(0 . "ATTRIB") (cons 8 "Hvacduct-Text") (list 10 (car wpt) (cadr wpt) 0.0) (cons 40 100.0) (cons 41 0.8) (cons 51 obl) (cons 1 txt) (cons 50 txtAng) (cons 7 sty) (cons 72 j72) (list 11 (car wpt) (cadr wpt) 0.0) (cons 2 tag) '(70 . 0) (cons 74 j74))))

(defun dt:make-block (bname tp pl w h insIdx ecMode / idata prf thk pat scl ang tp_h mode lo ls mg ss sl)
  (setq idata (dt:get-insul insIdx) prf (car idata) thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) ang (nth 4 idata) tp_h (nth 5 idata) mode (nth 6 idata) lo (dt:lo tp) ls (dt:ls tp) mg *DT:MARGIN* ss (strcat (itoa (fix w)) "x" (itoa (fix h))) sl (strcat (itoa (fix pl)) "L"))
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  (dt:hatch-in-block ls pl w)
  (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lo) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1) '(43 . 0.0) (list 10 0.0 0.0) (list 10 pl 0.0) (list 10 pl (- w)) (list 10 0.0 (- w))))
  (dt:flanges lo pl w ecMode)
  (if (> mode 0)
    (progn (defun entmake-poly (pts) (entmake (append (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbPolyline") (cons 90 (length pts)) '(70 . 0) '(43 . 0.0)) (mapcar '(lambda (pt) (cons 10 pt)) pts))))
     (if (= mode 1) (progn (if (= ecMode 0) (progn (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (- thk) 0.0) (list 11 pl (- thk) 0.0))) (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (- thk w) 0.0) (list 11 pl (- thk w) 0.0))))) (if (= ecMode 1) (entmake-poly (list (list 0.0 (- thk)) (list (- pl thk) (- thk)) (list (- pl thk) (- thk w)) (list 0.0 (- thk w)))))(if (= ecMode 2) (entmake-poly (list (list pl (- thk)) (list thk (- thk)) (list thk (- thk w)) (list pl (- thk w)))))))
    (if (= mode 2) (progn (if (= ecMode 0) (progn (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 thk 0.0) (list 11 pl thk 0.0))) (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (- 0.0 w thk) 0.0) (list 11 pl (- 0.0 w thk) 0.0))))) (if (= ecMode 1) (entmake-poly (list (list 0.0 thk) (list (+ pl thk) thk) (list (+ pl thk) (- 0 w thk)) (list 0.0 (- 0 w thk)))))(if (= ecMode 2) (entmake-poly (list (list pl thk) (list (- 0 thk) thk) (list (- 0 thk) (- 0 w thk)) (list pl (- 0 w thk)))))))))
  (dt:make-attdef "SIZE" ss "HVACS" mg (- 0.0 mg) 1) (dt:make-attdef "LENGTH" sl "HVACSI" (- pl mg) (- mg w) 9)
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "BOD") '(3 . "BOD") '(70 . 1) '(74 . 0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "COD") '(3 . "COD") '(70 . 1) '(74 . 0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "TOD") '(3 . "TOD") '(70 . 1) '(74 . 0)))
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))
  (if (> mode 0) (dt:hatch-insul bname "Hvacduct-Insul" pat scl ang tp_h pl w)))

(defun dt:draw (tp ip ang totlen w h insIdx / maxl np i rem-len pl bn cu lo mg prf size-txt tang pW1 pW2 pW3 pW4 rule pts winTL idxTL C offAbove offBelow bySIZE byLEN bxTL bxLEN)
  (dt:init tp) (setq lo (dt:lo tp) mg *DT:MARGIN* maxl *DT:MaxLen* prf (car (dt:get-insul insIdx)) np (fix (/ totlen maxl))) (if (> (rem totlen maxl) 0.01) (setq np (1+ np))) (setq cu ip i 1)
  (while (<= i np) (setq rem-len (- totlen (* (1- i) maxl)) pl (min rem-len maxl) bn (strcat "DTv9-" tp "-" (itoa (fix pl)) "x" (itoa (fix w)) "x" (itoa (fix h)) (if (= prf "") "" (strcat "-" prf)) (dt:rand-sfx))) (if (not (tblsearch "BLOCK" bn)) (dt:make-block bn tp pl w h insIdx 0)) (entmake (list '(0 . "INSERT") (cons 2 bn) (cons 10 cu) (cons 50 ang) (cons 8 lo) '(66 . 1)))
    (setq size-txt (strcat (itoa (fix w)) "x" (itoa (fix h)))) (if (and (> np 1) (= (rem (- np i) 2) 0)) (setq size-txt ""))
    (setq tang ang) (while (> tang pi) (setq tang (- tang (* 2.0 pi)))) (while (<= tang (- pi)) (setq tang (+ tang (* 2.0 pi)))) (if (or (> tang 1.5708) (<= tang -1.5707)) (setq tang (+ tang pi)))
    (setq pW1 cu pW2 (dt:xf pl 0.0 cu ang) pW3 (dt:xf pl (- 0.0 w) cu ang) pW4 (dt:xf 0.0 (- 0.0 w) cu ang))
    (if (> (abs (cos ang)) 0.174) (setq rule "H") (setq rule "V"))
    (setq pts (list (list pW1 1) (list pW2 2) (list pW3 3) (list pW4 4)) winTL (car pts)) (foreach p (cdr pts) (if (if (= rule "H") (or (< (caar p) (caar winTL)) (and (equal (caar p) (caar winTL) 0.01) (> (cadar p) (cadar winTL)))) (or (< (cadar p) (cadar winTL)) (and (equal (cadar p) (cadar winTL) 0.01) (< (caar p) (caar winTL))))) (setq winTL p)))
    (setq idxTL (cadr winTL) C (- 0.0 (/ w 2.0)))
    (cond ((<= w 250.0) (setq offAbove C offBelow C)) ((<= w 300.0) (setq offAbove (+ C 100.0) offBelow (- C 100.0))) (T (setq offAbove -50.0 offBelow (+ (- 0.0 w) 50.0))))
    (if (if (= rule "V") (< (car pW1) (car pW4)) (> (cadr pW1) (cadr pW4))) (setq bySIZE offAbove byLEN offBelow) (setq bySIZE offBelow byLEN offAbove))
    ;; For narrow ducts (w<=250): follow D2 rule exactly, both tags sit on duct centerline.
    (if (<= w 250.0)
      (setq bySIZE C byLEN C))
    (setq bxTL (if (or (= idxTL 1) (= idxTL 4)) mg (- pl mg)) bxLEN (if (or (= idxTL 1) (= idxTL 4)) (- pl mg) mg))
    (dt:make-attrib "SIZE" size-txt "HVACS" bxTL bySIZE (if (<= w 250.0) 5 1) cu ang tang)
    (dt:make-attrib "LENGTH" (strcat (itoa (fix pl)) "L") "HVACSI" bxLEN byLEN (if (<= w 250.0) 13 9) cu ang tang)
    ;; Hidden ATTRIBs: BOD / COD / TOD (invisible, empty default)
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "BOD") '(70 . 1) '(74 . 0)))
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "COD") '(70 . 1) '(74 . 0)))
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "TOD") '(70 . 1) '(74 . 0)))
    (entmake (list '(0 . "SEQEND") (cons 8 lo))) (setq cu (dt:xf pl 0.0 cu ang) i (1+ i)))
  (princ (strcat "\n[DONE] " (itoa np) " segments created | " tp " " (itoa (fix w)) "x" (itoa (fix h)) " L=" (rtos totlen 2 0))))

(defun dt:edit-ducts (/ ss n i ent ed bn parts dims pl w h nType nIns nPrf bn-new lo oldEC ecStr)
  (princ "\nSelect ducts to modify: ")
  (if (setq ss (ssget '((0 . "INSERT"))))
     (progn (initget "1 2 3 4 5 SA RA OA EA TA") (setq nType (getkword (strcat "\nChange System [1=SA / 2=RA / 3=OA / 4=EA / 5=TA] <" *DT:Type* ">: "))) (if (null nType) (setq nType *DT:Type*)) (cond ((= nType "1") (setq nType "SA")) ((= nType "2") (setq nType "RA")) ((= nType "3") (setq nType "OA")) ((= nType "4") (setq nType "EA")) ((= nType "5") (setq nType "TA"))) (setq *DT:Type* nType) (initget "0 1 2 3 4 5 6 7") (setq nIns (getkword (strcat "\nChange Insulation [0=Bare / 1=Int25 / 2=Int50 / 3=Int75 / 4=Int100 / 5=Ext25 / 6=Ext50 / 7=Ext75] <" (itoa *DT:Insul*) ">: "))) (if (null nIns) (setq nIns (itoa *DT:Insul*))) (setq nIns (atoi nIns) *DT:Insul* nIns nPrf (car (dt:get-insul nIns)) lo (dt:lo nType) i 0 n (sslength ss))
      (while (< i n) (setq ent (ssname ss i) ed (entget ent) bn (cdr (assoc 2 ed))) (if (wcmatch bn "DT*") (progn (setq oldEC 0 ecStr "") (if (vl-string-search "_ECR" bn) (setq oldEC 1 ecStr "_ECR")) (if (vl-string-search "_ECL" bn) (setq oldEC 2 ecStr "_ECL")) (setq parts (dt:split bn "-")) (if (>= (length parts) 3) (progn (setq dims (dt:split (nth 2 parts) "x")) (if (= (length dims) 3) (progn (setq pl (atof (nth 0 dims)) w (atof (nth 1 dims)) h (atof (nth 2 dims)) bn-new (strcat "DTv9-" nType ecStr "-" (rtos pl 2 0) "x" (rtos w 2 0) "x" (rtos h 2 0) (if (= nPrf "") "" (strcat "-" nPrf)) (dt:rand-sfx))) (if (not (tblsearch "BLOCK" bn-new)) (dt:make-block bn-new nType pl w h nIns oldEC)) (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed) ed (subst (cons 8 lo) (assoc 8 ed) ed)) (entmod ed) (entupd ent))))))) (setq i (1+ i))) (princ (strcat "\n[DONE] " (itoa n) " ducts updated."))))
  (princ))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:D1 (/ kw pt1 pt2 tl ang wi hi)
  (dt:load-dts)
  (if (boundp 'dts:sync-shape) (dts:sync-shape "RECT"))
  (initget "Draw DTS")
  (setq kw (getkword (strcat "\nAction [Draw/DTS] <Draw> | " (if (boundp 'dts:describe-shape) (dts:describe-shape "RECT") "RECT") ": ")))
  (if (null kw) (setq kw "Draw"))
  (if (= kw "DTS")
    (progn
      (c:DTS)
      (if (boundp 'dts:sync-shape) (dts:sync-shape "RECT"))))
  (setq pt1 (getpoint (strcat "\n[" *DT:Type* "] Pick Start point (Top-Left): ")))
  (if pt1
    (progn
      (if (= (length pt1) 2) (setq pt1 (list (car pt1) (cadr pt1) 0.0)))
      (setq pt2 (getpoint pt1 "\nPick End point (Direct length & angle): "))
      (if pt2
        (progn
          (if (= (length pt2) 2) (setq pt2 (list (car pt2) (cadr pt2) 0.0)))
          (setq tl (distance pt1 pt2)
                ang (angle pt1 pt2))
          (if (> tl 1.0)
            (progn
              (initget 6)
              (setq wi (getreal (strcat "\nWidth W <" (rtos *DT:W* 2 0) ">: ")))
              (if wi (setq *DT:W* wi))
              (initget 6)
              (setq hi (getreal (strcat "\nHeight H <" (rtos *DT:H* 2 0) ">: ")))
              (if hi (setq *DT:H* hi))
              (dt:draw *DT:Type* pt1 ang tl *DT:W* *DT:H* *DT:Insul*))
            (princ "\n[D1] Error: Length too short.")))
        (princ "\n[D1] Cancelled.")))
    (princ "\n[D1] Cancelled."))
  (princ))

(defun c:DRAWDUCT () (c:D1))

(princ "\n[TBH] Draw Rectangular Duct v9.0 loaded. Type 'D1' to start.")
(princ)
