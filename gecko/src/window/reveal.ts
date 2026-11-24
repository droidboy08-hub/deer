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
//
// macOS, One row (./onerow.ts). In a normal window the row follows the setting as the Windows bar
// does (the owner, 2026-11-15: "where is the option to hide the capsule tabs ... like in windows"):
// "Show the tab bar" in Settings (settings/pages.ts) and Home's menu (menus/page-items.ts). Hidden,
// the capsules, the traffic lights' capsule and the native lights in it (skin/bar.css, macOS: the
// lights go at once, by visibility) and #vitre-row-end slide away; the 18 px drag strip at the top
// stays, so the window still moves by its top edge (and pointing there brings the row). Shown, it
// floats over the page and pages get the top strip (pagearea.ts). In window full screen (native
// Spaces) it hides as the Windows bar does in F11 full screen, whatever the setting (the owner,
// 2026-11-15: "full screen browser with no bars at the top ... just like the Windows browser Deer"):
// the page fills the screen. Either way it comes back by the rules above (pointer at the top, on the
// row, focus, a hold). The row's own end,
// #vitre-row-end, counts as the bar for focus and for a popover open from one of its capsules
// (wanted()).
// In window full screen, when the pointer reaches the top of the screen macOS slides in its menu bar and, under
// it, a title-bar strip with the traffic lights (Gecko makes that strip opaque in full screen:
// widget/cocoa/nsCocoaWindow.mm, windowDidEnterFullScreen:), over the top of the window. Gecko
// reports how far they reach, frame by frame as they slide: -[ToolbarWindow
// updateTitlebarShownAmount:] (nsCocoaWindow.mm; the title bar's height plus, without a notch, the
// menu bar's, times how far they are in, in desktop px, which are CSS px in this chrome document),
// dispatched to the window as the chrome-only CustomEvent "MacFullscreenMenubarRevealUpdate"
// (xpfe/appshell/AppWindow.cpp and dom/base/nsGlobalWindowOuter.cpp,
// MacFullscreenMenubarOverlapChanged). The row goes down by that much (class `row-shifted` and
// --vitre-row-shift on #vitre-root; skin/bar.css), so it lands below them as Firefox's toolbox does
// (browser-fullScreenAndPointerLock.js, FullScreen.shiftMacToolbarDown / updateMacToolbarShift; its
// listener stays, on a toolbox Deer does not show). The first frame of the slide also brings a hidden
// row in, and the row stays while the menu bar is down; both slide back when it leaves. macOS takes
// the menu bar away as soon as the pointer goes below its title-bar strip, which is where the row
// then is: the row slides back up from under the pointer. So until the row hides again, the
// "rests on the bar" zone reaches down by the farthest the menu bar came (`reach`).
import type { Browser } from './browser';
import { oneRow, rowFullScreen } from './onerow';

const REVEAL_BELOW = 28;
const KEEP_ABOVE = 76;
const HIDE_DELAY = 400;
const FAR = 9999;
/** The root's class and custom property while the row is moved down below macOS's menu bar (skin/bar.css). */
const SHIFTED = 'row-shifted';
const SHIFT_VAR = '--vitre-row-shift';

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
  /** macOS window full screen: how far the menu bar and the title-bar strip reach over the window now (CSS px). */
  private shift = 0;
  /** macOS window full screen: the farthest they reached since the row last hid (the keep zone grows by it). 0 on Windows. */
  private reach = 0;

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
    // macOS full screen: the menu bar and the title-bar strip slide in or out (see the header).
    if (oneRow()) window.addEventListener('MacFullscreenMenubarRevealUpdate', (e) => this.menuBar(Number((e as CustomEvent).detail) || 0), true);
  }

  /** True when the bar is not on screen. */
  get hidden(): boolean {
    return this.hiding && !this.revealed;
  }

  /** Re-read the mode (called on every render: settings and window state changes re-render). */
  update(): void {
    const fullscreen = this.b.root.classList.contains('fullscreen');
    // Windows: F11 full screen or the setting. macOS: window full screen, as F11 on Windows (header;
    // not for a page element in full screen, which hides Deer's layer anyway), or the setting.
    const hiding = (oneRow() ? rowFullScreen(this.b.root) : fullscreen) || !!this.b.settings.barAutoHide;
    // Out of full screen macOS reports no more overlap: the row goes back up (Firefox does the same
    // when it leaves full screen, FullScreen.toggle -> shiftMacToolbarDown(0)).
    if (!fullscreen && this.shift) this.menuBar(0);
    if (hiding !== this.hiding) {
      this.hiding = hiding;
      this.revealed = false;
      this.reach = this.shift;
      this.stopWatch();
      if (hiding && this.wanted()) {
        this.revealed = true;
        this.startWatch();
      }
    } else if (hiding) {
      if (this.wanted() && !this.revealed) {
        this.show();
      } else if (this.revealed && !this.wanted() && !this.watch) {
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

  /**
   * macOS window full screen: the menu bar and the title-bar strip reach `overlap` CSS px over the
   * window (0: gone). The row follows them down at once, every frame of their slide (no transition:
   * the system animates); the first frame of a slide in brings a hidden row in, as the pointer at
   * the top does.
   */
  private menuBar(overlap: number): void {
    const shift = this.b.root.classList.contains('fullscreen') ? Math.max(0, Math.round(overlap * 100) / 100) : 0;
    if (shift === this.shift) return;
    const opening = shift > 0 && this.shift === 0;
    this.shift = shift;
    this.reach = Math.max(this.reach, shift);
    const root = this.b.root;
    root.classList.toggle(SHIFTED, shift > 0);
    if (shift > 0) root.style.setProperty(SHIFT_VAR, `${shift}px`);
    else root.style.removeProperty(SHIFT_VAR);
    if (opening) this.show();
  }

  /** Is there a reason for the bar to be on screen right now? */
  private wanted(): boolean {
    const isFullscreen = oneRow() ? rowFullScreen(this.b.root) : this.b.root.classList.contains('fullscreen');
    if (!isFullscreen && this.b.settings.showCapsulesOnHome && this.b.active()?.kind === 'home') return true;
    if (this.lastY <= KEEP_ABOVE + this.reach) return true;
    // macOS full screen: the menu bar is down (the pointer is up there, or on its way back).
    if (this.shift > 0) return true;
    if (this.holds.size || this.b.omni?.open) return true;
    const focus = document.activeElement;
    if (focus && this.bar.contains(focus)) return true;
    // macOS: the row's Downloads and Extensions capsules (#vitre-row-end) sit outside the bar but are
    // the row too: keyboard focus on one keeps it, and so does a popover open from one (its
    // aria-expanded; the downloads quick view also holds the row itself, ring.ts Popover.open).
    const end = oneRow() ? document.getElementById('vitre-row-end') : null;
    return !!end && ((!!focus && end.contains(focus)) || !!end.querySelector('[aria-expanded="true"]'));
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
        this.reach = 0;
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
    // Hidden controls must not take focus or be read out. (#vitre-row-end, the row's Downloads and
    // Extensions, exists only on macOS: bar.ts buildRow.)
    for (const el of [this.bar, document.getElementById('vitre-winctl'), document.getElementById('vitre-row-end')]) {
      if (!el) continue;
      if (this.hidden) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    }
  }
}
