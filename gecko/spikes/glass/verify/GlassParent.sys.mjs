// JSWindowActor parent for the content-side lens layer (see GlassChild.sys.mjs).
export class VitreGlassParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name === "Ready") {
      this.browsingContext.top.embedderElement?.dispatchEvent(
        new this.browsingContext.topChromeWindow.CustomEvent("VitreGlassReady", { detail: msg.data })
      );
    }
    return null;
  }
}
