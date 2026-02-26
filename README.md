# KI-Connect

Ein lokaler, sicherer Chat-Client für verschiedene KI-Provider (OpenAI, Anthropic/Claude, OpenRouter, Mistral, Google Gemini, xAI Grok, Groq, KI Connect NRW und eigene OpenAI-kompatible Server). Primär für **persönliche Einzelnutzung** konzipiert – nicht für Enterprise-Deployments.

<img width="1931" height="1399" alt="grafik" src="https://github.com/user-attachments/assets/dda72a4e-076a-482c-a82b-7fb7a1844410" />


## Features

- 🔒 **Client-seitige Verschlüsselung** – API-Keys werden mit AES-GCM-256 im Browser verschlüsselt
- 🔐 **Passwort-geschützte Sitzungen** mit PBKDF2 (600k Iterationen)
- 🧠 **Extended Thinking / Reasoning** für unterstützte Modelle (Claude 3.7+/4, o1/o3/o4, Grok 3, etc.)
  - Anthropic: Kontinuierliches Token-Budget (1k–32k)
  - OpenAI: Reasoning-Effort (low/medium/high)
- 🌐 **CORS-Proxy für lokale Entwicklung** – umgeht Browser-CORS-Restriktionen sicher (v4.4)
- 📁 **Chat-Organisation** mit Ordnern, Drag & Drop und Branches
- 🖼️ **Bild- & PDF-Unterstützung** (Vision-Modelle + PDF-Text-Extraktion)
- 🌍 **Mehrsprachig** – 14 Sprachen verfügbar:
  - EN, DE, FR, ES, IT, TR, RU, ZH, AR, HI, TA, BN, PA, UR
- ⚡ **Streaming-Antworten** in Echtzeit mit Thinking-Block-Anzeige
- 📊 **Token-Statistik** pro Nachricht und Gesamtanzahl pro Chat
- 🧮 **LaTeX/MathJax** für mathematische Formeln
- 📱 **Responsives Design** mit anpassbarer Chat-Breite
- 🎨 **Agentenprofile** mit individuellen System-Prompts, Temperaturen und Modell-Limits

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

Wenn dies `.bat` datei blockiert wird: Neue Textdatei erstellen und den Inhalt der einfügen und abspeichern. Die Textdatei endung umbenennen in `START_kiconnect.bat`. Im Anschluss doppelklicken auf diese Datei.

Öffne dann: **http://localhost:5000**

## Manuelle Installation

### Voraussetzungen

- Python 3.9+
- Moderner Browser (Chrome, Firefox, Edge, Safari)

### Schritte

```bash
# 1. Repository klonen
git clone https://github.com/Waldemar-Koch-git/KiConnect.git
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
   - **OpenRouter**: API-Key von [openrouter.ai](https://openrouter.ai) – 200+ Modelle
   - **Mistral AI**: API-Key von [console.mistral.ai](https://console.mistral.ai)
   - **Google Gemini**: API-Key von [aistudio.google.com](https://aistudio.google.com)
   - **xAI Grok**: API-Key von [console.x.ai](https://console.x.ai)
   - **Groq**: API-Key von [console.groq.com](https://console.groq.com) – Ultra-schnelle Inferenz
   - **Eigener Server**: Beliebige OpenAI-kompatible API

3. **Modell auswählen** – Live-Modell-Listen von den Providern (🧠 = Thinking-fähig)
4. **Optional**: Benutzerprofil anlegen für verschiedene Personas/Rollen

## Thinking / Reasoning-Modus

Für unterstützte Modelle (Claude 3.7+/4, o1/o3/o4, Grok 3, etc.):

- **Anthropic**: Kontinuierliches Budget (1024–32000 Tokens) für Extended Thinking
- **OpenAI**: Discrete Stufen (low/medium/high) für Reasoning-Effort
- **Anzeige**: Einklappbarer "Denkprozess"-Block über der Antwort

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
| Rate-Limiting | Thread-sicher (Lock), 120 Requests/60s pro IP | DoS, Brute-Force |
| Code-Ausführung | Kein `eval()`, keine `innerHTML` mit User-Input | Code Injection |
| Response-Handling | Kein `accept-encoding` Forwarding (v4.4), `location`-Header-Filter | Response-Injection, Redirect-Exploits |

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
│  + Thinking-UI  │     │ Thread-safe     │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        ↑
   [Passwort-geschützt]
   PBKDF2 + Session-Timeout
```

## Sicherheits-Changelog

### v4.4 (Critical Bugfix)
- ✅ **Kein `accept-encoding` Forwarding** – verhindert gzip/br-Kompressionsfehler im Browser
- ✅ `http-referer` und `x-title` Header für OpenRouter-Identifikation

### v4.2
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
