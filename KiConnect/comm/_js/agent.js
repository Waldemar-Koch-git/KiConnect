// Coding-Agent module. A "project" is a sidebar folder with an extra
// `agentProject` field pointing at a filesystem folder on the proxy; a chat
// filed into it runs the agent's tool loop, rendered as collapsed <details>
// cards. Hooks into the host app via an explicit registration API
// (registerSendMessageOverride etc., see chat-send.js/chat-sidebar.js)
// instead of monkey-patching, since reassigning an imported ES module
// binding isn't legal.
import { state } from './core/state.js';
import { agentSessionHeader, logoutNow } from './auth/accounts.js';
import { save } from './auth/storage.js';
import { buildAttachmentContent, clearAttachments, extractPdfText } from './chat/chat-attachments.js';
import { _finalizeAIRowInPlace, appendEmptyAI, appendToMessages, buildMsgEl, formatText, getBubbleRow, renderMessages, scrollToBottom, typesetMath, updateChatTokenTotal } from './chat/chat-render.js';
import { _makeRunId, _runBubbleEl, _toAnthropicContent, _toOpenAIContent, activeRuns, autoGenerateChatTitle, CLAUDE_BUDGET, isChatStreaming, OAI_EFFORT, registerRegenerateOverride, registerSendMessageOverride, stopStreaming, syncComposerStreamingUI } from './chat/chat-send.js';
import { currentChat, getActiveContainer, getActivePath, newChat, onRenderSidebar, renderSidebar } from './chat/chat-sidebar.js';
import { autoResize } from './core/boot.js';
import { boltonSubstitute, boltonT } from './core/bolton-i18n.js';
import { deferUntilDomReady, makeSessionFetch, makeToastFn, pollUntilReady, positionPanelNearAnchor } from './core/bolton-utils.js';
import { escHtml as esc } from './core/html-utils.js';
import { tf as hostTf } from './core/i18n.js';
import { getProviderEndpoint, proxyUrl } from './providers/provider-crud.js';
import { effectiveMaxTokens, isAdaptiveThinkingModel, isMistralAdjustableThinkingModel, isMistralNativeThinkingModel, isTemperatureSupported, isThinkingCapable, parseAnthropicToolResponse, providerForModel, splitModelId, usesTokenBudget } from './providers/provider-models.js';
import { onLanguageChange, toast as hostToast } from './ui/misc-ui.js';
import { activeProfile } from './ui/profiles.js';
import { fetchLinkedPage, performWebSearch, registerAgentSettingsOpener, updateWebSearchButton } from './websearch/web-search.js';

// ── i18n helper (falls back to the given text if no TRANSLATIONS
  // entry exists — this module doesn't require editing the i18n file) ─
  // Core lookup/substitution logic lives in core/bolton-i18n.js (was
  // duplicated near-identically in db.js and voice.js); this wrapper keeps
  // agent.js's own fallback semantics unchanged.
  function t(key, fallback) { return boltonT(key, fallback); }
  // Like t(), but substitutes {placeholder} vars; prefers the host app's tf().
  function tf(key, vars) {
    if (typeof hostTf === 'function') {
      return hostTf(key, vars);
    }
    return boltonSubstitute(t(key), vars);
  }
  const showToast = makeToastFn(hostToast, msg => console.log('[Agent]', msg));
  // esc() used to be a local copy of the same escaping logic that lives in
  // chat-render.js (as escHtml) and used to live in db.js too (also as
  // esc()) — now a single shared implementation in core/html-utils.js,
  // aliased back to the name `esc` so none of this file's many esc(...)
  // call sites need to change.

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

  // Runtime state. Runs are tracked per-chat in the shared activeRuns
  // registry (kind:'agent'), so several project chats can run at once.
  // `pendingConfirm` is still global — two simultaneous confirm-required
  // calls queue behind one confirm bar (known limitation).
  let pendingConfirm = null;

  const MAX_ITERATIONS = 200; // fallback/default — see effectiveMaxIterations()

  // Per-project override for MAX_ITERATIONS, set via the ⚙ Agent Settings
  // panel's number field. Falls back to the 200 default when unset or
  // out of the sane 10–1000 range (e.g. corrupted localStorage).
  function effectiveMaxIterations(folder) {
    const v = parseInt(folder && folder.agentMaxIterations, 10);
    return Number.isFinite(v) && v >= 10 && v <= 1000 ? v : MAX_ITERATIONS;
  }

  // Shrinks old tool_results in `history` to save tokens on providers
  // WITHOUT automatic prefix caching (see KNOWN_CACHING_PROVIDERS — for
  // those, mutating history would invalidate the cached prefix instead).
  // Only touches results older than KEEP_RECENT_TOOL_TURNS, replacing them
  // with a placeholder the model can re-call if still needed; disk is untouched.
  const KEEP_RECENT_TOOL_TURNS = 6;   // tool-result turns kept 100% intact
  const COMPACT_MIN_SIZE = 400;       // don't bother compacting tiny results (chars)

  // Providers with known automatic/session-based prefix caching. Anthropic
  // is handled separately (explicit cache_control in callModel). Anything
  // else (e.g. a custom openai-compat endpoint) still gets compacted.
  const KNOWN_CACHING_PROVIDERS = new Set([
    'anthropic', 'openai-direct', 'kimi', 'deepseek', 'mistral',
    'google', 'xai', 'groq', 'minimax', 'zhipu', 'openrouter',
  ]);

  function compactToolCallLabel(name, args) {
    if (!args) return name;
    const key = args.path || (Array.isArray(args.paths) && args.paths[0]) || (Array.isArray(args.items) && args.items[0] && args.items[0].from) || args.query || args.command || args.from || args.hash;
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
    git_log: '🕘', git_show_commit: '📜', git_file_at: '👁️', git_list_deleted: '🗑️🕘', git_restore: '♻️',
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
      git_log: t('agent.tool.gitLog', 'Git log'), git_show_commit: t('agent.tool.gitShowCommit', 'Show checkpoint'),
      git_file_at: t('agent.tool.gitFileAt', 'Read file at checkpoint'), git_list_deleted: t('agent.tool.gitListDeleted', 'List deleted files'),
      git_restore: t('agent.tool.gitRestore', 'Git restore'),
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
    if (a.hash) return String(a.hash).slice(0, 12);
    return '';
  }

  function langFromPath(p) {
    const ext = (String(p || '').split('.').pop() || '').toLowerCase();
    const map = { js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python', html: 'html',
      css: 'css', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml', java: 'java',
      c: 'c', cpp: 'cpp', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', sql: 'sql', xml: 'xml' };
    return map[ext] || '';
  }

  // Tool schema sent to the model (function calling) — deliberately English,
  // not UI text.
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
    ];
    // Marks where the always-present "core" tools end and the toggleable
    // ones (web_search/fetch_url, run_command, git checkpoints — each
    // gated by its own ⚙ Agent Settings flag) begin. callModel() uses this
    // to put a SECOND, earlier cache_control breakpoint here (in addition
    // to the one at the very end of the array): without it, a single
    // end-of-array breakpoint means flipping ANY one of those toggles
    // busts the cache for the entire tools+system prefix, even though the
    // core tools (used on every single request) never changed. With two
    // breakpoints, toggling web search only re-bills the small toggleable
    // tail, not the whole prefix. Non-enumerable so it doesn't leak into
    // JSON.stringify(tools) if that's ever logged/sent anywhere.
    Object.defineProperty(tools, '_coreEnd', { value: tools.length, enumerable: false });
    // web_search/fetch_url are on by default (unlike shell/checkpoints,
    // which default OFF) — most projects benefit from them and there's no
    // security dimension, only a token-cost one. `!== false` so existing
    // folders from before this setting existed (agentWebSearchEnabled is
    // undefined) keep working exactly as before. Independent of the
    // composer's own "Web" button/mode (state.config.webSearchMode) — see
    // ⚙ Agent Settings, and the composer-side clarification in
    // web-search.js's syncWebContextPopover().
    if (!folder || folder.agentWebSearchEnabled !== false) {
      tools.push(
        { type: 'function', function: { name: 'web_search', description: 'Searches the web via the search engine configured in KI Connect and returns title, URL, and short description of the results. Useful for current information, documentation, or library/API research while working on the project.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
        { type: 'function', function: { name: 'fetch_url', description: 'Fetches a single webpage and returns its readable text content (e.g. to read a documentation page or search result more closely).', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
      );
    }
    // Only offered to the model at all if the user explicitly enabled shell
    // execution for THIS project (⚙ Agent Settings) — see agentExec().
    if (folder && folder.agentShellEnabled) {
      tools.push({ type: 'function', function: { name: 'run_command', description: 'Runs a terminal command in the project folder (e.g. npm install, pytest, ls) and returns stdout/stderr/exit code. Runs with the same permissions as the local server — use sparingly and precisely.', parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Optional: subfolder relative to the project root in which the command runs.' } }, required: ['command'] } } });
    }
    // Git/checkpoint tools only make sense — and only ever return non-empty
    // results — when checkpointing is enabled for THIS project (⚙ Agent
    // Settings, same toggle as agentCheckpointsEnabled below). Keeping them
    // out of the schema otherwise saves ~5 verbose tool definitions worth of
    // tokens on every request for projects that never turned checkpoints on.
    if (folder && folder.agentCheckpointsEnabled) {
      tools.push(
        { type: 'function', function: { name: 'git_log', description: 'Lists this project\'s local checkpoint history (newest first) — every automatic git commit made as files were changed. Use this to see what has changed over time, find a specific earlier state to inspect or restore, or figure out which checkpoint a bug was introduced in. Pass `path` to only show checkpoints that touched one specific file (useful to find that file\'s own history, including checkpoints from before it was later deleted). Each entry has a `hash` (full) and `shortHash` you can pass to git_show_commit, git_file_at, or git_restore.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Optional: only show checkpoints that touched this file (path relative to the project root).' }, limit: { type: 'integer', description: 'Optional: max number of checkpoints to return (default 200, capped at 500).' } } } } },
        { type: 'function', function: { name: 'git_show_commit', description: 'Shows the details of one checkpoint (commit): its message, date, and exactly which files it added, modified, deleted, or renamed. Use this after git_log to see what a specific checkpoint actually changed before deciding whether to inspect its files (git_file_at) or restore from it (git_restore).', parameters: { type: 'object', properties: { hash: { type: 'string', description: 'A commit hash from git_log (full or shortHash).' } }, required: ['hash'] } } },
        { type: 'function', function: { name: 'git_file_at', description: 'Reads a file\'s content exactly as it was at a given checkpoint — without changing anything on disk. Use this to inspect an older version of a file (e.g. to compare it with the current one, or to decide whether it\'s worth restoring) before calling git_restore. Also works for files that have since been deleted, by passing a hash from BEFORE the deletion (e.g. the `restoreHash` from git_list_deleted, or "<deleteCommitHash>~1" for the commit right before a file was removed).', parameters: { type: 'object', properties: { hash: { type: 'string', description: 'A commit hash (full or shortHash), optionally suffixed with "~1" etc. to mean "N commits before this one".' }, path: { type: 'string', description: 'File path relative to the project root.' } }, required: ['hash', 'path'] } } },
        { type: 'function', function: { name: 'git_list_deleted', description: 'Lists files that were deleted at some point in this project\'s checkpoint history and are still missing now (files that were deleted and later recreated are not included). Each entry includes a ready-to-use `restoreHash` — pass it straight to git_restore (with that file\'s `path`) to bring the file back. Use this whenever the user asks to recover, undelete, or restore a file whose exact name/path you don\'t already know.', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'git_restore', description: 'Restores content from an earlier checkpoint. This actually changes files on disk (a fresh checkpoint of the result is taken automatically afterwards, so a restore can itself always be undone the same way). Two modes: pass `paths` to restore only those specific files/folders to their state at `hash` (this also recreates files that were deleted — get the right hash from git_list_deleted or git_log first); omit `paths` to restore the ENTIRE project to its state at `hash`, which also removes any file that did not exist yet at that checkpoint. Only use whole-project restore when the user actually wants to roll back everything, not just recover one or two files — prefer the `paths` form whenever possible since it is far less destructive.', parameters: { type: 'object', properties: { hash: { type: 'string', description: 'The checkpoint to restore from (a hash from git_log/git_show_commit/git_list_deleted).' }, paths: { type: 'array', items: { type: 'string' }, description: 'Optional: restore only these files/folders instead of the whole project.' } }, required: ['hash'] } } },
      );
    }
    return tools;
  }
  // Same tools in Anthropic's `tools` shape, for the Messages API.
  function toolSchemaAnthropic(folder) {
    const tools = toolSchema(folder);
    const mapped = tools.map(f => ({ name: f.function.name, description: f.function.description, input_schema: f.function.parameters }));
    // .map() drops non-enumerable/custom props, so re-attach _coreEnd —
    // see toolSchema() for what it's for.
    Object.defineProperty(mapped, '_coreEnd', { value: tools._coreEnd, enumerable: false });
    return mapped;
  }
  // Internal system prompt, always English regardless of UI language.
  // `folder` is optional for backwards compatibility with any external
  // caller that still invokes this with just a name; omitting it just
  // means the web_search/fetch_url line below is included by default,
  // matching toolSchema()'s own default-on behavior.
  function systemPrompt(projectName, folder) {
    const webSearchOffered = !folder || folder.agentWebSearchEnabled !== false;
    return [
      `You are an autonomous coding agent with access to the local project folder "${projectName}".`,
      `That project folder itself is the root every path you pass to a tool is relative to — it already IS "${projectName}", so paths must NOT repeat that name. To create a file directly in the project, pass "file.txt", not "${projectName}/file.txt". Never create a new top-level folder that just repeats the project's own name ("${projectName}/${projectName}/...") — if list_files already shows a folder with that name at the root, that is almost always a mistake from an earlier step, not something to build on; ask yourself whether you actually meant the project root itself before adding another folder like it.`,
      `You can only read, create, modify, and delete files through the provided tools — you have no other access to the file system.`,
      `Work step by step: if needed, first use list_files/search_in_files/read_file to get an overview of the existing project structure and the relevant code before you modify files.`,
      `Use search_in_files to find functions, variables, or text across the whole project instead of guessing file names or reading files blindly one by one.`,
      `Prefer the batch tools (read_files, write_files, delete_files, create_directories, delete_directories) over calling their single-file counterparts repeatedly whenever a task touches more than one file — e.g. for "delete all files in this folder" call list_files once, then delete_files once with every matching path, not one delete_file call per file.`,
      `Prefer edit_file over write_file for a small change to an otherwise-large file — it only needs the exact snippet being changed, not the whole file; pass edit_file's \`edits\` array when a file needs several separate changes, instead of calling edit_file once per change. Use move_file to rename/relocate a file or folder instead of reading and rewriting its content — but move_file DELETES the original, so never use it for "copy"/"duplicate" requests; use copy_file (or copy_files for several items) for those instead, since it leaves the original in place. Use replace_in_files instead of read_file+edit_file per file when the exact same text needs to change in several files at once (e.g. renaming a function everywhere it's used) — search_in_files first to find which files are affected.`,
      `Tool results can be large (e.g. a big file's content) and may be shown to you truncated with a note saying how much was cut off. NEVER call write_file on a file you only saw truncated or partially — you would overwrite the rest of the file with content you never actually saw. For reorganizing, reformatting, or otherwise touching most of a large file, use several edit_file/replace_in_files calls on the specific parts that change instead of write_file with the whole new content.`,
      // Omitted (instead of e.g. "web_search is unavailable") when the tools
      // themselves aren't offered — no point telling the model about a
      // capability it doesn't have and that it might otherwise ask the user
      // to confirm/retry.
      webSearchOffered ? `Use web_search and fetch_url when you need current information, documentation, or details about a library/API that you're not sure about.` : null,
      `Only make changes that belong to the given task. At the end, reply in short, plain prose about what you did — that ends the run.`,
      `If important information is missing, make a reasonable assumption, state it briefly, and continue instead of asking back.`,
    ].filter(Boolean).join(' ') + profileAddendum();
  }

  // Appends the active profile's custom system prompt (if any) AFTER the
  // agent's own rules, so it layers "how to behave" on top of "how to use
  // these tools". No-op if no profile/prompt is set.
  function profileAddendum() {
    const p = (typeof activeProfile === 'function') ? activeProfile() : null;
    const text = p && p.systemPrompt ? String(p.systemPrompt).trim() : '';
    return text ? `\n\nAdditionally, follow this persona/style guidance for how you communicate: ${text}` : '';
  }

  // Backend calls to /agent/* on the local proxy, carrying the current
  // agent-session token. A 401 is treated as an expired session (logout).
  /* global agentSessionHeader, logoutNow, toast */
  // Same shared wrapper as db.js's kbFetch(): a 401 with no token sent
  // just means "not logged in yet", not an expired session.
  const agentFetch = makeSessionFetch(
    () => (typeof agentSessionHeader === 'function' ? agentSessionHeader() : {}),
    () => {
      if (typeof hostToast === 'function') hostToast(t('agent.err.sessionExpired'));
      if (typeof logoutNow === 'function') logoutNow();
    }
  );
  function encPath(p) {
    return String(p).replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }
  // Shared response handling for agentFetch() JSON calls: throws on non-ok,
  // or returns { error } for tool-facing calls (reported back to the model).
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
    // PDFs come back as binary (content_b64); extract text via the same
    // pdf.js pipeline chat-attachments.js uses, falling back to raw binary
    // if extraction fails (e.g. scanned image-only PDF).
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
  // ── Git history / restore (see /agent/git/* routes in kiconnect-proxy.py).
  // All calls throw on failure so the caller can surface a clear error.
  async function apiGitLog(project, path, limit) {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return agentJson(`/agent/git/${encodeURIComponent(project)}/log${qs ? `?${qs}` : ''}`, undefined, true);
  }
  async function apiGitCommit(project, hash) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/commit/${encodeURIComponent(hash)}`, undefined, true);
  }
  async function apiGitFileAt(project, hash, path) {
    const params = new URLSearchParams({ hash, path });
    return agentJson(`/agent/git/${encodeURIComponent(project)}/file-at?${params.toString()}`, undefined, true);
  }
  async function apiGitDeleted(project) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/deleted`, undefined, true);
  }
  // Forces a full `git gc --aggressive --prune=now` (see agent_git_gc() in
  // kiconnect-proxy.py) — storage only, never touches history/content.
  // Lighter `git gc --auto` housekeeping already runs automatically after
  // every checkpoint; this is for an on-demand deep repack. Returns byte
  // counts so the modal can show the effect (a tiny repo can occasionally
  // grow slightly from packfile overhead — expected).
  async function apiGitGc(project) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/gc`, { method: 'POST' }, true);
  }
  async function apiGitRestore(project, hash, paths) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paths ? { hash, paths } : { hash }),
    }, true);
  }
  // ── New git controls (see kiconnect-proxy.py /agent/git/* additions) ──
  async function apiGitManualCommit(project, message) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    }, true);
  }
  async function apiGitDiscard(project) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/discard`, { method: 'POST' }, true);
  }
  async function apiGitDiff(project, from, to, path) {
    const params = new URLSearchParams({ from });
    if (to) params.set('to', to);
    if (path) params.set('path', path);
    return agentJson(`/agent/git/${encodeURIComponent(project)}/diff?${params.toString()}`, undefined, true);
  }
  async function apiGitGetNote(project, hash) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/note/${encodeURIComponent(hash)}`, undefined, true);
  }
  async function apiGitSetNote(project, hash, note) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/note/${encodeURIComponent(hash)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note }),
    }, true);
  }
  async function apiGitDeleteNote(project, hash) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/note/${encodeURIComponent(hash)}`, { method: 'DELETE' }, true);
  }
  async function apiGitMilestones(project) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/milestones`, undefined, true);
  }
  async function apiGitAddMilestone(project, hash, name) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/milestone`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hash, name }),
    }, true);
  }
  async function apiGitRemoveMilestone(project, name) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/milestone/${encodeURIComponent(name)}`, { method: 'DELETE' }, true);
  }
  async function apiGitSearch(project, q, mode) {
    const params = new URLSearchParams({ q, mode: mode || 'message' });
    return agentJson(`/agent/git/${encodeURIComponent(project)}/search?${params.toString()}`, undefined, true);
  }
  async function apiGitSquash(project, fromHash, message) {
    return agentJson(`/agent/git/${encodeURIComponent(project)}/squash`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromHash, message }),
    }, true);
  }
  // Binary download (zip) - can't go through agentJson (expects JSON), and
  // a plain <a href> would skip agentFetch()'s auth header, so fetch as a
  // blob and trigger the save via a throwaway object URL instead.
  async function apiGitExportDownload(project, hash, filenameHint) {
    const res = await agentFetch(`/agent/git/${encodeURIComponent(project)}/export?hash=${encodeURIComponent(hash)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenameHint || `checkpoint-${hash.slice(0, 12)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  // Stages+commits whatever changed since the last checkpoint. Called before
  // a mutating tool runs; never blocks the tool on failure (a missing safety
  // net shouldn't stop the agent).
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

  // Flags "test/test/..."-style self-nesting paths (near-always a mistake)
  // so mutating tools can attach a warning for the model to self-correct.
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

  // Detects a write_file call that would blow away over half of an existing,
  // non-trivial file — guards against a model overwriting a file it only
  // saw truncated (see serializeToolResult() below). Compares against the
  // file's current size from the tree listing, no content read needed.
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
  // and writes it back — shared by edit_file's single old_str/new_str and
  // `edits` array forms.
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
  // (e.g. renaming a symbol project-wide).
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

  // Read cache scoped to a single agent turn, since a tool loop often
  // re-reads the same file. Cleared at turn start and fully flushed before
  // any mutating call — coarse but never stale.
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

  // Disk-mutating tools, gating the pre-mutation apiCheckpoint() call below.
  // Includes create_file/create_directory(ies) too: a brand-new agent-built
  // project is typically all create_file calls, so excluding them meant
  // checkpoints never ran for the most common case. Includes git_restore
  // (captures state right before the restore, in addition to its own
  // server-side post-restore checkpoint) and run_command (arbitrary shell
  // commands can mutate the filesystem just as much as write_file). A
  // command/call that happens not to touch disk just makes the
  // pre-checkpoint a no-op.
  const MUTATING_TOOL_NAMES = new Set([
    'write_file', 'write_files', 'edit_file', 'delete_file', 'delete_files',
    'move_file', 'copy_file', 'copy_files', 'replace_in_files', 'delete_directory', 'delete_directories',
    'create_file', 'create_directory', 'create_directories', 'git_restore', 'run_command',
  ]);
  const _checkpointWarned = new Set(); // project ids already warned about missing git this session
  function projectCheckpointsEnabled(projectId) {
    const f = state.folders.find(x => x.agentProject === projectId);
    return !!(f && f.agentCheckpointsEnabled);
  }
  // `runId` (when given) is appended as a "Run: <id>" trailer in the commit
  // body so the 🕘 modal can group a turn's checkpoints (see renderGhGroups()).
  // Commits without a runId render as their own one-commit group.
  function checkpointMessage(name, args, runId) {
    const subject = `Agent: ${compactToolCallLabel(name, args)}`.slice(0, 200);
    return runId ? `${subject}\n\nRun: ${runId}` : subject;
  }

  // Tool execution (respects autonomy mode). `run` is threaded through
  // explicitly so the confirm-bar rerender updates the right run's bubble.
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
    if (name === 'web_search' || name === 'fetch_url') {
      // Defense in depth, not the primary gate: toolSchema() already leaves
      // these two out of the model's tool list when disabled, so this only
      // matters if a call still comes in — e.g. a tool_use queued from a
      // response that started before the setting was flipped mid-run.
      const f = state.folders.find(x => x.agentProject === project);
      if (f && f.agentWebSearchEnabled === false) return { error: t('agent.err.webSearchDisabled') };
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
    // Read-only git history tools — safe in every autonomy mode since
    // nothing on disk changes.
    if (name === 'git_log') {
      return apiGitLog(project, args.path, args.limit);
    }
    if (name === 'git_show_commit') {
      if (!args.hash) return { error: t('agent.err.missingHash', 'missing hash') };
      return apiGitCommit(project, args.hash);
    }
    if (name === 'git_file_at') {
      if (!args.hash || !args.path) return { error: t('agent.err.missingHashOrPath', 'missing hash or path') };
      return apiGitFileAt(project, args.hash, args.path);
    }
    if (name === 'git_list_deleted') {
      return apiGitDeleted(project);
    }

    // A risky overwrite forces a confirm step regardless of autonomy
    // setting — silently applying it in "Autonomous" mode could destroy
    // data the model never fully saw (see shrinkRisk()).
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
      if (name === 'git_restore') {
        const paths = Array.isArray(args.paths) && args.paths.length ? args.paths : null;
        const target = paths ? (paths.length === 1 ? paths[0] : tf('agent.nItems', { n: paths.length })) : t('agent.gitWholeProject', 'the entire project');
        return { simulated: true, message: tf('agent.sim.gitRestore', { target, hash: String(args.hash || '').slice(0, 12) }) };
      }
      if (BATCH_ITEM_KEY[name]) {
        const list = Array.isArray(args.paths) ? args.paths : Array.isArray(args.files) ? args.files.map(f => f && f.path) : [];
        return { files: list.map(p => ({ path: p, simulated: true, message: tf(BATCH_ITEM_KEY[name], { path: p, len: 0 }) })) };
      }
    }

    // Real mutation about to happen — checkpoint first if enabled, so the
    // change stays recoverable. `name` hasn't run yet, so this actually
    // commits the PREVIOUS mutating call's effect — hence the label comes
    // from `run._pendingCheckpointMsg` (set by that call), not `name`/`args`,
    // or every checkpoint would be mislabeled one action late. A failed/
    // unavailable git never blocks the tool call, just surfaces once.
    if (MUTATING_TOOL_NAMES.has(name)) {
      if (run) run.hadMutation = true;
      if (project && projectCheckpointsEnabled(project)) {
        const msg = (run && run._pendingCheckpointMsg) || checkpointMessage(name, args, run && run.runId);
        try {
          const cp = await apiCheckpoint(project, msg);
          if (cp && cp.error === undefined && cp.ok === false && cp.reason === 'git-not-installed' && !_checkpointWarned.has(project)) {
            _checkpointWarned.add(project);
            showToast(t('agent.checkpointNoGit'));
          }
        } catch (e) { /* best-effort only, never blocks the actual tool call */ }
      }
      // Describes THIS call — labels whichever checkpoint (next mutating
      // call's pre-checkpoint, or the end-of-turn one) ends up capturing it.
      if (run) run._pendingCheckpointMsg = checkpointMessage(name, args, run.runId);
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
    if (name === 'git_restore') {
      if (!args.hash) return { error: t('agent.err.missingHash', 'missing hash') };
      const paths = Array.isArray(args.paths) && args.paths.length ? args.paths : undefined;
      return apiGitRestore(project, args.hash, paths);
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
  // chat-send.js's stopStreaming(), plus closes the confirm bar if needed.
  function stopAgent(chatId) {
    chatId = chatId || state.currentChatId;
    stopStreaming(chatId);
    hideConfirmBar();
  }

  // Chat-completion call. `history` is a provider-neutral turn list (see
  // runAgentChatTurn). callModel() translates it to the wire format
  // `provider` needs and normalizes the reply to {text, toolCalls}, applying
  // the same thinking/reasoning-effort settings as normal chat.
  //
  // Serializes a tool result for the model. Truncates long STRING FIELDS
  // individually with an explicit "…N more characters not shown" marker
  // instead of naively slicing the whole JSON string (which produced
  // invalid JSON mid-string with no signal anything was cut — the model
  // could then write_file and silently overwrite a file with truncated
  // content it thought was complete; see shrinkRisk() for the write-side
  // guard).
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
            // Gemini requires each function call to echo back its exact
            // thought_signature or the next turn 400s (even with "thinking"
            // off). Calls we invented ourselves (JSON-in-text fallback)
            // were never signed, so send Google's documented bypass sentinel.
            ...(c._thoughtSig ? { extra_content: { google: { thought_signature: c._thoughtSig } } } : {}),
          })) : undefined,
        });
      } else if (h.role === 'tool_results') {
        h.results.forEach(r => out.push({ role: 'tool', tool_call_id: r.id, content: serializeToolResult(r.result) }));
      }
    });
    return out;
  }
  // `signal` (the run's own AbortController) is passed in explicitly rather
  // than shared, since several agent runs can be in flight at once.
  async function callModel(history, provider, folder, sessionId, signal) {
    if (!provider) throw new Error(t('agent.noModelHdr'));
    if (!provider.apiKey) throw new Error(t('agent.err.noApiKey'));
    if (provider.enabled === false) throw new Error(t('agent.err.providerDisabled'));
    const modelId = splitModelId(state.config.model).modelId;

    if (provider.type === 'anthropic') {
      const { system, messages } = toAnthropicHistory(history);
      // Cache breakpoints on tool schema and system prompt: byte-identical
      // every iteration, so `ephemeral` lets Anthropic serve them from
      // cache instead of billing fresh input.
      const toolsForModel = toolSchemaAnthropic(folder);
      if (toolsForModel.length) {
        // Two breakpoints, not one: an earlier one right after the
        // always-present "core" tools (_coreEnd, set in toolSchema()), and
        // the usual one at the very end. Without the first, toggling any
        // per-project tool switch (web search, shell, git checkpoints)
        // would bust the cache for the ENTIRE tools+system prefix, since
        // one end-of-array breakpoint covers everything up to it. With
        // both, the core segment — used on every request regardless of
        // those toggles — keeps its own independent, unaffected cache;
        // only the smaller toggleable tail gets reprocessed. Uses our 4th
        // and last available Anthropic cache_control slot (system + this
        // + last message = the other 3 — see below and toAnthropicHistory
        // call site).
        const coreEnd = toolsForModel._coreEnd;
        if (coreEnd && coreEnd > 0 && coreEnd < toolsForModel.length) {
          toolsForModel[coreEnd - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
        }
        toolsForModel[toolsForModel.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
      }
      // Second cache breakpoint on the message history: without it, only
      // tool schema/system prompt were cached and every follow-up re-billed
      // the entire growing history (a "read this file, split it up" task
      // cost ~1.4M tokens reprocessing the whole file each time). Placed on
      // the last content block of the last message so everything before it
      // is served from cache.
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
      // Native server-side context management (beta), complementing
      // compactOldToolResults() (which skips Anthropic — see there). Clears
      // old tool results server-side after the cache-prefix lookup so it
      // doesn't bust the prompt cache. Beta API; worst case is a surfaced
      // 400, never silent data loss.
      if (state.config.anthropicContextEditing !== false) {
        body.context_management = {
          edits: [{
            type: 'clear_tool_uses_20250919',
            trigger: { type: 'input_tokens', value: 30000 },
            keep: { type: 'tool_uses', value: 3 },
          }],
        };
      }
      if (isTemperatureSupported(modelId)) body.temperature = state.config.temperature;
      if (state.config.thinkingEnabled && isThinkingCapable(modelId)) {
        if (isAdaptiveThinkingModel(modelId)) {
          body.thinking = { type: 'adaptive' };
          body.output_config = { effort: OAI_EFFORT[state.config.thinkingIntensity || 2] };
          delete body.temperature;
        } else {
          const budget = usesTokenBudget(modelId) ? (state.config.thinkingBudget || 8000) : CLAUDE_BUDGET[state.config.thinkingIntensity || 2];
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
          ...(state.config.anthropicContextEditing !== false ? { 'anthropic-beta': 'context-management-2025-06-27' } : {}),
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body), signal,
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 400)}`);
      const data = await res.json();
      const { text, toolCalls } = parseAnthropicToolResponse(data);
      return { text, toolCalls, usage: data.usage || null };
    }

    // Every other provider speaks the OpenAI-compatible /chat/completions shape.
    const endpoint = getProviderEndpoint(provider);
    const reqBody = { model: modelId, messages: toOpenAIHistory(history), tools: toolSchema(folder), tool_choice: 'auto', stream: false };
    // Same reasoning-model shape fix as the main chat path: GPT-5 behaves
    // like the o-series here (no temperature, max_completion_tokens).
    const isOSeries = /^o\d/.test(modelId) || /^(chatgpt-)?gpt-5/.test(modelId);
    if (!isOSeries) reqBody.temperature = state.config.temperature;
    if (state.config.thinkingEnabled && isThinkingCapable(modelId)) {
      if (provider.type === 'zhipu') reqBody.thinking = { type: 'enabled' };
      // MiniMax has no reasoning_effort levels (on/off only, on by default,
      // M2.x can't disable); agent UI doesn't surface the reasoning trace.
      else if (provider.type === 'minimax') reqBody.thinking = { type: 'adaptive' };
      // Mistral only documents 'none'/'high', so OAI_EFFORT's low/medium/high
      // mapping doesn't apply. Native Magistral always reasons, no parameter.
      else if (provider.type === 'mistral') {
        if (isMistralAdjustableThinkingModel(modelId)) reqBody.reasoning_effort = 'high';
        else delete reqBody.reasoning_effort;
      }
      else reqBody.reasoning_effort = OAI_EFFORT[state.config.thinkingIntensity || 2];
    } else if (provider.type === 'mistral' && isMistralNativeThinkingModel(modelId)) {
      // Native Magistral always reasons regardless of thinkingEnabled —
      // nothing to send; just avoid a stray reasoning_effort field.
      delete reqBody.reasoning_effort;
    }
    // Mistral's caching is automatic but more reliable with a reused
    // prompt_cache_key across requests sharing a prefix (docs.mistral.ai).
    if (provider.type === 'mistral' && sessionId) reqBody.prompt_cache_key = String(sessionId);
    // OpenAI's caching is also automatic (no cache_control needed, unlike
    // Anthropic above) but lives on individual backend machines — a
    // request only hits the cache if it's ROUTED to a machine that has it.
    // prompt_cache_key is OpenAI's own documented routing hint for exactly
    // this (developers.openai.com/api/docs/guides/prompt-caching); without
    // it, requests for the same chat can bounce between machines under
    // load and miss a cache that's genuinely still there.
    if (provider.type === 'openai-direct' && sessionId) reqBody.prompt_cache_key = String(sessionId);
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
    // chunks — extract just the answer text.
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
    // Normalize OpenAI's field names to the shape buildTokenBadge() uses.
    // DeepSeek reports cache hits under prompt_cache_hit_tokens instead of
    // the standard field — fall back to it or cache savings never show.
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
  // Shared status-line helper for a tool result. Returns null on plain
  // success so callers can append their own success line.
  function resultStatusLine(result) {
    if (!result) return null;
    if (result.error) return `❌ ${result.error}`;
    if (result.simulated) return `🧪 ${result.message}`;
    if (result.rejected) return `🚫 ${result.message}`;
    return null;
  }

  // Renders a run as collapsed <details> cards, reusing formatText() so it
  // renders identically live and after reload.
  //
  // The specific `run` object is threaded explicitly through the tool loop
  // instead of a shared singleton pointer, since several project chats can
  // run an agent turn at once. `_agentRun(chatId)` is a convenience default
  // meaning "whichever run belongs to the chat on screen right now".
  function _agentRun(chatId) {
    chatId = chatId || state.currentChatId;
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
  // Builds a message row for a still-running run reattached after a chat
  // switch — like appendEmptyAI() but pre-filled from run.steps/run.usage.
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
  // `run` should be passed explicitly by callers acting on a specific run;
  // falls back to _agentRun() ("whatever's on screen") otherwise.
  function rerenderCurrentRun(run) {
    run = run || _agentRun();
    if (!run || !run.steps) return;
    // Null when this run's chat isn't on screen — run.steps already has
    // the latest state; renderMessages()'s reattach repaints it later.
    const liveRow = _runBubbleEl(run);
    if (!liveRow) return;
    const liveBubble = liveRow.querySelector('.bubble');
    if (!liveBubble) return;
    // formatText() rebuilds the whole trace each call, which would collapse
    // any <details> the user opened. Steps only get appended, so the Nth
    // <details.agent-trace> stays the Nth one — capture open state by
    // position and reapply.
    const openStates = Array.from(liveBubble.querySelectorAll('details.agent-trace')).map(d => d.open);
    liveBubble.innerHTML = formatText(renderRunMarkdown(run.steps)) || '<p>…</p>';
    liveBubble.querySelectorAll('details.agent-trace').forEach((d, i) => { if (openStates[i]) d.open = true; });
    typesetMath(liveBubble);
    // Only auto-scroll to the bottom if the user hasn't scrolled away
    // (pinnedToBottom, tracked in _js/core/state.js).
    if (state.pinnedToBottom) scrollToBottom();
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
  // marking every old line '-' and every new line '+' (which makes a small
  // edit look like a full rewrite). edit_file snippets are small enough
  // that the O(n·m) DP table is cheap.
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
  // Renders _lcsLineDiff()'s ops as a compact unified diff: keeps CONTEXT
  // lines around a change, collapses the rest into an "N unchanged lines"
  // marker.
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
    } else if (name === 'git_log') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.commits)) {
          lines.push('```text');
          lines.push(result.commits.length
            ? result.commits.map(c => `${c.shortHash}  ${c.date}  ${c.message}`).join('\n')
            : `(${t('agent.empty')})`);
          lines.push('```');
        }
      }
    } else if (name === 'git_show_commit') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else {
          lines.push(`**${esc(result.hash ? result.hash.slice(0, 12) : '')}** — ${esc(result.message || '')}  _(${esc(result.date || '')})_`);
          if (Array.isArray(result.files) && result.files.length) {
            lines.push('```text');
            lines.push(result.files.map(f => `${STATUS_BADGE[f.status] || '•'} ${f.status}: ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}`).join('\n'));
            lines.push('```');
          }
        }
      }
    } else if (name === 'git_file_at') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (result.binary) lines.push(`_(${t('agent.binaryFile')})_`);
        else if (typeof result.content === 'string') {
          const lang = langFromPath(args.path);
          const preview = result.content.length > 3000 ? result.content.slice(0, 3000) + truncNote() : result.content;
          lines.push('```' + lang); lines.push(preview); lines.push('```');
        }
      }
    } else if (name === 'git_list_deleted') {
      if (result) {
        if (result.error) lines.push(`❌ ${result.error}`);
        else if (Array.isArray(result.files)) {
          lines.push('```text');
          lines.push(result.files.length
            ? result.files.map(f => `${f.path}  (${t('agent.ghStatusDeleted', 'deleted')} ${f.deletedAt}, restoreHash ${f.restoreHash})`).join('\n')
            : `(${t('agent.empty')})`);
          lines.push('```');
        }
      }
    } else if (name === 'git_restore') {
      const status = resultStatusLine(result);
      if (status) lines.push(status);
      else if (result && Array.isArray(result.restored)) {
        lines.push(`✅ ${result.restored.map(p => '`' + esc(p) + '`').join(', ')}`);
      } else if (result && result.restoredTo) {
        lines.push(`✅ ${t('agent.gitRestoredWholeProject', 'Restored entire project')} → ${esc(String(result.restoredTo).slice(0, 12))}` +
          (result.removed && result.removed.length ? ` (${tf('agent.gitRemovedFilesN', { n: result.removed.length })})` : ''));
      }
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
  // 'sandboxed'/'networkIsolated' in agent_exec()'s response) — resource
  // limits are POSIX-only and network isolation needs `unshare`, so this
  // reports what actually happened rather than assuming.
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
  // message into plain context text; agent replies store their spoken text
  // separately in `_agentText` so past tool-call traces are never replayed.
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

    // Snapshot the conversation so far, before adding the new user message,
    // as context for the model.
    const priorHistory = buildPriorHistory(chat);

    // Same attachment → content-block conversion normal chat uses (see
    // buildAttachmentContent() in chat-attachments.js).
    const { userContent, fileNames } = buildAttachmentContent(task, att || []);

    const container = getActiveContainer(chat);
    const userMsg = { role: 'user', content: userContent, _files: fileNames.length ? fileNames : undefined };
    container.push(userMsg);
    // Same auto-title flow as normal chat (autoGenerateChatTitle):
    // placeholder immediately, replaced by an AI-generated title later.
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

  // Regenerating a reply in a project chat: remove it and re-run the same
  // agent loop for the same preceding user message via runAgentCompletion().
  async function agentRegenerate(idx) {
    const chat = currentChat(); if (!chat) return;
    const folder = state.folders.find(f => f.id === chat.folderId);
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
        // runAgentChatTurn) — keep it so history can resend the actual file.
        if (m.role === 'user' && Array.isArray(m.content)) h.content = m.content;
        return h;
      });
  }

  // The model/tool loop: appends the live AI bubble, drives
  // callModel()+executeTool() until a final text-only reply, then saves and
  // upgrades the bubble. Shared by send/regenerate.
  async function runAgentCompletion(chat, folder, container, priorHistory, task, content) {
    if (!folder.agentAutonomy) folder.agentAutonomy = 'confirm';
    const provider = providerForModel(state.config.model);
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
      model: state.config.model,       // frozen now, same reasoning as the chat-stream side
      abortController: new AbortController(),
      steps,                     // authoritative state — rerenderCurrentRun() reads this,
                                  // not a separate run.text/thinkingText pair
      usage: null,
      status: 'running',
      bubbleEl: null,
      // Reattach hook for chat-render.js's renderMessages(): builds a fresh
      // row from run.steps/run.usage instead of the generic bubble builder.
      buildLiveEl: () => _buildAgentRowSkeleton(run),
    };
    activeRuns.set(runId, run);
    // Sidebar live-dot, same choke point _js/chat/chat-send.js's _streamAIResponse
    // uses for chat streaming, so a background agent run shows the same way.
    renderSidebar();

    const aiRow = appendEmptyAI(state.config.model, runId);
    run.bubbleEl = aiRow;
    const bubble = aiRow.querySelector('.bubble');
    // Sibling of .bubble (not a child) since rerenderCurrentRun() replaces
    // bubble.innerHTML wholesale each step. Filled once usage arrives,
    // removed in `finally`.
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
      { role: 'system', text: systemPrompt(folder.name, folder) },
      ...priorHistory,
      Array.isArray(content) ? { role: 'user', text: task, content } : { role: 'user', text: task },
    ];
    // Fresh per turn — a new user message shouldn't be served stale reads
    // from several turns ago; only duplicate reads within this turn cache.
    _readFileCache.clear();

    let iterations = 0, aborted = false;
    const maxIterations = effectiveMaxIterations(folder);
    // A single agent "turn" can involve several model calls (one per
    // tool round-trip) — sum them so the badge reflects the full cost.
    const totalUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    let sawUsage = false;
    try {
      while (iterations < maxIterations) {
        iterations++;
        // Only compact for providers without confirmed prefix caching (see
        // KNOWN_CACHING_PROVIDERS).
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
      if (iterations >= maxIterations) { steps.push({ kind: 'text', text: `⚠️ ${tf('agent.maxIterations', { n: maxIterations })}` }); rerenderCurrentRun(run); }
      if (aborted) { steps.push({ kind: 'text', text: `⏹ ${t('agent.aborted')}` }); rerenderCurrentRun(run); }
    } finally {
      // Every mutating tool checkpoints BEFORE it runs (see executeTool), so
      // the run's LAST mutation is never committed by that mechanism. Take
      // one final checkpoint here so the run's true end state is captured.
      if (run.hadMutation && folder.agentProject && projectCheckpointsEnabled(folder.agentProject)) {
        const fallbackMsg = run.runId ? `Agent: end of turn\n\nRun: ${run.runId}` : 'Agent: end of turn';
        try { await apiCheckpoint(folder.agentProject, run._pendingCheckpointMsg || fallbackMsg); }
        catch (e) { /* best-effort only, never blocks finishing the run */ }
      }
      // Use the run's CURRENT bubble (may be reattached or null), never the
      // originally-captured locals which may be detached from the DOM.
      const finishBubbleRow = _runBubbleEl(run);
      const finishBubble = finishBubbleRow && finishBubbleRow.querySelector('.bubble');
      if (finishBubble) finishBubble.classList.remove('streaming');
      const finalMd = renderRunMarkdown(steps);
      // Plain-text version (no tool-call HTML) fed back as context for
      // future agent runs in this chat.
      const contextText = steps.filter(s => s.kind === 'text').map(s => s.text).join('\n\n');
      // _model uses run.model (frozen at run start), not live config.model
      // — same "header changed mid-run" fix as the chat-stream path.
      const msgObj = { role: 'assistant', content: finalMd, _model: run.model, _agentText: contextText, _agentSteps: steps, _usage: sawUsage ? totalUsage : undefined };
      container.push(msgObj);
      save();
      run.status = 'done';

      // Only touch #messages if this chat is still on screen — otherwise
      // the saved reply renders normally next time it opens (matching
      // guard in chat-send.js's _attachAIActions()).
      if (chat === currentChat()) {
        // Upgrade the live bubble into its final interactive form (same
        // helper the streaming path uses), after dropping the run-only
        // footer (token counter + stop button).
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
    // deletion failed — reuse the matching server-side project instead of
    // rejecting its folder.
    const normalizedPath = String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const localMatch = state.folders.find(f => f.agentProject && String(f.agentProjectPath || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === normalizedPath);
    if (localMatch) throw new Error(t('agent.projectAlreadyAdded'));
    const remoteMatch = (await apiListProjects()).find(p => String(p.path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === normalizedPath);
    const reg = remoteMatch || await apiCreateProject(name, path, create);
    const folder = {
      id: 'proj_' + Date.now(), name, collapsed: false, agentProject: reg.id, agentProjectPath: reg.path,
      agentAutonomy: settings.autonomy || 'confirm',
    };
    state.folders.push(folder);
    save(); renderSidebar();
    return folder;
  }
  function currentProjectFolder() {
    const chat = currentChat();
    if (!chat || !chat.folderId) return null;
    const folder = state.folders.find(f => f.id === chat.folderId);
    return (folder && folder.agentProject) ? folder : null;
  }
  async function deleteProjectFolder(folder) {
    if (!folder || !folder.agentProject) return;
    const inside = state.chats.filter(c => c.folderId === folder.id);
    if (!confirm(tf('agent.confirmDeleteProject', { name: folder.name, n: inside.length }))) return;
    try {
      await apiDeleteProject(folder.agentProject);
    } catch (e) {
      // Don't remove the local folder/chats if the proxy failed to, or the
      // UI would claim success while it's still registered.
      showToast(`❌ ${e.message}`);
      return;
    }
    // Deleting a project deletes its chats too (previously only unlinked
    // them, leaving them as regular chats despite the confirm dialog).
    state.chats = state.chats.filter(c => c.folderId !== folder.id);
    state.folders = state.folders.filter(f => f.id !== folder.id);
    if (typeof state.activeFolderId !== 'undefined' && state.activeFolderId === folder.id) state.activeFolderId = null;
    if (state.currentChatId && !state.chats.some(c => c.id === state.currentChatId)) {
      state.currentChatId = state.chats[0]?.id || null;
      if (state.currentChatId) renderMessages(currentChat().messages);
      else { const c = document.getElementById('messages'); c.innerHTML = ''; const e = document.getElementById('emptyState'); if (e) { c.appendChild(e); e.style.display = ''; } syncComposerStreamingUI(); }
    }
    save(); renderSidebar();
    showToast(t('agent.projectDeleted'));
  }

  // Focuses a project for the composer: reuses the current chat if empty,
  // else starts a fresh one filed into that project.
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
.agent-proj-row{position:relative;}
.agent-proj-history-btn{background:none;border:none;color:var(--muted,#888);cursor:pointer;font-size:12px;}
.agent-proj-history-btn:hover{color:var(--text,#eee);}
.gh-tabs{display:flex;gap:4px;margin-bottom:10px;border-bottom:1px solid var(--border,rgba(128,128,128,.2));}
.gh-tab{padding:6px 10px;border:none;background:none;color:var(--muted,#888);cursor:pointer;font-size:12px;border-bottom:2px solid transparent;margin-bottom:-1px;}
.gh-tab.active{color:var(--text,#eee);border-bottom-color:var(--accent,#3d7eff);font-weight:600;}
.gh-body{flex:1;min-height:200px;max-height:56vh;overflow-y:auto;}
.gh-empty{padding:24px 8px;text-align:center;color:var(--muted,#888);font-size:12px;}
.gh-commit{border:1px solid var(--border,rgba(128,128,128,.18));border-radius:8px;margin-bottom:6px;overflow:hidden;}
.gh-commit-head{display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;}
.gh-commit-head:hover{background:var(--surface2,rgba(128,128,128,.08));}
.gh-commit-main{flex:1;min-width:0;}
.gh-commit-msg{font-size:12.5px;color:var(--text,#eee);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.gh-commit-meta{font-size:10.5px;color:var(--muted,#888);margin-top:2px;}
.gh-commit-files{border-top:1px solid var(--border,rgba(128,128,128,.15));padding:4px 0;}
.gh-file-row{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;}
.gh-file-row:hover{background:var(--surface2,rgba(128,128,128,.06));}
.gh-file-badge{flex-shrink:0;}
.gh-file-path{flex:1;min-width:0;word-break:break-all;color:var(--text,#eee);}
.gh-file-restore,.gh-restore-all{background:none;border:1px solid var(--border,rgba(128,128,128,.25));border-radius:6px;color:var(--text,#eee);cursor:pointer;font-size:13px;padding:2px 8px;flex-shrink:0;}
.gh-file-restore:hover,.gh-restore-all:hover{border-color:var(--accent,#3d7eff);color:var(--accent,#3d7eff);}
.gh-deleted-row .gh-commit-meta{margin-top:1px;}
.gh-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:11px;color:var(--muted,#888);}
.gh-toolbar .agent-small-btn{font-size:11px;padding:3px 8px;}
.gh-group-badge{flex-shrink:0;font-size:10.5px;color:var(--muted,#888);border:1px solid var(--border,rgba(128,128,128,.25));border-radius:10px;padding:1px 7px;}
.gh-group-inner{border-top:1px solid var(--border,rgba(128,128,128,.15));padding:6px 8px 2px;display:flex;flex-direction:column;gap:6px;}
.gh-group-inner .gh-commit{margin-bottom:0;}
.gh-actions{display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
.gh-search-row{display:flex;align-items:center;gap:4px;flex:1;min-width:160px;}
.gh-search-row select{padding:4px 5px;border-radius:6px;border:1px solid var(--border,rgba(128,128,128,.25));background:var(--surface2,rgba(128,128,128,.08));color:var(--text,#eee);font-size:11px;}
.gh-search-row input{flex:1;min-width:0;padding:4px 7px;border-radius:6px;border:1px solid var(--border,rgba(128,128,128,.25));background:var(--surface2,rgba(128,128,128,.08));color:var(--text,#eee);font-size:11.5px;}
.gh-commit-actions{display:flex;align-items:center;gap:2px;flex-shrink:0;}
.gh-commit-actions .agent-small-btn{padding:2px 6px;font-size:12px;}
.gh-commit-diff{border-top:1px solid var(--border,rgba(128,128,128,.15));padding:6px;}
.gh-diff-pre{margin:0;font-size:10.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:280px;overflow-y:auto;font-family:ui-monospace,Consolas,monospace;color:var(--text,#eee);}
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

    // Project chip + settings gear + stop button share a framed group with
    // the mic/read-aloud controls.
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
    const curFolder = chat && state.folders.find(f => f.id === chat.folderId);
    const projectFolders = state.folders.filter(f => f.agentProject);
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
    const folder = chat && state.folders.find(f => f.id === chat.folderId);
    const focused = !!(folder && folder.agentProject);
    if (chip && label) {
      chip.classList.toggle('agent-focused', focused);
      chip.firstChild.textContent = focused ? '🤖 ' : '📁 ';
      label.textContent = focused ? folder.name : t('agent.noProject');
    }
    // The gear only leads anywhere useful while a project is focused (its
    // panel is entirely project-scoped settings + a "pick a project first"
    // hint otherwise) - hide it in plain-chat mode instead of showing a
    // button that mostly just tells you it can't do anything yet.
    const gearBtn = document.getElementById('agentGearBtn');
    if (gearBtn) gearBtn.hidden = !focused;
    if (hdrBtn && hdrLabel) {
      hdrBtn.classList.toggle('agent-focused', focused);
      hdrBtn.firstChild.textContent = focused ? '🤖 ' : '📁 ';
      hdrLabel.textContent = focused ? folder.name : t('agent.noProject');
    }
    // The composer's own "Web" button/popover looks and behaves differently
    // while a project is focused (see web-search.js) — nothing else calls
    // updateWebSearchButton() on a chat/project switch, only on the web
    // module's own state changes, so it needs an explicit nudge here.
    updateWebSearchButton();
    // Same reasoning for Battle-Modus (core/state.js) — it has no meaning
    // in project/agent mode and needs to hide/show on every chat switch,
    // not just its own popover's internal state changes.
    if (typeof window.refreshBattlePopoverUI === 'function') window.refreshBattlePopoverUI();
  }
  // Compact human-readable token count (850 -> "850", 12400 -> "12.4K").
  // Kept local, not a currency formatter — only needs to be short and rough.
  function formatTokenCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  // Live running-cost total under the streaming bubble (composer bar can't
  // tie to a specific run). Created as a sibling of the bubble so
  // rerenderCurrentRun()'s innerHTML resets never wipe it; removed when the
  // run ends. `run` should be passed explicitly by the tool loop; falls
  // back to _agentRun() otherwise.
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
          <span id="agentWebSearchLabel">🌐 ${esc(t('agent.webSearchLabel'))}</span>
          <label class="agent-toggle-switch"><input type="checkbox" id="agentWebSearchToggle"><span class="agent-toggle-slider"></span></label>
        </div>
        <div class="agent-hint" id="agentWebSearchHint" style="font-size:10px;color:var(--muted);">${esc(t('agent.webSearchHint'))}</div>
        <div class="setting-label" style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">
          <span id="agentCheckpointLabel">🕘 ${esc(t('agent.checkpointLabel'))}</span>
          <label class="agent-toggle-switch"><input type="checkbox" id="agentCheckpointToggle"><span class="agent-toggle-slider"></span></label>
        </div>
        <div class="agent-hint" id="agentCheckpointHint" style="font-size:10px;color:var(--muted);">${esc(t('agent.checkpointHint'))}</div>
        <button class="agent-small-btn" id="agentOpenHistoryBtn" style="margin-top:6px;width:100%;padding:6px;border-radius:7px;border:1px solid var(--border,rgba(128,128,128,.25));background:none;color:var(--text,#eee);cursor:pointer;font-size:11.5px;">🕘 ${esc(t('agent.gitHistory'))}</button>
        <div class="setting-group" style="margin-top:12px;">
          <div class="setting-label" style="display:flex;align-items:center;justify-content:space-between;">
            <span id="agentMaxIterLabel">🔁 ${esc(t('agent.maxIterLabel'))}</span>
            <input type="number" id="agentMaxIterInput" min="10" max="1000" step="10" style="width:68px;text-align:right;background:none;border:1px solid var(--border,rgba(128,128,128,.25));border-radius:6px;color:var(--text,#eee);font-size:12px;padding:3px 6px;">
          </div>
          <div class="agent-hint" id="agentMaxIterHint" style="font-size:10px;color:var(--muted);">${esc(t('agent.maxIterHint'))}</div>
        </div>
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
    document.getElementById('agentWebSearchToggle').addEventListener('change', e => {
      // Purely a client-side/per-folder flag (unlike Shell/Checkpoints,
      // there's no server-side re-check to update — web_search/fetch_url
      // run entirely through the already-configured search proxy, with no
      // extra permission for the server to grant). See toolSchema() for
      // where this actually takes effect.
      const folder = currentProjectFolder();
      const box = e.target;
      if (!folder) { box.checked = true; return; }
      folder.agentWebSearchEnabled = box.checked;
      save();
      showToast(box.checked ? t('agent.webSearchOn') : t('agent.webSearchOff'));
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
    document.getElementById('agentOpenHistoryBtn').addEventListener('click', () => {
      const folder = currentProjectFolder();
      if (!folder) return;
      panel.classList.remove('open');
      openGitHistoryPanel(folder);
    });
    document.getElementById('agentMaxIterInput').addEventListener('change', e => {
      const folder = currentProjectFolder();
      const input = e.target;
      if (!folder) return;
      const val = Math.max(10, Math.min(1000, parseInt(input.value, 10) || MAX_ITERATIONS));
      input.value = val;
      folder.agentMaxIterations = val;
      save();
    });
    panel.addEventListener('click', e => e.stopPropagation());
    // Close on any click elsewhere — gear button and panel handlers both
    // stop propagation, so clicking inside never triggers this.
    document.addEventListener('click', () => panel.classList.remove('open'));
  }

  // Folder picker: browse real OS folders to pick/create a project root.
  // editFolder is null for a new project, or the existing folder object
  // when re-pointing one.
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
  // Re-opens the folder picker to change an EXISTING project's target
  // folder. Name field is locked; starts at the current path.
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
    const webSearchToggle = document.getElementById('agentWebSearchToggle');
    if (webSearchToggle) webSearchToggle.checked = folder.agentWebSearchEnabled !== false;
    const checkpointToggle = document.getElementById('agentCheckpointToggle');
    if (checkpointToggle) checkpointToggle.checked = !!folder.agentCheckpointsEnabled;
    const maxIterInput = document.getElementById('agentMaxIterInput');
    if (maxIterInput) maxIterInput.value = effectiveMaxIterations(folder);
    document.querySelectorAll('#agentAutonomyRow .agent-chip').forEach(c => c.classList.toggle('selected', c.dataset.mode === mode));
    const d = document.getElementById('agentAutonomyDesc');
    if (d) d.textContent = t('agent.mode.' + mode);
  }
  async function renderProjectList() {
    const list = document.getElementById('agentProjList');
    if (!list) return;
    const projectFolders = state.folders.filter(f => f.agentProject);
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
    const maxIterInput = document.getElementById('agentMaxIterInput');
    if (maxIterInput && focused) maxIterInput.value = effectiveMaxIterations(focused);
    list.innerHTML = projectFolders.length ? '' : `<div style="font-size:11px;color:var(--muted);">${esc(t('agent.noProjects'))}</div>`;
    projectFolders.forEach(f => {
      const missing = missingIds.has(f.agentProject);
      const row = document.createElement('div');
      row.className = 'agent-proj-row' + (missing ? ' missing' : '');
      const title = missing ? esc(t('agent.projectMissing')) : esc(f.agentProjectPath || '');
      row.innerHTML = `<span title="${title}">${missing ? '⚠️' : '🤖'} ${esc(f.name)}</span><button class="agent-proj-history-btn" title="${esc(t('agent.gitHistory'))}">🕘</button><button class="agent-proj-edit-btn" title="${esc(t('agent.changeFolder'))}">✏️</button><button title="${esc(t('agent.deleteProject'))}">🗑</button>`;
      row.querySelector('.agent-proj-history-btn').addEventListener('click', () => openGitHistoryPanel(f));
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
  // ── Git history / restore panel ─────────────────────────────────────
  // Browses checkpoint history and restores a single file (incl. deleted
  // ones) or the whole project to an earlier state. Every restore itself
  // becomes a new checkpoint, so nothing here is a one-way door.
  const STATUS_BADGE = { added: '🟢', modified: '🟡', deleted: '🔴', renamed: '🔀' };
  const STATUS_LABEL_KEY = { added: 'agent.ghStatusAdded', modified: 'agent.ghStatusModified', deleted: 'agent.ghStatusDeleted', renamed: 'agent.ghStatusRenamed' };
  function ghStatusLabel(status) {
    return t(STATUS_LABEL_KEY[status] || status, status);
  }
  let _gh = { folder: null, tab: 'log', commits: [], deleted: [], milestones: [], expanded: null, expandedData: null, loading: false, noRepo: false, expandedGroups: new Set(), repoBytes: null, gcRunning: false, searchQuery: '', searchMode: 'message', searching: false, searchActive: false, diffFor: null, diffText: null, diffLoading: false, busyHash: null };
  // Strings go through the same t()/tf() as elsewhere; see _lang/*.js's
  // "agent.gh*" entries.

  function injectGitHistoryModal() {
    const overlay = document.createElement('div');
    overlay.className = 'agent-modal-overlay';
    overlay.id = 'agentGitHistoryOverlay';
    overlay.innerHTML = `
      <div class="agent-modal" id="agentGitHistoryModal" style="width:560px;">
        <div class="agent-modal-title"><span>🕘 <span id="ghTitle">${esc(t('agent.gitHistory'))}</span></span><button class="close-btn" id="ghClose">✕</button></div>
        <div class="gh-tabs">
          <button class="gh-tab active" data-tab="log" id="ghTabLog">${esc(t('agent.ghTabCheckpoints'))}</button>
          <button class="gh-tab" data-tab="milestones" id="ghTabMilestones">${esc(t('agent.ghTabMilestones'))}</button>
          <button class="gh-tab" data-tab="deleted" id="ghTabDeleted">${esc(t('agent.ghTabDeleted'))}</button>
        </div>
        <div class="gh-actions" id="ghActions">
          <button class="agent-small-btn" id="ghCommitBtn" title="${esc(t('agent.ghCommitNowHint'))}">📸 ${esc(t('agent.ghCommitNow'))}</button>
          <button class="agent-small-btn" id="ghDiscardBtn" title="${esc(t('agent.ghDiscardHint'))}">↺ ${esc(t('agent.ghDiscard'))}</button>
          <div class="gh-search-row">
            <select id="ghSearchMode">
              <option value="message">${esc(t('agent.ghSearchMessage'))}</option>
              <option value="content">${esc(t('agent.ghSearchContent'))}</option>
            </select>
            <input type="text" id="ghSearchInput" placeholder="${esc(t('agent.ghSearchPlaceholder'))}" />
            <button class="agent-small-btn" id="ghSearchClearBtn" hidden>✕</button>
          </div>
        </div>
        <div class="gh-toolbar" id="ghToolbar">
          <span id="ghRepoSize"></span>
          <button class="agent-small-btn" id="ghGcBtn" title="${esc(t('agent.ghGcHint'))}">🧹 ${esc(t('agent.ghGc'))}</button>
        </div>
        <div class="gh-body" id="ghBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('ghClose').addEventListener('click', closeGitHistoryPanel);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeGitHistoryPanel(); });
    document.getElementById('ghGcBtn').addEventListener('click', runGhGc);
    document.getElementById('ghCommitBtn').addEventListener('click', runGhManualCommit);
    document.getElementById('ghDiscardBtn').addEventListener('click', runGhDiscard);
    const searchInput = document.getElementById('ghSearchInput');
    const searchModeSel = document.getElementById('ghSearchMode');
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runGhSearch(); });
    document.getElementById('ghSearchClearBtn').addEventListener('click', () => {
      searchInput.value = ''; _gh.searchActive = false; _gh.searchQuery = '';
      document.getElementById('ghSearchClearBtn').hidden = true;
      renderGitHistoryBody();
    });
    overlay.querySelector('.gh-tabs').addEventListener('click', e => {
      const btn = e.target.closest('.gh-tab'); if (!btn) return;
      _gh.tab = btn.dataset.tab; _gh.expanded = null;
      overlay.querySelectorAll('.gh-tab').forEach(b => b.classList.toggle('active', b === btn));
      document.getElementById('ghActions').style.display = _gh.tab === 'log' ? '' : 'none';
      document.getElementById('ghToolbar').style.display = _gh.tab === 'log' ? '' : 'none';
      renderGitHistoryBody();
    });
  }
  async function openGitHistoryPanel(folder) {
    const overlay = document.getElementById('agentGitHistoryOverlay');
    if (!overlay || !folder) return;
    _gh = { folder, tab: 'log', commits: [], deleted: [], milestones: [], expanded: null, expandedData: null, loading: true, noRepo: false, expandedGroups: new Set(), repoBytes: null, gcRunning: false, searchQuery: '', searchMode: 'message', searching: false, searchActive: false, diffFor: null, diffText: null, diffLoading: false, busyHash: null };
    const sizeElInit = document.getElementById('ghRepoSize');
    if (sizeElInit) sizeElInit.textContent = '';
    document.getElementById('ghTitle').textContent = `${t('agent.gitHistory')} — ${folder.name}`;
    overlay.querySelectorAll('.gh-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'log'));
    const actionsEl = document.getElementById('ghActions'), toolbarEl = document.getElementById('ghToolbar');
    if (actionsEl) actionsEl.style.display = '';
    if (toolbarEl) toolbarEl.style.display = '';
    const searchInput = document.getElementById('ghSearchInput');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('ghSearchClearBtn');
    if (clearBtn) clearBtn.hidden = true;
    overlay.classList.add('open');
    renderGitHistoryBody();
    try {
      const [logRes, delRes, msRes] = await Promise.all([
        apiGitLog(folder.agentProject),
        apiGitDeleted(folder.agentProject),
        apiGitMilestones(folder.agentProject),
      ]);
      _gh.commits = logRes.commits || [];
      _gh.deleted = delRes.files || [];
      _gh.milestones = msRes.milestones || [];
      _gh.noRepo = _gh.commits.length === 0 && _gh.deleted.length === 0;
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
    _gh.loading = false;
    renderGitHistoryBody();
  }
  function closeGitHistoryPanel() {
    const overlay = document.getElementById('agentGitHistoryOverlay');
    if (overlay) overlay.classList.remove('open');
  }
  function ghFormatDate(iso) {
    // git's `--date=iso` format has two spaces, not one — a plain
    // single-match .replace(' ','T') leaves one behind and Date() can't
    // parse it. Strip both, and localize with the app's language.
    try {
      const d = new Date(iso.replace(' ', 'T').replace(' ', ''));
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString(state.currentLang);
    } catch (e) { return iso; }
  }
  function ghFormatBytes(n) {
    if (typeof n !== 'number' || isNaN(n)) return '?';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB'];
    let v = n / 1024, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
  }
  // Groups consecutive commits sharing a "Run: <id>" trailer (see
  // checkpointMessage()) into one collapsible entry. Since git log is
  // newest-first and a run's checkpoints are always back-to-back, a simple
  // "same runId as previous" scan suffices. Commits without a runId each
  // become their own group.
  function ghGroupCommits(commits) {
    const groups = [];
    let cur = null;
    commits.forEach(c => {
      if (c.runId && cur && cur.runId === c.runId) {
        cur.commits.push(c);
      } else {
        cur = { runId: c.runId || null, key: c.runId || c.hash, commits: [c] };
        groups.push(cur);
      }
    });
    return groups;
  }
  async function runGhGc() {
    if (_gh.gcRunning || !_gh.folder) return;
    _gh.gcRunning = true;
    const btn = document.getElementById('ghGcBtn');
    if (btn) { btn.disabled = true; btn.textContent = `⏳ ${esc(t('agent.ghGc'))}`; }
    try {
      const res = await apiGitGc(_gh.folder.agentProject);
      _gh.repoBytes = { before: res.before, after: res.after };
      const sizeEl = document.getElementById('ghRepoSize');
      if (sizeEl) sizeEl.textContent = `${ghFormatBytes(res.before)} → ${ghFormatBytes(res.after)}`;
      showToast(`✅ ${t('agent.ghGcDone')}`);
    } catch (e) {
      showToast(`❌ ${e.message}`);
    } finally {
      _gh.gcRunning = false;
      if (btn) { btn.disabled = false; btn.textContent = `🧹 ${esc(t('agent.ghGc'))}`; }
    }
  }
  function renderGitHistoryBody() {
    const body = document.getElementById('ghBody');
    if (!body) return;
    if (_gh.loading) {
      body.innerHTML = `<div class="gh-empty">${esc(t('agent.loading'))}</div>`;
      return;
    }
    if (_gh.tab === 'deleted') { renderGhDeletedTab(body); return; }
    if (_gh.tab === 'milestones') { renderGhMilestonesTab(body); return; }
    renderGhLogTab(body);
  }
  function _ghMilestoneFor(hash) {
    return _gh.milestones.find(m => m.hash === hash) || null;
  }
  function buildGhCommitRow(c) {
    const row = document.createElement('div');
    row.className = 'gh-commit';
    const expanded = _gh.expanded === c.hash;
    const diffOpen = _gh.diffFor === c.hash;
    const pin = _ghMilestoneFor(c.hash);
    const index = _gh.commits.findIndex(x => x.hash === c.hash);
    row.innerHTML = `
      <div class="gh-commit-head">
        <div class="gh-commit-main">
          <div class="gh-commit-msg">${pin ? `📌 ${esc(pin.name)} — ` : ''}${esc(c.message)}</div>
          <div class="gh-commit-meta">${esc(ghFormatDate(c.date))} · <code>${esc(c.shortHash)}</code>${c.note ? ` · 📝 ${esc(c.note)}` : ''}</div>
        </div>
        <div class="gh-commit-actions">
          <button class="agent-small-btn gh-note-btn" title="${esc(t('agent.ghEditNote'))}">📝</button>
          <button class="agent-small-btn gh-pin-btn" title="${esc(pin ? t('agent.ghUnpin') : t('agent.ghPin'))}">📌</button>
          <button class="agent-small-btn gh-diff-btn" title="${esc(t('agent.ghShowDiff'))}">🔀</button>
          <button class="agent-small-btn gh-export-btn" title="${esc(t('agent.ghExport'))}">📦</button>
          ${index > 0 ? `<button class="agent-small-btn gh-squash-btn" title="${esc(t('agent.ghSquashFromHere'))}">✂️</button>` : ''}
          <button class="agent-small-btn gh-restore-all" title="${esc(t('agent.ghRestoreWholeProject'))}">⏪</button>
        </div>
      </div>
      <div class="gh-commit-diff" ${diffOpen ? '' : 'hidden'}></div>
      <div class="gh-commit-files" ${expanded ? '' : 'hidden'}></div>
    `;
    row.querySelector('.gh-commit-head').addEventListener('click', e => {
      if (e.target.closest('.gh-commit-actions')) return;
      toggleGhCommit(c.hash);
    });
    row.querySelector('.gh-restore-all').addEventListener('click', async e => {
      e.stopPropagation();
      await confirmAndRestore({ hash: c.hash, label: tf('agent.ghRestoreWholeProjectConfirm', { msg: c.message, date: ghFormatDate(c.date) }) });
    });
    row.querySelector('.gh-note-btn').addEventListener('click', e => { e.stopPropagation(); runGhEditNote(c); });
    row.querySelector('.gh-pin-btn').addEventListener('click', e => { e.stopPropagation(); runGhTogglePin(c); });
    row.querySelector('.gh-diff-btn').addEventListener('click', e => { e.stopPropagation(); toggleGhDiff(c); });
    row.querySelector('.gh-export-btn').addEventListener('click', e => { e.stopPropagation(); runGhExport(c); });
    const squashBtn = row.querySelector('.gh-squash-btn');
    if (squashBtn) squashBtn.addEventListener('click', e => { e.stopPropagation(); runGhSquash(c, index); });
    if (diffOpen) {
      const diffEl = row.querySelector('.gh-commit-diff');
      if (_gh.diffLoading) diffEl.innerHTML = `<div class="gh-empty" style="padding:8px;">${esc(t('agent.loading'))}</div>`;
      else diffEl.innerHTML = `<pre class="gh-diff-pre">${esc(_gh.diffText || t('agent.ghNoDiff'))}</pre>`;
    }
    if (expanded) renderGhCommitFiles(row.querySelector('.gh-commit-files'), c);
    return row;
  }
  function renderGhLogTab(body) {
    if (_gh.searching) {
      body.innerHTML = `<div class="gh-empty">${esc(t('agent.loading'))}</div>`;
      return;
    }
    if (!_gh.commits.length) {
      const emptyMsg = _gh.searchActive ? t('agent.ghNoSearchResults')
        : (_gh.folder && _gh.folder.agentCheckpointsEnabled ? t('agent.ghNoCommitsYet') : t('agent.ghCheckpointsOff'));
      body.innerHTML = `<div class="gh-empty">${esc(emptyMsg)}</div>`;
      return;
    }
    body.innerHTML = '';
    ghGroupCommits(_gh.commits).forEach(g => {
      if (g.commits.length === 1) {
        body.appendChild(buildGhCommitRow(g.commits[0]));
        return;
      }
      // Multi-commit group: newest commit heads the row (restoring to it
      // already includes every earlier one in the run); expanding reveals
      // the individual checkpoints.
      const head = g.commits[0];
      const wrap = document.createElement('div');
      wrap.className = 'gh-commit';
      const isOpen = _gh.expandedGroups.has(g.key);
      wrap.innerHTML = `
        <div class="gh-commit-head">
          <div class="gh-commit-main">
            <div class="gh-commit-msg">${esc(head.message)}</div>
            <div class="gh-commit-meta">${esc(ghFormatDate(head.date))} · <span class="gh-group-badge">${esc(tf('agent.ghGroupCount', { n: g.commits.length }))}</span></div>
          </div>
          <button class="agent-small-btn gh-restore-all" title="${esc(t('agent.ghRestoreWholeProject'))}">⏪</button>
        </div>
        <div class="gh-group-inner" ${isOpen ? '' : 'hidden'}></div>
      `;
      wrap.querySelector('.gh-commit-head').addEventListener('click', e => {
        if (e.target.closest('.gh-restore-all')) return;
        if (_gh.expandedGroups.has(g.key)) _gh.expandedGroups.delete(g.key);
        else _gh.expandedGroups.add(g.key);
        renderGhLogTab(document.getElementById('ghBody'));
      });
      wrap.querySelector('.gh-restore-all').addEventListener('click', async e => {
        e.stopPropagation();
        await confirmAndRestore({ hash: head.hash, label: tf('agent.ghRestoreWholeProjectConfirm', { msg: head.message, date: ghFormatDate(head.date) }) });
      });
      if (isOpen) {
        const inner = wrap.querySelector('.gh-group-inner');
        g.commits.forEach(c => inner.appendChild(buildGhCommitRow(c)));
      }
      body.appendChild(wrap);
    });
  }
  async function toggleGhCommit(hash) {
    if (_gh.expanded === hash) { _gh.expanded = null; renderGhLogTab(document.getElementById('ghBody')); return; }
    _gh.expanded = hash;
    _gh.expandedData = null;
    renderGhLogTab(document.getElementById('ghBody'));
    try {
      _gh.expandedData = await apiGitCommit(_gh.folder.agentProject, hash);
    } catch (e) {
      showToast(`❌ ${e.message}`);
      _gh.expanded = null;
    }
    renderGhLogTab(document.getElementById('ghBody'));
  }
  function renderGhCommitFiles(container, c) {
    if (!container) return;
    if (!_gh.expandedData) { container.innerHTML = `<div class="gh-empty" style="padding:8px;">${esc(t('agent.loading'))}</div>`; return; }
    const files = _gh.expandedData.files || [];
    if (!files.length) { container.innerHTML = `<div class="gh-empty" style="padding:8px;">${esc(t('agent.ghNoFileChanges'))}</div>`; return; }
    container.innerHTML = '';
    files.forEach(f => {
      const row = document.createElement('div');
      row.className = 'gh-file-row';
      row.innerHTML = `<span class="gh-file-badge" title="${esc(ghStatusLabel(f.status))}">${STATUS_BADGE[f.status] || '•'}</span><span class="gh-file-path">${esc(f.path)}</span><button class="gh-file-restore" title="${esc(t('agent.ghRestoreFile'))}">↺</button>`;
      row.querySelector('.gh-file-restore').addEventListener('click', async () => {
        await confirmAndRestore({ hash: c.hash, paths: [f.path], label: tf('agent.ghRestoreFileConfirm', { path: f.path, date: ghFormatDate(c.date) }) });
      });
      container.appendChild(row);
    });
  }
  function renderGhDeletedTab(body) {
    if (!_gh.deleted.length) {
      body.innerHTML = `<div class="gh-empty">${esc(t('agent.ghNoDeletedFiles'))}</div>`;
      return;
    }
    body.innerHTML = '';
    _gh.deleted.forEach(d => {
      const row = document.createElement('div');
      row.className = 'gh-file-row gh-deleted-row';
      row.innerHTML = `<span class="gh-file-badge" title="${esc(ghStatusLabel('deleted'))}">🔴</span><span class="gh-file-path">${esc(d.path)}<div class="gh-commit-meta">${esc(t('agent.ghDeletedOn'))} ${esc(ghFormatDate(d.deletedAt))}</div></span><button class="gh-file-restore" title="${esc(t('agent.ghRestoreFile'))}">↺</button>`;
      row.querySelector('.gh-file-restore').addEventListener('click', async () => {
        await confirmAndRestore({ hash: d.restoreHash, paths: [d.path], label: tf('agent.ghRestoreDeletedConfirm', { path: d.path }), afterRefreshDeleted: true });
      });
      body.appendChild(row);
    });
  }
  // Shared confirm+call+refresh for every restore action (single file,
  // deleted file, or whole project) — one place to keep the UX consistent.
  async function confirmAndRestore({ hash, paths, label, afterRefreshDeleted }) {
    if (!confirm(label)) return;
    try {
      const res = await apiGitRestore(_gh.folder.agentProject, hash, paths);
      showToast(`✅ ${t('agent.ghRestored')}`);
      // Re-pull log + deleted list so the new "Restored ..." checkpoint and
      // any now-recreated file show up immediately.
      const [logRes, delRes] = await Promise.all([
        apiGitLog(_gh.folder.agentProject),
        apiGitDeleted(_gh.folder.agentProject),
      ]);
      _gh.commits = logRes.commits || [];
      _gh.deleted = delRes.files || [];
      _gh.expanded = null;
      renderGitHistoryBody();
      _readFileCache.clear();
      if (afterRefreshDeleted) { /* deleted list already refreshed above */ }
      return res;
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  }

  // Shared re-fetch for anything that changes the commit list (manual
  // commit, discard, note edit, pin/unpin, squash) without a full restore.
  async function refreshGhAfterMutation() {
    try {
      const [logRes, msRes] = await Promise.all([
        apiGitLog(_gh.folder.agentProject),
        apiGitMilestones(_gh.folder.agentProject),
      ]);
      _gh.commits = logRes.commits || [];
      _gh.milestones = msRes.milestones || [];
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
    _gh.expanded = null;
    _gh.diffFor = null;
    renderGitHistoryBody();
  }

  // ── Manual "commit now" (📸) — works even with auto-checkpoints off,
  // see agent_git_manual_commit() in kiconnect-proxy.py.
  async function runGhManualCommit() {
    if (!_gh.folder) return;
    const message = prompt(t('agent.ghCommitNowPrompt'), '');
    if (message === null) return;
    const btn = document.getElementById('ghCommitBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiGitManualCommit(_gh.folder.agentProject, message);
      if (res.committed === false) showToast(`ℹ️ ${t('agent.ghNothingToCommit')}`);
      else showToast(`✅ ${t('agent.ghCommitted')}`);
      await refreshGhAfterMutation();
    } catch (e) {
      showToast(`❌ ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Discard everything since the last checkpoint (↺). Destructive and
  // irreversible for anything that was never committed, so confirm first.
  async function runGhDiscard() {
    if (!_gh.folder) return;
    if (!confirm(t('agent.ghDiscardConfirm'))) return;
    const btn = document.getElementById('ghDiscardBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiGitDiscard(_gh.folder.agentProject);
      if (!res.discarded || !res.discarded.length) showToast(`ℹ️ ${t('agent.ghNothingToDiscard')}`);
      else showToast(`✅ ${tf('agent.ghDiscarded', { n: res.discarded.length })}`);
      _readFileCache.clear();
      await refreshGhAfterMutation();
    } catch (e) {
      showToast(`❌ ${e.message}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── History search (🔍) — by commit message or by content added/removed
  // (git's "pickaxe" search). Replaces the log tab's list in place; clear
  // via the ✕ button to go back to the full history.
  async function runGhSearch() {
    if (!_gh.folder) return;
    const input = document.getElementById('ghSearchInput');
    const q = (input && input.value || '').trim();
    if (!q) return;
    _gh.searchMode = document.getElementById('ghSearchMode').value;
    _gh.searching = true;
    renderGhLogTab(document.getElementById('ghBody'));
    try {
      const res = await apiGitSearch(_gh.folder.agentProject, q, _gh.searchMode);
      _gh.commits = res.commits || [];
      _gh.searchActive = true;
      _gh.searchQuery = q;
      document.getElementById('ghSearchClearBtn').hidden = false;
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
    _gh.searching = false;
    renderGhLogTab(document.getElementById('ghBody'));
  }

  // ── Note / rename (📝) — stored as a git note, never rewrites the
  // commit itself (see /agent/git/<id>/note/<hash> comment in the proxy).
  async function runGhEditNote(c) {
    const value = prompt(t('agent.ghNotePrompt'), c.note || '');
    if (value === null) return;
    try {
      await apiGitSetNote(_gh.folder.agentProject, c.hash, value.trim());
      showToast(`✅ ${t('agent.ghNoteSaved')}`);
      await refreshGhAfterMutation();
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  }

  // ── Milestone pin/unpin (📌) — lightweight tag under refs/tags/ms/.
  async function runGhTogglePin(c) {
    const existing = _ghMilestoneFor(c.hash);
    if (existing) {
      if (!confirm(tf('agent.ghUnpinConfirm', { name: existing.name }))) return;
      try {
        await apiGitRemoveMilestone(_gh.folder.agentProject, existing.name);
        showToast(`✅ ${t('agent.ghUnpinned')}`);
        await refreshGhAfterMutation();
      } catch (e) {
        showToast(`❌ ${e.message}`);
      }
      return;
    }
    const name = prompt(t('agent.ghPinPrompt'), '');
    if (!name) return;
    try {
      await apiGitAddMilestone(_gh.folder.agentProject, c.hash, name.trim());
      showToast(`✅ ${t('agent.ghPinned')}`);
      await refreshGhAfterMutation();
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  }

  // ── Diff vs. the previous checkpoint (🔀) — toggled inline under the row.
  async function toggleGhDiff(c) {
    if (_gh.diffFor === c.hash) { _gh.diffFor = null; renderGhLogTab(document.getElementById('ghBody')); return; }
    _gh.diffFor = c.hash;
    _gh.diffText = null;
    _gh.diffLoading = true;
    renderGhLogTab(document.getElementById('ghBody'));
    try {
      const res = await apiGitDiff(_gh.folder.agentProject, `${c.hash}~1`, c.hash);
      _gh.diffText = res.diff || '';
    } catch (e) {
      // No parent (first-ever checkpoint) or other failure - show as text
      // instead of a toast so it doesn't get lost once the row re-renders.
      _gh.diffText = `⚠️ ${e.message}`;
    }
    _gh.diffLoading = false;
    renderGhLogTab(document.getElementById('ghBody'));
  }

  // ── Export a checkpoint's full snapshot as a zip (📦).
  async function runGhExport(c) {
    try {
      await apiGitExportDownload(_gh.folder.agentProject, c.hash);
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  }

  // ── Squash this checkpoint through HEAD into one commit (✂️). Only
  // offered on non-newest rows (squashing needs at least 2 commits, and
  // the backend refuses ranges containing a pinned milestone - see
  // agent_git_squash()).
  async function runGhSquash(c, index) {
    if (index === 0) return; // nothing after it to squash together with
    const n = index + 1;
    const message = prompt(tf('agent.ghSquashPrompt', { n }), '');
    if (message === null) return;
    try {
      const res = await apiGitSquash(_gh.folder.agentProject, c.hash, message);
      showToast(`✅ ${tf('agent.ghSquashed', { n: res.squashed })}`);
      await refreshGhAfterMutation();
    } catch (e) {
      showToast(`❌ ${e.message}`);
    }
  }

  function renderGhMilestonesTab(body) {
    if (!_gh.milestones.length) {
      body.innerHTML = `<div class="gh-empty">${esc(t('agent.ghNoMilestones'))}</div>`;
      return;
    }
    body.innerHTML = '';
    _gh.milestones.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(m => {
      const commit = _gh.commits.find(c => c.hash === m.hash);
      const row = document.createElement('div');
      row.className = 'gh-commit';
      row.innerHTML = `
        <div class="gh-commit-head">
          <div class="gh-commit-main">
            <div class="gh-commit-msg">📌 ${esc(m.name)}</div>
            <div class="gh-commit-meta">${esc(commit ? commit.message : t('agent.ghCheckpointNotInRange'))} · <code>${esc(m.hash.slice(0, 12))}</code></div>
          </div>
          <button class="agent-small-btn gh-restore-all" title="${esc(t('agent.ghRestoreWholeProject'))}">⏪</button>
          <button class="agent-small-btn gh-unpin-btn" title="${esc(t('agent.ghUnpin'))}">📌</button>
        </div>
      `;
      row.querySelector('.gh-restore-all').addEventListener('click', async () => {
        await confirmAndRestore({ hash: m.hash, label: tf('agent.ghRestoreWholeProjectConfirm', { msg: m.name, date: ghFormatDate(m.date) }) });
      });
      row.querySelector('.gh-unpin-btn').addEventListener('click', async () => {
        if (!confirm(tf('agent.ghUnpinConfirm', { name: m.name }))) return;
        try {
          await apiGitRemoveMilestone(_gh.folder.agentProject, m.name);
          showToast(`✅ ${t('agent.ghUnpinned')}`);
          _gh.milestones = _gh.milestones.filter(x => x.name !== m.name);
          renderGitHistoryBody();
        } catch (e) {
          showToast(`❌ ${e.message}`);
        }
      });
      body.appendChild(row);
    });
  }

  function positionAgentSettingsPanel() {
    const panel = document.getElementById('agentSettingsPanel');
    const gear = document.getElementById('agentGearBtn');
    if (!panel || !gear) return;
    requestAnimationFrame(() => positionPanelNearAnchor(panel, gear, { fallbackWidth: 300, aboveThreshold: 220 }));
  }
  export function openAgentSettingsPanel() {
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
  //  Wiring into the host app (send interception, sidebar icons)
  function installHooks() {
    // sendMessage(): route to the agent loop when the active chat is
    // filed under a project folder; otherwise defer to the original.
    registerSendMessageOverride(async function (orig) {
      const chat = currentChat();
      const folder = chat && state.folders.find(f => f.id === chat.folderId);
      if (folder && folder.agentProject) {
        const input = document.getElementById('messageInput');
        const text = (input.value || '').trim();
        if (!text && !state.attachments.length) return;
        input.value = '';
        try { autoResize(input); } catch (e) {}
        const att = [...state.attachments];
        clearAttachments();
        await runAgentChatTurn(text, folder, att);
        return;
      }
      return orig();
    });

    // regenerate(): a project chat's "Regenerieren" button should re-run
    // the agent loop, not fall back to a tool-less completion.
    registerRegenerateOverride(async function (orig, idx) {
      if (await agentRegenerate(idx)) return;
      return orig(idx);
    });

    // Mark project folders + sync the composer chip whenever the sidebar
    // redraws — also covers newChat()/switchChat(), which call it internally.
    onRenderSidebar(function () {
      document.querySelectorAll('#folderContainer .folder[data-folder-id]').forEach(div => {
        const f = state.folders.find(x => x.id === div.dataset.folderId);
        if (f && f.agentProject) {
          div.classList.add('agent-project-folder');
          const icon = div.querySelector('.folder-icon');
          if (icon) icon.textContent = '🤖';
        }
      });
      syncComposerChip();
    });
  }

  // Applies t(key) to a batch of elements found by id, in place. Centralizes
  // the repetitive "getElementById -> null-guard -> set text/title/
  // placeholder from a translation, maybe with an icon prefix" triple that
  // used to be hand-rolled per element below. Adding a new translated hint
  // now means adding one row to a table next to its siblings, instead of a
  // standalone getElementById/if/set block that's easy to leave out (see:
  // agentMaxIterLabel/agentMaxIterHint, which shipped in the settings panel
  // markup but were missing here until this pass).
  // entries: [elementId, i18nKey, { attr?: 'textContent'|'title'|'placeholder', prefix?: string }]
  function _applyI18nBatch(entries) {
    entries.forEach(([id, key, opts]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el[opts?.attr || 'textContent'] = (opts?.prefix || '') + t(key);
    });
  }

  // Language change hook (see i18n.js's setLang()). Re-reads translated
  // text/title/placeholder in place so open panels update immediately.
  onLanguageChange(function () {
    // Composer chip + gear
    syncComposerChip();
    _applyI18nBatch([
      ['agentGearBtn', 'agent.settings', { attr: 'title' }],
      ['agentConfirmAccept', 'agent.accept'],
      ['agentConfirmReject', 'agent.reject'],
      ['agentHeaderToggle', 'agent.headerToggleTitle', { attr: 'title' }],
    ]);
    // Inline stop buttons under any currently-running run's bubble.
    document.querySelectorAll('.agent-inline-stop-btn').forEach(btn => {
      btn.textContent = '⏹ ' + t('agent.stop');
    });

    // Context menu (rebuilt fresh each open, nothing to patch while closed)
    const ctxMenuEl = document.getElementById('agentContextMenu');
    if (ctxMenuEl && !ctxMenuEl.hidden) renderContextMenu();

    // Settings popover: static labels, hints, mode chips, and project
    // rows (text depends on the focused project, so just re-run renderers).
    const settingsTitle = document.getElementById('agentSettingsProjectName');
    if (settingsTitle && !currentProjectFolder()) settingsTitle.textContent = t('agent.settingsTitle');
    const panel = document.getElementById('agentSettingsPanel');
    if (panel) {
      _applyI18nBatch([
        ['agentModelHint', 'agent.modelHint'],
        ['agentSettingsNoProject', 'agent.pickProjectFirst'],
        ['agentAutonomyLabel', 'agent.autonomy'],
        ['agentShellLabel', 'agent.shellLabel', { prefix: '⚡ ' }],
        ['agentShellHint', 'agent.shellHint'],
        ['agentWebSearchLabel', 'agent.webSearchLabel', { prefix: '🌐 ' }],
        ['agentWebSearchHint', 'agent.webSearchHint'],
        ['agentCheckpointLabel', 'agent.checkpointLabel', { prefix: '🕘 ' }],
        ['agentCheckpointHint', 'agent.checkpointHint'],
        ['agentMaxIterLabel', 'agent.maxIterLabel', { prefix: '🔁 ' }],
        ['agentMaxIterHint', 'agent.maxIterHint'],
        ['agentProjectsLabel', 'agent.projects'],
        ['agentOpenHistoryBtn', 'agent.gitHistory', { prefix: '🕘 ' }],
      ]);
      const chipAuto = panel.querySelector('.agent-chip[data-mode="auto"]');
      if (chipAuto) chipAuto.textContent = t('agent.autoMode');
      const chipConfirm = panel.querySelector('.agent-chip[data-mode="confirm"]');
      if (chipConfirm) chipConfirm.textContent = t('agent.confirmMode');
      const chipSimulate = panel.querySelector('.agent-chip[data-mode="simulate"]');
      if (chipSimulate) chipSimulate.textContent = t('agent.simulateMode');
      if (panel.classList.contains('open')) { renderAutonomyChips(); renderProjectList(); }
    }

    // Folder picker modal
    const fpTitle = document.querySelector('#agentFolderPickerModal .agent-modal-title span');
    if (fpTitle) fpTitle.textContent = '📁 ' + t('agent.pickFolder');
    _applyI18nBatch([
      ['fpUpBtn', 'agent.up', { attr: 'title' }],
      ['fpPathInput', 'agent.absPath', { attr: 'placeholder' }],
      ['fpGoBtn', 'agent.go'],
      ['fpNewFolderName', 'agent.newSubfolder', { attr: 'placeholder' }],
      ['fpProjectName', 'agent.projectNamePh', { attr: 'placeholder' }],
      ['fpConfirm', 'agent.useFolder'],
    ]);
    // Re-render the empty-state note in the folder list, if showing.
    const fpList = document.getElementById('fpList');
    if (fpList && fpList.querySelector('.fp-list-empty')) {
      fpList.innerHTML = `<div class="fp-list-empty">${esc(t('agent.noSubfolders'))}</div>`;
    }

    // Re-render any tool-call trace open in the live bubble so its
    // labels/status pick up the new language immediately.
    rerenderCurrentRun();
    // Already-finished agent replies had their tool labels baked in at
    // creation time — re-render each visible one from its stored
    // `_agentSteps` and persist the translated markdown.
    retranslateAgentHistory();

    // Git-history/restore modal: static chrome plus a full re-render of
    // the visible tab if open — commit text is recomputed from t()/tf() at
    // render time, so no reload is needed.
    const ghTitleEl = document.getElementById('ghTitle');
    if (ghTitleEl) ghTitleEl.textContent = _gh.folder ? `${t('agent.gitHistory')} — ${_gh.folder.name}` : t('agent.gitHistory');
    const ghTabLogEl = document.getElementById('ghTabLog');
    if (ghTabLogEl) ghTabLogEl.textContent = t('agent.ghTabCheckpoints');
    const ghTabDeletedEl = document.getElementById('ghTabDeleted');
    if (ghTabDeletedEl) ghTabDeletedEl.textContent = t('agent.ghTabDeleted');
    const ghTabMilestonesEl = document.getElementById('ghTabMilestones');
    if (ghTabMilestonesEl) ghTabMilestonesEl.textContent = t('agent.ghTabMilestones');
    // Checkpoint-toolbar (📸/↺ buttons + search bar) — added after the
    // original git-history-modal live-retranslate fix above, so it needs
    // the same treatment: static chrome only, no re-render needed.
    const ghCommitBtnEl = document.getElementById('ghCommitBtn');
    if (ghCommitBtnEl) {
      ghCommitBtnEl.textContent = `📸 ${t('agent.ghCommitNow')}`;
      ghCommitBtnEl.title = t('agent.ghCommitNowHint');
    }
    const ghDiscardBtnEl = document.getElementById('ghDiscardBtn');
    if (ghDiscardBtnEl) {
      ghDiscardBtnEl.textContent = `↺ ${t('agent.ghDiscard')}`;
      ghDiscardBtnEl.title = t('agent.ghDiscardHint');
    }
    const ghSearchModeEl = document.getElementById('ghSearchMode');
    if (ghSearchModeEl) {
      // Re-set each option's label in place (not innerHTML) so the
      // currently selected value survives the language switch.
      const ghSearchModeLabels = { message: 'agent.ghSearchMessage', content: 'agent.ghSearchContent' };
      Array.from(ghSearchModeEl.options).forEach(opt => {
        const key = ghSearchModeLabels[opt.value];
        if (key) opt.textContent = t(key);
      });
    }
    const ghSearchInputEl = document.getElementById('ghSearchInput');
    if (ghSearchInputEl) ghSearchInputEl.placeholder = t('agent.ghSearchPlaceholder');
    // GC button label carries state (⏳ running vs 🧹 idle) — re-set only
    // the icon-appropriate half so an in-progress run isn't clobbered.
    const ghGcBtnEl = document.getElementById('ghGcBtn');
    if (ghGcBtnEl) {
      ghGcBtnEl.textContent = `${_gh.gcRunning ? '⏳' : '🧹'} ${t('agent.ghGc')}`;
      ghGcBtnEl.title = t('agent.ghGcHint');
    }
    const ghOverlay = document.getElementById('agentGitHistoryOverlay');
    if (ghOverlay && ghOverlay.classList.contains('open')) { _gh.expanded = null; renderGitHistoryBody(); }
  });

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
  // Lets the composer's Web-button popover (web-search.js) jump straight
  // into this panel when a project is focused, instead of just explaining
  // where the real control lives.
  registerAgentSettingsOpener(openAgentSettingsPanel);

  function waitForHost() {
    pollUntilReady(
      () => document.querySelector('.input-zone') && document.getElementById('folderContainer'),
      () => {
        injectStyles();
        injectComposerUI();
        injectAgentSettingsPanel();
        injectFolderPicker();
        injectGitHistoryModal();
        injectHeaderToggle();
        syncComposerChip();
      }
    );
  }
  // Deferred via setTimeout(0) even when DOM is already ready: ES module
  // evaluation order follows the import graph, not script-tag order, so
  // other modules aren't guaranteed to be initialized yet. A macrotask
  // boundary guarantees the whole sync module-evaluation pass has finished.
  deferUntilDomReady(waitForHost);
