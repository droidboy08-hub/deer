// Omnibox data sources for Vitre on Gecko (spike prototype, meant to be lifted into the app).
//   suggest(text)            history (Places SQL) + open tabs, shaped like app/src/renderer/omnibox.ts rows
//   suggestViaUrlbar(text)   the same question asked to Firefox's own urlbar providers, headless
//   removeFromHistory(url)   Shift+Delete
//   engines(), searchURL(), searchSuggestions()
//   resolveInput(text), canonize(text), go(text, where), switchToTab(url)
/* global window, gBrowser, Services, Ci, ChromeUtils */
window.VitreOmniboxData = (() => {
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  // Firefox 157 has no Services.search: the search service is a plain ES module.
  const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
  const strip = (url) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  const likeEscape = (s) => s.replace(/[%_/]/g, "/$&");

  // ---- open tabs ---------------------------------------------------------------------------
  function openTabs(tokens, { allWindows = true } = {}) {
    const out = [];
    const wins = allWindows ? [...Services.wm.getEnumerator("navigator:browser")] : [window];
    for (const win of wins) {
      for (const tab of win.gBrowser.tabs) {
        if (win === window && tab === gBrowser.selectedTab) continue; // never offer the tab you are on
        const url = tab.linkedBrowser.currentURI.spec;
        if (url === "about:blank") continue;
        const title = tab.label || "";
        const hay = (strip(url) + " " + title).toLowerCase();
        if (tokens.every((t) => hay.includes(t))) out.push({ kind: "switch", title, url, tab, window: win, lastAccessed: tab.lastAccessed });
      }
    }
    return out.sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  // ---- history (Places) --------------------------------------------------------------------
  /**
   * Frecency-ranked history matches. Every token must appear in the URL or the title.
   * An empty text lists the most recent visits (Ctrl+H).
   * Uses the read-only connection the address bar itself queries, so typing never blocks writes.
   */
  async function history(text, limit = 8) {
    const db = await PlacesUtils.promiseLargeCacheDBConnection();
    const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const params = { limit };
    const where = ["h.hidden = 0", "h.last_visit_date NOT NULL"];
    tokens.forEach((t, i) => {
      params["t" + i] = "%" + likeEscape(t) + "%";
      where.push("(h.url LIKE :t" + i + " ESCAPE '/' OR IFNULL(h.title, '') LIKE :t" + i + " ESCAPE '/')");
    });
    let order = "h.last_visit_date DESC";
    if (tokens.length) {
      // What you are typing is usually the start of a host: those rows first, then by frecency.
      // (Sqlite.sys.mjs refuses a LIKE whose right-hand side is not a bare binding.)
      const p = likeEscape(tokens[0]) + "%";
      Object.assign(params, { p0: "https://" + p, p1: "https://www." + p, p2: "http://" + p, p3: "http://www." + p });
      order = "(CASE WHEN h.url LIKE :p0 ESCAPE '/' OR h.url LIKE :p1 ESCAPE '/' OR h.url LIKE :p2 ESCAPE '/' OR h.url LIKE :p3 ESCAPE '/' THEN 0 ELSE 1 END), h.frecency DESC, h.last_visit_date DESC";
    }
    const rows = await db.executeCached(
      "SELECT h.url, h.title, h.frecency, h.visit_count, h.last_visit_date FROM moz_places h WHERE " + where.join(" AND ") + " ORDER BY " + order + " LIMIT :limit",
      params
    );
    return rows.map((r) => ({
      kind: "history",
      url: r.getResultByName("url"),
      title: r.getResultByName("title") || "",
      frecency: r.getResultByName("frecency"),
      visits: r.getResultByName("visit_count"),
      lastVisit: r.getResultByName("last_visit_date") / 1000, // PRTime (microseconds) -> ms
      removable: true,
    }));
  }

  /** Rows for the suggestion panel: open tabs first ("Switch to tab"), then history. */
  async function suggest(text, { limit = 6 } = {}) {
    const tokens = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tabs = tokens.length ? openTabs(tokens).slice(0, 3) : [];
    const open = new Set(tabs.map((t) => t.url));
    const hist = (await history(text, limit + tabs.length)).filter((h) => !open.has(h.url));
    return [...tabs, ...hist].slice(0, limit);
  }

  function removeFromHistory(url) {
    return PlacesUtils.history.remove(url); // Promise<boolean>: true if something was removed
  }

  // ---- Firefox's own urlbar providers, headless ---------------------------------------------
  async function suggestViaUrlbar(text, { limit = 8, isPrivate = false, onPartial = null } = {}) {
    const { UrlbarQueryContext } = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarQueryContext.mjs");
    const { ProvidersManager } = ChromeUtils.importESModule("moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs");
    const { UrlbarShared } = ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
    const TYPE = Object.fromEntries(Object.entries(UrlbarShared.RESULT_TYPE).map(([k, v]) => [v, k]));
    const context = new UrlbarQueryContext({ sapName: "urlbar", searchString: text, isPrivate, maxResults: limit, allowAutofill: true });
    const shape = () => (context.results || []).map((r) => ({
      kind: { TAB_SWITCH: "switch", URL: "history", SEARCH: "search" }[TYPE[r.type]] || TYPE[r.type],
      heuristic: !!r.heuristic,
      title: r.payload.title || r.payload.suggestion || r.payload.query || "",
      url: r.payload.url || "",
      query: r.payload.suggestion || r.payload.query || "",
      engine: r.payload.engine || "",
      autofill: r.autofill ? r.autofill.value : "",
      provider: r.providerName,
    }));
    const controller = onPartial ? { receiveResults: () => onPartial(shape()) } : null;
    await ProvidersManager.getInstanceForSap("urlbar").startQuery(context, controller);
    return shape();
  }

  // ---- search engines ----------------------------------------------------------------------
  async function engines() {
    await SearchService.promiseInitialized;
    const def = await SearchService.getDefault();
    const list = await SearchService.getVisibleEngines();
    return list.map((e) => ({ name: e.name, id: e.id, alias: (e.aliases && e.aliases[0]) || e.alias || "", isDefault: e === def }));
  }
  /** Search results URL for the words, on the named engine or the default one. */
  function searchURL(words, engineName) {
    const engine = engineName ? SearchService.getEngineByName(engineName) : SearchService.defaultEngine;
    return engine.getSubmission(words.trim()).uri.spec;
  }
  async function searchSuggestions(words, max = 6) {
    const { SearchSuggestionController } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchSuggestionController.sys.mjs");
    const c = new SearchSuggestionController();
    const r = await c.fetch({ searchString: words, inPrivateBrowsing: false, engine: SearchService.defaultEngine, maxLocalResults: 0, maxRemoteResults: max });
    return (r && r.remote ? r.remote : []).map((s) => s.value);
  }

  // ---- typed input -> address or search -----------------------------------------------------
  /** { kind: "url" | "search", url, engine?, schemeless } for what the user typed. */
  function resolveInput(text) {
    const t = text.trim();
    if (!t) return null;
    const F = Services.uriFixup;
    try {
      const info = F.getFixupURIInfo(t, F.FIXUP_FLAG_FIX_SCHEME_TYPOS | F.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP);
      const uri = info.preferredURI;
      if (uri) {
        if (info.keywordProviderId) return { kind: "search", url: uri.spec, engine: SearchService.getEngineById(info.keywordProviderId).name, words: info.keywordAsSent };
        if (uri.schemeIs("javascript") || uri.schemeIs("data")) return { kind: "search", url: searchURL(t), engine: SearchService.defaultEngine.name, words: t };
        return { kind: "url", url: uri.spec, schemeless: info.schemelessInput === Ci.nsILoadInfo.SchemelessInputTypeSchemeless, protocolAdded: info.fixupChangedProtocol };
      }
    } catch (e) { /* malformed: fall through to a search */ }
    return { kind: "search", url: searchURL(t), engine: SearchService.defaultEngine.name, words: t };
  }
  /** Ctrl+Enter: add www. and .com to a bare word. */
  function canonize(text) {
    const t = text.trim();
    if (!t || /\s/.test(t) || /^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    const m = /^([^/?#]+)(.*)$/.exec(t);
    let host = m[1];
    if (!host.includes(".")) host = "www." + host + ".com";
    return "https://" + host + (m[2] || "/");
  }

  // ---- loading -----------------------------------------------------------------------------
  /** where: "current" | "tab" (new foreground tab) | "tabshifted" (new background tab) | "window" */
  function go(text, where = "current") {
    const r = typeof text === "string" ? resolveInput(text) : text;
    if (!r) return null;
    window.openTrustedLinkIn(r.url, where, {
      allowInheritPrincipal: false, // a typed address never runs with the previous page's principal
      schemelessInput: r.schemeless ? Ci.nsILoadInfo.SchemelessInputTypeSchemeless : Ci.nsILoadInfo.SchemelessInputTypeSchemeful,
    });
    return r;
  }
  function switchToTab(url) {
    return window.switchToTabHavingURI(url, false, { ignoreFragment: "whenComparing" });
  }

  return { openTabs, history, suggest, suggestViaUrlbar, removeFromHistory, engines, searchURL, searchSuggestions, resolveInput, canonize, go, switchToTab, strip };
})();
