;;; =============================================================================
;;; CADGPT-HEADER-START
;;; File         : CLGP_COLLECT.lsp
;;; Module       : CLG Peno Job - Geometry Collection
;;; Command      : CLGP_COLLECT
;;; Description  : User-selected grille block geometry export by source handle.
;;; Inputs       : Explicit user-selected INSERTs in bound drawing.
;;; Effects      : Writes job-owned runtime/grilles-raw.txt; temporary copy/delete.
;;; Interaction  : Interactive region or direct block selection.
;;; Risk         : Medium; clone must always be erased after measurement.
;;; Dependencies : Visual LISP COM and CadGPT loaded-path handoff.
;;; Notes        : No grille name, FACE SIZE or NECK SIZE assumptions.
;;; Revision     : draft 2026-10-11
;;; CADGPT-HEADER-END
;;; =============================================================================
(vl-load-com)
(setq *CLGP:Root*
  (if (and (boundp '*cadgpt-load-dir*)
           (= (type *cadgpt-load-dir*) 'STR))
    (vl-filename-directory *cadgpt-load-dir*)
    nil))
(defun clgp:point (v)
  (cond
    ((= (type v) 'VARIANT) (clgp:point (vlax-variant-value v)))
    ((= (type v) 'SAFEARRAY) (vlax-safearray->list v))
    ((listp v) v)
    (T nil)))
(defun clgp:num (v) (rtos v 2 10))
(defun clgp:jstr (s / i a ch)
  (setq i 1 a "\"")
  (if (not (= (type s) 'STR)) (setq s ""))
  (while (<= i (strlen s))
    (setq ch (substr s i 1))
    (cond
      ((= ch "\\") (setq a (strcat a "\\\\")))
      ((= ch "\"") (setq a (strcat a "\\\"")))
      ((= (ascii ch) 10) (setq a (strcat a "\\n")))
      (T (setq a (strcat a ch))))
    (setq i (1+ i)))
  (strcat a "\""))
(defun clgp:rotate-xy (p base ang / dx dy cs sn)
  (setq dx (- (car p) (car base))
        dy (- (cadr p) (cadr base))
        cs (cos ang) sn (sin ang))
  (list (+ (car base) (- (* dx cs) (* dy sn)))
        (+ (cadr base) (+ (* dx sn) (* dy cs)))
        (caddr p)))
(defun clgp:planar (obj / raw normal)
  (setq raw (vl-catch-all-apply 'vla-get-Normal (list obj)))
  (if (vl-catch-all-error-p raw) nil
    (progn
      (setq normal (clgp:point raw))
      (and normal
           (equal normal '(0.0 0.0 1.0) 0.000001)))))
(defun clgp:measure (obj / insertion angle duplicate bmin bmax err
                         mn mx center0 center1 sx sy duph cleanup)
  (setq insertion (clgp:point (vla-get-InsertionPoint obj))
        angle (vla-get-Rotation obj)
        duplicate (vl-catch-all-apply 'vla-Copy (list obj)))
  (if (or (vl-catch-all-error-p duplicate) (not duplicate))
    (list nil "COPY_FAILED")
    (progn
      (setq duph (vl-catch-all-apply 'vla-get-Handle (list duplicate)))
      (setq err (vl-catch-all-apply 'vla-Rotate
                  (list duplicate (vlax-3d-point insertion) (- angle))))
      (if (not (vl-catch-all-error-p err))
        (setq err
          (vl-catch-all-apply 'vla-GetBoundingBox
            (list duplicate 'bmin 'bmax))))
      (if (not (vl-catch-all-error-p err))
        (progn
          (setq mn (clgp:point bmin) mx (clgp:point bmax))
          (if (and mn mx)
            (setq sx (- (car mx) (car mn))
                  sy (- (cadr mx) (cadr mn))
                  center0 (list (/ (+ (car mn) (car mx)) 2.0)
                                (/ (+ (cadr mn) (cadr mx)) 2.0)
                                (/ (+ (caddr mn) (caddr mx)) 2.0))
                  center1 (clgp:rotate-xy center0 insertion angle))
            (setq err "INVALID_BBOX"))))
      ;; Delete the temporary clone even after a geometry-read failure.
      ;; HANDENT CANNOT validate deletion: erased objects retain their handles
      ;; during the same editing session. AutoCAD's vlax-erased-p is authoritative.
      (setq cleanup (vl-catch-all-apply 'vla-Delete (list duplicate)))
      (if (not (vl-catch-all-error-p cleanup))
        (setq cleanup (vl-catch-all-apply 'vlax-erased-p (list duplicate))))
      (cond
        ((vl-catch-all-error-p cleanup) (list nil "TEMP_COPY_DELETE_VERIFY_FAILED"))
        ((not cleanup) (list nil "TEMP_COPY_STILL_PRESENT"))
        ((vl-catch-all-error-p err) (list nil "TEMP_COPY_GEOMETRY_FAILED"))
        ((= (type err) 'STR) (list nil err))
        ((or (null sx) (null sy) (<= sx 0.00000001) (<= sy 0.00000001))
         (list nil "INVALID_GEOMETRY"))
        (T (list T center1 sx sy angle))))))
(defun clgp:record (h layer drawing info / c)
  (setq c (cadr info))
  (strcat "{\"handle\":" (clgp:jstr h)
          ",\"source_dwg\":" (clgp:jstr drawing)
          ",\"layer\":" (clgp:jstr layer)
          ",\"center\":[" (clgp:num (car c)) ","
                         (clgp:num (cadr c)) ","
                         (clgp:num (caddr c)) "]"
          ",\"width\":" (clgp:num (nth 2 info))
          ",\"height\":" (clgp:num (nth 3 info))
          ",\"rotation_rad\":" (clgp:num (nth 4 info))
          "}"))
(defun c:CLGP_COLLECT (/ sel path f doc name i en obj handle seen
                        info ok bad skipped added)
  (vl-load-com)
  (cond
    ((not *CLGP:Root*)
     (princ "\n[CLGP] BLOCKED: loader did not supply owning Job root."))
    ((not (vl-file-directory-p (strcat *CLGP:Root* "\\runtime")))
     (princ "\n[CLGP] BLOCKED: Job runtime not prepared."))
    (T
      (setq doc (vla-get-ActiveDocument (vlax-get-acad-object))
            name (vla-get-FullName doc)
            path (strcat *CLGP:Root* "\\runtime\\grilles-raw.txt"))
      (princ "\n[CLGP] Select ONLY grille blocks with Window/Crossing or manual selection.")
      (setq sel (ssget '((0 . "INSERT")))
            ok 0 bad 0 skipped 0 seen nil)
      (if sel
        (progn
          (setq f (open path "w"))
          (if (not f)
            (princ "\n[CLGP] BLOCKED: cannot overwrite collector raw file.")
            (progn
              (setq i 0)
              (repeat (sslength sel)
                (setq en (ssname sel i)
                      obj (vlax-ename->vla-object en)
                      handle (cdr (assoc 5 (entget en))))
                (cond
                  ((member handle seen) (setq skipped (1+ skipped)))
                  ((not (wcmatch (strcase (vla-get-Layer obj)) "*GRILLE*"))
                   (setq skipped (1+ skipped)))
                  ((not (clgp:planar obj))
                   (setq bad (1+ bad))
                   (princ (strcat "\n[CLGP] Non-planar grille: " handle)))
                  (T
                    (setq seen (cons handle seen)
                          info (clgp:measure obj))
                    (if (car info)
                      (progn
                        (write-line
                          (clgp:record handle (vla-get-Layer obj) name info) f)
                        (setq ok (1+ ok)))
                      (progn
                        (setq bad (1+ bad))
                        (princ (strcat "\n[CLGP] " handle " / " (cadr info)))))))
                (setq i (1+ i)))
              (close f)
              (princ (strcat "\n[CLGP] Collected=" (itoa ok)
                             ", rejected=" (itoa bad)
                             ", repeats=" (itoa skipped)
                             ". Raw: " path))))))))
  (princ))
(setq *CLGP:CollectorReady* T)
(princ "\n[CLGP] Collector loaded: CLGP_COLLECT.")
(princ)
