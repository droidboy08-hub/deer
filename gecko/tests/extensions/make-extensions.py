"""Build the local test extensions and the test site for tests/extensions (nothing is downloaded).

  python tests/extensions/make-extensions.py

Writes tests/extensions/build/:
  ext/<name>/...        unpacked extensions (installTemporaryAddon takes a folder)
  www/                  the site served by serve.py on 127.0.0.1:47651
    page.html           a page with three "ads" (blocked by blocker and dnr) and three plain images
    xpi/<name>.xpi      every extension packed as an unsigned .xpi (served as application/x-xpinstall)
    updates.json        update manifest for the update test (upd 1.0 -> 2.0 adds permissions)

Extensions (ids <name>@vitre.test):
  blocker     MV2 webRequest + webRequestBlocking, blocks /ads/ (uBlock Origin's mechanism), badge
              with the count per tab, a popup; default_area navbar (lands pinned)
  dnr         MV3 declarativeNetRequest static rules, blocks /dnr-ads/, badge "on", a popup
  popup       a browser action with a popup page; options in their own tab
  badge       a browser action without popup: each click adds 1 to its per-tab badge; inline options
  pageaction  a page action shown on 127.0.0.1 pages, with a popup, a page_action menu item and the
              _execute_page_action command (Ctrl+Shift+U)
  menus       a browser action with menu items on its button (menus API, contexts browser_action)
  command     _execute_browser_action on Ctrl+Shift+Y and a command "say-hello" on Ctrl+Shift+O
  pin1, pin2  plain browser actions (to reach 8 pinned)
  panelonly   a browser action that stays in the extensions panel (default_area menupanel)
  upd         update test: 1.0 (storage) -> 2.0 (storage, tabs, <all_urls>), update_url on the test site
Every extension reports its state through its action title: "<NAME> {json}".
"""
import hashlib
import io
import json
import os
import shutil
import struct
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build')
PORT = 47651
SITE = 'http://127.0.0.1:%d' % PORT


def icon(color, glyph):
    """A 32 px SVG icon: a rounded square in `color` with a white line glyph."""
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
            '<rect x="2" y="2" width="28" height="28" rx="8" fill="%s"/>'
            '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">%s</g></svg>') % (color, glyph)


GLYPH = {
    'shield': '<path d="M16 7.5 9.5 10v5.2c0 4.1 2.8 7.6 6.5 9.3 3.7-1.7 6.5-5.2 6.5-9.3V10z"/>',
    'filter': '<path d="M9 10h14l-5.5 6.5V22l-3 1.5v-7z"/>',
    'square': '<rect x="10" y="10" width="12" height="12" rx="2.5"/>',
    'plus': '<path d="M16 10v12M10 16h12"/>',
    'list': '<path d="M11 11h10M11 16h10M11 21h6"/>',
    'key': '<circle cx="12.5" cy="16" r="3.5"/><path d="M16 16h7.5M21 16v3"/>',
    'dot': '<circle cx="16" cy="16" r="4"/>',
    'ring': '<circle cx="16" cy="16" r="6"/>',
    'tri': '<path d="M16 9.5 23 22H9z"/>',
    'arrow': '<path d="M16 10v12M11 17l5 5 5-5"/>',
}

REPORT = '''
function report(state) {
  const api = browser.browserAction || browser.action;
  api.setTitle({ title: NAME + " " + JSON.stringify(state) });
}
'''

POPUP_HTML = '''<!doctype html><meta charset="utf-8"><title>%(name)s</title>
<style>
  html { color-scheme: light dark; }
  body { margin: 0; width: 280px; font: 13.5px "Segoe UI Variable Text", "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
  header img { width: 24px; height: 24px; }
  h1 { margin: 0; font-size: 14px; font-weight: 600; }
  p { margin: 0; padding: 0 16px 14px; line-height: 19px; opacity: 0.72; }
  .n { font-size: 26px; font-weight: 600; padding: 0 16px 4px; }
</style>
<header><img src="icon.svg" alt=""><h1>%(name)s</h1></header>
<div class="n" id="n">%(big)s</div>
<p id="t">%(text)s</p>
<script src="popup.js"></script>
'''

EXTENSIONS = {}


def ext(name, manifest, files):
    EXTENSIONS[name] = (manifest, files)


def base(name, title, color, glyph, mv=2, area='navbar', popup=True, extra=None, perms=None, version='1.0'):
    m = {
        'manifest_version': mv,
        'name': title,
        'version': version,
        'description': 'Vitre test extension (%s).' % name,
        'browser_specific_settings': {'gecko': {'id': '%s@vitre.test' % name}},
        'icons': {'32': 'icon.svg'},
    }
    action = {'default_icon': {'32': 'icon.svg'}, 'default_title': title, 'default_area': area}
    if popup:
        action['default_popup'] = 'popup.html'
    m['browser_action' if mv == 2 else 'action'] = action
    if perms:
        m['permissions'] = perms
    m['background'] = {'scripts': ['bg.js']}
    if extra:
        m.update(extra)
    files = {'icon.svg': icon(color, GLYPH[glyph])}
    if popup:
        files['popup.html'] = POPUP_HTML % {'name': title, 'big': '', 'text': 'Popup of a test extension, drawn by the extension itself.'}
        files['popup.js'] = 'document.getElementById("n").textContent = "Hello";\n'
    return m, files


# ---- blocker: MV2 webRequestBlocking ----
m, f = base('blocker', 'Test Blocker', '#c42b1c', 'shield', perms=['webRequest', 'webRequestBlocking', 'tabs', '<all_urls>'])
f['bg.js'] = 'const NAME = "BLOCKER";' + REPORT + '''
const state = { blocked: 0, urls: [] };
const perTab = new Map();
browser.browserAction.setBadgeBackgroundColor({ color: "#c42b1c" });
browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
browser.webRequest.onBeforeRequest.addListener((d) => {
  if (!d.url.includes("/ads/")) return {};
  state.blocked++;
  state.urls.push(d.url);
  if (d.tabId >= 0) {
    const n = (perTab.get(d.tabId) || 0) + 1;
    perTab.set(d.tabId, n);
    browser.browserAction.setBadgeText({ tabId: d.tabId, text: String(n) });
  }
  report(state);
  return { cancel: true };
}, { urls: ["<all_urls>"] }, ["blocking"]);
browser.tabs.onUpdated.addListener((id, change) => { if (change.status === "loading" && change.url) perTab.delete(id); });
browser.runtime.onMessage.addListener((msg) => msg === "state" ? Promise.resolve(state) : undefined);
report(state);
'''
f['popup.html'] = POPUP_HTML % {'name': 'Test Blocker', 'big': '0', 'text': 'requests blocked on this page by a webRequestBlocking listener.'}
f['popup.js'] = 'browser.runtime.sendMessage("state").then((s) => { document.getElementById("n").textContent = String(s.blocked); });\n'
ext('blocker', m, f)

# ---- dnr: MV3 declarativeNetRequest ----
m, f = base('dnr', 'Test DNR', '#186ec8', 'filter', mv=3, perms=['declarativeNetRequest'], extra={
    'host_permissions': ['<all_urls>'],
    'declarative_net_request': {'rule_resources': [{'id': 'rules', 'enabled': True, 'path': 'rules.json'}]},
})
f['rules.json'] = json.dumps([{'id': 1, 'priority': 1, 'action': {'type': 'block'},
                               'condition': {'urlFilter': '/dnr-ads/', 'resourceTypes': ['image', 'xmlhttprequest', 'sub_frame', 'script']}}], indent=1)
f['bg.js'] = 'const NAME = "DNR";' + REPORT + '''
browser.action.setBadgeBackgroundColor({ color: "#186ec8" });
browser.action.setBadgeTextColor({ color: "#ffffff" });
browser.action.setBadgeText({ text: "on" });
browser.declarativeNetRequest.getEnabledRulesets().then((r) => report({ rulesets: r }));
'''
ext('dnr', m, f)

OPTIONS_HTML = ('<!doctype html><meta charset="utf-8"><title>%s options</title><body style="font:14px Segoe UI;padding:24px">'
                '<h1 style="font-size:18px">%s options</h1><p>An options page of a test extension.</p>')

# ---- popup (options in their own tab) ----
m, f = base('popup', 'Test Popup', '#0f7b6c', 'square', extra={'options_ui': {'page': 'options.html', 'open_in_tab': True}})
f['options.html'] = OPTIONS_HTML % ('Test Popup', 'Test Popup')
f['bg.js'] = 'const NAME = "POPUP";' + REPORT + 'report({ up: true });\n'
ext('popup', m, f)

# ---- badge: no popup, click counts (inline options, shown by about:addons) ----
m, f = base('badge', 'Test Badge', '#8e44ad', 'plus', popup=False, perms=['tabs'], extra={'options_ui': {'page': 'options.html'}})
f['options.html'] = OPTIONS_HTML % ('Test Badge', 'Test Badge')
f['bg.js'] = 'const NAME = "BADGE";' + REPORT + '''
const counts = new Map();
browser.browserAction.setBadgeBackgroundColor({ color: "#3b3b3f" });
browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
browser.browserAction.setBadgeText({ text: "3" });
browser.browserAction.onClicked.addListener((tab) => {
  const n = (counts.get(tab.id) || 3) + 1;
  counts.set(tab.id, n);
  browser.browserAction.setBadgeText({ tabId: tab.id, text: String(n) });
  report({ clicks: n });
});
report({ clicks: 3 });
'''
ext('badge', m, f)

# ---- pageaction ----
pa = {
    'manifest_version': 2,
    'name': 'Test Page Action',
    'version': '1.0',
    'description': 'Vitre test extension (pageaction).',
    'browser_specific_settings': {'gecko': {'id': 'pageaction@vitre.test'}},
    'icons': {'32': 'icon.svg'},
    'permissions': ['menus', 'tabs'],
    'background': {'scripts': ['bg.js']},
    'page_action': {'default_icon': {'32': 'icon.svg'}, 'default_title': 'Test Page Action', 'default_popup': 'popup.html',
                    'show_matches': ['http://127.0.0.1/*']},
    'commands': {'_execute_page_action': {'suggested_key': {'default': 'Ctrl+Shift+U'}}},
}
paf = {
    'icon.svg': icon('#c27c0e', GLYPH['tri']),
    'popup.html': POPUP_HTML % {'name': 'Test Page Action', 'big': '', 'text': 'A page action popup, opened from Vitre\'s button in the pill.'},
    'popup.js': '',
    'bg.js': '''
const state = { menu: [] };
browser.menus.create({ id: "pa-item", title: "Page action: mark this page", contexts: ["page_action"] });
browser.menus.onClicked.addListener((info, tab) => {
  state.menu.push(info.menuItemId);
  browser.pageAction.setTitle({ tabId: tab.id, title: "PAGEACTION " + JSON.stringify(state) });
});
''',
}
ext('pageaction', pa, paf)

# ---- menus: items on the button ----
m, f = base('menus', 'Test Menus', '#5c6bc0', 'list', popup=False, perms=['menus'])
f['bg.js'] = 'const NAME = "MENUS";' + REPORT + '''
const state = { clicked: [], strict: false };
browser.menus.create({ id: "log", title: "Open the && log", contexts: ["browser_action"] });
browser.menus.create({ id: "strict", title: "Strict mode", type: "checkbox", checked: false, contexts: ["browser_action"] });
browser.menus.create({ id: "sep", type: "separator", contexts: ["browser_action"] });
browser.menus.create({ id: "more", title: "More", contexts: ["browser_action"] });
browser.menus.create({ id: "child", parentId: "more", title: "Child item", contexts: ["browser_action"] });
browser.menus.onClicked.addListener((info) => {
  state.clicked.push(info.menuItemId);
  if (info.menuItemId === "strict") state.strict = info.checked;
  report(state);
});
report(state);
'''
ext('menus', m, f)

# ---- command: keyboard shortcuts ----
m, f = base('command', 'Test Command', '#2e7d32', 'key', perms=[], extra={
    'commands': {
        '_execute_browser_action': {'suggested_key': {'default': 'Ctrl+Shift+Y'}},
        'say-hello': {'suggested_key': {'default': 'Ctrl+Shift+O'}, 'description': 'Say hello'},
    },
})
f['bg.js'] = 'const NAME = "COMMAND";' + REPORT + '''
const state = { commands: [] };
browser.commands.onCommand.addListener((c) => {
  state.commands.push(c);
  browser.browserAction.setBadgeText({ text: "ok" });
  report(state);
});
report(state);
'''
ext('command', m, f)

# ---- plain pinned ones and one that stays in the panel ----
for name, title, color, glyph in (('pin1', 'Test Pin One', '#6d4c41', 'dot'), ('pin2', 'Test Pin Two', '#455a64', 'ring')):
    m, f = base(name, title, color, glyph)
    f['bg.js'] = 'const NAME = "%s";' % name.upper() + REPORT + 'report({ up: true });\n'
    ext(name, m, f)
m, f = base('panelonly', 'Test Panel Only', '#00838f', 'arrow', area='menupanel')
f['bg.js'] = 'const NAME = "PANELONLY";' + REPORT + 'report({ up: true });\n'
ext('panelonly', m, f)


def zip_bytes(files):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(files):
            z.writestr(name, files[name])
    return buf.getvalue()


def png(w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PAGE = '''<!doctype html><meta charset="utf-8"><title>Field Notes</title>
<style>
  body { margin: 0; font: 16px/1.6 Georgia, "Times New Roman", serif; color: #1d1d1f; background: #f6f3ec; }
  main { max-width: 760px; margin: 0 auto; padding: 96px 32px 64px; }
  h1 { font: 600 40px/1.15 "Segoe UI Variable Display", "Segoe UI", sans-serif; margin: 0 0 12px; }
  .lede { font-size: 19px; color: #5a5650; margin: 0 0 28px; }
  .row { display: flex; gap: 12px; margin: 24px 0; }
  .row img { width: 160px; height: 90px; border-radius: 8px; background: #e2ddd2; }
  #result { font: 13px ui-monospace, Consolas, monospace; color: #5a5650; }
</style>
<main>
  <h1>Notes on float glass</h1>
  <p class="lede">How molten glass poured onto a bath of tin flattens itself, and why the panes in old windows are not thicker at the bottom.</p>
  <p>Float glass is made by pouring a continuous ribbon of molten glass onto a bath of liquid tin. The glass spreads
  until gravity and surface tension balance, which leaves both faces flat and parallel without grinding.</p>
  <div class="row"><img id="a1" src="/ads/a1.png" alt=""><img id="a2" src="/dnr-ads/a2.png" alt=""><img id="a3" src="/ads/a3.png" alt=""></div>
  <div class="row"><img id="o1" src="/ok/o1.png" alt=""><img id="o2" src="/ok/o2.png" alt=""><img id="o3" src="/ok/o3.png" alt=""></div>
  <p id="result">loading</p>
</main>
<script>
  addEventListener("load", () => {
    const r = [...document.images].map((i) => i.id + "=" + (i.naturalWidth ? "loaded" : "blocked")).join(" ");
    document.getElementById("result").textContent = r;
    document.title = "Field Notes | " + r;
  });
</script>
'''


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    www = os.path.join(OUT, 'www')
    for d in ('ads', 'dnr-ads', 'ok', 'xpi'):
        os.makedirs(os.path.join(www, d))
    for name, (manifest, files) in EXTENSIONS.items():
        files = dict(files, **{'manifest.json': json.dumps(manifest, indent=1)})
        folder = os.path.join(OUT, 'ext', name)
        os.makedirs(folder)
        for fname, text in files.items():
            with open(os.path.join(folder, fname), 'w', encoding='utf-8', newline='\n') as fh:
                fh.write(text)
        with open(os.path.join(www, 'xpi', name + '.xpi'), 'wb') as fh:
            fh.write(zip_bytes(files))

    # update chain: 1.0 -> 2.0 asks for tabs and <all_urls>
    hashes = {}
    for version, perms in (('1.0', ['storage']), ('2.0', ['storage', 'tabs', '<all_urls>'])):
        m, f = base('upd', 'Test Update', '#ad1457', 'arrow', perms=perms, version=version,
                    extra={'browser_specific_settings': {'gecko': {'id': 'upd@vitre.test', 'update_url': SITE + '/updates.json'}}})
        f['bg.js'] = 'const NAME = "UPD";' + REPORT + 'report({ version: "%s" });\n' % version
        data = zip_bytes(dict(f, **{'manifest.json': json.dumps(m, indent=1)}))
        with open(os.path.join(www, 'xpi', 'upd-%s.xpi' % version), 'wb') as fh:
            fh.write(data)
        hashes[version] = 'sha256:' + hashlib.sha256(data).hexdigest()
    with open(os.path.join(www, 'updates.json'), 'w') as fh:
        json.dump({'addons': {'upd@vitre.test': {'updates': [
            {'version': '2.0', 'update_link': SITE + '/xpi/upd-2.0.xpi', 'update_hash': hashes['2.0']}]}}}, fh, indent=1)

    with open(os.path.join(www, 'page.html'), 'w', encoding='utf-8') as fh:
        fh.write(PAGE)
    with open(os.path.join(www, 'install.html'), 'w', encoding='utf-8') as fh:
        fh.write('<!doctype html><meta charset="utf-8"><title>Install</title><body style="font:16px Segoe UI;padding:96px 40px">'
                 '<h1>Test add-on</h1><p><a id="get" href="/xpi/popup.xpi">Install Test Popup</a></p>')
    colors = {'ads': (196, 43, 28), 'dnr-ads': (24, 110, 200), 'ok': (120, 160, 110)}
    for d, rgb in colors.items():
        for n in (1, 2, 3):
            for prefix in ('a', 'o'):
                with open(os.path.join(www, d, '%s%d.png' % (prefix, n)), 'wb') as fh:
                    fh.write(png(32, 18, rgb))
    print('built %d extensions and the test site in %s' % (len(EXTENSIONS), OUT))


if __name__ == '__main__':
    main()
