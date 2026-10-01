;;; Auto Connect.lsp  -  Command: ACC
;;; Connects two parallel-offset duct ends with an optimized S-bend.
;;; User picks the exact connection points using OSNAP.
(vl-load-com)

;; ─── MATH HELPERS ───────────────────────────────────
(defun acc:tan2 (a) (/ (sin (* 0.5 a)) (max (cos (* 0.5 a)) 1e-9)))
;; ─── MATH HELPERS ───────────────────────────────────
(defun acc:tan2 (a) (/ (sin (* 0.5 a)) (max (cos (* 0.5 a)) 1e-9)))
;; Ls is the straight duct length between elbows. We subtract the elbow extensions.
(defun acc:ls   (dy R a ext) (/ (- dy (* 2.0 R (- 1.0 (cos a))) (* 2.0 ext (sin a))) (max (sin a) 1e-9)))
;; Total parallel footprint includes the extensions
(defun acc:span (R a Ls ext) (+ (* 2.0 R (sin a)) (* (max Ls 0.0) (cos a)) (* 2.0 ext (+ 1.0 (cos a)))))
(defun acc:dot  (vx vy a) (+ (* vx (cos a)) (* vy (sin a))))
(defun acc:perp (vx vy a) (+ (- (* vx (sin a))) (* vy (cos a))))

;; ─── BLOCK PARSER ───────────────────────────────────
(defun acc:find-duct-at (p / ss i ent ed nm data best W H ty ins rot)
  ;; Search for an HVAC duct block within a 50mm box around the picked point
  (setq ss (ssget "_C"
             (list (- (car p) 50) (- (cadr p) 50) 0)
             (list (+ (car p) 50) (+ (cadr p) 50) 0)
             '((0 . "INSERT"))))
  (if ss
    (progn
      (setq i 0 best nil)
      (while (and (< i (sslength ss)) (not best))
        (setq ent (ssname ss i)
              ed  (entget ent)
              nm  (cdr (assoc 2 ed))
              rot (cdr (assoc 50 ed)))
        (setq data (vl-catch-all-apply 'dtc:parse-duct-block-name (list nm)))
        (if (and (not (vl-catch-all-error-p data)) data)
          (progn
            (setq W (nth 3 data)
                  H (if (nth 4 data) (nth 4 data) W)
                  ty (nth 1 data)
                  ins (nth 6 data))
            (if (not (numberp ins)) (setq ins 0.0))
            (if (not rot) (setq rot 0.0))
            (setq best (list W H ty ins rot))))
        (setq i (1+ i)))
      best))
)

;; ─── SOLVER ─────────────────────────────────────────
(defun acc:solve (dPerp dPar R ext / alpha Ls rad L_c X_c rem a)
  (setq alpha nil Ls nil)
  (defun acc:try1 (deg / rad L_c X_c)
    (if (and (not alpha) (< deg 90.5))
      (progn
        (setq rad (/ (* deg pi) 180.0)
              L_c (acc:ls dPerp R rad ext)
              X_c (acc:span R rad L_c ext))
        (if (and (>= L_c -0.01) (<= X_c (+ dPar 1.0)))
          (setq alpha rad Ls (max 0.0 L_c))))))

  ;; P1: Standard angles
  (acc:try1 45.0) (acc:try1 30.0) (acc:try1 60.0)
  
  ;; P2: Round angles
  (if (not alpha) (progn (acc:try1 20.0) (acc:try1 40.0) (acc:try1 50.0) (acc:try1 10.0) (acc:try1 70.0) (acc:try1 80.0)))
  
  ;; P3: X5 angles
  (if (not alpha) (progn (acc:try1 15.0) (acc:try1 25.0) (acc:try1 35.0) (acc:try1 55.0) (acc:try1 65.0) (acc:try1 75.0)))
  
  ;; P4: Odd angles, prefer clean Ls
  (if (not alpha)
    (progn
      (setq a 1.0)
      (while (and (not alpha) (< a 90.0))
        (setq rad (/ (* a pi) 180.0)
              L_c (acc:ls dPerp R rad ext)
              X_c (acc:span R rad L_c ext))
        (if (and (>= L_c -0.01) (<= X_c (+ dPar 1.0)))
          (progn
            (setq rem (rem L_c 50.0))
            (if (or (<= rem 5.0) (>= rem 45.0))
              (setq alpha rad Ls (max 0.0 L_c)))))
        (setq a (+ a 1.0)))))
        
  ;; P5: Fallback
  (if (not alpha)
    (progn
      (setq a 1.0)
      (while (and (not alpha) (< a 90.0))
        (setq rad (/ (* a pi) 180.0)
              L_c (acc:ls dPerp R rad ext)
              X_c (acc:span R rad L_c ext))
        (if (and (>= L_c -0.01) (<= X_c (+ dPar 1.0)))
          (setq alpha rad Ls (max 0.0 L_c)))
        (setq a (+ a 1.0)))))
        
  (if alpha
    (list alpha Ls)
    nil))

;; ─── MAIN COMMAND ────────────────────────────────────
(defun c:ACC (/ p1 p2 info W H ty ins rot D1 Vx Vy dPar dPerp_raw dPerp side defR rIn R ext sol alpha Ls s s_eff D_mid C1 C2 path prf)
  (vl-load-com)

  ;; Fetch the default straight extension for elbows from Duct Path globals
  (setq ext (if (numberp *DP:Ext*) *DP:Ext* 50.0))

  ;; 1. Get exact connection points from user (User should use OSNAP)
  (setq p1 (getpoint "\n[ACC] Pick EXACT center point of FIRST duct face (use OSNAP): "))
  (if (not p1) (exit))
  (setq p1 (list (car p1) (cadr p1) 0.0))

  (setq p2 (getpoint p1 "\n[ACC] Pick EXACT center point of SECOND duct face (use OSNAP): "))
  (if (not p2) (exit))
  (setq p2 (list (car p2) (cadr p2) 0.0))

  ;; 2. Find duct info near p1 or p2
  (setq info (acc:find-duct-at p1))
  (if (not info) (setq info (acc:find-duct-at p2)))
  
  (if (not info)
    (progn
      (princ "\n[ACC] Could not detect duct block at picked points. Aborting.")
      (exit)))
      
  (setq W   (nth 0 info)
        H   (nth 1 info)
        ty  (nth 2 info)
        ins (nth 3 info)
        rot (nth 4 info))

  (princ (strcat "\n[ACC] Detected: " (rtos W 2 0) "x" (rtos H 2 0) " " ty))

  ;; 3. Determine outward direction D1 from p1
  ;; It must be either along 'rot' or 'rot+pi'. Pick the one pointing towards p2.
  (setq d1_a rot
        d1_b (+ rot pi))
  (if (< (distance p2 (polar p1 d1_a 100.0))
         (distance p2 (polar p1 d1_b 100.0)))
    (setq D1 d1_a)
    (setq D1 d1_b))

  ;; 4. Inner elbow radius
  (setq defR (/ W 2.0))
  (initget 6)
  (setq rIn (getreal (strcat "\n[ACC] Inner elbow radius R <" (rtos defR 2 0) ">: ")))
  (if (null rIn) (setq rIn defR))
  (setq R (+ rIn (/ W 2.0)))

  ;; 5. Calculate gap components
  (setq Vx (- (car p2) (car p1))
        Vy (- (cadr p2) (cadr p1))
        dPar      (acc:dot Vx Vy D1)
        dPerp_raw (acc:perp Vx Vy D1))

  ;; side: +1 if p2 is LEFT of D1, -1 if RIGHT
  (setq side  (if (>= dPerp_raw 0.0) 1.0 -1.0)
        dPerp (abs dPerp_raw))

  (princ (strcat "\n[ACC] dPar=" (rtos dPar 2 0) "  dPerp=" (rtos dPerp 2 0) "  R_cl=" (rtos R 2 0)))

  (if (< dPar 0.0)
    (progn
      (princ "\n[ACC] Warning: Second point is behind first point. Try picking in the opposite order.")
      (exit)))

  (if (< dPerp 5.0)
    (progn
      (princ "\n[ACC] Ducts are co-linear (no offset). Generating straight duct.")
      (setq path (list p1 p2))
      (setq alpha 0.0 Ls (distance p1 p2)))
    (progn
      ;; 6. Solve for S-bend, passing 'ext'
      (setq sol (acc:solve dPerp dPar R ext))
      (if (not sol)
        (progn
          (princ "\n[ACC] No valid S-bend geometry fits this gap.")
          (exit)))
      
      (setq alpha (car sol)
            Ls    (cadr sol))
            
      ;; 7. Build corner path incorporating throat extensions
      (setq s     (* R (acc:tan2 alpha))
            s_eff (+ s ext)
            D_mid (+ D1 (* side alpha)))
            
      ;; First elbow starts EXACTLY at p1
      (setq C1 (polar p1 D1 s_eff)
            C2 (polar C1 D_mid (+ Ls (* 2.0 s_eff))))
            
      (setq path (list p1 C1 C2 p2))
    )
  )

  ;; 8. Generate via dp:generate
  (setq *DT:Type* ty *DT:Insul* ins *DT:W* W *DT:H* H)
  (if (dp:sym-exists-p 'dt:init) (dt:init ty))
  (setq prf (if (dp:sym-exists-p 'dt:get-insul) (car (dt:get-insul ins)) ""))
  
  (dp:generate path "Rect" rIn W H 0 ty ins prf)

  (princ (strcat "\n[ACC] Done: " (rtos (/ (* alpha 180.0) pi) 2 1) "deg  Ls=" (rtos Ls 2 0) "mm"))
  (princ))

(princ "\n[ACC] Loaded. Command: ACC")
(princ)
