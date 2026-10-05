"""Build variants/override-browser/: the app plus a manifest "override" of browser.xhtml itself.

The replacement document is Firefox 157's own browser.xhtml (from gecko/reference/omni) with two
lines added to <head>. Used to compare "override browser.xhtml" against "hook from AutoConfig".

  python spikes/packaging/make-override-variant.py
  python spikes/packaging/run-dist.py --name packaging-ovr --boot spikes/packaging/boot-override.js \
      --env "VITRE_APP=<...>\\spikes\\packaging\\variants\\override-browser" --url https://example.com
"""
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'reference', 'omni', 'browser', 'chrome', 'browser', 'content', 'browser', 'browser.xhtml')
OUT = os.path.join(HERE, 'variants', 'override-browser')

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(os.path.join(HERE, 'app'), OUT)
with open(SRC, encoding='utf-8') as f:
    doc = f.read()
marker = '<head>'
assert doc.count(marker) == 1
doc = doc.replace(marker, marker + '''
  <!-- Vitre: added by the override variant -->
  <link rel="stylesheet" href="chrome://vitre/skin/vitre.css" />
  <script src="chrome://vitre/content/chrome/override-marker.js"></script>
''')
with open(os.path.join(OUT, 'chrome', 'browser.xhtml'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(doc)
with open(os.path.join(OUT, 'chrome', 'override-marker.js'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('''// Parsed as part of the overridden browser.xhtml, before any Firefox script in <head> runs.
window.__vitreOverride = { at: "head", readyState: document.readyState, time: Math.round(performance.now()) };
window.addEventListener("load", () => {
  const badge = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  badge.id = "vitre-probe";
  badge.style.bottom = "70px";
  badge.textContent = "browser.xhtml is Vitre's copy (manifest override)";
  document.body.append(badge);
}, { once: true });
''')
with open(os.path.join(OUT, 'chrome.manifest'), 'a', encoding='utf-8', newline='\n') as f:
    f.write('override chrome://browser/content/browser.xhtml chrome://vitre/content/chrome/browser.xhtml\n')
print('built', OUT)
