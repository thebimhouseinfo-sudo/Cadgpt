' CadGPT silent tray launcher for interactive Windows user logon.
' Keep a best-effort stage trace independently of PowerShell startup.
On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If Err.Number <> 0 Then WScript.Quit 2
Err.Clear

Sub StartupLog(stage)
    On Error Resume Next
    Dim localData, logRoot, logDir, stream
    localData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
    If Len(localData) = 0 Or InStr(localData, "%") > 0 Then Exit Sub
    logRoot = localData & "\CadGPT"
    logDir = logRoot & "\logs"
    If Not fso.FolderExists(logRoot) Then fso.CreateFolder logRoot
    If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
    Set stream = fso.OpenTextFile(logDir & "\startup-launch.log", 8, True)
    If Not stream Is Nothing Then
        stream.WriteLine Now & " | " & stage
        stream.Close
    End If
    Err.Clear
End Sub

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = scriptDir & "\cadgpt-tray.ps1"
StartupLog "wscript_invoked"
If Not fso.FileExists(trayScript) Then
    StartupLog "tray_script_missing"
    WScript.Quit 3
End If

args = ""
If WScript.Arguments.Count > 0 Then
    For i = 0 To WScript.Arguments.Count - 1
        args = args & " " & WScript.Arguments(i)
    Next
End If

cmd = "powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & trayScript & """" & args
Err.Clear
WshShell.Run cmd, 0, False
If Err.Number <> 0 Then
    StartupLog "powershell_dispatch_failed"
    WScript.Quit 4
End If
StartupLog "powershell_dispatched"
