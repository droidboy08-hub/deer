// The glass tab bar: the active tab is a 480×44 pill (address and search), the others are
// 44 px favicon circles with × on hover, then the + circle. The group is centred in the window
// and re-flows on the spring when tabs open, close or change.
import { glassLayers, lens } from './glass';
import { icons } from './icons';
import type { Tab, Theme } from './model';
import { displayHost } from './url';

const PILL = 480;
const CIRCLE = 44;
const GAP = 8;
const TOP = 12;

export interface BarHandlers {
  activate(id: number): void;
  close(id: number): void;
  newTab(): void;
  editAddress(): void;
  back(): void;
  forward(): void;
  reloadOrStop(): void;
}

export interface BarLayout {
  pillRect: DOMRect | null;
  left: number;
  right: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export class Bar {
  private items = new Map<number | 'plus', HTMLElement>();
  layout: BarLayout = { pillRect: null, left: 0, right: 0 };

  constructor(private root: HTMLElement, private h: BarHandlers) {}

  private pillWidth(count: number): number {
    const available = window.innerWidth - 2 * (12 + 108 + 16);
    const circles = count * (CIRCLE + GAP); // other tabs + the + circle
    return Math.max(220, Math.min(PILL, available - circles));
  }

  render(tabs: Tab[], activeId: number, theme: Theme): void {
    this.root.dataset.theme = theme;
    const pillW = this.pillWidth(tabs.length);
    const total = tabs.reduce((sum, t) => sum + (t.id === activeId ? pillW : CIRCLE) + GAP, 0) + CIRCLE;
    let x = Math.round((window.innerWidth - total) / 2);
    const seen = new Set<number | 'plus'>();
    this.layout = { pillRect: null, left: x, right: x + total };

    for (const t of tabs) {
      seen.add(t.id);
      const active = t.id === activeId;
      const w = active ? pillW : CIRCLE;
      let el = this.items.get(t.id);
      if (!el) {
        el = this.createTab(t.id);
        el.style.left = `${x + (w - CIRCLE) / 2}px`;
        el.style.width = `${CIRCLE}px`;
        el.classList.add('entering');
        this.root.append(el);
        requestAnimationFrame(() => el?.classList.remove('entering'));
      }
      this.updateTab(el, t, active, w);
      const prevW = parseFloat(el.style.width) || w;
      if (prevW !== w) this.morph(el, w);
      el.style.left = `${x}px`;
      el.style.width = `${w}px`;
      if (active) this.layout.pillRect = new DOMRect(x, TOP, w, CIRCLE);
      x += w + GAP;
    }

    let plus = this.items.get('plus');
    if (!plus) {
      plus = document.createElement('div');
      plus.className = 'item glass circle plus';
      plus.innerHTML = `${glassLayers()}<button type="button" class="face" aria-label="New tab" title="New tab  Ctrl+T">${icons.plus}</button>`;
      (plus.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(CIRCLE, CIRCLE);
      plus.querySelector('button')?.addEventListener('click', () => this.h.newTab());
      this.items.set('plus', plus);
      this.root.append(plus);
    }
    seen.add('plus');
    plus.style.left = `${x}px`;

    for (const [id, el] of this.items) {
      if (!seen.has(id)) {
        this.items.delete(id);
        el.classList.add('leaving');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 400);
      }
    }
  }

  private morph(el: HTMLElement, w: number): void {
    // While the width animates, a lens sized for the end state would bend unevenly: use frost.
    el.classList.add('morphing');
    const lensEl = el.querySelector('.lens') as HTMLElement;
    window.setTimeout(() => {
      el.classList.remove('morphing');
      lensEl.style.backdropFilter = lens(w, CIRCLE, w > CIRCLE ? { blur: 2.4 } : {});
    }, 440);
  }

  private createTab(id: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'item glass tab';
    el.dataset.id = String(id);
    el.innerHTML = `${glassLayers()}
      <div class="pill-face">
        <button type="button" class="nav back" aria-label="Back" title="Back  Alt+Left">${icons.back}</button>
        <button type="button" class="nav forward" aria-label="Forward" title="Forward  Alt+Right">${icons.forward}</button>
        <button type="button" class="address" aria-label="Edit address"><span class="fav"></span><span class="host"></span></button>
        <span class="accessories" role="group" aria-label="Extensions"></span>
        <button type="button" class="nav dl-mark" hidden></button>
        <button type="button" class="nav reload" aria-label="Reload" title="Reload  Ctrl+R">${icons.reload}</button>
      </div>
      <button type="button" class="circle-face" aria-label=""><span class="fav"></span></button>
      <button type="button" class="close-badge" aria-label="Close tab" title="Close tab">${icons.closeSmall}</button>
      <div class="load-line"></div>`;
    (el.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(CIRCLE, CIRCLE);
    el.querySelector('.back')?.addEventListener('click', () => this.h.back());
    el.querySelector('.forward')?.addEventListener('click', () => this.h.forward());
    el.querySelector('.reload')?.addEventListener('click', () => this.h.reloadOrStop());
    el.querySelector('.address')?.addEventListener('click', () => this.h.editAddress());
    el.querySelector('.circle-face')?.addEventListener('click', () => this.h.activate(id));
    el.querySelector('.close-badge')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.h.close(id);
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.h.close(id);
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    this.items.set(id, el);
    return el;
  }

  private updateTab(el: HTMLElement, t: Tab, active: boolean, w: number): void {
    el.classList.toggle('active', active);
    el.classList.toggle('loading', t.loading);
    el.classList.toggle('home', t.kind === 'home');
    const label = t.kind === 'home' ? 'Home' : t.title || displayHost(t.url) || 'New tab';
    const face = el.querySelector('.circle-face') as HTMLElement;
    face.setAttribute('aria-label', label);
    face.title = label;
    (el.querySelector('.close-badge') as HTMLElement).setAttribute('aria-label', `Close ${label}`);

    const favHtml = t.kind === 'home' ? icons.home : t.favicon ? `<img src="${esc(t.favicon)}" alt="" draggable="false">` : icons.globe;
    for (const f of el.querySelectorAll('.fav')) {
      if ((f as HTMLElement).dataset.src !== (t.kind === 'home' ? 'home' : t.favicon ?? 'globe')) {
        f.innerHTML = favHtml;
        (f as HTMLElement).dataset.src = t.kind === 'home' ? 'home' : t.favicon ?? 'globe';
        const img = f.querySelector('img');
        img?.addEventListener('error', () => {
          f.innerHTML = icons.globe;
        });
      }
    }
    const host = el.querySelector('.host') as HTMLElement;
    const addr = el.querySelector('.address') as HTMLElement;
    if (t.kind === 'home') {
      host.textContent = 'Search or enter address';
      addr.classList.add('placeholder');
      el.querySelector('.address .fav')!.innerHTML = icons.search;
    } else {
      host.textContent = t.zoomFlash > Date.now() ? `${Math.round(t.zoom * 100)}%` : displayHost(t.url);
      addr.classList.toggle('placeholder', false);
    }
    addr.setAttribute('aria-label', t.kind === 'home' ? 'Search or enter address' : `${displayHost(t.url)}, edit address`);
    const back = el.querySelector('.back') as HTMLButtonElement;
    const fwd = el.querySelector('.forward') as HTMLButtonElement;
    back.setAttribute('aria-disabled', String(!t.canBack));
    fwd.setAttribute('aria-disabled', String(!t.canForward));
    const reload = el.querySelector('.reload') as HTMLElement;
    reload.innerHTML = t.loading ? icons.stop : icons.reload;
    reload.setAttribute('aria-label', t.loading ? 'Stop' : 'Reload');
    reload.title = t.loading ? 'Stop  Esc' : 'Reload  Ctrl+R';
    reload.style.visibility = t.kind === 'home' ? 'hidden' : 'visible';
    back.style.visibility = fwd.style.visibility = t.kind === 'home' ? 'hidden' : 'visible';
    if (active && !el.classList.contains('morphing')) (el.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(w, CIRCLE, { blur: 2.4 });
  }
}
