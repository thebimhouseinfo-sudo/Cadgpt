;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : AttModSuiteV1-1.lsp
;;; Module      : Annotation
;;; Command     : mvAtt, roAtt, edAtt, MVATT, ROATT, EDATT
;;; Description : Advanced attribute modification suite for bulk editing block data.
;;;
;;; 
;;; Usage       :
;;; 1. Run the command.
;;; 2. Select block(s) to modify.
;;; 3. Input new values or mapping criteria when prompted.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;;-----------------=={ Move Attributes }==--------------------;;
(defun c:mvAtt ( / *error* doc asel base disp lck ss tag )
  (defun *error* ( msg ) (if doc (LM:EndUndo doc)) (if lck (LM:ReLockLayers lck)) (if mutt (setvar 'NOMUTT mutt)) (or (wcmatch (strcase msg) "*BREAK,*CANCEL*,*EXIT*") (princ (strcat "\n** Error: " msg " **"))) (princ))
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (if (and (setq asel (LM:GetAttribSelection doc t)) (setq base (getpoint "\nSpecify Base Point: ")) (setq disp (getpoint "\nSpecify Second Point: " base)) (setq base (vlax-3D-point (trans base 1 0)) disp (vlax-3D-point (trans disp 1 0))))
    (progn (LM:StartUndo doc) (setq lck (LM:UnlockLayers doc) ss (cadr asel) tag (caddr asel))
      ((lambda ( i / e o ) (while (setq e (ssname ss (setq i (1+ i)))) (mapcar (function (lambda ( attrib ) (if (eq tag (vla-get-TagString attrib)) (vla-move attrib base disp)))) (append (vlax-invoke (setq o (vlax-ename->vla-object e)) 'GetAttributes) (vlax-invoke o 'GetConstantAttributes))))) -1)
      (LM:ReLockLayers lck) (LM:EndUndo doc))) (princ))

;;-----------------=={ Rotate Attributes }==------------------;;
(defun c:roAtt ( / *error* doc asel base disp lck ss tag )
  (defun *error* ( msg ) (if doc (LM:EndUndo doc)) (if lck (LM:ReLockLayers lck)) (if mutt (setvar 'NOMUTT mutt)) (or (wcmatch (strcase msg) "*BREAK,*CANCEL*,*EXIT*") (princ (strcat "\n** Error: " msg " **"))) (princ))
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (if (and (setq asel (LM:GetAttribSelection doc t)) (setq base (trans (vlax-get (setq o (car asel)) (if (and (or (not (vlax-property-available-p o 'MTextAttribute)) (eq :vlax-false (vla-get-MTextAttribute o))) (not (eq acAlignmentLeft (vla-get-Alignment o)))) 'TextAlignmentPoint 'InsertionPoint)) 0 1)) (setq disp (getangle "\nSpecify Rotation Angle: " base)) (setq disp (+ disp (angle '(0. 0. 0.) (trans (getvar 'UCSXDIR) 0 (trans '(0. 0. 1.) 1 0 t) t)))))
    (progn (LM:StartUndo doc) (setq lck (LM:UnlockLayers doc) ss (cadr asel) tag (caddr asel))
      ((lambda ( i / e o ) (while (setq e (ssname ss (setq i (1+ i)))) (mapcar (function (lambda ( attrib ) (if (eq tag (vla-get-TagString attrib)) (vla-put-rotation attrib disp)))) (append (vlax-invoke (setq o (vlax-ename->vla-object e)) 'GetAttributes) (vlax-invoke o 'GetConstantAttributes))))) -1)
      (LM:ReLockLayers lck) (LM:EndUndo doc))) (princ))

;;-------------------=={ Edit Attributes }==------------------;;
(defun c:edAtt ( / *error* LM:GetSavePath LM:WriteDCL MakeList VersionNumber doc SavePath dcfname dctitle TextStyles AlignLst asel dcTag dcFlag o ss tag e2 e4 e8 e16 e32 e64 )
  (setq VersionNumber "1.1") (or mode (setq mode 2))
  (defun *error* ( msg ) (if doc (LM:EndUndo doc)) (if lck (LM:ReLockLayers lck)) (if mutt (setvar 'NOMUTT mutt)) (if dcTag (unload_dialog dcTag)) (or (wcmatch (strcase msg) "*BREAK,*CANCEL*,*EXIT*") (princ (strcat "\n** Error: " msg " **"))) (princ))
  (defun LM:GetSavePath ( / tmp ) (cond ( (setq tmp (getvar 'ROAMABLEROOTPREFIX)) (or (eq "\\" (substr tmp (strlen tmp))) (setq tmp (strcat tmp "\\"))) (strcat tmp "Support") ) ( (setq tmp (findfile "ACAD.pat")) (setq tmp (vl-filename-directory tmp)) (and (eq "\\" (substr tmp (strlen tmp))) (setq tmp (substr tmp (1- (strlen tmp))))) tmp ) ))
  (defun LM:WriteDCL ( filename / ofile ) (cond ( (findfile filename) ) ( (setq ofile (open filename "w")) (foreach str '("edit5 : edit_box { edit_limit = 5; fixed_width = true; }" "pop : popup_list { width = 20; fixed_width = true; }" "" "EdAtt : dialog { key = \"dctitle\"; initial_focus = \"content\";" " spacer;" "" " : toggle { key = \"t2\" ; label = \"Content\"; }" " : edit_box { key = \"e2\" ; width = 45; fixed_width = true; }" "" " spacer;" "" " : row {" "" " : toggle { key = \"t4\" ; label = \"Style\" ; }" " : pop { key = \"e4\" ; }" "" " }" " : row {" "" " : toggle { key = \"t8\" ; label = \"Alignment\" ; }" " : pop { key = \"e8\" ; }" "" " }" " : row {" "" " : toggle { key = \"t16\"; label = \"Height\" ; }" " : edit5 { key = \"e16\"; }" "" " }" " : row {" "" " : toggle { key = \"t32\"; label = \"Oblique Angle\"; }" " : edit5 { key = \"e32\"; }" "" " }" " : row {" "" " : toggle { key = \"t64\"; label = \"Rotation\" ; }" " : edit5 { key = \"e64\"; }" "" " }" "" " spacer;" "" " ok_cancel;" "}") (write-line str ofile)) (setq ofile (close ofile)) (while (not (findfile filename))) filename ) ))
  (defun MakeList ( key lst ) (start_list key) (mapcar 'add_list lst) (end_list))
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (if (not (vl-file-directory-p (setq SavePath (LM:GetSavePath)))) (progn (LM:Popup "Warning" 16 "Save Path not Valid") (exit)))
  (setq dcfname (strcat SavePath "\\LMAC_AttMod_V" VersionNumber ".dcl") dctitle (strcat "Attribute Modification Suite V" VersionNumber ))
  (setq TextStyles (acad_strlsort (vlax-for s (vla-get-TextStyles doc) (setq TextStyles (cons (vla-get-Name s) TextStyles)))))
  (setq AlignLst (list (cons "Left" acAlignmentLeft) (cons "Center" acAlignmentCenter) (cons "Right" acAlignmentRight) (cons "Aligned" acAlignmentAligned) (cons "Middle" acAlignmentMiddle) (cons "Fit" acAlignmentFit) (cons "Top-Left" acAlignmentTopLeft) (cons "Top-Center" acAlignmentTopCenter) (cons "Top-Right" acAlignmentTopRight) (cons "Middle-Left" acAlignmentMiddleLeft) (cons "Middle-Center" acAlignmentMiddleCenter) (cons "Middle-Right" acAlignmentMiddleRight) (cons "Bottom-Left" acAlignmentBottomLeft) (cons "Bottom-Center" acAlignmentBottomCenter) (cons "Bottom-Right" acAlignmentBottomRight)))
  (cond ( (not (LM:WriteDCL dcfname)) (LM:Popup "Warning" 16 "Dialog Definition File could not be Written") ) ( (not (setq asel (LM:GetAttribSelection doc nil))) (princ "\n*Cancel*") ) ( (<= (setq dcTag (load_dialog dcfname)) 0) (LM:Popup "Warning" 16 "Dialog Definition File could not be Found") ) ( (not (new_dialog "EdAtt" dcTag)) (LM:Popup "Warning" 16 "Dialog could not be Loaded") )
    (t (mapcar 'MakeList '("e4" "e8") (list TextStyles (mapcar 'car AlignLst))) (set_tile "dctitle" dctitle) (setq o (car asel) ss (cadr asel) tag (caddr asel))
      ((lambda ( i ) (mapcar (function (lambda ( toggle edit value ) (mode_tile edit (- 1 (atoi (set_tile toggle (if (= (setq i (lsh i 1)) (logand i mode)) "1" "0"))))) (set (read edit) (set_tile edit value)) (action_tile toggle (strcat "(setq mode ((if (eq \"1\" $value) + -) mode " (itoa i) ")) " "(mode_tile " (vl-prin1-to-string edit) " (- 1 (atoi $value)))")) (action_tile edit (strcat "(setq " edit " $value)")))) '("t2" "t4" "t8" "t16" "t32" "t64") '("e2" "e4" "e8" "e16" "e32" "e64") (list (vlax-get-property o 'TextString) (itoa (vl-position (vlax-get-property o 'StyleName) TextStyles)) (itoa (vl-position (vlax-get-property o 'Alignment) (mapcar 'cdr AlignLst))) (rtos (vlax-get-property o 'Height)) (angtos (vlax-get-property o 'ObliqueAngle)) (angtos (vlax-get-property o 'Rotation))))) 1)
      (action_tile "accept" (vl-prin1-to-string (quote (progn (cond ( (not (and (setq hgt (distof e16)) (< 0 hgt))) (LM:Popup "Information" 48 "Attribute Height Must be a Positive Number!") ) ( (not (and (setq obl (angtof e32)) (<= (/ (* pi -17.) 36.) obl (/ (* pi 17.) 36.)))) (LM:Popup "Information" 48 "Oblique Angle Must be between -85 and 85 degrees") ) ( (not (setq rot (angtof e64))) (LM:Popup "Information" 48 "Attribute Rotation Must be Numerical") ) (t (setq e4 (nth (atoi e4) TextStyles) e8 (cdr (nth (atoi e8) AlignLst)) e16 hgt e32 obl e64 rot) (done_dialog 1) )))))) (setq dcFlag (start_dialog) dcTag (unload_dialog dcTag))
      (if (= 1 dcFlag) ((lambda ( i props ) (LM:StartUndo doc) (setq lck (LM:UnlockLayers doc)) (while (setq e (ssname ss (setq i (1+ i)))) (mapcar (function (lambda ( attrib ) (if (eq tag (vla-get-TagString attrib)) (mapcar (function (lambda ( prop / err tmp ) (if (eq (car prop) 'Alignment) (setq tmp (vlax-get-property attrib 'InsertionPoint))) (if (vl-catch-all-error-p (setq err (vl-catch-all-apply 'vlax-put-property (cons attrib prop)))) (princ (strcat "\nError: " (vl-catch-all-error-message err)))) (if (and tmp (not (eq acAlignmentLeft (cadr prop)))) (vlax-put-property attrib 'TextAlignmentPoint tmp)))) props)))) (vlax-invoke (vlax-ename->vla-object e) 'GetAttributes))) (LM:ReLockLayers lck) (LM:EndUndo doc)) -1 ((lambda ( j ) (vl-remove-if 'null (mapcar (function (lambda ( prop ) (if (= (setq j (lsh j 1)) (logand j mode)) (list prop (eval (read (strcat "e" (itoa j)))))))) '(TextString StyleName Alignment Height ObliqueAngle Rotation)))) 1)) (princ "\n*Cancel*")))) (princ))

;;---------------=={ Get Attribute Selection }==--------------;;
(defun LM:GetAttribSelection ( doc AllowMText / e b tag o mutt ss )
  (if
    (and
      (setq e
        (LM:Selectif
          (lambda ( x / y )
            (and
              (eq "ATTRIB" (cdr (assoc 0 (entget x))))
              (or AllowMText
                (not (vlax-property-available-p (setq y (vlax-ename->vla-object x)) 'MTextAttribute))
                (eq :vlax-false (vla-get-MTextAttribute y))
              )
            )
          )
          nentsel
          "\nSelect Attribute: "
        )
      )
    )
    (progn
      (princ (strcat "\n'" (cdr (assoc 2 (entget e))) "' Selected."))
      (setq b (LM:BlockName (vla-ObjectIDtoObject doc (vla-get-OwnerId (setq o (vlax-ename->vla-object e))))))
      (setq tag (vla-get-TagString o))
      (setq mutt (getvar 'NOMUTT))
      (setvar 'NOMUTT 1)
      (princ "\nSelect Blocks <All> : ")
      (setq ss
        (cond
          ( (ssget (list (cons 0 "INSERT") (cons 2 b) (cons 66 1))) )
          ( (ssget "_X" (list (cons 0 "INSERT") (cons 2 b) (cons 66 1))) )
        )
      )
      (setvar 'NOMUTT mutt)
    )
  )
  (list o ss tag)
)

;;--------------------=={ Start Undo }==----------------------;;
(defun LM:StartUndo ( doc ) (LM:EndUndo doc) (vla-StartUndoMark doc))
;;---------------------=={ End Undo }==-----------------------;;
(defun LM:EndUndo ( doc ) (if (= 8 (logand 8 (getvar 'UNDOCTL))) (vla-EndUndoMark doc)))
;;------------------=={ Unlock Layers }==---------------------;;
(defun LM:UnlockLayers ( doc / r ) (vlax-for l (vla-get-layers doc) (if (eq :vlax-true (vla-get-lock l)) (vla-put-lock (car (setq r (cons l r))) :vlax-false))) (reverse r))
;;-------------------=={ ReLock Layers }==--------------------;;
(defun LM:ReLockLayers ( lst ) (mapcar '(lambda ( l ) (vla-put-lock l :vlax-true)) lst))
;;-----------------------=={ Popup }==------------------------;;
(defun LM:Popup ( title flags msg / WSHShell result ) (setq WSHShell (vlax-create-object "WScript.Shell") result (vlax-invoke WSHShell 'Popup msg 0 title flags)) (vlax-release-object WSHShell) result)
;;---------------------=={ Select if }==----------------------;;
(defun LM:Selectif ( foo fun str / e ) (while (progn (setvar 'ERRNO 0) (setq e (car (fun str))) (cond ( (= 7 (getvar 'ERRNO)) (princ "\n** Missed, Try again **") ) ( (eq 'ENAME (type e)) (if (and foo (not (foo e))) (princ "\n** Invalid Object Selected **")) )))) e)
;;--------------------=={ Block Name }==----------------------;;
(defun LM:BlockName ( obj ) (vlax-get-property obj (if (vlax-property-available-p obj 'EffectiveName) 'EffectiveName 'Name)))

(defun c:MVATT () (c:mvAtt)) 
(defun c:ROATT () (c:roAtt)) 
(defun c:EDATT () (c:edAtt))

(princ "\n[TBH] Attribute Modification Suite loaded. Commands: MVATT, ROATT, EDATT")
(princ)
