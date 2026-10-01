;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : TBH_Manager.lsp
;;; Module      : Core
;;; Command     : cmd, TBH, LBTBH, LDD
;;; Description : Core dialog and command mapping UI for the TBH Tool Kit.
;;;
;;; 
;;; Usage       :
;;; 1. Type 'TBH' to launch the dialog.
;;; 2. Navigate tabs (Draw, Annotation, etc.).
;;; 3. Click buttons to launch respective tools.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── PORTABLE DIRECTORY DETECTION ───

(defun tbh:get-basedir (/)
  "C:\\Autocad Tool\\TBH Tool Kit"
)

(setq *TBH:BaseDir* (tbh:get-basedir))
(princ (strcat "\n[TBH] Using BaseDir: " *TBH:BaseDir*))
(setq *TBH:ConfigFile* (strcat *TBH:BaseDir* "\\TBH_Descriptions.cfg"))
(setq *TBH:DclFile* (strcat *TBH:BaseDir* "\\TBH_Manager.dcl"))

(setq *TBH:Tabs*    nil)
(setq *TBH:CfgData* nil)



;; ─── PATH RESOLVER ───

(defun tbh:abs-path (relpath)
  (strcat *TBH:BaseDir* "\\" relpath)
)

(defun tbh:resolve (relpath)
  ;; Use relative paths per user request (AutoCAD will use Support Search Paths)
  (vl-string-translate "\\" "/" relpath)
)

;; ─── STRING HELPERS ───

(defun tbh:trim (s)
  (if (and s (> (strlen s) 0))
    (progn
      (while (and (> (strlen s) 0) (member (setq c (substr s 1 1)) '(" " "\t" "\r" "\n")))
        (setq s (substr s 2)))
      (while (and (> (strlen s) 0) (member (setq c (substr s (strlen s) 1)) '(" " "\t" "\r" "\n")))
        (setq s (substr s 1 (1- (strlen s)))))
      s)
    ""))

(defun tbh:pad (s w / n)
  (setq n (max 0 (- w (strlen s))))
  (while (> n 0) (setq s (strcat s " ") n (1- n)))
  s)

(defun tbh:cut (s maxlen)
  (if (and s (> (strlen s) maxlen))
    (strcat (substr s 1 (1- maxlen)) "~")
    (if s s "")))

;; ─── CONFIG MANAGEMENT ───

(defun tbh:cfg-load (/ f ln ep k v)
  (setq *TBH:CfgData* nil)
  (if (findfile *TBH:ConfigFile*)
    (progn
      (setq f (open *TBH:ConfigFile* "r"))
      (while (setq ln (read-line f))
        (setq ln (tbh:trim ln))
        (if (and (> (strlen ln) 2)
                 (/= (substr ln 1 1) ";")
                 (setq ep (vl-string-search "=" ln)))
          (progn
            (setq k (tbh:trim (substr ln 1 ep)))
            (setq v (tbh:trim (substr ln (+ 1 ep))))
            (if (> (strlen k) 0)
              (setq *TBH:CfgData*
                (cons (cons k v) *TBH:CfgData*))))))
      (close f))))

(defun tbh:cfg-get (key)
  (cdr (assoc key *TBH:CfgData*)))

(defun tbh:cfg-set (key val / rest f)
  (setq rest
    (vl-remove-if (function (lambda (p) (= (car p) key)))
                  *TBH:CfgData*))
  (setq *TBH:CfgData* (cons (cons key val) rest))
  (setq f (open *TBH:ConfigFile* "w"))
  (write-line "; TBH Manager Config" f)
  (write-line "; Folder|File=Short description" f)
  (write-line "; Folder|File|DETAIL=Line1||Line2||Line3" f)
  (foreach p *TBH:CfgData*
    (write-line (strcat (car p) "=" (cdr p)) f))
  (close f))

;; ─── DETAIL HANDLING ───

(defun tbh:split-detail (s / pos result part)
  (setq result nil)
  (while (setq pos (vl-string-search "||" s))
    (setq part (substr s 1 pos))
    (setq result (append result (list part)))
    (setq s (substr s (+ pos 3))))
  (setq result (append result (list s)))
  result)

(defun tbh:join-detail (lst / r)
  (setq r "")
  (foreach s lst
    (if (= r "") (setq r s) (setq r (strcat r "||" s))))
  r)

;; ─── LISP FILE PARSER (TBH-HEADER-START Support) ───

(defun tbh:parse-file (relpath / f ln s up short detail n reading-detail is-std-header fpath sep-pos)
  (setq fpath (tbh:abs-path relpath))
  (setq short "" detail nil n 0 reading-detail nil is-std-header nil)
  (if (setq f (open fpath "r"))
    (progn
      (while (and (setq ln (read-line f)) (< n 80))
        (setq n (1+ n))
        (setq s (tbh:trim ln))
        (setq up (strcase s))
        
        ;; Detect Standard Header
        (if (vl-string-search "TBH-HEADER-START" up) (setq is-std-header T))

        ;; Process Comments
        (if (and (>= (strlen s) 2) (= (substr s 1 1) ";"))
          (progn
            ;; Extract content after semicolons
            (while (and (> (strlen s) 0) (= (substr s 1 1) ";")) (setq s (substr s 2)))
            (setq s (tbh:trim s))
            (setq up (strcase s))
            
            (cond
              ;; Metadata (Short Description)
              ((and (or (vl-string-search "MO TA" up)
                        (vl-string-search "DESCRIPTION" up)
                        (vl-string-search "CHUC NANG" up))
                    (setq sep-pos (vl-string-search ":" s)))
               (setq short (tbh:trim (substr s (+ 2 sep-pos))))
               (setq reading-detail nil))
              
              ;; Detail Section Start
              ((or (vl-string-search "CHI TIET" up)
                   (vl-string-search "HUONG DAN" up)
                   (vl-string-search "USAGE" up)
                   (vl-string-search "HOW TO" up))
               (setq reading-detail T))
              
              ;; Stop or Separator
              ((or (vl-string-search "====" s) (vl-string-search "----" s))
               (setq reading-detail nil))

              ;; Read Detail Lines
              ((and reading-detail (> (strlen s) 0))
               (setq detail (append detail (list s))))
              
              ;; Fallback for loose headers (non-std)
              ((and (not is-std-header) (= short "") (not reading-detail) (> (strlen s) 0)
                    (not (vl-string-search "FILE" up))
                    (not (vl-string-search "AUTHOR" up))
                    (not (vl-string-search "VERSION" up)))
               (setq short s))
            )
          )
        )
      )
      (close f)))
  (list short detail))

(defun tbh:get-short (tab relpath fname / ov parsed)
  ;; Prioritize parsed metadata if it exists, otherwise check config
  (setq parsed (tbh:parse-file relpath))
  (setq short (car parsed))
  (if (and short (/= short ""))
    short
    (progn
      (setq ov (tbh:cfg-get (strcat tab "|" fname)))
      (if (and ov (/= ov "")) ov (strcat "Load " fname)))))

(defun tbh:get-detail (tab relpath fname / ov-raw parsed)
  (setq parsed (tbh:parse-file relpath))
  (setq detail (cadr parsed))
  (if (and detail (> (length detail) 0))
    detail
    (progn
      (setq ov-raw (tbh:cfg-get (strcat tab "|" fname "|DETAIL")))
      (if (and ov-raw (/= ov-raw ""))
        (tbh:split-detail ov-raw)
        nil))))

(defun tbh:get-header-lines (relpath / f ln s n reading found lines fpath)
  (setq fpath (tbh:abs-path relpath))
  (setq n 0 reading nil found nil lines nil)
  (if (setq f (open fpath "r"))
    (progn
      (while (and (setq ln (read-line f)) (< n 120) (not (and found (not reading))))
        (setq n (1+ n))
        (setq s (tbh:trim ln))
        (cond
          ((vl-string-search "TBH-HEADER-START" (strcase s))
            (setq reading T found T))
          ((and reading (vl-string-search "TBH-HEADER-END" (strcase s)))
            (setq reading nil))
          (reading
            (while (and (> (strlen s) 0) (= (substr s 1 1) ";"))
              (setq s (substr s 2)))
            (setq s (tbh:trim s))
            (if (> (strlen s) 0)
              (setq lines (append lines (list s)))))))
      (close f)))
  lines)

(defun tbh:get-commands (relpath / f ln up pos rest cmd cmds i fpath)
  (setq fpath (tbh:abs-path relpath))
  (setq cmds nil)
  (if (setq f (open fpath "r"))
    (progn
      (while (setq ln (read-line f))
        (setq up (strcase (tbh:trim ln)))
        ;; Improved detection to handle (defun c:cmd or (defun c: cmd
        (if (setq pos (vl-string-search "(DEFUN C:" up))
          (progn
            (setq rest (tbh:trim (substr up (+ pos 10))))
            (if (= (substr rest 1 1) ":") (setq rest (tbh:trim (substr rest 2))))
            (setq cmd "" i 1)
            (while (and (<= i (strlen rest))
                        (not (member (substr rest i 1)
                                '(" " "(" "/" "\t" ")"))))
              (setq cmd (strcat cmd (substr rest i 1)))
              (setq i (1+ i)))
            (if (and (> (strlen cmd) 0) (not (member cmd cmds)))
              (setq cmds (append cmds (list cmd)))))))
      (close f)))
  cmds)

;; ─── FOLDER SCANNER ───
;; Each file entry: (fname relpath short abs-folder)
;; abs-folder = absolute path of the directory containing the .lsp file.
;; Used by the Open Folder button to open the correct location.

(defun tbh:scan (/ dirs tab flist f fname relpath short _scan-dir)
  (setq *TBH:Tabs* nil)

  ;; Recursive helper — 4th element is abs-folder for Open Folder
  (defun _scan-dir (dir root-tab-name / subfiles subitems)
    (setq subitems nil)
    (setq subfiles (vl-directory-files dir nil 1))
    (foreach f subfiles
      (if (= (strcase (vl-filename-extension f)) ".LSP")
        (progn
          (setq fname   (vl-filename-base f))
          (setq relpath (substr (strcat dir "\\" f) (1+ (strlen *TBH:BaseDir*))))
          (if (= (substr relpath 1 1) "\\") (setq relpath (substr relpath 2)))
          (setq short   (tbh:get-short root-tab-name relpath fname))
          (setq subitems (append subitems (list (list fname relpath short dir)))))))
    ;; Recurse into subfolders
    (foreach d (vl-directory-files dir nil -1)
      (if (and (/= d ".") (/= d ".."))
        (setq subitems (append subitems (_scan-dir (strcat dir "\\" d) root-tab-name)))))
    subitems)

  ;; ── Root-level .lsp files (directly inside BaseDir) ──
  (setq flist nil)
  (foreach f (vl-directory-files *TBH:BaseDir* nil 1)
    (if (= (strcase (vl-filename-extension f)) ".LSP")
      (progn
        (setq fname   (vl-filename-base f))
        (setq relpath f)
        (setq short   (tbh:get-short "(Root)" relpath fname))
        (setq flist (append flist (list (list fname relpath short *TBH:BaseDir*)))))))
  (if flist
    (setq *TBH:Tabs* (append *TBH:Tabs* (list (cons "(Root)" flist)))))

  ;; ── Subfolder tabs ──
  (setq dirs (vl-directory-files *TBH:BaseDir* nil -1))
  (foreach tab (vl-sort dirs '<)
    (if (and (/= tab ".") (/= tab "..")
             (not (member (strcase tab) '(".GIT" "AI" "TEMP" "TMP"))))
      (progn
        (setq flist (_scan-dir (strcat *TBH:BaseDir* "\\" tab) tab))
        (if flist
          (setq *TBH:Tabs*
            (append *TBH:Tabs* (list (cons tab flist)))))))))

(defun tbh:disp-list (items / result it)
  (setq result nil)
  (foreach it items
    (setq result
      (append result
        (list
          (strcat (tbh:pad (car it) 24) ;; Increased padding
                  " | "
                  (tbh:cut (caddr it) 50)))))) ;; Increased desc column to 50
  result)

(defun tbh:rplnth (idx lst new / i r)
  (setq i 0 r nil)
  (foreach x lst
    (setq r (append r (list (if (= i idx) new x))))
    (setq i (1+ i)))
  r)

;; ─── LOAD & RUN ───

(defun tbh:load-file (relpath / res fpath)
  ;; Build absolute path then normalize slashes for AutoCAD load
  (setq fpath (tbh:abs-path relpath))
  (setq fpath (tbh:resolve fpath))
  (setq res (vl-catch-all-apply 'load (list fpath)))
  (if (vl-catch-all-error-p res)
    (progn
      (princ (strcat "\n[TBH] ERROR: " (vl-catch-all-error-message res)))
      nil)
    T))

(defun tbh:run (relpath fname)
  (princ (strcat "\n[TBH] Loading: " fname " ..."))
  (if (tbh:load-file relpath)
    (princ (strcat "\n[TBH] Load OK: " fname))
    (princ (strcat "\n[TBH] Load FAILED: " (tbh:resolve (tbh:abs-path relpath))))))

;; ─── DCL GENERATOR ───

(defun tbh:write-dcl (tab-list / f i)
  (setq f (open *TBH:DclFile* "w"))
  (write-line "// TBH_Manager.dcl (auto-generated)" f)
  (write-line "tbh_main : dialog {" f)
  (write-line "  label = \"TBH Tool Box Hub  |  Systematic LSP Manager\";" f)
  (write-line "  width = 130;" f)
  (write-line "  : column {" f)
  (write-line "    : row {" f)
  (setq i 1)
  (foreach tab tab-list
    (write-line (strcat "      : button { key=\"tb" (itoa i) "\"; label=\" " tab " \"; width=14; }") f)
    (if (= (rem i 8) 0) (progn (write-line "    } : row {" f))) ;; Multi-row tabs if > 8
    (setq i (1+ i)))
  (write-line "      spacer;" f)
  (write-line "      : button { key=\"btn_refresh\"; label=\" Refresh \"; width=12; }" f)
  (write-line "    }" f)
  (write-line "    : text { key=\"lbl_tab\"; label=\"\"; alignment=left; }" f)
  (write-line "    spacer_1;" f)
  (write-line "    : row {" f)
  (write-line "      : text { label=\" COMMAND LIST (Title | Description)\"; width = 54; alignment=left; }" f)
  (write-line "      : text { key=\"lbl_panel_file\"; label=\" TOOL INFORMATION\"; width=72; alignment=left; }" f)
  (write-line "    }" f)
  (write-line "    : row {" f)
  (write-line "      : list_box { key = \"lst_cmds\"; width = 54; height = 22; multiple_select = false; fixed_width = true; }" f)
  (write-line "      : list_box { key = \"lst_detail\"; width = 72; height = 22; multiple_select = false; fixed_width = true; }" f)
  (write-line "    }" f)
  (write-line "    spacer_1;" f)
  (write-line "    : row {" f)
  (write-line "      : button { key=\"btn_run\"; label=\" Run / Load Tool \"; width=18; is_default=true; }" f)
  (write-line "      spacer_1;" f)
  (write-line "      : button { key=\"btn_edit_desc\"; label=\" Edit Desc \"; width=14; }" f)
  (write-line "      : button { key=\"btn_edit_detail\"; label=\" Edit Detail \"; width=15; }" f)
  (write-line "      spacer_1;" f)
  (write-line "      : button { key=\"btn_open\"; label=\" Open Folder \"; width=18; }" f)
  (write-line "      spacer;" f)
  (write-line "      : button { key=\"btn_close\"; label=\" Close \"; width=12; is_cancel=true; }" f)
  (write-line "    }" f)
  (write-line "    spacer_0;" f)
  (write-line "    : text { key=\"lbl_status\"; label=\"Ready. Select a tool to begin.\"; alignment=left; }" f)
  (write-line "  }" f)
  (write-line "}" f)
  (write-line "" f)
  (write-line "tbh_edit_desc : dialog {" f)
  (write-line "  label = \"Edit Short Description\";" f)
  (write-line "  width = 56;" f)
  (write-line "  : column {" f)
  (write-line "    : text { key=\"ped_fname\"; label=\"\"; width=54; alignment=left; }" f)
  (write-line "    spacer_0;" f)
  (write-line "    : text { label=\"Short description:\"; }" f)
  (write-line "    : edit_box { key=\"ped_value\"; width=54; edit_width=54; }" f)
  (write-line "    spacer;" f)
  (write-line "    : row {" f)
  (write-line "      : button { key=\"ped_ok\"; label=\" Save \"; width=12; is_default=true; }" f)
  (write-line "      spacer;" f)
  (write-line "      : button { key=\"ped_cancel\"; label=\" Cancel \"; width=12; is_cancel=true; }" f)
  (write-line "    }" f)
  (write-line "  }" f)
  (write-line "}" f)
  (write-line "" f)
  (write-line "tbh_edit_detail : dialog {" f)
  (write-line "  label = \"Edit Tool Detail\";" f)
  (write-line "  width = 60;" f)
  (write-line "  : column {" f)
  (write-line "    : text { key=\"pdt_fname\"; label=\"\"; width=58; alignment=left; }" f)
  (write-line "    spacer_0;" f)
  (write-line "    : text { label=\"Detail lines (max 8):\"; }" f)
  (write-line "    : edit_box { key=\"pdt_line1\"; label=\"L1:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line2\"; label=\"L2:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line3\"; label=\"L3:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line4\"; label=\"L4:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line5\"; label=\"L5:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line6\"; label=\"L6:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line7\"; label=\"L7:\"; width=55; edit_width=48; }" f)
  (write-line "    : edit_box { key=\"pdt_line8\"; label=\"L8:\"; width=55; edit_width=48; }" f)
  (write-line "    spacer;" f)
  (write-line "    : row {" f)
  (write-line "      : button { key=\"pdt_ok\"; label=\" Save \"; width=12; is_default=true; }" f)
  (write-line "      spacer;" f)
  (write-line "      : button { key=\"pdt_cancel\"; label=\" Cancel \"; width=12; is_cancel=true; }" f)
  (write-line "    }" f)
  (write-line "  }" f)
  (write-line "}" f)
  (close f))

;; ─── MAIN COMMAND ───

(defun c:TBH (/ did cur-tab cur-idx cur-files cur-folder disp tab-names sel relpath fname res i _tab _show-tab _fill-list _fill-detail _edit-desc _edit-detail)

  (tbh:cfg-load)
  (tbh:scan)

  (if (not *TBH:Tabs*)
    (progn (alert (strcat "TBH: No modules found in: " *TBH:BaseDir*)) (exit)))

  (setq tab-names (mapcar 'car *TBH:Tabs*))
  (tbh:write-dcl tab-names)

  (setq did (load_dialog *TBH:DclFile*))
  (if (< did 0) (progn (alert "TBH: Failed to load DCL.") (exit)))
  (if (not (new_dialog "tbh_main" did)) (progn (unload_dialog did) (exit)))

  (setq cur-tab 0 cur-idx -1 cur-folder *TBH:BaseDir*)

  (defun _show-tab ()
    (set_tile "lbl_tab" 
        (strcat "  [ " (car (nth cur-tab *TBH:Tabs*)) " ]  -  " 
              (itoa (length (cdr (nth cur-tab *TBH:Tabs*)))) " file(s) found")))

  (defun _fill-list ()
    (setq cur-files  (cdr (nth cur-tab *TBH:Tabs*)))
    ;; Default Open Folder = the tab's root dir (first file's folder, or BaseDir)
    (setq cur-folder
      (if (and cur-files (cadddr (car cur-files)))
        (cadddr (car cur-files))
        *TBH:BaseDir*))
    (setq disp (tbh:disp-list cur-files))
    (start_list "lst_cmds") (mapcar 'add_list disp) (end_list)
    (set_tile "lst_cmds" "") (set_tile "lbl_panel_file" " TOOL INFORMATION")
    (start_list "lst_detail")
    (add_list "   --- Select a tool from the list ---")
    (end_list)
    (_show-tab) (setq cur-idx -1))

  (defun _fill-detail (idx / fname relpath absFolder lines)
    (if (and cur-files (>= idx 0) (< idx (length cur-files)))
      (progn
        (setq sel       (nth idx cur-files)
              fname     (car   sel)
              relpath   (cadr  sel)
              absFolder (cadddr sel))

        ;; Update cur-folder so Open Folder button opens the right place
        (setq cur-folder (if absFolder absFolder *TBH:BaseDir*))

        (setq lines (tbh:get-header-lines relpath))

        (set_tile "lbl_panel_file" (strcat " " (strcase fname)))

        (start_list "lst_detail")
        (if (and lines (> (length lines) 0))
          (mapcar 'add_list (mapcar '(lambda (l) (strcat "   " l)) lines))
          (add_list "   No TBH header found."))
        (end_list))))

  (_fill-list)

  (setq i 1)
  (foreach tab tab-names
    (action_tile (strcat "tb" (itoa i)) (strcat "(setq cur-tab " (itoa (1- i)) ") (_fill-list)"))
    (setq i (1+ i)))

  (action_tile "lst_cmds" "(progn (setq cur-idx (atoi $value)) (_fill-detail cur-idx) (if (= $reason 2) (done_dialog 1)))")
  (action_tile "btn_run" "(if (>= cur-idx 0) (done_dialog 1) (set_tile \"lbl_status\" \"Error: Select a tool first!\"))")
  (action_tile "btn_edit_desc" "(_edit-desc)")
  (action_tile "btn_edit_detail" "(_edit-detail)")
  (action_tile "btn_refresh" "(progn (tbh:cfg-load) (tbh:scan) (setq cur-tab 0) (_fill-list) (set_tile \"lbl_status\" \"Suite refreshed.\"))")
  ;; Open Folder: opens cur-folder (= folder of selected file, or tab root if none selected)
  (action_tile "btn_open" "(startapp \"explorer\" (strcat \"\\\"\" cur-folder \"\\\"\"))")
  (action_tile "btn_close" "(done_dialog 0)")

  (setq res (start_dialog))
  (unload_dialog did)

  (if (and (= res 1) (>= cur-idx 0))
    (tbh:run (cadr (nth cur-idx cur-files)) (car (nth cur-idx cur-files))))
  (princ))

(defun c:LBTBH () (c:TBH))

(defun c:LDD (/ tab-draw files)
  (princ "\n[TBH] Batch loading all DRAW modules for testing...")
  (if (not *TBH:CfgData*) (tbh:cfg-load))
  (tbh:scan)
  (setq tab-draw (assoc "Draw" *TBH:Tabs*))
  (if (not tab-draw) (setq tab-draw (assoc "DRAW" *TBH:Tabs*)))
  (if tab-draw
    (progn
      (setq files (cdr tab-draw))
      (foreach f files
        (vl-catch-all-apply 'load (list (tbh:abs-path (cadr f)))))
      (princ (strcat "\n[TBH] " (itoa (length files)) " tool files loaded from Draw folder.")))
    (princ "\n[TBH] Error: 'Draw' folder not found."))
  (princ))


(princ "\n[TBH] Tool Box Hub Manager loaded. Type 'TBH' to open GUI.")
(princ)
