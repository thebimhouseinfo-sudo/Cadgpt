;; ===========================================================================
;; PROGRAM : TBH CALCULATOR (ENGINEERING VERSION) - V16.4
;; AUTHOR  : GOKUDEV
;; PURPOSE : Duct Connection Calculator with Auto H2 = H1, No Defaults (except Slide 0)
;; COMMAND : TC
;; ===========================================================================

(defun c:TC (/ *error* dcl_id dcl_file file_handle Q history_list active_mode
tokens _peek _consume _parse_factor _parse_term _parse_expr
f_tokenize f_evaluate f_calculate_duct_connection f_calculate_hydraulic
f_clear_inputs f_clear_history f_update_ui_history f_logic)

(vl-load-com)

;; 1. ERROR HANDLING
(defun *error* (msg)
  ;; AutoLISP invokes *error* (not a function named error) on ESC/failure.
  ;; DCL creation may fail before the dialog ID is initialized.
  (if (and file_handle (= (type file_handle) 'FILE))
    (progn (close file_handle) (setq file_handle nil)))
  (if (and (numberp dcl_id) (> dcl_id 0))
    (progn (unload_dialog dcl_id) (setq dcl_id nil)))
  (if (and (= (type dcl_file) 'STR) (findfile dcl_file))
    (vl-file-delete dcl_file))
  (if (and (= (type msg) 'STR)
           (not (wcmatch (strcase msg) "*CANCEL*,*QUIT*,*EXIT*,*BREAK*")))
    (princ (strcat "\nError: " msg)))
  (princ)
)

;; 2. CONFIGURATION
(setq Q (chr 34)
active_mode "MATH"
history_list '())

;; 3. NATIVE MATH PARSER (Recursive Descent)
(defun f_tokenize (s / i c res tmp)
(setq i 1 s (vl-string-translate " " "" s))
(while (<= i (strlen s))
(setq c (substr s i 1))
(cond
((member c '("+" "-" "*" "/" "(" ")"))
(setq res (cons c res) i (1+ i)))
((member c '("0" "1" "2" "3" "4" "5" "6" "7" "8" "9" "."))
(setq tmp "")
(while (and (<= i (strlen s))
(member (setq c (substr s i 1)) '("0" "1" "2" "3" "4" "5" "6" "7" "8" "9" ".")))
(setq tmp (strcat tmp c) i (1+ i)))
(setq res (cons tmp res)))
(t (setq i (1+ i))))
)
(reverse res)
)

(defun _peek () (car tokens))
(defun _consume () (setq tokens (cdr tokens)))

(defun _parse_factor (/ tk val)
(setq tk (_peek))
(cond
((= tk "(")
(_consume)
(setq val (_parse_expr))
(if (= (_peek) ")") (_consume))
val)
((and tk (/= tk "")) (setq val (atof tk)) (_consume) val)
(t 0.0)
)
)

(defun _parse_term (/ val op)
(setq val (_parse_factor))
(while (member (setq op (_peek)) '("*" "/"))
(_consume)
(if (= op "*")
(setq val (* val (_parse_factor)))
(setq val (/ val (float (_parse_factor)))))
)
val
)

(defun _parse_expr (/ val op)
(setq val (_parse_term))
(while (member (setq op (_peek)) '("+" "-"))
(_consume)
(if (= op "+")
(setq val (+ val (_parse_term)))
(setq val (- val (_parse_term))))
)
val
)

(defun f_evaluate (expr / res)
(setq tokens (f_tokenize expr))
(if tokens
(vl-catch-all-apply '(lambda () (_parse_expr)) nil)
nil
)
)

;; 3.5 HYDRAULIC EQUIVALENCE LOGIC
(defun f_calculate_hydraulic (/ wo ho h2 w2 rh denom log_str)
  (setq wo (atof (get_tile "hyd_wo"))
        ho (atof (get_tile "hyd_ho"))
        h2 (atof (get_tile "hyd_h2")))
  (if (or (<= wo 0) (<= ho 0) (<= h2 0))
    (progn
      (set_tile "hyd_w2" "Error: Invalid inputs")
      (set_tile "hyd_r" "")
    )
    (progn
      (setq rh (/ (* wo ho) (* 2.0 (+ wo ho))))
      (setq denom (- h2 (* 2.0 rh)))
      (if (<= denom 0)
        (progn
          (set_tile "hyd_w2" "Error: H2 too small")
          (set_tile "hyd_r" (rtos rh 2 2))
        )
        (progn
          (setq w2 (/ (* 2.0 rh h2) denom))
          (set_tile "hyd_w2" (rtos w2 2 2))
          (set_tile "hyd_r" (rtos rh 2 2))
          (setq log_str (strcat "Hyd Eq: Wo=" (rtos wo 2 0) " Ho=" (rtos ho 2 0) " H2=" (rtos h2 2 0) " -> W2=" (rtos w2 2 0) " Rh=" (rtos rh 2 2)))
          (if (> (length history_list) 0)
            (f_update_ui_history "----------------------------------------")
          )
          (f_update_ui_history log_str)
        )
      )
    )
  )
)

;; 4. DUCT CONNECTION LOGIC
(defun f_calculate_duct_connection (/ h1 h2 elev1_type elev1_val
slide_up slide_down offset
bod1 cod1 tod1 ref2
bod2 cod2 tod2
log_str1 log_str2 log_str3
elev1_name ref2_name)
(setq h1 (atof (get_tile "duct1_h"))
h2 (atof (get_tile "duct2_h"))
elev1_type (atoi (get_tile "duct1_elev_type"))
elev1_val (atof (get_tile "duct1_elev_val"))
slide_up (atof (get_tile "slide_up"))
slide_down (atof (get_tile "slide_down"))
duct2_ref_type (atoi (get_tile "duct2_ref_type"))
)

;; Validate inputs
(if (or (<= h1 0) (<= h2 0) (<= elev1_val 0))
(progn
(if (<= h1 0) (set_tile "duct2_bod" "Error: H1 is empty or zero"))
(if (<= h2 0) (set_tile "duct2_bod" "Error: H2 is empty or zero"))
(if (<= elev1_val 0) (set_tile "duct2_bod" "Error: Elevation value is empty or zero"))
(set_tile "duct2_cod" "")
(set_tile "duct2_tod" "")
)
(progn
(setq offset (- slide_up slide_down))

(setq elev1_name (nth elev1_type '("BOD" "COD" "TOD")))

;; Calculate BOD1, COD1, TOD1
(cond
((= elev1_type 0) ; BOD
(setq bod1 elev1_val
cod1 (+ bod1 (/ h1 2.0))
tod1 (+ bod1 h1))
)
((= elev1_type 1) ; COD
(setq cod1 elev1_val
bod1 (- cod1 (/ h1 2.0))
tod1 (+ cod1 (/ h1 2.0)))
)
((= elev1_type 2) ; TOD
(setq tod1 elev1_val
bod1 (- tod1 h1)
cod1 (- tod1 (/ h1 2.0)))
)
)

;; Calculate Duct 2
(cond
((= duct2_ref_type 0) ; TL
(setq ref2 (+ tod1 offset))
(setq tod2 ref2
bod2 (- tod2 h2)
cod2 (- tod2 (/ h2 2.0)))
(setq ref2_name "TL")
)
((= duct2_ref_type 1) ; CL
(setq ref2 (+ cod1 offset))
(setq cod2 ref2
bod2 (- cod2 (/ h2 2.0))
tod2 (+ cod2 (/ h2 2.0)))
(setq ref2_name "CL")
)
((= duct2_ref_type 2) ; BL
(setq ref2 (+ bod1 offset))
(setq bod2 ref2
tod2 (+ bod2 h2)
cod2 (+ bod2 (/ h2 2.0)))
(setq ref2_name "BL")
)
)

;; Update UI results
(set_tile "duct2_bod" (rtos bod2 2 2))
(set_tile "duct2_cod" (rtos cod2 2 2))
(set_tile "duct2_tod" (rtos tod2 2 2))

;; Format history lines
(setq log_str1 (strcat "Duct 1: H" (rtos h1 2 0) " / "
elev1_name (rtos elev1_val 2 0) " / COD" (rtos cod1 2 0) " / TOD" (rtos tod1 2 0)))
(setq log_str2 (strcat "Fitting: Slide Up " (rtos slide_up 2 0) " / Slide Down " (rtos slide_down 2 0)))
(setq log_str3 (strcat "Duct 2: H" (rtos h2 2 0) " / " ref2_name " / BOD" (rtos bod2 2 0)
" / COD" (rtos cod2 2 0) " / TOD" (rtos tod2 2 0)))

;; Add separator and lines to history
(if (> (length history_list) 0)
(f_update_ui_history "----------------------------------------")
)
(f_update_ui_history log_str1)
(f_update_ui_history log_str2)
(f_update_ui_history log_str3)
)
)
)

;; 5. UI MANAGEMENT
(defun f_update_ui_history (val)
(setq history_list (cons val history_list))
(if (> (length history_list) 35) (setq history_list (reverse (cdr (reverse history_list)))))
(start_list "history_list")
(mapcar 'add_list history_list)
(end_list)
)

(defun f_clear_inputs ()
(foreach key '("math_input" "math_result" 
"duct1_h" "duct1_elev_val" "slide_up" "slide_down" "duct2_h"
"duct2_bod" "duct2_cod" "duct2_tod"
"hyd_wo" "hyd_ho" "hyd_h2" "hyd_w2" "hyd_r")
(set_tile key ""))
;; Reset slide up/down to 0
(set_tile "slide_up" "0")
(set_tile "slide_down" "0")
(set_tile "duct1_elev_type" "0")
(set_tile "duct2_ref_type" "0")
(mode_tile "math_input" 2)
)

(defun f_clear_history ()
(setq history_list '())
(start_list "history_list") (end_list)
)

(defun f_logic (action_key)
(cond
((= action_key "SET_MATH") (setq active_mode "MATH"))
((= action_key "SET_DUCT") (setq active_mode "DUCT"))
((= action_key "SET_HYD") (setq active_mode "HYD"))
((= action_key "CALCULATE")
(cond
((= active_mode "MATH")
(progn
(setq expr (get_tile "math_input"))
(if (and expr (/= expr ""))
(progn
(setq res (f_evaluate expr))
(if (numberp res)
(progn
(set_tile "math_result" (rtos res 2 2))
(if (> (length history_list) 0)
(f_update_ui_history "----------------------------------------")
)
(f_update_ui_history (strcat "Math: " expr " = " (rtos res 2 2)))
)
(set_tile "math_result" "Syntax Error!")
)
)
)
)
)
((= active_mode "HYD")
(f_calculate_hydraulic)
)
(t
(f_calculate_duct_connection)
)
)
)
((= action_key "NEW") (f_clear_inputs))
((= action_key "CLEAR_HISTORY") (f_clear_history))
)
)

;; 6. DCL GENERATION (No +/- signs, vertical layout)
(setq dcl_file (vl-filename-mktemp "tbh_v16_4.dcl"))
(setq file_handle (open dcl_file "w"))
(write-line (strcat "tbh_calc : dialog { label = " Q "TBH Calculator - Duct Connection (TC)" Q ";") file_handle)
(write-line "  : row {" file_handle)
;; Left column
(write-line "    : column {" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "Math Expression" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Expression :" Q "; key = " Q "math_input" Q "; edit_width = 30; allow_accept = true; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Result     :" Q "; key = " Q "math_result" Q "; edit_width = 30; is_readonly = true; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "OLD DUCT" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Width Wo (mm):" Q "; key = " Q "hyd_wo" Q "; edit_width = 15; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Height Ho (mm):" Q "; key = " Q "hyd_ho" Q "; edit_width = 15; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "NEW DUCT" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Height H2 (mm):" Q "; key = " Q "hyd_h2" Q "; edit_width = 15; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Result W2 (mm):" Q "; key = " Q "hyd_w2" Q "; edit_width = 15; is_readonly = true; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "HYDRAULIC RADIUS" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Radius Rh:" Q "; key = " Q "hyd_r" Q "; edit_width = 15; is_readonly = true; }") file_handle)
(write-line "      }" file_handle)
(write-line "    }" file_handle)
;; Middle column - Duct Elevation
(write-line "    : column {" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "DUCT 1" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Height H1 (mm):" Q "; key = " Q "duct1_h" Q "; edit_width = 15; }") file_handle)
(write-line (strcat "        : popup_list { label = " Q "Elevation type:" Q "; key = " Q "duct1_elev_type" Q "; width = 20; list = " Q "BOD\\nCOD\\nTOD" Q "; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Value (mm):" Q "; key = " Q "duct1_elev_val" Q "; edit_width = 15; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "FITTING" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Slide Up (mm):" Q "; key = " Q "slide_up" Q "; edit_width = 15; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Slide Down (mm):" Q "; key = " Q "slide_down" Q "; edit_width = 15; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "DUCT 2" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "Height H2 (mm):" Q "; key = " Q "duct2_h" Q "; edit_width = 15; }") file_handle)
(write-line (strcat "        : popup_list { label = " Q "Connection reference:" Q "; key = " Q "duct2_ref_type" Q "; width = 20; list = " Q "TL (Top Line)\\nCL (Center Line)\\nBL (Bottom Line)" Q "; }") file_handle)
(write-line "      }" file_handle)
(write-line (strcat "      : boxed_column { label = " Q "DUCT 2 RESULTS" Q ";") file_handle)
(write-line (strcat "        : edit_box { label = " Q "BOD (Bottom):" Q "; key = " Q "duct2_bod" Q "; edit_width = 20; is_readonly = true; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "COD (Center):" Q "; key = " Q "duct2_cod" Q "; edit_width = 20; is_readonly = true; }") file_handle)
(write-line (strcat "        : edit_box { label = " Q "TOD (Top):" Q "; key = " Q "duct2_tod" Q "; edit_width = 20; is_readonly = true; }") file_handle)
(write-line "      }" file_handle)
(write-line "    }" file_handle)
;; Right column - History
(write-line (strcat "    : boxed_column { label = " Q "Calculation History" Q "; width = 50;") file_handle)
(write-line (strcat "      : list_box { key = " Q "history_list" Q "; width = 55; height = 25; }") file_handle)
(write-line "    }" file_handle)
(write-line "  }" file_handle)
;; Bottom buttons
(write-line "  : row {" file_handle)
(write-line (strcat "    : button { label = " Q "CALCULATE (Enter)" Q "; key = " Q "btn_enter" Q "; is_default = true; width = 15; }") file_handle)
(write-line (strcat "    : button { label = " Q "NEW" Q "; key = " Q "btn_new" Q "; width = 10; }") file_handle)
(write-line (strcat "    : button { label = " Q "CLEAR HISTORY" Q "; key = " Q "btn_clear_hist" Q "; width = 12; }") file_handle)
(write-line (strcat "    : button { label = " Q "EXIT" Q "; key = " Q "btn_exit" Q "; is_cancel = true; width = 10; }") file_handle)
(write-line "  }" file_handle)
(write-line "}" file_handle)
(close file_handle)

;; 7. STARTUP & BINDINGS
(setq dcl_id (load_dialog dcl_file))
(if (or (null dcl_id) (<= dcl_id 0)
        (not (new_dialog "tbh_calc" dcl_id)))
  (progn
    (princ "\n[TC] Unable to open calculator dialog.")
    (*error* "Function cancelled")
    (exit)))

;; Set default values: only slide up/down = 0, others empty
(set_tile "duct1_h" "")
(set_tile "duct1_elev_val" "")
(set_tile "duct2_h" "")
(set_tile "hyd_wo" "")
(set_tile "hyd_ho" "")
(set_tile "hyd_h2" "")
(set_tile "slide_up" "0")
(set_tile "slide_down" "0")
(set_tile "duct1_elev_type" "0")
(set_tile "duct2_ref_type" "0")
(mode_tile "math_input" 2)

;; Action tiles
(action_tile "math_input"   "(f_logic \"SET_MATH\")")
(action_tile "duct1_h"      "(progn (f_logic \"SET_DUCT\") (set_tile \"duct2_h\" (get_tile \"duct1_h\")))")
(action_tile "duct1_elev_val" "(f_logic \"SET_DUCT\")")
(action_tile "duct1_elev_type" "(f_logic \"SET_DUCT\")")
(action_tile "slide_up"     "(f_logic \"SET_DUCT\")")
(action_tile "slide_down"   "(f_logic \"SET_DUCT\")")
(action_tile "duct2_h"      "(f_logic \"SET_DUCT\")")
(action_tile "duct2_ref_type" "(f_logic \"SET_DUCT\")")
(action_tile "hyd_wo"       "(f_logic \"SET_HYD\")")
(action_tile "hyd_ho"       "(f_logic \"SET_HYD\")")
(action_tile "hyd_h2"       "(f_logic \"SET_HYD\")")
(action_tile "btn_enter"    "(f_logic \"CALCULATE\")")
(action_tile "btn_new"      "(f_logic \"NEW\")")
(action_tile "btn_clear_hist" "(f_logic \"CLEAR_HISTORY\")")
(action_tile "btn_exit"     "(done_dialog 0)")

(start_dialog)
(unload_dialog dcl_id)
(if (and dcl_file (findfile dcl_file)) (vl-file-delete dcl_file))
(princ)
)

(princ "\nTBH Calculator V16.4 (No defaults, H2 = H1 auto, slide=0) Loaded. Type 'TC' to run.")
(princ)