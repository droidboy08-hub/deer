// The folders Deer keeps its own downloads in (ffmpeg, yt-dlp and Deno, updates) and the person's
// folders Deer offers in its pickers. One function per folder, so moving one is one edit.
//
//   dataRoot()           Windows: %LOCALAPPDATA%; macOS: ~/Library/Application Support. The pref
//                        vitre.localAppData stands in for it on both (tools/run.py points it into each
//                        throwaway profile, so tests never touch the person's own Deer data).
//   deerDir(...parts)    <dataRoot>/Deer/<parts>
//   legacyDir(...parts)  Windows: <dataRoot>\Vitre\<parts>, the folder from before the rename, only
//                        ever read; macOS: null (Deer never ran there under its old name).
//   cacheRoot()          Windows: dataRoot() (%LOCALAPPDATA% is already the machine-local place);
//                        macOS: ~/Library/Caches, or <pref>/Caches when the pref is set.
//   picturesDir()        Windows: Pictures; macOS: ~/Pictures. null when the system has none.
//   videosDir()          Windows: Videos; macOS: ~/Movies. null when the system has none.
//
// Firefox internals: Services.dirsvc keys (xpcom/io/nsDirectoryServiceDefs.h). "LocalAppData" exists
// only on Windows; "ULibDir" (~/Library) and "Pct" only on macOS, which has no movies key in 157.
// "Pict" and "Vids" are the keys settings/gecko.ts knownFolder() asks for on Windows, kept as they
// are; 157's nsDirectoryServiceDefs.h no longer lists them. get() throws for a key the platform does
// not have, and these functions then return null.
import { isMac, isWin } from '../../shared/os';

/** The folder a test put in place of the data root (vitre.localAppData), or ''. */
function prefRoot(): string {
  try {
    return Services.prefs.getStringPref('vitre.localAppData', '');
  } catch {
    return '';
  }
}

/** Services.dirsvc.get(key).path, or null when this platform has no such folder. */
function special(key: string): string | null {
  try {
    return Services.dirsvc.get(key, Ci.nsIFile).path;
  } catch {
    return null;
  }
}

/** ~/Library on macOS ("ULibDir"). Throws elsewhere. */
function library(): string {
  return Services.dirsvc.get('ULibDir', Ci.nsIFile).path;
}

/** Where per-user application data goes. Throws only when the system folder can't be found. */
export function dataRoot(): string {
  const root = prefRoot();
  if (root) return root;
  if (isMac) return PathUtils.join(library(), 'Application Support');
  return Services.dirsvc.get('LocalAppData', Ci.nsIFile).path;
}

/** A folder in Deer's own data folder, where what Deer downloads for the person goes. */
export function deerDir(...parts: string[]): string {
  return PathUtils.join(dataRoot(), 'Deer', ...parts);
}

/** The same folder under the old name (Windows' %LOCALAPPDATA%\Vitre): only ever read. null on macOS. */
export function legacyDir(...parts: string[]): string | null {
  if (!isWin) return null;
  return PathUtils.join(dataRoot(), 'Vitre', ...parts);
}

/** Where caches that can be thrown away go. */
export function cacheRoot(): string {
  if (!isMac) return dataRoot();
  const root = prefRoot();
  if (root) return PathUtils.join(root, 'Caches');
  return PathUtils.join(library(), 'Caches');
}

/** The person's Pictures folder ("Pict" on Windows, "Pct" on macOS), or null. */
export function picturesDir(): string | null {
  return special(isMac ? 'Pct' : 'Pict');
}

/** The person's Videos folder ("Vids" on Windows; on macOS ~/Movies under "Home"), or null. */
export function videosDir(): string | null {
  if (!isMac) return special('Vids');
  const home = special('Home');
  return home ? PathUtils.join(home, 'Movies') : null;
}
