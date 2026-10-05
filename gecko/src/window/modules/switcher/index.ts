// Tab switcher: Ctrl+Tab held or latched, in the deck (default), grid or strip style
// (settings.switcherStyle), and Ctrl+Shift+A to open it with search.
// Design: DESIGN-NOTES "Tab switching", keymap.json "Tab switcher", boards TabSwitcher, TabMotion,
// TabOverview, TabSearch, TabSwitcherStrip, SwitcherKeys. Electron reference:
// app/src/renderer/modules/switcher/*, app/src/main/modules/switcher.ts. Gecko recipe:
// spikes/switcher/RESULT.md (thumbnails, discard capture, MRU, Ctrl+Tab takeover).
//
// Files: controller.ts (state machine and keys), thumbs.ts (pictures), deck.ts / grid.ts / strip.ts
// (the three views), parts.ts, search.ts, styles.ts, wallpaper.ts (the deck's background), gecko.ts
// (Firefox internals), src/modules/VitreSwitcher.sys.ts (thumbnails on disk, Sticky Keys).
//
// Contract for other modules (b.service('switcher'), types below):
//   open(mode?)   'cycle'   as Ctrl+Tab: held while Ctrl is down (release opens the selected card),
//                           latched otherwise;
//                 'latched' (default) open latched with the previous tab selected (Enter opens,
//                           Esc cancels, a click picks);
//                 'search'  as Ctrl+Shift+A: latched, the current tab selected, the field ready.
//   isOpen()      the switcher is up (also during the 150 ms before a held switcher shows).
//   close()       (addition) cancel it as Esc does: back to the tab it started on (another surface
//                 that must be seen, e.g. the downloads quit prompt, clears the way first).
// Actions it registers: nextTabMru, prevTabMru (Ctrl+Tab, Ctrl+Shift+Tab), switcherSearch.
// Ladders: Esc layer and Ctrl+W close layer at 40 (latched switcher).
// Core hooks it relies on: b.keys.addHook (it takes the keyboard while up), 'ctrl-up' with its
// reason ('blur' cancels), fx.guardTabSwitchFocus, b.holdTheme (the deck and grid hold 'clear').
// Classes on #vitre-root while it is up: vitre-switcher-grid (Grid), vitre-switcher-cover (Deck and
// Grid: the bar's layer is lifted just above the switcher's, the tab bar in it hidden and click-through,
// so the window controls sit on the switcher's surface where Windows hit-tests them; styles.ts).
// Closing a card whose page would ask "Leave page?" opens that tab first and closes it there, where
// Firefox shows the prompt (controller.ts closeCard).
// Diagnostics: window.vitreSwitcher = { state(), timing, thumbs } (chrome only; tests/switcher).
import type { Browser } from '../../browser';
import { Switcher, type OpenMode } from './controller';
import { CSS } from './styles';
import { Thumbs } from './thumbs';
import { Wallpaper } from './wallpaper';

export interface SwitcherApi {
  open(mode?: OpenMode): void;
  isOpen(): boolean;
  /** Addition: cancel as Esc does (back to the tab it started on); nothing when it is not up. */
  close?(): void;
}

declare global {
  interface VitreServices {
    switcher: SwitcherApi;
  }
  interface VitreSysModules {
    VitreSwitcher: typeof import('../../../modules/VitreSwitcher.sys').VitreSwitcher;
  }
  interface Window {
    vitreSwitcher?: { state: () => unknown; readonly timing: unknown; thumbs: Thumbs };
  }
}

export function install(b: Browser): void {
  b.css('switcher', CSS);
  const thumbs = new Thumbs(b);
  const switcher = new Switcher(b, thumbs, new Wallpaper(b, thumbs));
  b.provide('switcher', {
    open: (mode?: OpenMode) => switcher.open(mode),
    isOpen: () => switcher.isOpen(),
    close: () => switcher.dismiss(),
  });
  window.vitreSwitcher = {
    state: () => switcher.state(),
    get timing() {
      return switcher.timing;
    },
    thumbs,
  };
}
