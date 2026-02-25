@echo off
echo KI Connect - Proxy starting...
echo.

REM Check for Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Please install Python: https://python.org
    pause
    exit /b 1
)

echo Installing / updating dependencies...
pip install "flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0" --quiet --upgrade

echo.
echo Starting proxy (Waitress WSGI)...
echo Open in browser: http://localhost:5000
echo Stop with:       Ctrl+C
echo.

REM Change to script directory
cd /d "%~dp0"

REM Start the proxy
python ./comm/kiconnect-proxy.py

pause
