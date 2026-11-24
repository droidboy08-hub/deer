# How Deer downloads, end to end

This file is the map of the whole study. It shows which parts of Deer's downloader exist, which part calls
which, and what happens to one download from the click to the finished file. It links to the section files
for every detail. Every term in **bold** the first time is explained in the [glossary](#6-glossary) at the end.

Deer is the owner's Windows browser. Its own code (the "chrome" layer) is TypeScript in `gecko/src`. It runs
on Mozilla's Firefox 157 engine (**Gecko**), and it uses Firefox's network library (**Necko**). Inside the
code Deer is often still called "Vitre", its old name. The downloader was modelled on **IDM** (Internet
Download Manager): many connections per file, pause and resume, retries, a speed limit, categories, and a
video downloader. Its code began as a port of the owner's own Swift downloader (the one TitleLess grew from),
then went through an Electron build, then to Gecko ([history](30-ux-tests-history.md#mechanism-21-dated-timeline-of-downloader-decisions-and-fixes)).

Paths in this file are relative to the repository root. `VitreDownloads.sys.ts` means
`gecko/src/modules/VitreDownloads.sys.ts`; a bare `ranged.ts`, `hls.ts` and so on means
`gecko/src/modules/downloads/<file>`.

---

## 1. The architecture map

### 1.1 Processes and threads

Firefox runs web pages in **content processes** and the browser's own code in the **parent process**. Deer's
downloader lives almost entirely in the parent process. Only a small "page module" runs inside each page. In the
diagram, `actors/...`, `window/...` and `workers/...` are under `gecko/src/`; the other modules are under
`gecko/src/modules/downloads/` (except `VitreDownloads.sys.ts`, which is in `gecko/src/modules/`).

```
 CONTENT PROCESSES (web pages)          PARENT PROCESS (browser code)                            OUTSIDE PROGRAMS
 ============================           ==========================================================  ================
                                        WINDOW SIDE (one set per window, main thread)
 actors/page/downloads.ts                 window/modules/downloads/video.ts   pill, picker, tab mark   yt-dlp.exe
 (in every frame)                         window/modules/downloads/panel.ts   Downloads panel           + deno.exe
  - video under the pointer   --------->  window/modules/downloads/ring.ts    ring + quick view         ffmpeg.exe
  - main video, element media             window/modules/downloads/store.ts   the window's copy         (started only
  - 'encrypted' (DRM) events              window/modules/downloads/index.ts   'downloads' service        when asked,
  - Alt+click, list of links              window/modules/downloads/resolver.ts hidden page step           through
                                          window/modules/downloads/system.ts  taskbar, quit prompt       Subprocess)
                                                       ^  events about 4 a second (added/update/removed/attached)
                                                       |
                                        ENGINE SIDE (one for the whole app, main thread)
                                          VitreDownloads.sys.ts  = the Manager: rows, queue (2 at a time),
                                            take-over of Firefox downloads, commands, stopped(), waits,
                                            renewal steps, persistence, quit guard, view()
                                             |            |             |              |             |
                                             v            v             v              v             v
                                          ranged.ts     hls.ts       ytdlp.ts       media.ts      pagestep.ts
                                          files         HLS + DASH   yt-dlp rows    MediaWatch:   limits of the
                                          (IDM-style)   streams                     network eye,  hidden page
                                                                                    offer()       step
                                        SHARED HELPERS
                                          net.ts (one request = one Necko channel, lanes, error classes)
                                          retry.ts  proof.ts  ledger.ts  partfile.ts  parts.ts  limiter.ts
                                          waits.ts  renew.ts  expiry.ts  attach.ts  finished.ts  reputation.ts
                                          naming.ts  referrer.ts  site.ts  sites.ts  playlist.ts  dash.ts
                                          table.ts  streamkey.ts  ffmpeg.ts  ffmpeg-install.ts  platform.ts
                                        OTHER THREADS OF THE PARENT PROCESS
                                          Necko socket thread: all network reading and writing
                                          stream-transport threads: NetUtil.asyncCopy writes pipe -> .part
                                          IOUtils / crypto.subtle: file reads and SHA-256 off the main thread
                                          ChromeWorker workers/flush.js: FlushFileBuffers, sparse mark,
                                                                         volume info, part-file copy
```

What crosses each boundary:

- **Page module to window.** Plain messages (`downloads:hover`, `downloads:element-media`, `downloads:drm`,
  the reply to `downloads:main-video`). The window checks every field before use: numbers must be finite,
  `src` is cut to 8192 characters, the title to 300 ([detection overview](20-video-detection.md#overview-who-tells-what-to-whom)).
  The page module only reads; it never runs page script.
- **Window to engine.** Direct calls on the singleton (`start()`, `pause()`, `offer()` ...). The engine
  answers with events. A window shows only rows of its own privacy (normal or private)
  ([manager §1](12-download-manager.md#1-one-engine-for-the-whole-app-and-what-windows-see)).
- **Engine to network.** Every request is one Necko channel built by `net.ts`. Each connection of a download
  gets its own network partition (a **lane**), so it gets its own TCP socket
  ([engine §7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection)).
- **Engine to disk.** Bytes never enter JavaScript. A `Writer` pipes them from the network stream to the file
  on a background thread ([engine §10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes)).
  Flushes and Windows file-system calls run in a worker so they never block the UI
  ([integrity §12](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers)).
- **Engine to outside programs.** yt-dlp and ffmpeg run as child processes. Pause kills the process
  ([tools §3](22-ytdlp-ffmpeg.md#3-running-yt-dlp-the-run-wrapper-and-the-arguments-every-run-gets),
  [tools §17](22-ytdlp-ffmpeg.md#17-running-ffmpeg-runffmpeg-and-what-deer-uses-it-for)).

### 1.2 Who calls whom

| Module | Its job | It calls | Study section |
|---|---|---|---|
| `VitreDownloads.sys.ts` (Manager) | All rows, the queue, the take-over, commands, how a run ends, waits, renewal, saving the list, the quit guard, the views for the UI | `ranged.ts`, `hls.ts`, `ytdlp.ts`, `media.ts`, `pagestep.ts`, `naming.ts`, `ledger.ts`, `finished.ts`, `reputation.ts`, `platform.ts` | [12](12-download-manager.md) |
| `ranged.ts` (FileTransfer) | One file over many connections: probe, plan, work stealing, stall cuts, retries, writing, verify | `net.ts`, `retry.ts`, `proof.ts`, `partfile.ts`, `parts.ts`, `limiter.ts`, `ledger.ts` | [10](10-multi-connection-engine.md), [11](11-integrity-resume-retry.md) |
| `net.ts` | One request = one channel; headers; redirects; idle timeout; error classes | Necko | [10 §1](10-multi-connection-engine.md#1-one-request--one-channel-the-request-layer) |
| `retry.ts` | Failure classes, waits, the global pacer (150 re-asks a second) | — | [10 §14](10-multi-connection-engine.md#14-retries-per-connection-idms-policy), [11 §15](11-integrity-resume-retry.md#15-retrying-like-idm-the-owners-decision-of-2026-10-21) |
| `proof.ts` | The same-file proof (verdicts R1-R7, 64 KiB windows) | `net.ts` | [11 §3-§6](11-integrity-resume-retry.md#3-the-same-file-proof-verdicts-r1-to-r7) |
| `ledger.ts` | The block hash record and its journal; seals | `workers/flush.js` | [11 §11-§13](11-integrity-resume-retry.md#11-the-block-hash-record-the-ledger-and-its-journal) |
| `partfile.ts` / `parts.ts` | Writing at offsets; "bytes certainly on disk"; the one-file-per-part layout | `workers/flush.js` | [11 §9](11-integrity-resume-retry.md#9-writing-bytes-and-knowing-which-bytes-are-really-on-disk), [11 §23](11-integrity-resume-retry.md#23-part-files-on-drives-without-sparse-files-fat32-exfat) |
| `renew.ts`, `expiry.ts`, `attach.ts` | Renewing expired links; reading expiry from a URL; matching a re-click to a waiting row | `proof.ts` | [11 §19-§21](11-integrity-resume-retry.md#19-expired-links-reading-the-expiry-time-from-the-url) |
| `hls.ts` (StreamTransfer) | HLS and DASH: read playlists, pick tracks, fetch segments in parallel, write in order, prove a resume, join | `playlist.ts`, `dash.ts`, `table.ts`, `ffmpeg.ts`, `net.ts` | [21](21-hls-dash-engine.md) |
| `media.ts` (MediaWatch) | The network eye; which media a page loaded; DRM state; `offer()` | `playlist.ts`, `dash.ts`, `ytdlp.ts`, `sites.ts` | [20](20-video-detection.md) |
| `ytdlp.ts`, `ffmpeg.ts`, `ffmpeg-install.ts` | Running and installing the outside tools | Subprocess | [22](22-ytdlp-ffmpeg.md) |
| `pagestep.ts` + window `resolver.ts` | Opening a download's page in a hidden tab to find a fresh link | `media.ts`, `proof.ts` | [12 §18](12-download-manager.md#18-the-background-page-step-pagestepts), [20 M16](20-video-detection.md#mechanism-16-the-background-page-step-finding-a-stream-again-in-a-hidden-tab) |
| window `panel.ts`, `ring.ts`, `store.ts`, `format.ts`, `system.ts` | Everything the person sees | the Manager | [30](30-ux-tests-history.md) |

### 1.3 Files Deer keeps on disk

| File | What it is | Section |
|---|---|---|
| `<name>.part` | The unfinished file. On NTFS it is sized to the full length and marked **sparse**. | [10 §10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes) |
| `<name>.parts/<start in hex>.part` | One file per part, only on drives without sparse files (FAT32, exFAT) | [10 §22](10-multi-connection-engine.md#22-idms-layout-on-drives-without-sparse-files-parts--join) |
| `<name>.part.new` | A whole-file answer written beside the saved bytes until it is proven | [10 §19](10-multi-connection-engine.md#19-servers-that-do-not-honour-range) |
| `<name>.old.part` | The old partial kept by "Start over" until the new file is complete | [11 §7](11-integrity-resume-retry.md#7-a-file-that-really-changed-restart-quietly-or-stop-and-ask) |
| `<stem> (partial).<ext>` | What "Keep partial file" saves | [11 §21](11-integrity-resume-retry.md#21-attaching-a-download-started-again-on-its-page-and-the-keep-partial-helpers) |
| `<base>.video.part`, `<base>.audio.part`, `<part>.d/<i>`, `<base>.merge.part`, `<base>.keep.part` | Stream tracks, spilled early segments, the join's output, Keep partial's output | [21 track model](21-hls-dash-engine.md#the-track-model-and-the-part-files) |
| `<path>.blocked` | A file Safe Browsing called uncommon, waiting for "Keep file" | [12 §13](12-download-manager.md#13-where-a-file-goes-ask-where-to-save-and-finishing) |
| profile `vitre-downloads.json` (+ `.tmp`, `.bak`, `.corrupt`) | The saved list of rows | [12 §20](12-download-manager.md#20-persistence-of-the-list) |
| profile `vitre-downloads/<id>.jsonl`, `<id>.done.jsonl` | The block hash record of one file download (live, then finished) | [11 §11](11-integrity-resume-retry.md#11-the-block-hash-record-the-ledger-and-its-journal) |
| profile `vitre-downloads/<id>.stream.jsonl` | The **segment table** of one stream download | [21 segment table](21-hls-dash-engine.md#the-segment-table-journal-of-written-segments) |
| profile `vitre-download-scratch/` | Where Firefox writes its own copy before Deer takes it over | [12 §5](12-download-manager.md#5-taking-over-downloads-that-pages-start-in-firefox) |
| `%LOCALAPPDATA%\Deer\tools`, `%LOCALAPPDATA%\Deer\ffmpeg` | yt-dlp + Deno, and ffmpeg, installed only on request | [22 §2](22-ytdlp-ffmpeg.md#2-finding-the-tools-where-yt-dlp-and-deno-live), [22 §16](22-ytdlp-ffmpeg.md#16-installing-ffmpeg-on-request) |

---

## 2. The life of one file download, from click to finished file

The common case: the person clicks a download link on a web page, and the server supports **Range requests**.

**Taking the download from Firefox**

1. The page starts a download. Firefox begins its own copy into the hidden scratch folder. Deer set Firefox's
   prefs so that Firefox never asks where to save and never opens its own panel
   ([manager §5](12-download-manager.md#5-taking-over-downloads-that-pages-start-in-firefox)).
2. `adopt()` (`VitreDownloads.sys.ts:1164-1290`) reads the address, the page, the tab, the container and the
   private flag from Firefox's download. It builds the request's **identity**: a link on its own site gets
   that site's cookies; a download that one site starts on another site does not get the second site's
   **SameSite** cookies; the **Referer** follows the page's **referrer policy**
   ([manager §7](12-download-manager.md#7-whose-request-it-is-cookies-principal-referrer-and-the-cross-site-rule),
   [§8](12-download-manager.md#8-referrer-policy-referrerts)).
3. Downloads Deer must not repeat stay with Firefox and are only **mirrored** in Deer's list: extension
   downloads, `blob:`/`data:`, "Save Page As", and anything the probe below cannot get (POST answers, one-time
   links) ([manager §6](12-download-manager.md#6-mirrored-downloads-left-to-firefox)).
4. If a row is waiting for a new link ("Link expired"), the new start is scored against it (same tab +5, same
   name stem +3, same path shape +3, same page +2, same site +1; 5 or more nominates). Only a byte proof
   decides ([manager §17](12-download-manager.md#17-starting-it-again-on-its-page-pre-match-attach-refresh-address)).
5. While Firefox keeps downloading, Deer sends its own **probe**: `Range: bytes=0-0` on lane 0
   ([engine §2](10-multi-connection-engine.md#2-the-probe-the-first-request)). From that one answer it learns
   the length (from **Content-Range**), whether the server sends parts (a real **HTTP 206** with a total),
   the **validators** (**ETag**, **Last-Modified**), the final address after redirects, the server's file
   name (**Content-Disposition**), the type, and any whole-file checksum. A **HTTP 200** means "no Range":
   that answer is kept and becomes the download itself.
6. If the probe was refused, failed, or got a web page where Firefox got a file, the download stays with
   Firefox and the reason is saved. Otherwise Deer cancels Firefox's copy and deletes it, and the row is
   **queued** with a strictly increasing queue stamp ([manager §3](12-download-manager.md#3-the-queue-two-at-a-time-strict-order)).

**Starting the run**

7. `pump()` runs at most **2** downloads at once (`MAX_ACTIVE = 2`, `VitreDownloads.sys.ts:257`). Background
   work (renewals, checks, the page step) never takes a slot.
8. A resumed download first goes through "Checking": `inspect()` compares the saved `.part` with its block
   hash record ([integrity §13](11-integrity-resume-retry.md#13-crash-and-power-loss-recovery-the-check-before-every-resume)),
   then the resume probe asks `bytes=0-65535` with **If-Range**, so the first 64 KiB of the file is compared
   with the saved start in the same request ([integrity §5](11-integrity-resume-retry.md#5-the-resume-probe-window-0-rides-on-it)).
   The word "Checking" only appears after 400 ms.
9. The file name is chosen (Content-Disposition with `filename*` first, then the browser's suggestion or the
   address, then the page title for opaque names), cleaned, and **reserved** before the first byte as
   "name (1).ext" if taken ([manager §10](12-download-manager.md#10-file-naming),
   [§11](12-download-manager.md#11-unique-names-reserved-names-and-duplicates)).
10. A "dirty" mark is saved (flushed to disk) before the first byte is written
    ([integrity §12](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers)).
11. `openPart()` checks free disk space (missing bytes + 16 MiB + what other downloads still need), sizes the
    `.part` to the full length and marks it sparse, or picks the one-file-per-part layout on FAT/exFAT
    ([engine §11](10-multi-connection-engine.md#11-room-on-the-disk), [integrity §22](11-integrity-resume-retry.md#22-sparse-part-clearing-the-mark-at-the-end-and-the-room-check-room-asked-at-once)).

**Moving the bytes**

12. Number of connections: the setting (default 8, 1 to 32) only when the file is at least 8 MiB and the
    server sends parts; otherwise 1 ([engine §3](10-multi-connection-engine.md#3-how-many-connections)).
13. The file is cut into equal **segments** whose borders sit on **block** borders (1 to 64 MiB)
    ([engine §4](10-multi-connection-engine.md#4-the-segment-plan)).
14. All connections start at once. Each has its own lane, so each is a real TCP connection even on HTTP/2
    ([engine §5](10-multi-connection-engine.md#5-starting-the-connections-no-ramp), [§7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection)).
15. Every request carries `Range` and `If-Range`. Each answer's head is checked before one byte is written:
    the right status, `Content-Range` start = asked start, end within what was asked, the same total, the same
    validators, not a web page ([engine §8](10-multi-connection-engine.md#8-validators-and-if-range-on-every-request),
    [§9](10-multi-connection-engine.md#9-checking-each-answer-before-writing)).
16. Bytes go to their offset in the `.part`. When 8 MiB wait for the disk, the network is paused until under
    2 MiB. The speed limit (a **token bucket**) also pauses the stream
    ([engine §10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes), [§16](10-multi-connection-engine.md#16-the-speed-limiter)).
17. Blocks are hashed as soon as their bytes are certainly on disk. Every 30 s (or 256 MiB), and at every stop,
    a **seal** flushes the file and writes what is covered ([integrity §11](11-integrity-resume-retry.md#11-the-block-hash-record-the-ledger-and-its-journal),
    [§12](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers)).
18. A connection that finished its piece takes the second half of the biggest running piece (**work
    stealing**; at least 1 MiB on each side) ([engine §6](10-multi-connection-engine.md#6-work-stealing-dynamic-segmentation)).
19. Every 2 s, `tick()` compares each connection with the others. A silent one (10 s) or a crawling one (16 s
    under a quarter of the others' **median**) is cut and asked again at once on a new connection
    ([engine §12](10-multi-connection-engine.md#12-stall-and-slow-detection-cutting-a-bad-connection)).
20. A failing connection retries by class, the IDM way: a cut at once; a server error after 4 s, 8 s, 12 s ...
    on a new connection; a 429/503 gives its piece back and stands by, and is **nudged** when another answer
    with bytes ends; **Retry-After** is honoured; at most 150 re-asks a second for all of Deer
    ([engine §14](10-multi-connection-engine.md#14-retries-per-connection-idms-policy), [§15](10-multi-connection-engine.md#15-servers-that-limit-connections-429503-standby-and-the-nudge)).
21. If nothing arrives for 10 s and every connection is failing, the row reads "Waiting for network" or
    "Retrying · in N s" while the run keeps asking. The first answer after such a quiet stretch is checked
    against one saved 64 KiB window before anything is written ([engine §18](10-multi-connection-engine.md#18-a-quiet-stretch-retrying-and-the-proof-before-writing-again)).
22. If the server stops honouring Range, the new whole-file answer is written to `<name>.part.new` and
    replaces the `.part` only when it is complete and proven the same ([engine §19](10-multi-connection-engine.md#19-servers-that-do-not-honour-range)).

**Finishing**

23. `verify()`: every segment covers its range exactly, the bytes add up to the total, the file has that size,
    and any server checksum matches. With no strong validator and no checksum, 4 windows are compared with
    the site ([engine §21](10-multi-connection-engine.md#21-completion-checks), [integrity §8](11-integrity-resume-retry.md#8-server-checksums-and-the-completion-check)).
24. A final seal; a last check for a Pause or Cancel that came meanwhile; the sparse mark is cleared; the
    `.part` is renamed to the reserved name ([integrity §24](11-integrity-resume-retry.md#24-the-end-of-a-download-verify-final-seal-rename-safe-browsing-mark-of-the-web-record),
    [§18](11-integrity-resume-retry.md#18-aborts-that-come-early-are-never-lost-early-aborts-kept)).
25. `complete()`: Safe Browsing is asked; the **Mark of the Web** is written; size and modified time are
    stamped; the row turns "Completed". In the background the finished record (`<id>.done.jsonl`, with the
    whole-file SHA-256) is written for later "Check file" and "Repair"
    ([integrity §25](11-integrity-resume-retry.md#25-finished-files-check-file-repair-restore-original)).
26. The UI got a view of the row about 4 times a second all along. The ring hides 6 s after the last
    download ends. Every automatic fix left a **history line** ([UX §1](30-ux-tests-history.md#mechanism-1-one-state-model-for-every-surface-state-phase-need-wait),
    [§10](30-ux-tests-history.md#mechanism-10-the-ring-progress-arc-showhide-flight-animation),
    [§16](30-ux-tests-history.md#mechanism-16-history-lines-every-automatic-fix-leaves-a-sentence)).

---

## 3. When a run stops: one classification, no lost bytes

Every way a run can end goes through one function, `stopped()` (`VitreDownloads.sys.ts:2508-2614`). It never
throws saved bytes away. Rows have a small **state** plus two optional reasons: **need** (the person must act)
and **wait** (Deer will try again by itself at a set time) ([manager §2](12-download-manager.md#2-the-rows-state-machine),
[§15](12-download-manager.md#15-how-a-run-ends-one-classification-stopped)).

| What happened | Row becomes | What happens next | Section |
|---|---|---|---|
| Refused (401/403/404/410/451), an expired-signature 400, a web page or JSON where the file was, a Cloudflare challenge, with bytes saved | Paused · **Link expired** | Renew: the original address and its redirect hops, then yt-dlp's formats, then the hidden page step; automatic tries about 2 min, 15 min, 1 h, 6 h after; or the person clicks the file again on its page, or pastes a link | [11 §19-§21](11-integrity-resume-retry.md#20-renewing-the-link-the-original-address-the-schedule-and-adopting-a-proven-address), [12 §17-§18](12-download-manager.md#17-starting-it-again-on-its-page-pre-match-attach-refresh-address) |
| Another version of the file, more than 1 MiB saved | Paused · **File changed** | The person chooses Start over (old part kept until done) or Keep partial file | [11 §7](11-integrity-resume-retry.md#7-a-file-that-really-changed-restart-quietly-or-stop-and-ask) |
| Another version, at most 1 MiB saved | (no stop) | Quiet restart, at most twice in 10 minutes | [10 §20](10-multi-connection-engine.md#20-the-file-changes-on-the-server-mid-download) |
| Network gone, timeout, 5xx, 429 | Paused · **Waiting for network** / **Retrying** | A try every 30 s, never before Retry-After, never gives up; network back brings the next try to 5 s | [12 §16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer) |
| Pause | Paused | Stays paused, also after a restart | [12 §14](12-download-manager.md#14-the-persons-commands-and-their-careful-edges) |
| Quit or crash | Paused, marked "continue on start" | Continues 10 s after the next start (setting, on by default); a crash also re-checks the saved part | [11 §14](11-integrity-resume-retry.md#14-resume-after-pause-quit-sleep-and-restart), [12 §21](12-download-manager.md#21-start-up-and-continue-unfinished-downloads-when-deer-starts) |
| Computer sleeps | Paused · waiting for wake | Continues 10 s after wake, or at once when the network is back | [11 §14](11-integrity-resume-retry.md#14-resume-after-pause-quit-sleep-and-restart) |
| Disk error, TLS error, checksum mismatch after repair, anything else | **Failed** with a plain sentence | Only the person can retry | [11 §2](11-integrity-resume-retry.md#2-failure-kinds-and-where-each-one-ends) |

---

## 4. The life of one video download

### 4.1 Detect

1. While a page loads, `MediaWatch` (`media.ts`) reads the headers of every HTTP response the tab gets. It keeps
   **HLS** playlists and **DASH** manifests (by MIME type, or by `.m3u8`/`.mpd` at the end of the URL) and whole
   video or audio files. It drops script-fetched files, **segment** extensions, thumbnail/preview/ad hints and
   files under 500,000 bytes ([detection M1](20-video-detection.md#mechanism-1-the-network-eye-classifying-every-response),
   [M4](20-video-detection.md#mechanism-4-which-candidates-count)).
2. The page module reports the video under the pointer, the page's main video (largest visible area; a playing
   one counts double), media elements that loaded a file without a request of their own, and DRM `encrypted`
   events ([M2](20-video-detection.md#mechanism-2-the-page-eye-element-reports)).
3. What a page loaded belongs to that page (one record per document). A single-page site that changes its path
   forgets media older than 1.5 s ([M3](20-video-detection.md#mechanism-3-one-record-per-document-and-single-page-sites)).
4. Any **DRM** signal (an **EME** key-system request, an `encrypted` event, `mediaKeys`, a DRM key in an HLS
   playlist, DASH `ContentProtection`) marks the whole document "protected" for as long as it is shown
   ([M7](20-video-detection.md#mechanism-7-drm-detecting-and-refusing)).
5. The tab's download mark lights when the page has candidates (or is a YouTube video page)
   ([M12](20-video-detection.md#mechanism-12-entry-points-hover-pill-ctrlshiftd-the-tab-mark-the-video-menu)).

### 4.2 Pick

6. The person hovers the video (a pill appears) or presses Ctrl+Shift+D. `offer()` decides, in this order:
   protected → live → YouTube goes to yt-dlp (only on an explicit request) → HLS → DASH → the largest direct
   file → yt-dlp as a last resort → a note that says why
   ([M10](20-video-detection.md#mechanism-10-the-offer-choosing-direct-file-hls-dash-or-yt-dlp)).
7. HLS: candidate playlists are ranked by name, then by how recent they are. Up to 4 are read. The body must
   start with `#EXTM3U`. The first real **master playlist** (one with `#EXT-X-STREAM-INF`) wins
   ([M5](20-video-detection.md#mechanism-5-ranking-streams-and-preferring-the-master),
   [M6](20-video-detection.md#mechanism-6-confirming-and-reading-a-manifest)).
8. The picker shows a **quality ladder**: one row per height, a size estimate (`AVERAGE-BANDWIDTH` or
   `BANDWIDTH` / 8 × duration), and "Best for this screen" on the tallest row that fits the screen
   ([M9](20-video-detection.md#mechanism-9-the-quality-ladder-and-the-suggestion-for-this-screen),
   [M14](20-video-detection.md#mechanism-14-the-picker-how-the-ladder-is-presented)).
9. A video in an embedded player from another site uses only that frame's media. If the media server refuses
   the tab's page (a 4xx), Deer asks again as the player's frame, and downloads that way
   ([M11](20-video-detection.md#mechanism-11-embedded-players-frame-ownership-and-asking-as-the-player)).
10. `start()` checks DRM once more, whoever asks ([manager §4](12-download-manager.md#4-starting-a-download-deer-starts-itself-start)).

### 4.3 Download: four paths

- **Direct file** (an `.mp4` the `<video>` plays): the file engine of section 2.
- **HLS or DASH** ([streams overview](21-hls-dash-engine.md#how-a-stream-download-flows-overview)):
  11. `runStream()` opens the stream's segment table. If every segment is already written, it goes straight
      to the join and asks the network nothing.
  12. `prepare()` reads the playlists, picks the tracks (the chosen variant plus its separate audio
      **rendition**), stores a quality **fingerprint**, and refuses DRM (`SAMPLE-AES`, vendor `KEYFORMAT`s,
      `ContentProtection`), live streams, and multi-period DASH. A DASH manifest is turned into the same
      segment list HLS uses ([master](21-hls-dash-engine.md#master-playlists-variants-the-ladder-and-which-quality-is-downloaded),
      [DRM](21-hls-dash-engine.md#drm-refusal-sample-aes-widevine-playready-fairplay-dash-contentprotection),
      [DASH](21-hls-dash-engine.md#dash-manifest-parsing-mpd)).
  13. A resume proves the stream is the same: it finds the next segment by **media sequence** (or by total
      duration when the numbering changed), re-fetches the last written segment and compares its hash
      ([resume](21-hls-dash-engine.md#resume-of-a-half-done-stream-the-proof-and-where-to-continue)).
  14. Each track (video first, then audio): the **init segment** first; then up to 16 connections (8 by
      default) fetch a window of `max(24, 4 × connections)` segments; each segment is decrypted (**AES-128**),
      checked to be media ("sniffed"), and written strictly in order. Early segments wait in RAM up to
      48 MiB, then **spill** to disk. An overdue head segment is raced by a second request (**hedge**). An
      expired segment address is looked up again in a fresh copy of the same playlist
      ([parallel fetch](21-hls-dash-engine.md#parallel-segment-fetching-with-in-order-writing),
      [hedge](21-hls-dash-engine.md#racing-an-overdue-segment-hedging),
      [sniffing](21-hls-dash-engine.md#is-it-media-segment-sniffing-a-page-or-json-is-never-written),
      [refresh](21-hls-dash-engine.md#expired-addresses-inside-a-run-refreshing-the-media-playlist-g2-step-1)).
  15. Every written segment adds a line with its hash to the segment table
      ([table](21-hls-dash-engine.md#the-segment-table-journal-of-written-segments)).
- **yt-dlp** (YouTube and a last resort): `yt-dlp -J` lists the formats; the picker shows one row per height
  (H.264 MP4 first, original-language sound); the download runs `-f <video>+<audio> --continue` with a machine
  progress line; every resume asks `-J` again and compares the formats with those recorded at the start
  ([tools §4-§9](22-ytdlp-ffmpeg.md#4-probing-a-page-yt-dlp--j-and-the-offers-state)).

### 4.4 Join

16. ffmpeg joins the tracks with `-c copy` (no re-encoding) into MP4 with `+faststart`, or WebM when every
    track is WebM. Before it starts, "merging to X" is saved, so a crash in the middle is finished on the next
    start without downloading again. The result's length must be within `max(2 s, 2 %)` of the playlist's.
    Without ffmpeg, or if it fails, the tracks are kept as separate files with a note
    ([join](21-hls-dash-engine.md#joining-the-tracks-with-ffmpeg-mp4-or-webm-faststart-and-life-without-ffmpeg),
    [crash window](21-hls-dash-engine.md#the-merge-crash-window),
    [length check](21-hls-dash-engine.md#length-check-after-the-merge)).
17. The row completes as in section 2, step 25.

---

## 5. The numbers at a glance

All checked against the code on disk. More constants are in each section.

| What | Value | Where |
|---|---|---|
| Downloads running at once | 2 | `VitreDownloads.sys.ts:257` |
| Connections per file (default / range / UI menu) | 8 / 1-32 / 1, 2, 4, 8, 16 | `gecko/src/shared/settings.ts:71`, `gecko/src/modules/VitreSettings.sys.ts:52` |
| Smallest file split into parts | 8 MiB | `ranged.ts:95` |
| Smallest piece a steal makes | 1 MiB (a segment needs 2 MiB left) | `ranged.ts:97` |
| Block size | smallest power of 2 from 1 MiB that is ≥ total/2048, at most 64 MiB | `ledger.ts:39-41`, `:77-82` |
| Disk back-pressure | pause at 8 MiB waiting, resume under 2 MiB | `ranged.ts:100-101` |
| Idle timeout per request | 30 s | `net.ts:172` |
| Stall / slow cut | 10 s silent / 16 s under max(8 KiB/s, 25 % of median), others ≥ 64 KiB/s | `ranged.ts:136-151` |
| Retry gaps | cut 10 ms; server error 4 s × k; offline 30 s | `retry.ts:24-27` |
| Global re-ask cap | 150 a second | `retry.ts:28` |
| Quiet stretch before "Retrying" | 10 s | `retry.ts:30` |
| Proof window | 64 KiB, at most 4 windows | `proof.ts:33`, `:39` |
| Ask the person above | 1 MiB saved; quiet restarts at most 2 in 10 min | `proof.ts:29`, `ranged.ts:104-105` |
| Seal | every 30 s or 256 MiB, and at every stop | `ledger.ts:49-50` |
| Waits outside a run | every 30 s, never give up | `waits.ts:25`, `:29` |
| Continue after start | 10 s | `waits.ts:42` |
| Link renewal schedule | 0, then about 2 min, 15 min, 1 h, 6 h after the failure | `renew.ts:58` |
| Show "Checking" after | 400 ms | `VitreDownloads.sys.ts:272` |
| Stream connections | at most 16; window max(24, 4 × connections) | `hls.ts:1161-1162` |
| Stream memory | 48 MiB in RAM, then spill; 32 MiB write backlog | `hls.ts:182`, `:184` |
| Hedge an overdue segment after | max(3 s, 2 × average fetch time) | `hls.ts:1236` |
| Join length tolerance | max(2 s, 2 %) | `hls.ts:196-197` |
| Media candidate floor | 500,000 bytes; element clips 5 s | `media.ts:237`, `gecko/src/actors/page/downloads.ts:263` |
| Page step budgets | 30 s load + 10 s collect; 6 per site per hour; once per row per 30 min | `pagestep.ts:34-40` |

---

## 6. Glossary

Every term used across the study, in alphabetical order. "Deer word" means a name Deer's code or this study
made up.

| Term | Meaning |
|---|---|
| **-J** (yt-dlp) | yt-dlp's "dump JSON" mode: it prints the video's facts and all its formats and downloads nothing. |
| **AES-128** (HLS) | Each whole segment is encrypted with AES in CBC mode with PKCS#7 padding, using a 16-byte key from a key file. Not DRM: anyone who can fetch the key can decrypt. |
| **Accept-Encoding: identity** | A request header that asks the server not to compress the answer. Needed so byte offsets mean bytes of the stored file. |
| **AdaptationSet** (DASH) | A group of representations of one kind (video, audio). |
| **APFS** | Apple's file system on iPhone, iPad and Mac. It supports sparse files. |
| **Atomic write** | Write a temporary file, then rename it over the real one, so a crash leaves the old or the new copy, never half. |
| **Attach** (Deer word) | A new start of the same file (a re-click, a pasted link) continues the old row after a byte proof. |
| **Back-pressure** | Slowing the producer (the network) when the consumer (the disk) falls behind. |
| **BaseURL** (DASH) | A URL prefix that can appear at each level of the manifest. |
| **BGContinuedProcessingTask** | An iOS 26 background-task type for long work the person started, shown with system progress UI (details in the iOS guide are marked unverified). |
| **blob: URL** | An address that exists only inside one page (for example the source of an MSE player). It means nothing outside that page. |
| **Block** | A fixed piece of a file (1 to 64 MiB) used to align segment cuts and to hash saved bytes. |
| **Block hash record / ledger** (Deer word) | Per download, the SHA-256 (cut to 128 bits) of every block plus a hash of each block's first 64 KiB, kept in a journal. Finds damage after a crash. |
| **browserId / innerWindowId** | Gecko's id of a tab, and of one loaded document in it. |
| **Byte range (HLS)** | A segment that is a slice of a bigger file (`#EXT-X-BYTERANGE:<length>@<offset>`). |
| **CDM** | Content Decryption Module: the part of a browser that decrypts DRM video. |
| **CDN / CDN edge** | Content delivery network; one of its many servers. Different edges can give different validators for the same bytes. |
| **Chunked transfer** | An answer with no Content-Length; its size is known only at the end. |
| **Cloudflare challenge** | A "checking your browser" page (`cf-mitigated: challenge`). Deer treats it as Link expired and never hammers it. |
| **Codec / container** | How picture or sound is compressed (H.264 = `avc1`, HEVC = `hvc1`/`hev1`, VP9, AV1, AAC = `mp4a`, Opus) / the file type that holds the tracks (MP4, M4A, MOV, TS, WebM, MKV). |
| **Container** (Firefox) | A separate cookie jar for the same sites (`userContextId`). Not the same as a media container. |
| **Content-Disposition** | A response header that can name the file: `attachment; filename="a.pdf"`, or `filename*=UTF-8''r%C3%A9sum%C3%A9.pdf` (RFC 5987, for any language). |
| **Content-Length** | The length of one answer's body in bytes. |
| **Content-MD5 / Digest / Repr-Digest** | Headers in which a server can give a checksum of the whole file. Deer uses `sha-256` from `Repr-Digest`/`Digest`, and `Content-MD5` only on a 200. |
| **Content-Range** | The 206 header `bytes START-END/TOTAL`: first byte, last byte, whole file length (`*` = unknown). |
| **ContentProtection** (DASH) | An element that says the stream is DRM-protected. It holds the PSSH. |
| **Cookie jar** | The set of cookies a request may read. |
| **Crawler** (Deer word) | A connection that receives far less than the others. |
| **DASH** | MPEG-DASH, a streaming format with an XML manifest (`.mpd`): `MPD` > `Period` > `AdaptationSet` > `Representation`. |
| **Deno** | A JavaScript runtime that yt-dlp needs for YouTube. |
| **Dirty mark** (Deer word) | Saved before a run writes its first byte; cleared only by a clean stop. Still set at start = the stop was not clean. |
| **Discontinuity** (HLS) | `#EXT-X-DISCONTINUITY`: timestamps or codecs change at that point (often inserted ads). Deer does not handle it. |
| **DRM** | Copy protection whose keys come from a licence server and are bound to a player: Widevine, PlayReady, FairPlay. Deer never saves it. |
| **Durable / settled bytes** (Deer word) | A lower bound of the bytes certainly in the file / safe to read back while writers run. Only durable bytes are saved as progress. |
| **EME** | Encrypted Media Extensions, the web API for DRM (`navigator.requestMediaKeySystemAccess`, the `encrypted` event, `video.mediaKeys`). |
| **ETag (strong / weak)** | A server's label for one version of a file. A strong one promises identical bytes; a weak one (`W/"..."`) does not and may not be used for ranges. |
| **eTLD+1 / registrable domain / site** | The part of a host one owner can register, for example `example.co.uk`. |
| **EXT-X tags** (HLS) | Lines in a playlist: `STREAM-INF` (a variant), `MEDIA` (a rendition), `MEDIA-SEQUENCE` (number of the first segment), `KEY` / `SESSION-KEY` (encryption), `MAP` (init segment), `BYTERANGE`, `ENDLIST` (finished, not live), `PLAYLIST-TYPE:VOD`, `I-FRAMES-ONLY`. `#EXTINF:<seconds>` gives a segment's duration. |
| **F_FULLFSYNC / fsync / FlushFileBuffers** | Asking the system to put a file's cached data on the physical disk now. `FlushFileBuffers` is the Windows call; on Apple systems `fsync` does not empty the drive's own cache and `F_FULLFSYNC` does. |
| **faststart** | Putting an MP4's index (`moov` box) at the start so playback can begin at once (`-movflags +faststart`; AVFoundation: `shouldOptimizeForNetworkUse`). |
| **ffmpeg** | A program that reads and writes almost every audio and video format. Deer only uses it to copy tracks into another container. |
| **File changed** (Deer word) | Paused state: the site now has another version of the file; the person chooses Start over or Keep partial. |
| **Fingerprint / rung** (Deer words) | A rung is one step of the quality ladder (720p ...). Its fingerprint (height, codecs, bandwidth, audio group/language/name) finds the same quality again in a re-read master. |
| **fMP4 / CMAF** | Fragmented MP4: one init segment (`ftyp` + `moov`) and many media segments (`moof` + `mdat`). Joined, they form a valid MP4. |
| **FNV-1a** | A tiny non-cryptographic hash. Deer uses it to pick stable "random" places from a download's id. |
| **Format** (yt-dlp) | One downloadable version of a video with an id (for example 137 = 1080p H.264 video only). |
| **Frame / iframe** | A page inside the page. The top document is the tab's own page. |
| **Gecko / Necko** | Firefox's engine / Firefox's network library. A Necko request is a "channel". |
| **Generation** (Deer word) | A counter per lane; a cut bumps it, which forces a brand-new TCP connection. |
| **Hash / SHA-256 / MD5** | A fingerprint of bytes; any change gives another value. SHA-256 is 256 bits; Deer often keeps the first 128. MD5 is older and only used for `Content-MD5`. |
| **Hedge** (Deer word) | Racing an overdue segment with a second request; the first answer wins. |
| **History line** (Deer word) | One sentence a row keeps for every automatic fix ("New link found today, 13:02"); the last 5 are kept. |
| **HLS** | HTTP Live Streaming (Apple). A text playlist (`.m3u8`, first line `#EXTM3U`) lists small media files (segments). |
| **Hotlink protection** | A server that refuses requests whose Referer is not its own site. |
| **HTTP 200 / 206 / 416** | 200 = the whole file (to a Range request: the server ignored the Range); 206 Partial Content = just the asked bytes; 416 = the range is outside the file. |
| **HTTP/2 multiplexing** | On HTTP/2 a client normally sends all requests to one host over one TCP connection, so "8 connections" can be 8 streams in one connection. HTTP/3 does the same over QUIC. |
| **IDM** | Internet Download Manager, the Windows download manager Deer copies and benchmarked against (version 6.43, 2026-10-20). |
| **If-Range** | A request header with a validator: "send this range only if the file is still this version; otherwise send the whole file (200)". |
| **Init segment** | The header piece of a fragmented MP4 stream that must come before the media segments (`#EXT-X-MAP` in HLS, `initialization` in DASH). |
| **IV** | Initialization vector: 16 bytes used with an AES-128 key. In HLS it is the `IV=` attribute, or else the segment's media sequence number. |
| **Journal (JSON lines)** | An append-only file, one JSON object per line. A torn last line is ignored. |
| **Keep partial file** (Deer word) | Saving what was downloaded so far as its own file: the unbroken beginning of a file, or the written segments of a stream. |
| **KEYFORMAT** (HLS) | Names the key system of an HLS key. `identity` (the default) is a plain key file; anything else is DRM (FairPlay is `com.apple.streamingkeydelivery`). |
| **Lane** (Deer word) | One connection slot of one download, with its own Necko network partition, so its own TCP socket. |
| **Last-Modified** | The date the server says the file last changed. A weaker validator than a strong ETag. |
| **Link expired** (Deer word) | Paused state: the address no longer gives the file. Bytes are kept; Deer looks for a new link. |
| **Live (stream)** | A stream with no end: no `#EXT-X-ENDLIST` and not `PLAYLIST-TYPE:VOD`, or DASH `type="dynamic"`, or `duration == Infinity`. Never saved. |
| **Mark of the Web** | The Windows `Zone.Identifier` data that marks a file as "from the internet". |
| **Master playlist / media playlist / variant** | A master (multivariant) playlist lists several variants (qualities); each variant has a media playlist that lists its segments. |
| **Median** | The middle value of a sorted list. |
| **Media sequence** | A segment's number: `#EXT-X-MEDIA-SEQUENCE` plus its index. Deer matches segments by it, never by position. |
| **Mirror** (Deer word) | A download Deer leaves to Firefox but still shows in its list. |
| **MIME type / Content-Type** | The server's statement of what a body is, for example `video/mp4` or `application/vnd.apple.mpegurl`. |
| **MSE / ManagedMediaSource** | Media Source Extensions: a player script downloads segments itself and feeds the `<video>`, whose address is then a `blob:` URL. ManagedMediaSource is Apple's variant on iPhone. |
| **Need / wait / phase / state** (Deer words) | A row's coarse `state` (queued, downloading, paused, completed, failed, cancelled, starting) plus `phase` (what it is doing now: probing, checking, renewing, merging, repairing), `need` (the person must act) and `wait` (Deer acts by itself at `nextAt`). |
| **Nudge** (Deer word) | Waking connections that stand by after a 429/503 when another answer that brought bytes ends (IDM re-asks then). |
| **Opaque name** (Deer word) | A file name that says nothing (`master`, `index`, `videoplayback`, `720p`, a hex hash). Replaced by the page title. |
| **Origin** | A request header with the scheme, host and port of the page that asks. |
| **`.part` file** | The unfinished file, renamed to the real name only when complete. |
| **Page step** (Deer word) | Opening a download's page in a hidden, muted tab to find a fresh link. Never clicks or signs in. |
| **Pacer** (Deer word) | A global token bucket: at most 150 re-asks a second after failures, for all of Deer. |
| **Parts layout** (Deer word) | IDM's way: one file per part, each written only at its end, joined after the last byte. Deer uses it on drives without sparse files. |
| **Period** (DASH) | A time span of the presentation. Deer reads only one. |
| **Phase 1-8** | The eight build phases of Deer's resume design (`gecko/spikes/downloader/RESUME-DESIGN.md`, approved by the owner 2026-10-13), built 2026-10-14 to 2026-10-15. |
| **Pill / picker / mark** | Deer's video UI: the button over a hovered video / the quality list / the icon in the tab that says "this page has media". |
| **Principal** | Firefox's word for "who is making this request" (a page's origin, or the browser itself, the "system principal"). |
| **Private browsing** | A cookie jar thrown away when the last private window closes. Private rows are never written to disk. |
| **Probe** (Deer word) | The first request: `Range: bytes=0-0` (fresh) or `bytes=0-65535` + If-Range (resume). |
| **Proof / proof window / window 0** (Deer words) | Comparing up to 64 KiB of saved bytes at a chosen place with the server's bytes at the same place. Window 0 is the file's first 64 KiB. |
| **PSSH** | A DRM data box with key-system information. In DASH it sits inside `ContentProtection`. |
| **Quiet stretch** (Deer word) | 10 s with no byte while every connection fails. The row then reads Waiting for network or Retrying. |
| **R1-R7** (Deer words) | The same-file verdicts: R1 not the file (link expired), R2 another size, R3 another checksum, R4 other bytes in a window, R5 same strong ETag + same window 0, R6 headers never decide alone, R7 unknown. |
| **Range request** | An HTTP request with `Range: bytes=A-B` that asks for only bytes A to B (both included). |
| **Referer / referrer policy** | The header naming the page a request came from / the page's rule for how much of its address to send (8 policies, default `strict-origin-when-cross-origin`). |
| **Rejoin proof** (Deer word) | After a quiet stretch, one saved window is compared with the site before anything new is written. |
| **Remux / mux / merge / join** | Putting audio and video into one container without re-encoding (ffmpeg `-c copy`; AVFoundation passthrough). |
| **Rendition** (HLS) | An extra track declared by `#EXT-X-MEDIA` (audio in another language, subtitles), with `GROUP-ID`, `LANGUAGE`, `NAME`, `DEFAULT`. |
| **Representation** (DASH) | One quality of one track. |
| **Retry-After** | A server header that says how many seconds (or until which date) to wait before asking again. |
| **Ring / quick view / panel** | Deer's download UI: a small progress circle, the popover above it, the big 960x688 Downloads panel. |
| **Row / record / run** | One download in the list / everything Deer knows about it / one live attempt to move its bytes. |
| **SABR / UMP** | Names in Deer's comments for YouTube's POST-based streaming; nothing in the page's traffic can be saved. |
| **SameSite cookies** | Cookies (`Strict`, `Lax`) a browser does not send when another site starts the request. |
| **SAMPLE-AES** | HLS encryption of the samples inside a segment, used by FairPlay. Deer treats it as DRM. |
| **Seal** (Deer word) | A checkpoint: flush the file to disk, append a journal line saying what is covered, save the list. |
| **Segment** | (Files) one stretch `[start, end)` of a file filled by one connection, with its `received` count; its **frontier** is the next byte it needs. (Streams) one small media file listed in a playlist. |
| **Segment table** (Deer word) | A stream's journal: one line per written segment with its media sequence, offset, length, hash and duration. |
| **SegmentTemplate / SegmentTimeline / SegmentList / SegmentBase / sidx** (DASH) | A URL pattern with `$Number$`/`$Time$` / exact start, duration and repeat of each segment / an explicit list of segment URLs / one file per representation, with an index box (`sidx`). |
| **Session clean flag** (Deer word) | Saved `false` at start and `true` only by a clean shutdown. `false` at the next start = crash or power loss. |
| **Signed URL** | An address with a signature and an expiry time in its query (S3, Google Cloud, Azure, Akamai, CloudFront). After the time the server answers 403. |
| **Single-flight** | Many callers that need the same answer wait for one shared request instead of each sending their own. |
| **Sniffing** | Looking at a body's first bytes to see what it really is: `<` or `{` = a page or JSON; `0x47` = TS; `ftyp`/`moof` = MP4; `#EXTM3U` = HLS. |
| **SPA / pushState** | Single-page app: a site that changes the address with `history.pushState` without loading a new document. |
| **Sparse file / zero-fill** | A file whose unwritten regions take no disk space / on NTFS without the sparse mark (and on FAT), writing far into a new file first writes zeros up to that point, which took minutes on big files. |
| **Spill** (Deer word) | Writing segments that arrived early to temporary files instead of keeping them in RAM. |
| **Stall** | A connection that receives nothing for a while. |
| **Standby** (Deer word) | A connection a server turned away (429/503) gives its piece back and waits to ask again. |
| **Stream key** (Deer word) | The page's origin and path, the rounded length in seconds and the normalized title, joined by a bar character. Used to find an old stream row from a re-opened page ("Continue · 62%"). |
| **Subprocess / child process** | Another program started by the app and talked to through pipes. Not possible in an App Store iOS app. |
| **Take-over** (Deer word) | Deer cancelling a download Firefox started and doing it with its own engine. |
| **Token bucket** | A rate limiter: tokens refill at the allowed rate; each action spends tokens; when empty, the caller waits. |
| **TS** | MPEG transport stream: the classic HLS segment container of 188-byte packets that start with `0x47`. |
| **Validator** | An ETag or a Last-Modified date. |
| **Vault** (TitleLess) | TitleLess's store of finished downloads: AES-256-GCM encrypted blobs in Application Support, played by an in-app AVPlayer. |
| **Vitre** | Deer's old name, still used inside the code (`VitreDownloads`, `vitre-lane-<n>`). |
| **Waiting for network / Retrying** (Deer words) | Paused-looking states in which Deer tries again by itself. |
| **WKWebView / WKDownload** | Apple's web view / its download object for navigations that become downloads. |
| **Work stealing** | A finished connection takes half of the biggest piece still running ("dynamic segmentation"). |
| **yt-dlp** | A command-line program that knows how to get videos from many sites ("extractors"). |
