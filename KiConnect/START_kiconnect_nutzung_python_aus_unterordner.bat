@echo off
title KI Connect
cd /d "%~dp0"

set PYTHON=%~dp0python\python.exe
set PIP=%~dp0python\python.exe -m pip
set PACKAGES=flask requests waitress
set MIN_VERSIONS="flask>=3.0.0" "requests>=2.31.0" "waitress>=3.0.0"

set GITHUB_REPO=Waldemar-Koch-git/KiConnect
set GITHUB_BRANCH=main
set GITHUB_SUBFOLDER=KiConnect
set GITHUB_API=https://api.github.com/repos/%GITHUB_REPO%/git/trees/%GITHUB_BRANCH%?recursive=1
set GITHUB_RAW=https://raw.githubusercontent.com/%GITHUB_REPO%/%GITHUB_BRANCH%/%GITHUB_SUBFOLDER%

echo.
echo  ==========================================
echo       KI Connect - Starting...
echo  ==========================================
echo.

REM -- Pruefen ob portable Python vorhanden -------------------
if not exist "%PYTHON%" (
    echo  [FEHLER] Portable Python nicht gefunden!
    echo.
    echo  Erwartet unter:
    echo    %PYTHON%
    echo.
    echo  Bitte portable Python herunterladen:
    echo    https://www.python.org/downloads/windows/
    echo    ^(Embeddable Package, z.B. python-3.12.x-embed-amd64.zip^)
    echo.
    echo  Entpacken in den Ordner "python\" neben dieser Datei.
    echo  Danach diese BAT erneut starten.
    echo.
    pause
    exit /b 1
)

REM -- Python-Version anzeigen --------------------------------
for /f "tokens=*" %%v in ('"%PYTHON%" --version 2^>^&1') do set PYVER=%%v
echo  Python:  %PYVER%
echo  Pfad:    %PYTHON%
echo.

REM -- pip verfuegbar machen falls fehlend (embeddable package)
"%PYTHON%" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] pip nicht gefunden - wird eingerichtet...
    echo.
    for %%f in ("%~dp0python\python*._pth") do (
        powershell -Command "(Get-Content '%%f') -replace '#import site','import site' | Set-Content '%%f'"
    )
    if not exist "%~dp0python\get-pip.py" (
        echo  [INFO] Lade get-pip.py herunter...
        powershell -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%~dp0python\get-pip.py'"
        if errorlevel 1 (
            echo  [FEHLER] get-pip.py konnte nicht geladen werden.
            echo  Bitte manuell herunterladen: https://pip.pypa.io
            pause
            exit /b 1
        )
    )
    "%PYTHON%" "%~dp0python\get-pip.py" --quiet
    echo  [OK] pip eingerichtet.
    echo.
)

REM -- Abhaengigkeiten pruefen --------------------------------
echo  Pruefe Abhaengigkeiten...
set MISSING=0

for %%p in (%PACKAGES%) do (
    "%PYTHON%" -c "import %%p" >nul 2>&1
    if errorlevel 1 (
        echo  [ .. ] %%p fehlt - wird installiert...
        set MISSING=1
    ) else (
        echo  [ OK ] %%p
    )
)

if "%MISSING%"=="1" (
    echo.
    echo  Installiere fehlende Pakete...
    %PIP% install %MIN_VERSIONS% --quiet
    if errorlevel 1 (
        echo.
        echo  [FEHLER] Installation fehlgeschlagen!
        echo  Bitte Internetverbindung pruefen.
        pause
        exit /b 1
    )
    echo  [OK] Alle Pakete installiert.
)

REM -- Auto-Update von GitHub ---------------------------------
echo.
echo  Pruefe auf Updates (GitHub)...
echo.

REM Temporaere Update-Datei erstellen (Python-Skript inline)
set UPDATE_SCRIPT=%~dp0python\__kiconnect_update.py
(
    echo import urllib.request, json, os, hashlib, sys
    echo.
    echo REPO    = "%GITHUB_REPO%"
    echo BRANCH  = "%GITHUB_BRANCH%"
    echo SUBFOLDER = "%GITHUB_SUBFOLDER%"
    echo BASE_DIR  = r"%~dp0"
    echo API_URL   = f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1"
    echo RAW_BASE  = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{SUBFOLDER}"
    echo.
    echo # Dateien die NIEMALS ueberschrieben werden sollen
    echo SKIP_FILES = {
    echo     "START_kiconnect_nutzung_python_aus_unterordner.bat",
    echo     "START_kiconnect_mit_installierten_python.bat",
    echo }
    echo.
    echo def sha1_of_file(path):
    echo     if not os.path.exists(path): return None
    echo     with open(path, 'rb') as f: data = f.read()
    echo     # GitHub blob SHA = sha1("blob " + len + "\0" + data)
    echo     header = f"blob {len(data)}\0".encode()
    echo     return hashlib.sha1(header + data).hexdigest()
    echo.
    echo try:
    echo     req = urllib.request.Request(API_URL, headers={"User-Agent": "KiConnect-Updater"})
    echo     with urllib.request.urlopen(req, timeout=10) as r:
    echo         tree = json.loads(r.read())["tree"]
    echo except Exception as e:
    echo     print(f"  [WARN] GitHub nicht erreichbar, Update wird uebersprungen: {e}")
    echo     sys.exit(0)
    echo.
    echo prefix = SUBFOLDER + "/"
    echo updated = 0
    echo.
    echo for item in tree:
    echo     if item["type"] != "blob": continue
    echo     path = item["path"]
    echo     if not path.startswith(prefix): continue
    echo     rel = path[len(prefix):]  # relativer Pfad ab KiConnect/
    echo     filename = os.path.basename(rel)
    echo     if filename in SKIP_FILES: continue
    echo     local_path = os.path.join(BASE_DIR, rel.replace("/", os.sep))
    echo     # SHA vergleichen
    echo     if sha1_of_file(local_path) == item["sha"]:
    echo         continue  # unveraendert
    echo     # Datei herunterladen
    echo     raw_url = f"{RAW_BASE}/{rel}"
    echo     try:
    echo         os.makedirs(os.path.dirname(local_path), exist_ok=True)
    echo         req2 = urllib.request.Request(raw_url, headers={"User-Agent": "KiConnect-Updater"})
    echo         with urllib.request.urlopen(req2, timeout=15) as r2:
    echo             content = r2.read()
    echo         with open(local_path, 'wb') as f: f.write(content)
    echo         action = "NEU" if not os.path.exists(local_path) else "AKTUALISIERT"
    echo         print(f"  [UPDATE] {rel}")
    echo         updated += 1
    echo     except