// Parent-process half of the "VitrePage" window actor.
//
// Page -> window: a page module's ctx.send(name, data) arrives here and is handed to the Browser of
// the window that owns the tab, which emits it as
//   b.on('page-message', (tab, name, data, from) => ...)
// Window -> page: Browser.page(tab) calls send() / query() below.
// The actor name fixes the export name (VitrePageParent).
import { FROM_PAGE, TO_PAGE, type PageEnvelope } from './page-api';

/** Longest message name accepted from a page ("module:event" names are far shorter). */
const MAX_NAME = 64;

export class VitrePageParent extends JSWindowActorParent {
  /** The <browser> element of the tab (or peek) this frame belongs to. */
  get browser(): XULBrowser | null {
    try {
      return this.browsingContext?.top?.embedderElement ?? null;
    } catch {
      return null;
    }
  }

  /**
   * A message from the content process. The envelope is checked before anything reads it: a
   * compromised content process can send anything, and the Browser hands `data` on as unknown.
   * Names are short strings ("module:event"); the rest is dropped without a throw.
   */
  receiveMessage(msg: ActorMessage): void {
    let name = '';
    let data: unknown;
    try {
      if (!msg || msg.name !== FROM_PAGE) return;
      const envelope = msg.data as Partial<PageEnvelope> | null;
      if (!envelope || typeof envelope !== 'object') return;
      if (typeof envelope.name !== 'string' || !envelope.name || envelope.name.length > MAX_NAME) return;
      name = envelope.name;
      data = envelope.data;
      const browser = this.browser;
      if (!browser) return;
      // Firefox 157 renamed node.ownerGlobal to node.documentGlobal (toolkit/content/widgets/browser-custom-element.mjs).
      const win = browser.documentGlobal ?? browser.ownerGlobal;
      win?.vitre?.receivePageMessage(browser, name, data, {
        isTop: this.browsingContext === this.browsingContext?.top,
        browsingContext: this.browsingContext,
      });
    } catch (e) {
      console.error(`Deer: page message ${name || '(invalid)'} failed`, e);
    }
  }

  /** One-way message to this frame's page modules. */
  send(name: string, data?: unknown): void {
    this.sendAsyncMessage(TO_PAGE, { name, data } satisfies PageEnvelope);
  }

  /** Ask this frame's page modules; resolves with the first answer (undefined if none). */
  query(name: string, data?: unknown): Promise<any> {
    return this.sendQuery(TO_PAGE, { name, data } satisfies PageEnvelope);
  }
}
