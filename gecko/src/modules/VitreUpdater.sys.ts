// Deer's updater: finds a newer Deer on GitHub, downloads its setup, and installs it when the person
// clicks "Restart to update". A process singleton (window code: b.sys('VitreUpdater')).
//
// What is contacted, and when (nothing else: no IDs, no telemetry, no cookies, no query string):
//   GET <apiBase>/repos/<repo>/releases/latest   prefs vitre.update.apiBase (default
//        https://api.github.com) and vitre.update.repo (default droidboy08-hub/deer); automatically
//        at most once a day (vitre.update.auto, default on; the first check vitre.update.firstDelay
//        seconds after start, default 300, never during startup; vitre.update.lastCheck holds the
//        time of the last one, in seconds) and when the person clicks "Check for updates".
//   Only when that release is newer: its SHA256SUMS.txt and Deer-Setup.exe assets (GitHub's
//        download addresses, which redirect to GitHub's file host).
//   The requests carry the browser's own headers plus GitHub's Accept and API version.
// Addresses: with the default apiBase, an asset address must be https://github.com/<repo>/releases/
// download/..., and every answer must come from GitHub's own hosts over https after redirects
// (api.github.com for the API; github.com, objects.githubusercontent.com or
// release-assets.githubusercontent.com for files). With another apiBase (the tests' stand-in), every
// address and every redirect must stay on that base's own scheme and host.
// Answers: the API's JSON and SHA256SUMS.txt are read within a time limit (30 s without a byte, 2 min
// in all) and a size limit (1 MB, 64 KB); the setup's download stops after 60 s without a byte.
// Only an installed release updates: <install>\deer-version.json (installer/build.py) with channel
// "release", and <install>\install.ini (Deer Setup's record; not Mode=test), where <install> is the
// parent of the engine's folder (<install>\engine\deer.exe). A development run, a local-test build, a
// test install or a release folder that was never installed never contacts anything (phase 'off').
//
// Releases: GitHub releases of the repo, tag vX.Y.Z (or VX.Y.Z; semver; drafts, prereleases and tags
// with a prerelease part are never offered, and only a version above the installed one is), assets
// Deer-Setup.exe (the name deer-version.json's "setup" gives) and SHA256SUMS.txt ("<sha256>  <name>"
// lines), both from the SAME release.
// Signed releases: when this build carries the release key's public half (__DEER_UPDATE_KEY__, from
// gecko/update-key.txt; tools/release-key.mjs), a release must also have SHA256SUMS.txt.sig, the
// base64 Ed25519 signature of that exact SHA256SUMS.txt by the private half, or nothing is downloaded.
// So a release that is not the owner's (a stolen account or token, a repository name claimed after a
// rename) is refused. Without a key (no update-key.txt yet) releases are trusted as GitHub serves them. A release whose setup turned out to be another version than
// its tag (setup reported success, or "a newer version is installed", yet the install still reads
// below the tag) is remembered in vitre.update.skip ("<version> <sha256>") and not offered again
// until its setup changes.
//
// Download folder: %LOCALAPPDATA%\Deer\updates (vitre.localAppData stands in for %LOCALAPPDATA%):
//   Deer-Setup-<v>.json     what the release said: version, tag, size, SHA-256, address
//   Deer-Setup-<v>.exe.part while it downloads; continued with a Range request when the same release
//                           is still the latest (a server that ignores Range starts it over)
//   Deer-Setup-<v>.exe      once its size is the release's and its SHA-256 the one SHA256SUMS.txt
//                           gives (and GitHub's own asset digest, when the API gives one)
//   setup.log               the log of the last setup run (/log:), read at the next start
// Anything else in the folder (older versions, their parts, other files) is removed; so is a staged
// update once the installed version has caught up. Only regular files are ever removed.
//
// Apply (restartToUpdate, the person's click): the staged file is hashed again; Deer asks to quit as
// Firefox's own restart does (quit-application-requested "restart": no close-tabs warning). The
// downloads module may hold that back with its prompt; its "Restart" then calls proceedRestart(),
// which hashes the file once more before quitting. Any other quit or restart asked for meanwhile
// (by the person or by Firefox) drops the held one: only the prompt that held THIS restart back
// goes on with the update. browser.sessionstore.resume_session_once is set so the next start
// restores the session; when a window refuses to close (a page's "leave this page?") the quit
// stops, and so does the update (the flag is cleared, the update is offered again). When the quit
// really happens ("quit-application", data "shutdown") the setup is opened for reading with no
// write or delete sharing (so it cannot be changed, renamed or replaced), hashed a last time
// against the SHA-256 the click checked, and only then started, detached, with nsIProcess (it
// outlives Deer; Subprocess would end it with its job object):
//     Deer-Setup.exe /update /installdir:<install> /wait:180 /launch /log:<updates>\setup.log
//                    /sha256:<the setup's SHA-256>
// A setup that changed is not started (and is removed). Setup checks /sha256 against its own file
// and keeps that file locked the same way while it runs (installer/Setup.cs UpdateMain), so the copy
// it starts with administrator permission for an all-users install (install.ini Scope=machine) is
// the file Deer checked. Setup waits for Deer to close, installs over it and starts Deer again (also
// when it stops early). The UI says beforehand that Windows will ask for permission (state.machine).
// The next start reads setup.log's "RESULT <code>": an update that did not install says why and
// stays ready to try again; a damaged setup (4) is dropped and downloaded again at the next check.
// Not covered: a program running as the person can replace both the staged setup and its .json
// record before the click (the release key is checked at download time; the setup is not
// Authenticode-signed).
//
// Contract:
//   init()                  idempotent (VitreStartup, at final-ui-startup): reads the install, tidies
//                           the updates folder, schedules the automatic check. No network.
//   state() / onChange(fn)  UpdateState below; fn(state) on every change; returns the unsubscribe
//   check({ manual })       ask GitHub now; nothing in phase 'off'. Resolves when done (never rejects)
//   restartToUpdate()       apply the staged update (phase 'ready'); true when Deer is quitting for it
//   proceedRestart()        for the downloads quit prompt's "Restart": true when it was this update's
//                           (Deer then quits for it once the file checked out again)
//   setAuto(on)             the automatic check (vitre.update.auto)
//   setNote(win, fn)        a window's "Deer <v> is ready" note: fn(state) shows it and returns true.
//                           Shown once per version (vitre.update.notified), in the most recent window.
// Tests: testInstallDir (a folder holding deer-version.json and install.ini, standing in for the
// install; reload() reads it); vitre.update.testCommand (JSON [program, ...first arguments]) is
// started instead of the setup, with the setup's path and arguments appended, and only while
// testInstallDir is set. With testInstallDir set and no test command nothing is started at all.
// lastLaunch records what was (or would have been) started, and why not when it was refused.
// vitre.update.testKey (base64 public key) stands in for the built-in release key, also only while
// testInstallDir is set.
//
// Firefox internals (157, reference/omni): Services.dirsvc "XREExeF"; nsIProcess.runw;
// quit-application-requested (nsISupportsPRBool, gre/chrome/toolkit/content/global/globalOverlay.js
// canQuitApplication), quit-application-granted and quit-application (nsAppStartup);
// Services.startup.quit(eAttemptQuit) returns only once every window agreed to close (a page's
// "leave this page?" is answered inside it: browser/chrome/browser/content/browser/browser.js
// CanCloseWindow), notifying quit-application-granted before it returns when the quit goes ahead
// (true) and not at all when a window refused (shuttingDown only turns true at quit-application;
// measured on 157);
// browser.sessionstore.resume_session_once (moz-src/browser/components/sessionstore/
// SessionStartup.sys.mjs isAutomaticRestoreEnabled); nsICryptoHash; kernel32 CreateFileW through
// js-ctypes (gre/modules/ctypes.sys.mjs).
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { compareVersions, displayVersion, parseVersion, sumFor } from './update/version';

declare global {
  interface VitreSysModules {
    VitreUpdater: typeof VitreUpdater;
  }
}

export type UpdatePhase = 'off' | 'idle' | 'checking' | 'current' | 'downloading' | 'verifying' | 'ready' | 'restarting' | 'failed';

export interface UpdateState {
  phase: UpdatePhase;
  /** Deer's version: the install's deer-version.json, else the one built in (gecko/package.json). */
  version: string;
  /** An installed release: updates are possible (phase is never 'off'). */
  release: boolean;
  /** Phase 'off': why, as the status line says it. */
  offReason: string;
  /** Installed for all users: setup asks Windows for administrator permission to update. */
  machine: boolean;
  /** Automatic checks (vitre.update.auto). */
  auto: boolean;
  /** The newer version found, downloading or ready ('' when none). */
  available: string;
  /** Phase 'downloading': bytes so far and the setup's size. */
  received: number;
  total: number;
  /** When GitHub was last asked (ms since 1970; 0 = never). */
  lastCheck: number;
  /** When the next automatic check runs (ms since 1970; 0 = none scheduled). */
  nextCheck: number;
  /** Phase 'failed': what went wrong, one sentence. */
  error: string;
  /** Phase 'ready': why the previous setup run did not install it ('' when it did not run). */
  lastAttempt: string;
}

/** What /releases/latest offers, once checked. */
interface Release {
  version: string;
  tag: string;
  name: string;
  size: number;
  sha256: string;
  url: string;
}

interface Install {
  dir: string;
  version: string;
  channel: string;
  setup: string;
  machine: boolean;
  test: boolean;
  /** install.ini exists. */
  recorded: boolean;
  /** deer-version.json exists and names a version. */
  versionFile: boolean;
}

const PREF = {
  auto: 'vitre.update.auto',
  repo: 'vitre.update.repo',
  apiBase: 'vitre.update.apiBase',
  firstDelay: 'vitre.update.firstDelay',
  lastCheck: 'vitre.update.lastCheck',
  notified: 'vitre.update.notified',
  skip: 'vitre.update.skip',
  testCommand: 'vitre.update.testCommand',
  testKey: 'vitre.update.testKey',
} as const;
const REPO = 'droidboy08-hub/deer';
const API = 'https://api.github.com';
/** Where GitHub's API and its release files answer from (with the default apiBase). */
const API_HOST = 'api.github.com';
const ASSET_HOST = 'github.com';
const FILE_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const FIRST_DELAY = 300;
const DAY = 24 * 3600 * 1000;
/** Seconds setup waits for Deer to close before it gives up (exit 3, Deer stays as it was). */
const WAIT = 180;
const SETUP = 'Deer-Setup.exe';
const SUMS = 'SHA256SUMS.txt';
const SIG = 'SHA256SUMS.txt.sig';
/** The release key's public half (base64, 32 bytes), or '' when releases are not signed (tools/build.mjs). */
const UPDATE_KEY = __DEER_UPDATE_KEY__;
const SETUP_LOG = 'setup.log';
const MAX_SETUP = 1024 * 1024 * 1024;
const MAX_API = 1024 * 1024;
const MAX_SUMS = 64 * 1024;
const MAX_SIG = 4 * 1024;
/** No byte for this long: the answer (headers or body) has stalled. */
const ANSWER_TIMEOUT = 30_000;
/** A small answer (the API's JSON, SHA256SUMS.txt) must be complete within this. */
const SMALL_DEADLINE = 120_000;
const IDLE_TIMEOUT = 60_000;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])$/i;
/** gecko/package.json "version", baked in by tools/build.mjs. */
const BUILT = __DEER_VERSION__;

// ---- the sentences the person reads (one each) ----
const OFFLINE = 'Couldn’t reach GitHub; check your internet connection and try again.';
const BAD_ANSWER = 'GitHub’s answer about the latest release couldn’t be read; try again later.';
const STALLED = 'GitHub stopped answering half way; try again later.';
const BAD_URL = 'GitHub gave a download address Deer doesn’t use, so nothing was downloaded.';
const REDIRECTED = 'GitHub sent the download to a server Deer doesn’t use, so nothing was downloaded.';
const TRUNCATED = 'The download stopped before it finished; Deer continues it at the next check.';
const MISMATCH = 'The download didn’t match its published checksum, so Deer deleted it.';
const SIZE = 'The download wasn’t the size GitHub gave for it, so Deer deleted it.';
const DAMAGED = 'The downloaded update was damaged, so Deer deleted it; check for updates to download it again.';
const sumsUnreadable = (v: string): string => `${SUMS} of Deer ${v} couldn’t be read, so Deer didn’t download it.`;
const otherVersion = (v: string): string => `Deer ${v} didn’t install: its release holds the setup of another version.`;
const skipped = (v: string): string => `Deer ${v}’s release holds the setup of another version, so Deer doesn’t offer it.`;
const damagedAtSetup = (v: string): string => `Deer ${v} didn’t install because the downloaded setup was damaged; Deer downloads it again at the next check.`;
const unsigned = (v: string): string => `Deer ${v}’s release isn’t signed, so Deer didn’t download it.`;
const wrongKey = (v: string): string => `Deer ${v}’s release isn’t signed with Deer’s key, so Deer didn’t download it.`;

class UpdateError extends Error {}
/** The check was stopped (Deer is quitting). */
class Stopped extends Error {}
/** A small answer was larger than its limit. */
class TooBig extends Error {}

const listeners = new Set<(s: UpdateState) => void>();
const notes = new Map<any, (s: UpdateState) => boolean>();
let state: UpdateState = {
  phase: 'off',
  version: BUILT,
  release: false,
  offReason: '',
  machine: false,
  auto: true,
  available: '',
  received: 0,
  total: 0,
  lastCheck: 0,
  nextCheck: 0,
  error: '',
  lastAttempt: '',
};
let inited = false;
let startedAt = Date.now();
let install: Install | null = null;
let loading: Promise<void> | null = null;
let running: Promise<void> | null = null;
let controller: AbortController | null = null;
let timer: any = null;
let noteTimer: any = null;
let quitting = false;
/** The setup to start: its path, the SHA-256 the click checked, and its arguments' parts. */
interface Pending {
  exe: string;
  sha256: string;
  installDir: string;
  log: string;
  version: string;
}
/** The restart the downloads module's prompt held back; its "Restart" goes on with this update. */
let held: Pending | null = null;
/** Armed: the quit that is happening is this update's restart. */
let armed: Pending | null = null;
/** This module is asking to quit itself (quit-application-requested from askToQuit). */
let asking = false;

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  for (const fn of [...listeners]) {
    try {
      fn(state);
    } catch (e) {
      console.error('Deer updater: a listener failed', e);
    }
  }
}

// ---- prefs ----

function str(name: string): string {
  try {
    return Services.prefs.getStringPref(name, '');
  } catch {
    return '';
  }
}

function autoOn(): boolean {
  try {
    return Services.prefs.getBoolPref(PREF.auto, true);
  } catch {
    return true;
  }
}

function lastCheckMs(): number {
  try {
    return Math.max(0, Services.prefs.getIntPref(PREF.lastCheck, 0)) * 1000;
  } catch {
    return 0;
  }
}

function firstDelayMs(): number {
  try {
    return Math.max(0, Services.prefs.getIntPref(PREF.firstDelay, FIRST_DELAY)) * 1000;
  } catch {
    return FIRST_DELAY * 1000;
  }
}

/** The API base: https, or plain http on this computer only (the tests' stand-in for GitHub). */
function apiBase(): string {
  const v = str(PREF.apiBase).replace(/\/+$/, '');
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.test(u.hostname))) return v;
  } catch {
    /* not a URL: the default */
  }
  return API;
}

/** GitHub itself (the default apiBase), or a stand-in whose own host serves everything. */
function official(): boolean {
  return apiBase() === API;
}

function repo(): string {
  const v = str(PREF.repo);
  return /^[\w.-]+\/[\w.-]+$/.test(v) ? v : REPO;
}

/**
 * An asset address from the API's answer, as GitHub gives it: https://github.com/<repo>/releases/
 * download/<tag>/<name>, nothing else (a stand-in base: the same path on the base's scheme and host).
 */
function assetUrl(text: unknown): string {
  try {
    const u = new URL(String(text));
    const path = u.pathname.toLowerCase().startsWith(`/${repo()}/releases/download/`.toLowerCase()) && !u.search && !u.username && !u.password;
    if (official()) {
      if (path && u.protocol === 'https:' && u.hostname === ASSET_HOST && !u.port) return u.href;
    } else {
      const base = new URL(apiBase());
      if (path && u.protocol === base.protocol && u.host === base.host) return u.href;
    }
  } catch {
    /* below */
  }
  throw new UpdateError(BAD_URL);
}

/** Where an answer came from after redirects: GitHub's own hosts over https (a stand-in: its host). */
function cameFrom(res: Response, kind: 'api' | 'file'): boolean {
  try {
    const u = new URL(res.url);
    if (official()) return u.protocol === 'https:' && !u.port && (kind === 'api' ? u.hostname === API_HOST : FILE_HOSTS.has(u.hostname));
    const base = new URL(apiBase());
    return u.protocol === base.protocol && u.host === base.host;
  } catch {
    return false;
  }
}

function testCommand(): string[] | null {
  try {
    const cmd = JSON.parse(str(PREF.testCommand));
    if (Array.isArray(cmd) && cmd.length && cmd.every((x) => typeof x === 'string' && x)) return cmd;
  } catch {
    /* none */
  }
  return null;
}

/** The release key to check releases with ('' = releases are not signed). A test key only in tests. */
function releaseKey(): string {
  if (VitreUpdater.testInstallDir !== null) {
    const k = str(PREF.testKey);
    if (k) return k;
  }
  return UPDATE_KEY;
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `data` signed with the release key (Ed25519, WebCrypto). */
async function signedBy(key: string, data: Uint8Array, sigText: string): Promise<boolean> {
  const raw = fromBase64(key);
  const sig = fromBase64(sigText);
  if (!raw || raw.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const k = await crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, k, sig as Uint8Array<ArrayBuffer>, data as Uint8Array<ArrayBuffer>);
  } catch (e) {
    console.error('Deer updater: could not check the release signature', e);
    return false;
  }
}

/** vitre.update.skip: the release whose setup is another version ("<version> <sha256>"). */
function skippedRelease(): { version: string; sha256: string } | null {
  const m = /^(\S+) ([0-9a-f]{64})$/.exec(str(PREF.skip));
  return m ? { version: m[1], sha256: m[2] } : null;
}

function skipRelease(r: Release | null): void {
  try {
    if (r) Services.prefs.setStringPref(PREF.skip, `${r.version} ${r.sha256}`);
    else Services.prefs.clearUserPref(PREF.skip);
    Services.prefs.savePrefFile(null);
  } catch {
    /* not fatal: at worst it is offered again */
  }
}

// ---- the install ----

function exeInstallDir(): string {
  try {
    const exe = Services.dirsvc.get('XREExeF', Ci.nsIFile);
    return String(exe.parent?.parent?.path ?? '');
  } catch {
    return '';
  }
}

function parseIni(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^=;#[\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function readInstall(): Promise<Install> {
  const dir = VitreUpdater.testInstallDir ?? exeInstallDir();
  const out: Install = { dir, version: BUILT, channel: '', setup: SETUP, machine: false, test: false, recorded: false, versionFile: false };
  if (!dir) return out;
  try {
    const j = await IOUtils.readJSON(PathUtils.join(dir, 'deer-version.json'));
    if (j && typeof j === 'object' && parseVersion(j.version)) {
      out.versionFile = true;
      out.version = displayVersion(j.version);
      out.channel = typeof j.channel === 'string' ? j.channel : '';
      if (typeof j.setup === 'string' && /^[\w.-]+\.exe$/i.test(j.setup)) out.setup = j.setup;
    }
  } catch {
    /* a development run: no such file */
  }
  try {
    const ini = parseIni(await IOUtils.readUTF8(PathUtils.join(dir, 'install.ini')));
    out.recorded = true;
    out.machine = ini.Scope === 'machine';
    out.test = ini.Mode === 'test';
  } catch {
    /* not installed by Deer Setup */
  }
  return out;
}

function offReason(i: Install): string {
  if (!i.versionFile || i.channel !== 'release') return 'Updates are off in development builds';
  if (!i.recorded) return 'Updates are off because this copy of Deer wasn’t installed with Deer Setup';
  if (i.test) return 'Updates are off in test installs';
  return '';
}

const enabled = (i: Install | null): i is Install => !!i && !offReason(i);

// ---- the updates folder ----

function localAppData(): string {
  return str('vitre.localAppData') || Services.dirsvc.get('LocalAppData', Ci.nsIFile).path;
}

function updatesDir(): string {
  return PathUtils.join(localAppData(), 'Deer', 'updates');
}

const stemOf = (version: string): string => 'Deer-Setup-' + version;
const FILE = /^Deer-Setup-(.+?)\.(exe|exe\.part|json)$/i;

async function exists(path: string): Promise<boolean> {
  try {
    return await IOUtils.exists(path);
  } catch {
    return false;
  }
}

async function sizeOf(path: string): Promise<number> {
  try {
    const st = await IOUtils.stat(path);
    return st.type === 'regular' ? Number(st.size) : -1;
  } catch {
    return -1;
  }
}

/** Remove a regular file; never a folder or a link to one. */
async function removeFile(path: string): Promise<void> {
  try {
    const st = await IOUtils.stat(path);
    if (st.type === 'regular') await IOUtils.remove(path);
  } catch {
    /* gone already, or in use (a setup still closing): next time */
  }
}

/** A write in the updates folder; any failure reads as the folder not being writable. */
async function disk<T>(fn: () => Promise<T>, dir: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error('Deer updater: could not write in ' + dir, e);
    throw new UpdateError(`Deer can’t save updates in ${dir}.`);
  }
}

/** Remove every regular file of the folder except the given versions' files (and setup.log when kept). */
async function sweep(dir: string, keep: Set<string>, keepLog = true): Promise<void> {
  let children: string[] = [];
  try {
    children = await IOUtils.getChildren(dir);
  } catch {
    return;
  }
  for (const path of children) {
    const name = PathUtils.filename(path);
    if (keepLog && name.toLowerCase() === SETUP_LOG) continue;
    const m = FILE.exec(name);
    if (m && keep.has(m[1])) continue;
    await removeFile(path);
  }
}

function asRelease(j: any): Release | null {
  if (!j || typeof j !== 'object') return null;
  const ok =
    typeof j.version === 'string' &&
    !!parseVersion(j.version) &&
    typeof j.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(j.sha256) &&
    Number.isSafeInteger(j.size) &&
    j.size > 0 &&
    typeof j.url === 'string' &&
    typeof j.name === 'string';
  return ok ? { version: j.version, tag: String(j.tag ?? ''), name: j.name, size: j.size, sha256: j.sha256, url: j.url } : null;
}

async function readMeta(dir: string, version: string): Promise<Release | null> {
  try {
    const r = asRelease(await IOUtils.readJSON(PathUtils.join(dir, stemOf(version) + '.json')));
    return r && r.version === version ? r : null;
  } catch {
    return null;
  }
}

/** The newest complete download newer than the installed version: its file and what its release said. */
async function findStaged(i: Install): Promise<(Release & { path: string }) | null> {
  const dir = updatesDir();
  let children: string[] = [];
  try {
    children = await IOUtils.getChildren(dir);
  } catch {
    return null;
  }
  let best: (Release & { path: string }) | null = null;
  for (const path of children) {
    const m = /^Deer-Setup-(.+)\.exe$/i.exec(PathUtils.filename(path));
    if (!m || !(compareVersions(m[1], i.version) > 0)) continue;
    if (best && !(compareVersions(m[1], best.version) > 0)) continue;
    const meta = await readMeta(dir, m[1]);
    if (meta && (await sizeOf(path)) === meta.size) best = { ...meta, path };
  }
  return best;
}

/** Setup's exit codes (installer/Setup.cs, class Exit) as the reason an update did not install. */
function setupFailure(code: number): string {
  const why: Record<number, string> = {
    3: 'Deer was still open',
    4: 'the downloaded setup was damaged',
    5: 'the install failed',
    6: 'a newer Deer is already installed',
    7: 'this version of Windows isn’t supported',
    8: 'the install folder can’t be used',
    9: 'another Deer setup was running',
    10: 'Deer isn’t installed in that folder',
    11: 'administrator permission was refused',
  };
  return why[code] ?? `setup ended with code ${code}`;
}

/**
 * The folder at start (and after reload): what is staged, what the last setup run said, and
 * everything that no longer belongs there removed.
 */
async function tidy(i: Install): Promise<void> {
  const dir = updatesDir();
  if (!(await exists(dir))) {
    set({ phase: 'idle', available: '', lastAttempt: '' });
    return;
  }
  let staged = await findStaged(i);
  const keep = new Set<string>();
  if (staged) keep.add(staged.version);
  // A part of a version newer than the installed one is continued at the next check.
  try {
    for (const path of await IOUtils.getChildren(dir)) {
      const m = /^Deer-Setup-(.+)\.exe\.part$/i.exec(PathUtils.filename(path));
      if (m && compareVersions(m[1], i.version) > 0 && (await readMeta(dir, m[1]))) keep.add(m[1]);
    }
  } catch {
    /* unreadable folder: nothing to keep */
  }
  let lastAttempt = '';
  let dropped = '';
  const log = PathUtils.join(dir, SETUP_LOG);
  if (await exists(log)) {
    let code: number | null = null;
    try {
      const all = [...(await IOUtils.readUTF8(log)).matchAll(/RESULT (\d+)/g)];
      if (all.length) code = Number(all[all.length - 1][1]);
    } catch {
      /* unreadable: as if it had not run */
    }
    if (staged && code !== null) {
      if (code === 0 || code === 6) {
        // Setup installed (or found a newer Deer installed), yet the install still reads below the
        // staged version: the release's setup is another version than its tag. Never offered again.
        dropped = otherVersion(staged.version);
        skipRelease(staged);
      } else if (code === 4) {
        // Damaged (or changed after Deer checked it): of no further use; the next check downloads it again.
        dropped = damagedAtSetup(staged.version);
      } else {
        lastAttempt = setupFailure(code);
      }
      if (dropped) {
        keep.delete(staged.version);
        staged = null;
      }
    }
    await removeFile(log);
  }
  await sweep(dir, keep);
  if (dropped) {
    console.error('Deer updater: ' + dropped);
    set({ phase: 'failed', error: dropped, available: '', lastAttempt: '' });
    return;
  }
  set({ phase: staged ? 'ready' : 'idle', available: staged?.version ?? '', lastAttempt: staged ? lastAttempt : '' });
  if (staged) noteSoon();
}

// ---- GitHub ----

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function httpError(res: Response): UpdateError {
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 429 || (res.status === 403 && remaining === '0')) {
    const resetAt = Number(res.headers.get('x-ratelimit-reset')) * 1000 || (Number(res.headers.get('retry-after')) ? Date.now() + Number(res.headers.get('retry-after')) * 1000 : 0);
    return new UpdateError(resetAt > Date.now() ? `GitHub’s limit for update checks was reached; try again after ${clock(resetAt)}.` : 'GitHub’s limit for update checks was reached; try again later.');
  }
  if (res.status === 404) return new UpdateError('Deer’s releases weren’t found on GitHub.');
  return new UpdateError(`GitHub answered with error ${res.status}; try again later.`);
}

function join(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * A small answer (the API's JSON, SHA256SUMS.txt), read whole: its headers and then each piece of its
 * body within ANSWER_TIMEOUT, all of it within SMALL_DEADLINE, at most `limit` bytes (TooBig), and
 * only from where `kind` may answer after redirects. Never sends cookies. Stopped with `outer` too.
 */
async function getSmall(url: string, headers: Record<string, string>, outer: AbortSignal, limit: number, kind: 'api' | 'file'): Promise<Uint8Array> {
  const ac = new AbortController();
  const stop = (): void => ac.abort();
  outer.addEventListener('abort', stop, { once: true });
  let idle = setTimeout(stop, ANSWER_TIMEOUT);
  const deadline = setTimeout(stop, SMALL_DEADLINE);
  let reader: any = null;
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: ac.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
    } catch {
      if (outer.aborted) throw new Stopped();
      throw new UpdateError(OFFLINE);
    }
    if (!cameFrom(res, kind)) throw new UpdateError(kind === 'api' ? BAD_ANSWER : REDIRECTED);
    if (!res.ok) throw httpError(res);
    if (!res.body) return new Uint8Array(0);
    reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      let r: { done: boolean; value?: Uint8Array };
      try {
        r = await reader.read();
      } catch {
        if (outer.aborted) throw new Stopped();
        throw new UpdateError(STALLED);
      }
      if (r.done || !r.value) break;
      clearTimeout(idle);
      idle = setTimeout(stop, ANSWER_TIMEOUT);
      n += r.value.byteLength;
      if (n > limit) throw new TooBig();
      chunks.push(r.value);
    }
    return join(chunks, n);
  } finally {
    clearTimeout(idle);
    clearTimeout(deadline);
    outer.removeEventListener('abort', stop);
    ac.abort(); // whatever is left of the answer is not wanted
    try {
      reader?.cancel()?.catch?.(() => undefined);
    } catch {
      /* finished */
    }
  }
}

/** The latest release when it is a newer Deer that can be downloaded; null when Deer is up to date. */
async function latestNewer(i: Install, signal: AbortSignal): Promise<Release | null> {
  let j: any;
  try {
    const bytes = await getSmall(`${apiBase()}/repos/${repo()}/releases/latest`, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal, MAX_API, 'api');
    j = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    if (e instanceof Stopped || e instanceof UpdateError) throw e;
    throw new UpdateError(BAD_ANSWER); // too big, or not JSON
  }
  if (!j || typeof j !== 'object' || typeof j.tag_name !== 'string') throw new UpdateError(BAD_ANSWER);
  const v = parseVersion(j.tag_name);
  if (!v) throw new UpdateError(`GitHub’s latest release is tagged “${j.tag_name.slice(0, 40)}”, which isn’t a version Deer can compare.`);
  // Never offered: drafts, prereleases (flagged, or a tag such as v1.5.0-beta.1).
  if (j.draft === true || j.prerelease === true || v.pre.length) return null;
  const version = displayVersion(j.tag_name);
  if (!(compareVersions(version, i.version) > 0)) return null;

  const assets: any[] = Array.isArray(j.assets) ? j.assets : [];
  const setup = assets.find((a) => a && a.name === i.setup);
  const sums = assets.find((a) => a && a.name === SUMS);
  if (!setup) throw new UpdateError(`Deer ${version} is out, but its release has no ${i.setup} yet.`);
  if (!sums) throw new UpdateError(`Deer ${version}’s release has no ${SUMS}, so Deer didn’t download it.`);
  const size = Number(setup.size);
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SETUP) throw new UpdateError(BAD_ANSWER);
  const url = assetUrl(setup.browser_download_url);
  const key = releaseKey();
  const sig = key ? assets.find((a) => a && a.name === SIG) : null;
  if (key && !sig) throw new UpdateError(unsigned(version));
  let bytes: Uint8Array;
  try {
    bytes = await getSmall(assetUrl(sums.browser_download_url), { Accept: 'application/octet-stream' }, signal, MAX_SUMS, 'file');
  } catch (e) {
    if (e instanceof TooBig) throw new UpdateError(sumsUnreadable(version));
    throw e;
  }
  if (key && sig) {
    let sigText = '';
    try {
      sigText = new TextDecoder().decode(await getSmall(assetUrl(sig.browser_download_url), { Accept: 'application/octet-stream' }, signal, MAX_SIG, 'file'));
    } catch (e) {
      if (!(e instanceof TooBig)) throw e;
    }
    if (!(await signedBy(key, bytes, sigText))) throw new UpdateError(wrongKey(version));
  }
  const text = new TextDecoder().decode(bytes);
  const sha256 = sumFor(text, i.setup);
  if (!sha256) throw new UpdateError(`${SUMS} of Deer ${version} has no checksum for ${i.setup}, so Deer didn’t download it.`);
  // GitHub's own digest of the asset (newer API answers carry "sha256:<hex>"): it must agree.
  const digest = typeof setup.digest === 'string' ? /^sha256:([0-9a-f]{64})$/i.exec(setup.digest) : null;
  if (digest && digest[1].toLowerCase() !== sha256) throw new UpdateError(`GitHub’s checksum for Deer ${version} disagrees with its ${SUMS}, so Deer didn’t download it.`);
  return { version, tag: j.tag_name, name: i.setup, size, sha256, url };
}

function hex(bin: string): string {
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

/** SHA-256 of a file, read in 8 MB steps so windows keep painting. */
async function sha256(path: string, signal?: AbortSignal): Promise<string> {
  const file = newFile(path);
  const size = file.fileSize;
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  const input = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
  input.init(file, -1, 0, 0);
  try {
    for (let done = 0; done < size; ) {
      if (signal?.aborted) throw new Stopped();
      const n = Math.min(8 * 1024 * 1024, size - done);
      hash.updateFromStream(input, n);
      done += n;
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    input.close();
  }
  return hex(hash.finish(false));
}

/** The same, in one go: at quit-application, where nothing asynchronous runs any more. */
function sha256Now(path: string): string {
  const file = newFile(path);
  const size = file.fileSize;
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  const input = Cc['@mozilla.org/network/file-input-stream;1'].createInstance(Ci.nsIFileInputStream);
  input.init(file, -1, 0, 0);
  try {
    for (let done = 0; done < size; ) {
      const n = Math.min(64 * 1024 * 1024, size - done);
      hash.updateFromStream(input, n);
      done += n;
    }
  } finally {
    input.close();
  }
  return hex(hash.finish(false));
}

/**
 * The file opened for reading with read sharing only (kernel32 CreateFileW, FILE_SHARE_READ): until
 * close(), nobody can write it, rename it or delete it (so nothing can be put in its place), while
 * reading and starting it still work. Null when it cannot be opened that way (in use for writing).
 */
function holdFile(path: string): { close(): void } | null {
  let lib: any = null;
  try {
    const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    lib = ctypes.open('kernel32.dll');
    const CreateFileW = lib.declare('CreateFileW', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.char16_t.ptr, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t, ctypes.voidptr_t);
    const CloseHandle = lib.declare('CloseHandle', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t);
    // GENERIC_READ, FILE_SHARE_READ, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL
    const h = CreateFileW(path, 0x80000000, 0x1, null, 3, 0x80, null);
    if (String(ctypes.cast(h, ctypes.intptr_t).value) === '-1') {
      lib.close();
      return null;
    }
    const opened = lib;
    lib = null;
    return {
      close() {
        try {
          CloseHandle(h);
        } finally {
          opened.close();
        }
      },
    };
  } catch (e) {
    console.error('Deer updater: could not hold the setup', e);
    try {
      lib?.close();
    } catch {
      /* closed */
    }
    return null;
  }
}

/** Fetch the setup into `part`, from byte `have` on when the server agrees. Returns the bytes now in it. */
async function fetchInto(rel: Release, part: string, have: number, signal: AbortSignal, dir: string, again = true): Promise<number> {
  const ac = new AbortController();
  const stop = (): void => ac.abort();
  signal.addEventListener('abort', stop, { once: true });
  let idle = setTimeout(stop, ANSWER_TIMEOUT);
  const kick = (): void => {
    clearTimeout(idle);
    idle = setTimeout(stop, IDLE_TIMEOUT);
  };
  const headers: Record<string, string> = { Accept: 'application/octet-stream' };
  if (have) headers.Range = `bytes=${have}-`;
  let reader: any = null;
  try {
    let res: Response;
    try {
      res = await fetch(rel.url, { headers, signal: ac.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow' });
    } catch {
      if (signal.aborted) throw new Stopped();
      throw new UpdateError(OFFLINE);
    }
    if (!cameFrom(res, 'file')) {
      ac.abort();
      throw new UpdateError(REDIRECTED);
    }
    let offset = have;
    if (have && res.status === 206) {
      const m = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(res.headers.get('content-range') ?? '');
      if (!m || Number(m[1]) !== have || (m[2] !== '*' && Number(m[2]) !== rel.size)) {
        // Not the part Deer asked for: start over (once).
        ac.abort();
        await removeFile(part);
        if (!again) throw new UpdateError(TRUNCATED);
        return await fetchInto(rel, part, 0, signal, dir, false);
      }
    } else if (res.status === 416 && have) {
      await removeFile(part);
      if (!again) throw new UpdateError(TRUNCATED);
      return await fetchInto(rel, part, 0, signal, dir, false);
    } else if (res.status === 200) {
      offset = 0; // the whole file (a server that ignores Range): the part starts over
      const length = Number(res.headers.get('content-length') || NaN);
      if (Number.isFinite(length) && length !== rel.size) {
        ac.abort();
        await removeFile(part);
        throw new UpdateError(SIZE);
      }
    } else {
      throw httpError(res);
    }
    if (!res.body) throw new UpdateError(BAD_ANSWER);
    if (offset === 0) await disk(() => IOUtils.write(part, new Uint8Array(0)), dir);
    reader = res.body.getReader();
    let chunks: Uint8Array[] = [];
    let buffered = 0;
    let shown = 0;
    const flush = async (): Promise<void> => {
      if (!buffered) return;
      const data = join(chunks, buffered);
      chunks = [];
      buffered = 0;
      await disk(() => IOUtils.write(part, data, { mode: 'append' }), dir);
    };
    for (;;) {
      let r: { done: boolean; value?: Uint8Array };
      try {
        r = await reader.read();
      } catch {
        break; // the connection was cut: what arrived is kept for the next check
      }
      if (r.done || !r.value) break;
      kick();
      chunks.push(r.value);
      buffered += r.value.byteLength;
      offset += r.value.byteLength;
      if (buffered >= 1024 * 1024) await flush();
      if (offset > rel.size) break;
      if (Date.now() - shown > 200) {
        shown = Date.now();
        set({ received: Math.min(offset, rel.size) });
      }
    }
    await flush();
    set({ received: Math.min(offset, rel.size) });
    if (signal.aborted) throw new Stopped();
    return offset;
  } finally {
    clearTimeout(idle);
    signal.removeEventListener('abort', stop);
    try {
      reader?.cancel()?.catch?.(() => undefined);
    } catch {
      /* finished */
    }
  }
}

/** Download, check and stage one release (see the header). */
async function download(rel: Release, signal: AbortSignal, keepVersion: string): Promise<void> {
  const dir = updatesDir();
  await disk(() => IOUtils.makeDirectory(dir, { createAncestors: true, ignoreExisting: true }), dir);
  const stem = PathUtils.join(dir, stemOf(rel.version));
  const exe = stem + '.exe';
  const part = exe + '.part';
  const meta = await readMeta(dir, rel.version);
  const same = !!meta && meta.sha256 === rel.sha256 && meta.size === rel.size;
  let have = same ? Math.max(0, await sizeOf(part)) : 0;
  if (!same || have > rel.size) {
    await removeFile(part);
    await removeFile(exe);
    have = 0;
  }
  await disk(() => IOUtils.writeJSON(stem + '.json', rel), dir);
  // Parts of other versions are stale; a staged older update stays until this one is ready.
  await sweep(dir, new Set([rel.version, keepVersion].filter(Boolean)));
  set({ phase: 'downloading', available: rel.version, received: have, total: rel.size, error: '' });
  const got = have < rel.size ? await fetchInto(rel, part, have, signal, dir) : have;
  const size = await sizeOf(part);
  if (size < rel.size || got < rel.size) throw new UpdateError(TRUNCATED);
  if (size > rel.size) {
    await removeFile(part);
    throw new UpdateError(SIZE);
  }
  set({ phase: 'verifying' });
  const sum = await sha256(part, signal);
  if (sum !== rel.sha256) {
    await removeFile(part);
    throw new UpdateError(MISMATCH);
  }
  await disk(() => IOUtils.move(part, exe, { noOverwrite: false }), dir);
  await sweep(dir, new Set([rel.version]));
}

async function runCheck(): Promise<void> {
  await VitreUpdater.whenLoaded();
  const i = install;
  if (!enabled(i)) {
    set({ phase: 'off' });
    return;
  }
  if (state.phase === 'restarting' || quitting) return;
  const wasReady = state.phase === 'ready' ? state.available : '';
  const lastAttempt = state.lastAttempt;
  const ac = new AbortController();
  controller = ac;
  const now = Date.now();
  try {
    Services.prefs.setIntPref(PREF.lastCheck, Math.floor(now / 1000));
  } catch {
    /* not fatal */
  }
  set({ phase: 'checking', error: '', received: 0, total: 0, lastCheck: now });
  try {
    const rel = await latestNewer(i, ac.signal);
    if (!rel) {
      // Up to date: a staged update older than or equal to the installed version is gone with sweep.
      await sweep(updatesDir(), new Set(), true);
      set({ phase: 'current', available: '', lastAttempt: '' });
      return;
    }
    const skip = skippedRelease();
    if (skip && skip.version === rel.version && skip.sha256 === rel.sha256) throw new UpdateError(skipped(rel.version));
    const staged = await findStaged(i);
    if (staged && staged.version === rel.version && staged.sha256 === rel.sha256 && staged.size === rel.size) {
      set({ phase: 'ready', available: rel.version, lastAttempt: rel.version === wasReady ? lastAttempt : '' });
      noteSoon();
      return;
    }
    await download(rel, ac.signal, staged?.version ?? '');
    set({ phase: 'ready', available: rel.version, received: 0, total: 0, lastAttempt: '' });
    noteSoon();
  } catch (e) {
    if (e instanceof Stopped || quitting) return;
    let message = e instanceof UpdateError ? e.message : 'Something went wrong while checking for updates; try again later.';
    if (!(e instanceof UpdateError)) console.error('Deer updater: the check failed', e);
    // An update already downloaded is still good: keep offering it.
    const staged = wasReady ? await findStaged(i) : null;
    if (staged && staged.version === wasReady) {
      set({ phase: 'ready', available: wasReady, received: 0, total: 0, lastAttempt });
      return;
    }
    if (!message.endsWith('.')) message += '.';
    set({ phase: 'failed', error: message, received: 0, total: 0, available: '' });
  } finally {
    if (controller === ac) controller = null;
  }
}

// ---- schedule ----

function reschedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  let next = 0;
  if (enabled(install) && autoOn() && !quitting) {
    const now = Date.now();
    const last = Math.min(lastCheckMs(), now);
    next = Math.max(startedAt + firstDelayMs(), last ? last + DAY : 0);
    timer = setTimeout(() => {
      timer = null;
      void VitreUpdater.check({ manual: false });
    }, Math.max(0, next - now));
  }
  if (state.nextCheck !== next) set({ nextCheck: next });
}

// ---- the note ----

function noteSoon(delay = 1500): void {
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    noteTimer = null;
    showNote();
  }, delay);
}

function showNote(): void {
  if (state.phase !== 'ready' || !state.available || str(PREF.notified) === state.available) return;
  let fn: ((s: UpdateState) => boolean) | undefined;
  try {
    fn = notes.get(Services.wm.getMostRecentWindow('navigator:browser'));
  } catch {
    /* no window */
  }
  fn ??= [...notes.values()][0];
  if (!fn) return;
  let shown = false;
  try {
    shown = fn(state);
  } catch (e) {
    console.error('Deer updater: the note failed', e);
  }
  if (!shown) return;
  try {
    Services.prefs.setStringPref(PREF.notified, state.available);
    Services.prefs.savePrefFile(null);
  } catch {
    /* shown again next time: not fatal */
  }
}

// ---- apply ----

/** Ask to quit as Firefox's restart does. False when an observer (the downloads module) refused. */
function askToQuit(): boolean {
  const cancel = Cc['@mozilla.org/supports-PRBool;1'].createInstance(Ci.nsISupportsPRBool);
  asking = true;
  try {
    Services.obs.notifyObservers(cancel, 'quit-application-requested', 'restart');
  } finally {
    asking = false;
  }
  return !cancel.data;
}

function keepSession(on: boolean): void {
  try {
    // The next start restores the session (SessionStartup.isAutomaticRestoreEnabled).
    Services.prefs.setBoolPref('browser.sessionstore.resume_session_once', on);
    Services.prefs.savePrefFile(null);
  } catch (e) {
    console.error('Deer updater: could not keep the session', e);
  }
}

function quitNow(p: Pending): void {
  armed = p;
  held = null;
  set({ phase: 'restarting', lastAttempt: '' });
  keepSession(true);
  const allowed = Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  // A window that refused to close (a page's "leave this page?") stopped the quit: so is the update.
  // Nothing may start the setup on a later, ordinary quit. (A quit that goes ahead has notified
  // quit-application-granted, which sets `quitting`, before quit() returns.)
  if ((allowed === false || !quitting) && armed === p) {
    armed = null;
    keepSession(false);
    set({ phase: 'ready' });
  }
}

/** The staged file is still the one checked (async: before Deer quits for it). */
async function stillGood(p: Pending): Promise<boolean> {
  try {
    return (await sha256(p.exe)) === p.sha256;
  } catch {
    return false; // unreadable: damaged
  }
}

async function failDamaged(): Promise<void> {
  await sweep(updatesDir(), new Set());
  set({ phase: 'failed', error: DAMAGED, available: '' });
}

function newFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

/** The setup's arguments (installer/Setup.cs: /update implies silent; /launch starts Deer again). */
function setupArgs(p: { installDir: string; log: string; sha256: string }): string[] {
  return ['/update', `/installdir:${p.installDir}`, `/wait:${WAIT}`, '/launch', `/log:${p.log}`, `/sha256:${p.sha256}`];
}

/**
 * Start the setup (or, in a test, the test command) detached. Runs at quit-application. The file is
 * held (holdFile) from before its last hash until the process has started, so what starts is what
 * was hashed; a file that changed is not started and is removed.
 */
function launch(p: Pending): void {
  const args = setupArgs(p);
  const record: { program: string; args: string[]; setup: string; setupArgs: string[]; started: boolean; refused: string } = { program: p.exe, args, setup: p.exe, setupArgs: args, started: false, refused: '' };
  VitreUpdater.lastLaunch = record;
  let program = p.exe;
  let argv = args;
  let hidden = false;
  if (VitreUpdater.testInstallDir !== null) {
    const cmd = testCommand();
    record.program = cmd?.[0] ?? '';
    record.args = cmd ? [...cmd.slice(1), p.exe, ...args] : [];
    if (!cmd) return; // a test without a test command: nothing is started, ever
    program = cmd[0];
    argv = record.args;
    hidden = true;
  }
  const hold = holdFile(p.exe);
  if (!hold) {
    record.refused = 'the setup could not be held (it is open for writing, or gone)';
    console.error('Deer updater: ' + record.refused + '; not started');
    return;
  }
  try {
    let sum = '';
    try {
      sum = sha256Now(p.exe);
    } catch {
      /* unreadable: changed */
    }
    if (sum !== p.sha256) {
      record.refused = 'the setup changed after Deer checked it';
      console.error('Deer updater: ' + record.refused + '; not started');
      return;
    }
    try {
      const proc = Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess);
      proc.init(newFile(program));
      proc.startHidden = hidden;
      proc.runw(false, argv, argv.length);
      record.started = true;
    } catch (e) {
      console.error('Deer updater: could not start the setup', e);
    }
  } finally {
    hold.close();
    if (record.refused) {
      try {
        newFile(p.exe).remove(false);
      } catch {
        /* removed at the next start (it no longer matches anything) or the next check */
      }
    }
  }
}

export const VitreUpdater = {
  /** Tests: a folder with deer-version.json and install.ini that stands in for the install (then reload()). */
  testInstallDir: null as string | null,
  /** What the last apply started, or would have started (tests and diagnostics); `refused` says why not. */
  lastLaunch: null as { program: string; args: string[]; setup: string; setupArgs: string[]; started: boolean; refused: string } | null,

  /** The pure rules, for tests. */
  compareVersions,
  parseVersion,
  sumFor,
  /** Seconds setup waits for Deer to close. */
  WAIT,

  init(): void {
    if (inited) return;
    inited = true;
    startedAt = Date.now();
    const d = Services.prefs.getDefaultBranch('');
    d.setBoolPref(PREF.auto, true);
    d.setStringPref(PREF.repo, REPO);
    d.setStringPref(PREF.apiBase, API);
    d.setIntPref(PREF.firstDelay, FIRST_DELAY);
    Services.prefs.addObserver(PREF.auto, VitreUpdater);
    Services.obs.addObserver(VitreUpdater, 'quit-application-requested');
    Services.obs.addObserver(VitreUpdater, 'quit-application-granted');
    Services.obs.addObserver(VitreUpdater, 'quit-application');
    void VitreUpdater.reload();
  },

  /** Read the install again (testInstallDir, a changed pref), tidy the folder and reschedule. */
  reload(): Promise<void> {
    const p = (async () => {
      if (running) await running;
      const i = await readInstall();
      install = i;
      const on = enabled(i);
      set({ version: i.version, release: on, offReason: offReason(i), machine: i.machine, auto: autoOn(), lastCheck: lastCheckMs(), error: '', received: 0, total: 0 });
      if (!on) {
        set({ phase: 'off', available: '', lastAttempt: '' });
      } else {
        await tidy(i);
      }
      reschedule();
    })();
    loading = p.catch((e) => console.error('Deer updater: could not read the install', e));
    return loading;
  },

  /** Resolves once init() (or the last reload()) has read the install. */
  whenLoaded(): Promise<void> {
    return loading ?? Promise.resolve();
  },

  state(): UpdateState {
    return state;
  },

  onChange(fn: (s: UpdateState) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Ask GitHub now (does nothing in phase 'off'). One check at a time; never rejects. */
  check(_opts: { manual?: boolean } = {}): Promise<void> {
    if (running) return running;
    const p = runCheck()
      .catch((e) => console.error('Deer updater: check failed', e))
      .finally(() => {
        if (running === p) running = null;
        reschedule();
      });
    running = p;
    return p;
  },

  /** The person clicked "Restart to update". True when Deer is now quitting to install it. */
  async restartToUpdate(): Promise<boolean> {
    const i = install;
    if (state.phase !== 'ready' || !enabled(i) || quitting) return false;
    const version = state.available;
    set({ phase: 'restarting' });
    held = null;
    const staged = await findStaged(i);
    let sum = '';
    try {
      if (staged && staged.version === version) sum = await sha256(staged.path);
    } catch {
      /* unreadable: damaged */
    }
    if (!staged || staged.version !== version || sum !== staged.sha256) {
      if (staged) await sweep(updatesDir(), new Set());
      set({ phase: 'failed', error: DAMAGED, available: '' });
      return false;
    }
    const p: Pending = { exe: staged.path, sha256: sum, installDir: i.dir, log: PathUtils.join(updatesDir(), SETUP_LOG), version };
    try {
      // Fails now rather than at quit: the program must be there and startable.
      Cc['@mozilla.org/process/util;1'].createInstance(Ci.nsIProcess).init(newFile(VitreUpdater.testInstallDir !== null ? (testCommand()?.[0] ?? p.exe) : p.exe));
    } catch (e) {
      console.error('Deer updater: the setup cannot be started', e);
      set({ phase: 'failed', error: 'Deer couldn’t start its setup; check for updates to download it again.', available: '' });
      return false;
    }
    if (!askToQuit()) {
      // Held back (the downloads module asks the person first; its "Restart" calls proceedRestart).
      held = p;
      set({ phase: 'ready' });
      return false;
    }
    quitNow(p);
    return quitting;
  },

  /**
   * The downloads quit prompt's "Restart": true when it was this update's restart (the one the prompt
   * held back, with nothing else asked for since). Deer then quits for it once the staged file
   * checked out again; a file that changed meanwhile is dropped (failed, DAMAGED) and Deer stays.
   */
  proceedRestart(): boolean {
    const p = held;
    held = null;
    if (!p || state.phase !== 'ready' || state.available !== p.version || quitting) return false;
    set({ phase: 'restarting' });
    void (async () => {
      if (await stillGood(p)) quitNow(p);
      else await failDamaged();
    })();
    return true;
  },

  setAuto(on: boolean): void {
    Services.prefs.setBoolPref(PREF.auto, !!on);
    try {
      Services.prefs.savePrefFile(null);
    } catch {
      /* written later */
    }
  },

  /** A window's note; returns the unregister. The note is offered once the window has settled. */
  setNote(win: any, fn: ((s: UpdateState) => boolean) | null): () => void {
    if (!fn) {
      notes.delete(win);
      return () => undefined;
    }
    notes.set(win, fn);
    if (state.phase === 'ready') noteSoon(3000);
    return () => {
      if (notes.get(win) === fn) notes.delete(win);
    };
  },

  /** %LOCALAPPDATA%\Deer\updates (vitre.localAppData stands in for %LOCALAPPDATA%). */
  updatesDir,

  /** The hold launch() takes on the setup (tests check that it keeps the file from changing). */
  hold: holdFile,

  /** The arguments the setup gets (tests check them). */
  setupArgs(installDir: string, log: string, sha: string): string[] {
    return setupArgs({ installDir, log, sha256: sha });
  },

  observe(_subject: unknown, topic: string, data: string): void {
    if (topic === 'nsPref:changed') {
      set({ auto: autoOn() });
      reschedule();
    } else if (topic === 'quit-application-requested') {
      // Someone else asks to quit or restart: a restart the downloads prompt held back for this
      // update is no longer what that prompt's "Restart" means.
      if (!asking) held = null;
    } else if (topic === 'quit-application-granted') {
      quitting = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      timer = null;
    } else if (topic === 'quit-application') {
      quitting = true;
      const p = armed;
      armed = null;
      // An in-place restart (data "restart") brings this Deer back at once: setup would only wait.
      if (p && data !== 'restart') launch(p);
    }
  },

  QueryInterface: ChromeUtils.generateQI(['nsIObserver']),
};
