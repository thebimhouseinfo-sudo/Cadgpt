;; ====================================================================
;; LENH: C2L (Copy to Layout - Upgraded Version)
;; CHUC NANG: Chon vat the tren layout hien tai, hien hop thoai cho phep:
;;            - Chon nhieu layout dich (hoac chon nhanh tat ca).
;;            - Tich chon co muon COPY ca Viewport hay khong.
;;            - Copy giu nguyen toa do bang ActiveX (khong giat man hinh).
;; ====================================================================

(defun c:C2L (/ *error* ss cur_layout layouts target_layouts 
                tmp_file dcl_file dcl_id dlg_result user_choice include_vp
                indices chosen_layouts doc obj_list count i varr src_blk trg_blk objObjectName)
  
  ;; Ham xu ly loi de don dep file tam
  (defun *error* (msg)
    (if tmp_file (vl-file-delete tmp_file))
    (if dcl_id (unload_dialog dcl_id))
    (if (and msg (not (wcmatch (strcase msg) "*CANCEL*,*QUIT*")))
      (princ (strcat "\n>> Loi: " msg))
    )
    (princ)
  )

  (vl-load-com)
  
  ;; 1. Chon vat the
  (princ "\nChon cac vat the can copy: ")
  (setq ss (ssget))
  
  (if (not ss)
    (progn
      (princ "\n>> Khong co vat the nao duoc chon. Lenh ket thuc.")
      (exit)
    )
  )

  ;; 2. Lay danh sach layout
  (setq cur_layout (getvar 'ctab))
  (setq layouts (layoutlist))
  
  ;; Loai bo layout hien tai khoi danh sach dich
  (setq target_layouts (vl-remove cur_layout layouts))
  
  (if (null target_layouts)
    (progn
      (princ "\n>> Khong co layout khac de copy den. Lenh ket thuc.")
      (exit)
    )
  )

  ;; 3. Tao file DCL tam thoi voi giao dien nang cap
  (setq tmp_file (vl-filename-mktemp "C2L_v2.dcl"))
  (setq dcl_file (open tmp_file "w"))
  (write-line "C2L_DLG : dialog {" dcl_file)
  (write-line "  label = \"Copy to Layout (Upgraded)\";" dcl_file)
  (write-line "  : list_box {" dcl_file)
  (write-line "    key = \"lst_layouts\";" dcl_file)
  (write-line "    label = \"Danh sach Layout dich:\";" dcl_file)
  (write-line "    multiple_select = true;" dcl_file)
  (write-line "    width = 45;" dcl_file)
  (write-line "    height = 15;" dcl_file)
  (write-line "  }" dcl_file)
  ;; Row chua 2 nut Chon nhanh
  (write-line "  : row {" dcl_file)
  (write-line "    : button {" dcl_file)
  (write-line "      key = \"btn_sel_all\";" dcl_file)
  (write-line "      label = \"Chon tat ca\";" dcl_file)
  (write-line "    }" dcl_file)
  (write-line "    : button {" dcl_file)
  (write-line "      key = \"btn_clear_all\";" dcl_file)
  (write-line "      label = \"Bo chon tat ca\";" dcl_file)
  (write-line "    }" dcl_file)
  (write-line "  }" dcl_file)
  (write-line "  spacer;" dcl_file)
  ;; Checkbox tuy chon Viewport
  (write-line "  : toggle {" dcl_file)
  (write-line "    key = \"chk_viewport\";" dcl_file)
  (write-line "    label = \"Copy ca Viewport (Khung nhin)\";" dcl_file)
  (write-line "    value = \"1\";" dcl_file) ; Mac dinh la co copy
  (write-line "  }" dcl_file)
  (write-line "  spacer;" dcl_file)
  (write-line "  ok_cancel;" dcl_file)
  (write-line "}" dcl_file)
  (close dcl_file)

  ;; 4. Hien thi hop thoai DCL
  (setq dcl_id (load_dialog tmp_file))
  (if (not (new_dialog "C2L_DLG" dcl_id))
    (progn
      (alert "Khong the hien thi hop thoai DCL!")
      (exit)
    )
  )

  ;; Dua danh sach layout vao list_box
  (start_list "lst_layouts")
  (mapcar 'add_list target_layouts)
  (end_list)

  ;; Xu ly su kien nut "Chon tat ca"
  (action_tile "btn_sel_all"
    "(progn
       (setq all_indices \"\")
       (setq idx 0)
       (repeat (length target_layouts)
         (setq all_indices (strcat all_indices (itoa idx) \" \"))
         (setq idx (1+ idx))
       )
       (set_tile \"lst_layouts\" all_indices)
     )"
  )

  ;; Xu ly su kien nut "Bo chon tat ca"
  (action_tile "btn_clear_all" "(set_tile \"lst_layouts\" \"\")")

  ;; Xu ly su kien khi nhan OK / Cancel
  (action_tile "accept" 
    "(progn 
       (setq user_choice (get_tile \"lst_layouts\")) 
       (setq include_vp (get_tile \"chk_viewport\")) 
       (done_dialog 1)
     )"
  )
  (action_tile "cancel" "(done_dialog 0)")

  (setq dlg_result (start_dialog))
  (unload_dialog dcl_id)
  (vl-file-delete tmp_file)

  ;; 5. Xu ly ket qua sau khi User bam OK
  (if (= dlg_result 1)
    (progn
      (if (= user_choice "")
        (princ "\n>> Ban da khong chon layout dich nao. Lenh ket thuc.")
        (progn
          ;; Chuyen chuoi chi muc thanh danh sach so
          (setq indices (read (strcat "(" user_choice ")")))
          
          ;; Lay ten layout tuong ung
          (setq chosen_layouts 
            (mapcar '(lambda (x) (nth x target_layouts)) indices)
          )

          (princ "\nDang phan tich va loc doi tuong...")
          
          (setq doc (vla-get-activedocument (vlax-get-acad-object)))
          (setq obj_list nil)
          (setq count (sslength ss))
          (setq i 0)
          
          ;; Chuyen Selection Set sang danh sach VLA-Object + Loc Viewport neu can
          (repeat count
            (setq vla_obj (vlax-ename->vla-object (ssname ss i)))
            (setq objObjectName (vla-get-objectname vla_obj))
            
            (if (= include_vp "1")
              ;; Truong hop THU NHAT: Copy het tat ca
              (setq obj_list (cons vla_obj obj_list))
              ;; Truong hop THU HAI: Khong copy Viewport (Loai bo AcDbViewport)
              (if (/= objObjectName "AcDbViewport")
                (setq obj_list (cons vla_obj obj_list))
              )
            )
            (setq i (1+ i))
          )
          
          ;; Kiem tra xem sau khi loc co con vat the nao khong
          (if (null obj_list)
            (progn
              (princ "\n>> Khong co vat the hop le nao de copy (Co the ban chi chon Viewport nhung da tat tuy chon copy Viewport).")
              (exit)
            )
          )
          
          ;; Tao mang SafeArray chua cac doi tuong hop le
          (setq varr (vlax-make-safearray vlax-vbobject (cons 0 (1- (length obj_list)))))
          (vlax-safearray-fill varr obj_list)
          
          ;; Lay Block cua layout nguon
          (setq src_blk (vla-get-block (vla-item (vla-get-layouts doc) cur_layout)))

          ;; Copy ngam bang ActiveX sang tung layout dich
          (foreach lay chosen_layouts
            (setq trg_blk (vla-get-block (vla-item (vla-get-layouts doc) lay)))
            (vla-copyobjects doc varr trg_blk)
            (princ (strcat "\n  + Da copy thanh cong sang layout: " lay))
          )
          
          ;; Lam moi bieu dien hinh anh de cap nhat thay doi tren layout
          (vla-regen doc acAllViewports)
          (princ "\n>> HOAN THANH! Da copy doi tuong sang cac layout da chon.")
        )
      )
    )
  )
  (princ)
)

(princ "\nLenh C2L phien ban nang cap da san sang. Go 'C2L' de thuc hien.")
(princ)