# Spike result: extensions

Verdict: works-with-compromises

## Summary
Firefox add-ons work unchanged under the Vitre shell on Firefox 157 with `#navigator-toolbox` hidden. Blocking (MV2 webRequestBlocking and MV3 declarativeNetRequest), toolbar buttons with badges and popups inside the pill, the install doorhangers, options pages, menus and AddonManager management all ran and were captured.

FINDINGS.md was not written: the harness refused the Write call ("Subagents should return findings as text, not write report files"), and I did not work around it. This structured output is the findings; the recipe also lives as code and comments in `lib.js` (`installExtensionBar`).

- **Best way to show buttons:** keep Firefox's real browserAction widgets and re-home them. Pinned ones go in a CustomizableUI toolbar area inside the pill; Firefox's own `#unified-extensions-button` is moved next to the pill and opens the native panel for the rest. Popup, per-tab badge, right-click menu, pin/unpin and restart persistence then work with almost no patching.
- **Alternative, also built:** Vitre-drawn HTML buttons driving the internal browserAction API object. It works, but costs two per-extension method overrides and a reimplemented popup lifecycle.
- **Install flow:** every add-on doorhanger anchors to Vitre's bar. The full flow (permission prompt, Add, "was added", button appears in the pill) was run for both entry points, a third-party `.xpi` link and `navigator.mozAddonManager`, the API AMO uses.
- **What was not exercised:** the real uBlock Origin, the real AMO site, and a signed install on the release build, because the spike downloads no extensions. The full flow above used an unsigned local XPI with signature enforcement switched off by an automation-mode runner.

Plain limits:
- Chrome Web Store installs are impossible on Gecko.
- On the stock release runtime only Mozilla-signed add-ons install permanently. Unsigned ones are temporary only, or built-ins shipped by Vitre.
- Extension popups, doorhangers and menus are native XUL panels, not elements in Vitre's glass layer.

Run everything with `python spikes/extensions/run-all.py` from the `gecko` folder; logs and captures are in `spikes\extensions\out`.

## Claims
- [proven] MV2 webRequest + webRequestBlocking blocks requests (uBlock Origin's mechanism)
  evidence: boot-block.js, out/block.log: baseline `"ads-mv2":["loaded","loaded"]` becomes `["blocked","blocked"]`; main-frame navigations to /ads-mv2/page.html and https://example.org end `NS_ERROR_ABORT` with the tab left on the previous page. Capture block-1-subresources.png.
- [proven] MV3 declarativeNetRequest blocks (static rule set and a dynamic rule)
  evidence: boot-block.js, out/block.log: `ads-dnr` and `ads-dnr-dynamic` rows blocked; `staticRules:["static_rules"], dynamicRules:[100]`; navigations to /ads-dnr/page.html and https://example.net end `NS_ERROR_ABORT`. `declarativeNetRequest.getMatchedRules` does not exist in 157 (logged).
- [proven] Content scripts, background page, storage.local, tabs.query returning Vitre's tabs
  evidence: out/block.log: `contentScriptPages=[...]`, `storage={"greeting":"stored-by-mv2"}`, `MV2 tabs.query [...]` matches `real Vitre tabs [...]`. Capture block-2-content-script.png shows the injected strip with the background's reply on https://example.com.
- [proven] Round icon button with a badge inside the active pill, using real widgets in a custom CustomizableUI area (approach a)
  evidence: boot-buttons-a.js with lib.js installExtensionBar; out/a.log `mv2 widget node parent=vitre-ext-bar badge=2 badgeStyle=background-color: rgba(196, 43, 28, 1)`; capture a-1-pinned-with-badge.png. Badge follows the tab: `tab2 selected: badge attr=null`, `tab1 selected again: badge attr=2`.
- [proven] Extension popup opened from the pill button (approach a)
  evidence: out/a.log `popup via click: button.open=true panel=customizationui-widget-panel state=open rect x 520..830` under the button at x 798..826; capture a-2-popup-open.png. `popup via triggerAction(window): open=true` covers extension-initiated opens.
- [partial] Extension keyboard command opens the popup
  evidence: out/a.log: `<key>` exists in `keyset#ext-keyset-id-vitre-mv2_spike_test` (key Y, accel+shift) and its command opens the popup (a-2b-popup-from-keyboard-command.png). A synthesized DOM key event did not trigger it (`popup via synthesized Ctrl+Shift+Y: open=false`), so a physical key press is unverified.
- [proven] Right-click menu of an extension button: extension's own items, Manage, Remove, Report, Pin to Toolbar
  evidence: out/a.log `toolbar-context-menu state=open items ["MV2: open the logger","---","Manage Extension","Remove Extension","Report Extension","---","Pin to Toolbar [x]"]`; capture a-3-context-menu.png. Activating Pin to Toolbar unpinned it: `after menu Unpin: {"area":"unified-extensions-area"} nodes in pill: 0`.
- [proven] Extensions button for the rest: Firefox's panel opened from Vitre's bar, with gear menu, pin from the panel, and popup of an unpinned extension
  evidence: out/a.log `extensions panel state=open items [mv2, mv3]` (a-5-extensions-panel.png); gear menu items incl. `Pin to Toolbar`, `Manage Extension`, `Remove Extension` (a-6-panel-gear-menu.png); `after gear-menu Pin on mv3: {"area":"vitre-ext-bar"}` (a-7); unpinned popup anchored to the extensions button (a-8-unpinned-popup-in-panel.png).
- [proven] Pinned vs in-panel state persists across restarts
  evidence: boot-persist.js run three times on one kept profile, out/persist.log: RUN 2 `after restart still unpinned`, RUN 3 `after restart still pinned -> {"area":"vitre-ext-bar"} nodesInPill=1`; state is in pref `browser.uiCustomization.state`. Capture persist-3-pinned-after-restart.png. Run with signatures off (automation mode) because a permanent install of the unsigned test XPI is needed.
- [proven] Vitre-drawn HTML buttons driving the internal BrowserAction object (approach b): icon, per-tab badge, popup anchored to own button, extension-initiated open, button menu data
  evidence: boot-buttons-b.js, out/b.log: `own buttons [{badge:"2", bg:"rgb(196, 43, 28)"},{badge:"on"}]`, `own-button popup: state=open`, `triggerAction(window) -> Vitre popup for mv3: state=open`, scratch-menupopup item reached `menus.onClicked`. Captures b-1, b-2, b-3.
- [proven] Install doorhangers anchored to Vitre's bar: third-party .xpi link path, full flow
  evidence: boot-install.js via run-install-real.py, out/install-link-unsigned-ok.log: `addon-install-blocked` ("Continue to Installation"), then `addon-webext-permissions`, then `appMenu-addon-installed-notification`, all `anchorIn:"vitre-bar"`; `real install completed: true widget placement {"area":"vitre-ext-bar"}`. Captures link-unsigned-ok-1..4. Signature enforcement was off for this run.
- [proven] Install through navigator.mozAddonManager (the API AMO uses), full flow with toolbar hidden
  evidence: boot-install-amo.js via run-install-real.py, out/install-amo-unsigned-ok.log: mock store on example.com mapped to the local server; `mozAddonManager: object`, permission prompt and "was added" both `anchorIn:"vitre-bar"`, page saw `onInstallEnded state=STATE_INSTALLED`, `installed: true ... temporary:false`. Captures amo-unsigned-ok-1..3. Signature enforcement off and testing prefs on for this run.
- [unverified] Install from the real addons.mozilla.org of a signed add-on (e.g. uBlock Origin) on the release build
  evidence: Not run: the spike downloads no extensions. Source shows AMO uses the same `AddonManager.webAPI.createInstall` -> `installAddonFromAOM` path that the mock store exercised, and that signed packages pass `verifySignedState` against `AddonsPublicRoot`.
- [proven] Release build refuses an unsigned XPI; the failure doorhanger anchors to Vitre's bar
  evidence: boot-install.js plain run, out/install-link-release.log: `AddonSettings.REQUIRE_SIGNING=true pref xpinstall.signatures.required=false`, `onDownloadFailed error=-5 ERROR_SIGNEDSTATE_REQUIRED`, doorhanger `addon-install-failed` `anchorIn:"vitre-bar"`. Capture link-release-1-first-doorhanger.png.
- [proven] Doorhangers with non-extension anchors (url-bar icons) can be given a fallback anchor in Vitre's bar
  evidence: boot-anchor.js, out/anchor.log: stock `anchorNode=null rect {"x":-4,"y":-4}` (anchor-1-stock-unanchored.png); after wrapping `PopupNotifications._getVisibleAnchorElement`, `anchorNode=vitre-pill (in vitre-bar)` (anchor-2-fallback-to-pill.png).
- [proven] Options pages: about:addons detail view, plain tab, and embedded in a Vitre panel
  evidence: boot-pages.js, out/pages.log: `openOptionsPage -> tab about:addons`, `options as a tab: moz-extension://.../options.html remoteType=extension`, `embedded options browser: ... remoteType=extension`. Captures pages-1a, pages-1b, pages-1c.
- [proven] Extension context-menu items: native page menu, and data source for Vitre's custom menu
  evidence: out/pages.log: native menu shows `Vitre MV2 Blocker >` (pages-2a-native-context-menu.png); `on-build-contextmenu` with a scratch menupopup returned the right items for page, link and selection contexts, and `doCommand()` reached the extension: `menus.onClicked received ... [{"id":"vitre-mv2-sel"}]`.
- [proven] sidebar_action
  evidence: out/pages.log `sidebar: isOpen=true currentID=vitre-mv2_spike_test-sidebar-action`; capture pages-3-sidebar-action.png. Works because `#sidebar-box` is outside the toolbox; recommended out of scope for v1 (no entry point in the design).
- [proven] devtools_page panels
  evidence: out/pages.log `devtools toolbox opened: hostType=bottom additional (extension) tools ["Vitre MV2"]`; capture pages-4-devtools-panel.png.
- [unverified] page_action (address-bar) buttons
  evidence: Not built. They live in the hidden url bar (BrowserPageActions). Recommended out of scope for v1.
- [proven] Managing add-ons through AddonManager: list, disable/enable, private-window access, update check, remove; about:addons reachable
  evidence: boot-manage.js, out/manage.log: ADDON rows with fields; disabling mv2 turned `ads-mv2` from blocked to loaded and removed its node from the pill, enabling restored both; `findUpdates(mv3): [..."onUpdateFinished error=0"]`; `after mv3.uninstall(): getAddonByID -> null`; listener events logged. Captures manage-1-vitre-extensions-list.png, manage-2-mv2-disabled.png, manage-3-about-addons.png. An actual update download was not exercised.
- [proven] Shipping an unsigned extension with Vitre as a built-in
  evidence: out/manage.log `installBuiltinAddon: {"isBuiltin":true,"isActive":true,"isPrivileged":true,"temporary":false,"canUninstall":false}` from `resource://vitre-boot/ext/inst/`. Built-ins are privileged, so this is for Vitre's own code only.
- [not-possible] Chrome Web Store installs
  evidence: boot-cws.js, out/cws.log: `ordinary origin: STORE mozAddonManager: undefined`; `webAPI.createInstall host check: clients2.google.com -> rejected: addon-install-webapi-blocked` (cws-1-webapi-blocked-doorhanger.png); `getInstallForFile(.crx): STATE_DOWNLOAD_FAILED error=-5 ERROR_SIGNEDSTATE_REQUIRED`. Source: `WEBAPI_INSTALL_HOSTS = ["addons.mozilla.org"]` in AddonManager.sys.mjs; no `webstorePrivate` or CRX handling anywhere in the extracted omni. Nuance: a CRX with a Firefox-compatible manifest does load as a temporary add-on (logged), gone at restart.
- [not-possible] Permanent install of unsigned extensions ("Load unpacked" that sticks) on the stock release runtime
  evidence: out/cws.log `signing: {"pref xpinstall.signatures.required":false,"AddonSettings.REQUIRE_SIGNING":true,"mustSign_extension":true}`; AddonSettings.sys.mjs makes REQUIRE_SIGNING a constant when `MOZ_REQUIRE_SIGNING && !Cu.isInAutomation`. `installTemporaryAddon(unsigned .xpi)` works (`temporarilyInstalled=true`).
- [unverified] Multiple windows and private windows with the extension bar
  evidence: Not run. Expected from the source: `registerArea` once, `registerToolbarNode` and the button move per window.

## Recipe
All of this is implemented in `spikes\extensions\lib.js` `installExtensionBar(ui)`; run it per browser window after Vitre's bar exists.

**Keep the tab model.** Tabs must stay `gBrowser` tabs: `tabs.query`, per-tab badges and AMO's `privilegedmozilla` process all hang off it.

**Pinned buttons in the pill (approach a, recommended)**
1. `CustomizableUI.registerArea("vitre-ext-bar", { type: CustomizableUI.TYPE_TOOLBAR, defaultPlacements: [] })` (once).
2. Per window: `document.createXULElement("toolbar")` with `id="vitre-ext-bar"`, `customizable="true"`, `mode="icons"`, `context="toolbar-context-menu"`; append it inside the pill's accessories slot; `CustomizableUI.registerToolbarNode(toolbar)`.
3. Re-home widgets that land in hidden Firefox toolbars (uBlock Origin asks for `default_area: "navbar"`): `CustomizableUI.addListener({ onWidgetAdded, onWidgetMoved })`, and if `CustomizableUI.isWebExtensionWidget(id)` and the area is neither `vitre-ext-bar` nor `CustomizableUI.AREA_ADDONS`, call `CustomizableUI.addWidgetToArea(id, "vitre-ext-bar")`. Run the same check over `CustomizableUI.areas` at startup.
4. Override `gUnifiedExtensions.pinToToolbar = (widgetId, pin) => CustomizableUI.addWidgetToArea(widgetId, pin ? "vitre-ext-bar" : CustomizableUI.AREA_ADDONS, pin ? undefined : 0)`. Every "Pin to Toolbar" command goes through it.
5. Pinned means the widget's area is not `AREA_ADDONS` (`unified-extensions-area`). State persists in pref `browser.uiCustomization.state`.

**Extensions button for the rest**
- Move the real `#unified-extensions-button` node into Vitre's bar (it is a fixed node, not a CUI placement). Add `mousedown` and `keypress` listeners calling `gUnifiedExtensions.togglePanel(event)`; the original handler is delegated on `#navigator-toolbox`.
- It opens `#unified-extensions-panel`: list, gear menu `#unified-extensions-context-menu` (site access, Pin, Manage, Remove, Report), popups of unpinned extensions.

**CSS** (selectors used in the spike)
- Button: `#vitre-ext-bar .unified-extensions-item-action-button`, icon stack `> .toolbarbutton-badge-stack`, badge `.toolbarbutton-badge`, states `:hover`, `[open]`, `[disabled]`.
- Icon and badge come from Firefox: CSS variable `--webextension-toolbar-image`, attributes `badge` and `badgeStyle`.
- Hide Firefox-only entries of `#toolbar-context-menu` (`#toggle_toolbar-menubar`, `#toggle_PersonalToolbar`, `.viewCustomizeToolbar`, `#toolbar-context-move-to-panel`, `#toolbar-context-remove-from-toolbar`, ...).

**Doorhanger anchors**
- Add-on install doorhangers (`addon-install-blocked`, `addon-install-failed`, `addon-progress`, `addon-webext-permissions`, ...) all use `gUnifiedExtensions.getPopupAnchorID()`, which is `#unified-extensions-button`'s first child. Moving the button is enough.
- "<name> was added" is AppMenuNotifications anchored to the app-menu button. Wrap `PanelUI._getPanelAnchor` and redirect only when `candidate === PanelUI.menuButton`. Gotcha: that function also anchors every widget popup; a blanket override sent extension popups to the wrong button.
- Everything else (default-search prompt, site permission prompts): wrap `PopupNotifications._getVisibleAnchorElement` to return Vitre's pill when the requested anchor is not visible. Without it the panel opens at the window's top-left corner.

**Install entry points** (nothing to implement, for reference)
- AMO: `navigator.mozAddonManager.createInstall` -> `amWebAPI.sys.mjs` -> `amManager.sys.mjs` -> `AddonManager.webAPI.createInstall` -> `installAddonFromAOM`. Only on `addons.mozilla.org`.
- Other sites: `application/x-xpinstall` navigation -> `amContentHandler.sys.mjs` -> `AddonManager.installAddonFromWebpage` (adds the "Allow site" step).
- UI: `gXPInstallObserver` in `browser-addons.js`; `ExtensionsUI.sys.mjs` topics `webextension-permission-prompt` and `webextension-install-notify`.
- "Get extensions" = open `https://addons.mozilla.org` in a tab. Keep `Firefox/<version>` in the UA (not run here).

**Vitre-drawn buttons (approach b, only if the pill must be HTML-only)** in `boot-buttons-b.js`
- API object: `ExtensionParent.apiManager.global.browserActionFor(extension)`.
- Paint: `api.action.getContextData(tab)` gives `title, badgeText, badgeBackgroundColor, icon, popup, enabled`; icon URL from `ExtensionParent.IconDetails.getPreferredIcon(data.icon, extension, 16 * devicePixelRatio).icon`; text colour `api.action.getTextColor(data)`.
- Repaint: wrap instance method `api.updateWindow`; also on `TabSelect`.
- Click: `api.action.triggerClickOrPopup(tab, { button: 0, modifiers: [] })` returns the popup URL (or fires `onClicked`); then `new PanelPopup(extension, document, url, api.browserStyle)` from `resource:///modules/ExtensionPopups.sys.mjs`, `await popup.contentReady`, `popup.panel.openPopup(button, "bottomright topright", 0, 4)`.
- Override instance method `api.openPopup` so shortcuts and `action.openPopup()` use the same function.
- Lifecycle: `ExtensionParent.apiManager.on("ready" | "shutdown", (e, extension) => ...)`.
- Button menu: `ExtensionParent.apiManager.global.actionContextMenu({ extension, onBrowserAction: true, menu: scratchMenupopup })` (`onAction` for MV3); commands `BrowserAddonUI.manageAddon(id)`, `removeAddon(id)`, `reportAddon(id)`.

**Extension items in Vitre's page menu** (`boot-pages.js`)
- Create a never-shown XUL `menupopup`. Build a subject `{ menu, tab, pageUrl, onLink, linkUrl, isTextSelected, selectionText, onImage, srcUrl, onEditable, inFrame, frameUrl, frameId }`, set `subject.wrappedJSObject = subject`, `Services.obs.notifyObservers(subject, "on-build-contextmenu")`.
- Read `label`, `image`, `type`, `checked`, `disabled` and nested `menu > menupopup` from the generated elements. On choose: `element.doCommand()`. On close: dispatch `popuphidden` on the scratch popup.
- Raw model: `ExtensionParent.apiManager.global.gMenuMap` / `gRootItems`.

**Options pages**
- `addon.optionsURL`, `addon.optionsType` (`OPTIONS_TYPE_TAB` 3, `OPTIONS_TYPE_INLINE_BROWSER` 5).
- As a tab: `gBrowser.addTab(addon.optionsURL, { triggeringPrincipal: extension.principal })`.
- Inline in Settings: XUL `<browser type="content" remote="true" remoteType=extension.remoteType messagemanagergroup="webext-browsers" initialBrowsingContextGroupId=policy.browsingContextGroupId>`, wait for `XULFrameLoaderCreated`, `ExtensionParent.apiManager.emit("extension-browser-inserted", browser)`, then load the URL.
- `runtime.openOptionsPage()` itself opens `about:addons` at `addons://detail/<id>/preferences` for inline options.

**Settings > Extensions** (`boot-manage.js`)
- List: `AddonManager.getAddonsByTypes(["extension"])`, filter `!addon.hidden`; icon `AddonManager.getPreferredIconURL(addon, 32, window)`.
- Allowed actions: `addon.permissions & AddonManager.PERM_CAN_UNINSTALL / PERM_CAN_DISABLE / PERM_CAN_ENABLE / PERM_CAN_CHANGE_PRIVATEBROWSING_ACCESS`.
- `addon.disable()`, `addon.enable()`, `addon.uninstall()` (or `BrowserAddonUI.removeAddon(id)` for the confirm dialog), `addon.findUpdates(listener, AddonManager.UPDATE_WHEN_USER_REQUESTED)`.
- Private windows: `ExtensionPermissions.add(id, { permissions: ["internal:privateBrowsingAllowed"], origins: [] })`, then `addon.reload()`.
- Changes: `AddonManager.addAddonListener({ onInstalled, onEnabled, onDisabled, onUninstalled })`.
- Fallback: `BrowserAddonUI.openAddonsMgr("addons://list/extension")`.

**Loading extensions without AMO**
- Developer load: `AddonManager.installTemporaryAddon(nsIFile)` (folder or zip, gone at restart).
- Vitre's own extension: `AddonManager.installBuiltinAddon("resource://<mapped>/<folder>/")`.

**Gotchas**
- A blocked main-frame navigation ends `NS_ERROR_ABORT` and leaves the tab on the previous page; no error page.
- PopupNotifications and AppMenuNotifications only open in the active window; doorhanger buttons ignore clicks for 500 ms (`security.notification_enable_delay`) after show or window re-activation.
- The toolbar area does not overflow by itself: cap pinned buttons or let the domain text shrink.
- `windowUtils.sendMouseEvent` is gone in 157; use `window.synthesizeMouseEvent`.
- Captures: popups are separate OS windows; use `spikes\extensions\runx.py` (composites them) and pref `ui.popup.disable_autohide=true` when other windows steal focus.

## Compromises
- **Store:** addons.mozilla.org only. Chrome Web Store, CRX packages and Chrome-only extensions are out.
- **Signatures:** on the stock release runtime only Mozilla-signed add-ons install permanently. "Load unpacked" exists only as a temporary add-on that disappears at restart. Honouring `xpinstall.signatures.required=false` would need a real fork built without `MOZ_REQUIRE_SIGNING`.
- **Look:** extension popups, the extensions panel, doorhangers and Firefox's context menus are native XUL panels (separate OS windows). They can be restyled with CSS but cannot be elements in Vitre's glass layer.
- **Internals patched:** three small overrides of Firefox internals (`gUnifiedExtensions.pinToToolbar`, `PanelUI._getPanelAnchor` for the app-menu button, `PopupNotifications._getVisibleAnchorElement`) plus a CustomizableUI listener.
- **Small losses:** the "Pin extension to toolbar" checkbox in the "was added" doorhanger hides itself; `declarativeNetRequest.getMatchedRules` is missing in 157; doorhangers and about:addons say "Firefox".
- **Scope:** sidebar_action and devtools panels work but sidebar is recommended out of scope for v1; page_action buttons were not built.
- **Evidence gap:** the full install flow was seen only with signature enforcement switched off (automation mode) and a mock store, because no real extension may be downloaded.

## Risks
- **Internal APIs can change with any Firefox release:** `gUnifiedExtensions`, `PanelUI._getPanelAnchor`, `PopupNotifications._getVisibleAnchorElement`, `browserActionFor`, the `on-build-contextmenu` topic, `gMenuBuilder`, `PanelPopup`. The spike scripts are runnable and should be rerun on every runtime update.
- **Not verified:** the real uBlock Origin; the real AMO site; a signed install on the release build; a physical key press for extension shortcuts; multiple windows; private windows; page actions; theme add-ons (they would restyle Firefox's hidden chrome); native messaging; a real update download.
- **Focus behaviour:** doorhangers open only in the active window and their buttons have a 500 ms click delay; fine for a user, but automated tests need the `keepActive` and retry helpers in `lib.js`.
- **Background traffic of the stock runtime:** during the runs Firefox itself fetched a Mozilla-signed system add-on update (`newtab.xpi` from archive.mozilla.org, visible in out/install-link-release.log). Vitre needs a decision on Firefox's own update channels.
- **Built-in add-ons are privileged:** `installBuiltinAddon` must be used only for Vitre's own code, never to sideload third-party extensions.
- **Automation-mode runner is spike-only:** it turns off signature checks and crashes Firefox on any non-local connection unless the loopback proxy prefs (`network.proxy.failover_direct=false`, `network.proxy.allow_bypass=false`) are set; it must never be how Vitre ships.
- **Capture artefact:** PrintWindow gives no alpha, so popup shadow margins and the translucent Windows 11 menu background appear black in captures; they are not black on screen.
- **FINDINGS.md is missing:** the harness blocked writing it, so the written findings exist only in this output.

## Files
gecko\spikes\extensions\lib.js
gecko\spikes\extensions\runx.py
gecko\spikes\extensions\run-all.py
gecko\spikes\extensions\run-install-real.py
gecko\spikes\extensions\serve.py
gecko\spikes\extensions\build-xpi.py
gecko\spikes\extensions\boot-block.js
gecko\spikes\extensions\boot-buttons-a.js
gecko\spikes\extensions\boot-buttons-b.js
gecko\spikes\extensions\boot-persist.js
gecko\spikes\extensions\boot-install.js
gecko\spikes\extensions\boot-install-amo.js
gecko\spikes\extensions\boot-anchor.js
gecko\spikes\extensions\boot-pages.js
gecko\spikes\extensions\boot-manage.js
gecko\spikes\extensions\boot-cws.js
gecko\spikes\extensions\ext\mv2\manifest.json
gecko\spikes\extensions\ext\mv2\bg.js
gecko\spikes\extensions\ext\mv3\manifest.json
gecko\spikes\extensions\ext\mv3\rules.json
gecko\spikes\extensions\ext\inst\manifest.json
gecko\spikes\extensions\www\page.html
gecko\spikes\extensions\www\amo.html
gecko\spikes\extensions\out\block.log
gecko\spikes\extensions\out\a.log
gecko\spikes\extensions\out\b.log
gecko\spikes\extensions\out\persist.log
gecko\spikes\extensions\out\install-link-release.log
gecko\spikes\extensions\out\install-link-unsigned-ok.log
gecko\spikes\extensions\out\install-amo-unsigned-ok.log
gecko\spikes\extensions\out\anchor.log
gecko\spikes\extensions\out\pages.log
gecko\spikes\extensions\out\manage.log
gecko\spikes\extensions\out\cws.log
gecko\spikes\extensions\out\a-1-pinned-with-badge.png
gecko\spikes\extensions\out\a-2-popup-open.png
gecko\spikes\extensions\out\a-3-context-menu.png
gecko\spikes\extensions\out\a-5-extensions-panel.png
gecko\spikes\extensions\out\a-6-panel-gear-menu.png
gecko\spikes\extensions\out\b-2-own-button-popup.png
gecko\spikes\extensions\out\link-unsigned-ok-1-first-doorhanger.png
gecko\spikes\extensions\out\amo-unsigned-ok-1-first-doorhanger.png
gecko\spikes\extensions\out\amo-unsigned-ok-2-added-doorhanger.png
gecko\spikes\extensions\out\amo-unsigned-ok-3-installed-in-pill.png
gecko\spikes\extensions\out\link-release-1-first-doorhanger.png
gecko\spikes\extensions\out\anchor-2-fallback-to-pill.png
gecko\spikes\extensions\out\pages-1c-options-embedded-in-vitre-panel.png
gecko\spikes\extensions\out\pages-2a-native-context-menu.png
gecko\spikes\extensions\out\manage-1-vitre-extensions-list.png
gecko\spikes\extensions\out\persist-3-pinned-after-restart.png

# Independent verification

## Overall
The spike holds up: every claim marked proven reproduced under my own profile names, and I could not break approach (a) with a second window, a private window, tab switches, or by moving and re-creating the toolbar node. No "proven" was wrong.

What changes for the architecture:

- **Claim 24 is wrong as "not-possible".** Unsigned extensions can persist on the stock release runtime in three ways: replacing `XPIDatabase.mustSign`, re-installing as temporary at each start (keeps identity, storage and placement with nothing patched), or as a privileged built-in. Each has a cost; the signing patch is a security decision for the user.
- **Four gaps closed.** The keyboard command (claim 6), second and private windows (claim 25) and page actions (claim 20) are now proven by runs, and the update download left open in claim 21 was exercised end to end.
- **Two real defects found in the "hide Firefox's UI" model.** Page-action popups and shortcuts throw without an anchor, and updates that add permissions are parked behind the hidden app-menu badge, so the extension would never update. Both have small, tested fixes.
- **Chrome Web Store stays impossible.** A typical store manifest with a service-worker background is refused by Gecko 157 even as a local load.
- **Still unverified:** clicking "Add to Firefox" on real AMO and a signed package passing verification. The real uBlock Origin listing does load under the shell with `navigator.mozAddonManager` present and an enabled install button; no extension was downloaded.

Two files the task asked for do not exist. The spike's FINDINGS.md was never written, and I did not write VERIFY.md: this session's rules say to return findings as output rather than write report files, so this structured output is the record. The evidence is runnable: `python spikes/extensions/verify/run-verify.py` from the gecko folder re-runs the original scripts and mine.

Everything is in gecko/spikes/extensions/verify/ (scripts `v-*.js`, `rerun.py`, `run-verify.py`, `build-test-packages.py`; logs and captures in `out/<key>/`, each with a `run.log`). I wrote nothing outside that folder; the original spike files are untouched.

## Confirmed
- Claim 1 (MV2 webRequest blocking): reproduced. verify/out/block/run.log shows ads-mv2 going from loaded to blocked and main-frame navigations to /ads-mv2/page.html and https://example.org ending NS_ERROR_ABORT; block-1-subresources.png shows the blocked rows.
- Claim 2 (MV3 declarativeNetRequest, static and dynamic rule): reproduced in verify/out/block/run.log (ads-dnr and ads-dnr-dynamic blocked, staticRules [static_rules], dynamicRules [100], example.net aborted). getMatchedRules is indeed missing in 157 (source: ExtensionDNR.sys.mjs refers to bug 1745765 as not implemented).
- Claim 3 (content scripts, background, storage.local, tabs.query): reproduced. block-2-content-script.png shows the injected strip with the background's reply on https://example.com; tabs.query output matches gBrowser's tabs in the log.
- Claim 4 (round button with badge in the pill, real widgets in a custom CustomizableUI area): reproduced. verify/out/a/run.log 'mv2 widget node parent=vitre-ext-bar badge=2'; a-1-pinned-with-badge.png; badge follows the tab (null on tab 2, 2 again on tab 1). Also holds in a second window and a private window (verify/out/vwin2).
- Claim 5 (popup from the pill button): reproduced, a-2-popup-open.png. Also works after the toolbar node is moved to another pill, detached and re-attached, or replaced by a new element with the same id (verify/out/vmisc/run.log steps 1a, 1b, 1c).
- Claim 7 (right-click menu: extension items, Manage, Remove, Report, Pin): reproduced (a-3-context-menu.png). I also ran the real commands: Manage Extension opens about:addons at addons://detail/<id>; Remove Extension shows Firefox's window-modal confirm dialog with Remove/Cancel (verify/out/vmisc/misc-2b-remove-extension-dialog.png).
- Claim 8 (extensions button opens Firefox's panel, gear menu, pin from panel, unpinned popup): reproduced, a-5, a-6, a-7, a-8 captures in verify/out/a.
- Claim 9 (pinned vs in-panel survives restarts): reproduced over three runs on one profile (verify/out/persist/run.log, automation mode). Also seen on the release build without automation in verify/out/vunsigned/run.log (placement vitre-ext-bar, nodesInPill=1 after two restarts).
- Claim 10 (Vitre-drawn HTML buttons driving the BrowserAction object): reproduced, verify/out/b/run.log and b-1..b-3 captures.
- Claim 11 (third-party .xpi link flow, all doorhangers anchored to Vitre's bar): reproduced in automation mode (verify/out/install-link-unsigned-ok). I also ran the complete flow on the release build without automation (verify/out/vinstall-flow/run.log: addon-progress, addon-install-blocked, addon-webext-permissions, appMenu-addon-installed-notification, all anchorIn vitre-bar; 'real install completed: true').
- Claim 12 (navigator.mozAddonManager flow with a mock store): reproduced in automation mode (verify/out/install-amo-unsigned-ok, amo-unsigned-ok-1..3 captures). It cannot be run outside automation: with only extensions.webapi.testing set, mozAddonManager is undefined on example.com.
- Claim 14 (release build refuses an unsigned XPI, failure doorhanger in Vitre's bar): reproduced, verify/out/install-link-release/run.log (error -5 ERROR_SIGNEDSTATE_REQUIRED, addon-install-failed, anchorIn vitre-bar) and link-release-1-first-doorhanger.png.
- Claim 15 (fallback anchor for doorhangers with url-bar anchors): reproduced, verify/out/anchor/run.log (stock anchorNode=null at -4,-4; with the hook anchorNode=vitre-pill). The hook exists as described: PopupNotifications.sys.mjs line 1354 calls this._getVisibleAnchorElement(anchorElement).
- Claim 16 (options pages: about:addons detail, plain tab, embedded browser): reproduced, verify/out/pages/run.log and pages-1a/1b/1c captures.
- Claim 17 (extension context-menu items natively and through a scratch menupopup): reproduced; on-build-contextmenu returned the right items for page, link and selection, and doCommand reached menus.onClicked (verify/out/pages/run.log).
- Claim 18 (sidebar_action) and claim 19 (devtools panel): reproduced, pages-3-sidebar-action.png and pages-4-devtools-panel.png.
- Claim 21 (AddonManager list, disable/enable, private access, update check, remove, about:addons): reproduced, verify/out/manage/run.log. I added the missing update download: see improved.
- Claim 22 (unsigned extension shipped as a built-in): reproduced, and it is a real persistent install: after a restart it is already running before any install call, with no onInstalled event, and it blocked requests during startup (verify/out/vbuiltin/run.log RUN 2). It is privileged and has canUninstall=false, so it is for Vitre's own code only.
- Claim 23 (Chrome Web Store installs not possible): confirmed. boot-cws.js reproduced (mozAddonManager undefined on ordinary origins, clients2.google.com rejected with addon-install-webapi-blocked). The omni source has no webstorePrivate, chromewebstore or Cr24 handling at all. See improved for why a Vitre-side CRX importer would not rescue it.

## Refuted
- Claim 24: permanent install of unsigned extensions ('Load unpacked' that sticks) is not possible on the stock release runtime; honouring it would need a real fork.
  why: Three working routes exist on the stock release build without automation mode. (1) XPIDatabase.mustSign is a plain writable method (descriptor writable=true, while AddonSettings.REQUIRE_SIGNING is frozen); replacing it from Vitre's privileged code lets AddonManager.getInstallForFile(unsigned xpi).install() succeed as a permanent install that is still active after two restarts (verify/v-unsigned-perm.js, verify/out/vunsigned/run.log). (2) Re-installing the folder with installTemporaryAddon at every start, with nothing patched, keeps the same moz-extension uuid, storage.local data (runs 1, 2, 3 with a constant firstSeen) and the pinned/unpinned placement (verify/v-temp-persist.js, verify/out/vtemp/run.log). (3) installBuiltinAddon persists by itself across restarts but makes the extension privileged (verify/out/vbuiltin/run.log).
- Compromise 'Small losses': the 'Pin extension to toolbar' checkbox in the 'was added' doorhanger hides itself.
  why: Overstated. From browser-addons.js (#renderPinToolbarButtonCheckbox) the checkbox is hidden only when the widget's area is neither unified-extensions-area nor nav-bar, that is only for extensions that land pinned in the pill (default_area navbar). Extensions that default to the panel keep the checkbox, and ticking it goes through the overridden gUnifiedExtensions.pinToToolbar. Source reading only; I did not run a default-panel extension through the doorhanger.
- Recipe: for third-party sites the 'Allow site' step comes first (implied by claim 11's sequence addon-install-blocked, then permissions).
  why: On 157 extensions.postDownloadThirdPartyPrompt is true, so the XPI is downloaded first and a transient 'addon-progress' doorhanger ('Downloading and verifying add-on') appears before 'addon-install-blocked'. The original boot-install.js takes whichever doorhanger it sees first; on the release build it caught addon-progress and silently fell back to the observer-raised prompts (seen when I ran it with the signing patch). verify/v-install-flow.js waits past addon-progress and logs the true order.

## Improved
- Claim 6, extension keyboard command (was partial)
  finding: Now proven. Ctrl+Shift+Y sent through nsITextInputProcessor (trusted widget-level key events, the path a physical key takes inside Gecko) opens the popup with the toolbox hidden, both with focus in chrome and with focus in the remote page. verify/v-keys.js, verify/out/vkeys/run.log ('popup open=true' twice), keys-popup-from-real-key-focus-page.png. The original failure was only because untrusted DOM KeyboardEvents never reach XUL key bindings. Nothing to implement; keep the ext-keyset-id-* keysets alive (the keys spike's neutralise() already does).
- Claim 25, second window and private window (was unverified)
  finding: Now proven. verify/v-win2.js loads the recipe in every window. Second window: widget in its own pill with badge, popup opens there and not in window 1, extensions panel anchored in its bar, pin from window 2 updates both windows, an install doorhanger for a window-2 tab anchors to window 2's bar, and closing window 2 leaves window 1 working (verify/out/vwin2/run.log, win2-2-popup-in-second-window.png). Calling registerArea again per window does not throw. Private window: bar and button work; extensions without private access are absent and the panel says 'You have extensions installed, but not enabled in private windows'; after ExtensionPermissions.add + addon.reload() the widget, badge, blocking and popup work there (win2-6, win2-7, win2-8). Product consequence: ad blocking does not run in private windows unless the user ticked 'Allow extension to run in private windows' in the install prompt.
- Claim 20, page_action (was unverified, 'not built')
  finding: Built and proven, and a stock bug found. With the toolbox hidden, an extension's page action cannot open its popup at all: handleClick (used by the _execute_page_action shortcut and pageAction.openPopup) throws 'PageActions: No anchor node for <id>'. A Vitre-drawn button fixes it: get the API object with ExtensionParent.apiManager.global.pageActionFor(extension), paint from api.action.getContextData(tab) and api.action.isShownForTab(tab), wrap api.updateButton for repaints, set api.browserPageAction._anchorIDOverride to the Vitre button's id, and call api.handleClick(window, {button: 0, modifiers: []}) on click. Popup opens anchored to the button, the keyboard command works, the button hides on non-matching sites, and page_action menu items come from actionContextMenu({extension, onPageAction: true, menu}). verify/v-pageaction.js, verify/out/vpageaction/run.log, pageaction-2-popup.png.
- Claim 13, real AMO install of a signed add-on (still unverified, gap narrowed)
  finding: Read-only check of the real uBlock Origin listing under the Vitre shell on the release build: page loads in the privilegedmozilla process, navigator.mozAddonManager is an object with createInstall, the UA is stock Firefox/157.0, and AMO shows an enabled 'Add to Firefox' button pointing at an .xpi on addons.mozilla.org, with no 'get Firefox' banner (verify/v-amo-readonly.js, verify/out/vamo/run.log, amo-real-listing-ublock-origin.png). Nothing was clicked or downloaded. Incidental evidence that Mozilla signature verification works in this runtime: Firefox's own system add-on updater fetched newtab.xpi and reported signedState=3 in the release-mode logs. What remains unproven is only the click itself and an AMO-signed (signedState=2) package passing verification.
- Claim 24, unsigned extensions that persist (was not-possible)
  finding: Possible, three ways, each with a cost. (a) Replace XPIExports.XPIDatabase.mustSign: true permanent install, survives restarts even though startup runs unpatched. But Firefox's daily verifySignatures() disables the add-on if it runs unpatched (logged: appDisabled=true), and re-enables it when run with the patch, so Vitre must patch at every start and then call XPIDatabase.verifySignatures(). The waiver is global while active (mustSign only receives the type), it weakens a security protection, and about:addons wrongly shows 'could not be verified ... has been disabled' on the running add-on (update-3 capture). Patching earlier from AutoConfig is untested (I may not edit runtime/config.js). (b) Re-install as temporary at each start: no patch, about 130 ms, identity, storage and placement kept; costs: runtime.onInstalled fires with reason 'install' on every launch, the add-on starts after the browser UI, and AddonManager will not update it. (c) installBuiltinAddon: persistent and early, but privileged and not user-removable, so unsuitable for third-party code. This is a product and security decision for the user, not just a technical one.
- Claim 21 gap, real update download; hidden UI swallows permission updates
  finding: Update flow exercised end to end with a local update chain on the release build (verify/v-update.js, verify/out/vupdate/run.log). 1.0 to 2.0 with unchanged permissions applies silently and the button stays in the pill. 2.0 to 3.0 with added permissions is parked: ExtensionsUI.updates.size=1, the only signal is badge-status=addon-alert on the hidden app-menu button, no doorhanger, nothing in Vitre's bar. Left alone the extension would stay on the old version forever. Vitre must listen to ExtensionsUI.on('change'), read ExtensionsUI.updates (and ExtensionsUI.sideloaded), show its own indicator, and call ExtensionsUI.showUpdate(gBrowser, update), which opens about:addons and shows the 'requires new settings to update' prompt anchored to Vitre's bar (update-3-permission-prompt-from-showUpdate.png); accepting installed 3.0.
- Claim 23, Chrome Web Store (stays not-possible, reason sharpened)
  finding: Even if Vitre fetched CRX files itself it would not work for typical store extensions (local Chrome-style packages only, verify/v-cws.js, verify/out/vcws/run.log). An MV3 manifest with only background.service_worker is refused: 'background.service_worker is currently disabled. Add background.scripts.' Chrome MV2 and MV3 manifests that also list background.scripts do load as temporary add-ons with a generated id. Permanent install of a CRX without a gecko id fails with ERROR_CORRUPT_FILE even with signing waived; with a gecko id and the mustSign patch a CRX installs permanently. So an importer would need manifest rewriting and still break on service-worker code.
- New risks found while trying to break approach (a)
  finding: 1. With pref extensions.unifiedExtensions.button.always_visible=false the moved extensions button disappears from Vitre's bar, leaving no entry point when everything is unpinned (verify/out/a-hiddenpref/a-4-unpinned.png). 2. When every extension is pinned, clicking the extensions button opens an about:addons tab instead of a panel (vmisc step 3; togglePanel in browser-addons.js). 3. With no extensions the panel shows Firefox's fox illustration and 'Discover extensions', which opens about:addons (verify/out/vempty). 4. The Remove confirm dialog sits flush at the top edge over Vitre's bar and offers 'Report this extension to Mozilla'. 5. The stock runtime downloads Mozilla system add-on updates by itself (newtab.xpi from archive.mozilla.org appears in every release-mode log). 6. Black corners around popups in captures come from PrintWindow on translucent popup windows; real on-screen appearance is unverified here.

## Recipe corrections
Corrections and additions an implementer needs (all run unless marked):

1. Lock the extensions button visible. Set and lock `extensions.unifiedExtensions.button.always_visible=true` (or override `gUnifiedExtensions.updateButtonVisibility`). `extBtn.hidden = false` once is not enough; Firefox re-hides it when the pref is false.

2. Register process-wide things once, not per window. `CustomizableUI.addListener({onWidgetAdded, onWidgetMoved})` and the startup re-home scan belong in one module. `installExtensionBar` as written adds a new listener per window and never removes it. Per window only: create the toolbar, `registerToolbarNode`, move the button, override `gUnifiedExtensions.pinToToolbar`, `PanelUI._getPanelAnchor`, `PopupNotifications._getVisibleAnchorElement`. A second `registerArea` call with the same type is harmless.

3. The toolbar node may follow the active pill. Moving it, detaching and re-attaching it, or creating a new `<toolbar id="vitre-ext-bar">` and calling `registerToolbarNode` again all keep widgets, badges and popups working.

4. Context menu CSS: also hide `#customizationMenuSeparator` (the delivered CSS leaves a dangling separator at the end). Safe to add `#toolbarDownloadsAnchorMenuSeparator, #toolbarNavigatorItemsMenuSeparator, #tabbarItemsMenuSeparator, #sidebarRevampSeparator` too.

5. `PanelUI._getPanelAnchor` override: it redirects everything anchored to the app-menu button, not only "was added". That includes the app menu itself if it is ever opened and Firefox's update doorhangers (update-available, update-restart). Decide where those should go.

6. Install flow order on 157: `addon-progress` (download) -> `addon-install-blocked` ("Continue to Installation") -> `addon-webext-permissions` -> `appMenu-addon-installed-notification`. Code or tests must not treat the first doorhanger as the "Allow site" step.

7. Page actions cannot be left out silently. Without an anchor, `_execute_page_action` shortcuts and `pageAction.openPopup()` throw "PageActions: No anchor node". Minimum: set `pageActionFor(extension).browserPageAction._anchorIDOverride` to the id of a visible Vitre element. Full button recipe: `ExtensionParent.apiManager.global.pageActionFor(extension)`; show when `api.action.isShownForTab(tab)`; icon/title from `api.action.getContextData(tab)` + `IconDetails.getPreferredIcon`; repaint by wrapping `api.updateButton`, on `TabSelect` and on location change; click -> `api.handleClick(window, { button: 0, modifiers: [] })`.

8. Permission-adding updates need Vitre UI. `const { ExtensionsUI } = ChromeUtils.importESModule("resource:///modules/ExtensionsUI.sys.mjs")`; `ExtensionsUI.on("change", ...)`; show an indicator when `ExtensionsUI.updates.size` or `ExtensionsUI.sideloaded.size` is non-zero; on click `ExtensionsUI.showUpdate(gBrowser, update)` (or `showSideloaded(gBrowser, addon)`). Each entry carries `addon`, `permissions` (the difference) and `strings.msgs`.

9. Extensions button behaviour to design around: all pinned -> opens about:addons; none installed -> Firefox onboarding panel with fox art; private window without allowed extensions -> a notice panel.

10. Private windows: extensions are off there unless the user ticks the checkbox in the install prompt or Vitre calls `ExtensionPermissions.add(id, { permissions: ["internal:privateBrowsingAllowed"], origins: [] })` then `addon.reload()` (works on a running add-on). Say so in Settings > Extensions.

11. "Load unpacked" options, pick one deliberately:
 - No patch: remember the folder, call `AddonManager.installTemporaryAddon(nsIFile)` at every start. Keeps uuid, storage.local and placement. The extension sees `onInstalled` reason "install" each launch and starts late.
 - Patch: `const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs"); XPIExports.XPIDatabase.mustSign = function () { return false; };` then `(await AddonManager.getInstallForFile(file)).install()`. Apply at every start and follow with `await XPIExports.XPIDatabase.verifySignatures()` to undo any disable that happened while unpatched. Global signing waiver while active; about:addons mislabels the add-on.
 - Vitre's own extensions only: `AddonManager.installBuiltinAddon("resource://<mapped>/<folder>/")` once (it persists); `maybeInstallBuiltinAddon(id, version, base)` is the idempotent call for later starts.

12. Tabs API reminder stands: keep gBrowser tabs. Additionally keep the stock user agent; real AMO offered "Add to Firefox" with it.

13. Testing notes: synthesize keys with `nsITextInputProcessor` (`beginInputTransactionForTests(window)`), not `dispatchEvent(new KeyboardEvent)`. `navigator.mozAddonManager` on test hosts exists only in automation mode. In multi-window captures skip non-WS_POPUP windows when compositing popups (verify/runx.py).

Unverified in this list: applying the mustSign patch from AutoConfig before XPIProvider starts; the pin-checkbox behaviour for default-panel extensions (source only).