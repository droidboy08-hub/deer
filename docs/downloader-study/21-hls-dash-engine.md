# Downloading HLS and DASH streams

## In one paragraph

Deer saves a streamed video (HLS or DASH) by reading its playlist itself, choosing one quality, and
fetching that quality's small segment files on several connections at once (8 by default, at most 16).
Segments may arrive out of order, but they are always written in order into one file per track
(`<name>.video.part`, and `<name>.audio.part` when the sound is a separate track). Early segments wait
in memory up to 48 MiB, then in a folder on disk. A segment that is overdue is fetched a second time in
parallel ("raced"), and the slower copy is thrown away. AES-128 segments are decrypted; DRM (SAMPLE-AES,
Widevine, PlayReady, FairPlay, any DASH ContentProtection) and live streams are refused with a clear
sentence. Every segment is checked to be media before it is written: a web page or JSON is never written.
When a segment address expires (403 and similar), Deer reads the same playlist again and finds the same
segment by its media sequence number, never by its position. Each written segment leaves a line with its
hash in a journal (the "segment table"), so a resume (even days later, after a crash, or from a new
address) can prove that the stream on the site is still the same one before it writes anything more. At
the end ffmpeg joins the tracks with `-c copy` (no re-encoding) into MP4 (or WebM). Without ffmpeg, or if
ffmpeg fails, nothing is lost: the tracks are kept as separate files and the row says why.

## Files

| File | Role | Lines |
|---|---|---|
| `gecko/src/modules/downloads/hls.ts` | The stream engine `StreamTransfer`: prepare (read playlists, pick tracks, prove a resume), download (parallel fetch, in-order write), finish (ffmpeg join), keep partial, renewal of expired addresses, If-Range on byte ranges, decryption, sniffing. Used for HLS and DASH. | 1943 |
| `gecko/src/modules/downloads/playlist.ts` | HLS parser: master and media playlists, the quality ladder, the audio rendition of a variant. Pure functions, no I/O. | 229 |
| `gecko/src/modules/downloads/dash.ts` | DASH parser: MPD to a list of representations, each turned into the same `MediaPlaylist` shape HLS uses. | 245 |
| `gecko/src/modules/downloads/table.ts` | Read because hls.ts depends on it for resume: the segment table (journal), `mapNext()` (where a resume continues), `repick()` / `matchRep()` (the same quality in a re-read master or manifest). | 389 |
| `gecko/src/modules/downloads/ranged.ts` | Only `silentRestart()` (ranged.ts:363-368) and `TransferEnv` (ranged.ts:335-354) are used by hls.ts. | 2138 |
| `gecko/src/modules/downloads/proof.ts` | hls.ts does not import it. Only `ASK_ABOVE = 1 MiB` (proof.ts:29) matters here, through `silentRestart()`. | 611 |
| `gecko/src/modules/downloads/net.ts` (parts) | Errors and retry rules hls.ts uses: `REFUSED_STATUS`, `isRetryable`, `backoff`, `stopsRun`, `textStart`, `Response.bytes`, the 30 s idle timeout. | 1009 |
| `gecko/src/modules/downloads/ffmpeg.ts` | `runFfmpeg()`: runs ffmpeg, reads progress from stderr. | 124 |
| `gecko/src/modules/downloads/partfile.ts` (parts) | `Writer`: appends bytes off the main thread; `durable` and `backlog`. | — |
| `gecko/src/modules/downloads/streamkey.ts` | The stable key a re-opened page uses to find an old stream row. | 39 |
| `gecko/src/modules/VitreDownloads.sys.ts` (parts) | `runStream()` (1811-1892), `mergeLeft()` (925-947), `restartStream()` (3745-3761): how the engine drives a stream. | — |
| `gecko/src/modules/downloads/media.ts` (parts) | `describe()` / `describeDash()` (474-547): what the picker offers and hands to the engine. | 573 |
| `gecko/spikes/downloader/verify/engine/VitreHls.sys.mjs` | History: the first Gecko port (no racing, no spill, no refresh, no sniffing). | 343 |
| `gecko/spikes/downloader/verify/engine/VitrePlaylist.sys.mjs` | History: the parser before two fixes (VOD playlist type, 16-byte IV). | 184 |
| `app/src/main/modules/downloads/hls.ts` | History: the Electron port ("ported from HLSDownload.swift"), which already had racing and spill. | 552 |
| `gecko/tests/downloads/streams.js` | Evidence: HLS through the UI, AES-128, fMP4 + separate audio, DASH, racing, 403 refresh, segment table, repair. | 174 |
| `gecko/tests/downloads/stream-expiry.js` | Evidence: 22 sections on expiry, re-encoding, renamed DASH ids, HTML segments, damage, crash, byte ranges with flapping validators. | 775 |
| `gecko/tests/downloads/server.py` (stream routes) | Evidence: the test server's misbehaving stream routes (`/hedge`, `/token`, `/vod-*`, `/dash-rename`). | 1974 |
| `gecko/tests/downloads/fixtures.py` | How the test streams are made with ffmpeg (TS, AES-128, fMP4 with separate audio, DASH timeline, DRM, live). | 140 |
| `gecko/tests/downloads/drm.js`, `noffmpeg.js`, `ui.js`, `embed.js` | Evidence: DRM refusal, life without ffmpeg, live refusal in the pill, segments labelled `image/jpeg`. | — |
| `gecko/spikes/downloader/RESUME-DESIGN.md` | The design (approved by the owner 2026-10-13): G2 (expired stream links), 2.6 (stream proof), 4.1-4.3 (table, damage, repair), 5.3, 5.7. | 817 |
| `gecko/spikes/downloader/RESULT.md` | Spike evidence: real streams (mux.dev, Apple bipbop fMP4). | 306 |

## Words used in this document

- **HLS** (HTTP Live Streaming, Apple's format): a video cut into many small files called **segments**
  (often 2-10 s each), listed in a text file called a **playlist** (`.m3u8`, first line `#EXTM3U`).
- **Master playlist** (also "multivariant playlist"): lists several **variants** of the same video, one
  per quality (`#EXT-X-STREAM-INF` lines). Each variant has its own **media playlist**.
- **Media playlist**: lists the segments of one variant: `#EXTINF:<seconds>` then the segment's URL.
- **Rendition**: an extra track declared with `#EXT-X-MEDIA` (audio in another language, subtitles). A
  variant names its audio group with `AUDIO="<group>"`.
- **Rung**: Deer's word for one quality step of the ladder (360p, 720p, 1080p...). Its **fingerprint**
  is what identifies it again later (height, codecs, bandwidth, audio group/language/name).
- **Media sequence**: the number of a segment. `#EXT-X-MEDIA-SEQUENCE:N` gives the number of the first
  segment; the next ones count up by 1.
- **TS** (MPEG transport stream): the classic segment container, made of 188-byte packets that each start
  with the byte `0x47` (the "sync byte").
- **fMP4** (fragmented MP4, also CMAF): an MP4 split into one **init segment** (`ftyp` + `moov`: the
  codec setup, no media) and many media segments (`moof` + `mdat`). Concatenated, they form a valid MP4.
- **Init segment**: the header every media segment needs. HLS: `#EXT-X-MAP:URI=...`. DASH:
  `initialization="..."` or `<Initialization>`.
- **Byte range**: a segment that is a slice of a bigger file (HLS `#EXT-X-BYTERANGE:<len>@<offset>`).
- **Range request**: an HTTP request with `Range: bytes=A-B` that asks only bytes A to B.
- **HTTP 206** (Partial Content): the server sent just the asked range. **HTTP 200**: it sent the whole
  file.
- **ETag**: a label the server gives a version of a file. "Strong" ETags (`"abc"`) promise identical
  bytes; "weak" ones (`W/"abc"`) do not. **Last-Modified**: a date for the version.
- **If-Range**: "send me this range only if the file is still this version (ETag or date); otherwise send
  the whole file with 200".
- **AES-128** (in HLS): the whole segment is encrypted with AES in CBC mode with PKCS#7 padding. The key is
  a 16-byte file at the key's URI. The **IV** (initialization vector, 16 bytes) is the `IV=` attribute, or
  else the segment's media sequence number.
- **SAMPLE-AES**: only the audio/video samples inside the segment are encrypted, usually for FairPlay. Deer
  treats it as DRM.
- **DRM**: Widevine, PlayReady, FairPlay: keys come from a license server and are bound to a player. Such
  video cannot be saved.
- **DASH** (MPEG-DASH): the other format. Its manifest is an XML file (`.mpd`): `MPD` > `Period` (a time
  span) > `AdaptationSet` (a kind of track: video, audio) > `Representation` (one quality).
- **SegmentTemplate**: a URL pattern with `$Number$` or `$Time$` that DASH fills in for each segment.
  **SegmentTimeline**: the exact start time `t`, duration `d` and repeat count `r` of each segment.
  **SegmentList**: an explicit list of segment URLs. **SegmentBase**: the representation is one file;
  an index (**sidx** box, at `indexRange`) says where each fragment sits in it. **BaseURL**: a URL prefix
  that can appear at each level of the MPD.
- **Remux**: change the container without re-encoding the audio and video (ffmpeg `-c copy`).
- **faststart**: put the MP4's index (`moov` box) at the start of the file so a player can start at once.
- **Part file**: the temporary file a download writes into (`.part`).
- **Spill**: writing segments that arrived early to temporary files on disk instead of keeping them in RAM.
- **Back-pressure**: waiting for the disk when too much is queued for writing.
- **Hash**: here SHA-256 of the bytes, cut to the first 128 bits (32 hex characters).
- **Journal**: a file of JSON lines that is only appended to.

## How a stream download flows (overview)

1. **Start.** The picker (media.ts:474-547) or another caller makes a `StreamState` with
   `StreamTransfer.fresh(sourceUrl, {format, variantUrl, audioUrl, dashVideo, dashAudio, audioOnly, bytes,
   rung})` (gecko/src/modules/downloads/hls.ts:304-320; VitreDownloads.sys.ts:1123).
2. **runStream** (gecko/src/modules/VitreDownloads.sys.ts:1811-1892):
   - opens the segment table (its journal), or starts one;
   - if every segment of every track is already written, or a merge was cut short, it goes **straight to
     the merge** and never asks the network (VitreDownloads.sys.ts:1830-1838);
   - otherwise `prepare()`: read the playlists, pick the tracks, check saved parts, prove a resume, renew
     expired addresses (hls.ts:369-398);
   - chooses the file name and extension (`expectedExtension()`, hls.ts:977-989);
   - `download()`: the tracks **one after the other**, video first, then audio (hls.ts:993-999);
   - `finish()`: join with ffmpeg, or keep the parts as files (hls.ts:1011-1056).
3. **Errors** go to the engine, which sorts them (net.ts `classify()`): a refused address becomes "Link
   expired" with automatic tries later; a changed stream becomes "File changed" (or a silent restart when
   at most 1 MiB is saved); 429/5xx become "Retrying"; network losses become "Waiting for network".

The saved record (persisted every 2 s, flushed every 30 s and on state changes; VitreDownloads.sys.ts:259-261):

`StreamState` (hls.ts:108-149): `format` ('hls'|'dash'), `sourceUrl` (master or manifest), `variantUrl`,
`audioUrl`, `dashVideo` / `dashAudio` (representation ids), `audioOnly`, `resolved` (tracks chosen),
`bandwidth`, `duration`, `expected` (size estimate from the picker), `tracks`, `silent` (times of silent
restarts), `phase` ('merging'), `mergeOut`, `mergeBase`, `rung` (fingerprint), `journal` (table path),
`renew`, `proven`, `prior`.

`StreamTrack` (hls.ts:74-106): `kind` ('main'|'audio'), `url` (HLS: media playlist; DASH: the manifest
URL + `#vitre-rep=<id>`), `done` (segments written), `bytes` (bytes in its part), `initBytes`, `count`,
`secs` (media seconds written), `length` (seconds in the whole track), `container`
(''|'ts'|'mp4'|'aac'|'webm'), and for resume: `nextSeq`, `seq0`, `lastDur`, `initHash`, `lastHash`,
`pathShape`, `keyUrls`, `rung`, `sealedAt`.

---

## Reading a playlist: detection and HLS line parsing

**What it does**
Deer only treats a text as a playlist when its content says so. A URL ending in `.m3u8` is not enough,
and a 200 answer with a web page is not a playlist.

**How it works**
- Every fetched playlist text must pass `isPlaylist()` (starts with `#EXTM3U` after an optional BOM and
  spaces; playlist.ts:66-68) or `isMpd()` (`<MPD` followed by a space or `>` within the first 4096
  characters; dash.ts:164-166). Otherwise `NotAPlaylistError` (hls.ts:220-225, 1627), which counts as a
  refused address: the renewal steps may find a working one (hls.ts:228-230).
- `isMaster()`: any line starts with `#EXT-X-STREAM-INF:` (playlist.ts:70-72).
- `lines()` (playlist.ts:58-64): strip a BOM, split on `\r\n`, `\r` or `\n`, trim each line, drop empty
  lines.
- `attr(line, NAME)` (playlist.ts:75-94): finds `NAME=` only where it starts an attribute (the character
  before it is `:` or `,`), so `BANDWIDTH` never matches inside `AVERAGE-BANDWIDTH`. A quoted value runs to
  the next quote (so commas inside `CODECS="avc1...,mp4a..."` are safe); a bare value runs to the next
  comma.
- Relative URLs are resolved against the playlist's own URL with `new URL(ref, base)` (playlist.ts:96-102).
- Playlist texts are cached per URL for the life of one transfer (`texts`, hls.ts:272, 1621-1622); a
  "fresh" read skips the cache.
- How the page's player is noticed in the first place is another section, but note: media.ts:226 marks a
  response as HLS by its MIME type (`mpegurl`) **or** its `.m3u8` URL, and DASH by `dash+xml` or `.mpd`
  (media.ts:227).

**Why**
The design (gecko/spikes/downloader/RESUME-DESIGN.md G2 "Detection") lists "answering with something that
is not a playlist" as a sign of an expired address: signed CDNs often answer an expired link with a
200 HTML page. The `attr()` start-of-attribute rule is noted in its own comment (playlist.ts:74).

**Edge cases handled**
- BOM at the start of the file, CR-only line ends, spaces around lines.
- `BANDWIDTH` vs `AVERAGE-BANDWIDTH`.
- A playlist answered with a page: `NotAPlaylistError`, never parsed.

**Proven by**
- stream-expiry.js "first" (748-772): a first start whose playlist always answers 403 is asked 3 times and
  fails; nothing else is tried.
- streams.js section 1 (30-71) parses a real ffmpeg-made master.

**iOS mapping**
Pure string work; port as is in Swift. Check `#EXTM3U` in the body and the `Content-Type`
(`application/vnd.apple.mpegurl`, `application/x-mpegURL`, `audio/mpegurl`) as well as the URL. TitleLess
(per its audit) detects HLS only by `.m3u8` in the URL: a playlist served from a URL like
`/manifest?id=...` is missed, and an expired link that returns HTML would be parsed as a playlist.

---

## Master playlists: variants, the ladder, and which quality is downloaded

**What it does**
The picker shows one row per resolution ("360p", "180p", "M4A"). Without a picker choice, the engine takes
the best video quality.

**How it works**
- `parseMaster()` (playlist.ts:127-165) reads:
  - `#EXT-X-STREAM-INF:` attributes `BANDWIDTH`, `AVERAGE-BANDWIDTH`, `RESOLUTION` (`WxH`), `CODECS`
    (lower-cased), `AUDIO` (group id); the next non-`#` line is the variant URL.
  - A variant is **audio-only** when it has no height, has codecs, and none of them is a video codec
    (regex `avc|hvc|hev|av01|vp0?9|dvh`, playlist.ts:156).
  - `#EXT-X-MEDIA:` → renditions (TYPE upper-cased, GROUP-ID, NAME, LANGUAGE, URI, DEFAULT=YES).
  - `#EXT-X-SESSION-KEY:` with a DRM key → `drm = true`.
  - `#EXT-X-I-FRAME-STREAM-INF` lines carry their URI as an attribute, not on the next line, so they are
    never taken as variants (no code needed: they do not start with `#EXT-X-STREAM-INF:`).
- `ladder()` (playlist.ts:168-177): only `http(s)` URLs; one entry per "rung key": video `h<height>`, video
  without height `b<bandwidth>`, audio `a<bandwidth>`; within a rung the highest BANDWIDTH wins; sorted video
  first (height down, then bandwidth down), audio-only last.
- Picker (media.ts:474-523): reads the master, reads the first video variant's media playlist to learn the
  duration, live or not, DRM, and fMP4 or TS. Each option carries `variantUrl`, `audioUrl` (the variant's
  audio rendition), a size estimate `(AVERAGE-BANDWIDTH or BANDWIDTH) / 8 × duration` (media.ts:497; the
  comment says BANDWIDTH already counts the audio rendition), and its fingerprint `rung`.
- Engine (`prepareHls()`, hls.ts:683-739):
  - With a `variantUrl` from the picker, the engine reads that media playlist directly; the master is not
    read (hls.ts:690). `audioUrl` becomes the second track.
  - Without one, it reads the source; if it is a master: `audioOnly` → the first audio-only variant;
    otherwise the first video rung (the best height), else `rungs[0]` (hls.ts:714-715). Its audio rendition
    (if any) becomes the audio track (hls.ts:724). The rung fingerprint is stored with `rungOf()`
    (table.ts:258-270).
  - Audio-only on a master whose sound exists only as `#EXT-X-MEDIA` renditions: the rendition becomes the
    main track, with `renditionRung()` as fingerprint (hls.ts:717-720).
  - Nothing usable → "This stream has nothing Deer can save." (hls.ts:727).
- If the picker's variant URL already expired before the start (403), Deer reads the master (`sourceUrl`)
  fresh and picks the same rung by fingerprint (hls.ts:696-706).

**Why**
- One row per height keeps the picker short; the richest encoding of a height is the one people want.
- Storing the fingerprint (RESUME-DESIGN.md 5.3) lets a re-read master give back "the same quality" even
  when every URL changed (signed tokens). Commit 6c03bb8 (2026-10-15): "the master/manifest re-read with
  the same rung re-picked by fingerprint".
- The audio-only rendition fingerprint was added after the Phase 6 review: "such downloads could never
  renew" (hls.ts:719, table.ts:309-311).

**Edge cases handled**
- Audio-only variants vs tiny video variants (no RESOLUTION but a video codec stays video).
- Several encodings of one height (different codecs or bitrates): only the richest is listed.
- A master with only audio renditions and no audio variant ("Audio only" from a rendition).
- A picker variant that expired before the download started.

**Proven by**
- streams.js:44 ("the offer is the HLS ladder", 360p,180p) and 54-70 (180p picked and downloaded).
- stream-expiry.js "audio" (651-674): an audio-only download of the master's own audio rendition renews from
  the master and keeps `rung.audioName === "audio_1"`.

**iOS mapping**
Same parser in Swift. AVFoundation does not expose the variant list of a remote master in a way that gives
you URLs to fetch yourself, so keep parsing it. Store the fingerprint (height, codecs, bandwidth, audio
group/language/name) with the download, not just the variant URL. TitleLess: per its audit, MediaControls
picks "the first playlist wins forever"; the audit does not mention a ladder or a fingerprint.

---

## Alternate audio renditions (EXT-X-MEDIA) and subtitles

**What it does**
When a variant's sound lives in its own playlist (common for fMP4, e.g. Apple's bipbop), Deer downloads it
as a second track and joins it. Subtitles are not downloaded.

**How it works**
- `audioFor(master, variant)` (playlist.ts:180-184): if the variant has an `AUDIO` group, take the
  renditions with `TYPE=AUDIO`, that group, and a URI; prefer `DEFAULT=YES`, else the first. No group → the
  sound is inside the variant's own segments (muxed), no second track.
- A rendition without a URI (sound muxed in the variant but described) is skipped (filter `r.url`).
- On a re-read master (renewal), the audio is matched by fingerprint (`audioOf()`, table.ts:365-375):
  language and name together, then name, then language; then the default. When the track already exists as
  its own sound track (`strict`), a missing language/name is **not** replaced by the default: "its sound
  (<lang>) is no longer offered" (hls.ts:761-764).
- A stream whose shape changes (separate sound appears or disappears) is another stream: `retrack()` throws
  ChangedError "its sound is no longer offered separately" / "it now comes with separate sound"
  (hls.ts:779).
- Subtitles: `TYPE=SUBTITLES` and `CLOSED-CAPTIONS` renditions are parsed into `renditions` but nothing
  ever downloads them (only `TYPE=AUDIO` is used). DASH adaptation sets that are neither video nor audio are
  skipped (dash.ts:192, comment "subtitles, thumbnails").

**Why**
The Phase 6 review found that taking the default rendition silently could continue "a sound track not yet
started ... in another language" (table.ts:362-363). Matching by group, language and name prevents mixing
two languages in one file.

**Edge cases handled**
- No AUDIO group; group without URIs; several languages in one group; renamed group IDs (the language and
  name still match).
- The master no longer offers the language that was being saved: File changed, never a silent switch.

**Proven by**
- streams.js section 2 (73-79): fMP4 with a separate audio rendition becomes one MP4 with video and audio,
  24 s.
- RESULT.md:278: Apple's bipbop fMP4 (EXT-X-MAP, EXT-X-BYTERANGE, separate AAC rendition): tracks 100/100
  and 101/101 segments, merged MP4 600.04 s, 0 decode errors.
- stream-expiry.js "audio" (651-674).

**iOS mapping**
Download the audio rendition as its own track (same segment engine). Join with `AVMutableComposition`
(one video track from the video file, one audio track from the audio file) and export with
`AVAssetExportSession` + `AVAssetExportPresetPassthrough` to `.mp4`, or write both into one
`AVAssetWriter` with `outputSettings: nil` (passthrough). Subtitles: WebVTT renditions could be saved next to
the video; Deer does not do it either. TitleLess: the audit says TSRemuxer remuxes "TS/fMP4 into one MP4",
but does not say whether a separate audio rendition is fetched and joined (unknown).

---

## Media playlist parsing (segments, durations, sequence, byte ranges, init, keys)

**What it does**
Turns a media playlist into a list of segments, each with its URL, media sequence, key, byte range and
duration, plus the init segment, the "ended" flag, DRM, and I-frames-only.

**How it works** (`parseMedia()`, playlist.ts:186-229), line by line:

| Tag | Effect |
|---|---|
| `#EXT-X-I-FRAMES-ONLY` | `iframesOnly = true` (refused later: "This video can't be saved.", hls.ts:443) |
| `#EXT-X-ENDLIST` | `endList = true` |
| `#EXT-X-PLAYLIST-TYPE:` matching `/VOD/i` | `endList = true` (playlist.ts:196; not in the spike's parser) |
| `#EXT-X-MEDIA-SEQUENCE:N` | first sequence number `seq = N` (default 0) |
| `#EXT-X-BYTERANGE:<len>[@<off>]` | range for the next segment; without `@off` it starts where the last range ended (`lastEnd`) |
| `#EXT-X-KEY:` | DRM check; `METHOD=AES-128` with a URI → current key `{url, iv}`; `METHOD=NONE` → no key |
| `#EXT-X-MAP:URI=...[,BYTERANGE=...]` | `init = {url, key: current key, range}`; a MAP range without `@` starts at 0 |
| `#EXTINF:<d>,` | duration of the next segment |
| a non-`#` line after `#EXTINF` | a segment `{url, seq: seq + index, key, range, duration}` |

- Ranges are stored as `[start, end)` (end exclusive) (playlist.ts:112-118).
- `IV=0x...`: `hexBytes()` strips `0x`, pads to 32 hex digits on the left and keeps the last 32 → always 16
  bytes (playlist.ts:120-125). The spike's version made an array of the hex length (VitrePlaylist.sys.mjs),
  so a long IV gave a wrong-size IV.
- `duration` of the playlist = sum of EXTINF.
- `durHash()` (table.ts:65-70): an FNV-1a hash of all durations to 3 decimals; it tells a playlist that was
  re-cut into other durations.

**Why**
- `PLAYLIST-TYPE:VOD` without `ENDLIST`: some servers mark a finished video only with the type; the spike
  would have refused them as live.
- Sequence numbers are kept per segment because every later step (refresh, resume, IV) depends on them,
  never on positions (RESUME-DESIGN.md 2.6).

**Edge cases handled**
- Byte ranges without offsets (continuing ranges).
- Key changes mid-playlist (key rotation): each segment keeps the key in force when it was listed.
- `METHOD=NONE` after an encrypted part.

**Gaps (not handled; read from code)**
- `lastEnd` is shared across URLs: a `BYTERANGE` without offset after a range of **another** file would
  start at the wrong place (the HLS spec says "of the same resource"). Rare in practice.
- Only the **last** `#EXT-X-MAP` is kept (`out.init` is overwritten, playlist.ts:215). Streams whose init
  segment changes (after a discontinuity, e.g. inserted ads) are not supported correctly.
- `METHOD=AES-128` without a URI keeps the previous key (playlist.ts:205-209).
- `#EXT-X-DISCONTINUITY`, `#EXT-X-GAP`, `#EXT-X-PROGRAM-DATE-TIME`, `#EXT-X-PART` (low-latency) are
  ignored (no match anywhere in the downloads code).

**Proven by**
- streams.js sections 1, 2, 5 and the byte-range sections of stream-expiry.js ("br", 579-596, uses
  `#EXT-X-BYTERANGE:<len>@<off>` over one `all.ts`, server.py:1664-1672).
- RESULT.md:278 (bipbop uses EXT-X-BYTERANGE and EXT-X-MAP).

**iOS mapping**
Port as is. In Swift keep ranges as half-open `Range<Int64>`. Keep the sequence number on each segment.
Track `lastEnd` per URL to be more correct than Deer.

---

## DRM refusal (SAMPLE-AES, Widevine, PlayReady, FairPlay, DASH ContentProtection)

**What it does**
A protected video fails at once with "This video is protected and can't be saved." (hls.ts:176). Nothing is
downloaded.

**How it works**
- `keyIsDrm(line)` (playlist.ts:104-110):
  - `METHOD=NONE` → not DRM;
  - any method other than `AES-128` (`SAMPLE-AES`, `SAMPLE-AES-CTR`, ...) → DRM;
  - `AES-128` with a `KEYFORMAT` other than `identity`, or matching
    `/widevine|edef8ba9|playready|9a04f079|streamingkeydelivery|fairplay|com\.microsoft/i` (playlist.ts:56)
    → DRM.
- Checked on `#EXT-X-KEY` in media playlists and `#EXT-X-SESSION-KEY` in masters (playlist.ts:133, 202).
- DASH: any `ContentProtection` element anywhere in the MPD → DRM (dash.ts:173).
- The engine refuses in `prepareHls()` (master DRM, hls.ts:711), `settle()` (media DRM, hls.ts:441),
  `prepareDash()` (hls.ts:791). The picker marks a DRM stream "protected" and offers nothing for it
  (media.ts:416, 433; DASH options are not even built, media.ts:531). A tab where the page used EME
  (ClearKey, Widevine) offers nothing at all (media.ts:16, 300).

**Why**
Owner decision in design/DESIGN-NOTES.md ("Host deny list" row): "DRM streams (Widevine, PlayReady,
FairPlay) are always refused." `edef8ba9...` is Widevine's system ID, `9a04f079...` PlayReady's,
`streamingkeydelivery` FairPlay's KEYFORMAT.

**Edge cases handled**
- DRM declared only in the master (`SESSION-KEY`) before any media playlist is read.
- AES-128 with a vendor KEYFORMAT (DRM in disguise).

**Proven by**
- drm.js:56-62: an HLS master with a Widevine session key and a DASH manifest with ContentProtection are
  both refused with "protected".
- RESULT.md:81-82: "DRM master refused with 'This video is protected and can't be saved.'"
- Fixtures: fixtures.py:83-86 (`drm.m3u8`), 105-110 (`dash-drm.mpd`).

**iOS mapping**
Same rule in Swift. On iOS this matters even more: an App Store app must not circumvent FairPlay. Refuse
before fetching any segment. TitleLess: its audit does not say whether SAMPLE-AES or a FairPlay KEYFORMAT is
refused (unknown); its HLS task decrypts AES-128, so check that it refuses anything else.

---

## Live and EVENT playlists

**What it does**
A live stream fails with "Live streams can't be saved." (hls.ts:177). The pill shows "Live · can't be
saved".

**How it works**
- HLS: a media playlist without `#EXT-X-ENDLIST` and without `PLAYLIST-TYPE:VOD` is live (`endList` false)
  → refused in `settle()` (hls.ts:442). An `EVENT` playlist that has not ended is therefore refused too.
- DASH: `type="dynamic"` → live (dash.ts:174) → refused (hls.ts:792).
- There is no live-recording loop: Deer never re-polls a live playlist for new segments.
- The only playlist re-reads during a run are for **expired addresses** (see "Expired addresses inside a
  run").

**Why**
Recording live needs a polling loop at the target duration, sliding windows and an end condition; Deer does
not do it. RESUME-DESIGN.md 8 lists "DRM ... and live streams" under "Can never work".

**Edge cases handled**
- VOD marked only by PLAYLIST-TYPE (accepted).
- A live DASH manifest is refused at the picker (media.ts:529) and in the engine.

**Proven by**
- ui.js:151-154: "a live stream says it can't be saved".
- Fixture: fixtures.py:112-119 (a playlist without ENDLIST, MEDIA-SEQUENCE 3).

**iOS mapping**
Same check. If TitleLess ever wants live recording, it is new work (poll the media playlist every target
duration, append new sequence numbers only, stop on ENDLIST or user stop). TitleLess's audit does not say
how it treats a playlist without ENDLIST (unknown).

---

## Discontinuities and other HLS features Deer does not handle

**What it does**
Nothing special: segments are concatenated in playlist order.

**How it works**
- `#EXT-X-DISCONTINUITY` is not parsed. Segments before and after a discontinuity go into the same part
  file. Only the last `#EXT-X-MAP` is kept.
- The ffmpeg join (`-c copy`) then sees jumps in timestamps or a codec change. What ffmpeg does with them
  is not tested in Deer (no fixture with a discontinuity).
- The only safety net is the length check after the merge (see "Length check after the merge").

**Why**
Not stated in code or docs. Probably not needed for the VOD sites tested.

**Edge cases handled**
None.

**Proven by**
No test.

**iOS mapping**
For a TS stream, a discontinuity means timestamps restart: an AVAssetWriter-based remuxer must offset
timestamps after each discontinuity, or split into separate time ranges and append them to an
`AVMutableComposition` one after the other. For fMP4 with a new `EXT-X-MAP`, each run of segments needs its
own init segment (write separate files, then compose). This is a place where TitleLess could do better than
Deer.

---

## DASH manifest parsing (MPD)

**What it does**
Turns one DASH manifest into a list of representations, each with the same segment-list shape HLS uses
(`MediaPlaylist`), so the rest of the engine treats both formats alike.

**How it works** (dash.ts)
- XML is parsed with Gecko's `DOMParser` (dash.ts:39-48).
- `drm`: any `ContentProtection` (dash.ts:173). `live`: `MPD@type == "dynamic"` (dash.ts:174).
- `periods`: count of `Period` children. Only the first is read; **more than one Period is refused** in the
  engine: "This video is made of several parts Deer can't join yet." (hls.ts:793).
- Duration: `Period@duration`, else `mediaPresentationDuration - Period@start`, else the presentation
  duration (dash.ts:180-181). `isoSeconds()` parses ISO 8601 durations (`PT1H2M3.5S`, `P1DT2H`; a month
  counts 30 days, a year 365) (dash.ts:54-60).
- **BaseURL**: resolved level by level: MPD (against the manifest URL) → Period → AdaptationSet →
  Representation; only the first `BaseURL` child at each level is used (dash.ts:71-74, 182-197).
- **Kind**: `mimeType` (Representation, else AdaptationSet) `video/*` or `audio/*`, or the set's
  `contentType`; anything else (subtitles, thumbnails `image/jpeg`) is skipped (dash.ts:189-192).
- **SegmentTemplate** (dash.ts:93-148):
  - Attributes are merged from Period, then AdaptationSet, then Representation (inner levels override);
    the innermost `SegmentTimeline` wins.
  - `media` is required; `timescale` default 1; `startNumber` default 1.
  - `initialization` is expanded with Number = startNumber, Time = 0.
  - `expand()` (dash.ts:77-85) fills `$RepresentationID$`, `$Bandwidth$`, `$Number$`, `$Time$`, with an
    optional width `%0Nd` (zero-padded), and `$$` → `$`.
  - With a **SegmentTimeline**: for each `S`: `t` (if present) sets the time; `d` the duration; `r` the
    repeat count. A negative `r` repeats "until the next S's `t`, or the end of the period":
    `r = max(0, ceil((nextT - time) / d) - 1)` (dash.ts:131-135). Each segment gets `Number = startNumber++`
    and `Time = t` (in timescale units). At most 100000 segments (dash.ts:136).
  - Without a timeline: `duration` attribute; `count = ceil(periodSeconds × timescale / duration - 1e-6)`;
    the last segment is shortened to the period's end (dash.ts:143-147).
  - Segment durations are stored in seconds (`d / timescale`).
- **SegmentList** (dash.ts:150-162): `Initialization@sourceURL` + `@range`; each `SegmentURL@media`
  (else the BaseURL) + `@mediaRange`; uniform duration `duration / timescale`; sequence numbers from 1. Read
  from the Representation, else the AdaptationSet (not the Period).
- **SegmentBase or a bare BaseURL**: no segment list; `file = base` (dash.ts:215). The engine turns it into
  4 MiB byte-range pieces (see "Byte-range pieces"). **`indexRange` and the `sidx` box are not read.** The
  whole file is fetched from byte 0, so the init part is included and no index is needed.
- `dashLadder()` (dash.ts:223-231): one video representation per height (highest bandwidth), best first.
- `dashAudio()` (dash.ts:234-240): the language of the **first** audio representation in the manifest, and
  within that language the highest bandwidth.
- `dashContainer()`: "WEBM" when the mime contains `webm`, else "MP4" (dash.ts:243-245).

**Why**
- DASH was added on Gecko; the Electron build "only detected them" (dash.ts:1-3). Design decision in
  design/DESIGN-NOTES.md "HLS / DASH": "Add DASH (best video + audio, joined)."
- Turning every representation into a `MediaPlaylist` reuses all of the HLS machinery (parallel fetch,
  retries, resume, proof).
- Fetching SegmentBase as plain byte pieces avoids parsing `sidx`: concatenating the pieces rebuilds the file
  exactly.

**Edge cases handled**
- `$Number%05d$` padding; `$$`; template attributes split across levels; `r="-1"`; missing `t`.
- Nested BaseURLs (relative at each level).
- Subtitle/thumbnail adaptation sets ignored.

**Gaps (read from code)**
- Multi-period MPDs (ads, chapters) are refused.
- `presentationTimeOffset`, `availabilityTimeOffset`, multiple BaseURLs (CDN fail-over), and
  `SegmentTemplate@index` are ignored.
- A SegmentTemplate without `media`, or without `duration` and timeline (`fromTemplate` returns null),
  makes the representation a "one file" at its BaseURL (dash.ts:199-215). Whether that ever gives a working
  file is unclear.
- `dashAudio()` ignores the audio container: a WebM video can be paired with an MP4 audio.

**Proven by**
- streams.js section 3 (81-88): DASH with SegmentTemplate + SegmentTimeline (fixtures.py:98-104, made by
  ffmpeg `-use_template 1 -use_timeline 1`), best video joined with audio, 24 s.
- streams.js section 6 (163-172): the picker shows "360p, M4A" for the DASH page.
- stream-expiry.js "dash" (213-234): renamed representations (`$RepresentationID$` in the addresses) are
  matched and continue.
- No test for SegmentList, SegmentBase or `$Time$`-only templates (none found).

**iOS mapping**
Parse with Foundation's `XMLParser` (SAX) or a small DOM. The `MediaPlaylist` trick works the same in
Swift: one `Segment` struct for both formats. Note that AVFoundation itself does not play DASH, so a DASH
download on iOS must be fully done by your own code, and the result must be something AVFoundation can
read: prefer `video/mp4` representations with `avc1`/`hvc1` and `audio/mp4` with `mp4a`/`ec-3`; skip WebM
(VP9, Opus) unless you ship a demuxer (see "Joining the tracks"). TitleLess has no DASH at all.

---

## DASH representation choice and the track URL trick

**What it does**
DASH downloads the best video and the best audio as two tracks (or only the audio for "M4A").

**How it works** (`prepareDash()`, hls.ts:786-821)
- First time: video = the representation the picker named (`dashVideo`), else `dashLadder()[0]`; audio = the
  named one, else `dashAudio()`. Audio-only: the audio is the main track.
- Each track's `url` is the manifest URL plus `#vitre-rep=<id>` (hls.ts:187, 802-803): one string that names
  both where to read and which representation.
- Every later prepare (resume, renewal) re-reads the manifest and finds each track's representation with
  `matchRep()` (table.ts:381-389): **by id first**, then by attributes: same kind, same mime, same codec
  family (`codecsKey()` keeps the part before the first `.`: `avc1.64001e` → `avc1`), same height (video),
  same language (audio), and the nearest bandwidth. None → ChangedError "the stream no longer offers this
  quality" (hls.ts:813).
- `bandwidth = video + audio` for the estimate (hls.ts:801).

**Why**
Some sites rename representation ids between manifest loads. Before Phase 6 that ended the download "The
stream changed" (RESUME-DESIGN.md G2 step 2). Matching by attributes keeps it going; the proof then checks
the bytes are the same.

**Edge cases handled**
- Renamed ids with the same bytes: continue (proven by the last written segment).
- Renamed and re-encoded: File changed (see "Expired addresses inside a run").

**Proven by**
- stream-expiry.js "dash" (213-234), "dashmix"/"dashlive" (513-546); server.py `dash_rename()` 1527-1563.

**iOS mapping**
Same. Keep a representation fingerprint (kind, mime, codec family, height, language, bandwidth).

---

## The track model and the part files

**What it does**
Each track is written into its own temporary file; the files are joined at the end.

**How it works**
- `trackPart(base, t)` = `<base>.video.part` for the main track, `<base>.audio.part` for audio
  (hls.ts:1830-1832). `<base>` is the final path without its extension.
- Spill folder: `<part>.d/<segment index>` (hls.ts:1154, 1196). Merge temp: `<base>.merge.part`
  (hls.ts:1020). Keep-partial temp: `<base>.keep.part` (hls.ts:1088).
- Tracks run **one after the other** (hls.ts:994-997): all video segments, then all audio segments. Within
  a track, many segments run in parallel.
- A track's file is only ever **appended** (Writer offset -1, hls.ts:1272), so stream parts are never sparse
  and never have holes.
- At the start of `runTrack()`, the part file is the truth (hls.ts:1255-1269): nothing written yet, or the
  file is shorter than recorded → truncate to 0 and start the track again (its table lines start again under a
  new header); longer than recorded → cut back to the recorded size.

**Why**
One file per track keeps the join simple (two inputs to ffmpeg) and lets a track be kept as a playable file
without ffmpeg. Appending in order means the part is always a valid prefix of the stream.

**Edge cases handled**
- Leftover bytes after a crash (part longer than the count) are cut off before appending.

**Proven by**
- streams.js:71 ("no part files are left"); stream-expiry.js "cut" (339-359).

**iOS mapping**
`FileHandle(forWritingTo:)`, `seekToEnd()`, `write(contentsOf:)`, `truncate(atOffset:)`. Put part files in
Application Support or Caches (not tmp, which the system may clear). Since the TitleLess vault encrypts
finished files, the parts should also live in a protected location (Data Protection class) until the join.

---

## Parallel segment fetching with in-order writing

**What it does**
Segments download on several connections at once, but the file is written strictly in order, so a slow
segment never blocks the others from downloading and memory stays bounded.

**How it works** (`runTrack()`, hls.ts:1128-1387)

Constants:
- `conns = clamp(settings.connections, 1, 16)` (hls.ts:1161); the setting defaults to 8
  (VitreDownloads.sys.ts:3254, itself clamped to 1-32); the row's view also shows at most 16 for a stream
  (VitreDownloads.sys.ts:4624).
- Look-ahead window `ahead = max(24, conns × 4)` segments past the next one to write (hls.ts:1162): 32 with
  8 connections.
- `SPILL_AFTER = 48 MiB` held in memory (hls.ts:182); `WRITE_BACKLOG = 32 MiB` in the writer's pipe
  (hls.ts:184); `SEGMENT_MAX = 256 MiB` per answer (hls.ts:180).

State: `head` = index of the next segment to write; `next` = next index to start; `ready` = map index →
piece (bytes in memory, or a spill file); `started` (first start time per index); `hedged`; `racers`;
`held` (bytes in memory); `avgMs` (smoothed fetch time); `alive` (workers left); `requeue`.

Each worker (hls.ts:1223-1243), with its own `lane` (its own connection, see "Not worth copying"):

```
while no failure and not stopped and head < count:
    if requeue not empty: take(requeue.shift()); continue
    if next < count and next < head + (proving ? 1 : ahead): take(next++); continue
    if head was started, is not ready, not hedged yet,
       and now - started[head] > max(3000 ms, 2 × avgMs):
        hedged.add(head); take(head, hedge = true); continue
    wait up to 500 ms (woken early by any arrival)
```

`take(i)` (hls.ts:1173-1221):
- fetches, decrypts, unwraps and checks the segment (`fetchPiece()`);
- if the segment is already ready or already written (a race was lost): drop it;
- else abort the other racers for `i`; update `avgMs = avgMs × 0.8 + elapsed × 0.2` (hls.ts:1190);
- if `i != head` and `held + size > 48 MiB`: write it to `<part>.d/<i>` (spill); else keep it in memory;
- wake the writer.

The writer loop (hls.ts:1322-1356):

```
while head < count:
    wait (1 s steps, woken early) until ready[head] or failure or no worker alive
    on failure: throw it; no worker alive and head missing: "Some parts of the video didn't arrive."
    bytes = ready[head] (read back and delete the spill file if spilled)
    (repair only) check its hash against the old table
    container = sniff(bytes) if not known yet
    writer.append(bytes); counters += ; head++ ; nextSeq = seq of head
    mark(); record a table line (hash computed in the background)
    while writer.backlog > 32 MiB: sleep 20 ms        # the disk sets the pace
```

- Any non-recoverable failure in any worker stops the whole run (`failure` + `stop.abort()`,
  hls.ts:1214-1216). The error goes to the engine.
- On the way out the spill folder is removed (hls.ts:1365) and the writer closed (hls.ts:1372).

**Why**
- The file header says: "a slow one never stalls the others" (hls.ts:1123-1124). This design came from the
  owner's Swift HLSDownload.swift through the Electron port (app/src/main/modules/downloads/hls.ts:1-2, 53,
  209); the first Gecko spike left it out and bounded memory with a smaller window instead
  (VitreHls.sys.mjs:4-6, 177: `ahead = max(12, conns × 3)`); RESULT.md:143 lists racing and spill as "not
  ported" then. hls.ts restored them.
- `WRITE_BACKLOG` exists because the Gecko writer pipe is unlimited (partfile.ts: "the transfer applies
  back-pressure itself").
- The window of **1** while a lazy proof runs: "a stream found changed costs one segment, not a window of
  them" (hls.ts:1163-1164, review of Phase 6).

**Edge cases handled**
- Out-of-order arrival; a lost race; spilled segments read back in order; a disk slower than the network;
  all workers retired by the server.

**Proven by**
- RESULT.md:79-80 (spike): "11 of 12 segments fetched after a pause ..., server peak concurrency 6, output
  MP4 24.03 s".
- RESULT.md:248: the real mux.dev stream, 64/64 segments, 634.63 s, 0 decode errors.
- Spill has no direct test (none found).

**iOS mapping**
Swift concurrency: a `TaskGroup` (or N worker tasks) pulling indices from an actor that owns `head`, `next`,
`ready`, `held`. Use `URLSession.data(for:)` / `bytes(for:)` for segments in the foreground. Keep the same
bounds; memory is tighter on iOS (jetsam kills apps that use too much), so 48 MiB in RAM may be too high
for an extension or an older iPad; consider 16-24 MiB (a judgement, not measured). Write with a single
`FileHandle` in order. For background work: a background `URLSession` only runs **download** tasks (not data
tasks); each segment as a download task already lands as a file, which is a natural "spill" — then append in
order when the head's file exists. Background sessions schedule tasks at the system's discretion, so
hundreds of segments may progress slowly while suspended (unverified how slow on iOS 17-26). For a
user-started download that should keep going in the background, iOS 26's `BGContinuedProcessingTask`
(started from a user action, shows system progress) fits this loop better (unverified in practice). TitleLess:
the audit does not describe its segment parallelism, window or spill (unknown).

---

## Racing an overdue segment (hedging)

**What it does**
If the segment the writer is waiting for is much slower than usual, a second request for it starts on an
idle connection. The first answer wins; the other is cancelled.

**How it works**
- Only when a worker has nothing else to do (window full or every segment already started)
  (hls.ts:1234-1240).
- Condition: the head segment was started, is not ready, has not been raced before, and has been running
  longer than `max(3000 ms, 2 × avgMs)` (hls.ts:1236). `avgMs` is an exponential average of successful
  fetch times (weight 0.2 for the newest).
- At most one extra request per segment (`hedged` set).
- The racer's errors are ignored (hls.ts:1208); the winner aborts every other racer (hls.ts:1189); the loser's
  bytes are removed from the in-flight count (hls.ts:1185-1187).
- A racer never "steps aside" on 429/503 (`mayYield` is false for a hedge, hls.ts:1182).

**Why**
On real CDNs one request sometimes lands on a slow edge or a stalled TCP connection; the in-order writer
would wait for it. The 3 s floor stops racing when all segments are fast; `2 × avgMs` adapts to slow links.

**Edge cases handled**
- The original finishes first: the hedge is dropped. The hedge finishes first: the original is aborted.
- A hedge running under a byte-range validator proof (see "Byte-range pieces"): commit 2b9437f (2026-10-21)
  fixed the case where the losing hedge's abort was taken by other connections as their own and the row ended
  Cancelled.

**Proven by**
- streams.js section 4 (90-98) with server.py `/hedge/fx/` (641-650): the first request for `seg005` crawls
  at 8 KB/s; the check requires at least 2 requests for seg005 and the 24 s stream done in under 15 s.

**iOS mapping**
Easy in Swift: start a second `Task` for the same index and cancel the loser (`task.cancel()` cancels its
URLSession request). Use a separate `URLSession` or at least a fresh connection for the racer if you can;
on HTTP/2 both requests otherwise share one TCP connection, which defeats the point when the TCP connection
itself is stalled (unverified how URLSession picks connections). TitleLess: not mentioned in the audit.

---

## Per-segment retries, and connections that step aside

**What it does**
A segment that fails is retried a few times; a connection the server pushes back (429/503) leaves the pool
while others continue; a long server pause stops the row so it can wait without hammering.

**How it works** (`fetchPiece()`, hls.ts:1396-1450; net.ts)
- `ATTEMPTS = 3` (hls.ts:179). Waits between attempts: `backoff()` = 2 s, then 6 s (15 s would be a 3rd
  retry) (net.ts:859-862). A `Retry-After` header wins, capped at `IN_RUN_WAIT = 60` s (net.ts:856).
- Retryable (net.ts:891-902, 95-104): HTTP 403, 408, 425, 429, 500, 502, 503, 504, 507, 509 and every 5xx but
  501 and 505; a short body (`ShortBodyError`: fewer bytes than Content-Length, net.ts:721, or an empty
  body, hls.ts:1540); network errors except TLS/certificate errors and malformed URLs. Not retryable: any
  `DownloadError` (not media, decrypt failure, "won't send in parts"), 404 (but see refresh), TLS.
- An idle answer is cut after 30 s without bytes (`IDLE_TIMEOUT_MS`, net.ts:172, 472-483) → a timeout, which
  is retryable.
- Refused address (401, 403, 404, 410, 451, net.ts:107), "not media", or a refused key: first look the
  segment up in a fresh playlist (see "Expired addresses inside a run"); a new address does **not** use up
  an attempt (`attempt--`, hls.ts:1440); at most 3 refreshes per segment (hls.ts:1428).
- 429 or 503 (`refusedConnection`, net.ts:168-170) → `ConnectionRefusedError` when
  `mayYield(attempt)` = not a hedge **and** another worker is alive **and** (the server never accepted this
  connection yet **or** its 3 attempts are used) (hls.ts:1182, 1427). The worker retires, its segment goes
  to the front of `requeue` (hls.ts:1209-1213).
- `stopsRun(err)`: a 429/5xx whose Retry-After exceeds 60 s stops the run when this is the last connection
  (hls.ts:1446; net.ts:871-879); the row then waits "Retrying" at the server's time.
- `waitTry`: when the run is an automatic try of a waiting row, the first 429/5xx ends it at once
  (hls.ts:239, 1446; commit 7805625, 2026-10-20: "A wait's automatic try ends at its first 429 or 5xx, as the
  playlist fetch does").

| Situation | Result |
|---|---|
| 429/503 on a connection the server never accepted, others alive | worker retires now, segment requeued |
| 429/503 on an accepted connection, after 3 attempts, others alive | worker retires, segment requeued |
| 401/403/404/410/451, page, refused key | playlist refresh (≤3), retry at new address for free |
| other retryable error | wait 2 s, 6 s; 3 attempts |
| Retry-After > 60 s on the last connection | run stops, row "Retrying" |
| not retryable | run stops; engine classifies the error |

**Why**
- Commit 7805625 (2026-10-20, "connections that keep up (compared with IDM 6.43)"): a connection that used
  up its attempts steps aside instead of pausing the whole row while others still receive bytes.
- RESUME-DESIGN.md G4: a server asking for a long wait should not be asked again by the run itself.

**Edge cases handled**
- A server that limits connections per client (429/503 to the extra ones): the pool shrinks to what the
  server accepts.
- All workers retired: "Some parts of the video didn't arrive." (hls.ts:1327).

**Proven by**
- tests/downloads/connections.js covers the file engine's version (commit 7805625); no stream-specific test
  of stepping aside was found.

**iOS mapping**
Same table in Swift. Read `Retry-After` from `HTTPURLResponse.value(forHTTPHeaderField:)`. URLSession's own
`timeoutIntervalForRequest` (default 60 s) is an idle timeout between packets, close to Deer's 30 s idle cut.
For a background session the system waits for the network and retries by itself, but an HTTP status
(403, 429, 5xx) simply completes the task and is yours to handle (unverified in detail). TitleLess: the
audit mentions "retry" for the download manager but not per-segment rules (unknown).

---

## Byte-range pieces and If-Range (EXT-X-BYTERANGE, DASH SegmentBase); "HLS slips counted after the proof"

**What it does**
When segments are slices of one big file, each slice is a Range request. Deer makes sure all slices come
from the same version of that file, without being fooled by CDNs whose validators differ between servers.

**How it works**
- DASH one-file representation (`onePieceList()`, hls.ts:824-848): one request `Range: bytes=0-0` learns the
  total size (from `Content-Range`) and the validators; the file is then cut into `PIECE = 4 MiB` pieces
  (hls.ts:186), each with a duration proportional to its bytes. Unknown size → one segment = the whole file,
  no range.
- `fetchBytes()` (hls.ts:1467-1548) for a range `[a, b)`:
  - sends `Range: bytes=a-(b-1)` and, unless told not to, `If-Range: <validator>` (hls.ts:1476-1477);
  - validator (`ifRangeOf()`, hls.ts:1551-1557): the strong ETag (a weak `W/` ETag is never used,
    hls.ts:1763-1766), else Last-Modified; after `SLIPS = 2` "slips" within `SLIP_WINDOW = 10 min`
    (hls.ts:199-200) → Last-Modified; after a Last-Modified slip → no If-Range at all for that URL
    (hls.ts:1560-1569);
  - the **first** ranged answer's validators become the file's (hls.ts:1485-1490);
  - an answer under **another** validator decides nothing by itself: the answer is dropped, and
    `vouch()` → `proveFile()` (hls.ts:1572-1606) fetches the **last written piece of that file again, without
    If-Range**, and its hash must equal its table line; if not → ChangedError "the video file on the site
    changed". If equal, the new validator is accepted and the piece is asked again;
  - one proof per (URL, validator) is shared by all connections that met it (`verifying` map);
  - a 200 to a range request with more than 64 MiB is refused: "The site wouldn't send this video in parts."
    (hls.ts:1514-1517); a 200 up to 64 MiB is cut to the slice (hls.ts:1535-1537); a 206 must be exactly the
    slice length (hls.ts:1538).
- **"Slips counted after the proof"** (commit e20b1ca, 2026-10-21): a slip is counted only after the bytes
  proved it is the same file (hls.ts:1497-1511). Before, every connection that met a swapped file counted one
  slip **before** the comparison, so within one swap If-Range fell to Last-Modified and then to nothing, and the
  next answer of the new file was written unchecked ("stream-expiry brswap, 1 in 2 under load before").
- **Lost hedge** (commit 2b9437f, 2026-10-21): the shared proof runs under the first connection's signal; if
  that connection lost a hedge race and was aborted, the other connections now ask again with a new proof
  under their own signal (hls.ts:1505-1509) instead of ending the row as Cancelled with its parts deleted.

**Why**
RESUME-DESIGN.md 2.4 R6: headers alone never decide while saved bytes can be compared. Review of Phase 6:
"CDN edges and farms whose backends differ turned working streams into File changed" (hls.ts:1461-1462).

**Edge cases handled**
- Two backends taking turns, each with its own ETag ("flap"); a new ETag on every answer ("edge"); a stable
  one: all complete.
- The file swapped during a pause, or while running: File changed, nothing of the new file written.
- A server that ignores Range (200 with a small file): sliced locally; with a huge file: refused.

**Proven by**
- stream-expiry.js "br" (579-596) for be=flap/edge/stable, "brswap" (597-628) both during a pause and mid-run;
  server.py `vod_br()` 1656-1723.

**iOS mapping**
`URLRequest` with `Range` and `If-Range` headers works the same; check `statusCode == 206` and the body
length. Keep validators per URL in your segment table. TitleLess's RangedDownloadTask already falls back when
there is no 206 (per audit), but the audit does not mention If-Range or proving a validator change by bytes
(unknown). HLS byte-range streams (bipbop-style) in TitleLess's HLS task: unknown.

---

## Init segments (EXT-X-MAP, DASH initialization)

**What it does**
For fMP4 streams, the init segment is written once at the start of the track, before any media segment.

**How it works**
- Fetched **before** the workers start, only when nothing of the track is written (`track.done === 0`)
  (hls.ts:1296-1309). It goes through the same `fetchPiece()` (retries, decryption with the key in force at
  the MAP, byte range).
- It is marked `init: true` so that, if refused, the refresh looks it up again **as the init**, never as
  media segment 0 (hls.ts:208-209, 1674).
- Its hash goes into the table header (`setInit()`, table.ts:151-156); `track.initBytes` remembers its
  size; the container is `webm` if it sniffs as WebM, else `mp4` (hls.ts:1305).
- On resume the init is not written again (it is already at the start of the part). The proof re-fetches it
  and compares its hash (hls.ts:563-571). A table that had an init and a playlist that now has none →
  ChangedError "the start of the video on the site is different now" (hls.ts:552).

**Why**
Review of Phase 6 (hls.ts:1665-1666): "a refused init was answered with media segment 0, written as the
init".

**Edge cases handled**
- Init refused on resume (404): the row becomes "Link expired", the part untouched and still starting with
  `ftyp`.

**Proven by**
- stream-expiry.js "init" (631-648), server.py `vod_init()` 1608-1625.
- streams.js:125-127: the fMP4 stream's track header keeps its init hash.

**iOS mapping**
Same. An fMP4 file made of init + fragments is playable by AVPlayer as a local file and readable by
`AVURLAsset` (fragmented MP4 is supported; unverified for very long files). TitleLess: the audit lists fMP4
remux, so it handles EXT-X-MAP somehow; whether a refused init is re-looked-up as init is unknown.

---

## AES-128 decryption: key fetch and IV rules

**What it does**
Segments encrypted with plain HLS AES-128 are decrypted before writing; the saved file is clear.

**How it works**
- `key(ref)` (hls.ts:1641-1661): one shared promise per key URL, so a key is fetched **once** however many
  segments ask at the same moment. The body must be exactly 16 bytes ("The stream's key couldn't be read."
  otherwise). 3 attempts with the 2 s / 6 s backoff (Retry-After not used for keys). A failed key is removed
  from the cache so a later segment tries again. Imported with WebCrypto as `AES-CBC`.
- IV (hls.ts:1416, 1853-1857): the `IV=` attribute if present; else the segment's **media sequence number**
  as a 128-bit big-endian integer (8 zero bytes, then the 64-bit number):

  ```
  iv = [0,0,0,0,0,0,0,0] + uint64_big_endian(seq)     # seq = MEDIA-SEQUENCE + index
  ```

  For the init segment the code passes `seq: 0` (hls.ts:1298), so an encrypted init needs an `IV=` (the HLS
  spec requires one in that case).
- `decrypt()` (hls.ts:1860-1866): AES-CBC with PKCS#7 padding removal (WebCrypto does both). A failure is
  "A piece of the video couldn't be decrypted." (not retryable) — unless the bytes look like a web page, then
  it is "not the file" (see next mechanism).
- A refused key (401/403/...) uses the playlist refresh too: the segment takes the **fresh key URL even when
  its own URL did not change** (hls.ts:1429-1431, 1438, 1677).

**Why**
- RESUME-DESIGN.md G2 step 1: "A segment takes the fresh key URL even when its own address did not change.
  This fixes the check at hls.ts:536" (the old code only compared the segment URL).
- The sequence-number IV is the HLS rule; it is why sequence numbers must be exact (`seq + index`).

**Edge cases handled**
- Key rotation (each segment keeps its own key reference); many segments asking for one key at once; a key
  whose signed URL expired.

**Proven by**
- streams.js section 1: the 180p rendition is AES-128 (fixtures.py:70-76, key bytes 0..15) and ends as h264 +
  aac, 24 s (streams.js:67-70).
- RESULT.md:81-82: "6170 TS packets all start with the sync byte, key fetched once".

**iOS mapping**
CryptoKit has no AES-CBC; use CommonCrypto `CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionPKCS7Padding,
...)`. Build the IV exactly as above. Cache the key per URL in an actor with a single in-flight `Task`.
TitleLess already decrypts AES-128 (per audit); check the IV-from-sequence rule uses
`MEDIA-SEQUENCE + index` and not the index alone, and that a refused key triggers a playlist refresh.

---

## Is it media? Segment sniffing (a page or JSON is never written)

**What it does**
Before a segment is written, Deer checks its first bytes. A web page, JSON, or an expired-link message is
never written into the video.

**How it works** (`fetchPiece()`, hls.ts:1402-1424)

```
pageType = Content-Type matches text/html | xhtml | json
if pageType and segment not encrypted and textStart(body):  -> NotTheFile
if encrypted:
    try decrypt
    except: if pageType and textStart(body): -> NotTheFile  else -> "couldn't be decrypted"
bytes = unwrapDisguised(bytes)
if (whole segment, or first piece of a file) and textStart(bytes): -> NotTheFile
if pageType and not looksLikeMedia(bytes):                       -> NotTheFile
```

- `textStart()` (net.ts:987-991): after an optional UTF-8 BOM and up to 64 spaces/tabs/newlines, the first
  byte is `<` or `{`.
- `looksLikeMedia()` (hls.ts:1906-1912): TS (0x47 at byte 0 and, if longer than one packet, at byte 188);
  MP4 box types `ftyp styp moof sidx emsg prft mdat free` at offset 4; WebM EBML header `1A 45 DF A3` or a
  Cluster `1F 43 B6 75`; `ID3`; or an MPEG audio frame sync (`FF Ex`).
- `NotTheFileError` is not retryable but is "renewable" (hls.ts:228-230): it triggers the playlist refresh,
  and at the end of a run the row becomes "Link expired" with automatic tries.
- `sniff()` (hls.ts:1890-1896) decides the track's **container** from the first written segment: `ts`, `mp4`,
  `webm`, `aac` (ID3 or ADTS `FF Fx`), else `ts`.

**Why**
- RESUME-DESIGN.md G2 "Segment sniff, new": "Today any 2xx body is written".
- Encrypted segments are judged only after decryption (review of Phase 1, hls.ts:1405-1409): "about 1
  ciphertext in 130 starts with '<' or '{'" (2 values of 256 ≈ 1/128), "and some CDNs label real segments
  text/html". A page fed to AES-CBC usually fails its padding: that means "not the file", not "couldn't be
  decrypted".

**Edge cases handled**
- CDNs that label real segments `text/html` or `image/jpeg` (embed CDNs: tests/downloads/embed.js with
  server.py `/hot/fx/`, segments labelled `image/jpeg`).
- A 200 "Request has expired" page in the middle of a stream.
- Only the first piece of a one-file representation is checked for `<`/`{` (later pieces are arbitrary bytes).

**Proven by**
- stream-expiry.js "html" (237-260), server.py `vod_html()` 1565-1581: segment 5 answers 200 with a page; the
  part holds exactly the whole TS segments before it, byte for byte, never the page; the row is "Link
  expired" with its next attempt planned.

**iOS mapping**
Same checks on `Data` in Swift (a few byte comparisons). Very valuable: a `URLSession` 200 with an HTML body
otherwise goes straight into the remuxer, which then fails much later or produces a broken file. TitleLess
(per audit) does no MIME or content check even on playlists; segment content checks are not mentioned
(likely missing).

---

## Segments disguised as images

**What it does**
Some CDNs hide each segment behind a tiny PNG, JPEG or GIF; Deer removes the image and keeps the media bytes.

**How it works** (`unwrapDisguised()`, hls.ts:1920-1943)
- Only for bodies longer than 80 bytes.
- PNG (`89 50 4E 47`): walk the chunks (`length`, `type`, data, CRC: `12 + length` bytes each) until
  `IEND`; the rest is the candidate.
- JPEG (`FF D8 FF`): the bytes after the first `FF D9` (end of image).
- GIF (`GIF8`): the bytes after the **last** `0x3B` (trailer).
- The candidate is used only if it looks like a segment (`looksLikeSegment()`: at least 8 bytes, TS sync byte
  or an `ftyp`/`styp`/`moof` box; hls.ts:1898-1900). Otherwise the original bytes are kept.
- Runs after decryption (hls.ts:1422).

**Why**
Comment: "Some CDNs hide segments behind a tiny PNG, JPEG or GIF; the real bytes follow the image."
(hls.ts:1919). Came from the Electron port (VitreHls.sys.mjs:5-6 lists it as not yet ported in the spike).

**Edge cases handled**
- A real image (no media after it) stays as it is (and then fails the media checks).

**Proven by**
No test found.

**iOS mapping**
Port the 20 lines as is. Low cost; only some pirate-style CDNs use it.

---

## Expired addresses inside a run: refreshing the media playlist (G2 step 1)

**What it does**
When a segment URL with a signed token expires mid-download, Deer re-reads the playlist, finds the same
segment there with its new token, and continues. No retry is used up and no segment is fetched twice.

**How it works**
- Trigger (in `fetchPiece()`, hls.ts:1428-1443): a renewable error (401, 403, 404, 410, 451, not media, or a
  refused key) and fewer than 3 refreshes for this segment.
- `refreshed(track, stale)` (hls.ts:1670-1692):
  - look in the playlist we have: matched **by media sequence**, never by position; the init by its init
    flag;
  - if the address or key address is already different there (another connection refreshed), use it;
  - else re-read the playlist, **single-flight per track** (all connections that hit the expired address wait
    for the same read) and **at most once every 5 s** per track (hls.ts:1681);
  - look up again.
- `reread()` (hls.ts:1706-1733) takes the new playlist **only if it is the same stream**:
  - `sameShape()`: same segment count, same first sequence, same durations hash, init or not (hls.ts:1779-1781);
  - DASH: the representation by its id; a renamed one (matched by attributes) only for a track that already
    wrote segments (hls.ts:1719);
  - if the track wrote segments and any address changed: `proveAgain()` fetches the **last written segment at
    its new address** and its hash must equal its table line, else ChangedError (hls.ts:1740-1750).
  - Not taken → the old playlist stays and the segment's own error decides.
- A ChangedError from this stops the run (hls.ts:1434-1436).

**Why**
- server.py describes the CDN behaviour tested: "the first seg003 request expires the token (403 and a new
  one), as CDNs do: only a fresh copy of the playlist has working addresses" (server.py:651-652).
- The proof at the new address came from the Phase 6 review: "a renamed representation re-encoded mixed two
  encodes" (hls.ts:41-42, 1697).
- Matching by sequence: before Phase 6, "hls.ts ... counted segments, so a renumbered or re-cut playlist mixed
  bytes" (table.ts:17-18).
- The Electron version only refreshed on 401/403 (app/src/main/modules/downloads/hls.ts:357); RESUME-DESIGN.md
  G2: "Today only 401 and 403 are handled".

**Edge cases handled**
- Many connections hitting the expiry at once (one re-read).
- A re-read that returns a re-encoded stream (same count, other bytes): File changed, never mixed.
- A key URL that expires while segment URLs stay.

**Proven by**
- streams.js section 5 (100-109), server.py `/token/fx/` (651-670): one 403 for seg003, ≥2 playlist reads,
  complete 24 s.
- stream-expiry.js "dashlive" (renamed mid-run, same bytes: continues; only the proof's chunk 8 and the
  never-written chunks fetched at the new address) and "dashmix" (renamed and re-encoded: File changed, part
  holds only the old encode's 8 chunks) (513-546).

**iOS mapping**
Same logic in an actor: `refreshing: [TrackID: Task<MediaPlaylist, Error>]` plus a last-refresh time.
TitleLess: the audit does not mention re-reading the playlist when a segment expires (likely missing); if it
matches segments by index, a renumbered playlist would mix bytes.

---

## Renewal steps when a playlist or master expires (G2 steps 2-4)

**What it does**
When the playlists themselves stop working (on resume, or after a run stopped as "Link expired"), Deer
tries, cheapest first, to find working addresses for the **same** quality, then proves the bytes before
continuing.

**How it works** (`prepare()` hls.ts:369-398, `read()` 413-421, `renewSteps()` 859-928)
- `prepare()` reads the playlists; on a renewable error it runs the renewal steps; then `settle()` proves each
  track; if the proof's own fetch is refused, the steps run once more and the proof runs again (`round` 0/1).
- `text()` (hls.ts:1620-1638): a playlist is asked up to 3 times; a **refused** playlist is asked only twice
  when something is already written (`mayRenew()`), so the renewal starts sooner; a stream with nothing written
  keeps its three tries (review of Phase 6).
- Steps (renewSteps):
  1. (inside a run only: the refresh above)
  2. `fromSource(sourceUrl)` (hls.ts:951-974): read the master fresh, re-pick the rung by fingerprint
     (`pickAgain()` → `repick()`, table.ts:313-336: audio-only by nearest bandwidth; video by height + codec
     family, then nearest bandwidth within **±10%** (`BANDWIDTH_SLACK`, table.ts:56); no fingerprint → the
     variant at the old URL's path); read its media playlists; `retrack()` gives the tracks the new URLs. If
     the source is itself a media playlist, a fresh read that works is the renewal. DASH: re-read the manifest
     and `matchRep()`.
  3. yt-dlp's manifest URL for the same rung, if yt-dlp is installed and the format is the same
     (hls.ts:884-894; never for private downloads, VitreDownloads.sys.ts:1897-1906).
  4. (outside a run only, Phase 7) the download's page opened in a hidden tab: each stream it loads is read
     **and proven** in turn; the first that proves the same wins; others give the addresses back
     (`keepAddresses()`, hls.ts:935-943) (hls.ts:895-927).
- A step "helps" only if the addresses changed (or the playlists read now when they had failed)
  (hls.ts:869-879). A master that no longer offers the rung → ChangedError "this quality is no longer offered".
- A first start (`!resolved`) never runs these steps: there is nothing to renew, and yt-dlp is not asked for
  nothing (hls.ts:861-863).
- After the steps, the engine schedules automatic attempts at 2 min, 15 min, 1 h, 6 h (RESUME-DESIGN.md
  decision 8; commit 6c03bb8).
- Manual path: the page opened again shows "Continue · N%" on the pill (stable key: page origin + path,
  rounded duration, title; streamkey.ts:8-19); pressing it calls `renewWith()`; the new addresses replace the
  row's only once the proof says "same" (`prior`/`putBack()`, hls.ts:391, 401-410).

**Why**
RESUME-DESIGN.md G2 (approved 2026-10-13): "Deer gets new addresses by itself, cheapest first: the original
link, the stream's master playlist, yt-dlp, and finally the source page opened out of sight." Before Phase 6
"the master is never read again once resolved" (G2 step 2).

**Edge cases handled**
- Variant token expired, master stable: master re-read once, continue at the next sequence.
- The page now offers only 180p: "360p is no longer offered"; picking 180p → File changed with that quality
  kept for Start over.
- A proof of one playlist never stands for another (the "mix" case: a fresh token gives re-encoded
  segments → proven again → File changed).
- Another Firefox container's page never continues this container's row.

**Proven by**
- stream-expiry.js "sign" (139-172): exactly 1 master read, segments 0-4 never re-fetched, segment 5 once (the
  proof), 6-11 once; history "New link found".
- "continue" (391-411), "gone" (412-438), "mix" (549-575), "audio" (651-674), "container" (725-745),
  "first" (748-772).

**iOS mapping**
Steps 1-2 port directly. Step 3 (yt-dlp) is impossible on iOS. Step 4 could be done with a hidden
`WKWebView` that loads the page and watches the injected media reporter for a new `.m3u8` (TitleLess already
has the reporter); keep it on-device and rate-limited (unverified whether a non-visible WKWebView plays/loads
media on iOS). TitleLess lacks all of this per its audit.

---

## The segment table (journal of written segments)

**What it does**
Remembers exactly what was written: for each segment, where it came from, where it sits in the part, and a
hash of its bytes. This is what makes safe resume, repair and proofs possible.

**How it works** (table.ts:1-219)
- File: `<profile>/vitre-downloads/<id>.stream.jsonl` (VitreDownloads.sys.ts:1920-1925); private downloads
  keep it in memory only.
- Lines:
  - header per track: `{deer:1, stream:1, k, seq0, count, durHash, init, keys, rung, t}` (a `keep:1` header
    follows a renewal without dropping lines: `retarget()`);
  - segment: `{k, i, seq, off, len, h, d}` — track, index among written segments, media sequence, offset in the
    part, length, hash, EXTINF duration;
  - `{k, init}` the init hash; `{k, cut}` drops lines from index `cut` on.
- Hash: SHA-256 of the bytes **as written** (decrypted, unwrapped), first 128 bits in hex (table.ts:59-62).
  The bytes are already in JS memory, so hashing costs no extra disk read (table.ts:9-10). Computed in the
  background after the write (hls.ts:1283-1293).
- Lines reach the journal every 2 s (engine tick, VitreDownloads.sys.ts:4533-4540), flushed to disk when the
  track stops (hls.ts:1381-1384). A torn last line is ignored when read. Compacted when it grows past twice
  what it needs (table.ts:199-209).

**Why**
RESUME-DESIGN.md 4.1 "Streams" and 5.7. Hashing per segment (not per block) because segments are the unit a
stream can re-fetch.

**Edge cases handled**
- Lines lag the count (a crash between the count's save and the next tick): see "Resume".
- Journal growth on long streams: compaction.

**Proven by**
- streams.js section 7 (111-128): 12 lines, each `{i, seq, off, len, h, d}` equal to the fixture segments'
  sizes, offsets and hashes; the fMP4 headers carry the init hash.
- stream-expiry.js "sign" (145-153).

**iOS mapping**
A JSON-lines file in Application Support, appended with `FileHandle`, hashes with CryptoKit
`SHA256.hash(data:)` (prefix 16 bytes). Or SQLite / SwiftData if TitleLess already has one. TitleLess: no
equivalent in the audit.

---

## Resume of a half-done stream: the proof and where to continue

**What it does**
On resume (after pause, quit, crash, or with new addresses), Deer checks that the stream online is the same
one it was saving, finds the exact next segment, and continues. Nothing written before is fetched again,
except one segment for the proof.

**How it works** (`settle()` hls.ts:434-473, `proveTrack()` 522-590, `fromLastLine()` 602-611, `mapNext()`
table.ts:237-255)

For each track with segments written:
1. Duration of the playlist read now within `DURATION_SLACK = 1 s` of the saved length (table.ts:54),
   else ChangedError "it is now M:SS long instead of M:SS".
2. No table lines (an old record from before Phase 6): same segment count, else ChangedError; a missing part
   → start that track again.
3. `fromLastLine()`: the place to continue comes from the **table's last line below the saved count**. If
   the count claims segments beyond the last line (lines lag the count), cut back to the last line; those
   segments are fetched again (hls.ts:592-611).
4. Check the saved part (next mechanism).
5. `mapNext()`:

   ```
   if nextSeq known and playlist's first seq == seq0 (same numbering base):
       k = index of segment with seq == nextSeq (or count if nextSeq is one past the end)
       accept k if cumulative EXTINF before k ≈ secs written (± max(0.05 s, 0.1%))
                 and the duration before k ≈ lastDur (± 0.05 s)
   else (renumbered, or no sequence saved):
       walk k = 1.. : accept the first k where cumulative EXTINF ≈ secs (± 0.05 s)
                      and the duration before k ≈ lastDur
   none -> ChangedError "its parts no longer line up with what is saved"
   ```

   (`TIME_SLACK = 0.05 s`, table.ts:52.) Never by position.
6. An init in the table but none in the playlist → ChangedError.
7. Network proof (skipped if the same proof passed in the last `PROVEN_FOR = 60 s`, hls.ts:189, keyed by
   track, count written, and a hash of every address in the playlist, hls.ts:489-492):
   - the init, fetched as init, hashes to the table's init hash;
   - the **last written segment**, fetched again at its mapped place, decrypted and unwrapped, hashes to its
     line (skipped when damaged segments were just re-fetched and verified, which already proves it).
8. If the playlist's numbering base changed, the table header is retargeted (hls.ts:585-588).

**Lazy proof** (hls.ts:253-259, 578-582, 1313-1321): when no address changed (an ordinary resume), the
network part of the proof runs **beside** the download. Meanwhile the workers fetch only the next segment
(window 1), and **nothing is written** until the proof passes; if it fails, the run stops. Set by the engine
for runs (`lazyProof = rec.need?.kind !== 'choice'`, VitreDownloads.sys.ts:1820). A renewal or a File-changed
row's Resume proves first.

**Skip prepare when all is written** (VitreDownloads.sys.ts:1830-1838; `allWritten()`, hls.ts:1835-1837):
an expired playlist never blocks bytes already on disk; the merge runs without any request.

**Why**
- RESUME-DESIGN.md 2.6 and G2: "On SAME, the track URLs are replaced and the download continues at nextSeq,
  by sequence and never by position. This replaces the silent reset at hls.ts:158 and the positional counter".
  The spike reset the track to zero when the segment count changed (VitreHls.sys.mjs:90-91).
- The lazy proof: review of Phase 6, "an ordinary resume waited for it" (hls.ts:517).
- `fromLastLine()`: review of Phase 6: a crash could save `nextSeq` one segment ahead of the count; "the time
  mapping then found no place in a playlist whose segments differ in length: File changed for ever"
  (hls.ts:593-596).
- `PROVEN_FOR` keyed by addresses: "a proof of one playlist let a re-encoded one through" (hls.ts:140-141).

**Edge cases handled**
- Renewed playlists with new tokens (same numbering) and renumbered playlists (mapped by time).
- Scene-cut segments of different lengths (the time mapping needs the neighbour check).
- A crash that saved the place one segment ahead; table lines that never reached the journal.
- Key URLs that change between reads (allowed).

**Proven by**
- stream-expiry.js "sign" (only segment 5 re-fetched for the proof), "reenc" (175-210: re-encoded with the
  same count → File changed, part untouched, only seg006 and seg007 fetched), "crash" (677-701, segments
  6.006/4.004/... s), "lag" (704-722), "merge" (310-336: all written + expired → joins with 0 requests).
- RESULT.md:80 (spike): "11 of 12 segments fetched after a pause (1 already on disk)".

**iOS mapping**
All of it is plain logic plus `URLSession` fetches and CryptoKit hashing. Map by `(seq0, nextSeq)` first, by
cumulative duration second. Persist `nextSeq`, `seq0`, `lastDur`, `secs`, counts, and the table. This is the
biggest quality gap: TitleLess's audit lists pause/resume for the manager but nothing about proving the
stream or mapping by sequence (likely resume by index or restart).

---

## Checking the saved part: cut short, damaged, changed by another program

**What it does**
Before continuing, Deer checks the part file against the table. A part that lost its end continues from its
last good segment; a damaged segment in the middle is fetched again and written back in place.

**How it works** (`inspect()` hls.ts:621-669, damaged re-fetch 553-559)
- Part missing → "Started over: the saved part was moved or deleted"; the track starts again.
- Part shorter than recorded: among the last `CUT_TRIES = 4` lines that fit in the file (hls.ts:194), find
  the newest whose bytes still hash right; cut the file there (`setSize`) and continue after it; history line
  "The saved part was cut short: it continues after M:SS". None fits (or it falls inside the init) → start
  again.
- Which segments to re-hash:
  - **all** when the session ended uncleanly (`deep`, set from `rec.suspect`) or when the part's modified time
    is more than `MTIME_SLACK = 5 s` (ledger.ts:71) after the writer last closed (`sealedAt`): "another
    program changed it";
  - otherwise the last `SPOT_LAST = 2` lines plus `SPOT_SEEDED = 2` lines chosen by an FNV-1a hash of the
    download id and track (hls.ts:191-192, 656-665).
- Each bad line: fetch that segment at its mapped place, check length and hash **before** writing, write it
  back at its offset (`writeAt`); history "Checked the saved video · 1 damaged part fetched again". A
  mismatch → ChangedError.

**Why**
RESUME-DESIGN.md 4.2-4.3: "In a partial track, the file is cut at the end of the last good segment, instead
of starting the track again from zero"; "A damaged middle segment is fetched again, checked against its table
hash, and written back at the same offset and length."

**Edge cases handled**
- A disk that lost its last writes; bytes flipped by another program; an unclean shutdown.

**Proven by**
- stream-expiry.js "damage" (263-307): only segment 3 fetched again (plus never-written ones); before the
  merge the part equals the fixture byte for byte.
- "cut" (339-359): the part loses a segment and a half; continues after 0:12 with only the proof segment
  re-fetched.

**iOS mapping**
`FileManager.attributesOfItem` for size and modification date; `FileHandle` read at offset + CryptoKit.
App kills on iOS are frequent (memory, updates), so the "unclean session → check all" rule is cheap insurance.
TitleLess: nothing similar in the audit.

---

## Durable progress: marks and snapshot()

**What it does**
The saved counters never claim more than what is surely on disk.

**How it works**
- After each written segment, a **mark** `{done, bytes, secs, initBytes, container, at: writer.written,
  nextSeq, lastDur}` is pushed (hls.ts:1273-1281); marks older than the writer's `durable` position are
  dropped.
- `snapshot()` (hls.ts:337-348), used for every save, gives each running track the counters of the newest
  mark whose `at <= writer.durable`.
- On a disk error at close, the track's counters roll back to the last durable mark (hls.ts:1370-1378).
- `nextSeq` and `lastDur` travel with the counts (review of Phase 6, hls.ts:203-206).

**Why**
The Gecko writer is asynchronous (a pipe to a background copier, partfile.ts:168-286); counters increased at
hand-off time would be ahead of the file after a crash.

**Edge cases handled**
- Crash with bytes still in the pipe; disk full mid-write.

**Proven by**
- stream-expiry.js "crash" simulates exactly such a saved state (691).

**iOS mapping**
`FileHandle.write(contentsOf:)` is synchronous; call `synchronize()` (fsync) before saving counters if you
want the same guarantee, or save counters only after a successful write. The idea (persist only what is
durable, with the place to continue) is what matters.

---

## A changed stream: silent restart or "File changed"

**What it does**
If the stream online is not the one being saved, Deer either restarts quietly (little saved) or stops and
asks: "Start over with the new file" or "Keep partial file".

**How it works**
- `settle()` catches ChangedError from a track's proof (hls.ts:449-460) and asks `silentRestart()`
  (ranged.ts:363-368): allowed only when **at most `ASK_ABOVE = 1 MiB`** is saved in total (proof.ts:29),
  at most **2 times in 10 minutes**, and not for a row that already asks or a renewal from the pill. Then the
  track's counters reset and it starts from its first segment.
- Otherwise the row becomes paused with `need: choice` and the evidence text ("it now has 6 parts instead of
  12", "it is now 0:12 long instead of 0:24", "this quality is no longer offered").
- Resume on a File-changed row proves again (the site may have gone back), never restarts by itself
  (RESUME-DESIGN.md G3).

**Why**
Owner decision 1 (RESUME-DESIGN.md section 9, approved 2026-10-13): "ask whenever more than 1 MiB of verified
bytes exists. Below that, restart silently, at most twice in 10 minutes."

**Edge cases handled**
- A restart loop on a site that changes on every load (limit 2 per 10 min).

**Proven by**
- stream-expiry.js "reenc" (175-210), "gone" (412-438).

**iOS mapping**
Pure policy; port as is. TitleLess: no equivalent mentioned.

---

## Joining the tracks with ffmpeg (MP4 or WebM, faststart), and life without ffmpeg

**What it does**
Turns the track parts into one file. TS becomes MP4; separate video and audio become one MP4 (or WebM). No
re-encoding.

**How it works** (`finish()`, hls.ts:1011-1056)
- `webm` = the main container is WebM and the audio (if any) is WebM too (hls.ts:1015).
- A join is needed when there is a separate audio track, or the main track is TS or AAC (hls.ts:1016). An
  fMP4 or WebM single track is just moved into place.
- Output extension: `.webm`/`.weba` for WebM, else `.mp4`/`.m4a` (audio-only).
- The exact command (hls.ts:1021-1026; `runFfmpeg()` adds the first four arguments, ffmpeg.ts:85):

  ```
  ffmpeg -nostdin -progress pipe:2 -nostats -y -hide_banner -loglevel error
         -i <base>.video.part
         [ -i <base>.audio.part -map 0:v:0? -map 1:a:0? ]      # with a separate audio track
         [ -map 0:v? -map 0:a? ]                               # without one
         -c copy
         [ -movflags +faststart ]                              # MP4 only
         -f mp4|webm <base>.merge.part
  ```

  `?` makes a map optional (no error if that stream type is missing). With separate audio, only the **first**
  video stream of the main file and the **first** audio stream of the audio file are kept (any audio muxed in
  the video track is dropped). `+faststart` rewrites the MP4 so its index is at the front.
- Progress: ffmpeg's `out_time_us=` lines on stderr (ffmpeg.ts:111-113); the last value is the output's
  length.
- On success: move `.merge.part` to the output, delete the parts, run the length check, keep ffmpeg's
  error text in the history ("Joined · ffmpeg reported: ...", VitreDownloads.sys.ts:1890).
- On failure: delete the temp, then move the parts as they are, with the note "Couldn't join the video and its
  sound: saved as two files." or "Couldn't repackage the video: saved as it came." (hls.ts:1041-1048).
- **Without ffmpeg** (hls.ts:1049-1055): the note "ffmpeg not found: the video and its sound are saved as two
  files." or "ffmpeg not found: saved as it came (TS)."; the main part becomes `<name>.<ext>` (`.ts`, `.mp4`,
  `.webm`, `.aac`, `.m4a`, `.weba`, hls.ts:1846-1851) and the audio `<name> (audio).<ext>`.
- ffmpeg is found in, in order: the Settings path, beside the program (`<install dir>\ffmpeg\ffmpeg.exe` or
  `<install dir>\ffmpeg.exe`), the copy Deer installed on request (`%LOCALAPPDATA%\Deer\ffmpeg\ffmpeg.exe`), the
  copy from before the rename (`%LOCALAPPDATA%\Vitre\ffmpeg\ffmpeg.exe`), then PATH (ffmpeg.ts:6-14). Not bundled; downloaded only when the person asks.

**Why**
- design/DESIGN-NOTES.md "HLS / DASH": "Remux with ffmpeg (-c copy): not bundled; Deer downloads an LGPL
  build only when the user asks."
- "Keep what downloaded rather than throw it away over the container." (hls.ts:1045).

**Edge cases handled**
- No ffmpeg; ffmpeg crash or error; WebM + WebM → WebM; TS with muxed audio; AAC-only streams.

**Proven by**
- streams.js sections 1-3 (ffprobe checks codecs and 24 s duration); noffmpeg.js:18-41 (two files with
  "(audio).m4a", TS stays `.ts`, notes); RESULT.md:78 (ffmpeg via Subprocess, abort kills it in 0.8 s).

**iOS mapping**
No ffmpeg process on iOS. Equivalents:
- TS → MP4: TitleLess's `TSRemuxer` with `AVAssetWriter` passthrough (`outputSettings: nil`) is the right
  tool.
- fMP4 video + fMP4/AAC audio → one MP4: `AVMutableComposition` (insert the time range of each source track)
  + `AVAssetExportSession(asset:presetName: AVAssetExportPresetPassthrough)`, `outputFileType = .mp4`; or
  read both with `AVAssetReader` (no output settings) and write with one `AVAssetWriter`.
- `-movflags +faststart` ↔ `shouldOptimizeForNetworkUse = true` on `AVAssetExportSession` or
  `AVAssetWriter`.
- WebM / VP9 / Opus: AVFoundation does not read the WebM container (unverified for iOS 26). Options: skip
  WebM representations (prefer MP4/AVC/HEVC/AAC), or ship an LGPL ffmpeg library (e.g. a dynamically linked
  build) — App Store and licence implications to check (unverified).
- Keep Deer's fallback: if the join fails, keep the tracks as files and say so, rather than delete them.

---

## The merge crash window

**What it does**
If Deer quits or crashes during the join, the next start finishes the job without downloading again and
without creating a "(1)" copy.

**How it works**
- Before ffmpeg runs, the engine saves (flushed) `phase: 'merging'`, `mergeOut` (the output path) and
  `mergeBase` (hls.ts:125-132; `before(out)`, VitreDownloads.sys.ts:1875-1884).
- On load, `mergeLeft()` (VitreDownloads.sys.ts:925-947): output exists and no `.merge.part` is being written
  → the merge finished, complete the row from it; parts exist → merge again when it continues; neither → fail
  with "Deer closed while joining this video, and its parts are gone."
- If ffmpeg fails, `before(null)` ends the phase **before** the parts are moved, so a part moved to that path
  is never mistaken for a finished merge (hls.ts:1007-1008).

**Why**
RESUME-DESIGN.md G4 "The merge crash window"; commit ccd71a9 (2026-10-14): "Stream merges survive a crash
at any point without a second download or a ' (1)' copy."

**Edge cases handled**
- Crash after ffmpeg wrote the temp but before the move; crash after the move but before the save.

**Proven by**
- Commit ccd71a9 mentions restart tests; stream-expiry.js "merge" (310-336) covers "all written, not yet
  merged".

**iOS mapping**
Same pattern around `AVAssetExportSession`: save "exporting to X" before starting; on launch, check X and the
parts. iOS can kill a backgrounded export at any time, so this matters more on iOS. iOS 26's
`BGContinuedProcessingTask` is designed for such user-started long exports (unverified details).

---

## Length check after the merge

**What it does**
If the joined file is much shorter or longer than the playlist says, the row says so.

**How it works** (`lengthCheck()`, hls.ts:1059-1064)
- `want` = the longest track's playlist length; `secs` = ffmpeg's last progress time.
- OK when `|secs - want| <= max(LENGTH_SLACK = 2 s, LENGTH_SHARE = 2% × want)` (hls.ts:196-197).
- Otherwise the note "The saved video is M:SS long; the stream is M:SS." (and a console warning).

**Why**
RESUME-DESIGN.md 4.2 "Media check": "Stream output duration must match the playlist within ±2% or 2 s
(REF HLSDownload.swift:1507-1590)". The reference is the owner's Swift downloader.

**Edge cases handled**
- Playlists whose EXTINF values lie (the test doubles every duration).

**Proven by**
- stream-expiry.js "length" (362-371): EXTINF 4 s on 2 s segments → note "0:24 long; the stream is 0:48".

**iOS mapping**
`try await AVURLAsset(url:).load(.duration)` after the export, compare with the playlist sum. Cheap and
catches discontinuity or missing-segment problems.

---

## Keep partial file (duration trimming with -t)

**What it does**
When a stream changed on the site, the person can keep what was already downloaded as a playable file,
"<name> (partial).mp4", cut to the shorter of the two tracks.

**How it works** (`keepPartial()`, hls.ts:1074-1119)
- Only tracks with written segments; each part is first cut to its recorded size.
- `secs = min(tracks' secs)`; command (hls.ts:1089-1095):

  ```
  ffmpeg -nostdin -progress pipe:2 -nostats -y -hide_banner -loglevel error
         -i <base>.video.part [-i <base>.audio.part]
         [-map 0:v:0? -map 1:a:0?] | [-map 0:v? -map 0:a?]
         -t <secs with 3 decimals> -c copy [-movflags +faststart] -f mp4|webm <base>.keep.part
  ```

  then moved to `<stem>.mp4` (or `.m4a`, `.webm`, `.weba`).
- Without ffmpeg or on failure: the main part becomes `<stem>.<ext>` and the sound `<stem> (audio).<ext>`
  (with " (2)", " (3)" if taken) — never deleted (review of Phase 6).
- `keptSecs()` (hls.ts:1840-1844) feeds the UI text "Keeps 0:14 of 0:24".

**Why**
Owner decision 3 (RESUME-DESIGN.md section 9): "Streams save the written segments, merged."

**Edge cases handled**
- Video longer than audio (or the reverse): cut to the shorter.
- The audio track not started yet: video only.

**Proven by**
- stream-expiry.js "reenc" (195-209): "Keeps 0:14 of 0:24", the file "reenc (partial).mp4" is 14 s, note
  "Kept 0:14 of 0:24".

**iOS mapping**
`AVAssetExportSession.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: secs,
preferredTimescale: 600))`, or insert only that time range into the `AVMutableComposition`. TitleLess: no
equivalent in the audit.

---

## Repair of a finished stream

**What it does**
"Check file" can find a damaged finished video; "Repair" downloads the stream again, checks every segment
against the old table, joins it, and replaces the file — but only if the site still has the exact same
stream.

**How it works**
- A merged file cannot be mapped back to segments, so repair runs the whole stream again (RESUME-DESIGN.md
  4.3).
- `expect` = the finished stream's table (hls.ts:246). `sameAsFinished()` (hls.ts:481-486): the same number of
  segments per track, the length within 1 s, an init or not as before. Each init and segment must hash to the
  old line before it is written (hls.ts:1301, 1334-1338).

**Why**
Review of Phase 6: "a shorter playlist 'repaired' a 24 s video into 12 s" (hls.ts:432).

**Edge cases handled**
- The site's playlist now lists fewer segments: Repair refuses and fetches nothing.

**Proven by**
- streams.js section 8 (130-161): a flipped byte → Damaged → Repair → SHA-256 equals the original, no parts
  left.
- stream-expiry.js "trunc" (486-506).

**iOS mapping**
Possible but low priority on iOS; TitleLess's vault already authenticates blobs with AES-GCM, so silent disk
damage shows up as a decryption failure. Keeping the segment table after completion would allow the same
"redownload and verify" repair.

---

## Size estimate and progress

**What it does**
Shows a size and a progress bar before the stream is complete.

**How it works**
- `streamEstimate()` (hls.ts:1816-1828): before any segment, the picker's estimate (`expected`); after, for
  each track `initBytes + (bytes written - initBytes + early bytes) / (secs written + early secs) × length`;
  fallbacks: main track `bandwidth / 8 × duration`, audio track 16 000 bytes/s (128 kbit/s) × length.
- `received` = bytes written + bytes in flight (hls.ts:322-324); `estimate` is never below `received`.
- `streamFills()` (hls.ts:1805-1810): 8 bars, filled left to right by segments done.

**Why**
Bytes per media second measured so far is far more accurate than the playlist's BANDWIDTH (a peak value).

**Edge cases handled**
- Out-of-order segments count in the rate (`early`).

**Proven by**
- stream-expiry.js "continue" (402) checks the percentage on the pill.

**iOS mapping**
Same formula; feed `Progress` / a `ProgressView`.

---

## Lessons worth copying

Ranked by value for TitleLess.

1. **Never trust a 200: sniff every segment and every playlist before writing.** `#EXTM3U` / `<MPD` for
   playlists; TS sync bytes, MP4 boxes, WebM, ADTS/ID3 for segments; judge encrypted segments only after
   decryption; a page or JSON is "address expired", not data (hls.ts:1402-1424, playlist.ts:66-68).
2. **Match segments by media sequence, never by index**, everywhere: refresh, resume, IV. Fall back to
   cumulative EXTINF (±0.05 s) plus the neighbour duration when the numbering base changed (table.ts:237-255).
3. **Refresh an expired segment address from a fresh copy of the same media playlist**, single-flight per
   track, at most every 5 s, without using up a retry; take a new key URL too (hls.ts:1428-1443, 1670-1692).
4. **Keep a per-segment hash table and prove before you continue**: on resume or with new addresses, re-fetch
   the last written segment and compare its hash; a re-encoded stream with the same count is caught
   (hls.ts:522-590). Run the proof beside the download but write nothing (and fetch only 1 segment) until it
   passes (hls.ts:1163-1166, 1313-1321).
5. **Parallel fetch, strictly in-order write, bounded memory**: a window of `max(24, 4 × connections)`,
   48 MiB in RAM then spill to disk, 32 MiB write backlog (hls.ts:1161-1162, 1191-1202, 1355).
6. **Race the overdue head segment** after `max(3 s, 2 × average)`, once per segment (hls.ts:1236).
7. **Fingerprint the chosen quality** (height + codec family + bandwidth within ±10%; audio by group,
   language and name) so a re-read master gives back the same rung, and refuse silently switching the sound
   language (table.ts:313-375).
8. **Persist only what is durable, with the place to continue** (marks; `nextSeq`, `lastDur` travel with the
   counts) and check a short or modified part against the table: cut back to the last good segment, re-fetch
   only damaged segments (hls.ts:337-348, 621-669).
9. **If-Range on byte-range pieces, but let bytes decide**: a new validator is accepted only after the last
   written piece re-hashes the same; count a "slip" only after that proof; degrade ETag → Last-Modified → none
   (hls.ts:1467-1606; commits e20b1ca, 2b9437f).
10. **Never lose bytes over the container**: if the join fails or is impossible, keep the tracks as separate
    playable files with a clear note (hls.ts:1041-1055); offer "Keep partial file" cut to the shorter track
    (hls.ts:1074-1119).
11. **Check the output length** against the playlist (±2% or 2 s) and tell the user (hls.ts:1059-1064).
12. **Crash-safe join**: save "merging to X" before starting; on launch, a finished X or the parts decide
    (VitreDownloads.sys.ts:925-947).
13. **Refuse DRM and live early with clear sentences** (SAMPLE-AES, vendor KEYFORMATs, SESSION-KEY,
    ContentProtection, no ENDLIST and not VOD) (playlist.ts:104-110, dash.ts:173-174).
14. **One segment model for HLS and DASH**: turn DASH representations into the same segment list so every
    feature (retries, refresh, proof) is written once (dash.ts header).
15. **Small retry table per segment**: 3 attempts, 2 s / 6 s, Retry-After capped at 60 s, longer → stop and
    wait; a 429/503 connection steps aside while others continue (hls.ts:1182, 1427-1447; net.ts:859-879).

## Not worth copying / Windows-only

- **ffmpeg as a subprocess** (ffmpeg.ts, `Subprocess.call`, the search in `%LOCALAPPDATA%`, PATH): iOS apps
  cannot spawn processes. Use AVFoundation (AVAssetWriter / AVMutableComposition + passthrough export) as
  described above. The ffmpeg command lines are still a precise spec of *what* to produce.
- **Network "lanes"** (net.ts:7-18): Gecko network partitions (`vitre-lane-<n>.invalid`) to force separate
  TCP connections past Firefox's 6-per-host cap and HTTP/2 sharing. On iOS the closest idea is separate
  `URLSession` instances per connection (unverified that they never share a connection). The spike instead
  let segments share HTTP/2 "like a player would" (VitreHls.sys.mjs:245-246); which is faster on real CDNs
  for small segments is not measured in Deer.
- **partfile.Writer** (Gecko pipe + `NetUtil.asyncCopy`), `GetCompressedFileSizeW`, sparse files, the
  Windows Mark of the Web: platform plumbing. Stream parts are append-only anyway.
- **DOMParser in the system scope** (dash.ts:39-48): use `XMLParser`.
- **yt-dlp manifest step** (hls.ts:884-894): yt-dlp is a Python program; not possible on iOS.
- **Firefox containers** (the "container" test, `userContextId`): Firefox-specific; on iOS the equivalent is
  separate `WKWebsiteDataStore`s, which TitleLess may not have.
- **The hidden background tab step** (Phase 7) is Gecko's `openHidden`; a hidden WKWebView might do something
  similar, but its media loading off-screen is unverified and it costs battery; low priority.
- **IDM comparison and connection benchmarks** (commit 7805625) target desktop bandwidth; on a phone, 4-6
  parallel segment requests are probably enough (judgement, not measured).
- **Electron/Node history** (`app/`): only useful to see that racing and spill came from the owner's Swift
  HLSDownload.swift; nothing to port from it.

## Open questions (not answered by the code)

- How ffmpeg `-c copy` behaves across `#EXT-X-DISCONTINUITY` in Deer's streams: never tested.
- Whether a `SegmentTemplate` with neither timeline nor `duration` ever produces a working "one file"
  download (dash.ts:199-215).
- Whether `unwrapDisguised()` has ever been exercised by a test or a real site (no test found).
- Whether TitleLess's HLSDownload.swift still has the racing / spill / length check that Deer's comments
  attribute to "HLSDownload.swift" (not read: out of scope).
