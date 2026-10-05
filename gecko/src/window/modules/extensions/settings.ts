// Settings › Extensions: a page registered with the 'settings' service (registerPage). The panel
// draws the title; this draws the rest with the panel's own classes (vs-*, documented in
// src/window/modules/settings/index.ts) and a few of its own (css.ts, .vx-page).
//
//   intro, then one card of rows in the Settings layout (20 px icon, 14 px title, 12 px description,
//   the action at the right end, boards Settings / SettingsTabs / SettingsKeys):
//     Get add-ons (addons.mozilla.org) [Browse] · Load a temporary add-on (the signing note) [Choose…]
//     · Updates (the last check's result) [Check for updates]
//   Waiting for your review   permission-adding updates and add-ons another program installed
//   Installed                 one card per extension: icon, name, version and where it shows
//                             (pinned to the tab bar / in the extensions panel), Options, Pin,
//                             Remove (confirmed in place), the on/off switch; a second row for
//                             "Run in private windows"
//   Loaded from a folder or file   what Deer loads again at every start, with any load error
//   a last card: Firefox's add-ons manager (about:addons) for everything else, "Open ›" at its end
//
// Data and actions go through VitreExtensions (process singleton) and ./fx; the page re-renders
// when an add-on or a review changes (VitreExtensions.onChange).
import type { AddonInfo, Review } from '../../../modules/VitreExtensions.sys';
import type { Browser } from '../../browser';
import { el, svg } from '../../dom';
import { AREA } from './bar';
import * as fx from './fx';
import type { ExtMenus } from './menu';
import { service, type SettingsService } from './services';

/** Sidebar icon: a puzzle piece outline on the Settings icons' 20 px grid. */
export const PAGE_ICON =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3.25 6h3V4.8a1.8 1.8 0 1 1 3.6 0V6h3a1 1 0 0 1 1 1v3h1.1a1.8 1.8 0 1 1 0 3.6h-1.1V16a1 1 0 0 1-1 1h-8.6a1 1 0 0 1-1-1z"/></svg>';
const ROW_ICON = PAGE_ICON.replace('width="18" height="18"', 'width="20" height="20"');
const LOCK_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2"/><path d="M7 8.5V6.5a3 3 0 0 1 6 0v2"/></svg>';
const FOLDER_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.2a1.7 1.7 0 0 1 1.7-1.7h3.1l1.7 1.8h5.8A1.7 1.7 0 0 1 17 8v6.3a1.7 1.7 0 0 1-1.7 1.7H4.7A1.7 1.7 0 0 1 3 14.3z"/></svg>';
const ADD_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6.75v6.5M6.75 10h6.5"/></svg>';
const UPDATE_ICON =
  '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.6 10a5.6 5.6 0 1 1-1.64-3.96"/><path d="M14.4 3.2v3.2h-3.2"/></svg>';
const CHEVRON =
  '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 5 5 5-5 5"/></svg>';

export const PAGE_ID = 'extensions';

type H = typeof el;
const h: H = el;

let uid = 0;
const nextId = (p: string): string => `vx-${p}-${++uid}`;

export class ExtensionsPage {
  private host: HTMLElement | null = null;
  private status = '';
  /** Which row the status line belongs to: the last load, or the last update check. */
  private statusOf: 'load' | 'check' = 'check';
  private busy = false;
  private confirming = '';
  private renderQueued = false;
  private stamp = 0;

  constructor(
    private b: Browser,
    private menus: ExtMenus
  ) {}

  /** Show a message in the page's status line (next time it is on screen, or now). */
  report(text: string): void {
    this.say(text, 'load');
  }

  /** Open the page with an extension's removal waiting for confirmation (the button menu's Remove). */
  askRemove(id: string): void {
    this.confirming = id;
    this.scrollTo = id;
    if (this.host) void this.paint();
  }

  private scrollTo = '';

  /** The settings service calls this each time the page comes on screen. */
  render(host: HTMLElement): () => void {
    this.host = host;
    host.classList.add('vx-page');
    const off = this.b.sys('VitreExtensions').onChange(() => this.renderSoon());
    void this.paint();
    return () => {
      off();
      if (this.host === host) this.host = null;
    };
  }

  private renderSoon(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.setTimeout(() => {
      this.renderQueued = false;
      void this.paint();
    }, 60);
  }

  private settings(): SettingsService | undefined {
    return service(this.b, 'settings');
  }

  private async paint(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const stamp = ++this.stamp;
    const sys = this.b.sys('VitreExtensions');
    let addons: AddonInfo[] = [];
    try {
      addons = await sys.list();
    } catch (e) {
      console.error('Deer extensions: could not list add-ons', e);
    }
    if (stamp !== this.stamp || this.host !== host) return;
    const reviews = sys.pending();
    const temps = sys.temporary();
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.vxKey ?? '';

    const nodes: Node[] = [
      h(
        'p',
        { class: 'vs-intro' },
        'Pinned extensions sit at the right of the tab you are on; the others are behind the extensions button there. An extension stays off in private windows until you allow it there, so an ad blocker blocks nothing in them before that.'
      ),
      this.actions(),
    ];
    if (reviews.length) {
      nodes.push(h('h2', { class: 'vs-h2' }, 'Waiting for your review'));
      nodes.push(h('div', { class: 'vs-card' }, ...reviews.map((r) => this.reviewRow(r))));
    }
    nodes.push(h('h2', { class: 'vs-h2' }, 'Installed'));
    if (!addons.length) {
      nodes.push(h('div', { class: 'vs-card' }, h('div', { class: 'vx-empty' }, 'No extensions yet. Get add-ons opens addons.mozilla.org, where Add to Firefox installs them here.')));
    } else {
      for (const a of addons) nodes.push(this.addonCard(a));
    }
    if (temps.length) {
      nodes.push(h('h2', { class: 'vs-h2' }, 'Loaded from a folder or file'));
      nodes.push(
        h(
          'div',
          { class: 'vs-card' },
          ...temps.map((t) => {
            const row = h(
              'div',
              { class: 'vs-row has-ico' },
              h('span', { class: 'vs-ico', 'aria-hidden': 'true' }, svg(FOLDER_ICON)),
              // The reason on its own line, in the warning colour: after a long path it was cut
              // off by the path's ellipsis (verifier).
              h(
                'div',
                { class: 'vs-text' },
                h('span', { class: 'vs-title' }, t.name || 'Add-on'),
                h('span', { class: 'vs-desc vx-path' }, t.path),
                t.error ? h('span', { class: 'vs-desc vx-warn' }, t.error) : null
              ),
              h('button', { type: 'button', class: 'vs-link', 'data-vx-key': `forget-${t.path}` }, 'Stop loading at start')
            );
            row.querySelector('button')!.addEventListener('click', () => sys.forgetTemporary(t.id || t.path));
            return row;
          })
        )
      );
    }
    const manager = h('button', { type: 'button', class: 'vs-link vs-go', 'data-vx-key': 'manager', 'aria-label': 'Open the add-ons manager' }, 'Open', h('span', { class: 'vs-go-ico', 'aria-hidden': 'true' }, svg(CHEVRON)));
    manager.addEventListener('click', () => {
      this.closeSettings();
      fx.openAddonsManager('addons://list/extension');
    });
    nodes.push(h('div', { class: 'vs-card vx-more' }, this.row(ROW_ICON, 'Add-ons manager', 'Firefox’s page for every other add-on setting', manager)));
    host.replaceChildren(...nodes);
    if (this.scrollTo) {
      const card = host.querySelector<HTMLElement>(`.vx-card[data-extension-id="${CSS.escape(this.scrollTo)}"]`);
      this.scrollTo = '';
      if (card) {
        card.scrollIntoView({ block: 'center' });
        card.querySelector<HTMLElement>('.vx-confirm .vs-btn')?.focus();
        return;
      }
    }
    if (focusKey) host.querySelector<HTMLElement>(`[data-vx-key="${CSS.escape(focusKey)}"]`)?.focus();
  }

  private closeSettings(): void {
    try {
      this.settings()?.close();
    } catch {
      /* not open */
    }
  }

  /** A Settings row: 20 px icon, title and description, `control` at its right end. */
  private row(icon: string, title: string, desc: string | HTMLElement, control: HTMLElement): HTMLElement {
    const text = h('div', { class: 'vs-text' }, h('span', { class: 'vs-title' }, title));
    if (desc) text.append(typeof desc === 'string' ? h('span', { class: 'vs-desc' }, desc) : desc);
    return h('div', { class: 'vs-row has-ico' }, h('span', { class: 'vs-ico', 'aria-hidden': 'true' }, svg(icon)), text, control);
  }

  /** The action card: Get add-ons, Load a temporary add-on, Updates (a status line under the row it is about). */
  private actions(): HTMLElement {
    const get = h('button', { type: 'button', class: 'vs-btn', 'data-vx-key': 'get' }, 'Browse');
    get.addEventListener('click', () => {
      this.closeSettings();
      this.menus.getAddons();
    });
    const load = h('button', { type: 'button', class: 'vs-btn', 'data-vx-key': 'load' }, 'Choose…');
    load.addEventListener('click', async () => {
      const r = await this.menus.loadTemporary();
      if (r.message) this.say(r.message, 'load');
    });
    const check = h('button', { type: 'button', class: 'vs-btn', 'data-vx-key': 'check' }, this.busy ? 'Checking…' : 'Check for updates');
    if (this.busy) check.setAttribute('disabled', '');
    check.addEventListener('click', () => void this.checkUpdates());
    const line = (of: 'load' | 'check', idle: string): HTMLElement => {
      const own = this.status && this.statusOf === of;
      return h('span', { class: `vs-desc${own ? ' vx-status' : ''}`, role: own ? 'status' : null, 'data-vx-status': of, 'data-vx-idle': idle }, own ? this.status : idle);
    };
    return h(
      'div',
      { class: 'vs-card vx-actions-card' },
      this.row(ADD_ICON, 'Get add-ons', 'From addons.mozilla.org', get),
      this.row(FOLDER_ICON, 'Load a temporary add-on', line('load', 'Not signed by Mozilla: loaded again at every start, never updated'), load),
      this.row(UPDATE_ICON, 'Updates', line('check', 'Signed add-ons update by themselves'), check)
    );
  }

  /** The status line: shown under the row it is about (the last load, or the update check). */
  private say(text: string, of: 'load' | 'check' = this.statusOf): void {
    this.status = text;
    this.statusOf = of;
    for (const s of Array.from(this.host?.querySelectorAll<HTMLElement>('[data-vx-status]') ?? [])) {
      const own = s.dataset.vxStatus === of && !!text;
      s.textContent = own ? text : (s.dataset.vxIdle ?? '');
      s.classList.toggle('vx-status', own);
      if (own) s.setAttribute('role', 'status');
      else s.removeAttribute('role');
    }
  }

  private async checkUpdates(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status = '';
    this.statusOf = 'check';
    void this.paint();
    let text = '';
    try {
      const r = await this.b.sys('VitreExtensions').checkForUpdates();
      const parts: string[] = [];
      if (r.installed) parts.push(`${r.installed} updated`);
      if (r.review) parts.push(`${r.review} waiting for your review`);
      if (r.failed) parts.push(`${r.failed} could not be checked`);
      text = parts.length ? parts.join(', ') : r.checked ? 'Everything is up to date' : 'Nothing to check';
    } catch (e) {
      text = `The check failed: ${String((e as Error)?.message ?? e)}`;
    }
    this.busy = false;
    this.status = text;
    this.statusOf = 'check';
    void this.paint();
  }

  private reviewRow(r: Review): HTMLElement {
    const icon = h('span', { class: 'vx-ext-ico', 'aria-hidden': 'true' });
    if (r.icon) icon.append(h('img', { src: r.icon, alt: '' }));
    else icon.append(svg(ROW_ICON));
    const button = h('button', { type: 'button', class: 'vs-btn', 'data-vx-key': `review-${r.kind}-${r.id}` }, 'Review…');
    button.addEventListener('click', () => {
      this.closeSettings();
      this.b.sys('VitreExtensions').review(r, window.gBrowser);
    });
    return h(
      'div',
      { class: 'vs-row has-ico' },
      icon,
      h('div', { class: 'vs-text' }, h('span', { class: 'vs-title' }, r.name), h('span', { class: 'vs-desc' }, r.kind === 'update' ? 'Its update asks for new permissions' : 'Another program added it; it stays off until you allow it')),
      button
    );
  }

  private addonCard(a: AddonInfo): HTMLElement {
    const sys = this.b.sys('VitreExtensions');
    const titleId = nextId('name');
    const descId = nextId('desc');
    const iconUrl = fx.addonIcon(a.addon, 32);
    const icon = h('span', { class: `vx-ext-ico${a.enabled ? '' : ' vx-off'}`, 'aria-hidden': 'true' });
    if (iconUrl) icon.append(h('img', { src: iconUrl, alt: '' }));
    else icon.append(svg(ROW_ICON));

    const widgetId = this.widgetIdFor(a.id);
    const pinned = !!widgetId && fx.areaOf(widgetId) === AREA;
    const pageAction = !!(globalThis as any).WebExtensionPolicy?.getByID(a.id)?.extension?.manifest?.page_action;
    const where = !a.enabled ? 'Off' : widgetId ? (pinned ? 'Pinned to the tab bar' : 'In the extensions panel') : pageAction ? 'Shows in the tab bar on the pages it works on' : 'No button';
    const meta = [a.version ? `Version ${a.version}` : '', where, a.temporary ? 'Temporary' : ''].filter(Boolean).join(' · ');
    const desc = h('span', { class: 'vs-desc vx-meta', id: descId }, meta);
    const text = h('div', { class: 'vs-text' }, h('span', { class: 'vs-title', id: titleId }, a.name), desc);
    if (a.appDisabled) text.append(h('span', { class: 'vs-desc vx-warn' }, 'Firefox keeps it turned off (not signed, blocked or not compatible with this version)'));

    const actions = h('div', { class: 'vx-row-actions' });
    if (this.confirming === a.id) {
      const yes = h('button', { type: 'button', class: 'vs-btn', 'data-vx-key': `confirm-${a.id}` }, 'Remove');
      const no = h('button', { type: 'button', class: 'vs-btn subtle', 'data-vx-key': `cancel-${a.id}` }, 'Cancel');
      yes.addEventListener('click', async () => {
        this.confirming = '';
        try {
          await sys.remove(a.id);
          this.say(`${a.name} removed`);
        } catch (e) {
          this.say(`Could not remove ${a.name}: ${String((e as Error)?.message ?? e)}`);
        }
        void this.paint();
      });
      no.addEventListener('click', () => {
        this.confirming = '';
        void this.paint();
      });
      actions.append(h('span', { class: 'vx-confirm' }, h('span', { class: 'vx-confirm-text' }, `Remove ${a.name}?`), yes, no));
    } else {
      if (a.optionsURL) {
        const options = h('button', { type: 'button', class: 'vs-link', 'data-vx-key': `options-${a.id}` }, 'Options');
        if (!a.enabled) options.setAttribute('disabled', '');
        options.addEventListener('click', () => this.openOptions(a));
        actions.append(options);
      }
      if (widgetId && a.enabled) {
        const pin = h('button', { type: 'button', class: 'vs-link', 'data-vx-key': `pin-${a.id}` }, pinned ? 'Unpin' : 'Pin');
        pin.addEventListener('click', () => {
          fx.moveWidget(widgetId, pinned ? fx.AREA_ADDONS() : AREA, pinned ? 0 : undefined);
          this.renderSoon();
        });
        actions.append(pin);
      }
      if (a.canRemove) {
        const remove = h('button', { type: 'button', class: 'vs-link vx-danger', 'data-vx-key': `remove-${a.id}` }, 'Remove');
        remove.addEventListener('click', () => {
          this.confirming = a.id;
          void this.paint();
        });
        actions.append(remove);
      }
    }

    const toggle = this.switch(a.enabled, titleId, descId, `on-${a.id}`, !(a.enabled ? a.canDisable : a.canEnable), async (on) => {
      try {
        await sys.setEnabled(a.id, on);
      } catch (e) {
        this.say(`Could not change ${a.name}: ${String((e as Error)?.message ?? e)}`);
      }
    });
    const main = h('div', { class: 'vs-row has-ico', 'data-extension-id': a.id }, icon, text, actions, toggle);

    const privId = nextId('priv');
    const privDescId = nextId('privd');
    // Only the exception needs words; the rule is in the intro.
    const privDesc = a.privateNotAllowed ? 'This extension never runs in private windows' : '';
    const privText = h('div', { class: 'vs-text' }, h('span', { class: 'vs-title vx-subtitle', id: privId }, 'Run in private windows'));
    if (privDesc) privText.append(h('span', { class: 'vs-desc', id: privDescId }, privDesc));
    const priv = h(
      'div',
      { class: 'vs-row has-ico vx-sub' },
      h('span', { class: 'vs-ico', 'aria-hidden': 'true' }, svg(LOCK_ICON)),
      privText,
      this.switch(a.privateAllowed, privId, privDesc ? privDescId : '', `priv-${a.id}`, !a.canChangePrivate, async (on) => {
        try {
          await sys.setPrivateAllowed(a.id, on);
        } catch (e) {
          this.say(`Could not change ${a.name}: ${String((e as Error)?.message ?? e)}`);
        }
      })
    );
    return h('div', { class: 'vs-card vx-card', 'data-extension-id': a.id }, main, priv);
  }

  /** A Windows 11 switch in the panel's look (button.vs-switch[role=switch] > span.vs-knob). */
  private switch(on: boolean, labelledBy: string, describedBy: string, key: string, disabled: boolean, set: (on: boolean) => Promise<void>): HTMLElement {
    const state = h('span', { class: 'vs-state', 'aria-hidden': 'true' }, on ? 'On' : 'Off');
    const button = h(
      'button',
      { type: 'button', class: 'vs-switch', role: 'switch', 'aria-checked': String(on), 'aria-labelledby': labelledBy, 'aria-describedby': describedBy || null, 'data-vx-key': key },
      h('span', { class: 'vs-knob' })
    );
    if (disabled) button.setAttribute('disabled', '');
    button.addEventListener('click', async () => {
      const next = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(next));
      state.textContent = next ? 'On' : 'Off';
      await set(next);
      this.renderSoon();
    });
    return h('div', { class: 'vs-toggle' }, state, button);
  }

  /** The CustomizableUI widget of an extension's toolbar button, if it has one. */
  private widgetIdFor(id: string): string {
    const extension = (globalThis as any).WebExtensionPolicy?.getByID(id)?.extension;
    const action = extension ? fx.browserActionFor(extension) : null;
    return String(action?.widget?.id ?? '');
  }

  /** Options in its own tab (with the extension's principal), or Firefox's inline page in about:addons. */
  private openOptions(a: AddonInfo): void {
    const policy = (globalThis as any).WebExtensionPolicy?.getByID(a.id);
    // Settings first: closing it hands focus back to the tab it was opened over.
    this.closeSettings();
    if (a.optionsType === 3 && policy?.extension) {
      this.b.openLink(a.optionsURL, 'tab', { triggeringPrincipal: policy.extension.principal });
    } else {
      fx.openAddonsManager(`addons://detail/${encodeURIComponent(a.id)}/preferences`);
    }
  }
}

/** Register the page; returns the remover (or a no-op when the settings service never comes). */
export function registerPage(page: ExtensionsPage): (settings: SettingsService) => () => void {
  return (settings) =>
    settings.registerPage({
      id: PAGE_ID,
      title: 'Extensions',
      icon: PAGE_ICON,
      order: 65,
      keywords: 'extensions add-ons addons ublock ad blocker amo private windows temporary unsigned updates permissions pin',
      render: (host) => page.render(host),
    });
}
