// Content half of the VitrePage window actor (spike): the Gecko counterpart of the Electron
// page-modules preload. One instance per frame, created lazily on the listed events or on the
// first message.
const FIND_BG = "#ffff00";
const FIND_FG = "#000000";

export class VitrePageChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "DOMDocElementInserted") {
      this.setFindColors();
    }
  }

  // Gecko swaps the find highlight's foreground and background when the background is too close
  // to the page's (yellow on a white page), unless custom colours are set on the SELECTION_FIND
  // selection and repeated as the "alternate" pair.
  setFindColors() {
    try {
      const sc = this.docShell
        .QueryInterface(Ci.nsIInterfaceRequestor)
        .getInterface(Ci.nsISelectionDisplay)
        .QueryInterface(Ci.nsISelectionController);
      sc.getSelection(Ci.nsISelectionController.SELECTION_FIND).setColors(FIND_FG, FIND_BG, FIND_FG, FIND_BG);
      return true;
    } catch (e) {
      return String(e);
    }
  }

  receiveMessage(msg) {
    const win = this.contentWindow;
    const doc = this.document;
    switch (msg.name) {
      case "Vitre:Ping":
        return { url: doc.documentURI, remoteType: Services.appinfo.remoteType, findColors: this.setFindColors() };
      case "Vitre:Scroll":
        return { x: win.scrollX, y: win.scrollY, zoom: win.browsingContext.fullZoom };
      case "Vitre:Link": {
        // The link Ctrl+Q / Shift+Enter should peek: the focused one, else the hovered one.
        let a = doc.activeElement && doc.activeElement.closest ? doc.activeElement.closest("a[href], area[href]") : null;
        let how = "focus";
        if (!a) {
          a = doc.querySelector("a[href]:hover, area[href]:hover");
          how = "hover";
        }
        if (!a) return null;
        const rects = Array.from(a.getClientRects(), (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
        return { href: a.href, text: a.textContent.trim().slice(0, 200), how, rects };
      }
    }
    return undefined;
  }
}
