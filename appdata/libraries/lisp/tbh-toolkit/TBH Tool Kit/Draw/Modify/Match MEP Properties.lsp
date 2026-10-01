;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Match MEP Properties.lsp
;;; Module      : Draw\Modify
;;; Command     : MMA
;;; Description : Matches the system and insulation properties of a selected
;;;               source duct or fitting to selected duct and fitting targets.
;;;               Supports rectangular/round ducts, elbows, transitions,
;;;               taps, boots, risers, and blade dampers. Blade dampers receive
;;;               the system only because they do not carry insulation.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun mma:source-name (ent / ed)
  (setq ed (entget ent))
  (if (and (cdr (assoc 2 ed))
           (not (wcmatch (cdr (assoc 2 ed)) "`**")))
    (cdr (assoc 2 ed))
    (if (cd:has-func 'cd:insert-name)
      (cd:insert-name ent ed)
      nil)))

(defun mma:system-from-layer (lay / u)
  (setq u (strcase (if (= (type lay) 'STR) lay "")))
  (cond
    ((wcmatch u "*HVACDUCT-SA*") "SA")
    ((wcmatch u "*HVACDUCT-RA*") "RA")
    ((wcmatch u "*HVACDUCT-OA*") "OA")
    ((wcmatch u "*HVACDUCT-EA*") "EA")
    ((wcmatch u "*HVACDUCT-TA*") "TA")
    (T nil)))

(defun mma:system-from-name (bn / u)
  (setq u (strcase (if (= (type bn) 'STR) bn "")))
  (cond
    ((wcmatch u "*-SA-*") "SA")
    ((wcmatch u "*-RA-*") "RA")
    ((wcmatch u "*-OA-*") "OA")
    ((wcmatch u "*-EA-*") "EA")
    ((wcmatch u "*-TA-*") "TA")
    (T nil)))

(defun mma:system-of (ent / ed lay bn result)
  (setq ed (entget ent)
        lay (cdr (assoc 8 ed))
        bn (cdr (assoc 2 ed)))
  (setq result (mma:system-from-layer lay))
  (if (not result)
    (setq result (mma:system-from-name bn)))
  result)

(defun mma:valid-system (sys)
  (cond
    ((wcmatch sys "SA") "SA")
    ((wcmatch sys "RA") "RA")
    ((wcmatch sys "OA") "OA")
    ((wcmatch sys "EA") "EA")
    ((wcmatch sys "TA") "TA")
    (T nil)))

(defun c:MMA (/ src srcEnt srcName sys insTok ins ss targets ent bn fam result changed skipped)
  (if (not (cd:has-func 'cd:classify-family))
    (princ "\n[MMA] Please load Change Duct Type.lsp first.")
    (progn
      (setq src (entsel "\n[MMA] Select SOURCE duct or fitting: "))
      (if src
        (progn
          (setq srcEnt (car src)
                srcName (mma:source-name srcEnt)
                sys (mma:valid-system (mma:system-of srcEnt)))
          (if (/= (type srcName) 'STR)
            (setq srcName ""))
          (if (not sys)
            (princ "\n[MMA] Cannot detect source system.")
            (progn
              (setq insTok (cd:find-ins-token (cd:split srcName "-"))
                    ins (cd:ins-token->idx insTok))
              (princ (strcat "\n[MMA] Source=" srcName
                             " System=" sys
                             " Ins=" (itoa ins)))
              (setq ss (ssget '((0 . "INSERT"))))
              (if ss
                (progn
                  ;; Never send the source back through CD when it is included
                  ;; in a crossing/window selection.
                  (ssdel srcEnt ss)
                  ;; CD may internally modify selection sets while rebuilding
                  ;; blocks, so freeze the target enames before processing.
                  (setq targets '())
                  (repeat (sslength ss)
                    (setq targets (cons (ssname ss 0) targets))
                    (ssdel (ssname ss 0) ss))
                  (setq targets (reverse targets)
                        changed 0
                        skipped 0)
                  (foreach ent targets
                    (setq bn (cdr (assoc 2 (entget ent))))
                    (if (and (/= (type bn) 'STR)
                             (cd:has-func 'cd:insert-name))
                      (setq bn (cd:insert-name ent (entget ent))))
                    (if (/= (type bn) 'STR)
                      (setq bn nil))
                    (cond
                      ((or (null bn) (equal ent srcEnt))
                       (setq skipped (1+ skipped)))
                      (T
                       (setq fam (cd:classify-family bn))
                       (if (not (member fam '(DUCT EUD E1 E2 E11 TRANSITION EC TAP BT BD RI R2)))
                         (setq skipped (1+ skipped))
                         (progn
                           (setq result
                             (vl-catch-all-apply
                               'cd:apply-change-by-family
                               (list fam ent bn sys ins)))
                                (if (vl-catch-all-error-p result)
                              (setq result nil))
                           (if result
                             (setq changed (1+ changed))
                             (setq skipped (1+ skipped))))))
                    )
                  (princ (strcat "\n[MMA] Changed=" (itoa changed)
                                 " Skipped=" (itoa skipped))))
                 )
         (princ "\n[MMA] Cancelled."))))
  ))))
  (princ))

(princ "\n[TBH] MMA loaded. Command: MMA")
(princ)
