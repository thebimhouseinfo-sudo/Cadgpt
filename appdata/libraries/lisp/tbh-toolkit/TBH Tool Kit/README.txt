=============================================================================
TBH Tool Kit - AutoCAD Standardization & Installation Guide
=============================================================================

This toolkit is designed for standardized professional engineering workflows. 
To ensure portability across all machines, follow the 1-Click installation 
steps below.

1. 1-Click Installation (Recommended)
-------------------------------------
You can now set up the entire toolkit automatically:

   A. Copy the 'TBH Tool Kit' folder to any location on your machine 
      (e.g., Desktop or Downloads).
   B. Right-click on 'Setup_TBH_Toolkit.bat' and select 'Run as Administrator'.
   C. The script will automatically:
      - Copy the toolkit to 'C:\Autocad Tool\TBH Tool Kit'.
      - Add the path to AutoCAD's Support File Search Path.
      - Add the Autoloader to AutoCAD's Startup Suite.
   D. Restart AutoCAD.

2. Manual Installation
----------------------
If the 1-Click script is restricted by your IT policy:

   A. Move the toolkit folder manually to: C:\Autocad Tool\TBH Tool Kit
   B. In AutoCAD, type 'OPTIONS' -> Files -> Support File Search Path.
      - Click 'Add' -> 'Browse' -> Select 'C:\Autocad Tool\TBH Tool Kit'.
   C. In AutoCAD, type 'APPLOAD' -> Startup Suite (Contents...) -> Add.
      - Select 'C:\Autocad Tool\TBH Tool Kit\Autoloader.lsp'.

3. Usage
--------
- Automatic Tools: Standardization, Flexible Duct, etc. load on drawing open.
- Commands:
  - TBH             : Open the GUI Manager.
  - CHUANHOADRAWING : Environment setup (SET1).
  - SSS             : Viewport finalization & locking.

-----------------------------------------------------------------------------
Developed for TBH Engineering Workflows.
=============================================================================
