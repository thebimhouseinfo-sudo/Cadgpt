;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : FLEXTAKEOFF.lsp
;;; Module      : Quantity Takeoff
;;; Command     : FLEXTAKEOFF
;;; Description : Extracts attribute values from Flexible Connection blocks
;;;               within a user selected area and exports to CSV.
;;;
;;; Filter Criteria:
;;;   - Layer: Hvac-FlexConn
;;;   - Block Name: FlexConn-*
;;;
;;; =============================================================================

(vl-load-com)

(defun c:FLEXTAKEOFF
(
/
ss
i
obj
atts
att
tag
val
data
headers
row
file_path
f
header_str
row_str
val_str
count
)

  (princ "\n================================================================")
  (princ "\n[ FLEXTAKEOFF ] Flexible Connection Takeoff")
  (princ "\n================================================================")
  (princ "\nBo loc:")
  (princ "\n  Layer = Hvac-FlexConn")
  (princ "\n  Block  = FlexConn-*")

  ;;==========================================================
  ;; USER SELECT
  ;;==========================================================

  (princ "\n\nChon cac Flexible Connection can boc tach:")

  (setq ss
        (ssget
          '(
            (0 . "INSERT")
            (8 . "Hvac-FlexConn")
            (2 . "FlexConn-*")
           )
        )
  )

  (if (not ss)
    (progn
      (princ "\nKhong co Flexible Connection nao duoc chon.")
      (princ)
      (exit)
    )
  )

  (setq count (sslength ss))

  (princ
    (strcat
      "\nTim thay "
      (itoa count)
      " Flexible Connection."
    )
  )

  ;;==========================================================
  ;; READ ATTRIBUTES
  ;;==========================================================

  (setq
    data '()
    headers '()
    i 0
  )

  (repeat count

    (setq obj (vlax-ename->vla-object (ssname ss i)))

    (if (= (vla-get-hasattributes obj) :vlax-true)

      (progn

        (setq
          atts (vlax-invoke obj 'GetAttributes)
          row '()
        )

        (foreach att atts

          (setq
            tag (vla-get-tagstring att)
            val (vla-get-textstring att)
          )

          (if (not (member tag headers))
            (setq headers (append headers (list tag)))
          )

          (setq row (cons (cons tag val) row))

        )

        (setq data (cons row data))

      )

    )

    (setq i (1+ i))

  )

  (if (= (length data) 0)

    (progn

      (princ "\nKhong tim thay Attribute.")

      (princ)

      (exit)

    )

  )

  (princ
    (strcat
      "\nDa doc "
      (itoa (length data))
      " block."
    )
  )

  ;;==========================================================
  ;; SORT BY EQM
  ;;==========================================================

  (if (member "EQM" headers)

    (progn

      (setq data

            (vl-sort

              data

              '(lambda (a b)

                 (<

                   (strcase
                     (if (cdr (assoc "EQM" a))
                       (cdr (assoc "EQM" a))
                       ""
                     )
                   )

                   (strcase
                     (if (cdr (assoc "EQM" b))
                       (cdr (assoc "EQM" b))
                       ""
                     )
                   )

                 )

               )

            )

      )

    )

  )

  ;;==========================================================
  ;; MOVE EQM FIRST
  ;;==========================================================

  (if (member "EQM" headers)
    (setq headers
          (cons
            "EQM"
            (vl-remove "EQM" headers)
          )
    )
  )

  ;;==========================================================
  ;; SAVE FILE
  ;;==========================================================

  (setq file_path
        (getfiled
          "Save CSV"
          ""
          "csv"
          1
        )
  )

  (if (not file_path)

    (progn

      (princ "\nLenh bi huy.")

      (princ)

      (exit)

    )

  )

  (setq f (open file_path "w"))

  (if (not f)

    (progn

      (princ "\nKhong mo duoc file.")

      (princ)

      (exit)

    )

  )

  ;;==========================================================
  ;; WRITE HEADER
  ;;==========================================================

  (setq header_str "")

  (foreach h headers

    (setq

      header_str

      (strcat

        header_str

        "\""

        h

        "\","

      )

    )

  )

  (if (> (strlen header_str) 0)

    (setq
      header_str
      (substr header_str 1 (1- (strlen header_str)))
    )

  )

  (write-line header_str f)

  ;;==========================================================
  ;; WRITE DATA
  ;;==========================================================

  (foreach row data

    (setq row_str "")

    (foreach h headers

      (setq val (cdr (assoc h row)))

      (if (not val)
        (setq val "")
      )

      (setq
        row_str
        (strcat
          row_str
          "\""
          val
          "\","
        )
      )

    )

    (if (> (strlen row_str) 0)

      (setq
        row_str
        (substr row_str 1 (1- (strlen row_str)))
      )

    )

    (write-line row_str f)

  )

  (close f)

  ;;==========================================================
  ;; FINISH
  ;;==========================================================

  (princ "\n================================================================")

  (princ
    (strcat
      "\nXuat thanh cong "
      (itoa (length data))
      " Flexible Connection."
    )
  )

  (princ (strcat "\nFile: " file_path))

  (princ "\nHoan tat.")

  (princ "\n================================================================")

  (princ)

)

(princ "\n[TBH] FLEXTAKEOFF loaded.")
(princ "\nCommand: FLEXTAKEOFF")
(princ)