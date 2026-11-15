// The native window behind a browser window: its handle and id, the window move Deer starts from
// the bar, and the system menu of the drag strip. Windows through user32 (js-ctypes), macOS through
// the Objective-C bridge (./objc). Every function takes the chrome window it acts on and keeps no
// reference to it.
//
//   nativeHandle(win)                   the HWND (Windows) or NSWindow* (macOS) as Gecko prints it
//   windowId(win)                       what the system's window list calls it: the HWND text on
//                                       Windows, [NSWindow windowNumber] on macOS (the id
//                                       CGWindowListCopyWindowInfo and screencapture -l use)
//   canMoveWindow(win)                  a move can be started from script (macOS: not yet)
//   beginWindowMove(win, x, y)          start the system's own move loop (macOS: not yet, false)
//   showSystemMenu(win, x, y)           Windows' system menu at a screen point (macOS has none: false)
import { isMac, isWin } from '../../shared/os';
import * as objc from './objc';

/**
 * The window's native handle as a hex string: nsIBaseWindow.nativeHandle (xpcom idl; the same call
 * tools/spike-lib.js uses for captures). xpfe/appshell/AppWindow.cpp GetNativeHandle prints the main
 * widget's NS_NATIVE_WINDOW with "0x%p": the HWND on Windows, the NSWindow* on macOS.
 */
export function nativeHandle(win: Window): string {
  return (win as any).docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
}

// ---- Windows: user32 ----

interface User32 {
  ReleaseCapture: () => unknown;
  PostMessageW: (...args: unknown[]) => unknown;
  IsWindow: (hwnd: unknown) => unknown;
  GetSystemMenu: (...args: unknown[]) => any;
  EnableMenuItem: (...args: unknown[]) => unknown;
  TrackPopupMenu: (...args: unknown[]) => number;
  hwnd: (win: Window) => unknown;
}
let user32: User32 | null = null;

/** user32.dll through js-ctypes (gre/modules/ctypes.sys.mjs), declared once per process. */
function win32(): User32 {
  if (!user32) {
    const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const lib = ctypes.open('user32.dll');
    user32 = {
      ReleaseCapture: lib.declare('ReleaseCapture', ctypes.winapi_abi, ctypes.int32_t),
      PostMessageW: lib.declare('PostMessageW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t),
      IsWindow: lib.declare('IsWindow', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t),
      GetSystemMenu: lib.declare('GetSystemMenu', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.int32_t),
      EnableMenuItem: lib.declare('EnableMenuItem', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t),
      TrackPopupMenu: lib.declare('TrackPopupMenu', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.int32_t, ctypes.int32_t, ctypes.voidptr_t, ctypes.voidptr_t),
      hwnd: (win) => ctypes.voidptr_t(ctypes.UInt64(nativeHandle(win))),
    };
  }
  return user32;
}

// ---- macOS: AppKit ----

/** The NSWindow* behind a browser window, or null before it has one. */
function nsWindow(win: Window): any {
  const p = objc.ptr(nativeHandle(win));
  return objc.isNil(p) ? null : p;
}

// ---- the API ----

/**
 * The window's id in the system's window list: on Windows the HWND as nativeHandle prints it, on
 * macOS [NSWindow windowNumber] (AppKit) in decimal. null when it can't be told.
 */
export function windowId(win: Window): string | null {
  try {
    if (!isMac) return nativeHandle(win);
    const w = nsWindow(win);
    if (!w) return null;
    // NSInteger is a 64-bit long on arm64: js-ctypes hands it back as a ctypes.Int64.
    const n = Number(String(objc.send(objc.ctypes().long)(w, objc.sel('windowNumber'))));
    return n > 0 ? String(n) : null;
  } catch {
    return null;
  }
}

/** Whether a native window move can be started: user32 is reachable and the HWND is this window's. */
export function canMoveWindow(win: Window): boolean {
  if (!isWin) return false;
  try {
    const u = win32();
    return !!u.IsWindow(u.hwnd(win));
  } catch {
    return false;
  }
}

/**
 * Start a native window move from script, as if the caption had been grabbed at this screen point
 * (CSS px, as in MouseEvent.screenX/Y). window.beginWindowMove does not exist on Windows in 157, so
 * this is the borderless-window recipe: give up Gecko's mouse capture, then post WM_NCLBUTTONDOWN /
 * HTCAPTION and Windows runs its own move loop, with Aero Snap and drag-restore from maximized
 * (spikes/shell/RESULT.md, recipe correction 4; the WM_SYSCOMMAND form leaves :active stuck).
 * Call it from a mousemove while the left button is down, never without a real button press:
 * Windows would wait for a click to end the move.
 * macOS: not yet (port plan D9: -[NSWindow performWindowDragWithEvent:] waits for spike S7); false.
 */
export function beginWindowMove(win: Window, screenX: number, screenY: number): boolean {
  if (!isWin) return false;
  try {
    const u = win32();
    const dpr = win.devicePixelRatio;
    const lParam = ((Math.round(screenY * dpr) & 0xffff) << 16) | (Math.round(screenX * dpr) & 0xffff);
    const WM_NCLBUTTONDOWN = 0x00a1;
    const HTCAPTION = 2;
    u.ReleaseCapture();
    return !!u.PostMessageW(u.hwnd(win), WM_NCLBUTTONDOWN, HTCAPTION, lParam);
  } catch (e) {
    console.error('Deer: window move failed', e);
    return false;
  }
}

/**
 * Windows' own system menu at a screen point (CSS px), for the drag strip and the window controls
 * (the design keeps it there). A real right-click on the strip reaches the chrome document as a
 * contextmenu event (Gecko answers WM_NCHITTEST itself, so DefWindowProc never sees a caption click,
 * and it ignores WM_POPUPSYSTEMMENU), so the menu is shown the way Gecko's own nsWindow.cpp
 * DisplaySystemMenu does it: GetSystemMenu, item states for the window's size mode, TrackPopupMenu
 * with TPM_RETURNCMD, then WM_SYSCOMMAND with the chosen command. TrackPopupMenu runs a modal loop;
 * it is started from a timer (never inside an event dispatch) and Gecko keeps running timers and
 * painting meanwhile (tests/menus/chrome.js). True when the menu was scheduled.
 * macOS has no system menu on a window (port plan D2: right-click there shows nothing): false.
 */
export function showSystemMenu(win: Window, screenX: number, screenY: number): boolean {
  if (!isWin) return false;
  const dpr = win.devicePixelRatio || 1;
  const x = Math.round(screenX * dpr);
  const y = Math.round(screenY * dpr);
  const root = win.document.documentElement;
  const mode = root.getAttribute('sizemode') === 'maximized' || root.hasAttribute('inFullscreen') ? 'maximized' : 'normal';
  win.setTimeout(() => {
    try {
      const u = win32();
      const h = u.hwnd(win);
      const menu = u.GetSystemMenu(h, 0);
      if (menu.isNull()) return;
      const SC = { SIZE: 0xf000, MOVE: 0xf010, MINIMIZE: 0xf020, MAXIMIZE: 0xf030, RESTORE: 0xf120 };
      const MF_GRAYED = 1;
      for (const id of Object.values(SC)) u.EnableMenuItem(menu, id, 0);
      const off = mode === 'maximized' ? [SC.SIZE, SC.MOVE, SC.MAXIMIZE] : [SC.RESTORE];
      for (const id of off) u.EnableMenuItem(menu, id, MF_GRAYED);
      const TPM_RIGHTBUTTON = 0x2;
      const TPM_RETURNCMD = 0x100;
      const cmd = u.TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, x, y, 0, h, null);
      if (cmd) u.PostMessageW(h, 0x0112 /* WM_SYSCOMMAND */, cmd, 0);
    } catch (e) {
      console.error('Deer: system menu failed', e);
    }
  }, 0);
  return true;
}
