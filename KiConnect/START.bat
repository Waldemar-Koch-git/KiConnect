@echo off
title KI Connect
cd /d "%~dp0"

REM -- Apply any pending self-update staged by update.bat --------
REM update.bat never overwrites START.bat/update.bat/START_portable.bat
REM while they might be running/paused on the call stack; it only ever
REM leaves "<name>.new" next to them. This is the first safe moment to
REM swap those in: a brand-new cmd.exe process that hasn't read anything
REM from this file yet. If START.bat itself was updated, apply it and
REM relaunch a fresh copy instead of continuing to run the old one.
if exist "%~dp0update.bat.new" move /y "%~dp0update.bat.new" "%~dp0update.bat" >nul
if exist "%~dp0START_portable.bat.new" move /y "%~dp0START_portable.bat.new" "%~dp0START_portable.bat" >nul
if exist "%~dp0START.bat.new" (
    move /y "%~dp0START.bat.new" "%~dp0START.bat" >nul
    start "" cmd /c call "%~dp0START.bat"
    exit /b 0
)

echo KI Connect - Proxy starting...
echo.

REM -- Check for Python -------------------------------------------
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python: https://python.org
    pause
    exit /b 1
)

REM -- Run update ---------------------------------------------------
echo.
echo Running update...
call update.bat
if errorlevel 1 (
    echo Warning: Update could not be completed.
)

echo.
echo  ==========================================
echo       KI Connect - Checking Python Libs..
echo  ==========================================
echo.
echo Installing / updating dependencies...
pip install "flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0" "cryptography>=42.0.0" "pypdf>=4.0.0" "python-docx>=1.1.0" "python-pptx>=0.6.23" "openpyxl>=3.1.0" "numpy>=1.26.0" --quiet --upgrade
if errorlevel 1 (
    echo.
    echo  [ERROR] Installation/Update failed!
    echo  Please check your internet connection.
    pause
    exit /b 1
)

echo.
echo Starting proxy (Waitress WSGI)...
echo Open in browser: http://localhost:5000
echo Stop with:       Ctrl+C
echo.

REM -- Start the proxy ----------------------------------------------
python "%~dp0comm\kiconnect-proxy.py"

echo.
echo Proxy has been terminated.
pause
