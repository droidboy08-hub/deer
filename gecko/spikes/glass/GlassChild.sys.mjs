// JSWindowActor child for the content-side lens layer (the production shape of content-glass.js).
// Registered from the parent with ChromeUtils.registerWindowActor("VitreGlass", { child: { esModuleURI, events } }).
// The parent drives it with actor.sendQuery("Set", { html }) per window global.

export class VitreGlassChild extends JSWindowActorChild {
  #anon = null;

  handleEvent(event) {
    // DOMContentLoaded only instantiates the actor; the parent pushes the layer with "Set".
    if (event.type === "DOMContentLoaded") {
      this.sendAsyncMessage("Ready", { url: this.document.documentURI });
    }
  }

  receiveMessage(msg) {
    if (msg.name === "Set") {
      try {
        if (!this.#anon) this.#anon = this.document.insertAnonymousContent();
        // eslint-disable-next-line no-unsanitized/property
        this.#anon.root.innerHTML = msg.data.html;
        return { ok: true, url: this.document.documentURI, remoteType: Services.appinfo.remoteType };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
    return null;
  }

  didDestroy() {
    this.#anon = null;
  }
}
