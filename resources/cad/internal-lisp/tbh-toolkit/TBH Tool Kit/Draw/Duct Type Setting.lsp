;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Duct Type Setting.lsp
;;; Module      : Draw
;;; Command     : DTS
;;; Description : Configures global duct types and routing preferences.
;;;
;;; 
;;; Usage       :
;;; 1. Run 'DTS'.
;;; 2. Dial in the standard Duct classification (Supply, Return, Exhaust).
;;; 3. Save to apply routing preferences globally.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBALS & DEFAULTS ─────────────────────────────
(if (not (boundp '*DTS:BaseDir*))
  (setq *DTS:BaseDir* (getvar "DWGPREFIX"))) ; Default to current DWG folder

(defun dts:ensure-defaults ()
  (if (not (boundp '*DTS:Type*))      (setq *DTS:Type* "SA"))
  (if (not (boundp '*DTS:Insul*))     (setq *DTS:Insul* 0))
  (if (not (boundp '*DTS:RectType*))  (setq *DTS:RectType* *DTS:Type*))
  (if (not (boundp '*DTS:RectInsul*)) (setq *DTS:RectInsul* *DTS:Insul*))
  (if (not (boundp '*DTS:RoundType*))  (setq *DTS:RoundType* *DTS:Type*))
  (if (not (boundp '*DTS:RoundInsul*)) (setq *DTS:RoundInsul* *DTS:Insul*))
  (if (not (boundp '*DTS:RectMaxLen*))  (setq *DTS:RectMaxLen*  1400.0))
  (if (not (boundp '*DTS:RoundMaxLen*)) (setq *DTS:RoundMaxLen* 1500.0))
  ;; Sync internal variables
  (setq *DTS:RectType* *DTS:Type*
        *DTS:RectInsul* *DTS:Insul*
        *DTS:RoundType* *DTS:Type*
        *DTS:RoundInsul* *DTS:Insul*))

;; ─── MEP STANDARDS LOADER (lightweight JSON extractor) ─────────────────
;; Loads minimal mapping from ai/knowledge/mep-standards.json and exposes
;; `dts:get-insul` and `dts:get-system-layer` for callers. This is a
;; forgiving parser tailored to the project's canonical JSON structure.

(defun dts:read-file-string (fname / fp fh line data)
  (setq fp (dts:resolve-file fname))
  (if (and fp (findfile fp))
    (progn
      (setq fh (open fp "r")
            data "")
      (if fh
        (progn
          (while (setq line (read-line fh))
            (setq data (strcat data line)))
          (close fh)))
      data)
    nil))

(defun dts:after-key (s key from / p start)
  ;; Return the position of the value opening quote right after "key":
  ;; in JSON string s, searching from index 'from'. Handles "key": and "key" :.
  (setq p (vl-string-search (strcat "\"" key "\"") s from))
  (if p
    (progn
      (setq start (+ p (strlen (strcat "\"" key "\""))))
      (while (and start (< start (strlen s))
                  (vl-position (substr s start 1) '(" " ":")))
        (setq start (1+ start)))
      (if (and start (< start (strlen s)) (= (substr s start 1) "\""))
        start
        nil))
    nil))

(defun dts:extract-block (s key / pos start brace depth i out ch)
  ;; returns substring for JSON object keyed by "key": { ... }
  (setq out nil)
  (if (and s key)
    (progn
      (setq pos (vl-string-search (strcat "\"" key "\"") s))
      (if pos
        (progn
          ;; find first '{' after the key token
          (setq start (vl-string-search "{" (substr s (+ pos 1))))
          (if start
            (progn
              (setq start (+ pos start))
              (setq depth 0 i start)
              (while (and i (< i (strlen s)) (not out))
                (setq ch (substr s i 1))
                (cond ((equal ch "{") (setq depth (1+ depth)))
                      ((equal ch "}") (setq depth (1- depth))))
                (if (and (= depth 0) (> i start))
                  (setq out (substr s start (- i start 1))))
                (setq i (1+ i)))
              out)
            nil))
        nil))))

(defun dts:parse-insulation-types (blk / out p q tok name obj-start nm-start nm-end)
  (setq out '())
  (if (and blk (> (strlen blk) 0))
    (progn
      (setq p 1)
      ;; find entries like "0": { ... }
      (while (setq p (vl-string-search "\"" blk p))
        (setq q (vl-string-search "\":" blk p))
        (if (and q (> q p))
          (progn
            (setq tok (substr blk (+ p 1) (- q p 2)))
            ;; find name within the following object
            (setq obj-start (dts:after-key blk "name" q))
            (if obj-start
              (progn
                (setq nm-start (1+ obj-start))
                (setq nm-end (vl-string-search "\"" blk nm-start))
                (if nm-end
                  (setq name (substr blk nm-start (- nm-end nm-start)))))
              (setq name nil))
            (if name (setq out (cons (cons (vl-string-trim " \"" tok) name) out)))
            (setq p q))
          (setq p nil)))
      out)
    out))

(defun dts:parse-system-types (blk / out p q key layer layer-pos lstart lend)
  (setq out '())
  (if (and blk (> (strlen blk) 0))
    (progn
      (setq p 1)
      ;; find keys like "SA": { ... }
      (while (setq p (vl-string-search "\"" blk p))
        (setq q (vl-string-search "\":" blk p))
        (if (and q (> q p))
          (progn
            (setq key (substr blk (+ p 1) (- q p 2)))
            ;; find layer value
            (setq layer-pos (dts:after-key blk "layer" q))
            (if layer-pos
              (progn
                (setq lstart (1+ layer-pos))
                (setq lend (vl-string-search "\"" blk lstart))
                (if lend
                  (setq layer (substr blk lstart (- lend lstart)))))
              (setq layer nil))
            (if layer (setq out (cons (cons (vl-string-trim " \"" key) layer) out)))
            (setq p q))
          (setq p nil)))
      out)
    out))

(defun dts:load-mep-standards (/ txt sysblk insblk sysmap insmap)
  (setq txt (dts:read-file-string "ai/knowledge/mep-standards.json"))
  (if (not txt)
    (progn (princ "\n[TBH] Warning: mep-standards.json not found; skipping MEP load.") nil)
    (progn
      (setq sysblk (dts:extract-block txt "system_types"))
      (setq insblk (dts:extract-block txt "insulation_types"))
      (setq sysmap (dts:parse-system-types sysblk))
      (setq insmap (dts:parse-insulation-types insblk))
      (if sysmap (setq *DTS:MEP:SystemMap* sysmap))
      (if insmap (setq *DTS:MEP:InsulationMap* insmap))
      (princ "\n[TBH] MEP standards loaded.")
      T)))

(defun dts:get-insul (idx / key u)
  "Return (NAME . raw) for insulation index, fallback to numeric name." 
  (setq idx (dts:norm-insul idx))
  (setq key (itoa idx))
  (if (and (boundp '*DTS:MEP:InsulationMap*) *DTS:MEP:InsulationMap*)
    (progn
      (setq u (assoc key *DTS:MEP:InsulationMap*))
      (if u (cons (cdr u) u) (cons (strcase (cond ((= idx 1) "INT25") ((= idx 2) "INT50") ((= idx 3) "INT75") ((= idx 4) "INT100") ((= idx 5) "EXT25") ((= idx 6) "EXT50") ((= idx 7) "EXT75") (T "BARE"))) nil)))))

(defun dts:get-system-layer (sys / u m)
  (setq u (dts:norm-type sys)
        m (if (and (boundp '*DTS:MEP:SystemMap*) *DTS:MEP:SystemMap*)
              (assoc u *DTS:MEP:SystemMap*)
              nil))
  (if m (cdr m) nil))

(defun dts:system-from-layer (lay / u pair res)
  "Return system code (SA/RA/...) if layer matches MEP mapping, else nil."
  (setq res nil)
  (if (and lay (boundp '*DTS:MEP:SystemMap*) *DTS:MEP:SystemMap*)
    (progn
      (setq u (strcase (vl-string-trim " " lay)))
      (foreach pair *DTS:MEP:SystemMap*
        (if (and (cdr pair) (= (strcase (cdr pair)) (strcase u)))
          (setq res (car pair))))
      res)
    res))


;; ─── HELPERS ────────────────────────────────────────
(defun dts:resolve-file (fname / fp)
  (setq fp (findfile fname))
  (if fp fp (strcat *DTS:BaseDir* "Draw/" fname)))

(defun dts:load-file (fname / fp)
  (setq fp (dts:resolve-file fname))
  (if (and fp (findfile fp))
    (load fp)
    (princ (strcat "\n[TBH] Warning: File " fname " not found."))))

(defun dts:norm-type (val / s)
  (setq s (strcase (vl-princ-to-string val)))
  (cond
    ((member s '("1" "SA")) "SA")
    ((member s '("2" "RA")) "RA")
    ((member s '("3" "OA")) "OA")
    ((member s '("4" "EA")) "EA")
    ((member s '("5" "TA")) "TA")
    (T "SA")))

(defun dts:norm-insul (val / n)
  (setq n (cond ((numberp val) (fix val))
                ((= (type val) 'STR) (atoi val))
                (T 0)))
  (if (or (< n 0) (> n 7)) 0 n))

(defun dts:sync-shape (shape / key)
  (dts:ensure-defaults)
  (setq key (strcase shape))
  (cond
    ((= key "RECT")
      (setq *DT:Type*   *DTS:Type*
            *DT:Insul*  *DTS:Insul*
            *DT:MaxLen* *DTS:RectMaxLen*))
    ((= key "ROUND")
      (setq *RD:Type*   *DTS:Type*
            *RD:Insul*  *DTS:Insul*
            *RD:MaxLen* *DTS:RoundMaxLen*))))

(defun dts:describe-shape (shape)
  (dts:ensure-defaults)
  (if (= (strcase shape) "RECT")
    (strcat "S:" *DT:Type* "/I:" (itoa *DT:Insul*))
    (strcat "S:" *RD:Type* "/I:" (itoa *RD:Insul*))))

;; ─── INTERACTION ────────────────────────────────────
(defun dts:prompt-system (/ kw)
  (dts:ensure-defaults)
  (initget "0 1 2 3 4 5 6 7")
  (setq kw (getkword (strcat "\nInsulation [0:Bare / 1:Int25 / 2:Int50 / 3:Int75 / 4:Int100 / 5:Ext25 / 6:Ext50 / 7:Ext75] <" (itoa *DTS:Insul*) ">: ")))
  (if (null kw) (setq kw (itoa *DTS:Insul*)))
  (setq *DTS:Insul* (dts:norm-insul kw))

  (dts:ensure-defaults))

(defun dts:prompt-maxlen (/ kw len-i)
  (dts:ensure-defaults)

  (initget "Rect Round")
  (setq kw (getkword "\nSet Max Length for [Rect/Round] <Rect>: "))
  (if (null kw) (setq kw "Rect"))

  (cond
    ((= kw "Rect")
      (initget 6)
      (setq len-i (getreal (strcat "\nRect Max Length <" (rtos *DTS:RectMaxLen* 2 0) ">: ")))
      (if len-i (setq *DTS:RectMaxLen* len-i)))
    ((= kw "Round")
      (initget 6)
      (setq len-i (getreal (strcat "\nRound Max Length <" (rtos *DTS:RoundMaxLen* 2 0) ">: ")))
      (if len-i (setq *DTS:RoundMaxLen* len-i))))

  (dts:ensure-defaults))

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:DTS (/ old_echo act)
  (setq old_echo (getvar "CMDECHO")) (setvar "CMDECHO" 0)
  (dts:ensure-defaults)
  (princ (strcat "\nCurrent Settings: System=" *DTS:Type* ", Insulation=" (itoa *DTS:Insul*) ", Rect MaxLen=" (rtos *DTS:RectMaxLen* 2 0) ", Round MaxLen=" (rtos *DTS:RoundMaxLen* 2 0)))
  (initget "1 2 3 4 5 SA RA OA EA TA Setting")
  (setq act (getkword (strcat "\nSystem Type [1=SA / 2=RA / 3=OA / 4=EA / 5=TA / Setting] <" *DTS:Type* ">: ")))
  (if (null act) (setq act *DTS:Type*))
  (cond
    ((member (strcase act) '("1" "2" "3" "4" "5" "SA" "RA" "OA" "EA" "TA"))
      (setq *DTS:Type* (dts:norm-type act))
      (dts:prompt-system))
    ((= act "Setting")
      (dts:prompt-maxlen))
    (T
      (setq *DTS:Type* (dts:norm-type act))
      (dts:prompt-system)))
  (dts:sync-shape "RECT")
  (dts:sync-shape "ROUND")
  (princ (strcat "\n[TBH] Settings saved. System=" *DTS:Type* ", Insulation=" (itoa *DTS:Insul*) ", Rect MaxLen=" (rtos *DTS:RectMaxLen* 2 0) ", Round MaxLen=" (rtos *DTS:RoundMaxLen* 2 0)))
  (setvar "CMDECHO" old_echo)
  (princ))

;; Auto-init on load
;; Attempt to load MEP standards (optional) and then init defaults
(dts:load-mep-standards)
(dts:ensure-defaults)
(dts:sync-shape "RECT")
(dts:sync-shape "ROUND")

(princ (strcat "\n[TBH] Duct Type Settings loaded. Type 'DTS' to configure [SA/RA/OA/EA/TA/Setting]. Default MaxLen: RECT=" (rtos *DTS:RectMaxLen* 2 0) ", ROUND=" (rtos *DTS:RoundMaxLen* 2 0)))
(princ)
