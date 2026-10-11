;;; =============================================================================
;;; CADGPT-HEADER-START
;;;
;;; File         : TBH_Block_Library.lsp
;;; Module       : TBH Handle-Based Block Library
;;; Command      : BLL, BLLRELOAD, BLLHINIT, BLLHSET
;;; Description  : Insert TBH library blocks identified by source drawing handles (not block names).
;;; Inputs       : Command prompts / selection as required.
;;; Effects      : May modify the current drawing; validate declared postconditions.
;;; Interaction  : Interactive unless implementation is explicitly non-interactive.
;;; Risk         : Medium; test on an approved drawing before production use.
;;; Dependencies : Visual LISP COM (`vl-load-com`).
;;; Notes        : Maintain behavior and registry metadata together when edited by CadGPT.
;;; Revision     : Managed by CadGPT write-lisp workflow.
;;;
;;; CADGPT-HEADER-END
;;; =============================================================================

(vl-load-com)

;; AutoCAD does not expose the path of a file loaded by APPLOAD consistently.
;; Keep a locator in the environment after the first fallback selection.
;; Each entry is: (display-name legacy-import-name). Legacy names are used ONLY by BLLHINIT; BLLH insertion uses persisted source handles.
(setq *BLLH:Groups*
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


;; Source template lives with the original TBH Toolkit.
;; Resolve it automatically while loading; never show a file dialog on load.
(setq *BLLH:Autoloading* nil)
(defun bllh:source-path (/ p loader root candidate)
  (setq p (getenv "BLLH_SOURCE_DWG"))
  (if (or (null p) (= p "") (not (findfile p)))
    (progn
      (setq loader (getenv "TBHBL_LSP_PATH"))
      (setq root (if (and loader (findfile loader)) (vl-filename-directory loader) nil))
      (setq candidate
        (cond
          ((and root (findfile (strcat root "\\SRC\\FDM TEMPLATE.dwg")))
            (strcat root "\\SRC\\FDM TEMPLATE.dwg"))
          ((and (boundp '*cadgpt-load-dir*)
                (= (type *cadgpt-load-dir*) 'STR)
                (findfile (strcat *cadgpt-load-dir* "\\TBH Tool Kit\\SRC\\FDM TEMPLATE.dwg")))
            (strcat *cadgpt-load-dir* "\\TBH Tool Kit\\SRC\\FDM TEMPLATE.dwg"))
          ((findfile "D:/00 Other Works/Vibecode/Cadgpt/resources/cad/internal-lisp/tbh-toolkit/TBH Tool Kit/SRC/FDM TEMPLATE.dwg")
           "D:/00 Other Works/Vibecode/Cadgpt/resources/cad/internal-lisp/tbh-toolkit/TBH Tool Kit/SRC/FDM TEMPLATE.dwg")
          (T nil)))
      (setq p (if candidate candidate
        (if *BLLH:Autoloading* nil
          (getfiled "Select the original SRC/FDM TEMPLATE.dwg" "FDM TEMPLATE.dwg" "dwg" 0))))))
  (if (and p (findfile p)) (progn (setenv "BLLH_SOURCE_DWG" p) p) nil)
)

;; Persist source handles separately from this Lisp. No source DWG mutation.
(setq *BLLH:HandleMap* nil *BLLH:MapLoaded* nil *BLLH:MapSource* nil)
(defun bllh:map-file (/ base dir)
  (setq base (getenv "LOCALAPPDATA"))
  (if (or (null base) (= base "")) (setq base (getenv "TEMP")))
  (setq dir (strcat base "\\CadGPT"))
  (if (not (vl-file-directory-p dir)) (vl-mkdir dir))
  (setq dir (strcat dir "\\data"))
  (if (not (vl-file-directory-p dir)) (vl-mkdir dir))
  (strcat dir "\\BLLH_Source_Handles.txt")
)
(defun bllh:handle-valid (value)
  (and (= (type value) 'STR)
       (> (strlen value) 0)
       (not (wcmatch (strcase value) "*[~0-9A-F]*")))
)
(defun bllh:map-key (group-name display-name)
  (strcat group-name "|" display-name)
)
(defun bllh:map-get (group-name display-name / hit)
  (setq hit (assoc (bllh:map-key group-name display-name) *BLLH:HandleMap*))
  (if hit (cdr hit) nil)
)
(defun bllh:map-put (group-name display-name handle-value / key hit)
  (setq key (bllh:map-key group-name display-name))
  (setq handle-value (strcase handle-value))
  (if (bllh:handle-valid handle-value)
    (progn
      (setq hit (assoc key *BLLH:HandleMap*))
      (if hit
        (setq *BLLH:HandleMap* (subst (cons key handle-value) hit *BLLH:HandleMap*))
        (setq *BLLH:HandleMap* (cons (cons key handle-value) *BLLH:HandleMap*)))
      T)
    nil)
)
(defun bllh:map-save (source-path / f hit)
  (setq f (open (bllh:map-file) "w"))
  (if f
    (progn
      (write-line (strcat "SOURCE|" source-path) f)
      (foreach hit *BLLH:HandleMap*
        (write-line (strcat (car hit) "|" (cdr hit)) f))
      (close f)
      T)
    nil)
)
(defun bllh:map-load (source-path / f line pos key val declared)
  (if (or (not *BLLH:MapLoaded*)
          (not (equal (strcase source-path) (strcase *BLLH:MapSource*))))
    (progn
      (setq *BLLH:MapLoaded* T *BLLH:MapSource* source-path
            *BLLH:HandleMap* nil)
      (setq f (open (bllh:map-file) "r"))
      (if f
        (progn
          (setq line (read-line f))
          (setq declared (if (and line (>= (strlen line) 7)
                                  (= (substr line 1 7) "SOURCE|"))
                           (substr line 8) nil))
          (if (and declared (equal (strcase declared) (strcase source-path)))
            (while (setq line (read-line f))
              (setq pos (vl-string-position 124 line nil T))
              (if pos
                (progn
                  (setq key (substr line 1 pos)
                        val (substr line (+ pos 2)))
                  (if (bllh:handle-valid val)
                    (setq *BLLH:HandleMap*
                      (cons (cons key (strcase val)) *BLLH:HandleMap*))))))
            (princ "\n[BLLH] Mapping is for a DIFFERENT source DWG. Ignoring it; no guessing."))
          (close f)))))
  *BLLH:HandleMap*
)

;; Candidate ObjectDBX ProgIDs, newest first. The exact suffix depends on
;; the installed AutoCAD release; we probe until one registers, then cache
;; the ProgID string. ObjectDBX loads a DWG's database in the background
;; with no visible document window - this is what avoids the flicker.
;; The opened database itself is also cached and kept loaded for the rest
;; of the session (Open() is only called once) - re-opening it on every
;; insert was both slow and, on some AutoCAD builds, unstable.
(setq *BLLH:DbxProgId* nil)
(setq *BLLH:DbxTried* nil)
(setq *BLLH:Dbx* nil)
(setq *BLLH:DbxSourcePath* nil)

(defun bllh:probe-dbx-progid (/ app ver major candidates pid obj)
  (if (not *BLLH:DbxTried*)
    (progn
      (setq *BLLH:DbxTried* T)
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
        (if (not *BLLH:DbxProgId*)
          (progn
            (setq obj (vl-catch-all-apply 'vlax-create-object (list pid)))
            (if (not (vl-catch-all-error-p obj))
              (progn
                (setq *BLLH:DbxProgId* pid)
                (vl-catch-all-apply 'vlax-release-object (list obj)))))))
      (princ
        (if *BLLH:DbxProgId*
          (strcat "\n[TBH] ObjectDBX ready (" *BLLH:DbxProgId* ") - source drawing will load silently.")
          "\n[TBH] ObjectDBX not available on this system - source drawing will open visibly each time."))))
  *BLLH:DbxProgId*
)

(defun bllh:release-dbx-cache ()
  (if *BLLH:Dbx*
    (vl-catch-all-apply 'vlax-release-object (list *BLLH:Dbx*)))
  (setq *BLLH:Dbx* nil *BLLH:DbxSourcePath* nil)
  (princ)
)

(defun bllh:dbx-live-p (obj / blocks)
  ;; A cached COM object may become invalid after AutoCAD reload/sleep.
  ;; Validate without mutating before reusing it for another BLL import.
  (and obj
       (setq blocks (vl-catch-all-apply 'vla-get-Blocks (list obj)))
       (not (vl-catch-all-error-p blocks))))

(defun bllh:get-dbx (source-path / obj)
  ;; Reuse only a *verified-live* ObjectDBX document; stale COM pointers
  ;; cause repeated copy failures after host reload or power-state changes.
  (cond
    ((and *BLLH:Dbx*
          (equal *BLLH:DbxSourcePath* source-path)
          (bllh:dbx-live-p *BLLH:Dbx*))
     *BLLH:Dbx*)
    ((not (bllh:probe-dbx-progid)) nil)
    (T
      (bllh:release-dbx-cache) ;; drop any stale/different cached database
      (setq obj (vl-catch-all-apply 'vlax-create-object (list *BLLH:DbxProgId*)))
      (if (vl-catch-all-error-p obj)
        nil
        (if (vl-catch-all-error-p (vl-catch-all-apply 'vla-Open (list obj source-path)))
          (progn (vl-catch-all-apply 'vlax-release-object (list obj)) nil)
          (progn (setq *BLLH:Dbx* obj *BLLH:DbxSourcePath* source-path) obj)))))
)

(defun bllh:find-source-document (source-path / app docs doc result target dbx)
  (setq app (vlax-get-acad-object))
  (setq docs (vla-get-Documents app))
  (setq target (strcase source-path))
  (vlax-for doc docs
    (if (= (strcase (strcat (vla-get-Path doc) "\\" (vla-get-Name doc))) target)
      (setq result doc)))
  (cond
    (result (list result nil)) ;; already open in the editor - leave it alone
    ((setq dbx (bllh:get-dbx source-path)) (list dbx :dbx))
    ;; ObjectDBX unavailable or failed - fall back to a normal, visible
    ;; document open.
    (T (list (vl-catch-all-apply 'vla-Open (list docs source-path)) T)))
)

(defun bllh:find-source-definition (source-doc source-name display-name / blocks result)
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
(defun bllh:sample-effective-name (item / value)
  ;; A dynamic block reference's Name is an unstable *U number.
  ;; EffectiveName is the stable author-defined block name.
  (setq value (vl-catch-all-apply 'vla-get-EffectiveName (list item)))
  (if (and (not (vl-catch-all-error-p value))
           (= (type value) 'STR))
    value
    nil))

(defun bllh:find-sample-in-owner (owner name effective-only / found item objname itemname effective)
  (setq found nil)
  (vlax-for item owner
    (if (not found)
      (progn
        (setq objname (vl-catch-all-apply 'vla-get-ObjectName (list item)))
        (if (and (not (vl-catch-all-error-p objname))
                 (= objname "AcDbBlockReference"))
          (progn
            (setq itemname (vl-catch-all-apply 'vla-get-Name (list item))
                  effective (bllh:sample-effective-name item))
            (if (or
                  (and effective
                       (= (strcase effective) (strcase name)))
                  (and (not effective-only)
                       (not (vl-catch-all-error-p itemname))
                       (= (strcase itemname) (strcase name))))
              (setq found item)))))))
  found)

(defun bllh:find-source-sample-by-name (doc name effective-only / result lay block is-layout is-xref scan)
  ;; Search ModelSpace, all paper layouts, and finally nested definitions.
  ;; A reference may be nested in another source block, not directly placed
  ;; in ModelSpace. No database changes occur during this search.
  (setq result
    (bllh:find-sample-in-owner
      (vla-get-ModelSpace doc) name effective-only))
  (if (not result)
    (vlax-for lay (vla-get-Layouts doc)
      (if (and (not result)
               (/= (strcase (vla-get-Name lay)) "MODEL"))
        (setq result
          (bllh:find-sample-in-owner
            (vla-get-Block lay) name effective-only)))))
  (if (not result)
    (vlax-for block (vla-get-Blocks doc)
      (if (not result)
        (progn
          (setq is-layout (vl-catch-all-apply 'vla-get-IsLayout (list block))
                is-xref (vl-catch-all-apply 'vla-get-IsXRef (list block)))
          (if (and (not (vl-catch-all-error-p is-layout))
                   (not (vl-catch-all-error-p is-xref))
                   (= is-layout :vlax-false)
                   (= is-xref :vlax-false))
            (progn
              (setq scan
                (vl-catch-all-apply 'bllh:find-sample-in-owner
                  (list block name effective-only)))
              (if (not (vl-catch-all-error-p scan))
                (setq result scan))))))))
  result)

(defun bllh:find-source-sample (doc name display / result)
  (if (= (substr name 1 1) "*")
    ;; Anonymous *U numbers are not stable: NEVER pick *U123 merely because
    ;; its current number matches. Match the intended stable EffectiveName.
    (setq result
      (bllh:find-source-sample-by-name doc display T))
    (progn
      (setq result
        (bllh:find-source-sample-by-name doc name nil))
      (if (and (not result)
               (/= (strcase name) (strcase display)))
        (setq result
          (bllh:find-source-sample-by-name doc display nil)))))
  result)

(defun bllh:copy-primary-result (raw owner before / value arr result n item typ)
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

(defun bllh:copy-source-sample (source-doc dest-doc sample point rotation / owner before sa copied result moved rotated err)
  (setq owner (vla-get-ModelSpace dest-doc)
        before (vla-get-Count owner)
        sa (vlax-make-safearray vlax-vbObject '(0 . 0)))
  (vlax-safearray-put-element sa 0 sample)
  (setq copied (vl-catch-all-apply 'vla-CopyObjects (list source-doc sa owner)))
  (setq result (bllh:copy-primary-result copied owner before))
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

(defun bllh:copy-block-def (source-doc dest-doc source-def / dest-blocks name existing sa copied verified)
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

(defun bllh:copy-and-insert-definition (source-doc dest-doc source-def point rotation / copied new-def-name inserted)
  ;; Only named source definitions are imported without a placed reference.
  ;; Never clone an anonymous *U definition as a replacement for dynamic
  ;; state; that can silently discard parameters and dependent references.
  (setq copied (bllh:copy-block-def source-doc dest-doc source-def))
  (if (not (car copied))
    copied
    (progn
      (setq new-def-name
        (vl-catch-all-apply 'vla-get-Name (list (cadr copied))))
      (if (vl-catch-all-error-p new-def-name)
        (list nil "Imported block name cannot be read.")
        (progn
          (setq inserted
            (vl-catch-all-apply 'vla-InsertBlock
              (list (vla-get-ModelSpace dest-doc)
                    (vlax-3D-point point)
                    new-def-name 1.0 1.0 1.0 rotation)))
          (if (vl-catch-all-error-p inserted)
            (list nil
              (strcat "Cannot insert imported named block: "
                      (vl-catch-all-error-message inserted)))
            (list T inserted)))))))


;; Runtime identification is by the source DWG HANDLE only. Never fall back
;; to Name, EffectiveName, anonymous *U index, or an arbitrary nearby block.
(defun bllh:resolve-handle (source-doc source-handle / obj kind)
  (setq obj (vl-catch-all-apply 'vla-HandleToObject
              (list source-doc source-handle)))
  (if (or (vl-catch-all-error-p obj) (not obj))
    (list nil (strcat "Source handle " source-handle " no longer exists. Use BLLHSET."))
    (progn
      (setq kind (vl-catch-all-apply 'vla-get-ObjectName (list obj)))
      (cond
        ((vl-catch-all-error-p kind)
          (list nil "Cannot inspect the source object type."))
        ((member kind '("AcDbBlockReference" "AcDbBlockTableRecord"))
          (list T obj))
        (T (list nil (strcat "Handle " source-handle
                 " is not a block reference or definition (" kind ")."))))))
)
(defun bllh:insert-from-library (source-path source-handle point rotation
                                / orig-doc src-info src-doc opened obj-result obj kind
                                  result activated closed)
  (setq orig-doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (if (= (strcase (vla-get-FullName orig-doc)) (strcase source-path))
    (list nil "Do not insert library blocks into the source template itself.")
    (progn
      (setq src-info (bllh:find-source-document source-path)
            src-doc (car src-info)
            opened (cadr src-info))
      (if (or (null src-doc) (vl-catch-all-error-p src-doc))
        (list nil "Cannot open the source template.")
        (progn
          (setq obj-result (bllh:resolve-handle src-doc source-handle))
          (if (car obj-result)
            (progn
              (setq obj (cadr obj-result)
                    kind (vla-get-ObjectName obj))
              (setq result
                (if (= kind "AcDbBlockReference")
                  (bllh:copy-source-sample src-doc orig-doc obj point rotation)
                  ;; AutoCAD's InsertBlock API requires the definition name
                  ;; for insertion, but identity selection remains HANDLE-only.
                  (if (= (substr (vla-get-Name obj) 1 1) "*")
                    (list nil "Anonymous definition without sample reference. Assign an INSERT handle instead.")
                    (bllh:copy-and-insert-definition
                      src-doc orig-doc obj point rotation)))))
            (setq result obj-result))
          (if (eq opened T)
            (progn
              (setq activated (vl-catch-all-apply 'vla-Activate (list orig-doc)))
              (if (not (vl-catch-all-error-p activated))
                (setq closed (vl-catch-all-apply 'vla-Close
                              (list src-doc :vlax-false))))))
          (if (and (eq opened T) (vl-catch-all-error-p activated))
            (list nil "Source document fallback changed active tab and could not restore destination.")
            result)))))
)

(defun bllh:write-dcl (/ dcl-path f)
  ;; Generate the UI in TEMP so this feature only needs one LSP file.
  (setq dcl-path (strcat (getenv "TEMP") "\\BLLH_Handle_Library.dcl"))
  (setq f (open dcl-path "w"))
  (if f
    (progn
      (write-line "bllh_main : dialog {" f)
      (write-line "  label = \"TBH HVAC Handle Library\";" f)
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

(defun bllh:group-names (/ result)
  (setq result nil)
  (foreach group *BLLH:Groups*
    (setq result (append result (list (car group)))))
  result
)

(defun bllh:display-names (items / result)
  (setq result nil)
  (foreach item items
    (setq result (append result (list (car item)))))
  result
)

(defun bllh:fill-groups ()
  (start_list "groups")
  (mapcar 'add_list (bllh:group-names))
  (end_list)
  (set_tile "groups" "0")
)

(defun bllh:fill-blocks (group-index / group items)
  (setq group (nth group-index *BLLH:Groups*))
  (setq items (cdr group))
  (start_list "blocks")
  (mapcar 'add_list (bllh:display-names items))
  (end_list)
  (set_tile "blocks" "0")
  (set_tile "status"
    (strcat (car group) " - " (itoa (length items)) " block(s)"))
)


(defun bllh:insert-selected (group-index block-index / group item label source handle point result ent)
  (setq group (nth group-index *BLLH:Groups*)
        item (nth block-index (cdr group))
        label (car item)
        source (bllh:source-path))
  (cond
    ((not source) (alert "Source template not configured."))
    (T
      (bllh:map-load source)
      (setq handle (bllh:map-get (car group) label))
      (cond
        ((not handle)
          (alert (strcat "No SOURCE HANDLE mapped for " (car group) " / " label
                         ".\nRun BLLHINIT once; use BLLHSET for missing entries.")))
        ((not (setq point (getpoint (strcat "\nInsertion point for " label ": "))))
          (princ "\nCancelled."))
        (T
          (setq result
            (vl-catch-all-apply 'bllh:insert-from-library
              (list source handle (trans point 1 0) 0.0)))
          (if (vl-catch-all-error-p result)
            (setq result (list nil (vl-catch-all-error-message result))))
          (if (not (car result))
            (alert (strcat "BLLH insertion failed:\n" (cadr result)))
            (progn
              (setq ent (vlax-vla-object->ename (cadr result)))
              (command "_.rotate" ent "" point pause)
              (princ (strcat "\n[BLLH] Inserted: " label
                             " (source handle " handle ")"))))))))
  (princ)
)

;; One-time migration from original BLL. Legacy names are used ONLY here to
;; resolve and record stable source handles. Runtime BLLH never searches names.
(defun c:BLLHINIT (/ source info doc opened grp item obj def handle count skipped
                     dest activated)
  (setq source (bllh:source-path))
  (if (not source)
    (princ "\n[BLLH] Source template not found.")
    (progn
      (bllh:map-load source)
      (setq dest (vla-get-ActiveDocument (vlax-get-acad-object))
            info (bllh:find-source-document source)
            doc (car info) opened (cadr info)
            count 0 skipped 0)
      (if (or (not doc) (vl-catch-all-error-p doc))
        (princ "\n[BLLH] Cannot open source template.")
        (progn
          (foreach grp *BLLH:Groups*
            (foreach item (cdr grp)
              (if (not (bllh:map-get (car grp) (car item)))
                (progn
                  (setq obj (bllh:find-source-sample doc (cadr item) (car item)))
                  (if (and (not obj) (/= (substr (cadr item) 1 1) "*"))
                    (setq obj (bllh:find-source-definition
                                doc (cadr item) (car item))))
                  (setq handle
                    (if obj (vl-catch-all-apply 'vla-get-Handle (list obj)) nil))
                  (if (and handle (not (vl-catch-all-error-p handle))
                           (bllh:handle-valid handle))
                    (progn
                      (bllh:map-put (car grp) (car item) handle)
                      (setq count (1+ count)))
                    (progn
                      (setq skipped (1+ skipped))
                      (princ (strcat "\n[BLLH] Unresolved: "
                        (car grp) " / " (car item) " — assign via BLLHSET."))))))))
          (if (eq opened T)
            (progn
              (setq activated (vl-catch-all-apply 'vla-Activate (list dest)))
              (if (not (vl-catch-all-error-p activated))
                (vl-catch-all-apply 'vla-Close (list doc :vlax-false)))))
          (if (bllh:map-save source)
            (princ (strcat "\n[BLLH] Stored " (itoa count) " new handles, "
                           (itoa skipped) " unresolved; file: " (bllh:map-file)))
            (princ "\n[BLLH] Unable to save handle map."))))))
  (princ)
)

;; Assign a missing/replaced block by selecting a SOURCE block reference.
;; Open FDM TEMPLATE.dwg in AutoCAD, run BLLHSET, pick its group/entry
;; and click the actual template INSERT once. No block name inspection.
(defun c:BLLHSET (/ source doc grpidx entryidx grp item pick data handle)
  (setq source (bllh:source-path)
        doc (vla-get-ActiveDocument (vlax-get-acad-object)))
  (if (or (not source)
          (/= (strcase (vla-get-FullName doc)) (strcase source)))
    (princ "\n[BLLH] First OPEN the configured FDM TEMPLATE.dwg in AutoCAD, then BLLHSET.")
    (progn
      (bllh:map-load source)
      (princ "\n[BLLH] Groups:")
      (setq grpidx 0)
      (foreach grp *BLLH:Groups*
        (princ (strcat "\n  " (itoa (1+ grpidx)) ": " (car grp)))
        (setq grpidx (1+ grpidx)))
      (setq grpidx (getint "\nGroup number: "))
      (if (and grpidx (> grpidx 0) (<= grpidx (length *BLLH:Groups*)))
        (progn
          (setq grp (nth (1- grpidx) *BLLH:Groups*) entryidx 0)
          (foreach item (cdr grp)
            (princ (strcat "\n  " (itoa (1+ entryidx)) ": " (car item)))
            (setq entryidx (1+ entryidx)))
          (setq entryidx (getint "\nBlock number: "))
          (if (and entryidx (> entryidx 0) (<= entryidx (length (cdr grp))))
            (progn
              (setq pick (car (entsel "\nSelect source BLOCK REFERENCE: ")))
              (setq data (if pick (entget pick) nil))
              (if (= (cdr (assoc 0 data)) "INSERT")
                (progn
                  (setq handle (cdr (assoc 5 data))
                        item (nth (1- entryidx) (cdr grp)))
                  (if (and (bllh:map-put (car grp) (car item) handle)
                           (bllh:map-save source))
                    (princ (strcat "\n[BLLH] " (car grp) " / " (car item)
                                   " => handle " handle " saved."))
                    (princ "\n[BLLH] Could not save handle mapping.")))
                (princ "\n[BLLH] Selected entity is not a block INSERT."))))))))
  (princ)
)

(defun c:BLL (/ dcl-path dcl-id dialog-result group-index block-index)
  (setq dcl-path (bllh:write-dcl))
  (if (not dcl-path)
    (alert "Cannot create the temporary dialog file.")
    (progn
      (setq dcl-id (load_dialog dcl-path))
      (if (< dcl-id 0)
        (alert "Cannot load the block library dialog.")
        (progn
          (if (new_dialog "bllh_main" dcl-id)
            (progn
              (setq group-index 0 block-index 0)
              (bllh:fill-groups)
              (bllh:fill-blocks 0)
              (action_tile "groups"
                "(progn (setq group-index (atoi $value) block-index 0) (bllh:fill-blocks group-index))")
              (action_tile "blocks"
                "(setq block-index (atoi $value))")
              (action_tile "insert"
                "(done_dialog 1)")
              (action_tile "cancel"
                "(done_dialog 0)")
              (setq dialog-result (start_dialog))
              (unload_dialog dcl-id)
              (if (= dialog-result 1)
                (bllh:insert-selected group-index block-index)))
            (unload_dialog dcl-id))))))
  (princ)
)

(defun c:BLLRELOAD ()
  ;; Drop the cached source database so the next BLLH insert re-reads
  ;; FDM TEMPLATE.dwg from disk - use after editing that file mid-session.
  (bllh:release-dbx-cache)
  (setq *BLLH:MapLoaded* nil)
  (princ "\n[TBH] Block library cache cleared - next insert will reload the source drawing.")
  (princ)
)

;; Generate/load handle table during APPLOAD: user only runs BLL.
;; Never interrupt CAD LISP loading with a source-file picker.
(princ "\n[BLLH] Building source handle table...")
(setq *BLLH:Autoloading* T)
(setq *BLLH:AutoInitResult* (vl-catch-all-apply 'c:BLLHINIT '()))
(setq *BLLH:Autoloading* nil)
(if (vl-catch-all-error-p *BLLH:AutoInitResult*)
  (princ (strcat "\n[BLLH] Auto-map failed: "
                 (vl-catch-all-error-message *BLLH:AutoInitResult*)))
  (if *BLLH:HandleMap*
    (princ (strcat "\n[BLLH] Ready: "
                   (itoa (length *BLLH:HandleMap*))
                   " handles mapped. Type BLL to insert."))
    (princ "\n[BLLH] Source not available / no handles mapped; BLL will request the source.")))
(princ)
