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
from collections import defaultdict
from urllib.parse import urlparse, unquote

app = Flask(__name__)

# ── Directories ───────────────────────────────────────────────────
STATIC_DIR = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR   = os.path.join(STATIC_DIR, 'datas')
os.makedirs(DATA_DIR, exist_ok=True)

# ── Strict Origin / Host Check ────────────────────────────────────
ALLOWED_ORIGINS = {
    'http://localhost:5000',
    'http://127.0.0.1:5000',
}

# ── Max Size (DoS-Protection) ─────────────────────────────────────
MAX_BODY_SIZE  = 50  * 1024 * 1024   # 50 MB fuer Proxy-Requests
MAX_STORE_SIZE = 100 * 1024 * 1024   # 100 MB pro Storage-entry
app.config['MAX_CONTENT_LENGTH'] = MAX_STORE_SIZE

# ── Storage-Lock (thread-safe Datei-I/O) ─────────────────────────
_store_lock = threading.Lock()

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
    """Write data_bytes to target_path atomically via a temp file + os.replace().

    Falls back to a direct write on Windows if os.replace() keeps failing due to
    file locking (e.g. AV scanners, Nextcloud).  Must be called inside _store_lock.
    Returns None on success or raises on unrecoverable error.
    """
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


# ── /store/ — Account registry ───────────────────────────────────
@app.route('/store/', methods=['GET', 'PUT', 'OPTIONS'])
@app.route('/store',  methods=['GET', 'PUT', 'OPTIONS'])
def store_registry():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    #  _check_local() removed — before_request already guards /store paths
    rpath = _registry_path()

    if request.method == 'GET':
        with _store_lock:
            if not os.path.isfile(rpath):
                return Response('[]', 200, content_type='application/json')
            with open(rpath, 'rb') as f:
                return Response(f.read(), 200, content_type='application/json')


    # PUT — uses shared _atomic_write helper
    body = request.get_data()
    if len(body) > MAX_STORE_SIZE:
        return Response('{"error":"Body too large."}', 413, content_type='application/json')
    try: json.loads(body)
    except Exception:
        return Response('{"error":"Invalid JSON."}', 400, content_type='application/json')
    with _store_lock:
        _atomic_write(rpath, body)
    return Response('{"ok":true}', 200, content_type='application/json')
    


# ── /store/<accountId> — Keys auflisten ──────────────────────────
@app.route('/store/<account_id>', methods=['GET', 'OPTIONS'])
def store_list(account_id):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    # _check_local() removed — before_request already guards /store paths
    adir = _account_dir(account_id)
    if not adir:
        return Response('{"error":"Invalid account ID."}', 400, content_type='application/json')
    with _store_lock:
        if not os.path.isdir(adir):
            return Response('[]', 200, content_type='application/json')
        keys = [f[:-5] for f in os.listdir(adir)
                if f.endswith('.json') and _valid_key(f[:-5])]
    return Response(json.dumps(keys), 200, content_type='application/json')


# ── /store/<accountId>/<key> — Lesen / Schreiben / Loeschen ──────
@app.route('/store/<account_id>/<key>', methods=['GET', 'PUT', 'DELETE', 'OPTIONS'])
def store_key(account_id, key):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    #  _check_local() removed — before_request already guards /store paths
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
        #  — uses shared _atomic_write helper
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


# ── Before-Request: Origin-Check fuer /proxy/ und /store ─────────
@app.before_request
def check_origin():
    if request.path.startswith('/proxy/') or request.path.startswith('/store'):
        origin = request.headers.get('Origin', '')
        host   = request.headers.get('Host', '')
        if origin and origin not in ALLOWED_ORIGINS:
            return Response('{"error":"Origin not allowed."}',
                            403, content_type='application/json')
        if host and not (host.startswith('localhost:') or host.startswith('127.0.0.1:')):
            return Response('{"error":"Host not allowed."}',
                            403, content_type='application/json')

# ── Allowlist erlaubter Ziel-Domains ─────────────────────────────
ALLOWED_DOMAINS = {
    'chat.kiconnect.nrw', 'api.anthropic.com', 'api.openai.com',
    'openrouter.ai', 'api.mistral.ai', 'generativelanguage.googleapis.com',
    'api.x.ai', 'api.groq.com','api.deepseek.com','api.minimax.io',
    'api.z.ai',
    'api.search.brave.com', 'html.duckduckgo.com', 'lite.duckduckgo.com',
    'api.qwant.com', 'search.yahoo.com', 'www.startpage.com',
    'www.googleapis.com',
    'api.bing.microsoft.com',
    'api.mojeek.com',
    'yandex.com',
    'searx.be', 'searxng.world', 'search.bus-hit.me',
    'searx.tiekoetter.com', 'search.sapti.me', 'searx.prvcy.eu',
    'searx.fmac.xyz', 'search.ononoki.org',
}

# ── Private IP-Bereiche (SSRF-Schutz) ────────────────────────────
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
    try: parsed = urlparse(target_url)
    except Exception: return False, 'Ungueltige URL'
    if parsed.scheme not in ('http', 'https'): return False, 'Nur HTTP/HTTPS'
    host = parsed.hostname or ''
    if not host: return False, 'Kein Hostname'
    try: ipaddress.ip_address(host); return False, 'Direkte IP nicht erlaubt'
    except ValueError: pass
    if not any(host == d or host.endswith('.' + d) for d in ALLOWED_DOMAINS) and method.upper() != 'GET':
        return False, 'Domain nicht erlaubt'
    if is_private_ip(host): return False, 'Privater Host nicht erlaubt'
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
    'Access-Control-Allow-Origin':  'http://localhost:5000',
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
    'transfer-encoding','content-encoding','content-length',
    'connection','server','x-powered-by','set-cookie','location',
}
SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
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
        "font-src 'self' https://cdn.jsdelivr.net; "
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
        'anthropic-version','anthropic-dangerous-direct-browser-access',
        'accept','http-referer','x-title','origin',
        'ocp-apim-subscription-key',          # Bing Search API
        'user-agent',                          # Search engines (browser can't send it, proxy injects below)
        'referer','accept-language','sec-fetch-site','sec-fetch-mode','sec-fetch-dest',
    }
    fwd_headers = {k: v for k, v in request.headers if k.lower() in ALLOWED_REQ_HEADERS}
    # Inject a browser-like User-Agent when none is present — required by DuckDuckGo,
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

    print()
    print('╔══════════════════════════════════════════════════════════════════╗')
    print('║  KI Connect — CORS-Proxy + Storage-Server  (v5.1 / Waitress)     ║')
    print('╠══════════════════════════════════════════════════════════════════╣')
    print('║  Running on:  http://localhost:5000                              ║')
    print('║  Data dir:    ./datas/   (browser-independent persistence)       ║')
    print('║                                                                  ║')
    print('║  Storage-API  (only localhost):                                  ║')
    print('║    GET/PUT  /store/                Account registry              ║')
    print('║    GET      /store/<id>            Keys list                     ║')
    print('║    GET/PUT/DELETE /store/<id>/<k>  Data read/write               ║')
    print('║                                                                  ║')
    print('║  Proxy-Allowlist:                                                ║')
    print('║    chat.kiconnect.nrw · api.anthropic.com · api.openai.com       ║')
    print('║    openrouter.ai · api.mistral.ai · googleapis.com               ║')
    print('║    api.x.ai · api.groq.com · api.deepseek.com · api.minimax.io   ║')
    print('║    api.z.ai                                                      ║')
    print('║  Search: brave · duckduckgo (lite) · google · bing               ║')
    print('║          mojeek · yandex · searxng (public instances)            ║')
    print('║                                                                  ║')
    print('║  Stop: Ctrl+C                                                    ║')
    print('╚══════════════════════════════════════════════════════════════════╝')
    print()

    threading.Timer(1.2, lambda: webbrowser.open('http://localhost:5000')).start()
    serve(app, host='127.0.0.1', port=5000, threads=8,
          channel_timeout=120, cleanup_interval=10)
