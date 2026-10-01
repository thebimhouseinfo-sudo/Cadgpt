;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Rec to Round.lsp
;;; Module      : Draw\Create
;;; Command     : R2R
;;; Description : Draws rectangular to round duct transitions.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Enter Rectangular (WxH) and Round (Dia) sizing.
;;; 3. Picks points to draw transitional reducer fitting.
;;; TBH-HEADER-END
;;; =============================================================================
(vl-load-com)

;; --- GLOBALS & DEFAULTS -----------------------------------------------------
(if (not (boundp '*DT:Type*))   (setq *DT:Type*   "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul*  0))
(if (not (boundp '*rr:W1*))     (setq *rr:W1*     600.0))
(if (not (boundp '*rr:H1*))     (setq *rr:H1*     400.0))
(if (not (boundp '*rr:D2*))     (setq *rr:D2*     300.0))
(if (not (boundp '*rr:Debug*))  (setq *rr:Debug*  nil))

;; --- DEPENDENCIES -----------------------------------------------------------
(defun rr:load-deps (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if fp (load fp)))))

;; --- HELPERS ----------------------------------------------------------------
(defun rr:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos (strlen delim) 1))))
  (append lst (list str)))

(defun rr:norm-type (tp)
  (if (= (type tp) 'STR) (strcase tp) "SA"))

(defun rr:lo (tp)
  (cdr (assoc (rr:norm-type tp)
    '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra")
      ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))

(defun rr:ls (tp / lo)
  (setq lo (rr:lo tp))
  (if lo (strcat lo "-shading") "Hvacduct-sa-shading"))

(defun rr:safe-layer (lay)
  (if (= (type lay) 'STR) lay "Hvacduct-sa"))

(defun rr:ensure-ltype (name /)
  (if (and (= (type name) 'STR) (not (tblsearch "LTYPE" name)))
    (progn
      (vl-catch-all-apply 'vl-cmdf (list "_.-LINETYPE" "_Load" name "acad.lin" ""))
      (if (not (tblsearch "LTYPE" name))
        (vl-catch-all-apply 'vl-cmdf (list "_.-LINETYPE" "_Load" name "acadiso.lin" ""))))))

(defun rr:dbg (msg)
  (if *rr:Debug* (princ (strcat "\n[R2R-DBG] " msg))))

(defun rr:resolve-rot (p1 p2 / dx dy)
  (setq dx (- (car p2) (car p1))
        dy (- (cadr p2) (cadr p1)))
  (if (<= (abs dy) 1e-8)
    (if (< dx 0.0) pi 0.0)
    (angle p1 p2)))

(defun rr:norm-ang (a)
  (while (< a 0.0)    (setq a (+ a (* 2.0 pi))))
  (while (>= a (* 2.0 pi)) (setq a (- a (* 2.0 pi))))
  a)

(defun rr:text-style (sty)
  (if (tblsearch "STYLE" sty) sty "Standard"))

(defun rr:text-height () 100.0)

(defun rr:text-width-factor () 0.8)

(defun rr:text-oblique (sty)
  (if (= sty "HVACSI") 0.2618 0.0))

(defun rr:dxf-put (code val ed)
  (if (assoc code ed)
    (subst (cons code val) (assoc code ed) ed)
    (append ed (list (cons code val)))))

(defun rr:update-text-world (ent pt ang / ed)
  (if (and ent pt)
    (progn
      (setq ed (entget ent))
      (setq ed (rr:dxf-put 10 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (rr:dxf-put 11 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (rr:dxf-put 50 ang ed))
      (entmod ed)
      (entupd ent))))

(defun rr:bring-to-front (ent)
  (if (and ent (entget ent))
    (vl-catch-all-apply 'vl-cmdf (list "_.DRAWORDER" ent "" "_Front"))))

(defun rr:make-text-preview (txt sty pt txtAng just / ent obl)
  (setq sty (rr:text-style sty)
        obl (rr:text-oblique sty))
  (setq ent
    (entmakex
      (list '(0 . "TEXT") '(8 . "Hvacduct-Text")
            (cons 10 pt) (cons 40 (rr:text-height)) (cons 41 (rr:text-width-factor))
            (cons 1 txt) (cons 7 sty) (cons 72 just) '(73 . 2)
            (cons 11 pt) (cons 50 txtAng) (cons 51 obl))))
  (if ent (entupd ent))
  (rr:bring-to-front ent)
  ent)

(defun rr:place-text-preview (ent msg pt ang / ev done key quick-angles quick-idx)
  (rr:update-text-world ent pt ang)
  (setq quick-angles (list 0.0 (/ pi 6.0) (/ pi 4.0) (/ pi 3.0) (/ pi 2.0))
        quick-idx 0)
  (prompt (strcat "\n" msg " [Move, ','=CW, '.'=CCW, SPACE=Toggle 0°/30°/45°/60°/90°, Click=Place, ESC=Cancel]: "))
  (setq done nil)
  (while (not done)
    (setq ev (grread T 15 0))
    (cond
      ((= (car ev) 5)
        (setq pt (cadr ev))
        (rr:update-text-world ent pt ang))
      ((= (car ev) 3)
        (setq pt (cadr ev))
        (rr:update-text-world ent pt ang)
        (setq done T))
      ((= (car ev) 2)
        (setq key (cadr ev))
        (cond
          ((= key 44)
            (setq ang (rr:norm-ang (- ang (/ pi 36.0))))
            (rr:update-text-world ent pt ang))
          ((= key 46)
            (setq ang (rr:norm-ang (+ ang (/ pi 36.0))))
            (rr:update-text-world ent pt ang))
          ((= key 32)
            (setq quick-idx (rem (1+ quick-idx) 5))
            (setq ang (nth quick-idx quick-angles))
            (rr:update-text-world ent pt ang)
            (prompt (strcat "\n[" (cond ((= quick-idx 0) "0°") ((= quick-idx 1) "30°") ((= quick-idx 2) "45°") ((= quick-idx 3) "60°") (T "90°")) "]")))
          ((= key 27)
            (setq done 'cancel))))))
  (if (eq done 'cancel) nil (list pt ang)))

(defun rr:add-text-tag (txt sty base-pt ang just msg / ghost res obl)
  (setq ghost (rr:make-text-preview txt sty base-pt ang just))
  (setq res (rr:place-text-preview ghost msg base-pt ang))
  (if ghost (entdel ghost))
  (if res
    (progn
      (setq base-pt (car res)
            ang     (cadr res)
            sty     (rr:text-style sty)
            obl     (rr:text-oblique sty))
      (entmake
        (list '(0 . "TEXT") '(8 . "Hvacduct-Text")
              (cons 10 (list (car base-pt) (cadr base-pt) 0.0))
              (cons 40 (rr:text-height)) (cons 41 (rr:text-width-factor)) (cons 1 txt)
              (cons 7 sty) (cons 72 just) '(73 . 2)
              (cons 11 (list (car base-pt) (cadr base-pt) 0.0))
              (cons 50 ang) (cons 51 obl)))
      res)))

(defun rr:type-tag (w1 d2 oy / top1 top2 bot1 bot2 tol top-flat bot-flat)
  ;; ET/ET  : symmetric about PS-PE axis (local oy = 0)
  ;; SL/ET  : one side straight (top or bottom 4 points collinear)
  ;; UNEQ   : all other cases
  (setq tol 1e-6
        top1 (/ w1 2.0)
        bot1 (- (/ w1 2.0))
        top2 (+ oy (/ d2 2.0))
        bot2 (- oy (/ d2 2.0))
        top-flat (equal top1 top2 tol)
        bot-flat (equal bot1 bot2 tol))
  (cond
    ((equal oy 0.0 tol) "ET/ET")
    ((or top-flat bot-flat) "SL/ET")
    (T "UNEQ")))

;; --- INIT -------------------------------------------------------------------
(defun rr:init (tp / ad lays l-insul)
  (setq tp   (rr:norm-type tp)
        ad   (vla-get-ActiveDocument (vlax-get-acad-object))
        lays (vla-get-Layers ad))
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))
  (if (not (tblsearch "STYLE" "HVACSI"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACSI" "Arial Narrow|b0|i1|c0|p34" 100.0 0.8 0.0 "n" "n" "n")))
  (foreach ln (list (rr:lo tp) (rr:ls tp)
                    "Hvacduct-Text" "Hvacduct-Insul" "Hvacins" "HVACDUCT-FLANGE")
    (if (and ln (not (tblsearch "LAYER" ln)))
      (vl-catch-all-apply 'vla-Add (list lays ln))))
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul))
    (vl-catch-all-apply 'vla-put-Color (list l-insul 118)))
  (rr:ensure-ltype "VSDD")
  (rr:ensure-ltype "Ins"))

(defun rr:get-insul (idx)
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

;; --- DTv9 BLOCK PARSING -----------------------------------------------------
;;  Format:  DTv9-{Sys}-{L}x{W}x{H}[-InsPrefix]

(defun rr:extract-system (bn / parts)
  (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 2) (nth 1 parts) nil))
    nil))

(defun rr:extract-width (bn / parts dims)
  (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 3)
        (progn
          (setq dims (rr:split (nth 2 parts) "x"))
          (if (>= (length dims) 2) (atof (nth 1 dims)) nil))
        nil))
    nil))

(defun rr:extract-height (bn / parts dims)
  (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 3)
        (progn
          (setq dims (rr:split (nth 2 parts) "x"))
          (if (>= (length dims) 3) (atof (nth 2 dims)) nil))
        nil))
    nil))

(defun rr:extract-length (bn / parts dims)
  (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 3)
        (progn
          (setq dims (rr:split (nth 2 parts) "x"))
          (if (>= (length dims) 1) (atof (nth 0 dims)) nil))
        nil))
    nil))

(defun rr:extract-insulation (bn / parts insStr insMap)
  (setq insMap '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4)
                 ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  (if (and (= (type bn) 'STR) (wcmatch bn "DTv9-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq insStr (nth 3 parts))
          (if (assoc insStr insMap) (cdr (assoc insStr insMap)) 0))
        0))
    0))

;; --- RDv2 BLOCK PARSING -----------------------------------------------------
;;  Format:  RDv2-{Sys}-{L}L-D{Diameter}[-InsPrefix]
;;  Example: RDv2-SA-2000L-D300-INT25

(defun rr:extract-rd-system (bn / parts)
  (if (and (= (type bn) 'STR) (wcmatch (strcase bn) "RDV2-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (if (>= (length parts) 2) (nth 1 parts) nil))
    nil))

(defun rr:extract-rd-diameter (bn / parts i tok up result)
  ;; Returns diameter as real from "D{n}" token, e.g. "D300" -> 300.0
  (if (and (= (type bn) 'STR) (wcmatch (strcase bn) "RDV2-*"))
    (progn
      (setq parts  (rr:split bn "-")
            i      0
            result nil)
      (while (< i (length parts))
        (setq tok (nth i parts)
              up  (if (= (type tok) 'STR) (strcase tok) ""))
        (if (and (> (strlen up) 1)
                 (= (substr up 1 1) "D")
                 (wcmatch up "D#*"))
          (progn
            (setq result (atof (substr up 2)))
            (setq i (length parts)))
          (setq i (1+ i))))
      result)
    nil))

(defun rr:extract-rd-length (bn / parts tok result)
  ;; Returns duct length from "{n}L" token, e.g. "2000L" -> 2000.0
  (if (and (= (type bn) 'STR) (wcmatch (strcase bn) "RDV2-*"))
    (progn
      (setq parts  (rr:split bn "-")
            result nil)
      (foreach tok parts
        (if (and (> (strlen tok) 1)
                 (= (strcase (substr tok (strlen tok) 1)) "L")
                 (> (atof (substr tok 1 (1- (strlen tok)))) 0.0))
          (setq result (atof (substr tok 1 (1- (strlen tok)))))))
      result)
    nil))

(defun rr:extract-rd-insulation (bn / parts tok up insMap found)
  (setq insMap '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4)
                 ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  (if (and (= (type bn) 'STR) (wcmatch (strcase bn) "RDV2-*"))
    (progn
      (setq parts (rr:split bn "-"))
      (setq found 0)
      (foreach tok parts
        (setq up (if (= (type tok) 'STR) (strcase tok) ""))
        (if (assoc up insMap)
          (setq found (cdr (assoc up insMap)))))
      found)
    0))

(defun rr:flexconn-near (pt / ss i ent ed bn lay atts att tag val pos w h extIns intIns typ)
  ;; FlexConn face sizes are stored as SIZE=(duct+5) and hidden EXTINSU/INTINSU.
  (setq ss (ssget "C"
                  (list (- (car pt) 150.0) (- (cadr pt) 150.0) 0.0)
                  (list (+ (car pt) 150.0) (+ (cadr pt) 150.0) 0.0)
                  '((0 . "INSERT")))
        i 0)
  (while (and ss (< i (sslength ss)) (null w))
    (setq ent (ssname ss i)
          ed (entget ent)
          bn (strcase (vl-princ-to-string (cdr (assoc 2 ed))))
          lay (strcase (vl-princ-to-string (cdr (assoc 8 ed)))))
    (if (or (wcmatch bn "FLEXCONN*") (= lay "HVAC-FLEXCONN"))
      (progn
        (setq atts (vl-catch-all-apply 'vlax-invoke
                                       (list (vlax-ename->vla-object ent) 'GetAttributes))
              extIns 0.0
              intIns 0.0)
        (if (not (vl-catch-all-error-p atts))
          (foreach att atts
            (setq tag (strcase (vla-get-TagString att))
                  val (vla-get-TextString att))
            (cond
              ((= tag "SIZE")
               (setq pos (vl-string-search "X" (strcase val)))
               (if pos
                 (setq w (- (atof (substr val 1 pos)) 5.0)
                       h (- (atof (substr val (+ pos 2))) 5.0))))
              ((= tag "EXTINSU") (setq extIns (atof val)))
              ((= tag "INTINSU") (setq intIns (atof val))))))
        (if (and w h (> w 0.0) (> h 0.0))
          (setq w (+ w (* 2.0 intIns))
                h (+ h (* 2.0 intIns))
                typ (if (and (> intIns 0.0) (equal intIns 25.0 0.01)) 1
                      (if (and (> intIns 0.0) (equal intIns 50.0 0.01)) 2
                        (if (and (> intIns 0.0) (equal intIns 75.0 0.01)) 3
                          (if (and (> intIns 0.0) (equal intIns 100.0 0.01)) 4
                            (if (equal extIns 25.0 0.01) 5
                              (if (equal extIns 50.0 0.01) 6
                                (if (equal extIns 75.0 0.01) 7 0))))))))))
      (setq w nil))
    (setq i (1+ i)))
  (if (and w h)
    (list (if (and (boundp '*DT:Type*) (= (type *DT:Type*) 'STR)) *DT:Type* "SA")
          w h typ nil)
    nil))

;; --- BLOCK SCANNING ---------------------------------------------------------
(defun rr:scan-rect-near (pt / ss ent ed bn sys w h ins ang dlen ip ep d1 d2 face-rot)
  ;; Scan for DTv9 block within 150mm of pt.
  ;; Returns (list sys w h ins face-rot) or nil.
  (setq ss (ssget "C"
                  (list (- (car pt) 150.0) (- (cadr pt) 150.0) 0.0)
                  (list (+ (car pt) 150.0) (+ (cadr pt) 150.0) 0.0)
                  '((0 . "INSERT") (2 . "DTv9-*"))))
  (if ss
    (progn
      (setq ent (ssname ss 0)
            ed  (entget ent)
            bn  (cdr (assoc 2 ed))
            ang (cond ((assoc 50 ed) (cdr (assoc 50 ed))) (T 0.0)))
      (if (= (type bn) 'STR)
        (progn
          (setq sys  (rr:extract-system bn)
                w    (rr:extract-width  bn)
                h    (rr:extract-height bn)
                ins  (rr:extract-insulation bn)
                dlen (rr:extract-length bn)
                ip   (cdr (assoc 10 ed)))
          (if (and ip dlen)
            (setq ep (list (+ (car ip) (* dlen (cos ang)))
                           (+ (cadr ip) (* dlen (sin ang)))
                           0.0))
            (setq ep nil))
          (if (and ip ep)
            (progn
              (setq d1       (distance pt ip)
                    d2       (distance pt ep)
                    face-rot (if (<= d1 d2) (+ ang pi) ang)))
            (setq face-rot ang))
          (if (and sys w) (list sys w h ins face-rot) nil))
        nil))
    nil))

(defun rr:scan-round-near (pt / ss ent ed bn sys d ins ang dlen ip ep d1 d2 face-rot)
  ;; Scan for RDv2 block within 150mm of pt.
  ;; Returns (list sys d ins face-rot) or nil.
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
          (setq sys  (rr:extract-rd-system bn)
                d    (rr:extract-rd-diameter bn)
                ins  (rr:extract-rd-insulation bn)
                dlen (rr:extract-rd-length bn)
                ip   (cdr (assoc 10 ed)))
          (if (and ip dlen)
            (setq ep (list (+ (car ip) (* dlen (cos ang)))
                           (+ (cadr ip) (* dlen (sin ang)))
                           0.0))
            (setq ep nil))
          (if (and ip ep)
            (progn
              (setq d1       (distance pt ip)
                    d2       (distance pt ep)
                    face-rot (if (<= d1 d2) (+ ang pi) ang)))
            (setq face-rot ang))
          (if (and sys d) (list sys d ins face-rot) nil))
        nil))
    nil))

;; --- GEOMETRY (local coords) ------------------------------------------------
;;
;;  Origin = PS face centre (0, 0).  Axis = +X.
;;  INSERT at pt-start with rotation rot places block in world coords.
;;
;;  Points (CCW order):
;;    P1  = (0,      +W1/2)        rect start top
;;    P2  = (os,     +W1/2)        rect shoulder top
;;    P3  = (L-os,  +D2/2+oy)     round shoulder top
;;    P4  = (L,     +D2/2+oy)     round end top
;;    P7  = (L,     -D2/2+oy)     round end bottom
;;    P8  = (L-os,  -D2/2+oy)     round shoulder bottom
;;    P9  = (os,     -W1/2)        rect shoulder bottom
;;    P10 = (0,      -W1/2)        rect start bottom
;;
;;  PE  = (L, oy, 0)  --- round end face centre
;;  Red Ins polyline P2 -> PE -> P9

(defun rr:body-pts (w1 d2 l oy / os top1 bot1 top2 bot2)
  (setq os   (min 50.0 (/ l 2.0))
        top1 (/ w1 2.0)
        bot1 (- (/ w1 2.0))
        top2 (+ oy (/ d2 2.0))
        bot2 (- oy (/ d2 2.0)))
  (list
    (list 0.0      top1 0.0)    ;; P1
    (list os       top1 0.0)    ;; P2
    (list (- l os) top2 0.0)    ;; P3
    (list l        top2 0.0)    ;; P4
    (list l        bot2 0.0)    ;; P7
    (list (- l os) bot2 0.0)    ;; P8
    (list os       bot1 0.0)    ;; P9
    (list 0.0      bot1 0.0)))  ;; P10

;; --- LOW-LEVEL DRAW HELPERS -------------------------------------------------
(defun rr:enmake-pline (lay pts closed color ltype / lst i)
  (setq lay (rr:safe-layer lay))
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

(defun rr:enmake-line (lay p1 p2 color ltype)
  (entmake
    (list '(0 . "LINE") '(100 . "AcDbEntity")
          (cons 8 (rr:safe-layer lay)) (cons 62 color) (cons 6 ltype)
          '(100 . "AcDbLine")
          (cons 10 p1) (cons 11 p2))))

(defun rr:draw-flange (p1 p2 uvec fl ft / ang vvec)
  ;; Draw flange bracket at one duct face.
  (setq ang  (angle p1 p2)
        vvec (list (cos ang) (sin ang) 0.0))
  (entmake
    (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity")
          '(8 . "HVACDUCT-FLANGE") '(62 . 8) '(6 . "ByLayer")
          '(100 . "AcDbPolyline") '(90 . 6) '(70 . 0) '(43 . 0.0)
          (cons 10 (list (- (car p1) (* ft (car vvec))) (- (cadr p1) (* ft (cadr vvec))) 0.0))
          (cons 10 p1)
          (cons 10 (list (- (car p1) (* fl (car uvec))) (- (cadr p1) (* fl (cadr uvec))) 0.0))
          (cons 10 (list (- (car p2) (* fl (car uvec))) (- (cadr p2) (* fl (cadr uvec))) 0.0))
          (cons 10 p2)
          (cons 10 (list (+ (car p2) (* ft (car vvec))) (+ (cadr p2) (* ft (cadr vvec))) 0.0)))))

(defun rr:shift-pt-y (pt dy)
  (list (car pt) (+ (cadr pt) dy) (if (caddr pt) (caddr pt) 0.0)))

;; --- HATCH INTO NAMED BLOCK -------------------------------------------------
(defun rr:add-hatch-to-block (bname lay pat scl angdeg tp-h pts color bottom
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

;; --- BLOCK GENERATION -------------------------------------------------------
(defun rr:get-ins-prefix (idx / r)
  (setq r (rr:get-insul idx))
  (if (and (listp r) (= (type (car r)) 'STR)) (car r) ""))

(defun rr:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun rr:block-name (tp w1 h1 d2 l oy insidx end-bare-p / prf)
  (setq prf (rr:get-ins-prefix insidx))
  (strcat "R2Rv1-" (rr:norm-type tp) "-"
          (rtos w1 2 0) "x" (rtos h1 2 0)
          "-D" (rtos d2 2 0)
          "-L" (rtos l 2 0)
          "-OY" (rtos oy 2 0)
          (if end-bare-p "-EB" "")
          (if (= prf "") "" (strcat "-" prf))
          (rr:rand-sfx)))

(defun rr:make-block (bname tp w1 h1 d2 l oy insidx end-bare-p
                      / idata thk pat scl patang tph mode
                        lo ls body hbody w2-face d-s d-e
                        topIns botIns p4 p7 p5 p6
                        p2-pt p9-pt pe-pt fl ft)
  (setq idata   (rr:get-insul insidx)
        thk     (nth 1 idata)
        pat     (nth 2 idata)
        scl     (nth 3 idata)
        patang  (nth 4 idata)
        tph     (nth 5 idata)
        mode    (nth 6 idata)
        lo      (rr:safe-layer (rr:lo tp))
        ls      (rr:ls tp)
        ;; Internal ins + bare round end: outer round face = d2 + 2*thk
        w2-face (if (and end-bare-p (= mode 1)) (+ d2 (* 2.0 thk)) d2)
        body    (rr:body-pts w1 w2-face l oy)
        hbody   body)

  ;; Open block definition
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0")
                 '(100 . "AcDbBlockBegin") (cons 2 bname)
                 '(70 . 0) '(10 0.0 0.0 0.0)))

  ;; Outline polyline (closed trapezoid)
  (rr:enmake-pline lo hbody T 256 "ByLayer")

  ;; Flange at RECTANGULAR START end only (P1-P10 side)
  (setq fl (if (boundp '*DT:FL*) *DT:FL* 35.0)
        ft (if (boundp '*DT:FT*) *DT:FT* 35.0))
  (rr:draw-flange (nth 0 body) (nth 7 body) '(-1.0 0.0 0.0) fl ft)

  ;; P2-PE-P9: red Ins polyline (duct centre guide)
  (setq p2-pt (nth 1 body)
        p9-pt (nth 6 body)
        pe-pt (list l oy 0.0))
  (rr:enmake-pline lo (list p2-pt pe-pt p9-pt) nil 1 "Ins")

  ;; Insulation outline lines
  (if (> mode 0)
    (progn
      (setq d-s (if (= mode 1) thk (- thk))
            d-e (if (and end-bare-p (= mode 1)) thk d-s))
      (setq p4 (nth 3 body)
            p7 (nth 4 body)
            p5 (rr:shift-pt-y p4 (- d-e))
            p6 (rr:shift-pt-y p7 d-e))
      (setq topIns
        (list (rr:shift-pt-y (nth 0 body) (- d-s))
              (rr:shift-pt-y (nth 1 body) (- d-s))
              (rr:shift-pt-y (nth 2 body) (- d-s))
              p5))
      (setq botIns
        (list (rr:shift-pt-y (nth 7 body) d-s)
              (rr:shift-pt-y (nth 6 body) d-s)
              (rr:shift-pt-y (nth 5 body) d-s)
              p6))
      (rr:enmake-pline "Hvacins" topIns nil 256 "Ins")
      (rr:enmake-pline "Hvacins" botIns nil 256 "Ins")))

  ;; Close block
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))

  ;; Hatches (insulation below shading)
  (if (> mode 0)
    (rr:add-hatch-to-block bname "Hvacduct-Insul" pat scl patang tph hbody 256 T))
  (rr:add-hatch-to-block bname ls "SOLID" 1.0 0.0 0 hbody 256 T)
  T)

;; --- MAIN COMMAND -----------------------------------------------------------
(defun c:R2R (/ pt-start pt-end
               scan1 scan2
               det-sys det-w1 det-h1 det-ins det-d2 det-ang det-ins2 det-ang2
               w1 h1 d2 l rot bn
               l-auto l-inp dx dy ux uy oy
               end-bare-p ins-ok
               type-tag len-tag tag-ang tag-base type-res)

  (rr:load-deps)
  (vl-catch-all-apply 'dts:ensure-defaults nil)
  (vl-catch-all-apply 'dts:sync-shape (list "RECT"))

  ;; Pick PS -- rectangular duct face centre
  (setq pt-start (getpoint "\n[R2R] Pick PS - centre of rectangular duct face: "))
  (if (null pt-start) (progn (princ "\n[R2R] Cancelled.") (exit)))

  ;; Pick PE -- round duct face centre
  (setq pt-end (getpoint pt-start "\n[R2R] Pick PE - centre of round duct face: "))
  (if (null pt-end) (progn (princ "\n[R2R] Cancelled.") (exit)))

  ;; Auto-detect from nearby duct blocks
  (setq scan1 (or (rr:flexconn-near pt-start) (rr:scan-rect-near pt-start))
        scan2 (rr:scan-round-near pt-end))
  (rr:dbg (strcat "scan1=" (vl-princ-to-string scan1)
                  " scan2=" (vl-princ-to-string scan2)))

  ;; PS: W1 H1 sys ins from DTv9
  (if scan1
    (progn
      (setq det-sys (nth 0 scan1)
            det-w1  (nth 1 scan1)
            det-h1  (nth 2 scan1)
            det-ins (nth 3 scan1)
            det-ang (nth 4 scan1))
      (princ (strcat "\n[R2R] PS: Sys=" det-sys
                     "  W1=" (rtos det-w1 2 0) " H1=" (rtos det-h1 2 0)
                     "  Ins=" (itoa (fix det-ins)))))
    (progn
      (setq det-sys (if (= (type *DT:Type*) 'STR) *DT:Type* "SA")
            det-w1  *rr:W1*
            det-h1  *rr:H1*
            det-ins *DT:Insul*
            det-ang nil)
      (princ "\n[R2R] No DTv9 near PS - using session defaults.")))

  ;; PE: D2 from RDv2. Default D2 = W1.
  (if (and scan2 (nth 1 scan2))
    (progn
      (setq det-d2   (nth 1 scan2)
            det-ins2 (nth 2 scan2)
            det-ang2 (nth 3 scan2))
      (princ (strcat "\n[R2R] PE: D2=" (rtos det-d2 2 0))))
    (progn
      (setq det-d2   (if (and (boundp '*rr:D2*) (> *rr:D2* 0.0)) *rr:D2* det-w1)
            det-ins2 det-ins
            det-ang2 nil)
      (princ (strcat "\n[R2R] No RDv2 near PE - D2=" (rtos det-d2 2 0)))))

  ;; Assign working sizes
  (setq w1      det-w1
        h1      det-h1
        d2      det-d2
        *rr:W1* w1
        *rr:H1* h1
        *rr:D2* d2)

  ;; Compute axis rotation and auto length
  (setq dx (- (car pt-end) (car pt-start))
        dy (- (cadr pt-end) (cadr pt-start)))
  (if det-ang
    (setq rot det-ang)
    (setq rot (rr:resolve-rot pt-start pt-end)))
  (setq rot    (rr:norm-ang rot)
        ux     (cos rot)
        uy     (sin rot)
        l-auto (abs (+ (* dx ux) (* dy uy)))
        oy     (+ (* dx (- uy)) (* dy ux)))
  (rr:dbg (strcat "rot=" (rtos (* (/ 180.0 pi) rot) 2 1)
                  " l-auto=" (rtos l-auto 2 0) " oy=" (rtos oy 2 2)))

  ;; Optional length override
  (initget 6)
  (setq l-inp (getreal (strcat "\n[R2R] Length L <" (rtos l-auto 2 0) ">: ")))
  (if l-inp (setq l l-inp) (setq l l-auto))

  (if (< l 1.0)
    (progn
      (princ "\n[R2R] Error: PS and PE are too close.")
      (exit)))

  ;; Init layers and session globals
  (setq *DT:Type*  det-sys
        *DT:Insul* det-ins)
  (rr:init det-sys)

  ;; Build block and insert
  (setq end-bare-p (and (> det-ins 0) (< det-ins 5) (= det-ins2 0)))
  (setq bn (rr:block-name det-sys w1 h1 d2 l oy det-ins end-bare-p))
  (rr:dbg (strcat "block=" bn))
  (if (not (tblsearch "BLOCK" bn))
    (rr:make-block bn det-sys w1 h1 d2 l oy det-ins end-bare-p))

  (setq ins-ok
    (entmake
      (list '(0 . "INSERT") '(100 . "AcDbEntity")
            (cons 8 (rr:safe-layer (rr:lo det-sys)))
            '(62 . 256) '(6 . "ByLayer")
            '(100 . "AcDbBlockReference")
            (cons 2 bn)
            (cons 10 pt-start)
            '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)
            (cons 50 rot))))

  (if ins-ok
    (progn
      (princ (strcat "\n[R2R] Placed: W" (rtos w1 2 0) "x" (rtos h1 2 0)
                     " -> D" (rtos d2 2 0) "  L=" (rtos l 2 0) "  Sys=" det-sys))
      (setq type-tag (rr:type-tag w1 d2 oy)
            len-tag  (strcat (rtos l 2 0) "L")
            tag-ang  0.0
            tag-base (polar pt-start (angle pt-start pt-end) (/ (max l 200.0) 2.0)))
      (setq type-res
        (rr:add-text-tag type-tag "HVACS" tag-base tag-ang 1 "[R2R] Place TYPE tag"))
      (if type-res
        (rr:add-text-tag len-tag "HVACSI" (car type-res) (cadr type-res) 1 "[R2R] Place LENGTH tag")
        (princ "\n[R2R] TYPE tag skipped.")))
    (princ "\n[R2R] Error: Block insertion failed."))

  (princ))

(princ "\n[TBH] R2R (Rect to Round) loaded.  Type R2R to start.")
(princ)
