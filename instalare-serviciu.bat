@echo off
rem ROMCAB CTC - inregistreaza pornirea automata la boot (Task Scheduler). Rulati ca Administrator.
setlocal
cd /d "%~dp0"
net session >nul 2>nul
if errorlevel 1 (
  echo Rulati acest fisier ca Administrator ^(click dreapta - Run as administrator^).
  pause
  exit /b 1
)
if not exist "%~dp0node\node.exe" (
  echo Lipseste node\node.exe. Copiati Node.js portabil in folderul node\ si reluati.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalare-serviciu.ps1" -Root "%~dp0"
if errorlevel 1 (
  echo Inregistrarea a esuat.
  pause
  exit /b 1
)
echo.
echo Gata. Sarcina "ROMCAB-CTC" porneste la fiecare pornire a serverului, ruleaza chiar daca nimeni nu este autentificat
echo si se reporneste automat daca se opreste. Pornire acum: schtasks /run /tn ROMCAB-CTC
pause
