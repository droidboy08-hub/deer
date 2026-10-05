// Content-process half of the "VitrePage" window actor (top frame only).
// Tells the chrome when the pixels under the bar may have changed: first paint milestones and
// scrolling (throttled with requestAnimationFrame + a trailing timer), with the scroll offset so
// the parent can snapshot just the strip under the bar.
export class VitrePageChild extends JSWindowActorChild {
  #pending = false;

  handleEvent(event) {
    switch (event.type) {
      case "scroll":
        this.#scrolled();
        break;
      case "DOMContentLoaded":
      case "pageshow":
      case "MozAfterPaint":
        if (event.target === this.document || event.type === "MozAfterPaint") this.#send(event.type);
        break;
    }
  }

  #scrolled() {
    if (this.#pending) return;
    this.#pending = true;
    // One message per frame at most; the parent debounces again before it samples.
    this.contentWindow.requestAnimationFrame(() => {
      this.#pending = false;
      this.#send("scroll");
    });
  }

  #send(why) {
    const win = this.contentWindow;
    if (!win) return;
    this.sendAsyncMessage("Vitre:PageChanged", {
      why,
      scrollX: win.scrollX,
      scrollY: win.scrollY,
      innerWidth: win.innerWidth,
      t: Date.now(),
    });
  }

  receiveMessage(msg) {
    if (msg.name === "Vitre:ScrollTo") this.contentWindow.scrollTo(0, msg.data.y);
    if (msg.name === "Vitre:Ping") return { scrollY: this.contentWindow.scrollY, url: this.document.documentURI.slice(0, 40) };
    return null;
  }
}
