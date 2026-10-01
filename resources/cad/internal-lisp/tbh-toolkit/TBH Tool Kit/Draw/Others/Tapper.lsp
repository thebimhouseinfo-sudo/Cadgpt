;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Tapper.lsp
;;; Module      : Draw\Others
;;; Command     : Tapper, DRAWOVALDUCT
;;; Description : Creates tap-in fittings for branch duct connections.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select main duct.
;;; 3. Select branch duct to auto-generate the Tapper (Takeoff) collar.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── MAIN COMMAND ───────────────────────────────────
(defun c:Tapper (/ *error* old_layer old_cmdecho old_osmode sys_type
                      pt dia_input dia hgt_input hgt wid draw_layer hatch_layer text_layer
                      p1 p2 p3 p4 half_wid half_hgt txt_str hatch_target_ent hatch_ent text_ent)

  (defun *error* (msg)
    (if old_layer (setvar "CLAYER" old_layer))
    (if old_cmdecho (setvar "CMDECHO" old_cmdecho))
    (if old_osmode (setvar "OSMODE" old_osmode))
    (if (and msg (/= msg "")) (princ (strcat "\n[TAPPER] Error: " msg)))
    (princ))

  (if (not (boundp '*default_dia*)) (setq *default_dia* 100.0))
  (setq old_layer (getvar "CLAYER") old_cmdecho (getvar "CMDECHO") old_osmode (getvar "OSMODE"))
  (setvar "CMDECHO" 0)

  (initget 1 "1 2 3 4 5")
  (setq sys_type (getkword "\nCreate: 1 = SA / 2 = RA / 3 = OA / 4 = EA / 5 = TA: "))
  (setq draw_layer (cond
                     ((= sys_type "1") "Hvacduct-sa")
                     ((= sys_type "2") "Hvacduct-ra")
                      ((= sys_type "3") "Hvacduct-oa")
                      ((= sys_type "4") "Hvacduct-ea")
                     ((= sys_type "5") "Hvacduct-ta")
                     (t "Hvacduct-sa")
                   ))
  (if (not (tblsearch "LAYER" draw_layer))
    (vl-cmdf "_.LAYER" "_M" draw_layer "")
  )

  (setq pt (getpoint "\nSpecify center point of duct section: "))
  (if (not pt) (*error* "Cancelled"))

  (initget 6) (setq dia_input (getdist pt (strcat "\nEnter Diameter D <" (rtos *default_dia* 2 2) ">: ")))
  (if dia_input (setq dia dia_input *default_dia* dia_input) (setq dia *default_dia*))

  (initget 6) (setq hgt_input (getreal (strcat "\nEnter Section Height H <" (rtos dia 2 2) ">: ")))
  (setq hgt (if (and hgt_input (> hgt_input 0.0)) hgt_input dia))

  (setvar "OSMODE" 0) (setvar "CLAYER" draw_layer)

  (if (= hgt dia)
    (progn 
      (vl-cmdf "_.CIRCLE" pt "D" dia) (setq hatch_target_ent (entlast))
      (setq hatch_layer (strcat draw_layer "-shading"))
      (if (tblsearch "LAYER" hatch_layer) 
        (progn (setvar "CLAYER" hatch_layer) (vl-cmdf "-HATCH" "_P" "SOLID" "_LA" hatch_layer "_S" hatch_target_ent "" "") (setq hatch_ent (entlast))))
      (setq text_layer "Hvacduct-Text" txt_str (strcat (rtos dia 2 0) "%%C"))
      (if (tblsearch "LAYER" text_layer) 
        (progn (setvar "CLAYER" text_layer) (vl-cmdf "_.TEXT" "S" "HVACS" "J" "MC" pt 100.0 0.0 txt_str) (setq text_ent (entlast)))))
    (progn 
      (setq wid (/ (* dia dia) hgt) half_wid (/ wid 2.0) half_hgt (/ hgt 2.0) p1 (polar (polar pt (* 1.5 pi) half_hgt) pi half_wid) p2 (polar (polar pt (* 1.5 pi) half_hgt) 0.0 half_wid) p3 (polar (polar pt (* 0.5 pi) half_hgt) 0.0 half_wid) p4 (polar (polar pt (* 0.5 pi) half_hgt) pi half_wid))
      (vl-cmdf "_.PLINE" p1 p2 p3 p4 "_C") (setq hatch_target_ent (entlast)) (vl-cmdf "_.FILLET" "_R" half_hgt) (vl-cmdf "_.FILLET" "_P" hatch_target_ent)
      (setq hatch_layer (strcat draw_layer "-shading"))
      (if (tblsearch "LAYER" hatch_layer) 
        (progn (setvar "CLAYER" hatch_layer) (vl-cmdf "-HATCH" "_P" "SOLID" "_LA" hatch_layer "_S" hatch_target_ent "" "") (setq hatch_ent (entlast))))
      (setq text_layer "Hvacduct-Text" txt_str (strcat (rtos dia 2 0) "%%C OVAL"))
      (if (tblsearch "LAYER" text_layer) 
        (progn (setvar "CLAYER" text_layer) (vl-cmdf "_.TEXT" "S" "HVACS" "J" "MC" pt 100.0 0.0 txt_str) (setq text_ent (entlast))))))

  (if hatch_ent (vl-cmdf "_.DRAWORDER" hatch_ent "" "B"))
  (if text_ent (vl-cmdf "_.DRAWORDER" text_ent "" "F"))

  (setvar "CLAYER" old_layer) (setvar "CMDECHO" old_cmdecho) (setvar "OSMODE" old_osmode)
  (princ "\n[TBH] Duct section generated.")
  (princ))

(defun c:DRAWOVALDUCT () (c:Tapper))

(princ "\n[TBH] Circular/Oval Section loaded. Type 'TAPPER' to start.")
(princ)
