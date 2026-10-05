// 02: press every Firefox shortcut and record what Firefox does, in three modes (env KS_MODE):
//   stock  - untouched Firefox (shows the detector works and what each key does)
//   strip  - VitreKeys.neutralise() only (keysets parked + prefs): what is still alive?
//   router - neutralise() + VitreKeys.install(): only Vitre's map may fire
// Focus is in a remote page for every key. The page prevents nothing.
if ([...Services.wm.getEnumerator("navigator:browser")].length > 1) {
  // A window opened by a tested key (Ctrl+N ...): do not run the spike again in it.
} else {
  Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
  Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
  spike.main(async () => {
    const mode = Services.env.get("KS_MODE") || "stock";
    await spike.resize(1100, 720);
    const url = KS.pageURL("keys.html");
    await KS.load(url);
    const tabs = [gBrowser.selectedTab, gBrowser.addTrustedTab(url), gBrowser.addTrustedTab(url)];
    await spike.sleep(1500);
    Services.scriptloader.loadSubScript("resource://vitre-boot/detector.js?" + Date.now(), window);
    spike.log("MODE " + mode + "; keysets at start:", [...document.querySelectorAll("keyset")].map((k) => k.id + "(" + k.querySelectorAll("key").length + ")").join(" "));

    const actions = [];
    if (mode !== "stock") {
      const n = VitreKeys.neutralise({ log: (m) => spike.log("  " + m) });
      spike.log("neutralise(): parked " + n + " <key> elements; keysets now:", [...document.querySelectorAll("keyset")].map((k) => k.id + "(" + k.querySelectorAll("key").length + ")").join(" "));
      spike.log("getElementById('key_newNavigatorTab') still resolves:", !!document.getElementById("key_newNavigatorTab"));
    }
    if (mode === "router") {
      VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + (arg !== undefined ? "(" + arg + ")" : "") + "[" + info.how + "]") });
    }
    await Detector.restore(tabs, url);

    // [spec, what stock Firefox does]. "!" marks keys skipped in stock mode (native dialogs / quits).
    const battery = [
      ["Ctrl+T", "new tab"], ["Ctrl+N", "new window"], ["Ctrl+W", "close tab"], ["Ctrl+F4", "close tab (tabbrowser)"],
      ["Ctrl+Shift+T", "reopen closed tab"], ["Ctrl+Shift+N", "reopen closed window"], ["Ctrl+Shift+P", "private window"],
      ["Ctrl+Tab", "next tab (tabbox)"], ["Ctrl+Shift+Tab", "previous tab (tabbox)"],
      ["Ctrl+PageDown", "next tab (tabbox)"], ["Ctrl+PageUp", "previous tab (tabbox)"],
      ["Ctrl+Shift+PageDown", "move tab right (tabbrowser)"], ["Ctrl+Shift+PageUp", "move tab left (tabbrowser)"],
      ["Ctrl+1", "select tab 1"], ["Ctrl+9", "select last tab"],
      ["Ctrl+L", "focus urlbar"], ["Alt+D", "focus urlbar"], ["F6", "focus next pane (C++)"], ["Shift+F6", "focus previous pane (C++)"],
      ["Ctrl+K", "focus search"], ["Ctrl+E", "focus search"], ["Ctrl+J", "downloads"], ["Ctrl+H", "history sidebar"],
      ["Ctrl+B", "bookmarks sidebar"], ["Ctrl+Shift+B", "bookmarks toolbar"], ["Ctrl+Shift+O", "library"],
      ["Ctrl+D", "bookmark page (panel)", "!"], ["Ctrl+Shift+D", "bookmark all tabs (modal dialog)", "!"], ["Ctrl+Shift+H", "library history"],
      ["Ctrl+I", "page info"], ["Ctrl+U", "view source"],
      ["Ctrl+F", "find bar"], ["Ctrl+G", "find again"], ["Ctrl+Shift+G", "find previous"], ["F3", "find again"], ["Shift+F3", "find previous"],
      ["/", "quick find"], ["'", "quick find links"],
      ["Ctrl+R", "reload"], ["F5", "reload"], ["Ctrl+Shift+R", "hard reload"], ["Ctrl+F5", "hard reload"], ["Escape", "stop"],
      ["Alt+Left", "back"], ["Alt+Right", "forward"], ["Alt+Home", "home"], ["Backspace", "(backspace_action)"],
      ["Ctrl+Plus", "zoom in"], ["Ctrl+Equal", "zoom in"], ["Ctrl+Minus", "zoom out"], ["Ctrl+0", "zoom reset"],
      ["F11", "full screen"], ["F7", "caret browsing (modal confirm)", "!"], ["F9", "reader view"],
      ["F12", "devtools"], ["Ctrl+Shift+I", "devtools"], ["Ctrl+Shift+K", "web console"], ["Ctrl+Shift+C", "inspector"],
      ["Ctrl+Shift+J", "browser console"], ["Ctrl+Shift+M", "responsive design"], ["Ctrl+Shift+E", "network"], ["Shift+F7", "style editor"],
      ["Ctrl+Shift+A", "add-ons"], ["Ctrl+Shift+S", "screenshot"], ["Ctrl+Shift+Delete", "clear data dialog"],
      ["Ctrl+M", "mute tab"], ["Ctrl+Shift+X", "text direction"], ["Shift+Escape", "about:processes"],
      ["Ctrl+Alt+Z", "toggle sidebar"], ["Ctrl+Alt+R", "reader view"], ["F1", "(help)"], ["Ctrl+Q", "(nothing on Windows)"], ["Ctrl+Comma", "(nothing)"],
      ["Alt", "menu bar"], ["F10", "menu bar"], ["Alt+F", "File menu"], ["Alt+E", "Edit menu"],
      ["Ctrl+P", "print", "!"], ["Ctrl+S", "save page (native dialog)", "!"], ["Ctrl+O", "open file (native dialog)", "!"],
      ["Ctrl+Shift+W", "close window", "!"], ["Ctrl+Shift+Q", "quit", "!"],
    ];

    let quiet = 0, loud = 0;
    for (const [spec, what, risky] of battery) {
      if (risky && mode === "stock") { spike.log(spec.padEnd(22) + " SKIPPED in stock mode (" + what + ")"); continue; }
      await Detector.restore(tabs, url);
      Detector.ev.length = 0;
      actions.length = 0;
      const before = Detector.snap();
      const seenBefore = (await KS.pageSeen(tabs[1].linkedBrowser)).length;
      try { KS.press(spec); } catch (e) { spike.log(spec + " synth error " + e); }
      await spike.sleep(/F12|Shift\+[IKCJME]$|F7|Ctrl\+I$/.test(spec) ? 1800 : 450);
      const after = Detector.snap();
      const changes = Detector.diff(before, after).concat(Detector.ev);
      let page = "?";
      try { page = (await KS.pageSeen(tabs[1].linkedBrowser)).slice(seenBefore).join(" "); } catch (e) {}
      if (changes.length) loud++; else quiet++;
      spike.log(spec.padEnd(22) + " firefox: " + (changes.length ? changes.join("; ") : "nothing") + (mode === "router" ? " | vitre: " + (actions.join(",") || "-") : "") + " | page saw: " + (page || "-"));
    }
    spike.log("SUMMARY mode=" + mode + ": " + loud + " keys made Firefox do something, " + quiet + " did nothing");
    await Detector.restore(tabs, url);
    await spike.capture("02-" + mode);
  });
}
