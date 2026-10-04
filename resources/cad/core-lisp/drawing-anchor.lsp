; CadGPT core-private Drawing Anchor adapter.
; Not a registered Lisp capability. Loaded only by CadGPT drawing persistence.

(vl-load-com)

(setq *cadgpt-anchor-dictionary-key* "CADGPT_PERSISTENCE")
(setq *cadgpt-anchor-xrecord-key* "CADGPT_DRAWING_ANCHOR")

(defun cadgpt-anchor--payload (xrec / data schema anchor)
  (setq data (entget xrec))
  (setq schema (cdr (assoc 90 data)))
  (setq anchor (cdr (assoc 1 data)))
  (if (or (/= schema 1) (null anchor) (= anchor ""))
    (error "CADGPT_DRAWING_ANCHOR exists but its V1 payload is invalid")
  )
  (list schema anchor)
)

(defun cadgpt-anchor--read-from-dict (dictEname / found)
  (setq found (dictsearch dictEname *cadgpt-anchor-xrecord-key*))
  (if found
    (cadgpt-anchor--payload (cdr (assoc -1 found)))
    nil
  )
)

(defun cadgpt-anchor--canonical-dict-read (/ found)
  (setq found (dictsearch (namedobjdict) *cadgpt-anchor-dictionary-key*))
  (if found (cdr (assoc -1 found)) nil)
)

(defun cadgpt-anchor--canonical-dict-ensure (/ existing newdict added)
  (setq existing (cadgpt-anchor--canonical-dict-read))
  (if existing
    existing
    (progn
      ; 280=1: entries of this dictionary are hard-owned.
      ; 281=1: duplicate-record clone policy keeps the existing entry.
      (setq newdict
        (entmakex
          '(
            (0 . "DICTIONARY")
            (100 . "AcDbDictionary")
            (280 . 1)
            (281 . 1)
          )
        )
      )
      (if (null newdict)
        (error "Could not create CADGPT_PERSISTENCE dictionary")
      )
      (setq added
        (dictadd (namedobjdict) *cadgpt-anchor-dictionary-key* newdict)
      )
      (if (null added)
        (progn
          (entdel newdict)
          (error "Could not attach CADGPT_PERSISTENCE dictionary to NOD")
        )
      )
      added
    )
  )
)

(defun cadgpt-anchor--legacy-extension-read (/ nodObj extObj extEname)
  ; Migration-only reader for the previous NOD extension-dictionary layout.
  ; HasExtensionDictionary is checked first so reading never creates one.
  (setq nodObj (vlax-ename->vla-object (namedobjdict)))
  (if (= :vlax-true (vla-get-HasExtensionDictionary nodObj))
    (progn
      (setq extObj (vla-GetExtensionDictionary nodObj))
      (setq extEname (vlax-vla-object->ename extObj))
      (cadgpt-anchor--read-from-dict extEname)
    )
    nil
  )
)

(defun cadgpt-anchor--legacy-direct-nod-read (/ found)
  ; Compatibility reader for any direct-NOD XRecord created during development.
  (setq found (dictsearch (namedobjdict) *cadgpt-anchor-xrecord-key*))
  (if found
    (cadgpt-anchor--payload (cdr (assoc -1 found)))
    nil
  )
)

(defun cadgpt-anchor--read-any (/ dict payload)
  (setq dict (cadgpt-anchor--canonical-dict-read))
  (if dict
    (setq payload (cadgpt-anchor--read-from-dict dict))
  )
  (if payload
    (list "canonical" payload)
    (progn
      (setq payload (cadgpt-anchor--legacy-extension-read))
      (if payload
        (list "legacy" payload)
        (progn
          (setq payload (cadgpt-anchor--legacy-direct-nod-read))
          (if payload (list "legacy" payload) nil)
        )
      )
    )
  )
)

(defun cadgpt-anchor--create (dictEname anchor / xrec added)
  (if (or (null anchor) (= anchor ""))
    (error "drawing_anchor is required")
  )
  (setq xrec
    (entmakex
      (list
        '(0 . "XRECORD")
        '(100 . "AcDbXrecord")
        '(280 . 1)
        (cons 90 1)
        (cons 1 anchor)
      )
    )
  )
  (if (null xrec)
    (error "Could not create Drawing Anchor XRecord")
  )
  (setq added (dictadd dictEname *cadgpt-anchor-xrecord-key* xrec))
  (if (null added)
    (progn
      (entdel xrec)
      (error "Could not attach Drawing Anchor XRecord")
    )
  )
  added
)

(defun cadgpt-anchor--format-result (payload state)
  (strcat
    (itoa (car payload))
    "|"
    (cadr payload)
    "|"
    state
  )
)

(defun cadgpt-drawing-anchor-read (/ found source payload)
  ; Read-only probe. Never creates or rewrites the anchor.
  (setq found (cadgpt-anchor--read-any))
  (if found
    (progn
      (setq source (car found))
      (setq payload (cadr found))
      (cadgpt-anchor--format-result
        payload
        (if (= source "canonical") "existing" "legacy")
      )
    )
    "MISSING"
  )
)

(defun cadgpt-drawing-anchor-ensure (preferred / found source payload dict)
  ; Write-once contract:
  ; - canonical anchor exists -> read-only return
  ; - legacy anchor exists -> migrate the SAME value once
  ; - no anchor exists -> create once from preferred
  (setq found (cadgpt-anchor--read-any))
  (if found
    (progn
      (setq source (car found))
      (setq payload (cadr found))
      (if (= source "canonical")
        (cadgpt-anchor--format-result payload "existing")
        (progn
          (setq dict (cadgpt-anchor--canonical-dict-ensure))
          (if (null (cadgpt-anchor--read-from-dict dict))
            (cadgpt-anchor--create dict (cadr payload))
          )
          (setq payload (cadgpt-anchor--read-from-dict dict))
          (if (null payload)
            (error "Drawing Anchor migration read-back failed")
          )
          (cadgpt-anchor--format-result payload "migrated")
        )
      )
    )
    (progn
      (setq dict (cadgpt-anchor--canonical-dict-ensure))
      (cadgpt-anchor--create dict preferred)
      (setq payload (cadgpt-anchor--read-from-dict dict))
      (if (null payload)
        (error "Drawing Anchor read-back failed after creation")
      )
      (cadgpt-anchor--format-result payload "created")
    )
  )
)

(princ)
