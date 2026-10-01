;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Change Layer.lsp
;;; Module      : Draw\Others
;;; Command     : 1, 2, 3, 4, 5, 1r, 2r, 3r, 4r, 5r, 1e, hins, hre, hco, hdim, bdim, hno, hte, bte
;;; Description : Bulk overrides or normalizes entity layers based on system standards.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select objects.
;;; 3. Move target objects to standardized MEP layer automatically.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── HELPERS ────────────────────────────────────────
(defun _SetCLayer (layerName)
  (if (tblsearch "layer" layerName)
    (setvar 'clayer layerName)
    (princ (strcat "\n[TBH] Error: Layer \"" layerName "\" not found. Please run Setup first.")))
  (princ))

;; ─── SYSTEM LAYERS (1-5) ────────────────────────────
(defun c:1 () (_SetCLayer "Hvacduct-sa"))
(defun c:2 () (_SetCLayer "Hvacduct-ra"))
(defun c:3 () (_SetCLayer "Hvacduct-oa"))
(defun c:4 () (_SetCLayer "Hvacduct-ea"))
(defun c:5 () (_SetCLayer "Hvacduct-ta"))

;; ─── SHADING LAYERS (1r-5r) ─────────────────────────
(defun c:1r () (_SetCLayer "Hvacduct-sa-shading"))
(defun c:2r () (_SetCLayer "Hvacduct-ra-shading"))
(defun c:3r () (_SetCLayer "Hvacduct-oa-shading"))
(defun c:4r () (_SetCLayer "Hvacduct-ea-shading"))
(defun c:5r () (_SetCLayer "Hvacduct-ta-shading"))
(defun c:1e () (_SetCLayer "Hvacequip-Shading"))

;; ─── OTHER MEP LAYERS ───────────────────────────────
(defun c:hins () (_SetCLayer "Hvacduct-Insul"))   ; Insulation Hatch
(defun c:hre  () (_SetCLayer "Hvac-Refrigerant")) ; Gas/Ref Pipe
(defun c:hco  () (_SetCLayer "Hvac-Condensate"))  ; Drain Pipe
(defun c:hdim () (_SetCLayer "Hvac-Dim"))         ; Dimensions
(defun c:bdim () (_SetCLayer "Hvac-BWDim"))       ; BW Dimensions
(defun c:hno  () (_SetCLayer "Hvac-Text"))        ; Text
(defun c:hte  () (_SetCLayer "Hvacduct-Text"))   ; Duct Tags
(defun c:bte  () (_SetCLayer "Hvac-BWText"))      ; BW Text

(princ "\n[TBH] Quick Layer Shortcuts loaded.")
(princ)