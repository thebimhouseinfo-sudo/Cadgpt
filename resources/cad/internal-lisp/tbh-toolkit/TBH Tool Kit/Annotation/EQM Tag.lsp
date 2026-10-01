;;; =============================================================================
;;; File        : EQM TAG.lsp
;;; Module      : Annotation
;;; Command     : ETAG
;;; Description : Tags equipment blocks with EQM Tag (text) or elevation block tag.
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS ─────────────────────────────────────────
(if (not (boundp '*ETAG:BLay*)) (setq *ETAG:BLay* "Hvac-EquipTag Height"))
(if (not (boundp '*ETAG:TLay*)) (setq *ETAG:TLay* "HvacequipTag"))
(setq etag:TW 655.0  etag:TH 170.0  etag:TR 50.0  etag:W1 285.0  etag:W2 370.0)

;; ─── UTILITIES ───────────────────────────────────────
(defun etag:rand-sfx (/ ms fr)
  (setq ms (itoa (abs (fix (getvar "MILLISECS"))))
        fr (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-R" (substr ms (max 1 (- (strlen ms) 4)))
               (substr fr 1 (min 4 (strlen fr)))))

(defun etag:del (e) (if (and e (entget e)) (vl-catch-all-apply 'entdel (list e))))

(defun etag:xf (bx by ip ang / ca sa)
  (setq ca (cos ang) sa (sin ang))
  (list (+ (car ip) (* bx ca) (- (* by sa)))
        (+ (cadr ip) (* bx sa) (* by ca)) 0.0))

(defun etag:ensure-setup (/ ad lays layObj)
  (setq ad (vla-get-ActiveDocument (vlax-get-acad-object)) lays (vla-get-Layers ad))
  (foreach ln (list *ETAG:BLay* *ETAG:TLay*)
    (if (not (tblsearch "LAYER" ln))
      (setq layObj (vl-catch-all-apply 'vla-Add (list lays ln)))
      (setq layObj (vl-catch-all-apply 'vla-Item (list lays ln))))
    (if (and (not (vl-catch-all-error-p layObj)) (= ln *ETAG:BLay*))
      (vl-catch-all-apply 'vla-put-Color (list layObj 1))))
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 150.0 0.8 0.0 "n" "n" "n"))))

;; ─── ATTRIB HELPERS ──────────────────────────────────
(defun etag:get-att (ins tag / e ed done res)
  (setq e (entnext ins) done nil res "")
  (while (and e (not done))
    (setq ed (entget e))
    (cond
      ((= (cdr (assoc 0 ed)) "ATTRIB")
        (if (= (strcase (cdr (assoc 2 ed))) (strcase tag)) (setq res (cdr (assoc 1 ed)))))
      ((= (cdr (assoc 0 ed)) "SEQEND") (setq done T)))
    (if (not done) (setq e (entnext e))))
  res)

(defun etag:set-att (ins tag val / e ed)
  (setq e (entnext ins))
  (while e
    (setq ed (entget e))
    (cond
      ((= (cdr (assoc 0 ed)) "ATTRIB")
        (if (= (strcase (cdr (assoc 2 ed))) (strcase tag))
          (progn (entmod (subst (cons 1 val) (assoc 1 ed) ed)) (entupd e) (setq e nil))))
      ((= (cdr (assoc 0 ed)) "SEQEND") (setq e nil)))
    (if e (setq e (entnext e)))))

;; Check if block INSERT has ATTRIBs (group 66=1 and at least one ATTRIB child)
(defun etag:has-attribs (ins / ed e)
  (setq ed (entget ins))
  (if (= (cdr (assoc 66 ed)) 1)
    (progn
      (setq e (entnext ins))
      (and e (= (cdr (assoc 0 (entget e))) "ATTRIB")))
    nil))

;; ─── TEXT TAG (Option 1: EQM Tag) ────────────────────

(defun etag:make-text (txt ip ang / lay)
  (setq lay *ETAG:TLay*)
  (entmake (list '(0 . "TEXT") '(100 . "AcDbEntity") (cons 8 lay)
                 '(62 . 7) '(6 . "ByLayer") '(100 . "AcDbText")
                 (cons 10 ip) '(40 . 150.0) '(41 . 0.8) (cons 1 txt)
                 '(7 . "HVACS") '(72 . 1) (cons 50 ang)
                 (cons 11 ip) '(73 . 2)))
  (entlast))

(defun etag:update-text (ent ip ang / ed)
  (setq ed (entget ent))
  (setq ed (subst (cons 10 ip) (assoc 10 ed) ed))
  (setq ed (subst (cons 11 ip) (assoc 11 ed) ed))
  (setq ed (subst (cons 50 ang) (assoc 50 ed) ed))
  (entmod ed) (entupd ent))

;; ─── BLOCK TAG (Options 2/3: BOE / COE) ──────────────

(defun etag:make-block-def (bname lbl val / lay W H R W1 W2 hw hh b x0)
  (setq lay *ETAG:BLay*
        W etag:TW  H etag:TH  R etag:TR  W1 etag:W1  W2 etag:W2
        hw (/ W 2.0)  hh (/ H 2.0)  b 0.41421356)
  (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") (cons 8 lay)
                 '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
  ;; Rounded rectangle
  (entmake (append
    (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
          '(100 . "AcDbPolyline") '(90 . 8) '(70 . 1) '(43 . 0.0))
    (list (cons 10 (list (+ (- hw) R) (- hh))) '(42 . 0.0))
    (list (cons 10 (list (- hw R) (- hh))) (cons 42 b))
    (list (cons 10 (list hw (+ (- hh) R))) '(42 . 0.0))
    (list (cons 10 (list hw (- hh R))) (cons 42 b))
    (list (cons 10 (list (- hw R) hh)) '(42 . 0.0))
    (list (cons 10 (list (+ (- hw) R) hh)) (cons 42 b))
    (list (cons 10 (list (- hw) (- hh R))) '(42 . 0.0))
    (list (cons 10 (list (- hw) (+ (- hh) R))) (cons 42 b))))
  ;; Divider
  (setq x0 (+ (- hw) W1))
  (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbLine") (list 10 x0 (- hh) 0.0) (list 11 x0 hh 0.0)))
  ;; ATTDEF LABEL
  (setq x0 (+ (- hw) (/ W1 2.0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbText") (list 10 x0 0.0 0.0) '(40 . 100.0) '(41 . 0.8)
                 (cons 1 lbl) '(7 . "HVACS") '(72 . 1) (list 11 x0 0.0 0.0)
                 '(100 . "AcDbAttributeDefinition") '(2 . "LABEL") '(3 . "LABEL") '(70 . 0) '(74 . 2)))
  ;; ATTDEF VALUE
  (setq x0 (+ (- hw) W1 (/ W2 2.0)))
  (entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbText") (list 10 x0 0.0 0.0) '(40 . 100.0) '(41 . 0.8)
                 (cons 1 val) '(7 . "HVACS") '(72 . 1) (list 11 x0 0.0 0.0)
                 '(100 . "AcDbAttributeDefinition") '(2 . "VALUE") '(3 . "VALUE") '(70 . 0) '(74 . 2)))
  (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd"))))

(defun etag:insert-block (bname ip ang lbl val / lay W W1 W2 hw lx rx wpt)
  (setq lay *ETAG:BLay* W etag:TW  W1 etag:W1  W2 etag:W2  hw (/ W 2.0))
  (entmake (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbBlockReference") (cons 2 bname) (cons 10 ip)
                 '(41 . 1.0) '(42 . 1.0) '(43 . 1.0) (cons 50 ang) '(70 . 0) '(66 . 1)))
  (setq lx (+ (- hw) (/ W1 2.0)) wpt (etag:xf lx 0.0 ip ang))
  (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbText") (list 10 (car wpt) (cadr wpt) 0.0)
                 '(40 . 100.0) '(41 . 0.8) (cons 1 lbl) (cons 50 ang)
                 '(7 . "HVACS") '(72 . 1) (list 11 (car wpt) (cadr wpt) 0.0)
                 '(100 . "AcDbAttribute") '(2 . "LABEL") '(70 . 0) '(74 . 2)))
  (setq rx (+ (- hw) W1 (/ W2 2.0)) wpt (etag:xf rx 0.0 ip ang))
  (entmake (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                 '(100 . "AcDbText") (list 10 (car wpt) (cadr wpt) 0.0)
                 '(40 . 100.0) '(41 . 0.8) (cons 1 val) (cons 50 ang)
                 '(7 . "HVACS") '(72 . 1) (list 11 (car wpt) (cadr wpt) 0.0)
                 '(100 . "AcDbAttribute") '(2 . "VALUE") '(70 . 0) '(74 . 2)))
  (entmake (list '(0 . "SEQEND") (cons 8 lay)))
  (entlast))

(defun etag:update-block (ins ip ang / ed e attred tag W W1 W2 hw bx wpt)
  (setq W etag:TW  W1 etag:W1  W2 etag:W2  hw (/ W 2.0))
  (setq ed (entget ins))
  (setq ed (subst (cons 10 (list (car ip) (cadr ip) 0.0)) (assoc 10 ed) ed))
  (setq ed (subst (cons 50 ang) (assoc 50 ed) ed))
  (entmod ed) (entupd ins)
  (setq e (entnext ins))
  (while e
    (setq attred (entget e))
    (cond
      ((= (cdr (assoc 0 attred)) "ATTRIB")
        (setq tag (strcase (cdr (assoc 2 attred))))
        (setq bx (cond ((= tag "LABEL") (+ (- hw) (/ W1 2.0)))
                       ((= tag "VALUE") (+ (- hw) W1 (/ W2 2.0))) (T 0.0)))
        (setq wpt (etag:xf bx 0.0 ip ang))
        (setq attred (subst (cons 10 (list (car wpt) (cadr wpt) 0.0)) (assoc 10 attred) attred))
        (setq attred (subst (cons 11 (list (car wpt) (cadr wpt) 0.0)) (assoc 11 attred) attred))
        (setq attred (subst (cons 50 ang) (assoc 50 attred) attred))
        (entmod attred) (entupd e))
      ((= (cdr (assoc 0 attred)) "SEQEND") (setq e nil)))
    (if e (setq e (entnext e)))))

;; ─── MOVE + SPACE-TOGGLE LOOP ────────────────────────
;; mode: "TEXT" or "BLOCK"  ent: existing preview entity
;; Returns final (ip rot)

(defun etag:place-loop (mode ent ip0 lbl val / ip rot gr-res gr-type gr-pt done)
  (setq ip ip0  rot 0.0)

  (princ "\n[ETAG] Move to position (SPACE=rotate 45°), click to place: ")
  (setq done nil)
  (while (not done)
    (setq gr-res (grread T 4 0) gr-type (car gr-res) gr-pt (cadr gr-res))
    (cond
      ;; Mouse Move
      ((= gr-type 5)
        (if (listp gr-pt)
          (progn (setq ip (list (car gr-pt) (cadr gr-pt) 0.0))
                 (if (= mode "TEXT") (etag:update-text ent ip rot)
                                     (etag:update-block ent ip rot)))))
      ;; Left Click
      ((= gr-type 3)
        (if (listp gr-pt) (setq ip (list (car gr-pt) (cadr gr-pt) 0.0)))
        (if (= mode "TEXT") (etag:update-text ent ip rot)
                             (etag:update-block ent ip rot))
        (setq done T))
      ;; Keyboard: SPACE
      ((and (= gr-type 2) (= gr-pt 32))
        (setq rot (rem (+ rot (/ pi 4.0)) (* 2.0 pi)))
        (if (= mode "TEXT") (etag:update-text ent ip rot)
                             (etag:update-block ent ip rot))
        (princ (strcat "\n[ETAG] Rot=" (rtos (* rot (/ 180.0 pi)) 2 1) "°")))
      ;; Keyboard: ENTER
      ((and (= gr-type 2) (= gr-pt 13))
        (setq done T))
      ;; Right Click or ESC
      ((or (= gr-type 25) (= gr-type 11) (and (= gr-type 2) (= gr-pt 27)))
        (etag:del ent) (princ "\n[ETAG] Cancelled.") (princ) (exit))))
  (list ip rot))

;; ─── INTERNAL EQ INIT ────────────────────────────────

(defun etag:attdef-exists (blkDef tag / found)
  (setq found nil)
  (vlax-for obj blkDef
    (if (and (= (vla-get-ObjectName obj) "AcDbAttributeDefinition")
             (= (strcase (vla-get-TagString obj)) (strcase tag)))
      (setq found T)))
  found)

(defun etag:init-block (entIns / blkRef acadDoc blkTbl blkName blkDef obj entType pt0 newAtt)
  (setq blkRef  (vlax-ename->vla-object entIns)
        acadDoc (vla-get-ActiveDocument (vlax-get-acad-object))
        blkTbl  (vla-get-Blocks acadDoc)
        blkName (vla-get-EffectiveName blkRef)
        blkDef  (vla-item blkTbl blkName))

  ;; Standardise internal entity layers
  (vlax-for obj blkDef
    (setq entType (vla-get-ObjectName obj))
    (if (wcmatch (strcase entType) "*HATCH*")
      (progn (vla-put-Layer obj "Hvacequip-Shading") (vla-put-Color obj 256))
      (progn (vla-put-Layer obj "Hvacequip")         (vla-put-Color obj 256))))

  ;; Add 3 hidden ATTDEFs
  (setq pt0 (vlax-3d-point '(0.0 0.0 0.0)))
  (foreach att-pair '(("EQMTAG" . "EQM TAG")
                      ("COE"    . "COE")
                      ("BOE"    . "BOE"))
    (if (not (etag:attdef-exists blkDef (car att-pair)))
      (progn
        (princ (strcat "\n[ETAG] Adding ATTDEF: " (car att-pair)))
        (setq newAtt (vl-catch-all-apply 'vla-AddAttribute
                       (list blkDef 100.0 1 (cdr att-pair) pt0 (car att-pair) "")))
        (if (not (vl-catch-all-error-p newAtt))
          (progn
            (vl-catch-all-apply 'vla-put-Invisible (list newAtt :vlax-true))
            (princ " -> Success."))
          (princ (strcat " -> ERROR: " (vl-catch-all-error-message newAtt))))
      )
      (princ (strcat "\n[ETAG] ATTDEF already exists: " (car att-pair)))))

  ;; Sync ATTDEFs
  (princ (strcat "\n[ETAG] Syncing block: " blkName))
  (vl-cmdf "_.ATTSYNC" "_N" blkName)

  ;; Set the INSERT itself
  (vla-put-Layer blkRef "Hvacequip")
  (vla-put-Color blkRef 256)

  (vla-Regen acadDoc acAllViewports)
  (princ "\n[ETAG] Block initialised with missing ATTRIBs."))

;; ─── MAIN COMMAND ────────────────────────────────────
(defun c:ETAG (/ sel ins ed bn kw att-val tag-att lbl bname prev-ent ip0 res)
  (etag:ensure-setup)

  ;; STEP 1: Pick EQM block
  (if (and *TG_SELECTED_ENTITY* (entget *TG_SELECTED_ENTITY*))
    (setq ins *TG_SELECTED_ENTITY*)
    (progn
      (setq sel (entsel "\n[ETAG] Click on Equipment block: "))
      (if (null sel) (progn (princ "\n[ETAG] Cancelled.") (princ) (exit)))
      (setq ins (car sel))
    )
  )
  (setq ed (entget ins))
  (if (not (= (cdr (assoc 0 ed)) "INSERT"))
    (progn (princ "\n[ETAG] Not a block INSERT.") (princ) (exit)))

  ;; STEP 2: Ensure ATTRIBs exist — run internal init if missing
  (if (not (etag:has-attribs ins))
    (progn
      (princ "\n[ETAG] Block has no ATTs — initialising block now...")
      (etag:init-block ins)
      ;; Re-read after init
      (setq ed (entget ins))))

  ;; STEP 3: Tag type
  (setq bn (cdr (assoc 2 ed)))
  (initget "1 2 3")
  (setq kw (getkword "\n[ETAG] Create tag: [1=EQM Tag / 2=Bottom of EQM / 3=Center of EQM] <1>: "))
  (if (null kw) (setq kw "1"))

  ;; STEP 4: Get/set value and create tag
  (setq ip0 (cdr (assoc 10 ed)))
  (if (= (length ip0) 2) (setq ip0 (append ip0 '(0.0))))

  (cond
    ;; ── Option 1: EQM Tag (plain text) ──────────────────────────────────
    ((= kw "1")
      (setq att-val (etag:get-att ins "EQMTAG"))
      (if (or (null att-val) (= att-val ""))
        (progn
          (setq att-val (getstring T "\n[ETAG] Enter EQM Tag value: "))
          (etag:set-att ins "EQMTAG" att-val)))
      (if (or (null att-val) (= att-val ""))
        (progn (princ "\n[ETAG] No value entered.") (princ) (exit)))
      (princ (strcat "\n[ETAG] EQM Tag = " att-val))
      ;; Create text preview at block insertion point
      (setq prev-ent (etag:make-text att-val ip0 0.0))
      (setq res (etag:place-loop "TEXT" prev-ent ip0 "" att-val))
      (princ (strcat "\n[ETAG] Text placed: " att-val)))

    ;; ── Option 2: Bottom of EQM (BOE) ───────────────────────────────────
    ((= kw "2")
      (setq tag-att "BOE"  lbl "BOE")
      (setq att-val (etag:get-att ins tag-att))
      (if (or (null att-val) (= att-val ""))
        (progn
          (setq att-val (getstring T "\n[ETAG] Enter BOE elevation (mm): "))
          (etag:set-att ins tag-att att-val)))
      (if (or (null att-val) (= att-val ""))
        (progn (princ "\n[ETAG] No value entered.") (princ) (exit)))
      (princ (strcat "\n[ETAG] BOE = " att-val))
      (setq bname (strcat "ETag-BOE" (etag:rand-sfx)))
      (etag:make-block-def bname lbl att-val)
      (setq prev-ent (etag:insert-block bname ip0 0.0 lbl att-val))
      (setq res (etag:place-loop "BLOCK" prev-ent ip0 lbl att-val))
      (princ (strcat "\n[ETAG] BOE tag placed: " att-val)))

    ;; ── Option 3: Center of EQM (COE) ───────────────────────────────────
    ((= kw "3")
      (setq tag-att "COE"  lbl "COE")
      (setq att-val (etag:get-att ins tag-att))
      (if (or (null att-val) (= att-val ""))
        (progn
          (setq att-val (getstring T "\n[ETAG] Enter COE elevation (mm): "))
          (etag:set-att ins tag-att att-val)))
      (if (or (null att-val) (= att-val ""))
        (progn (princ "\n[ETAG] No value entered.") (princ) (exit)))
      (princ (strcat "\n[ETAG] COE = " att-val))
      (setq bname (strcat "ETag-COE" (etag:rand-sfx)))
      (etag:make-block-def bname lbl att-val)
      (setq prev-ent (etag:insert-block bname ip0 0.0 lbl att-val))
      (setq res (etag:place-loop "BLOCK" prev-ent ip0 lbl att-val))
      (princ (strcat "\n[ETAG] COE tag placed: " att-val))))

  (princ))

(princ "\n[TBH] EQM Tag loaded. Command: ETAG")
(princ)