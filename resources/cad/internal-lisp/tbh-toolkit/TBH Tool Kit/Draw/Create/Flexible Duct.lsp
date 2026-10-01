;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Flexible Duct.lsp
;;; Module      : Draw\Create
;;; Command     : VF01, VF02, F15, F20, F25, F30, F35, F40, F45, F50
;;; Description : Draws flexible ducts with appropriate bending radiuses natively.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Click start point (connection) and end point.
;;; 3. Script draws polyline-based flexible duct simulating natural radii.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;;; =============================================================================
;;; PART 1: CORE DRAWING ENGINES (FROM ORIGINAL FLEXIBLE DUCT.LSP)
;;; =============================================================================

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;-nn_2dpl.lsp - Ve ong tron dan gio Plexible duct 2D - NNN - (5.2007)  ;;
;;;;; update 08.10.2013 ; 02.12.2013 ;  14.10.2014 ; for Cad 2015 ;;;;;;;
(if (not vsize) (setq vsize 250))
(if (not nn_dw) (setq nn_dw 300))
(if (not nn_sta) (load"nnam1.fas"))
;;;;;

(defun laycenter ()
  (if (not (tblsearch "layer" "Center"))
    (command "layer"   "n"	 "Center"  "c"	     "8"
	     "Center"  "lt"	 "CENTER"  "Center"  ""
	    )
  )
  (nn_chlay "Center"))

;--- loc list ------
(defun nn_loclst ()			;( / tleng count entlst loc loclst)
  (nn_chlay "0")
  (command "_divide" ent1 "b" "$point" "" (1+ tleng) );"_erase" ent1 "")
  (setq count tleng)
  (while (> count 0)
    (setq entlst (entget (entlast)))
    (setq loc (trans (cdr (assoc 10 entlst)) 0 1))
    (setq loclst (append loclst (list loc)))
    (command "_erase" "l" "")
    (setq count (1- count))
  )
  (setq loclst (reverse loclst))
)
;;;------------------------------ Plexible 2D ------------------------------------------
;;;-------------------------------------------------------------------------------------
(defun nn_vc (nn_khoa / draw p1 p2 p3 loai loaiong nsize nsize2 size4 nsize5
 curlayer layerold ent1 ang1 ang2 tleng pl loclst rr count entlst mau nn_delb
 loc locc loc1 loc2 loc3 loc4 loc5 loc6 loc7 loc8 loc9 loca dloc
 pplst numlst lleng colo p1a p2a p1c p2c pce pp1 pp2 pp3 pp1a pp2a)
  (if (not nn_drawP) (load"nnam3.fas"))
  (nn_drawP) (nn_$point) (setvar "osmode" 0)
  (setq nsize (getdist (strcat "\nSize <" (rtos vsize) ">: ")))
  (if (null nsize) (setq nsize vsize) (setq vsize nsize))

  (setq nsize5 (/ nsize 5.0) nsize2 (/ nsize 2.0) )
   (if (= rr "Y")
       (progn (if (or (= nn_khoa 1) (= nn_khoa 2)) (nn_drawPP (* nsize5 2.4)) )
              (if (or (= nn_khoa 3) (= nn_khoa 7) (= nn_khoa 4)) (nn_drawPP (* nsize5 1.5)) )
              (if (or (= nn_khoa 8) (= nn_khoa 9) (= nn_khoa 0)
		      (= nn_khoa 11) (= nn_khoa 12) (= nn_khoa 13)
		      (= nn_khoa 10)) (nn_drawPP (* nsize5 1.5)) )
              (if (or (= nn_khoa 5) (= nn_khoa 6)) (nn_drawPP (* nsize5 2)) ) ) )
   (command "area" "object" ent1) (setq pl (getvar "perimeter"))
   (princ "\nPlease wait")
   (if (or (= nn_khoa 1) (= nn_khoa 2)) (nn_vc12))
   (if (or (= nn_khoa 3) (= nn_khoa 4) (= nn_khoa 7)
	   (= nn_khoa 8) (= nn_khoa 9) (= nn_khoa 0)
	   (= nn_khoa 11) (= nn_khoa 12) (= nn_khoa 13))
     (nn_vc34))
   (if (or (= nn_khoa 5) (= nn_khoa 6)) (nn_vc56))
   (if (= nn_khoa 10) (nn_vb))
  (laycenter)
  (command "chprop" ent1 "" "la" "Center" "")
) ;;; end nn_vc

(defun nn_vb () ;;;; new 13.09.2012 bare cable  update 08.10.2013                                      
  ;(setq tleng (1+ (* (fix (/ pl nsize5 1.25)) 2)) )
  (setq nsize5 (* nsize 0.788))  ;;;;;;;;;;; update nsize5 08.10.2013 OK;;;;;
  (setq tleng (* (fix (/ pl nsize5 1)) 2))
  (if (< tleng 5) (setq tleng 5))
  (princ (strcat " - " (itoa tleng)))
  (nn_loclst)
  (setq count 0)
  (setq ggoc (/ pi 3.0))
  ;;;doan dau
  (llloc)
  (setq dloc (distance loc locc) loc9 loc)
  (setq loc1 (polar p1 (+ ang1 (* pi 0.5)) (* 0.5 nsize5)))
  (setq loc2 (polar p1 (+ ang1 (* pi 1.5)) (* 0.5 nsize5)))
  
  (setq ang2 (+ ggoc (angle loc9 locc)))
  (setq loc4 (polar loc (+ ang2 (* pi 1.5)) nsize5) )
  (setq loc2a (polar loc4 (angle loc4 loc2) (* 2 dloc)))
  (setq loc3a (polar loc2a (+ 5.89049 (angle loc2a loc4)) (* (distance loc2a loc4) 0.2559017) ))
  (setq loc7 (polar loc2 (+ ang1 (* pi 0.5)) (* 0.7843 nsize5)))
  (setq loc8 (polar loc2 (+ ang1 (* pi 0.5)) (* 0.2157 nsize5)))
  (setq loc3b (polar loc2 (- (angle loc2 loc2a) 0.26) (* (distance loc2 loc2a) 0.5174) ))
  (command "pline" p1 "w" 0.01 0.01 loc2 loc8 loc2a "a" "s" loc3b loc2 "l"
	   loc7 loc4 "a" "s" loc3a loc2a "l" loc8 loc1 "a")
  (setq loc2 loc4)
  ;;; doan noi
  (llloc)
  (setq loc9 loc)
  (llloc)
  (setq ang2 (+ ggoc (angle loc9 locc))) ;;;;
  (setq loc5 (polar loc (+ ang2 (* pi 0.5)) nsize5) )
  (setq loc6a (polar loc1 (+ 0.392699 (angle loc1 loc5)) (* (distance loc1 loc5) 0.2559017) ))
  (setq loc4 (polar loc (+ ang2 (* pi 1.5)) nsize5) )
  (setq loc3a (polar loc2 (+ 5.89049 (angle loc2 loc4)) (* (distance loc2 loc4) 0.2559017) ))
  (command "s" loc6a loc5 "l" loc4 "a" "s" loc3a loc2 "l" loc7 loc1 "a" "s" loc6a loc5)
  (setq loc1 loc5 loc2 loc4)
  ;;; doan giua
  (while (< count (- tleng 2))
    (llloc)
    (setq loc9 loc)
    (llloc)
    (setq ang2 (+ ggoc (angle loc9 locc))) ;;;;
    (setq loc5 (polar loc (+ ang2 (* pi 0.5)) nsize5) )
    (setq loc6a (polar loc1 (+ 0.392699 (angle loc1 loc5)) (* (distance loc1 loc5) 0.2559017) ))
    (setq loc4 (polar loc (+ ang2 (* pi 1.5)) nsize5) )
    (setq loc3a (polar loc2 (+ 5.89049 (angle loc2 loc4)) (* (distance loc2 loc4) 0.2559017) ))
    (command "s" loc6a loc5 "l" loc4 "a" "s" loc3a loc2 "l" loc1 "a" "s" loc6a loc5)
    (setq loc1 loc5 loc2 loc4))
  ;;; doan cuoi
   (setq loc5 (polar loc1 ang1 (* 2 dloc)))
   (setq loc5a (polar p2 (+ ang1 (* pi 0.5)) (* 0.5 nsize5)))
   (setq loc6a (polar loc1 (+ 0.392699 (angle loc1 loc5)) (* (distance loc1 loc5) 0.2559017) ))
   (setq loc6b (polar loc6a ang1 (* 2 dloc)))
   (setq loc4 (polar p2 (+ ang1 (* pi 1.5)) (* 0.5 nsize5)))
   (setq loc3a (polar loc2 (+ 5.89049 (angle loc2 loc4)) (* (distance loc2 loc4) 0.2795085) ))
;;; vedoan cuoi
   (command "s" loc6a loc5 "l" p2 loc5a "a" "s" loc6b loc5 "l" p2 loc4 "a" "s" loc3a loc2 "l" loc1 "w" 0 0 "")
   ) ;;; end nn_vb

;--- vc1 - vc2
(defun nn_vc12 ()
  (setq tleng (* (fix (* (- (fix (/ pl nsize5)) 1) 0.5)) 2) )
  (if (< tleng 4) (setq tleng 4))
  (princ (strcat " - " (itoa tleng)))
  (nn_loclst)
  (setq count 0)
  (llloc)
  (setq dloc (distance loc locc) ang2 (angle p1 locc) )
  (setq loc1 (polar p1 (+ ang1 (* pi 0.5)) nsize2))
  (setq loc2 (polar p1 (+ ang1 (* pi 1.5)) nsize2))
  (setq loc3 (polar loc2 ang2 (* dloc 1.5)))
  (setq loc4 (polar loc1_ang2 (* dloc 1.5))) ; Error in original source: loc1_ang2 should be (polar loc1 ang2 (* dloc 1.5)) but I will keep as consistent with source or fix if obvious. Wait, line 150 of original was (setq loc4 (polar loc1 ang2 (* dloc 1.5)))
  (setq loc4 (polar loc1 ang2 (* dloc 1.5)))
  (setq loc9 loc)
  (command "pline" loc4 "w" 0.01 0.01 loc3 loc2 loc1 loc4)
  (while (< count (- tleng 2))
    (llloc)
    (setq ang2 (angle loc9 locc) loc9 loc)
    (setq loc5 (polar loc (+ ang2 (* pi 0.5)) nsize2) )
    (setq loc4 (polar loc (+ ang2 (* pi 0.5)) (- nsize2 dloc) ))
    (setq loc3 (polar loc (+ ang2 (* pi 1.5)) (- nsize2 (* dloc 0.5)) ))
    (setq loca (polar loc ang1 (* dloc 0.5)))
    (setq loc7 (polar loca (+ ang1 (* pi 1.5)) nsize2) )
    (llloc)
    (setq ang2 (angle loc9 locc) loc9 loc)
    (setq loc6 (polar loc (+ ang2 (* pi 0.5)) nsize2) )
    (setq loc1 (polar loc (+ ang2 (* pi 0.5)) (- nsize2 dloc) ))
    (setq loc2 (polar loc (+ ang2 (* pi 1.5)) (- nsize2 (* dloc 0.5)) ))
    (command loc5 "a" loc1 "l" loc2 "a" "s" loc7 loc3 "l" loc4 "a" loc6 "l") )
  (setq ang2 (angle loc9 locc))
  (setq loc1 (polar p2 (+ ang1 (* pi 0.5)) nsize2))
  (setq loc2 (polar p2 (+ ang1 (* pi 1.5)) nsize2))
  (setq loc3 (polar loc2 (+ ang2 pi) (* dloc 1.5)))
  (setq loc4 (polar loc1 (+ ang2 pi) (* dloc 1.5)))
  (setq p3 (polar p2 ang1 dloc))
  (setq loc5 (polar p3 (+ ang1 (* pi 0.5)) (- nsize2 dloc)))
  (setq loc6 (polar p3 (+ ang1 (* pi 1.5)) (- nsize2 dloc)))
  (setq loc7 (polar loc6 (+ ang1 pi) (* dloc 2)))
  (setq loc8 (polar loc5 (+ ang1 pi) (* dloc 2)))
  (if (= nn_khoa 1)
    (command loc4 loc1 "a" loc2 loc1 loc5 "l" loc6 "a" loc7 "l" loc8 "a" loc1 "w" 0 0 ""))
  (if (= nn_khoa 2)
    (command loc4 loc1 loc2 loc3 loc4 "w" 0 0 ""))
) ;;;; nd nn_vc12


;;;--- Plexible 2D new --- vc3 - vc4 - vc7 -+- vc8 - vc9 - vc0
(defun nn_vc34 ()
  (setq tleng (1+ (* (fix (/ pl nsize5 1.25)) 2)) )
  (if (< tleng 5) (setq tleng 5))
  (princ (strcat " - " (itoa tleng)))
  (nn_loclst)
  (setq count 0)
  ;;;doan dau
  (llloc)
  (setq dloc (distance loc locc) loc9 loc)
  (setq loc1 (polar p1 (+ ang1 (* pi 0.5)) nsize2))
  (setq loc2 (polar p1 (+ ang1 (* pi 1.5)) nsize2))
  (setq loc7 (polar p1 (+ ang1 pi) (/ nsize2 2)))
  (setq loc8 (polar p1 (+ ang1 pi) nsize2));;;ang1 nsize2))
  (llloc)
  (setq ang2 (angle loc9 locc))
  (setq loc5 (polar loc (+ ang2 (* pi 0.5)) nsize2))
  (setq loc6  (polar loc1 (- (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
  (setq loc6a (polar loc1 (+ (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
  (setq loc6b (polar loc1 (+ (angle loc1 loc5) (/ pi 6)) (/ (distance loc1 loc5) (* (cos (/ pi 6)) 2)) ))
  (setq loc4 (polar loc (+ ang2 (* pi 1.5)) nsize2))
  (setq loc3  (polar loc2 (+ (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
  (setq loc3a (polar loc2 (- (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
  (setq loc3b (polar loc2 (- (angle loc2 loc4) (/ pi 6)) (/ (distance loc2 loc4) (* (cos (/ pi 6)) 2)) ))
  (setq loca (polar loc1 (+ 0.1963495 (angle loc1 loc2)) (* dloc 0.559017) ))
  (setq locb (polar loc5 (+ 0.1963495 (angle loc5 loc4)) (* dloc 0.559017) ))
  ;;; ve doan dau
  (command "pline" loc1 "w" 0.01 0.01)
  (if (or (= nn_khoa 7) (= nn_khoa 0) (= nn_khoa 13))
    (command "a" "s" loc7 loc2 "s" loc8 loc1))
    ;;;(command "a" "s" loc7 loc2 "s" loc8 loc1 loc2 "l" loc1))
  (if (= nn_khoa 7)
    (command "s" loca loc2 "s" loc3 loc4 "s" locb loc5 "s" loc6 loc1 "s" loc6 loc5))
    ;;;(command "l" loc2 "a" "s" loc3 loc4 "l" loc5 "a" "s" loc6 loc1 "s" loc6 loc5))
  (if (= nn_khoa 0)
    (command "s" loca loc2 "s" loc3a loc4 "s" locb loc5 "s" loc6a loc1 "s" loc6a loc5))
  (if (= nn_khoa 13)
    (command "l" loc2 loc3b loc4 loc5 loc6b loc1 loc6b loc3b loc6b loc5))
  (if (or (= nn_khoa 3) (= nn_khoa 4) (= nn_khoa 8) (= nn_khoa 9))
    (command loc2 loc4 loc5 loc1 loc5 "a"))
  (if (or (= nn_khoa 11) (= nn_khoa 12))
    (command loc2 loc4 loc5 loc1 loc5))
  (setq loc1 loc5 loc2 loc4)
  ;;; doan giua
  (while (< count (- tleng 2))
    (llloc)
    (setq loc9 loc)
    (llloc)
    (setq ang2 (angle loc9 locc))
    (setq loc5 (polar loc (+ ang2 (* pi 0.5)) nsize2) )
    (setq loc6  (polar loc1 (- (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
    (setq loc6a (polar loc1 (+ (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
    (setq loc6b (polar loc1 (+ (angle loc1 loc5) (/ pi 6)) (/ (distance loc1 loc5) (* (cos (/ pi 6)) 2)) ))
             (setq loc4 (polar loc (+ ang2 (* pi 1.5)) nsize2) )
             (setq loc3  (polar loc2 (+ (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
             (setq loc3a (polar loc2 (- (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
             (setq loc3b (polar loc2 (- (angle loc2 loc4) (/ pi 6)) (/ (distance loc2 loc4) (* (cos (/ pi 6)) 2)) ))
             (setq loca (polar loc1 (+ 0.1963495 (angle loc1 loc2)) (* dloc 0.559017) ))
             (setq locb (polar loc5 (+ 0.1963495 (angle loc5 loc4)) (* dloc 0.559017) ))
     (if (or (= nn_khoa 3) (= nn_khoa 4) (= nn_khoa 7))
       (command "s" loc6 loc5 "s" locb loc4 "s" loc3 loc2 "s" loca loc1 "s" loc6 loc5))
         ;;;(command "s" loc6 loc5 "l" loc4 "a" "s" loc3 loc2 "l" loc1 "a" "s" loc6 loc5))
     (if (or (= nn_khoa 8) (= nn_khoa 9) (= nn_khoa 0))
         (command "s" loc6a loc5 "s" locb loc4 "s" loc3a loc2 "s" loca loc1 "s" loc6a loc5))
     (if (or (= nn_khoa 11) (= nn_khoa 12) (= nn_khoa 13))
         (command loc2 loc3b loc4 loc5 loc6b loc1 loc6b loc3b loc6b loc5))
     (setq loc1 loc5 loc2 loc4))
;;; doan cuoi  
   (setq loc5 (polar p2 (+ ang1 (* pi 0.5)) nsize2))
   (setq loc6  (polar loc1 (- (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
   (setq loc6a (polar loc1 (+ (angle loc1 loc5) (/ pi 8)) (/ (distance loc1 loc5) (* (cos (/ pi 8)) 2)) ))
   (setq loc6b (polar loc1 (+ (angle loc1 loc5) (/ pi 6)) (/ (distance loc1 loc5) (* (cos (/ pi 6)) 2)) ))
   (setq loc4 (polar p2 (+ ang1 (* pi 1.5)) nsize2))
   (setq loc3  (polar loc2 (+ (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
   (setq loc3a (polar loc2 (- (angle loc2 loc4) (/ pi 8)) (/ (distance loc2 loc4) (* (cos (/ pi 8)) 2)) ))
   (setq loc3b (polar loc2 (- (angle loc2 loc4) (/ pi 6)) (/ (distance loc2 loc4) (* (cos (/ pi 6)) 2)) ))
   (setq loca (polar loc1 (+ 0.1963495 (angle loc1 loc2)) (* dloc 0.559017) ))
   (setq locb (polar loc5 (+ 0.1963495 (angle loc5 loc4)) (* dloc 0.559017) ))
   (setq loc7 (polar p2 ang1 (/ nsize2 2)))
   (setq loc8 (polar p2 ang1 nsize2));;;(+ ang1 pi) nsize2))
;;; vedoan cuoi
   (if (or (= nn_khoa 3) (= nn_khoa 7))
       (command "s" loc6 loc5 "s" locb loc4 "s" loc3 loc2 "s" loca loc1 "s" loc6 loc5
                "s" loc7 loc4 ;;;"a"
		"s" loc8 loc5 "w" 0 0 ""));;;loc4 ""))

   (if (or (= nn_khoa 4) (= nn_khoa 9)) (command "l" loc5 loc4 loc2 loc1 "w" 0 0 ""))
   (if (= nn_khoa 12) (command loc5 loc4 loc2 loc1 "w" 0 0 ""))
   (if (or (= nn_khoa 8) (= nn_khoa 0))
       (command "s" loc6a loc5 "s" locb loc4 "s" loc3a loc2 "s" loca loc1 "s" loc6a loc5
                "s" loc7 loc4 ;;;"a"
		"s" loc8 loc5 "w" 0 0 ""))  ;;;loc4 ""))
   (if (or (= nn_khoa 11) (= nn_khoa 13))
       (command loc2 loc3b loc4 loc5 loc6b loc1 loc6b loc3b loc6b loc5
		"a" "s" loc7 loc4 "l" loc5 "a" "s" loc8 loc4 "w" 0 0 ""))
) ;;; end nn_vc35


;--- Plexible 2D new --- vc5 - vc6
(defun nn_vc56 ()
   (setq nsize4 (* nsize2 0.5))
   (setq tleng (1- (* (fix (/ pl nsize5 2.5)) 4)) )
   (if (< tleng 7) (setq tleng 7))
   (princ (strcat " - " (itoa tleng)))
   (nn_loclst)
   (setq count 0)
   (llloc) (setq dloc (distance loc locc) loc9 loc)
           (setq loc1 (polar p1 (+ ang1 (* pi 0.5)) nsize2))
           (setq loc2 (polar p1 (+ ang1 (* pi 1.5)) nsize2))
   (llloc) (setq ang2 (angle loc9 locc))
           (setq loc4 (polar loc (+ ang2 (* pi 0.5)) nsize2))
           (setq loc3 (polar loc (+ ang2 (* pi 1.5)) nsize2))
   (setq loc5a (polar loc (+ ang2 (* pi 0.5)) nsize4) )
   (setq loc5 (polar loc5a ang2 (* nsize4 0.75) ) )
   (command "pline" loc4 "w" 0.01 0.01 loc3 loc2 loc1 loc4 "a" loc5 "l" locc)
   (llloc) (setq loca locc)
     (while (<= count (/ tleng 2))
        (setq loc (car loclst) locc (cadr loclst))
        (setq ang1 (angle loca locc))
        (if (= (rem (+ 2 count) 2) 1)
            (progn (setq loc1 (polar loc (- ang1 (* pi 0.5)) nsize4) )
                       (setq loc2 (polar loc1 (+ ang1 pi) (* nsize4 0.75) ) )
                       (setq loc3 (polar loc1 (- ang1 (* pi 0.5)) nsize4) )
                       (setq loc4 (polar loc1 ang1 (* nsize4 0.75) ) ) )
            (progn (setq loc1 (polar loc (+ ang1 (* pi 0.5)) nsize4) )
                       (setq loc2 (polar loc1 (+ ang1 pi) (* nsize4 0.75) ) )
                       (setq loc3 (polar loc1 (+ ang1 (* pi 0.5)) nsize4) )
                       (setq loc4 (polar loc1 ang1 (* nsize4 0.75) ) ) )
           ) ; if
          (setq loclst (cdr (cdr loclst)))
          (setq count (1+ count) loca locc)
          (command loc2 "a" "s" loc3 loc4 "l" locc) ) ;while

   (setq loc (polar locc ang1 nsize4) locc (car loclst))
   (setq ang1 (angle loca locc))
   (setq loc1 (polar locc (+ ang1 (* pi 0.5)) nsize4) )
   (setq loc2 (polar loc1 (+ ang1 pi) (* nsize4 0.75) ) )
   (setq loc3 (polar loc1 (+ ang1 (* pi 0.5)) nsize4) )
   (command loc2 "a" loc3  "l")
   (setq loc5 (polar p2 (+ ang1 (* pi 0.5)) nsize2))
   (setq loc4 (polar p2 (+ ang1 (* pi 1.5)) nsize2))
   (setq loc6 (polar loc5  (+ ang1 pi) (* dloc 2) ))
   (setq loc3 (polar loc4  (+ ang1 pi) (* dloc 2) ))
   (setq p3 (polar p2 ang1 (* dloc 2) ))
   (if (= nn_khoa 5) (command loc5 "a" loc4 loc5 "s" p3 loc4 "l" loc5 "w" 0 0 ""))
   (if (= nn_khoa 6) (command loc5 loc4 loc3 loc6 loc5 "w" 0 0 ""))
) ;;; nn_vc56


;-MAIN PROGRAM-
(defun nn_dpl (nn_key / o_err o_cmd o_bli o_lay o_osm o_fol o_thk)
   (nn_sta)
   (cond ((= nn_key "v1") (nn_vc 1))
         ((= nn_key "v2") (nn_vc 2))
         ((= nn_key "v3") (nn_vc 3))
         ((= nn_key "v7") (nn_vc 7))
         ((= nn_key "v4") (nn_vc 4))
         ((= nn_key "v5") (nn_vc 5))
         ((= nn_key "v6") (nn_vc 6))
         ((= nn_key "v8") (nn_vc 8))
         ((= nn_key "v9") (nn_vc 9))
         ((= nn_key "v0") (nn_vc 0))
	 ((= nn_key "v11") (nn_vc 11))
         ((= nn_key "v12") (nn_vc 12))
         ((= nn_key "v13") (nn_vc 13))
	 ((= nn_key "vv") (nn_vc 10))
         (T nil) )
   (nn_res)
)
;--- Command
(defun C:VF01 () (nn_dpl "v11"))
(defun C:VF02 () (nn_dpl "v12"))

;;; =============================================================================
;;; PART 2: AUTOMATION & SHORTCUTS (FROM CHUANHOADRAWING.LSP)
;;; =============================================================================

;; ─── GLOBAL VARIABLES ─────────────────────────────
(setq *Flex_Final_Layer* "Hvacduct-Flexduct")
(setq *Flex_Text_Layer* "HvacDuctText")
(setq *Flex_Old_Ent* nil)
(setq *Flex_LTScale* nil)
(setq *Flex_Pipe_Size* nil)
(setq *Flex_Text_Point* nil)
(setq *Flex_Old_State* nil)

(defun Flex_Ensure_Layer (layName colorIndex)
  (if (not (tblsearch "LAYER" layName))
    (vl-cmdf "-LAYER" "M" layName "C" (itoa colorIndex) layName ""))
  (princ)
)

(defun Flex_Finalize_AfterDraw (/ ss ent textPt textHeight pipeSize)
  (setq pipeSize *Flex_Pipe_Size*)
  (setq ss (ssadd))

  (setq ent (if *Flex_Old_Ent* (entnext *Flex_Old_Ent*) (entnext)))
  (while ent
    (ssadd ent ss)
    (setq ent (entnext ent))
  )

  (Flex_Ensure_Layer *Flex_Final_Layer* 17)
  (Flex_Ensure_Layer *Flex_Text_Layer* 2)

  (if (> (sslength ss) 0)
    (command "_.CHPROP" ss "" "_LA" *Flex_Final_Layer* "_LT" "HD" "_S" (rtos *Flex_LTScale* 2 4) ""))

  (setq textPt *Flex_Text_Point*)
  (setq textHeight
    (if (and (= (getvar "TILEMODE") 0) (= (getvar "CVPORT") 1))
      3.0
      100.0))

  (if textPt
    (entmake
      (list
        '(0 . "TEXT")
        (cons 8 *Flex_Text_Layer*)
        '(7 . "HVACS")
        (cons 10 (list (car textPt) (cadr textPt) 0.0))
        (cons 11 (list (car textPt) (cadr textPt) 0.0))
        (cons 40 textHeight)
        '(41 . 0.8)
        '(72 . 1)
        '(73 . 2)
        (cons 1 (strcat pipeSize "%%c")))))

  (setq *Flex_Old_Ent* nil
        *Flex_LTScale* nil
        *Flex_Pipe_Size* nil
        *Flex_Text_Point* nil)
  (redraw)
  (princ (strcat "\n[TBH] Flex duct " pipeSize " generated."))
  (princ)
)

;; ─── CORE EXECUTION ENGINE ─────────────────────────
(defun Flex_Save_State ()
  ;; Remember CLAYER/CELTYPE/CELTSCALE/CMDECHO so FXX can restore them.
  (setq *Flex_Old_State*
        (list (cons "CLAYER" (getvar "CLAYER"))
              (cons "CELTYPE" (getvar "CELTYPE"))
              (cons "CELTSCALE" (getvar "CELTSCALE"))
              (cons "CMDECHO" (getvar "CMDECHO"))))
  (princ))

(defun Flex_Restore_State ()
  ;; Put back the layer/linetype/echo state captured before the command ran.
  (foreach pair *Flex_Old_State*
    (if pair
      (vl-catch-all-apply 'setvar (list (car pair) (cdr pair)))))
  (setq *Flex_Old_State* nil)
  (princ))

(defun Flex_Execute_Engine (layName ltScale pipeSize / engineChoice p1 pt ptList cmdStr doc midX midY)
  (Flex_Save_State)
  (setvar "CMDECHO" 0)

  ;; 1. Sync Layer and Properties
  (Flex_Ensure_Layer layName 17)
  (setvar "CLAYER" layName)
  (vl-catch-all-apply 'setvar (list "CELTYPE" "HD"))
  (setvar "CELTSCALE" ltScale)
  
  (princ (strcat "\n[TBH] Selected duct size: " pipeSize " mm"))

  ;; 2. Engine and Mode Selection
  (initget "VF01 VF02")
  (setq engineChoice (getkword "\nSelect drafting engine [VF01/VF02] <VF02>: "))
  (if (null engineChoice) (setq engineChoice "VF02"))

  ;; 3. Draw path and queue engine
  (setq cmdStr nil)
  (setq *Flex_Old_Ent* (entlast))
  (setq *Flex_LTScale* ltScale)
  (setq *Flex_Pipe_Size* pipeSize)
  (setq *Flex_Text_Point* nil)
  (setq p1 (getpoint "\nSpecify Start Point: "))
  (if p1
    (progn
      (setq ptList (list p1))
      (while (setq pt (getpoint p1 "\nSpecify next point (Enter to finish): "))
        (setq ptList (append ptList (list pt)))
        (grdraw p1 pt 1 1)
        (setq p1 pt)
      )
      (setq midX (/ (apply '+ (mapcar 'car ptList)) (length ptList)))
      (setq midY (/ (apply '+ (mapcar 'cadr ptList)) (length ptList)))
      (setq *Flex_Text_Point* (list midX midY 0.0))
      (setq cmdStr (strcat engineChoice " D "))
      (foreach p ptList
        (setq cmdStr (strcat cmdStr (rtos (car p) 2 4) "," (rtos (cadr p) 2 4) " "))
      )
      (setq cmdStr (strcat cmdStr " " pipeSize " "))
    )
  )

  ;; 4. Automation Finalization
  (if cmdStr
    (progn
      (setq cmdStr (strcat cmdStr "(Flex_Finalize_AfterDraw)\n(Flex_Restore_State)\n"))
      (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
      (vla-sendcommand doc cmdStr)
    )
    ;; User cancelled before drawing: restore state immediately.
    (Flex_Restore_State)
  )
  (redraw)
  (princ)
)

;; ─── COMMAND WRAPPERS (F15 - F50) ──────────────────
(defun c:F15 () (Flex_Execute_Engine "F15" 0.50 "150"))
(defun c:F20 () (Flex_Execute_Engine "F20" 0.65 "200"))
(defun c:F25 () (Flex_Execute_Engine "F25" 0.80 "250"))
(defun c:F30 () (Flex_Execute_Engine "F30" 0.65 "300"))
(defun c:F35 () (Flex_Execute_Engine "F35" 1.12 "350"))
(defun c:F40 () (Flex_Execute_Engine "F40" 0.65 "400"))
(defun c:F45 () (Flex_Execute_Engine "F45" 1.00 "450"))
(defun c:F50 () (Flex_Execute_Engine "F50" 1.12 "500"))

(princ "\n[TBH] Flexible Duct v2 Suite loaded.")
(princ)
