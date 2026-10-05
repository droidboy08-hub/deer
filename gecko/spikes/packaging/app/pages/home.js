// Runs in the page. A chrome:// page is system-principal: it can import system modules directly.
(() => {
  const out = { privileged: typeof ChromeUtils !== "undefined" && typeof Services !== "undefined" };
  try {
    const { VitreProbe } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs");
    out.bump = VitreProbe.bump();
    out.moduleProcessType = VitreProbe.processType;
    out.principal = document.nodePrincipal.isSystemPrincipal ? "system" : document.nodePrincipal.origin;
  } catch (e) {
    out.error = String(e);
  }
  window.vitreHomeProbe = out;
  document.getElementById("status").textContent = "home.js: " + JSON.stringify(out);
})();
