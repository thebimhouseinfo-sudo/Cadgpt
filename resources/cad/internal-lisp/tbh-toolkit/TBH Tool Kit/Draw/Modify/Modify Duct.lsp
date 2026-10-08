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
                    newW newH newD newBN ecStr prfStr lo newSizeTxt newLenTxt)
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

      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent newSizeTxt newLenTxt)

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

      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent newSizeTxt newLenTxt)

      (princ (strcat "\n[MD] OK - Round duct resized to D"
                     (itoa (fix newD))
                     " (Type=" typ " | Insul=" (if (= insTok "") "Bare" insTok)
                     " | L=" (rtos pl 2 0) ")")))

    (T (princ "\n[MD] Unknown duct family."))))

;; ─── SWITCH FUNCTION ─────────────────────────────────────────────────────────

(defun md:do-switch (ent ed info / fam typ ecMode pl w h d insTok insIdx newBN ecStr prfStr lo)
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

      (setq ed (subst (cons 2 newBN) (assoc 2 ed) ed))
      (setq ed (subst (cons 8 lo)    (assoc 8 ed) ed))
      (entmod ed)
      (entupd ent)

      (md:update-attribs ent (strcat (itoa (fix h)) "x" (itoa (fix w))) (strcat (itoa (fix pl)) "L"))

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

      (md:resize-rect ent ed newlen typ w h insTok ecMode))

    ((= fam "RD")
      (princ (strcat "\n[MD] Round duct | Current: D" (itoa (fix d))
                     " | Type: " typ " | Length: " (itoa (fix pl)) "L"))
      (initget 6)
      (setq newlen (getreal (strcat "\nNew length <" (rtos pl 2 0) ">: ")))
      (if (null newlen) (setq newlen pl))

      (md:resize-round ent ed newlen typ d insTok ecMode))

    (T (princ "\n[MD] Unknown duct family."))))

(defun md:resize-rect (ent ed newlen typ W H prf ecMode / ip ang pl mg bn-new)
  (setq ip  (cdr (assoc 10 ed))
        ang (cdr (assoc 50 ed)))
  (if (not ang) (setq ang 0.0))

  (setq pl newlen)
  (setq mg *DT:MARGIN*)

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

  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
  (entmod ed)
  (entupd ent)

  (md:set-att ent "LENGTH" (strcat (itoa (fix pl)) "L"))
  (md:move-att ent "LENGTH" (md:xf (- pl mg) (- mg H) ip ang))

  (princ (strcat "\n[MD] OK - Rectangular duct: " typ " " (itoa (fix W)) "x" (itoa (fix H))
                 " | " (itoa (fix pl)) "L")))

(defun md:resize-round (ent ed newlen typ D prf ecMode / ip ang pl mg bn-new)
  (setq ip  (cdr (assoc 10 ed))
        ang (cdr (assoc 50 ed)))
  (if (not ang) (setq ang 0.0))

  (setq pl newlen)
  (setq mg *RD:MARGIN*)

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

  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
  (entmod ed)
  (entupd ent)

  (md:set-att ent "LENGTH" (strcat (itoa (fix pl)) "L"))
  (md:move-att ent "LENGTH" (md:xf (- pl mg) 0.0 ip ang))

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
