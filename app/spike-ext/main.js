// Spike: do Chrome extensions (electron-chrome-extensions + electron-chrome-web-store) work with
// <webview> tabs in a persist: partition on Electron 44?
const { app, BrowserWindow, session, nativeImage, webContents } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ElectronChromeExtensions } = require('electron-chrome-extensions');
const { installChromeWebStore } = require('electron-chrome-web-store');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'vitre-ext-spike-')));
const out = (f) => path.join(__dirname, f);
const log = (...a) => console.log('[spike]', ...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A 32px icon for the test extension.
const px = Buffer.alloc(32 * 32 * 4);
for (let i = 0; i < 32 * 32; i++) px.set([0xd0, 0x70, 0x20, 0xff], i * 4);
fs.writeFileSync(out('testext/icon.png'), nativeImage.createFromBitmap(px, { width: 32, height: 32 }).toPNG());

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:spike');
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|vitre-ext-spike|electron)\/\S+/gi, ''));
  let win;
  const ext = new ElectronChromeExtensions({
    license: 'GPL-3.0',
    session: ses,
    createTab: async (d) => { log('createTab', d.url); throw new Error('no'); },
    selectTab: (wc) => log('selectTab', wc.id),
  });
  ext.on('browser-action-popup-created', (p) => log('popup created', p.extensionId));
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
  await installChromeWebStore({ session: ses, allowUnpackedExtensions: true });
  const loaded = await ses.extensions.loadExtension(out('testext'));
  log('loaded', loaded.id, loaded.name);

  win = new BrowserWindow({
    width: 1200, height: 800, show: true,
    webPreferences: { webviewTag: true, contextIsolation: true, sandbox: true, preload: out('host-preload.js') },
  });
  win.webContents.on('did-attach-webview', (_e, guest) => {
    log('attached', guest.id, guest.session === ses);
    ext.addTab(guest, win);
    ext.selectTab(guest);
  });
  win.webContents.on('console-message', (e) => log('[host]', e.message));
  await win.loadFile(out('index.html'));

  const guest = await new Promise((r) => {
    const t = setInterval(() => {
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview');
      if (g && !g.isLoading() && g.getURL().startsWith('https')) { clearInterval(t); r(g); }
    }, 200);
  });
  await wait(2500);
  log('content script:', await guest.executeJavaScript('document.documentElement.dataset.spikeCs'));
  log('background reply:', await guest.executeJavaScript('document.documentElement.dataset.spikeBg'));
  log('host state:', await win.webContents.executeJavaScript('window.crx.getState("persist:spike").then(s => JSON.stringify(s))'));
  await win.webContents.executeJavaScript(`document.getElementById('ico').src = 'crx://extension-icon/${loaded.id}/32/2?tabId=${guest.id}&t=' + Date.now()`);
  await wait(800);
  log('icon loaded:', await win.webContents.executeJavaScript(`document.getElementById('ico').naturalWidth`));
  await win.webContents.executeJavaScript(`window.crx.activate("persist:spike", { eventType: 'click', extensionId: '${loaded.id}', tabId: ${guest.id}, anchorRect: { x: 1100, y: 10, width: 30, height: 30 } })`);
  await wait(2000);
  const popup = BrowserWindow.getAllWindows().find((w) => w !== win);
  log('popup window:', !!popup, popup && popup.getBounds(), popup && popup.webContents.getURL());
  fs.writeFileSync(out('capture-host.png'), (await win.webContents.capturePage()).toPNG());
  if (popup) fs.writeFileSync(out('capture-popup.png'), (await popup.webContents.capturePage()).toPNG());

  // Chrome Web Store: does the detail page offer "Add to Chrome"?
  guest.loadURL('https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh');
  await wait(9000);
  log('webstorePrivate in page:', await guest.executeJavaScript('typeof chrome !== "undefined" && typeof chrome.webstorePrivate'));
  const btn = await guest.executeJavaScript(`[...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /chrome|install|add|remove/i.test(t)).join(' | ')`);
  log('store buttons:', btn);
  fs.writeFileSync(out('capture-store.png'), (await win.webContents.capturePage()).toPNG());
  app.quit();
});
