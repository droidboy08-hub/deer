// Home's address and what counts as "showing Home". Pure constants: safe to import from any bundle
// (url.ts and shortcuts.ts carry per-bundle state and are not; VitreStartup imports this file).

/** Deer's Home page. Registered by VitreStartup once src/pages/home exists. */
export const HOME_URL = 'about:vitre-home';

/**
 * A tab on one of these shows as Home (empty address, placeholder in the pill): Home itself and
 * the blank pages a tab sits on before anything was asked of it. A tab whose load is still on its
 * way is not blank: Browser.refresh() reads the pending address first (fx.tabUrl).
 */
export function isHomeUrl(url: string): boolean {
  return !url || url === HOME_URL || url === 'about:blank' || url === 'about:newtab' || url === 'about:home';
}
