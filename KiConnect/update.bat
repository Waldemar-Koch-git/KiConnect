@echo off
setlocal
title KI Connect - Update
cd /d "%~dp0"

REM ==============================================================
REM  What this script does, in plain terms (also useful if you ever
REM  need to explain this to an antivirus false-positive report):
REM    1. Asks the GitHub API for the current commit hash on main (a
REM       few hundred bytes) - if it matches what we saved last time,
REM       nothing changed upstream and we stop here (after a quick
REM       check that comm\_render is present).
REM    2. If something changed: refreshes update.bat/START.bat/
REM       START_portable.bat for the NEXT run only (never overwrites
REM       a batch file that might currently be executing/paused on
REM       the call stack - see the comment further below).
REM    3. Hands off to kiconnect_sync.ps1, which asks GitHub for the
REM       full file tree (path + hash per file, still no file
REM       contents) and only downloads files whose hash actually
REM       changed since the last sync, and only removes local files
REM       that no longer exist upstream. comm\datas\ and comm\_render\
REM       are hard-excluded from that - always, no matter what.
REM    4. If step 3 can't run for some reason (tree truncated / GitHub
REM       unreachable), falls back to the old "download the whole repo
REM       as one zip" method as a safety net.
REM  Nothing here modifies files outside this script's own folder,
REM  nothing re-executes itself, and every step prints what it's
REM  doing instead of running silently.
REM ==============================================================

set REPO_OWNER=Waldemar-Koch-git
set REPO_NAME=KiConnect
set RAW_BASE_URL=https://raw.githubusercontent.com/%REPO_OWNER%/%REPO_NAME%/main/KiConnect
set REPO_ZIP_URL=https://github.com/%REPO_OWNER%/%REPO_NAME%/archive/refs/heads/main.zip
set TMP_DIR=%~dp0.update_tmp
set SYNC_SCRIPT=%~dp0kiconnect_sync.ps1
set MANIFEST_FILE=%~dp0kiconnect_manifest.json
set VERSION_FILE=%~dp0kiconnect_version.txt

REM -- Files that are cmd.exe-interpreted and may currently be
REM    executing (or paused on the call stack, e.g. START.bat calling
REM    this very script) - these are never overwritten directly, only
REM    staged as "<name>.new" and swapped in on the NEXT run. This is
REM    the same reasoning that already applied to update.bat itself;
REM    it now also covers START.bat/START_portable.bat.
set SELF_MANAGED_BATS=update.bat START.bat START_portable.bat

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
REM Tiny JSON response, not the repo itself - lets us skip everything
REM below entirely on every run where nothing actually changed
REM upstream. GitHub's API requires a User-Agent header or it 403s.
if exist "%TMP_DIR%" rd /s /q "%TMP_DIR%"
mkdir "%TMP_DIR%"

set REMOTE_SHA=
curl --fail --location -H "User-Agent: KiConnect-Updater" -H "Accept: application/vnd.github+json" --output "%TMP_DIR%\commit.json" "https://api.github.com/repos/%REPO_OWNER%/%REPO_NAME%/commits/main"
if errorlevel 1 (
    echo  [INFO] Could not reach the GitHub API - will do a full sync to be safe.
) else (
    for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "try { (Get-Content -Raw '%TMP_DIR%\commit.json' | ConvertFrom-Json).sha } catch { '' }"`) do set REMOTE_SHA=%%S
)

set LOCAL_SHA=
if exist "%VERSION_FILE%" set /p LOCAL_SHA=<"%VERSION_FILE%"

if not "%REMOTE_SHA%"=="" if "%REMOTE_SHA%"=="%LOCAL_SHA%" (
    echo  [ OK ] Already up to date ^(commit %REMOTE_SHA:~0,7%^) - nothing to check file-by-file.
    rd /s /q "%TMP_DIR%" 2>nul
    echo.
    call :ensure_render
    echo.
    echo  [OK] Update check completed.
    echo.
    goto :end
)

if "%REMOTE_SHA%"=="" (
    echo  [INFO] Version check unavailable - proceeding with a sync anyway.
) else (
    echo  [INFO] New version found ^(%LOCAL_SHA:~0,7% -^> %REMOTE_SHA:~0,7%^) - syncing changed files...
)
echo.

REM -- Refresh the self-managed batch files for the NEXT run ------
REM See SELF_MANAGED_BATS comment above for why these are staged
REM rather than overwritten now.
for %%F in (%SELF_MANAGED_BATS%) do call :refresh_self_managed "%%F"

REM -- Make sure the sync helper script itself is current. Safe to
REM    overwrite directly (unlike the .bat files above): it hasn't
REM    been launched yet this run, so nothing has it open/mid-parse.
echo  Checking kiconnect_sync.ps1...
curl --fail --location --output "%SYNC_SCRIPT%.new" "%RAW_BASE_URL%/kiconnect_sync.ps1"
if errorlevel 1 (
    echo  [ !! ] Could not fetch kiconnect_sync.ps1.
    if exist "%SYNC_SCRIPT%.new" del /f /q "%SYNC_SCRIPT%.new"
) else (
    if exist "%SYNC_SCRIPT%" (
        fc /b "%SYNC_SCRIPT%.new" "%SYNC_SCRIPT%" >nul 2>&1
        if errorlevel 1 ( move /y "%SYNC_SCRIPT%.new" "%SYNC_SCRIPT%" >nul & echo  [ OK ] kiconnect_sync.ps1 updated. ) else ( del /f /q "%SYNC_SCRIPT%.new" & echo  [ OK ] kiconnect_sync.ps1 already current. )
    ) else (
        move /y "%SYNC_SCRIPT%.new" "%SYNC_SCRIPT%" >nul
        echo  [ OK ] kiconnect_sync.ps1 downloaded.
    )
)
echo.

if not exist "%SYNC_SCRIPT%" (
    echo  [ !! ] kiconnect_sync.ps1 is unavailable - falling back to a full sync.
    call :full_zip_sync
    goto :after_sync
)

echo  Syncing changed files (this only downloads/removes what actually changed)...
echo.
REM -- Strip the trailing backslash from %~dp0 before quoting it. -----
REM A quoted path ending in "\" (e.g. "C:\foo\") makes cmd.exe's
REM argument parser treat the backslash as escaping the closing quote,
REM so the whole rest of the command line (including -ManifestPath and
REM its value) gets swallowed into -LocalRoot. PowerShell then never
REM sees -ManifestPath and prompts for it interactively, which is what
REM produced the "ManifestPath:" prompt.
set "LOCAL_ROOT=%~dp0"
if "%LOCAL_ROOT:~-1%"=="\" set "LOCAL_ROOT=%LOCAL_ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SYNC_SCRIPT%" -LocalRoot "%LOCAL_ROOT%" -ManifestPath "%MANIFEST_FILE%"
set SYNC_RC=%ERRORLEVEL%

if "%SYNC_RC%"=="2" (
    echo.
    echo  [INFO] Tree lookup was truncated - falling back to a full sync.
    call :full_zip_sync
) else if not "%SYNC_RC%"=="0" (
    echo.
    echo  [ !! ] File sync failed ^(code %SYNC_RC%^) - files were left as they were, will retry next run.
) else (
    if not "%REMOTE_SHA%"=="" ( > "%VERSION_FILE%" echo %REMOTE_SHA% )
)

:after_sync
rd /s /q "%TMP_DIR%" 2>nul

echo.
call :ensure_render

echo.
echo  [OK] Update completed.
echo.
goto :end


REM ============================================================
REM  Helper: refresh a self-managed .bat file from GitHub if it
REM  changed. Same pattern update.bat already used on itself before
REM  this rewrite (see the antivirus-heuristic comment near the top):
REM  fetch to "<name>.new", byte-compare, and if different, move the
REM  new copy over the old one *without* relaunching anything. This
REM  run keeps executing whatever cmd.exe already has buffered; only
REM  the *next* time the file is invoked (double-click, or the next
REM  "call") does the new content actually take effect - so this is
REM  safe even for update.bat calling this on itself.
REM ============================================================
:refresh_self_managed
    set "SM_NAME=%~1"
    curl --fail --location --output "%~dp0%SM_NAME%.new" "%RAW_BASE_URL%/%SM_NAME%"
    if errorlevel 1 (
        echo  [ !! ] Could not check %SM_NAME% - continuing anyway.
        if exist "%~dp0%SM_NAME%.new" del /f /q "%~dp0%SM_NAME%.new"
        goto :eof
    )
    if not exist "%~dp0%SM_NAME%" (
        move /y "%~dp0%SM_NAME%.new" "%~dp0%SM_NAME%" >nul
        echo  [ OK ] %SM_NAME% downloaded.
        goto :eof
    )
    fc /b "%~dp0%SM_NAME%.new" "%~dp0%SM_NAME%" >nul 2>&1
    if errorlevel 1 (
        move /y "%~dp0%SM_NAME%.new" "%~dp0%SM_NAME%" >nul
        echo  [ OK ] %SM_NAME% updated - will be used on next start.
    ) else (
        del /f /q "%~dp0%SM_NAME%.new"
        echo  [ OK ] %SM_NAME% already current.
    )
    goto :eof


REM ============================================================
REM  Fallback: the old "download the whole repo as a zip, robocopy
REM  into comm\" method. Only used if the tree-based sync can't run
REM  (GitHub API unreachable/truncated, or kiconnect_sync.ps1 itself
REM  couldn't be fetched on a fresh install). Kept deliberately close
REM  to how this script worked before the tree-diff sync existed.
REM ============================================================
:full_zip_sync
    set LEGACY_FILES=comm\kiconnect.js comm\kiconnect-agent.js comm\kiconnect-voice.js comm\kiconnect-db.js

    echo  Downloading latest version as a single archive...
    echo.
    if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

    curl --fail --location --output "%TMP_DIR%\repo.zip" "%REPO_ZIP_URL%"
    if errorlevel 1 (
        echo  [ !! ] Could not download repo archive.
        echo  Please check your internet connection.
        goto :eof
    )
    echo  [ OK ] Archive downloaded.

    echo  [INFO] Extracting...
    powershell -NoProfile -Command "Expand-Archive -LiteralPath '%TMP_DIR%\repo.zip' -DestinationPath '%TMP_DIR%\extracted' -Force"
    if errorlevel 1 (
        echo  [ !! ] Extraction failed.
        goto :eof
    )

    set EXTRACTED_ROOT=
    for /d %%D in ("%TMP_DIR%\extracted\*") do set EXTRACTED_ROOT=%%D
    if "%EXTRACTED_ROOT%"=="" (
        echo  [ !! ] Could not find extracted repo folder - archive layout unexpected.
        goto :eof
    )

    set SRC_COMM=%EXTRACTED_ROOT%\KiConnect\comm
    if not exist "%SRC_COMM%" (
        echo  [ !! ] Expected folder not found in archive: %SRC_COMM%
        goto :eof
    )

    REM No /MIR: only adds/overwrites, never deletes on its own. The
    REM tree-diff sync (the normal path) is what handles deletions
    REM precisely; this fallback intentionally stays conservative.
    echo  [INFO] Copying updated files into comm\ ...
    robocopy "%SRC_COMM%" "%~dp0comm" /E /R:1 /W:1 /XD "%~dp0comm\_render" "%~dp0comm\datas"
    if errorlevel 8 ( echo  [ !! ] Copy reported errors - comm\ may be incomplete. ) else ( echo  [ OK ] comm\ files copied/updated. )

    for %%F in (%LEGACY_FILES%) do (
        if exist "%~dp0%%F" (
            echo  [INFO] Removing retired file: %%F
            del /f /q "%~dp0%%F"
        )
    )

    if not "%REMOTE_SHA%"=="" ( > "%VERSION_FILE%" echo %REMOTE_SHA% )
    REM Manifest is now stale/unknown after a zip fallback - delete it so
    REM the next successful tree sync does a full reconcile instead of
    REM trusting outdated hashes.
    if exist "%MANIFEST_FILE%" del /f /q "%MANIFEST_FILE%"
    goto :eof


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
