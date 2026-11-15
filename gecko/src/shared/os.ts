// Which operating system Deer runs on, and the few words and path rules that differ by it. Pure
// apart from one read of Services.appinfo.OS when the bundle loads, so any bundle may import it:
// window code, .sys.mjs singletons and actors (content processes have Services too). Not workers:
// a worker has no Services and is told the OS in its messages.
//
// Firefox internal: nsIXULRuntime.OS (xpcom/system/nsIXULRuntime.idl), the build's OS_TARGET:
// "WINNT" on Windows, "Darwin" on macOS.

export type OS = 'win' | 'mac' | 'other';

/** Services.appinfo.OS as it is ("WINNT", "Darwin", "Linux"...), or '' where it can't be read. */
function rawOS(): string {
  try {
    return String(Services.appinfo.OS);
  } catch {
    return '';
  }
}

const RAW = rawOS();

export const os: OS = RAW === 'WINNT' ? 'win' : RAW === 'Darwin' ? 'mac' : 'other';
export const isWin = os === 'win';
export const isMac = os === 'mac';

/** The system's name as people know it. */
export function osName(): string {
  if (isWin) return 'Windows';
  if (isMac) return 'macOS';
  return RAW || 'this system';
}

/** The system's file manager, for wording such as "Open in File Explorer". */
export function fileManager(): string {
  return isMac ? 'Finder' : 'File Explorer';
}

/** The menu item that shows a file in the file manager. */
export function revealLabel(): string {
  return isMac ? 'Show in Finder' : 'Show in folder';
}

/** A program's file name: "ffmpeg" is ffmpeg.exe on Windows and plain ffmpeg elsewhere. */
export function exe(base: string): string {
  return isWin ? base + '.exe' : base;
}

/**
 * A path or name in Unicode NFC. macOS hands out decomposed (NFD) names on HFS+, FAT and exFAT
 * volumes, so the same name typed by a person and read back from the disk can differ in code points.
 */
export function nfc(s: string): string {
  return s.normalize('NFC');
}

/**
 * Whether two paths name the same file, by text alone: NFC and case-folded. That is right for NTFS
 * and for APFS and HFS+ as macOS formats them by default (case-insensitive); on a case-sensitive
 * volume two paths that differ only in case would wrongly count as one.
 */
export function samePath(a: string, b: string): boolean {
  return nfc(a).toLowerCase() === nfc(b).toLowerCase();
}
