"use strict";
(() => {
  // ts-proof/src/chrome/bar.ts
  function describeBar(tabCount) {
    return `bar for ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
  }

  // ts-proof/src/chrome/window.ts
  window.VitreTsWindow = { bar: describeBar(gBrowser.tabs.length), builtWith: "esbuild" };
})();
