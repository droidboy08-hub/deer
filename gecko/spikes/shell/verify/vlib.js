// Verifier helpers (window.vv), loaded after lib.js:
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window)
// - activate(): make Gecko treat this window as the active one without needing OS foreground
//   (doorhangers, <select> dropdowns and autocomplete only open in the active window).
// - REAL pointer input (SetCursorPos + mouse_event), guarded: a button is only pressed when the
//   window under the cursor is this browser window. The cursor is put back afterwards.
/* global Services, ChromeUtils, vt, spike */
window.vv = (() => {
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  const POINT = new ctypes.StructType("POINT", [{ x: ctypes.int32_t }, { y: ctypes.int32_t }]);
  const W = ctypes.winapi_abi;
  const GetCursorPos = user32.declare("GetCursorPos", W, ctypes.int32_t, POINT.ptr);
  const SetCursorPos = user32.declare("SetCursorPos", W, ctypes.int32_t, ctypes.int32_t, ctypes.int32_t);
  const WindowFromPoint = user32.declare("WindowFromPoint", W, ctypes.voidptr_t, POINT);
  const GetAncestor = user32.declare("GetAncestor", W, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t);
  const mouse_event = user32.declare("mouse_event", W, ctypes.void_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.uintptr_t);
  const SetWindowPos = user32.declare("SetWindowPos", W, ctypes.int32_t, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.int32_t, ctypes.int32_t, ctypes.int32_t, ctypes.int32_t, ctypes.uint32_t);
  const SendMessageW = user32.declare("SendMessageW", W, ctypes.intptr_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const PostMessageW = user32.declare("PostMessageW", W, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
  const ReleaseCapture = user32.declare("ReleaseCapture", W, ctypes.int32_t);
  const GetForegroundWindow = user32.declare("GetForegroundWindow", W, ctypes.voidptr_t);
  const GetAsyncKeyState = user32.declare("GetAsyncKeyState", W, ctypes.int16_t, ctypes.int32_t);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (p) => ctypes.cast(p, ctypes.uintptr_t).value.toString();
  const hptr = (win) => ctypes.voidptr_t(ctypes.UInt64(vt.hwnd(win)));
  let saved = null;

  return {
    PostMessageW,
    SendMessageW,
    ReleaseCapture,
    hptr,
    /** Gecko-level activation: WM_ACTIVATE(WA_ACTIVE) + WM_SETFOCUS, as Windows sends on a real activation. */
    async activate(win = window) {
      if (Services.focus.activeWindow !== win) {
        win.focus();
        await sleep(150);
      }
      if (Services.focus.activeWindow !== win) {
        SendMessageW(hptr(win), 0x0006, 1, 0);
        SendMessageW(hptr(win), 0x0007, 0, 0);
        await sleep(150);
      }
      return Services.focus.activeWindow === win;
    },
    foreground(win = window) {
      return num(GetForegroundWindow()) === num(hptr(win));
    },
    topmost(on, win = window) {
      // HWND_TOPMOST (-1) / HWND_NOTOPMOST (-2); SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
      const after = ctypes.cast(ctypes.intptr_t(on ? -1 : -2), ctypes.voidptr_t);
      return SetWindowPos(hptr(win), after, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
    },
    cursor() {
      const p = new POINT();
      GetCursorPos(p.address());
      return [p.x, p.y];
    },
    saveCursor() {
      saved = this.cursor();
    },
    restoreCursor() {
      if (saved) SetCursorPos(saved[0], saved[1]);
    },
    screen(x, y, win = window) {
      const dpr = win.devicePixelRatio;
      return [Math.round((win.mozInnerScreenX + x) * dpr), Math.round((win.mozInnerScreenY + y) * dpr)];
    },
    /** Is this browser window the top-level window under the real cursor? */
    mine(win = window) {
      const [x, y] = this.cursor();
      const p = new POINT();
      p.x = x;
      p.y = y;
      const h = WindowFromPoint(p);
      if (h.isNull()) return false;
      return num(GetAncestor(h, 2)) === num(hptr(win)); // GA_ROOT
    },
    /** Move the real cursor to client CSS px (x, y) of win. */
    async moveTo(x, y, win = window, wait = 80) {
      const [sx, sy] = this.screen(x, y, win);
      SetCursorPos(sx, sy);
      await sleep(wait);
    },
    /** Glide in steps (a real drag needs intermediate moves). */
    async glide(x0, y0, x1, y1, win = window, steps = 12, wait = 25) {
      for (let i = 1; i <= steps; i++) await this.moveTo(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, win, wait);
    },
    userBusy() {
      // Do not fight a human: is a real mouse button held right now?
      return (GetAsyncKeyState(0x01) & 0x8000) !== 0 || (GetAsyncKeyState(0x02) & 0x8000) !== 0;
    },
    down(win = window) {
      if (!this.mine(win)) throw new Error("real cursor is not over this window; not pressing");
      mouse_event(0x0002, 0, 0, 0, 0);
    },
    up() {
      mouse_event(0x0004, 0, 0, 0, 0);
    },
    /** Real wheel at the cursor: notches < 0 scrolls down. */
    wheel(notches) {
      mouse_event(0x0800, 0, 0, (notches * 120) >>> 0, 0);
    },
    async click(x, y, win = window, hold = 60) {
      await this.moveTo(x, y, win);
      this.down(win);
      await sleep(hold);
      this.up();
      await sleep(250);
    },
    sleep,
  };
})();
