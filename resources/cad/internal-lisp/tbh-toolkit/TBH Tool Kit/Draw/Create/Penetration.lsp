;;; =============================================================================
;;; CADGPT-HEADER-START
;;;
;;; File        : Penetration.lsp
;;; Module      : HVAC - Penetration
;;; Command     : PENO
;;; Description : Creates Penetration blocks for Wall or Ceiling.
;;;               Auto-generates Hatch, Text (for CLG), packages the Block, and allows rotation.
;;;               Ensures block reference is placed on layer BW-Peno with ByLayer properties.
;;;               All internal entities inside the block definition use ByLayer color,
;;;               linetype (line style), and lineweight.
;;;
;;; CADGPT-HEADER-END
;;; =============================================================================

;; --- System Configuration ---
(defun PENO_GetConfig ()
  (list
    '("LAYER_PENO"      . "BW-Peno")
    '("LAYER_SHADE"     . "BW-PenoShade")
    '("LAYER_TEXT"      . "BW-text")
    '("TEXT_HEIGHT"     . 100.0)
    '("TEXT_WIDTH_F"    . 0.8)
    '("TEXT_FONT"       . "Arial Narrow")
  )
)

(defun PENO_GetCfg (key) (cdr (assoc key (PENO_GetConfig))))

;; Helper function to ensure required layers exist
(defun PENO_EnsureLayer (layer_name)
  (if (and layer_name (not (tblsearch "LAYER" layer_name)))
    (command "_.layer" "_m" layer_name "")
  )
)

;; Helper function to generate a random suffix to avoid duplicate block names
(defun PENO_RandomSuffix (/ seed)
  (setq seed (getvar "DATE"))
  (setq seed (* seed 1000000))
  (substr (rtos seed 2 0) 10)
)

;; Enforce ByLayer on all sub-entities inside block definition via ActiveX
(defun PENO_FixBlockContents (blk_name / doc blks blk_def)
  (vl-load-com)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq blks (vla-get-blocks doc))
  (if (not (vl-catch-all-error-p (setq blk_def (vl-catch-all-apply 'vla-item (list blks blk_name)))))
    (vlax-for ent blk_def
      ;; 256 = acByLayer for color, -1 = acLnWtByLayer for lineweight
      (vl-catch-all-apply 'vla-put-color (list ent 256))
      (vl-catch-all-apply 'vla-put-linetype (list ent "ByLayer"))
      (vl-catch-all-apply 'vla-put-lineweight (list ent -1))
    )
  )
)

;; Error handler
(defun PENO_Error (msg)
  (if (not (member msg '("Function cancelled" "quit / exit abort")))
    (princ (strcat "\n[PENO] Error: " msg))
  )
  (if *old_cecolor* (setvar "CECOLOR" *old_cecolor*))
  (if *old_celtype* (setvar "CELTYPE" *old_celtype*))
  (if *old_celweight* (setvar "CELWEIGHT" *old_celweight*))
  (if *old_osmode* (setvar "OSMODE" *old_osmode*))
  (if *old_cmdecho* (setvar "CMDECHO" *old_cmdecho*))
  (command-s "_.undo" "_end")
  (princ)
)

;; --- Main PENO Command ---
(defun C:PENO (/ 
               ;; System variables
               *old_osmode* *old_cmdecho* *old_cecolor* *old_celtype* *old_celweight* *error*
               ;; Input variables
               peno_type type_str p1 w h p3 p_mid
               ;; Block variables
               blk_name ss_blk ent_rect ent_hatch ent_text rand_val blk_obj test_blk vla_text blk_vla
              )
  
  ;; 1. Initialize environment
  (setq *old_osmode* (getvar "OSMODE")
        *old_cmdecho* (getvar "CMDECHO")
        *old_cecolor* (getvar "CECOLOR")
        *old_celtype* (getvar "CELTYPE")
        *old_celweight* (getvar "CELWEIGHT")
        *error* PENO_Error)
  
  (setvar "CMDECHO" 0)
  (command "_.undo" "_begin")
  (vl-load-com)

  ;; Ensure required layers exist
  (PENO_EnsureLayer (PENO_GetCfg "LAYER_PENO"))
  (PENO_EnsureLayer (PENO_GetCfg "LAYER_SHADE"))
  (PENO_EnsureLayer (PENO_GetCfg "LAYER_TEXT"))

  ;; Enforce current creation properties to ByLayer
  (setvar "CECOLOR" "BYLAYER")
  (setvar "CELTYPE" "BYLAYER")
  (setvar "CELWEIGHT" -1)

  ;; 2. Collect input data
  (initget "1 2 Wall CLG")
  (setq peno_type (getkword "\nSelect Peno type [1-Wall/2-CLG] <2>: "))
  (if (not peno_type) (setq peno_type "2"))
  
  (setq type_str (if (or (= peno_type "2") (= peno_type "CLG")) "CLG" "WALL"))

  (if (not (setq p1 (getpoint "\nPick base point (P1): "))) (exit))
  
  (initget 7) ; No zero or negative values allowed
  (setq w (getdist p1 (strcat "\nEnter Width W (type " type_str "): ")))
  (setq h (getdist p1 "\nEnter Height H: "))

  (setvar "OSMODE" 0)

  ;; 3. Calculate coordinates
  (setq p3 (list (+ (car p1) w) (+ (cadr p1) h) 0.0)
        p_mid (list (+ (car p1) (/ w 2.0)) (+ (cadr p1) (/ h 2.0)) 0.0))

  ;; 4. Create unique Block name
  (setq rand_val (PENO_RandomSuffix))
  (setq blk_name (strcat "PEN-" type_str "-" (rtos w 2 0) "x" (rtos h 2 0) "-" rand_val))

  ;; 5. Draw temporary geometry components
  (setq ss_blk (ssadd))

  ;; A. Draw Rectangle (Layer BW-Peno)
  (command "_.rectang" p1 p3)
  (setq ent_rect (entlast))
  (ssadd ent_rect ss_blk)
  (command "_.chprop" ent_rect "" "_layer" (PENO_GetCfg "LAYER_PENO") "_color" "BYLAYER" "_lt" "BYLAYER" "_lw" "BYLAYER" "")

  ;; B. Draw Solid Hatch (Layer BW-PenoShade)
  (command "_.hatch" "Solid" ent_rect "")
  (setq ent_hatch (entlast))
  (ssadd ent_hatch ss_blk)
  (command "_.chprop" ent_hatch "" "_layer" (PENO_GetCfg "LAYER_SHADE") "_color" "BYLAYER" "_lt" "BYLAYER" "_lw" "BYLAYER" "")
  (command "_.draworder" ent_hatch "" "_back")

  ;; C. Draw MText
  (if (= type_str "CLG")
    (progn
      (command "_.mtext" p_mid "_J" "_MC" "_H" (PENO_GetCfg "TEXT_HEIGHT") p_mid "CLG\\PPENO" "")
      (setq ent_text (entlast))
      (ssadd ent_text ss_blk)
      (command "_.chprop" ent_text "" "_layer" (PENO_GetCfg "LAYER_TEXT") "_color" "BYLAYER" "_lt" "BYLAYER" "_lw" "BYLAYER" "_annotative" "_no" "")
      
      ;; Adjust via ActiveX - Use TextString instead of Contents
      (setq vla_text (vlax-ename->vla-object ent_text))
      (vla-put-width vla_text 0.0)
      (vla-put-TextString vla_text 
        (strcat "{\\f" (PENO_GetCfg "TEXT_FONT") "|b0|i0|c0|p34;\\W" 
                (rtos (PENO_GetCfg "TEXT_WIDTH_F") 2 1) ";CLG\\PPENO}"))
    )
  )

  ;; 6. Package Block (Origin = P1)
  (if (setq test_blk (tblobjname "BLOCK" blk_name))
    (princ (strcat "\nWarning: Block " blk_name " already exists."))
    (progn
      (command "_.block" blk_name p1 ss_blk "")
      
      ;; Enforce ByLayer for all internal entities in the newly defined block
      (PENO_FixBlockContents blk_name)

      ;; 7. Insert Block and Rotate interactively
      (command "_.insert" blk_name p1 1.0 1.0 0.0)
      (setq blk_obj (entlast))
      
      ;; Ensure block reference is on layer BW-Peno with ByLayer properties
      (command "_.chprop" blk_obj "" "_layer" (PENO_GetCfg "LAYER_PENO") "_color" "BYLAYER" "_lt" "BYLAYER" "_lw" "BYLAYER" "")
      (setq blk_vla (vlax-ename->vla-object blk_obj))
      (vl-catch-all-apply 'vla-put-layer (list blk_vla (PENO_GetCfg "LAYER_PENO")))
      (vl-catch-all-apply 'vla-put-color (list blk_vla 256))
      (vl-catch-all-apply 'vla-put-linetype (list blk_vla "ByLayer"))
      (vl-catch-all-apply 'vla-put-lineweight (list blk_vla -1))
      
      (setvar "OSMODE" *old_osmode*) ; Re-enable snap for accurate rotation
      (princ "\n--- In rotation mode. Click to set direction (OSnap supported) ---")
      (command "_.rotate" blk_obj "" p1 pause)
    )
  )

  ;; 8. Finalize & restore system variables
  (setvar "CECOLOR" *old_cecolor*)
  (setvar "CELTYPE" *old_celtype*)
  (setvar "CELWEIGHT" *old_celweight*)
  (setvar "OSMODE" *old_osmode*)
  (setvar "CMDECHO" *old_cmdecho*)
  (command "_.undo" "_end")
  
  (princ (strcat "\n[PENO] Successfully created Block: " blk_name))
  (princ)
)

(princ "\n--- Penetration Generator v1.5 Loaded. Type PENO to start. ---")
(princ)
