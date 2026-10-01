;;;===========================================
;;; LENH LEB VA LEM - CHINH SUA RIENG LEADER
;;;===========================================

(defun c:LEB ()
  (change-leader-individual "BW-Text" "ISO-25")
  (princ)
)

(defun c:LEM ()
  (change-leader-individual "Hvactext" "ISO-25")
  (princ)
)

(defun change-leader-individual (layer-name dimstyle-name / ent entdata old-dimasz old-dimscale)
  (prompt (strcat "\nChon doi tuong Leader (Layer: " layer-name "): "))
  (if (setq ent (car (entsel)))
    (progn
      (setq entdata (entget ent))
      
      ;; Kiem tra doi tuong la LEADER
      (if (= (cdr (assoc 0 entdata)) "LEADER")
        (progn
          ;; Luu lai gia tri cu cua bien he thong
          (setq old-dimasz (getvar "DIMASZ"))
          (setq old-dimscale (getvar "DIMSCALE"))
          
          ;; 1. Thay doi Layer (group code 8)
          (setq entdata (subst (cons 8 layer-name) (assoc 8 entdata) entdata))
          
          ;; 2. Thay doi Dimstyle reference (group code 3)
          (if (assoc 3 entdata)
            (setq entdata (subst (cons 3 dimstyle-name) (assoc 3 entdata) entdata))
            (setq entdata (append entdata (list (cons 3 dimstyle-name))))
          )
          
          ;; 3. Thay doi Dim scale overall thanh 50.0 (group code 40)
          (if (assoc 40 entdata)
            (setq entdata (subst (cons 40 50.0) (assoc 40 entdata) entdata))
            (setq entdata (append entdata (list (cons 40 50.0))))
          )
          
          ;; 4. Dam bao arrowhead duoc bat (group code 71 = 1)
          (if (assoc 71 entdata)
            (setq entdata (subst (cons 71 1) (assoc 71 entdata) entdata))
            (setq entdata (append entdata (list (cons 71 1))))
          )
          
          ;; 5. Dat bien he thong tam thoi de arrow size = 2.5
          (setvar "DIMASZ" 2.5)
          (setvar "DIMSCALE" 1.0) ; De scale tu leader control
          
          ;; 6. Cap nhat entity
          (entmod entdata)
          (entupd ent)
          
          ;; 7. Khoi phuc lai bien he thong
          (setvar "DIMASZ" old-dimasz)
          (setvar "DIMSCALE" old-dimscale)
          
          ;; 8. Regen de cap nhat hien thi
          (command "_.REGEN")
          
          (princ (strcat "\nDa cap nhat Leader: Layer=" layer-name 
                         ", Dimstyle=" dimstyle-name 
                         ", Scale=50, Arrow=2.5"))
        )
        (prompt "\nDoi tuong chon khong phai la LEADER!")
      )
    )
    (prompt "\nKhong chon duoc doi tuong!")
  )
  (princ)
)

(princ "\nLenh LEB va LEM da duoc nap.")
(princ)