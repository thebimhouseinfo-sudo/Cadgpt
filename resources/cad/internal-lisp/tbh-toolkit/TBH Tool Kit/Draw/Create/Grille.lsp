;;; =============================================================================
;;; GOKUDEV-HEADER-START
;;;
;;; File        : Grille.lsp
;;; Module      : HVAC - Grille
;;; Command     : GRR
;;; Description : Master command for generating Grilles.
;;;               Options: 1=Eggcrate, 2=Bar Grille, 3=Double Deflection, 4=Side wall
;;;
;;; GOKUDEV-HEADER-END
;;; =============================================================================

(vl-load-com)

;;; =============================================================================
;;; UTILS / ERRORS
;;; =============================================================================

;; Load MEP Properties for attribute handling
(if (findfile "MEP Properties.lsp")
  (load (findfile "MEP Properties.lsp"))
)

;; Helper function to fix layer of entities inside block definition
(defun Grille:FixBlockLayers (blkName layerMain layerShade layerTemp / doc blocks blkDef obj entData layerName)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object))
        blocks (vla-get-Blocks doc)
        blkDef (vla-Item blocks blkName))
  (vlax-for obj blkDef
    (setq entData (entget (vlax-vla-object->ename obj)))
    (setq layerName (cdr (assoc 8 entData)))
    (if (= layerName layerTemp)
      (progn
        ;; Determine correct layer based on entity type
        (if (and layerShade (= (vla-get-ObjectName obj) "AcDbHatch"))
          (setq layerName layerShade)
          (setq layerName layerMain)
        )
        (setq entData (subst (cons 8 layerName) (assoc 8 entData) entData))
        (entmod entData)
      )
    )
  )
)

(defun Grille_Error (msg)
  (if (not (member msg '("Function cancelled" "quit / exit abort")))
    (princ (strcat "\n[GRR] Error: " msg))
  )
  (if *gr_old_osmode*  (setvar "OSMODE"  *gr_old_osmode*))
  (if *gr_old_cmdecho* (setvar "CMDECHO" *gr_old_cmdecho*))
  (if *gr_old_clayer*  (setvar "CLAYER"  *gr_old_clayer*))
  (command-s "_.undo" "_end")
  (princ)
)

;;; =============================================================================
;;; 1. EGGCRATE GRILLE UTILS
;;; =============================================================================
(defun EG_GetConfig ()
  (list
    '("GRID_SPACE"    . 30.0)
    '("SPLINE_MARGIN" . 15.0)  
    '("SPLINE_PTS_COUNT" . 8)  
    '("LTYPE_DIAG"    . "HD")
    '("COLOR_GRID"    . 8)
    '("COLOR_DIAG"    . 1)
  )
)
(defun EG_GetCfg (key) (cdr (assoc key (EG_GetConfig))))

;; FIX: GRID_SPACE was a fixed 30.0 regardless of grille size. On small
;; grilles (e.g. <= 300mm), the corner triangle legs (0.625*W / 0.625*H)
;; became so short that only 1-2 grid lines fit, making the eggcrate mesh
;; look almost empty. This scales the spacing down (never up) so a small
;; grille still shows a proper number of cells, while large grilles keep
;; the original 30.0 spacing unchanged.
(defun EG_GridSpaceFor (w h / baseSpace legMin minDivisions)
  (setq baseSpace   (EG_GetCfg "GRID_SPACE")
        minDivisions 6.0
        legMin       (min (* w 0.625) (* h 0.625)))
  (if (> legMin 0.0)
    (min baseSpace (/ legMin minDivisions))
    baseSpace
  )
)

(defun EG_Random (/ seed)
  (setq seed (getvar "DATE"))
  (setq seed (* seed 1000000))
  (rem seed 1.0)
)

(defun EG_DiagSide (pt p1 p3)
  (- (* (- (car pt) (car p1)) (- (cadr p3) (cadr p1)))
     (* (- (cadr pt) (cadr p1)) (- (car p3) (car p1))))
)

(defun EG_CreateSplineObj (pa pb target_corner diag_p1 diag_p3 / pts vec_b dist step vec_p i p_mid side_diag_target off_val final_p side_seq current_side start_side)
  (setq pts (list pa))
  (setq vec_b (mapcar '- pb pa)
        dist (distance pa pb)
        step (/ 1.0 7.0) 
        vec_p (list (- (cadr vec_b)) (car vec_b) 0.0)
        vec_p (mapcar '(lambda (x) (/ x dist)) vec_p)
        side_diag_target (if (> (EG_DiagSide target_corner diag_p1 diag_p3) 0) 1.0 -1.0)
  )
  (setq start_side (if (< (EG_Random) 0.5) 1.0 -1.0))
  (setq side_seq (mapcar '(lambda (s) (* s start_side)) '(1.0 -1.0 -1.0 1.0 1.0 -1.0)))

  (setq i 1)
  (foreach s side_seq
    (setq p_mid (mapcar '(lambda (a b) (+ a (* b (* i step)))) pa vec_b))
    (setq off_val (* s (+ 30.0 (* 55.0 (EG_Random)))))
    (setq final_p (mapcar '(lambda (a b) (+ a (* b off_val))) p_mid vec_p))
    (if (or (< (* (EG_DiagSide final_p diag_p1 diag_p3) side_diag_target) 0)
            (> (distance final_p target_corner) (distance pa target_corner)))
      (setq final_p (mapcar '(lambda (a b) (+ a (* b (* side_diag_target -12.0)))) p_mid vec_p))
    )
    (setq pts (append pts (list final_p)))
    (setq i (1+ i))
  )
  (setq pts (append pts (list pb)))

  (command "_.spline") (foreach p pts (command p)) (command "" "" "")
  (vlax-ename->vla-object (entlast))
)

(defun EG_DrawCornerGrid (corner p1 p2 space spline_obj layer / mspace cur_x cur_y tmp_line int_pts p_int min_x max_x min_y max_y start_p best_p d_max d_cur i p_cur)
  (setq mspace (vla-get-modelspace (vla-get-activedocument (vlax-get-acad-object))))
  (setq min_x (min (car corner) (car p1) (car p2))
        max_x (max (car corner) (car p1) (car p2))
        min_y (min (cadr corner) (cadr p1) (cadr p2))
        max_y (max (cadr corner) (cadr p1) (cadr p2)))

  (setq cur_x (+ min_x space))
  (while (< cur_x max_x)
    (setq start_p (list cur_x (if (equal (cadr corner) min_y 0.01) min_y max_y) 0))
    (setq tmp_line (vla-addLine mspace (vlax-3d-point (list cur_x (- min_y 100) 0)) (vlax-3d-point (list cur_x (+ max_y 100) 0))))
    (setq int_pts (vlax-invoke tmp_line 'IntersectWith spline_obj acExtendNone))
    
    (if (and int_pts (>= (length int_pts) 3))
      (progn
        (setq i 0 best_p nil d_max -1.0)
        (while (< i (length int_pts))
          (setq p_cur (list (nth i int_pts) (nth (+ i 1) int_pts) (nth (+ i 2) int_pts)))
          (setq d_cur (distance start_p p_cur))
          (if (> d_cur d_max) (setq d_max d_cur best_p p_cur))
          (setq i (+ i 3))
        )
         (if best_p
           (progn
             ;; IntersectWith can return a spline point just outside the
             ;; grille rectangle on small/ tightly curved eggcrates. Clamp
             ;; the endpoint so every grid line remains inside the boundary.
             (setq best_p
               (list (max min_x (min max_x (car best_p)))
                     (max min_y (min max_y (cadr best_p)))
                     0.0))
             (entmake (list '(0 . "LINE") (cons 10 start_p) (cons 11 best_p)
                            (cons 8 layer) (cons 62 (EG_GetCfg "COLOR_GRID")))))
         )
      )
    )
    (vla-delete tmp_line)
    (setq cur_x (+ cur_x space))
  )

  (setq cur_y (+ min_y space))
  (while (< cur_y max_y)
    (setq start_p (list (if (equal (car corner) min_x 0.01) min_x max_x) cur_y 0))
    (setq tmp_line (vla-addLine mspace (vlax-3d-point (list (- min_x 100) cur_y 0)) (vlax-3d-point (list (+ max_x 100) cur_y 0))))
    (setq int_pts (vlax-invoke tmp_line 'IntersectWith spline_obj acExtendNone))
    
    (if (and int_pts (>= (length int_pts) 3))
      (progn
        (setq i 0 best_p nil d_max -1.0)
        (while (< i (length int_pts))
          (setq p_cur (list (nth i int_pts) (nth (+ i 1) int_pts) (nth (+ i 2) int_pts)))
          (setq d_cur (distance start_p p_cur))
          (if (> d_cur d_max) (setq d_max d_cur best_p p_cur))
          (setq i (+ i 3))
        )
        (if best_p
          (progn
            ;; Keep the horizontal grid endpoint inside the grille boundary.
            (setq best_p
              (list (max min_x (min max_x (car best_p)))
                    (max min_y (min max_y (cadr best_p)))
                    0.0))
            (entmake (list '(0 . "LINE") (cons 10 start_p) (cons 11 best_p)
                           (cons 8 layer) (cons 62 (EG_GetCfg "COLOR_GRID")))))
        )
      )
    )
    (vla-delete tmp_line)
    (setq cur_y (+ cur_y space))
  )
)

(defun Grille:Eggcrate (/ sys_input sys_name layer_main layer_shade pt_c w h prefix g1 g2 g3 g4 h1 h2 h3 h4 dx dy blk_name ss_blk ent_last_prev spline1 spline2 ent_rect ent_next eg_grid_space)
  (initget "1 2 3 4 5 SA RA OA EA TA")
  (setq sys_input (getkword "\nSelect system [1-SA/2-RA/3-OA/4-EA/5-TA] <2>: "))
  (if (not sys_input) (setq sys_input "2"))

  (cond
    ((or (= sys_input "1") (= sys_input "SA")) (setq sys_name "SA" prefix "Hvac-SA"))
    ((or (= sys_input "2") (= sys_input "RA")) (setq sys_name "RA" prefix "Hvac-RA"))
    ((or (= sys_input "3") (= sys_input "OA")) (setq sys_name "OA" prefix "Hvac-OA"))
    ((or (= sys_input "4") (= sys_input "EA")) (setq sys_name "EA" prefix "Hvac-EA"))
    ((or (= sys_input "5") (= sys_input "TA")) (setq sys_name "TA" prefix "Hvac-TA"))
  )
  (setq layer_main (strcat prefix "Grille")
        layer_shade (strcat layer_main "Shade")
        layer_temp (strcat "TEMP-" (rtos (* (getvar "DATE") 1000000) 2 0)))

  (if (not (tblsearch "LAYER" layer_main))
    (command "_.layer" "_make" layer_main ""))
  (if (not (tblsearch "LAYER" layer_shade))
    (command "_.layer" "_make" layer_shade ""))
  (if (tblsearch "LAYER" layer_temp)
    (command "_.layer" "_delete" layer_temp ""))
  (command "_.layer" "_make" layer_temp "")

  (if (not (setq pt_c (getpoint "\nPick center insertion point: "))) (exit))

  (setq w (getdist pt_c "\nEnter Width W <600.0>: "))
  (if (not w) (setq w 600.0))

  (setq h (getdist pt_c "\nEnter Height H <600.0>: "))
  (if (not h) (setq h 600.0))

  (setvar "OSMODE" 0)

  (setq dx (/ w 2.0) dy (/ h 2.0))
  (setq g1 (list (- (car pt_c) dx) (- (cadr pt_c) dy) 0.0)
        g2 (list (- (car pt_c) dx) (+ (cadr pt_c) dy) 0.0)
        g3 (list (+ (car pt_c) dx) (+ (cadr pt_c) dy) 0.0)
        g4 (list (+ (car pt_c) dx) (- (cadr pt_c) dy) 0.0))

  (setq h1 (polar g2 (* pi 1.5) (* h 0.625))
        h2 (polar g2 0 (* w 0.625))
        h3 (polar g4 (* pi 0.5) (* h 0.625))
        h4 (polar g4 pi (* w 0.625)))

  (setq ent_last_prev (entlast))

  (command "_.rectang" g1 g3)
  (setq ent_rect (entlast))
  (command "_.hatch" "Solid" ent_rect "")
  (command "_.chprop" (entlast) "" "_layer" layer_temp "")
  (command "_.draworder" (entlast) "" "_back")
  (command "_.chprop" ent_rect "" "_layer" layer_temp "")

  (command "_.line" g1 g3 "")
  (command "_.chprop" (entlast) "" "_layer" layer_temp "_color" (EG_GetCfg "COLOR_DIAG") "_ltype" (EG_GetCfg "LTYPE_DIAG") "")

  (setq eg_grid_space (EG_GridSpaceFor w h))

  (setq spline1 (EG_CreateSplineObj h1 h2 g2 g1 g3))
  (EG_DrawCornerGrid g2 h1 h2 eg_grid_space spline1 layer_temp)
  (vla-delete spline1)

  ;; FIX: previously this second (opposite-corner) grid only drew when
  ;; both W and H exceeded 300, leaving small grilles with a grid on only
  ;; one corner (looking mostly empty). Now it always draws, using the
  ;; same size-aware spacing as the first corner.
  (progn
    (setq spline2 (EG_CreateSplineObj h3 h4 g4 g1 g3))
    (EG_DrawCornerGrid g4 h3 h4 eg_grid_space spline2 layer_temp)
    (vla-delete spline2)
  )

  (setq blk_name (strcat "GR-EC-" sys_name "-" (rtos w 2 0) "x" (rtos h 2 0) "-" (substr (rtos (* (getvar "DATE") 1000000) 2 0) 10)))
  (setq ss_blk (ssget "X" (list (cons 8 layer_temp))))
  (command "_.block" blk_name pt_c ss_blk "")

  (command "_.insert" blk_name pt_c 1.0 1.0 0.0)
  (command "_.chprop" (entlast) "" "_layer" layer_main "")

  ;; Change layer of entities inside block definition to correct layers
  (Grille:FixBlockLayers blk_name layer_main layer_shade layer_temp)

  ;; Delete temporary layer
  (command "_.layer" "_delete" layer_temp "")

  ;; Initialize MEP attributes if MEP Properties is loaded
  (if (and (boundp 'GT:InitGrilleAttributes) GT:InitGrilleAttributes)
    (GT:InitGrilleAttributes (entlast) layer_main)
  )
  (if (and (boundp 'GT:SetAttrValue) GT:SetAttrValue)
    (GT:SetAttrValue (entlast) "GRILLE_TYPE" "Eggcrate")
  )
  (setvar "OSMODE" *gr_old_osmode*)
  (princ "\n--- Done. Rotate to set installation direction ---")
  (command "_.rotate" (entlast) "" pt_c pause)
  (princ (strcat "\nSuccess: " blk_name))
)

;;; =============================================================================
;;; 2. BAR GRILLE
;;; =============================================================================
(defun Grille:BarGrille (/ sys_input sys_name prefix layer_main layer_shade layer_temp pt_c w h odx ody idx idy o1 o3 i1 i3 ent_bar blk_name ss_blk ent_last_prev ent_next blk_ent)
  (initget "1 2 3 4 5 SA RA OA EA TA")
  (setq sys_input (getkword "\nSelect system [1-SA/2-RA/3-OA/4-EA/5-TA] <2>: "))
  (if (not sys_input) (setq sys_input "2"))

  (cond
    ((or (= sys_input "1") (= sys_input "SA")) (setq sys_name "SA" prefix "Hvac-SA"))
    ((or (= sys_input "2") (= sys_input "RA")) (setq sys_name "RA" prefix "Hvac-RA"))
    ((or (= sys_input "3") (= sys_input "OA")) (setq sys_name "OA" prefix "Hvac-OA"))
    ((or (= sys_input "4") (= sys_input "EA")) (setq sys_name "EA" prefix "Hvac-EA"))
    ((or (= sys_input "5") (= sys_input "TA")) (setq sys_name "TA" prefix "Hvac-TA"))
  )
  (setq layer_main  (strcat prefix "Grille")
        layer_shade (strcat prefix "GrilleShade")
        layer_temp  (strcat "TEMP-" (rtos (* (getvar "DATE") 1000000) 2 0)))

  (if (not (tblsearch "LAYER" layer_main))
    (command "_.layer" "_make" layer_main ""))
  (if (not (tblsearch "LAYER" layer_shade))
    (command "_.layer" "_make" layer_shade ""))
  (if (tblsearch "LAYER" layer_temp)
    (command "_.layer" "_delete" layer_temp ""))
  (command "_.layer" "_make" layer_temp "")

  (if (not (setq pt_c (getpoint "\nPick center insertion point: "))) (exit))

  (setq w (getdist pt_c "\nEnter Width W <600.0>: "))
  (if (not w) (setq w 600.0))

  (setq h (getdist pt_c "\nEnter Height H <600.0>: "))
  (if (not h) (setq h 600.0))

  (setvar "OSMODE" 0)

  (setq idx (/ w 2.0)  idy (/ h 2.0))
  (setq i1 (list (- (car pt_c) idx) (- (cadr pt_c) idy) 0.0)
        i3 (list (+ (car pt_c) idx) (+ (cadr pt_c) idy) 0.0))

  (setq odx (+ idx 25.0)  ody (+ idy 25.0))
  (setq o1 (list (- (car pt_c) odx) (- (cadr pt_c) ody) 0.0)
        o3 (list (+ (car pt_c) odx) (+ (cadr pt_c) ody) 0.0))

  (setq ent_last_prev (entlast))

  (command "_.rectang" o1 o3)
  (command "_.chprop" (entlast) "" "_layer" layer_temp "_color" "ByLayer" "")

  (command "_.rectang" i1 i3)
  (setq ent_bar (entlast))
  (command "_.chprop" ent_bar "" "_layer" layer_temp "_color" "ByLayer" "")

  (setvar "CLAYER" layer_temp)
  (setvar "CECOLOR" "BYLAYER")
  (command "_.hatch" "SOLID" ent_bar "")
  (if (not (eq (entlast) ent_bar))
    (command "_.draworder" (entlast) "" "_back")
  )

  (setvar "CLAYER" layer_temp)
  (setvar "CECOLOR" "8")
  (command "_.hatch" "ANSI31" "16" "315" ent_bar "")

  (setvar "CECOLOR" "BYLAYER")

  (setq blk_name (strcat "GR-BG-" sys_name
                         "-" (rtos w 2 0) "x" (rtos h 2 0)
                         "-" (substr (rtos (* (getvar "DATE") 1000000) 2 0) 10)))
  (setq ss_blk (ssget "X" (list (cons 8 layer_temp))))
  (command "_.block" blk_name pt_c ss_blk "")

  (command "_.insert" blk_name pt_c 1.0 1.0 0.0)
  (setq blk_ent (entlast))
  (command "_.chprop" blk_ent "" "_layer" layer_main "")

  ;; Change layer of entities inside block definition to correct layers
  (Grille:FixBlockLayers blk_name layer_main layer_shade layer_temp)

  ;; Delete temporary layer
  (command "_.layer" "_delete" layer_temp "")

  ;; Initialize MEP attributes if MEP Properties is loaded
  (if (and (boundp 'GT:InitGrilleAttributes) GT:InitGrilleAttributes)
    (GT:InitGrilleAttributes blk_ent layer_main)
  )
  (if (and (boundp 'GT:SetAttrValue) GT:SetAttrValue)
    (GT:SetAttrValue blk_ent "GRILLE_TYPE" "Bar Grille")
  )
  (setvar "OSMODE"  *gr_old_osmode*)
  (princ "\n--- Done. Rotate to set installation direction ---")
  (command "_.rotate" blk_ent "" pt_c pause)
  (princ (strcat "\nSuccess: " blk_name))
)

;;; =============================================================================
;;; 3. DOUBLE DEFLECTION GRILLE
;;; =============================================================================
(defun Grille:DoubleDeflection (/ sys_input sys_name prefix layer_main layer_shade layer_temp pt_c w h odx ody idx idy o1 o3 i1 i3 ent_bar blk_name ss_blk ent_last_prev ent_next blk_ent)
  (initget "1 2 3 4 5 SA RA OA EA TA")
  (setq sys_input (getkword "\nSelect system [1-SA/2-RA/3-OA/4-EA/5-TA] <2>: "))
  (if (not sys_input) (setq sys_input "2"))

  (cond
    ((or (= sys_input "1") (= sys_input "SA")) (setq sys_name "SA" prefix "Hvac-SA"))
    ((or (= sys_input "2") (= sys_input "RA")) (setq sys_name "RA" prefix "Hvac-RA"))
    ((or (= sys_input "3") (= sys_input "OA")) (setq sys_name "OA" prefix "Hvac-OA"))
    ((or (= sys_input "4") (= sys_input "EA")) (setq sys_name "EA" prefix "Hvac-EA"))
    ((or (= sys_input "5") (= sys_input "TA")) (setq sys_name "TA" prefix "Hvac-TA"))
  )
  (setq layer_main  (strcat prefix "Grille")
        layer_shade (strcat prefix "GrilleShade")
        layer_temp  (strcat "TEMP-" (rtos (* (getvar "DATE") 1000000) 2 0)))

  (if (not (tblsearch "LAYER" layer_main))
    (command "_.layer" "_make" layer_main ""))
  (if (not (tblsearch "LAYER" layer_shade))
    (command "_.layer" "_make" layer_shade ""))
  (if (tblsearch "LAYER" layer_temp)
    (command "_.layer" "_delete" layer_temp ""))
  (command "_.layer" "_make" layer_temp "")

  (if (not (setq pt_c (getpoint "\nPick center insertion point: "))) (exit))

  (setq w (getdist pt_c "\nEnter Width W <600.0>: "))
  (if (not w) (setq w 600.0))

  (setq h (getdist pt_c "\nEnter Height H <600.0>: "))
  (if (not h) (setq h 600.0))

  (setvar "OSMODE" 0)

  (setq idx (/ w 2.0)  idy (/ h 2.0))
  (setq i1 (list (- (car pt_c) idx) (- (cadr pt_c) idy) 0.0)
        i3 (list (+ (car pt_c) idx) (+ (cadr pt_c) idy) 0.0))

  (setq odx (+ idx 25.0)  ody (+ idy 25.0))
  (setq o1 (list (- (car pt_c) odx) (- (cadr pt_c) ody) 0.0)
        o3 (list (+ (car pt_c) odx) (+ (cadr pt_c) ody) 0.0))

  (setq ent_last_prev (entlast))

  (command "_.rectang" o1 o3)
  (command "_.chprop" (entlast) "" "_layer" layer_temp "_color" "ByLayer" "")

  (command "_.rectang" i1 i3)
  (setq ent_bar (entlast))
  (command "_.chprop" ent_bar "" "_layer" layer_temp "_color" "ByLayer" "")

  (setvar "CLAYER" layer_temp)
  (setvar "CECOLOR" "BYLAYER")
  (command "_.hatch" "SOLID" ent_bar "")
  (if (not (eq (entlast) ent_bar))
    (command "_.draworder" (entlast) "" "_back")
  )

  (setvar "CLAYER" layer_temp)
  (setvar "CECOLOR" "8")
  (command "_.hatch" "ANSI37" "16" "45" ent_bar "")

  (setvar "CECOLOR" "BYLAYER")

  (setq blk_name (strcat "GR-DDG-" sys_name
                         "-" (rtos w 2 0) "x" (rtos h 2 0)
                         "-" (substr (rtos (* (getvar "DATE") 1000000) 2 0) 10)))
  (setq ss_blk (ssget "X" (list (cons 8 layer_temp))))
  (command "_.block" blk_name pt_c ss_blk "")

  (command "_.insert" blk_name pt_c 1.0 1.0 0.0)
  (setq blk_ent (entlast))
  (command "_.chprop" blk_ent "" "_layer" layer_main "")

  ;; Change layer of entities inside block definition to correct layers
  (Grille:FixBlockLayers blk_name layer_main layer_shade layer_temp)

  ;; Delete temporary layer
  (command "_.layer" "_delete" layer_temp "")

  ;; Initialize MEP attributes if MEP Properties is loaded
  (if (and (boundp 'GT:InitGrilleAttributes) GT:InitGrilleAttributes)
    (GT:InitGrilleAttributes blk_ent layer_main)
  )
  (if (and (boundp 'GT:SetAttrValue) GT:SetAttrValue)
    (GT:SetAttrValue blk_ent "GRILLE_TYPE" "Double Deflection")
  )
  (setvar "OSMODE"  *gr_old_osmode*)
  (princ "\n--- Done. Rotate to set installation direction ---")
  (command "_.rotate" blk_ent "" pt_c pause)
  (princ (strcat "\nSuccess: " blk_name))
)

;;; =============================================================================
;;; 4. SIDEWALL GRILLE
;;; =============================================================================
(defun Grille:Sidewall (/ sys_input sys_name layer_main layer_temp pt_c w prefix dx pt1 pt2 pt3 pt4 pt5 pt6 blk_name ss_blk ent_next ent_last_prev)
  (initget "1 2 3 4 5 SA RA OA EA TA")
  (setq sys_input (getkword "\nSelect system [1-SA/2-RA/3-OA/4-EA/5-TA] <2>: "))
  (if (not sys_input) (setq sys_input "2"))

  (cond
    ((or (= sys_input "1") (= sys_input "SA")) (setq sys_name "SA" prefix "Hvac-SA"))
    ((or (= sys_input "2") (= sys_input "RA")) (setq sys_name "RA" prefix "Hvac-RA"))
    ((or (= sys_input "3") (= sys_input "OA")) (setq sys_name "OA" prefix "Hvac-OA"))
    ((or (= sys_input "4") (= sys_input "EA")) (setq sys_name "EA" prefix "Hvac-EA"))
    ((or (= sys_input "5") (= sys_input "TA")) (setq sys_name "TA" prefix "Hvac-TA"))
  )
  (setq layer_main (strcat prefix "Grille")
        layer_temp (strcat "TEMP-" (rtos (* (getvar "DATE") 1000000) 2 0)))

  (if (not (tblsearch "LAYER" layer_main))
    (command "_.layer" "_make" layer_main ""))
  (if (tblsearch "LAYER" layer_temp)
    (command "_.layer" "_delete" layer_temp ""))
  (command "_.layer" "_make" layer_temp "")

  (if (not (setq pt_c (getpoint "\nPick insertion base point P0: "))) (exit))

  (setq w (getdist pt_c "\nEnter Width W <600.0>: "))
  (if (not w) (setq w 600.0))

  (setvar "OSMODE" 0)

  (setq dx (/ w 2.0))
  (setq pt1 (list (- (car pt_c) dx) (cadr pt_c) 0.0)
        pt2 (list (+ (car pt_c) dx) (cadr pt_c) 0.0)
        pt3 (list (+ (car pt_c) dx) (- (cadr pt_c) 50.0) 0.0)
        pt4 (list (- (car pt_c) dx) (- (cadr pt_c) 50.0) 0.0)
        pt5 (list (- (car pt_c) (+ dx 50.0)) (- (cadr pt_c) 50.0) 0.0)
        pt6 (list (+ (car pt_c) (+ dx 50.0)) (- (cadr pt_c) 50.0) 0.0))

  (setq ent_last_prev (entlast))

  (command "_.rectang" pt1 pt3)
  (command "_.chprop" (entlast) "" "_layer" layer_temp "")

  (command "_.line" pt5 pt6 "")
  (command "_.chprop" (entlast) "" "_layer" layer_temp "")

  (setq blk_name (strcat "GR-SW-" sys_name "-" (rtos w 2 0) "-" (substr (rtos (* (getvar "DATE") 1000000) 2 0) 10)))
  (setq ss_blk (ssget "X" (list (cons 8 layer_temp))))
  (command "_.block" blk_name pt_c ss_blk "")

  (command "_.insert" blk_name pt_c 1.0 1.0 0.0)
  (command "_.chprop" (entlast) "" "_layer" layer_main "")

  ;; Change layer of entities inside block definition to correct layers
  (Grille:FixBlockLayers blk_name layer_main nil layer_temp)

  ;; Delete temporary layer
  (command "_.layer" "_delete" layer_temp "")

  ;; Initialize MEP attributes if MEP Properties is loaded
  (if (and (boundp 'GT:InitGrilleAttributes) GT:InitGrilleAttributes)
    (GT:InitGrilleAttributes (entlast) layer_main)
  )
  (if (and (boundp 'GT:SetAttrValue) GT:SetAttrValue)
    (GT:SetAttrValue (entlast) "GRILLE_TYPE" "Side Wall")
  )
  (setvar "OSMODE" *gr_old_osmode*)
  (princ "\n--- Done. Rotate to set installation direction ---")
  (command "_.rotate" (entlast) "" pt_c pause)
  (princ (strcat "\nSuccess: " blk_name))
)

;;; =============================================================================
;;; MASTER COMMAND: GRR
;;; =============================================================================
(defun C:GRR (/ *gr_old_osmode* *gr_old_cmdecho* *gr_old_clayer* *error* gtype)
  (setq *gr_old_osmode*  (getvar "OSMODE")
        *gr_old_cmdecho* (getvar "CMDECHO")
        *gr_old_clayer*  (getvar "CLAYER")
        *error*          Grille_Error)

  (setvar "CMDECHO" 0)
  (command "_.undo" "_begin")

  (initget "1 2 3 4")
  (setq gtype (getkword "\nCreate: [1] Eggcrate / [2] Bar Grille / [3] Double deflection / [4] Side wall <1>: "))
  (if (not gtype) (setq gtype "1"))

  (cond
    ((= gtype "1") (Grille:Eggcrate))
    ((= gtype "2") (Grille:BarGrille))
    ((= gtype "3") (Grille:DoubleDeflection))
    ((= gtype "4") (Grille:Sidewall))
  )

  (setvar "OSMODE"  *gr_old_osmode*)
  (setvar "CMDECHO" *gr_old_cmdecho*)
  (setvar "CLAYER"  *gr_old_clayer*)
  (command "_.undo" "_end")
  (princ)
)

(princ "\n--- Grille Master Loaded. Type GRR to start. ---")
(princ)
