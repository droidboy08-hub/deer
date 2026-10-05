// Every Firefox internal the Settings module uses, each behind one small function with the source
// file in reference/omni it was checked against (Firefox 157). A runtime update is this file.
//
//   pickFile(title, filters, dir?)   the native Open dialog (nsIFilePicker, modeOpen) -> path | null
//   pickFolder(title, dir?)          the native folder dialog (modeGetFolder)         -> path | null
//   sanitize(items, range)           Firefox's Sanitizer with a time range
//   forgetClosedEverywhere()         empty Ctrl+Shift+T's list in every browser window
//   builtinWallpapers()              the photos that ship with Windows (%SystemRoot%\Web\Wallpaper)
//   exists(path)                     IOUtils.exists, never throwing
//   openFolder(path)                 show a folder in Explorer (nsIFile.launch)
//   engineInfo()                     Firefox / Gecko version and the profile folder
//   fileURL(path)                    a file: URL (nsIIOService.newFileURI escapes #, %, spaces, non-ASCII)
//   exitElementFullscreen()          leave a page element's full screen (FullScreen.exitDomFullScreen)
//   caretBrowsing() / setCaretBrowsing(on) / onCaretBrowsingChange(fn)
//                                    Firefox's caret browsing pref (accessibility.browsewithcaret)

/** What the Open dialog offers. `extensions` without dots: ['jpg', 'png']. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

/**
 * nsIFilePicker (dom/base/nsIFilePicker; usage as browser/chrome/browser/content/browser/pageinfo/
 * pageInfo.js selectSaveFolder and gre/chrome/toolkit/content/extensions/parent/ext-downloads.js):
 * init(browsingContext, title, mode), appendFilter(title, "*.a;*.b"), displayDirectory (nsIFile),
 * open(callback(result)). In 157 the dialog itself runs in a separate utility process; nothing
 * changes for the caller. The title is what the dialog window is called (tests find it by title).
 */
function openPicker(mode: number, title: string, filters: FileFilter[], dir?: string): Promise<string | null> {
  return new Promise((resolve) => {
    let fp: any;
    try {
      fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      fp.init((window as any).browsingContext, title, mode); // the chrome window's BrowsingContext (Window.webidl, ChromeOnly)
      for (const f of filters) fp.appendFilter(f.name, f.extensions.map((e) => `*.${e}`).join(';'));
      if (mode === Ci.nsIFilePicker.modeGetFolder) fp.appendFilters(Ci.nsIFilePicker.filterAll);
      if (dir) {
        try {
          const d = localFile(dir);
          if (d.exists() && d.isDirectory()) fp.displayDirectory = d;
        } catch {
          /* a stale folder: the dialog opens where Windows remembers */
        }
      }
    } catch (e) {
      console.error('Deer settings: the file dialog could not be created', e);
      resolve(null);
      return;
    }
    fp.open((result: number) => {
      try {
        resolve(result === Ci.nsIFilePicker.returnOK && fp.file ? String(fp.file.path) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

export function pickFile(title: string, filters: FileFilter[], dir?: string): Promise<string | null> {
  return openPicker(Ci.nsIFilePicker.modeOpen, title, filters, dir);
}

export function pickFolder(title: string, dir?: string): Promise<string | null> {
  return openPicker(Ci.nsIFilePicker.modeGetFolder, title, [], dir);
}

/** Windows' Pictures / Videos folders (Services.dirsvc keys "Pict" / "Vids", xpcom/io/nsDirectoryServiceDefs.h). */
export function knownFolder(kind: 'pictures' | 'videos'): string | undefined {
  try {
    return Services.dirsvc.get(kind === 'pictures' ? 'Pict' : 'Vids', Ci.nsIFile).path;
  } catch {
    return undefined;
  }
}

/** Sanitizer item names (browser/modules/Sanitizer.sys.mjs, `items`). */
export type SanitizeItem = 'history' | 'formdata' | 'cookies' | 'offlineApps' | 'sessions' | 'cache' | 'downloads' | 'siteSettings';

/**
 * Clear data the way Firefox's own dialog does: Sanitizer.sanitize(items, { ignoreTimespan: false,
 * range }) from resource:///modules/Sanitizer.sys.mjs (browser/modules/Sanitizer.sys.mjs). `range` is
 * [from, to] in microseconds (PRTime), or null for everything. Rejects when an item failed (the
 * others are still cleared).
 */
export async function sanitize(items: SanitizeItem[], range: [number, number] | null): Promise<void> {
  const { Sanitizer } = ChromeUtils.importESModule('resource:///modules/Sanitizer.sys.mjs');
  if (!items.length) return;
  await Sanitizer.sanitize(items, range ? { ignoreTimespan: false, range } : { ignoreTimespan: true });
}

/** Empty the closed-tab list of every browser window (b.forgetClosed, SessionStore.forgetClosedTab). */
export function forgetClosedEverywhere(): void {
  for (const win of Services.wm.getEnumerator('navigator:browser')) {
    try {
      (win as Window).vitre?.forgetClosed();
    } catch {
      /* a window that is closing */
    }
  }
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'];
export const PHOTO_EXT = IMAGE_EXT;
export const VIDEO_EXT = ['mp4', 'webm', 'm4v', 'mov', 'ogv'];
const BUILTIN_MAX = 8;

export function extOf(path: string): string {
  const m = /\.([^.\\/]+)$/.exec(path);
  return m ? m[1].toLowerCase() : '';
}

/**
 * The photos that ship with Windows, one from each theme folder first so the first tiles vary
 * (same rule as app/src/main/modules/settings.ts). %SystemRoot%\Web\Wallpaper\<theme>\*.jpg.
 */
export async function builtinWallpapers(): Promise<string[]> {
  const root = PathUtils.join(Services.env.get('SystemRoot') || 'C:\\Windows', 'Web', 'Wallpaper');
  const themes: string[][] = [];
  try {
    for (const dir of await IOUtils.getChildren(root)) {
      let files: string[] = [];
      try {
        const st = await IOUtils.stat(dir);
        if (st.type !== 'directory') continue;
        files = (await IOUtils.getChildren(dir)).filter((f: string) => IMAGE_EXT.includes(extOf(f)));
      } catch {
        continue;
      }
      files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (files.length) themes.push(files);
    }
  } catch {
    /* no built-in wallpapers on this edition */
  }
  themes.sort((a, b) => a[0].localeCompare(b[0]));
  const out: string[] = [];
  for (let i = 0; out.length < BUILTIN_MAX && themes.some((t) => t[i]); i++) {
    for (const t of themes) if (t[i] && out.length < BUILTIN_MAX) out.push(t[i]);
  }
  return out;
}

export async function exists(path: string): Promise<boolean> {
  try {
    return !!path && (await IOUtils.exists(path));
  } catch {
    return false;
  }
}

/** Open a folder in Explorer: nsIFile.launch() on a directory (xpcom/io/nsIFile.idl). */
export function openFolder(path: string): void {
  try {
    localFile(path).launch();
  } catch (e) {
    console.error('Deer settings: could not open the folder', e);
  }
}

/** Services.appinfo (xpcom/system/nsIXULAppInfo.idl) and the profile folder (PathUtils.profileDir). */
export function engineInfo(): { firefox: string; gecko: string; profile: string } {
  let firefox = '';
  let gecko = '';
  let profile = '';
  try {
    firefox = String(Services.appinfo.version);
    gecko = String(Services.appinfo.platformVersion);
  } catch {
    /* not fatal */
  }
  try {
    profile = PathUtils.profileDir;
  } catch {
    /* not fatal */
  }
  return { firefox, gecko, profile };
}

export function fileURL(path: string): string {
  try {
    return Services.io.newFileURI(localFile(path)).spec;
  } catch {
    return '';
  }
}

/**
 * Leave a page element's full screen, as Firefox's own exit button does: FullScreen.exitDomFullScreen()
 * (browser/chrome/browser/content/browser/browser-fullScreenAndPointerLock.js), which calls
 * document.exitFullscreen() on the chrome document. Deer's layer is hidden in element full screen
 * (skin/shell.css), so a panel can only show once it is over (MozDOMFullscreen:Exited).
 */
export function exitElementFullscreen(): void {
  try {
    const fs = (window as any).FullScreen;
    if (fs?.exitDomFullScreen) fs.exitDomFullScreen();
    else if (document.fullscreenElement) void document.exitFullscreen();
  } catch (e) {
    console.error('Deer settings: could not leave element full screen', e);
  }
}

/**
 * Caret browsing: Firefox's pref accessibility.browsewithcaret (the setting "Always use the cursor
 * keys to navigate within pages", browser/chrome/browser/content/browser/preferences/config/
 * tabs-browsing.mjs). Content processes read it live. Deer parks F7 (vitre-prefs.js sets
 * accessibility.browsewithcaret_shortcut.enabled false), so this switch is the way to turn it on.
 */
const CARET_PREF = 'accessibility.browsewithcaret';

export function caretBrowsing(): boolean {
  try {
    return Services.prefs.getBoolPref(CARET_PREF, false);
  } catch {
    return false;
  }
}

export function setCaretBrowsing(on: boolean): void {
  try {
    Services.prefs.setBoolPref(CARET_PREF, on);
  } catch (e) {
    console.error('Deer settings: could not change caret browsing', e);
  }
}

/** fn(on) whenever the pref changes (this switch, another window, about:config). Returns the remover. */
export function onCaretBrowsingChange(fn: (on: boolean) => void): () => void {
  const observer = { observe: () => fn(caretBrowsing()) };
  Services.prefs.addObserver(CARET_PREF, observer);
  return () => Services.prefs.removeObserver(CARET_PREF, observer);
}
