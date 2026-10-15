// A stream download's stable key (spikes/downloader/RESUME-DESIGN.md G2 manual fallback, 5.1 streamKey;
// Phase 6): the page's origin and path, the rounded duration and the title. The pill on a page opened
// again finds the old row by it, where the offer's own key (media.ts: the tab's browserId and the signed
// address) changes with every session and every new signed address. yt-dlp's offers keep their own key,
// 'ytdlp|<webpage_url>', which already is stable. Pure: used by the engine and the window (video.ts).

/** "https://tideline.fm/watch/42|245|molten: a 4k study of glass in motion" ('' without a page). */
export function streamKeyOf(pageUrl: string, duration: number, title: string): string {
  let page = '';
  try {
    const u = new URL(pageUrl);
    if (!/^https?:$/.test(u.protocol)) return '';
    page = `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
  const secs = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  return `${page}|${secs}|${(title || '').trim().replace(/\s+/g, ' ').replace(/\|/g, '/').toLowerCase()}`;
}

/**
 * Two stream keys name the same video: the same page and title, durations at most a second apart (an
 * element's 24.49 s and a playlist's 24.51 s round apart). An unknown duration (0) matches only an unknown
 * one (review of Phase 6: it matched any length). yt-dlp keys compare as they are. The key only nominates;
 * the row's proof decides whether the page's stream is the one it saved (RESUME-DESIGN.md 2.2).
 */
export function sameStream(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith('ytdlp|') || b.startsWith('ytdlp|')) return false;
  const pa = a.split('|');
  const pb = b.split('|');
  if (pa.length < 3 || pb.length < 3) return false;
  const da = Number(pa[pa.length - 2]);
  const db = Number(pb[pb.length - 2]);
  const head = (p: string[]): string => p.slice(0, -2).join('|');
  const tail = (p: string[]): string => p[p.length - 1];
  return head(pa) === head(pb) && tail(pa) === tail(pb) && da > 0 && db > 0 && Math.abs(da - db) <= 1;
}
