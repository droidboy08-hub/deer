import type { Settings } from './settings';
import type { ActionId } from './shortcuts';

export interface ShortcutMessage {
  action: ActionId;
  arg?: number;
}

export interface OpenUrlMessage {
  url: string;
  disposition: string;
  /** webContents id of the page that asked. */
  openerId: number;
}

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

export interface HistoryEntry {
  url: string;
  title: string;
  visits: number;
  last: number;
}

export interface SessionTab {
  url: string;
  title: string;
  kind: 'home' | 'web';
}

export interface SessionData {
  tabs: SessionTab[];
  active: number;
}

export interface VitreApi {
  win: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    newWindow(url?: string): void;
    toggleFullscreen(): void;
    onState(cb: (s: WindowState) => void): void;
  };
  onShortcut(cb: (m: ShortcutMessage) => void): void;
  onCtrlUp(cb: () => void): void;
  onOpenUrl(cb: (m: OpenUrlMessage) => void): void;
  history: {
    add(url: string, title: string): void;
    title(url: string, title: string): void;
    query(text: string, limit: number): Promise<HistoryEntry[]>;
    remove(url: string): Promise<void>;
    clear(since?: number): Promise<void>;
  };
  session: {
    save(data: SessionData): void;
    load(): Promise<SessionData | null>;
  };
  wallpaper(): Promise<string | null>;
  wallpaperLuma(): Promise<number | null>;
  savePage(webContentsId: number): void;
  initialUrl(): Promise<string | null>;
  sampleLuma(webContentsId: number, rect: { x: number; y: number; width: number; height: number }): Promise<number | null>;
  openExternal(url: string): void;
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): void;
    onChange(cb: (s: Settings) => void): void;
  };
  /** Generic bridge for feature modules; channels must start with find:, menu:, peek:, dl:, settings:, switcher:, home: or app:. */
  ipc: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    send(channel: string, ...args: unknown[]): void;
    on(channel: string, cb: (...args: unknown[]) => void): void;
  };
}

declare global {
  interface Window {
    vitre: VitreApi;
  }
}
