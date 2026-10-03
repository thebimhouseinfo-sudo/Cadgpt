# CadGPT AutoCAD Add-in — Stage 0

This directory contains the feasibility shell only. It does not bind drawings, mint CadGPT work authority, implement multi-drawing, or replace the Python/COM CAD MCP.

## Probe the real host

From the repository root:

```powershell
powershell -NoProfile -File scripts/probe-autocad-addin-host.ps1
```

If multiple AutoCAD installations exist, pass the exact `-AutoCadInstallDir`.

The probe writes a local build descriptor under `%LOCALAPPDATA%\CadGPT\runtime\autocad-addin` and updates the sanitized host record in `docs/roadmap`.

## Build

```powershell
powershell -NoProfile -File scripts/build-autocad-addin.ps1 -AutoCadInstallDir "C:\Program Files\Autodesk\AutoCAD 20xx" -Configuration Debug
```

The build script re-probes the host, runs host-independent lifecycle tests, restores/builds for the probed target framework, keeps Autodesk API DLLs copy-local disabled, and stages a `CadGPT.Stage0.bundle` under the ignored `bin/stage0-bundle` directory.

Direct add-in builds are intentionally blocked unless host validation is supplied by the build script.

## Development load

Use a scoped trusted path or the staged bundle. Do not disable AutoCAD secure loading globally.

After NETLOAD of the built DLL, run:

```text
CGSTAGE0
```

Lifecycle recreation command:

```text
CGSTAGE0RECREATE
```

The dedicated WebView2 profile is stored under:

```text
%LOCALAPPDATA%\CadGPT\runtime\autocad-addin\stage0-webview2
```

Only ordinary ChatGPT navigation URLs are remembered as convenience state. The shell does not inspect cookies, browser storage, connector headers, auth tokens, or work handles.

## CP1 acceptance

CP1 remains unverified until the real host proves probe/build success, palette lifecycle, ChatGPT login/existing-chat access, and profile persistence across AutoCAD reopen.
