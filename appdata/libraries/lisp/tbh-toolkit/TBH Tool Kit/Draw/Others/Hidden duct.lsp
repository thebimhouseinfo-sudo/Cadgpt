;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Hidden duct.lsp
;;; Module      : Draw\Others
;;; Command     : HD, HIDDEN
;;; Description : Generates hidden lines for overlapping duct sections.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select crossing ducts.
;;; 3. System identifies overlaps and trims/converts underlying ducts to hidden linetype.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:HD (/ *error* acDoc typeChoice p1 w h p2 p3 p4 pm ss oldOsm oldColor oldLtype old_echo)
  
  (defun *error* (msg)
    (if old_echo (setvar "CMDECHO" old_echo))
    (if oldOsm (setvar "OSMODE" oldOsm))
    (if (not (wcmatch (strcase msg t) "*break,*cancel*,*exit*")) (princ (strcat "\n[HD] Error: " msg)))
    (if acDoc (vla-EndUndoMark acDoc))
    (princ))

  (setq acDoc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (vla-StartUndoMark acDoc)
  (setq old_echo (getvar "CMDECHO")) (setvar "CMDECHO" 0)
  (setq oldOsm (getvar "OSMODE"))
  (setvar "OSMODE" 0)

  ;; B1: Select Type
  (initget "1 2")
  (setq typeChoice (getkword "\nSelect Symbol Type [1: Drop (Yellow) / 2: X-Box (Red)] <1>: "))
  (if (null typeChoice) (setq typeChoice "1"))

  ;; B2: Geometry Inputs
  (setq p1 (getpoint "\nSpecify Bottom-Left Corner point: "))
  (if (not p1) (progn (vla-EndUndoMark acDoc) (setvar "OSMODE" oldOsm) (exit)))
  (setq w (getdist p1 "\nEnter Width W: "))
  (if (not w) (progn (vla-EndUndoMark acDoc) (setvar "OSMODE" oldOsm) (exit)))
  (setq h (getdist p1 "\nEnter Height H: "))
  (if (not h) (progn (vla-EndUndoMark acDoc) (setvar "OSMODE" oldOsm) (exit)))

  ;; Calculate vertices
  (setq p2 (list (+ (car p1) w) (cadr p1) (caddr p1))
        p3 (list (+ (car p1) w) (+ (cadr p1) h) (caddr p1))
        p4 (list (car p1) (+ (cadr p1) h) (caddr p1)))

  ;; B3: Draw Geometry
  (setq ss (ssadd))
  (vl-cmdf "_.pline" p1 p2 p3 p4 "_c") (ssadd (entlast) ss)

  (if (= typeChoice "1")
    (progn ;; Type 1: Drop
      (setq pm (list (+ (car p1) (* w 0.25)) (+ (cadr p1) (* h 0.25)) (caddr p1)))
      (vl-cmdf "_.pline" p4 pm p2 "") (ssadd (entlast) ss))
    (progn ;; Type 2: X-Box
      (vl-cmdf "_.line" p1 p3 "") (ssadd (entlast) ss)
      (vl-cmdf "_.line" p2 p4 "") (ssadd (entlast) ss)))

  ;; B4: Set Properties
  (if (not (tblsearch "LTYPE" "ins")) (princ "\n[HD] Warning: Linetype 'ins' not found. Using HIDDEN instead."))
  (setq ltp (if (tblsearch "LTYPE" "ins") "ins" "HIDDEN"))
  
  (if (= typeChoice "1")
    (vl-cmdf "_.chprop" ss "" "_C" "2" "_LT" ltp "") ; Color 2 (Yellow)
    (vl-cmdf "_.chprop" ss "" "_C" "1" "_LT" ltp "")) ; Color 1 (Red)

  ;; B5: Interaction
  (setvar "OSMODE" oldOsm)
  (princ "\nSpecify orientation (Rotate around base point):")
  (vl-cmdf "_.rotate" ss "" p1 pause)

  (vla-EndUndoMark acDoc)
  (setvar "CMDECHO" old_echo)
  (princ "\n[TBH] Hidden Duct symbol generated successfully.")
  (princ))

(defun c:HIDDEN () (c:HD))

(princ "\n[TBH] Hidden Duct loaded. Type 'HD' to start.")
(princ)