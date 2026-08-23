@echo off
setlocal
title KI Connect - Update
cd /d "%~dp0"

REM ==============================================================
REM  What this script does, in plain terms (also useful if you ever
REM  need to explain this to an antivirus false-positive report):
REM    1. Downloads the current KiConnect repo as a single zip file.
REM    2. Extracts it to a temp folder next to this script.
REM    3. Copies new/changed files into comm\ (never deletes anything
REM       there except the few explicitly-named retired files listed
REM       in LEGACY_FILES below).
REM    4. Deletes the temp folder again.
REM  Nothing here modifies files outside this script's own folder,
REM  nothing re-executes itself, and every step prints what it's
REM  doing instead of running silently.
REM ==============================================================

set RAW_BASE_URL=https://raw.githubusercontent.com/Waldemar-Koch-git/KiConnect/main/KiConnect
set REPO_ZIP_URL=https://github.com/Waldemar-Koch-git/KiConnect/archive/refs/heads/main.zip
set TMP_DIR=%~dp0.update_tmp

REM -- Files retired by past refactors that robocopy (see below) --
REM    won't remove on its own, since it only adds/updates and never
REM    deletes on its own initiative. Add a new entry here, by exact
REM    name, on the rare occasion a future refactor retires a file -
REM    this is a deliberate, human-reviewed edit, not a blanket rule.
set LEGACY_FILES=comm\kiconnect.js comm\kiconnect-agent.js comm\kiconnect-voice.js comm\kiconnect-db.js

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
curl --head --fail "https://raw.githubusercontent.com" >nul 2>&1
if errorlevel 1 (
    echo  [INFO] No internet connection - Update skipped.
    echo.
    goto :end
)

REM -- Ask GitHub for the latest commit hash on main, cheaply -----
REM This is a tiny JSON response (a few hundred bytes), not the repo
REM itself - lets us skip the ~6.5 MB zip download entirely on every
REM run where nothing actually changed upstream. GitHub's API
REM requires a User-Agent header or it returns 403.
if exist "%TMP_DIR%" rd /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"

set REMOTE_SHA=
curl --fail --location -H "User-Agent: KiConnect-Updater" -H "Accept: application/vnd.github+json" --output "%TMP_DIR%\commit.json" "https://api.github.com/repos/Waldemar-Koch-git/KiConnect/commits/main"
if errorlevel 1 (
    echo  [INFO] Could not reach the GitHub API - will do a full sync to be safe.
) else (
    for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "try { (Get-Content -Raw '%TMP_DIR%\commit.json' | ConvertFrom-Json).sha } catch { '' }"`) do set REMOTE_SHA=%%S
)

set LOCAL_SHA=
set VERSION_FILE=%~dp0kiconnect_version.txt
if exist "%VERSION_FILE%" set /p LOCAL_SHA=<"%VERSION_FILE%"

if not "%REMOTE_SHA%"=="" if "%REMOTE_SHA%"=="%LOCAL_SHA%" (
    echo  [ OK ] Already up to date ^(commit %REMOTE_SHA:~0,7%^) - nothing to download.
    rd /s /q "%TMP_DIR%" 2>nul
    echo.
    call :ensure_render
    echo.
    echo  [OK] Update check completed.
    echo.
    goto :end
)

if "%REMOTE_SHA%"=="" (
    echo  [INFO] Version check unavailable - proceeding with sync anyway.
) else (
    echo  [INFO] New version found ^(%LOCAL_SHA:~0,7% -^> %REMOTE_SHA:~0,7%^) - updating...
)
echo.

REM -- Refresh this script's own file for NEXT run ---------------
REM Unlike before, this no longer re-launches itself mid-run (that
REM self-relaunch-with-hidden-flag pattern is exactly what triggers
REM antivirus heuristics - see Kaspersky PDM:Trojan.Win32.Generic
REM false positives). If update.bat's own logic changed upstream,
REM the new version is saved to disk and used automatically the
REM NEXT time you run START.bat - this run continues with what's
REM already loaded in memory, which is fine for routine updates.
echo  Checking for a newer update.bat ^(applies next run^)...
curl --fail --location --output "update.bat.new" "%RAW_BASE_URL%/update.bat"
if errorlevel 1 (
    echo  [ !! ] Could not check update.bat itself - continuing anyway.
    if exist "update.bat.new" del /f /q "update.bat.new"
) else (
    fc /b "update.bat.new" "update.bat" >nul 2>&1
    if errorlevel 1 (
        move /y "update.bat.new" "update.bat" >nul
        echo  [ OK ] update.bat updated - will be used on next start.
    ) else (
        del /f /q "update.bat.new"
        echo  [ OK ] update.bat already current.
    )
)
echo.

echo  Downloading latest version as a single archive...
echo.

REM -- Zip download reuses %TMP_DIR%, already created above for the
REM    commit-hash check.
if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

REM -- Download the whole repo (main branch) as a zip -------------
REM No --silent: progress is shown, nothing happens invisibly.
curl --fail --location --output "%TMP_DIR%\repo.zip" "%REPO_ZIP_URL%"
if errorlevel 1 (
    echo  [ !! ] Could not download repo archive.
    echo  Please check your internet connection.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)
echo  [ OK ] Archive downloaded.

REM -- Extract it ---------------------------------------------------
echo  [INFO] Extracting...
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMP_DIR%\repo.zip' -DestinationPath '%TMP_DIR%\extracted' -Force"
if errorlevel 1 (
    echo  [ !! ] Extraction failed.
    rd /s /q "%TMP_DIR%" 2>nul
    goto :end
)

REM -- GitHub zips the repo into a single top folder named
REM    "{repo}-{branch}" (e.g. "KiConnect-main") - found here without
REM    hardcoding the branch name, in case the default branch changes.
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

REM -- Copy new/changed files into comm\ -----------------------------
REM Deliberately no /MIR here. /MIR would delete any local file not
REM present upstream - the exact "downloads something, then silently
REM deletes local files" pattern antivirus heuristics flag as
REM ransomware/wiper behavior. This only adds and overwrites; nothing
REM in comm\ is ever removed by this step. /E includes empty
REM subfolders so new folders like a future comm\js\newarea\ show up
REM even before they contain files.
REM /XD excludes folders that must never be touched by an update:
REM   datas\    - locally-created, holds your encrypted accounts
REM   _render\  - vendored third-party libs, fetched separately below
REM                (kept out of the main repo zip to keep updates small)
echo  [INFO] Copying updated files into comm\ ...
robocopy "%SRC_COMM%" "%~dp0comm" /E /R:1 /W:1 /XD "%~dp0comm\_render" "%~dp0comm\datas"
REM robocopy's exit codes are not plain 0/1: 0-7 all mean success
REM (e.g. 1 = files copied, 3 = files copied + some already current),
REM 8+ means a real error. "if errorlevel 8" is true for any code >=8.
if errorlevel 8 (
    echo  [ !! ] Copy reported errors - comm\ may be incomplete.
) else (
    echo  [ OK ] comm\ files copied/updated.
)

REM -- Remove the small, explicitly-named list of retired files -----
REM Bounded and named on purpose - see LEGACY_FILES comment above.
for %%F in (%LEGACY_FILES%) do (
    if exist "%~dp0%%F" (
        echo  [INFO] Removing retired file: %%F
        del /f /q "%~dp0%%F"
    )
)

REM -- Clean up temp files --------------------------------------------
rd /s /q "%TMP_DIR%" 2>nul

REM -- Remember this version so next run can skip the download --------
REM Only written when we actually got a real hash back - if the API
REM call failed earlier we don't want to write an empty/wrong value.
if not "%REMOTE_SHA%"=="" (
    > "%VERSION_FILE%" echo %REMOTE_SHA%
)

echo.
call :ensure_render

echo.
echo  [OK] Update completed.
echo.
goto :end


REM ============================================================
REM  Helper function: Ensure "comm\_render" exists and is filled
REM  Unchanged behavior: _render is ~13 MB of vendored, rarely-
REM  changing third-party libs (MathJax/marked/DOMPurify/PDF.js) kept
REM  out of the repo zip on purpose and fetched once as its own zip,
REM  so routine updates stay small and fast.
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
        curl --fail --location --output "%RENDER_ZIP%" "%RENDER_ZIP_URL%"
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
