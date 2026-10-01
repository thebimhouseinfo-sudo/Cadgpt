;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Boot.lsp
;;; Module      : Draw\Create
;;; Command     : BT, BOOT
;;; Description : Automates the drawing of boot transitions.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Pick insertion point on main duct.
;;; 3. Enter branch dimensions.
;;; 4. Position the boot takeoff.
;;; TBH-HEADER-END
;;; =============================================================================
;;; Boot.lsp v3.7 - Insulation B1-B6-B5: horizontal translate (not perpendicular offset)
(vl-load-com)
(if (not (boundp '*BT:W*)) (setq *BT:W* 600.0))
(if (not (boundp '*BT:REV*)) (setq *BT:REV* "R2"))
(setq BT-TAB 35.0 BT-CONN 50.0 BT-THROAT 150.0 BT-EXT 150.0)

;;; ======= STRING SPLIT =======
(defun bt:split (s d / p r)
  (setq r nil)
  (while (setq p (vl-string-search d s))
    (setq r (append r (list (substr s 1 p)))
          s (substr s (+ p (strlen d) 1))))
  (append r (list s)))

;;; ======= LAYER NAMES =======
(defun bt:lo (tp) (cdr (assoc tp '(("SA" . "Hvacduct-sa") ("RA" . "Hvacduct-ra") ("EA" . "Hvacduct-ea") ("OA" . "Hvacduct-oa") ("TA" . "Hvacduct-ta")))))
(defun bt:ls (tp) (strcat (bt:lo tp) "-shading"))

(defun bt:mk-layer (nm col)
  (if (not (tblsearch "LAYER" nm))
    (entmake (list '(0 . "LAYER") '(100 . "AcDbSymbolTableRecord")
                   '(100 . "AcDbLayerTableRecord") (cons 2 nm)
                   '(70 . 0) (cons 62 (if col col 7)) '(6 . "Continuous")))))

;;; ======= INSULATION DATA (Matching D1) =======
(defun bt:get-insul (idx)
  ;; Format: (Prefix Thick Pattern Scale Angle Type Mode)
  (cond
    ((= idx 0) '("" 0 "SOLID" 1.0 0.0 0 0))
    ((= idx 1) '("INT25"   25 "INS25I"  1.0       0.0  2 1))
    ((= idx 2) '("INT50"   50 "INS50I"  1.0       0.0  2 1))
    ((= idx 3) '("INT75"   75 "INS75I"  40.0      0.0  2 1))
    ((= idx 4) '("INT100" 100 "INS100I" 1.0       45.0 2 1))
    ((= idx 5) '("EXT25"   25 "ANSI31"  43.47     0.0  1 2))
    ((= idx 6) '("EXT50"   50 "ANSI32"  15.0      0.0  1 2))
    ((= idx 7) '("EXT75"   75 "ANSI34"  22.22     0.0  1 2))
    (t         '("" 0 "SOLID" 1.0 0.0 0 0))))

;;; ======= INSULATION PREFIX =======
(defun bt:ins-prefix (idx) (nth 0 (bt:get-insul idx)))

(defun bt:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
    frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
      (substr ms (max 1 (- (strlen ms) 4)))
      (substr frac 1 (min 4 (strlen frac)))))

(defun bt:find-ins-token (parts / p u)
  ;; Find the first valid insulation token when scanning from the tail.
  ;; This keeps detection stable even when random suffix is appended at the end.
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

;;; ======= DETECT DUCT =======
(defun bt:detect (ent / ed bn ps nT di pf ins result len dia)
  (setq ed (entget ent))
  (if (/= (cdr (assoc 0 ed)) "INSERT") nil
    (progn
      (setq bn (cdr (assoc 2 ed)))
      (if (not (or (wcmatch (strcase bn) "DT*")
                   (wcmatch (strcase bn) "RDV2-*-*L-D*"))) nil
        (progn
          (setq ps (bt:split bn "-"))
          (if (< (length ps) 3) nil
            (progn
              (setq nT (nth 1 ps)
                    nT (vl-string-subst "" "_ECR" (vl-string-subst "" "_ECL" nT))
                  pf (bt:find-ins-token ps))
                (if (null pf) (setq pf ""))
              (setq ins (cond ((= pf "INT25") 1)((= pf "INT50") 2)((= pf "INT75") 3)
                              ((= pf "INT100") 4)((= pf "EXT25") 5)((= pf "EXT50") 6)
                              ((= pf "EXT75") 7)(t 0)))
              (if (wcmatch (strcase bn) "DT*")
                (progn
                  (setq di (bt:split (nth 2 ps) "x"))
                  (if (< (length di) 2) nil
                    (setq result (list nT ins (atof (nth 0 di)) (atof (nth 1 di)) "RECT"))))
                (progn
                  (setq len (atof (vl-string-subst "" "L" (nth 2 ps))))
                  (setq dia (atof (vl-string-subst "" "D" (nth 3 ps))))
                  (if (or (<= len 0.0) (<= dia 0.0)) nil
                    (setq result (list nT ins len dia "ROUND")))))
              result)))))))

;;; ======= COORD TRANSFORM =======
(defun bt:xf (lx ly ip ang / c s)
  (setq c (cos ang) s (sin ang))
  (list (+ (car ip) (* lx c) (- (* ly s)))
        (+ (cadr ip) (* lx s) (* ly c)) 0.0))

;;; ======= ENTMAKE HELPERS =======
(defun bt:bline (x1 y1 x2 y2 lay col / em)
  (setq em (list '(0 . "LINE") (cons 8 lay)
                 (cons 10 (list x1 y1 0.0)) (cons 11 (list x2 y2 0.0))))
  (if col (setq em (append em (list (cons 62 col)))))
  (entmake em))

(defun bt:bsolid (p1 p2 p3 lay)
  (entmake (list '(0 . "SOLID") (cons 8 lay)
                 (cons 10 (list (car p1) (cadr p1) 0.0))
                 (cons 11 (list (car p2) (cadr p2) 0.0))
                 (cons 12 (list (car p3) (cadr p3) 0.0))
                 (cons 13 (list (car p3) (cadr p3) 0.0)))))

;;; PATTERN HATCH (VLA Injector - similar to D1)
(defun bt:hatch-insul (bname lay pat scl angDeg pts / ad blks bdef hobj sp pl loop i)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq blks (vla-get-Blocks ad))
  (setq bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef acHatchPatternTypePreDefined pat :vlax-false 0)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vla-put-Layer hobj lay)
          (vla-put-PatternScale hobj scl)
          (vla-put-PatternAngle hobj (* (/ angDeg 180.0) pi))
          (setq sp (vlax-make-safearray vlax-vbDouble (cons 0 (1- (* 2 (length pts))))))
          (setq i 0)
          (foreach p pts 
             (vlax-safearray-put-element sp i (car p))
             (vlax-safearray-put-element sp (1+ i) (cadr p))
             (setq i (+ i 2)))
          (setq pl (vla-AddLightWeightPolyline bdef sp))
          (vla-put-Closed pl :vlax-true)
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0)))
          (vlax-safearray-put-element loop 0 pl)
          (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop))
          (vla-Evaluate hobj)
          (vla-Delete pl)))))
  nil)

;;; ======= CREATE BLOCK =======
(defun bt:make-block (bname nT bw insIdx shp / lo ls t1 c1 th1 e1 total-w 
                      B1 B2 B3 B4 B5 B6 F1 F3 F4 F6 idata mode thk pts p_a p_b sgn)
  (setq lo (bt:lo nT) ls (bt:ls nT)
        t1 BT-TAB c1 BT-CONN th1 BT-THROAT e1 BT-EXT
        total-w (+ bw e1)
        B4 (list 0.0 0.0)
        B5 (list (- total-w) 0.0)
        B6 (list (- bw) th1)   ; (narrow side starts at y=th1)
        B1 (list (- bw) (+ th1 c1))
        B2 (list 0.0 (+ th1 c1))
        B3 (list 0.0 th1))
  
  (entmake (list '(0 . "BLOCK") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  
  ;; 1. Shading (Solid)
  (bt:bsolid B1 B2 B3 ls) (bt:bsolid B1 B3 B6 ls)
  (bt:bsolid B6 B3 B4 ls) (bt:bsolid B6 B4 B5 ls)
  
  ;; 2. Outline
  (setq pts (list B1 B2 B3 B4 B5 B6))
  (foreach i (list 0 1 2 3 4 5)
    (setq p_a (nth i pts) p_b (nth (if (= i 5) 0 (1+ i)) pts))
    (bt:bline (car p_a)(cadr p_a)(car p_b)(cadr p_b) lo nil))

  ;; 3. Flanges (L-shaped) - only for RECT ducts
  (if (= shp "RECT")
    (progn
      (setq F1 (list (- (car B1) 35) (cadr B1))
            F3 (list (car B1) (- (cadr B1) 35))
            F6 (list (+ (car B2) 35) (cadr B2))
            F4 (list (car B2) (- (cadr B2) 35)))
      ;; Left Flange Line
      (bt:bline (car F1)(cadr F1) (car B1)(cadr B1) lo 8) ; F1-F2
      (bt:bline (car B1)(cadr B1) (car F3)(cadr F3) lo 8) ; F2-F3
      ;; Right Flange Line
      (bt:bline (car F6)(cadr F6) (car B2)(cadr B2) lo 8) ; F6-F5
      (bt:bline (car B2)(cadr B2) (car F4)(cadr F4) lo 8) ; F5-F4
      ;; Bottom connecting line (closes flange bracket)
      (bt:bline (car F3)(cadr F3) (car F4)(cadr F4) lo 8) ; F3-F4
    ))


  ;; 4. Insulation Lines - applies to both RECT and ROUND
  (setq idata (bt:get-insul insIdx)
        thk (nth 1 idata) mode (nth 6 idata))
  (if (> mode 0)
    (progn
      ;; sgn: +1 = External (shift left = -X), -1 = Internal (shift right = +X)
      (setq sgn (if (= mode 2) 1.0 -1.0))
      ;; (a) Right edge B2->B4 (x=0): shift right (+thk) ext, left (-thk) int
      (bt:bline (* sgn thk) (cadr B2)
                (* sgn thk) (cadr B4) "Hvacins" 118)
      ;; (b)+(c) Left wall B1->B6->B5: horizontal copy (translate X by -sgn*thk)
      ;;         External: shift left  (-(+1)*thk = -thk)
      ;;         Internal: shift right (-(-1)*thk = +thk)
      (bt:bline (- (car B1) (* sgn thk)) (cadr B1)
                (- (car B6) (* sgn thk)) (cadr B6) "Hvacins" 118)
      (bt:bline (- (car B6) (* sgn thk)) (cadr B6)
                (- (car B5) (* sgn thk)) (cadr B5) "Hvacins" 118)))

  (entmake '((0 . "ENDBLK")))
  
  ;; 5. Insulation Hatch (VLA Pattern) - applies to both RECT and ROUND
  (if (> mode 0)
    (bt:hatch-insul bname "Hvacduct-Insul" (nth 2 idata) (nth 3 idata) (nth 4 idata) pts))
  T)

;;; ======= SAFE INSERT =======
(defun bt:safe-ins (bn ip ang lay col xsc / bef aft)
  (setq bef (entlast))
  (entmake (list '(0 . "INSERT") (cons 8 (if lay lay "0"))
                 (cons 2 bn) (cons 10 ip) (cons 50 ang)
                 (cons 41 (if xsc xsc 1.0)) '(42 . 1.0) '(43 . 1.0)
                 (if col (cons 62 col) '(62 . 256))))
  (setq aft (entlast))
  (if (equal bef aft) nil aft))

;;; ======= SNAP CALC =======
(defun bt:snap (dent cur bw shp / ed ip ad pr dw dh c s dx dy lx ly lxc lyc
                off spT spB spL spR cT cB cL cR dists best rad)
  (setq ed (entget dent) ip (cdr (assoc 10 ed))
        ad (if (assoc 50 ed)(cdr (assoc 50 ed)) 0.0)
        pr (bt:detect dent))
  (if (not pr) nil
    (progn
      (setq dw (nth 2 pr) dh (nth 3 pr)
            c (cos ad) s (sin ad)
            dx (- (car cur)(car ip)) dy (- (cadr cur)(cadr ip))
            lx (+ (* dx c)(* dy s)) ly (- (* dy c)(* dx s)))
      
      (if (= shp "ROUND")
        ;; Round duct: origin at center, only top/bottom faces
        (progn
          (setq rad (/ dh 2.0))
          (setq off (/ (+ bw BT-EXT) 2.0))
          (setq spT (bt:xf (+ lx off) rad ip ad)
                spB (bt:xf (+ lx off) (- rad) ip ad))
          (setq cT (bt:xf (/ dw 2.0) rad ip ad)
                cB (bt:xf (/ dw 2.0) (- rad) ip ad))
          (setq dists (vl-sort
            (list (list (distance cur cT) spT ad)
                  (list (distance cur cB) spB (+ ad pi)))
            '(lambda (a b)(< (car a)(car b)))))
          (setq best (car dists))
          (list (nth 1 best)(nth 2 best)))
        ;; Rectangular duct: origin on outer face
        (progn
          (setq lxc (max 0.0 (min dw lx))
                lyc (max (- dh)(min 0.0 ly)))
          (setq off (/ (+ bw BT-EXT) 2.0))
          (setq spT (bt:xf (+ lxc off) 0.0 ip ad)    spB (bt:xf (+ lxc off) (- dh) ip ad)
                spL (bt:xf 0.0 (+ lyc off) ip ad)    spR (bt:xf dw (+ lyc off) ip ad))
          (setq cT (bt:xf (/ dw 2.0) 0.0 ip ad)      cB (bt:xf (/ dw 2.0)(- dh) ip ad)
                cL (bt:xf 0.0 (/(- dh) 2.0) ip ad)  cR (bt:xf dw (/(- dh) 2.0) ip ad))
          (setq dists (vl-sort
            (list (list (distance cur cT) spT ad)
                  (list (distance cur cB) spB (+ ad pi))
                  (list (distance cur cL) spL (+ ad (* pi 0.5)))
                  (list (distance cur cR) spR (- ad (* pi 0.5))))
            '(lambda (a b)(< (car a)(car b)))))
          (setq best (car dists))
          (list (nth 1 best)(nth 2 best)))))))

;;; ======= INTERACTIVE SNAP =======
(defun bt:interactive (dent bn bw shp / loop en cd vl pt sd sp sa fl pv ok xMid spAdj)
  (setq loop T fl 0 ok nil sp nil sa 0.0 pv nil)
  ;; Axis toggle will pass through center of small duct face: x = -bw/2
  (setq xMid (- (/ bw 2.0)))
  (princ "\n[BT] Move | SPACE=Flip | Click=Place")
  (while loop
    (setq en (grread T 15 0) cd (car en) vl (cadr en))
    (cond
      ((= cd 5)
        (setq pt vl sd (bt:snap dent pt bw shp))
        (if sd (progn
          (setq sp (car sd) sa (cadr sd))
          ;; When toggled (fl=1): offset to mirror across xMid instead of x=0
          (if pv (progn (entdel pv)(setq pv nil)))
          (setq spAdj (if (= fl 1) (bt:xf (* 2.0 xMid) 0.0 sp sa) sp))
          (setq pv (bt:safe-ins bn spAdj sa nil 1 (if (= fl 1) -1.0 1.0))))))
      ((= cd 3)(setq ok T loop nil))
      ((= cd 2)(cond
        ((= vl 32)(setq fl (- 1 fl)) (if pv (progn (entdel pv)(setq pv nil))))
        ((or (= vl 13)(= vl 10))(setq ok T loop nil))
        ((= vl 27)(setq ok nil loop nil))))))
  (if pv (progn (entdel pv)(setq pv nil)))
  (if (and ok sp)(list sp sa fl) nil))

;;; ======= MAIN =======
(defun c:BT (/ ent pr nT ins dw dh shp bw bn lo pf pl sp sa fl ok xMid spAdj)
  (princ "\n=== [BT] BOOT v3.7 ===")
  (setq ok T ent (car (entsel "\n[BT] B1 - Select duct: ")))
  (if (not ent)(progn (princ "\n[BT] Cancelled.")(setq ok nil)))
  (if ok (progn
    (setq pr (bt:detect ent))
    (if (not pr)(progn (princ "\n[BT] Not a DT block.")(setq ok nil)))))
  (if ok (progn
    (setq nT (nth 0 pr) ins (nth 1 pr) dw (nth 2 pr) dh (nth 3 pr))
    (setq shp (if (> (length pr) 4) (nth 4 pr) "RECT"))
    (princ (strcat "\n[BT] " nT " " (rtos dw 2 0) "x" (rtos dh 2 0)))
    (bt:mk-layer (bt:lo nT) 7)
    (bt:mk-layer (bt:ls nT) 7)
    (bt:mk-layer "Hvacduct-Insul" 118)
    (bt:mk-layer "Hvacins" 118)))
  (if ok (progn
    (initget 6)
    (setq bw (getreal (strcat "\n[BT] B2 - Boot W <" (rtos *BT:W* 2 0) ">: ")))
    (if bw (setq *BT:W* bw)(setq bw *BT:W*))))
  (if ok (progn
    (setq lo (bt:lo nT) pf (bt:ins-prefix ins)
          bn (strcat "BOOT-" *BT:REV* "-" nT "-" (rtos bw 2 0)
               (if (= pf "")"" (strcat "-" pf))
               "-" shp
               (bt:rand-sfx)))
    (if (not (tblsearch "BLOCK" bn))
      (bt:make-block bn nT bw ins shp))))
  (if ok (progn
    (setq pl (bt:interactive ent bn bw shp))
    (if pl (progn
      (setq sp (nth 0 pl) sa (nth 1 pl) fl (nth 2 pl))
      (setq xMid (- (/ bw 2.0)))
      (setq spAdj (if (= fl 1) (bt:xf (* 2.0 xMid) 0.0 sp sa) sp))
      (bt:safe-ins bn spAdj sa lo nil (if (= fl 1) -1.0 1.0))
      (princ "\n[BT] Boot placed!"))
      (princ "\n[BT] Cancelled."))))
  (princ))

(defun c:BOOT ()(c:BT))
(princ "\n[BT] Boot v3.7 | BT or BOOT")
(princ)
