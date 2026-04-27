@echo off
title KI Connect - Update
cd /d "%~dp0"

set BASE_URL=https://raw.githubusercontent.com/Waldemar-Koch-git/KiConnect/main/KiConnect

echo.
echo  ==========================================
echo       KI Connect - Update wird geprueft
echo  ==========================================
echo.

REM -- Pruefen ob curl vorhanden (ab Windows 10 eingebaut) ----
curl --version >nul 2>&1
if errorlevel 1 (
    echo  [FEHLER] curl nicht gefunden.
    echo  Bitte Windows 10 oder neuer verwenden.
    echo.
    pause
    exit /b 1
)

REM -- Pruefen ob Internetverbindung besteht ------------------
curl --silent --head --fail "https://raw.githubusercontent.com" >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Kein Internet - Update wird uebersprungen.
    echo.
    goto :end
)

echo  Lade aktuellste Dateien von GitHub...
echo.

REM -- Liste aller Dateien die aktualisiert werden sollen -----
call :download "comm\kiconnect.css"
call :download "comm\kiconnect.html"
call :download "comm\kiconnect.js"
call :download "comm\kiconnect-languages-i18n.js"
call :download "comm\kiconnect-proxy.py"


echo.
echo  [OK] Update abgeschlossen.
echo.
goto :end


REM ============================================================
REM  Hilfsfunktion: Eine Datei herunterladen
REM  Parameter: %1 = relativer Pfad zur Datei (z.B. "comm\datei.py")
REM ============================================================
:download
    set REMOTE_FILE=%~1
    set LOCAL_FILE=%~dp0%REMOTE_FILE%
    set REMOTE_URL=%BASE_URL%/%REMOTE_FILE:\=/%

    REM -- Zielordner anlegen falls nicht vorhanden
    for %%F in ("%LOCAL_FILE%") do (
        if not exist "%%~dpF" mkdir "%%~dpF"
    )

    REM -- Datei herunterladen (--fail: bei 404 kein leere Datei)
    curl --silent --fail --location --output "%LOCAL_FILE%" "%REMOTE_URL%"
    if errorlevel 1 (
        echo  [ !! ] Konnte nicht laden: %REMOTE_FILE%
    ) else (
        echo  [ OK ] %REMOTE_FILE%
    )
    goto :eof


:end
