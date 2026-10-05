// Tab search over real pages (TabSearch board: Grid with the query "glass", "3 of 6", the matched
// words marked; SwitcherKeys: Deck and Strip latched with a query), opened with Ctrl+Shift+A and by
// typing while held.
// python tools/run.py --test tests/switcher/search.js --name switcher-search --app build-switcher --timeout 240
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, state } = S;
  await spike.resize(1440, 900);
  await spike.activate();
  // Six tabs as on the board: three about glass.
  const urls = ["https://en.wikipedia.org/wiki/Float_glass", "https://www.mozilla.org/en-US/", "https://en.wikipedia.org/wiki/Glass", "https://developer.mozilla.org/en-US/", "https://en.wikipedia.org/wiki/Stained_glass", "https://www.python.org/"];
  const tabs = await S.openTabs(urls);
  await S.visit([tabs[5], tabs[4], tabs[3], tabs[2], tabs[0], tabs[1]]);
  log("tabs", b.tabs.map((t) => t.title));
  const typeQuery = (q) => S.EU.sendString(q, window);

  for (const style of ["grid", "deck", "strip"]) {
    await S.setStyle(style);
    press("Shift+A", { ctrlKey: true });
    await S.waitFor(() => state().phase === "open", { what: "search open" });
    await sleep(700);
    const empty = document.querySelector("#layer-switcher .sw-input").placeholder;
    await spike.capture(`search-${style}-empty`);
    typeQuery("glass");
    await sleep(700);
    const st = state();
    const count = document.querySelector("#layer-switcher .sw-count").textContent;
    const marks = [...document.querySelectorAll("#layer-switcher mark")].map((m) => m.textContent);
    check(`${style}: Ctrl+Shift+A, "glass": the three glass tabs, "3 of 6", the word marked`, st.list.length === 3 && count === "3 of 6" && marks.length >= 3 && marks.every((m) => m.toLowerCase() === "glass") && empty === "Search 6 tabs", { list: st.list.map(S.titleOf), count, marks, empty });
    await spike.capture(`search-${style}-glass`);
    press("Escape");
    await S.waitFor(() => state().phase === "idle");
    await sleep(300);
  }

  // A query that matches nothing, and a word found only in the address.
  await S.setStyle("grid");
  press("Shift+A", { ctrlKey: true });
  await S.waitFor(() => state().phase === "open");
  typeQuery("zzz");
  await sleep(300);
  const none = document.querySelector("#layer-switcher .sw-count").textContent;
  check("no match: 'No matches', no selection, Enter does nothing", none === "No matches" && state().sel === -1, { none, sel: state().sel });
  press("Enter");
  await sleep(200);
  check("... and the switcher stays open", state().phase === "open");
  const input = document.querySelector("#layer-switcher .sw-input");
  input.select();
  typeQuery("developer");
  await sleep(500);
  const hostHit = { list: state().list.map(S.titleOf), marks: [...document.querySelectorAll("#layer-switcher .sw-gcard mark")].map((m) => m.textContent) };
  check("a word in the address finds the tab and is marked in the address line", hostHit.list.length === 1 && hostHit.marks.includes("developer"), hostHit);
  await spike.capture("search-grid-address");
  press("Enter");
  await S.waitFor(() => state().phase === "idle");
  await sleep(300);
  check("Enter opens the match", S.active() === hostHit.list[0], S.active());
});
