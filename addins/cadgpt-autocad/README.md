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

The palette title is `CadGPT`. Its header is read-only and shows the drawing currently bound by CadGPT plus a Dark/Light toggle. If AutoCAD's active drawing is not the drawing bound to the CadGPT chat/workspace, the header turns orange.

Drawing binding is not controlled by add-in buttons. It follows the normal CadGPT / `@cg` workflow used from ChatGPT.

The dedicated WebView2 profile is stored under:

```text
%LOCALAPPDATA%\CadGPT\runtime\autocad-addin\stage0-webview2
```

Only ordinary ChatGPT navigation URLs are remembered as convenience state. The add-in does not inspect cookies, browser storage, connector headers, auth tokens, or work handles.

## AutoCAD 2018 compatibility

AutoCAD 2018 reports managed API release `R22.0` and uses .NET Framework 4.6 for this host. The build script probes the installed host and selects the compatible target framework before compiling.
