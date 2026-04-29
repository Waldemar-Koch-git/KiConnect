@echo off
title KI Connect - Update
cd /d "%~dp0"

set BASE_URL=https://raw.githubusercontent.com/Waldemar-Koch-git/KiConnect/main/KiConnect

echo.
echo  ==========================================
echo       KI Connect - Checking for Updates
echo  ==========================================
echo.

REM -- Check if curl is available (built-in from Windows 10) ----
curl --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] curl not found.
    echo  Please use Windows 10 or newer.
    echo.
    pause
    exit /b 1
)

REM -- Check if internet connection exists ----------------------
curl --silent --head --fail "https://raw.githubusercontent.com" >nul 2>&1
if errorlevel 1 (
    echo  [INFO] No internet connection - Update skipped.
    echo.
    goto :end
)

echo  Downloading latest files from GitHub...
echo.

REM -- List of all files to be updated --------------------------
call :download "comm\kiconnect.css"
call :download "comm\kiconnect.html"
call :download "comm\kiconnect.js"
call :download "comm\kiconnect-languages-i18n.js"
call :download "comm\kiconnect-proxy.py"
call :download "comm\kiconnect-voice.js"
call :download "update.bat"


echo.
echo  [OK] Update completed.
echo.
goto :end


REM ============================================================
REM  Helper function: Download a single file
REM  Parameter: %1 = relative path to file (e.g. "comm\file.py")
REM ============================================================
:download
    set REMOTE_FILE=%~1
    set LOCAL_FILE=%~dp0%REMOTE_FILE%
    set REMOTE_URL=%BASE_URL%/%REMOTE_FILE:\=/%

    REM -- Create target folder if it doesn't exist
    for %%F in ("%LOCAL_FILE%") do (
        if not exist "%%~dpF" mkdir "%%~dpF"
    )

    REM -- Download file (--fail: don't create empty file on 404)
    curl --silent --fail --location --output "%LOCAL_FILE%" "%REMOTE_URL%"
    if errorlevel 1 (
        echo  [ !! ] Could not download: %REMOTE_FILE%
    ) else (
        echo  [ OK ] %REMOTE_FILE%
    )
    goto :eof


:end
