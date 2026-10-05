// Deer's menus for the extensions cluster, drawn by the 'menus' service (glass, Deer's look):
//
//   pinned button     the extension's own items (menus API, contexts browser_action / action)
//                     — Manage extension · Remove extension… — Pin to tab bar (check)
//                     (Remove asks in Settings › Extensions, the card's own confirmation; without
//                     the settings service, Firefox's window-modal confirmation)
//   page action       the extension's own items (page_action) — Manage extension · Remove extension…
//   extensions button reviews waiting (if any) — Show extensions panel · Extension settings · Get add-ons
//   reviews           (left click while something waits) Review update for <name>… / Review <name>…
//                     — Show extensions panel · Extension settings
//   empty state       (left click, no extension) caption "No extensions installed" — Get add-ons ·
//                     Load temporary add-on… · Extension settings
// Report is never offered (Firefox's abuse report entry points are off, VitreExtensions).
// Without the 'menus' service every method returns false: the pinned buttons fall back to Firefox's
// toolbar menu (its Firefox-only entries hidden by css.ts) and the extensions button opens the
// panel or Settings directly.
//
// The extension's own items come from Firefox's menu builder (fx.fillActionMenu: a never-shown
// XUL menupopup filled by ext-menus.js actionContextMenu); a chosen row runs element.doCommand(),
// and "popuphidden" is dispatched on that popup once the menu has closed so the builder cleans up
// (menus.onHidden reaches the extension).
import type { Review } from '../../../modules/VitreExtensions.sys';
import type { Browser } from '../../browser';
import type { ExtBar } from './bar';
import { AREA } from './bar';
import * as fx from './fx';
import { literal, SEP, service, type MenuRow, type MenusService } from './services';

export class ExtMenus {
  /** Settings › Extensions, for "Remove extension…" to ask there and for load errors (set by index.ts). */
  page: { askRemove(id: string): void; report(text: string): void } | null = null;

  constructor(
    private b: Browser,
    private bar: ExtBar
  ) {}

  /** Remove, confirmed in Deer's Settings when it is there, else by Firefox's dialog. */
  remove(id: string): void {
    const settings = service(this.b, 'settings');
    if (settings && this.page) {
      this.page.askRemove(id);
      settings.open('extensions');
    } else fx.removeAddon(id);
  }

  private menus(): MenusService | undefined {
    return service(this.b, 'menus');
  }

  available(): boolean {
    return !!this.menus();
  }

  hasSettings(): boolean {
    return !!service(this.b, 'settings');
  }

  /** Settings › Extensions; about:addons when the Settings module is missing. */
  openSettings(): void {
    const settings = service(this.b, 'settings');
    if (settings) settings.open('extensions');
    else fx.openAddonsManager('addons://list/extension');
  }

  getAddons(): void {
    this.b.newTab(fx.AMO_URL);
  }

  /** "Load temporary add-on…": the native Open dialog, then VitreExtensions.loadTemporary. */
  async loadTemporary(): Promise<{ ok: boolean; message: string }> {
    const path = await fx.pickAddonFile('Load a temporary add-on');
    if (!path) return { ok: false, message: '' };
    try {
      const { name } = await this.b.sys('VitreExtensions').loadTemporary(path);
      return { ok: true, message: `${name} loaded. Deer loads it again at every start.` };
    } catch (e) {
      return { ok: false, message: `Could not load it: ${String((e as Error)?.message ?? e)}` };
    }
  }

  /** `keyboard`: opened by Shift+F10 / the Menu key (first row focused, access keys shown). */
  private show(rows: MenuRow[], at: Element, onClose?: () => void, keyboard?: boolean): boolean {
    const menus = this.menus();
    if (!menus) return false;
    // A button hidden for room cannot anchor anything: the extensions button stands in.
    const anchor = at.getClientRects().length ? at : (this.bar.button ?? at);
    const owner = (anchor.closest?.('.unified-extensions-item-action-button, #unified-extensions-button, .vx-pa') as Element | null) ?? anchor;
    // Bar surfaces hang 8 px under the pill (DESIGN-NOTES, menus: "Tab bar surfaces hang at top 64"),
    // right edges aligned with the button.
    const pill = anchor.closest?.('.item');
    const gap = pill ? Math.max(8, Math.round(pill.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom) + 8) : 8;
    menus.show(tidy(rows), anchor, { align: 'end', owner, label: 'Extension', onClose, gap, ...(keyboard ? { keyboard: true } : {}) });
    return true;
  }

  // ---- pinned buttons ----

  forWidget(item: Element, at: Element, keyboard = false): boolean {
    if (!this.available()) return false;
    const id = item.getAttribute('data-extensionid') ?? '';
    const widgetId = item.id;
    const extension = (globalThis as any).WebExtensionPolicy?.getByID(id)?.extension;
    if (!extension) return false;
    void this.widgetRows(extension, widgetId).then(({ rows, done }) => {
      if (!this.show(rows, at, done, keyboard)) done();
    });
    return true;
  }

  private async widgetRows(extension: any, widgetId: string): Promise<{ rows: MenuRow[]; done: () => void }> {
    const own = ownItems(extension, extension.manifestVersion < 3 ? 'onBrowserAction' : 'onAction');
    const pinned = fx.areaOf(widgetId) === AREA;
    const canRemove = await this.canRemove(extension.id);
    const rows: MenuRow[] = [
      ...own.rows,
      SEP,
      { label: '&Manage extension', run: () => fx.manageAddon(extension.id) },
      { label: '&Remove extension…', danger: true, disabled: !canRemove, run: () => this.remove(extension.id) },
      SEP,
      { label: '&Pin to tab bar', checked: pinned, run: () => fx.unified()?.pinToToolbar(widgetId, !pinned) },
    ];
    return { rows, done: own.done };
  }

  // ---- page action buttons ----

  forPageAction(extension: any, at: Element, keyboard = false): boolean {
    if (!this.available() || !extension) return false;
    const own = ownItems(extension, 'onPageAction');
    void this.canRemove(extension.id).then((canRemove) => {
      const rows: MenuRow[] = [
        ...own.rows,
        SEP,
        { label: '&Manage extension', run: () => fx.manageAddon(extension.id) },
        { label: '&Remove extension…', danger: true, disabled: !canRemove, run: () => this.remove(extension.id) },
      ];
      if (!this.show(rows, at, own.done, keyboard)) own.done();
    });
    return true;
  }

  // ---- the extensions button ----

  forButton(at: Element, keyboard = false): boolean {
    if (!this.available()) return false;
    const reviews = this.b.sys('VitreExtensions').pending();
    return this.show([...reviewRows(this.b, reviews), SEP, ...this.commonRows(true), { label: '&Get add-ons', run: () => this.getAddons() }], at, undefined, keyboard);
  }

  /** Left click (or Enter) while reviews wait. */
  reviews(reviews: Review[], at: Element, keyboard = false): boolean {
    if (!this.available()) return false;
    return this.show([...reviewRows(this.b, reviews), SEP, ...this.commonRows(true)], at, undefined, keyboard);
  }

  /** Left click (or Enter) with no extension installed. */
  empty(at: Element, keyboard = false): boolean {
    if (!this.available()) return false;
    return this.show(
      [
        { caption: 'No extensions installed' },
        { label: '&Get add-ons', run: () => this.getAddons() },
        {
          label: '&Load temporary add-on…',
          run: () =>
            void this.loadTemporary().then((r) => {
              // A success shows itself (a new button); a failure is explained in Settings › Extensions.
              if (!r.ok && r.message && this.page && this.hasSettings()) {
                this.page.report(r.message);
                this.openSettings();
              }
            }),
        },
        SEP,
        { label: 'Extension &settings', run: () => this.openSettings() },
      ],
      at,
      undefined,
      keyboard
    );
  }

  private commonRows(panel: boolean): MenuRow[] {
    const rows: MenuRow[] = [];
    if (panel && fx.activePolicies().length) rows.push({ label: 'Show &extensions panel', run: () => void this.bar.openPanel() });
    rows.push({ label: 'Extension &settings', run: () => this.openSettings() });
    return rows;
  }

  private async canRemove(id: string): Promise<boolean> {
    try {
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(id);
      return !!addon && !!(addon.permissions & AddonManager.PERM_CAN_UNINSTALL);
    } catch {
      return false;
    }
  }
}

/** Rows for parked reviews (VitreExtensions.pending()). */
function reviewRows(b: Browser, reviews: Review[]): MenuRow[] {
  return reviews.map((r) => ({
    label: r.kind === 'update' ? `Review update for ${literal(r.name)}…` : `Review ${literal(r.name)}…`,
    // The menus service draws only these image URLs (src/window/modules/menus/types.ts).
    icon: /^(chrome|moz-extension|data|moz-remote-image):/.test(r.icon) ? r.icon : undefined,
    run: () => b.sys('VitreExtensions').review(r, window.gBrowser),
  }));
}

/** Separators never lead, trail or double (the menus service tidies too; this keeps tests honest). */
function tidy(rows: MenuRow[]): MenuRow[] {
  const out: MenuRow[] = [];
  for (const r of rows) {
    if ('separator' in r && (!out.length || 'separator' in out[out.length - 1])) continue;
    out.push(r);
  }
  while (out.length && 'separator' in out[out.length - 1]) out.pop();
  return out;
}

/**
 * The extension's own items for its button, as rows. `done` must run once the menu has closed:
 * it lets Firefox's menu builder clean up (deferred a tick so a chosen row still finds its element).
 */
export function ownItems(extension: any, kind: 'onBrowserAction' | 'onAction' | 'onPageAction'): { rows: MenuRow[]; done: () => void } {
  const set = document.getElementById('mainPopupSet') ?? document.documentElement;
  const scratch = (document as any).createXULElement('menupopup') as Element;
  scratch.setAttribute('hidden', 'true');
  set.append(scratch);
  let rows: MenuRow[] = [];
  try {
    if (fx.fillActionMenu(extension, kind, scratch)) rows = toRows(scratch);
  } catch (e) {
    console.error('Deer extensions: could not read the extension menu', e);
  }
  let finished = false;
  const done = (): void => {
    if (finished) return;
    finished = true;
    window.setTimeout(() => {
      try {
        scratch.dispatchEvent(new CustomEvent('popuphidden'));
      } catch {
        /* nothing to clean */
      }
      scratch.remove();
    }, 0);
  };
  return { rows, done };
}

function toRows(popup: Element): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const child of popup.children) {
    if ((child as any).hidden || child.getAttribute('hidden') === 'true') continue;
    if (child.localName === 'menuseparator') {
      rows.push({ separator: true });
      continue;
    }
    const label = literal(child.getAttribute('label') ?? '');
    if (!label) continue;
    const access = child.getAttribute('accesskey') || undefined;
    const image = child.getAttribute('image') || undefined;
    const disabled = child.getAttribute('disabled') === 'true';
    if (child.localName === 'menu') {
      const sub = child.querySelector(':scope > menupopup');
      rows.push({ label, access, icon: image, disabled, submenu: sub ? toRows(sub) : [] });
      continue;
    }
    const type = child.getAttribute('type');
    rows.push({
      label,
      access,
      icon: image,
      disabled,
      checked: type === 'checkbox' || type === 'radio' ? child.getAttribute('checked') === 'true' : undefined,
      run: () => (child as any).doCommand(),
    });
  }
  return rows;
}
