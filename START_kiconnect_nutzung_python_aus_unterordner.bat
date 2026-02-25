@echo off
title KI Connect
cd /d "%~dp0"

set PYTHON=%~dp0python\python.exe
set PIP=%~dp0python\python.exe -m pip
set PACKAGES=flask requests waitress
set MIN_VERSIONS="flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0"

echo.
echo  ==========================================
echo       KI Connect - Starting...
echo  ==========================================
echo.

REM -- Pruefen ob portable Python vorhanden -------------------
if not exist "%PYTHON%" (
    echo  [FEHLER] Portable Python nicht gefunden!
    echo.
    echo  Erwartet unter:
    echo    %PYTHON%
    echo.
    echo  Bitte portable Python herunterladen:
    echo    https://www.python.org/downloads/windows/
    echo    ^(Embeddable Package, z.B. python-3.12.x-embed-amd64.zip^)
    echo.
    echo  Entpacken in den Ordner "python\" neben dieser Datei.
    echo  Danach diese BAT erneut starten.
    echo.
    pause
    exit /b 1
)

REM -- Python-Version anzeigen --------------------------------
for /f "tokens=*" %%v in ('"%PYTHON%" --version 2^>^&1') do set PYVER=%%v
echo  Python:  %PYVER%
echo  Pfad:    %PYTHON%
echo.

REM -- pip verfuegbar machen falls fehlend (embeddable package)
"%PYTHON%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] pip nicht gefunden - wird eingerichtet...
    echo.
    for %%f in ("%~dp0python\python*._pth") do (
        powershell -Command "(Get-Content '%%f') -replace '#import site','import site' | Set-Content '%%f'"
    )
    if not exist "%~dp0python\get-pip.py" (
        echo  [INFO] Lade get-pip.py herunter...
        powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%~dp0python\get-pip.py'"
        if errorlevel 1 (
            echo  [FEHLER] get-pip.py konnte nicht geladen werden.
            echo  Bitte manuell herunterladen: https://pip.pypa.io
            pause
            exit /b 1
        )
    )
    "%PYTHON%" "%~dp0python\get-pip.py" --quiet
    echo  [OK] pip eingerichtet.
    echo.
)

REM -- Abhaengigkeiten pruefen --------------------------------
echo  Pruefe Abhaengigkeiten...
set MISSING=0

for %%p in (%PACKAGES%) do (
    "%PYTHON%" -c "import %%p" >nul 2>&1
    if errorlevel 1 (
        echo  [ .. ] %%p fehlt - wird installiert...
        set MISSING=1
    ) else (
        echo  [ OK ] %%p
    )
)

if "%MISSING%"=="1" (
    echo.
    echo  Installiere fehlende Pakete...
    %PIP% install %MIN_VERSIONS% --quiet
    if errorlevel 1 (
        echo.
        echo  [FEHLER] Installation fehlgeschlagen!
        echo  Bitte Internetverbindung pruefen.
        pause
        exit /b 1
    )
    echo  [OK] Alle Pakete installiert.
)

echo.
echo  ------------------------------------------
echo   Proxy startet  ^(Waitress WSGI^)
echo   Browser:  http://localhost:5000
echo   Stoppen:  Strg+C oder Fenster schliessen
echo  ------------------------------------------
echo.

REM -- Proxy starten ------------------------------------------
"%PYTHON%" "%~dp0comm\kiconnect-proxy.py"

echo.
echo  Proxy wurde beendet.
pause
