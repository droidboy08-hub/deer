import type { WebviewTag } from 'electron';

export type Theme = 'light' | 'dark' | 'clear';

export interface Tab {
  id: number;
  kind: 'home' | 'web';
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  zoom: number;
  theme: Theme;
  webview: WebviewTag | null;
  ready: boolean;
  /** Restored tabs load only when first shown. */
  deferred: boolean;
  error: { code: number; description: string; url: string } | null;
  zoomFlash: number;
}

let nextId = 1;

export function makeTab(kind: 'home' | 'web', url = '', title = ''): Tab {
  return {
    id: nextId++,
    kind,
    url,
    title,
    favicon: null,
    loading: false,
    canBack: false,
    canForward: false,
    zoom: 1,
    theme: kind === 'home' ? 'clear' : 'light',
    webview: null,
    ready: false,
    deferred: false,
    error: null,
    zoomFlash: 0,
  };
}

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
