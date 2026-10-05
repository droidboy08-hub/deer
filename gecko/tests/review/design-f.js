// Design-fidelity review, probe F: the bar mid-motion (tab switch, new tab, close), the address
// field closing, scrollbars, and Home with the real Windows wallpaper.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const R = (el) => { const r = el.getBoundingClientRect(); return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)]; };
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async (win = window) => { await waitFor(() => win.vitre.bar.state.settled, { timeout: 9000, what: "settle" }); await sleep(150); };
  const inner = async (w, h, win = window) => {
    win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight));
    win.moveTo(30, 30);
    await sleep(600);
  };
  const go = async (url, t = b.active()) => {
    b.navigate(t, url);
    await waitFor(() => t.url.startsWith(url.slice(0, 24)) && !t.loading, { timeout: 30000, what: "load " + url });
    await sleep(700);
    await settled();
  };
  const itemsState = () => [...document.querySelectorAll("#vitre-bar .item")].sort((a, c) => a.getBoundingClientRect().left - c.getBoundingClientRect().left).map((it) => ({ cls: it.className.replace("item ", "").replace(" glass", ""), rect: R(it).map(Math.round).join("/"), op: +(+cs(it).opacity).toFixed(2), lens: cs(it.querySelector(":scope > .lens")).backdropFilter.slice(0, 26) }));

  await inner(1440, 900);
  await spike.activate();
  await go(site("fieldnotes", "/article"));
  const first = b.active();
  for (const u of [site("tideline", "/tideline"), site("refract", "/refract"), site("code", "/shell")]) b.newTab(u, { background: true, index: b.tabs.length });
  await waitFor(() => b.tabs.length === 4 && b.tabs.every((t) => !t.loading), { timeout: 30000, what: "tabs" });
  await sleep(1000);
  await settled();

  // scrollbars: overlay or classic?
  const info = await SpecialPowersLess();
  async function SpecialPowersLess() {
    const br = first.browser;
    let content = null;
    try {
      content = await b.page(first).query("core:scroll");
    } catch (e) {
      content = "ERR " + e;
    }
    return { overlayMedia: window.matchMedia("(-moz-overlay-scrollbars)").matches, pref: (() => { try { return Services.prefs.getBoolPref("widget.windows.overlay-scrollbars.enabled"); } catch { return "n/a"; } })(), browserWidth: Math.round(br.getBoundingClientRect().width), content };
  }
  dump("scrollbars", info);

  // slow everything down 8x so a capture lands mid-motion
  const slow = document.createElement("style");
  slow.textContent = "#vitre-bar .item { transition-duration: 3.36s, 3.36s, 3.36s, 3.36s, 1.6s, 2.56s !important; } #vitre-bar .item .pill-face, #vitre-bar .item .circle-face { transition-duration: 1.28s !important; } #vitre-bar .item.active .pill-face { transition-delay: 0.96s !important; }";
  document.documentElement.append(slow);
  b.bar.settleDelay = 3520;

  // 1. switch tabs: pill <-> circle
  b.activate(b.tabs[2]);
  await sleep(1100); // about 1/3 through
  dump("switch-mid", itemsState());
  await spike.capture("f1-switch-mid");
  await sleep(1300);
  dump("switch-late", itemsState());
  await spike.capture("f2-switch-late");
  await settled();
  await spike.capture("f3-switch-done");

  // 2. new tab enters
  const nt = b.newTab(site("longexposure", "/club"), { background: true });
  await sleep(800);
  dump("enter-mid", itemsState());
  await spike.capture("f4-enter-mid");
  await settled();

  // 3. close a background tab
  b.closeTab(nt);
  await sleep(500);
  dump("leave-mid", itemsState());
  await spike.capture("f5-leave-mid");
  await settled();
  slow.remove();
  b.bar.settleDelay = 440;

  // 4. address field closing: what shows in the frames after Esc
  b.activate(first);
  await sleep(900);
  await settled();
  b.editAddress();
  await sleep(600);
  const slow2 = document.createElement("style");
  slow2.textContent = "#vitre-bar .item { transition-duration: 3.36s, 3.36s, 3.36s, 3.36s, 1.6s, 2.56s !important; }";
  document.documentElement.append(slow2);
  b.omni.close();
  await sleep(500);
  dump("omni-closing", { items: itemsState(), row: [...document.querySelectorAll("#vitre-bar .row-lens")].map((r) => cs(r).visibility + " " + cs(r).backdropFilter.slice(0, 20)), field: document.getElementById("vitre-omni-field").hidden });
  await spike.capture("f6-omni-closing");
  slow2.remove();
  await sleep(600);

  // 5. Home with the Windows wallpaper (the default)
  const home = b.newTab(undefined, {});
  await waitFor(() => b.active().kind === "home" && b.active().browser.contentDocument?.documentElement.dataset.state, { timeout: 15000, what: "home" });
  await sleep(1500);
  if (b.omni.open) b.omni.close();
  await sleep(800);
  await settled();
  dump("home-windows", { data: { ...b.active().browser.contentDocument.documentElement.dataset }, theme: b.theme() });
  await spike.capture("f7-home-windows");
});
