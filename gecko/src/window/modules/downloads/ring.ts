// The downloads ring: a 44 px glass circle at the bottom right (right 72, bottom 20: 1324,836 in a
// 1440x900 window, board Home) shown over pages and Home while anything downloads, with the overall
// progress as an arc; it hides 6 s after the last download finishes (decided with the user,
// DESIGN-NOTES "Right-click menus"). Click: the quick view (board DownloadsPopover); right-click or
// Shift+F10: the ring menu (opens up and to the left, right edge 1368, bottom 828). New downloads
// fly into it as a 32 px glass file-type circle (480 ms on the spring) and it pulses 1 -> 1.06 -> 1.
// Port of app/src/renderer/modules/downloads/ring.ts.
//
// Needing the person (spikes/downloader/RESUME-DESIGN.md 6, Phase 3): an 8 px dot on the ring for rows
// that started needing the person during this session (Link expired, File changed, Start it again from
// its page; view.attention), never a dialog; the ring stays shown while there is one, and its label
// becomes "Downloads, 1 needs attention". A polite live region beside it says when a row starts needing
// the person and when a start again continued a row ("Continuing song.mp3 from 62%").
//
// Waiting rows (RESUME-DESIGN.md G4, Phase 4: Waiting for network, Retrying) count as active
// (format.ts isActive): the ring stays shown, its arc includes them and Pause all reaches them; their
// quick view row offers Try now.
//
// macOS, One row (window/onerow.ts; Mac canvas boards RowSpec, RowDownloads): the ring is a 36 px
// capsule at the row's right end (#vitre-row-end, first, before Extensions), in the row's glass over the
// page, and it is always there: "shown" only brings the arc (while anything downloads, then 6 s). The
// quick view hangs 8 px under the capsule with their right edges aligned, the menu too (below it, not
// above), and takes the capsule's theme (Popover.paintTheme: the row's, or in split view the other
// side's page's when the capsule is over it). The bar may build #vitre-row-end after this module installs: the capsule waits for it. The
// open quick view holds the row (b.bar.hold, reveal.ts), as the menus and extension popups that hang
// from the row do. In window full screen, while macOS's menu bar is down, the row moves down by
// --vitre-row-shift (reveal.ts, skin/bar.css) and the quick view with it: Popover.place measures
// layout boxes only, which no translate moves, and skin/bar.css translates #layer-downloads-pop as
// it does #layer-bar, so the shift counts once, at every frame of the slide.
import type { Browser } from '../../browser';
import { el, svg } from '../../dom';
import { glass, lens } from '../../glass';
import { CAP_H, CAP_TOP, EDGE, oneRow } from '../../onerow';
import { isMac, revealLabel } from '../../../shared/os';
import type { DownloadView } from '../../../modules/downloads/types';
import * as f from './format';
import { ic, node } from './icons';
import { closeMenu, openMenu, type MenuEntry } from './menu';
import { needAttention, type Panel } from './panel';
import type { DownloadStore } from './store';

const CIRC = 2 * Math.PI * 14;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const HIDE_AFTER = 6000;
/** macOS One row: the quick view's width and corner (board RowDownloads). */
const ROW_POP_W = 380;
const ROW_POP_RADIUS = 16;
const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * macOS One row: call `fn` with the row's right end (#vitre-row-end, made by the bar) once it exists.
 * The bar may build it after this module's install, so a watch on #vitre-root waits for it.
 */
function whenRowEnd(b: Browser, fn: (end: HTMLElement) => void): void {
  const found = document.getElementById('vitre-row-end');
  if (found) {
    fn(found);
    return;
  }
  const watch = new MutationObserver(() => {
    const end = document.getElementById('vitre-row-end');
    if (!end) return;
    watch.disconnect();
    fn(end);
  });
  watch.observe(b.root, { childList: true, subtree: true });
  b.onDestroy(() => watch.disconnect());
}

export class Ring {
  readonly el: HTMLElement;
  /** macOS One row: the capsule at the row's right end (see the header) instead of the corner ring. */
  readonly row = oneRow();
  private btn: HTMLButtonElement;
  private arc: SVGCircleElement;
  private shown = false;
  private hideTimer = 0;
  readonly pop: Popover;
  /** The polite live region (outside the ring, which is inert while hidden). */
  private live: HTMLElement;
  /** What each row needed at the last update (row id -> its state's words), to say only what is new. */
  private needs: Map<string, string> | null = null;

  constructor(
    private b: Browser,
    private store: DownloadStore,
    private panel: Panel
  ) {
    const layer = b.layer('downloads-ring', 11);
    // One row: a capsule of the row (css.ts, macOS block), no lens map of its own: skin/bar.css gives
    // it the capsules' CSS blur over the page.
    this.el = el('div', { class: 'vd-ring' });
    if (!this.row) glass(this.el).lens.style.backdropFilter = lens(44, 44);
    const face = svg(
      `<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" focusable="false"><circle class="track" cx="17" cy="17" r="14" fill="none" stroke-width="2"/><g class="spin"><circle class="arc" cx="17" cy="17" r="14" fill="none" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 ${CIRC.toFixed(2)}" transform="rotate(-90 17 17)"/></g><path d="M17 11.5v9M13.6 17.2 17 20.6l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    );
    // data-bar-stop: a keyboard stop of the tab bar, after + (src/window/barkeys.ts header).
    this.btn = el('button', { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': 'Downloads', 'data-bar-stop': '' }, face);
    this.el.append(this.btn, el('span', { class: 'vd-ring-dot', 'aria-hidden': 'true' }));
    this.live = el('span', { class: 'vd-live', role: 'status', 'aria-live': 'polite' });
    if (this.row) {
      // First in the row's right end; the extensions capsule puts itself after it (extensions/bar.ts).
      this.btn.setAttribute('aria-expanded', 'false');
      layer.append(this.live);
      whenRowEnd(b, (end) => end.prepend(this.el));
    } else {
      this.el.setAttribute('inert', '');
      layer.append(this.el, this.live);
    }
    this.arc = face.querySelector('.arc') as SVGCircleElement;
    this.pop = new Popover(b, store, panel, this);
    // The panel is the topmost surface: the quick view under it would take the first Esc.
    panel.onShow(() => this.pop.close(false));
    this.btn.addEventListener('click', (e) => this.pop.toggle(e.detail === 0));
    this.btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.menu(false);
    });
    this.btn.addEventListener('keydown', (e) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault();
        this.menu(true);
      }
    });
    store.subscribe(() => this.update());
    // The menus module's anchor router may hang native popups from the ring (none today).
    b.setAnchor('downloads', () => (this.row || this.shown ? this.el : null));
  }

  /** Window coordinates of the ring's centre (also while it is hidden). */
  center(): { x: number; y: number } {
    if (this.row) {
      const r = this.el.getBoundingClientRect();
      if (r.width) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      // Not in the row yet: where the row's first right-end capsule would be with nothing after it.
      return { x: window.innerWidth - EDGE - CAP_H / 2, y: CAP_TOP + CAP_H / 2 };
    }
    return { x: window.innerWidth - 72 - 22, y: window.innerHeight - 20 - 22 };
  }

  /** One row: the capsule looks pressed while its quick view hangs from it (board RowDownloads). */
  markOpen(open: boolean): void {
    if (!this.row) return;
    this.el.classList.toggle('open', open);
    this.btn.setAttribute('aria-expanded', String(open));
  }

  get isShown(): boolean {
    return this.shown;
  }

  update(): void {
    const views = this.store.all();
    const active = views.filter(f.isActive);
    // Rows that started needing the person this session: the dot, and the ring stays (RESUME-DESIGN.md 6).
    const attention = views.filter((v) => v.attention).length;
    if (active.length || attention) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
      this.show();
    } else if (this.shown && !this.hideTimer) {
      this.hideTimer = window.setTimeout(() => {
        this.hideTimer = 0;
        if (!this.pop.isOpen && !this.store.all().some((v) => f.isActive(v) || v.attention)) this.hide();
      }, HIDE_AFTER);
    }
    this.el.classList.toggle('attention', attention > 0);
    this.sayNeeds(views);
    const known = active.filter((v) => v.total > 0);
    const total = known.reduce((n, v) => n + v.total, 0);
    const got = known.reduce((n, v) => n + Math.min(v.received, v.total), 0);
    const pct = active.length ? (total ? got / total : 0) : 1;
    const spinning = active.length > 0 && !known.length && active.some((v) => v.state === 'downloading');
    this.el.classList.toggle('indeterminate', spinning);
    this.arc.setAttribute('stroke-dasharray', `${((spinning ? 0.25 : Math.max(pct, active.length ? 0.02 : 1)) * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`);
    // Waiting rows are said apart (review of Phase 4): "Downloads, 1 waiting, 13 percent", "1 active, 1 waiting, 40 percent".
    const waits = active.filter(f.isWaiting).length;
    const under = [active.length > waits ? `${active.length - waits} active` : '', waits ? `${waits} waiting` : ''].filter(Boolean).join(', ');
    const running = active.length ? `${under}${known.length ? `, ${Math.floor(pct * 100)} percent` : ''}` : '';
    // One row: the capsule is there with nothing to say too; "finished" only while the arc shows.
    const idle = this.row && !this.shown ? 'Downloads' : 'Downloads, finished';
    const label = attention ? `Downloads, ${needAttention(attention)}${running ? `, ${running}` : ''}` : running ? `Downloads, ${running}` : idle;
    this.btn.setAttribute('aria-label', label);
    this.pop.render();
  }

  /** One sentence for screen readers (the polite live region): a row that needs the person, an attach. */
  announce(text: string): void {
    f.setText(this.live, '');
    window.setTimeout(() => f.setText(this.live, text), 50);
  }

  /** Rows that start needing the person are said once (RESUME-DESIGN.md 6); those already there when the window opened are not. */
  private sayNeeds(views: DownloadView[]): void {
    const now = new Map<string, string>();
    for (const v of views) if (v.attention) now.set(v.id, needWords(v));
    const before = this.needs;
    this.needs = now;
    if (!before) return;
    const fresh = views.filter((v) => now.has(v.id) && before.get(v.id) !== now.get(v.id));
    if (fresh.length) this.announce(fresh.map((v) => `${v.filename}: ${now.get(v.id)}`).join('. '));
  }

  show(): void {
    if (this.shown) return;
    this.shown = true;
    if (!this.row) this.el.removeAttribute('inert');
    this.el.classList.add('shown');
  }

  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('shown');
    if (this.row) {
      // The capsule stays in the row (and keeps the keyboard): only the arc goes.
      this.btn.setAttribute('aria-label', 'Downloads');
      return;
    }
    this.el.setAttribute('inert', '');
    if (this.el.contains(document.activeElement)) this.b.focusPage();
  }

  pulse(): void {
    if (reduced()) return;
    this.el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
  }

  /** A new download: a small glass circle carries its file type from where it started to the ring. */
  fly(from: { x: number; y: number } | null, view: DownloadView): void {
    this.show();
    if (reduced() || !from) {
      this.pulse();
      return;
    }
    const to = this.center();
    const dot = el('div', { class: 'vd-flight' }, el('span', {}, f.tile(view.filename)));
    glass(dot).lens.style.backdropFilter = lens(32, 32);
    this.b.layer('downloads-flight', 45).append(dot);
    const at = (p: { x: number; y: number }, s: number): string => `translate(${p.x - 16}px, ${p.y - 16}px) scale(${s})`;
    // The fade is on the label only: opacity on the glass element itself would blind its lens.
    const label = dot.lastElementChild as HTMLElement;
    label.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 480, fill: 'forwards' });
    dot.animate([{ transform: at(from, 1) }, { transform: at(to, 0.82) }], { duration: 480, easing: SPRING, fill: 'forwards' }).onfinish = () => {
      dot.remove();
      this.pulse();
    };
  }

  menu(keyboard: boolean): void {
    this.pop.close(false);
    const views = this.store.all();
    const anyActive = views.some(f.isActive);
    const anyPaused = views.some((v) => v.state === 'paused');
    const copied = this.store.engine.clipboardUrl();
    const entries: MenuEntry[] = [
      // macOS prints the Mac chord (⌥⌘L) as the key router has it.
      { label: 'Show downloads', access: 's', key: isMac ? (this.b.keys?.label('downloads') ?? '') : 'Ctrl+J', icon: 'download', run: () => this.panel.show() },
      { label: 'Open Downloads folder', access: 'f', icon: 'folder', run: () => this.store.engine.openFolder() },
      'separator',
      anyActive || !anyPaused
        ? { label: 'Pause all', access: 'p', icon: 'pause', disabled: !anyActive, run: () => this.store.pauseAll() }
        : { label: 'Resume all', access: 'r', icon: 'play', run: () => this.store.resumeAll() },
    ];
    if (copied) entries.push({ label: 'Download copied link', access: 'd', icon: 'link', run: () => void this.store.start(copied, { origin: this.center() }) });
    entries.push({ label: 'Clear finished', access: 'c', disabled: !views.some(f.isFinished), run: () => this.store.clearFinished() });
    // Opens up and to the left: right edge at the ring's right, bottom 8 px above it. One row: 8 px
    // under the capsule, right edges aligned, as the quick view.
    openMenu(this.b, 'Downloads', entries, { at: this.el, align: this.row ? 'end' : 'above-end' }, { keyboard, owner: this.el, returnFocus: this.btn });
  }

  focus(): void {
    this.btn.focus();
  }
}

/** The quick view above the ring (board DownloadsPopover): what is downloading now and what just finished. */
class Popover {
  private el: HTMLElement | null = null;
  private catcher: HTMLElement | null = null;
  private rows = new Map<string, HTMLElement>();
  private height = 0;
  private unEsc: (() => void) | null = null;
  private unFocus: (() => void) | null = null;
  /** One row: ends the bar hold taken while the quick view is open (see open()). */
  private releaseBar: (() => void) | null = null;
  /** One row: stops following the capsule's theme (paintTheme). */
  private unTheme: (() => void) | null = null;

  constructor(
    private b: Browser,
    private store: DownloadStore,
    private panel: Panel,
    private ring: Ring
  ) {}

  get isOpen(): boolean {
    return !!this.el;
  }

  toggle(keyboard: boolean): void {
    if (this.el) this.close(true);
    else this.open(keyboard);
  }

  open(keyboard: boolean): void {
    closeMenu(this.b);
    // One row: the quick view hangs from the row, which stays in place while it is open (in place at
    // once, for place() below), as menus/index.ts, extensions/bar.ts and Peek hold it. Not on Windows:
    // there the quick view stands over the corner ring, and a hold would bring an auto-hidden or full
    // screen bar in (reveal.ts show()).
    if (this.ring.row) this.releaseBar ??= this.b.bar.hold('downloads-pop', true);
    this.store.reload();
    const layer = this.b.layer('downloads-pop', 30);
    this.catcher = el('div', { class: 'vd-menu-catcher' });
    this.catcher.addEventListener('pointerdown', () => this.close(false));
    const openBtn = el('button', { type: 'button', class: 'vd-pop-open' }, 'Open Downloads');
    const elm = el(
      'section',
      { class: 'vd-pop', role: 'dialog', 'aria-label': 'Downloads', tabindex: '-1' },
      el('div', { class: 'vd-pop-body' }, el('div', { class: 'vd-pop-head' }, el('b', {}, 'Downloads'), el('span', { class: 'vd-pop-sum' })), el('div', { class: 'vd-pop-list' }), openBtn)
    );
    glass(elm);
    // One row: it hangs under the capsule (css.ts, macOS block; place() sets top and right), in the
    // capsule's theme, which follows the root's theme-* and, in split view, the over-* that bar.ts
    // paintRowSplit puts on the capsule without a render (every divider move): both are watched.
    if (this.ring.row) {
      elm.classList.add('under-row');
      this.paintTheme(elm);
      const watch = new MutationObserver(() => this.paintTheme(elm));
      watch.observe(this.ring.el, { attributes: true, attributeFilter: ['class'] });
      watch.observe(this.b.root, { attributes: true, attributeFilter: ['class'] });
      this.unTheme = () => watch.disconnect();
    }
    layer.append(this.catcher, elm);
    this.el = elm;
    this.rows.clear();
    this.height = 0;
    this.ring.markOpen(true);
    openBtn.addEventListener('click', () => {
      this.close(false);
      this.panel.show();
    });
    elm.addEventListener('keydown', (e) => this.keys(e));
    this.unEsc = this.b.addEscLayer(30, () => {
      this.close(true);
      return true;
    });
    // Another Deer surface took the keyboard (the switcher's search, find, the address field): the
    // quick view gives way, or it would stay under that surface and take its first Esc.
    const lost = (e: FocusEvent): void => {
      const t = e.target as Element | null;
      if (t && this.b.root.contains(t) && !elm.contains(t) && !this.ring.el.contains(t)) this.close(false);
    };
    document.addEventListener('focusin', lost, true);
    this.unFocus = () => document.removeEventListener('focusin', lost, true);
    this.render();
    if (!reduced()) {
      // From the ring below it; one row: from the capsule above it.
      const from = this.ring.row ? 'translate(0, -6px) scale(0.96)' : 'translate(4px, 6px) scale(0.96)';
      elm.animate([{ transform: from }, { transform: 'none' }], { duration: 240, easing: SPRING });
      (elm.querySelector('.vd-pop-body') as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'cubic-bezier(0.2,0,0,1)' });
    }
    const first = elm.querySelector<HTMLElement>('.vd-pop-row') ?? openBtn;
    if (keyboard) first.focus();
    else elm.focus();
  }

  close(focusRing: boolean): void {
    const elm = this.el;
    if (!elm) return;
    this.el = null;
    this.unEsc?.();
    this.unEsc = null;
    this.unFocus?.();
    this.unFocus = null;
    this.releaseBar?.();
    this.releaseBar = null;
    this.unTheme?.();
    this.unTheme = null;
    this.catcher?.remove();
    this.catcher = null;
    this.ring.markOpen(false);
    elm.style.pointerEvents = 'none';
    const hadFocus = elm.contains(document.activeElement);
    elm.animate([{ transform: 'none' }, { transform: 'scale(0.985)' }], { duration: reduced() ? 150 : 120, fill: 'forwards' }).onfinish = () => elm.remove();
    if (focusRing) this.ring.focus();
    else if (hadFocus) this.b.focusPage();
    this.ring.update();
  }

  render(): void {
    const elm = this.el;
    if (!elm) return;
    const views = this.store.all().filter((v) => v.state !== 'cancelled');
    // Waiting rows (G4) are said apart from what transfers: "1 active · 2.1 MB/s · 1 waiting".
    const waiting = views.filter(f.isWaiting).length;
    const active = views.filter((v) => f.isActive(v) && !f.isWaiting(v));
    const rate = active.reduce((n, v) => n + v.speed, 0);
    // Not "All done" while rows wait for the person (RESUME-DESIGN.md 6).
    // A Damaged file needs the person too (Phase 5).
    const attention = views.filter((v) => (v.state === 'paused' && !!v.need) || f.isDamaged(v)).length;
    const under = [active.length ? `${active.length} active${rate > 0 ? ` · ${f.speed(rate)}` : ''}` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean).join(' · ');
    f.setText(elm.querySelector('.vd-pop-sum'), under || (attention ? needAttention(attention) : views.length ? 'All done' : 'Nothing yet'));
    const pick = views.slice(0, 3);
    const list = elm.querySelector('.vd-pop-list') as HTMLElement;
    const keep = new Set(pick.map((v) => v.id));
    for (const [id, row] of this.rows) {
      if (!keep.has(id)) {
        row.remove();
        this.rows.delete(id);
      }
    }
    const order = pick.map((v) => v.id).join('|');
    for (const v of pick) {
      let row = this.rows.get(v.id);
      if (!row) {
        row = this.row(v.id);
        this.rows.set(v.id, row);
      }
      this.update(row, v);
    }
    // Rebuild the order only when it changed, so a row is never moved under the pointer.
    if (list.dataset.order !== order) {
      list.dataset.order = order;
      list.replaceChildren();
      pick.forEach((v, i) => {
        if (i) list.append(el('div', { class: 'vd-pop-sep' }));
        list.append(this.rows.get(v.id) as HTMLElement);
      });
      if (!pick.length) list.append(el('div', { class: 'vd-pop-empty' }, 'Downloads you start appear here.'));
    }
    if (this.ring.row) this.place(elm);
    const h = elm.offsetHeight;
    if (h !== this.height) {
      this.height = h;
      const [w, radius] = this.ring.row ? [ROW_POP_W, ROW_POP_RADIUS] : [360, 20];
      (elm.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(w, h, { radius, scale: 24, blur: 14, opaque: true });
    }
  }

  /**
   * One row: the quick view in the theme of the Downloads capsule it hangs from (css.ts, class
   * row-light): light glass under a light capsule (the row's theme-light, or over-light when the
   * capsule is over the other side's light page in split view; over-dark and over-clear win over the
   * row's light), dark glass otherwise and always in a private window.
   */
  private paintTheme(elm: HTMLElement): void {
    const ring = this.ring.el.classList;
    const overDark = ring.contains('over-dark') || ring.contains('over-clear');
    const light = !this.b.isPrivate && (ring.contains('over-light') || (this.b.root.classList.contains('theme-light') && !overDark));
    elm.classList.toggle('row-light', light);
  }

  /**
   * One row: 8 px under the Downloads capsule, right edges aligned (board RowDownloads). Again at every
   * render: the capsule's right edge moves when the extensions capsule after it grows or shrinks.
   * Layout boxes only (offsetLeft and offsetTop up to #vitre-root, which fills the window), never
   * getBoundingClientRect, so no transform moves it: not the capsule's pulse (scale 1.06), and not the
   * full-screen shift under macOS's menu bar (the translate on #layer-bar). That shift reaches the
   * quick view through its own layer instead (skin/bar.css translates #layer-downloads-pop by the same
   * --vitre-row-shift), whenever it was placed: measured here as well, it would count twice.
   */
  private place(elm: HTMLElement): void {
    const ring = this.ring.el;
    if (!ring.offsetParent || !ring.offsetWidth) return;
    let x = 0;
    let y = 0;
    for (let n: HTMLElement | null = ring; n && n !== this.b.root; n = n.offsetParent as HTMLElement | null) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    elm.style.top = `${Math.round(y + ring.offsetHeight + 8)}px`;
    elm.style.right = `${Math.round(window.innerWidth - (x + ring.offsetWidth))}px`;
  }

  private row(id: string): HTMLElement {
    const btn = el('button', { type: 'button', class: 'vd-round', tabindex: '-1' });
    const row = el(
      'div',
      { class: 'vd-pop-row', tabindex: '-1', 'data-id': id },
      el('span', { class: 'vd-tile' }),
      el('div', { class: 'vd-pop-info' }, el('span', { class: 'vd-pop-name' }), el('div', { class: 'vd-pop-segs' }), el('span', { class: 'vd-pop-meta' })),
      btn
    );
    row.addEventListener('click', (e) => {
      if ((e.target as Element).closest('button')) return;
      this.close(false);
      this.panel.show(id);
    });
    btn.addEventListener('click', () => {
      const v = this.store.get(id);
      if (!v) return;
      // A File changed row's choice is made in the panel (RESUME-DESIGN.md 6: no destructive verb here), and
      // so is a Changed after download row's Restore original (Phase 5).
      if (v.need?.kind === 'choice' || f.isEdited(v)) {
        this.close(false);
        this.panel.choose(id, f.isEdited(v) ? 'restore' : 'start-over');
        return;
      }
      // Refresh address that finds nothing and has no page to open: the panel's address field.
      void this.store.primary(v)?.then((kind) => {
        if (kind !== 'none') return;
        this.close(false);
        this.panel.openAddress(id);
      });
    });
    return row;
  }

  private update(row: HTMLElement, v: DownloadView): void {
    // A row Firefox moved keeps none of its bytes: nothing to show a bar for (Start it again from its page). One of
    // Deer's whose page may need the person to sign in (Phase 7) keeps its bar.
    const done = f.isFinished(v) || (v.need?.kind === 'page' && v.engine !== 'vitre');
    row.classList.toggle('done', done);
    f.setText(row.querySelector('.vd-tile'), f.tile(v.filename));
    f.setText(row.querySelector('.vd-pop-name'), v.filename);
    const segs = row.querySelector('.vd-pop-segs') as HTMLElement;
    const fills = done ? [] : v.segments.length > 1 && v.maxConnections > 1 ? v.segments : v.total > 0 ? [v.received / v.total] : [];
    segs.hidden = !fills.length;
    segs.classList.toggle('dim', v.state === 'paused');
    segs.classList.toggle('single', fills.length === 1);
    if (segs.childElementCount !== fills.length) segs.replaceChildren(...fills.map(() => el('span', {}, el('i', {}))));
    fills.forEach((x, i) => ((segs.children[i].firstElementChild as HTMLElement).style.width = `${Math.round(Math.min(1, x) * 100)}%`));
    f.setText(row.querySelector('.vd-pop-meta'), meta(v));
    const btn = row.querySelector('button') as HTMLElement;
    // Renewing link: Pause; Link expired: Refresh address; Waiting for link and Start it again from its
    // page: Open page; as store.primary() runs them (RESUME-DESIGN.md 6).
    const [k, label, icon] =
      f.isDamaged(v) && !v.phase
        ? v.check?.site === 'changed' ? ['d', 'Download again', ic.retry] : ['h', 'Repair', ic.retry]
        : f.isEdited(v) && !v.phase
          ? ['s', 'Restore original', ic.chevron]
      : v.state === 'downloading' || v.state === 'starting' || v.phase === 'renewing'
        ? ['p', 'Pause', ic.pause(12)]
        : v.state === 'queued'
          ? ['n', 'Start now', ic.play(12)]
          : v.need?.kind === 'page' || (v.need?.kind === 'address' && v.armed)
            ? ['o', 'Open page', ic.open]
          : v.need?.kind === 'address'
            ? v.canRenew ? ['e', 'Refresh address', ic.retry] : ['t', 'Retry', ic.retry]
            : v.need?.kind === 'choice'
              ? ['c', 'Choose', ic.chevron]
              : f.isWaiting(v)
                ? ['y', 'Try now', ic.retry]
              : v.state === 'paused'
                ? ['r', 'Resume', ic.play(12)]
                : v.state === 'completed' && !v.missing
                  ? ['f', revealLabel(), ic.folder(14, 1.6)]
                  : ['t', 'Retry', ic.retry];
    if (btn.dataset.k !== k) {
      btn.dataset.k = k;
      btn.replaceChildren(node(icon));
    }
    btn.setAttribute('aria-label', `${label} ${v.filename}`);
    row.setAttribute('aria-label', `${v.filename}, ${meta(v)}`);
  }

  private keys(e: KeyboardEvent): void {
    const elm = this.el;
    if (!elm) return;
    const items = Array.from(elm.querySelectorAll<HTMLElement>('.vd-pop-row, .vd-pop-open'));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focused = document.activeElement as HTMLElement | null;
    if (e.key === 'ArrowDown') items[Math.min(items.length - 1, i + 1)]?.focus();
    else if (e.key === 'ArrowUp') items[Math.max(0, i - 1)]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Enter' && focused?.classList.contains('vd-pop-row')) focused.click();
    else if (e.key === ' ' && focused?.classList.contains('vd-pop-row')) {
      // Space is the row's own button: pause, resume, start now, show in folder or retry.
      (focused.querySelector('.vd-round') as HTMLElement | null)?.click();
    } else if (e.key === 'Tab') {
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    } else return;
    e.preventDefault();
  }
}

/** A row that needs the person, in the panel's words (RESUME-DESIGN.md 6). */
function needWords(v: DownloadView): string {
  if (v.need?.kind === 'address') return v.armed ? 'Waiting for link' : 'Link expired';
  if (v.need?.kind === 'choice') return 'File changed';
  // Armed by Open page, a row whose page may need a sign-in (Phase 7) is Waiting for link too.
  if (v.need?.kind === 'page') return v.armed ? 'Waiting for link' : 'Start it again from its page';
  if (v.need?.kind === 'repair') return 'Damaged';
  return 'Needs attention';
}

function meta(v: DownloadView): string {
  const of = v.total > 0 ? `${f.bytes(v.received)} of ${f.bytes(v.total)}` : f.bytes(v.received);
  // A finished file (RESUME-DESIGN.md 6, Phase 5): Repairing, Checking, Damaged, Changed after download.
  if (v.state === 'completed' && !v.missing && v.phase === 'repairing') return 'Repairing';
  if (v.state === 'completed' && !v.missing && v.phase === 'checking') return [f.bytes(v.total), 'Checking'].filter(Boolean).join(' · ');
  if (f.isDamaged(v)) return [f.bytes(v.total), 'Damaged'].filter(Boolean).join(' · ');
  if (f.isEdited(v)) return 'Changed after download';
  if (v.state === 'completed') return v.missing ? 'Moved or deleted' : [f.bytes(v.total), 'Completed'].filter(Boolean).join(' · ');
  if (v.state === 'failed') return v.error || 'Failed';
  if (v.state === 'queued') return 'Queued';
  if (v.phase === 'renewing') return [of, 'Renewing link'].filter(Boolean).join(' · ');
  if (v.need?.kind === 'page' && v.engine !== 'vitre') return needWords(v);
  // RESUME-DESIGN.md 6 (G4): Waiting for network, Retrying.
  if (f.isWaiting(v)) return [of, v.wait?.for === 'server' ? 'Retrying' : 'Waiting for network'].filter(Boolean).join(' · ');
  if (v.state === 'paused') return [of, v.need ? needWords(v) : 'Paused'].filter(Boolean).join(' · ');
  if (v.phase === 'checking') return [of, 'Checking'].filter(Boolean).join(' · ');
  if (v.phase === 'probing' && v.received > 0) return of;
  if (v.state === 'starting' || v.phase === 'probing') return 'Starting';
  if (v.phase === 'merging') return 'Saving';
  return [of, f.speed(v.speed), v.eta >= 0 ? `${f.eta(v.eta)} left` : ''].filter(Boolean).join(' · ');
}
