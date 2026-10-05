// The tab bar by keyboard (design/keymap.json, "Menus and focus"):
//   Tab from the address field moves into the rest of the tab bar (Shift+Tab goes the other way);
//   Left and Right then cross the tabs and the + circle; Enter or Space switches tab or presses the
//   button (the buttons' own behaviour); Esc returns to the page.
// The stops are the bar's own buttons: each tab circle, the active pill's address button and the
// + circle, in the order they are drawn. Feature modules that add a stop to the bar (the downloads
// ring) give it the attribute data-bar-stop.
// A data-bar-stop element may also live outside #vitre-bar, anywhere in #vitre-root (the downloads
// ring sits at the window's bottom right in its own layer, keymap.json: "Left and Right then cross
// the circles, + and the downloads ring"): it joins the row in drawn order (left to right), takes
// Left and Right like the bar's own stops, and Esc on it returns to the page. A stop that is not
// shown (inert, or no box) is skipped.
import type { Browser } from './browser';

const STOPS = '.item.tab:not(.active) > .circle-face, .item.tab.active .address, .item.plus > .face, [data-bar-stop]';

export class BarKeys {
  private bar: HTMLElement;

  constructor(private b: Browser) {
    this.bar = document.getElementById('vitre-bar') as HTMLElement;
    this.bar.addEventListener('keydown', (e) => this.onKey(e));
    // Stops outside the bar (see the header): their keys reach #vitre-root, not the bar.
    b.root.addEventListener('keydown', (e) => {
      const t = e.target as Element | null;
      if (t && !this.bar.contains(t) && t.closest?.('[data-bar-stop]')) this.onKey(e);
    });
    // The Esc ladder's "focused Deer field" step: from the bar, Esc goes back to the page.
    b.addEscLayer(70, () => {
      if (!this.bar.contains(document.activeElement) && !this.outsideStop(document.activeElement)) return false;
      b.focusPage();
      return true;
    });
  }

  /** A stop of the bar that lives outside #vitre-bar (the element or its ancestor carries data-bar-stop). */
  private outsideStop(el: Element | null): boolean {
    return !!el && !this.bar.contains(el) && this.b.root.contains(el) && !!el.closest('[data-bar-stop]');
  }

  /** The stops as drawn, left to right. */
  private stops(): HTMLElement[] {
    const outside = Array.from(this.b.root.querySelectorAll<HTMLElement>('[data-bar-stop]')).filter((s) => !this.bar.contains(s));
    return [...Array.from(this.bar.querySelectorAll<HTMLElement>(STOPS)), ...outside]
      .filter((s) => !s.closest('.leaving, [inert]') && s.getClientRects().length > 0)
      .sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left);
  }

  /** Tab out of the address field: the stop after the pill (or before it, for Shift+Tab). */
  enter(direction: 1 | -1): void {
    const stops = this.stops();
    if (!stops.length) {
      this.b.focusPage();
      return;
    }
    const pill = stops.findIndex((s) => s.classList.contains('address'));
    const next = pill < 0 ? (direction > 0 ? 0 : stops.length - 1) : (pill + direction + stops.length) % stops.length;
    stops[next].focus({ focusVisible: true } as FocusOptions);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const stops = this.stops();
    const at = stops.findIndex((s) => s === document.activeElement || s.contains(document.activeElement));
    if (at < 0) return;
    e.preventDefault();
    const to = Math.max(0, Math.min(stops.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)));
    stops[to].focus({ focusVisible: true } as FocusOptions);
  }
}
