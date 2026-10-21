"""Bench server: a Range server that records every request a download manager makes, to compare IDM and Deer
black-box. Standalone (not the downloads test suite's server); port 47995 by default.

  python server.py [--port 47995] [--log requests.jsonl]

GET/HEAD /f/<scenario>/<name>?<knobs>    a synthetic file (deterministic bytes by offset)
  size=MiB (256)        file size
  ttfb=ms               delay before the response headers (a tunnel/proxy host), every request
  rate=KBps             per-connection rate (0 = as fast as possible)
  slow=A-B&slowrate=K   the first request whose Range starts in [A, B) (MiB) is sent at K KB/s
  stall=A-B&stallafter=KiB  the first request starting in [A, B) sends that much, then nothing (socket kept open)
  fail=A-B&failn=N&failcode=500  the first N requests starting in [A, B) answer failcode
  reset=A-B&resetafter=KiB&resetn=N  the first N requests starting in [A, B) are reset (RST) after that much
  maxconn=K&limit=503|429|close  more than K bodies at once: refused with limit (close = connection dropped)
  expire=S&expirefor=S2  from S s after the first request, every request answers 403 for S2 s (then works)
  norange=1             Range ignored: always 200 with the whole file
  nolength=1            no Content-Length (close-delimited), implies norange
GET /log                every request so far (JSON); /timeline bytes sent per 250 ms; /reset clears both
Each request entry: t (arrival), th (headers sent), te (end), port, method, range, start, end, status, sent,
outcome (done | client-closed | reset | stalled-closed | refused), headers (User-Agent, Connection, Accept-Encoding,
If-Range, Range, Referer).
"""
import argparse
import json
import os
import random
import select
import socket
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.Lock()
STATE = {'log': [], 'timeline': {}, 'counts': {}, 'active': {}, 'first': {}}
ARGS = None
MiB = 1 << 20
# Deterministic content: a 1 MiB + 7 random pattern repeated (offset-dependent alignment).
_rng = random.Random(20261020)
PATTERN = bytes(_rng.getrandbits(8) for _ in range(MiB + 7))
PLEN = len(PATTERN)


def content(off, n):
    out = bytearray()
    while n > 0:
        i = off % PLEN
        k = min(n, PLEN - i)
        out += PATTERN[i:i + k]
        off += k
        n -= k
    return bytes(out)


def region(spec, start):
    a, _, b = spec.partition('-')
    return float(a) * MiB <= start < float(b) * MiB


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'DeerBench/1'

    def log_message(self, *a):
        pass

    def do_HEAD(self):
        self.handle_file(head=True)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/log':
            with LOCK:
                return self.send_json(STATE['log'])
        if u.path == '/timeline':
            with LOCK:
                return self.send_json(sorted(STATE['timeline'].items()))
        if u.path == '/reset':
            with LOCK:
                STATE.update(log=[], timeline={}, counts={}, active={}, first={})
            return self.send_json({})
        self.handle_file(head=False)

    def send_json(self, obj):
        data = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def entry(self, **kw):
        e = {'t': round(time.time(), 3), 'port': self.client_address[1], 'method': self.command, 'path': self.path,
             'headers': {k: self.headers.get(k, '') for k in ('User-Agent', 'Connection', 'Accept-Encoding', 'If-Range', 'Range', 'Referer')}}
        e.update(kw)
        with LOCK:
            STATE['log'].append(e)
        if ARGS.log:
            with LOCK, open(ARGS.log, 'a') as f:
                f.write(json.dumps(e) + '\n')
        return e

    def count(self, key):
        with LOCK:
            STATE['counts'][key] = STATE['counts'].get(key, 0) + 1
            return STATE['counts'][key]

    def handle_file(self, head):
        u = urlparse(self.path)
        parts = u.path.split('/')
        if len(parts) < 4 or parts[1] != 'f':
            self.send_error(404)
            return
        scen = parts[2]
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        size = int(float(q.get('size', '256')) * MiB)
        rate = float(q.get('rate', '0')) * 1024
        norange = q.get('norange') == '1' or q.get('nolength') == '1'
        rng = self.headers.get('Range', '')
        start, end = 0, size - 1
        ranged = False
        if rng.startswith('bytes=') and not norange:
            a, _, b = rng[6:].split(',')[0].partition('-')
            if a:
                start = int(a)
                end = min(size - 1, int(b)) if b else size - 1
            elif b:
                start = max(0, size - int(b))
            ranged = True
            ir = self.headers.get('If-Range')
            if ir and ir != '"bench-%d"' % size:
                start, end, ranged = 0, size - 1, False
        e = self.entry(range=rng, start=start, end=end)
        now = time.time()
        with LOCK:
            STATE['first'].setdefault(scen, now)
            first = STATE['first'][scen]
        if 'ttfb' in q:
            time.sleep(float(q['ttfb']) / 1000)
        # Refusals.
        if 'expire' in q and first + float(q['expire']) <= now < first + float(q['expire']) + float(q.get('expirefor', '30')):
            return self.refuse(e, 403)
        if 'fail' in q and region(q['fail'], start) and self.count(scen + ':fail') <= int(q.get('failn', '4')):
            return self.refuse(e, int(q.get('failcode', '500')))
        if 'maxconn' in q and not head:
            with LOCK:
                act = STATE['active'].get(scen, 0)
            if act >= int(q['maxconn']):
                how = q.get('limit', '503')
                if how == 'close':
                    e.update(status=0, outcome='refused-close', te=round(time.time(), 3))
                    self.close_connection = True
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    return
                return self.refuse(e, int(how), retry_after=q.get('retryafter'))
        status = 206 if ranged else 200
        length = end - start + 1
        self.send_response(status)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Accept-Ranges', 'none' if norange else 'bytes')
        self.send_header('ETag', '"bench-%d"' % size)
        self.send_header('Last-Modified', 'Mon, 19 Oct 2026 10:00:00 GMT')
        if q.get('nolength') == '1':
            self.close_connection = True
            self.send_header('Connection', 'close')
        else:
            self.send_header('Content-Length', str(length))
        if ranged:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.end_headers()
        e.update(status=status, th=round(time.time(), 3))
        if head:
            e.update(sent=0, outcome='head', te=round(time.time(), 3))
            return
        # Per-request behaviour.
        crawl = 'slow' in q and region(q['slow'], start) and self.count(scen + ':slow') == 1
        stall = 'stall' in q and region(q['stall'], start) and self.count(scen + ':stall') == 1
        reset = 'reset' in q and region(q['reset'], start) and self.count(scen + ':reset') <= int(q.get('resetn', '3'))
        r = float(q.get('slowrate', '16')) * 1024 if crawl else rate
        stop_at = int(float(q.get('stallafter', '1024')) * 1024) if stall else (int(float(q.get('resetafter', '1024')) * 1024) if reset else -1)
        with LOCK:
            STATE['active'][scen] = STATE['active'].get(scen, 0) + 1
        sent = 0
        t0 = time.time()
        outcome = 'done'
        try:
            chunk = 16384 if r else 262144
            while sent < length:
                n = min(chunk, length - sent)
                if stop_at >= 0 and sent + n > stop_at:
                    n = stop_at - sent
                if n > 0:
                    self.wfile.write(content(start + sent, n))
                    sent += n
                    b = int(time.time() * 4)
                    with LOCK:
                        STATE['timeline'][b] = STATE['timeline'].get(b, 0) + n
                if stop_at >= 0 and sent >= stop_at:
                    if stall:
                        # Send nothing more; wait until the client gives up (its read timeout).
                        self.wfile.flush()
                        while True:
                            rd, _, _ = select.select([self.connection], [], [], 1.0)
                            if rd:
                                try:
                                    if not self.connection.recv(1, socket.MSG_PEEK):
                                        break
                                except OSError:
                                    break
                            if time.time() - t0 > 600:
                                break
                        outcome = 'stalled-closed'
                    else:
                        self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                        outcome = 'reset'
                    self.close_connection = True
                    try:
                        self.connection.close()
                    except OSError:
                        pass
                    break
                if r:
                    ahead = sent / r - (time.time() - t0)
                    if ahead > 0:
                        time.sleep(ahead)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            outcome = 'client-closed'
            self.close_connection = True
        finally:
            with LOCK:
                STATE['active'][scen] -= 1
            e.update(sent=sent, outcome=outcome, te=round(time.time(), 3), crawl=crawl, stall=stall, reset=reset)

    def refuse(self, e, code, retry_after=None):
        body = b'refused'
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain')
        self.send_header('Content-Length', str(len(body)))
        if retry_after:
            self.send_header('Retry-After', retry_after)
        self.end_headers()
        self.wfile.write(body)
        e.update(status=code, sent=0, outcome='refused', th=round(time.time(), 3), te=round(time.time(), 3))


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47995)
    ap.add_argument('--log')
    ARGS = ap.parse_args()
    srv = Server(('127.0.0.1', ARGS.port), Handler)
    print('bench server on', ARGS.port, flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
