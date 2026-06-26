Dim oShell, strDir
Set oShell = CreateObject("WScript.Shell")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)

' Start static server (port 3000) — hidden window, no CMD popup
oShell.Run "cmd /c cd /d """ & strDir & """ && node serve.mjs > """ & strDir & "\serve.log"" 2>&1", 0, False

' Start API server (port 3001) — hidden window, no CMD popup
oShell.Run "cmd /c cd /d """ & strDir & """ && node --env-file=.env server.js > """ & strDir & "\server.log"" 2>&1", 0, False

MsgBox "Tester.io servers are starting..." & vbCrLf & vbCrLf & _
       "  Static server: http://localhost:3000" & vbCrLf & _
       "  Dashboard:     http://localhost:3000/dashboard.html" & vbCrLf & vbCrLf & _
       "Logs: serve.log and server.log in project folder." & vbCrLf & _
       "To stop servers, open Task Manager and end node.exe processes.", _
       64, "Tester.io"
