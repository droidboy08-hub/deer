"""Run one bench scenario through IDM or Deer and measure it from the bench server's request log.

  python bench.py idm  <scenario> "<knobs>" [--timeout 300]
  python bench.py deer <scenario> "<knobs>" [--timeout 300]

Prints one JSON line: the scenario, the app, and its metrics (time to first byte, connections over time, ranges
asked, retries, reconnects, total time, MB/s, sha256 ok). The downloaded file is deleted afterwards.
IDM is driven by its COM API (IDMan.CIDMLinkTransmitter, SendLinkToIDM flag 1: start without asking; needs comtypes;
IDMan.exe /d is ignored while IDM runs); Deer by tools/run.py with deer_run.js
on the fixed build (--app build-downloads), on its own throwaway profile.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
IDMAN = r'C:\Program Files (x86)\Internet Download Manager\IDMan.exe'
PORT = 47995
BASE = 'http://127.0.0.1:%d' % PORT
MiB = 1 << 20
sys.path.insert(0, HERE)
from server import content  # noqa: E402  (same deterministic bytes)


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read())


def expected_sha(size):
    cache = os.path.join(HERE, 'sha-%d.txt' % size)
    if os.path.exists(cache):
        return open(cache).read().strip()
    h = hashlib.sha256()
    off = 0
    while off < size:
        n = min(16 * MiB, size - off)
        h.update(content(off, n))
        off += n
    open(cache, 'w').write(h.hexdigest())
    return h.hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(16 * MiB), b''):
            h.update(b)
    return h.hexdigest()


def metrics(log, timeline, size, t_start, t_done):
    data = [e for e in log if e.get('status') in (200, 206) and e.get('method') == 'GET']
    t0 = min((e['t'] for e in log), default=t_start)
    first_data = min((e['th'] for e in data if e.get('sent', 0) > 0 and 'th' in e), default=None)
    # Connections carrying a body over time (1 s steps).
    span = max(1, int((t_done or time.time()) - t0) + 1)
    conc = []
    for s in range(span):
        a, b = t0 + s, t0 + s + 1
        conc.append(sum(1 for e in data if e.get('th', 0) < b and e.get('te', 1e18) > a))
    secs = (t_done - t0) if t_done else None
    reqs = [{'t': round(e['t'] - t0, 2), 'm': e['method'], 'st': e.get('status'), 'start': e.get('start'), 'end': e.get('end'), 'sent': e.get('sent'),
             'dur': round(e.get('te', e['t']) - e['t'], 2), 'out': e.get('outcome'), 'port': e['port'], 'range': e['headers'].get('Range', '')} for e in sorted(log, key=lambda e: e['t'])]
    # Per-second throughput (MB/s) from the timeline (250 ms buckets).
    tl = {}
    for b, n in timeline:
        s = int(b / 4 - t0)
        tl[s] = tl.get(s, 0) + n
    tput = [round(tl.get(s, 0) / MiB, 2) for s in range(span)]
    return {
        'first_request_s': round(t0 - t_start, 2),
        'first_data_s': round(first_data - t0, 2) if first_data else None,
        'total_s': round(secs, 2) if secs else None,
        'mbps': round(size / MiB / secs, 2) if secs else None,
        'requests': len(log),
        'heads': sum(1 for e in log if e['method'] == 'HEAD'),
        'refused': sum(1 for e in log if e.get('outcome') == 'refused' or e.get('status') in (403, 429, 500, 503)),
        'ports': len({e['port'] for e in log}),
        'max_conc': max(conc) if conc else 0,
        'conc': conc,
        'tput': tput,
        'wire_bytes': sum(e.get('sent', 0) for e in data),
        'reqs': reqs,
    }


def run_idm(scen, url, name, size, timeout):
    out = os.path.join(HERE, 'out-idm')
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, name)
    if os.path.exists(path):
        os.remove(path)
    t_start = time.time()
    # IDM's documented COM interface (idmantypeinfo.tlb, ICIDMLinkTransmitter2), flag 1 = no confirmation dialogs.
    # Its command line (/d) is ignored while IDM is already running.
    import comtypes.client as cc
    tlb = cc.GetModule(os.path.join(os.path.dirname(IDMAN), 'idmantypeinfo.tlb'))
    cc.CreateObject('IDMan.CIDMLinkTransmitter', interface=tlb.ICIDMLinkTransmitter2).SendLinkToIDM(url, '', '', '', '', '', os.path.normpath(out), name, 1)
    t_done = None
    temp = os.path.join(os.environ['APPDATA'], 'IDM', 'DwnlData')
    snaps = []
    while time.time() - t_start < timeout:
        # What IDM keeps while it downloads (its temp folder), every 2 s.
        if int((time.time() - t_start) * 4) % 8 == 0:
            files = []
            for root, _d, fs in os.walk(temp):
                for f in fs:
                    if 'deer-bench' in root or 'deer-bench' in f:
                        try:
                            files.append([os.path.relpath(os.path.join(root, f), temp), os.path.getsize(os.path.join(root, f))])
                        except OSError:
                            pass
            snaps.append([round(time.time() - t_start, 1), files])
        if os.path.exists(path) and os.path.getsize(path) == size:
            # IDM renames the assembled file into place; make sure it is no longer growing/locked.
            time.sleep(0.5)
            try:
                with open(path, 'rb'):
                    t_done = time.time() - 0.5
                    break
            except OSError:
                pass
        time.sleep(0.25)
    if t_done is None:
        # A download IDM did not finish must not keep asking during the next scenario.
        subprocess.run(['taskkill', '/IM', 'IDMan.exe', '/F'], capture_output=True)
    return path, t_start, t_done, snaps


def run_deer(scen, url, name, size, timeout):
    out = os.path.join(HERE, 'out-deer')
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        try:
            os.remove(os.path.join(out, f))
        except OSError:
            pass
    t_start = time.time()
    cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--app', 'build-downloads', '--test', os.path.join(HERE, 'deer_run.js'),
           '--name', 'bench-deer', '--timeout', str(timeout + 60), '--env', 'BENCH_URL=' + url, '--env', 'BENCH_SIZE=%d' % size,
           '--env', 'BENCH_TIMEOUT=%d' % timeout, '--pref', 'vitre.downloadsFolder=' + out]
    r = subprocess.run(cmd, cwd=GECKO, capture_output=True, text=True, encoding='utf-8', errors='replace')
    done = None
    for line in r.stdout.splitlines():
        if line.startswith('BENCH_DONE '):
            done = json.loads(line[len('BENCH_DONE '):])
    path = done.get('path') if done else None
    t_done = done['done_at'] / 1000 if done and done.get('state') == 'completed' else None
    return path, t_start, t_done, done, r.stdout[-3000:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('app', choices=['idm', 'deer'])
    ap.add_argument('scenario')
    ap.add_argument('knobs')
    ap.add_argument('--timeout', type=int, default=300)
    a = ap.parse_args()
    q = dict(kv.split('=', 1) for kv in a.knobs.split('&') if kv)
    size = int(float(q.get('size', '256')) * MiB)
    name = 'deer-bench-%s-%s.bin' % (a.scenario, a.app)
    url = '%s/f/%s-%s/%s?%s' % (BASE, a.scenario, a.app, name, a.knobs)
    get('/reset')
    extra = {}
    if a.app == 'idm':
        path, t_start, t_done, snaps = run_idm(a.scenario, url, name, size, a.timeout)
        extra = {'idm_temp': [s for s in snaps if s[1]][:12]}
    else:
        path, t_start, t_done, done, tail = run_deer(a.scenario, url, name, size, a.timeout)
        extra = {'deer': done, 'tail': None if done else tail}
    time.sleep(1)
    log = get('/log')
    timeline = get('/timeline')
    m = metrics(log, timeline, size, t_start, t_done)
    last_byte = max((e.get('te', 0) for e in log if e.get('sent', 0) > 0), default=0)
    m['after_last_byte_s'] = round(t_done - last_byte, 2) if t_done and last_byte else None
    ok = None
    if path and os.path.exists(path) and t_done:
        ok = file_sha(path) == expected_sha(size)
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass
    print(json.dumps({'scenario': a.scenario, 'app': a.app, 'knobs': a.knobs, 'completed': bool(t_done), 'sha_ok': ok, **m, **extra}))


if __name__ == '__main__':
    main()
