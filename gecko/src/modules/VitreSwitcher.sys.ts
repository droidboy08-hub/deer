// Tab switcher, process-wide part. The switcher itself is per window (src/window/modules/switcher);
// this singleton holds what the windows share:
//
//   VitreSwitcher.init()                  idempotent; called by every window's switcher. Schedules the
//                                         one sweep of this process (below).
//   VitreSwitcher.TAB_VALUE               'vitre-thumb': the SessionStore custom tab value that names a
//                                         tab's thumbnail file (32 hex characters).
//   VitreSwitcher.writeThumb(id, bytes)   <profile>\vitre-thumbs\<id>.jpg, written atomically.
//   VitreSwitcher.readThumb(id)           its bytes, or null.
//   VitreSwitcher.stickyKeys()            Windows' Sticky Keys is on (the switcher then opens latched):
//                                         HKCU\Control Panel\Accessibility\StickyKeys, value Flags, bit 0
//                                         (SKF_STICKYKEYSON). Read at most once per 5 s.
//
// Why files at all: a tab that comes back from a restored session stays unloaded until it is shown,
// and an unloaded tab cannot be drawn (drawSnapshot needs a document). Its card shows the JPEG the
// last session left (spikes/switcher/RESULT.md, recipe 1 "Across restarts"). Private windows never
// write here. A window gives a tab a new id the first time it saves it in a session, so tabs that
// share restored data (duplicates) never overwrite each other's file.
//
// Sweep: once per process, a while after every window has been restored, the files that nothing in
// the session refers to any more (open tabs, closed tabs, closed windows and the previous session,
// SessionStore.getCurrentState()) and that are older than this process are deleted.
//
// Firefox internals used (Firefox 157, reference/omni):
//   - SessionStore (gre/moz-src/browser/components/sessionstore/SessionStore.sys.mjs):
//     promiseAllWindowsRestored, getCurrentState() (includes lastSessionState and closed windows).
//   - nsIWindowsRegKey for the Sticky Keys flag (xpcom/ds/nsIWindowsRegKey.idl).

const DIR = 'vitre-thumbs';
const TAB_VALUE = 'vitre-thumb';
const ID = /^[0-9a-f]{32}$/;
/** The sweep waits this long after the session is back (tabs are still being restored before). */
const SWEEP_DELAY = 20_000;
const STICKY_TTL = 5000;

let started = false;
let processStart = 0;
let sticky = { on: false, at: -Infinity };

function dir(): string {
  return PathUtils.join(PathUtils.profileDir, DIR);
}

function file(id: string): string {
  return PathUtils.join(dir(), `${id}.jpg`);
}

/** SessionStore.sys.mjs moved to moz-src: in 157 (spikes/switcher/RESULT.md, risk 3). */
function sessionStore(): any {
  return ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs').SessionStore;
}

async function sweep(): Promise<void> {
  let text = '';
  try {
    text = JSON.stringify(sessionStore().getCurrentState());
  } catch (e) {
    console.error('VitreSwitcher: session state unreadable, sweep skipped', e);
    return;
  }
  let names: string[] = [];
  try {
    if (!(await IOUtils.exists(dir()))) return;
    names = await IOUtils.getChildren(dir());
  } catch {
    return;
  }
  let removed = 0;
  for (const path of names) {
    const leaf = PathUtils.filename(path);
    const id = leaf.replace(/\.jpg(\.tmp)?$/, '');
    if (!ID.test(id) || text.includes(id)) continue;
    try {
      const info = await IOUtils.stat(path);
      if (Number(info.lastModified) >= processStart) continue;
      await IOUtils.remove(path, { ignoreAbsent: true });
      removed++;
    } catch {
      /* in use or gone: the next start tries again */
    }
  }
  if (removed) Services.console.logStringMessage(`VitreSwitcher: removed ${removed} unused thumbnails`);
}

export const VitreSwitcher = {
  TAB_VALUE,

  init(): void {
    if (started) return;
    started = true;
    processStart = Date.now() - 1000;
    try {
      const ss = sessionStore();
      Promise.resolve(ss.promiseAllWindowsRestored)
        .then(() => new Promise((r) => later(r, SWEEP_DELAY)))
        .then(() => sweep())
        .catch((e: unknown) => console.error('VitreSwitcher: sweep failed', e));
    } catch (e) {
      console.error('VitreSwitcher: no SessionStore, no sweep', e);
    }
  },

  async writeThumb(id: string, bytes: Uint8Array): Promise<boolean> {
    if (!ID.test(id)) return false;
    try {
      await IOUtils.makeDirectory(dir(), { ignoreExisting: true });
      await IOUtils.write(file(id), bytes, { tmpPath: file(id) + '.tmp' });
      return true;
    } catch (e) {
      console.error('VitreSwitcher: thumbnail not saved', e);
      return false;
    }
  },

  async readThumb(id: string): Promise<Uint8Array | null> {
    if (!ID.test(id)) return null;
    try {
      return await IOUtils.read(file(id));
    } catch {
      return null;
    }
  },

  stickyKeys(): boolean {
    const now = Date.now();
    if (now - sticky.at < STICKY_TTL) return sticky.on;
    let on = false;
    const key = Cc['@mozilla.org/windows-registry-key;1'].createInstance(Ci.nsIWindowsRegKey);
    try {
      key.open(Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER, 'Control Panel\\Accessibility\\StickyKeys', Ci.nsIWindowsRegKey.ACCESS_READ);
      if (key.hasValue('Flags')) on = (Number.parseInt(String(key.readStringValue('Flags')), 10) & 1) === 1;
    } catch {
      on = false;
    } finally {
      try {
        key.close();
      } catch {
        /* never opened */
      }
    }
    sticky = { on, at: now };
    return on;
  },
};

/** setTimeout from gre/modules/Timer.sys.mjs (the system modules' global has no window timers). */
function later(fn: (v?: unknown) => void, ms: number): void {
  const { setTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  setTimeout(fn, ms);
}
