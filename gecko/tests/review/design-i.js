// Design-fidelity review, probe I: what the pill shows while a new tab's first page is still on
// its way (2.5 s server delay), and while an existing tab navigates.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const port = Services.env.get("VITRE_TEST_PORT");
  const site = (host, path) => `http://${host}.localhost:${port}${path}`;
  const cs = (el) => window.getComputedStyle(el);
  const dump = (name, obj) => log("DUMP " + name + " " + JSON.stringify(obj));
  const settled = async (win = window) => { await waitFor(() => win.vitre.bar.state.settled, { timeout: 9000, what: "settle" }); await sleep(150); };
  const inner = async (w, h, win = window) => {
    win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight));
    win.moveTo(30, 30);
    await sleep(600);
  };
  const pillState = () => {
    const pill = document.querySelector("#vitre-bar .item.active");
    const t = b.active();
    return { cls: pill.className, text: pill.querySelector(".host").textContent, placeholder: pill.querySelector(".address").classList.contains("placeholder"), nav: [...pill.querySelectorAll(".back,.forward,.reload")].map((n) => cs(n).visibility).join(","), reload: pill.querySelector(".reload").getAttribute("aria-label"), line: cs(pill.querySelector(".load-line")).opacity, tab: { url: t.url, kind: t.kind, loading: t.loading, title: t.title }, theme: b.theme(), omni: b.omni.open };
  };
  await inner(1440, 900);
  await spike.activate();
  b.navigate(b.active(), site("code", "/dark"));
  await sleep(2500);
  await settled();

  // a new foreground tab on a slow address (what a link opened in a new tab does)
  const t = b.newTab(site("fieldnotes", "/slow"));
  await sleep(700);
  dump("newtab-loading-700ms", pillState());
  await spike.capture("i1-newtab-loading");
  await sleep(900);
  dump("newtab-loading-1900ms", pillState());
  await waitFor(() => !t.loading && t.url.includes("/slow"), { timeout: 15000, what: "slow page" });
  await sleep(600);
  dump("newtab-loaded", pillState());

  // an existing tab navigating to a slow address
  b.navigate(t, site("tideline", "/slow"));
  await sleep(900);
  dump("navigate-loading-900ms", pillState());
  await spike.capture("i2-navigate-loading");
  await waitFor(() => !t.loading, { timeout: 15000, what: "slow page 2" });
  await sleep(500);
  dump("navigate-loaded", pillState());
});
