;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : PurgeReconciledLayers.lsp
;;; Module       : Setup Xref
;;; Command      : PURGERECONCILEDLAYERS
;;; Description  : Removes reconciled-layer metadata from layer extension dictionaries, then disables layer evaluation/notification; the command also runs automatically when the file is loaded.
;;; Inputs       : None.
;;; Effects      : Attempts to remove ADSK_XREC_LAYER_RECONCILED, deletes each layer extension dictionary, sets LAYEREVAL=0 and LAYERNOTIFY=0.
;;; Interaction  : Non-interactive; executes automatically on file load.
;;; Risk         : High; load-time mutation and extension-dictionary deletion may affect metadata unrelated to layer reconciliation.
;;; Dependencies : Visual LISP COM (`vl-load-com`).
;;; Notes        : Static review found that the whole layer extension dictionary is deleted after reconciliation-record removal; function logic is intentionally not repaired in this phase.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
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
