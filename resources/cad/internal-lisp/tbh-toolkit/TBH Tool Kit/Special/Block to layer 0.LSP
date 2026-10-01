;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Block to layer 0.LSP
;;; Module      : Special
;;; Command     : B2LAY0
;;; Description : Forces all entities inside a block definition onto Layer 0 and ByBlock setting.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select block definition.
;;; 3. Force-changes all internal structural lines and fills to Layer 0 with ByBlock colors.
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:B2LAY0 (/ *error* adoc lst_layer func_restore-layers fun_get-block-subref-by-block selset)

  (defun *error* (msg)
    (if func_restore-layers (func_restore-layers))
    (if adoc (vla-endundomark adoc))
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\n[Error] " msg))
    )
    (princ)
  )

  (defun fun_get-block-subref-by-block (blk-name / res)
    (setq res (list blk-name))
    (vlax-for subent (vla-item (vla-get-blocks adoc) blk-name)
      (if (wcmatch (strcase (vla-get-objectname subent)) "*BLOCK*")
        (setq res (append res (fun_get-block-subref-by-block (vla-get-name subent))))
      )
    )
    res
  )

  (defun func_restore-layers ()
    (foreach item lst_layer
      (vla-put-lock (car item) (cdr (assoc "lock" (cdr item))))
      (vl-catch-all-apply '(lambda () (vla-put-freeze (car item) (cdr (assoc "freeze" (cdr item))))))
    )
  )

  (vl-load-com)
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (vla-startundomark adoc)

  (princ "\nSelect Blocks to move internal entities to Layer 0: ")
  (if (setq selset (ssget '((0 . "INSERT"))))
    (progn
      (princ "\nProcessing... Please wait.")
      ;; 1. Store and Unlock Layers
      (vlax-for item (vla-get-layers adoc)
        (setq lst_layer (cons (list item (cons "lock" (vla-get-lock item)) (cons "freeze" (vla-get-freeze item))) lst_layer))
        (vla-put-lock item :vlax-false)
        (vl-catch-all-apply '(lambda () (vla-put-freeze item :vlax-false)))
      )

      ;; 2. Process Blocks
      (foreach blk_def
               (mapcar '(lambda (x) (vla-item (vla-get-blocks adoc) x))
                 ((lambda (/ res)
                    (foreach item
                             (apply 'append
                                    (mapcar
                                      '(lambda (x)
                                         (fun_get-block-subref-by-block (vla-get-name (vlax-ename->vla-object x))))
                                      ((lambda (/ tab item)
                                         (repeat (setq tab nil item (sslength selset))
                                           (setq tab (cons (ssname selset (setq item (1- item))) tab)))
                                         tab))
                                    )
                             )
                      (if (not (member item res)) (setq res (cons item res)))
                    )
                    (reverse res))
                 )
               )
        (vlax-for ent blk_def
          (vla-put-layer ent "0")
          (vla-put-color ent 256) ; ByLayer
        )
      )

      (func_restore-layers)
      (vla-regen adoc acallviewports)
      (princ (strcat "\n[Done] All entities within " (itoa (sslength selset)) " Blocks moved to Layer 0."))
    )
    (princ "\n[Cancel] No Blocks selected.")
  )

  (vla-endundomark adoc)
  (princ)
)

(princ "\n[TBH] Block to Layer 0 Tool loaded. Type 'B2LAY0' to start.")
(princ)