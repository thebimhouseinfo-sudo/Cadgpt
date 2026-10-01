;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : FLEX CONN TAG.lsp
;;; Module      : Annotation
;;; Command     : FTAG
;;; Description : Automated tagging for flexible duct connections.
;;;               Fills EQM attribute with "EquipmentTag System".
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── UTILITIES ───────────────────────────────────────

(defun ftag:get-att (obj tag / res atts)
  (setq res "")
  (if (and obj (vlax-property-available-p obj 'HasAttributes) (= (vla-get-HasAttributes obj) :vlax-true))
    (progn
      (setq atts (vlax-invoke obj 'GetAttributes))
      (foreach att atts
        (if (= (strcase (vla-get-TagString att)) (strcase tag))
          (setq res (vla-get-TextString att))))))
  res)

(defun ftag:set-att (obj tag val / atts)
  (if (and obj (vlax-property-available-p obj 'HasAttributes) (= (vla-get-HasAttributes obj) :vlax-true))
    (progn
      (setq atts (vlax-invoke obj 'GetAttributes))
      (foreach att atts
        (if (= (strcase (vla-get-TagString att)) (strcase tag))
          (vla-put-TextString att val))))))

(defun ftag:get-center (ent / p1 p2)
  (vla-getboundingbox (vlax-ename->vla-object ent) 'p1 'p2)
  (setq p1 (vlax-safearray->list p1)
        p2 (vlax-safearray->list p2))
  (list (/ (+ (car p1) (car p2)) 2.0) (/ (+ (cadr p1) (cadr p2)) 2.0) 0.0))

(defun ftag:detect-system (flexEnt / p0 ss i ent lay sys result)
  (setq p0 (cdr (assoc 10 (entget flexEnt))) result "")
  ;; Search for ducts near p0 (radius 500)
  (setq ss (ssget "C" (list (- (car p0) 500) (- (cadr p0) 500)) (list (+ (car p0) 500) (+ (cadr p0) 500))
                 '((0 . "INSERT") (8 . "Hvacduct-*"))))
  (if ss
    (progn
      (setq ent (ssname ss 0)
            lay (strcase (cdr (assoc 8 (entget ent)))))
      (cond
        ((wcmatch lay "*SA*") (setq result "SA"))
        ((wcmatch lay "*RA*") (setq result "RA"))
        ((wcmatch lay "*OA*") (setq result "OA"))
        ((wcmatch lay "*EA*") (setq result "EA"))
        ((wcmatch lay "*TA*") (setq result "TA"))
      )
    )
  )
  result)

;; ─── MANUAL TAG ──────────────────────────────────────

(defun ftag:manual (/ flexEnt flexObj equipEnt equipObj eqmTag system)
  (setq flexEnt (car (entsel "\n[FTAG] Select Flexible Connection block: ")))
  (if (not flexEnt) (exit))
  (setq flexObj (vlax-ename->vla-object flexEnt))
  
  (setq equipEnt (car (entsel "\n[FTAG] Select Equipment block: ")))
  (if (not equipEnt) (exit))
  (setq equipObj (vlax-ename->vla-object equipEnt))
  
  ;; Get EQMTAG (or TAG_NUMBER) from equipment
  (setq eqmTag (ftag:get-att equipObj "EQMTAG"))
  (if (= eqmTag "") (setq eqmTag (ftag:get-att equipObj "TAG_NUMBER")))
  
  ;; Find system from nearest duct
  (setq system (ftag:detect-system flexEnt))
  
  (if (and (/= eqmTag "") (/= system ""))
    (progn
      (ftag:set-att flexObj "EQM" (strcat eqmTag " " system))
      (princ (strcat "\n[FTAG] Updated: " eqmTag " " system)))
    (princ "\n[FTAG] Error: Could not detect EQM Tag or System."))
)

;; ─── AUTO TAG ────────────────────────────────────────

(defun ftag:auto (/ ssFlex i flexEnt flexObj p0 ssEquip equipEnt equipObj eqmTag system count)
  (setq ssFlex (ssget "X" '((0 . "INSERT") (8 . "Hvac-FlexConn"))))
  (if (not ssFlex) (progn (princ "\nNo FlexConn blocks found.") (exit)))
  
  (setq i 0 count 0)
  (repeat (sslength ssFlex)
    (setq flexEnt (ssname ssFlex i)
          flexObj (vlax-ename->vla-object flexEnt)
          p0 (cdr (assoc 10 (entget flexEnt))))
    
    ;; Find nearest equipment (radius 1500)
    (setq ssEquip (ssget "C" (list (- (car p0) 1500) (- (cadr p0) 1500)) (list (+ (car p0) 1500) (+ (cadr p0) 1500))
                         '((0 . "INSERT") (8 . "Hvacequip,Hvac-Equip"))))
    (if ssEquip
      (progn
        (setq equipEnt (ssname ssEquip 0)
              equipObj (vlax-ename->vla-object equipEnt))
        (setq eqmTag (ftag:get-att equipObj "EQMTAG"))
        (if (= eqmTag "") (setq eqmTag (ftag:get-att equipObj "TAG_NUMBER")))
        
        (setq system (ftag:detect-system flexEnt))
        
        ;; Only update if both equipment tag and system are found
        (if (and (/= eqmTag "") (/= system ""))
          (progn
            (ftag:set-att flexObj "EQM" (strcat eqmTag " " system))
            (setq count (1+ count))))
      )
    )
    (setq i (1+ i))
  )
  (princ (strcat "\n[FTAG] Auto-updated " (itoa count) " FlexConn blocks."))
)

;; ─── MAIN COMMAND ────────────────────────────────────

(defun c:FTAG (/ kw)
  (vl-load-com)
  (initget "1 2 M A")
  (setq kw (getkword "\n[FTAG] Flexible Connection Tagging: [1=Manual / 2=Auto] <1>: "))
  (cond
    ((or (null kw) (= kw "1") (= kw "M")) (ftag:manual))
    ((or (= kw "2") (= kw "A")) (ftag:auto))
  )
  (princ)
)

(princ "\n[TBH] FlexConn Tagging (FTAG) loaded.")
(princ)