"""Run one boot script under several pref variants in parallel, each with its own profile and out dir.

  python spikes/glass/tools/variants.py <boot.js> <timeout> name1:pref=val,pref=val name2: ...

Each variant runs tools/run.py with --name glass-<name>, --out spikes/glass/out/<bootstem>-<name>,
and VITRE_TAG=<name>. Extra env can be passed as ENV:KEY=VALUE items inside the pref list.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.dirname(HERE)
GECKO = os.path.dirname(os.path.dirname(SPIKE))

boot = sys.argv[1]
timeout = sys.argv[2]
stem = os.path.splitext(os.path.basename(boot))[0]
procs = []
for spec in sys.argv[3:]:
    name, _, prefs = spec.partition(':')
    out = os.path.join(SPIKE, 'out', stem + '-' + name)
    cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', boot, '--name', 'glass-' + name, '--out', out, '--timeout', timeout]
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
    print(text[-6000:])
