;;; =============================================================================
;;; CADGPT-HEADER-START
;;; File         : CLGP_DRAW.lsp
;;; Module       : CLG Peno Job - Draw Penetrations
;;; Command      : CLGP_DRAW
;;; Description  : Draw ceiling penetrations from this Job's verified plan.
;;; Inputs       : Verified pipe-delimited peno-plan.txt within Job runtime.
;;; Effects      : New uniquely named CLG PENO blocks and project layers.
;;; Interaction  : Non-interactive, execution gated by the Job.
;;; Risk         : Medium; verify CAD postconditions before final report.
;;; Dependencies : AutoCAD Visual LISP COM; CadGPT verified drawing binding.
;;; Notes        : Penetration.lsp is appearance reference only, never invoked.
;;; Revision     : draft 2026-10-11
;;; CADGPT-HEADER-END
;;; =============================================================================
(vl-load-com)
(setq *CLGP:DrawRoot*
  (if (and (boundp '*cadgpt-load-dir*)
           (= (type *cadgpt-load-dir*) 'STR))
    (vl-filename-directory *cadgpt-load-dir*)
    nil))
(defun clgp:tokens (s delim / pos start out)
  (setq out nil start 0)
  (while (setq pos (vl-string-search delim s start))
    (setq out (cons (substr s (1+ start) (- pos start)) out)
          start (+ pos (strlen delim))))
  (reverse (cons (substr s (1+ start)) out)))
(defun clgp:valid-hex (h)
  (and (= (type h) 'STR) (> (strlen h) 0)
       (not (wcmatch (strcase h) "*[~0-9A-F]*"))))
(defun clgp:valid-num (s / v)
  (setq v (if (= (type s) 'STR) (distof s 2) nil))
  (if (numberp v) v nil))
(defun clgp:layer-ensure (doc name / layers existing)
  (setq layers (vla-get-Layers doc)
        existing (vl-catch-all-apply 'vla-Item (list layers name)))
  (if (vl-catch-all-error-p existing)
    (vl-catch-all-apply 'vla-Add (list layers name))
    existing))
(defun clgp:array2 (data / arr i)
  (setq arr (vlax-make-safearray vlax-vbDouble '(0 . 7))
        i 0)
  (foreach n data
    (vlax-safearray-put-element arr i n)
    (setq i (1+ i)))
  arr)
(defun clgp:record-valid (r / handle src cx cy cz w h ang)
  (if (/= (length r) 7) nil
    (progn
      (setq handle (nth 0 r)
            cx (clgp:valid-num (nth 1 r))
            cy (clgp:valid-num (nth 2 r))
            cz (clgp:valid-num (nth 3 r))
            w (clgp:valid-num (nth 4 r))
            h (clgp:valid-num (nth 5 r))
            ang (clgp:valid-num (nth 6 r)))
      (and (clgp:valid-hex handle)
           cx cy cz w h ang
           (> w 0.000001) (> h 0.000001)
           (< w 1000000000.0) (< h 1000000000.0)))))
(defun clgp:add-hatch (block boundary / ht sa ret)
  (setq ht (vl-catch-all-apply 'vla-AddHatch
               (list block 0 "SOLID" :vlax-true)))
  (if (vl-catch-all-error-p ht)
    nil
    (progn
      (setq sa (vlax-make-safearray vlax-vbObject '(0 . 0)))
      (vlax-safearray-put-element sa 0 boundary)
      (setq ret (vl-catch-all-apply 'vla-AppendOuterLoop (list ht sa)))
      (if (vl-catch-all-error-p ret)
        nil
        (progn
          (setq ret (vl-catch-all-apply 'vla-Evaluate (list ht)))
          (if (vl-catch-all-error-p ret) nil
            (progn
              (vla-put-Layer ht "BW-PenoShade")
              (vla-put-Linetype ht "ByLayer")
              ht)))))))
(defun clgp:coord3 (p)
  (cond
    ((= (type p) 'VARIANT) (clgp:coord3 (vlax-variant-value p)))
    ((= (type p) 'SAFEARRAY) (vlax-safearray->list p))
    ((listp p) p)
    (T nil)))
(defun clgp:text-center-verified (obj / pt)
  (setq pt (clgp:coord3 (vla-get-InsertionPoint obj)))
  (and (= (vla-get-AttachmentPoint obj) 5)
       pt (equal pt '(0.0 0.0 0.0) 0.000001)))
(defun clgp:anchor-text-at-boundary-center (obj / res)
  ;; AttachmentPoint rejustifies in place, it DOES NOT preserve the anchor.
  ;; Must put InsertionPoint back to local block origin AFTER changing attach.
  (setq res (vl-catch-all-apply 'vla-put-AttachmentPoint (list obj 5)))
  (if (not (vl-catch-all-error-p res))
    (setq res (vl-catch-all-apply 'vla-put-InsertionPoint
                                 (list obj (vlax-3d-point '(0.0 0.0 0.0))))))
  (if (vl-catch-all-error-p res) nil
    (progn
      (setq res (vl-catch-all-apply 'vla-Update (list obj)))
      (and (not (vl-catch-all-error-p res))
           (clgp:text-center-verified obj)))))
(defun clgp:unique-name (grille / stamp name suffix)
  ;; Time-derived pseudo-random component, collision-resistant by retry.
  (setq stamp (itoa (getvar "MILLISECS"))
        suffix 0
        name (strcat "CLGP-" (strcase grille) "-" stamp))
  (while (tblsearch "BLOCK" name)
    (setq suffix (1+ suffix)
          name (strcat "CLGP-" (strcase grille) "-"
                       stamp "-" (itoa suffix))))
  name)
(defun clgp:create-one (doc r / sh cx cy cz width height angle def name
                         poly tx ht obj)
  (setq sh (car r)
        cx (clgp:valid-num (nth 1 r))
        cy (clgp:valid-num (nth 2 r))
        cz (clgp:valid-num (nth 3 r))
        width (clgp:valid-num (nth 4 r))
        height (clgp:valid-num (nth 5 r))
        angle (clgp:valid-num (nth 6 r))
        name (clgp:unique-name sh))
  (if (tblsearch "BLOCK" name)
    (list nil "BLOCK_DEFINITION_ALREADY_EXISTS_UNTRACKED")
    (progn
      (setq def (vl-catch-all-apply 'vla-Add
                  (list (vla-get-Blocks doc)
                        (vlax-3d-point '(0.0 0.0 0.0))
                        name)))
      (if (vl-catch-all-error-p def)
        (list nil "CREATE_DEFINITION_FAILED")
        (progn
          (setq poly
            (vl-catch-all-apply 'vla-AddLightWeightPolyline
              (list def (clgp:array2
                (list (- (/ width 2.0)) (- (/ height 2.0))
                      (/ width 2.0) (- (/ height 2.0))
                      (/ width 2.0) (/ height 2.0)
                      (- (/ width 2.0)) (/ height 2.0))))))
          (if (vl-catch-all-error-p poly)
            (list nil "RECTANGLE_CREATE_FAILED")
            (progn
              (vla-put-Closed poly :vlax-true)
              (vla-put-Layer poly "BW-Peno")
              (vla-put-Linetype poly "ByLayer")
              (setq ht (clgp:add-hatch def poly))
              (if (not ht)
                (list nil "SOLID_HATCH_FAILED")
                (progn
                  (setq tx (vl-catch-all-apply 'vla-AddMText
                      (list def (vlax-3d-point '(0.0 0.0 0.0))
                            (max 1.0 width)
                            "{\\fArial Narrow|b0|i0|c0|p34;\\W0.8;CLG\\PPENO}")))
                  (if (vl-catch-all-error-p tx)
                    (list nil "MTEXT_CREATE_FAILED")
                    (progn
                      (vla-put-Layer tx "BW-text")
                      (vla-put-Linetype tx "ByLayer")
                      (vla-put-Height tx 100.0)
                      ;; Center attachment is set first, then insertion MUST
                      ;; be reset to the block origin (boundary center).
                      (setq obj
                        (if (clgp:anchor-text-at-boundary-center tx)
                          (vl-catch-all-apply 'vla-InsertBlock
                            (list (vla-get-ModelSpace doc)
                                  (vlax-3d-point (list cx cy cz))
                                  name 1.0 1.0 1.0 angle))
                          nil))
                      (if (or (null obj) (vl-catch-all-error-p obj))
                        (list nil "MTEXT_CENTER_OR_INSERT_FAILED")
                        (progn
                          (vla-put-Layer obj "BW-Peno")
                          (vla-put-Linetype obj "ByLayer")
                          (list T name))))))))))))))
(defun c:CLGP_DRAW (/ root path file line rows header doc src
                      row seen allow created failed result err)
  (vl-load-com)
  (setq root *CLGP:DrawRoot*)
  (cond
    ((not root) (princ "\n[CLGP] BLOCKED: Job-owned root unavailable."))
    ((not (vl-file-directory-p (strcat root "\\runtime")))
     (princ "\n[CLGP] BLOCKED: Job runtime not prepared."))
    (T
      (setq path (strcat root "\\runtime\\peno-plan.txt")
            file (open path "r")
            doc (vla-get-ActiveDocument (vlax-get-acad-object))
            src (vla-get-FullName doc)
            rows nil seen nil allow T)
      (if (not file)
        (princ "\n[CLGP] BLOCKED: Stage 2 plan unavailable.")
        (progn
          (setq header (read-line file))
          (if (/= header (strcat "#DRAWING|" src))
            (setq allow nil))
          (while (setq line (read-line file))
            (setq row (clgp:tokens line "|"))
            (if (or (not (clgp:record-valid row))
                    (member (car row) seen)
                    (not (handent (car row)))
                    (/= (cdr (assoc 0 (entget (handent (car row))))) "INSERT"))
              (setq allow nil)
              (progn
                (setq seen (cons (car row) seen)
                      rows (cons row rows)))))
          (close file)
          (setq rows (reverse rows))
          (if (or (not allow) (null rows))
            (princ "\n[CLGP] BLOCKED: invalid, duplicate or stale source in plan.")
            (progn
              (clgp:layer-ensure doc "BW-Peno")
              (clgp:layer-ensure doc "BW-PenoShade")
              (clgp:layer-ensure doc "BW-text")
              (setq created 0 failed 0)
              (foreach row rows
                (setq result
                  (vl-catch-all-apply 'clgp:create-one (list doc row)))
                (if (or (vl-catch-all-error-p result) (not (car result)))
                  (progn
                    (setq failed (1+ failed))
                    (princ (strcat "\n[CLGP] Failed: " (car row)
                                   " / "
                                   (if (vl-catch-all-error-p result)
                                     (vl-catch-all-error-message result)
                                     (cadr result)))))
                  (setq created (1+ created))))
              (setq err (vl-catch-all-apply 'vla-Regen (list doc 1)))
              (princ (strcat "\n[CLGP] New=" (itoa created)
                             ", failed=" (itoa failed) ".")))))))
  (princ)))
(princ "\n[CLGP] CLGP_DRAW loaded. Auto-running verified Job plan...")
(setq *CLGP:LastAutoRun* (vl-catch-all-apply 'c:CLGP_DRAW nil))
(if (vl-catch-all-error-p *CLGP:LastAutoRun*)
  (princ (strcat "\n[CLGP] AUTO_RUN_FAILED: "
                 (vl-catch-all-error-message *CLGP:LastAutoRun*)))
  (princ "\n[CLGP] Auto-run returned. Check counts and CAD readback."))
(princ)
