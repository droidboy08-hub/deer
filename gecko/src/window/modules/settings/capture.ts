// Rebinding a key: turn a keydown into a spec and say why a key is refused, in one line.
// Rules from design/keymap.json (reserved keys, routing rules and the customization notes).
// Ported from app/src/renderer/modules/settings/capture.ts. Gecko: the key name comes from
// shortcuts.ts keyName(key, code, keyCode), the same function the key router matches with, so a
// key captured here is exactly the key the router will run (letters by virtual key on any layout).
//
// macOS (MacKeys board, "Keys macOS owns"): ⌘ is captured as Mod, the Control key as Ctrl, Option as
// Alt, in the spec grammar [Mod+][Ctrl+][Alt+][Shift+]Key. Refused with the reason: the app switcher
// (⌘⇥, ⌘`), Spotlight and input sources (⌘Space, ⌃Space...), Mission Control and Spaces (⌃←→↑↓,
// ⌃1–⌃9, F11), screenshots (⇧⌘3/4/5), Lock Screen, Log Out, Force Quit and the Dock (⌃⌘Q, ⇧⌘Q,
// ⌥⌘⎋, ⌥⌘D), VoiceOver (any ⌃⌥ chord, ⌘F5), Zoom and keyboard navigation (⌥⌘8/=/−/\, ⌥⌘F5,
// ⌃F1–⌃F8) and Option with a character key (it types one: ⌥C is ç). The Windows-only rules (Task
// Manager, Start, Alt+Tab, the input language, Pinyin, the Japanese IME, NVIDIA and Radeon) are not
// applied there. Keys Deer's Mac map uses (keymap.ts KEY_GROUPS_MAC, ⌘Q, ⌘H, ⌘M included) are
// refused as "Already used by". Last, shortcuts.ts macRefusal: whatever the key router would not bind
// on a Mac from a stored rebind is never saved here either.
import { isMac } from '../../../shared/os';
import { keyName, macRefusal } from '../../../shared/shortcuts';
import { KEY_GROUPS, REBINDABLE, SPEC_TOKEN, currentSpec, displaySpec, fillKeys, keyGroups, type RebindId } from './keymap';

export type CaptureResult =
  | { kind: 'partial'; text: string }
  | { kind: 'ignore' }
  | { kind: 'refuse'; spec: string; reason: string }
  | { kind: 'ok'; spec: string; warning?: string };

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock']);
const LAYOUT_KEYS = new Set(['Backquote', 'BracketLeft', 'BracketRight', 'Slash', 'Backslash', 'Semicolon', 'Quote', 'Period', 'IntlBackslash']);
const NAV_KEYS = new Set(['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Enter', 'Tab', 'Backspace', 'Delete', 'Plus', 'Minus', 'Equal', 'Comma']);
const NVIDIA = new Set(['Alt+Z', 'Alt+R', 'Alt+F1', 'Alt+F2', 'Alt+F3', 'Alt+F9', 'Alt+F10']);
const RADEON = new Set(['Ctrl+Shift+O', 'Ctrl+Shift+L', 'Ctrl+Shift+S', 'Ctrl+Shift+E']);
const PAGE_KEYS: Record<string, string> = {
  'Ctrl+K': 'Slack, GitHub and Notion use Ctrl+K; sites get it first.',
  'Ctrl+E': 'Many sites use Ctrl+E; they get it first.',
  'Ctrl+D': 'Many sites use Ctrl+D; they get it first.',
};

const isLetter = (k: string): boolean => /^[A-Z]$/.test(k);
const isDigit = (k: string): boolean => /^\d$/.test(k);
const isFKey = (k: string): boolean => /^F([1-9]|1\d|2[0-4])$/.test(k);

function modifiers(e: KeyboardEvent): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  return m;
}

/** Spec back from printed text: 'Page Down' -> 'PageDown', ',' -> 'Comma', 'Esc' -> 'Escape'. */
function parsePrinted(text: string): string | null {
  const t = text.trim();
  if (!t || /click|Mouse|Release|…|Menu key|Esc Esc/.test(t)) return null;
  const parts = t.split('+');
  let key = parts.pop() ?? '';
  key = ({ 'Page Down': 'PageDown', 'Page Up': 'PageUp', ',': 'Comma', '=': 'Equal', Esc: 'Escape' } as Record<string, string>)[key] ?? key;
  if (!key) return null;
  return [...parts, key].join('+');
}

/** Every key Deer already uses, with the command that uses it. */
export function usedKeys(rebind: Record<string, string>): Map<string, { label: string; rebind?: RebindId }> {
  if (isMac) return usedKeysMac(rebind);
  const used = new Map<string, { label: string; rebind?: RebindId }>();
  for (const g of KEY_GROUPS) {
    for (const r of g.rows) {
      const texts = [fillKeys(r.keys, rebind), ...(r.alt ? fillKeys(r.alt, rebind).split(', ') : [])];
      for (const text of texts) {
        const spec = parsePrinted(text);
        if (spec && !used.has(spec)) used.set(spec, { label: r.label, rebind: r.rebind });
      }
    }
  }
  for (let n = 1; n <= 8; n++) used.set(`Ctrl+${n}`, { label: 'Go to tab 1 to 8' });
  for (const id of Object.keys(REBINDABLE) as RebindId[]) {
    used.set(currentSpec(id, rebind), { label: REBINDABLE[id].label, rebind: id });
  }
  return used;
}

/**
 * Another command that uses the key `id` has now (two rebinds set to one key through about:config,
 * or a key the map gained later). Null when the key is its own.
 */
export function conflictFor(id: RebindId, rebind: Record<string, string>): string | null {
  if (isMac) return conflictForMac(id, rebind);
  const spec = currentSpec(id, rebind);
  for (const other of Object.keys(REBINDABLE) as RebindId[]) {
    if (other !== id && currentSpec(other, rebind) === spec) return REBINDABLE[other].label;
  }
  for (const g of KEY_GROUPS) {
    for (const r of g.rows) {
      if (r.rebind || r.where) continue; // a verb's own rows; keys local to one surface do not collide
      const texts = [r.keys, ...(r.alt ? r.alt.split(', ') : [])].filter((t) => !/\{\w+\}/.test(t));
      if (texts.some((t) => parsePrinted(t) === spec)) return r.label;
    }
  }
  return null;
}

/** Read one keydown while capturing a new key for `id`. */
export function readCapture(e: KeyboardEvent, id: RebindId, rebind: Record<string, string>): CaptureResult {
  if (isMac) return readCaptureMac(e, id, rebind);
  if (e.isComposing || e.keyCode === 229) return { kind: 'ignore' };
  if (e.metaKey || e.key === 'Meta' || e.key === 'OS') return { kind: 'refuse', spec: 'Win', reason: 'Win keys belong to Windows.' };
  const mods = modifiers(e);
  if (MODIFIERS.has(e.key)) return { kind: 'partial', text: mods.length ? `${mods.join('+')}+` : '' };

  let key = keyName(e.key, e.code, e.keyCode);
  if (key === ' ') key = 'Space';
  if (e.code === 'Escape' || key === 'Escape') key = 'Escape';
  const spec = [...mods, key].join('+');
  const printed = displaySpec(spec);
  const refuse = (reason: string): CaptureResult => ({ kind: 'refuse', spec, reason: `${reason} Try another key.` });
  const ctrl = e.ctrlKey;
  const alt = e.altKey;
  const shift = e.shiftKey;

  // Windows, input methods and accessibility come first.
  if (key === 'Escape' && ctrl) return refuse(shift ? 'Ctrl+Shift+Esc opens Task Manager.' : 'Ctrl+Esc opens Start.');
  if (key === 'Escape' && alt) return refuse('Windows uses Alt+Esc to switch windows.');
  if (ctrl && alt) return refuse('Ctrl+Alt types characters on many keyboards.');
  if (alt && key === 'Tab') return refuse('Windows uses Alt+Tab to switch windows.');
  if (alt && key === 'Space') return refuse('Alt+Space opens the window menu.');
  if (alt && key === 'F4') return refuse('Alt+F4 closes the window.');
  if (key === 'PrintScreen') return refuse('Windows uses Print Screen.');
  if ((ctrl || alt) && shift && /^Digit\d$/.test(e.code)) return refuse(`Windows uses ${printed} to switch input language.`);
  if (key === 'Space') return refuse(ctrl ? 'Input methods use Ctrl+Space.' : shift ? 'Input methods use Shift+Space.' : 'Space scrolls the page and types.');
  if (ctrl && e.code === 'Period') return refuse('Input methods use Ctrl+period.');
  if (ctrl && shift && (key === 'F' || key === 'B')) return refuse(`Microsoft Pinyin uses ${printed}.`);
  if (ctrl && shift && key === 'F10') return refuse('The Japanese input method uses Ctrl+Shift+F10.');
  if (ctrl && LAYOUT_KEYS.has(e.code)) return refuse('This key moves between keyboard layouts.');

  // Only letters, digits, function keys and a few named keys carry shortcuts.
  if (!isLetter(key) && !isDigit(key) && !isFKey(key) && !NAV_KEYS.has(key)) return refuse('Use a letter, a digit or a function key.');
  if (!ctrl && !alt && !isFKey(key)) {
    if (shift && (isLetter(key) || isDigit(key) || ['Plus', 'Minus', 'Equal', 'Comma'].includes(key))) return refuse('Types a character.');
    if (isLetter(key) || isDigit(key)) return refuse('Single keys type text. Add Ctrl or Alt.');
    return refuse('Pages need this key. Add Ctrl or Alt.');
  }
  if (!ctrl && !alt && key === 'F7') return refuse('Pages keep F7 for caret browsing.');
  if (!ctrl && !alt && key === 'F10') return refuse('F10 belongs to menus.');
  if (NVIDIA.has(spec)) return refuse(`The NVIDIA overlay uses ${printed}.`);
  if (alt && !ctrl && isLetter(key)) return refuse('Pages use Alt+letter for access keys.');
  if (spec === 'Ctrl+Shift+N') return refuse('Ctrl+Shift+N is kept for a private window.');
  if (spec === 'Alt+Home') return refuse('Pages use Alt+Home.');

  const owner = usedKeys(rebind).get(spec);
  if (owner && owner.rebind !== id) return refuse(`Already used by ${owner.label}.`);
  if (RADEON.has(spec)) return { kind: 'ok', spec, warning: 'Radeon Software may use this on some PCs.' };
  if (PAGE_KEYS[spec]) return { kind: 'ok', spec, warning: PAGE_KEYS[spec] };
  return { kind: 'ok', spec };
}

// ---- macOS ----

const MAC_MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'];
/** Spellings of one key, as the specs of the map and keyName() may write it, to one name. */
const KEY_ALIAS: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Period: '.', ',': 'Comma', '=': 'Equal', '+': 'Plus', '-': 'Minus', Esc: 'Escape', Del: 'Delete', ' ': 'Space' };

/**
 * One spelling of a spec, for comparing: modifiers in grammar order (Mod, Ctrl, Alt, Shift), the
 * key's other names folded ("Mod+Shift+BracketRight" and "Shift+Mod+]" are one key).
 */
export function canonSpec(spec: string): string {
  const parts = spec.split('+');
  let key = parts.pop() ?? '';
  if (!key && spec.endsWith('+')) key = 'Plus';
  key = KEY_ALIAS[key] ?? (/^[a-z]$/.test(key) ? key.toUpperCase() : key);
  return [...MAC_MODIFIER_ORDER.filter((m) => parts.includes(m)), key].join('+');
}

/** The `<spec>` chords in a line of the Mac map. */
const specsIn = (text: string): string[] => [...text.matchAll(SPEC_TOKEN)].map((m) => m[1]);

/** The keys of every row of the Mac map, the rebindable verbs' current keys and ⌘1–⌘8 (keyed by canonSpec). */
function usedKeysMac(rebind: Record<string, string>): Map<string, { label: string; rebind?: RebindId }> {
  const used = new Map<string, { label: string; rebind?: RebindId }>();
  for (const g of keyGroups()) {
    for (const r of g.rows) {
      const label = fillKeys(r.label, rebind);
      for (const spec of specsIn(`${r.keys} ${r.alt ?? ''}`)) {
        const k = canonSpec(spec);
        if (!used.has(k)) used.set(k, { label, rebind: r.rebind });
      }
    }
  }
  for (let n = 1; n <= 8; n++) used.set(canonSpec(`Mod+${n}`), { label: 'Go to tab 1 to 8' });
  for (const id of Object.keys(REBINDABLE) as RebindId[]) {
    used.set(canonSpec(currentSpec(id, rebind)), { label: REBINDABLE[id].label, rebind: id });
  }
  return used;
}

function conflictForMac(id: RebindId, rebind: Record<string, string>): string | null {
  const spec = canonSpec(currentSpec(id, rebind));
  for (const other of Object.keys(REBINDABLE) as RebindId[]) {
    if (other !== id && canonSpec(currentSpec(other, rebind)) === spec) return REBINDABLE[other].label;
  }
  for (const g of keyGroups()) {
    for (const r of g.rows) {
      if (r.rebind || r.where) continue; // a verb's own rows; keys local to one surface do not collide
      if (specsIn(`${r.keys} ${r.alt ?? ''}`).some((t) => canonSpec(t) === spec)) return fillKeys(r.label, rebind);
    }
  }
  return null;
}

/** ⌘ ⌃ ⌥ ⇧ held, as a spec's modifiers (Mod is ⌘, Ctrl the Control key, Alt is Option). */
function macModifiers(e: KeyboardEvent): string[] {
  const m: string[] = [];
  if (e.metaKey) m.push('Mod');
  if (e.ctrlKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  return m;
}

/** The modifiers held so far, as the field shows them before a key comes: ⌃⌥⇧⌘ order, no "+". */
function heldGlyphs(e: KeyboardEvent): string {
  return (e.ctrlKey ? '⌃' : '') + (e.altKey ? '⌥' : '') + (e.shiftKey ? '⇧' : '') + (e.metaKey ? '⌘' : '');
}

/** Sites that use these ⌘ keys themselves (the Mac's Ctrl+K, Ctrl+E, Ctrl+D). */
const PAGE_KEYS_MAC: Record<string, string> = {
  'Mod+K': 'Slack, GitHub and Notion use {key}; sites get it first.',
  'Mod+E': 'Many sites use {key}; they get it first.',
  'Mod+D': 'Many sites use {key}; they get it first.',
};

/** Keys that type a character: with ⌥ (and maybe ⇧) alone they type one on a Mac (⌥C is ç, ⌥2 is ™). */
const typesCharacter = (key: string, code: string): boolean =>
  isLetter(key) || isDigit(key) || ['Plus', 'Minus', 'Equal', 'Comma'].includes(key) || LAYOUT_KEYS.has(code) || /^(Key[A-Z]|Digit\d|Minus|Equal|Comma)$/.test(code);

function readCaptureMac(e: KeyboardEvent, id: RebindId, rebind: Record<string, string>): CaptureResult {
  if (e.isComposing || e.keyCode === 229) return { kind: 'ignore' };
  // fn / Globe chords belong to macOS; fn on its own is a modifier here.
  if (MODIFIERS.has(e.key) || e.key === 'Fn' || e.key === 'FnLock') return { kind: 'partial', text: heldGlyphs(e) };

  let key = keyName(e.key, e.code, e.keyCode);
  if (key === ' ') key = 'Space';
  if (e.code === 'Escape' || key === 'Escape') key = 'Escape';
  const spec = [...macModifiers(e), key].join('+');
  const canon = canonSpec(spec);
  const printed = displaySpec(spec);
  const p = (s: string): string => displaySpec(s);
  const refuse = (reason: string): CaptureResult => ({ kind: 'refuse', spec, reason: `${reason} Try another key.` });
  const cmd = e.metaKey;
  const ctrl = e.ctrlKey;
  const alt = e.altKey;
  const shift = e.shiftKey;
  const arrows = ['Left', 'Right', 'Up', 'Down'];

  // macOS, input sources and VoiceOver come first (MacKeys board, "Keys macOS owns").
  if (ctrl && alt) return refuse('VoiceOver uses every chord that holds ⌃ and ⌥.');
  if (cmd && key === 'Tab') return refuse(`macOS uses ${p('Mod+Tab')} to switch apps.`);
  if (cmd && !ctrl && !alt && (e.code === 'Backquote' || key === '`')) return refuse(`macOS uses ${printed} to move between windows.`);
  if (key === 'Space') {
    if (cmd && alt) return refuse(`Finder uses ${printed} to search.`);
    if (cmd && ctrl) return refuse(`macOS uses ${printed} for the Character Viewer.`);
    if (cmd) return refuse(`Spotlight uses ${printed}.`);
    if (ctrl) return refuse(`Input sources use ${printed}.`);
    return refuse('Space scrolls the page and types.');
  }
  if (ctrl && !cmd && arrows.includes(key)) return refuse(`Mission Control uses ${p(`Ctrl+${key}`)}.`);
  if (ctrl && !cmd && /^[1-9]$/.test(key)) return refuse(`macOS uses ${p(`Ctrl+${key}`)} to switch desktops.`);
  if (key === 'F11') return refuse(`macOS uses ${p('F11')} to show the desktop.`);
  if (cmd && shift && !ctrl && !alt && /^[3-6]$/.test(key)) return refuse(`Screenshots use ${printed}.`);
  if (cmd && key === 'Q' && ctrl) return refuse(`${p('Mod+Ctrl+Q')} locks the screen.`);
  if (cmd && key === 'Q' && shift) return refuse(`${p('Mod+Shift+Q')} logs out.`);
  if (cmd && alt && key === 'Escape') return refuse(`${p('Mod+Alt+Escape')} opens Force Quit.`);
  if (cmd && alt && key === 'D') return refuse(`${p('Mod+Alt+D')} shows or hides the Dock.`);
  if (cmd && key === 'F5') return refuse(alt ? `${p('Mod+Alt+F5')} opens Accessibility Shortcuts.` : `${p('Mod+F5')} turns VoiceOver on or off.`);
  if (cmd && alt && !ctrl && !shift && (['Digit8', 'Equal', 'Minus', 'Backslash'].includes(e.code) || ['8', 'Equal', 'Plus', 'Minus'].includes(key))) return refuse(`Zoom uses ${printed}.`);
  if (ctrl && !cmd && !alt && !shift && /^F[1-8]$/.test(key)) return refuse(`macOS uses ${printed} for keyboard navigation.`);
  if (alt && !cmd && !ctrl && typesCharacter(key, e.code)) return refuse(`${printed} types a character.`);

  // Only letters, digits, function keys and a few named keys carry shortcuts.
  if (!isLetter(key) && !isDigit(key) && !isFKey(key) && !NAV_KEYS.has(key)) return refuse('Use a letter, a digit or a function key.');
  if (!cmd && !ctrl && !alt && !isFKey(key)) {
    if (shift && (isLetter(key) || isDigit(key) || ['Plus', 'Minus', 'Equal', 'Comma'].includes(key))) return refuse('Types a character.');
    if (isLetter(key) || isDigit(key)) return refuse('Single keys type text. Add ⌘ or ⌃.');
    return refuse('Pages need this key. Add ⌘ or ⌃.');
  }
  if (!cmd && !ctrl && !alt && key === 'F7') return refuse('Pages keep F7 for caret browsing.');

  const owner = usedKeysMac(rebind).get(canon);
  if (owner && owner.rebind !== id) return refuse(`Already used by ${owner.label}.`);
  const why = macRefusal(spec);
  if (why) return refuse(`${printed} ${why}.`);
  const warning = PAGE_KEYS_MAC[canon];
  if (warning) return { kind: 'ok', spec, warning: warning.replace('{key}', printed) };
  return { kind: 'ok', spec };
}
