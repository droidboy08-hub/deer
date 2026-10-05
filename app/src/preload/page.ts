// Runs in every web page (isolated world). It forwards page-first shortcuts to Vitre only
// when the page didn't handle them, and reports scrolling so the glass can re-sample the page.
import { ipcRenderer } from 'electron';
import { applyRebind, match } from '../shared/shortcuts';
import './page-modules';

ipcRenderer.on('vitre:rebind', (_e, rebind: Record<string, string>) => applyRebind(rebind));

window.addEventListener(
  'keydown',
  (e) => {
    const b = match({
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
      repeat: e.repeat,
      composing: e.isComposing || e.keyCode === 229,
    }, 'page');
    if (!b) return;
    // Look after the whole dispatch: the page gets the key first.
    setTimeout(() => {
      if (!e.defaultPrevented) ipcRenderer.sendToHost('page-key', b.action, b.arg ?? null);
    }, 0);
  },
  true,
);

// Mouse side buttons: Back and Forward.
window.addEventListener(
  'mouseup',
  (e) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      ipcRenderer.sendToHost('page-key', e.button === 3 ? 'back' : 'forward', null);
    }
  },
  true,
);

let scrollTimer: number | null = null;
window.addEventListener(
  'scroll',
  () => {
    if (scrollTimer !== null) return;
    scrollTimer = window.setTimeout(() => {
      scrollTimer = null;
      ipcRenderer.sendToHost('page-scroll');
    }, 250);
  },
  { capture: true, passive: true },
);
