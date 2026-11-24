# TitleLess port guide: bringing Deer's downloader quality to iOS and iPadOS

This is the practical half of the study. It compares Deer's downloader with TitleLess's, lists the iOS facts that
shape a port, ranks 25 concrete improvements, says what must not be ported, and proposes an order of work.

Read [01-overview.md](01-overview.md) first if a word is new. Its [glossary](01-overview.md#6-glossary) explains
every term used here.

**Where the facts come from**

- **Deer** facts come from the section files (10 to 30) of this study, which cite Deer's code as `path:line`.
- **TitleLess** facts come only from TitleLess's own downloader audit summary, as it was given to this study. This
  study did not read TitleLess's code. "Not described" in this file means: the audit summary says nothing about
  it. It does not mean TitleLess lacks it. Check the code before building.
- **iOS** facts were first written from general platform knowledge, then checked on 2026-10-29 against Apple's
  documentation, WWDC session pages, the App Review Guidelines and Apple engineers' forum answers. Wrong claims were
  fixed in place; the sources are listed in [Verification notes](#verification-notes) at the end. Anything still
  marked **(unverified)** was not found in those sources and was not tried on a device. Check it before relying on
  it.

**A note on history.** Deer's downloader began as a port of the owner's own Swift downloader. Deer's comments cite
`RangedDownload.swift` (the prototype engine, `gecko/src/modules/downloads/ranged.ts:1-3`) and `HLSDownload.swift`
(for segment racing, spill to disk, the "remember a failed renewal for 30 s" rule in `renew.ts`, and the output
length check, RESUME-DESIGN.md 4.2). Deer then added much more (sections 10 to 22). So for every item below, look
first: TitleLess may already have part of it.

**Effort** (judgement, one developer): **S** = about 1-2 days, **M** = about a week, **L** = more than a week.

---

## a. What TitleLess has vs what Deer has

Columns: the Deer mechanism, where it is explained, TitleLess today (from its audit), the gap, and the value of
porting it to iOS (high / medium / low / n/a).

### a1. Finding the video on a page

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| Nominate playlists by MIME (`mpegurl`, `dash+xml`) or an anchored `.m3u8`/`.mpd` at the end of the URL; confirm by body (`#EXTM3U`, `<MPD`) | [20 M1](20-video-detection.md#mechanism-1-the-network-eye-classifying-every-response), [M6](20-video-detection.md#mechanism-6-confirming-and-reading-a-manifest) | HLS only by ".m3u8" in the URL; no MIME or `#EXTM3U` check | Misses `/manifest?id=...`; an HTML error page at a `.m3u8` address is taken as a playlist | high |
| Reject list: segment extensions, script-fetched whole files, thumb/preview/ad hints, files < 500,000 bytes, element clips < 5 s | [20 M4](20-video-detection.md#mechanism-4-which-candidates-count) | No reject list | "Newest file" can be a segment, a preview or an ad | high |
| Largest file wins, size from the `Content-Range` total | [20 M10](20-video-detection.md#mechanism-10-the-offer-choosing-direct-file-hls-dash-or-yt-dlp) | Newest file wins | Wrong file after the main video started | high |
| Rank playlists by name, read up to 4, the first real master wins | [20 M5](20-video-detection.md#mechanism-5-ranking-streams-and-preferring-the-master) | First playlist wins forever | A variant or an ad playlist wins; the ladder is lost | high |
| One record per document; never cleared by a response; single-page sites forget media older than 1.5 s | [20 M3](20-video-detection.md#mechanism-3-one-record-per-document-and-single-page-sites) | First playlist wins forever | The next video on a single-page site is never offered | high |
| Element report: `currentSrc`, real size, length, `mediaKeys`; main video = largest visible area, playing counts double | [20 M2](20-video-detection.md#mechanism-2-the-page-eye-element-reports) | `<video>` play/pause/ended reported | Facts and "main video" choice not described | high |
| Media belongs to its frame; on a 4xx ask again as the player's frame | [20 M11](20-video-detection.md#mechanism-11-embedded-players-frame-ownership-and-asking-as-the-player) | Script runs in all frames; frames not described as separated | Hotlink-protected embeds fail | high |
| DRM: EME requests, `encrypted`, `mediaKeys`, HLS key formats, DASH `ContentProtection`; sticky per document; refused at 7 layers | [20 M7](20-video-detection.md#mechanism-7-drm-detecting-and-refusing) | AES-128 decryption; DRM handling not described | A FairPlay or SAMPLE-AES stream may be attempted | high |
| Live: `duration == Infinity`, no `ENDLIST` and not VOD, DASH `dynamic` | [20 M8](20-video-detection.md#mechanism-8-live-streams) | Not described | A live playlist may download until stopped | medium |
| Quality ladder, size estimate, "Best for this screen" | [20 M9](20-video-detection.md#mechanism-9-the-quality-ladder-and-the-suggestion-for-this-screen) | One URL is picked | No choice, no size | high |
| Always say why nothing was found | [20 M13](20-video-detection.md#mechanism-13-when-nothing-is-found) | Not described | Silent failure | high |
| Stream key: re-find an old stream row from a re-opened page | [20 M15](20-video-detection.md#mechanism-15-the-stream-key-continue--62) | Not described | A stopped stream can't continue after its signed URLs change | medium |
| Hidden page step to find a fresh link | [20 M16](20-video-detection.md#mechanism-16-the-background-page-step-finding-a-stream-again-in-a-hidden-tab) | None | — | low |
| yt-dlp for YouTube-class sites | [20 M17](20-video-detection.md#mechanism-17-yt-dlp-for-sites-with-nothing-in-the-traffic) | No site extractors | Nothing to close (App Store rules) | n/a |

### a2. Direct files: the multi-connection engine

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| Check the head before the body; `Accept-Encoding: identity`; no cache; Range kept on redirects | [10 §1](10-multi-connection-engine.md#1-one-request--one-channel-the-request-layer) | Not described | — | medium |
| Probe `bytes=0-0`; ranges only on a real 206 with a total; a 200 is reused as the download | [10 §2](10-multi-connection-engine.md#2-the-probe-the-first-request) | Falls back to one connection when there is no 206 | 200 reuse, total parsing, validators not described | high |
| Connection rule: setting (default 8) only from 8 MiB; at most 2 downloads at once | [10 §3](10-multi-connection-engine.md#3-how-many-connections) | Ranged pull for "large direct files" | Threshold, count and download cap not described | medium |
| Block-aligned segment plan | [10 §4](10-multi-connection-engine.md#4-the-segment-plan) | Not described | — | medium |
| All connections start at once; idle ones leave | [10 §5](10-multi-connection-engine.md#5-starting-the-connections-no-ramp) | Not described | — | medium |
| Work stealing (≥ 1 MiB each side) | [10 §6](10-multi-connection-engine.md#6-work-stealing-dynamic-segmentation) | Not described | The slowest range likely decides the finish time | high |
| Lanes: each connection a real TCP connection, also on HTTP/2 | [10 §7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection) | Not described | Inside one `URLSession`, ranges to an HTTP/2 host run over one connection (Apple, b2); how many sessions TitleLess uses is not described | high |
| If-Range with a strong ETag or Last-Modified on every request | [10 §8](10-multi-connection-engine.md#8-validators-and-if-range-on-every-request) | Not described | A changed file could be mixed | high |
| Check every answer (status, `Content-Range`, total, validators, not a page) before writing | [10 §9](10-multi-connection-engine.md#9-checking-each-answer-before-writing) | Not described | A wrong range could reach the file | high |
| Positional writes into one pre-sized file; disk back-pressure 8 MiB / 2 MiB; only on-disk bytes saved | [10 §10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes) | Not described | Crash-safe progress unknown | high |
| Room check before the first byte | [10 §11](10-multi-connection-engine.md#11-room-on-the-disk) | Not described | Dies at 100 % on a full disk | medium |
| Stall (10 s) and slow (16 s, < 25 % of median) cuts | [10 §12](10-multi-connection-engine.md#12-stall-and-slow-detection-cutting-a-bad-connection) | Not described | A dead range waits for the 60 s timeout | high |
| Capped 206 answers continue at once | [10 §13](10-multi-connection-engine.md#13-capped-answers-servers-that-send-less-than-asked) | Not described | — | medium |
| Retry per connection by failure class; global cap | [10 §14](10-multi-connection-engine.md#14-retries-per-connection-idms-policy) | "Retry" exists | No classes, no growing gaps, no Retry-After described | high |
| 429/503: stand by, nudge | [10 §15](10-multi-connection-engine.md#15-servers-that-limit-connections-429503-standby-and-the-nudge) | Not described | Hosts that allow 2 connections | medium |
| Speed limit (token bucket) | [10 §16](10-multi-connection-engine.md#16-the-speed-limiter) | Not described | — | low |
| Speed, average, ETA, 8-cell bar | [10 §17](10-multi-connection-engine.md#17-progress-speed-eta-and-the-connection-bar) | Not described | — | medium |
| Quiet stretch: "Retrying" view, one-window proof before writing again | [10 §18](10-multi-connection-engine.md#18-a-quiet-stretch-retrying-and-the-proof-before-writing-again) | Not described | A file swapped during an outage could be written into | medium |
| Server stops ranging mid-run: whole answer to a side file, swapped only when proven | [10 §19](10-multi-connection-engine.md#19-servers-that-do-not-honour-range) | One connection when no 206 | Mid-run case not described | medium |
| Completion checks (coverage, size, digest, 4 windows) | [10 §21](10-multi-connection-engine.md#21-completion-checks) | Completion goes to the vault | Not described | medium |
| One file per part + crash-safe join | [10 §22](10-multi-connection-engine.md#22-idms-layout-on-drives-without-sparse-files-parts--join) | Background URLSession exists | How ranged parts continue in the background not described | high |
| Waits outside a run (every 30 s, never give up) | [10 §24](10-multi-connection-engine.md#24-waits-outside-a-run) | Not described | — | medium |

### a3. Integrity, resume and retries

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| Decide before changing saved state; never truncate unless "fresh"; whole-file answers to `.new` | [11 §1](11-integrity-resume-retry.md#1-never-lose-or-mix-bytes-the-phase-1-rules) | Not described | A page could replace saved bytes | high |
| Failure kinds; Link expired and File changed are paused, not failed | [11 §2](11-integrity-resume-retry.md#2-failure-kinds-and-where-each-one-ends) | start/pause/resume/retry | No failure taxonomy | high |
| Same-file proof R1-R7 (bytes decide, headers never alone) | [11 §3](11-integrity-resume-retry.md#3-the-same-file-proof-verdicts-r1-to-r7) | Only "206 or not" | No proof | high |
| Proof windows (≤ 4 × 64 KiB, chosen to catch swaps) | [11 §4](11-integrity-resume-retry.md#4-which-bytes-are-compared-the-proof-windows) | None | — | high |
| Resume probe carries window 0 (`bytes=0-65535` + If-Range) | [11 §5](11-integrity-resume-retry.md#5-the-resume-probe-window-0-rides-on-it) | Not described | — | high |
| Unstable validators: prove, adopt, stop trusting after 2 slips in 10 min | [11 §6](11-integrity-resume-retry.md#6-validators-that-cannot-be-trusted-r6) | Not described | CDN edges may read as "changed" | medium |
| File changed: ≤ 1 MiB quiet restart (2 per 10 min), else ask; Start over / Keep partial | [11 §7](11-integrity-resume-retry.md#7-a-file-that-really-changed-restart-quietly-or-stop-and-ask) | Not described | — | high |
| Server checksums; completion check | [11 §8](11-integrity-resume-retry.md#8-server-checksums-and-the-completion-check) | Not described | — | medium |
| Durable byte accounting | [11 §9](11-integrity-resume-retry.md#9-writing-bytes-and-knowing-which-bytes-are-really-on-disk) | Not described | Saved progress may claim unwritten bytes | high |
| Store safety: atomic, flushed `.bak`, `.corrupt`, rebuild from journals, session-clean flag | [11 §10](11-integrity-resume-retry.md#10-the-download-list-atomic-saves-a-flushed-backup-and-a-rebuild-from-journals) | `DownloadStore` exists | Recovery from a corrupt store not described | high |
| Block hash record (ledger) and journal | [11 §11](11-integrity-resume-retry.md#11-the-block-hash-record-the-ledger-and-its-journal) | None; the vault authenticates only the whole blob | — | medium |
| Seals and durable flush; dirty mark | [11 §12](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers) | Not described | — | high |
| Check before every resume after an unclean end | [11 §13](11-integrity-resume-retry.md#13-crash-and-power-loss-recovery-the-check-before-every-resume) | Not described | Can't tell which saved bytes are good after a kill | high |
| Resume after pause, quit, sleep, restart; "the person paused" vs "the system stopped" | [11 §14](11-integrity-resume-retry.md#14-resume-after-pause-quit-sleep-and-restart) | Background URLSession exists | Re-queue rules not described | high |
| Retry like IDM (classes, 4 s × k, standby, 150/s cap) | [11 §15](11-integrity-resume-retry.md#15-retrying-like-idm-the-owners-decision-of-2026-10-21) | "Retry" | — | medium |
| Quiet stretch rejoin proof; waits outside a run | [11 §16](11-integrity-resume-retry.md#16-quiet-stretches-waiting-for-network--retrying-the-rejoin-proof-and-waits-outside-a-run) | Not described | — | high |
| Early Pause/Cancel kept (before start, after last byte) | [11 §18](11-integrity-resume-retry.md#18-aborts-that-come-early-are-never-lost-early-aborts-kept) | Not described | — | high |
| Expiry time read from signed URLs | [11 §19](11-integrity-resume-retry.md#19-expired-links-reading-the-expiry-time-from-the-url) | Not described | An expired signed link just fails | high |
| Renewal from the original address and redirect chain; schedule 2 min / 15 min / 1 h / 6 h | [11 §20](11-integrity-resume-retry.md#20-renewing-the-link-the-original-address-the-schedule-and-adopting-a-proven-address) | Not described | — | high |
| A re-click on the page attaches to the waiting row | [11 §21](11-integrity-resume-retry.md#21-attaching-a-download-started-again-on-its-page-and-the-keep-partial-helpers) | Not described | Probably a new item every time | medium |
| Check file / Repair / Restore original | [11 §25](11-integrity-resume-retry.md#25-finished-files-check-file-repair-restore-original) | None | The vault detects damage, can't locate it | low |

### a4. The download manager

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| One app-wide engine; batched view events (~4 a second) | [12 §1](12-download-manager.md#1-one-engine-for-the-whole-app-and-what-windows-see) | `DownloadManager` | Event batching and record/view split not described | medium |
| State + `need` + `wait` (+ `phase`) | [12 §2](12-download-manager.md#2-the-rows-state-machine) | start/pause/resume/retry | No paused reasons, no automatic waits | high |
| FIFO queue, 2 at a time, strictly increasing stamps | [12 §3](12-download-manager.md#3-the-queue-two-at-a-time-strict-order) | Not described | — | high |
| Take-over of page downloads with a parallel probe | [12 §5](12-download-manager.md#5-taking-over-downloads-that-pages-start-in-firefox) | `decidePolicyFor` → `.download` → `WKDownload` → staging → vault | Single connection; no probe-then-fallback | high |
| Mirrored downloads: reason saved; never replay a POST | [12 §6](12-download-manager.md#6-mirrored-downloads-left-to-firefox) | `WKDownload` adoption | Reason, resume data and "no replay" not described | high |
| Request identity: cookies, cross-site rule, pasted address sends no Referer | [12 §7](12-download-manager.md#7-whose-request-it-is-cookies-principal-referrer-and-the-cross-site-rule) | Not described | Which cookies/Referer the tasks send is unknown | high |
| Referrer policy (8 policies) computed by the app | [12 §8](12-download-manager.md#8-referrer-policy-referrerts) | Not described | — | medium |
| Private downloads never written to disk | [12 §9](12-download-manager.md#9-private-window-downloads) | Not described | — | high (if TitleLess has private tabs) |
| Naming pipeline with a security pass | [12 §10](12-download-manager.md#10-file-naming) | Not described | — | high |
| Unique names reserved at start, case-insensitively, also against other rows | [12 §11](12-download-manager.md#11-unique-names-reserved-names-and-duplicates) | Not described | — | high |
| Categories for filters | [12 §12](12-download-manager.md#12-categories-no-category-folders) | Not described | — | low |
| Commands without races (Pause shows paused at once; "last word wins") | [12 §14](12-download-manager.md#14-the-persons-commands-and-their-careful-edges) | Not described | — | high |
| One classification of how a run ends | [12 §15](12-download-manager.md#15-how-a-run-ends-one-classification-stopped) | Not described | — | high |
| Waits with one timer; network back brings them to 5 s | [12 §16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer) | Not described | — | high |
| Re-click / pasted link continues the old row | [12 §17](12-download-manager.md#17-starting-it-again-on-its-page-pre-match-attach-refresh-address) | Not described | — | medium |
| Per-site rules: YouTube note, terms reminder, Cloudflare challenge = Link expired | [12 §19](12-download-manager.md#19-per-site-rules-sitets-sitests-and-the-few-others) | No site rules | — | medium |
| Persistence of the list (atomic, `.bak`, clean flag) | [12 §20](12-download-manager.md#20-persistence-of-the-list) | `DownloadStore` | Safety rules not described | high |
| Continue after restart (only what the system stopped) | [12 §21](12-download-manager.md#21-start-up-and-continue-unfinished-downloads-when-deer-starts) | Not described | — | high |
| Settings: connections, speed limit, continue on start | [12 §24](12-download-manager.md#24-how-settings-feed-the-engine) | Not described | — | medium |

### a5. HLS and DASH streams

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| Playlist detection by content | [21](21-hls-dash-engine.md#reading-a-playlist-detection-and-hls-line-parsing) | ".m3u8" in the URL | No `#EXTM3U` check | high |
| Master ladder; quality fingerprint for re-picks | [21](21-hls-dash-engine.md#master-playlists-variants-the-ladder-and-which-quality-is-downloaded) | First playlist wins | No ladder, no fingerprint | high |
| Separate audio rendition as a second track; never a silent language switch | [21](21-hls-dash-engine.md#alternate-audio-renditions-ext-x-media-and-subtitles) | Remux "TS/fMP4 into one MP4" | Whether a separate audio rendition is fetched is unknown | high |
| Media playlist parsing (sequence, VOD, byte ranges, MAP, key per segment) | [21](21-hls-dash-engine.md#media-playlist-parsing-segments-durations-sequence-byte-ranges-init-keys) | Fetches playlists and segments | Sequence/VOD handling unknown | high |
| DRM refusal (SAMPLE-AES, vendor KEYFORMAT, SESSION-KEY, ContentProtection) | [21](21-hls-dash-engine.md#drm-refusal-sample-aes-widevine-playready-fairplay-dash-contentprotection) | AES-128 decrypt | Refusal of anything else unknown | high |
| Live refusal | [21](21-hls-dash-engine.md#live-and-event-playlists) | Not described | — | medium |
| DASH in the same segment model | [21](21-hls-dash-engine.md#dash-manifest-parsing-mpd) | No DASH | Whole format missing | medium |
| Parallel fetch, in-order write, RAM cap then spill, write back-pressure | [21](21-hls-dash-engine.md#parallel-segment-fetching-with-in-order-writing) | Not described | — | high |
| Hedge an overdue head segment | [21](21-hls-dash-engine.md#racing-an-overdue-segment-hedging) | Not described | — | high |
| Per-segment retries; 429/503 connection steps aside | [21](21-hls-dash-engine.md#per-segment-retries-and-connections-that-step-aside) | Not described | — | high |
| Byte-range pieces with If-Range proven by bytes | [21](21-hls-dash-engine.md#byte-range-pieces-and-if-range-ext-x-byterange-dash-segmentbase-hls-slips-counted-after-the-proof) | Not described | — | medium |
| Init segment fetched first, refused init looked up as init | [21](21-hls-dash-engine.md#init-segments-ext-x-map-dash-initialization) | fMP4 remux exists | Refused-init handling unknown | high |
| AES-128: one key fetch per URL, IV from media sequence, refused key refreshes | [21](21-hls-dash-engine.md#aes-128-decryption-key-fetch-and-iv-rules) | Decrypts AES-128 | Check the IV rule and key refresh | high |
| Segment sniffing (a page or JSON never written) | [21](21-hls-dash-engine.md#is-it-media-segment-sniffing-a-page-or-json-is-never-written) | Not described | Likely missing | high |
| Segments disguised as images | [21](21-hls-dash-engine.md#segments-disguised-as-images) | Not described | — | low |
| Refresh an expired segment address from a fresh playlist, by media sequence | [21](21-hls-dash-engine.md#expired-addresses-inside-a-run-refreshing-the-media-playlist-g2-step-1) | Not described | Likely missing | high |
| Renewal of expired playlists (master re-read, re-pick by fingerprint) | [21](21-hls-dash-engine.md#renewal-steps-when-a-playlist-or-master-expires-g2-steps-2-4) | Not described | — | medium |
| Segment table + resume proof (sequence, then time) | [21](21-hls-dash-engine.md#resume-of-a-half-done-stream-the-proof-and-where-to-continue) | Pause/resume exists | No proof, no sequence/time mapping | high |
| Check the saved part (cut short, damaged) | [21](21-hls-dash-engine.md#checking-the-saved-part-cut-short-damaged-changed-by-another-program) | Not described | — | medium |
| Durable progress marks | [21](21-hls-dash-engine.md#durable-progress-marks-and-snapshot) | Not described | — | medium |
| Changed stream: quiet restart or File changed | [21](21-hls-dash-engine.md#a-changed-stream-silent-restart-or-file-changed) | Not described | — | medium |
| Join without re-encoding; keep the tracks if the join fails | [21](21-hls-dash-engine.md#joining-the-tracks-with-ffmpeg-mp4-or-webm-faststart-and-life-without-ffmpeg) | `TSRemuxer` (AVAssetWriter passthrough) | Fallback on failure unknown | high |
| Crash-safe merge window | [21](21-hls-dash-engine.md#the-merge-crash-window) | Not described | — | high |
| Output length check (max(2 s, 2 %)) | [21](21-hls-dash-engine.md#length-check-after-the-merge) | Not described | — | high |
| Keep partial file (trim to the shorter track) | [21](21-hls-dash-engine.md#keep-partial-file-duration-trimming-with--t) | Not described | — | medium |
| Size estimate from bytes per media second | [21](21-hls-dash-engine.md#size-estimate-and-progress) | Not described | — | medium |

### a6. Outside tools (yt-dlp, Deno, ffmpeg)

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| yt-dlp, Deno and ffmpeg as child processes, installed on request | [22 §1-§3](22-ytdlp-ffmpeg.md#1-when-deer-hands-a-page-to-yt-dlp), [§14-§17](22-ytdlp-ffmpeg.md#14-installing-yt-dlp-and-deno-on-request) | None | Not portable | n/a |
| Know where sniffing cannot work; say so | [22 §1](22-ytdlp-ffmpeg.md#1-when-deer-hands-a-page-to-yt-dlp) | None | YouTube pages give nothing or the wrong thing, silently | medium |
| Format choice: one per height, H.264 first, original-language sound | [22 §5](22-ytdlp-ffmpeg.md#5-building-the-quality-list-format-selection) | First playlist | — | high |
| Codec to container table | [22 §6](22-ytdlp-ffmpeg.md#6-codec-to-container-rules---merge-output-format-containerfor) | Assumes the codecs fit MP4 | No rule to pick what AVFoundation can write | high |
| Combined progress for sequential parts; phases | [22 §7](22-ytdlp-ffmpeg.md#7-the-download-run-arguments-and-progress-parsing) | Not described | — | medium |
| Record the chosen formats; compare on every resume (1 s, 0.1 %) | [22 §9](22-ytdlp-ffmpeg.md#9-resume-check-record-the-formats-at-the-start-ask-again-judge) | Not described | A re-encoded stream could be mixed | high |
| Per-row file ownership (Cancel deletes only its own files) | [22 §8](22-ytdlp-ffmpeg.md#8-pause-resume-and-yt-dlps-own-part-files) | Not described | — | medium |
| Single-flight lookups, 60 s cache, 2 in background, per-site budget | [22 §12](22-ytdlp-ffmpeg.md#12-sharing-yt-dlps-answers-one-run-per-page-a-short-cache-two-at-a-time-a-per-site-budget) | Not described | Many rows could hammer one site | medium |
| Verified asset install (checksum list, temp name, verify, atomic swap) | [22 §14](22-ytdlp-ffmpeg.md#14-installing-yt-dlp-and-deno-on-request) | — | Useful only for data assets | low |
| Terms reminder once per big video host | [22 §18](22-ytdlp-ffmpeg.md#18-settings--video-downloads-and-the-windows-notes) | None | — | medium |

### a7. UX and tests

| Deer mechanism | Deer section | TitleLess today | Gap | iOS value |
|---|---|---|---|---|
| One state model for every surface; 19-step status ladder | [30 M1](30-ux-tests-history.md#mechanism-1-one-state-model-for-every-surface-state-phase-need-wait) | Not described | — | high |
| UI updates coalesced to one per frame | [30 M2](30-ux-tests-history.md#mechanism-2-the-windows-copy-of-the-list-updated-once-per-frame) | Not described | Per-chunk publishing causes jank | high |
| Number wording; speed over 3 s; average over active time; ETA "—" when unknown | [30 M3](30-ux-tests-history.md#mechanism-3-numbers-and-dates-in-words-formatts-and-how-speed-and-eta-are-measured) | Not described | — | high |
| Primary verb that never destroys bytes | [30 M5](30-ux-tests-history.md#mechanism-5-a-row-columns-the-primary-verb-and-space-never-destroys-bytes) | Retry exists | Nothing protects saved bytes from an accidental restart | high |
| Details: 8-block bar, caption sentence, history line, per-state actions | [30 M6](30-ux-tests-history.md#mechanism-6-the-details-pane-connections-bar-caption-history-line-facts-actions) | Not described | — | medium |
| "Use another address…" proven by bytes | [30 M8](30-ux-tests-history.md#mechanism-8-use-another-address-paste-a-new-link-for-the-same-file) | None | — | high |
| Needs attention without dialogs (dot, one announcement) | [30 M9](30-ux-tests-history.md#mechanism-9-needs-attention-without-dialogs-ring-dot-live-region-counts) | Not described | — | high |
| Ring and quick view | [30 M10](30-ux-tests-history.md#mechanism-10-the-ring-progress-arc-showhide-flight-animation), [M11](30-ux-tests-history.md#mechanism-11-the-quick-view-above-the-ring) | Not described | iOS: toolbar badge + sheet | medium |
| Quit prompt; continue what the system stopped | [30 M13](30-ux-tests-history.md#mechanism-13-quit-restart-and-closing-the-last-private-window) | Not described | iOS: background/termination instead | low (the rule: high) |
| History lines for every automatic fix | [30 M16](30-ux-tests-history.md#mechanism-16-history-lines-every-automatic-fix-leaves-a-sentence) | Not described | Self-healing would be invisible | high |
| No system notifications (desktop choice) | [30 M18](30-ux-tests-history.md#mechanism-18-no-system-notifications-a-deliberate-choice) | Not described | iOS differs: notify when in the background | medium |
| Local fault server with a request log | [30 M19](30-ux-tests-history.md#mechanism-19-the-test-harness-how-the-checks-are-built) | No test suite described | — | high |
| About 110 scenarios as a checklist | [30 M20](30-ux-tests-history.md#mechanism-20-the-test-suite-as-a-checklist) | No test suite described | — | high |

---

## b. iOS ground rules

These platform facts decide the design. Each one names the Deer mechanism it affects.

### b1. Two kinds of URLSession

- **Foreground sessions** (`URLSessionConfiguration.default` or `.ephemeral`) run inside the app. A **data task**
  gives the response head first (`urlSession(_:dataTask:didReceive:completionHandler:)`, where you answer
  `.allow` or `.cancel`) and then the body in chunks (`urlSession(_:dataTask:didReceive:)` with `Data`). So you can
  check the head before writing, sniff the first bytes, write each chunk at any file offset, and cancel at once.
  This is the only kind that fits Deer's engine ([10 §1](10-multi-connection-engine.md#1-one-request--one-channel-the-request-layer),
  [§9](10-multi-connection-engine.md#9-checking-each-answer-before-writing), [§10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes)).
  Foreground tasks stop when the app is suspended; when the app comes back they typically end with an error
  such as `URLError.networkConnectionLost` (exact codes unverified). Treat that as a "cut" and continue from the
  durable frontier.
- **Background sessions** (`URLSessionConfiguration.background(withIdentifier:)`) hand the transfer to a system
  process. Transfers continue while the app is suspended or after the **system** terminated it. The app is
  relaunched in the background to collect results (`application(_:handleEventsForBackgroundURLSession:completionHandler:)`,
  then `urlSessionDidFinishEvents(forBackgroundURLSession:)`; `sessionSendsLaunchEvents` must be `true`, which is the
  default). At launch, re-create the session with the **same identifier** so the system can hand the old tasks back.
- What a background session supports: **download tasks**, and **upload tasks from a file** (an upload from `Data` or
  a stream fails after the app exits). Only http and https. The session **must** have a delegate: completion-handler
  methods are not supported (Apple DTS: a background session cannot run a closure that captured the app's state). A
  data task can be created in a background session, but it fails when the app is suspended (Apple DTS), so it is
  useless for Deer's engine.
- The body of a download task arrives as a whole temporary file in `urlSession(_:downloadTask:didFinishDownloadingTo:)`.
  The file exists only until that method returns, so move it inside the method. You see no bytes while they
  arrive: no head check before writing, no sniffing until the end.
- **Redirects in a background session are always followed, and `willPerformHTTPRedirection` is not called.** So
  the app cannot record redirect hops (Deer's renewal list, [11 §20](11-integrity-resume-retry.md#20-renewing-the-link-the-original-address-the-schedule-and-adopting-a-proven-address))
  or re-apply headers on a hop. The finished task's `response.url` should show where it ended (general URLSession
  behaviour; not checked for background sessions).
- A background download task that fails with a timeout is **retried by the system** by itself;
  `timeoutIntervalForResource` (default 7 days) bounds how long.
- **The system decides when background tasks run.** `isDiscretionary = true` lets the system wait for good
  conditions (Wi-Fi, power). A task **started while the app is in the background is treated as discretionary**, even
  when the flag is `false`. Apple's AVFoundation page says the same in other words: a non-discretionary download
  task can only be started while the app is in the foreground. So tasks created on the way to the background may
  wait for Wi-Fi and charging.
- **A rate limiter** (documented by Apple): each time the system resumes or relaunches the app for a background
  session, a delay grows; a new task started from the background does not begin until the delay has passed. The
  delay resets to 0 when the person brings the app to the foreground. Apple's advice: use one background session
  (or a few), start many tasks at once, and prefer fewer, larger transfers over thousands of small ones.
- **Force-quit.** If the person closes the app in the app switcher, the system **cancels all of the session's
  background transfers** and does not relaunch the app; nothing continues until the person opens it again
  (Apple's `background(withIdentifier:)` page). A system termination (memory, update) is different: transfers
  continue and the app is relaunched.
- **resumeData** (`cancel(byProducingResumeData:)`, or `NSURLSessionDownloadTaskResumeData` in the error's
  `userInfo`). Apple's conditions: the resource has not changed since the first request; the task is an HTTP(S)
  **GET**; the server sent an **ETag or Last-Modified**; the server supports **byte ranges**; and the system has
  not deleted the temporary file to free space. It is opaque: you cannot check which bytes it continues. Deer's
  "prove with bytes" ([11 §3](11-integrity-resume-retry.md#3-the-same-file-proof-verdicts-r1-to-r7)) can only be
  applied after the fact (compare a window, check the final hash).
- **Range in download tasks.** `Range` and `If-Range` are not on Apple's list of reserved headers (b2), so a
  download task may carry them. That the file then holds only the 206 body is what HTTP says, but Apple does not
  document it for download tasks: foreground (unverified), background session (unverified). Test both against
  the local server before building on it. If it works, Deer's one-file-per-part layout
  ([10 §22](10-multi-connection-engine.md#22-idms-layout-on-drives-without-sparse-files-parts--join)) is the right
  shape for background transfers.

### b2. Connections per host, HTTP/2 and HTTP/3

- `httpMaximumConnectionsPerHost` limits **HTTP/1.1** connections to one host. Apple: the default is **6** (one value,
  no separate iOS number), the limit is **per session** (an app with several sessions can open more in total), a session may use a lower limit on some networks, and **HTTP/2 and later ignore it** because
  they run many requests over one connection.
- URLSession uses HTTP/2 automatically, and HTTP/3 (over QUIC, which runs on UDP) since iOS 15 when the server
  advertises it (an `Alt-Svc` header or a DNS HTTPS record; `URLRequest.assumesHTTP3Capable` skips the discovery).
  The first request to a new host may still use HTTP/2 (WWDC21 "Accelerate networking with HTTP/3 and QUIC").
  Inside **one session**, tasks to one HTTP/2 or HTTP/3 host share **one** connection (the Apple sentence above).
  Then "8 ranges" can be 8 streams inside one connection, which is exactly the problem Deer's lanes solve
  ([10 §7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection),
  [§23](10-multi-connection-engine.md#23-http2-vs-http11-what-changes); on a real CDN over HTTP/2 Deer measured
  3.3 MB/s on one connection and 14.3 MB/s on 8 lanes).
- Whether two separate `URLSession` instances can share one HTTP/2 or HTTP/3 connection: Apple's per-session
  wording suggests they do not, but it is not stated (unverified). Measure it:
  `urlSession(_:task:didFinishCollecting:)` gives `URLSessionTaskMetrics.transactionMetrics`, each with
  `networkProtocolName` ("h2", "http/1.1", "h3"), `isReusedConnection`, `localPort` and `remotePort`. Distinct
  local ports mean distinct connections (TCP for h2 and http/1.1, UDP for h3).
- `timeoutIntervalForRequest` is an idle timeout: the timer restarts whenever new data arrives (Apple; default
  60 s). Deer uses 30 s ([10 §12](10-multi-connection-engine.md#12-stall-and-slow-detection-cutting-a-bad-connection)).
  `timeoutIntervalForResource` is the total time for the whole resource (default 7 days).
- For downloads set `urlCache = nil` and `requestCachePolicy = .reloadIgnoringLocalCacheData`.
- URLSession adds its own `Accept-Encoding` and decompresses gzip/deflate/br by itself (unverified which encodings
  on each iOS version). For Range requests send `Accept-Encoding: identity` explicitly. Apple's reserved headers
  (which the system may ignore or overwrite) are only `Content-Length`, `Authorization`, `Connection`, `Host`,
  `Proxy-Authenticate`, `Proxy-Authorization` and `WWW-Authenticate`; `Accept-Encoding`, `Range` and `If-Range`
  are not among them. Whether URLSession sends `identity` unchanged is still unverified: the test server's request
  log records `Accept-Encoding`, so a test can check it.
- Redirects (foreground sessions): `urlSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`
  shows each hop. Record the hops (Deer keeps up to 8 for renewal, [11 §20](11-integrity-resume-retry.md#20-renewing-the-link-the-original-address-the-schedule-and-adopting-a-proven-address)).
  Whether custom headers (`Range`, `If-Range`, `Referer`) survive a redirect: unverified; copy them onto
  `newRequest` yourself. In a **background** session this method is never called (b1).

### b3. Leaving the app, and background time

- When the app leaves the screen it gets a few seconds, then it is **suspended** (Apple: `applicationDidEnterBackground(_:)`
  has five seconds to do its work and return). `beginBackgroundTask(withName:expirationHandler:)` asks for extra
  time. Apple's documentation gives **no number**; read `backgroundTimeRemaining`. An Apple DTS engineer's forum
  note says to expect about 30 s on current systems; never rely on a number. Apple also says: call it **before**
  the work starts (not only when going to the background), and call `endBackgroundTask(_:)` as soon as you are
  done, or the system terminates the app. Use it to **seal**: close files, flush, save the list
  ([11 §12](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers)).
- A suspended app can be **terminated without any callback** (memory pressure, system update). Apple: for apps that
  support background execution, `applicationWillTerminate(_:)` is generally not called when the person quits; it may
  be called when the app is running in the background (not suspended) and the system must end it, and then it has
  about five seconds. So on iOS "a clean exit" can only mean "sealed when going to the background", and every other
  end must be treated as unclean ([11 §13](11-integrity-resume-retry.md#13-crash-and-power-loss-recovery-the-check-before-every-resume)).
- **BGContinuedProcessingTask** (iOS and iPadOS **26.0+**, Background Tasks framework). Checked against Apple's
  class page, the article "Performing long-running tasks on iOS and iPadOS" and WWDC25 session 227 "Finish tasks in
  the background":
  - It **starts in the foreground** and may keep running after the person leaves the app. It must start from an
    **explicit action** of the person (a tap). Apple says to avoid automatic work (maintenance, backups, syncing);
    such tasks may be cancelled.
  - Identifier: listed in `Info.plist` under `BGTaskSchedulerPermittedIdentifiers`, prefixed with the bundle ID.
    Continued-processing identifiers may use a wildcard ending `.*`; the app adds its own suffix (for example a
    download's id) when it registers and submits.
  - Unlike other BG tasks, the launch handler does **not** have to be registered at launch: register it
    (`BGTaskScheduler.shared.register(forTaskWithIdentifier:using:launchHandler:)`) when the person acts, then
    submit `BGContinuedProcessingTaskRequest(identifier:title:subtitle:)` with `BGTaskScheduler.shared.submit(_:)`.
  - `strategy`: `.queue` (the default: wait in a queue when the system has no room) or `.fail` (fail at once if it
    cannot start now).
  - The system shows the title, subtitle and progress in a **Live Activity**; the person can cancel it there. The
    task conforms to `ProgressReporting`: update `task.progress` often. Tasks that report little or no progress are
    **expired first** under resource pressure, and the system may ask the person whether a slow task should go on.
  - `expirationHandler` is called when the system stops the task **and** when the person cancels it: seal there.
    Call `setTaskCompleted(success:)` when done.
  - The network may be used in the background (Apple's article says so). No time limit is documented.
  - If the person closes the app in the app switcher, running tasks are cancelled and the app gets **no**
    indication. So the next launch must treat it as an unclean end.
  - Using the GPU needs an extra entitlement (not needed for downloads).
  This is the best fit for keeping Deer's foreground engine (many connections, HLS) running when the person switches
  apps. One task per person-started download (or one per batch) is a design choice; how many can run at once is not
  documented (unverified). Do not submit one for automatic work such as "continue unfinished downloads" at launch
  or a scheduled renewal.
- `BGAppRefreshTask` and `BGProcessingTask` run when the system decides (often much later). They suit Deer's
  "next try" of a Link-expired renewal ([12 §16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer)),
  not transfers.

### b4. Files on iOS

- **File protection classes:** `.complete` (no access while the device is locked), `.completeUnlessOpen` (a file
  opened before locking stays writable; new files can be created while locked), `.completeUntilFirstUserAuthentication`
  (usable after the first unlock since boot; the default for app files), `.none`. A download that keeps writing
  while the phone is locked needs its staging files and the store in `.completeUntilFirstUserAuthentication` or
  `.completeUnlessOpen`. If the vault uses `.complete`, the final move into the vault must wait until the device is
  unlocked (`UIApplication.protectedDataDidBecomeAvailableNotification`, or the app delegate's
  `applicationProtectedDataDidBecomeAvailable(_:)`; Apple suggests closing `.complete` files in
  `applicationProtectedDataWillBecomeUnavailable(_:)`). TitleLess's vault class: not described. (These four
  classes and the default are as Apple's "Encrypting your app's files" describes them.)
- **Positional writes:** `FileHandle.seek(toOffset:)` + `write(contentsOf:)` share one file position, so several
  connections must not share one `FileHandle` without a lock. Better: `pwrite(2)`, or `FileDescriptor.write(toAbsoluteOffset:_:)`
  / `writeAll(toAbsoluteOffset:_:)` from Apple's System framework (iOS 14+; Apple names `pwrite` as the C function
  underneath), which leave the descriptor's own offset unchanged. `writeAll` writes every byte or throws. Simplest
  correct design: one serial actor per file that owns the descriptor.
- **Sparse files on APFS:** Apple documents that APFS (the iOS file system since iOS 10.3) supports sparse files:
  blocks are allocated only when written, and a `FileHandle` that seeks past the end and writes leaves the gap
  unallocated. Growing a file with `ftruncate` / `FileHandle.truncate(atOffset:)` is not mentioned by Apple
  (unverified; measure `URLResourceValues.totalFileAllocatedSize` against the file size). Apple notes that filling
  the gaps later makes the file's blocks out of order (fragmentation), usually without a significant cost. So Deer's
  NTFS zero-fill problem ([10 §10](10-multi-connection-engine.md#10-writing-the-bytes-one-part-positional-writes))
  should not exist on iOS. Pre-sizing also reserves no space, so a room check is still needed.
- **Durability:** `FileHandle.synchronize()` writes the file's data to permanent storage (Apple's wording); that it calls
  `fsync` underneath is unverified. Apple's `fsync(2)` man page (iPhoneOS edition): `fsync` moves the data to the
  drive, but the drive may write it later and out of order. `fcntl(fd, F_FULLFSYNC)` asks the drive to flush its
  buffers. Apple's "Reducing disk writes" (iOS): avoid `fsync` and `F_FULLFSYNC` when possible (extra writes, wear,
  slower); most apps that need a write barrier can use `fcntl(fd, F_BARRIERFSYNC)`; use `F_FULLFSYNC` only when
  you need strong persistence, and even then sudden power loss can lose data. Deer's design does not need flushes
  to be correct (the dirty mark and block hashes find bad bytes); flushes only shorten the re-check. A suggestion
  of this study, not measured: on iOS use `F_BARRIERFSYNC` before a seal line or a list save that must land after
  the data, and keep `F_FULLFSYNC` off the hot path.
- `Data.write(to:options: .atomic)` writes a temporary file and renames it; Apple notes that this costs extra writes,
  so use it only where needed (the store, not progress ticks). Whether it also flushes: unverified; call
  `synchronize()` (or `F_BARRIERFSYNC`) on a `FileHandle` for important saves.
- **Free space:** `URLResourceValues.volumeAvailableCapacityForImportantUsage` (what the system can free for
  important work).
- **Where to keep files:** staging files, the store and journals in Application Support (the system may empty
  `tmp` and purge `Caches`). Set `isExcludedFromBackup = true` on staging files and journals.
- **Names:** `/` is not allowed; `:` is best avoided; a leading `.` hides the file; the limit is 255 UTF-8 bytes
  (`NAME_MAX`; the exact APFS rule was not checked: unverified);
  bidi-override characters (U+202A-202E, U+2066-2069) can fake an extension ([12 §10](12-download-manager.md#10-file-naming)).

### b5. Network conditions

- `NWPathMonitor` gives `path.status` (`.satisfied`, `.unsatisfied`, `.requiresConnection`), `isExpensive`
  (cellular, personal hotspot), `isConstrained` (Low Data Mode) and `usesInterfaceType(.wifi / .cellular)`. Use it
  as Deer's "network is back" signal (bring network waits to 5 s, [12 §16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer))
  and to use fewer connections on expensive or constrained paths.
- `URLSessionConfiguration` and `URLRequest` have `allowsExpensiveNetworkAccess`, `allowsConstrainedNetworkAccess`
  and `allowsCellularAccess`. A refused task fails with a `URLError` whose `networkUnavailableReason` (iOS 13+) is
  `.cellular`, `.expensive` or `.constrained` (Low Data Mode): show a wait ("Waiting for Wi-Fi"), not a failure.
  Newer SDKs also list `.ultraConstrained`, `NWPath.isUltraConstrained` and
  `URLSessionConfiguration.allowsUltraConstrainedNetworkAccess` (iOS 26.1+); Apple's pages give no description of
  them yet (meaning unverified). Treat `.ultraConstrained` as a wait too.
- `waitsForConnectivity = true` makes a task wait for a network **while it connects** instead of failing at once
  (`urlSession(_:taskIsWaitingForConnectivity:)`). A connection that drops later still fails (for example with
  `NSURLErrorNetworkConnectionLost`). Background sessions ignore the property: they always wait. For the
  multi-connection engine, Deer-style own waits give better row states.

### b6. Sending requests with the web view's identity

- WKWebView keeps its own cookies in `WKWebsiteDataStore.httpCookieStore` (a `WKHTTPCookieStore`), separate from
  `HTTPCookieStorage.shared`. Before each request: `await cookieStore.allCookies()`, filter by domain, path,
  secure and expiry, and build the header with `HTTPCookie.requestHeaderFields(with:)`. Set
  `httpShouldSetCookies = false` on the session so URLSession does not add its own. HttpOnly cookies should be in
  `allCookies()` (unverified).
- Cross-site rule ([12 §7](12-download-manager.md#7-whose-request-it-is-cookies-principal-referrer-and-the-cross-site-rule)):
  when one site starts a download from another site, leave out cookies whose `HTTPCookie.sameSitePolicy` is
  `.sameSiteStrict` or `.sameSiteLax`.
- Cookies the download server sets come back only to your session; copy them into the web view's store if the page
  needs them later.
- Private tabs (a `WKWebsiteDataStore.nonPersistent()`): take cookies from that store, use an ephemeral session,
  never save the row ([12 §9](12-download-manager.md#9-private-window-downloads)).
- **User-Agent:** read it once (`evaluateJavaScript("navigator.userAgent")`, or TitleLess's `customUserAgent`) and
  send it on every download request; some signed links are bound to it.
- **Referer and Origin** are ordinary headers on `URLRequest`. Compute the Referer with the page's referrer policy
  ([12 §8](12-download-manager.md#8-referrer-policy-referrerts)); the user script can read `document.referrerPolicy`
  and a link's `referrerpolicy` / `rel=noreferrer`. A pasted address sends no Referer and no Origin.
- **WKDownload** (iOS and iPadOS **14.5+**) uses the web view's own network stack and cookies. It is the safe path
  for everything you cannot repeat yourself: POST answers, `blob:`, `data:`, one-time links
  ([12 §6](12-download-manager.md#6-mirrored-downloads-left-to-firefox)). It can pause with
  `cancel { resumeData in }` and continue with `webView.resumeDownload(fromResumeData:completionHandler:)`;
  `webView.startDownload(using:completionHandler:)` starts one from a request. `download.originalRequest` gives the
  request that started it (its method and URL).

### b7. What WKWebView can and cannot see

- **No API shows the web view's http(s) requests or responses.** `WKURLSchemeHandler` works only for custom
  schemes: Apple says registering a scheme WebKit already handles, such as `https`, is a programmer error and
  raises `invalidArgumentException` (check with `WKWebView.handlesURLScheme(_:)`). Content rule lists can block
  requests but not report them. Deer's
  "network eye" ([20 M1](20-video-detection.md#mechanism-1-the-network-eye-classifying-every-response)) has no
  direct iOS equivalent.
- `webView(_:decidePolicyFor navigationResponse:decisionHandler:)` shows the response head (status, MIME, headers
  through `HTTPURLResponse`) only for navigations (main frame and subframes). Media, XHR and fetch never pass there.
- Everything else comes from injected JavaScript (`WKUserScript`, `.atDocumentStart`, `forMainFrameOnly: false`):
  - `PerformanceObserver({type: 'resource', buffered: true})`: URLs and `initiatorType` of loaded resources. No
    MIME type in practice: the newer `contentType` field is not supported by all browsers (MDN marks it as not
    Baseline), and whether WebKit on iOS fills it is unverified, so do not rely on it. Sizes only for
    same-origin resources or with `Timing-Allow-Origin`. The default buffer is small;
    raise it with `performance.setResourceTimingBufferSize`. Whether the requests of native HLS playback (made by
    the media stack, not the page) appear here: unverified, probably not.
  - Wrapping `fetch` and `XMLHttpRequest` (in the page world) gives the URL and the response `Content-Type` of
    script requests, such as the playlists hls.js loads.
  - Hooking `MediaSource` / `ManagedMediaSource` (`addSourceBuffer`) tells you the page uses MSE; what it appends
    are segments, not a file.
  - Media elements give `currentSrc`, `videoWidth`, `videoHeight`, `duration` (`Infinity` = live), `paused`,
    `mediaKeys`, and events (`loadedmetadata`, `play`, `encrypted`). On iPhone many sites play native HLS, so
    `currentSrc` is often the master playlist itself, sometimes without `.m3u8` in it.
  - DRM: wrap `navigator.requestMediaKeySystemAccess`; listen in the capture phase for `encrypted`; the legacy
    WebKit names (`WebKitMediaKeys`, `webkitneedkey`, `webkitKeys`) may also exist (unverified per iOS version).
- **Content worlds:** `WKContentWorld.page` shares globals with the page (needed to wrap page functions, but the
  page can see and break your wrappers). A named world (`WKContentWorld.world(name:)`) is isolated: use it to read
  DOM facts safely. `WKScriptMessage.frameInfo` says which frame sent a message (`isMainFrame`, `request.url`,
  `securityOrigin`).
- `webView(_:didCommit:)` marks a new main-frame document. Same-document changes (`history.pushState`) do not call
  it: hook `pushState` / `replaceState` / `popstate` in the script, or observe `webView.url` with KVO (unverified for
  every case).
- A WKWebView that is not on screen, or whose app is in the background, is throttled or suspended (unverified
  details). A hidden "page step" web view is a foreground-only idea.

### b8. AVFoundation: what it can join

- `AVAssetWriter` writes file formats such as QuickTime movie and MPEG-4 (Apple's overview gives these two as
  examples; it can also produce fragmented-MP4 segment data through `init(contentType:)` and a delegate). Apple's
  pages name no WebM, MKV or MPEG-TS output; treat those as not available (unverified that no other path exists).
- **Passthrough has a restriction** (Apple, `AVAssetWriterInput.init(mediaType:outputSettings:)`): with
  `outputSettings: nil` the samples are written unaltered. Into a **QuickTime movie** (`.mov`) any media can pass
  through. Into **any other file type** (such as `.mp4`) only a limited set of media types and subtypes passes,
  and you must give a `sourceFormatHint` (use `init(mediaType:outputSettings:sourceFormatHint:)`). Apple does not
  list that set. So `TSRemuxer` should pass the format description it read from the stream as the hint, and an
  `.mp4` write of an unusual codec may fail where `.mov` would succeed (a fallback worth having).
- `AVURLAsset` reads MP4, MOV, M4A and fragmented MP4 files. Whether it opens a raw `.ts` file is not stated by
  Apple (unverified; the audit does not say why TitleLess wrote its own `TSRemuxer`, so "that is why" was only an
  inference). Ask at run time: `AVURLAsset.audiovisualTypes()` lists the file types the device can open.
- **WebM:** no Apple page lists WebM as a file type AVFoundation reads. In a June 2026 forum answer an Apple media
  engineer said the Opus codec is available to developers on all Apple platforms, Vorbis is not, and the WebM
  **container** itself may be what native APIs fail to parse. Treat WebM as not readable (unverified for iOS 26
  and 27).
- Codecs that are safe in MP4: H.264, HEVC, AAC, AC-3, E-AC-3, ALAC (general knowledge; Apple's passthrough page
  does not list them). VP9 and AV1 decoding depends on the device (AV1 hardware only on recent chips). Opus or VP9
  passed through into MP4 by `AVAssetWriter`: unverified. So prefer variants with `avc1` / `hvc1` / `hev1` video
  and `mp4a` audio ([22 §6](22-ytdlp-ffmpeg.md#6-codec-to-container-rules---merge-output-format-containerfor)).
- No re-encoding: `AVAssetWriterInput(mediaType:outputSettings: nil, sourceFormatHint:)` appends compressed samples
  as they are; `AVMutableComposition` (`addMutableTrack`, `insertTimeRange(_:of:at:)`) plus
  `AVAssetExportSession(asset:presetName: AVAssetExportPresetPassthrough)` joins a video file and an audio file.
  Check the output type first: `export(to:as:)` throws when the type is not in the session's `supportedFileTypes`
  (or ask `determineCompatibleFileTypes`). `timeRange` trims (Deer's Keep partial). `shouldOptimizeForNetworkUse =
  true` is ffmpeg's `+faststart`. The older `exportAsynchronously(completionHandler:)` is now marked deprecated in
  Apple's documentation; use the async `export(to:as:)`.
- **AVAssetDownloadURLSession** (TitleLess chose not to use it). Apple: it must be created with a **background**
  configuration; it has its own task type (`makeAssetDownloadTask(downloadConfiguration:)`) and none of the normal
  task methods; a force-quit cancels its downloads; a non-discretionary task can only be started in the foreground;
  saving a live stream throws (VOD only). The on-disk result is a package managed for AVFoundation playback
  (`.movpkg`); Apple's pages read for this check do not describe moving or re-packing it, so TitleLess's reason
  (the result cannot leave AVFoundation, so it cannot become one MP4 in the vault) stands as its own finding
  (unverified here).
- Length check: `try await AVURLAsset(url:).load(.duration)` ([21](21-hls-dash-engine.md#length-check-after-the-merge)).
- HLS discontinuities: TS timestamps restart after `#EXT-X-DISCONTINUITY`; an AVAssetWriter remuxer must offset
  them, or each run must be its own piece in a composition ([21](21-hls-dash-engine.md#discontinuities-and-other-hls-features-deer-does-not-handle);
  Deer does not handle this either).

### b9. No child processes, no downloaded code

- An iOS app cannot start other programs: `system`, `posix_spawn` and the other UNIX ways to launch a child process
  are not supported (Apple DTS engineer on the developer forums; Apple's public documentation does not say it in one
  place). So no ffmpeg command line, no yt-dlp, no Deno ([22 iOS analysis](22-ytdlp-ffmpeg.md#the-hard-limits)).
- App Review Guideline **2.5.2** (paraphrased): apps must be self-contained in their bundles and may not download,
  install or execute code that introduces or changes features or functionality (a narrow exception exists for
  educational apps that teach coding). Updating extractor code from the network conflicts with it.
- Guideline **2.5.6** (paraphrased): apps that browse the web must use the WebKit framework and WebKit JavaScript;
  an entitlement for an alternative browser engine can be requested for the EU and Japan only. TitleLess uses
  WKWebView, so this is met.
- Guideline **2.5.4** (paraphrased): background services may only be used for their intended purposes (VoIP, audio
  playback, location, task completion, local notifications and so on). Do not keep downloads alive with a silent
  audio background mode; use background sessions or the continued-processing task (b1, b3).
- Linking an ffmpeg library into the app is possible in principle; its licence (LGPL) and App Store terms must be
  checked (unverified). It is not needed if TitleLess keeps to MP4-family output.

### b10. App Review Guideline 5.2.3 (Audio/Video Downloading)

- Checked on the live page on 2026-10-29 (https://developer.apple.com/app-store/review/guidelines/#5.2.3). In
  plain words, the guideline has three sentences:
  1. Apps should not facilitate illegal file sharing, and should not include the ability to save, convert or
     download media from third-party sources (its examples are Apple Music, YouTube, SoundCloud and Vimeo)
     "without explicit authorization from those sources".
  2. Streaming audio or video may also violate a service's Terms of Use, so check before the app accesses it.
  3. The authorization must be provided on request.
  Section 22 of this study read the same page ([22 hard limits](22-ytdlp-ffmpeg.md#the-hard-limits)). Re-read the
  live text before each release; the full exact wording is only on Apple's page.
- How strictly Apple applies it to a general browser that saves `<video>` files from any site is not stated
  (unverified). Deer's own safe defaults help: refuse DRM, refuse YouTube-class sites with an honest note, remind
  about site terms once per host.

### b11. Memory

- iOS terminates apps that use too much memory ("jetsam"). Deer keeps up to 48 MiB of early stream segments in RAM
  and lets 8 MiB per connection wait for the disk; those are desktop numbers. On iOS use smaller bounds, for
  example 16-24 MiB of early segments in total (a judgement, not measured).

### b12. What this means: the shape of the design

```
person taps Download
  |
  +-- FOREGROUND ENGINE (Deer's design): default/ephemeral sessions, one per lane; data tasks;
  |     head check before writing; positional writes; work stealing; stall cuts; HLS window
  |     |
  |     +-- keeps running after the person leaves the app under BGContinuedProcessingTask
  |         (iOS 26+, only for work the person started; Live Activity shows progress; b3)
  |
  +-- BACKGROUND FALLBACK: on iOS < 26, or when the continued-processing request failed or expired,
  |     the remaining ranges become background download tasks (Range header: unverified), each
  |     landing as its own part file; parts are joined in steps with the list saved after each part.
  |     Tasks created once the app is already in the background are discretionary (may wait for
  |     Wi-Fi and power) and pass the background rate limiter (b1).
  |
  +-- WKDOWNLOAD: POST answers, blob:, data:, one-time links: only the web view can fetch them

on going to the background: seal inside beginBackgroundTask (close files, flush, save list, clean flag)
on launch: unclean? check saved parts first; continue the rows the system stopped, not those the person paused
```

---

## c. Ranked improvements for TitleLess

Ordered by value for effort: the first items are cheap and remove the worst failures (a web page saved as a video,
the wrong video picked, DRM attempted). Each item names the TitleLess files it would touch (only the files named
in TitleLess's audit), an effort, the risks, and an acceptance test from Deer's checklist
([30 M20](30-ux-tests-history.md#mechanism-20-the-test-suite-as-a-checklist)) that can become an XCTest against
Deer's local test server (item 5 sets that up). Checklist IDs (A1, B2, C1 ...) refer to that section.

Names in code blocks such as `ResponseCheck` or `PartWriter` are suggestions, not existing TitleLess types.

---

### 1. Never write a web page into a download — **S**, value high

**Problem today.** HLS is found by ".m3u8" in the URL only, with no MIME or `#EXTM3U` check, and the audit does not
describe any check of a response before its bytes are used. Signed links often expire into a **200 with an HTML
page**. That page can be parsed as a playlist, fed to `TSRemuxer`, or written into a ranged file and then encrypted
into the vault as a "completed" download.

**What Deer does.** Every answer is judged before writing: textual MIME where a binary is expected means "not the
file" (= the link expired), never data ([10 §9](10-multi-connection-engine.md#9-checking-each-answer-before-writing),
[11 §3 R1](11-integrity-resume-retry.md#3-the-same-file-proof-verdicts-r1-to-r7)). Playlists must start with
`#EXTM3U`; segments are sniffed, encrypted ones only after decryption
([21 sniffing](21-hls-dash-engine.md#is-it-media-segment-sniffing-a-page-or-json-is-never-written)).

**iOS design.** `RangedDownload.swift`, `HLSDownload.swift`; `Downloads.swift` maps the verdict to "Link expired"
(item 4).

```swift
// Pure functions, unit-testable without a network.
func isTextual(_ mime: String?) -> Bool          // text/html, text/plain, text/xml, application/xhtml+xml,
                                                 // application/json, application/xml, */*+json, */*+xml
func isPageLike(_ mime: String?) -> Bool         // narrower: text/html, application/xhtml+xml, application/json, +json
func textStart(_ d: Data) -> Bool {              // after an optional UTF-8 BOM (EF BB BF) and up to 64
    /* skip BOM and spaces/tabs/newlines */      // spaces, the first byte is '<' or '{'
}
func looksLikeMedia(_ d: Data) -> Bool           // TS: 0x47 at 0 (and at 188 if longer);
                                                 // MP4 box type at offset 4: ftyp styp moof sidx emsg prft mdat free;
                                                 // WebM 1A 45 DF A3 or 1F 43 B6 75; "ID3"; MPEG audio FF Ex
func isPlaylist(_ text: String) -> Bool          // starts with #EXTM3U after BOM and whitespace
```

Rules: a ranged part whose head says textual (or `isPageLike` when the expected type was only guessed) is
"not the file"; a segment is "not the file" when its type is a page type and `textStart` is true (clear segments),
or when, after decryption, the first piece starts with `<` / `{`, or a page type carries bytes that are not
`looksLikeMedia`. "Not the file" is never retried in place; it means "renew the address" (items 8 and 20).

**Risks.** Some CDNs label real segments `text/html` or `image/jpeg`: the content decides, never the type alone
(Deer D4). About 1 ciphertext in 128 starts with `<` or `{`, so judge encrypted segments only after decryption.

**Acceptance test.** D1 (the address now answers a 200 web page: never completed, Link expired, staging file
unchanged), D3 (an HLS segment answered with a page is never written: the track holds only whole 188-byte TS
packets), D4 (AES-128 segments labelled `text/html` still complete), G16 (`/video-bad.html` loads
`/bad/broken.m3u8`, a "playlist" whose body is `this is not a playlist`: the offer is empty with a reason). XCTest:
run `RangedDownloadTask` against the server, switch the address to a page with a `/flag`, assert the item is
paused with `need == .address` and the staging file's SHA-256 did not change.

---

### 2. Pick the right video: confirm by body, reject the noise, prefer the master — **S/M**, value high

**Problem today.** "The first playlist wins forever, otherwise the newest file wins", with no scoring and no reject
list. Ads, previews, segments and the previous video get picked; a variant playlist hides the other qualities.

**What Deer does.** [20 M1](20-video-detection.md#mechanism-1-the-network-eye-classifying-every-response),
[M4](20-video-detection.md#mechanism-4-which-candidates-count), [M5](20-video-detection.md#mechanism-5-ranking-streams-and-preferring-the-master),
[M6](20-video-detection.md#mechanism-6-confirming-and-reading-a-manifest), [M10](20-video-detection.md#mechanism-10-the-offer-choosing-direct-file-hls-dash-or-yt-dlp),
and the 17 [rules TitleLess should adopt](20-video-detection.md#rules-titleless-should-adopt).

**iOS design.** `WebViewConfiguration.swift` (the `mediaReporter` script), `MediaControls.swift`.

- The script reports each resource with its `initiatorType` and, for script requests, the response `Content-Type`
  (wrap `fetch` and `XMLHttpRequest` in the page world). Raise the Resource Timing buffer.
- Classify in Swift:

```swift
enum MediaKind { case hls, dash, video, audio }
struct Candidate { var url: URL; var kind: MediaKind; var bytes: Int64; var seenAt: Date
                   var frameURL: URL?; var initiator: String }

let segmentExt = #/\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/#.ignoresCase()
let hints = #/thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/#.ignoresCase()

func classify(url: URL, mime: String?, initiator: String) -> MediaKind? {
    // HLS: mime contains "mpegurl", or the PATH ends in .m3u8 (test the path, not the query)
    // DASH: mime contains "dash+xml", or the path ends in .mpd
    // whole files only when initiator is not "xmlhttprequest"/"fetch", the URL matches neither
    // segmentExt nor hints; video/* except video/mp2t; audio/*; octet-stream with .mp4/.webm/.mov/.mkv/.m4v
}
// drop whole files with a known size under 500_000 bytes, element clips under 5 s,
// and audio files when the document has any video, HLS or DASH candidate
```

- Choose:

```
rank(hls) = 2 if file name matches master|index|playlist|manifest, +1 if the name is not opaque;
            ties: most recent first
for url in rank(hls).prefix(4):                       // URLSession, cookies copied, 12 s, at most 8 MiB
    body must start with #EXTM3U; a body with #EXT-X-STREAM-INF is a master: take it and stop
    else remember the first readable one
else (later, item 25) DASH whose root is MPD
else the LARGEST file (size = Content-Range total; unknown -> Range bytes=0-0, 8 s timeout)
else .none(reason)                                     // item 22 shows the reason
```

- A suggestion of this study, not Deer's rule: when the `<video>`'s own `currentSrc` is a confirmed playlist or a
  large file, prefer it. Deer prefers any HLS the page loaded, and found no test for "an ad's HLS beside the real
  video file" ([20 M10 why](20-video-detection.md#why-9)).

**Risks.** Resource Timing has no MIME; the `initiatorType` values WebKit uses for media elements are unverified;
native HLS playback may not appear in Resource Timing at all (unverified), so `currentSrc` (item 13) is the main
source on iPhone.

**Acceptance test.** G16 (`/video-bad.html` gives "Can't save this video", no picker); the streams.js master case
(`/video-slow.html`: the page fetched `master.m3u8` and then `v360/index.m3u8`; the offer must be the master's full
ladder 360p, 180p). XCTest in a host app: load each page from the local server in a `WKWebView`, call
`MediaControls`' resolve, assert the result.

---

### 3. Refuse DRM and live streams, early and again at the start — **S**, value high

**Problem today.** The audit mentions AES-128 decryption but no DRM detection. A FairPlay or SAMPLE-AES stream, or a
page that plays through EME, may be attempted. Beyond wasted work, trying to save protected video is an App Store
and legal risk.

**What Deer does.** Many signals mark the whole document "protected"; it is enforced at 7 layers, down to the
engine's start ([20 M7](20-video-detection.md#mechanism-7-drm-detecting-and-refusing),
[21 DRM](21-hls-dash-engine.md#drm-refusal-sample-aes-widevine-playready-fairplay-dash-contentprotection)). Live
streams are refused with a sentence ([20 M8](20-video-detection.md#mechanism-8-live-streams),
[21 live](21-hls-dash-engine.md#live-and-event-playlists)).

**iOS design.** `WebViewConfiguration.swift`, `MediaControls.swift`, `HLSDownload.swift`, `Downloads.swift`.

- Page-world script: wrap `navigator.requestMediaKeySystemAccess` (and the legacy `WebKitMediaKeys` if present);
  capture-phase listeners for `encrypted` (and `webkitneedkey`, unverified); report `mediaKeys` / `webkitKeys` on
  media elements. Any signal → the document is protected until the next `didCommit`; it then has no candidates.
- HLS rule (Deer `playlist.ts:104-110`):

```swift
func keyIsDRM(method: String?, keyFormat: String?) -> Bool {
    let m = (method ?? "NONE").uppercased()
    if m == "NONE" { return false }
    if m != "AES-128" { return true }                       // SAMPLE-AES, SAMPLE-AES-CTR, ...
    return (keyFormat ?? "identity").lowercased() != "identity"   // FairPlay: com.apple.streamingkeydelivery
}
// apply to #EXT-X-KEY in media playlists and #EXT-X-SESSION-KEY in masters; skd:// key URIs are FairPlay too
```

- Live: a media playlist with no `#EXT-X-ENDLIST` and no `#EXT-X-PLAYLIST-TYPE:VOD`, or `duration == Infinity`.
  Accept `PLAYLIST-TYPE:VOD` without `ENDLIST` as finished.
- Check again in `DownloadManager.start` and in `HLSDownloadTask` before the first segment request, with the
  sentences "This video is protected and can't be saved." / "Live streams can't be saved."

**Risks.** Wrappers in the page world can be overwritten by the page (rare). A page that only probes EME is marked
protected for that document (Deer accepts this). Deer's spike noted that an unsupported key system produced no
signal; the manifest rules still catch it.

**Acceptance test.** G17 (`/video-live.html`: "Live · can't be saved"), G18 (`/drm.html`, a ClearKey EME page: no
candidates, offer "protected"; the fixtures' Widevine `SESSION-KEY` master and DASH `ContentProtection` manifest are
refused). Whether WebKit on iOS runs ClearKey EME is unverified; the hook still sees the request. XCTest: start
`HLSDownloadTask` on the DRM master fixture; assert it fails with `.protected` and that `/stats` shows no segment
request.

---

### 4. One state model and one failure classifier — **M**, value high

**Problem today.** Items have start/pause/resume/retry. Nothing separates "the link expired" or "the file changed"
(the person must act) from "waiting for the network" (the app will retry) from a real failure.

**What Deer does.** A small state plus `need` and `wait` (and `phase`); Link expired and File changed are paused, not
failed; one function classifies how every run ends; one timer serves the earliest `nextAt`
([12 §2](12-download-manager.md#2-the-rows-state-machine), [§15](12-download-manager.md#15-how-a-run-ends-one-classification-stopped),
[§16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer),
[11 §2](11-integrity-resume-retry.md#2-failure-kinds-and-where-each-one-ends),
[30 M1](30-ux-tests-history.md#mechanism-1-one-state-model-for-every-surface-state-phase-need-wait)).

**iOS design.** `Downloads.swift` (`DownloadItem`, `DownloadManager`).

```swift
enum DownloadState: String, Codable { case queued, downloading, paused, completed, failed, cancelled }
enum Phase: String, Codable { case none, probing, checking, renewing, merging, repairing }
struct Need: Codable {
    enum Kind: String, Codable { case address, choice, page, repair }   // Link expired, File changed, ...
    var kind: Kind; var status: Int?; var evidence: String?             // "was 24 MB, now 23 MB"
}
struct Wait: Codable {
    enum For: String, Codable { case network, server, address }
    var waitFor: For; var tries: Int; var nextAt: Date
}
// DownloadItem += phase, need: Need?, wait: Wait?, resumeOnLaunch: Bool, events: [HistoryEvent] (last 5)

enum StopKind { case refused(Int), notTheFile, changed(String), offline, timeout, server(Int, TimeInterval?),
                disk, fatal(String) }

func classify(_ error: Error, status: Int?) -> StopKind
// URLError .networkConnectionLost, .timedOut                       -> timeout (a "cut")
// .notConnectedToInternet, .cannotFindHost, .cannotConnectToHost,
//   .dnsLookupFailed, .dataNotAllowed                               -> offline
// .secureConnectionFailed, .serverCertificate*                      -> fatal (never retried)
// HTTP 401, 403, 404, 410, 451, a 400 whose body says the signature expired -> refused
// HTTP 408, 425, 429, 5xx except 501/505                           -> server (keep Retry-After, up to 24 h)
// a Cloudflare challenge (cf-mitigated: challenge, or 403/429/503 + Server: cloudflare + HTML markers) -> refused
// POSIX ENOSPC / NSFileWriteOutOfSpaceError / any write error      -> disk (never retried)

func stopped(_ item: inout DownloadItem, _ kind: StopKind, savedBytes: Int64) {
    // refused / notTheFile with bytes saved -> .paused, need .address, wait .address (renewal schedule, item 20)
    // changed                              -> quiet restart if allowed (item 16), else .paused, need .choice
    // offline / timeout / server           -> .paused, wait (every 30 s, never before Retry-After, never give up)
    // anything else                        -> .failed with a plain sentence
}
```

One `Task` sleeps until the earliest `wait.nextAt` and is re-armed on every save. `NWPathMonitor` moves network
waits to now + 5 s when the path becomes `.satisfied`. Show "Checking" only after 400 ms.

**Risks.** Old saved items must decode (give the new fields defaults). Every screen that switches on the state must
learn the new reasons (item 22).

**Acceptance test.** B12 (every ask answers 404: Link expired, never Failed), D2 (403 with S3 "Request has expired"
XML, or 410: Link expired with `need.status` 403 / 410), E1 (`/drop`: "Waiting for network" within about 11 s,
never Failed), E5 (503 for 90 s: "Retrying · in N s", never Failed), E8 (a redirect loop `/loop/a` ↔ `/loop/b`, or two
different Content-Length headers `/dupcl`: Failed, never "Waiting for network").

---

### 5. A local fault server and an XCTest harness, with a control test — **M**, value high

**Problem today.** The audit describes no download test suite. Every item below is about rare server behaviour that
real sites will not produce on cue.

**What Deer does.** One Python server (`gecko/tests/downloads/server.py`, 1974 lines) simulates about 70 kinds of
misbehaviour, logs every request (range, If-Range, client port, cookie, Referer, Accept-Encoding, status, bytes sent,
time), and can change its mind mid-download through `/flag?k=KEY`. Tests assert on that log, not only on "it
finished" ([30 M19](30-ux-tests-history.md#mechanism-19-the-test-harness-how-the-checks-are-built),
[M20](30-ux-tests-history.md#mechanism-20-the-test-suite-as-a-checklist),
[how to turn it into XCTest](30-ux-tests-history.md#how-to-turn-this-into-xctest-for-titleless)). The IDM bench
server (`gecko/spikes/downloader/idm-bench/server.py`, port 47995) adds per-connection rate, stall, crawl and
limit knobs ([10 §25](10-multi-connection-engine.md#25-the-idm-benchmark-2026-10-20)).

**iOS design.** Test target only; no app file.

- Copy `server.py` and `fixtures.py` (seeded `big.bin` 256 MiB and `medium.bin` 24 MiB with known SHA-256; HLS, DASH,
  DRM and live fixtures made with ffmpeg on the Mac). Start the server from a test-plan pre-action or a script:
  `python3 server.py --port 47931 --dir <fixtures> --log requests.jsonl`.
- The iOS Simulator reaches the Mac at `http://127.0.0.1:47931` (the Simulator shares the Mac's network; general
  knowledge). The host app needs the App Transport Security key `NSAllowsLocalNetworking = YES` in its test
  `Info.plist`. Apple: it allows plain HTTP to unqualified names, `.local` names and IP addresses; since iOS 17, ATS
  no longer allows IP addresses by default, so the key is needed for `127.0.0.1`. A real device needs the Mac's LAN
  address and the **local network permission** (iOS 14+): add `NSLocalNetworkUsageDescription` and accept the
  prompt (Apple TN3179, which also says the Simulator does not enforce local network privacy, so test the prompt on
  a device).
- A small client:

```swift
struct TestServer {
    let base = URL(string: "http://127.0.0.1:47931")!
    func stats() async throws -> Stats      // GET /stats: every request + peak concurrent bodies
    func reset() async throws               // GET /reset: clear the log (flags survive)
    func flag(_ key: String) async throws   // GET /flag?k=KEY: change the server's behaviour now
}
```

- Assert like Deer: exact ranges, `If-Range` on every resumed request, distinct client ports, bytes on the wire,
  gaps between retries, and the final SHA-256. `URLProtocol` stubs cannot make real TCP resets, stalls or "head now,
  body in 16 s"; use the real server for B4, B6, B10, A13, E1.

**Risks.** Python on CI machines; timing-sensitive checks (use Deer's tolerances, for example "within ±0.8 s of 4 s ×
k"). The server speaks HTTP/1.1 only; HTTP/2 lane tests (item 9) need a real HTTP/2 host.

**Acceptance test.** A1 (256 MiB at `/blob/big?rate=4096`: server peak ≥ 8 bodies at once and ≥ 8 client ports;
**bytes on the wire = file size**; SHA-256 equal) and the control test C1 (an unchanged resume makes exactly 2
requests: the probe `bytes=0-65535` with If-Range, then one range from the saved end; without Range support exactly
1). Keep C1 green after every later item: it stops safety features from quietly costing bandwidth.

---

### 6. Safe resume for direct files: validators, If-Range, head checks, window 0 — **M**, value high

**Problem today.** `RangedDownloadTask` falls back to one connection without a 206. The audit does not mention
reusing a 200 answer, parsing the `Content-Range` total, recording ETag / Last-Modified, If-Range, or comparing any
saved bytes on resume. A file replaced on the server between pause and resume could be mixed.

**What Deer does.** Probe `bytes=0-0` (fresh) or `bytes=0-65535` + If-Range (resume, window 0 compared in the same
request); range support only on a real 206 with a total; a 200 becomes the download; every answer checked before
writing; header-only changes proven by bytes; a server that stops ranging writes to a side file
([10 §2](10-multi-connection-engine.md#2-the-probe-the-first-request), [§8](10-multi-connection-engine.md#8-validators-and-if-range-on-every-request),
[§9](10-multi-connection-engine.md#9-checking-each-answer-before-writing), [§19](10-multi-connection-engine.md#19-servers-that-do-not-honour-range),
[11 §1](11-integrity-resume-retry.md#1-never-lose-or-mix-bytes-the-phase-1-rules), [§3-§6](11-integrity-resume-retry.md#3-the-same-file-proof-verdicts-r1-to-r7)).

**iOS design.** `RangedDownload.swift`; validators stored on `DownloadItem` (`Downloads.swift`).

```swift
struct Validators: Codable {
    var etag: String?; var lastModified: String?
    var etagUnstable = false; var dateUnstable = false
    var retagged: [Date] = []; var redated: [Date] = []      // slips within 10 min
}
func ifRange(_ v: Validators) -> String? {
    if let e = v.etag, !e.hasPrefix("W/"), !v.etagUnstable { return e }   // never a weak ETag
    if v.dateUnstable { return nil }
    return v.lastModified
}

// Probe (fresh): Range: bytes=0-0
// Probe (resume): Range: bytes=0-65535 (one byte short when total <= 64 KiB) + If-Range
// In didReceive response (before .allow):
//   ranges = (status == 206 && contentRangeTotal > 0)
//   200 -> keep reading: this IS the single-stream download (one request in all)
//   record response.url (final address), redirect hops, ETag, Last-Modified, Repr-Digest/Digest sha-256,
//   Content-MD5 (only on a 200), Content-Type, Content-Disposition filename
//   resume: judge R1..R7; compare the first min(64 KiB, saved) bytes with the staging file as they arrive
//   206 with other validators, or a 200 to If-Range -> "header-only change": prove with 3-4 windows
//   (Range, no If-Range) -> same bytes: adopt the new validators (a "slip"); 2 slips in 10 min -> stop trusting
//   that validator and compare one window every 256 MiB or 5 min instead (at most 8 proofs per run)
// Each segment answer: 206 with Content-Range start == asked start, start <= end <= asked end,
//   total == known total, same validators, not textual -> else drop it before writing
// 200 to a plain Range mid-run with bytes saved -> write the whole answer to "<staging>.new",
//   compare its first 64 KiB with saved bytes while streaming, swap with
//   FileManager.replaceItemAt only when complete and the same length; otherwise delete ".new"
```

**Risks.** Background-session download tasks and custom `Range` / `If-Range` headers (unverified). Automatic
decompression must be off for ranges (send `Accept-Encoding: identity`; unverified that URLSession keeps it).

**Acceptance test.** A2 (pause at 60 MB, resume: every request carries If-Range; the first is `bytes=0-65535`; only
missing bytes fetched), C2 (`/swap?val=etag` during a pause: File changed, staging untouched, nothing fetched after
the probe), C4 (same bytes under a new ETag: proven by 2-4 windows, continues, later ranges carry the new ETag), C5
(weak ETag + Last-Modified: If-Range carries Last-Modified), C11 (`/whole`, a 40 KiB file whose server answers a full
Range with 200: the resume makes 2 requests, the probe asking `bytes=0-40958`), and C1 stays at 2 requests.

---

### 7. Save only durable bytes; a crash-safe list; continue what the system stopped — **M**, value high

**Problem today.** The audit does not say how `DownloadStore` saves, whether saved progress can claim bytes not yet
written, or how interrupted ranged/HLS work resumes on the next launch. iOS kills suspended apps without notice, so
this is the normal case, not the rare one.

**What Deer does.** Three counters (shown, saved, readable): the store saves only bytes certainly on disk; atomic
writes, a flushed `.bak`, unreadable copies set aside as `.corrupt`, a session-clean flag; rows a quit or crash
stopped continue 10 s after start, rows the person paused stay paused
([10 §17](10-multi-connection-engine.md#17-progress-speed-eta-and-the-connection-bar),
[11 §9](11-integrity-resume-retry.md#9-writing-bytes-and-knowing-which-bytes-are-really-on-disk),
[§10](11-integrity-resume-retry.md#10-the-download-list-atomic-saves-a-flushed-backup-and-a-rebuild-from-journals),
[§14](11-integrity-resume-retry.md#14-resume-after-pause-quit-sleep-and-restart),
[12 §20](12-download-manager.md#20-persistence-of-the-list), [§21](12-download-manager.md#21-start-up-and-continue-unfinished-downloads-when-deer-starts)).

**iOS design.** `Downloads.swift` (`DownloadStore`, `DownloadManager`), `RangedDownload.swift`, `HLSDownload.swift`.

```swift
actor PartWriter {                       // one per staging file
    let fd: FileDescriptor               // import System; opened with O_RDWR
    private(set) var durable: [Int: Int64] = [:]       // per segment: bytes whose write() returned
    func write(_ data: Data, at offset: Int64, segment: Int) throws {
        _ = try fd.writeAll(toAbsoluteOffset: offset, data)   // pwrite; writes every byte or throws (iOS 14+)
        durable[segment, default: 0] += Int64(data.count)
    }
}
// The store saves segment.received = durable count, never "bytes handed to the writer".
// A write error keeps only durable bytes and stops the run: disk errors are never retried.
```

- Store: `Data.write(to:options: .atomic)`; on state changes (and at least every 30 s while running) also
  `synchronize()` and write `<store>.bak`; progress saves every 2 s without flushing. On load: store, else `.bak`;
  move an unreadable file to `.corrupt` before anything is written.
- `session = {startedAt, clean: false}` written at launch; `clean = true` only after a seal on the way to the
  background (b3). `resumeOnLaunch = true` when the system stopped a run (background without permission,
  termination, crash); a Pause by the person clears it. At launch, after a 10 s grace, re-queue those rows in their
  old order (setting "Continue unfinished downloads", on by default). Waiting rows continue by their own schedule.
- Staging files and the store use `.completeUntilFirstUserAuthentication` (Apple: the default class for new files,
  so simply do not raise it) so a background relaunch can read them after the first unlock.

**Risks.** Flush cost on every state change (measure); the vault's protection class (b4); several writers (one actor
per file avoids races).

**Acceptance test.** E11 (adapted: terminate the app while one download runs and another is paused by the person;
relaunch: the first continues about 10 s after launch with history "Continued after restart", the second stays
paused), E15 (a corrupt store loads from `.bak`; both unreadable: both set aside as `.corrupt`, never overwritten).
In an XCUITest, `XCUIApplication().terminate()` then `launch()`; check with `/stats` that only missing bytes were
fetched (until item 24 exists, Deer's older rule is acceptable: give back the last 8 MiB of each segment after an
unclean end, `waits.ts:43-48`).

---

### 8. HLS: match segments by media sequence, refresh expired addresses — **M**, value high

**Problem today.** The audit does not say how segments are matched on resume or what happens when a segment's
signed address expires mid-download. If segments are matched by index, a renumbered playlist mixes bytes; an
expired token ends the download.

**What Deer does.** Every segment keeps `seq = MEDIA-SEQUENCE + index`. A refused segment (401/403/404/410/451, a
page, or a refused key) is looked up again by sequence in a fresh copy of the same media playlist, read once for all
connections and at most every 5 s, without using up a retry; the new playlist is taken only if it has the same
shape, and the last written segment must re-hash the same at its new address
([21 media parsing](21-hls-dash-engine.md#media-playlist-parsing-segments-durations-sequence-byte-ranges-init-keys),
[21 refresh](21-hls-dash-engine.md#expired-addresses-inside-a-run-refreshing-the-media-playlist-g2-step-1),
[21 AES-128](21-hls-dash-engine.md#aes-128-decryption-key-fetch-and-iv-rules)).

**iOS design.** `HLSDownload.swift`.

```swift
struct Segment { let url: URL; let seq: Int64; let key: KeyRef?; let range: Range<Int64>?
                 let duration: Double; let isInit: Bool }

actor PlaylistRefresher {
    private var inFlight: [TrackID: Task<MediaPlaylist, Error>] = [:]
    private var lastRead: [TrackID: ContinuousClock.Instant] = [:]
    func fresh(for track: TrackID, stale: Segment) async throws -> Segment? {
        // 1. another connection may already have refreshed: look up stale.seq (or isInit) in the current copy
        // 2. else join the in-flight read, or start one (not sooner than 5 s after the last)
        // 3. accept the new playlist only if: same segment count, same first seq, same durations hash,
        //    init present or not as before; if segments were written, re-fetch the last written one at
        //    its new address and compare its hash (item 18 keeps the hashes)
        // 4. return the segment with the same seq (never the same index)
    }
}
// per segment: at most 3 refreshes; a refresh does not count as an attempt
// IV = the IV= attribute, else 8 zero bytes + seq as a 64-bit big-endian number
// keys: one Task per key URL; the body must be exactly 16 bytes; decrypt with CommonCrypto
//   CCCrypt(kCCDecrypt, kCCAlgorithmAES, kCCOptionPKCS7Padding, ...); a refused key triggers a refresh,
//   and the segment takes the fresh KEY URL even when its own URL did not change
```

**Risks.** Playlists that renumber need the time mapping of item 18. Single-flight logic must live in one actor.

**Acceptance test.** G5 (`/token/fx/`: the first request for `seg003` gets a 403 and expires the token; the
playlist is read at least twice; the 24 s stream completes). XCTest: assert in `/stats` that `seg003` was asked
twice (403, then 200 at the new address) and no other segment was fetched twice.

---

### 9. Make "N connections" real: one URLSession per lane — **S/M**, value high (needs measuring)

**Problem today.** The audit does not say whether `RangedDownloadTask` uses one session. If it does, its parallel
ranges to an HTTP/2 host run as streams of **one** connection: Apple documents that HTTP/2 and later run many
requests over a single connection and ignore `httpMaximumConnectionsPerHost` (b2). How much speed that costs on
real hosts is not measured for iOS (on its own network stack Deer measured 3.3 MB/s on one connection and
14.3 MB/s on 8 lanes).

**What Deer does.** Each connection of a download gets its own network partition (a lane), so its own TCP socket even
on HTTP/2; a cut or a server-error retry bumps the lane's generation, which forces a brand-new connection. Measured:
8/8 distinct sockets on HTTP/2 hosts with lanes, 1/8 without; on a real CDN 14.3 MB/s on 8 lanes vs 3.3 MB/s on one
connection ([10 §7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection),
[§23](10-multi-connection-engine.md#23-http2-vs-http11-what-changes)).

**iOS design.** `RangedDownload.swift`.

```swift
final class Lane {
    let index: Int
    private(set) var generation = 0
    private(set) var session: URLSession
    func renew() {                         // after a stall/slow cut or a server-error retry
        session.invalidateAndCancel(); generation += 1; session = Lane.makeSession(delegate: engine)
    }
    static func makeSession(delegate: URLSessionDataDelegate) -> URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.httpMaximumConnectionsPerHost = 1     // HTTP/1.1 only; HTTP/2 and HTTP/3 ignore it (Apple)
        c.urlCache = nil; c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest = 30        // idle timeout, as Deer's
        c.httpShouldSetCookies = false          // the Cookie header is built by hand (item 12)
        return URLSession(configuration: c, delegate: delegate, delegateQueue: engineQueue)
    }
}
// Measure in urlSession(_:task:didFinishCollecting:): transactionMetrics.last?.localPort,
// networkProtocolName, isReusedConnection. Log the number of distinct local ports per download.
```

Deer switches HTTP/3 off for lanes; the reason is not written down ([10 §7](10-multi-connection-engine.md#7-lanes-one-network-partition-per-connection)).
On iOS keep the default and let the metrics tell. No public URLSession switch to turn HTTP/3 off was found in this
check; `assumesHTTP3Capable` only turns it on early (WWDC21).

**Risks.** Separate sessions might still share a connection (unverified): the metrics test decides. More TLS
handshakes; a few sessions per download is fine, hundreds are not.

**Acceptance test.** A1 (8 bodies at once on ≥ 8 client ports, bytes on the wire = file size). Because the local
server is HTTP/1.1, also run a manual check against a real HTTP/2 CDN file and log the distinct local ports (Deer's
verifier did the same on real hosts).

---

### 10. Work stealing and capped answers — **M**, value high

**Problem today.** A static split is implied. Near the end, one slow range decides when the file finishes.

**What Deer does.** Block-aligned plan; all connections start at once; a connection with nothing left takes the
second half of the biggest running segment (a block border near the middle, at least 1 MiB on each side); the
running answer notices its moved end on the next chunk; each request asks for exactly its segment's end so the
connection can be reused; a clean 206 that ends early (a host that caps answers) is not a failure
([10 §4](10-multi-connection-engine.md#4-the-segment-plan), [§5](10-multi-connection-engine.md#5-starting-the-connections-no-ramp),
[§6](10-multi-connection-engine.md#6-work-stealing-dynamic-segmentation), [§13](10-multi-connection-engine.md#13-capped-answers-servers-that-send-less-than-asked)).

**iOS design.** `RangedDownload.swift`.

```swift
struct Seg: Codable { var start: Int64; var end: Int64; var received: Int64 }

func blockSize(_ total: Int64) -> Int64 {            // 1 MiB ... 64 MiB, at most ~2048 blocks
    let want = (total + 2047) / 2048; var bs: Int64 = 1 << 20
    while bs < want && bs < 64 << 20 { bs *= 2 }; return bs
}
// plan: n = setting (Deer: default 8, 1...32) only when total >= 8 MiB and ranges; else 1
//       size = ceil(ceil(total / n) / bs) * bs; a resume never re-plans

actor SegmentPlan {
    var segs: [Seg]; var owned: Set<Int>
    func claim() -> Int? {
        // 1. the first segment nobody owns with bytes left
        // 2. else the owned segment with the most bytes left (>= 2 MiB): cut at the block border nearest
        //    the middle of what is left, with >= 1 MiB on each side; the old segment's end = cut;
        //    insert the new piece after it and return it
        // 3. else nil: this lane leaves for good (wake lanes standing by so the download never sits at 100 %)
    }
    func room(_ i: Int) -> Int64 { segs[i].end - segs[i].start - segs[i].received }  // read on every chunk
}
// didReceive data: write min(data.count, room); if room hits 0 and the end moved -> cancel this task;
//   if the end did not move -> let the answer end by itself (the connection stays reusable)
// didComplete without error: if bytes == the 206's own Content-Range end but the segment is not done
//   -> a capped answer: ask for the rest at once (not a failure); a body cut before its own end = a "cut"
```

**Risks.** Concurrency bugs (keep the plan in one actor); several lanes writing one file (item 7's positional
writes).

**Acceptance test.** B5 (`capresp`: every 206 capped at 8 MiB: never a failure or a wait; each next ask within
0.5 s; at least 32 answers; intact), B3 (one region's first answer crawls at 16 KB/s: completes; with item 11 the
crawler is cut within 26 s and the new request starts where it stopped), A1 (no overlap: bytes on the wire = file
size).

---

### 11. Cut stalled and crawling connections; retry by class; stand by on 429/503 — **M/L**, value high

**Problem today.** No stall or slow replacement and no failure classes are described. A dead range waits for
URLSession's 60 s timeout or finishes last; a host that allows 2 connections may make the others fail.

**What Deer does.** Every 2 s each connection is compared with the others' median; a silent one (10 s) or a crawler
(16 s under max(8 KiB/s, 25 % of the median)) is cut and asked again at once on a new connection, without counting a
failure. Retries follow IDM: a cut at once, a server error after 4 s × k on a new connection, 429/503 give the piece
back and stand by (nudged when another answer with bytes ends), Retry-After honoured, a global cap. After 10 s of
nothing the row reads Waiting/Retrying and the first answer back is proven with one window
([10 §12](10-multi-connection-engine.md#12-stall-and-slow-detection-cutting-a-bad-connection),
[§14](10-multi-connection-engine.md#14-retries-per-connection-idms-policy), [§15](10-multi-connection-engine.md#15-servers-that-limit-connections-429503-standby-and-the-nudge),
[§18](10-multi-connection-engine.md#18-a-quiet-stretch-retrying-and-the-proof-before-writing-again),
[11 §15-§17](11-integrity-resume-retry.md#15-retrying-like-idm-the-owners-decision-of-2026-10-21)).

**iOS design.** `RangedDownload.swift`.

```
every 2 s (one timer on the engine actor):
  per lane: push this tick's bytes (keep 8) and the time the app itself held the lane (speed limit, disk)
  skip everything while a speed limit was binding in the last 16 s
  laneRate = bytes of the last 8 ticks / 16 s; others = median of the other lanes (or the last busy median, <= 30 s old)
  STALL: after the first body byte, 5 ticks with 0 bytes, others >= 64 KiB/s, another lane got bytes,
         not cut in the last 60 s                                                          -> cut
  SLOW:  after the first body byte, 8 ticks, rate < max(8 KiB/s, 0.25 * others), >= 256 KiB left,
         left/rate >= 8 s and >= 2 * left/others, write queue <= 2 MiB, not cut in 60 s    -> cut
  never judge a tick in which the app held the lane > 50 %
  cut = lane.renew(); ask again at once from the durable frontier; not a failure

retry classes (per lane; counts reset after 1 MiB or 5 s of progress):
  cut      (.networkConnectionLost, .timedOut, short body)  -> ask again in 10 ms
  network  (.notConnectedToInternet, .cannotFindHost, ...)  -> wait for NWPathMonitor .satisfied (or 30 s)
  server   (408, 425, 5xx except 501/503/505)               -> 4 s * k (or Retry-After), on lane.renew()
  turned away (429, 503)  -> give the segment back; stand by 4 s * k or Retry-After (<= 24 h);
                             wake early when another answer that brought bytes ends (never after a refusal)
  refused  (401/403/404/410/451, a page) -> one 403 retry; renewal (item 20); stand by while another lane
                             got bytes in the last 10 s; else the run stops as Link expired
  challenge                 -> stop (Link expired); never hammer it
  other                     -> 3 tries (2 s, 6 s), then this lane leaves
  fatal (disk, TLS, changed file) -> the whole run stops
global cap: one token bucket for all re-asks (Deer: 150 a second on a desktop; on a phone something like 20
  a second; a judgement, not measured)
quiet stretch: no byte for 10 s and every lane failing -> item.wait shows Waiting for network / Retrying
  (the run keeps asking); before writing the first answer after it, compare one saved 64 KiB window
```

**Risks.** False cuts on a line where everything is slow (Deer's 64 KiB/s guard); battery and radio use from
re-asks (lower cap, gate on `NWPathMonitor`); never count time the app suspended a task as silence.

**Acceptance test.** B2 (a region answers 500 four times: asked again after about 4, 8, 12 s, each on another
port), B4 (three resets: each next ask within 0.5 s), B6 (one connection silent after 512 KiB: cut after about 10 s),
B7 (control: an even 96 KB/s on every connection is never cut), B10 (`bodydelay`: a body 16 s after its head is not
cut), B11 (outage, 502 on every ask: "Retrying" within about 12 s while the run keeps asking), B14 (`cap=3`: server
peak exactly 3, the others stand by and keep asking, completes), B15 (Retry-After 12: not asked again before
11.8 s), B16 (Cloudflare challenge: Link expired, no ask more than 2 s after the first), B17 (300 resets, then
8 × 503: completes within about 4 s of the last 503).

---

### 12. Take over navigation downloads with a probe, using the page's identity — **M**, value high

**Problem today.** Navigation downloads go `decidePolicyFor` → `.download` → `WKDownload` → staging → vault, on one
connection. The audit does not say which cookies, User-Agent or Referer `RangedDownloadTask` and `HLSDownloadTask`
send.

**What Deer does.** Firefox's own download keeps going while Deer probes `bytes=0-0` with the page's identity; only
if the probe gets the file (200/206/416, not HTML when the browser got a file) is the browser's copy cancelled and
the download restarted in the multi-connection engine. POST answers, one-time links, `blob:` / `data:` stay with the
browser, and the reason is saved; Retry never replays them. Same-site downloads get first-party cookies; cross-site
ones lose SameSite cookies; the Referer follows the page's policy ([12 §5](12-download-manager.md#5-taking-over-downloads-that-pages-start-in-firefox),
[§6](12-download-manager.md#6-mirrored-downloads-left-to-firefox), [§7](12-download-manager.md#7-whose-request-it-is-cookies-principal-referrer-and-the-cross-site-rule),
[§8](12-download-manager.md#8-referrer-policy-referrerts), [30 M17](30-ux-tests-history.md#mechanism-17-how-downloads-enter-the-list-service-take-over-altclick-drm-refusal)).

**iOS design.** `Downloads.swift` (`DownloadManager`, `WKDownload` adoption) and the navigation delegate's
`decidePolicyFor` (wherever it lives in TitleLess).

```
decidePolicyFor navigationResponse:
  when the MIME can't be shown or Content-Disposition is attachment:
     decisionHandler(.download)                 // keep TitleLess's path: the WKDownload starts as today
webView(_:navigationResponse:didBecome download:)       // iOS 14.5+, like WKDownload
     // this callback has no navigationAction: read the method from download.originalRequest
     // (or remember it from decidePolicyFor navigationAction)
     if download.originalRequest?.httpMethod == "GET", scheme is http(s):
         identity = Identity(pageURL, frameURL, referrerPolicy, isPrivate, cookies, userAgent)
         probe(url, identity)                   // Range: bytes=0-0, in parallel with the WKDownload
         206/200/416 and not HTML (unless the WKDownload's response was HTML too):
             download.cancel { _ in }; delete its staging file; start RangedDownloadTask (reuse the probe)
         otherwise: keep the WKDownload; save why ("refused", "a web page", "probe failed")
     else (POST, blob:, data:): keep the WKDownload; save why
WKDownload rows: Retry never re-requests with GET; it says "start it again from its page"
```

Identity (stored on `DownloadItem` so a resume after relaunch sends the same):

- Cookies from the tab's `WKHTTPCookieStore` (b6), with SameSite `strict` / `lax` cookies left out when the page's
  site and the file's site differ (compare registrable domains).
- User-Agent of the web view.
- Referer from the page's referrer policy (Deer's 8-row table, [12 §8](12-download-manager.md#8-referrer-policy-referrerts));
  default `strict-origin-when-cross-origin`: full address to the same origin, the origin to other sites, nothing on
  an https → http downgrade. A pasted address sends no Referer and no Origin.
- `Origin` on cross-origin stream requests.

**Risks.** Cookies change during a long download (copy them for each request); partitioned or HttpOnly cookies
(unverified); a server that binds a link to the web view's own connection (rare; the probe then fails and the
`WKDownload` path stays).

**Acceptance test.** H5 (`/dl/report` needs the page's cookie and Referer: every ranged request carries both), H4
(a `rel=noreferrer` link: no Referer on any request), the crosssite.js case (a download another site's page starts:
no `SameSite=Strict` cookie reaches the server), and the take-over controls (a one-time link refused with 403 at the
probe, and a POST download answered 405, both finish intact through `WKDownload`).

---

### 13. Per-document media records, the single-page-site rule, frames and element facts — **M**, value high

**Problem today.** "First playlist wins forever" never resets: the next video on a single-page site, or a page that
plays an ad first, keeps the wrong stream. Frames all report into one pool. The element's own facts
(`currentSrc`, real height, length) are not described as used.

**What Deer does.** One record per document, never cleared by a response (the spike's "clear on top-level response"
let a download click erase the DRM mark); a path change drops media older than 1.5 s; an iframe's video uses only
its frame's media; a 4xx is retried as the player's frame; the main video is the largest visible one, playing
counts double ([20 M2](20-video-detection.md#mechanism-2-the-page-eye-element-reports),
[M3](20-video-detection.md#mechanism-3-one-record-per-document-and-single-page-sites),
[M11](20-video-detection.md#mechanism-11-embedded-players-frame-ownership-and-asking-as-the-player)).

**iOS design.** `WebViewConfiguration.swift`, `MediaControls.swift`.

- Read DOM facts from an isolated content world: `currentSrc` (http(s) only), `videoWidth`, `videoHeight`,
  `duration`, `paused`, the visible rectangle, `mediaKeys`. Main video: largest visible area × 2 if playing, at
  least 200 × 112 CSS px, opacity > 0.05.
- Key every candidate by a document number bumped in `webView(_:didCommit:)` for the main frame. A download response
  never clears it.
- Same-document URL change (path differs, ignoring `#fragment`): drop candidates seen more than 1.5 s before; keep
  the DRM mark.
- Record `message.frameInfo` per candidate. Page video: same-origin media first, all media only if none. Iframe
  video: only media of that frame's origin. On a 4xx, retry once with `Referer` and `Origin` set to the frame's
  address, and use that identity for every playlist, key and segment of the download.
- Validate every message: finite numbers, URL ≤ 8192 characters, title ≤ 300.

**Risks.** KVO on `webView.url` for same-document changes (unverified for every case); hooks that must wrap page
functions need the page world.

**Acceptance test.** G20 (the spa.js page: after `pushState` the first video's HLS is forgotten and the next one is
offered; a `#comments` change keeps the streams), G19 (`/embed-top.html?hot=1`: the master is asked as the tab
first (403), then as the player's frame; every playlist, key and segment request goes out as the frame; the 180p
download completes), and drm.js's "a download from the protected page keeps it protected".

---

### 14. A quality ladder, the right audio track, and choices AVFoundation can join — **M**, value high

**Problem today.** One URL is picked; no ladder, size, audio choice or suggestion is described. `TSRemuxer` assumes
the codecs fit MP4.

**What Deer does.** One row per height (highest `BANDWIDTH`), audio-only last, size = (`AVERAGE-BANDWIDTH` or
`BANDWIDTH`) / 8 × duration, "Best for this screen" = the tallest row that fits; the variant's audio rendition
(`DEFAULT=YES`, else the first) as a second track; a quality fingerprint; for yt-dlp, H.264 MP4 first and the
original-language sound ([20 M9](20-video-detection.md#mechanism-9-the-quality-ladder-and-the-suggestion-for-this-screen),
[21 master](21-hls-dash-engine.md#master-playlists-variants-the-ladder-and-which-quality-is-downloaded),
[21 audio](21-hls-dash-engine.md#alternate-audio-renditions-ext-x-media-and-subtitles),
[22 §5](22-ytdlp-ffmpeg.md#5-building-the-quality-list-format-selection), [§6](22-ytdlp-ffmpeg.md#6-codec-to-container-rules---merge-output-format-containerfor)).

**iOS design.** `HLSDownload.swift` (parsing), `MediaControls.swift` (the sheet).

```swift
struct Rung: Codable, Hashable {             // the fingerprint, stored on DownloadItem
    var height: Int?; var width: Int?; var bandwidth: Int; var averageBandwidth: Int?
    var codecs: String?; var audioGroup: String?; var audioLanguage: String?; var audioName: String?
}
// ladder: per height keep the variant with the highest BANDWIDTH among those AVFoundation can write
//   (video avc1 / hvc1 / hev1; audio mp4a, ac-3, ec-3); audio-only last; no RESOLUTION -> label "<kbps> kbps"
// size estimate = (averageBandwidth ?? bandwidth) / 8 * duration (duration from the first video variant's playlist)
// audio: the AUDIO group's rendition with DEFAULT=YES, else the first with a URI; skip renditions whose
//   CHARACTERISTICS include public.accessibility.describes-video (HLS spec; unverified on real sites)
// suggestion: fit = max(shortSidePixels, longSidePixels * 9/16) of the window scene's screen (nativeBounds);
//   suggested = the tallest row with height <= fit, else the smallest; "Best for this screen" only with > 1 row
// on a re-read master: same height + same codec family, nearest bandwidth within +-10 %;
//   the audio by group, language and name; a missing language is "File changed", never a silent switch
```

**Risks.** Masters without `RESOLUTION`; AV1 or VP9 variants (skip unless the device decodes them).

**Acceptance test.** G1 (master with 360p and an AES-128 180p: the picker lists both with "Best for this screen";
180p downloads, decrypts and becomes an MP4 with H.264 + AAC, 24 s; no part files left), G2 (fMP4 with a separate
audio rendition: one MP4 with video and sound, 24 s).

---

### 15. Remux safety: a crash-safe join, a length check, never lose the tracks — **S/M**, value high

**Problem today.** `TSRemuxer` remuxes TS/fMP4 into one MP4 with `AVAssetWriter` passthrough. What happens when the
join fails, or when iOS kills the app in the middle of it, is not described; no output length check is described.

**What Deer does.** "Merging to X" is saved before the join; on the next start a finished X completes the row, parts
make it merge again, neither fails with a clear sentence. The output's length must be within max(2 s, 2 %) of the
playlist's. If the join fails, the tracks are kept as separate files with a note
([21 join](21-hls-dash-engine.md#joining-the-tracks-with-ffmpeg-mp4-or-webm-faststart-and-life-without-ffmpeg),
[crash window](21-hls-dash-engine.md#the-merge-crash-window), [length check](21-hls-dash-engine.md#length-check-after-the-merge),
[22 §17](22-ytdlp-ffmpeg.md#17-running-ffmpeg-runffmpeg-and-what-deer-uses-it-for)). Deer's design document cites
the owner's `HLSDownload.swift` for the length rule, so TitleLess may already have it.

**iOS design.** `TSRemuxer.swift`, `HLSDownload.swift`, `Downloads.swift`.

```
before the join:  item.phase = .merging; item.mergeOut = X; save (flushed)
join: TS -> TSRemuxer (AVAssetWriter, outputSettings nil, sourceFormatHint = the stream's format
      description: required by Apple for passthrough into any file type other than .mov);
      video file + audio file -> AVMutableComposition + AVAssetExportSession(passthrough, .mp4,
      shouldOptimizeForNetworkUse = true), or one AVAssetWriter with two passthrough inputs
      if .mp4 refuses a track (an unusual codec), try .mov before giving up (b8)
after: let d = try await AVURLAsset(url: X).load(.duration)
       ok when abs(d.seconds - playlistSeconds) <= max(2, 0.02 * playlistSeconds)
       else note "The saved video is M:SS long; the stream is M:SS." (keep the file)
failure: keep the tracks as their own vault items ("<name>.mp4" / "<name> (audio).m4a", or ".ts" as it came)
         with the note "Couldn't join the video and its sound: saved as two files."
on launch with phase == .merging: X complete -> complete the row; parts present -> join again;
         neither -> fail "closed while joining this video, and its parts are gone"
```

Run long joins inside the continued-processing task (b3) of the download the person started, or
`beginBackgroundTask` for a short one.

**Risks.** Disk room for parts + output + the vault copy at the same time; an export killed in the background
(handled by the crash window). Apple's documentation now lists `AVAssetExportSession.configureForResumableExport()`
(marked iOS 27.0+), which can continue an export from partial results in its temporary folder; which presets it
supports (passthrough?) is not documented (unverified). The crash window above is needed either way.

**Acceptance test.** G11 (the playlist's `EXTINF` values are doubled: the note "The saved video is 0:24 long; the
stream is 0:48"), E13 (adapted: terminate the app before, during and after the join: the row completes from the
output or joins again from the parts, nothing is fetched again, no "(1)" copy), and G21 adapted (force the join to
fail: two files with the note, nothing deleted).

---

### 16. "File changed": the 1 MiB rule, Start over, Keep partial — **S**, value medium-high

**Problem today.** No "file changed" state or choice is described. A changed file is either mixed or the whole
download is thrown away.

**What Deer does.** With at most 1 MiB saved, restart quietly (at most twice in 10 minutes); otherwise stop with the
saved bytes untouched and offer **Start over** (old partial kept as `<name>.old.part` until the new file completes)
or **Keep partial file** (the unbroken beginning; for streams the written segments, trimmed to the shorter track).
Resume on a File-changed row only checks again; the primary action never destroys bytes
([10 §20](10-multi-connection-engine.md#20-the-file-changes-on-the-server-mid-download),
[11 §7](11-integrity-resume-retry.md#7-a-file-that-really-changed-restart-quietly-or-stop-and-ask),
[21 changed stream](21-hls-dash-engine.md#a-changed-stream-silent-restart-or-file-changed),
[22 §10](22-ytdlp-ffmpeg.md#10-changed-or-gone-formats-silent-restart-file-changed-start-over)).

**iOS design.** `Downloads.swift`, `RangedDownload.swift`, `HLSDownload.swift`.

```swift
func mayRestartQuietly(saved: Int64, log: inout [Date], now: Date = .now) -> Bool {
    log.removeAll { now.timeIntervalSince($0) > 600 }
    guard saved <= 1 << 20, log.count < 2 else { return false }
    log.append(now); return true
}
// Start over: save the decision first, then move staging to "<name>.old.part" (or "<name>.old (1).part",
//   never over an unrelated file); delete it when the new file completes, or at once when room is short
// Keep partial: bytes saved without a gap from byte 0 -> truncate(atOffset: unbroken) -> vault as
//   "<stem> (partial).<ext>"; a stream: AVAssetExportSession.timeRange = 0 ..< shorter track's seconds
// the caption says exactly what each choice keeps ("Keeps 0:14 of 0:24")
```

**Acceptance test.** C10 (`/tail`: bytes change after the first 64 KiB, same size, If-Range ignored; over 1 MiB
saved: File changed with the staging file untouched; under 1 MiB: restarts by itself and completes as the new file,
never a mix), C20 / C21 (Start over never touches another file named `<name>.old.part`; the old partial is kept until
the new file is complete), G7 (`/vod-reenc`, the same number of segments re-encoded: File changed; Keep partial gives
"Keeps 0:14 of 0:24").

---

### 17. Completion and room checks, and one-pass SHA-256 into the vault — **S**, value medium

**Problem today.** Completion goes into the AES-GCM vault with no described coverage check, server checksum check
or free-space check. A pre-sized file always "has the right size", so the size alone proves nothing.

**What Deer does.** Complete only when every segment covers its range exactly, the bytes add up, the size is right
and any server digest matches; with no strong validator and no digest, 4 windows (block 0, 1/3, 2/3, last; one try
each) are compared, and anything that can't be compared lets the file complete. Room = missing bytes + 16 MiB +
what other running downloads still need ([10 §11](10-multi-connection-engine.md#11-room-on-the-disk),
[§21](10-multi-connection-engine.md#21-completion-checks), [11 §8](11-integrity-resume-retry.md#8-server-checksums-and-the-completion-check),
[§24](11-integrity-resume-retry.md#24-the-end-of-a-download-verify-final-seal-rename-safe-browsing-mark-of-the-web-record)).

**iOS design.** `RangedDownload.swift`, `Downloads.swift` (vault step).

- Coverage: `segs.allSatisfy { $0.start + $0.received == $0.end }`, sum == total, staging size == total.
- Digest: `Repr-Digest` / `Digest` `sha-256=<base64>` (or `Content-MD5` from a 200) checked while encrypting into
  the vault, in the same read: CryptoKit `SHA256()` (and `Insecure.MD5()`) updated with each chunk. Store size and
  SHA-256 with the vault entry. A mismatch fails with "The finished file doesn't match the server's checksum."
- Room before start and before each resume: `volumeAvailableCapacityForImportantUsage` ≥ missing + 16 MiB + other
  active downloads' missing bytes + the vault copy (the vault encrypts into a second file: about the file's size
  again; an inference from the audit, unverified).

**Acceptance test.** C15 (Content-MD5 right: completes; wrong: fails with the checksum sentence), C17 (`/vary?full=1`,
a link valid for one full download and no strong validator: completes; the completion check can't compare and does
not stop it), C18 (a file under 1 MiB with no validators that changes while downloading: the completion check sees
it and the download restarts by itself), B13 (the room check counts the whole file for a fresh download and counts
another running download's missing bytes once).

---

### 18. A stream segment table, a resume proof and a quality fingerprint — **L**, value high

**Problem today.** Pause/resume exists, but no proof that the stream online is still the one being saved, and no
mapping by sequence or by time. A re-encoded stream with the same number of segments would be mixed; a renumbered
playlist would restart or mix.

**What Deer does.** Every written segment adds a journal line `{i, seq, off, len, h, d}` (SHA-256 cut to 128 bits of
the decrypted bytes). A resume checks the length (± 1 s), finds the next segment by `(seq0, nextSeq)` or by
cumulative `EXTINF` (± 0.05 s plus a neighbour check), re-fetches the init and the last written segment and compares
their hashes; when no address changed this runs beside the download with a window of 1 and writes nothing until it
passes. A short part is cut back to its last good segment; damaged middle segments are fetched again in place. An
expired master is re-read and the same quality re-picked by fingerprint
([21 table](21-hls-dash-engine.md#the-segment-table-journal-of-written-segments),
[resume](21-hls-dash-engine.md#resume-of-a-half-done-stream-the-proof-and-where-to-continue),
[saved part](21-hls-dash-engine.md#checking-the-saved-part-cut-short-damaged-changed-by-another-program),
[durable marks](21-hls-dash-engine.md#durable-progress-marks-and-snapshot),
[renewal](21-hls-dash-engine.md#renewal-steps-when-a-playlist-or-master-expires-g2-steps-2-4),
[12 §27](12-download-manager.md#27-a-streams-segment-table-tablets)).

**iOS design.** `HLSDownload.swift`; the journal in Application Support, excluded from backup.

```
journal lines (JSON):
  header per track {k, seq0, count, durHash (FNV-1a of durations to 3 decimals), init (hash), keys, rung}
  segment {k, i, seq, off, len, h, d}      // appended after each in-order write; synchronize() at pause/background
save with the counts: nextSeq, lastDur, secs (only after the write returned: durable marks)

resume(track, playlist):
  abs(playlist.duration - saved length) <= 1 s            else File changed "it is now M:SS long"
  k = mapNext(): if playlist.firstSeq == seq0 and nextSeq known: index of nextSeq, accepted when the
        cumulative EXTINF before k is within max(0.05 s, 0.1 %) of secs and the duration before k is
        lastDur +- 0.05 s; else walk k = 1... for cumulative EXTINF == secs +- 0.05 s with the neighbour check
  k == nil                                                 -> File changed "its parts no longer line up"
  re-fetch init (as init) and segment k-1: hashes must equal the table
  no address changed -> run that proof beside the download: fetch only segment k, write nothing until it passes
  every segment already written -> go straight to the join, no network
  saved part shorter than recorded -> cut back to the newest of the last 4 lines that still hash right
  unclean launch, or the part modified > 5 s after its last seal -> re-hash every line; else the last 2 + 2 seeded
```

**Risks.** Journal and counts out of step after a kill (Deer takes the place from the last line below the saved
count); hashing cost (the bytes are already in memory when written).

**Acceptance test.** G6 (`/vod-sign`: the variant's token expires during a pause; the master is read once, the same
rung re-picked, the last written segment fetched once and compared, the download continues at the next sequence,
nothing earlier fetched again), G7 (`/vod-reenc`: File changed, staging untouched), G9 (a damaged middle segment:
only it is fetched again and written back in place), G10 (all segments written, addresses since expired: the join
runs with no request at all).

---

### 19. HLS parallel window, memory bound, hedging and per-segment retries — **M**, value medium-high

**Problem today.** The audit does not describe how many segments `HLSDownloadTask` fetches at once, how memory is
bounded, or per-segment retry rules. One stalled segment can hold up the in-order writer.

**What Deer does.** Up to 16 connections (8 by default); a window of `max(24, 4 × connections)` segments; strict
in-order writing; 48 MiB of early segments in RAM, then spill to disk; a 32 MiB write backlog; the head segment raced
after `max(3 s, 2 × average)` once; 3 attempts (2 s, 6 s); Retry-After up to 60 s, longer stops the run so the row
waits; a connection turned away by 429/503 steps aside while others continue; byte-range pieces with If-Range, a
new validator accepted only after the last written piece re-hashes the same
([21 parallel](21-hls-dash-engine.md#parallel-segment-fetching-with-in-order-writing),
[hedge](21-hls-dash-engine.md#racing-an-overdue-segment-hedging),
[retries](21-hls-dash-engine.md#per-segment-retries-and-connections-that-step-aside),
[byte ranges](21-hls-dash-engine.md#byte-range-pieces-and-if-range-ext-x-byterange-dash-segmentbase-hls-slips-counted-after-the-proof)).
Deer's code says racing and spill came from the owner's `HLSDownload.swift`: check TitleLess first.

**iOS design.** `HLSDownload.swift`.

```
actor SegmentWindow { head, next, ready: [Int: Piece], heldBytes, avgMs (avg = 0.8*avg + 0.2*last), hedged }
conns = min(setting, 16) (on a phone 4-6 may be enough: judgement, not measured)
worker loop:
  requeued index first; else next if next < head + ahead (ahead = max(24, 4*conns); 1 while a lazy proof runs)
  else if head started, not ready, not hedged, and now - started[head] > max(3 s, 2*avgMs):
      hedge it once on another lane's session; the first answer wins, cancel the other; a lost race is no failure
  else wait (woken by any arrival)
take(i): fetch -> decrypt -> sniff (item 1) -> keep in RAM, or spill to "<staging>.d/<i>" when heldBytes
         would pass the cap (16-24 MiB on iOS, judgement)
writer: append ready[head] in order, head += 1; table line (item 18); wait while the disk is behind
retries: 3 attempts (2 s, 6 s); Retry-After <= 60 s; longer and this is the last connection -> stop, row waits;
         429/503 with other workers alive -> this worker retires, its segment goes to the front of the queue
```

**Acceptance test.** G4 (`/hedge/fx/`: the first request for `seg005` crawls at 8 KB/s; at least 2 requests for
`seg005`; the 24 s stream finishes in under 15 s), G13 (HLS byte ranges over one file whose ETags flap or change on
every answer: completes; the file swapped: File changed by its bytes).

---

### 20. Signed-link expiry, renewal from the original link, "Use another address…" — **M**, value medium-high

**Problem today.** No renewal is described. A `WKDownload` or HLS item whose signed URL expires cannot continue;
starting it again probably makes a new item and downloads everything again.

**What Deer does.** Reads the expiry time from the URL's query; renews before the first request when it passed;
renewal asks the original address and every recorded redirect hop again, proves the answer is the same file, and
adopts it under the same name; single-flight in a run (≤ 3 per run, ≤ 1 per 10 s, failures remembered 30 s);
outside a run at about 2 min, 15 min, 1 h and 6 h after the failure; a pasted link or a re-click on the page is
proven and continues the same row ([11 §19](11-integrity-resume-retry.md#19-expired-links-reading-the-expiry-time-from-the-url),
[§20](11-integrity-resume-retry.md#20-renewing-the-link-the-original-address-the-schedule-and-adopting-a-proven-address),
[§21](11-integrity-resume-retry.md#21-attaching-a-download-started-again-on-its-page-and-the-keep-partial-helpers),
[12 §17](12-download-manager.md#17-starting-it-again-on-its-page-pre-match-attach-refresh-address),
[30 M8](30-ux-tests-history.md#mechanism-8-use-another-address-paste-a-new-link-for-the-same-file)).

**iOS design.** `Downloads.swift`, `RangedDownload.swift`.

```swift
func expiresAt(_ url: URL, now: Date = .now) -> Date? {
    // query names compared case-insensitively; first match wins
    // X-Amz-Date / X-Goog-Date "yyyyMMdd'T'HHmmss'Z'" (UTC) + X-Amz-Expires / X-Goog-Expires seconds
    // Azure: se=<ISO 8601>, only when sig= is present
    // Akamai: hdnts= or __token__= containing exp=<9-13 digits> between "~" separators
    // Expires / exp / e = 9-13 digits (milliseconds if > 1e12), accepted only in [now - 1 year, now + 10 years]
}
let renewalGaps: [TimeInterval] = [0, 2*60, 13*60, 45*60, 300*60]   // ~2 min, 15 min, 1 h, 6 h after the failure
// addresses = [finalURL, originalURL] + redirect hops (<= 8), skipping the failing one and expired ones
// each through the same-file proof (window 0 + windows); SAME -> adopt finalURL, hops, validators;
//   keep name, segments and staging file; history "New link found"
// in a run: one shared attempt (actor), <= 1 per 10 s, <= 3 per run, failure remembered 30 s
// outside a run: renewalGaps; then only on network back (<= once per 10 min) or a manual action;
//   tries saved with the item
```

"Use another address…": a text field in the item's details; the pasted address is asked with no Referer and no
Origin, proven, and answers "That address is a different file (256 MB; this download is 24 MB).", "That address
answers with a web page, not the file." or "Couldn't reach that address." A re-click on the page is scored (same tab
+5, same name stem +3, same path shape +3, same page +2, same site +1; 5 nominates) and only the byte proof decides.
In the background, `BGAppRefreshTask` can run a scheduled attempt (timing up to the system; unverified).

**Acceptance test.** D5 (`/sign` → 302 → `/signed/<token>` expired during a pause: on Resume the original address is
asked first, the dead one never; only missing ranges; history "New link found"), D6 (the token expires mid-run on
8 connections: exactly one request to the original address; nothing fetched twice), D7 (`uses2`, a new address that
passes the proof but refuses the transfer: next try 2 min later, then 13 min on, not 2 again), D8 (`/signed-once`:
Link expired with status 403, next try in about 2 min), D12 (a pasted fresh address of the same path and name
continues the same row, asked with no Referer).

---

### 21. A background and lifecycle strategy — **L**, value high

**Problem today.** A background `URLSession` exists, but the audit does not say whether ranged parts or HLS segments
continue in the background, how interrupted tasks are re-queued on the next launch, or whether the app tells
"the person paused it" from "the system stopped it".

**What Deer does.** Seals at every stop; a dirty mark and a session-clean flag tell a crash from a clean stop; what
a quit or crash stopped continues 10 s after the next start; waits continue by themselves and never block leaving;
on drives without sparse files (where writing far into a file makes Windows zero-fill first), one file per part
joined in crash-safe 8 MiB steps
([11 §12-§14](11-integrity-resume-retry.md#12-seals-and-the-durable-flush-flushfilebuffers),
[§16](11-integrity-resume-retry.md#16-quiet-stretches-waiting-for-network--retrying-the-rejoin-proof-and-waits-outside-a-run),
[12 §16](12-download-manager.md#16-waits-that-continue-by-themselves-and-the-single-wait-timer),
[§21-§22](12-download-manager.md#21-start-up-and-continue-unfinished-downloads-when-deer-starts),
[10 §22](10-multi-connection-engine.md#22-idms-layout-on-drives-without-sparse-files-parts--join)).

**iOS design.** `Downloads.swift` (and the app's `Info.plist` for the task identifier).

1. **Seal on the way out.** On `scenePhase == .background`, inside `beginBackgroundTask`: stop accepting chunks, let
   the writers finish, `synchronize()`, save the list with durable counts, set `session.clean = true`.
2. **Keep going when the person started it** (iOS and iPadOS 26+): when a download starts from a tap, register the
   launch handler and submit a `BGContinuedProcessingTaskRequest` (b3) for it, with the file name as the title and
   the identifier `<bundle id>.download.<item id>` (a wildcard `.download.*` in `Info.plist`); drive
   `task.progress` from the engine (Apple expires tasks that show no progress first); in `expirationHandler` (system
   expiry **or** the person's Cancel in the Live Activity) seal and set `resumeOnLaunch`; call
   `setTaskCompleted(success:)` at the end. Do **not** submit one for automatic work (the launch re-queue of item 7,
   a scheduled renewal, a retry wait): Apple says these tasks must come from an explicit action. Whether Cancel in
   the Live Activity should mean Pause or something else is a product decision; Deer's rule suggests Pause (keep the
   bytes).
3. **Fallback without that permission** (iOS < 26, a `.fail` submission, or an expired task): turn each unfinished
   segment into a background `URLSessionDownloadTask` with `Range: bytes=<frontier>-<end-1>` (+ If-Range); in
   `didFinishDownloadingTo`, move each file at once to `<staging>.parts/<hex start>.part`; when back in the
   foreground (or relaunched), check each part's response (status 206, `Content-Range`, validators, not a page) and
   join the parts into the staging file in 8 MiB steps, saving the list after each part, then delete it. A kill at
   any step leaves a valid state. Range in background tasks: unverified; if refused, fall back to one plain task for
   the rest (resumeData). Apple's documented limits shape this step (b1):
   - Create all the part tasks **at once, in one background session**, and while the app is still in the
     foreground if possible: a task created once the app is in the background is treated as discretionary (it may
     wait for Wi-Fi and power), and tasks started from the background after a resume pass the growing rate-limiter
     delay.
   - Redirects are followed without the delegate, so the redirect hops of item 20 cannot be recorded here; give the
     tasks the final address learned in the foreground.
   - A force-quit cancels them all; the next launch must treat the row as stopped by the system and check the parts
     that did arrive.
4. **HLS in the background:** prefer step 2. Segments as background download tasks land as files (a natural spill),
   but Apple warns that every task has its own overhead and advises fewer, larger transfers over thousands of small
   ones, so a stream of hundreds of segments is a poor fit (how slow it gets: unverified).
5. **Waits:** `NWPathMonitor` moves network waits to now + 5 s; no retries while suspended; on `.active`, bring due
   waits forward.
6. **Notifications:** Deer shows none on the desktop ([30 M18](30-ux-tests-history.md#mechanism-18-no-system-notifications-a-deliberate-choice)).
   On iOS the app is often away when a download ends: post a local notification for completion or for a state that
   needs the person, only when the app is not in the foreground.

**Risks.** The most platform-dependent item: background-session behaviour, the continued-processing policy (how
many tasks may run at once, how long they get: not documented), file protection while locked (b4). Build it after
items 6 and 7, and test on devices, not only the Simulator.

**Acceptance test.** E1 / E2 adapted (drop the network: "Waiting for network", never Failed; restore it: continues
within a few seconds after proving one saved window; only missing bytes fetched), E4 (the device offline: no request
reaches the server while offline; back online: asks at once and receives within 5 s), E9 adapted (send the app to the
background mid-download and bring it back: sealed, then continues through its resume probe), F3 adapted (force the
parts path: parts joined in order, a kill during the join loses nothing, SHA-256 equal).

---

### 22. Show the truth: progress numbers, "Checking" after 400 ms, history lines, attention, a safe main button — **S**, value medium-high

**Problem today.** None of this is described. Without it, the self-healing of items 4-21 is invisible, and a hasty
tap on "Retry" can throw away saved bytes.

**What Deer does.** One status word per state (a 19-step ladder), a caption sentence ("The link stopped working (403)
· 62 % is saved · next try 14:05"), an 8-block bar showing where the holes are, the last 5 history lines, an attention
dot only for rows that started needing the person this session, "Checking" only after 400 ms, speed over a 3 s
window, average over active time only, ETA "—" when unknown, and a primary action that never destroys bytes
([30 M1](30-ux-tests-history.md#mechanism-1-one-state-model-for-every-surface-state-phase-need-wait),
[M2](30-ux-tests-history.md#mechanism-2-the-windows-copy-of-the-list-updated-once-per-frame),
[M3](30-ux-tests-history.md#mechanism-3-numbers-and-dates-in-words-formatts-and-how-speed-and-eta-are-measured),
[M5](30-ux-tests-history.md#mechanism-5-a-row-columns-the-primary-verb-and-space-never-destroys-bytes),
[M6](30-ux-tests-history.md#mechanism-6-the-details-pane-connections-bar-caption-history-line-facts-actions),
[M9](30-ux-tests-history.md#mechanism-9-needs-attention-without-dialogs-ring-dot-live-region-counts),
[M16](30-ux-tests-history.md#mechanism-16-history-lines-every-automatic-fix-leaves-a-sentence)).

**iOS design.** `Downloads.swift` (the engine side and the store the UI observes).

```
engine tick every 250 ms while runs exist:
  dt = min(now - last, 2 ticks)                    // time the app was suspended is not active time
  samples += (now, netBytes); drop samples older than 3 s (keep >= 2)
  speed = span >= 0.5 s ? (netBytes - first.bytes) / span : old speed
  activeTime += dt while downloading with no phase; peak = max(peak, speed)
  average = netBytes / activeTime; eta = speed > 0 && total known ? left / speed : nil   // nil shows "—"
publish one snapshot to an @MainActor @Observable store at most 4 times a second (never per chunk)
eta wording: carry 60 minutes into the hour (Deer's eta() can print "1 h 60 min"; don't copy that)
8 cells: for files, how much of each eighth of the byte range is received; for streams, segments written per eighth
"Checking" appears only if the resume check takes more than 400 ms (race a Task.sleep)
events: [HistoryEvent], last 5: "New link found today, 13:02", "Continued after restart", ...
attention: need started this session -> badge dot on the downloads button + one
  UIAccessibility.post(notification: .announcement, argument: "song.mp3: Link expired")
main button / leading swipe = the safe verb (Pause, Resume, Try now, Refresh address, Open page);
  Start over and Restore only as explained buttons in the details; on File changed the main button
  only moves focus to the choice
decide the verb on the engine's state at tap time (await manager.state(id)), not on the UI snapshot
```

**Acceptance test.** E3 (`/slow`: a resume whose check takes 1.5 s: for the first 400 ms a dimmed bar at the old
percentage and no word; then "Checking"), A13 (`vserve /stall`: after 1 MiB the server stalls: speed falls below
1 KB/s and ETA shows "—"; Pause stops at once and keeps the bytes), and H7 adapted (every state shows its word,
caption and verb; ui.js's "Space on File changed only moves focus" becomes "the main button on File changed only
focuses the choice; the staging file is untouched").

---

### 23. A queue: two at a time, in strict order — **S**, value medium

**Problem today.** No queue or concurrency limit is described. Many downloads at once each with many connections
compete for one phone's bandwidth and memory.

**What Deer does.** `MAX_ACTIVE = 2`; a strictly increasing queue stamp `max(now, last + 1)` keeps a batch in the
order asked; Resume goes to the back; "Try now" jumps the queue (and starts even past the limit); renewals, checks
and page steps never hold a slot ([12 §3](12-download-manager.md#3-the-queue-two-at-a-time-strict-order)).

**iOS design.** `Downloads.swift` (`DownloadManager`).

```swift
private var lastQueued: Date = .distantPast
func queueStamp() -> Date { lastQueued = max(.now, lastQueued.addingTimeInterval(0.001)); return lastQueued }
func pump() {
    var active = items.filter { $0.state == .downloading && !$0.isWebViewDownload }.count
    for item in items.filter({ $0.state == .queued }).sorted(by: { $0.queuedAt < $1.queuedAt }) {
        guard active < maxActive else { break }; launch(item); active += 1   // maxActive = 2 (a setting)
    }
}
```

**Acceptance test.** A5 (six downloads started at once while one slow download already runs: only one of the six
runs, because the slow one holds the other slot; the other five wait in start order with queue positions 1 to 5;
and with two running, a third is queued at position 1), A6 (Pause then Resume before the connections closed, and Pause-Resume-Pause: "the
last word wins", file intact).

---

### 24. A block hash record for direct files, and a check after an unclean launch — **L**, value medium

**Problem today.** After a kill, the app cannot tell which saved bytes are good. The vault's AES-GCM detects damage
only in finished files, and only as a whole.

**What Deer does.** File-aligned blocks (1-64 MiB) hashed as soon as they are certainly on disk (SHA-256 of 1 MiB chunk
hashes, cut to 128 bits, plus a hash of the block's first 64 KiB), kept in an append-only journal; seals every 30 s /
256 MiB and at every stop; after an unclean end each segment is rewound to its last contiguous hashed block and
blocks hashed after the last seal are re-hashed; every resume spot-checks 2 blocks below each frontier plus 2 chosen
from the download's id; re-fetched blocks must hash to their **old** value, or the file changed
([11 §11-§13](11-integrity-resume-retry.md#11-the-block-hash-record-the-ledger-and-its-journal),
[§25](11-integrity-resume-retry.md#25-finished-files-check-file-repair-restore-original)).

**iOS design.** `RangedDownload.swift` (a new hash-record type), journal in Application Support.

```
when a block lies wholly under durable bytes: read it in 1 MiB pieces (FileHandle.read(upToCount:)),
  chunk hashes with CryptoKit SHA256, block hash = first 16 bytes of SHA256(chunk hashes joined),
  head hash = SHA256(first 64 KiB); at most 2 blocks at once; pause hashing while throughput is very high
journal "<id>.jsonl": header {id, url, total, bs, etag, lm} / block {b, h, w, t} / seal {cov, t, f} /
  drop {blocks, why} / decision {restart|keep}; torn last line ignored; compaction = temp file + replaceItemAt
seal: every 30 s or 256 MiB (>= 5 s apart) and at every stop: synchronize the staging file, append the seal
  line (synchronized), save the list
launch after an unclean end: rewind each segment to its last contiguous hashed block; re-hash blocks hashed
  after the last seal (2 minutes earlier if that seal could not flush); always spot-check the last 2 hashed
  blocks below each frontier + 2 picked by FNV-1a of the item id; bad blocks are fetched again and must
  re-hash to their OLD value, else "File changed"
```

Optional, for the vault: seal finished files in fixed chunks (each with its own GCM nonce and tag) and keep chunk
hashes, so a damaged chunk can be found and re-fetched while the link still works.

**Acceptance test.** E12 (hard kill: the row comes back paused and marked to check; only the damaged blocks below each
mark are fetched again, not 8 MiB per segment; history "Checked after the app closed unexpectedly · N MB fetched
again"), E14 (the dirty mark set, no seal, 3 MiB of zeros under the claims: those blocks are fetched again, the file
intact), F5 (bytes changed by another program during a pause: only that block is fetched again, one exact range),
F6 (the staging file deleted during a pause: starts over by itself with the history line "Started over: the saved
part was moved or deleted").

---

### 25. DASH, in the same segment model, MP4 only — **L**, value medium

**Problem today.** No DASH at all. Pages whose players load an `.mpd` offer nothing (or a wrong file).

**What Deer does.** Each DASH representation becomes the same segment list HLS uses, so retries, refresh, proof and
the table are written once. One `Period` only (more are refused); `BaseURL` at each level; `SegmentTemplate`
attributes merged Period → AdaptationSet → Representation with `$RepresentationID$`, `$Bandwidth$`, `$Number%0Nd$`,
`$Time$`, `$$`; `SegmentTimeline` with negative `r`; `SegmentList`; `SegmentBase` fetched as 4 MiB byte ranges; any
`ContentProtection` = DRM; `type="dynamic"` = live; renamed representations matched by attributes
([21 DASH parsing](21-hls-dash-engine.md#dash-manifest-parsing-mpd),
[representation choice](21-hls-dash-engine.md#dash-representation-choice-and-the-track-url-trick)).

**iOS design.** `HLSDownload.swift` (or a DASH parser file next to it), `MediaControls.swift` (the offer).

- Parse with `XMLParser` into the HLS `Segment` model (item 8).
- Choose only representations AVFoundation can join: `video/mp4` with `avc1` / `hvc1`, `audio/mp4` with `mp4a`
  (or `ec-3`), in the language of the first audio representation. Skip WebM.
- Join with `AVMutableComposition` + passthrough export (item 15).
- `r < 0`: `r = max(0, ceil((nextT - t) / d) - 1)`; without a timeline: `count = ceil(periodSeconds × timescale /
  duration)`, capped at 100,000.

**Risks.** Multi-period manifests (ads) are refused, as in Deer; `sidx` is not parsed (whole file in pieces); WebM
representations are skipped.

**Acceptance test.** G3 (DASH `SegmentTemplate` + `SegmentTimeline`, video + audio: one MP4), G8 (representations
renamed, old addresses 404: matched by attributes, continues; renamed **and** re-encoded mid-run: File changed), and
mark.js's MSE page whose `<video>` has no address but which loaded a DASH manifest (the picker offers what the page
loaded).

---

## d. Do not port

### d1. What stays Windows, Gecko or desktop only

| Deer piece | Why not on iOS | What to keep instead |
|---|---|---|
| yt-dlp, Deno, ffmpeg as programs; downloading and updating them; `--continue`, kill-to-pause, `--progress-template` ([22](22-ytdlp-ffmpeg.md#what-is-not-portable)) | No child processes; Guideline 2.5.2 (no downloaded code) | AVFoundation for joining; the format rules, the resume fingerprint, the progress design |
| Saving YouTube-class videos by any technique: a Swift extractor, `JSContext` challenge solving, a server running yt-dlp, a library's remote mode ([22 options](22-ytdlp-ffmpeg.md#options-for-youtube-class-sites-and-an-honest-verdict)) | Guideline 5.2.3; site terms; fragile; a server would see the person's traffic | Deer's "know where sniffing cannot work" list, used to show an honest "Saving videos from this site isn't supported" |
| WebM and MKV output, the "MKV holds anything" escape hatch | AVFoundation does not write them | Prefer variants AVFoundation can write as MP4 (item 14) |
| Necko lanes (`cookieJarSettings` partitions, `allowHttp3`), the pipe + `asyncCopy` writer, js-ctypes workers | Gecko internals | One `URLSession` per lane (item 9); one write actor per file (item 7) |
| The Firefox take-over plumbing (prefs, scratch folder, Firefox's Downloads list) | Gecko | `WKDownload` + a parallel probe (item 12) |
| NTFS sparse mark and "unsparse", `GetCompressedFileSizeW`, volume queries, the FAT32 4 GiB check | Windows file systems; APFS has sparse files | The room check; the parts **shape** for background tasks (item 21) |
| `FlushFileBuffers` in a worker | Windows | `synchronize()` or `F_BARRIERFSYNC` off the main thread (Apple's iOS advice: `F_FULLFSYNC` only when strong persistence is needed, b4), and recording whether the flush happened |
| Mark of the Web, Safe Browsing reputation, `.lnk` / `.scf` / `.url` renaming, Windows device names, the executable launch prompt | Windows threats | Keep the bidi-override and path-character cleaning of names |
| The quit prompt, the last-private-window prompt, taskbar progress, access keys, the Esc ladder, the 960 × 688 panel, the glass ring and flight animation | Desktop | The rules behind them: what the system stopped continues, what the person paused stays paused; waits never block leaving |
| 10 ms re-asks without limit and the 150 a second cap | Desktop on mains power; the 150/s reasoning is about Necko's own retries | The same classes with a lower cap, gated on `NWPathMonitor` |
| IDM habits Deer rejected: a first GET without Range, a new TCP connection for every part, 64-byte overlaps, ~1,270 asks a second in an outage, the endless loop when a file's size changed, the 64-byte check after an outage | Wasteful or unsafe ([10 §25](10-multi-connection-engine.md#25-the-idm-benchmark-2026-10-20)) | Deer's choices |
| The hidden page step as an always-on default | A hidden web view costs battery, makes traffic the person does not see, and may not load media off screen (unverified) | If ever built: foreground only, opt-in, Deer's budgets (one page at a time, 6 per site per hour, 30 s + 10 s), never click, sign in or fill anything |
| Speed limit | Low value on a phone | Optional; Deer's token bucket ([10 §16](10-multi-connection-engine.md#16-the-speed-limiter)) ports easily if wanted |
| Hover pill, Alt+click download, Ctrl+Shift+D | No hover on iPhone; desktop conventions | A toolbar badge + long-press action; on iPad a keyboard shortcut |
| Check file / Repair / Restore original for finished files | The vault's AES-GCM already detects damage; low priority | Keep the finished file's SHA-256 with the vault entry (item 17) |
| Firefox containers | Gecko | Separate `WKWebsiteDataStore`s, if TitleLess has them |

### d2. Legal and terms-of-service cautions

These are cautions, not legal advice.

- **Guideline 5.2.3.** Saving media from third-party services without their authorization is a review risk whatever
  the technique (b10). Keep YouTube-class sites out, and be ready to explain to App Review that the browser saves
  only files a page itself serves.
- **DRM.** Never try to get around FairPlay, Widevine or PlayReady. Many countries have laws against breaking copy
  protection. Refuse early and say so (item 3).
- **Site terms.** Many video sites forbid saving their videos. Deer shows "Check that the site's terms allow saving
  its videos." once per big host (YouTube, Facebook, Instagram, TikTok, X/Twitter, Vimeo, Twitch, Reddit,
  Dailymotion, SoundCloud, Netflix; [22 §18](22-ytdlp-ffmpeg.md#18-settings--video-downloads-and-the-windows-notes)).
  It is a courtesy, not a compliance answer.
- **Hotlink-protected embeds.** Asking "as the player's frame" (item 13) repeats the request the page's own player
  already made. Keep it to media that page is playing, and keep the tab's page as the download's source.
- **Privacy.** Never send the person's cookies or traffic to a third-party server (Deer's owner decision 14: no
  cookies even for local yt-dlp). Private-tab downloads use an ephemeral session, are never written to disk lists,
  and are never re-fetched in the background.
- **Disguised segments** (media hidden behind a tiny image, [21](21-hls-dash-engine.md#segments-disguised-as-images)):
  Deer's comment ties it to some CDNs; it is cheap to port but rarely needed. Low priority.
- **Licences.** Libraries such as YouTubeKit (MIT, per its README) or an ffmpeg build (LGPL) bring licence duties;
  an LGPL library inside an App Store app needs care (unverified).

---

## e. Suggested order of work

Each milestone ends when its checklist tests pass in XCTest against the local server, and the control test C1 is
still green.

**Milestone 1 — Truth and safety (about 2 weeks).** Items 5, 1, 4, 3, 2, 23.
Build the harness first, then make sure no web page is ever saved, every failure lands in the right state, DRM and
live are refused, and the right video is picked.
Exit tests: the SHA-256 and request-count checks of A1 (one connection is fine here), C1, D1, D2, D3, D4, G16, G17, G18, B12, E1, E5, E8, A5.

**Milestone 2 — Resume that never mixes (about 2-3 weeks).** Items 6, 7, 16, 17, 22.
Validators and If-Range, window 0 on resume, durable progress, a crash-safe list, "continue what the system
stopped", File changed with Start over / Keep partial, completion and room checks, honest progress and wording.
Exit tests: A2, C1, C2, C4, C5, C10, C11, C15, C17, C18, C20, C21, B13, E3, E11, E15, A13.

**Milestone 3 — Streams that survive (about 3-4 weeks).** Items 8, 13, 14, 15, 18, 19.
Sequence matching and refresh of expired segments, per-document detection with frames, the ladder and audio
renditions, a crash-safe join with a length check, the segment table and resume proof, the parallel window with
hedging.
Exit tests: G1, G2, G4, G5, G6, G7, G9, G10, G11, G13, G19, G20, E13.

**Milestone 4 — Fast like IDM (about 2-3 weeks).** Items 9, 10, 11, 12.
Real separate connections, work stealing, stall and slow cuts, retry classes with standby, and navigation downloads
taken over with the page's identity.
Exit tests: A1 (≥ 8 ports, no overlap), B2-B7, B10, B11, B14-B17, H4, H5, the take-over controls; plus the manual
HTTP/2 port count of item 9.

**Milestone 5 — Long-running work and renewals (about 3-4 weeks).** Items 21, 20, 24, 25.
Background and lifecycle strategy, link renewal and "Use another address…", the block hash record, DASH.
Exit tests: E2, E4, E9 (adapted), E12, E14, F3 (adapted), F5, F6, D5, D6, D7, D8, D12, G3, G8.

---

## Verification notes

A fact-check of the iOS side of this guide, done on 2026-10-29 by reading Apple's pages on the web (no device, no
build). Each claim was compared with the source; wrong claims were fixed in place above. Apple's documentation
pages were read through their JSON form (`developer.apple.com/tutorials/data/documentation/...json`), which holds
the same text as the normal page.

**Counts.** 14 claims were wrong, too strong or missing a rule that changes the design, and were corrected (table
below). 9 claims that were marked
"(unverified)" are now confirmed by a source. 15 claims were confirmed as written. 10 groups of useful facts found
during the check were added. 18 points were looked up but stay "(unverified)" because no primary source states
them. Links: every internal link of this guide and of `00-README.md` resolves to a real file and heading (checked by
script after the edits: 290 links, 0 broken). The Deer description of each of the 25 items was compared with the
section it links to (key constants grep-checked in sections 10, 11, 12, 20, 21, 30): no wrong number found; 2
wording fixes on the Deer side, 1 acceptance-test fix and 1 pseudo-code fix (below the table).

**What was wrong, and is now fixed**

| Where | Before | After (source) |
|---|---|---|
| b2 | `httpMaximumConnectionsPerHost` default "6 on macOS and 4 on iOS" | Default 6, one value; per session; HTTP/1.1 only, HTTP/2 and later ignore it ([httpMaximumConnectionsPerHost][s-hmc]) |
| b1 | Range in a foreground download task "works; the file holds only that range" | Not documented by Apple: unverified, test it; `Range` / `If-Range` are at least not reserved headers ([NSURLRequest, Reserved HTTP headers][s-reserved]) |
| b1, item 21 | "Use few tasks (≤ 4) so the system does not throttle them" | Apple's advice is the opposite shape: one background session, start many tasks at once, fewer larger transfers; a rate limiter delays tasks started from the background ([Downloading files in the background][s-bgdl]) |
| b1, item 21 | Background fallback created "before suspension" with no caveat | Tasks created while in the background are discretionary (may wait for Wi-Fi and power) ([same][s-bgdl]; [AVAssetDownloadURLSession][s-avadl]) |
| b1, b2, item 21 | Redirect hops recorded through `willPerformHTTPRedirection` in every session | In a background session redirects are always followed and that method is not called ([same][s-bgdl]) |
| b3 | `BGContinuedProcessingTask`: names right, but "network rules and time limits: unverified"; registration timing, the queue/fail choice, the Live Activity and the Cancel path missing | Handler registered dynamically when the person acts; `strategy` `.queue` (default) or `.fail`; wildcard identifiers; Live Activity; Cancel calls the expiration handler; explicit action only ([class][s-bgcpt], [article][s-longrun], [WWDC25 227][s-wwdc25]) |
| b4 | `FileHandle.synchronize()` "is `fsync`" | Apple only says it writes to permanent storage; `fsync` underneath is unverified ([fsync(2)][s-fsync]) |
| b4, item 7 | `writeAll(toAbsoluteOffset:)` "loops until every byte is written" | Writes every byte or throws; keeps the descriptor's offset ([writeAll][s-writeall], [write(toAbsoluteOffset:)][s-write]) |
| b5 | `waitsForConnectivity` makes a task wait "instead of failing" | Only while connecting; a dropped connection still fails; background sessions ignore it ([waitsForConnectivity][s-wfc]) |
| b8 | `AVURLAsset` "cannot open a raw `.ts` file" (stated as fact) | Not stated by Apple: unverified; check `AVURLAsset.audiovisualTypes()` at run time |
| b8 | Passthrough with `outputSettings: nil` into MP4 with no condition | Into any type other than `.mov` only a limited set of media types passes, and a `sourceFormatHint` is required ([AVAssetWriterInput init][s-awi]) |
| b9 | Guideline 2.5.6: "must use WebKit" | Also: an alternative-engine entitlement exists for the EU and Japan ([App Review Guidelines][s-arg]) |
| b10 | 5.2.3 paraphrase left out its first clause | Adds the clause against facilitating illegal file sharing, and the four named examples ([App Review Guidelines][s-arg]) |
| item 12 | Pseudo-code read `navigationAction` inside `navigationResponse:didBecome:` | That callback has no navigation action: read `download.originalRequest` ([WKDownload][s-wkdl]) |

Deer-side fixes: item 21 said the parts layout is for "drives where in-place writes are costly"; section 10 §22
says drives **without sparse files** (exFAT, FAT32, some shares). Item 23 called Deer's queue-jump "Start now"; section
12 §3 calls it **Try now**; its Swift `pump()` also never counted the downloads it launched (now `active += 1`, as
Deer's `pump()` does). Item 23's acceptance test A5 now matches checklist row A5 as corrected by the Deer-side
fact-check ([90-verification-deer.md](90-verification-deer.md)): the six start while one slow download already
runs, so only one of the six runs.

**Was "(unverified)", now confirmed**

- Force-quit from the app switcher cancels all background transfers and the app is not relaunched
  ([background(withIdentifier:)][s-bgcfg]).
- The background rate limiter and its reset in the foreground ([Downloading files in the background][s-bgdl]).
- `BGContinuedProcessingTask`: iOS / iPadOS 26.0+, `BGContinuedProcessingTaskRequest(identifier:title:subtitle:)`,
  `BGTaskSchedulerPermittedIdentifiers`, network use allowed, progress through `ProgressReporting`
  ([class][s-bgcpt], [article][s-longrun], [WWDC25 227][s-wwdc25]).
- `beginBackgroundTask`: Apple gives no number (only five seconds for `applicationDidEnterBackground`); an Apple
  DTS note says about 30 s ([Extending background execution time][s-bgtime], [DTS note][s-dts30]).
- `NSAllowsLocalNetworking` covers IP addresses such as 127.0.0.1 ([NSAllowsLocalNetworking][s-ats]).
- A device needs `NSLocalNetworkUsageDescription`; the Simulator does not enforce local network privacy
  ([TN3179][s-tn3179]).
- HTTP/2 runs many requests of one session over one connection ([httpMaximumConnectionsPerHost][s-hmc]).
- `isDiscretionary` behaviour, including tasks started in the background ([Downloading files in the background][s-bgdl]).
- `resumeData` conditions, now with Apple's full list ([cancel(byProducingResumeData:)][s-resume]).

**Confirmed as written** (no change needed beyond wording): the four file protection classes and the default
([Encrypting your app's files][s-fp]); `applicationWillTerminate(_:)` generally not called for apps that run in the
background ([applicationWillTerminate][s-awt]); `fsync` vs `F_FULLFSYNC` ([fsync(2)][s-fsync]); APFS sparse files
([About Apple File System][s-apfs]); `timeoutIntervalForRequest` 60 s idle and `timeoutIntervalForResource` 7 days
([request][s-tor], [resource][s-tores]); `URLError.NetworkUnavailableReason` (iOS 13) ([enum][s-nur]); `NWPath`
`isExpensive` / `isConstrained` ([NWPath][s-nwpath]); `WKHTTPCookieStore.allCookies()` ([getAllCookies][s-cookies]);
`setURLSchemeHandler` refuses http(s) ([setURLSchemeHandler][s-scheme]); `WKDownload` iOS 14.5+ ([WKDownload][s-wkdl]);
HTTP/3 on by default since iOS 15 ([WWDC21 10094][s-h3]); `AVAssetExportSession` `timeRange`,
`shouldOptimizeForNetworkUse`, `export(to:as:)` ([AVAssetExportSession][s-aes]); no child processes on iOS
([DTS, thread 747499][s-fork], [thread 72265][s-system]); data tasks in background sessions fail on suspension and
completion handlers are not supported ([DTS, thread 756333][s-dt], [thread 75851][s-ch]); guidelines 2.5.2, 2.5.4,
5.2.3 ([App Review Guidelines][s-arg]).

**Added during the check:** background download tasks are retried by the system after a timeout; `.ultraConstrained`
and `allowsUltraConstrainedNetworkAccess` (iOS 26.1+, no description yet) ([enum][s-nur],
[allowsUltraConstrainedNetworkAccess][s-uc]); Apple's iOS advice on `F_BARRIERFSYNC` and on the cost of atomic writes
([Reducing disk writes][s-rdw]); `AVAssetWriter` segment output; `exportAsynchronously` marked deprecated;
`configureForResumableExport()` listed as iOS 27.0+ ([configureForResumableExport][s-rexp]);
`AVAssetDownloadURLSession` facts ([AVAssetDownloadURLSession][s-avadl], [Using AVFoundation to play and persist
HLS][s-hlsp]); Guideline 2.5.4 (background services only for their purpose); an Apple media engineer's June 2026
answer on WebM, Opus and Vorbis ([thread 832486][s-webm]); MDN's note that Resource Timing `contentType` is not
Baseline ([MDN][s-mdn]).

**Still unverified** (no primary source found): `Range` / `If-Range` results in download tasks (foreground and
background); whether separate sessions can share one HTTP/2 or HTTP/3 connection; whether `Accept-Encoding:
identity` is sent unchanged and which encodings URLSession decodes; custom headers across redirects; HttpOnly
cookies in `allCookies()`; error codes of foreground tasks after a suspension; `ftruncate` creating a sparse
region; `synchronize()` = `fsync`; whether `.atomic` writes flush; the APFS name-length rule; the meaning of
`.ultraConstrained`; WebM, raw `.ts`, Opus or VP9 through AVFoundation; resumable export with passthrough; how many
continued-processing tasks may run at once and for how long; `BGAppRefreshTask` timing; Resource Timing `contentType`
and native HLS requests in WebKit on iOS; the legacy WebKit EME names and ClearKey; the LGPL question. A device test
or a direct Apple answer is needed for these.

**Not changed (outside this file's scope).** `01-overview.md` (glossary, BGContinuedProcessingTask row) and
`21-hls-dash-engine.md` still say the continued-processing details are unverified; `20-video-detection.md` quotes
5.2.3 "from memory". Section b of this guide supersedes them.

[s-hmc]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/httpmaximumconnectionsperhost
[s-reserved]: https://developer.apple.com/documentation/foundation/nsurlrequest#Reserved-HTTP-headers
[s-bgdl]: https://developer.apple.com/documentation/foundation/downloading-files-in-the-background
[s-bgcfg]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background(withidentifier:)
[s-avadl]: https://developer.apple.com/documentation/avfoundation/avassetdownloadurlsession
[s-hlsp]: https://developer.apple.com/documentation/avfoundation/using-avfoundation-to-play-and-persist-http-live-streams
[s-resume]: https://developer.apple.com/documentation/foundation/urlsessiondownloadtask/cancel(byproducingresumedata:)
[s-tor]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/timeoutintervalforrequest
[s-tores]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/timeoutintervalforresource
[s-wfc]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/waitsforconnectivity
[s-nur]: https://developer.apple.com/documentation/foundation/urlerror/networkunavailablereason-swift.enum
[s-uc]: https://developer.apple.com/documentation/foundation/urlsessionconfiguration/allowsultraconstrainednetworkaccess
[s-nwpath]: https://developer.apple.com/documentation/network/nwpath
[s-bgcpt]: https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask
[s-longrun]: https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados
[s-wwdc25]: https://developer.apple.com/videos/play/wwdc2025/227/
[s-bgtime]: https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time
[s-dts30]: https://developer.apple.com/forums/thread/85066
[s-fp]: https://developer.apple.com/documentation/uikit/encrypting-your-app-s-files
[s-write]: https://developer.apple.com/documentation/system/filedescriptor/write(toabsoluteoffset:_:retryoninterrupt:)
[s-writeall]: https://developer.apple.com/documentation/system/filedescriptor/writeall(toabsoluteoffset:_:)
[s-apfs]: https://developer.apple.com/documentation/foundation/about-apple-file-system
[s-fsync]: https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html
[s-rdw]: https://developer.apple.com/documentation/xcode/reducing-disk-writes
[s-cookies]: https://developer.apple.com/documentation/webkit/wkhttpcookiestore/getallcookies(_:)
[s-wkdl]: https://developer.apple.com/documentation/webkit/wkdownload
[s-scheme]: https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/seturlschemehandler(_:forurlscheme:)
[s-mdn]: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/contentType
[s-awi]: https://developer.apple.com/documentation/avfoundation/avassetwriterinput/init(mediatype:outputsettings:)
[s-aes]: https://developer.apple.com/documentation/avfoundation/avassetexportsession
[s-rexp]: https://developer.apple.com/documentation/avfoundation/avassetexportsession/configureforresumableexport()
[s-webm]: https://developer.apple.com/forums/thread/832486
[s-h3]: https://developer.apple.com/videos/play/wwdc2021/10094/
[s-fork]: https://developer.apple.com/forums/thread/747499
[s-system]: https://developer.apple.com/forums/thread/72265
[s-dt]: https://developer.apple.com/forums/thread/756333
[s-ch]: https://developer.apple.com/forums/thread/75851
[s-arg]: https://developer.apple.com/app-store/review/guidelines/
[s-ats]: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
[s-tn3179]: https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
[s-awt]: https://developer.apple.com/documentation/uikit/uiapplicationdelegate/applicationwillterminate(_:)
