// Menus at 150 % (run with --pref layout.css.devPixelsPerPx=1.5; all.py does): every coordinate the
// module converts between CSS px, device px and screen px. The pointer menu at the hotspot, rows hit
// where they are drawn, the link wash on the link, keyboard anchors (focused link, caret flip,
// selection), the bar menus at y 64, and Windows' system menu at the right device point.
//   python tests/menus-verify/all.py scale
/* global spike, Services, Cc, Ci, ChromeUtils, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, capture, waitFor } = spike;
  await spike.resize(1200, 760);
  await M.activate();
  const dpr = window.devicePixelRatio;
  check("scale: the window runs at 150 %", Math.abs(dpr - 1.5) < 0.01, dpr);
  M.fakeServices();
  const article = M.page("article.html");
  const tab = await M.load(article);
  const page = (fn, arg) => M.inContent(tab.browser, fn, arg);
  const esc = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(150);
  };

  await V.section("pointer menu", async () => {
    const at = await M.openOn("#link1");
    check("150 %: link menu opened", at.ok && M.last().kind === "link", M.last().kind);
    await sleep(300);
    const st = M.state();
    check("150 %: top-left at the pointer", Math.abs(st.rect.left - at.x) <= 1 && Math.abs(st.rect.top - at.y) <= 1, { rect: [st.rect.left, st.rect.top], at: [at.x, at.y] });
    check("150 %: 264 wide, rows 34 tall (CSS px)", Math.round(st.rect.width) === 264 && Math.abs(st.rect.height - M.expectedHeight(M.menus().view)) < 1, [st.rect.width, st.rect.height]);
    const wash = document.querySelector(".vt-menus .vt-wash");
    const wr = wash?.getBoundingClientRect();
    check("150 %: the wash covers the link", !!wr && Math.abs(wr.left - at.rect.x) <= 1 && Math.abs(wr.top - at.rect.y) <= 2 && Math.abs(wr.width - at.rect.w) <= 2, { wash: wr && [wr.left, wr.top, wr.width, wr.height], link: [at.rect.x, at.rect.y, at.rect.w, at.rect.h] });
    await capture("scale-link");
    await M.pick("Copy link address");
    check("150 %: a clicked row runs (hit-testing)", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html"), M.readClipboard());
    // Near the bottom-right corner: flips left and up, inside the 8 px margins.
    const W = window.innerWidth;
    const H = window.innerHeight;
    M.rightClick(W - 30, H - 30);
    check("150 %: corner menu opened", await M.waitOpen());
    const c = M.state().rect;
    check("150 %: corner menu flipped inside the margins", c.left + c.width <= W - 8 + 0.5 && c.top + c.height <= H - 8 + 0.5 && Math.abs(c.left + c.width - (W - 30)) <= 1, { rect: c, W, H });
    await esc();
  });

  await V.section("keyboard anchors", async () => {
    await page((content) => {
      content.scrollTo(0, 0);
      content.document.getElementById("link1").focus();
    });
    tab.browser.focus();
    await sleep(300);
    const link = await M.rectOf("#link1", { scroll: false });
    await M.activate();
    M.keyboardMenu();
    check("150 %: keyboard menu on a focused link", await M.waitOpen());
    await sleep(200);
    let st = M.state();
    check("150 %: 4 px below the link, left-aligned", Math.abs(st.rect.left - link.x) <= 1.5 && Math.abs(st.rect.top - (link.bottom + 4)) <= 1.5, { rect: [st.rect.left, st.rect.top], link: [link.x, link.bottom] });
    await capture("scale-keyboard-link");
    await esc();
    // A selection: below its last line, from its start.
    await page((content) => {
      const p = content.document.getElementById("p1");
      content.document.activeElement?.blur?.();
      const r = content.document.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, 30);
      const s = content.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    const sel = await page((content) => {
      const r = content.getSelection().getRangeAt(0).getClientRects();
      const a = r[0];
      const z = r[r.length - 1];
      return { left: a.left, bottom: z.bottom };
    });
    const br = tab.browser.getBoundingClientRect();
    await M.activate();
    M.keyboardMenu();
    check("150 %: keyboard menu on a selection", await M.waitOpen());
    await sleep(250);
    st = M.state();
    check("150 %: below the selection's last line, from its start", Math.abs(st.rect.left - (br.left + sel.left)) <= 1.5 && Math.abs(st.rect.top - (br.top + sel.bottom + 4)) <= 1.5, { rect: [st.rect.left, st.rect.top], sel });
    await esc();
    await page((content) => content.getSelection().removeAllRanges());
    // The caret in a field near the bottom: flips up, 4 px above the caret's word.
    await page((content) => {
      const ta = content.document.getElementById("ta");
      ta.scrollIntoView({ block: "end" });
      content.scrollBy(0, -30);
      ta.focus();
      const i = ta.value.indexOf("flaot") + 2;
      ta.setSelectionRange(i, i);
    });
    await M.activate();
    await sleep(1500);
    const word = await page((content) => {
      const ta = content.document.getElementById("ta");
      const r = ta.getBoundingClientRect();
      const cs = content.getComputedStyle(ta);
      return { top: r.top, padTop: parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth), line: parseFloat(cs.lineHeight) };
    });
    M.keyboardMenu();
    check("150 %: keyboard spelling menu", await M.waitOpen());
    await sleep(300);
    st = M.state();
    const lineTop = br.top + word.top + word.padTop;
    const bottom = st.rect.top + st.rect.height;
    log("caret flip at 150 %", JSON.stringify({ menuBottom: bottom, lineTop, lineBottom: lineTop + word.line, record: M.last().record && { lh: M.last().record.lineHeight, caret: M.last().record.caretHeight } }));
    // The word's glyph box starts (line - font height) / 2 = 2.3 px into the 27.2 px line: 4 px above
    // it is 1.7 px above the line box (MenuSpelling: menu bottom 630, word top 634).
    check("150 %: flipped up, ending 4 px above the caret's word", bottom <= lineTop + 0.5 && bottom >= lineTop - 4, { bottom, lineTop });
    await capture("scale-spelling-flip");
    await esc();
  });

  await V.section("bar menus and the system menu", async () => {
    const pill = b.bar.item(tab.id);
    const r = pill.getBoundingClientRect();
    M.rightClick(r.left + 120, r.top + r.height / 2);
    check("150 %: pill menu", await M.waitOpen());
    await sleep(250);
    check("150 %: hangs at y 64", Math.abs(M.state().rect.top - 64) <= 1, M.state().rect.top);
    await esc();
    // The drag strip: Windows' system menu at the pointer, in device pixels.
    const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
    const u = ctypes.open("user32.dll");
    const RECT = new ctypes.StructType("RECT", [{ left: ctypes.int32_t }, { top: ctypes.int32_t }, { right: ctypes.int32_t }, { bottom: ctypes.int32_t }]);
    const FindWindowExW = u.declare("FindWindowExW", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.char16_t.ptr, ctypes.char16_t.ptr);
    const GetWindowRect = u.declare("GetWindowRect", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, RECT.ptr);
    const IsWindowVisible = u.declare("IsWindowVisible", ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t);
    const GetWindowThreadProcessId = u.declare("GetWindowThreadProcessId", ctypes.winapi_abi, ctypes.uint32_t, ctypes.voidptr_t, ctypes.uint32_t.ptr);
    const EndMenu = u.declare("EndMenu", ctypes.winapi_abi, ctypes.int32_t);
    const ourMenu = () => {
      let h = ctypes.voidptr_t(0);
      for (let i = 0; i < 50; i++) {
        h = FindWindowExW(null, h, "#32768", null);
        if (h.isNull()) return null;
        const pid = new ctypes.uint32_t(0);
        GetWindowThreadProcessId(h, pid.address());
        if (pid.value === Services.appinfo.processID && IsWindowVisible(h)) {
          const rc = new RECT();
          GetWindowRect(h, rc.address());
          return { left: rc.left, top: rc.top, right: rc.right, bottom: rc.bottom };
        }
      }
      return null;
    };
    const x = 300;
    const y = 9;
    const expect = { x: Math.round((window.mozInnerScreenX + x) * dpr), y: Math.round((window.mozInnerScreenY + y) * dpr) };
    M.rightClick(x, y);
    let found = null;
    for (let i = 0; i < 30 && !found; i++) {
      await sleep(100);
      found = ourMenu();
    }
    log("system menu at 150 %", JSON.stringify({ found, expect }));
    check("150 %: Windows' system menu opened from the drag strip", !!found);
    check("150 %: the system menu's corner is at the pointer in device pixels", !!found && Math.abs(found.left - expect.x) <= 3 && Math.abs(found.top - expect.y) <= 3, { found, expect });
    check("150 %: no Vitre menu on the strip", !M.isOpen());
    EndMenu();
    await sleep(300);
    check("150 %: the system menu closed again", !ourMenu());
  });

  // The scale changes while a menu is open (a DPI change, a monitor move): context loss closes it, and
  // the next menu is placed and hit-tested at the new scale.
  await V.section("scale change at runtime", async () => {
    await M.load(article);
    await M.openOn("#link1");
    check("runtime scale: a menu open at 150 %", M.isOpen());
    Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.25");
    const changed = await waitFor(() => Math.abs(window.devicePixelRatio - 1.25) < 0.01, { timeout: 5000 }).then(() => true, () => false);
    check("runtime scale: the window is at 125 % now", changed, window.devicePixelRatio);
    check("runtime scale: the open menu closed (context loss)", await waitFor(() => !M.isOpen(), { timeout: 3000 }).then(() => true, () => false));
    await sleep(800);
    const at = await M.openOn("#link1");
    const st = M.state();
    check("runtime scale: the next menu at the pointer", at.ok && Math.abs(st.rect.left - at.x) <= 1 && Math.abs(st.rect.top - at.y) <= 1, { rect: [st.rect.left, st.rect.top], at: [at.x, at.y] });
    await capture("scale-125-link");
    await M.pick("Copy link address");
    check("runtime scale: rows hit where they are drawn", (await M.clipboardIs(M.page("counter.html"))) === M.page("counter.html"));
    Services.prefs.setCharPref("layout.css.devPixelsPerPx", "1.5");
    await sleep(1000);
  });

  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
});
