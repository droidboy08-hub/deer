// Split view: dragging a tab circle to an edge (../design/SPLIT-VIEW-SPEC.md "How to start split
// view": By dragging a tab circle to an edge; "Motion": Lift, drop, cancel; boards SplitDrop and
// SplitSpec "Dropping on a side").
//
// - Lift: a press on a background circle held 300 ms without moving 5 px (bar.ts watchDrag runs the
//   timer before its 5 px window move, so a plain drag still moves the window, and Aero Snap from a
//   maximized window works as before). The mouse only: by touch and pen press-and-hold is Windows'
//   context menu (the circle's menu has the row). Not in a window under 648 px or with the active pair
//   collapsed (no drop zones: split.ts dropAllowed), a popup, with a menu, a panel or the address
//   field open, for a pinned tab, or for Home while Home is the active tab, nor once the window has
//   lost focus during the hold (bar.ts); in F11 too (spec "Auto-hide and F11": drags hold the bar
//   shown). At 300 ms the
//   circle (a copy over the page: its slot keeps only its glass rim at 0.5) scales to 1.08 with the
//   shadow 0 14px 32px rgba(0,0,0,0.26) (160 ms, spring) and follows the pointer above
//   a transparent cover over the pages that holds the pointer (setPointerCapture), so the zones reach
//   past the window's edges. The bar stays shown (a hold) and its row lenses are off meanwhile.
// - Zones: the left and right thirds of the window below the 68 px bar band. Over a zone a frosted
//   plate previews the result: the pane the tab would take (a new pair at 50/50; with a pair active,
//   that side's pane), 8 px inside it from y 64, with the tab's favicon (32 px), title and host, and
//   "Replaces <tab>" when a pair is active. It fades in over 120 ms and reveals from its outer edge
//   (clip-path, 240 ms, spring); going to the other zone cross-fades (120 ms). The lifted circle keeps
//   the bar's theme and takes the mixed tint while it is over a plate of the other theme (the plate is
//   dark: a light bar's circle).
// - Drop in a zone: split view forms with the tab on that side ("Split forms", the circle flying into
//   its half: bar.ts fly + morph); with a pair active it replaces that side as "Open in split view
//   instead of" does (split.ts drop). Releasing within 5 px of where it lifted is a click (the tab
//   is shown). Anywhere else, on the bar, Esc (a first key hook and Esc layer 5, as the divider's
//   drag), the window losing focus, the pointer capture ending or a move with the button no longer
//   held (it went up in another window) cancel: the circle flies back (280 ms) and the plate fades
//   (120 ms); if the lifted tab closes meanwhile, the copy only fades. Only the lifting button ends
//   it: another button pressed and released meanwhile does nothing (and opens no menu). Keyboard
//   focus, which the press gave to the circle, goes back where it was (the page) when it ends.
// - Reduced motion: no scale, flight or reveal; the plate cross-fades in 150 ms, a cancelled lift
//   fades out at the pointer and back in at its slot.
// - Forced colours: the plate is Canvas with a 2 px Highlight outline and no frost; with
//   transparency effects off it is solid #2C2C2C.
// Tests read b.bar.lift.state ({ tabId, zone }) and may lower b.bar.lift.holdMs.
import type { Bar } from './bar';
import type { Browser } from './browser';
import { el } from './dom';
import { glass, lens } from './glass';
import type { Tab } from './model';
import { GUTTER, PANE_MIN, titleOf, type Side } from './split';
import { FADE_MS, fadeIn, reduced, SPRING } from './splitmotion';
import { BAR_AREA } from '../shared/geometry';
import { displayHost } from '../shared/url';

/** Spec: a 300 ms press-and-hold lifts the circle. */
export const LIFT_HOLD = 300;
/** A release this close to where it lifted is a click. */
const CLICK_SLOP = 5;
/** The plate's top (SplitDrop: 64) and its inset inside the pane it previews. */
const PLATE_TOP = 64;
const PLATE_INSET = 8;

interface Lifted {
  tab: Tab;
  item: HTMLElement;
  clone: HTMLElement;
  cover: HTMLElement;
  plates: Record<Side, HTMLElement | null>;
  /** Where the press was (client coordinates) and where in the circle it grabbed it. */
  at: { x: number; y: number };
  grab: { x: number; y: number };
  pointerId: number;
  zone: Side | null;
  /** A plate has shown in this lift: the next one only cross-fades (no second reveal). */
  revealed: boolean;
  /** Keyboard focus before the press (the press gave it to the circle, which the lift hides). */
  focused: Element | null;
  releaseBar: () => void;
}

export class Lift {
  /** The lifted circle (tests): its tab and the zone under the pointer. */
  state: { tabId: number; zone: Side | null } | null = null;
  /** Tests may change the hold. */
  holdMs = LIFT_HOLD;
  private cur: Lifted | null = null;
  private layer: HTMLElement | null = null;

  constructor(
    private b: Browser,
    private bar: Bar
  ) {
    b.css('split-lift', LIFT_CSS);
    b.whenReady.then(() => {
      // Esc cancels a lifted circle: a first rung of the ladder (spec "Keys": right after the IME).
      b.addEscLayer(5, () => {
        if (!this.cur) return false;
        this.cancel();
        return true;
      });
      b.keys?.addHook(
        (_binding, e) => {
          if (!this.cur) return undefined;
          if (e.key === 'Escape') this.cancel();
          // Nothing else acts while a circle is lifted.
          return 'swallow';
        },
        { first: true }
      );
    });
    const blur = (): void => {
      if (this.cur) this.cancel();
    };
    window.addEventListener('blur', blur);
    b.onDestroy(() => window.removeEventListener('blur', blur));
    // The lifted tab closed under it (a page's window.close(), an extension): the copy fades where it is.
    b.on('tab-closed', (t) => {
      if (this.cur?.tab === t) this.cancel();
    });
  }

  /** The tab whose circle a press on `target` may lift (null: the press is an ordinary one). */
  candidate(target: Element, pointerType: string): Tab | null {
    const face = target.closest('.item.tab:not(.active):not(.pair):not(.leaving) > .circle-face');
    const item = face?.parentElement;
    if (!face || !item || target.closest('.close-badge')) return null;
    // By touch and pen press-and-hold is Windows' context menu: those inputs use the menu row.
    if (pointerType !== 'mouse') return null;
    const t = this.b.tab(Number(item.dataset.id));
    const a = this.b.active();
    const b = this.b;
    if (!t || !a || t === a || t.pinned || a.pinned || b.splitView.pairOf(t)) return null;
    if (b.splitView.refusal() || b.omni.open || b.root.classList.contains('panel-open')) return null;
    if (b.service('menus')?.isOpen?.()) return null;
    return (['left', 'right'] as const).some((side) => b.splitView.dropAllowed(t, side)) ? t : null;
  }

  /** The hold has run: lift `t`'s circle from `item`. `focused`: where keyboard focus was before the press. */
  begin(t: Tab, item: HTMLElement, pointerId: number, at: { x: number; y: number }, focused: Element | null = null): void {
    if (this.cur || !item.isConnected) return;
    const b = this.b;
    const box = item.getBoundingClientRect();
    // The circle's resting shadow, read before .lifted takes it off its slot: the lift grows from it.
    const rest = getComputedStyle(item).boxShadow;
    this.layer ??= b.layer('split-lift', 13);
    this.bar.tips.hide();
    const cover = el('div', { class: 'sv-lift-cover' });
    const clone = el('div', { class: `sv-lifted${item.classList.contains('home') ? ' home' : ''}`, 'aria-hidden': 'true' });
    const layers = glass(clone);
    layers.tint.after(el('div', { class: 'tint-mix' }));
    clone.append(favCopy(item.querySelector('.circle-face .fav'), 'fav'));
    Object.assign(clone.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    layers.lens.style.backdropFilter = lens(box.width, box.height, { blur: 1.4 });
    this.layer.append(cover, clone);
    this.cur = {
      tab: t,
      item,
      clone,
      cover,
      plates: { left: null, right: null },
      at,
      grab: { x: at.x - box.left, y: at.y - box.top },
      pointerId,
      zone: null,
      revealed: false,
      focused,
      releaseBar: this.bar.hold('lift', true),
    };
    this.state = { tabId: t.id, zone: null };
    // Its slot keeps the glass rim alone at 0.5; the row lens (which would still bend it) is off.
    this.bar.holdLenses(true);
    item.classList.add('lifted');
    if (reduced()) clone.classList.add('up');
    else {
      clone.animate([{ transform: 'scale(1)', boxShadow: rest }, { transform: 'scale(1.08)', boxShadow: '0 14px 32px rgba(0,0,0,0.26)' }], { duration: 160, easing: SPRING });
      clone.classList.add('up');
    }
    try {
      cover.setPointerCapture(pointerId);
    } catch {
      /* the button is already up: the first pointer event ends it */
    }
    cover.addEventListener('pointermove', (e) => this.move(e.clientX, e.clientY, e.buttons));
    // Only the lifting (primary) button ends the lift. Another button pressed and released meanwhile
    // (a chord: Pointer Events report it as moves, the compatibility mouse events as its own down and
    // up) neither drops nor cancels it, and its right-click opens no menu.
    cover.addEventListener('pointerup', (e) => {
      if (e.button <= 0) this.release(e.clientX, e.clientY);
    });
    cover.addEventListener('pointercancel', () => this.cancel());
    cover.addEventListener('lostpointercapture', () => {
      if (this.cur?.cover === cover) this.cancel();
    });
    // The button may have gone up between the hold and the capture.
    cover.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release(e.clientX, e.clientY);
    });
    for (const type of ['contextmenu', 'auxclick'] as const) {
      cover.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
  }

  /** The zone for a pointer at (x, y) (client coordinates; beyond the window's edges too). */
  zoneAt(x: number, y: number): Side | null {
    const W = window.innerWidth;
    if (y < BAR_AREA) return null;
    if (x < W / 3) return 'left';
    if (x > (2 * W) / 3) return 'right';
    return null;
  }

  private move(x: number, y: number, buttons: number): void {
    const c = this.cur;
    if (!c) return;
    // The button went up where this window did not see it (another window took the release): the
    // circle does not follow a pointer with no button held, so no later click can drop it.
    if (!(buttons & 1)) {
      this.cancel();
      return;
    }
    c.clone.style.left = `${Math.round(x - c.grab.x)}px`;
    c.clone.style.top = `${Math.round(y - c.grab.y)}px`;
    let zone = this.zoneAt(x, y);
    if (zone && !this.b.splitView.dropAllowed(c.tab, zone)) zone = null;
    if (zone !== c.zone) this.showZone(c, zone);
    // The circle keeps the bar's theme, and the mixed tint over a plate of the other theme.
    const plate = zone ? c.plates[zone] : null;
    const over = !!plate && overlaps(c.clone.getBoundingClientRect(), plate.getBoundingClientRect());
    c.clone.classList.toggle('mixed', over && this.b.theme() === 'light');
  }

  private showZone(c: Lifted, zone: Side | null): void {
    const before = c.zone;
    c.zone = zone;
    if (this.state) this.state.zone = zone;
    if (before) this.hidePlate(c, before);
    if (!zone) return;
    const plate = this.plate(c, zone);
    c.plates[zone] = plate;
    const first = !c.revealed;
    c.revealed = true;
    if (reduced()) {
      plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease' });
      return;
    }
    plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease' });
    // The first plate of the lift reveals from its outer edge; moving to the other zone only
    // cross-fades (spec "Motion": Lift, drop, cancel), though the pointer crosses the middle third,
    // which has no zone, on its way there.
    if (first) plate.animate([{ clipPath: zone === 'left' ? 'inset(0 100% 0 0 round 8px)' : 'inset(0 0 0 100% round 8px)' }, { clipPath: 'inset(0 0 0 0 round 8px)' }], { duration: 240, easing: SPRING });
  }

  private hidePlate(c: Lifted, side: Side, ms = 120): void {
    const plate = c.plates[side];
    c.plates[side] = null;
    if (!plate) return;
    void plate.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? FADE_MS : ms, easing: 'ease', fill: 'forwards' }).finished.catch(() => undefined).then(() => plate.remove());
  }

  /** The preview of the result: the pane the tab would take, 8 px inside it (SplitDrop, SplitSpec "Dropping on a side"). */
  private plate(c: Lifted, side: Side): HTMLElement {
    const r = this.plateRect(side);
    const t = c.tab;
    const out = this.b.splitView.showing()?.[side] ?? null;
    const fav = favCopy(c.item.querySelector('.circle-face .fav'), 'sv-plate-fav');
    const lines = [el('div', { class: 'sv-plate-title' }, titleOf(t))];
    const host = t.kind === 'home' ? '' : displayHost(t.url);
    if (host) lines.push(el('div', { class: 'sv-plate-line' }, host));
    if (out) lines.push(el('div', { class: 'sv-plate-line' }, `Replaces ${titleOf(out)}`));
    const label = out ? `Split view preview: ${titleOf(t)} replaces ${titleOf(out)} on the ${side}` : `Split view preview: ${titleOf(t)} opens on the ${side}`;
    const plate = el('div', { class: `sv-plate ${side}`, role: 'group', 'aria-label': label }, el('div', { class: 'sv-plate-mat' }), el('div', { class: 'sv-plate-rim' }), el('div', { class: 'sv-plate-in' }, fav, ...lines));
    Object.assign(plate.style, { left: `${Math.round(r.x)}px`, top: `${Math.round(r.y)}px`, width: `${Math.round(r.width)}px`, height: `${Math.round(r.height)}px` });
    this.layer?.insertBefore(plate, c.clone);
    return plate;
  }

  /** The pane a drop on `side` gives the tab: a new pair is 50/50; with a pair showing, that side's pane. */
  plateRect(side: Side): DOMRect {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = this.b.splitView.paneRects();
    let l: number;
    let r: number;
    if (rects) {
      l = rects[side].left;
      r = rects[side].right;
    } else {
      const area = W - GUTTER;
      const lw = Math.max(PANE_MIN, Math.min(area - PANE_MIN, Math.round(area / 2)));
      l = side === 'left' ? 0 : lw + GUTTER;
      r = side === 'left' ? lw : W;
    }
    return new DOMRect(l + PLATE_INSET, PLATE_TOP, Math.max(0, r - l - 2 * PLATE_INSET), Math.max(0, H - PLATE_INSET - PLATE_TOP));
  }

  private release(x: number, y: number): void {
    const c = this.cur;
    if (!c) return;
    if (Math.hypot(x - c.at.x, y - c.at.y) < CLICK_SLOP) {
      // A release where it lifted is a click: the tab is shown.
      this.finish(c, 'put');
      this.b.activate(c.tab);
      return;
    }
    let zone = this.zoneAt(x, y);
    if (zone && !this.b.splitView.dropAllowed(c.tab, zone)) zone = null;
    if (!zone) {
      this.cancel();
      return;
    }
    this.drop(c, zone);
  }

  private drop(c: Lifted, side: Side): void {
    // The split forms with the circle flying into its half (bar.ts morph starts from the copy's box).
    if (!reduced()) this.bar.fly(c.tab.id, c.clone.getBoundingClientRect());
    this.finish(c, 'drop');
    const made = this.b.splitView.drop(c.tab, side);
    if (!made) {
      c.item.classList.remove('lifted');
      fadeIn(c.item, FADE_MS);
    }
    this.refocus(c);
  }

  /** Esc, a drop outside the zones, the window losing focus: the circle flies back (280 ms) and the plate fades (120 ms). */
  cancel(): void {
    const c = this.cur;
    if (!c) return;
    this.finish(c, 'back');
    this.refocus(c);
  }

  /**
   * Keyboard focus goes back where it was before the press ("Rules for every route": focus stays
   * where it was): the press gave it to the circle, which the lift hid and a drop takes away, so page
   * keys would otherwise reach nothing. Focus that went somewhere else meanwhile (a page dialog) stays.
   */
  private refocus(c: Lifted): void {
    const now = document.activeElement;
    if (now && now !== document.body && now !== document.documentElement && now.isConnected && !c.item.contains(now)) return;
    const was = c.focused;
    if (was instanceof HTMLElement && was !== document.body && was.isConnected && !c.item.contains(was) && !was.closest('[inert]')) was.focus();
    else this.b.focusPage();
  }

  /** End the lift: 'put' (a click: back at once), 'drop' (the morph takes over), 'back' (the flight home). */
  private finish(c: Lifted, how: 'put' | 'drop' | 'back'): void {
    this.cur = null;
    this.state = null;
    try {
      c.cover.releasePointerCapture(c.pointerId);
    } catch {
      /* not captured */
    }
    c.cover.remove();
    c.releaseBar();
    for (const side of ['left', 'right'] as const) this.hidePlate(c, side);
    const home = (): void => {
      c.clone.remove();
      c.item.classList.remove('lifted');
      this.bar.holdLenses(false);
    };
    if (how === 'put') {
      home();
      return;
    }
    if (how === 'drop') {
      c.clone.remove();
      this.bar.holdLenses(false);
      return;
    }
    if (reduced() || !c.item.isConnected) {
      // Reduced motion: it fades out at the pointer and back in at its slot (a slot that went: it only fades).
      void c.clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: 'ease', fill: 'forwards' }).finished.catch(() => undefined).then(() => {
        home();
        fadeIn(c.item, FADE_MS);
      });
      return;
    }
    const slot = c.item.getBoundingClientRect();
    const from = c.clone.getBoundingClientRect();
    const dx = slot.left + slot.width / 2 - (from.left + from.width / 2);
    const dy = slot.top + slot.height / 2 - (from.top + from.height / 2);
    c.clone.classList.remove('mixed');
    void c.clone
      .animate([{ translate: '0px 0px', transform: 'scale(1.08)', boxShadow: '0 14px 32px rgba(0,0,0,0.26)' }, { translate: `${dx}px ${dy}px`, transform: 'scale(1)', boxShadow: getComputedStyle(c.item).boxShadow }], { duration: 280, easing: SPRING, fill: 'forwards' })
      .finished.catch(() => undefined)
      .then(home);
  }
}

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * A copy of a circle's favicon box (span.`cls`) with the same picture and its tone (bar.ts toneOf:
 * a flat light or dark favicon keeps its contrast plate in the copy, LIFT_CSS).
 */
function favCopy(fav: Element | null, cls: string): HTMLElement {
  const out = el('span', { class: cls });
  out.append(...Array.from(fav?.childNodes ?? [], (n) => n.cloneNode(true)));
  const tone = (fav as HTMLElement | null)?.dataset.tone;
  if (tone) out.dataset.tone = tone;
  return out;
}

/** The lift's look (b.css('split-lift')). Sizes and colours: SplitDrop. */
export const LIFT_CSS = `
#layer-split-lift > .sv-lift-cover { position: absolute; inset: 0; pointer-events: auto; -moz-window-dragging: no-drag; }
#layer-split-lift > .sv-lifted { position: absolute; border-radius: 22px; pointer-events: none; box-shadow: var(--g-shadow); }
#layer-split-lift > .sv-lifted.up { transform: scale(1.08); box-shadow: 0 14px 32px rgba(0,0,0,0.26); }
#layer-split-lift > .sv-lifted > .fav { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; display: flex; align-items: center; justify-content: center; color: var(--g-icon); }
#layer-split-lift > .sv-lifted.home > .fav { color: var(--g-text); }
/* As the bar draws a circle's favicon (skin/bar.css): an image takes the glass's icon colour if it is
 * a context-fill SVG; Deer's own glyphs (the globe, Home) are stroke-only SVGs and keep fill none.
 * A flat light or dark favicon keeps its contrast plate (data-tone). */
#layer-split-lift > .sv-lifted > .fav img { width: 18px; height: 18px; border-radius: 3px; -moz-context-properties: fill, stroke; fill: currentColor; stroke: currentColor; }
#layer-split-lift > .sv-lifted > .fav svg { width: 18px; height: 18px; }
#vitre-root.theme-light #layer-split-lift > .sv-lifted > .fav[data-tone="light"] img { padding: 2px; border-radius: 4.5px; background: #1d1f24; }
#vitre-root:is(.theme-dark, .theme-clear) #layer-split-lift > .sv-lifted > .fav[data-tone="dark"] img { padding: 2px; border-radius: 4.5px; background: #f4f2ec; }
#layer-split-lift > .sv-plate { position: absolute; border-radius: 8px; box-shadow: 0 18px 44px rgba(0,0,0,0.22); color: #fff; pointer-events: none; font: 13.5px var(--font); }
#layer-split-lift .sv-plate-mat { position: absolute; inset: 0; border-radius: 8px; background: rgba(32,32,38,0.80); backdrop-filter: blur(24px) saturate(1.6); }
#layer-split-lift .sv-plate-rim {
  position: absolute; inset: 0; border-radius: 8px; padding: 1px; pointer-events: none;
  background: linear-gradient(165deg, rgba(255,255,255,0.45), rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.04) 60%, rgba(255,255,255,0.18));
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;
}
#layer-split-lift .sv-plate-in { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; }
#layer-split-lift .sv-plate-fav { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: #fff; }
#layer-split-lift .sv-plate-fav img { width: 32px; height: 32px; border-radius: 6px; -moz-context-properties: fill, stroke; fill: currentColor; stroke: currentColor; }
#layer-split-lift .sv-plate-fav svg { width: 32px; height: 32px; }
/* The plate is dark in every theme: a flat dark favicon gets the light plate. */
#layer-split-lift .sv-plate-fav[data-tone="dark"] img { padding: 3.5px; border-radius: 8px; background: #f4f2ec; }
#layer-split-lift .sv-plate-title { max-width: 360px; height: 20px; font-size: 15px; line-height: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#layer-split-lift .sv-plate-line { height: 16px; font-size: 12.5px; line-height: 16px; color: rgba(255,255,255,0.70); white-space: nowrap; max-width: 360px; overflow: hidden; text-overflow: ellipsis; }
@media (prefers-reduced-transparency: reduce) {
  #layer-split-lift .sv-plate-mat { background: #2c2c2c; backdrop-filter: none; }
}
@media (forced-colors: active) {
  #layer-split-lift > .sv-plate { outline: 2px solid Highlight; }
  #layer-split-lift .sv-plate-mat { background: Canvas; backdrop-filter: none; }
  #layer-split-lift .sv-plate-rim { display: none; }
  #layer-split-lift > .sv-plate { color: CanvasText; }
  #layer-split-lift .sv-plate-line { color: CanvasText; }
}
@media (prefers-reduced-motion: reduce) {
  #layer-split-lift > .sv-lifted.up { transform: none; }
}
`;
