// Vitre's keyboard bindings (subset of design/keymap.json implemented so far).
// Shared by the main process (browser-first keys, caught before the page),
// the page preload (page-first keys, run only if the page didn't preventDefault)
// and the chrome renderer (keys pressed while focus is in Vitre's own UI).

export type Priority = 'browser' | 'page';

export type ActionId =
  | 'newTab' | 'closeTab' | 'reopenClosed' | 'newWindow' | 'closeWindow'
  | 'nextTabMru' | 'prevTabMru' | 'nextTab' | 'prevTab' | 'goTab' | 'goLastTab'
  | 'moveTabLeft' | 'moveTabRight' | 'focusAddress' | 'fullscreen'
  | 'back' | 'forward' | 'reload' | 'hardReload' | 'stop'
  | 'zoomIn' | 'zoomOut' | 'zoomReset' | 'devtools' | 'print' | 'savePage' | 'viewSource'
  | 'history'
  | 'find' | 'findNext' | 'findPrev'
  | 'peekLink'
  | 'downloads' | 'downloadVideo'
  | 'settings' | 'shortcutsHelp' | 'clearData'
  | 'switcherSearch';

export interface KeyInput {
  key: string;
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  repeat: boolean;
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
  // Vitre first: pages never get these.
  B('newTab', 'Ctrl+T', 'browser', { repeat: true }),
  B('closeTab', 'Ctrl+W', 'browser'),
  B('closeTab', 'Ctrl+F4', 'browser'),
  B('reopenClosed', 'Ctrl+Shift+T', 'browser'),
  B('newWindow', 'Ctrl+N', 'browser'),
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

  // Page first: the site gets them before Vitre.
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
  B('devtools', 'Ctrl+Shift+J', 'page'),
  B('devtools', 'Ctrl+Shift+C', 'page'),
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
  B('downloads', 'Ctrl+J', 'page'),
  B('downloadVideo', 'Ctrl+Shift+D', 'page'),
  B('settings', 'Ctrl+Comma', 'page'),
  B('shortcutsHelp', 'F1', 'page'),
  B('clearData', 'Ctrl+Shift+Delete', 'page'),
  B('switcherSearch', 'Ctrl+Shift+A', 'page'),
];

const DEFAULT_BINDINGS = BINDINGS.map((b) => ({ ...b }));
/** Only Vitre's own verbs can be rebound (Settings › Keyboard shortcuts). */
export const REBINDABLE: ActionId[] = ['peekLink', 'switcherSearch', 'downloadVideo'];

/** Apply Settings › Keyboard shortcuts, e.g. { peekLink: 'Ctrl+K' } (spec format as in B()). */
export function applyRebind(rebind: Record<string, string> | undefined): void {
  BINDINGS.length = 0;
  for (const d of DEFAULT_BINDINGS) {
    const spec = rebind && REBINDABLE.includes(d.action) ? rebind[d.action] : undefined;
    BINDINGS.push(spec ? { ...B(d.action, spec, d.priority), arg: d.arg, repeat: d.repeat } : { ...d });
  }
}

/** Normalise a key event to the names used in BINDINGS. */
export function keyName(key: string, code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    // Letters follow the key's label (so AZERTY and Dvorak behave like every Windows app);
    // non-Latin layouts fall back to the physical key, which is what Windows does for Ctrl+C.
    return /^[a-z]$/i.test(key) ? key.toUpperCase() : letter[1];
  }
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  switch (code) {
    case 'NumpadAdd': return 'Plus';
    case 'NumpadSubtract': return 'Minus';
    case 'Numpad0': return 'Num0';
  }
  switch (key) {
    case '+': return 'Plus';
    case '-': case '_': return 'Minus';
    case '=': return 'Equal';
    case ',': return 'Comma';
    case 'ArrowLeft': return 'Left';
    case 'ArrowRight': return 'Right';
    case 'ArrowUp': return 'Up';
    case 'ArrowDown': return 'Down';
    case 'Esc': return 'Escape';
  }
  return key;
}

export function match(input: KeyInput, priority?: Priority): Binding | null {
  if (input.composing || input.meta) return null;
  const name = keyName(input.key, input.code);
  for (const b of BINDINGS) {
    if (priority && b.priority !== priority) continue;
    if (b.key !== name) continue;
    if (!!b.ctrl !== input.ctrl) continue;
    if (!!b.alt !== input.alt) continue; // exact modifiers: AltGr (Ctrl+Alt) never matches
    if (b.shift !== 'any' && !!b.shift !== input.shift) continue;
    if (input.repeat && !b.repeat) return null;
    return b;
  }
  return null;
}
