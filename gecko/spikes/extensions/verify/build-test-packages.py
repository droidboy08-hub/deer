"""Verifier: build local test packages into verify/www (nothing is downloaded).
  chrome-mv2.crx / chrome-sw.crx / chrome-dual.crx : ZIPs behind a CRX3-style header, from verify/ext/chrome-*
  persist-1.0.xpi : verify/ext/persist as an unsigned XPI
"""
import os, struct, zipfile, io
here = os.path.dirname(os.path.abspath(__file__))

def zip_dir(src):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(src)):
            z.write(os.path.join(src, name), name)
    return buf.getvalue()

for name in ('chrome-mv2', 'chrome-sw', 'chrome-dual'):
    data = zip_dir(os.path.join(here, 'ext', name))
    out = os.path.join(here, 'www', name + '.crx')
    with open(out, 'wb') as f:
        f.write(b'Cr24' + struct.pack('<II', 3, 16) + bytes(16) + data)
    print('wrote', out, len(data) + 28)
out = os.path.join(here, 'www', 'persist-1.0.xpi')
with open(out, 'wb') as f:
    f.write(zip_dir(os.path.join(here, 'ext', 'persist')))
print('wrote', out)

# ---- update chain for v-update.js: upd-1.0.xpi -> 2.0 (same permissions) -> 3.0 (adds permissions)
import hashlib, json
def upd(version, perms, next_manifest):
    manifest = {
        "manifest_version": 2, "name": "Vitre Update Test", "version": version,
        "description": "Verifier test extension for the update flow.",
        "browser_specific_settings": {"gecko": {"id": "vitre-upd@spike.test", "update_url": "http://127.0.0.1:47631/" + next_manifest}},
        "icons": {"64": "icon.png"}, "permissions": perms, "background": {"scripts": ["bg.js"]},
        "browser_action": {"default_icon": {"64": "icon.png"}, "default_title": "Vitre Update Test", "default_area": "navbar"},
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=2))
        for name in ('bg.js', 'icon.png'):
            z.write(os.path.join(here, 'ext', 'upd', name), name)
    data = buf.getvalue()
    with open(os.path.join(here, 'www', 'upd-%s.xpi' % version), 'wb') as f:
        f.write(data)
    return 'sha256:' + hashlib.sha256(data).hexdigest()

upd('1.0', ['storage'], 'updates-a.json')
h2 = upd('2.0', ['storage'], 'updates-b.json')
h3 = upd('3.0', ['storage', 'tabs', '<all_urls>'], 'updates-c.json')
def write_updates(name, version, h):
    updates = [{"version": version, "update_link": "http://127.0.0.1:47631/upd-%s.xpi" % version, "update_hash": h}] if version else []
    with open(os.path.join(here, 'www', name), 'w') as f:
        json.dump({"addons": {"vitre-upd@spike.test": {"updates": updates}}}, f, indent=2)
write_updates('updates-a.json', '2.0', h2)
write_updates('updates-b.json', '3.0', h3)
write_updates('updates-c.json', None, None)
print('wrote update chain upd-1.0/2.0/3.0 + updates-a/b/c.json')
