"""
KI Connect NRW — CORS-Proxy (gehärtet v4.2 / Waitress WSGI)
=============================================================
CHANGELOG v4.2 (Security Fixes):
  • Rate-Limiting: threading.Lock() gegen Race Conditions (Thread-Safety)
  • 'location'-Header wird aus Upstream-Responses gefiltert
    (verhindert Client-seitiges Redirect-Following nach 30x)
"""

from flask import Flask, request, Response, send_from_directory, abort
import requests
import ipaddress
import socket
import os
import time
import sys
import threading
from collections import defaultdict
from urllib.parse import urlparse, unquote
from functools import wraps

app = Flask(__name__)

# ── Strict Origin / Host Check ────────────────────────────────────
ALLOWED_ORIGINS = {
    'http://localhost:5000',
    'http://127.0.0.1:5000',
}

STATIC_DIR = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))

# ── Maximale Body-Größe (DoS-Schutz) ─────────────────────────────
MAX_BODY_SIZE = 50 * 1024 * 1024  # 50 MB
app.config['MAX_CONTENT_LENGTH'] = MAX_BODY_SIZE

@app.before_request
def check_origin():
    if request.path.startswith('/proxy/'):
        origin = request.headers.get('Origin', '')
        host   = request.headers.get('Host', '')
        if origin and origin not in ALLOWED_ORIGINS:
            return Response('{"error":"Origin not allowed."}',
                            status=403, content_type='application/json')
        if host and not (host.startswith('localhost:') or host.startswith('127.0.0.1:')):
            return Response('{"error":"Host not allowed."}',
                            status=403, content_type='application/json')

# ── Allowlist erlaubter Ziel-Domains ─────────────────────────────
ALLOWED_DOMAINS = {
    'chat.kiconnect.nrw',
    'api.anthropic.com',
    'api.openai.com',
    'openrouter.ai',
}

# ── Reservierte / private IP-Bereiche (SSRF-Schutz) ─────────────
PRIVATE_NETWORKS = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('100.64.0.0/10'),
    ipaddress.ip_network('0.0.0.0/8'),
    ipaddress.ip_network('192.0.0.0/24'),
    ipaddress.ip_network('198.18.0.0/15'),
    ipaddress.ip_network('198.51.100.0/24'),
    ipaddress.ip_network('203.0.113.0/24'),
    ipaddress.ip_network('240.0.0.0/4'),
    ipaddress.ip_network('255.255.255.255/32'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),
    ipaddress.ip_network('::ffff:0:0/96'),
    ipaddress.ip_network('2002::/16'),
    ipaddress.ip_network('100::/64'),
    ipaddress.ip_network('64:ff9b::/96'),
    ipaddress.ip_network('::/128'),
]

def _resolve_all_ips(hostname: str) -> list:
    try:
        socket.setdefaulttimeout(5)
        infos = socket.getaddrinfo(hostname, None)
        socket.setdefaulttimeout(None)
        return [info[4][0] for info in infos]
    except Exception:
        return []
    finally:
        socket.setdefaulttimeout(None)

def is_private_ip(hostname: str) -> bool:
    ips = _resolve_all_ips(hostname)
    if not ips:
        return True
    for ip_str in ips:
        try:
            addr = ipaddress.ip_address(ip_str)
            if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
                addr = addr.ipv4_mapped
            if any(addr in net for net in PRIVATE_NETWORKS):
                return True
        except ValueError:
            return True
    return False

def is_allowed(target_url: str):
    try:
        parsed = urlparse(target_url)
    except Exception:
        return False, 'Ungueltige URL'

    if parsed.scheme not in ('http', 'https'):
        return False, 'Nur HTTP/HTTPS erlaubt'

    host = parsed.hostname or ''
    if not host:
        return False, 'Kein Hostname'

    try:
        ipaddress.ip_address(host)
        return False, 'Direkte IP-Adressen nicht erlaubt'
    except ValueError:
        pass

    if not any(host == d or host.endswith('.' + d) for d in ALLOWED_DOMAINS):
        return False, 'Domain nicht erlaubt'

    if is_private_ip(host):
        return False, 'Privater/lokaler Host nicht erlaubt'

    return True, ''

# ── Rate-Limiting (thread-safe mit Lock) ─────────────────────────
# FIX #6: threading.Lock() verhindert Race Conditions bei threads=8
_rate_data     = defaultdict(lambda: {'count': 0, 'reset': 0.0})
_rate_lock     = threading.Lock()          # <-- NEU: expliziter Lock
RATE_LIMIT     = 120
RATE_WINDOW    = 60.0
_CLEANUP_EVERY = 300
_last_cleanup  = time.monotonic()

def check_rate_limit(ip: str) -> bool:
    global _last_cleanup
    now = time.monotonic()

    with _rate_lock:                       # <-- atomare Operation
        # Periodische Bereinigung
        if now - _last_cleanup > _CLEANUP_EVERY:
            expired = [k for k, v in _rate_data.items() if now > v['reset']]
            for k in expired:
                del _rate_data[k]
            _last_cleanup = now

        data = _rate_data[ip]
        if now > data['reset']:
            data['count'] = 0
            data['reset'] = now + RATE_WINDOW
        data['count'] += 1
        return data['count'] <= RATE_LIMIT

# ── CORS-Header ───────────────────────────────────────────────────
CORS_HEADERS = {
    'Access-Control-Allow-Origin':  'http://localhost:5000',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': (
        'Authorization, Content-Type, x-api-key, '
        'anthropic-version, anthropic-dangerous-direct-browser-access'
    ),
}

# FIX #9: 'location' hinzugefügt – verhindert Client-seitiges Redirect-Following
EXCLUDED_RESP_HEADERS = {
    'transfer-encoding', 'content-encoding', 'content-length',
    'connection', 'server', 'x-powered-by',
    'set-cookie',
    'location',        # <-- NEU: 30x-Redirects werden nicht an den Client weitergegeben
}

SECURITY_HEADERS = {
    'X-Content-Type-Options':  'nosniff',
    'X-Frame-Options':         'DENY',
    'Referrer-Policy':         'no-referrer',
    'X-DNS-Prefetch-Control':  'off',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self' https://api.anthropic.com https://api.openai.com "
        "https://chat.kiconnect.nrw https://openrouter.ai; "
        "img-src 'self' data: blob:; "
        "font-src 'self'; "
        "frame-src 'none'; "
        "object-src 'none'; "
        "base-uri 'self';"
    ),
    'Permissions-Policy': (
        'geolocation=(), microphone=(), camera=(), '
        'payment=(), usb=(), magnetometer=(), gyroscope=()'
    ),
}

@app.after_request
def add_security_headers(response):
    for k, v in CORS_HEADERS.items():
        response.headers[k] = v
    for k, v in SECURITY_HEADERS.items():
        response.headers[k] = v
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
        return Response('Not found', status=404)

    basename = os.path.basename(filename).lower()
    if basename.startswith('.') or any(basename.endswith(ext) for ext in ['.py', '.key', '.pem', '.env', '.ini', '.cfg', '.log']):
        abort(404)
        return Response('Not found', status=404)

    if os.path.isfile(safe_path):
        return send_from_directory(STATIC_DIR, filename)

    abort(404)
    return Response('Not found', status=404)

# ── Proxy: /proxy/<volle-ziel-url> ───────────────────────────────
@app.route('/proxy/<path:target>', methods=['GET', 'POST', 'OPTIONS'])
def proxy(target):
    if request.method == 'OPTIONS':
        return Response('', status=204, headers={**CORS_HEADERS, **SECURITY_HEADERS})
    return _proxy_request(target)

def _proxy_request(target_url: str):
    client_ip = request.remote_addr or '0.0.0.0'
    if not check_rate_limit(client_ip):
        return Response('{"error":"Too many requests - please wait a moment."}',
                        status=429, content_type='application/json')

    try:
        target_url = unquote(target_url)
    except Exception:
        pass

    ok, reason = is_allowed(target_url)
    if not ok:
        print(f'  blocked [{reason}]')
        return Response('{"error":"Request blocked."}',
                        status=403, content_type='application/json')

    ALLOWED_REQ_HEADERS = {
        'authorization', 'content-type', 'x-api-key',
        'anthropic-version', 'anthropic-dangerous-direct-browser-access',
        'accept', 'accept-encoding',
    }
    fwd_headers = {
        k: v for k, v in request.headers
        if k.lower() in ALLOWED_REQ_HEADERS
    }

    body = request.get_data()
    if len(body) > MAX_BODY_SIZE:
        return Response('{"error":"Request body too large."}',
                        status=413, content_type='application/json')

    print(f'  -> {request.method:6s} {target_url[:90]}')

    try:
        upstream = requests.request(
            method          = request.method,
            url             = target_url,
            headers         = fwd_headers,
            data            = body,
            params          = request.args,
            stream          = True,
            timeout         = (10, 180),
            verify          = True,
            allow_redirects = False,
        )

        resp_headers = {
            k: v for k, v in upstream.headers.items()
            if k.lower() not in EXCLUDED_RESP_HEADERS
        }
        resp_headers.update(CORS_HEADERS)
        resp_headers.update(SECURITY_HEADERS)

        def generate():
            try:
                for chunk in upstream.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            except Exception as e:
                print(f'  Stream-Fehler: {type(e).__name__}')
                return

        print(f'  <- {upstream.status_code}')
        return Response(generate(), status=upstream.status_code, headers=resp_headers)

    except requests.exceptions.SSLError:
        print('  SSL error')
        return Response('{"error":"SSL certificate invalid."}',
                        status=502, content_type='application/json')

    except requests.exceptions.ConnectionError:
        print('  Connection error')
        return Response('{"error":"Target server unreachable."}',
                        status=502, content_type='application/json')

    except requests.exceptions.Timeout:
        print('  Timeout')
        return Response('{"error":"API did not respond (timeout)."}',
                        status=504, content_type='application/json')

    except Exception as e:
        print(f'  Error: {type(e).__name__}')
        return Response('{"error":"Internal proxy error."}',
                        status=500, content_type='application/json')

if __name__ == '__main__':
    try:
        from waitress import serve
    except ImportError:
        print('[ERROR] waitress not installed. Run: pip install waitress')
        sys.exit(1)

    print()
    print('╔════════════════════════════════════════════════════════════════╗')
    print('║     KI Connect — CORS-Proxy  (Waitress WSGI v4.2)              ║')
    print('╠════════════════════════════════════════════════════════════════╣')
    print('║  Running on:  http://localhost:5000                            ║')
    print('║  Binding:     127.0.0.1 only (localhost-only, no LAN access)   ║')
    print('║  Threads:     8  (thread-safe rate-limiting via Lock)          ║')
    print('║                                                                ║')
    print('║  Security fixes v4.2:                                          ║')
    print('║    + threading.Lock() für Race-Condition-freies Rate-Limiting  ║')
    print('║    + location-Header gefiltert (kein Client-Redirect via 30x)  ║')
    print('║                                                                ║')
    print('║  Allowed providers (allowlist):                                ║')
    print('║    * chat.kiconnect.nrw   (OpenAI-compatible)                  ║')
    print('║    * api.anthropic.com    (Claude)                             ║')
    print('║    * api.openai.com       (GPT-4o, o1, ...)                    ║')
    print('║    * openrouter.ai                                             ║')
    print('║                                                                ║')
    print('║  Custom server? -> add to ALLOWED_DOMAINS in kiconnect-proxy.py║')
    print('║  Stop with Ctrl+C                                              ║')
    print('╚════════════════════════════════════════════════════════════════╝')
    print()

    serve(
        app,
        host='127.0.0.1',
        port=5000,
        threads=8,
        channel_timeout=120,
        cleanup_interval=10,
    )
