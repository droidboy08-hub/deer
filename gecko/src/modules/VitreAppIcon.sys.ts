// The app icon (Settings › Appearance › App icon, setting appIcon): which of Deer's two icons the
// windows, the taskbar and Deer's own shortcuts show. The icons are .ico files next to the engine,
// <engine>\browser\chrome\icons\default\<name>.ico, built by tools/make-icon.py.
//
//   VitreAppIcon.iconName()   the root attribute for a new window: icon="<name>" makes Gecko load
//                             <name>.ico before the window's first layout (VitreStartup.brandWindow)
//   VitreAppIcon.apply()      switch every open window (nsIWindowsUIUtils.setWindowIcon) and point
//                             Deer's shortcuts at the chosen .ico (nsIWindowsShellService.setShortcutsIcon)
//   VitreAppIcon.init()       idempotent: follow the setting; after an update reinstalls the shortcuts
//                             (with Deer.exe's own icon, gold), point them at the chosen icon again
//
// Shortcuts: only an installed Deer owns any. They are the ones Deer's setup recorded in
// <install>\install.ini (Start menu, Desktop) and the taskbar pin Windows copies from the Start menu
// one (...\User Pinned\TaskBar\Deer.lnk), plus whatever Firefox's enumerateInstallShortcuts finds for
// Deer's AppUserModelIDs. A development run (no install.ini) never touches any shortcut.
// Firefox's own custom-icon feature (CustomIconManager, browser.shell.customIcon.enabled) is off in
// Deer: its catalog points at icon resources inside firefox.exe.
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import type { Settings } from '../shared/settings';

/** setting value -> .ico name. The gold icon keeps the name vitre.ico (installer, launcher, deer.exe read it). */
const ICONS: Record<Settings['appIcon'], string> = { gold: 'vitre', orange: 'deer-orange' };
/** AppUserModelIDs Deer's shortcuts carry: Deer.Browser (installer and windows), Vitre.Browser on shortcuts made before the rename. */
const SHORTCUT_IDS = ['Deer.Browser', 'Vitre.Browser'];

let inited = false;
let current = '';

function iconFile(name: string): any {
  const file = Services.dirsvc.get('AChrom', Ci.nsIFile);
  file.append('icons');
  file.append('default');
  file.append(name + '.ico');
  return file;
}

/** The PNG frame of an .ico (tools/make-icon.py writes every frame as PNG): the smallest one of at least `size` px, else the largest. */
function frame(ico: Uint8Array, size: number): Uint8Array | null {
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  if (ico.length < 6 || view.getUint16(2, true) !== 1) return null;
  const frames: { w: number; at: number; len: number }[] = [];
  for (let i = 0, n = view.getUint16(4, true); i < n && 6 + 16 * i + 16 <= ico.length; i++) {
    const e = 6 + 16 * i;
    const len = view.getUint32(e + 8, true);
    const at = view.getUint32(e + 12, true);
    if (at + len <= ico.length && ico[at] === 0x89 && ico[at + 1] === 0x50) frames.push({ w: ico[e] || 256, at, len });
  }
  frames.sort((a, b) => a.w - b.w);
  const f = frames.find((x) => x.w >= size) ?? frames[frames.length - 1];
  return f ? ico.subarray(f.at, f.at + f.len) : null;
}

function decode(png: Uint8Array): any {
  const tools = Cc['@mozilla.org/image/tools;1'].getService(Ci.imgITools);
  return tools.decodeImageFromArrayBuffer(png.slice().buffer, 'image/png');
}

/** WM_SETICON with the frames Windows asks for at this window's scale (16/32 px at 100 %). */
function setWindowIcon(win: any, ico: Uint8Array): void {
  const scale = win.devicePixelRatio || 1;
  const small = frame(ico, Math.round(16 * scale));
  const big = frame(ico, Math.round(32 * scale));
  if (!small || !big) return;
  Cc['@mozilla.org/windows-ui-utils;1'].getService(Ci.nsIWindowsUIUtils).setWindowIcon(win, decode(small), decode(big));
}

/** <install>\install.ini of an installed Deer (the engine is <install>\engine\deer.exe), else null. */
async function installRecord(): Promise<Record<string, string> | null> {
  try {
    const ini = Services.dirsvc.get('XREExeF', Ci.nsIFile).parent.parent;
    ini.append('install.ini');
    if (!ini.exists()) return null;
    const out: Record<string, string> = {};
    for (const line of (await IOUtils.readUTF8(ini.path)).split(/\r?\n/)) {
      const m = /^\s*([^=;#\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return null;
  }
}

async function shortcuts(): Promise<string[]> {
  if (VitreAppIcon.testShortcuts) return VitreAppIcon.testShortcuts;
  const record = await installRecord();
  if (!record) return [];
  const paths = [record.StartMenuShortcut, record.DesktopShortcut];
  try {
    const pins = Services.dirsvc.get('AppData', Ci.nsIFile);
    for (const part of ['Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Deer.lnk']) pins.append(part);
    paths.push(pins.path);
  } catch {
    /* no AppData */
  }
  const shell = Cc['@mozilla.org/browser/shell-service;1'].getService(Ci.nsIWindowsShellService);
  for (const id of SHORTCUT_IDS) {
    try {
      paths.push(...(await shell.enumerateInstallShortcuts(id)));
    } catch {
      /* not on this build */
    }
  }
  const seen = new Set<string>();
  return paths.filter((p) => {
    if (!p || seen.has(p.toLowerCase())) return false;
    seen.add(p.toLowerCase());
    try {
      const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      f.initWithPath(p);
      return f.exists();
    } catch {
      return false;
    }
  });
}

async function updateShortcuts(name: string): Promise<string[]> {
  const paths = await shortcuts();
  if (!paths.length) return [];
  const shell = Cc['@mozilla.org/browser/shell-service;1'].getService(Ci.nsIWindowsShellService);
  await shell.setShortcutsIcon(paths, iconFile(name).path, 0);
  return paths;
}

export const VitreAppIcon = {
  /** Tests: shortcut files to update instead of an installed Deer's (null = the real ones). */
  testShortcuts: null as string[] | null,
  /** What the last apply() did, for tests: the icon name and the shortcuts it updated. */
  last: null as { name: string; windows: number; shortcuts: string[]; error?: string } | null,

  iconName(): string {
    try {
      return ICONS[VitreSettings.get().appIcon] ?? ICONS.gold;
    } catch {
      return ICONS.gold;
    }
  },

  async apply(options: { windows?: boolean } = {}): Promise<void> {
    const name = VitreAppIcon.iconName();
    current = name;
    const result: NonNullable<typeof VitreAppIcon.last> = { name, windows: 0, shortcuts: [] };
    if (options.windows !== false) {
      const ico = await IOUtils.read(iconFile(name).path);
      for (const win of Services.wm.getEnumerator(null)) {
        try {
          const root = win.document?.documentElement;
          if (!root || win.closed) continue;
          root.setAttribute('icon', name);
          setWindowIcon(win, ico);
          result.windows++;
        } catch {
          /* window going away, or not a top-level chrome window */
        }
      }
    }
    try {
      result.shortcuts = await updateShortcuts(name);
    } catch (e) {
      result.error = String(e);
      console.error('Deer: could not update the shortcuts’ icon', e);
    }
    VitreAppIcon.last = result;
  },

  init(): void {
    if (inited) return;
    inited = true;
    VitreSettings.onChange((s: Settings, changed: string[]) => {
      if (changed.includes('appIcon') && ICONS[s.appIcon] !== current) void VitreAppIcon.apply();
    });
    // User prefs are read by now (the first window opens after final-ui-startup). New windows get the
    // icon from their root attribute; only the shortcuts can be stale (a Deer update recreates them).
    current = VitreAppIcon.iconName();
    if (current !== ICONS.gold) void VitreAppIcon.apply({ windows: false });
  },
};
