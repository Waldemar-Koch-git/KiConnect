// kiconnect-agent.js – Coding-Agent module (v3.0), self-contained bolt-on
// (like kiconnect-voice.js). A "project" is a sidebar folder with an extra
// `agentProject` field pointing at a filesystem folder on the proxy; a chat
// filed into it runs the agent's tool loop, rendered as collapsed <details>
// cards. One shared model picker app-wide; only autonomy mode is per-project.

(function () {
  'use strict';

  // ── i18n helper (falls back to the given text if no TRANSLATIONS
  // entry exists — this module doesn't require editing the i18n file) ─
  function t(key, fallback) {
    try {
      /* global TRANSLATIONS, currentLang */
      if (typeof TRANSLATIONS !== 'undefined' && typeof currentLang !== 'undefined') {
        const lang = TRANSLATIONS[currentLang] || TRANSLATIONS.en || {};
        const val = lang[key] ?? (TRANSLATIONS.en || {})[key];
        if (val != null) return val;
      }
    } catch (e) {}
    return fallback || key;
  }
  // Like t(), but substitutes {placeholder} vars; prefers the host app's tf().
  // All English text lives in _lang/<code>.js — t()'s own key-fallback (see
  // above) covers the case where a key is somehow missing there.
  function tf(key, vars) {
    if (typeof window.tf === 'function' && window.tf !== tf) {
      return window.tf(key, vars);
    }
    let s = t(key);
    if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replaceAll(`{${k}}`, v); });
    return s;
  }
  function showToast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    console.log('[Agent]', msg);
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Settings persistence: just the default autonomy mode for new projects.
  // The model itself always comes from the header's model picker (config.model).
  const SETTINGS_KEY = 'kic_agent_settings';
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
  }
  function saveSettings(patch) {
    const next = { ...loadSettings(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
    return next;
  }
  let settings = { autonomy: 'confirm', ...loadSettings() };

  // Runtime state. No single global run/abortController pair: kiconnect.js's
  // isChatStreaming/runsForChat read the same activeRuns registry this module
  // writes into (kind:'agent'), so several project chats can run at once.
  // `pendingConfirm` is still a single global, so two simultaneous
  // confirm-required tool calls queue behind one confirm bar — known
  // limitation, would need a per-chat confirm queue to fix properly.
  let pendingConfirm = null;

  const MAX_ITERATIONS = 200;

  // Generic (provider-agnostic) tool-result compaction.
  // Most providers we talk to already have their own automatic prefix
  // caching as of 2026, where an unchanged request prefix is billed cheaply.
  // compactOldToolResults() mutates old `history` entries to shrink payload
  // size for providers WITHOUT such caching — but for providers WITH it,
  // that mutation invalidates the cached prefix on nearly every loop
  // iteration, so it's counterproductive there. Scoped to
  // KNOWN_CACHING_PROVIDERS below: skipped for known-caching providers, still
  // applied for an unknown openai-compat endpoint where caching can't be
  // assumed. Only touches TOOL RESULTS older than KEEP_RECENT_TOOL_TURNS,
  // never user/model text, and replaces content with a labeled placeholder
  // (tool + main argument) so the model can re-call the tool if still needed
  // — the file on disk is untouched, only the copy sent to the model shrinks.
  const KEEP_RECENT_TOOL_TURNS = 6;   // tool-result turns kept 100% intact
  const COMPACT_MIN_SIZE = 400;       // don't bother compacting tiny results (chars)

  // Providers with known automatic (or session-id-assisted) prefix caching,
  // per each vendor's own 2026 docs. Anthropic is handled separately
  // (explicit cache_control, see callModel) and never passed to
  // compactOldToolResults. Anything not in this set (today: a freely
  // configured 'openai-compat' endpoint) still gets compacted.
  const KNOWN_CACHING_PROVIDERS = new Set([
    'anthropic', 'openai-direct', 'kimi', 'deepseek', 'mistral',
    'google', 'xai', 'groq', 'minimax', 'zhipu', 'openrouter',
  ]);

  function compactToolCallLabel(name, args) {
    if (!args) return name;
    const key = args.path || (Array.isArray(args.paths) && args.paths[0]) || (Array.isArray(args.items) && args.items[0] && args.items[0].from) || args.query || args.command || args.from;
    return key ? `${name}(${String(key).slice(0, 60)})` : name;
  }

  function compactOldToolResults(history) {
    const toolTurnIdx = [];
    history.forEach((h, i) => { if (h.role === 'tool_results') toolTurnIdx.push(i); });
    const cutoff = toolTurnIdx.length - KEEP_RECENT_TOOL_TURNS;
    for (let k = 0; k < cutoff; k++) {
      const entry = history[toolTurnIdx[k]];
      (entry.results || []).forEach(r => {
        if (r._compacted) return; // already done — idempotent, cheap to call every iteration
        let size = 0;
        try { size = JSON.stringify(r.result || {}).length; } catch (e) { size = 0; }
        if (size < COMPACT_MIN_SIZE) return; // not worth touching
        r._compacted = true;
        r.result = {
          _compacted: true,
          note: `[${tf('agent.compactedNote', {})}: ${compactToolCallLabel(r.name, r.args)} — ~${size} chars. ${tf('agent.compactedHint', {})}]`,
        };
      });
    }
  }

  const TOOL_ICONS = {
    list_files: '📂', search_in_files: '🔎', read_file: '📖', read_files: '📚',
    create_file: '🆕', write_file: '✏️', edit_file: '✂️', write_files: '📝',
    delete_file: '🗑️', delete_files: '🗑️', create_directory: '📁', create_directories: '📁',
    delete_directory: '🗑️📁', delete_directories: '🗑️📁', move_file: '🔀', replace_in_files: '🔁',
    copy_file: '📄', copy_files: '📄',
    web_search: '🌐', fetch_url: '🔗', run_command: '⚡',
  };
  // Functions, not plain objects, so they read the CURRENT UI language at
  // render time — lets the header language switcher update open tool traces.
  function toolLabel(name) {
    const LABELS = {
      list_files: t('agent.tool.list'), search_in_files: t('agent.tool.search'),
      read_file: t('agent.tool.read'), read_files: t('agent.tool.readMulti'),
      create_file: t('agent.tool.create'), write_file: t('agent.tool.write'),
      edit_file: t('agent.tool.editFile'), write_files: t('agent.tool.writeMulti'),
      delete_file: t('agent.tool.delFile'), delete_files: t('agent.tool.delFilesMulti'),
      create_directory: t('agent.tool.mkdir'), create_directories: t('agent.tool.mkdirMulti'),
      delete_directory: t('agent.tool.rmdir'), delete_directories: t('agent.tool.rmdirMulti'),
      move_file: t('agent.tool.move'), replace_in_files: t('agent.tool.replaceMulti'),
      copy_file: t('agent.tool.copy'), copy_files: t('agent.tool.copyMulti'),
      web_search: t('agent.tool.webSearch'), fetch_url: t('agent.tool.fetchUrl'),
      run_command: t('agent.tool.runCommand'),
    };
    return LABELS[name] || name;
  }
  function statusText(status) {
    const TEXT = {
      running: '⏳', pending: '⏳ ' + t('agent.waitingConfirm'),
      done: '✅', rejected: '🚫 ' + t('agent.rejectedShort'),
      error: '❌ ' + t('agent.errorShort'), simulated: '🧪 ' + t('agent.simulatedShort'),
    };
    return TEXT[status] || '';
  }
  // Compact "what is this step about" label for the confirm bar and step
  // summary — handles single paths, move's from→to, and batch paths[]/files[].
  function stepSubjectText(step) {
    const a = step.args || {};
    if (a.command) return a.command;
    if (a.path) return a.path;
    if (a.from && a.to) return `${a.from} → ${a.to}`;
    const list = Array.isArray(a.paths) ? a.paths : Array.isArray(a.files) ? a.files.map(f => f && f.path)
      : Array.isArray(a.items) ? a.items.map(it => it && it.from && it.to ? `${it.from} → ${it.to}` : (it && it.path)) : null;
    if (list) return list.length <= 3 ? list.filter(Boolean).join(', ') : tf('agent.nItems', { n: list.length });
    return '';
  }

  function langFromPath(p) {
    const ext = (String(p || '').split('.').pop() || '').toLowerCase();
    const map = { js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python', html: 'html',
      css: 'css', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml', java: 'java',
      c: 'c', cpp: 'cpp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql', xml: 'xml' };
    return map[ext] || '';
  }

  // Tool schema (OpenAI-style function calling). Sent to the MODEL as part
  // of the function-calling schema, not shown as UI text — kept in English
  // on purpose, same as systemPrompt() above.
  function toolSchema(folder) {
    const tools = [
      { type: 'function', function: { name: 'list_files', description: 'Recursively lists files in the project (optionally below a subfolder), including file size in bytes. Optionally filter by a glob pattern (e.g. "*.tmp", "**/*.md") so you don\'t have to scan the whole tree yourself when you only care about a subset of files — e.g. before a bulk operation like "delete all .tmp files".', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Subfolder relative to the project root. Leave empty for the whole project.' }, pattern: { type: 'string', description: 'Optional glob pattern to filter results, e.g. "*.log" or "src/**/*.ts". "*" matches within a path segment, "**" matches across folders.' } } } } },
      { type: 'function', function: { name: 'search_in_files', description: 'Searches all text files in the project (like grep) for a term or regular expression and returns matches with file, line number, and line content. Useful for finding functions, variables, or text across the whole codebase before reading files individually. To search or read ONE SPECIFIC FILE you already know the name of, use read_file instead — do not put a filename in this tool\'s `path` parameter (see below).', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search term or (if regex=true) regular expression.' }, path: { type: 'string', description: 'Optional: restrict the search to a SUBFOLDER, given as a path relative to the project root (e.g. "src/utils") — never an absolute path, "..", or the project\'s own folder name prefixed on top (paths from list_files/search_in_files results are already relative to the root; use them as-is). This must be a FOLDER, never a filename (e.g. "config.js" is invalid here) — if you already know which single file to look at, call read_file with that path instead of putting the filename here. Omit `path` entirely to search the whole project.' }, regex: { type: 'boolean', description: 'true = interpret query as a regular expression.' }, caseSensitive: { type: 'boolean', description: 'true = match case exactly.' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_file', description: 'Reads the text content of a file in the project — including PDFs, whose text is extracted automatically (no separate step needed; scanned/image-only PDFs with no text layer will come back as unreadable, same as any other binary file). For large files, pass startLine/endLine to read just a range instead of the whole thing — much cheaper than pulling in a huge file when you only need one section.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the project root, e.g. "src/main.py"' }, startLine: { type: 'integer', description: 'Optional 1-based first line to include.' }, endLine: { type: 'integer', description: 'Optional 1-based last line to include (inclusive).' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'read_files', description: 'Reads several files in one call instead of one read_file call per file — use this whenever a task requires looking at more than one file (e.g. comparing two files, or gathering context from several files before editing).', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the project root.' } }, required: ['paths'] } } },
      { type: 'function', function: { name: 'create_file', description: 'Creates a new file with content. Fails if the file already exists (use write_file for that).', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
      { type: 'function', function: { name: 'write_file', description: 'Completely overwrites an existing file with new content, or creates it if it does not exist yet. For a small, targeted change to an otherwise-large file, prefer edit_file instead — it is much cheaper since you don\'t have to resend the whole file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
      { type: 'function', function: { name: 'edit_file', description: 'Makes one or more targeted changes to an existing file by replacing exact snippets, instead of resending the entire file like write_file does. Each old_str must match the file\'s current content exactly, including whitespace, and must occur exactly once — read the file first if you\'re not sure of the exact text. Prefer this over write_file whenever you\'re changing only part of a file, especially a large one. For several changes to the SAME file, pass `edits` (applied in order, one call, one confirmation) instead of calling edit_file once per change.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_str: { type: 'string', description: 'Exact text to find — must appear exactly once in the file. Omit if using `edits` instead.' }, new_str: { type: 'string', description: 'Text to replace it with. Leave empty/omit to delete old_str.' }, edits: { type: 'array', description: 'Optional: several {old_str,new_str} pairs to apply to this file in one call instead of old_str/new_str above.', items: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['old_str'] } } }, required: ['path'] } } },
      { type: 'function', function: { name: 'write_files', description: 'Creates or overwrites several files in one call — use this instead of separate write_file/create_file calls whenever a task touches multiple files at once (e.g. scaffolding several new files). Confirmed and executed as a single batch, not one prompt per file.', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, createOnly: { type: 'boolean', description: 'true = fail instead of overwriting if the file already exists.' } }, required: ['path', 'content'] } } }, required: ['files'] } } },
      { type: 'function', function: { name: 'delete_file', description: 'Permanently deletes a single file. If you need to delete more than one file, use delete_files instead — it deletes them all in one call and one confirmation.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'delete_files', description: 'Deletes several files in one call instead of one delete_file call per file — use this for any task that removes more than one file (e.g. "delete all files in this folder", "remove these 5 files").', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } } },
      { type: 'function', function: { name: 'move_file', description: 'Moves or renames a file or folder within the project without reading or resending its content — use this instead of read_file + create_file + delete_file when relocating or renaming something, especially for large files. This DELETES the original at `from` — never use this for a "copy X to Y" / "duplicate X as Y" request, since that must leave the original in place; use copy_file for that instead.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, overwrite: { type: 'boolean', description: 'true = replace an existing file/folder already at the destination.' } }, required: ['from', 'to'] } } },
      { type: 'function', function: { name: 'copy_file', description: 'Copies a file or folder to a new path within the project, WITHOUT reading or resending its content and without touching the original — use this for any "copy X to Y", "duplicate X", or "make a copy of X" request, instead of read_file + create_file (which would waste tokens on large files and risks truncated copies) and instead of move_file (which deletes the original — wrong for a copy).', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, overwrite: { type: 'boolean', description: 'true = replace an existing file/folder already at the destination.' } }, required: ['from', 'to'] } } },
      { type: 'function', function: { name: 'copy_files', description: 'Copies several files/folders in one call instead of one copy_file call per item — use this whenever a task copies more than one file (e.g. "copy all .js files in src/ to backup/").', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['from', 'to'] } } }, required: ['items'] } } },
      { type: 'function', function: { name: 'replace_in_files', description: 'Replaces every occurrence of an exact text (or, if regex=true, every regex match) across several files in ONE call and ONE confirmation — e.g. renaming a function/variable everywhere it is used. Use search_in_files first to find which files contain it, then pass those paths here instead of one read_file + edit_file round trip per file.', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' }, description: 'Files to apply the replacement to (get these from search_in_files or list_files).' }, find: { type: 'string', description: 'Exact text, or (if regex=true) a regular expression, to find.' }, replace: { type: 'string', description: 'Replacement text.' }, regex: { type: 'boolean', description: 'true = interpret find as a regular expression (matched with the global flag).' } }, required: ['paths', 'find'] } } },
      { type: 'function', function: { name: 'create_directory', description: 'Creates a (possibly nested) folder.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'create_directories', description: 'Creates several (possibly nested) folders in one call.', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } } },
      { type: 'function', function: { name: 'delete_directory', description: 'Permanently deletes a folder and all of its contents.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'delete_directories', description: 'Permanently deletes several folders (and their contents) in one call.', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } } },
      { type: 'function', function: { name: 'web_search', description: 'Searches the web via the search engine configured in KI Connect and returns title, URL, and short description of the results. Useful for current information, documentation, or library/API research while working on the project.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'fetch_url', description: 'Fetches a single webpage and returns its readable text content (e.g. to read a documentation page or search result more closely).', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    ];
    // Only offered to the model at all if the user explicitly enabled shell
    // execution for THIS project (⚙ Agent Settings) — see agentExec().
    if (folder && folder.agentShellEnabled) {
      tools.push({ type: 'function', function: { name: 'run_command', description: 'Runs a terminal command in the project folder (e.g. npm install, pytest, ls) and returns stdout/stderr/exit code. Runs with the same permissions as the local server — use sparingly and precisely.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Optional: subfolder relative to the project root in which the command runs.' } }, required: ['command'] } } });
    }
    return tools;
  }
  // Same tools, translated to Anthropic's `tools` shape (name/description/
  // input_schema) — used for Anthropic models, since Messages API doesn't
  // speak the OpenAI-compatible /chat/completions format.
  function toolSchemaAnthropic(folder) {
    return toolSchema(folder).map(f => ({ name: f.function.name, description: f.function.description, input_schema: f.function.parameters }));
  }
  // Sent to the MODEL, not shown in the UI — deliberately always English
  // regardless of UI language, since it's an internal system prompt, not a
  // translated interface string.
  function systemPrompt(projectName) {
    return [
      `You are an autonomous coding agent with access to the local project folder "${projectName}".`,
      `That project folder itself is the root every path you pass to a tool is relative to — it already IS "${projectName}", so paths must NOT repeat that name. To create a file directly in the project, pass "file.txt", not "${projectName}/file.txt". Never create a new top-level folder that just repeats the project's own name ("${projectName}/${projectName}/...") — if list_files already shows a folder with that name at the root, that is almost always a mistake from an earlier step, not something to build on; ask yourself whether you actually meant the project root itself before adding another folder like it.`,
      `You can only read, create, modify, and delete files through the provided tools — you have no other access to the file system.`,
      `Work step by step: if needed, first use list_files/search_in_files/read_file to get an overview of the existing project structure and the relevant code before you modify files.`,
      `Use search_in_files to find functions, variables, or text across the whole project instead of guessing file names or reading files blindly one by one.`,
      `Prefer the batch tools (read_files, write_files, delete_files, create_directories, delete_directories) over calling their single-file counterparts repeatedly whenever a task touches more than one file — e.g. for "delete all files in this folder" call list_files once, then delete_files once with every matching path, not one delete_file call per file.`,
      `Prefer edit_file over write_file for a small change to an otherwise-large file — it only needs the exact snippet being changed, not the whole file; pass edit_file's \`edits\` array when a file needs several separate changes, instead of calling edit_file once per change. Use move_file to rename/relocate a file or folder instead of reading and rewriting its content — but move_file DELETES the original, so never use it for "copy"/"duplicate" requests; use copy_file (or copy_files for several items) for those instead, since it leaves the original in place. Use replace_in_files instead of read_file+edit_file per file when the exact same text needs to change in several files at once (e.g. renaming a function everywhere it's used) — search_in_files first to find which files are affected.`,
      `Tool results can be large (e.g. a big file's content) and may be shown to you truncated with a note saying how much was cut off. NEVER call write_file on a file you only saw truncated or partially — you would overwrite the rest of the file with content you never actually saw. For reorganizing, reformatting, or otherwise touching most of a large file, use several edit_file/replace_in_files calls on the specific parts that change instead of write_file with the whole new content.`,
      `Use web_search and fetch_url when you need current information, documentation, or details about a library/API that you're not sure about.`,
      `Only make changes that belong to the given task. At the end, reply in short, plain prose about what you did — that ends the run.`,
      `If important information is missing, make a reasonable assumption, state it briefly, and continue instead of asking back.`,
    ].join(' ') + profileAddendum();
  }

  // The active chat profile's custom system prompt used to have no effect in
  // agent mode (systemPrompt() only sent its own hard-coded rules). This
  // appends the profile's prompt, if any, AFTER the agent's own rules, so it
  // layers "how to behave" on top of "how to use these tools" instead of
  // fighting it. Contributes nothing if no profile/prompt is set. (Profile
  // temperature already applies automatically via config.temperature.)
  function profileAddendum() {
    const p = (typeof activeProfile === 'function') ? activeProfile() : null;
    const text = p && p.systemPrompt ? String(p.systemPrompt).trim() : '';
    return text ? `\n\nAdditionally, follow this persona/style guidance for how you communicate: ${text}` : '';
  }

  // Backend calls: /agent/* on the local proxy. Every call goes through this
  // wrapper so it carries the current agent-session token (see
  // kiconnect.js: unlockAgentSession()/agentSessionHeader()). A 401 (project
  // registry can't be decrypted) is treated as an expired session and sends
  // the user back to login, like any other expired session.
  /* global agentSessionHeader, logoutNow, toast */
  async function agentFetch(url, opts) {
    opts = opts || {};
    const sessionHeaders = typeof agentSessionHeader === 'function' ? agentSessionHeader() : {};
    const headers = { ...(opts.headers || {}), ...sessionHeaders };
    const res = await fetch(url, { ...opts, headers });
    // Same as kiconnect-db.js's kbFetch(): a 401 with no token sent just
    // means "not logged in yet", not an expired session.
    if (res.status === 401 && Object.keys(sessionHeaders).length) {
      if (typeof toast === 'function') toast(t('agent.err.sessionExpired'));
      if (typeof logoutNow === 'function') logoutNow();
    }
    return res;
  }
  function encPath(p) {
    return String(p).replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }
  // Shared body for agentFetch()-based JSON calls: parses the response, and
  // on a non-ok status either throws or returns { error } (for tool-facing
  // calls, which report failures back to the model instead of raising).
  async function agentJson(url, opts, throwOnError) {
    const res = await agentFetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      if (throwOnError) throw new Error(msg);
      return { error: msg };
    }
    return data;
  }
  async function apiListProjects() {
    const res = await agentFetch('/agent/projects');
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return (await res.json()).projects || [];
  }
  async function apiBrowse(path) {
    return agentJson('/agent/browse' + (path ? `?path=${encodeURIComponent(path)}` : ''), undefined, true);
  }
  async function apiCreateProject(name, path, create) {
    return agentJson('/agent/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, path, create: !!create }) }, true);
  }
  async function apiDeleteProject(projectId) {
    return agentJson(`/agent/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }, true);
  }
  async function apiTree(project) {
    const res = await agentFetch(`/agent/tree/${encodeURIComponent(project)}`);
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }
  async function apiSearch(project, query, opts) {
    opts = opts || {};
    const params = new URLSearchParams({ q: query });
    if (opts.regex) params.set('regex', '1');
    if (opts.caseSensitive) params.set('case', '1');
    if (opts.path) params.set('path', opts.path);
    return agentJson(`/agent/search/${encodeURIComponent(project)}?${params.toString()}`, undefined, false);
  }
  // Base64 -> ArrayBuffer, turning the backend's content_b64 (see
  // agent_file() in kiconnect-proxy.py) into something pdf.js can parse.
  function _b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }
  async function apiReadFile(project, path) {
    const res = await agentFetch(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`);
    if (res.status === 404) return { error: t('agent.err.fileNotFound') };
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json();
    // PDFs come back as binary (content_b64) since they're not valid UTF-8
    // text. extractPdfText() reuses the same pdf.js extraction kiconnect.js
    // uses for PDF chat attachments, instead of giving up on any project
    // PDF. Falls through to the raw binary response if pdf.js isn't loaded
    // or extraction fails (e.g. a scanned image-only PDF).
    if (data && data.binary && data.content_b64 && /\.pdf$/i.test(path)) {
      try {
        const lib = window._pdfjsLib || window.pdfjsLib;
        if (!lib) throw new Error('pdf.js not loaded');
        const text = await extractPdfText(_b64ToArrayBuffer(data.content_b64));
        return { path: data.path, content: text, binary: false, _pdfExtracted: true };
      } catch (e) {
        // Leave data.binary/content as-is; log the failed extraction attempt
        // instead of swallowing it silently.
        console.warn('PDF text extraction failed for', path, e);
      }
    }
    return data;
  }
  async function apiWriteFile(project, path, content, createOnly) {
    return agentJson(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, createOnly: !!createOnly }),
    }, false);
  }
  async function apiDeleteFile(project, path) {
    return agentJson(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'DELETE' }, false);
  }
  async function apiMkdir(project, path) {
    return agentJson(`/agent/dir/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'POST' }, false);
  }
  async function apiRmdir(project, path) {
    return agentJson(`/agent/dir/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'DELETE' }, false);
  }
  // Moves/renames a file or folder server-side — no content ever passes
  // through the model's context, unlike a read+create+delete round trip.
  async function apiMove(project, from, to, overwrite) {
    return agentJson(`/agent/move/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, overwrite: !!overwrite }),
    }, false);
  }
  // Copies a file/folder server-side (recursively) — unlike apiMove, the
  // original is left untouched. Requires /agent/copy/<project> in the proxy.
  async function apiCopy(project, from, to, overwrite) {
    return agentJson(`/agent/copy/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, overwrite: !!overwrite }),
    }, false);
  }
  // Runs a shell command via the proxy's sandboxed /agent/exec/<id>. Only
  // reachable if the project has shell execution enabled; backend re-checks.
  async function apiExec(project, command, cwd) {
    return agentJson(`/agent/exec/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd }),
    }, false);
  }
  async function apiSetShellEnabled(project, enabled) {
    return agentJson(`/agent/projects/${encodeURIComponent(project)}/shell`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!enabled }),
    }, true);
  }
  async function apiSetCheckpointsEnabled(project, enabled) {
    return agentJson(`/agent/projects/${encodeURIComponent(project)}/checkpoints`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!enabled }),
    }, true);
  }
  // Stages+commits whatever changed since the last checkpoint, via the
  // project's git repo. Called right before a mutating tool runs (see
  // executeTool()) — never blocks the tool on failure, since a missing
  // safety net shouldn't stop the agent. throwOnError=false so a failed git
  // is a quiet {error} the caller can surface once.
  async function apiCheckpoint(project, message) {
    return agentJson(`/agent/checkpoint/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    }, false);
  }
  // Re-points an already-registered project at a different real folder,
  // instead of the target only being settable at first registration.
  async function apiSetProjectPath(project, path, create) {
    return agentJson(`/agent/projects/${encodeURIComponent(project)}/path`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, create: !!create }),
    }, true);
  }

  // Minimal glob matcher for list_files' `pattern` filter ("*" within a
  // segment, "**" across segments, "?" one char) — not a full glob impl.
  function _globToRegex(pattern) {
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          re += '.*'; i++;
          if (pattern[i + 1] === '/') i++;
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if ('.+^${}()|[]\\'.includes(c)) {
        re += '\\' + c;
      } else {
        re += c;
      }
    }
    return new RegExp('^' + re + '$', 'i');
  }

  // Flags paths like "test/test/..." — a folder segment repeating its own
  // parent's name, almost always an accidental self-nesting mistake. Mutating
  // tools attach a warning to their result so the model can self-correct.
  function selfNestedWarning(p) {
    const segs = String(p || '').replace(/\\/g, '/').split('/').filter(Boolean);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].toLowerCase() === segs[i - 1].toLowerCase()) {
        return tf('agent.warnSelfNested', { path: p, seg: segs[i] });
      }
    }
    return null;
  }
  function withNestWarning(path, result) {
    if (result && !result.error) {
      const w = selfNestedWarning(path);
      if (w) result.warning = w;
    }
    return result;
  }
  function mergeWarnings(result, extra) {
    if (result && !result.error && extra) result.warning = result.warning ? `${result.warning} ${extra}` : extra;
    return result;
  }

  // Detects a write_file call that would blow away over half of an
  // existing, non-trivial file. Guards against an observed failure: a weak
  // model only sees a truncated slice of a large file (see
  // serializeToolResult()'s per-field truncation below), has no way to know
  // its view was incomplete, and silently overwrites the rest on write_file.
  // Compares against the file's CURRENT size from the tree listing (cheap,
  // no content read).
  async function shrinkRisk(project, path, newContent) {
    try {
      const tree = await apiTree(project);
      const entry = (tree.files || []).find(f => f.path === path);
      if (!entry || typeof entry.size !== 'number') return null;
      const oldSize = entry.size, newSize = (newContent || '').length;
      if (oldSize > 2000 && newSize < oldSize * 0.5) return { oldSize, newSize };
    } catch (e) {}
    return null;
  }

  // Reads the file, applies one or more exact-text replacements in order,
  // and writes it back in one round trip — shared by edit_file's single
  // old_str/new_str form and its `edits` array form (several changes, one
  // call, one confirmation).
  async function applyEditFile(project, args) {
    if (!args.path) return { error: t('agent.err.missingPath') };
    const edits = Array.isArray(args.edits) && args.edits.length
      ? args.edits
      : [{ old_str: args.old_str, new_str: args.new_str }];
    if (!edits.length || edits.some(e => !e || typeof e.old_str !== 'string' || !e.old_str)) {
      return { error: t('agent.err.missingOldStr') };
    }
    const res = await apiReadFile(project, args.path);
    if (res.error) return res;
    if (res.binary || typeof res.content !== 'string') return { error: t('agent.err.binaryEdit') };
    let content = res.content;
    for (const e of edits) {
      const first = content.indexOf(e.old_str);
      if (first === -1) return { error: tf('agent.err.oldStrNotFound', { snippet: e.old_str.slice(0, 60) }) };
      if (content.indexOf(e.old_str, first + 1) !== -1) return { error: tf('agent.err.oldStrNotUnique', { snippet: e.old_str.slice(0, 60) }) };
      content = content.slice(0, first) + (e.new_str ?? '') + content.slice(first + e.old_str.length);
    }
    const writeRes = await apiWriteFile(project, args.path, content, false);
    if (writeRes.error) return writeRes;
    return { ...writeRes, edits: edits.length };
  }

  // Applies one find→replace across several files in one call/confirmation
  // (e.g. renaming a symbol project-wide), meant to follow
  // search_in_files/list_files narrowing down the affected paths.
  async function applyReplaceInFiles(project, args) {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    if (!paths.length) return { error: t('agent.err.missingPaths') };
    if (!args.find) return { error: t('agent.err.missingQuery') };
    const re = args.regex ? new RegExp(args.find, 'g') : null;
    const results = [];
    for (const p of paths) {
      const res = await apiReadFile(project, p);
      if (res.error) { results.push({ path: p, error: res.error }); continue; }
      if (res.binary || typeof res.content !== 'string') { results.push({ path: p, error: t('agent.err.binaryEdit') }); continue; }
      const count = re ? (res.content.match(re) || []).length : res.content.split(args.find).length - 1;
      if (!count) { results.push({ path: p, changed: false }); continue; }
      const next = re ? res.content.replace(re, args.replace ?? '') : res.content.split(args.find).join(args.replace ?? '');
      const writeRes = await apiWriteFile(project, p, next, false);
      results.push({ path: p, occurrences: count, ...writeRes });
    }
    return { files: results };
  }

  // Read cache (scoped to a single agent turn). A tool loop often reads the
  // same file more than once (search_in_files -> read_file, edit_file
  // re-reading before applying); without this each re-read hits disk and
  // re-pumps content into context. Cleared at the start of every turn and
  // fully flushed before any mutating tool call — coarse (drops the whole
  // cache, not just the written file) but simple and never stale.
  const _readFileCache = new Map(); // `${project}::${path}` -> apiReadFile() result
  async function cachedReadFile(project, path) {
    const key = `${project}::${path}`;
    if (_readFileCache.has(key)) return _readFileCache.get(key);
    const res = await apiReadFile(project, path);
    // Don't cache errors — e.g. a 404 right after create_file shouldn't
    // stick around and mask a file that shows up moments later.
    if (res && !res.error) _readFileCache.set(key, res);
    return res;
  }

  // Git checkpoints (opt-in per project, see agentCheckpointsEnabled).
  // Every disk-mutating tool, used to gate the pre-mutation apiCheckpoint()
  // call below. Excludes create_file/create_directory(ies) since those only
  // add, never destroy, existing content.
  const MUTATING_TOOL_NAMES = new Set([
    'write_file', 'write_files', 'edit_file', 'delete_file', 'delete_files',
    'move_file', 'copy_file', 'copy_files', 'replace_in_files', 'delete_directory', 'delete_directories',
  ]);
  const _checkpointWarned = new Set(); // project ids already warned about missing git this session
  function projectCheckpointsEnabled(projectId) {
    const f = folders.find(x => x.agentProject === projectId);
    return !!(f && f.agentCheckpointsEnabled);
  }
  function checkpointMessage(name, args) {
    return `Agent: ${compactToolCallLabel(name, args)}`.slice(0, 200);
  }

  // Tool execution (respects autonomy mode). `run` is the specific RunState
  // this call belongs to — threaded through so the confirm-bar rerender
  // updates THIS run's bubble even while another chat's run is in flight.
  async function executeTool(name, args, project, autonomy, step, run) {
    if (name === 'list_files') {
      const data = await apiTree(project);
      const prefix = (args.path || '').replace(/\\/g, '/').replace(/\/+$/, '');
      let files = prefix ? data.files.filter(f => f.path === prefix || f.path.startsWith(prefix + '/')) : data.files;
      if (args.pattern) {
        const re = _globToRegex(String(args.pattern));
        files = files.filter(f => re.test(f.path));
      }
      return { files, truncated: !!data.truncated };
    }
    if (name === 'search_in_files') {
      if (!args.query) return { error: t('agent.err.missingQuery') };
      return apiSearch(project, args.query, { regex: args.regex, caseSensitive: args.caseSensitive, path: args.path });
    }
    if (name === 'read_file') {
      if (!args.path) return { error: t('agent.err.missingPath') };
      const res = await cachedReadFile(project, args.path);
      if (res.error || res.binary || typeof res.content !== 'string') return res;
      if (args.startLine || args.endLine) {
        const lines = res.content.split('\n');
        const start = Math.max(1, args.startLine || 1);
        const end = Math.min(lines.length, args.endLine || lines.length);
        return { ...res, content: lines.slice(start - 1, end).join('\n'), lineRange: { start, end, totalLines: lines.length } };
      }
      return res;
    }
    if (name === 'read_files') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths') };
      const files = [];
      for (const p of paths) files.push({ path: p, ...(await cachedReadFile(project, p)) });
      return { files };
    }
    if (name === 'web_search') {
      if (!args.query) return { error: t('agent.err.missingQuery') };
      try {
        const data = await performWebSearch(args.query);
        return data || { results: [] };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'fetch_url') {
      if (!args.url) return { error: t('agent.err.missingUrl') };
      try { return await fetchLinkedPage(args.url); }
      catch (err) { return { error: err.message }; }
    }

    // A risky overwrite forces the same confirm step as "Confirm" mode,
    // regardless of actual autonomy setting — silently applying it in
    // "Autonomous" mode could destroy data the model never fully saw (see
    // shrinkRisk()). Skipped in "Simulate" mode since nothing is written.
    let riskWarning = null, riskyFileMsgs = null;
    if (autonomy !== 'simulate') {
      if (name === 'write_file' && typeof args.content === 'string') {
        const risk = await shrinkRisk(project, args.path, args.content);
        if (risk) riskWarning = tf('agent.warnShrink', { path: args.path, oldSize: risk.oldSize, newSize: risk.newSize });
      } else if (name === 'write_files' && Array.isArray(args.files)) {
        riskyFileMsgs = new Map();
        for (const f of args.files) {
          if (!f || f.createOnly || typeof f.content !== 'string') continue;
          const risk = await shrinkRisk(project, f.path, f.content);
          if (risk) riskyFileMsgs.set(f.path, tf('agent.warnShrink', { path: f.path, oldSize: risk.oldSize, newSize: risk.newSize }));
        }
        if (riskyFileMsgs.size) {
          riskWarning = riskyFileMsgs.size === 1 ? [...riskyFileMsgs.values()][0] : tf('agent.warnShrinkMulti', { n: riskyFileMsgs.size });
        }
      }
    }
    if (riskWarning) step.riskWarning = riskWarning;

    if (autonomy === 'confirm' || riskWarning) {
      step.status = 'pending';
      rerenderCurrentRun(run);
      const ok = await waitForConfirmationBar(step);
      if (!ok) return { rejected: true, message: t('agent.err.rejectedByUser') };
    }
    const BATCH_ITEM_KEY = { write_files: 'agent.sim.write', delete_files: 'agent.sim.deleteFile', create_directories: 'agent.sim.createDir', delete_directories: 'agent.sim.deleteDir' };
    if (autonomy === 'simulate') {
      if (name === 'create_file' || name === 'write_file') return { simulated: true, message: tf('agent.sim.write', { path: args.path, len: (args.content || '').length }) };
      if (name === 'delete_file') return { simulated: true, message: tf('agent.sim.deleteFile', { path: args.path }) };
      if (name === 'create_directory') return { simulated: true, message: tf('agent.sim.createDir', { path: args.path }) };
      if (name === 'delete_directory') return { simulated: true, message: tf('agent.sim.deleteDir', { path: args.path }) };
      if (name === 'edit_file') {
        const n = Array.isArray(args.edits) && args.edits.length ? args.edits.length : 1;
        return { simulated: true, message: tf('agent.sim.edit', { path: args.path, n }) };
      }
      if (name === 'move_file') return { simulated: true, message: tf('agent.sim.move', { from: args.from, to: args.to }) };
      if (name === 'copy_file') return { simulated: true, message: tf('agent.sim.copy', { from: args.from, to: args.to }) };
      if (name === 'copy_files') {
        const items = Array.isArray(args.items) ? args.items : [];
        return { files: items.map(it => ({ path: it && it.to, simulated: true, message: tf('agent.sim.copy', { from: it && it.from, to: it && it.to }) })) };
      }
      if (name === 'replace_in_files') return { simulated: true, message: tf('agent.sim.replace', { find: args.find, n: Array.isArray(args.paths) ? args.paths.length : 0 }) };
      if (name === 'run_command') return { simulated: true, message: tf('agent.sim.run', { command: args.command }) };
      if (BATCH_ITEM_KEY[name]) {
        const list = Array.isArray(args.paths) ? args.paths : Array.isArray(args.files) ? args.files.map(f => f && f.path) : [];
        return { files: list.map(p => ({ path: p, simulated: true, message: tf(BATCH_ITEM_KEY[name], { path: p, len: 0 }) })) };
      }
    }

    // Real mutation about to happen — take a git checkpoint first if
    // enabled, so the change stays recoverable via git log/revert. A
    // failed/unavailable git never blocks the tool call; it's surfaced once
    // per project per session instead of silently doing nothing forever.
    if (MUTATING_TOOL_NAMES.has(name) && project && projectCheckpointsEnabled(project)) {
      try {
        const cp = await apiCheckpoint(project, checkpointMessage(name, args));
        if (cp && cp.error === undefined && cp.ok === false && cp.reason === 'git-not-installed' && !_checkpointWarned.has(project)) {
          _checkpointWarned.add(project);
          showToast(t('agent.checkpointNoGit'));
        }
      } catch (e) { /* best-effort only, never blocks the actual tool call */ }
    }
    // Any mutation invalidates the whole read cache above — coarser than
    // per-path, but guarantees the next read never serves stale content.
    if (MUTATING_TOOL_NAMES.has(name)) _readFileCache.clear();

    if (name === 'create_file') return withNestWarning(args.path, await apiWriteFile(project, args.path, args.content ?? '', true));
    if (name === 'write_file') return mergeWarnings(withNestWarning(args.path, await apiWriteFile(project, args.path, args.content ?? '', false)), riskWarning);
    if (name === 'delete_file') return apiDeleteFile(project, args.path);
    if (name === 'create_directory') return withNestWarning(args.path, await apiMkdir(project, args.path));
    if (name === 'delete_directory') return apiRmdir(project, args.path);
    if (name === 'edit_file') return applyEditFile(project, args);
    if (name === 'move_file') {
      if (!args.from || !args.to) return { error: t('agent.err.missingPath') };
      return withNestWarning(args.to, await apiMove(project, args.from, args.to, args.overwrite));
    }
    if (name === 'copy_file') {
      if (!args.from || !args.to) return { error: t('agent.err.missingPath') };
      return withNestWarning(args.to, await apiCopy(project, args.from, args.to, args.overwrite));
    }
    if (name === 'copy_files') {
      const items = Array.isArray(args.items) ? args.items : [];
      if (!items.length) return { error: t('agent.err.missingFiles') };
      const results = [];
      for (const it of items) {
        if (!it || !it.from || !it.to) { results.push({ path: it && it.to, error: t('agent.err.missingPath') }); continue; }
        results.push({ path: it.to, ...withNestWarning(it.to, await apiCopy(project, it.from, it.to, it.overwrite)) });
      }
      return { files: results };
    }
    if (name === 'replace_in_files') return applyReplaceInFiles(project, args);
    if (name === 'run_command') {
      if (!args.command) return { error: t('agent.err.missingCommand') };
      return apiExec(project, args.command, args.cwd);
    }
    if (name === 'write_files') {
      const files = Array.isArray(args.files) ? args.files : [];
      if (!files.length) return { error: t('agent.err.missingFiles') };
      const results = [];
      for (const f of files) {
        const r = withNestWarning(f && f.path, await apiWriteFile(project, f && f.path, (f && f.content) ?? '', !!(f && f.createOnly)));
        results.push({ path: f && f.path, ...mergeWarnings(r, riskyFileMsgs && riskyFileMsgs.get(f && f.path)) });
      }
      return { files: results };
    }
    if (name === 'delete_files') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths') };
      const results = [];
      for (const p of paths) results.push({ path: p, ...(await apiDeleteFile(project, p)) });
      return { files: results };
    }
    if (name === 'create_directories') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths') };
      const results = [];
      for (const p of paths) results.push({ path: p, ...withNestWarning(p, await apiMkdir(project, p)) });
      return { files: results };
    }
    if (name === 'delete_directories') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths') };
      const results = [];
      for (const p of paths) results.push({ path: p, ...(await apiRmdir(project, p)) });
      return { files: results };
    }
    return { error: tf('agent.err.unknownTool', { name }) };
  }

  function waitForConfirmationBar(step) {
    return new Promise(resolve => {
      const bar = document.getElementById('agentConfirmBar');
      const desc = document.getElementById('agentConfirmDesc');
      const acceptBtn = document.getElementById('agentConfirmAccept');
      const rejectBtn = document.getElementById('agentConfirmReject');
      if (!bar) { resolve(true); return; }
      desc.textContent = `${TOOL_ICONS[step.name] || '🔧'} ${toolLabel(step.name)}${stepSubjectText(step) ? ': ' + stepSubjectText(step) : ''}` + (step.riskWarning ? `  ⚠️ ${step.riskWarning}` : '');
      bar.style.display = 'flex';
      pendingConfirm = { resolve };
      const cleanup = () => { acceptBtn.onclick = null; rejectBtn.onclick = null; bar.style.display = 'none'; pendingConfirm = null; };
      acceptBtn.onclick = () => { cleanup(); resolve(true); };
      rejectBtn.onclick = () => { cleanup(); resolve(false); };
    });
  }
  function hideConfirmBar() {
    const bar = document.getElementById('agentConfirmBar');
    if (bar) bar.style.display = 'none';
    if (pendingConfirm) { pendingConfirm.resolve(false); pendingConfirm = null; }
  }
  // Stops the agent run for one chat (default: chat on screen) — mirrors
  // kiconnect.js's stopStreaming(chatId), reusing the same activeRuns
  // registry, plus closes the confirm bar if it belonged to this run.
  function stopAgent(chatId) {
    chatId = chatId || currentChatId;
    stopStreaming(chatId);
    hideConfirmBar();
  }

  // Chat-completion call. `history` is a provider-neutral turn list (see
  // runAgentChatTurn): system/user/assistant(+toolCalls)/tool_results
  // entries. callModel() translates it to whichever wire format `provider`
  // needs and normalizes the reply back to {text, toolCalls}. Also applies
  // the header's thinking/reasoning-effort setting via the same helpers the
  // normal chat path uses, so it's the same model with the same settings.
  //
  // Turns a tool result into the JSON string sent back as a tool_result.
  // This used to just do JSON.stringify(result).slice(0, 8000), which slices
  // mid-string (often invalid JSON) with no signal that anything was cut —
  // the model could then write_file "to save its edit" and silently
  // overwrite the real file with the truncated content it saw (this
  // happened with a large i18n file in testing; see shrinkRisk() above for
  // the write-side guard). Fix: truncate long STRING FIELDS individually
  // with an explicit "…N more characters not shown" marker, then
  // serialize — always valid JSON, and the model knows when it's partial.
  const TOOL_RESULT_FIELD_LIMIT = 20000; // per individual long string field (e.g. file content)
  const TOOL_RESULT_TOTAL_LIMIT = 24000; // hard ceiling on the final serialized result, just in case
  function truncateLongStrings(value) {
    if (typeof value === 'string') {
      if (value.length <= TOOL_RESULT_FIELD_LIMIT) return value;
      const cut = value.length - TOOL_RESULT_FIELD_LIMIT;
      return value.slice(0, TOOL_RESULT_FIELD_LIMIT) + `\n…[${t('agent.truncated')}: ${cut} ${t('agent.moreCharsNotShown')}]`;
    }
    if (Array.isArray(value)) return value.map(truncateLongStrings);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) out[k] = truncateLongStrings(value[k]);
      return out;
    }
    return value;
  }
  function serializeToolResult(result) {
    let json;
    try { json = JSON.stringify(truncateLongStrings(result ?? {})); }
    catch (e) { json = JSON.stringify({ error: 'Could not serialize tool result.' }); }
    // Last-resort safety net for pathological cases (e.g. thousands of
    // small fields); per-field truncation above means this rarely triggers.
    return json.length > TOOL_RESULT_TOTAL_LIMIT ? json.slice(0, TOOL_RESULT_TOTAL_LIMIT) : json;
  }

  function toAnthropicHistory(history) {
    const out = []; let system = '';
    history.forEach(h => {
      if (h.role === 'system') system = h.text || '';
      else if (h.role === 'user') out.push({ role: 'user', content: h.content ? _toAnthropicContent(h.content) : (h.text || '') });
      else if (h.role === 'assistant') {
        const content = [];
        if (h.text) content.push({ type: 'text', text: h.text });
        (h.toolCalls || []).forEach(c => content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments || {} }));
        out.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
      } else if (h.role === 'tool_results') {
        out.push({ role: 'user', content: h.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: serializeToolResult(r.result) })) });
      }
    });
    return { system, messages: out };
  }
  function toOpenAIHistory(history) {
    const out = [];
    history.forEach(h => {
      if (h.role === 'system') out.push({ role: 'system', content: h.text || '' });
      else if (h.role === 'user') out.push({ role: 'user', content: h.content ? _toOpenAIContent(h.content) : (h.text || '') });
      else if (h.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: h.text || '',
          tool_calls: (h.toolCalls && h.toolCalls.length) ? h.toolCalls.map(c => ({
            id: c.id, type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) },
            // Gemini 2.5+/3.x require each function call to echo back its
            // exact thought_signature, or the next turn gets a 400 (happens
            // even with "thinking" off — recent Gemini models always reason
            // internally). Stashed on the tool-call object as soon as seen
            // (see callModel below) and echoed here. Calls we invented
            // ourselves (the JSON-in-text fallback) were never signed, so we
            // send Google's documented bypass sentinel instead.
            ...(c._thoughtSig ? { extra_content: { google: { thought_signature: c._thoughtSig } } } : {}),
          })) : undefined,
        });
      } else if (h.role === 'tool_results') {
        h.results.forEach(r => out.push({ role: 'tool', tool_call_id: r.id, content: serializeToolResult(r.result) }));
      }
    });
    return out;
  }
  // `signal` is passed in explicitly by the caller (the run's own
  // AbortController, see runAgentCompletion), not a shared module-level one
  // — needed since several agent runs can be in flight, one per chat.
  async function callModel(history, provider, folder, sessionId, signal) {
    if (!provider) throw new Error(t('agent.noModelHdr'));
    if (!provider.apiKey) throw new Error(t('agent.err.noApiKey'));
    if (provider.enabled === false) throw new Error(t('agent.err.providerDisabled'));
    const modelId = splitModelId(config.model).modelId;

    if (provider.type === 'anthropic') {
      const { system, messages } = toAnthropicHistory(history);
      // Cache breakpoints on tool schema and system prompt: byte-identical
      // on every tool-loop iteration, so marking them `ephemeral` lets
      // Anthropic serve them from cache instead of billing them as fresh
      // input — real savings across several tool round-trips.
      const toolsForModel = toolSchemaAnthropic(folder);
      if (toolsForModel.length) toolsForModel[toolsForModel.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
      // Second cache breakpoint on the message history itself. Without it,
      // only tool schema/system prompt were cached — every follow-up call
      // re-billed the ENTIRE growing history as fresh input, including large
      // tool_result content (e.g. a 600KB file). Placing a breakpoint on the
      // last content block of the last message lets everything before it be
      // served from cache; only the newest tool_result(s) are billed fresh.
      // Without this, a simple "read this file, split it up" task cost
      // ~1.4M tokens by reprocessing the whole file on every follow-up.
      if (messages.length) {
        const lastMsg = messages[messages.length - 1];
        if (Array.isArray(lastMsg.content) && lastMsg.content.length) {
          lastMsg.content[lastMsg.content.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
        } else if (typeof lastMsg.content === 'string' && lastMsg.content) {
          // Anthropic requires content as an array of blocks for
          // cache_control to attach — wrap a bare string into one text block.
          lastMsg.content = [{ type: 'text', text: lastMsg.content, cache_control: { type: 'ephemeral', ttl: '1h' } }];
        }
      }
      const body = { model: modelId, max_tokens: effectiveMaxTokens(), messages, tools: toolsForModel };
      if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }];
      // Native server-side context management (beta) — complements, doesn't
      // replace, compactOldToolResults() (skipped for Anthropic; see there).
      // Clears old tool RESULTS server-side, AFTER the cache-prefix lookup,
      // so it doesn't bust the prompt cache. Only kicks in past the token
      // trigger below. Beta API; worst case if it changes is a surfaced 400,
      // not silent data loss (nothing local is changed, only what's sent).
      if (config.anthropicContextEditing !== false) {
        body.context_management = {
          edits: [{
            type: 'clear_tool_uses_20250919',
            trigger: { type: 'input_tokens', value: 30000 },
            keep: { type: 'tool_uses', value: 3 },
          }],
        };
      }
      if (isTemperatureSupported(modelId)) body.temperature = config.temperature;
      if (config.thinkingEnabled && isThinkingCapable(modelId)) {
        if (isAdaptiveThinkingModel(modelId)) {
          body.thinking = { type: 'adaptive' };
          body.output_config = { effort: OAI_EFFORT[config.thinkingIntensity || 2] };
          delete body.temperature;
        } else {
          const budget = usesTokenBudget(modelId) ? (config.thinkingBudget || 8000) : CLAUDE_BUDGET[config.thinkingIntensity || 2];
          body.thinking = { type: 'enabled', budget_tokens: budget };
          body.temperature = 1;
          body.max_tokens = Math.max(body.max_tokens, budget + 2000);
        }
      }
      const res = await fetch(proxyUrl('https://api.anthropic.com/v1/messages'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': provider.apiKey,
          'anthropic-version': '2023-06-01',
          // prompt-caching-2024-07-31 no longer needed — caching (incl. ttl:'1h')
          // is GA. context-management-2025-06-27 opts into context_management above.
          ...(config.anthropicContextEditing !== false ? { 'anthropic-beta': 'context-management-2025-06-27' } : {}),
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body), signal,
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
      const data = await res.json();
      const content = data.content || [];
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const toolCalls = content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input || {} }));
      return { text, toolCalls, usage: data.usage || null };
    }

    // Every other provider speaks the OpenAI-compatible /chat/completions shape.
    const endpoint = getProviderEndpoint(provider);
    const reqBody = { model: modelId, messages: toOpenAIHistory(history), tools: toolSchema(folder), tool_choice: 'auto', stream: false };
    // Same reasoning-model shape fix as the main chat path: GPT-5 behaves
    // like the o-series here (no temperature, max_completion_tokens).
    const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
    if (!isOSeries) reqBody.temperature = config.temperature;
    if (config.thinkingEnabled && isThinkingCapable(modelId)) {
      if (provider.type === 'zhipu') reqBody.thinking = { type: 'enabled' };
      // MiniMax has no reasoning_effort levels (on/off only, on by default,
      // M2.x can't disable). Agent UI doesn't surface reasoning trace, so no
      // reasoning_split needed here (unlike the streaming chat path).
      else if (provider.type === 'minimax') reqBody.thinking = { type: 'adaptive' };
      // Mistral only documents 'none'/'high' (root-level field), so the
      // low/medium/high OAI_EFFORT mapping doesn't apply. Native Magistral
      // always reasons and takes no parameter (see the check below).
      else if (provider.type === 'mistral') {
        if (isMistralAdjustableThinkingModel(modelId)) reqBody.reasoning_effort = 'high';
        else delete reqBody.reasoning_effort;
      }
      else reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    } else if (provider.type === 'mistral' && isMistralNativeThinkingModel(modelId)) {
      // Native Magistral always reasons regardless of thinkingEnabled —
      // nothing to send; just avoid a stray reasoning_effort field.
      delete reqBody.reasoning_effort;
    }
    // Mistral's prompt caching is automatic but more reliable with a reused
    // prompt_cache_key across requests sharing a prefix (docs.mistral.ai).
    // Set whenever talking to Mistral with a stable id to key on.
    if (provider.type === 'mistral' && sessionId) reqBody.prompt_cache_key = String(sessionId);
    const extraHeaders = {};
    if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (provider.type === 'zhipu') extraHeaders['Accept-Language'] = 'en-US,en';
    // Session/conversation hints that improve cache-hit rate on providers
    // whose caching benefits from a stable routing key.
    if (provider.type === 'xai' && sessionId) extraHeaders['x-grok-conv-id'] = String(sessionId);
    if (provider.type === 'zhipu' && sessionId) extraHeaders['X-Conversation-Id'] = String(sessionId);
    const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody), signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error(t('agent.err.invalidModelResponse'));
    let toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map(tc => ({
          id: tc.id, name: tc.function?.name, arguments: safeParseJson(tc.function?.arguments),
          // See toOpenAIHistory() above for why this is captured/echoed.
          _thoughtSig: tc.extra_content?.google?.thought_signature,
        }))
      : [];
    // Mistral reasoning models return `content` as {type:'thinking'|'text'}
    // chunks instead of a plain string — extract just the answer text (the
    // agent trace view doesn't surface reasoning separately here).
    let text = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content)
      ? msg.content.filter(c => c && c.type === 'text').map(c => c.text || '').join('')
      : '');
    if (!toolCalls.length) {
      // Fallback for gateways/models without native function calling: if the
      // reply is a bare JSON object shaped like a tool call, treat it as one.
      const fb = extractFallbackToolCall(text);
      if (fb) {
        toolCalls = [{
          id: 'fb_' + Date.now(), name: fb.name, arguments: fb.arguments, _fallback: true,
          // Never signed by Gemini (we built this call ourselves from raw
          // text) — use Google's documented bypass value instead.
          _thoughtSig: provider.type === 'google' ? 'skip_thought_signature_validator' : undefined,
        }];
        text = '';
      }
    }
    // Normalize OpenAI's field names to the shape buildTokenBadge()/the
    // Anthropic path use, same as the normal streaming chat path.
    // DeepSeek reports cache hits under prompt_cache_hit_tokens instead of
    // the OpenAI-standard field — without this fallback its cache savings
    // never show up in the token badge.
    const usage = data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
      cache_read_input_tokens: data.usage.prompt_tokens_details?.cached_tokens
        ?? data.usage.prompt_cache_hit_tokens ?? 0,
    } : null;
    return { text, toolCalls, usage };
  }
  function extractFallbackToolCall(content) {
    if (!content) return null;
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const obj = JSON.parse(m[0]);
      if (obj && obj.tool && typeof obj.tool === 'string') return { name: obj.tool, arguments: obj.arguments || obj.args || {} };
    } catch (e) {}
    return null;
  }
  function safeParseJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
  // Shared status-line helper for a tool result, used by several
  // buildToolBody() branches. Returns null on plain success so callers can
  // append their own success line instead.
  function resultStatusLine(result) {
    if (!result) return null;
    if (result.error) return `❌ ${result.error}`;
    if (result.simulated) return `🧪 ${result.message}`;
    if (result.rejected) return `🚫 ${result.message}`;
    return null;
  }

  // Rendering a run as collapsed <details> cards inside a chat bubble.
  // Reuses formatText() (markdown/code/DOMPurify pipeline) so it renders
  // identically live and after reload.
  //
  // A single singleton `_currentRunId` would break with several project
  // chats running an agent turn at once — the last-started run would steal
  // subsequent rerenderCurrentRun()/updateTokenCounterUI() calls from other
  // chats. Fixed by threading the specific `run` object explicitly through
  // runAgentCompletion's loop and executeTool() instead of a shared pointer.
  // `_agentRun(chatId)` is a convenience default for callers that just mean
  // "whichever run belongs to the chat on screen right now".
  function _agentRun(chatId) {
    chatId = chatId || currentChatId;
    for (const run of activeRuns.values()) {
      if (run.chatId === chatId && run.kind === 'agent' && run.status === 'running') return run;
    }
    return null;
  }
  // Inline "⏹ Stop" button under a still-running run's bubble, next to the
  // token counter — the only way to stop a run, kept next to the content.
  function _buildInlineStopBtn(chatId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agent-inline-stop-btn';
    btn.textContent = '⏹ ' + t('agent.stop');
    btn.addEventListener('click', () => stopAgent(chatId));
    return btn;
  }
  // Builds a full message row for a still-running run reattached after a
  // chat switch — same shape as appendEmptyAI(), but pre-filled from
  // run.steps/run.usage instead of starting empty.
  function _buildAgentRowSkeleton(run) {
    const row = appendEmptyAI(run.model, run.runId);
    const bubble = row.querySelector('.bubble');
    bubble.innerHTML = formatText(renderRunMarkdown(run.steps || [])) || '<p>…</p>';
    typesetMath(bubble);
    const bubbleWrap = bubble.parentNode;
    const footer = document.createElement('div');
    footer.className = 'agent-run-footer';
    const tokenEl = document.createElement('div');
    tokenEl.className = 'agent-token-counter';
    if (run.usage) {
      const cached = run.usage.cache_read_input_tokens || 0;
      let text = `🔢 ${formatTokenCount(run.usage.input_tokens)} in / ${formatTokenCount(run.usage.output_tokens)} out`;
      if (cached) text += ` (${formatTokenCount(cached)} cached)`;
      tokenEl.textContent = text;
    }
    footer.appendChild(tokenEl);
    footer.appendChild(_buildInlineStopBtn(run.chatId));
    if (bubbleWrap) bubbleWrap.insertBefore(footer, bubble.nextSibling);
    return row;
  }
  // `run` should be passed explicitly by callers acting on a specific run
  // (tool loop, executeTool) — falls back to _agentRun() only for callers
  // that mean "whatever's on screen".
  function rerenderCurrentRun(run) {
    run = run || _agentRun();
    if (!run || !run.steps) return;
    // _runBubbleEl() returns null when this run's chat isn't on screen —
    // nothing to update; run.steps already has the latest state, and
    // renderMessages()'s reattach paints it once the user switches back.
    const liveRow = _runBubbleEl(run);
    if (!liveRow) return;
    const liveBubble = liveRow.querySelector('.bubble');
    if (!liveBubble) return;
    // formatText() rebuilds the whole trace on every call, which would wipe
    // out any <details> the user manually expanded. Steps only ever get
    // appended, so the Nth <details.agent-trace> stays the Nth one after a
    // rebuild — capture open states by position and reapply them.
    const openStates = Array.from(liveBubble.querySelectorAll('details.agent-trace')).map(d => d.open);
    liveBubble.innerHTML = formatText(renderRunMarkdown(run.steps)) || '<p>…</p>';
    liveBubble.querySelectorAll('details.agent-trace').forEach((d, i) => { if (openStates[i]) d.open = true; });
    typesetMath(liveBubble);
    // Only auto-scroll to the bottom if the user hasn't scrolled away
    // (pinnedToBottom, tracked in kiconnect.js).
    if (pinnedToBottom) scrollToBottom();
  }
  function renderRunMarkdown(steps) {
    return steps.map(step => {
      if (step.kind === 'text') return step.text;
      const summary = `${TOOL_ICONS[step.name] || '🔧'} <b>${esc(toolLabel(step.name))}</b>` +
        (stepSubjectText(step) ? ` <code>${esc(stepSubjectText(step))}</code>` : '') +
        ` — <em>${statusText(step.status)}</em>`;
      const body = buildToolBody(step);
      return `<details class="agent-trace" data-status="${esc(step.status)}"><summary>${summary}</summary>\n\n${body}\n\n</details>`;
    }).join('\n\n');
  }
  // Line-level diff via classic LCS backtracking, instead of naively
  // prefixing every old_str line with '-' and every new_str line with '+'
  // (which makes every line look changed for a small edit in a large
  // block, defeating the confirm-mode diff preview). edit_file snippets
  // are small enough that the O(n·m) DP table is cheap.
  function _lcsLineDiff(oldLines, newLines) {
    const n = oldLines.length, m = newLines.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (oldLines[i] === newLines[j]) { ops.push({ type: 'eq', text: oldLines[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', text: oldLines[i] }); i++; }
      else { ops.push({ type: 'add', text: newLines[j] }); j++; }
    }
    while (i < n) { ops.push({ type: 'del', text: oldLines[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', text: newLines[j] }); j++; }
    return ops;
  }
  // Renders _lcsLineDiff()'s ops as a compact unified diff: keeps up to
  // CONTEXT lines around an actual change, collapses the rest into an
  // "N unchanged lines" marker — a one-line change in a 200-line snippet
  // shows as a handful of lines, not the whole thing twice.
  function renderUnifiedDiff(oldStr, newStr) {
    const CONTEXT = 2;
    const ops = _lcsLineDiff(String(oldStr).split('\n'), String(newStr).split('\n'));
    const out = [];
    let i = 0;
    while (i < ops.length) {
      if (ops[i].type !== 'eq') {
        out.push((ops[i].type === 'del' ? '-' : '+') + ops[i].text);
        i++;
        continue;
      }
      let j = i;
      while (j < ops.length && ops[j].type === 'eq') j++;
      const run = ops.slice(i, j);
      const isStart = i === 0, isEnd = j === ops.length;
      if (isStart && isEnd) {
        // old_str === new_str line-for-line — no actual change; show as-is.
        run.forEach(o => out.push(' ' + o.text));
      } else {
        const headKeep = isStart ? 0 : Math.min(CONTEXT, run.length);
        const tailKeep = isEnd ? 0 : Math.min(CONTEXT, run.length);
        if (headKeep + tailKeep >= run.length) {
          run.forEach(o => out.push(' ' + o.text));
        } else {
          for (let k = 0; k < headKeep; k++) out.push(' ' + run[k].text);
          out.push(`@@ ${tf('agent.unchangedLines', { n: run.length - headKeep - tailKeep })} @@`);
          for (let k = run.length - tailKeep; k < run.length; k++) out.push(' ' + run[k].text);
        }
      }
      i = j;
    }
    return out.join('\n');
  }

  function buildToolBody(step) {
    const { name, args, result } = step;
    const lines = [];
    const truncNote = () => '\n… ' + t('agent.truncated');
    if (name === 'list_files') {
      if (result && Array.isArray(result.files)) {
        lines.push('```text');
        lines.push(result.files.length ? result.files.map(f => `${f.path}  (${f.size} B)`).join('\n') : `(${t('agent.empty')})`);
        lines.push('```');
      }
    } else if (name === 'search_in_files') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.matches)) {
          lines.push('```text');
          lines.push(result.matches.length
            ? result.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (result.truncated ? truncNote() : '')
            : `(${t('agent.noMatches')})`);
          lines.push('```');
        }
      }
    } else if (name === 'web_search') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.results)) {
          lines.push(result.results.length
            ? result.results.map(r => `- [${r.title}](${r.url})  \n  ${r.snippet || ''}`).join('\n')
            : `_(${t('agent.noMatches')})_`);
        }
      }
    } else if (name === 'fetch_url') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (typeof result.text === 'string') {
          const preview = result.text.length > 3000 ? result.text.slice(0, 3000) + truncNote() : result.text;
          lines.push(`**${result.title || result.url}**`);
          lines.push('```text'); lines.push(preview); lines.push('```');
        }
      }
    } else if (name === 'read_file') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.binary) lines.push(`_(${t('agent.binaryFile')})_`);
        else if (typeof result.content === 'string') {
          const lang = langFromPath(args.path);
          const preview = result.content.length > 3000 ? result.content.slice(0, 3000) + truncNote() : result.content;
          if (result.lineRange) lines.push(`_${tf('agent.lineRange', { start: result.lineRange.start, end: result.lineRange.end, total: result.lineRange.totalLines })}_`);
          lines.push('```' + lang); lines.push(preview); lines.push('```');
        }
      }
    } else if (name === 'read_files') {
      if (result && Array.isArray(result.files)) {
        result.files.forEach(f => {
          lines.push(`**${esc(f.path)}**`);
          if (f.error) lines.push(`❌ ${f.error}`);
          else if (f.binary) lines.push(`_(${t('agent.binaryFile')})_`);
          else if (typeof f.content === 'string') {
            const lang = langFromPath(f.path);
            const preview = f.content.length > 1500 ? f.content.slice(0, 1500) + truncNote() : f.content;
            lines.push('```' + lang); lines.push(preview); lines.push('```');
          }
        });
      }
    } else if (name === 'create_file' || name === 'write_file') {
      const lang = langFromPath(args.path);
      const content = args.content || '';
      const preview = content.length > 3000 ? content.slice(0, 3000) + truncNote() : content;
      lines.push('```' + lang); lines.push(preview); lines.push('```');
      if (result) {
        const status = resultStatusLine(result);
        if (status) lines.push(status);
        else if (typeof result.bytes === 'number') lines.push(`✅ ${tf('agent.bytesSaved', { bytes: result.bytes })}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    } else if (name === 'edit_file') {
      const edits = Array.isArray(args.edits) && args.edits.length ? args.edits : [{ old_str: args.old_str, new_str: args.new_str }];
      edits.forEach((e, idx) => {
        if (edits.length > 1) lines.push(`_${tf('agent.editNofM', { n: idx + 1, total: edits.length })}_`);
        lines.push('```diff');
        lines.push(renderUnifiedDiff(e.old_str || '', e.new_str || ''));
        lines.push('```');
      });
      if (result) {
        const status = resultStatusLine(result);
        if (status) lines.push(status);
        else if (typeof result.bytes === 'number') lines.push(`✅ ${tf('agent.bytesSaved', { bytes: result.bytes })}`);
      }
    } else if (name === 'replace_in_files') {
      lines.push(`\`${esc(args.find || '')}\` → \`${esc(args.replace || '')}\``);
      const items = (result && Array.isArray(result.files)) ? result.files : [];
      if (!items.length && result && result.error) lines.push(`❌ ${result.error}`);
      items.forEach(it => {
        let mark = it.changed === false ? `(${t('agent.noMatches')})` : '✅';
        if (it.error) mark = `❌ ${it.error}`;
        else if (it.simulated) mark = `🧪 ${it.message}`;
        else if (typeof it.occurrences === 'number' && it.occurrences) mark = `✅ ${tf('agent.nOccurrences', { n: it.occurrences })}`;
        lines.push(`- \`${esc(it.path)}\` ${mark}`);
      });
    } else if (name === 'move_file' || name === 'copy_file' || name === 'delete_file' || name === 'delete_directory' || name === 'create_directory') {
      if (result) {
        lines.push(resultStatusLine(result) || `✅ ${t('agent.done')}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    } else if (name === 'copy_files' || name === 'write_files' || name === 'delete_files' || name === 'create_directories' || name === 'delete_directories') {
      const items = (result && Array.isArray(result.files)) ? result.files : [];
      if (!items.length && result && result.error) lines.push(`❌ ${result.error}`);
      items.forEach(it => {
        const mark = resultStatusLine(it) || '✅';
        lines.push(`- \`${esc(it.path)}\`${it.warning ? ` ${mark} ⚠️ ${esc(it.warning)}` : ` ${mark}`}`);
      });
    } else if (name === 'run_command') {
      lines.push('```bash'); lines.push(args.command || ''); lines.push('```');
      if (result) {
        const status = resultStatusLine(result);
        if (status) lines.push(status);
        else {
          lines.push(`**${t('agent.exitCode')}:** ${result.exitCode ?? '—'}` + (result.timedOut ? ` ⏱ ${t('agent.timedOut')}` : ''));
          const sandboxLine = sandboxStatusLine(result);
          if (sandboxLine) lines.push(sandboxLine);
          if (result.stdout) { lines.push('```text'); lines.push(result.stdout.length > 3000 ? result.stdout.slice(0, 3000) + truncNote() : result.stdout); lines.push('```'); }
          if (result.stderr) { lines.push('```text'); lines.push(result.stderr.length > 2000 ? result.stderr.slice(0, 2000) + truncNote() : result.stderr); lines.push('```'); }
        }
      }
    }
    return lines.join('\n');
  }
  // Surfaces the proxy's actual sandboxing state for this run (see
  // 'sandboxed'/'networkIsolated' in agent_exec()'s response). Resource-limit
  // sandboxing is POSIX-only (absent on Windows); network isolation also
  // needs `unshare`, not always available on Linux either — this reports
  // what actually happened per command, since the OS can't be known ahead.
  function sandboxStatusLine(result) {
    if (typeof result.sandboxed !== 'boolean') return '';
    if (!result.sandboxed) {
      return `⚠️ ${t('agent.sandboxWeak')}`;
    }
    if (!result.networkIsolated) {
      return `ℹ️ ${t('agent.sandboxNoNet')}`;
    }
    return `✅ ${t('agent.sandboxFull')}`;
  }

  // Main agent turn, runs inside the normal chat flow. Turns a stored
  // message into plain context text for the next model call. Agent replies
  // store their spoken text separately in `_agentText` (see `finally`
  // below), so past tool-call traces never get replayed into context.
  function extractContextText(msg) {
    if (msg._agentText != null) return msg._agentText;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(p => p.type === 'text' && !(p.text && p.text.startsWith('--- ')))
        .map(p => p.text).join('\n');
    }
    return '';
  }

  async function runAgentChatTurn(task, folder, att) {
    let chat = currentChat();
    if (!chat) { newChat(folder.id); chat = currentChat(); }
    // Per-chat guard: a different project chat already running its own
    // turn no longer blocks sending in THIS one.
    if (isChatStreaming(chat.id)) { showToast(t('agent.stillRunning')); return; }

    // Snapshot the conversation so far, BEFORE adding the new user message,
    // as context for the model — previously every message started a
    // memory-less run.
    const priorHistory = buildPriorHistory(chat);

    // Same attachment → content-block conversion normal chat uses (see
    // buildAttachmentContent() in kiconnect.js) — previously this module
    // only read the typed text and silently dropped attached files.
    const { userContent, fileNames } = buildAttachmentContent(task, att || []);

    const container = getActiveContainer(chat);
    const userMsg = { role: 'user', content: userContent, _files: fileNames.length ? fileNames : undefined };
    container.push(userMsg);
    // Same auto-title flow as normal chat (autoGenerateChatTitle):
    // placeholder immediately, replaced by an AI-generated title later.
    // Previously this hard-truncated the raw task text instead.
    if (chat.messages.length === 1) { chat.title = '…'; renderSidebar(); autoGenerateChatTitle(chat, task); }
    const idxUser = getActivePath(chat).length - 1;
    const emptyStateEl = document.getElementById('emptyState');
    if (emptyStateEl) emptyStateEl.style.display = 'none';
    const userMsgEl = buildMsgEl(userMsg, idxUser);
    appendToMessages(userMsgEl);
    typesetMath(userMsgEl);
    scrollToBottom();
    renderSidebar();

    await runAgentCompletion(chat, folder, container, priorHistory, task, userContent);
  }

  // Regenerating an assistant reply in a project chat: remove that reply
  // and re-run the SAME agent loop for the SAME preceding user message via
  // runAgentCompletion(), so "Regenerieren" behaves like normal chat instead
  // of falling back to a plain, tool-less completion.
  async function agentRegenerate(idx) {
    const chat = currentChat(); if (!chat) return;
    const folder = folders.find(f => f.id === chat.folderId);
    if (!folder || !folder.agentProject) return false;
    if (isChatStreaming(chat.id)) { showToast(t('agent.stillRunning')); return true; }
    const path = getActivePath(chat);
    const msg = path[idx];
    if (!msg || msg.role !== 'assistant') return true;
    const userMsg = path[idx - 1];
    if (!userMsg || userMsg.role !== 'user') return true;
    const container = getActiveContainer(chat);
    const pos = container.indexOf(msg);
    if (pos === -1) return true;
    container.splice(pos); // drop the old reply and anything after it
    save();
    renderMessages(chat.messages, idx);
    const priorHistory = buildPriorHistory(chat);
    const task = extractContextText(userMsg) || (typeof userMsg.content === 'string' ? userMsg.content : '');
    const content = Array.isArray(userMsg.content) ? userMsg.content : undefined;
    await runAgentCompletion(chat, folder, container, priorHistory, task, content);
    return true;
  }
  function buildPriorHistory(chat) {
    const MAX_CONTEXT_TURNS = 30;
    return getActivePath(chat)
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_CONTEXT_TURNS)
      .map(m => {
        const h = { role: m.role, text: extractContextText(m) };
        // Past user turns with attachments store content as an array (see
        // runAgentChatTurn) — keep it so history conversion can resend the
        // actual file, not just its text parts.
        if (m.role === 'user' && Array.isArray(m.content)) h.content = m.content;
        return h;
      });
  }

  // The actual model/tool loop: appends the live AI bubble, drives
  // callModel()+executeTool() until a final text-only reply, then saves and
  // upgrades the bubble to its interactive form. Shared by send/regenerate.
  async function runAgentCompletion(chat, folder, container, priorHistory, task, content) {
    if (!folder.agentAutonomy) folder.agentAutonomy = 'confirm';
    const provider = providerForModel(config.model);
    if (!provider) {
      showToast(t('agent.noModelHdr'));
      return;
    }

    // Same model badge as any normal reply — it's literally the same
    // header selection, so this is never out of sync.
    const runId = _makeRunId(chat.id);
    const steps = [];
    // Own AbortController per run (not shared module-level) — lets
    // stopAgent(chatId) cancel one chat's turn without touching others.
    const run = {
      runId,
      chatId: chat.id,
      kind: 'agent',
      provider: provider.type,
      model: config.model,       // frozen now, same reasoning as the chat-stream side
      abortController: new AbortController(),
      steps,                     // authoritative state — rerenderCurrentRun() reads this,
                                  // not a separate run.text/thinkingText pair
      usage: null,
      status: 'running',
      bubbleEl: null,
      // Reattach hook for kiconnect.js's renderMessages(): builds a fresh
      // row from run.steps/run.usage on switching back mid-run, instead of
      // the generic chat-bubble builder (which knows nothing about traces).
      buildLiveEl: () => _buildAgentRowSkeleton(run),
    };
    activeRuns.set(runId, run);
    // Sidebar live-dot, same choke point kiconnect.js's _streamAIResponse
    // uses for chat streaming, so a background agent run shows the same way.
    renderSidebar();

    const aiRow = appendEmptyAI(config.model, runId);
    run.bubbleEl = aiRow;
    const bubble = aiRow.querySelector('.bubble');
    // Sibling of .bubble inside .bubble-wrap, not a child of bubble —
    // rerenderCurrentRun() replaces bubble.innerHTML wholesale on every
    // step, which would wipe this out if nested inside. Starts empty,
    // filled once usage figures arrive, removed in `finally` when run ends.
    const bubbleWrap = bubble.parentNode;
    const footer = document.createElement('div');
    footer.className = 'agent-run-footer';
    const liveTokenEl = document.createElement('div');
    liveTokenEl.className = 'agent-token-counter';
    footer.appendChild(liveTokenEl);
    footer.appendChild(_buildInlineStopBtn(run.chatId));
    if (bubbleWrap) bubbleWrap.insertBefore(footer, bubble.nextSibling);
    rerenderCurrentRun(run);

    let history = [
      { role: 'system', text: systemPrompt(folder.name) },
      ...priorHistory,
      Array.isArray(content) ? { role: 'user', text: task, content } : { role: 'user', text: task },
    ];
    // Fresh per turn — a new user message shouldn't be served stale reads
    // from several turns ago; only duplicate reads within this turn cache.
    _readFileCache.clear();

    let iterations = 0, aborted = false;
    // A single agent "turn" can involve several model calls (one per
    // tool round-trip) — sum them so the badge reflects the full cost.
    const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let sawUsage = false;
    try {
      while (iterations < MAX_ITERATIONS) {
        iterations++;
        // See KNOWN_CACHING_PROVIDERS above: only compact for providers
        // without confirmed prefix caching, so this never mutates a prefix
        // that caching (incl. Anthropic's explicit cache_control) needs stable.
        if (!KNOWN_CACHING_PROVIDERS.has(provider.type)) compactOldToolResults(history);
        let result;
        try { result = await callModel(history, provider, folder, chat.id, run.abortController.signal); }
        catch (err) {
          if (err.name === 'AbortError') { aborted = true; break; }
          steps.push({ kind: 'text', text: `❌ ${tf('agent.err.modelCallFailed', { error: esc(err.message) })}` });
          rerenderCurrentRun(run); break;
        }
        if (result.usage) {
          sawUsage = true;
          totalUsage.input_tokens += result.usage.input_tokens || 0;
          totalUsage.output_tokens += result.usage.output_tokens || 0;
          totalUsage.cache_read_input_tokens += result.usage.cache_read_input_tokens || 0;
          totalUsage.cache_creation_input_tokens += result.usage.cache_creation_input_tokens || 0;
          updateTokenCounterUI(totalUsage, run);
        }
        const toolCalls = result.toolCalls || [];
        if (result.text) {
          steps.push({ kind: 'text', text: result.text });
          rerenderCurrentRun(run);
        }
        history.push({ role: 'assistant', text: result.text || '', toolCalls });

        if (!toolCalls.length) break;

        const toolResults = [];
        for (const call of toolCalls) {
          if (run.abortController.signal.aborted) { aborted = true; break; }
          const step = { kind: 'tool', name: call.name, args: call.arguments || {}, status: 'running', result: null };
          steps.push(step); rerenderCurrentRun(run);
          let result2;
          try { result2 = await executeTool(call.name, call.arguments || {}, folder.agentProject, folder.agentAutonomy, step, run); }
          catch (err) { result2 = { error: err.message }; }
          step.result = result2 || {};
          if (step.result.error) step.status = 'error';
          else if (step.result.simulated) step.status = 'simulated';
          else if (step.result.rejected) step.status = 'rejected';
          else step.status = 'done';
          rerenderCurrentRun(run);
          toolResults.push({ id: call.id, name: call.name, args: call.arguments || {}, result: result2 });
        }
        history.push({ role: 'tool_results', results: toolResults });
        if (aborted) break;
      }
      if (iterations >= MAX_ITERATIONS) { steps.push({ kind: 'text', text: `⚠️ ${tf('agent.maxIterations', { n: MAX_ITERATIONS })}` }); rerenderCurrentRun(run); }
      if (aborted) { steps.push({ kind: 'text', text: `⏹ ${t('agent.aborted')}` }); rerenderCurrentRun(run); }
    } finally {
      // Use the run's CURRENT bubble (may be reattached, or null if the
      // chat isn't on screen) — never the originally-captured locals, which
      // may be long detached from the DOM.
      const finishBubbleRow = _runBubbleEl(run);
      const finishBubble = finishBubbleRow && finishBubbleRow.querySelector('.bubble');
      if (finishBubble) finishBubble.classList.remove('streaming');
      const finalMd = renderRunMarkdown(steps);
      // Plain-text version (no tool-call HTML cards) fed back as context on
      // the next message (see extractContextText()) and "remembered" by
      // future agent runs in this chat.
      const contextText = steps.filter(s => s.kind === 'text').map(s => s.text).join('\n\n');
      // _model uses run.model (frozen at run start), not live config.model
      // — same "header changed mid-run" fix as the chat-stream path.
      const msgObj = { role: 'assistant', content: finalMd, _model: run.model, _agentText: contextText, _agentSteps: steps, _usage: sawUsage ? totalUsage : undefined };
      container.push(msgObj);
      save();
      run.status = 'done';

      // Only touch #messages if this chat is still on screen — if the run
      // finished on a different chat, the reply is already saved and renders
      // normally next time this chat opens (matching guard in kiconnect.js's
      // _attachAIActions()).
      if (chat === currentChat()) {
        // Upgrade the just-finished live bubble into its final interactive
        // form — same helper the normal streaming path uses, so agent
        // replies get the same action bar instead of staying a placeholder.
        // Drop the live run footer (token counter + stop button) before
        // finalizing — it's a this-run-only indicator, not part of the saved
        // message.
        const finishFooterEl = finishBubbleRow && finishBubbleRow.querySelector('.agent-run-footer');
        if (finishFooterEl && finishFooterEl.parentNode) finishFooterEl.parentNode.removeChild(finishFooterEl);

        const path = getActivePath(chat);
        const idx = path.length - 1;
        if (!_finalizeAIRowInPlace(finishBubbleRow, path[idx], idx)) {
          const newRow = buildMsgEl(path[idx], idx);
          const messagesEl = document.getElementById('messages');
          if (finishBubbleRow && finishBubbleRow.parentNode) finishBubbleRow.parentNode.replaceChild(newRow, finishBubbleRow);
          else if (messagesEl) appendToMessages(newRow);
        }
        updateChatTokenTotal();
      }

      activeRuns.delete(runId);
      // Sidebar dot for `chat` disappears now that its run is gone.
      renderSidebar();
      // hideConfirmBar() only matters if THIS run's confirm prompt was
      // showing — see the `pendingConfirm` limitation noted above.
      hideConfirmBar();
    }
  }

  //  Project management (create / delete backend projects + folders)
  async function createProject(name, path, create) {
    name = (name || '').trim();
    if (!name || !path) return null;
    // A previous UI version could remove a project locally even when proxy
    // deletion failed, leaving an invisible registration — reuse that
    // matching server-side project instead of rejecting its folder.
    const normalizedPath = String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const localMatch = folders.find(f => f.agentProject && String(f.agentProjectPath || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === normalizedPath);
    if (localMatch) throw new Error(t('agent.projectAlreadyAdded'));
    const remoteMatch = (await apiListProjects()).find(p => String(p.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === normalizedPath);
    const reg = remoteMatch || await apiCreateProject(name, path, create);
    const folder = {
      id: 'proj_' + Date.now(), name, collapsed: false, agentProject: reg.id, agentProjectPath: reg.path,
      agentAutonomy: settings.autonomy || 'confirm',
    };
    folders.push(folder);
    save(); renderSidebar();
    return folder;
  }
  function currentProjectFolder() {
    const chat = currentChat();
    if (!chat || !chat.folderId) return null;
    const folder = folders.find(f => f.id === chat.folderId);
    return (folder && folder.agentProject) ? folder : null;
  }
  async function deleteProjectFolder(folder) {
    if (!folder || !folder.agentProject) return;
    const inside = chats.filter(c => c.folderId === folder.id);
    if (!confirm(tf('agent.confirmDeleteProject', { name: folder.name, n: inside.length }))) return;
    try {
      await apiDeleteProject(folder.agentProject);
    } catch (e) {
      // Don't remove the local folder/chats if the proxy couldn't remove its
      // registry entry, or the UI would claim success while it's still
      // registered and unselectable.
      showToast(`❌ ${e.message}`);
      return;
    }
    // Deleting a project deletes its chats too (previously only unlinked
    // them, leaving them as regular chats despite the confirm dialog).
    chats = chats.filter(c => c.folderId !== folder.id);
    folders = folders.filter(f => f.id !== folder.id);
    if (typeof activeFolderId !== 'undefined' && activeFolderId === folder.id) activeFolderId = null;
    if (currentChatId && !chats.some(c => c.id === currentChatId)) {
      currentChatId = chats[0]?.id || null;
      if (currentChatId) renderMessages(currentChat().messages);
      else { const c = document.getElementById('messages'); c.innerHTML = ''; const e = document.getElementById('emptyState'); if (e) { c.appendChild(e); e.style.display = ''; } syncComposerStreamingUI(); }
    }
    save(); renderSidebar();
    showToast(t('agent.projectDeleted'));
  }

  // Focuses a project for the composer: reuses the current chat if empty,
  // else starts a fresh one filed into that project — like a workspace
  // picker in Codex-like tools.
  function focusProject(folder) {
    const chat = currentChat();
    if (chat && chat.messages.length === 0) { chat.folderId = folder ? folder.id : null; save(); }
    else { newChat(folder ? folder.id : null); }
    renderSidebar();
    syncComposerChip();
  }

  //  UI: composer context chip + confirm bar + settings popover

  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'kiconnect-agent-styles';
    s.textContent = `
/* Matches the neighboring Knowledge-Base button's height (kiconnect-db.js). */
.agent-context-bar{display:inline-flex;align-items:center;gap:2px;position:relative;height:44px;box-sizing:border-box;padding:3px;border:1px solid var(--border,rgba(128,128,128,.25));border-radius:22px;background:var(--surface2,rgba(128,128,128,.05));}
.agent-context-chip{display:inline-flex;align-items:center;gap:5px;height:100%;padding:0 10px;border-radius:18px;border:none;background:none;color:var(--muted,#888);font-size:11.5px;cursor:pointer;transition:.15s;max-width:140px;box-sizing:border-box;}
.agent-context-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.agent-context-chip:hover{color:var(--text,#eee);}
.agent-context-chip.agent-focused{color:#fff;background:var(--accent,#3d7eff);font-weight:600;}
.agent-gear-btn{display:inline-flex;align-items:center;justify-content:center;height:100%;background:none;border:none;cursor:pointer;color:var(--muted,#888);font-size:14px;padding:0 7px;border-radius:16px;box-sizing:border-box;}
.agent-gear-btn:hover{background:var(--surface2,rgba(128,128,128,.12));color:var(--text,#eee);}
.agent-context-menu{position:fixed;min-width:220px;max-width:320px;background:var(--surface,#1c1c1e);border:1px solid var(--border,rgba(128,128,128,.25));border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:6px;z-index:130;max-height:280px;overflow-y:auto;}
.agent-header-toggle{display:inline-flex;align-items:center;gap:5px;margin-left:6px;padding:5px 11px;border-radius:16px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--muted,#888);font-size:11.5px;cursor:pointer;max-width:150px;vertical-align:middle;}
.agent-header-toggle span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.agent-header-toggle:hover{color:var(--text,#eee);border-color:var(--accent,#3d7eff);}
.agent-header-toggle.agent-focused{color:#fff;background:var(--accent,#3d7eff);border-color:var(--accent,#3d7eff);font-weight:600;}
.agent-context-menu-item{padding:8px 10px;border-radius:7px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:7px;color:var(--text,#eee);}
.agent-context-menu-item:hover{background:var(--surface2,rgba(128,128,128,.12));}
.agent-context-menu-item.active{color:var(--accent,#3d7eff);font-weight:600;}
.agent-context-menu-sep{height:1px;background:var(--border,rgba(128,128,128,.2));margin:5px 2px;}
.agent-confirm-bar{display:none;align-items:center;gap:10px;margin-bottom:8px;padding:8px 12px;border-radius:10px;background:rgba(243,156,18,.1);border:1px solid #f39c12;font-size:12px;}
.agent-confirm-bar span{flex:1;color:var(--text,#eee);}
.agent-confirm-bar button{padding:6px 12px;border-radius:7px;border:none;cursor:pointer;font-size:11.5px;font-weight:600;}
#agentConfirmAccept{background:var(--green,#2ecc71);color:#fff;}
#agentConfirmReject{background:var(--red,#e74c3c);color:#fff;}
.agent-token-counter{display:block;margin:4px 2px 0;color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.agent-run-footer{display:flex;align-items:center;gap:8px;margin:4px 2px 0;}
.agent-run-footer .agent-token-counter{margin:0;}
.agent-inline-stop-btn{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:11px;border:1px solid var(--red,#e74c3c);background:none;color:var(--red,#e74c3c);font-size:10.5px;cursor:pointer;line-height:1.6;}
.agent-inline-stop-btn:hover{background:var(--red,#e74c3c);color:#fff;}
details.agent-trace{border:1px solid var(--border,rgba(128,128,128,.25));border-radius:10px;padding:6px 10px;margin:6px 0;font-size:12.5px;background:var(--surface2,rgba(128,128,128,.05));}
details.agent-trace summary{cursor:pointer;list-style:revert;font-family:'IBM Plex Mono',monospace;font-size:12px;}
details.agent-trace[data-status="error"]{border-color:var(--red,#e74c3c);}
details.agent-trace[data-status="pending"]{border-color:#f39c12;}
details.agent-trace[data-status="simulated"]{border-color:#7c5cfc;}
details.agent-trace[data-status="rejected"]{border-color:var(--red,#e74c3c);}
.folder.agent-project-folder .folder-header{border-left:2px solid var(--accent,#3d7eff);}
.agent-settings-panel{position:fixed;width:300px;max-width:88vw;background:var(--surface,#1c1c1e);border:1px solid var(--border,rgba(128,128,128,.25));border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.4);padding:14px;z-index:120;display:none;}
.agent-settings-panel.open{display:block;}
.agent-toggle-switch{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0;}
.agent-toggle-switch input{opacity:0;width:0;height:0;}
.agent-toggle-slider{position:absolute;cursor:pointer;inset:0;background:var(--surface2,rgba(128,128,128,.3));border-radius:20px;transition:.15s;}
.agent-toggle-slider::before{content:"";position:absolute;height:14px;width:14px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.15s;}
.agent-toggle-switch input:checked + .agent-toggle-slider{background:#e67e22;}
.agent-toggle-switch input:checked + .agent-toggle-slider::before{transform:translateX(16px);}
.agent-settings-title{font-size:13px;font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;}
.agent-chip-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;}
.agent-chip{flex:1;min-width:80px;text-align:center;padding:7px 4px;border-radius:8px;border:1px solid var(--border,rgba(128,128,128,.25));cursor:pointer;font-size:11px;color:var(--muted,#888);}
.agent-chip.selected{background:var(--accent,#3d7eff);border-color:var(--accent,#3d7eff);color:#fff;font-weight:600;}
.agent-chip-desc{font-size:10px;color:var(--muted,#888);margin-top:6px;line-height:1.4;}
.agent-proj-row{display:flex;align-items:center;gap:6px;padding:5px 2px;font-size:12px;}
.agent-proj-row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.agent-proj-row button{background:none;border:none;cursor:pointer;color:var(--muted,#888);font-size:12px;}
.agent-proj-row button:hover{color:var(--red,#e74c3c);}
.agent-proj-row.missing span{color:var(--red,#e74c3c);}
.agent-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;align-items:center;justify-content:center;}
.agent-modal-overlay.open{display:flex;}
.agent-modal{width:440px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;background:var(--surface,#1c1c1e);border:1px solid var(--border,rgba(128,128,128,.25));border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);padding:16px;}
.agent-modal-title{font-size:14px;font-weight:700;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;}
.fp-path-row{display:flex;gap:6px;margin-bottom:8px;}
.fp-path-row input{flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid var(--border,rgba(128,128,128,.25));background:var(--surface2,rgba(128,128,128,.08));color:var(--text,#eee);font-size:12px;}
.fp-path-row button{padding:6px 10px;border-radius:8px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--text,#eee);cursor:pointer;font-size:12px;}
.fp-shortcuts{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
.fp-shortcut-chip{padding:3px 9px;border-radius:20px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--muted,#888);font-size:11px;cursor:pointer;}
.fp-shortcut-chip:hover{color:var(--text,#eee);border-color:var(--accent,#3d7eff);}
.fp-list{flex:1;min-height:140px;max-height:280px;overflow-y:auto;border:1px solid var(--border,rgba(128,128,128,.2));border-radius:8px;padding:4px;margin-bottom:10px;}
.fp-list-item{padding:7px 9px;border-radius:6px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:7px;color:var(--text,#eee);}
.fp-list-item:hover{background:var(--surface2,rgba(128,128,128,.12));}
.fp-list-empty{padding:16px;text-align:center;color:var(--muted,#888);font-size:12px;}
.fp-new-row,.fp-footer{display:flex;gap:6px;margin-bottom:8px;}
.fp-new-row input,.fp-footer input{flex:1;min-width:0;padding:7px 9px;border-radius:8px;border:1px solid var(--border,rgba(128,128,128,.25));background:var(--surface2,rgba(128,128,128,.08));color:var(--text,#eee);font-size:12px;}
.agent-primary-btn{padding:7px 14px;border-radius:8px;border:none;background:var(--accent,#3d7eff);color:#fff;font-weight:600;cursor:pointer;font-size:12.5px;white-space:nowrap;}
.agent-primary-btn:hover{filter:brightness(1.08);}
.fp-error{color:var(--red,#e74c3c);font-size:11.5px;margin-top:2px;}
`;
    document.head.appendChild(s);
  }

  function injectComposerUI() {
    const inputZone = document.querySelector('.input-zone');
    const actions = document.querySelector('.input-actions');
    if (!inputZone || !actions || document.getElementById('agentContextBar')) return;

    // The confirm bar stays pinned above the composer — it's a transient
    // "action needed" banner and needs to stay impossible to miss.
    const confirmBar = document.createElement('div');
    confirmBar.className = 'agent-confirm-bar';
    confirmBar.id = 'agentConfirmBar';
    confirmBar.innerHTML = `
      <span id="agentConfirmDesc"></span>
      <button id="agentConfirmAccept">${esc(t('agent.accept'))}</button>
      <button id="agentConfirmReject">${esc(t('agent.reject'))}</button>
    `;
    inputZone.insertBefore(confirmBar, inputZone.firstChild);

    // Project chip + settings gear + stop button sit in the same row as the
    // mic/read-aloud controls, in their own framed group so they read as
    // one unit.
    const bar = document.createElement('div');
    bar.className = 'agent-context-bar';
    bar.id = 'agentContextBar';
    bar.innerHTML = `
      <button class="agent-context-chip" id="agentContextChip">📁 <span id="agentContextLabel">${esc(t('agent.noProject'))}</span> ▾</button>
      <button class="agent-gear-btn" id="agentGearBtn" title="${esc(t('agent.settings'))}">⚙</button>
    `;
    const sendBtn = document.getElementById('sendBtn');
    actions.insertBefore(bar, sendBtn || null);

    if (!document.getElementById('agentContextMenu')) {
      const menu = document.createElement('div');
      menu.className = 'agent-context-menu';
      menu.id = 'agentContextMenu';
      menu.hidden = true;
      document.body.appendChild(menu);
      menu.addEventListener('click', e => e.stopPropagation());
    }

    document.getElementById('agentContextChip').addEventListener('click', e => { e.stopPropagation(); toggleContextMenu(e.currentTarget); });
    document.getElementById('agentGearBtn').addEventListener('click', e => { e.stopPropagation(); toggleAgentSettingsPanel(); });
    document.addEventListener('click', () => closeContextMenu());
  }

  function toggleContextMenu(trigger) {
    const menu = document.getElementById('agentContextMenu');
    if (!menu) return;
    if (!menu.hidden) { closeContextMenu(); return; }
    renderContextMenu();
    menu.hidden = false;
    positionContextMenu(trigger || document.getElementById('agentContextChip'));
  }
  function positionContextMenu(trigger) {
    const menu = document.getElementById('agentContextMenu');
    if (!menu || !trigger) return;
    requestAnimationFrame(() => {
      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const menuW = menu.offsetWidth || 260;
      let left = rect.right - menuW;
      left = Math.max(8, Math.min(left, vw - menuW - 8));
      menu.style.left = left + 'px';
      const spaceAbove = rect.top - 8, spaceBelow = vh - rect.bottom - 8;
      if (spaceAbove >= 160 || spaceAbove >= spaceBelow) {
        menu.style.bottom = (vh - rect.top + 8) + 'px'; menu.style.top = 'auto';
      } else {
        menu.style.top = (rect.bottom + 8) + 'px'; menu.style.bottom = 'auto';
      }
    });
  }
  function closeContextMenu() {
    const menu = document.getElementById('agentContextMenu');
    if (menu) menu.hidden = true;
  }
  function renderContextMenu() {
    const menu = document.getElementById('agentContextMenu');
    const chat = currentChat();
    const curFolder = chat && folders.find(f => f.id === chat.folderId);
    const projectFolders = folders.filter(f => f.agentProject);
    menu.innerHTML = '';
    const addItem = (label, onClick, active) => {
      const div = document.createElement('div');
      div.className = 'agent-context-menu-item' + (active ? ' active' : '');
      div.innerHTML = label;
      div.addEventListener('click', () => { closeContextMenu(); onClick(); });
      menu.appendChild(div);
    };
    addItem(`🚫 ${esc(t('agent.noProject'))}`, () => focusProject(null), !(curFolder && curFolder.agentProject));
    if (projectFolders.length) {
      const sep = document.createElement('div'); sep.className = 'agent-context-menu-sep'; menu.appendChild(sep);
      projectFolders.forEach(f => addItem(`🤖 ${esc(f.name)}`, () => focusProject(f), curFolder && curFolder.id === f.id));
    }
    const sep2 = document.createElement('div'); sep2.className = 'agent-context-menu-sep'; menu.appendChild(sep2);
    addItem(`＋ ${esc(t('agent.newProject'))}`, onCreateProjectClick, false);
  }
  function onCreateProjectClick() {
    openFolderPicker();
  }

  // A second, equivalent trigger for the same project menu, next to the
  // header's model picker — "which AI" and "which project" side by side.
  function injectHeaderToggle() {
    if (document.getElementById('agentHeaderToggle')) return;
    const cmWrap = document.getElementById('cmWrap');
    if (!cmWrap || !cmWrap.parentNode) return;
    const btn = document.createElement('button');
    btn.id = 'agentHeaderToggle';
    btn.className = 'agent-header-toggle';
    btn.title = t('agent.headerToggleTitle');
    btn.innerHTML = `📁 <span id="agentHeaderToggleLabel">${esc(t('agent.noProject'))}</span>`;
    btn.addEventListener('click', e => { e.stopPropagation(); toggleContextMenu(e.currentTarget); });
    cmWrap.parentNode.insertBefore(btn, cmWrap.nextSibling);
  }

  function syncComposerChip() {
    const chip = document.getElementById('agentContextChip');
    const label = document.getElementById('agentContextLabel');
    const hdrBtn = document.getElementById('agentHeaderToggle');
    const hdrLabel = document.getElementById('agentHeaderToggleLabel');
    const chat = currentChat();
    const folder = chat && folders.find(f => f.id === chat.folderId);
    const focused = !!(folder && folder.agentProject);
    if (chip && label) {
      chip.classList.toggle('agent-focused', focused);
      chip.firstChild.textContent = focused ? '🤖 ' : '📁 ';
      label.textContent = focused ? folder.name : t('agent.noProject');
    }
    if (hdrBtn && hdrLabel) {
      hdrBtn.classList.toggle('agent-focused', focused);
      hdrBtn.firstChild.textContent = focused ? '🤖 ' : '📁 ';
      hdrLabel.textContent = focused ? folder.name : t('agent.noProject');
    }
  }
  // Compact human-readable token count (850 -> "850", 12400 -> "12.4K").
  // Kept local, not a currency formatter — only needs to be short and rough.
  function formatTokenCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  // Live running total under the streaming bubble it belongs to, not the
  // composer bar (which can't tie to a specific run). Created fresh per run
  // as a sibling of the bubble inside .bubble-wrap, so rerenderCurrentRun()'s
  // innerHTML resets never wipe it out; removed in `finally` when the run
  // ends. A "cost right now" indicator; MAX_ITERATIONS allows up to 200
  // round-trips per turn and without this the only way to see actual cost
  // was inspecting network traffic. `run` should be passed explicitly by
  // the tool loop; falls back to _agentRun() otherwise.
  function updateTokenCounterUI(usage, run) {
    run = run || _agentRun();
    if (run) run.usage = usage; // stored so a reattached bubble can prefill the counter immediately
    const liveRow = run ? _runBubbleEl(run) : null;
    const liveTokenEl = liveRow ? liveRow.querySelector('.agent-token-counter') : null;
    if (!liveTokenEl) return;
    const cached = usage.cache_read_input_tokens || 0;
    let text = `🔢 ${formatTokenCount(usage.input_tokens)} in / ${formatTokenCount(usage.output_tokens)} out`;
    if (cached) text += ` (${formatTokenCount(cached)} cached)`;
    liveTokenEl.textContent = text;
  }

  // Settings popover (provider / model / autonomy / manage projects)
  function injectAgentSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'agent-settings-panel';
    panel.id = 'agentSettingsPanel';
    panel.innerHTML = `
      <div class="agent-settings-title"><span>🤖 <span id="agentSettingsProjectName">${esc(t('agent.settingsTitle'))}</span></span><button class="close-btn" id="agentSettingsClose">✕</button></div>
      <div class="agent-hint" id="agentModelHint" style="font-size:10.5px;color:var(--muted);margin-bottom:6px;">${esc(t('agent.modelHint'))}</div>
      <div id="agentSettingsNoProject" style="font-size:11.5px;color:var(--muted);padding:4px 0 8px;" hidden>${esc(t('agent.pickProjectFirst'))}</div>
      <div id="agentSettingsModelBlock">
        <div class="setting-label" id="agentAutonomyLabel">${esc(t('agent.autonomy'))}</div>
        <div class="agent-chip-row" id="agentAutonomyRow">
          <div class="agent-chip" data-mode="auto">${esc(t('agent.autoMode'))}</div>
          <div class="agent-chip" data-mode="confirm">${esc(t('agent.confirmMode'))}</div>
          <div class="agent-chip" data-mode="simulate">${esc(t('agent.simulateMode'))}</div>
        </div>
        <div class="agent-chip-desc" id="agentAutonomyDesc"></div>
        <div class="setting-label" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">
          <span id="agentShellLabel">⚡ ${esc(t('agent.shellLabel'))}</span>
          <label class="agent-toggle-switch"><input type="checkbox" id="agentShellToggle"><span class="agent-toggle-slider"></span></label>
        </div>
        <div class="agent-hint" id="agentShellHint" style="font-size:10px;color:var(--muted);">${esc(t('agent.shellHint'))}</div>
        <div class="setting-label" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">
          <span id="agentCheckpointLabel">🕘 ${esc(t('agent.checkpointLabel'))}</span>
          <label class="agent-toggle-switch"><input type="checkbox" id="agentCheckpointToggle"><span class="agent-toggle-slider"></span></label>
        </div>
        <div class="agent-hint" id="agentCheckpointHint" style="font-size:10px;color:var(--muted);">${esc(t('agent.checkpointHint'))}</div>
      </div>
      <div class="setting-label" id="agentProjectsLabel" style="margin-top:12px;">${esc(t('agent.projects'))}</div>
      <div id="agentProjList"></div>
    `;
    document.body.appendChild(panel);
    document.getElementById('agentSettingsClose').addEventListener('click', () => panel.classList.remove('open'));
    document.getElementById('agentAutonomyRow').addEventListener('click', e => {
      const chip = e.target.closest('.agent-chip'); if (!chip) return;
      const folder = currentProjectFolder();
      if (!folder) return;
      folder.agentAutonomy = chip.dataset.mode;
      settings = saveSettings({ autonomy: chip.dataset.mode });
      save(); renderAutonomyChips();
    });
    document.getElementById('agentShellToggle').addEventListener('change', async e => {
      const folder = currentProjectFolder();
      const box = e.target;
      if (!folder) { box.checked = false; return; }
      if (box.checked) {
        const warned = confirm(tf('agent.shellWarning', { name: folder.name }));
        if (!warned) { box.checked = false; return; }
      }
      try {
        await apiSetShellEnabled(folder.agentProject, box.checked);
        folder.agentShellEnabled = box.checked;
        save();
        showToast(box.checked ? t('agent.shellOn') : t('agent.shellOff'));
      } catch (err) {
        box.checked = !box.checked;
        showToast(`❌ ${err.message}`);
      }
    });
    document.getElementById('agentCheckpointToggle').addEventListener('change', async e => {
      const folder = currentProjectFolder();
      const box = e.target;
      if (!folder) { box.checked = false; return; }
      try {
        const res = await apiSetCheckpointsEnabled(folder.agentProject, box.checked);
        folder.agentCheckpointsEnabled = box.checked;
        save();
        if (box.checked && res && res.gitAvailable === false) {
          showToast(t('agent.checkpointNoGit'));
        } else {
          showToast(box.checked ? t('agent.checkpointOn') : t('agent.checkpointOff'));
        }
      } catch (err) {
        box.checked = !box.checked;
        showToast(`❌ ${err.message}`);
      }
    });
    panel.addEventListener('click', e => e.stopPropagation());
    // Close on any click elsewhere (autonomy/shell changes already save()
    // immediately, nothing to flush here). Gear button and panel handlers
    // both stop propagation, so opening/clicking inside never triggers this.
    document.addEventListener('click', () => panel.classList.remove('open'));
  }

  // Folder picker: browse real OS folders to pick/create a project root
  // anywhere on disk. editFolder is null for a new project, or the
  // existing project's folder object when re-pointing one (see
  // openFolderPickerForEdit()/confirmFolderPicker() below).
  let _fp = { path: '', parent: null, shortcuts: [], editFolder: null };
  function injectFolderPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'agent-modal-overlay';
    overlay.id = 'agentFolderPickerOverlay';
    overlay.innerHTML = `
      <div class="agent-modal" id="agentFolderPickerModal">
        <div class="agent-modal-title"><span>📁 ${esc(t('agent.pickFolder'))}</span><button class="close-btn" id="fpClose">✕</button></div>
        <div class="fp-path-row">
          <button id="fpUpBtn" title="${esc(t('agent.up'))}">⬆</button>
          <input type="text" id="fpPathInput" placeholder="${esc(t('agent.absPath'))}">
          <button id="fpGoBtn">${esc(t('agent.go'))}</button>
        </div>
        <div class="fp-shortcuts" id="fpShortcuts"></div>
        <div class="fp-list" id="fpList"></div>
        <div class="fp-new-row">
          <input type="text" id="fpNewFolderName" placeholder="${esc(t('agent.newSubfolder'))}">
        </div>
        <div class="fp-footer">
          <input type="text" id="fpProjectName" placeholder="${esc(t('agent.projectNamePh'))}">
          <button class="agent-primary-btn" id="fpConfirm">${esc(t('agent.useFolder'))}</button>
        </div>
        <div class="fp-error" id="fpError" hidden></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('fpClose').addEventListener('click', closeFolderPicker);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeFolderPicker(); });
    document.getElementById('fpUpBtn').addEventListener('click', () => { if (_fp.parent) loadFolderPickerDir(_fp.parent); });
    document.getElementById('fpGoBtn').addEventListener('click', () => loadFolderPickerDir(document.getElementById('fpPathInput').value.trim()));
    document.getElementById('fpPathInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadFolderPickerDir(e.target.value.trim()); });
    document.getElementById('fpConfirm').addEventListener('click', confirmFolderPicker);
  }
  function openFolderPicker() {
    const overlay = document.getElementById('agentFolderPickerOverlay');
    if (!overlay) return;
    _fp.editFolder = null;
    setFolderPickerMode(false);
    overlay.classList.add('open');
    document.getElementById('fpNewFolderName').value = '';
    document.getElementById('fpProjectName').value = '';
    document.getElementById('fpProjectName').disabled = false;
    loadFolderPickerDir('');
  }
  // Re-opens the folder picker scoped to changing an EXISTING project's
  // target folder (see the ✏️ button in renderProjectList()). Name field
  // is locked (renaming happens elsewhere); starts at the current path.
  function openFolderPickerForEdit(folder) {
    const overlay = document.getElementById('agentFolderPickerOverlay');
    if (!overlay) return;
    _fp.editFolder = folder;
    setFolderPickerMode(true);
    overlay.classList.add('open');
    document.getElementById('fpNewFolderName').value = '';
    document.getElementById('fpProjectName').value = folder.name || '';
    document.getElementById('fpProjectName').disabled = true;
    loadFolderPickerDir(folder.agentProjectPath || '');
  }
  function setFolderPickerMode(isEdit) {
    const titleEl = document.querySelector('#agentFolderPickerModal .agent-modal-title span');
    const confirmBtn = document.getElementById('fpConfirm');
    if (titleEl) titleEl.textContent = '📁 ' + (isEdit ? t('agent.changeFolder') : t('agent.pickFolder'));
    if (confirmBtn) confirmBtn.textContent = isEdit ? t('agent.useNewFolder') : t('agent.useFolder');
  }
  function closeFolderPicker() {
    const overlay = document.getElementById('agentFolderPickerOverlay');
    if (overlay) overlay.classList.remove('open');
    _fp.editFolder = null;
  }
  function fpSetError(msg) {
    const el = document.getElementById('fpError');
    if (!el) return;
    el.hidden = !msg; el.textContent = msg || '';
  }
  async function loadFolderPickerDir(path) {
    fpSetError('');
    try {
      const data = await apiBrowse(path);
      _fp = { path: data.path, parent: data.parent, shortcuts: data.shortcuts || [] };
      document.getElementById('fpPathInput').value = data.path;
      document.getElementById('fpUpBtn').disabled = !data.parent;
      const shortcutsEl = document.getElementById('fpShortcuts');
      shortcutsEl.innerHTML = '';
      _fp.shortcuts.forEach(s => {
        const chip = document.createElement('button');
        chip.className = 'fp-shortcut-chip'; chip.textContent = s.label;
        chip.addEventListener('click', () => loadFolderPickerDir(s.path));
        shortcutsEl.appendChild(chip);
      });
      const list = document.getElementById('fpList');
      list.innerHTML = '';
      if (!data.entries.length) {
        list.innerHTML = `<div class="fp-list-empty">${esc(t('agent.noSubfolders'))}</div>`;
      } else {
        data.entries.forEach(entry => {
          const row = document.createElement('div');
          row.className = 'fp-list-item';
          row.innerHTML = `📁 ${esc(entry.name)}`;
          row.addEventListener('click', () => loadFolderPickerDir(entry.path));
          list.appendChild(row);
        });
      }
      const nameEl = document.getElementById('fpProjectName');
      if (!nameEl.value) nameEl.value = (data.path.split(/[\\/]/).filter(Boolean).pop()) || data.path;
    } catch (err) {
      fpSetError(err.message);
    }
  }
  async function confirmFolderPicker() {
    const newSub = (document.getElementById('fpNewFolderName').value || '').trim();
    const targetPath = newSub ? _fp.path.replace(/[\\/]+$/, '') + '/' + newSub : _fp.path;
    fpSetError('');
    if (_fp.editFolder) {
      const folder = _fp.editFolder;
      try {
        const res = await apiSetProjectPath(folder.agentProject, targetPath, !!newSub);
        folder.agentProjectPath = res.path || targetPath;
        save();
        closeFolderPicker();
        showToast(t('agent.projectPathChanged'));
        renderProjectList();
      } catch (err) {
        fpSetError(err.message);
      }
      return;
    }
    const name = (document.getElementById('fpProjectName').value || '').trim() || newSub || (targetPath.split(/[\\/]/).filter(Boolean).pop()) || 'Projekt';
    try {
      const folder = await createProject(name, targetPath, !!newSub);
      if (folder) {
        closeFolderPicker();
        focusProject(folder);
        showToast(t('agent.projectCreated'));
        renderProjectList();
      }
    } catch (err) {
      fpSetError(err.message);
    }
  }
  function renderAutonomyChips() {
    const folder = currentProjectFolder();
    const modelBlock = document.getElementById('agentSettingsModelBlock');
    const noProjectEl = document.getElementById('agentSettingsNoProject');
    const titleEl = document.getElementById('agentSettingsProjectName');
    if (titleEl) titleEl.textContent = folder ? folder.name : t('agent.settingsTitle');
    if (noProjectEl) noProjectEl.hidden = !!folder;
    if (modelBlock) modelBlock.style.display = folder ? '' : 'none';
    if (!folder) return;
    if (!folder.agentAutonomy) folder.agentAutonomy = 'confirm';
    const mode = folder.agentAutonomy;
    const shellToggle = document.getElementById('agentShellToggle');
    if (shellToggle) shellToggle.checked = !!folder.agentShellEnabled;
    const checkpointToggle = document.getElementById('agentCheckpointToggle');
    if (checkpointToggle) checkpointToggle.checked = !!folder.agentCheckpointsEnabled;
    document.querySelectorAll('#agentAutonomyRow .agent-chip').forEach(c => c.classList.toggle('selected', c.dataset.mode === mode));
    const d = document.getElementById('agentAutonomyDesc');
    if (d) d.textContent = t('agent.mode.' + mode);
  }
  async function renderProjectList() {
    const list = document.getElementById('agentProjList');
    if (!list) return;
    const projectFolders = folders.filter(f => f.agentProject);
    let missingIds = new Set();
    try {
      (await apiListProjects()).forEach(p => {
        if (p.missing) missingIds.add(p.id);
        const f = projectFolders.find(x => x.agentProject === p.id);
        if (f) { f.agentShellEnabled = !!p.shell; f.agentCheckpointsEnabled = !!p.checkpoints; }
      });
    } catch (e) {}
    const shellToggle = document.getElementById('agentShellToggle');
    const checkpointToggle = document.getElementById('agentCheckpointToggle');
    const focused = currentProjectFolder();
    if (shellToggle && focused) shellToggle.checked = !!focused.agentShellEnabled;
    if (checkpointToggle && focused) checkpointToggle.checked = !!focused.agentCheckpointsEnabled;
    list.innerHTML = projectFolders.length ? '' : `<div style="font-size:11px;color:var(--muted);">${esc(t('agent.noProjects'))}</div>`;
    projectFolders.forEach(f => {
      const missing = missingIds.has(f.agentProject);
      const row = document.createElement('div');
      row.className = 'agent-proj-row' + (missing ? ' missing' : '');
      const title = missing ? esc(t('agent.projectMissing')) : esc(f.agentProjectPath || '');
      row.innerHTML = `<span title="${title}">${missing ? '⚠️' : '🤖'} ${esc(f.name)}</span><button class="agent-proj-edit-btn" title="${esc(t('agent.changeFolder'))}">✏️</button><button title="${esc(t('agent.deleteProject'))}">🗑</button>`;
      row.querySelector('.agent-proj-edit-btn').addEventListener('click', () => openFolderPickerForEdit(f));
      row.querySelector('button:last-child').addEventListener('click', () => deleteProjectFolder(f).then(renderProjectList));
      list.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'agent-small-btn';
    addBtn.style.cssText = 'margin-top:6px;width:100%;padding:6px;border-radius:7px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--text,#eee);cursor:pointer;font-size:11.5px;';
    addBtn.textContent = '＋ ' + t('agent.newProject');
    addBtn.addEventListener('click', onCreateProjectClick);
    list.appendChild(addBtn);
  }
  function positionAgentSettingsPanel() {
    const panel = document.getElementById('agentSettingsPanel');
    const gear = document.getElementById('agentGearBtn');
    if (!panel || !gear) return;
    requestAnimationFrame(() => {
      const rect = gear.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const panelW = panel.offsetWidth || 300;
      let left = rect.right - panelW; // right-align panel to the gear icon
      left = Math.max(8, Math.min(left, vw - panelW - 8));
      panel.style.left = left + 'px';
      const spaceAbove = rect.top - 8, spaceBelow = vh - rect.bottom - 8;
      if (spaceAbove >= 220 || spaceAbove >= spaceBelow) {
        panel.style.bottom = (vh - rect.top + 8) + 'px';
        panel.style.top = 'auto';
      } else {
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.bottom = 'auto';
      }
    });
  }
  function openAgentSettingsPanel() {
    const panel = document.getElementById('agentSettingsPanel');
    if (!panel) return;
    panel.classList.add('open');
    positionAgentSettingsPanel();
    renderAutonomyChips(); renderProjectList();
  }
  function toggleAgentSettingsPanel() {
    const panel = document.getElementById('agentSettingsPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
    openAgentSettingsPanel();
  }
  window.addEventListener('resize', () => {
    const panel = document.getElementById('agentSettingsPanel');
    if (panel && panel.classList.contains('open')) positionAgentSettingsPanel();
  });
  window.openAgentSettingsPanel = openAgentSettingsPanel;

  //  Wiring into the host app (send interception, sidebar icons)
  function installHooks() {
    // sendMessage(): route to the agent loop when the active chat is
    // filed under a project folder; otherwise defer to the original.
    const _origSendMessage = sendMessage;
    sendMessage = async function () {
      const chat = currentChat();
      const folder = chat && folders.find(f => f.id === chat.folderId);
      if (folder && folder.agentProject) {
        const input = document.getElementById('messageInput');
        const text = (input.value || '').trim();
        if (!text && !attachments.length) return;
        input.value = '';
        try { autoResize(input); } catch (e) {}
        const att = [...attachments];
        clearAttachments();
        await runAgentChatTurn(text, folder, att);
        return;
      }
      return _origSendMessage.apply(this, arguments);
    };

    // regenerate(): a project chat's "Regenerieren" button should re-run
    // the agent loop, not fall back to a tool-less completion.
    const _origRegenerate = regenerate;
    regenerate = async function (idx) {
      if (await agentRegenerate(idx)) return;
      return _origRegenerate.apply(this, arguments);
    };

    // renderSidebar(): mark project folders + keep the composer chip in
    // sync whenever redrawn — covers newChat()/switchChat() too, since both
    // call renderSidebar() internally.
    const _origRenderSidebar = renderSidebar;
    renderSidebar = function () {
      _origRenderSidebar.apply(this, arguments);
      document.querySelectorAll('#folderContainer .folder[data-folder-id]').forEach(div => {
        const f = folders.find(x => x.id === div.dataset.folderId);
        if (f && f.agentProject) {
          div.classList.add('agent-project-folder');
          const icon = div.querySelector('.folder-icon');
          if (icon) icon.textContent = '🤖';
        }
      });
      syncComposerChip();
    };
  }

  // Language change hook, called by kiconnect.js's setLang() (same pattern
  // as kiconnect-voice.js's window._kicVoiceRetranslate). Re-reads
  // translated text/title/placeholder in place so open panels and
  // in-progress runs update immediately, not just on next re-render.
  window._kicAgentRetranslate = function () {
    // Composer chip + gear
    syncComposerChip();
    const gearBtn = document.getElementById('agentGearBtn');
    if (gearBtn) gearBtn.title = t('agent.settings');
    // Inline stop buttons under any currently-running run's bubble.
    document.querySelectorAll('.agent-inline-stop-btn').forEach(btn => {
      btn.textContent = '⏹ ' + t('agent.stop');
    });
    const acceptBtn = document.getElementById('agentConfirmAccept');
    if (acceptBtn) acceptBtn.textContent = t('agent.accept');
    const rejectBtn = document.getElementById('agentConfirmReject');
    if (rejectBtn) rejectBtn.textContent = t('agent.reject');

    // Header toggle
    const hdrBtn = document.getElementById('agentHeaderToggle');
    if (hdrBtn) hdrBtn.title = t('agent.headerToggleTitle');

    // Context menu (rebuilt fresh each open, nothing to patch while closed)
    const ctxMenuEl = document.getElementById('agentContextMenu');
    if (ctxMenuEl && !ctxMenuEl.hidden) renderContextMenu();

    // Settings popover: static labels, hints, mode chips, and project
    // rows (text depends on the focused project, so just re-run renderers).
    const settingsTitle = document.getElementById('agentSettingsProjectName');
    if (settingsTitle && !currentProjectFolder()) settingsTitle.textContent = t('agent.settingsTitle');
    const panel = document.getElementById('agentSettingsPanel');
    if (panel) {
      const modelHint = document.getElementById('agentModelHint');
      if (modelHint) modelHint.textContent = t('agent.modelHint');
      const noProjectEl = document.getElementById('agentSettingsNoProject');
      if (noProjectEl) noProjectEl.textContent = t('agent.pickProjectFirst');
      const autonomyLabel = document.getElementById('agentAutonomyLabel');
      if (autonomyLabel) autonomyLabel.textContent = t('agent.autonomy');
      const chipAuto = panel.querySelector('.agent-chip[data-mode="auto"]');
      if (chipAuto) chipAuto.textContent = t('agent.autoMode');
      const chipConfirm = panel.querySelector('.agent-chip[data-mode="confirm"]');
      if (chipConfirm) chipConfirm.textContent = t('agent.confirmMode');
      const chipSimulate = panel.querySelector('.agent-chip[data-mode="simulate"]');
      if (chipSimulate) chipSimulate.textContent = t('agent.simulateMode');
      const shellLabel = document.getElementById('agentShellLabel');
      if (shellLabel) shellLabel.textContent = '⚡ ' + t('agent.shellLabel');
      const shellHint = document.getElementById('agentShellHint');
      if (shellHint) shellHint.textContent = t('agent.shellHint');
      const checkpointLabel = document.getElementById('agentCheckpointLabel');
      if (checkpointLabel) checkpointLabel.textContent = '🕘 ' + t('agent.checkpointLabel');
      const checkpointHint = document.getElementById('agentCheckpointHint');
      if (checkpointHint) checkpointHint.textContent = t('agent.checkpointHint');
      const projectsLabel = document.getElementById('agentProjectsLabel');
      if (projectsLabel) projectsLabel.textContent = t('agent.projects');
      if (panel.classList.contains('open')) { renderAutonomyChips(); renderProjectList(); }
    }

    // Folder picker modal
    const fpTitle = document.querySelector('#agentFolderPickerModal .agent-modal-title span');
    if (fpTitle) fpTitle.textContent = '📁 ' + t('agent.pickFolder');
    const fpUpBtn = document.getElementById('fpUpBtn');
    if (fpUpBtn) fpUpBtn.title = t('agent.up');
    const fpPathInput = document.getElementById('fpPathInput');
    if (fpPathInput) fpPathInput.placeholder = t('agent.absPath');
    const fpGoBtn = document.getElementById('fpGoBtn');
    if (fpGoBtn) fpGoBtn.textContent = t('agent.go');
    const fpNewFolderName = document.getElementById('fpNewFolderName');
    if (fpNewFolderName) fpNewFolderName.placeholder = t('agent.newSubfolder');
    const fpProjectName = document.getElementById('fpProjectName');
    if (fpProjectName) fpProjectName.placeholder = t('agent.projectNamePh');
    const fpConfirm = document.getElementById('fpConfirm');
    if (fpConfirm) fpConfirm.textContent = t('agent.useFolder');
    // Re-render the empty-state note in the folder list, if showing.
    const fpList = document.getElementById('fpList');
    if (fpList && fpList.querySelector('.fp-list-empty')) {
      fpList.innerHTML = `<div class="fp-list-empty">${esc(t('agent.noSubfolders'))}</div>`;
    }

    // Re-render any tool-call trace open in the live bubble so its
    // labels/status pick up the new language immediately.
    rerenderCurrentRun();
    // Already-finished agent replies: their tool labels/status words are UI
    // chrome baked in at the time the run finished — previously stuck in
    // whatever language was active when created. Re-render every visible one
    // from its stored `_agentSteps` and persist the translated markdown so a
    // reload shows the new language too.
    retranslateAgentHistory();
  };

  function retranslateAgentHistory() {
    const chat = currentChat();
    if (!chat) return;
    const path = getActivePath(chat);
    let changed = false;
    path.forEach((msg, idx) => {
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg._agentSteps)) return;
      const rowEl = (typeof getBubbleRow === 'function') ? getBubbleRow(idx) : document.querySelector(`.message-row[data-idx="${idx}"]`);
      const bubble = rowEl && rowEl.querySelector('.bubble');
      const newMd = renderRunMarkdown(msg._agentSteps);
      msg.content = newMd;
      changed = true;
      if (bubble) {
        bubble.innerHTML = formatText(newMd) || '<p>…</p>';
        typesetMath(bubble);
      }
    });
    if (changed) save();
  }

  // Boot
  installHooks();

  function waitForHost(tries) {
    tries = tries || 0;
    if (document.querySelector('.input-zone') && document.getElementById('folderContainer')) {
      injectStyles();
      injectComposerUI();
      injectAgentSettingsPanel();
      injectFolderPicker();
      injectHeaderToggle();
      syncComposerChip();
      return;
    }
    if (tries > 150) return;
    setTimeout(() => waitForHost(tries + 1), 100);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => waitForHost());
  else waitForHost();
})();
