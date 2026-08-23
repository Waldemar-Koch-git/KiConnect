# Ki-Connect - Technical Documentation

This file contains the technical details of Ki-Connect. A general, non-technical introduction can be found in [README.md](README.md).

---

## Overview

Ki-Connect is a locally-run, client-side-encrypted chat client for various AI providers (OpenAI, Anthropic/Claude, OpenRouter, Mistral, Google Gemini, xAI Grok, Groq, DeepSeek, MiniMax, Zhipu AI/Z.ai (GLM), Moonshot AI (Kimi), KI Connect NRW, and any OpenAI-compatible server). The underlying application (Python + a web front end) is platform-independent, but this release is packaged and tested for Windows: the provided start scripts (`START.bat`, `START_portable.bat`, `update.bat`) are Windows batch files and will not run as-is on macOS or Linux. The application supports multiple local, separately encrypted accounts on the same installation, which makes it suitable for a small group of trusted users sharing one machine; it is not intended as a multi-tenant deployment for a company with many independent, mutually untrusted users, since all accounts share the same server process and host machine.

> As of v4.0.0, the front end is organized as ~20 ES modules under `comm/js/` instead of one large `kiconnect.js` file plus loosely-coupled bolt-on scripts; this was a "no functional change" internal refactor. See "File structure" below and `comm/ARCHITECTURE.md` for details.

---

## Feature summary

- Client-side encryption: all data (chats, profiles, providers, settings) is encrypted with AES-GCM-256 in the browser
- Password-protected multi-account sessions via PBKDF2 (600,000 iterations, random salt per account)
- Brute-force protection: exponential lockout starting at the 5th failed attempt (30s → 60s → 120s → …), not bypassable by clearing the cache
- Browser-independent persistence: data lives in `./datas/` on the local server; any browser (Chrome, Firefox, Edge, …) accesses the same accounts
- Extended Thinking / Reasoning for supported models (Claude 3.7 and up, GPT-5.x thinking variants, Grok, DeepSeek R1, Gemini 2.5+, MiniMax, GLM, Kimi K2-Thinking/K3, etc.)
  - Anthropic Claude 4+ (Opus, Sonnet, Haiku, Fable): Adaptive Thinking with effort levels (low/medium/high) via the `output_config` API
  - Anthropic Claude 3.7: legacy token budget (1k-32k) plus prompt caching (roughly 90% fewer tokens)
  - OpenAI and most other providers: discrete reasoning-effort levels (low/medium/high)
  - Fixed-thinking models (e.g. MiniMax): on/off only, no effort slider
- Optional, user-activated web search: when enabled via the web-search toggle in the toolbar, messages are augmented with live web results before being sent to the AI. It is off by default and only runs when the user turns it on (or sets it to "Always")
  - Modes: manual button, Auto (for current-events queries), Always, or Off
  - Free engines (no key required): DuckDuckGo, Startpage, SearXNG, Qwant, Yahoo - with automatic fallback chaining
  - Premium engines (API key required): Brave Search, Google Custom Search, Bing/Azure, Mojeek, Yandex
  - Configurable result count (3-30), 30-minute result cache, locale-aware queries
  - Automatic URL fetching: if the user's message contains links, the page content is fetched and included as context
- Chat organization with folders, drag & drop (chats and folders), and branches
- Image and PDF support (vision models, Ctrl+V paste, PDF text extraction)
- Print function: print the full chat or individual messages (including LaTeX rendering)
- Voice input and output via the Web Speech API (`kiconnect-voice.js`)
  - Dialog mode: the AI reply is read aloud, then the microphone activates again automatically
  - Configurable voice, rate, pitch, and recognition language
- Multilingual interface via `kiconnect-languages-i18n.js`. Currently included:
  - English (en)
  - German (de)
  - French (fr)
  - Spanish (es)
  - Italian (it)
  - Turkish (tr)
  - Russian (ru)
  - Greek (el)
  - Simplified Chinese (zh)
  - Arabic (ar)
  - Hindi (hi)
  - Tamil (ta)
  - Bengali (bn)
  - Punjabi (pa)
  - Urdu (ur)
  - Farsi (fa) <Persian>
- 12 built-in themes, including OLED variants
  - Standard: `dark`, `white`, `nord`, `dracula`, `forest`, `mocha`, `rose`, `solarized`
  - OLED (pure black): `dark_oled`, `gold_oled`, `emerald_oled`, `red_oled`
- Multi-select for chats in the sidebar for bulk deletion or folder moves
- Streaming responses in real time with a thinking-process display
- Token statistics per message and per chat (including prompt cache hits)
- LaTeX/MathJax for mathematical formulas
- Markdown rendering via marked.js (GFM-compatible)
- Responsive design with adjustable chat width and a resizable sidebar
- Agent profiles with individual system prompts, temperatures, and model limits
- Branching & regeneration: branch from any message; regenerated replies are stored as siblings with full history preserved
- **Coding agent** (`js/agent.js`): any sidebar folder can be linked to a real folder on disk and focused as a "project." The focused chat's messages then run through an agentic tool loop (read/write/edit/copy/move files, list/browse folders, optional shell execution) using the same model/provider/thinking settings already selected in the header - see "Coding agent" below. Optional per-project git checkpoints snapshot the working folder before each mutating tool call.
- **Knowledge base / RAG** (`js/db.js`): index a folder or an explicit set of files (`.txt`, `.md`, `.csv`, `.json`, `.yaml`, `.pdf`, `.docx`, `.pptx`, `.xlsx`, and more) into a locally stored, encrypted, searchable knowledge base, then pull the most relevant chunks into a chat automatically - see "Knowledge base" below

---

## Dependencies (JS libraries)

Ki-Connect no longer loads its JS libraries from a CDN. All required libraries are bundled locally under `comm/_render/` and served directly from the local proxy, so no external CDN connection is needed for these libraries once the files are in place. The `_render` folder is populated automatically by `update.bat` on first run (see "Start scripts in detail" below) or can be provided manually.

| Library | Source | Purpose |
|---|---|---|
| MathJax 4.1.3 | Local (`comm/_render/`) | LaTeX rendering (fonts are loaded automatically) |
| marked.umd.js 18.0.5 | Local (`comm/_render/`) | Markdown rendering |
| DOMPurify 3.4.11 | Local (`comm/_render/`) | XSS protection |
| PDF.js 3.11.174 | Local (`comm/_render/`) | PDF processing |

An internet connection is still required once, to download `_render.zip` on first launch (or when the `_render` folder is empty). After that, the application can run fully offline with respect to these libraries.

On the Python side, `kiconnect-proxy.py` requires `flask`, `requests`, `waitress`, and `cryptography` (mandatory - the proxy exits at startup if any is missing) for server-side AES-GCM encryption/decryption of the agent/knowledge-base registries under `./datas/<accountId>/`, separate from the client-side encryption of chats/providers/config. It additionally uses `pypdf`, `python-docx`, `python-pptx`, and `openpyxl` for text extraction from the corresponding file types in the knowledge base, and `numpy` for faster embedding similarity search - each is checked individually at import time and the knowledge base feature degrades gracefully per file/feature (clear error, rather than a crash) if one is missing, and the proxy itself still starts fine without any of them. `START.bat`/`START_portable.bat` install all nine packages automatically; manual installs can use `pip install -r requirements.txt` for the four mandatory ones, then uncomment whichever optional knowledge-base extras are needed.

---

## File structure

As of v4.0.0, the front end is a set of real ES modules under `comm/js/` rather than one monolithic script. `kiconnect.js`, `kiconnect-agent.js`, `kiconnect-voice.js`, and `kiconnect-db.js` no longer exist - don't look for them; if a code comment still mentions one, it's a historical "extracted from kiconnect.js" attribution, not a sign the file survived.

```
kiconnect/
├── START.bat                    (Windows start using system Python, incl. auto-update)
├── START_portable.bat           (Windows start using the bundled portable Python)
├── update.bat                   (checks for updates, then syncs only changed files via kiconnect_sync.ps1)
├── kiconnect_sync.ps1           (does the actual tree-diff download/delete for update.bat)
├── kiconnect_manifest.json      (created automatically: last-synced path -> GitHub blob SHA, per file)
├── kiconnect_version.txt        (created automatically: last-synced commit hash, cheap "anything changed?" gate)
├── python/                      (portable use only: embedded Python)
└── comm/
    ├── kiconnect.html               (entry point; loads the module scripts below)
    ├── kiconnect.css                (~2,100 lines, all styling)
    ├── kiconnect-mathjax-config.js  (MathJax config, must load before _render/latex/tex-chtml.js)
    ├── kiconnect-languages-i18n.js  (classic script; translation tables shared with every module)
    ├── kiconnect-proxy.py           (local Flask/Waitress server: static files, /proxy, /store, /agent, /kb)
    ├── requirements.txt
    ├── js/
    │   ├── core/        boot.js, state.js, theme.js, i18n.js
    │   ├── auth/         crypto.js, accounts.js, storage.js
    │   ├── providers/    provider-crud.js, provider-models.js
    │   ├── chat/         chat-sidebar.js, chat-render.js, chat-send.js, chat-attachments.js
    │   ├── websearch/    web-search.js
    │   ├── ui/           profiles.js, tour.js, misc-ui.js
    │   ├── voice.js       (speech input/output, formerly kiconnect-voice.js)
    │   ├── agent.js       (coding-agent module, formerly kiconnect-agent.js)
    │   └── db.js          (knowledge-base/RAG module, formerly kiconnect-db.js)
    ├── _lang/                (per-language translation files)
    └── _render/              (bundled local libraries: MathJax, marked.js, DOMPurify, PDF.js)
```

`kiconnect.html` loads four `<script type="module">` tags - `js/core/boot.js` (the application itself), `js/voice.js`, `js/agent.js`, and `js/db.js` - plus `kiconnect-languages-i18n.js` as a classic (non-module) script beforehand, so its translation tables are visible to every module as ordinary shared-realm globals. Everything else is pulled in transitively via `import`.

`js/voice.js`, `js/agent.js`, and `js/db.js` no longer bolt onto the host app by reassigning its functions or writing to `window.X` (that pattern doesn't work with ES modules). Instead they register into it through an explicit hook API owned by the file that defines the extended behavior - `registerSendMessageOverride`/`registerRegenerateOverride` (`js/chat/chat-send.js`), `onRenderSidebar` (`js/chat/chat-sidebar.js`), `onSessionUnlock`/`onSessionRekey`/`onSessionLock` (`js/auth/accounts.js`), and `onLanguageChange` (`js/ui/misc-ui.js`). See `ARCHITECTURE.md` in `comm/` for the full file-by-file map.

The old standalone PDF.js worker-init script is folded directly into `js/chat/chat-attachments.js` (it doesn't need to run before anything else, unlike the MathJax config).

---

## Start scripts in detail

### START.bat
Checks whether Python is available on the system, calls `update.bat` to refresh the program files, installs/updates the required Python packages (`flask`, `requests`, `waitress`, `cryptography`, `pypdf`, `python-docx`, `python-pptx`, `openpyxl`, `numpy`), and then starts the proxy via Waitress (WSGI). The proxy itself automatically opens the default browser at `http://localhost:5000` about 1.2 seconds after starting.

### START_portable.bat
Intended for users without an installed Python. Expects a self-contained, embedded Python environment at `python\python.exe`. If needed, it sets up `pip` inside that environment (uncommenting `#import site` in the `._pth` file and fetching `get-pip.py`), checks and installs the required packages, and then starts the proxy. It also calls `update.bat`.

### update.bat
Initial installs are expected to come from a packaged GitHub Release; `update.bat`'s job on every subsequent start is to sync only what actually changed, not to re-download the whole project each time. Provided an internet connection is available:

1. Asks the GitHub API for the current commit hash on `main` (a few hundred bytes) and compares it against the hash saved from the last update (`kiconnect_version.txt`). If they match, nothing else runs - just a re-check that `comm/_render` is present (see below) - and the script exits.
2. If the version differs (or the check itself failed, in which case it syncs anyway to be safe): refreshes `update.bat`, `START.bat`, and `START_portable.bat` from GitHub if they changed. These are fetched to `<name>.new`, byte-compared, and moved over the original in place - this run keeps executing whatever `cmd.exe` already has buffered; the new content only takes effect the next time that file is invoked. (Same reasoning update.bat already applied to itself before this was generalized to all three launcher scripts.)
3. Makes sure `kiconnect_sync.ps1` - the helper that does the real work - is current, by fetching and byte-comparing it the same way (safe to overwrite immediately here, since it hasn't been launched yet this run).
4. Runs `kiconnect_sync.ps1`, which:
   - asks GitHub's Git Trees API for the full file tree of `main`, recursively, in one call (path + blob SHA per file, no file contents - `git/trees/main?recursive=1`),
   - compares each file's hash against a local manifest (`kiconnect_manifest.json`) saved from the previous sync,
   - downloads only files that are new or whose hash changed,
   - deletes local files under `comm/` that no longer exist in the tree upstream, based on what's actually on disk right now rather than trusting the old manifest - so it also self-heals a stale/missing manifest and, on the first run of this mechanism, automatically cleans up pre-v4.0.0 leftovers like `comm/kiconnect.js`, `comm/kiconnect-agent.js`, `comm/kiconnect-voice.js`, `comm/kiconnect-db.js`,
   - never touches anything under `comm/datas/` or `comm/_render/`, regardless of what the tree looks like,
   - writes the updated manifest back so the next run only needs the one cheap tree-diff call.
5. Records the new commit hash for next time.

If the tree lookup is unavailable or GitHub reports it as truncated, `update.bat` falls back to the previous method (download the whole repo as a zip, Robocopy the `comm/` contents in, remove the same short list of retired legacy files) as a safety net; that fallback also clears the local manifest, so the next successful tree sync does a full reconcile instead of trusting hashes that may now be stale.

Separately, on every run (whether or not a sync happened), it makes sure `comm/_render` exists and has content: if the folder is empty or missing, it downloads and extracts `_render.zip` (the bundled MathJax/marked.js/DOMPurify/PDF.js libraries).

If there is no internet connection, the entire update step is skipped without blocking startup. Batch launcher files are never overwritten by re-launching a running script with a hidden flag - that pattern is exactly what triggers some antivirus heuristics (e.g. Kaspersky's `PDM:Trojan.Win32.Generic`).

---

## Print function

Ki-Connect supports two print modes:

### Print full chat
The printer button in the sidebar toolbar outputs the entire active chat as a print-optimized page. The chat title appears as a heading. Any LaTeX formulas are fully rendered before printing (MathJax must be loaded).

### Print single message
The printer icon in a message's action buttons opens a preview dialog. After confirmation, only that single message - including code blocks and formulas - is output in a separate print window.

> Note: some browsers block pop-up windows by default. If the print dialog does not appear, allow pop-ups for `localhost` in your browser settings.

---

## Manual installation

### Prerequisites
- Python 3.9+
- Modern browser (Chrome, Firefox, Edge, Safari)

### Steps
```bash
# 1. Clone the repository
git clone https://github.com/Waldemar-Koch-git/KiConnect.git
cd kiconnect

# 2. Install dependencies
pip install flask>=3.0.0 requests>=2.31.0 waitress>=3.0.0 cryptography>=42.0.0 pypdf>=4.0.0 python-docx>=1.1.0 python-pptx>=0.6.23 openpyxl>=3.1.0 numpy>=1.26.0

# 3. Start the proxy
python kiconnect-proxy.py

# 4. The default browser opens automatically at: http://localhost:5000
```

This manual method works on any operating system with Python installed (Windows, macOS, Linux); only the bundled `.bat` scripts are Windows-specific.

---

## Configuration

1. First launch: create an account and set a password (protects all local data)
2. Add a provider (plug icon):
   - **KI Connect NRW**: OpenAI-compatible, server URL: `https://chat.kiconnect.nrw/api/v1`
   - **OpenAI**: API key from [platform.openai.com](https://platform.openai.com)
   - **Anthropic/Claude**: API key from [console.anthropic.com](https://console.anthropic.com)
   - **OpenRouter**: API key from [openrouter.ai](https://openrouter.ai) - 200+ models
   - **Mistral AI**: API key from [console.mistral.ai](https://console.mistral.ai)
   - **Google Gemini**: API key from [aistudio.google.com](https://aistudio.google.com)
   - **xAI Grok**: API key from [console.x.ai](https://console.x.ai)
   - **Groq**: API key from [console.groq.com](https://console.groq.com) - ultra-fast inference
   - **DeepSeek**: API key from [platform.deepseek.com](https://platform.deepseek.com) - including DeepSeek 4 & reasoning
   - **MiniMax**: API key from [platform.minimax.io](https://platform.minimax.io/console/access)
   - **Zhipu AI / Z.ai (GLM)**: API key from [z.ai](https://z.ai/manage-apikey/apikey-list)
   - **Moonshot AI (Kimi)**: API key from [platform.moonshot.ai](https://platform.moonshot.ai) - OpenAI-compatible, long context, optional thinking on K2-Thinking/K3
   - **Custom server**: any OpenAI-compatible API (server URL + optional API key)
3. Select a model - live model lists from providers (brain icon = thinking-capable)
4. Optional: create a user profile for different personas/roles

---

## Web search

Web search is **off by default**. Ki-Connect can optionally augment messages with live web results before sending them to the AI, but only once the user enables it via the web-search button/toggle in the toolbar (or the Tuning panel). Nothing is searched automatically unless that option has been switched on.

### Search modes
- **Manual** (default when enabled) - click the search button next to the input field to enable search for the next message
- **Auto** - automatically searches for queries about current events, recent news, or time-sensitive topics
- **Always** - every message triggers a web search
- **Off** - web search disabled (the default state)

### Search engines
| Engine | Key required | Notes |
|---|---|---|
| Free fallback | No | Tries DuckDuckGo → Startpage → SearXNG in sequence |
| DuckDuckGo | No | Direct scrape of lite.duckduckgo.com |
| SearXNG | No | Rotates public instances; optionally enter a custom URL |
| Qwant | No | |
| Yahoo | No | |
| Startpage | No | |
| Brave Search | Yes | 2,000 free queries/month at search.brave.com/search/api |
| Google Custom Search | Yes | Format: `APIKEY::CX_ID`; 100 free queries/day |
| Bing (Azure) | Yes | 3,000 free queries/month |
| Mojeek | Yes | |
| Yandex | Yes | Format: `FOLDERID::APIKEY` |

### URL fetching
If the user's message contains `http://` or `https://` links, Ki-Connect automatically fetches those pages and includes the extracted text as additional context (up to 12,000 characters per page, max 3 URLs). This happens independently of the web-search toggle, since it's triggered by a link the user pasted, not by a search.

---

## Coding agent

A sidebar folder becomes a "project" by linking it (via `agentProject`) to a real folder on disk, registered through the proxy's Agent-API. Focusing a chat on that folder runs each message through an agentic tool loop instead of a plain completion; there is only one model picker in the app (the header's), used for both normal chat and agent turns.

### Access modes (per project)
- **Simulate** - reports what it would do; no file is changed and no command runs
- **Confirm** - asks for confirmation before every file change or command
- **Auto** - applies changes without asking

Shell command execution is a separate, explicit opt-in per project and is off by default regardless of access mode.

### Checkpoints (optional, per project)
If enabled for a project and Git is available on the machine, the proxy stages and commits the current state of the project folder right before each mutating tool call (write, delete, move, copy, shell exec) executes - not in Simulate mode, and not if checkpoints are off. This gives a rollback point per agent action without the user needing to manage Git themselves. The `checkpoints` flag is re-checked server-side on every checkpoint request rather than trusted from the caller, the same way the `shell` flag is re-checked before `/agent/exec` runs.

### Agent-API (proxy, requires an unlocked session)
| Endpoint | Method(s) | Purpose |
|---|---|---|
| `/agent/session/unlock` | POST | Unlock the per-account encrypted project registry |
| `/agent/session/rekey` | POST | Re-encrypt the registry under a new key (password change) |
| `/agent/session/lock` | POST | Drop the session |
| `/agent/browse` | GET | Browse real OS folders (for the folder picker) |
| `/agent/projects` | GET/POST | List / register a project folder |
| `/agent/projects/<id>` | DELETE | Unregister a project (files on disk are left untouched) |
| `/agent/projects/<id>/shell` | PUT | Enable/disable shell execution for a project |
| `/agent/projects/<id>/checkpoints` | PUT | Enable/disable Git checkpoints for a project |
| `/agent/projects/<id>/path` | PUT | Re-point a project at a different folder |
| `/agent/checkpoint/<id>` | POST | Stage + commit the project's current state (only if checkpoints are enabled) |
| `/agent/exec/<id>` | POST | Run a shell command inside the project folder (only if shell is enabled) |
| `/agent/tree/<id>` | GET | Recursive file listing |
| `/agent/search/<id>` | GET | grep-style text search across the project |
| `/agent/file/<id>/<path>` | GET/PUT/DELETE | Read / write / delete a file |
| `/agent/dir/<id>/<path>` | POST/DELETE | Create / delete a folder |
| `/agent/move/<id>` | POST | Move or rename a file/folder |
| `/agent/copy/<id>` | POST | Copy a file/folder |

Project registries are encrypted with a key derived client-side from the account password and a dedicated salt, separate from the config/providers/chats encryption key, so a leak of one does not expose the other.

### Shell execution sandboxing
`/agent/exec` is not a hard security boundary (no container or VM) - the command runs as the same OS user as the proxy, confined to the project folder only by convention (`cd ..` or an absolute path can still escape it). Best-effort hardening applied on top:
- Minimal, secret-free environment (does not inherit the proxy's own environment variables)
- POSIX resource limits (CPU time, memory, process count, open files, no core dumps) on Linux/macOS
- Runs in its own process group so a timeout can kill the whole subtree
- Best-effort network isolation via `unshare --net` where available (Linux only); reported back to the client as `networkIsolated` rather than assumed on
- Output capped at 200,000 characters per stream, 45-second execution timeout

Registering a folder outside a safe path (drive/system root, or the app's own installation folder) is rejected outright.

---

## Knowledge base

A knowledge base indexes a folder or an explicit list of files into locally stored, encrypted, searchable chunks that can be pulled into a chat as context automatically. It reuses the same unlocked Agent session as the coding agent rather than requiring a separate unlock.

- **Source**: either a whole folder (recursively) or a hand-picked file list
- **Supported file types**: `.txt`, `.md`/`.markdown`, `.csv`, `.tsv`, `.log`, `.json`, `.yaml`/`.yml`, and (via the corresponding optional Python packages) `.pdf`, `.docx`, `.pptx`, `.xlsx`
- **Indexing**: files are split into overlapping chunks (default 512 tokens per chunk, configurable overlap) and embedded via any OpenAI-compatible embeddings endpoint the user configures (base URL + model name); indexing runs as a background job with per-file progress and failure reporting
- **Storage**: each knowledge base is its own local SQLite database; chunk text is stored AES-GCM-encrypted (same server-side key material as the agent project registry), alongside its embedding vector and a content hash
- **Search**: cosine similarity over the stored embeddings (accelerated with `numpy` if installed, otherwise a pure-Python fallback), returning the most relevant chunks for a query
- **Management**: list, re-index, add/remove source files, delete, export, and import knowledge bases; per-knowledge-base settings (chunk size, overlap, etc.) can be changed after creation

### Knowledge-base API (proxy, requires an unlocked session)
| Endpoint | Method(s) | Purpose |
|---|---|---|
| `/kb/create` | POST | Register a folder or file list as a new knowledge base and start indexing |
| `/kb/list` | GET | List knowledge bases |
| `/kb/<id>/status` | GET | Indexing progress / result |
| `/kb/<id>/sources` | GET/DELETE | List / remove source files |
| `/kb/<id>/add-files` | POST | Add files by path to an existing knowledge base |
| `/kb/<id>/upload-files` | POST | Upload and add files directly |
| `/kb/<id>/reindex` | POST | Re-run indexing (e.g. after settings or source changes) |
| `/kb/<id>/search` | POST | Query the knowledge base for relevant chunks |
| `/kb/<id>/settings` | PATCH | Update chunk size/overlap and other settings |
| `/kb/<id>/export` | GET | Export a knowledge base |
| `/kb/import` | POST | Import a previously exported knowledge base |
| `/kb/<id>` | DELETE | Delete a knowledge base |

---

## Multi-account & browser sync

Ki-Connect supports multiple local accounts on the same machine. All data is stored in the `./datas/` subfolder next to `kiconnect-proxy.py`:

```
./datas/
├── _registry.json              (account list, plaintext: ID, name, pwHash, encSalt)
└── <accountId>/
    ├── config.json             (settings, AES-256-GCM encrypted)
    ├── providers.json          (API keys, AES-256-GCM encrypted)
    ├── profiles.json           (agent profiles, AES-256-GCM encrypted)
    ├── folders.json            (folder structure, AES-256-GCM encrypted)
    └── chats.json              (chat history, AES-256-GCM encrypted)
```

> Note: `_registry.json` contains no sensitive data - only account names, the PBKDF2 password hash, and the encryption salt. Chats, API keys, and all content are stored exclusively encrypted in the account subfolders. All accounts share the same server process and machine, so this is account separation for cooperating users on one computer, not isolation between mutually untrusted tenants.

Chrome, Firefox, and Edge on the same PC access the same accounts and chats without manual synchronization.

---

## Thinking / reasoning mode

For supported models (Claude 3.7 and up, GPT-5.x thinking variants, Grok, DeepSeek R1, Gemini 2.5+, and other reasoning-capable models across providers):

- **Anthropic Claude 4+** (Opus 4.8, Sonnet 5, Haiku 4.5, Fable 5, and the legacy 4.6 line): adaptive thinking - three effort levels (low/medium/high) using the `output_config.effort` API. Temperature is automatically omitted for these models.
- **Anthropic Claude 3.7**: legacy mode - continuous token budget (1,024-32,000 tokens)
- **OpenAI and most other providers**: discrete levels (low/medium/high) for reasoning effort
- **Fixed-thinking models** (e.g. MiniMax): on/off toggle only, no effort slider
- **Display**: collapsible "thinking process" block above the response

> Model catalogs (`js/providers/provider-models.js`) are updated as providers retire and release models - check that file for the current default list; most providers also load their live model list from the API once a key is added.

---

## Themes

Select a theme via the Tuning panel. Themes are saved per browser session without requiring a password.

| Theme | Style |
|---|---|
| `dark` | Default dark |
| `white` | Light / paper |
| `nord` | Nordic blue tones |
| `dracula` | Purple-pink accents |
| `forest` | Green tones |
| `mocha` | Warm brown |
| `rose` | Rose/pink |
| `solarized` | Solarized palette |
| `dark_oled` | Pure black OLED |
| `gold_oled` | Pure black + gold OLED |
| `emerald_oled` | Pure black + green OLED |
| `red_oled` | Pure black + red OLED |

---

## Multilingual support

Translations are located in `kiconnect-languages-i18n.js`. To add a new language:

1. Copy an existing language block (e.g. `en`)
2. Set the new language code as the key (e.g. `fr`)
3. Translate all values (keep keys identical)
4. Add the code to the `LANGUAGES` object at the top of the file

---

## Security overview

> Important: this is a personal tool for trusted environments, not an enterprise multi-tenant solution.

### What is protected

| Feature | Implementation | Protects against |
|---|---|---|
| Data storage | AES-GCM-256 in browser (chats, config, providers, profiles, folders), stored in `./datas/` | Data access without password |
| Agent project registry & knowledge-base chunks | AES-GCM-256 server-side (`cryptography`/AESGCM), key derived from account password + a dedicated salt, separate from the browser-side key | Data access without password, cross-key exposure |
| Login / password | PBKDF2-HMAC-SHA256, 600k iterations, random salt per account | Brute-force, rainbow tables |
| Brute-force (login) | Exponential lockout from the 5th failed attempt, RAM-only | Offline and online password guessing |
| Session | Encrypted token in sessionStorage (no plaintext password) | Password theft from browser storage |
| XSS | DOMPurify (bundled locally), strict CSP with no `'unsafe-inline'` in `script-src` (all former inline scripts, e.g. the MathJax config, now live in their own files) | Reflected & stored XSS |
| SSRF | No fixed domain allowlist (any OpenAI-compatible endpoint is allowed), but a tiered check on where the target address actually points: reserved/blocked ranges are rejected outright, LAN addresses require a one-time explicit confirmation, loopback/public proceed. The vetted IP is then DNS-pinned for the request's duration, so a low-TTL DNS answer can't rebind the target after the check ran | Server-side request forgery, DNS rebinding |
| CORS | Strict origin/host check, localhost-only | Unwanted cross-origin requests |
| Rate limiting | Thread-safe (lock), 120 requests/60s per IP | DoS, brute-force |
| File writing | Atomic write via `.tmp` + `os.replace()` | Data loss on proxy crash |
| Response handling | No `accept-encoding` forwarding, `location` header filter | Response injection, redirect exploits |

### Known limitations

| Risk | Assessment | Recommendation |
|---|---|---|
| Compromised systems (malware) | Limited protection - malware with user rights can access the browser/proxy | Use on clean systems only; rotate API keys if suspicious |
| Man-in-the-middle | TLS validation active (`verify=True`), proxy forwards HTTPS directly | Use on trusted networks only |
| XSS via AI output | DOMPurify filters, but complex payloads are theoretically possible | Exercise caution with suspicious outputs |
| Browser restart | After closing the tab: brief re-login required (RAM key gone) | Expected, secure behavior |
| Denial-of-service | 50 MB body limit (proxy), 100 MB per storage entry, rate limiting in place | Not sufficient for multi-tenant operation |
| Account isolation | Multiple accounts are encrypted separately, but all run under the same server process and OS user | Suitable for a small trusted group on one machine, not for mutually untrusted users |

### Architecture

```mermaid
flowchart LR
    B["<b>Browser</b><br/>━━━━━━━━━━<br/>AES-GCM-256<br><i>(encryption in browser)</i><br/>PBKDF2 (600k)<br/>DOMPurify <i>(local)</i><br/>marked.js <i>(local)<br/>MathJax <i>(local)<br/>PDF.js <i>(local)<br/>Brute-Force Lock"]
    P["<b>kiconnect-proxy.py</b><br/>127.0.0.1:5000<br/>━━━━━━━━━━<br/>CORS Proxy + Storage API + Agent-API<br/>./datas/ <i>(encrypted)</i><br/>Thread-safe, atomic I/O<br/>AES-GCM-256 <i>(cryptography, server-side)</i>"]
    A["<b>API Provider</b><br/>OpenAI etc.<br/>━━━━━━━━━━<br/>HTTPS<br/><i>no TLS termination</i><br/>DNS-pinned"]
    F["<b>Local filesystem</b><br/>project folder(s)<br/>━━━━━━━━━━<br/>read / write / copy / move / search<br/>optional shell exec <i>(sandboxed, opt-in)</i><br/>optional git checkpoints"]
    K["<b>Knowledge base</b><br/>SQLite + AES-GCM-256<br/>━━━━━━━━━━<br/>chunk + embed + search<br/>./datas/&lt;accountId&gt;/"]

    B <--> P
    P <--> A
    P <-- unlocked agent session --> F
    P <-- unlocked agent session --> K

    N["🔒 Password-protected<br/>PBKDF2 + session token<br/>No plaintext in storage"]
    B <-.- N

    style B fill:#e0f2fe,stroke:#0284c7,color:#000000
    style P fill:#fef9c3,stroke:#ca8a04,color:#000000
    style A fill:#dcfce7,stroke:#16a34a,color:#000000
    style F fill:#ede9fe,stroke:#7c3aed,color:#000000
    style K fill:#ffedd5,stroke:#ea580c,color:#000000
    style N fill:#fee2e2,stroke:#dc2626,color:#000000,stroke-dasharray: 3 3
```

---

## License

This project is licensed under a custom non-commercial license (MIT-style terms, non-commercial use only; not OSI-approved) - see [LICENSE](LICENSE). Non-commercial use, copying, modification, merging, publishing, and distribution are permitted, provided the copyright notice and license text are included. Commercial use, selling, or sublicensing for commercial purposes is not permitted without prior written permission from the author. The software is provided "as is", without warranty of any kind.

**Disclaimer:** This software is provided "as is". No liability is accepted for API costs, data loss, or security incidents. Use at your own risk.
