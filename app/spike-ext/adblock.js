// Spike: can ad blockers work? Tests the two ways blockers block requests on Electron 44:
// declarativeNetRequest (MV3, what uBlock Origin Lite uses) and webRequestBlocking (MV2, what
// the original uBlock Origin uses).
const { app, BrowserWindow, session, webContents } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'vitre-adblock-spike-')));
const out = (f) => path.join(__dirname, f);
const log = (...a) => console.log('[adblock]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  log('electron', process.versions.electron, 'chromium', process.versions.chrome);
  const ses = session.fromPartition('persist:adblock');
  const ext = new ElectronChromeExtensions({ license: 'GPL-3.0', session: ses });
  if (process.env.VITRE_HOOK) ses.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, () => {});
  for (const dir of ['dnr', 'mv2']) {
    try {
      const e = await ses.extensions.loadExtension(out(dir));
      log('loaded', dir, e.id, 'mv' + e.manifest.manifest_version);
    } catch (err) {
      log('LOAD FAILED', dir, '-', err.message);
    }
  }

  const win = new BrowserWindow({
    width: 1000, height: 700, show: true,
    webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true, preload: out('host-preload.js') },
  });
  win.webContents.on('did-attach-webview', (_e, guest) => { ext.addTab(guest, win); ext.selectTab(guest); });
  await win.loadFile(out('adblock.html'));
  const guest = await new Promise((r) => {
    const t = setInterval(() => {
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      if (g) { clearInterval(t); r(g); }
    }, 100);
  });
  await wait(3000);

  const visit = async (url) => {
    let fail = null;
    const onFail = (_e, code, desc, u, isMain) => { if (isMain) fail = `${code} ${desc}`; };
    guest.on('did-fail-load', onFail);
    try { await guest.loadURL(url); } catch (e) { fail = fail || e.code || e.message; }
    await wait(500);
    guest.off('did-fail-load', onFail);
    return fail ? 'BLOCKED (' + fail + ')' : 'loaded: ' + JSON.stringify(await guest.executeJavaScript('document.title'));
  };
  log('control  https://example.com ->', await visit('https://example.com'));
  log('DNR rule https://example.net ->', await visit('https://example.net'));
  log('MV2 rule https://example.org ->', await visit('https://example.org'));
  const state = await win.webContents.executeJavaScript('window.crx.getState("persist:adblock").then(s => JSON.stringify(s.actions.map(a => a.title)))');
  log('extension self-reports:', state);
  app.quit();
});
