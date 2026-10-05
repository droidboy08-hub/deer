// Probe: who acts on a non-client click on the maximize button, Gecko's DOM dispatch or Windows?
//   python tools/run.py --boot spikes/shell/boot-ncprobe.js --name shell-ncprobe
//     --pref vitre.spike.variant=raw-none|raw-toggle|raw-maximize|shipped|hover  [--pref vitre.spike.msgs=move,down,gap,up]
// Result (out/ncprobe.log): an unconsumed mouseup on a caption button lets Windows run the button's
// own action as well, so a toggling click handler fires twice; preventDefault() on mouseup stops it.
/* global spike, vt, Services, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    const variant = Services.prefs.getStringPref("vitre.spike.variant", "shipped");
    await spike.resize(1280, 800);
    vt.install();
    await spike.sleep(800);
    const d = document;
    const root = d.documentElement;
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const user32 = ctypes.open("user32.dll");
    const PostMessageW = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const GetCursorPos = user32.declare("GetCursorPos", ctypes.winapi_abi, ctypes.int32_t, ctypes.int32_t.array(2).ptr);
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(vt.hwnd()));
    const lparam = (x, y) => (((Math.round((window.mozInnerScreenY + y) * devicePixelRatio)) & 0xffff) << 16) | (Math.round((window.mozInnerScreenX + x) * devicePixelRatio) & 0xffff);
    const cursor = () => {
      const p = ctypes.int32_t.array(2)();
      GetCursorPos(p.address());
      return [p[0] - Math.round(window.mozInnerScreenX), p[1] - Math.round(window.mozInnerScreenY)];
    };
    const max = d.getElementById("vitre-win-max");
    const t0 = performance.now();
    const log = [];
    window.addEventListener("sizemodechange", () => log.push(`${Math.round(performance.now() - t0)}ms sizemode=${root.getAttribute("sizemode")}`));
    for (const t of ["mousedown", "mouseup", "click"]) {
      max.addEventListener(
        t,
        (e) => {
          log.push(`${Math.round(performance.now() - t0)}ms ${e.type} state=${window.windowState}`);
          // "raw-*" variants switch off the shipped fix (VitreUI's mouseup preventDefault) by
          // stopping the event before it reaches VitreUI's own listeners.
          if (variant.startsWith("raw") && t === "mouseup") e.stopImmediatePropagation();
          if (variant === "raw-none" && t === "click") e.stopImmediatePropagation(); // no JS action at all
          if (variant === "raw-maximize" && t === "click") {
            e.stopImmediatePropagation();
            window.maximize(); // an idempotent handler, as Firefox's own titlebar-max button has
          }
          // "raw-toggle": VitreUI's click handler (a toggle) runs, without the fix
          // "shipped": nothing is touched
        },
        true
      );
    }
    spike.log("variant", variant, "msgs", Services.prefs.getStringPref("vitre.spike.msgs", "move,down,up"), "| real cursor (window px)", cursor(), "| max button", vt.rect(max), "| active", Services.focus.activeWindow === window);
    if (variant === "hover") {
      const res = {};
      for (const [name, ht] of [["vitre-win-min", 8], ["vitre-win-max", 9], ["vitre-win-close", 20]]) {
        const b = d.getElementById(name);
        const [x, y] = vt.center(b);
        PostMessageW(hwnd, 0x00a0, ht, lparam(x, y)); // WM_NCMOUSEMOVE
        await spike.sleep(350);
        res[name] = { hover: b.matches(":hover"), background: getComputedStyle(b).backgroundColor };
      }
      PostMessageW(hwnd, 0x0200, 0, (400 << 16) | 600); // WM_MOUSEMOVE back in the client area
      await spike.sleep(350);
      res.afterLeaving = { closeHover: d.getElementById("vitre-win-close").matches(":hover") };
      spike.log("hover through WM_NCMOUSEMOVE", res);
      return;
    }
    for (let i = 1; i <= 3; i++) {
      const [x, y] = vt.center(d.getElementById("vitre-win-max"));
      log.push(`--- click ${i} at ${Math.round(x)},${y}`);
      const msgs = Services.prefs.getStringPref("vitre.spike.msgs", "move,down,up").split(",");
      if (msgs.includes("move")) PostMessageW(hwnd, 0x00a0, 9, lparam(x, y));
      if (msgs.includes("down")) PostMessageW(hwnd, 0x00a1, 9, lparam(x, y));
      if (msgs.includes("gap")) await spike.sleep(300);
      if (msgs.includes("up")) PostMessageW(hwnd, 0x00a2, 9, lparam(x, y));
      await spike.sleep(1500);
    }
    spike.log(log);
    spike.log("final", { windowState: window.windowState, sizemode: root.getAttribute("sizemode") });
  });
}
