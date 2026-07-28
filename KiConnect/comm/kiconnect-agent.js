// ================================================================
// kiconnect-agent.js – Coding-Agent module (v3.0)
//
// Self-contained, bolt-on module (same pattern as kiconnect-voice.js).
// Design:
//
//   - A "project" is a REAL sidebar folder (the same `folders` array
//     the app already renders) with an extra `agentProject` field
//     pointing at its registered filesystem folder on the local proxy
//     (see /agent/projects). Project folders appear wherever normal
//     folders do, because they are folders.
//   - A chat is "project-focused" simply when its `folderId` points at
//     such a folder. A chip next to the mic/TTS controls, plus a
//     toggle next to the header's model picker, let you focus/unfocus/
//     create a project without leaving the normal chat flow — pick a
//     project, type, send, same as any other message. No separate task
//     box or log.
//   - There is deliberately only ONE model picker app-wide — the
//     header's — for both normal chat and agent turns, including its
//     thinking/reasoning-effort settings; nothing agent-specific is
//     duplicated. Per project, only the autonomy mode
//     (auto / confirm / simulate) is remembered separately, since
//     that's a policy choice, not a model choice.
//   - Sending a message in a focused chat runs the agent's tool loop
//     instead of a plain completion. The reply is a normal assistant
//     bubble; each tool call renders as a collapsed <details> card
//     (closed by default) to keep the chat readable — similar to how
//     Claude Code / Codex show step traces.
// ================================================================

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
  // Local fallback templates for tf() below, used only if the host app's own
  // tf() helper isn't available yet — kept in sync with the 'en' block in
  // kiconnect-languages-i18n.js so the module still works stand-alone.
  const TF_FALLBACKS = {
    'agent.sim.write': 'Simulation: would have written "{path}" with {len} characters. No file was changed.',
    'agent.sim.deleteFile': 'Simulation: would have deleted file "{path}". No file was changed.',
    'agent.sim.createDir': 'Simulation: would have created folder "{path}".',
    'agent.sim.deleteDir': 'Simulation: would have deleted folder "{path}" and its contents. Nothing was changed.',
    'agent.sim.edit': 'Simulation: would have applied {n} change(s) to "{path}". No file was changed.',
    'agent.sim.move': 'Simulation: would have moved "{from}" to "{to}". Nothing was changed.',
    'agent.sim.copy': 'Simulation: would have copied "{from}" to "{to}". Nothing was changed.',
    'agent.sim.replace': 'Simulation: would have replaced "{find}" in {n} file(s). No file was changed.',
    'agent.sim.run': 'Simulation: would have run "{command}". No command was executed.',
    'agent.warnSelfNested': 'Note: "{path}" nests a folder ("{seg}") inside another one with the same name — this is usually accidental. Check with list_files whether you meant the existing folder instead of creating another one inside it.',
    'agent.warnShrink': 'Warning: "{path}" would shrink from {oldSize} to {newSize} bytes — more than half the original content would be lost. If you only meant to change part of the file (e.g. you only saw a partial view of a large file), use edit_file or replace_in_files instead of overwriting it whole.',
    'agent.warnShrinkMulti': 'Warning: {n} file(s) in this batch would each lose more than half their original content. If this is not intentional, use edit_file/replace_in_files on the affected files instead of overwriting them whole.',
    'agent.err.oldStrNotFound': 'The exact text "{snippet}…" was not found in the file — read the file again for its current content.',
    'agent.err.oldStrNotUnique': 'The text "{snippet}…" occurs more than once in the file — make it more specific so it matches exactly one place.',
    'agent.err.unknownTool': 'Unknown tool: {name}',
    'agent.bytesSaved': '{bytes} bytes saved.',
    'agent.nOccurrences': '{n}×',
    'agent.err.modelCallFailed': 'Error calling the model: {error}',
    'agent.maxIterations': 'Maximum number of steps ({n}) reached.',
    'agent.confirmDeleteProject': 'Really remove project "{name}" from KI Connect?\n\nThe folder and its files on disk stay untouched — only the link is removed. This will also permanently delete the {n} chat(s) filed under this project (not recoverable).',
    'agent.shellWarning': 'Enable shell commands for "{name}"?\n\nThe agent will then be able to run arbitrary terminal commands in the project folder (e.g. install packages, run tests, delete files outside the project). This runs with the same permissions as the local KI Connect server on your machine — there is no real sandbox, only the project folder as the working directory.\n\nOnly proceed if you trust this project.',
    'agent.compactedNote': 'Older tool result cleared to save tokens',
    'agent.compactedHint': 'Call the same tool again with the same arguments if you still need this content — the underlying file/data on disk is unchanged, only this copy was removed from the conversation.',
  };
  // Like t(), but also substitutes {placeholder} variables in the translated
  // string. Prefers the host app's own tf() (kiconnect.js) when present, so
  // this module stays in sync with the exact same lookup/fallback behavior;
  // otherwise falls back to a local copy of the same templates.
  function tf(key, vars) {
    if (typeof window.tf === 'function' && window.tf !== tf) {
      return window.tf(key, vars);
    }
    let s = t(key, TF_FALLBACKS[key] || key);
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

  // ── Settings persistence — just the default autonomy mode for newly
  // created projects. The model is never stored here: it's always
  // whatever the header's model picker (config.model) is set to. ──
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

  // ── Runtime state ────────────────────────────────────────────────
  let running = false;
  let abortController = null;
  let pendingConfirm = null;

  const MAX_ITERATIONS = 200;

  // ── Generic (provider-agnostic) tool-result compaction ────────────
  // Anthropic gets prompt caching (cache_control breakpoints, see
  // callModel below) AND, optionally, Anthropic's own native
  // context-management. Every OTHER provider — gpt-oss-120b, mistral-small,
  // or any other OpenAI-compatible endpoint — gets neither: every single
  // iteration of the tool loop resends the ENTIRE growing history in full,
  // at full price, with zero discount. In a long agent run this is what
  // actually drives token usage into the millions — not model choice, not
  // "local vs. cloud" — because the exact same already-read file content
  // gets retransmitted, byte-for-byte unchanged, on every subsequent
  // iteration (roughly O(iterations²) tokens instead of O(iterations)).
  //
  // compactOldToolResults() fixes this the same way for every provider,
  // since it operates on the shared internal `history` array BEFORE either
  // toAnthropicHistory() or toOpenAIHistory() converts it. It only ever
  // touches TOOL RESULTS (file contents, search hits, directory listings,
  // command output) that are older than KEEP_RECENT_TOOL_TURNS iterations
  // — never the user's own messages, never the model's own text. Nothing
  // is silently dropped: the original content is replaced by an explicit,
  // clearly labeled placeholder naming the tool and its main argument, so
  // any model (any vendor) can see exactly what happened and just call the
  // same tool again if it turns out it still needs that data — the file
  // itself is untouched on disk, only the copy sent to the model shrinks.
  //
  // Only applied to non-Anthropic providers: Anthropic's own prompt cache
  // already keeps the resend of unchanged history cheap (~10% price), and
  // mutating old blocks would needlessly bust that cache. For every other
  // provider there is no such cache to protect, so compacting is a clear win.
  const KEEP_RECENT_TOOL_TURNS = 6;   // tool-result turns kept 100% intact
  const COMPACT_MIN_SIZE = 400;       // don't bother compacting tiny results (chars)

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
  // NOTE: these are functions (not plain objects) so they always read the
  // CURRENT UI language at render time, instead of being frozen to whatever
  // language was active when the script first loaded. That's what lets the
  // header language switcher update already-open tool traces immediately.
  function toolLabel(name) {
    const LABELS = {
      list_files: t('agent.tool.list', 'View folder'), search_in_files: t('agent.tool.search', 'Search code'),
      read_file: t('agent.tool.read', 'Read file'), read_files: t('agent.tool.readMulti', 'Read files'),
      create_file: t('agent.tool.create', 'Create file'), write_file: t('agent.tool.write', 'Edit file'),
      edit_file: t('agent.tool.editFile', 'Edit part of file'), write_files: t('agent.tool.writeMulti', 'Write files'),
      delete_file: t('agent.tool.delFile', 'Delete file'), delete_files: t('agent.tool.delFilesMulti', 'Delete files'),
      create_directory: t('agent.tool.mkdir', 'Create folder'), create_directories: t('agent.tool.mkdirMulti', 'Create folders'),
      delete_directory: t('agent.tool.rmdir', 'Delete folder'), delete_directories: t('agent.tool.rmdirMulti', 'Delete folders'),
      move_file: t('agent.tool.move', 'Move / rename'), replace_in_files: t('agent.tool.replaceMulti', 'Replace in files'),
      copy_file: t('agent.tool.copy', 'Copy'), copy_files: t('agent.tool.copyMulti', 'Copy files'),
      web_search: t('agent.tool.webSearch', 'Web search'), fetch_url: t('agent.tool.fetchUrl', 'Fetch webpage'),
      run_command: t('agent.tool.runCommand', 'Run command'),
    };
    return LABELS[name] || name;
  }
  function statusText(status) {
    const TEXT = {
      running: '⏳', pending: '⏳ ' + t('agent.waitingConfirm', 'waiting for confirmation'),
      done: '✅', rejected: '🚫 ' + t('agent.rejectedShort', 'rejected'),
      error: '❌ ' + t('agent.errorShort', 'error'), simulated: '🧪 ' + t('agent.simulatedShort', 'simulated'),
    };
    return TEXT[status] || '';
  }
  // Compact "what is this step about" label used both in the confirm bar
  // and the step summary line — handles single paths, move's from→to, and
  // the batch tools' paths[]/files[] arrays (shown as a short list, or a
  // count once there are too many to usefully list).
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

  // ── Tool schema (OpenAI-style function calling) ───────────────────
  // Tool names/descriptions/parameter docs below are sent to the MODEL as
  // part of the function-calling schema, not shown as UI text — kept in
  // English on purpose, same rationale as systemPrompt() above.
  function toolSchema(folder) {
    const tools = [
      { type: 'function', function: { name: 'list_files', description: 'Recursively lists files in the project (optionally below a subfolder), including file size in bytes. Optionally filter by a glob pattern (e.g. "*.tmp", "**/*.md") so you don\'t have to scan the whole tree yourself when you only care about a subset of files — e.g. before a bulk operation like "delete all .tmp files".', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Subfolder relative to the project root. Leave empty for the whole project.' }, pattern: { type: 'string', description: 'Optional glob pattern to filter results, e.g. "*.log" or "src/**/*.ts". "*" matches within a path segment, "**" matches across folders.' } } } } },
      { type: 'function', function: { name: 'search_in_files', description: 'Searches all text files in the project (like grep) for a term or regular expression and returns matches with file, line number, and line content. Useful for finding functions, variables, or text across the whole codebase before reading files individually. To search or read ONE SPECIFIC FILE you already know the name of, use read_file instead — do not put a filename in this tool\'s `path` parameter (see below).', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search term or (if regex=true) regular expression.' }, path: { type: 'string', description: 'Optional: restrict the search to a SUBFOLDER, given as a path relative to the project root (e.g. "src/utils") — never an absolute path, "..", or the project\'s own folder name prefixed on top (paths from list_files/search_in_files results are already relative to the root; use them as-is). This must be a FOLDER, never a filename (e.g. "config.js" is invalid here) — if you already know which single file to look at, call read_file with that path instead of putting the filename here. Omit `path` entirely to search the whole project.' }, regex: { type: 'boolean', description: 'true = interpret query as a regular expression.' }, caseSensitive: { type: 'boolean', description: 'true = match case exactly.' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_file', description: 'Reads the text content of a file in the project. For large files, pass startLine/endLine to read just a range instead of the whole thing — much cheaper than pulling in a huge file when you only need one section.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to the project root, e.g. "src/main.py"' }, startLine: { type: 'integer', description: 'Optional 1-based first line to include.' }, endLine: { type: 'integer', description: 'Optional 1-based last line to include (inclusive).' } }, required: ['path'] } } },
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
  // input_schema instead of OpenAI's nested function object) — used when
  // the header's currently selected model belongs to an Anthropic provider,
  // since Anthropic's Messages API doesn't speak the OpenAI-compatible
  // /chat/completions format the other providers use.
  function toolSchemaAnthropic(folder) {
    return toolSchema(folder).map(f => ({ name: f.function.name, description: f.function.description, input_schema: f.function.parameters }));
  }
  // This is the instruction sent to the MODEL, not text shown in the UI —
  // it is deliberately always in English regardless of the UI language,
  // since it's an internal system prompt for the AI, not a translated
  // interface string. The UI language only affects what the person and the
  // agent's tool traces show, not the language KI Connect talks to the model in.
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

  // The active chat profile's custom system prompt (persona/tone, set in
  // the Profile panel) used to have NO effect at all in the project/agent
  // mode — systemPrompt() above only ever sent its own hard-coded
  // tool-behavior rules, silently ignoring whatever profile the person had
  // selected. This appends the profile's prompt (if any) as an additional
  // layer AFTER the agent's own rules, so it still reads as "how to behave/
  // what tone to use" on top of "how to use these tools", rather than
  // fighting it or replacing it. If no profile is active, or its prompt is
  // empty, this contributes nothing. (Temperature from the same profile
  // already applies automatically — callModel() below reads `config.temperature`,
  // which applyProfile() in the main app already keeps in sync.)
  function profileAddendum() {
    const p = (typeof activeProfile === 'function') ? activeProfile() : null;
    const text = p && p.systemPrompt ? String(p.systemPrompt).trim() : '';
    return text ? `\n\nAdditionally, follow this persona/style guidance for how you communicate: ${text}` : '';
  }

  // ── Backend calls: /agent/* on the local proxy ─────────────────────
  // Every /agent/* call goes through this wrapper instead of raw fetch()
  // so it always carries the current agent-session token (see
  // kiconnect.js: unlockAgentSession() / agentSessionHeader()). The
  // project registry only exists encrypted at rest — without this token
  // the proxy can't decrypt it and answers 401, which we treat as "the
  // session is gone" (e.g. proxy restarted) and send the user back to
  // the login screen to re-establish it, same as any other expired session.
  /* global agentSessionHeader, logoutNow, toast */
  async function agentFetch(url, opts) {
    opts = opts || {};
    const headers = { ...(opts.headers || {}), ...(typeof agentSessionHeader === 'function' ? agentSessionHeader() : {}) };
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      if (typeof toast === 'function') toast(t('agent.err.sessionExpired', '🔒 Session expired — please log in again.'));
      if (typeof logoutNow === 'function') logoutNow();
    }
    return res;
  }
  function encPath(p) {
    return String(p).replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }
  async function apiListProjects() {
    const res = await agentFetch('/agent/projects');
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return (await res.json()).projects || [];
  }
  async function apiBrowse(path) {
    const res = await agentFetch('/agent/browse' + (path ? `?path=${encodeURIComponent(path)}` : ''));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function apiCreateProject(name, path, create) {
    const res = await agentFetch('/agent/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, path, create: !!create }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  async function apiDeleteProject(name) {
    const res = await agentFetch(`/agent/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
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
    const res = await agentFetch(`/agent/search/${encodeURIComponent(project)}?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  async function apiReadFile(project, path) {
    const res = await agentFetch(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`);
    if (res.status === 404) return { error: t('agent.err.fileNotFound', 'File not found.') };
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }
  async function apiWriteFile(project, path, content, createOnly) {
    const res = await agentFetch(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, createOnly: !!createOnly }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  async function apiDeleteFile(project, path) {
    const res = await agentFetch(`/agent/file/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  async function apiMkdir(project, path) {
    const res = await agentFetch(`/agent/dir/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  async function apiRmdir(project, path) {
    const res = await agentFetch(`/agent/dir/${encodeURIComponent(project)}/${encPath(path)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  // Moves/renames a file or folder server-side — no content ever passes
  // through the model's context, unlike a read+create+delete round trip.
  async function apiMove(project, from, to, overwrite) {
    const res = await agentFetch(`/agent/move/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, overwrite: !!overwrite }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  // Copies a file or folder server-side (recursively for folders) — no
  // content ever passes through the model's context, unlike a
  // read+create round trip, and — unlike apiMove — the original at
  // `from` is left untouched. Requires a matching /agent/copy/<project>
  // route on the local proxy (kiconnect-proxy.py); see that file for the
  // handler paired with this call (same shape as the existing move route,
  // just copying instead of renaming on disk, e.g. shutil.copy2 /
  // shutil.copytree in Python, recursive so it works for folders too).
  async function apiCopy(project, from, to, overwrite) {
    const res = await agentFetch(`/agent/copy/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, overwrite: !!overwrite }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  // Runs a shell command in the project folder via the proxy's sandboxed
  // /agent/exec/<id> endpoint (see kiconnect-proxy.py for the actual
  // sandboxing: resource limits, minimal env, best-effort network
  // isolation). Only reachable when the project has shell execution
  // enabled — the backend re-checks that flag independently either way.
  async function apiExec(project, command, cwd) {
    const res = await agentFetch(`/agent/exec/${encodeURIComponent(project)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, cwd }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `HTTP ${res.status}` };
    return data;
  }
  async function apiSetShellEnabled(project, enabled) {
    const res = await agentFetch(`/agent/projects/${encodeURIComponent(project)}/shell`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !!enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  // Re-points an already-registered project at a different real folder
  // (see agentSetProjectPath() below for the UI side) — lets the target
  // folder be changed after creation instead of only being settable once
  // when the project was first registered.
  async function apiSetProjectPath(project, path, create) {
    const res = await agentFetch(`/agent/projects/${encodeURIComponent(project)}/path`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, create: !!create }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // Minimal glob matcher for list_files' `pattern` filter: "*" matches
  // within a path segment, "**" matches across segments (incl. "/"), "?"
  // matches a single character. Intentionally small — just enough for
  // "*.tmp" / "**/*.md" style filters, not a full glob implementation.
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

  // Flags paths like "test/test/..." or "src/src/..." — a folder segment
  // immediately repeating its own parent's name. This is almost always an
  // accidental self-nesting mistake (e.g. a model re-creating the project's
  // own folder name one level too deep) rather than something intentional,
  // so mutating tools attach a warning the model sees in its tool result
  // and can self-correct on, instead of silently nesting further each turn.
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

  // Detects a write_file/write_files call that would blow away more than
  // half of an existing, non-trivial file's content. This is the guard
  // against a specific, observed failure mode: a weak/small model reads a
  // large file, but only the first slice of that content ever survives
  // into the model's OWN context (see serializeToolResult()'s per-field
  // truncation below — tool results are size-capped before being replayed
  // back into history on the next loop iteration). The model has no way to
  // know its view was incomplete, so if it later calls write_file "to save
  // its changes", it silently overwrites the real file with just the
  // partial content it happened to see — destroying the rest. Compares
  // against the file's CURRENT size from the tree listing (cheap, no
  // content read) rather than trusting anything the model believes about
  // the file's size.
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

  // Reads the current file, applies one or more exact-text replacements in
  // order, and writes the result back in a single round trip — shared by
  // edit_file's classic single old_str/new_str form and its optional
  // `edits` array form (several changes to the same file in one call and
  // one confirmation, instead of one edit_file call per change).
  async function applyEditFile(project, args) {
    if (!args.path) return { error: t('agent.err.missingPath', 'missing path') };
    const edits = Array.isArray(args.edits) && args.edits.length
      ? args.edits
      : [{ old_str: args.old_str, new_str: args.new_str }];
    if (!edits.length || edits.some(e => !e || typeof e.old_str !== 'string' || !e.old_str)) {
      return { error: t('agent.err.missingOldStr', 'missing old_str') };
    }
    const res = await apiReadFile(project, args.path);
    if (res.error) return res;
    if (res.binary || typeof res.content !== 'string') return { error: t('agent.err.binaryEdit', 'Cannot edit a binary file.') };
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

  // Applies one find→replace across several files in a single call and a
  // single confirmation — e.g. renaming a symbol project-wide — instead
  // of one read_file + one edit_file round trip per affected file. Meant
  // to be used after search_in_files/list_files already narrowed down
  // which paths are affected.
  async function applyReplaceInFiles(project, args) {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    if (!paths.length) return { error: t('agent.err.missingPaths', 'missing paths') };
    if (!args.find) return { error: t('agent.err.missingQuery', 'missing query') };
    const re = args.regex ? new RegExp(args.find, 'g') : null;
    const results = [];
    for (const p of paths) {
      const res = await apiReadFile(project, p);
      if (res.error) { results.push({ path: p, error: res.error }); continue; }
      if (res.binary || typeof res.content !== 'string') { results.push({ path: p, error: t('agent.err.binaryEdit', 'Cannot edit a binary file.') }); continue; }
      const count = re ? (res.content.match(re) || []).length : res.content.split(args.find).length - 1;
      if (!count) { results.push({ path: p, changed: false }); continue; }
      const next = re ? res.content.replace(re, args.replace ?? '') : res.content.split(args.find).join(args.replace ?? '');
      const writeRes = await apiWriteFile(project, p, next, false);
      results.push({ path: p, occurrences: count, ...writeRes });
    }
    return { files: results };
  }

  // ── Tool execution (respects autonomy mode) ────────────────────────
  async function executeTool(name, args, project, autonomy, step) {
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
      if (!args.query) return { error: t('agent.err.missingQuery', 'missing query') };
      return apiSearch(project, args.query, { regex: args.regex, caseSensitive: args.caseSensitive, path: args.path });
    }
    if (name === 'read_file') {
      if (!args.path) return { error: t('agent.err.missingPath', 'missing path') };
      const res = await apiReadFile(project, args.path);
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
      if (!paths.length) return { error: t('agent.err.missingPaths', 'missing paths') };
      const files = [];
      for (const p of paths) files.push({ path: p, ...(await apiReadFile(project, p)) });
      return { files };
    }
    if (name === 'web_search') {
      if (!args.query) return { error: t('agent.err.missingQuery', 'missing query') };
      try {
        const data = await performWebSearch(args.query);
        return data || { results: [] };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'fetch_url') {
      if (!args.url) return { error: t('agent.err.missingUrl', 'missing url') };
      try { return await fetchLinkedPage(args.url); }
      catch (err) { return { error: err.message }; }
    }

    // A risky overwrite forces the same confirm step everything already
    // goes through in "Confirm" mode, regardless of the project's actual
    // autonomy setting — silently applying it in "Autonomous" mode could
    // destroy data the model never fully had in view (see shrinkRisk()).
    // Skipped entirely in "Simulate" mode since nothing is written there.
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
      rerenderCurrentRun();
      const ok = await waitForConfirmationBar(step);
      if (!ok) return { rejected: true, message: t('agent.err.rejectedByUser', 'Rejected by user — no change made.') };
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

    if (name === 'create_file') return withNestWarning(args.path, await apiWriteFile(project, args.path, args.content ?? '', true));
    if (name === 'write_file') return mergeWarnings(withNestWarning(args.path, await apiWriteFile(project, args.path, args.content ?? '', false)), riskWarning);
    if (name === 'delete_file') return apiDeleteFile(project, args.path);
    if (name === 'create_directory') return withNestWarning(args.path, await apiMkdir(project, args.path));
    if (name === 'delete_directory') return apiRmdir(project, args.path);
    if (name === 'edit_file') return applyEditFile(project, args);
    if (name === 'move_file') {
      if (!args.from || !args.to) return { error: t('agent.err.missingPath', 'missing path') };
      return withNestWarning(args.to, await apiMove(project, args.from, args.to, args.overwrite));
    }
    if (name === 'copy_file') {
      if (!args.from || !args.to) return { error: t('agent.err.missingPath', 'missing path') };
      return withNestWarning(args.to, await apiCopy(project, args.from, args.to, args.overwrite));
    }
    if (name === 'copy_files') {
      const items = Array.isArray(args.items) ? args.items : [];
      if (!items.length) return { error: t('agent.err.missingFiles', 'missing files') };
      const results = [];
      for (const it of items) {
        if (!it || !it.from || !it.to) { results.push({ path: it && it.to, error: t('agent.err.missingPath', 'missing path') }); continue; }
        results.push({ path: it.to, ...withNestWarning(it.to, await apiCopy(project, it.from, it.to, it.overwrite)) });
      }
      return { files: results };
    }
    if (name === 'replace_in_files') return applyReplaceInFiles(project, args);
    if (name === 'run_command') {
      if (!args.command) return { error: t('agent.err.missingCommand', 'missing command') };
      return apiExec(project, args.command, args.cwd);
    }
    if (name === 'write_files') {
      const files = Array.isArray(args.files) ? args.files : [];
      if (!files.length) return { error: t('agent.err.missingFiles', 'missing files') };
      const results = [];
      for (const f of files) {
        const r = withNestWarning(f && f.path, await apiWriteFile(project, f && f.path, (f && f.content) ?? '', !!(f && f.createOnly)));
        results.push({ path: f && f.path, ...mergeWarnings(r, riskyFileMsgs && riskyFileMsgs.get(f && f.path)) });
      }
      return { files: results };
    }
    if (name === 'delete_files') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths', 'missing paths') };
      const results = [];
      for (const p of paths) results.push({ path: p, ...(await apiDeleteFile(project, p)) });
      return { files: results };
    }
    if (name === 'create_directories') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths', 'missing paths') };
      const results = [];
      for (const p of paths) results.push({ path: p, ...withNestWarning(p, await apiMkdir(project, p)) });
      return { files: results };
    }
    if (name === 'delete_directories') {
      const paths = Array.isArray(args.paths) ? args.paths : [];
      if (!paths.length) return { error: t('agent.err.missingPaths', 'missing paths') };
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
  function stopAgent() {
    if (abortController) abortController.abort();
    hideConfirmBar();
  }

  // ── Chat-completion call ────────────────────────────────────────
  // `history` is a provider-neutral turn list (see runAgentChatTurn):
  //   {role:'system', text} | {role:'user', text} |
  //   {role:'assistant', text, toolCalls:[{id,name,arguments}]} |
  //   {role:'tool_results', results:[{id,name,result}]}
  // callModel() translates it into whichever wire format `provider` needs,
  // and normalizes the reply back to {text, toolCalls}. This is also where
  // the header's thinking/reasoning-effort setting is applied — reusing
  // the exact same helpers (isThinkingCapable, OAI_EFFORT, CLAUDE_BUDGET,
  // isAdaptiveThinkingModel, usesTokenBudget, effectiveMaxTokens,
  // isTemperatureSupported) the normal chat path already uses, so nothing
  // agent-specific has to be re-implemented — it's the SAME model with the
  // SAME thinking settings as whatever is picked in the header.
  // Turns a tool result into the JSON string sent back to the model as a
  // tool_result. THIS USED TO simply do
  // `JSON.stringify(result).slice(0, 8000)` — cutting the finished JSON
  // string at a fixed character count. For a large file (read_file,
  // read_files) or a chatty command (run_command), that has two bad
  // effects: (1) it slices mid-string/mid-token, so the tail is often
  // invalid JSON the model has to guess at, and (2) there is no signal
  // anywhere that anything was cut — the model has no way to know its
  // view of the file is incomplete. If it then calls write_file "to save
  // its edit", it silently overwrites the real file with just the partial
  // content it happened to see, destroying the rest (this is exactly what
  // happened with a large i18n file in testing — see shrinkRisk() above
  // for the corresponding write-side guard).
  // Fix: truncate long STRING FIELDS individually, each with an explicit
  // "…N more characters not shown" marker, THEN serialize — so the
  // result is always valid JSON and the model is told when it's looking
  // at a partial view instead of silently assuming it has everything.
  const TOOL_RESULT_FIELD_LIMIT = 20000; // per individual long string field (e.g. file content)
  const TOOL_RESULT_TOTAL_LIMIT = 24000; // hard ceiling on the final serialized result, just in case
  function truncateLongStrings(value) {
    if (typeof value === 'string') {
      if (value.length <= TOOL_RESULT_FIELD_LIMIT) return value;
      const cut = value.length - TOOL_RESULT_FIELD_LIMIT;
      return value.slice(0, TOOL_RESULT_FIELD_LIMIT) + `\n…[${t('agent.truncated', '(truncated)')}: ${cut} ${t('agent.moreCharsNotShown', 'more characters not shown')}]`;
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
    // small fields) — per-field truncation above means this should
    // essentially never actually trigger.
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
            // Gemini 2.5+/3.x require each function call to carry back the
            // exact thought_signature it was originally issued with, or the
            // *next* turn is rejected with 400 "Function call is missing a
            // thought_signature..." (this happens even when the "thinking"
            // toggle here is off — recent Gemini models reason internally
            // regardless). We stash the signature on the tool-call object
            // as soon as we see it (see callModel below) and echo it back
            // here. Calls we invented ourselves (the JSON-in-text fallback
            // path a few lines down) were never signed by Gemini, so there's
            // nothing real to echo — send Google's documented bypass
            // sentinel instead so the conversation isn't permanently stuck.
            ...(c._thoughtSig ? { extra_content: { google: { thought_signature: c._thoughtSig } } } : {}),
          })) : undefined,
        });
      } else if (h.role === 'tool_results') {
        h.results.forEach(r => out.push({ role: 'tool', tool_call_id: r.id, content: serializeToolResult(r.result) }));
      }
    });
    return out;
  }
  async function callModel(history, provider, folder) {
    if (!provider) throw new Error(t('agent.noModelHdr', 'Please select an AI/model in the header (top left).'));
    if (!provider.apiKey) throw new Error(t('agent.err.noApiKey', 'The selected provider has no API key.'));
    if (provider.enabled === false) throw new Error(t('agent.err.providerDisabled', 'The selected provider is disabled.'));
    const modelId = splitModelId(config.model).modelId;
    const signal = abortController ? abortController.signal : undefined;

    if (provider.type === 'anthropic') {
      const { system, messages } = toAnthropicHistory(history);
      // Cache breakpoints on the tool schema and system prompt: both are
      // byte-identical on every iteration of a turn's tool loop (only the
      // growing message history changes), so marking them `ephemeral`
      // lets Anthropic serve them from cache on every follow-up call in
      // the same turn instead of being billed/processed as fresh input —
      // real savings once a task needs several tool round-trips.
      const toolsForModel = toolSchemaAnthropic(folder);
      if (toolsForModel.length) toolsForModel[toolsForModel.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
      // Second cache breakpoint on the message history itself. Without this,
      // only the tool schema/system prompt were ever cached — every follow-up
      // call in a multi-step tool loop re-sent (and re-billed/re-processed as
      // brand-new input) the ENTIRE growing history, including any large
      // tool_result content like a big file's text (e.g. read_file on a
      // 600KB file). Anthropic allows up to 4 cache_control breakpoints per
      // request; placing one on the last content block of the last message
      // lets every prior message up to that point be served from cache on
      // the next iteration — only the newest tool_result(s) are billed as
      // fresh input. This is what actually made a simple "read this file,
      // split it up" task cost ~1.4M tokens: each of the N follow-up calls
      // reprocessed the whole file from scratch instead of reading it from
      // cache once.
      if (messages.length) {
        const lastMsg = messages[messages.length - 1];
        if (Array.isArray(lastMsg.content) && lastMsg.content.length) {
          lastMsg.content[lastMsg.content.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
        } else if (typeof lastMsg.content === 'string' && lastMsg.content) {
          // Anthropic requires content to be an array of blocks for
          // cache_control to attach — wrap a bare string into a single
          // text block instead of leaving it as a plain string.
          lastMsg.content = [{ type: 'text', text: lastMsg.content, cache_control: { type: 'ephemeral', ttl: '1h' } }];
        }
      }
      const body = { model: modelId, max_tokens: effectiveMaxTokens(), messages, tools: toolsForModel };
      if (system) body.system = [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }];
      // Native server-side context management (beta) — complements, doesn't
      // replace, compactOldToolResults() above (which is skipped for
      // Anthropic; see there). This clears old tool RESULTS server-side,
      // AFTER the cache-prefix lookup, so it doesn't bust the prompt cache
      // the way a client-side edit would. It only kicks in once a request's
      // input actually exceeds the token trigger below — harmless/no-op
      // otherwise. This is a beta API and its shape may change; if
      // Anthropic ever renames/removes it, the worst case is a 400 error
      // surfaced to the user, not silent data loss (nothing here changes
      // what's stored locally, only what's sent to the model).
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
          // prompt-caching-2024-07-31 is no longer needed — caching (incl.
          // ttl:'1h') is GA and works without a beta header. context-
          // management-2025-06-27 opts into the context_management field above.
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
      // MiniMax has no reasoning_effort levels — on/off only, and thinking
      // is on by default anyway (M2.x can't be disabled). The agent path
      // doesn't surface the reasoning trace in its UI, so no reasoning_split
      // is needed here (unlike the streaming chat path).
      else if (provider.type === 'minimax') reqBody.thinking = { type: 'adaptive' };
      // Mistral only documents 'none'/'high' (root-level field) — the
      // low/medium/high OAI_EFFORT mapping doesn't apply. Native Magistral
      // models always reason and take no parameter (handled by the
      // isThinkingCapable/isMistralAdjustableThinkingModel check below).
      else if (provider.type === 'mistral') {
        if (isMistralAdjustableThinkingModel(modelId)) reqBody.reasoning_effort = 'high';
        else delete reqBody.reasoning_effort;
      }
      else reqBody.reasoning_effort = OAI_EFFORT[config.thinkingIntensity || 2];
    } else if (provider.type === 'mistral' && isMistralNativeThinkingModel(modelId)) {
      // Native Magistral always reasons regardless of the thinkingEnabled
      // toggle — no parameter to send either way, just don't leave a stray
      // reasoning_effort field on the request.
      delete reqBody.reasoning_effort;
    }
    const extraHeaders = {};
    if (provider.type === 'openrouter') { extraHeaders['HTTP-Referer'] = window.location.origin; extraHeaders['X-Title'] = 'KI Connect NRW'; }
    if (provider.type === 'zhipu') extraHeaders['Accept-Language'] = 'en-US,en';
    const res = await fetch(proxyUrl(`${endpoint}/chat/completions`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}`, ...extraHeaders },
      body: JSON.stringify(reqBody), signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    const msg = data.choices && data.choices[0] && data.choices[0].message;
    if (!msg) throw new Error(t('agent.err.invalidModelResponse', 'Invalid response from the model.'));
    let toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map(tc => ({
          id: tc.id, name: tc.function?.name, arguments: safeParseJson(tc.function?.arguments),
          // See toOpenAIHistory() above for why this is captured/echoed.
          _thoughtSig: tc.extra_content?.google?.thought_signature,
        }))
      : [];
    // Mistral reasoning models (native Magistral, or adjustable models with
    // reasoning_effort:'high') return `content` as a list of {type:'thinking'
    // |'text'} chunks instead of a plain string — extract just the answer
    // text; the agent trace view doesn't currently surface the reasoning
    // part separately here (unlike the streaming chat path).
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
          // Never actually signed by Gemini (we built this call ourselves
          // from raw text) — use Google's documented bypass value so the
          // next turn doesn't get rejected for a missing signature.
          _thoughtSig: provider.type === 'google' ? 'skip_thought_signature_validator' : undefined,
        }];
        text = '';
      }
    }
    // Normalize OpenAI's field names (prompt_tokens/completion_tokens) to the
    // same shape buildTokenBadge()/the Anthropic path use — same conversion
    // the normal streaming chat path already applies.
    const usage = data.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
      cache_read_input_tokens: data.usage.prompt_tokens_details?.cached_tokens || 0,
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

  // ── Rendering a run as collapsed <details> cards inside a chat bubble ──
  // (formatText() — the app's own markdown/code/DOMPurify pipeline — is
  // reused so this renders identically live and after reload; DOMPurify's
  // config already allows <details>/<summary>, and code fences inside are
  // extracted into the app's normal collapsible/copyable code blocks.)
  let _liveBubble = null, _liveSteps = null;
  function rerenderCurrentRun() {
    if (!_liveBubble || !_liveSteps) return;
    // formatText() rebuilds the whole trace from scratch on every call (a
    // new/updated step, a status change, ...), which would otherwise wipe
    // out any <details> the user manually expanded/collapsed to follow
    // along while the run is still going. Tool steps only ever get
    // appended, never reordered or removed, so the Nth <details.agent-trace>
    // before the rebuild is still the Nth one after — capture open states
    // by position and reapply them once the new DOM is in place.
    const openStates = Array.from(_liveBubble.querySelectorAll('details.agent-trace')).map(d => d.open);
    _liveBubble.innerHTML = formatText(renderRunMarkdown(_liveSteps)) || '<p>…</p>';
    _liveBubble.querySelectorAll('details.agent-trace').forEach((d, i) => { if (openStates[i]) d.open = true; });
    typesetMath(_liveBubble);
    // Only follow the run to the bottom if the user hasn't scrolled away
    // (pinnedToBottom, tracked in kiconnect.js) — e.g. scrolled up to
    // reread an earlier step while later ones are still running.
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
  function buildToolBody(step) {
    const { name, args, result } = step;
    const lines = [];
    const truncNote = () => '\n… ' + t('agent.truncated', '(truncated)');
    if (name === 'list_files') {
      if (result && Array.isArray(result.files)) {
        lines.push('```text');
        lines.push(result.files.length ? result.files.map(f => `${f.path}  (${f.size} B)`).join('\n') : `(${t('agent.empty', 'empty')})`);
        lines.push('```');
      }
    } else if (name === 'search_in_files') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.matches)) {
          lines.push('```text');
          lines.push(result.matches.length
            ? result.matches.map(m => `${m.path}:${m.line}: ${m.text}`).join('\n') + (result.truncated ? truncNote() : '')
            : `(${t('agent.noMatches', 'no matches')})`);
          lines.push('```');
        }
      }
    } else if (name === 'web_search') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.results)) {
          lines.push(result.results.length
            ? result.results.map(r => `- [${r.title}](${r.url})  \n  ${r.snippet || ''}`).join('\n')
            : `_(${t('agent.noMatches', 'no matches')})_`);
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
        else if (result.binary) lines.push(`_(${t('agent.binaryFile', 'binary file – no text preview available')})_`);
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
          else if (f.binary) lines.push(`_(${t('agent.binaryFile', 'binary file – no text preview available')})_`);
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
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else if (typeof result.bytes === 'number') lines.push(`✅ ${tf('agent.bytesSaved', { bytes: result.bytes })}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    } else if (name === 'edit_file') {
      const edits = Array.isArray(args.edits) && args.edits.length ? args.edits : [{ old_str: args.old_str, new_str: args.new_str }];
      edits.forEach(e => {
        lines.push('```diff');
        lines.push(`- ${(e.old_str || '').split('\n').join('\n- ')}`);
        lines.push(`+ ${(e.new_str || '').split('\n').join('\n+ ')}`);
        lines.push('```');
      });
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else if (typeof result.bytes === 'number') lines.push(`✅ ${tf('agent.bytesSaved', { bytes: result.bytes })}`);
      }
    } else if (name === 'replace_in_files') {
      lines.push(`\`${esc(args.find || '')}\` → \`${esc(args.replace || '')}\``);
      const items = (result && Array.isArray(result.files)) ? result.files : [];
      if (!items.length && result && result.error) lines.push(`❌ ${result.error}`);
      items.forEach(it => {
        let mark = it.changed === false ? `(${t('agent.noMatches', 'no matches')})` : '✅';
        if (it.error) mark = `❌ ${it.error}`;
        else if (it.simulated) mark = `🧪 ${it.message}`;
        else if (typeof it.occurrences === 'number' && it.occurrences) mark = `✅ ${tf('agent.nOccurrences', { n: it.occurrences })}`;
        lines.push(`- \`${esc(it.path)}\` ${mark}`);
      });
    } else if (name === 'move_file') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else lines.push(`✅ ${t('agent.done', 'done.')}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    } else if (name === 'copy_file') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else lines.push(`✅ ${t('agent.done', 'done.')}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    } else if (name === 'copy_files') {
      const items = (result && Array.isArray(result.files)) ? result.files : [];
      if (!items.length && result && result.error) lines.push(`❌ ${result.error}`);
      items.forEach(it => {
        let mark = '✅';
        if (it.error) mark = `❌ ${it.error}`;
        else if (it.simulated) mark = `🧪 ${it.message}`;
        else if (it.rejected) mark = `🚫 ${it.message}`;
        if (it.warning) mark += ` ⚠️ ${esc(it.warning)}`;
        lines.push(`- \`${esc(it.path)}\` ${mark}`);
      });
    } else if (name === 'write_files' || name === 'delete_files' || name === 'create_directories' || name === 'delete_directories') {
      const items = (result && Array.isArray(result.files)) ? result.files : [];
      if (!items.length && result && result.error) lines.push(`❌ ${result.error}`);
      items.forEach(it => {
        let mark = '✅';
        if (it.error) mark = `❌ ${it.error}`;
        else if (it.simulated) mark = `🧪 ${it.message}`;
        else if (it.rejected) mark = `🚫 ${it.message}`;
        if (it.warning) mark += ` ⚠️ ${esc(it.warning)}`;
        lines.push(`- \`${esc(it.path)}\` ${mark}`);
      });
    } else if (name === 'run_command') {
      lines.push('```bash'); lines.push(args.command || ''); lines.push('```');
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else {
          lines.push(`**${t('agent.exitCode', 'exit code')}:** ${result.exitCode ?? '—'}` + (result.timedOut ? ` ⏱ ${t('agent.timedOut', 'timed out')}` : ''));
          if (result.stdout) { lines.push('```text'); lines.push(result.stdout.length > 3000 ? result.stdout.slice(0, 3000) + truncNote() : result.stdout); lines.push('```'); }
          if (result.stderr) { lines.push('```text'); lines.push(result.stderr.length > 2000 ? result.stderr.slice(0, 2000) + truncNote() : result.stderr); lines.push('```'); }
        }
      }
    } else if (name === 'delete_file' || name === 'delete_directory' || name === 'create_directory') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.simulated) lines.push(`🧪 ${result.message}`);
        else if (result.rejected) lines.push(`🚫 ${result.message}`);
        else lines.push(`✅ ${t('agent.done', 'done.')}`);
        if (result.warning) lines.push(`⚠️ ${esc(result.warning)}`);
      }
    }
    return lines.join('\n');
  }

  // ── Main agent turn — runs inside the normal chat flow ────────────
  // Turns a stored message (user or assistant, from normal chat OR a past
  // agent run) into plain context text for the next model call. Agent
  // replies store their spoken text separately in `_agentText` (see the
  // `finally` block below) so past tool-call traces (HTML <details> cards)
  // never get replayed into context — only what the AI actually said.
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
    if (running) { showToast(t('agent.stillRunning', 'The agent is still working — please wait or stop it.')); return; }
    let chat = currentChat();
    if (!chat) { newChat(folder.id); chat = currentChat(); }

    // Snapshot the conversation so far, BEFORE adding the new user message,
    // and turn it into context for the model — this is what was missing:
    // every message used to start a brand new, memory-less run.
    const priorHistory = buildPriorHistory(chat);

    // Same attachment → content-block conversion normal chat uses (images,
    // base64/text-mode PDFs, text files) — see buildAttachmentContent() in
    // kiconnect.js. Previously this whole module only ever read the typed
    // text and silently dropped any attached files.
    const { userContent, fileNames } = buildAttachmentContent(task, att || []);

    const container = getActiveContainer(chat);
    const userMsg = { role: 'user', content: userContent, _files: fileNames.length ? fileNames : undefined };
    container.push(userMsg);
    // Same auto-title flow as normal chat (host app's autoGenerateChatTitle):
    // placeholder immediately, then replaced by a real AI-generated title in
    // the background. Previously this just hard-truncated the raw task text
    // instead — inconsistent with, and much worse than, normal chat's titles.
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
  // (and anything after it) and re-run the SAME agent loop for the SAME
  // preceding user message — reusing runAgentCompletion() below just like
  // a normal send does, so the "Regenerieren" button works the same way
  // it does for normal chat instead of silently falling back to a plain,
  // tool-less completion.
  async function agentRegenerate(idx) {
    const chat = currentChat(); if (!chat) return;
    const folder = folders.find(f => f.id === chat.folderId);
    if (!folder || !folder.agentProject) return false;
    if (running) { showToast(t('agent.stillRunning', 'The agent is still working — please wait or stop it.')); return true; }
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
        // Past user turns that had attachments (images/PDFs) store their content
        // as an array (see runAgentChatTurn) — keep it so toAnthropicHistory/
        // toOpenAIHistory can resend the actual file, not just its text parts.
        if (m.role === 'user' && Array.isArray(m.content)) h.content = m.content;
        return h;
      });
  }

  // The actual model/tool loop — appends the live AI bubble, drives
  // callModel()+executeTool() until a final text-only reply, then saves
  // and upgrades the bubble into its full interactive form. Shared by a
  // normal send (runAgentChatTurn) and a regenerate (agentRegenerate).
  async function runAgentCompletion(chat, folder, container, priorHistory, task, content) {
    if (!folder.agentAutonomy) folder.agentAutonomy = 'confirm';
    const provider = providerForModel(config.model);
    if (!provider) {
      showToast(t('agent.noModelHdr', 'Please select an AI/model in the header (top left).'));
      return;
    }
    running = true;
    abortController = new AbortController();
    setComposerRunningUI(true);

    // Same model badge as any normal reply — it's literally the same
    // header selection, so this is never out of sync.
    const aiRow = appendEmptyAI();
    const bubble = aiRow.querySelector('.bubble');
    const steps = [];
    _liveBubble = bubble; _liveSteps = steps;
    rerenderCurrentRun();

    let history = [
      { role: 'system', text: systemPrompt(folder.name) },
      ...priorHistory,
      Array.isArray(content) ? { role: 'user', text: task, content } : { role: 'user', text: task },
    ];

    let iterations = 0, aborted = false;
    // A single agent "turn" can involve several model calls (one per
    // tool-use round-trip) — sum them so the badge on the finished bubble
    // reflects everything that turn actually cost, not just the last call.
    const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let sawUsage = false;
    try {
      while (iterations < MAX_ITERATIONS) {
        iterations++;
        // See KEEP_RECENT_TOOL_TURNS above — this is what stops
        // OpenAI-compatible providers (gpt-oss-120b, mistral-small, ...)
        // from resending every previously-read file/search-result on every
        // single iteration. Anthropic has its own cache-aware mechanisms
        // (prompt caching + optional native context_management below), so
        // it's skipped there to avoid needlessly busting the cache.
        if (provider.type !== 'anthropic') compactOldToolResults(history);
        let result;
        try { result = await callModel(history, provider, folder); }
        catch (err) {
          if (err.name === 'AbortError') { aborted = true; break; }
          steps.push({ kind: 'text', text: `❌ ${tf('agent.err.modelCallFailed', { error: esc(err.message) })}` });
          rerenderCurrentRun(); break;
        }
        if (result.usage) {
          sawUsage = true;
          totalUsage.input_tokens += result.usage.input_tokens || 0;
          totalUsage.output_tokens += result.usage.output_tokens || 0;
          totalUsage.cache_read_input_tokens += result.usage.cache_read_input_tokens || 0;
          totalUsage.cache_creation_input_tokens += result.usage.cache_creation_input_tokens || 0;
        }
        const toolCalls = result.toolCalls || [];
        if (result.text) {
          steps.push({ kind: 'text', text: result.text });
          rerenderCurrentRun();
        }
        history.push({ role: 'assistant', text: result.text || '', toolCalls });

        if (!toolCalls.length) break;

        const toolResults = [];
        for (const call of toolCalls) {
          if (abortController.signal.aborted) { aborted = true; break; }
          const step = { kind: 'tool', name: call.name, args: call.arguments || {}, status: 'running', result: null };
          steps.push(step); rerenderCurrentRun();
          let result2;
          try { result2 = await executeTool(call.name, call.arguments || {}, folder.agentProject, folder.agentAutonomy, step); }
          catch (err) { result2 = { error: err.message }; }
          step.result = result2 || {};
          if (step.result.error) step.status = 'error';
          else if (step.result.simulated) step.status = 'simulated';
          else if (step.result.rejected) step.status = 'rejected';
          else step.status = 'done';
          rerenderCurrentRun();
          toolResults.push({ id: call.id, name: call.name, args: call.arguments || {}, result: result2 });
        }
        history.push({ role: 'tool_results', results: toolResults });
        if (aborted) break;
      }
      if (iterations >= MAX_ITERATIONS) { steps.push({ kind: 'text', text: `⚠️ ${tf('agent.maxIterations', { n: MAX_ITERATIONS })}` }); rerenderCurrentRun(); }
      if (aborted) { steps.push({ kind: 'text', text: `⏹ ${t('agent.aborted', 'Stopped.')}` }); rerenderCurrentRun(); }
    } finally {
      bubble.classList.remove('streaming');
      const finalMd = renderRunMarkdown(steps);
      // Plain-text version (no tool-call HTML cards) — this is what's fed
      // back as context on the NEXT message in this chat (see
      // extractContextText() above), and also what a future agent run in
      // this chat will "remember" as this turn's reply.
      const contextText = steps.filter(s => s.kind === 'text').map(s => s.text).join('\n\n');
      const msgObj = { role: 'assistant', content: finalMd, _model: config.model, _agentText: contextText, _agentSteps: steps, _usage: sawUsage ? totalUsage : undefined };
      container.push(msgObj);
      save();

      // Upgrade the just-finished live bubble into its final interactive
      // form — same helper the normal streaming path uses, so agent
      // replies get exactly the same "attachments" under the bubble
      // (copy/edit/branch/regenerate/print/🔊/delete + note section)
      // instead of staying a bare, action-less placeholder.
      const path = getActivePath(chat);
      const idx = path.length - 1;
      if (!_finalizeAIRowInPlace(aiRow, path[idx], idx)) {
        const newRow = buildMsgEl(path[idx], idx);
        const messagesEl = document.getElementById('messages');
        if (aiRow && aiRow.parentNode) aiRow.parentNode.replaceChild(newRow, aiRow);
        else if (messagesEl) appendToMessages(newRow);
      }
      updateChatTokenTotal();

      running = false; abortController = null;
      _liveBubble = null; _liveSteps = null;
      setComposerRunningUI(false);
      hideConfirmBar();
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Project management (create / delete backend projects + folders)
  // ════════════════════════════════════════════════════════════════
  async function createProject(name, path, create) {
    name = (name || '').trim();
    if (!name || !path) return null;
    const reg = await apiCreateProject(name, path, create);
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
    try { await apiDeleteProject(folder.agentProject); } catch (e) { showToast(`❌ ${e.message}`); }
    // Deleting a project deletes its chats too (previously this only
    // unlinked them via c.folderId=null, leaving them behind as regular
    // chats — surprising given the confirm dialog said they'd be gone).
    chats = chats.filter(c => c.folderId !== folder.id);
    folders = folders.filter(f => f.id !== folder.id);
    if (typeof activeFolderId !== 'undefined' && activeFolderId === folder.id) activeFolderId = null;
    if (currentChatId && !chats.some(c => c.id === currentChatId)) {
      currentChatId = chats[0]?.id || null;
      if (currentChatId) renderMessages(currentChat().messages);
      else { const c = document.getElementById('messages'); c.innerHTML = ''; const e = document.getElementById('emptyState'); if (e) { c.appendChild(e); e.style.display = ''; } }
    }
    save(); renderSidebar();
    showToast(t('agent.projectDeleted', '🗑 Project and its chats removed (files remain on disk).'));
  }

  // Focuses a project for the composer: reuses the current chat if it's
  // still empty, otherwise starts a fresh chat filed into that project —
  // mirrors how a repo/workspace picker behaves in Codex-like tools.
  function focusProject(folder) {
    const chat = currentChat();
    if (chat && chat.messages.length === 0) { chat.folderId = folder ? folder.id : null; save(); }
    else { newChat(folder ? folder.id : null); }
    renderSidebar();
    syncComposerChip();
  }

  // ════════════════════════════════════════════════════════════════
  //  UI: composer context chip + confirm bar + settings popover
  // ════════════════════════════════════════════════════════════════

  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'kiconnect-agent-styles';
    s.textContent = `
.agent-context-bar{display:inline-flex;align-items:center;gap:2px;position:relative;padding:3px;border:1px solid var(--border,rgba(128,128,128,.25));border-radius:22px;background:var(--surface2,rgba(128,128,128,.05));}
.agent-context-chip{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:18px;border:none;background:none;color:var(--muted,#888);font-size:11.5px;cursor:pointer;transition:.15s;max-width:140px;}
.agent-context-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.agent-context-chip:hover{color:var(--text,#eee);}
.agent-context-chip.agent-focused{color:#fff;background:var(--accent,#3d7eff);font-weight:600;}
.agent-gear-btn{background:none;border:none;cursor:pointer;color:var(--muted,#888);font-size:14px;padding:5px 7px;border-radius:16px;}
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
.agent-stop-btn{padding:5px 10px;margin-left:2px;border-radius:16px;border:1px solid var(--red,#e74c3c);background:none;color:var(--red,#e74c3c);font-size:11px;cursor:pointer;}
.agent-stop-btn:hover{background:var(--red,#e74c3c);color:#fff;}
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
      <button id="agentConfirmAccept">${esc(t('agent.accept', '✓ Run'))}</button>
      <button id="agentConfirmReject">${esc(t('agent.reject', '✕ Reject'))}</button>
    `;
    inputZone.insertBefore(confirmBar, inputZone.firstChild);

    // Project chip + settings gear + stop button sit in the same row as the
    // mic/read-aloud controls (right after them), in their own small framed
    // group so they read as one unit rather than loose icons.
    const bar = document.createElement('div');
    bar.className = 'agent-context-bar';
    bar.id = 'agentContextBar';
    bar.innerHTML = `
      <button class="agent-context-chip" id="agentContextChip">📁 <span id="agentContextLabel">${esc(t('agent.noProject', 'No project'))}</span> ▾</button>
      <button class="agent-gear-btn" id="agentGearBtn" title="${esc(t('agent.settings', 'Agent Settings'))}">⚙</button>
      <button class="agent-stop-btn" id="agentStopBtn" style="display:none;">⏹ ${esc(t('agent.stop', 'Stop'))}</button>
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
    document.getElementById('agentStopBtn').addEventListener('click', stopAgent);
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
    addItem(`🚫 ${esc(t('agent.noProject', 'No project'))}`, () => focusProject(null), !(curFolder && curFolder.agentProject));
    if (projectFolders.length) {
      const sep = document.createElement('div'); sep.className = 'agent-context-menu-sep'; menu.appendChild(sep);
      projectFolders.forEach(f => addItem(`🤖 ${esc(f.name)}`, () => focusProject(f), curFolder && curFolder.id === f.id));
    }
    const sep2 = document.createElement('div'); sep2.className = 'agent-context-menu-sep'; menu.appendChild(sep2);
    addItem(`＋ ${esc(t('agent.newProject', 'New project…'))}`, onCreateProjectClick, false);
  }
  function onCreateProjectClick() {
    openFolderPicker();
  }

  // A second, equivalent trigger for the exact same project menu, placed
  // right next to the header's model picker — "which AI" and "which
  // project" live side by side, since picking a project is really the
  // only per-project choice left (the AI itself is unified, see above).
  function injectHeaderToggle() {
    if (document.getElementById('agentHeaderToggle')) return;
    const cmWrap = document.getElementById('cmWrap');
    if (!cmWrap || !cmWrap.parentNode) return;
    const btn = document.createElement('button');
    btn.id = 'agentHeaderToggle';
    btn.className = 'agent-header-toggle';
    btn.title = t('agent.headerToggleTitle', 'Project/agent mode');
    btn.innerHTML = `📁 <span id="agentHeaderToggleLabel">${esc(t('agent.noProject', 'No project'))}</span>`;
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
      label.textContent = focused ? folder.name : t('agent.noProject', 'No project');
    }
    if (hdrBtn && hdrLabel) {
      hdrBtn.classList.toggle('agent-focused', focused);
      hdrBtn.firstChild.textContent = focused ? '🤖 ' : '📁 ';
      hdrLabel.textContent = focused ? folder.name : t('agent.noProject', 'No project');
    }
  }
  function setComposerRunningUI(isRunning) {
    const stopBtn = document.getElementById('agentStopBtn');
    if (stopBtn) stopBtn.style.display = isRunning ? '' : 'none';
  }

  // ── Settings popover (provider / model / autonomy / manage projects) ──
  function injectAgentSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'agent-settings-panel';
    panel.id = 'agentSettingsPanel';
    panel.innerHTML = `
      <div class="agent-settings-title"><span>🤖 <span id="agentSettingsProjectName">${esc(t('agent.settingsTitle', 'Agent Settings'))}</span></span><button class="close-btn" id="agentSettingsClose">✕</button></div>
      <div class="agent-hint" style="font-size:10.5px;color:var(--muted);margin-bottom:6px;">${esc(t('agent.modelHint', 'The agent always uses the AI selected in the header (top left), including its thinking mode — the same one as in normal chat.'))}</div>
      <div id="agentSettingsNoProject" style="font-size:11.5px;color:var(--muted);padding:4px 0 8px;" hidden>${esc(t('agent.pickProjectFirst', 'Select a project below (or create one) to configure its access mode.'))}</div>
      <div id="agentSettingsModelBlock">
        <div class="setting-label">${esc(t('agent.autonomy', 'Access mode'))}</div>
        <div class="agent-chip-row" id="agentAutonomyRow">
          <div class="agent-chip" data-mode="auto">${esc(t('agent.autoMode', 'Autonomous'))}</div>
          <div class="agent-chip" data-mode="confirm">${esc(t('agent.confirmMode', 'Confirm'))}</div>
          <div class="agent-chip" data-mode="simulate">${esc(t('agent.simulateMode', 'Simulate'))}</div>
        </div>
        <div class="agent-chip-desc" id="agentAutonomyDesc"></div>
        <div class="setting-label" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">
          <span>⚡ ${esc(t('agent.shellLabel', 'Shell commands'))}</span>
          <label class="agent-toggle-switch"><input type="checkbox" id="agentShellToggle"><span class="agent-toggle-slider"></span></label>
        </div>
        <div class="agent-hint" style="font-size:10px;color:var(--muted);">${esc(t('agent.shellHint', 'Allows the agent to run terminal commands in the project folder (e.g. npm install, tests). Runs with the same permissions as the local server — only enable for trusted projects.'))}</div>
      </div>
      <div class="setting-label" style="margin-top:12px;">${esc(t('agent.projects', 'Projects'))}</div>
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
        showToast(box.checked ? t('agent.shellOn', '⚡ Shell commands enabled.') : t('agent.shellOff', 'Shell commands disabled.'));
      } catch (err) {
        box.checked = !box.checked;
        showToast(`❌ ${err.message}`);
      }
    });
    panel.addEventListener('click', e => e.stopPropagation());
    // Close on any click anywhere else (autonomy/shell changes already
    // save() immediately as they happen, so there's nothing to flush here)
    // — the gear button's and the panel's own click handlers both stop
    // propagation, so opening the panel or clicking inside it never
    // triggers this.
    document.addEventListener('click', () => panel.classList.remove('open'));
  }

  // ── Folder picker (browse real OS folders on the local machine to pick
  // or create a project root anywhere on disk — not just under the app) ──
  // editFolder: null while picking a folder for a brand-new project;
  // set to the existing project's folder object while re-pointing an
  // already-registered project at a different real folder (see
  // openFolderPickerForEdit()/confirmFolderPicker() below).
  let _fp = { path: '', parent: null, shortcuts: [], editFolder: null };
  function injectFolderPicker() {
    const overlay = document.createElement('div');
    overlay.className = 'agent-modal-overlay';
    overlay.id = 'agentFolderPickerOverlay';
    overlay.innerHTML = `
      <div class="agent-modal" id="agentFolderPickerModal">
        <div class="agent-modal-title"><span>📁 ${esc(t('agent.pickFolder', 'Choose project folder'))}</span><button class="close-btn" id="fpClose">✕</button></div>
        <div class="fp-path-row">
          <button id="fpUpBtn" title="${esc(t('agent.up', 'Parent folder'))}">⬆</button>
          <input type="text" id="fpPathInput" placeholder="${esc(t('agent.absPath', 'Absolute folder path…'))}">
          <button id="fpGoBtn">${esc(t('agent.go', 'Go'))}</button>
        </div>
        <div class="fp-shortcuts" id="fpShortcuts"></div>
        <div class="fp-list" id="fpList"></div>
        <div class="fp-new-row">
          <input type="text" id="fpNewFolderName" placeholder="${esc(t('agent.newSubfolder', 'Create a new subfolder here (optional)…'))}">
        </div>
        <div class="fp-footer">
          <input type="text" id="fpProjectName" placeholder="${esc(t('agent.projectNamePh', 'Project name'))}">
          <button class="agent-primary-btn" id="fpConfirm">${esc(t('agent.useFolder', 'Use this folder'))}</button>
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
  // Re-opens the same folder picker, pre-scoped to changing an EXISTING
  // project's target folder instead of creating a new one — see the ✏️
  // button added in renderProjectList(). The project name field is locked
  // (renaming happens elsewhere) and the picker starts at the project's
  // current path so the person can see where they're starting from.
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
    if (titleEl) titleEl.textContent = '📁 ' + (isEdit ? t('agent.changeFolder', 'Change project folder') : t('agent.pickFolder', 'Choose project folder'));
    if (confirmBtn) confirmBtn.textContent = isEdit ? t('agent.useNewFolder', 'Point project here') : t('agent.useFolder', 'Use this folder');
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
        list.innerHTML = `<div class="fp-list-empty">${esc(t('agent.noSubfolders', '– no subfolders –'))}</div>`;
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
        showToast(t('agent.projectPathChanged', '✅ Project folder updated.'));
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
        showToast(t('agent.projectCreated', '✅ Project linked and focused.'));
        renderProjectList();
      }
    } catch (err) {
      fpSetError(err.message);
    }
  }
  const AUTONOMY_DESCRIPTIONS = {
    auto: 'All file actions are executed immediately, without asking.',
    confirm: 'Reading runs automatically. Every file change must be confirmed individually.',
    simulate: 'Reading runs automatically. Changes are only simulated, nothing is actually written.',
  };
  function renderAutonomyChips() {
    const folder = currentProjectFolder();
    const modelBlock = document.getElementById('agentSettingsModelBlock');
    const noProjectEl = document.getElementById('agentSettingsNoProject');
    const titleEl = document.getElementById('agentSettingsProjectName');
    if (titleEl) titleEl.textContent = folder ? folder.name : t('agent.settingsTitle', 'Agent Settings');
    if (noProjectEl) noProjectEl.hidden = !!folder;
    if (modelBlock) modelBlock.style.display = folder ? '' : 'none';
    if (!folder) return;
    if (!folder.agentAutonomy) folder.agentAutonomy = 'confirm';
    const mode = folder.agentAutonomy;
    const shellToggle = document.getElementById('agentShellToggle');
    if (shellToggle) shellToggle.checked = !!folder.agentShellEnabled;
    document.querySelectorAll('#agentAutonomyRow .agent-chip').forEach(c => c.classList.toggle('selected', c.dataset.mode === mode));
    const d = document.getElementById('agentAutonomyDesc');
    if (d) d.textContent = t('agent.mode.' + mode, AUTONOMY_DESCRIPTIONS[mode] || '');
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
        if (f) f.agentShellEnabled = !!p.shell;
      });
    } catch (e) {}
    const shellToggle = document.getElementById('agentShellToggle');
    const focused = currentProjectFolder();
    if (shellToggle && focused) shellToggle.checked = !!focused.agentShellEnabled;
    list.innerHTML = projectFolders.length ? '' : `<div style="font-size:11px;color:var(--muted);">${esc(t('agent.noProjects', '– no projects –'))}</div>`;
    projectFolders.forEach(f => {
      const missing = missingIds.has(f.agentProject);
      const row = document.createElement('div');
      row.className = 'agent-proj-row' + (missing ? ' missing' : '');
      const title = missing ? esc(t('agent.projectMissing', 'Folder not found (moved/deleted)')) : esc(f.agentProjectPath || '');
      row.innerHTML = `<span title="${title}">${missing ? '⚠️' : '🤖'} ${esc(f.name)}</span><button class="agent-proj-edit-btn" title="${esc(t('agent.changeFolder', 'Change project folder'))}">✏️</button><button title="${esc(t('agent.deleteProject', 'Remove project'))}">🗑</button>`;
      row.querySelector('.agent-proj-edit-btn').addEventListener('click', () => openFolderPickerForEdit(f));
      row.querySelector('button:last-child').addEventListener('click', () => deleteProjectFolder(f).then(renderProjectList));
      list.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'agent-small-btn';
    addBtn.style.cssText = 'margin-top:6px;width:100%;padding:6px;border-radius:7px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--text,#eee);cursor:pointer;font-size:11.5px;';
    addBtn.textContent = '＋ ' + t('agent.newProject', 'New project…');
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

  // ════════════════════════════════════════════════════════════════
  //  Wiring into the host app (send interception, sidebar icons)
  // ════════════════════════════════════════════════════════════════
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

    // regenerate(): same idea — a project chat's "Regenerieren" button
    // should re-run the agent loop (tools + all), not silently fall back
    // to a bare, tool-less completion.
    const _origRegenerate = regenerate;
    regenerate = async function (idx) {
      if (await agentRegenerate(idx)) return;
      return _origRegenerate.apply(this, arguments);
    };

    // renderSidebar(): mark project folders visually + keep the composer
    // chip in sync whenever the sidebar (and therefore possibly the
    // active chat/folder) is redrawn — covers newChat()/switchChat() too,
    // since both already call renderSidebar() internally.
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

  // ── Language change hook ─────────────────────────────────────────
  // Called by kiconnect.js's setLang() whenever the UI language changes
  // (same pattern as kiconnect-voice.js's window._kicVoiceRetranslate).
  // No fields are rebuilt from scratch — just re-read their translated
  // text/title/placeholder in place, so open panels and in-progress runs
  // update immediately instead of only showing the new language on next
  // open/re-render.
  window._kicAgentRetranslate = function () {
    // Composer chip + gear + stop button
    syncComposerChip();
    const gearBtn = document.getElementById('agentGearBtn');
    if (gearBtn) gearBtn.title = t('agent.settings', 'Agent Settings');
    const stopBtn = document.getElementById('agentStopBtn');
    if (stopBtn) stopBtn.innerHTML = '⏹ ' + esc(t('agent.stop', 'Stop'));
    const acceptBtn = document.getElementById('agentConfirmAccept');
    if (acceptBtn) acceptBtn.textContent = t('agent.accept', '✓ Run');
    const rejectBtn = document.getElementById('agentConfirmReject');
    if (rejectBtn) rejectBtn.textContent = t('agent.reject', '✕ Reject');

    // Header toggle
    const hdrBtn = document.getElementById('agentHeaderToggle');
    if (hdrBtn) hdrBtn.title = t('agent.headerToggleTitle', 'Project/agent mode');

    // Context menu (rebuilt fresh each open, nothing to patch while closed)
    const ctxMenuEl = document.getElementById('agentContextMenu');
    if (ctxMenuEl && !ctxMenuEl.hidden) renderContextMenu();

    // Settings popover: static labels + the model hint + shell hint, plus
    // the mode chips/description and project list rows (their text depends
    // on the currently focused project, so just re-run the same renderers).
    const settingsTitle = document.getElementById('agentSettingsProjectName');
    if (settingsTitle && !currentProjectFolder()) settingsTitle.textContent = t('agent.settingsTitle', 'Agent Settings');
    const panel = document.getElementById('agentSettingsPanel');
    if (panel) {
      const modelHint = panel.querySelector('.agent-hint');
      if (modelHint) modelHint.textContent = t('agent.modelHint', 'The agent always uses the AI selected in the header (top left), including its thinking mode — the same one as in normal chat.');
      const noProjectEl = document.getElementById('agentSettingsNoProject');
      if (noProjectEl) noProjectEl.textContent = t('agent.pickProjectFirst', 'Select a project below (or create one) to configure its access mode.');
      const autonomyLabel = panel.querySelector('#agentSettingsModelBlock .setting-label');
      if (autonomyLabel) autonomyLabel.textContent = t('agent.autonomy', 'Access mode');
      const chipAuto = panel.querySelector('.agent-chip[data-mode="auto"]');
      if (chipAuto) chipAuto.textContent = t('agent.autoMode', 'Autonomous');
      const chipConfirm = panel.querySelector('.agent-chip[data-mode="confirm"]');
      if (chipConfirm) chipConfirm.textContent = t('agent.confirmMode', 'Confirm');
      const chipSimulate = panel.querySelector('.agent-chip[data-mode="simulate"]');
      if (chipSimulate) chipSimulate.textContent = t('agent.simulateMode', 'Simulate');
      const shellLabel = panel.querySelector('#agentSettingsModelBlock span');
      if (shellLabel) shellLabel.textContent = '⚡ ' + t('agent.shellLabel', 'Shell commands');
      const shellHint = panel.querySelectorAll('.agent-hint')[1];
      if (shellHint) shellHint.textContent = t('agent.shellHint', 'Allows the agent to run terminal commands in the project folder (e.g. npm install, tests). Runs with the same permissions as the local server — only enable for trusted projects.');
      const projectsLabel = panel.querySelectorAll('.setting-label')[1];
      if (projectsLabel) projectsLabel.textContent = t('agent.projects', 'Projects');
      if (panel.classList.contains('open')) { renderAutonomyChips(); renderProjectList(); }
    }

    // Folder picker modal
    const fpTitle = document.querySelector('#agentFolderPickerModal .agent-modal-title span');
    if (fpTitle) fpTitle.textContent = '📁 ' + t('agent.pickFolder', 'Choose project folder');
    const fpUpBtn = document.getElementById('fpUpBtn');
    if (fpUpBtn) fpUpBtn.title = t('agent.up', 'Parent folder');
    const fpPathInput = document.getElementById('fpPathInput');
    if (fpPathInput) fpPathInput.placeholder = t('agent.absPath', 'Absolute folder path…');
    const fpGoBtn = document.getElementById('fpGoBtn');
    if (fpGoBtn) fpGoBtn.textContent = t('agent.go', 'Go');
    const fpNewFolderName = document.getElementById('fpNewFolderName');
    if (fpNewFolderName) fpNewFolderName.placeholder = t('agent.newSubfolder', 'Create a new subfolder here (optional)…');
    const fpProjectName = document.getElementById('fpProjectName');
    if (fpProjectName) fpProjectName.placeholder = t('agent.projectNamePh', 'Project name');
    const fpConfirm = document.getElementById('fpConfirm');
    if (fpConfirm) fpConfirm.textContent = t('agent.useFolder', 'Use this folder');
    // Re-render the empty-state note in the folder list, if showing.
    const fpList = document.getElementById('fpList');
    if (fpList && fpList.querySelector('.fp-list-empty')) {
      fpList.innerHTML = `<div class="fp-list-empty">${esc(t('agent.noSubfolders', '– no subfolders –'))}</div>`;
    }

    // Any tool-call trace currently open in the live (still-streaming)
    // bubble — re-render so its labels/status text pick up the new
    // language immediately, exactly like a normal in-progress reply.
    rerenderCurrentRun();
    // Already-finished agent replies (this chat's history): their tool
    // labels/status words ("done.", "rejected", …) are UI chrome baked into
    // the saved message at the time the run finished — previously this never
    // updated again, so switching the language left every past project-mode
    // reply stuck in whatever language was active when it was created, even
    // though the rest of the UI (including this very panel) switches
    // immediately. Re-render every visible one from its stored `_agentSteps`
    // (added alongside the rendered markdown precisely for this) and persist
    // the freshly-translated markdown so a reload shows the new language too.
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

  // ── Boot ─────────────────────────────────────────────────────────
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