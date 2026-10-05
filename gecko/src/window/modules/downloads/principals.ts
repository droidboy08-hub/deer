// Whose download a page-derived address is: the page's principal, referrer policy and cookie jar,
// turned into the identity the engine keeps on the record (src/modules/downloads/types.ts
// IdentityJSON principal / referrerPolicy / cookieJarSettings; net.ts makes the channel from them
// the way Firefox's Save Link As does, nsContextMenu.sys.mjs saveHelper). Serialized, so a download
// resumed after a restart is still the page's.
//
// Firefox internals (157): E10SUtils.serializePrincipal / serializeCookieJarSettings /
// deserializeReferrerInfo / deserializeCookieJarSettings (gre/modules/E10SUtils.sys.mjs; a
// ClickHandlerParent request carries its referrer info serialized), nsIPrincipal.isContentPrincipal /
// isSystemPrincipal, nsIScriptSecurityManager.checkLoadURIStrWithPrincipal (the check a page's own
// link click goes through).
import { readReferrerInfo, type ReferrerPolicy } from '../../../modules/downloads/referrer';

let e10s: any = null;
const E10SUtils = (): any => (e10s ??= ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs').E10SUtils);

/** What the engine is told about the page a download came from. */
export interface PageIdentity {
  /** The address the Referer is worked out from (the page, or the referrer info's original referrer). */
  pageUrl: string;
  /** Serialized page principal: the channel's loading and triggering principal. '' = system (Deer's own choice). */
  principal: string;
  referrerPolicy: ReferrerPolicy;
  cookieJarSettings: string;
}

/** A referrer info as an object (callers hand over the object or its E10SUtils serialization). */
function referrerObject(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return E10SUtils().deserializeReferrerInfo(v);
  } catch {
    return null;
  }
}

function jarString(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') {
    // Already serialized: keep it only if it reads back.
    try {
      return E10SUtils().deserializeCookieJarSettings(v) ? v : '';
    } catch {
      return '';
    }
  }
  try {
    return String(E10SUtils().serializeCookieJarSettings(v) ?? '');
  } catch {
    return '';
  }
}

/**
 * The page identity for `url` from what the caller handed over. A content principal makes it the
 * page's download; the system principal (or none) leaves it Deer's (system principal, the page's
 * address as Referer under its policy). Null when the page may not load the address at all.
 */
export function pageIdentity(url: string, principal: unknown, referrerInfo: unknown, cookieJarSettings: unknown, fallbackPage: string): PageIdentity | null {
  const ref = readReferrerInfo(referrerObject(referrerInfo));
  const pageUrl = ref?.url || fallbackPage;
  const referrerPolicy: ReferrerPolicy = ref?.policy ?? '';
  const p = principal as { isContentPrincipal?: boolean; isSystemPrincipal?: boolean } | null | undefined;
  if (!p || p.isSystemPrincipal || !p.isContentPrincipal) return { pageUrl, principal: '', referrerPolicy, cookieJarSettings: '' };
  try {
    Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(p, url, Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
  } catch {
    return null;
  }
  let serialized = '';
  try {
    serialized = String(E10SUtils().serializePrincipal(p) ?? '');
  } catch {
    serialized = '';
  }
  if (!serialized) return null;
  return { pageUrl, principal: serialized, referrerPolicy, cookieJarSettings: jarString(cookieJarSettings) };
}
