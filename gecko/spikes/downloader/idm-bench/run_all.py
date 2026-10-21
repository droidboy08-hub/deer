"""Every bench scenario through IDM, then Deer, one at a time; results appended to results.jsonl.

  python run_all.py [scenario ...]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

# name: (knobs, timeout s). 256 MiB unless size says otherwise; region boundaries in MiB.
SCENARIOS = {
    'plain':     ('size=256&rate=1024', 300),                                   # connections, ramp-up, splitting
    'ttfb':      ('size=256&rate=1024&ttfb=2000', 300),                         # a tunnel host: 2 s before every answer
    'crawl':     ('size=256&rate=1024&slow=96-128&slowrate=16', 400),           # one part's first answer crawls
    'stall':     ('size=256&rate=1024&stall=96-128&stallafter=1024', 400),      # one connection goes silent
    'fail':      ('size=256&rate=1024&fail=96-128&failn=4&failcode=500', 400),  # one part refused 4 times
    'reset':     ('size=256&rate=1024&reset=96-128&resetafter=2048&resetn=3', 400),  # cut mid-body 3 times
    'limit503':  ('size=256&rate=1024&maxconn=2&limit=503', 600),               # only 2 connections allowed
    'expire':    ('size=256&rate=1024&expire=8&expirefor=20', 400),             # 403 for 20 s mid-download
    'norange':   ('size=128&rate=4096&norange=1', 300),                         # no Range support
    'fast':      ('size=1024', 300),                                            # no cap: the pipeline itself
    'big':       ('size=3072', 600),                                            # 3 GB: IDM temp files and joining
}


def server_up():
    try:
        urllib.request.urlopen('http://127.0.0.1:47995/log', timeout=2).read()
        return True
    except OSError:
        return False


def main():
    names = sys.argv[1:] or list(SCENARIOS)
    srv = None
    if not server_up():
        srv = subprocess.Popen([PY, os.path.join(HERE, 'server.py'), '--port', '47995'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(40):
            if server_up():
                break
            time.sleep(0.25)
    out = os.path.join(HERE, 'results.jsonl')
    try:
        for name in names:
            knobs, timeout = SCENARIOS[name]
            for app in ('idm', 'deer'):
                t = time.time()
                r = subprocess.run([PY, os.path.join(HERE, 'bench.py'), app, name, knobs, '--timeout', str(timeout)], capture_output=True, text=True, encoding='utf-8', errors='replace')
                line = next((l for l in r.stdout.splitlines() if l.startswith('{')), None)
                rec = json.loads(line) if line else {'scenario': name, 'app': app, 'error': (r.stdout + r.stderr)[-2000:]}
                with open(out, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(rec) + '\n')
                print('%-9s %-4s completed=%s sha=%s total=%ss first_data=%ss max_conc=%s requests=%s refused=%s (%ds)' % (
                    name, app, rec.get('completed'), rec.get('sha_ok'), rec.get('total_s'), rec.get('first_data_s'), rec.get('max_conc'),
                    rec.get('requests'), rec.get('refused'), time.time() - t), flush=True)
                time.sleep(3)
    finally:
        if srv:
            srv.terminate()


if __name__ == '__main__':
    main()
