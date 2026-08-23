# Ki-Connect

Ki-Connect is a chat program that gives you access to several AI providers - for example ChatGPT (OpenAI), Claude (Anthropic), Gemini (Google), Grok (xAI) and others (*[list](TECHNICAL.md#configuration)*). The key difference to the usual web chats: Ki-Connect runs on your own machine, and your chats are stored locally and encrypted instead of sitting on some provider's servers.

Ki-Connect supports multiple local accounts on the same installation, but it is still designed as a personal tool for one household or one trusted group of people sharing a computer - not as a multi-tenant solution for a company with many independent, mutually untrusted users.

![Preview](./images_/preview.jpg)

---

## What makes Ki-Connect different

- **Your data stays with you.** Chats, settings, and API keys are stored on your own computer, not with Anthropic, OpenAI, or any other provider.
- **Stored encrypted.** Everything that's saved is encrypted and only accessible with your password.
- **Several accounts on one installation.** Multiple people who share the same computer can each keep their own password-protected, separately encrypted account.
- **Many AI providers in one place.** Switch between providers and models without needing several different programs.
- **Built-in coding agent.** Turn any chat into an agent working on a real folder on your computer - it can read, write, search, copy, and move files, and (only if you switch it on) run shell commands, with a choice of autonomy levels from "ask before every step" to "just do it." Optionally, it can save a checkpoint (a Git commit) before every change, so you can always roll back.
- **Knowledge base.** Point Ki-Connect at a folder or a set of files (text, Markdown, PDF, Word, PowerPoint, Excel, and more) and it builds a local, encrypted, searchable knowledge base it can pull relevant context from automatically while you chat.
- **Optional web search.** If you turn it on, the AI can look things up on the internet before answering.
- **Images and PDFs.** You can paste images or upload PDF files so the AI can read them.
- **Speak instead of type.** There's voice input as well as a read-aloud function for replies.
- **Multiple languages.** The interface is available in: English, German, French, Spanish, Italian, Turkish, Russian, Greek, Simplified Chinese, Arabic, Indian (Hindi, Tamil, Bengali, Punjabi, Urdu), Persian (Farsi).
- **Several color themes.** From light to dark, including pure-black variants for OLED screens.

---

## Requirements

Ki-Connect itself is just Python plus a web interface, so it can in principle run on Windows, macOS, or Linux wherever Python is available. **This particular release, however, is packaged and tested for Windows** - the included start scripts (`.bat` files) only work there. On macOS or Linux you would need to start the proxy manually with Python (see "Manual Installation" below).

- Python, unless you use the portable variant (see below)
- A modern browser (Chrome, Firefox, Edge, or Safari)
- At least one API key from an AI provider (e.g. OpenAI or Anthropic), which you can usually create for free or against a small fee on the provider's website

---

## How to start Ki-Connect (Windows)

There are three ways to start the program, depending on whether Python is already installed.

### Option 1: Python is already installed
Double-click **`START.bat`**. It automatically checks whether all required components are present, installs anything missing, and then starts the local server.

### Option 2: No Python installed, use the portable variant
Double-click **`START_portable.bat`**. This variant brings its own self-contained Python environment (in the `python` folder), so nothing needs to be installed system-wide. If that folder is missing, the script tells you where to download the matching Python package.

### Option 3: Manual installation (for advanced users)
```bash
git clone https://github.com/Waldemar-Koch-git/KiConnect.git
cd kiconnect
pip install flask requests waitress cryptography pypdf python-docx python-pptx openpyxl numpy
python kiconnect-proxy.py
```

In all cases, the program automatically opens your default browser at:

**http://localhost:5000**

If it doesn't open automatically, you can open that address yourself in any browser.

> If Windows shows a warning when you try to open a `.bat` file: this is normal for downloaded scripts. You can still run it via "More info" → "Run anyway".

---

## Automatic updates

On startup, Ki-Connect automatically checks (via `update.bat`) whether newer versions of the program files are available and downloads them if so. If there is no internet connection, this step is simply skipped and the program starts with the files already on your computer.

---

## First steps after starting

1. **Create an account:** On first launch, choose a name and a password. This password protects all your stored data.
2. **Follow the guided tour:** Right after creating your account, a short guided walkthrough starts automatically and shows you the most important buttons and settings step by step. You can skip it at any time and reopen it later if you want to see it again.
3. **Add a provider:** Use the plug icon to enter your API key for a provider (e.g. OpenAI or Anthropic).
4. **Choose a model:** You'll see a list of the models currently available from that provider.
5. **Get started:** Type your first message into the chat field.

---

## Common everyday features

- **Organize chats:** Sort conversations into folders and move them around via drag & drop.
- **Print:** Use the printer icon to print an entire chat or just a single message.
- **Branch:** Start a new direction from any point in a chat without losing the previous history.
- **Profiles:** Create several "personas" with their own presets, for example for different tasks.

---

## Coding agent

Any sidebar folder can be turned into a **project**: point it at a real folder on your computer (an existing one or a new one you create on the spot), then focus a chat on it via the toggle next to the model picker. From then on, that chat isn't just talking - it can look at, edit, search, and reorganize the files in that folder, using whichever provider/model you already have selected in the header.

- **One access mode per project**, chosen up front:
  - **Simulate** - describes what it would do, changes nothing
  - **Confirm** - asks before every file change or command
  - **Auto** - makes changes on its own
- **Shell commands are off by default** for every new project and must be explicitly switched on per project - even in Auto mode, this is a separate opt-in.
- **Checkpoints (optional)** - if turned on for a project and Git is available on your machine, Ki-Connect commits the folder's current state before every change the agent makes, so you always have a rollback point.
- Every tool call (read, write, search, move, copy, run command, etc.) is shown as a collapsible step in the chat, so you can always see what happened.
- Deleting a project only removes it from Ki-Connect - the files on disk are left untouched.

> Shell execution runs commands with best-effort sandboxing (resource limits, its own process group, optional network isolation where supported), but it is not a hard security boundary. Only enable it for projects and folders you trust, ideally on a machine you don't mind an errant command touching.

---

## Knowledge base

Any project folder or a hand-picked set of files can be indexed into a **knowledge base**: Ki-Connect splits the content into chunks, embeds them via an OpenAI-compatible embeddings endpoint you configure, and stores everything locally as encrypted, searchable data. Once built, the AI can pull the most relevant chunks into a chat automatically instead of you having to paste the source material in yourself. Supported file types include plain text, Markdown, CSV/TSV, JSON/YAML, PDF, Word, PowerPoint, and Excel.

---

## Important note

Ki-Connect is a tool for personal use, or use by a small trusted group, on your own computer. It does not replace a professional IT security solution for a company with many independent users. Further technical details, for example on encryption, security mechanisms, and the coding agent, can be found in [TECHNICAL.md](TECHNICAL.md).

---

## License

This project is licensed under a custom non-commercial license - see [LICENSE](LICENSE). Non-commercial use, copying, and modification are permitted; commercial use requires prior written permission from the author.

**Disclaimer:** This software is provided "as is". No liability is accepted for API costs, data loss, or security incidents. Use at your own risk.
