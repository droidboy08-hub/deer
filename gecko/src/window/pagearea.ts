// Which pages of this window have the bar standing over their top: the input of the page modules
// that keep pages clear of the bar (src/actors/page/inset.ts, the top strip; src/actors/page/pdf.ts,
// the PDF viewer's offset).
//
// While the bar is in hiding mode (the barAutoHide setting, F11 full screen: reveal.ts `hiding`, also
// b.bar.hiding) it keeps no band at the top of the window, so a strip would only be an empty band
// above the page. Every page of the window (tabs and hidden tabs such as peeks) is then listed by its
// browserId in the shared-data entry INSET_BAR_HIDDEN_KEY (src/shared/geometry.ts), and the open
// documents are sent `inset:check`; the page modules read the list before a document's first layout
// and on every re-check, in whatever process the page lands. Leaving hiding mode takes the ids out
// and the strip comes back (a scrolled page keeps its content in place: inset.ts setStrip).
// A reveal (the pointer at the top, b.bar.hold) is not a change: the bar slides in over the page and
// nothing reflows.
//
// Generic: the list is kept from `covered()`, re-read after every render (settings and window state
// changes render) and when a tab gets its browser (TabOpen, a lazy tab inserted, a tab moved in from
// another window). The entry is shared by every window: each window adds and removes only its own
// ids (read-modify-write).
//
// Firefox internals: gBrowser.tabs / tab.linkedBrowser / browser.browserId (Tabbrowser.sys.mjs,
// browser-custom-element.mjs), the TabBrowserInserted event (Tabbrowser.sys.mjs _insertBrowser),
// Services.ppmm.sharedData (gre/modules SharedMap: flush() sends the change to every content process
// now instead of at idle).
import type { Browser } from './browser';
import * as fx from './firefox';
import { INSET_BAR_HIDDEN_KEY } from '../shared/geometry';

/** The browserIds of every tab of this window (hidden ones too; lazy tabs without a browser have none yet). */
function windowBrowserIds(): number[] {
  const ids: number[] = [];
  for (const node of fx.tabNodes()) {
    try {
      const browser = (node as any).linkedBrowser;
      const id = Number(browser?.browserId) || 0;
      if (id) ids.push(id);
    } catch {
      /* a tab being torn down */
    }
  }
  return ids;
}

export class PageArea {
  /** The ids this window has in the shared list right now. */
  private mine = new Set<number>();
  private hidden = false;

  constructor(
    private b: Browser,
    /** True while the bar keeps no band at the top of the window (hiding mode). */
    private covered: () => boolean
  ) {
    const container = fx.tabContainer();
    const inserted = (): void => this.update();
    container.addEventListener('TabBrowserInserted', inserted);
    b.onDestroy(() => {
      container.removeEventListener('TabBrowserInserted', inserted);
      this.write(new Set());
    });
  }

  /** Bring the shared list in line with this window's state; tell the pages when the mode changed. */
  update(): void {
    const hidden = this.covered();
    const want = new Set(hidden ? windowBrowserIds() : []);
    const changedMode = hidden !== this.hidden;
    this.hidden = hidden;
    if (want.size === this.mine.size && [...want].every((id) => this.mine.has(id))) return;
    const added = [...want].filter((id) => !this.mine.has(id));
    this.write(want);
    // A mode change re-checks every open document; a page that just joined the list (a tab moved in
    // from another window) re-checks too. New documents read the list when they start.
    if (changedMode) {
      for (const node of fx.tabNodes()) this.check((node as any).linkedBrowser);
    } else if (added.length) {
      for (const node of fx.tabNodes()) {
        const browser = (node as any).linkedBrowser;
        if (added.includes(Number(browser?.browserId) || 0)) this.check(browser);
      }
    }
  }

  private check(browser: XULBrowser | null | undefined): void {
    if (!browser) return;
    try {
      if (!browser.browsingContext?.currentWindowGlobal) return;
      this.b.page(browser).send('inset:check');
    } catch {
      /* no document */
    }
  }

  /** Replace this window's ids in the shared list (other windows keep theirs). */
  private write(next: Set<number>): void {
    try {
      const shared = Services.ppmm.sharedData;
      const before = shared.get(INSET_BAR_HIDDEN_KEY);
      const list = new Set<number>(Array.isArray(before) ? before.map(Number) : []);
      for (const id of this.mine) list.delete(id);
      for (const id of next) list.add(id);
      this.mine = next;
      shared.set(INSET_BAR_HIDDEN_KEY, [...list]);
      shared.flush();
    } catch (e) {
      console.error('Deer: the hidden-bar page list could not be written', e);
    }
  }
}
