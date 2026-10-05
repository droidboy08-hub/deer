// Vitre keyboard layer for the Gecko chrome window (spike prototype, meant to be lifted into the app).
//
//   VitreKeys.neutralise()                 - make Firefox's own shortcuts inert (keysets + built-ins)
//   VitreKeys.install({ onAction, log })   - route keys per design/keymap.json
//   VitreKeys.BINDINGS / match / chord     - the map (port of app/src/shared/shortcuts.ts)
//
// Routing model on Gecko (all proven by the scripts in this folder: 01-explore, 02-neutralise, 03-routing):
//   * A key aimed at a remote page is dispatched in the chrome document FIRST (target = the <browser>),
//     and only afterwards forwarded to the content process. A chrome listener that calls
//     preventDefault() stops the forwarding: that is "browser-first".
//   * A chrome listener can call event.requestReplyFromRemoteContent(). After the page has handled
//     the key, the same event is dispatched in chrome a second time with
//     event.isReplyEventFromRemoteContent === true, and defaultPrevented tells whether the page
//     (or a default action in the page, e.g. the editor) consumed it: that is "page-first".
//   * Vitre decides page-first keys on the KEYPRESS reply, exactly as Firefox's own <key> elements
//     do. keydown.preventDefault() in the page suppresses the keypress, so no reply ever comes;
//     keypress.preventDefault() or a consuming default action comes back as defaultPrevented.
/* global window, document, gBrowser, Services, MutationObserver */
window.VitreKeys = (() => {
  // ------------------------------------------------------------------------------------------
  // The map. priority "browser": pages never get the key. "page": the page gets it first.
  // repeat: true -> auto-repeat allowed (anything that closes/opens/toggles ignores repeat).
  // ------------------------------------------------------------------------------------------
  const B = (action, spec, priority, extra = {}) => {
    const parts = spec.split("+");
    const key = parts.pop();
    return Object.assign({ action, spec, key, ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), priority }, extra);
  };
  const DEFAULTS = [
    B("newTab", "Ctrl+T", "browser", { repeat: true }),
    B("closeTab", "Ctrl+W", "browser"),
    B("closeTab", "Ctrl+F4", "browser"),
    B("reopenClosed", "Ctrl+Shift+T", "browser"),
    B("newWindow", "Ctrl+N", "browser"),
    B("closeWindow", "Ctrl+Shift+W", "browser"),
    B("switcherNext", "Ctrl+Tab", "browser", { repeat: true }),
    B("switcherPrev", "Ctrl+Shift+Tab", "browser", { repeat: true }),
    B("nextTab", "Ctrl+PageDown", "browser", { repeat: true }),
    B("prevTab", "Ctrl+PageUp", "browser", { repeat: true }),
    B("focusCycle", "F6", "browser"),
    B("focusCycleBack", "Shift+F6", "browser"),
    B("back", "BrowserBack", "browser"),
    B("forward", "BrowserForward", "browser"),
    B("reload", "BrowserRefresh", "browser"),
    B("stop", "BrowserStop", "browser"),
    B("focusAddress", "BrowserSearch", "browser"),
    B("goHome", "BrowserHome", "browser"),

    B("focusAddress", "Ctrl+L", "page"),
    B("focusAddress", "Alt+D", "page"),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => B("goTab", "Ctrl+" + n, "page", { arg: n })),
    B("goLastTab", "Ctrl+9", "page"),
    B("moveTabLeft", "Ctrl+Shift+PageUp", "page", { repeat: true }),
    B("moveTabRight", "Ctrl+Shift+PageDown", "page", { repeat: true }),
    B("fullscreen", "F11", "page"),
    B("back", "Alt+Left", "page", { repeat: true }),
    B("forward", "Alt+Right", "page", { repeat: true }),
    B("reload", "Ctrl+R", "page"),
    B("reload", "F5", "page"),
    B("hardReload", "Ctrl+Shift+R", "page"),
    B("hardReload", "Ctrl+F5", "page"),
    B("hardReload", "Shift+F5", "page"),
    B("escape", "Escape", "page"),
    Object.assign(B("zoomIn", "Ctrl+Plus", "page", { repeat: true }), { shift: "any" }),
    Object.assign(B("zoomIn", "Ctrl+Equal", "page", { repeat: true }), { shift: "any" }),
    B("zoomOut", "Ctrl+Minus", "page", { repeat: true }),
    B("zoomReset", "Ctrl+0", "page"),
    B("zoomReset", "Ctrl+Num0", "page"),
    B("devtools", "F12", "page"),
    B("devtools", "Ctrl+Shift+I", "page"),
    B("devtoolsConsole", "Ctrl+Shift+J", "page"),
    B("devtoolsInspect", "Ctrl+Shift+C", "page"),
    B("print", "Ctrl+P", "page"),
    B("savePage", "Ctrl+S", "page"),
    B("viewSource", "Ctrl+U", "page"),
    B("history", "Ctrl+H", "page"),
    B("find", "Ctrl+F", "page"),
    B("findNext", "F3", "page", { repeat: true }),
    B("findPrev", "Shift+F3", "page", { repeat: true }),
    B("findNext", "Ctrl+G", "page", { repeat: true }),
    B("findPrev", "Ctrl+Shift+G", "page", { repeat: true }),
    B("peekLink", "Ctrl+Q", "page"),
    B("openAsTab", "Alt+Enter", "page"),
    B("downloads", "Ctrl+J", "page"),
    B("downloadVideo", "Ctrl+Shift+D", "page"),
    B("settings", "Ctrl+Comma", "page"),
    B("shortcutsHelp", "F1", "page"),
    B("clearData", "Ctrl+Shift+Delete", "page"),
    B("switcherSearch", "Ctrl+Shift+A", "page"),
  ];
  const BINDINGS = DEFAULTS.map((b) => Object.assign({}, b));
  /** Only Vitre's own verbs can be rebound (Settings > Keyboard shortcuts). */
  const REBINDABLE = ["peekLink", "openAsTab", "switcherSearch", "downloadVideo"];
  function applyRebind(rebind) {
    BINDINGS.length = 0;
    for (const d of DEFAULTS) {
      const spec = rebind && REBINDABLE.includes(d.action) ? rebind[d.action] : undefined;
      BINDINGS.push(spec ? Object.assign(B(d.action, spec, d.priority), { arg: d.arg, repeat: d.repeat }) : Object.assign({}, d));
    }
  }

  /**
   * VERIFIER FIX of keyName(): letters by VIRTUAL KEY (event.keyCode), not "label, else physical code".
   * On Windows Gecko's keyCode for a letter key is the layout's VK (A-Z = 65-90): it follows the
   * label on QWERTZ/AZERTY/Dvorak and stays Latin on Cyrillic/Greek/Hebrew layouts, which is exactly
   * the rule in keymap.json. The original fell back to event.code whenever event.key was not a
   * Latin letter, so punctuation that sits on a letter position was read as that letter:
   * Dvorak Ctrl+, (physical W) ran closeTab; AZERTY Ctrl+, (physical M) never opened Settings.
   * Comma is matched by VK_OEM_COMMA (keyCode 188) so it also works on layouts whose comma key
   * types another character (Russian).
   */
  function keyName(e) {
    switch (e.key) { // zoom wins where any key types - or + on the active layout
      case "+": return "Plus";
      case "-": case "_": return "Minus";
    }
    const kc = e.keyCode;
    if (kc >= 65 && kc <= 90) return String.fromCharCode(kc);
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) return digit[1];
    switch (e.code) {
      case "NumpadAdd": return "Plus";
      case "NumpadSubtract": return "Minus";
      case "Numpad0": return "Num0";
    }
    if (kc === 188) return "Comma";
    switch (e.key) {
      case "=": return "Equal";
      case "ArrowLeft": return "Left";
      case "ArrowRight": return "Right";
      case "ArrowUp": return "Up";
      case "ArrowDown": return "Down";
    }
    if (!kc && /^Key[A-Z]$/.test(e.code)) return e.code[3]; // no virtual key at all (some virtual keyboards)
    return e.key;
  }
  /** IME / AltGr / Win-key guards: true means "no Vitre shortcut may fire on this event". */
  function guarded(e) {
    if (e.isComposing || e.keyCode === 229 || e.key === "Process") return "ime";
    if (e.getModifierState("AltGraph")) return "altgr";
    if (e.ctrlKey && e.altKey) return "ctrl+alt";
    if (e.metaKey) return "win";
    return null;
  }
  /** The binding for this event, ignoring repeat (the caller decides what a repeat does). */
  function match(e) {
    if (guarded(e)) return null;
    const name = keyName(e);
    for (const b of BINDINGS) {
      if (b.key !== name) continue;
      if (b.ctrl !== e.ctrlKey) continue;
      if (b.alt !== e.altKey) continue;
      if (b.shift !== "any" && b.shift !== e.shiftKey) continue;
      return b;
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------
  // 1. Neutralise Firefox
  // ------------------------------------------------------------------------------------------
  /** Prefs that turn off built-ins which are not <key> elements. Put these in the app's default prefs. */
  const PREFS = {
    "ui.key.menuAccessKeyFocuses": false, // tapping Alt must not show/focus the Firefox menu bar
    "ui.key.menuAccessKey": 0, // Alt+F/E/V... must not open Firefox menus
    "accessibility.browsewithcaret_shortcut.enabled": false, // F7
    "accessibility.typeaheadfind": false, // type-to-find
    "accessibility.typeaheadfind.manual": false, // "/" and "'" quick find
    "browser.backspace_action": 2, // Backspace is not Back
    "browser.ctrlTab.sortByRecentlyUsed": false, // Firefox's own Ctrl+Tab panel
    "ui.key.contentAccess": 4, // page accesskeys on Alt+letter, as in Chrome/Edge (Firefox default is Alt+Shift)
  };
  let observer = null;
  function neutralise({ keepExtensionKeysets = true, setPrefs = true, log = () => {} } = {}) {
    if (setPrefs) {
      for (const [k, v] of Object.entries(PREFS)) {
        if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
        else Services.prefs.setIntPref(k, v);
      }
    }
    // <key> elements only work inside a <keyset>. Park them in a plain hidden box: every
    // document.getElementById("key_...") in Firefox's code still resolves, menus can still read
    // them, but Gecko no longer listens for them. The (now empty) keysets stay in place because
    // Firefox code inserts next to #mainKeyset (DevToolsStartup.hookKeyShortcuts).
    let grave = document.getElementById("vitre-dead-keys");
    if (!grave) {
      grave = document.createXULElement("box");
      grave.id = "vitre-dead-keys";
      grave.hidden = true;
      document.getElementById("mainKeyset").parentNode.appendChild(grave);
    }
    const strip = (keyset) => {
      if (keepExtensionKeysets && keyset.id.startsWith("ext-keyset-id-")) return 0;
      const keys = [...keyset.querySelectorAll("key")];
      if (!keys.length) return 0;
      for (const key of keys) grave.appendChild(key);
      // Gecko caches a keyset's handlers when it is bound to the tree: re-bind it to drop them.
      const parent = keyset.parentNode;
      const next = keyset.nextSibling;
      keyset.remove();
      parent.insertBefore(keyset, next);
      return keys.length;
    };
    let n = 0;
    for (const ks of [...document.querySelectorAll("keyset")]) {
      if (ks.parentNode.closest("keyset")) continue; // nested keysets go with their parent
      const c = strip(ks);
      if (c) log("stripped keyset #" + ks.id + ": " + c + " keys");
      n += c;
    }
    // Keysets added later (DevTools on first use, extensions, CustomKeys) get the same treatment.
    if (!observer) {
      observer = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.localName === "keyset") {
              const c = strip(node);
              if (c) log("stripped late keyset #" + node.id + ": " + c + " keys");
            }
          }
        }
      });
      observer.observe(document.getElementById("mainKeyset").parentNode, { childList: true });
      if (document.documentElement !== document.getElementById("mainKeyset").parentNode) {
        observer.observe(document.documentElement, { childList: true });
      }
    }
    return n;
  }

  // ------------------------------------------------------------------------------------------
  // 2. Router
  // ------------------------------------------------------------------------------------------
  const st = {
    installed: false,
    onAction: null,
    log: null,
    hideFromSystemGroup: new WeakSet(), // events Firefox's system-group listeners must not see
    swallowUp: new Set(), // codes whose keyup must not reach the page (their keydown did not)
    acted: new Set(), // codes whose keydown Vitre took: later keypress events are dead
    ctrlHeld: false,
    onCtrlUp: null,
    filter: null, // optional (binding, event) => false to let a key through untouched
    priorityOf: null, // optional (binding, event) => "browser" | "page" | undefined: state-dependent priority
    prio: new Map(), // code -> priority decided on the keydown, reused for its keypress
    bind: new Map(), // VERIFIER FIX: code -> binding matched on the keydown (keypress has keyCode 0, so it cannot be re-matched by virtual key)
  };
  const codeOf = (e) => e.code || e.key;
  /** F11 leaves full screen browser-first, the second Esc on a peek is browser-first, etc. */
  const priority = (b, e) => (st.priorityOf && st.priorityOf(b, e)) || b.priority;
  const say = (...a) => st.log && st.log(...a);
  const isRemote = (e) => !!(e.target && e.target.isRemoteBrowser === true);

  function run(b, e, how) {
    say("ACTION " + b.action + (b.arg !== undefined ? "(" + b.arg + ")" : "") + " via " + b.spec + " [" + how + "]" + (e.repeat ? " repeat" : ""));
    if (st.onAction) st.onAction(b.action, b.arg, { binding: b, event: e, how });
  }
  function take(e) {
    e.preventDefault(); // chrome preventDefault also stops forwarding to the content process
    e.stopPropagation();
    st.hideFromSystemGroup.add(e);
  }

  function onKeyDown(e) {
    if (!e.isTrusted) return;
    if (e.key === "Control") st.ctrlHeld = true;
    const b = match(e);
    if (!b || (st.filter && st.filter(b, e) === false)) { st.bind.delete(codeOf(e)); return; }
    const pr = e.repeat && st.prio.has(codeOf(e)) ? st.prio.get(codeOf(e)) : priority(b, e);
    st.prio.set(codeOf(e), pr);
    st.bind.set(codeOf(e), b);
    if (pr === "browser") {
      take(e);
      st.swallowUp.add(codeOf(e));
      st.acted.add(codeOf(e));
      if (!e.repeat || b.repeat) run(b, e, "browser-first");
      return;
    }
    // Page-first. Nothing happens on keydown: the decision is made on keypress (see below). Only
    // hide the first pass from Firefox's own keydown handlers (tabbrowser moves tabs on
    // Ctrl+Shift+PageUp/Down at once, without asking the page).
    st.hideFromSystemGroup.add(e);
  }

  function onKeyPress(e) {
    if (!e.isTrusted) return;
    if (st.acted.has(codeOf(e))) { take(e); return; } // (never seen in practice: a prevented keydown has no keypress)
    const b = guarded(e) ? null : st.bind.get(codeOf(e));
    if (!b || (st.prio.get(codeOf(e)) || b.priority) !== "page" || (st.filter && st.filter(b, e) === false)) return;
    if (isRemote(e)) {
      if (!e.isReplyEventFromRemoteContent) {
        e.requestReplyFromRemoteContent(); // ask Gecko to hand the key back once the page is done
        st.hideFromSystemGroup.add(e);
        return;
      }
      // Second pass: the page (and its default actions) had the key.
      if (e.defaultPrevented) { say("page kept " + b.spec); st.hideFromSystemGroup.add(e); return; }
      take(e);
      if (!e.repeat || b.repeat) run(b, e, "page-first/reply");
      return;
    }
    // Focus is in Vitre's own UI or an in-process page: decided in the bubble listener below.
  }
  function onKeyPressBubble(e) {
    if (!e.isTrusted || e.defaultPrevented || isRemote(e)) return;
    const b = guarded(e) ? null : st.bind.get(codeOf(e));
    if (!b || (st.prio.get(codeOf(e)) || b.priority) !== "page" || (st.filter && st.filter(b, e) === false)) return;
    e.preventDefault();
    if (!e.repeat || b.repeat) run(b, e, "page-first/local");
  }

  function onKeyUp(e) {
    if (!e.isTrusted) return;
    st.acted.delete(codeOf(e));
    // VERIFIER FIX: st.prio / st.bind are NOT cleared here. The keypress REPLY from the page can
    // arrive after the keyup's first pass (always, with synthesized keys), and it still needs the
    // decision made on the keydown. The next keydown of the same key overwrites or deletes them.
    if (st.swallowUp.delete(codeOf(e))) { take(e); }
    if (e.key === "Control") {
      st.ctrlHeld = false;
      if (st.onCtrlUp) st.onCtrlUp(e);
    }
  }
  function onSystemCapture(e) {
    if (st.hideFromSystemGroup.has(e)) e.stopPropagation();
  }

  function install({ onAction, log, onCtrlUp, filter, priorityOf } = {}) {
    st.priorityOf = priorityOf || null;
    st.onAction = onAction || null;
    st.log = log || null;
    st.onCtrlUp = onCtrlUp || null;
    st.filter = filter || null;
    if (st.installed) return;
    st.installed = true;
    // Default group, capture, on the window: runs before every other listener in the chrome
    // document and before the key is forwarded to a remote page.
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keypress", onKeyPress, true);
    window.addEventListener("keyup", onKeyUp, true);
    // System group, capture, on the window: runs before Firefox's own system-group handlers
    // (tabbrowser, tabbox, XUL <key> listener, menu bar). Stopping here does NOT stop forwarding
    // to the page and does not affect the reply.
    for (const t of ["keydown", "keypress", "keyup"]) {
      window.addEventListener(t, onSystemCapture, { capture: true, mozSystemGroup: true });
    }
    // System group, bubble: after local widgets and the editor had their turn.
    window.addEventListener("keypress", onKeyPressBubble, { mozSystemGroup: true });
    window.addEventListener("deactivate", () => { st.swallowUp.clear(); st.acted.clear(); st.prio.clear(); st.bind.clear(); if (st.ctrlHeld) { st.ctrlHeld = false; if (st.onCtrlUp) st.onCtrlUp(null); } });
  }

  return { BINDINGS, DEFAULTS, REBINDABLE, PREFS, applyRebind, keyName, guarded, match, neutralise, install, state: st };
})();
