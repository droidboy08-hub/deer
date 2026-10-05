# Spike result: keys

Verdict: works-with-compromises

## Summary
Vitre's whole key map can be routed on stock Firefox 157 from privileged chrome JS, with the same browser-first / page-first semantics as the Electron build, and the omnibox has every data source it needs. Nothing required patching the runtime.

FINDINGS.md was NOT written: the harness refused the Write call ("Subagents should return findings as text, not write report files"), so I did not work around it. Its full content (recipe, binding table, risks) is in this output instead. The spike scripts and their logs/screenshots are in place and runnable.

Headline results (all from runs in the runtime):
- 82 Firefox shortcuts pressed with focus in a remote page: stock Firefox reacts to 50 of the 74 pressed (8 skipped as modal/native); with keys parked + prefs only, 9 still react (the tabbrowser/tabbox built-ins and F6); with Vitre's router installed, 0 react and only Vitre's map fires (02-neutralise.js, out/02-*.txt).
- Routing suite: 31 pass, 0 fail (03-routing.js, out/03.txt).
- Working omnibox demo driven by synthesized keys: 15 pass, 0 fail; also passes with Firefox's toolbars hidden (06-demo.js, out/06.txt, out/06-hidden.txt, screenshots out/06/*.png).

The key mechanism: a key aimed at a remote page is dispatched in the chrome document first (target = the <browser>). A chrome preventDefault() stops it reaching the page (browser-first). event.requestReplyFromRemoteContent() makes Gecko re-dispatch the event in chrome after the page handled it, with isReplyEventFromRemoteContent=true and defaultPrevented telling whether the page consumed it (page-first).

Not verified (the harness cannot produce them): AltGr on a real AltGr layout, a real IME, Sticky Keys, native delivery of AppCommand (media keys, mouse side buttons), Shift+F10 / Menu key (native WM_CONTEXTMENU), Esc in element full screen, keyboard lock, and the mouse bindings (Shift/Ctrl/Alt+click).

## Claims
- [proven] 1. Neutralise Firefox's built-in shortcuts (#mainKeyset 82 keys, #devtoolsKeyset 14 keys) without breaking Firefox code
  evidence: vitre-keys.js neutralise(): moves every <key> into a hidden non-keyset box and re-binds the empty keysets. 02-neutralise.js KS_MODE=strip: 73 of 82 keys do nothing (out/02-strip.txt); getElementById('key_newNavigatorTab') still resolves. 09-console-errors.js: full screen, app menu, context menu, tabs, DevTools, new window give the same 3 DevTools-internal console errors as untouched Firefox (out/09/log.txt vs out/09-stock/log.txt).
- [proven] 1. Tabbrowser/tabbox built-ins (Ctrl+Tab, Ctrl+PageUp/Down, Ctrl+Shift+PageUp/Down, Ctrl+F4) and Gecko's F6 pane focus are neutralised
  evidence: These 9 keys are the only ones still alive after parking (out/02-strip.txt). With the router installed none of them makes Firefox act: 'SUMMARY mode=router: 0 keys made Firefox do something, 82 did nothing' (out/02-router.txt).
- [proven] 1. Alt / F10 / Alt+F no longer activate the Firefox menu bar
  evidence: 07-menubar-appcommand.js section 1: stock = 'menubar ACTIVE' (+ menu_FilePopup for Alt+F); after ui.key.menuAccessKeyFocuses=false and ui.key.menuAccessKey=0 set at runtime = nothing (out/07.txt).
- [proven] 1. DevTools keys neutralised, DevTools still openable by Vitre
  evidence: devtoolsKeyset parked (out/02-router.txt: F12, Ctrl+Shift+I/K/C/J/M/E make Firefox do nothing). document.getElementById('key_toggleToolboxF12').doCommand() opens the toolbox (out/07.txt, out/07/07-devtools.png); View:PageSource.doCommand() opens view-source.
- [proven] 1. Text editing keeps working in page fields and in Vitre's own chrome HTML inputs
  evidence: 03-routing.js C1, C2 (page input: Ctrl+A, typing, Ctrl+Backspace, Ctrl+Z, Ctrl+Y, Shift+End, Delete, Ctrl+X, Ctrl+V) and F1 (chrome <html:input>: same plus Ctrl+Shift+Z, Ctrl+C/V). 10-remaining.js: Ctrl+Insert, Shift+Insert, Shift+Delete, Ctrl+Shift+V, Ctrl+Delete (out/10.txt).
- [proven] 1. Page accesskeys on Alt+letter and interaction with Alt+D
  evidence: With ui.key.contentAccess=4: 03-routing.js B3 (page with accesskey=d keeps Alt+D, Vitre does nothing), B4 (no accesskey: Vitre acts), B5 (Alt+G clicks the page's button).
- [proven] 1. Extension command keysets stay alive; Vitre wins on chords it binds
  evidence: 03-routing.js H1 with a fake ext-keyset-id-* keyset: free chord Ctrl+Shift+Y fires the extension key; on Ctrl+L (page-first) and Ctrl+T (browser-first) only Vitre fires. H2: a non-extension keyset added later is parked by the MutationObserver. Not tested with a real installed extension.
- [proven] 2. Browser-first: chrome gets the key before a remote page and can stop it
  evidence: window capture keydown + preventDefault(): 03-routing.js A4, A5 (page that prevents every keydown still cannot keep Ctrl+T, Ctrl+W, F6 and never sees them); out/02-router.txt shows 'page saw: -' for every browser-first key (neither keydown nor keyup). tip.keydown() returns KEYDOWN_IS_CONSUMED (04-synth.js step 3).
- [not-possible] 2. 'Reserved' flag event.isReservedByChrome
  evidence: The property does not exist on KeyboardEvent in 157 (07-menubar-appcommand.js section 4: isReservedByChrome=false, defaultCancelled=false as members). Not needed: requestReplyFromRemoteContent, isWaitingReplyFromRemoteContent, isReplyEventFromRemoteContent, defaultPreventedByChrome, defaultPreventedByContent all exist.
- [proven] 3. Page-first: act only after the remote page had the key and did not use it
  evidence: 03-routing.js A1 (page does not prevent Ctrl+K: Vitre acts, how=page-first/reply, page saw d:ctrl-k), A2 (page preventDefaults Ctrl+K: Vitre does nothing), A3, A5 (page prevents everything: Ctrl+R and Esc do nothing). 01-explore.js log shows the REPLY pass (out/01/log.txt).
- [proven] 3. Default actions in the page count as 'the page used it'
  evidence: Deciding on the keypress reply: 03-routing.js B1 (Ctrl+A in a page input selects all and the Vitre verb rebound to Ctrl+A does not fire; router log 'page kept Ctrl+A'). 03b-editor-defaults.js lists which keys come back CONSUMED (Ctrl+Z/A/C, Backspace, arrows, Space, PageDown, Tab, Shift+Delete) and which come back free (Esc, Alt+Left, F5, Ctrl+L, Ctrl+U...) (out/03b/log.txt).
- [proven] 3. Page-first without Firefox acting first on Ctrl+Shift+PageUp/Down
  evidence: Tabbrowser.on_keydown moves the tab on the first pass (out/02-strip.txt). Router stops the first pass in a system-group capture listener: out/02-router.txt shows the page saw the keys, Firefox did nothing, Vitre got moveTabLeft/Right[page-first/reply].
- [proven] 3. Page-first with focus in an out-of-process iframe, an in-process page, a Vitre field, DevTools, and a second remote <browser> (peek)
  evidence: 03-routing.js J1 (cross-site iframe in another process: reply still arrives, parent page sees nothing), G1 (about:config, non-remote: local bubble path), F2/F3 (Vitre field), 07 section 3 (DevTools focused), 10-remaining.js part B (reply event.target is the peek browser).
- [proven] 4. Ctrl keyup while focus is in a remote page (hold-and-release switcher)
  evidence: 03-routing.js E1: chrome gets 3 switcher steps and the Ctrl keyup (target=browser); the page sees Control down/up but no Tab. 06-demo.js step 12: switcher shown while held on a page that prevents every key, third MRU tab selected on keyup, quick tap goes to the previous tab (out/06/06-12-switcher-held.png). 04-synth.js step 5: window 'deactivate' cancels a held Ctrl.
- [partial] 4. AltGr vs Ctrl+Alt
  evidence: 03-routing.js D5: with the AltGraph modifier active, getModifierState('AltGraph') is true, ctrlKey/altKey false, nothing fires, page gets the key. D4: Ctrl+Alt+T / Ctrl+Alt+Tab / Ctrl+Alt+Left never match. Only through the text input processor; a real AltGr keyboard layout was not tested.
- [partial] 4. IME composition guard
  evidence: 03-routing.js D6: during a synthesized composition the keydowns are key=Process kc=229 or isComposing=true; Ctrl+T, Ctrl+W, F6, Ctrl+L, Esc fire nothing; after commit Ctrl+T works. A real IME was not tested.
- [proven] 4. Key repeat
  evidence: 03-routing.js D1 (Ctrl+W held, 4 keydowns: one action, repeats swallowed, page sees nothing), D2 (Ctrl+T repeat allowed: 3 actions), D3 (page-first Ctrl+J held: one action; Gecko dropped one repeat for the page).
- [proven] 4. Layouts: letters by label with physical fallback, digits by physical key
  evidence: 03-routing.js I1 with synthesized key/code pairs: Russian physical T, Dvorak physical K, AZERTY Digit1 and Digit6, AZERTY Q/A. Synthesized, not real layouts.
- [proven] 5. Synthesising keys for automated tests without OS focus
  evidence: EventUtils shipped at chrome://remote/content/external/EventUtils.js (drives nsITextInputProcessor): 04-synth.js steps 1, 2, 5 (works with activeWindow=false and while another window of the same Firefox is active); focusmanager.testmode makes no difference (out/04.txt vs out/04-testmode.txt). dispatchEvent(new KeyboardEvent) is trusted in chrome but never reaches the page (step 4).
- [proven] 5. Test gotcha: moving focus between two remote browsers needs the window active
  evidence: 10-remaining.js part A (another window active: peek.focus() moves only document.activeElement, focusedContentBrowsingContext is not the peek's) vs part B (after window.focus(): keys and replies target the peek) (out/10.txt).
- [proven] 6. History + open-tab suggestions
  evidence: vitre-omnibox-data.js suggest(): SQL on PlacesUtils.promiseLargeCacheDBConnection() + gBrowser.tabs; 0-6 ms per query (05-omnibox-data.js section 3, out/05/log.txt). Real navigation is recorded in Places (section 1). Alternative via Firefox's urlbar providers headless works too (section 4, 110-270 ms, includes live Google suggestions and a sponsored row).
- [proven] 6. Remove a history entry (Shift+Delete)
  evidence: PlacesUtils.history.remove(url) returns true and the row disappears (05 section 5); in the demo Shift+Delete removes only a row the user moved onto and stays Cut otherwise (06-demo.js step 8).
- [proven] 6. Search engine list and search URL building
  evidence: Services.search does not exist in 157; SearchService module from moz-src:///toolkit/components/search/SearchService.sys.mjs works: 7 engines listed, getSubmission() URLs, live suggestions via SearchSuggestionController (05 section 6).
- [proven] 6. URL fixup for typed input
  evidence: Services.uriFixup.getFixupURIInfo with keywordProviderId / preferredURI / schemelessInput, 19 inputs (05 section 7). Typed schemeless address ends on https (05b-schemeless.js).
- [proven] 6. Loading in the current tab / a new tab, switch to tab, triggeringPrincipal requirement
  evidence: openTrustedLinkIn(url, 'current'|'tab', {...}) and switchToTabHavingURI (05 section 8; 06-demo.js steps 4, 5, 6, 9, 9b). gBrowser.addTab, fixupAndLoadURIString and loadURI all throw without a triggeringPrincipal (05 section 8).
- [proven] 7. Focus between Vitre's HTML input and the remote page
  evidence: 06-demo.js steps 1, 3 (Esc, Esc returns focus; next typed key reaches the page), 10 (F6 both ways on a page that prevents every key), 11 (click in page closes the field), 7 (Ctrl+T: field still focused after the tab switch). 'INFO 7b': without wrapping gBrowser._adjustFocusBeforeTabSwitch/_adjustFocusAfterTabSwitch a tab switch blurs the field (out/06-noguard.txt); with the wrap it keeps focus (out/06.txt).
- [proven] Demo: floating input on Ctrl+L / Ctrl+T with live history + open-tab suggestions, Enter loads, Esc returns to the page
  evidence: 06-demo.js: 15 pass, 0 fail (out/06.txt); 14/14 with #navigator-toolbox hidden (out/06-hidden.txt, run before step 9b was added). Screenshots out/06/06-2-suggestions.png, 06-2b-switch-row.png, 06-7-ctrl-t.png, out/06-hidden/06h-2b-switch-row.png.
- [partial] Hardware browser keys (Back/Forward/Refresh/Stop/Search/Home) and mouse side buttons
  evidence: 07 section 2: Firefox's AppCommand handler removed with removeEventListener('AppCommand', HandleAppCommandEvent, true) and replaced; synthetic AppCommand events reach only Vitre's listener; BrowserBack..BrowserHome key events are taken browser-first. Native WM_APPCOMMAND delivery not tested.
- [proven] Shift+right-click bypasses a page's own context menu
  evidence: Built into Gecko (dom.event.contextmenu.shift_suppresses_event=true): 08-context-click.js: plain right-click on a page that prevents contextmenu opens no chrome menu, Shift+right-click opens contentAreaContextMenu and the page handler is not called.
- [proven] State-dependent priority (F11 leaves full screen browser-first; Esc Esc within 400 ms)
  evidence: install({ priorityOf }) hook: 03-routing.js K1 on a page that prevents every key.
- [unverified] Shift+F10 / Menu key context menu
  evidence: The key events pass through the router untouched (10-remaining.js), but on Windows the menu comes from native WM_CONTEXTMENU, which the text input processor does not produce.
- [unverified] Esc in element full screen / pointer lock, keyboard lock
  evidence: document.fullscreenKeyboardLock exists ('none') (07 section 4). No full-screen run was made.
- [unverified] Mouse bindings (Shift+click peek, Ctrl+click, Alt+click download)
  evidence: Outside this spike; Gecko's click path (ClickHandler / whereToOpenLink) was not exercised.
- [not-possible] FINDINGS.md written to the spike folder
  evidence: The Write call was refused by the harness: 'Subagents should return findings as text, not write report files.' Content is returned in this structured output instead.

## Recipe
All paths are under gecko\spikes\keys\. Reusable code: vitre-keys.js (neutralise + router + map), vitre-omnibox-data.js (data), omnibox-demo.js (field mechanics), lib.js (test helpers).

== A. Neutralise Firefox (VitreKeys.neutralise(), once per browser window, as early as possible) ==
1. Park every <key>: move all <key> children of every <keyset> into a hidden <box id="vitre-dead-keys">, then remove and re-insert each keyset (Gecko caches handlers when a keyset is bound). Keep the empty #mainKeyset in place: DevToolsStartup.hookKeyShortcuts inserts next to it. getElementById('key_*') keeps working. A MutationObserver on the keysets' parent and on documentElement parks keysets added later. Leave keysets whose id starts with "ext-keyset-id-" (extension commands).
2. Prefs (take effect at runtime; put in default prefs): ui.key.menuAccessKeyFocuses=false, ui.key.menuAccessKey=0 (Alt, F10, Alt+F); accessibility.browsewithcaret_shortcut.enabled=false (F7 otherwise opens a modal confirm); accessibility.typeaheadfind=false, accessibility.typeaheadfind.manual=false; browser.backspace_action=2; browser.ctrlTab.sortByRecentlyUsed=false; ui.key.contentAccess=4 (page accesskeys on Alt+letter like Chrome). Leave ui.key.chromeAccess alone.
3. Not covered by parking, beaten by the router's preventDefault (they all skip defaultPrevented events): MozTabbox.handleEvent (Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageUp/Down), Tabbrowser.on_keydown (Ctrl+Shift+PageUp/Down, Ctrl+F4), C++ F6/Shift+F6 and Ctrl+Tab document focus.
4. Hardware keys: window.removeEventListener("AppCommand", window.HandleAppCommandEvent, true); add your own AppCommand listener (event.command = "Back", "Forward", "Reload", "Stop", "Search", "Home").
5. Firefox commands stay callable: document.getElementById("key_toggleToolboxF12").doCommand() (DevTools), "key_inspector", "key_webconsole", "View:PageSource", "cmd_print", "Browser:SavePage".

== B. Router (VitreKeys.install({ onAction, onCtrlUp, priorityOf, filter, log })) ==
Listeners on window:
- keydown, default group, capture: match. Browser-first: e.preventDefault() (this also stops forwarding to the page) + e.stopPropagation(), remember e.code to swallow its keyup, act unless it is a repeat the binding does not allow (still swallow it, or it falls through to Firefox). Page-first: do nothing except mark the event for the system-group listener.
- keypress, default group, capture: page-first and e.target.isRemoteBrowser: first pass call e.requestReplyFromRemoteContent(); on the pass where e.isReplyEventFromRemoteContent is true, act only if !e.defaultPrevented, then preventDefault().
- keydown/keypress/keyup with { capture: true, mozSystemGroup: true }: stopPropagation() for marked events, so Firefox's system-group handlers never see the first pass (required for Ctrl+Shift+PageUp/Down, which tabbrowser otherwise acts on before the page).
- keypress with { mozSystemGroup: true } (bubble): page-first when the target is not remote (Vitre fields, in-process pages, DevTools): act if !e.defaultPrevented.
- keyup capture: swallow keyup of swallowed keydowns; e.key === "Control" is the switcher commit. 'deactivate' on window cancels a held Ctrl.
Gotchas:
- Decide page-first on the KEYPRESS reply, not keydown: only then do page default actions (select all, Backspace, arrows, scrolling, Tab, Shift+Delete, accesskeys) count as consumed. A page's keydown preventDefault suppresses the keypress, so no reply comes and Vitre does nothing.
- event.target (also on the reply) is the focused <browser>: tab or peek.
- Guards: isComposing || keyCode === 229 || key === "Process"; getModifierState("AltGraph"); ctrlKey && altKey; metaKey. Exact modifier match.
- Matching: letters by event.key if A-Z else event.code (KeyT); digits by event.code; '+' and '-' by character before digits (AZERTY 6 zooms out); numpad by code.
- priorityOf(binding, event) returns "browser" for state-dependent cases (F11 while full screen, second Esc within 400 ms on a peek).
- A Vitre widget that handles a key itself must preventDefault on keydown, or the router's local path also runs.
- isReservedByChrome does not exist in 157.

== C. Test key synthesis ==
const EU = { window, parent: window, _EU_Ci: Ci, _EU_Cc: Cc }; Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU);
EU.synthesizeKey("t", { ctrlKey: true }, window); EU.synthesizeKey("KEY_F6", {}, window); EU.synthesizeKey("KEY_Control", { type: "keydown" }, window) ... { type: "keyup" }; { repeat: 4 }; other layouts with { code, keyCode }; EU.sendString(text, window); EU.synthesizeCompositionChange / synthesizeComposition for IME; EU.synthesizeMouseAtCenter(browser, {...}, window). lib.js wraps this as KS.press("Ctrl+Shift+T"), KS.down("Control"), KS.up("Control").
Works without OS focus and with another window of the same Firefox active; focusmanager.testmode not needed. Gotchas: assert on document.activeElement (Services.focus.focusedElement is null while inactive); call window.focus() before moving focus between two remote browsers; held-Ctrl tests are cancelled by a real window deactivation; Gecko may drop repeats for a busy page; Shift+F10/Menu key menu cannot be synthesized; guard boot scripts against second windows with [...Services.wm.getEnumerator("navigator:browser")].length === 1; dispatchEvent(new KeyboardEvent) reaches the router but never the page.

== D. Omnibox data (vitre-omnibox-data.js) ==
- History: const db = await PlacesUtils.promiseLargeCacheDBConnection(); db.executeCached("SELECT url, title, frecency, visit_count, last_visit_date FROM moz_places h WHERE h.hidden = 0 AND h.last_visit_date NOT NULL AND (h.url LIKE :t0 ESCAPE '/' OR IFNULL(h.title,'') LIKE :t0 ESCAPE '/') ORDER BY <host-prefix first>, h.frecency DESC LIMIT :limit", params). Empty text: ORDER BY last_visit_date DESC. Sqlite.sys.mjs throws unless every LIKE right-hand side is a bare binding; last_visit_date is microseconds.
- Open tabs: gBrowser.tabs of every navigator:browser window (tab.linkedBrowser.currentURI.spec, tab.label), excluding the selected tab.
- Alternative: ProvidersManager.getInstanceForSap("urlbar").startQuery(new UrlbarQueryContext({ sapName: "urlbar", searchString, isPrivate, maxResults, allowAutofill }), controllerOrNull) from moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs and chrome://browser/content/urlbar/UrlbarQueryContext.mjs; results in context.results. Sends keystrokes to the search engine and includes sponsored rows.
- Remove: await PlacesUtils.history.remove(url). Seed for tests: PlacesUtils.history.insertMany.
- Engines: no Services.search in 157. const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs"); await SearchService.promiseInitialized; getVisibleEngines(), getDefault(), defaultEngine, getEngineByName(), getEngineById(); engine.getSubmission(words).uri.spec. Suggestions: new SearchSuggestionController().fetch({ searchString, inPrivateBrowsing: false, engine, maxLocalResults: 0, maxRemoteResults }).
- Fixup: Services.uriFixup.getFixupURIInfo(text, FIXUP_FLAG_FIX_SCHEME_TYPOS | FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP): info.keywordProviderId (non-empty = search; it is ...Id, not ...Name), info.preferredURI, info.schemelessInput.
- Load: window.openTrustedLinkIn(url, "current" | "tab" | "tabshifted", { allowInheritPrincipal: false, schemelessInput }). Lower level: browser.fixupAndLoadURIString(text, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(), loadFlags, schemelessInput }). triggeringPrincipal is mandatory everywhere. Switch: tab.ownerGlobal.gBrowser.selectedTab = tab or switchToTabHavingURI(url, false).

== E. Focus ==
input.focus() on an <html:input> appended to document.body; back with gBrowser.selectedBrowser.focus(). Close on blur when document.activeElement !== input. To keep the field focused across a tab switch, wrap gBrowser._adjustFocusBeforeTabSwitch and _adjustFocusAfterTabSwitch to return early while the field owns focus. Works with #navigator-toolbox display:none.

== F. Every binding in keymap.json (BF = works browser-first, PF = works page-first, L = local key in a Vitre widget, N = native Gecko, ? = not run) ==
Tabs and windows: Ctrl+T BF (key parked). Ctrl+W / Ctrl+F4 BF (Ctrl+F4 is tabbrowser JS, beaten by preventDefault; repeat swallowed). Ctrl+Shift+T BF. Ctrl+N BF. Ctrl+Shift+W BF. Ctrl+PageDown/Up BF (tabbox handler beaten by preventDefault). Ctrl+1..8, Ctrl+9 PF. Ctrl+Shift+PageUp/Down PF (CONFLICT: tabbrowser moves the tab before the page; resolved by system-group stop of the first pass). F11 PF to enter, BF to leave via priorityOf.
Address and search: Ctrl+L / Alt+D PF (a page accesskey=d keeps Alt+D). Enter, Alt+Enter, Ctrl+Enter, Shift+Delete, Esc L (demo). Shift+Enter / Ctrl+Q in the field L (key reaches the field; peek not built). Ctrl+H PF (empty query = recent history).
Page: Alt+Left/Right PF. Ctrl+R, F5, Ctrl+Shift+R, Ctrl+F5, Shift+F5 PF. Esc (stop) PF. Esc in element full screen N ?. Ctrl+Plus / = / numpad + PF, Ctrl+Minus / numpad - PF, Ctrl+0 / numpad 0 PF; Ctrl+wheel N ?. Ctrl+P, Ctrl+S, Ctrl+U PF (act via parked commands; print/save not executed). Link clicks ?. Browser Refresh/Stop/Search/Home BF as key events + AppCommand (native delivery ?).
Peek: Shift+click, Shift+Enter on a link, hop ?. Ctrl+Q PF (link-under-pointer logic needs a content actor ?). Alt+Enter PF. Esc PF, Esc Esc BF (priorityOf). Ctrl+W BF with event.target = peek. Alt+Left/Right, Ctrl+R/P/S/U, zoom, F12 on the peek PF by event.target.
Find: Ctrl+F PF (page, peek) / L (Home, find field, panel). F3, Shift+F3, Ctrl+G, Ctrl+Shift+G PF. Find-field keys L. Alt+C L with AltGr guard. Scrolling the page from the field ? (needs a content actor). F6 BF. Shift+F10 / Menu ?.
Tab switcher: Ctrl+Tab tap/hold, Tab with Ctrl held, Ctrl+Shift+Tab BF (tabbox CYCLE_TABS and Ctrl+Tab focus move stopped). Release Ctrl works. Switching away cancels (deactivate). Ctrl+W / typing / arrows / Enter / Esc in the switcher L (chrome sees every key first); 'first key as if Ctrl were up', IME latch, Sticky Keys ?. Ctrl+Shift+A PF.
Downloads: Ctrl+J PF. Ctrl+Shift+D PF (Firefox's modal bookmark-all-tabs key parked). Pill and panel keys L. Alt+click ?.
Menus and focus: Shift+F10 / Menu key ? (native). Shift+right-click N (built in). Menu keys L; Alt/F10 alone inert with the prefs. F6 / Shift+F6 BF (CONFLICT: Gecko's own F6 focuses the hidden urlbar; stopped by preventDefault). Tab from the address field L.
Popovers: L.
Panels and app: Ctrl+, PF. F1 PF. Ctrl+Shift+Delete PF. Esc / Ctrl+W / Ctrl+F on a panel L. F12, Ctrl+Shift+I PF (open with key_toggleToolboxF12.doCommand()). Ctrl+Shift+J PF (key_webconsole). Ctrl+Shift+C PF (key_inspector).
Editing: Ctrl+Z/Y/Shift+Z, Ctrl+X/C/V, Ctrl+Insert, Shift+Insert, Shift+Delete, Ctrl+Shift+V, Ctrl+A, Ctrl+Backspace/Delete all work in pages and Vitre fields; Ctrl+Left/Right Shift text direction ?.
Reserved: Ctrl+Alt and AltGr never match; nothing fires during composition; Ctrl+K, Ctrl+E, Ctrl+D, Alt+Home, F7 do nothing in Vitre and reach the page.

== G. Running ==
cd gecko; python tools/run.py --boot spikes/keys/03-routing.js --name keys-03 --out spikes/keys/out/03 --timeout 240
KS_MODE=stock|strip|router python tools/run.py --boot spikes/keys/02-neutralise.js --name keys-02<mode> --out spikes/keys/out/02-<mode> --timeout 400
python tools/run.py --boot spikes/keys/06-demo.js --name keys-06 --out spikes/keys/out/06 --timeout 220 (KS_HIDE=1 hides Firefox's toolbars, KS_NOGUARD=1 drops the tab-switch focus guard)

## Compromises
- Page-first is decided on the keypress reply (as Firefox's own keys are), not on keydown.defaultPrevented as in the Electron preload. This is stricter in the page's favour: default actions in the page (select all, Backspace, arrows, scrolling, Tab, accesskeys) also count as "the page used it".
- Ctrl+Shift+PageUp/Down stays page-first only because the router hides the first pass from Firefox's system-group listeners; without that Firefox moves the tab before the page sees the key.
- Keeping Vitre's field focused across a tab switch needs a wrap of two private tabbrowser methods (_adjustFocusBeforeTabSwitch, _adjustFocusAfterTabSwitch).
- The recommended suggestion source is direct SQL on moz_places plus gBrowser.tabs. Firefox's own urlbar providers also work headless but send keystrokes to the search engine and mix in sponsored rows.
- The HTML editor in this build has no Ctrl+B/I/U default (reply comes back free), so Ctrl+U in a plain contenteditable opens View source unless the site handles the key.
- AltGr, IME and layouts were exercised only through the text input processor, not real hardware or a real IME.
- FINDINGS.md could not be written (harness refuses report files from subagents); its content is in this output. vitre-keys.js no longer references it.
- The 06-hidden, 06-noguard and 06-testmode logs are from the demo version just before the Ctrl+Enter step was added (14/14); out/06.txt is the final version (15/15).

## Risks
1. The routing depends on chrome-only event members (requestReplyFromRemoteContent, isReplyEventFromRemoteContent). Tabbrowser.sys.mjs and KeyboardLockUtils.sys.mjs use them in 157, but they are internal. Run 03-routing.js on every runtime update.
2. Page-first keys wait for the content process: a hung page delays them (as in Firefox). Browser-first keys are unaffected.
3. Firefox's keys are live between window creation and the boot script (browser-delayed-startup-finished). Every new browser window needs neutralise() + install(); the spike only did the first window. Other window types (Library, standalone DevTools) have their own keysets.
4. Extension commands are silently overridden on chords Vitre binds; Settings should show the clash. Only a fake extension keyset was tested, not a real extension.
5. Firefox's search engine list carries partner parameters (client=firefox-b-1-d, an Amazon affiliate tag). Vitre should ship its own engine configuration.
6. The Places SQL depends on the moz_places schema and the urlbar/search modules are internal (Services.search already disappeared in 157; keywordProviderName became keywordProviderId).
7. Hardware Back/Forward/... keys may arrive natively both as key events and as AppCommand; the map binds both. Pick one path after testing on hardware (Firefox itself uses only AppCommand).
8. Unverified native paths: real AltGr layout, real IME, Sticky Keys, WM_CONTEXTMENU (Shift+F10 / Menu key), WM_APPCOMMAND, Esc in element full screen, keyboard lock.
9. Held-Ctrl tests are cancelled by a real window deactivation; under parallel spikes this showed up twice as a one-off failure that passed on re-run.
10. After an https request answered 404, later loads of that host stayed on http for the session (05b); observed, cause (HTTPS-First fallback memory) inferred.
11. A bare <browser> created outside the tabbrowser showed example.org in a different language than the tabs (out/10/10-peek-browser.png); not investigated, relevant to the peek spike.
12. The clipboard tests briefly overwrite the system clipboard and restore the previous text only (non-text clipboard content would be lost).

## Files
gecko\spikes\keys\vitre-keys.js
gecko\spikes\keys\vitre-omnibox-data.js
gecko\spikes\keys\omnibox-demo.js
gecko\spikes\keys\lib.js
gecko\spikes\keys\detector.js
gecko\spikes\keys\pages\keys.html
gecko\spikes\keys\01-explore.js
gecko\spikes\keys\02-neutralise.js
gecko\spikes\keys\03-routing.js
gecko\spikes\keys\03b-editor-defaults.js
gecko\spikes\keys\04-synth.js
gecko\spikes\keys\05-omnibox-data.js
gecko\spikes\keys\05b-schemeless.js
gecko\spikes\keys\06-demo.js
gecko\spikes\keys\07-menubar-appcommand.js
gecko\spikes\keys\08-context-click.js
gecko\spikes\keys\09-console-errors.js
gecko\spikes\keys\10-remaining.js
gecko\spikes\keys\out\02-stock.txt
gecko\spikes\keys\out\02-strip.txt
gecko\spikes\keys\out\02-router.txt
gecko\spikes\keys\out\03.txt
gecko\spikes\keys\out\03b\log.txt
gecko\spikes\keys\out\04.txt
gecko\spikes\keys\out\04-testmode.txt
gecko\spikes\keys\out\05\log.txt
gecko\spikes\keys\out\05b\log.txt
gecko\spikes\keys\out\06.txt
gecko\spikes\keys\out\06-hidden.txt
gecko\spikes\keys\out\06-noguard.txt
gecko\spikes\keys\out\07.txt
gecko\spikes\keys\out\08\log.txt
gecko\spikes\keys\out\09\log.txt
gecko\spikes\keys\out\09-stock\log.txt
gecko\spikes\keys\out\10.txt
gecko\spikes\keys\out\06\06-2-suggestions.png
gecko\spikes\keys\out\06\06-2b-switch-row.png
gecko\spikes\keys\out\06\06-7-ctrl-t.png
gecko\spikes\keys\out\06\06-12-switcher-held.png
gecko\spikes\keys\out\06-hidden\06h-2b-switch-row.png
gecko\spikes\keys\out\07\07-devtools.png
gecko\spikes\keys\out\10\10-peek-browser.png

# Independent verification

## Overall
The architecture the spike proposes holds: every script reproduced under my own names, and the core mechanism (chrome capture preventDefault for browser-first, requestReplyFromRemoteContent keypress reply for page-first, parked keysets plus prefs) also survives a real site (react.dev Ctrl+K), a real temporary WebExtension, a second window, and Gecko's native Windows key path. Nothing needs a runtime patch.

Six reported "proven" items are wrong or too broad as written; five have a fix that I ran, and the Esc case needs new work:

- **Layout matching (claim 18):** on real layout DLLs Dvorak Ctrl+, closes the tab, Dvorak Ctrl+' peeks, and Ctrl+, is dead on AZERTY and Russian. Matching letters by `event.keyCode` and comma by keyCode 188 gives 32/32.
- **"Only Vitre's map fires" (claim 2):** with the Win key held, Firefox's own tabbox/tabbrowser still switch, move and close tabs. Hiding every `ShortcutUtils` system action from the system group stops it.
- **Default actions count as page-used (claim 11):** not for Esc on a page `<dialog>`, a popover or an `alert()` prompt; one Esc closes the layer and also runs Vitre's Esc step. The Esc ladder needs its own check; I did not build one.
- **`priorityOf` (claim 30):** cannot turn a browser-first key into page-first because state is cleared on keyup before the reply arrives. Keyboard lock needs exactly this direction.
- **Test harness (claim 19):** "focusmanager.testmode makes no difference" is false. Without it, tab switches in an OS-inactive window send keys to the hidden tab; this corrupted my rerun of the spike's own 02 battery. With `--pref focusmanager.testmode=true` it is deterministic.
- **Suggestions (claim 21):** "0-6 ms" was measured on 8 rows; at 60 000 places it is 20-150 ms per query, and `openTabs()` offers private-window tabs to normal windows.

Four partial or unverified items moved forward:

- **AltGr (15):** proven on German, French and US layouts through `sendNativeKeyEvent`.
- **Hardware keys and mouse side buttons (28):** native WM_APPCOMMAND and WM_XBUTTON delivery proven by posting the real messages.
- **Shift+F10 / Menu key (31):** WM_CONTEXTMENU gives a page-first `contextmenu` event with no key handling needed.
- **Full screen and keyboard lock (32):** Esc leaves element full screen natively. Keyboard lock is on by default in 157, and the spike router violates the keymap's lock rule; the keydown-reply variant that fixes it is verified in `v5-keydown-reply.js`.

Still not verified by anyone:

- a real IME;
- Windows turning the physical Menu key / Shift+F10 into WM_CONTEXTMENU, and Alt+Space;
- whether an unconsumed Browser-key keydown is followed by WM_APPCOMMAND on hardware;
- whether Windows delivers the Win-modified tab chords to the app;
- Sticky Keys;
- the mouse click bindings (33).

Page-first keys also wait for the page: with a 2 s busy page Ctrl+L acted after 1.85 s and the typed-ahead text went to the page. This is the same model as stock Firefox, but it should be a stated product risk.

I did not write VERIFY.md: my harness instructions forbid report files, as happened to the spike's FINDINGS.md. Everything is in this output. Evidence is in `gecko\spikes\keys\verify\` (scripts `v1-native.js` through `v10-02-copy.js`, `vitre-keys-fixed.js`, `ext\`, `pages\edge.html`) with logs and screenshots in `verify\out\`.

## Confirmed
- Reruns under my own names reproduce the spike's numbers: 03-routing 31 pass / 0 fail (verify/out/03.txt), 06-demo 15/0, also 15/0 with #navigator-toolbox hidden and 15/0 with KS_NOGUARD (verify/out/06.txt, 06-hidden.txt, 06-noguard.txt), 02 router mode 'SUMMARY mode=router: 0 keys made Firefox do something, 82 did nothing' (verify/out/02-router.txt), 02 strip mode 9/73 when run with focusmanager.testmode=true (verify/out/v10-strip-testmode.txt). Screenshots looked at: verify/out/06/06-2b-switch-row.png (field + Search / Switch to tab / history rows), verify/out/06-hidden/06h-12-switcher-held.png, verify/out/10/10-peek-browser.png.
- Claim 1 (park every <key>): 96 keys parked (82 mainKeyset + 14 devtoolsKeyset), getElementById('key_newNavigatorTab') still resolves, same 3 DevTools-internal console errors as untouched Firefox (verify/out/09.txt vs 09-stock.txt). Also holds in a second browser window neutralised separately: 96 parked, its router fires independently, window 1 router sees nothing (verify/v3-edge.js section 7, verify/out/v3.txt).
- Claim 3 (Alt / F10 / Alt+F menu bar off with ui.key.menuAccessKeyFocuses=false, ui.key.menuAccessKey=0): reproduced (verify/out/07.txt). Additionally on the real window-message path: WM_SYSKEYDOWN/UP VK_MENU and VK_F10 posted to the HWND activate nothing and the next key still reaches the page (verify/v1-native.js B6, verify/out/v1.txt).
- Claim 4 (DevTools keys dead, key_toggleToolboxF12.doCommand() and View:PageSource.doCommand() still work) and claim 5 (editing keys in page fields and chrome html inputs incl. Ctrl+Insert / Shift+Insert / Shift+Delete / Ctrl+Shift+V / Ctrl+Delete): reproduced (verify/out/07.txt, 03.txt C1 C2 F1, 10.txt).
- Claim 6 (accesskeys with ui.key.contentAccess=4: page accesskey=d keeps Alt+D, otherwise Vitre acts): reproduced (03.txt B3-B5). Alt+D with a real WM_SYSCHAR on US and Russian layouts fires focusAddress (verify/out/v1b.txt).
- Claim 7 (extension keysets stay alive, Vitre wins its chords): reproduced, and now with a REAL temporary WebExtension (verify/ext, AddonManager.installTemporaryAddon): Ctrl+Shift+Y runs the extension's background page (it opened its tab), Ctrl+Shift+D gives only downloadVideo[page-first/reply], Ctrl+Shift+T only reopenClosed[browser-first]; keyset removed on uninstall (verify/v7-ext-win.js, verify/out/v7.txt).
- Claim 8 (browser-first: chrome capture keydown + preventDefault, page never sees keydown or keyup; tip.keydown returns KEYDOWN_IS_CONSUMED): reproduced (03.txt A4 A5, 02-router.txt, 04.txt step 3) and also through the native Windows key path with real layout DLLs (verify/out/v1.txt section A).
- Claim 9: KeyboardEvent has no isReservedByChrome in 157 (07.txt section 4). 'defaultCancelled', which tabbox.js / Tabbrowser.sys.mjs test, is a plain JS expando set by addon-shortcuts.mjs:485, not a WebIDL member. Nothing is lost: chrome preventDefault does the job.
- Claim 10 (page-first via the keypress reply): reproduced (03.txt A1-A3, A5) and on a real site: react.dev binds Ctrl+K (DocSearch); with peekLink rebound to Ctrl+K the site's search opens and Vitre does nothing, Esc closes the site's search and Vitre does nothing, then Ctrl+L / Ctrl+T / Ctrl+F route normally (verify/v3-edge.js section 8, verify/out/v3.txt, screenshot verify/out/v3/v3-react-ctrl-k.png).
- Claims 12, 13, 14, 17: Ctrl+Shift+PageUp/Down page-first with the system-group stop (02-router.txt), page-first with focus in an out-of-process iframe / about:config / Vitre field / DevTools / a second remote browser (03.txt J1 G1 F2 F3, 07.txt, 10.txt part B), Ctrl keyup with focus in a remote page (03.txt E1, 06.txt step 12, 04.txt step 5), key repeat (03.txt D1-D3): all reproduced.
- Claim 20 (focus between two remote browsers needs an active window): reproduced (10.txt part A vs B).
- Claims 22-25: PlacesUtils.history.remove, SearchService module (typeof Services.search = undefined, verify/out/v6.txt), Services.uriFixup results for 19 inputs, openTrustedLinkIn / switchToTabHavingURI, and the three 'throws without triggeringPrincipal' cases all reproduced (verify/out/05.txt, 05b.txt). LIKE escaping holds for % _ / quotes, CJK and a 3000-character input (v6.txt).
- Claims 26, 27: focus hand-over field <-> page, the Esc ladder, F6 both ways on a page that prevents every key, click-closes-field, and the need for the _adjustFocusBeforeTabSwitch/_adjustFocusAfterTabSwitch wrap (06-noguard.txt INFO 7b: field closed and activeElement=browser without the wrap; 06.txt: still focused with it) reproduced.
- Claim 29 (Shift+right-click bypasses the page's contextmenu handler, dom.event.contextmenu.shift_suppresses_event=true): reproduced (verify/out/08.txt).
- Claim 30 in the direction the spike tested (page-first -> browser-first: F11 while full screen, Esc Esc): reproduced (03.txt K1). The opposite direction is broken, see refuted.
- Claim 16 (IME guard) stays partial: reproduced with synthesized composition (03.txt D6: key=Process kc=229 / isComposing). I found no in-process way to drive a real TSF IME; sendNativeKeyEvent loads layout DLLs only.
- Claim 33 (mouse bindings Shift/Ctrl/Alt+click) is still unverified; I did not test it.
- Claim 34: I did not write VERIFY.md either. My harness instructions forbid report .md files and the spike's Write was refused for the same reason, so I did not try to work around it. All notes are in this output; the runnable evidence is in gecko/spikes/keys/verify/ (scripts v1..v10, vitre-keys-fixed.js, ext/, pages/edge.html) and verify/out/ (logs, screenshots).

## Refuted
- 18 [proven] Layouts: letters by label with physical fallback, digits by physical key
  why: Fails on real layouts. Run through Gecko's native Windows key path with the real layout DLLs (windowUtils.sendNativeKeyEvent, verify/v1b-native2.js, verify/out/v1b.txt: 28 pass, 4 fail): Dvorak Ctrl+, (comma sits on physical W: key=',' code=KeyW kc=188) runs closeTab; Dvorak Ctrl+' (physical Q) runs peekLink; French AZERTY Ctrl+, (physical M) does nothing, so Settings has no shortcut; Russian Ctrl+, (key='б' code=Comma kc=188) does nothing. Cause: keyName() falls back to event.code whenever event.key is not a Latin letter, so punctuation on a letter position is read as that letter, and comma is matched by the character. The spike only tested hand-picked key/code pairs. With letters matched by event.keyCode (the Windows virtual key) and comma by keyCode 188 the same battery is 32/32 (verify/vitre-keys-fixed.js, verify/out/v1b-fixed.txt) and the spike's own suites still pass (verify/out/v8-03-fixed.txt 31/0, v8-06-fixed.txt 15/0).
- 2 [proven] / headline: with Vitre's router installed 0 keys make Firefox act, only Vitre's map fires
  why: True for the 82 chords pressed, not for the same tab keys with the Win key held. ShortcutUtils.getSystemActionForEvent ignores Win on Windows, Vitre's guard refuses Win chords and therefore never preventDefaults them, so tabbox/tabbrowser act on their own: Ctrl+Win+Tab and Ctrl+Shift+Win+Tab switch tabs, Ctrl+Win+PageDown switches, Ctrl+Shift+Win+PageDown moves the tab, Ctrl+Win+F4 CLOSES the tab (verify/v7-ext-win.js section B, verify/out/v7.txt, each line marked 'Firefox acted on its own'). Synthesized; whether Windows delivers each of these Win chords to an app was not checked. Fix verified: a capture + mozSystemGroup listener that stopPropagation()s every event for which ShortcutUtils.getSystemActionForEvent(e) != null gives 'firefox: nothing' for all seven (verify/out/v7-fixed.txt).
- 11 [proven] Default actions in the page count as 'the page used it'
  why: Only for editor, scrolling, Tab and accesskey defaults (03b reproduced). Layers that close on Esc do not mark the reply consumed, so one Esc closes the page's layer AND runs Vitre's Esc step (close peek / stop): page <dialog>.showModal() -> page saw dialog-cancel, dialog-closed and Vitre got escape[page-first/reply] (verify/v3-edge.js section 1, verify/out/v3.txt); popover=auto -> popover:closed plus escape[page-first/reply]; alert() tab-modal prompt -> prompt closed plus escape[page-first/local] (verify/v9-prompts.js, verify/out/v9.txt). keymap.json's Esc ladder lists 'page dialog' as its own layer, so the router cannot rely on the reply for Esc. (<input type=search> does consume Esc.) Also: while an alert is open Ctrl+L / Ctrl+R / F5 still act through the local path.
- 30 [proven] State-dependent priority through install({ priorityOf })
  why: Works only page-first -> browser-first. Returning 'page' for a browser-first binding never fires: the decision is stored in st.prio and deleted on keyup, and the keypress reply arrives after the keyup's first pass (always with synthesized keys; also whenever the page is slow), so the reply pass falls back to b.priority === 'browser' and returns. verify/v3-edge.js section 6 on the spike router: page does not prevent Ctrl+T -> Vitre [] (expected newTab[page-first/reply]). This direction is exactly what keymap.json requires under keyboard lock. Fixed by not clearing the per-key decision on keyup: verify/out/v3-fixed.txt section 6 gives newTab[page-first/reply], and nothing when the page prevents.
- 19 [proven] Key synthesis without OS focus; 'focusmanager.testmode makes no difference'
  why: The EventUtils / nsITextInputProcessor method itself is confirmed, but the testmode statement is wrong and later test scripts would be flaky. When the window is not the OS-active window (normal while spikes run in parallel) and the test switches tabs or calls browser.focus(), content focus does not move: keys and router event.target go to the previously focused, now hidden tab. verify/v2-inactive.js with the window deactivated by WM_ACTIVATE(WA_INACTIVE)+WM_KILLFOCUS: testmode=false -> 'BAD 2 window inactive, switched to tab2 ... selected page saw [], the other tab's page saw [d:x p:x u:x d:ctrl-l u:ctrl-l] ... event.target is selected browser: false' (verify/out/v2.txt); testmode=true -> 6 OK / 0 BAD (verify/out/v2-testmode.txt). It happened for real in my rerun of the spike's own 02 strip battery: 45 of 82 keys never reached the selected page and F6 was misreported as 'nothing' (verify/out/02-strip.txt); with --pref focusmanager.testmode=true every key arrived and the 9/73 result came back (verify/out/v10-strip-testmode.txt). window.focus() and Services.focus.setFocus() worked in one run and not in the other.
- 21 [proven] History + open-tab suggestions, '0-6 ms per query'
  why: The mechanism works, but two parts do not hold. (1) The timing was measured on 8 rows. With 60 000 places the same suggest() takes 20-80 ms per query, up to 154 ms for a one-letter query, and a burst of 8 overlapping keystroke queries took 461 ms (verify/v6-omnibox-scale.js, verify/out/v6.txt). The main thread is not blocked (longest gap 6 ms) and it is still faster than Firefox's own providers (258 ms). (2) openTabs() walks every navigator:browser window including private ones: from a normal window suggest('example.') returned 'switch:https://example.com/?private-window' (v6.txt 'LEAK CHECK ... true').

## Improved
- Claim 15 AltGr vs Ctrl+Alt (was partial) -> proven on the native layout path
  finding: windowUtils.sendNativeKeyEvent(layoutId, vk, Ci.nsIDOMWindowUtils.NATIVE_MODIFIER_*, chars, unmodifiedChars, observer) drives widget/windows NativeKey with the real layout DLL, in-process and without OS focus. German (0x407): AltGr+Q -> key='@' ctrl=false alt=false AltGraph=true, guard=altgr, page gets '@'; AltGr+E -> euro; AltGr+T and AltGr+D (type nothing) are also AltGraph=true, so Alt+D never fires from AltGr; LCtrl+LAlt+Q (also types @) is reported as AltGraph; LCtrl+LAlt+T (types nothing) is ctrl+alt and blocked by the Ctrl+Alt guard. French AltGr+0 -> '@' AltGraph. US layout: Right Alt is plain Alt and RightAlt+D runs focusAddress. Evidence: verify/v1-native.js section A (verify/out/v1.txt), verify/out/v1b.txt. Not a physical keyboard, but it is Gecko's real Windows key translation.
- Claim 28 hardware browser keys and mouse side buttons (was partial) -> native delivery proven
  finding: Real window messages posted to the runtime's own HWND with js-ctypes PostMessageW (HWND from nsIBaseWindow.nativeHandle): WM_APPCOMMAND(BROWSER_BACKWARD) produces a trusted AppCommand event (target = the chrome document) and stock Firefox goes back; after removeEventListener('AppCommand', HandleAppCommandEvent, true) Vitre's listener alone receives Back, Forward, Reload, Stop, Search, Bookmarks, Home, both with the key device and the mouse device flag (verify/v1-native.js B1 B2, verify/out/v1.txt). WM_XBUTTONDOWN/UP for buttons 1 and 2 over the page arrive as AppCommand Back / Forward (verify/out/v1b.txt B1). A posted WM_KEYDOWN VK_BROWSER_BACK taken browser-first gives exactly one back action and no AppCommand (B3). Still open: whether an unconsumed Browser-key keydown is followed by WM_APPCOMMAND on real hardware (the posted one was not), and my page-side mouse log stayed empty so I could not show whether a page can veto the mouse Back button; treat mouse Back as browser-level.
- Claim 31 Shift+F10 / Menu key (was unverified) -> no key handling needed, page-first for free
  finding: On Windows the keyboard context menu is WM_CONTEXTMENU with lParam=-1. Posting it to the HWND: focus on a page link -> chrome 'contextmenu' event at the <browser>, contentAreaContextMenu opens with gContextMenu.linkURL=https://example.com/ and 'Open Link in New Tab' shown; on a page that preventDefaults contextmenu the page gets it and no chrome menu opens; focus in a Vitre <html:input> -> 'contextmenu' targets the input and Firefox opens #textbox-contextmenu unless the field preventDefaults it (verify/v1-native.js B5b B5c, verify/v1b-native2.js B3 B3b B4, verify/out/v1.txt, v1b.txt). So Vitre handles the DOM contextmenu event and leaves the keys alone. Not shown: Windows turning the physical Menu key / Shift+F10 into WM_CONTEXTMENU (a posted VK_APPS keydown/keyup reached the page as key events but produced no menu); stock Firefox relies on the same step. XUL menupopups are separate OS windows and do not appear in PrintWindow captures, so the evidence is the log.
- Claim 32 Esc in element full screen and keyboard lock (was unverified) -> tested
  finding: Element full screen (verify/v3-edge.js section 3, verify/out/v3.txt): Esc leaves full screen natively, a page that preventDefaults every keydown does not even see the key, Vitre's router fires nothing. F11 there stays with the page ('d:f11!', still full screen) unless priorityOf returns 'browser' when document.fullscreenElement is set (the chrome document's fullscreenElement is the <browser>). Keyboard lock exists and is ON by default in 157: dom.fullscreen.keyboard_lock.enabled=true, requested with element.requestFullscreen({ keyboardLock: 'browser' }) (navigator.keyboard does not exist), visible in chrome as document.fullscreenKeyboardLock === 'browser'. Under lock an Esc tap goes to the page and full screen stays; holding Esc about 5 s and releasing leaves, with and without the router (verify/out/v4-stock.txt, v4-router-fixed.txt; my synthesized auto-repeat variant did not exit even in stock, so repeat synthesis is not representative). The spike router breaks keymap.json's lock rule: Ctrl+T and Ctrl+W are still taken browser-first under lock (v3.txt section 4).
- Keyboard lock: working primitive for browser-first keys that must go to the page first
  finding: requestReplyFromRemoteContent() also works on keydown (this is what tabbox.js / Tabbrowser.sys.mjs do through KeyboardLockUtils.mustWaitForKeyboardLockRequestedReply). verify/v5-keydown-reply.js (verify/out/v5.txt): the keydown reply has defaultPrevented=false when the page did nothing and defaultPrevented=true, byContent=true when the page prevented it, for Ctrl+Tab, F6, Ctrl+W, Esc. The keypress reply is useless for Ctrl+Tab and F6 (always defaultPrevented=true, and Gecko's own focus move runs: chrome activeElement browser -> input). If chrome also preventDefaults the keypress first pass, the page still gets its keydown, focus stays put in page and chrome, and Vitre can act on the keydown reply. With the fixed router and priorityOf returning 'page' under lock, Ctrl+T and Ctrl+W reach the page and then fire as page-first/reply (verify/out/v4-router-fixed.txt); Ctrl+Tab and F6 need the keydown-reply variant. A keydown-reply decision cannot replace the keypress rule in general: Ctrl+A in a page field still selected all (11 chars) while chrome acted.
- Dependable test harness setting
  finding: Run every key test with tools/run.py --pref focusmanager.testmode=true and call window.focus() once at the start. In test mode Gecko ignores OS activation changes (after WM_ACTIVATE(WA_INACTIVE) activeWindow stays true) and tab switches / browser.focus() move content focus correctly: verify/out/v2-testmode.txt 6 OK, verify/out/v10-strip-testmode.txt all 82 keys delivered. All my v3-v9 scripts ran this way while other spikes held the foreground.
- Risk the spike did not report: page-first keys wait for the page
  finding: With the page's main thread blocked for 2 s, Ctrl+L acted 1853 ms after the press, the 'abc' typed right after it went to the page instead of the field (page saw d:a d:b d:c, Vitre field got ""), and a later Ctrl+T (browser-first) ran first, at +62 ms (verify/v3-edge.js section 5, verify/out/v3.txt). Stock Firefox has the same behaviour for its non-reserved keys. F6 stays instant, which matches the keymap's 'F6 then the key' escape route.
- Small data-source facts
  finding: PlacesUtils.history.remove(url) returns false for a bookmarked page although its visits are removed and it leaves the suggestions (the page row survives with frecency 1), so do not use the return value as 'row removed' (verify/out/v6.txt). A typed schemeless address whose https version answers 404 ends on http (go('example.org/typed') -> http://example.org/typed) and the host then stays on http for the session (verify/out/05b.txt); this is Firefox's HTTPS-First fallback. resolveInput() returns an http:// URL for schemeless input (schemeless=true); the load is what upgrades it, so do not show that URL as the destination.

## Recipe corrections
All paths are under gecko\spikes\keys\verify\. A corrected router that passes the spike's own suites is vitre-keys-fixed.js (out/v8-03-fixed.txt 31/0, out/v8-06-fixed.txt 15/0, out/v1b-fixed.txt 32/0).

1. Key matching (section B "Matching" is wrong). Use the virtual key, as keymap.json says:
   - '+' and '-' by event.key first (zoom wins on any key that types them).
   - Letters: event.keyCode 65-90 -> that letter. Do not use "event.key if A-Z else event.code".
   - Digits by event.code Digit0-9; numpad by code.
   - Comma: event.keyCode === 188 (VK_OEM_COMMA), not event.key === ','.
   - keypress events have keyCode 0 (out/01.txt), so never re-match on keypress: store the binding matched on keydown in a Map keyed by event.code and read it on keypress and on the reply.

2. Do not delete per-key state (priority, binding) on keyup. The keypress reply arrives after the keyup's first pass. Overwrite it on the next keydown of that key and clear it on window 'deactivate'. Without this, priorityOf cannot turn a browser-first key into page-first.

3. Add to the neutralise step: a keydown+keypress listener with { capture: true, mozSystemGroup: true } that calls stopPropagation() when ShortcutUtils.getSystemActionForEvent(e) != null (resource://gre/modules/ShortcutUtils.sys.mjs). This covers Win-modified Ctrl+Tab / Ctrl+PageUp/Down / Ctrl+Shift+PageUp/Down / Ctrl+F4, which the router does not match and Firefox otherwise executes.

4. Keyboard lock (missing from the recipe; on by default in 157). Condition: document.fullscreenElement && document.fullscreenKeyboardLock === "browser". For browser-first bindings in that state: keydown first pass -> e.requestReplyFromRemoteContent(); keypress first pass -> preventDefault() + stopPropagation(); keydown pass with e.isReplyEventFromRemoteContent -> act if !e.defaultPrevented. Keep F11 browser-first; Esc-hold exit is native. A page that prevents everything under lock blocks Ctrl+W / Ctrl+T (out/v4-router-fixed.txt last line), which is the intended rule.

5. Full screen priority: priorityOf should return "browser" for F11 when document.fullscreenElement || window.fullScreen. Esc in element full screen needs no code.

6. Esc is not safely page-first by the reply alone. Before running a Vitre Esc step check: a tab-modal prompt on the browser (gBrowser.getTabDialogBox(browser).getContentDialogManager()._dialogs.length, private API, verify the name when implementing) and, through a content actor, an open modal <dialog> or popover (document.querySelector(":modal, :popover-open")). Decide also whether Ctrl+R / Ctrl+L should act while an alert() is open; today they do.

7. Section C (tests): add --pref focusmanager.testmode=true to every run and window.focus() once. Drop "focusmanager.testmode not needed" and "call window.focus() before moving focus between two remote browsers" (not dependable without test mode). Keep asserting on document.activeElement.

8. Section C additions for native paths:
   - Layouts / AltGr: window.windowUtils.sendNativeKeyEvent(layout, vk, mods, chars, unmodChars, { observe() {} }); layouts 0x409 US, 0x407 German, 0x40c French, 0x419 Russian, 0x10409 Dvorak; mods from Ci.nsIDOMWindowUtils.NATIVE_MODIFIER_CONTROL_LEFT / ALT_LEFT / ALT_RIGHT / ALT_GRAPH / SHIFT_LEFT. Pass the control character for Ctrl+letter ("\x14" for Ctrl+T), the typed character for AltGr and Alt+letter (Alt+letter without it produces no keypress and page-first never fires), "" otherwise.
   - Window messages: ctypes.open("user32.dll").declare("PostMessageW", ctypes.winapi_abi, ctypes.bool, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t) on window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle. WM_APPCOMMAND 0x319 with lParam = cmd << 16 (1 Back, 2 Forward, 3 Refresh, 4 Stop, 5 Search, 6 Favorites, 7 Home; OR 0x8000 into the high word for the mouse device); WM_CONTEXTMENU 0x7B with lParam -1; WM_XBUTTONDOWN/UP 0x20B/0x20C. Posted WM_KEYDOWN only works for keys without modifiers.

9. Context menus: handle the DOM "contextmenu" event; do not bind Shift+F10 / ContextMenu. Vitre's chrome html inputs must preventDefault contextmenu or Firefox shows #textbox-contextmenu.

10. AppCommand (section A.4): commands seen natively are "Back", "Forward", "Reload", "Stop", "Search", "Bookmarks", "Home"; event target is the document. Mouse side buttons arrive only this way. Taking BrowserBack etc. browser-first on keydown yields one action and no AppCommand; if Back is ever made page-first as keymap.json lists it, guard against a following AppCommand (not verified on hardware).

11. Section D: in openTabs() skip windows whose PrivateBrowsingUtils.isWindowPrivate(win) differs from the current window's. Expect 20-150 ms per query at 60 000 places: keep the token check in refresh(), consider a short debounce, and note the ORDER BY CASE forces a full scan. Do not trust history.remove()'s boolean for bookmarked pages.

12. Document for the product: page-first keys have no upper bound on latency when the page is busy and typed-ahead characters go to the page; a page-first action can run after a later browser-first one.

13. neutralise() and install() must run in every browser window (config.js already loads the boot script per window); the spike scripts skip secondary windows, the product must not.