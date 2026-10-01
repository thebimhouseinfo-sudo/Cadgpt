;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : ExportLayers.lsp
;;; Module      : Other
;;; Command     : EXPORTLAYERS, EXPLAY
;;; Description : Xuất danh sách toàn bộ layer (kèm màu và linetype) ra file .txt.
;;;
;;; Usage       :
;;; 1. Load lisp (APPLOAD) và gõ lệnh EXPORTLAYERS hoặc EXPLAY.
;;; 2. Hộp thoại hiện ra, chọn vị trí và tên file (mặc định Layer_List.txt).
;;; 3. Lisp tự động ghi tên, màu, linetype của tất cả layer và thông báo.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun c:EXPORTLAYERS (/ adoc lays fn f lay-name lay-color lay-ltype line-str count old-cmdecho)
  (vl-load-com)
  
  ;; 1. Khởi tạo và thiết lập môi trường
  (setq old-cmdecho (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)
  (setq count 0)
  
  ;; Lấy Active Document và danh sách Layers thông qua ActiveX
  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (setq lays (vla-get-layers adoc))
  
  ;; 2. Mở hộp thoại hệ thống của AutoCAD để người dùng chọn nơi lưu file .txt
  (setq fn (getfiled "Chon noi luu danh sach Layer" "Layer_List.txt" "txt" 1))
  
  ;; 3. Xử lý an toàn (Error Handling)
  (if fn
    (progn
      ;; Mở (hoặc tạo mới) file với quyền ghi ("w" - write)
      (setq f (open fn "w"))
      (if f
        (progn
          (princ "\n[TBH] Dang xu ly danh sach layer...")
          
          ;; Ghi Header vào file txt
          (write-line "DANH SACH LAYER TRONG BAN VE (BAO GOM COLOR & LINETYPE)" f)
          (write-line "========================================================================" f)
          
          ;; 4. Lặp qua tất cả các đối tượng layer trong collection
          (vlax-for lay lays
            ;; Lấy Tên layer
            (setq lay-name (vla-get-name lay))
            
            ;; Lấy Màu sắc (trả về số nguyên ACI, cần dùng itoa để ép kiểu sang chuỗi)
            (setq lay-color (itoa (vla-get-color lay)))
            
            ;; Lấy Linetype (trả về chuỗi)
            (setq lay-ltype (vla-get-linetype lay))
            
            ;; Nối chuỗi để định dạng từng dòng (dùng ký tự | để phân tách dễ nhìn)
            (setq line-str (strcat "Layer: " lay-name "  |  Color: " lay-color "  |  Linetype: " lay-ltype))
            
            ;; Ghi dòng dữ liệu vào file
            (write-line line-str f)
            
            (setq count (1+ count))
          )
          
          ;; Ghi Footer tổng kết
          (write-line "========================================================================" f)
          (write-line (strcat "Tong cong: " (itoa count) " layers.") f)
          
          ;; Bắt buộc phải đóng file để lưu thay đổi
          (close f)
          (princ (strcat "\n[TBH] Da xuat thanh cong " (itoa count) " layers ra file: " fn))
        )
        (princ "\n[TBH] Loi: Khong the mo hoac tao file de ghi du lieu!")
      )
    )
    (princ "\n[TBH] Da huy thao tac luu file.")
  )
  
  ;; 5. Phục hồi biến hệ thống
  (setvar "CMDECHO" old-cmdecho)
  (princ)
)

;; Lệnh gọi tắt (Alias)
(defun c:EXPLAY () (c:EXPORTLAYERS))

(princ "\n[TBH] ExportLayers Module loaded. Type EXPORTLAYERS or EXPLAY to run.")
(princ)