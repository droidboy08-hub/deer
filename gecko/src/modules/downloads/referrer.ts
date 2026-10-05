// The Referer a download sends, worked out by Deer (net.ts dress() sends exactly this, with
// UNSAFE_URL: with a system triggering principal Necko would treat every request as cross-origin and
// trim a same-origin Referer). The policy is the page's: the one in the nsIReferrerInfo the page's
// link carried (rel=noreferrer, referrerpolicy=, the document's policy), kept on the download's
// identity by its W3C name so a restart resumes with the same rule. Stateless: imported by the
// engine (VitreDownloads.sys.ts, net.ts) and by the window module (the 'downloads' service).
//
// Firefox internals (157): nsIReferrerInfo.referrerPolicy / sendReferrer / originalReferrer and the
// policy constants on Ci.nsIReferrerInfo (dom/security/nsIReferrerInfo.idl; the same object
// gre/modules/DownloadCore.sys.mjs and nsContextMenu.sys.mjs hand to their channels).

/** Referrer policies by their W3C names; '' = the browsers' default (strict-origin-when-cross-origin). */
export type ReferrerPolicy = '' | 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'unsafe-url' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin';

const POLICIES: [constant: string, name: ReferrerPolicy][] = [
  ['EMPTY', ''],
  ['NO_REFERRER', 'no-referrer'],
  ['NO_REFERRER_WHEN_DOWNGRADE', 'no-referrer-when-downgrade'],
  ['ORIGIN', 'origin'],
  ['ORIGIN_WHEN_CROSS_ORIGIN', 'origin-when-cross-origin'],
  ['UNSAFE_URL', 'unsafe-url'],
  ['SAME_ORIGIN', 'same-origin'],
  ['STRICT_ORIGIN', 'strict-origin'],
  ['STRICT_ORIGIN_WHEN_CROSS_ORIGIN', 'strict-origin-when-cross-origin'],
];

/** A stored value narrowed to a known policy name (records written by older builds have none). */
export function asPolicy(v: unknown): ReferrerPolicy {
  return typeof v === 'string' && POLICIES.some(([, name]) => name === v) ? (v as ReferrerPolicy) : '';
}

/**
 * What an nsIReferrerInfo says, as plain data: the page address it would send from (null when it
 * sends none) and its policy. A referrer info that sends nothing reads as 'no-referrer'.
 */
export function readReferrerInfo(info: any): { url: string; policy: ReferrerPolicy } | null {
  if (!info || typeof info !== 'object') return null;
  try {
    info.QueryInterface?.(Ci.nsIReferrerInfo);
    const url: string = info.originalReferrer?.spec ?? '';
    return { url, policy: url ? policyOf(info) : 'no-referrer' };
  } catch {
    return null;
  }
}

/** The policy of an nsIReferrerInfo by its W3C name ('no-referrer' when it sends nothing). */
export function policyOf(info: any): ReferrerPolicy {
  try {
    if (!info.sendReferrer) return 'no-referrer';
    const value = Number(info.referrerPolicy);
    const found = POLICIES.find(([constant]) => (Ci.nsIReferrerInfo as any)[constant] === value);
    return found ? found[1] : '';
  } catch {
    return '';
  }
}

/** The policy's constant on Ci.nsIReferrerInfo, for building an nsIReferrerInfo again. */
export function policyConstant(policy: ReferrerPolicy): number {
  const found = POLICIES.find(([, name]) => name === policy);
  return Number((Ci.nsIReferrerInfo as any)[found ? found[0] : 'EMPTY']) || 0;
}

/**
 * The Referer `page` sends to `target` under `policy` (Referrer Policy spec, "determine request's
 * referrer"): the full address without fragment or user info, the origin, or nothing. Both are
 * nsIURI. A downgrade is an https page asking for a non-https address.
 */
export function referrerFor(page: any, target: any, policy: ReferrerPolicy): any {
  const downgrade = page.schemeIs('https') && !target.schemeIs('https');
  const sameOrigin = page.scheme === target.scheme && page.hostPort === target.hostPort;
  const full = (): any => {
    try {
      return page.mutate().setUserPass('').setRef('').finalize();
    } catch {
      return Services.io.newURI(page.specIgnoringRef);
    }
  };
  const origin = (): any => Services.io.newURI(`${page.scheme}://${page.hostPort}/`);
  switch (policy) {
    case 'no-referrer':
      return null;
    case 'unsafe-url':
      return full();
    case 'no-referrer-when-downgrade':
      return downgrade ? null : full();
    case 'origin':
      return origin();
    case 'strict-origin':
      return downgrade ? null : origin();
    case 'origin-when-cross-origin':
      return sameOrigin ? full() : origin();
    case 'same-origin':
      return sameOrigin ? full() : null;
    default:
      // '' and 'strict-origin-when-cross-origin' (the default of every current browser).
      if (sameOrigin) return full();
      return downgrade ? null : origin();
  }
}
