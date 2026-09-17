;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : XRlayer.lsp
;;; Module       : Setup Xref
;;; Command      : XRLAYER
;;; Description  : Attempts to create/configure layer XREF and move Xref block references onto it while temporarily handling source-layer lock state.
;;; Inputs       : None.
;;; Effects      : Creates/configures XREF layer, scans INSERT entities for Xrefs, changes Xref reference layers, and temporarily unlocks/relocks source layers when required.
;;; Interaction  : Non-interactive.
;;; Risk         : Medium; changes Xref host layers and layer state.
;;; Dependencies : AutoLISP command/DXF table APIs.
;;; Notes        : Static review found `-LAYER` shorthand "l" in lock paths; AutoCAD may resolve this as Linetype rather than Lock, so the function requires later repair/runtime validation. Logic is unchanged in this phase.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:XRLAYER ( / *error* oldCmd ss i ent ename layName blockDef layDef layFlags count)
  (defun *error* (msg)
    (if oldCmd (setvar "CMDECHO" oldCmd))
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\nError: " msg)))
    (princ))

  (setq oldCmd (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)

  (if (not (tblsearch "LAYER" "XREF"))
    (command "-layer" "m" "XREF" "c" "254" "" "l" "XREF" "")
    (command "-layer" "c" "254" "XREF" "l" "XREF" ""))

  (setq ss (ssget "X" '((0 . "INSERT"))))
  (if ss
    (progn
      (setq i 0 count 0)
      (while (< i (sslength ss))
        (setq ename (ssname ss i)
              ent (entget ename)
              layName (cdr (assoc 8 ent))
              blockDef (tblsearch "BLOCK" (cdr (assoc 2 ent))))
        (if (and blockDef (not (equal (logand (cdr (assoc 70 blockDef)) 4) 0)))
          (progn
            (setq layDef (tblsearch "LAYER" layName)
                  layFlags (cdr (assoc 70 layDef)))
            (if (not (equal (logand layFlags 4) 0))
              (progn
                (command "-layer" "u" layName "")
                (setq ent (subst (cons 8 "XREF") (assoc 8 ent) ent))
                (entmod ent)
                (entupd ename)
                (command "-layer" "l" layName ""))
              (progn
                (setq ent (subst (cons 8 "XREF") (assoc 8 ent) ent))
                (entmod ent)
                (entupd ename)))
            (setq count (1+ count))))
        (setq i (1+ i)))
      (if (> count 0)
        (princ (strcat "\n[SUCCESS] Moved " (itoa count) " Xref(s) to layer XREF (Color 254 & Locked)."))
        (princ "\n[INFO] No Xref objects found in this drawing.")))
    (princ "\n[INFO] No INSERT objects found in this drawing."))

  (setvar "CMDECHO" oldCmd)
  (princ)
)

(princ "\n--> Type XRLAYER to automatically move Xrefs to Layer XREF <--")
(princ)
