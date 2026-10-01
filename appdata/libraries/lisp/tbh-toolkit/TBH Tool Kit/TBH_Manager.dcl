// TBH_Manager.dcl (auto-generated)
tbh_main : dialog {
  label = "TBH Tool Box Hub  |  Systematic LSP Manager";
  width = 130;
  : column {
    : row {
      : button { key="tb1"; label=" (Root) "; width=14; }
      : button { key="tb2"; label=" Annotation "; width=14; }
      : button { key="tb3"; label=" Demolition "; width=14; }
      : button { key="tb4"; label=" Draw "; width=14; }
      : button { key="tb5"; label=" Setup Drawing "; width=14; }
      : button { key="tb6"; label=" Setup Xref "; width=14; }
      : button { key="tb7"; label=" Special "; width=14; }
      spacer;
      : button { key="btn_refresh"; label=" Refresh "; width=12; }
    }
    : text { key="lbl_tab"; label=""; alignment=left; }
    spacer_1;
    : row {
      : text { label=" COMMAND LIST (Title | Description)"; width = 54; alignment=left; }
      : text { key="lbl_panel_file"; label=" TOOL INFORMATION"; width=72; alignment=left; }
    }
    : row {
      : list_box { key = "lst_cmds"; width = 54; height = 22; multiple_select = false; fixed_width = true; }
      : list_box { key = "lst_detail"; width = 72; height = 22; multiple_select = false; fixed_width = true; }
    }
    spacer_1;
    : row {
      : button { key="btn_run"; label=" Run / Load Tool "; width=18; is_default=true; }
      spacer_1;
      : button { key="btn_edit_desc"; label=" Edit Desc "; width=14; }
      : button { key="btn_edit_detail"; label=" Edit Detail "; width=15; }
      spacer_1;
      : button { key="btn_open"; label=" Open Folder "; width=18; }
      spacer;
      : button { key="btn_close"; label=" Close "; width=12; is_cancel=true; }
    }
    spacer_0;
    : text { key="lbl_status"; label="Ready. Select a tool to begin."; alignment=left; }
  }
}

tbh_edit_desc : dialog {
  label = "Edit Short Description";
  width = 56;
  : column {
    : text { key="ped_fname"; label=""; width=54; alignment=left; }
    spacer_0;
    : text { label="Short description:"; }
    : edit_box { key="ped_value"; width=54; edit_width=54; }
    spacer;
    : row {
      : button { key="ped_ok"; label=" Save "; width=12; is_default=true; }
      spacer;
      : button { key="ped_cancel"; label=" Cancel "; width=12; is_cancel=true; }
    }
  }
}

tbh_edit_detail : dialog {
  label = "Edit Tool Detail";
  width = 60;
  : column {
    : text { key="pdt_fname"; label=""; width=58; alignment=left; }
    spacer_0;
    : text { label="Detail lines (max 8):"; }
    : edit_box { key="pdt_line1"; label="L1:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line2"; label="L2:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line3"; label="L3:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line4"; label="L4:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line5"; label="L5:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line6"; label="L6:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line7"; label="L7:"; width=55; edit_width=48; }
    : edit_box { key="pdt_line8"; label="L8:"; width=55; edit_width=48; }
    spacer;
    : row {
      : button { key="pdt_ok"; label=" Save "; width=12; is_default=true; }
      spacer;
      : button { key="pdt_cancel"; label=" Cancel "; width=12; is_cancel=true; }
    }
  }
}
