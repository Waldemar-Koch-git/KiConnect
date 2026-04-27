"""
KI Connect NRW — CORS-Proxy + Storage-Server (v5.0 / Waitress WSGI)
====================================================================
CHANGELOG v5.1 (Browser-unabhaengige Persistenz):
  NEU: /store/ REST-API — Daten liegen in ./datas/ auf dem Dateisystem,
  unabhaengig vom Browser. Alle Browser teilen sich dieselben Accounts.

  Endpunkte (nur von localhost erreichbar):
    GET  /store/                     Account-Registry lesen
    PUT  /store/                     Account-Registry schreiben
    GET  /store/<accountId>          Keys eines Accounts auflisten
    GET  /store/<accountId>/<key>    Eintrag lesen
    PUT  /store/<accountId>/<key>    Eintrag schreiben
    DEL  /store/<accountId>/<key>    Eintrag loeschen

  Sicherheit:
    - Nur localhost (Origin + Host Check)
    - accountId/key strikt validiert (alphanumerisch + _-)
    - Path-Traversal durch realpath-Pruefung verhindert
    - Atomares Schreiben via tmp-Datei + os.replace()
    - Thread-Lock fuer alle Dateioperationen

CHANGELOG v4.4: accept-encoding nicht weitergeleitet (gzip-Fix)
CHANGELOG v4.2: Rate-Limiting thread-safe, location-Header gefiltert
"""

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
from collections import defaultdict
from urllib.parse import urlparse, unquote

app = Flask(__name__)

# ── Verzeichnisse ─────────────────────────────────────────────────
STATIC_DIR = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR   = os.path.join(STATIC_DIR, 'datas')
os.makedirs(DATA_DIR, exist_ok=True)

# ── Strict Origin / Host Check ────────────────────────────────────
ALLOWED_ORIGINS = {
    'http://localhost:5000',
    'http://127.0.0.1:5000',
}

# ── Maximale Groessen (DoS-Schutz) ───────────────────────────────
MAX_BODY_SIZE  = 50  * 1024 * 1024   # 50 MB fuer Proxy-Requests
MAX_STORE_SIZE = 100 * 1024 * 1024   # 100 MB pro Storage-Eintrag
app.config['MAX_CONTENT_LENGTH'] = MAX_STORE_SIZE

# ── Storage-Lock (thread-safe Datei-I/O) ─────────────────────────
_store_lock = threading.Lock()

# ── Input-Validierung ─────────────────────────────────────────────
# accountId: Timestamp + Zufallsteil, z.B. "1718000000000_ab3f7"
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

# ── Origin-Pruefung (wiederverwendbar) ───────────────────────────
def _check_local():
    origin = request.headers.get('Origin', '')
    host   = request.headers.get('Host', '')
    if origin and origin not in ALLOWED_ORIGINS:
        return Response('{"error":"Origin not allowed."}', 403,
                        content_type='application/json')
    if host and not (host.startswith('localhost:') or host.startswith('127.0.0.1:')):
        return Response('{"error":"Host not allowed."}', 403,
                        content_type='application/json')
    return None

# ── /store/ — Account-Registry ───────────────────────────────────
@app.route('/store/', methods=['GET', 'PUT', 'OPTIONS'])
@app.route('/store',  methods=['GET', 'PUT', 'OPTIONS'])
def store_registry():
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    err = _check_local(); 
    if err: return err

    rpath = _registry_path()

    if request.method == 'GET':
        with _store_lock:
            if not os.path.isfile(rpath):
                return Response('[]', 200, content_type='application/json')
            with open(rpath, 'rb') as f:
                return Response(f.read(), 200, content_type='application/json')

    # PUT
    body = request.get_data()
    if len(body) > MAX_STORE_SIZE:
        return Response('{"error":"Body too large."}', 413, content_type='application/json')
    try: json.loads(body)
    except Exception:
        return Response('{"error":"Invalid JSON."}', 400, content_type='application/json')
    with _store_lock:
        tmp = rpath + '.tmp'
        with open(tmp, 'wb') as f: f.write(body)
        os.replace(tmp, rpath)
    return Response('{"ok":true}', 200, content_type='application/json')


# ── /store/<accountId> — Keys auflisten ──────────────────────────
@app.route('/store/<account_id>', methods=['GET', 'OPTIONS'])
def store_list(account_id):
    if request.method == 'OPTIONS':
        return Response('', 204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    err = _check_local()
    if err: return err
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
    err = _check_local()
    if err: return err

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
        body = request.get_data()
        if len(body) > MAX_STORE_SIZE:
            return Response('{"error":"Body too large."}', 413, content_type='application/json')
        try: json.loads(body)
        except Exception:
            return Response('{"error":"Invalid JSON."}', 400, content_type='application/json')
        adir = _account_dir(account_id)
        with _store_lock:
            os.makedirs(adir, exist_ok=True)
            tmp = fpath + '.tmp'
            with open(tmp, 'wb') as f: f.write(body)
            os.replace(tmp, fpath)
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
    'api.x.ai', 'api.groq.com','api.deepseek.com', 
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

def is_allowed(target_url):
    try: parsed = urlparse(target_url)
    except Exception: return False, 'Ungueltige URL'
    if parsed.scheme not in ('http', 'https'): return False, 'Nur HTTP/HTTPS'
    host = parsed.hostname or ''
    if not host: return False, 'Kein Hostname'
    try: ipaddress.ip_address(host); return False, 'Direkte IP nicht erlaubt'
    except ValueError: pass
    if not any(host == d or host.endswith('.' + d) for d in ALLOWED_DOMAINS):
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
        'anthropic-version, anthropic-dangerous-direct-browser-access, '
        'HTTP-Referer, X-Title'
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
        "https://api.x.ai https://api.groq.com; "
        "https://api.deepseek.com; " 
        "img-src 'self' data: blob:; "
        "font-src 'self' https://cdn.jsdelivr.net; "
        "frame-src 'none'; object-src 'none'; base-uri 'self';"
    ),
    'Permissions-Policy': (
        'geolocation=(), microphone=(), camera=(), '
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

    ok, reason = is_allowed(target_url)
    if not ok:
        print(f'  blocked [{reason}]')
        return Response('{"error":"Request blocked."}', 403, content_type='application/json')

    ALLOWED_REQ_HEADERS = {
        'authorization','content-type','x-api-key',
        'anthropic-version','anthropic-dangerous-direct-browser-access',
        'accept','http-referer','x-title',
    }
    fwd_headers = {k: v for k, v in request.headers if k.lower() in ALLOWED_REQ_HEADERS}
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
    print('║  Data dir:    ./datas/   (browser-unabhaengige Persistenz)       ║')
    print('║                                                                  ║')
    print('║  Storage-API  (nur localhost):                                   ║')
    print('║    GET/PUT  /store/                Account-Registry              ║')
    print('║    GET      /store/<id>            Keys auflisten                ║')
    print('║    GET/PUT/DELETE /store/<id>/<k>  Datei lesen/schreiben         ║')
    print('║                                                                  ║')
    print('║  Proxy-Allowlist:                                                ║')
    print('║    chat.kiconnect.nrw · api.anthropic.com · api.openai.com       ║')
    print('║    openrouter.ai · api.mistral.ai · googleapis.com               ║')
    print('║    api.x.ai · api.groq.com · api.deepseek.com                    ║')
    print('║                                                                  ║')
    print('║  Stop: Ctrl+C                                                    ║')
    print('╚══════════════════════════════════════════════════════════════════╝')
    print()

    serve(app, host='127.0.0.1', port=5000, threads=8,
          channel_timeout=120, cleanup_interval=10)
