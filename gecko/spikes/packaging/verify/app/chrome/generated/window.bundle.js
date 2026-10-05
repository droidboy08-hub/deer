"use strict";
(() => {
  // src/chrome/bar.ts
  function describeBar(tabCount) {
    return `bar for ${tabCount} tab${tabCount === 1 ? "" : "s"}`;
  }

  // src/chrome/window.ts
  window.VitreTsWindow = { bar: describeBar(gBrowser.tabs.length), builtWith: "esbuild" };
})();
