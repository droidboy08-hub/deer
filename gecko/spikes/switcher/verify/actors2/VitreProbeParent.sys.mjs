// Parent half: forwards to the owning browser window (window.VitreProbe.onPageChanged).
export class VitreProbeParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name !== "Vitre:PageChanged") return;
    const browser = this.browsingContext.top.embedderElement;
    const win = browser?.documentGlobal ?? browser?.ownerDocument?.defaultView;
    win?.VitreProbe?.onPageChanged(browser, msg.data);
  }
}
