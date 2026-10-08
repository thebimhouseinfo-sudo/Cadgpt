;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Change Duct.lsp
;;; Module      : Draw\Modify
;;; Command     : CD, CHANGEDUCT, CDDEV
;;; Description : Modifies existing duct properties, types, or routing directly.
;;;               Supports DUCT, EUD, E1, E2, E11, TRANSITION, EC, TAP, BT, BD,
;;;               and RISER (RI) blocks.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(if (not (boundp '*CD:Version*)) (setq *CD:Version* "CD-dev-grouped-2026-04-06"))
(if (not (boundp '*CD:Debug*)) (setq *CD:Debug* T))
(if (not (boundp '*CD:AutoLoadDeps*)) (setq *CD:AutoLoadDeps* nil))
(if (not (boundp '*CD:LoopGuard*)) (setq *CD:LoopGuard* 50000))
;; Safe mode: do not create risky fitting block definitions inside CD update flow.
(if (not (boundp '*CD:NoCreateRisky*)) (setq *CD:NoCreateRisky* T))
;; E11 outline fallback can trigger unstable behavior on some drawings.
(if (not (boundp '*CD:E11UseOutlineFallback*)) (setq *CD:E11UseOutlineFallback* T))
;; Allow controlled E11 creation using deterministic names.
(if (not (boundp '*CD:E11AllowCreate*)) (setq *CD:E11AllowCreate* T))
;; Allow controlled create for transition/connector families in CD rebuild flow.
(if (not (boundp '*CD:T1AllowCreate*)) (setq *CD:T1AllowCreate* T))
(if (not (boundp '*CD:T2AllowCreate*)) (setq *CD:T2AllowCreate* T))
(if (not (boundp '*CD:R2RAllowCreate*)) (setq *CD:R2RAllowCreate* T))
(if (not (boundp '*CD:BootAllowCreate*)) (setq *CD:BootAllowCreate* T))
(if (not (boundp '*CD:TapAllowCreate*)) (setq *CD:TapAllowCreate* T))

;; ─── DEPENDENCIES ───────────────────────────────────
;; Dynamically detect the folder of this script to load dependencies
(setq *CD:SelfPath*
      (cond
        ((and (boundp '*LOAD-TRUENAME*) (= (type *LOAD-TRUENAME*) 'STR) (/= *LOAD-TRUENAME* ""))
         *LOAD-TRUENAME*)
        ((and (boundp '*LOAD-PATHNAME*) (= (type *LOAD-PATHNAME*) 'STR) (/= *LOAD-PATHNAME* ""))
         *LOAD-PATHNAME*)
        ((findfile "Change Duct.lsp")
         (findfile "Change Duct.lsp"))
        (T "")))

(setq *CD:BaseDir*
      (cond
        ((and (= (type *CD:SelfPath*) 'STR) (/= *CD:SelfPath* ""))
         (vl-filename-directory *CD:SelfPath*))
        ((getvar "DWGPREFIX") (getvar "DWGPREFIX"))
        (T "")))
(if (and (= (type *CD:BaseDir*) 'STR) (/= *CD:BaseDir* "")
         (= (strcase (vl-filename-base *CD:BaseDir*)) "MODIFY"))
  (setq *CD:DrawDir* (vl-filename-directory *CD:BaseDir*))
  (setq *CD:DrawDir* *CD:BaseDir*))

(defun cd:load-one (fname / p ok)
  (setq ok nil)
  (foreach p (list
               (if *CD:BaseDir* (strcat *CD:BaseDir* "\\" fname) nil)
               (if *CD:DrawDir* (strcat *CD:DrawDir* "\\" fname) nil)
               (if *CD:DrawDir* (strcat *CD:DrawDir* "\\Create\\" fname) nil)
               (if *CD:DrawDir* (strcat *CD:DrawDir* "\\Others\\" fname) nil)
               fname)
    (if (and (not ok) p (findfile p))
      (setq ok (load p))))
  ok)

(defun cd:get-default-type ()
  (cond
    ((and (boundp '*DTS:Type*) (= (type *DTS:Type*) 'STR)) (cd:norm-type *DTS:Type* "SA"))
    ((and (boundp '*DT:Type*) (= (type *DT:Type*) 'STR)) (cd:norm-type *DT:Type* "SA"))
    ((and (boundp '*RD:Type*) (= (type *RD:Type*) 'STR)) (cd:norm-type *RD:Type* "SA"))
    (T "SA")))

(defun cd:get-default-ins ()
  (cond
    ((and (boundp '*DTS:Insul*) (numberp *DTS:Insul*)) (max 0 (min 7 (fix *DTS:Insul*))))
    ((and (boundp '*DT:Insul*) (numberp *DT:Insul*)) (max 0 (min 7 (fix *DT:Insul*))))
    ((and (boundp '*RD:Insul*) (numberp *RD:Insul*)) (max 0 (min 7 (fix *RD:Insul*))))
    (T 0)))

(defun cd:has-func (sym / afn name names)
  ;; atoms-family may return symbols or strings depending runtime.
  (setq afn (atoms-family 1)
        name (strcase (vl-symbol-name sym)))
  (if (vl-position sym afn)
    T
    (progn
      (setq names (mapcar '(lambda (x)
                             (strcase (if (= (type x) 'STR)
                                        x
                                        (vl-princ-to-string x))))
                          afn))
      (if (vl-position name names) T nil))))

(defun cd:dbg (msg)
  ;; ╔══ DEBUG-START ══════════════════════════════════════════════
  ;; ║ Runtime debug for CD command (toggle with *CD:Debug*).
  ;; ╚══ DEBUG-END ════════════════════════════════════════════════
  (if *CD:Debug* (princ (strcat "\n[CD-DBG] " msg))))

(defun cd:tick-ms () (fix (getvar "MILLISECS")))

(defun cd:elapsed-ms (t0 / t1 d)
  (setq t1 (cd:tick-ms)
        d  (- t1 t0))
  (if (< d 0) (+ d 86400000) d))

(defun cd:ensure-deps ()
  ;; Shared toolkit mode: dependencies are already loaded by master loader.
  ;; Keep autoload optional for troubleshooting only.
  (if *CD:AutoLoadDeps*
    (progn
      (cd:load-one "Duct Type Setting.lsp")
      (cd:load-one "Rectangular duct.lsp")
      (cd:load-one "Round Duct.LSP")
      (cd:load-one "Rec Elbow.lsp")
      (cd:load-one "Round Elbow.LSP")
      (cd:load-one "Mitered Elbow.lsp")
      (cd:load-one "Rect Duct Transition.lsp")
      (cd:load-one "Round Duct Transition.lsp")
      (cd:load-one "Rec to Round.lsp")
      (cd:load-one "Round Riser.lsp")
      ;; Riser.lsp is already loaded, no need to load here
      ))

  ;; DTS is the canonical source for current system/insulation defaults.
  (if (cd:has-func 'dts:ensure-defaults)
    (vl-catch-all-apply 'dts:ensure-defaults nil))
  (cd:dbg (strcat "autoload=" (if *CD:AutoLoadDeps* "ON" "OFF")
                  " | baseDir=" *CD:BaseDir* " | drawDir=" *CD:DrawDir*))

  ;; Soft-check only: command can still run if target block definitions already exist.
  (if (not (cd:has-func 'dt:make-block))
    (princ "\n[CD] Warning: dt:make-block unavailable; DT blocks will update only if target block already exists."))
  (if (not (cd:has-func 'rd:make-block))
    (princ "\n[CD] Warning: rd:make-block unavailable; RD blocks will update only if target block already exists."))
  (if (not (cd:has-func 'dt:get-insul))
    (princ "\n[CD] Warning: dt:get-insul unavailable; insulation prefix fallback will be empty."))
  (if (not (cd:has-func 'riser:make-block))
    (princ "\n[CD] Warning: riser:make-block unavailable; RI blocks will update only if target block already exists."))
  (if (not (cd:has-func 'rriser:make-block))
    (princ "\n[CD] Warning: rriser:make-block unavailable; R2 blocks will update only if target block already exists."))
  (princ "\n[OK] CD dependency check completed (preloaded mode)."))

;; ─── HELPERS ────────────────────────────────────────
(defun cd:norm-type (kw current)
  (if (null kw) (setq kw current))
  (cond
    ((= kw "1") "SA") ((= kw "2") "RA") ((= kw "3") "OA") ((= kw "4") "EA") ((= kw "5") "TA")
    (T kw)))

(defun cd:ins-prefix (idx)
  (if (cd:has-func 'dt:get-insul)
    (car (dt:get-insul idx))
    ""))

(defun cd:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun cd:regen-doc ()
  (vl-catch-all-apply
    'vla-Regen
    (list (vla-get-ActiveDocument (vlax-get-acad-object)) acActiveViewport)))

(defun cd:insert-name (ent ed / obj nm)
  (cond
    ((and ed (assoc 2 ed) (not (wcmatch (cdr (assoc 2 ed)) "`**")))
     (cdr (assoc 2 ed)))
    (T
      (setq obj (vl-catch-all-apply 'vlax-ename->vla-object (list ent)))
      (if (vl-catch-all-error-p obj)
        nil
        (cond
          ((vl-catch-all-error-p (vl-catch-all-apply 'vlax-property-available-p (list obj 'EffectiveName)))
           nil)
          ((vlax-property-available-p obj 'EffectiveName)
           (setq nm (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))
           (if (vl-catch-all-error-p nm) nil nm))
          ((vl-catch-all-error-p (vl-catch-all-apply 'vlax-property-available-p (list obj 'Name)))
           nil)
          ((vlax-property-available-p obj 'Name)
           (setq nm (vl-catch-all-apply 'vla-get-Name (list obj)))
           (if (vl-catch-all-error-p nm) nil nm))
          (T nil))))))

(defun cd:split (str delim / pos lst)
  (setq lst '())
  (while (setq pos (vl-string-search delim str))
    (setq lst (append lst (list (substr str 1 pos))))
    ;; vl-string-search is 0-based, substr is 1-based: +1 is mandatory.
    (setq str (substr str (+ pos (strlen delim) 1))))
  (append lst (list str)))

(defun cd:join (lst delim / out)
  (if (null lst)
    ""
    (progn
      (setq out (car lst)
            lst (cdr lst))
      (while lst
        (setq out (strcat out delim (car lst))
              lst (cdr lst)))
      out)))

(defun cd:find-token-start (parts prefix / out p up)
  (setq out nil)
  (while (and parts (null out))
    (setq p (car parts)
          up (strcase (if p p "")))
    (if (= 0 (vl-string-search (strcase prefix) up))
      (setq out p)
      (setq parts (cdr parts))))
  out)

(defun cd:extract-oy-from-name (name / pos s i ch tok)
  ;; Parse numeric value after "-OY" from full block name, supports signs (e.g. -OY-72).
  (setq tok "")
  (if (and name (= (type name) 'STR))
    (progn
      (setq pos (vl-string-search "-OY" (strcase name)))
      (if pos
        (progn
          (setq s (substr name (+ pos 4))
                i 1)
          (while (<= i (strlen s))
            (setq ch (substr s i 1))
            (if (wcmatch ch "[0-9.+-]")
              (progn
                (setq tok (strcat tok ch))
                (setq i (1+ i)))
              (setq i (+ (strlen s) 1))))))))
  (if (= tok "") 0.0 (atof tok)))

(defun cd:ins-token->idx (tok / u)
  (setq u (strcase (vl-princ-to-string tok)))
  (cond
    ((= u "INT25") 1)
    ((= u "INT50") 2)
    ((= u "INT75") 3)
    ((= u "INT100") 4)
    ((= u "EXT25") 5)
    ((= u "EXT50") 6)
    ((= u "EXT75") 7)
    (T 0)))

(defun cd:find-ins-token (parts / p u)
  (setq p nil)
  (while (and parts (null p))
    (setq u (strcase (car parts)))
    (if (member u '("INT25" "INT50" "INT75" "INT100" "EXT25" "EXT50" "EXT75"))
      (setq p u)
      (setq parts (cdr parts))))
  p)

(defun cd:find-block-by-mask (mask / rec name out)
  (setq out nil)
  (setq rec (tblnext "BLOCK" T))
  (while (and rec (null out))
    (setq name (cdr (assoc 2 rec)))
    (if (and name (wcmatch (strcase name) (strcase mask)))
      (setq out name)
      (setq rec (tblnext "BLOCK"))))
  out)

(defun cd:e11-target-name (nType w1 w2 t1 t2 hand nIns / prf handTag)
  ;; CD target names always include random suffix to avoid block definition collisions.
  (setq prf (cd:ins-prefix nIns)
        handTag (if (= (strcase (if hand hand "")) "RIGHT") "R" "L"))
  (strcat "E11v13-" (strcase nType)
          "-" (rtos w1 2 0) "x" (rtos w2 2 0)
          "-T" (rtos t1 2 0) "x" (rtos t2 2 0)
          "-" handTag
          (if (= prf "") "" (strcat "-" prf))
          (cd:rand-sfx)))

(defun cd:pline-points (ed / out)
  (setq out '())
  (foreach it ed
    (if (= (car it) 10)
      (setq out (append out (list (cdr it))))))
  out)

(defun cd:e11-ready-p ()
  (and (cd:has-func 'e11:block-name)
       (cd:has-func 'e11:make-block)
       (cd:has-func 'e11:type-layer)
       (cd:has-func 'e11:safe-layer)
       (cd:has-func 'e11:parse-name)))

(defun cd:e11-normalize-hand (h / u)
  (setq u (strcase (vl-princ-to-string h)))
  (cond
    ((or (= u "R") (= u "RIGHT")) "Right")
    ((or (= u "L") (= u "LEFT")) "Left")
    (T nil)))

(defun cd:e11-data-ok (data / h)
  (setq h (cd:e11-normalize-hand (cdr (assoc 'hand data))))
  (and (numberp (cdr (assoc 'w1 data)))
       (numberp (cdr (assoc 'w2 data)))
       (numberp (cdr (assoc 't1 data)))
       (numberp (cdr (assoc 't2 data)))
       (not (null h))))

(defun cd:e11-parse-safe (name / res)
  ;; e11:parse-name supports E11v* naming; legacy E11-* should use outline fallback.
  (if (and name (wcmatch (strcase name) "E11V*-*"))
    (progn
      (setq res (vl-catch-all-apply 'e11:parse-name (list name)))
      (if (vl-catch-all-error-p res)
        nil
        res))
    nil))

(defun cd:e11-find-throat-token (parts / p u out)
  (setq out nil)
  (while (and parts (null out))
    (setq p (car parts)
          u (strcase (if p p "")))
    (if (and (= 0 (vl-string-search "T" u))
             (not (null (vl-string-search "X" u))))
      (setq out p)
      (setq parts (cdr parts))))
  out)

(defun cd:e11-throat-from-token (tok / tstr ts t1 t2)
  (if tok
    (progn
      (setq tstr (vl-string-subst "" "T" tok)
            ts   (cd:split tstr "x")
            t1   (if (>= (length ts) 1) (atof (nth 0 ts)) 0.0)
            t2   (if (>= (length ts) 2) (atof (nth 1 ts)) t1))
      (if (and (> t1 0.0) (> t2 0.0))
        (list t1 t2)
        nil))
    nil))

(defun cd:e11-legacy-name-data (name / parts dims hand w1 w2 t1 t2 tpair tTok)
  ;; Legacy E11 names can be like: E11-RA-400x400-Left-INT75
  ;; Newer DT legacy names may include throat token, e.g. ...-INT100-T100x100
  ;; DT-style legacy names do not encode true W2; keep W2=W1 to avoid drift.
  (if (and name (wcmatch (strcase name) "E11-*-*"))
    (progn
      (setq parts (cd:split name "-"))
      (if (>= (length parts) 4)
        (progn
          (setq tTok (cd:e11-find-throat-token parts)
                tpair (cd:e11-throat-from-token tTok))
          (setq dims (cd:split (nth 2 parts) "x")
                hand (cd:e11-normalize-hand (nth 3 parts))
                w1 (if (>= (length dims) 1) (atof (nth 0 dims)) 0.0)
                ;; Do not read W2 from legacy dim token (often duct height in DT naming).
                w2 w1
                t1 (if tpair
                     (car tpair)
                     (if (and (boundp '*E11:T1*) (numberp *E11:T1*)) *E11:T1* 100.0))
                t2 (if tpair
                     (cadr tpair)
                     (if (and (boundp '*E11:T2*) (numberp *E11:T2*)) *E11:T2* 100.0)))
          (if (and (> w1 0.0) (> w2 0.0) hand)
            (list (cons 'w1 w1) (cons 'w2 w2) (cons 't1 t1) (cons 't2 t2) (cons 'hand hand))
            nil))
        nil))
    nil))

(defun cd:e11-outline-data (bn / btr en ed pts p1 p2 p3 p4 p5 hand w1 w2 t1 t2 guard)
  (if bn
    (progn
      (setq btr (tblobjname "BLOCK" bn))
      (if btr
        (progn
          (setq en (entnext btr))
          (setq guard 0)
          (while (and en (null pts))
            (setq guard (1+ guard))
            (if (> guard *CD:LoopGuard*)
              (progn
                (cd:dbg (strcat "e11-outline-data guard hit at block=" bn))
                (setq en nil)))
            (setq ed (entget en))
            (if (and (= (cdr (assoc 0 ed)) "LWPOLYLINE")
                     (>= (cdr (assoc 90 ed)) 6)
                     (/= 0 (logand 1 (if (assoc 70 ed) (cdr (assoc 70 ed)) 0))))
              (setq pts (cd:pline-points ed)))
            (setq en (entnext en)))))
      (if (>= (length pts) 6)
        (progn
          (setq p1 (nth 0 pts)
                p2 (nth 1 pts)
                p3 (nth 2 pts)
                p4 (nth 3 pts)
                p5 (nth 4 pts))
          (setq hand (if (> (car p1) 0.0) "Right" "Left")
                w1   (abs (- (car p1) (car p2)))
                t2   (abs (cadr p5))
                w2   (abs (- (cadr p3) (cadr p5)))
                t1   (- (abs (car p4)) w1))
          (if (and (> w1 0.0) (>= w2 0.0) (>= t1 0.0) (>= t2 0.0))
            (list (cons 'w1 w1) (cons 'w2 w2) (cons 't1 t1) (cons 't2 t2) (cons 'hand hand))
            nil))
        nil))
    nil))

(defun cd:block-entities (bn / btr en out)
  (setq out '())
  (setq btr (tblobjname "BLOCK" bn))
  (if btr
    (progn (setq en (entnext btr))
      (while en
        (if (/= (cdr (assoc 0 (entget en))) "ENDBLK")
          (setq out (append out (list en))))
        (setq en (entnext en)))))
  out)

(defun cd:swap-layer (ed old new)
  (if (and old new (= (strcase (cdr (assoc 8 ed))) (strcase old)))
    (subst (cons 8 new) (assoc 8 ed) ed)
    ed))

;; ─── SUB-ROUTINES (REBUILD/UPDATE) ──────────────────
(defun cd:change-rect (ent ed bn nType nIns / parts dimsTok dims pl w h oldEC ecStr nPrf bn-new lo)
  (if (not (and (cd:has-func 'dt:split) (cd:has-func 'dt:lo)))
    nil
    (progn
  (setq oldEC 0 ecStr "")
  (if (vl-string-search "_ECR" bn) (setq oldEC 1 ecStr "_ECR"))
  (if (vl-string-search "_ECL" bn) (setq oldEC 2 ecStr "_ECL"))
  (setq parts (dt:split bn "-"))
  (if (>= (length parts) 3)
    (progn
      (setq dimsTok (nth 2 parts)
        dims (dt:split dimsTok "x"))
      (if (= (length dims) 3)
        (progn
          (setq pl (atof (nth 0 dims)) w (atof (nth 1 dims)) h (atof (nth 2 dims))
                nPrf (cd:ins-prefix nIns) lo (dt:lo nType)
            ;; Preserve original dimension token exactly, only replace type/insulation.
            bn-new (strcat "DTv9-" nType ecStr "-" dimsTok
                               (if (= nPrf "") "" (strcat "-" nPrf))
                               (cd:rand-sfx)))
          (if (and (not (tblsearch "BLOCK" bn-new)) (cd:has-func 'dt:make-block))
            (dt:make-block bn-new nType pl w h nIns oldEC))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            nil))))))))

(defun cd:change-round (ent ed bn nType nIns / parts lenTok dTok pl d oldEC ecStr nPrf bn-new lo)
  (if (not (and (cd:has-func 'rd:split) (cd:has-func 'rd:lo)))
    nil
    (progn
  (setq oldEC 0 ecStr "")
  (if (vl-string-search "_ECR" bn) (setq oldEC 1 ecStr "_ECR"))
  (if (vl-string-search "_ECL" bn) (setq oldEC 2 ecStr "_ECL"))
  (setq parts (rd:split bn "-"))
  (if (>= (length parts) 4)
    (progn
      (setq lenTok (nth 2 parts)
        dTok  (nth 3 parts)
        pl (atof (vl-string-subst "" "L" lenTok))
        d  (atof (vl-string-subst "" "D" dTok)))
      (if (> d 0.0)
        (progn
          (setq nPrf (cd:ins-prefix nIns) lo (rd:lo nType)
            ;; Preserve original length/diameter tokens exactly.
            bn-new (strcat "RDv2-" nType ecStr "-" lenTok "-" dTok
                               (if (= nPrf "") "" (strcat "-" nPrf))
                               (cd:rand-sfx)))
          (if (and (not (tblsearch "BLOCK" bn-new)) (cd:has-func 'rd:make-block))
            (rd:make-block bn-new nType pl d nIns oldEC))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            nil))))))))

(defun cd:change-e1 (ent ed bn nType nIns / parts bnVer dimTok rTok aTok w h r ang dir nPrf bn-new lo)
  (if (not (and (cd:has-func 'e1:split) (cd:has-func 'e1:lo) (cd:has-func 'e1:safe-layer) (cd:has-func 'e1:make-block)))
    nil
    (progn
  (setq parts (e1:split bn "-"))
  (if (>= (length parts) 6)
    (progn
      (setq bnVer (nth 0 parts)
        dimTok (nth 2 parts)
        rTok   (nth 3 parts)
        aTok   (nth 4 parts)
        w   (atof (nth 0 (e1:split dimTok "x")))
        h   (atof (nth 1 (e1:split dimTok "x")))
        r   (atof (vl-string-subst "" "R" rTok))
        ang (atof (vl-string-subst "" "A" aTok))
            dir (nth 5 parts))
      (if (and (> w 0.0) (> h 0.0))
        (progn
          (setq nPrf (cd:ins-prefix nIns) lo (e1:safe-layer (e1:lo nType))
            ;; Preserve original geometry tokens exactly.
            bn-new (strcat bnVer "-" nType "-" dimTok
               "-" rTok "-" aTok "-" dir
                         (if (= nPrf "") "" (strcat "-" nPrf))
                         (cd:rand-sfx)))
          (if (not (tblsearch "BLOCK" bn-new)) (e1:make-block bn-new nType w h r ang dir nIns))
          (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
          (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
          (entmod ed) (entupd ent) T)))))))

(defun cd:change-eud (ent ed bn nType nIns / parts bnVer mode w h ang rot is-sq fixed-s1 dims aTok nPrf bn-new lo mkRes)
  (if (not (and (cd:has-func 'eud:split) (cd:has-func 'eud:make-block) (cd:has-func 'eud:lo) (cd:has-func 'eud:safe-layer)))
    (progn (cd:dbg "EUD skip: dependency missing.") nil)
    (progn
      (setq parts (eud:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq bnVer (nth 0 parts)
                dims (eud:split (nth 2 parts) "x")
                w (atof (nth 0 dims))
                h (atof (nth 1 dims))
                aTok (nth 3 parts)
                rot (if (assoc 50 ed) (cdr (assoc 50 ed)) 0.0))
                
          (if (vl-string-search "DOWN" (strcase bnVer))
            (setq mode "DOWN")
            (setq mode "UP"))
            
          (if (or (vl-string-search "E11UP" (strcase bnVer)) (vl-string-search "E11DOWN" (strcase bnVer)))
            (progn
              (setq is-sq T
                    fixed-s1 (atof (vl-string-subst "" "TL" aTok))
                    ang 90.0))
            (progn
              (setq is-sq nil
                    fixed-s1 nil
                    ang (atof (vl-string-subst "" "A" aTok)))))
                    
          (if (and (> w 0.0) (> h 0.0))
            (progn
              (setq nPrf (cd:ins-prefix nIns)
                    lo (eud:safe-layer (eud:lo nType))
                    bn-new (strcat (if is-sq "E11" "E1") mode "-" nType "-" (rtos w 2 0) "x" (rtos h 2 0)
                                   "-" aTok
                                   (if (= nPrf "") "" (strcat "-" nPrf))
                                   (cd:rand-sfx)))
              (if (not (tblsearch "BLOCK" bn-new))
                (progn
                  (setq mkRes (vl-catch-all-apply 'eud:make-block (list bn-new nType w h ang rot mode nIns fixed-s1)))
                  (if (vl-catch-all-error-p mkRes)
                    (cd:dbg (strcat "EUD make-block error: " (vl-catch-all-error-message mkRes)))
                    (cd:dbg "EUD make-block done"))))
              (if (tblsearch "BLOCK" bn-new)
                (progn
                  (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                  (if (assoc 8 ed)
                    (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                    (setq ed (append ed (list (cons 8 lo)))))
                  (entmod ed) (entupd ent) T)
                nil))))))))

(defun cd:change-e2 (ent ed bn nType nIns / parts bnVer dTok rTok aTok d r ang dir nPrf bn-new lo)
  (if (not (and (cd:has-func 'e2:split) (cd:has-func 'e2:lo) (cd:has-func 'e2:make-block)))
    nil
    (progn
  (setq parts (e2:split bn "-"))
  (if (>= (length parts) 6)
    (progn
      (setq bnVer (nth 0 parts)
        dTok (nth 2 parts)
        rTok (nth 3 parts)
        aTok (nth 4 parts)
        d   (atof (vl-string-subst "" "D" dTok))
        r   (atof (vl-string-subst "" "R" rTok))
        ang (atof (vl-string-subst "" "A" aTok))
            dir (nth 5 parts))
      (if (> d 0.0)
        (progn
          (setq nPrf (cd:ins-prefix nIns) lo (e2:lo nType)
            ;; Preserve original geometry tokens exactly.
            bn-new (strcat bnVer "-" nType "-" dTok
               "-" rTok "-" aTok "-" dir
                         (if (= nPrf "") "" (strcat "-" nPrf))
                         (cd:rand-sfx)))
          (if (not (tblsearch "BLOCK" bn-new)) (e2:make-block bn-new nType d r ang dir nIns))
          (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
          (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
          (entmod ed) (entupd ent) T)))))))

(defun cd:change-e11 (ent ed bn nType nIns / raw data parseSrc hand w1 w2 t1 t2 lo bn-new mkRes)
  (if (not (cd:e11-ready-p))
    (progn
      (cd:dbg (strcat "E11 skip: dependency missing."
                      " block-name=" (if (cd:has-func 'e11:block-name) "Y" "N")
                      " make-block=" (if (cd:has-func 'e11:make-block) "Y" "N")
                      " type-layer=" (if (cd:has-func 'e11:type-layer) "Y" "N")
                      " safe-layer=" (if (cd:has-func 'e11:safe-layer) "Y" "N")
                      " parse-name=" (if (cd:has-func 'e11:parse-name) "Y" "N")))
      nil)
    (progn
      (setq raw (if ed (cdr (assoc 2 ed)) nil)
            data nil
            parseSrc "<none>")

      (cd:dbg (strcat "E11 begin: bn=" (if bn bn "<nil>")
                      " raw=" (if raw raw "<nil>")
                      " targetType=" nType
                      " targetIns=" (itoa nIns)
                      " ip=" (if (assoc 10 ed) (vl-princ-to-string (cdr (assoc 10 ed))) "<nil>")
                      " rot=" (if (assoc 50 ed) (rtos (cdr (assoc 50 ed)) 2 6) "0")))

      ;; Capture geometry from effective block name first (bn), then raw insert name.
      ;; bn is usually the replaced/visible name and should drive w1/w2/t1/t2.
      (if bn
        (progn
          (setq data (cd:e11-parse-safe bn))
          (if data
            (setq parseSrc "parse-safe(bn)")
            (cd:dbg (strcat "E11 parse-safe(bn) failed for " bn)))))
      (if (and (null data) raw)
        (progn
          (setq data (cd:e11-parse-safe raw))
          (if data
            (setq parseSrc "parse-safe(raw)")
            (cd:dbg (strcat "E11 parse-safe(raw) failed for " raw)))))

      (if (and (null data) bn)
        (progn
          (setq data (vl-catch-all-apply 'cd:e11-legacy-name-data (list bn)))
          (if (vl-catch-all-error-p data)
            (progn
              (cd:dbg (strcat "E11 legacy(bn) error: " (vl-catch-all-error-message data)))
              (setq data nil))
            (if data (setq parseSrc "legacy(bn)")))))
      (if (and (null data) raw)
        (progn
          (setq data (vl-catch-all-apply 'cd:e11-legacy-name-data (list raw)))
          (if (vl-catch-all-error-p data)
            (progn
              (cd:dbg (strcat "E11 legacy(raw) error: " (vl-catch-all-error-message data)))
              (setq data nil))
            (if data (setq parseSrc "legacy(raw)")))))

      ;; Outline fallback is less deterministic than name parsing.
      ;; Keep it last so w1/w2/t1/t2 from block name are preserved when available.
      (if (and *CD:E11UseOutlineFallback* (null data) bn)
        (progn
          (setq data (vl-catch-all-apply 'cd:e11-outline-data (list bn)))
          (if (vl-catch-all-error-p data)
            (progn
              (cd:dbg (strcat "E11 outline(bn) error: " (vl-catch-all-error-message data)))
              (setq data nil))
            (if data (setq parseSrc "outline(bn)")))))
      (if (and *CD:E11UseOutlineFallback* (null data) raw)
        (progn
          (setq data (vl-catch-all-apply 'cd:e11-outline-data (list raw)))
          (if (vl-catch-all-error-p data)
            (progn
              (cd:dbg (strcat "E11 outline(raw) error: " (vl-catch-all-error-message data)))
              (setq data nil))
            (if data (setq parseSrc "outline(raw)")))))

      (if (and data (assoc 'w1 data) (assoc 'w2 data) (assoc 't1 data) (assoc 't2 data) (assoc 'hand data)
               (cd:e11-data-ok data))
        (progn
          (setq hand (cd:e11-normalize-hand (cdr (assoc 'hand data)))
                w1   (cdr (assoc 'w1 data))
                w2   (cdr (assoc 'w2 data))
                t1   (cdr (assoc 't1 data))
                t2   (cdr (assoc 't2 data))
                lo   (e11:safe-layer (e11:type-layer nType))
                *DT:Type* nType
                *DT:Insul* nIns
                bn-new (cd:e11-target-name nType w1 w2 t1 t2 hand nIns))

          (cd:dbg (strcat "E11 rebuild from old block via " parseSrc
                          " => w1=" (rtos w1 2 3)
                          " w2=" (rtos w2 2 3)
                          " t1=" (rtos t1 2 3)
                          " t2=" (rtos t2 2 3)
                          " hand=" hand
                          " newBlock=" bn-new))

          ;; Rebuild target E11 definition with new system/insulation and old geometry.
          (if (not (tblsearch "BLOCK" bn-new))
            (progn
              (setq mkRes (vl-catch-all-apply 'e11:make-block (list bn-new nType w1 w2 t1 t2 hand)))
              (if (vl-catch-all-error-p mkRes)
                (cd:dbg (strcat "E11 make-block error: " (vl-catch-all-error-message mkRes)))
                (cd:dbg "E11 make-block done"))))

          ;; Keep insertion point / rotation / scale of existing reference, only swap definition + layer.
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (if (assoc 8 ed)
                (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                (setq ed (append ed (list (cons 8 lo)))))
              (entmod ed)
              (entupd ent)
              (cd:dbg "E11 swap block name success; insertion/rotation preserved")
              T)
            (progn
              (cd:dbg (strcat "E11 skip: target block missing after rebuild attempt " bn-new))
              nil)))
        (progn
          (cd:dbg (strcat "E11 skip invalid geometry capture."
                          " parseSrc=" parseSrc
                          " bn=" (if bn bn "<nil>")
                          " raw=" (if raw raw "<nil>")
                          " data=" (if data (vl-princ-to-string data) "<nil>")))
          nil)))))

(defun cd:change-t1 (ent ed bn nType nIns / parts bnVer dim1Tok dim2Tok ltok oytok d1 d2 w1 h1 w2 h2 l oy endBare nPrf bn-new lo)
  (if (not (and (cd:has-func 't1:split) (cd:has-func 't1:block-name) (cd:has-func 't1:make-block) (cd:has-func 't1:lo)))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 6)
        (progn
          (setq d1 (cd:split (nth 2 parts) "x")
                d2 (cd:split (nth 3 parts) "x")
                bnVer (nth 0 parts)
                dim1Tok (nth 2 parts)
                dim2Tok (nth 3 parts)
                ltok (nth 4 parts)
                oytok (nth 5 parts)
                w1 (atof (nth 0 d1))
                h1 (atof (nth 1 d1))
                w2 (atof (nth 0 d2))
                h2 (atof (nth 1 d2))
                l  (atof (vl-string-subst "" "L" ltok))
                oy (atof (vl-string-subst "" "OY" oytok))
                endBare (if (member "EB" (mapcar 'strcase parts)) T nil)
                nPrf (cd:ins-prefix nIns)
                ;; Preserve original geometry tokens exactly.
                bn-new (strcat bnVer "-" nType "-" dim1Tok "-" dim2Tok "-" ltok "-" oytok
                   (if endBare "-EB" "")
                   (if (= nPrf "") "" (strcat "-" nPrf))
                   (cd:rand-sfx))
                lo (t1:lo nType))
          (if (and (not (tblsearch "BLOCK" bn-new))
                   (or (not *CD:NoCreateRisky*) *CD:T1AllowCreate*))
            (vl-catch-all-apply 't1:make-block (list bn-new nType w1 h1 w2 h2 l oy nIns endBare)))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            (progn
              (if (and *CD:NoCreateRisky* (not *CD:T1AllowCreate*))
                (cd:dbg (strcat "T1 skip create (safe mode), target block missing: " bn-new))
                (cd:dbg (strcat "T1 skip update, target block missing: " bn-new)))
              nil)))
        nil))))

(defun cd:change-r2r (ent ed bn nType nIns / parts bnVer dimTok dtok ltok oytok d1 w1 h1 d2 l oy endBare nPrf bn-new lo)
  (if (not (and (cd:has-func 'rr:split) (cd:has-func 'rr:block-name) (cd:has-func 'rr:make-block) (cd:has-func 'rr:lo)))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 6)
        (progn
          (setq d1 (cd:split (nth 2 parts) "x")
                bnVer (nth 0 parts)
                dimTok (nth 2 parts)
                dtok (nth 3 parts)
                ltok (nth 4 parts)
                oytok (nth 5 parts)
                w1 (atof (nth 0 d1))
                h1 (atof (nth 1 d1))
                d2 (atof (vl-string-subst "" "D" dtok))
                l  (atof (vl-string-subst "" "L" ltok))
                oy (atof (vl-string-subst "" "OY" oytok))
                endBare (if (member "EB" (mapcar 'strcase parts)) T nil)
                nPrf (cd:ins-prefix nIns)
                ;; Preserve original geometry tokens exactly.
                bn-new (strcat bnVer "-" nType "-" dimTok "-" dtok "-" ltok "-" oytok
                   (if endBare "-EB" "")
                   (if (= nPrf "") "" (strcat "-" nPrf))
                   (cd:rand-sfx))
                lo (rr:lo nType))
          (if (and (not (tblsearch "BLOCK" bn-new))
                   (or (not *CD:NoCreateRisky*) *CD:R2RAllowCreate*))
            (vl-catch-all-apply 'rr:make-block (list bn-new nType w1 h1 d2 l oy nIns endBare)))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            (progn
              (if (and *CD:NoCreateRisky* (not *CD:R2RAllowCreate*))
                (cd:dbg (strcat "R2R skip create (safe mode), target block missing: " bn-new))
                (cd:dbg (strcat "R2R skip update, target block missing: " bn-new)))
              nil)))
        nil))))

(defun cd:change-t2 (ent ed bn nType nIns / parts bnVer dtok1 dtok2 ltok oytok d1 d2 l oy endBare nPrf bn-new lo)
  (if (not (and (cd:has-func 't2:block-name) (cd:has-func 't2:lo) (cd:has-func 't2:make-block)))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq bnVer (nth 0 parts)
                dtok1 (nth 2 parts)
                dtok2 (cd:split dtok1 "x")
                ltok  (cd:find-token-start parts "L")
                d1 (if (and dtok2 (>= (length dtok2) 1)) (atof (nth 0 dtok2)) 0.0)
                d2 (if (and dtok2 (>= (length dtok2) 2)) (atof (nth 1 dtok2)) 0.0)
                l  (atof (vl-string-subst "" "L" ltok))
                oy (cd:extract-oy-from-name bn)
                endBare (if (member "EB" (mapcar 'strcase parts)) T nil)
                nPrf (cd:ins-prefix nIns)
                ;; Preserve original geometry tokens exactly.
                bn-new (strcat bnVer "-" nType "-" dtok1 "-" ltok "-OY" (rtos oy 2 0)
                               (if endBare "-EB" "")
                               (if (= nPrf "") "" (strcat "-" nPrf))
                               (cd:rand-sfx))
                lo (t2:lo nType))
          (if (and (not (tblsearch "BLOCK" bn-new))
                   (or (not *CD:NoCreateRisky*) *CD:T2AllowCreate*))
            (vl-catch-all-apply 't2:make-block (list bn-new nType d1 d2 l oy nIns endBare)))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            (progn
              (if (and *CD:NoCreateRisky* (not *CD:T2AllowCreate*))
                (cd:dbg (strcat "T2 skip create (safe mode), target block missing: " bn-new))
                (cd:dbg (strcat "T2 skip update, target block missing: " bn-new)))
              nil)))
        nil))))

(defun cd:change-boot (ent ed bn nType nIns / parts rev bwTok bw hostShp insTok bn-base sfx bn-new lo bnMask bnFound mkRes)
  (if (not (and (cd:has-func 'bt:make-block) (cd:has-func 'bt:lo)))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 5)
        (progn
              (setq rev (nth 1 parts)
                bwTok (nth 3 parts)
                bw  (atof bwTok)
                hostShp (if (member "ROUND" (mapcar 'strcase parts)) "ROUND" "RECT")
                insTok (cd:ins-prefix nIns)
                sfx (if (cd:has-func 'bt:rand-sfx) (bt:rand-sfx) (cd:rand-sfx))
                ;; Preserve original boot width token exactly.
                bn-base (strcat "BOOT-" rev "-" nType "-" bwTok
                                (if (= insTok "") "" (strcat "-" insTok))
                                "-" hostShp)
                bn-new (strcat bn-base sfx)
                lo (bt:lo nType))
              (if (not (tblsearch "BLOCK" bn-new))
                (progn
                  (setq bnMask (strcat bn-base "-R*"))
                  (setq bnFound (cd:find-block-by-mask bnMask))
                  (if bnFound
                    (progn
                      (setq bn-new bnFound)
                      (cd:dbg (strcat "BOOT reuse existing random-suffix block: " bn-new)))
                    (if (or (not *CD:NoCreateRisky*) *CD:BootAllowCreate*)
                      (progn
                        (setq mkRes (vl-catch-all-apply 'bt:make-block (list bn-new nType bw nIns hostShp)))
                        (if (vl-catch-all-error-p mkRes)
                          (cd:dbg (strcat "BOOT make-block error: " (vl-catch-all-error-message mkRes)))
                          (cd:dbg "BOOT make-block done")))))))
          (if (tblsearch "BLOCK" bn-new)
            (progn
              (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
              (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
              (entmod ed) (entupd ent) T)
            (progn
                  (if (and *CD:NoCreateRisky* (not *CD:BootAllowCreate*))
                    (cd:dbg (strcat "BOOT skip create (safe mode), target block missing: " bn-new))
                    (cd:dbg (strcat "BOOT skip update, target block missing: " bn-new)))
              nil)))
        nil))))

(defun cd:change-bd-def-layers (bn oldLay newLay / btr e d lay oldShade newShade)
  ;; BD geometry is blockified on the picked duct layers. Update those nested
  ;; entities too; changing only the INSERT layer leaves the old system visible.
  (if (and bn oldLay newLay (setq btr (tblobjname "BLOCK" bn)))
    (progn
      (setq oldShade (strcat oldLay "-shading")
            newShade (strcat newLay "-shading")
            e (entnext btr))
      (while e
        (setq d (entget e))
        (if (= (cdr (assoc 0 d)) "ENDBLK")
          (setq e nil)
          (progn
            (setq lay (cdr (assoc 8 d)))
            (cond
              ((= (strcase lay) (strcase oldLay))
               (setq d (subst (cons 8 newLay) (assoc 8 d) d))
               (entmod d))
              ((= (strcase lay) (strcase oldShade))
               (setq d (subst (cons 8 newShade) (assoc 8 d) d))
               (entmod d)))
            (setq e (entnext e)))))))
  T)

(defun cd:change-bd (ent ed bn nType nIns / parts oldSys oldLay newLay)
  (if (not (cd:has-func 'dt:lo))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq oldSys (nth 1 parts)
                oldLay (dt:lo oldSys)
                newLay (dt:lo nType))
          (cd:change-bd-def-layers bn oldLay newLay)
          (setq ed (subst (cons 8 newLay) (assoc 8 ed) ed))
          (entmod ed) (entupd ent) T)
        nil))))

(defun cd:change-ec (ent ed bn nType nIns)
  ;; Endcap objects are DT/RD blocks carrying _ECR/_ECL in block name.
  (cond
    ((wcmatch (strcase bn) "DTV#-*") (cd:change-rect ent ed bn nType nIns))
    ((wcmatch (strcase bn) "RDV#-*") (cd:change-round ent ed bn nType nIns))
    (T nil)))

(defun cd:tap-token-match-p (tok kind / up)
  (setq up (strcase (if tok tok "")))
  (cond
    ;; RECT size token like 500x300
    ((= kind 'DIM) (wcmatch up "#*X#*"))
    ;; Length token like L200
    ((= kind 'LEN) (wcmatch up "L#*"))
    ;; Diameter token like D300 (avoid matching DPTAP)
    ((= kind 'DIA) (wcmatch up "D#*"))
    (T nil)))

(defun cd:tap-find-token (parts kind / p out)
  (setq out nil)
  (while (and parts (null out))
    (setq p (car parts))
    (if (cd:tap-token-match-p p kind)
      (setq out p)
      (setq parts (cdr parts))))
  out)

(defun cd:change-tap (ent ed bn nType nIns / parts shp tkDim tkLen tkD dims w h d l insTok bn-new lo bnMask bnFound mkRes)
  (if (not (and (cd:has-func 'dt:make-block) (cd:has-func 'rd:make-block) (cd:has-func 'dt:lo) (cd:has-func 'rd:lo)))
    nil
    (progn
      (setq parts (cd:split bn "-"))
      (if (>= (length parts) 5)
        (progn
          (setq shp (strcase (nth 1 parts))
                insTok (cd:ins-prefix nIns))
          (cond
            ((= shp "RECT")
             (setq tkDim (cd:tap-find-token parts 'DIM)
               tkLen (cd:tap-find-token parts 'LEN))
             (if (and tkDim tkLen)
               (progn
                     (setq dims (cd:split tkDim "x")
                       w (atof (nth 0 dims))
                       h (atof (nth 1 dims))
                       l (atof (vl-string-subst "" "L" tkLen))
                       ;; Preserve original dimension/length tokens exactly.
                       bn-new (strcat "DPTAP-RECT-" nType "-" tkDim
                          "-" tkLen
                                      (if (= insTok "") "" (strcat "-" insTok))
                                  (if (cd:has-func 'dt:rand-sfx) (dt:rand-sfx) (cd:rand-sfx)))
                       lo (dt:lo nType))
                 (if (not (tblsearch "BLOCK" bn-new))
                   (progn
                     (setq bnMask (strcat bn-new "-R*"))
                     (setq bnFound (cd:find-block-by-mask bnMask))
                     (if bnFound
                       (progn
                         (setq bn-new bnFound)
                         (cd:dbg (strcat "TAP RECT reuse existing random-suffix block: " bn-new)))
                       (if (or (not *CD:NoCreateRisky*) *CD:TapAllowCreate*)
                         (progn
                           (setq mkRes (vl-catch-all-apply 'dt:make-block (list bn-new nType l w h nIns 0)))
                           (if (vl-catch-all-error-p mkRes)
                             (cd:dbg (strcat "TAP RECT make-block error: " (vl-catch-all-error-message mkRes)))
                             (cd:dbg "TAP RECT make-block done")))))))
                 (if (tblsearch "BLOCK" bn-new)
                   (progn
                     (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                     (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                     (entmod ed) (entupd ent) T)
                   (progn
                     (if (and *CD:NoCreateRisky* (not *CD:TapAllowCreate*))
                       (cd:dbg (strcat "TAP RECT skip create (safe mode), target block missing: " bn-new))
                       (cd:dbg (strcat "TAP RECT skip update, target block missing: " bn-new)))
                     nil)))
               nil))
            ((= shp "ROUND")
             (setq tkD   (cd:tap-find-token parts 'DIA)
               tkLen (cd:tap-find-token parts 'LEN))
             (if (and tkD tkLen)
               (progn
                     (setq d (atof (vl-string-subst "" "D" tkD))
                       l (atof (vl-string-subst "" "L" tkLen))
                       ;; Preserve original diameter/length tokens exactly.
                       bn-new (strcat "DPTAP-ROUND-" nType "-" tkD
                          "-" tkLen
                                      (if (= insTok "") "" (strcat "-" insTok))
                                  (if (cd:has-func 'rd:rand-sfx) (rd:rand-sfx) (cd:rand-sfx)))
                       lo (rd:lo nType))
                 (if (not (tblsearch "BLOCK" bn-new))
                   (progn
                     (setq bnMask (strcat bn-new "-R*"))
                     (setq bnFound (cd:find-block-by-mask bnMask))
                     (if bnFound
                       (progn
                         (setq bn-new bnFound)
                         (cd:dbg (strcat "TAP ROUND reuse existing random-suffix block: " bn-new)))
                       (if (or (not *CD:NoCreateRisky*) *CD:TapAllowCreate*)
                         (progn
                           (setq mkRes (vl-catch-all-apply 'rd:make-block (list bn-new nType l d nIns 0)))
                           (if (vl-catch-all-error-p mkRes)
                             (cd:dbg (strcat "TAP ROUND make-block error: " (vl-catch-all-error-message mkRes)))
                             (cd:dbg "TAP ROUND make-block done")))))))
                 (if (tblsearch "BLOCK" bn-new)
                   (progn
                     (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                     (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                     (entmod ed) (entupd ent) T)
                   (progn
                     (if (and *CD:NoCreateRisky* (not *CD:TapAllowCreate*))
                       (cd:dbg (strcat "TAP ROUND skip create (safe mode), target block missing: " bn-new))
                       (cd:dbg (strcat "TAP ROUND skip update, target block missing: " bn-new)))
                     nil)))
               nil))
            (T nil)))
        nil))))

;; ---------- RISER (RI) handler ----------
(defun cd:change-riser (ent ed bn nType nIns / parts base parts2 typePart wStr hStr insStr w h oldIns sfx bn-new lo insul-data)
  ;; Block name format: RI_<Type>_W<width>_H<height>_I<insIndex>-Rxxxx
  (if (not (cd:has-func 'riser:make-block))
    (progn
      (cd:dbg "RI skip: riser:make-block not available")
      nil)
    (progn
      (setq parts (cd:split bn "-"))
      (if (and (>= (length parts) 1) (wcmatch (car parts) "RI_*"))
        (progn
          (setq base (car parts))
          (setq parts2 (cd:split base "_"))
          (if (>= (length parts2) 4)
            (progn
              (setq typePart (nth 1 parts2)
                    wStr     (nth 2 parts2)
                    hStr     (nth 3 parts2)
                    insStr   (nth 4 parts2))
              (if (and wStr hStr insStr)
                (progn
                  (setq w (atoi (vl-string-subst "" "W" wStr))
                        h (atoi (vl-string-subst "" "H" hStr))
                        oldIns (atoi (vl-string-subst "" "I" insStr))
                        sfx (cd:rand-sfx)
                        bn-new (strcat "RI_" nType "_W" (itoa (fix w)) "_H" (itoa (fix h))
                                       "_I" (itoa nIns) sfx)
                        lo (if (cd:has-func 'riser:layer-duct)
                               (riser:layer-duct)
                               (strcat "Hvacduct-" (strcase nType T))))
                  (if (not (tblsearch "BLOCK" bn-new))
                    (progn
                      (setq insul-data (if (cd:has-func 'riser:get-insul)
                                           (riser:get-insul nIns)
                                           (list "BARE" 0 "" 1.0 0.0)))
                      (vl-catch-all-apply 'riser:make-block (list bn-new w h insul-data))))
                  (if (tblsearch "BLOCK" bn-new)
                    (progn
                      (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                      (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                      (entmod ed) (entupd ent) T)
                    (progn
                      (cd:dbg (strcat "RI target block missing: " bn-new))
                      nil)))
                (progn
                  (cd:dbg "RI parse failed (missing tokens)")
                  nil)))
            (progn
              (cd:dbg "RI base malformed")
              nil)))
        (progn
          (cd:dbg "RI not a riser block")
          nil)))))

;; ---------- ROUND RISER (R2) handler ----------
(defun cd:change-round-riser (ent ed bn nType nIns / parts base parts2 typePart dStr insStr d oldIns sfx bn-new lo insul-data)
  ;; Block name format: RRI_<Type>_D<diameter>_I<insIndex>-Rxxxx
  (if (not (cd:has-func 'rriser:make-block))
    (progn
      (cd:dbg "R2 skip: rriser:make-block not available")
      nil)
    (progn
      (setq parts (cd:split bn "-"))
      (if (and (>= (length parts) 1) (wcmatch (car parts) "RRI_*"))
        (progn
          (setq base (car parts))
          (setq parts2 (cd:split base "_"))
          (if (>= (length parts2) 4)
            (progn
              (setq typePart (nth 1 parts2)
                    dStr     (nth 2 parts2)
                    insStr   (nth 3 parts2))
              (if (and dStr insStr)
                (progn
                  (setq d (atoi (vl-string-subst "" "D" dStr))
                        oldIns (atoi (vl-string-subst "" "I" insStr))
                        sfx (cd:rand-sfx)
                        bn-new (strcat "RRI_" nType "_D" (itoa (fix d))
                                       "_I" (itoa nIns) sfx)
                        lo (if (cd:has-func 'rriser:layer-duct)
                               (rriser:layer-duct)
                               (strcat "Hvacduct-" (strcase nType T))))
                  (if (not (tblsearch "BLOCK" bn-new))
                    (progn
                      (setq insul-data (if (cd:has-func 'rriser:get-insul)
                                           (rriser:get-insul nIns)
                                           (list "BARE" 0 "" 1.0 0.0)))
                      (vl-catch-all-apply 'rriser:make-block (list bn-new d insul-data))))
                  (if (tblsearch "BLOCK" bn-new)
                    (progn
                      (setq ed (subst (cons 2 bn-new) (assoc 2 ed) ed))
                      (setq ed (subst (cons 8 lo) (assoc 8 ed) ed))
                      (entmod ed) (entupd ent) T)
                    (progn
                      (cd:dbg (strcat "R2 target block missing: " bn-new))
                      nil)))
                (progn
                  (cd:dbg "R2 parse failed (missing tokens)")
                  nil)))
            (progn
              (cd:dbg "R2 base malformed")
              nil)))
        (progn
          (cd:dbg "R2 not a round riser block")
          nil)))))

;; ─── CLASSIFY FAMILY ─────────────────────────────────
(defun cd:classify-family (bn / ubn)
  (setq ubn (strcase (if bn bn "")))
  (cond
    ((and (or (vl-string-search "_ECR" ubn) (vl-string-search "_ECL" ubn))
          (or (wcmatch ubn "DTV#-*") (wcmatch ubn "RDV#-*"))) 'EC)
    ((wcmatch ubn "DPTAP-*") 'TAP)
    ((or (wcmatch ubn "DTV#-*") (wcmatch ubn "RDV#-*")) 'DUCT)
    ((or (wcmatch ubn "E1UP-*") (wcmatch ubn "E1DOWN-*") (wcmatch ubn "E11UP-*") (wcmatch ubn "E11DOWN-*")) 'EUD)
    ((or (wcmatch ubn "E1V#-*") (wcmatch ubn "E1V##-*")) 'E1)
    ((wcmatch ubn "E2V#-*") 'E2)
    ((wcmatch ubn "E11*") 'E11)
    ((or (wcmatch ubn "T1V*-*") (wcmatch ubn "T2V*-*") (wcmatch ubn "R2RV*-*")) 'TRANSITION)
    ((wcmatch ubn "BOOT-*") 'BT)
    ((wcmatch ubn "BD-*") 'BD)
    ((wcmatch ubn "RI_*") 'RI)    ;; <-- RISER family
    ((wcmatch ubn "RRI_*") 'R2)   ;; <-- ROUND RISER family
    (T 'OTHER)))

(defun cd:family-subcmd-name (fam)
  (cond
    ((= fam 'DUCT) "CD_DUCT")
    ((= fam 'EUD) "CD_EUD")
    ((= fam 'E1) "CD_E1")
    ((= fam 'E2) "CD_E2")
    ((= fam 'E11) "CD_E11")
    ((= fam 'TRANSITION) "CD_TRANSITION")
    ((= fam 'EC) "CD_EC")
    ((= fam 'TAP) "CD_TAP")
    ((= fam 'BT) "CD_BT")
    ((= fam 'BD) "CD_BD")
    ((= fam 'RI) "CD_RI")
    ((= fam 'R2) "CD_R2")
    (T "CD")))

(defun cd:apply-change-by-family (fam ent bn nType nIns / ed res)
  (setq ed (entget ent))
  (setq res
    (cond
      ((= fam 'DUCT)
       (if (wcmatch (strcase (if bn bn "")) "RDV#-*")
         (vl-catch-all-apply 'cd:change-round (list ent ed bn nType nIns))
         (vl-catch-all-apply 'cd:change-rect  (list ent ed bn nType nIns))))
      ((= fam 'EUD) (vl-catch-all-apply 'cd:change-eud (list ent ed bn nType nIns)))
      ((= fam 'E1)  (vl-catch-all-apply 'cd:change-e1 (list ent ed bn nType nIns)))
      ((= fam 'E2)  (vl-catch-all-apply 'cd:change-e2 (list ent ed bn nType nIns)))
      ((= fam 'E11) (vl-catch-all-apply 'cd:change-e11   (list ent ed bn nType nIns)))
      ((= fam 'TRANSITION)
       (cond
         ((wcmatch (strcase (if bn bn "")) "T1V*-*") (vl-catch-all-apply 'cd:change-t1  (list ent ed bn nType nIns)))
         ((wcmatch (strcase (if bn bn "")) "T2V*-*") (vl-catch-all-apply 'cd:change-t2  (list ent ed bn nType nIns)))
         (T                                            (vl-catch-all-apply 'cd:change-r2r (list ent ed bn nType nIns)))))
      ((= fam 'EC)  (vl-catch-all-apply 'cd:change-ec    (list ent ed bn nType nIns)))
      ((= fam 'TAP) (vl-catch-all-apply 'cd:change-tap   (list ent ed bn nType nIns)))
      ((= fam 'BT)  (vl-catch-all-apply 'cd:change-boot  (list ent ed bn nType nIns)))
      ((= fam 'BD)  (vl-catch-all-apply 'cd:change-bd    (list ent ed bn nType nIns)))
      ((= fam 'RI)  (vl-catch-all-apply 'cd:change-riser (list ent ed bn nType nIns)))
      ((= fam 'R2)  (vl-catch-all-apply 'cd:change-round-riser (list ent ed bn nType nIns)))
      (T nil)))
  (if (vl-catch-all-error-p res)
    (progn
      (cd:dbg (strcat "  !! " (vl-princ-to-string fam) " error: "
                      (vl-catch-all-error-message res)
                      " | bn=" (if bn bn "<nil>")))
      nil)
    res))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:CD (/ *error* old_echo ss n i ent ed bn nType nIns changed dftType dftIns skipped
              tCmd tObj fam item
              bDUCT bEUD bE1 bE2 bE11 bTRANS bEC bTAP bBT bBD bRI bR2 bOther
              order grp famItems autoFam)
  (defun *error* (msg)
    (if old_echo (setvar "CMDECHO" old_echo))
    (if (not (wcmatch (strcase msg t) "*break,*cancel*,*exit*"))
      (princ (strcat "\n[CD] Error: " msg)))
    (princ))

  (princ "\n=== [CD] CHANGE SYSTEM & INSULATION ===")
  (princ (strcat "\n[CD] Mode=" *CD:Version* " | Batch order: DUCT -> EUD -> E1 -> E2 -> E11 -> TRANSITION -> EC -> TAP -> BT -> BD -> RI"))
  (cd:ensure-deps)
  (setq old_echo (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  (if (setq ss (ssget '((0 . "INSERT"))))
    (progn
      (setq tCmd (cd:tick-ms))
      (setq dftType (cd:get-default-type)
            dftIns  (cd:get-default-ins))

      (initget "1 2 3 4 5 SA RA OA EA TA")
      (setq nType (cd:norm-type (getkword (strcat "\nSystem [1=Supply Air (SA) / 2=Return Air (RA) / 3=Outside Air (OA) / 4=Exhaust Air (EA) / 5=Transfer Air (TA)] <"
                                                   dftType ">: "))
                                 dftType))

      (initget "0 1 2 3 4 5 6 7")
      (setq nIns (getkword (strcat "\nInsulation [0=Bare Duct / 1=Internal 25mm / 2=Internal 50mm / 3=Internal 75mm / 4=Internal 100mm / 5=External 25mm / 6=External 50mm / 7=External 75mm] <"
                                    (itoa dftIns) ">: ")))
      (if (null nIns) (setq nIns (itoa dftIns)))
      (setq nIns (atoi nIns))

      ;; Persist choices to new DTS globals first, keep legacy vars in sync.
      (setq *DTS:Type* nType
            *DTS:Insul* nIns)
      (if (cd:has-func 'dts:sync-shape)
        (progn
          (vl-catch-all-apply 'dts:sync-shape (list "RECT"))
          (vl-catch-all-apply 'dts:sync-shape (list "ROUND"))))
      (if (boundp '*DT:Insul*) (setq *DT:Insul* nIns))
      (if (boundp '*RD:Insul*) (setq *RD:Insul* nIns))
      (if (boundp '*DT:Type*)  (setq *DT:Type* nType))
      (if (boundp '*RD:Type*)  (setq *RD:Type* nType))

      (cd:dbg (strcat "selection count=" (itoa (sslength ss))
                      " | system=" nType " | ins=" (itoa nIns)))

      ;; 1) Bucketize by family first (do not process in pick order)
      (setq i 0 n (sslength ss)
        bDUCT '() bEUD '() bE1 '() bE2 '() bE11 '() bTRANS '() bEC '() bTAP '() bBT '() bBD '() bRI '() bR2 '() bOther '())
      (while (< i n)
        (setq ent (ssname ss i)
              ed  (entget ent)
              bn  (cd:insert-name ent ed)
              fam (cd:classify-family bn)
              item (list ent bn))
        (cond
            ((= fam 'DUCT)      (setq bDUCT  (cons item bDUCT)))
            ((= fam 'EUD)       (setq bEUD   (cons item bEUD)))
            ((= fam 'E1)        (setq bE1    (cons item bE1)))
            ((= fam 'E2)        (setq bE2    (cons item bE2)))
          ((= fam 'E11)  (setq bE11  (cons item bE11)))
            ((= fam 'TRANSITION) (setq bTRANS (cons item bTRANS)))
          ((= fam 'EC)   (setq bEC   (cons item bEC)))
          ((= fam 'TAP)  (setq bTAP  (cons item bTAP)))
          ((= fam 'BT)   (setq bBT   (cons item bBT)))
          ((= fam 'BD)   (setq bBD   (cons item bBD)))
          ((= fam 'RI)   (setq bRI   (cons item bRI)))
          ((= fam 'R2)   (setq bR2   (cons item bR2)))
          (T             (setq bOther (cons item bOther))))
        (setq i (1+ i)))

      ;; 2) Process by fixed family order (not pick order)
      (setq bDUCT (reverse bDUCT)
            bEUD (reverse bEUD)
            bE1 (reverse bE1)
            bE2 (reverse bE2)
            bE11 (reverse bE11)
            bTRANS (reverse bTRANS)
            bEC (reverse bEC)
            bTAP (reverse bTAP)
            bBT (reverse bBT)
            bBD (reverse bBD)
            bRI (reverse bRI)
            bR2 (reverse bR2)
            bOther (reverse bOther))

      ;; Required batch order by user:
      ;; DUCT -> EUD -> E1 -> E2 -> E11 -> TRANSITION -> EC -> TAP -> BT -> BD -> RI -> R2
      (setq order (list
              (list 'DUCT bDUCT)
              (list 'EUD bEUD)
              (list 'E1 bE1)
              (list 'E2 bE2)
              (list 'E11 bE11)
              (list 'TRANSITION bTRANS)
              (list 'EC bEC)
              (list 'TAP bTAP)
              (list 'BT bBT)
              (list 'BD bBD)
              (list 'RI bRI)
              (list 'R2 bR2)
              ))

      ;; Auto route to matching sub-flow when selection contains only one supported family.
      (setq autoFam nil)
      (foreach grp order
        (if (> (length (cadr grp)) 0)
          (if autoFam
            (setq autoFam 'MIXED)
            (setq autoFam (car grp)))))
      (if (and autoFam (/= autoFam 'MIXED) (= (length bOther) 0))
        (progn
          (princ (strcat "\n[CD] Auto-route detected: "
                         (vl-princ-to-string autoFam)
                         " -> "
                         (cd:family-subcmd-name autoFam)))
          (setq order (list (assoc autoFam order)))))

      (setq changed 0 skipped 0)
      (foreach grp order
        (setq fam (car grp)
              famItems (cadr grp))
        (if famItems
          (cd:dbg (strcat "family " (vl-princ-to-string fam) " count=" (itoa (length famItems)))))
        (foreach item famItems
          (setq ent (car item)
                bn  (cadr item)
                tObj (cd:tick-ms))
          (cd:dbg (strcat "obj START family=" (vl-princ-to-string fam) " bn=" (if bn bn "<nil>")))
          (if (cd:apply-change-by-family fam ent bn nType nIns)
            (setq changed (1+ changed))
            (setq skipped (1+ skipped)))
          (cd:dbg (strcat "obj END family=" (vl-princ-to-string fam)
                          " elapsed=" (itoa (cd:elapsed-ms tObj)) "ms"
                          " | changed=" (itoa changed) " skipped=" (itoa skipped)))))

      ;; Unsupported/unknown families: skip with debug only
      (foreach item bOther
        (setq skipped (1+ skipped))
        (cd:dbg (strcat "skip unsupported family bn=" (if (cadr item) (cadr item) "<nil>"))))

      (cd:dbg (strcat "changed=" (itoa changed) " | skipped=" (itoa skipped)
                      " | totalMs=" (itoa (cd:elapsed-ms tCmd))))
      (princ (strcat "\n[Done] Successfully updated " (itoa changed) " objects.")))
    (princ "\n[CD] Cancelled."))
  
  (setvar "CMDECHO" old_echo)
  (princ))

(defun c:CHANGEDUCT () (c:CD))
(defun c:CDDEV () (c:CD))

(princ (strcat "\n[TBH] Change Duct Tool loaded (" *CD:Version* "). Commands: CD / CHANGEDUCT / CDDEV"))
(princ)
