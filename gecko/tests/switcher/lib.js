// Helpers for the switcher tests. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.S. Keys are synthesized in-process through EventUtils (nsITextInputProcessor): they
// take the real widget -> chrome -> content path and need no OS focus (focusmanager.testmode).
// Holding Ctrl: S.down("Control") ... S.up("Control"); EventUtils' ctrlKey option alone sends no
// Control key events, so a held Ctrl is always an explicit keydown / keyup.
/* global spike, Services, Ci, gBrowser */
window.S = (() => {
  const { sleep, waitFor, log, check } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  const sw = () => window.vitreSwitcher;

  const NAMED = {
    Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete",
    Backspace: "KEY_Backspace", Home: "KEY_Home", End: "KEY_End", Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight",
    Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Control: "KEY_Control", Shift: "KEY_Shift", Alt: "KEY_Alt", F5: "KEY_F5",
  };
  function parse(spec) {
    const parts = spec.split("+");
    let key = parts.pop();
    const opts = {};
    for (const m of parts) {
      if (m === "Ctrl") opts.ctrlKey = true;
      else if (m === "Shift") opts.shiftKey = true;
      else if (m === "Alt") opts.altKey = true;
      else throw new Error("bad modifier " + m);
    }
    if (NAMED[key]) key = NAMED[key];
    else if (/^[A-Za-z]$/.test(key)) key = opts.shiftKey ? key.toUpperCase() : key.toLowerCase();
    return { key, opts };
  }
  /** keydown (+keypress) + keyup of one chord; with Control held (down()), it carries ctrlKey. */
  function press(spec, extra = {}) {
    const { key, opts } = parse(spec);
    EU.synthesizeKey(key, Object.assign(opts, extra), window);
  }
  const down = (spec, extra = {}) => press(spec, { ...extra, type: "keydown" });
  const up = (spec, extra = {}) => press(spec, { ...extra, type: "keyup" });

  const state = () => sw().state();
  const titleOf = (id) => {
    const t = b.tab(id);
    return t ? (t.kind === "home" ? "Home" : t.title || t.url) : "?";
  };
  const selected = () => titleOf(state().selected);
  const active = () => titleOf(b.activeId);

  /** Load a URL in a tab and wait until it stopped (or the timeout). */
  async function loaded(tab, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const br = tab.browser;
      if (!tab.loading && br && br.currentURI && br.currentURI.spec !== "about:blank" && !br.webProgress?.isLoadingDocument) return true;
      await sleep(100);
    }
    return false;
  }

  /** Open `urls` as background tabs (the first one replaces the start tab), a few at a time, and wait for them. */
  async function openTabs(urls, { batch = 6 } = {}) {
    const first = b.active();
    b.navigate(first, urls[0]);
    const tabs = [first];
    for (let i = 1; i < urls.length; i += batch) {
      const group = urls.slice(i, i + batch).map((u) => b.newTab(u, { background: true }));
      tabs.push(...group);
      await Promise.all(group.map((t) => loaded(t)));
    }
    await loaded(first);
    await sleep(600);
    return tabs.filter(Boolean);
  }

  /** Visit tabs in this order (gives a known MRU). */
  async function visit(tabs) {
    for (const t of tabs) {
      b.activate(t);
      await sleep(120);
    }
    await sleep(400);
  }

  /** Ctrl down, Tab: the held switcher opens (after the quick-tap window). Ctrl stays down. */
  async function holdOpen(steps = 1, back = false) {
    b.focusPage();
    await sleep(100);
    down("Control");
    await sleep(30);
    for (let i = 0; i < steps; i++) {
      press(back ? "Shift+Tab" : "Tab");
      await sleep(40);
    }
    await waitFor(() => state().phase === "open", { timeout: 3000, what: "switcher open" });
  }

  /** Wait until the opening motion is over and every card on screen shows its picture. */
  async function settled(ms = 900) {
    await sleep(ms);
  }

  /** Let go of Ctrl and wait until the switcher is gone. */
  async function release() {
    up("Control");
    await waitFor(() => state().phase === "idle", { timeout: 3000, what: "switcher closed" });
    await sleep(150);
  }

  const setStyle = async (style) => {
    b.sys("VitreSettings").set({ switcherStyle: style });
    await sleep(150);
  };

  /** Cards in the switcher's DOM. */
  const cards = () => [...document.querySelectorAll("#layer-switcher .sw-dcard:not(.sw-gone), #layer-switcher .sw-gcard, #layer-switcher .sw-scard")];
  /** Painted (non-placeholder) media among the cards on screen. */
  function painted() {
    const vis = [...document.querySelectorAll("#layer-switcher .sw-media")].filter((m) => {
      const r = m.getBoundingClientRect();
      const card = m.closest(".sw-dcard, .sw-gcard, .sw-scard");
      const op = card ? parseFloat(getComputedStyle(card).opacity) : 1;
      return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight && op > 0.05;
    });
    return { onScreen: vis.length, painted: vis.filter((m) => !m.classList.contains("none")).length };
  }

  return { b, EU, sw, parse, press, down, up, state, titleOf, selected, active, loaded, openTabs, visit, holdOpen, settled, release, setStyle, cards, painted, sleep, waitFor, log, check };
})();

/** Real pages for the 3 / 12 / 40-tab captures (plain HTTP fetches are fine in tests). */
window.REAL_PAGES = [
  "https://en.wikipedia.org/wiki/Float_glass",
  "https://www.mozilla.org/en-US/",
  "https://en.wikipedia.org/wiki/Glass",
  "https://developer.mozilla.org/en-US/",
  "https://example.com/",
  "https://www.python.org/",
  "https://en.wikipedia.org/wiki/Lake",
  "https://www.rust-lang.org/",
  "https://news.ycombinator.com/",
  "https://en.wikipedia.org/wiki/Long-exposure_photography",
  "https://www.w3.org/",
  "https://en.wikipedia.org/wiki/Refraction",
  "https://www.gnu.org/",
  "https://en.wikipedia.org/wiki/Tide",
  "https://nodejs.org/en",
  "https://en.wikipedia.org/wiki/Gecko_(software)",
  "https://www.kernel.org/",
  "https://en.wikipedia.org/wiki/Stained_glass",
  "https://en.wikipedia.org/wiki/Optics",
  "https://www.typescriptlang.org/",
  "https://en.wikipedia.org/wiki/Window",
  "https://en.wikipedia.org/wiki/Lens",
  "https://go.dev/",
  "https://en.wikipedia.org/wiki/Mountain",
  "https://www.debian.org/",
  "https://en.wikipedia.org/wiki/Ocean",
  "https://en.wikipedia.org/wiki/Typography",
  "https://www.apache.org/",
  "https://en.wikipedia.org/wiki/Architecture",
  "https://en.wikipedia.org/wiki/Prism",
  "https://www.postgresql.org/",
  "https://en.wikipedia.org/wiki/Aurora",
  "https://en.wikipedia.org/wiki/Sand",
  "https://en.wikipedia.org/wiki/Tin",
  "https://www.sqlite.org/",
  "https://en.wikipedia.org/wiki/Mirror",
  "https://en.wikipedia.org/wiki/Liquid",
  "https://en.wikipedia.org/wiki/Photography",
  "https://www.ietf.org/",
  "https://en.wikipedia.org/wiki/Firefox",
];
