// The background page step (spikes/downloader/RESUME-DESIGN.md G1 automatic step 3, G2 automatic step 4,
// decisions 6 and 7 of section 9; Phase 7): when the original address (and, for a stream, its master playlist
// and yt-dlp) found nothing, the download's page is opened out of sight in its container (a window's resolver,
// src/window/modules/downloads/resolver.ts) and what it shows nominates new addresses. Every one of them goes
// through the same-file proof (proof.ts proveAddress(); a stream through streamProof): the page never decides.
// This file holds what needs no network or window; the engine (VitreDownloads.sys.ts pageStep()) runs it.
//
//   - Limits (decision 6): one hidden page at a time (the engine's queue), at most PER_SITE pages per site
//     (eTLD+1 of the page) per SITE_WINDOW (Budget: the 7th waits until the oldest leaves the hour), at most
//     once per download per PER_ROW (rec.pageAt), LOAD_MS to load plus COLLECT_MS to collect.
//   - File candidates, in order (G1 step 3): what the page started by itself (the claim registry: Firefox's
//     download from the hidden tab, cancelled before a row is made), the download's own address again (the
//     page load may have set the cookie its host checks), the page's links scored (pickLinks(): the same path
//     shape +4, the same name +3, the anchor text +1, the same site +1; the top TOP_LINKS scoring MIN_SCORE or
//     more), the media MediaWatch saw under the hidden tab whose bytes equal the download's total, and the main
//     video ('downloads:main-video').
//   - Stream candidates (G2 step 4): the HLS or DASH addresses MediaWatch saw under the hidden tab, likeliest
//     master first (media.ts rankStreams()), on the stream's host or path shape; the engine describes each
//     fresh (no 60 s cache), keeps those within 1 s of the stream's duration and not protected, and the stream
//     re-picks its rung there (hls.ts fromSource()).
//   - Deer never clicks, submits a form, signs in or touches a CAPTCHA: only links already on the page and
//     requests the page made by itself count. A page that lands on another site or shows a password field
//     where nothing was the file makes the row ask for its page (need 'page', SIGN_IN).
//   - Every candidate is proven before the verdict (review of Phase 7): another file of the same name listed
//     above the row's own (a 64-bit installer above the 32-bit one) is the real file over other bytes only once
//     nothing later proved SAME, and one a link, a player or the main video nominated always asks (File
//     changed): never a silent start over from another file (VitreDownloads.sys.ts pageStep()).
import { pathShape, stems } from './attach';
import { extOf, nameFromUrl } from './naming';
import { siteKey } from './site';
import type { PageLink, PageMedia } from './types';

/** The page has this long to load, then this long to show what it fetches (decision 6). */
export const LOAD_MS = 30 * 1000;
export const COLLECT_MS = 10 * 1000;
/** At most this many hidden pages per site per this long (decision 6): more waits. */
export const PER_SITE = 6;
export const SITE_WINDOW = 60 * 60 * 1000;
/** At most one page step per download per this long (decision 6). */
export const PER_ROW = 30 * 60 * 1000;
/** The top links probed, and the score a link needs (G1 step 3). */
export const TOP_LINKS = 5;
export const MIN_SCORE = 3;
/** A link this strong (the same path shape and name) ends the collecting early. */
export const STRONG = 7;
/** A stream address seen this long ago ends the collecting early (a player asks for its master, then a media playlist). */
export const STREAM_SETTLE = 2000;
/** need 'page' for a download whose page wants the person (G1 step 3): the row's caption ("The page may need you to sign in."). */
export const SIGN_IN = 'The page may need you to sign in';

/** A site as the per-site limit counts it: site.ts siteKey() (the registrable domain, without the scheme). */
export { siteKey };

/**
 * At most PER_SITE pages per site per SITE_WINDOW (decision 6). In memory: a restart starts the count again,
 * which at worst opens six more pages of a site in that hour.
 */
export class Budget {
  private used = new Map<string, number[]>();

  private recent(site: string, now: number): number[] {
    const list = (this.used.get(site) ?? []).filter((t) => now - t < SITE_WINDOW);
    if (list.length) this.used.set(site, list);
    else this.used.delete(site);
    return list;
  }

  /** 0 when the site may have another page now; otherwise when it may (the oldest leaves the hour). */
  freeAt(site: string, now = Date.now()): number {
    const list = this.recent(site, now);
    return list.length < PER_SITE ? 0 : list[0] + SITE_WINDOW;
  }

  use(site: string, now = Date.now()): void {
    this.used.set(site, [...this.recent(site, now), now]);
  }

  /** Tests: forget every page counted. */
  clear(): void {
    this.used.clear();
  }
}

/** What the engine knows of the row a page's links are scored for: its names and addresses (2.2 nominators). */
export interface RowNames {
  names: string[];
  urls: string[];
}

/**
 * A link's score for a row (G1 step 3): +4 for the same path shape as one of the row's addresses (origin and
 * path, the query dropped: a fresh signature on the same file), +3 for a name in common (its download
 * attribute, or the last part of its address, against the row's names and addresses), +1 when its text names
 * the file (one of the row's own names) or says "download", +1 on the same site as the row's address.
 */
export function scoreLink(link: PageLink, row: RowNames, sameSite: (a: string, b: string) => boolean): number {
  let n = 0;
  const shape = pathShape(link.href);
  if (shape && row.urls.some((u) => pathShape(u) === shape)) n += 4;
  const ours = stems(row.names, row.urls);
  for (const x of stems([link.download ?? ''], [link.href])) {
    if (ours.has(x)) {
      n += 3;
      break;
    }
  }
  const text = link.text.toLowerCase();
  const own = stems(row.names);
  if (/\bdownload\b/.test(text) || [...own].some((x) => x.length >= 3 && text.includes(x))) n += 1;
  if (row.urls.length && sameSite(link.href, row.urls[0])) n += 1;
  return n;
}

/** The links worth probing (G1 step 3): the top TOP_LINKS scoring MIN_SCORE or more, best first (page order breaks ties), none in `skip`. */
export function pickLinks(links: PageLink[], row: RowNames, sameSite: (a: string, b: string) => boolean, skip: Set<string>): { link: PageLink; score: number }[] {
  const seen = new Set<string>();
  const scored: { link: PageLink; score: number; at: number }[] = [];
  links.forEach((link, at) => {
    if (!/^https?:\/\//i.test(link.href) || skip.has(link.href) || seen.has(link.href)) return;
    seen.add(link.href);
    const score = scoreLink(link, row, sameSite);
    if (score >= MIN_SCORE) scored.push({ link, score, at });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, TOP_LINKS)
    .map(({ link, score }) => ({ link, score }));
}

/** A link's names for realFile() (attach.ts): its download attribute and the name its address gives (a script's name is dropped there). */
export function linkNames(link: PageLink): string[] {
  const fromUrl = nameFromUrl(link.href);
  return [link.download ?? '', extOf(fromUrl) ? fromUrl : ''].filter(Boolean);
}

/** Media the hidden page loaded that is exactly the download's size (G1 step 3): a player's own file. */
export function sameSizeMedia(media: PageMedia[], total: number): string[] {
  if (!(total > 0)) return [];
  return media.filter((m) => (m.kind === 'video' || m.kind === 'audio') && m.bytes === total).map((m) => m.url);
}

/** A stream address on the stream's own host or with its path shape (G2 step 4): the same site's player, not an ad's. */
export function streamNear(url: string, own: string[]): boolean {
  let host = '';
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return own.some((u) => {
    try {
      return new URL(u).host.toLowerCase() === host || pathShape(u) === pathShape(url);
    } catch {
      return false;
    }
  });
}
