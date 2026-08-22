@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem TediaPros Ollama LAN starter.
rem Run this file once as Administrator to install the ONSTART task.

set "TASK_NAME=TediaPros Ollama LAN"
set "FIREWALL_RULE=TediaPros Ollama LAN 11434"
set "OLLAMA_HOST=0.0.0.0:11434"

fltmc >nul 2>&1
if errorlevel 1 (
  echo Dang yeu cau quyen Administrator...
  set "TEDIAPROS_BAT=%~f0"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:TEDIAPROS_BAT; $q=[char]34; Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/k','call',($q+$p+$q)) -Verb RunAs"
  endlocal
  exit /b 0
)

set "OLLAMA_EXE="
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA_EXE if exist "%ProgramFiles%\Ollama\ollama.exe" set "OLLAMA_EXE=%ProgramFiles%\Ollama\ollama.exe"
if not defined OLLAMA_EXE for /f "delims=" %%I in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
if not defined OLLAMA_EXE (
  echo [ERROR] Khong tim thay ollama.exe. Hay cai Ollama truoc.
  pause
  exit /b 1
)

rem Ollama models are normally stored in the current user's profile. The
rem scheduled SYSTEM task receives this path explicitly below. Short paths
rem keep the schtasks command safe even when the Windows user name has spaces.
set "OLLAMA_MODELS=%USERPROFILE%\.ollama\models"
for %%I in ("%OLLAMA_EXE%") do set "OLLAMA_TASK_EXE=%%~sI"
for %%I in ("%OLLAMA_MODELS%") do set "OLLAMA_TASK_MODELS=%%~sI"
set "LOG_DIR=%ProgramData%\TediaPros"
set "LOG_FILE=%LOG_DIR%\ollama-lan-start.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

rem Allow only the Windows Private profile; do not expose Ollama publicly.
netsh advfirewall firewall delete rule name="%FIREWALL_RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%FIREWALL_RULE%" dir=in action=allow protocol=TCP localport=11434 profile=private >nul
if errorlevel 1 echo [WARN] Khong them duoc firewall rule. May LAN co the khong truy cap duoc.

rem Register a hidden SYSTEM task. It starts before any user logs in and keeps
rem ollama serve in the background until the stop file removes the task.
set "TASK_RUN=%ComSpec% /d /c set OLLAMA_HOST=%OLLAMA_HOST%&&set OLLAMA_MODELS=%OLLAMA_TASK_MODELS%&&%OLLAMA_TASK_EXE% serve"
schtasks.exe /Create /TN "%TASK_NAME%" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "%TASK_RUN%" /F >"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] Khong dang ky duoc Scheduled Task.
  echo -------- %LOG_FILE% --------
  type "%LOG_FILE%"
  echo --------------------------------
  pause
  exit /b 1
)

schtasks.exe /Query /TN "%TASK_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Da tao task nhung khong doc lai duoc task.
  type "%LOG_FILE%"
  pause
  exit /b 1
)

taskkill /F /IM ollama.exe >nul 2>&1
schtasks.exe /Run /TN "%TASK_NAME%" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERROR] Da tao task nhung khong khoi dong duoc Ollama.
  type "%LOG_FILE%"
  pause
  exit /b 1
)

echo Ollama LAN da bat nen va se tu khoi dong khi bat may, khong can dang nhap.
echo URL cho may khac trong LAN: http://IP-MAY-NAY:11434
echo Log: %LOG_FILE%
echo.
pause
endlocal
exit /b 0
