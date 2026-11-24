# Download UX, the test suite as a checklist, and the history of decisions

## In one paragraph

Deer shows downloads in four places: a big **panel** (Ctrl+J, 960x688), a small **ring** at the bottom right with a progress arc, a **quick view** that opens above the ring, and the **taskbar button**. Every place reads the same list of "views" that the engine sends about four times a second. A download is never only "running" or "failed": it has a `state`, a `phase` (what it is doing now), a `need` (what the person must do) and a `wait` (what Deer is waiting for before it tries again by itself). From these four fields the UI picks one short status word, one caption sentence, one "primary verb" (the button and the Space key) and a list of actions. Three rules run through all of it: **one row per download for its whole life**, **no dialogs** (a dot on the ring instead), and **Space never destroys bytes**. The second half of this document turns Deer's test suite into a checklist: a local fake server (`gecko/tests/downloads/server.py`, 1974 lines) simulates about 70 kinds of bad server behaviour (no Range support, wrong lengths, changing ETags, expired signed URLs, resets, stalls, 503 limits, Cloudflare challenges, HLS/DASH changes, network loss, sleep, crashes, locked disks, FAT32), and each test states exactly what the engine must do, with numbers. The last part is a dated history of every downloader decision found in git and in the design documents, with the reason for each.

## Words used in this document

These are defined once here. The rest of the document uses them freely.

- **Range request**: an HTTP request with a header like `Range: bytes=1000-1999`. It asks for only part of a file.
- **HTTP 206 (Partial Content)**: the answer to a Range request when the server honours it. It carries `Content-Range: bytes 1000-1999/24000` (start, end, total). A server that ignores Range answers **200** with the whole file.
- **HTTP 416**: "range not satisfiable" (you asked past the end).
- **Content-Length**: the length of the body of one answer.
- **Chunked transfer**: an answer with no Content-Length; the size is unknown until the end.
- **ETag**: a server's label for one version of a file, for example `"A-1800000"`. A **strong** ETag means "byte for byte the same". A **weak** ETag starts with `W/` and only means "about the same"; it may not be used for ranges.
- **Last-Modified**: the date the server says the file last changed.
- **Validator**: an ETag or a Last-Modified date.
- **If-Range**: a request header carrying a validator. It means: "send me only this range if the file is still this version; otherwise send the whole new file (200)". It protects a resume from mixing two versions.
- **Retry-After**: a header on 503/429 answers. It says how many seconds to wait.
- **Content-Disposition**: a header that names the file (`attachment; filename="report.pdf"`, or `filename*=UTF-8''...` for any language).
- **Signed URL**: an address with a token and an expiry time in it (S3, CDNs). After that time the server answers 403 ("Request has expired").
- **Segment (of a file)**: Deer splits a big file into stretches, one per connection. Each segment records `start`, `end` and `received`.
- **.part file**: the unfinished file on disk. It is renamed to the real name at the end.
- **Sparse file**: a file whose unwritten regions take no disk space and are not zero-filled. On Windows NTFS a non-sparse file that is written far past its end makes the OS write zeros first (slow).
- **Proof window**: Deer's way to check "same file?": it downloads a 64 KiB piece at a known offset and compares it with the bytes already saved. Headers alone are never trusted.
- **Block hash record / journal**: a file in the profile with one hash per block of the download (1-64 MiB). Used to find damage after a crash.
- **Seal**: a point where the journal and the .part are flushed to disk together.
- **HLS**: Apple's HTTP Live Streaming. A **master playlist** (`.m3u8`) lists **variants** (qualities). A **media playlist** lists **segments** (small files of 2-10 s). `#EXT-X-KEY` gives an AES-128 key. `#EXT-X-MAP` gives an **init segment** (the header an fMP4 stream needs before its media segments). `#EXT-X-BYTERANGE` makes every "segment" a byte range of one big file. `#EXT-X-ENDLIST` marks a finished (not live) stream.
- **fMP4**: fragmented MP4, the newer HLS/DASH segment format.
- **TS**: MPEG transport stream, the older HLS segment format; its packets are 188 bytes and start with the sync byte 0x47.
- **DASH**: MPEG-DASH. A **manifest** (`.mpd`) lists **representations** (qualities) inside adaptation sets (video, audio).
- **Remux / merge**: join video and audio tracks into one file without re-encoding (Deer uses `ffmpeg -c copy`).
- **Mark of the Web (MotW)**: a hidden `Zone.Identifier` stream Windows puts on downloaded files. Windows only.
- **Necko**: Firefox's network library. **Gecko**: Firefox's engine.
- **IDM**: Internet Download Manager, the Windows download manager Deer copies.

## Files

UX code (all read fully):

| File | Role | Lines |
|---|---|---|
| gecko/src/window/modules/downloads/panel.ts | The Downloads panel: filters, list, rows, details, row menus, Add link, "Use another address…", keys | 1230 |
| gecko/src/window/modules/downloads/ring.ts | The ring (progress arc, dot, flight animation, ring menu) and the quick view above it | 475 |
| gecko/src/window/modules/downloads/menu.ts | Menus for rows, ring and speed limit (through Deer's menu service, or a fallback built to the same spec) | 242 |
| gecko/src/window/modules/downloads/store.ts | The window's copy of the list, event coalescing, the command table and the "primary verb" logic | 248 |
| gecko/src/window/modules/downloads/format.ts | Number and date wording ("1.2 GB", "18.4 MB/s", "38 s", "Today, 21:31") and the state predicates | 141 |
| gecko/src/window/modules/downloads/system.ts | Windows taskbar progress, leaving element full screen, the quit / close prompt | 221 |
| gecko/src/window/modules/downloads/index.ts | Wires the module into a window; the `downloads` service (download a link, open the panel) | 187 |
| gecko/src/window/modules/downloads/css.ts | Styles (skimmed for sizes, colours, motion) | 379 |
| gecko/src/window/modules/downloads/icons.ts | The line icons (20 x 20 grid) and the category icon map; added by the fact-check, see "The icon set" under Mechanism 4 | 59 |

Context read in other files (only the parts the UX depends on):

| File | What I read |
|---|---|
| gecko/src/modules/downloads/types.ts | `DownloadState`, `NeedKind`, `WaitFor`, `DownloadView` (the fields the UI reads) |
| gecko/src/modules/VitreDownloads.sys.ts (5573) | constants (257-279), `pump()` queue (1455-1476), `tick()` speed sampling (4493-4535), `view()` (4573-4672), `event()` history (4340-4342), quit guard (5132-5245), `running()` (5329) |
| gecko/src/modules/downloads/net.ts | `statusMessage()` and `describeError()` error sentences (903-925), `Accept-Encoding: identity` (359) |
| gecko/src/modules/downloads/waits.ts, retry.ts, renew.ts, ranged.ts, ledger.ts, proof.ts | constants only, to state the expected numbers in the test checklist |
| gecko/src/window/modules/settings/pages.ts | the Settings › Downloads section (504-602) |

Tests (every file listed; the big ones read through their header, every section and every `check`):

| File | Role | Lines |
|---|---|---|
| gecko/tests/downloads/server.py | The fake server: every route, every fault knob, a request log | 1974 |
| gecko/tests/downloads/all.py | Runner: makes fixtures, starts the server, runs each suite in its own profile | 288 |
| gecko/tests/downloads/lib.js | Test helpers (`DL`): server stats, waits, trusted clicks in pages, sha256, MotW | 186 |
| gecko/tests/downloads/fixtures.py | Makes big.bin (256 MiB), medium.bin (24 MiB), and with ffmpeg: clip.mp4, HLS TS + AES, fMP4 HLS, DASH, DRM manifests, a live playlist | 143 |
| gecko/tests/downloads/fake_ytdlp.py | A stand-in yt-dlp steered per page by a JSON control file | 218 |
| gecko/tests/downloads/engine.js | 8 connections, pause/resume, speed limit, panel/ring captures | 104 |
| gecko/tests/downloads/connections.js | Per-connection faults and IDM-style retries (18 sections) | 323 |
| gecko/tests/downloads/layout.js | Sparse in-place vs IDM part files; FAT32 4 GiB limit | 178 |
| gecko/tests/downloads/restart.js | Quit prompt, restart, power-loss zeros | 121 |
| gecko/tests/downloads/faults.js | Disk write error mid-download | 60 |
| gecko/tests/downloads/takeover.js | Firefox's own downloads taken over; blob:, extensions, one-time links | 178 |
| gecko/tests/downloads/crosssite.js | A download one site starts on another site | 36 |
| gecko/tests/downloads/mark.js | The pill's download mark always answers | 40 |
| gecko/tests/downloads/embed.js | Hotlink-protected embedded players | 70 |
| gecko/tests/downloads/spa.js | Single-page sites (pushState) | 50 |
| gecko/tests/downloads/drm.js | DRM pages and DRM manifests refused | 67 |
| gecko/tests/downloads/noffmpeg.js | No ffmpeg: two files, .ts kept | 66 |
| gecko/tests/downloads/streams.js | HLS TS+AES, fMP4+audio, DASH, slow segment race, 403 segment, segment table, repair | 174 |
| gecko/tests/downloads/ui.js | Every surface, every "needs the person" state, access keys | 324 |
| gecko/tests/downloads/safety.js | Dangerous names, Safe Browsing, executables, referrer policy, small windows | 211 |
| gecko/tests/downloads/folders.js | Where ffmpeg/yt-dlp are kept (old and new names) | 112 |
| gecko/tests/downloads/integrity.js | "Never lose or mix bytes" (Phase 1) | 583 |
| gecko/tests/downloads/expiry.js | Same-file proof and link renewal (Phase 2) | 498 |
| gecko/tests/downloads/attach.js | Start again on the page, attach to the old row, Keep partial (Phase 3) | 679 |
| gecko/tests/downloads/network.js | Network loss, offline, 503, sleep, restart, hard kill (Phase 4) | 686 |
| gecko/tests/downloads/repair.js | Block hash record, Check file, Repair (Phase 5) | 594 |
| gecko/tests/downloads/stream-expiry.js | Streams that expire or change (Phase 6) | 775 |
| gecko/tests/downloads/resolve.js | Hidden background page step (Phase 7) | 763 |
| gecko/tests/downloads/ytdlp.js | yt-dlp, and its resume rules (Phase 8) | 925 |
| gecko/tests/downloads/perf.js | Diagnostic: main-thread stalls, throughput (not in default set) | 124 |
| gecko/tests/downloads/ytdlp-real.js | Real GitHub + YouTube (not in default set) | 122 |
| gecko/tests/downloads/ffmpeg-install.js / .py, ffmpeg_release.py | Settings › Download ffmpeg against a local fake release | 83 / 47 / 64 |
| gecko/tests/downloads-verify/all.py | The "verifier" runner: re-runs builder suites plus its own, on its own port | 160 |
| gecko/tests/downloads-verify/vserve.py | Edge-case server: hang, stall, empty, chunked, 404, evil names, UTF-8 names, redirect, never-ending page | 170 |
| gecko/tests/downloads-verify/vlib.js | `V` helpers: console errors, CPU time, focus description | 64 |
| gecko/tests/downloads-verify/_dl-lib.js | An older checked-in copy of tests/downloads/lib.js (the runner copies lib.js here at run time) | 173 |
| gecko/tests/downloads-verify/v-core.js, v-keys.js, v-measure.js, v-pages.js, v-rapid.js, v-restore.js, v-scale.js, v-windows.js | Core interplay, keyboard only, pixel/colour/copy measures, bad pages/servers, rapid input + idle CPU, restore, 150% scale, multiple windows | 255, 261, 136, 176, 173, 98, 112, 149 |

Design and history:

| File | What it holds |
|---|---|
| design/DESIGN-NOTES.md (226) | decisions table (lines 11-18), the ring decision of 2026-10-01 (177), menu motion and keys (156-157), ring menu (172) |
| design/keymap.json | the "Downloads" key group and the Esc ladder rule |
| design/canvas/project/Downloads.dc.html, DownloadsPopover.dc.html, VideoStates.dc.html, VideoPicker.dc.html, VideoDownload.dc.html | the boards (approved mockups) the UI is measured against |
| gecko/spikes/downloader/RESUME-DESIGN.md (817) | section 6 "UI states and wording", section 7 phases, section 9 owner decisions 1-14 |
| gecko/spikes/downloader/IDM-WAY-DESIGN.md (1235) | header (what was built and not), 1 "what changes for a person", 2 measured IDM, 3.12 wording, 4.10 constants and sentences |
| gecko/spikes/downloader/IDM-BENCH.md (86) | IDM 6.43 vs Deer bench, 2026-10-20 |
| gecko/spikes/downloader/RESULT.md (306) | the first spike: gotchas, compromises, recipe corrections |
| gecko/spikes/downloader/go.py, boot-*.js, overlay.js | The first spike's runners (added by the fact-check; header comments read only). `go.py` makes the fixtures, starts the spike server, runs the Gecko runtime with `boot-<variant>.js`, stops the server. One boot script per spike: `boot-ranged.js` (spike 1, multi-connection), `boot-engine.js` (spike 2: pause/resume, retry, speed limit, no-Range, redirects, cookies per container), `boot-restart.js` (spike 2b: hard kill, then normal quit, then complete; sha256 checked), `boot-takeover.js` (spike 3: Firefox's own downloads taken over), `boot-media.js` (spike 4: media and DRM detection, ClearKey EME), `boot-hls.js` (spikes 5-6: ffmpeg through Subprocess, HLS), `boot-lifecycle.js` (spike 7: quit refused, taskbar progress, atomic store, last-window survival), `boot-h2.js` (forcing HTTP/1.1 against real HTTP/2 servers), `boot-pagestep.js` (the Phase 7 background-page spike on real sites, read-only loads). `overlay.js` draws a plain list of the engine's rows so captures show what it does. History only; the product tests are in `gecko/tests/downloads`. |
| git history | 18 commits on the downloader paths, plus release commits a142101, 40f1023, daf4f7f |

---

## Mechanism 1: One state model for every surface (state, phase, need, wait)

**What it does**

Every surface (panel row, quick view row, ring, taskbar, quit prompt) shows the same download in the same words. A download that Deer will retry by itself looks different from one that needs the person, and both look different from a real failure.

**How it works**

The engine sends a `DownloadView` per download (gecko/src/modules/downloads/types.ts:64-184). The UI reads five fields:

| Field | Values | Meaning |
|---|---|---|
| `state` | `starting`, `queued`, `downloading`, `paused`, `completed`, `failed`, `cancelled` (types.ts:6) | The coarse state. Kept small on purpose. |
| `phase` | `''`, `probing`, `merging`, `renewing`, `checking`, `repairing` (types.ts:83) | What a running (or completed) row is doing right now. |
| `need` | `{kind: 'address' \| 'choice' \| 'repair' \| 'page', status, evidence}` or null (types.ts:15, 132) | The person must act. Always on a `paused` row (or `completed` for `repair`). |
| `wait` | `{for: 'network' \| 'server' \| 'sleep' \| 'address', tries, nextAt}` or null (types.ts:24, 138) | Deer will act by itself at `nextAt`. |
| `attention` | boolean (types.ts:157) | The row started needing the person **during this session** (for the ring dot). |

Design choice (RESUME-DESIGN.md section 1): "Link expired" and "File changed" are `paused` + `need`, not new states and not `failed`. Reasons given there: a new `waiting` state "touches every state check in the window code"; `queued + wait` was rejected because the quit prompt counts `queued`; an older Deer build reads these rows as plain paused; and "Nothing is lost, the taskbar stays yellow, and red stays for real damage."

The UI derives named states with small predicates (gecko/src/window/modules/downloads/format.ts:102-118):

```
isWaiting(v)  = state == paused && need == null && wait != null && wait.for != 'address'
                // "Waiting for network", "Retrying", or stopped by sleep: Deer continues by itself
isActive(v)   = state in {downloading, starting, queued} || isWaiting(v)
                // the ring stays shown and Pause all reaches it
isChecking(v) = state == downloading && (phase == 'checking' || (phase == 'probing' && received > 0))
isFinished(v) = state in {completed, failed, cancelled}
isEdited(v)   = state == completed && !missing && check.edited          // "Changed after download"
isDamaged(v)  = state == completed && !missing && need.kind == 'repair' && !isEdited(v)
```

Note: `isEdited` wins over `isDamaged` (format.ts:113-118). A file the person edited after a Damaged verdict must never be "repaired" over their edit (review of Phase 5).

The engine has a second, different notion of "running" for the quit prompt (VitreDownloads.sys.ts:988-991, 5329-5331): `runningCount()` counts rows that are `starting/queued/downloading`, but **not** a run that keeps asking with nothing coming in, not an automatic try still on its check, and not a queued row that is waiting. So waiting rows keep the ring visible (`isActive`) but never hold a quit back.

The full table of named states, as the panel row shows them (`statusOf`, panel.ts:1078-1102), in the order they are tested:

| # | Condition | Status word | Colour / glyph |
|---|---|---|---|
| 1 | completed, phase `repairing` | Repairing | normal |
| 2 | completed, phase `checking` | Checking | normal |
| 3 | isDamaged | Damaged | error (red) |
| 4 | isEdited | Changed after download | normal |
| 5 | completed | Completed (or Deleted if the file is missing) | check glyph (Deleted is dim) |
| 6 | failed | Failed | error |
| 7 | cancelled | Cancelled | dim |
| 8 | queued | Queued | normal |
| 9 | phase `renewing` | Renewing link | link glyph |
| 10 | need `address` | Link expired (Waiting for link if armed) | link glyph |
| 11 | need `page` and armed | Waiting for link | link glyph |
| 12 | need `choice` | File changed | normal |
| 13 | need `page` | Start it again from its page | none |
| 14 | isWaiting | "Retrying · in 40 s" (server) or "Waiting for network" | normal |
| 15 | paused | Paused | normal |
| 16 | phase `checking` | Checking | normal |
| 17 | starting, or probing with nothing saved | Starting | normal |
| 18 | phase `merging` | Saving | normal |
| 19 | otherwise | bytes received (e.g. "512 MB") | normal |

Red is `#ff99a4` on dark glass and `#c42b1c` on light (css.ts:92, 351). RESUME-DESIGN.md section 6: red only for Damaged and real failures.

**Why**

RESUME-DESIGN.md (written 2026-10-12, approved by the owner 2026-10-13) found two failures the owner cared about: an expired link "fails for good", and "a link that now answers with a web page can silently replace a half-downloaded song or video with that page and mark it Completed". The state model was extended (not replaced) so that every surface could say what happened without dialogs.

**Edge cases handled**

- A pause that is still closing its connections already reads as `paused` (VitreDownloads.sys.ts view(), `pausing`), so a fast Resume queues it again instead of being lost.
- A run that keeps asking the server with nothing coming in reads as its wait (`retryingOf()`), even though the engine's `rec.state` is still `downloading`.
- `attention` is false for rows that already needed the person when Deer started (VitreDownloads.sys.ts:4652): old problems do not light the dot again.
- `armed` (Waiting for link) expires by itself after 30 minutes (`CATCH_FOR`, VitreDownloads.sys.ts:270; view field at 4649).

**Proven by**

gecko/tests/downloads/ui.js:174-323 (every need state in words, labels, verbs), network.js (Waiting for network and Retrying rows, the ring label "Downloads, 1 waiting, N percent"), repair.js (Damaged vs Changed after download).

---

## Mechanism 2: The window's copy of the list, updated once per frame

**What it does**

The UI stays smooth while 8 connections report progress. A minimized window still updates its taskbar progress.

**How it works**

- The engine ticks every `TICK = 250` ms (VitreDownloads.sys.ts:258) and sends changed views in one `update` event. Other changes are flushed 60 ms after they happen (`flushSoon`, VitreDownloads.sys.ts ~4545).
- Each window keeps a `Map<id, DownloadView>` (store.ts:25-26) and keeps only rows of its own privacy: a private window shows private downloads, a normal window the others (store.ts:49-51).
- Events: `update`, `removed`, `added`, `attached` (store.ts:53-81). `added` makes a new row (and the flight animation). `attached` means a start again continued an old row (no new row).
- Coalescing (store.ts:136-153):

```
changed():
  if scheduled: return
  scheduled = true
  run = { if !scheduled return; scheduled = false; notify every listener }
  requestAnimationFrame(run)
  setTimeout(run, 250)     // a minimized window gets no frames; its taskbar progress still follows
```

- Sort order (store.ts:10, 93-95): running and starting first, then queued, then paused and failed, then completed and cancelled; newest first inside each group.
- `reload()` re-reads the whole list when the panel or quick view opens (panel.ts:185, ring.ts:234), "Files moved or deleted since the list was read show as such" (the engine checks the disk for completed rows in `view(r, checkDisk)`).

**Why**

Comment at store.ts:1-4: about four events a second while downloading; listeners must run once per frame "however many updates arrived". The 250 ms timer exists because a minimized window gets no animation frames (store.ts:151).

**Edge cases handled**

- A listener that throws does not stop the others (try/catch per listener, store.ts:142-147).
- The "primary verb" is decided on the **engine's** state at the moment of the key press, not on the window's copy, which can be a frame late (store.ts:214-226). So Space Space is Pause then Resume, not Pause twice.

**Proven by**

gecko/tests/downloads-verify/v-rapid.js (Pause then Resume before connections closed: "the last word wins"; Space Space on a running row keeps downloading; Ctrl+J 15 times gives one panel), v-windows.js (a download started in one window shows in the other; pause from the second window shows in the first).

---

## Mechanism 3: Numbers and dates in words (format.ts) and how speed and ETA are measured

**What it does**

Sizes, speeds and times read the same everywhere: "24 MB", "1.2 GB", "18.4 MB/s", "38 s", "6 min", "1 h 5 min", "Today, 21:31".

**How it works**

Units are binary (1 KB = 1024 bytes), but printed as KB/MB/GB (format.ts:5-7).

| Function | Rule (format.ts) | Examples |
|---|---|---|
| `bytes(n)` (9-15) | n < 1024: "n bytes"; < 1 MiB: `max(1, round(n/1024))` KB; < 10 MiB: one decimal MB; < 1 GiB: whole MB; < 100 GiB: one decimal GB; else whole GB. Negative or NaN: "" | 512 bytes, 1 KB, 9.8 MB, 24 MB, 1.2 GB, 120 GB |
| `speed(bps)` (17-21) | 0 or less: "" (the cell then shows "—"); < 1 MiB/s: `max(1, round(KB))` KB/s; else one decimal MB/s | 3 KB/s, 18.4 MB/s, 204.5 MB/s |
| `eta(s)` (23-30) | < 60: `max(1, round(s))` s; < 3600: `round(s/60)` min; else `h h m min` or `h h` | 1 s, 38 s, 6 min, 2 h, 1 h 5 min |
| `clock(ms)` (32-34) | locale time, hour numeric, minute 2-digit | 21:31 |
| `when(ms)` (37-45) | "Today, 21:31", "Yesterday, 20:10", else "30 Sep, 18:02" | |
| `finished(ms)` (48-53) | Time column of a completed row: clock today, date before | 21:12 or 30 Sep |
| `duration(s)` (55-62) | m:ss or h:mm:ss | 0:14, 1:02:03 |
| `tile(name)` (65-68) | extension, 1-5 chars, cut to 4, upper case; else FILE | MP4, ZIP, GZ, JPEG |
| `percent(v)` (80-83) | completed: 100; unknown total: 0; else `floor(received/total*100)`, max 100 | |
| `folderLabel(dir, base)` (131-137) | the downloads folder itself: its own name; elsewhere the last two parts joined by " › " | Downloads, Downloads › Video, D: › Films |
| `bare(url)` / `host(url)` (86-96) | strip scheme and "www." | |
| `damagedParts(n)` (126-128) | "1 damaged part", "3 damaged parts" | |

Engine side (VitreDownloads.sys.ts):

```
every 250 ms, for each run (tick(), 4493-4535):
  dt = clamp(now - last, 0, 2*TICK)          // a tick after the computer slept counts as 2 ticks at most
  samples.push({t: now, bytes: netBytes})
  drop samples older than 3000 ms while more than 2 remain
  span = (now - samples[0].t)/1000
  if span >= 0.5: speed = (netBytes - samples[0].bytes) / span   // else keep the old speed
  if downloading and no phase: activeMs += dt; peak = max(peak, speed)

view():
  average = activeMs >= 250 ? netBytes / (activeMs/1000) : 0     // over active time only (4621)
  eta     = speed > 0 && total known ? round((total - received)/speed) : -1   (4622)
```

`netBytes` are bytes that came over the network in this run, so a resumed download's average is not inflated by bytes saved earlier. Time spent asleep or paused is not "active", so the average does not fall after a pause.

**Why**

format.ts:2 says it was "ported unchanged from" the Electron build. The 3 s window and the 0.5 s minimum are not explained in a comment; my reading is that they smooth the number without making it lag. The `2*TICK` clamp has a reason in the code: "Slept time is not active time (RESUME-DESIGN.md G4)".

**Edge cases handled**

- Unknown total: `percent` is 0, ETA is -1 (shown as "—"), size shows the bytes received.
- A stalled transfer: speed falls to 0 within 3 s and ETA becomes -1 ("promises no time left", v-pages.js:97-100).
- Not handled (small bug worth not copying): `eta()` can print "60 min" (for 3570-3599 s) or "1 h 60 min" (for 7170 s: `round(3570/60) = 60`). Carry the minute into the hour when you port it.
- Not handled: `when()` uses `start - 86_400_000` for "Yesterday"; on a daylight-saving day this boundary is one hour off.
- The speed-limit labels are not consistent: the panel menu uses `speed(kbps*1024)` ("1.0 MB/s", panel.ts:43), Settings uses its own `speedLabel` ("1 MB/s", pages.ts:509-512). The panel menu also lacks the 20 MB/s step Settings offers (panel.ts:42 vs pages.ts:508).

**Proven by**

ui.js:28-58 (summary "2 downloading at 18.4 MB/s · 1 queued · 1 paused"), v-measure.js:70 ("256 MB · Video"), v-pages.js:97-100 (stalled: no speed, no ETA).

---

## Mechanism 4: The Downloads panel (layout, filters, search, toolbar)

**What it does**

Ctrl+J opens a 960x688 frosted panel over the page, which is dimmed to 30%. Left: search and filters. Right: a toolbar, the list, and the details of the selected download at the bottom (board `design/canvas/project/Downloads.dc.html`).

**How it works**

- Size (panel.ts:47-49, 357-372): always laid out at 960x688. Below 992x720 (960 + 2x16 margin) the whole panel is scaled down around its centre with a CSS transform; nothing re-flows. Comment at panel.ts:13-15: "nothing in it re-flows, so nothing overlaps or is cut in a small window."
- A popup window is too small: Ctrl+J there opens the panel in the most recent normal window of the same privacy and brings it to the front (panel.ts:212-222).
- Opening (panel.ts:160-210): closes any menu; leaves element full screen first (otherwise the panel would be invisible); runs "show hooks" (the quick view and the video picker close: the panel is topmost); re-reads the list; closes the address field; remembers which element had focus to give it back on close; registers Esc and Ctrl+W at ladder level 60.
- Closing (panel.ts:224-250): fade 300 ms (160 ms with reduced motion); focus returns to the remembered element, or to the page.
- Tab is trapped inside the panel (panel.ts:339-352). Clicking the dimmed page closes it (panel.ts:257).
- Filters (panel.ts:32-40): All · Downloading (downloading or starting) · Queued · Paused · Completed; then "Categories": Video, Music, Documents, Compressed, Programs, Images, Other. Images and Other only show when they hold something (or are the current filter) (panel.ts:439-444). Counts update in place; the filter list is rebuilt only when its shape changes, so a focused filter keeps focus (panel.ts:445-457).
- Categories come from the file extension, then the MIME type (gecko/src/modules/downloads/naming.ts:15-24, 68-76). For example `ts`, `mkv` are Video; `iso`, `vhd`, `apk`, `dmg` are Programs.
- Search (panel.ts:298-308, 385): case-insensitive substring of the file name **or** the address. Down arrow from the search field goes into the list.
- Empty list: "Downloads you start appear here." (no rows at all) or "Nothing here." (a filter hides them) (panel.ts:410).
- Toolbar summary (panel.ts:467-493):

```
parts = []
if running:  "N downloading" + (" at <sum of speeds>" if > 0)
if queued:   "N queued"
if waiting:  "N waiting"                 // Waiting for network, Retrying
if paused - attention - waiting > 0: "N paused"
if attention + damaged > 0: "N need attention" / "1 needs attention"
if nothing:  "N completed" or "No downloads"
summary = parts.join(" · ")
```

- "Pause all" / "Resume all" (panel.ts:331-335, 489-491): reads "Pause all" if anything is active (including waiting rows) or nothing is paused; otherwise "Resume all". Disabled when nothing is active or paused. Pause all also ends waits.
- Speed limit button (panel.ts:42-43, 336, 1026-1030): a menu with No speed limit, 256 KB/s, 512 KB/s, 1.0 MB/s, 2.0 MB/s, 5.0 MB/s, 10.0 MB/s. It sets the global `speedLimitKBps` setting ("Shared by every download"). A per-download limit is in the details ("Limit speed", shown as "Limited to 1.0 MB/s").
- Add link (panel.ts:1034-1075): the field opens pre-filled with a URL from the clipboard if there is one (`engine.clipboardUrl()`), text selected. On submit: trim; add `https://` if there is no scheme; must match `^https?://\S+$`, else "Enter a web address that starts with http or https."; if the engine refuses: "Deer can’t download that address." The new file "flies" from the Download button to the ring. If the address matched a row that waits for a new address, the panel keeps that row selected until the byte proof decides (then the new row is selected if it was another file) (panel.ts:100-105, 116-123, 1073).
- A countdown timer redraws the open panel every second while any row shows "Retrying · in N s" (panel.ts:413-432).

**Why**

- Size and dim: design direction "Settings and Downloads are floating 960×688 frosted panels over the current page: page dimmed at 0.3, 48 px title bar with close" (design/DESIGN-NOTES.md:33).
- Scaling instead of re-flow: safety.js checks at 640x480 and 480x360 found overlapping or cut text before; the rule now is "scaled whole, no overlapping or cut-off text".
- The popup rule: a popup window is too small for the panel (panel.ts:15-17).

**Edge cases handled**

- A row removed while focused: focus moves to the selected row, or the search field (panel.ts:379-419).
- The selected row disappears (removed, filtered): selection falls back to the first shown row (panel.ts:386); Delete moves the selection to the next neighbour, not to the top (panel.ts:921-928).
- Switching tabs underneath with Ctrl+Tab gives focus back to the panel (panel.ts:133-136).
- Opening Downloads over Settings leaves one panel (v-core.js:228).
- Ctrl+J over a full-screen video leaves full screen first (system.ts:86-95; v-core.js:108).
- Not covered: failed and cancelled rows have no filter of their own; they show under All and their category only.

**Proven by**

engine.js:45-46 (960x688 centred, 8 blocks), ui.js:28-110 (summary, filter, search, menus, Add link, narrow window, Ctrl+W), safety.js:145-200 (small windows, popup), v-measure.js:44-87 (every size, radius, colour and label), v-scale.js (150% scale), v-keys.js:113-186.

### The icon set (`icons.ts`)

Added by the fact-check (this file was not cited before). `gecko/src/window/modules/downloads/icons.ts` (59 lines) holds every line icon of the Downloads and video surfaces, drawn on a 20 x 20 grid and "ported from app/src/renderer/modules/downloads/icons.ts" (icons.ts:1-2).

- `ic` (icons.ts:12-44): one SVG string per icon. Stroke icons use `stroke="currentColor"`, round caps and joins, a stroke width of 1.5 by default (1.6-2 for small ones); filled icons (`pause`, `play`, `more`) use `fill="currentColor"`, so every icon takes the colour of its text. Some take a size (`download(size = 16)`, `pause(size = 14)`). Two are coloured on purpose: `done` (a green tick, `#6ccb5f`) and `saved` (a green disc with a dark tick).
- The state icons used by the filters: `all`, `downloading` (the download arrow), `queued` (a clock), `paused`, `completed` (a tick in a circle). Category icons: `CATEGORY_ICON` maps `video, music, documents, compressed, programs, images, other` to their icons (icons.ts:46-54), the same seven categories as the engine's `categoryOf()` (section 12 of the manager file).
- Every SVG has `aria-hidden="true"` and `focusable="false"`: the icon is decoration; the button's label carries the meaning.
- `node(markup)` turns the string into an element through the window's `svg()` helper (icons.ts:56-59). The header says the markup is "Static, trusted markup"; `gecko/src/window/dom.ts:5` warns never to put page-derived strings through `svg()`.
- Used by `panel.ts`, `menu.ts`, `ring.ts`, `video.ts` and `settings-page.ts` (their imports).

iOS note: the same idea maps to SF Symbols or an asset catalog of template images (tinted by the text colour); keep the icons decorative for VoiceOver and put the meaning in the button's accessibility label.

---

## Mechanism 5: A row: columns, the primary verb, and "Space never destroys bytes"

**What it does**

Each row has: a file-type tile, the name and a sub-line, a progress bar **or** a status sentence, Speed, Time, a primary button and a "More" button. The primary button (and Space) does the one safe thing for that state.

**How it works**

Grid columns: 32 px tile · name (flexible) · 150 px progress · 76 px speed · 60 px time · 64 px buttons; row height 50 px (css.ts:70, 74).

Sub-line (panel.ts:543-547): the error sentence in red if failed; "Start it again on tideline.fm" if armed; else "size · Category" (size is the total, or the bytes received when the total is unknown).

Bar or status (panel.ts:549-569):

```
showBar = need == null && !isWaiting && total > 0
          && (transferring || checking || state == paused)
if showBar: bar (dimmed when paused or checking) + "NN%"
else:       statusOf(v) words (Mechanism 1 table)
```

Speed cell (panel.ts:570-576): transferring → speed, or "—" dim at 0; checking with a bar → "Checking" (after 400 ms) or "—"; paused with a bar → "Paused"; else "—".

Time cell (panel.ts:577-579): transferring with an ETA → ETA; queued and first in line → "Next"; completed → finish time; else "—".

Primary verb (`primaryOf`, panel.ts:1104-1122; run by `store.primary`, store.ts:225-235):

| Row | Button label | What it runs |
|---|---|---|
| Damaged (not busy) | Repair (or Download again once the site's file changed) | repair / download-again |
| Changed after download | Restore original | **only moves focus** to Restore original |
| downloading, starting, or Renewing link | Pause | pause (on Renewing link: stops the attempt, keeps bytes) |
| queued | Start now | resume with "now" (jumps the queue) |
| need page, or need address and armed | Open page | open the page in a tab of this window |
| need address | Refresh address (Retry when the row can't be renewed: a stream, a yt-dlp row, or a file never probed; `canRenew`, VitreDownloads.sys.ts:4650) | renewal attempt; if nothing, open the page and arm the row; if no page, open the address field |
| need choice (File changed) | Choose | **only moves focus** to "Start over with the new file" |
| Waiting for network / Retrying | Try now | start now |
| paused | Resume | resume |
| completed, file present | Show in folder | show in folder |
| otherwise (failed, cancelled, missing) | Retry / Download again | resume |

Space in the list (panel.ts:948-951): on a completed row Space does nothing, except on Damaged (Repair) and Changed after download (focus only). Enter opens a completed file. Double-click opens a completed file (panel.ts:519-523).

Accessible label per row (`rowState`, panel.ts:1124-1133), examples: "float-line-tour-4k.mp4, 43 percent, 18.4 MB/s, 38 s left"; "song.mp3, Link expired, 62 percent saved"; "drop.bin, Waiting for network, 40 percent saved" (no countdown in the label, "which would change the label every second"); "finished.bin, Damaged, 1 damaged part". The primary button's label is "<verb> <file name>", e.g. "Refresh address field-recording.mp3".

**Why**

RESUME-DESIGN.md section 6 rules: "Space never destroys bytes" and "No dialogs". A destructive choice (Start over, Restore original) needs a deliberate click on a button whose caption explains it (`aria-describedby` the caption, panel.ts:722). Decided on engine state, not the window copy (store.ts:214-218), so a fast double press is Pause then Resume.

**Edge cases handled**

- A row's own button that has focus keeps Enter and Space (panel.ts:940-941), so the list handler does not run twice.
- Pause on a Renewing link row stops the current attempt and the planned ones, keeping the bytes (expiry.js:396-410).
- Refresh address that finds nothing and has no page opens "Use another address…" (panel.ts:771-780).

**Proven by**

ui.js:237-270 (Space on Link expired opens the page, bytes untouched by sha256; Space on File changed only moves focus, part untouched), integrity.js:424-427, repair.js:234-243 (Space is Repair on Damaged), repair.js:287 and 412 (Space only focuses Restore original), v-keys.js:130-139.

---

## Mechanism 6: The details pane (connections bar, caption, history line, facts, actions)

**What it does**

The bottom of the panel explains the selected download: how many connections are open, an 8-block bar (one block per eighth of the file), a caption sentence, Average / Peak / Received, Address, Saved to, From page (a button), Started, and the actions for that state.

**How it works**

The caption is the first matching rule (panel.ts:636-665):

```
completed & repairing     -> "Fetching 3 damaged parts again (6.0 MB)"
completed & checking      -> "Checking the file"
Damaged                   -> damagedCaption(): "1 damaged part (1.0 MB). Repair fetches only that part again."
                             or "The file on the site is different now, so this copy can’t be repaired. Download again gets the new one."
                             or "The link stopped working (403). Repair needs a working link."
                             or "Deer couldn’t reach the site to repair this file (status)."
                             or "This file no longer matches the checksum it was saved with. Repair compares it with the site."
Changed after download    -> "This file was changed on 14 Oct, 09:12"
completed, site changed   -> "The file on the site is different from this one."
completed, ffmpeg note    -> "<note> · ffmpeg reports: <first line>"
completed                 -> note, or "Finished"; "The file was moved or deleted" if missing
failed                    -> the error sentence, or "Failed"
cancelled                 -> "Cancelled"
queued                    -> "Queued · Next" or "Queued"
renewing                  -> "The link stopped working (403). Looking for a new one"
need address/page, armed  -> "Start it again on tideline.fm. Deer continues from 62%."
need address              -> "The link stopped working (403) · 62% is saved · next try 14:05"
need choice               -> "The file on the site is different from the one being downloaded. 62% of the old one is saved."
need page (Deer's own)    -> the engine's sentence: "The page may need you to sign in."
need page (Firefox's)     -> "Start it again from its page: <why>."
waiting, server           -> "The site had a problem (503). Trying again at 14:05"
waiting, network          -> "Continues when the connection is back"
checking                  -> "Checking the saved part and the link"
starting / probing empty  -> "Starting"
merging                   -> "Joining video and sound" (stream) or "Saving"
Firefox moved it          -> "1 of 1 active · Resumable" / "1 connection · Can’t resume"
one connection            -> same, from v.resumable
many connections          -> "8 of 8 active · Resumable" while running, "8 connections · Resumable" when not;
                             a stream says "Stream" instead of "Resumable"
```

The caption is red only for failed and Damaged (panel.ts:667) and wraps (instead of being cut with "…") for sentences that explain a need (panel.ts:668; css.ts:110).

The 8-block bar (panel.ts:671-702):

```
fills = Damaged & segments ? v.segments            // damaged stretches shown empty
      : completed & present ? [1]*8 (or [1] for one connection)
      : v.segments                                   // engine: 8 equal stretches, each 0..1 filled
```

The engine computes these 8 numbers: for a file, how much of each eighth of the byte range is received (gecko/src/modules/downloads/ranged.ts:2073-2090); for a stream, how many segments of each eighth are written (hls.ts:1805-1810); for Damaged, 1 minus the damaged share (finished.ts:413-429). So the bar shows *where* in the file the holes are, not which connection is which.

The note line under the bar (panel.ts:674-699): for File changed it says exactly what each choice keeps ("Start over keeps what is saved as mixtape.bin.old.part until the new file is complete. Keep partial saves the first 2.0 MB as mixtape (partial).bin." For streams: "Keep partial file: Keeps 0:14 of 0:24 as reenc (partial).mp4"). Otherwise it shows the latest **history line** ("New link found today, 13:02"; `historyLine`, panel.ts:1172-1177), or the legend "Each block is one part of the file, fetched in parallel" / "Each block is a stretch of the video".

Actions per state (`detailActions`, panel.ts:1179-1230):

| State | Buttons (in order) |
|---|---|
| completed, repairing | Show in folder · Copy address · Remove from list |
| Damaged | Repair (or Download again) · Open anyway · Show in folder · Remove from list |
| Changed after download | Restore original · Open · Show in folder · Remove from list |
| completed | Open · Show in folder · Check file · Copy address · Remove from list |
| completed, file missing | Download again · Copy address · Remove from list |
| failed, blocked as uncommon | Keep file · Retry · Copy address · Remove from list |
| failed / cancelled | Retry · Copy address · Remove from list |
| Waiting for link | Open page · Stop waiting · Use another address… · Cancel |
| Link expired | Refresh address (Retry for a stream; Pause while renewing) · Use another address… · Open page · Show in folder · Cancel |
| File changed | Start over with the new file (danger) · Keep partial file · Show in folder |
| needs its page (Deer's own) | (Pause ·) Open page · Use another address… · Show in folder · Cancel |
| needs its page (Firefox's) | Open page · Copy address · Remove from list |
| Waiting for network / Retrying | Try now · Pause · Show in folder · Cancel |
| downloading / queued / paused | Pause / Start now / Resume · Limit speed (Deer's engine only) · Show in folder · Cancel |

When Pause turns into Resume the buttons are rebuilt but keyboard focus stays on the same slot (panel.ts:718-725).

**Why**

RESUME-DESIGN.md section 6: "Every automatic fix leaves one history line in the details note slot"; "'From page' becomes a button"; the File changed explanation line was owner decision 2 and 3 (what Start over and Keep partial keep). The bar's design comes from the Downloads board ("Connections · 8 of 8 active · Resumable · Each block is one part of the file, fetched in parallel").

**Edge cases handled**

- A record claiming more bytes than its total: `fileFills` clamps to the file's end; it "looped here forever" before (ranged.ts:2079).
- A Keep partial row that also has a partial from an earlier Start over says it deletes that too (panel.ts:681-688).
- The address of a stream is not offered for "Use another address…" (streams renew by their own steps, panel.ts:1159-1162).

**Proven by**

ui.js:237-270, integrity.js:388-451, repair.js:223-310, network.js:414-417, 469-472, 528, stream-expiry.js:195-200, v-measure.js:80-87.

---

## Mechanism 7: Menus (row menu, ring menu, speed menu) with access keys

**What it does**

Right-click on a row, the "More" button, Shift+F10 or the Menu key open the row's menu. Each item has an access key (a letter you press to pick it) that is unique in that menu.

**How it works**

- Row menu entries by state (panel.ts:965-1024). Examples: active → Pause [P] Space, Show in folder [F]; completed → Open [O] Enter, Show in folder [F], Check file [H]; Link expired → (Pause [P]) Refresh address [E] Space / Retry [T], Open page [O], Use another address… [U], Show in folder [F]; File changed → Start over with the new file [N], Keep partial file [K], Show in folder [F]; waiting → Try now [T] Space, Pause [P], Show in folder [F]. Then always: Copy address [A]; Cancel [C] (danger, not for finished rows); Remove from list [R] Delete.
- Ring menu (ring.ts:182-200): Show downloads [S] Ctrl+J · Open Downloads folder [F] · Pause all [P] (or Resume all [R]) · Download copied link [D] (only when the clipboard holds a URL) · Clear finished [C] (disabled when nothing finished; removes rows, never files). It opens up and to the left of the ring.
- Menus go through Deer's shared menu service. If it is missing, a fallback menu with the same spec is built (menu.ts:100-242): width fits the content in 8 px steps between 264 and 360 px (menu.ts:138); kept 8 px inside the window (154-155); opens in 90 ms fade + 200 ms scale 0.96→1 from the anchor corner, closes in 100-120 ms (161-164, 189); Up/Down/Tab/Home/End move; Enter or Space activates; Esc, Alt or F10 close; a letter activates its access key at once (217-233); opened by keyboard, the first enabled item is focused; opened by mouse, nothing is (238-241).
- A menu closes on window blur and on **the window's own** resize only (menu.ts:235-237).

**Why**

- Access keys unique per menu: RESUME-DESIGN.md section 6 accessibility rule; ui.js:273-297 loops over every row's menu and fails on any duplicate or any key that is not a letter of the label.
- The resize rule: commit 4a14a58 (2026-10-15). "The right-click menu and the download row menu closed on any 'resize' reaching the window. Home preloaded for the next new tab runs in an in-process browser, and its page's resize bubbles up through the chrome window, so a menu opened about 1.5 s after a new tab could vanish by itself."
- Menu spec: design/DESIGN-NOTES.md:130-157 ("Windows 11 citizen" concept).

**Edge cases handled**

- Focus goes back to the button that opened the menu, unless focus is already in a dialog (menu.ts:75-77).
- Adjacent or trailing separators are dropped (menu.ts:109, 134).

**Proven by**

ui.js:70-84 and 273-297, v-keys.js:73-82 and 141-148.

---

## Mechanism 8: "Use another address…" (paste a new link for the same file)

**What it does**

When a link has expired, the person can paste a fresh address in the details. Deer checks that the new address is the **same file** before it continues from the saved bytes.

**How it works**

- An inline form in the details, labelled "New address for <name>" (panel.ts:799-845). Esc closes the form, not the panel.
- Submit (panel.ts:859-889): add `https://` if no scheme; must be http(s); note "Checking that address…" (polite live region); the engine runs `setAddress(id, url)`, which proves the bytes.
- Results shown in the note: success closes the form and the same row carries on; "That address is a different file (256 MB; this download is 24 MB)." with a button "Use it and start over"; "That address answers with a web page, not the file."; "Deer couldn’t reach that address." (expiry.js:457-462).
- The pasted address is asked "as Add link asks: no Referer and no Origin from the old page" (expiry.js:479).
- The history line becomes "Continued from another address" (VitreDownloads.sys.ts:3794).

**Why**

Part of the "G1 manual fallback" of RESUME-DESIGN.md: when automatic renewal fails, the person can always bring a link, and Deer never trusts it without the byte proof.

**Edge cases handled**

- The person selects another row while the check runs: the result is dropped (panel.ts:880-881).
- Only one-file downloads of Deer's own engine offer it (not streams, not rows Firefox moved).

**Proven by**

expiry.js:414-479, attach.js:219-247.

---

## Mechanism 9: "Needs attention" without dialogs (ring dot, live region, counts)

**What it does**

When a download starts needing the person (Link expired, File changed, Start it again from its page, Damaged), no dialog appears. Instead: an 8 px dot on the ring, the ring's label "Downloads, 1 needs attention", the toolbar's "1 needs attention", the quick view's summary, and one sentence for screen readers.

**How it works**

- The dot is shown while any row has `attention` (rows that started needing the person during this session) (ring.ts:95, 106; css.ts:150-152). It is accent blue (`#4cc2ff`, `#005fb8` on light), not red: "not red (red is for damage)" (css.ts:149).
- The ring stays shown while there is attention, even with nothing downloading (ring.ts:96-105).
- A polite live region beside the ring says each **new** need once: "song.mp3: Link expired" (ring.ts:131-139). Rows already needing the person when the window opened are not announced. The region is cleared then set 50 ms later, so a repeated sentence is read again (ring.ts:125-128).
- After a start again continued an old row it announces "Continuing song.mp3 from 62%" (or "Starting song.mp3 again"); video.ts:211-212.

**Why**

RESUME-DESIGN.md owner decision 13: "A dot on the downloads ring instead of any dialog? Recommendation: yes. It is only for rows that start needing the person during the session." Section 6 accessibility: "A polite live region announces only changes that need the person, plus the result of an attach or a repair."

**Edge cases handled**

- The quick view does not say "All done" while rows wait for the person (ring.ts:302-306).
- Damaged counts as needing attention in the toolbar and quick view (panel.ts:484-486, ring.ts:304).

**Proven by**

ui.js:233-234 ("3 need attention", the 8 px dot, the ring label), ui.js:299-306 (quick view verbs).

---

## Mechanism 10: The ring (progress arc, show/hide, flight animation)

**What it does**

A 44 px glass circle at the bottom right (right 72 px, bottom 20 px) appears over pages and Home while anything downloads. Its arc shows overall progress. New downloads fly into it. It hides 6 s after the last download finishes.

**How it works**

`update()` (ring.ts:91-122):

```
active    = rows where isActive (downloading, starting, queued, waiting)
attention = rows with attention
if active or attention: cancel hide timer; show
else if shown and no timer: after 6000 ms, hide unless quick view open or something became active

known  = active rows with a known total
pct    = active ? (sum(min(received,total)) / sum(total)) : 1
spin   = active && no known total && some row downloading        -> spinning quarter arc
arc    = spin ? 0.25 : max(pct, active ? 0.02 : 1)               // at least 2% so it is visible
label  = "Downloads, 1 needs attention, 1 active, 1 waiting, 40 percent"
         or "Downloads, 2 active, 40 percent" or "Downloads, finished"
```

- While hidden the ring is `inert` (no focus, no clicks) (ring.ts:59, 141-154).
- It is a keyboard stop of the tab bar (`data-bar-stop`, ring.ts:57).
- Click: quick view. Right-click, Shift+F10 or the Menu key: ring menu (ring.ts:66-76).
- Flight (ring.ts:162-180): a 32 px glass circle with the file-type label moves from where the download started (the pointer, the peek sheet's header, the Add link button) to the ring centre in 480 ms on the spring curve `cubic-bezier(0.22, 1, 0.36, 1)`, scaling to 0.82; the label fades in over the first 12% and out after 80%; then the ring pulses 1 → 1.06 → 1 over 240 ms. Reduced motion: no flight and no pulse. The fade is on the label only: "opacity on the glass element itself would blind its lens" (ring.ts:173).
- No flight when the panel is open (the new row appears right there) or when the download came from another window's tab (that window shows it) (video.ts:182-198).

**Why**

design/DESIGN-NOTES.md:177, decided with the owner on 2026-10-01: "while a download runs, Home's downloads ring ... also shows over web pages, so menu and Peek downloads have somewhere to fly; it hides 6 s after the last download finishes." Flight spec: DESIGN-NOTES.md:156.

**Edge cases handled**

- Unknown sizes: spinning arc (`indeterminate`, css.ts:148); stopped under reduced motion.
- Element full screen hides the ring (css.ts:156); leaving brings it back (v-core.js:82-91).
- 150% display scale keeps 44 px at right 72 / bottom 20 (v-scale.js:58).

**Proven by**

engine.js:37 (ring over the page), ui.js:112-127 (positions), v-pages.js:119 (indeterminate on a chunked download), v-core.js (full screen, F11, Home), v-measure.js:93, attach.js:639-669 and v-core.js:213 (flight from a peek sheet's header).

---

## Mechanism 11: The quick view above the ring

**What it does**

A 360 px popover above the ring (right 20, bottom 76) with a summary and the three newest relevant rows, each with one round button, and "Open Downloads".

**How it works**

- Rows: the first three of the sorted list, cancelled rows left out (ring.ts:297, 307).
- Summary: "1 active · 2.1 MB/s · 1 waiting", or "N need attention", or "All done", or "Nothing yet" (ring.ts:298-306).
- Each row: tile, name, a mini segment bar (8 blocks for a multi-connection download, else 1), a meta line, one button (ring.ts:342-422). Meta examples: "512 MB of 1.2 GB · 18.4 MB/s · 38 s left", "24 MB · Completed", "40 MB of 96 MB · Waiting for network", "Repairing", "Moved or deleted" (`meta`, ring.ts:455-475).
- The button's verb follows the same ladder as the panel's primary verb. File changed and Changed after download open the panel with focus on the choice: "no destructive verb here" (ring.ts:359-365).
- Rows are only re-ordered when the order really changed, "so a row is never moved under the pointer" (ring.ts:325-334).
- Keys: Up/Down/Home/End, Enter opens the row in the panel, Space presses the row's button, Tab cycles inside, Esc (ladder level 30) closes and returns to the ring (ring.ts:424-442).
- It closes when another Deer surface takes focus (switcher search, find, the address field), otherwise it "would stay under that surface and take its first Esc" (ring.ts:258-265; index.ts:114-126).
- Opening the panel closes it (ring.ts:65).
- Its glass lens is rebuilt when its height changes (ring.ts:335-339).

**Why**

Board DownloadsPopover (design/canvas/project/DownloadsPopover.dc.html): "Downloads · 2 active · 26.1 MB/s"; rows "512 MB of 1.2 GB · 18.4 MB/s · 38 s left"; "Open Downloads".

**Edge cases handled**

- Ring clicked 10 times quickly: no half-closed quick view left (v-rapid.js:71-74).
- A row Firefox moved has no bytes: no bar for it (ring.ts:377-379).

**Proven by**

ui.js:112-127, 299-306; v-keys.js:50-95; v-measure.js:98-103; network.js:426.

---

## Mechanism 12: Taskbar progress

**What it does**

The window's taskbar button shows green progress while downloading, yellow when everything is paused, and nothing when idle.

**How it works**

system.ts:29-76:

```
running = rows downloading, starting or queued
paused  = rows paused                        // includes Link expired, File changed AND Waiting/Retrying
if running:  state = total known ? NORMAL (green) : INDETERMINATE; sum running rows
elif paused: state = total known ? PAUSED (yellow) : NO_PROGRESS;  sum paused rows
else:        NO_PROGRESS
values above 1e12 bytes are divided by 1e6
only send when "state:done:total" changed
every 5 s: send again (Firefox's own indicator resets the button when its empty list changes)
```

**Why**

RESUME-DESIGN.md section 1: Link expired and File changed are paused, "the taskbar stays yellow, and red stays for real damage". The 5 s re-send is a Gecko workaround (system.ts:69-73).

**Edge cases handled**

- A minimized window still updates (store's 250 ms fallback timer).
- Observation: a row that is "Waiting for network" counts as paused (yellow) here, while the ring counts it as active. Not explained in comments.

**Proven by**

engine.js:33 (normal, total = file size), engine.js:74 (paused after pause).

---

## Mechanism 13: Quit, restart and closing the last private window

**What it does**

Quitting, restarting or closing the last window while downloads run shows a small prompt: "Keep downloading" (default, Esc) or "Quit"/"Restart". Closing the last private window while a private download runs asks to cancel it.

**How it works**

- The engine listens to `quit-application-requested` and refuses the quit when `runningCount() > 0` (VitreDownloads.sys.ts:5183-5199). It picks the most recent window's prompt. "Quit" calls `confirmQuit()`, which lets the next quit through for 10 s (5154-5159), then repeats the action (system.ts:109-120). A restart that is the updater's "Restart to update" goes through the updater.
- Private: `last-pb-context-exiting` is refused while private downloads run (5204-5225); "Cancel downloads and close" cancels them all (5167-5173).
- After a quit, unfinished downloads keep their bytes; with the setting "Continue unfinished downloads when Deer starts" (default on) they continue 10 s after the next start (`CONTINUE_AFTER`, waits.ts:42); rows the person paused stay paused.
- Wording (`promptCopy`, system.ts:127-148):
  - Title: "A download is still running" / "3 downloads are still running".
  - Body, setting on: "If you quit now, it pauses and continues from where it stopped the next time you open Deer." (restart: "... when Deer opens again").
  - Body, setting off: "If you quit now, it pauses. Resume it from Downloads the next time you open Deer."
  - Plus " The private one is cancelled." when some are private; only private: "If you quit now, they are cancelled. Private downloads can’t continue later."
  - Private window: "A private download is still running" / "If you close this window, it is cancelled. Private downloads can’t continue later." / button "Cancel download and close".
- The prompt is a 400 px frosted alert dialog (`role="alertdialog"`), layer 55 (above panels and menus, below tips) (system.ts:102). It leaves element full screen and reveals the hidden tab bar first; it closes any menu and the tab switcher (system.ts:172-180). Tab toggles between the two buttons (201-205). Focus starts on "Keep downloading".

**Why**

- Without it, a quit from a full-screen video "would be invisible and the quit silently refused" (system.ts:174).
- Waits never hold a quit back: RESUME-DESIGN.md section 6 wiring ("runningCount ... does not [count waiting rows], so waits never block quitting").
- Owner decision 5 (RESUME-DESIGN.md:793-795): continue unfinished downloads on start, on by default, 10 s after the first window, only those a quit or crash stopped.

**Edge cases handled**

- Two quick quits: the 10 s `confirmQuit` window.
- A try that was still on its check at quit time comes back as its wait, not "marked to continue" (network.js:285-298).

**Proven by**

restart.js:20-58 (Exit refused, Keep downloading, last-window close, restart "Restart" button, run 2 resumes), network.js:342-391 (setting on/off wording), v-windows.js:66-100 (private prompt), v-keys.js:232-254, v-core.js:116.

---

## Mechanism 14: Keyboard map and the Esc ladder

**What it does**

Everything works without a mouse.

**How it works**

- Global: Ctrl+J toggles the panel (page-first: a page can use it first); Ctrl+Shift+D opens the video quality picker; Alt+click a link downloads it with Deer; Shift+click the video pill downloads the suggested quality at once (design/keymap.json group "Downloads").
- Panel (panel.ts:8-11, 930-961): Up/Down/Home/End move the selection; Enter opens a finished file; Space is the primary verb (Mechanism 5); Delete removes the row ("never the file"); Shift+F10 or the Menu key opens the row menu under the row; Ctrl+F focuses "Search downloads"; Esc and Ctrl+W close the panel (ladder 60), never the tab; Tab is trapped.
- Esc ladder: menu (20) < quick view (30) and quit prompt (30) < panel (60). Each Esc closes one layer (keymap.json rule 11).
- Ring: a stop in the tab bar (Tab from the address field, then Right); Enter opens the quick view; Shift+F10 opens the ring menu.

**Why**

design/keymap.json changes 14 and 27: "Settings and Downloads panels: Esc and Ctrl+W close the panel, not the tab, and Ctrl+J and Ctrl+comma toggle their own panel."

**Edge cases handled**

- Esc in "Add link" or "Use another address…" closes only that field (panel.ts:321-330, 812-821).
- Ctrl+Shift+D five times gives at most one picker (v-rapid.js:84).

**Proven by**

gecko/tests/downloads-verify/v-keys.js (the whole file, 40 checks), ui.js:105-110 (Ctrl+W).

---

## Mechanism 15: Settings that shape downloads

**What it does**

Settings › Downloads has: Location (folder, "Ask where to save each file"), Speed ("Connections per download", "Limit speed"), Restarts ("Continue unfinished downloads when Deer starts"), Expired links ("Find new links on the download’s page").

**How it works**

| Setting | Default | Range | Source |
|---|---|---|---|
| `connections` | 8 | 1-32; menu offers 1, 2, 4, 8, 16 | gecko/src/shared/settings.ts:71; VitreSettings.sys.ts:52; pages.ts:507 |
| `speedLimitKBps` | 0 (none) | menu 0, 256, 512, 1024, 2048, 5120, 10240, 20480 | settings.ts:72; pages.ts:508 |
| `continueDownloadsOnStart` | true | | settings.ts:73; pages.ts:565-580 |
| `renewFromPage` | true | | settings.ts:74; pages.ts:582-598 |
| `askWhereToSave` | false | | settings.ts:70 |

- A file only uses several connections if the server supports ranges **and** the file is at least 8 MiB (`multi`, VitreDownloads.sys.ts:4582). Streams use up to 16 connections, files up to 32 (4624).
- At most **2 downloads run at once**; the rest queue in start order (`MAX_ACTIVE = 2`, VitreDownloads.sys.ts:257, `pump()` 1455-1476). "Start now" puts a row at the head of the queue (`queuedAt = 1`, ~2845).
- Descriptions are plain: "Big files arrive faster in parallel parts"; "Shared by every download"; "Downloads that were running when Deer closed carry on by themselves. Ones you paused stay paused."; "When a link stops working, Deer opens its page out of sight to look for a fresh one. It never clicks, signs in or fills anything in, and the visit stays out of your history."

**Why**

Owner decisions 5, 6 and 7 of RESUME-DESIGN.md (both on by default). IDM-WAY-DESIGN.md 3.12 planned "Connections per site" ("example.com · 2 connections"); the header says it is **not built yet**.

**Edge cases handled**

- A value not in the menu (set elsewhere) is still listed (pages.ts:537, 555).
- A new download uses the connections the setting says (v-pages.js:167: setting 3 → `maxConnections === 3`, peak live ≤ 3).

**Proven by**

engine.js:89-99 (16 MB/s limit: 256 MiB took more than 14.5 s), v-pages.js:160-167, v-rapid.js:95-96 (six started: two run, the rest queue 1..5), network.js (setting off).

---

## Mechanism 16: History lines (every automatic fix leaves a sentence)

**What it does**

When Deer fixes something by itself, the row's details say what and when: "New link found today, 13:02".

**How it works**

`event(rec, text)` keeps the last 5 lines with their time (VitreDownloads.sys.ts:4340-4342); the panel shows the newest (panel.ts:1172-1177). The sentences found in the engine:

- "New link found" / "New link found on its page" / "New link found through yt-dlp" / "Continued from its page" / "Continued from another address" (3794)
- "Continued after restart"
- "Checked after Deer closed unexpectedly · 12 MB fetched again" (or "· nothing was lost") (1546, 1650)
- "The saved part was changed by another program · 1.0 MB fetched again" (1651)
- "The checksum did not match: 1 damaged part fetched again" (1585)
- "Started over: the saved part was moved or deleted" (1610); "Started over: the file on the site changed"
- "Checked: no damage found" / "Checked: 1 damaged part" / "Checked: the file no longer matches its checksum" / "Checked: Deer has nothing to check this file against" / "Checked: the file on the site is different from this one"
- "Repaired 1 damaged part" / "Original restored" / "Repair stopped: the link stopped working" / "Repair stopped: the file was changed after download" / "Restore stopped: …"
- "Partial file kept" / "Keeping the partial video" / "Changed after download" / "Joined · ffmpeg reported: …"

**Why**

RESUME-DESIGN.md section 6: "Every automatic fix leaves one history line in the details note slot." Silent fixes are invisible, so the person cannot trust them; one line is enough.

**Edge cases handled**

- Today and Yesterday are written in lower case inside the sentence ("today, 13:02"); other days "on 30 Sep, 18:02".

**Proven by**

expiry.js:212 ("New link found"), restart.js:117-118, repair.js:175, 205, 244, 248, network.js:257, 357, stream-expiry.js:169, 305, 357.

---

## Mechanism 17: How downloads enter the list (service, take-over, Alt+click, DRM refusal)

**What it does**

Any download a page starts (a link click, `<a download>`, Alt+click, the context menu "Download linked file", Add link, a copied link) becomes a Deer row with Deer's engine. Things only Firefox can fetch go to Firefox and still show as a row.

**How it works**

- The `downloads` service (index.ts:139-180): non-http(s) addresses are refused, except `blob:` and `data:`, which go to Firefox's own "save URL" (only the page's process can read them) and appear in the panel through the take-over mirror (index.ts:159-161).
- Identity: a page-derived address is fetched "as the page's own Save Link As would be": the page's principal, its referrer policy (`rel=noreferrer` sends no Referer), its cookie jar; Deer's own requests (Add link, a copied link) use the page as Referer under the policy (index.ts:9-26, 163-176).
- DRM: "media a protected page plays is never downloaded, whoever asks" (index.ts:167-168).
- Firefox's own downloads are taken over (cancelled in Firefox, restarted in Deer). blob:, data:, POST answers, extension downloads and one-time links stay with Firefox (row `engine: 'browser'`); "Retry" on such a row never fetches again: it asks for its page ("Start it again from its page").

**Why**

design/DESIGN-NOTES.md:15: "Firefox's own downloads are taken over through its Downloads list." RESULT.md recipe correction 4: the adopt step drops an extension's headers/body and auth, so "keep the probe before cancel" and leave such downloads to Firefox. Takeover reasons are saved on the record (takeover.js:90, 142, 152).

**Edge cases handled**

- A page that handles Alt+click itself keeps it (takeover.js:76-78).
- A second download of the same name is saved as "Name (1).ext" (takeover.js:101), Deer's style, not Firefox's "name(1).ext" (RESULT.md correction 4).
- A download another site's page starts is fetched under that page's cross-site cookie rules (no SameSite=Strict cookies) (crosssite.js).

**Proven by**

takeover.js (8 sections), crosssite.js, safety.js:119-143, drm.js, v-rapid.js:100-129.

---

## Mechanism 18: No system notifications (a deliberate choice)

**What it does**

Deer shows no Windows toast when a download finishes or fails. The signals are the ring (arc, pulse, dot, 6 s linger), the live region, the taskbar progress and the history lines.

**How it works**

I found no use of an alerts or notification service in gecko/src/window/modules/downloads or gecko/src/modules/downloads. design/DESIGN-NOTES.md:175 lists "toasts" under "Left out". The quick view shows recent completed rows ("24 MB · Completed").

**Why**

Not written down as a separate decision beyond the "Left out" list. The ring's 6 s linger (owner, 2026-10-01) is the "it finished" signal.

**Edge cases handled**

Not applicable.

**Proven by**

Not tested (nothing to test).

---

## Mechanism 19: The test harness (how the checks are built)

**What it does**

Every downloader behaviour is tested against a **local fake HTTP server** that can misbehave on purpose, with real files and real sockets. Nothing is mocked inside the engine.

**How it works**

- `all.py` (gecko/tests/downloads/all.py:180-284) makes fixtures once (`fixtures.py`), refuses to start if the port is busy ("a stale test server?"), starts `server.py --port 47931 --log requests.jsonl`, and runs each suite in **its own profile** and **its own downloads folder**, with environment variables for port, fixtures, folder, Python and the lock tool. `--layout parts` re-runs every suite with the FAT-style part-file layout.
- Fixtures (`fixtures.py`): `big.bin` 256 MiB and `medium.bin` 24 MiB of **seeded pseudo-random bytes** (seeds 1157 and 2026), so every file has a known sha256 in `manifest.json`. With ffmpeg: a 24 s 640x360 h264+aac clip; HLS TS 360p + AES-128 180p with 2 s segments (12 segments); fMP4 HLS with a separate audio rendition; DASH SegmentTemplate+SegmentTimeline; a Widevine SESSION-KEY master and a DASH ContentProtection manifest (both must be refused); a live playlist without ENDLIST.
- The server records every request (`record()`, server.py:344-356): time, path, client **port** (so a test can tell connections apart), `Range`, `If-Range`, `Cookie`, `Referer`, `Origin`, `Accept-Encoding`, User-Agent, status, and after the body: bytes `sent` and `secs`. `/stats` returns the log plus the **peak number of concurrent body transfers** and `cappeak`. `/reset` clears it (flags survive).
- Behaviour switches: query knobs on each route (`rate=` KB/s **per connection**, `fail=A-B`, `reset=`, `stall=`, …) and **flags** set at run time with `/flag?k=KEY` (the file changes, the token dies, the network drops) — so a test can change the server's mind in the middle of a download.
- What tests assert: the final sha256 equals the fixture; exact request counts and ranges from `/stats` ("bytes on the wire = the file size"); the gaps between retries from request timestamps; that the `.part` is untouched (sha256 before and after); the engine's view (`state`, `need`, `wait`, `history`); the UI's text and aria labels; captures compared with the boards.
- Input is synthesized inside the browser (trusted clicks in pages through a frame script), never OS input (lib.js:6-7).
- Big-file addresses have no file extension because IDM on the test machine hijacks requests from `firefox.exe` (server.py:214-215; RESULT.md risk 1); `idm_guard.py` closes IDM dialogs about the test server after each run.
- Each test file can run only some sections (`VITRE_DL_ONLY=a,b`).
- The verifier (`tests/downloads-verify/all.py`) re-runs the builder's suites under its own names and port, plus its own suites, plus `vserve.py` (edge cases) on the next port. A separate person ("verifier") wrote those, to catch what the builder did not think of.
- Phase rules (RESUME-DESIGN.md section 7): "Run the full tests/downloads/all.py before and after"; "run the suites at the same time with distinct --name values, to expose races"; "A control test proves that a resume of an unexpired, unchanged download makes the same number of requests as today".

**Why**

Real servers cannot be made to fail on cue. The request log lets the tests check *what Deer asked*, not only the end result: e.g. "the resume fetched only what was missing", "each time on a new connection (another port)".

**Edge cases handled**

- `settledStats(wait = 3000)` waits (polling every 50 ms, at most 3 s) until every body transfer has written its `sent` count (lib.js:49-61): "byte-count checks raced the server when a download finished quickly" (review of Phase 5).
- The stand-in yt-dlp writes its call log per run so two runners in parallel never share it (`VITRE_FAKE_YTDLP_LOG`, all.py:256-257).

**Proven by**

The suites themselves; commit messages report counts ("All 22 download suites pass (711 checks)", 52b75cf).

---

## Mechanism 20: THE TEST SUITE AS A CHECKLIST

This is the most useful part for TitleLess. Each row: what the fake server does (and the route/knob that does it), and what the downloader must do. File references are to gecko/tests/downloads/ unless named. "Must" lines are the test's own assertion, with its numbers.

How to read a knob: `/blob/big?rate=2048&fail=96MiB-128MiB&failn=4` means "serve big.bin at 2048 KB/s per connection; the first 4 requests whose Range starts between 96 and 128 MiB get a 500".

### A. Plain transfers and many connections

| ID | Server behaviour (route) | Expected downloader behaviour | Test |
|---|---|---|---|
| A1 | 256 MiB with Range and ETag, 4 MB/s per connection (`/blob/big?rate=4096`) | 8 connections receive at once, each on its own socket; server peak ≥ 8 bodies at once and ≥ 8 client ports; **bytes on the wire = file size** (no overlap); every ranged request carries the page as Referer; no .part left; sha256 equal | engine.js:19-61 |
| A2 | Pause at 60 MB, then resume | Pausing stops every connection (server `active == 0`); bytes and segments kept; after resume **every request carries If-Range**; the resume's first request is `bytes=0-65535` (a proof window riding on the probe); only missing bytes fetched; sha256 equal | engine.js:63-87 |
| A3 | Global speed limit 16 MB/s on 256 MiB | Never faster than the limit: took > 14.5 s (and < 40 s); file intact | engine.js:89-99 |
| A4 | Setting "3 connections" | `maxConnections === 3`, never more than 3 live | downloads-verify/v-pages.js:160-167 |
| A5 | Six downloads started at once while one slow download already runs | Only one of the six runs (the slow one holds the other slot: `MAX_ACTIVE = 2`); the other 5 queue in order 1..5. (ui.js:42: with two running, the third is `queued` with `queuePos === 1`.) | downloads-verify/v-rapid.js:89-96; ui.js:42 |
| A6 | Pause then Resume before connections closed; Pause Resume Pause; Space Space | Last word wins; file intact | downloads-verify/v-rapid.js:20-50 |
| A7 | First request of a fresh download | Deer asks `bytes=0-0` first (size, range support, validators before any other connection); a resume asks `bytes=0-65535` | IDM-BENCH.md "Not copied"; takeover.js:45 filters `bytes=0-0` |
| A8 | Redirect (`vserve /redirect` → `/blob/medium`) | Followed; intact | downloads-verify/v-pages.js:139 |
| A9 | Empty file (`vserve /zero`, Content-Length 0) | Completes as `empty.txt`, 0 bytes on disk | v-pages.js:113-114 |
| A10 | Chunked, no length, no Range (`vserve /chunked`, 3 MiB) | Ring turns indeterminate; completes with total 3 MiB | v-pages.js:119-121 |
| A11 | 404 with an HTML body (`vserve /missing`) | Failed with a readable reason ("The file is no longer there (404)."), row offers Retry | v-pages.js:125-128 |
| A12 | Server never answers (`vserve /hang`) | Row reads "Starting"; Pause and Cancel stop it within 1.5 s and close the socket | v-pages.js:72-90 |
| A13 | Server sends 1 MiB then stalls with socket open (`vserve /stall`) | Speed falls below 1 KB/s, ETA -1 ("—"), Pause stops at once keeping bytes, every socket closed | v-pages.js:97-107 |
| A14 | Name tries to leave the folder, reserved characters (`vserve /evilname`) | Saved inside the downloads folder, no `\ / : < > \| ? * "` in the name | v-pages.js:133 |
| A15 | RFC 5987 UTF-8 name (`vserve /unicode`) | Name "résumé — final.pdf" | v-pages.js:136 |
| A16 | Two downloads of the same name at once | Two files, both intact | v-pages.js:147 |
| A17 | Downloads folder that can't be created | Failed with a readable reason about the folder | v-pages.js:156 |
| A18 | Server would compress | Deer always sends `Accept-Encoding: identity` ("Ranges count bytes of the stored file: never let the server compress", net.ts:358-359). **No test serves gzip anyway.** | (not tested) |

### B. One connection misbehaves while the others work (connections.js, IDM comparison 2026-10-20/21)

Constants behind these (other study sections cover them): `STEP_MS = 4000` (retry.ts:25), `AT_ONCE_MS = 10` (retry.ts:24), `HOLD_AFTER_MS = 10000` (retry.ts:30), `GLOBAL_RATE = 150` asks/s (retry.ts:28), `TICK_MS = 2000`, `STALL_TICKS = 5` (10 s), `SLOW_TICKS = 8` (16 s), `SLOW_SHARE = 0.25` (ranged.ts:137-140).

| ID | Server behaviour | Expected | Test |
|---|---|---|---|
| B1 | 256 MiB, rate 256 KB/s | The `.part` is **sparse** while downloading (Windows attribute 0x200) | connections.js:87-98 |
| B2 | One region (96-128 MiB) answers **500 four times** (`fail=…&failn=4`) | Completes, **never pauses**; that spot asked again after ~4, 8, 12 s (each gap within ±0.8 s of 4·i), **each time on a new connection** (another port); the other seven never cut; the finished file is **not sparse** | connections.js:100-121 |
| B3 | One region's first answer crawls at 16 KB/s, others 1 MB/s (`slow=…&slowrate=16`) | The crawler is cut and asked again within 26 s on another connection; the new request starts where the slow one stopped | connections.js:123-136 |
| B4 | One region is **reset (TCP RST) after 2 MiB, three times** | Completes, never paused; each reset followed by the next ask **within 0.5 s** ("it used to be 2 s"); diagnostics count ≥ 3 resets | connections.js:138-149 |
| B5 | Every 206 is **capped at 8 MiB** (`capresp`), a clean but short answer | Never a failure or a wait; on each connection the next ask follows within 0.5 s; ≥ 32 answers | connections.js:151-161 |
| B6 | Slow line 128 KB/s per connection; one connection goes **silent** after 512 KiB; another crawls at 8 KB/s | Silent one cut after ~10 s (< 16 s; "the idle timeout took 30 s"); crawler cut; completes | connections.js:163-173 |
| B7 | Control: every connection an even 96 KB/s | **Never cut**, no reconnects (the slow rule compares with the median, not a fixed speed) | connections.js:175-179 |
| B8 | One region answers **520 (Cloudflare origin error) four times** | Never paused ("a 520 used to stop all eight"); server-failure count ≥ 4, no connection retired | connections.js:181-187 |
| B9 | One region: first answer cut after 2 MiB, next two asks get **404** while the others receive | Never pauses as Link expired; that connection **stands by** and asks again on the site-error gaps; others take its part; completes | connections.js:189-196 |
| B10 | One answer sends its **head at once and its body 16 s later** (`bodydelay`) | **Not** cut as a stall or as slow; no reconnects (the slow and stall rules start counting at the first body byte) | connections.js:198-202; fixed in e90608e |
| B11 | **Outage**: every connection cut after 1 MiB, then **502 on every ask** | Reads "Retrying" (paused, wait 'server') within ~12 s (< 16 s) **while its run keeps asking**; each connection on 4 s steps; 8 to 36 asks in 30 s; still Retrying, never Failed | connections.js:220-233 |
| B12 | Every connection cut, then **404 on every ask** | Row pauses as **Link expired**, never Failed; not all connections retired (≤ 7) — the last one reports the refusal | connections.js:235-244 |
| B13 | Disk room: fresh 256 MiB sparse download, then a second download, then a resume | Room check: a fresh one needs the whole file; a second download also counts what the first's .part **does not hold yet** (counted once); a resumed sparse .part counts what it does not hold | connections.js:246-278 |
| B14 | Site allows **3 bodies at once**, 503 for the rest (`cap=3`) | Completes intact, never paused; server's peak = exactly 3; the turned-away connections stand by (≥ 5 standbys) and keep asking in a bounded number of asks (5-80); they get in as places free up | connections.js:280-289 |
| B15 | One region: 500 with **Retry-After: 12** | That spot not asked again before 11.8 s; completes, never paused | connections.js:291-297 |
| B16 | **Cloudflare challenge** (503, `cf-mitigated: challenge`, HTML "Just a moment...") on every ask mid-run | Stops at once as **Link expired** (not Retrying); no challenged ask more than 2 s after the first | connections.js:299-311 |
| B17 | **300 resets before any byte**, then 8×503, then served | Completes within ~4 s of its last 503 (< 40 s total): the 503's gap counts only 503s, never the resets ("review: the next wait was hours") | connections.js:313-322 |

### C. Files that change, and validators you cannot trust (integrity.js, expiry.js, repair.js)

| ID | Server behaviour | Expected | Test |
|---|---|---|---|
| C1 | Control: resume of an unchanged file, one connection | Exactly **2 requests** (the probe `bytes=0-65535` with If-Range, then one range from the saved end); without Range support exactly **1** (the probe's answer is the download); no `.part.new` left | integrity.js:172-196 |
| C2 | File **swapped during a pause** (same size, other bytes, other strong ETag) (`/swap?val=etag` + flag) | **File changed** (paused, need 'choice', evidence "its first bytes are different"); `.part` sha256 unchanged; nothing fetched after the probe (its 200 to If-Range carries window 0, which differs) | integrity.js:254-267 |
| C3 | File swapped **mid-download** (connection cut after 1 MiB, the next request finds the new file) | File changed once a window shows other bytes; **every saved byte is the old file's** (nothing mixed) | integrity.js:222-233 |
| C4 | **Same bytes under a new ETag** (a redeploy), during a pause and mid-run (`same=1`) | Proven by 2-4 windows, carries on, completes intact; after the proof every range carries the **new** ETag; only missing bytes fetched | integrity.js:235-244, 309-322 |
| C5 | **Weak ETag** + Last-Modified, then the date changes | If-Range carries **Last-Modified** (a weak ETag can't be used); File changed; .part intact | integrity.js:269-281 |
| C6 | ETag **dropped** while Last-Modified changes, server **ignores If-Range** (always 206) | File changed; only the probe's window fetched | integrity.js:297-307 |
| C7 | **No validators** at all, same size, swapped | File changed; only the probe asked | expiry.js:294-306 |
| C8 | `/edge`: **a new ETag on every answer** (another CDN edge each time), stable Last-Modified | Completes with no restart, probed once, nothing thrown away; after **two proofs** the ETag is no longer trusted and If-Range uses Last-Modified | expiry.js:240-261 |
| C9 | `/flap`: two backends taking turns, **each with its own ETag and Last-Modified** over the same bytes | Completes, never File changed; after two proofs **neither validator is trusted** (no If-Range); the resume compares ≥ 2 windows past window 0 before carrying on | expiry.js:265-290 |
| C10 | `/tail`: bytes change **after the first 64 KiB** (same size, If-Range ignored), download paused early with < 64 KiB per segment | Over 1 MiB saved: File changed, `.part` untouched, only probe + windows asked. Under 1 MiB: starts again by itself and completes as the new file, never a mix | expiry.js:309-347 |
| C11 | `/whole`: a 40 KiB file whose server answers a Range over the whole file with **200** | Resume makes 2 requests (probe one byte short `bytes=0-40958`, then the rest) | expiry.js:352-367 |
| C12 | `/morph`: unknown length (chunked, no Range), then the address takes ranges (same ETag) | Completes intact, fetching only what was missing | integrity.js:326-342 |
| C13 | Known total, resume answer has **no total** (`Content-Range: bytes a-b/*`) and turns out shorter | File changed with evidence "was 24 MB, now 8.0 MB"; .part untouched | integrity.js:344-353 |
| C14 | Unknown length, then the address gives **fewer bytes** than saved (206 with smaller total, or 200 with smaller length) | File changed, `.part` untouched, row still builds (this case used to cut the .part and **hang the main thread**) | integrity.js:529-553 |
| C15 | **Content-MD5** right / wrong (no Range) | Right: completes. Wrong: fails with "The finished file doesn’t match the server’s checksum." | integrity.js:453-461 |
| C16 | One byte of block 5 sent wrong once, with `Repr-Digest: sha-256=…` of the true file (`/corrupt-once`) | The checksum fails at the end; every block matched its record (hashed as it arrived), so blocks are compared with the site and **only block 5** replaced; intact | repair.js:209-217 |
| C17 | Link valid for **one full download**, no strong validator (`/vary?full=1`) | Completes once every byte is in; the completion check can't compare (403, asked once) and does not stop it | repair.js:338-348 |
| C18 | File < 1 MiB, no validators, **changes while downloading** | The completion check sees it, starts again by itself, completes with the new file | repair.js:353-365 |
| C19 | Start over while **another program holds the .part open** | Nothing moved or emptied; row still asks, saying "Another program has the saved part open" | integrity.js:429-439 |
| C20 | Start over when `<name>.old.part` already exists (the person's own file) | Never touched; the old partial goes to `<name>.old (1).part`; Cancel removes only what it kept | integrity.js:283-295 |
| C21 | After Start over | The old partial is kept as `<name>.old.part` until the new file is complete, then deleted | integrity.js:441-448 |

### D. Expired and signed links (integrity.js, expiry.js, attach.js, resolve.js)

Renewal schedule: attempts at 0, then 2 min, then +13 min (15 min), +45 min (1 h), +300 min (6 h) (`SCHEDULE`, renew.ts:58).

| ID | Server behaviour | Expected | Test |
|---|---|---|---|
| D1 | Address now answers a **200 web page** or a **302 to a web page** | Never completed; **Link expired**; `.part` intact; received unchanged | integrity.js:357-376 |
| D2 | **403 with S3 "Request has expired" XML**, or **410** | Link expired with `need.status` 403 / 410; bytes kept | integrity.js:377-384 |
| D3 | HLS segment answered with a web page (TS and AES-128) | Never written (track holds only whole 188-byte TS packets); Link expired if bytes saved, else failed | integrity.js:463-493 |
| D4 | AES-128 segments **labelled text/html** by the CDN, one ciphertext starting with `<` | Completes (content type alone never decides) | integrity.js:495-526 |
| D5 | Signed URL (`/sign` → 302 → `/signed/<tok>`) **expired during a pause** | On Resume the **original address is asked first**, the dead one never; continues from its segments; only missing ranges; history "New link found" | expiry.js:196-212 |
| D6 | Token expires **mid-run on 8 connections** (server cuts them) | **Exactly one** request to the original address; row reads "Renewing link" meanwhile; nothing fetched twice | expiry.js:216-236 |
| D7 | New address passes the proof but **refuses the transfer** (`uses2`) | Link expired, next try in 2 min; then the schedule carries on (next try **13 min** on, not 2 again) | expiry.js:370-391 |
| D8 | `/signed-once`: the original address dies too | Link expired, status 403, next try in ~2 min, original asked once; Retry right away asks it again once; requests carry the page's Referer and Origin | expiry.js:414-428 |
| D9 | Restart with a Link expired row | Schedule survives (tries and next time); the attempt that fell due asks once; next 13 min on; a version-2 store read by version-1 rules gives "paused" | expiry.js:156-174 |
| D10 | Refresh address, original still dead | Opens the page in a new foreground tab, arms the row for **30 minutes** ("Waiting for link"), note under the tab pill "Start song.mp3 again on this page. Deer continues from 62%." with Stop waiting | attach.js:149-175 |
| D11 | The person clicks the download on that page | Continues **the same row**: no new row, no flight, one `attached` event; Firefox's copy gone; no " (1)" file; only missing ranges; history "Continued from its page" | attach.js:177-199 |
| D12 | Alt+click, or Add link with a fresh address of the same path and name | Same: continues the waiting row (Add link selects it); pasted address asked with no Referer | attach.js:202-247 |
| D13 | Unrelated download, or **same name on another page**, or another file behind the same script (`/fetch?f=`) | Makes its own row; the waiting row untouched | attach.js:252-267, 429-510 |
| D14 | **Same name, other bytes** clicked on the page | Old row becomes File changed (no new row); Start over downloads the new file from the clicked address | attach.js:270-290 |
| D15 | Real file changed with **< 1 MiB saved** | Starts over by itself, no question (owner decision 1), keeping `.old.part` until done | attach.js:514-532 |
| D16 | A click in **another container** | Never continues the default container's row; closing the armed tab does not stop the wait; after 30 min it lapses back to Link expired | attach.js:327-356 |
| D17 | Private window | Refresh address opens the page in the private window; click continues; row **never written** to the store or its .bak | attach.js:389-414 |
| D18 | Hidden **page step**: page has a fresh link | Renewed within 30 s ("Renewing link"), page opened once out of sight, tab strip and closed-tab list unchanged, no flight, not in history; only missing ranges | resolve.js:141-180 |
| D19 | Page **starts the download by itself** | Claimed for the row (no row, no flight, Firefox's copy and its history gone), proven | resolve.js:183-203 |
| D20 | Page whose link needs **a click** | Falls back within 45 s to Link expired; the page is **never clicked** | resolve.js:206-221 |
| D21 | Page with a **password field**, or one that **redirects to another site** | "The page may need you to sign in." (need 'page'); saved logins never filled into the hidden page; Open page arms the row | resolve.js:225-293 |
| D22 | Seven expiries on one site in an hour | Six page steps; the seventh waits for the hour | resolve.js:362-387 |
| D23 | Another file **of the same name and size** listed above the row's own | Search continues; the row completes from its own file; that file alone → File changed (asked even under 1 MiB) | resolve.js:518-544 |
| D24 | Hidden page autoplays / opens pop-ups / downloads from a frame it removes | Muted always; pop-ups get no window; the frame's download is still claimed | resolve.js:549-670 |

### E. Network loss, sleep, restarts and crashes (network.js, restart.js, verify)

Waits: network and server waits try again every **30 s** (`QUEUE_RETRY`, waits.ts:25), never give up (`SERVER_GIVE_UP = Infinity`, waits.ts:29), Retry-After honoured up to 24 h; link-up or wake brings the next try within 5 s (`SOON`); after a wake, continue on link-up or 10 s later (`WAKE_SETTLE`); continue after start 10 s (`CONTINUE_AFTER`).

| ID | Server behaviour | Expected | Test |
|---|---|---|---|
| E1 | Network **drops** for 30 s (`/drop`: every connection reset, new ones refused) | "Waiting for network" within ~11 s (≤ 12.5 s), never Failed, **while the run keeps asking** (≥ 20 asks in the drop); every segment claims exactly the bytes in its .part; row shows "—" for speed and time, caption "Continues when the connection is back", verb Try now; ring "Downloads, 1 waiting, N percent"; waits never hold a quit back | network.js:398-433 |
| E2 | Network back | Continues by itself within ~3 s, after proving **one** saved window; only missing bytes fetched | network.js:446-453 |
| E3 | Resume whose check is slow (`/slow`, +1.5 s) | First 400 ms: dimmed bar at old %, no word ("never Starting"); after 400 ms: "Checking", caption "Checking the saved part and the link" | network.js:456-476 |
| E4 | Browser **offline** (connections cut) | Waiting for network; **no request reaches the server** while offline (asks once every 30 s, not at once); back online: asks at once, receives within 5 s | network.js:479-511 |
| E5 | **503 for 90 s** | "Retrying · in N s" counting down; caption "The site had a problem (503). Trying again at HH:MM"; never Failed; first run asks 3 times, each later try once | network.js:514-546 |
| E6 | 503 with **Retry-After: 3600** | Stops at the first answer; next try ~3600 s away; nothing asked between; Try now completes it | network.js:549-561 |
| E7 | 503, then dropped, then 503 again | **One count** (try 1, 2, 3), next tries 30 s apart, the 503 clock kept; after 24 h still Retrying, never Failed | network.js:564-591 |
| E8 | Blocked port, **redirect loop** (`/loop/a`↔`/loop/b`), **two disagreeing Content-Length** headers (`/dupcl`) | Fail as before ("The connection was lost."), never Waiting for network | network.js:595-606 |
| E9 | Computer **sleeps** | Running download pauses into wait 'sleep' (store says so, segments exact); after wake continues ~10 s later (9-13 s) through its resume probe; a network link-up after wake continues at once (< 2.5 s) | network.js:610-646 |
| E10 | Pause all with a waiting row | Waiting counts as under way ("1 waiting", Pause all enabled); Pause all ends the wait (plain Paused) | network.js:649-663 |
| E11 | Quit while running, restart | What the quit stopped continues ~10 s after start (9.5-14 s), "Continued after restart"; what the person paused stays paused; setting off: both stay paused and the prompt says "Resume it from Downloads" | network.js:342-391; restart.js; downloads-verify/v-restore.js |
| E12 | **Hard kill** (all processes terminated) during a download | Last session read as unclean; row comes back paused, marked dirty; only damaged blocks below each mark fetched again (not 8 MiB per segment); history "Checked after Deer closed unexpectedly · N MB fetched again" | network.js:216-266 |
| E13 | Hard kill around a stream's merge (before ffmpeg, after merge before save, after move before cleanup) | Completed from the output, or merged again from parts; **nothing fetched again**; no " (1)" copy | network.js:144-212 |
| E14 | Power loss: dirty mark set, no seal, 3 MiB of zeros under the claims | Zeros found, those blocks fetched again from each segment's start; intact | restart.js:82-120 |
| E15 | Store corrupt with a version-1 `.bak`; both unreadable | Loads from `.bak`; both unreadable: set aside as `.corrupt`, rows rebuilt from the per-download journals | integrity.js:97-168 |

### F. Disk and file layout (faults.js, layout.js, repair.js)

| ID | Situation | Expected | Test |
|---|---|---|---|
| F1 | Another process **locks a byte range** of the .part for 8 s (disk refuses writes) | Stops within 6 s with a **disk** sentence (never "connection"); bytes kept; **nothing retried** while the disk refuses; journal sealed; every recorded hash matches the .part; after the lock, resumes and completes; only unsaved bytes fetched | faults.js |
| F2 | NTFS volume | One sparse `.part` in place | layout.js:42-51 |
| F3 | exFAT/FAT32 (forced or faked volume info) | `<name>.part` + `<name>.parts\<start in hex>.part`, each written only at its end; after the last byte, joined in order ("Saving"), no folder left, not sparse; pause/resume, Keep partial, Cancel all work under parts | layout.js:53-155 |
| F4 | FAT32 and a file of 4 GiB | Refused **before anything is written** with a sentence naming FAT32; exactly 4 GiB − 1 is accepted | layout.js:157-178 |
| F5 | Bytes changed by another program during a pause | Only that block fetched again (one exact range); history says so | repair.js:154-182 |
| F6 | `.part` deleted during a pause | Starts over without asking, "Started over: the saved part was moved or deleted" | repair.js:186-205 |
| F7 | Silent damage in a finished file | Check file finds "1 damaged part" (Damaged, red, bar stretch emptied); Space = Repair fetches one block; "Repaired 1 damaged part" | repair.js:223-248 |
| F8 | Damaged file, and the site's file changed | Repair refuses, writes nothing, offers Download again | repair.js:252-267 |
| F9 | Finished file edited by the person | "Changed after download" (normal colour, never Damaged); Restore original only when chosen | repair.js:272-296, 395-419 |
| F10 | Repair cut by quit or crash | Never reads as "Changed after download"; next start re-checks | repair.js:423-452 |
| F11 | **Disk full** | Sentence "The disk is full." exists (net.ts:916) and a room check runs before the first byte (B13), but **no test fills a disk** | (not tested) |

### G. Streams: HLS, DASH, yt-dlp (streams.js, stream-expiry.js, ytdlp.js, drm.js, noffmpeg.js, embed.js, spa.js, mark.js)

| ID | Server behaviour | Expected | Test |
|---|---|---|---|
| G1 | HLS master with 360p + 180p (AES-128) | Picker lists both with "Best for this screen"; 180p downloads, decrypts, remuxes to .mp4 (h264+aac, 24 s); no part files left | streams.js:30-71 |
| G2 | fMP4 HLS with a separate audio rendition | One MP4 with video and sound, 24 s | streams.js:73-79 |
| G3 | DASH SegmentTemplate+Timeline, video + audio | Best video joined with audio into MP4 | streams.js:81-88 |
| G4 | One segment's first request crawls (`/hedge`: 8 KB/s for seg005) | Raced by a second request; stream does not wait (< 15 s) | streams.js:90-98 |
| G5 | Segment URL token expires at seg003 (`/token`) | Playlist re-read, segment fetched from the fresh playlist (matched by media sequence) | streams.js:100-109 |
| G6 | Variant token expires during a pause (`/vod-sign`) | Master re-read, same rung re-picked, proof fetches the last written segment once and compares its hash; continues at the next sequence; nothing earlier fetched again | stream-expiry.js:138-171 |
| G7 | Same count of segments **re-encoded** (`/vod-reenc`) | File changed (> 1 MiB saved); part untouched; Keep partial "Keeps 0:14 of 0:24" merges what is written | stream-expiry.js:174-209 |
| G8 | DASH representations **renamed** (old addresses 404) | Matched by attributes, continues; renamed **and** re-encoded mid-run → File changed | stream-expiry.js:212-233, 508-544 |
| G9 | Damaged middle segment on disk | Only that segment fetched again and written back in place | stream-expiry.js:262-306 |
| G10 | Every segment written, addresses since expired | Merges at once, asks nothing | stream-expiry.js:309-335 |
| G11 | Joined video length differs from playlist (> 2% or 2 s) | Says so in the note ("The saved video is 0:24 long; the stream is 0:48") | stream-expiry.js:361-370 |
| G12 | Playlist now lists only 6 of 12 segments; Repair | Refuses, file unchanged | stream-expiry.js:485-505 |
| G13 | HLS byte ranges over one file with flapping / per-answer ETags | Completes (headers never decide alone); swapped file → File changed by its bytes | stream-expiry.js:577-626 |
| G14 | Init segment 404 on resume | Link expired, part untouched, never a media segment used as init | stream-expiry.js:630-646 |
| G15 | First start whose playlist refuses | Asked 3 times, then failed; yt-dlp never run | stream-expiry.js:747-767 |
| G16 | Broken playlist ("this is not a playlist") | Mark lights; click says "Can’t save this video" | mark.js |
| G17 | Live playlist (no ENDLIST) | Pill "Live · can’t be saved" | ui.js:150-156 |
| G18 | DRM page (ClearKey EME), Widevine SESSION-KEY master, DASH ContentProtection | No mark, "Protected video", no picker, service refuses the page's media, engine refuses both manifests ("protected") | drm.js; v-rapid.js:100-129 |
| G19 | Embedded player whose CDN refuses any Referer but the player's (segments labelled image/jpeg) | Asked as the tab first (403), then as the player's frame; download goes out as the frame; source stays the tab's page | embed.js |
| G20 | Single-page site moves to next video with pushState | Old streams forgotten, new one offered, no reload; a #fragment change keeps streams | spa.js |
| G21 | No ffmpeg | Picker says "ffmpeg not found"; fMP4+audio kept as two files; TS stays .ts | noffmpeg.js |
| G22 | yt-dlp: unchanged resume / gone format / changed filesize / estimate changed / 403 refused | Same format continues with `--continue`; gone format with < 1 MiB re-picked and restarted silently, > 1 MiB asks; changed size → File changed; refused → Link expired with schedule; never cookie options | ytdlp.js |

### H. Safety, identity and UI (safety.js, takeover.js, crosssite.js, ui.js, verify suites)

| ID | Situation | Expected | Test |
|---|---|---|---|
| H1 | Server names `evil.scf`, `doc.lnk`, `site.url`, a bidi override, `desktop.ini` | `.download` appended to dangerous ones; bidi override becomes `_`; caller-chosen names validated too | safety.js:34-44 |
| H2 | Reputation says dangerous / uncommon / safe | Dangerous: deleted, failed with reason; uncommon: kept aside as `.blocked`, "Keep file" restores it (note "warned"); removing the row deletes the waiting file | safety.js:46-98 |
| H3 | Opening a `.bat` | Asks first (nothing launched when answered no) | safety.js:100-117 |
| H4 | `rel=noreferrer` link (service and Alt+click) | No Referer on any request | safety.js:119-143 |
| H5 | Attachment needing the page's cookie and Referer (`/dl/report`) | Deer's ranged requests carry both; page does not navigate; Firefox's list and scratch folder empty; MotW written | takeover.js:26-53 |
| H6 | Private window download | Only listed in private windows, never written to disk, dropped when the last private window closes | takeover.js:103-116; v-windows.js |
| H7 | Every row state | Exact words, captions, verbs, aria labels; access keys unique per menu | ui.js |
| H8 | Panel at 640x480 and 480x360 | Scaled whole, no overlapping or cut text | safety.js:145-185 (checks at 182) |
| H9 | 150% scaling, page zoom | Every surface keeps its CSS size and place | v-scale.js |
| H10 | Idle | Engine ticker stopped; parent process under 3% of a core, also with a paused download | v-rapid.js:131-166 |
| H11 | Whole run | No console errors from Deer | every verify suite |

### How to turn this into XCTest for TitleLess

These are suggestions, not things Deer did on iOS.

- Reuse `server.py` as it is. It is plain Python `http.server` with no Windows code (the Windows-only parts are in the tests that call it). An XCTest in the **iOS Simulator** can reach a server on the Mac at `http://127.0.0.1:<port>`. For a real device, bind to the LAN address. App Transport Security blocks plain http by default; the test host app needs an exception such as `NSAllowsLocalNetworking` (unverified that it covers every case).
- Port `fixtures.py` (seeded random `big.bin` / `medium.bin`, ffmpeg-made HLS/DASH) to a test pre-step; keep the sha256 manifest.
- Assert like Deer does: read `/stats` after each download and check ranges, `If-Range`, client ports, bytes sent and timings; never only "it finished".
- `URLProtocol` stubs cannot make real TCP resets, stalls or "head now, body in 16 s". Use the real server for those (B4, B6, B10, A13, E1).
- Keep the **control test** (C1): an unchanged resume must make exactly the same requests as before your change.

**Why**

Each row exists because of a bug, a bench result or a design rule; the commit and doc for each are in the timeline below.

**Edge cases handled**

See each row.

**Proven by**

The files named in each row.

---

## Mechanism 21: Dated timeline of downloader decisions and fixes

Git holds only the Deer era (from 2026-10-05). The downloader itself is older: it began as a port of the owner's **Swift downloader ("titleless-downloader")**, through an Electron TypeScript port, to Gecko (design/DESIGN-NOTES.md:15; RESUME-DESIGN.md calls it "REF ... reference/titleless-downloader/Sources"). I did not open that code.

| Date | Commit / document | What changed | Why |
|---|---|---|---|
| 2026-10-01 | design/DESIGN-NOTES.md:177 | The downloads ring shows over web pages (not only Home) while a download runs; hides 6 s after the last finishes | "so menu and Peek downloads have somewhere to fly" (decided with the owner) |
| 2026-10-02 | DESIGN-NOTES.md:13, 15 | Engine changed from Chromium/Electron to Gecko. Downloader ported to Gecko system modules on Necko; **one network partition ("lane") per connection** gets past Necko's 6-connections-per-host cap and HTTP/2 sharing; cookies, container and private state come from the tab | Owner: Firefox add-ons and their request-blocking API |
| before 2026-10-05 (undated) | gecko/spikes/downloader/RESULT.md | First spike: 256 MiB on 1-32 connections, correct sha256 every time; 8 MB/s on one throttled connection, 204.5 MB/s on 32; main-thread stalls 2-14 ms. Gotchas: headers set with `setRequestHeader` are lost on redirect (re-apply in the redirect sink); Necko trims a same-origin Referer under the system principal (compute it yourself); a suspended channel never ends after cancel (resume it as often as suspended); pipe segment 4 kB → 256 kB; window timers stop under a modal prompt (use module timers); a cut body is `NS_ERROR_NET_PARTIAL_TRANSFER` (retryable). Corrections: per-connection lanes instead of a global pref; **disk errors are never retried and always read as a disk problem**; keep the Range probe before cancelling Firefox's download | Proving the port worked before building it |
| 2026-10-04 | DESIGN-NOTES.md:3 | Vitre renamed Deer (internal names keep "Vitre") | |
| 2026-10-05 | 5557e72 | Deer 0.1.0: "download manager with video downloads" | First release |
| 2026-10-06 | 043f5e8 | Deer 0.1.2: embedded players whose server serves only the player. Ask as the tab's page first; only on a 4xx **and** an embedded player from another site, ask again as the player's frame (`Identity.requestPage`) | Real case: www.1flex.org embedding www.viduki.net, whose HLS CDN answers 403 to any other Referer. Test embed.js with a control that must go out "exactly as before" |
| 2026-10-12 | gecko/spikes/downloader/RESUME-DESIGN.md | Resume system designed (four readers, three designers, one synthesis) | Expired links failed for good; a link answering with a web page could replace a half-downloaded file and mark it Completed |
| 2026-10-13 | RESUME-DESIGN.md status line | Approved by the owner, "all recommendations as written"; Start over keeps `<name>.old.part` until the new file completes (decision 2) | |
| 2026-10-14 | 13f9783 | Phases 1-2: an expired link (page, 401/403/404/410/451, expired-signature 400) pauses as **Link expired** with its bytes; a changed file stops as **File changed** above 1 MiB, restarts by itself below (at most twice in 10 minutes); `probe()` decides before touching saved state; store version 2 with a flushed `.bak`; Content-MD5 fixed (IOUtils rejected md5); 64 KiB proof windows; renewal from the original link and its redirect hops at 2 min, 15 min, 1 h, 6 h; unstable ETag/Last-Modified across a server farm no longer reads as a changed file; "Use another address…" | Phase 1 "never lose or mix bytes"; Phase 2 "same-file proof, renewed links". Tests integrity.js (54), expiry.js (42); 315 checks |
| 2026-10-14 | 3e7f908 | Phase 3: Refresh address (renew at once; else open the page and wait 30 minutes: "Waiting for link"); a re-click attaches to the waiting row after the byte proof (one row, no " (1)"); Keep partial file → `<stem> (partial).<ext>`; rows Firefox moved are never renewed automatically; **UI**: Waiting for link, "N need attention", the ring dot and live region, From page as a button, access keys unique per menu | G1 manual fallback. 405 checks |
| 2026-10-14 | ccd71a9 | Phase 4: self-healing network errors pause as "Waiting for network" (retries at 10 s, 30 s, 1, 2, 5 min, then every 10 min); 5xx/429 "Retrying" honouring Retry-After, failing after 24 h; sleep pauses and continues after wake; quit marks what it stopped; new setting "Continue unfinished downloads when Deer starts"; unclean exit detected; Checking state; Try now; waits never block quitting | G4 "restarts, sleep and lost internet". network.js (83 checks) |
| 2026-10-14 | 31eed88 | Phase 5: block hash record (`ledger.ts`, blocks of clamp(total/2048, 1-64 MiB), SHA-256 of 1 MiB chunk hashes cut to 128 bits + 64 KiB head hash), journal per download, seals every 30 s / 256 MiB and at pause/quit/sleep/disk error, real `FlushFileBuffers`; Check file, Repair, Restore original, Damaged, Changed after download | Find damage after crashes; fetch only bad blocks. repair.js (70 checks) |
| 2026-10-15 | 6c03bb8 | Phase 6: stream segment table; continue by media sequence or time, never by position; stream proof; renewal via same playlist → master (same rung by fingerprint) → yt-dlp's manifest_url; damaged segments refetched in place; stream Keep partial; pill "Continue · N%" | G2 streams. stream-expiry.js (75 checks) |
| 2026-10-15 | 52b75cf | Phase 7: hidden background page step (one page at a time, 6 per site per hour, once per download per 30 min, 30 s load + 10 s collect; never clicks, signs in or fills a login; out of history); "The page may need you to sign in."; new setting "Find new links on the download's page" (on) | Owner decisions 6 and 7. resolve.js (62 checks); 711 checks in all |
| 2026-10-15 | 9efd892 | Phase 8: yt-dlp formats recorded at start; every later run asks yt-dlp again (-J, no cookies) and compares; 1 MiB rule; schedule for Link expired; -J shared per page, cached 60 s, at most 2 at once, 6 lookups per site per hour | yt-dlp rows resume safely |
| 2026-10-15 | 4a14a58 | Menus close only on the window's own resize | A preloaded Home page's resize bubbled up and closed a menu opened ~1.5 s after a new tab |
| 2026-10-15 | a142101 | Deer 0.1.4 "downloads resume after expired links, changed files, restarts and damage" | Release |
| 2026-10-20 | IDM-BENCH.md, 7805625 | Bench vs IDM 6.43. **Sparse .part** (writes far into a big file no longer wait for NTFS zero-fill: "15 s at 1.5 GB, 47 s at 6 GB on a hard disk; about 10 minutes for 70 GB"); finished file made non-sparse (Windows won't mount a sparse ISO/VHD); a connection that used up its attempts **steps aside** (10-60 s) instead of pausing the row; a definite refusal retires that connection only; every 2 s each answer compared with the others' median: silent 10 s, or < ¼ of the median for 16 s, and it is cut and re-asked; reset/timeout after bytes re-asked after 100 ms; 520-527 retryable; capped 206 continues | "A tester saw big files slow to start and losing speed mid-download where IDM stayed steady." connections.js (35 checks) |
| 2026-10-20 | e90608e | Room check asks the disk what a sparse .part holds (`GetCompressedFileSizeW`); unsparse timeout fallback; the slow rule waits for the first body byte | Review: resumes ran out of room midway; a late body was cut as slow |
| 2026-10-21 | 5a6cb80 | Room counted once (free space already leaves out a sparse file's unwritten tail); `\\?\UNC\` paths; Keep partial clears the sparse mark after the cut | Second review: refused downloads that fit |
| 2026-10-21 | e20b1ca | Held bytes asked on the main thread (the flush worker made it wait behind other flushes); Pause/Cancel while the .part is readied stops the run; **HLS byte-range swap fix**: a validator slip counts only after the bytes proved the same file | Third review; "a one-file stream ... swapped mid-run could write one piece of the new file" (1 in 2 under load) |
| 2026-10-21 | 2b9437f | Keep on a blocked file clears the sparse mark where it is; a lost hedge race no longer cancels the other connections of a one-file stream | Review: a row "ended Cancelled with its parts deleted" |
| 2026-10-21 | 40f1023 | Deer 0.1.7 "steadier big downloads, split view" | Release |
| 2026-10-21 | 4bcd891, IDM-WAY-DESIGN.md, retry.ts | **Retry like IDM**: a cut or unreachable site re-asked at once (10 ms), without limit; while offline once every 30 s; a site error (408, 425, 5xx except 501/505) at the same spot after 4, 8, 12 s … on a new connection; 429/503 give the part back and stand by, plus a re-ask whenever an answer with bytes ends; Retry-After up to 24 h; after 10 s with nothing coming in the row reads Waiting for network / Retrying while the run keeps asking, and the first answer after that is preceded by a one-window proof; a Cloudflare challenge goes to Link expired; at most 150 asks/s after failures; waits outside a run every 30 s, never giving up | Owner's decision of 2026-10-21 after measuring IDM 6.43. **Not copied**: IDM's endless loop on a changed size, its weak 64-byte check after an outage. **Not built yet**: per-site limits, streams and yt-dlp under the new rules, the window wording |
| 2026-10-21 | waits.ts:6-13, 24-29 | Network and server waits retry every 30 s (was 10 s, 30 s, 1, 2, 5 min, then 10 min); server waits never fail (was 24 h) | "IDM's queue rhythm"; "IDM retries without limit" |
| 2026-10-21 | 8cc3c05 | **Hybrid layout**: on volumes without sparse files (exFAT, FAT32, some shares) IDM's part files (`<name>.part` + `<name>.parts\<hex start>.part`), joined after the last byte in 8 MiB steps ("Saving"); FAT32 refuses > 4 GiB − 1 before writing | Owner's decision of 2026-10-21. layout.js (12) |
| 2026-10-21 | daf4f7f | Deer 0.1.9 "downloads retry like IDM, part files on FAT drives" | Release |

### Owner decisions on record (RESUME-DESIGN.md section 9, approved 2026-10-13)

1. A changed file **asks** when more than 1 MiB of verified bytes exists; below that it restarts silently, at most twice in 10 minutes.
2. Start over keeps `<name>.old.part` until the new file completes.
3. Keep partial saves the **unbroken beginning** as `<stem> (partial).<ext>` (streams: written segments, merged), and the caption says exactly how much.
4. A click on the page or a pasted address attaches only to rows that need an address or are armed, always with the byte proof.
5. Continue unfinished downloads at start: on, 10 s after the first window, only those a quit or crash stopped.
6. Background page step: on by default, with a setting and budgets.
7. Keep background visits out of history (the Phase 7 spike found a way: `useGlobalHistory` off).
8. Never give up automatically while offline; expired links tried at 0, 2 min, 15 min, 1 h, 6 h. (Server errors: 24 h at first; changed to "never" on 2026-10-21.)
9. Hash records live in the profile, never next to the person's files.
10. Block size clamp(pow2ceil(total/2048), 1 MiB, 64 MiB); SHA-256 cut to 128 bits plus a 64 KiB head hash; seal every 30 s or 256 MiB and at pause, quit, sleep, disk error and the final rename.
11. Finished files are checked at completion and after an unclean exit, otherwise only on Check file; an edited file is "Changed after download", never Damaged.
12. Wording approved: Checking, Renewing link, Link expired, Waiting for link, File changed, Waiting for network, Retrying, Repairing, Damaged, Changed after download; buttons Refresh address, Use another address…, Open page, Stop waiting, Start over with the new file, Keep partial file, Check file, Repair, Restore original.
13. A dot on the ring instead of any dialog.
14. No cookies for yt-dlp.

Phase 0 of RESUME-DESIGN.md asked for a "DownloadStates" board before code. I found no such board in design/canvas/project; it is unclear whether it was made elsewhere.

**What it does / How it works / Why / Edge cases / Proven by**

The timeline is the evidence; each row names its commit or document.

---

## Lessons worth copying

Ranked by value to TitleLess.

1. **Separate "needs the person" from "Deer will retry" from "failed".** Four fields (`state`, `phase`, `need`, `wait`) let one row say "Link expired", "File changed", "Waiting for network" or "Retrying · in 40 s" without inventing new states. Expired links and changed files are paused, not failed: nothing is lost, and red stays for real damage.
2. **Build the fake server first, and assert on its request log.** Deer's `server.py` simulates about 70 misbehaviours, and tests check exact ranges, `If-Range`, client ports and byte counts — not just "it finished". The simulator can reuse it unchanged.
3. **Keep a control test**: an unchanged resume must make exactly the same requests as before (C1). It stops "safety" features from quietly costing bandwidth.
4. **Never trust headers to decide "same file"; compare bytes.** A 64 KiB window at a known offset settles it. Tests C4, C8, C9 and C13 show servers that change ETags or drop totals for harmless reasons.
5. **Space (the primary action) never destroys bytes.** Start over and Restore original need an explicit button described by its caption.
6. **One row per download for its whole life.** A re-click, a pasted link or a renewed URL continues the old row after a proof; no "name (1)".
7. **No dialogs; a dot and a sentence instead.** Only rows that start needing the person *this session* raise the dot. Old problems don't nag.
8. **Every automatic fix leaves one history line** ("New link found today, 13:02"). Silent self-healing is invisible and so not trusted.
9. **Show "Checking" only after 400 ms.** A fast resume never flickers a word; the bar just dims.
10. **"Under way" for the UI is not "holds a quit".** Waiting rows keep the ring visible and are reached by Pause all, but never block quitting.
11. **Measure against the tool people compare you with.** The IDM bench (IDM-BENCH.md) found the real causes of "slow start" and "losing speed" (zero-fill, one bad connection stopping all), and also what *not* to copy.
12. **Decide the primary verb on the engine's state at key-press time**, not on a UI copy that is a frame late.
13. **Coalesce progress updates to one per frame**, with a timer fallback for when no frames come.
14. **Speed over a 3 s window, average over active time only, ETA −1 when unknown** ("—", never a made-up time).
15. **Write down every owner decision with a date and a reason**, and quote it in code comments (`the owner's decision of 2026-10-21`). It makes later reviews fast.

## Not worth copying / Windows-only

- **Taskbar progress** (`nsITaskbarProgress`) and its 5 s re-send hack: Windows taskbar and Gecko only. On iOS the nearest things are a Live Activity or the system progress UI of a continued-processing task.
- **Quit / restart / last-window prompts**: iOS apps are not quit through such a prompt. What carries over is the rule behind it: what a stop interrupted continues, what the person paused stays paused.
- **Sparse files, `FSCTL_SET_SPARSE`, unsparse before move, `GetCompressedFileSizeW` room math**: an NTFS zero-fill problem. APFS creates sparse files by itself when you write at an offset (my understanding; unverified for every case), and there is no ISO/VHD mounting concern.
- **IDM part-file layout and FAT32 4 GiB limit**: for USB drives on Windows; an iOS app writes to its own container. (Files app external drives could be exFAT/FAT32, but an app writing directly there is unusual.)
- **Mark of the Web, Safe Browsing reputation, `.scf/.lnk/.url` name rules, executable launch prompt**: Windows threats.
- **Firefox take-over** (cancel Firefox's download and restart it in Deer), `blob:`/`data:` handed to Firefox, extension downloads: Gecko-specific plumbing. On iOS, `WKDownload` hands the download to you directly.
- **Necko "lanes"** (one network partition per connection to beat 6-per-host): Gecko-specific. URLSession has its own per-host limit (`httpMaximumConnectionsPerHost`).
- **IDM dialogs on the test machine, file-extension-free test URLs, `idm_guard.py`**: a Windows test-machine quirk.
- **Access keys with underlined letters, Shift+F10, the Menu key**: Windows menu conventions. On iPad, hardware-keyboard shortcuts are the analogue.
- **Glass lens displacement maps, 960x688 scaled panel**: Deer's visual design for desktop windows.
- **The 150 asks/s cap's reasoning** ("Necko itself sends a reset request again up to 10 times"): tied to Necko's internal retry.
- **Bugs not to copy**: "1 h 60 min" in `eta()`; inconsistent speed-limit labels between panel and Settings; DST-unaware "Yesterday".
