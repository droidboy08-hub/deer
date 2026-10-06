// When the bar hides, and what brings it back.
//
// The bar is hidden (slid 72 px up and faded, skin/bar.css) while the window is in F11 full screen
// or the "barAutoHide" setting is on. It comes back, and stays, while any of these holds:
//   - the pointer is within 28 px of the top of the window, or left the window through its top edge;
//   - the pointer rests on the bar (anywhere above 76 px);
//   - keyboard focus is inside the bar, or the address field is open;
//   - somebody holds it: `const release = b.bar.hold('find')` ... `release()`. Native popups that
//     hang from the bar hold it while they are open (anchors.ts).
// 400 ms after the last of them ends, it leaves again.
//
// Why JavaScript and not :hover on a reveal strip (the Electron build's way): in a normal window
// Windows owns the top 8 px of the client area for resizing and Gecko gets no mouse events there,
// so a 6 px strip can never be hovered with a real pointer (spikes/shell/RESULT.md, verifier,
// "Auto-hide"). The rule here also fires when the pointer leaves the document upwards.
//
// State is mirrored on #vitre-root as classes: `bar-hiding` (the bar is in hiding mode) and
// `bar-revealed` (it is showing anyway). The window controls (and a private window's label) hide and
// come back with the bar.
import type { Browser } from './browser';

const REVEAL_BELOW = 28;
const KEEP_ABOVE = 76;
const HIDE_DELAY = 400;
const FAR = 9999;

export class Reveal {
  /** The bar is in hiding mode (auto-hide setting or full screen). */
  hiding = false;
  /** In hiding mode and currently shown. */
  revealed = false;
  private holds = new Set<symbol>();
  /** Last known pointer height in the window; FAR when the pointer is not over the top of it. */
  private lastY = FAR;
  private watch = 0;
  private idleSince = 0;

  constructor(
    private b: Browser,
    private bar: HTMLElement
  ) {
    window.addEventListener(
      'mousemove',
      (e) => {
        this.lastY = e.clientY;
        if (this.hiding && e.clientY < REVEAL_BELOW) this.show();
      },
      true
    );
    window.addEventListener(
      'mouseout',
      (e) => {
        if (e.relatedTarget !== null) return;
        // Left the document. Through the top (into the resize band, or the screen edge when
        // maximized) counts as resting at the top; anywhere else the pointer is gone.
        if (this.lastY < 40) {
          this.lastY = 0;
          if (this.hiding) this.show();
        } else this.lastY = FAR;
      },
      true
    );
    // Another application has the pointer now.
    window.addEventListener('deactivate', () => (this.lastY = FAR));
    bar.addEventListener('focusin', () => this.show());
  }

  /** True when the bar is not on screen. */
  get hidden(): boolean {
    return this.hiding && !this.revealed;
  }

  /** Re-read the mode (called on every render: settings and window state changes re-render). */
  update(): void {
    const hiding = this.b.root.classList.contains('fullscreen') || !!this.b.settings.barAutoHide;
    if (hiding !== this.hiding) {
      this.hiding = hiding;
      this.revealed = false;
      this.stopWatch();
      if (hiding && this.wanted()) {
        this.revealed = true;
        this.startWatch();
      }
    }
    this.apply();
  }

  /**
   * Show the bar now (it leaves again by the rules above). `instant` skips the slide: the bar is in
   * place when this returns, for a native popup that is about to measure its anchor.
   */
  show(instant = false): void {
    this.idleSince = 0;
    if (!this.hiding || this.revealed) return;
    this.revealed = true;
    if (instant) this.b.root.classList.add('bar-snap');
    this.apply();
    if (instant) {
      void this.bar.offsetWidth;
      requestAnimationFrame(() => this.b.root.classList.remove('bar-snap'));
    }
    this.startWatch();
  }

  /** Keep the bar showing until the returned function is called. */
  hold(reason: string, instant = false): () => void {
    const token = Symbol(reason);
    this.holds.add(token);
    this.show(instant);
    return () => {
      this.holds.delete(token);
    };
  }

  /** Is there a reason for the bar to be on screen right now? */
  private wanted(): boolean {
    if (this.lastY <= KEEP_ABOVE) return true;
    if (this.holds.size || this.b.omni?.open) return true;
    const focus = document.activeElement;
    return !!focus && this.bar.contains(focus);
  }

  private startWatch(): void {
    if (this.watch) return;
    this.idleSince = 0;
    this.watch = window.setInterval(() => {
      if (!this.revealed) {
        this.stopWatch();
        return;
      }
      if (this.wanted()) {
        this.idleSince = 0;
        return;
      }
      const now = performance.now();
      if (!this.idleSince) this.idleSince = now;
      else if (now - this.idleSince >= HIDE_DELAY) {
        this.revealed = false;
        this.stopWatch();
        this.apply();
      }
    }, 100);
  }

  private stopWatch(): void {
    window.clearInterval(this.watch);
    this.watch = 0;
    this.idleSince = 0;
  }

  private apply(): void {
    const root = this.b.root;
    root.classList.toggle('bar-hiding', this.hiding);
    root.classList.toggle('bar-revealed', this.hiding && this.revealed);
    // Hidden controls must not take focus or be read out.
    for (const el of [this.bar, document.getElementById('vitre-winctl')]) {
      if (!el) continue;
      if (this.hidden) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }
}
