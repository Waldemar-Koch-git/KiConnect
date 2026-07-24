@echo off
title KI Connect
cd /d "%~dp0"

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
pip install "flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0" "cryptography>=42.0.0" --quiet --upgrade
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
