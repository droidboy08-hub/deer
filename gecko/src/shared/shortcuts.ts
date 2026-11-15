// Deer's keyboard bindings: every key of design/keymap.json that is not local to one surface.
// Ported from app/src/shared/shortcuts.ts. Pure data and matching: the per-window router
// (src/window/keys.ts) decides when a binding runs (browser-first in the chrome capture phase,
// page-first on the reply from the page). Keys that only work inside one Deer surface (the address
// field's Enter / Alt+Enter / Shift+Delete, the switcher's keys, menu keys) are handled by that
// surface's own keydown listener, which must preventDefault() what it uses.
//
// One table for both systems (owner's decision D1, mac port plan): a spec is
//   [Mod+][Ctrl+][Alt+][Shift+]Key
// where "Mod" is the main modifier (Ctrl on Windows, ⌘ on macOS) and "Ctrl" is always the physical
// Control key (Peek's ⌃Q, the switcher's ⌃⇥). A row that one system lacks is win(...) or mac(...);
// bindingsFor(os) resolves the table for one system. On Windows the resolved list is exactly the map
// Deer has always had, in the same order, with the same Binding fields: "Mod+T" is { ctrl: true }.
// On macOS "Mod" is { meta: true } (⌘), and the Mac rows follow the approved Mac keymap (design
// canvas MacKeys, design/keymap.json keys_mac): ⌘Q quits and ⌘M minimizes (Deer first), History is
// ⌘Y (⌘H hides Deer), Back / Forward ⌘[ ⌘] and ⌘← ⌘→, full screen ⌃⌘F (F11 an unprinted alias),
// downloads ⌥⌘L and ⇧⌘J, next / previous tab ⇧⌘] ⇧⌘[ and ⌥⌘→ ⌥⌘←, ⌘. on the Esc ladder.
//
// Matching follows the rule verified in spikes/keys/RESULT.md (recipe correction 1):
//   '+' and '-' by the typed character first, letters by event.keyCode (65-90), comma by keyCode 188,
//   digits by the physical key (event.code Digit0-9), numpad by code.
//   macOS adds brackets by keyCode 219 / 221 and period by keyCode 190: Gecko computes keyCode from
//   the unshifted character of the ⌘ layout when ⌘ is down (widget/cocoa/TextInputHandler.mm,
//   TISInputSourceWrapper::ComputeGeckoKeyCode), so ⇧⌘] is "]" whatever Shift types.
// keypress events carry keyCode 0: match on keydown only and remember the binding per event.code.
//
// Guards (find()):
//   Windows: nothing matches during IME composition, with AltGraph, with the Windows key, or with
//            Ctrl and Alt together (AltGr on many layouts).
//   macOS:   nothing matches during IME composition; ⌘ is Mod and matches exactly. Option sets ALT
//            and ALTGRAPH together (widget/cocoa/nsCocoaUtils.mm ModifiersForEvent), so the AltGraph
//            rule is dropped; instead Option with a character key (it types: ⌥C is ç) and any ⌃⌥
//            chord (VoiceOver) never match. The fn key is not a modifier here: fn↑ simply arrives as
//            Page Up (a fn chord that a menu item claims is the menu's before any page or Deer sees
//            it: widget/cocoa/TextInputHandler.mm HandleKeyDownEvent, MODIFIER_FN).
//
// Display: displaySpec(spec, os) prints a spec the way each system does ("Ctrl+Shift+T" on Windows;
// "⇧⌘T" on macOS: glyphs in ⌃⌥⇧⌘ order, then the key, no "+"); ariaSpec(spec, os) says it in words.
//
// Rebinds (Settings › Keyboard shortcuts) are stored in the Windows spelling Deer has always written
// and read through settings.ts rebindToSpec(): on macOS a stored "Ctrl" is ⌘ (as in a WebExtension
// manifest) and "MacCtrl" is the Control key, so a Windows rebind keeps working on a Mac. A stored key
// that macOS owns (Option with a character, ⌃⌥, the never-bind list) keeps the action's Mac default
// and says so once in the console.
//
// State note: BINDINGS is rebuilt by applyRebind(). Every bundle that imports this file has its own
// copy, so each must call applyRebind(settings.rebind) itself when settings change.
import { isMac } from './os';
import { cleanRebind, rebindToSpec, REBINDABLE_ACTIONS } from './settings';

export type Priority = 'browser' | 'page';

/** The two keymaps: Windows (and any system that is not macOS) and macOS. */
export type OS = 'win' | 'mac';

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
  | 'switcherSearch'
  | 'splitView'
  // macOS only (⌘M): the window goes to the Dock. Registered by the key router (keys.ts).
  | 'minimize';

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
  /** IME composition in progress, or (Windows) AltGraph held: never a shortcut. */
  composing: boolean;
}

export interface Binding {
  action: ActionId;
  arg?: number;
  key: string;
  ctrl?: boolean;
  shift?: boolean | 'any';
  alt?: boolean;
  /** ⌘ ("Mod" on macOS). Never set on Windows, where Mod is Ctrl. */
  meta?: boolean;
  priority: Priority;
  /** Allow auto-repeat. Anything that closes, opens or toggles ignores repeat. */
  repeat?: boolean;
}

/** The keymap of the system this bundle runs on. */
export function currentOS(): OS {
  return isMac ? 'mac' : 'win';
}

const OS_NOW: OS = currentOS();

/** One row of the table: a spec in the shared grammar, and the system it is limited to, if any. */
interface Row {
  action: ActionId;
  spec: string;
  priority: Priority;
  extra: Partial<Binding>;
  only?: OS;
}

const row = (action: ActionId, spec: string, priority: Priority, extra: Partial<Binding> = {}): Row => ({ action, spec, priority, extra });
/** A row of the Windows map only. */
const win = (action: ActionId, spec: string, priority: Priority, extra: Partial<Binding> = {}): Row => ({ ...row(action, spec, priority, extra), only: 'win' });
/** A row of the macOS map only. */
const mac = (action: ActionId, spec: string, priority: Priority, extra: Partial<Binding> = {}): Row => ({ ...row(action, spec, priority, extra), only: 'mac' });

/** Other spellings of a key a macOS spec may use (a menu's or a rebind's); the table uses the first form. */
const MAC_KEY_ALIASES: Record<string, string> = {
  '.': 'Period',
  ',': 'Comma',
  BracketLeft: '[',
  BracketRight: ']',
  Esc: 'Escape',
  Return: 'Enter',
};

/** A spec as a Binding for one system ("Mod+T" is { ctrl } on Windows, { meta } on macOS). */
function parse(action: ActionId, spec: string, priority: Priority, os: OS, extra: Partial<Binding> = {}): Binding {
  const parts = spec.split('+');
  const raw = parts.pop() as string;
  const mod = parts.includes('Mod');
  return {
    action,
    key: os === 'mac' ? (MAC_KEY_ALIASES[raw] ?? raw) : raw,
    ctrl: parts.includes('Ctrl') || (mod && os === 'win'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    priority,
    ...(mod && os === 'mac' ? { meta: true } : {}),
    ...extra,
  };
}

// The order is the match order (the first binding that matches wins) and, per action, the order the
// keys are printed in: label() shows an action's first key, so a Mac row that must print first comes
// before the shared row it stands beside (⌃⌘F before F11, ⌘[ before ⌘←).
const ROWS: Row[] = [
  // Deer first: pages never get these.
  row('newTab', 'Mod+T', 'browser', { repeat: true }),
  row('closeTab', 'Mod+W', 'browser'),
  win('closeTab', 'Ctrl+F4', 'browser'),
  row('reopenClosed', 'Mod+Shift+T', 'browser'),
  row('newWindow', 'Mod+N', 'browser'),
  row('newPrivateWindow', 'Mod+Shift+N', 'browser'),
  row('closeWindow', 'Mod+Shift+W', 'browser'),
  // The switcher holds the physical Control key on both systems (⌘⇥ is the macOS app switcher).
  row('nextTabMru', 'Ctrl+Tab', 'browser', { repeat: true }),
  row('prevTabMru', 'Ctrl+Shift+Tab', 'browser', { repeat: true }),
  win('nextTab', 'Ctrl+PageDown', 'browser', { repeat: true }),
  win('prevTab', 'Ctrl+PageUp', 'browser', { repeat: true }),
  mac('nextTab', 'Mod+Shift+]', 'browser', { repeat: true }),
  mac('prevTab', 'Mod+Shift+[', 'browser', { repeat: true }),
  mac('nextTab', 'Mod+Alt+Right', 'browser', { repeat: true }),
  mac('prevTab', 'Mod+Alt+Left', 'browser', { repeat: true }),
  // ⌘Q asks first (browser.warnOnQuitShortcut, mac-keys.js); ⌘M is the yellow window button.
  mac('quit', 'Mod+Q', 'browser'),
  mac('minimize', 'Mod+M', 'browser'),
  row('focusAddress', 'F6', 'browser', { arg: 6 }),
  row('focusAddress', 'Shift+F6', 'browser', { arg: 6 }),
  row('back', 'BrowserBack', 'browser'),
  row('forward', 'BrowserForward', 'browser'),
  row('reload', 'BrowserRefresh', 'browser'),
  row('stop', 'BrowserStop', 'browser'),
  row('focusAddress', 'BrowserSearch', 'browser'),
  row('goHome', 'BrowserHome', 'browser'),

  // Page first: the site gets them before Deer.
  row('focusAddress', 'Mod+L', 'page'),
  // Option+D types a character on a Mac: no Mac twin.
  win('focusAddress', 'Alt+D', 'page'),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => row('goTab', `Mod+${n}`, 'page', { arg: n })),
  row('goLastTab', 'Mod+9', 'page'),
  // Physical Control on macOS too: ⌃⇧Page Up / Down (⌃⇧fn↑ / ↓ on a laptop).
  row('moveTabLeft', 'Ctrl+Shift+PageUp', 'page', { repeat: true }),
  row('moveTabRight', 'Ctrl+Shift+PageDown', 'page', { repeat: true }),
  mac('fullscreen', 'Mod+Ctrl+F', 'page'),
  // On macOS an unprinted alias (macOS usually takes F11 for Show Desktop).
  row('fullscreen', 'F11', 'page'),
  win('back', 'Alt+Left', 'page', { repeat: true }),
  win('forward', 'Alt+Right', 'page', { repeat: true }),
  mac('back', 'Mod+[', 'page', { repeat: true }),
  mac('forward', 'Mod+]', 'page', { repeat: true }),
  // Page first: in a text field ⌘← / ⌘→ move the caret, and the page keeps them.
  mac('back', 'Mod+Left', 'page', { repeat: true }),
  mac('forward', 'Mod+Right', 'page', { repeat: true }),
  row('reload', 'Mod+R', 'page'),
  win('reload', 'F5', 'page'),
  row('hardReload', 'Mod+Shift+R', 'page'),
  // Never ⌘F5 on a Mac: VoiceOver on or off.
  win('hardReload', 'Ctrl+F5', 'page'),
  win('hardReload', 'Shift+F5', 'page'),
  row('stop', 'Escape', 'page'),
  // ⌘. is Esc on a Mac: it stops loading and steps the Esc ladder (keys.ts treats it as Esc).
  mac('stop', 'Mod+Period', 'page'),
  row('zoomIn', 'Mod+Plus', 'page', { repeat: true, shift: 'any' }),
  row('zoomIn', 'Mod+Equal', 'page', { repeat: true, shift: 'any' }),
  row('zoomOut', 'Mod+Minus', 'page', { repeat: true }),
  row('zoomReset', 'Mod+0', 'page'),
  row('zoomReset', 'Mod+Num0', 'page'),
  win('devtools', 'F12', 'page'),
  win('devtools', 'Ctrl+Shift+I', 'page'),
  win('devtoolsConsole', 'Ctrl+Shift+J', 'page'),
  win('devtoolsInspect', 'Ctrl+Shift+C', 'page'),
  mac('devtools', 'Mod+Alt+I', 'page'),
  mac('devtoolsConsole', 'Mod+Alt+J', 'page'),
  // In the find field ⌥⌘C is Match case: the field takes it on keydown (find module).
  mac('devtoolsInspect', 'Mod+Alt+C', 'page'),
  row('print', 'Mod+P', 'page'),
  row('savePage', 'Mod+S', 'page'),
  win('viewSource', 'Ctrl+U', 'page'),
  mac('viewSource', 'Mod+Alt+U', 'page'),
  // ⌘H hides Deer on a Mac: History is ⌘Y there.
  win('history', 'Ctrl+H', 'page'),
  mac('history', 'Mod+Y', 'page'),
  row('find', 'Mod+F', 'page'),
  win('findNext', 'F3', 'page', { repeat: true }),
  win('findPrev', 'Shift+F3', 'page', { repeat: true }),
  row('findNext', 'Mod+G', 'page', { repeat: true }),
  row('findPrev', 'Mod+Shift+G', 'page', { repeat: true }),
  // Physical Control on macOS too (⌃Q): ⌘Q quits.
  row('peekLink', 'Ctrl+Q', 'page'),
  // With no peek open this does nothing: the page had the key first, and the address field takes
  // its own Alt+Enter on keydown.
  row('openAsTab', 'Alt+Enter', 'page'),
  win('downloads', 'Ctrl+J', 'page'),
  mac('downloads', 'Mod+Alt+L', 'page'),
  mac('downloads', 'Mod+Shift+J', 'page'),
  row('downloadVideo', 'Mod+Shift+D', 'page'),
  row('settings', 'Mod+Comma', 'page'),
  // On macOS also Help › Keyboard Shortcuts (fn F1 on a laptop).
  row('shortcutsHelp', 'F1', 'page'),
  win('clearData', 'Ctrl+Shift+Delete', 'page'),
  mac('clearData', 'Mod+Shift+Backspace', 'page'),
  row('switcherSearch', 'Mod+Shift+A', 'page'),
  // Split view (owner's decision 2026-10-20, ../design/SPLIT-VIEW-SPEC.md "Keys"): toggles it.
  // Page-first like Ctrl+Shift+A; ignores key repeat.
  row('splitView', 'Mod+Shift+U', 'page'),
];

/** The default bindings of one system, in match order: Windows is the map Deer has always had. */
export function bindingsFor(os: OS): Binding[] {
  return ROWS.filter((r) => !r.only || r.only === os).map((r) => parse(r.action, r.spec, r.priority, os, r.extra));
}

export const BINDINGS: Binding[] = bindingsFor(OS_NOW);

const DEFAULT_BINDINGS = BINDINGS.map((b) => ({ ...b }));
/** Only Deer's own verbs can be rebound (Settings › Keyboard shortcuts). */
export const REBINDABLE: ActionId[] = [...REBINDABLE_ACTIONS];

/** The default key of an action on one system, as a spec ("Ctrl+Q" for peekLink on both). */
export function defaultSpec(action: ActionId, os: OS = OS_NOW): string | null {
  const b = (os === OS_NOW ? DEFAULT_BINDINGS : bindingsFor(os)).find((x) => x.action === action);
  return b ? specOf(b) : null;
}

/** A key that types a character: Option with it is a character on a Mac, never a shortcut. */
const CHARACTER_CODE = /^(Key[A-Z]|Digit\d|Numpad(\d|Decimal|Add|Subtract|Multiply|Divide|Equal|Comma)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|IntlBackslash|IntlRo|IntlYen|Space)$/;
const CHARACTER_NAME = /^([A-Z0-9]|Num\d|Plus|Minus|Equal|Comma|Period|Space|.)$/;

/**
 * Why macOS keeps this spec from Deer, or null when Deer may bind it. The keys macOS, input
 * sources and VoiceOver own (design canvas MacKeys "Keys macOS owns"; mac port plan, section 5),
 * the app menu's ⌘H ⌥⌘H ⌘Q ⌘M, any ⌃⌥ chord and Option with a character key.
 */
export function macRefusal(spec: string): string | null {
  const parts = spec.split('+');
  const key = MAC_KEY_ALIASES[parts[parts.length - 1]] ?? parts[parts.length - 1];
  const mod = parts.includes('Mod');
  const ctrl = parts.includes('Ctrl') || parts.includes('MacCtrl');
  const alt = parts.includes('Alt');
  const shift = parts.includes('Shift');
  if (ctrl && alt) return 'is a VoiceOver key (⌃⌥)';
  if (alt && !ctrl && !mod && CHARACTER_NAME.test(key)) return 'types a character with Option';
  if (mod && (key === 'Tab' || key === '`' || key === 'Space')) return 'belongs to macOS (app switcher, windows, Spotlight)';
  if (ctrl && !mod && (key === 'Space' || /^[1-9]$/.test(key) || ['Left', 'Right', 'Up', 'Down'].includes(key))) return 'belongs to macOS (input sources, Spaces, Mission Control)';
  if (key === 'F11' || (mod && key === 'F5')) return 'belongs to macOS (Show Desktop, VoiceOver)';
  if (mod && shift && !ctrl && !alt && /^[3-6]$/.test(key)) return 'belongs to macOS (screenshots)';
  if (mod && key === 'Q' && (ctrl || shift)) return 'belongs to macOS (Lock Screen, Log Out)';
  if (mod && alt && (key === 'Escape' || key === 'D')) return 'belongs to macOS (Force Quit, the Dock)';
  if (mod && !ctrl && !shift && (key === 'Q' || key === 'H' || key === 'M') && (!alt || key === 'H')) return 'belongs to the Deer menu (Quit, Hide, Minimize)';
  return null;
}

/** Notes already written to the console, so a refused rebind is reported once per bundle. */
const noted = new Set<string>();

/** The spec a stored rebind binds on this system, or undefined when the action keeps its default. */
function usableRebind(action: ActionId, stored: string): string | undefined {
  const spec = rebindToSpec(stored, OS_NOW);
  if (OS_NOW !== 'mac') return spec;
  const why = macRefusal(spec);
  if (!why) return spec;
  const id = `${action}=${stored}`;
  if (!noted.has(id)) {
    noted.add(id);
    const keep = defaultSpec(action);
    console.warn(`Deer: the saved shortcut ${stored} for ${action} ${why} on macOS; ${action} keeps ${keep ? displaySpec(keep, 'mac') : 'its default'}.`);
  }
  return undefined;
}

/**
 * Apply Settings › Keyboard shortcuts, e.g. { peekLink: 'Ctrl+K' } (stored spelling, see the header).
 * The map is rebuilt first and swapped in whole: a value that is not a usable spec (VitreSettings
 * drops those already) keeps that action's default, and nothing can leave the map half built.
 */
export function applyRebind(rebind: Record<string, string> | undefined): void {
  const clean = cleanRebind(rebind);
  const next: Binding[] = [];
  for (const d of DEFAULT_BINDINGS) {
    const stored = REBINDABLE.includes(d.action) ? clean[d.action] : undefined;
    const spec = stored ? usableRebind(d.action, stored) : undefined;
    let binding: Binding = { ...d };
    if (spec) {
      try {
        binding = { ...parse(d.action, spec, d.priority, OS_NOW), arg: d.arg, repeat: d.repeat };
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
  // macOS: brackets and period by virtual key (DOM_VK_OPEN_BRACKET, DOM_VK_CLOSE_BRACKET, DOM_VK_PERIOD).
  if (OS_NOW === 'mac') {
    if (keyCode === 219) return '[';
    if (keyCode === 221) return ']';
    if (keyCode === 190) return 'Period';
  }
  switch (key) {
    case 'ArrowLeft': return 'Left';
    case 'ArrowRight': return 'Right';
    case 'ArrowUp': return 'Up';
    case 'ArrowDown': return 'Down';
    case 'Esc': return 'Escape';
  }
  return key;
}

/** The KeyInput for a DOM keydown, with the guards from the keys spike (IME; AltGraph off macOS). */
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
    // Option sets AltGraph on every Mac keydown it is held for: not a sign of composing there.
    composing: e.isComposing || e.keyCode === 229 || e.key === 'Process' || (OS_NOW !== 'mac' && e.getModifierState('AltGraph')),
  };
}

/** macOS: Option with a key that types (⌥C is ç, ⌥E starts an accent): a character, never a shortcut. */
function optionTypes(input: KeyInput): boolean {
  return input.alt && !input.ctrl && !input.meta && (CHARACTER_CODE.test(input.code) || input.key.length === 1 || input.key === 'Dead');
}

/**
 * The binding for a keydown, whatever its repeat state. The router uses this one: a repeat of a
 * key that ignores repeat must still be swallowed, or it would fall through to the page.
 * Guards (header): Windows refuses IME composition, AltGraph, the Windows key and Ctrl+Alt; macOS
 * refuses IME composition, ⌃⌥ and Option with a character key, and matches ⌘ as Mod.
 */
export function find(input: KeyInput, priority?: Priority): Binding | null {
  if (OS_NOW === 'mac' ? input.composing || (input.ctrl && input.alt) || optionTypes(input) : input.composing || input.meta || (input.ctrl && input.alt)) return null;
  const name = keyName(input.key, input.code, input.keyCode);
  for (const b of BINDINGS) {
    if (priority && b.priority !== priority) continue;
    if (b.key !== name) continue;
    if (!!b.ctrl !== input.ctrl) continue;
    if (!!b.alt !== input.alt) continue; // exact modifiers
    if (!!b.meta !== input.meta) continue;
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

/** "Ctrl+Shift+T" for a binding, in the spelling the design prints (macOS: "Mod+Shift+T", Mod being ⌘). */
export function specOf(b: Binding): string {
  return `${b.meta ? 'Mod+' : ''}${b.ctrl ? 'Ctrl+' : ''}${b.alt ? 'Alt+' : ''}${b.shift === true ? 'Shift+' : ''}${b.key}`;
}

/** Esc, or (macOS) ⌘.: the binding steps the Esc ladder. The router gives both Esc's rules. */
export function stepsEscLadder(b: Binding): boolean {
  return b.key === 'Escape' || (OS_NOW === 'mac' && b.action === 'stop' && b.key === 'Period' && !!b.meta);
}

/** A keydown that means Esc: Esc itself, or ⌘. on macOS (Cocoa's cancelOperation:). For Deer's own surfaces. */
export function isEscapeKey(e: KeyboardEvent): boolean {
  if (e.key === 'Escape' || e.key === 'Esc') return true;
  return OS_NOW === 'mac' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.keyCode === 190 || e.key === '.');
}

/**
 * The binding an action is printed with: its first key in the map (rebinds applied), hardware
 * browser keys left out; `arg` picks among goTab's keys (and F6's focusAddress(6) from Mod+L). With
 * `chord`, only a key held with Mod, Ctrl or Alt counts: a menu bar's key equivalent (Stop is ⌘.,
 * not Esc; Keyboard Shortcuts has none, F1 being a bare key).
 */
export function printedBinding(action: ActionId, arg?: number, chord = false): Binding | null {
  const all = BINDINGS.filter((b) => b.action === action && !b.key.startsWith('Browser'));
  const exact = all.filter((b) => b.arg === arg);
  const pool = exact.length ? exact : all;
  return (chord ? pool.find((b) => b.meta || b.ctrl || b.alt) : pool[0]) ?? null;
}

// ---- display ----

/** Windows key names as Deer prints them (Settings › Keyboard shortcuts, tooltips, menus). */
const WIN_KEYS: Record<string, string> = {
  Comma: ',',
  Plus: 'Plus',
  Minus: 'Minus',
  Equal: '=',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Escape: 'Esc',
  ' ': 'Space',
};

/** macOS key glyphs as menus print them (the Mac keymap canvas: ↩ ⇥ ⎋ ⌫, ⌘− with a minus sign). */
const MAC_KEYS: Record<string, string> = {
  Enter: '↩',
  Tab: '⇥',
  Escape: '⎋',
  Backspace: '⌫',
  Delete: '⌦',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  ' ': 'Space',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Comma: ',',
  Period: '.',
  Plus: '+',
  Minus: '−',
  Equal: '=',
  Num0: '0',
};

/** The same keys in words, for screen readers. */
const MAC_KEY_WORDS: Record<string, string> = {
  Enter: 'Return',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Delete',
  Delete: 'Forward Delete',
  Left: 'Left Arrow',
  Right: 'Right Arrow',
  Up: 'Up Arrow',
  Down: 'Down Arrow',
  ' ': 'Space',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Comma: 'Comma',
  Period: 'Period',
  Plus: 'Plus',
  Minus: 'Minus',
  Equal: 'Equals',
  Num0: '0',
  '[': 'Left Bracket',
  ']': 'Right Bracket',
};

/** The modifiers of a macOS spec in Apple's order ⌃⌥⇧⌘, and the key. "MacCtrl" (a stored rebind) is ⌃. */
function macParts(spec: string): { mods: ('ctrl' | 'alt' | 'shift' | 'mod')[]; key: string } {
  const parts = spec.split('+');
  const raw = parts.pop() ?? '';
  const key = MAC_KEY_ALIASES[raw] ?? raw;
  const mods: ('ctrl' | 'alt' | 'shift' | 'mod')[] = [];
  if (parts.includes('Ctrl') || parts.includes('MacCtrl')) mods.push('ctrl');
  if (parts.includes('Alt')) mods.push('alt');
  if (parts.includes('Shift')) mods.push('shift');
  if (parts.includes('Mod')) mods.push('mod');
  return { mods, key };
}

/**
 * A spec as printed on one system. Windows: today's text, "Ctrl+Shift+T", "Ctrl+,", "Esc" (Mod is
 * Ctrl). macOS: Apple glyphs in ⌃⌥⇧⌘ order, then the key, no "+": "⇧⌘T", "⌥⌘L", "⌃⇥", "⌘[", "⌥↩", "⇧⌘⌫".
 */
export function displaySpec(spec: string, os: OS): string {
  if (os === 'mac') {
    const { mods, key } = macParts(spec);
    const glyph = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' };
    return mods.map((m) => glyph[m]).join('') + (MAC_KEYS[key] ?? key);
  }
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  return [...parts.map((p) => (p === 'Mod' || p === 'MacCtrl' ? 'Ctrl' : p)), WIN_KEYS[key] ?? key].join('+');
}

/** A spec in words, for aria-label: macOS "Shift Command T"; Windows the printed text ("Ctrl+Shift+T"). */
export function ariaSpec(spec: string, os: OS): string {
  if (os !== 'mac') return displaySpec(spec, os);
  const { mods, key } = macParts(spec);
  const word = { ctrl: 'Control', alt: 'Option', shift: 'Shift', mod: 'Command' };
  return [...mods.map((m) => word[m]), MAC_KEY_WORDS[key] ?? key].join(' ');
}

/**
 * The spec of a keydown, in the table's grammar, for Settings' shortcut capture: modifiers then
 * keyName(). Windows "Ctrl+Alt+Shift+K" as before; macOS ⌘ is "Mod" and ⌃ is "Ctrl". Store it with
 * settings.ts specToRebind(). Null for a modifier alone.
 */
export function eventSpec(e: KeyboardEvent, os: OS = OS_NOW): string | null {
  if (['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'CapsLock'].includes(e.key)) return null;
  let key = keyName(e.key, e.code, e.keyCode);
  if (key === ' ') key = 'Space';
  if (e.code === 'Escape') key = 'Escape';
  const mods: string[] = [];
  if (os === 'mac' && e.metaKey) mods.push('Mod');
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}
