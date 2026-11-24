"""Helper for the mac-glass behaviour spikes (S3, S4, S5, S7, S8, S9), run beside tools/run.py:

  /usr/bin/python3 -u spikes/mac-glass/behave_mon.py tests/menus/out --tool <wininfo> [--vids DIR] [--timeout 900]

<wininfo> is spikes/mac-glass/wininfo.swift built outside the repo (xcrun swiftc -O ... -o <wininfo>).
It follows <out>/log.txt (run.py empties it when a run starts) and answers lines the test writes
(behavelib.js GB.ask), each with a unique tag. The result goes to <out>/beh-<tag>.json, then the
flag <out>/beh-done-<tag> is written (the test waits for it):

  WINLIST <tag>                        wininfo list for the run's processes (+ the helper's)
  AXINFO <tag>                         wininfo ax for the run's main process
  AXFOCUS <tag>                        wininfo axfocus: the focused element as VoiceOver sees it
  CPU <tag> <secs>                     CPU of the run's processes and of WindowServer over <secs>
                                       (cumulative CPU time from ps, so exact averages), and the
                                       GPU's "Device Utilization %" (ioreg) sampled every 0.25 s
  REC <tag> <x> <y> <w> <h> <secs>     60 fps video of that screen rect (points) with ffmpeg; the
                                       flag comes 1.5 s after ffmpeg started, the video later
  HELPER <tag> <x> <y> <w> <h> <secs> [activate]   wininfo helper (another app's window)
  KEYS <tag> <seq...>                  wininfo keys: real key events posted to the run's main process
  SHOT <tag> <x> <y> <w> <h>           a screen-rect picture with the run's windows and the helper's
                                       (deer-wintool capture-rect --pid ...) to <out>/<tag>.png
  TRACK <tag> <secs>                   wininfo track: the window server's frames of the run's windows
                                       every ~4 ms; the flag beh-go-<tag> comes after the first sample

The run's processes: the pid from the "@@pid" line and its descendants. Python 3.9, standard library.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.dirname(os.path.dirname(HERE))
WINTOOL = os.path.join(GECKO, 'tools', 'mac', 'bin', 'deer-wintool')
FFMPEG = '/opt/homebrew/bin/ffmpeg'
SCALE = 2


def ps_rows():
    out = subprocess.run(['ps', '-axww', '-o', 'pid=,ppid=,time=,rss=,comm='], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        p = line.split(None, 4)
        if len(p) == 5 and p[0].isdigit():
            rows.append((int(p[0]), int(p[1]), p[2], int(p[3]), p[4]))
    return rows


def cpu_seconds(t):
    """ps time: [dd-]hh:mm:ss.cc or mm:ss.cc."""
    days = 0
    if '-' in t:
        d, t = t.split('-', 1)
        days = int(d)
    parts = [float(x) for x in t.split(':')]
    s = 0.0
    for x in parts:
        s = s * 60 + x
    return days * 86400 + s


class Mon:
    def __init__(self, out, tool, vids):
        self.out = out
        self.tool = tool
        self.vids = vids
        self.log = os.path.join(out, 'log.txt')
        self.main_pid = None
        self.helper_pid = None
        self.offset = 0
        self.lock = threading.Lock()

    def say(self, *a):
        with self.lock:
            print('[mon %s]' % time.strftime('%H:%M:%S'), *a, flush=True)

    def pids(self):
        if not self.main_pid:
            return []
        rows = ps_rows()
        known = {self.main_pid}
        grew = True
        while grew:
            grew = False
            for pid, ppid, _t, _r, _c in rows:
                if ppid in known and pid not in known:
                    known.add(pid)
                    grew = True
        alive = {r[0] for r in rows}
        return sorted(p for p in known if p in alive)

    def done(self, tag, result):
        path = os.path.join(self.out, 'beh-%s.json' % tag)
        with open(path, 'w') as f:
            json.dump(result, f)
        open(os.path.join(self.out, 'beh-done-%s' % tag), 'w').close()
        txt = json.dumps(result)
        self.say('%s -> %s' % (tag, txt if len(txt) < 3000 else txt[:3000] + '...'))

    def tool_json(self, args, timeout=30):
        r = subprocess.run([self.tool] + [str(a) for a in args], capture_output=True, text=True, timeout=timeout)
        if r.returncode:
            return {'error': r.stderr.strip() or 'exit %d' % r.returncode}
        try:
            return json.loads(r.stdout.strip().splitlines()[-1])
        except Exception as e:  # noqa: BLE001
            return {'error': 'bad output %r (%s)' % (r.stdout[:200], e)}

    # ---- commands ----
    def winlist(self, tag):
        args = ['list']
        for p in self.pids():
            args += ['--pid', p]
        if self.helper_pid:
            args += ['--helper', self.helper_pid]
        self.done(tag, self.tool_json(args))

    def axinfo(self, tag):
        self.done(tag, self.tool_json(['ax', '--pid', self.main_pid]) if self.main_pid else {'error': 'no pid'})

    def axfocus(self, tag):
        self.done(tag, self.tool_json(['axfocus', '--pid', self.main_pid]) if self.main_pid else {'error': 'no pid'})

    def cpu(self, tag, secs):
        secs = float(secs)
        ws = [r[0] for r in ps_rows() if r[4].endswith('/WindowServer') or r[4] == 'WindowServer']

        def snap():
            rows = {r[0]: r for r in ps_rows()}
            mine = self.pids()
            return {p: (cpu_seconds(rows[p][2]), rows[p][3], os.path.basename(rows[p][4])) for p in mine + ws if p in rows}

        gpu = []
        t0 = time.time()
        a = snap()
        while time.time() - t0 < secs:
            try:
                o = subprocess.run(['ioreg', '-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], capture_output=True, text=True, timeout=5).stdout
                m = re.search(r'"Device Utilization %"=(\d+)', o)
                if m:
                    gpu.append(int(m.group(1)))
            except Exception:  # noqa: BLE001
                pass
            time.sleep(0.25)
        b = snap()
        dt = time.time() - t0
        procs = []
        for p, (t1, rss, name) in b.items():
            if p in a:
                procs.append({'pid': p, 'name': name, 'cpu': round(100 * (t1 - a[p][0]) / dt, 1), 'rssMB': round(rss / 1024)})
        engine = round(sum(x['cpu'] for x in procs if x['pid'] not in ws), 1)
        wsv = round(sum(x['cpu'] for x in procs if x['pid'] in ws), 1)
        gavg = round(sum(gpu) / len(gpu), 1) if gpu else None
        self.done(tag, {'secs': round(dt, 2), 'engineCpu': engine, 'windowServerCpu': wsv, 'gpuUtilAvg': gavg,
                        'gpuUtilMax': max(gpu) if gpu else None, 'gpuSamples': len(gpu), 'procs': procs})

    def rec(self, tag, x, y, w, h, secs):
        x, y, w, h = (int(float(v)) * SCALE for v in (x, y, w, h))
        w -= w % 2
        h -= h % 2
        os.makedirs(self.vids, exist_ok=True)
        path = os.path.join(self.vids, tag + '.mkv')
        if os.path.exists(path):
            os.remove(path)
        cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-capture_cursor', '0',
               '-framerate', '60', '-pixel_format', 'uyvy422', '-i', '1:none', '-t', str(secs),
               '-vf', 'crop=%d:%d:%d:%d' % (w, h, x, y), '-c:v', 'ffv1', '-y', path]
        self.say('REC %s: %s' % (tag, ' '.join(cmd)))
        proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL)
        time.sleep(1.5)
        self.done(tag, {'video': path, 'started': True})
        proc.wait()
        self.say('REC %s finished (exit %s)' % (tag, proc.returncode))

    def helper(self, tag, x, y, w, h, secs, *rest):
        args = [self.tool, 'helper', '--x', x, '--y', y, '--w', w, '--h', h, '--secs', secs]
        if 'activate' in rest:
            args.append('--activate')
        proc = subprocess.Popen([str(a) for a in args], stdout=subprocess.PIPE, text=True)
        line = proc.stdout.readline().strip()
        try:
            res = json.loads(line)
        except Exception:  # noqa: BLE001
            res = {'error': 'helper said %r' % line}
        self.helper_pid = res.get('pid')
        self.done(tag, res)
        proc.wait()
        self.say('HELPER %s gone' % tag)

    def track(self, tag, secs):
        go = os.path.join(self.out, 'beh-go-%s' % tag)
        args = ['track', '--secs', secs, '--go', go]
        for p in self.pids():
            args += ['--pid', p]
        self.done(tag, self.tool_json(args, timeout=float(secs) + 30))

    def keys(self, tag, *seq):
        self.done(tag, self.tool_json(['keys', '--pid', self.main_pid, '--seq', ' '.join(seq)]) if self.main_pid else {'error': 'no pid'})

    def shot(self, tag, x, y, w, h):
        path = os.path.join(self.out, tag + '.png')
        args = [WINTOOL, 'capture-rect', '--x', x, '--y', y, '--w', w, '--h', h, '--out', path]
        for p in self.pids():
            args += ['--pid', str(p)]
        if self.helper_pid:
            args += ['--pid', str(self.helper_pid)]
        r = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=60)
        self.done(tag, {'png': path, 'ok': r.returncode == 0, 'err': r.stderr.strip()[:300]})

    def handle(self, line):
        parts = line.split()
        cmd, args = parts[0], parts[1:]
        fn = {'WINLIST': self.winlist, 'AXINFO': self.axinfo, 'CPU': self.cpu, 'REC': self.rec,
              'HELPER': self.helper, 'KEYS': self.keys, 'SHOT': self.shot, 'TRACK': self.track, 'AXFOCUS': self.axfocus}.get(cmd)
        if not fn:
            return
        threading.Thread(target=self.safe, args=(fn, args, line), daemon=True).start()

    def safe(self, fn, args, line):
        try:
            fn(*args)
        except Exception as e:  # noqa: BLE001
            self.say('FAILED %s: %s' % (line, e))
            if len(args) > 0:
                self.done(args[0], {'error': str(e)})

    def run(self, timeout):
        end = time.time() + timeout
        quit_seen = False
        while time.time() < end and not quit_seen:
            try:
                size = os.path.getsize(self.log)
            except OSError:
                size = 0
            if size < self.offset:
                self.offset = 0
                self.main_pid = None
                self.say('log emptied: a new run')
            if size > self.offset:
                with open(self.log, 'rb') as f:
                    f.seek(self.offset)
                    chunk = f.read()
                cut = chunk.rfind(b'\n')
                if cut >= 0:
                    self.offset += cut + 1
                    for raw in chunk[:cut].split(b'\n'):
                        line = raw.decode('utf-8', 'replace')
                        if line.startswith('@@pid '):
                            self.main_pid = int(line[6:].strip())
                            self.say('engine pid', self.main_pid)
                        elif line.startswith('@@quit'):
                            quit_seen = True
                        elif re.match(r'(WINLIST|AXINFO|AXFOCUS|CPU|REC|HELPER|KEYS|SHOT|TRACK) ', line):
                            self.handle(line)
            time.sleep(0.05)
        time.sleep(2)


def main(argv):
    out = os.path.abspath(argv[0])
    tool = argv[argv.index('--tool') + 1]
    vids = argv[argv.index('--vids') + 1] if '--vids' in argv else os.path.join(out, 'beh-videos')
    timeout = float(argv[argv.index('--timeout') + 1]) if '--timeout' in argv else 900
    m = Mon(out, tool, vids)
    # Start after run.py emptied the log: only lines written from now on count.
    try:
        m.offset = os.path.getsize(m.log)
    except OSError:
        m.offset = 0
    m.run(timeout)


if __name__ == '__main__':
    main(sys.argv[1:])
