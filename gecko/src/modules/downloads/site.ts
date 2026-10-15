// A site as the background page step counts it (spikes/downloader/RESUME-DESIGN.md G1 step 3, decision 6;
// Phase 7): the per-site limit (pagestep.ts Budget) and whether the hidden page landed on another site (the
// window's resolver, src/window/modules/downloads/resolver.ts). No imports: the window bundle uses it too.

/**
 * The registrable domain (eTLD+1) of an address, the host for an IP or a single label; '' when it is not one.
 * Without the scheme (review of Phase 7: Services.eTLD.getSite() keeps it, so a page the site or HTTPS-First
 * moved from http to https was "another site", its links were skipped and the row was told the page may need
 * a sign-in).
 */
export function siteKey(url: string): string {
  try {
    const uri = Services.io.newURI(url);
    try {
      return Services.eTLD.getBaseDomain(uri);
    } catch {
      return uri.asciiHost || uri.host;
    }
  } catch {
    return '';
  }
}
