export class VitreProbeChild extends JSWindowActorChild {
  info() {
    return {
      url: this.document.documentURI,
      title: this.document.title,
      h1: this.document.querySelector("h1")?.textContent ?? null,
      processType: Services.appinfo.processType,
      remoteType: Services.appinfo.remoteType,
      pid: Services.appinfo.processID,
      childURL: import.meta.url,
    };
  }
  handleEvent(event) {
    if (event.type === "DOMContentLoaded") {
      this.sendAsyncMessage("VitreProbe:Loaded", this.info());
    }
  }
  receiveMessage(msg) {
    if (msg.name === "VitreProbe:Ping") return this.info();
    return null;
  }
}
