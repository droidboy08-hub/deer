// Vitre settings on Gecko: one pref per field under "vitre.", defaults on the default branch,
// one branch observer that fans out to every window. Port of app/src/shared/settings.ts +
// app/src/main/settings.ts. The module is a process singleton, and every browser window lives in
// the parent process, so "broadcast to all windows" is just calling the listeners.

const BRANCH = "vitre.";

/** field path -> [pref type, default, allowed values?]. Covers every field of the Settings interface. */
const SCHEMA = {
  theme: ["string", "system", ["system", "light", "dark"]],
  barAutoHide: ["bool", false],
  "homeBackground.kind": ["string", "windows", ["windows", "image", "video", "none"]],
  "homeBackground.path": ["string", ""],
  switcherStyle: ["string", "deck", ["deck", "grid", "strip"]],
  tabOrder: ["string", "recent", ["recent", "bar"]],
  typeToSearch: ["bool", true],
  closeButton: ["string", "hover", ["hover", "always"]],
  newTabPosition: ["string", "next", ["next", "end"]],
  selectionSearchOpens: ["string", "peek", ["peek", "tab"]],
  shiftClick: ["string", "peek", ["peek", "window"]],
  rebind: ["json", {}],
  searchEngine: ["string", "google", ["google", "bing", "duckduckgo", "brave"]],
  downloadsFolder: ["string", ""],
  askWhereToSave: ["bool", false],
  connections: ["int", 8],
  speedLimitKBps: ["int", 0],
};

const defaults = Services.prefs.getDefaultBranch(BRANCH);
const prefs = Services.prefs.getBranch(BRANCH);

function writeTo(branch, key, type, value) {
  if (type === "bool") branch.setBoolPref(key, !!value);
  else if (type === "int") branch.setIntPref(key, value | 0);
  else if (type === "json") branch.setStringPref(key, JSON.stringify(value));
  else branch.setStringPref(key, String(value));
}

function read(key) {
  const [type, def, allowed] = SCHEMA[key];
  try {
    if (type === "bool") return prefs.getBoolPref(key);
    if (type === "int") return prefs.getIntPref(key);
    if (type === "json") return JSON.parse(prefs.getStringPref(key));
    const v = prefs.getStringPref(key);
    return allowed && !allowed.includes(v) ? def : v;
  } catch (e) {
    return def; // wrong type in about:config, broken JSON...
  }
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] = value;
}

function getPath(obj, path) {
  return path.split(".").reduce((o, p) => (o == null ? undefined : o[p]), obj);
}

const listeners = new Set();
let pending = null;
let started = false;

export const VitreSettings = {
  SCHEMA,
  BRANCH,

  /** Install the defaults and start observing. Call once at startup (idempotent). */
  init() {
    if (started) return;
    started = true;
    for (const [key, [type, def]] of Object.entries(SCHEMA)) writeTo(defaults, key, type, def);
    Services.prefs.addObserver(BRANCH, this);
  },

  /** The whole Settings object, in the shape of app/src/shared/settings.ts. */
  get() {
    this.init();
    const out = {};
    for (const key of Object.keys(SCHEMA)) setPath(out, key, read(key));
    if (!out.downloadsFolder) {
      try {
        out.downloadsFolder = Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path;
      } catch (e) {}
    }
    return out;
  },

  /** Merge a patch (same nesting as Settings). Listeners in every window hear about it once. */
  set(patch) {
    this.init();
    for (const [key, [type]] of Object.entries(SCHEMA)) {
      const v = getPath(patch, key);
      if (v !== undefined) writeTo(prefs, key, type, v);
    }
  },

  /** Back to the default for one field path, e.g. reset("homeBackground.path"). */
  reset(key) {
    prefs.clearUserPref(key);
  },

  /** fn(settings, changedKeys). Returns an unsubscribe function; call it when the window unloads. */
  onChange(fn) {
    this.init();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // nsIObserver: pref observers fire synchronously, once per pref. Coalesce one set() into one call.
  observe(_subject, topic, name) {
    if (topic !== "nsPref:changed") return;
    const key = name.slice(BRANCH.length);
    if (!(key in SCHEMA)) return;
    if (!pending) {
      pending = new Set();
      Promise.resolve().then(() => {
        const changed = [...pending];
        pending = null;
        const s = this.get();
        for (const fn of [...listeners]) {
          try {
            fn(s, changed);
          } catch (e) {
            console.error(e);
          }
        }
      });
    }
    pending.add(key);
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
};
