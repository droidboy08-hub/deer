// Classic subscript that uses dynamic import() (window.eval is blocked by browser.xhtml's CSP).
window.__vitreImport = (url) => import(url);
