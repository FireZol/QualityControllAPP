@echo off
rem ROMCAB CTC - sterge pornirea automata (datele din data\ ramane neatinse). Rulati ca Administrator.
net session >nul 2>nul
if errorlevel 1 (
  echo Rulati acest fisier ca Administrator.
  pause
  exit /b 1
)
schtasks /end /tn ROMCAB-CTC >nul 2>nul
schtasks /delete /tn ROMCAB-CTC /f
echo.
echo Sarcina a fost stearsa. Baza de date din data\ nu a fost modificata.
pause
