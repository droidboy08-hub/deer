// Where download progress shows outside the window: nsITaskbarProgress (widget/nsITaskbarProgress.idl).
// Windows has one per window (that window's taskbar button); macOS has one for the whole app (the
// Dock tile), the same object whichever window asks. progressIsGlobal says which, so a caller on
// macOS reports the sum of all windows once instead of letting each window overwrite the others.
//
// Firefox picks them the same way: gre/moz-src/browser/components/downloads/DownloadsTaskbar.sys.mjs
// (nsIWinTaskbar.getTaskbarProgress per window; the macdocksupport service as nsITaskbarProgress,
// registered once).
import { isMac, isWin } from '../../shared/os';

/** True on macOS: progressFor() hands every window the same app-wide progress. */
export const progressIsGlobal = isMac;

/**
 * nsITaskbarProgress for a window, or null where there is none. Windows: @mozilla.org/windows-taskbar;1
 * nsIWinTaskbar.getTaskbarProgress(docShell) (widget/nsIWinTaskbar.idl). macOS:
 * @mozilla.org/widget/macdocksupport;1 as nsITaskbarProgress (widget/cocoa/nsMacDockSupport.mm), the
 * bar drawn over the Dock icon.
 */
export function progressFor(win: Window): any {
  try {
    if (isWin) return Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).getTaskbarProgress((win as any).docShell);
    if (isMac) return Cc['@mozilla.org/widget/macdocksupport;1'].getService(Ci.nsITaskbarProgress);
  } catch {
    /* no taskbar service, or a window without a docShell */
  }
  return null;
}
