Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run Chr(34) & scriptDir & "\\Run-App.bat" & Chr(34), 0, False
