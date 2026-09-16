;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File         : XrefLayerMapper_v3.2.lsp
;;; Module       : Setup Xref
;;; Command      : XLAY
;;; Description  : Creates standard coordination layers, maps source layers by keyword/block-name rules, remaps nested block-definition content, handles off/frozen targets, and cleans obsolete source layers.
;;; Inputs       : User choice when mapped target layers are off/frozen; project/runtime mapping values only when a bounded dynamic variant is intentionally derived.
;;; Effects      : Creates target layers, remaps drawing and nested block content, may delete objects when Delete is chosen, deletes empty obsolete source layers, and restores prior layer locks.
;;; Interaction  : Interactive when off/frozen mapped targets require a Delete/Map choice.
;;; Risk         : High; broad layer remapping and optional object deletion can affect large portions of the drawing.
;;; Dependencies : Visual LISP COM (`vl-load-com`) and required linetypes from `acad.lin` (including SCEN, HD, HID where configured).
;;; Notes        : Managed source remains ordinary AutoLISP; ai_mode=dynamic permits only bounded runtime variants declared in User Registry. Function logic is unchanged in this metadata review.
;;; Revision     : Metadata normalized 2026-09-17; function logic unchanged.
;;;
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

(defun xlay:contains-any (str subs / found)
  (setq found nil)
  (foreach sub subs
    (if (vl-string-search (strcase sub) (strcase str))
      (setq found T)))
  found)

(defun xlay:contains-and (str subs1 subs2)
  (and (xlay:contains-any str subs1) (xlay:contains-any str subs2)))

(defun xlay:get-target (name)
  (cond
    ((xlay:contains-and name
       '("ROOM" "ZONE" "AREA" "SPACE" "DEPT" "UNIT" "TENNANT" "TENANT")
       '("NAME" "IDEN" "TAG" "TEXT" "NUMBER" "NUMB" "NUM" "LABEL" "LBL" "NO"))
     "Xref-RoomName")
    ((xlay:contains-any name
       '("TRAY" "TRUNKING" "TRUNK" "BUSDUCT" "BUS-DUCT" "BUSBAR"
         "LADDER" "CABL" "CABLE" "E-CABL" "WIREWAY" "CONDUIT" "CNDUIT"
         "RACEWAY" "FEEDER" "E-FDL" "LV-" "MV-"))
     "Xref-ElectCoord")
    ((and (not (xlay:contains-any name '("ANNO" "TEXT" "NOTE" "DIMS" "SYMB" "LEGN")))
          (xlay:contains-any name
            '("LIGHT" "LITE" "LTG" "LUMN" "LUMINAIRE" "LUMINAR"
              "DOWNLIGHT" "SPOTLIGHT" "STRIPLIGHT" "STRIP-LT"
              "EMERGENC" "EMERG-LT" "EXIT-SIGN" "EXIT-LT"
              "DEN" "CHIEUCHANG" "BONG" "PENDANT" "LAMP" "LANTERN"
              "E-LITE" "E-LT" "EL-LT"
              "SPEAKER" "SPKR" "SPK-" "LOA"
              "CAMERA" "CAM-" "CCTV"
              "PROJECTOR" "PROJ-"
              "SMOKE" "HEAT-DET" "HEATDET" "DETECTOR" "DETEC"
              "FIRE-DET" "FIREDET" "F-DET")))
     "Xref-Lights")
    ((and (not (xlay:contains-any name '("ANNO" "TEXT" "NOTE" "DIMS")))
          (xlay:contains-any name
            '("SPRK" "SPRINKLER" "SPK" "F-SPK" "FIRE-SP" "FPS"
              "CHUA CHAY" "CHUACHAY" "FP-SPRK" "FP-PIPE" "DELUGE"
              "SUPPRES" "HALON" "FM200" "NOVEC" "WET-PIPE" "DRY-PIPE")))
     "Xref-FireSprinklerCoord")
    ((xlay:contains-and name
       '("CEILING" "CEIL" "CLNG" "CLG")
       '("IDEN" "NOTE" "TAG" "TEXT" "ANNO" "LABEL" "LBL" "SYMB"))
     "Xref-CeilingNotes")
    ((xlay:contains-any name '("CEILING" "CEIL" "CLNG" "CLG" "A-CLNG" "SOFFIT" "COFFER"))
     "Xref-Ceiling")
    ((xlay:contains-and name
       '("ROOF" "ROOFING" "A-ROOF")
       '("PATTEN" "PATTERN" "HATCH" "FILL" "PATT"))
     "Xref-RoofHatch")
    ((xlay:contains-any name '("ROOF" "ROOFING" "A-ROOF" "PARAPET" "FASCIA" "EAVE" "SKYLIGHT"))
     "Xref-Roof")
    ((xlay:contains-and name
       '("WALL" "A-WALL")
       '("PATTEN" "PATTERN" "HATCH" "FILL" "PATT"))
     "Xref-WallHatch")
    ((xlay:contains-any name
       '("WALL" "DOOR" "GLAZING" "GLAZ" "WINDOW" "WIN-" "WNDW"
         "CURTAIN" "CURT-WALL" "CWLL" "PARTITION" "PARTTN" "PATTITION"
         "PRTTN" "SCREEN" "SHUTTER" "LOUVRE" "LOUVER" "JALOUSIE"
         "OPNG" "OPENING" "VOID" "STAIR" "STAIRCASE" "RAILING" "BALUS"))
     "Xref-Walls")
    ((xlay:contains-any name
       '("SLAB" "FLOR" "FLOOR" "FLR" "A-FLOR" "S-SLAB"
         "SCREED" "TOPPING" "FINSH" "FINISH" "TILE" "PAVING" "PAVE"
         "DECK" "PODIUM" "RAMP" "STEP" "TREAD" "LANDING"))
     "Xref-Slab")
    ((xlay:contains-any name
       '("STRUCT" "STRUCTURE" "S-BEAM" "BEAM" "S-COLS" "COLUMN" "COLS" "COL-"
         "FRAMING" "FRAME" "S-FRAM" "FNDN" "FOUNDATION" "FOOTING" "FTNG"
         "PILE" "CAISSON" "RETWALL" "RET-WALL" "BRACING" "BRACE"
         "TRUSS" "JOIST" "PURLIN" "RAFTER" "STEEL" "CONC" "RC-"))
     "Xref-Structure")
    ((xlay:contains-any name
       '("GRID" "GRIDS" "S-GRID" "A-GRID" "GRIDLINE" "GRID-LINE"
         "AXIS" "AXES" "DATUM" "SETOUT" "SET-OUT" "BLDG-GRID"))
     "Xref-Grid")
    ((and (not (xlay:contains-any name '("ANNO" "TEXT" "NOTE" "DIMS" "FIXT" "EQPM" "EQUIP")))
          (xlay:contains-any name
            '("P-PIPE" "P-SANR" "P-DOMW" "P-STRM" "P-ACID"
              "PLUMB" "PLMB" "PLB-" "PIPE" "PIPING" "PIPEWORK"
              "DRAIN" "DRAINAGE" "DRNG" "WASTE" "WASTEPIPE" "WASTE-PIPE"
              "SEWER" "SEWAGE" "CWS" "HWS" "HOTW" "COLDW"
              "VENT-PIPE" "VPIPE" "STACK" "RAINWATER" "RAIN-PIPE"
              "DOWNPIPE" "DOWN-PIPE" "DP-" "STRM" "STORM")))
     "Xref-PlumbingCoord")
    ((xlay:contains-any name
       '("FUR" "FURN" "FURNITURE" "FURNIT" "FIXTURE" "FIXT" "FFE" "FF&E"
         "MILLWORK" "CASW" "CASEWORK" "CABINET" "CABN" "JOINERY" "JONERY" "JOYN"
         "DESK" "CHAIR" "TABLE" "SHELF" "SHELV" "BENCH" "COUNTER" "WORKTOP"
         "RECEPTION" "RECEPT" "SANITARY" "SANIT" "TOILET" "WC" "BASIN" "SINK"
         "BATH" "URINAL" "SHOWER" "BIDET" "CUBICLE"))
     "Xref-Furniture")
    (T nil)))

(defun xlay:remap-block-def (adoc blk-def target-lay visited-names / obj obj-lay obj-type
                                   nested-name nested-def result count)
  (setq count 0)
  (vlax-for obj blk-def
    (setq obj-lay (vl-catch-all-apply 'vla-get-Layer (list obj)))
    (setq obj-type (vl-catch-all-apply 'vla-get-ObjectName (list obj)))
    (if (not (vl-catch-all-error-p obj-lay))
      (cond
        ((and (not (vl-catch-all-error-p obj-type)) (= obj-type "AcDbBlockReference"))
         (setq nested-name (vl-catch-all-apply 'vla-get-Name (list obj)))
         (if (and (not (vl-catch-all-error-p nested-name))
                  (not (member nested-name visited-names)))
           (progn
             (setq nested-def (vl-catch-all-apply 'vla-Item
                                (list (vla-get-Blocks adoc) nested-name)))
             (if (not (vl-catch-all-error-p nested-def))
               (setq count (+ count
                 (xlay:remap-block-def adoc nested-def target-lay
                   (cons nested-name visited-names))))))))
        ((not (equal obj-lay target-lay))
         (if (not (vl-catch-all-error-p
                    (vl-catch-all-apply 'vla-put-Layer (list obj target-lay))))
           (setq count (1+ count)))))))
  count)

(defun c:XLAY (/ *error* adoc lays locked-layers old-cmdecho
                 target-layers lay-names map-alist lay-info lname
                 s-lname s-lcolor s-ltype lo lay
                 blk blk-name blk-target obj obj-lay obj-type
                 pair target count std-names lay-to-del
                 off-freeze-targets user-choice delete-layers lay-obj
                 nested-name nested-target nested-def)

  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (setq lays (vla-get-layers adoc))
  (setq old-cmdecho (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)
  (vla-startundomark adoc)

  (defun *error* (msg)
    (if locked-layers
      (foreach lay locked-layers
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))))
    (if old-cmdecho (setvar "CMDECHO" old-cmdecho))
    (vla-endundomark adoc)
    (princ (strcat "\n[TBH] XLAY interrupted: " msg))
    (princ))

  (setq target-layers
    '(("0" 7 "Continuous")
      ("Defpoints" 7 "Continuous")
      ("Xref-SmokeWall" 216 "Continuous")
      ("Xref-FireWall" 20 "SCEN")
      ("Xref-Truss" 30 "HD")
      ("Xref-RoofHatch" 254 "Continuous")
      ("Xref-Structure" 30 "HID")
      ("Xref-Walls" 8 "Continuous")
      ("Xref-RoomName" 254 "Continuous")
      ("Xref-Ceiling" 89 "Continuous")
      ("Xref-MechCoord" 1 "Continuous")
      ("Xref-CeilingNotes" 89 "Continuous")
      ("Xref-Furniture" 9 "Continuous")
      ("Xref-Lights" 171 "Continuous")
      ("Xref-Grid" 1 "SCEN")
      ("Xref-ElectCoord" 81 "Continuous")
      ("Xref-FireSprinklerCoord" 20 "Continuous")
      ("Xref-PlumbingCoord" 150 "Continuous")
      ("Xref-Slab" 8 "Continuous")
      ("Xref-WallHatch" 254 "Continuous")
      ("Xref-Roof" 8 "Continuous")))

  (setq std-names (mapcar 'car target-layers))
  (setq locked-layers nil)
  (vlax-for lay lays
    (if (= (vla-get-lock lay) :vlax-true)
      (progn
        (setq locked-layers (cons lay locked-layers))
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-false)))))

  (princ "\n[TBH] Step 1/5: Checking and creating standard layers...")
  (foreach lay-info target-layers
    (setq s-lname (nth 0 lay-info)
          s-lcolor (nth 1 lay-info)
          s-ltype (nth 2 lay-info))
    (if (not (tblsearch "LAYER" s-lname))
      (progn
        (vl-catch-all-apply 'vla-Add (list lays s-lname))
        (setq lo (vl-catch-all-apply 'vla-Item (list lays s-lname)))
        (if (not (vl-catch-all-error-p lo))
          (progn
            (vla-put-Color lo s-lcolor)
            (if (not (tblsearch "LTYPE" s-ltype))
              (vl-catch-all-apply 'vla-Load
                (list (vla-get-Linetypes adoc) s-ltype "acad.lin")))
            (vl-catch-all-apply 'vla-put-Linetype (list lo s-ltype)))))))

  (princ "\n[TBH] Step 2/5: Building layer mapping rules...")
  (setq lay-names nil)
  (vlax-for lay lays
    (setq lay-names (cons (vla-get-Name lay) lay-names)))
  (setq map-alist nil)
  (foreach lname lay-names
    (if (not (member lname std-names))
      (progn
        (setq target (xlay:get-target lname))
        (if target (setq map-alist (cons (cons lname target) map-alist))))))

  (princ "\n[TBH] Step 3/5: Checking target layer visibility...")
  (setq off-freeze-targets nil)
  (foreach pair map-alist
    (setq s-lname (cdr pair))
    (if (not (member s-lname off-freeze-targets))
      (progn
        (setq lay-obj (vl-catch-all-apply 'vla-Item (list lays s-lname)))
        (if (not (vl-catch-all-error-p lay-obj))
          (if (or (= (vla-get-LayerOn lay-obj) :vlax-false)
                  (= (vla-get-Freeze lay-obj) :vlax-true))
            (setq off-freeze-targets (cons s-lname off-freeze-targets)))))))

  (setq delete-layers nil)
  (if off-freeze-targets
    (progn
      (princ "\n\n[TBH] WARNING: The following TARGET layers are currently OFF or FROZEN:")
      (foreach lname off-freeze-targets (princ (strcat "\n  - " lname)))
      (princ "\n\nObjects on source layers mapped to these targets will be affected.")
      (initget "Delete Map")
      (setq user-choice
        (getkword "\n[TBH] Choose action: [Delete] objects on those sources / [Map] anyway: "))
      (if (= user-choice "Delete")
        (foreach pair map-alist
          (if (member (cdr pair) off-freeze-targets)
            (setq delete-layers (cons (car pair) delete-layers)))))
      (princ "\n")))

  (princ "\n[TBH] Step 4/5: Remapping objects...")
  (setq count 0)
  (vlax-for blk (vla-get-blocks adoc)
    (if (or (not (vlax-property-available-p blk 'IsXRef))
            (= (vla-get-IsXRef blk) :vlax-false))
      (progn
        (setq blk-name (vla-get-Name blk))
        (setq blk-target (xlay:get-target blk-name))
        (vlax-for obj blk
          (setq obj-lay (vl-catch-all-apply 'vla-get-Layer (list obj)))
          (setq obj-type (vl-catch-all-apply 'vla-get-ObjectName (list obj)))
          (if (not (vl-catch-all-error-p obj-lay))
            (progn
              (setq pair (assoc obj-lay map-alist))
              (cond
                ((and pair (member (car pair) delete-layers))
                 (vl-catch-all-apply 'vla-Delete (list obj))
                 (setq count (1+ count)))
                (pair
                 (if (not (vl-catch-all-error-p
                            (vl-catch-all-apply 'vla-put-Layer (list obj (cdr pair)))))
                   (setq count (1+ count))))
                ((and blk-target
                      (not (and (member obj-lay std-names)
                                (not (member obj-lay '("0" "Defpoints"))))))
                 (if (not (vl-catch-all-error-p
                            (vl-catch-all-apply 'vla-put-Layer (list obj blk-target))))
                   (setq count (1+ count))))
                ((and (not (vl-catch-all-error-p obj-type))
                      (= obj-type "AcDbBlockReference"))
                 (setq nested-name (vl-catch-all-apply 'vla-get-Name (list obj)))
                 (if (not (vl-catch-all-error-p nested-name))
                   (progn
                     (setq nested-target (xlay:get-target nested-name))
                     (if nested-target
                       (progn
                         (setq nested-def (vl-catch-all-apply 'vla-Item
                                            (list (vla-get-Blocks adoc) nested-name)))
                         (if (not (vl-catch-all-error-p nested-def))
                           (setq count (+ count
                             (xlay:remap-block-def adoc nested-def nested-target
                               (list nested-name blk-name))))))))))))))))))

  (princ "\n[TBH] Step 5/5: Cleaning up old source layers...")
  (vla-put-ActiveLayer adoc (vla-Item lays "0"))
  (foreach pair map-alist
    (setq lay-to-del (vl-catch-all-apply 'vla-Item (list lays (car pair))))
    (if (not (vl-catch-all-error-p lay-to-del))
      (if (not (vl-catch-all-error-p
                 (vl-catch-all-apply 'vla-Delete (list lay-to-del))))
        (princ (strcat "\n  [Deleted layer] " (car pair))))))

  (if locked-layers
    (foreach lay locked-layers
      (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))))
  (if old-cmdecho (setvar "CMDECHO" old-cmdecho))
  (vla-endundomark adoc)
  (princ (strcat "\n[TBH] Done! " (itoa count) " objects processed."))
  (princ))

(princ "\n[TBH] Command XLAY loaded. Type XLAY to run.")
(princ)