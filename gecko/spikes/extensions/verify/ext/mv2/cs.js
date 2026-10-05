// Content script: proves injection (a visible strip + a DOM marker) and messaging to the background.
(async () => {
  if (window.top !== window) return;
  document.documentElement.setAttribute("data-vitre-mv2-cs", "1");
  const strip = document.createElement("div");
  strip.id = "vitre-mv2-strip";
  strip.textContent = "MV2 content script injected";
  strip.style.cssText =
    "position:fixed;left:12px;bottom:12px;z-index:2147483647;font:600 13px 'Segoe UI',sans-serif;" +
    "background:#b01c28;color:#fff;padding:6px 12px;border-radius:14px";
  (document.body || document.documentElement).appendChild(strip);
  try {
    const r = await browser.runtime.sendMessage({ type: "cs-hello", url: location.href });
    strip.textContent += " | background answered: " + JSON.stringify(r);
  } catch (e) {
    strip.textContent += " | background error: " + e;
  }
})();
