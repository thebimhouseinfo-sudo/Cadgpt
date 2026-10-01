;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Endcap.lsp
;;; Module      : Draw\Create
;;; Command     : EC
;;; Description : Applies endcaps to open duct runs.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Pick the open edge of a duct segment.
;;; 3. Automatically caps and hatches the extremity.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*ECX:BaseDir*))
  (progn
    (setq *ECX:BaseDir* (findfile "Endcap.lsp"))
    (if *ECX:BaseDir*
      (setq *ECX:BaseDir* (vl-filename-directory *ECX:BaseDir*))
      (setq *ECX:BaseDir* ""))))
(if (not (boundp '*ECX:TextGap*))
  (setq *ECX:TextGap* 60.0))
(if (not (boundp '*ECX:Debug*))
  (setq *ECX:Debug* T))

(defun ecx:dbg (msg)
  (if *ECX:Debug*
    (princ (strcat "\n[EC-DEBUG] " msg))))

(defun ecx:safe-str (v)
  (if (= (type v) 'STR) v ""))

;; ─── HELPERS ────────────────────────────────────────
(defun ecx:load-one (fname / full)
  (setq full (strcat *ECX:BaseDir* "\\" fname))
  (cond
    ((findfile full) (load full))
    ((findfile fname) (load fname))
    (T nil)))

(defun ecx:ensure-deps ()
  (ecx:load-one "Rectangular duct.lsp")
  (ecx:load-one "Round Duct.LSP"))

(defun ecx:prf->ins (prf)
  (cond
    ((= prf "INT25") 1) ((= prf "INT50") 2) ((= prf "INT75") 3) ((= prf "INT100") 4)
    ((= prf "EXT25") 5) ((= prf "EXT50") 6) ((= prf "EXT75") 7)
    (T 0)))

(defun ecx:ins-token-from-parts (parts / p u)
  ;; Scan from tail to find a valid insulation token.
  ;; Prevents random suffix token from being mistaken as insulation.
  (ecx:dbg (strcat "ins-token scan parts=" (vl-princ-to-string parts)))
  (setq p (reverse parts))
  (while p
    (setq u (ecx:safe-str (car p)))
    (setq u (strcase u))
    (if (or (wcmatch u "INT*") (wcmatch u "EXT*"))
      (progn (setq p nil)
             (setq u u))
      (progn
        (setq u nil)
        (setq p (cdr p)))))
  (ecx:safe-str u))

(defun ecx:readable-ang (ang / tang)
  (setq tang ang)
  (while (> tang pi) (setq tang (- tang (* 2.0 pi))))
  (while (<= tang (- pi)) (setq tang (+ tang (* 2.0 pi))))
  (if (or (> tang 1.5708) (<= tang -1.5707)) (setq tang (+ tang pi)))
  tang)

(defun ecx:dxf-put (code val lst)
  (if (assoc code lst) (subst (cons code val) (assoc code lst) lst) (append lst (list (cons code val)))))

(defun ecx:norm-ang (a)
  (while (< a 0.0) (setq a (+ a (* 2.0 pi))))
  (while (>= a (* 2.0 pi)) (setq a (- a (* 2.0 pi))))
  a)

;; ─── RANDOM SUFFIX ──────────────────────────────────
;; Self-contained; does not depend on any other LSP being loaded.
(defun ecx:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

;; ─── UI & PREVIEW ───────────────────────────────────
(defun ecx:update-text-world (ent pt ang / ed)
  (if (and ent pt)
    (progn
      (setq ed (entget ent))
      (setq ed (ecx:dxf-put 10 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (ecx:dxf-put 11 (list (car pt) (cadr pt) 0.0) ed))
      (setq ed (ecx:dxf-put 50 ang ed))
      (entmod ed) (entupd ent))))

(defun ecx:make-text-preview (txt pt txtAng just / ent)
  (setq ent (entmakex (list '(0 . "TEXT") '(8 . "Hvacduct-Text") (cons 10 pt) '(40 . 100.0) '(41 . 0.8) (cons 1 txt) '(7 . "HVACS") (cons 72 just) '(73 . 2) (cons 11 pt) (cons 50 txtAng))))
  (if ent (entupd ent)) ent)

(defun ecx:place-text-preview (ent msg pt ang / ev done)
  (ecx:update-text-world ent pt ang)
  (prompt (strcat "\n" msg " [Click to place, SPACE to rotate 90]: "))
  (setq done nil)
  (while (not done)
    (setq ev (grread T 15 0))
    (cond
      ((= (car ev) 5) (setq pt (cadr ev)) (ecx:update-text-world ent pt ang))
      ((= (car ev) 3) (setq pt (cadr ev)) (ecx:update-text-world ent pt ang) (setq done T))
      ((and (= (car ev) 2) (= (cadr ev) 32)) (setq ang (ecx:norm-ang (+ ang (/ pi 2.0)))) (ecx:update-text-world ent pt ang))
      ((and (= (car ev) 2) (= (cadr ev) 27)) (setq done 'cancel))))
  (if (eq done 'cancel) nil (list pt ang)))

(defun ecx:place-ec-text (txt-pt tang just / ghost res)
  (setq ghost (ecx:make-text-preview "EC" txt-pt tang just))
  (setq res (ecx:place-text-preview ghost "Place EC label" txt-pt tang))
  (if ghost (entdel ghost))
  (if res (setq txt-pt (car res) tang (cadr res)))
  (entmake (list '(0 . "TEXT") '(8 . "Hvacduct-Text") (cons 10 txt-pt) '(40 . 100.0) '(41 . 0.8) '(1 . "EC") '(7 . "HVACS") (cons 72 just) '(73 . 2) (cons 11 txt-pt) (cons 50 tang))))

;; ─── CORE PROCESSING ────────────────────────────────
(defun ecx:rect (ent ed bn / p2 ip ang tang parts nType pl dims w h d1 d2 newEC prfStr nIns ecStr bn-new txt-x txt-y txt-pt xoff)
  (ecx:dbg (strcat "RECT start bn=" (vl-princ-to-string bn)))
  (setq p2 (getpoint "\nSelect duct end (Click near the end to add EC): "))
  (ecx:dbg (strcat "RECT p2=" (vl-princ-to-string p2)))
  (if p2
    (progn
      (setq ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)) tang (ecx:readable-ang ang))
      (setq parts (dt:split bn "-") nType (ecx:safe-str (nth 1 parts)))
      (ecx:dbg (strcat "RECT parts=" (vl-princ-to-string parts)
                       " nType=" (vl-princ-to-string nType)
                       " nTypeType=" (vl-princ-to-string (type nType))))
      (if (= nType "") (setq nType "SA"))
      (if (vl-string-search "_ECR" nType) (setq nType (vl-string-subst "" "_ECR" nType)))
      (if (vl-string-search "_ECL" nType) (setq nType (vl-string-subst "" "_ECL" nType)))
      (if (>= (length parts) 3)
        (progn
          (setq dims (dt:split (nth 2 parts) "x") pl (atof (nth 0 dims)) w (atof (nth 1 dims)) h (atof (nth 2 dims))
                d1 (distance p2 ip) d2 (distance p2 (dt:xf pl 0.0 ip ang))
                newEC (if (< d1 d2) 2 1) prfStr (ecx:safe-str (ecx:ins-token-from-parts parts))
                nIns (ecx:prf->ins prfStr) ecStr (if (= newEC 1) "_ECR" "_ECL")
                bn-new (strcat "DTv9-" nType ecStr "-" (rtos pl 2 0) "x" (rtos w 2 0) "x" (rtos h 2 0) (if (= prfStr "") "" (strcat "-" prfStr)) (ecx:rand-sfx)))
          (ecx:dbg (strcat "RECT parsed dims=" (vl-princ-to-string dims)
                           " pl=" (rtos pl 2 2)
                           " w=" (rtos w 2 2)
                           " h=" (rtos h 2 2)
                           " prf=" prfStr
                           " nIns=" (itoa nIns)
                           " bn-new=" bn-new))
          (if (not (tblsearch "BLOCK" bn-new)) (dt:make-block bn-new nType pl w h nIns newEC))
          (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed)) (entmod ed) (entupd ent)
          (setq xoff (+ *DT:MARGIN* *ECX:TextGap*) txt-x (if (= newEC 1) (+ pl xoff) (- xoff)) txt-y (- (/ w 2.0))
                txt-pt (list (+ (car ip) (* txt-x (cos ang)) (- (* txt-y (sin ang)))) (+ (cadr ip) (* txt-x (sin ang)) (* txt-y (cos ang))) 0.0))
          (ecx:place-ec-text txt-pt tang (if (= newEC 1) 0 2))
          (princ (strcat "\n[Done] Endcap Rect created " (if (= newEC 1) "Right" "Left") ".")))))))

(defun ecx:round (ent ed bn / p2 ip ang tang parts nType pl d d1 d2 newEC prfStr nIns ecStr bn-new txt-x txt-y txt-pt xoff)
  (ecx:dbg (strcat "ROUND start bn=" (vl-princ-to-string bn)))
  (setq p2 (getpoint "\nSelect duct end (Click near the end to add EC): "))
  (ecx:dbg (strcat "ROUND p2=" (vl-princ-to-string p2)))
  (if p2
    (progn
      (setq ip (cdr (assoc 10 ed)) ang (cdr (assoc 50 ed)) tang (ecx:readable-ang ang))
      (setq parts (rd:split bn "-") nType (ecx:safe-str (nth 1 parts)))
      (ecx:dbg (strcat "ROUND parts=" (vl-princ-to-string parts)
                       " nType=" (vl-princ-to-string nType)
                       " nTypeType=" (vl-princ-to-string (type nType))))
      (if (= nType "") (setq nType "SA"))
      (if (vl-string-search "_ECR" nType) (setq nType (vl-string-subst "" "_ECR" nType)))
      (if (vl-string-search "_ECL" nType) (setq nType (vl-string-subst "" "_ECL" nType)))
      (if (>= (length parts) 4)
        (progn
          (setq pl (atof (vl-string-subst "" "L" (nth 2 parts))) d (atof (vl-string-subst "" "D" (nth 3 parts)))
                d1 (distance p2 ip) d2 (distance p2 (rd:xf pl 0.0 ip ang))
                newEC (if (< d1 d2) 2 1) prfStr (ecx:safe-str (ecx:ins-token-from-parts parts))
                nIns (ecx:prf->ins prfStr) ecStr (if (= newEC 1) "_ECR" "_ECL")
                bn-new (strcat "RDv2-" nType ecStr "-" (rtos pl 2 0) "L-D" (rtos d 2 0) (if (= prfStr "") "" (strcat "-" prfStr)) (ecx:rand-sfx)))
          (ecx:dbg (strcat "ROUND parsed pl=" (rtos pl 2 2)
                           " d=" (rtos d 2 2)
                           " prf=" prfStr
                           " nIns=" (itoa nIns)
                           " bn-new=" bn-new))
          (if (not (tblsearch "BLOCK" bn-new)) (rd:make-block bn-new nType pl d nIns newEC))
          (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed)) (entmod ed) (entupd ent)
          (setq xoff (+ *RD:MARGIN* *ECX:TextGap*) txt-x (if (= newEC 1) (+ pl xoff) (- xoff)) txt-y 0.0
                txt-pt (list (+ (car ip) (* txt-x (cos ang)) (- (* txt-y (sin ang)))) (+ (cadr ip) (* txt-x (sin ang)) (* txt-y (cos ang))) 0.0))
          (ecx:place-ec-text txt-pt tang 1)
          (princ (strcat "\n[Done] Endcap Round created " (if (= newEC 1) "Right" "Left") ".")))))))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:EC (/ *error* pick ent ed bn old_echo)
  (defun *error* (msg)
    (if old_echo (setvar "CMDECHO" old_echo))
    (ecx:dbg (strcat "*error* raw msg=" (vl-princ-to-string msg)
                     " type=" (vl-princ-to-string (type msg))))
    (if (and (= (type msg) 'STR)
             (not (wcmatch (strcase msg t) "*break,*cancel*,*exit*")))
      (princ (strcat "\n[EC] Error: " msg)))
    (princ))

  (setq old_echo (getvar "CMDECHO")) (setvar "CMDECHO" 0)
  (ecx:ensure-deps)
  (setq pick (entsel "\nSelect duct to add Endcap: "))
  (ecx:dbg (strcat "pick=" (vl-princ-to-string pick)))
  (if pick
    (progn
      (setq ent (car pick) ed (entget ent) bn (cdr (assoc 2 ed)))
      (ecx:dbg (strcat "ent=" (vl-princ-to-string ent)
                       " type0=" (vl-princ-to-string (cdr (assoc 0 ed)))
                       " bn=" (vl-princ-to-string bn)
                       " bnType=" (vl-princ-to-string (type bn))))
      (cond
        ((and (= (cdr (assoc 0 ed)) "INSERT") bn (wcmatch bn "DTv9-*")) (ecx:rect ent ed bn))
        ((and (= (cdr (assoc 0 ed)) "INSERT") bn (wcmatch bn "RDv2-*")) (ecx:round ent ed bn))
        (T (princ "\n[EC] Error: Invalid Block Duct selected (Must be DTv9 or RDv2)."))))
    (princ "\n[EC] Cancelled."))
  (setvar "CMDECHO" old_echo)
  (princ))

(princ "\n[TBH] Endcap Tool loaded. Type 'EC' to start.")
(princ)
