// Content-process half of media/DRM detection: runs in every frame of every tab. Replaces the
// Electron page preload's video report.
export class VitreMediaChild extends JSWindowActorChild {
  // "mediakeys-request": Gecko's own notification when a page calls
  // navigator.requestMediaKeySystemAccess(). aData is JSON: { status, keySystem }.
  // JSWindowActor observers only run for notifications whose subject is this actor's window.
  observe(_subject, topic, data) {
    if (topic !== "mediakeys-request") return;
    let parsed = {};
    try {
      parsed = JSON.parse(data);
    } catch {}
    // "is-capture-possible" is an internal query, not a key request.
    if (parsed.status === "is-capture-possible") return;
    this.sendAsyncMessage("VitreMedia:EME", { keySystem: parsed.keySystem ?? "unknown", status: parsed.status ?? "" });
  }

  handleEvent(event) {
    // "encrypted": the media element met encrypted data (fires even when the page never gets keys).
    if (event.type === "encrypted") this.sendAsyncMessage("VitreMedia:EME", { encrypted: true, initDataType: event.initDataType ?? "" });
  }

  receiveMessage(message) {
    if (message.name !== "VitreMedia:Videos") return null;
    const out = [];
    for (const v of this.document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      out.push({
        src: v.currentSrc || v.src || "",
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        width: v.videoWidth,
        height: v.videoHeight,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        protected: !!v.mediaKeys,
        live: v.duration === Infinity,
        paused: v.paused,
      });
    }
    return out;
  }
}
