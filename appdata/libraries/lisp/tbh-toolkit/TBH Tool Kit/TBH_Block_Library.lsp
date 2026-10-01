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
  (if (= (type (getenv "TBHBL_LSP_PATH")) 'STR)
    (getenv "TBHBL_LSP_PATH")
    (findfile "TBH_Block_Library.lsp")))

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
  (if (or (not path) (/= (type path) 'STR))
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

(defun tbhbl:copy-block-def (source-doc dest-doc source-def / dest-blocks name existing sa newobjs variant-val newlist new-def)
  ;; Copy the block definition object directly into dest-doc's Blocks
  ;; collection, in memory - no temp DWG file, no document activation.
  ;; If a block of the same name already exists in dest-doc, reuse it
  ;; instead of copying again (avoids name-collision errors).
  ;;
  ;; Every ActiveX call below is wrapped in vl-catch-all-apply, including
  ;; the variant/safearray conversion of CopyObjects' result. That
  ;; conversion is NOT guaranteed to come back the same way for every
  ;; block: blocks with attribute definitions, dynamic-block extension
  ;; dictionaries, reactors, etc. can make some AutoCAD builds hand back
  ;; a bare object instead of a one-element safearray. Previously that
  ;; case threw an uncaught "Invalid index" ActiveX error straight to
  ;; the command line; now it's caught and falls back gracefully, or at
  ;; worst reports a clear message instead of an opaque ActiveX error.
  (setq dest-blocks (vla-get-Blocks dest-doc))
  (setq name (vla-get-Name source-def))
  (setq existing (vl-catch-all-apply 'vla-Item (list dest-blocks name)))
  (if (not (vl-catch-all-error-p existing))
    (list T existing)
    (progn
      (setq sa (vlax-make-safearray vlax-vbObject (cons 0 0)))
      (vlax-safearray-put-element sa 0 source-def)
      (setq newobjs (vl-catch-all-apply 'vla-CopyObjects (list source-doc sa dest-blocks)))
      (cond
        ((vl-catch-all-error-p newobjs)
          (list nil (vl-catch-all-error-message newobjs)))
        (T
          (setq variant-val (vl-catch-all-apply 'vlax-variant-value (list newobjs)))
          (if (vl-catch-all-error-p variant-val)
            (list nil (strcat "CopyObjects returned an unreadable result: "
                        (vl-catch-all-error-message variant-val)))
            (progn
              (setq newlist (vl-catch-all-apply 'vlax-safearray->list (list variant-val)))
              (cond
                ;; Normal case: result is a safearray of copied objects.
                ((not (vl-catch-all-error-p newlist))
                  (setq new-def (car newlist))
                  (if new-def
                    (list T new-def)
                    (list nil "CopyObjects returned no block definition.")))
                ;; Fallback: not an array - some builds return the single
                ;; copied object directly for a one-object copy. Confirm
                ;; it is actually a usable block definition before trusting it.
                ((not (vl-catch-all-error-p (vl-catch-all-apply 'vla-get-Name (list variant-val))))
                  (list T variant-val))
                (T
                  (list nil "CopyObjects returned an unrecognized result (not an array or object)."))))))))))

(defun tbhbl:insert-from-library (source-path source-name display-name point rotation / orig-doc source-info source-doc opened source-def copy-result new-def new-def-name result)
  (setq orig-doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (setq source-info (tbhbl:find-source-document source-path))
  (setq source-doc (car source-info) opened (cadr source-info))
  (if (vl-catch-all-error-p source-doc)
    (list nil (vl-catch-all-error-message source-doc))
    (progn
      (setq source-def (tbhbl:find-source-definition source-doc source-name display-name))
      (if (not source-def)
        (progn
          (if (eq opened T)
            (vl-catch-all-apply 'vla-Close (list source-doc :vlax-false)))
          (list nil (strcat "Block definition not found: " source-name)))
        (progn
          (setq copy-result (tbhbl:copy-block-def source-doc orig-doc source-def))
          (if (eq opened T)
            (vl-catch-all-apply 'vla-Close (list source-doc :vlax-false)))
          (if (not (car copy-result))
            (list nil (cadr copy-result))
            (progn
              (setq new-def (cadr copy-result))
              (setq new-def-name (vl-catch-all-apply 'vla-get-Name (list new-def)))
              (if (vl-catch-all-error-p new-def-name)
                (list nil "Could not read the name of the copied block definition.")
                (progn
                  (setq result
                    (vl-catch-all-apply
                      'vla-InsertBlock
                      (list (vla-get-ModelSpace orig-doc) (vlax-3D-point point)
                            new-def-name 1.0 1.0 1.0 rotation)))
                  (if (vl-catch-all-error-p result)
                    (list nil (vl-catch-all-error-message result))
                    (list T result)))))))))))

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
