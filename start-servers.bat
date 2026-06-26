@echo off
cd /d "%~dp0"

echo Starting Tester.io servers...

start "Static Server :3000" cmd /k "node serve.mjs"
start "API Server :3001" cmd /k "node --env-file=.env server.js"

echo.
echo Both servers launched:
echo   Static    ^>  http://localhost:3000
echo   API       ^>  http://localhost:3001
echo   Dashboard ^>  http://localhost:3000/dashboard.html
echo.
