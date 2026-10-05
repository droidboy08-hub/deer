// Every feature module installed together, and the services they offer each other honouring the
// contracts (ARCHITECTURE.md "Services"): the contracted members exist and are functions, the
// documented additions are there, the read-only members answer sensibly with nothing open, and every
// action a module owns is registered. No module failed to install.
/* global spike, Services, I */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await I.load(I.page("article.html"), 600);

  log("modules", b.modules, "errors", b.moduleErrors);
  const want = ["downloads", "extensions", "find", "menus", "peek", "settings", "switcher"];
  check("all seven feature modules installed, none threw", want.every((m) => b.modules.includes(m)) && b.moduleErrors.length === 0, { modules: b.modules, errors: b.moduleErrors });

  const contract = {
    peek: { members: ["open", "isOpen", "browser", "close", "promote", "headerRect", "canReopen", "reopen"], additions: ["headerSlot", "search"] },
    find: { members: ["open", "close", "isOpen"], additions: [] },
    menus: { members: ["show", "close"], additions: ["isOpen", "editItems"] },
    downloads: { members: ["download", "openPanel", "videoPicker"], additions: ["mediaState", "isPanelOpen"] },
    settings: { members: ["open", "registerPage"], additions: ["isOpen", "close", "changeBackground"] },
    extensions: { members: ["openPanel", "count"], additions: [] },
    switcher: { members: ["open", "isOpen"], additions: ["close"] },
  };
  for (const [name, c] of Object.entries(contract)) {
    const api = b.service(name);
    const own = api ? Object.keys(api).sort() : [];
    const missing = c.members.filter((m) => typeof api?.[m] !== "function");
    const extra = own.filter((m) => !c.members.includes(m) && !c.additions.includes(m));
    const additions = c.additions.filter((m) => typeof api?.[m] === "function");
    check(`'${name}': every contracted member is a function; no undocumented member`, !!api && !missing.length && !extra.length && additions.length === c.additions.length, { own, missing, extra, additions });
  }

  // Nothing open: the read-only members say so.
  const peek = b.service("peek");
  const idle = {
    peekOpen: peek.isOpen(),
    peekBrowser: peek.browser(),
    peekHeader: peek.headerRect(),
    peekReopen: peek.canReopen(),
    peekSlot: peek.headerSlot?.(true) ?? null,
    find: b.service("find").isOpen(),
    menus: b.service("menus").isOpen(),
    downloadsPanel: b.service("downloads").isPanelOpen(),
    media: b.service("downloads").mediaState(),
    settings: b.service("settings").isOpen(),
    extensions: b.service("extensions").count(),
    switcher: b.service("switcher").isOpen(),
  };
  log("idle answers", idle);
  check(
    "with nothing open every service says so (peek closed, no header, no slot; find, menu, panels, switcher closed; a count of extensions)",
    !idle.peekOpen && idle.peekBrowser === null && idle.peekHeader === null && !idle.peekReopen && idle.peekSlot === null && !idle.find && !idle.menus && !idle.downloadsPanel && !idle.settings && !idle.switcher && typeof idle.extensions === "number" && idle.media && typeof idle.media.count === "number" && idle.media.protected === false,
    idle
  );
  // The core's own hook for the Peek module.
  check("window.vitrePeek is the core's hook: { browser(), close(), open() }", typeof window.vitrePeek?.browser === "function" && typeof window.vitrePeek?.close === "function" && typeof window.vitrePeek?.open === "function" && window.vitrePeek.browser() === null);

  // The actions each module owns are registered (the router runs them; b.builtin is the core's).
  const actions = b.actions;
  const owned = ["find", "findNext", "findPrev", "peekLink", "openAsTab", "reopenClosed", "devtools", "downloads", "downloadVideo", "settings", "shortcutsHelp", "clearData", "nextTabMru", "prevTabMru", "switcherSearch"];
  const unregistered = owned.filter((a) => !actions?.has?.(a));
  check("every module action is registered", !unregistered.length, { unregistered });

  // Esc and close ladders: the documented priorities are in place.
  const esc = (b.escLayers ?? []).map((l) => l.priority);
  const close = (b.closeLayers ?? []).map((l) => l.priority);
  log("esc ladder priorities", esc, "close ladder", close);
  check("Esc ladder holds menu 20, switcher 40, panels 60, fields 70, parked find 90, peek 100", [20, 40, 60, 70, 90, 100].every((p) => esc.includes(p)), esc);
  check("close ladder holds switcher 40, panels 60, peek 100", [40, 60, 100].every((p) => close.includes(p)), close);

  // Firefox's search-terms persistence writes a results page's search terms into the browser's
  // userTypedValue (SmartbarInput.mjs); the tab's address must stay the page's URL (fx.tabUrl).
  const t = b.active();
  const url = t.url;
  for (const terms of ["float glass", "c++:templates", "todo:list", "localhost:3000"]) {
    t.browser.userTypedValue = terms;
    t.node.dispatchEvent(new CustomEvent("TabAttrModified", { bubbles: true, detail: { changed: ["label"] } }));
    await sleep(300);
    const seen = t.url;
    t.browser.userTypedValue = null;
    check(`search terms ${JSON.stringify(terms)} in userTypedValue (Firefox's persisted search terms) do not become the tab's address`, seen === url, { seen, url });
  }
  check("Firefox's search-terms persistence is off (browser.urlbar.showSearchTerms.enabled)", Services.prefs.getBoolPref("browser.urlbar.showSearchTerms.enabled", true) === false);
  await sleep(200);
});
