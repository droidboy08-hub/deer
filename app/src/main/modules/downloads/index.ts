// Vitre's downloader (main process). Chromium's downloads are held at 'will-download' and taken
// over by Vitre's engine; pages' media is watched for the video pill; the chrome renderer drives
// everything over dl:* channels.
//
// Not done here: Mark of the Web (Zone.Identifier) on finished files is out of scope for now,
// so Windows SmartScreen doesn't see where a downloaded program came from.
import { app, clipboard, dialog, ipcMain, webContents, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { MainContext } from '../../context';
import { DownloadManager } from './manager';
import { MediaWatch } from './media';
import type { PageVideo, StartOptions } from './types';

export function register(ctx: MainContext): void {
  const manager = new DownloadManager(ctx);
  const media = new MediaWatch(ctx);
  media.install();

  ctx.session().on('will-download', (_e, item, wc) => {
    try {
      manager.adoptBrowser(item, wc);
    } catch (err) {
      console.error('downloads: could not take over a download', err);
    }
  });

  // Only Vitre's own windows may drive downloads; pages have no access to these channels anyway.
  const fromChrome = (e: IpcMainInvokeEvent) => e.sender.getType() === 'window';
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, (e, ...args) => (fromChrome(e) ? fn(e, ...args) : null));
  };
  const id = (v: unknown) => (typeof v === 'string' ? v : '');

  handle('dl:list', () => manager.list());
  handle('dl:start', (e, url, opts) => {
    if (typeof url !== 'string') return null;
    try {
      return manager.start(url, (opts ?? {}) as StartOptions, e.sender);
    } catch {
      return null;
    }
  });
  handle('dl:pause', (_e, v) => manager.pause(id(v)));
  handle('dl:resume', (_e, v) => manager.resume(id(v)));
  handle('dl:start-now', (_e, v) => manager.resume(id(v), true));
  handle('dl:cancel', (_e, v) => manager.cancel(id(v)));
  handle('dl:remove', (_e, v) => manager.remove(id(v)));
  handle('dl:clear-finished', () => manager.clearFinished());
  handle('dl:pause-all', () => manager.pauseAll());
  handle('dl:resume-all', () => manager.resumeAll());
  handle('dl:limit', (_e, v, kbps) => manager.setLimit(id(v), Number(kbps) || 0));
  handle('dl:open', (_e, v) => manager.open(id(v)));
  handle('dl:show-in-folder', (_e, v) => manager.showInFolder(id(v)));
  handle('dl:open-folder', () => manager.openFolder());
  handle('dl:copy-address', (_e, v) => manager.copyAddress(id(v)));
  handle('dl:clipboard-url', async () => {
    const text = String(await clipboard.readText()).trim();
    return /^https?:\/\/\S+$/i.test(text) && text.length < 4096 ? text : null;
  });
  handle('dl:choose-folder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath: ctx.settings.get().downloadsFolder || app.getPath('downloads') };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
  handle('dl:media-count', (_e, wcId) => media.candidates(Number(wcId)).filter((c) => c.kind !== 'dash').length);
  handle('dl:offer', (_e, wcId, video) => media.offer(Number(wcId), video as PageVideo));
  // A still of the video for the picker, taken from the page as it is now.
  handle('dl:thumb', async (_e, wcId, rect) => {
    const wc = webContents.fromId(Number(wcId));
    const r = rect as { x: number; y: number; w: number; h: number } | null;
    if (!wc || wc.isDestroyed() || !r || r.w < 8 || r.h < 8) return null;
    try {
      const img = await wc.capturePage({ x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.w), height: Math.round(r.h) });
      return img.isEmpty() ? null : img.resize({ width: 128 }).toDataURL();
    } catch {
      return null;
    }
  });

  app.on('before-quit', () => manager.shutdown());
  process.on('exit', () => manager.flushSync());
}
