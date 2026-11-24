# Fact-check of the Deer side of the study

Written on 2026-10-29 by an adversarial fact-checker. The checker read the code on disk (branch `macos-port`,
last commit `8e80350`) and `git log` / `git show`. Nothing was run. No code was changed. Only the study files
listed below were edited.

Files checked: `01-overview.md`, `10-multi-connection-engine.md`, `11-integrity-resume-retry.md`,
`12-download-manager.md`, `20-video-detection.md`, `21-hls-dash-engine.md`, `22-ytdlp-ffmpeg.md`,
`30-ux-tests-history.md`. Not checked (another checker owns them): `00-README.md`, `40-ios-port-guide.md`.

## Counts

| | Number |
|---|---|
| `path:line` citations in the 8 files, resolved and range-checked by a script | 1,991 |
| Citations the script flagged (no named identifier near the cited line), each read by hand | 196 |
| Concrete claims checked by hand against the code (constants, timings, algorithm steps, state names, command lines, test names, commit facts) | 183 |
| Wrong or misleading claims or citations found | 13 (one of them is a group of 8 citations with the same problem) |
| Fixed in place | 13 |
| Subsections added in the completeness pass | 2 |

Most of the study is accurate. The writers quoted constants exactly and cited lines well. The mistakes were
small: a count, a line off by one, a path that names two files, one rule stated too narrowly, and one test row
that described the test wrongly.

## How the check worked

1. **Citation sweep.** A script found every `file:line`, `file:a-b` and `file:a, b` in the 8 files, resolved bare
   names (`ranged.ts`, `hls.ts` ...) to the repository file, and checked that every line exists. Then, for each
   citation, it took the names in backticks on the same study line and looked for them within 6 lines of the
   cited code. 196 citations had no such match; each was opened by hand. Almost all were fine (the line holds a
   value or a comment, not the name). The real problems are in the tables below.
2. **Claim check.** For each section the checker picked the claims an iOS engineer would copy (numbers,
   thresholds, retry waits, pseudo-code, error sentences, test expectations) and read the code for each.
3. **Completeness pass.** Every file in scope was searched for in the 8 section files (see the last part).

Verdicts: **OK** = matches the code. **Fixed** = was wrong; the study file now says what the code says.

---

## 01-overview.md (25 claims, 0 wrong)

| Claim | Verdict |
|---|---|
| `adopt()` is `VitreDownloads.sys.ts:1164-1290` | OK |
| Pre-match scores: tab +5, name stem +3, path shape +3, page +2, site +1; 5 or more nominates (`attach.ts:24`, `:98-113`) | OK |
| First probe `Range: bytes=0-0` on lane 0 (`ranged.ts:578-580`) | OK |
| Resume probe `bytes=0-65535` with If-Range | OK |
| `MAX_ACTIVE = 2` (`VitreDownloads.sys.ts:257`) | OK |
| "Checking" shown after 400 ms (`CHECKING_AFTER`, `:272`) | OK |
| Room check: missing bytes + 16 MiB + other downloads' needs (`ranged.ts:2128`, `:2137`) | OK |
| Connections: default 8, range 1-32, menu 1, 2, 4, 8, 16 (`shared/settings.ts:71`, `VitreSettings.sys.ts:52`, `settings/pages.ts:507`) | OK |
| `MIN_SPLIT` 8 MiB; `MIN_STEAL` 1 MiB | OK |
| Block size formula (`ledger.ts:39-41`, `:77-82`) | OK |
| Disk back-pressure 8 MiB / 2 MiB (`ranged.ts:100-101`) | OK |
| Seal every 30 s or 256 MiB (`ledger.ts:49-50`) | OK |
| Tick 2 s; stall 10 s; slow 16 s under max(8 KiB/s, 25 % of median); others >= 64 KiB/s | OK |
| Retry gaps: cut 10 ms; server 4 s x k; offline 30 s; 150 asks/s; quiet stretch 10 s (`retry.ts:24-30`) | OK |
| Proof window 64 KiB, at most 4 (`proof.ts:33`, `:39`); ask above 1 MiB; quiet restarts 2 in 10 min | OK |
| Waits every 30 s, never give up; continue 10 s after start (`waits.ts:25`, `:29`, `:42`) | OK |
| Renewal schedule 0, 2, 15 min, 1 h, 6 h (`renew.ts:58` gaps 0/2/13/45/300 min) | OK |
| `stopped()` is `VitreDownloads.sys.ts:2508-2614` | OK |
| Streams: at most 16 connections, window `max(24, 4 x conns)` (`hls.ts:1161-1162`) | OK |
| Spill 48 MiB, write backlog 32 MiB (`hls.ts:182`, `:184`); hedge `max(3 s, 2 x avg)` (`hls.ts:1236`) | OK |
| Join length tolerance `max(2 s, 2 %)` (`hls.ts:196-197`) | OK |
| Media floor 500,000 bytes (`media.ts:237`); element clips under 5 s (`actors/page/downloads.ts:263`) | OK |
| SPA forgets media older than 1.5 s (`media.ts:278`); at most 4 playlists read (`media.ts:404`) | OK |
| Page reports: `src` cut to 8192, title to 300 (`window/.../video.ts` `asVideo()`) | OK |
| Ring hides 6 s after the last download (`ring.ts:30`, `HIDE_AFTER = 6000`); on-disk file names (`.part.new`, `.merge.part`, `.keep.part`, `.d/`, `.blocked`, `vitre-downloads.json`, journals, scratch folder) | OK |

## 10-multi-connection-engine.md (28 claims, 0 wrong)

| Claim | Verdict |
|---|---|
| `open()` `net.ts:802-825`; `dress()` `net.ts:346-367`: `Accept: */*`, `Accept-Encoding: identity`, Origin, extra headers, Referer with `UNSAFE_URL` | OK |
| `applyConversion = false` (`net.ts:539-544`); cache flags (`net.ts:341`) | OK |
| Redirect sink re-dresses every hop; non-http(s) refused with the quoted sentence; `CHAIN_MAX = 8` | OK |
| Channel suspended at the head (`net.ts:547`); early chunks kept (`:556-559`) | OK |
| Probe flow (`ranged.ts:560-643`): lane 0, 3 attempts 1 s apart, 200/206/416 accepted, tiny file asked `total - 1` | OK |
| `learn()`: `ranges = status 206 && total > 0`; a 200 is kept as `pending` (`ranged.ts:724-729`) | OK |
| `backoff()` 2 s, 6 s, 15 s; `IN_RUN_WAIT = 60`; `RETRYABLE_STATUS` includes 403 (`net.ts:95`, `:856-862`) | OK |
| Cloudflare challenge test (`cf-mitigated`, server + HTML + markers in first 4 KiB, `net.ts:790-796`) | OK |
| `connections()` and `plan()` (`ranged.ts:884-899`), and the plan table (9 MiB, 100,000,000 B → last segment 11,919,616 B, 3 GiB → 2 MiB blocks, 10 GiB → 8 MiB blocks): arithmetic redone | OK |
| `claim()` pseudo-code: nearest block boundary to the middle, 1 MiB both sides, 2 MiB needed (`ranged.ts:1276-1304`) | OK |
| Body consumer: room check, STOP after a split, `{wait}`, `{until}` (`ranged.ts:1718-1762`) | OK |
| `tick()` constants table and the stall/slow pseudo-code (`ranged.ts:136-151`, `:1606-1694`) | OK |
| Earliest cut about 16 s because `laneRate()` needs a full 8-tick window | OK (by reading `ranged.ts:1647-1650`) |
| Retry class table: `classOf()` / `delayOf()` (`retry.ts:40-64`), progress gate 1 MiB or 5 s, "other" leaves after 3 | OK |
| Pacer: 150/s, burst 150, one timer, monotonic clock | OK |
| `RateLimiter.take()` pseudo-code, 0.5 s burst, `binding()` (`limiter.ts`) | OK |
| Speed sampling: 3 s window, at least 2 samples, 0.5 s minimum span; active time capped at 2 ticks; ETA rounding (`VitreDownloads.sys.ts:4493-4516`, `:4621-4622`) | OK |
| `retrying()` (`ranged.ts:1511-1522`) | OK |
| `silentRestart()`: saved <= 1 MiB and fewer than 2 restarts in 10 min (`ranged.ts:363-368`) | OK |
| `completionCheck()`: block 0, 1/3, 2/3, last block, only without a strong ETag or digest (`ranged.ts:1974-1992`) | OK |
| FAT limit refused before writing (`ranged.ts:1037-1039`); part delete 8 tries x 500 ms (`parts.ts:252-262`); `JOIN_STEP` 8 MiB | OK |
| Volume info timeout 10 s, cache 60 s; sparse flag `0x40` | OK |
| Bench server port 47995; bench table numbers vs `IDM-BENCH.md` | OK |
| The prototype citations `VitreRanged.sys.mjs:108-113, 180-189, 202-207, 282-294` | OK (same text in both spike copies) |

## 11-integrity-resume-retry.md (22 claims, 1 wrong)

| Claim | Verdict |
|---|---|
| `judge()` order (`proof.ts:208-228`): not-file, tiny (< 64 KiB where > 1 MiB), other total, total < saved, digest, 200 to If-Range, validators differ | OK |
| `textual()` and `pageLike()` type lists (`net.ts:972-984`); `textStart()` BOM + 64 spaces (`net.ts:987-991`) | OK |
| `windows()` algorithm and the "cut, not drop" rule (`proof.ts:251-309`); `enough()` (`proof.ts:358-365`) | OK |
| `recordWindows()` fallback to local windows | OK |
| `ledger.ts`: `AT_ONCE = 2`, `HOLD_ABOVE` 256 MiB/s over `RATE_WINDOW` 200 ms, block hash of chunk hashes | OK |
| Seal triggers 30 s / 256 MiB / `SEAL_MIN_GAP` 5 s; `seal()` at `VitreDownloads.sys.ts:1770`; final seal does not flush | OK |
| `flushPart()` 15 s timeout (`ledger.ts:851`) | OK |
| Quit: wait at most 5 s for runs and 4 s for seals; `clean = true` last (`VitreDownloads.sys.ts:5290-5297`) | OK |
| Crash rules: `UNFLUSHED_MARGIN` 2 min, `MTIME_SLACK` 5 s, `SPOT_BELOW` 2, `SPOT_SEEDED` 2, `SUSPECT_TAIL` 8 MiB | OK |
| `CONTINUE_AFTER` 10 s, `WAIT_GRACE` 5 s, `SLEEP_FALLBACK` 1 min, `WAKE_SETTLE` 10 s, `SOON` 5 s, `RENEW_ON_LINK` 10 min | OK |
| `expiresAt()` rules: S3/Google V4 (1-9 digit seconds), Azure `se` only with `sig`, Akamai `exp=`, plain 9-13 digits, plausibility window 1 year back / 10 years ahead | OK |
| `addresses()`: url, rec url, chain; no duplicates, http(s) only, never the failing one, never an expired one | OK |
| `originalAddress()`: first `same`/`changed`/`unknown` decides | OK |
| `adopt()` in `renew.ts`: "`url` changes only for addresses that came from the person (pasted, a re-click), not for `'original'` or `'ytdlp'`" | **Fixed.** The code changes `url` for every kind except `'original'` and `'ytdlp'` (`renew.ts:126`), so also for the page step's `'background'`. Study now says so. |
| Gate: `GAP` 10 s, `PER_RUN` 3, `FORGET_FAILURE` 30 s, `HISTORY` 5, `CHAIN` 8 | OK |
| `SCHEDULE` and `nextTry()` returning 0 after the 6 h attempt | OK |
| Opaque stems list (`download, file, index, get, dl, attachment, media, video, audio`, 16+ hex) (`attach.ts:61-66`) | OK |
| `partialName()` "song (partial).mp3" | OK |
| Stale comments noted by the study (`VitreDownloads.sys.ts:111-118`, and the `waitAgain()` doc) still show the old 10 s ... 10 min schedule | OK (the study is right that they are stale) |

## 12-download-manager.md (22 claims, 2 wrong)

| Claim | Verdict |
|---|---|
| `ACTIVE`, `FINISHED` lists (`VitreDownloads.sys.ts:280-281`); `TAKEOVER_PREFS` (`:285-294`) | OK |
| `queueStamp()` strictly increasing (`:596-600`); `pump()` pseudo-code (`:1455-1476`) | OK |
| `start()`: http(s) only; mode by `.m3u8`/`.mpd`; DRM rule with `MEDIA_URL` (`:1069-1074`) | OK |
| `newRec()`: folder, filename fallback, `askWhere` (`:1026-1063`) | OK |
| Take-over identity: `crossSite`, `firstParty = !crossSite`, `pageRules = crossSite`; `sameSite()` by `getSite()` | OK |
| `makeChannel()` principal branches; never falls back to the system principal (`net.ts:285-312`) | OK |
| `pastedIdentity()`: no Referer, no Origin, first-party | OK |
| `nameFromDisposition()`, `sanitize()` (180 / 175 rule), `isOpaque()` list, `chooseName()`, `uniquePath()` (0..9999 then a timestamp), `streamTitle()` | OK |
| `withExtension()` uses "a 36-entry MIME table" | **Fixed.** `MIME_EXT` has 35 entries (zip and rar each appear under two MIME types). |
| The redirect-to-`/files/report.pdf` example is named `download.pdf` | OK (by reading `runFile` `:1530-1533` and `chooseName()`) |
| `continueDownloadsOnStart` default true; `confirmQuit()` 10 s; prompt layer 55; `promptCopy()` | OK |
| Shutdown order and limits | OK |
| `MAX_ACTIVE` reasoning and test `ui.js:42` | OK |
| `repick()` rules and `BANDWIDTH_SLACK` 10 %, `TIME_SLACK` 0.05 s, `DURATION_SLACK` 1 s (`table.ts:52-56`) | OK |
| 8 citations written as `src/...` (for example `` `src/shared/settings.ts:69-75` ``, `` `src/window/modules/downloads/system.ts:157-221` ``) | **Fixed.** Paths must be relative to the repository root, and `src/shared/settings.ts` names two files (`app/` and `gecko/`). All 8 now start with `gecko/`. |

## 20-video-detection.md (22 claims, 1 wrong)

| Claim | Verdict |
|---|---|
| `seen()` pseudo-code: policy types, 2xx GET only, HLS/DASH by MIME or URL, xhr never a whole file, `video/mp2t` excluded, octet-stream + extension, size from Content-Range first, 200 items per document (`media.ts:204-255`) | OK |
| `SEGMENT_EXT`, `HINTS` regexes (`media.ts:29-30`); size cache 400 | OK |
| `MIN_VIDEO` 200 x 112, `MIN_FRAME` 320 x 180; `shown()` opacity > 0.05 | OK |
| Main video score `visible area x (paused ? 1 : 2) + 1` | OK |
| Notifications debounced 300 ms (`media.ts:336`) | OK |
| `rankStreams()` scoring and recency tie-break (`media.ts:91-97`) | OK |
| `offer()` reads at most 4 playlists and prefers a master (`media.ts:400-414`) | OK |
| `describe()` 60 s cache, 12 s timeout, 8 MiB text, `#EXTM3U` check | OK |
| `isMpd()` first 4096 characters | OK |
| `probeSize()` one byte, 8 s | OK |
| `ladder()` key and sort; `audioOnly` rule; default audio rendition | OK |
| Suggested row and `screenFit()` formula | OK |
| Offer cache 60 s and its key (includes the media count) | OK |
| Frame ownership rule (`media.ts:362-364`) | OK |
| DASH live = `type="dynamic"`; DRM = any `ContentProtection` | OK |
| "DASH alone doesn't count" cited as `VitreMedia.sys.mjs:176-181, 205` | **Fixed.** The bare name matches two spike copies; line 205 exists only in `verify/engine/`. Now a full path, plus the other copy's line. |

## 21-hls-dash-engine.md (22 claims, 1 wrong)

| Claim | Verdict |
|---|---|
| Worker loop, `take()`, spill rule, `avgMs = 0.8 x old + 0.2 x new` (`hls.ts:1173-1243`) | OK |
| Writer loop; backlog wait 20 ms over 32 MiB | OK |
| Hedge condition and "a hedge never steps aside" | OK |
| `SEGMENT_MAX` 256 MiB, `PIECE` 4 MiB, `PROVEN_FOR` 60 s, `CUT_TRIES` 4, `SPOT_LAST` 2, `SLIPS` 2 in 10 min | OK |
| Key fetched once per URL, must be 16 bytes, 3 attempts | OK |
| IV = 8 zero bytes + 64-bit big-endian sequence number (`hls.ts:1853-1857`) | OK |
| AES-CBC failure sentence | OK |
| `looksLikeMedia()` and `sniff()` byte rules | OK |
| DRM / live / multi-period refusals (`hls.ts:441-443`, `:711`, `:791-793`) | OK |
| At most 3 refreshes per segment (`hls.ts:1428`) | OK |
| DASH 100,000-segment cap | OK |
| `finish()` ffmpeg arguments, the `-map` rules, `+faststart` only for MP4, the fallback notes (`hls.ts:1011-1056`); `runFfmpeg()` adds `-nostdin -progress pipe:2 -nostats` | OK |
| `lengthCheck()` | OK |
| "ffmpeg is found in: the Settings path, beside the program, Deer's download folder, the old Vitre folder, PATH" | **Fixed.** "Deer's download folder" was wrong: it is the copy Deer installs on request, `%LOCALAPPDATA%\Deer\ffmpeg\ffmpeg.exe` (`ffmpeg.ts:6-14`). Order and paths now spelled out. |

## 22-ytdlp-ffmpeg.md (20 claims, 1 wrong)

| Claim | Verdict |
|---|---|
| Base arguments `--no-config --no-playlist --no-colors --encoding utf-8 [--js-runtimes deno:<path>]` (`ytdlp.ts:115-119`) | OK |
| Environment `PYTHONIOENCODING`, `PYTHONUTF8`, appended | OK |
| `-J` timeout 60 s; `lastError()` rule | OK |
| `probe()` flow: DRM by `/drm/i`, live states, `usable()`, reasons | OK |
| Format selection pseudo-code (H.264 MP4 first, original-language audio, MKV fallback, fps > 30, 4K/2K, combined formats only without joins, WEBA label) | OK |
| Container regexes (`ytdlp.ts:649-652`) | OK |
| Download arguments and `-N` clamp to 8; `--merge-output-format` only with `+` | OK |
| Progress parsing pseudo-code and the merge phase regex | OK |
| "yt-dlp finished but the file is not there." | OK |
| `estimate = max(expected, total, received)` | OK |
| `BACKGROUND_RUNS` 2, `HEARD_FRESH` 60 s, `HEARD_KEEP` 10 min, page key without fragment | OK |
| `toolsDir()` and `vitre.localAppData` | OK |
| ffmpeg release regex and URL | OK |
| "Update calls `installTools(force = true)` (`settings-page.ts:112-117`)" | **Fixed (imprecise).** The button calls `engine.installYtdlp(ytInstalled)`; that is `installTools(update)` (`VitreDownloads.sys.ts:3206-3208`), so `force` is true only when yt-dlp is already installed. The settings sentence "Sites change often: update yt-dlp when a site stops working." is quoted correctly. |

## 30-ux-tests-history.md (22 claims, 7 wrong)

| Claim | Verdict |
|---|---|
| UX file table line counts | OK |
| Store keeps rows of its own privacy (`store.ts:49-51`) | OK |
| Prompt layer 55, `proceed()` | OK |
| `eta()` "60 min" / "1 h 60 min" bug | OK (redone by hand) |
| Panel speed menu lacks 20 MB/s (`panel.ts:42`) | OK |
| 20 commits in the timeline: hash, date and subject | OK (all 20 match `git log`) |
| Checklist rows B2, B3, B6, B11, B14, B16 (`connections.js`) | OK |
| Checklist rows A9-A15 (`v-pages.js`) | OK |
| A5: "Six downloads started at once: 2 run, the other 4 queue in order 1..5" | **Fixed.** The test starts the six while one slow download already runs; only one of the six runs, and five queue in order 1..5 (`v-rapid.js:89-96`). |
| `settledStats()` cited as `lib.js:68-79` | **Fixed.** It is `lib.js:49-61`; it waits at most 3 s, polling every 50 ms. |
| Per-run stand-in yt-dlp log cited as `all.py:240-241` | **Fixed.** It is `all.py:256-257` (`VITRE_FAKE_YTDLP_LOG`). |
| `CONNECTIONS` cited as `pages.ts:506` | **Fixed.** `pages.ts:507`. |
| `SPEEDS` cited as `pages.ts:507` (twice) | **Fixed.** `pages.ts:508` (both places). |
| "A value not in the menu is still listed" cited as `pages.ts:536, 556` | **Fixed.** `pages.ts:537, 555`. |

---

## Completeness pass

Every file below was searched for in the 8 section files (by full path, by its last two or three path parts,
and by its bare name when the name is unique).

| Scope | Files | Referenced before | Added now |
|---|---|---|---|
| `gecko/src/modules/downloads/*` | 31 | 31 | 0 |
| `gecko/src/modules/VitreDownloads.sys.ts` | 1 | 1 | 0 |
| `gecko/src/actors/page/downloads.ts` | 1 | 1 | 0 |
| `gecko/src/window/modules/downloads/*` | 13 | 12 | **`icons.ts`**: read in full; new subsection "The icon set (`icons.ts`)" under Mechanism 4 of `30-ux-tests-history.md`, and a row in its Files table |
| `gecko/src/workers/flush.js` | 1 | 1 | 0 |
| `gecko/spikes/downloader` top-level docs (`IDM-BENCH.md`, `IDM-WAY-DESIGN.md`, `RESULT.md`, `RESUME-DESIGN.md`) | 4 | 4 | 0 |
| `gecko/tests/downloads/*` | 34 | 34 | 0 |
| `gecko/tests/downloads-verify/*` | 12 | 12 | 0 |

Outside the strict scope, the spike's top-level runner scripts (`go.py`, `overlay.js` and the nine `boot-*.js`)
were not referenced anywhere. Their header comments were read and one row describing them was added to the
"Design and history" table of `30-ux-tests-history.md`. They are history only.

`principals.ts` is referenced only by its bare name (`12-download-manager.md` §7, `principals.ts:59-78`); the
citation is correct and the name is unique in the repository.

---

## Still uncertain, or not checked

- **Nothing was run.** Every "OK" means the study matches the code as written. Claims marked "by reading" in the
  study (for example the earliest stall cut at about 16 s, or lane numbers shared between two downloads of the
  same host) were checked against the code but not observed.
- **Spike copies.** `VitreRanged.sys.mjs`, `VitreHls.sys.mjs`, `VitreTakeover.sys.mjs` and `VitreMedia.sys.mjs`
  exist twice (`gecko/spikes/downloader/engine/` and `.../verify/engine/`). The bare-name citations in sections
  10, 12 and 21 were checked in both copies: the cited lines match in both, except `VitreTakeover.sys.mjs:80-86`,
  where `firstParty: true` is at line 81 in `engine/` and line 85 in `verify/engine/` (both inside the range).
  Only the `VitreMedia` citation was out of range, and it is fixed.
- **Stale comments in the code.** The engine's header (`VitreDownloads.sys.ts:111-118`), the `waitAgain()` doc
  comment (`VitreDownloads.sys.ts:2616-2626`) and `gecko/ARCHITECTURE.md:612-617` still describe the old wait schedule (10 s ... every 10 min, give up
  after 24 h). The code (`waits.ts:24-29`) is 30 s, never give up. The study already says this; an iOS port
  must follow `waits.ts`.
- **Why HTTP/3 is off for lanes** is not written anywhere in the code or the spike docs; the study says so, and
  that is correct.
- **Bench numbers** in section 10 were checked against `IDM-BENCH.md`. The raw log
  `idm-bench/results-2026-10-20.jsonl` was not re-analysed line by line.
- **Not checked by this checker:** `00-README.md` and `40-ios-port-guide.md` (owned by another checker), and every
  statement about TitleLess or iOS (they come from TitleLess's audit summary or are marked "(unverified)").
- About 1,800 citations that the script did not flag were range-checked only. Their content was not read one by
  one. Among the citations read by hand, 15 had a problem (8 of them the same `src/` path form), so a few more
  small line slips may remain.
