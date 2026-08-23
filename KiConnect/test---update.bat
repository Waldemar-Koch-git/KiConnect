@echo off
setlocal
title KI Connect - Update
cd /d "%~dp0"

REM ==============================================================
REM  v4.0.0+: this used to download ~9 hardcoded files one by one.
REM  Since the v4.0.0 modularization split that into ~25 files across
REM  6 nested folders under comm\js\, a hardcoded list would need a
REM  manual edit here every time a file is added, renamed, or moved.
REM  Instead this now mirrors the whole comm\ folder from a full repo
REM  zip via robocopy /MIR - new/moved/deleted files are picked up
REM  automatically, no list to maintain.
REM ==============================================================

set RAW_BASE_URL=https://raw.githubusercontent.com/Waldemar-Koch-git/KiConnect/main/KiConnect
set REPO_ZIP_URL=https://github.com/Waldemar-Koch-git/KiConnect/archive/refs/heads/main.zip
set TMP_DIR=%~dp0.update_tmp

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
REM Older local copies of this script don't know about later changes to
REM the update mechanism itself. By downloading update.bat first and
REM re-launching the freshly downloaded copy, the rest of this run
REM always uses the CURRENT update logic below - not whatever was baked
REM into the copy already on disk.
REM KICONNECT_UPDATE_RELAUNCHED guards against looping forever (e.g. if
REM the download itself fails) and %1=="_child" lets the relaunched copy
REM skip straight past this block instead of downloading update.bat twice.
if /i "%~1"=="_child" goto :after_selfupdate

echo  Checking update.bat itself...
call :download_single "update.bat"
echo.

if not "%KICONNECT_UPDATE_RELAUNCHED%"=="1" (
    set KICONNECT_UPDATE_RELAUNCHED=1
    call "%~f0" _child
    exit /b %errorlevel%
)

:after_selfupdate
echo  Downloading latest version as a single archive...
echo.

REM -- Clean up any leftover temp dir from a previous failed run --
if exist "%TMP_DIR%" rd /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"

REM -- Download the whole repo (main branch) as a zip --------------
curl --silent --fail --location --output "%TMP_DIR%\repo.zip" "%REPO_ZIP_URL%"
if errorlevel 1 (
    echo  [ !! ] Could not download repo archive.
    echo  Please check your internet connection.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)
echo  [ OK ] Archive downloaded.

REM -- Extract it -----------------------------------------------
echo  [INFO] Extracting...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMP_DIR%\repo.zip' -DestinationPath '%TMP_DIR%\extracted' -Force"
if errorlevel 1 (
    echo  [ !! ] Extraction failed.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)

REM -- GitHub zips the repo into a single top folder named
REM    "{repo}-{branch}" (e.g. "KiConnect-main") - find it without
REM    hardcoding the branch name so this keeps working if the
REM    default branch is ever renamed.
set EXTRACTED_ROOT=
for /d %%D in ("%TMP_DIR%\extracted\*") do set EXTRACTED_ROOT=%%D

if "%EXTRACTED_ROOT%"=="" (
    echo  [ !! ] Could not find extracted repo folder - archive layout unexpected.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)

set SRC_COMM=%EXTRACTED_ROOT%\KiConnect\comm

if not exist "%SRC_COMM%" (
    echo  [ !! ] Expected folder not found in archive:
    echo         %SRC_COMM%
    echo  The repo layout may have changed - check REPO_ZIP_URL / the
    echo  KiConnect\comm\ path assumption at the top of this script.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)

REM -- Mirror into local comm\ -------------------------------------
REM /MIR makes local comm\ match the repo exactly, including removing
REM files that no longer exist upstream (old leftovers get cleaned up
REM automatically - no more stale kiconnect.js-era files lying around).
REM /XD excludes folders that must never be touched by an update:
REM   datas\    - locally-created, holds the user's encrypted accounts
REM   _render\  - vendored third-party libs, kept out of the repo zip
REM               and instead fetched once via _render.zip (see below)
echo  [INFO] Syncing comm\ ...
robocopy "%SRC_COMM%" "%~dp0comm" /MIR /XD "%~dp0comm\_render" "%~dp0comm\datas" /R:1 /W:1 /NFL /NDL /NJH /NP
REM robocopy's exit codes are not 0/1 like normal commands: 0-7 all mean
REM success (7 = files copied + some skipped, still fine), 8+ means a
REM real error. "if errorlevel 8" is true for any code >=8.
if errorlevel 8 (
    echo  [ !! ] Sync reported errors - comm\ may be incomplete.
) else (
    echo  [ OK ] comm\ is up to date.
)

REM -- Clean up temp files ------------------------------------------
rd /s /q "%TMP_DIR%" 2>nul

echo.
call :ensure_render

echo.
echo  [OK] Update completed.
echo.
goto :end


REM ============================================================
REM  Helper function: Download a single file via raw.githubusercontent
REM  Used only for update.bat's own self-update (see above) - the
REM  rest of the app is synced via the repo-zip mirror above.
REM  Parameter: %1 = relative path to file (e.g. "update.bat")
REM ============================================================
:download_single
    set REMOTE_FILE=%~1
    set LOCAL_FILE=%~dp0%REMOTE_FILE%
    set REMOTE_URL=%RAW_BASE_URL%/%REMOTE_FILE:\=/%

    for %%F in ("%LOCAL_FILE%") do (
        if not exist "%%~dpF" mkdir "%%~dpF"
    )

    curl --silent --fail --location --output "%LOCAL_FILE%" "%REMOTE_URL%"
    if errorlevel 1 (
        echo  [ !! ] Could not download: %REMOTE_FILE%
    ) else (
        echo  [ OK ] %REMOTE_FILE%
    )
    goto :eof


REM ============================================================
REM  Helper function: Ensure "comm\_render" exists and is filled
REM  Unchanged from before - _render is ~13 MB of vendored,
REM  rarely-changing third-party libs (MathJax/marked/DOMPurify/PDF.js)
REM  kept out of the repo zip on purpose and fetched once as its own
REM  zip, so routine updates stay small and fast.
REM  - If folder is missing or empty:
REM      1) create it if missing
REM      2) download _render.zip if not already present
REM      3) extract it into comm\_render
REM  - If folder already exists and contains files: do nothing
REM ============================================================
:ensure_render
    set RENDER_DIR=%~dp0comm\_render
    set RENDER_ZIP=%~dp0comm\_render.zip
    set RENDER_ZIP_URL=%RAW_BASE_URL%/comm/_render.zip

    if not exist "%RENDER_DIR%" (
        echo  [INFO] "_render" folder not found - creating...
        mkdir "%RENDER_DIR%"
    )

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
