// Page action buttons (manifest page_action): Firefox draws them in its address bar, which Deer
// does not render, and with no visible anchor an extension's page action cannot open its popup
// at all ("PageActions: No anchor node", spikes/extensions/RESULT.md verifier correction 7).
// Deer draws one round button per page action in the cluster, before the pinned buttons:
//   - shown while api.action.isShownForTab(tab) (show_matches / hide_matches, pageAction.show/hide);
//   - icon and title from api.action.getContextData(tab), repainted when Firefox calls
//     api.updateButton(window) (one wrapper per API object, shared by every window), on tab switch
//     and navigation;
//   - click: api.handleClick(window, { button, modifiers }) (popup or onClicked); the popup (a
//     PanelPopup with the id <widget id>-panel) is routed under this button by an anchor the bar
//     registers per page action (b.setAnchor), and api.browserPageAction._anchorIDOverride names
//     the button for Firefox's own lookup;
//   - the keyboard command (_execute_page_action) and pageAction.openPopup() go through the same
//     handleClick, so they work too.
// Internals (gre/modules/ExtensionParent.sys.mjs, browser/.../parent/ext-pageAction.js,
// browser/modules/PageActions.sys.mjs) are reached through ./fx.
import type { Browser } from '../../browser';
import { el } from '../../dom';
import * as fx from './fx';

interface Entry {
  extension: any;
  api: any;
  button: HTMLButtonElement;
  img: HTMLImageElement;
  listener: (win: Window) => void;
}

/** Property on the shared pageAction API object holding every window's repaint listener. */
const LISTENERS = '__vitreUpdateListeners';

export class PageActions {
  readonly host: HTMLElement = el('span', { class: 'vx-pas' });
  private entries = new Map<string, Entry>();
  private cleanups: (() => void)[] = [];
  private started = false;

  constructor(
    private b: Browser,
    private changed: () => void,
    /** Route a page action's popup (by panel id) under its button; null button = stop routing it. */
    private route: (panelId: string, button: HTMLElement | null) => void
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.sync();
    try {
      this.cleanups.push(fx.onExtensionLifecycle(() => window.setTimeout(() => this.sync(), 0)));
    } catch (e) {
      console.error('Deer extensions: page actions cannot follow extensions', e);
    }
    this.cleanups.push(this.b.on('tab-activated', () => this.paint()));
    this.cleanups.push(
      this.b.on('tab-navigated', (tab) => {
        if (tab && tab.id === this.b.activeId) this.paint();
      })
    );
  }

  stop(): void {
    for (const fn of this.cleanups.splice(0)) fn();
    for (const id of [...this.entries.keys()]) this.drop(id);
  }

  /** Extensions with a page action that run in this window get a button; the others lose theirs. */
  sync(): void {
    const seen = new Set<string>();
    for (const policy of fx.activePolicies()) {
      const extension = policy?.extension;
      if (!extension?.manifest?.page_action) continue;
      const api = fx.pageActionFor(extension);
      if (!api?.action) continue;
      seen.add(extension.id);
      if (!this.entries.has(extension.id)) this.add(extension, api);
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
    this.paint();
  }

  private add(extension: any, api: any): void {
    const widgetId = String(api.browserPageAction?.id ?? extension.id).replace(/[^\w-]/g, '_');
    const img = el('img', { alt: '', draggable: 'false' });
    // data-bar-stop: a keyboard stop of the tab bar (src/window/barkeys.ts), as the pinned buttons.
    const button = el(
      'button',
      { type: 'button', class: 'vx-pa', id: `vitre-pa-${widgetId}`, 'data-extension-id': extension.id, 'data-action-id': api.browserPageAction?.id ?? '', 'data-bar-stop': '', tabindex: '-1' },
      img
    );
    button.addEventListener('click', (e) => {
      if (e.button !== 0) return;
      this.click(extension.id, e);
    });
    // Firefox's own anchor lookup (browser-pageActions.js panelAnchorNodeForAction) tries this id first.
    try {
      if (api.browserPageAction) api.browserPageAction._anchorIDOverride = button.id;
    } catch {
      /* read-only in a later runtime: the bar's anchor route still places the popup */
    }
    // One wrapper per API object for the whole process: every window adds its own listener.
    if (!api[LISTENERS]) {
      const listeners = new Set<(win: Window) => void>();
      const original = api.updateButton;
      api[LISTENERS] = listeners;
      api.updateButton = function (this: unknown, win: Window) {
        original.call(this, win);
        for (const fn of [...listeners]) {
          try {
            fn(win);
          } catch {
            listeners.delete(fn); // a closed window's listener
          }
        }
      };
    }
    const listener = (win: Window): void => {
      if (win === window) this.paint();
    };
    api[LISTENERS].add(listener);
    this.entries.set(extension.id, { extension, api, button, img, listener });
    this.host.append(button);
    this.route(fx.pageActionPanelId(extension.id), button);
  }

  private drop(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    try {
      e.api[LISTENERS]?.delete(e.listener);
    } catch {
      /* the extension is gone */
    }
    e.button.remove();
    this.route(fx.pageActionPanelId(id), null);
  }

  /** Bring every button in line with the selected tab. */
  paint(): void {
    const tab = window.gBrowser?.selectedTab;
    if (!tab) return;
    let changed = false;
    for (const e of this.entries.values()) {
      let shown = false;
      let title = '';
      let icon = '';
      try {
        shown = !!e.api.action.isShownForTab(tab);
        const data = e.api.action.getContextData(tab);
        title = String(data?.title || e.extension.name || '');
        icon = fx.preferredIcon(data?.icon, e.extension, 16);
      } catch {
        shown = false;
      }
      if (e.button.hidden === shown) changed = true;
      e.button.hidden = !shown;
      if (title && e.button.getAttribute('aria-label') !== title) {
        // While a popup hangs from the cluster the tip waits in data-vx-tip (ExtBar.muteTips).
        e.button.setAttribute(e.button.hasAttribute('data-vx-tip') ? 'data-vx-tip' : 'data-tip', title);
        e.button.setAttribute('aria-label', title);
      }
      if (icon && e.img.getAttribute('src') !== icon) e.img.setAttribute('src', icon);
    }
    if (changed) this.changed();
  }

  /** Show at most `slots` of the page actions shown for this tab (the rest wait for room); returns how many show. */
  fitTo(slots: number): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.button.hidden) continue;
      const fits = n < slots;
      e.button.classList.toggle('vx-overflow', !fits);
      if (fits) n++;
    }
    return n;
  }

  private click(id: string, event: MouseEvent): void {
    const e = this.entries.get(id);
    if (!e) return;
    const modifiers: string[] = [];
    if (event.shiftKey) modifiers.push('Shift');
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    Promise.resolve(e.api.handleClick(window, { button: 0, modifiers })).catch((err: unknown) => console.error('Deer extensions: page action failed', err));
  }

  /** The extension of a page action button (for its menu). */
  extensionFor(button: HTMLElement): any {
    return this.entries.get(button.dataset.extensionId ?? '')?.extension ?? null;
  }

  /** Test hook: the buttons by extension id. */
  get buttons(): Map<string, HTMLButtonElement> {
    return new Map([...this.entries].map(([id, e]) => [id, e.button]));
  }
}
