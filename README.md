# KI-Connect

Ein lokaler, sicherer Chat-Client für verschiedene KI-Provider (OpenAI, Anthropic/Claude, OpenRouter, Mistral, Google Gemini, xAI Grok, Groq, KI Connect NRW und eigene OpenAI-kompatible Server). Primär für **persönliche Einzelnutzung** konzipiert – nicht für Enterprise-Deployments.

<img width="1502" height="1018" alt="grafik" src="https://github.com/user-attachments/assets/1efe644c-de04-4f55-88aa-41440575c20e" />

---

## Features

- 🔒 **Client-seitige Verschlüsselung** – Alle Daten (Chats, Profile, Provider, Einstellungen) werden mit AES-GCM-256 im Browser verschlüsselt gespeichert
- 🔐 **Passwort-geschützte Multi-Account-Sitzungen** mit PBKDF2 (600k Iterationen, zufälliger Salt pro Account)
- 🛡️ **Brute-Force-Schutz** – Ab dem 5. Fehlversuch exponentielles Lockout (30s → 60s → 120s → …), kein Bypass via Cache-Löschen möglich
- 🌐 **Browser-unabhängige Persistenz** – Daten liegen in `./datas/` auf dem lokalen Server; jeder Browser (Chrome, Firefox, Edge, …) greift auf dieselben Accounts zu
- 🧠 **Extended Thinking / Reasoning** für unterstützte Modelle (Claude 3.7+/4, o1/o3/o4, Grok 3, etc.)
  - Anthropic: Kontinuierliches Token-Budget (1k–32k)
  - OpenAI: Reasoning-Effort (low/medium/high)
- 📁 **Chat-Organisation** mit Ordnern, Drag & Drop und Branches
- 🖼️ **Bild- & PDF-Unterstützung** (Vision-Modelle, Ctrl+V Paste, PDF-Text-Extraktion)
- 🌍 **Mehrsprachig** – weitere Sprachen können in `kiconnect-languages-i18n.js` ergänzt werden 
- Bereits enthalten: EN, DE, FR, ES, IT, TR, RU, EL, ZH, AR, HI, TA, BN, PA, UR
- ⚡ **Streaming-Antworten** in Echtzeit mit Thinking-Block-Anzeige
- 📊 **Token-Statistik** pro Nachricht und Gesamtanzahl pro Chat
- 🧮 **LaTeX/MathJax** für mathematische Formeln
- 📱 **Responsives Design** mit anpassbarer Chat-Breite
- 🎨 **Agentenprofile** mit individuellen System-Prompts, Temperaturen und Modell-Limits
- 🔄 **Ordner-Drag & Drop** für Umstrukturierung der Sidebar

---

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

> **Tipp:** Wenn Windows die `.bat`-Datei blockiert (Benutzerkontensteuerung), einfach eine neue Textdatei erstellen, den Inhalt einfügen und die Dateiendung zu `.bat` umbenennen.

Öffne dann: **http://localhost:5000**

---

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

---

## Konfiguration

1. **Erststart**: Account anlegen und Passwort setzen (schützt alle lokalen Daten)
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

---

## Multi-Account & Browser-Sync

KI Connect unterstützt mehrere lokale Accounts auf demselben Rechner. Alle Daten werden im Unterordner `./datas/` neben der `kiconnect-proxy.py` gespeichert:

```
./datas/
├── _registry.json              ← Account-Liste (Klartext: ID, Name, pwHash, encSalt)
├── <accountId>/
│   ├── config.json             ← Einstellungen       (AES-256-GCM verschlüsselt)
│   ├── providers.json          ← API-Keys            (AES-256-GCM verschlüsselt)
│   ├── profiles.json           ← Agentenprofile      (AES-256-GCM verschlüsselt)
│   ├── folders.json            ← Ordnerstruktur      (AES-256-GCM verschlüsselt)
│   └── chats.json              ← Chat-Verlauf        (AES-256-GCM verschlüsselt)
```

> **Hinweis:** `_registry.json` enthält keine sensiblen Daten – nur Account-Namen, den PBKDF2-Passwort-Hash (zum Login-Verifizieren) sowie den Verschlüsselungs-Salt. Chats, API-Keys und alle Inhalte liegen ausschließlich verschlüsselt in den Account-Unterordnern.

**Konsequenz:** Chrome, Firefox und Edge auf demselben PC greifen auf **dieselben Accounts und Chats** zu – ohne manuelle Synchronisation. `localStorage` des Browsers dient nur noch als schneller Fallback-Cache.

---

## Thinking / Reasoning-Modus

Für unterstützte Modelle (Claude 3.7+/4, o1/o3/o4, Grok 3, etc.):

- **Anthropic**: Kontinuierliches Budget (1024–32000 Tokens) für Extended Thinking
- **OpenAI**: Diskrete Stufen (low/medium/high) für Reasoning-Effort
- **Anzeige**: Einklappbarer „Denkprozess"-Block über der Antwort

---

## Sicherheitsübersicht

> **Wichtig**: Dies ist ein **persönliches Tool für vertrauenswürdige Umgebungen**, keine Enterprise-Lösung.

### Was geschützt ist ✅

| Feature | Implementierung | Schutz vor |
|---|---|---|
| Datenspeicherung | Verschlüsselung AES-GCM-256 im Browser, Ablage in `./datas/` auf dem lokalen Server | Datenzugriff ohne Passwort (Dateien sind ohne Key nicht lesbar) |
| Login / Passwort | PBKDF2-HMAC-SHA256, 600k Iterationen, zufälliger Salt pro Account | Brute-Force, Rainbow Tables |
| Brute-Force (Login) | Exponentielles Lockout ab dem 5. Fehlversuch, nur im RAM (kein Bypass via Cache-Löschen) | Offline- und Online-Passwort-Raten |
| Session | Verschlüsselter Token in sessionStorage (kein Klartext-Passwort gespeichert) | Passwort-Diebstahl aus Browser-Speicher |
| XSS | DOMPurify (Pflicht + Fallback-Regex), strikte CSP, keine `onclick`-Handler | Reflected & Stored XSS |
| SSRF | Domain-Allowlist + private-IP-Filter im Proxy | Server-Side Request Forgery |
| CORS | Strict Origin/Host-Check, localhost-only | Ungewollte Cross-Origin-Zugriffe |
| Rate-Limiting | Thread-sicher (Lock), 120 Requests/60s pro IP | DoS, Brute-Force |
| Datei-Schreiben | Atomares Schreiben via `.tmp` + `os.replace()` | Datenverlust bei Proxy-Absturz |
| Response-Handling | Kein `accept-encoding`-Forwarding, `location`-Header-Filter | Response-Injection, Redirect-Exploits |

### Bekannte Limitationen ⚠️

| Risiko | Einschätzung | Empfehlung |
|---|---|---|
| **Kompromittierte Systeme** (Malware) | Begrenzter Schutz – Malware mit User-Rechten kann auf Browser/Proxy zugreifen | Nur auf sauberen Systemen; API-Keys bei Verdacht rotieren |
| **Man-in-the-Middle** | TLS-Validierung aktiv (`verify=True`), Proxy leitet HTTPS direkt weiter ohne TLS-Terminierung | Nur in vertrauenswürdigen Netzwerken |
| **XSS via KI-Ausgaben** | DOMPurify filtert, aber komplexe Payloads theoretisch möglich | Bei verdächtigen Outputs Vorsicht |
| **Browser-Neustart** | Nach Tab-Schließen oder Browser-Neustart: kurzer Re-Login erforderlich (RAM-Key weg) | Erwartetes sicheres Verhalten |
| **Denial-of-Service** | 50 MB Body-Limit, Rate-Limiting | Für Multi-User-Betrieb nicht ausreichend |

### Architektur

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌──────────────────┐
│   Browser           │ ←→  │  kiconnect-proxy.py       │ ←→  │  API-Provider    │
│  AES-GCM-256        │     │  127.0.0.1:5000           │     │  OpenAI etc.     │
│  (Verschlüsselung   │     │  CORS-Proxy + Storage-API │     │  (HTTPS, kein    │
│   im Browser)       │     │  ./datas/ (verschlüsselt) │     │   TLS-Terminier.)│
│  PBKDF2 (600k)      │     │  Thread-safe, atomic I/O  │     │                  │
│  DOMPurify          │     │                           │     │                  │
│  Brute-Force-Lock   │     │                           │     │                  │
└─────────────────────┘     └──────────────────────────┘     └──────────────────┘
         ↑
  [Passwort-geschützt]
  PBKDF2 + Session-Token
  Kein Klartext im Storage
```

---

## Mehrsprachigkeit

Die Übersetzungen liegen in `kiconnect-languages-i18n.js`. Eine neue Sprache hinzufügen:

1. Einen bestehenden Sprachblock kopieren (z. B. `en`)
2. Den neuen Sprachcode als Key setzen (z. B. `fr`)
3. Alle Werte übersetzen (Keys identisch lassen)
4. Den Code zum `LANGUAGES`-Objekt am Dateianfang hinzufügen

---

## Sicherheits-Changelog

### v5.0
- ✅ **Browser-unabhängige Persistenz** – Storage-API im Proxy, Daten in `./datas/`
- ✅ **Atomares Schreiben** via `.tmp` + `os.replace()` (kein Datenverlust)
- ✅ **Thread-Lock** für alle Datei-I/O-Operationen

### v4.5 (Security Hardening)
- ✅ **Seed aus localStorage entfernt** – CryptoKey wird ausschließlich aus Passwort + Account-Salt abgeleitet; kein zweiter Faktor im Klartext im Browser-Speicher
- ✅ **Kein Klartext-Passwort in sessionStorage** – stattdessen verschlüsselter Session-Token (AES-GCM, nur mit RAM-Key entschlüsselbar)
- ✅ **Brute-Force-Lockout** – exponentielles Backoff im RAM, kein Bypass durch Cache-Löschen
- ✅ **DOMPurify als Pflicht** mit Fallback-Regex bei CDN-Ausfall
- ✅ **Vollständige AES-256-GCM-Verschlüsselung** aller gespeicherten Daten (Chats, Profile, Einstellungen – nicht nur API-Keys)
- ✅ **Multi-Account-System** mit separaten Crypto-Keys pro Account

### v4.4
- ✅ Kein `accept-encoding`-Forwarding (gzip/br-Bugfix)
- ✅ `http-referer` und `x-title` für OpenRouter

### v4.2
- ✅ Thread-sicheres Rate-Limiting (Lock)
- ✅ `location`-Header-Filterung

---

## Entwicklung

```bash
# Entwicklungs-Server (Flask, nicht für Produktion)
FLASK_ENV=development python kiconnect-proxy.py

# Produktion (Waitress WSGI)
python kiconnect-proxy.py
```

---

## Lizenz

MIT License – Siehe [LICENSE](LICENSE)

---

**Haftungsausschluss**: Diese Software wird „as-is" bereitgestellt. Ich übernehme keine Haftung für API-Kosten, Datenverlust oder Sicherheitsvorfälle. Nutzung auf eigenes Risiko.
