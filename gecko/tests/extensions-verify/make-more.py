"""Extra test extensions for the extensions verifier (nothing is downloaded). Writes
tests/extensions-verify/build/ext/<name>/ (unpacked; loaded with installTemporaryAddon).

  python tests/extensions-verify/make-more.py

  longname    a browser action whose name and title are very long, with an & in them
  slowpopup   a browser action whose popup page never finishes loading (a hung popup)
  themed      a browser action with theme_icons (dark and light variants)
  storm       a browser action that, once clicked, updates its badge every 40 ms for 3 s
  optperm     a popup that asks for an optional permission (permissions.request)
Ids are <name>@vitre.verify.
"""
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build', 'ext')


def icon(color, inner):
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
            '<rect x="2" y="2" width="28" height="28" rx="8" fill="%s"/>%s</svg>') % (color, inner)


def write(name, manifest, files):
    d = os.path.join(OUT, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    manifest.setdefault('manifest_version', 2)
    manifest.setdefault('version', '1.0')
    manifest.setdefault('browser_specific_settings', {'gecko': {'id': name + '@vitre.verify'}})
    with open(os.path.join(d, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)
    for rel, text in files.items():
        with open(os.path.join(d, rel), 'w', encoding='utf-8') as f:
            f.write(text)


def main():
    long_name = 'Very Long Extension Name & Friends That Keeps Going Well Past Any Reasonable Width'
    write('longname', {
        'name': long_name,
        'browser_action': {'default_title': long_name, 'default_icon': 'icon.svg', 'default_area': 'navbar'},
        'background': {'scripts': ['bg.js']},
    }, {
        'icon.svg': icon('#6b4fbb', '<path d="M10 11h12M10 16h12M10 21h8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'),
        'bg.js': 'browser.browserAction.setBadgeText({ text: "9999" }); browser.browserAction.setBadgeBackgroundColor({ color: "#e5e5e5" }); browser.browserAction.setBadgeTextColor({ color: "#111" });\n',
    })
    # The popup page loads a script from the test site that never answers (a hung popup).
    write('slowpopup', {
        'name': 'Slow Popup',
        'browser_action': {'default_title': 'Slow Popup', 'default_icon': 'icon.svg', 'default_popup': 'popup.html', 'default_area': 'navbar'},
    }, {
        'icon.svg': icon('#8a5a00', '<circle cx="16" cy="16" r="6" fill="none" stroke="#fff" stroke-width="2.6"/>'),
        'popup.html': '<!doctype html><meta charset="utf-8"><title>Slow</title><body style="width:220px;font:13px Segoe UI">Slow popup'
                      '<script src="slow.js"></script></body>',
        'slow.js': 'const end = Date.now() + 4000; while (Date.now() < end) {} document.body.append(" done");\n',
    })
    # Badge and title updates as fast as an ad blocker on a busy page (every 40 ms while "storming").
    write('storm', {
        'name': 'Badge Storm',
        'browser_action': {'default_title': 'Badge Storm', 'default_icon': 'icon.svg', 'default_area': 'navbar'},
        'background': {'scripts': ['bg.js']},
    }, {
        'icon.svg': icon('#b4232a', '<path d="M11 21 21 11M11 11h10v10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'),
        'bg.js': ('let n = 0, timer = 0;\n'
                  'browser.runtime.onMessage.addListener(() => {});\n'
                  'browser.browserAction.onClicked.addListener(() => {\n'
                  '  clearInterval(timer);\n'
                  '  const end = Date.now() + 3000;\n'
                  '  timer = setInterval(() => {\n'
                  '    n++;\n'
                  '    browser.browserAction.setBadgeText({ text: String(n) });\n'
                  '    if (n % 5 === 0) browser.browserAction.setTitle({ title: "Badge Storm " + n });\n'
                  '    if (Date.now() > end) clearInterval(timer);\n'
                  '  }, 40);\n'
                  '});\n'),
    })
    # A popup whose whole page is a button asking for an optional permission (permissions.request
    # needs a user gesture inside the popup).
    write('optperm', {
        'name': 'Optional Permission',
        'browser_action': {'default_title': 'Optional Permission', 'default_icon': 'icon.svg', 'default_popup': 'popup.html', 'default_area': 'navbar'},
        'optional_permissions': ['history'],
    }, {
        'icon.svg': icon('#2f6f4f', '<path d="M16 9v14M9 16h14" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'),
        'popup.html': ('<!doctype html><meta charset="utf-8"><title>Ask</title>'
                       '<body style="margin:0;width:240px;height:120px;font:13px Segoe UI">'
                       '<button id="ask" style="width:240px;height:120px">Ask for history</button>'
                       '<script src="popup.js"></script></body>'),
        'popup.js': ('document.getElementById("ask").addEventListener("click", async () => {\n'
                     '  const ok = await browser.permissions.request({ permissions: ["history"] });\n'
                     '  document.title = "answer " + ok;\n'
                     '});\n'),
    })
    write('themed', {
        'name': 'Themed Icons',
        'browser_action': {
            'default_title': 'Themed Icons', 'default_icon': 'dark.svg', 'default_area': 'navbar',
            'theme_icons': [{'light': 'light.svg', 'dark': 'dark.svg', 'size': 16}, {'light': 'light.svg', 'dark': 'dark.svg', 'size': 32}],
        },
    }, {
        # Firefox's naming: "light" is the icon for dark themes (a light icon), "dark" for light themes.
        'light.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#ffffff"/></svg>',
        'dark.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="#111111"/></svg>',
    })
    print('wrote', OUT)


if __name__ == '__main__':
    main()
