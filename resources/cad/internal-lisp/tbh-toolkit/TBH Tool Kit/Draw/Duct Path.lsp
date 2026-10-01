;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Duct Path.lsp
;;; Module      : Draw
;;; Command     : DTDBG, DT
;;; Description : Automates the drawing of continuous duct paths.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Click continuous points to draw the routing path.
;;; 3. Press Enter to conclude line generation.
;;; TBH-HEADER-END
;;; =============================================================================
(vl-load-com)

;; --- GLOBALS ----------------------------------------------------------------
(if (not (boundp '*DP:Mode*))      (setq *DP:Mode* "Rect"))
(if (not (boundp '*DP:R*))         (setq *DP:R* 150.0))
(if (not (boundp '*DP:Ext*))       (setq *DP:Ext* 50.0))
(if (not (boundp '*DP:ElbowType*)) (setq *DP:ElbowType* "E1"))
(if (not (boundp '*DP:DrawDir*))   (setq *DP:DrawDir* nil))
(if (not (boundp '*DP:JoinTol*))   (setq *DP:JoinTol* 120.0))
(if (not (boundp '*DP:Debug*))     (setq *DP:Debug* nil))
(if (not (boundp '*DP:E11Throat*)) (setq *DP:E11Throat* 100.0))
(if (not (boundp '*DP:MainConnLen*)) (setq *DP:MainConnLen* 600.0))
(if (not (boundp '*DP:TapLen*))    (setq *DP:TapLen* 200.0))
(if (not (boundp '*DP:SideConnType*)) (setq *DP:SideConnType* "Boot"))
(if (not (boundp '*DP:SideConnAsked*)) (setq *DP:SideConnAsked* nil))

(defun dp:dbg (msg)
  (if *DP:Debug*
    (princ (strcat "\n[DT-DBG] " msg))))

(defun c:DTDBG ()
  (setq *DP:Debug* (not *DP:Debug*))
  (princ (strcat "\n[DT] Debug=" (if *DP:Debug* "ON" "OFF")))
  (princ))

(defun dp:is-pt (v)
  (and (listp v)
       (or (= (length v) 2) (= (length v) 3))
       (numberp (car v))
       (numberp (cadr v))))

(defun dp:pt3d (v)
  (if (dp:is-pt v)
    (list (car v) (cadr v) (if (= (length v) 3) (caddr v) 0.0))
    nil))

(defun dp:sanitize-pts (pts / out p q)
  (setq out '())
  (foreach p pts
    (setq q (dp:pt3d p))
    (if q
      (setq out (append out (list q)))
      (dp:dbg (strcat "drop invalid point from path: " (vl-princ-to-string p)))))
  out)

(defun dp:valid-pt-list-p (pts / ok p)
  (setq ok T)
  (if (or (not (listp pts)) (< (length pts) 2))
    nil
    (progn
      (foreach p pts
        (if (not (dp:is-pt p)) (setq ok nil)))
      ok)))

(defun dp:norm-shape (kw / s)
  (setq s (strcase (vl-princ-to-string kw)))
  (cond
    ((or (= s "1") (= s "RECT") (= s "RECTANGULAR")) "Rect")
    ((or (= s "2") (= s "ROUND")) "Round")
    ((= s "SETTING") "Setting")
    ((= s "DTS") "DTS")
    (T "Rect")))

;; --- LOW-LEVEL HELPERS ------------------------------------------------------
(defun dp:norm-slash (s)
  (if (= (type s) 'STR)
    (vl-string-translate "\\" "/" s)
    ""))

(defun dp:dir-of (path / p i)
  (setq p (dp:norm-slash path)
        i (vl-string-position 47 p nil T))
  (if i (substr p 1 i) p))

(defun dp:drop-suffix (s suffix / ls lx)
  (setq ls (strlen s)
        lx (strlen suffix))
  (if (and (>= ls lx)
           (= (strcase (substr s (- ls lx -1))) (strcase suffix)))
    (substr s 1 (- ls lx))
    s))

(defun dp:exists-dir (p)
  (and (= (type p) 'STR)
       (/= p "")
       (vl-file-directory-p p)))

(defun dp:valid-draw-dir (p)
  (and (dp:exists-dir p)
       (findfile (strcat p "Duct Type Setting.lsp"))
       (dp:exists-dir (strcat p "Create/"))))

(defun dp:sym-exists-p (sym / lst)
  (setq lst (atoms-family 1))
  (if (listp lst)
    (if (member sym lst) T nil)
    nil))

;; --- RANDOM SUFFIX ----------------------------------------------------------
;; Self-contained random suffix for DT-generated inline fitting names.
(defun dp:rand-sfx (/ ms frac)
  (setq ms   (itoa (abs (fix (getvar "MILLISECS"))))
        frac (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R"
          (substr ms (max 1 (- (strlen ms) 4)))
          (substr frac 1 (min 4 (strlen frac)))))

(defun dp:sys-layer (tp)
  (cdr (assoc (strcase tp)
    '(("SA" . "Hvacduct-sa")
      ("RA" . "Hvacduct-ra")
      ("EA" . "Hvacduct-ea")
      ("OA" . "Hvacduct-oa")
      ("TA" . "Hvacduct-ta")))))

(defun dp:load-abs (fullpath / ok)
  (if (findfile fullpath)
    (progn
      (setq ok (vl-catch-all-apply 'load (list fullpath)))
      (if (vl-catch-all-error-p ok)
        (progn
          (princ (strcat "\n[DT] Load fail: " fullpath))
          nil)
        T))
    (progn
      (princ (strcat "\n[DT] Missing: " fullpath))
      nil)))

(defun dp:resolve-draw-dir (/ self selfdir root srcdraw devdraw uprofile oneDriveSrc oneDriveDev)
  (setq self (findfile "Duct Path.lsp"))
  (if (not self)
    (setq self (findfile "Draw/Duct Path.lsp")))

  (if self
    (setq selfdir (dp:dir-of self))
    (setq selfdir (dp:norm-slash (strcat (getvar "DWGPREFIX") "Draw/"))))

  (setq root (dp:drop-suffix selfdir "src/Draw/"))
  (setq root (dp:drop-suffix root "dev/Draw/"))
  (setq srcdraw (strcat root "src/Draw/"))
  (setq devdraw (strcat root "dev/Draw/"))

  (setq uprofile (getenv "USERPROFILE"))
  (if (not uprofile) (setq uprofile "C:/Users/Public"))
  (setq uprofile (dp:norm-slash uprofile))
  (setq oneDriveSrc (strcat uprofile "/OneDrive/Máy tính/GEMINI CODE/TBH Tool Kit/src/Draw/"))
  (setq oneDriveDev (strcat uprofile "/OneDrive/Máy tính/GEMINI CODE/TBH Tool Kit/dev/Draw/"))

  (cond
    ((dp:valid-draw-dir selfdir) selfdir)
    ((dp:valid-draw-dir *DP:DrawDir*) *DP:DrawDir*)
    ((dp:valid-draw-dir oneDriveDev) oneDriveDev)
    ((dp:valid-draw-dir oneDriveSrc) oneDriveSrc)
    ((dp:valid-draw-dir devdraw) devdraw)
    ((dp:valid-draw-dir srcdraw) srcdraw)
    ((findfile "Duct Type Setting.lsp") (dp:dir-of (findfile "Duct Type Setting.lsp")))
    (T selfdir)))

(defun dp:load-deps (/ drawDir)
  (setq drawDir (dp:resolve-draw-dir)
        *DP:DrawDir* drawDir)

  (princ (strcat "\n[DT] Draw dir: " drawDir)))

;; --- INLINED TOUCH CHECK CORE (former Path Touch Check.lsp) ----------------
(if (not (boundp '*DTC:Eps*))
  (setq *DTC:Eps* 1e-3))

(if (not (boundp '*DTC:DimEps*))
  (setq *DTC:DimEps* 1e-2))

(if (not (boundp '*DTC:Near*))
  (setq *DTC:Near* 2.0))

(defun dtc:dbg (msg)
  (if *DP:Debug*
    (princ (strcat "\n[DTC-DBG] " msg))))

(defun dtc:split (s d / p r)
  (setq r nil)
  (while (setq p (vl-string-search d s))
    (setq r (append r (list (substr s 1 p)))
          s (substr s (+ p (strlen d) 1))))
  (append r (list s)))

(defun dtc:is-pt (v)
  (and (listp v)
       (or (= (length v) 2) (= (length v) 3))
       (numberp (car v))
       (numberp (cadr v))))

(defun dtc:pt3d (v)
  (if (dtc:is-pt v)
    (list (car v) (cadr v) (if (= (length v) 3) (caddr v) 0.0))
    nil))

(defun dtc:fmt-num (x)
  (rtos (if x x 0.0) 2 2))

(defun dtc:fmt-pt (p)
  (if (dtc:is-pt p)
    (strcat "(" (dtc:fmt-num (car p)) ", " (dtc:fmt-num (cadr p)) ")")
    "(invalid)"))

(defun dtc:ins-token-to-index (tok)
  (cond
    ((= tok "INT25") 1)
    ((= tok "INT50") 2)
    ((= tok "INT75") 3)
    ((= tok "INT100") 4)
    ((= tok "EXT25") 5)
    ((= tok "EXT50") 6)
    ((= tok "EXT75") 7)
    (T 0)))

(defun dtc:flexconn-p (en bn / ed lay)
  (setq ed (if en (entget en) nil)
        lay (if ed (cdr (assoc 8 ed)) ""))
  (or (wcmatch (strcase (vl-princ-to-string bn)) "FLEXCONN*")
      (= (strcase (vl-princ-to-string lay)) "HVAC-FLEXCONN")))

(defun dtc:flexconn-size (en / obj atts att tag val pos w h extIns intIns)
  ;; FlexConn SIZE is the connection size plus 5 mm on each dimension.
  (setq obj (vl-catch-all-apply 'vlax-ename->vla-object (list en))
        w nil
        h nil
        extIns 0.0
        intIns 0.0)
  (if (not (vl-catch-all-error-p obj))
    (progn
      (setq atts (vl-catch-all-apply 'vlax-invoke (list obj 'GetAttributes)))
      (if (not (vl-catch-all-error-p atts))
        (foreach att atts
           (setq tag (strcase (vl-princ-to-string (vla-get-TagString att)))
                 val (vl-princ-to-string (vla-get-TextString att)))
           (cond
             ((= tag "SIZE")
              (setq pos (vl-string-search "X" (strcase val)))
              (if pos
                (setq w (- (atof (substr val 1 pos)) 5.0)
                      h (- (atof (substr val (+ pos 2))) 5.0))))
             ((= tag "EXTINSU")
              (setq extIns (atof val)))
             ((= tag "INTINSU")
              (setq intIns (atof val))))))))
  (if (and (numberp w) (numberp h) (> w 0.0) (> h 0.0))
    (list w h (max 0.0 extIns) (max 0.0 intIns))
    nil))

(defun dtc:find-ins-token (parts / p u out)
  (setq p (reverse parts)
        out "")
  (while p
    (setq u (strcase (car p)))
    (if (or (wcmatch u "INT*") (wcmatch u "EXT*"))
      (progn
        (setq out u)
        (setq p nil))
      (setq p (cdr p))))
  out)

(defun dtc:parse-duct-block-name (bn / u ps typ rawTyp insTok l w d)
  (setq u (strcase bn))
  (cond
    ((wcmatch u "DT*")
      (setq ps (dtc:split bn "-"))
      (if (>= (length ps) 3)
        (progn
          (setq rawTyp (nth 1 ps)
                typ (vl-string-subst "" "_ECR" (vl-string-subst "" "_ECL" rawTyp))
                insTok (dtc:find-ins-token ps)
                ps (dtc:split (nth 2 ps) "x"))
          (if (>= (length ps) 2)
            (progn
              (setq l (atof (nth 0 ps))
                    w (atof (nth 1 ps)))
              (if (and (> l 0.0) (> w 0.0))
                (list "DT" typ l w nil insTok (dtc:ins-token-to-index insTok))
                nil))
            nil))
        nil))

    ((wcmatch u "RDV2-*-*L-D*")
      (setq ps (dtc:split bn "-"))
      (if (>= (length ps) 4)
        (progn
          (setq rawTyp (nth 1 ps)
                typ (vl-string-subst "" "_ECR" (vl-string-subst "" "_ECL" rawTyp))
                insTok (dtc:find-ins-token ps)
                l (atof (vl-string-subst "" "L" (nth 2 ps)))
                d (atof (vl-string-subst "" "D" (nth 3 ps))))
          (if (and (> l 0.0) (> d 0.0))
            (list "RD" typ l nil d insTok (dtc:ins-token-to-index insTok))
            nil))
        nil))

    (T nil)))

(defun dtc:parse-flexconn (en bn / size)
  (if (and (dtc:flexconn-p en bn)
           (setq size (dtc:flexconn-size en)))
    (list "FC" "FC" (car size) (cadr size) nil "" 0
          (list "EXTINSU" (nth 2 size))
          (list "INTINSU" (nth 3 size)))
    nil))

(defun dtc:dist2d (a b)
  (distance (list (car a) (cadr a) 0.0)
            (list (car b) (cadr b) 0.0)))

(defun dtc:seg-len (a b)
  (dtc:dist2d a b))

(defun dtc:seg-ang (a b)
  (if (and (dtc:is-pt a) (dtc:is-pt b))
    (angle a b)
    nil))

(defun dtc:ang-diff-abs (a b / d)
  ;; Smallest absolute angular difference in [0, PI/2], ignoring direction.
  (setq d (abs (- a b)))
  (while (> d pi)
    (setq d (abs (- d (* 2.0 pi)))))
  (if (> d (* 0.5 pi))
    (- pi d)
    d))

(defun dtc:point-on-seg-p (p a b / dAB dAP dPB)
  (setq dAB (dtc:dist2d a b)
        dAP (dtc:dist2d a p)
        dPB (dtc:dist2d p b))
  (<= (abs (- (+ dAP dPB) dAB)) *DTC:Eps*))

(defun dtc:point-seg-dist2d (p a b / apx apy abx aby ab2 u qx qy)
  (setq apx (- (car p) (car a))
        apy (- (cadr p) (cadr a))
        abx (- (car b) (car a))
        aby (- (cadr b) (cadr a))
        ab2 (+ (* abx abx) (* aby aby)))
  (if (<= ab2 1e-12)
    (dtc:dist2d p a)
    (progn
      (setq u (/ (+ (* apx abx) (* apy aby)) ab2))
      (if (< u 0.0) (setq u 0.0))
      (if (> u 1.0) (setq u 1.0))
      (setq qx (+ (car a) (* u abx))
            qy (+ (cadr a) (* u aby)))
      (dtc:dist2d p (list qx qy 0.0)))))

(defun dtc:point-near-seg-p (p a b tol)
  (<= (dtc:point-seg-dist2d p a b) tol))

(defun dtc:xf-local (lp ip ang sx sy / x y c s)
  (setq x (* (car lp) sx)
        y (* (cadr lp) sy)
        c (cos ang)
        s (sin ang))
  (list (+ (car ip) (* x c) (- (* y s)))
        (+ (cadr ip) (* x s) (* y c))
        0.0))

(defun dtc:block-line-segs (en / ed bn btr e et ip ang sx sy segs p1 p2 d pts it closed i pA pB v vdata vpt)
  (setq ed (entget en)
        bn (cdr (assoc 2 ed))
        ip (cdr (assoc 10 ed))
        ang (if (assoc 50 ed) (cdr (assoc 50 ed)) 0.0)
        sx (if (assoc 41 ed) (cdr (assoc 41 ed)) 1.0)
        sy (if (assoc 42 ed) (cdr (assoc 42 ed)) 1.0)
        segs nil)
  (if (or (null bn) (not (dtc:is-pt ip)))
    nil
    (progn
      (setq ip (dtc:pt3d ip)
            btr (tblobjname "BLOCK" bn)
            e (if btr (entnext btr) nil))
      (while e
        (setq d (entget e)
              et (cdr (assoc 0 d)))
        (cond
          ((= et "ENDBLK") (setq e nil))

          ((= et "LINE")
            (setq p1 (cdr (assoc 10 d))
                  p2 (cdr (assoc 11 d)))
            (if (and (dtc:is-pt p1) (dtc:is-pt p2))
              (progn
                (setq pA (dtc:xf-local (dtc:pt3d p1) ip ang sx sy)
                      pB (dtc:xf-local (dtc:pt3d p2) ip ang sx sy))
                (setq segs (cons (list pA pB (dtc:seg-len pA pB)) segs))))
            (setq e (entnext e)))

          ((= et "LWPOLYLINE")
            (setq pts nil)
            (foreach it d
              (if (and (listp it) (= (car it) 10) (dtc:is-pt (cdr it)))
                (setq pts (append pts (list (dtc:pt3d (cdr it)))))))
            (setq closed (/= 0 (logand 1 (if (assoc 70 d) (cdr (assoc 70 d)) 0))))
            (if (>= (length pts) 2)
              (progn
                (setq i 0)
                (while (< i (1- (length pts)))
                  (setq pA (dtc:xf-local (nth i pts) ip ang sx sy)
                        pB (dtc:xf-local (nth (1+ i) pts) ip ang sx sy))
                  (setq segs (cons (list pA pB (dtc:seg-len pA pB)) segs))
                  (setq i (1+ i)))
                (if closed
                  (progn
                    (setq pA (dtc:xf-local (nth (1- (length pts)) pts) ip ang sx sy)
                          pB (dtc:xf-local (nth 0 pts) ip ang sx sy))
                    (setq segs (cons (list pA pB (dtc:seg-len pA pB)) segs))))))
            (setq e (entnext e)))

          ((= et "POLYLINE")
            (setq pts nil
                  v (entnext e))
            (while v
              (setq vdata (entget v))
              (if (= (cdr (assoc 0 vdata)) "VERTEX")
                (progn
                  (setq vpt (cdr (assoc 10 vdata)))
                  (if (dtc:is-pt vpt)
                    (setq pts (append pts (list (dtc:pt3d vpt))))))
                (if (= (cdr (assoc 0 vdata)) "SEQEND")
                  (setq v nil)))
              (if v (setq v (entnext v))))

            (setq closed (/= 0 (logand 1 (if (assoc 70 d) (cdr (assoc 70 d)) 0))))
            (if (>= (length pts) 2)
              (progn
                (setq i 0)
                (while (< i (1- (length pts)))
                  (setq pA (dtc:xf-local (nth i pts) ip ang sx sy)
                        pB (dtc:xf-local (nth (1+ i) pts) ip ang sx sy))
                  (setq segs (cons (list pA pB (dtc:seg-len pA pB)) segs))
                  (setq i (1+ i)))
                (if closed
                  (progn
                    (setq pA (dtc:xf-local (nth (1- (length pts)) pts) ip ang sx sy)
                          pB (dtc:xf-local (nth 0 pts) ip ang sx sy))
                    (setq segs (cons (list pA pB (dtc:seg-len pA pB)) segs))))))
            (setq e (entnext e)))

          (T
            (setq e (entnext e)))))
      segs)))

(defun dtc:contact-kind (edgeLen info segAng axisAng / fam L W D dL dW dD tol aDiff tolAng)
  (setq fam (nth 0 info)
        tolAng (/ pi 12.0))
  (setq L (nth 2 info)
        W (nth 3 info)
        D (nth 4 info))
  (if (= fam "FC")
    "HEAD"
    (if (or (null L) (<= L 0.0))
      "UNKNOWN"
      (progn
      ;; Round duct: prefer geometric orientation first.
      (if (and (= fam "RD") (numberp segAng) (numberp axisAng))
        (progn
          (setq aDiff (dtc:ang-diff-abs segAng axisAng))
          (cond
            ;; Edge parallel to duct axis -> side wall.
            ((<= aDiff tolAng) "SIDE")
            ;; Edge perpendicular to duct axis -> head face.
            ((<= (abs (- aDiff (* 0.5 pi))) tolAng) "HEAD")
            (T
              ;; Ambiguous angle, fallback to dimension-based classification.
              (setq dL (abs (- edgeLen L))
                    dW (if (and W (> W 0.0)) (abs (- edgeLen W)) 1e99)
                    dD (if (and D (> D 0.0)) (abs (- edgeLen D)) 1e99)
                    tol (max *DTC:DimEps* (* 0.01 (max L (if W W 0.0) (if D D 0.0)))))
              (cond
                ((and (<= dL dW) (<= dL dD) (<= dL tol)) "SIDE")
                ((and (<= dW dL) (<= dW dD) (<= dW tol)) "HEAD")
                ((and (<= dD dL) (<= dD dW) (<= dD tol)) "HEAD")
                ((and (<= dL dW) (<= dL dD)) "SIDE")
                ((<= dW dD) "HEAD")
                (T "HEAD")))))
        (progn
          ;; Non-round: dimension-based classification.
          (setq dL (abs (- edgeLen L))
                dW (if (and W (> W 0.0)) (abs (- edgeLen W)) 1e99)
                dD (if (and D (> D 0.0)) (abs (- edgeLen D)) 1e99)
                tol (max *DTC:DimEps* (* 0.01 (max L (if W W 0.0) (if D D 0.0)))))
          (cond
            ((and (<= dL dW) (<= dL dD) (<= dL tol)) "SIDE")
            ((and (<= dW dL) (<= dW dD) (<= dW tol)) "HEAD")
            ((and (<= dD dL) (<= dD dW) (<= dD tol)) "HEAD")
            ((and (<= dL dW) (<= dL dD)) "SIDE")
            ((<= dW dD) "HEAD")
             (T "HEAD"))))))))

(defun dtc:check-point-touch (pt / ss i en ed bn info edges e pA pB eLen eAng axisAng kind result bestDist best bestContact tolLocal wd dLine er)
  (setq ss (ssget "_X" '((0 . "INSERT"))))
  (dtc:dbg (strcat "check pt=" (dtc:fmt-pt pt)))
  (if (null ss)
    nil
    (progn
      (setq result nil
            best nil
            bestDist 1e99)
      (dtc:dbg (strcat "insert count=" (itoa (sslength ss))))
      (setq i 0)
      (while (< i (sslength ss))
        (setq en (ssname ss i)
              ed (entget en)
              bn (cdr (assoc 2 ed))
              info (if bn (dtc:parse-duct-block-name bn) nil)
              info (if info info (if bn (dtc:parse-flexconn en bn) nil)))
        (if info
          (progn
            ;; Dynamic tolerance: cover points snapped inside duct body, not only on edge.
            (setq wd (if (numberp (nth 3 info)) (nth 3 info) (nth 4 info))
                  tolLocal (max *DTC:Near* (if (and (numberp wd) (> wd 0.0)) (+ (/ wd 2.0) 2.0) *DTC:Near*)))
            (setq er (vl-catch-all-apply 'dtc:block-line-segs (list en)))
            (if (vl-catch-all-error-p er)
              (progn
                (setq edges nil)
                (dtc:dbg (strcat "skip block=" bn " err=" (vl-catch-all-error-message er))))
              (setq edges er))
            (dtc:dbg (strcat "block=" bn " edges=" (itoa (if (listp edges) (length edges) 0))
                             " tol=" (rtos tolLocal 2 2)))
            (foreach e edges
              (if (and (listp e) (>= (length e) 3))
                (progn
                  (setq pA (nth 0 e)
                        pB (nth 1 e)
                        eLen (nth 2 e))
                  (if (and (dtc:is-pt pA) (dtc:is-pt pB) (numberp eLen))
                    (progn
                      (setq dLine (dtc:point-seg-dist2d pt pA pB))
                      (if (or (dtc:point-on-seg-p pt pA pB)
                              (dtc:point-near-seg-p pt pA pB tolLocal))
                        (progn
                          (setq eAng (dtc:seg-ang pA pB)
                                axisAng (if (assoc 50 ed) (cdr (assoc 50 ed)) 0.0)
                                kind (dtc:contact-kind eLen info eAng axisAng)
                                bestContact (if best (cadr (assoc "CONTACT" best)) ""))
                          (if (or (< dLine bestDist)
                                  ;; Tie-break: with round ducts, keep HEAD when distances are equal.
                                  (and (<= (abs (- dLine bestDist)) *DTC:Eps*)
                                       (= (nth 0 info) "RD")
                                       (= kind "HEAD")
                                       (/= bestContact "HEAD")))
                            (progn
                              (setq bestDist dLine)
                              (setq best (list
                                           (list "ENAME" en)
                                           (list "BLOCK" bn)
                                           (list "FAMILY" (nth 0 info))
                                           (list "TYPE" (nth 1 info))
                                           (list "LENGTH" (nth 2 info))
                                           (list "WIDTH" (nth 3 info))
                                           (list "DIAMETER" (nth 4 info))
                                            (list "INS_TOK" (nth 5 info))
                                            (list "INS_IDX" (nth 6 info))
                                            (if (nth 7 info) (nth 7 info) (list "EXTINSU" 0.0))
                                            (if (nth 8 info) (nth 8 info) (list "INTINSU" 0.0))
                                            (list "EDGE_LEN" eLen)
                                           (list "DIST" dLine)
                                           (list "CONTACT" kind)
                                           (list "P1" pA)
                                           (list "P2" pB))))))))
                    (dtc:dbg (strcat "skip malformed seg in " bn))))))))
        (setq i (1+ i)))
      (setq result best)
      (if result
        (dtc:dbg (strcat "best touch block=" (vl-princ-to-string (dtc:getv "BLOCK" result))
                         " dist=" (rtos (if (numberp (dtc:getv "DIST" result)) (dtc:getv "DIST" result) 0.0) 2 3)))
        (dtc:dbg "no touch found"))
      result)))

(defun dtc:getv (key alist / r)
  (setq r (assoc key alist))
  (if r (cadr r) nil))

;; --- MATH / GEOMETRY --------------------------------------------------------
(defun dp:tan-safe (x)
  (if (not (equal (cos x) 0.0 1e-9))
    (/ (sin x) (cos x))
    0.0))

(defun dp:norm-ang (a)
  (while (> a pi) (setq a (- a (* 2.0 pi))))
  (while (<= a (- pi)) (setq a (+ a (* 2.0 pi))))
  a)

(defun dp:readable-ang (a)
  (setq a (dp:norm-ang a))
  (if (or (> a 1.5708) (<= a -1.5707))
    (dp:norm-ang (+ a pi))
    a))

(defun dp:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa)))
        (+ (cadr ip) (* bx sa) (* by ca))
        0.0))

(defun dp:get-plist (en / pts)
  (setq pts (mapcar 'cdr (vl-remove-if-not '(lambda (x) (= (car x) 10)) (entget en))))
  pts)

(defun dp:get-curve-pts (en / endp i p pts)
  (setq pts '())
  (setq endp (vl-catch-all-apply 'vlax-curve-getEndParam (list en)))
  (if (not (vl-catch-all-error-p endp))
    (progn
      (setq i 0)
      (while (<= i (fix endp))
        (setq p (vl-catch-all-apply 'vlax-curve-getPointAtParam (list en i)))
        (if (not (vl-catch-all-error-p p))
          (setq pts (append pts (list (dp:pt3d p)))))
        (setq i (1+ i)))
      pts)
    nil))

(defun dp:corner-cut (dAng mode elbowType rIn w / cut)
  (if (<= (abs dAng) 0.001)
    0.0
    (progn
      (if (and (= (strcase mode) "RECT")
               (= (strcase elbowType) "E11")
               (equal (abs (/ (* dAng 180.0) pi)) 90.0 0.5))
        (setq cut (+ (/ w 2.0) *DP:E11Throat*))
        (setq cut (+ (* (+ rIn (/ w 2.0)) (abs (dp:tan-safe (/ dAng 2.0)))) *DP:Ext*)))
      cut)))

(defun dp:build-cuts (pts mode elbowType rIn w / i p1 p2 p3 ang1 ang2 dAng cuts)
  (setq i 0
        cuts (list 0.0))
  (while (< i (- (length pts) 1))
    (if (< i (- (length pts) 2))
      (progn
        (setq p1 (nth i pts)
              p2 (nth (1+ i) pts)
              p3 (nth (+ i 2) pts)
              ang1 (angle p1 p2)
              ang2 (angle p2 p3)
              dAng (dp:norm-ang (- ang2 ang1)))
        (setq cuts (append cuts (list (dp:corner-cut dAng mode elbowType rIn w)))))
      (setq cuts (append cuts (list 0.0))))
    (setq i (1+ i)))
  cuts)

(defun dp:add-angle-tag (ip ang txtX txtY txt / wpt tAng)
  (setq wpt (dp:xf txtX txtY ip ang)
        tAng (dp:readable-ang ang))
  (entmake
    (list '(0 . "TEXT") '(100 . "AcDbEntity") '(8 . "Hvacduct-Text") '(62 . 256)
          '(100 . "AcDbText")
          (list 10 (car wpt) (cadr wpt) 0.0)
          '(40 . 100.0) '(41 . 0.8)
          (cons 1 txt)
          '(7 . "HVACS") '(72 . 1) '(73 . 2)
          (list 11 (car wpt) (cadr wpt) 0.0)
          (cons 50 tAng))))

(defun dp:fmt-pt (p)
  (if (dp:is-pt p)
    (strcat "(" (rtos (car p) 2 2) "," (rtos (cadr p) 2 2) ")")
    "(invalid)"))

(defun dp:ang-diff (a b)
  (abs (dp:norm-ang (- a b))))

(defun dp:proj-on-seg (p a b / apx apy abx aby ab2 u qx qy)
  (if (and (dp:is-pt p) (dp:is-pt a) (dp:is-pt b))
    (progn
      (setq apx (- (car p) (car a))
            apy (- (cadr p) (cadr a))
            abx (- (car b) (car a))
            aby (- (cadr b) (cadr a))
            ab2 (+ (* abx abx) (* aby aby)))
      (if (<= ab2 1e-12)
        a
        (progn
          (setq u (/ (+ (* apx abx) (* apy aby)) ab2))
          (if (< u 0.0) (setq u 0.0))
          (if (> u 1.0) (setq u 1.0))
          (setq qx (+ (car a) (* u abx))
                qy (+ (cadr a) (* u aby)))
          (list qx qy 0.0))))
    p))

;; --- SEGMENT / ELBOW GENERATION --------------------------------------------
(defun dp:draw-straight-rect (p1 p2 cut1 cut2 ty ins w h / segAng segLen ss se nAng offP)
  (setq segAng (angle p1 p2)
        segLen (distance p1 p2))
  (if (> segLen (+ cut1 cut2 1.0))
    (progn
      (setq ss (polar p1 segAng cut1)
            se (polar p2 segAng (- cut2))
            nAng (+ segAng (* 0.5 pi))
            offP (polar ss nAng (/ w 2.0)))
      (dt:draw ty offP segAng (distance ss se) w h ins))))

(defun dp:draw-straight-round (p1 p2 cut1 cut2 ty ins d / segAng segLen ss se)
  (setq segAng (angle p1 p2)
        segLen (distance p1 p2))
  (if (> segLen (+ cut1 cut2 1.0))
    (progn
      (setq ss (polar p1 segAng cut1)
            se (polar p2 segAng (- cut2)))
      (rd:draw ty ss segAng (distance ss se) d ins))))

(defun dp:insert-rect-elbow (p1 p2 p3 ty ins prf w h rIn elbowType / ang1 ang2 dAng turn cut2 cp Adeg Arad Rm bn nAng offP hand ipIns rot faceA faceB e11T e11W2 cp2 elbCtr)
  (setq ang1 (angle p1 p2)
        ang2 (angle p2 p3)
        dAng (dp:norm-ang (- ang2 ang1)))
  (if (> (abs dAng) 0.001)
    (progn
      (setq turn (if (> dAng 0.0) "Left" "Right")
            cut2 (dp:corner-cut dAng "RECT" elbowType rIn w)
            cp (polar p2 ang1 (- cut2))
            Adeg (abs (/ (* dAng 180.0) pi))
            Arad (abs dAng)
            Rm (+ rIn (/ w 2.0)))

      (if (and (= (strcase elbowType) "E11") (equal Adeg 90.0 0.5))
        (progn
          (setq hand turn
                e11W2 w)
              (setq e11T *DP:E11Throat*
                ;; E11 name should use E11 width pair (w1 x w2), not duct size (w x h).
                bn (strcat "E11-" ty "-" (rtos w 2 0) "x" (rtos e11W2 2 0) "-" hand
                           (if (= prf "") "" (strcat "-" prf))
                           "-T" (rtos e11T 2 0) "x" (rtos e11T 2 0)
                           (cond
                             ((dp:sym-exists-p 'e11:rand-sfx) (e11:rand-sfx))
                             (T (dp:rand-sfx)))))
          (if (not (tblsearch "BLOCK" bn))
            (e11:make-block bn ty w w e11T e11T hand))
              ;; Use midpoint of duct end-face as insertion point (head center).
              (setq nAng  (+ ang1 (* 0.5 pi))
                faceA (polar cp nAng (/ w 2.0))
                faceB (polar cp nAng (- (/ w 2.0)))
                rot   (- ang1 (* 0.5 pi))
                ipIns (dp:mid-pt faceA faceB))
          (entmake (list '(0 . "INSERT")
                         (cons 8 (dp:sys-layer ty))
                         (cons 2 bn)
                         (cons 10 ipIns)
                         (cons 50 rot))))
        (progn
          (setq bn (strcat "E1v9-" ty "-" (rtos w 2 0) "x" (rtos h 2 0)
                           "-R" (rtos rIn 2 0)
                           "-A" (rtos Adeg 2 1)
                           "-" turn
                           (if (= prf "") "" (strcat "-" prf))
                           (cond
                             ((dp:sym-exists-p 'e1:rand-sfx) (e1:rand-sfx))
                             ((dp:sym-exists-p 'dt:rand-sfx) (dt:rand-sfx))
                             (T (dp:rand-sfx)))))
          (if (not (tblsearch "BLOCK" bn))
            (e1:make-block bn ty w h rIn Adeg turn ins))

          (setq nAng (+ ang1 (* 0.5 pi))
                offP (polar cp nAng (/ w 2.0)))
          (entmake (list '(0 . "INSERT")
                         (cons 8 (dp:sys-layer ty))
                         (cons 2 bn)
                         (cons 10 offP)
                         (cons 50 ang1)))

          ;; Tag at centerline midpoint of elbow (between cp and cp2)
          (if (not (equal Adeg 90.0 0.1))
            (progn
              (setq cp2    (polar p2 ang2 (dp:corner-cut dAng "RECT" elbowType rIn w))
                    elbCtr (list (/ (+ (car cp) (car cp2)) 2.0)
                                 (/ (+ (cadr cp) (cadr cp2)) 2.0)
                                 0.0))
              (dp:add-angle-tag elbCtr
                                (+ ang1 (if (= turn "Right") (- (/ Arad 2.0)) (/ Arad 2.0)))
                                0.0 0.0
                                (strcat (rtos Adeg 2 0) "%%D")))))))))

(defun dp:insert-round-elbow (p1 p2 p3 ty ins prf d rIn / ang1 ang2 dAng turn cut2 cp Adeg Arad Rm bn cp2 elbCtr)
  (setq ang1 (angle p1 p2)
        ang2 (angle p2 p3)
        dAng (dp:norm-ang (- ang2 ang1)))
  (if (> (abs dAng) 0.001)
    (progn
      (setq turn (if (> dAng 0.0) "Left" "Right")
            cut2 (dp:corner-cut dAng "ROUND" "E2" rIn d)
            cp (polar p2 ang1 (- cut2))
            Adeg (abs (/ (* dAng 180.0) pi))
            Arad (abs dAng)
            Rm (+ rIn (/ d 2.0)))

      (setq bn (strcat "E2v2-" ty "-D" (rtos d 2 0)
                       "-R" (rtos rIn 2 0)
                       "-A" (rtos Adeg 2 1)
                       "-" turn
                       (if (= prf "") "" (strcat "-" prf))
                       (cond
                         ((dp:sym-exists-p 'e2:rand-sfx) (e2:rand-sfx))
                         ((dp:sym-exists-p 'rd:rand-sfx) (rd:rand-sfx))
                         (T (dp:rand-sfx)))))
      (if (not (tblsearch "BLOCK" bn))
        (e2:make-block bn ty d rIn Adeg turn ins))

      (entmake (list '(0 . "INSERT")
                     (cons 8 (dp:sys-layer ty))
                     (cons 2 bn)
                     (cons 10 cp)
                     (cons 50 ang1)))

      ;; Tag at centerline midpoint of elbow (between cp and cp2)
      (if (not (equal Adeg 90.0 0.1))
        (progn
          (setq cp2    (polar p2 ang2 (dp:corner-cut dAng "ROUND" "E2" rIn d))
                elbCtr (list (/ (+ (car cp) (car cp2)) 2.0)
                             (/ (+ (cadr cp) (cadr cp2)) 2.0)
                             0.0))
          (dp:add-angle-tag elbCtr
                            (+ ang1 (if (= turn "Right") (- (/ Arad 2.0)) (/ Arad 2.0)))
                            0.0 0.0
                            (strcat (rtos Adeg 2 0) "%%D")))))))

(defun dp:generate (pts mode rIn w h d ty ins prf / i p1 p2 p3 cut1 cut2 cuts segLen drawLen nSeg)
  (if (< (length pts) 2)
    (princ "\n[DT] Path requires at least 2 points.")
    (progn
      (setq cuts (dp:build-cuts pts mode *DP:ElbowType* rIn w))
      (dp:dbg (strcat "generate mode=" mode
                      " pts=" (itoa (length pts))
                      " cuts=" (vl-princ-to-string cuts)))

      (setq i 0)
      (setq drawLen 0.0
            nSeg 0)
      (while (< i (- (length pts) 1))
        (setq p1 (nth i pts)
              p2 (nth (1+ i) pts)
              cut1 (nth i cuts)
              cut2 (nth (1+ i) cuts))

        (setq segLen (distance p1 p2))
        (dp:dbg (strcat "seg#" (itoa (1+ i))
                        " p1=" (dp:fmt-pt p1)
                        " p2=" (dp:fmt-pt p2)
                        " len=" (rtos segLen 2 2)
                        " cut1=" (rtos cut1 2 2)
                        " cut2=" (rtos cut2 2 2)))

        (if (> segLen (+ cut1 cut2 1.0))
          (progn
            (setq drawLen (+ drawLen (- segLen cut1 cut2))
                  nSeg (1+ nSeg))
            (dp:dbg (strcat "seg#" (itoa (1+ i))
                            " drawable=" (rtos (- segLen cut1 cut2) 2 2)))
          )
          (dp:dbg (strcat "seg#" (itoa (1+ i)) " skipped: too short after cuts")))

        (if (= (strcase mode) "RECT")
          (dp:draw-straight-rect p1 p2 cut1 cut2 ty ins w h)
          (dp:draw-straight-round p1 p2 cut1 cut2 ty ins d))

        (if (< i (- (length pts) 2))
          (progn
            (setq p3 (nth (+ i 2) pts))
            (if (= (strcase mode) "RECT")
              (dp:insert-rect-elbow p1 p2 p3 ty ins prf w h rIn *DP:ElbowType*)
              (dp:insert-round-elbow p1 p2 p3 ty ins prf d rIn))))

        (setq i (1+ i)))

      (dp:dbg (strcat "generate summary drawableSegs=" (itoa nSeg)
                      " drawableLen=" (rtos drawLen 2 2)))

      (princ (strcat "\n[DT] Done generating " mode " path.")))))

;; --- PATH INPUT --------------------------------------------------------------
(defun dp:cleanup-ents (ens)
  (foreach en ens
    (if (and en (entget en)) (entdel en))))

(defun dp:get-path-by-select (/ sel en ed pts)
  (princ "\nSelect centerline polyline: ")
  (setq sel (entsel))
  (if sel
    (progn
      (setq en (car sel)
            ed (entget en))
      (if (= (cdr (assoc 0 ed)) "LWPOLYLINE")
        (progn
          (setq pts (dp:get-curve-pts en))
          (if (or (not pts) (< (length pts) 2))
            (setq pts (mapcar 'dp:pt3d (dp:get-plist en))))
          (dp:dbg (strcat "select pts=" (vl-princ-to-string pts)))
          (list pts en '()))
        (progn
          (princ "\n[DT] Selected object is not LWPOLYLINE.")
          nil)))
    nil))

(defun dp:get-path-by-draw (/ p1 p2 curP pts tempLines done)
  (setq pts '()
        tempLines '())
  (setq p1 (dp:pt3d (getpoint "\nFirst point: ")))
  (if (dp:is-pt p1)
    (progn
      (setq pts (list p1)
            curP p1)
      (setq done nil)
      (while (not done)
        (setq p2 (getpoint curP "\nNext point (Enter to finish): "))
        (setq p2 (dp:pt3d p2))
        (cond
          ((null p2)
            (setq done T))
          ((dp:is-pt p2)
            (entmake (list '(0 . "LINE") (cons 10 curP) (cons 11 p2) '(62 . 8)))
            (setq tempLines (append tempLines (list (entlast))))
            (setq pts (append pts (list p2))
                  curP p2))
          (T
            (dp:dbg (strcat "Invalid point value in draw mode: " (vl-princ-to-string p2)))
            (princ "\n[DT] Invalid point input. Please click a point."))))
      (list pts nil tempLines))
    nil))

;; --- CONNECTION HELPERS (MAIN EXTEND / BRANCH) -----------------------------
(defun dp:last-pt (pts)
  (if (and pts (> (length pts) 0)) (car (last pts)) nil))

(defun dp:pt-at (pts idx)
  (if (and (listp pts) (>= idx 0) (< idx (length pts)))
    (nth idx pts)
    nil))

(defun dp:replace-first (pts val)
  (if (and pts val)
    (cons val (cdr pts))
    pts))

(defun dp:replace-last (pts val / r)
  (if (and pts val)
    (progn
      (setq r (reverse pts))
      (reverse (cons val (cdr r))))
    pts))

(defun dp:rep-get (key rep / r)
  (if (and (dp:sym-exists-p 'dtc:getv) rep)
    (dtc:getv key rep)
    (progn
      (setq r (assoc key rep))
      (if r (cadr r) nil))))

(defun dp:safe-touch-check (pt / r)
  (if *DP:Debug*
    (princ (strcat "\n[DT-DBG] safe-touch-check pt=" (vl-princ-to-string pt))))
  (setq r (vl-catch-all-apply 'dtc:check-point-touch (list pt)))
  (if (vl-catch-all-error-p r)
    (progn
      (princ (strcat "\n[DT] touch-check error: " (vl-catch-all-error-message r)))
      nil)
    r))

(defun dp:valid-sys-p (s / u)
  (setq u (strcase (vl-princ-to-string s)))
  (or (= u "SA") (= u "RA") (= u "EA") (= u "OA") (= u "TA")))

(defun dp:valid-ins-p (v)
  (and (numberp v) (>= v 0) (<= v 7)))

(defun dp:flexconn-report-p (rep)
  (= (strcase (vl-princ-to-string (dp:rep-get "FAMILY" rep))) "FC"))

(defun dp:flexconn-insul-index (extIns intIns / thick in)
  ;; Internal insulation controls the virtual connection size. If both values
  ;; exist, internal insulation takes precedence for the duct representation.
  (setq in (> intIns 0.0)
        thick (if in intIns extIns))
  (cond
    ((and in (dp:eq-num thick 25.0 0.01)) 1)
    ((and in (dp:eq-num thick 50.0 0.01)) 2)
    ((and in (dp:eq-num thick 75.0 0.01)) 3)
    ((and in (dp:eq-num thick 100.0 0.01)) 4)
    ((and (not in) (dp:eq-num thick 25.0 0.01)) 5)
    ((and (not in) (dp:eq-num thick 50.0 0.01)) 6)
    ((and (not in) (dp:eq-num thick 75.0 0.01)) 7)
    (T 0)))

(defun dp:flexconn-size-with-insul (rep / size extIns intIns)
  ;; EXTINSU is outside the duct and must not change the transition host size.
  ;; INTINSU is inside the duct, therefore it adds twice its thickness.
  (setq size (list (dp:rep-get "LENGTH" rep) (dp:rep-get "WIDTH" rep))
        extIns (dp:rep-get "EXTINSU" rep)
        intIns (dp:rep-get "INTINSU" rep))
  (if (not (numberp extIns)) (setq extIns 0.0))
  (if (not (numberp intIns)) (setq intIns 0.0))
  (if (and (numberp (car size)) (numberp (cadr size)))
    (list (+ (car size) (* 2.0 intIns))
          (+ (cadr size) (* 2.0 intIns))
          (dp:flexconn-insul-index extIns intIns))
    nil))

(defun dp:touch-rep-usable-p (rep / c)
  (setq c (strcase (vl-princ-to-string (dp:rep-get "CONTACT" rep))))
  (and rep (or (= c "HEAD") (= c "SIDE"))))

(defun dp:inherit-ty-ins-from-touch (repS repE defTy defIns / src rep ty ins)
  ;; Prefer PS host metadata; fallback to PE when PS is not touch/usable.
  (setq src "DTS"
        rep nil
        ty defTy
        ins defIns)

  (cond
    ((dp:touch-rep-usable-p repS)
      (setq rep repS src "PS"))
    ((dp:touch-rep-usable-p repE)
      (setq rep repE src "PE")))

  (if rep
    (progn
      (if (dp:valid-sys-p (dp:rep-get "TYPE" rep))
        (setq ty (strcase (vl-princ-to-string (dp:rep-get "TYPE" rep)))))
      (if (dp:valid-ins-p (dp:rep-get "INS_IDX" rep))
        (setq ins (fix (dp:rep-get "INS_IDX" rep))))))

  (list ty ins src))

(defun dp:safe-angle (p1 p2)
  (if (and (dp:is-pt p1) (dp:is-pt p2))
    (angle p1 p2)
    nil))

(defun dp:safe-offset-point (basePt dir dist)
  (if (and (dp:is-pt basePt) (numberp dir) (numberp dist))
    (polar basePt dir dist)
    nil))

(defun dp:eq-num (a b tol)
  (and (numberp a) (numberp b) (<= (abs (- a b)) tol)))

(defun dp:mid-pt (p1 p2)
  (if (and (dp:is-pt p1) (dp:is-pt p2))
    (list (/ (+ (car p1) (car p2)) 2.0)
          (/ (+ (cadr p1) (cadr p2)) 2.0)
          0.0)
    nil))

(defun dp:oy-from-report (ip dir rep / p1 p2 pc ny nx dx dy)
  ;; oy is local Y offset at end face center. Non-zero oy => UNEQ/SL-ET tags.
  (setq p1 (dp:rep-get "P1" rep)
        p2 (dp:rep-get "P2" rep)
        pc (dp:mid-pt p1 p2))
  (if (and (dp:is-pt ip) (numberp dir) (dp:is-pt pc))
    (progn
      (setq nx (cos (+ dir (* 0.5 pi)))
            ny (sin (+ dir (* 0.5 pi)))
            dx (- (car ip) (car pc))
            dy (- (cadr ip) (cadr pc)))
      (+ (* dx nx) (* dy ny)))
    0.0))

(defun dp:insert-ip-from-report (fallbackIp rep / p1 p2 pc)
  ;; Insert fittings at head-face center, not at clash pick point.
  (setq p1 (dp:rep-get "P1" rep)
        p2 (dp:rep-get "P2" rep)
        pc (dp:mid-pt p1 p2))
  (if (dp:is-pt pc) pc fallbackIp))

(defun dp:ask-main-conn-len (/ v)
  (initget 6)
  (setq v (getreal (strcat "\nFitting length L <" (rtos *DP:MainConnLen* 2 0) ">: ")))
  (if v (setq *DP:MainConnLen* v))
  *DP:MainConnLen*)

(defun dp:ask-side-conn-type (/ kw)
  (initget "Boot Tap")
  (setq kw (getkword (strcat "\nSide touch connector [Boot/Tap] <" *DP:SideConnType* ">: ")))
  (if kw
    (setq *DP:SideConnType* kw))
  *DP:SideConnType*)

(defun dp:contact-side-p (rep / c)
  (setq c (strcase (vl-princ-to-string (dp:rep-get "CONTACT" rep))))
  (= c "SIDE"))

(defun dp:prompt-side-conn-if-needed (repS repE)
  ;; Ask immediately after PS/PE touch-check if any endpoint touches SIDE.
  (if (and (not *DP:SideConnAsked*)
           (or (dp:contact-side-p repS) (dp:contact-side-p repE)))
    (progn
      (dp:ask-side-conn-type)
      (setq *DP:SideConnAsked* T))))

(defun dp:erase-insert-attribs (ins / e ed)
  (if ins
    (progn
      (setq e (entnext ins))
      (while e
        (setq ed (entget e))
        (if (= (cdr (assoc 0 ed)) "SEQEND")
          (setq e nil)
          (progn
            (if (= (cdr (assoc 0 ed)) "ATTRIB") (entdel e))
            (setq e (entnext e))))))))

(defun dp:insert-no-tag-tap (mode ty ins w h d ip dir / l bn lay ipIns insEnt)
  (setq l *DP:TapLen*)
  (dp:dbg (strcat "tap begin mode=" mode
                  " ty=" (vl-princ-to-string ty)
                  " ins=" (itoa (fix ins))
                  " ip=" (dp:fmt-pt ip)
                  " dir=" (rtos (* 180.0 (/ dir pi)) 2 2)
                  " L=" (rtos l 2 0)))
  (if (= (strcase mode) "RECT")
    (progn
      (setq bn (strcat "DPTAP-RECT-" ty "-" (rtos w 2 0) "x" (rtos h 2 0) "-L" (rtos l 2 0)
                       (if (dp:sym-exists-p 'dt:rand-sfx) (dt:rand-sfx) "")))
      (dp:dbg (strcat "tap rect bn=" bn))
      (if (not (tblsearch "BLOCK" bn))
        (dt:make-block bn ty l w h ins 0))
      (setq lay (if (dp:sym-exists-p 'dt:lo) (dt:lo ty) (dp:sys-layer ty))
            ipIns (polar ip (+ dir (* 0.5 pi)) (/ w 2.0))
            insEnt (entmakex (list '(0 . "INSERT") (cons 8 lay) (cons 2 bn)
                                 (cons 10 ipIns) (cons 50 dir)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0))))
      (dp:dbg (strcat "tap rect lay=" lay
                      " ipIns=" (dp:fmt-pt ipIns)
                      " insEnt=" (vl-princ-to-string insEnt)))
      (dp:erase-insert-attribs insEnt)
      (if (null insEnt)
        (dp:dbg "tap rect insert failed (insEnt=nil)"))
      T)
    (progn
      (setq bn (strcat "DPTAP-ROUND-" ty "-D" (rtos d 2 0) "-L" (rtos l 2 0)
                       (if (dp:sym-exists-p 'rd:rand-sfx) (rd:rand-sfx) "")))
      (dp:dbg (strcat "tap round bn=" bn))
      (if (not (tblsearch "BLOCK" bn))
        (rd:make-block bn ty l d ins 0))
      (setq lay (if (dp:sym-exists-p 'rd:lo) (rd:lo ty) (dp:sys-layer ty))
            insEnt (entmakex (list '(0 . "INSERT") (cons 8 lay) (cons 2 bn)
                                 (cons 10 ip) (cons 50 dir)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0))))
      (dp:dbg (strcat "tap round lay=" lay
                      " ipIns=" (dp:fmt-pt ip)
                      " insEnt=" (vl-princ-to-string insEnt)))
      (dp:erase-insert-attribs insEnt)
      (if (null insEnt)
        (dp:dbg "tap round insert failed (insEnt=nil)"))
      T)))

(defun dp:boot-adj-point (sp sa bw flip / xMid)
  (setq xMid (- (/ bw 2.0)))
  (if (= flip 1)
    (bt:xf (* 2.0 xMid) 0.0 sp sa)
    sp))

(defun dp:place-boot-with-toggle (bn lay sp sa bw / flip done ok pv ev code key spAdj xsc insEnt)
  (setq flip 0 done nil ok nil pv nil)
  (princ "\n[DT] Boot preview: SPACE=Flip | Click/Enter=Place | ESC=Cancel")
 
  (while (not done)
    (setq spAdj (dp:boot-adj-point sp sa bw flip) xsc (if (= flip 1) -1.0 1.0))
    (if pv (progn (entdel pv) (setq pv nil)))
    (setq pv (vl-catch-all-apply 'bt:safe-ins (list bn spAdj sa nil 1 xsc)))
    (if (vl-catch-all-error-p pv)
      (setq pv nil done T ok nil))
    (if (not done)
      (progn
        (setq ev (grread T 15 0) code (car ev))
        (cond
          ((= code 3) (setq ok T done T))
          ((= code 2)
            (setq key (cadr ev))
            (cond
              ((= key 32) (setq flip (- 1 flip)))
              ((or (= key 13) (= key 10)) (setq ok T done T))
              ((= key 27) (setq ok nil done T))))))))
 
  (if pv (entdel pv))
 
  (if ok
    (progn
      (setq spAdj (dp:boot-adj-point sp sa bw flip) xsc (if (= flip 1) -1.0 1.0)
            insEnt (vl-catch-all-apply 'bt:safe-ins (list bn spAdj sa lay nil xsc)))
      (if (not (vl-catch-all-error-p insEnt))
        insEnt
        nil))
    nil))

(defun dp:add-main-fitting-tags (kind ip dir l sizeA sizeB oy / typeTag lenTag tagBase typeRes)
  ;; Reuse standalone tag behavior (TYPE + LENGTH with preview placement).
  (if (and (dp:is-pt ip) (numberp dir) (numberp l) (> l 0.0))
    (progn
      (setq typeTag
        (cond
          ((= (strcase kind) "T1")
            (if (and (numberp sizeA) (numberp sizeB))
              (t1:type-tag sizeA sizeB oy)
              nil))
          ((= (strcase kind) "T2")
            (if (and (numberp sizeA) (numberp sizeB))
              (t2:type-tag sizeA sizeB oy)
              nil))
          ((= (strcase kind) "R2R")
            (if (and (numberp sizeA) (numberp sizeB))
              (rr:type-tag sizeA sizeB oy)
              nil))
          (T nil)))

      (if (and typeTag (/= (vl-princ-to-string typeTag) ""))
        (progn
          (setq lenTag (strcat (rtos l 2 0) "L")
                tagBase (polar ip dir (/ (max l 200.0) 2.0)))
          (setq typeRes
            (cond
              ((= (strcase kind) "T1")
                (t1:add-text-tag typeTag "HVACS" tagBase 0.0 1 "[DT] Place TYPE tag"))
              ((= (strcase kind) "T2")
                (t2:add-text-tag typeTag "HVACS" tagBase 0.0 1 "[DT] Place TYPE tag"))
              ((= (strcase kind) "R2R")
                (rr:add-text-tag typeTag "HVACS" tagBase 0.0 1 "[DT] Place TYPE tag"))
              (T nil)))

          (if typeRes
            (cond
              ((= (strcase kind) "T1")
                (t1:add-text-tag lenTag "HVACSI" (car typeRes) (cadr typeRes) 1 "[DT] Place LENGTH tag"))
              ((= (strcase kind) "T2")
                (t2:add-text-tag lenTag "HVACSI" (car typeRes) (cadr typeRes) 1 "[DT] Place LENGTH tag"))
              ((= (strcase kind) "R2R")
                (rr:add-text-tag lenTag "HVACSI" (car typeRes) (cadr typeRes) 1 "[DT] Place LENGTH tag")))))))))

(defun dp:insert-t1-main (ty ins wHost hHost wNew hNew ip dir l oy / bn)
  (t1:init ty)
  (setq bn (t1:block-name ty wHost hHost wNew hNew l oy ins nil))
  (if (not (tblsearch "BLOCK" bn))
    (t1:make-block bn ty wHost hHost wNew hNew l oy ins nil))
  (entmake (list '(0 . "INSERT") (cons 8 (t1:safe-layer (t1:lo ty)))
                 (cons 2 bn) (cons 10 ip) (cons 50 dir)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)))
  (dp:add-main-fitting-tags "T1" ip dir l wHost wNew oy)
  T)

(defun dp:insert-t2-main (ty ins dHost dNew ip dir l oy / bn)
  (t2:init ty)
  (setq bn (t2:block-name ty dHost dNew l oy ins nil))
  (if (not (tblsearch "BLOCK" bn))
    (t2:make-block bn ty dHost dNew l oy ins nil))
  (entmake (list '(0 . "INSERT") (cons 8 (t2:safe-layer (t2:lo ty)))
                 (cons 2 bn) (cons 10 ip) (cons 50 dir)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)))
  (dp:add-main-fitting-tags "T2" ip dir l dHost dNew oy)
  T)

(defun dp:insert-r2r-main (ty ins wRect hRect dRound ip dir reverse l oy / bn ipIns)
  (rr:init ty)
  (setq bn (rr:block-name ty wRect hRect dRound l oy ins nil))
  (if (not (tblsearch "BLOCK" bn))
    (rr:make-block bn ty wRect hRect dRound l oy ins nil))
  (setq ipIns (if reverse (polar ip dir (- l)) ip))
  (entmake (list '(0 . "INSERT") (cons 8 (rr:safe-layer (rr:lo ty)))
                 (cons 2 bn) (cons 10 ipIns) (cons 50 dir)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0)))
  (dp:add-main-fitting-tags "R2R" ipIns dir l wRect dRound oy)
  T)

(defun dp:apply-main-connector-by-report (mode ty ins w h d ip dir rep / fam hostW hostH hostD fcSize l oy ipIns)
  (setq fam (strcase (vl-princ-to-string (dp:rep-get "FAMILY" rep))))
  (setq oy (dp:oy-from-report ip dir rep))
  (setq ipIns (dp:insert-ip-from-report ip rep))
  (dp:dbg (strcat "main-conn oy=" (rtos oy 2 2)))
  (dp:dbg (strcat "main-conn insert=" (vl-princ-to-string ipIns)
                  " clash=" (vl-princ-to-string ip)))
  (cond
    ((and (= (strcase mode) "RECT") (= fam "DT"))
      (setq hostW (dp:rep-get "WIDTH" rep))
      (if (and (numberp hostW) (not (dp:eq-num hostW w 1e-3)))
        (progn
          (setq l (dp:ask-main-conn-len))
          (if (dp:insert-t1-main ty ins hostW h w h ipIns dir l oy) l nil))
        nil))

    ((and (= (strcase mode) "ROUND") (= fam "RD"))
      (setq hostD (dp:rep-get "DIAMETER" rep))
      (if (and (numberp hostD) (not (dp:eq-num hostD d 1e-3)))
        (progn
          (setq l (dp:ask-main-conn-len))
          (if (dp:insert-t2-main ty ins hostD d ipIns dir l oy) l nil))
        nil))

    ((and (= (strcase mode) "ROUND") (= fam "DT"))
      (setq hostW (dp:rep-get "WIDTH" rep))
      (if (and (numberp hostW) (> hostW 0.0))
        (progn
          (setq l (dp:ask-main-conn-len))
          (if (dp:insert-r2r-main ty ins hostW d d ipIns dir nil l oy) l nil))
        nil))

    ((and (= (strcase mode) "RECT") (= fam "RD"))
      (setq hostD (dp:rep-get "DIAMETER" rep))
      (if (and (numberp hostD) (> hostD 0.0))
        (progn
          (setq l (dp:ask-main-conn-len))
         (if (dp:insert-r2r-main ty ins w h hostD ipIns dir T l oy) l nil))
        nil))

    ;; FlexConn is the host end of the transition.  The duct dimensions are
    ;; still supplied by the user, so only equal sizes skip the transition.
    ((and (= (strcase mode) "RECT") (= fam "FC"))
      (setq fcSize (dp:flexconn-size-with-insul rep)
            hostW (if fcSize (car fcSize) nil)
            hostH (if fcSize (cadr fcSize) nil))
      (if (and (numberp hostW) (numberp hostH)
               (or (not (dp:eq-num hostW w 1e-3))
                   (not (dp:eq-num hostH h 1e-3))))
        (progn
          (setq l (dp:ask-main-conn-len))
          (if (dp:insert-t1-main ty ins hostW hostH w h ipIns dir l oy) l nil))
        nil))

    ((and (= (strcase mode) "ROUND") (= fam "FC"))
      (setq fcSize (dp:flexconn-size-with-insul rep)
            hostW (if fcSize (car fcSize) nil)
            hostH (if fcSize (cadr fcSize) nil))
      (if (and (numberp hostW) (numberp hostH) (numberp d) (> d 0.0))
        (progn
          (setq l (dp:ask-main-conn-len))
          (if (dp:insert-r2r-main ty ins hostW hostH d ipIns dir nil l oy) l nil))
        nil))

    (T nil)))

(defun dp:apply-branch-connector-by-report (mode ty ins w h d ip dir rep / fam hostShp bw bn pick mkRes insRes tapRes bootReady bootErr insTok lay sfx spBoot saBoot p1 p2 pProj eAng rightAng leftAng topAng botAng sideTop offMag)
  (setq fam (strcase (vl-princ-to-string (dp:rep-get "FAMILY" rep)))
        hostShp (if (= fam "DT") "RECT" "ROUND")
        bw (if (= (strcase mode) "ROUND") d w))

  (setq spBoot ip
        saBoot dir)

  (setq pick (strcase (vl-princ-to-string *DP:SideConnType*)))
  (dp:dbg (strcat "side-conn pick=" pick
                  " mode=" mode
                  " hostFam=" fam
                  " hostShp=" hostShp
                  " bw=" (rtos bw 2 2)
                  " ip=" (dp:fmt-pt ip)
                  " dir=" (rtos (* 180.0 (/ dir pi)) 2 2)))

  (setq bootReady (= pick "BOOT"))

  (if bootReady
    (progn
      (setq bootErr nil)
      (if (not (boundp '*BT:REV*))
        (setq *BT:REV* "R2"))

      (setq insTok (vl-catch-all-apply 'bt:ins-prefix (list ins)))
      (if (vl-catch-all-error-p insTok)
        (progn
          (setq bootErr (vl-catch-all-error-message insTok)
                insTok "")
          (setq bootReady nil)
          (dp:dbg (strcat "boot ins-prefix error=" bootErr))))

      (setq sfx (vl-catch-all-apply 'bt:rand-sfx nil))
      (if (vl-catch-all-error-p sfx)
        (progn
          (setq bootErr (vl-catch-all-error-message sfx)
                sfx "")
          (setq bootReady nil)
          (dp:dbg (strcat "boot rand-sfx error=" bootErr))))

      (setq bn (strcat "BOOT-" *BT:REV* "-" ty "-" (rtos bw 2 0)
                       (if (= insTok "") "" (strcat "-" insTok))
                       "-" hostShp
                       sfx))
      (dp:dbg (strcat "boot bn=" bn))

      (if (and bootReady (not (tblsearch "BLOCK" bn)))
        (progn
          (setq mkRes (vl-catch-all-apply 'bt:make-block (list bn ty bw ins hostShp)))
          (if (vl-catch-all-error-p mkRes)
            (progn
              (setq bootErr (vl-catch-all-error-message mkRes))
              (setq bootReady nil)
              (dp:dbg (strcat "boot make error=" bootErr)))
            (dp:dbg "boot make ok"))))

      ;; Compute boot placement from touched edge (P1/P2) using BD/Boot-style
      ;; local edge sliding: classify top/bottom from branch direction, then
      ;; slide along the edge tangent by W/2 or D/2.
      (if bootReady
        (progn
          (setq p1 (dp:rep-get "P1" rep)
            p2 (dp:rep-get "P2" rep))
          (if (and (dp:is-pt p1) (dp:is-pt p2) (numberp dir))
        (progn
          (setq pProj (dp:proj-on-seg ip p1 p2)
            eAng (angle p1 p2)
            offMag (/ bw 2.0))

          ;; Canonical RIGHT direction of the duct axis by AI convention:
          ;; - horizontal object: Right = +X
          ;; - vertical object:   Right = +Y
          (setq rightAng
            (if (>= (abs (cos eAng)) (abs (sin eAng)))
              (if (>= (cos eAng) 0.0) eAng (dp:norm-ang (+ eAng pi)))
              (if (>= (sin eAng) 0.0) eAng (dp:norm-ang (+ eAng pi)))))
          (setq leftAng (dp:norm-ang (+ rightAng pi))
                topAng  (dp:norm-ang (+ rightAng (* 0.5 pi)))
                botAng  (dp:norm-ang (- rightAng (* 0.5 pi))))

          ;; Top/Bottom comes from branch side relative to the duct axis.
          ;; For horizontal ducts this means screen top/bottom.
          ;; For vertical ducts this means left/right screen side per AI rule.
          (setq sideTop (<= (dp:ang-diff topAng dir) (dp:ang-diff botAng dir)))

          ;; Match Boot.lsp snap behavior:
          ;; top side -> orient to Right tangent, slide Right by bw/2
          ;; bottom side -> orient to Left tangent, slide Left by bw/2
          (setq saBoot (if sideTop rightAng leftAng)
                spBoot (polar pProj saBoot offMag))
          (dp:dbg (strcat "boot edge p1=" (dp:fmt-pt p1)
              " p2=" (dp:fmt-pt p2)
              " proj=" (dp:fmt-pt pProj)
              " eAng=" (rtos (* 180.0 (/ eAng pi)) 2 2)
              " right=" (rtos (* 180.0 (/ rightAng pi)) 2 2)
              " top=" (rtos (* 180.0 (/ topAng pi)) 2 2)
              " sideTop=" (if sideTop "Y" "N")
              " offMag=" (rtos offMag 2 2)
              " sa=" (rtos (* 180.0 (/ saBoot pi)) 2 2)
              " sp=" (dp:fmt-pt spBoot))))
        (dp:dbg "boot edge data invalid -> fallback ip/dir"))))

      (if bootReady
        (progn
          (setq lay (vl-catch-all-apply 'bt:lo (list ty)))
          (if (vl-catch-all-error-p lay)
            (progn
              (setq bootErr (vl-catch-all-error-message lay)
                    lay (dp:sys-layer ty))
              (dp:dbg (strcat "boot layer error=" bootErr ", fallback lay=" lay))))

          (setq insRes (dp:place-boot-with-toggle bn lay spBoot saBoot bw))
          (if insRes
            (dp:dbg (strcat "boot insert ent=" (vl-princ-to-string insRes)))
            (dp:dbg "boot insert cancelled/failed")))
        (setq insRes nil))

      (if insRes
        ;; Boot successfully inserted. Return offset.
        *DP:TapLen*
        (progn
          ;; Boot cancelled/failed. No fallback to tap when user selected Boot.
          (dp:dbg "boot cancelled/failed - no fallback tap")
          nil)))
    (progn
      ;; User explicitly selected Tap. Insert tap directly.
      (setq tapRes (dp:insert-no-tag-tap mode ty ins w h d ip dir))
      (dp:dbg (strcat "tap result=" (vl-princ-to-string tapRes)))
      (if tapRes *DP:TapLen* nil))))

;; --- MAIN COMMAND ------------------------------------------------------------
(defun dp:apply-touch-connectors (workPts mode ty ins w h d repS repE / kindS kindE ofsS ofsE dirStart dirEnd pNew pStart pEnd pNext pPrev)
  (if (dp:valid-pt-list-p workPts)
    (progn
  (setq pStart (dp:pt3d (dp:pt-at workPts 0))
    pNext  (dp:pt3d (dp:pt-at workPts 1))
    pEnd   (dp:pt3d (dp:pt-at workPts (1- (length workPts))))
    pPrev  (dp:pt3d (dp:pt-at workPts (- (length workPts) 2))))

  (if (null repS) (setq repS (dp:safe-touch-check pStart)))
  (setq dirStart (dp:safe-angle pStart pNext)
            kindS (strcase (vl-princ-to-string (dp:rep-get "CONTACT" repS)))
            ofsS nil)

      (if (and repS (numberp dirStart))
        (cond
          ((= kindS "HEAD")
            (setq ofsS (dp:apply-main-connector-by-report mode ty ins w h d pStart dirStart repS)))
          ((= kindS "SIDE")
            (setq ofsS (dp:apply-branch-connector-by-report mode ty ins w h d pStart dirStart repS)))))

      (if ofsS
        (progn
          (setq pNew (dp:safe-offset-point pStart dirStart ofsS))
          (if pNew
            (progn
              (dp:dbg (strcat "PS move from " (dp:fmt-pt pStart) " to " (dp:fmt-pt pNew)))
              (setq workPts (dp:replace-first workPts pNew)))
            (dp:dbg "skip PS offset: invalid point/dir"))))
      (dp:dbg (strcat "PS offset=" (vl-princ-to-string ofsS)))

      (if (dp:valid-pt-list-p workPts)
        (progn
          (setq pEnd  (dp:pt3d (dp:pt-at workPts (1- (length workPts))))
                pPrev (dp:pt3d (dp:pt-at workPts (- (length workPts) 2))))
          (if (null repE) (setq repE (dp:safe-touch-check pEnd)))
          (setq dirEnd (dp:safe-angle pEnd pPrev)
                kindE (strcase (vl-princ-to-string (dp:rep-get "CONTACT" repE)))
                ofsE nil)

          (if (and repE (numberp dirEnd))
            (cond
              ((= kindE "HEAD")
                (setq ofsE (dp:apply-main-connector-by-report mode ty ins w h d pEnd dirEnd repE)))
              ((= kindE "SIDE")
                (setq ofsE (dp:apply-branch-connector-by-report mode ty ins w h d pEnd dirEnd repE)))))

          (if ofsE
            (progn
              (setq pNew (dp:safe-offset-point pEnd dirEnd ofsE))
              (if pNew
                (progn
                  (dp:dbg (strcat "PE move from " (dp:fmt-pt pEnd) " to " (dp:fmt-pt pNew)))
                  (setq workPts (dp:replace-last workPts pNew)))
                (dp:dbg "skip PE offset: invalid point/dir"))))
          (dp:dbg (strcat "PE offset=" (vl-princ-to-string ofsE)))))))
  workPts)

(defun c:DT (/ kw pathMode data pts workPts delEnt tempLines
              w h d rIn defR idata prf ebKw rVal repPreS repPreE pStart pEnd
              fcIns fcSize)
  (dp:load-deps)
  (setq *DP:SideConnAsked* nil)

  ;; STEP 1: SHAPE -------------------------------------------------------------
  (initget "1 2 Rect Round Setting DTS")
  (setq kw (getkword (strcat "\nShape [1=Rect / 2=Round / Setting / DTS] <" *DP:Mode* ">: ")))
  (if (null kw) (setq kw *DP:Mode*))
  (setq kw (dp:norm-shape kw))

  (if (= (strcase kw) "DTS")
    (progn
      (if (dp:sym-exists-p 'c:DTS) (c:DTS))
      (setq kw (dp:norm-shape *DP:Mode*))))

  ;; STEP 2: SETTING -----------------------------------------------------------
  (if (= (strcase kw) "SETTING")
    (progn
      (if (= (strcase *DP:Mode*) "RECT")
        (progn
          (initget "1 2 E1 E11")
          (setq ebKw (getkword (strcat "\nElbow [1=E1 Radius / 2=E11 Mitered] <"
                                       (if (= *DP:ElbowType* "E1") "1" "2")
                                       ">: ")))
          (cond
            ((or (= ebKw "1") (= (strcase ebKw) "E1")) (setq *DP:ElbowType* "E1"))
            ((or (= ebKw "2") (= (strcase ebKw) "E11")) (setq *DP:ElbowType* "E11"))))
        (progn
          (initget 6)
          (setq rVal (getreal (strcat "\nDefault inner radius <" (rtos *DP:R* 2 0) ">: ")))
          (if rVal (setq *DP:R* rVal))))
      (setq kw (dp:norm-shape *DP:Mode*)))
    (setq *DP:Mode* (dp:norm-shape kw)))

  ;; STEP 3: PATH INPUT --------------------------------------------------------
  (initget "Select Draw")
  (setq pathMode (getkword "\nPath mode [Select/Draw] <Draw>: "))
  (if (null pathMode) (setq pathMode "Draw"))

  (if (= (strcase pathMode) "SELECT")
    (setq data (dp:get-path-by-select))
    (setq data (dp:get-path-by-draw)))

  (if data
    (progn
      (setq pts (nth 0 data)
            delEnt (nth 1 data)
            tempLines (nth 2 data))

      (setq pts (dp:sanitize-pts pts))
      (dp:dbg (strcat "sanitized pts=" (vl-princ-to-string pts)))

      ;; Touch check runs immediately after path input for clear workflow feedback.
      (setq repPreS nil repPreE nil)
      (if (dp:valid-pt-list-p pts)
        (progn
          (setq pStart (dp:pt3d (dp:pt-at pts 0))
                pEnd   (dp:pt3d (dp:pt-at pts (1- (length pts)))))
              (setq repPreS (dp:safe-touch-check pStart)
                repPreE (dp:safe-touch-check pEnd))
              (dp:prompt-side-conn-if-needed repPreS repPreE)
          (princ "\n[DT] Touch-check completed."))
        (princ "\n[DT] Touch-check unavailable."))

      ;; STEP 4: PARAMS + GENERATE --------------------------------------------
      (if (and pts (> (length pts) 1))
        (progn
          (if (and delEnt (entget delEnt)) (entdel delEnt))
          (dp:cleanup-ents tempLines)
          (setq workPts pts)

          (if (= (strcase *DP:Mode*) "RECT")
            (progn
              (setq idata (dp:inherit-ty-ins-from-touch repPreS repPreE *DT:Type* *DT:Insul*))
              (setq *DT:Type*  (nth 0 idata)
                    *DT:Insul* (nth 1 idata))
               (if (dp:sym-exists-p 'dts:sync-shape) (dts:sync-shape "RECT"))

               (if (dp:flexconn-report-p repPreS)
                 (progn
                   ;; Keep the user duct size; only inherit the stored insulation.
                   (setq fcSize (dp:flexconn-size-with-insul repPreS))
                   (if fcSize (setq *DT:Insul* (nth 2 fcSize)))))

               (princ (strcat "\n[DT] Rect system/insul source: " (nth 2 idata)
                              " -> " *DT:Type* " / INS" (itoa (fix *DT:Insul*))))

               (initget 6)
               (setq w (getreal (strcat "\nWidth W <" (rtos *DT:W* 2 0) ">: ")))
               (if w (setq *DT:W* w) (setq w *DT:W*))

               (initget 6)
               (setq h (getreal (strcat "\nHeight H <" (rtos *DT:H* 2 0) ">: ")))
               (if h (setq *DT:H* h) (setq h *DT:H*))

              (if (= (strcase *DP:ElbowType*) "E11")
                (setq rIn 0.0)
                (progn
                  (setq defR (/ *DT:W* 2.0))
                  (initget 6)
                  (setq rIn (getreal (strcat "\nInner radius R <" (rtos defR 2 0) ">: ")))
                  (if (null rIn) (setq rIn defR))
                  (setq *DP:R* rIn)))

              (dt:init *DT:Type*)
                (setq idata (dt:get-insul *DT:Insul*)
                    prf (car idata))

              (setq workPts (dp:sanitize-pts workPts))
                (setq workPts (dp:apply-touch-connectors workPts "Rect" *DT:Type* *DT:Insul* w h 0 repPreS repPreE))

              (dp:generate workPts "Rect" rIn w h 0 *DT:Type* *DT:Insul* prf))

            (progn
              (setq idata (dp:inherit-ty-ins-from-touch repPreS repPreE *RD:Type* *RD:Insul*))
              (setq *RD:Type*  (nth 0 idata)
                *RD:Insul* (nth 1 idata))
              (princ (strcat "\n[DT] Round system/insul source: " (nth 2 idata)
                     " -> " *RD:Type* " / INS" (itoa (fix *RD:Insul*))))

              (if (dp:sym-exists-p 'dts:sync-shape) (dts:sync-shape "ROUND"))

              (initget 6)
              (setq d (getreal (strcat "\nDiameter D <" (rtos *RD:D* 2 0) ">: ")))
              (if d (setq *RD:D* d) (setq d *RD:D*))

              (setq defR (/ *RD:D* 2.0))
              (initget 6)
              (setq rIn (getreal (strcat "\nInner radius R <" (rtos defR 2 0) ">: ")))
              (if (null rIn) (setq rIn defR))

                (rd:init *RD:Type*)
                (setq idata (rd:get-insul *RD:Insul*)
                    prf (car idata))

              (setq workPts (dp:sanitize-pts workPts))
                (setq workPts (dp:apply-touch-connectors workPts "Round" *RD:Type* *RD:Insul* 0 0 d repPreS repPreE))

              (dp:generate workPts "Round" rIn d d d *RD:Type* *RD:Insul* prf)))
          )
        (progn
          (dp:cleanup-ents tempLines)
          (princ "\n[DT] Cancelled."))))
    (princ "\n[DT] Cancelled."))

  (princ))

(princ "\n[DT] Duct Path rewritten. Command: DT")
(princ)
