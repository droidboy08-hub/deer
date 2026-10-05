"""Scan runtime/xul.dll (read-only) for pref-name strings matching given regexes.
  python prefscan.py "backdrop|svg.filter|mica"
"""
import re
import sys
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
data = open(os.path.join(ROOT, 'runtime', 'xul.dll'), 'rb').read()
pat = re.compile(sys.argv[1].encode(), re.I)
seen = set()
for m in re.finditer(rb'[A-Za-z][A-Za-z0-9_.\-]{5,120}', data):
    s = m.group(0)
    if b'.' in s and pat.search(s) and s not in seen:
        seen.add(s)
for s in sorted(seen):
    print(s.decode())
