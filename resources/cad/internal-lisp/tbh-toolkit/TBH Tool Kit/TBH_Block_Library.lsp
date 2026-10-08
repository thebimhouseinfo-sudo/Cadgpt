;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : TBH_Block_Library.lsp
;;; Command     : BLL
;;; Description : Browse the visible HVAC block library by group and insert a
;;;               selected block into the active destination drawing.
;;;
;;; Source DWG  : SRC\FDM TEMPLATE.dwg (relative to this LSP file)
;;; Usage       : APPLOAD this file, then run BLL.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; AutoCAD does not expose the path of a file loaded by APPLOAD consistently.
;; Keep a locator in the environment after the first fallback selection.
(setq *TBHBL:LspPath*
  (cond
    ;; CadGPT verified TBH loader knows its absolute toolkit root. Prefer
    ;; the installed source rather than a stale TBHBL_LSP_PATH env setting.
    ((and (boundp '*cadgpt-load-dir*)
          (= (type *cadgpt-load-dir*) 'STR)
          (findfile
            (strcat *cadgpt-load-dir*
                    "/TBH Tool Kit/TBH_Block_Library.lsp")))
     (findfile
       (strcat *cadgpt-load-dir*
               "/TBH Tool Kit/TBH_Block_Library.lsp")))
    ((and (= (type (getenv "TBHBL_LSP_PATH")) 'STR)
          (findfile (getenv "TBHBL_LSP_PATH")))
     (findfile (getenv "TBHBL_LSP_PATH")))
    (T (findfile "TBH_Block_Library.lsp"))))

;; Each entry is: (display-name source-block-name)
(setq *TBHBL:Groups*
  (list
    (cons "SYMBOL"
      (list
        (list "AIR ARROW" "*U123")
        (list "SECTION ARROW 123" "*U126")
        (list "FILTER REMOVAL" "Filter Removal")
        (list "UNDERCUT" "Undercut")
        (list "DG TAG" "DG Tag")
      ))
    (cons "CONTROL EQM"
      (list
        (list "TEMP SENSOR" "Temp Sensor")
        (list "SENSOR" "Sensor")
        (list "CONTROL PANEL" "Control Panel")
        (list "CONTROL STATION" "Control Station")
        (list "CO2 SENSOR" "CO2 Sensor")
        (list "IR" "IR")
        (list "TUNDISH" "Tundish")
      ))
    (cons "EQM"
      (list
        (list "ROOFCOWL" "*U465")
        (list "RC-SECTION" "*U466")
        (list "RIL-200" "A$C53F018F8")
        (list "RIL-150" "A$C3C356E9E")
        (list "RIL-100" "A$C2ED14586")
        (list "VM-200L" "A$C09894C6A")
        (list "VM-150L" "A$C3C4426A3")
        (list "VM-125L" "A$C8a64a2aa")
        (list "CU LARGE" "A$C513B1EDA")
        (list "CU" "A$C0CA7441A")
        (list "CU SPLIT" "A$Ca29337f5")
        (list "CASSETTE" "AC61986")
        (list "WALL MOUNTED" "A$C224d5594")
      ))
    (cons "FILTER BOX"
      (list
        (list "RA PLENUM 50" "*U394")
        (list "FBSIDEVIEW_50" "*U395")
        (list "RA PLENUM 75" "*U393")
        (list "FBSIDEVIEW_75" "*U396")
        (list "RA PLENUM 100" "*U392")
        (list "FBSIDEVIEW_100" "*U397")
      ))
    (cons "DUCT ACCESSORIES"
      (list
        (list "FD" "*U112")
        (list "VCD" "*U102")
        (list "NRD" "*U122")
        (list "MD" "MOTORISED")
      ))
    (cons "OTHER / OUTSIDE FRAMES"
      (list
        (list "DE76" "DE76")
      ))
  )
)

(defun tbhbl:locate-lsp (/ path)
  (setq path *TBHBL:LspPath*)
  (if (or (not path)
          (/= (type path) 'STR)
          (not (findfile path)))
    (setq path
      (getfiled
        "Locate TBH_Block_Library.lsp once"
        "TBH_Block_Library.lsp"
        "lsp"
        0)))
  (if path
    (progn
      (setq *TBHBL:LspPath* path)
      (setenv "TBHBL_LSP_PATH" path)))
  path)

(defun tbhbl:source-path (/ lsp-path base source)
  ;; Resolve the source DWG below SRC, never by machine path.
  (setq lsp-path (tbhbl:locate-lsp))
  (if lsp-path
    (progn
      (setq base (vl-filename-directory lsp-path))
      (setq source (strcat base "\\SRC\\FDM TEMPLATE.dwg"))
      source)
    nil)
)

;; Candidate ObjectDBX ProgIDs, newest first. The exact suffix depends on
;; the installed AutoCAD release; we probe until one registers, then cache
;; the ProgID string. ObjectDBX loads a DWG's database in the background
;; with no visible document window - this is what avoids the flicker.
;; The opened database itself is also cached and kept loaded for the rest
;; of the session (Open() is only called once) - re-opening it on every
;; insert was both slow and, on some AutoCAD builds, unstable.
(setq *TBHBL:DbxProgId* nil)
(setq *TBHBL:DbxTried* nil)
(setq *TBHBL:Dbx* nil)
(setq *TBHBL:DbxSourcePath* nil)

(defun tbhbl:probe-dbx-progid (/ app ver major candidates pid obj)
  (if (not *TBHBL:DbxTried*)
    (progn
      (setq *TBHBL:DbxTried* T)
      ;; Ask the running AutoCAD for its own version number and try that
      ;; exact ProgID first - e.g. Application.Version "24.1..." means
      ;; "ObjectDBX.AxDbDocument.24". Guessed fallbacks after it in case
      ;; parsing fails.
      (setq app (vlax-get-acad-object))
      (setq ver (vl-catch-all-apply 'vla-get-Version (list app)))
      (setq major nil)
      (if (and (not (vl-catch-all-error-p ver)) (vl-string-search "." ver))
        (setq major
          (vl-catch-all-apply 'atoi (list (substr ver 1 (vl-string-search "." ver))))))
      (setq candidates
        (append
          (if (and major (not (vl-catch-all-error-p major)))
            (list (strcat "ObjectDBX.AxDbDocument." (itoa major))))
          (list "ObjectDBX.AxDbDocument.25" "ObjectDBX.AxDbDocument.24"
                "ObjectDBX.AxDbDocument.23" "ObjectDBX.AxDbDocument.22"
                "ObjectDBX.AxDbDocument.21" "ObjectDBX.AxDbDocument.20"
                "ObjectDBX.AxDbDocument.19" "ObjectDBX.AxDbDocument.18"
                "ObjectDBX.AxDbDocument.17" "ObjectDBX.AxDbDocument.16")))
      (foreach pid candidates
        (if (not *TBHBL:DbxProgId*)
          (progn
            (setq obj (vl-catch-all-apply 'vlax-create-object (list pid)))
            (if (not (vl-catch-all-error-p obj))
              (progn
                (setq *TBHBL:DbxProgId* pid)
                (vl-catch-all-apply 'vlax-release-object (list obj)))))))
      (princ
        (if *TBHBL:DbxProgId*
          (strcat "\n[TBH] ObjectDBX ready (" *TBHBL:DbxProgId* ") - source drawing will load silently.")
          "\n[TBH] ObjectDBX not available on this system - source drawing will open visibly each time."))))
  *TBHBL:DbxProgId*
)

(defun tbhbl:release-dbx-cache ()
  (if *TBHBL:Dbx*
    (vl-catch-all-apply 'vlax-release-object (list *TBHBL:Dbx*)))
  (setq *TBHBL:Dbx* nil *TBHBL:DbxSourcePath* nil)
  (princ)
)

(defun tbhbl:get-dbx (source-path / obj)
  ;; Returns a live ObjectDBX document already loaded with source-path.
  ;; Opens it only the first time it's needed; every call after that
  ;; reuses the same loaded database, no repeat disk I/O.
  (cond
    ((and *TBHBL:Dbx* (equal *TBHBL:DbxSourcePath* source-path)) *TBHBL:Dbx*)
    ((not (tbhbl:probe-dbx-progid)) nil)
    (T
      (tbhbl:release-dbx-cache) ;; drop any stale/different cached database
      (setq obj (vl-catch-all-apply 'vlax-create-object (list *TBHBL:DbxProgId*)))
      (if (vl-catch-all-error-p obj)
        nil
        (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-Open (list obj source-path)))
          (progn (vl-catch-all-apply 'vlax-release-object (list obj)) nil)
          (progn (setq *TBHBL:Dbx* obj *TBHBL:DbxSourcePath* source-path) obj)))))
)

(defun tbhbl:find-source-document (source-path / app docs doc result target dbx)
  (setq app (vlax-get-acad-object))
  (setq docs (vla-get-Documents app))
  (setq target (strcase source-path))
  (vlax-for doc docs
    (if (= (strcase (strcat (vla-get-Path doc) "\\" (vla-get-Name doc))) target)
      (setq result doc)))
  (cond
    (result (list result nil)) ;; already open in the editor - leave it alone
    ((setq dbx (tbhbl:get-dbx source-path)) (list dbx :dbx))
    ;; ObjectDBX unavailable or failed - fall back to a normal, visible
    ;; document open.
    (T (list (vl-catch-all-apply 'vla-Open (list docs source-path)) T)))
)

(defun tbhbl:find-source-definition (source-doc source-name display-name / blocks result)
  (setq blocks (vla-get-Blocks source-doc))
  (setq result (vl-catch-all-apply 'vla-Item (list blocks source-name)))
  (if (vl-catch-all-error-p result)
    (setq result (vl-catch-all-apply 'vla-Item (list blocks display-name))))
  (if (vl-catch-all-error-p result) nil result)
)

;; CopyObjects must receive objects owned by the source database and an
;; owner in the destination. Cloning a source INSERT (rather than *U123's
;; anonymous block-table record) carries its referenced definition, dynamic
;; block data, attributes and dependent nested definitions together.
(defun tbhbl:find-sample-in-owner (owner name / found item objname itemname)
  (setq found nil)
  (vlax-for item owner
    (if (not found)
      (progn
        (setq objname (vl-catch-all-apply 'vla-get-ObjectName (list item)))
        (if (and (not (vl-catch-all-error-p objname))
                 (= objname "AcDbBlockReference"))
          (progn
            (setq itemname (vl-catch-all-apply 'vla-get-Name (list item)))
            (if (and (not (vl-catch-all-error-p itemname))
                     (= (strcase itemname) (strcase name)))
              (setq found item)))))))
  found)

(defun tbhbl:find-source-sample (doc name display / result lay block)
  ;; Do not call CopyObjects while a vlax-for is still active.
  (setq result (tbhbl:find-sample-in-owner (vla-get-ModelSpace doc) name))
  (if (and (not result) (/= (strcase name) (strcase display)))
    (setq result (tbhbl:find-sample-in-owner (vla-get-ModelSpace doc) display)))
  (if (not result)
    (vlax-for lay (vla-get-Layouts doc)
      (if (and (not result)
               (/= (strcase (vla-get-Name lay)) "MODEL"))
        (progn
          (setq block (vla-get-Block lay))
          (setq result (tbhbl:find-sample-in-owner block name))
          (if (and (not result) (/= (strcase name) (strcase display)))
            (setq result (tbhbl:find-sample-in-owner block display)))))))
  result)

(defun tbhbl:copy-primary-result (raw owner before / value arr result n item typ)
  ;; COM may return VARIANT, SAFEARRAY or an object depending on host.
  ;; A lost/odd return is not proof that copying failed: verify destination.
  (setq value raw)
  (if (= (type value) 'VARIANT)
    (setq value (vl-catch-all-apply 'vlax-variant-value (list value))))
  (if (and (not (vl-catch-all-error-p value))
           (= (type value) 'SAFEARRAY))
    (progn
      (setq arr (vl-catch-all-apply 'vlax-safearray->list (list value)))
      (if (not (vl-catch-all-error-p arr))
        (setq value (car arr)))))
  (if (= (type value) 'VLA-OBJECT)
    (progn
      (setq typ (vl-catch-all-apply 'vla-get-ObjectName (list value)))
      (if (and (not (vl-catch-all-error-p typ))
               (= typ "AcDbBlockReference"))
        (setq result value))))
  (if (not result)
    (progn
      (setq n (vl-catch-all-apply 'vla-get-Count (list owner)))
      (if (and (not (vl-catch-all-error-p n)) (> n before))
        (progn
          (setq item (vl-catch-all-apply 'vla-Item (list owner (1- n))))
          (if (not (vl-catch-all-error-p item))
            (progn
              (setq typ (vl-catch-all-apply 'vla-get-ObjectName (list item)))
              (if (and (not (vl-catch-all-error-p typ))
                       (= typ "AcDbBlockReference"))
                (setq result item))))))))
  result)

(defun tbhbl:copy-source-sample (source-doc dest-doc sample point rotation / owner before sa copied result moved rotated err)
  (setq owner (vla-get-ModelSpace dest-doc)
        before (vla-get-Count owner)
        sa (vlax-make-safearray vlax-vbObject '(0 . 0)))
  (vlax-safearray-put-element sa 0 sample)
  (setq copied (vl-catch-all-apply 'vla-CopyObjects (list source-doc sa owner)))
  (setq result (tbhbl:copy-primary-result copied owner before))
  (if (not result)
    (list nil
      (if (vl-catch-all-error-p copied)
        (strcat "Cannot copy block reference from template: "
                (vl-catch-all-error-message copied))
        "CopyObjects returned no verified block reference in destination."))
    (progn
      (setq moved
        (vl-catch-all-apply 'vla-Move
          (list result (vla-get-InsertionPoint result) (vlax-3D-point point))))
      (setq rotated
        (if (vl-catch-all-error-p moved)
          moved
          (vl-catch-all-apply 'vla-put-Rotation (list result rotation))))
      (if (vl-catch-all-error-p rotated)
        (progn
          ;; Never leave a duplicate source-template sample at its old point.
          (vl-catch-all-apply 'vla-Delete (list result))
          (list nil
            (strcat "Copied block but could not position it: "
                    (vl-catch-all-error-message rotated))))
        (list T result)))))

(defun tbhbl:copy-block-def (source-doc dest-doc source-def / dest-blocks name existing sa copied verified)
  ;; Named block fallback for definitions not placed as template samples.
  ;; Trust a verified destination Blocks.Item, not only CopyObjects' COM
  ;; return shape (which differs between AutoCAD releases).
  (setq dest-blocks (vla-get-Blocks dest-doc)
        name (vla-get-Name source-def)
        existing (vl-catch-all-apply 'vla-Item (list dest-blocks name)))
  (if (not (vl-catch-all-error-p existing))
    (list T existing)
    (progn
      (setq sa (vlax-make-safearray vlax-vbObject '(0 . 0)))
      (vlax-safearray-put-element sa 0 source-def)
      (setq copied (vl-catch-all-apply 'vla-CopyObjects (list source-doc sa dest-blocks))
            verified (vl-catch-all-apply 'vla-Item (list dest-blocks name)))
      (if (not (vl-catch-all-error-p verified))
        (list T verified)
        (list nil
          (if (vl-catch-all-error-p copied)
            (strcat "Cannot copy block definition: "
                    (vl-catch-all-error-message copied))
            (strcat "Block definition was not found after CopyObjects: " name)))))))

(defun tbhbl:insert-from-library (source-path source-name display-name point rotation
                                  / orig-doc source-info source-doc opened source-ref source-def copy-result
                                    new-def-name inserted closed activated)
  (setq orig-doc (vla-get-ActiveDocument (vlax-get-acad-object))
        source-info (tbhbl:find-source-document source-path)
        source-doc (car source-info)
        opened (cadr source-info))
  (cond
    ((or (not source-doc) (vl-catch-all-error-p source-doc))
     (list nil
       (if (vl-catch-all-error-p source-doc)
         (vl-catch-all-error-message source-doc)
         "Cannot open the library template.")))
    (T
      (setq source-ref
        (vl-catch-all-apply 'tbhbl:find-source-sample
          (list source-doc source-name display-name)))
      (cond
        ;; Preferred: deep-clone a real block reference. This works with
        ;; anonymous *U names and preserves dynamic definitions/dependencies.
        ((and (not (vl-catch-all-error-p source-ref)) source-ref)
         (setq copy-result
           (tbhbl:copy-source-sample
             source-doc orig-doc source-ref point rotation)))
        ((= (substr source-name 1 1) "*")
         (setq copy-result
           (list nil (strcat
             "Anonymous block " source-name
             " has no placed INSERT in SRC/FDM TEMPLATE.dwg. "
             "Place one source instance in the template, then BLLRELOAD."))))
        (T
         (setq source-def
           (vl-catch-all-apply 'tbhbl:find-source-definition
             (list source-doc source-name display-name)))
         (if (or (vl-catch-all-error-p source-def) (not source-def))
           (setq copy-result
             (list nil (strcat "Block not found in template: " source-name)))
           (progn
             (setq copy-result (tbhbl:copy-block-def source-doc orig-doc source-def))
             (if (car copy-result)
               (progn
                 (setq new-def-name
                   (vl-catch-all-apply 'vla-get-Name (list (cadr copy-result))))
                 (if (vl-catch-all-error-p new-def-name)
                   (setq copy-result (list nil "Imported block name cannot be read."))
                   (progn
                     (setq inserted
                       (vl-catch-all-apply 'vla-InsertBlock
                         (list (vla-get-ModelSpace orig-doc)
                               (vlax-3D-point point)
                               new-def-name 1.0 1.0 1.0 rotation)))
                     (setq copy-result
                       (if (vl-catch-all-error-p inserted)
                         (list nil (vl-catch-all-error-message inserted))
                         (list T inserted)))))))))))
      ;; A visible source-document fallback changes AutoCAD's active tab.
      ;; Close only what BLL opened, then reactivate the original destination.
      (if (eq opened T)
        (setq closed
          (vl-catch-all-apply 'vla-Close (list source-doc :vlax-false))))
      (setq activated (vl-catch-all-apply 'vla-Activate (list orig-doc)))
      (if (vl-catch-all-error-p activated)
        (list nil (strcat
          "Source processed, but destination drawing could not be reactivated: "
          (vl-catch-all-error-message activated)))
        copy-result)))))

(defun tbhbl:write-dcl (/ dcl-path f)
  ;; Generate the UI in TEMP so this feature only needs one LSP file.
  (setq dcl-path (strcat (getenv "TEMP") "\\TBH_Block_Library.dcl"))
  (setq f (open dcl-path "w"))
  (if f
    (progn
      (write-line "tbhbl_main : dialog {" f)
      (write-line "  label = \"TBH HVAC Block Library\";" f)
      (write-line "  : row {" f)
      (write-line "    : list_box { key=\"groups\"; label=\"GROUPS\"; width=25; height=20; fixed_width=true; }" f)
      (write-line "    : list_box { key=\"blocks\"; label=\"BLOCKS\"; width=35; height=20; fixed_width=true; }" f)
      (write-line "  }" f)
      (write-line "  : text { key=\"status\"; label=\"Select a group and a block.\"; alignment=left; }" f)
      (write-line "  : row {" f)
      (write-line "    : button { key=\"insert\"; label=\"Insert Block\"; width=18; is_default=true; }" f)
      (write-line "    spacer;" f)
      (write-line "    : button { key=\"cancel\"; label=\"Cancel\"; width=12; is_cancel=true; }" f)
      (write-line "  }" f)
      (write-line "}" f)
      (close f)
      dcl-path)
    nil)
)

(defun tbhbl:group-names (/ result)
  (setq result nil)
  (foreach group *TBHBL:Groups*
    (setq result (append result (list (car group)))))
  result
)

(defun tbhbl:display-names (items / result)
  (setq result nil)
  (foreach item items
    (setq result (append result (list (car item)))))
  result
)

(defun tbhbl:fill-groups ()
  (start_list "groups")
  (mapcar 'add_list (tbhbl:group-names))
  (end_list)
  (set_tile "groups" "0")
)

(defun tbhbl:fill-blocks (group-index / group items)
  (setq group (nth group-index *TBHBL:Groups*))
  (setq items (cdr group))
  (start_list "blocks")
  (mapcar 'add_list (tbhbl:display-names items))
  (end_list)
  (set_tile "blocks" "0")
  (set_tile "status"
    (strcat (car group) " - " (itoa (length items)) " block(s)"))
)

(defun tbhbl:insert-selected (group-index block-index / group item block source-block source point scale result blk-ref ent)
  (setq group (nth group-index *TBHBL:Groups*))
  (setq item (nth block-index (cdr group)))
  (setq block (car item))
  (setq source-block (cadr item))
  (setq source (tbhbl:source-path))
  (cond
    ((not source)
      (alert "Cannot locate TBH_Block_Library.lsp. The source path cannot be resolved."))
    ((not (findfile source))
      (alert (strcat "Source drawing not found:\n" source)))
    ((not (setq point (getpoint (strcat "\nSpecify insertion point for " block ": "))))
      (princ "\nInsert cancelled."))
    (T
      ;; Library blocks are authored at their drawing scale: always insert 1:1.
      (setq scale 1.0)
      (setq result (tbhbl:insert-from-library source source-block block point 0.0))
      (if (not (car result))
        (alert (strcat "Insert failed:\n" (cadr result)))
        (progn
          (setq blk-ref (cadr result))
          (setq ent (vlax-vla-object->ename blk-ref))
          ;; Hand rotation off to AutoCAD's native ROTATE command so the
          ;; drag preview gets running OSNAP, Ortho/Polar tracking, and
          ;; typed/Reference-angle input for free.
          (command "_.rotate" ent "" point pause)
          (princ (strcat "\nInserted block: " block))))))
  (princ)
)

(defun c:BLL (/ dcl-path dcl-id dialog-result group-index block-index)
  (setq dcl-path (tbhbl:write-dcl))
  (if (not dcl-path)
    (alert "Cannot create the temporary dialog file.")
    (progn
      (setq dcl-id (load_dialog dcl-path))
      (if (< dcl-id 0)
        (alert "Cannot load the block library dialog.")
        (progn
          (if (new_dialog "tbhbl_main" dcl-id)
            (progn
              (setq group-index 0 block-index 0)
              (tbhbl:fill-groups)
              (tbhbl:fill-blocks 0)
              (action_tile "groups"
                "(progn (setq group-index (atoi $value) block-index 0) (tbhbl:fill-blocks group-index))")
              (action_tile "blocks"
                "(setq block-index (atoi $value))")
              (action_tile "insert"
                "(done_dialog 1)")
              (action_tile "cancel"
                "(done_dialog 0)")
              (setq dialog-result (start_dialog))
              (unload_dialog dcl-id)
              (if (= dialog-result 1)
                (tbhbl:insert-selected group-index block-index)))
            (unload_dialog dcl-id))))))
  (princ)
)

(defun c:BLLRELOAD ()
  ;; Drop the cached source database so the next BLL insert re-reads
  ;; FDM TEMPLATE.dwg from disk - use after editing that file mid-session.
  (tbhbl:release-dbx-cache)
  (princ "\n[TBH] Block library cache cleared - next insert will reload the source drawing.")
  (princ)
)

(princ "\n[TBH] BLL loaded. Type BLL to open the grouped block library.")
(princ)
