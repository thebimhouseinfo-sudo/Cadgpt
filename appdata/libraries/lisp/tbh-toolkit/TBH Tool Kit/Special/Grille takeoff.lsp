;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : GRTAKEOFF.lsp
;;; Module      : Quantity Takeoff
;;; Command     : GRTAKEOFF
;;; Description : Extracts attribute values from Grille Tag blocks
;;;               (created by GT command) within a selected area,
;;;               sorts by TAG_NUMBER, and exports to Excel (CSV).
;;;
;;; Filter Criteria:
;;;   - Layer: Hvac-GrilleTag
;;;   - Block Name: GR-* (e.g., GR-Exhaust Air-317966185)
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun c:GRTAKEOFF (/ ss i obj atts att tag val data headers row file_path f 
                      header_str row_str val_str count)
  
  (princ "\n================================================================")
  (princ "\n[ GRTAKEOFF ] Boc tach khoi luong Grille Tag")
  (princ "\n================================================================")
  (princ "\nBo loc: Layer = Hvac-GrilleTag, Block = GR-*")
  
  ;; 1. Yêu cầu người dùng chọn vùng cần bóc tách
  (princ "\nVui long chon vung de boc tach cac Grille Tag: ")
  
  ;; Lọc các Block nằm trên layer Hvac-GrilleTag và có tên bắt đầu bằng GR-*
  (setq ss (ssget '((0 . "INSERT")
                    (8 . "Hvac-GrilleTag")
                    (2 . "GR-*")
                   )
             )
  )
  
  ;; Kiểm tra nếu không chọn được đối tượng nào
  (if (not ss)
    (progn
      (princ "\n[ GRTAKEOFF ] Khong tim thay Grille Tag nao trong vung chon.")
      (princ "\nKiem tra: Layer = Hvac-GrilleTag, Block name = GR-*")
      (princ "\nLenh bi huy.")
      (princ)
      (exit)
    )
  )
  
  (setq count (sslength ss))
  (princ (strcat "\n[ GRTAKEOFF ] Tim thay " (itoa count) " Grille Tag."))
  
  ;; 2. Thu thập dữ liệu thuộc tính (Attributes)
  (setq data '()
        headers '()
        i 0)
  
  (repeat count
    (setq obj (vlax-ename->vla-object (ssname ss i)))
    
    ;; Kiểm tra xem Block có thuộc tính hay không
    (if (= (vla-get-hasattributes obj) :vlax-true)
      (progn
        (setq atts (vlax-invoke obj 'getattributes)
              row '())
        
        (foreach att atts
          (setq tag (vla-get-tagstring att)
                val (vla-get-textstring att))
          
          ;; Thêm Tag vào danh sách Headers nếu chưa có
          (if (not (member tag headers))
            (setq headers (append headers (list tag)))
          )
          
          ;; Lưu trữ dữ liệu dưới dạng danh sách liên kết (Tag . Value)
          (setq row (cons (cons tag val) row))
        )
        ;; Thêm hàng dữ liệu của block vào tổng dữ liệu
        (setq data (cons row data))
      )
    )
    (setq i (1+ i))
  )
  
  ;; Kiểm tra nếu không có block nào chứa thuộc tính
  (if (= (length data) 0)
    (progn
      (princ "\n[ GRTAKEOFF ] Cac Grille Tag duoc chon khong chua thuoc tinh (Attribute).")
      (princ "\nLenh bi huy.")
      (princ)
      (exit)
    )
  )
  
  (princ (strcat "\n[ GRTAKEOFF ] Da thu thap " (itoa (length data)) " ban ghi co attributes."))
  
  ;; 3. SẮP XẾP DỮ LIỆU THEO TAG_NUMBER
  (princ "\n[ GRTAKEOFF ] Dang sap xep du lieu theo TAG_NUMBER...")
  (setq data (vl-sort data
                      '(lambda (a b / va vb na nb)
                         ;; Lấy giá trị TAG_NUMBER từ mỗi hàng
                         (setq va (cdr (assoc "TAG_NUMBER" a))
                               vb (cdr (assoc "TAG_NUMBER" b)))
                         ;; Xử lý trường hợp thiếu TAG_NUMBER
                         (if (not va) (setq va ""))
                         (if (not vb) (setq vb ""))
                         
                         ;; Chuyển đổi sang số thực để so sánh toán học (nếu có thể)
                         (setq na (distof va 2)
                               nb (distof vb 2))
                         
                         ;; Logic so sánh
                         (cond
                           ;; Nếu cả hai đều là số -> Sắp xếp theo giá trị toán học
                           ((and na nb) (< na nb))
                           ;; Nếu cả hai đều là chuỗi chữ -> Sắp xếp theo Alphabet
                           ((and (not na) (not nb)) (< (strcase va) (strcase vb)))
                           ;; Nếu một bên là số, một bên là chữ -> Ưu tiên số lên trước
                           (na T)
                           (T nil)
                         )
                       )
               )
  )
  (princ "\n[ GRTAKEOFF ] Sap xep hoan tat.")
  
  ;; 4. Yêu cầu đường dẫn lưu file
  (setq file_path (getfiled "Luu file Excel (CSV) - Chon duong dan va dat ten file" "" "csv" 1))
  
  (if (not file_path)
    (progn
      (princ "\n[ GRTAKEOFF ] Ban da huy chon duong dan. Lenh ket thuc.")
      (princ)
      (exit)
    )
  )
  
  ;; 5. Tiến hành ghi dữ liệu ra file CSV
  (setq f (open file_path "w"))
  
  (if (not f)
    (progn
      (princ "\n[ GRTAKEOFF ] Loi: Khong the mo file de ghi. Vui long kiem tra quyen truy cap.")
      (princ)
      (exit)
    )
  )
  
  ;; Đưa TAG_NUMBER lên đầu danh sách Header (nếu có) để dễ quan sát trong Excel
  (if (member "TAG_NUMBER" headers)
    (setq headers (cons "TAG_NUMBER" (vl-remove "TAG_NUMBER" headers)))
  )

  ;; Ghi dòng Header (Tiêu đề các cột)
  (setq header_str "")
  (foreach h headers
    (setq header_str (strcat header_str "\"" h "\","))
  )
  ;; Loại bỏ dấu phẩy thừa ở cuối chuỗi
  (if (> (strlen header_str) 0)
    (setq header_str (substr header_str 1 (1- (strlen header_str))))
  )
  (write-line header_str f)
  
  ;; Ghi dữ liệu chi tiết cho từng Block
  (foreach row data
    (setq row_str "")
    (foreach h headers
      (setq val (cdr (assoc h row)))
      (if (not val) (setq val "")) ;; Nếu block thiếu att nào thì để trống
      
      ;; Xử lý chuỗi để tránh lỗi định dạng CSV (thay thế dấu ngoặc kép lồng nhau)
      (setq val_str (vl-string-translate "\"" "\"" val)) 
      (setq row_str (strcat row_str "\"" val_str "\","))
    )
    ;; Loại bỏ dấu phẩy thừa ở cuối chuỗi
    (if (> (strlen row_str) 0)
      (setq row_str (substr row_str 1 (1- (strlen row_str))))
    )
    (write-line row_str f)
  )
  
  ;; Đóng file sau khi ghi xong
  (close f)
  
  ;; 6. Thông báo hoàn tất và kết thúc lệnh
  (princ "\n================================================================")
  (princ (strcat "\n[ GRTAKEOFF ] Xuat thanh cong " (itoa (length data)) " ban ghi ra file:"))
  (princ (strcat "\n>>> " file_path))
  (princ "\n[ GRTAKEOFF ] Du lieu da duoc sap xep theo TAG_NUMBER.")
  (princ "\n[ GRTAKEOFF ] Lenh ket thuc.")
  (princ "\n================================================================")
  (princ)
)

(princ "\n[TBH] GRTAKEOFF (Grille Tag Takeoff) da duoc tai thanh cong.")
(princ "\n[TBH] Lenh: GRTAKEOFF - Boc tach Grille Tag tu layer Hvac-GrilleTag")
(princ)