@echo off
setlocal
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

REM -- Self-update: fetch the newest update.bat FIRST and relaunch it ----
REM Older local copies of this script don't know about files added in later
REM releases (e.g. kiconnect-agent.js, kiconnect-mathjax-config.js). By
REM downloading update.bat first and re-launching the freshly downloaded
REM copy, the rest of this run always uses the CURRENT file list below -
REM not whatever list happened to be baked into the copy already on disk.
REM KICONNECT_UPDATE_RELAUNCHED guards against looping forever (e.g. if the
REM download itself fails) and %1=="_child" lets the relaunched copy skip
REM straight past this block instead of downloading update.bat twice.
if /i "%~1"=="_child" goto :after_selfupdate

echo  Checking update.bat itself...
call :download "update.bat"
echo.

if not "%KICONNECT_UPDATE_RELAUNCHED%"=="1" (
    set KICONNECT_UPDATE_RELAUNCHED=1
    call "%~f0" _child
    exit /b %errorlevel%
)

:after_selfupdate
echo  Downloading latest files from GitHub...
echo.

REM -- List of all files to be updated --------------------------
call :download "comm\kiconnect.css"
call :download "comm\kiconnect.html"
call :download "comm\kiconnect.js"
call :download "comm\kiconnect-agent.js"
call :download "comm\kiconnect-languages-i18n.js"
call :download "comm\kiconnect-mathjax-config.js"
call :download "comm\kiconnect-proxy.py"
call :download "comm\kiconnect-voice.js"

echo.
echo  Downloading language files...
REM -- comm\_lang didn't exist in older versions - :download creates
REM    missing folders on its own, so this works on any PC. -----------
for %%L in (ar bn de el en es fa fr hi it pa ru ta tr ur zh) do (
    call :download "comm\_lang\%%L.js"
)

echo.
call :ensure_render

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


REM ============================================================
REM  Helper function: Ensure "comm\_render" exists and is filled
REM  - If folder is missing or empty:
REM      1) create it if missing
REM      2) download _render.zip if not already present
REM      3) extract it into comm\_render
REM  - If folder already exists and contains files: do nothing
REM ============================================================
:ensure_render
    set RENDER_DIR=%~dp0comm\_render
    set RENDER_ZIP=%~dp0comm\_render.zip
    set RENDER_ZIP_URL=%BASE_URL%/comm/_render.zip

    REM -- Create folder if missing
    if not exist "%RENDER_DIR%" (
        echo  [INFO] "_render" folder not found - creating...
        mkdir "%RENDER_DIR%"
    )

    REM -- Check if folder is empty (dir /a /b lists any entry, files or subfolders)
    set RENDER_EMPTY=1
    for /f %%A in ('dir /a /b "%RENDER_DIR%" 2^>nul') do (
        set RENDER_EMPTY=0
        goto :render_check_done
    )
    :render_check_done

    if "%RENDER_EMPTY%"=="0" (
        echo  [ OK ] comm\_render already present - skipping download.
        goto :eof
    )

    echo  [INFO] comm\_render is empty - fetching _render.zip...

    REM -- Download zip only if not already present locally
    if not exist "%RENDER_ZIP%" (
        curl --silent --fail --location --output "%RENDER_ZIP%" "%RENDER_ZIP_URL%"
        if errorlevel 1 (
            echo  [ !! ] Could not download: comm\_render.zip
            goto :eof
        ) else (
            echo  [ OK ] comm\_render.zip downloaded.
        )
    ) else (
        echo  [ OK ] comm\_render.zip already exists locally - using it.
    )

    REM -- Extract zip into comm\_render using PowerShell
    echo  [INFO] Extracting _render.zip...
    powershell -NoProfile -Command "Expand-Archive -LiteralPath '%RENDER_ZIP%' -DestinationPath '%RENDER_DIR%' -Force"
    if errorlevel 1 (
        echo  [ !! ] Extraction failed.
        goto :eof
    )

    echo  [ OK ] comm\_render extracted successfully.
    goto :eof


:end
endlocal
