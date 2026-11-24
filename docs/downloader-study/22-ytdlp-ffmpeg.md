# 22. yt-dlp, Deno and ffmpeg integration

## In one paragraph

Deer has its own download engine for direct files, HLS and DASH. Some sites never play from a file address. YouTube is the main one: its player gets the video through POST requests, so there is nothing in the page's traffic that Deer could save. For those pages Deer runs **yt-dlp**, an outside program that knows how to ask such sites for their videos. yt-dlp needs **Deno** (a JavaScript engine) for YouTube. To join a separate picture and sound into one file, Deer (and yt-dlp) use **ffmpeg** without re-encoding anything. None of the three tools ships with Deer. Deer downloads them only when the person asks in Settings › Video downloads, from the publishers' GitHub releases, and installs them only if their SHA-256 matches the published list. Deer runs yt-dlp as a child process: `-J` to read the page's formats, then `-f <video>+<audio>` to download them. It reads progress from a custom progress line. Pause kills the process. Resume runs it again with `--continue`. Since 2026-10-15 ("Phase 8"), every resume first asks yt-dlp again and compares the formats with the ones recorded at the start, so bytes of two different files are never mixed. If a format changed or is gone, Deer either starts that part again by itself (at most 1 MiB saved) or stops and asks ("File changed"). None of this can run inside an App Store iOS app (no child processes, no downloaded code, and guideline 5.2.3). But the format choice, the codec-to-container rules, the resume check and the progress design can all be reused in TitleLess for its own HLS and direct-file downloads.

## Words used in this document

- **yt-dlp**: a free command-line program (Python, shipped as `yt-dlp.exe` on Windows) that downloads videos from many sites. It knows each site's private rules ("extractors").
- **Deno**: a JavaScript runtime (like Node.js). yt-dlp uses it to run YouTube's player JavaScript (Deer's comment: "yt-dlp needs a JavaScript runtime for YouTube since 2025.11", `gecko/src/modules/downloads/ytdlp.ts:10-11`).
- **ffmpeg**: a free program that reads and writes almost every audio and video file type.
- **Subprocess / child process**: another program that Deer starts and talks to through pipes (stdin, stdout, stderr). Deer uses Firefox's `Subprocess.sys.mjs`.
- **Format** (yt-dlp word): one downloadable version of a video, with an id (`format_id`, for example `137` = 1080p H.264 video only on YouTube, `140` = M4A sound). A download can ask for two formats joined: `137+140`.
- **`-J`**: yt-dlp's "dump JSON" mode. It prints one JSON object that describes the video and all its formats, and downloads nothing.
- **Codec**: how the picture or sound is compressed (H.264 = `avc1`, H.265 = `hvc1`/`hev1`, VP9, AV1, AAC = `mp4a`, Opus, Vorbis).
- **Container**: the file type that holds the compressed tracks (MP4, M4A, WEBM, MKV, TS). Not every container can hold every codec.
- **Mux / merge / join**: put a video track and a sound track into one container file.
- **Remux** (`-c copy` in ffmpeg): change the container without changing the compressed data. Fast, lossless. The opposite of re-encoding.
- **HLS**: Apple's HTTP Live Streaming. A text playlist (`.m3u8`) lists small media files called **segments**. A "master" playlist lists several qualities.
- **DASH**: the MPEG standard for the same idea. Its playlist is an XML **manifest** (`.mpd`).
- **Fragment**: yt-dlp's word for one segment of an HLS or DASH format.
- **Init segment**: in fragmented MP4 streams, a small first file that holds the track setup that all later segments need.
- **`.part` file**: an unfinished download. yt-dlp writes `<name>.part` and renames it when complete.
- **Range request / HTTP 206**: asking a server for only some bytes of a file (`Range: bytes=1000-1999`). A server that can do it answers `206 Partial Content`.
- **ETag**: a server's fingerprint of one version of a file.
- **SHA-256**: a 256-bit fingerprint of a file's bytes. Two different files practically never share it. Publishers list the SHA-256 of their downloads so a client can check it got the real file.
- **Sparse file**: a file whose unwritten regions take no disk space (NTFS supports it). Mentioned only where Deer's other modules use it.
- **DRM**: copy protection (Widevine, PlayReady, FairPlay). Deer never offers DRM video.
- **SABR / UMP**: names in Deer's comments for YouTube's newer streaming method (POST requests, a custom binary response format). Deer's code only says that "nothing in the page's traffic can be downloaded" (`ytdlp.ts:1-2`). Details beyond that are not in the code.
- **Row**: one download in Deer's downloads panel.
- **Link expired / File changed**: two of Deer's paused states. Link expired = the address no longer gives the file. File changed = the site now has another file under that name; Deer stops and asks.
- **R7, UNKNOWN**: RESUME-DESIGN.md's rule for "Deer cannot prove the new answer is the same file". Under 1 MiB saved it starts fresh; above, it asks with the sentence "Deer can’t confirm it is the same file" (`gecko/src/modules/downloads/proof.ts:42`).
- **Phase 8**: the eighth build phase of `gecko/spikes/downloader/RESUME-DESIGN.md` (approved by the owner on 2026-10-13), built in commit `9efd892` (2026-10-15): the yt-dlp resume and renewal work.

Paths below are relative to the repository root. "ytdlp.ts" means `gecko/src/modules/downloads/ytdlp.ts`, "engine" means `gecko/src/modules/VitreDownloads.sys.ts`.

## Files

| File | Role | Lines |
|---|---|---|
| `gecko/src/modules/downloads/ytdlp.ts` | Everything yt-dlp: finding it, running it, `-J` probe, quality list, resume check (`judge`), shared `-J` runs, part-file names, the download transfer with progress parsing, the yt-dlp + Deno installer | 1163 |
| `gecko/src/modules/downloads/ffmpeg.ts` | Finding ffmpeg (lookup order, 60 s cache) and running it (`runFfmpeg`: progress, error tail, kill) | 124 |
| `gecko/src/modules/downloads/ffmpeg-install.ts` | Installing ffmpeg on request from BtbN's builds, SHA-256 check, unpack, atomic swap; also Deer's `%LOCALAPPDATA%` folder helpers and the shared `sha256()` / `fetchText()` | 251 |
| `gecko/src/modules/downloads/platform.ts` | Windows services; only `pickProgram()` (the "Choose ffmpeg.exe" file dialog, lines 138-158) is tool-related | 158 |
| `gecko/src/window/modules/downloads/settings-page.ts` | Settings › Video downloads: ffmpeg row, "Download ffmpeg" row, yt-dlp row (Download / Update / Cancel / Try again), texts | 178 |
| `gecko/tests/downloads/ytdlp.js` | The yt-dlp test suite: 4 YouTube-page sections and 20 Phase 8 sections, against the stand-in | 925 |
| `gecko/tests/downloads/fake_ytdlp.py` | A scriptable stand-in for yt-dlp: answers `--version`, `-J`, downloads with `--continue`, merging; steered per page by a control file | 218 |
| `THIRD-PARTY-NOTICES.md` | "Tools Deer downloads only on request" table: sources and licences of FFmpeg, yt-dlp, Deno (lines 75-86) | 99 |
| `README.md` | Feature line "Video downloads" (lines 30-33) and "Optional tools" credit (lines 140-144) | 148 |

Also read for context (cited below): `gecko/src/modules/downloads/sites.ts` (15 lines, which pages are "yt-dlp first"), `media.ts` `offer()` (lines 346-461), the engine's yt-dlp parts (lines 179-200, 1104-1118, 1935-2258, 2550-2600, 2697-2711, 2995-3030, 3150-3230, 3934-3962, 5435-5465), `hls.ts` `finish()` / `keepPartial()` (lines 1000-1118, the ffmpeg merge), `finished.ts` `mediaCheck()` (lines 402-410), `window/modules/downloads/video.ts` (the mark, the click, the terms reminder), tests `ytdlp-real.js` (122), `ffmpeg-install.js` (83), `ffmpeg_release.py` (64), `ffmpeg-install.py` (47), `noffmpeg.js` (66), `gecko/spikes/downloader/RESUME-DESIGN.md`, `IDM-WAY-DESIGN.md` section 3.9, `RESULT.md` (the ffmpeg recipe), `gecko/ARCHITECTURE.md` (lines 503-520, 775-812), and commits `9efd892`, `31eed88`, `6c03bb8`, `5557e72`.

A note on history: the first commit in this repository, `5557e72` "Deer 0.1.0" (2026-10-05), already contains ytdlp.ts, ffmpeg.ts and ffmpeg-install.ts. Earlier history was squashed, so the reasons for the base design (before Phase 8) exist only in code comments. Phase 8 (`9efd892`) added the resume check, renewal and sharing.

---

## 1. When Deer hands a page to yt-dlp

**What it does**

- On a YouTube video page, the download mark in the tab pill is lit even when Deer has seen no media on the page. A click asks yt-dlp for the qualities. While it waits, a note under the pill says "Finding the qualities…".
- If yt-dlp is not installed, the click shows "Saving videos from this site needs yt-dlp" / "Get it once in Settings › Video downloads." with an **Open settings** button.
- On any other site, Deer first uses its own engine (HLS, DASH, the element's file, the page's files). Only when nothing it found can be read, and only on an explicit click, does it fall back to yt-dlp, if yt-dlp is installed.
- The yt-dlp picker hangs under the tab pill, not over one video, because yt-dlp's answer belongs to the page.

**How it works**

1. `ytdlpFirst(pageUrl)` (`gecko/src/modules/downloads/sites.ts:5-15`):
   - remove a leading `www.`, `m.` or `music.` from the host;
   - `youtu.be` with any path longer than `/` → true;
   - `youtube.com` or `youtube-nocookie.com` with a path starting `/watch`, `/shorts/`, `/live/` or `/embed/` → true;
   - anything else, or a URL that does not parse → false.
2. The mark: `show = web tab && !protected && (count > 0 || ytdlpFirst(tab.url))` (`gecko/src/window/modules/downloads/video.ts:932`).
3. The click (`video.ts:800-870`):
   - `busy = ytdlpFirst(url) && hasYtdlp() ? note('Finding the qualities…', 60000 ms)` (`video.ts:823`);
   - `resolve(target, explicit = true)` → `engine.media.offer(..., { allowTools: explicit })` (`video.ts:402-424`). A hover never sets `explicit`: "An explicit request may run yt-dlp (seconds); a hover never does" (`video.ts:412`);
   - the window caches each offer 60 s. The cache key includes `explicit && hasYtdlp()` (`video.ts:413-415`), so installing yt-dlp makes the next click ask again.
4. `MediaWatch.offer()` order (`gecko/src/modules/downloads/media.ts:346-461`):
   ```
   if video protected or tab used DRM  -> state 'protected'
   if video live                       -> state 'live'
   if ytdlpFirst(pageUrl):
       if !allowTools                  -> nothing (state 'none')
       if yt-dlp not installed         -> needsTools, reason "Saving videos from this site needs yt-dlp."
       else                            -> probe(pageUrl)            (section 4)
   try HLS candidates (at most 4), then DASH, then the element's file, then the biggest page file
   if nothing worked and allowTools and yt-dlp installed and page is http(s):
                                       -> probe(pageUrl)            (fallback for any site)
   else                                -> nothing
   ```
5. An offer whose key starts with `ytdlp|` opens the picker under the tab pill (`video.ts:834-837`). `needsTools` shows the note with "Open settings", which opens the page `video-downloads` (`video.ts:868-881`).

**Why**

- `sites.ts:1-2` and `ytdlp.ts:1-3`: YouTube "streams through SABR/UMP POST requests": nothing in the page's traffic can be downloaded. Deer's normal approach (watch the network, save what the player fetched) cannot work there, so YouTube is routed to yt-dlp first.
- The fallback for other sites exists because yt-dlp "knows many sites" (`media.ts:457`).
- yt-dlp takes seconds, so it only runs on an explicit click (`video.ts:412`).

**Edge cases handled**

- Mobile (`m.`), Music (`music.`) and privacy-mode (`youtube-nocookie.com`) hosts; Shorts, live and embed paths; short links.
- The mark shows on YouTube even before any media was counted.
- No yt-dlp → a clear note with a button, never a silent nothing.
- A page whose own streams fail to read falls back to yt-dlp (test section 4).
- yt-dlp failing → "Can’t save this video" plus yt-dlp's own sentence (section 11).

**Proven by**

`gecko/tests/downloads/ytdlp.js:91-162` (sections 1-4): the mark on a YouTube page, the "needs yt-dlp" note and its button, the picker with the stand-in, the failure note for an unavailable video, and the fallback on a local page with broken streams (`video-bad.html`).

---

## 2. Finding the tools: where yt-dlp and Deno live

**What it does**

Deer treats yt-dlp as installed only when **both** `yt-dlp.exe` and `deno.exe` sit in the same tools folder.

**How it works**

- `ytdlpTools()` (`ytdlp.ts:87-104`):
  1. Test hook: the pref `vitre.tools.ytdlpCommand` = a JSON array `[program, ...first arguments]` (for example `["python", "fake_ytdlp.py"]`). If valid, return it with no Deno.
  2. For each folder of `[toolsDir(), oldToolsDir()]`: if `yt-dlp.exe` and `deno.exe` both exist as files, return `{ command: [yt-dlp.exe], deno: deno.exe }`.
  3. Otherwise `null` (not installed).
- `toolsDir()` = pref `vitre.tools.installDir` or `%LOCALAPPDATA%\Deer\tools` (`ytdlp.ts:77-79`, `ffmpeg-install.ts:102-104`).
- `oldToolsDir()` = `%LOCALAPPDATA%\Vitre\tools`, from before the rename. It is read, never written, moved or deleted (`ytdlp.ts:81-84`, `ytdlp.ts:5-7`).
- `%LOCALAPPDATA%` itself can be replaced by the pref `vitre.localAppData` (`ffmpeg-install.ts:97-99`). The test runner points it into each throw-away profile, so tests never see the person's real tools (`gecko/ARCHITECTURE.md:518-520`, `docs/BUILDING.md:84-88`).
- `hasYtdlp()` in the engine is just `!!ytdlpTools()` (engine `3190-3192`).

**Why**

- Deer's new folder is looked at first: "once an update has put a pair there, the old folder is no longer used" (`ytdlp.ts:97`).
- The old Vitre folder is honoured so a person who installed tools before the rename does not need to download again (`ytdlp.ts:5-7`).
- Both files are required because yt-dlp cannot do YouTube without a JavaScript runtime (`ytdlp.ts:10-11`).

**Edge cases handled**

- yt-dlp present but Deno missing → "not installed" (so the person gets the install button, which also fetches Deno).
- A pair in the old folder only → used where it is.
- A stand-in command for tests has no Deno; `--js-runtimes` is then not passed (`ytdlp.ts:117`).

**Proven by**

`ytdlp.js:85` (an empty tools folder → not installed), `ytdlp.js:110-112` (with the stand-in: installed, version read).

---

## 3. Running yt-dlp: the `run()` wrapper and the arguments every run gets

**What it does**

One function starts every yt-dlp process, collects its output, and stops it on Pause, Cancel or a timeout.

**How it works**

- Base arguments, always first (`ytdlp.ts:115-119`):
  ```
  --no-config --no-playlist --no-colors --encoding utf-8 [--js-runtimes deno:<path to deno.exe>]
  ```
- Environment: `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`, appended to the inherited environment (`ytdlp.ts:148-149`).
- `run(args, { signal, onLine, timeoutMs })` (`ytdlp.ts:138-179`):
  ```
  tools = ytdlpTools(); if none -> DownloadError("yt-dlp is not installed (Settings › Video downloads).")
  if signal already aborted -> AbortedError, and the process is never started
  proc = Subprocess.call(command, [first..., base..., args...], stderr: 'pipe')
  on abort: killed = true; proc.kill()
  if timeoutMs: after timeoutMs, kill the same way
  read stdout and stderr to the end, in parallel
     stdout is split into lines; a partial last line is kept for the next chunk; each full line -> onLine
  wait for exit
  if aborted  -> AbortedError
  if killed   -> DownloadError("yt-dlp took too long to answer.")
  return { code, stdout, stderr }     (a non-zero code is NOT thrown here; callers decide)
  ```
- Timeouts: `-J` 60 000 ms (`ytdlp.ts:243`, `ytdlp.ts:442`); `--version` 20 000 ms (`ytdlp.ts:1151`); a download has no timeout.
- `lastError(stderr)` (`ytdlp.ts:122-126`): the last line starting with `ERROR:`; remove `ERROR:` and an `[extractor] id:` prefix; if there is no `ERROR:` line, the last line of stderr. Example: `ERROR: [youtube] unavailable: Video unavailable. This video has been removed by the uploader` becomes `Video unavailable. This video has been removed by the uploader` (from `fake_ytdlp.py:64`).

**Why**

- `--no-config`: the comment says "no user config" (`ytdlp.ts:114`). A person's own yt-dlp config file must not change Deer's runs. The test checks it (`ytdlp.js:135`).
- `--js-runtimes deno:<path>`: yt-dlp needs a JavaScript runtime for YouTube "since 2025.11" (`ytdlp.ts:10-11`). Deer gives the exact path of its own Deno.
- UTF-8 everywhere: "UTF-8 output" (`ytdlp.ts:114`). My reading (not stated in the code): video titles with non-Latin letters must survive the Windows console encoding.
- `--no-playlist` and `--no-colors`: not explained in the code. From yt-dlp's documented options (my knowledge): `--no-playlist` downloads only the video when the URL also names a playlist; `--no-colors` keeps colour escape codes out of the text Deer parses.
- A pre-aborted signal never starts the process: "a Pause during a resume's check ... its abort listener would never hear an abort that already happened" (`ytdlp.ts:141-142`).

**Edge cases handled**

- Pause during the `-J` check: no orphan process.
- A hung extractor: killed after 60 s with a plain sentence.
- Both pipes are drained so a chatty child never blocks on a full pipe.

**Proven by**

`ytdlp.js:134-135` (the download call has `--no-config` and `--ffmpeg-location`), `ytdlp.js:150-151` (yt-dlp's error sentence reaches the note).

---

## 4. Probing a page: `yt-dlp -J` and the offer's state

**What it does**

Turns yt-dlp's JSON into Deer's "offer": a title, a length, and either a list of qualities or a reason (protected, live, nothing usable, an error).

**How it works**

`probe(pageUrl, base, muxer, fit)` (`ytdlp.ts:242-309`):

```
r = run(['-J', '--no-warnings', pageUrl], timeout 60 s)
if r.code != 0:
    why = lastError(r.stderr)
    if why matches /drm/i     -> state 'protected', key 'ytdlp|<pageUrl>'
    else                      -> reason = why or 'yt-dlp found no video on this page'
info = JSON.parse(r.stdout)   (fails -> reason 'yt-dlp gave an answer Deer could not read')
key   = 'ytdlp|' + (info.webpage_url or pageUrl)
title = info.title, duration = info.duration
if info.is_live or live_status in ('is_live', 'is_upcoming') -> state 'live'
clean = formats where usable(f)
if clean is empty:
    any format has_drm -> 'protected'  else reason 'no format yt-dlp can download'
build the options (section 5)
```

- `usable(f)` (`ytdlp.ts:206`): not `has_drm`; `protocol` is not `mhtml` or `m3u8_native_storyboards`; `ext` is not `mhtml`. (Storyboards are the small preview-image grids YouTube lists as formats.)
- yt-dlp fields Deer reads (`ytdlp.ts:183-200`, plus `url` at `ytdlp.ts:847`): `format_id, ext, vcodec, acodec, height, fps, tbr, abr, filesize, filesize_approx, has_drm, protocol, format_note, manifest_url, url`, and at the top `webpage_url, title, duration, is_live, live_status`. `language` is declared but not used.
- `has(c)` (`ytdlp.ts:202`): a codec field counts only when it is set and not `"none"` (yt-dlp writes `"none"` for "this format has no video" or "no audio").
- The key `ytdlp|<webpage_url>` is the row's stable key. The pill on a re-opened page finds the old row by it (RESUME-DESIGN.md G2, engine `1117-1118`).

**Why**

- Live and upcoming videos cannot be saved as a file; DRM video is never offered (product rule, settings text at `settings-page.ts:84`).
- Storyboards are images, not video.

**Edge cases handled**

- A DRM-only video: "protected", not an error.
- A video page that is live or will be live ("is_upcoming"): "live".
- A video where every format has DRM vs. one with no usable formats: different messages.
- Broken JSON: a plain reason.

**Proven by**

`ytdlp.js:113-123` (the picker lists 1080p, 720p and M4A from the stand-in's formats, which include a storyboard `sb0` that is not offered: `fake_ytdlp.py:67-75`), `ytdlp.js:147-151` (unavailable video).

---

## 5. Building the quality list (format selection)

**What it does**

The picker shows one line per picture height ("1080p", "720p 60", with "4K" or "2K" tags) plus one "sound only" line. Each line has a container (MP4, WEBM or MKV) and a size. The line that best fits the screen is pre-selected ("Best for this screen").

**How it works**

Inputs: `clean` formats, `dur` = the video's length in seconds, `muxer` = ffmpeg was found (engine `748`: `!!(await this.ffmpeg()).path`), `fit` = the screen's tallest full-size video in device pixels.

```
size(f) = f.filesize or f.filesize_approx or (f.tbr kbit/s * 1000 * dur / 8)       (ytdlp.ts:204)

audios   = formats with sound and no picture, sorted by (abr or tbr), highest first   (ytdlp.ts:264)
original = audios whose format_note does not match /dubbed|descriptive/i            (ytdlp.ts:208, 266)
audioFor(ext):                                                                       (ytdlp.ts:267-270)
    pool = original if not empty else audios
    if ext == 'mp4': first pool item with ext 'm4a', else pool[0]
    else:            first pool item with ext 'webm', else pool[0]

options = []
if muxer and audios not empty:                                                        (ytdlp.ts:275-289)
    videos  = formats with picture, no sound, height > 0
    heights = distinct heights, tallest first
    for h in heights:
        at   = videos of height h
        pick = best tbr among at with ext 'mp4' and vcodec /^(avc1|h264)/i
               else best tbr among all of at
        audio = audioFor(pick.ext == 'mp4' ? 'mp4' : 'webm')
        ext   = 'mp4'  if pick.ext == 'mp4'  and audio.ext == 'm4a'
                'webm' if pick.ext == 'webm' and audio.ext == 'webm'
                'mkv'  otherwise
        fps   = ' <round(fps)>' if fps > 30 else ''
        add { id 'y<h><fps>', label '<h>p<fps>', detail '4K' if h>=2160, '2K' if h>=1440,
              container ext.upper, bytes size(pick)+size(audio), height h,
              ytdlpFormat '<pick.id>+<audio.id>', ytdlpExt ext, needsMux true,
              ytdlpFormats [formatOf(pick), formatOf(audio)] }
if options empty:                       # no ffmpeg, or no separate streams         (ytdlp.ts:290-299)
    both = formats with picture AND sound, height > 0, protocol http or https (missing = https)
           sorted by height desc, then tbr desc
    one option per height: { id 'y<h>', label '<h>p', container f.ext, ytdlpFormat f.id }
audio = audioFor('mp4')                                                              (ytdlp.ts:300-304)
if audio: add { id 'ya', group 'audio', label ('WEBA' if ext webm else ext).upper,
                detail '<round(abr)> kbps', ytdlpFormat audio.id, ytdlpExt audio.ext }
suggested = first video option with height <= fit, else the smallest video, else the first option  (ytdlp.ts:307)
```

- `fit` = `round(max(screen.height, screen.width * 9/16) * devicePixelRatio)` (`video.ts:82-85`).
- `formatOf(f, dur)` (`ytdlp.ts:217-233`) is the record each option carries for the resume check (section 9): id, ext, height, fps, audioOnly, video, audio, exact filesize (0 when only estimated), tbr (or abr), approx, duration, vcodec, acodec.
- The picker's button reads "Download <label> · <size>" (`video.ts:1153`). When an option needs joining and ffmpeg is missing, the picker says so (`video.ts:1149-1152`); but for yt-dlp that case does not appear, because without ffmpeg only combined formats are offered.

Example with the stand-in's formats (`fake_ytdlp.py:67-75`): 137 (1080p H.264, 4000 kbit/s), 248 (1080p VP9 WEBM, 3000), 136 (720p H.264), 18 (360p with sound), 140 (M4A 129 kbit/s), 251 (Opus WEBM 135), sb0 (storyboard). Result: "1080p MP4" = `137+140`, "720p MP4" = `136+140`, "M4A" = `140`. The VP9 1080p loses to H.264 at the same height. The 360p combined format is not listed, because combined formats are only used when the joined list is empty. The storyboard is dropped.

**Why**

- "Plain H.264 MP4 plays everywhere; above 1080p sites only have VP9/AV1, kept in WEBM or MP4 as given" (`ytdlp.ts:280`).
- "The original-language track first (YouTube adds dubbed ones marked in format_note)" (`ytdlp.ts:265`); "descriptive" = audio description for the blind (`ytdlp.ts:207`).
- "Without ffmpeg only formats that already carry both picture and sound are offered" (`ytdlp.ts:239-240`), and only direct http(s) ones, so yt-dlp never needs to join or remux anything.
- Size from bitrate × length when no size is given: a usable estimate for formats yt-dlp only estimates (YouTube's HLS formats, see section 9).

**Edge cases handled**

- 60 fps and higher is shown ("1080p 60"); 30 fps and lower is not.
- Only dubbed tracks exist → the dubbed pool is used rather than offering no sound.
- No M4A sound → MP4 picture with WEBM sound → MKV container (MKV holds anything).
- No video formats at all (a music page) → only the sound line.
- Nothing fits the screen → the smallest video is suggested.

**Proven by**

`ytdlp.js:113-143` (picker rows; the download asked for `137+140` with `--merge-output-format mp4`; the row recorded `[137, 1080, 30, mp4, false, 3000000]` and `[140, 0, 0, m4a, true, 300000]`).

---

## 6. Codec to container rules (`--merge-output-format`, `containerFor()`)

**What it does**

Picks the file type a selection is saved as, so ffmpeg is never asked to put a codec into a container that cannot hold it.

**How it works**

The table (`ytdlp.ts:648-652`), as regular expressions on yt-dlp's `vcodec` / `acodec`:

| Container | Picture codecs it holds | Sound codecs it holds |
|---|---|---|
| MP4 | `^(avc\|h26[45]\|hev\|hvc\|vp0?9\|av0?1)` = H.264, H.265/HEVC, VP9, AV1 | `^(mp4a\|aac\|opus\|mp3\|e?ac-?3\|ec-?3\|flac\|alac)` = AAC, Opus, MP3, AC-3, E-AC-3, FLAC, ALAC |
| WEBM | `^(vp0?[89]\|av0?1)` = VP8, VP9, AV1 | `^(opus\|vorbis)` |
| MKV | anything | anything |

```
holds(ext, f):                                   (ytdlp.ts:655-662)
    if ext == 'mkv': true
    picture ok = f has no picture, or (vcodec known ? vcodec matches ext's picture regex
                                                    : f.ext == ext)        # webm/mp4
    sound ok   = f has no sound, or (acodec known ? acodec matches ext's sound regex
                                                  : (webm: f.ext=='webm'; mp4: f.ext in ('m4a','mp4')))
    return picture ok and sound ok   (any other ext -> false)

containerFor(ext, formats, joined):              (ytdlp.ts:670-676)
    if not joined: return formats[0].ext or ext     # one format is saved as itself
    if every format holds(ext): return ext          # keep the row's own type when possible
    picture = the non-audio-only format; sound = the audio-only format
    return 'mp4'  if picture.ext=='mp4'  and sound.ext=='m4a'
           'webm' if picture.ext=='webm' and sound.ext=='webm'
           'mkv'
```

- The download passes `--merge-output-format <ext>` only when the selection has a `+` (two formats) (`ytdlp.ts:939`). A single format is downloaded as it is.
- There are two rules, on purpose: `probe()` picks the container by the formats' **extensions** (conservative: MP4 only for MP4 + M4A). `containerFor()` keeps a row's **existing** type when the **codecs** fit. So H.264 + Opus asked fresh is MKV, but a re-pick inside an MP4 row that gets Opus sound stays MP4 (test "sound").
- When the type changes, Start over renames the file to `<stem>.<newext>` (or the next free name), and because yt-dlp names its parts by the stem, every old part is then set aside (engine `2066-2117`).

**Why**

Commit `9efd892` and the code comment (`ytdlp.ts:664-669`): in the review of Phase 8, "a 1440p WEBM row re-picked to H.264 was asked to join it into WEBM, which ffmpeg refuses, and a sound row given a picture kept '.m4a'".

**Edge cases handled**

- A record from before Phase 8 with no codec fields: falls back to file extensions.
- A sound row given a picture (the pill's choice) becomes a video file (MKV/MP4) and stops being "sound only"; a video row given only sound becomes `.m4a`.
- MP4 accepts Opus, FLAC and VP9 in this table (ffmpeg can write them into MP4; whether every player plays them is another question, not handled here).

**Proven by**

`ytdlp.js:638-674` ("container": a WEBM 1440p row re-picked to 1080p H.264 asks "this quality is no longer offered; Start over gets 1080p as MKV", then joins `137+251` into MKV; the pill's MP4 choice for a WEBM row is joined into MP4), `ytdlp.js:677-716` ("kind"), `ytdlp.js:719-737` ("sound": H.264 + Opus in an MP4 row → `--merge-output-format mp4`).

---

## 7. The download run: arguments and progress parsing

**What it does**

Downloads the chosen formats into the download folder with live progress (bytes, total, speed), shows "Merging" while ffmpeg joins, and fails clearly if the final file is missing.

**How it works**

Arguments (`ytdlp.ts:936-940`), after the base arguments of section 3:

```
-f <format, e.g. 137+140>
-o <full output path, every % doubled to %%>
--newline --no-mtime --continue
-N <max(1, min(8, connections setting))>
--progress-template "download:VITRE %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s"
[--ffmpeg-location <Deer's ffmpeg>]                 # when ffmpeg was found
[--merge-output-format <mp4|webm|mkv>]              # when the format has '+'
<page URL>
```

- `%` is doubled because yt-dlp's `-o` is a template where `%(...)s` means a field (`ytdlp.ts:936`).
- The connections setting is clamped to 1..32, default 8 (engine `3254`), then to 1..8 here. My knowledge of yt-dlp (not stated in Deer's code): `-N` is `--concurrent-fragments`, the number of HLS/DASH fragments fetched at once; `--newline` prints each progress update on a new line; `--no-mtime` stops yt-dlp from setting the file's modified time from the server.
- The speed limit: Deer's rate limiters are **not** passed to yt-dlp. The transfer gets only `onBytes`, `ffmpeg` and `connections` (engine `1939`), and there is no `--limit-rate` argument. The code does not say why.
- `live = 1`: the panel shows one connection for a yt-dlp row (`ytdlp.ts:911-912`; engine `4624` sets `maxConnections` to 1 for yt-dlp rows).

Progress parsing (`ytdlp.ts:942-968`), one call per stdout line:

```
m = /^VITRE (\w+) (\S+) (\S+) (\S+)/ on the line          # status, downloaded, total, estimate ('NA' when unknown)
if m:
    total = number(m.total) or number(m.estimate) or 0
    got   = number(m.downloaded) or (status == 'finished' ? total : 0)
            # yt-dlp reports an already-downloaded format as 'finished' with no downloaded bytes
    if got < last:  done += last          # the next format began (picture done, now sound)
    last = got; current = got
    if total: this.total = max(this.total, done + total)
    received = done + current;  report the increase only (never a negative step)
    if status == 'finished': done += got; last = 0; current = 0
elif line starts with "[Merger]" or "[ExtractAudio]" or "[FixupM":
    phase = 'merging'
```

- `estimate = max(picker's expected size, parsed total, received)` (`ytdlp.ts:930-932`): the panel's total never goes backwards.
- The engine polls `phase` every 250 ms and shows "merging" (engine `1963-1968`).
- After exit: code ≠ 0 → `failure()` (section 11); code 0 but no file at the path → "yt-dlp finished but the file is not there." (`ytdlp.ts:976`).
- `received` starts at what the saved parts hold (engine `1939-1940`, `1999-2001`), so a resumed row shows its saved bytes during the check; then yt-dlp's own counts take over.

**Why**

- A custom `--progress-template` with a fixed prefix `VITRE` makes parsing robust: Deer never parses yt-dlp's human progress text.
- Two formats download one after the other (picture, then sound). Their byte counts restart at zero; the `got < last` and `finished` rules join them into one total.
- "A format a resume finds already downloaded is reported 'finished' with no downloaded bytes (yt-dlp's FileDownloader: only total_bytes): its whole size counts (Phase 8, so a resume shows what is saved)" (`ytdlp.ts:947-948`).

**Edge cases handled**

- `NA` for unknown numbers.
- Estimates only (`total_bytes_estimate`) for fragmented formats.
- An already-complete format on resume.
- yt-dlp's post-processing (merge, audio extraction, MP4 fix-ups) shown as one "merging" phase.
- An output path containing `%`.

**Proven by**

`ytdlp.js:124-136` (the call's arguments and the size in the panel), `fake_ytdlp.py:183-210` (the exact progress lines the stand-in prints, including `VITRE finished NA <size> NA` for an already-downloaded format), `ytdlp.js:284-303` ("same": the resumed run continues from the saved part).

---

## 8. Pause, resume, and yt-dlp's own part files

**What it does**

- Pause stops the yt-dlp process. Resume runs it again; yt-dlp continues its own `.part` files.
- Cancel removes only this row's files, never the files of another row of the same video.

**How it works**

- Pause = the run's `AbortSignal` → `proc.kill()` (`ytdlp.ts:153-161`) → `AbortedError`. There is no "pause" inside yt-dlp.
- Resume = a new run with the same arguments. `--continue` is always passed (`ytdlp.ts:936`). Before that, Phase 8's check runs (section 9).
- The files yt-dlp keeps while it works, as seen from real yt-dlp on YouTube (`ytdlp.ts:799-803`, `ytdlp-real.js:105-116`):

  | Case | Files next to `<stem>.<ext>` |
  |---|---|
  | Two formats (`137+140`) | `<stem>.f<id>.<ext>` (finished format), `<stem>.f<id>.<ext>.part`, `.part-Frag<n>`, `.part-Frag<n>.part` (a fragment being written), `<stem>.f<id>.<ext>.ytdl` (yt-dlp's notes); while merging `<stem>.temp.<ext>` |
  | One format | `<name>.part`, `<name>.part-Frag<n>`, `<name>.ytdl` |

- `ytdlpParts(path)` (`ytdlp.ts:890-906`) lists every such file in the folder for this stem. `partsOf(files, path, id, joined)` (`ytdlp.ts:805-813`) picks the files of one format id. `ownParts(files, path, format)` (`ytdlp.ts:820-826`) = the files of all the row's formats plus its `<stem>.temp.<ext>`. Files set aside by Start over (`<name>.old.part`, `<name>.old (2).part`; regex `ytdlp.ts:795`) are never included.
- Saved bytes of a row = the sum of the sizes of its part files, `.ytdl` notes not counted (engine `2044-2052`).
- Cancel (engine `2697-2711`): list the folder; collect the files that **other** unfinished yt-dlp rows in the same folder own (their `ownParts` plus their `.old.part`); delete this row's `ownParts` minus those; then delete this row's `.old.part` files.

**Why**

- yt-dlp has no pause API. Killing the process and restarting with `--continue` is the only clean way, and yt-dlp is designed to resume its `.part` files.
- Ownership by format id: "Cancel removed every '<stem>.*' part, another row's of the same video too, as an M4A beside its MP4" (`ytdlp.ts:816-818`, review of Phase 8, finding 3).

**Edge cases handled**

- Two rows of one video (MP4, and its sound alone as M4A) in one folder: they share the stem but not the files.
- Fragment files and fragment `.part` files.
- An already-finished format of a joined pair: kept and reported as finished on resume.

**Proven by**

`ytdlp.js:580-605` ("sib": cancelling the sound row removes only `<stem>.m4a.part`; the video row then continues from its own part), `ytdlp-real.js:104-118` (every name real yt-dlp used is one `ytdlpParts()` knows; joined parts are `<stem>.f<id>.<ext>.part`; nothing left after completion; pause and resume continue the same formats).

---

## 9. Resume check: record the formats at the start, ask again, judge

**What it does**

Before a paused or stopped yt-dlp download continues, Deer asks yt-dlp about the page again and makes sure each format is still the **same file**. Only then does `--continue` add bytes to the old `.part`. The row shows "Checking" meanwhile.

**How it works**

1. **Record at the start** (RESUME-DESIGN.md 5.4). The picker passes each option's `ytdlpFormats` (from `formatOf()`) to the download (`video.ts:638-641`). `startNew()` keeps them when their ids join to exactly the chosen format, and marks the row "fresh" (engine `1104-1118`).
2. **First run**: a fresh row downloads at once; the picker's `-J` was a moment ago (engine `1950`). "Fresh" lives in memory only, so a restart of Deer checks.
3. **Every later run** (Resume, Retry, after a restart): phase `checking` if bytes are saved, else `probing` (engine `1951`), then `checkYtdlp()` (engine `1991-2021`):
   ```
   t.checked = true                                  # this run asked yt-dlp (section 11)
   info  = ytdlpSaid[row] if under 60 s old (used once) else extract(pageUrl)   (engine 2029-2034)
   saved = bytes of the row's parts; t.received = saved
   j = judge(recorded(state, quality), state, info)
   if j.drop is empty: state.formats = j.formats; continue the download
   else: section 10
   ```
4. `recorded(state, quality)` (`ytdlp.ts:564-576`): the start's record; for a row from before Phase 8, a guess from the format ids (picture first, then sound), the height from the quality label ("1080p") and the exts from the container (mp4 → mp4 + m4a, webm → webm + webm), with sizes 0 and `guessed: true`.
5. `compare(old, now)` for one format id that is still offered (`ytdlp.ts:622-640`), in this order:

   | Test | Result |
   |---|---|
   | `old.guessed` (no real record) | same (continue, as before Phase 8) |
   | both have an exact `filesize` | same if equal, else **changed** ("was 3.1 MB, now 2.7 MB") |
   | both have a length and they differ by more than 1 s | **changed** ("was 0:19 long, now 0:25") |
   | both have `filesize_approx` | differ by more than 0.1 % (`NEAR = 0.001`, `ytdlp.ts:601`) → **changed** ("was about 1.8 MB, now about 2.1 MB"); else counts as seen |
   | both have a bitrate (`tbr`, or `abr` for sound) | differ by more than 0.1 % → **changed** ("was 800 kbit/s, now 950 kbit/s"); else seen |
   | something was seen and equal | same |
   | nothing to compare | **unknown** (R7) |

   A format found "same" keeps the start's values as the reference and only adds new ones (`kept()`, `ytdlp.ts:643-646`).
6. `judge(chosen, y, info)` (`ytdlp.ts:712-792`), for each id of the selection:
   ```
   cur = the offered format with this id (and usable)
   if cur:
       c = compare(old, formatOf(cur))
       same    -> keep it
       changed -> drop this id (its parts can't be continued), take the fresh record
       unknown -> drop this id, mark 'unsure'
   else (the id is gone):
       drop this id
       pick = repick(old, now, strict) or repick(old, now, loose)
       none -> 'none' (nothing of its kind is offered); keep the old record
       a picture picked at another height or ext -> 'other' (another quality: always ask)
   ext = containerFor(row ext, new selection, joined); a different ext -> 'other'
   part = 'all' | 'picture' | 'sound' (what can't be continued)
   evidence = a sentence for the person (examples below)
   why = 'gone' | 'changed' | 'unsure' | ''
   ```
7. `repick(old, now, loose)` (`ytdlp.ts:584-598`):
   ```
   pool = usable formats of the same kind (sound alone / picture alone / both)
   if kind is sound and some are not dubbed: drop dubbed and descriptive ones
   strict (loose=false): keep only the same ext and, for pictures, the same height
   sort by:
       loose and not sound: nearest height, then the lower height on a tie
       loose: the same ext first
       the same fps first
       the nearest bitrate
   return the first
   ```
   Example from the test: 137 (1080p MP4, 4000) is gone; 399 (1080p MP4, 3900) wins over 400 (1080p WEBM, 4000) and 398 (720p MP4, 3950), because the strict pass needs the same height and ext.

Evidence sentences the person can see: "was 3.1 MB, now 2.7 MB" (the whole download's sizes when every format has an exact size on both sides, `ytdlp.ts:726-729`, `789`), "was about 1.8 MB, now about 2.1 MB", "was 0:19 long, now 0:25", "this quality is no longer offered", "the M4A sound is no longer offered", "this quality is no longer offered; Start over gets 1080p as MKV", "1080p WEBM" when the same height is only offered in another ext (`ytdlp.ts:784-785`), and for R7 "Deer can’t confirm it is the same file".

**Why**

- RESUME-DESIGN.md 2.7: before Phase 8, "--continue resumes with no validator". A site can re-encode a video under the same format id; continuing would glue the new encode's bytes after the old encode's bytes: a broken file. Deer's rule for all downloads is "never destroy, never mix" (RESUME-DESIGN.md section 1).
- yt-dlp signs fresh addresses itself, so asking `-J` again is also how a yt-dlp row renews (`ytdlp.ts:502-503`).
- Review of Phase 8, finding 1 (`ytdlp.ts:614-621`): "a resume continued a format yt-dlp only estimates into its old part over other bytes: YouTube's HLS formats report no filesize". Hence the length, estimate and bitrate tests. `ytdlp-real.js:77-90` saw YouTube format 230 with an estimate only.
- Gone formats: YouTube's format ids can change between visits; a re-pick by kind, ext and height keeps the person's quality.

**Edge cases handled**

- A row from before Phase 8 (no record): continues as before; its record is made from what yt-dlp says now.
- A format with only an estimate; a format with nothing to compare (R7).
- The same encode at the same bitrate and length but other bytes is **not** detected; the comment says so honestly (`ytdlp.ts:617-618`).
- Only the sound is gone in a picture row: named as the sound, follows the 1 MiB rule (section 10) unless the container can't hold the replacement (`ytdlp.ts:708-710`).
- The picture is offered only at another height or ext: always asks.

**Proven by**

`ytdlp.js:261-281` ("picker": the record reaches the row; the first run asks nothing more), `284-303` ("same": one `-J`, then `--continue` from the saved bytes, file hash correct), `306-330` ("small": re-pick 399, not 400 or 398), `363-388` ("size": "was 3.1 MB, now 2.7 MB"), `499-555` ("approx": estimate and bitrate change → File changed; same again → continues; length 19 s → 25 s → File changed; nothing to compare → R7 sentence).

---

## 10. Changed or gone formats: silent restart, File changed, Start over

**What it does**

When some formats can't be continued:
- with at most 1 MiB of them saved, Deer starts those formats again by itself (at most twice in 10 minutes) and keeps going; the history line says what happened;
- otherwise the row pauses as **File changed** with a sentence and a **Start over** button. There is no "Keep partial" for yt-dlp rows. The old bytes are never touched until the new file is complete.

**How it works**

After `judge()` (engine `2006-2020`):

```
stake = parts of the dropped ids (files, bytes)
if not none and not other and row is allowed silent restarts (not already asking):
    log = stake.bytes > 0 ? silentRestart(y.silent, stake.bytes) : y.silent or []
    # silentRestart: allowed only if stake.bytes <= 1 MiB and fewer than 2 restarts in the last 10 min
    if log and setAsideYtdlp(row, j, stake.files):
        if stake.bytes > 0: y.silent = log
        if stake.files: history line, e.g. "Started the picture over: the site offers 1080p as another format now"
        received -= stake.bytes
        continue the download with the new selection
        return
candidate = j.none ? nothing : { format, formats, drop, quality, ext, audioOnly }
remember what yt-dlp said (ytdlpSaid) for Start over
throw ChangedError(j.evidence or "Deer can’t confirm it is the same file")   -> File changed
```

- Constants: `ASK_ABOVE = 1024 * 1024` (`gecko/src/modules/downloads/proof.ts:29`); `SILENT_RESTARTS = 2`, `RESTART_WINDOW = 10 * 60 * 1000` (`gecko/src/modules/downloads/ranged.ts:104-105`, rule at `ranged.ts:363-368`).
- `setAsideYtdlp()` (engine `2066-2117`): each file to set aside gets a name `<name>.old.part` (or `<name>.old (n).part`); the new names are saved and flushed to the store **before** anything moves; then the files move. If any move fails (another program has the file open), the moves are undone, nothing is started over, and the row asks. On success the row takes the new format, record, ext and kind; a new ext renames the row's file; the expected size becomes the sum of the new exact sizes.
- History lines (`ytdlpRestarted`, engine `5456-5460`): "Started over: the file on the site changed", "Started over: Deer can’t confirm it is the same file", "Started the picture over: the site offers 1080p as another format now", "Started the sound over: the site offers it as another format now".
- **Start over** (`startOverYtdlp`, engine `2995-3030`): set aside the candidate's dropped parts, take its selection, reset the silent-restart count ("a decision"), drop the old parts at once only when the disk lacks room, count the kept parts as received, queue. The run then reads yt-dlp's answer from under a minute ago instead of asking again.
- The `.old.part` files are deleted when the new file completes (engine `2314`, `dropOldParts()` at `2433-2440`) or with the row.
- **The pill's Continue** on a paused yt-dlp row (`renewWith`, engine `3934-3962`): another container (private vs. normal, or another Firefox container) → refused. The same quality (`sameYtdlpQuality`, engine `5435-5442`: same kind; sound → yes; picture → same height, else same label) → plain Resume (its check re-picks). Another quality → File changed "1080p is no longer offered", and Start over gets the chosen option; a format both share (the same sound) continues.

**Why**

- Owner decision 1 (RESUME-DESIGN.md section 9, approved 2026-10-13): ask only when more than 1 MiB is at stake; below that, restart silently, at most twice in 10 minutes. (A loop guard: a site that changes on every visit cannot make Deer restart for ever.)
- Owner decision 2: Start over keeps the old partial as `<name>.old.part` until the new file completes.
- Saving the new names before moving files: if Deer crashes in the middle, the store still knows every set-aside file (the engine's general durability rule).

**Edge cases handled**

- Nothing of the dropped format saved yet (paused inside the picture while the sound changed): replaced silently, no restart counted (test "sound" 1).
- A File changed row's Resume only checks again, never restarts silently (`silentRestarts = rec.need?.kind !== 'choice'`, engine `1941-1942`).
- Another program holds the part open: "another program has the saved part open; close it and try again" (engine `3003`).
- Low disk space: the old parts go at once.
- A sound row given a video quality and the reverse (section 6).

**Proven by**

`ytdlp.js:306-330` ("small": silent restart, the old part waits as `.old.part` and is removed after success), `333-360` ("big": more than 1 MiB → File changed, no Keep partial, part untouched; Start over without a new lookup), `363-388` ("size": Resume asks again and never restarts), `391-406` ("single": one format saved as the file itself restarts from 0), `446-479` ("pill"), `719-764` ("sound": the three sound cases).

---

## 11. Error mapping and "Link expired" for yt-dlp rows

**What it does**

- If the site refuses yt-dlp (HTTP 401, 403, 404, 410 or 451) and bytes are saved, the row pauses as **Link expired**. Deer then asks yt-dlp again by itself on a schedule: right away (unless the run's check just asked), then about 2 min, 15 min, 1 h and 6 h after the failure. Retry asks at once.
- With nothing saved, or for any other error, the row fails and shows yt-dlp's own sentence.

**How it works**

- `failure(stderr, fallback)` (`ytdlp.ts:346-350`): `why = lastError(stderr) || fallback`; `status = /HTTP Error (\d{3})/i` in `why`; if the status is in `REFUSED_STATUS = {401, 403, 404, 410, 451}` (`gecko/src/modules/downloads/net.ts:107`) → `YtdlpRefusedError(status, why)` (an `AddressRefusedError` whose message stays yt-dlp's sentence, `ytdlp.ts:338-343`); else `DownloadError(why)`.
- `classify()` (`net.ts:951-966`): `AddressRefusedError` → `refused`; a plain `DownloadError` → `fatal`.
- The engine's `stopped()` (engine `2550-2577`):
  ```
  if kind is refused and row has saved bytes:
      paused, need 'address' (Link expired)
      if the run's own check already asked yt-dlp (t.checked) or the run was queued by an attempt:
          wait.nextAt = nextTry(tries)          # the schedule
      else:
          wait.nextAt = now                    # an attempt at once (ytdlpEpisode)
  else if kind is changed: File changed (section 10)
  else if offline/timeout/server and mode is file or stream: wait and retry    # NOT for yt-dlp rows (engine 2598)
  else: failed, with the error's sentence
  ```
- `nextTry(tries)` uses `SCHEDULE = [0, 2 min, 13 min, 45 min, 300 min]` (`gecko/src/modules/downloads/renew.ts:58`, `70-72`): each value is the gap before attempt number `tries`; so the attempts come about 2 min, 15 min, 1 h and 6 h after the failure; after the fifth, no more automatic attempts.
- `ytdlpEpisode()` (engine `2126-2209`), one scheduled attempt, outside any download slot, shown as "Renewing link":
  ```
  info = extract(pageUrl, maxAge 60 s, background)        # shared, two at a time (section 12)
  if Pause/Cancel/Retry/quit happened meanwhile: stop
  if info:
      j = judge(...)
      no drops                      -> queue the row (its run reads this answer: ytdlpSaid)
      drops, silent restart allowed -> set aside, queue
      else                          -> File changed with the candidate
  else (yt-dlp failed again):
      tries += 1; nextAt = nextTry(tries); keep the refusal status for the row
  ```

**Why**

- "yt-dlp signs the addresses again itself, so this is also how a yt-dlp row renews" (`ytdlp.ts:502-503`).
- Review of Phase 8, finding 4 (commit `9efd892`; engine `1993-1994`): "a check yt-dlp refuses is the attempt at the failure too", so Deer does not run `-J` twice in a row.
- Paused, not failed: RESUME-DESIGN.md section 1, "Link expired" and "File changed" keep everything saved.

**Edge cases handled**

- A refusal during the resume check (the `-J` itself fails with 403): one `-J`, then the schedule.
- Retry, Cancel, Pause or quit during an attempt win.
- A refused row with nothing saved fails at once (nothing to protect).
- Network errors and 5xx inside yt-dlp end in "failed" today (see section 20 for the plan).

**Proven by**

`ytdlp.js:409-443` ("expired": 403 with saved parts → Link expired with status 403, next try 100-140 s later; Retry asks `-J` then `-f`; a scheduled attempt shows "Renewing link" and the run reuses its answer, one `-J`), `ytdlp.js:558-577` ("dup").

---

## 12. Sharing yt-dlp's answers: one run per page, a short cache, two at a time, a per-site budget

**What it does**

Many rows may need yt-dlp's view of the same page at the same moment (after a restart, after the network returns). Deer runs at most one `-J` per page at a time, lets background steps reuse an answer for a minute, runs at most two background `-J` at once, and limits how often one site is asked for page-file renewals.

**How it works**

Constants (`ytdlp.ts:374-378`): `BACKGROUND_RUNS = 2`, `HEARD_FRESH = 60 * 1000`, `HEARD_KEEP = 10 * 60 * 1000`. Page key = URL without `#fragment` (`ytdlp.ts:397`).

```
extract(pageUrl, signal, { maxAge, background, mayRun }):            (ytdlp.ts:510-544)
    key = pageKey(pageUrl)
    recent(): if heard[key] exists and maxAge > 0 and its age <= maxAge:
                  if it was an error: throw that error
                  return its answer
    if aborted: AbortedError
    if recent(): return it
    if a run for key is under way: return join(it, signal)
    if not background:
        if mayRun and not mayRun(): throw Skipped
        return join(begin(key), signal)
    wait for a turn (at most BACKGROUND_RUNS running)
    try:
        recent() again; a run under way again -> join it
        if mayRun and not mayRun(): throw Skipped
        return join(begin(key, done = give the turn back), signal)
    finally: give the turn back if no run was started

begin(key): run -J (60 s); parse; remember {at, info} (or {at, error} unless every caller left)
join(run, signal): users += 1; on abort: users -= 1; when users reach 0, abort the run
remember(): also forgets entries older than HEARD_KEEP (10 min)
```

- Foreground callers (a download's own check) pass no `maxAge`: they always get a fresh answer, but they still join a run already under way.
- Background callers: scheduled attempts (`ytdlpEpisode`), the renewal of page files (`formatsOf`), stream manifest renewal (`manifestFor`, with `background` when it is a scheduled attempt).
- The engine adds its own one-minute memory per row (`ytdlpSaid`, `YTDLP_FRESH = 60 * 1000`, engine `279`, `736`): what an attempt or a check heard is read once by the run or Start over that follows.
- The per-site budget for page-file renewal (`ytdlpSites`, engine `741`, `2225-2229`): the `Budget` class of the page step, `PER_SITE = 6` per `SITE_WINDOW = 1 hour` per site (`gecko/src/modules/downloads/pagestep.ts:37-38`, `58-75`), in memory only. Spent → `Skipped`, and the page step (which has its own budget) comes next.

**Why**

Review of Phase 8, finding 2 (`ytdlp.ts:505-506`): "the reviewer saw one yt-dlp per waiting row, all at once, three for one page". Each run is a whole yt-dlp, with Deno for YouTube (`ytdlp.ts:370-371`). The budget exists because "yt-dlp loads the site's page from the person's address too" (engine `738-740`), like the hidden page step (owner decision 6).

**Edge cases handled**

- A caller that gives up (Pause) leaves the run; the run stops only when nobody waits.
- A run every caller gave up on is not remembered as a failure.
- A failure is shared like an answer, so a burst of rows does not hammer a refusing site.
- A turn that becomes free while a caller waited re-checks the cache before starting a new run.

**Proven by**

`ytdlp.js:608-635` ("burst": five rows, at most two `-J` at once, one `-J` per page), `866-893` ("fburst": three page files of one page share one `-J`), `896-915` ("budget": the seventh look in an hour is not made; the page step renews the file).

---

## 13. yt-dlp as a renewal source for other downloads

**What it does**

yt-dlp also helps rows that are **not** yt-dlp rows:
- a stream (HLS/DASH) row whose playlist expired can get a fresh master playlist or manifest of the same quality (`manifestFor`);
- a direct video file from a page whose signed address expired can get a fresh address (`formatsOf`), after the original address and before Deer opens the page in a hidden tab.

**How it works**

- `manifestFor(pageUrl, rung, audioOnly, signal, background)` (`ytdlp.ts:319-329`): installed and http(s) page; `extract()` with `maxAge 60 s`; keep formats that are not DRM, have an http(s) `manifest_url`, and `protocol` in `m3u8`, `m3u8_native`, `http_dash_segments`; for sound, those without picture; for picture, those with the rung's height; pick the nearest `tbr * 1000` to the rung's bandwidth; return `{ url: manifest_url, format: 'dash' | 'hls' }`. The stream's own proof then decides if it is the same video (RESUME-DESIGN.md G2 step 3).
- `formatsOf(pageUrl, total, signal, mayRun)` (`ytdlp.ts:836-852`): `extract()` as a background step; keep formats with `protocol == 'https'`, an http(s) `url`, no DRM, and `filesize == total` exactly; no duplicates. The engine proves each address against the saved bytes with 64 KiB windows (`proveAddress`) before using it (engine `2221-2244`). The first "same" wins; the row keeps its own address and records the new one as its final address. History line: "New link found through yt-dlp".
- `ytdlpDue(rec)` (engine `2252-2258`): a file row, not private, not quitting, probed, with a path and a known size; the page is http(s), is not the file itself, and does not look like a media URL; the row is media (picked as a video, or a video/music file by name or type); yt-dlp is installed.
- Order (RESUME-DESIGN.md line 29): original address → (stream) master playlist → yt-dlp → hidden source page → the person.

**Why**

"The cheap and invisible steps come first" (RESUME-DESIGN.md line 29). Private rows never use yt-dlp because "yt-dlp would ask the site from outside the private session" (engine `1895-1898`, `2249-2250`).

**Edge cases handled**

- Only exact-size https formats are judged; HLS formats and other sizes are never asked (test "pagefile").
- yt-dlp gives nothing useful → the page step runs (test "order").
- A known risk, not handled: "Signed URLs tied to an IP address or User-Agent from yt-dlp. They may refuse Necko" (RESUME-DESIGN.md section 8).

**Proven by**

`ytdlp.js:786-802` ("pagefile"), `804-830` ("order"), `832-863` ("skip": private and non-media rows never run yt-dlp; a row its own redirector renews never runs it).

---

## 14. Installing yt-dlp and Deno on request

**What it does**

Settings › Video downloads › yt-dlp shows "Not installed" with **Download**, or the installed versions ("yt-dlp 2026.08.19 · Deno 2.9.7") with **Update**. A click downloads yt-dlp and Deno from GitHub, checks both against the publishers' SHA-256 lists, and installs them. Progress shows in the row; **Cancel** works until unpacking; a failure shows the reason and **Try again**.

**How it works**

Sources (`ytdlp.ts:55-57`):
- yt-dlp: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/` + `SHA2-256SUMS` and `yt-dlp.exe`;
- Deno: `https://github.com/denoland/deno/releases/latest/download/` + `deno-x86_64-pc-windows-msvc.zip` and `deno-x86_64-pc-windows-msvc.zip.sha256sum`.
- Test prefs replace the base URLs: `vitre.tools.source.ytdlp`, `vitre.tools.source.deno` (`ytdlp.ts:39-42`, `1070-1071`).

`installAll(force)` (`ytdlp.ts:1068-1134`):

```
phase 'checking'; create the tools folder
ytHash = listedHash(fetchText(source + 'SHA2-256SUMS'), 'yt-dlp.exe')
download yt-dlp.exe -> 'yt-dlp.exe.download'       (phase 'downloading', tool 'yt-dlp', bytes)
verify SHA-256 == ytHash                           (phase 'verifying'; no hash listed -> error)
if force (Update) or deno.exe missing:
    denoHash = listedHash(fetchText(source + zip + '.sha256sum'), zip)
    download the zip -> 'deno-download.zip'; verify
    phase 'unpacking'; find an entry named deno.exe (any folder) -> 'deno.exe.download'
    clear the read-only attribute ("The zip marks deno.exe read-only, which would stop the next update")
move 'yt-dlp.exe.download' -> 'yt-dlp.exe'
if Deno was fetched: clear read-only on the old deno.exe; move the new one in
    a move fails -> "yt-dlp or Deno is in use by a download; let it finish and try again"
phase 'done'
always: delete the temporary files
```

- `listedHash(text, name)` (`ytdlp.ts:1032-1039`) accepts `<64 hex>  <name>` and `<64 hex> *<name>` lines (the `sha256sum` formats), and also PowerShell's `Get-FileHash` text (`Hash : <HEX>`), which is the Deno `.sha256sum` format (`ytdlp.ts:9-10`).
- `fetchText` (`ffmpeg-install.ts:176-180`): `fetch(url, { cache: 'no-store', credentials: 'omit' })`; a non-OK answer → "the release's checksum list answered <status>".
- Downloads use Firefox's `Download` object (`ytdlp.ts:1041-1059`) for progress and cancel, outside any download list.
- `sha256()` (`ffmpeg-install.ts:129-151`) reads the file in 8 MB steps (`8 * 1024 * 1024`), yielding to the event loop between steps "so the window keeps painting", and checks for cancel at each step.
- One install at a time: `installTools()` returns the running promise (`ytdlp.ts:1137-1144`). The state lives in the module, with listeners, so a re-opened Settings page shows it (`ytdlp.ts:993-1017`).
- **Update policy**: manual only. The same button reads **Update** once yt-dlp is installed and calls `engine.installYtdlp(ytInstalled)` (`settings-page.ts:100`, `:112-117`), which is `installTools(update)` (`VitreDownloads.sys.ts:3206-3208`): with `force = true` it fetches both again. Deer never updates yt-dlp by itself. The settings text says: "Sites change often: update yt-dlp when a site stops working." (`settings-page.ts:81`).
- `toolsVersion()` (`ytdlp.ts:1147-1163`): `yt-dlp --version` (20 s timeout; the last line) and `deno --version` (`/deno\s+([\d.]+)/`); "yt-dlp X · Deno Y"; on error just "yt-dlp".
- Sizes: "about 60 MB" for both (`settings-page.ts:81`).

**Why**

- Not bundled; downloaded only when asked; installed only when the SHA-256 matches (README.md:30-33, THIRD-PARTY-NOTICES.md:75-86, ARCHITECTURE.md:513-515). Licences: yt-dlp The Unlicense, Deno MIT (THIRD-PARTY-NOTICES.md:85-86).
- "Nothing is installed when a fingerprint does not match" (`ytdlp.ts:12`).
- Temporary names (`.download`) and a move at the end: a half-downloaded or unverified file never takes the real name.

**Edge cases handled**

- Cancel during download or hashing; not during unpacking (the button is hidden: `settings-page.ts:102`).
- A running download holds the old `.exe` open: a clear message.
- Deno's read-only flag from the zip.
- The checksum list lacks the file: "<tool> is not in its release's checksum list".
- Observed in the code (not discussed in a comment): yt-dlp is moved into place before Deno. If Deno's move then fails, yt-dlp is already the new version and Deno the old one.

**Proven by**

`gecko/tests/downloads/ytdlp-real.js:20-35` (a diagnostic, not in the default set: the real installer from GitHub, phases logged, versions read). I found no local stand-in test for the yt-dlp installer (only for ffmpeg's, section 16).

---

## 15. Finding ffmpeg (lookup order)

**What it does**

Deer looks for ffmpeg in a fixed order and tells the person where it found it ("Using …", "Found beside Deer: …", "Downloaded copy: …", "Found on PATH: …", or "ffmpeg not found").

**How it works**

`findFfmpeg(settingPath)` (`gecko/src/modules/downloads/ffmpeg.ts:40-73`), order from the header (`ffmpeg.ts:6-14`):

1. The path in settings (`vitre.ffmpegPath`). If set but not a file: `settingBroken = true`, and the search goes on.
2. Beside the program: `<exe folder>\ffmpeg\ffmpeg.exe`, then `<exe folder>\ffmpeg.exe` (exe folder = `Services.dirsvc.get('XREExeF')`'s parent), "where a release would bundle its LGPL build".
3. The copy Deer downloaded: `%LOCALAPPDATA%\Deer\ffmpeg\ffmpeg.exe`, then the old `%LOCALAPPDATA%\Vitre\ffmpeg\ffmpeg.exe`.
4. `PATH` (`Subprocess.pathSearch('ffmpeg')`).

- The answer is cached 60 s, keyed by the setting and the two download paths (`ffmpeg.ts:24`, `43-44`). `forgetFfmpeg()` clears it when the setting changes (engine `790`) and after an install (engine `3168-3173`).
- After an install, the engine sets `vitre.ffmpegPath` to the new exe (engine `3168-3173`), so from then on the source reads "settings".
- The window's "Choose…" opens a file dialog filtered to `ffmpeg.exe` and programs (`platform.ts:138-158`); "Look automatically" clears the setting (`settings-page.ts:164-168`).

**Why**

The person's explicit choice wins; a bundled copy (if a release ever bundles one) comes next; Deer's own download next; then whatever the system has. The old folder is read for people who installed before the rename.

**Edge cases handled**

- A chosen file that was deleted: "The file chosen here is missing (<path>)." plus what was found instead (`settings-page.ts:148`).
- No ffmpeg anywhere: streams that need joining are kept as separate files, with a note (section 17).

**Proven by**

`gecko/tests/downloads/noffmpeg.js:15-16`, `55-63` (none found; choosing a path shows "Using" and the engine uses it), `ffmpeg-install.js:21-22`, `49-50`.

---

## 16. Installing ffmpeg on request

**What it does**

Settings › Video downloads › **Download ffmpeg** appears only while no ffmpeg is found (or during and after a failed install). It fetches the newest stable LGPL "shared" Windows build, checks its SHA-256, unpacks only what is needed, and points the setting at it.

**How it works**

- Source: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/` (`gecko/src/modules/downloads/ffmpeg-install.ts:32`); test pref `vitre.ffmpeg.source`; install folder `vitre.ffmpeg.installDir` or `%LOCALAPPDATA%\Deer\ffmpeg` (`ffmpeg-install.ts:112-114`).
- `pickBuild(list)` (`ffmpeg-install.ts:117-126`): read `checksums.sha256`; keep lines matching
  `^([0-9a-f]{64})\s+\*?(ffmpeg-n(\d+)\.(\d+)-latest-win64-lgpl-shared-([\d.]+)\.zip)$` (`ffmpeg-install.ts:33`); rank = `major * 1000 + minor`; the highest wins. This excludes nightly "master" builds, GPL builds and non-shared builds.
- `run()` (`ffmpeg-install.ts:182-241`):
  ```
  checking -> build = pickBuild(fetchText(source + 'checksums.sha256'))   (none -> "no Windows build was found in the release")
  downloading -> '<parent>\ffmpeg-download.zip' via Firefox's Download object (progress, cancel)
  verifying -> sha256(zip) must equal build.sha256 ("the file did not match its published fingerprint, so it was not installed")
  unpacking -> into '<home>.new': only '<top>/bin/ffmpeg.exe', '<top>/bin/*.dll', '<top>/LICENSE.txt'
               (no ffmpeg.exe in the zip -> "the download has no ffmpeg.exe in it")
  remove <home> (fails -> "the ffmpeg already there is in use; close what uses it and try again")
  move '<home>.new' -> <home>; check ffmpeg.exe exists; done
  always: delete the zip; on failure also delete '<home>.new'
  ```
- One install at a time; state with listeners (`ffmpeg-install.ts:49-80`, `244-251`).
- The row's text: "The free LGPL build from BtbN’s FFmpeg Builds on GitHub, the Windows build ffmpeg.org points to. About 75 MB, checked against its published fingerprint and kept in Deer’s folder." (`settings-page.ts:129`).
- Update policy: none. Once any ffmpeg is found, the Download row is hidden (`settings-page.ts:127`).

**Why**

`ffmpeg-install.ts:3-5`: newest **stable** (not nightly master), **LGPL** licence, **shared** variant: "about 75 MB instead of about 170 MB for the static one". LICENSE.txt is kept next to ffmpeg.exe (THIRD-PARTY-NOTICES.md:84). The download stays "outside any download list, so neither Firefox's history nor Deer's take-over sees it" (`ffmpeg-install.ts:8-9`).

**Edge cases handled**

- A wrong fingerprint: nothing installed, the zip removed, the setting left empty, "Try again" with the reason.
- The old ffmpeg is in use: a clear message, the old one kept.
- Extra files in the zip (ffplay, docs) are not unpacked.
- Cancel at any phase except unpacking.

**Proven by**

`gecko/tests/downloads/ffmpeg-install.js` with the local stand-in release `ffmpeg_release.py` (which lists a master build, n8.1, n9.0 non-shared, n9.0 GPL and the right n9.0 LGPL shared; the installer must pick n9.0): phases, version "9.0", only `LICENSE.txt`, `avcodec-62.dll`, `ffmpeg.exe` kept, zip removed, the installed ffmpeg runs, and a bad fingerprint installs nothing (`ffmpeg-install.js:32-82`).

---

## 17. Running ffmpeg (`runFfmpeg`) and what Deer uses it for

**What it does**

Runs ffmpeg to the end with progress in seconds of media written, kills it on Pause/Cancel, and keeps its complaints. Deer never re-encodes: it only copies streams into another container (`-c copy`), or reads a file through to check it.

**How it works**

`runFfmpeg(bin, args, signal, onProgress)` (`gecko/src/modules/downloads/ffmpeg.ts:81-124`):

```
if aborted: AbortedError
proc = Subprocess.call(bin, ['-nostdin', '-progress', 'pipe:2', '-nostats', ...args], stderr: 'pipe')
on abort: proc.kill(0)
drain stdout (ignored) and stderr in parallel   ("Both pipes must be read or a chatty child blocks on a full pipe.")
for each stderr line:
    'out_time_us=<n>'        -> onProgress(n / 1e6 seconds)
    other 'key=value' lines  -> ignored (the -progress block)
    anything else            -> appended to tail; tail keeps its last 2000 characters
exit code != 0 -> Error("ffmpeg exited with <code>: <tail>")
return tail                (also on success: the media check reads it)
```

The uses I found:

1. yt-dlp's own merge: `--ffmpeg-location <Deer's ffmpeg>` (`ytdlp.ts:938`). yt-dlp runs ffmpeg itself.
2. HLS/DASH join (`gecko/src/modules/downloads/hls.ts:1011-1052`, covered in the streams study):
   ```
   -y -hide_banner -loglevel error -i <video track>
      [-i <audio track> -map 0:v:0? -map 1:a:0?]   |   [-map 0:v? -map 0:a?]
      -c copy [-movflags +faststart  (not for WEBM)] -f <webm|mp4> <base>.merge.part
   ```
   Then the temporary file moves into place. On failure the tracks are kept as they are, with a note "Couldn’t join the video and its sound: saved as two files." Without ffmpeg: "ffmpeg not found: the video and its sound are saved as two files." or "ffmpeg not found: saved as it came (TS)." The output's length is checked against the stream's: allowed difference `max(2 s, 2 %)` (`hls.ts:196-197`, `1061`).
3. Keep partial for streams: the same join plus `-t <seconds>` to cut to the shorter track (`hls.ts:1073-1118`).
4. Media check of a finished file: `-v error -i <file> -map 0 -c copy -f null -` (reads everything, writes nothing) (`gecko/src/modules/downloads/finished.ts:402-410`).

**Why**

- The recipe was proven in the downloader spike: "Running ffmpeg with Subprocess.sys.mjs and reading progress from stderr", "abort kills within 0.8 s", "failing run reports exit code and stderr" (`gecko/spikes/downloader/RESULT.md:77-78`, recipe at line 120).
- The tail on success: RESUME-DESIGN.md 4.2 ("runFfmpeg must also return its stderr tail on success").
- `-movflags +faststart`: my knowledge (not in the code): moves the MP4 index to the front so playback can start before the whole file is read.

**Edge cases handled**

- A huge stderr: only 2000 characters kept.
- A last line without a newline is still added to the tail (`ffmpeg.ts:121`).
- An ffmpeg failure never loses downloaded tracks.

**Proven by**

`RESULT.md:78` and `247-248` (spike evidence; 64/64 segments of a real test stream, 0 decode errors), `noffmpeg.js:18-41` (two files without ffmpeg; TS stays `.ts`).

---

## 18. Settings › Video downloads and the window's notes

**What it does**

One settings page for the three tools, plus a few honest notes in the window.

**How it works**

- Registered as page `video-downloads`, title "Video downloads", order 51, with search keywords "ffmpeg yt-dlp youtube deno download install get update join merge video audio sound hls dash stream mp4 drm protected" (`settings-page.ts:17-23`).
- Three sections (`settings-page.ts:68-85`): "Joining video and sound" (ffmpeg row, Choose…, Look automatically, Download ffmpeg row); "YouTube and other video sites" (yt-dlp row); "Protected video" ("Video protected by DRM … is never offered or saved. Some sites’ terms forbid saving their videos: Deer reminds you once per site.").
- Row texts by install phase (`settings-page.ts:88-103`, `125-140`): "Looking for the newest releases…", "Downloading yt-dlp… 9.4 of 18 MB", "Checking Deno…", "Unpacking Deno…", "Couldn’t install: <reason>." Sizes are MiB (1 048 576 bytes) written as "MB": one decimal under 10 MiB, none above (`settings-page.ts:123`).
- The terms reminder (`video.ts:58-80`, `1078`): for hosts matching a list (YouTube, googlevideo, Facebook, Instagram, TikTok, X/Twitter, Vimeo, Twitch, Reddit, Dailymotion, SoundCloud, Netflix), the picker shows "Check that the site’s terms allow saving its videos." until the first download from that host; the seen hosts are kept in the pref `vitre.downloads.termsSeen` (at most the last 200).

**Why**

The person must know what is installed, from where, and how to fix a broken site (Update). The settings text explains why yt-dlp is needed in plain words (`settings-page.ts:81`).

**Edge cases handled**

- A Settings page re-opened during an install shows the live state (module-level state + listeners).
- Buttons hidden while busy; Cancel hidden while unpacking.

**Proven by**

`ytdlp.js:97-107` (the note's button opens the page; "Not installed"), `ffmpeg-install.js:24-30`, `64-66`, `79-81`, `noffmpeg.js:49-64`.

---

## 19. Privacy rules for the tools

**What it does**

- yt-dlp never gets the person's cookies, so it only downloads what anyone can watch without signing in.
- yt-dlp is never used to renew private-window downloads (streams or page files).
- The checksum lists are fetched with `credentials: 'omit'`.

**How it works**

- No cookie, header or user-agent arguments exist in ytdlp.ts. "No cookies are given to yt-dlp: it downloads what anyone can watch without signing in." (`ytdlp.ts:37`).
- The stream env offers `ytdlpManifest` only when the row is not private (engine `1900-1909`); `ytdlpDue()` refuses private rows (engine `2254`).
- `fetchText` omits credentials (`ffmpeg-install.ts:177`).

**Why**

Owner decision 14 (RESUME-DESIGN.md section 9, approved 2026-10-13): "Cookies for yt-dlp?" → keep none; "Videos that need sign-in then renew only through the pill on the page." Private: "yt-dlp would ask the site from outside the private session" (engine `1895-1898`).

**Edge cases handled**

- A sign-in-only video: yt-dlp fails with its own sentence; the person can still use the page's own player streams if Deer's engine can read them.
- Unclear in the code I read: I found no check that stops a yt-dlp row itself from being started from a private window; only the two renewal uses above exclude private rows.

**Proven by**

`ytdlp.js:917-923` ("cookies": no call ever had an argument matching `/cookie/i` or `--add-header`), `ytdlp.js:832-840` ("skip": a private page file never runs yt-dlp).

---

## 20. Planned but not built: yt-dlp retries "like IDM"

**What it does**

Nothing yet. `gecko/spikes/downloader/IDM-WAY-DESIGN.md` (2026-10-21) designs yt-dlp retries, but its status line says "Not built yet: … streams (hls.ts) and yt-dlp" (lines 17-18). The code on disk matches: no retry arguments are passed.

**How it works (design only)**

IDM-WAY-DESIGN.md section 3.9 (lines 403-409):
- add `--retries infinite --retry-sleep linear=0::4 --retry-sleep fragment:linear=0::4 --socket-timeout 30`;
- keep `--fragment-retries` at yt-dlp's default (10), because yt-dlp retries a fragment on any HTTP error, 403 included, and "infinite" would hide an expired signature from Deer's renewal; after 10 tries (about 3 minutes) yt-dlp exits and Deer's Link expired handling runs;
- parse "Retrying (n/inf)" and "Retrying fragment" lines into the row's wait state ("Retrying" / "Waiting for network") instead of showing 0 B/s;
- section 3.10: a yt-dlp exit on a network or server error becomes a wait retried every 30 s.

The design itself marks the yt-dlp retry facts as "from yt-dlp's source as remembered", to be confirmed by `ytdlp-real.js` (line 37).

**Why**

The owner chose "Retrying exactly like IDM" on 2026-10-21 (IDM-WAY-DESIGN.md lines 19-21).

**Edge cases handled / Proven by**

None yet.

---

## iOS analysis: what can move to TitleLess, and what cannot

### The hard limits

1. **No child processes.** An App Store app cannot start another program (my understanding of the iOS sandbox: `fork`/`posix_spawn` are not available to App Store apps). Deer's whole tool model (`Subprocess.call` of yt-dlp.exe, deno.exe, ffmpeg.exe) has no iOS equivalent.
2. **No downloaded code.** App Review Guideline 2.5.2 (read on developer.apple.com on 2026-10-29, paraphrased): apps must be self-contained and may not download, install or execute code that adds or changes features. Deer's model "download yt-dlp, update it when a site breaks" is exactly that. Even if yt-dlp ran inside an embedded Python, updating its extractors from the network would conflict with 2.5.2, and shipping a fixed copy means it breaks whenever YouTube changes, until an app update passes review. (My reading of the guideline, not an Apple ruling.)
3. **Guideline 5.2.3 (Audio/Video Downloading).** Read on 2026-10-29. In short: apps should not include "the ability to save, convert, or download media from third-party sources" without explicit authorization from those sources; the guideline names YouTube among its examples, warns that streaming may also break a service's terms of use, and says the authorization must be shown on request. So **any** technique that saves YouTube videos in TitleLess (yt-dlp-like code, a Swift extractor, JavaScriptCore challenge solving, a server) is a review risk, independent of how well it works. How strictly Apple applies this to a general-purpose browser that saves `<video>` files from arbitrary sites is not stated in the guideline (unverified).
4. **Guideline 2.5.6** (paraphrased): apps that browse the web must use WebKit and WebKit JavaScript (alternative engines only with an EU/Japan entitlement). JavaScriptCore as a standalone `JSContext` is a separate API; the guideline text does not name it.

### Options for YouTube-class sites (and an honest verdict)

| Option | How it would work | Problems |
|---|---|---|
| A Swift extractor library, for example **YouTubeKit** | A Swift package (MIT) that extracts direct video and audio URLs. Its README (read 2026-10-29) says it supports iOS 13+, extracts locally, and can fall back to a remote mode: a server running youtube-dl that sends HTTP requests over a WebSocket for the device to perform, so the URLs match the device's IP. The README does not mention signature or n-parameter handling or the App Store. | Breaks when YouTube changes (the README calls it work in progress); the remote mode sends traffic through a third-party server; 5.2.3 still applies. |
| JavaScriptCore for signature / n-parameter challenges | Fetch YouTube's player JavaScript, run the challenge functions in a `JSContext`, rewrite the stream URLs. This is what yt-dlp now needs Deno for (`ytdlp.ts:10-11`). | `JSContext` has no DOM or browser APIs; the solver code changes often, and downloading new solver code at runtime conflicts with 2.5.2; 5.2.3 still applies. (Feasibility unverified.) |
| A server-side extractor | Your server runs yt-dlp and returns format URLs, or proxies the bytes. | Signed URLs may be tied to the extracting IP or user-agent (Deer's own risk note: RESUME-DESIGN.md section 8), so the server may have to proxy the video: bandwidth cost and legal exposure; 5.2.3 still applies. |
| Sniffing in WKWebView (what TitleLess does today) | The `mediaReporter` script sees `<video>` and `performance` resource entries. | On YouTube there is nothing to sniff: Deer's comment says the player streams through POST requests (`sites.ts:1-2`). |

**Verdict.** For an App Store build, saving YouTube-class videos is a policy problem first and a technical problem second. The safe product choice is Deer's own "know where sniffing cannot work" idea (`ytdlpFirst`, section 1) used in the opposite direction: detect those pages and show an honest note ("Saving videos from this site isn't supported") instead of a download button that finds nothing or the wrong file.

### What is NOT portable

- yt-dlp, Deno and ffmpeg as programs; `Subprocess`, pipes, `kill`, `--continue` of yt-dlp's `.part` files; `--progress-template` parsing.
- Downloading and updating executable tools (sections 14, 16); the ffmpeg lookup order (section 15); `%LOCALAPPDATA%`, the Vitre-to-Deer folder migration, Windows read-only attributes, file dialogs.
- yt-dlp-specific renewal (sections 11-13) as written: TitleLess has no yt-dlp to ask.
- WEBM and MKV output: AVFoundation writes MP4/MOV/M4A family files; I know of no system API that writes WEBM or MKV (unverified for iOS 26).

### What TitleLess can still learn (and where it would go)

- **Format selection** (section 5) for its own HLS master playlists and any DASH it adds: one option per height, H.264 preferred at each height by bitrate, fps shown above 30, "4K"/"2K" tags, the size estimate `bitrate × duration / 8`, the original-language sound first (in HLS: `EXT-X-MEDIA` with `DEFAULT=YES`/`AUTOSELECT`, and skipping descriptive audio marked with the `CHARACTERISTICS` value `public.accessibility.describes-video`; HLS spec knowledge, unverified against real sites), and "suggest the best height that fits the screen" with `UIScreen.nativeBounds`. TitleLess today takes "the first playlist" with no scoring.
- **Codec → container rules** (section 6), adapted to AVFoundation: keep H.264/HEVC + AAC (and AC-3/E-AC-3, ALAC) in MP4/M4A, which `AVAssetWriter` can write with passthrough; treat VP9/AV1/Opus/Vorbis as "cannot be saved as MP4 on this device" unless tested (AV1 decode exists only on recent chips; Opus/VP9 in MP4 via AVFoundation: unverified). This makes Deer's "prefer H.264 MP4 + M4A" rule even more important on iOS, because the vault plays files with `AVPlayer`.
- **Progress design** (section 7): one combined progress for sequential parts (detect "next part started" when the byte count drops; count an already-finished part fully), a total that never goes backwards (`max(expected, reported, received)`), and visible phases ("Finding the qualities…", "Checking", "Merging"). In Swift: a parent `Progress` with child progresses weighted by expected bytes.
- **Resume check by recorded fingerprint** (section 9): record at the start what was chosen (for HLS: the variant's `BANDWIDTH`, `AVERAGE-BANDWIDTH`, `RESOLUTION`, `CODECS`, `FRAME-RATE`, the total duration, the init segment's hash); on resume, read the master again and compare with the same tolerances (exact size → decides; duration > 1 s → changed; estimate or bitrate > 0.1 % → changed; nothing to compare → "can't confirm" with the 1 MiB rule). TitleLess has `RangedDownloadTask` and `HLSDownloadTask` but, from its audit, no such check.
- **Silent restart vs. ask** (section 10): ≤ 1 MiB at stake and fewer than 2 restarts in 10 minutes → restart quietly with a history line; above → "File changed" with Start over; keep the old partial (`.old.part`) until the new file completes.
- **Error mapping** (section 11): HTTP 401/403/404/410/451 with saved bytes → "Link expired" (paused, bytes kept), others → failed with a plain sentence; automatic re-tries about 2 min, 15 min, 1 h, 6 h after the failure.
- **Single-flight + short cache + concurrency cap + per-site budget** (section 12) for any expensive look-up (re-reading a master playlist for many rows, re-loading a page in a hidden `WKWebView` to renew a URL).
- **Per-row staging names** (section 8): never delete "everything with this title"; delete only what the row owns.
- **Verified asset downloads** (sections 14, 16) for data, not code: fetch a checksum list, download to a temporary name, verify SHA-256 (CryptoKit `SHA256`), then swap in atomically (`FileManager.replaceItemAt`), with a phase state machine (idle, checking, downloading, verifying, unpacking, done, failed, cancelled) that a re-opened screen can show.
- **The terms reminder** (section 18) as a UX courtesy (not a 5.2.3 compliance answer).
- **A scriptable stand-in for tests** (`fake_ytdlp.py`): deterministic bytes per format and version, a call log, and a control file to drop formats, change sizes, refuse with 403 and delay answers. TitleLess can do the same with a local test server or a `URLProtocol` stub.

### Swift / iOS building blocks (iOS 17-26)

- Byte transfer: `URLSession` data tasks with `Range` headers for foreground multi-connection pulls; a background `URLSessionConfiguration` for single long transfers (no multi-connection control there).
- Joining picture and sound (what Deer gives to ffmpeg): `AVMutableComposition` + `AVAssetExportSession` with `AVAssetExportPresetPassthrough`, or `AVAssetReader` + `AVAssetWriter` with `outputSettings: nil` (passthrough), as TitleLess's `TSRemuxer` already does. Progress = the last written sample's time / duration (like ffmpeg's `out_time_us`).
- Media check after completion (Deer's `ffmpeg -f null`): load the asset's `isPlayable`, `duration` and tracks, optionally read all samples with `AVAssetReader`, and compare the duration with the expected one using Deer's `max(2 s, 2 %)` rule.
- Long merges in the background: `beginBackgroundTask` gives only a short time; iOS 26 adds `BGContinuedProcessingTask` for user-started work that continues in the background with system progress UI (details unverified).

---

## Lessons worth copying (ranked)

1. **Never append bytes to a partial file without proving it is the same version.** Record a fingerprint of what was chosen at the start (exact size; else length, size estimate and bitrate) and compare on every resume, with explicit tolerances (1 s, 0.1 %) and an explicit "can't tell" result (`ytdlp.ts:622-640`). Deer added this after it found that YouTube's estimated-size formats could be resumed over different bytes.
2. **The 1 MiB rule with a loop guard.** At most 1 MiB at stake and fewer than 2 restarts in 10 min → restart quietly with a history line; more → stop and ask. Keep the old partial until the new file completes (decisions 1 and 2).
3. **Separate "Link expired" from "failed" by HTTP status** (401/403/404/410/451) and from "File changed". Paused states keep bytes; failed is for real dead ends. Retry on a slowing schedule (about 2 min, 15 min, 1 h, 6 h).
4. **Quality list: one line per height, H.264 first, original-language sound, suggest what fits the screen.** Simple, predictable, and right for `AVPlayer` (`ytdlp.ts:264-307`, `video.ts:82-85`).
5. **A codec → container table, and "keep the row's container if the codecs fit".** Never ask a muxer to do the impossible; rename the file when the container must change (`ytdlp.ts:648-676`).
6. **Re-pick a vanished quality by kind, ext and height, then fps, then nearest bitrate**, and always ask when only another quality is offered (`ytdlp.ts:584-598`, `765`).
7. **One expensive look-up per page at a time, shared, cached a minute, at most two in the background, budgeted per site per hour** (`ytdlp.ts:369-544`). Bursts after a restart or a network return are the normal case, not the exception.
8. **Progress that never lies**: parse a machine-format progress line, join sequential parts into one total, count already-finished parts, never let the total shrink, and show phases (`ytdlp.ts:930-968`).
9. **Know where sniffing cannot work** (`sites.ts`) and say so in one clear note with an action, instead of failing silently.
10. **Name and own files per row.** Cancel deletes only what this row owns, never a sibling row's files of the same video (`ytdlp.ts:805-826`, engine `2697-2711`).
11. **Write down what will be moved before moving it** (names saved and flushed first, rollback on failure) (engine `2066-2117`).
12. **Downloaded assets: checksum list first, temporary name, verify, atomic swap, one install at a time, state with listeners**, and a clear sentence for every failure (`ytdlp.ts:1068-1134`, `ffmpeg-install.ts:182-241`).
13. **Keep a muxer's error text, also on success**, and check the output's length against the expected length (`ffmpeg.ts:81-124`, `hls.ts:1061`).
14. **A deterministic stand-in for the outside world in tests** (`fake_ytdlp.py`): seeded byte patterns make "nothing mixed" provable with a SHA-256 of the result.
15. **Privacy defaults as recorded owner decisions**: no cookies for the extractor; no background look-ups for private downloads.

## Not worth copying / Windows-only

- **yt-dlp, Deno, ffmpeg as child processes** and everything around them: `Subprocess`, kill-to-pause, `--continue`, `--progress-template`, `--ffmpeg-location`, `--js-runtimes`, the yt-dlp part-file names (`.f<id>.<ext>.part`, `-Frag<n>`, `.ytdl`, `.temp.<ext>`). iOS apps cannot start processes.
- **Downloading and updating executables** (yt-dlp.exe, the Deno zip, BtbN's ffmpeg zip, `nsIZipReader`, the read-only attribute fix, "in use by a download"). Conflicts with App Review 2.5.2 on iOS.
- **The ffmpeg lookup order** (settings path, beside the exe via `XREExeF`, `%LOCALAPPDATA%`, `PATH`) and the Vitre → Deer folder migration. iOS has one app container.
- **WEBM / MKV output and the MKV "holds anything" escape hatch.** AVFoundation does not write them (to my knowledge); TitleLess should prefer formats it can write as MP4.
- **yt-dlp as a renewal source** (`manifestFor`, `formatsOf`) and its per-site budget as written: no yt-dlp on iOS. The idea (a second, cheaper source of fresh addresses, each proven by bytes before use) is covered by other studies.
- **Gecko specifics**: `Services.prefs` test hooks, Firefox's `Download` object, `Services.dirsvc`, `nsICryptoHash` (use CryptoKit), the window's pill and picker code.
- **YouTube downloading itself** in an App Store build: blocked by guideline 5.2.3 whatever the technique (section "iOS analysis").

## Open questions (unclear in the code)

- Why Deer's speed limit is not passed to yt-dlp (no `--limit-rate`), and whether that is intended.
- What happens if ffmpeg disappears between the picker (which offered joined formats) and the download: `--ffmpeg-location` is then omitted, and yt-dlp would look for ffmpeg itself. Not handled explicitly.
- Whether a yt-dlp row can be started from a private window (no explicit check found for the row itself).
- The partial-update case of the yt-dlp installer (new yt-dlp, old Deno when Deno's move fails) is not discussed in a comment.
- yt-dlp's retry behaviour is "as remembered" in IDM-WAY-DESIGN.md and not yet confirmed by a test.
