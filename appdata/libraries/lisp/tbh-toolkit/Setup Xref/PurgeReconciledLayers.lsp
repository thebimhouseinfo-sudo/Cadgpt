;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : PurgeReconciledLayers.lsp
;;; Module      : Setup Xref
;;; Command     : PURGERECONCILEDLAYERS
;;; Description : Clears out reconciled layer states from xrefs automatically.
;;;
;;; Usage       :
;;; 1. Run command.
;;; 2. Automatically accepts and purges reconciled/unreconciled layer states globally.
;;; TBH-HEADER-END
;;; =============================================================================

(defun c:PURGERECONCILEDLAYERS ()
  (vl-load-com)
  (princ "\nPurging reconciled layer information and resetting notifications...")
  (vlax-for layer (vla-get-Layers (vla-get-ActiveDocument (vlax-get-acad-object)))
    (vl-Catch-All-Apply
      '(lambda ()
         (vla-Remove (vla-GetExtensionDictionary layer) "ADSK_XREC_LAYER_RECONCILED")))
    (vl-Catch-All-Apply
      '(lambda ()
         (vla-delete (vla-GetExtensionDictionary layer)))))
  (setvar "LAYEREVAL" 0)
  (setvar "LAYERNOTIFY" 0)
  (princ "\n[Done] Reconciled layer data purged. Notifications suppressed.")
  (princ)
)

(c:PURGERECONCILEDLAYERS)

(princ "\n[TBH] Purge Reconciled Layers Tool loaded.")
(princ)
