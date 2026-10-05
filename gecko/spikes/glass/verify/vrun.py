"""Run one boot script under several variants in parallel (verify copy of ../tools/variants.py).

  python spikes/glass/verify/vrun.py <boot.js> <timeout> name1:pref=val,ENV:K=V,URL:... name2: ...

Each variant: tools/run.py --name glass-verify-<stem>-<name> --out spikes/glass/verify/out/<stem>-<name>, VITRE_TAG=<name>.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))

boot = sys.argv[1]
timeout = sys.argv[2]
stem = os.path.splitext(os.path.basename(boot))[0]
procs = []
for spec in sys.argv[3:]:
    name, _, prefs = spec.partition(':')
    out = os.path.join(HERE, 'out', stem + '-' + name)
    cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', boot, '--name', 'glass-verify-' + stem + '-' + name, '--out', out, '--timeout', timeout]
    env = dict(os.environ, VITRE_TAG=name)
    for p in filter(None, prefs.split(',')):
        if p.startswith('ENV:'):
            k, v = p[4:].split('=', 1)
            env[k] = v
        elif p.startswith('ARG:'):
            cmd += ['--arg', p[4:]]
        elif p.startswith('URL:'):
            cmd += ['--url', p[4:]]
        else:
            cmd += ['--pref', p]
    procs.append((name, out, subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')))
for name, out, p in procs:
    text = p.communicate()[0]
    print('=== %s -> %s' % (name, out))
    print(text[-int(os.environ.get('VRUN_TAIL', '2500')):])
