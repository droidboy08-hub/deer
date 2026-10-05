// Rapid input in Settings › Extensions: the on/off switch and the private-window switch clicked
// several times in a row (each private change reloads the add-on), Pin / Unpin repeated. The page,
// the add-on and the pill must agree afterwards, with no errors.
//   python tests/extensions/runx.py --test tests/extensions-verify/rapid.js --name extensions-verify-rapid --app build-extensions-verify-all --out tests/extensions-verify/out/rapid
// Capture: rapid-1-settled.
/* global spike, Services, CustomizableUI, WebExtensionPolicy, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["blocker", "popup", "pin1"]) await xt.install(name);
  await xt.waitFor(() => xt.pinnedInPill().length === 3, 6000);
  const settings = b.service("settings");
  settings.open("extensions");
  const page = () => document.querySelector(".vx-page");
  const card = (name) => page()?.querySelector(`.vx-card[data-extension-id="${xt.id(name)}"]`);
  await xt.waitFor(() => card("popup"), 5000);
  await sleep(500);

  // ---- on / off five times quickly (odd: ends off) ----
  for (let i = 0; i < 5; i++) {
    spike.click(card("popup").querySelector(".vs-switch"));
    await sleep(60);
  }
  await sleep(2500);
  const popup = await xt.AddonManager.getAddonByID(xt.id("popup"));
  const shown = card("popup")?.querySelector(".vs-switch")?.getAttribute("aria-checked");
  log("after 5 clicks: switch", shown, "userDisabled", popup.userDisabled, "button", !!xt.button("popup"));
  check("on/off x5: the switch, the add-on and the pill agree", (shown === "true") === !popup.userDisabled && !!xt.button("popup") === !popup.userDisabled, { shown, userDisabled: popup.userDisabled, button: !!xt.button("popup") });

  // ---- private access four times quickly (even: ends where it started, off) ----
  for (let i = 0; i < 4; i++) {
    spike.click(card("blocker").querySelectorAll(".vs-switch")[1]);
    await sleep(80);
  }
  await sleep(4000);
  const priv = card("blocker")?.querySelectorAll(".vs-switch")[1]?.getAttribute("aria-checked");
  const allowed = !!WebExtensionPolicy.getByID(xt.id("blocker"))?.privateBrowsingAllowed;
  log("after 4 private clicks: switch", priv, "allowed", allowed, "button", !!xt.button("blocker"), "pill", xt.pinnedInPill());
  check("private x4: the switch and the add-on agree, its button is back in the pill", (priv === "true") === allowed && !!xt.button("blocker"), { priv, allowed });

  // ---- Pin / Unpin six times ----
  const pinLink = () => [...(card("pin1")?.querySelectorAll(".vs-link") ?? [])].find((l) => /^(Pin|Unpin)$/.test(l.textContent));
  for (let i = 0; i < 6; i++) {
    const l = pinLink();
    if (l) spike.click(l);
    await sleep(120);
  }
  await sleep(800);
  log("after 6 pin clicks: area", xt.area("pin1"), "link", pinLink()?.textContent);
  check("pin x6: the link says what the area is", (xt.area("pin1") === "vitre-ext-bar") === (pinLink()?.textContent === "Unpin"), { area: xt.area("pin1"), link: pinLink()?.textContent });
  check("the pill matches CustomizableUI", xt.pinnedInPill().join() === CustomizableUI.getWidgetIdsInArea("vitre-ext-bar").filter((id) => document.getElementById(id)).join());
  await capture("rapid-1-settled");
  settings.close?.();
  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
