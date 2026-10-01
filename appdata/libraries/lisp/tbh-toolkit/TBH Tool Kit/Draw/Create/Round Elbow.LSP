;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Round Elbow.LSP
;;; Module      : Draw\Create
;;; Command     : E2
;;; Description : Draws round duct elbows.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Specify duct diameter.
;;; 3. Specify center point and radius of elbow bend.
;;; TBH-HEADER-END
;;; =============================================================================
;;; ===================================================
(vl-load-com)

(vl-load-com)

;; ─── GLOBALS ────────────────────────────────────────
(if (not (boundp '*RD:Type*))   (setq *RD:Type*   "SA"))
(if (not (boundp '*RD:Insul*))  (setq *RD:Insul*  0))
(if (not (boundp '*RD:D*))      (setq *RD:D*      300.0))
(if (not (boundp '*E2:Ang*))    (setq *E2:Ang*    90.0))
(if (not (boundp '*E2:Dir*))    (setq *E2:Dir*    "Right"))

;; ─── HELPER ─────────────────────────────────────────
(defun e2:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos 2))))
  (append lst (list str)))

(defun e2:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun e2:lo (tp) (cdr (assoc tp '(("SA" . "Hvacduct-sa")("RA" . "Hvacduct-ra")("EA" . "Hvacduct-ea")("OA" . "Hvacduct-oa")("TA" . "Hvacduct-ta")))))
(defun e2:ls (tp) (strcat (e2:lo tp) "-shading"))
(defun e2:lc (tp) (strcat (e2:lo tp) "-Center"))

(defun e2:init (tp / ad lays l-insul c-lay)
  (setq ad (vla-get-activedocument (vlax-get-acad-object)))
  (setq lays (vla-get-layers ad))
  (foreach ln (list (e2:lo tp) (e2:ls tp) (e2:lc tp) "Hvacduct-Text" "Hvacduct-Insul" "Hvacins")
    (if (not (tblsearch "LAYER" ln))
      (vl-catch-all-apply 'vla-add (list lays ln))))
  
  (setq l-insul (vl-catch-all-apply 'vla-Item (list lays "Hvacduct-Insul")))
  (if (not (vl-catch-all-error-p l-insul)) (vl-catch-all-apply 'vla-put-color (list l-insul 118)))
  
  (setq c-lay (vl-catch-all-apply 'vla-Item (list lays (e2:lc tp))))
  (if (not (vl-catch-all-error-p c-lay))
    (progn
     (vl-catch-all-apply 'vla-put-color (list c-lay 1))
     (vl-catch-all-apply 'vla-put-linetype (list c-lay "VSDD"))
    )
  )
  
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 100.0 0.8 0.0 "n" "n" "n"))))

(defun e2:get-insul (idx)
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

(defun e2:add-hatch-to-block (bname lay pat scl angDeg tp_h pts bulges color bottom / ad blks bdef hobj flatPts sPts pline i loop success extDict sortTable objs)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq blks (vla-get-Blocks ad))
  (setq bdef (vl-catch-all-apply 'vla-Item (list blks bname)))
  (if (not (vl-catch-all-error-p bdef))
    (progn
      (setq hobj (vl-catch-all-apply 'vla-AddHatch (list bdef tp_h pat :vlax-false)))
      (if (not (vl-catch-all-error-p hobj))
        (progn
          (vl-catch-all-apply 'vla-put-Layer (list hobj lay))
          (vl-catch-all-apply 'vla-put-Color (list hobj color))
          (vl-catch-all-apply 'vla-put-PatternScale (list hobj scl))
          (vl-catch-all-apply 'vla-put-PatternAngle (list hobj (* (/ angDeg 180.0) pi)))
          (setq flatPts '())
          (foreach p pts (setq flatPts (append flatPts (list (car p) (cadr p)))))
          (setq sPts (vlax-make-safearray vlax-vbDouble (cons 0 (1- (length flatPts)))))
          (vlax-safearray-fill sPts flatPts)
          (setq pline (vla-AddLightWeightPolyline bdef sPts))
          (vla-put-Closed pline :vlax-true)
          (setq i 0)
          (foreach b bulges
             (vla-SetBulge pline i b)
             (setq i (1+ i))
          )
          (setq loop (vlax-make-safearray vlax-vbObject '(0 . 0)))
          (vlax-safearray-put-element loop 0 pline)
          (if (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-AppendOuterLoop (list hobj loop))))
            (progn (vl-catch-all-apply 'vla-Evaluate (list hobj)) (setq success T)))
          (vl-catch-all-apply 'vla-Delete (list pline))
          
          (if bottom
            (progn
              (setq extDict (vl-catch-all-apply 'vla-GetExtensionDictionary (list bdef)))
              (if (not (vl-catch-all-error-p extDict))
                (progn
                  (setq sortTable (vl-catch-all-apply 'vla-GetObject (list extDict "ACAD_SORTENTS")))
                  (if (vl-catch-all-error-p sortTable)
                    (setq sortTable (vl-catch-all-apply 'vla-AddObject (list extDict "ACAD_SORTENTS" "AcDbSortentsTable")))
                  )
                  (if (not (vl-catch-all-error-p sortTable))
                    (progn
                      (setq objs (vlax-make-safearray vlax-vbObject '(0 . 0)))
                      (vlax-safearray-put-element objs 0 hobj)
                      (vl-catch-all-apply 'vla-MoveToBottom (list sortTable objs))
                    )
                  )
                )
              )
            )
          )
        ))))
  success)

(defun e2:enmake-pline (lay pts bulges closed color ltype / lst i)
  (setq lst (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) (cons 62 color) (cons 6 ltype) '(100 . "AcDbPolyline")
                 (cons 90 (length pts)) (cons 70 (if closed 1 0)) '(43 . 0.0)))
  (setq i 0)
  (while (< i (length pts))
    (setq lst (append lst (list (cons 10 (nth i pts)))))
    (if (and bulges (nth i bulges))
      (setq lst (append lst (list (cons 42 (nth i bulges))))))
    (setq i (1+ i)))
  (entmake lst))

(defun e2:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa))) (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

(defun e2:make-block (bname tp d R Ang Dir insIdx / idata prf thk pat scl patAng tp_h mode lo ls lc A_rad Ro Ri Rc Ext P1 P1a P2a P2 P3 P3a P4a P4 B1 B2 pts bulges Pc1 Pc1a Pc2a Pc2 u_vec2 v_vec2 txtX txtY C_y ptIns1 ptIns1a ptIns2 ptIns2a ptIns3 ptIns3a ptIns4 ptIns4a)
  (setq idata (e2:get-insul insIdx))
  (setq prf (car idata) thk (nth 1 idata) pat (nth 2 idata) scl (nth 3 idata) patAng (nth 4 idata) tp_h (nth 5 idata) mode (nth 6 idata))
  (setq lo (e2:lo tp) ls (e2:ls tp) lc (e2:lc tp))
  (setq A_rad (* Ang (/ pi 180.0)))
  (setq Ro (+ R d) Ri R Rc (+ R (/ d 2.0)) Ext 50.0)
  
  (if (= Dir "Right")
    (progn
      (setq C_y (- 0.0 Rc))
      (setq P1 (list 0.0 (- 0.0 (/ d 2.0))) P4 (list 0.0 (/ d 2.0)))
      (setq P1a (list Ext (- 0.0 (/ d 2.0))) P4a (list Ext (/ d 2.0)))
      
      (setq P2a (list (+ Ext (* Ri (sin A_rad))) (+ C_y (* Ri (cos A_rad)))))
      (setq P3a (list (+ Ext (* Ro (sin A_rad))) (+ C_y (* Ro (cos A_rad)))))
      
      (setq u_vec2 (list (cos A_rad) (- (sin A_rad))) v_vec2 (list (sin A_rad) (cos A_rad)))
      (setq P2 (list (+ (car P2a) (* Ext (car u_vec2))) (+ (cadr P2a) (* Ext (cadr u_vec2)))))
      (setq P3 (list (+ (car P3a) (* Ext (car u_vec2))) (+ (cadr P3a) (* Ext (cadr u_vec2)))))
      
      (setq B1 (- (/ (sin (/ A_rad 4.0)) (cos (/ A_rad 4.0)))))
      (setq B2 (- B1))
      (setq pts (list P1 P1a P2a P2 P3 P3a P4a P4) bulges (list 0.0 B1 0.0 0.0 0.0 B2 0.0 0.0))
      
      ;; Angle Text Position (Mid of arc)
      (setq txtX (+ Ext (* Rc (sin (/ A_rad 2.0)))) txtY (+ C_y (* Rc (cos (/ A_rad 2.0)))))
      
      ;; Centerline Points
      (setq Pc1 '(0.0 0.0) Pc1a (list Ext 0.0))
      (setq Pc2a (list (+ Ext (* Rc (sin A_rad))) (+ C_y (* Rc (cos A_rad)))))
      (setq Pc2  (list (+ (car Pc2a) (* Ext (car u_vec2))) (+ (cadr Pc2a) (* Ext (cadr u_vec2)))))
    )
    (progn ;; Left turn
      (setq C_y Rc)
      (setq P1 (list 0.0 (/ d 2.0)) P4 (list 0.0 (- 0.0 (/ d 2.0))))
      (setq P1a (list Ext (/ d 2.0)) P4a (list Ext (- 0.0 (/ d 2.0))))
      
      (setq P2a (list (+ Ext (* Ri (sin A_rad))) (+ C_y (* (- 0.0 Ri) (cos A_rad)))))
      (setq P3a (list (+ Ext (* Ro (sin A_rad))) (+ C_y (* (- 0.0 Ro) (cos A_rad)))))
      
      (setq u_vec2 (list (cos A_rad) (sin A_rad)) v_vec2 (list (- (sin A_rad)) (cos A_rad)))
      (setq P2 (list (+ (car P2a) (* Ext (car u_vec2))) (+ (cadr P2a) (* Ext (cadr u_vec2)))))
      (setq P3 (list (+ (car P3a) (* Ext (car u_vec2))) (+ (cadr P3a) (* Ext (cadr u_vec2)))))
      
      (setq B1 (/ (sin (/ A_rad 4.0)) (cos (/ A_rad 4.0))))
      (setq B2 (- B1))
      (setq pts (list P1 P1a P2a P2 P3 P3a P4a P4) bulges (list 0.0 B1 0.0 0.0 0.0 B2 0.0 0.0))
      
      ;; Angle Text Position (Mid of arc)
      (setq txtX (+ Ext (* Rc (sin (/ A_rad 2.0)))) txtY (+ C_y (* (- 0.0 Rc) (cos (/ A_rad 2.0)))))
      
      ;; Centerline Points
      (setq Pc1 '(0.0 0.0) Pc1a (list Ext 0.0))
      (setq Pc2a (list (+ Ext (* Rc (sin A_rad))) (+ C_y (* (- 0.0 Rc) (cos A_rad)))))
      (setq Pc2  (list (+ (car Pc2a) (* Ext (car u_vec2))) (+ (cadr Pc2a) (* Ext (cadr u_vec2)))))
    )
  )
  
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  
  ;; Outline Pline
  (e2:enmake-pline lo pts bulges t 256 "ByLayer")
  
  ;; Centerline Pline
  (e2:enmake-pline lc (list Pc1 Pc1a Pc2a Pc2) (list 0.0 B1 0.0) nil 256 "ByLayer")
  
  ;; Insulation Curves
  (if (> mode 0)
    (progn
      (if (= mode 1) ;; Internal (thk subtracted from Ro, added to Ri)
        (if (= Dir "Right")
          (progn
            (setq ptIns1 (list 0.0 (+ (- 0.0 (/ d 2.0)) thk))       ptIns1a (list Ext (+ (- 0.0 (/ d 2.0)) thk)))
            (setq ptIns2a (list (+ Ext (* (+ Ri thk) (sin A_rad))) (+ C_y (* (+ Ri thk) (cos A_rad)))))
            (setq ptIns2  (list (+ (car ptIns2a) (* Ext (car u_vec2))) (+ (cadr ptIns2a) (* Ext (cadr u_vec2)))))
            (setq ptIns3 (list 0.0 (- (/ d 2.0) thk))               ptIns3a (list Ext (- (/ d 2.0) thk)))
            (setq ptIns4a (list (+ Ext (* (- Ro thk) (sin A_rad))) (+ C_y (* (- Ro thk) (cos A_rad)))))
            (setq ptIns4  (list (+ (car ptIns4a) (* Ext (car u_vec2))) (+ (cadr ptIns4a) (* Ext (cadr u_vec2)))))
            (e2:enmake-pline "Hvacins" (list ptIns1 ptIns1a ptIns2a ptIns2) (list 0.0 B1 0.0) nil 256 "Ins")
            (e2:enmake-pline "Hvacins" (list ptIns3 ptIns3a ptIns4a ptIns4) (list 0.0 B1 0.0) nil 256 "Ins")
          )
          (progn ;; Left Turn
            (setq ptIns1 (list 0.0 (- (/ d 2.0) thk))               ptIns1a (list Ext (- (/ d 2.0) thk)))
            (setq ptIns2a (list (+ Ext (* (+ Ri thk) (sin A_rad))) (+ C_y (* (- 0.0 (+ Ri thk)) (cos A_rad)))))
            (setq ptIns2  (list (+ (car ptIns2a) (* Ext (car u_vec2))) (+ (cadr ptIns2a) (* Ext (cadr u_vec2)))))
            (setq ptIns3 (list 0.0 (+ (- 0.0 (/ d 2.0)) thk))       ptIns3a (list Ext (+ (- 0.0 (/ d 2.0)) thk)))
            (setq ptIns4a (list (+ Ext (* (- Ro thk) (sin A_rad))) (+ C_y (* (- 0.0 (- Ro thk)) (cos A_rad)))))
            (setq ptIns4  (list (+ (car ptIns4a) (* Ext (car u_vec2))) (+ (cadr ptIns4a) (* Ext (cadr u_vec2)))))
            (e2:enmake-pline "Hvacins" (list ptIns1 ptIns1a ptIns2a ptIns2) (list 0.0 B1 0.0) nil 256 "Ins")
            (e2:enmake-pline "Hvacins" (list ptIns3 ptIns3a ptIns4a ptIns4) (list 0.0 B1 0.0) nil 256 "Ins")
          )
        )
      )
      (if (= mode 2) ;; External (thk subtracted from Ri, added to Ro)
        (if (= Dir "Right")
          (progn
            (setq ptIns1 (list 0.0 (- (- 0.0 (/ d 2.0)) thk))       ptIns1a (list Ext (- (- 0.0 (/ d 2.0)) thk)))
            (setq ptIns2a (list (+ Ext (* (- Ri thk) (sin A_rad))) (+ C_y (* (- Ri thk) (cos A_rad)))))
            (setq ptIns2  (list (+ (car ptIns2a) (* Ext (car u_vec2))) (+ (cadr ptIns2a) (* Ext (cadr u_vec2)))))
            (setq ptIns3 (list 0.0 (+ (/ d 2.0) thk))               ptIns3a (list Ext (+ (/ d 2.0) thk)))
            (setq ptIns4a (list (+ Ext (* (+ Ro thk) (sin A_rad))) (+ C_y (* (+ Ro thk) (cos A_rad)))))
            (setq ptIns4  (list (+ (car ptIns4a) (* Ext (car u_vec2))) (+ (cadr ptIns4a) (* Ext (cadr u_vec2)))))
            (e2:enmake-pline "Hvacins" (list ptIns1 ptIns1a ptIns2a ptIns2) (list 0.0 B1 0.0) nil 256 "Ins")
            (e2:enmake-pline "Hvacins" (list ptIns3 ptIns3a ptIns4a ptIns4) (list 0.0 B1 0.0) nil 256 "Ins")
          )
          (progn ;; Left Turn
            (setq ptIns1 (list 0.0 (+ (/ d 2.0) thk))               ptIns1a (list Ext (+ (/ d 2.0) thk)))
            (setq ptIns2a (list (+ Ext (* (- Ri thk) (sin A_rad))) (+ C_y (* (- 0.0 (- Ri thk)) (cos A_rad)))))
            (setq ptIns2  (list (+ (car ptIns2a) (* Ext (car u_vec2))) (+ (cadr ptIns2a) (* Ext (cadr u_vec2)))))
            (setq ptIns3 (list 0.0 (- (- 0.0 (/ d 2.0)) thk))       ptIns3a (list Ext (- (- 0.0 (/ d 2.0)) thk)))
            (setq ptIns4a (list (+ Ext (* (+ Ro thk) (sin A_rad))) (+ C_y (* (- 0.0 (+ Ro thk)) (cos A_rad)))))
            (setq ptIns4  (list (+ (car ptIns4a) (* Ext (car u_vec2))) (+ (cadr ptIns4a) (* Ext (cadr u_vec2)))))
            (e2:enmake-pline "Hvacins" (list ptIns1 ptIns1a ptIns2a ptIns2) (list 0.0 B1 0.0) nil 256 "Ins")
            (e2:enmake-pline "Hvacins" (list ptIns3 ptIns3a ptIns4a ptIns4) (list 0.0 B1 0.0) nil 256 "Ins")
          )
        )
      )
    )
  )
  
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))
  
  ;; Add Insulation Pattern FIRST, move to bottom
  (if (> mode 0)
    (e2:add-hatch-to-block bname "Hvacduct-Insul" pat scl patAng tp_h pts bulges 256 T))
    
  ;; Add Solid Shading LAST, move to bottom (so it goes UNDER insulation)
  (e2:add-hatch-to-block bname ls "SOLID" 1.0 0.0 0 pts bulges 256 T)
)

;; Extract diameter from RDv2 round duct block name
;; Example: RDv2-SA-1500L-D300-EXT25 -> returns 300.0
(defun e2:extract-diameter (block-name / parts d-token)
  (if (and block-name (wcmatch block-name "RDv2-*"))
    (progn
      (setq parts (e2:split block-name "-"))
      (if (>= (length parts) 4)
        (progn
          (setq d-token (nth 3 parts))
          (if (wcmatch d-token "D*")
            (atof (substr d-token 2))
            nil))
        nil))
    nil))

;; Extract system type from RDv2 block name
;; Example: RDv2-SA-1500L-D300-EXT25 -> returns "SA"
;; End-capped names (RDv2-SA_ECR-...) are normalized to the base system.
(defun e2:extract-system (block-name / parts sys)
  (if (and block-name (wcmatch block-name "RDv2-*"))
    (progn
      (setq parts (e2:split block-name "-"))
      (if (>= (length parts) 2)
        (progn
          (setq sys (nth 1 parts))
          (if (wcmatch (strcase sys) "*_ECR*")
            (setq sys (vl-string-subst "" "_ECR" sys)))
          (if (wcmatch (strcase sys) "*_ECL*")
            (setq sys (vl-string-subst "" "_ECL" sys)))
          sys)
        nil))
    nil))

;; Extract length from RDv2 block name
;; Example: RDv2-SA-1500L-D300 -> returns 1500.0
(defun e2:extract-length (block-name / parts len-token)
  (if (and block-name (wcmatch block-name "RDv2-*"))
    (progn
      (setq parts (e2:split block-name "-"))
      (if (>= (length parts) 3)
        (progn
          (setq len-token (nth 2 parts))
          (if (wcmatch len-token "*L")
            ;; Remove trailing "L" from token like "1500L"
            (atof (substr len-token 1 (- (strlen len-token) 1)))
            nil))
        nil))
    nil))

;; Extract insulation from RDv2 block name and return index
;; Example: RDv2-SA-1500L-D300-INT50 -> returns 2 (INT50)
;; Example: RDv2-SA-1500L-D300 -> returns 0 (Bare)
(defun e2:extract-insulation (block-name / parts insul-str insul-map)
  (setq insul-map '(("INT25" . 1) ("INT50" . 2) ("INT75" . 3) ("INT100" . 4) ("EXT25" . 5) ("EXT50" . 6) ("EXT75" . 7)))
  
  (if (and block-name (wcmatch block-name "RDv2-*"))
    (progn
      (setq parts (e2:split block-name "-"))
      (if (>= (length parts) 5)
        (progn
          (setq insul-str (nth 4 parts))
          (if (assoc insul-str insul-map)
            (cdr (assoc insul-str insul-map))
            0)  ; Default to Bare if not found
        )
        0)  ; No insulation suffix = Bare
    )
    nil))

;; Extract rotation/angle from RDv2 block (for alignment)
(defun e2:extract-duct-rotation (ent-data / rot-code)
  (setq rot-code (assoc 50 ent-data))
  (if rot-code
    (* (cdr rot-code) (/ 180.0 pi))  ; Convert radians to degrees
    0.0))

;; Calculate duct endpoint from insertion point + length + rotation
;; Returns: endpoint as list (x y)
(defun e2:get-duct-endpoint (duct-insertion duct-length duct-rotation / rad dx dy)
  (if (and duct-insertion duct-length duct-rotation)
    (progn
      (setq rad duct-rotation)  ;; duct-rotation already in radians from entity 50-code
      (setq dx (* duct-length (cos rad)))
      (setq dy (* duct-length (sin rad)))
      (list (+ (car duct-insertion) dx) (+ (cadr duct-insertion) dy))
    )
    nil))

;; Get insertion point of duct block
(defun e2:get-duct-insertion-point (ent-data / pt-code)
  (setq pt-code (assoc 10 ent-data))
  (if pt-code
    (cdr pt-code)
    nil))

(defun e2:load-dts (/ fp)
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

(e2:load-dts)

(defun c:E2 (/ pt1 D R Ang Dir bn nPrf ref A_rad Rc txtX txtY txtStr wpt ent ed dn i duct-ss mirror-confirmed preview-ref bn-preview extracted-sys extracted-ins confirm-pt duct-ent duct-ed duct-base-rot elbow-rot duct-start duct-end duct-len d-start d-end conn-side rnd)
  (dts:ensure-defaults)
  (dts:sync-shape "ROUND")
  (if (not (boundp '*RD:Type*))   (setq *RD:Type*   "SA"))
  (if (not (boundp '*RD:Insul*))  (setq *RD:Insul*  0))
  (if (not (boundp '*RD:D*))      (setq *RD:D*      300.0))
  (if (not (boundp '*E2:Ang*))    (setq *E2:Ang*    90.0))
  (if (not (boundp '*E2:Dir*))    (setq *E2:Dir*    "Right"))

  ;; Direct workflow - go straight to picking point
  (princ "\n[E2] Pick start point on Round Duct to auto-detect system, insulation & diameter")
  (setq pt1 (getpoint "\nStart Point for Round Elbow: "))
  (if pt1
    (princ (strcat "\n[DEBUG] pt1 picked: " (rtos (car pt1) 2 0) "," (rtos (cadr pt1) 2 0))))
  
  (if pt1
    (progn
      ;; Try to auto-detect system, insulation & diameter from nearby RDv2 block (within 100mm radius)
      (princ "\n[DEBUG] Searching for RDv2 block within 100mm...")
      (setq D nil)
      (setq duct-ent nil)
      (setq duct-ss (ssget "C" 
                           (list (- (car pt1) 100.0) (- (cadr pt1) 100.0) 0.0)
                           (list (+ (car pt1) 100.0) (+ (cadr pt1) 100.0) 0.0)
                           '((0 . "INSERT") (2 . "RDv2-*"))))
      (if duct-ss
        (progn
          (princ (strcat "\n[DEBUG] Found " (itoa (sslength duct-ss)) " RDv2 block(s)"))
          (setq duct-ent (ssname duct-ss 0))
          (setq duct-ed (entget duct-ent))
          (setq dn (cdr (assoc 2 duct-ed)))
          (princ (strcat "\n[DEBUG] Block name: " dn))
          
          ;; Extract all parameters from RDv2 block
          (setq D (e2:extract-diameter dn))
          (setq extracted-sys (e2:extract-system dn))
          (setq extracted-ins (e2:extract-insulation dn))
          (princ (strcat "\n[DEBUG] Extracted - Diameter: " (if D (rtos D 2 0) "?") " | System: " extracted-sys " | Insul index: " (if extracted-ins (itoa extracted-ins) "?")))
          
          (if D
            (progn
              (setq *RD:Type* extracted-sys)
              (setq *RD:Insul* extracted-ins)
              (setq *RD:D* D)
              (princ (strcat "\n[Auto-detect] System: " *RD:Type* " | Insul: " (itoa *RD:Insul*) " | Diameter: " (rtos D 2 0) "mm"))
            )
          )
        )
        (princ "\n[DEBUG] No RDv2 block found near pick point")
      )
      
      ;; If no auto-detect, manual input
      (if (null D)
        (progn
          (initget 6)
          (setq D (getreal (strcat "\nDiameter D <" (rtos *RD:D* 2 0) ">: ")))
          (if D (setq *RD:D* D) (setq D *RD:D*))
      
      (if (null pt1)
        (progn
          (princ "\n[Error] No start point captured. Exiting.")
          (setq pt1 nil)
        )
      )
        )
        (setq D *RD:D*)
      )
      
      (initget 6)
      (setq R (getreal (strcat "\nSmall Radius (Inner) <" (rtos (/ D 2.0) 2 0) ">: ")))
      (if (not R) (setq R (/ D 2.0)))
      (princ (strcat "\n[DEBUG] Radius input: " (rtos R 2 0)))
      
      (initget 6)
      (setq Ang (getreal (strcat "\nElbow Angle <" (rtos *E2:Ang* 2 1) ">: ")))
      (if Ang (setq *E2:Ang* Ang) (setq Ang *E2:Ang*))
      (princ (strcat "\n[DEBUG] Angle input: " (rtos Ang 2 1)))
      
      ;; Direction from current state/toggle. Rotation follows duct orientation.
      ;; Rotation is decided by which duct end user picks:
      ;; - Right end => same as duct rotation
      ;; - Left end  => duct rotation + 180 deg
      ;; Space toggle only flips bend side (Dir), not insertion rotation.
      (setq Dir *E2:Dir*)
      (setq duct-base-rot 0.0)
      (setq conn-side "RightEnd")
      (if (and duct-ent duct-ed)
        (progn
          (setq duct-base-rot (cdr (assoc 50 duct-ed)))
          (if (not duct-base-rot) (setq duct-base-rot 0.0))

          (setq duct-start (e2:get-duct-insertion-point duct-ed))
          (setq duct-len (e2:extract-length dn))
          (if (and duct-start duct-len)
            (progn
              (setq duct-end (e2:get-duct-endpoint duct-start duct-len duct-base-rot))
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
      
      ;; Direction setting with SPACE mirror toggle + preview
      (setq mirror-confirmed nil)
      (setq preview-ref nil)
      (setq rnd (e2:rand-sfx))
      
      ;; Create initial preview at user-picked point
      (e2:init *RD:Type*)
      (setq nPrf (car (e2:get-insul *RD:Insul*)))
      (setq bn-preview (strcat "E2v2-" *RD:Type* "-D" (rtos D 2 0) "-R" (rtos R 2 0) "-A" (rtos Ang 2 1) "-" Dir (if (= nPrf "") "" (strcat "-" nPrf)) rnd))
      (princ (strcat "\n[DEBUG] Preview block name: " bn-preview))
      (princ (strcat "\n[DEBUG] Preview placement point: " (rtos (car pt1) 2 0) "," (rtos (cadr pt1) 2 0)))
      (princ (strcat "\n[DEBUG] Preview rotation(rad): " (rtos elbow-rot 2 4)))
      
      (if (not (tblsearch "BLOCK" bn-preview))
        (e2:make-block bn-preview *RD:Type* D R Ang Dir *RD:Insul*))
      
      (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 (e2:lo *RD:Type*)) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                         (cons 2 bn-preview) (cons 10 pt1) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot) '(70 . 0)))
        (setq preview-ref (entlast))
      )
      
      ;; Interactive loop: ESC toggles, CLICK or ENTER places
      (while (not mirror-confirmed)
        (princ (strcat "\n[Preview] Direction: " Dir " | ESC to toggle, CLICK/ENTER to place: "))
        
        ;; ESC raises an error object, ENTER returns nil, click returns a point.
        (setq confirm-pt (vl-catch-all-apply 'getpoint (list "\nClick to place: ")))
        
        (if (vl-catch-all-error-p confirm-pt)
          (progn
            ;; ESC pressed - toggle direction and refresh preview
            (setq Dir (if (= Dir "Right") "Left" "Right"))
            (princ (strcat "\n[DEBUG] Direction toggled to: " Dir))
            
            ;; Delete old preview
            (if preview-ref (vl-catch-all-apply 'entdel (list preview-ref)))
            
            ;; Create new preview with toggled direction
            (setq bn-preview (strcat "E2v2-" *RD:Type* "-D" (rtos D 2 0) "-R" (rtos R 2 0) "-A" (rtos Ang 2 1) "-" Dir (if (= nPrf "") "" (strcat "-" nPrf)) rnd))
            (princ (strcat "\n[DEBUG] New preview block: " bn-preview))
            (princ (strcat "\n[DEBUG] New preview rotation(rad): " (rtos elbow-rot 2 4)))
            (if (not (tblsearch "BLOCK" bn-preview))
              (e2:make-block bn-preview *RD:Type* D R Ang Dir *RD:Insul*))
            
            (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 (e2:lo *RD:Type*)) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                               (cons 2 bn-preview) (cons 10 pt1) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot) '(70 . 0)))
              (setq preview-ref (entlast))
            )
          )
          ;; CLICK or ENTER - place
          (setq mirror-confirmed T)
        )
      )
      
      ;; Delete preview and place final block at pt1 (user-picked point)
      (if preview-ref (vl-catch-all-apply 'entdel (list preview-ref)))
      
      (setq *E2:Dir* Dir)
      
      ;; Create final block
      (setq nPrf (car (e2:get-insul *RD:Insul*)))
      (setq bn (strcat "E2v2-" *RD:Type* "-D" (rtos D 2 0) "-R" (rtos R 2 0) "-A" (rtos Ang 2 1) "-" Dir (if (= nPrf "") "" (strcat "-" nPrf)) rnd))
      (princ (strcat "\n[DEBUG] Final block name: " bn))
      (princ (strcat "\n[DEBUG] Final placement - Type: " *RD:Type* " | Direction: " Dir " | Insul: " (itoa *RD:Insul*)))
      (princ (strcat "\n[DEBUG] Final point: " (rtos (car pt1) 2 0) "," (rtos (cadr pt1) 2 0)))
      (princ (strcat "\n[DEBUG] Final rotation(rad): " (rtos elbow-rot 2 4)))
      
      (if (not (tblsearch "BLOCK" bn))
        (e2:make-block bn *RD:Type* D R Ang Dir *RD:Insul*))
      
      ;; Insert elbow block at pt1 (user-picked point)
      (if (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 (e2:lo *RD:Type*)) '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbBlockReference")
                         (cons 2 bn) (cons 10 pt1) '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 elbow-rot)))
        (progn
          (setq ref (entlast))
          (princ (strcat "\n[DEBUG] Block inserted successfully"))
          
          ;; Add angle text if not 90 degrees
          (setq A_rad (* Ang (/ pi 180.0)) Rc (+ R (/ D 2.0)))
          (if (= Dir "Right")
            (setq txtX (+ 50.0 (* Rc (sin (/ A_rad 2.0)))) txtY (- (* Rc (cos (/ A_rad 2.0))) Rc))
            (setq txtX (+ 50.0 (* Rc (sin (/ A_rad 2.0)))) txtY (- Rc (* Rc (cos (/ A_rad 2.0)))))
          )
          (setq txtStr (if (equal Ang 90.0 0.1) "" (strcat (rtos Ang 2 0) "%%D")))
          (if (/= txtStr "")
            (progn
              (setq wpt (e2:xf txtX txtY pt1 elbow-rot))
              (entmake (list '(0 . "TEXT") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbText")
                             (list 10 (car wpt) (cadr wpt) 0.0) '(40 . 100.0) '(41 . 0.8) (cons 1 txtStr) '(7 . "HVACS") '(72 . 1) '(73 . 2)
                             (list 11 (car wpt) (cadr wpt) 0.0) (cons 50 elbow-rot)))
            )
          )
          
          (princ (strcat "\n[E2] Placed: " bn))
        )
        (princ "\n[DEBUG] ERROR: Failed to insert block! Check layer or block definition.")
      )
    )
  )
  (princ)
)

(princ "\n[E2] Round Elbow v2.0 | Command: E2 / Change")
(princ)
