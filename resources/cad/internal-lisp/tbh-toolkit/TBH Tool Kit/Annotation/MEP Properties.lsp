;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : MEP Properties.lsp
;;; Module      : Annotation
;;; Command     : MEP_Properties_Create, FDT, GT, GRILLE_UPDATE, GRILLE_ATTR_UPGRADE
;;; Description : Real-time properties automation, XData synchronization, and flexible duct/cushion sizing.
;;;
;;;
;;; Usage       :
;;; 1. Insert an MEP Grille block.
;;; 2. Input 'AIR_FLOW' via Properties.
;;; 3. The reactor automatically calculates 'FLEX_DUCT_SIZE' and 'CUSHION_HEAD'.
;;; 4. Use 'GT' to link a tag dynamically.
;;; 5. Use 'FDT' to view or edit flexible duct table.
;;; TBH-HEADER-END
;;; =============================================================================
(vl-load-com)

;;; ===========================================================================
;;; 1. DATA MANAGEMENT
;;; ===========================================================================
(defun load_fdt_data_mep (/ default_data dict)
  (setq default_data
    '(("0 - 50" "150") ("51 - 90" "200") ("91 - 150" "250")
      ("151 - 200" "300") ("201 - 290" "350") ("291 - 375" "400")
      ("376 - 480" "450") ("481 - 550" "500"))
  )
  (setq dict (vlax-ldata-get "TBH_PROJECT" "FDT_CONFIG" nil))
  (if dict dict default_data)
)

;;; ===========================================================================
;;; 2. ADD ATTRIBUTE DEFINITION (ACTIVE-X)
;;; ===========================================================================
(defun add_mep_attrib_vla (blkDef tag prompt / found newAtt)
  (setq found nil)
  (vlax-for obj blkDef
    (if (and (= (vla-get-objectname obj) "AcDbAttributeDefinition")
             (= (strcase (vla-get-tagstring obj)) (strcase tag)))
      (setq found t)
    )
  )
  (if (not found)
    (progn
      (setq newAtt (vla-AddAttribute blkDef 100.0 1 prompt (vlax-3d-point '(0 0 0)) tag ""))
      (vla-put-Invisible newAtt :vlax-true)
      T
    )
    nil
  )
)

(defun GT:GrilleAttributeTags ()
  ;; SIZE is the existing neck-size field; FACE_SIZE and MODEL stay separate.
  '("OBJECT_TYPE" "TAG_NUMBER" "AIR_FLOW" "SIZE" "FLEX_DUCT_SIZE"
    "CUSHION_HEAD" "SYSTEM" "GRILLE_TYPE" "FACE_SIZE" "MODEL")
)

(defun GT:SyncBlockAttributes (bName / prior result)
  (setq prior *MEP_REACTOR_LOCK*)
  (setq *MEP_REACTOR_LOCK* T)
  (setq result (vl-catch-all-apply 'vl-cmdf (list "_.ATTSYNC" "_N" bName)))
  (setq *MEP_REACTOR_LOCK* prior)
  (if (vl-catch-all-error-p result)
    (progn
      (princ (strcat "\n[GT] ATTSYNC failed: " bName " / "
                     (vl-catch-all-error-message result)))
      nil)
    T)
)

;;; ===========================================================================
;;; 3. COMMAND: MEP_Properties_Create
;;; ===========================================================================
;;; M0a: ATTSYNC may rebuild block attribute references. Never iterate
;;; a pre-ATTSYNC selection set after a definition edit. Capture stable
;;; INSERT handles before modifying a block definition and rebind by handle.
(defun GT:SelectionHandles (ss / i ent handles)
  (setq handles nil)
  (if ss
    (progn
      (setq i 0)
      (repeat (sslength ss)
        (setq ent (ssname ss i))
        (if (and (= (type ent) 'ENAME) (assoc 5 (entget ent)))
          (setq handles (cons (cdr (assoc 5 (entget ent))) handles)))
        (setq i (1+ i)))))
  (reverse handles))

(defun GT:ResolveInsertHandle (handle / ent ed)
  (if (= (type handle) 'STR)
    (progn
      (setq ent (handent handle))
      (if (and (= (type ent) 'ENAME)
               (setq ed (entget ent))
               (= (cdr (assoc 0 ed)) "INSERT"))
        ent
        nil))
    nil))

(defun c:MEP_Properties_Create (/ doc blks ss handles handle ent obj bName blkDef layer
                                  system tags attData changed uniqueBlocks old tStr i eff)
  (vl-load-com)
  (setq doc (vla-get-activedocument (vlax-get-acad-object))
        blks (vla-get-blocks doc)
        tags (GT:GrilleAttributeTags)
        ss (ssget "X" '((0 . "INSERT")
             (8 . "Hvac-EAGrille,Hvac-SAGrille,Hvac-RAGrille,Hvac-OAGrille,Hvac-TAGrille")))
        handles (GT:SelectionHandles ss))
  (if (not handles)
    (princ "\nNo blocks found on specified layers.")
    (progn
      (vla-startundomark doc)
      (setq uniqueBlocks nil)
      (foreach handle handles
        (setq ent (GT:ResolveInsertHandle handle))
        (if ent
          (progn
            (setq obj (vlax-ename->vla-object ent)
                  eff (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))
            (if (and (not (vl-catch-all-error-p eff))
                     (not (member eff uniqueBlocks)))
              (setq uniqueBlocks (cons eff uniqueBlocks))))))
      ;; One ATTSYNC per definition, never one per selected INSERT.
      (foreach bName uniqueBlocks
        (setq blkDef (vla-item blks bName)
              changed nil)
        (foreach tag tags
          (if (add_mep_attrib_vla blkDef tag (strcat "Enter " tag))
            (setq changed T)))
        (if changed (GT:SyncBlockAttributes bName)))
      ;; Resolve by stable handles only AFTER all ATTSYNC calls complete.
      (setq i 0)
      (foreach handle handles
        (setq ent (GT:ResolveInsertHandle handle))
        (if ent
          (progn
            (setq obj (vlax-ename->vla-object ent)
                  layer (vla-get-layer obj)
                  attData nil)
            (if (= (vla-get-HasAttributes obj) :vlax-true)
              (foreach att (vlax-invoke obj 'GetAttributes)
                (setq attData
                  (cons (cons (vla-get-TagString att) (vla-get-TextString att))
                        attData))))
            (setq system
              (cond
                ((= layer "Hvac-SAGrille") "Supply Air")
                ((= layer "Hvac-RAGrille") "Return Air")
                ((= layer "Hvac-EAGrille") "Exhaust Air")
                ((= layer "Hvac-OAGrille") "Outside Air")
                ((= layer "Hvac-TAGrille") "Transfer Air")
                (T "Unknown Air")))
            (if (= (vla-get-HasAttributes obj) :vlax-true)
              (foreach att (vlax-invoke obj 'GetAttributes)
                (setq tStr (vla-get-TagString att)
                      old (assoc tStr attData))
                (if (and old (/= (cdr old) ""))
                  (vla-put-TextString att (cdr old))
                  (if (= tStr "SYSTEM")
                    (vla-put-TextString att system)))
                (if (and (= tStr "OBJECT_TYPE")
                         (= (vla-get-TextString att) ""))
                  (vla-put-TextString att "Air Terminal"))))
            (setq i (1+ i)))))
      (princ (strcat "\nSuccess: Processed " (itoa i) " blocks."))
      (mep_start_reactor)
      (vla-endundomark doc)))
  (princ))

;;; ===========================================================================
;;; 4. AUTO-UPDATE LOGIC (REACTOR)
;;; ===========================================================================
(defun mep_start_reactor ()
  (if *MEP_ACDB_REACTOR*
    (vlr-remove *MEP_ACDB_REACTOR*)
  )
  (setq *MEP_ACDB_REACTOR* (vlr-acdb-reactor nil '((:vlr-objectModified . mep_auto_update_callback))))
)

(setq *MEP_REACTOR_LOCK* nil)

;; =========================================================================
;; AutoCAD AcDb events identify the modified entity, which can be an ATTRIB
;; rather than its owning grille INSERT. Only the notified grille should be
;; auto-calculated/synced; stale PICKFIRST would fire during unrelated tag
;; deletion and repeatedly contend with AutoCAD COM modification state.
;; =========================================================================
;; Database :vlr-objectModified supplies (database modified-ename).
;; Resolve only the notified entity. The former PICKFIRST fallback fired
;; while deleting an unrelated tag with a grille still selected, causing
;; recursive ATT updates and repeated CAD busy/retry failures.
(defun mep_event_entity (params)
  (if (and (listp params) (cdr params))
    (cadr params)
    nil))

(defun mep_flex_size_edit_p (params / ent ed)
  (setq ent (mep_event_entity params))
  (if (= (type ent) 'VLA-OBJECT)
    (setq ent (vl-catch-all-apply 'vlax-vla-object->ename (list ent))))
  (if (and (= (type ent) 'ENAME)
           (setq ed (entget ent))
           (= (cdr (assoc 0 ed)) "ATTRIB"))
    (= (strcase (if (assoc 2 ed) (cdr (assoc 2 ed)) ""))
       "FLEX_DUCT_SIZE")
    nil))

(defun mep_get_target_blockref (obj / ent ed ownerEnt ownerData blkref)
  (setq ent obj)
  (if (= (type ent) 'VLA-OBJECT)
    (setq ent (vl-catch-all-apply 'vlax-vla-object->ename (list ent))))
  (if (= (type ent) 'ENAME)
    (progn
      (setq ed (entget ent))
      (if (= (cdr (assoc 0 ed)) "ATTRIB")
        (progn
          ;; DXF 330 is normally an ENAME, not a hexadecimal handle.
          ;; Passing it directly to handent caused an ownership lookup error.
          (setq ownerEnt (cdr (assoc 330 ed)))
          (if (= (type ownerEnt) 'STR)
            (setq ownerEnt (handent ownerEnt)))
          (if (= (type ownerEnt) 'ENAME)
            (setq ent ownerEnt)
            (setq ent nil))))
      (if (and (= (type ent) 'ENAME)
               (setq ownerData (entget ent))
               (= (cdr (assoc 0 ownerData)) "INSERT")
               (member (strcase (cdr (assoc 8 ownerData)))
                       '("HVAC-SAGRILLE" "HVAC-RAGRILLE"
                         "HVAC-OAGRILLE" "HVAC-EAGRILLE" "HVAC-TAGRILLE")))
        (progn
          (setq blkref (vl-catch-all-apply 'vlax-ename->vla-object (list ent)))
          (if (vl-catch-all-error-p blkref) (setq blkref nil))))))
  blkref)

(defun mep_collect_targets (params / block)
  ;; NEVER use ssgetfirst here. The selected grille may have nothing
  ;; to do with the objectModified event (e.g. deleting its grille tag).
  (setq block (mep_get_target_blockref (mep_event_entity params)))
  (if block (list block) nil))

(defun mep_auto_update_callback (reactor params / targets obj flow flexSize cushion val_lookup atts needs_update any_updated grilleData linkedTag belongs ss manualFlex manualFlexValue manualFlexHandled)
  (if (not *MEP_REACTOR_LOCK*)
    (progn
      (setq manualFlex (mep_flex_size_edit_p params)
            targets (mep_collect_targets params))
      (if targets
        (progn
          (setq any_updated nil)
          (foreach obj targets
            (if (and obj
                     (not (vl-catch-all-error-p (vl-catch-all-apply 'vla-get-ObjectName (list obj))))
                     (= (vla-get-ObjectName obj) "AcDbBlockReference")
                     (= (vla-get-HasAttributes obj) :vlax-true))
              (progn
                ;; --- FLEX DUCT / CUSHION AUTO-CALC ---
                (setq flow nil
                      manualFlexHandled nil
                      manualFlexValue nil)
                (setq atts (vl-catch-all-apply 'vlax-invoke (list obj 'GetAttributes)))
                (if (vl-catch-all-error-p atts) (setq atts nil))
                (if atts
                  (progn
                    (foreach att atts
                      (if (= (vla-get-TagString att) "AIR_FLOW")
                        (setq flow (vla-get-TextString att))
                      )
                      (if (= (vla-get-TagString att) "FLEX_DUCT_SIZE")
                        (setq manualFlexValue (vla-get-TextString att)))
                    )

                    (if manualFlex
                      ;; Manual flexible size is authoritative. Cushion head
                       ;; follows it directly, regardless of AIR_FLOW.
                       (progn
                         (setq manualFlexHandled T
                               cushion (if (and manualFlexValue
                                                (/= (vl-string-trim " " manualFlexValue) ""))
                                         (strcat (itoa (+ (atoi manualFlexValue) 150)) "mm HIGH")
                                         "")
                               needs_update nil)
                        (foreach att atts
                          (if (= (vla-get-TagString att) "CUSHION_HEAD")
                            (if (/= (vla-get-TextString att) cushion) (setq needs_update T))))
                        (if needs_update
                          (progn
                            (setq *MEP_REACTOR_LOCK* T)
                            (vl-catch-all-apply
                              '(lambda ()
                                 (foreach att atts
                                   (if (= (vla-get-TagString att) "CUSHION_HEAD")
                                     (vl-catch-all-apply 'vla-put-TextString (list att cushion)))))
                            )
                            (setq *MEP_REACTOR_LOCK* nil)
                            (setq any_updated T))))
                    (if (and (not manualFlexHandled)
                             (or (not flow) (= (vl-string-trim " " flow) "")))
                      ;; AIR_FLOW is blank — clear FLEX_DUCT_SIZE and CUSHION_HEAD
                      (progn
                        (setq needs_update nil)
                        (foreach att atts
                          (cond
                            ((= (vla-get-TagString att) "FLEX_DUCT_SIZE")
                             (if (and (not manualFlex) (/= (vla-get-TextString att) "")) (setq needs_update T)))
                            ((= (vla-get-TagString att) "CUSHION_HEAD")
                             (if (/= (vla-get-TextString att) "") (setq needs_update T)))
                          )
                        )
                        (if needs_update
                          (progn
                            (setq *MEP_REACTOR_LOCK* T)
                            ;; FIX: wrapped so an error here can never leave the lock stuck
                            (vl-catch-all-apply
                              '(lambda ()
                                 (foreach att atts
                                   (cond
                                      ((= (vla-get-TagString att) "FLEX_DUCT_SIZE")
                                       (if (not manualFlex)
                                         (vl-catch-all-apply 'vla-put-TextString (list att ""))))
                                     ((= (vla-get-TagString att) "CUSHION_HEAD")
                                      (vl-catch-all-apply 'vla-put-TextString (list att "")))
                                   )
                                 )
                               )
                            )
                            (setq *MEP_REACTOR_LOCK* nil)
                            (setq any_updated T)
                          )
                        )
                      )
                      ;; AIR_FLOW has a value — calculate and update
                      (progn
                        (setq val_lookup (get_flex_size_from_flow flow))
                        (if (/= val_lookup "")
                          (progn
                            (setq flexSize (strcat val_lookup " Dia")
                                  cushion (strcat (itoa (+ (atoi val_lookup) 150)) "mm HIGH"))

                            (setq needs_update nil)
                            (foreach att atts
                              (cond
                                ((= (vla-get-TagString att) "FLEX_DUCT_SIZE")
                                  (if (and (not manualFlex) (/= (vla-get-TextString att) flexSize)) (setq needs_update T)))
                                ((= (vla-get-TagString att) "CUSHION_HEAD")
                                 (if (/= (vla-get-TextString att) cushion) (setq needs_update T)))
                              )
                            )

                            (if needs_update
                              (progn
                                (setq *MEP_REACTOR_LOCK* T)
                                ;; FIX: wrapped so an error here can never leave the lock stuck
                                (vl-catch-all-apply
                                  '(lambda ()
                                     (foreach att atts
                                       (cond
                                          ((= (vla-get-TagString att) "FLEX_DUCT_SIZE")
                                           (if (not manualFlex)
                                             (vl-catch-all-apply 'vla-put-TextString (list att flexSize))))
                                         ((= (vla-get-TagString att) "CUSHION_HEAD")
                                          (vl-catch-all-apply 'vla-put-TextString (list att cushion)))
                                       )
                                     )
                                   )
                                )
                                (setq *MEP_REACTOR_LOCK* nil)
                                (setq any_updated T)
                              )
                            )
                          )
                        )
                      )
                    )
                    )
                  )
                )

                ;; --- SYNC GRILLE DATA TO LINKED TAG (XData handle-based only) ---
                ;; Only sync if this grille's XData actually points to a tag
                ;; that points BACK to this grille. This prevents a copied grille
                ;; from driving the original tag.
                (setq grilleData (vl-catch-all-apply 'GT:GetBlockAttributes (list obj)))
                (if (vl-catch-all-error-p grilleData) (setq grilleData nil))
                (setq linkedTag (vl-catch-all-apply 'GT:GetLinkedTag (list obj)))
                (if (vl-catch-all-error-p linkedTag) (setq linkedTag nil))

                (if linkedTag
                  (progn
                    ;; Verify the tag's back-link matches THIS grille's handle.
                    ;; If the tag was linked to a different grille (e.g. the source
                    ;; before a copy), do NOT update it from this copy.
                    (setq belongs (vl-catch-all-apply 'GT:TagBelongsToGrille (list linkedTag obj)))
                    (if (and (not (vl-catch-all-error-p belongs)) belongs)
                      (progn
                        (setq *MEP_REACTOR_LOCK* T)
                        ;; FIX: wrapped so an error here can never leave the lock stuck
                        (vl-catch-all-apply 'GT:SetTagAttributes (list linkedTag grilleData))
                        (setq *MEP_REACTOR_LOCK* nil)
                        (setq any_updated T)
                      )
                    )
                  )
                  ;; No XData link at all — do NOT fall back to tag-number search.
                  ;; Tag-number search would wrongly update the original tag when
                  ;; a grille is copied (copy shares the same TAG_NUMBER value).
                  ;; The user must run GT again on the copied grille to create a new link.
                )
              )
            )
          )

          ;; Do not change PICKFIRST selection from a database reactor.
          ;; This also avoids re-entry while AutoCAD edits/deletes a tag.
        )
      )
    )
  )
)

;;; Helper: verify that a tag's stored grille handle matches the given grille object.
;;; Returns T if the tag is genuinely owned by this grille, nil otherwise.
(defun GT:TagBelongsToGrille (tagObj grilleObj / tagEnt tagData tagXdata storedGrilleHandle grilleHandle)
  (setq tagEnt (vlax-vla-object->ename tagObj))
  (setq tagData (entget tagEnt '("MEP_TAG_LINK")))
  (setq tagXdata (assoc -3 tagData))
  ;; Keep legacy tags supported, but malformed XData must not raise
  ;; during a grille ATT edit.
  (if (not tagXdata)
    T
    (progn
      (setq storedGrilleHandle (cdr (assoc 1005 (cdadr tagXdata))))
      (setq grilleHandle (cdr (assoc 5 (entget (vlax-vla-object->ename grilleObj)))))
      (and (= (type storedGrilleHandle) 'STR)
           (= (type grilleHandle) 'STR)
           (= (strcase storedGrilleHandle) (strcase grilleHandle)))
    )
  )
)

(defun get_flex_size_from_flow (flow_str / fdt_data flow_val result q_range pos low high)
  (setq fdt_data (load_fdt_data_mep) flow_val (atof flow_str) result "")
  (foreach row fdt_data
    (setq q_range (car row)
          pos (vl-string-search "-" q_range))
    (if pos
      (progn
        ;; q_range format is "N - M" (space-dash-space).
        ;; pos is the index of "-". Low part = chars before it (trimming trailing space).
        ;; High part starts 2 chars after "-" (skip "- ").
        (setq low  (atof (vl-string-trim " " (substr q_range 1 pos)))
              high (atof (vl-string-trim " " (substr q_range (+ pos 2)))))
        (if (and (>= flow_val low) (<= flow_val high))
          (setq result (nth 1 row))
        )
      )
    )
  )
  result
)

;;; ===========================================================================
;;; 5. COMMAND: FDT
;;; ===========================================================================
(defun c:FDT (/ dcl_id table_data f_path f idx row_count)
  (setq table_data (load_fdt_data_mep))
  (setq row_count (length table_data))
  (if (> row_count 0)
    (progn
      (setq f_path (strcat (getvar "TEMPPREFIX") "mep_fdt_edit.dcl")
            f (open f_path "w"))
      (write-line "FDT_Edit : dialog { label = \"EDIT FLEXIBLE DUCTING TABLE\";" f)
      (setq idx 0)
      (repeat row_count
        (write-line
          (strcat
            ":row{:edit_box{label=\"Range " (itoa (1+ idx))
            "\";key=\"q" (itoa idx)
            "\";edit_width=15;}:edit_box{label=\"Dia:\";key=\"d"
            (itoa idx) "\";edit_width=8;}}")
          f)
        (setq idx (1+ idx))
      )
      (write-line "ok_cancel;}" f)
      (close f)

      (setq dcl_id (load_dialog f_path))
      (if (new_dialog "FDT_Edit" dcl_id)
        (progn
          (setq idx 0)
          (foreach row table_data
            (set_tile (strcat "q" (itoa idx)) (car row))
            (set_tile (strcat "d" (itoa idx)) (nth 1 row))
            (setq idx (1+ idx))
          )
          (action_tile
            "accept"
            (strcat
              "(setq i 0 new_data nil) (repeat " (itoa row_count)
              " (setq new_data (cons (list (get_tile (strcat \"q\" (itoa i))) (get_tile (strcat \"d\" (itoa i)))) new_data)) (setq i (1+ i))) (setq table_data (reverse new_data)) (done_dialog 1)"))
          (if (= (start_dialog) 1)
            (vlax-ldata-put "TBH_PROJECT" "FDT_CONFIG" table_data))
          (unload_dialog dcl_id)
        )
      )
      (vl-file-delete f_path)
    )
    (princ "\nFDT: No rows available in FDT_CONFIG.")
  )
  (princ)
)

(defun GT:NormalizeAirFlow (flowStr / normalized)
  (if (not flowStr)
      ""
      (progn
        (setq normalized (strcase (vl-string-trim " " flowStr)))
        (setq normalized (vl-string-subst "" "L/S" normalized))
        (setq normalized (vl-string-trim " " normalized))
        normalized
      )
))

(defun GT:ApplyGrilleFDTUpdate (atts expectedFlex expectedCushion / updated att tag current)
  (setq updated nil)
  (foreach att atts
    (setq tag (strcase (vla-get-tagstring att))
          current (vla-get-textstring att))
    (cond
      ((= tag "FLEX_DUCT_SIZE")
       (if (not (= current expectedFlex))
         (progn (vla-put-TextString att expectedFlex) (setq updated T))))
      ((= tag "CUSHION_HEAD")
       (if (not (= current expectedCushion))
         (progn (vla-put-TextString att expectedCushion) (setq updated T))))
    )
  )
  updated
)

(defun GT:UpdateGrilleFromFDT (ent / obj atts flow expectedSize expectedFlex expectedCushion updated)
  (setq obj (vlax-ename->vla-object ent))
  (if (and obj
           (= (vla-get-objectname obj) "AcDbBlockReference")
           (= (vla-get-hasattributes obj) :vlax-true))
    (progn
      (setq atts (vlax-invoke obj 'GetAttributes)
            flow ""
            updated nil)
      (foreach att atts
        (if (= (strcase (vla-get-tagstring att)) "AIR_FLOW")
          (setq flow (GT:NormalizeAirFlow (vla-get-textstring att))))
      )
      (if (= flow "")
        (progn
          (setq expectedFlex ""
                expectedCushion "")
          (setq updated (GT:ApplyGrilleFDTUpdate atts expectedFlex expectedCushion))
        )
        (progn
          (setq expectedSize (get_flex_size_from_flow flow))
          (if (and expectedSize (not (= expectedSize "")))
            (progn
              (setq expectedFlex (strcat expectedSize " Dia")
                    expectedCushion (strcat (itoa (+ (atoi expectedSize) 150)) "mm HIGH"))
              (setq updated (GT:ApplyGrilleFDTUpdate atts expectedFlex expectedCushion))
            )
          )
        )
      )
      updated
    )
    nil
  )
)

(defun c:GRILLE_UPDATE (/ ss ss_filter count_updated count_processed ent obj layer)
  (vl-load-com)
  (setq ss_filter '((0 . "INSERT") (8 . "Hvac-SAGrille,Hvac-RAGrille,Hvac-OAGrille,Hvac-EAGrille,Hvac-TAGrille")))
  (setq ss (ssget "X" ss_filter))
  (if (not ss)
    (progn (princ "\nNo grille blocks found on grille layers.") (exit))
  )
  (setq count_updated 0 count_processed (sslength ss) i 0)
  (setq ent nil)
  (repeat count_processed
    (setq ent (ssname ss i))
    (setq obj (vlax-ename->vla-object ent))
    (setq layer (vla-get-layer obj))
    (if (member layer '("Hvac-SAGrille" "Hvac-RAGrille" "Hvac-OAGrille" "Hvac-EAGrille" "Hvac-TAGrille"))
      (if (GT:UpdateGrilleFromFDT ent)
        (setq count_updated (1+ count_updated))
      )
    )
    (setq i (1+ i))
  )
  (princ (strcat "\nGRILLE_UPDATE: Processed " (itoa count_processed) " grilles, updated " (itoa count_updated) "."))
  (princ)
)

(mep_start_reactor)
(princ "\n--- MEP SYSTEM UPDATED (AUTO-FLOW ENABLED) ---")
(princ)

;; =========================================================================
;; FIX: VLR reactors are session-only and are NOT saved with a DWG file.
;; Re-attach the auto-update reactor to whichever drawing becomes current,
;; so switching between or opening drawings in the same AutoCAD session
;; doesn't silently leave AIR_FLOW auto-calc disconnected.
;; =========================================================================
(defun mep_reinit_reactor_on_doc_change (calling-reactor params)
  (mep_start_reactor)
  (princ)
)

(if *MEP_DOC_REACTOR* (vlr-remove *MEP_DOC_REACTOR*))
(setq *MEP_DOC_REACTOR*
  (vlr-docmanager-reactor nil
    (list (cons :vlr-documentBecameCurrent 'mep_reinit_reactor_on_doc_change))
  )
)

(vl-load-com)

;; =========================
;; DEBUG PRINT (silent in production)
;; =========================
(defun GT:Log (msg)
  (princ)
)

;; =========================
;; ENSURE LAYER EXISTS
;; =========================
(defun GT:EnsureLayer (layerName / doc layers lay)
  (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq layers (vla-get-Layers doc))
  (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-Item (list layers layerName)))
    (progn
      (setq lay (vla-Add layers layerName))
      ;; Optionally set a color here, e.g. cyan (4) for tag layer
      (vla-put-Color lay 4)
    )
  )
)

;; =========================
;; ENSURE HIDDEN ATTDEFs ON EXISTING TAG BLOCKS
;; =========================
(defun GT:EnsureTagHiddenAttributes (bName / doc blkDef changed)
  (setq changed nil)
  (if (tblsearch "BLOCK" bName)
    (progn
      (setq doc (vla-get-ActiveDocument (vlax-get-acad-object))
            blkDef (vla-Item (vla-get-Blocks doc) bName))
      (foreach tag '("FACE_SIZE" "MODEL")
        (if (add_mep_attrib_vla blkDef tag (strcat "Enter " tag))
          (setq changed T)))
      (if changed (GT:SyncBlockAttributes bName))))
  changed
)

;; =========================
;; RANDOM SUFFIX
;; =========================
(defun GT:RandSfx (/ ms fr)
  (setq ms (itoa (abs (fix (getvar "MILLISECS"))))
        fr (itoa (fix (* 1000000.0 (rem (getvar "DATE") 1.0)))))
  (strcat "-" (substr ms (max 1 (- (strlen ms) 4)))
               (substr fr 1 (min 4 (strlen fr)))))

;; =========================
;; CREATE BLOCK
;; =========================
(defun GT:MakeGrilleTagBlock (bname / lay hw hh r b yMin doc bDef add-att)
  (setq lay "Hvac-GrilleTag")
  (GT:EnsureLayer lay)
  (if (not (tblsearch "STYLE" "HVACS"))
    (vl-catch-all-apply 'command
      (list "_-STYLE" "HVACS" "Arial Narrow|b0|i0|c0|p34" 150.0 0.8 0.0 "n" "n" "n")))
  (if (not (tblsearch "BLOCK" bname))
    (progn
      (setq hw 350.0 hh 200.0 r 50.0 b 0.41421356)
      (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") (cons 8 lay)
                     '(100 . "AcDbBlockBegin") (cons 2 bname) '(70 . 0) '(10 0.0 0.0 0.0)))
      ;; Rounded rectangle (Width 700, Height 400, R50)
      (entmake (append
        (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
              '(100 . "AcDbPolyline") '(90 . 8) '(70 . 1) '(43 . 0.0))
        (list (cons 10 (list (- hw r) (- hh))) (cons 42 b))
        (list (cons 10 (list hw (+ (- hh) r))) '(42 . 0.0))
        (list (cons 10 (list hw (- hh r))) (cons 42 b))
        (list (cons 10 (list (- hw r) hh)) '(42 . 0.0))
        (list (cons 10 (list (+ (- hw) r) hh)) (cons 42 b))
        (list (cons 10 (list (- hw) (- hh r))) '(42 . 0.0))
        (list (cons 10 (list (- hw) (+ (- hh) r))) (cons 42 b))
        (list (cons 10 (list (+ (- hw) r) (- hh))) '(42 . 0.0))
      ))
      ;; Divider
      (entmake (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 lay) '(62 . 256) '(6 . "ByLayer")
                     '(100 . "AcDbLine") (list 10 (- hw) 0.0 0.0) (list 11 hw 0.0 0.0)))
      (entmake '((0 . "ENDBLK") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbBlockEnd")))

      ;; ADD ATTRIBUTES VIA ACTIVEX TO GUARANTEE CREATION
      (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
      (setq bDef (vla-Item (vla-get-Blocks doc) bname))

      ;; Helper for ATTDEFs
      (defun add-att (tag y invis / att pt)
        (setq pt (vlax-3d-point (list 0.0 y 0.0)))
        (setq att (vl-catch-all-apply 'vla-AddAttribute (list bDef 100.0 (if invis 1 0) tag pt tag "-")))
        (if (not (vl-catch-all-error-p att))
          (progn
            (vla-put-Color att 7)
            (vla-put-Layer att lay)
            (vla-put-StyleName att "HVACS")
            (vla-put-ScaleFactor att 0.8)
            (if (not invis)
              (progn
                (vla-put-Alignment att 10)  ;; acAlignmentMiddleCenter = 10
                (vla-put-TextAlignmentPoint att pt)
              )
              (vla-put-Invisible att :vlax-true)
            )
          )
        )
      )

      ;; 3 Visible ATTDEFs
      (add-att "TAG_NUMBER" 100.0 nil)
      (add-att "AIR_FLOW" -100.0 nil)
      (add-att "SIZE" -280.0 nil)

      ;; Invisible ATTDEFs
      (setq yMin -450.0)
      (foreach tag '("FLEX_DUCT_SIZE" "CUSHION_HEAD" "SYSTEM" "GRILLE_TYPE" "FACE_SIZE" "MODEL")
        (add-att tag yMin T)
        (setq yMin (- yMin 150.0))
      )

      (GT:Log (strcat "Block '" bname "' created successfully."))
    )
    (GT:Log (strcat "Block '" bname "' already exists."))
  )
  (GT:EnsureTagHiddenAttributes bname)
)



;; =========================
;; SAFE CALL MEP
;; FIX: use boundp to avoid error when MEP_Properties_Set is not defined
;; =========================
(defun GT:SafeCallMEP (ent)
  (if (and (boundp 'MEP_Properties_Set) MEP_Properties_Set)
    (if (not (vl-catch-all-error-p (vl-catch-all-apply 'MEP_Properties_Set (list ent))))
      (GT:Log "MEP_Properties_Set executed.")
      (GT:Log "MEP_Properties_Set failed.")
    )
    (GT:Log "MEP_Properties_Set NOT found.")
  )
)

;; =========================
;; GET BLOCK ATTRIBUTES AS ALIST
;; =========================
(defun GT:GetBlockAttributes (ent / obj result tag val)
  (if (= (type ent) 'ENAME)
    (setq obj (vlax-ename->vla-object ent))
    (setq obj ent)
  )
  (setq result '())

  (if (= (vla-get-hasattributes obj) :vlax-true)
    (foreach att (vlax-invoke obj 'GetAttributes)
      (setq tag (strcase (vla-get-tagstring att)))
      (setq val (vla-get-textstring att))
      (setq result (cons (cons tag val) result))
    )
  )
  result
)

(defun GT:GetAttr (tag data)
  (cdr (assoc (strcase tag) data))
)

;; =========================
;; SET A SINGLE ATTRIBUTE VALUE BY TAG (new helper, additive only)
;; Used right after a grille block is created to stamp GRILLE_TYPE.
;; =========================
(defun GT:SetAttrValue (ent tag val / obj)
  (if (= (type ent) 'ENAME)
    (setq obj (vlax-ename->vla-object ent))
    (setq obj ent)
  )
  (if (and obj (= (vla-get-hasattributes obj) :vlax-true))
    (foreach att (vlax-invoke obj 'GetAttributes)
      (if (= (strcase (vla-get-tagstring att)) (strcase tag))
        (vla-put-textstring att val)
      )
    )
  )
)

;; =========================
;; DEBUG ATTRIBUTE LIST
;; =========================
(defun GT:DebugAttributes (ent / obj)
  (if (= (type ent) 'ENAME)
    (setq obj (vlax-ename->vla-object ent))
    (setq obj ent)
  )
  (if (= (vla-get-hasattributes obj) :vlax-true)
    (progn
      (GT:Log "Attribute list:")
      (foreach att (vlax-invoke obj 'GetAttributes)
        (GT:Log
          (strcat " - " (vla-get-TagString att) " = [" (vla-get-TextString att) "]")
        )
      )
    )
    (GT:Log "No attributes found.")
  )
)

;; =========================
;; DEBUG DATA MAP
;; =========================
(defun GT:DebugData (data)
  (GT:Log "Mapped data:")
  (foreach d data
    (GT:Log
      (strcat (car d) " = [" (if (cdr d) (cdr d) "nil") "]")
    )
  )
)

;; =========================
;; UPDATE TAG BY TAG NUMBER (used only in GT:InsertTagWithPreview fallback)
;; NOTE: This is NOT called from the reactor anymore, to prevent copied
;; grilles from hijacking the original tag.
;; =========================
(defun GT:UpdateTagByTagNo (targetTagNo data / ss i ent obj atts match foundUpdated effName)
  (setq foundUpdated nil)
  (setq ss (ssget "X" '((0 . "INSERT") (2 . "GR-*,`*U*"))))

  (if ss
    (progn
      (setq i 0)
      (repeat (sslength ss)
        (setq ent (ssname ss i))
        (setq obj (vlax-ename->vla-object ent))

        (setq effName (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))

        (if (and (not (vl-catch-all-error-p effName))
                 (wcmatch effName "GR-*")
                 (= (vla-get-HasAttributes obj) :vlax-true))
          (progn
            (setq atts (vlax-invoke obj 'GetAttributes))
            (setq match nil)
            (foreach att atts
              (if (or (= (strcase (vla-get-TagString att)) "TAGNO")
                      (= (strcase (vla-get-TagString att)) "TAG_NUMBER"))
                (if (= (strcase (vla-get-TextString att)) (strcase targetTagNo))
                  (setq match T)
                )
              )
            )
            (if match
              (progn
                (setq *MEP_REACTOR_LOCK* T)
                (GT:SetTagAttributes obj data)
                (setq *MEP_REACTOR_LOCK* nil)
                (setq foundUpdated T)
              )
            )
          )
        )
        (setq i (1+ i))
      )
    )
  )
  foundUpdated
)

;; =========================
;; SET ATTRIBUTES ON TAG BLOCK (empty -> "-")
;; =========================
(defun GT:SetTagAttributes (blk data / atts tag val v matched currentVal needsChange)
  (setq atts (vlax-invoke blk 'GetAttributes))
  (GT:Log (strcat "Tag Block has " (itoa (length atts)) " attributes."))

  (foreach att atts
    (setq tag (strcase (vla-get-TagString att)))
    (setq currentVal (vla-get-TextString att))
    (GT:Log (strcat "Found tag in block: " tag))
    (setq matched nil)

    (setq val
      (cond
        ((or (= tag "TAGNO") (= tag "TAG_NUMBER"))
         (setq matched T) (GT:GetAttr "TAG_NUMBER" data))

        ((or (= tag "L/S") (= tag "AIR_FLOW") (= tag "FLOW"))
         (setq matched T)
         (setq v (GT:GetAttr "AIR_FLOW" data))
         (if (and v (not (= (vl-string-trim " " v) "")) (not (vl-string-search "L/S" (strcase v))))
           (strcat v " L/s")
           v
         ))

        ((= tag "SIZE")
         (setq matched T) (GT:GetAttr "SIZE" data))

        ((or (= tag "TYPE") (= tag "OBJECT_TYPE"))
         (setq matched T) (GT:GetAttr "OBJECT_TYPE" data))

        ((= tag "SYSTEM")
         (setq matched T) (GT:GetAttr "SYSTEM" data))

        ((or (= tag "FLEX") (= tag "FLEX_DUCT_SIZE"))
         (setq matched T) (GT:GetAttr "FLEX_DUCT_SIZE" data))

        ((or (= tag "CUSHION") (= tag "CUSHION_HEAD"))
         (setq matched T) (GT:GetAttr "CUSHION_HEAD" data))

        ((= tag "GRILLE_TYPE")
         (setq matched T) (GT:GetAttr "GRILLE_TYPE" data))

        (t
         (setq v (GT:GetAttr tag data))
         (if v
           (progn (setq matched T) v)
           nil
         ))
      )
    )

    (if matched
      (progn
        (if (or (not val) (= (vl-string-trim " " val) ""))
          (setq val (if (member tag '("FACE_SIZE" "MODEL")) "" "-"))
        )
        (GT:Log (strcat "Set " tag " = " val))
        (setq needsChange nil)
        (if (/= currentVal val) (setq needsChange T))
        (if needsChange
          (progn
            (vla-put-TextString att val)
            (vl-catch-all-apply 'vla-put-ScaleFactor (list att 0.8))
          )
        )
      )
    )
  )
)

;; =========================
;; INSERT TAG WITH PREVIEW
;; FIX: sets layer to Hvac-GrilleTag before inserting, restores after
;; =========================
(defun GT:InsertTagWithPreview (grilleEnt data tagBName / oldAttReq oldCmdEcho oldLayer lastEnt newEnt blk)
  (GT:Log "Move mouse -> click to place TAG")
  (setq oldAttReq  (getvar "ATTREQ"))
  (setq oldCmdEcho (getvar "CMDECHO"))
  (setq oldLayer   (getvar "CLAYER"))

  (setvar "ATTREQ"  0)
  (setvar "CMDECHO" 0)

  ;; Ensure the tag layer exists, then switch to it
  (GT:EnsureLayer "Hvac-GrilleTag")
  (setvar "CLAYER" "Hvac-GrilleTag")

  (setq lastEnt (entlast))

  (if (not (vl-catch-all-error-p
             (vl-catch-all-apply 'vl-cmdf
               (list "_.INSERT" tagBName "_S" 1.0 "_R" 0.0 pause))))
    (progn
      (setq newEnt (entlast))
      (if (not (equal lastEnt newEnt))
        (progn
          (GT:Log "Inserting block...")
          (setq blk (vlax-ename->vla-object newEnt))

          ;; Ensure the inserted block reference is on Hvac-GrilleTag
          ;; (already set via CLAYER, but enforce via VLA in case of override)
          (vl-catch-all-apply 'vla-put-Layer (list blk "Hvac-GrilleTag"))

          (GT:Log "Filling attributes...")
          (GT:SetTagAttributes blk data)

          (GT:Log "Linking Grille to Tag via XData...")
          (GT:LinkGrilleAndTag grilleEnt newEnt)

          (GT:Log "Insert DONE.")
        )
        (GT:Log "Insert cancelled.")
      )
    )
    (GT:Log "Insert cancelled.")
  )

  ;; Restore system variables
  (setvar "ATTREQ"  oldAttReq)
  (setvar "CMDECHO" oldCmdEcho)
  (setvar "CLAYER"  oldLayer)
)

;; =========================
;; XDATA LINKING
;; Links grille -> tag (stores tag handle on grille)
;; Also stores grille handle on tag so GT:TagBelongsToGrille can verify ownership.
;; FIX: bidirectional link prevents copied grilles from driving original tags.
;; =========================
(defun GT:LinkGrilleAndTag (grilleEnt tagEnt / appName tagHandle grilleHandle grilleXdata gData tagXdata tData)
  (setq appName "MEP_TAG_LINK")
  (if (not (tblsearch "APPID" appName))
    (regapp appName)
  )

  (setq tagHandle    (cdr (assoc 5 (entget tagEnt))))
  (setq grilleHandle (cdr (assoc 5 (entget grilleEnt))))

  ;; Store tag handle on grille (forward link)
  (if tagHandle
    (progn
      (setq grilleXdata (list -3 (list appName (cons 1005 tagHandle))))
      (setq gData (entget grilleEnt))
      ;; Remove any existing XData for this app before adding new
      (setq gData (vl-remove-if '(lambda (x) (and (listp x) (= (car x) -3))) gData))
      (entmod (append gData (list grilleXdata)))
    )
  )

  ;; Store grille handle on tag (back link) so ownership can be verified
  (if grilleHandle
    (progn
      (setq tagXdata (list -3 (list appName (cons 1005 grilleHandle))))
      (setq tData (entget tagEnt))
      (setq tData (vl-remove-if '(lambda (x) (and (listp x) (= (car x) -3))) tData))
      (entmod (append tData (list tagXdata)))
    )
  )
  (princ)
)

;; =========================
;; GET LINKED TAG FROM GRILLE (via XData handle)
;; Returns the tag vla-object or nil.
;; =========================
(defun GT:GetLinkedTag (grilleObj / entData xdata tagHandle doc tagObj erased)
  (setq entData (entget (vlax-vla-object->ename grilleObj) '("MEP_TAG_LINK")))
  (setq xdata (assoc -3 entData))
  (if xdata
    (progn
      (setq tagHandle (cdr (assoc 1005 (cdadr xdata))))
      (if tagHandle
        (progn
          (setq doc (vla-get-ActiveDocument (vlax-get-acad-object)))
          (setq tagObj (vl-catch-all-apply 'vla-HandleToObject (list doc tagHandle)))
          (if (not (vl-catch-all-error-p tagObj))
            (progn
              (setq erased (vl-catch-all-apply 'vlax-erased-p (list tagObj)))
              (if (or (vl-catch-all-error-p erased) erased)
                nil
                tagObj))
            nil)
        )
      )
    )
  )
)

;; =========================
;; INITIALIZE GRILLE ATTRIBUTES
;; =========================
(defun GT:EnsureGrilleAttributeDefs (ent / obj bName bDef blks doc tags changed)
  ;; Definition-only upgrade: never rewrite legacy ATTRIBUTE reference values.
  (setq obj (vlax-ename->vla-object ent)
        doc (vla-get-activedocument (vlax-get-acad-object))
        blks (vla-get-blocks doc)
        bName (vla-get-effectivename obj)
        bDef (vla-item blks bName)
        tags (GT:GrilleAttributeTags)
        changed nil)
  (foreach tag tags
    (if (add_mep_attrib_vla bDef tag (strcat "Enter " tag))
      (setq changed T)))
  (if changed (GT:SyncBlockAttributes bName))
  changed
)

(defun GT:InitGrilleAttributes (ent layer / obj system att tStr)
  (GT:EnsureGrilleAttributeDefs ent)
  (setq obj (vlax-ename->vla-object ent))
  (cond
    ((= layer "Hvac-SAGrille") (setq system "Supply Air"))
    ((= layer "Hvac-RAGrille") (setq system "Return Air"))
    ((= layer "Hvac-EAGrille") (setq system "Exhaust Air"))
    ((= layer "Hvac-OAGrille") (setq system "Outside Air"))
    ((= layer "Hvac-TAGrille") (setq system "Transfer Air"))
    (t (setq system "Unknown Air"))
  )

  (if (= (vla-get-hasattributes obj) :vlax-true)
    (foreach att (vlax-invoke obj 'GetAttributes)
      (setq tStr (vla-get-tagstring att))
      (if (= (vla-get-textstring att) "")
        (cond
          ((= tStr "SYSTEM") (vla-put-textstring att system))
          ((= tStr "OBJECT_TYPE") (vla-put-textstring att "Air Terminal"))
        )
      )
    )
  )
)

;; =========================
;; MAIN COMMAND: GT
;; =========================
(defun c:GT (/ ent data doc blks sysName tagBName obj layer validLayers kw hadAttrs)

  (vl-load-com)

  (GT:Log "=== START GT ===")

  ;; Ensure tag layer exists
  (GT:EnsureLayer "Hvac-GrilleTag")

  (GT:Log "Select GRILLE:")
  (if (and *TG_SELECTED_ENTITY* (entget *TG_SELECTED_ENTITY*))
    (setq ent *TG_SELECTED_ENTITY*)
    (setq ent (car (entsel "\nSelect Grille block: ")))
  )

  (if (not ent)
    (progn (GT:Log "No selection!") (exit))
  )

  (setq obj (vlax-ename->vla-object ent))
  (setq layer (vla-get-layer obj))
  (setq validLayers '("Hvac-SAGrille" "Hvac-RAGrille" "Hvac-OAGrille" "Hvac-EAGrille" "Hvac-TAGrille"))

  (setq hadAttrs (= (vla-get-hasattributes obj) :vlax-true))
  (if (not hadAttrs)
    (progn
      (if (not (vl-position layer validLayers))
        (progn
          (initget "0 1 2 3 4 5")
          (setq kw (getkword "\nCreate grille: 0 = Exit / 1 = SAG / 2 = RAG / 3 = OAG / 4 = EAG / 5 = TAG <0>: "))
          (if (or (not kw) (= kw "0"))
            (progn (princ "\nCancelled.") (exit))
          )
          (cond
            ((= kw "1") (setq layer "Hvac-SAGrille"))
            ((= kw "2") (setq layer "Hvac-RAGrille"))
            ((= kw "3") (setq layer "Hvac-OAGrille"))
            ((= kw "4") (setq layer "Hvac-EAGrille"))
            ((= kw "5") (setq layer "Hvac-TAGrille"))
          )
          (GT:EnsureLayer layer)
          (vla-put-layer obj layer)
        )
      )
      (GT:InitGrilleAttributes ent layer)
    )
  )
  ;; On legacy grilles, add only missing definitions; keep other ATT values.
  (if (and hadAttrs (vl-position layer validLayers))
    (GT:EnsureGrilleAttributeDefs ent))

  (GT:Log (strcat "Entity type: " (cdr (assoc 0 (entget ent)))))

  ;; Debug attributes before processing
  (GT:DebugAttributes ent)

  ;; Safe call MEP (will skip gracefully if MEP_Properties_Set not loaded)
  (GT:SafeCallMEP ent)

  ;; Read grille data
  (setq data (GT:GetBlockAttributes ent))

  ;; Debug data
  (GT:DebugData data)

  (if (not data)
    (progn (GT:Log "No attribute data!") (exit))
  )

  ;; Setup unique block name for the tag
  (setq sysName (GT:GetAttr "SYSTEM" data))
  (if (or (not sysName) (= sysName "")) (setq sysName "System"))
  (setq tagBName (strcat "GR-" sysName (GT:RandSfx)))

  ;; Check and create block
  (GT:MakeGrilleTagBlock tagBName)

  ;; Insert tag with layer set to Hvac-GrilleTag and bidirectional XData link
  (GT:InsertTagWithPreview ent data tagBName)

  (GT:Log "=== END GT ===")
  (princ)
)

;;; ===========================================================================
;;; EXISTING DWG UPGRADE: preserve old ATT values and link identity.
;;; Invoke GRILLE_ATTR_UPGRADE to add FACE_SIZE and MODEL on legacy grilles
;;; and existing GR-* tags. Unlinked tags get empty fields (no guessing).
;;; ===========================================================================
(defun GT:CopyExtendedFields (tagObj data / att tag val changed)
  (setq changed nil)
  (if (= (vla-get-HasAttributes tagObj) :vlax-true)
    (foreach att (vlax-invoke tagObj 'GetAttributes)
      (setq tag (strcase (vla-get-TagString att)))
      (if (member tag '("FACE_SIZE" "MODEL"))
        (progn
          (setq val (GT:GetAttr tag data))
          (if (not val) (setq val ""))
          (if (/= (vla-get-TextString att) val)
            (progn
              (vla-put-TextString att val)
              (setq changed T)))))))
  changed
)

(defun c:GRILLE_ATTR_UPGRADE (/ ss ts grilleHandles tagHandles handle ent obj
                                 name linked belongs bName uniqueGrilleBlocks
                                 uniqueTagBlocks grilleDefHandles found
                                 countGrilles countTags countDefs countLinked priorLock)
  (vl-load-com)
  (setq countGrilles 0 countTags 0 countDefs 0 countLinked 0
        ss (ssget "X" '((0 . "INSERT")
            (8 . "Hvac-SAGrille,Hvac-RAGrille,Hvac-OAGrille,Hvac-EAGrille,Hvac-TAGrille")))
        ts (ssget "X" '((0 . "INSERT") (8 . "Hvac-GrilleTag")))
        ;; Both snapshots must be taken BEFORE the first ATTSYNC.
        grilleHandles (GT:SelectionHandles ss)
        tagHandles (GT:SelectionHandles ts)
        uniqueGrilleBlocks nil
        uniqueTagBlocks nil
        grilleDefHandles nil)

  ;; Collect definition owners without modifying selection-set entries.
  (foreach handle grilleHandles
    (setq ent (GT:ResolveInsertHandle handle))
    (if ent
      (progn
        (setq obj (vlax-ename->vla-object ent)
              name (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))
        (setq countGrilles (1+ countGrilles))
        (if (and (not (vl-catch-all-error-p name))
                 (not (member name uniqueGrilleBlocks)))
          (progn
            (setq uniqueGrilleBlocks (cons name uniqueGrilleBlocks))
            (setq grilleDefHandles (cons (cons name handle) grilleDefHandles)))))))

  ;; ATTSYNC once per grille definition; re-resolve first known owner.
  (foreach pair grilleDefHandles
    (setq ent (GT:ResolveInsertHandle (cdr pair)))
    (if ent (GT:EnsureGrilleAttributeDefs ent)))

  ;; Tag definitions may be rebuilt; never revisit the old ENAME afterward.
  (foreach handle tagHandles
    (setq ent (GT:ResolveInsertHandle handle))
    (if ent
      (progn
        (setq obj (vlax-ename->vla-object ent)
              name (vl-catch-all-apply 'vla-get-EffectiveName (list obj)))
        (if (and (not (vl-catch-all-error-p name))
                 (wcmatch (strcase name) "GR-*"))
          (progn
            (setq countTags (1+ countTags))
            (if (not (member name uniqueTagBlocks))
              (setq uniqueTagBlocks (cons name uniqueTagBlocks))))))))
  (foreach bName uniqueTagBlocks
    (if (GT:EnsureTagHiddenAttributes bName)
      (setq countDefs (1+ countDefs))))

  ;; Linked tag ownership stays authoritative; do not use TAG_NUMBER.
  (setq priorLock *MEP_REACTOR_LOCK*
        *MEP_REACTOR_LOCK* T)
  (foreach handle grilleHandles
    (setq ent (GT:ResolveInsertHandle handle))
    (if ent
      (progn
        (setq obj (vlax-ename->vla-object ent)
              linked (vl-catch-all-apply 'GT:GetLinkedTag (list obj)))
        (if (vl-catch-all-error-p linked) (setq linked nil))
        (if linked
          (progn
            (setq belongs
              (and (assoc -3 (entget (vlax-vla-object->ename linked)
                                   '("MEP_TAG_LINK")))
                   (GT:TagBelongsToGrille linked obj)))
            (if (and belongs
                     (GT:CopyExtendedFields linked (GT:GetBlockAttributes obj)))
              (setq countLinked (1+ countLinked)))))))
  (setq *MEP_REACTOR_LOCK* priorLock)
  (princ (strcat "\nGRILLE_ATTR_UPGRADE: " (itoa countGrilles) " grilles, "
                 (itoa countTags) " tags, " (itoa countDefs)
                 " updated tag definitions, " (itoa countLinked)
                 " linked tags synchronized."))
  (princ)))

;;; ===========================================================================
;;; COMMAND: CG  (Copy Grille)
;;; Runs the standard COPY command exactly as normal.
;;; After the user finishes, strips MEP_TAG_LINK XData from every newly
;;; created grille block so copies start with no tag link.
;;; Original grilles remain linked and untouched.
;;; ===========================================================================
(defun c:CG (/ appName lastBefore lastAfter ent entData newData stripped)
  (setq appName "MEP_TAG_LINK")

  ;; Record the last entity in the drawing BEFORE copy
  (setq lastBefore (entlast))

  ;; Run the real COPY command — full interactive experience
  (command "_.COPY")
  (while (= 1 (getvar "CMDACTIVE"))
    (command pause)
  )

  ;; Record the last entity AFTER copy
  (setq lastAfter (entlast))

  ;; If nothing new was created, done
  (if (equal lastBefore lastAfter)
    (progn
      (princ "\nCG: No new entities created.")
      (exit)
    )
  )

  ;; Walk forward from the first new entity to entlast
  ;; stripping XData from any grille INSERT found
  (setq stripped 0)
  (setq ent
    (if lastBefore
      (entnext lastBefore)   ;; first entity added after the copy
      (entnext)              ;; drawing was empty before (edge case)
    )
  )

  (while ent
    (setq entData (entget ent (list appName)))

    ;; Only process INSERT entities that carry our XData
    (if (and (= (cdr (assoc 0 entData)) "INSERT")
             (assoc -3 entData))
      (progn
        (setq newData
          (vl-remove-if
            (function (lambda (x) (and (listp x) (= (car x) -3))))
            entData
          )
        )
        (vl-catch-all-apply 'entmod (list newData))
        (setq stripped (1+ stripped))
      )
    )

    ;; Advance — stop after processing lastAfter
    (if (equal ent lastAfter)
      (setq ent nil)
      (setq ent (entnext ent))
    )
  )

  (if (> stripped 0)
    (princ (strcat "\nCG: Tag link removed from " (itoa stripped) " copied grille(s)."))
    (princ "\nCG: Copy complete. No linked grilles found in copies.")
  )
  (princ)
)

(princ "\n-> Type GT to place a Grille Tag | CG to copy grille (unlinked) | FDT to edit flex duct table")
(princ)
