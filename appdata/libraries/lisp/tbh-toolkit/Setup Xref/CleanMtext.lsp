;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : CleanMtext.lsp
;;; Module       : Setup Xref
;;; Command      : CMTEXT
;;; Description  : Removes embedded MText formatting control sequences from selected MTEXT objects and rewrites the DXF text as simplified plain content.
;;; Inputs       : User selection of MTEXT entities.
;;; Effects      : Rewrites MTEXT group 1/3 text content after parser-based formatting removal.
;;; Interaction  : Interactive.
;;; Risk         : Medium; complex formatted text content can be altered as well as formatting.
;;; Dependencies : Visual LISP helpers and AutoLISP DXF APIs (`vl-load-com`).
;;; Notes        : Static review found parser risks for stacked/escaped MText and repeated braces; function logic is intentionally not repaired in this phase.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(defun CleanMtextFull (str / i out skip c next)
  (setq i 1
        out ""
        skip nil)

  (while (<= i (strlen str))
    (setq c (substr str i 1))
    (setq next (if (< i (strlen str)) (substr str (+ i 1) 1) ""))

    (cond
      ((and (= c "\\") (= next "P"))
       (setq out (strcat out " "))
       (setq i (+ i 2)))
      ((and (= c "\\") (= next "~"))
       (setq out (strcat out " "))
       (setq i (+ i 2)))
      ((and (= c "\\") (= next "S"))
       (setq skip T)
       (setq i (+ i 2)))
      ((and (= c "\\") (not skip))
       (setq skip T)
       (setq i (1+ i)))
      ((and skip (= c ";"))
       (setq skip nil)
       (setq i (1+ i)))
      ((not skip)
       (setq out (strcat out c))
       (setq i (1+ i)))
      (T
       (setq i (1+ i)))
    )
  )

  (setq out (vl-string-subst "" "{" out))
  (setq out (vl-string-subst "" "}" out))
  (while (vl-string-search "  " out)
    (setq out (vl-string-subst " " "  " out)))
  out
)

(defun c:CMText ( / ss i ent ed raw newtxt)
  (vl-load-com)
  (princ "\nSelect MText to strip formatting: ")
  (setq ss (ssget '((0 . "MTEXT"))))

  (if ss
    (progn
      (setq i 0)
      (while (< i (sslength ss))
        (setq ent (ssname ss i))
        (setq ed (entget ent))
        (setq raw
          (apply 'strcat
            (mapcar 'cdr
              (vl-remove-if-not
                '(lambda (x) (member (car x) '(1 3)))
                ed))))
        (setq newtxt (CleanMtextFull raw))
        (setq ed (subst (cons 1 newtxt) (assoc 1 ed) ed))
        (setq ed (vl-remove-if '(lambda (x) (= (car x) 3)) ed))
        (entmod ed)
        (entupd ent)
        (setq i (1+ i)))
      (princ (strcat "\n[Done] Stripped formatting from " (itoa (sslength ss)) " MText objects.")))
    (princ "\n[Error] No MText objects selected."))
  (princ)
)

(princ "\n[TBH] MText Cleanup Tool loaded. Type 'CMTEXT' to start.")
(princ)
