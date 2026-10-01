;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : Join Polyline.lsp
;;; Module      : Special
;;; Command     : PJ
;;; Description : Quickly joins disconnected lines into continuous polylines or fuzz-joins them.
;;;
;;; 
;;; Usage       :
;;; 1. Run command.
;;; 2. Select lines, arcs, or polylines.
;;; 3. Fuzz-joins them into a continuous PLine, closing microscopic gaps.
;;; TBH-HEADER-END
;;; =============================================================================

(defun C:PJ (/ *error* pjss cmde peac nextent pjinit inc edata pjent)

  (defun *error* (errmsg)
    (if (not (member errmsg '("Function cancelled" "quit / exit abort" "console break")))
      (princ (strcat "\n[Error] " errmsg))
    )
    (if peac (setvar 'PEDITACCEPT peac))
    (command "_.undo" "_end")
    (if cmde (setvar 'CMDECHO cmde))
    (princ)
  )

  (princ "\nSelect entities to join [Tip: Picking 1 object joins all potential matches]: ")
  (setq
    pjss (ssget '((0 . "LINE,ARC,*POLYLINE")))
    cmde (getvar 'CMDECHO)
    peac (getvar 'PEDITACCEPT)
    nextent (entlast)
  )

  (if (not pjss)
    (progn (princ "\n[Cancel] No valid objects selected.") (exit))
  )

  ;; ─── FILTER: Remove 3D or Splined Polylines ───
  (repeat (setq pjinit (sslength pjss) inc pjinit)
    (setq pjent (ssname pjss (setq inc (1- inc))))
    (setq edata (entget pjent))
    (if
      (and
        (= (cdr (assoc 0 edata)) "POLYLINE")
        (or
          (= (cdr (assoc 100 (reverse edata))) "AcDb3dPolyline")
          (member (boole 1 6 (cdr (assoc 70 edata))) '(2 4))
        )
      )
      (ssdel pjent pjss)
    )
  )

  (setvar 'CMDECHO 0)
  (command "_.undo" "_begin")
  (setvar 'PEDITACCEPT 1)
  (setvar 'PLINETYPE 2) ; Ensure LWPolyline creation

  (if (> (sslength pjss) 0)
    (cond
      ;; Single Selection Mode: Join all possible to it
      ((= (sslength pjss) 1)
       (command "_.pedit" pjss "_join" "_all" "" "")
      )
      ;; Multiple Selection Mode: Join only selected entities
      ((> (sslength pjss) 1)
       (command "_.pedit" "_multiple" pjss "" "_join" "0.0" "")
      )
    )
    (princ "\n[Error] No viable objects for joining were found in selection.")
  )

  ;; ─── CLEANUP: Revert un-joined single segments back to Line/Arc ───
  (while (setq nextent (entnext nextent))
    (if
      (and
        (= (cdr (assoc 90 (entget nextent))) 2)
        (not (vlax-curve-isClosed nextent))
      )
      (command "_.explode" nextent)
    )
  )

  (setvar 'PEDITACCEPT peac)
  (command "_.undo" "_end")
  (setvar 'CMDECHO cmde)
  
  (princ "\n[Done] Polyline join process complete.")
  (princ)
)

(princ "\n[TBH] Polyline Join Tool loaded. Type 'PJ' to start.")
(princ)