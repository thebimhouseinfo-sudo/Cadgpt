;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Circular Wipeout.lsp
;;; Module      : Special
;;; Command     : CWIPE, C2WIPE
;;; Description : Creates circular wipeouts for background masking under tags.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select center point and radius.
;;; 3. Creates a wipeout polygon mimicking a circular mask.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── COMMAND: CWIPE (Create) ───
(defun c:CWIPE (/ cen rad)
  (cond
    ( (not (or (member "acwipeout.arx" (arx)) (arxload "acwipeout.arx" nil)
               (member "acismui.arx"   (arx)) (arxload "acismui.arx"   nil)))
      (princ "\n[Error] Unable to load wipeout system files.")
    )
    ( (and
        (setq cen (getpoint "\nSpecify Center Point: "))
        (setq rad (getdist "\nSpecify Radius: " cen))
      )
      (LM:CircularWipeout cen rad)
      (princ "\n[Done] Circular Wipeout created.")
    )
  )
  (princ)
)

;; ─── COMMAND: C2WIPE (Convert) ───
(defun c:C2WIPE (/ ent enx inc sel wip)
  (cond
    ( (not (or (member "acwipeout.arx" (arx)) (arxload "acwipeout.arx" nil)
               (member "acismui.arx"   (arx)) (arxload "acismui.arx"   nil)))
      (princ "\n[Error] Unable to load wipeout system files.")
    )
    ( (setq sel (ssget "_:L" '((0 . "CIRCLE"))))
      (repeat (setq inc (sslength sel))
        (setq ent (ssname sel (setq inc (1- inc)))
              enx (entget ent)
              wip (LM:CircularWipeout (trans (cdr (assoc 10 enx)) ent 1) (cdr (assoc 40 enx)))
        )
        (if wip
          (progn
            (entmod (cons (cons -1 wip) (LM:defaultprops (entget wip))))
            (entdel ent)
          )
        )
      )
      (princ (strcat "\n[Done] Converted " (itoa (sslength sel)) " Circle(s) to circular Wipeouts."))
    )
  )
  (princ)
)

;; ─── INTERNAL HELPERS (Lee Mac) ───

(defun LM:defaultprops (elist)
  (mapcar
    (function
      (lambda (pair)
        (cond ((assoc (car pair) elist)) (pair))
      )
    )
   '( (008 . "0") (006 . "BYLAYER") (039 . 0.0) (062 . 256) (048 . 1.0) (370 . -1) )
  )
)

(defun LM:CircularWipeout (cen rad / ang inc lst acc)
  (setq acc 50
        inc (/ pi acc 0.5)
        ang 0.0
        lst '()
  )
  (repeat acc
    (setq lst (cons (list 14 (* 0.5 (cos ang)) (* 0.5 (sin ang))) lst)
          ang (+ ang inc)
    )
  )
  (entmakex
    (append
      (list
        '(000 . "WIPEOUT")
        '(100 . "AcDbEntity")
        '(100 . "AcDbWipeout")
        (cons 10 (trans (mapcar '- cen (list rad rad)) 1 0))
        (cons 11 (trans (list (+ rad rad) 0.0) 1 0 t))
        (cons 12 (trans (list 0.0 (+ rad rad)) 1 0 t))
        '(280 . 1)
        '(071 . 2)
      )
      (cons (last lst) lst)
    )
  )
)

(princ "\n[TBH] Circular Wipeout Tools loaded. Commands: CWIPE, C2WIPE")
(princ)