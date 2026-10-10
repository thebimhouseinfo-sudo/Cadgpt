;;; CadGPT M0a — READ-ONLY AutoCAD region-selection probe.
;;; Standalone diagnostic, NOT part of the TBH toolkit auto-loader.
;;; Command: CGM0APROBE. Select with Window/Crossing or normal grips.
;;; No entmod, entmake, COM writes, reactors, layer or sysvar changes.

(vl-load-com)

(defun c:CGM0APROBE (/ *error* selection ent data layer idx
                       total inserts grilles tags others linked)
  (defun *error* (msg)
    (if (and msg (/= (strcase msg) "FUNCTION CANCELLED")
                 (/= (strcase msg) "QUIT / EXIT ABORT"))
      (princ (strcat "\n[M0A PROBE] Selection error: " msg)))
    (princ))
  (princ "\n[M0A PROBE] READ ONLY. Select a mixed region of grille, grille tag, text and duct; ENTER to finish.")
  (setq selection (vl-catch-all-apply 'ssget '()))
  (cond
    ((vl-catch-all-error-p selection)
      (princ (strcat "\n[M0A PROBE] Error: " (vl-catch-all-error-message selection))))
    ((not selection)
      (princ "\n[M0A PROBE] No selection (or cancelled)."))
    (T
      (setq idx 0
            total (sslength selection)
            inserts 0
            grilles 0
            tags 0
            linked 0
            others 0)
      (repeat total
        (setq ent (ssname selection idx)
              data (if ent (entget ent '("MEP_TAG_LINK")) nil)
              layer (if (and data (assoc 8 data))
                      (strcase (cdr (assoc 8 data))) ""))
        (if (and data (= (cdr (assoc 0 data)) "INSERT"))
          (progn
            (setq inserts (1+ inserts))
            (cond
              ((member layer '("HVAC-SAGRILLE" "HVAC-RAGRILLE"
                               "HVAC-OAGRILLE" "HVAC-EAGRILLE" "HVAC-TAGRILLE"))
                (setq grilles (1+ grilles))
                (if (assoc -3 data) (setq linked (1+ linked))))
              ((= layer "HVAC-GRILLETAG")
                (setq tags (1+ tags)))
              (T (setq others (1+ others)))))
          (setq others (1+ others)))
        (setq idx (1+ idx)))
      (princ (strcat
        "\n[M0A PROBE] Selection completed: " (itoa total)
        " entities; INSERTs=" (itoa inserts)
        "; Grilles=" (itoa grilles)
        "; GrilleTags=" (itoa tags)
        "; LinkedGrilles=" (itoa linked)
        "; Other=" (itoa others) "."))
      (princ "\n[M0A PROBE] Selection-only result captured. No DWG mutation by probe.")))
  (princ))

(princ "\nCadGPT M0a read-only probe loaded. Run CGM0APROBE.")
(princ)
