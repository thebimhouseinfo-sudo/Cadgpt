;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Split Viewport.lsp
;;; Module      : Setup Drawing
;;; Command     : SPLITVP
;;; Description : Splits existing viewports uniformly for detail alignment.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select existing viewport.
;;; 3. Specify horizontal/vertical split ratio to subdivide viewports.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun c:SPLITVP (/ *error* acDoc layouts origLayout pVP vpObj vpCenterPS vpMSCenter vpScale 
                   ssSource lstSource entTemplate objTemplate tempMin tempMax tempW tempH tempCenterPS
                   entKeyplan objKeyplan keyMin keyMax keyW keyH prefix startNum i rectObj 
                   rMin rMax rCenterPS dx dy msTarget newLayName newLayout newVP namingData 
                   item oldVpCreateVp pt1 pt2 get-vpid vpMinPS vpMaxPS relX relY relW relH 
                   indP1 indP2 oldHpScale mode)
  
  (setq acDoc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq layouts (vla-get-Layouts acDoc))

  ;; ─── INTERNAL HELPERS ───
  (defun get-vpid (obj)
    (cdr (assoc 69 (entget (vlax-vla-object->ename obj))))
  )

  (defun *error* (msg)
    (if (and oldVpCreateVp (numberp oldVpCreateVp)) (setvar "LAYOUTCREATEVIEWPORT" oldVpCreateVp))
    (if (and oldHpScale (numberp oldHpScale)) (setvar "HPSCALE" oldHpScale))
    (if (and origLayout (/= (getvar "CTAB") origLayout))
      (setvar "CTAB" origLayout)
    )
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\n[Error] " msg))
    )
    (vla-EndUndoMark acDoc)
    (princ)
  )

  (defun split-name-num (str / i prefix numStr)
    (setq i (strlen str))
    (while (and (> i 0) (member (substr str i 1) '("0" "1" "2" "3" "4" "5" "6" "7" "8" "9")))
      (setq i (1- i))
    )
    (if (= i (strlen str))
        (list str "0")
        (list (substr str 1 i) (substr str (1+ i)))
    )
  )

  (defun sort-z-pattern (lst / fuzzy)
    (setq fuzzy 20.0) 
    (vl-sort lst 
      '(lambda (a b / ptA ptB)
         (setq ptA (car a) ptB (car b))
         (if (not (equal (cadr ptA) (cadr ptB) fuzzy))
           (> (cadr ptA) (cadr ptB)) 
           (< (car ptA) (car ptB))   
         )
      )
    )
  )

  ;; ─── INITIALIZATION ───
  (vla-StartUndoMark acDoc)
  (setq origLayout (getvar "CTAB"))
  (setq oldVpCreateVp (getvar "LAYOUTCREATEVIEWPORT"))
  (setq oldHpScale (getvar "HPSCALE"))
  (setvar "LAYOUTCREATEVIEWPORT" 0) 

  (if (= (getvar "TILEMODE") 1)
    (progn (princ "\n[Error] This command only works in Layout (Paper Space).") (exit))
  )

  ;; Mode Selection
  (initget "0 1 Plan Section")
  (setq mode (getkword "\nSelect drafting mode [0: Plan / 1: Section] <0>: "))
  (cond
    ((or (null mode) (= mode "0") (= mode "Plan")) (setq mode "Plan"))
    ((or (= mode "1") (= mode "Section")) (setq mode "Section"))
  )

  ;; 1. Select Source Viewport
  (princ "\nStep 1: Select the main SOURCE Viewport: ")
  (setq pVP (ssget "_+.:E:S" '((0 . "VIEWPORT"))))
  (if (not pVP) (progn (princ "\n[Error] No Viewport selected.") (exit)))
  (setq vpObj (vlax-ename->vla-object (ssname pVP 0)))
  
  (setq vpScale  (vlax-get vpObj 'CustomScale))
  (setq vpCenterPS (vlax-get vpObj 'Center))
  (vla-GetBoundingBox vpObj 'vpMinPS 'vpMaxPS)
  (setq vpMinPS (vlax-safearray->list vpMinPS)
        vpMaxPS (vlax-safearray->list vpMaxPS))
  
  (vla-put-MSpace acDoc :vlax-true)
  (setvar "CVPORT" (get-vpid vpObj))
  (setq vpMSCenter (getvar "VIEWCTR"))
  (vla-put-MSpace acDoc :vlax-false)

  ;; 2. Select Source Boundaries
  (princ "\nStep 2: Select rectangular boundaries (LWPolylines) to extract: ")
  (setq ssSource (ssget '((0 . "LWPOLYLINE") (70 . 1))))
  (if (not ssSource) (progn (princ "\n[Error] No source rectangles found.") (exit)))

  ;; 3. Template and Keyplan (Plan mode only)
  (if (= mode "Plan")
    (progn
      (princ "\nStep 3: Select the DESTINATION Template Frame (Position on new layout): ")
      (setq entTemplate (car (entsel)))
      (if (not entTemplate) (progn (princ "\n[Error] Template selection failed.") (exit)))
      (setq objTemplate (vlax-ename->vla-object entTemplate))

      (vla-GetBoundingBox objTemplate 'tempMin 'tempMax)
      (setq tempMin (vlax-safearray->list tempMin) tempMax (vlax-safearray->list tempMax))
      (setq tempW (- (car tempMax) (car tempMin))
            tempH (- (cadr tempMax) (cadr tempMin))
            tempCenterPS (list (/ (+ (car tempMin) (car tempMax)) 2.0) (/ (+ (cadr tempMin) (cadr tempMax)) 2.0)))

      (princ "\nStep 4: Select KEYPLAN boundary rectangle (Optional, Enter to skip): ")
      (setq entKeyplan (car (entsel)))
      (if entKeyplan
        (progn
          (setq objKeyplan (vlax-ename->vla-object entKeyplan))
          (vla-GetBoundingBox objKeyplan 'keyMin 'keyMax)
          (setq keyMin (vlax-safearray->list keyMin) keyMax (vlax-safearray->list keyMax))
          (setq keyW (- (car keyMax) (car keyMin))
                keyH (- (cadr keyMax) (cadr keyMin)))
        )
      )
    )
  )

  ;; 4. Processing
  (setq namingData (split-name-num origLayout))
  (setq prefix (car namingData) startNum (atoi (cadr namingData)))

  (setq i 0 lstSource nil)
  (repeat (sslength ssSource)
    (setq rectObj (vlax-ename->vla-object (ssname ssSource i)))
    (vla-GetBoundingBox rectObj 'rMin 'rMax)
    (setq rMin (vlax-safearray->list rMin) rMax (vlax-safearray->list rMax))
    (setq rCenterPS (list (/ (+ (car rMin) (car rMax)) 2.0) (/ (+ (cadr rMin) (cadr rMax)) 2.0)))
    (setq lstSource (cons (list rCenterPS rectObj rMin rMax) lstSource))
    (setq i (1+ i))
  )
  (setq lstSource (sort-z-pattern lstSource))

  (vla-add (vla-get-Layers acDoc) "Defpoints")
  (setq i 1)
  (foreach item lstSource
    (setq rCenterPS (car item) rectObj (cadr item) rMin (nth 2 item) rMax (nth 3 item))

    (setq dx (- (car rCenterPS) (car vpCenterPS)))
    (setq dy (- (cadr rCenterPS) (cadr vpCenterPS)))
    (setq msTarget (list (+ (car vpMSCenter) (/ dx vpScale)) (+ (cadr vpMSCenter) (/ dy vpScale)) 0.0))

    (if (= mode "Plan")
      (progn
        (setq newLayName (strcat prefix (itoa (+ startNum i))))
        (vl-catch-all-apply '(lambda () (vla-delete (vla-item layouts newLayName))))
        (setq newLayout (vla-add layouts newLayName))
        (setvar "CTAB" newLayName)
        
        (vlax-for obj (vla-get-Block newLayout)
          (if (and (= (vla-get-ObjectName obj) "AcDbViewport") (> (get-vpid obj) 1)) (vla-delete obj))
        )
        (command "_.pspace")
        (setq pt1 (list (- (car tempCenterPS) (/ tempW 2.0)) (- (cadr tempCenterPS) (/ tempH 2.0))))
        (setq pt2 (list (+ (car tempCenterPS) (/ tempW 2.0)) (+ (cadr tempCenterPS) (/ tempH 2.0))))
        (command "_.mview" pt1 pt2)
      )
      (command "_.mview" rMin rMax)
    )

    (setq newVP (vlax-ename->vla-object (entlast)))
    (vlax-put newVP 'Layer "Defpoints")
    (vlax-put newVP 'ViewportOn :vlax-true) 
    (vlax-put newVP 'CustomScale vpScale)

    (vla-put-MSpace acDoc :vlax-true)
    (setvar "CVPORT" (get-vpid newVP))
    (command "_.zoom" "_c" msTarget "")
    (vla-put-MSpace acDoc :vlax-false)
    
    (vlax-put newVP 'DisplayLocked :vlax-true)

    ;; KEYPLAN Hatching
    (if (and (= mode "Plan") entKeyplan)
      (progn
        (setq relX (/ (- (car rMin) (car vpMinPS)) (- (car vpMaxPS) (car vpMinPS)))
              relY (/ (- (cadr rMin) (cadr vpMinPS)) (- (cadr vpMaxPS) (cadr vpMinPS)))
              relW (/ (- (car rMax) (car rMin)) (- (car vpMaxPS) (car vpMinPS)))
              relH (/ (- (cadr rMax) (cadr rMin)) (- (cadr vpMaxPS) (cadr vpMinPS))))
        (setq indP1 (list (+ (car keyMin) (* relX keyW)) (+ (cadr keyMin) (* relY keyH)))
              indP2 (list (+ (car indP1) (* relW keyW)) (+ (cadr indP1) (* relH keyH))))
        
        (command "_.rectang" "_non" indP1 "_non" indP2)
        (command "_.chprop" (entlast) "" "_C" "1" "_LA" "0" "")
        (setvar "HPSCALE" 1.0)
        (command "_.-bhatch" "_p" "ANSI31" "1.0" "0" "_s" (entlast) "" "")
        (command "_.chprop" (entlast) "" "_C" "1" "_LA" "0" "")
      )
    )

    (princ (strcat "\n[Status] Processed area: " (itoa i)))
    (setq i (1+ i))
  )

  ;; ─── CLEANUP ───
  (princ "\nCleaning up working boundaries...")
  (vl-catch-all-apply 'vla-delete (list vpObj))
  (if objTemplate (vl-catch-all-apply 'vla-delete (list objTemplate)))
  (foreach item lstSource
    (setq rectObj (cadr item))
    (vl-catch-all-apply 'vla-delete (list rectObj))
  )

  (setvar "HPSCALE" oldHpScale)
  (setvar "CTAB" origLayout)
  (if (and oldVpCreateVp (numberp oldVpCreateVp)) (setvar "LAYOUTCREATEVIEWPORT" oldVpCreateVp))
  (vla-EndUndoMark acDoc)
  (princ (strcat "\n[Done] Successfully processed " (itoa (length lstSource)) " areas and cleaned the drawing."))
  (princ)
)

(princ "\n[TBH] Split Viewport Tool loaded. Type 'SPLITVP' to start.")
(princ)