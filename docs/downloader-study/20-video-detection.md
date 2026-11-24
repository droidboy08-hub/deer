# Finding the video on a page

## In one paragraph

Deer finds a page's video with two eyes. The first eye is in the browser engine: it sees the headers of every HTTP response a tab receives (address, MIME type, size, which frame asked, what kind of request it was) and keeps a short list of "candidates" per page: HLS playlists, DASH manifests, and whole video or audio files. Segments, small files, thumbnails, ads and files fetched by script are kept out. The second eye is a small module inside the page: it reports the `<video>` under the pointer (or the page's main video), its `currentSrc`, size, length, and whether it uses DRM. When the person asks to download, Deer builds an "offer": it refuses DRM and live streams, sends YouTube pages to yt-dlp, then tries HLS (the likeliest master playlist first, confirmed by reading it), then DASH, then the largest direct file, then yt-dlp as a last resort. A real offer is a quality ladder (one row per height, with a size estimate) and a suggestion ("Best for this screen"). If nothing works, Deer says why in a short note. DRM is checked many times, from the page's first key request to the final download start, and a page that used DRM stays "protected" for as long as that document is shown.

## Files

Files in this section (all read fully):

| File | Lines | Role |
|---|---|---|
| `gecko/src/actors/page/downloads.ts` | 404 | The page module (runs in every frame). Reports the hovered video, the main video, media elements that loaded a file, DRM `encrypted` events, Alt+click links, and the page's links for the background page step. |
| `gecko/src/modules/downloads/media.ts` | 573 | `MediaWatch`: the network eye (response observer), per-document records, DRM state, candidate filtering, stream ranking, and `offer()`, which decides between HLS, DASH, direct file and yt-dlp and builds the quality ladder. |
| `gecko/src/modules/downloads/media-url.ts` | 6 | `MEDIA_URL`: one regular expression of media file extensions, used to refuse media from a DRM tab. |
| `gecko/src/modules/downloads/streamkey.ts` | 39 | A stable key for "the same video" (page + rounded length + title), used to continue a stopped stream from its page. |
| `gecko/src/window/modules/downloads/video.ts` | 1277 | The window side: the hover pill, Ctrl+Shift+D, the tab's download mark, the quality picker, "nothing found" notes, Continue. |
| `gecko/src/window/modules/downloads/resolver.ts` | 432 | The window half of the **background page step**: opens a download's page in a hidden, muted tab to find fresh addresses after a link expired. Note: this file does NOT choose between file, HLS, DASH and yt-dlp; that choice is `MediaWatch.offer()` in `media.ts`. |
| `gecko/spikes/downloader/verify/engine/VitreMedia.sys.mjs` | 211 | The spike's first version of the network eye (history: shows what was changed and why). |
| `gecko/spikes/downloader/verify/vboot-media2.js` | 179 | Spike verification: Widevine without a CDM, a background tab in a second window, real pages. |
| `gecko/tests/downloads/resolve.js` | 763 | Tests of the background page step (sections `stream` and `stream2` use the stream ranking). |
| `gecko/tests/downloads/streams.js` | 174 | Tests: mark, pill, HLS ladder, picker, Ctrl+Shift+D on a DASH page. |

Also read, because the files above depend on them (cited where used): `gecko/src/modules/downloads/playlist.ts` (229, HLS parsing and DRM key rule), `gecko/src/modules/downloads/dash.ts` (245, MPD parsing and DRM rule), `gecko/src/modules/downloads/sites.ts` (15, which sites go to yt-dlp first), `gecko/src/modules/downloads/ytdlp.ts` (`probe()`, lines 185-308), `gecko/src/modules/downloads/naming.ts` (`isOpaque()`), `gecko/src/modules/downloads/pagestep.ts` (constants), `gecko/src/modules/downloads/table.ts` (`DURATION_SLACK`, rung fingerprints), `gecko/src/modules/VitreDownloads.sys.ts` (`start()` DRM gate, `pageStreams()`), `gecko/src/window/modules/downloads/index.ts` (DRM gate), `gecko/src/window/modules/menus/page-items.ts` (video menu), tests `drm.js` (67), `mark.js` (40), `spa.js` (50), `embed.js` (70), `ui.js` (pill section), `stream-expiry.js` (Continue section), `tests/downloads/server.py` (test pages), `gecko/spikes/downloader/RESULT.md`, `gecko/spikes/downloader/RESUME-DESIGN.md`, `gecko/spikes/downloader/verify/vboot-media3.js`, `design/DESIGN-NOTES.md`.

Note on evidence: the spike's log files (`verify/out/...`) are not in the repository. Where I cite spike results, the source is the text in `gecko/spikes/downloader/RESULT.md`.

## Words used in this section

- **MIME type**: the `Content-Type` response header, for example `video/mp4` or `application/vnd.apple.mpegurl`. Deer uses only the part before `;`, lowercased.
- **Range request**: a request with a `Range: bytes=START-END` header that asks for part of a file. A server that supports it answers **HTTP 206 Partial Content** with a **`Content-Range`** header like `bytes 0-0/1234` (the number after `/` is the full file size). `Content-Length` is the size of this answer only.
- **HLS** (HTTP Live Streaming): video cut into many small files (**segments**), listed in a text **playlist** (`.m3u8`) that starts with `#EXTM3U`. A **master playlist** lists several **variants** (qualities), each on an `#EXT-X-STREAM-INF:` line with `BANDWIDTH`, optional `AVERAGE-BANDWIDTH`, `RESOLUTION`, `CODECS` and `AUDIO` (an audio group). A **media playlist** lists the segments of one quality (`#EXTINF:` lines). `#EXT-X-ENDLIST` means the list is complete (not live). A **rendition** (`#EXT-X-MEDIA:`) is an extra track, usually a separate audio track, with `GROUP-ID`, `LANGUAGE`, `NAME`, `DEFAULT=YES`.
- **DASH**: another streaming format. Its list is an XML **manifest** (`.mpd`, root element `<MPD>`) with `Period`, `AdaptationSet` and `Representation` (one quality) elements. `type="dynamic"` means live.
- **Init segment**: a small header file that must come before the media segments of fragmented MP4 (`#EXT-X-MAP` in HLS, `initialization` in DASH).
- **TS / fMP4**: the two segment containers: MPEG transport stream (`.ts`) and fragmented MP4 (`.m4s`, `.mp4`).
- **Remux / mux**: copy video and audio into one file without re-encoding them.
- **MSE** (Media Source Extensions): a player (hls.js, dash.js, Shaka) downloads segments itself with `fetch`/XHR and feeds them to the `<video>`. The element's address is then a `blob:` URL, which means nothing outside the page.
- **EME** (Encrypted Media Extensions): the web API for DRM. A page asks for a **key system** (`navigator.requestMediaKeySystemAccess`), for example Widevine (`com.widevine.alpha`), PlayReady (`com.microsoft.playready...`), FairPlay (`com.apple.fps...`) or ClearKey (`org.w3.clearkey`). The **CDM** (Content Decryption Module) does the decrypting. An `encrypted` event fires on the media element when encrypted media arrives. `video.mediaKeys` is set when keys are attached.
- **PSSH**: a DRM box with key-system data. In DASH it sits inside a `<ContentProtection>` element.
- **AES-128** (HLS): each segment is encrypted whole with a 16-byte key from a key file. Not DRM: anyone who can fetch the key file can decrypt. **SAMPLE-AES**: only the media samples inside the segment are encrypted; FairPlay uses it. **`KEYFORMAT`**: names the key system of an HLS key; `identity` (the default) means a plain key file.
- **Frame / iframe**: a page inside the page. The **top document** is the tab's own page.
- **SPA** (single-page app): a site that changes the address with `history.pushState` without loading a new document (YouTube, X, Instagram).
- **Referer / Origin**: request headers that name the page that asked. **Hotlink protection**: a server that refuses requests whose Referer is not its own site.
- **browserId**: Gecko's id of a tab; it stays the same when the tab changes process. **innerWindowId**: Gecko's id of one loaded document (a new page load gets a new one).
- **yt-dlp**: an external command-line program that knows how to extract video from many sites. **ffmpeg**: an external program used to join video and audio.

## Overview: who tells what to whom

```
 page (every frame)                        engine (parent process)                   window (UI)
 actors/page/downloads.ts                  modules/downloads/media.ts                 window/modules/downloads/video.ts
 ---------------------------               ---------------------------                ---------------------------------
 pointer over a <video>  --downloads:hover------------------------------------------>  pill; asks offer()
 <video> loaded a file   --downloads:element-media--------------------------------->   media.element() / media.eme()
 'encrypted' event       --downloads:drm------------------------------------------>    media.eme({encrypted})
                                           every HTTP response (headers) -> seen()
                                           Firefox's EME actor -> eme(keySystem)
                                           notify (300 ms debounce) -------------->    tab's download mark
 'downloads:main-video'  <--query (Ctrl+Shift+D)---------------------------------------
                                           offer(tab, video) <---------------------    picker / note
```

The engine never trusts the page: the page module only reads (no page script is run, `gecko/src/actors/page/downloads.ts:30-31`), and the window checks every field of a page report before use (`asVideo()`, `gecko/src/window/modules/downloads/video.ts:1232-1270`: numbers must be finite, `src` cut to 8192 characters, title to 300).

---

## Mechanism 1: The network eye (classifying every response)

### What it does

While a page loads, Deer silently notes every playlist, manifest and whole media file the page receives. The tab's download mark lights up as soon as one is seen. Nothing is fetched by Deer at this stage: it only reads response headers that pass by.

### How it works

Deer observes three Gecko notifications for every HTTP channel, in the parent process: `http-on-examine-response`, `http-on-examine-cached-response`, `http-on-examine-merged-response` (`gecko/src/modules/downloads/media.ts:31`, installed at `:122-127`). The cached and merged ones matter: media served from the HTTP cache still counts. Any error in detection is swallowed so it can never disturb page loading (`:160-166`).

For each response (`seen()`, `gecko/src/modules/downloads/media.ts:204-255`):

```
seen(channel):
  bc = channel.loadInfo.browsingContext
  if bc.top.browserId is missing: return              // the browser's own requests (Deer's downloader too)
  type = from loadInfo.externalContentPolicyType:
           TYPE_MEDIA                -> 'media'      (a <video>/<audio> element's own request)
           TYPE_XMLHTTPREQUEST, FETCH -> 'xhr'        (script requests: MSE players)
           TYPE_OTHER, TYPE_OBJECT    -> 'other'
           TYPE_SUBDOCUMENT           -> 'subFrame'   (an iframe whose document is the file)
           anything else (TYPE_DOCUMENT: a top-level page or a download click) -> ignore
  if status not in 200..299 or method != GET: return
  mime = Content-Type before ';', trimmed, lowercased
  if /mpegurl/ in mime  or url matches /\.m3u8(\?|#|$)/i:  kind = 'hls'
  elif /dash\+xml/ in mime or url matches /\.mpd(\?|#|$)/i: kind = 'dash'
  elif type != 'xhr' and url !~ SEGMENT_EXT and url !~ HINTS:
      if mime starts 'video/' and mime != 'video/mp2t':                kind = 'video'
      elif mime starts 'audio/' and 'mpegurl' not in mime:            kind = 'audio'
      elif mime == 'application/octet-stream'
           and url matches /\.(mp4|webm|mov|mkv|m4v)(\?|#|$)/i:       kind = 'video'
  if no kind: return
  bytes = N from Content-Range ".../N"  else Content-Length  else 0
  if kind in (video, audio) and 0 < bytes < 500000: return           // too small to be the video
  doc = (bc is the top frame) ? loadInfo.innerWindowID : 0           // 0 = the tab's current document
  record = tab(browserId, doc)
  record.items[url] = { url, kind, bytes: max(bytes, old bytes), at: now, frameUrl }
  if record.items.size > 200: delete the oldest item
  remember size in a global size cache (400 entries)
  if url was new: notify(browserId)                                   // debounced, see Mechanism 3
```

Constants (exact):

- `SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/i` (`gecko/src/modules/downloads/media.ts:29`)
- `HINTS = /thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/i` (`:30`)
- Minimum file size: `500000` bytes (`:237`)
- At most `200` items per document record (`:252`)
- `frameUrl` is `''` for the top frame, else the frame's document address (`:244-249`)

Manifests are recognised **by MIME or by URL only** at this stage, because the observer sees headers, not the body. The body is checked later, when the manifest is read (Mechanism 6).

### Why

- Script requests (`xhr`) are never whole files: "MSE players fetch their segments as xhr; only the media element's own requests are whole files" (`gecko/src/modules/downloads/media.ts:228`). But a playlist or manifest fetched by script IS counted (the HLS/DASH test runs before the `xhr` test), because that is exactly how hls.js and dash.js load them.
- `video/mp2t` is a TS segment MIME, never a whole video (`:230`).
- The size is read from `Content-Range` first: a `<video>` asks with a Range request, so `Content-Length` is only the size of the first piece; the total after `/` is the real file size (`:235-236`). The biggest size seen for a URL is kept (`:250`).
- `TYPE_DOCUMENT` is ignored on purpose: "it may be a download, not a new page" (`:212`). See Mechanism 3 for the bug this fixed.
- The spike's version had the same rules (`gecko/spikes/downloader/verify/engine/VitreMedia.sys.mjs:17-19, 136-149`), carried over from the earlier Electron build (`app/src/main/modules/downloads/media.ts:35-36`). No commit records why 500 kB was chosen; the page module's comment only says "the network rule skips files under 500 kB" (`gecko/src/actors/page/downloads.ts:262`).

### Edge cases handled

- Media in iframes is recorded with its frame's address (used in Mechanism 11).
- Cached and merged responses count.
- Requests made by Deer itself (no browsing context) are never recorded, so Deer's own downloads do not light the mark.
- A playlist served with a wrong MIME but a `.m3u8` URL counts; one served as `application/vnd.apple.mpegurl` without `.m3u8` counts too.
- A `.mp4` served as `application/octet-stream` counts.
- Unknown size (0) is kept, not dropped.
- An endless feed keeps loading media: the oldest items are forgotten after 200.

Gaps I found (not handled, by reading only): a playlist served with neither an HLS MIME nor `.m3u8` in its URL (for example `text/plain` at `/api/stream?id=1`) is never seen. `HINTS` applies only to whole files, not to playlists or manifests, so an ad's `.m3u8` is still a candidate (ranking and frame rules in Mechanisms 5 and 11 reduce the risk). The URL test runs on the whole URL including the query, so `https://tracker/x?u=https://cdn/a.m3u8` matches `.m3u8` at the end; the body check of Mechanism 6 then rejects it if it is not a playlist.

### Proven by

- Spike: "video seen with size 2471986 from Content-Range, HLS and DASH seen, .ts segment skipped, iframe request attributed with frame address" (`gecko/spikes/downloader/RESULT.md:71-72`).
- Spike verification on real pages: the hls.js demo gave 3 playlists; the MDN `<video>` page gave `flower.webm` and an archive.org mp4 inside cross-origin iframes (`gecko/spikes/downloader/RESULT.md:245`; script `gecko/spikes/downloader/verify/vboot-media2.js:125-142`).
- A background tab in a second window: its playlists were attributed to it (`vboot-media2.js:88-123`).
- `gecko/tests/downloads/streams.js:31-34`: the mark lights for a page whose script fetched an HLS master.
- `gecko/tests/downloads/embed.js:28-30`: playlists fetched by an embedded player are recorded "as the frame's" (each candidate has `kind === 'hls'` and the player's `frameUrl`). The fixture serves `.ts` segments as `image/jpeg`, as real embed CDNs do (`tests/downloads/server.py`, `/hot/fx/` route); detection does not need the segments at all.

---

## Mechanism 2: The page eye (element reports)

### What it does

The page module tells the window about the video under the pointer, the page's main video, every media element that loaded an ordinary file, and every DRM `encrypted` event. This fills the holes of the network eye (media loaded without a request) and gives the facts only the page knows: the video's on-screen size, its real height, its length, and whether it uses DRM.

### How it works

The module listens (capture phase, passive) to `pointermove`, `pointerdown`, `mouseout`, `scroll`, `resize`, `encrypted`, `loadedmetadata`, `durationchange`, and `click` in the bubble phase (`gecko/src/actors/page/downloads.ts:86-98`).

**A video's report** (`infoOf()`, `:136-160`):

| Field | Source |
|---|---|
| `id` | a per-document counter kept in a `WeakMap` (`:102-113`) |
| `src` | `currentSrc`, else `src`, else the first `<source src>`; made absolute against `baseURI` (`:141, 162-169`) |
| `duration` | `video.duration` if finite, else 0 (`:142, 148`) |
| `width`, `height` | `videoWidth`, `videoHeight`: the real picture size, not the CSS size (`:149-150`) |
| `protected` | `video.mediaKeys` is set, or this element fired `encrypted` (`:152`) |
| `live` | `duration === Infinity` (`:153`) |
| `title` | the element's `aria-label`, else its `title`, else `og:title`, else `document.title`; max 300 characters (`:120-128`) |
| `rect`, `view` | the box in CSS pixels; the viewport without scrollbars (`:115-118, 131-134`) |

**The video under the pointer** (`videoAt()`, `:178-194`), top document only (`:305`), at most once per animation frame (`soon()`, `:206-218`):

```
videoAt(x, y):
  best = largest <video> that contains (x, y), is at least 200 x 112 CSS px, and is shown
  if none: best = largest <iframe> that contains (x, y), at least 320 x 180, and is shown
  // "shown": width and height > 0, visibility != hidden, display != none, opacity > 0.05  (:171-175)
```

Constants: `MIN_VIDEO = { w: 200, h: 112 }` (`:35`), `MIN_FRAME = { w: 320, h: 180 }` (`:47`). An iframe is reported as `kind: 'frame'` with its `src` as `frameSrc` (`:159`): "players live in iframes" (`:177`).

**The page's main video** (`downloads:main-video` query, `:354-373`), top document only:

```
score(video) = visibleWidth * visibleHeight * (video.paused ? 1 : 2) + 1
  // visible part = the box clipped to the window (innerWidth x innerHeight)
  // only videos >= 200 x 112 and shown
main video = the video with the highest score (a playing video counts double)
```

**A media element that loaded a file** (`reportElement()`, `:256-266`), in every frame, on `loadedmetadata`:

```
if element is <video> or <audio>:
  src = currentSrc or src, absolute
  if src is not http(s) (blob:, data:) or longer than 8192: skip
  if duration is finite and < 5 seconds: skip            // short sounds, tiny previews
  send downloads:element-media { src, kind, frameUrl (or '' in the top frame), protected: !!mediaKeys }
```

The window then calls `media.eme(id, {encrypted: true})` if `protected`, else `media.element(id, {url, kind, frameUrl})` (`gecko/src/window/modules/downloads/video.ts:318-325`). `element()` skips URLs matching `HINTS`, does not overwrite an item the network already saw, and takes the size from the size cache (`gecko/src/modules/downloads/media.ts:261-267`).

**DRM events**: `encrypted` does not bubble, so it is caught in the capture phase (`gecko/src/actors/page/downloads.ts:92-93`); on a `<video>` or `<audio>` the module remembers the element and sends `downloads:drm` (`:271-278`).

**Pinning**: while a download runs or the picker is open, the window asks the page to follow one video: its rectangle is sent every 250 ms and on scroll, only when it changed by a whole pixel; `null` when the element is gone (`:220-235, 342-353`). Reason: "Layout can move a video without a scroll (ads loading, the page reflowing)" (`:349`).

### Why

- "The engine sees media through the network, but a page can get its media without a request of its own (Gecko's media cache clones the resource of another element with the same address, a page from the back-forward cache): the element's own report keeps the download mark right." (`gecko/src/actors/page/downloads.ts:250-255`)
- "Short sounds and tiny previews are not worth a mark" (`:262`): the 5-second rule is the element's version of the 500 kB rule.
- "EME in use means DRM: the key system decides what can be decoded, not the page." (`:151`)
- Elements are read through Gecko's Xray wrappers, so tag names are compared by `localName` and nothing from the page is evaluated (`:30-31`).

### Edge cases handled

- `blob:` sources (MSE) are not reported as files; the network eye's playlists cover them.
- Videos hidden with `opacity <= 0.05`, `display:none` or `visibility:hidden` are ignored (decoy or background players).
- Small videos (avatars, autoplaying thumbnails under 200 x 112) get no pill.
- A video in a cross-origin iframe: the hover reports the iframe element itself.
- The pointer leaving the page (onto Deer's UI or out of the window): `mouseout` with no `relatedTarget` clears the hover (`:318-328`).
- `durationchange`/`loadedmetadata` on the hovered video resends its report, so the pill learns the real length and height (`:334-337`).

### Proven by

- `gecko/tests/downloads/ui.js:168`: "the mark shows for a video whose file came from the media cache".
- `gecko/tests/downloads/streams.js:36-44`: hover on `#v` shows the pill 12 px inside the video's top-right corner with the HLS offer.

---

## Mechanism 3: One record per document, and single-page sites

### What it does

What a page loaded belongs to that page only. A new page in the tab starts empty. A single-page site that moves to the next video forgets the old video's streams. A download clicked on a page does not wipe that page's list (or its DRM mark).

### How it works

Storage (`gecko/src/modules/downloads/media.ts:106-114, 181-202`):

```
tabs: browserId -> (innerWindowId of a top document -> record)
record = { doc, items: Map(url -> candidate), drm: Map(keySystem -> status), encrypted: count, timer }
```

- `current(browserId)` = the record of the document the tab shows now: `BrowsingContext.getCurrentTopByBrowserId(id).currentWindowGlobal.innerWindowId` (`:168-183`).
- A response from the top frame is filed under the document that made the request (`loadInfo.innerWindowID`), "never racy"; a frame's response goes to the current top document (`:239-242`).
- At most 3 document records per tab (`:199`); at most 300 tabs (`:193`). Other caches hold 400 entries (`CACHE_LIMIT`, `:60-65`).
- Nothing is cleared on navigation. An old document's record simply stops being "current". Because nothing notifies on navigation, the window re-reads the tab's count on its own `tab-navigated` event (`gecko/src/window/modules/downloads/video.ts:167-171`; header `media.ts:8-12`).

**Single-page sites** (`gecko/src/window/modules/downloads/video.ts:151-166` and `media.ts:275-287`):

```
on tab-navigated(sameDocument = true, url):
  page = url without #fragment
  if the tab had no page before, or page == before: return        // only the #fragment changed
  forget all cached offers; reset the pill if it was on this tab
  media.pageChanged(browserId):
     since = now - 1500 ms
     delete every item with at < since                            // keep media asked for in the last 1.5 s
     (DRM marks are kept)
  re-read the tab's count
```

**Notifications** are debounced: the first change starts a 300 ms timer; changes during it are folded in; then listeners get `{browserId, count, protected}` (`media.ts:321-338`).

### Why

- The spike cleared a tab's list on every top-level (`TYPE_DOCUMENT`) response. The independent verification found a hole: "A top-level request that turns into a download (Content-Disposition: attachment) is a TYPE_DOCUMENT response but the page stays ... 'media items 5 -> 0' with the page still /media.html, and 'protected true -> false' on the EME page while its `<video>` still has mediaKeys. After any download click the DRM tab is no longer marked protected, so later media would be offered." Fix: "key the tab record by the top WindowGlobal's innerWindowId instead of clearing on a response." (`gecko/spikes/downloader/RESULT.md:253-254`, recipe correction 5 at `:297`; test `gecko/spikes/downloader/verify/vboot-media3.js`; the spike's switch `VITRE_V_MEDIAFIX` at `gecko/spikes/downloader/verify/engine/VitreMedia.sys.mjs:85-100, 121-127`.)
- Several records per tab, not one: "a response can be observed before the parent has made its new document current, and a late response of the previous page must not wipe the new page's record" (`media.ts:176-180`).
- The 1.5 s window: "players start fetching the next video just before they update the address" (`media.ts:270-274`).
- DRM marks survive an SPA change: "safer: a protected video's state is not dropped" (`media.ts:273`).

### Edge cases handled

- A download click on a page (top-level response): the list and the DRM mark stay.
- A late response from the previous page: goes to that page's old record, not the new one.
- `#comments` (fragment-only change): nothing is forgotten.
- SPA "next video": the new stream fetched just before `pushState` survives.
- Closed tabs leave records behind; the oldest tabs are dropped after 300.

### Proven by

- `gecko/tests/downloads/drm.js:43-54`: a download from the protected page keeps it protected; the next document in the tab is not protected.
- `gecko/tests/downloads/spa.js`: after `pushState` the first video's HLS is forgotten, the next video's fMP4 HLS is known, the same document (`innerWindowId` unchanged), the mark still shows, the picker offers the next video; a `#comments` change keeps the streams.
- `gecko/spikes/downloader/verify/vboot-media3.js:45-73` (spike checks of the fix).

---

## Mechanism 4: Which candidates count

### What it does

Only things that could be "the video" are counted for the mark and offered: playlists, manifests, and whole files that are not tiny, not segments, not thumbnails or ads. Background music does not count when the page also has a video.

### How it works

Filters, in order of where they act:

| Filter | Rule | Where |
|---|---|---|
| Not a frame request | no `browsingContext.top.browserId` | `gecko/src/modules/downloads/media.ts:208` |
| Request kind | top-level documents ignored; script requests never count as whole files | `:211-213, 229` |
| Success only | status 200-299 and GET | `:215` |
| Segments | `SEGMENT_EXT` and `video/mp2t` are never whole files | `:29, 229-230` |
| Hints | thumb, poster, preview, sprite, favicon, emoji, `/ad/`, `/ads/`, doubleclick, googlesyndication | `:30, 229, 262` |
| Size | whole files with a known size under 500,000 bytes | `:237` |
| Element length | element reports shorter than 5 s | `gecko/src/actors/page/downloads.ts:263` |
| Element size on screen | pill only for videos >= 200 x 112, iframes >= 320 x 180, visible | `downloads.ts:35, 47, 171-194` |
| Audio | an audio file is dropped when the same document has any video, HLS or DASH item | `media.ts:304-308` |
| DRM | a protected document has no candidates at all | `media.ts:305` |

The mark's number is `candidates().length` (`media.ts:310-312`). The spike did not count DASH in the mark ("DASH alone doesn't count", `gecko/spikes/downloader/verify/engine/VitreMedia.sys.mjs:176-181, 205`; the same comment is at `gecko/spikes/downloader/engine/VitreMedia.sys.mjs:158`); the port counts it (`types.ts:472-473`: "DASH included") because DASH download was added on Gecko ("new on Gecko (the Electron build only detected them)", `gecko/src/modules/downloads/dash.ts:1-3`).

### Why

The rules separate the video from the noise every video page makes: segment traffic of MSE players, hover previews and sprite sheets on feeds, ad pixels and ad creatives, notification sounds. The reasons are in the comments quoted under Mechanisms 1 and 2.

### Edge cases handled

- A page with background music and a video offers the video only.
- A music page with only audio files offers the audio.
- A 300 kB "preview.mp4" loop: dropped by size and by hint.
- A file whose size is unknown: kept (it may be the video).

### Proven by

- Spike: ".ts segment skipped" (`gecko/spikes/downloader/RESULT.md:72`).
- `gecko/tests/downloads/mark.js:18-29` (a page whose player loaded only a playlist lights the mark).

---

## Mechanism 5: Ranking streams and preferring the master

### What it does

When a page loaded several playlists (a master, a variant playlist, an ad's playlist, the previous video's playlist), Deer tries the likeliest master first and takes the first one that really is a master playlist. This way the picker shows every quality, not only the one the player happened to load.

### How it works

`rankStreams()` (`gecko/src/modules/downloads/media.ts:91-97`):

```
score(url):
  name = last path part, without the query
  s = 0
  if name matches /master|index|playlist|manifest/i: s += 2
  if not isOpaque(name):                              s += 1
  return s
order = by score, highest first; on a tie, the most recently seen first
```

`isOpaque(name)` (`gecko/src/modules/downloads/naming.ts:154-160`) is true for names that say nothing about the content:

- the base name (without extension) is one of `master, index, playlist, video, audio, stream, manifest, hls, main, media, chunklist, videoplayback, download, file`;
- or it matches `^(\d{3,4}p|file\s+\d+|seg(ment)?[-_]?\d+)$` (like `720p`, `seg12`);
- or, with non-alphanumerics removed, it is 16 or more hex characters (a hash).

So the order is: a descriptive name that also contains master/index/playlist/manifest (3) > `master.m3u8`, `index.m3u8` (2) > other descriptive names (1) > `720p.m3u8`, `chunklist.m3u8`, hash names (0).

Then `offer()` reads them (`gecko/src/modules/downloads/media.ts:400-414`):

```
streams = (element src ends with .m3u8) ? [src] : rankStreams(hls candidates)
chosen = null
for url in streams[0..3]:                      // at most 4 are read
   d = describe(url)                           // fetch + parse, Mechanism 6
   if failed: continue
   if chosen is null or (d is a master and chosen is not): chosen = d
   if d is a master: stop
```

The score is only a hint. The playlist's body decides: a master has `#EXT-X-STREAM-INF:` lines (`gecko/src/modules/downloads/playlist.ts:70-72`). `index.m3u8` is a common name for both masters and variant playlists, which is why the body check is needed.

DASH takes the first item of `rankStreams(dash candidates)` only (`media.ts:429`).

### Why

"HLS: a player loads the master playlist and then one rendition: offer the master, which has every quality." (`gecko/src/modules/downloads/media.ts:399`). The tie-break by recency: "Streams to consider, likeliest master first, then the most recent (a page that moved on to another video)." (`:87-90`). The same order is reused by the background page step (Mechanism 16) and by the engine's `pageStreams()` (`gecko/src/modules/VitreDownloads.sys.ts:3633`).

### Edge cases handled

- The player loaded only a variant playlist (no master seen): the variant is offered as one "Original" option (`media.ts:514-521`).
- A broken or non-playlist `.m3u8` in the list: skipped, the next is tried.
- An element that plays a `.m3u8` directly (native HLS): that address is used and nothing else is tried.

### Proven by

- `gecko/tests/downloads/streams.js:44`: the page fetched `master.m3u8` then `v360/index.m3u8`; the offer is the full ladder `360p,180p` (the master won).
- `gecko/tests/downloads/resolve.js:479-516` (`stream2`): a page that also fetched another stream of the same length "fetched last, so tried first" (recency tie-break) is proven not the stream, and the right one renews the row.

---

## Mechanism 6: Confirming and reading a manifest

### What it does

Before offering a stream, Deer downloads its playlist or manifest and reads it. A file that only looks like a playlist (by its name or MIME) but is not one is never offered.

### How it works

**HLS** (`describe()`, `gecko/src/modules/downloads/media.ts:475-524`):

```
describe(url):
  if cached for this url and younger than 60 s: return it            (:476-477)
  text = GET url, timeout 12 s, at most 8 MiB of text                 (:478; net.ts:828)
  if text (after a BOM and whitespace) does not start with "#EXTM3U": fail "not a playlist"   (:479; playlist.ts:66-68)
  if any line starts "#EXT-X-STREAM-INF:":  master                    (playlist.ts:70-72)
     parse variants and renditions; DRM from #EXT-X-SESSION-KEY       (playlist.ts:127-165)
     rungs = ladder(master)                                           (Mechanism 9)
     sample = first rung that is not audio-only (or the first rung)
     media = GET sample.url (12 s), parse                             (:486-493)
       DRM |= media DRM; live = no ENDLIST; duration = sum of #EXTINF; fMP4 = has #EXT-X-MAP
     build options (Mechanism 9)
  else: media playlist
     DRM, live, duration, fMP4 from it; one option "Original"         (:514-521)
  cache (400 entries)
```

**DASH** (`describeDash()`, `media.ts:526-546`): fetch (12 s), parse with `DOMParser` as XML (`gecko/src/modules/downloads/dash.ts:168-220`). If the root element is not `MPD`, the result is empty (no options), so nothing is offered (`dash.ts:172`). Options are built only when not DRM, not live, and with at most one `Period` (`media.ts:531`).

The download engine checks the body again at download time: a playlist must start with `#EXTM3U` or contain `<MPD` (followed by space or `>`) in its first 4096 characters, else `NotAPlaylistError` (`gecko/src/modules/downloads/hls.ts:1627`; `dash.ts:164-166`).

**Direct file size** (`probeSize()`, `media.ts:553-561`): one request with `Range: bytes=0-0`, timeout 8 s, body discarded at once. The size is the total of `Content-Range`, else the `Content-Length` of a 200 answer, else 0. A 4xx/5xx answer throws (used for the frame fallback of Mechanism 11).

The 60-second cache can be skipped (`fresh`) by the background step, "since the page step looks for addresses that work now" (`media.ts:464-473`).

### Why

Names and MIME types lie: test page `/video-bad.html` loads `/bad/broken.m3u8`, served as `application/vnd.apple.mpegurl` with the body `this is not a playlist` (`gecko/tests/downloads/server.py`, route `/bad/broken.m3u8`). The mark lights (header rules), but the offer is empty and the person gets a note (Mechanism 13). Reading the sample media playlist is needed to know three things the master does not say: the length (for size estimates), live or not, and fMP4 or TS.

### Edge cases handled

- UTF-8 BOM before `#EXTM3U`.
- `CRLF`, `CR` or `LF` line ends (`playlist.ts:58-64`).
- Attributes quoted or bare; `BANDWIDTH` not confused with `AVERAGE-BANDWIDTH` (`playlist.ts:74-94`).
- Relative URLs resolved against the playlist's address.
- Variants with non-http(s) URLs are dropped from the ladder (`playlist.ts:171`).
- DASH: `BaseURL` at each level, `SegmentTemplate` with `$Number$`/`$Time$` (and `%05d` widths), `SegmentTimeline` with negative `r`, `SegmentList`, `SegmentBase`/bare `BaseURL`; subtitle and thumbnail AdaptationSets skipped (`dash.ts:5-9, 76-148, 191-192`). More than 100,000 segments are cut off (`dash.ts:136, 146`).

### Proven by

- `gecko/tests/downloads/mark.js:18-29`: the unreadable playlist gives "Can't save this video" and no picker.
- `gecko/tests/downloads/streams.js:163-170`: Ctrl+Shift+D on a DASH page offers `360p,M4A`.

---

## Mechanism 7: DRM, detecting and refusing

### What it does

A video protected by DRM is never offered and never downloaded. The pill says "Protected video" (lock icon), the tab mark stays off, Ctrl+Shift+D opens no picker, the video's right-click "Download video…" is disabled with "Protected", and even a direct download request for a media address from that page is refused. The owner's rule: "DRM streams (Widevine, PlayReady, FairPlay) are always refused." (`design/DESIGN-NOTES.md:17`).

### How it works

**Signals** (any one marks the whole document as protected):

| Signal | How it is caught | Where |
|---|---|---|
| The page asked for a key system (EME) | Firefox's own `EncryptedMediaParent` actor already forwards every `mediakeys-request` to the parent. Deer wraps its `receiveMessage`, parses `{status, keySystem}` and calls `eme()`. Messages with status `is-capture-possible` are ignored. | `gecko/src/modules/downloads/media.ts:129-158, 290-296` |
| A media element fired `encrypted` (any frame) | capture listener in the page module, `downloads:drm` | `gecko/src/actors/page/downloads.ts:92-93, 271-278`; `video.ts:326-329` |
| A media element has `mediaKeys` | in the hover/main report (`protected`) and the element report | `downloads.ts:152, 265`; `video.ts:322` |
| HLS key tags | `#EXT-X-KEY` (media playlist) or `#EXT-X-SESSION-KEY` (master) that is not plain AES-128 | `gecko/src/modules/downloads/playlist.ts:56, 104-110, 133, 201-202` |
| DASH | any `ContentProtection` element anywhere in the MPD | `gecko/src/modules/downloads/dash.ts:7, 173` |
| yt-dlp | a format with `has_drm`, or an error message containing "drm" | `gecko/src/modules/downloads/ytdlp.ts:206, 246, 262` |
| Firefox's context menu | Firefox's own `onDRMMedia` for the right-clicked element | `gecko/src/window/modules/menus/page-items.ts:420, 436-439` |

The HLS rule exactly (`playlist.ts:104-110`):

```
keyIsDrm(line):
  method = METHOD attribute, uppercased (default NONE)
  format = KEYFORMAT attribute (default "identity")
  if method == NONE:     not DRM
  if method != AES-128:  DRM          // SAMPLE-AES, SAMPLE-AES-CTR, anything else
  DRM if format != "identity" (case-insensitive) or format matches DRM_FORMATS
DRM_FORMATS = /widevine|edef8ba9|playready|9a04f079|streamingkeydelivery|fairplay|com\.microsoft/i
  // edef8ba9... is Widevine's system id, 9a04f079... PlayReady's,
  // com.apple.streamingkeydelivery is FairPlay's KEYFORMAT
```

(After the `identity` test the regular expression adds nothing: any other KEYFORMAT is already DRM. It documents intent.)

The DASH rule catches PSSH data, because in an MPD the PSSH sits inside `<ContentProtection>`. DRM signalled only inside the media segments (in-band PSSH, no `ContentProtection` in the MPD) is not checked by the manifest rule; the player would then still use EME, which the EME tap catches.

**State**: `isProtected(browserId)` = the current document's record has a key system or an `encrypted` count (`media.ts:298-301`). It is never lifted while that document is shown (Mechanism 3).

**Enforcement, layer by layer**:

1. `candidates()` returns nothing for a protected document, so the mark is off (`media.ts:304-305`; `video.ts:932`).
2. `offer()` returns `state: 'protected'` first thing, and again if the chosen HLS or DASH stream turns out to be DRM (`media.ts:351, 416, 433`). A protected offer has no options.
3. DRM that starts after the offer was made (the page set up its key session later): the open picker closes and the pill turns to "Protected video", unless a download of that video is already running or paused (`video.ts:261-275`, called from the notice subscription at `:173-180`).
4. A download refused at start because the tab turned protected: the pill says "Protected video" (`video.ts:662-671`).
5. The engine's `start()`: on a protected tab, it throws "This video is protected and can't be saved." for any stream (`mode` hls/dash/ytdlp), any download from the picker (`videoKey`), or any URL matching `MEDIA_URL` — "whoever asks" (`gecko/src/modules/VitreDownloads.sys.ts:1069-1074`; message at `gecko/src/modules/downloads/hls.ts:176`).
6. The window's download service silently refuses a `MEDIA_URL` address from a protected tab (`gecko/src/window/modules/downloads/index.ts:166-168`).
7. The stream engine refuses DRM playlists and manifests at download time, whoever started them (`hls.ts:441, 711, 791`).

`MEDIA_URL = /\.(m3u8|mpd|mp4|m4v|m4s|webm|mov|mkv|m4a|mp3|aac|ts)(\?|#|$)/i` (`gecko/src/modules/downloads/media-url.ts:6`), shared by engine and window "so the two cannot drift apart" (`:1-3`). A non-media file (a PDF) from a DRM page is still allowed.

### Why

- Detecting EME without any content code: "Firefox's own EncryptedMedia actor already forwards every 'mediakeys-request' to the parent (it drives Firefox's DRM info bar). Listen in." (`gecko/spikes/downloader/verify/engine/VitreMedia.sys.mjs:43-44`). The spike also had its own JSWindowActor for this, but a content-process module must live in the application folder because of the Windows content sandbox (`RESULT.md:76, 140`); the port dropped the actor and uses the generic page module for `encrypted` events instead (`media.ts:13-16`).
- Detection does not need a CDM: a Widevine request with no CDM installed still marks the tab (status `cdm-not-installed`) (`RESULT.md:246`; `vboot-media2.js:63-86`).
- Layer 5 exists because "the page may have started its key session after its picker opened" (`VitreDownloads.sys.ts:1072`).
- The reason for ignoring `is-capture-possible` is not written down. It is a status Firefox's actor sends that is not a key-system request; I could not confirm its meaning from the repository.

### Edge cases handled

- DRM inside an iframe (embedded player): the `encrypted` event and the EME tap mark the tab.
- A download click on the DRM page does not lift protection (the verified hole, Mechanism 3).
- A SPA moving to another video keeps the DRM mark.
- A Widevine page on a machine with no Widevine CDM is still marked.
- An HLS master with a Widevine session key, a DASH manifest with `ContentProtection`: refused by the engine even when started directly.

Known limits (from the spike): "An unsupported key system (PlayReady here) produces no notification and no mark. The 'encrypted' event path was never exercised by either of us." (`gecko/spikes/downloader/RESULT.md:303`). Such a page cannot play its protected stream either; the manifest rules still apply.

### Proven by

- `gecko/tests/downloads/drm.js` (ClearKey page `/drm.html`): the EME actor is tapped; the page is marked protected; no mark; hover shows "Protected video" with no download button; the offer is `protected` with no options; Ctrl+Shift+D opens no picker; the downloads service refuses `/media/clip.mp4` from that tab; a download from the page keeps it protected; the next document is not protected; an HLS master with a Widevine session key fails with "protected"; a DASH manifest with `ContentProtection` fails with "protected".
- Spike: ClearKey reported by both the child actor and the EME tap; "Manifest-level DRM (Widevine HLS key, DASH ContentProtection) also PASS" (`RESULT.md:73-74`).

---

## Mechanism 8: Live streams

### What it does

A live stream is never offered. The pill says "Live · can't be saved" with a dot; the picker does not open.

### How it works

Live when any of these holds:

- the element's `duration === Infinity` (`gecko/src/actors/page/downloads.ts:153`; `offer()` checks it at `gecko/src/modules/downloads/media.ts:352`);
- an HLS media playlist has no `#EXT-X-ENDLIST` and no `#EXT-X-PLAYLIST-TYPE:VOD` (`gecko/src/modules/downloads/playlist.ts:195-196`; `media.ts:490, 517`). For a master, this is judged from the sample variant only (the first non-audio rung, `media.ts:486-490`);
- a DASH MPD has `type="dynamic"` (`gecko/src/modules/downloads/dash.ts:174`);
- yt-dlp says `is_live`, or `live_status` is `is_live` or `is_upcoming` (`gecko/src/modules/downloads/ytdlp.ts:258`).

The engine refuses live streams too: "Live streams can't be saved." (`gecko/src/modules/downloads/hls.ts:177, 442, 792`).

### Why

A live stream has no end, so it cannot be saved as one file with this engine. An HLS `EVENT` playlist without `ENDLIST` is still growing and is treated as live.

### Edge cases handled

- Upcoming premieres (yt-dlp `is_upcoming`).
- `PLAYLIST-TYPE:VOD` without `ENDLIST` counts as complete.

### Proven by

- `gecko/tests/downloads/ui.js:149-156`: `/video-live.html` (a live HLS master) shows "Live · can't be saved" and the pill stays while the pointer is on it.

---

## Mechanism 9: The quality ladder and the suggestion for this screen

### What it does

The picker lists one row per quality, best first: "1080p", "720p"…, with "4K" next to 2160p rows, a size estimate, and "Best for this screen" on the suggested row. An "Audio only" group follows. The pill shows the suggested quality ("Download | 1080p"). Shift+click on the pill downloads the suggested quality at once.

### How it works

**HLS ladder** (`ladder()`, `gecko/src/modules/downloads/playlist.ts:168-177`):

```
for each variant with an http(s) URL:
   key = audioOnly ? "a"+BANDWIDTH : height ? "h"+height : "b"+BANDWIDTH
   keep the variant with the highest BANDWIDTH for each key
sort: video before audio-only; then height high to low; then BANDWIDTH high to low
audioOnly = no RESOLUTION, CODECS present, and no video codec among avc|hvc|hev|av01|vp0?9|dvh   (playlist.ts:155-156)
```

So two 720p variants (for example H.264 and HEVC, or 30 and 60 fps) become one row: the one with the higher `BANDWIDTH`. Codecs are not shown and not used to choose.

**HLS options** (`gecko/src/modules/downloads/media.ts:494-513`):

- Size: `round((AVERAGE-BANDWIDTH or BANDWIDTH) / 8 * duration)` bytes, where `duration` comes from the sample media playlist. "BANDWIDTH already counts the audio rendition a variant plays with." (`:496-497`)
- Video row: label `"<height>p"`, or `"<kbps> kbps"` with no `RESOLUTION`; detail `"4K"` when height >= 2160; container `MP4` if the stream is fMP4 or ffmpeg is present, else `TS`; `audioUrl` = the variant's audio rendition: the `DEFAULT=YES` one of its `AUDIO` group, else the first of the group (`playlist.ts:180-184`); `needsMux` when there is a separate audio or the stream is TS (`media.ts:502-505`).
- Audio-only variants: label `M4A` (or `AAC` without fMP4/ffmpeg), detail `"<kbps> kbps"` (`:499-500`).
- If no audio-only variant exists: one "Audio only" row from the `DEFAULT` audio rendition (else the first one with a URL), detail = its `NAME` or `LANGUAGE` (`:509-513`).
- A single variant without `RESOLUTION`: labelled with the element's real height, `videoHeight` (`:419-421`): "A lone rendition without RESOLUTION plays at the element's size; a ladder keeps its bitrates apart."
- Each option carries a "rung" fingerprint (height, width, bandwidth, average, codecs, audio group/language/name: `gecko/src/modules/downloads/table.ts:258-270`) so a later resume can find the same quality again.

**DASH ladder** (`gecko/src/modules/downloads/dash.ts:222-240`, options `media.ts:531-542`): one video Representation per height (highest bandwidth), best first; one audio = the highest-bandwidth audio Representation in the language of the manifest's first audio Representation. Size = `(video bandwidth + audio bandwidth) / 8 * duration`. Container `WEBM` if the MIME says webm, else `MP4`; the audio row is `WEBA` or `M4A`.

**yt-dlp ladder** (`gecko/src/modules/downloads/ytdlp.ts:264-307`): with ffmpeg, one row per height: prefer H.264 MP4 at that height, else the highest bitrate; joined with the best audio of the original language (tracks marked "dubbed" or "descriptive" in `format_note` come after: `:208, 265-270`), `m4a` for MP4 and `webm` for WebM; fps shown when above 30 ("1080p 60"); "4K" for >= 2160, "2K" for >= 1440. Without ffmpeg: only formats that carry both picture and sound, one per height. Size = `filesize`, else `filesize_approx`, else `tbr * 1000 * duration / 8` (`:204`).

**The suggestion** (`media.ts:365-369`; same rule in `ytdlp.ts:306-307`):

```
fit = round( max(screen.height, screen.width * 9/16) * devicePixelRatio )      // video.ts:82-85
videos = video rows, best first
suggested = first row with 0 < height <= fit
            else the last (smallest) video row
            else the first row of any kind
```

"Best for this screen" is shown only when there is more than one video row (`gecko/src/window/modules/downloads/video.ts:1138-1145`).

**Direct file** (`media.ts:437-455`): one row, label `"<videoHeight>p"` (or the extension in capitals), "4K" when height >= 2160, container = the file's extension.

### Why

- The suggestion avoids the common mistake of always taking the biggest file: a 4K download on a 1080p screen wastes time and disk. `max(height, width * 9/16)` handles screens that are not 16:9.
- One row per height keeps the list short; the person thinks in "1080p", not in bitrates.

### Edge cases handled

- A master with no `RESOLUTION` anywhere: rows labelled by kbps.
- Audio only in a separate rendition (common with fMP4): still offered as "Audio only".
- No ffmpeg: rows that need joining say so in the picker (Mechanism 14).
- A master's audio group with several languages: only one audio is chosen (the default). The picker does not list audio languages or subtitles.

### Proven by

- `gecko/tests/downloads/streams.js:43-56`: the pill shows "360p" (best for that screen); the ladder is `360p,180p`; "Best for this screen" on the suggestion; the button follows the choice ("Download 180p"); the 180p (AES-128) download completes as MP4 with h264 + aac, 24 s.
- `streams.js:163-170`: DASH ladder `360p,M4A`.
- `gecko/tests/downloads/ui.js:139-143`: Shift+click downloads without the picker.

---

## Mechanism 10: The offer, choosing direct file, HLS, DASH or yt-dlp

### What it does

For a given video (the hovered one, the main one, or "the page" as a whole), Deer returns one offer with a state: `ok` (with options), `protected`, `live`, or `none` (with a reason when known, and `needsTools` when yt-dlp is missing).

### How it works

`MediaWatch.offer()` (`gecko/src/modules/downloads/media.ts:346-462`), in this exact order:

```
offer(browserId, video, ctx):
  title = video.title or the tab's title
  1. if video.protected or the tab is protected:  return PROTECTED
  2. if video.live:                               return LIVE
  3. if ytdlpFirst(page URL):                     // YouTube, see Mechanism 17
       if not explicit (a hover):                 return NONE        // never run yt-dlp on hover
       if yt-dlp not installed:                   return NONE, needsTools
       return yt-dlp probe
  4. src = video.src if http(s), else ''          // a blob: (MSE) source is ignored here
     pool = candidates of the tab's current document
     inPage = pool items with no frame, or a frame of the page's own origin
     items = (video is an iframe) ? pool items whose frame has the iframe's origin
           : (inPage not empty ? inPage : pool)
  5. HLS:  streams = (src ends .m3u8) ? [src] : rankStreams(items of kind hls)
           read the first 4, prefer a master (Mechanism 5)
           if one was read: DRM -> PROTECTED; live -> LIVE; options -> OK
  6. DASH: file = src unless it ends .mpd
           dash = src if it ends .mpd; else nothing if the element has its own file; else the top-ranked dash item
           if dash: read it; DRM -> PROTECTED; live -> LIVE; options -> OK
  7. File: if no file: file = the largest 'video' item by bytes
           if file: size (cache, or Range bytes=0-0), one option -> OK
  8. if explicit and yt-dlp installed and the page is http(s): return yt-dlp probe
  9. return NONE
```

The offer's `key` is `"<browserId>|<chosen URL>"` (`:350`); the window uses it to find a running download of the same video (`video.ts:438-440`). yt-dlp offers use `"ytdlp|<webpage_url>"` (`ytdlp.ts:256`).

The window caches offers for 60 s (`gecko/src/window/modules/downloads/video.ts:402-426`). The cache key includes the tab's document id, the tab URL, the element's `src` and `frameSrc`, `protected`, `live`, **the tab's media count**, whether yt-dlp is installed, and whether the request is explicit (`:413`). Because the count is in the key, a new stream seen by the network eye makes the next hover compute a fresh offer. All offers are cleared on an SPA change (`:160`).

### Why

- HLS before DASH before the file: HLS and DASH give a ladder; a file gives one quality.
- Note the order: HLS seen in the page wins even over the element's own `http(s)` file. The test page `/video-slow.html` has a `<video src="/media/clip">` and a script that fetched an HLS master; the test expects the HLS ladder `360p,180p` (`gecko/tests/downloads/server.py` `SCRIPTS` and the `src` rule; `gecko/tests/downloads/streams.js:44`). I found no test or comment for a page whose own `<video>` file is the real video while an unrelated HLS stream (an ad) was also loaded.
- DASH is skipped when the element has its own file: "The element's own file" comes first in that case (`media.ts:426-429`).
- yt-dlp only on an explicit request: "An explicit request may run yt-dlp (seconds); a hover never does." (`video.ts:412`).
- The largest file, not the newest: a page often loads a short preview or an ad after the main file.

### Edge cases handled

- MSE player (`blob:` element source): the element gives nothing, the page's playlists/manifests are used (step 4 ignores `blob:`).
- An iframe player: only media of that frame's origin is used.
- The page's own video: same-origin media first; all media only when the page itself loaded none.
- A stream that fails to read falls through to the next kind.
- An HLS master that reads but has no usable variants: falls through to DASH and file.

### Proven by

- `gecko/tests/downloads/mark.js:31-38`: an MSE page (`<video>` with no address) that loaded a DASH manifest: the mark opens the picker with what the page loaded.
- `gecko/tests/downloads/streams.js:30-71` (HLS), `:163-170` (DASH).

---

## Mechanism 11: Embedded players (frame ownership, and asking as the player)

### What it does

A video that plays in a player embedded from another site (an iframe) is offered with that player's own media. If the media's server refuses Deer's request because it does not come from the player's site (hotlink protection), Deer asks again the way the player asked, and the download goes out the same way.

### How it works

Ownership (`gecko/src/modules/downloads/media.ts:361-364`): see step 4 of Mechanism 10. A candidate's `frameUrl` is recorded by the network eye (Mechanism 1).

The fallback (`media.ts:370-397`):

```
frameOf(url) = the frame address that loaded url (or the hovered iframe's src),
               only if it is http(s) and NOT the same origin as the tab's page
read(url, fn):
  frame = frameOf(url)
  if not (frame and framePages[url] == frame):        // not already known to need the frame
     try fn(as the tab's page)  -> return { value, page: '' }
     on error: if no frame, or the error is not an HTTP 4xx: return null
  try fn(as the frame)  -> framePages[url] = frame; return { value, page: frame }
  on error: return null
```

"As the frame" means `Identity({ requestPage: frame, ... })`: the frame's address becomes the Referer, the Origin and the loading principal (commit `043f5e8`). The offer then carries `requestPage` (`media.ts:397`; `types.ts:461-466`), and the download uses the same identity (`gecko/src/window/modules/downloads/video.ts:652-655`). The download's source page stays the tab's page.

For a direct file in a frame, a one-byte `Range: bytes=0-0` request decides which identity works (`media.ts:441-446`).

### Why

Commit `043f5e8` (2026-10-06, "Deer 0.1.2: save videos from embedded players whose server serves only the player"): "a video that plays in a player embedded from another site (for example www.1flex.org playing from www.viduki.net) can be saved again. Its server refuses any request that does not come from the player's own site, so the picker had nothing to offer. Deer still asks as the tab's page first, as before; only when the server refuses that (4xx) and the stream was loaded by an embedded player from another site does it ask again as that player ... Sites that worked before take the same path as before."

### Edge cases handled

- Same-origin frames are treated as the page (no fallback needed).
- A URL known to need the frame is asked as the frame directly next time (`framePages`, 400 entries).
- Only 4xx triggers the fallback; network errors and 5xx do not.
- The key file and segments of an AES-128 stream behind the same rule also go out as the frame.

### Proven by

- `gecko/tests/downloads/embed.js`: (1) a hotlink-protected embed (403 unless Referer is the player's site; segments labelled `image/jpeg`): the master is asked as the tab's page first (403), then as the player's frame (served); the picker offers `360p,180p`; the 180p download completes; every playlist, key and segment request goes out as the frame; the source stays the tab's page; the file is 24 s h264 + aac. (2) Control: an embed whose server accepts the tab's page: exactly one request per playlist, as the tab's page, and no `requestPage` on the offer.

---

## Mechanism 12: Entry points (hover pill, Ctrl+Shift+D, the tab mark, the video menu)

### What it does

- **Hover pill**: a glass pill appears in the top-right corner of a video under the pointer (12 px inside), showing "Download | <quality>". Click opens the picker; Shift+click downloads the suggested quality. While that video downloads, the pill shows progress, a pause/resume button, then "Saved · Open" for 6 s.
- **Ctrl+Shift+D**: opens the picker for the hovered video, else the page's main video, else for everything the page loaded.
- **The tab's download mark**: an icon in the active tab pill, shown while the page has media worth saving; click does the same as Ctrl+Shift+D.
- **Right-click on a video**: "Download video… Ctrl+Shift+D" (disabled with "Protected" on DRM media).

### How it works

Hover (`gecko/src/window/modules/downloads/video.ts:359-388`): ignored when the tab is not on screen (split view aware, `:361`). A `null` report while the pointer is on the pill or the picker keeps the pill (`hoverLost`, `:363-366`); otherwise the pill hides after 450 ms (`:591-599`). Each new video gets an offer (`resolve()`, not explicit, so never yt-dlp). The pill shows only for modes `found`, `downloading`, `paused`, `saved`, `continue`, `protected`, `live` (`:434-446`); an offer in state `none` shows no pill. It hides in element fullscreen (`:471`).

Placement (`:544-560`): right edge = `min(video right, visible viewport right) - 12`; top = `max(minTop, video top + 12)` where `minTop` is 64 (8 in fullscreen or with the bar hidden); never over the page's own scrollbar. Width falls back to 168 px.

Ctrl+Shift+D (`downloadVideo()`, `:797-849`):

```
if the active tab is not a web page (or not loaded yet): return
if the picker is open: close it; return
if a video is in element fullscreen: leave fullscreen, wait up to 40 x 50 ms, then 250 ms more
video = the pill's video (same tab, real element), else query 'downloads:main-video' (800 ms timeout)
if yt-dlp page and yt-dlp installed: show the note "Finding the qualities…" (up to 60 s)
if video:
   offer = resolve(video, explicit = true)
   if offer is missing or 'none': offerPageMedia(...)             // Mechanism 13
   elif offer is yt-dlp and ok: picker under the tab pill (the offer belongs to the page)
   else: pin the pill on the video; picker if ok; else show the state 3 s
else: offerPageMedia(...)
```

The mark (`syncMark()`, `:918-941`): shown when the tab is a web page, not protected, and (media count > 0 or the page is a yt-dlp-first page).

### Why

- Leaving fullscreen first: "Over a full-screen video ... the picker could not be seen: leave full screen first, then measure the video where it now is." (`:804-805`).
- The main-video rule (visible area, playing counts double) picks what the person is watching, not a hidden or paused side player.
- The mark must always answer a click: the old behaviour "used to do nothing" when the streams could not be read (`gecko/tests/downloads/mark.js:2-3`).

### Edge cases handled

- The pill follows a pinned video during layout changes (every 250 ms).
- The picker or pill closes when another Deer surface takes the keyboard (`:1008-1016`).
- A download that ended without saving releases the pill (`:530-542`).
- Over a bright video frame the pill's tint is deepened (luma > 0.55, sampled once per video, `:562-575`).

### Proven by

- `gecko/tests/downloads/streams.js:31-66`: mark, pill position (12 px in), picker, progress, Saved.
- `gecko/tests/downloads/ui.js:129-147`: hover look, Shift+click, pause from the pill.
- `gecko/tests/downloads/mark.js`: the mark always answers.

---

## Mechanism 13: When nothing is found

### What it does

Deer never fails silently. If the element gives nothing, it tries everything the page loaded. If that gives nothing, a note under the tab pill says why.

### How it works

`offerPageMedia()` (`gecko/src/window/modules/downloads/video.ts:855-877`):

```
state = the tab's {count, protected}
if count > 0 or protected or yt-dlp-first page or the element offer said needsTools:
   page video = { id: -1, kind: 'video', src: '', duration: NaN, protected: state.protected, title: tab title }
   offer = (element offer was yt-dlp or needsTools) ? element offer : resolve(page video, explicit)
   if offer ok: open the picker under the tab pill; return
why = 'protected' | 'live' | 'none' (from the page offer or the element offer)
log a diagnostic (url, media state, both states, reason) to the console
if needsTools: note "Saving videos from this site needs yt-dlp" /
               "Get it once in Settings › Video downloads." with an "Open settings" button, 8 s
else: note  'Protected video' | 'Live · can’t be saved' | 'Can’t save this video'
      with, for 'none', the reason as a sentence, or "Deer couldn’t read the streams this page plays."
```

Notes last 3.5 s by default and close on the next click elsewhere (`:886-915`). Reasons from yt-dlp or the engine are turned into a sentence: capital first letter, full stop (`:1272-1277`).

### Why

"When there is nothing it can save, say so there instead of doing nothing (the mark was lit by streams it then could not read)." (`:851-854`). "The element itself gave nothing (a player's blob: source, or media its frame did not load): offer what the page loaded instead, the same streams that lit the mark." (`:829-830`).

### Edge cases handled

- MSE players (blob:): fall back to page media.
- A page whose only stream is unreadable: "Can't save this video".
- yt-dlp sites without yt-dlp: a direct way to install it.

### Proven by

- `gecko/tests/downloads/mark.js:18-29`: the note says "Can't save this video", no picker, the note hangs centred under the tab pill and goes away by itself.

---

## Mechanism 14: The picker (how the ladder is presented)

### What it does

A 340 px wide panel under the pill (or under the tab pill for page-wide offers): a 64 x 36 still of the video, the title, "host · duration", a radio list of qualities grouped "Video · MP4" and "Audio only", each with its size, "Save to <folder> · Change", a warning when ffmpeg is missing, a one-time terms reminder on big platforms, and a "Download 1080p · 1.2 GB" button.

### How it works

- Build (`gecko/src/window/modules/downloads/video.ts:1060-1091`). Group heading uses the first video row's container. Each row: label, detail (or "Best for this screen"), size if known.
- Keyboard (`:1115-1131`): Up/Down move the choice (wrapping), Enter downloads, Tab cycles choice → Change → Download; double-click a row downloads (`:1104-1106`); Esc returns to the pill.
- ffmpeg missing and the chosen row needs joining (`:1149-1152`): "ffmpeg not found: the video and its sound are saved as two files." (DASH or separate audio) or "ffmpeg not found: saved as it comes (TS)."
- Terms line "Check that the site's terms allow saving its videos." on the first download from YouTube, Facebook, Instagram, TikTok, X/Twitter, Vimeo, Twitch, Reddit, Dailymotion, SoundCloud, Netflix (`:58-79`, last 200 hosts remembered).
- "<quality> is no longer offered" when Continue (Mechanism 15) could not find the stopped row's quality (`:1079-1080`).
- Still image: a compositor snapshot of the video's rectangle at half scale, drawn "cover" into a 128 x 72 canvas (`:1170-1194`).
- Placement: right edges aligned with the pill, 8 px below, flipped above when there is no room (`:1047-1058`).

### Why

The owner's boards VideoDownload, VideoPicker and VideoStates (`design/DESIGN-NOTES.md:47`; `design/canvas/project/VideoPicker.dc.html`).

### Edge cases handled

- A single quality: no "Best for this screen".
- Unknown sizes: the size column is empty.
- The page turns to DRM while the picker is open: the picker closes (Mechanism 7).

### Proven by

- `gecko/tests/downloads/streams.js:46-57`; `gecko/tests/downloads/ui.js:158-170` (terms line).

---

## Mechanism 15: The stream key ("Continue · 62%")

### What it does

When a stream download stopped (link expired, paused, file changed) and the person opens the same video page again, the pill says "Continue · 62%" instead of "Download". Pressing it continues the old row with the same quality from the page's fresh addresses.

### How it works

`streamKeyOf()` (`gecko/src/modules/downloads/streamkey.ts:8-19`):

```
streamKeyOf(pageUrl, duration, title):
  if pageUrl is not http(s): return ''
  page = origin + pathname                      // no query, no fragment
  secs = round(duration) if > 0, else 0
  t = title trimmed, whitespace collapsed, '|' replaced by '/', lowercased
  return page + "|" + secs + "|" + t
  // example: "https://tideline.fm/watch/42|245|molten: a 4k study of glass in motion"
```

`sameStream(a, b)` (`:27-39`): equal strings match; yt-dlp keys (`ytdlp|<webpage_url>`) match only exactly; otherwise the page part and title part must be equal and both durations > 0 and at most 1 s apart. An unknown duration (0) matches only an identical key.

The pill looks for a stopped stream row with this key in the same container (`gecko/src/window/modules/downloads/video.ts:441-445, 454-460`). Continue (`:679-692`) picks the page's option with the same label ("1080p"); for an audio row any audio option (`M4A|AAC|WEBA|MP3|OPUS`, `:57`); else the video option of the same height. If none, the picker opens with "1080p is no longer offered", and picking another quality turns the row into "File changed".

### Why

"The pill on a page opened again finds the old row by it, where the offer's own key (media.ts: the tab's browserId and the signed address) changes with every session and every new signed address." (`streamkey.ts:1-5`). The ±1 s rule: "an element's 24.49 s and a playlist's 24.51 s round apart" (`:22-23`). "An unknown duration (0) matches only an unknown one (review of Phase 6: it matched any length)" (`:24`). "The key only nominates; the row's proof decides" (`:24-25`): the engine re-checks saved segments before continuing. Commit `6c03bb8` (2026-10-15, resume phase 6).

### Edge cases handled

- Signed URLs that change every session.
- A different container (Firefox container tab) never continues another container's row.
- A quality no longer offered.
- A direct file download gets no stream key (`video.ts:648`).

### Proven by

- `gecko/tests/downloads/stream-expiry.js:394-426` (continue, gone) and `:727-742` (container).

---

## Mechanism 16: The background page step (finding a stream again in a hidden tab)

### What it does

When a download's signed address expired and nothing else works, Deer opens the download's page in a hidden, muted tab, lets the page's own player fetch fresh addresses, and offers them to the engine, which proves they are the same file before using them. The person sees nothing (no tab, no sound, no history entry).

### How it works

Window half (`gecko/src/window/modules/downloads/resolver.ts`):

- Opens the page hidden, with the page's own origin as principal, in the download's container and privacy (`:236-260`).
- Keeps it out of history (`useGlobalHistory = false` and `disableglobalhistory`, `:134-152`), muted on every media controller it gets (`:263-301`), active (not throttled), with focus requests, dialogs and pop-ups blocked (`:302-315`).
- Every `LOOK_EVERY = 600` ms (`:56`), with `QUERY_MS = 3000` per page query (`:58`), it reads (`look()`, `:350-395`): the links of every frame (`downloads:links`, at most 2000 per frame and 4000 in total), whether a frame shows a password field, the main video's `src`, what `MediaWatch` saw under the hidden tab (`candidates()`), whether it is protected, where it landed, and its principal.
- Loads for at most `job.loadMs`, then collects for at most `job.collectMs`, stopping early when `job.enough()` says so (`:397-425`).
- Outcome: `ok`, `elsewhere` (another registrable domain), `timeout`, `failed`, `aborted`.
- Closes quietly (`:330-347`); if tabbrowser's related-tab chain is live, it parks the page on `about:blank` until the next tab switch (`MAX_PARKED = 3`, `:62`).

Engine half for streams (`gecko/src/modules/VitreDownloads.sys.ts:3618-3648`; constants `gecko/src/modules/downloads/pagestep.ts:34-49`):

```
near = hidden tab's media of the same format (hls/dash) on the stream's own host or with the same path shape
collect until a near stream has been seen for STREAM_SETTLE = 2000 ms
for url in rankStreams(near)[0..3]:
    info = streamInfo(url, fresh)                        // no 60 s cache
    skip if DRM, live, or |info.duration - duration| > DURATION_SLACK (1 s, table.ts:54)
    keep url
then the stream re-picks its quality by fingerprint and proves it against the saved segments
```

Limits: `LOAD_MS = 30 s`, `COLLECT_MS = 10 s`, `PER_SITE = 6` pages per site per `SITE_WINDOW = 1 h`, `PER_ROW = 30 min` (`pagestep.ts:34-40`).

### Why

Commit `52b75cf` (2026-10-15, resume phase 7): "When the original address and the stream steps find nothing, Deer opens the download's page in a hidden, muted tab ... and looks for the same file ... Never clicks, submits, signs in or fills a saved login; no popups, focus changes or audio; the visit is kept out of history". Design: `gecko/spikes/downloader/RESUME-DESIGN.md` G1 step 3, G2 step 4 (lines 192-205, 278-282). It is behind a setting, on by default (owner's decision 6, `resolve.js:64`).

### Edge cases handled

- A page that lands on another site or shows a password field: the row says "The page may need you to sign in." (`pagestep.ts:49`).
- Another stream of the same length on the page: tried first (recency) but proven not the same; the right one wins (`resolve.js` `stream2`).
- Process switches: history switch and mute are set again (`resolver.ts:352-358`).
- A window closing with a hidden page: the step ends at once (`:98-104`).

### Proven by

- `gecko/tests/downloads/resolve.js` sections `stream` (`:444-477`: an expired HLS stream renewed from its page's player out of sight, same row, 24 s), `stream2` (`:479-516`), `quiet` (muted), `popup`, `history`, `click` (never clicks), `budget`, `private`, `container`.

---

## Mechanism 17: yt-dlp for sites with nothing in the traffic

### What it does

On YouTube pages the mark is always shown; Ctrl+Shift+D runs yt-dlp (an external program) to list the formats. On other sites yt-dlp is the last resort after HLS, DASH and files. It is never run on hover.

### How it works

`ytdlpFirst(pageUrl)` (`gecko/src/modules/downloads/sites.ts:5-15`): host without `www.`, `m.`, `music.`; `youtu.be/<anything>`, or `youtube.com` / `youtube-nocookie.com` with a path starting `/watch`, `/shorts/`, `/live/` or `/embed/`. `probe()` runs `yt-dlp -J --no-warnings <page>` with a 60 s timeout (`ytdlp.ts:242-243`) and builds the ladder of Mechanism 9. No cookies are given to yt-dlp (`ytdlp.ts:37`).

### Why

"Which pages need yt-dlp: their traffic has nothing downloadable (YouTube streams through SABR/UMP POST requests)." (`sites.ts:1-2`). The network eye only keeps GET requests with media MIME types, so YouTube's traffic gives nothing.

### Edge cases handled

DRM formats filtered out; storyboards (`mhtml`) filtered out; live/upcoming refused; dubbed audio tracks come after the original.

### Proven by

`gecko/tests/downloads/ytdlp.js` (not in my file list; not read in detail).

---

## Mechanism 18: Alt+click and the links query (small helpers in the page module)

### What it does

Alt+click on a link downloads it (Chrome's convention), unless the page itself handled the click. The links query lists a frame's links for the background page step.

### How it works

Alt+click (`gecko/src/actors/page/downloads.ts:279-302`): only a trusted click with Alt alone and the primary button, not already `defaultPrevented`, on an `http(s)` link. The module waits for the click to bubble back to the window (after the page's own handlers) before it decides, calls `preventDefault()`, and sends the link and its referrer policy. The window downloads it with the frame's principal, cookie jar and referrer (`gecko/src/window/modules/downloads/video.ts:334-357`). Links query (`downloads.ts:374-392`): `a[href]`, `area[href]`, http(s) only, at most `MAX_LINKS = 2000` (`:49`), text max 200 characters, the `download` attribute, and whether an `input[type=password]` exists. Read-only.

### Why

"the page handled its own Alt+click" (`:289`): a page that uses Alt+click itself keeps it.

### Proven by

Not covered by the files in this section's test list.

---

## TitleLess today compared with Deer

TitleLess (from its own audit): a document-start user script in all frames reports `<video>` play/pause/ended and reads `performance.getEntriesByType('resource')` for `.m3u8` and media-file extensions. `MediaControls.swift` picks: the first playlist wins forever; otherwise the newest file wins. No scoring, no reject list. HLS only by `.m3u8` in the URL. No DASH, no extractors.

| Question | TitleLess today | Deer |
|---|---|---|
| What is a playlist? | `.m3u8` anywhere in the URL | MIME contains `mpegurl` OR URL ends in `.m3u8` before `?`/`#`; then the body must start with `#EXTM3U` |
| Master or variant? | not checked | a master has `#EXT-X-STREAM-INF:`; up to 4 playlists read, the first real master wins |
| Several playlists | the first wins forever | per document; ranked by name (master/index/playlist/manifest, descriptive vs opaque), then newest |
| Next video on a SPA | still the first playlist | path change drops media older than 1.5 s |
| Several files | the newest wins | the largest (by `Content-Range` total) wins |
| Segments, previews, ads | not rejected | segment extensions, script-fetched files, thumb/poster/preview/sprite/ad hints, files < 500 kB, element clips < 5 s all rejected |
| Audio vs video | not mentioned | audio dropped when a video exists |
| Frames | all frames report, not separated | frame-owned media kept apart; an iframe's video uses only its frame's media; hotlinked media asked as the frame |
| DRM | not mentioned in the audit | EME use, `encrypted`, `mediaKeys`, HLS key formats, DASH ContentProtection; refused at 7 layers |
| Live | not mentioned | `duration == Infinity`, no `ENDLIST`, `type="dynamic"` |
| Qualities | one URL | ladder, sizes, suggestion for the screen |
| Nothing found | not mentioned | a note that says why |

Why TitleLess's three rules fail:

- **"First playlist wins forever"**: a pre-roll ad, a preview on hover, or the previous video on a SPA is often the first playlist; the real video is never offered for that page.
- **"Newest file wins"**: on MSE pages the newest "media file" is often a segment (`.ts`, `.m4s`) if those extensions are in the sniff list; on feeds it is a hover preview; after the main video starts it is often an ad or a thumbnail video.
- **"`.m3u8` substring"**: misses playlists without the extension (common: `/manifest?id=...`, `/hls/playlist`), and matches URLs that only mention `.m3u8` in a query (trackers). It never checks `#EXTM3U`, so an HTML error page with a `.m3u8` address is treated as a playlist.

## Rules TitleLess should adopt

Concrete rules, each with the Deer source and an iOS way to do it. Statements marked "(unverified)" are my understanding of iOS, not checked.

1. **Nominate by URL and type, confirm by body.** A candidate playlist is real only if its body (after a BOM and whitespace) starts with `#EXTM3U`; a manifest only if `<MPD` followed by a space or `>` appears in its first 4096 characters. A master has a line starting `#EXT-X-STREAM-INF:`. (Deer: `playlist.ts:66-72`, `dash.ts:164-166`.) iOS: fetch with `URLSession` (cookies from `WKHTTPCookieStore`, `Referer` = page), read at most 8 MiB, timeout 12 s.
2. **Anchor the extension test**: `/\.m3u8(\?|#|$)/i` and `/\.mpd(\?|#|$)/i`, never "contains .m3u8". Better: test the URL's path only (Deer tests the whole URL; testing the path avoids tracker URLs with `.m3u8` in the query — my suggestion, not Deer's rule).
3. **Use the MIME when you can see it.** Resource Timing gives no MIME (unverified for WebKit: `PerformanceResourceTiming` has no content type field in shipping WebKit as far as I know). Options: wrap `fetch` and `XMLHttpRequest` in a page-world user script and read the response `Content-Type` (it is a CORS-safelisted response header, so it is readable on CORS responses), or confirm natively (rule 1).
4. **Never count a segment or a script-fetched file as "the video".** Reject `/\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/i`. Use Resource Timing's `initiatorType`: `xmlhttprequest` and `fetch` entries may be playlists, never whole files; whole files come from `video`/`audio`/`other` initiators (unverified: the exact `initiatorType` values WebKit reports for media elements). (Deer: `media.ts:29, 228-229`.)
5. **Reject the noise**: URL matches `/thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/i`; known size under 500,000 bytes; element duration under 5 s. (Deer: `media.ts:30, 237`; `downloads.ts:263`.)
6. **Largest file wins, not newest.** Size = total after `/` in `Content-Range`, else `Content-Length`; if unknown, ask with `Range: bytes=0-0` (8 s timeout). (Deer: `media.ts:235-237, 437, 553-561`.)
7. **Rank playlists, then read up to 4**: score = 2 if the file name matches `master|index|playlist|manifest`, +1 if the name is not opaque (Deer's `isOpaque` list and hash rule, `naming.ts:154-160`); ties by most recent. Take the first real master; else the first readable playlist. (Deer: `media.ts:91-97, 400-414`.)
8. **Records per document, not per tab.** Clear on a committed main-frame navigation (`WKNavigationDelegate.webView(_:didCommit:)`), never on a download response. On a same-document URL change (path differs, ignoring `#fragment`), drop items seen more than 1.5 s before the change. iOS: hook `history.pushState`/`replaceState`/`popstate` in the user script, or observe `WKWebView.url` with KVO (it changes on same-document navigations, unverified for every case). (Deer: `media.ts:181-202, 275-287`; `video.ts:151-166`.)
9. **Prefer `video.currentSrc` when it is http(s).** On iPhone many sites play native HLS (`<video src="…m3u8">`) because MSE is limited (ManagedMediaSource exists from iOS 17.1, unverified for every site), so `currentSrc` is often the master playlist itself, and AVFoundation's own requests may not appear in Resource Timing at all (unverified). Confirm by body (rule 1) since such URLs often have no `.m3u8`.
10. **Drop audio files when any video, HLS or DASH exists.** (Deer: `media.ts:307`.)
11. **Separate frames.** `WKScriptMessage.frameInfo` gives `isMainFrame`, `request.url` and `securityOrigin`: record each candidate's frame. For the page's own video use same-origin media first; for a video inside a cross-origin iframe use only that frame's media. On HTTP 4xx, retry once with `Referer` (and `Origin`) set to the frame's URL, and download the same way. (Deer: `media.ts:361-397`; commit `043f5e8`.)
12. **Refuse DRM, and keep refusing.** Mark the document protected (until the next committed navigation) when: the page calls `navigator.requestMediaKeySystemAccess` (wrap it in a page-world script) or the legacy `WebKitMediaKeys` (unverified which API a given iOS version exposes), any media element fires `encrypted` or the legacy `webkitneedkey` (capture listener, unverified for the legacy name), or a `<video>` has `mediaKeys`/`webkitKeys`. In HLS refuse `METHOD` other than `NONE`/`AES-128`, and any `KEYFORMAT` other than `identity` (FairPlay is `com.apple.streamingkeydelivery`; its key URIs usually start with `skd://`, which is a useful extra check). In DASH refuse any `ContentProtection`. Check again at download start. (Deer: `playlist.ts:104-110`; `dash.ts:173`; `VitreDownloads.sys.ts:1069-1074`.)
13. **Refuse live**: no `#EXT-X-ENDLIST` and no `#EXT-X-PLAYLIST-TYPE:VOD`; `duration == Infinity`; `type="dynamic"`. (Deer: `playlist.ts:195-196`.)
14. **Offer the ladder, not one URL**: one row per height (highest `BANDWIDTH` per height), size = `(AVERAGE-BANDWIDTH or BANDWIDTH)/8 × duration`, suggested = the tallest row not taller than the screen. On iOS use pixels: `fit = max(shortSide, longSide × 9/16)` of `UIScreen.nativeBounds` (my adaptation: Deer's `max(screen.height, screen.width × 9/16) × devicePixelRatio` assumes a landscape desktop screen). (Deer: `playlist.ts:168-177`, `media.ts:365-369, 494-513`, `video.ts:82-85`.)
15. **Always answer.** "Protected video", "Live · can't be saved", or "Can't save this video" plus the reason. (Deer: `video.ts:855-877`.)
16. **Main video = largest visible area, playing counts double**, at least 200 × 112 CSS px, visible (`opacity > 0.05`). This fits TitleLess's existing play/pause reporting. (Deer: `downloads.ts:354-373`.)
17. **Treat page messages as untrusted.** Validate every field from the user script (finite numbers, URL length ≤ 8192, title ≤ 300). (Deer: `video.ts:1232-1270`.) iOS: read DOM facts (`currentSrc`, `videoHeight`) from an isolated `WKContentWorld` where the page cannot tamper with your code; only the hooks that must wrap page functions (`fetch`, EME) need the page world (unverified that every hook works from an isolated world).

## Lessons worth copying

Ranked by value for TitleLess:

1. **Nominate by headers or URL, confirm by body.** Names and MIME types lie; `#EXTM3U` / `<MPD` / `#EXT-X-STREAM-INF` do not. Deer's mark may light for a broken stream, but it never offers one (`mark.js`).
2. **The kind of request separates segments from files.** Script-fetched responses are playlists or MSE segments, never "the video file"; segment extensions are never files. This alone fixes "newest file wins".
3. **Keep one record per document, and never clear on a response.** The spike's "clear on top-level response" let a download click erase the DRM mark (`RESULT.md:253-254`). Key by document; let old documents simply stop being current.
4. **The 1.5-second SPA rule.** On a same-document path change, forget media older than 1.5 s before the change; players fetch the next video just before they change the address.
5. **Rank, read a few, prefer a real master.** Name hints plus recency choose the order; reading up to 4 and checking for `#EXT-X-STREAM-INF` gives the full ladder.
6. **Largest, with the right size.** Use the `Content-Range` total (media elements use Range requests) and drop files under 500 kB.
7. **DRM is a sticky, document-wide state built from many signals, and it is checked again at the very end.** Late key sessions, iframes and direct requests are all covered because the final download start re-checks.
8. **Media belongs to the frame that loaded it.** Partition by frame; when a CDN refuses the page, ask as the player's frame and download the same way (commit `043f5e8`).
9. **Let the element fill the network's gaps**, with a 5 s minimum: media from cache or back-forward cache, native HLS `currentSrc`.
10. **A ladder with a screen-fit suggestion** (one row per height, size from `AVERAGE-BANDWIDTH`), instead of "best" or "first".
11. **Always say why.** Every failure path ends in a visible, specific note.
12. **A stable stream key** (`origin+path | rounded seconds | normalized title`, ±1 s) lets a reopened page continue an old download even when every signed URL changed.
13. **Cache offers, but key the cache by the media count**, so a newly seen stream invalidates the cached answer (`video.ts:413`).
14. **Re-open the page out of sight to renew expired links** (hidden, muted, no history, never clicks), with strict budgets (6 pages per site per hour, 30 min per download, 30 s + 10 s).

## Not worth copying / Windows-only

- **Gecko's network observers** (`http-on-examine-*`), `nsIContentPolicy` request types, `browserId`/`innerWindowId`, Xray wrappers. iOS WKWebView exposes no equivalent observer for all responses; the ideas transfer, the mechanism does not.
- **Monkey-patching Firefox's `EncryptedMediaParent`** and the spike's JSWindowActor with `safeForUntrustedWebProcess` and the Windows level-9 content sandbox rules (`RESULT.md:76, 140`). On iOS, EME detection must come from a user script.
- **yt-dlp, Deno and ffmpeg as external executables**, and the YouTube-first rule. iOS apps cannot download and run executables, and App Store Review Guideline 5.2.3 forbids saving media from third-party sources such as YouTube without authorization (from memory; check the current wording). The "terms reminder" list of hosts follows from the same concern.
- **TS vs MP4 label depending on ffmpeg**: TitleLess has its own TS remuxer, so it can always say MP4.
- **Alt+click link download**: a desktop mouse convention (on iPad with a keyboard it might map to Option+click, low value).
- **tabbrowser-specific hidden-tab care**: the related-tab chain and parking, closed-tab and closed-window list cleaning, SessionStore, Places history switches (`resolver.ts:34-47, 112-152, 210-234`). On iOS a hidden `WKWebView` is not in any tab model, so none of this is needed (but muting, no pop-ups and a separate budget still are).
- **Desktop UI details**: the glass pill's luma sampling, fly-to-ring origin from the last pointer press, compositor snapshot, the 12 px corner placement over a hovered video (iPhone has no hover; a toolbar badge plus a long-press action fits iOS better; iPad pointer hover could reuse the pill idea).
- **IDM interference** notes in the spike (`RESULT.md:148, 307`): specific to Windows machines with Internet Download Manager hooking `firefox.exe`.
