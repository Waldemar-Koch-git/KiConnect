# KI-Connect

A local, secure chat client for various AI providers (OpenAI, Anthropic/Claude, OpenRouter, Mistral, Google Gemini, xAI Grok, Groq, DeepSeek, KI Connect NRW, and custom OpenAI-compatible servers). Primarily designed for **personal single-user use** — not for enterprise deployments.

<img width="1502" height="1018" alt="screenshot" src="./images_/preview.jpg" />

---

## Features

- 🔒 **Client-side encryption** – All data (chats, profiles, providers, settings) is encrypted with AES-GCM-256 in the browser
- 🔐 **Password-protected multi-account sessions** using PBKDF2 (600k iterations, random salt per account)
- 🛡️ **Brute-force protection** – Exponential lockout starting at the 5th failed attempt (30s → 60s → 120s → …), not bypassable via cache clearing
- 🌐 **Browser-independent persistence** – Data is stored in `./datas/` on the local server; any browser (Chrome, Firefox, Edge, …) accesses the same accounts
- 🧠 **Extended Thinking / Reasoning** for supported models (Claude 3.7+/4, o1/o3/o4, Grok 3, DeepSeek R1, etc.)
  - Anthropic: Continuous token budget (1k–32k) + Prompt Caching (~90% fewer tokens)
  - OpenAI: Reasoning effort (low/medium/high)
- 📁 **Chat organisation** with folders, drag & drop, and branches
- 🖼️ **Image & PDF support** (vision models, Ctrl+V paste, PDF text extraction)
- 🖨️ **Print function** – Print the full chat or individual messages (including LaTeX rendering)
- 🎙️ **Voice input & output** – Speech-to-text input and text-to-speech playback via the Web Speech API (`kiconnect-voice.js`)
- 🌍 **Multilingual** – additional languages can be added in `kiconnect-languages-i18n.js`
  - Already included: EN, DE, FR, ES, IT, TR, RU, EL, ZH, AR, HI, TA, BN, PA, UR
- ⚡ **Streaming responses** in real time with thinking block display
- 📊 **Token statistics** per message and total per chat
- 🧮 **LaTeX/MathJax** for mathematical formulas
- 📝 **Markdown rendering** via marked.js (GFM-compatible)
- 📱 **Responsive design** with adjustable chat width
- 🎨 **Agent profiles** with individual system prompts, temperatures, and model limits
- 🔄 **Folder drag & drop** for sidebar reorganisation

---

## Dependencies (JS Libraries)

KI Connect loads three libraries via CDN from `cdn.jsdelivr.net` and one library locally. An internet connection is required on first launch; afterwards the CDN files can optionally be hosted locally (see below).

| Library | Source | Purpose |
|---|---|---|
| MathJax 3.2.2 | CDN (`cdn.jsdelivr.net`) | LaTeX rendering (fonts are loaded automatically) |
| marked.js 12.0.0 | CDN (`cdn.jsdelivr.net`) | Markdown rendering |
| DOMPurify 3.2.4 | CDN (`cdn.jsdelivr.net`) | XSS protection |
| PDF.js 3.11.174 | CDN (`cdn.jsdelivr.net`) | PDF processing |


## File Structure

```
kiconnect/
├── START_kiconnect_mit_installierten_python.bat
└── comm/
    ├── kiconnect.html
    ├── kiconnect.css
    ├── kiconnect.js
    ├── kiconnect-proxy.py
    ├── kiconnect-languages-i18n.js
    ├── kiconnect-voice.js

    <Optional: host locally if desired, otherwise an internet connection is required!>
    ├── pdf.min.js
    └── pdf.worker.min.js

```

---

## Print Function

KI Connect supports two print modes:

### Print Full Chat
The 🖨️ button in the sidebar toolbar outputs the entire active chat as a print-optimised page. The chat title appears as a heading. Any LaTeX formulas are fully rendered before printing (MathJax must be loaded).

### Print Single Message
The 🖨️ icon in a message's action buttons opens a preview dialog. After confirmation, only that single message — including code blocks and formulas — is output in a separate print window.

> **Note:** Some browsers block pop-up windows by default. If the print dialog does not appear, please allow pop-ups for `localhost` in your browser settings.

---

## Quick Start (Windows)

Double-click `START_kiconnect_mit_installierten_python.bat` or (embedded) `START_kiconnect_nutzung_python_aus_unterordner.bat`

> **Tip:** If Windows blocks the `.bat` file, simply create a new text file, paste the content in, and rename the file extension to `.bat`.

Then open: **http://localhost:5000**

---

## Manual Installation

### Prerequisites

- Python 3.9+
- Modern browser (Chrome, Firefox, Edge, Safari)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Waldemar-Koch-git/KiConnect.git
cd kiconnect

# 2. Install dependencies
pip install flask>=3.0.0 requests>=2.31.0 waitress>=3.0.0

# 3. Start the proxy
python kiconnect-proxy.py

# 4. Open browser: http://localhost:5000
```

---

## Configuration

1. **First launch**: Create an account and set a password (protects all local data)
2. **Add a provider** (🔌 button):
   - **KI Connect NRW**: OpenAI-compatible, server URL: `https://chat.kiconnect.nrw/api/v1`
   - **OpenAI**: API key from [platform.openai.com](https://platform.openai.com)
   - **Anthropic/Claude**: API key from [console.anthropic.com](https://console.anthropic.com)
   - **OpenRouter**: API key from [openrouter.ai](https://openrouter.ai) – 200+ models
   - **Mistral AI**: API key from [console.mistral.ai](https://console.mistral.ai)
   - **Google Gemini**: API key from [aistudio.google.com](https://aistudio.google.com)
   - **xAI Grok**: API key from [console.x.ai](https://console.x.ai)
   - **Groq**: API key from [console.groq.com](https://console.groq.com) – Ultra-fast inference
   - **DeepSeek**: API key from [platform.deepseek.com](https://platform.deepseek.com) – including DeepSeek R1 reasoning
   - **Custom server**: Any OpenAI-compatible API (server URL + optional API key)

3. **Select a model** – Live model lists from providers (🧠 = thinking-capable)
4. **Optional**: Create a user profile for different personas/roles

---

## Multi-Account & Browser Sync

KI Connect supports multiple local accounts on the same machine. All data is stored in the `./datas/` subfolder next to `kiconnect-proxy.py`:

```
./datas/
├── _registry.json              ← Account list (plaintext: ID, name, pwHash, encSalt)
└── <accountId>/
    ├── config.json             ← Settings         (AES-256-GCM encrypted)
    ├── providers.json          ← API keys          (AES-256-GCM encrypted)
    ├── profiles.json           ← Agent profiles    (AES-256-GCM encrypted)
    ├── folders.json            ← Folder structure  (AES-256-GCM encrypted)
    └── chats.json              ← Chat history      (AES-256-GCM encrypted)
```

> **Note:** `_registry.json` contains no sensitive data — only account names, the PBKDF2 password hash, and the encryption salt. Chats, API keys, and all content are stored exclusively encrypted in the account subfolders.

Chrome, Firefox, and Edge on the same PC access the **same accounts and chats** — without manual synchronisation.

---

## Thinking / Reasoning Mode

For supported models (Claude 3.7+/4, o1/o3/o4, Grok 3, DeepSeek R1, etc.):

- **Anthropic**: Continuous budget (1024–32000 tokens) for Extended Thinking
- **OpenAI**: Discrete levels (low/medium/high) for Reasoning Effort
- **Display**: Collapsible "thinking process" block above the response

---

## Multilingual Support

Translations are located in `kiconnect-languages-i18n.js`. To add a new language:

1. Copy an existing language block (e.g. `en`)
2. Set the new language code as the key (e.g. `fr`)
3. Translate all values (keep keys identical)
4. Add the code to the `LANGUAGES` object at the top of the file

---

## Security Overview

> **Important**: This is a **personal tool for trusted environments**, not an enterprise solution.

### What is protected ✅

| Feature | Implementation | Protects against |
|---|---|---|
| Data storage | AES-GCM-256 in browser, stored in `./datas/` | Data access without password |
| Login / password | PBKDF2-HMAC-SHA256, 600k iterations, random salt per account | Brute-force, rainbow tables |
| Brute-force (login) | Exponential lockout from 5th failed attempt, RAM-only | Offline and online password guessing |
| Session | Encrypted token in sessionStorage (no plaintext password) | Password theft from browser storage |
| XSS | DOMPurify (CDN with CSP hardening), strict CSP | Reflected & stored XSS |
| SSRF | Domain allowlist + private IP filter in proxy | Server-side request forgery |
| CORS | Strict origin/host check, localhost-only | Unwanted cross-origin requests |
| Rate limiting | Thread-safe (lock), 120 requests/60s per IP | DoS, brute-force |
| File writing | Atomic write via `.tmp` + `os.replace()` | Data loss on proxy crash |
| Response handling | No `accept-encoding` forwarding, `location` header filter | Response injection, redirect exploits |

### Known Limitations ⚠️

| Risk | Assessment | Recommendation |
|---|---|---|
| **CDN dependencies** | MathJax, marked.js, DOMPurify are loaded from `cdn.jsdelivr.net` | Host locally for full offline operation (see above) |
| **Compromised systems** (malware) | Limited protection – malware with user rights can access browser/proxy | Use on clean systems only; rotate API keys if suspicious |
| **Man-in-the-middle** | TLS validation active (`verify=True`), proxy forwards HTTPS directly | Use on trusted networks only |
| **XSS via AI output** | DOMPurify filters, but complex payloads are theoretically possible | Exercise caution with suspicious outputs |
| **Browser restart** | After closing the tab: brief re-login required (RAM key gone) | Expected secure behaviour |
| **Denial-of-service** | 50 MB body limit (proxy), 100 MB per storage entry, rate limiting in place | Not sufficient for multi-user operation |

### Architecture

```
┌─────────────────────┐     ┌───────────────────────────┐     ┌──────────────────┐
│   Browser           │ ←→  │  kiconnect-proxy.py       │ ←→  │  API Provider    │
│  AES-GCM-256        │     │  127.0.0.1:5000           │     │  OpenAI etc.     │
│  (encryption        │     │  CORS-Proxy + Storage-API │     │  (HTTPS, no      │
│   in browser)       │     │  ./datas/ (encrypted)     │     │   TLS terminat.) │
│  PBKDF2 (600k)      │     │  Thread-safe, atomic I/O  │     │                  │
│  DOMPurify (CDN)    │     │                           │     │                  │
│  marked.js (CDN)    │     │                           │     │                  │
│  MathJax (CDN)      │     │                           │     │                  │
│  PDF.js (CDN)       │     │                           │     │                  │
│  Brute-Force-Lock   │     │                           │     │                  │
└─────────────────────┘     └───────────────────────────┘     └──────────────────┘
         ↑
  [Password-protected]
  PBKDF2 + Session Token
  No plaintext in storage
```

---

## License

MIT License – See [LICENSE](LICENSE)

---

**Disclaimer**: This software is provided "as-is". No liability for API costs, data loss, or security incidents. Use at your own risk.
