// One list of media addresses for the DRM rule, shared by the engine (VitreDownloads.sys.ts start())
// and the window's 'downloads' service (src/window/modules/downloads/index.ts), so the two cannot
// drift apart. Stateless: safe to import from both bundles.

/** Addresses that are media (or a stream's playlist or segment): never downloaded from a tab that uses DRM. */
export const MEDIA_URL = /\.(m3u8|mpd|mp4|m4v|m4s|webm|mov|mkv|m4a|mp3|aac|ts)(\?|#|$)/i;
