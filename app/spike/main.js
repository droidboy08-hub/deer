// Spike: does CSS backdrop-filter (SVG displacement lens) refract <webview> content in Electron?
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440, height: 900, frame: false, show: true,
    webPreferences: { webviewTag: true, contextIsolation: true },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
  setTimeout(async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, 'capture.png'), img.toPNG());
    console.log('captured', img.getSize());
    app.quit();
  }, 4000);
});
