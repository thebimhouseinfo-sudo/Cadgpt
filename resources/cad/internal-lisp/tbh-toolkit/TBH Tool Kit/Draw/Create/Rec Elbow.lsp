;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Rec Elbow.lsp
;;; Module      : Draw\Create
;;; Command     : E1
;;; Description : Draws standard rectangular elbows.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Input Dimensions.
;;; 3. Pick insertion and alignment points for standardized radius elbow.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*DT:Type*))   (setq *DT:Type*   "SA"))
(if (not (boundp '*DT:Insul*))  (setq *DT:Insul*  0))
(if (not (boundp '*DT:W*))      (setq *DT:W*      600.0))
(if (not (boundp '*DT:H*))      (setq *DT:H*      400.0))
(if (not (boundp '*E1:Ang*))    (setq *E1:Ang*    90.0))
(if (not (boundp '*E1:Dir*))    (setq *E1:Dir*    "Right"))
(if (not (boundp '*DT:FL*))     (setq *DT:FL*     35.0))
(if (not (boundp '*DT:FT*))     (setq *DT:FT*     35.0))

;; ─── DEPENDENCIES ───────────────────────────────────
(defun e1:load-dts (/ fp)
  (if (not (boundp '*DTS:BaseDir*))
    (progn
      (setq fp (findfile "Duct Type Setting.lsp"))
      (if (and fp (findfile fp)) (load fp)))))

;; ─── HELPERS ────────────────────────────────────────
(defun e1:split (str delim / pos lst)
  (setq lst '()) 
  (while (setq pos (vl-string-search delim str)) 
    (setq lst (append lst (list (substr str 1 pos)))) 
    (setq str (substr str (+ pos (strlen delim) 1)))) 
  (append lst (list str)))

(defun e1:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun e1:norm-type (tp) (strcase (if tp tp "SA")))
(defun e1:lo (tp) (cdr (assoc (e1:norm-type tp) '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra") ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))
(defun e1:ls (tp / lo) (setq lo (e1:lo tp)) (if lo (strcat lo "-shading") "Hvacduct-sa-shading"))
(defun e1:safe-layer (lay) (if (= (type lay) 'STR) lay "Hvacduct-sa"))

(defun e1:init (tp / ad lays l-insul)
  (setq tp (e1:norm-type tp) ad (vla-get-ActiveDocument (vlax-get-acad-object)) lays (vla-get-Layers ad))
  (foreach ln (list (e1:lo tp) (e1:ls tp) "Hvacduct-Text" "Hvacduct-Insul" "Hvacins" "HVACDUCT-FLANGE")
    (if (and ln (not (tblsearch "LAYER" ln))) (vl-catch-all-apply 'vla-Add (list lays ln))))
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) (vl-catch-all-apply 'vla-put-Color (list l-insul 118)))
  (if (not (tblsearch "STYLE" "HVACS")) (vl-catch-all-apply 'command (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))))

(defun e1:get-insul (idx)
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

(defun e1:xf (bx by ip ang / ca sa) (setq ca (cos ang) sa (sin ang)) (list (+ (car ip) (* bx ca) (- (* by sa))) (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

(defun e1:enmake-pline (lay pts bulges closed color ltype / lst i)
  (setq lay (e1:safe-layer lay))
  (setq lst (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) (cons 62 color) (cons 6 ltype) '(100 . "AcDbPolyline") (cons 90 (length pts)) (cons 70 (if closed 1 0)) '(43 . 0.0)))
  (setq i 0) (while (< i (length pts)) (setq lst (append lst (list (cons 10 (nth i pts))))) (if (and bulges (< i (length bulges))) (setq lst (append lst (list (cons 42 (nth i bulges)))))) (setq i (1+ i))) (entmake lst))

(defun e1:draw-flange (lay p1 p2 uvec fl ft / ang vvec)
  (setq lay (e1:safe-layer lay) ang (angle p1 p2) vvec (list (cos ang) (sin ang)))
  (entmake (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 8) '(6 . "ByLayer") '(100 . "AcDbPolyline") '(90 . 6) '(70 . 0) '(43 . 0.0) (cons 10 (list (- (car p1) (* ft (car vvec))) (- (cadr p1) (* ft (cadr vvec))))) (cons 10 p1) (cons 10 (list (- (car p1) (* fl (car uvec))) (- (cadr p1) (* fl (cadr uvec))))) (cons 10 (list (- (car p2) (* fl (car uvec))) (- (cadr p2) (* fl (cadr uvec))))) (cons 10 p2) (cons 10 (list (+ (car p2) (* ft (car vvec))) (+ (cadr p2) (* ft (cadr vvec))))))))

(defun e1:add-hatch-to-block (bname lay pat scl angdeg tp_h pts bulges color bottom / ad blks bdef hobj flat spts pline loop i extdict sorttable objs)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) blks (vla-get-Blocks ad) bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp_h pat :vlax-false 0)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vl-catch-all-apply 'vla-put-Layer (list hobj lay)) (vl-catch-all-apply 'vla-put-Color (list hobj color)) (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl)) (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angdeg 180.0) pi)))
          (setq flat '()) (foreach p pts (setq flat (append flat (list (car p) (cadr p))))) (setq spts (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length flat))))) (vlax-safearray-fill spts flat) (setq pline (vla-AddLightWeightPolyline bdef spts)) (vla-put-Closed pline :vlax-true) (if bulges (progn (setq i 0) (while (< i (length bulges)) (vla-SetBulge pline i (nth i bulges)) (setq i (1+ i))))) (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element loop 0 pline) (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop)) (vl-catch-all-apply 'vla-Evaluate (list hobj)) (vl-catch-all-apply 'vla-Delete (list pline))
          (if bottom (progn (setq extdict (vl-catch-all-apply 'vla-GetExtensionDictionary (list bdef))) (if (not (vl-catch-all-error-p extdict)) (progn (setq sorttable (vl-catch-all-apply 'vla-GetObject (list extdict "ACAD_SORTENTS"))) (if (vl-catch-all-error-p sorttable) (setq sorttable (vl-catch-all-apply 'vla-AddObject (list extdict "ACAD_SORTENTS" "AcDbSortentsTable")))) (if (not (vl-catch-all-error-p sorttable)) (progn (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0))) (vlax-safearray-put-element objs 0 hobj) (vl-catch-all-apply 'vla-MoveToBottom (list sorttable objs)))))))) T)))))

;; ─── BLOCK GENERATION ───────────────────────────────
(defun e1:make-block (bname tp w h r ang dir insidx / idata prf thk pat scl patang tph mode lo ls fl ft arad ro ri rm ext p1 p1a p2a p2 p3 p3a p4a p4 b1 b2 pts bulges u2 v2 ps1 ps2 pe1 pe2 u1 txtx txty ins1 ins1a ins2a ins2 ins3 ins3a ins4a ins4)
  (setq tp (e1:norm-type tp) idata (e1:get-insul insidx) prf (car idata) thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) patang (nth 4 idata) tph (nth 5 idata) mode (nth 6 idata) lo (e1:safe-layer (e1:lo tp)) ls (e1:ls tp) fl *DT:FL* ft *DT:FT* arad (* ang (/ pi 180.0)) ro (+ r w) ri r rm (+ r (/ w 2.0)) ext 50.0)
  (if (= dir "Right")
    (progn (setq p1 '(0.0 0.0) p4 (list 0.0 (- w)) p1a (list ext 0.0) p4a (list ext (- w)) p2a (list (+ ext (* ro (sin arad))) (- (* ro (cos arad)) ro)) p3a (list (+ ext (* ri (sin arad))) (- (* ri (cos arad)) ro)) u2 (list (cos arad) (- (sin arad))) v2 (list (sin arad) (cos arad)) p2 (list (+ (car p2a) (* ext (car u2))) (+ (cadr p2a) (* ext (cadr u2)))) p3 (list (+ (car p3a) (* ext (car u2))) (+ (cadr p3a) (* ext (cadr u2)))) b1 (- (/ (sin (/ arad 4.0)) (cos (/ arad 4.0)))) b2 (- b1) pts (list p1 p1a p2a p2 p3 p3a p4a p4) bulges (list 0.0 b1 0.0 0.0 0.0 b2 0.0 0.0) ps1 p1 ps2 p4 u1 '(-1.0 0.0) pe1 p2 pe2 p3 txtx (+ ext (* rm (sin (/ arad 2.0)))) txty (- (* rm (cos (/ arad 2.0))) ro)))
    (progn (setq p1 '(0.0 0.0) p4 (list 0.0 (- w)) p1a (list ext 0.0) p4a (list ext (- w)) p2a (list (+ ext (* ri (sin arad))) (- r (* ri (cos arad)))) p3a (list (+ ext (* ro (sin arad))) (- r (* ro (cos arad)))) u2 (list (cos arad) (sin arad)) v2 (list (- (sin arad)) (cos arad)) p2 (list (+ (car p2a) (* ext (car u2))) (+ (cadr p2a) (* ext (cadr u2)))) p3 (list (+ (car p3a) (* ext (car u2))) (+ (cadr p3a) (* ext (cadr u2)))) b1 (/ (sin (/ arad 4.0)) (cos (/ arad 4.0))) b2 (- b1) pts (list p1 p1a p2a p2 p3 p3a p4a p4) bulges (list 0.0 b1 0.0 0.0 0.0 b2 0.0 0.0) ps1 p1 ps2 p4 u1 '(-1.0 0.0) pe1 p2 pe2 p3 txtx (+ ext (* rm (sin (/ arad 2.0)))) txty (- r (* rm (cos (/ arad 2.0)))))))
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  (e1:enmake-pline lo pts bulges T 256 "ByLayer")
  (e1:draw-flange lo ps1 ps2 u1 fl ft)
  (e1:draw-flange lo pe1 pe2 u2 fl ft)
  (if (> mode 0)
    (progn
     (if (= mode 1)
      (if (= dir "Right")
       (progn (setq ins1 (list 0.0 (+ (- w) thk)) ins1a (list ext (+ (- w) thk)) ins2a (list (+ ext (* (+ ri thk) (sin arad))) (- (* (+ ri thk) (cos arad)) ro)) ins2 (list (+ (car ins2a) (* ext (car u2))) (+ (cadr ins2a) (* ext (cadr u2)))) ins3 (list 0.0 (- thk)) ins3a (list ext (- thk)) ins4a (list (+ ext (* (- ro thk) (sin arad))) (- (* (- ro thk) (cos arad)) ro)) ins4 (list (+ (car ins4a) (* ext (car u2))) (+ (cadr ins4a) (* ext (cadr u2))))))
       (progn (setq ins1 (list 0.0 (- thk)) ins1a (list ext (- thk)) ins2a (list (+ ext (* (+ ri thk) (sin arad))) (- r (* (+ ri thk) (cos arad)))) ins2 (list (+ (car ins2a) (* ext (car u2))) (+ (cadr ins2a) (* ext (cadr u2)))) ins3 (list 0.0 (+ (- w) thk)) ins3a (list ext (+ (- w) thk)) ins4a (list (+ ext (* (- ro thk) (sin arad))) (- r (* (- ro thk) (cos arad)))) ins4 (list (+ (car ins4a) (* ext (car u2))) (+ (cadr ins4a) (* ext (cadr u2)))))))
      (if (= dir "Right")
       (progn (setq ins1 (list 0.0 (- 0.0 w thk)) ins1a (list ext (- 0.0 w thk)) ins2a (list (+ ext (* (- ri thk) (sin arad))) (- (* (- ri thk) (cos arad)) ro)) ins2 (list (+ (car ins2a) (* ext (car u2))) (+ (cadr ins2a) (* ext (cadr u2)))) ins3 (list 0.0 thk) ins3a (list ext thk) ins4a (list (+ ext (* (+ ro thk) (sin arad))) (- (* (+ ro thk) (cos arad)) ro)) ins4 (list (+ (car ins4a) (* ext (car u2))) (+ (cadr ins4a) (* ext (cadr u2))))))
       (progn (setq ins1 (list 0.0 thk) ins1a (list ext thk) ins2a (list (+ ext (* (- ri thk) (sin arad))) (- r (* (- ri thk) (cos arad)))) ins2 (list (+ (car ins2a) (* ext (car u2))) (+ (cadr ins2a) (* ext (cadr u2)))) ins3 (list 0.0 (- 0.0 w thk)) ins3a (list ext (- 0.0 w thk)) ins4a (list (+ ext (* (+ ro thk) (sin arad))) (- r (* (+ ro thk) (cos arad)))) ins4 (list (+ (car ins4a) (* ext (car u2))) (+ (cadr ins4a) (* ext (cadr u2))))))))
     (e1:enmake-pline "Hvacins" (list ins1 ins1a ins2a ins2) (list 0.0 b1 0.0 0.0) nil 256 "Ins")
     (e1:enmake-pline "Hvacins" (list ins3 ins3a ins4a ins4) (list 0.0 b1 0.0 0.0) nil 256 "Ins")))
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockBegin")))
  (if (> mode 0) (e1:add-hatch-to-block bname "Hvacduct-Insul" pat scl patang tph pts bulges 256 T))
  (e1:add-hatch-to-block bname ls "SOLID" 1.0 0.0 0 pts bulges 256 T)
  T)

;; ─── MAIN COMMAND ───────────────────────────────────
;; Parse DTv9 block name and return system type (SA/RA/EA/OA/TA)
(defun e1:extract-system (block-name / parts sys p)
  (if (and block-name (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e1:split block-name "-"))
      (if (>= (length parts) 2)
        (progn
          (setq sys (nth 1 parts))
          (setq p (vl-string-search "_" sys))
          (if p (substr sys 1 p) sys))
        nil))
    nil))

;; Parse DTv9 block name and return (length width height)
(defun e1:extract-dims (block-name / parts dims)
  (if (and block-name (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e1:split block-name "-"))
      (if (>= (length parts) 3)
        (progn
          (setq dims (e1:split (nth 2 parts) "x"))
          (if (= (length dims) 3)
            (list (atof (nth 0 dims)) (atof (nth 1 dims)) (atof (nth 2 dims)))
            nil))
        nil))
    nil))

;; Parse insulation suffix from DTv9 block name, return index 0..7
(defun e1:extract-insulation (block-name / parts insul-str insul-map)
  (setq insul-map '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4) ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  (if (and block-name (wcmatch block-name "DTv9-*"))
    (progn
      (setq parts (e1:split block-name "-"))
      (if (>= (length parts) 4)
        (progn
          (setq insul-str (nth 3 parts))
          (if (assoc insul-str insul-map)
            (cdr (assoc insul-str insul-map))
            0))
        0))
    nil))

(defun e1:get-duct-insertion-point (ent-data / pt-code)
  (setq pt-code (assoc 10 ent-data))
  (if pt-code (cdr pt-code) nil))

(defun e1:get-duct-endpoint (duct-insertion duct-length duct-rotation / dx dy)
  (if (and duct-insertion duct-length duct-rotation)
    (progn
      (setq dx (* duct-length (cos duct-rotation)))
      (setq dy (* duct-length (sin duct-rotation)))
      (list (+ (car duct-insertion) dx) (+ (cadr duct-insertion) dy) 0.0))
    nil))

;; E1 block base is at corner; convert center pick to block insertion point.
(defun e1:center-to-base-point (pt-center w rot / dx dy)
  (setq dx (* (/ w 2.0) (sin rot)))
  (setq dy (* (/ w 2.0) (cos rot)))
  (list (- (car pt-center) dx) (+ (cadr pt-center) dy) 0.0))

(defun c:E1 (/ pt1 w h r ang dir bn nprf ref arad rm txtx txty txtstr wpt
                duct-ss duct-ent duct-ed dn dims extracted-sys extracted-ins
                duct-base-rot duct-start duct-end duct-len d-start d-end conn-side
                elbow-rot preview-ref mirror-confirmed confirm-pt bn-preview preview-ip rnd)
  (e1:load-dts)
  (dts:ensure-defaults)
  (dts:sync-shape "RECT")
  (princ "\n[E1] Pick center point at duct end to auto-detect W/H/System/Insul")
  (setq pt1 (getpoint "\nStart Point for Rect Elbow (center): "))

  (if pt1
    (progn
          (setq w nil h nil)
          (setq duct-ent nil duct-ed nil dn nil)
          (princ (strcat "\n[DEBUG] pt1 picked: " (rtos (car pt1) 2 0) "," (rtos (cadr pt1) 2 0)))
          (princ "\n[DEBUG] Searching for DTv9 block within 100mm...")

          (setq duct-ss (ssget "C"
                               (list (- (car pt1) 100.0) (- (cadr pt1) 100.0) 0.0)
                               (list (+ (car pt1) 100.0) (+ (cadr pt1) 100.0) 0.0)
                               '((0 . "INSERT") (2 . "DTv9-*"))))

          (if duct-ss
            (progn
              (setq duct-ent (ssname duct-ss 0))
              (setq duct-ed (entget duct-ent))
              (setq dn (cdr (assoc 2 duct-ed)))
              (princ (strcat "\n[DEBUG] Found DT block: " dn))

              (setq dims (e1:extract-dims dn))
              (setq extracted-sys (e1:extract-system dn))
              (setq extracted-ins (e1:extract-insulation dn))

              (if dims
                (progn
                  (setq duct-len (nth 0 dims))
                  (setq w (nth 1 dims))
                  (setq h (nth 2 dims))
                  (setq *DT:W* w)
                  (setq *DT:H* h)
                  (if extracted-sys (setq *DT:Type* extracted-sys))
                  (if extracted-ins (setq *DT:Insul* extracted-ins))
                  (princ (strcat "\n[Auto-detect] System: " *DT:Type* " | Insul: " (itoa *DT:Insul*) " | W: " (rtos w 2 0) " | H: " (rtos h 2 0)))
                )
              )
            )
            (princ "\n[DEBUG] No DTv9 block found near pick point")
          )

          ;; Manual fallback if no auto-detect
          (if (null w)
            (progn
              (initget 6)
              (setq w (getreal (strcat "\nWidth W <" (rtos *DT:W* 2 0) ">: ")))
              (if w (setq *DT:W* w) (setq w *DT:W*))))

          (if (null h)
            (progn
              (initget 6)
              (setq h (getreal (strcat "\nHeight H <" (rtos *DT:H* 2 0) ">: ")))
              (if h (setq *DT:H* h) (setq h *DT:H*))))

          (initget 6)
          (setq r (getreal (strcat "\nSmall Radius (Inner) <" (rtos (/ w 2.0) 2 0) ">: ")))
          (if (null r) (setq r (/ w 2.0)))
          (princ (strcat "\n[DEBUG] Radius input: " (rtos r 2 0)))

          (initget 6)
          (setq ang (getreal (strcat "\nElbow Angle <" (rtos *E1:Ang* 2 1) ">: ")))
          (if ang (setq *E1:Ang* ang) (setq ang *E1:Ang*))
          (princ (strcat "\n[DEBUG] Angle input: " (rtos ang 2 1)))

          ;; Same logic as E2: choose insertion rotation by picked duct end.
          (setq dir *E1:Dir*)
          (setq duct-base-rot 0.0)
          (setq conn-side "RightEnd")
          (if (and duct-ent duct-ed)
            (progn
              (setq duct-base-rot (cdr (assoc 50 duct-ed)))
              (if (not duct-base-rot) (setq duct-base-rot 0.0))
              (setq duct-start (e1:get-duct-insertion-point duct-ed))
              (if (and duct-start duct-len)
                (progn
                  (setq duct-end (e1:get-duct-endpoint duct-start duct-len duct-base-rot))
                  (setq d-start (distance pt1 duct-start))
                  (setq d-end (distance pt1 duct-end))
                  (if (<= d-start d-end)
                    (setq conn-side "LeftEnd")
                    (setq conn-side "RightEnd"))
                  (princ (strcat "\n[DEBUG] End detect: dStart=" (rtos d-start 2 0) " dEnd=" (rtos d-end 2 0) " => " conn-side))
                )
              )
            )
          )

          (setq elbow-rot (if (= conn-side "LeftEnd") (+ duct-base-rot pi) duct-base-rot))
          (princ (strcat "\n[DEBUG] Base rotation(rad): " (rtos elbow-rot 2 4)))

          (setq mirror-confirmed nil)
          (setq preview-ref nil)
          (setq rnd (e1:rand-sfx))
          (setq nprf (car (e1:get-insul *DT:Insul*)))

          ;; Initial preview
          (setq bn-preview (strcat "E1v10-" *DT:Type* "-" (rtos w 2 0) "x" (rtos h 2 0) "-R" (rtos r 2 0) "-A" (rtos ang 2 1) "-" dir (if (= nprf "") "" (strcat "-" nprf)) rnd))
          (setq preview-ip (e1:center-to-base-point pt1 w elbow-rot))
          (princ (strcat "\n[DEBUG] Preview block: " bn-preview))
          (princ (strcat "\n[DEBUG] Preview center: " (rtos (car pt1) 2 0) "," (rtos (cadr pt1) 2 0)))

          (if (not (tblsearch "BLOCK" bn-preview))
            (e1:make-block bn-preview *DT:Type* w h r ang dir *DT:Insul*))

          (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity")
                             (cons 8 (e1:safe-layer (e1:lo *DT:Type*))) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                             (cons 2 bn-preview) (cons 10 preview-ip) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot) '(70 . 0)))
            (setq preview-ref (entlast)))

          ;; ESC toggle + CLICK confirm like E2
          (while (not mirror-confirmed)
            (princ (strcat "\n[Preview] Direction: " dir " | Press ESC to toggle, CLICK to confirm: "))
            (setq confirm-pt (getpoint "\nClick to place: "))
            (if confirm-pt
              (setq mirror-confirmed T)
              (progn
                (setq dir (if (= dir "Right") "Left" "Right"))
                (princ (strcat "\n[DEBUG] Direction toggled to: " dir))
                (if preview-ref (vl-catch-all-apply 'entdel (list preview-ref)))

                (setq bn-preview (strcat "E1v10-" *DT:Type* "-" (rtos w 2 0) "x" (rtos h 2 0) "-R" (rtos r 2 0) "-A" (rtos ang 2 1) "-" dir (if (= nprf "") "" (strcat "-" nprf)) rnd))
                (setq preview-ip (e1:center-to-base-point pt1 w elbow-rot))
                (if (not (tblsearch "BLOCK" bn-preview))
                  (e1:make-block bn-preview *DT:Type* w h r ang dir *DT:Insul*))

                (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity")
                                   (cons 8 (e1:safe-layer (e1:lo *DT:Type*))) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                                   (cons 2 bn-preview) (cons 10 preview-ip) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot) '(70 . 0)))
                  (setq preview-ref (entlast)))
              )
            )
          )

          ;; Final insert
          (if preview-ref (vl-catch-all-apply 'entdel (list preview-ref)))
          (setq *E1:Dir* dir)
          (e1:init *DT:Type*)
          (setq bn (strcat "E1v10-" *DT:Type* "-" (rtos w 2 0) "x" (rtos h 2 0) "-R" (rtos r 2 0) "-A" (rtos ang 2 1) "-" dir (if (= nprf "") "" (strcat "-" nprf)) rnd))
          (setq preview-ip (e1:center-to-base-point pt1 w elbow-rot))

          (if (not (tblsearch "BLOCK" bn))
            (e1:make-block bn *DT:Type* w h r ang dir *DT:Insul*))

          (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity")
                             (cons 8 (e1:safe-layer (e1:lo *DT:Type*))) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                             (cons 2 bn) (cons 10 preview-ip) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot)))
            (progn
              (setq ref (entlast))
              (setq arad (* ang (/ pi 180.0)) rm (+ r (/ w 2.0)))
              (if (= dir "Right")
                (setq txtx (+ 50.0 (* rm (sin (/ arad 2.0)))) txty (- (* rm (cos (/ arad 2.0))) (+ r w)))
                (setq txtx (+ 50.0 (* rm (sin (/ arad 2.0)))) txty (- r (* rm (cos (/ arad 2.0)))))
              )
              (setq txtstr (if (equal ang 90.0 0.1) "" (strcat (rtos ang 2 0) "%%D")))
              (if (/= txtstr "")
                (progn
                  (setq wpt (e1:xf txtx txty pt1 0.0))
                  (entmake (list '(0 . "TEXT") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                                 (list 10 (car wpt) (cadr wpt) 0.0) '(40 . 100.0) '(41 . 0.8) (cons 1 txtstr) '(7 . "HVACS") '(72 . 1) '(73 . 2)
                                 (list 11 (car wpt) (cadr wpt) 0.0) '(50 . 0.0)))
                )
              )
              (princ (strcat "\n[E1] Placed: " bn))
            )
            (princ "\n[E1] Error: Block insertion failed.")
          )
        )
      )
  (princ)
)

(princ "\n[TBH] Rectangular Elbow loaded. Type 'E1' to start.")
(princ)
