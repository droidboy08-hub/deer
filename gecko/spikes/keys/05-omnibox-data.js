// 05: omnibox data sources on Gecko: history + open tabs suggestions, removing a history entry,
// search engines and search URLs, URL fixup, loading in the current / a new tab.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-omnibox-data.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1100, 720);
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const section = async (name, fn) => {
    spike.log("--- " + name);
    try { await fn(); } catch (e) { spike.log("ERROR in " + name + ": " + e + "\n" + (e.stack || "")); }
  };

  await section("1. real navigation is recorded in Places", async () => {
    await KS.load("https://example.com/");
    await spike.sleep(1500);
    const e = await PlacesUtils.history.fetch("https://example.com/");
    spike.log("history.fetch(example.com) after a real load:", e ? { url: e.url.href, title: e.title, frecency: e.frecency } : null);
  });

  await section("2. seed history (PlacesUtils.history.insertMany)", async () => {
    const day = 86400000;
    const now = Date.now();
    const mk = (url, title, visits, ageDays) => ({ url, title, visits: Array.from({ length: visits }, (_, i) => ({ date: new Date(now - ageDays * day - i * 3600000), transition: i === 0 ? PlacesUtils.history.TRANSITIONS.TYPED : PlacesUtils.history.TRANSITIONS.LINK })) });
    await PlacesUtils.history.insertMany([
      mk("https://www.mozilla.org/en-US/firefox/", "Firefox - Protect your life online", 12, 1),
      mk("https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent", "KeyboardEvent - Web APIs | MDN", 6, 2),
      mk("https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/getModifierState", "KeyboardEvent: getModifierState() method | MDN", 2, 10),
      mk("https://github.com/mozilla/gecko-dev", "mozilla/gecko-dev: Read-only Git mirror", 4, 3),
      mk("https://news.ycombinator.com/", "Hacker News", 30, 0),
      mk("https://en.wikipedia.org/wiki/Liquid_glass", "Liquid glass - Wikipedia", 1, 40),
      mk("https://example.org/keyboard-shortcuts", "Keyboard shortcuts example", 3, 5),
    ]);
    spike.log("inserted 7 pages");
  });

  // Two more open tabs so "open tabs" has something to find.
  const t2 = gBrowser.addTrustedTab(KS.pageURL("keys.html", "tab=two"));
  const t3 = gBrowser.addTrustedTab("https://example.org/");
  await spike.sleep(2500);

  await section("3. suggestions A: Places SQL + gBrowser.tabs (VitreOmniboxData.suggest)", async () => {
    for (const q of ["key", "moz", "mdn key", "hacker", "exam", "", "zzzz", "KEYBOARDEVENT", "50%_x"]) {
      const t = performance.now();
      const rows = await VitreOmniboxData.suggest(q, { limit: 6 });
      spike.log(JSON.stringify(q) + " (" + Math.round(performance.now() - t) + " ms):");
      for (const r of rows) spike.log("     " + r.kind.padEnd(8) + (r.title || "").slice(0, 44).padEnd(46) + r.url.slice(0, 80));
    }
  });

  await section("4. suggestions B: Firefox's own urlbar providers, headless (ProvidersManager.startQuery)", async () => {
    for (const q of ["key", "moz", "exam", "hacker news", "example.org/key"]) {
      const t = performance.now();
      const rows = await VitreOmniboxData.suggestViaUrlbar(q, { limit: 8 });
      spike.log(JSON.stringify(q) + " (" + Math.round(performance.now() - t) + " ms):");
      for (const r of rows) spike.log("     " + (r.kind + (r.heuristic ? "*" : "")).padEnd(12) + String(r.title || "").slice(0, 40).padEnd(42) + String(r.url || r.query || "").slice(0, 70) + (r.autofill ? "   autofill=" + r.autofill : ""));
    }
  });

  await section("5. remove a history entry (Shift+Delete)", async () => {
    const url = "https://example.org/keyboard-shortcuts";
    const before = (await VitreOmniboxData.suggest("shortcuts", { limit: 6 })).map((r) => r.url);
    const removed = await VitreOmniboxData.removeFromHistory(url);
    const after = (await VitreOmniboxData.suggest("shortcuts", { limit: 6 })).map((r) => r.url);
    spike.log("before:", before, "history.remove() ->", removed, "after:", after, "fetch:", await PlacesUtils.history.fetch(url));
  });

  await section("6. search engines (Services.search)", async () => {
    const engines = await VitreOmniboxData.engines();
    spike.log("engines:", engines.map((e) => e.name + (e.isDefault ? "*" : "") + (e.alias ? " [" + e.alias + "]" : "")).join(", "));
    for (const e of engines) spike.log("     " + e.name.padEnd(14) + VitreOmniboxData.searchURL("vitre browser & glass", e.name));
    spike.log("default search URL:", VitreOmniboxData.searchURL("liquid glass"));
    const sug = await VitreOmniboxData.searchSuggestions("firefox key", 5).catch((e) => "ERR " + e);
    spike.log("live search suggestions for 'firefox key' from the default engine:", sug);
  });

  await section("7. URL fixup for typed input (Services.uriFixup)", async () => {
    for (const s of ["example.com", "example.com/a b?q=1", "localhost:8080/x", "192.168.1.1/admin", "hello world", "vitre", "what is 2+2", "htp://typo.com", "about:config", "view-source:https://example.com", "C:\\Windows\\win.ini", "user@example.com", "foo.bar", "мир.рф", "  spaced.com  ", "?example.com", "javascript:alert(1)", "www.", "a.b c"]) {
      spike.log("     " + JSON.stringify(s).padEnd(36) + JSON.stringify(VitreOmniboxData.resolveInput(s)));
    }
    spike.log("Ctrl+Enter canonize 'mozilla' ->", VitreOmniboxData.canonize("mozilla"), "| 'mozilla.org/x' ->", VitreOmniboxData.canonize("mozilla.org/x"));
  });

  await section("8. loading: current tab, new tab, switch to tab", async () => {
    gBrowser.selectedTab = gBrowser.tabs[0];
    spike.log("prefs: dom.security.https_first_schemeless=" + Services.prefs.getBoolPref("dom.security.https_first_schemeless", false) + " dom.security.https_first=" + Services.prefs.getBoolPref("dom.security.https_first", false) + " keyword.enabled=" + Services.prefs.getBoolPref("keyword.enabled", false));
    const started = [];
    const pl = { onStateChange(b, wp, req, flags) { if (wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT) { let n = "?"; try { n = req.QueryInterface(Ci.nsIChannel).originalURI.spec; } catch (e) { try { n = req.name; } catch (e2) {} } started.push(n.slice(0, 90)); } } };
    gBrowser.addTabsProgressListener(pl);
    // current tab, typed address
    VitreOmniboxData.go("example.org/typed", "current");
    await spike.sleep(1800);
    spike.log("go('example.org/typed','current') -> requests", started.splice(0), "now at", gBrowser.currentURI.spec);
    // current tab, search words: only check which URL it starts loading, then stop
    VitreOmniboxData.go("vitre liquid glass", "current");
    await spike.sleep(700);
    gBrowser.selectedBrowser.stop();
    spike.log("go('vitre liquid glass','current') -> requests", started.splice(0));
    // new foreground tab
    const n0 = gBrowser.tabs.length;
    VitreOmniboxData.go("https://example.com/?new-tab", "tab");
    await spike.sleep(1500);
    spike.log("go(url,'tab') -> tabs " + n0 + " -> " + gBrowser.tabs.length + ", selected is new: " + (gBrowser.selectedTab === gBrowser.tabs[gBrowser.tabs.length - 1]) + ", url " + gBrowser.currentURI.spec);
    // switch to an already open tab
    const ok = VitreOmniboxData.switchToTab("https://example.org/");
    spike.log("switchToTab('https://example.org/') ->", ok, "selected index", gBrowser.tabContainer.selectedIndex, gBrowser.currentURI.spec);
    // triggeringPrincipal is mandatory on the raw APIs
    for (const [name, fn] of [
      ["gBrowser.addTab(url) without triggeringPrincipal", () => gBrowser.addTab("https://example.com/")],
      ["browser.fixupAndLoadURIString(url) without triggeringPrincipal", () => gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/")],
      ["browser.loadURI(uri) without triggeringPrincipal", () => gBrowser.selectedBrowser.loadURI(Services.io.newURI("https://example.com/"))],
    ]) {
      try { fn(); spike.log(name + ": no error"); } catch (e) { spike.log(name + ": THROWS " + String(e).slice(0, 140)); }
    }
    gBrowser.removeTabsProgressListener(pl);
  });
  await spike.capture("05");
});
