@echo off
setlocal

set "LOGFILE=%~dp0start.log"
echo ============================== >> "%LOGFILE%"
echo %date% %time% Start TableCat >> "%LOGFILE%"

if not exist node_modules (
  echo Installing dependencies...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "npm install --no-audit --no-fund 2>&1 | Tee-Object -FilePath '%LOGFILE%' -Append"
  if errorlevel 1 goto :error
)

echo Starting TableCat...
powershell -NoProfile -ExecutionPolicy Bypass -Command "npm run dev 2>&1 | Tee-Object -FilePath '%LOGFILE%' -Append"
if errorlevel 1 goto :error

goto :eof

:error
echo Failed to start TableCat. See %LOGFILE%
pause
exit /b 1
