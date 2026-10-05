// Spike 4: the pill + circles + plus bar, driven only by gBrowser, over real pages.
// Captures 1, 3 and 12 tabs at 1280x800 and 900x700, and logs the tab event stream.
//   python tools/run.py --boot spikes/shell/boot-tabs.js --name shell-tabs --timeout 240
/* global spike, vt, Services, gBrowser, VitreUI, BrowserCommands */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const bar = VitreUI.bar;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const SITES = [
      "https://en.wikipedia.org/wiki/Glass",
      "https://example.com/",
      "https://www.mozilla.org/en-US/",
      "https://developer.mozilla.org/en-US/",
      "https://news.ycombinator.com/",
      "https://duckduckgo.com/",
      "https://github.com/mozilla",
      "https://www.w3.org/",
      "https://www.python.org/",
      "https://www.rust-lang.org/",
      "https://nodejs.org/en",
      "https://www.sqlite.org/index.html",
    ];
    const shots = async (name) => {
      await spike.resize(1280, 800);
      await spike.sleep(700);
      spike.log(name, "1280x800", vt.barState().layout);
      await spike.capture(`tabs-${name}-1280`);
      await spike.resize(900, 700);
      await spike.sleep(700);
      spike.log(name, "900x700", vt.barState().layout, "winctl", vt.rect(document.getElementById("vitre-winctl")));
      await spike.capture(`tabs-${name}-900`);
      await spike.resize(1280, 800);
      await spike.sleep(300);
    };
    const drain = (label) => {
      spike.log(`events [${label}]`, bar.events.join(" "));
      bar.events.length = 0;
    };

    // ---- 1 tab: a load, watched through the bar (busy state, progress, title, favicon)
    bar.events.length = 0;
    const first = gBrowser.selectedTab;
    const seen = [];
    const item0 = () => bar.items.get(first);
    const watch = setInterval(() => {
      const i = item0();
      const s = `${i.classList.contains("loading") ? "loading" : "idle"}|${i.style.getPropertyValue("--progress")}|${i.querySelector(".host").textContent}|${(i.querySelector(".circle-face .fav").dataset.src || "").slice(0, 22)}`;
      if (seen[seen.length - 1] !== s) seen.push(s);
    }, 15);
    gBrowser.selectedBrowser.fixupAndLoadURIString(SITES[0], { triggeringPrincipal: sys });
    await vt.tabLoaded(first);
    await vt.until(() => first.getAttribute("image"), 6000);
    clearInterval(watch);
    spike.log("load as seen by the bar (state|progress|host|favicon)", seen);
    drain("1 tab: navigate + load");
    spike.log("1 tab", vt.barState().items);
    await shots("1");

    // ---- 3 tabs
    const t2 = await vt.openTab(SITES[1], { select: false });
    drain("open background tab");
    const t3 = await vt.openTab(SITES[2], { select: false });
    await vt.until(() => t3.getAttribute("image"), 6000);
    bar.events.length = 0;
    spike.log("3 tabs", vt.barState().items.map((i) => `${i.active ? "*" : ""}${i.title} [${i.host}] icon=${i.icon}`));
    await shots("3");

    // select through the bar, by clicking the third circle
    await vt.click(...vt.center(bar.items.get(t3)), { wait: 700 });
    drain("click circle of tab 3 (select)");
    spike.log("selected index", gBrowser.tabs.indexOf(gBrowser.selectedTab), "| pill host", vt.barState().items.find((i) => i.active).host);
    await spike.capture("tabs-3-third-selected-1280");
    // move
    gBrowser.moveTabTo(t3, { tabIndex: 0 });
    await spike.sleep(600);
    drain("moveTabTo(tab3, 0)");
    spike.log("order after move", vt.barState().items.map((i) => i.host), "| DOM order matches gBrowser:", gBrowser.tabs.map((t) => bar.items.get(t).querySelector(".host").textContent).join(","));
    gBrowser.moveTabTo(t3, { tabIndex: 2 });
    gBrowser.selectedTab = first;
    await spike.sleep(500);
    bar.events.length = 0;

    // ---- 12 tabs
    const more = [];
    for (const url of SITES.slice(3)) more.push(gBrowser.addTrustedTab(url));
    await Promise.all(more.map((t) => vt.tabLoaded(t, 30000)));
    await spike.sleep(2500);
    drain("open 9 more tabs");
    spike.log("12 tabs", vt.barState().items.map((i) => `${i.active ? "*" : ""}${i.host} icon=${i.icon}`));
    await shots("12");

    // 12 tabs with a middle tab active
    gBrowser.selectedTab = gBrowser.tabs[6];
    await spike.sleep(900);
    await shots("12-mid");

    // ---- close: through the bar's close badge and through Firefox's own command
    const victim = gBrowser.tabs[11];
    await vt.move(...vt.center(bar.items.get(victim)));
    await vt.click(...vt.center(bar.items.get(victim).querySelector(".close-badge")), { wait: 600 });
    drain("close badge on last tab");
    BrowserCommands.closeTabOrWindow();
    await spike.sleep(600);
    drain("BrowserCommands.closeTabOrWindow() (Ctrl+W path) on the active tab");
    spike.log("after closes", { tabs: gBrowser.tabs.length, items: bar.items.size, selected: gBrowser.tabs.indexOf(gBrowser.selectedTab) });

    // ---- new tab through the plus circle
    await vt.click(...vt.center(bar.plus), { wait: 900 });
    drain("click plus");
    spike.log("new tab", { tabs: gBrowser.tabs.length, uri: gBrowser.currentURI.spec, pill: vt.barState().items.find((i) => i.active) });
    await spike.capture("tabs-new-tab-1280");

    // ---- pinned, hidden (tab.hidden via gBrowser.hideTab), discarded tabs
    gBrowser.selectedTab = gBrowser.tabs[0];
    gBrowser.pinTab(gBrowser.tabs[3]);
    await spike.sleep(300);
    drain("pinTab(tabs[3])");
    spike.log("pinned -> order", vt.barState().items.map((i) => i.host).slice(0, 4), "pinned index", gBrowser.tabs.findIndex((t) => t.pinned));
    gBrowser.hideTab(gBrowser.tabs[5]);
    await spike.sleep(300);
    drain("hideTab(tabs[5])");
    spike.log("hidden -> gBrowser.tabs", gBrowser.tabs.length, "visibleTabs", gBrowser.visibleTabs.length, "bar items", bar.items.size);
    gBrowser.discardBrowser(gBrowser.tabs[6], true);
    await spike.sleep(300);
    drain("discardBrowser(tabs[6])");
    const di = bar.items.get(gBrowser.tabs[6]);
    spike.log("discarded tab item", { pending: di.classList.contains("pending"), host: di.querySelector(".host").textContent, title: di.querySelector(".circle-face").title });
    await spike.capture("tabs-final-1280");
  });
}
