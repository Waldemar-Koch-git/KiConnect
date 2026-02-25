Hier ist eine README.md für dein KI Connect NRW-Projekt:

```markdown
# KI Connect NRW

Ein lokaler, sicherer Chat-Client für verschiedene KI-Provider (OpenAI, Anthropic/Claude, OpenRouter, KI Connect NRW und eigene OpenAI-kompatible Server). Primär für **persönliche Einzelnutzung** konzipiert – nicht für Enterprise-Deployments.

![Screenshot](screenshot.png) <!-- Optional: Screenshot einfügen -->

## Features

- 🔒 **Client-seitige Verschlüsselung** – API-Keys werden mit AES-GCM-256 im Browser verschlüsselt
- 🔐 **Passwort-geschützte Sitzungen** mit PBKDF2 (600k Iterationen)
- 🌐 **CORS-Proxy für lokale Entwicklung** – umgeht Browser-CORS-Restriktionen sicher
- 📁 **Chat-Organisation** mit Ordnern und Branches
- 🖼️ **Bild- & PDF-Unterstützung** (Vision-Modelle + PDF-Text-Extraktion)
- 🌍 **Mehrsprachig** – 14 Sprachen verfügbar:
  - EN, DE, FR, ES, IT, TR, RU, ZH, AR, HI, TA, BN, PA, UR
- ⚡ **Streaming-Antworten** in Echtzeit
- 🧮 **LaTeX/MathJax** für mathematische Formeln
- 📱 **Responsives Design**
```
## Schnellstart (Windows)

Doppelklick auf `START_kiconnect_mit_installierten_python.bat`:

```batch
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
```

Öffne dann: **http://localhost:5000**

## Manuelle Installation

### Voraussetzungen

- Python 3.9+
- Moderner Browser (Chrome, Firefox, Edge, Safari)

### Schritte

```bash
# 1. Repository klonen
git clone https://github.com/dein-username/kiconnect-nrw.git
cd kiconnect-nrw

# 2. Abhängigkeiten installieren
pip install flask>=3.0.0 requests>=2.31.0 waitress>=3.0.0

# 3. Proxy starten
python kiconnect-proxy.py

# 4. Browser öffnen: http://localhost:5000
```

## Konfiguration

1. **Erststart**: Passwort für die lokale Verschlüsselung setzen
2. **Provider hinzufügen** (🔌-Button):
   - **KI Connect NRW**: OpenAI-kompatibel, Server-URL: `https://chat.kiconnect.nrw/api/v1`
   - **OpenAI**: API-Key von [platform.openai.com](https://platform.openai.com)
   - **Anthropic/Claude**: API-Key von [console.anthropic.com](https://console.anthropic.com)
   - **OpenRouter**: API-Key von [openrouter.ai](https://openrouter.ai)
   - **Eigener Server**: Beliebige OpenAI-kompatible API

3. **Modell auswählen** und loschatten

## Sicherheitsübersicht

> **Wichtig**: Dies ist ein **persönliches Tool für vertrauenswürdige Umgebungen**, keine Enterprise-Lösung.

### Was geschützt ist ✅

| Feature | Implementierung | Schutz vor |
|---------|----------------|------------|
| API-Key-Speicherung | AES-GCM-256, client-seitig | Lokale Datendiebstahl, unverschlüsselte Speicherung |
| Login/Passwort | PBKDF2-HMAC-SHA256, 600k Iterationen, zufälliger Salt | Brute-Force, Rainbow Tables |
| Session-Management | Konfigurierbare Timeout (Standard: 12h) | Dauerhafte offene Sessions |
| XSS | DOMPurify, strikte CSP, keine `onclick`-Handler in HTML | Reflected & Stored XSS |
| SSRF | IP-Allowlist, private-IP-Filter im Proxy | Server-Side Request Forgery |
| CORS | Strict Origin/Host-Check, localhost-only | Ungewollte Cross-Origin-Zugriffe |
| Rate-Limiting | 120 Requests/60s pro IP | DoS, Brute-Force |
| Code-Ausführung | Kein `eval()`, keine `innerHTML` mit User-Input | Code Injection |

### Bekannte Limitationen ⚠️

| Risiko | Einschätzung | Empfehlung |
|--------|-------------|------------|
| **Kompromittierte Systeme** (Malware) | *Begrenzter Schutz* – Malware mit User-Rechten kann auf laufenden Browser/Proxy zugreifen | Nur auf sauberen Systemen nutzen; API-Keys bei Verdacht rotieren |
| **Man-in-the-Middle** | TLS-Validierung aktiv, aber Proxy entschlüsselt temporär für CORS-Handling | Nur vertrauenswürdige Netzwerke; eigenes Zertifikat möglich |
| **XSS via KI-Ausgaben** | DOMPurify filtert, aber komplexe Payloads theoretisch möglich | Bei verdächtigen Outputs Vorsicht |
| **LocalStorage-Daten** | Unverschlüsselte Metadaten (Chat-Verlauf), nur Keys verschlüsselt | Gerät verschlüsseln, bei Verlust Daten löschen |
| **Denial-of-Service** | 50MB Body-Limit, Rate-Limiting | Für produktiven Multi-User-Betrieb nicht ausreichend |

### Architektur-Sicherheit

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Browser       │ ←→  │  Proxy          │ ←→  │  API-Provider   │
│  (AES-GCM-256)  │     │ (CORS-Proxy)    │     │ (OpenAI etc.)   │
│  + DOMPurify    │     │ 127.0.0.1:5000  │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        ↑
   [Passwort-geschützt]
   PBKDF2 + Session-Timeout
```

## Sicherheits-Changelog (v4.2)

- ✅ Thread-sicheres Rate-Limiting (Lock statt Race-Condition)
- ✅ `location`-Header-Filterung (verhindert Client-Redirects)
- ✅ PBKDF2 mit zufälligem Salt ersetzt schwaches HKDF
- ✅ Keine `onclick`-Attribute in dynamischem HTML
- ✅ DOMPurify ohne `onclick` in ALLOWED_ATTR
- ✅ Bildgrößen-Limit für LocalStorage (500KB)

## Entwicklung

```bash
# Entwicklungs-Server (Flask, nicht für Produktion)
FLASK_ENV=development python kiconnect-proxy.py

# Produktion (Waitress WSGI)
python kiconnect-proxy.py  # oder .bat-Datei
```

## Lizenz

MIT License – Siehe [LICENSE](LICENSE)

---

**Haftungsausschluss**: Diese Software wird "as-is" bereitgestellt. Ich übernehme keine Haftung für API-Kosten, Datenverlust oder Sicherheitsvorfälle. Nutzung auf eigenes Risiko.
```

Die README deckt alle deine Punkte ab: Funktionsumfang, Installation, die 14 Sprachen, Sicherheitsfeatures mit ehrlichen Limitationen für den Single-User-Use-Case, und den Hinweis dass es keine Enterprise-Lösung ist.
