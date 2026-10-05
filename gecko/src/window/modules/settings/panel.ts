// The Settings panel: a 960x688 frosted sheet centred over the dimmed window (scaled down to fit
// small windows), a 48 px title bar, a 216 px sidebar with "Find a setting", and the pages.
// Esc and Ctrl+W close it (panel layer 60); focus stays inside while it is open.
// Ported from app/src/renderer/modules/settings/panel.ts. Gecko notes:
//   - The sheet's lens is a strip lens (glass.ts lens(960, 688, radius 22, scale 24, blur 22): the
//     board's lens-float), opaque so the blur does not let the sharp page through at the edges.
//     Nothing between #vitre-root and the lens may be faded (opacity < 1 makes a backdrop root and
//     the lens would see nothing), so the open / close motion scales the sheet and fades its tint,
//     rim and body; the lens itself is shown at once and goes first on close.
//   - State on b.root: `panel-open` (the core then sends Ctrl+F / F3 to the panel as the
//     'vitre:panel-find' document event) and `settings-open`. One panel at a time: when another
//     panel puts `downloads-open` on b.root, Settings steps aside, and opening Settings runs the
//     'downloads' action once to close an open Downloads panel (Ctrl+J toggles it).
//   - The address field (z 20) sits under the panel (z 30): when it takes focus (Ctrl+T, Ctrl+L,
//     F6), Settings closes and leaves focus there.
//   - Tooltips are tips.ts setTip (title attributes show nothing in browser.xhtml).
//   - Element full screen hides Deer's layer: opening leaves it first and shows once it is over.
//   - Page keys (reload, print, zoom, Ctrl+Q...) do nothing while the panel is open (browser.ts run(),
//     keymap.json "Topmost surface"); an Esc pressed in the sheet is the ladder's even when a tab
//     prompt (alert, print preview) sits under the panel (keys.ts escTaken).
import type { Settings } from '../../../shared/settings';
import type { Browser } from '../../browser';
import * as fx from '../../firefox';
import { lens } from '../../glass';
import { scrollThumb } from '../../scrollthumb';
import { setTip } from '../../tips';
import type { HomeBackground } from './background';
import { card, h, heading, iconBox, uid, type Ctx, type Option, type RowDef, type SectionDef, type SectionId } from './controls';
import { exitElementFullscreen } from './gecko';
import { ico } from './icons';
import { BUILTIN_SECTIONS } from './pages';
import { CAPTURE_ESC_PRIORITY, capture, matchesKeys } from './shortcuts-page';

const W = 960;
const H = 688;
/** Space kept around the sheet when the window is too small for it. */
const MARGIN = 16;
const PANEL_LAYER = 60;
const LISTBOX_LAYER = 20;
const CLOSE_MS = 160;
/** The overlay layer's z (panels 30); surfaces above it, like the switcher or menus, may take focus. */
const PANEL_Z = 30;

const FOCUSABLE = 'button, input, [tabindex], a[href]';

export class SettingsPanel {
  private root!: HTMLElement;
  private sheet!: HTMLElement;
  private search!: HTMLInputElement;
  private clear!: HTMLButtonElement;
  private nav!: HTMLElement;
  private main!: HTMLElement;
  private content!: HTMLElement;
  private navItems = new Map<SectionId, HTMLButtonElement>();
  private built = false;
  private openNow = false;
  private section: SectionId = 'general';
  private query = '';
  private updaters = new Set<(s: Settings) => void>();
  private disposers: (() => void)[] = [];
  private returnFocus: HTMLElement | null = null;
  /** Where focus goes once Downloads, which took over from Settings, closes again. */
  private handoff: HTMLElement | null = null;
  /** The last element focused inside the sheet, to go back to when something beneath takes focus. */
  private lastInside: HTMLElement | null = null;
  private fit = 1;
  private popup: { el: HTMLElement; anchor: HTMLElement; done(): void } | null = null;
  private hideTimer = 0;
  /** Waiting for element full screen to end before opening (removes the listener). */
  private afterFullscreen: (() => void) | null = null;
  private readonly ctx: Ctx;
  /** Pages other modules registered (the 'settings' service), by id. */
  private extra = new Map<SectionId, SectionDef>();

  constructor(
    private b: Browser,
    bg: HomeBackground
  ) {
    this.ctx = {
      b,
      bg,
      s: () => this.b.settings,
      set: (patch) => this.b.sys('VitreSettings').set(patch),
      bind: (fn) => {
        this.updaters.add(fn);
        fn(this.b.settings);
        return () => this.updaters.delete(fn);
      },
      cleanup: (fn) => {
        this.disposers.push(fn);
      },
      listbox: { open: (anchor, options, selected, pick) => this.openListbox(anchor, options, selected, pick) },
      go: (section, anchor) => this.show(section, anchor),
    };
    b.on('settings', (s) => {
      for (const fn of [...this.updaters]) {
        try {
          fn(s);
        } catch (e) {
          console.error('Deer settings: a control failed to repaint', e);
        }
      }
    });
    b.addEscLayer(CAPTURE_ESC_PRIORITY, () => {
      if (!capture.active) return false;
      capture.active.cancel(true);
      return true;
    });
    b.addEscLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      this.close();
      return true;
    });
    b.addCloseLayer(PANEL_LAYER, () => {
      if (!this.openNow) return false;
      // While a key is being captured, Ctrl+W is just a key the capture refuses.
      if (!capture.active) this.close();
      return true;
    });
    const resized = (): void => {
      if (!this.openNow) return;
      this.closeListbox(false);
      this.layout();
    };
    window.addEventListener('resize', resized);
    b.onDestroy(() => window.removeEventListener('resize', resized));
    // One panel at a time: when Downloads opens (downloads-open on b.root), Settings steps aside.
    // Downloads then hands focus back to an element of this hidden sheet, which can't take it,
    // so once it closes focus goes to where it was before Settings opened.
    const watch = new MutationObserver(() => {
      const cl = this.b.root.classList;
      if (this.openNow && cl.contains('downloads-open')) {
        this.close('handoff');
      } else if (this.handoff && !cl.contains('panel-open')) {
        const el = this.handoff;
        this.handoff = null;
        if (!this.openNow) this.focusBack(el);
      }
    });
    watch.observe(this.b.root, { attributes: true, attributeFilter: ['class'] });
    b.onDestroy(() => watch.disconnect());
    // Switching tabs underneath (Ctrl+1, Ctrl+Tab) focuses the page; the panel keeps focus.
    b.on('tab-activated', () => {
      if (this.openNow) this.reclaimFocus();
    });
    // Ctrl+F, F3 and Ctrl+G go to the topmost surface: with a panel open, the core sends them here.
    const panelFind = (): void => this.findSetting();
    document.addEventListener('vitre:panel-find', panelFind);
    b.onDestroy(() => document.removeEventListener('vitre:panel-find', panelFind));
    // A window closed with the panel open: the page on screen still holds its clean-ups (a registered
    // page's, a pref observer on a process-wide service), which would keep the window alive.
    b.onDestroy(() => {
      this.afterFullscreen?.();
      this.afterFullscreen = null;
      this.openNow = false;
      this.dispose();
    });
  }

  get isOpen(): boolean {
    return this.openNow;
  }

  /** The page on screen ('' while "Find a setting" shows results). */
  get current(): SectionId {
    return this.query.trim() ? '' : this.section;
  }

  toggle(): void {
    if (this.openNow) this.close();
    else this.show();
  }

  /**
   * Open (or move) to a page; `anchor` names a group to scroll to and focus ('clear' on Privacy).
   * `query` fills "Find a setting" and shows its results instead.
   */
  show(section?: SectionId, anchor?: string, query?: string): void {
    // Deer's layer is hidden while a page element is full screen: leave it first, then open
    // (as Ctrl+T's address field waits for it, browser.ts newTab).
    if (fx.inDOMFullscreen()) {
      if (!this.afterFullscreen) {
        this.afterFullscreen = fx.onDOMFullscreenExit(() => {
          this.afterFullscreen = null;
          requestAnimationFrame(() => {
            if (!fx.inDOMFullscreen()) this.show(section, anchor, query);
          });
        }, true);
      }
      exitElementFullscreen();
      return;
    }
    this.build();
    if (section && this.sectionById(section)) {
      this.section = section;
      this.setQuery('');
    }
    if (query !== undefined) this.setQuery(query);
    if (!this.openNow) this.enter();
    this.paintNav();
    this.renderContent();
    this.focusInitial(anchor, query !== undefined && !!query);
  }

  /**
   * `focus`: 'back' returns it to where it was before Settings opened; 'handoff' when Downloads
   * takes over (focus goes back once that closes too); 'stay' when the address field took it.
   */
  close(focus: 'back' | 'handoff' | 'stay' = 'back'): void {
    if (!this.openNow) return;
    capture.active?.cancel(false);
    this.closeListbox(false);
    this.openNow = false;
    this.b.root.classList.remove('settings-open');
    if (!this.b.root.classList.contains('downloads-open')) this.b.root.classList.remove('panel-open');
    this.root.classList.remove('open');
    this.root.classList.add('closing');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      if (this.openNow) return;
      this.root.hidden = true;
      this.root.classList.remove('closing');
      this.dispose();
      this.content.replaceChildren();
    }, CLOSE_MS);
    const back = this.returnFocus;
    this.returnFocus = null;
    this.lastInside = null;
    if (focus === 'back') this.focusBack(back);
    else if (focus === 'handoff') this.handoff = back ?? this.b.active()?.browser ?? null;
  }

  // ---- page registry (the 'settings' service) ----

  /** Add a page another module provides. Returns a function that removes it again. */
  register(def: SectionDef): () => void {
    if (this.sectionById(def.id)) throw new Error(`Deer settings: a page "${def.id}" is already registered`);
    this.extra.set(def.id, def);
    if (this.built) {
      this.buildNav();
      this.paintNav();
    }
    // On screen now: its own page, or "Find a setting" results that may list it.
    if (this.openNow && (this.section === def.id || this.query.trim())) this.renderContent();
    return () => {
      if (this.extra.get(def.id) !== def) return;
      this.extra.delete(def.id);
      if (!this.built) return;
      if (this.section === def.id) {
        this.section = 'general';
        if (this.openNow) this.renderContent();
      } else if (this.openNow && this.query.trim()) this.renderContent();
      this.buildNav();
      this.paintNav();
    };
  }

  /** Built-in and registered pages in sidebar order (registration order breaks ties). */
  sections(): SectionDef[] {
    const all = [...BUILTIN_SECTIONS, ...this.extra.values()];
    return all.map((s, i) => ({ s, i })).sort((a, b) => a.s.order - b.s.order || a.i - b.i).map((x) => x.s);
  }

  private sectionById(id: SectionId): SectionDef | undefined {
    return BUILTIN_SECTIONS.find((s) => s.id === id) ?? this.extra.get(id);
  }

  // ---- building ----

  private build(): void {
    if (this.built) return;
    this.built = true;
    const layer = this.b.layer('settings', PANEL_Z);

    const closeBtn = h('button', { type: 'button', class: 'vs-close', 'aria-label': 'Close settings' }, iconBox(ico.close, 'vs-close-ico'));
    setTip(closeBtn, 'Close', 'Esc');
    closeBtn.addEventListener('click', () => this.close());

    this.search = h('input', { type: 'text', role: 'searchbox', class: 'vs-search-input', placeholder: 'Find a setting', 'aria-label': 'Find a setting', spellcheck: 'false', autocomplete: 'off', 'aria-controls': 'vs-main' });
    this.clear = h('button', { type: 'button', class: 'vs-search-clear', 'aria-label': 'Clear search', tabindex: '-1', hidden: true }, iconBox(ico.close, 'vs-clear-ico'));
    setTip(this.clear, 'Clear');
    this.search.addEventListener('input', () => this.onSearch());
    this.search.addEventListener('keydown', (e) => this.onSearchKey(e));
    // Right-click: the menus module's glass editing menu only. Firefox's own window listener
    // (gre/chrome/toolkit/content/global/editMenuOverlay.js) opens its native textbox-contextmenu for
    // any HTML input unless the event was prevented before it, and it runs before the menus module's.
    this.search.addEventListener('contextmenu', (e) => {
      if (this.b.service('menus')) e.preventDefault();
    });
    this.clear.addEventListener('click', () => {
      this.applyQuery('');
      this.search.focus();
    });

    this.nav = h('nav', { class: 'vs-nav', 'aria-label': 'Settings sections' });
    this.buildNav();
    this.nav.addEventListener('keydown', (e) => this.onNavKey(e));

    this.content = h('div', { class: 'vs-content' });
    this.main = h('main', { class: 'vs-main', id: 'vs-main', tabindex: '-1', 'aria-labelledby': 'vs-h1' }, this.content);
    this.main.addEventListener('scroll', () => this.closeListbox(false), { passive: true });
    // The board's 2 px overlay thumb instead of Gecko's scrollbar (src/window/scrollthumb.ts).
    scrollThumb(this.nav);
    scrollThumb(this.main);

    // opaque: a blur this large would otherwise let the sharp page through along the edges (glass.ts).
    const lensEl = h('div', { class: 'vs-lens' });
    lensEl.style.backdropFilter = lens(W, H, { radius: 22, scale: 24, blur: 22, opaque: true });
    this.sheet = h(
      'section',
      { class: 'vs-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vs-title' },
      lensEl,
      h('div', { class: 'vs-tint' }),
      h('div', { class: 'vs-rim' }),
      h(
        'div',
        { class: 'vs-body' },
        h('header', { class: 'vs-titlebar' }, iconBox(ico.settings, 'vs-tico'), h('span', { class: 'vs-ttl', id: 'vs-title', text: 'Settings' }), closeBtn),
        h('div', { class: 'vs-cols' }, this.nav, h('div', { class: 'vs-vsep', 'aria-hidden': 'true' }), this.main),
      ),
    );
    this.sheet.addEventListener('keydown', (e) => this.onSheetKey(e));

    const scrim = h('div', { class: 'vs-scrim', 'aria-hidden': 'true' });
    scrim.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.close();
    });
    this.root = h('div', { class: 'vs-root', id: 'vitre-settings', hidden: true }, scrim, this.sheet);
    layer.append(this.root);

    // Keep focus inside the sheet while it is open (surfaces stacked above it may take it).
    const focusin = (e: FocusEvent): void => {
      if (!this.openNow) return;
      const t = e.target as HTMLElement;
      if (!t || typeof t.closest !== 'function') return;
      if (this.sheet.contains(t)) this.lastInside = t;
      // Ctrl+T, Ctrl+L or F6 opened the address field, which sits under the panel: step aside.
      else if (t === this.b.omni.input || t.closest('#vitre-omni-field')) this.close('stay');
      else if (this.isBeneath(t)) this.reclaimFocus();
    };
    document.addEventListener('focusin', focusin);
    this.b.onDestroy(() => document.removeEventListener('focusin', focusin));
  }

  private buildNav(): void {
    // A page registered or removed while focus is on a sidebar item: keep focus on that item.
    const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('.vs-navitem')?.dataset.id;
    const label = this.nav.querySelector('.vs-search') ?? h('label', { class: 'vs-search' }, iconBox(ico.search, 'vs-search-ico'), this.search, this.clear);
    this.navItems.clear();
    const items: HTMLElement[] = [];
    for (const sec of this.sections()) {
      const item = h('button', { type: 'button', class: 'vs-navitem', 'data-id': sec.id, tabindex: '-1' }, iconBox(sec.icon, 'vs-navico'), h('span', { class: 'vs-navlabel', text: sec.title }));
      item.addEventListener('click', () => this.go(sec.id, false));
      this.navItems.set(sec.id, item);
      items.push(item);
    }
    this.nav.replaceChildren(label, ...items);
    if (focused && this.openNow) (this.navItems.get(focused) ?? this.navItems.get(this.section))?.focus();
  }

  /** Is this element under the panel: the page, the tab bar, or a module layer below panels? */
  private isBeneath(el: HTMLElement): boolean {
    const layer = el.closest<HTMLElement>('.module-layer');
    return !layer || Number(layer.style.zIndex || 0) < PANEL_Z;
  }

  /** Bring focus back into the sheet. A page takes focus asynchronously, so look again shortly after. */
  private reclaimFocus(): void {
    const pull = (): void => {
      const at = document.activeElement as HTMLElement | null;
      if (!this.openNow || (at && (this.sheet.contains(at) || (at !== document.body && at !== document.documentElement && !this.isBeneath(at))))) return;
      const back = this.lastInside;
      (back && this.sheet.contains(back) && this.isTabbable(back) ? back : this.focusables()[0])?.focus();
    };
    pull();
    window.setTimeout(pull, 60);
  }

  private enter(): void {
    window.clearTimeout(this.hideTimer);
    // Downloads' action toggles its panel, so this closes it before Settings takes the window
    // (and it hands focus back to the page, which is where Settings returns it too).
    if (this.b.root.classList.contains('downloads-open')) this.b.run('downloads');
    // Coming back from Downloads (which took over from Settings), keep the original place to return to.
    const active = document.activeElement as HTMLElement | null;
    this.returnFocus = this.handoff ?? (active && active !== document.body && active !== document.documentElement && !this.b.omni.open ? active : null);
    this.handoff = null;
    if (this.b.omni.open) this.b.omni.close(false);
    this.b.closePanels();
    this.openNow = true;
    this.b.root.classList.add('panel-open', 'settings-open');
    this.layout();
    this.root.hidden = false;
    this.root.classList.remove('closing', 'open');
    void this.root.offsetWidth; // start the transition from the closed state
    this.root.classList.add('open');
  }

  /**
   * Focus where it was before Settings opened, if that is still on screen: after a tab switch the
   * old tab's page is hidden and must not take keys, so the current page does.
   */
  private focusBack(el: HTMLElement | null): void {
    let usable = false;
    try {
      usable = !!el && el.isConnected && !this.sheet.contains(el) && el.checkVisibility({ visibilityProperty: true } as any);
      if (usable && el?.localName === 'browser') usable = el === this.b.active()?.browser || el === window.vitrePeek?.browser?.();
    } catch {
      usable = false;
    }
    if (usable) el!.focus();
    else this.b.focusPage();
  }

  /** Centre the sheet; below 992x720 scale it down so it always fits with a margin. */
  private layout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.fit = Math.min(1, (vw - 2 * MARGIN) / W, (vh - 2 * MARGIN) / H);
    this.sheet.style.left = `${Math.round((vw - W) / 2)}px`;
    this.sheet.style.top = `${Math.round((vh - H) / 2)}px`;
    this.sheet.style.transform = this.fit < 1 ? `scale(${this.fit.toFixed(4)})` : '';
  }

  // ---- navigation and pages ----

  private go(id: SectionId, focusNav: boolean): void {
    if (!this.sectionById(id)) return; // a registered page that went away (a stale "Open" in results)
    this.section = id;
    this.setQuery('');
    this.paintNav();
    this.renderContent();
    if (focusNav) this.navItems.get(id)?.focus();
  }

  private paintNav(): void {
    const searching = !!this.query.trim();
    for (const [id, item] of this.navItems) {
      const on = id === this.section;
      if (on && !searching) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
      item.tabIndex = on ? 0 : -1;
    }
  }

  private dispose(): void {
    this.updaters.clear();
    for (const fn of this.disposers.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error('Deer settings: a page failed to clean up', e);
      }
    }
  }

  private renderContent(): void {
    capture.active?.cancel(false);
    this.closeListbox(false);
    this.dispose();
    const q = this.query.trim();
    const sec = this.sectionById(this.section) ?? BUILTIN_SECTIONS[0];
    let nodes: Node[];
    try {
      nodes = q ? this.resultsView(q) : this.sectionView(sec);
    } catch (e) {
      console.error(`Deer settings: page "${sec.id}" failed`, e);
      nodes = [h('h1', { class: 'vs-h1', id: 'vs-h1', text: sec.title }), h('p', { class: 'vs-intro vs-empty', text: 'This page could not be shown.' })];
    }
    this.content.replaceChildren(...nodes);
    this.content.dataset.page = q ? 'results' : sec.id;
    this.main.scrollTop = 0;
  }

  private sectionView(sec: SectionDef): Node[] {
    const out: Node[] = [sec.header ? sec.header(this.ctx) : h('h1', { class: 'vs-h1', id: 'vs-h1', text: sec.title })];
    if (sec.intro) out.push(h('p', { class: 'vs-intro', text: sec.intro }));
    if (sec.render) {
      const host = h('div', { class: 'vs-ext', 'data-page': sec.id });
      const done = sec.render(host);
      if (typeof done === 'function') this.disposers.push(done);
      out.push(host);
      return out;
    }
    for (const g of sec.groups(this.ctx)) {
      if (g.title) out.push(heading(g.title));
      const c = card(...g.rows.map((r) => r.build(this.ctx)));
      if (g.anchor) c.dataset.anchor = g.anchor;
      out.push(c);
    }
    return out;
  }

  /** "Find a setting": matching rows from every page, under their page and group names. */
  private resultsView(q: string): Node[] {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rebind = this.b.settings.rebind ?? {};
    const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' ').toLowerCase();
    const matches = (r: RowDef): boolean => {
      if (r.unlisted) return false;
      const text = hay(r.title, r.desc, r.keywords);
      return terms.every((t) => text.includes(t)) || matchesKeys(r, q, rebind);
    };
    const out: Node[] = [h('h1', { class: 'vs-h1', id: 'vs-h1', text: 'Results' })];
    let found = 0;
    for (const sec of this.sections()) {
      if (sec.render) {
        // A registered page draws itself: it is found by its title and keywords and opens whole.
        const text = hay(sec.title, sec.keywords);
        if (!terms.every((t) => text.includes(t))) continue;
        found++;
        const open = h('button', { type: 'button', class: 'vs-link vs-go', onclick: () => this.go(sec.id, false) }, 'Open', iconBox(ico.chevronRight, 'vs-go-ico'));
        const r = h('div', { class: 'vs-row has-ico' }, iconBox(sec.icon, 'vs-ico'), h('div', { class: 'vs-text' }, h('span', { class: 'vs-title', text: sec.title })), open);
        out.push(heading(sec.title), card(r));
        continue;
      }
      for (const g of sec.groups(this.ctx)) {
        const hits = g.rows.filter(matches);
        if (!hits.length) continue;
        found += hits.length;
        out.push(heading(g.title && g.title !== sec.title ? `${sec.title} › ${g.title}` : sec.title));
        out.push(card(...hits.map((r) => r.build(this.ctx))));
      }
    }
    if (!found) out.push(h('p', { class: 'vs-intro vs-empty', text: `No settings match “${q}”.` }));
    return out;
  }

  private setQuery(q: string): void {
    this.query = q;
    if (this.search && this.search.value !== q) this.search.value = q;
    if (this.clear) this.clear.hidden = !q;
  }

  private applyQuery(q: string): void {
    this.setQuery(q);
    this.paintNav();
    this.renderContent();
  }

  private onSearch(): void {
    this.applyQuery(this.search.value);
  }

  private onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !e.repeat && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      // Esc in the field clears it first, then closes the panel.
      e.preventDefault();
      if (this.search.value) this.applyQuery('');
      else this.close();
    } else if (e.key === 'Enter' || e.key === 'ArrowDown') {
      // Into the results; with nothing typed, Down goes on to the sections under the field.
      const target = this.query.trim()
        ? [...this.main.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => this.isTabbable(el))
        : e.key === 'ArrowDown'
          ? this.navItems.get(this.section)
          : undefined;
      if (target) {
        e.preventDefault();
        target.focus();
      }
    }
  }

  private onNavKey(e: KeyboardEvent): void {
    const items = [...this.navItems.values()];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = ({ ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
    if (j === undefined) return;
    e.preventDefault();
    const next = items[(j + items.length) % items.length];
    this.go(next.dataset.id as SectionId, true);
  }

  private onSheetKey(e: KeyboardEvent): void {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.defaultPrevented) this.trapTab(e); // a drop-down list may have used it already
  }

  /** Ctrl+F goes to the topmost surface: here, "Find a setting". */
  findSetting(): void {
    if (!this.openNow) return;
    this.search.focus();
    this.search.select();
  }

  private focusInitial(anchor?: string, toSearch = false): void {
    requestAnimationFrame(() => {
      if (!this.openNow) return;
      if (toSearch) {
        this.search.focus();
        return;
      }
      const target = anchor ? this.content.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`) : null;
      if (target) {
        target.scrollIntoView({ block: 'nearest' });
        const first = [...target.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => this.isTabbable(el));
        (first ?? this.main).focus();
        return;
      }
      // Focus left on another page's sidebar item (open(id) while the panel is open) follows the page.
      const at = document.activeElement as HTMLElement | null;
      const staleNav = !!at?.classList?.contains('vs-navitem') && at !== this.navItems.get(this.section);
      if (!this.sheet.contains(at) || at === this.sheet || staleNav) this.navItems.get(this.section)?.focus();
    });
  }

  // ---- focus ----

  private isTabbable(el: HTMLElement): boolean {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[hidden]')) return false;
    return el.getClientRects().length > 0;
  }

  private focusables(): HTMLElement[] {
    return [...this.sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => this.isTabbable(el));
  }

  private trapTab(e: KeyboardEvent): void {
    const list = this.focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || !this.sheet.contains(at))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (at === last || !this.sheet.contains(at))) {
      e.preventDefault();
      first.focus();
    }
  }

  // ---- drop-down lists ----

  private openListbox(anchor: HTMLElement, options: Option[], selected: string, pick: (v: string) => void): void {
    const wasOpenHere = this.popup?.anchor === anchor;
    this.closeListbox(false);
    if (wasOpenHere || !options.length) return;

    const items = options.map((o) => h('div', { class: 'vs-opt', role: 'option', id: uid('vs-opt'), 'data-value': o.value, 'aria-selected': String(o.value === selected) }, h('span', { text: o.label })));
    const list = h('div', { class: 'vs-pop', role: 'listbox', tabindex: '-1', 'aria-labelledby': anchor.id }, ...items);
    let active = Math.max(0, options.findIndex((o) => o.value === selected));
    const setActive = (i: number): void => {
      active = (i + items.length) % items.length;
      items.forEach((el, j) => el.classList.toggle('active', j === active));
      list.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    };
    const choose = (i: number): void => {
      this.closeListbox(true);
      pick(options[i].value);
    };
    items.forEach((el, i) => {
      el.addEventListener('mousemove', () => i !== active && setActive(i));
      el.addEventListener('click', () => choose(i));
    });
    list.addEventListener('keydown', (e) => {
      const n = items.length;
      const step = ({ ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 } as Record<string, number>)[e.key];
      if (step !== undefined) {
        e.preventDefault();
        setActive(Math.max(0, Math.min(n - 1, active + step)));
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : n - 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(active);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.closeListbox(true);
      } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey) {
        // Type-ahead: the next choice starting with that letter.
        const k = e.key.toLowerCase();
        for (let d = 1; d <= n; d++) {
          const j = (active + d) % n;
          if (options[j].label.toLowerCase().startsWith(k)) {
            setActive(j);
            break;
          }
        }
      }
    });

    this.sheet.append(list);
    const sr = this.sheet.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const f = this.fit;
    list.style.minWidth = `${ar.width / f}px`;
    const w = list.offsetWidth;
    const hgt = list.offsetHeight;
    const x = Math.min((ar.left - sr.left) / f, W - 8 - w);
    const below = (ar.bottom - sr.top) / f + 4;
    const above = (ar.top - sr.top) / f - 4 - hgt;
    list.style.left = `${Math.max(8, x)}px`;
    list.style.top = `${below + hgt <= H - 8 || above < 8 ? below : above}px`;
    setActive(active);

    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!list.contains(t) && !anchor.contains(t)) this.closeListbox(false);
    };
    document.addEventListener('mousedown', onDown, true);
    const offEsc = this.b.addEscLayer(LISTBOX_LAYER, () => {
      this.closeListbox(true);
      return true;
    });
    anchor.setAttribute('aria-expanded', 'true');
    this.popup = {
      el: list,
      anchor,
      done: () => {
        offEsc();
        document.removeEventListener('mousedown', onDown, true);
      },
    };
    list.focus();
  }

  private closeListbox(focusAnchor: boolean): void {
    const p = this.popup;
    if (!p) return;
    this.popup = null;
    p.done();
    p.el.remove();
    p.anchor.setAttribute('aria-expanded', 'false');
    if (focusAnchor) p.anchor.focus();
  }
}
