import { app, BrowserWindow, Menu, WebContents, dialog, ipcMain, nativeImage, net, protocol, session, shell, webContents } from 'electron';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { applyRebind, match } from '../shared/shortcuts';
import type { SessionData, WindowState } from '../shared/types';
import { History } from './history';
import { Store } from './store';
import { findWallpaper } from './wallpaper';
import type { MainContext } from './context';
import { registerModules } from './modules';
import { SettingsStore, settingsFile } from './settings';

const PARTITION = 'persist:vitre';
const isCapture = process.argv.includes('--capture');
const profile = process.argv.find((a) => a.startsWith('--profile='))?.slice(10);
if (isCapture || profile) app.setPath('userData', path.join(app.getPath('temp'), `vitre-${profile ?? 'capture'}`));

protocol.registerSchemesAsPrivileged([
  { scheme: 'vitre', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!isCapture && !app.requestSingleInstanceLock()) {
  app.quit();
}

app.setAppUserModelId('dev.vitre.browser');

let history: History;
let sessionStore: Store<SessionData | null>;
let wallpaperPath: string | null = null;
let settings: SettingsStore;
const guestHooks: ((wc: WebContents) => void)[] = [];
const initialUrls = new Map<number, string>();

function chromePreload(): string {
  return path.join(__dirname, '..', 'preload', 'chrome.js');
}

function pagePreload(): string {
  return path.join(__dirname, '..', 'preload', 'page.js');
}

function sendState(win: BrowserWindow): void {
  const s: WindowState = { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() };
  if (!win.isDestroyed()) win.webContents.send('win:state', s);
}

export function createWindow(url?: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 360,
    frame: false,
    show: false,
    backgroundColor: '#1b1c20',
    title: 'Vitre',
    webPreferences: {
      preload: chromePreload(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
    },
  });
  if (url) initialUrls.set(win.webContents.id, url);

  win.webContents.on('will-attach-webview', (_e, prefs, params) => {
    // Every page runs isolated, sandboxed, in Vitre's own session, with Vitre's page preload.
    delete (prefs as { preloadURL?: string }).preloadURL;
    prefs.preload = pagePreload();
    prefs.nodeIntegration = false;
    prefs.nodeIntegrationInSubFrames = false;
    prefs.contextIsolation = true;
    prefs.sandbox = true;
    prefs.webSecurity = true;
    prefs.spellcheck = true;
    params.partition = PARTITION;
    if (params.src && !/^(https?|about|data|file|view-source|vitre):/i.test(params.src)) params.src = 'about:blank';
  });

  // Nothing in the page may navigate the chrome itself.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'] as const) {
    win.on(ev as 'maximize', () => sendState(win));
  }
  win.once('ready-to-show', () => {
    if (isCapture) win.showInactive();
    else win.show();
    sendState(win);
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function hostWindow(wc: WebContents): BrowserWindow | null {
  const host = wc.hostWebContents;
  return host ? BrowserWindow.fromWebContents(host) : BrowserWindow.fromWebContents(wc);
}

function setupGuest(wc: WebContents): void {
  for (const hook of guestHooks) {
    try {
      hook(wc);
    } catch (err) {
      console.error('guest hook failed', err);
    }
  }
  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    const host = wc.hostWebContents;
    // Real pop-ups (sign-in, payment, calls) stay real windows.
    if (disposition === 'new-window' && features) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true } } };
    }
    if (host && /^(https?|about|data|file|view-source):/i.test(url)) host.send('open-url', { url, disposition, openerId: wc.id });
    return { action: 'deny' };
  });

  wc.on('before-input-event', (e, input) => {
    const host = wc.hostWebContents;
    if (!host) return;
    if (input.type === 'keyUp' && input.key === 'Control') {
      host.send('ctrl-up');
      return;
    }
    // A feature module (an open menu borrowing the page's keys) already took this key.
    if (e.defaultPrevented) return;
    if (input.type !== 'keyDown') return;
    const b = match({
      key: input.key,
      code: input.code,
      ctrl: input.control,
      shift: input.shift,
      alt: input.alt,
      meta: input.meta,
      repeat: input.isAutoRepeat,
      composing: input.isComposing,
    }, 'browser');
    if (b) {
      e.preventDefault();
      host.send('shortcut', { action: b.action, arg: b.arg });
    }
  });

  // Pages need the current key rebinds for their page-first keys.
  wc.on('did-finish-load', () => {
    if (!wc.isDestroyed()) wc.send('vitre:rebind', settings?.get().rebind ?? {});
  });

  wc.on('will-prevent-unload', (e) => {
    const win = hostWindow(wc);
    const choice = dialog.showMessageBoxSync(win ?? undefined as unknown as BrowserWindow, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      title: 'Leave this page?',
      message: 'Leave this page?',
      detail: 'Changes you made may not be saved.',
    });
    if (choice === 0) e.preventDefault();
  });
}

function setupSession(): void {
  const ses = session.fromPartition(PARTITION);
  // A Chrome-like user agent, without Electron's token, so sites treat Vitre as Chromium.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|vitre)\/\S+/gi, ''));
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(['fullscreen', 'clipboard-sanitized-write', 'pointerLock'].includes(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ['fullscreen', 'clipboard-sanitized-write'].includes(permission));
}

function registerIpc(): void {
  const win = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on('win:minimize', (e) => win(e)?.minimize());
  ipcMain.on('win:toggle-maximize', (e) => {
    const w = win(e);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('win:close', (e) => win(e)?.close());
  ipcMain.on('win:new', (_e, url?: string) => createWindow(url));
  ipcMain.on('win:toggle-fullscreen', (e) => {
    const w = win(e);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  ipcMain.handle('win:initial-url', (e) => {
    const url = initialUrls.get(e.sender.id) ?? null;
    initialUrls.delete(e.sender.id);
    return url;
  });

  ipcMain.on('history:add', (_e, url: string, title: string) => history.add(url, title));
  ipcMain.on('history:title', (_e, url: string, title: string) => history.title(url, title));
  ipcMain.handle('history:query', (_e, text: string, limit: number) => history.query(text, limit));
  ipcMain.handle('history:remove', (_e, url: string) => history.remove(url));
  ipcMain.handle('history:clear', (_e, since?: number) => history.clear(since ?? 0));

  ipcMain.on('session:save', (e, data: SessionData) => {
    // Only the first window's tabs are restored next time.
    const first = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
    if (first && first.webContents.id === e.sender.id) sessionStore.set(data);
  });
  ipcMain.handle('session:load', (e) => {
    const first = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id)[0];
    return first && first.webContents.id === e.sender.id ? sessionStore.get() : null;
  });

  ipcMain.handle('wallpaper:get', () => (wallpaperPath ? `vitre://wallpaper/?t=${Date.now()}` : null));
  // Brightness of the wallpaper's top band, where the tab bar sits.
  ipcMain.handle('wallpaper:luma', () => {
    if (!wallpaperPath) return null;
    const img = nativeImage.createFromPath(wallpaperPath);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 160 });
    const { width, height } = small.getSize();
    const bmp = small.toBitmap();
    const rows = Math.max(1, Math.round(height * 0.1));
    let sum = 0;
    let n = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        sum += 0.0722 * bmp[i] + 0.7152 * bmp[i + 1] + 0.2126 * bmp[i + 2];
        n++;
      }
    }
    return n ? sum / n / 255 : null;
  });

  ipcMain.on('page:save', async (e, id: number) => {
    const wc = webContents.fromId(id);
    const w = win(e);
    if (!wc || !w) return;
    const base = (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'page';
    const { canceled, filePath } = await dialog.showSaveDialog(w, {
      defaultPath: path.join(app.getPath('downloads'), `${base}.html`),
      filters: [{ name: 'Web page, complete', extensions: ['html'] }],
    });
    if (!canceled && filePath) wc.savePage(filePath, 'HTMLComplete').catch(() => undefined);
  });

  // Mean luminance of the page under the tab bar, so the glass can pick light or dark.
  ipcMain.handle('page:sample', async (_e, id: number, rect: Electron.Rectangle) => {
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) return null;
    try {
      const img = await wc.capturePage(rect);
      const bmp = img.toBitmap();
      if (!bmp.length) return null;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < bmp.length; i += 16) {
        // BGRA
        sum += 0.0722 * bmp[i] + 0.7152 * bmp[i + 1] + 0.2126 * bmp[i + 2];
        n++;
      }
      return n ? sum / n / 255 : null;
    } catch {
      return null;
    }
  });

  ipcMain.on('shell:open-external', (_e, url: string) => {
    if (/^(mailto|tel):/i.test(url)) shell.openExternal(url);
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  history = new History(path.join(app.getPath('userData'), 'history.json'));
  sessionStore = new Store<SessionData | null>(path.join(app.getPath('userData'), 'session.json'), null);
  wallpaperPath = await findWallpaper();

  protocol.handle('vitre', (req) => {
    const u = new URL(req.url);
    if (u.host === 'wallpaper' && wallpaperPath) return net.fetch(pathToFileURL(wallpaperPath).toString());
    return new Response('Not found', { status: 404 });
  });

  setupSession();
  registerIpc();
  settings = new SettingsStore(settingsFile());
  applyRebind(settings.get().rebind);
  settings.onChange((s) => {
    applyRebind(s.rebind);
    for (const wc of webContents.getAllWebContents()) if (wc.getType() === 'webview' && !wc.isDestroyed()) wc.send('vitre:rebind', s.rebind);
  });
  const ctx: MainContext = {
    partition: PARTITION,
    session: () => session.fromPartition(PARTITION),
    userData: app.getPath('userData'),
    createWindow,
    hostWindow,
    onGuest: (fn) => guestHooks.push(fn),
    settings: {
      get: () => settings.get(),
      set: (patch) => settings.set(patch),
      onChange: (fn) => settings.onChange(fn),
    },
    broadcast: (channel, ...args) => {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
    },
  };
  registerModules(ctx);
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'webview') setupGuest(wc);
  });

  const win = createWindow();
  if (isCapture) runCapture(win);
});

app.on('second-instance', (_e, argv) => {
  const url = argv.find((a) => /^https?:\/\//i.test(a));
  createWindow(url);
});

app.on('window-all-closed', () => {
  history?.flush();
  settings?.flush();
  app.quit();
});

// --capture: render the window off-screen, screenshot it after a script of steps, and quit.
function runCapture(win: BrowserWindow): void {
  const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? path.join(process.cwd(), 'capture.png');
  const script = process.argv.find((a) => a.startsWith('--script='))?.slice(9);
  const wait = Number(process.argv.find((a) => a.startsWith('--wait='))?.slice(7) ?? 3500);
  win.webContents.once('did-finish-load', async () => {
    if (script) {
      try {
        await win.webContents.executeJavaScript(decodeURIComponent(script));
      } catch (err) {
        console.error('capture script failed', err);
      }
    }
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(out, img.toPNG());
      console.log('captured', out, img.getSize());
      app.exit(0);
    }, wait);
  });
}
