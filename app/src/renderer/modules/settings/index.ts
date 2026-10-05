// Settings: the floating Settings panel (Ctrl+,), Keyboard shortcuts (F1), Clear browsing data
// (Ctrl+Shift+Delete), and Home's background (photo, video, Windows wallpaper or none).
import type { ActionId } from '../../../shared/shortcuts';
import type { Browser } from '../../app';
import { HomeBackground } from './background';
import type { SectionId } from './controls';
import { HomeButton } from './home-button';
import { SettingsPanel } from './panel';
import { capturing } from './shortcuts-page';
import { CSS } from './styles';

const FIND_ACTIONS: ActionId[] = ['find', 'findNext', 'findPrev'];

export function install(b: Browser): void {
  b.css('settings', CSS);
  const bg = new HomeBackground(b);
  bg.install();
  const panel = new SettingsPanel(b, bg);
  const home = new HomeButton(b, bg);
  guardActions(b, () => panel.findSetting());

  b.registerAction('settings', () => panel.toggle());
  b.registerAction('shortcutsHelp', () => panel.show('shortcuts'));
  b.registerAction('clearData', () => panel.show('privacy', 'clear'));

  // Other modules (menus: "Settings", "Change background…") open these without importing us.
  document.addEventListener('vitre:open-settings', (e) => {
    const d = (e as CustomEvent<{ section?: SectionId; anchor?: string } | undefined>).detail;
    panel.show(d?.section, d?.anchor);
  });
  document.addEventListener('vitre:change-background', () => {
    // The popover belongs to Home; anywhere else (or over the panel) the same picker is in Settings.
    if (panel.isOpen || b.active()?.kind !== 'home') panel.show('home');
    else home.open();
  });
}

/**
 * Keys pressed in Vitre's own UI run their action from the core's window keydown listener, before
 * any field sees them. Until the core lets a surface keep them (integration requests 2 and 3), the
 * actions are held back here: every one while a new key is being captured (that key is only being
 * tried), and Find while a panel is open (Ctrl+F goes to the topmost surface: the panel's search,
 * which Downloads focuses itself and Settings through `findSetting`).
 */
function guardActions(b: Browser, findSetting: () => void): void {
  const run = b.run.bind(b);
  b.run = (action: ActionId, arg?: number) => {
    if (capturing()) return;
    if (FIND_ACTIONS.includes(action) && document.body.classList.contains('panel-open')) {
      if (action === 'find') findSetting();
      return;
    }
    run(action, arg);
  };
}
