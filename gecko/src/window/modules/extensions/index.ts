// Extensions: Firefox add-ons (uBlock Origin is the reason for the engine) in Deer's bar.
// Design: DESIGN-NOTES "Ad blocking and extensions" (pinned extension icons inside the active pill
// at its right end, an extensions button for the rest). Gecko recipe: spikes/extensions/RESULT.md
// approach (a) with every verifier correction.
//
// Files
//   index.ts        install(b), the 'extensions' service, the review indicator, wiring
//   bar.ts          the cluster in the pill: pinned widgets (CustomizableUI area), Firefox's
//                   extensions button, overflow into Firefox's panel, popup / doorhanger anchors
//   pageactions.ts  Deer-drawn page action buttons (Firefox's live in its hidden address bar)
//   menu.ts         right-click and button menus through the 'menus' service
//   settings.ts     Settings › Extensions through the 'settings' service (registerPage)
//   fx.ts           every Firefox internal of the window side, each with its source file
//   css.ts          styles (b.css('extensions', ...))
//   ../../../modules/VitreExtensions.sys.ts   the process part: the CUI area and re-homing, prefs,
//                   temporary add-ons re-installed at each start, parked reviews, management
//
// Service 'extensions' (b.service('extensions')):
//   openPanel()   open the extensions panel hanging from the button in the active pill (Firefox's
//                 panel, with the pinned buttons that did not fit listed in it); when it would
//                 have nothing to list it opens Settings › Extensions (everything pinned) or the
//                 empty-state menu (no extension)
//   count()       extensions that run in this window (enabled, not hidden; in a private window
//                 only those allowed there)
//
// Services used, at the moment of use and only if present: 'menus' (every menu of the cluster;
// without it Firefox's toolbar menu stays on the pinned buttons) and 'settings' (the page; without
// it "Extension settings" opens about:addons).
//
// Behaviour notes for other authors
//   - The cluster sits in b.bar.accessories() of the active pill, before the download mark's slot;
//     on Home and in popup windows it is not drawn.
//   - Popup ids routed by this module (b.setAnchor): customizationui-widget-panel,
//     <makeWidgetId(extension id)>-panel (one per page action: Firefox's PanelPopup id),
//     appMenu-notification-popup (an "<name> was added" notice hangs from the extensions button,
//     any other app-menu notice from the + circle).
//   - Keyboard: the cluster's buttons are tab bar stops (data-bar-stop, src/window/barkeys.ts).
//   - Extension keyboard commands keep working: the core leaves ext-keyset-id-* keysets alone.
//   - Private windows: extensions without private access have no button there (Firefox does not
//     build their widgets); Settings › Extensions has the per-extension switch.
//   - Test hook: window.vitreExtensions = { bar, menus, page, api }.
import type { Browser } from '../../browser';
import { ExtBar } from './bar';
import * as fx from './fx';
import { ExtMenus } from './menu';
import { whenService } from './services';
import { ExtensionsPage, registerPage } from './settings';

export interface ExtensionsApi {
  /** Open the extensions panel (or what stands for it when it would be empty). */
  openPanel(): void;
  /** Extensions that run in this window. */
  count(): number;
}

declare global {
  interface VitreServices {
    extensions: ExtensionsApi;
  }
  interface VitreSysModules {
    VitreExtensions: typeof import('../../../modules/VitreExtensions.sys').VitreExtensions;
  }
}

export function install(b: Browser): void {
  const sys = b.sys('VitreExtensions');
  sys.init();

  const bar = new ExtBar(b);
  const menus = new ExtMenus(b, bar);
  bar.menus = menus;
  bar.mount();

  const api: ExtensionsApi = {
    openPanel: () => void bar.openPanel(),
    count: () => fx.activePolicies().length,
  };
  b.provide('extensions', api);

  // Deer's indicator for reviews Firefox parks behind its hidden app-menu badge.
  const indicate = (): void => {
    const reviews = sys.pending();
    const label = !reviews.length
      ? 'Extensions'
      : reviews.length === 1
        ? `Extensions: ${reviews[0].name} ${reviews[0].kind === 'update' ? 'update needs your review' : 'needs your review'}`
        : `Extensions: ${reviews.length} need your review`;
    bar.setAttention(reviews.length > 0, label);
  };
  b.onDestroy(sys.onChange(indicate));

  void b.whenReady.then(() => {
    bar.ready();
    indicate();
  });

  const page = new ExtensionsPage(b, menus);
  menus.page = page;
  let unregister: () => void = () => {};
  let gone = false;
  void whenService(b, 'settings').then((settings) => {
    if (gone) return;
    try {
      unregister = registerPage(page)(settings);
    } catch (e) {
      console.error('Deer extensions: could not add Settings › Extensions', e);
    }
  });
  b.onDestroy(() => {
    gone = true;
    unregister();
    bar.destroy();
  });

  (window as any).vitreExtensions = { bar, menus, page, api };
}
