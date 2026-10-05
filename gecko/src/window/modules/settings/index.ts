// Settings: the floating Settings panel (Ctrl+, and the 'settings' action), Keyboard shortcuts (F1,
// 'shortcutsHelp'), Clear browsing data (Ctrl+Shift+Delete, 'clearData'), and Home's background
// (the circle and popover on Home, and Settings › Home and background).
// Ported from app/src/renderer/modules/settings/*; the Gecko recipe is spikes/switcher/RESULT.md
// sections 5-7 (vitre.* prefs, nsIFilePicker, Sanitizer with time ranges).
//
// Service 'settings' (b.service('settings'), types below):
//   open(pageId?, query?)   open Settings (or move it) to a page: 'general' | 'appearance' | 'home' |
//                           'tabs' | 'downloads' | 'privacy' | 'search' | 'shortcuts' | 'about' or a
//                           registered page's id; `query` fills "Find a setting" and shows its results.
//                           Unknown ids open the page Settings was last on.
//   registerPage(page)      add a page to the sidebar: { id, title, icon?, order, render(host),
//                           keywords? }. Returns a function that removes it.
//                             order    built-in pages are 10 General, 20 Appearance, 30 Home and
//                                      background, 40 Tabs, 50 Downloads, 60 Privacy and security,
//                                      70 Search engine, 80 Keyboard shortcuts, 90 About Deer;
//                                      e.g. 55 puts a page between Downloads and Privacy.
//                             icon     SVG markup (static, trusted; 20x20 viewBox drawn at 18 px,
//                                      stroke="currentColor"), or a chrome:/data:/moz-extension:
//                                      image URL. A puzzle-piece outline when left out.
//                             render   called each time the page comes on screen, with a host
//                                      element under the page's title (Settings draws the 26 px h1);
//                                      return the clean-up to run when it leaves the screen. Build
//                                      with createElement; for the panel's look use its classes:
//                                      h2.vs-h2 (group heading), div.vs-card (card) holding
//                                      div.vs-row[.has-ico] > span.vs-ico + div.vs-text >
//                                      (span.vs-title + span.vs-desc) + control, controls
//                                      button.vs-btn[.accent|.subtle], button.vs-link,
//                                      button.vs-switch[role=switch][aria-checked] > span.vs-knob,
//                                      span.vs-key (a key as plain dim text), p.vs-intro (dim text).
//                             keywords "Find a setting" finds the page by its title and these words
//                                      and offers to open it.
//   isOpen(), close()       (additions) the panel's state.
//   changeBackground()      (addition) "Change background…": Home's Background popover when Home is
//                           showing, otherwise Settings › Home and background. For the menus module's
//                           Home wallpaper menu.
//
// Popup windows (b.isPopup) never show the panel: the actions and open() / changeBackground() go
// to the most recent normal window, which comes to the front (a 420 px popup would scale the sheet
// to 40 %).
//
// Actions: 'settings' toggles the panel; 'shortcutsHelp' (F1) opens Keyboard shortcuts;
// 'clearData' (Ctrl+Shift+Delete) opens Privacy at Clear browsing data with the first control
// focused. Ctrl+F (and F3, Ctrl+G) with the panel open focuses "Find a setting" (the core sends the
// find keys to an open panel as 'vitre:panel-find', browser.ts run()).
// Every change is written to VitreSettings at once; every window hears it (b.on('settings')) and the
// core applies it live (theme, bar auto-hide, close buttons, new tab position, search engine,
// rebinds); feature settings (switcher style, downloads, Shift+click, selection search) are read by
// their own modules.
//
// State for tests: window.vitreSettingsPanel = { panel, home, bg } (the instances).
import type { Browser } from '../../browser';
import * as fx from '../../firefox';
import { HomeBackground } from './background';
import type { SectionDef } from './controls';
import { HomeButton } from './home-button';
import { nav } from './icons';
import { SettingsPanel } from './panel';
import { CSS } from './styles';

/** A page another module adds to Settings (registerPage). */
export interface SettingsPage {
  id: string;
  title: string;
  /** SVG markup, or a chrome:/data:/moz-extension: image URL. */
  icon?: string;
  order: number;
  render(host: HTMLElement): () => void;
  /** Extra words "Find a setting" matches (the title always does). */
  keywords?: string;
}

export interface SettingsApi {
  open(pageId?: string, query?: string): void;
  registerPage(page: SettingsPage): () => void;
  isOpen(): boolean;
  close(): void;
  changeBackground(): void;
}

declare global {
  interface VitreServices {
    settings: SettingsApi;
  }
}

/** A registered page's icon as SVG markup: markup as given, an image URL wrapped in an SVG <image>. */
function pageIcon(icon: string | undefined): string {
  if (!icon) return nav.generic;
  if (/^\s*<svg[\s>]/.test(icon)) return icon;
  if (/^(chrome|data|moz-extension|resource):/i.test(icon)) {
    // An image URL: drawn through an SVG <image> so every icon goes through the same path.
    const href = icon.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><image width="18" height="18" href="${href}"/></svg>`;
  }
  return nav.generic;
}

export function install(b: Browser): void {
  b.css('settings', CSS);
  const bg = new HomeBackground(b);
  const panel = new SettingsPanel(b, bg);
  const home = new HomeButton(b, bg);
  (window as any).vitreSettingsPanel = { panel, home, bg };

  /**
   * A popup window (window.open with features, b.isPopup) is far too small for the 960x688 sheet:
   * Settings opens in the most recent normal window instead, which comes to the front (as the
   * core's newTab does from a popup). True when it went there; with no normal window it opens here.
   */
  const elsewhere = (run: (other: Browser) => void): boolean => {
    if (!b.isPopup) return false;
    const win = fx.topBrowserWindow(b.isPrivate) ?? fx.topBrowserWindow(!b.isPrivate);
    const other = win && win !== window ? (win as Window).vitre : undefined;
    if (!other || other.isPopup || !other.service('settings')) return false;
    run(other);
    win!.focus();
    return true;
  };

  b.registerAction('settings', () => {
    if (!elsewhere((o) => o.service('settings')!.open())) panel.toggle();
  });
  b.registerAction('shortcutsHelp', () => {
    if (!elsewhere((o) => o.run('shortcutsHelp'))) panel.show('shortcuts');
  });
  b.registerAction('clearData', () => {
    if (!elsewhere((o) => o.run('clearData'))) panel.show('privacy', 'clear');
  });

  const changeBackground = (): void => {
    if (elsewhere((o) => o.service('settings')!.changeBackground())) return;
    // The popover belongs to Home; anywhere else (or over the panel) the same picker is in Settings.
    if (panel.isOpen || !home.onHome()) panel.show('home');
    else home.open();
  };

  b.provide('settings', {
    open: (pageId, query) => {
      if (!elsewhere((o) => o.service('settings')!.open(pageId, query))) panel.show(pageId, undefined, query);
    },
    registerPage: (page) => {
      if (!page || typeof page.id !== 'string' || !page.id || typeof page.render !== 'function') throw new Error('Deer settings: registerPage needs { id, title, order, render }');
      const def: SectionDef = {
        id: page.id,
        title: String(page.title ?? page.id),
        icon: pageIcon(page.icon),
        order: Number.isFinite(page.order) ? page.order : 100,
        keywords: page.keywords,
        groups: () => [],
        render: (host) => page.render(host),
      };
      return panel.register(def);
    },
    isOpen: () => panel.isOpen,
    close: () => panel.close(),
    changeBackground,
  });
}
