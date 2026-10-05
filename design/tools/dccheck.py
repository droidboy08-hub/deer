"""Structural checks for .dc.html artboards.

Usage (from design/canvas/project):
    python ../../tools/dccheck.py File1.dc.html [File2.dc.html ...]

Checks tag balance, bare and self-closed tags, hole syntax, sc-if/sc-for hints,
root size against $preview and the canvas.json board size, dc-import targets,
backdrop-filter url(#id) targets (in the file or an imported part), and, with
node, that every {{hole}} resolves from renderVals() with the default props.
"""
import html.parser
import json
import os
import re
import subprocess
import sys

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'}


class P(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        for k, v in attrs:
            if v is None and k != 'data-dc-script':
                self.errors.append('bare attribute %s on <%s>' % (k, tag))
        if tag == 'sc-if' and 'hint-placeholder-val' not in d:
            self.errors.append('sc-if without hint-placeholder-val')
        if tag == 'sc-for' and 'hint-placeholder-count' not in d:
            self.errors.append('sc-for without hint-placeholder-count')
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        self.errors.append('self-closed <%s/>' % tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append('stray </%s>' % tag)
            return
        t, pos = self.stack.pop()
        if t != tag:
            self.errors.append('</%s> at %s closes <%s> from %s' % (tag, self.getpos(), t, pos))


NODE = r'''
const fs = require('fs');
const file = process.argv[1];
const src = fs.readFileSync(file, 'utf8');
const js = src.split(/data-dc-script[^>]*>/)[1].split('</script>')[0];
const propsJson = (src.match(/data-props='([^']*)'/) || [null, '{}'])[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const meta = JSON.parse(propsJson);
const props = {};
for (const k of Object.keys(meta)) if (k[0] !== '$' && meta[k] && 'default' in meta[k]) props[k] = meta[k].default;
class DCLogic { constructor() { this.props = {}; this.state = {}; } setState(s) { Object.assign(this.state, typeof s === 'function' ? s(this.state) : s); } forceUpdate() {} }
global.window = { matchMedia: () => ({ matches: false }) };
const C = new Function('DCLogic', js + '; return Component;')(DCLogic);
const c = new C(); c.props = props; if (!c.state) c.state = {};
const v = c.renderVals();
const body = (src.split('<script type="text/x-dc"')[0].split('<x-dc>')[1]) || '';
const loops = {};
for (const m of body.matchAll(/<sc-for list="\{\{\s*([^}]*?)\s*\}\}" as="([^"]+)"/g)) loops[m[2]] = m[1];
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const missing = [];
for (const m of body.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
  const h = m[1];
  if (/^(true|false|-?\d+(\.\d+)?)$/.test(h) || h === '$index') continue;
  const head = h.split('.')[0];
  if (loops[head] !== undefined) {
    const arr = get(v, loops[head]);
    if (!Array.isArray(arr)) { missing.push(h + ' (loop list ' + loops[head] + ' is not an array)'); continue; }
    if (!arr.length) continue;
    const rest = h.split('.').slice(1).join('.');
    if (rest && arr.every((it) => get(it, rest) === undefined)) missing.push(h);
    continue;
  }
  if (get(v, h) === undefined) missing.push(h);
}
console.log(JSON.stringify([...new Set(missing)]));
'''

OPTIONAL_UNDEFINED = ('ariaChecked', 'aks')


def check(path, canvas):
    src = open(path, encoding='utf-8').read()
    name = os.path.basename(path)
    probs = []
    if '<x-dc>' not in src:
        probs.append('no <x-dc>')
    body = src.split('<script type="text/x-dc"')[0]
    p = P()
    p.feed(body)
    probs += p.errors[:6]
    unclosed = [t for t in p.stack if t[0] not in ('html', 'body')]
    probs += ['unclosed <%s> from %s' % u for u in unclosed[:4]]
    holes = re.findall(r'\{\{\s*([^}]*?)\s*\}\}', body)
    probs += ['bad hole {{%s}}' % h for h in holes
              if not re.fullmatch(r"[A-Za-z_$][\w$]*(\.[\w$]+)*|true|false|-?\d+(\.\d+)?", h)]
    m = re.search(r"data-props='([^']*)'", src)
    prev = None
    if m:
        try:
            meta = json.loads(m.group(1).replace('&amp;', '&').replace('&#39;', "'"))
            prev = meta.get('$preview')
        except Exception as e:  # noqa: BLE001
            probs.append('data-props JSON error: %s' % e)
    else:
        probs.append('no data-props')
    xdc = body.split('</helmet>')[-1]
    rm = re.search(r'<div[^>]*style="width: (\d+|\{\{[^}]+\}\})px; height: (\d+|\{\{[^}]+\}\})px', xdc)
    b = canvas.get('boards', {}).get(name)
    if rm and prev and rm.group(1).isdigit() and rm.group(2).isdigit():
        if (int(rm.group(1)), int(rm.group(2))) != (prev.get('width'), prev.get('height')):
            probs.append('root %sx%s != $preview %sx%s' % (rm.group(1), rm.group(2), prev.get('width'), prev.get('height')))
    if b and prev and (b['w'], b['h']) != (prev.get('width'), prev.get('height')):
        probs.append('canvas board %sx%s != $preview %sx%s' % (b['w'], b['h'], prev.get('width'), prev.get('height')))
    if not b:
        probs.append('not in canvas.json boards')
    folder = os.path.dirname(os.path.abspath(path))
    imports = re.findall(r'<dc-import name="([^"]+)"', body)
    for imp in set(imports):
        if not os.path.exists(os.path.join(folder, imp + '.dc.html')):
            probs.append('dc-import %s missing' % imp)
    defined = set(re.findall(r'<filter id="([^"]+)"', body))
    for imp in set(imports):
        f = os.path.join(folder, imp + '.dc.html')
        if os.path.exists(f):
            defined |= set(re.findall(r'<filter id="([^"]+)"', open(f, encoding='utf-8').read()))
    for ref in set(re.findall(r'url\(#([^)]+)\)', body)):
        if ref not in defined:
            probs.append('url(#%s) not defined' % ref)
    try:
        out = subprocess.run(['node', '-e', NODE, os.path.abspath(path)], capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            probs.append('renderVals error: ' + (out.stderr.strip().splitlines() or ['?'])[-1][:200])
        else:
            miss = [h for h in json.loads(out.stdout.strip() or '[]') if not h.endswith(OPTIONAL_UNDEFINED)]
            if miss:
                probs.append('holes missing from renderVals: ' + ', '.join(miss[:8]))
    except FileNotFoundError:
        probs.append('node not found; JS not checked')
    return probs


if __name__ == '__main__':
    files = sys.argv[1:]
    folder = os.path.dirname(os.path.abspath(files[0])) if files else '.'
    canvas_path = os.path.join(folder, 'canvas.json')
    canvas = json.load(open(canvas_path, encoding='utf-8')) if os.path.exists(canvas_path) else {}
    bad = 0
    for f in files:
        pr = check(f, canvas)
        bad += bool(pr)
        print(('OK   ' if not pr else 'BAD  ') + os.path.basename(f) + ('' if not pr else '\n     ' + '\n     '.join(pr)))
    print('%d file(s) with problems' % bad)
    sys.exit(1 if bad else 0)
