@echo off
cd /d "%~dp0"

echo Starting Tester.io servers...

:: Load .env variables
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

:: Strip surrounding quotes from DASHBOARD_PASSWORD if present
set DASHBOARD_PASSWORD=%DASHBOARD_PASSWORD:"=%

:: Start static file server (port 3000)
start "Static Server :3000" cmd /k "node serve.mjs"

:: Start API server (port 3001)
start "API Server :3001" cmd /k "node server.js"

echo.
echo Both servers launched:
echo   Static  ^>  http://localhost:3000
echo   API     ^>  http://localhost:3001
echo   Dashboard ^> http://localhost:3000/dashboard.html
echo.
