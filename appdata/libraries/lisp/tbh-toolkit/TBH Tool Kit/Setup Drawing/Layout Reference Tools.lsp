;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Layout Reference Tools.lsp
;;; Module      : Setup Drawing
;;; Command     : B101, M101, M100, REF, UPREF
;;; Description : Layout viewport layer presets and drawing-continuation
;;;               reference text tools.
;;;
;;; Command Details:
;;; - B101
;;;   Builders Work layout preset. Freezes HVAC duct, grille, flex duct,
;;;   tag, note, dimension, and related HVAC layers in the current viewport
;;;   using VPLAYER Freeze Current Viewport. Use on Builders Work sheets where
;;;   HVAC drawing content should be hidden.
;;;
;;; - M101
;;;   Main HVAC layout preset. Freezes Builders Work penetration/text/dimension
;;;   layers and selected non-main annotation layers in the current viewport.
;;;   Use on normal M101-style HVAC plans after viewport activation.
;;;
;;; - M100
;;;   Overall/general layout preset. Freezes detail annotation, BW layers,
;;;   duct number, text, notes, legend, and dimension layers in the current
;;;   viewport. Use on overall sheets where detailed tags should be reduced.
;;;
;;; - REF
;;;   Creates cyan reference text:
;;;     "SEE DRAWING <LAYOUT-PREFIX><NUMBER> FOR CONTINUATION"
;;;   The current layout name is parsed into prefix + trailing number. The
;;;   prompt asks for the target drawing number and keeps leading digits from
;;;   the current layout number when you type a shorter suffix.
;;;   Placement controls:
;;;     Move mouse = preview text position
;;;     Space      = rotate text 90 degrees
;;;     Click      = place text
;;;     Esc        = cancel
;;;
;;; - UPREF
;;;   Updates all placed reference notes across paper-space layouts so their
;;;   drawing prefix matches each layout tab name. The numeric target part is
;;;   preserved. Use after renaming layout tabs or copying reference notes
;;;   between layouts.
;;;
;;; Notes:
;;; - B101/M101/M100 act on the current viewport. Activate the target viewport
;;;   before running them.
;;; - REF creates TEXT on layer 0, color cyan, style HVACS, height 3.0,
;;;   width factor 0.8.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;;; =============================================================================
;;; PART 1: VIEWPORT LAYER PRESETS
;;; =============================================================================

(defun FreezeLayers (raw / clean lay)
  (setq clean '())
  (foreach lay raw
    (if (not (member (strcase lay) clean))
      (setq clean (append clean (list (strcase lay))))
    )
  )
  (foreach lay clean
    (if (tblsearch "LAYER" lay)
      (command "_.vplayer" "_freeze" lay "_C" "")
    )
  )
)

(defun c:B101 (/ raw)
  (princ "\n[Setup] B101: Freezing HVAC layers for Builders Work layout...")
  (setq raw '(
    "Hvacduct-ra-Center" "Hvacduct-sa-Center" "Hvacduct-oa-Center" "Hvacduct-ea-Center"
    "Hvacduct-insul" "Hvac-Accessories" "Hvacduct-Filter" "HvacInsulation EX"
    "Hvac-EAGrille" "Hvacduct-Text" "Hvactext" "-Legend" "Hvac-Chilled water supply"
    "Hvac-Chilled water return" "Hvac-Condensate Pipe Layer" "Hvac-FlexConn"
    "HvacInsulation IN" "Hvac-TagHeights" "Hvac-SAGrille" "Hvac-RAGrille"
    "Hvac-OAGrille" "Hvac-EAGrille" "Hvac-DuctNo" "Hvacduct-Flexduct"
    "Hvac-Dim" "Hvacduct-ra" "Hvacduct-ra-Shading" "Hvacduct-ea" "Hvacduct-ea-Shading"
    "Hvacduct-sa" "Hvacduct-sa-Shading" "Hvacduct-oa" "Hvacduct-oa-Shading"
    "Hvacins" "Hvac-Notes" "0" "HvacDuctText" "Hvac-AirArrow" "Hvacduct-TurningVanes"
    "Hvac-SectionArrow" "Center" "Hvac-GrilleTag" "Hvacduct-Flange" "Hvac-Hot Water Return"
    "Hvac-Hot Water Return Shade" "Hvac-Hot Water Supply" "Hvac-Hot Water Supply Shade"
    "Hvac-Filter"
  ))
  (FreezeLayers raw)
  (princ "\n[Done] B101 setup complete.")
  (princ)
)

(defun c:M101 (/ raw)
  (princ "\n[Setup] M101: Freezing BW layers for Main Layouts...")
  (setq raw '(
    "Hvacduct-ra-Center"
    "BW-Dim" "BW-Peno" "BW-PenoClg" "BW-PenoRoof"
    "BW-PenoShade" "BW-PenoTag" "BW-PenoWall" "BW-Text"
    "Hvac-BWPeno" "Hvac-EquipTag Height"
  ))
  (FreezeLayers raw)
  (princ "\n[Done] M101 setup complete.")
  (princ)
)

(defun c:M100 (/ raw)
  (princ "\n[Setup] M100: Freezing detail layers for Overall Layouts...")
  (setq raw '(
    "Hvacduct-ra-Center" "Hvac-Notes" "Hvac-Dim" "Hvac-TagHeights"
    "BW-Dim" "BW-Peno" "BW-PenoClg" "BW-PenoRoof"
    "BW-PenoShade" "BW-PenoTag" "BW-PenoWall" "BW-Text"
    "Hvac-EquipTagHeights" "Hvac-DuctNo" "HvacDuctText"
    "Hvac-BWPeno" "-Legend" "Hvactext" "Hvacduct-Text" "Hvac-EquipTag Height"
  ))
  (FreezeLayers raw)
  (princ "\n[Done] M100 setup complete.")
  (princ)
)

;;; =============================================================================
;;; PART 2: REFERENCE TEXT
;;; =============================================================================

(defun _refnote-parse-layout (name / len i prefix numstr num)
  (setq len (strlen name))
  (setq i len)
  (while (and (> i 0)
              (wcmatch (substr name i 1) "[0-9]"))
    (setq i (1- i)))
  (setq prefix (substr name 1 i))
  (setq numstr (substr name (1+ i)))
  (setq num (if (> (strlen numstr) 0) (atoi numstr) 0))
  (list prefix num)
)

(defun _refnote-make-text (pt ang txt / en ed)
  (setq en
    (entmakex
      (list
        (cons 0 "TEXT")
        (cons 8 "0")
        (cons 62 4)
        (cons 7 "HVACS")
        (cons 40 3.0)
        (cons 10 pt)
        (cons 50 ang)
        (cons 1 (strcase txt))
        (cons 72 1)
        (cons 73 1)
        (cons 11 pt)
      )
    )
  )
  (setq ed (entget en))
  (entmod (subst (cons 41 0.8) (assoc 41 ed) ed))
  en
)

(defun _refnote-update-ptang (en pt ang / ed)
  (setq ed (entget en))
  (setq ed (subst (cons 10 pt) (assoc 10 ed) ed))
  (setq ed (subst (cons 11 pt) (assoc 11 ed) ed))
  (setq ed (subst (cons 50 ang) (assoc 50 ed) ed))
  (entmod ed)
)

(defun _refnote-add-xdata (en / ed)
  (vl-catch-all-apply 'regapp (list "RefNote"))
  (setq ed (entget en))
  (entmod
    (append ed (list (list -3 (list "RefNote" (cons 1000 "REF")))))
  )
)

(defun c:REF (/ lay parsed prefix num numStr inputStr finalNum txt en done ev pt ang)
  (setq lay (getvar "CTAB"))
  (setq parsed (_refnote-parse-layout lay))
  (setq prefix (car parsed))
  (setq num    (cadr parsed))
  (setq numStr (itoa num))

  (setq inputStr (getstring T (strcat "\nEnter target drawing number <" numStr ">: ")))
  (if (= inputStr "") (setq inputStr numStr))

  (setq finalNum
        (if (>= (strlen inputStr) (strlen numStr))
          inputStr
          (strcat
            (substr numStr 1 (- (strlen numStr) (strlen inputStr)))
            inputStr
          )
        )
  )

  (setq txt (strcat "SEE DRAWING " (strcase prefix) finalNum " FOR CONTINUATION"))

  (princ "\n[RefNote] Interactive Placement: SPACE=Rotate, CLICK=Place, ESC=Exit.")
  (setq en nil ang 0.0 done nil)
  (while (not done)
    (setq ev (grread T 15 0))
    (cond
      ((= (car ev) 5)
       (setq pt (cadr ev))
       (if en
         (_refnote-update-ptang en pt ang)
         (setq en (_refnote-make-text pt ang txt))
       )
      )
      ((= (car ev) 2)
       (cond
         ((= (cadr ev) 32)
           (setq ang (+ ang (/ pi 2.0)))
           (if (>= ang (* 2.0 pi)) (setq ang 0.0))
           (if (and en pt) (_refnote-update-ptang en pt ang))
         )
         ((or (= (cadr ev) 27) (= (cadr ev) 3))
           (if en (entdel en))
           (princ "\n[TBH] Placement cancelled.")
           (setq done T en nil)
         )
       )
      )
      ((= (car ev) 3)
       (if en (_refnote-add-xdata en))
       (setq done T)
       (princ "\n[TBH] Reference note placed.")
      )
    )
  )
  (princ)
)

(defun c:UPREF (/ doc lay name ss i en ed old core prefix_layout num_start numstr new)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (princ "\n[TBH] Synchronizing all project reference notes...")
  (vlax-for lay (vla-get-Layouts doc)
    (setq name (vla-get-Name lay))
    (if (/= (strcase name) "MODEL")
      (progn
        (setq num_start 1)
        (while (and (<= num_start (strlen name))
                    (not (wcmatch (substr name num_start 1) "[0-9]")))
          (setq num_start (1+ num_start))
        )
        (setq prefix_layout (substr name 1 (1- num_start)))

        (setq ss (ssget "_X" (list (cons 410 name) (cons 0 "TEXT"))))
        (if ss
          (progn
            (setq i 0)
            (while (< i (sslength ss))
              (setq en (ssname ss i))
              (setq ed (entget en))
              (setq old (cdr (assoc 1 ed)))
              (if (and old (wcmatch (strcase old) "SEE DRAWING*FOR CONTINUATION"))
                (progn
                  (setq core (vl-string-trim " " (vl-string-subst "" "SEE DRAWING " old)))
                  (setq core (vl-string-trim " " (vl-string-subst "" " FOR CONTINUATION" core)))
                  (setq num_start 1)
                  (while (and (<= num_start (strlen core))
                              (not (wcmatch (substr core num_start 1) "[0-9]")))
                    (setq num_start (1+ num_start))
                  )
                  (if (<= num_start (strlen core))
                    (progn
                      (setq numstr (substr core num_start))
                      (setq new (strcat "SEE DRAWING " prefix_layout numstr " FOR CONTINUATION"))
                      (if (/= old new)
                        (entmod (subst (cons 1 new) (assoc 1 ed) ed))
                      )
                    )
                  )
                )
              )
              (setq i (1+ i))
            )
          )
        )
      )
    )
  )
  (princ "\n[TBH] Success: All reference prefixes synchronized with Layout names.")
  (princ)
)

(princ "\n[TBH] Layout Reference Tools loaded. Commands: B101, M101, M100, REF, UPREF")
(princ)
