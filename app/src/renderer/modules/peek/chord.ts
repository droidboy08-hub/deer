// "Open as tab" is one of Vitre's rebindable verbs (Settings › Keyboard shortcuts stores it in
// settings.rebind.openAsTab as a spec such as 'Alt+Enter'). Parsed once here; the peek's page
// module receives the parsed chord.
import { keyName } from '../../../shared/shortcuts';

export interface Chord {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

export const OPEN_AS_TAB = 'Alt+Enter';

export function parseChord(spec: string): Chord {
  const parts = spec.split('+');
  const key = parts.pop() || 'Enter';
  return { key, ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
}

export function isChord(e: KeyboardEvent, c: Chord): boolean {
  if (e.metaKey || e.isComposing || e.keyCode === 229) return false;
  return keyName(e.key, e.code) === c.key && e.ctrlKey === c.ctrl && e.shiftKey === c.shift && e.altKey === c.alt;
}
