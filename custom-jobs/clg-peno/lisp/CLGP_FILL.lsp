;;; CADGPT-HEADER-START
;;; File         : CLGP_FILL.lsp
;;; Module       : CLG Peno Targeted Geometry Fill
;;; Command      : CLGP_FILL
;;; Description  : Auto-measure only grille handles from Job-generated queue.
;;; Inputs       : Job-produced runtime/metadata-missing-handles.txt,
;;;                all handles extracted from Grille Tag JSON.
;;; Effects      : runtime/metadata-fill.txt only, temporary CAD copies deleted.
;;; Interaction  : Noninteractive; automatically executes when loaded.
;;; Risk         : Medium; original block references remain unchanged.
;;; Dependencies : CLGP_COLLECT.lsp loaded first for clgp:measure/record.
;;; Notes        : Only reads exact queued grille handles; never scans full DWG.
;;; Revision     : draft 2026-10-11
;;; CADGPT-HEADER-END
(vl-load-com)
(setq *CLGP:FillRoot*
  (if (and (boundp '*cadgpt-load-dir*)
           (= (type *cadgpt-load-dir*) 'STR))
    (vl-filename-directory *cadgpt-load-dir*) nil))

(defun clgp:fill-valid-handle (s)
  (and (= (type s) 'STR)
       (> (strlen s) 0)
       (not (wcmatch (strcase s) "*[~0-9A-F]*"))))

(defun clgp:fill-all-valid (hs / en ed obj ok)
  (setq ok T)
  (foreach handle hs
    (setq en (handent handle))
    (cond
      ((not en) (setq ok nil))
      (T
        (setq ed (entget en))
        (if (or (not ed)
                (/= (cdr (assoc 0 ed)) "INSERT")
                (not (wcmatch (strcase (cdr (assoc 8 ed)))
                              "*GRILLE*"))
                (/= (cdr (assoc 410 ed)) "Model"))
          (setq ok nil)
          (progn
            (setq obj (vlax-ename->vla-object en))
            (if (vlax-erased-p obj)
              (setq ok nil)))))))
  ok)

(defun c:CLGP_FILL (/ base path dest f heading line selected seen
                       doc dwg valid out item ent obj info ok bad
                       previous)
  (vl-load-com)
  (cond
    ((null *CLGP:FillRoot*)
     (princ "\n[CLGP] BLOCKED: no Job-owned Lisp load root."))
    ((not (and (boundp '*CLGP:CollectorReady*)
                *CLGP:CollectorReady*))
     (princ "\n[CLGP] BLOCKED: load CLGP_COLLECT.lsp first."))
    (T
      (setq base (strcat *CLGP:FillRoot* "\\runtime")
            path (strcat base "\\metadata-missing-handles.txt")
            dest (strcat base "\\metadata-fill.txt")
            doc (vla-get-ActiveDocument (vlax-get-acad-object))
            dwg (vla-get-FullName doc)
            selected nil seen nil valid T)
      (cond
        ((not (vl-file-directory-p base))
         (princ "\n[CLGP] BLOCKED: runtime root not prepared."))
        ((not (setq f (open path "r")))
         (princ "\n[CLGP] BLOCKED: exact handle queue missing."))
        (T
          (setq heading (read-line f))
          (if (/= heading (strcat "#DRAWING|" dwg))
            (setq valid nil))
          (while (setq line (read-line f))
            (cond
              ((not (clgp:fill-valid-handle line))
               (setq valid nil))
              ((member (strcase line) seen)
               (setq valid nil))
              (T
                (setq selected (cons (strcase line) selected)
                      seen (cons (strcase line) seen)))))
          (close f)
          (setq selected (reverse selected))
          (cond
            ((not valid)
             (princ "\n[CLGP] BLOCKED: invalid or stale handle queue."))
            ((null selected)
             (princ "\n[CLGP] No handles selected for measurement."))
            ((not (clgp:fill-all-valid selected))
             (princ "\n[CLGP] BLOCKED: missing, erased or non-grille handle."))
            (T
              (setq out (open dest "w") ok 0 bad 0)
              (if (not out)
                (princ "\n[CLGP] BLOCKED: geometry-fill file not writable.")
                (progn
                  (foreach item selected
                    (setq ent (handent item)
                          obj (vlax-ename->vla-object ent))
                    (if (not (clgp:planar obj))
                      (progn
                        (setq bad (1+ bad))
                        (princ (strcat "\n[CLGP] Nonplanar grille: " item)))
                      (progn
                        (setq info (clgp:measure obj))
                        (if (car info)
                          (progn
                            (write-line
                              (clgp:record item (vla-get-Layer obj) dwg info)
                              out)
                            (setq ok (1+ ok)))
                          (progn
                            (setq bad (1+ bad))
                            (princ
                              (strcat "\n[CLGP] " item " / " (cadr info))))))))
                  (close out)
                  (princ (strcat
                    "\n[CLGP] Targeted fill: valid=" (itoa ok)
                    " / expected=" (itoa (length selected))
                    ", rejected=" (itoa bad)
                    ". Stage 2 must verify exact handles and counts."))))))))))
  (princ))

(princ "\n[CLGP] Targeted geometry collector loaded. Auto-run starting.")
(setq *CLGP:FillLoadResult*
  (vl-catch-all-apply 'c:CLGP_FILL nil))
(if (vl-catch-all-error-p *CLGP:FillLoadResult*)
  (princ (strcat "\n[CLGP] AUTO_RUN_ERROR: "
                 (vl-catch-all-error-message *CLGP:FillLoadResult*))))
(princ)
