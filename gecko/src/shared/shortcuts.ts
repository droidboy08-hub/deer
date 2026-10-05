// Deer's keyboard bindings: every key of design/keymap.json that is not local to one surface.
// Ported from app/src/shared/shortcuts.ts. Pure data and matching: the per-window router
// (src/window/keys.ts) decides when a binding runs (browser-first in the chrome capture phase,
// page-first on the reply from the page). Keys that only work inside one Deer surface (the address
// field's Enter / Alt+Enter / Shift+Delete, the switcher's keys, menu keys) are handled by that
// surface's own keydown listener, which must preventDefault() what it uses.
//
// Matching follows the rule verified in spikes/keys/RESULT.md (recipe correction 1):
//   '+' and '-' by the typed character first, letters by event.keyCode (65-90), comma by keyCode 188,
//   digits by the physical key (event.code Digit0-9), numpad by code.
// keypress events carry keyCode 0: match on keydown only and remember the binding per event.code.
//
// State note: BINDINGS is rebuilt by applyRebind(). Every bundle that imports this file has its own
// copy, so each must call applyRebind(settings.rebind) itself when settings change.
import { cleanRebind, REBINDABLE_ACTIONS } from './settings';

export type Priority = 'browser' | 'page';

export type ActionId =
  | 'newTab' | 'closeTab' | 'reopenClosed' | 'newWindow' | 'newPrivateWindow' | 'closeWindow'
  | 'nextTabMru' | 'prevTabMru' | 'nextTab' | 'prevTab' | 'goTab' | 'goLastTab'
  | 'moveTabLeft' | 'moveTabRight' | 'focusAddress' | 'fullscreen'
  | 'back' | 'forward' | 'reload' | 'hardReload' | 'stop'
  | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'devtools' | 'devtoolsConsole' | 'devtoolsInspect'
  | 'print' | 'savePage' | 'viewSource'
  | 'history' | 'goHome' | 'quit'
  | 'find' | 'findNext' | 'findPrev'
  | 'peekLink' | 'openAsTab'
  | 'downloads' | 'downloadVideo'
  | 'settings' | 'shortcutsHelp' | 'clearData'
  | 'switcherSearch';

export interface KeyInput {
  key: string;
  code: string;
  /** The virtual key (KeyboardEvent.keyCode on keydown). */
  keyCode: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  repeat: boolean;
  /** IME composition in progress, or AltGraph held: never a shortcut. */
  composing: boolean;
}

export interface Binding {
  action: ActionId;
  arg?: number;
  key: string;
  ctrl?: boolean;
  shift?: boolean | 'any';
  alt?: boolean;
  priority: Priority;
  /** Allow auto-repeat. Anything that closes, opens or toggles ignores repeat. */
  repeat?: boolean;
}

const B = (action: ActionId, spec: string, priority: Priority, extra: Partial<Binding> = {}): Binding => {
  const parts = spec.split('+');
  const key = parts.pop() as string;
  return {
    action,
    key,
    ctrl: parts.includes('Ctrl'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    priority,
    ...extra,
  };
};

export const BINDINGS: Binding[] = [
  // Deer first: pages never get these.
  B('newTab', 'Ctrl+T', 'browser', { repeat: true }),
  B('closeTab', 'Ctrl+W', 'browser'),
  B('closeTab', 'Ctrl+F4', 'browser'),
  B('reopenClosed', 'Ctrl+Shift+T', 'browser'),
  B('newWindow', 'Ctrl+N', 'browser'),
  B('newPrivateWindow', 'Ctrl+Shift+N', 'browser'),
  B('closeWindow', 'Ctrl+Shift+W', 'browser'),
  B('nextTabMru', 'Ctrl+Tab', 'browser', { repeat: true }),
  B('prevTabMru', 'Ctrl+Shift+Tab', 'browser', { repeat: true }),
  B('nextTab', 'Ctrl+PageDown', 'browser', { repeat: true }),
  B('prevTab', 'Ctrl+PageUp', 'browser', { repeat: true }),
  B('focusAddress', 'F6', 'browser', { arg: 6 }),
  B('focusAddress', 'Shift+F6', 'browser', { arg: 6 }),
  B('back', 'BrowserBack', 'browser'),
  B('forward', 'BrowserForward', 'browser'),
  B('reload', 'BrowserRefresh', 'browser'),
  B('stop', 'BrowserStop', 'browser'),
  B('focusAddress', 'BrowserSearch', 'browser'),
  B('goHome', 'BrowserHome', 'browser'),

  // Page first: the site gets them before Deer.
  B('focusAddress', 'Ctrl+L', 'page'),
  B('focusAddress', 'Alt+D', 'page'),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => B('goTab', `Ctrl+${n}`, 'page', { arg: n })),
  B('goLastTab', 'Ctrl+9', 'page'),
  B('moveTabLeft', 'Ctrl+Shift+PageUp', 'page', { repeat: true }),
  B('moveTabRight', 'Ctrl+Shift+PageDown', 'page', { repeat: true }),
  B('fullscreen', 'F11', 'page'),
  B('back', 'Alt+Left', 'page', { repeat: true }),
  B('forward', 'Alt+Right', 'page', { repeat: true }),
  B('reload', 'Ctrl+R', 'page'),
  B('reload', 'F5', 'page'),
  B('hardReload', 'Ctrl+Shift+R', 'page'),
  B('hardReload', 'Ctrl+F5', 'page'),
  B('hardReload', 'Shift+F5', 'page'),
  B('stop', 'Escape', 'page'),
  { ...B('zoomIn', 'Ctrl+Plus', 'page', { repeat: true }), shift: 'any' },
  { ...B('zoomIn', 'Ctrl+Equal', 'page', { repeat: true }), shift: 'any' },
  B('zoomOut', 'Ctrl+Minus', 'page', { repeat: true }),
  B('zoomReset', 'Ctrl+0', 'page'),
  B('zoomReset', 'Ctrl+Num0', 'page'),
  B('devtools', 'F12', 'page'),
  B('devtools', 'Ctrl+Shift+I', 'page'),
  B('devtoolsConsole', 'Ctrl+Shift+J', 'page'),
  B('devtoolsInspect', 'Ctrl+Shift+C', 'page'),
  B('print', 'Ctrl+P', 'page'),
  B('savePage', 'Ctrl+S', 'page'),
  B('viewSource', 'Ctrl+U', 'page'),
  B('history', 'Ctrl+H', 'page'),
  B('find', 'Ctrl+F', 'page'),
  B('findNext', 'F3', 'page', { repeat: true }),
  B('findPrev', 'Shift+F3', 'page', { repeat: true }),
  B('findNext', 'Ctrl+G', 'page', { repeat: true }),
  B('findPrev', 'Ctrl+Shift+G', 'page', { repeat: true }),
  B('peekLink', 'Ctrl+Q', 'page'),
  // With no peek open this does nothing: the page had the key first, and the address field takes
  // its own Alt+Enter on keydown.
  B('openAsTab', 'Alt+Enter', 'page'),
  B('downloads', 'Ctrl+J', 'page'),
  B('downloadVideo', 'Ctrl+Shift+D', 'page'),
  B('settings', 'Ctrl+Comma', 'page'),
  B('shortcutsHelp', 'F1', 'page'),
  B('clearData', 'Ctrl+Shift+Delete', 'page'),
  B('switcherSearch', 'Ctrl+Shift+A', 'page'),
];

const DEFAULT_BINDINGS = BINDINGS.map((b) => ({ ...b }));
/** Only Deer's own verbs can be rebound (Settings › Keyboard shortcuts). */
export const REBINDABLE: ActionId[] = [...REBINDABLE_ACTIONS];

/**
 * Apply Settings › Keyboard shortcuts, e.g. { peekLink: 'Ctrl+K' } (spec format as in B()).
 * The map is rebuilt first and swapped in whole: a value that is not a usable spec (VitreSettings
 * drops those already) keeps that action's default, and nothing can leave the map half built.
 */
export function applyRebind(rebind: Record<string, string> | undefined): void {
  const clean = cleanRebind(rebind);
  const next: Binding[] = [];
  for (const d of DEFAULT_BINDINGS) {
    const spec = REBINDABLE.includes(d.action) ? clean[d.action] : undefined;
    let binding: Binding = { ...d };
    if (spec) {
      try {
        binding = { ...B(d.action, spec, d.priority), arg: d.arg, repeat: d.repeat };
      } catch {
        binding = { ...d };
      }
    }
    next.push(binding);
  }
  BINDINGS.splice(0, BINDINGS.length, ...next);
}

/**
 * Normalise a keydown to the names used in BINDINGS.
 * `keyCode` is the virtual key: it follows the layout for letters (AZERTY, Dvorak) and falls back to
 * the US position on non-Latin layouts, which is what every Windows application does for Ctrl+C.
 */
export function keyName(key: string, code: string, keyCode = 0): string {
  // Zoom wins on any key that types '+' or '-' (on AZERTY the 6 key types '-').
  switch (code) {
    case 'NumpadAdd': return 'Plus';
    case 'NumpadSubtract': return 'Minus';
    case 'Numpad0': return 'Num0';
  }
  switch (key) {
    case '+': return 'Plus';
    case '-': case '_': return 'Minus';
    case '=': return 'Equal';
  }
  if (keyCode >= 65 && keyCode <= 90) return String.fromCharCode(keyCode);
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  if (keyCode === 188) return 'Comma';
  switch (key) {
    case 'ArrowLeft': return 'Left';
    case 'ArrowRight': return 'Right';
    case 'ArrowUp': return 'Up';
    case 'ArrowDown': return 'Down';
    case 'Esc': return 'Escape';
  }
  return key;
}

/** The KeyInput for a DOM keydown, with the guards from the keys spike (IME, AltGraph). */
export function keyInput(e: KeyboardEvent): KeyInput {
  return {
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    repeat: e.repeat,
    composing: e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.getModifierState('AltGraph'),
  };
}

/**
 * The binding for a keydown, whatever its repeat state. The router uses this one: a repeat of a
 * key that ignores repeat must still be swallowed, or it would fall through to the page.
 * Guards: nothing matches during IME composition, with AltGraph, with the Windows key, or with
 * Ctrl and Alt together (AltGr on many layouts).
 */
export function find(input: KeyInput, priority?: Priority): Binding | null {
  if (input.composing || input.meta || (input.ctrl && input.alt)) return null;
  const name = keyName(input.key, input.code, input.keyCode);
  for (const b of BINDINGS) {
    if (priority && b.priority !== priority) continue;
    if (b.key !== name) continue;
    if (!!b.ctrl !== input.ctrl) continue;
    if (!!b.alt !== input.alt) continue; // exact modifiers
    if (b.shift !== 'any' && !!b.shift !== input.shift) continue;
    return b;
  }
  return null;
}

/** As find(), but a repeat of a binding that ignores repeat matches nothing. */
export function match(input: KeyInput, priority?: Priority): Binding | null {
  const b = find(input, priority);
  return b && input.repeat && !b.repeat ? null : b;
}

/** "Ctrl+Shift+T" for a binding, in the spelling the design prints. */
export function specOf(b: Binding): string {
  return `${b.ctrl ? 'Ctrl+' : ''}${b.alt ? 'Alt+' : ''}${b.shift === true ? 'Shift+' : ''}${b.key}`;
}
