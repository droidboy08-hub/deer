// Vitre find in page on Gecko (spike). Own HTML field in the chrome document, driven by
// browser.finder (FinderParent in the parent process -> "Finder" JSWindowActor in every frame).
// The native <findbar> is never created.
//
//   finder.caseSensitive = bool                      match case (message to all frames)
//   finder.fastFind(query, linksOnly, drawOutline)   new search from the current position
//   finder.findAgain(query, backwards, linksOnly, drawOutline)   next / previous (wraps)
//   finder.onHighlightAllChange(true)                highlight every match (all frames)
//   listener.onFindResult({result, rect, linkURL, findBackwards, searchString})
//   listener.onMatchesCountResult({current, total, limit})   total === -1 means "limit or more"
//   finder.onFindbarClose() + finder.focusContent()  clear highlights, keep the match selected, focus it / its link
/* global Services, Ci, gBrowser */
window.VitreFind = (() => {
  const H = "http://www.w3.org/1999/xhtml";
  const el = (tag, cls, text) => {
    const n = document.createElementNS(H, tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const log = (...a) => window.spike && window.spike.log("[find]", ...a);
  const NOTFOUND = Ci.nsITypeAheadFind.FIND_NOTFOUND;
  const WRAPPED = Ci.nsITypeAheadFind.FIND_WRAPPED;

  const CSS = `
  .vf-pill { position: fixed; z-index: 2147482500; box-sizing: border-box; width: 480px; height: 44px; border-radius: 22px;
    display: flex; align-items: center; padding: 0 8px 0 16px; gap: 2px;
    font: 13.5px "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1b1b1f;
    background: linear-gradient(rgba(255,255,255,0.86), rgba(255,255,255,0.70)); backdrop-filter: blur(24px) saturate(1.6);
    box-shadow: 0 8px 28px rgba(0,0,0,0.22), 0 1px 3px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.7); }
  .vf-pill[hidden] { display: none; }
  .vf-pill.capsule { position: static; width: 440px; height: 32px; border-radius: 16px; padding: 0 6px 0 12px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08); background: rgba(255,255,255,0.55); backdrop-filter: none; }
  .vf-fav { width: 16px; height: 16px; margin-right: 10px; border-radius: 4px; background: #005fb8; flex: none; }
  .vf-field { flex: 1; min-width: 60px; border: 0; outline: 0; background: transparent; font: inherit; color: inherit; caret-color: #005fb8; padding: 0; }
  .vf-field::selection { background: rgba(76,194,255,0.42); }
  .vf-count { font-size: 12.5px; font-variant-numeric: tabular-nums; color: rgba(27,27,31,0.55); white-space: nowrap; margin: 0 6px; }
  .vf-count.none { color: #c42b1c; }
  .vf-btn { width: 28px; height: 28px; border-radius: 14px; border: 0; background: transparent; color: inherit; font: 600 13px "Segoe UI Variable Text", "Segoe UI", sans-serif; display: flex; align-items: center; justify-content: center; flex: none; padding: 0; }
  .vf-btn:hover { background: rgba(0,0,0,0.06); }
  .vf-btn[disabled] { opacity: 0.28; }
  .vf-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .vf-div { width: 1px; height: 16px; background: rgba(27,27,31,0.12); margin: 0 6px; flex: none; }
  .vf-aa[aria-pressed="true"] { color: #005fb8; background: rgba(0,95,184,0.12); box-shadow: inset 0 0 0 1px rgba(0,95,184,0.35); }
  .vf-ring { position: fixed; z-index: 2147482400; pointer-events: none; border: 2px solid #005fb8; border-radius: 6px; box-sizing: border-box; }
  `;
  // Built with DOM calls: innerHTML is sanitized in chrome documents.
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (d) => {
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    s.appendChild(p);
    return s;
  };

  const states = new WeakMap(); // browser -> state
  let styled = false;
  let active = null; // the state whose UI is showing in this window

  function stateFor(browser) {
    let st = states.get(browser);
    if (!st) {
      st = { browser, query: "", matchCase: false, current: 0, total: 0, limit: 0, result: null, rect: null, linkURL: null, open: false, wrapped: false, ui: null, events: [] };
      st.listener = {
        onFindResult(data) {
          st.result = data.result;
          st.rect = data.rect ? { x: data.rect.left, y: data.rect.top, w: data.rect.width, h: data.rect.height } : null;
          st.linkURL = data.linkURL;
          st.wrapped = data.result === WRAPPED;
          st.events.push("result:" + data.result);
          if (data.result === NOTFOUND) {
            st.current = 0;
            st.total = 0;
          }
          render(st);
        },
        onMatchesCountResult(r) {
          st.current = r.current;
          st.total = r.total;
          st.limit = r.limit;
          st.events.push("count:" + r.current + "/" + r.total);
          render(st);
        },
        onHighlightFinished() {},
        onCurrentSelection(text, isInitial) {
          st.events.push("selection:" + JSON.stringify(text));
          if (isInitial && st.pendingPrefill) {
            st.pendingPrefill(text);
            st.pendingPrefill = null;
          }
        },
        // Called by finder.focusContent(); return false to keep focus where it is.
        shouldFocusContent: () => true,
      };
      states.set(browser, st);
    }
    return st;
  }

  function buildUI(st, host) {
    if (!styled) {
      const s = el("style");
      s.textContent = CSS;
      document.documentElement.appendChild(s);
      styled = true;
    }
    const pill = el("div", "vf-pill" + (host ? " capsule" : ""));
    pill.setAttribute("role", "search");
    const field = el("input", "vf-field");
    field.setAttribute("placeholder", "Find on page");
    field.setAttribute("spellcheck", "false");
    const count = el("span", "vf-count");
    const mk = (cls, title, html, fn) => {
      const b = el("button", "vf-btn " + cls);
      b.setAttribute("title", title);
      b.append(html);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // never take focus from the field
      b.addEventListener("click", fn);
      return b;
    };
    const prev = mk("vf-prev", "Previous match  Shift+Enter", svg("M4 10l4-4 4 4"), () => step(st, true));
    const next = mk("vf-next", "Next match  Enter", svg("M4 6l4 4 4-4"), () => step(st, false));
    const aa = mk("vf-aa", "Match case  Alt+C", "Aa", () => setMatchCase(st, !st.matchCase));
    const x = mk("vf-x", "Close  Esc", svg("M4 4l8 8M12 4l-8 8"), () => close(st.browser));
    if (!host) pill.appendChild(el("span", "vf-fav"));
    pill.append(field, count, prev, next, el("span", "vf-div"), aa, x);

    field.addEventListener("input", () => search(st, field.value));
    field.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "Enter" && e.ctrlKey) {
        // Close and activate the match's link.
        e.preventDefault();
        close(st.browser, { activate: true });
      } else if (k === "Enter" || k === "F3" || (k.toLowerCase() === "g" && e.ctrlKey)) {
        e.preventDefault();
        step(st, e.shiftKey);
      } else if (k === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(st.browser);
      } else if (k.toLowerCase() === "c" && e.altKey && !e.ctrlKey) {
        e.preventDefault();
        setMatchCase(st, !st.matchCase);
      } else if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(k)) {
        // Scroll the page without leaving the field: the finder forwards the key to content.
        e.preventDefault();
        st.browser.finder.keyPress(e);
      }
    });
    (host || document.body).appendChild(pill);
    st.ui = { pill, field, count, prev, next, aa, host: host || null };
    if (!host) position(st);
  }

  function position(st) {
    const r = st.browser.getBoundingClientRect();
    st.ui.pill.style.left = Math.round(r.left + (r.width - 480) / 2) + "px";
    st.ui.pill.style.top = Math.round(r.top + 12) + "px";
  }

  const fmt = (n) => n.toLocaleString("en-US");
  function render(st) {
    if (!st.ui) return;
    const { count, prev, next, aa } = st.ui;
    let text = "";
    if (st.query) {
      if (st.result === NOTFOUND) text = "No matches";
      // total === -1 means the limit was hit. With subframes FinderParent ADDS the per-frame totals,
      // so a -1 from one frame plus 1 from another arrives as 0: treat anything <= 0 as "limit+".
      else if (st.total <= 0 && st.limit > 0) text = fmt(st.current || 1) + " of " + fmt(st.limit) + "+";
      else if (st.total > 0) text = fmt(st.current) + " of " + fmt(st.total);
    }
    count.textContent = text;
    count.classList.toggle("none", st.query !== "" && st.result === NOTFOUND);
    const off = !st.query || st.result === NOTFOUND;
    prev.disabled = next.disabled = off;
    aa.setAttribute("aria-pressed", String(st.matchCase));
  }

  function search(st, q) {
    const finder = st.browser.finder;
    st.query = q;
    if (!q) {
      st.result = null;
      st.current = st.total = 0;
      finder.removeSelection(); // also clears highlights
      finder.highlight(false, "", false);
      render(st);
      return;
    }
    finder.caseSensitive = st.matchCase;
    // doFind() also refreshes the highlights and the match count in every frame.
    finder.fastFind(q, false, false);
  }

  function step(st, backwards) {
    if (!st.query) return;
    st.browser.finder.findAgain(st.query, !!backwards, false, false);
  }

  function setMatchCase(st, on) {
    st.matchCase = on;
    if (st.query) search(st, st.query);
    render(st);
  }

  /** Open (or re-focus) find for a browser. opts: { query, host (element to mount a capsule in), prefill } */
  function open(browser = gBrowser.selectedBrowser, opts = {}) {
    const st = stateFor(browser);
    const finder = browser.finder;
    if (!st.open) {
      st.open = true;
      finder.addResultListener(st.listener);
      finder.onFindbarOpen();
      finder.onHighlightAllChange(true);
      // Content may have put itself in "pass keys to the findbar" mode on Ctrl+F; release it.
      try {
        browser.sendMessageToActor("Findbar:UpdateState", { findMode: 0, isOpenAndFocused: true, hasQuickFindTimeout: false }, "FindBar", "all");
      } catch (e) {}
    }
    if (!st.ui) buildUI(st, opts.host);
    st.ui.pill.hidden = false;
    active = st;
    const { field } = st.ui;
    const apply = (q) => {
      if (opts.search === false) {
        field.value = q || "";
        st.query = q || "";
      } else if (q != null && q !== "") {
        field.value = q;
        search(st, q);
      } else if (st.query) {
        field.value = st.query;
        search(st, st.query);
      }
      field.focus();
      field.select();
    };
    if (opts.query != null) apply(opts.query);
    else if (opts.prefill !== false) {
      // Pre-fill from the page selection (asks the focused frame), then fall back to the last query.
      field.focus();
      st.pendingPrefill = (text) => apply(text && !/\n/.test(text) && text.length <= 120 ? text : null);
      finder.getInitialSelection();
    } else apply(null);
    render(st);
    return st;
  }

  /** Close: highlights go, the active match stays selected and its link (if any) takes focus. */
  function close(browser = gBrowser.selectedBrowser, opts = {}) {
    const st = states.get(browser);
    if (!st || !st.open) return;
    st.open = false;
    const finder = browser.finder;
    finder.removeResultListener(st.listener);
    if (opts.clearSelection) finder.removeSelection();
    if (opts.activate) {
      // Ctrl+Enter: Finder clicks the link the active match is in (content side, Finder.keyPress).
      finder.keyPress({ keyCode: KeyboardEvent.DOM_VK_RETURN, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false });
    }
    finder.focusContent(); // browser.focus() + focus the found link / editable in content
    finder.onFindbarClose(); // enableSelection + remove highlights + scrollbar marks
    if (st.ui) {
      st.ui.pill.hidden = true;
      if (st.ui.host) {
        // A capsule lives inside someone else's header: remove it and tell the host.
        st.ui.pill.remove();
        st.ui.host.dispatchEvent(new CustomEvent("vitre-find-closed", { bubbles: true }));
        st.ui = null;
      }
    }
    if (active === st) active = null;
    log("closed", JSON.stringify({ query: st.query, linkURL: st.linkURL }));
  }

  const hostFor = (b) => (window.VitrePeek && window.VitrePeek.findHost ? window.VitrePeek.findHost(b) : null);

  /** Called for cmd_find / cmd_findAgain / cmd_findPrevious / cmd_findSelection instead of the native findbar. */
  function command(cmd, arg) {
    const b = (window.VitrePeek && window.VitrePeek.activeBrowser && window.VitrePeek.activeBrowser()) || gBrowser.selectedBrowser;
    const st = stateFor(b);
    if (cmd === "onFindCommand") return open(b, { host: hostFor(b) });
    if (cmd === "onFindAgainCommand") {
      // F3 / Ctrl+G with find closed: reopen parked with the last query and step.
      // findAgain() with no previous hit behaves as a fresh find, so one call is enough.
      if (!st.open) open(b, { query: st.query || "", prefill: false, search: false, host: hostFor(b) });
      return step(st, !!arg);
    }
    if (cmd === "onFindSelectionCommand") return open(b);
    return undefined;
  }

  function install() {
    // 1. Every find command in browser.xhtml funnels through gLazyFindCommand, which is what creates
    //    the native <findbar>. Replace it.
    window.gLazyFindCommand = async (cmd, ...args) => command(cmd, ...args);
    // 2. Quick find ("/" and "'") and find-as-you-type start in the content process and would create
    //    the native findbar through FindBarParent. Turn them off.
    Services.prefs.setBoolPref("accessibility.typeaheadfind", false);
    Services.prefs.setBoolPref("accessibility.typeaheadfind.manual", false);
    Services.prefs.setBoolPref("accessibility.typeaheadfind.enablesound", false);
    // 3. Content also watches for the find shortcut itself and then swallows keypresses until the
    //    native findbar reports it is focused. Give it a shortcut that can never match.
    Services.ppmm.sharedData.set("Findbar:Shortcut", { key: "￿", shiftKey: true, ctrlKey: true, altKey: true, metaKey: true });
    Services.ppmm.sharedData.flush();
    // 4. Highlight every match, and use the design's colours (Chromium's yellow / orange, black text).
    Services.prefs.setBoolPref("findbar.highlightAll", true);
    Services.prefs.setStringPref("ui.textHighlightBackground", "#ffff00");
    Services.prefs.setStringPref("ui.textHighlightForeground", "#000000");
    Services.prefs.setStringPref("ui.textSelectAttentionBackground", "#ff9632");
    Services.prefs.setStringPref("ui.textSelectAttentionForeground", "#000000");
    window.addEventListener("resize", () => active && !active.ui.host && position(active));
  }

  /** Demo of the landing ring: st.rect is in CSS px relative to the top document's origin. */
  function ring(st, scrollX, scrollY) {
    for (const r of document.querySelectorAll(".vf-ring")) r.remove();
    if (!st.rect) return null;
    const br = st.browser.getBoundingClientRect();
    const d = el("div", "vf-ring");
    const box = { left: br.left + st.rect.x - scrollX - 3, top: br.top + st.rect.y - scrollY - 3, width: st.rect.w + 6, height: st.rect.h + 6 };
    for (const k in box) d.style[k] = box[k] + "px";
    document.body.appendChild(d);
    return box;
  }

  return { install, open, close, command, stateFor, step: (b, back) => step(stateFor(b), back), setMatchCase: (b, on) => setMatchCase(stateFor(b), on), ring, get active() { return active; } };
})();
