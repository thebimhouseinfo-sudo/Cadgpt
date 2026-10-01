;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Duct Checker.lsp
;;; Module      : Draw
;;; Command     : DCHECK
;;; Description : Validates duct networks for continuity and proper connectivity.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select duct network segments.
;;; 3. Script highlights unconnected joints or sizing anomalies.
;;; TBH-HEADER-END
;;; =============================================================================
(defun c:DCHECK (/ dcl_id status dcl_path loop_dialog)
  (vl-load-com)
  
  ;; --- 1. Auto-generate DCL File ---
  (setq dcl_path (make_dcl_dcheck_final))

  ;; --- 2. Dialog Loop ---
  (setq loop_dialog t)
  (while loop_dialog
    (setq dcl_id (load_dialog dcl_path))
    (if (not (new_dialog "DCheck" dcl_id)) (progn (princ "\n❌ Error: Cannot load DCL.") (exit)))
    
    ;; Initialize default values
    (set_tile "eb_airflow" "")
    (set_tile "eb_density" "1.204")
    (set_tile "eb_viscosity" "0.0000182")
    (set_tile "eb_roughness" "0.09")
    
    ;; Initialize result tiles
    (set_tile "res_round" "Waiting for calculation...")
    (set_tile "res_rect" "Waiting for calculation...")

    ;; Actions
    (action_tile "btn_calc" "(do_dcheck_calculate_final)")
    (action_tile "cancel" "(setq loop_dialog nil) (done_dialog 0)")
    
    (start_dialog)
    (unload_dialog dcl_id)
  )
  (princ "\n--- DCHECK Closed ---")
  (princ)
)

;; ===============================
;; CALCULATION & UI UPDATE
;; ===============================
(defun do_dcheck_calculate_final (/ q_ls rho visc ks dia_rd rect_w rect_h deq_m v re f dp dh_mm)
  (setq q_ls (atof (get_tile "eb_airflow"))
        rho  (atof (get_tile "eb_density"))
        visc (atof (get_tile "eb_viscosity"))
        ks   (/ (atof (get_tile "eb_roughness")) 1000.0)
        dia_rd (atof (get_tile "eb_round_dia"))
        rect_w (atof (get_tile "eb_rect_w"))
        rect_h (atof (get_tile "eb_rect_h")))

  (if (<= q_ls 0) 
    (alert "Error: Air Flow must be greater than 0!")
    (progn
      ;; 1. Round Duct Calculation
      (if (> dia_rd 0)
        (progn
          (setq deq_m (/ dia_rd 1000.0)
                v (/ (/ q_ls 1000.0) (* pi (expt (/ deq_m 2.0) 2)))
                re (/ (* rho v deq_m) visc)
                f (calc_f_dcheck_final re ks deq_m)
                dp (* f (/ 1.0 deq_m) rho (/ (expt v 2) 2.0)))
          (set_tile "res_round" (strcat "Velocity: " (rtos v 2 2) " m/s | Pressure Loss: " (rtos dp 2 4) " Pa/m"))
        )
        (set_tile "res_round" "Invalid Diameter.")
      )

      ;; 2. Rectangular Duct Calculation (NO ABBREVIATIONS)
      (if (and (> rect_w 0) (> rect_h 0))
        (progn
          (setq dh_mm (/ (* 2.0 rect_w rect_h) (+ rect_w rect_h))
                deq_m (/ dh_mm 1000.0)
                v (/ (/ q_ls 1000.0) (/ (* rect_w rect_h) 1000000.0))
                re (/ (* rho v deq_m) visc)
                f (calc_f_dcheck_final re ks deq_m)
                dp (* f (/ 1.0 deq_m) rho (/ (expt v 2) 2.0)))
          ;; Update display without abbreviations: Velocity | Pressure Loss | Hydraulic Diameter
          (set_tile "res_rect" 
            (strcat "Velocity: " (rtos v 2 2) " m/s | Pressure Loss: " (rtos dp 2 4) " Pa/m | Hydraulic Diameter: " (rtos dh_mm 2 1) " mm")
          )
        )
        (set_tile "res_rect" "Invalid Width or Height.")
      )
    )
  )
)

;; ===============================
;; DCL GENERATION
;; ===============================
(defun make_dcl_dcheck_final (/ f_path f)
  (setq f_path (strcat (getvar "TEMPPREFIX") "DCheck_Final_Fixed.dcl"))
  (setq f (open f_path "w"))
  (write-line "DCheck : dialog { label = \"DCHECK - DUCT PRESSURE LOSS CHECKER\"; fixed_width = true;" f)
  (write-line " : column { width = 75;" f) ;; Increase width to display long text without cropping
  
  (write-line "  : boxed_column { label = \"COMMON INPUTS\";" f)
  (write-line "    : edit_box { label = \"Air Flow (L/s)             :\"; key = \"eb_airflow\"; edit_width = 15; }" f)
  (write-line "    : row { : column { : text { label = \"Air Density (kg/m3)        :\"; color = red; } } : column { : edit_box { key = \"eb_density\"; edit_width = 15; } } }" f)
  (write-line "    : row { : column { : text { label = \"Duct Roughness (mm)       :\"; color = red; } } : column { : edit_box { key = \"eb_roughness\"; edit_width = 15; } } }" f)
  (write-line "    : edit_box { label = \"Dynamic Viscosity (Pa.s)   :\"; key = \"eb_viscosity\"; edit_width = 15; }" f)
  (write-line "    : spacer { height = 0.5; }" f)
  (write-line "    : text { label = \"Note: Galvanized Metal (0.09), Stainless Steel (0.15), PVC Plastic (0.01)\"; small_font = true; }" f)
  (write-line "  }" f)

  (write-line "  : boxed_column { label = \"ROUND DUCT\";" f)
  (write-line "    : edit_box { label = \"Diameter (mm)             :\"; key = \"eb_round_dia\"; edit_width = 15; }" f)
  (write-line "    : text { key = \"res_round\"; is_bold = true; }" f)
  (write-line "  }" f)

  (write-line "  : boxed_column { label = \"RECTANGULAR DUCT\";" f)
  (write-line "    : row { : edit_box { label = \"Width (mm) :\"; key = \"eb_rect_w\"; edit_width = 10; } : edit_box { label = \"Height (mm) :\"; key = \"eb_rect_h\"; edit_width = 10; } }" f)
  ;; Used for rectangular duct results to display fully
  (write-line "    : text { key = \"res_rect\"; is_bold = true; }" f)
  (write-line "  }" f)

  (write-line "  : row { alignment = centered;" f)
  (write-line "    : button { label = \"Calculate\"; key = \"btn_calc\"; width = 20; is_default = true; }" f)
  (write-line "    : button { label = \"Close\"; key = \"cancel\"; width = 20; is_cancel = true; }" f)
  (write-line "  }" f)
  (write-line " } }" f)
  (close f)
  f_path
)

;; --- Friction Factor Calculation ---
(defun calc_f_dcheck_final (re ks dh / f new_f err)
  (cond
    ((< re 2000) (/ 64.0 re))
    ((>= re 4000)
     (setq f 0.02 err 1.0)
     (while (> err 0.00001)
       (setq new_f (/ 1.0 (expt (* -2.0 (/ (log (+ (/ ks (* 3.7 dh)) (/ 2.51 (* re (sqrt f))))) (log 10.0))) 2)))
       (setq err (abs (- new_f f)))
       (setq f new_f)
     )
     f)
    (t (/ 0.3164 (expt re 0.25)))
  )
)

(princ "\n--- DCheck (TBH Toolkit) loaded. Type DCHECK to start. ---")
(princ)