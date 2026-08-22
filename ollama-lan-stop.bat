@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "TASK_NAME=TediaPros Ollama LAN"
set "FIREWALL_RULE=TediaPros Ollama LAN 11434"
set "OLLAMA_TASK_NAME=%TASK_NAME%"

fltmc >nul 2>&1
if errorlevel 1 (
  echo Dang yeu cau quyen Administrator...
  set "TEDIAPROS_BAT=%~f0"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:TEDIAPROS_BAT; $q=[char]34; Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/k','call',($q+$p+$q)) -Verb RunAs"
  endlocal
  exit /b 0
)

rem Disable and remove the boot task so the next boot stays stopped.
schtasks.exe /End /TN "%TASK_NAME%" >nul 2>&1
schtasks.exe /Delete /TN "%TASK_NAME%" /F >nul 2>&1
taskkill /F /IM ollama.exe >nul 2>&1
netsh advfirewall firewall delete rule name="%FIREWALL_RULE%" >nul 2>&1

echo Ollama LAN da tat va se khong tu khoi dong lai o lan bat may tiep theo.
echo.
pause
endlocal
exit /b 0
