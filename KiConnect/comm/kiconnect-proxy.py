from flask import Flask, request, Response, send_from_directory, abort
import requests
import ipaddress
import socket
import os
import re
import json
import time
import sys
import threading
import webbrowser
import shutil
import signal
import base64
from collections import defaultdict
from urllib.parse import urlparse, unquote
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError:
    print('[ERROR] "cryptography" package not installed. Run: pip install cryptography')
    sys.exit(1)

port = 5000

app = Flask(__name__)

# ── Directories ───────────────────────────────────────────────────
STATIC_DIR = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR   = os.path.join(STATIC_DIR, 'datas')
os.makedirs(DATA_DIR, exist_ok=True)

# Projects (coding-agent feature) point at real, user-chosen folders anywhere
# on the local filesystem. Every call re-confines a project's tools to that
# one registered folder (see _project_root_for_id / _safe_rel_path), and a
# folder can never be registered if it equals or encloses STATIC_DIR/DATA_DIR.
#
# The project-id -> path mapping lives per-account, ENCRYPTED AT REST, in
# datas/<accountId>/agent_projects.json (see _key_path()). It's only
# readable/writable during an unlocked agent session: the AES key is derived
# client-side from the account password, handed to the server once at
# unlock, held in RAM only, never written to disk.

# ── Strict Origin / Host Check ────────────────────────────────────
ALLOWED_ORIGINS = {
    f'http://localhost:{port}',
    f'http://127.0.0.1:{port}',
}

# ── Max Size (DoS-Protection) ─────────────────────────────────────
MAX_BODY_SIZE  = 50  * 1024 * 1024   # 50 MB for proxy requests
MAX_STORE_SIZE = 100 * 1024 * 1024   # 100 MB pro Storage-entry
app.config['MAX_CONTENT_LENGTH'] = MAX_STORE_SIZE

# ── Storage lock (thread-safe file I/O) ──────────────────────────
# RLock, not Lock: endpoints wrap "load, check, save" as one nested acquire
# by the same thread - a plain Lock would deadlock there.
_store_lock = threading.RLock()

# ── Input-Validating ─────────────────────────────────────────────
# accountId: Timestamp + random-part, z.B. "1718000000000_ab3f7"
# key: config, providers, profiles, folders, chats, current_chat, ...
_SAFE_ID_RE  = re.compile(r'^[A-Za-z0-9_\-]{1,128}$')
_SAFE_KEY_RE = re.compile(r'^[A-Za-z0-9_\-]{1,64}$')

def _valid_id(v):  return bool(_SAFE_ID_RE.match(v or ''))
def _valid_key(v): return bool(_SAFE_KEY_RE.match(v or ''))

def _account_dir(account_id):
    if not _valid_id(account_id): return None
    path = os.path.realpath(os.path.join(DATA_DIR, account_id))
    if not path.startswith(DATA_DIR + os.sep): return None
    return path

def _key_path(account_id, key):
    adir = _account_dir(account_id)
    if not adir: return None
    if not _valid_key(key): return None
    path = os.path.realpath(os.path.join(adir, key + '.json'))
    if not path.startswith(adir + os.sep): return None
    return path

def _registry_path():
    return os.path.join(DATA_DIR, '_registry.json')

# ── Origin-Pruefung ───────────────────────────────────────────────
def _check_local():
    """Return a 403 Response if request origin/host is not localhost, else None."""
    origin = request.headers.get('Origin', '')
    host   = request.headers.get('Host', '')
    if origin and origin not in ALLOWED_ORIGINS:
        return Response('{"error":"Origin not allowed."}', 403,
                        content_type='application/json')
    if host and not (host.startswith('localhost:') or host.startswith('127.0.0.1:')):
        return Response('{"error":"Host not allowed."}', 403,
                        content_type='application/json')
    return None

# ── Atomarer Schreibvorgang ───────────────────────────────────────
def _atomic_write(target_path, data_bytes):
    """Write atomically via temp file + os.replace(). Falls back to a direct
    write if os.replace() keeps failing due to file locking (AV scanners,
    Nextcloud, ...). Must be called inside _store_lock."""
    tmp = target_path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data_bytes)
    for attempt in range(8):
        try:
            os.replace(tmp, target_path)
            return
        except PermissionError:
            time.sleep(0.15 * (attempt + 1))
    # Last-resort fallback: direct write
    with open(target_path, 'wb') as fw:
        fw.write(data_bytes)
    try:
        os.remove(tmp)
    except Exception:
        pass


# ── /store/ - Account registry ───────────────────────────────────
@app.route('/store/', methods=['GET', 'PUT', 'OPTIONS'])
@app.route('/store',  methods=['GET', 'PUT', 'OPTIONS'])
def store_registry():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    #  _check_local() removed - before_request already guards /store paths
    rpath = _registry_path()

    if request.method == 'GET':
        with _store_lock:
            if not os.path.isfile(rpath):
                return Response('[]', 200, content_type='application/json')
            with open(rpath, 'rb') as f:
                return Response(f.read(), 200, content_type='application/json')


    # PUT - uses shared _atomic_write helper
    body = request.get_data()
    if len(body) > MAX_STORE_SIZE:
        return Response('{"error":"Body too large."}', 413, content_type='application/json')
    try: json.loads(body)
    except Exception:
        return Response('{"error":"Invalid JSON."}', 400, content_type='application/json')
    with _store_lock:
        _atomic_write(rpath, body)
    return Response('{"ok":true}', 200, content_type='application/json')
    


# ── /store/<accountId> - Keys auflisten ──────────────────────────
@app.route('/store/<account_id>', methods=['GET', 'OPTIONS'])
def store_list(account_id):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    # _check_local() removed - before_request already guards /store paths
    adir = _account_dir(account_id)
    if not adir:
        return Response('{"error":"Invalid account ID."}', 400, content_type='application/json')
    with _store_lock:
        if not os.path.isdir(adir):
            return Response('[]', 200, content_type='application/json')
        keys = [f[:-5] for f in os.listdir(adir)
                if f.endswith('.json') and _valid_key(f[:-5])]
    return Response(json.dumps(keys), 200, content_type='application/json')


# ── /store/<accountId>/<key> - Lesen / Schreiben / Loeschen ──────
@app.route('/store/<account_id>/<key>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def store_key(account_id, key):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    #  _check_local() removed - before_request already guards /store paths
    fpath = _key_path(account_id, key)
    if not fpath:
        return Response('{"error":"Invalid ID or key."}', 400, content_type='application/json')

    if request.method == 'GET':
        with _store_lock:
            if not os.path.isfile(fpath):
                return Response('null', 200, content_type='application/json')
            with open(fpath, 'rb') as f:
                return Response(f.read(), 200, content_type='application/json')

    if request.method == 'PUT':
        #  - uses shared _atomic_write helper
        body = request.get_data()
        if len(body) > MAX_STORE_SIZE:
            return Response('{"error":"Body too large."}', 413, content_type='application/json')
        try: json.loads(body)
        except Exception:
            return Response('{"error":"Invalid JSON."}', 400, content_type='application/json')
        adir = _account_dir(account_id)
        with _store_lock:
            os.makedirs(adir, exist_ok=True)
            try:
                _atomic_write(fpath, body)
            except Exception as e:
                return Response(f'{{"error":"Write failed: {e}"}}', 500, content_type='application/json')
        return Response('{"ok":true}', 200, content_type='application/json')
        

    if request.method == 'DELETE':
        with _store_lock:
            if os.path.isfile(fpath):
                os.remove(fpath)
        return Response('{"ok":true}', 200, content_type='application/json')


# ════════════════════════════════════════════════════════════════
#  Agent-API - file operations for the coding-agent feature.
#  Every path is re-resolved and re-confined to its project's registered
#  root on every call - never trust a previously-checked path or the
#  registry blindly (a folder moved/deleted, or one that would now enclose
#  the app's own files, is rejected again each time).
# ════════════════════════════════════════════════════════════════
MAX_AGENT_FILE_SIZE = 5 * 1024 * 1024          # 5 MB per file (read + write)
MAX_AGENT_TREE_ENTRIES = 4000                  # safety cap for huge folders
AGENT_IGNORE_DIRS = {
    '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env',
    'dist', 'build', '.idea', '.vscode', '.pytest_cache', '.mypy_cache',
    'target', '.next', '.svelte-kit',
}
# Files the agent may never touch - secrets, credentials, sandbox-escape risks.
AGENT_BLOCKED_SUFFIXES = ('.env', '.key', '.pem', '.pfx', '.p12', '.crt')
AGENT_BLOCKED_NAMES = {'.env', 'id_rsa', 'id_ed25519', '.npmrc', '.pypirc'}
_SAFE_PROJECT_ID_RE = re.compile(r'^p_[A-Za-z0-9]{1,64}$')

# ── Agent Session (per-account, in-RAM only) ──────────────────────
# The AES-256 key for a given account's project registry is derived
# CLIENT-SIDE from the account password (a second, independent key from the
# one used elsewhere) and handed to the server once at unlock. Kept ONLY in
# this in-memory dict, keyed by a random session token - never persisted or
# logged, gone on process restart.
_agent_sessions = {}          # token(str) -> {'accountId': str, 'key': bytes, 'ts': float}
_AGENT_SESSION_TTL = 24 * 3600
_agent_session_lock = threading.Lock()

def _agent_session_or_401():
    """Look up the caller's agent session from the X-Agent-Session header.
    Returns the session dict, or None if missing/unknown/expired."""
    token = request.headers.get('X-Agent-Session', '')
    with _agent_session_lock:
        sess = _agent_sessions.get(token)
        if not sess:
            return None
        if time.time() - sess['ts'] > _AGENT_SESSION_TTL:
            _agent_sessions.pop(token, None)
            return None
        sess['ts'] = time.time()  # sliding expiry on activity
        return sess

def _agent_decrypt(key_bytes, b64_blob):
    """Decrypt a base64(iv[12] || AES-GCM ciphertext+tag) blob - same format
    encryptStr()/encryptObj() in kiconnect.js produce."""
    raw = base64.b64decode(b64_blob)
    iv, ct = raw[:12], raw[12:]
    plaintext = AESGCM(key_bytes).decrypt(iv, ct, None)
    return json.loads(plaintext.decode('utf-8'))

def _agent_encrypt(key_bytes, obj):
    iv = os.urandom(12)
    ct = AESGCM(key_bytes).encrypt(iv, json.dumps(obj).encode('utf-8'), None)
    return base64.b64encode(iv + ct).decode('ascii')

def _load_agent_registry(sess):
    """Read+decrypt this account's project registry (see _key_path())."""
    fpath = _key_path(sess['accountId'], 'agent_projects')
    if not fpath or not os.path.isfile(fpath):
        return {'projects': []}
    with _store_lock:
        with open(fpath, 'r', encoding='utf-8') as f:
            raw = f.read()
    try:
        blob = json.loads(raw) if raw else None
    except ValueError:
        blob = None
    if not blob:
        return {'projects': []}
    data = _agent_decrypt(sess['key'], blob)
    if not isinstance(data.get('projects'), list):
        data['projects'] = []
    return data

def _save_agent_registry(sess, data):
    fpath = _key_path(sess['accountId'], 'agent_projects')
    if not fpath:
        return
    os.makedirs(os.path.dirname(fpath), exist_ok=True)
    blob = _agent_encrypt(sess['key'], data)
    with _store_lock:
        _atomic_write(fpath, json.dumps(blob).encode('utf-8'))

def _is_blocked_root(target):
    """Refuse drive/filesystem roots and anything that equals or encloses
    STATIC_DIR/DATA_DIR."""
    drive_root = os.path.realpath(os.path.splitdrive(target)[0] + os.sep) if os.name == 'nt' else '/'
    if target == os.path.realpath(drive_root):
        return True
    for guarded in (STATIC_DIR, DATA_DIR):
        g = os.path.realpath(guarded)
        if target == g or g.startswith(target + os.sep):
            return True
    return False

def _project_root_for_id(pid, sess):
    """Resolve a project id to its confined, still-valid real folder path.
    None if the id is unknown, the folder is gone, or it now encloses the
    app's own files (re-checked every call, never cached). Requires an
    unlocked agent session."""
    if not _SAFE_PROJECT_ID_RE.match(pid or ''):
        return None
    registry = _load_agent_registry(sess)
    entry = next((p for p in registry['projects'] if p.get('id') == pid), None)
    if not entry:
        return None
    target = os.path.realpath(entry.get('path') or '')
    if not os.path.isdir(target) or _is_blocked_root(target):
        return None
    return target

def _safe_rel_path(project_dir, rel_path):
    """Resolve+confine a path inside a project dir. Rejects '..', absolute
    paths, null bytes, blocked filenames, and any symlink escape."""
    if rel_path is None:
        return None
    rel_path = rel_path.replace('\\', '/').strip('/')
    if not rel_path or '\x00' in rel_path or '..' in rel_path.split('/'):
        return None
    basename = os.path.basename(rel_path).lower()
    if basename in AGENT_BLOCKED_NAMES or any(basename.endswith(s) for s in AGENT_BLOCKED_SUFFIXES):
        return None
    full = os.path.realpath(os.path.join(project_dir, rel_path))
    if full != project_dir and not full.startswith(project_dir + os.sep):
        return None
    return full

def _agent_error(msg, status=400):
    return Response(json.dumps({'error': msg}), status, content_type='application/json')

def _agent_ok(payload=None, status=200):
    return Response(json.dumps(payload if payload is not None else {'ok': True}),
                    status, content_type='application/json')

# ── /agent/session/unlock - hand the server a per-account agent key ──
# Called once after a normal password login (see kiconnect.js
# unlockAgentSession()). Key is derived client-side from the password + a
# dedicated salt, independent of the config/providers/chats key - a leak of
# one doesn't expose the other.
@app.route('/agent/session/unlock', methods=['POST', 'OPTIONS'])
def agent_session_unlock():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    account_id = body.get('accountId')
    key_b64 = body.get('key')
    if not _valid_id(account_id) or not key_b64:
        return _agent_error('Invalid request.', 400)
    try:
        key_bytes = base64.b64decode(key_b64)
        if len(key_bytes) != 32:
            raise ValueError('bad key length')
    except Exception:
        return _agent_error('Invalid key.', 400)
    sess = {'accountId': account_id, 'key': key_bytes, 'ts': time.time()}
    try:
        data = _load_agent_registry(sess)
    except Exception:
        # Wrong key for existing ciphertext (e.g. password/account mismatch)
        return _agent_error('Could not unlock project registry.', 400)
    token = os.urandom(24).hex()
    with _agent_session_lock:
        _agent_sessions[token] = sess
    return _agent_ok({'token': token, 'projects': data['projects']})

# ── /agent/session/rekey - password change: re-encrypt under new key ─
# Requires a still-valid OLD session. Re-encrypts the server's own
# already-decrypted registry, never a client-supplied one, so a password
# change can't smuggle in unvalidated project entries.
@app.route('/agent/session/rekey', methods=['POST', 'OPTIONS'])
def agent_session_rekey():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    old_sess = _agent_session_or_401()
    if not old_sess:
        return _agent_error('Session expired - please log in again.', 401)
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    new_key_b64 = body.get('newKey')
    if not new_key_b64:
        return _agent_error('Invalid request.', 400)
    try:
        new_key_bytes = base64.b64decode(new_key_b64)
        if len(new_key_bytes) != 32:
            raise ValueError('bad key length')
    except Exception:
        return _agent_error('Invalid key.', 400)
    with _store_lock:
        registry = _load_agent_registry(old_sess)
        new_sess = {'accountId': old_sess['accountId'], 'key': new_key_bytes, 'ts': time.time()}
        _save_agent_registry(new_sess, registry)
    old_token = request.headers.get('X-Agent-Session', '')
    new_token = os.urandom(24).hex()
    with _agent_session_lock:
        _agent_sessions.pop(old_token, None)
        _agent_sessions[new_token] = new_sess
    return _agent_ok({'token': new_token, 'projects': registry['projects']})

# ── /agent/session/lock - explicit logout for the agent session ──────
@app.route('/agent/session/lock', methods=['POST', 'OPTIONS'])
def agent_session_lock():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    token = request.headers.get('X-Agent-Session', '')
    with _agent_session_lock:
        _agent_sessions.pop(token, None)
    return _agent_ok()

# ── /agent/browse - list real OS folders, for the project folder picker ──
def _list_subdirs(path):
    names = []
    try:
        with os.scandir(path) as it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False) and not e.name.startswith('.'):
                        names.append(e.name)
                except OSError:
                    continue
    except OSError:
        return None
    return sorted(names, key=str.lower)

@app.route('/agent/browse', methods=['GET', 'OPTIONS'])
def agent_browse():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    raw = (request.args.get('path') or '').strip()
    target = os.path.realpath(raw) if raw else os.path.realpath(os.path.expanduser('~'))
    if not os.path.isdir(target):
        return _agent_error('Folder not found or not accessible.', 404)
    names = _list_subdirs(target)
    if names is None:
        return _agent_error('No access to this folder.', 403)
    parent = os.path.dirname(target)
    if parent == target or not os.path.isdir(parent):
        parent = None
    shortcuts = [{'label': 'Home', 'path': os.path.realpath(os.path.expanduser('~'))}]
    if os.name == 'nt':
        import string
        for letter in string.ascii_uppercase:
            drive = f'{letter}:\\'
            if os.path.exists(drive):
                shortcuts.append({'label': drive, 'path': os.path.realpath(drive)})
    else:
        shortcuts.append({'label': '/', 'path': '/'})
    return _agent_ok({
        'path': target,
        'parent': parent,
        'entries': [{'name': n, 'path': os.path.join(target, n)} for n in names],
        'shortcuts': shortcuts,
    })

# ── /agent/projects - list / register project folders ────────────
@app.route('/agent/projects', methods=['GET', 'POST', 'OPTIONS'])
def agent_projects():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)

    if request.method == 'GET':
        registry = _load_agent_registry(sess)
        projects = []
        for p in registry['projects']:
            target = os.path.realpath(p.get('path') or '')
            projects.append({
                'id': p.get('id'), 'name': p.get('name'), 'path': target,
                'missing': not (os.path.isdir(target) and not _is_blocked_root(target)),
                'shell': bool(p.get('shell')),
            })
        return _agent_ok({'projects': projects})

    # POST - register an existing (or newly created) real folder as a project
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    name = (body.get('name') or '').strip()
    raw_path = (body.get('path') or '').strip()
    create = bool(body.get('create'))
    if not name or len(name) > 64:
        return _agent_error('Invalid project name (1-64 characters).')
    if not raw_path:
        return _agent_error('Please provide a folder path.')
    target = os.path.realpath(raw_path)
    if create and not os.path.isdir(target):
        try:
            os.makedirs(target, exist_ok=True)
        except OSError as e:
            return _agent_error(f'Could not create folder: {e}')
    if not os.path.isdir(target):
        return _agent_error('Folder not found.', 404)
    if _is_blocked_root(target):
        return _agent_error('This folder is not allowed for security reasons (drive/system root or the app\'s own folder).', 403)
    with _store_lock:
        registry = _load_agent_registry(sess)
        if any(os.path.realpath(p.get('path') or '') == target for p in registry['projects']):
            return _agent_error('This folder is already registered as a project.', 409)
        pid = 'p_' + os.urandom(10).hex()
        # Shell execution is OFF by default for every new project - it's an
        # explicit, separate opt-in per project (see /agent/projects/<id>/shell).
        registry['projects'].append({'id': pid, 'name': name, 'path': target, 'shell': False})
        _save_agent_registry(sess, registry)
    return _agent_ok({'id': pid, 'name': name, 'path': target})

# ── /agent/projects/<id>/shell - enable/disable shell command execution ──
# Kept as its own explicit endpoint (rather than folded into general project
# settings) so turning this on is always a distinct, deliberate action, and
# so /agent/exec below can independently double-check it server-side rather
# than trusting whatever the frontend currently displays.
@app.route('/agent/projects/<pid>/shell', methods=['PUT', 'OPTIONS'])
def agent_set_shell(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    enabled = bool(body.get('enabled'))
    with _store_lock:
        registry = _load_agent_registry(sess)
        entry = next((p for p in registry['projects'] if p.get('id') == pid), None)
        if not entry:
            return _agent_error('Project not found.', 404)
        entry['shell'] = enabled
        _save_agent_registry(sess, registry)
    return _agent_ok({'id': pid, 'shell': enabled})

# ── /agent/projects/<id>/path - change a project's target folder ─────
# Lets an already-registered project be re-pointed at a different real
# folder without deleting/recreating it (which used to be the only way,
# losing the project's id and forcing a fresh registration). Runs through
# the exact same validation as creating a new project (existence, 'create'
# opt-in, blocked-root check, no duplicate-path collision with another
# project) - a path change is just as security-sensitive as an initial
# registration and must not skip any of those checks.
@app.route('/agent/projects/<pid>/path', methods=['PUT', 'OPTIONS'])
def agent_set_project_path(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    raw_path = (body.get('path') or '').strip()
    create = bool(body.get('create'))
    if not raw_path:
        return _agent_error('Please provide a folder path.')
    target = os.path.realpath(raw_path)
    if create and not os.path.isdir(target):
        try:
            os.makedirs(target, exist_ok=True)
        except OSError as e:
            return _agent_error(f'Could not create folder: {e}')
    if not os.path.isdir(target):
        return _agent_error('Folder not found.', 404)
    if _is_blocked_root(target):
        return _agent_error('This folder is not allowed for security reasons (drive/system root or the app\'s own folder).', 403)
    with _store_lock:
        registry = _load_agent_registry(sess)
        entry = next((p for p in registry['projects'] if p.get('id') == pid), None)
        if not entry:
            return _agent_error('Project not found.', 404)
        if any(os.path.realpath(p.get('path') or '') == target for p in registry['projects'] if p.get('id') != pid):
            return _agent_error('This folder is already registered as another project.', 409)
        entry['path'] = target
        _save_agent_registry(sess, registry)
    return _agent_ok({'id': pid, 'path': target})

# ── /agent/exec/<id> - run a shell command inside the project folder ──
# Off by default, gated behind the per-project 'shell' flag above.
#
# NOT a hard security boundary (no container/VM) - the command runs as the
# same OS user as the proxy, confined to the project folder only by
# convention (cwd); `cd ..` or an absolute path can still escape. Best-effort
# hardening applied instead:
#   1. Minimal, secret-free environment (doesn't inherit the proxy's env).
#   2. POSIX resource limits (CPU, memory, proc count, open files, no core
#      dumps) via preexec_fn, guarding against fork bombs/runaway loops.
#      Linux/macOS only.
#   3. Own process group (os.setsid) so a timeout can kill the whole subtree.
#   4. Best-effort network isolation via `unshare --net` (Linux only, needs
#      unprivileged user namespaces; probed once, reported back via
#      `networkIsolated` rather than assumed on).
MAX_EXEC_OUTPUT = 200_000  # chars, per stream
EXEC_TIMEOUT_SECONDS = 45
SANDBOX_CPU_SECONDS = EXEC_TIMEOUT_SECONDS + 5   # hard CPU ceiling, just above the wall-clock timeout
SANDBOX_MEM_BYTES = 1024 * 1024 * 1024           # 1 GB address space per command
SANDBOX_MAX_PROCS = 64                            # caps fork bombs
SANDBOX_MAX_OPEN_FILES = 256

_unshare_net_available = None  # cached probe result, see _probe_unshare_net()

def _probe_unshare_net():
    """Checks once whether `unshare --user --map-root-user --net` works
    here. Cached for the process lifetime; never raises."""
    global _unshare_net_available
    if _unshare_net_available is not None:
        return _unshare_net_available
    if os.name == 'nt' or not shutil.which('unshare'):
        _unshare_net_available = False
        return False
    try:
        import subprocess as _sp
        probe = _sp.run(
            ['unshare', '--user', '--map-root-user', '--net', '--', 'true'],
            capture_output=True, timeout=5,
        )
        _unshare_net_available = (probe.returncode == 0)
    except Exception:
        _unshare_net_available = False
    return _unshare_net_available

def _sandbox_env():
    """Minimal environment for sandboxed commands - enough for common
    toolchains (node, python, npm, git) without inheriting the proxy's
    own env vars/secrets."""
    keep = ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER',
            'SHELL', 'NVM_DIR', 'PYTHONIOENCODING', 'SYSTEMROOT', 'APPDATA')
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env.setdefault('PATH', os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'))
    return env

def _sandbox_preexec():
    """Runs in the child right after fork(), before exec - POSIX only.
    Detaches into a new process group and applies resource limits
    best-effort (a rejected limit is skipped, not fatal)."""
    try:
        os.setsid()
    except OSError:
        pass
    import resource
    for res, limits in (
        (resource.RLIMIT_CPU,   (SANDBOX_CPU_SECONDS, SANDBOX_CPU_SECONDS)),
        (resource.RLIMIT_AS,    (SANDBOX_MEM_BYTES, SANDBOX_MEM_BYTES)),
        (resource.RLIMIT_NPROC, (SANDBOX_MAX_PROCS, SANDBOX_MAX_PROCS)),
        (resource.RLIMIT_NOFILE,(SANDBOX_MAX_OPEN_FILES, SANDBOX_MAX_OPEN_FILES)),
        (resource.RLIMIT_CORE,  (0, 0)),
    ):
        try:
            resource.setrlimit(res, limits)
        except (ValueError, OSError):
            pass

@app.route('/agent/exec/<pid>', methods=['POST', 'OPTIONS'])
def agent_exec(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    registry = _load_agent_registry(sess)
    entry = next((p for p in registry['projects'] if p.get('id') == pid), None)
    if not entry:
        return _agent_error('Project not found.', 404)
    if not entry.get('shell'):
        return _agent_error('Shell commands are not enabled for this project (⚙ Agent Settings).', 403)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)

    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    command = (body.get('command') or '').strip()
    if not command:
        return _agent_error('No command provided.')
    cwd = pdir
    if body.get('cwd'):
        resolved = _safe_rel_path(pdir, body['cwd'])
        if not resolved or not os.path.isdir(resolved):
            return _agent_error('Invalid working directory.')
        cwd = resolved

    import subprocess
    use_posix_limits = (os.name != 'nt')
    net_isolated = use_posix_limits and _probe_unshare_net()
    wrapped_command = ('unshare --user --map-root-user --net -- ' + command) if net_isolated else command

    popen_kwargs = dict(
        cwd=cwd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, errors='replace', env=_sandbox_env(),
    )
    if use_posix_limits:
        popen_kwargs['preexec_fn'] = _sandbox_preexec
    else:
        popen_kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP

    try:
        proc = subprocess.Popen(wrapped_command, **popen_kwargs)
    except OSError as e:
        return _agent_error(f'Could not start command: {e}')

    timed_out = False
    try:
        stdout, stderr = proc.communicate(timeout=EXEC_TIMEOUT_SECONDS)
        exit_code = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out, exit_code = True, None
        try:
            if use_posix_limits:
                os.killpg(proc.pid, signal.SIGKILL)  # kill the whole group we detached into via setsid()
            else:
                proc.kill()
        except OSError:
            pass
        stdout, stderr = proc.communicate()

    truncated = len(stdout) > MAX_EXEC_OUTPUT or len(stderr) > MAX_EXEC_OUTPUT
    return _agent_ok({
        'command': command, 'exitCode': exit_code, 'timedOut': timed_out, 'truncated': truncated,
        'stdout': stdout[:MAX_EXEC_OUTPUT], 'stderr': stderr[:MAX_EXEC_OUTPUT],
        'sandboxed': use_posix_limits, 'networkIsolated': net_isolated,
    })



# Only removes the app's link to the folder - the folder itself is never
# deleted, it's real user-owned data outside the app.
@app.route('/agent/projects/<pid>', methods=['DELETE', 'OPTIONS'])
def agent_delete_project(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    with _store_lock:
        registry = _load_agent_registry(sess)
        remaining = [p for p in registry['projects'] if p.get('id') != pid]
        if len(remaining) == len(registry['projects']):
            return _agent_error('Project not found.', 404)
        registry['projects'] = remaining
        _save_agent_registry(sess, registry)
    return _agent_ok()

# ── /agent/search/<id> - grep-style text search across a project ──
@app.route('/agent/search/<pid>', methods=['GET', 'OPTIONS'])
def agent_search(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)
    query = (request.args.get('q') or '').strip()
    if not query:
        return _agent_error('Please provide a search term (q=...).')
    use_regex = request.args.get('regex') == '1'
    case_sensitive = request.args.get('case') == '1'
    scope = (request.args.get('path') or '').strip()
    scope_dir = pdir
    single_file = None  # set below if `path` turns out to name a FILE, not a folder
    note = None
    if scope:
        resolved = _safe_rel_path(pdir, scope)
        if not resolved:
            # Most common cause: model prefixes the project's own folder
            # name onto an already-relative path (paths are always relative
            # to the project root, never including the root's own name).
            return _agent_error(f'Invalid search path "{scope}" - must be a relative path inside the project (no ".." or a leading "/", and not duplicating the project folder\'s own name).')
        if os.path.isfile(resolved):
            # `path` is documented as folder-only, but weaker models
            # sometimes pass a filename instead of calling read_file.
            # Degrade gracefully and just search that one file.
            single_file = resolved
            note = f'"{scope}" is a file, not a folder - `path` normally scopes the search to a subfolder. Searched just that one file. Use read_file to read a specific file directly, or omit `path` to search the whole project.'
        elif not os.path.isdir(resolved):
            return _agent_error(f'Invalid search path "{scope}" - no such file or folder in this project.')
        else:
            scope_dir = resolved
    try:
        pattern = re.compile(query if use_regex else re.escape(query), 0 if case_sensitive else re.IGNORECASE)
    except re.error as e:
        return _agent_error(f'Invalid regular expression: {e}')

    MAX_MATCHES, MAX_FILES = 200, 3000
    matches, files_scanned = [], 0
    file_iter = [(os.path.dirname(single_file), [], [os.path.basename(single_file)])] if single_file else os.walk(scope_dir)
    for root, dirs, files in file_iter:
        if not single_file:
            dirs[:] = sorted(d for d in dirs if d not in AGENT_IGNORE_DIRS and not d.startswith('.'))
        if len(matches) >= MAX_MATCHES or files_scanned >= MAX_FILES:
            break
        for fname in sorted(files):
            if len(matches) >= MAX_MATCHES or files_scanned >= MAX_FILES:
                break
            fpath = os.path.join(root, fname)
            try:
                if os.path.getsize(fpath) > MAX_AGENT_FILE_SIZE:
                    continue
            except OSError:
                continue
            files_scanned += 1
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    for lineno, line in enumerate(f, 1):
                        if pattern.search(line):
                            rel = os.path.relpath(fpath, pdir).replace('\\', '/')
                            matches.append({'path': rel, 'line': lineno, 'text': line.strip()[:300]})
                            if len(matches) >= MAX_MATCHES:
                                break
            except (UnicodeDecodeError, OSError):
                continue
    result = {
        'query': query, 'matches': matches,
        'filesScanned': files_scanned, 'truncated': len(matches) >= MAX_MATCHES,
    }
    if note:
        result['note'] = note
    return _agent_ok(result)

# ── /agent/tree/<id> - recursive file listing ─────────────────────
@app.route('/agent/tree/<pid>', methods=['GET', 'OPTIONS'])
def agent_tree(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)
    entries = []
    count = 0
    for root, dirs, files in os.walk(pdir):
        dirs[:] = sorted(d for d in dirs if d not in AGENT_IGNORE_DIRS and not d.startswith('.'))
        rel_root = os.path.relpath(root, pdir)
        for fname in sorted(files):
            if count >= MAX_AGENT_TREE_ENTRIES:
                break
            rel = fname if rel_root == '.' else f'{rel_root}/{fname}'
            try:
                size = os.path.getsize(os.path.join(root, fname))
            except OSError:
                size = 0
            entries.append({'path': rel.replace('\\', '/'), 'size': size})
            count += 1
        if count >= MAX_AGENT_TREE_ENTRIES:
            break
    return _agent_ok({'project': pid, 'files': entries, 'truncated': count >= MAX_AGENT_TREE_ENTRIES})

# ── /agent/file/<id>/<path> - read / write / delete a file ────────
@app.route('/agent/file/<pid>/<path:rel_path>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def agent_file(pid, rel_path):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)
    fpath = _safe_rel_path(pdir, rel_path)
    if not fpath:
        return _agent_error('Invalid file path.')

    if request.method == 'GET':
        if not os.path.isfile(fpath):
            return _agent_error('File not found.', 404)
        if os.path.getsize(fpath) > MAX_AGENT_FILE_SIZE:
            return _agent_error('File too large (>5 MB).', 413)
        with open(fpath, 'rb') as f:
            raw = f.read()
        try:
            return _agent_ok({'path': rel_path, 'content': raw.decode('utf-8'), 'binary': False})
        except UnicodeDecodeError:
            return _agent_ok({'path': rel_path, 'content': None, 'binary': True})

    if request.method == 'PUT':
        try: body = request.get_json(force=True, silent=True) or {}
        except Exception: body = {}
        content = body.get('content', '')
        create_only = bool(body.get('createOnly'))
        if not isinstance(content, str):
            return _agent_error('content must be a string.')
        if len(content.encode('utf-8')) > MAX_AGENT_FILE_SIZE:
            return _agent_error('File too large (>5 MB).', 413)
        if create_only and os.path.exists(fpath):
            return _agent_error('File already exists.', 409)
        with _store_lock:
            os.makedirs(os.path.dirname(fpath), exist_ok=True)
            _atomic_write(fpath, content.encode('utf-8'))
        return _agent_ok({'path': rel_path, 'bytes': len(content.encode('utf-8'))})

    if request.method == 'DELETE':
        with _store_lock:
            if os.path.isfile(fpath):
                os.remove(fpath)
            elif not os.path.exists(fpath):
                return _agent_error('File not found.', 404)
        return _agent_ok({'path': rel_path})

# ── /agent/dir/<id>/<path> - create / delete a directory ──────────
@app.route('/agent/dir/<pid>/<path:rel_path>', methods=['POST', 'DELETE', 'OPTIONS'])
def agent_dir(pid, rel_path):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)
    dpath = _safe_rel_path(pdir, rel_path)
    if not dpath:
        return _agent_error('Invalid folder path.')

    if request.method == 'POST':
        with _store_lock:
            os.makedirs(dpath, exist_ok=True)
        return _agent_ok({'path': rel_path})

    if request.method == 'DELETE':
        import shutil
        if not os.path.isdir(dpath):
            return _agent_error('Folder not found.', 404)
        with _store_lock:
            shutil.rmtree(dpath, ignore_errors=True)
        return _agent_ok({'path': rel_path})


# ── /agent/move/<id> - move/rename a file or folder ────────────────
# shutil.move (not os.rename) so it also works across directories/filesystems.
@app.route('/agent/move/<pid>', methods=['POST', 'OPTIONS'])
def agent_move(pid):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    sess = _agent_session_or_401()
    if not sess:
        return _agent_error('Session expired - please log in again.', 401)
    pdir = _project_root_for_id(pid, sess)
    if not pdir:
        return _agent_error('Project folder not found - was it moved or deleted?', 404)
    try: body = request.get_json(force=True, silent=True) or {}
    except Exception: body = {}
    rel_from = body.get('from')
    rel_to = body.get('to')
    src = _safe_rel_path(pdir, rel_from) if rel_from else None
    dst = _safe_rel_path(pdir, rel_to) if rel_to else None
    if not src or not dst:
        return _agent_error('Invalid from/to path.')
    if not os.path.exists(src):
        return _agent_error('Source not found.', 404)
    if os.path.exists(dst):
        if not bool(body.get('overwrite')):
            return _agent_error('Destination already exists (set overwrite to replace it).', 409)
        with _store_lock:
            if os.path.isdir(dst) and not os.path.islink(dst):
                shutil.rmtree(dst, ignore_errors=True)
            else:
                os.remove(dst)
    with _store_lock:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
    return _agent_ok({'from': rel_from, 'to': rel_to})


@app.before_request
def check_origin():
    if request.path.startswith('/proxy/') or request.path.startswith('/store') or request.path.startswith('/agent'):
        origin = request.headers.get('Origin', '')
        host   = request.headers.get('Host', '')
        if origin and origin not in ALLOWED_ORIGINS:
            return Response('{"error":"Origin not allowed."}',
                            403, content_type='application/json')
        if host and not (host.startswith('localhost:') or host.startswith('127.0.0.1:')):
            return Response('{"error":"Host not allowed."}',
                            403, content_type='application/json')

# ── Private IP ranges (SSRF protection) ──────────────────────────
PRIVATE_NETWORKS = [
    ipaddress.ip_network('10.0.0.0/8'),    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('169.254.0.0/16'),ipaddress.ip_network('100.64.0.0/10'),
    ipaddress.ip_network('0.0.0.0/8'),     ipaddress.ip_network('192.0.0.0/24'),
    ipaddress.ip_network('198.18.0.0/15'), ipaddress.ip_network('198.51.100.0/24'),
    ipaddress.ip_network('203.0.113.0/24'),ipaddress.ip_network('240.0.0.0/4'),
    ipaddress.ip_network('255.255.255.255/32'),
    ipaddress.ip_network('::1/128'),       ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),     ipaddress.ip_network('::ffff:0:0/96'),
    ipaddress.ip_network('2002::/16'),     ipaddress.ip_network('100::/64'),
    ipaddress.ip_network('64:ff9b::/96'),  ipaddress.ip_network('::/128'),
]

def _resolve_all_ips(hostname):
    try:
        socket.setdefaulttimeout(5)
        return [i[4][0] for i in socket.getaddrinfo(hostname, None)]
    except Exception: return []
    finally: socket.setdefaulttimeout(None)

def is_private_ip(hostname):
    ips = _resolve_all_ips(hostname)
    if not ips: return True
    for ip_str in ips:
        try:
            addr = ipaddress.ip_address(ip_str)
            if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
                addr = addr.ipv4_mapped
            if any(addr in net for net in PRIVATE_NETWORKS): return True
        except ValueError: return True
    return False

def is_allowed(target_url, method='GET'):
    # No domain allowlist here - users can point POST at any custom
    # OpenAI-compatible endpoint. Real SSRF protection: http/https only,
    # no literal IPs, no private/loopback/link-local ranges, for every method.
    try: parsed = urlparse(target_url)
    except Exception: return False, 'Invalid URL'
    if parsed.scheme not in ('http', 'https'): return False, 'HTTP/HTTPS only'
    host = parsed.hostname or ''
    if not host: return False, 'No hostname'
    try: ipaddress.ip_address(host); return False, 'Literal IPs are not allowed'
    except ValueError: pass
    if is_private_ip(host): return False, 'Private hosts are not allowed'
    return True, ''

# ── Rate-Limiting ─────────────────────────────────────────────────
_rate_data = defaultdict(lambda: {'count': 0, 'reset': 0.0})
_rate_lock = threading.Lock()
RATE_LIMIT = 120; RATE_WINDOW = 60.0
_CLEANUP_EVERY = 300; _last_cleanup = time.monotonic()

def check_rate_limit(ip):
    global _last_cleanup
    now = time.monotonic()
    with _rate_lock:
        if now - _last_cleanup > _CLEANUP_EVERY:
            for k in [k for k, v in _rate_data.items() if now > v['reset']]:
                del _rate_data[k]
            _last_cleanup = now
        d = _rate_data[ip]
        if now > d['reset']: d['count'] = 0; d['reset'] = now + RATE_WINDOW
        d['count'] += 1
        return d['count'] <= RATE_LIMIT

# ── CORS + Security Headers ───────────────────────────────────────
CORS_HEADERS = {
    'Access-Control-Allow-Origin':  f'http://localhost:{port}',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': (
        'Authorization, Content-Type, x-api-key, '
        'X-Subscription-Token, '
        'anthropic-version, anthropic-dangerous-direct-browser-access, '
        'HTTP-Referer, X-Title, '
        'Ocp-Apim-Subscription-Key'           # Bing Search API
    ),
}
EXCLUDED_RESP_HEADERS = {
    # Hop-by-hop headers (RFC 7230 §6.1) - forwarding these violates PEP 3333
    # and crashes waitress.
    'connection','keep-alive','proxy-authenticate','proxy-authorization',
    'te','trailer','trailers','transfer-encoding','upgrade',
    'content-encoding','content-length','server','x-powered-by','set-cookie','location',
}
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': (
        # Actual enforced policy - the <meta> CSP in kiconnect.html is kept
        # in sync but this header wins if the two ever disagree. No
        # 'unsafe-inline' needed since former inline scripts now live in
        # kiconnect-mathjax-config.js / kiconnect-pdf-init.js.
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self' https://api.anthropic.com https://api.openai.com "
        "https://chat.kiconnect.nrw https://openrouter.ai "
        "https://api.mistral.ai https://generativelanguage.googleapis.com "
        "https://api.x.ai https://api.groq.com "
        "https://api.deepseek.com https://api.minimax.io "
        "https://api.z.ai "
        "https://api.search.brave.com https://html.duckduckgo.com "
        "https://lite.duckduckgo.com https://api.qwant.com https://search.yahoo.com "
        "https://www.startpage.com https://www.googleapis.com https://api.bing.microsoft.com "
        "https://api.mojeek.com https://yandex.com "
        "https://searx.be https://searxng.world https://search.bus-hit.me "
        "https://searx.tiekoetter.com https://search.sapti.me https://searx.prvcy.eu "
        "https://searx.fmac.xyz https://search.ononoki.org; "
        "img-src 'self' data: blob:; "
        "font-src 'self'; "
        "worker-src blob:; "
        "frame-src 'none'; object-src 'none'; base-uri 'self';"
    ),
    'Permissions-Policy': (
        'geolocation=(), camera=(), '
        'payment=(), usb=(), magnetometer=(), gyroscope=()'
    ),
}

@app.after_request
def add_security_headers(response):
    for k, v in CORS_HEADERS.items():   response.headers[k] = v
    for k, v in SECURITY_HEADERS.items(): response.headers[k] = v
    return response

# ── Statische Dateien ─────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'kiconnect.html')

@app.route('/<path:filename>')
def static_files(filename):
    if filename.startswith('proxy/'):
        return _proxy_request(filename[len('proxy/'):])
    safe_path = os.path.realpath(os.path.join(STATIC_DIR, filename))
    if not safe_path.startswith(STATIC_DIR + os.sep) and safe_path != STATIC_DIR:
        abort(404)
    basename = os.path.basename(filename).lower()
    if basename.startswith('.') or any(
        basename.endswith(e) for e in ['.py','.key','.pem','.env','.ini','.cfg','.log']
    ): abort(404)
    if os.path.isfile(safe_path):
        return send_from_directory(STATIC_DIR, filename)
    abort(404)

# ── Proxy ─────────────────────────────────────────────────────────
@app.route('/proxy/<path:target>', methods=['GET', 'POST', 'OPTIONS'])
def proxy(target):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    return _proxy_request(target)

def _proxy_request(target_url):
    client_ip = request.remote_addr or '0.0.0.0'
    if not check_rate_limit(client_ip):
        return Response('{"error":"Too many requests - please wait a moment."}',
                        429, content_type='application/json')
    try: target_url = unquote(target_url)
    except Exception: pass

    ok, reason = is_allowed(target_url, request.method)
    if not ok:
        print(f'  blocked [{reason}]')
        return Response('{"error":"Request blocked."}', 403, content_type='application/json')

    ALLOWED_REQ_HEADERS = {
        'authorization','content-type','x-api-key',
        'x-subscription-token',
        'anthropic-version','anthropic-dangerous-direct-browser-access','anthropic-beta',
        'accept','http-referer','x-title','origin',
        'ocp-apim-subscription-key',          # Bing Search API
        'user-agent',                          # Search engines (browser can't send it, proxy injects below)
        'referer','accept-language','sec-fetch-site','sec-fetch-mode','sec-fetch-dest',
    }
    fwd_headers = {k: v for k, v in request.headers if k.lower() in ALLOWED_REQ_HEADERS}
    # Inject a browser-like User-Agent when none is present - required by DuckDuckGo,
    # Bing, Brave etc. (browsers cannot set User-Agent in fetch, so the proxy must do it)
    if not any(k.lower() == 'user-agent' for k in fwd_headers):
        fwd_headers['User-Agent'] = (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/124.0.0.0 Safari/537.36'
        )
    fwd_headers.setdefault('Accept-Language', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7')
    fwd_headers.setdefault('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7')
    if 'http-referer' in {k.lower() for k in fwd_headers} and not any(k.lower() == 'referer' for k in fwd_headers):
        for k, v in list(fwd_headers.items()):
            if k.lower() == 'http-referer':
                fwd_headers['Referer'] = v
                break
    body = request.get_data()
    if len(body) > MAX_BODY_SIZE:
        return Response('{"error":"Request body too large."}', 413, content_type='application/json')

    print(f'  -> {request.method:6s} {target_url[:90]}')
    try:
        upstream = requests.request(
            method=request.method, url=target_url, headers=fwd_headers,
            data=body, params=request.args, stream=True,
            timeout=(10, 180), verify=True, allow_redirects=False,
        )
        resp_headers = {k: v for k, v in upstream.headers.items()
                        if k.lower() not in EXCLUDED_RESP_HEADERS}
        resp_headers.update(CORS_HEADERS); resp_headers.update(SECURITY_HEADERS)

        def generate():
            try:
                for chunk in upstream.iter_content(chunk_size=8192):
                    if chunk: yield chunk
            except Exception as e:
                print(f'  Stream-Fehler: {type(e).__name__}')

        print(f'  <- {upstream.status_code}')
        return Response(generate(), status=upstream.status_code, headers=resp_headers)

    except requests.exceptions.SSLError:
        return Response('{"error":"SSL certificate invalid."}', 502, content_type='application/json')
    except requests.exceptions.ConnectionError:
        return Response('{"error":"Target server unreachable."}', 502, content_type='application/json')
    except requests.exceptions.Timeout:
        return Response('{"error":"API did not respond (timeout)."}', 504, content_type='application/json')
    except Exception as e:
        print(f'  Error: {type(e).__name__}')
        return Response('{"error":"Internal proxy error."}', 500, content_type='application/json')


if __name__ == '__main__':
    try:
        from waitress import serve
    except ImportError:
        print('[ERROR] waitress not installed. Run: pip install waitress')
        sys.exit(1)

    W = 72   # Frame len
    IW = W - 4  # Inner frame content width (68) — muss zur Randbreite von 6 passen

    def line(text=''):
        print('║ ' + text.ljust(W) + ' ║')

    def iline(text=''):
        print('║   ' + text.ljust(IW) + '   ║')

    print('╔' + '═' * (W + 2) + '╗')
    line('KI Connect - CORS-Proxy + Storage-Server (Waitress)')
    print('╠' + '═' * (W + 2) + '╣')
    line(f'Running on: http://localhost:{port}   Data dir: ./datas/')
    line()
    line('Storage-API (localhost only):')
    line('  GET/PUT        /store/           Account registry')
    line('  GET            /store/<id>       Keys list')
    line('  GET/PUT/DELETE /store/<id>/<k>   Data read/write')
    line()
    line('Agent-API (per-account encrypted project registry,')
    line('           requires an unlocked session):')
    print('║  ┌' + '─' * IW + '┐  ║')
    iline('POST     /agent/session/unlock|lock|rekey Unlock/drop/rekey session')
    iline('GET      /agent/browse                   Browse OS folders')
    iline('GET/POST /agent/projects                 List/register project')
    iline('DELETE   /agent/projects/<id>            Unregister (keeps files)')
    iline('PUT      /agent/projects/<id>/shell|path Toggle shell / change path')
    iline('POST     /agent/exec/<id>                Run shell command')
    iline('GET      /agent/tree|search/<id>         File listing / text search')
    iline('GET/PUT/DELETE /agent/file/<id>/<p>      Read/write/delete file')
    iline('POST/DELETE /agent/dir/<id>/<p>          Create/delete folder')
    iline('POST     /agent/move/<id>                Move/rename')
    print('║  └' + '─' * IW + '┘  ║')
    line()
    line('Proxy allowlist: anthropic, openai, openrouter, mistral, googleapis,')
    line('                 x.ai, groq, deepseek, minimax, z.ai, chat.kiconnect.nrw')
    line('Search: brave, duckduckgo, qwant, yahoo, startpage, google, bing,')
    line('        mojeek, yandex, searxng')
    line()
    line('Stop: Ctrl+C')
    print('╚' + '═' * (W + 2) + '╝')

    threading.Timer(1.2, lambda: webbrowser.open(f'http://localhost:{port}')).start()
    serve(app, host='127.0.0.1', port=port, threads=8, channel_timeout=120, cleanup_interval=10)
