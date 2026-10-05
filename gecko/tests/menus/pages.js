// Every page context on local pages (served over http by all.py), with each row's real action.
/* global spike, Services, Cc, Ci, gBrowser, ChromeUtils, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const fake = M.fakeServices();
  const article = M.page("article.html");
  await M.load(article);
  const tab0 = b.active();

  const rowsAre = (name, want) => {
    const got = M.labels();
    check(name + " rows", JSON.stringify(got) === JSON.stringify(want), { got, want });
    return got;
  };
  const anatomy = (name) => {
    const st = M.state();
    const h = M.expectedHeight(M.menus().view);
    check(name + " height = 12 + 34 rows + 9 seps", Math.abs(st.rect.height - h) < 1, { height: st.rect.height, expected: h });
    check(name + " width 264..360 in 8 px steps", st.rect.width >= 264 && st.rect.width <= 360 && st.rect.width % 8 === 0, st.rect.width);
  };
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(150);
  };
  const tabsNow = () => b.tabs.length;

  // ---- link ----
  let at = await M.openOn("#link1");
  check("link: menu opened", at.ok);
  M.describe("LINK");
  rowsAre("link", ["Open link in new tab", "Peek link", "Open link in new window", "Copy link address", "Download linked file", "Inspect"]);
  anatomy("link");
  let st = M.state();
  check("link: top-left at the pointer", Math.abs(st.rect.left - at.x) <= 1 && Math.abs(st.rect.top - at.y) <= 1, { rect: st.rect, at: [at.x, at.y] });
  check("link: Peek link prints Shift+click", st.rows[1].key === "Shift+click", st.rows[1]);
  check("link: icons on the rows that have one", st.rows.map((r) => r.icon).join(",") === "newtab,peek,newwindow,link,download,inspect", st.rows.map((r) => r.icon));
  check("link: target wash over the link", st.wash === 1, st.wash);
  const wash = document.querySelector("#layer-menus .vt-wash");
  const wr = wash.getBoundingClientRect();
  check("link: wash on the link's rectangle", Math.abs(wr.left - at.rect.x) < 2 && Math.abs(wr.top - at.rect.y) < 2 && Math.abs(wr.width - at.rect.w) < 2, { wash: [wr.left, wr.top, wr.width, wr.height], link: at.rect });
  check("link: no access keys underlined (mouse)", !st.classes.includes("keys"), st.classes);
  check("link: no row focused (mouse)", st.active === -1, st.active);
  await capture("pages-link");
  // hover lights one plate
  const row1 = M.menus().view.rowElement(1).getBoundingClientRect();
  M.mouse(row1.left + 60, row1.top + 17, { type: "mousemove" });
  await sleep(150);
  check("link: hover lights the row", M.state().active === 1, M.state().active);
  await capture("pages-link-hover");

  // Open link in new tab: background, next to the page, with the page's principal. The document
  // channel's loadInfo says who asked for the load (the page, never the system principal).
  const pageOrigin = Services.io.newURI(article).prePath;
  const loads = [];
  const loadWatch = {
    observe(subject) {
      try {
        const ch = subject.QueryInterface(Ci.nsIHttpChannel);
        if (!ch.URI.spec.includes("counter.html")) return;
        const tp = ch.loadInfo.triggeringPrincipal;
        loads.push({ url: ch.URI.spec, system: !!tp?.isSystemPrincipal, origin: tp?.isContentPrincipal ? tp.origin : "" });
      } catch {
        /* not http */
      }
    },
  };
  Services.obs.addObserver(loadWatch, "http-on-modify-request");
  let n = tabsNow();
  await M.pick("Open link in new tab");
  await spike.waitFor(() => tabsNow() === n + 1, { what: "new tab" });
  let nt = b.tabs[b.tabs.indexOf(tab0) + 1];
  await spike.waitFor(() => nt.url.includes("counter.html"), { what: "new tab url" });
  await spike.waitFor(() => loads.length > 0, { what: "the new tab's request", timeout: 5000 }).catch(() => null);
  Services.obs.removeObserver(loadWatch, "http-on-modify-request");
  check("Open link in new tab: background, next to the page", b.active() === tab0 && nt.url === M.page("counter.html"), { active: b.active().url, url: nt.url });
  check("Open link in new tab: loaded with the page's principal (triggering principal of the request)", loads.length > 0 && loads.every((l) => !l.system && l.origin === pageOrigin), { loads, pageOrigin });
  b.closeTab(nt);
  await sleep(300);

  // ...and a page cannot reach what it could not load itself: a link to file:///C:/ is refused.
  await M.inContent(tab0.browser, (content) => {
    const a = content.document.createElement("a");
    a.id = "filelink";
    a.href = "file:///C:/";
    a.textContent = "a file link";
    a.style.cssText = "position:fixed;left:40px;top:120px;font:20px sans-serif;z-index:9";
    content.document.body.append(a);
    return true;
  });
  await sleep(200);
  const tabsBefore = new Set(b.tabs);
  const fileAt = await M.openOn("#filelink");
  if (fileAt.ok && M.labels().includes("Open link in new tab")) {
    await M.pick("Open link in new tab");
    await sleep(1500);
    const fileTab = b.tabs.find((t) => /^file:/i.test(t.url));
    check("Open link in new tab: a page's file:///C:/ link is refused (no file: tab)", !fileTab, b.tabs.map((t) => t.url));
    for (const t of b.tabs.slice()) if (!tabsBefore.has(t)) b.closeTab(t);
  } else {
    check("file link menu: no Open link in new tab offered", true, M.labels());
    await close();
  }
  await M.inContent(tab0.browser, (content) => {
    content.document.getElementById("filelink")?.remove();
    return true;
  });
  await sleep(300);

  // Copy link address
  M.setClipboard("before");
  await M.openOn("#link1");
  await M.pick("Copy link address");
  check("Copy link address", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html"));

  // Peek link: the Peek service gets an OpenRequest with the page's principal and the link as origin
  fake.take();
  at = await M.openOn("#link1");
  await sleep(100);
  await M.pick("Peek link");
  let call = fake.take().find((c) => c.name === "peek.open");
  check("Peek link: peek.open(request)", !!call && call.args[0]?.url === M.page("counter.html") && !!call.args[0]?.click?.triggeringPrincipal && call.args[0]?.browser === tab0.browser, call && { url: call.args[0]?.url, source: call.args[0]?.source });
  const origin = call?.args[1]?.origin;
  check("Peek link: grows from the link", !!origin && Math.abs(origin.x - at.rect.x) < 2 && Math.abs(origin.y - at.rect.y) < 2, origin && [origin.x, origin.y, origin.width, origin.height]);

  // Download linked file: the downloads service, with the page's referrer and principal
  await M.openOn("#link1");
  await M.pick("Download linked file");
  call = fake.take().find((c) => c.name === "downloads.download");
  check("Download linked file: downloads.download(url, opts)", !!call && call.args[0] === M.page("counter.html") && call.args[1]?.browser === tab0.browser && !!call.args[1]?.referrerInfo, call && { url: call.args[0], keys: Object.keys(call.args[1] || {}) });
  // The page's own principal (never the system one) and its cookie jar go with it; the engine makes
  // the channel from them (tests/integrate/menus.js checks the channel and the Referer).
  const dp = call?.args[1]?.triggeringPrincipal;
  check("Download linked file: the page's content principal, its cookie jar and the link's referrer info", !!dp && !dp.isSystemPrincipal && dp.isContentPrincipal && dp.origin === pageOrigin && !!call.args[1]?.cookieJarSettings && call.args[1].referrerInfo instanceof Ci.nsIReferrerInfo, { origin: dp?.origin, system: dp?.isSystemPrincipal, jar: !!call?.args[1]?.cookieJarSettings });
  check("Download linked file: flies from the row's icon", !!call?.args[1]?.origin && call.args[1].origin.x > 0, call?.args[1]?.origin);

  // Open link in new window
  const windows = () => {
    let c = 0;
    for (const w of Services.wm.getEnumerator("navigator:browser")) if (!w.closed) c++;
    return c;
  };
  const w0 = windows();
  await M.openOn("#link1");
  await M.pick("Open link in new window");
  await spike.waitFor(() => windows() === w0 + 1, { what: "new window", timeout: 10000 }).catch(() => null);
  check("Open link in new window", windows() === w0 + 1, windows());
  for (const w of Services.wm.getEnumerator("navigator:browser")) if (w !== window) w.close();
  await sleep(800);
  await spike.activate();

  // releasing the right button on a row runs it, and its contextmenu opens nothing else
  await M.openOn("#link1");
  M.setClipboard("before");
  {
    const before = M.last().pageMenus;
    const i = M.labels().indexOf("Copy link address");
    const rr = M.menus().view.rowElement(i).getBoundingClientRect();
    M.rightClick(rr.left + 60, rr.top + 17);
    check("right-button release on a row runs it", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html") && (await M.waitClosed()));
    await sleep(400);
    check("…and no second menu opens under it", !M.isOpen() && M.last().pageMenus === before, { open: M.isOpen() });
  }

  // a wrapped link: one wash per line box
  at = await M.openOn("#link2", { dx: (await M.rectOf("#link2")).w - 30, dy: 8 });
  check("wrapped link: a wash per line", M.state().wash >= 2, M.state().wash);
  await capture("pages-link-wrapped");
  await close();

  // ---- mail, phone, file, download attribute, javascript: ----
  await M.openOn("#mail");
  rowsAre("mailto", ["Copy email address", "Inspect"]);
  await capture("pages-mailto");
  await M.pick("Copy email address");
  check("Copy email address", (await M.clipboardIs("hello@example.com")) === "hello@example.com", M.readClipboard());
  await M.openOn("#tel");
  rowsAre("tel", ["Copy phone number", "Inspect"]);
  await M.pick("Copy phone number");
  check("Copy phone number", (await M.clipboardIs("+15551234567")) === "+15551234567", M.readClipboard());
  await M.openOn("#file");
  rowsAre("file link", ["Download linked file", "Copy link address", "Inspect"]);
  await capture("pages-filelink");
  await close();
  await M.openOn("#dl");
  rowsAre("download attribute", ["Download linked file", "Copy link address", "Inspect"]);
  await M.pick("Download linked file");
  call = fake.take().find((c) => c.name === "downloads.download");
  check("download attribute: its file name goes along", call?.args[1]?.filename === "notes.txt", call?.args[1]?.filename);
  await M.openOn("#js");
  check("javascript: link gets the page menu", M.labels()[0] === "Back", M.labels());
  await close();

  // ---- image, image link, canvas ----
  at = await M.openOn("#img1");
  rowsAre("image", ["Open image in new tab", "Peek image", "Save image as…", "Copy image", "Copy image address", "Inspect"]);
  anatomy("image");
  await capture("pages-image");
  n = tabsNow();
  await M.pick("Open image in new tab");
  nt = await spike.waitFor(() => b.tabs.find((t) => t !== tab0 && t.url.includes("photo.svg")), { what: "image tab" }).catch(() => null);
  check("Open image in new tab", !!nt && b.active() === tab0, nt?.url);
  if (nt) b.closeTab(nt);
  await sleep(300);
  await M.openOn("#img1");
  await M.pick("Copy image address");
  check("Copy image address", (await M.clipboardIs(M.page("photo.svg"))) === M.page("photo.svg"));
  await M.openOn("#img1");
  await M.pick("Save image as…");
  call = fake.take().find((c) => c.name === "downloads.download");
  check("Save image as…: downloads.download(src, { saveAs })", call?.args[0] === M.page("photo.svg") && call?.args[1]?.saveAs === true, call && { url: call.args[0], saveAs: call.args[1]?.saveAs });
  await M.openOn("#img1");
  await M.pick("Peek image");
  call = fake.take().find((c) => c.name === "peek.open");
  check("Peek image: peek.open(request) from the image", call?.args[0]?.url === M.page("photo.svg") && !!call?.args[1]?.origin, call && call.args[0]?.url);
  await M.openOn("#img1");
  Services.clipboard.emptyClipboard(Ci.nsIClipboard.kGlobalClipboard);
  await M.pick("Copy image");
  await sleep(500);
  const flavors = ["image/png", "application/x-moz-nativeimage", "text/html"].filter((f) => Services.clipboard.hasDataMatchingFlavors([f], Ci.nsIClipboard.kGlobalClipboard));
  check("Copy image: an image on the clipboard", flavors.length > 0, flavors);

  at = await M.openOn("#img2");
  rowsAre("image link", ["Open link in new tab", "Peek link", "Open link in new window", "Copy link address", "Download linked file", "Open image in new tab", "Save image as…", "Copy image", "Inspect"]);
  anatomy("image link");
  check("image link: no wash (the image is the target)", M.state().wash === 0, M.state().wash);
  await capture("pages-imagelink");
  await close();

  at = await M.openOn("#cv");
  rowsAre("canvas", ["Save image as…", "Copy image", "Inspect"]);
  await capture("pages-canvas");
  await M.pick("Save image as…");
  await spike.waitFor(() => fake.calls.some((c) => c.name === "downloads.download"), { what: "canvas save", timeout: 4000 }).catch(() => null);
  call = fake.take().find((c) => c.name === "downloads.download");
  check("canvas Save image as…: a blob: URL named canvas.png", !!call && /^blob:/.test(call.args[0]) && call.args[1]?.filename === "canvas.png" && call.args[1]?.saveAs === true, call && { url: String(call.args[0]).slice(0, 40), filename: call.args[1]?.filename });

  // ---- selection ----
  const select = (id, text) =>
    M.inContent(tab0.browser, (content, a) => {
      const p = content.document.getElementById(a.id);
      const walker = content.document.createTreeWalker(p, content.NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const i = node.data.indexOf(a.text);
        if (i < 0) continue;
        const range = content.document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + a.text.length);
        const s = content.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        p.scrollIntoView({ block: "center" });
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      }
      return null;
    }, { id, text });
  const clickSelection = async (r) => {
    const box = tab0.browser.getBoundingClientRect();
    const x = box.left + r.x + r.w / 2;
    const y = box.top + r.y + r.h / 2;
    M.rightClick(x, y);
    return M.waitOpen();
  };
  let sel = await select("p1", "surface tension");
  await sleep(200);
  sel = await select("p1", "surface tension");
  check("selection: menu opened", await clickSelection(sel));
  rowsAre("selection", ["Copy", "Search for “surface tension”", "Find “surface tension” on page", "Inspect"]);
  M.describe("SELECTION");
  await capture("pages-selection");
  M.setClipboard("before");
  await M.pick("Copy");
  check("selection Copy", (await M.clipboardIs("surface tension")) === "surface tension", M.readClipboard());
  sel = await select("p1", "surface tension");
  await clickSelection(sel);
  await M.pick("Search for “surface tension”");
  call = fake.take().find((c) => c.name === "peek.open");
  check("Search for: opens in a peek (the default setting)", !!call && String(call.args[0]).includes("surface%20tension") && !!call.args[1]?.origin, call && String(call.args[0]));
  b.sys("VitreSettings").set({ selectionSearchOpens: "tab" });
  await sleep(200);
  sel = await select("p1", "surface tension");
  await clickSelection(sel);
  n = tabsNow();
  await M.pick("Search for “surface tension”");
  await spike.waitFor(() => tabsNow() === n + 1, { what: "search tab" }).catch(() => null);
  nt = b.tabs.find((t) => t.url.includes("surface%20tension") || t.url.includes("surface+tension"));
  check("Search for: a new tab with the setting at 'tab'", !!nt, b.tabs.map((t) => t.url));
  if (nt) b.closeTab(nt);
  b.sys("VitreSettings").set({ selectionSearchOpens: "peek" });
  await b.activate(tab0);
  await sleep(400);
  sel = await select("p1", "surface tension");
  await clickSelection(sel);
  await M.pick("Find “surface tension” on page");
  call = fake.take().find((c) => c.name === "find.open");
  check("Find selection: find.open({ query, browser })", call?.args[0]?.query === "surface tension" && call?.args[0]?.browser === tab0.browser, call && call.args[0]?.query);
  sel = await select("p1", "refract.wiki");
  await clickSelection(sel);
  rowsAre("selection that is an address", ["Copy", "Go to refract.wiki", "Find “refract.wiki” on page", "Inspect"]);
  await capture("pages-selection-url");
  n = tabsNow();
  await M.pick("Go to refract.wiki");
  await spike.waitFor(() => tabsNow() === n + 1, { what: "go to tab" }).catch(() => null);
  nt = b.tabs.find((t) => t.url.startsWith("https://refract.wiki"));
  check("Go to: the address in a new tab", !!nt, b.tabs.map((t) => t.url));
  if (nt) b.closeTab(nt);
  await b.activate(tab0);
  await M.inContent(tab0.browser, (content) => content.getSelection().removeAllRanges());
  await sleep(300);

  // ---- editable fields ----
  let r = await M.rectOf("#inp");
  M.mouse(r.cx, r.cy, {});
  await sleep(150);
  M.key("a", { accelKey: true });
  await sleep(150);
  M.rightClick(r.x + 40, r.cy);
  await M.waitOpen();
  rowsAre("editable", ["Undo", "Redo", "Cut", "Copy", "Paste", "Select all", "Inspect"]);
  st = M.describe("EDITABLE");
  check("editable: Cut and Copy on with a selection", !st.rows[2].disabled && !st.rows[3].disabled, st.rows.slice(2, 4));
  check("editable: Redo greyed (nothing to redo)", st.rows[1].disabled, st.rows[1]);
  await capture("pages-editable");
  M.setClipboard("before");
  await M.pick("Copy");
  check("editable Copy", (await M.clipboardIs("editable field text")) === "editable field text", M.readClipboard());
  const focusKept = await M.inContent(tab0.browser, (content) => content.document.activeElement?.id);
  check("focus stayed in the page's field", focusKept === "inp", focusKept);
  r = await M.rectOf("#ta");
  M.mouse(r.x + 300, r.bottom - 14, {});
  await sleep(150);
  await M.inContent(tab0.browser, (content) => {
    const t = content.document.getElementById("ta");
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await sleep(100);
  M.rightClick(r.x + 300, r.bottom - 14);
  await M.waitOpen();
  await M.pick("Paste");
  await sleep(300);
  let ta = await M.inContent(tab0.browser, (content) => content.document.getElementById("ta").value);
  check("Paste into the textarea", ta.endsWith("editable field text"), ta);
  M.rightClick(r.x + 300, r.bottom - 14);
  await M.waitOpen();
  check("Undo is on after the paste", !M.state().rows[0].disabled, M.state().rows[0]);
  await M.pick("Undo");
  await sleep(300);
  ta = await M.inContent(tab0.browser, (content) => content.document.getElementById("ta").value);
  check("Undo", ta === "The flaot process makes flat sheets.", ta);

  r = await M.rectOf("#pw");
  M.mouse(r.cx, r.cy, {});
  await sleep(100);
  M.key("a", { accelKey: true });
  await sleep(100);
  M.rightClick(r.cx, r.cy);
  await M.waitOpen();
  st = M.describe("PASSWORD");
  check("password: Cut and Copy greyed", st.rows.find((x) => x.label === "Cut")?.disabled && st.rows.find((x) => x.label === "Copy")?.disabled, st.rows);
  await capture("pages-password");
  await close();

  // ---- misspelled words (spelling needs the active window: pagefeatures correction 10) ----
  await M.activate();
  r = await M.rectOf("#ta");
  M.mouse(r.x + 60, r.y + 20, {});
  await sleep(1500);
  M.rightClick(r.x + 60, r.y + 20);
  await M.waitOpen();
  st = M.describe("SPELLING textarea");
  const spelled = M.last().context.spelling;
  check("spelling: misspelled word found", spelled?.word === "flaot", spelled);
  check("spelling: suggestions first, Semibold, at most 3", st.rows[0]?.bold && st.rows.filter((x) => x.bold).length <= 3 && st.rows.filter((x) => x.bold).length >= 1, st.rows.map((x) => x.label));
  check("spelling: Add to dictionary, then Cut Copy Paste Select all, Inspect", JSON.stringify(st.rows.slice(st.rows.findIndex((x) => x.label === "Add to dictionary")).map((x) => x.label)) === JSON.stringify(["Add to dictionary", "Cut", "Copy", "Paste", "Select all", "Inspect"]), st.rows.map((x) => x.label));
  await capture("pages-spelling");
  if (st.rows[0]?.bold) {
    const word = st.rows[0].label;
    await M.pick(word);
    await sleep(400);
    ta = await M.inContent(tab0.browser, (content) => content.document.getElementById("ta").value);
    check("spelling: the suggestion replaced the word", ta === `The ${word} process makes flat sheets.`, ta);
  } else await close();
  r = await M.rectOf("#miss");
  M.mouse(r.cx, r.cy, {});
  await sleep(1500);
  M.rightClick(r.cx, r.cy);
  await M.waitOpen();
  st = M.describe("SPELLING rich field");
  check("spelling in a rich field", M.last().context.spelling?.word === "flaot", M.last().context.spelling);
  await close();
  // Paste as plain text: a rich field with HTML on the clipboard
  await M.inContent(tab0.browser, (content) => {
    const a = content.document.getElementById("link1");
    const range = content.document.createRange();
    range.selectNodeContents(a.parentNode);
    const s = content.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  });
  r = await M.rectOf("#p1", { scroll: false });
  M.rightClick(r.x + 30, r.y + 10);
  await M.waitOpen();
  await M.pick("Copy");
  await sleep(300);
  await M.inContent(tab0.browser, (content) => content.getSelection().removeAllRanges());
  r = await M.rectOf("#ce");
  M.mouse(r.right - 20, r.cy, {});
  await sleep(200);
  M.rightClick(r.right - 20, r.cy);
  await M.waitOpen();
  st = M.describe("RICH FIELD");
  check("rich field with HTML on the clipboard: Paste as plain text Ctrl+Shift+V", st.rows.some((x) => x.label === "Paste as plain text" && x.key === "Ctrl+Shift+V"), st.rows.map((x) => x.label));
  await capture("pages-richfield");
  await close();

  // ---- video and audio ----
  const clip = await M.makeVideo("menus-clip.webm");
  await M.inContent(tab0.browser, async (content, src) => {
    const v = content.document.getElementById("vid");
    v.src = src;
    v.loop = true;
    await v.play().catch(() => {});
    const a = content.document.getElementById("aud");
    a.src = src;
    a.load();
    await new Promise((ok) => setTimeout(ok, 400));
  }, clip);
  await sleep(600);
  await M.openOn("#vid");
  st = M.describe("VIDEO");
  rowsAre("video", ["Pause", "Unmute", "Loop", "Show controls", "Picture in picture", "Download video…", "Copy video address", "Inspect"]);
  check("video: Loop checked, Show controls not", st.rows[2].checked === true && st.rows[3].checked === false, st.rows.slice(2, 4));
  check("video: Download video… prints Ctrl+Shift+D", st.rows[5].key === "Ctrl+Shift+D", st.rows[5]);
  await capture("pages-video");
  await M.pick("Pause");
  await sleep(300);
  check("video Pause", await M.inContent(tab0.browser, (content) => content.document.getElementById("vid").paused), "");
  await M.openOn("#vid");
  check("video: Play once paused", M.labels()[0] === "Play", M.labels()[0]);
  await M.pick("Show controls");
  await sleep(300);
  check("video Show controls", await M.inContent(tab0.browser, (content) => content.document.getElementById("vid").controls), "");
  await M.openOn("#vid", { dy: 20 });
  await M.pick("Download video…");
  check("Download video…: the downloads module's picker", fake.take().some((c) => c.name === "downloads.videoPicker"));
  await M.openOn("#vid", { dy: 20 });
  await M.pick("Copy video address");
  check("Copy video address", (await M.clipboardIs(clip)) === clip, M.readClipboard());
  await M.openOn("#aud");
  st = M.describe("AUDIO");
  rowsAre("audio", ["Play", "Mute", "Loop", "Show controls", "Download audio", "Copy audio address", "Inspect"]);
  check("audio: Show controls checked", st.rows[3].checked === true, st.rows[3]);
  await capture("pages-audio");
  await M.pick("Download audio");
  call = fake.take().find((c) => c.name === "downloads.download");
  check("Download audio: downloads.download(src)", call?.args[0] === clip, call && call.args[0]);
  // A video playing a stream (no address): no Copy video address
  await M.inContent(tab0.browser, async (content) => {
    const v = content.document.getElementById("vid");
    const c = content.document.getElementById("cv");
    v.removeAttribute("src");
    v.srcObject = c.captureStream(10);
    await v.play().catch(() => {});
  });
  await sleep(500);
  await M.openOn("#vid");
  check("stream video: no Copy video address", !M.labels().includes("Copy video address"), M.labels());
  await close();

  // ---- frame ----
  at = await M.openOn("#flink", { frame: "#frame1" });
  check("frame link: menu", at.ok && M.last().context.inFrame === true, M.last().context);
  st = M.describe("FRAME LINK");
  check("frame link: link rows", M.labels()[0] === "Open link in new tab", M.labels());
  const fw = document.querySelector("#layer-menus .vt-wash")?.getBoundingClientRect();
  check("frame link: wash on the link inside the frame", !!fw && Math.abs(fw.left - at.rect.x) < 2 && Math.abs(fw.top - at.rect.y) < 2, fw && [fw.left, fw.top, at.rect.x, at.rect.y]);
  await capture("pages-frame");
  n = tabsNow();
  await M.pick("Open link in new tab");
  await spike.waitFor(() => tabsNow() === n + 1, { what: "frame link tab" }).catch(() => null);
  nt = b.tabs.find((t) => t.url.includes("from=frame"));
  check("frame link: Open link in new tab", !!nt, b.tabs.map((t) => t.url));
  if (nt) b.closeTab(nt);
  await sleep(300);

  // ---- the page ----
  at = await M.openOn("#gap", { dx: 400, dy: 40 });
  rowsAre("page", ["Back", "Forward", "Reload", "Find on page…", "Print…", "Save page as…", "View page source", "Inspect"]);
  st = M.describe("PAGE");
  check("page: Back on, Forward greyed", !st.rows[0].disabled && st.rows[1].disabled, st.rows.slice(0, 2));
  check("page: accelerators", st.rows.map((x) => x.key).join(",") === "Alt+Left,Alt+Right,Ctrl+R,Ctrl+F,Ctrl+P,Ctrl+S,Ctrl+U,", st.rows.map((x) => x.key));
  anatomy("page");
  await capture("pages-page");
  await M.pick("Find on page…");
  call = fake.take().find((c) => c.name === "find.open");
  check("Find on page…: find.open({ browser })", call?.args[0]?.browser === tab0.browser, !!call);
  await M.openOn("#gap", { dx: 400, dy: 40 });
  n = tabsNow();
  await M.pick("View page source");
  nt = await spike.waitFor(() => b.tabs.find((t) => t.url.startsWith("view-source:") || t.browser.currentURI?.spec.startsWith("view-source:")), { what: "source tab" }).catch(() => null);
  check("View page source", !!nt, b.tabs.map((t) => t.url));
  if (nt) b.closeTab(nt);
  await b.activate(tab0);
  await sleep(300);
  await M.inContent(tab0.browser, (content) => (content.document.documentElement.dataset.marker = "1"));
  await M.openOn("#gap", { dx: 400, dy: 40 });
  await M.pick("Reload");
  await spike.waitFor(async () => !tab0.loading && !(await M.inContent(tab0.browser, (content) => content.document.documentElement.dataset.marker)), { what: "reload", timeout: 8000 }).catch(() => null);
  check("Reload", !(await M.inContent(tab0.browser, (content) => content.document.documentElement.dataset.marker)));
  await sleep(500);

  // ---- a page that replaces the menu; Shift+right-click ----
  at = await M.openOn("#nomenu", { expectNone: true });
  const hits = await M.inContent(tab0.browser, (content) => content.document.getElementById("nomenu").dataset.hits);
  check("page-owned menu: Vitre stays out", !M.isOpen() && hits === "1", { open: M.isOpen(), hits });
  at = await M.openOn("#nomenu", { mods: { shiftKey: true } });
  const hits2 = await M.inContent(tab0.browser, (content) => content.document.getElementById("nomenu").dataset.hits);
  check("Shift+right-click: Vitre's menu even there", at.ok && hits2 === "1", { open: at.ok, hits: hits2 });
  await close();

  // ---- flipping near the edges ----
  const box = tab0.browser.getBoundingClientRect();
  M.rightClick(box.right - 40, box.bottom - 30);
  await M.waitOpen();
  st = M.describe("FLIPPED");
  check("near the right edge: opens leftward (right edge at the hotspot)", Math.abs(st.rect.left + st.rect.width - (box.right - 40)) <= 1, st.rect);
  check("near the bottom: opens upward (bottom edge at the hotspot)", Math.abs(st.rect.top + st.rect.height - (box.bottom - 30)) <= 1, st.rect);
  await capture("pages-flipped");

  // ---- dismissing ----
  // a right-click outside an open menu opens a fresh one where it landed
  let before = M.last().pageMenus;
  r = await M.rectOf("#link1", { scroll: true });
  M.rightClick(r.cx, r.cy);
  await sleep(600);
  check("right-click outside: a fresh menu where it landed", M.isOpen() && M.last().pageMenus === before + 1 && M.last().kind === "link", { open: M.isOpen(), kind: M.last().kind });
  // a left click outside closes and is absorbed (the link under it is not followed)
  r = await M.rectOf("#img2", { scroll: false });
  M.mouse(r.cx, r.cy, {});
  await sleep(500);
  check("click outside: closed, the link under it not followed", !M.isOpen() && tab0.url === article, tab0.url);
  // the wheel closes
  await M.openOn("#link1");
  spike.EU.synthesizeWheelAtPoint(200, 400, { deltaY: 120, deltaMode: 0 }, window);
  check("wheel closes", await M.waitClosed(2000));
  // a tab switch closes at once
  await M.openOn("#link1");
  const other = b.newTab(M.page("counter.html"), { background: false });
  check("tab switch closes", await M.waitClosed(2000));
  b.closeTab(other);
  await b.activate(tab0);
  await sleep(500);
  // navigation of the page closes
  await M.openOn("#link1");
  b.navigate(tab0, M.page("counter.html"));
  check("navigation closes", await M.waitClosed(4000));
  await M.load(article);

  // ---- services that are not installed: their rows are left out ----
  for (const name of ["peek", "find", "downloads", "settings"]) b.provide(name, undefined);
  await M.openOn("#link1");
  rowsAre("link without Peek / downloads", ["Open link in new tab", "Open link in new window", "Copy link address", "Inspect"]);
  check("link without Peek: Shift+click printed on new window", M.state().rows[1].key === "Shift+click", M.state().rows[1]);
  await close();
  await M.openOn("#img1");
  rowsAre("image without Peek / downloads", ["Open image in new tab", "Copy image", "Copy image address", "Inspect"]);
  await close();
  await M.openOn("#gap", { dx: 400, dy: 40 });
  rowsAre("page without find", ["Back", "Forward", "Reload", "Print…", "Save page as…", "View page source", "Inspect"]);
  await close();

  // ---- inside a peek (rows for a stand-in context: the Peek module shows the sheet) ----
  M.fakeServices(["peek", "find", "downloads"]);
  const rowsFor = M.menus().rowsFor;
  let rows = rowsFor({ browser: tab0.browser }, { inPeek: true });
  check("peek page rows (CtxMenu peekpage)", JSON.stringify(rows) === JSON.stringify(["Open as tab [Alt+Enter]", "Copy address", "—", "Back [Alt+Left]", "Forward [Alt+Right]", "Reload [Ctrl+R]", "—", "Find on page… [Ctrl+F]", "Print… [Ctrl+P]", "—", "Inspect"]), rows);
  rows = rowsFor({ browser: tab0.browser, onLink: true, linkURL: "https://refract.wiki/tin", linkProtocol: "https", onSaveableLink: true }, { inPeek: true });
  check("peek link rows: peeks do not nest (CtxMenu peeklink)", JSON.stringify(rows) === JSON.stringify(["Open link in new tab", "Open link in new window", "—", "Copy link address", "Download linked file", "—", "Inspect"]), rows);
  rows = rowsFor({ browser: tab0.browser, onImage: true, mediaURL: "https://refract.wiki/a.png" }, { inPeek: true });
  check("peek image rows: no Peek image", !rows.some((r) => r.startsWith("Peek")), rows);
  b.sys("VitreSettings").set({ rebind: { openAsTab: "Ctrl+Shift+O" } });
  await sleep(200);
  rows = rowsFor({ browser: tab0.browser }, { inPeek: true });
  check("Open as tab prints the rebound key", rows[0] === "Open as tab [Ctrl+Shift+O]", rows[0]);
  b.sys("VitreSettings").set({ rebind: {} });
  b.sys("VitreSettings").set({ shiftClick: "window" });
  await sleep(200);
  rows = rowsFor({ browser: tab0.browser, onLink: true, linkURL: "https://refract.wiki/tin", linkProtocol: "https", onSaveableLink: true });
  check("Shift+click set to new window: printed there, not on Peek link", rows.includes("Peek link") && rows.includes("Open link in new window [Shift+click]"), rows);
  b.sys("VitreSettings").set({ shiftClick: "peek" });
  rows = rowsFor({ browser: tab0.browser, onVideo: true, onDRMMedia: true, mediaURL: "https://refract.wiki/v.mp4", target: { paused: false, muted: false, loop: false, controls: true, readyState: 4 } });
  check("DRM video: Download video… disabled with Protected, no address", rows.includes("Download video… [Protected]") && !rows.some((r) => r.startsWith("Copy video address")), rows);

  // ---- the window losing activation closes a menu at once ----
  await M.openOn("#link1");
  const w2 = await spike.openWindow();
  w2.focus();
  await spike.waitFor(() => Services.focus.activeWindow === w2, { timeout: 3000, what: "other window active" }).catch(() => null);
  check("deactivation closes the menu", await M.waitClosed(2000));
  w2.close();
  await sleep(600);
  await M.activate();

  // ---- Inspect ----
  await M.openOn("#link1");
  await M.pick("Inspect");
  const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
  const tb = await spike.waitFor(() => DevToolsShim.hasToolboxForTab?.(gBrowser.selectedTab), { timeout: 20000, what: "toolbox" }).catch(() => false);
  check("Inspect opens the toolbox", !!tb);
  await sleep(1500);
  await capture("pages-inspect");
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
  check("no extension items left in Firefox's popup", document.querySelectorAll('#contentAreaContextMenu [id*="-menuitem-"]').length === 0);
});
