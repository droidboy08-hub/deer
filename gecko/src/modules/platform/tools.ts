// The programs Deer installs for the person (ffmpeg, yt-dlp, Deno): their file names, and what makes
// a freshly written copy runnable. Only for files Deer downloaded itself and whose SHA-256 matched;
// never for a program the person chose.
//
//   toolName(base)            "yt-dlp" -> yt-dlp.exe on Windows, yt-dlp on macOS
//   trustInstalledTool(path)  Windows: clear the read-only attribute (a zip marks deno.exe read-only,
//                             which would stop the next update from replacing it).
//                             macOS: mode 0755 and no com.apple.quarantine attribute, so Gatekeeper
//                             lets Deer start it (port plan D6).
//
// Firefox internals: IOUtils (dom/chrome-webidl/IOUtils.webidl). setWindowsAttributes exists only on
// Windows and delMacXAttr only on macOS; each throws on the other system.
import { exe, isMac, isWin } from '../../shared/os';

/** An installed tool's file name. */
export function toolName(base: string): string {
  return exe(base);
}

/** Make a tool Deer just installed runnable and replaceable. Never rejects: false when a step failed. */
export async function trustInstalledTool(path: string): Promise<boolean> {
  if (isWin) {
    try {
      await IOUtils.setWindowsAttributes(path, { readOnly: false });
      return true;
    } catch {
      return false;
    }
  }
  let ok = true;
  try {
    // honorUmask false: exactly 0755, whatever the process umask.
    await IOUtils.setPermissions(path, 0o755, false);
  } catch {
    ok = false;
  }
  if (isMac) {
    try {
      if (await IOUtils.hasMacXAttr(path, 'com.apple.quarantine')) await IOUtils.delMacXAttr(path, 'com.apple.quarantine');
    } catch {
      ok = false;
    }
  }
  return ok;
}
