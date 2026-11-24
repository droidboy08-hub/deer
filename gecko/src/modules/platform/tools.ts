// The programs Deer installs for the person (ffmpeg, yt-dlp, Deno): their file names, and what makes
// a freshly written copy runnable. Only for files Deer downloaded itself and whose SHA-256 matched;
// never for a program the person chose.
//
//   toolName(base)            "yt-dlp" -> yt-dlp.exe on Windows, yt-dlp on macOS
//   trustInstalledTool(path)  Windows: clear the read-only attribute (a zip marks deno.exe read-only,
//                             which would stop the next update from replacing it).
//                             macOS: trustInstalledTree(path, [path]).
//   trustInstalledTree(root, programs)
//                             macOS: mode 0755 on each program, then no com.apple.quarantine attribute
//                             on anything under root (a file or a folder), so Gatekeeper lets Deer start
//                             them (port plan D6): `/usr/bin/xattr -dr com.apple.quarantine <root>`,
//                             started as a program (Subprocess, no shell), then every file and folder is
//                             read back; one that still carries it gets IOUtils.delMacXAttr, and the
//                             answer is false when any is left. Windows: trustInstalledTool per program.
//   quarantined(root)         macOS: what under root still carries com.apple.quarantine ([] elsewhere).
//
// Why it matters on a Mac (measured on macOS 26): Deer.app's Info.plist sets LSFileQuarantineEnabled,
// so every file Deer writes, an unpacked program included, carries com.apple.quarantine, and so do the
// processes Deer starts. A program that is not notarized (yt-dlp) started while quarantined hangs in
// dyld while macOS shows an alert, and that file stays refused after the attribute is gone: the
// attribute must go before its first start, never after a failed one. com.apple.provenance stays (it
// blocks nothing).
//
// Firefox internals: IOUtils (dom/chrome-webidl/IOUtils.webidl). setWindowsAttributes exists only on
// Windows and hasMacXAttr / delMacXAttr only on macOS; each throws on the other system.
// resource://gre/modules/Subprocess.sys.mjs (call, wait, kill; loaded on first use).
import { exe, isMac, isWin } from '../../shared/os';

const XATTR = '/usr/bin/xattr';
const QUARANTINE = 'com.apple.quarantine';
/** xattr over a folder of a few hundred files takes well under a second; one that hangs is stopped. */
const XATTR_TIMEOUT_MS = 30000;

/** Subprocess (toolkit/modules/subprocess/Subprocess.sys.mjs), loaded on first use. */
function subprocess(): any {
  return ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs').Subprocess;
}

function timers(): { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void } {
  return ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs') as any;
}

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
  return trustInstalledTree(path, [path]);
}

/**
 * Make what Deer just unpacked under `root` runnable: `programs` (paths under root) mode 0755, and on a
 * Mac nothing under root quarantined. Never rejects: false when a step failed.
 */
export async function trustInstalledTree(root: string, programs: string[]): Promise<boolean> {
  if (isWin) {
    let ok = true;
    for (const p of programs) ok = (await trustInstalledTool(p)) && ok;
    return ok;
  }
  let ok = true;
  for (const p of programs) {
    try {
      // honorUmask false: exactly 0755, whatever the process umask.
      await IOUtils.setPermissions(p, 0o755, false);
    } catch {
      ok = false;
    }
  }
  if (!isMac) return ok;
  await xattrClear(root);
  // Read back: whatever xattr left (or could not start for) is cleared one file at a time.
  for (const p of await quarantined(root)) {
    try {
      await IOUtils.delMacXAttr(p, QUARANTINE);
    } catch {
      /* counted below */
    }
  }
  return ok && (await quarantined(root)).length === 0;
}

/** `/usr/bin/xattr -dr com.apple.quarantine <root>` (exits 0 also where nothing carried it). Never rejects. */
async function xattrClear(root: string): Promise<boolean> {
  try {
    const proc = await subprocess().call({ command: XATTR, arguments: ['-dr', QUARANTINE, root], stderr: 'stdout' });
    const { setTimeout, clearTimeout } = timers();
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    }, XATTR_TIMEOUT_MS);
    try {
      // Read what it prints so it never waits on a full pipe.
      while (await proc.stdout.readString()) {
        /* nothing to keep */
      }
      const { exitCode } = await proc.wait();
      return exitCode === 0;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** What under `root` (itself included; symbolic links are skipped) still carries com.apple.quarantine. [] off a Mac. */
export async function quarantined(root: string): Promise<string[]> {
  if (!isMac) return [];
  const found: string[] = [];
  const walk = async (path: string): Promise<void> => {
    let dir = false;
    try {
      const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      f.initWithPath(path);
      if (f.isSymlink() || !f.exists()) return;
      dir = f.isDirectory();
    } catch {
      return;
    }
    try {
      if (await IOUtils.hasMacXAttr(path, QUARANTINE)) found.push(path);
    } catch {
      found.push(path); // unreadable: not known to be clear
    }
    if (!dir) return;
    for (const child of await IOUtils.getChildren(path).catch(() => [] as string[])) await walk(child);
  };
  await walk(root);
  return found;
}
