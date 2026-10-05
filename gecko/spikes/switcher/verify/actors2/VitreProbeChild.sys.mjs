// Verify-only variant of the VitrePage child actor: also reports paints (MozAfterPaint), throttled,
// so the chrome can resample when a page changes colour without scrolling or loading.
export class VitreProbeChild extends JSWindowActorChild {
  #scrollPending = false;
  #paintTimer = null;
  #lastPaintSent = 0;

  handleEvent(event) {
    switch (event.type) {
      case "scroll":
        if (this.#scrollPending) return;
        this.#scrollPending = true;
        this.contentWindow.requestAnimationFrame(() => {
          this.#scrollPending = false;
          this.#send("scroll");
        });
        break;
      case "DOMContentLoaded":
      case "pageshow":
        if (event.target === this.document) this.#send(event.type + (event.persisted ? "(bfcache)" : ""));
        break;
      case "MozAfterPaint": {
        // at most one message per 250 ms, trailing
        if (this.#paintTimer) return;
        const wait = Math.max(0, 250 - (Date.now() - this.#lastPaintSent));
        this.#paintTimer = this.contentWindow.setTimeout(() => {
          this.#paintTimer = null;
          this.#lastPaintSent = Date.now();
          this.#send("paint");
        }, wait);
        break;
      }
    }
  }

  #send(why) {
    const win = this.contentWindow;
    if (!win) return;
    this.sendAsyncMessage("Vitre:PageChanged", { why, scrollX: win.scrollX, scrollY: win.scrollY, t: Date.now() });
  }

  receiveMessage(msg) {
    const win = this.contentWindow;
    if (msg.name === "Vitre:ScrollTo") win.scrollTo(0, msg.data.y);
    if (msg.name === "Vitre:Eval") return String(win.eval(msg.data.js)); // verify-only
    return null;
  }
}
