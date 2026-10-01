;;; =============================================================================
;;; TBH-HEADER-START
;;;
;;; File        : XrefLayerMapper_v3.2.lsp
;;; Module      : Setup Xref
;;; Command     : XLAY
;;; Description : Creates standard layers and maps existing layers to them
;;;               based on keyword rules (layer name + block name fallback).
;;;               Recursively remaps objects inside nested block definitions.
;;;               Warns about off/frozen target layers and asks user to decide.
;;;               Skips standard layers that already exist.
;;;               Deletes old source layers after mapping.
;;;
;;; Usage       : Type XLAY and press Enter.
;;; TBH-HEADER-END
;;; =============================================================================

(vl-load-com)

;; ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────

;; Returns T if STR contains ANY keyword from SUBS list (OR logic)
(defun xlay:contains-any (str subs / found)
  (setq found nil)
  (foreach sub subs
    (if (vl-string-search (strcase sub) (strcase str))
      (setq found T)
    )
  )
  found
)

;; Returns T if STR contains at least one keyword from SUBS1 AND one from SUBS2 (AND logic)
(defun xlay:contains-and (str subs1 subs2)
  (and (xlay:contains-any str subs1) (xlay:contains-any str subs2))
)

;; Returns the target standard layer name for a given source name (layer or block name)
;; Returns nil if no rule matches
;; Keywords sourced from: AIA CAD Layer Guidelines (NCS v3.1/v6), BS1192,
;; common Vietnamese MEP Xref naming, and Southeast Asia project practice.
(defun xlay:get-target (name)
  (cond

    ;; ── [1] Room Name / Space Identity ────────────────────────────────────────
    ((xlay:contains-and name
       '("ROOM" "ZONE" "AREA" "SPACE" "DEPT" "UNIT" "TENNANT" "TENANT")
       '("NAME" "IDEN" "TAG" "TEXT" "NUMBER" "NUMB" "NUM" "LABEL" "LBL" "NO"))
     "Xref-RoomName")

    ;; ── [2] Electrical Coordination — Cable Tray / Trunking / Busduct ─────────
    ;; Ceiling-visible containment only — panels/switchboards excluded
    ((xlay:contains-any name
       '("TRAY" "TRUNKING" "TRUNK" "BUSDUCT" "BUS-DUCT" "BUSBAR"
         "LADDER" "CABL" "CABLE" "E-CABL" "WIREWAY" "CONDUIT" "CNDUIT"
         "RACEWAY" "FEEDER" "E-FDL" "LV-" "MV-"))
     "Xref-ElectCoord")

    ;; ── [3] Lights & Ceiling-mounted Devices ──────────────────────────────────
    ;; Scope: luminaires + ceiling-mounted A/V, security, fire detection
    ;; Excludes: wall switches, outlets, panels, sprinklers
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

    ;; ── [4] Fire Sprinkler / Suppression ──────────────────────────────────────
    ((and (not (xlay:contains-any name '("ANNO" "TEXT" "NOTE" "DIMS")))
          (xlay:contains-any name
            '("SPRK" "SPRINKLER" "SPK" "F-SPK" "FIRE-SP" "FPS"
              "CHUA CHAY" "CHUACHAY" "FP-SPRK" "FP-PIPE" "DELUGE"
              "SUPPRES" "HALON" "FM200" "NOVEC" "WET-PIPE" "DRY-PIPE")))
     "Xref-FireSprinklerCoord")

    ;; ── [5] Ceiling — Notes first, then geometry ──────────────────────────────
    ((xlay:contains-and name
       '("CEILING" "CEIL" "CLNG" "CLG")
       '("IDEN" "NOTE" "TAG" "TEXT" "ANNO" "LABEL" "LBL" "SYMB"))
     "Xref-CeilingNotes")
    ((xlay:contains-any name
       '("CEILING" "CEIL" "CLNG" "CLG" "A-CLNG" "SOFFIT" "COFFER"))
     "Xref-Ceiling")

    ;; ── [6] Roof ──────────────────────────────────────────────────────────────
    ((xlay:contains-and name
       '("ROOF" "ROOFING" "A-ROOF")
       '("PATTEN" "PATTERN" "HATCH" "FILL" "PATT"))
     "Xref-RoofHatch")
    ((xlay:contains-any name
       '("ROOF" "ROOFING" "A-ROOF" "PARAPET" "FASCIA" "EAVE" "SKYLIGHT"))
     "Xref-Roof")

    ;; ── [7] Walls, Partitions, Doors & Glazing ────────────────────────────────
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

    ;; ── [8] Slab / Floor ──────────────────────────────────────────────────────
    ((xlay:contains-any name
       '("SLAB" "FLOR" "FLOOR" "FLR" "A-FLOR" "S-SLAB"
         "SCREED" "TOPPING" "FINSH" "FINISH" "TILE" "PAVING" "PAVE"
         "DECK" "PODIUM" "RAMP" "STEP" "TREAD" "LANDING"))
     "Xref-Slab")

    ;; ── [9] Structural Elements ───────────────────────────────────────────────
    ((xlay:contains-any name
       '("STRUCT" "STRUCTURE" "S-BEAM" "BEAM" "S-COLS" "COLUMN" "COLS" "COL-"
         "FRAMING" "FRAME" "S-FRAM" "FNDN" "FOUNDATION" "FOOTING" "FTNG"
         "PILE" "CAISSON" "RETWALL" "RET-WALL" "BRACING" "BRACE"
         "TRUSS" "JOIST" "PURLIN" "RAFTER" "STEEL" "CONC" "RC-"))
     "Xref-Structure")

    ;; ── [10] Grid Lines & Axes ────────────────────────────────────────────────
    ((xlay:contains-any name
       '("GRID" "GRIDS" "S-GRID" "A-GRID" "GRIDLINE" "GRID-LINE"
         "AXIS" "AXES" "DATUM" "SETOUT" "SET-OUT" "BLDG-GRID"))
     "Xref-Grid")

    ;; ── [11] Plumbing Coordination — Pipes & Drains only ─────────────────────
    ;; Sanitary fixtures are handled by Xref-Furniture below
    ((and (not (xlay:contains-any name '("ANNO" "TEXT" "NOTE" "DIMS" "FIXT" "EQPM" "EQUIP")))
          (xlay:contains-any name
            '("P-PIPE" "P-SANR" "P-DOMW" "P-STRM" "P-ACID"
              "PLUMB" "PLMB" "PLB-"
              "PIPE" "PIPING" "PIPEWORK"
              "DRAIN" "DRAINAGE" "DRNG"
              "WASTE" "WASTEPIPE" "WASTE-PIPE"
              "SEWER" "SEWAGE"
              "CWS" "HWS" "HOTW" "COLDW"
              "VENT-PIPE" "VPIPE" "STACK"
              "RAINWATER" "RAIN-PIPE" "DOWNPIPE" "DOWN-PIPE" "DP-"
              "STRM" "STORM")))
     "Xref-PlumbingCoord")

    ;; ── [12] Furniture, Fixtures & Millwork ───────────────────────────────────
    ((xlay:contains-any name
       '("FUR" "FURN" "FURNITURE" "FURNIT"
         "FIXTURE" "FIXT" "FFE" "FF&E"
         "MILLWORK" "CASW" "CASEWORK" "CABINET" "CABN"
         "JOINERY" "JONERY" "JOYN"
         "DESK" "CHAIR" "TABLE" "SHELF" "SHELV" "BENCH"
         "COUNTER" "WORKTOP" "RECEPTION" "RECEPT"
         "SANITARY" "SANIT" "TOILET" "WC" "BASIN" "SINK" "BATH"
         "URINAL" "SHOWER" "BIDET" "CUBICLE"))
     "Xref-Furniture")

    ;; No match
    (T nil)
  )
)

;; ─── RECURSIVE BLOCK REMAP ────────────────────────────────────────────────────
;; Walks into a block definition and remaps all geometry objects to TARGET-LAY.
;; Also recurses into any nested block references found inside.
;; VISITED-NAMES prevents infinite loops from circular block references.
(defun xlay:remap-block-def (adoc blk-def target-lay visited-names / obj obj-lay obj-type
                                   nested-name nested-def result count)
  (setq count 0)
  (vlax-for obj blk-def
    (setq obj-lay  (vl-catch-all-apply 'vla-get-Layer (list obj)))
    (setq obj-type (vl-catch-all-apply 'vla-get-ObjectName (list obj)))
    (if (not (vl-catch-all-error-p obj-lay))
      (cond
        ;; Nested block reference → recurse into its definition
        ((and (not (vl-catch-all-error-p obj-type))
              (= obj-type "AcDbBlockReference"))
         (setq nested-name (vl-catch-all-apply 'vla-get-Name (list obj)))
         (if (and (not (vl-catch-all-error-p nested-name))
                  (not (member nested-name visited-names)))
           (progn
             (setq nested-def (vl-catch-all-apply 'vla-Item
                                (list (vla-get-Blocks adoc) nested-name)))
             (if (not (vl-catch-all-error-p nested-def))
               (setq count (+ count
                 (xlay:remap-block-def adoc nested-def target-lay
                   (cons nested-name visited-names))))
             )
           )
         ))
        ;; Regular geometry — remap layer if not already on target
        ((not (equal obj-lay target-lay))
         (if (not (vl-catch-all-error-p
                    (vl-catch-all-apply 'vla-put-Layer (list obj target-lay))))
           (setq count (1+ count))
         ))
      )
    )
  )
  count
)

;; ─── MAIN COMMAND ─────────────────────────────────────────────────────────────
(defun c:XLAY (/ *error* adoc lays locked-layers old-cmdecho
                 target-layers lay-names map-alist
                 s-lname s-lcolor s-ltype lo
                 blk blk-name blk-target obj obj-lay obj-type
                 pair target count
                 std-names lay-to-del
                 off-freeze-targets warning-shown user-choice
                 delete-layers lay-obj)

  (setq adoc (vla-get-activedocument (vlax-get-acad-object)))
  (setq lays (vla-get-layers adoc))

  (setq old-cmdecho (getvar "CMDECHO"))
  (setvar "CMDECHO" 0)
  (vla-startundomark adoc)

  ;; ── Error Handler ─────────────────────────────────────────────────────────
  (defun *error* (msg)
    (if locked-layers
      (foreach lay locked-layers
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))
      )
    )
    (if old-cmdecho (setvar "CMDECHO" old-cmdecho))
    (vla-endundomark adoc)
    (princ (strcat "\n[TBH] XLAY interrupted: " msg))
    (princ)
  )

  ;; ── Step 1: Define Standard Layer List (Name | Color | Linetype) ──────────
  (setq target-layers
    '(("0"                       7   "Continuous")
      ("Defpoints"               7   "Continuous")
      ("Xref-SmokeWall"        216   "Continuous")
      ("Xref-FireWall"          20   "SCEN")
      ("Xref-Truss"             30   "HD")
      ("Xref-RoofHatch"        254   "Continuous")
      ("Xref-Structure"         30   "HID")
      ("Xref-Walls"              8   "Continuous")
      ("Xref-RoomName"         254   "Continuous")
      ("Xref-Ceiling"           89   "Continuous")
      ("Xref-MechCoord"          1   "Continuous")
      ("Xref-CeilingNotes"      89   "Continuous")
      ("Xref-Furniture"          9   "Continuous")
      ("Xref-Lights"           171   "Continuous")
      ("Xref-Grid"               1   "SCEN")
      ("Xref-ElectCoord"        81   "Continuous")
      ("Xref-FireSprinklerCoord" 20  "Continuous")
      ("Xref-PlumbingCoord"    150   "Continuous")
      ("Xref-Slab"               8   "Continuous")
      ("Xref-WallHatch"        254   "Continuous")
      ("Xref-Roof"               8   "Continuous"))
  )

  (setq std-names (mapcar 'car target-layers))

  ;; ── Step 2: Unlock all layers ─────────────────────────────────────────────
  (setq locked-layers nil)
  (vlax-for lay lays
    (if (= (vla-get-lock lay) :vlax-true)
      (progn
        (setq locked-layers (cons lay locked-layers))
        (vl-catch-all-apply 'vla-put-lock (list lay :vlax-false))
      )
    )
  )

  ;; ── Step 3: Create standard layers if not existing ────────────────────────
  (princ "\n[TBH] Step 1/5: Checking and creating standard layers...")
  (foreach lay-info target-layers
    (setq s-lname (nth 0 lay-info)
          s-lcolor (nth 1 lay-info)
          s-ltype  (nth 2 lay-info))
    (if (not (tblsearch "LAYER" s-lname))
      (progn
        (vl-catch-all-apply 'vla-Add (list lays s-lname))
        (setq lo (vl-catch-all-apply 'vla-Item (list lays s-lname)))
        (if (not (vl-catch-all-error-p lo))
          (progn
            (vla-put-Color lo s-lcolor)
            (if (not (tblsearch "LTYPE" s-ltype))
              (vl-catch-all-apply 'vla-Load
                (list (vla-get-Linetypes adoc) s-ltype "acad.lin"))
            )
            (vl-catch-all-apply 'vla-put-Linetype (list lo s-ltype))
          )
        )
      )
    )
  )

  ;; ── Step 4: Build mapping alist ───────────────────────────────────────────
  (princ "\n[TBH] Step 2/5: Building layer mapping rules...")
  (setq lay-names nil)
  (vlax-for lay lays
    (setq lay-names (cons (vla-get-Name lay) lay-names))
  )

  (setq map-alist nil)
  (foreach lname lay-names
    (if (not (member lname std-names))
      (progn
        (setq target (xlay:get-target lname))
        (if target
          (setq map-alist (cons (cons lname target) map-alist))
        )
      )
    )
  )

  ;; ── Step 5: Check for off/frozen TARGET layers and ask user ───────────────
  ;; Collect unique target layer names that are used in map-alist
  ;; then check if any of those standard layers are currently off or frozen
  (princ "\n[TBH] Step 3/5: Checking target layer visibility...")
  (setq off-freeze-targets nil)
  (foreach pair map-alist
    (setq s-lname (cdr pair))
    (if (not (member s-lname off-freeze-targets))
      (progn
        (setq lay-obj (vl-catch-all-apply 'vla-Item (list lays s-lname)))
        (if (not (vl-catch-all-error-p lay-obj))
          (if (or (= (vla-get-LayerOn lay-obj)  :vlax-false)
                  (= (vla-get-Freeze   lay-obj)  :vlax-true))
            (setq off-freeze-targets (cons s-lname off-freeze-targets))
          )
        )
      )
    )
  )

  ;; Warn and ask user if any target layers are off/frozen
  (setq delete-layers nil)
  (if off-freeze-targets
    (progn
      (princ "\n\n[TBH] WARNING: The following TARGET layers are currently OFF or FROZEN:")
      (foreach lname off-freeze-targets
        (princ (strcat "\n  - " lname))
      )
      (princ "\n\nObjects on source layers mapped to these targets will be affected.")
      (initget "Delete Map")
      (setq user-choice
        (getkword "\n[TBH] Choose action: [Delete] objects on those sources / [Map] anyway: "))
      (if (= user-choice "Delete")
        ;; Collect source layers whose target is off/frozen → mark for deletion
        (foreach pair map-alist
          (if (member (cdr pair) off-freeze-targets)
            (setq delete-layers (cons (car pair) delete-layers))
          )
        )
      )
      (princ "\n")
    )
  )

  ;; ── Step 6: Remap / Delete objects ───────────────────────────────────────
  ;; Logic 1 : Object layer in map-alist
  ;;   → if source is in delete-layers: erase object
  ;;   → otherwise: remap to target layer
  ;; Logic 2 : Object layer not matched but BLOCK NAME matches keyword
  ;;   → layer "0" / "Defpoints" are NOT protected (remapped by block name)
  ;;   → other standard layers ARE protected (skip)
  ;; Logic 3 : Object is a block reference whose definition name matches keyword
  ;;   → recurse into block definition and remap all geometry inside
  (princ "\n[TBH] Step 4/5: Remapping objects...")
  (setq count 0)

  (vlax-for blk (vla-get-blocks adoc)
    (if (or (not (vlax-property-available-p blk 'IsXRef))
            (= (vla-get-IsXRef blk) :vlax-false))
      (progn
        (setq blk-name   (vla-get-Name blk))
        (setq blk-target (xlay:get-target blk-name))

        (vlax-for obj blk
          (setq obj-lay  (vl-catch-all-apply 'vla-get-Layer    (list obj)))
          (setq obj-type (vl-catch-all-apply 'vla-get-ObjectName (list obj)))
          (if (not (vl-catch-all-error-p obj-lay))
            (progn
              (setq pair (assoc obj-lay map-alist))
              (cond

                ;; Logic 1a: source layer marked for deletion → erase object
                ((and pair (member (car pair) delete-layers))
                 (vl-catch-all-apply 'vla-Delete (list obj))
                 (setq count (1+ count)))

                ;; Logic 1b: source layer in map-alist → remap layer
                (pair
                 (if (not (vl-catch-all-error-p
                            (vl-catch-all-apply 'vla-put-Layer (list obj (cdr pair)))))
                   (setq count (1+ count))
                 ))

                ;; Logic 2: no layer match — try block-name fallback
                ;; Protected: standard layers other than "0" and "Defpoints"
                ((and blk-target
                      (not (and (member obj-lay std-names)
                                (not (member obj-lay '("0" "Defpoints"))))))
                 (if (not (vl-catch-all-error-p
                            (vl-catch-all-apply 'vla-put-Layer (list obj blk-target))))
                   (setq count (1+ count))
                 ))

                ;; Logic 3: object is a block reference — recurse into its definition
                ;; to remap geometry inside, using the reference's own block name as key
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
                               (list nested-name blk-name))))
                         )
                       )
                     )
                   )
                 ))
              )
            )
          )
        )
      )
    )
  )

  ;; ── Step 7: Delete old source layers ─────────────────────────────────────
  (princ "\n[TBH] Step 5/5: Cleaning up old source layers...")
  (vla-put-ActiveLayer adoc (vla-Item lays "0"))
  (foreach pair map-alist
    (setq lay-to-del (vl-catch-all-apply 'vla-Item (list lays (car pair))))
    (if (not (vl-catch-all-error-p lay-to-del))
      (if (not (vl-catch-all-error-p
                 (vl-catch-all-apply 'vla-Delete (list lay-to-del))))
        (princ (strcat "\n  [Deleted layer] " (car pair)))
      )
    )
  )

  ;; ── Restore locked layers ─────────────────────────────────────────────────
  (if locked-layers
    (foreach lay locked-layers
      (vl-catch-all-apply 'vla-put-lock (list lay :vlax-true))
    )
  )

  (if old-cmdecho (setvar "CMDECHO" old-cmdecho))
  (vla-endundomark adoc)

  (princ (strcat "\n[TBH] Done! " (itoa count) " objects processed."))
  (princ)
)

(princ "\n[TBH] Command XLAY loaded. Type XLAY to run.")
(princ)
