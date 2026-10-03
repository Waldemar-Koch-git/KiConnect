"""Local ChatGPT plan connection. OAuth credentials never enter the browser.

Official flow: developers.openai.com/siwc/token-sharing-open-source/sign-in
The compatibility adapter keeps the existing KiConnect chat/agent UI intact.
"""
import base64
import hashlib
import json
import secrets
import threading
import time
import uuid
from urllib.parse import urlencode, urlparse

import requests
from flask import Response, request
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

AUTH = 'https://auth.openai.com'
API = 'https://api.openai.com/v1'
NAMESPACE = 'kiconnect'
LANGUAGES = {'en', 'de', 'fr', 'es', 'it', 'tr', 'ru', 'el', 'zh', 'ar', 'hi', 'ta', 'bn', 'pa', 'ur', 'fa'}


def _b64(value):
    return base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')


def _decode(value):
    return base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))


class ConnectionError(Exception):
    def __init__(self, key, status=400, variables=None):
        super().__init__(key)
        self.status = status
        self.key = key
        self.variables = variables or {}

    def payload(self):
        return {'key': self.key, 'vars': self.variables}


def _remote(method, url, **kwargs):
    try:
        return requests.request(method, url, timeout=kwargs.pop('timeout', (10, 30)), allow_redirects=False, **kwargs)
    except requests.RequestException:
        raise ConnectionError('chatgpt.unreachable', 502)


def _json_remote(response):
    if not response.ok:
        # Never echo token-endpoint bodies or authorization credentials.
        if response.status_code in (401, 403):
            raise ConnectionError('chatgpt.denied', 401)
        if response.status_code == 429:
            raise ConnectionError('chatgpt.quota', 429)
        raise ConnectionError('chatgpt.http', 502, {'details': response.status_code})
    try:
        return response.json()
    except ValueError:
        raise ConnectionError('chatgpt.invalidResponse', 502)


def _verify_identity(token, client_id, nonce=None):
    """Verify the JWS first, then trust claims; fail closed on unknown algorithms."""
    try:
        header64, claims64, signature64 = token.split('.')
        header = json.loads(_decode(header64))
        keys = _json_remote(_remote('GET', AUTH + '/.well-known/jwks.json'))['keys']
        jwk = next(k for k in keys if k.get('kid') == header.get('kid') and k.get('use', 'sig') == 'sig')
        signed = (header64 + '.' + claims64).encode('ascii')
        signature = _decode(signature64)
        if header.get('alg') == 'RS256' and jwk['kty'] == 'RSA':
            pub = rsa.RSAPublicNumbers(int.from_bytes(_decode(jwk['e']), 'big'), int.from_bytes(_decode(jwk['n']), 'big')).public_key()
            pub.verify(signature, signed, padding.PKCS1v15(), hashes.SHA256())
        elif header.get('alg') == 'ES256' and jwk['kty'] == 'EC' and jwk['crv'] == 'P-256':
            if len(signature) != 64:
                raise ValueError('signature length')
            pub = ec.EllipticCurvePublicNumbers(int.from_bytes(_decode(jwk['x']), 'big'), int.from_bytes(_decode(jwk['y']), 'big'), ec.SECP256R1()).public_key()
            pub.verify(encode_dss_signature(int.from_bytes(signature[:32], 'big'), int.from_bytes(signature[32:], 'big')), signed, ec.ECDSA(hashes.SHA256()))
        else:
            raise ValueError('unsupported signature algorithm')
        claims = json.loads(_decode(claims64))
        audience = claims.get('aud', [])
        if isinstance(audience, str):
            audience = [audience]
        if claims.get('iss') != AUTH or client_id not in audience or not claims.get('sub'):
            raise ValueError('identity')
        now = time.time()
        if claims['exp'] < now - 5 or claims['iat'] > now + 5 or claims.get('nbf', 0) > now + 5:
            raise ValueError('time')
        if nonce is not None and not secrets.compare_digest(str(claims.get('nonce', '')), nonce):
            raise ValueError('nonce')
        return claims
    except ConnectionError:
        raise
    except Exception:
        raise ConnectionError('chatgpt.identity')


def responses_body(body):
    """Translate full Chat Completions history, including tools and image parts."""
    result = {'model': body['model'], 'input': [], 'store': False, 'stream': True,
              'include': ['reasoning.encrypted_content']}
    instructions = []
    for message in body.get('messages', []):
        role = message.get('role')
        content = message.get('content')
        if role in ('system', 'developer'):
            instructions.append(str(content or ''))
            continue
        if role == 'tool':
            result['input'].append({'type': 'function_call_output', 'call_id': message['tool_call_id'], 'output': str(content or '')})
            continue
        # Preserve encrypted reasoning/output items on agent follow-up requests.
        if message.get('_chatgpt_output'):
            result['input'].extend(message['_chatgpt_output'])
            continue
        if content:
            if isinstance(content, list):
                parts = []
                for part in content:
                    if part.get('type') == 'text':
                        parts.append({'type': 'output_text' if role == 'assistant' else 'input_text', 'text': part['text']})
                    elif part.get('type') == 'image_url' and role == 'user':
                        image = part['image_url']
                        parts.append({'type': 'input_image', 'image_url': image['url'] if isinstance(image, dict) else image})
                    elif part.get('type') == 'file' and role == 'user':
                        if body.get('chatgpt_pdf_consent') is not True:
                            raise ConnectionError('chatgpt.pdfRequired')
                        file = part['file']
                        if not str(file.get('file_data', '')).startswith('data:application/pdf;base64,'):
                            raise ConnectionError('chatgpt.pdfOnly')
                        parts.append({'type': 'input_file', 'filename': file['filename'], 'file_data': file['file_data']})
                    else:
                        raise ConnectionError('chatgpt.unsupportedAttachment')
                content = parts
            result['input'].append({'role': role, 'content': content})
        for call in message.get('tool_calls', []):
            result['input'].append({'type': 'function_call', 'call_id': call['id'], 'namespace': NAMESPACE,
                                    'name': call['function']['name'], 'arguments': call['function']['arguments']})
    if instructions:
        result['instructions'] = '\n\n'.join(instructions)
    if body.get('reasoning_effort'):
        result['reasoning'] = {'effort': body['reasoning_effort']}
    functions = []
    for tool in body.get('tools', []):
        if tool.get('type') != 'function':
            raise ConnectionError('chatgpt.unsupportedTool')
        fn = tool['function']
        functions.append({'type': 'function', 'name': fn['name'], 'description': fn.get('description', ''),
                          'parameters': fn.get('parameters', {}), 'strict': False})
    if functions:
        result['tools'] = [{'type': 'namespace', 'name': NAMESPACE, 'description': 'KiConnect local tools', 'tools': functions}]
    return result


def completion(response):
    output = response.get('output', [])
    text = ''.join(p.get('text', '') if p.get('type') == 'output_text' else p.get('refusal', '')
                   for item in output if item.get('type') == 'message' for p in item.get('content', [])
                   if p.get('type') in ('output_text', 'refusal'))
    calls = [{'id': item['call_id'], 'type': 'function', 'function': {'name': item['name'], 'arguments': item['arguments']}}
             for item in output if item.get('type') == 'function_call']
    if not text.strip() and not calls:
        kinds = ', '.join(sorted({str(item.get('type', 'unknown')) for item in output})) or 'none'
        raise ConnectionError('chatgpt.empty', 502, {'details': kinds})
    usage = response.get('usage') or {}
    return {'choices': [{'message': {'role': 'assistant', 'content': text, 'tool_calls': calls, '_chatgpt_output': output},
                         'finish_reason': 'tool_calls' if calls else 'stop'}],
            'usage': {'prompt_tokens': usage.get('input_tokens', 0), 'completion_tokens': usage.get('output_tokens', 0),
                      'prompt_tokens_details': {'cached_tokens': (usage.get('input_tokens_details') or {}).get('cached_tokens', 0)}}}


def events(upstream):
    data = []
    for line in upstream.iter_lines(decode_unicode=True):
        if isinstance(line, bytes):
            line = line.decode('utf-8')
        if not line:
            if data:
                yield json.loads('\n'.join(data))
                data = []
        elif line.startswith('data:'):
            data.append(line[5:].lstrip())
    if data:
        yield json.loads('\n'.join(data))


def completed_response(event, output_items):
    """Keep finished output items when the terminal event omits its output."""
    response = dict(event.get('response') or {})
    if not response.get('output') and output_items:
        response['output'] = output_items
    return response


def register_chatgpt(app, session_lookup, load_registry, save_registry, store_lock, data_dir, atomic_write):
    # Same lock as account rekey/deletion: never persist using a superseded AES key.
    lock = store_lock
    pending = {}

    def registry(sess):
        return load_registry(sess, 'chatgpt_connections', 'connections')

    def persist(sess, data):
        save_registry(sess, 'chatgpt_connections', data)

    def connection(data, pid):
        return next((c for c in data['connections'] if c['id'] == pid), None)

    def public(record):
        return {k: record.get(k) for k in ('id', 'email', 'subject', 'client_id')} | {
            'connected': bool(record.get('access_token')), 'plan_enabled': 'chatgpt.tokens.use.direct' in record.get('scopes', [])}

    def save_tokens(record, tokens):
        if not tokens.get('access_token') or tokens.get('token_type', '').lower() != 'bearer':
            raise ConnectionError('chatgpt.credentials')
        record.update({k: tokens[k] for k in ('access_token', 'refresh_token', 'id_token') if k in tokens})
        record['expires_at'] = time.time() + float(tokens.get('expires_in', 3600))
        if 'scope' in tokens:
            record['scopes'] = tokens['scope'].split()

    def access(sess, pid):
        with lock:
            data = registry(sess)
            record = connection(data, pid)
            if not record or not record.get('access_token'):
                raise ConnectionError('chatgpt.saveFirst', 401)
            if 'chatgpt.tokens.use.direct' not in record.get('scopes', []):
                raise ConnectionError('chatgpt.plan', 403)
            if record.get('expires_at', 0) < time.time() + 60:
                if not record.get('refresh_token'):
                    raise ConnectionError('chatgpt.authenticationExpired', 401)
                response = _remote('POST', AUTH + '/api/accounts/oauth/token', data={
                    'grant_type': 'refresh_token', 'client_id': record['client_id'],
                    'refresh_token': record['refresh_token'], 'resource': API})
                if response.status_code in (400, 401, 403):
                    raise ConnectionError('chatgpt.authenticationExpired', 401)
                tokens = _json_remote(response)
                if tokens.get('id_token'):
                    identity = _verify_identity(tokens['id_token'], record['client_id'])
                    if identity['sub'] != record['subject']:
                        raise ConnectionError('chatgpt.refreshAccount', 401)
                save_tokens(record, tokens)
                persist(sess, data)
                if 'chatgpt.tokens.use.direct' not in record.get('scopes', []):
                    raise ConnectionError('chatgpt.revokedPlan', 403)
            return record['access_token']

    def authed(fn):
        from functools import wraps
        @wraps(fn)
        def wrapped(*args, **kwargs):
            sess = session_lookup()
            if not sess:
                return Response(json.dumps({'error': {'key': 'chatgpt.unlock', 'vars': {}}}), 401, content_type='application/json')
            language = request.headers.get('X-KiConnect-Language')
            if language in LANGUAGES:
                with lock:
                    for attempt in pending.values():
                        if attempt['account_id'] == sess['accountId']:
                            attempt['language'] = language
            try:
                return fn(sess, *args, **kwargs)
            except ConnectionError as error:
                return Response(json.dumps({'error': error.payload()}), error.status, content_type='application/json')
        return wrapped

    @app.route('/chatgpt/<pid>/status', methods=['GET'])
    @authed
    def status(sess, pid):
        with lock:
            now = time.time()
            for key in list(pending):
                if pending[key]['expires'] < now:
                    pending.pop(key, None)
            record = connection(registry(sess), pid)
            attempts = [a for a in pending.values() if a['account_id'] == sess['accountId'] and a['pid'] == pid]
            error = next((a.get('error') for a in attempts if a.get('error')), None)
            return {'connection': public(record) if record else None, 'error': error,
                    'pending': any(not a.get('done') for a in attempts)}

    @app.route('/chatgpt/<pid>/login', methods=['POST'])
    @authed
    def login(sess, pid):
        if not re_valid_id(pid):
            raise ConnectionError('chatgpt.invalidProvider')
        with lock:
            import os
            # Host identifier is non-secret; credential storage uses the account's AES key.
            path = os.path.join(data_dir, '_chatgpt_host.json')
            with store_lock:
                if os.path.isfile(path):
                    with open(path, encoding='utf-8') as file:
                        host = json.load(file)['id']
                else:
                    host = 'urn:uuid:' + str(uuid.uuid4())
                    atomic_write(path, json.dumps({'id': host}).encode())
            data = registry(sess)
            record = connection(data, pid)
            state = secrets.token_urlsafe(32)
            verifier = secrets.token_urlsafe(64)
            nonce = secrets.token_urlsafe(32)
            redirect_uri = 'http://127.0.0.1:%s/auth/callback' % request.host.split(':')[-1]
            for key in list(pending):
                if pending[key]['expires'] < time.time() or (pending[key]['account_id'] == sess['accountId'] and pending[key]['pid'] == pid):
                    pending.pop(key, None)
            pending[state] = {'account_id': sess['accountId'], 'session_token': request.headers['X-Agent-Session'],
                              'pid': pid, 'verifier': verifier, 'nonce': nonce, 'redirect': redirect_uri,
                              'expires': time.time() + 600, 'client_id': record.get('client_id') if record else None,
                              'language': request.headers.get('X-KiConnect-Language') if request.headers.get('X-KiConnect-Language') in LANGUAGES else 'en'}
            params = {'client_id': record['client_id'] if record else 'dynamic_agent_client',
                      'ext_agent_host_id': host, 'response_type': 'code', 'redirect_uri': redirect_uri,
                      'scope': 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
                      'resource': API, 'state': state, 'nonce': nonce, 'code_challenge_method': 'S256',
                      'code_challenge': _b64(hashlib.sha256(verifier.encode()).digest())}
            if record:
                if record.get('id_token'):
                    params['id_token_hint'] = record['id_token']
                if record.get('email'):
                    params['login_hint'] = record['email']
            else:
                params['agent_name_hint'] = 'KiConnect'
            return {'url': AUTH + '/api/accounts/authorize?' + urlencode(params)}

    def callback_page(message, language='en'):
        from html import escape
        return Response('<!doctype html><html lang="' + escape(language, quote=True) + '"><head><meta charset="utf-8"><base href="/">'
                        '<title>KiConnect · ChatGPT</title></head><body><h1>KiConnect · ChatGPT</h1>'
                        '<p id="chatgptCallbackMessage" data-message="' + escape(json.dumps(message if isinstance(message, dict) else {'key': message, 'vars': {}}), quote=True) + '">'
                        + '</p><script src="/kiconnect-languages-i18n.js"></script>'
                        '<script type="module" src="/_js/providers/chatgpt-callback.js"></script></body></html>',
                        content_type='text/html', headers={'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})

    @app.route('/auth/callback-language', methods=['GET'])
    def callback_language():
        # Only a language code is public here, protected by the short-lived,
        # unpredictable OAuth state. Credentials and account details stay private.
        with lock:
            attempt = pending.get(request.args.get('state', ''))
            if not attempt or attempt['expires'] < time.time():
                return Response(status=404, headers={'Cache-Control': 'no-store'})
            return Response(json.dumps({'language': attempt.get('language', 'en')}),
                            content_type='application/json', headers={'Cache-Control': 'no-store'})

    @app.route('/auth/callback', methods=['GET'])
    def callback():
        attempt = None
        try:
            with lock:
                attempt = pending.get(request.args.get('state', ''))
                if attempt and attempt.get('succeeded') and attempt['expires'] >= time.time():
                    return callback_page('chatgpt.callbackAlready', attempt.get('language', 'en'))
                if not attempt or attempt.get('done') or attempt['expires'] < time.time():
                    raise ConnectionError('chatgpt.invalidAttempt')
                attempt['done'] = True  # One-time consumption, including failed attempts.
                # Lookup the original unlocked session without keeping its encryption key in OAuth state.
                with app.test_request_context(headers={'X-Agent-Session': attempt['session_token']}):
                    sess = session_lookup()
                if not sess:
                    raise ConnectionError('chatgpt.locked')
                if request.args.get('error'):
                    raise ConnectionError('chatgpt.cancelled')
                client_id = request.args.get('client_id') or attempt['client_id']
                if not client_id or client_id == 'dynamic_agent_client' or (attempt['client_id'] and client_id != attempt['client_id']):
                    raise ConnectionError('chatgpt.registration')
                code = request.args.get('code')
                if not code:
                    raise ConnectionError('chatgpt.code')
                tokens = _json_remote(_remote('POST', AUTH + '/api/accounts/oauth/token', data={
                    'grant_type': 'authorization_code', 'client_id': client_id, 'code': code,
                    'code_verifier': attempt['verifier'], 'redirect_uri': attempt['redirect'], 'resource': API}))
                identity = _verify_identity(tokens.get('id_token', ''), client_id, attempt['nonce'])
                data = registry(sess)
                record = connection(data, attempt['pid'])
                if record and record.get('subject') != identity['sub']:
                    raise ConnectionError('chatgpt.account')
                if not record:
                    record = {'id': attempt['pid'], 'client_id': client_id, 'subject': identity['sub']}
                    data['connections'].append(record)
                record['email'] = identity.get('email', '')
                save_tokens(record, tokens)
                persist(sess, data)
                if 'chatgpt.tokens.use.direct' not in record.get('scopes', []):
                    raise ConnectionError('chatgpt.plan')
                message = 'chatgpt.callbackSuccess'
                attempt['succeeded'] = True
        except ConnectionError as error:
            message = error.payload()
            if attempt:
                attempt['error'] = message
        except Exception:
            message = 'chatgpt.callbackFailed'
            if attempt:
                attempt['error'] = message
        return callback_page(message, attempt.get('language', 'en') if attempt else 'en')

    @app.route('/chatgpt/<pid>/logout', methods=['POST'])
    @authed
    def logout(sess, pid):
        confirmed = True
        with lock:
            for key in list(pending):
                if pending[key]['account_id'] == sess['accountId'] and pending[key]['pid'] == pid:
                    pending.pop(key, None)
            data = registry(sess)
            record = connection(data, pid)
            if record:
                if record.get('refresh_token'):
                    try:
                        discovery = _json_remote(_remote('GET', AUTH + '/.well-known/openid-configuration'))
                        url = discovery['revocation_endpoint']
                        parsed = urlparse(url)
                        if parsed.scheme != 'https' or parsed.hostname != 'auth.openai.com':
                            raise ConnectionError('chatgpt.invalidRevoke')
                        confirmed = _remote('POST', url, data={'token': record['refresh_token'], 'token_type_hint': 'refresh_token', 'client_id': record['client_id']}).status_code == 200
                    except Exception:
                        confirmed = False
                for key in ('access_token', 'refresh_token', 'id_token', 'expires_at'):
                    record.pop(key, None)
                persist(sess, data)
        return {'ok': True, 'revocation_confirmed': confirmed}

    @app.route('/chatgpt/<pid>/models', methods=['GET'])
    @authed
    def models(sess, pid):
        payload = _json_remote(_remote('GET', API + '/models', headers={'Authorization': 'Bearer ' + access(sess, pid)}))
        catalog = [{'id': model['slug'], 'label': model.get('display_name') or model['slug'],
                    'visibility': model.get('visibility')}
                   for model in payload.get('models', [])
                   if isinstance(model, dict) and isinstance(model.get('slug'), str)]
        # Expose only model metadata for troubleshooting; never forward tokens
        # or arbitrary upstream fields to the browser.
        return {'data': [{'id': model['id'], 'label': model['label']}
                         for model in catalog if model['visibility'] == 'list'],
                'catalog': catalog, 'fetched_at': int(time.time())}

    @app.route('/chatgpt/<pid>/chat/completions', methods=['POST'])
    @authed
    def chat(sess, pid):
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get('model'), str) or not isinstance(body.get('messages'), list):
            raise ConnectionError('chatgpt.invalidChat')
        upstream = _remote('POST', API + '/responses', json=responses_body(body), stream=True, timeout=(10, 180),
                           headers={'Authorization': 'Bearer ' + access(sess, pid), 'Content-Type': 'application/json'})
        if not upstream.ok:
            try:
                _json_remote(upstream)
            finally:
                upstream.close()

        if not body.get('stream'):
            try:
                output_items = []
                for event in events(upstream):
                    if event['type'] == 'response.output_item.done':
                        output_items.append(event['item'])
                    if event['type'] == 'response.completed':
                        return completion(completed_response(event, output_items))
                    if event['type'] in ('response.failed', 'response.incomplete', 'error'):
                        raise ConnectionError('chatgpt.incomplete', 502)
                raise ConnectionError('chatgpt.interrupted', 502)
            finally:
                upstream.close()

        def stream():
            try:
                emitted = ''
                output_items = []
                for event in events(upstream):
                    if event['type'] in ('response.output_text.delta', 'response.refusal.delta'):
                        emitted += event['delta']
                        yield 'data: ' + json.dumps({'choices': [{'delta': {'content': event['delta']}}]}) + '\n\n'
                    elif event['type'] == 'response.output_item.done':
                        output_items.append(event['item'])
                    elif event['type'] == 'response.completed':
                        result = completion(completed_response(event, output_items))
                        final_text = result['choices'][0]['message']['content']
                        # Some streams provide final text without all deltas.
                        # Send only the missing suffix, avoiding duplicate text.
                        if final_text.startswith(emitted) and len(final_text) > len(emitted):
                            yield 'data: ' + json.dumps({'choices': [{'delta': {'content': final_text[len(emitted):]}}]}) + '\n\n'
                        if not final_text.strip():
                            raise ConnectionError('chatgpt.toolWithoutText', 502)
                        yield 'data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': result['usage']}) + '\n\n'
                        yield 'data: [DONE]\n\n'
                        return
                    elif event['type'] in ('response.failed', 'response.incomplete', 'error'):
                        yield 'data: ' + json.dumps({'error': {'key': 'chatgpt.incomplete', 'vars': {}}}) + '\n\n'
                        return
                yield 'data: ' + json.dumps({'error': {'key': 'chatgpt.interrupted', 'vars': {}}}) + '\n\n'
            except ConnectionError as error:
                yield 'data: ' + json.dumps({'error': error.payload()}) + '\n\n'
            finally:
                upstream.close()
        return Response(stream(), content_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


def re_valid_id(value):
    import re
    return bool(re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value))
