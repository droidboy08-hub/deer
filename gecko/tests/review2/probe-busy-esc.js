// Probe: where is focus and what does Esc do when a panel is opened over a busy (hung) page?
/* global spike, Services, W */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { log, sleep, waitFor } = spike;
  const b = window.vitre;
  await spike.resize(1280, 820);
  await spike.activate();
  const downloads = b.service("downloads");
  const settings = b.service("settings");
  const focusInfo = () => {
    const a = document.activeElement;
    const f = Services.focus.focusedElement;
    return { active: a?.localName + "." + (a?.className || a?.id || ""), focused: f ? f.localName + "." + (f.className || f.id || "") : null, inRoot: !!f && b.root.contains(f) };
  };
  const probe = async (label, busy) => {
    const t = busy ? await W.open(window, W.xurl("busy?ms=25000")) : await W.open(window, W.P("calm"));
    if (busy) await waitFor(() => t.title === "Busy now", { timeout: 8000 }).catch(() => null);
    b.focusPage();
    await sleep(300);
    for (const [name, open, isOpen, close] of [
      ["downloads.openPanel", () => downloads.openPanel(), () => downloads.isPanelOpen(), () => window.vitreDownloads.panel.hide()],
      ["Ctrl+J", () => W.key(window, "j", { ctrlKey: true }), () => downloads.isPanelOpen(), () => window.vitreDownloads.panel.hide()],
      ["settings.open", () => settings.open("general"), () => settings.isOpen(), () => settings.close()],
    ]) {
      b.focusPage();
      await sleep(200);
      open();
      const f0 = focusInfo();
      const n0 = b.keys.log?.length ?? 0;
      W.key(window, "KEY_Escape");
      await sleep(900);
      const f = focusInfo();
      const first = isOpen();
      W.key(window, "KEY_Escape");
      await sleep(900);
      log(`${label} ${name} (Esc at once): focus at open ${JSON.stringify(f0)}, later ${JSON.stringify(f)} -> after 1st Esc open=${first}, after 2nd open=${isOpen()} router: ${JSON.stringify((b.keys.log || []).slice(n0))}`);
      if (isOpen()) close();
      await sleep(500);
    }
    b.closeTab(t);
    await sleep(500);
  };
  await probe("calm", false);
  await probe("busy", true);
});
