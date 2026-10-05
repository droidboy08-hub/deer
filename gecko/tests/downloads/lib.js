// Helpers shared by the downloader tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.DL. The runner (tests/downloads/all.py) starts the local server and passes
//   VITRE_DL_PORT (server port), VITRE_DL_FIX (fixtures folder), VITRE_DL_DIR (this run's downloads
//   folder, also set as vitre.downloadsFolder).
// Input is synthesized in-process only (EventUtils, Window.synthesizeMouseEvent from a frame script
// for trusted clicks in pages: spikes/downloader/RESULT.md gotcha 8). Never OS input.
/* global spike, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, gBrowser */
window.DL = (() => {
  const port = Services.env.get("VITRE_DL_PORT");
  const base = `http://127.0.0.1:${port}`;
  const fix = Services.env.get("VITRE_DL_FIX");
  const dir = Services.env.get("VITRE_DL_DIR");
  const b = window.vitre;
  const engine = b.sys("VitreDownloads");
  const { sleep, waitFor } = spike;
  let manifest = null;

  const api = {
    base,
    fix,
    dir,
    b,
    engine,
    get manifest() {
      return manifest;
    },
    async init() {
      manifest = JSON.parse(await IOUtils.readUTF8(PathUtils.join(fix, "manifest.json")));
      await engine.ready;
      return manifest;
    },
    async stats() {
      return (await fetch(base + "/stats", { cache: "no-store" })).json();
    },
    async reset() {
      await fetch(base + "/reset", { cache: "no-store" });
    },
    /** Load a URL in the active tab and wait for it. */
    async open(url, { settle = 400 } = {}) {
      const t = b.active();
      b.navigate(t.id, url);
      await waitFor(() => t.url === url && !t.loading && t.browser.currentURI.spec === url, { timeout: 20000, what: "load of " + url });
      await sleep(settle);
      return t;
    },
    view(id) {
      return engine.get(id);
    },
    /** Wait until the download reaches one of the states (and `test`, if given). */
    async until(id, states, { timeout = 60000, test = null, what = "" } = {}) {
      return waitFor(
        () => {
          const v = engine.get(id);
          return v && states.includes(v.state) && (!test || test(v)) ? v : null;
        },
        { timeout, interval: 100, what: what || `download ${id} to be ${states.join("/")}` }
      );
    },
    async sha256(path) {
      return IOUtils.computeHexDigest(path, "sha256");
    },
    /** A trusted click on an element of the active page (Window.synthesizeMouseEvent from a frame script). */
    clickInPage(selector, { altKey = false, browser = gBrowser.selectedBrowser } = {}) {
      return api.frameScript(browser, (sel, alt) => {
        const el = content.document.querySelector(sel);
        if (!el) return { found: false };
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const x = r.left + Math.min(20, r.width / 2);
        const y = r.top + r.height / 2;
        let trusted = null;
        el.addEventListener("click", (e) => (trusted = e.isTrusted), { once: true });
        const mods = alt ? Ci.nsIDOMWindowUtils.MODIFIER_ALT : 0;
        for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, x, y, { button: 0, clickCount: 1, modifiers: mods }, {});
        return { found: true, trusted, x, y };
      }, [selector, altKey]);
    },
    /**
     * Run fn(...args) in the page's content process (a frame script) and resolve with what it
     * returns (or { error } when it throws). Times out after 10 s.
     */
    frameScript(browser, fn, args = []) {
      return new Promise((resolve) => {
        const mm = browser.messageManager;
        const name = "vitre-dl-test-" + Date.now() + "-" + Math.round(Math.random() * 1e9);
        const timer = setTimeout(() => resolve({ error: "frame script timed out" }), 10000);
        mm.addMessageListener(name, function on(m) {
          mm.removeMessageListener(name, on);
          clearTimeout(timer);
          resolve(m.data);
        });
        const body = `(() => { let out; try { out = (${fn.toString()})(...${JSON.stringify(args)}); } catch (e) { out = { error: String(e) }; } sendAsyncMessage(${JSON.stringify(name)}, out); })()`;
        mm.loadFrameScript("data:application/javascript," + encodeURIComponent(body), false);
      });
    },
    /** Move the pointer over a page element (a trusted pointermove in the page). */
    hoverInPage(selector, { dx = 0.5, dy = 0.5, browser = gBrowser.selectedBrowser } = {}) {
      return api.frameScript(browser, (sel, fx, fy) => {
        const el = content.document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        content.synthesizeMouseEvent("mousemove", x, y, {}, {});
        return { x, y, rect: [r.left, r.top, r.width, r.height] };
      }, [selector, dx, dy]);
    },
    /** Run a console program; stdout, stderr and the exit code. */
    async tool(command, args) {
      const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
      const proc = await Subprocess.call({ command, arguments: args, stderr: "pipe" });
      let stdout = "";
      let stderr = "";
      const read = async (pipe, add) => {
        for (;;) {
          const chunk = await pipe.readString();
          if (!chunk) return;
          add(chunk);
        }
      };
      await Promise.all([read(proc.stdout, (c) => (stdout += c)), read(proc.stderr, (c) => (stderr += c))]);
      const { exitCode } = await proc.wait();
      return { exitCode, stdout, stderr };
    },
    /** The streams of a media file, through ffprobe: [{codec_type, codec_name}], and its duration. */
    async probe(path) {
      if (!manifest.ffprobe) return null;
      const r = await api.tool(manifest.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration,format_name", "-of", "json", path]);
      try {
        return JSON.parse(r.stdout);
      } catch {
        return { error: r.stderr };
      }
    },
    /** The Zone.Identifier stream Windows reads (Mark of the Web). */
    async motw(path) {
      const comspec = Services.env.get("ComSpec") || "C:\\Windows\\System32\\cmd.exe";
      const r = await api.tool(comspec, ["/c", `more < "${path}:Zone.Identifier"`]);
      return r.stdout.trim();
    },
    /** Files in the downloads folder. */
    async files() {
      try {
        return (await IOUtils.getChildren(dir)).map((p) => PathUtils.filename(p)).sort();
      } catch {
        return [];
      }
    },
    /** Every running and finished download gone from the list (between steps). */
    async clean() {
      for (const v of engine.list()) engine.remove(v.id);
      await sleep(100);
    },
    ui() {
      return window.vitreDownloads;
    },
  };
  return api;
})();
