;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Chuanhoadrawing.lsp
;;; Module      : Setup Drawing
;;; Command     : DF, SET1, CHUANHOADRAWING, RESNAP, TT, D, DB, TB, RENEW, LE1
;;; Description : Standardizes HVAC drawing setup, prepares metric environment,
;;;               provides dimension/text layer shortcuts, and text/dimension style renewals for TBH drawings.
;;;
;;; Usage       :
;;; 1. DF   - Initialize flex duct layers F15..F50 for HVAC drawings.
;;; 2. SET1 - Initialize standard drawing environment.
;;; 3. CHUANHOADRAWING - Alias for SET1.
;;; 4. RESNAP - Reset object snap modes to TBH drafting defaults + Polar Tracking (45/90...).
;;; 5. TT   - Switch current layer to HvacText and apply viewport-aware text height.
;;; 6. D    - Set Hvac-Dim layer, apply Hvac-Dim dimension style, then run DIMLINEAR.
;;; 7. DB   - Set BW-Dim layer, apply BW-Dim dimension style, then run DIMLINEAR.
;;; 8. TB   - Set BW-Text layer and apply viewport-aware text height.
;;; 9. RENEW - Convert all text/mtext to style HVACS, and dimensions to style Standard 100.
;;; 10. LE1  - Draw a LEADER with TBH standard properties.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── GLOBAL VARIABLES ─────────────────────────────
(setq *Flex_Layer_List* '("F15" "F20" "F25" "F30" "F35" "F40" "F45" "F50"))
(setq *Flex_Final_Layer* "Hvacduct-Flexduct")
(setq *Text_Default_Layer* "HvacText")
(if (not (boundp '*TBH:Set1Ready*)) (setq *TBH:Set1Ready* nil))

;; ─── SHARED HELPERS ───────────────────────────────
(defun tbh:sym-exists-p (sym / lst)
  (setq lst (atoms-family 1))
  (and (listp lst) (member sym lst)))

(defun tbh:apply-textsize-by-space ()
  ;; Paper Space text height = 3.0, Model Space default = 100.
  (if (and (= (getvar "TILEMODE") 0)
           (= (getvar "CVPORT") 1))
    (setvar "TEXTSIZE" 3.0)
    (setvar "TEXTSIZE" 100.0))
  (princ))

(defun tbh:get-textheight-by-space ()
  (if (and (= (getvar "TILEMODE") 0)
           (= (getvar "CVPORT") 1))
    3.0
    100.0))

(defun tbh:set-layer-safe (lay)
  (if (not (tblsearch "LAYER" lay))
    (vl-cmdf "-LAYER" "M" lay ""))
  (setvar "CLAYER" lay)
  (setvar "CECOLOR" "BYLAYER")
  (setvar "CELTYPE" "BYLAYER")
  (princ))

(defun tbh:ensure-textstyle-default ()
  (if (tblsearch "STYLE" "HVACS")
    (setvar "TEXTSTYLE" "HVACS")
    (princ "\n[TBH] Warning: Text Style 'HVACS' not found!"))
  (princ))

(defun tbh:ensure-dimstyle-default ()
  (if (tblsearch "DIMSTYLE" "Standard 100")
    (vl-cmdf "-DIMSTYLE" "R" "Standard 100")
    (princ "\n[TBH] Warning: Dim Style 'Standard 100' not found!"))
  (princ))

;; ─── LAYER INITIALIZATION (DF) ────────────────────
(defun c:DF ()
  (princ "\n[TBH] Initializing Flex Duct system layers...")
  (foreach lay *Flex_Layer_List*
    (if (not (tblsearch "LAYER" lay))
      (vl-cmdf "-LAYER" "M" lay "C" "17" lay "")
      (princ (strcat "\n[TBH] Layer " lay " already exists."))))
  (princ "\n[TBH] Flex Duct layer system initialized.")
  (princ))

;; ─── OBJECT SNAP RESET (RESNAP) ───────────────────
(defun c:RESNAP ()
  ;; Endpoint + Midpoint + Center + Geometric Center + Intersection
  ;; + Perpendicular + Extension + Parallel.
  (setvar "OSMODE" 13479)
  ;; Enable Polar Tracking (bit 8) and OTRACK (bit 16) via AUTOSNAP
  (vl-catch-all-apply 'setvar (list "AUTOSNAP" (logior (getvar "AUTOSNAP") 24)))
  ;; Set Polar Angle increment to 45 degrees (in radians)
  (vl-catch-all-apply 'setvar (list "POLARANG" (/ pi 4.0)))
  (princ "\n[TBH] Object snap reset: End, Mid, Center, GeomCenter, Int, Perp, Ext, Parallel. OTRACK & POLAR (45/90...) ON.")
  (princ))

;; ─── ENVIRONMENT SETUP (SET1) ─────────────────────
(defun c:SET1 (/ adoc lays lo)
  (setq adoc (vla-get-activedocument (vlax-get-acad-object))
        lays  (vla-get-Layers adoc))
  (princ "\n[TBH] Setting standard environment parameters...")

  ;; 1. Metric System & Units
  (setvar "MEASUREMENT" 1)    ; 1 = Metric
  (setvar "MEASUREINIT" 1)    ; 1 = Metric default for new drawings
  (setvar "INSUNITS" 4)       ; 4 = Millimeters
  (setvar "LTSCALE" 1.0)      ; Default linetype scale
  (princ "\n> Units reset to Metric (mm).")

  ;; 2. Scale List Reset
  (vl-cmdf "-SCALELISTEDIT" "R" "Y" "E")
  (vl-catch-all-apply 'setvar (list "CANNOSCALE" "1:100"))
  (princ "\n> Scale List reset to Metric (CANNOSCALE = 1:100).")

  ;; 3. Default Styles
  (if (tblsearch "STYLE" "HVACS")
    (setvar "TEXTSTYLE" "HVACS")
    (princ "\n[TBH] Warning: Text Style 'HVACS' not found!"))
  (if (tblsearch "DIMSTYLE" "Standard 100")
    (vl-cmdf "-DIMSTYLE" "R" "Standard 100")
    (princ "\n[TBH] Warning: Dim Style 'Standard 100' not found!"))

  ;; 4. Default text / entity overrides
  (if (tblsearch "LAYER" *Text_Default_Layer*)
    (setvar "CLAYER" *Text_Default_Layer*)
    (princ (strcat "\n[TBH] Warning: Layer '" *Text_Default_Layer* "' not found!")))
  (tbh:apply-textsize-by-space)
  (setvar "CECOLOR" "BYLAYER")
  (setvar "CELTYPE" "BYLAYER")

  ;; 5. Create required HVAC layers if missing
  (foreach spec (list
    (list "HVAC-TAGrille"      57 "Continuous")
    (list "HVAC-TAGrilleShade" 52 nil))
    (setq s-lname  (nth 0 spec)
          s-lcolor (nth 1 spec)
          s-ltype  (nth 2 spec))
    (if (not (tblsearch "LAYER" s-lname))
      (progn (vla-Add lays s-lname)
             (princ (strcat "\n> Layer created: " s-lname)))
      (princ (strcat "\n> Layer exists:  " s-lname)))
    (setq lo (vla-Item lays s-lname))
    (vla-put-Color lo s-lcolor)
    (if s-ltype
      (progn
        (if (not (tblsearch "LTYPE" s-ltype))
          (vl-catch-all-apply 'vla-Load
            (list (vla-get-Linetypes adoc) s-ltype "acad.lin")))
        (vla-put-Linetype lo s-ltype))))

  (setq *TBH:Set1Ready* T)
  (vla-regen adoc acAllViewports)
  (princ "\n[TBH] Environment Setup Complete.")
  (princ))

(defun c:CHUANHOADRAWING () (c:SET1))

;; ─── TEXT / LAYER SHORTCUTS ───────────────────────
(defun c:TT ()
  ;; Only switch current layer to HvacText.
  (tbh:set-layer-safe "HvacText")
  (tbh:apply-textsize-by-space)
  (princ))

(defun c:D ()
  ;; Set Hvac-Dim layer then run DIMLINEAR.
  (tbh:set-layer-safe "Hvac-Dim")
  (vl-catch-all-apply 'setvar (list "DIMLAYER" "Hvac-Dim"))
  (command "_.DIMLINEAR")
  (princ))

(defun c:DB ()
  ;; Set BW-Dim layer then run DIMLINEAR.
  (tbh:set-layer-safe "BW-Dim")
  (vl-catch-all-apply 'setvar (list "DIMLAYER" "BW-Dim"))
  (command "_.DIMLINEAR")
  (princ))

(defun c:TB ()
  ;; Only switch current layer to BW-Text.
  (tbh:set-layer-safe "BW-Text")
  (tbh:apply-textsize-by-space)
  (princ))

;; ─── LEADER (LE1) ─────────────────────────────────
(defun c:LE1 (/ *error* pt1 pt2 pts ptn temp_ent obj apply-props old_cmdecho)
  (vl-load-com)
  (setq old_cmdecho (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  (defun *error* (msg)
    (if old_cmdecho (setvar "CMDECHO" old_cmdecho))
    (princ))

  (defun apply-props (ent)
    (if (and ent (= (cdr (assoc 0 (entget ent))) "LEADER"))
      (progn
        (setq obj (vlax-ename->vla-object ent))
        (vl-catch-all-apply 'vla-put-StyleName        (list obj "ISO-25"))
        (vl-catch-all-apply 'vla-put-ArrowheadSize    (list obj 2.5))
        (vl-catch-all-apply 'vla-put-DimensionLineColor (list obj 0))
        (vl-catch-all-apply 'vla-put-DimensionLineWeight (list obj -2))
        (vl-catch-all-apply 'vla-put-TextGap          (list obj 0.625))
        (vl-catch-all-apply 'vla-put-ScaleFactor      (list obj 50.0))
        (vl-catch-all-apply 'vla-put-ArrowheadType    (list obj 0)))))

  (tbh:set-layer-safe "HvacText")
  (setq pt1 (getpoint "\nSpecify leader start point: "))
  (if pt1
    (progn
      (setq pt2 (getpoint pt1 "\nSpecify next point: "))
      (if pt2
        (progn
          (setq pts (list pt1 pt2))
          (command "_.LEADER")
          (foreach p pts (command p))
          (while (> (getvar "CMDACTIVE") 0) (command ""))
          (setq temp_ent (entlast))
          (apply-props temp_ent)
          (while (setq ptn (getpoint (last pts) "\nSpecify next point (or Enter to finish): "))
            (setq pts (append pts (list ptn)))
            (entdel temp_ent)
            (command "_.LEADER")
            (foreach p pts (command p))
            (while (> (getvar "CMDACTIVE") 0) (command ""))
            (setq temp_ent (entlast))
            (apply-props temp_ent))))))
  (if old_cmdecho (setvar "CMDECHO" old_cmdecho))
  (princ))

;; ─── RENEW ────────────────────────────────────────
(defun c:RENEW (/ *error* adoc style-name-text style-name-dim count-text count-dim
                   error-cnt-text error-cnt-dim locked-layers old-cmdecho name att
                   choice ss ent obj i)
  (vl-load-com)
  (setq old-cmdecho (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (vla-startundomark adoc)

  (defun *error* (msg)
    (if locked-layers
      (foreach lay locked-layers
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))))
    (if old-cmdecho (setvar "CMDECHO" old-cmdecho))
    (vla-endundomark adoc)
    (princ (strcat "\n[TBH] RENEW command interrupted: " msg))
    (princ))

  (setq style-name-text  "HVACS"
        style-name-dim   "Standard 100"
        count-text       0
        count-dim        0
        error-cnt-text   0
        error-cnt-dim    0
        locked-layers    nil)

  ;; 1. Check/Create Text Style HVACS
  (if (not (tblsearch "STYLE" style-name-text))
    (progn
      (princ (strcat "\n[TBH] Style '" style-name-text "' not found. Creating default style..."))
      (vl-catch-all-apply 'command (list "_-STYLE" style-name-text "Arial" 0 0.8 0 "N" "N" "N"))))

  ;; 2. Check Dim Style Standard 100
  (if (not (tblsearch "DIMSTYLE" style-name-dim))
    (princ (strcat "\n[TBH] Warning: Dim Style '" style-name-dim "' not found in drawing!")))

  ;; 3. Ask user for selection mode
  (initget "Manual Auto")
  (setq choice (getkword "\nChoose renew mode [Manual select/Auto all] <Auto>: "))
  (if (not choice) (setq choice "Auto"))

  ;; 4. Temporarily unlock locked layers
  (vlax-for lay (vla-get-layers adoc)
    (if (= (vla-get-lock lay) :vlax-true)
      (progn
        (setq locked-layers (cons lay locked-layers))
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-false)))))

  ;; 5. Process objects
  (if (= choice "Manual")
    (progn
      (princ "\n[TBH] Select Text, MText, Dimensions, or Blocks to renew: ")
      (setq ss (ssget '((0 . "TEXT,MTEXT,DIMENSION,INSERT"))))
      (if ss
        (progn
          (setq i 0)
          (while (< i (sslength ss))
            (setq ent (ssname ss i)
                  obj (vlax-ename->vla-object ent)
                  name (strcase (vla-get-ObjectName obj)))
            (cond
              ((member name '("ACDBTEXT" "ACDBMTEXT"))
               (if (vl-catch-all-error-p
                     (vl-catch-all-apply 'vla-put-StyleName (list obj style-name-text)))
                 (setq error-cnt-text (1+ error-cnt-text))
                 (setq count-text (1+ count-text))))
              ((= name "ACDBBLOCKREFERENCE")
               (if (= (vla-get-HasAttributes obj) :vlax-true)
                 (foreach att (vlax-invoke obj 'GetAttributes)
                   (if (vl-catch-all-error-p
                         (vl-catch-all-apply 'vla-put-StyleName (list att style-name-text)))
                     (setq error-cnt-text (1+ error-cnt-text))
                     (setq count-text (1+ count-text))))))
              ((wcmatch name "*DIMENSION")
               (if (vl-catch-all-error-p
                     (vl-catch-all-apply 'vla-put-StyleName (list obj style-name-dim)))
                 (setq error-cnt-dim (1+ error-cnt-dim))
                 (setq count-dim (1+ count-dim)))))
            (setq i (1+ i))))
        (princ "\n[TBH] No valid objects selected.")))
    ;; Auto Mode
    (progn
      (princ "\n[TBH] Standardizing Text and Dimensions in drawing...")
      (vlax-for blk (vla-get-blocks adoc)
        (if (or (not (vlax-property-available-p blk 'IsXRef))
                (= (vla-get-IsXRef blk) :vlax-false))
          (vlax-for obj blk
            (setq name (strcase (vla-get-ObjectName obj)))
            (cond
              ((member name '("ACDBTEXT" "ACDBMTEXT" "ACDBATTRIBUTEDEFINITION"))
               (if (vl-catch-all-error-p
                     (vl-catch-all-apply 'vla-put-StyleName (list obj style-name-text)))
                 (setq error-cnt-text (1+ error-cnt-text))
                 (setq count-text (1+ count-text))))
              ((= name "ACDBBLOCKREFERENCE")
               (if (= (vla-get-HasAttributes obj) :vlax-true)
                 (foreach att (vlax-invoke obj 'GetAttributes)
                   (if (vl-catch-all-error-p
                         (vl-catch-all-apply 'vla-put-StyleName (list att style-name-text)))
                     (setq error-cnt-text (1+ error-cnt-text))
                     (setq count-text (1+ count-text))))))
              ((wcmatch name "*DIMENSION")
               (if (vl-catch-all-error-p
                     (vl-catch-all-apply 'vla-put-StyleName (list obj style-name-dim)))
                 (setq error-cnt-dim (1+ error-cnt-dim))
                 (setq count-dim (1+ count-dim))))))))))

  ;; 6. Restore layer lock states
  (if locked-layers
    (foreach lay locked-layers
      (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))))

  (vla-endundomark adoc)
  (if old-cmdecho (setvar "CMDECHO" old-cmdecho))

  (princ (strcat "\n[TBH] RENEW Complete (" choice " mode):"))
  (princ (strcat "\n  - " (itoa count-text) " text(s)/mtext(s) updated to style '" style-name-text "'."))
  (princ (strcat "\n  - " (itoa count-dim) " dimension(s) updated to style '" style-name-dim "'."))
  (if (> error-cnt-text 0)
    (princ (strcat "\n  - Warning: Failed to update " (itoa error-cnt-text) " text(s)/mtext(s).")))
  (if (> error-cnt-dim 0)
    (princ (strcat "\n  - Warning: Failed to update " (itoa error-cnt-dim) " dimension(s).")))
  (vla-regen adoc acAllViewports)
  (princ))

;; ─── AUTO-INIT ────────────────────────────────────
(princ "\n[TBH] Drawing Standardization Suite loaded.")
(vl-catch-all-apply 'c:SET1 nil)
(princ)
