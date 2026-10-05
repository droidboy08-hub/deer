// Which pages need yt-dlp: their traffic has nothing downloadable (YouTube streams through SABR/UMP
// POST requests). Pure: used by the engine (ytdlp.ts, media.ts) and the window (the download mark).

/** A YouTube video page (watch, shorts, live, embed, youtu.be). */
export function ytdlpFirst(pageUrl: string): boolean {
  try {
    const u = new URL(pageUrl);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') return u.pathname.length > 1;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') return /^\/(watch|shorts\/|live\/|embed\/)/.test(u.pathname);
    return false;
  } catch {
    return false;
  }
}
