import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import { Store } from './store';

export class SettingsStore {
  private store: Store<Settings>;
  private listeners: ((s: Settings) => void)[] = [];

  constructor(file: string) {
    this.store = new Store<Settings>(file, DEFAULT_SETTINGS);
    const merged = { ...DEFAULT_SETTINGS, ...this.store.get() };
    if (!merged.downloadsFolder) merged.downloadsFolder = app.getPath('downloads');
    this.store.set(merged);
    ipcMain.handle('settings:get', () => this.get());
    ipcMain.on('settings:set', (_e, patch: Partial<Settings>) => this.set(patch));
  }

  get(): Settings {
    return this.store.get();
  }

  set(patch: Partial<Settings>): void {
    const next = { ...this.store.get(), ...patch };
    this.store.set(next);
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('settings:changed', next);
    for (const fn of this.listeners) fn(next);
  }

  onChange(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
  }

  flush(): void {
    this.store.flush();
  }
}

export function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}
