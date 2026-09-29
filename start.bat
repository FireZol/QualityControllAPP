@echo off
rem ROMCAB CTC - pornire in consola (pentru prima pornire si pentru teste).
rem Foloseste Node.js portabil din folderul node\ ; daca lipseste, incearca node din PATH.
setlocal
cd /d "%~dp0"
if exist "%~dp0node\node.exe" (
  set "NODE=%~dp0node\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Nu s-a gasit Node.js. Copiati Node.js portabil in folderul node\ ^(fisierul node\node.exe^).
    pause
    exit /b 1
  )
  set "NODE=node"
)
if not exist "%~dp0config.json" if exist "%~dp0config.example.json" copy "%~dp0config.example.json" "%~dp0config.json" >nul
"%NODE%" --no-warnings "%~dp0app\server.js"
echo.
echo Serverul s-a oprit.
pause
