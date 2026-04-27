@echo off
title KI Connect
cd /d "%~dp0"

echo.
echo  ==========================================
echo       KI Connect - Starting...
echo  ==========================================
echo.

REM -- Update laden -------------------------------------------
call "%~dp0update.bat"

REM -- Python pruefen -----------------------------------------
python --version >nul 2>&1
if errorlevel 1 (
    echo  [FEHLER] Python nicht gefunden.
    echo  Bitte installieren: https://python.org
    echo.
    pause
    exit /b 1
)

echo  Installiere / aktualisiere Abhaengigkeiten...
pip install "flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0" --quiet --upgrade

echo.
echo  ------------------------------------------
echo   Proxy startet  ^(Waitress WSGI^)
echo   Browser:  http://localhost:5000
echo   Stoppen:  Strg+C oder Fenster schliessen
echo  ------------------------------------------
echo.

python "%~dp0comm\kiconnect-proxy.py"

pause
