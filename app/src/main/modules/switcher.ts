// Tab switcher, main-process side.
// - 'switcher:thumb': a JPEG thumbnail of a page, for the switcher's cards.
// - 'switcher:sticky': whether Windows Sticky Keys is on (the switcher then opens latched).
// - 'switcher:state': the chrome renderer says when its switcher is open. While it is, keys
//   pressed in that window are routed here before the renderer sees them, so Ctrl+letter types
//   into the switcher's search instead of running its global command (keymap: "Held switcher").
import { app, ipcMain, webContents, type Input, type WebContents } from 'electron';
import { execFile } from 'child_process';
import { match } from '../../shared/shortcuts';
import type { MainContext } from '../context';

/** What the renderer is told about a key it will not see: a Ctrl+letter to type into the search. */
export type SwitcherKey = { kind: 'type'; text: string };

type Route = 'pass' | 'swallow' | SwitcherKey;

const MIN_THUMB = 160;
const MAX_THUMB = 1920;
const CAPTURE_TIMEOUT = 1000;

/** Chrome webContents ids whose switcher is open. */
const openIn = new Set<number>();

export function register(_ctx: MainContext): void {
  ipcMain.handle('switcher:thumb', (_e, id: number, width: number) => thumbnail(id, width));
  ipcMain.handle('switcher:sticky', () => stickyKeys.get());
  ipcMain.on('switcher:state', (e, open: boolean) => {
    if (open) openIn.add(e.sender.id);
    else openIn.delete(e.sender.id);
  });
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'window') guardKeys(wc);
  });
  stickyKeys.refresh();
}

/**
 * A hidden page can't be captured (capturePage fails, or waits for a frame that never comes), so
 * the renderer only asks for the visible tab; the timeout keeps a stray request from hanging.
 */
async function thumbnail(id: number, width: number): Promise<string | null> {
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) return null;
  let timer: NodeJS.Timeout | undefined;
  try {
    // A capture that fails after the timeout must not surface as an unhandled rejection.
    const capture = wc.capturePage().catch(() => null);
    const img = await Promise.race([capture, new Promise<null>((r) => (timer = setTimeout(() => r(null), CAPTURE_TIMEOUT)))]);
    if (!img || img.isEmpty()) return null;
    const w = Math.max(MIN_THUMB, Math.min(MAX_THUMB, Math.round(width) || 640));
    const small = img.getSize().width > w ? img.resize({ width: w, quality: 'good' }) : img;
    return `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function guardKeys(wc: WebContents): void {
  const id = wc.id;
  wc.on('before-input-event', (e, input) => {
    if (!openIn.has(id) || input.type !== 'keyDown') return;
    const r = route(input);
    if (r === 'pass') return;
    e.preventDefault();
    if (r !== 'swallow') wc.send('switcher:key', r);
    if (input.control) rearmKeyUps(wc);
  });
  // A reloaded or crashed window starts with its switcher closed.
  wc.on('did-navigate', () => openIn.delete(id));
  wc.on('render-process-gone', () => openIn.delete(id));
  wc.once('destroyed', () => openIn.delete(id));
}

/**
 * After the browser consumes a key-down, Chromium drops that view's key-ups until the next
 * key-down, which would lose the Ctrl release a held switcher opens on. A Ctrl key-down (Ctrl
 * is still held) re-arms them; nothing is bound to Ctrl alone.
 */
function rearmKeyUps(wc: WebContents): void {
  setImmediate(() => {
    if (!wc.isDestroyed()) wc.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] });
  });
}

/**
 * While the switcher is open:
 * - Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W, Ctrl+F4 and Ctrl+Shift+A pass: the renderer's actions
 *   and close layer turn them into steps, closing the selected card and focusing the search.
 * - Ctrl+letter and Ctrl+digit type that character; any other Ctrl shortcut does nothing.
 * - Other Vitre shortcuts (F5, F11, Alt+Left...) are swallowed; Esc and editing keys reach the field.
 * - AltGr (Ctrl+Alt) and IME composition always reach the field.
 */
function route(input: Input): Route {
  if (input.isComposing || input.meta) return 'pass';
  if (input.control && input.alt) return 'pass';
  const b = match({
    key: input.key,
    code: input.code,
    ctrl: input.control,
    shift: input.shift,
    alt: input.alt,
    meta: false,
    repeat: false,
    composing: false,
  });
  if (input.control) {
    if (input.key === 'Tab' || input.key === 'Control' || input.key === 'Shift') return 'pass';
    if (b?.action === 'closeTab' || b?.action === 'switcherSearch') return 'pass';
    if (/^(Key[A-Z]|Digit\d)$/.test(input.code)) {
      return input.key.length === 1 ? { kind: 'type', text: input.key } : 'swallow';
    }
    return b ? 'swallow' : 'pass';
  }
  return b && b.action !== 'stop' ? 'swallow' : 'pass';
}

/** Sticky Keys from the registry (SKF_STICKYKEYSON is bit 0 of Flags), refreshed at most every 10 s. */
const stickyKeys = (() => {
  let on = false;
  let checked = 0;
  const refresh = () => {
    if (process.platform !== 'win32' || Date.now() - checked < 10_000) return;
    checked = Date.now();
    execFile('reg', ['query', 'HKCU\\Control Panel\\Accessibility\\StickyKeys', '/v', 'Flags'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      if (err) return;
      const m = /Flags\s+REG_\w+\s+(\d+)/i.exec(out);
      if (m) on = (Number(m[1]) & 1) === 1;
    });
  };
  return {
    refresh,
    get(): boolean {
      refresh();
      return on;
    },
  };
})();
