# CadGPT AutoCAD Add-in

The AutoCAD add-in lives inside the CadGPT repository at:

```text
addins/cadgpt-autocad
```

It embeds the ChatGPT web experience in a dockable AutoCAD palette while CadGPT's existing MCP/runtime remains the authority for CAD work and drawing binding.

## Build

From the CadGPT repository root:

```powershell
powershell -NoProfile -File scripts/probe-autocad-addin-host.ps1

$hostInfo = Get-Content `
  "$env:LOCALAPPDATA\CadGPT\runtime\autocad-addin\stage0-host.json" `
  -Raw | ConvertFrom-Json

powershell -NoProfile -File scripts/build-autocad-addin.ps1 `
  -AutoCadInstallDir "$($hostInfo.build.install_dir)" `
  -Configuration Release
```

The build stages a production bundle at:

```text
addins\cadgpt-autocad\bin\bundle\CadGPT.bundle
```

## Install / autoload

Close AutoCAD, then run:

```powershell
powershell -NoProfile -File scripts/install-autocad-addin.ps1 -Configuration Release
```

The installer copies the bundle to the current user's Autodesk ApplicationPlugins directory:

```text
%APPDATA%\Autodesk\ApplicationPlugins\CadGPT.bundle
```

The bundle manifest uses `LoadOnAutoCADStartup="True"`, so AutoCAD loads the CadGPT assembly automatically on startup. The panel itself stays hidden until requested.

Open or reactivate the panel with:

```text
CADGPT
```

AutoCAD commands are case-insensitive, so `cadgpt` works as well.

## Panel behavior

The palette title is `CadGPT`. Its header is read-only and shows the drawing currently bound by CadGPT plus a Dark/Light toggle. If AutoCAD's active drawing is confirmed to be different from the bound drawing, the header turns orange; if the bound drawing is confirmed closed, it turns yellow. Local AutoCAD document snapshots are debounced so a transient COM/.NET miss or resume transition does not change header color.

The add-in pair remains live for the lifetime of the panel/CAD session and is released on real panel disposal. Add-in-managed logical sessions are not expired by the ordinary MCP idle TTL. A WebView process failure recreates the palette while preserving the pair, and a long dispatcher gap such as Windows sleep triggers a delayed binding poll plus WebView reload. This recovery never restarts AutoCAD.

Drawing binding is not controlled by add-in buttons. It follows the normal CadGPT / `@cg` workflow used from ChatGPT.

The dedicated WebView2 profile is stored under:

```text
%LOCALAPPDATA%\CadGPT\runtime\autocad-addin\stage0-webview2
```

The WebView2 profile preserves normal ChatGPT login/session state, but the add-in does not persist or reopen a specific conversation URL. Each palette initialization starts at `https://chatgpt.com/`. The add-in does not inspect cookies, browser storage, connector headers, auth tokens, or work handles.

## AutoCAD 2018 compatibility

AutoCAD 2018 reports managed API release `R22.0` and uses .NET Framework 4.6 for this host. The build script probes the installed host and selects the compatible target framework before compiling.
