// Rebinding a key: turn a keydown into a spec and say why a key is refused, in one line.
// Rules from design/keymap.json (reserved keys, routing rules and the customization notes).
import { keyName } from '../../../shared/shortcuts';
import { KEY_GROUPS, REBINDABLE, currentSpec, displaySpec, fillKeys, type RebindId } from './keymap';

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

const isLetter = (k: string) => /^[A-Z]$/.test(k);
const isDigit = (k: string) => /^\d$/.test(k);
const isFKey = (k: string) => /^F([1-9]|1\d|2[0-4])$/.test(k);

function modifiers(e: KeyboardEvent): string[] {
  const m: string[] = [];
  if (e.ctrlKey) m.push('Ctrl');
  if (e.altKey) m.push('Alt');
  if (e.shiftKey) m.push('Shift');
  return m;
}

/** Spec back from printed text: 'Page Down' → 'PageDown', ',' → 'Comma', 'Esc' → 'Escape'. */
function parsePrinted(text: string): string | null {
  const t = text.trim();
  if (!t || /click|Mouse|Release|…|Menu key|Esc Esc/.test(t)) return null;
  const parts = t.split('+');
  let key = parts.pop() ?? '';
  key = { 'Page Down': 'PageDown', 'Page Up': 'PageUp', ',': 'Comma', '=': 'Equal', Esc: 'Escape' }[key] ?? key;
  if (!key) return null;
  return [...parts, key].join('+');
}

/** Every key Vitre already uses, with the command that uses it. */
export function usedKeys(rebind: Record<string, string>): Map<string, { label: string; rebind?: RebindId }> {
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

/** Read one keydown while capturing a new key for `id`. */
export function readCapture(e: KeyboardEvent, id: RebindId, rebind: Record<string, string>): CaptureResult {
  if (e.isComposing || e.keyCode === 229) return { kind: 'ignore' };
  if (e.metaKey || e.key === 'Meta' || e.key === 'OS') return { kind: 'refuse', spec: 'Win', reason: 'Win keys belong to Windows.' };
  const mods = modifiers(e);
  if (MODIFIERS.has(e.key)) return { kind: 'partial', text: mods.length ? `${mods.join('+')}+` : '' };

  let key = keyName(e.key, e.code);
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
