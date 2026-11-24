// Site-specific downloader rule for reanime (watch host reanime.cz / reanime.to,
// player host flixcloud.cc), plus the general cross-origin embed fallback.
//
// On reanime.cz / reanime.to:
// 1. The player is an iframe (#video-player) hosted on flixcloud.cc.
// 2. The player fetches /api/m3u8/<token> (JSON), decrypts it, and hands the resulting
//    .m3u8 URL to hls.js.
// 3. That playlist request carries the Referer: https://flixcloud.cc/e/<id>?v=...
// 4. Deer records that .m3u8 as an HLS stream (ignoring the /api/m3u8/ token JSON),
//    prefers the flixcloud player candidates over top-page media, and fetches directly
//    as the player frame with unsafe-url and the tab's cookie jar partition.
//
// All other sites keep the old path (top-page request first, fallback on 4xx).

const AD_FRAME = /doubleclick|googlesyndication|googleadservices|adnxs|adsystem|moatads|amazon-adsystem|\/ads?\//i;

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function hostOf(urlOrHost: string): string {
  if (!urlOrHost) return '';
  try {
    const host = (urlOrHost.includes('://') ? new URL(urlOrHost).hostname : urlOrHost).toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function isReanime(pageUrl: string): boolean {
  const host = hostOf(pageUrl);
  return /reanime\./i.test(host);
}

export function isFlixcloud(urlOrHost: string): boolean {
  const host = hostOf(urlOrHost);
  return /flixcloud\./i.test(host);
}

/**
 * A playlist address the engine's strict end-of-path test misses.
 * For flixcloud.cc on reanime, classifies any URL containing .m3u8 (ignoring the /api/m3u8/ JSON token).
 * For general sites, subframe URLs containing .m3u8.
 */
export function looseFramePlaylist(
  url: string,
  inFrame: boolean,
  documentUrl = '',
  played = '',
  mime = ''
): boolean {
  if (!url) return false;
  // If JSON is returned, it is an API response (like /api/m3u8/<token>), not an HLS playlist.
  if (/json/i.test(mime) || /\/api\/m3u8\//i.test(url)) return false;

  const flix = isFlixcloud(documentUrl) || isFlixcloud(played) || isFlixcloud(url);
  if (flix && /\.m3u8/i.test(url)) return true;

  return inFrame && /\.m3u8/i.test(url);
}

/**
 * For reanime.cz / reanime.to: prefer candidates loaded by the flixcloud player iframe
 * or HLS streams recorded for the tab.
 */
export function reanimeCandidates<T extends { url: string; frameUrl: string; kind: string }>(
  pageUrl: string,
  items: T[]
): T[] | null {
  if (!isReanime(pageUrl)) return null;
  const flix = items.filter((c) => isFlixcloud(c.frameUrl) || isFlixcloud(c.url) || c.kind === 'hls');
  return flix.length ? flix : null;
}

/**
 * Media a cross-origin frame loaded. Null when the page has none, so the caller does not
 * start a second pass. Ad frames are left out: a failed episode must not offer a preroll.
 */
export function embedFallback<T extends { frameUrl: string }>(pageUrl: string, items: T[]): T[] | null {
  const page = originOf(pageUrl);
  const frames = items.filter((c) => {
    const frame = originOf(c.frameUrl);
    return !!frame && frame !== page && !AD_FRAME.test(c.frameUrl);
  });
  return frames.length ? frames : null;
}

const playlistCache = new Map<string, string>();
let flixPk = '';

export function rememberPlaylist(url: string, body: string): void {
  let toStore = body;
  if (toStore && isEncryptedFlixManifest(toStore) && flixPk) {
    const dec = decryptFlixManifest(toStore, flixPk);
    if (dec && (dec.includes('#EXTM3U') || dec.includes('<MPD'))) {
      toStore = dec;
    }
  }
  playlistCache.set(url, toStore);
  if (playlistCache.size > 200) playlistCache.delete(playlistCache.keys().next().value as string);
}

export function getCachedPlaylist(url: string): string | undefined {
  let body = playlistCache.get(url);
  if (body && isEncryptedFlixManifest(body) && flixPk) {
    const dec = decryptFlixManifest(body, flixPk);
    if (dec && (dec.includes('#EXTM3U') || dec.includes('<MPD'))) {
      body = dec;
      playlistCache.set(url, dec);
    }
  }
  return body;
}

export function setFlixPk(pk: string): void {
  flixPk = pk;
  if (pk) {
    for (const [url, body] of playlistCache.entries()) {
      if (isEncryptedFlixManifest(body)) {
        const dec = decryptFlixManifest(body, pk);
        if (dec && (dec.includes('#EXTM3U') || dec.includes('<MPD'))) {
          playlistCache.set(url, dec);
        }
      }
    }
  }
}

export function getSavedFlixPk(): string {
  return flixPk;
}

/**
 * Decompresses wire bytes (e.g. zstd, gzip, deflate, br) into a UTF-8 string.
 */
export function decompressResponse(rawByteString: string, encoding = ''): string {
  if (!rawByteString) return '';
  let enc = encoding.toLowerCase().trim();
  if (!enc || enc === 'identity') {
    // Check magic numbers: zstd is 0x28 0xb5 0x2f 0xfd, gzip is 0x1f 0x8b
    if (
      rawByteString.charCodeAt(0) === 0x28 &&
      rawByteString.charCodeAt(1) === 0xb5 &&
      rawByteString.charCodeAt(2) === 0x2f &&
      rawByteString.charCodeAt(3) === 0xfd
    ) {
      enc = 'zstd';
    } else if (rawByteString.charCodeAt(0) === 0x1f && rawByteString.charCodeAt(1) === 0x8b) {
      enc = 'gzip';
    }
  }
  if (!enc || enc === 'identity') {
    const bytes = new Uint8Array(rawByteString.length);
    for (let i = 0; i < rawByteString.length; i++) bytes[i] = rawByteString.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  try {
    const { CommonUtils } = ChromeUtils.importESModule('resource://services-common/utils.sys.mjs');
    const decompressed = CommonUtils.convertString(rawByteString, enc, 'uncompressed');
    const bytes = new Uint8Array(decompressed.length);
    for (let i = 0; i < decompressed.length; i++) bytes[i] = decompressed.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    try {
      const bytes = new Uint8Array(rawByteString.length);
      for (let i = 0; i < rawByteString.length; i++) bytes[i] = rawByteString.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return rawByteString;
    }
  }
}

/**
 * Whether the text looks like an encrypted Flixcloud manifest (Base64 string without #EXTM3U header).
 */
export function isEncryptedFlixManifest(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('#EXTM3U')) return false;
  return /^[A-Za-z0-9+/=]{100,}$/.test(trimmed);
}

/**
 * Decrypt a base64 XOR manifest with a key (string or hex).
 */
export function decryptFlixManifest(b64: string, key: string): string {
  try {
    const trimmed = b64.trim();
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    let keyBytes: Uint8Array;
    // pk from FlixCloud is a base64-encoded 32-byte key!
    try {
      const kbin = atob(key.trim());
      keyBytes = new Uint8Array(kbin.length);
      for (let i = 0; i < kbin.length; i++) keyBytes[i] = kbin.charCodeAt(i);
    } catch {
      if (/^[0-9a-fA-F]{32,64}$/.test(key)) {
        const match = key.match(/.{1,2}/g)!;
        keyBytes = new Uint8Array(match.map((b) => parseInt(b, 16)));
      } else {
        keyBytes = new TextEncoder().encode(key);
      }
    }
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return new TextDecoder('utf-8').decode(out);
  } catch {
    return '';
  }
}

