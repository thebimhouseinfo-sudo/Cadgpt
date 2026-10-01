;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Match Hatch.lsp
;;; Module      : Special
;;; Command     : MH, MHRESET
;;; Description : Matches hatch patterns and scales across different hatch objects quickly.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select source hatch pattern.
;;; 3. Select target polylines or regions to instantly apply identical scales and angles.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; Project standard from ai/knowledge/mep-standards.json: common_layers.insulation_hatch
(if (not (boundp '*MH:InsulHatchLayer*))
  (setq *MH:InsulHatchLayer* "HVACDUCT-INSUL")
)

(defun mh:is-insu-layer (lay / u)
  (setq u (strcase (if lay lay "")))
  (or (= u *MH:InsulHatchLayer*)
      (wcmatch u (strcat "*|" *MH:InsulHatchLayer*)))
)

(defun mh:get-doc nil
  (vla-get-ActiveDocument (vlax-get-acad-object))
)

(defun mh:get-block-name (ename / ed obj)
  (setq ed (entget ename))
  (if (and ed (= (cdr (assoc 0 ed)) "INSERT"))
    (progn
      (setq obj (vlax-ename->vla-object ename))
      (if (vlax-property-available-p obj 'EffectiveName)
        (vla-get-EffectiveName obj)
        (cdr (assoc 2 ed))
      )
    )
  )
)

(defun mh:get-insert-transform (ename / ed)
  (setq ed (entget ename))
  (if (and ed (= (cdr (assoc 0 ed)) "INSERT"))
    (list
      (cdr (assoc 10 ed))
      (if (assoc 50 ed) (cdr (assoc 50 ed)) 0.0)
      (if (assoc 41 ed) (cdr (assoc 41 ed)) 1.0)
      (if (assoc 42 ed) (cdr (assoc 42 ed)) 1.0)
    )
  )
)

(defun mh:is-insu-hatch (ename / ed lay)
  (setq ed (entget ename)
        lay (if ed (cdr (assoc 8 ed)) ""))
  (and ed
       (= (cdr (assoc 0 ed)) "HATCH")
  (mh:is-insu-layer lay))
)

(defun mh:world-from-local (pt ins rot sx sy / ca sa x y)
  (setq ca (cos rot)
        sa (sin rot)
        x (car pt)
        y (cadr pt))
  (list
    (+ (car ins) (- (* sx x ca) (* sy y sa)))
    (+ (cadr ins) (+ (* sx x sa) (* sy y ca)))
    0.0
  )
)

(defun mh:local-from-world (pt ins rot sx sy / dx dy ca sa)
  (if (or (equal sx 0.0 1e-12) (equal sy 0.0 1e-12))
    nil
    (progn
      (setq dx (- (car pt) (car ins))
            dy (- (cadr pt) (cadr ins))
            ca (cos rot)
            sa (sin rot))
      (list
        (/ (+ (* ca dx) (* sa dy)) sx)
        (/ (+ (* (- sa) dx) (* ca dy)) sy)
        0.0
      )
    )
  )
)

(defun mh:angle-local-to-world (ang rot sx sy / ca sa lx ly wx wy)
  (setq ca (cos rot)
        sa (sin rot)
        lx (cos ang)
        ly (sin ang)
        wx (- (* sx lx ca) (* sy ly sa))
        wy (+ (* sx lx sa) (* sy ly ca)))
  (atan wy wx)
)

(defun mh:angle-world-to-local (ang rot sx sy / ca sa wx wy lx ly)
  (if (or (equal sx 0.0 1e-12) (equal sy 0.0 1e-12))
    nil
    (progn
      (setq ca (cos rot)
            sa (sin rot)
            wx (cos ang)
            wy (sin ang)
            lx (/ (+ (* ca wx) (* sa wy)) sx)
            ly (/ (+ (* (- sa) wx) (* ca wy)) sy))
      (atan ly lx)
    )
  )
)

(defun mh:block-hatches (blk-name / adoc bdef insu-hatches)
  (setq adoc (mh:get-doc)
        bdef (vl-catch-all-apply 'vla-item (list (vla-get-Blocks adoc) blk-name))
        insu-hatches nil)
  (if (vl-catch-all-error-p bdef)
    nil
    (progn
      (vlax-for obj bdef
        (if (= (vla-get-ObjectName obj) "AcDbHatch")
          (progn
            (if (mh:is-insu-layer (vla-get-Layer obj))
              (setq insu-hatches (cons (vlax-vla-object->ename obj) insu-hatches))
            )
          )
        )
      )
      (reverse insu-hatches)
    )
  )
)

(defun mh:find-source-hatch (source-ent / ed bname hlist)
  (setq ed (entget source-ent))
  (cond
    ((null ed) nil)
    ((= (cdr (assoc 0 ed)) "HATCH")
      (if (mh:is-insu-hatch source-ent) source-ent nil)
    )
    ((= (cdr (assoc 0 ed)) "INSERT")
      (setq bname (mh:get-block-name source-ent)
            hlist (if bname (mh:block-hatches bname) nil))
      (car hlist)
    )
    (T nil)
  )
)

(defun mh:source-world-props (source-ent / src-hatch src-obj src-ed src-type tr ins rot sx sy loc-origin world-ang)
  (setq src-hatch (mh:find-source-hatch source-ent)
        src-ed (entget source-ent)
        src-type (if src-ed (cdr (assoc 0 src-ed)) nil))
  (if (null src-hatch)
    nil
    (progn
      (setq src-obj (vlax-ename->vla-object src-hatch))
      (cond
        ((= src-type "INSERT")
          (setq tr (mh:get-insert-transform source-ent)
                ins (car tr)
                rot (cadr tr)
                sx (caddr tr)
                sy (cadddr tr)
                loc-origin (vlax-get src-obj 'Origin))
          (setq world-ang (if tr (mh:angle-local-to-world (vla-get-PatternAngle src-obj) rot sx sy) nil))
          (if (and tr world-ang)
            (list
              (cons 'pattern-type (vla-get-PatternType src-obj))
              (cons 'pattern-name (vla-get-PatternName src-obj))
              (cons 'world-scale (* (vla-get-PatternScale src-obj) (abs sx)))
              (cons 'world-angle world-ang)
              (cons 'world-origin (mh:world-from-local loc-origin ins rot sx sy))
              (cons 'source-hatch src-hatch)
            )
          )
        )
        ((= src-type "HATCH")
          (list
            (cons 'pattern-type (vla-get-PatternType src-obj))
            (cons 'pattern-name (vla-get-PatternName src-obj))
            (cons 'world-scale (vla-get-PatternScale src-obj))
            (cons 'world-angle (vla-get-PatternAngle src-obj))
            (cons 'world-origin (vlax-get src-obj 'Origin))
            (cons 'source-hatch src-hatch)
          )
        )
      )
    )
  )
)

(defun mh:set-hatch-props (hatch-ename pat-type pat-name scl ang org / obj r0 r1 r2 r3 r4)
  (setq obj (vlax-ename->vla-object hatch-ename))
  (setq r0 (vl-catch-all-apply 'vla-SetPattern (list obj pat-type pat-name))
        r1 (vl-catch-all-apply 'vla-put-PatternScale (list obj scl))
        r2 (vl-catch-all-apply 'vla-put-PatternAngle (list obj ang))
        r3 (vl-catch-all-apply 'vlax-put (list obj 'Origin org))
        r4 (vl-catch-all-apply 'vla-Evaluate (list obj)))
  (vl-catch-all-apply 'vla-put-AssociativeHatch (list obj :vlax-false))
  (not (or (vl-catch-all-error-p r0)
           (vl-catch-all-error-p r1)
           (vl-catch-all-error-p r2)
           (vl-catch-all-error-p r3)
           (vl-catch-all-error-p r4)))
)

(defun mh:is-xref-insert (ins-ent / bname bdef)
  (setq bname (mh:get-block-name ins-ent))
  (if (null bname)
    nil
    (progn
      (setq bdef (vl-catch-all-apply 'vla-item (list (vla-get-Blocks (mh:get-doc)) bname)))
      (if (vl-catch-all-error-p bdef)
        nil
        (and (vlax-property-available-p bdef 'IsXRef)
             (= :vlax-true (vla-get-IsXRef bdef)))
      )
    )
  )
)

(defun mh:apply-to-loose-hatch (hatch-ent payload / pat-type pat-name scl ang org)
  (if (mh:is-insu-hatch hatch-ent)
    (progn
      (setq pat-type (cdr (assoc 'pattern-type payload))
            pat-name (cdr (assoc 'pattern-name payload))
            scl (cdr (assoc 'world-scale payload))
            ang (cdr (assoc 'world-angle payload))
            org (cdr (assoc 'world-origin payload)))
      (mh:set-hatch-props hatch-ent pat-type pat-name scl ang org)
    )
    nil
  )
)

(defun mh:apply-to-insert (ins-ent payload / bname tr ins rot sx sy pat-type pat-name world-scl ang org local-org local-scl local-ang hlist changed)
  (if (mh:is-xref-insert ins-ent)
    nil
    (progn
      (setq bname (mh:get-block-name ins-ent))
      (if (null bname)
        nil
        (progn
          (setq tr (mh:get-insert-transform ins-ent)
                ins (car tr)
                rot (cadr tr)
                sx (caddr tr)
                sy (cadddr tr)
                pat-type (cdr (assoc 'pattern-type payload))
                pat-name (cdr (assoc 'pattern-name payload))
                world-scl (cdr (assoc 'world-scale payload))
                ang (cdr (assoc 'world-angle payload))
                org (cdr (assoc 'world-origin payload))
                local-org (if tr (mh:local-from-world org ins rot sx sy) nil)
                local-scl (if (and tr (not (equal sx 0.0 1e-12))) (/ world-scl (abs sx)) nil)
                local-ang (if tr (mh:angle-world-to-local ang rot sx sy) nil)
                hlist (mh:block-hatches bname)
                changed 0)

          (if (and local-org local-scl local-ang hlist)
            (progn
              (foreach h hlist
                (if (mh:set-hatch-props h pat-type pat-name local-scl local-ang local-org)
                  (setq changed (1+ changed))
                )
              )
              (> changed 0)
            )
            nil
          )
        )
      )
    )
  )
)

(defun c:MH (/ *error* adoc src src-ent payload ss i ent ed typ ok ok-count skip-count err-count)

  (defun *error* (msg)
    (if adoc (vla-EndUndoMark adoc))
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\n[Error] MH failed: " msg))
    )
    (princ)
  )

  (vl-load-com)
  (setq adoc (mh:get-doc))
  (vla-StartUndoMark adoc)

  (princ "\n[MH Rewrite] Match INSULATION hatch pattern/scale/angle/world-origin")
  (setq src (entsel "\nSelect SOURCE insulation hatch or block: "))

  (if (null src)
    (progn
      (princ "\n[Cancel] No source selected.")
      (vla-EndUndoMark adoc)
      (princ)
      (exit)
    )
  )

  (setq src-ent (car src)
        payload (mh:source-world-props src-ent))

  (if (null payload)
    (progn
      (princ "\n[Cancel] Source does not contain insulation hatch on Hvacduct-Insul.")
      (vla-EndUndoMark adoc)
      (princ)
      (exit)
    )
  )

  (princ "\nSelect TARGET hatches and/or blocks (only Hvacduct-Insul hatches will be changed): ")
  (setq ss (ssget '((0 . "HATCH,INSERT"))))

  (if (null ss)
    (progn
      (princ "\n[Cancel] No targets selected.")
      (vla-EndUndoMark adoc)
      (princ)
      (exit)
    )
  )

  (setq i 0
        ok-count 0
        skip-count 0
        err-count 0)

  (repeat (sslength ss)
    (setq ent (ssname ss i)
          ed (entget ent)
          typ (if ed (cdr (assoc 0 ed)) nil)
          ok nil)

    (cond
      ((null ed)
        (setq skip-count (1+ skip-count))
      )
      ((and (= typ "HATCH") (eq ent (cdr (assoc 'source-hatch payload))))
        (setq skip-count (1+ skip-count))
      )
      ((= typ "HATCH")
        (if (mh:is-insu-hatch ent)
          (setq ok (mh:apply-to-loose-hatch ent payload))
          (setq skip-count (1+ skip-count))
        )
      )
      ((= typ "INSERT")
        (setq ok (mh:apply-to-insert ent payload))
      )
      (T
        (setq skip-count (1+ skip-count))
      )
    )

    (cond
      (ok (setq ok-count (1+ ok-count)))
      ((or (= typ "HATCH") (= typ "INSERT")) (setq err-count (1+ err-count)))
    )

    (setq i (1+ i))
  )

  (vla-Regen adoc acAllViewports)
  (vla-EndUndoMark adoc)

  (princ
    (strcat
      "\n[MH Rewrite] Done. Success=" (itoa ok-count)
      ", Skipped=" (itoa skip-count)
      ", Failed=" (itoa err-count)
    )
  )
  (princ)
)

(defun c:MHRESET nil (c:MH))

(princ "\n[TBH] Match Hatch Rewrite loaded. Type 'MH' to start.")
(princ)
