@echo off
title KI Connect
cd /d "%~dp0"

set "PYTHON=%~dp0python\python.exe"
set "PIP=%~dp0python\python.exe -m pip"
set MIN_VERSIONS=flask>=3.0.0 requests>=2.31.0 waitress>=3.0.0 cryptography>=42.0.0

echo.
echo  ==========================================
echo       KI Connect - Starting...
echo  ==========================================
echo.

REM -- Run update -----------------------------------------------
echo Checking for updates...
call update.bat
if errorlevel 1 (
    echo Warning: Update could not be completed.
    echo.
)

REM -- Check if portable Python is present ----------------------
echo.
echo  ==========================================
echo       KI Connect - Checking Python Libs..
echo  ==========================================
echo.
if not exist "%PYTHON%" (
    echo  [ERROR] Portable Python not found!
    echo.
    echo  Expected at:
    echo    %PYTHON%
    echo.
    echo  Please download portable Python:
    echo    https://www.python.org/downloads/windows/
    echo    ^(Embeddable Package, e.g. python-3.12.x-embed-amd64.zip^)
    echo.
    echo  Extract to the "python\" folder next to this file.
    echo  Then run this BAT file again.
    echo.
    pause
    exit /b 1
)

REM -- Show Python version --------------------------------------
for /f "tokens=*" %%v in ('"%PYTHON%" --version 2^>^&1') do set PYVER=%%v
echo  Python:  %PYVER%
echo  Path:    %PYTHON%
echo.

REM -- Make pip available if missing (embeddable package) --------
"%PYTHON%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] pip not found - setting up...
    echo.
    for %%f in ("%~dp0python\python*._pth") do (
        powershell -Command "(Get-Content '%%f') -replace '#import site','import site' | Set-Content '%%f'"
    )
    if not exist "%~dp0python\get-pip.py" (
        echo  [INFO] Downloading get-pip.py...
        powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%~dp0python\get-pip.py'"
        if errorlevel 1 (
            echo  [ERROR] get-pip.py could not be downloaded.
            echo  Please download manually: https://pip.pypa.io
            pause
            exit /b 1
        )
    )
    "%PYTHON%" "%~dp0python\get-pip.py" --quiet
    echo  [OK] pip set up successfully.
    echo.
)

REM -- Check + install/update dependencies via pip ----------------
echo  Checking dependencies ^(incl. version check^)...
echo.
%PIP% install --upgrade %MIN_VERSIONS% --quiet
if errorlevel 1 (
    echo.
    echo  [ERROR] Installation/Update failed!
    echo  Please check your internet connection.
    pause
    exit /b 1
)
echo  [OK] All packages are present and up to date.

echo.
echo  ------------------------------------------
echo   Proxy starting  ^(Waitress WSGI^)
echo   Browser:  http://localhost:5000
echo   Stop:     Ctrl+C or close window
echo  ------------------------------------------
echo.

REM -- Start proxy -----------------------------------------------
"%PYTHON%" "%~dp0comm\kiconnect-proxy.py"

echo.
echo  Proxy has been terminated.
pause
