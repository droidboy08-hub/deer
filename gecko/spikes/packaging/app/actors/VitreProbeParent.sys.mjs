import { VitreProbe } from "chrome://vitre/content/modules/VitreProbe.sys.mjs";

export class VitreProbeParent extends JSWindowActorParent {
  receiveMessage(msg) {
    VitreProbe.record({
      name: msg.name,
      data: msg.data,
      parentURL: import.meta.url,
      parentProcessType: Services.appinfo.processType,
    });
  }
}
