// Tab switcher: Ctrl+Tab held or latched, in the deck (default), grid or strip style, and
// Ctrl+Shift+A to open it with search. Design: DESIGN-NOTES "Tab switching", keymap.json
// "Tab switcher", boards TabSwitcher, TabMotion, TabOverview, TabSearch, TabSwitcherStrip, SwitcherKeys.
import type { Browser } from '../../app';
import { Switcher } from './controller';
import { CSS } from './styles';
import { Thumbs } from './thumbs';

export function install(b: Browser): void {
  b.css('switcher', CSS);
  new Switcher(b, new Thumbs(b));
}
