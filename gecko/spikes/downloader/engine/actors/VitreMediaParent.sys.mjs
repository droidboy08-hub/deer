// Parent-process half: hands what the content process reports to VitreMedia, keyed by the tab.
import { VitreMedia } from "resource://vitre-boot/engine/VitreMedia.sys.mjs";

export class VitreMediaParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name === "VitreMedia:EME") {
      const id = this.browsingContext?.top?.browserId;
      if (id) VitreMedia.eme(id, message.data);
    }
  }
}
