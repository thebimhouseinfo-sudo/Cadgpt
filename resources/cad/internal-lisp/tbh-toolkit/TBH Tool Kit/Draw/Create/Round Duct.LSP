;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Round Duct.LSP
;;; Module      : Draw\Create
;;; Command     : D2, ROUNDDUCT, ECRD2
;;; Description : Draws standard round ducts.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Input Diameter.
;;; 3. Pick Start point and End point to generate round segment.
;;; TBH-HEADER-END
;;; =============================================================================
(defun rd:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
    frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
      (substr ms (max 1 (- (strlen ms) 4)))
      (substr frac 1 (min 4 (strlen frac)))))
;;; ===================================================
;;; File    : Round Duct.lsp
;;; Module  : Draw
;;; Command : RD
;;; Description: Draw round duct / With Insulation / Edit
;;; Detail:
;;;   Command: RD
;;;   Auto generate Block, dashed Centerline attribute...
;;; ===================================================

(vl-load-com)

(defun rd:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if fp
        (load fp)
        (progn
          (setq fp "H:/01 FDM Projects/00 Template/CAD TEMPLATE/LSP/New arrgangement/Draw/Duct Type Setting.lsp")
          (if (findfile fp)
            (load fp)
            (princ "\n[DTS] Warning: Duct Type Setting.lsp not found.")))))))

(rd:load-dts)

;; ─── GLOBALS ────────────────────────────────────────
(if (not (boundp '*RD:MaxLen*)) (setq *RD:MaxLen* 1500.0))
(if (not (boundp '*RD:Type*))   (setq *RD:Type*   "SA"))
(if (not (boundp '*RD:Insul*))  (setq *RD:Insul*  0))
(if (not (boundp '*RD:D*))      (setq *RD:D*      300.0))
(setq *RD:MARGIN* 50.0) ; Khoang cach text tu 2 dau ong

;; ─── HELPER ─────────────────────────────────────────
(defun rd:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos 2))))
  (append lst (list str)))

(defun rd:ins-token-from-parts (parts / p u)
  ;; Scan from tail; supports optional random suffix after insulation token.
  (setq p (reverse parts))
  (while p
    (setq u (strcase (car p)))
    (if (or (wcmatch u "INT*") (wcmatch u "EXT*"))
      (progn (setq p nil)
             (setq u u))
      (progn
        (setq u nil)
        (setq p (cdr p)))))
  u)

;; ─── LAYER NAMES ────────────────────────────────────
(defun rd:lo (tp) (cdr (assoc tp '(("SA" . "Hvacduct-sa")("RA" . "Hvacduct-ra")("EA" . "Hvacduct-ea")("OA" . "Hvacduct-oa")("TA" . "Hvacduct-ta")))))
(defun rd:ls (tp) (strcat (rd:lo tp) "-shading"))
(defun rd:lc (tp) (strcat (rd:lo tp) "-Center"))

;; ─── INIT ───────────────────────────────────────────
(defun rd:init (tp / ad lays l-insul c-lay)
  (setq ad (vla-get-activedocument (vlax-get-acad-object)))
  (setq lays (vla-get-layers ad))
  (foreach ln (list (rd:lo tp) (rd:ls tp) (rd:lc tp) "Hvacduct-Text" "Hvacduct-Insul" "Hvacins")
    (if (not (tblsearch "LAYER" ln))
      (vl-catch-all-apply 'vla-add (list lays ln))))
  
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) (vl-catch-all-apply 'vla-put-color (list l-insul 118)))
  
  (setq c-lay (vl-catch-all-apply 'vla-Item (list lays (rd:lc tp))))
  (if (not (vl-catch-all-error-p c-lay))
    (progn
     (vl-catch-all-apply 'vla-put-color (list c-lay 1))
     (vl-catch-all-apply 'vla-put-linetype (list c-lay "VSDD"))
    )
  )
  
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))
  (if (not (tblsearch "STYLE" "HVACSI"))
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACSI" "Arial Narrow|b0|i1|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))))

;; ─── INSULATION DATA ────────────────────────────────
(defun rd:get-insul (idx)
  (cond
    ((= idx 0) '("" 0 "SOLID" 1.0 0.0 0 0))
    ((= idx 1) '("INT25"   25 "INS25I"  1.0       0.0  2 1))
    ((= idx 2) '("INT50"   50 "INS50I"  1.0       0.0  2 1))
    ((= idx 3) '("INT75"   75 "INS75I"  40.0      0.0  2 1))
    ((= idx 4) '("INT100" 100 "INS100I" 1.0       45.0 2 1))
    ((= idx 5) '("EXT25"   25 "ANSI31"  43.478261 0.0  1 2))
    ((= idx 6) '("EXT50"   50 "ANSI32"  15.0      0.0  1 2))
    ((= idx 7) '("EXT75"   75 "ANSI34"  22.222222 0.0  1 2))
    (t         '("" 0 "SOLID" 1.0 0.0 0 0))))

;; ─── BLOCK COORD SYSTEM ─────────────────────────────
(defun rd:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa))) (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

;; ─── SOLID HATCH (BASE UNDERLAY) ────────────────────
(defun rd:hatch-in-block (lay plen d / cy)
  (setq cy (/ d 2.0))
  (if (not (entmake (list '(0 . "HATCH") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbHatch")
                   (list 10 0.0 0.0 0.0) '(210 0.0 0.0 1.0) '(2 . "SOLID") '(70 . 1) '(71 . 0)
                   '(91 . 1) '(92 . 1) '(93 . 4)
                   '(72 . 1) (list 10 0.0 cy)   (list 11 plen cy)
                   '(72 . 1) (list 10 plen cy)  (list 11 plen (- cy))
                   '(72 . 1) (list 10 plen (- cy))(list 11 0.0 (- cy))
                   '(72 . 1) (list 10 0.0 (- cy)) (list 11 0.0 cy)
                   '(97 . 0) '(75 . 0) '(76 . 1) '(98 . 1) (list 10 (/ plen 2.0) 0.0 0.0))))
    (entmake (list '(0 . "SOLID") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                   (list 10 0.0 cy 0.0) (list 11 plen cy 0.0) (list 12 0.0 (- cy) 0.0) (list 13 plen (- cy) 0.0)))))

;; ─── PATTERN HATCH (VLA INJECTION) ──────────────────
(defun rd:hatch-insul (bname lay pat scl angDeg tp_h plen d / ad blks bdef hobj pts pline loop success)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq blks (vla-get-Blocks ad))
  (setq bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp_h pat :vlax-false)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vl-catch-all-apply 'vla-put-Layer (list hobj lay))
          (vl-catch-all-apply 'vla-put-Color (list hobj 256))
          (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl))
          (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angDeg 180.0) pi)))
          (setq pts (vlax-make-safearray vlax-vbDouble '(0 . 7)))
          (vlax-safearray-fill pts (list 0.0 (/ d 2.0) plen (/ d 2.0) plen (- (/ d 2.0)) 0.0 (- (/ d 2.0))))
          (setq pline (vla-AddLightWeightPolyline bdef pts))
          (vla-put-Closed pline :vlax-true)
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0)))
          (vlax-safearray-put-element loop 0 pline)
          (if (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop))))
            (progn (vl-catch-all-apply 'vla-Evaluate (list hobj)) (setq success T)))
          (vl-catch-all-apply 'vla-Delete (list pline))))))
  success)

;; ─── ATTDEF & ATTRIB ────────────────────────────────
(defun rd:make-attdef (tag txt sty px py att / j72 j74 obl)
  (cond ((= att 1) (setq j72 0 j74 2)) ((= att 9) (setq j72 2 j74 2)))
  (setq obl (if (= sty "HVACSI") 0.2618 0.0))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbText") (list 10 px py 0.0) '(40 . 100.0) '(41 . 0.8) (cons 51 obl)
                 (cons 1 txt) (cons 7 sty) (cons 72 j72) (list 11 px py 0.0)
                 '(100 . "AcDbAttributeDefinition") (cons 2 tag) (cons 3 tag) '(70 . 0) (cons 74 j74))))

(defun rd:make-attrib (tag txt sty bx by att ip insAng txtAng / j72 j74 wpt obl)
  (cond ((= att 1) (setq j72 0 j74 2)) ((= att 9) (setq j72 2 j74 2)))
  (setq obl (if (= sty "HVACSI") 0.2618 0.0))
  (setq wpt (rd:xf bx by ip insAng))
  (entmake (list '(0 . "ATTRIB") (cons 8 "Hvacduct-Text") (list 10 (car wpt) (cadr wpt) 0.0)
                 (cons 40 100.0) (cons 41 0.8) (cons 51 obl) (cons 1 txt) (cons 50 txtAng) (cons 7 sty)
                 (cons 72 j72) (list 11 (car wpt) (cadr wpt) 0.0) (cons 2 tag) '(70 . 0) (cons 74 j74))))

;; ─── INSULATION POLYLINE HELPER ─────────────────────
(defun rd:entmake-poly (pts)
  (entmake (append (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbPolyline")
                         (cons 90 (length pts)) '(70 . 0) '(43 . 0.0))
                   (mapcar '(lambda (pt) (cons 10 pt)) pts))))

;; ─── MAKE BLOCK ─────────────────────────────────────
(defun rd:make-block (bname tp pl d insIdx ecMode / idata prf thk pat scl ang tp_h mode lo ls lc ss sl cy)
  (setq idata (rd:get-insul insIdx))
  (setq prf (car idata) thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) ang (nth 4 idata) tp_h (nth 5 idata) mode (nth 6 idata))
  (setq lo (rd:lo tp) ls (rd:ls tp) lc (rd:lc tp))
  (setq ss (strcat (itoa (fix d)) "%%c") sl (strcat (itoa (fix pl)) "L"))
  (setq cy (/ d 2.0))
  
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  
  ;; 1. Base Solid Hatch
  (rd:hatch-in-block ls pl d)
  
  ;; 2. Outline Polyline
  (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lo) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbPolyline")
                 '(90 . 4) '(70 . 1) '(43 . 0.0)
                 (list 10 0.0 cy) (list 10 pl cy) (list 10 pl (- cy)) (list 10 0.0 (- cy))))
  
  ;; 3. Insulation Lines
  (if (> mode 0)
    (progn
     (if (= mode 1)
       (progn ;; INTERNAL
         (if (= ecMode 0)
           (progn
             (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (- cy thk) 0.0) (list 11 pl (- cy thk) 0.0)))
             (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (+ (- cy) thk) 0.0) (list 11 pl (+ (- cy) thk) 0.0)))
           )
         )
         (if (= ecMode 1) ; Right End Cap
           (rd:entmake-poly (list (list 0.0 (- cy thk)) (list (- pl thk) (- cy thk)) (list (- pl thk) (+ (- cy) thk)) (list 0.0 (+ (- cy) thk))))
         )
         (if (= ecMode 2) ; Left End Cap
           (rd:entmake-poly (list (list pl (- cy thk)) (list thk (- cy thk)) (list thk (+ (- cy) thk)) (list pl (+ (- cy) thk))))
         )
       )
     )
     (if (= mode 2)
       (progn ;; EXTERNAL
         (if (= ecMode 0)
           (progn
             (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (+ cy thk) 0.0) (list 11 pl (+ cy thk) 0.0)))
             (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "Hvacins") '(62 . 256) '(6 . "Ins") '(100 . "AcDbLine") (list 10 0.0 (- 0.0 cy thk) 0.0) (list 11 pl (- 0.0 cy thk) 0.0)))
           )
         )
         (if (= ecMode 1) ; Right End Cap
           (rd:entmake-poly (list (list 0.0 (+ cy thk)) (list (+ pl thk) (+ cy thk)) (list (+ pl thk) (- 0.0 cy thk)) (list 0.0 (- 0.0 cy thk))))
         )
         (if (= ecMode 2) ; Left End Cap
           (rd:entmake-poly (list (list pl (+ cy thk)) (list (- 0.0 thk) (+ cy thk)) (list (- 0.0 thk) (- 0.0 cy thk)) (list pl (- 0.0 cy thk))))
         )
       )
     )
   )
  )
  
  ;; 4. Centerline (Continuous)
  (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lc) '(62 . 1) '(6 . "VSDD") '(100 . "AcDbLine")
                 (list 10 0.0 0.0 0.0) (list 11 pl 0.0 0.0)))
  
  ;; 5. Attributes (On the centerline)
  (rd:make-attdef "SIZE"   ss "HVACS"  *RD:MARGIN* 0.0 1)
  (rd:make-attdef "LENGTH" sl "HVACSI" (- pl *RD:MARGIN*) 0.0 9)
  ;; Hidden ATTDEFs: BOD / COD / TOD
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "BOD") '(3 . "BOD") '(70 . 1) '(74 . 0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "COD") '(3 . "COD") '(70 . 1) '(74 . 0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") '(10 0.0 0.0 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) '(11 0.0 0.0 0.0) '(100 . "AcDbAttributeDefinition") '(2 . "TOD") '(3 . "TOD") '(70 . 1) '(74 . 0)))
  
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))
  
  ;; 6. Insulation Hatch Injection
  (if (> mode 0) (rd:hatch-insul bname "Hvacduct-Insul" pat scl ang tp_h pl d))
)

;; ─── MAIN DRAWING LOGIC ─────────────────────────────
(defun rd:draw (tp ip ang totlen d insIdx / maxl np i rem-len pl bn cu lo mg prf size-txt pts winTL idxTL winBR idxBR bxSIZE bxLEN tang pW1 pW2 pW3 pW4 pStart pEnd rule len-txt)
  (rd:init tp)
  (setq lo (rd:lo tp) mg *RD:MARGIN* maxl *RD:MaxLen* prf (car (rd:get-insul insIdx)))
  
  (setq np (fix (/ totlen maxl)))
  (if (> (rem totlen maxl) 0.01) (setq np (1+ np)))
  (setq cu ip i 1)
  (while (<= i np)
    (setq rem-len (- totlen (* (1- i) maxl)))
    (setq pl (min rem-len maxl))
    (setq bn (strcat "RDv2-" tp "-" (itoa (fix pl)) "L-D" (itoa (fix d)) (if (= prf "") "" (strcat "-" prf)) (rd:rand-sfx)))
    (if (not (tblsearch "BLOCK" bn)) (rd:make-block bn tp pl d insIdx 0))
    (entmake (list '(0 . "INSERT") (cons 2 bn) (cons 10 cu) (cons 50 ang) (cons 8 lo) '(66 . 1)))
    
    (setq size-txt (strcat (itoa (fix d)) "%%c"))
    (if (and (> np 1) (= (rem (- np i) 2) 0)) (setq size-txt ""))
    (setq tang ang)
    (while (> tang pi) (setq tang (- tang (* 2.0 pi))))
    (while (<= tang (- pi)) (setq tang (+ tang (* 2.0 pi))))
    (if (or (> tang 1.5708) (<= tang -1.5707)) (setq tang (+ tang pi)))
    
    ;; Envelope corners in World Space: W1=Start-Top, W2=End-Top, W3=End-Bottom, W4=Start-Bottom
    (setq pW1 (rd:xf 0.0 (/ d 2.0) cu ang) pW2 (rd:xf pl (/ d 2.0) cu ang) pW3 (rd:xf pl (/ d -2.0) cu ang) pW4 (rd:xf 0.0 (/ d -2.0) cu ang))
    
    ;; Search for Top-Leftmost (SIZE) and Bottom-Rightmost (LENGTH) based on Orientation
    (setq pts (list (list pW1 1) (list pW2 2) (list pW3 3) (list pW4 4)))
    ;; Orientation Decision (Strict: only use Vertical rule if within ~10 degrees of actual vertical)
    (if (> (abs (cos ang)) 0.174) (setq rule "H") (setq rule "V"))
    
    (setq winTL (car pts))
    (foreach p (cdr pts)
      (if (if (= rule "H")
              (or (< (caar p) (caar winTL)) (and (equal (caar p) (caar winTL) 0.01) (> (cadar p) (cadar winTL))))
              (or (< (cadar p) (cadar winTL)) (and (equal (cadar p) (cadar winTL) 0.01) (< (caar p) (caar winTL)))))
        (setq winTL p)))
        
    (setq winBR (car pts))
    (foreach p (cdr pts)
      (if (if (= rule "H")
              (or (> (caar p) (caar winBR)) (and (equal (caar p) (caar winBR) 0.01) (< (cadar p) (cadar winBR))))
              (or (> (cadar p) (cadar winBR)) (and (equal (cadar p) (cadar winBR) 0.01) (> (caar p) (caar winBR)))))
        (setq winBR p)))
    (setq idxTL (cadr winTL) idxBR (cadr winBR))

    ;; Map indices to local bx for SIZE (Left end) and LENGTH (Right end) on centerline
    (setq bxSIZE (if (or (= idxTL 1) (= idxTL 4)) mg (- pl mg)))
    (setq bxLEN  (if (or (= idxTL 1) (= idxTL 4)) (- pl mg) mg))

    (rd:make-attrib "SIZE"   size-txt "HVACS" bxSIZE 0.0 1 cu ang tang)
    (setq len-txt (strcat (itoa (fix pl)) "L"))
    (rd:make-attrib "LENGTH" len-txt  "HVACSI" bxLEN 0.0 9 cu ang tang)
    ;; Hidden ATTRIBs: BOD / COD / TOD (invisible, empty default)
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "BOD") '(70 . 1) '(74 . 0)))
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "COD") '(70 . 1) '(74 . 0)))
    (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText") (list 10 (car cu) (cadr cu) 0.0) '(40 . 100.0) '(41 . 0.8) '(1 . "") '(7 . "HVACS") '(72 . 0) (list 11 (car cu) (cadr cu) 0.0) '(100 . "AcDbAttribute") '(2 . "TOD") '(70 . 1) '(74 . 0)))

    (entmake (list '(0 . "SEQEND") (cons 8 lo)))
    (setq cu (rd:xf pl 0.0 cu ang) i (1+ i)))
  (princ (strcat "\n[D2] " (itoa np) " doan | " tp " D" (itoa (fix d)) " L=" (rtos totlen 2 0))))


;; ─── BATCH EDIT (CHANGE) TOOL ───────────────────────

(defun rd:edit-ducts (/ ss n i ent ed bn parts pl d nType nIns nPrf bn-new lo oldEC ecStr)
  (princ "\nSelect ROUND ducts to Change: ")
  (if (setq ss (ssget '((0 . "INSERT"))))
    (progn
      (initget "1 2 3 4 5 SA RA OA EA TA")
      (setq nType (getkword (strcat "\nChange to Duct Type [1=SA / 2=RA / 3=OA / 4=EA / 5=TA] <" *RD:Type* ">: ")))
      (if (null nType) (setq nType *RD:Type*))
      (cond ((= nType "1") (setq nType "SA")) ((= nType "2") (setq nType "RA")) ((= nType "3") (setq nType "OA")) ((= nType "4") (setq nType "EA")) ((= nType "5") (setq nType "TA")))
      (setq *RD:Type* nType)
      
      (initget "0 1 2 3 4 5 6 7")
      (setq nIns (getkword (strcat "\nChange to Insulation [0=Bare / 1=Int25 / 2=Int50 / 3=Int75 / 4=Int100 / 5=Ext25 / 6=Ext50 / 7=Ext75] <" (itoa *RD:Insul*) ">: ")))
      (if (null nIns) (setq nIns (itoa *RD:Insul*)))
      (setq nIns (atoi nIns))
      (setq *RD:Insul* nIns)
      
      (setq nPrf (car (rd:get-insul nIns)) lo (rd:lo nType))
      
      (setq i 0 n (sslength ss))
      (while (< i n)
        (setq ent (ssname ss i) ed (entget ent) bn (cdr (assoc 2 ed)))
        (if (wcmatch bn "RD*")
          (progn
            (setq oldEC 0 ecStr "")
            (if (vl-string-search "_ECR" bn) (setq oldEC 1 ecStr "_ECR"))
            (if (vl-string-search "_ECL" bn) (setq oldEC 2 ecStr "_ECL"))
            (setq parts (rd:split bn "-"))
            (if (>= (length parts) 4)
              (progn
                (setq pl (atof (vl-string-subst "" "L" (nth 2 parts))))
                (setq d (atof (vl-string-subst "" "D" (nth 3 parts))))
                (if (> d 0.0)
                  (progn
                    (setq bn-new (strcat "RDv2-" nType ecStr "-" (rtos pl 2 0) "L-D" (rtos d 2 0) (if (= nPrf "") "" (strcat "-" nPrf)) (rd:rand-sfx)))
                    (if (not (tblsearch "BLOCK" bn-new))
                      (rd:make-block bn-new nType pl d nIns oldEC))
                    (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                    (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                    (entmod ed)
                    (entupd ent)
                  )
                )
              )
            )
          )
        )
        (setq i (1+ i))
      )
      (princ (strcat "\n[D2] Changed successfully " (itoa n) " ducts. ")))
  )
  (princ)
)

;; ─── USER INTERFACE ─────────────────────────────────
(defun c:D2 (/ kw pt1 pt2 tl ang di)
  (if (fboundp 'dts:sync-shape) (dts:sync-shape "ROUND"))
  (initget "Draw DTS")
  (setq kw (getkword (strcat "\nAction [Draw/DTS] <Draw> | "
                             (if (fboundp 'dts:describe-shape) (dts:describe-shape "ROUND") "")
                             ": ")))
  (if (null kw) (setq kw "Draw"))
  (progn
    (if (= kw "DTS")
      (progn
        (c:DTS)
        (dts:sync-shape "ROUND")))
      
      (setq pt1 (getpoint (strcat "\n[" *RD:Type* "] Center start point: ")))
      (if pt1
        (progn
          (if (= (length pt1) 2) (setq pt1 (list (car pt1) (cadr pt1) 0.0)))
          (setq pt2 (getpoint pt1 "\nCenter end point (@dist<ang): "))
          (if pt2
            (progn
              (if (= (length pt2) 2) (setq pt2 (list (car pt2) (cadr pt2) 0.0)))
              (setq tl (distance pt1 pt2) ang (angle pt1 pt2))
              (if (> tl 1.0)
                (progn
                  (initget 6) (setq di (getreal (strcat "\nDiameter D <" (rtos *RD:D* 2 0) ">: "))) (if di (setq *RD:D* di))
                  (rd:draw *RD:Type* pt1 ang tl *RD:D* *RD:Insul*))
                (princ "\n[D2] Length too short.")))
            (princ "\n[D2] Cancelled.")))
        (princ "\n[D2] Cancelled.")))
  (princ))

(defun c:ROUNDDUCT () (c:D2))

;; ─── ENCAP TOOL (ECR) ────────────────────────────────
(defun c:ECRD2 (/ ent ed bn p2 ip ang pl parts nType nIns prfStr x1 x2 d1 d2 newEC ecStr bn-new d txt-x txt-y txt-pt)
  (princ "\n[ECR] Convert round duct to Endcap")
  (if (setq ent (entsel "\nSelect round duct to create ECR: "))
    (progn
      (setq ent (car ent) ed (entget ent) bn (cdr (assoc 2 ed)))
      (if (and (= (cdr (assoc 0 ed)) "INSERT") (wcmatch bn "RDv2-*"))
        (progn
          (setq p2 (getpoint "\nPick duct end (Click nearer side to make ECR): "))
          (if p2
            (progn
              (setq ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)))
              (setq parts (rd:split bn "-"))
              (setq nType (nth 1 parts))
              (if (vl-string-search "_ECR" nType) (setq nType (vl-string-subst "" "_ECR" nType)))
              (if (vl-string-search "_ECL" nType) (setq nType (vl-string-subst "" "_ECL" nType)))
              
              (if (>= (length parts) 4)
                (progn
                  (setq pl (atof (vl-string-subst "" "L" (nth 2 parts))))
                  (setq d (atof (vl-string-subst "" "D" (nth 3 parts))))
                  (setq x1 ip x2 (rd:xf pl 0.0 ip ang))
                  (setq d1 (distance p2 x1) d2 (distance p2 x2))
                  (setq newEC (if (< d1 d2) 2 1)) ;; 2 = ECL, 1 = ECR
                  
                  (setq prfStr (or (rd:ins-token-from-parts parts) ""))
                  (setq nIns 0)
                  (if (= prfStr "INT25") (setq nIns 1)) (if (= prfStr "INT50") (setq nIns 2)) (if (= prfStr "INT75") (setq nIns 3)) (if (= prfStr "INT100") (setq nIns 4))
                  (if (= prfStr "EXT25") (setq nIns 5)) (if (= prfStr "EXT50") (setq nIns 6)) (if (= prfStr "EXT75") (setq nIns 7))
                  
                  (setq ecStr (if (= newEC 1) "_ECR" "_ECL"))
                  (setq bn-new (strcat "RDv2-" nType ecStr "-" (rtos pl 2 0) "L-D" (rtos d 2 0) (if (= prfStr "") "" (strcat "-" prfStr)) (rd:rand-sfx)))
                  (if (not (tblsearch "BLOCK" bn-new)) (rd:make-block bn-new nType pl d nIns newEC))
                  
                  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                  (entmod ed)
                  (entupd ent)
                  
                  ;; Draw floating EC text aligned with the outer envelope
                  (setq txt-x (if (= newEC 1) (+ pl 30) (- 0 30)))
                  (setq txt-y (/ d 2.0))
                  (setq txt-pt (list (+ (car ip) (* txt-x (cos ang)) (- (* txt-y (sin ang))))  (+ (cadr ip) (* txt-x (sin ang)) (* txt-y (cos ang))) 0.0))
                  (entmake (list '(0 . "TEXT") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                                 (cons 10 txt-pt) '(40 . 100.0) '(41 . 0.8) '(1 . "EC") '(7 . "HVACS") (cons 72 (if (= newEC 1) 0 2)) (cons 73 (if (= newEC 1) 0 2))
                                 (cons 11 txt-pt) (cons 50 ang)))
                  
                  (princ (strcat "\n[ECR] Converted to " (if (= newEC 1) "EC Right" "EC Left") "."))
                )
              )
            )
          )
        )
        (princ "\n[ECR] Object is not RD/D2 duct.")
      )
    )
  )
  (princ)
)

(princ "\n[D2] Round Duct v2.0 (Block-based) loaded | Command: D2 / Change")
(princ)
