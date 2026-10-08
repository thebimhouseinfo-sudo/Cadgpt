;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Blade Damper.lsp
;;; Module      : Draw\Create
;;; Command     : BD
;;; Description : Inserts blade damper symbols into duct runs.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Pick point on duct.
;;; 3. Specify width/angle to draw the damper representation.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS ────────────────────────────────────────
(if (not (boundp '*BD:Type*)) (setq *BD:Type* "1"))
(if (not (boundp '*BD:Size*)) (setq *BD:Size* 250.0))

;; ─── HELPERS ────────────────────────────────────────
(defun bd:str-p (x) (= (type x) 'STR))
(defun bd:ename-p (x) (= (type x) 'ENAME))
(defun bd:ensure-str (x) (if (bd:str-p x) x ""))

(defun bd:split (str delim / pos lst dlen)
  (if (and (bd:str-p str) (bd:str-p delim))
    (progn
      (setq lst '() dlen (strlen delim))
      (while (setq pos (vl-string-search delim str))
        (setq lst (append lst (list (substr str 1 pos))))
        (setq str (substr str (+ pos 1 dlen))))
      (append lst (list str)))
    nil))

(defun bd:insert-name (ent ed / obj nm)
  (cond
    ((and ed (assoc 2 ed) (bd:str-p (cdr (assoc 2 ed)))
          (not (wcmatch (cdr (assoc 2 ed)) "`**")))
     ;; Use assoc 2 only when it is a normal block name, not anonymous like *U###
     (cdr (assoc 2 ed)))
    ((bd:ename-p ent)
     (setq obj (vlax-ename->vla-object ent))
     (cond
       ((vlax-property-available-p obj 'EffectiveName)
        (setq nm (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))
        (if (or (vl-catch-all-error-p nm) (not (bd:str-p nm))) nil nm))
       ((vlax-property-available-p obj 'Name)
        (setq nm (vl-catch-all-apply 'vla-get-Name (list obj)))
        (if (or (vl-catch-all-error-p nm) (not (bd:str-p nm))) nil nm))
       (T nil)))
    (T nil)))

(defun bd:str-replace-all (s old new / p)
  (if (and (bd:str-p s) (bd:str-p old) (bd:str-p new) (> (strlen old) 0))
    (progn
      (while (setq p (vl-string-search old s))
        (setq s (strcat (substr s 1 p) new (substr s (+ p 1 (strlen old))))))
      s)
    s))

(defun bd:normalize-layer (lay / u)
  (setq u (strcase (bd:ensure-str lay)))
  ;; Normalize common separators so matching is consistent across naming styles.
  (setq u (bd:str-replace-all u "_" "-"))
  (setq u (bd:str-replace-all u "." "-"))
  (setq u (bd:str-replace-all u "/" "-"))
  (setq u (bd:str-replace-all u "\\" "-"))
  (setq u (bd:str-replace-all u "|" "-"))
  (setq u (bd:str-replace-all u " " "-"))
  (while (vl-string-search "--" u)
    (setq u (bd:str-replace-all u "--" "-")))
  u)

(defun bd:system-from-layer (lay / u)
  (setq u (bd:normalize-layer lay))
  (cond
    ;; Standard naming in ai/knowledge/mep-standards.json: Hvacduct-sa/ra/ea/oa/ta
    ((or (wcmatch u "*HVACDUCT-SA*") (wcmatch u "*HVAC-DUCT-SA*")) "SA")
    ((or (wcmatch u "*HVACDUCT-RA*") (wcmatch u "*HVAC-DUCT-RA*")) "RA")
    ((or (wcmatch u "*HVACDUCT-OA*") (wcmatch u "*HVAC-DUCT-OA*")) "OA")
    ((or (wcmatch u "*HVACDUCT-EA*") (wcmatch u "*HVAC-DUCT-EA*")) "EA")
    ((or (wcmatch u "*HVACDUCT-TA*") (wcmatch u "*HVAC-DUCT-TA*")) "TA")
    ;; Token fallback for custom prefixed layers like A-Hvacduct-ea or MEP_HVAC_DUCT_EA
    ((wcmatch u "*-SA*") "SA")
    ((wcmatch u "*-RA*") "RA")
    ((wcmatch u "*-OA*") "OA")
    ((wcmatch u "*-EA*") "EA")
    ((wcmatch u "*-TA*") "TA")
    ;; Additional fallback patterns in case layer naming varies
    ((wcmatch u "*EXH*") "EA")
    ((wcmatch u "*SUPPLY*") "SA")
    ((wcmatch u "*RETURN*") "RA")
    ((wcmatch u "*OUTSIDE*") "OA")
    ((wcmatch u "*TRANSFER*") "TA")
    (T nil)))

(defun bd:normalize-system (s / u p)
  (if (bd:str-p s)
    (progn
      (setq u (strcase (vl-string-trim " -_" s)))
      (setq p (vl-string-search "_" u))
      (if p (setq u (substr u 1 p)))
      (cond
        ((wcmatch u "SA*") "SA")
        ((wcmatch u "RA*") "RA")
        ((wcmatch u "EA*") "EA")
        ((wcmatch u "OA*") "OA")
        ((wcmatch u "TA*") "TA")
        (T nil)))
    nil))

(defun bd:coerce-system (s / u)
  ;; Deterministic coercion for naming and command flow.
  (setq u (strcase (vl-string-trim " -_" (bd:ensure-str s))))
  (cond
    ((wcmatch u "SA*") "SA")
    ((wcmatch u "RA*") "RA")
    ((wcmatch u "EA*") "EA")
    ((wcmatch u "OA*") "OA")
    ((wcmatch u "TA*") "TA")
    (T nil)))

(defun bd:system-from-name (bn / u)
  (setq u (strcase (bd:ensure-str bn)))
  (cond
    ((wcmatch u "*-SA*") "SA")
    ((wcmatch u "*-RA*") "RA")
    ((wcmatch u "*-OA*") "OA")
    ((wcmatch u "*-EA*") "EA")
    ((wcmatch u "*-TA*") "TA")
    (T nil)))

(defun bd:valid-system-p (s)
  (setq s (bd:normalize-system s))
  (and (bd:str-p s)
       (or (equal s "SA")
           (equal s "RA")
           (equal s "EA")
           (equal s "OA")
           (equal s "TA"))))

(defun bd:system-token-from-block (bn / parts tk p)
  (if (and (bd:str-p bn)
           (or (wcmatch (strcase bn) "DTV*-*")
               (wcmatch (strcase bn) "RDV2-*-*")))
    (progn
      (setq parts (bd:split bn "-"))
      (if (>= (length parts) 2)
        (progn
          (setq tk (nth 1 parts))
          ;; remove optional suffix like SA_ECR
          (setq p (vl-string-search "_" tk))
          (if p (setq tk (substr tk 1 p)))
          (bd:normalize-system tk))
        nil))
    nil))

(defun bd:resolve-system (lay bn / s)
  ;; Prefer system mapping from global MEP standards loader when available,
  ;; otherwise fall back to existing layer/name/token heuristics.
  (setq s (or (and (fboundp 'dts:system-from-layer) (dts:system-from-layer lay))
              (bd:system-from-layer lay)
              (bd:system-from-name bn)
              (bd:system-token-from-block bn)
              (if (and (boundp '*DT:Type*) (bd:valid-system-p *DT:Type*)) (strcase *DT:Type*) nil)
              (if (and (boundp '*RD:Type*) (bd:valid-system-p *RD:Type*)) (strcase *RD:Type*) nil)))
  (setq s (bd:normalize-system s))
  (if (bd:valid-system-p s) s nil))

(defun bd:system-layer (sys / mapped)
  ;; Select the BD layer from its picked duct system, never from CLAYER.
  ;; Respect the configured MEP system layer if available; otherwise use
  ;; the same canonical Hvacduct-* names as the D1/D2 drawing commands.
  (setq mapped nil)
  (if (fboundp 'dts:get-system-layer)
    (setq mapped
      (vl-catch-all-apply 'dts:get-system-layer (list sys))))
  (if (and (bd:str-p mapped) (/= mapped ""))
    mapped
    (cdr (assoc sys
      '(("SA" . "Hvacduct-sa")
        ("RA" . "Hvacduct-ra")
        ("OA" . "Hvacduct-oa")
        ("EA" . "Hvacduct-ea")
        ("TA" . "Hvacduct-ta"))))))

(defun bd:shading-layer (lay)
  (if (and (bd:str-p lay) (/= lay "")) (strcat lay "-shading") "0"))

(defun bd:ensure-layer (lay / doc lays)
  (if (not (bd:str-p lay)) (setq lay "0"))
  (setq doc  (vla-get-ActiveDocument (vlax-get-acad-object))
        lays (vla-get-Layers doc))
  (if (not (tblsearch "LAYER" lay))
    (vl-catch-all-apply 'vla-Add (list lays lay)))
  lay)

(defun bd:make-name (sys typ sw / stem n)
  ;; Convention: BD-SYSTEM-SIZE-RANDOM-TYPE (last token remains 1/2)
  (setq sys (bd:coerce-system sys))
  (if (null sys) (setq sys "SA"))
  (setq typ (if (= typ "2") "2" "1"))
  (setq n (rem (getvar "MILLISECS") 100000))
  (setq stem (strcat "BD-" sys "-" (itoa (fix sw)) "-" (itoa n) "-" typ))
  (while (tblsearch "BLOCK" stem)
    (setq n (1+ n))
    (setq stem (strcat "BD-" sys "-" (itoa (fix sw)) "-" (itoa n) "-" typ)))
  stem)

(defun bd:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa)))
        (+ (cadr ip) (* bx sa) (* by ca))
        0.0))

(defun bd:to-local (pt ip ang / dx dy ca sa)
  (setq dx (- (car pt) (car ip))
        dy (- (cadr pt) (cadr ip))
        ca (cos ang) sa (sin ang))
  (list (+ (* dx ca) (* dy sa))
        (+ (* (- dx) sa) (* dy ca))
        0.0))

(defun bd:clamp (v a b) (max a (min b v)))

(defun bd:project-on-edge (info pick / ip ang pl edge-y lp cx)
  (setq ip     (cdr (assoc 'ip info))
        ang    (cdr (assoc 'ang info))
        pl     (cdr (assoc 'pl info))
        edge-y (cdr (assoc 'edge-y info))
        lp     (bd:to-local pick ip ang)
        cx     (bd:clamp (car lp) 0.0 pl))
  (bd:xf cx edge-y ip ang))

(defun bd:move-insert (ent pt / ed)
  (if (and (bd:ename-p ent) pt)
    (progn
      (setq ed (entget ent))
      (if (assoc 10 ed)
        (setq ed (subst (cons 10 pt) (assoc 10 ed) ed))
        (setq ed (append ed (list (cons 10 pt)))))
      (entmod ed)
      (entupd ent)
      ent)
    nil))

(defun bd:slide-preview (ins info start-pick / ev pt done)
  (setq done nil)
  (princ "\n[BD] Slide preview along duct edge, CLICK to confirm, ESC to cancel...")
  ;; Set initial preview position
  (bd:move-insert ins (bd:project-on-edge info start-pick))
  (while (not done)
    (setq ev (grread T 13 0))
    (cond
      ((= (car ev) 5) ;; mouse move
       (setq pt (bd:project-on-edge info (cadr ev)))
       (bd:move-insert ins pt))
      ((= (car ev) 3) ;; mouse click confirm
       (setq pt (bd:project-on-edge info (cadr ev)))
       (bd:move-insert ins pt)
       (setq done T))
      ((and (= (car ev) 2) (= (cadr ev) 27)) ;; ESC cancel
       (entdel ins)
       (setq ins nil)
       (setq done T))
    )
  )
  ins)

(defun bd:parse-rect (ent ed pick / bn parts dims-token dims sysTok ip ang pl w h lp cx side edge-y sign)
  (setq bn (bd:insert-name ent ed))
  (if (and (bd:str-p bn) (wcmatch (strcase bn) "DTV*-*"))
    (progn
      ;; DTv9 format: DTv9-<SYS>-<L>x<W>x<H>[-INS]
      (setq parts (bd:split bn "-"))
      (setq sysTok (if (>= (length parts) 2) (bd:normalize-system (nth 1 parts)) nil))
      (setq dims-token (if (>= (length parts) 3) (nth 2 parts) nil))
      (setq dims (if dims-token (bd:split dims-token "x") nil))
      (setq ip  (cdr (assoc 10 ed))
            ang (cond ((cdr (assoc 50 ed))) (T 0.0)))
      (if (= (length dims) 3)
        (progn
          (setq pl (atof (nth 0 dims))
                w  (atof (nth 1 dims))
                h  (atof (nth 2 dims))
                lp (bd:to-local pick ip ang)
                cx (bd:clamp (car lp) 0.0 pl))
          (if (< (abs (cadr lp)) (abs (+ (cadr lp) w)))
            (setq side 'top edge-y 0.0 sign 1.0)
            (setq side 'bottom edge-y (- w) sign -1.0))
          (list (cons 'shape 'RECT) (cons 'sys sysTok) (cons 'ip ip) (cons 'ang ang) (cons 'pl pl) (cons 'w w)
                (cons 'h h) (cons 'cx cx) (cons 'side side)
                (cons 'edge-y edge-y) (cons 'sign sign)))
        nil))
    nil))

(defun bd:parse-round (ent ed pick / bn parts sysTok len-token d-token ip ang pl d lp cx side edge-y sign)
  (setq bn (bd:insert-name ent ed))
  (if (and (bd:str-p bn) (wcmatch (strcase bn) "RDV2-*-*L-D*"))
    (progn
      ;; RDv2 format: RDv2-<SYS>-<L>L-D<D>[-INS]
      (setq parts (bd:split bn "-"))
      (if (>= (length parts) 4)
        (progn
          (setq sysTok (if (>= (length parts) 2) (bd:normalize-system (nth 1 parts)) nil))
          (setq len-token (nth 2 parts)
                d-token   (nth 3 parts)
                ip        (cdr (assoc 10 ed))
                ang       (cond ((cdr (assoc 50 ed))) (T 0.0)))
          (if (and (wcmatch (strcase len-token) "*L") (wcmatch (strcase d-token) "D*"))
            (progn
              (setq pl (atof (substr len-token 1 (1- (strlen len-token)))))
              (setq d  (atof (substr d-token 2)))
              (setq lp (bd:to-local pick ip ang)
                    cx (bd:clamp (car lp) 0.0 pl))
              ;; Round edge pick: choose upper/lower edge relative to centerline y=0
              (if (< (abs (- (cadr lp) (/ d 2.0))) (abs (+ (cadr lp) (/ d 2.0))))
                (setq side 'top edge-y (/ d 2.0) sign 1.0)
                (setq side 'bottom edge-y (- (/ d 2.0)) sign -1.0))
                (list (cons 'shape 'ROUND) (cons 'sys sysTok) (cons 'ip ip) (cons 'ang ang) (cons 'pl pl) (cons 'w d)
                    (cons 'h d) (cons 'cx cx) (cons 'side side)
                    (cons 'edge-y edge-y) (cons 'sign sign))
            )
            nil)
        )
        nil)
    )
    nil))

(defun bd:parse-duct (ent ed pick / info)
  (setq info (bd:parse-rect ent ed pick))
  (if info info (bd:parse-round ent ed pick)))

;; ─── ENTITY CREATION ────────────────────────────────
(defun bd:entmake-lwpoly (lay pts closed / data)
  (setq data
    (append
      (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay)
            '(62 . 256) '(6 . "ByLayer") '(100 . "AcDbPolyline")
            (cons 90 (length pts)) (cons 70 (if closed 1 0)) '(43 . 0.0))
      (mapcar '(lambda (pt) (cons 10 pt)) pts)))
  (if (entmake data) (entlast) nil))

(defun bd:entmake-line (lay p1 p2 color ltype)
  (if (entmake
    (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lay)
          (cons 62 color) (cons 6 ltype) '(100 . "AcDbLine")
          (cons 10 p1) (cons 11 p2)))
    (entlast)
    nil))

(defun bd:entmake-solid (lay p1 p2 p3 p4)
  (if (entmake
    (list '(0 . "SOLID") '(100 . "AcDbEntity") (cons 8 lay)
          '(62 . 256) '(6 . "ByLayer")
          (cons 10 p1) (cons 11 p2) (cons 12 p4) (cons 13 p3)))
    (entlast)
    nil))

(defun bd:blockify (bn base ents lay / oldecho ins result)
  (setq ents (vl-remove nil ents))
  (if (and ents (> (length ents) 0))
    (progn
      (setq oldecho (getvar "CMDECHO"))
      (setvar "CMDECHO" 0)
      (if (vl-cmdf "_.-BLOCK" bn "_non" base)
        (progn
          (foreach e ents (vl-cmdf e))
          (vl-cmdf "")
          (setvar "CMDECHO" oldecho)
          (setq ins (entmake (list '(0 . "INSERT") (cons 2 bn) (cons 10 base)
                                   (cons 8 lay) '(41 . 1.0) '(42 . 1.0)
                                   '(43 . 1.0) (cons 50 0.0))))
          (if ins (entlast) nil))
        (progn (setvar "CMDECHO" oldecho) nil)))
    nil))

;; ─── LOGIC ──────────────────────────────────────────
(defun bd:draw-spigot (lay info sw typ / ip ang cx edge-y sign half bigh smh small-half 
                                         y1 y2 y3 shade base ents p1 p2 p3 p4 q1 q2 q3 q4 
                                         c1 c2 axisL a1 a2 rightEnd hookX hookHalf h1 h2 h3)
  (setq ip         (cdr (assoc 'ip info))
        ang        (cdr (assoc 'ang info))
        cx         (cdr (assoc 'cx info))
        edge-y     (cdr (assoc 'edge-y info))
        sign       (cdr (assoc 'sign info))
        half       (/ sw 2.0)
        bigh       110.0
        smh        40.0
        small-half (/ (- sw 10.0) 2.0)
        y1         edge-y
        y2         (+ edge-y (* sign bigh))
        y3         (+ y2 (* sign smh))
        shade      (bd:ensure-layer (bd:shading-layer lay))
        base       (bd:xf cx y1 ip ang)
        ents       '())

  (if (not (tblsearch "LTYPE" "Ins"))
    (vl-catch-all-apply 'vl-cmdf (list "_.-LINETYPE" "_Load" "Ins" "acad.lin" "")))

  (setq p1 (bd:xf (- cx half) y1 ip ang)
        p2 (bd:xf (+ cx half) y1 ip ang)
        p3 (bd:xf (+ cx half) y2 ip ang)
        p4 (bd:xf (- cx half) y2 ip ang))
  (setq ents (cons (bd:entmake-solid shade p1 p2 p3 p4) ents))
  (setq ents (cons (bd:entmake-lwpoly lay (list p1 p2 p3 p4) T) ents))

  (setq q1 (bd:xf (- cx small-half) y2 ip ang)
        q2 (bd:xf (+ cx small-half) y2 ip ang)
        q3 (bd:xf (+ cx small-half) y3 ip ang)
        q4 (bd:xf (- cx small-half) y3 ip ang))
  (setq ents (cons (bd:entmake-lwpoly lay (list q1 q2 q3 q4) T) ents))

  (setq c1 (bd:xf cx (+ y1 (* sign -20.0)) ip ang)
        c2 (bd:xf cx (+ y3 (* sign 20.0)) ip ang))
  (setq ents (cons (bd:entmake-line lay c1 c2 1 "Ins") ents))

  (if (= typ "1")
    (progn
      (setq axisL (+ sw 100.0)
            a1 (bd:xf (- cx (/ axisL 2.0)) (+ edge-y (* sign 55.0)) ip ang)
            a2 (bd:xf (+ cx (/ axisL 2.0)) (+ edge-y (* sign 55.0)) ip ang))
      (setq ents (cons (bd:entmake-line lay a1 a2 1 "Continuous") ents))
      (setq rightEnd  (+ cx (/ axisL 2.0))
            hookX     (/ (+ (+ cx half) rightEnd) 2.0)
            hookHalf  25.0
            h1 (bd:xf hookX (+ edge-y (* sign (- 55.0 hookHalf))) ip ang)
            h2 (bd:xf hookX (+ edge-y (* sign (+ 55.0 hookHalf))) ip ang)
            h3 (bd:xf (+ hookX 35.0) (+ edge-y (* sign (+ 55.0 hookHalf))) ip ang))
      (setq ents (cons (bd:entmake-line lay h1 h2 1 "Continuous") ents))
      (setq ents (cons (bd:entmake-line lay h2 h3 1 "Continuous") ents))))
  
  (list base ents))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:BD (/ *error* old_cmdecho old_osmode typ size sel ent ed bn sys lay info drawRes base blockName ins ductLay blockSys layerSys)
  (defun *error* (msg)
    (if old_cmdecho (setvar "CMDECHO" old_cmdecho))
    (if old_osmode (setvar "OSMODE" old_osmode))
    (if (not (wcmatch (strcase msg t) "*break,*cancel*,*exit*"))
      (princ (strcat "\n[BD] Error: " msg)))
    (princ))

  (setq old_cmdecho (getvar "CMDECHO")
        old_osmode  (getvar "OSMODE"))
  (setvar "CMDECHO" 0)

  (initget "1 2")
  (setq typ (getkword (strcat "\nSelect type [1=Spigot+BD, 2=Spigot Only] <" (if (= *BD:Type* "1") "1" "2") ">: ")))
  (if (null typ) (setq typ *BD:Type*) (setq *BD:Type* typ))

  (initget 6)
  (setq size (getreal (strcat "\nSpigot Width <" (rtos *BD:Size* 2 0) ">: ")))
  (if (null size) (setq size *BD:Size*) (setq *BD:Size* size))

  (setq sel (entsel "\nSelect duct edge to place BD: "))
  (if (and sel (bd:ename-p (car sel)))
    (progn
      (setq ent      (car sel)
            ed       (entget ent)
            bn       (bd:insert-name ent ed)
            ductLay  (cdr (assoc 8 ed))
            info     (bd:parse-duct ent ed (cadr sel))
            ;; The picked duct is authoritative. Current layer and
            ;; previously used D1/D2 system defaults can be unrelated.
            blockSys (if info (cdr (assoc 'sys info)) nil)
            layerSys (or
                       (and (fboundp 'dts:system-from-layer)
                            (dts:system-from-layer ductLay))
                       (bd:system-from-layer ductLay))
            sys      (if blockSys blockSys layerSys))
      (cond
        ((null info)
         (princ "\n[BD] Error: Unsupported duct block. Supported: DTv9-* and RDv2-*"))
        ((and blockSys layerSys (/= blockSys layerSys))
         (princ (strcat "\n[BD] Error: Picked duct's block system ("
                        blockSys ") conflicts with its layer ("
                        (bd:ensure-str ductLay) " -> " layerSys
                        "). Fix the duct before placing BD.")))
        ((null sys)
         (princ (strcat "\n[BD] Error: Cannot identify SA/RA/OA/EA/TA from the picked duct "
                        (bd:ensure-str bn) " on layer " (bd:ensure-str ductLay) ".")))
        (T
         (setq lay       (bd:system-layer sys)
               drawRes   (bd:draw-spigot lay info size typ)
               base      (car drawRes)
               blockName (bd:make-name sys typ size)
               ins       (bd:blockify blockName base (cadr drawRes) lay))
         (if ins
           (progn
             (setq ins (bd:slide-preview ins info (cadr sel)))
             (if ins
               (princ (strcat "\n[Done] Blade Damper created (" (if (= typ "1") "Spigot + BD" "Spigot Only") ") | SYS=" (bd:ensure-str sys) " | Block: " (bd:ensure-str blockName)))
               (princ "\n[BD] Cancelled.")))
              (princ "\n[BD] Error: Block creation failed.")))))
    (princ "\n[BD] Cancelled."))

  (setvar "CMDECHO" old_cmdecho)
  (setvar "OSMODE" old_osmode)
  (princ))

(princ "\n[TBH] Blade Damper Tool loaded. Type 'BD' to start.")
(princ)
