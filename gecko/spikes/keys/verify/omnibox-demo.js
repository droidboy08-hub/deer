// A small working omnibox for the spike: a floating HTML field in the chrome document with live
// history + open-tab suggestions. Needs vitre-omnibox-data.js. Not the final design, only the
// mechanics (focus, keys, data, loading) the real pill will use.
/* global window, document, gBrowser, Services, VitreOmniboxData */
window.OmniDemo = (() => {
  const H = "http://www.w3.org/1999/xhtml";
  const el = (tag, cls, text) => { const e = document.createElementNS(H, tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

  const style = el("style");
  style.textContent = `
    #vitre-omni { position: fixed; left: 0; right: 0; top: 108px; z-index: 2147483000; display: flex; flex-direction: column; align-items: center; pointer-events: none; font: 14px/1.3 "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1c1c1e; }
    #vitre-omni[hidden] { display: none; }
    #vitre-omni .field { pointer-events: auto; box-sizing: border-box; width: min(640px, calc(100vw - 48px)); height: 48px; border-radius: 24px; display: flex; align-items: center; padding: 0 20px; background: rgba(250, 250, 252, 0.86); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid rgba(255, 255, 255, 0.7); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 12px 36px rgba(0, 0, 0, 0.22); }
    #vitre-omni input { all: unset; flex: 1; min-width: 0; font: 15px "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1c1c1e; }
    #vitre-omni input::selection { background: rgba(10, 100, 255, 0.28); color: inherit; }
    #vitre-omni .panel { pointer-events: auto; box-sizing: border-box; width: min(640px, calc(100vw - 48px)); margin-top: 8px; padding: 6px; border-radius: 18px; background: rgba(250, 250, 252, 0.9); backdrop-filter: blur(28px) saturate(1.6); border: 1px solid rgba(255, 255, 255, 0.7); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.16), 0 16px 44px rgba(0, 0, 0, 0.22); }
    #vitre-omni .panel[hidden] { display: none; }
    #vitre-omni .row { display: flex; align-items: baseline; gap: 10px; height: 36px; line-height: 36px; padding: 0 14px; border-radius: 12px; white-space: nowrap; overflow: hidden; }
    #vitre-omni .row.sel { background: rgba(0, 0, 0, 0.07); }
    #vitre-omni .row .t { overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; }
    #vitre-omni .row .d { color: rgba(60, 60, 67, 0.62); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; flex: 1 1 0; }
    #vitre-omni .row .k { color: rgba(60, 60, 67, 0.62); font-size: 12px; flex: none; }
  `;
  document.documentElement.appendChild(style);
  const root = el("div"); root.id = "vitre-omni"; root.hidden = true;
  const field = el("div", "field");
  const input = el("input"); input.id = "vitre-omni-input"; input.setAttribute("spellcheck", "false"); input.setAttribute("autocomplete", "off");
  const panel = el("div", "panel"); panel.hidden = true;
  field.appendChild(input); root.appendChild(field); root.appendChild(panel);
  document.body.appendChild(root);

  const st = { open: false, rows: [], sel: -1, moved: false, original: "", token: 0, log: null, events: [] };
  const note = (m) => { st.events.push(m); if (st.log) st.log("omni: " + m); };

  function paint() {
    panel.textContent = "";
    panel.hidden = st.rows.length === 0;
    st.rows.forEach((r, i) => {
      const row = el("div", "row" + (i === st.sel ? " sel" : ""));
      row.appendChild(el("span", "t", r.title || VitreOmniboxData.strip(r.url)));
      row.appendChild(el("span", "d", r.kind === "search" ? "" : VitreOmniboxData.strip(r.url)));
      row.appendChild(el("span", "k", { switch: "Switch to tab", history: "", search: "Search", url: "" }[r.kind] || ""));
      row.addEventListener("mousedown", (e) => { e.preventDefault(); st.sel = i; choose(e.altKey ? "tab" : "current"); });
      panel.appendChild(row);
    });
  }
  async function refresh() {
    const token = ++st.token;
    const text = input.value;
    const rows = await VitreOmniboxData.suggest(text === st.original ? "" : text, { limit: 6 });
    if (token !== st.token || !st.open) return; // a newer keystroke won
    const typed = text.trim() && text !== st.original ? VitreOmniboxData.resolveInput(text) : null;
    st.rows = typed ? [{ kind: typed.kind, title: typed.kind === "search" ? text.trim() : typed.url, url: typed.url, typed: true }, ...rows] : rows;
    st.sel = typed ? 0 : -1;
    st.moved = false;
    paint();
  }

  /** Vitre's field owns focus: used to stop Firefox's tab-switch code from blurring it. */
  const ownsFocus = () => st.open;

  function open({ query } = {}) {
    const url = gBrowser.currentURI.spec;
    st.original = query !== undefined ? query : (url === "about:blank" ? "" : url);
    input.value = st.original;
    root.hidden = false;
    st.open = true;
    input.focus(); // Services.focus.setFocus(input, 0) is equivalent
    input.select();
    note("open value=" + JSON.stringify(input.value));
    refresh();
  }
  function close({ focusPage = true } = {}) {
    if (!st.open) return;
    st.open = false;
    st.token++;
    root.hidden = true;
    st.rows = [];
    panel.hidden = true;
    note("close focusPage=" + focusPage);
    if (focusPage) gBrowser.selectedBrowser.focus(); // hands keyboard focus back to the remote page
  }
  function choose(where) {
    const row = st.sel >= 0 ? st.rows[st.sel] : null;
    const text = input.value;
    close({ focusPage: false });
    if (row && row.kind === "switch" && where === "current") {
      note("switch to tab " + row.url);
      row.window.gBrowser.selectedTab = row.tab;
      row.window.focus();
      gBrowser.selectedBrowser.focus();
      return;
    }
    const target = row && !row.typed ? { kind: "url", url: row.url } : VitreOmniboxData.resolveInput(text);
    if (!target) { gBrowser.selectedBrowser.focus(); return; }
    note("go " + where + " " + target.url);
    VitreOmniboxData.go(target, where); // openTrustedLinkIn focuses the content area itself
    gBrowser.selectedBrowser.focus();
  }

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && plain && !e.shiftKey) {
      e.preventDefault();
      if (!st.rows.length) return;
      const n = st.rows.length;
      st.sel = e.key === "ArrowDown" ? (st.sel + 1) % n : (st.sel - 1 + n) % n;
      st.moved = true;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.ctrlKey && !e.altKey && !e.shiftKey) { input.value = VitreOmniboxData.canonize(input.value); st.sel = -1; choose("current"); }
      else if (e.altKey && !e.ctrlKey) choose("tab");
      else if (e.shiftKey) { note("peek " + (st.sel >= 0 ? st.rows[st.sel].url : input.value)); }
      else { if (!st.moved && st.sel > 0) st.sel = 0; choose("current"); }
    } else if (e.key === "Delete" && e.shiftKey && !e.ctrlKey && !e.altKey) {
      // Remove a history suggestion, but only on a row the user moved onto; otherwise it stays Cut.
      const row = st.moved && st.sel >= 0 ? st.rows[st.sel] : null;
      if (row && row.kind === "history" && row.removable) {
        e.preventDefault();
        note("remove from history " + row.url);
        VitreOmniboxData.removeFromHistory(row.url).then(refresh);
      }
    } else if (e.key === "Escape" && plain && !e.shiftKey) {
      e.preventDefault(); // the router's page-first Esc must not also run
      if (e.repeat) return;
      if (input.value !== st.original || !panel.hidden) {
        input.value = st.original;
        input.select();
        st.token++;
        st.rows = []; st.sel = -1; paint();
        note("esc 1: address restored, suggestions closed");
      } else {
        note("esc 2: back to the page");
        close();
      }
    }
  });
  // Focus left the field for another element (a click in the page, a panel...): close.
  // When the whole window is deactivated the field stays document.activeElement, so switching
  // to another app does not close it.
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (st.open && document.activeElement !== input) { note("blur -> close"); close({ focusPage: false }); }
    }, 0);
  });

  return { open, close, choose, refresh, ownsFocus, input, panel, root, state: st, setLog: (f) => { st.log = f; } };
})();
