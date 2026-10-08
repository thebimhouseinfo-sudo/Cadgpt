;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Modify Duct.lsp
;;; Module      : Draw\Edit
;;; Command     : MD (Modify Duct)
;;; Description : Unified duct modification command.
;;;               Options: 1-Length (change duct length)
;;;                          2-Size (change W/H or D)
;;;                          3-Switch W<->H (swap width and height)
;;;
;;; Supported duct families:
;;;   - Rectangular : DTv9-{TYPE}[_ECR|_ECL]-{PL}x{W}x{H}[-{INS}]-R{sfx}
;;;   - Round       : RDv2-{TYPE}[_ECR|_ECL]-{PL}L-D{D}[-{INS}]-R{sfx}
;;;
;;; Usage:
;;;   1. Type MD and press Enter.
;;;   2. Click on any duct (INSERT entity).
;;;   3. Select option: 1-Length, 2-Size, or 3-Switch W<->H.
;;;   4. Follow prompts to modify.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── DEFAULTS ────────────────────────────────────────────────────────────────
(if (not (boundp '*DT:MaxLen*)) (setq *DT:MaxLen* 1400.0))
(if (not (boundp '*RD:MaxLen*)) (setq *RD:MaxLen* 1500.0))
(if (not (boundp '*DT:FL*))     (setq *DT:FL*     35.0))
(if (not (boundp '*DT:FT*))     (setq *DT:FT*     35.0))
(if (not (boundp '*DT:MARGIN*)) (setq *DT:MARGIN* 50.0))
(if (not (boundp '*RD:MARGIN*)) (setq *RD:MARGIN* 50.0))

;; ─── HELPERS ─────────────────────────────────────────────────────────────────

(defun md:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    (setq str (substr str (+ pos (strlen delim) 1))))
  (append lst (list str)))

(defun md:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun md:find-ins-token (parts / p u out)
  (setq p (reverse parts) out "")
  (while p
    (setq u (strcase (car p)))
    (if (or (wcmatch u "INT*") (wcmatch u "EXT*"))
      (progn (setq out u) (setq p nil))
      (setq p (cdr p))))
  out)

(defun md:ins-token-to-index (tok)
  (cond
    ((= tok "INT25")  1)
    ((= tok "INT50")  2)
    ((= tok "INT75")  3)
    ((= tok "INT100") 4)
    ((= tok "EXT25")  5)
    ((= tok "EXT50")  6)
    ((= tok "EXT75")  7)
    (T 0)))

(defun md:insul-idx-from-prf (prf / p)
  (setq p (strcase prf))
  (cond
    ((= p "INT25")  1)
    ((= p "INT50")  2)
    ((= p "INT75")  3)
    ((= p "INT100") 4)
    ((= p "EXT25")  5)
    ((= p "EXT50")  6)
    ((= p "EXT75")  7)
    (T 0)))

;; ─── ATTRIBUTE HELPERS ───────────────────────────────────────────────────────

(defun md:get-att (ent tag / e ed)
  (setq e (entnext ent))
  (while (and e
              (not (equal (cdr (assoc 0 (entget e))) "SEQEND"))
              (not (equal (strcase (cdr (assoc 2 (entget e)))) (strcase tag))))
    (setq e (entnext e)))
  (if (and e (not (equal (cdr (assoc 0 (entget e))) "SEQEND")))
    (cdr (assoc 1 (entget e)))
    nil))

(defun md:set-att (ent tag val / e ed)
  (setq e (entnext ent))
  (while (and e
              (not (equal (cdr (assoc 0 (entget e))) "SEQEND")))
    (setq ed (entget e))
    (if (equal (strcase (cdr (assoc 2 ed))) (strcase tag))
      (progn
        (setq ed (subst (cons 1 val) (assoc 1 ed) ed))
        (entmod ed)
        (entupd e)))
    (setq e (entnext e))))

(defun md:move-att (ent tag newpt / e ed)
  (setq e (entnext ent))
  (while (and e
              (not (equal (cdr (assoc 0 (entget e))) "SEQEND")))
    (setq ed (entget e))
    (if (equal (strcase (cdr (assoc 2 ed))) (strcase tag))
      (progn
        (setq ed (subst (cons 10 newpt) (assoc 10 ed) ed))
        (setq ed (subst (cons 11 newpt) (assoc 11 ed) ed))
        (entmod ed)
        (entupd e)))
    (setq e (entnext e))))

(defun md:update-attribs (insEnt sizeStr lenStr / e ed tag v)
  (setq e (entnext insEnt))
  (while e
    (setq ed (entget e))
    (cond
      ((= (cdr (assoc 0 ed)) "SEQEND")
        (setq e nil))
      ((= (cdr (assoc 0 ed)) "ATTRIB")
        (setq tag (strcase (cdr (assoc 2 ed))))
        (cond
          ((= tag "SIZE")
            (setq ed (subst (cons 1 sizeStr) (assoc 1 ed) ed))
            (entmod ed))
          ((= tag "LENGTH")
            (setq ed (subst (cons 1 lenStr) (assoc 1 ed) ed))
            (entmod ed)))
        (setq e (entnext e)))
      (T
        (setq e (entnext e)))))
  (entupd insEnt))

(defun md:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa)))
        (+ (cadr ip) (* bx sa) (* by ca))
        0.0))

;; ─── DUCT ATT LAYOUT (MATCH D1 / D2) ─────────────────────────────────────────
;; Recompute canonical tag anchors after edits and preserve any user-adjusted
;; offsets relative to the original anchors. Invisible metadata ATTRIBs are
;; never touched.
(defun md:att-frame (ins / ed ip ang sx sy)
  (setq ed (entget ins)
        ip (cdr (assoc 10 ed))
        ang (cdr (assoc 50 ed))
        sx (cdr (assoc 41 ed))
        sy (cdr (assoc 42 ed)))
  (if (null ang) (setq ang 0.0))
  (if (or (null sx) (equal sx 0.0 1e-12)) (setq sx 1.0))
  (if (or (null sy) (equal sy 0.0 1e-12)) (setq sy 1.0))
  (list ip ang sx sy))

(defun md:att-local (pt ip ang sx sy / dx dy ca sa)
  (setq dx (- (car pt) (car ip))
        dy (- (cadr pt) (cadr ip))
        ca (cos ang) sa (sin ang))
  (list (/ (+ (* dx ca) (* dy sa)) sx)
        (/ (- (* dy ca) (* dx sa)) sy)))

(defun md:att-layout (fam len width frame / ip ang sx sy mg ytop ybot p1 p2 p3 p4 pts tl p rule idx bxS bxL center high low yS yL narrow)
  (setq ip (nth 0 frame) ang (nth 1 frame)
        sx (nth 2 frame) sy (nth 3 frame)
        mg (if (= fam "DT") *DT:MARGIN* *RD:MARGIN*)
        ytop (if (= fam "DT") 0.0 (/ width 2.0))
        ybot (if (= fam "DT") (- width) (- (/ width 2.0)))
        p1 (md:xf 0.0 (* ytop sy) ip ang)
        p2 (md:xf (* len sx) (* ytop sy) ip ang)
        p3 (md:xf (* len sx) (* ybot sy) ip ang)
        p4 (md:xf 0.0 (* ybot sy) ip ang)
        pts (list (list p1 1) (list p2 2) (list p3 3) (list p4 4))
        rule (if (> (abs (cos ang)) 0.174) "H" "V")
        tl (car pts))
  ;; Same top-left / bottommost corner selection as D1 and D2.
  (foreach p (cdr pts)
    (if (if (= rule "H")
          (or (< (caar p) (caar tl))
              (and (equal (caar p) (caar tl) 0.01)
                   (> (cadar p) (cadar tl))))
          (or (< (cadar p) (cadar tl))
              (and (equal (cadar p) (cadar tl) 0.01)
                   (< (caar p) (caar tl)))))
      (setq tl p)))
  (setq idx (cadr tl)
        bxS (if (or (= idx 1) (= idx 4)) mg (- len mg))
        bxL (if (or (= idx 1) (= idx 4)) (- len mg) mg))
  (if (= fam "RD")
    ;; Round duct: both labels on the centerline, even if the duct rotates.
    (list (cons "SIZE" (list bxS 0.0 0 2))
          (cons "LENGTH" (list bxL 0.0 2 2)))
    (progn
      ;; Rectangular duct: D1 switches between centerline and opposite faces.
      (setq center (- (/ width 2.0)) narrow (<= width 250.0))
      (cond
        (narrow (setq high center low center))
        ((<= width 300.0)
         (setq high (+ center 100.0) low (- center 100.0)))
        (T (setq high -50.0 low (+ (- width) 50.0))))
      (if (if (= rule "V")
            (< (car p1) (car p4))
            (> (cadr p1) (cadr p4)))
        (setq yS high yL low)
        (setq yS low yL high))
      (list (cons "SIZE" (list bxS yS 0 (if narrow 2 3)))
            (cons "LENGTH" (list bxL yL 2 (if narrow 2 1)))))))

(defun md:att-point (ed)
  ;; D1/D2 store both DXF 10 and 11; justified labels use alignment point 11.
  (if (assoc 11 ed) (cdr (assoc 11 ed)) (cdr (assoc 10 ed))))

(defun md:att-snapshot (ins fam oldlen oldwidth / frame layout e ed tag spec pt local delta normal out)
  (setq frame (md:att-frame ins)
        layout (md:att-layout fam oldlen oldwidth frame)
        e (entnext ins))
  (while (and e (/= (cdr (assoc 0 (entget e))) "SEQEND"))
    (setq ed (entget e)
          tag (strcase (if (assoc 2 ed) (cdr (assoc 2 ed)) "")))
    (if (and (= (cdr (assoc 0 ed)) "ATTRIB")
             (member tag '("SIZE" "LENGTH"))
             (setq spec (cdr (assoc tag layout)))
             (setq pt (md:att-point ed)))
      (progn
        (setq local (md:att-local pt (nth 0 frame) (nth 1 frame) (nth 2 frame) (nth 3 frame))
              delta (list (- (car local) (car spec))
                          (- (cadr local) (cadr spec)))
              normal (and (assoc 72 ed) (assoc 74 ed)
                          (= (cdr (assoc 72 ed)) (nth 2 spec))
                          (= (cdr (assoc 74 ed)) (nth 3 spec))))
        (setq out (cons (list e tag delta normal) out))))
    (setq e (entnext e)))
  (reverse out))

(defun md:att-reflow (ins snapshot fam newlen newwidth / frame layout row ed spec delta ip ang pt oldpt)
  (setq frame (md:att-frame ins)
        layout (md:att-layout fam newlen newwidth frame)
        ip (nth 0 frame) ang (nth 1 frame))
  (foreach row snapshot
    (setq spec (cdr (assoc (cadr row) layout)))
    (if (and spec (setq ed (entget (car row))))
      (progn
        (setq delta (nth 2 row)
              oldpt (md:att-point ed)
              pt (md:xf (* (nth 2 frame) (+ (car spec) (car delta)))
                        (* (nth 3 frame) (+ (cadr spec) (cadr delta)))
                        ip ang))
        ;; Preserve ATT elevation, visual text rotation and manually changed
        ;; alignment. D1/D2 standard alignment is updated for width thresholds.
        (if (and oldpt (caddr oldpt))
          (setq pt (list (car pt) (cadr pt) (caddr oldpt))))
        (if (assoc 10 ed)
          (setq ed (subst (cons 10 pt) (assoc 10 ed) ed)))
        (if (assoc 11 ed)
          (setq ed (subst (cons 11 pt) (assoc 11 ed) ed)))
        (if (nth 3 row)
          (progn
            (setq ed (subst (cons 72 (nth 2 spec)) (assoc 72 ed) ed))
            (setq ed (subst (cons 74 (nth 3 spec)) (assoc 74 ed) ed))))
        (entmod ed))))
  (entupd ins))

;; ─── PARSE BLOCK NAME ────────────────────────────────────────────────────────

(defun md:parse-block-name (bn / u ps rawTyp typ ecMode pl w h d insTok insIdx)
  (setq u (strcase bn))
  (cond
    ((wcmatch u "DTV9-*")
      (setq ps (md:split bn "-"))
      (if (>= (length ps) 3)
        (progn
          (setq rawTyp (nth 1 ps))
          (setq ecMode 0)
          (if (vl-string-search "_ECR" (strcase rawTyp)) (setq ecMode 1))
          (if (vl-string-search "_ECL" (strcase rawTyp)) (setq ecMode 2))
          (setq typ (vl-string-subst "" "_ECR" (vl-string-subst "" "_ECL" rawTyp)))
          (setq typ (strcase typ))
          (setq insTok (md:find-ins-token ps))
          (setq insIdx (md:ins-token-to-index insTok))
          (setq ps (md:split (nth 2 ps) "x"))
          (if (>= (length ps) 3)
            (progn
              (setq pl (atof (nth 0 ps))
                    w  (atof (nth 1 ps))
                    h  (atof (nth 2 ps)))
              (if (and (> pl 0.0) (> w 0.0) (> h 0.0))
                (list "DT" typ ecMode pl w h nil insTok insIdx)
                nil))
            nil))
        nil))

    ((wcmatch u "RDV2-*")
      (setq ps (md:split bn "-"))
      (if (>= (length ps) 4)
        (progn
          (setq rawTyp (nth 1 ps))
          (setq ecMode 0)
          (if (vl-string-search "_ECR" (strcase rawTyp)) (setq ecMode 1))
          (if (vl-string-search "_ECL" (strcase rawTyp)) (setq ecMode 2))
          (setq typ (vl-string-subst "" "_ECR" (vl-string-subst "" "_ECL" rawTyp)))
          (setq typ (strcase typ))
          (setq insTok (md:find-ins-token ps))
          (setq insIdx (md:ins-token-to-index insTok))
          (setq pl (atof (vl-string-subst "" "L" (strcase (nth 2 ps)))))
          (setq d (atof (vl-string-subst "" "D" (strcase (nth 3 ps)))))
          (if (and (> pl 0.0) (> d 0.0))
            (list "RD" typ ecMode pl nil nil d insTok insIdx)
            nil))
        nil))

    (T nil)))

;; ─── SIZE FUNCTIONS ──────────────────────────────────────────────────────────

(defun md:do-size (ent ed info / fam typ ecMode pl w h d insTok insIdx
                    newW newH newD newBN ecStr prfStr lo newSizeTxt newLenTxt attState)
  (setq fam     (nth 0 info)
        typ     (nth 1 info)
        ecMode  (nth 2 info)
        pl      (nth 3 info)
        w       (nth 4 info)
        h       (nth 5 info)
        d       (nth 6 info)
        insTok  (nth 7 info)
        insIdx  (nth 8 info))

  (cond
    ((= fam "DT")
      (princ (strcat "\n[MD] Rectangular duct | Current: " (itoa (fix w)) "x" (itoa (fix h))
                     " | Type: " typ " | Insul: " insTok
                     " | Length: " (itoa (fix pl))))
      (initget 6)
      (setq newW (getreal (strcat "\nNew Width  W <" (rtos w 2 0) ">: ")))
      (if (null newW) (setq newW w))
      (initget 6)
      (setq newH (getreal (strcat "\nNew Height H <" (rtos h 2 0) ">: ")))
      (if (null newH) (setq newH h))

      (setq ecStr  (cond ((= ecMode 1) "_ECR") ((= ecMode 2) "_ECL") (T ""))
            prfStr (if (= insTok "") "" (strcat "-" insTok))
            newBN  (strcat "DTv9-" typ ecStr "-"
                           (rtos pl 2 0) "x" (rtos newW 2 0) "x" (rtos newH 2 0)
                           prfStr
                           (md:rand-sfx)))

      (if (not (tblsearch "BLOCK" newBN))
        (if (and (boundp 'dt:make-block) (not (null dt:make-block)))
          (dt:make-block newBN typ pl newW newH insIdx ecMode)
          (progn
            (princ "\n[MD] ERROR: dt:make-block not loaded. Load Rectangular_duct.lsp first.")
            (princ) (exit))))

      (setq lo (if (and (boundp 'dt:lo) (not (null dt:lo)))
                  (dt:lo typ)
                  (strcat "Hvacduct-" (strcase typ T))))

      (setq newSizeTxt (strcat (itoa (fix newW)) "x" (itoa (fix newH)))
            newLenTxt  (strcat (itoa (fix pl)) "L"))

      (setq attState (md:att-snapshot ent fam pl w))
      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent newSizeTxt newLenTxt)
      (md:att-reflow ent attState fam pl newW)

      (princ (strcat "\n[MD] OK - Rectangular duct resized to "
                     (itoa (fix newW)) "x" (itoa (fix newH))
                     " (Type=" typ " | Insul=" (if (= insTok "") "Bare" insTok)
                     " | L=" (rtos pl 2 0) ")")))

    ((= fam "RD")
      (princ (strcat "\n[MD] Round duct | Current: D" (itoa (fix d))
                     " | Type: " typ " | Insul: " insTok
                     " | Length: " (itoa (fix pl))))
      (initget 6)
      (setq newD (getreal (strcat "\nNew Diameter D <" (rtos d 2 0) ">: ")))
      (if (null newD) (setq newD d))

      (setq ecStr  (cond ((= ecMode 1) "_ECR") ((= ecMode 2) "_ECL") (T ""))
            prfStr (if (= insTok "") "" (strcat "-" insTok))
            newBN  (strcat "RDv2-" typ ecStr "-"
                           (rtos pl 2 0) "L-D" (rtos newD 2 0)
                           prfStr
                           (md:rand-sfx)))

      (if (not (tblsearch "BLOCK" newBN))
        (if (and (boundp 'rd:make-block) (not (null rd:make-block)))
          (rd:make-block newBN typ pl newD insIdx ecMode)
          (progn
            (princ "\n[MD] ERROR: rd:make-block not loaded. Load Round_Duct.lsp first.")
            (princ) (exit))))

      (setq lo (if (and (boundp 'rd:lo) (not (null rd:lo)))
                  (rd:lo typ)
                  (strcat "Hvacduct-" (strcase typ T))))

      (setq newSizeTxt (strcat (itoa (fix newD)) "%%c")
            newLenTxt  (strcat (itoa (fix pl)) "L"))

      (setq attState (md:att-snapshot ent fam pl d))
      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent newSizeTxt newLenTxt)
      (md:att-reflow ent attState fam pl newD)

      (princ (strcat "\n[MD] OK - Round duct resized to D"
                     (itoa (fix newD))
                     " (Type=" typ " | Insul=" (if (= insTok "") "Bare" insTok)
                     " | L=" (rtos pl 2 0) ")")))

    (T (princ "\n[MD] Unknown duct family."))))

;; ─── SWITCH FUNCTION ─────────────────────────────────────────────────────────

(defun md:do-switch (ent ed info / fam typ ecMode pl w h d insTok insIdx newBN ecStr prfStr lo attState)
  (setq fam     (nth 0 info)
        typ     (nth 1 info)
        ecMode  (nth 2 info)
        pl      (nth 3 info)
        w       (nth 4 info)
        h       (nth 5 info)
        d       (nth 6 info)
        insTok  (nth 7 info)
        insIdx  (nth 8 info))

  (if (= fam "DT")
    (progn
      (princ (strcat "\n[MD] Rectangular duct | Current: " (itoa (fix w)) "x" (itoa (fix h))
                     " | Type: " typ " | Insul: " insTok
                     " | Length: " (itoa (fix pl))))

      (setq ecStr  (cond ((= ecMode 1) "_ECR") ((= ecMode 2) "_ECL") (T ""))
            prfStr (if (= insTok "") "" (strcat "-" insTok))
            newBN  (strcat "DTv9-" typ ecStr "-"
                           (rtos pl 2 0) "x" (rtos h 2 0) "x" (rtos w 2 0)
                           prfStr
                           (md:rand-sfx)))

      (if (not (tblsearch "BLOCK" newBN))
        (if (and (boundp 'dt:make-block) (not (null dt:make-block)))
          (dt:make-block newBN typ pl h w insIdx ecMode)
          (progn
            (princ "\n[MD] ERROR: dt:make-block not loaded. Load Rectangular_duct.lsp first.")
            (princ) (exit))))

      (setq lo (if (and (boundp 'dt:lo) (not (null dt:lo)))
                  (dt:lo typ)
                  (strcat "Hvacduct-" (strcase typ T))))

      (setq attState (md:att-snapshot ent fam pl w))
      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent (strcat (itoa (fix h)) "x" (itoa (fix w))) (strcat (itoa (fix pl)) "L"))
      (md:att-reflow ent attState fam pl h)

      (princ (strcat "\n[MD] OK - Switched to " (itoa (fix h)) "x" (itoa (fix w))
                     " (Type=" typ " | Insul=" (if (= insTok "") "Bare" insTok)
                     " | L=" (rtos pl 2 0) ")")))
    (progn
      (princ "\n[MD] Switch only works for rectangular ducts.")
      (princ))))

;; ─── LENGTH FUNCTIONS ────────────────────────────────────────────────────────

(defun md:do-length (ent ed info / fam typ ecMode pl w h d insTok insIdx newlen)
  (setq fam     (nth 0 info)
        typ     (nth 1 info)
        ecMode  (nth 2 info)
        pl      (nth 3 info)
        w       (nth 4 info)
        h       (nth 5 info)
        d       (nth 6 info)
        insTok  (nth 7 info)
        insIdx  (nth 8 info))

  (cond
    ((= fam "DT")
      (princ (strcat "\n[MD] Rectangular duct | Current: " (itoa (fix w)) "x" (itoa (fix h))
                     " | Type: " typ " | Length: " (itoa (fix pl)) "L"))
      (initget 6)
      (setq newlen (getreal (strcat "\nNew length <" (rtos pl 2 0) ">: ")))
      (if (null newlen) (setq newlen pl))

      (md:resize-rect ent ed pl newlen typ w h insTok ecMode))

    ((= fam "RD")
      (princ (strcat "\n[MD] Round duct | Current: D" (itoa (fix d))
                     " | Type: " typ " | Length: " (itoa (fix pl)) "L"))
      (initget 6)
      (setq newlen (getreal (strcat "\nNew length <" (rtos pl 2 0) ">: ")))
      (if (null newlen) (setq newlen pl))

      (md:resize-round ent ed pl newlen typ d insTok ecMode))

    (T (princ "\n[MD] Unknown duct family."))))

(defun md:resize-rect (ent ed oldlen newlen typ W H prf ecMode / pl bn-new attState)
  (setq pl newlen)

  (setq bn-new (strcat "DTv9-" typ
                       (cond ((= ecMode 1) "_ECR") ((= ecMode 2) "_ECL") (T ""))
                       "-"
                       (rtos pl 2 0) "x"
                       (rtos W  2 0) "x"
                       (rtos H  2 0)
                       (if (= prf "") "" (strcat "-" prf))
                       (md:rand-sfx)))

  (if (not (tblsearch "BLOCK" bn-new))
    (if dt:make-block
      (dt:make-block bn-new typ pl W H (md:insul-idx-from-prf prf) ecMode)
      (progn
        (princ "\n[MD] dt:make-block not available. Load Rectangular_duct.lsp first.")
        (exit))))

  (setq attState (md:att-snapshot ent "DT" oldlen W))
  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
  (entmod ed)
  (entupd ent)

  (md:set-att ent "LENGTH" (strcat (itoa (fix pl)) "L"))
  (md:att-reflow ent attState "DT" pl W)

  (princ (strcat "\n[MD] OK - Rectangular duct: " typ " " (itoa (fix W)) "x" (itoa (fix H))
                 " | " (itoa (fix pl)) "L")))

(defun md:resize-round (ent ed oldlen newlen typ D prf ecMode / pl bn-new attState)
  (setq pl newlen)

  (setq bn-new (strcat "RDv2-" typ
                       (cond ((= ecMode 1) "_ECR") ((= ecMode 2) "_ECL") (T ""))
                       "-"
                       (rtos pl 2 0) "L-D"
                       (rtos D  2 0)
                       (if (= prf "") "" (strcat "-" prf))
                       (md:rand-sfx)))

  (if (not (tblsearch "BLOCK" bn-new))
    (if rd:make-block
      (rd:make-block bn-new typ pl D (md:insul-idx-from-prf prf) ecMode)
      (progn
        (princ "\n[MD] rd:make-block not available. Load Round_Duct.lsp first.")
        (exit))))

  (setq attState (md:att-snapshot ent "RD" oldlen D))
  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
  (entmod ed)
  (entupd ent)

  (md:set-att ent "LENGTH" (strcat (itoa (fix pl)) "L"))
  (md:att-reflow ent attState "RD" pl D)

  (princ (strcat "\n[MD] OK - Round duct: " typ " D" (itoa (fix D))
                 " | " (itoa (fix pl)) "L")))

;; ─── MAIN COMMAND ────────────────────────────────────────────────────────────

(defun c:MD (/ sel ent ed bn info opt)
  (princ "\n[MD] Modify Duct")

  (setq sel (entsel "\nSelect duct: "))
  (if (null sel)
    (progn (princ "\n[MD] Cancelled.") (princ) (exit)))

  (setq ent (car sel)
        ed  (entget ent))

  (if (not (= (cdr (assoc 0 ed)) "INSERT"))
    (progn (princ "\n[MD] Not a block INSERT.") (princ) (exit)))

  (setq bn (cdr (assoc 2 ed)))

  (setq info (md:parse-block-name bn))
  (if (null info)
    (progn
      (princ (strcat "\n[MD] \"" bn "\" is not a duct block (DTv9/RDv2)."))
      (princ) (exit)))

  (initget "1 2 3")
  (setq opt (getkword "\nSelect option [1-Length / 2-Size / 3-Switch W-H]: "))
  (if (null opt) (setq opt "1"))

  (cond
    ((= opt "1") (md:do-length ent ed info))
    ((= opt "2") (md:do-size ent ed info))
    ((= opt "3") (md:do-switch ent ed info)))

  (princ))

(princ "\n[MD] Modify Duct loaded | Command: MD")
(princ)
;;; END OF FILE
