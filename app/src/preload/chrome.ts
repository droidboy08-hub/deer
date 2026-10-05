import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from '../shared/settings';
import type { HistoryEntry, OpenUrlMessage, SessionData, ShortcutMessage, VitreApi, WindowState } from '../shared/types';

// Feature modules talk to the main process on these channel prefixes only.
const ALLOWED = ['find:', 'menu:', 'peek:', 'dl:', 'settings:', 'switcher:', 'home:', 'app:'];
const allowed = (ch: string) => ALLOWED.some((p) => ch.startsWith(p));

const api: VitreApi = {
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    newWindow: (url?: string) => ipcRenderer.send('win:new', url),
    toggleFullscreen: () => ipcRenderer.send('win:toggle-fullscreen'),
    onState: (cb) => ipcRenderer.on('win:state', (_e, s: WindowState) => cb(s)),
  },
  onShortcut: (cb) => ipcRenderer.on('shortcut', (_e, m: ShortcutMessage) => cb(m)),
  onCtrlUp: (cb) => ipcRenderer.on('ctrl-up', () => cb()),
  onOpenUrl: (cb) => ipcRenderer.on('open-url', (_e, m: OpenUrlMessage) => cb(m)),
  history: {
    add: (url, title) => ipcRenderer.send('history:add', url, title),
    title: (url, title) => ipcRenderer.send('history:title', url, title),
    query: (text, limit) => ipcRenderer.invoke('history:query', text, limit) as Promise<HistoryEntry[]>,
    remove: (url) => ipcRenderer.invoke('history:remove', url) as Promise<void>,
    clear: (since?: number) => ipcRenderer.invoke('history:clear', since) as Promise<void>,
  },
  session: {
    save: (data: SessionData) => ipcRenderer.send('session:save', data),
    load: () => ipcRenderer.invoke('session:load') as Promise<SessionData | null>,
  },
  wallpaper: () => ipcRenderer.invoke('wallpaper:get') as Promise<string | null>,
  wallpaperLuma: () => ipcRenderer.invoke('wallpaper:luma') as Promise<number | null>,
  savePage: (id: number) => ipcRenderer.send('page:save', id),
  initialUrl: () => ipcRenderer.invoke('win:initial-url') as Promise<string | null>,
  sampleLuma: (id, rect) => ipcRenderer.invoke('page:sample', id, rect) as Promise<number | null>,
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),
  settings: {
    get: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
    set: (patch: Partial<Settings>) => ipcRenderer.send('settings:set', patch),
    onChange: (cb: (s: Settings) => void) => ipcRenderer.on('settings:changed', (_e, s: Settings) => cb(s)),
  },
  ipc: {
    invoke: (channel: string, ...args: unknown[]) => (allowed(channel) ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error(`blocked channel ${channel}`))),
    send: (channel: string, ...args: unknown[]) => {
      if (allowed(channel)) ipcRenderer.send(channel, ...args);
    },
    on: (channel: string, cb: (...args: unknown[]) => void) => {
      if (allowed(channel)) ipcRenderer.on(channel, (_e, ...args) => cb(...args));
    },
  },
};

contextBridge.exposeInMainWorld('vitre', api);
