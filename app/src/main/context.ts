// What a main-process feature module gets. Modules live in src/main/modules/ and are listed in
// src/main/modules/index.ts; each exports `register(ctx: MainContext)`.
import type { BrowserWindow, Session, WebContents } from 'electron';
import type { Settings } from '../shared/settings';

export interface MainContext {
  partition: string;
  session(): Session;
  userData: string;
  createWindow(url?: string): BrowserWindow;
  /** The Vitre window that hosts this page (or the window itself for chrome webContents). */
  hostWindow(wc: WebContents): BrowserWindow | null;
  /** Called for every page webContents (tabs and peeks) when it is created. */
  onGuest(fn: (wc: WebContents) => void): void;
  settings: {
    get(): Settings;
    set(patch: Partial<Settings>): void;
    onChange(fn: (s: Settings) => void): void;
  };
  /** Send to every Vitre window's chrome renderer. */
  broadcast(channel: string, ...args: unknown[]): void;
}
