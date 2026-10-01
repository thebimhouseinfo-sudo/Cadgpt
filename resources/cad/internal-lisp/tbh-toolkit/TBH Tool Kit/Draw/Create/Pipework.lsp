;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : PP.lsp
;;; Module      : Draw\MEP
;;; Command     : PP
;;; Description : Draw Refrigerant Pipe or Condensate Pipe with LWPOLYLINE.
;;;
;;; Usage       :
;;; 1. Run 'PP'.
;;; 2. Select pipe type [1=Refrigerant / 2=Condensate].
;;; 3. Click points. Press Space/Enter/ESC to finish.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── CAU HINH PIPE ──────────────────────────────────
(defun pp:config (type)
  ;; Tra ve: (layer color linetype width)
  (cond
    ((= type 1) (list "Hvac-Refrig"          170 "REFRIG" 25.0))
    ((= type 2) (list "Hvac-Condensate Pipe" 112 "HD"     15.0))
    (T nil)))

;; ─── INIT LAYER ─────────────────────────────────────
(defun pp:init-layer (layname color ltype / ad lays lobj)
  (setq ad   (vla-get-ActiveDocument (vlax-get-acad-object))
        lays  (vla-get-Layers ad))
  ;; Tao layer neu chua co
  (if (not (tblsearch "LAYER" layname))
    (progn
      (setq lobj (vla-Add lays layname))
      (vla-put-Color lobj color)
      (princ (strcat "\n[PP] Created layer: " layname)))
    (setq lobj (vla-Item lays layname)))
  ;; Kiem tra va load linetype
  (if (not (tblsearch "LTYPE" ltype))
    (vl-catch-all-apply 'command (list "_-LINETYPE" "_LOAD" ltype "" "")))
  ;; Gan linetype cho layer
  (if (tblsearch "LTYPE" ltype)
    (vl-catch-all-apply 'vla-put-Linetype (list lobj ltype)))
  lobj)

;; ─── VE POLYLINE ─────────────────────────────────────
(defun pp:draw (layname color ltype width / pt pts done first-pt cur-pt ok)
  (pp:init-layer layname color ltype)
  (setq pts  '()
        done nil
        ok T)
  (princ "\n[PP] Click points. Press Space/Enter to finish.")
  ;; Thu diem dau
  (setq first-pt (getpoint "\n  Point 1: "))
  (if (not first-pt)
    (progn (princ "\n[PP] Cancelled.") (setq ok nil)))
  (if ok
    (progn
      (if (= (length first-pt) 2)
        (setq first-pt (list (car first-pt) (cadr first-pt) 0.0)))
      (setq pts (list first-pt))
      ;; Thu cac diem tiep theo
      (while (not done)
        (setq cur-pt (getpoint (last pts)
            (strcat "\n  Point " (itoa (1+ (length pts))) " [Space=Finish]: ")))
        (cond
          ;; Nguoi dung nhan Space/Enter -> ket thuc
          ((not cur-pt)
           (setq done T))
          ;; Co diem moi
          (T
           (if (= (length cur-pt) 2)
             (setq cur-pt (list (car cur-pt) (cadr cur-pt) 0.0)))
           (setq pts (append pts (list cur-pt))))))
      ;; Can it nhat 2 diem moi ve
      (if (< (length pts) 2)
        (progn (princ "\n[PP] Need at least 2 points to draw.") (setq ok nil)))
      (if ok
        (progn
          ;; Tao LWPOLYLINE bang entmake
          (pp:make-pline pts layname color ltype width)
          (princ (strcat "\n[PP] Drawn " (itoa (length pts)) " points."))))))
  (princ))

;; ─── ENTMAKE LWPOLYLINE ──────────────────────────────
(defun pp:make-pline (pts layname color ltype width / dxf)
  (setq dxf
    (append
      (list
        '(0  . "LWPOLYLINE")
        '(100 . "AcDbEntity")
        (cons 8  layname)
        (cons 62 color)
        (cons 6  ltype)
        '(100 . "AcDbPolyline")
        (cons 90 (length pts))   ; so dinh
        '(70 . 0)                ; khong khep kin
        (cons 43 width))         ; global width
      (mapcar
        '(lambda (pt) (cons 10 (list (car pt) (cadr pt))))
        pts)))
  (if (not (entmake dxf))
    (princ "\n[PP] Error: Cannot create polyline.")))

;; ─── MAIN COMMAND ────────────────────────────────────
(defun c:PP (/ kw type cfg layname color ltype width)
  (initget "1 2")
  (setq kw (getkword "\nSelect Pipe type [1=Refrigerant / 2=Condensate] <1>: "))
  (if (not kw) (setq kw "1"))
  (setq type (atoi kw))

  (setq cfg    (pp:config type)
        layname (nth 0 cfg)
        color   (nth 1 cfg)
        ltype   (nth 2 cfg)
        width   (nth 3 cfg))

  (princ (strcat "\n[PP] Type: " (if (= type 1) "Refrigerant" "Condensate")
                 " | Layer: " layname
                 " | Width: " (rtos width 2 0)))

  (pp:draw layname color ltype width)
  (princ))

(princ "\n[TBH] PP.lsp loaded - Command: PP | Draw Refrigerant / Condensate Pipe.")
(princ)
