@echo off
rem ROMCAB CTC - porneste serverul pentru sarcina programata (nu il rulati manual; folositi start.bat).
rem Jurnalul este data\server.log; peste 5 MB se muta in data\server.old.log (inlocuieste jurnalul vechi).
setlocal
cd /d "%~dp0"
if not exist "%~dp0data" mkdir "%~dp0data"
if exist "%~dp0data\server.log" for %%F in ("%~dp0data\server.log") do if %%~zF GTR 5000000 move /y "%~dp0data\server.log" "%~dp0data\server.old.log" >nul
"%~dp0node\node.exe" --no-warnings "%~dp0app\server.js" >> "%~dp0data\server.log" 2>&1
