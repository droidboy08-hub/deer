// Shared by the updater tests (tests/update/*.js):
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);  ->  window.U
// The local GitHub stand-in is tests/update/release_server.py (started by tests/update/all.py, which
// passes its address as UPTEST_BASE and an address where nothing listens as UPTEST_DOWN).
// The install the tests stand in is Deer 1.4.2, a folder inside the throwaway profile handed to
// VitreUpdater.testInstallDir; the updates folder is <profile>\LocalAppData\Deer\updates
// (run.py sets vitre.localAppData), so nothing outside the profile is read or written.
/* global spike, Services, ChromeUtils, IOUtils, PathUtils */
window.U = (() => {
  const { waitFor, sleep } = spike;
  const Up = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreUpdater.sys.mjs").VitreUpdater;
  const base = Services.env.get("UPTEST_BASE");
  const down = Services.env.get("UPTEST_DOWN");
  const INSTALLED = "1.4.2";

  const server = {
    async scenario(name) {
      const r = await fetch(`${base}/__scenario/${name}`, { cache: "no-store" });
      if (!r.ok) throw new Error("unknown scenario " + name);
    },
    async reset() {
      await fetch(`${base}/__reset`, { cache: "no-store" });
    },
    async log() {
      return (await fetch(`${base}/__log`, { cache: "no-store" })).json();
    },
  };

  /** A folder standing in for <install>: deer-version.json and install.ini as installer/build.py and Setup.cs write them. */
  async function fakeInstall({ version = INSTALLED, channel = "release", scope = "user", mode = "user", setup = "Deer-Setup.exe", versionFile = true, ini = true, name = "FakeInstall" } = {}) {
    const dir = PathUtils.join(PathUtils.profileDir, name);
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await IOUtils.makeDirectory(dir, { createAncestors: true });
    if (versionFile) {
      await IOUtils.writeJSON(PathUtils.join(dir, "deer-version.json"), {
        product: "Deer", version, build: "test", buildDate: "2026-10-01T10:00:00Z", channel,
        engineVersion: "157.0", engineBuildId: "test", platform: "win64", setup,
      });
    }
    if (ini) await IOUtils.writeUTF8(PathUtils.join(dir, "install.ini"), `; Written by Deer Setup. The uninstaller reads it: do not edit.\r\n[Deer]\r\nVersion=${version}\r\nBuild=test\r\nMode=${mode}\r\nScope=${scope}\r\n`);
    return dir;
  }

  /** Point the updater at the stand-in server and install (automatic checks off: the test drives them). */
  async function use(dir, { auto = false } = {}) {
    Services.prefs.setStringPref("vitre.update.apiBase", base);
    Services.prefs.setStringPref("vitre.update.repo", "test/deer");
    Services.prefs.setBoolPref("vitre.update.auto", auto);
    Up.testInstallDir = dir;
    await Up.reload();
  }

  const updates = () => Up.updatesDir();
  async function files() {
    try {
      return (await IOUtils.getChildren(updates())).map((p) => PathUtils.filename(p)).sort();
    } catch {
      return [];
    }
  }
  /** Empty the updates folder and read the install again. */
  async function clear() {
    await IOUtils.remove(updates(), { recursive: true, ignoreAbsent: true });
    await Up.reload();
  }
  async function size(name) {
    try {
      return (await IOUtils.stat(PathUtils.join(updates(), name))).size;
    } catch {
      return -1;
    }
  }
  async function sha256(path) {
    const bytes = await IOUtils.read(path);
    const d = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  /** A check against one scenario: resets the server log, returns { state, log }. */
  async function run(scenario) {
    await server.scenario(scenario);
    await server.reset();
    await Up.check({ manual: true });
    return { state: Up.state(), log: await server.log() };
  }
  const paths = (log) => log.map((r) => r.path + (r.headers.Range ? ` [${r.headers.Range}]` : ""));

  // ---- Settings › About ----
  const root = () => document.getElementById("vitre-settings");
  async function about() {
    const svc = await window.vitre.whenService("settings");
    if (!svc.isOpen() || root()?.querySelector(".vs-content")?.dataset.page !== "about") svc.open("about");
    await waitFor(() => root()?.querySelector(".vs-content")?.dataset.page === "about" && root().querySelector('[data-update="status"]'), { timeout: 8000, what: "Settings › About" });
    await sleep(350);
  }
  const statusRow = () => root()?.querySelector('[data-update="status"]');
  const status = () => statusRow()?.querySelector(".vs-desc")?.textContent ?? "";
  const button = () => statusRow()?.querySelector(".vs-btn");
  const autoRow = () => root()?.querySelector('[data-update="auto"]');
  const rowDesc = (title) => [...(root()?.querySelectorAll(".vs-row") ?? [])].find((r) => r.querySelector(".vs-title")?.textContent === title)?.querySelector(".vs-desc")?.textContent ?? null;
  /** Bring the Updates card into view for a capture. */
  async function showUpdates() {
    statusRow()?.scrollIntoView({ block: "center" });
    await sleep(250);
  }

  return { Up, base, down, INSTALLED, server, fakeInstall, use, updates, files, clear, size, sha256, run, paths, about, root, status, button, autoRow, rowDesc, showUpdates };
})();
