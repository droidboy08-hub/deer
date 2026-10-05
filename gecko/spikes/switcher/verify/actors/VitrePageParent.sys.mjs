// Parent-process half of the "VitrePage" window actor: forwards page-change notices to the
// browser window that owns the tab (window.VitrePage.onPageChanged(browser, data)).
export class VitrePageParent extends JSWindowActorParent {
  receiveMessage(msg) {
    if (msg.name !== "Vitre:PageChanged") return;
    const browser = this.browsingContext.top.embedderElement;
    // Firefox 157 renamed node.ownerGlobal to node.documentGlobal (ownerGlobal is undefined).
    const win = browser?.documentGlobal ?? browser?.ownerDocument?.defaultView;
    win?.VitrePage?.onPageChanged(browser, msg.data);
  }
}
