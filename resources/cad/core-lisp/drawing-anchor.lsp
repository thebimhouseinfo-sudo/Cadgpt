; CadGPT core-private Drawing Anchor adapter.
; Not a registered Lisp capability. Loaded only by CadGPT drawing persistence.

(vl-load-com)

(defun cadgpt-anchor--extension-dict (/ nodObj extObj)
  (setq nodObj (vlax-ename->vla-object (namedobjdict)))
  ; Autodesk GetExtensionDictionary creates the extension dictionary when absent.
  (setq extObj (vla-GetExtensionDictionary nodObj))
  (vlax-vla-object->ename extObj)
)

(defun cadgpt-anchor--read (dictEname / found xrec data schema anchor)
  (setq found (dictsearch dictEname "CADGPT_DRAWING_ANCHOR"))
  (if found
    (progn
      (setq xrec (cdr (assoc -1 found)))
      (setq data (entget xrec))
      (setq schema (cdr (assoc 90 data)))
      (setq anchor (cdr (assoc 1 data)))
      (if (or (/= schema 1) (null anchor) (= anchor ""))
        (error "CADGPT_DRAWING_ANCHOR exists but its V1 payload is invalid")
      )
      (list schema anchor)
    )
    nil
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
  (setq added (dictadd dictEname "CADGPT_DRAWING_ANCHOR" xrec))
  (if (null added)
    (progn
      (entdel xrec)
      (error "Could not attach Drawing Anchor XRecord to extension dictionary")
    )
  )
  added
)

(defun cadgpt-drawing-anchor-ensure (preferred / dictEname payload created)
  (setq dictEname (cadgpt-anchor--extension-dict))
  (setq payload (cadgpt-anchor--read dictEname))
  (setq created nil)

  (if (null payload)
    (progn
      (cadgpt-anchor--create dictEname preferred)
      (setq payload (cadgpt-anchor--read dictEname))
      (if (null payload)
        (error "Drawing Anchor read-back failed after creation")
      )
      (setq created T)
    )
  )

  (strcat
    (itoa (car payload))
    "|"
    (cadr payload)
    "|"
    (if created "created" "existing")
  )
)

(princ)
