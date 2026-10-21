# Downloads the IDM way: retries and the hybrid file layout (design, 2026-10-21)

Status: retries BUILT (2026-10-21, while the owner was away; they asked for the fix to be committed when done),
the hybrid layout next. Built as this design with these differences, each because the owner chose "Exactly like IDM"
over the softer paced option: no per-site token buckets or per-connection 250 ms floor (only a main-thread cap of
150 asks a second after failures across Deer: Necko itself sends a reset request again up to 10 times, so that is
about IDM's 1,270 a second at the server, measured; a spike showed no main-thread lag to speak of up to 800 asks a second); the first re-ask of a refused start is after 4 s, as the 2026-10-20 and 2026-10-21 logs show
(the "+0.02 s" was the first ask, and the 0.23 s burst a nudge); no hold with scouts: every connection keeps asking
as IDM's do, the row reads Waiting for network or Retrying after 10 s with nothing coming in, and the first answer
after such a stretch is preceded by a proof of one saved window (rejoin()); while Windows says offline a connection
asks once every 30 s (IDM was not measured offline). Not built yet: per-site connection limits and their setting,
the Link expired 30 s re-ask, the confirming probe for a new total, streams (hls.ts) and yt-dlp, the queue-slot rule,
the window wording; the start's probe still has its 3 tries, then the 30 s waits. Owner questions taken as
recommended: 1 (Deer's cuts kept), 2 (no 24 h give-up), 3 (Retry-After, up to 24 h), 8 (unfixable failures stay
Failed), 12 (challenges stop). Question 4's floors: replaced by the measured cap, as above. It carries out the owner's two decisions of 2026-10-21, made after measurements on their own IDM 6.43:
1. File layout, hybrid. Keep the single sparse .part written in place where the volume has sparse files (NTFS). Where it has none (exFAT, FAT32, some network shares), use IDM's layout: one file per part, added to the real file after the last byte.
2. Retrying exactly like IDM, while keeping every resume safety rule of RESUME-DESIGN.md (proofs, File changed, Link expired, never mixing bytes). The owner chose IDM's retry policy, not IDM's weaker checking.

A design run made this: two designs (one per decision), two critiques, and this merge. Every blocker and major point of the critiques is applied here. Section 8 says how, one line each, and lists the minor points as notes. RESUME-DESIGN.md stays in force; where this design replaces one of its rules, the text says so. Paths are relative to C:\Users\Droid\Desktop\Windows Browser Project\gecko. The window side (src/window/**) waits until the split-view session has committed its edits there. The engine side ships first, with today's labels.

Facts checked while merging (beyond the two designs):
- isRetryable() (src/modules/downloads/net.ts:872-882) is true for every NetError that is not a certificate error or NS_ERROR_MALFORMED_URI, and for any exception that is not a TypeError. So a class of "every other retryable failure" would have taken in a blocked port, a redirect loop and a duplicate Content-Length. The set of failures that mean "can't reach the site" is classify()'s UNREACHABLE (net.ts:919-923).
- The bench log (spikes/downloader/idm-bench/results-2026-10-20.jsonl, IDM limit503):
  - The two refused spots were first asked at 0.02 s and next at 3.86 s, then 8, 12, 16, 20, 24 and 28 s apart.
  - Bursts of 7 to 9 refusals within 10 ms came only right after an answer that carried data ended (0.24, 64.07, 112.03, 120.03, 124.03, 126.03 s ...). They never came right after a refusal, and the scheduled spots kept their own times straight through those bursts.
- ranged.ts:1205-1211: today a cut is asked again quickly (PROGRESS_RETRY_MS, 100 ms) only after its answer brought PROGRESS_MIN (1 MiB) or ran PROGRESS_MS (5 s).
- VitreDownloads.sys.ts:4404-4456: tick() seals a running transfer every SEAL_EVERY, saves the store, and adds to activeMs for as long as the run is in this.runs.
- FINISHED includes 'failed' (VitreDownloads.sys.ts:280). clearFinished() (3037) removes such rows with their journals.
- runFile (VitreDownloads.sys.ts:1504-1513) always runs Checking for a row with saved bytes: inspect(), then check(), which is a network request.
- workers/flush.js:32 reads errors through a declared GetLastError, which js-ctypes does not keep reliable. partfile.ts:137 correctly uses ctypes.winLastError.
- yt-dlp retries a fragment on any HTTP error, 403 included, up to --fragment-retries. Its whole-file HTTP retries cover 5xx and connection errors, not 403 or 429. This is from yt-dlp's source as remembered, and ytdlp-real.js confirms it before shipping.

1. WHAT CHANGES FOR A PERSON

Connections and retries:
- One connection in trouble no longer slows or stops the others. Deer never gives up by itself on network trouble or a site error.
  - A dropped connection is asked again at once.
  - A part the site fails on (500, 502, 520 and the like) is asked again after 4 s, then after 8, 12, 16 s and so on, while the other connections go on.
  - Some sites allow only a few connections and turn the rest away (503 or 429). Those connections now keep asking, on the same growing gaps, plus once each time one of the download's answers finishes. They get in when the site has room again, for example when another download from it ends. Under a fixed limit this is not faster: on the bench IDM finished in 128.6 s after 71 refusals, and Deer in 128.3 s after 6.
- When nothing gets through for 10 s, the download waits without stopping.
  - The row shows what it shows today: "Waiting for network", or "Retrying · in 12 s", with Try now and Pause.
  - Underneath, the download keeps its place. When the site answers again, Deer compares one 64 KiB piece with what is saved and goes on, usually within a second and a half.
  - "Checking the saved part and the link" no longer repeats on every retry. It happens when you resume, or when Deer starts.
  - If your connection drops without any error (a dead route), the wait can take up to 30 s to show. Until then the row shows 0 B/s.
- Deer asks far less often than IDM:
  - at most about 20 times a second for one site and 40 for all of Deer;
  - once a second while a site can't be reached, then less often after 2 minutes;
  - once every 30 s while Windows or Firefox says there is no network.
  - IDM sent about 1,270 requests a second during an outage. Each request is work on the browser's main thread, and hammering a site is what gets an IP blocked.
- What is not copied from IDM:
  - its request rates;
  - its endless loop when a file's size changed (Deer says File changed);
  - its weak check after an outage (64 bytes, no If-Range). Deer keeps its proofs, and it asks you before throwing saved bytes away.
- A site that shows a "checking your browser" page (Cloudflare) or blocks Deer is not asked again and again. The row says the site wants to check the browser first, and offers Open page.
- New setting: Settings › Downloads › Connections per site. For example, "example.com · 2 connections" keeps Deer under that site's limit across all downloads from it. A row whose site keeps turning connections away offers "Use 2 for this site".
- Link expired stays as it is. On top of that, Deer quietly tries the same link every 30 s, and if it works again the download goes on by itself.

Drives:
- On an ordinary Windows disk (NTFS) nothing changes.
- The new layout applies to a USB stick, SD card or external disk formatted exFAT or FAT32, and to a network folder without sparse files.
  - The download is kept as name.part plus a folder name.parts, with one file for each extra part of the download.
  - Each connection only adds to the end of its own file, so there is no wait while the drive fills zeros, however big the file. Today such a drive can stall for minutes.
- After the last byte, the row shows "Saving" while Deer adds the parts to the end of name.part, in order, and deletes each part once it is safely in.
  - On an SSD this takes about a second per GB; IDM took 0.8 s for 1 GiB.
  - On a slow USB stick it takes about as long as copying the file.
  - A download made with one connection has nothing to join.
- Pausing, quitting, a crash or a power cut loses nothing, also during Saving.
- Saving finishes even if the link has expired or the network is down by then.
- A file over 4 GB going to a FAT32 drive is refused before anything is written, with a sentence that says why.
- An unplugged drive no longer means starting over. The row keeps everything and says the drive isn't connected, and Resume continues once the drive is back.
- Before the first byte, Deer checks that the drive has room for the file plus its largest part. With 8 connections that is about an eighth of the file extra.

2. THE MEASURED IDM BEHAVIOUR

IDM 6.43 build 12, the owner's copy. Sources:
- "owner": the owner's measurements of 2026-10-21 on a local server;
- "bench": spikes/downloader/IDM-BENCH.md and results-2026-10-20.jsonl;
- "docs": IDM's documentation (not measured).

| Situation | What IDM did | Source |
|---|---|---|
| File layout | 9 part files for 8 connections in %APPDATA%\IDM\DwnlData\<user>\<host>_<n>\, plus a log. The real file appears only at the join. 1 GiB joined in 0.8 s on an SSD | owner |
| Join cost | About 0.55 s per GB after the last byte (3 GiB: 5.25 s in all, where Deer took 2.62 s writing in place) | bench |
| Connections | A new TCP connection for every request. The first request is a plain GET without Range, then the largest part is split, 8 connections by about 1.2-2 s | bench |
| Refused start (503, the site allows 2 connections) | Retried at +0.02 s, then at gaps growing by 4 s (3.9, 8, 12, 16, 20, 24, 28 s ...), without limit. Also re-sent at once whenever one of its own answers ends; most refusals came from that. In two longer runs it went into re-asks about 10 ms apart from about 64 s on: 6,470 and 57,803 requests in 128 s. On the bench, 71 refusals in 128.6 s | owner, bench |
| 500 on one part | That spot retried at +4, +8, +12 s while the others go on | owner, bench |
| Connection reset | Retried at once (0.01 s) | owner, bench |
| Full outage (every connection reset for 12 s) | About 1,270 requests a second across its 8 connections, no backoff, then it resumed normally | owner |
| Silent connection | Cut at 30 s, retried at once | owner, bench |
| Crawling connection | Never replaced; the others split its remainder | owner, bench |
| 403 for 20 s mid-download | Completed in 32.8 s (Deer 32.1 s) | bench |
| A failed download in the queue | Retried every 30 s, without limit | docs |
| Resume after an outage | No If-Range or other If-* header, and no HEAD. It compares the 64 overlapping bytes with what it had. On a mismatch it starts again from zero (with a dialog), then falls back to one connection | owner |
| The file's size changed | About 1,700 requests a second, forever; it never finished (a bug) | owner |

Not measured on IDM: Retry-After, a real network loss (no route, Wi-Fi gone, DNS failing), Cloudflare challenge pages, and 403/404 on one connection while the others receive.

To check: the +0.02 s re-ask. In the 2026-10-20 log, the two refused spots were first asked at 0.02 s, and their next ask came 3.84 s later, with no ask in between. The design follows the owner's 2026-10-21 figure (REFUSED_FIRST_MS = 20 ms, 3.2). Before building, the 10-21 log is read again. If it agrees with 10-20, REFUSED_FIRST_MS goes, and the first re-ask comes after 4 s. It is one constant, and the tests are written as gaps.

3. RETRY POLICY

3.1 Event classes (new src/modules/downloads/retry.ts)

Words used below:
- An answer made progress when it brought at least PROGRESS_MIN (1 MiB), or brought bytes for at least PROGRESS_MS (5 s). This is today's gate, kept.
- k: each connection counts failures per class, 1 for the first. All of a connection's counts go back to 0 only after one of its own answers made progress. They are kept across holds (3.4).
- Streak: the failures since a connection's last answer with progress.
  - The first re-ask of a streak goes at AT_ONCE_MS (a refused start at REFUSED_FIRST_MS).
  - Every later ask on that connection starts no sooner than FLOOR_MS after its previous ask started.
- Tokens: every ask that follows a failure takes one token from its site's bucket and one from Deer's (3.6), and waits for the site's notBefore. So do nudged asks and scouts. A connection's next segment after an answer with progress takes none.

| Class | What it is | Wait before the next ask | What the connection does |
|---|---|---|---|
| cut | A NetError in CUT_CODES (NET_RESET, NET_INTERRUPT, NET_PARTIAL_TRANSFER, NET_TIMEOUT, NET_TIMEOUT_EXTERNAL), or ShortBodyError | After progress: 10 ms, and no failure is counted. Otherwise it is a failure: 10 ms if it is the first of the streak, else the floor | Same segment. A tick() cut moves to a new partition, as today |
| network | A NetError in UNREACHABLE that is not a cut: UNKNOWN_HOST, OFFLINE, CONNECTION_REFUSED, UNKNOWN_PROXY_HOST, PROXY_CONNECTION_REFUSED | As a cut without progress | Same segment |
| refused-start | 429, or 503, without challenge marks | 20 ms when k = 1, then 4 s × (k − 1). Never before its Retry-After or the site's notBefore | Standby: it gives up its segment claim and claims again when its turn comes. It keeps its partition |
| server | 408, 425, and every 5xx except 501, 503 and 505 (500, 502, 504, 507, 509, Cloudflare's 520-527 and 530 ...). Also a new total that the confirming probe did not repeat (3.8) | 4 s × k, never before Retry-After or the site's notBefore | Same spot: the segment stays claimed, and others may split it as today. The retry goes on a new partition (laneGen + 1), as IDM uses a new connection |
| refused-address (R1) | 401, 403, 404, 410, 451, an expired-type 400, or a page or JSON where the file was (NotTheFileError), without challenge marks | First afterRefusal() (3.8), then 4 s × k | Standby, with its segment released. Once the address's expiry time has passed, it retires for the run instead |
| challenge | cf-mitigated: challenge on any answer; or Server: cloudflare with an HTML body on a 403, 429 or 503 whose first 4 KiB (Response.head) carry Cloudflare's challenge page or "error code: 10xx" | Not asked again in the run | The run ends (3.8) |
| other | Any other error isRetryable() accepts: other Necko failures (a blocked port, a redirect loop, NS_ERROR_CORRUPTED_CONTENT, a block by policy, Safe Browsing or an add-on), and exceptions Deer does not recognise | As today: ATTEMPTS (3), backoff 2 s and 6 s | Then the connection leaves the run (today's leave()). The last connection ends the run with today's sentence. Never a hold |
| not retried | DiskError, RangeIgnoredError, ChangedError, NotTheFileError after the renewal, TLS and certificate errors (NSS), NS_ERROR_MALFORMED_URI, TypeError, a 416 with the same total, any other status | None | The run ends as today |

A RangeMismatchError whose start or end differs from what was asked gets 3 tries. Then the connection leaves the run, and the last one ends the run as today. Only a different total goes through the confirming probe (3.8).

3.2 Constants (retry.ts unless named)

| Constant | Value | Where it comes from |
|---|---|---|
| AT_ONCE_MS | 10 ms | IDM: a reset retried at 0.01 s. Used for the first re-ask of a streak and for a cut after progress (was PROGRESS_RETRY_MS, 100 ms) |
| REFUSED_FIRST_MS | 20 ms | IDM: a refused start retried at +0.02 s (owner). To check against the 10-20 log (section 2) |
| STEP_MS | 4000 ms | IDM: gaps growing by 4 s |
| FLOOR_MS | 250 ms | Deer: the shortest time between the starts of two asks on one connection within a streak (IDM: about 6 ms). At most 4 asks a second per connection |
| PROGRESS_MIN / PROGRESS_MS | 1 MiB / 5 s | Today's gate (ranged.ts:149-150), kept |
| SITE_RATE / SITE_BURST | 20 per s / 20 | Deer: one bucket per site, shared by every download and connection |
| GLOBAL_RATE / GLOBAL_BURST | 40 per s / 40 | Deer: one bucket for all of Deer |
| HOLD_AFTER_MS | 10 s | Deer: no byte for this long and every connection failing starts a hold |
| SCOUT_MS | 1 s | Deer: the gap between scouts in a 'site' hold, for its first SCOUT_FAST_FOR (IDM: no backoff) |
| SCOUT_FAST_FOR | 2 min | Deer: after this, a 'site' hold's scouts follow gaps growing by 4 s |
| SCOUT_DOWN_MS | 30 s | Deer: the only scout while Services.io.offline is set or the link is known down |
| SLOT_RELEASE_MS | 30 s | IDM's queue rhythm: when a held run may give up its queue slot (3.4) |
| QUEUE_RETRY_MS | 30 s | IDM's queue: waits outside a run, and the Link expired re-ask (3.10) |
| RETRY_AFTER_MAX | 24 h | Deer: the longest Retry-After honoured |
| OTHER_ATTEMPTS | 3 (2 s, 6 s) | Today's ATTEMPTS and backoff(), for 'other' and for start/end mismatches |
| SITE_HINT_MS | 60 s | Deer: how long connections must be turned away before the row offers a per-site limit |
| SOCKETS_KEPT | 256 | Deer: FileTransfer.sockets keeps only the newest entries (a run can now last days) |

Two numbers follow from these:
- In any T seconds, one site sees at most 20 + 20·T asks that follow failures: 40 in 1 s, 220 in 10 s.
- All of Deer sends at most 40 + 40·T.

3.3 Event by event

| Event | IDM 6.43 (measured) | Deer today | Deer new | What the row shows |
|---|---|---|---|---|
| Refused start (429/503; the site limits connections) | +0.02 s, then gaps growing by 4 s without limit; re-sent at once when one of its answers ends; ~10 ms re-asks after ~64 s in longer runs. 71 refusals on the bench | It leaves the run for good while another connection fetches (6 refusals on the bench). The last connection waits 2 s and 6 s, then the run stops into Retrying (G4) | Standby, and it never leaves: 20 ms, then 4, 8, 12, 16 s ... without limit. One extra ask each time an answer of this download that brought bytes ends (3.5). Never before Retry-After or the site's notBefore. No 10 ms phase | Today's caption. With the window change: "2 of 8 active · 6 retrying". After 60 s, the details offer the per-site limit (3.6). If every connection is refused for 10 s: a 'server' hold, "Retrying · in N s" |
| 5xx on one part | That spot is retried at +4, +8, +12 s while the others go on | 2 s and 6 s, then a step aside of 10/20/40/60 s, or the run stops if it was the last connection | The same spot on a new partition after 4·k s (4, 8, 12, 16 ...), with no limit and no step aside. The others may split its segment (claim(), as IDM splits the largest part) | Nothing today; "7 of 8 active · 1 retrying" with the window change |
| 403/404/410 on one connection while others receive | Not measured alone; the 'expire' run (403 for 20 s) completed in 32.8 s | One 403 retry after 2 s, a renewal (at most 1 per 10 s, 3 per run), then that connection retires for the run | The one 403 retry after 2 s stays. There is no renewal when another connection's ask to the same address was accepted within 10 s. Then standby after 4·k s without limit, and it rejoins when the address serves again. Once the address's expiry time has passed, it retires as today | As above |
| The same refusal on every connection | Not measured; the queue retries every 30 s | The last connection reports it: Link expired | When every connection's latest failure is R1, each within the last 10 s, and the renewal found nothing, the run ends as Link expired exactly as today (2 min, 15 min, 1 h, 6 h, the page step, Refresh address). New: the same address is also asked quietly, once per site per 30 s (3.10) | Unchanged: "The link stopped working (403) · 62% is saved · next try 14:05" |
| Reset after progress | Retried at once (0.01 s) | 100 ms, no failure | 10 ms, no failure | Nothing |
| Reset before progress (before any byte, or after a few bytes) | At once, no backoff | 2 s and 6 s, then a step aside, or the run stops | The first re-ask goes at once (10 ms). Later asks on that connection are at least 250 ms apart, within the site's and Deer's tokens | Nothing unless it lasts, then the hold |
| Silent connection | Cut at 30 s, retried at once | tick() cuts after 10 s of silence while others run at 64 KB/s or more; otherwise the 30 s idle timer cuts. Retried on a new partition | Cuts unchanged (question 1). The retry follows the two rows above | Nothing |
| Crawling connection | Never replaced; the others split its remainder | Cut after 16 s below a quarter of the median, at most once a minute per connection | Unchanged (question 1) | Nothing |
| Full outage: a local RST on every connection (12 s) | About 1,270 requests a second across 8 connections, no backoff, then resumed normally | 3 attempts per connection, then the run stops into Waiting for network (10 s, 30 s, 1 min ...). Every try goes through Checking | 0-10 s: as "reset before progress", so at most 40 asks in the first second and 20 a second after that. At 10 s: a hold ('site' while the link is up), one seal, then one scout a second. The scout that passes ends the hold, and every cut connection asks at once. Expected: receiving within 1.5 s of the outage ending, with no Checking | 0-10 s: downloading at falling speed. Then "Waiting for network" (with the window change, "Can't reach example.com"), with Try now and Pause, then downloading again |
| Real network loss (Wi-Fi gone, cable out, Windows offline) | Not measured | As the full outage | New connections fail at once (CONNECTION_REFUSED, or the code for "unreachable", to verify) or hang. While Services.io.offline is set or the link service says down, a hanging answer counts as failed, so the hold starts 10 s after the last byte, kind 'network'. There is no scout then, except one every 30 s; 'online', link 'up' or 'changed', or a wake sends one at once | "Waiting for network", as today |
| Route black-holed while the link is up | Not measured | The 30 s idle timer, then the network wait | Answers hang until the 30 s idle timer cuts them; no earlier hold, so a slow server is never cut early. Then the 'site' hold | 0 B/s for up to 30 s, then "Waiting for network" |
| DNS failure (UNKNOWN_HOST) | Not measured | Network wait | Network class, then a hold: 'network' when another site fails too, otherwise 'site'. Every Deer channel has LOAD_BYPASS_CACHE, believed to refresh DNS on each ask (to verify in the spike) | "Waiting for network" |
| Other Necko failures (blocked port, redirect loop, duplicate Content-Length, a policy block) | Not measured | 3 attempts (2 s, 6 s), then "The connection was lost." | Unchanged: 3 attempts, then the connection leaves; the last one ends the run with today's sentence. Never a hold | Failed, as today |
| Cloudflare challenge or block (cf-mitigated: challenge; a 1020 or 1015 page) | Not measured | 403: renewal, then Link expired. 503 or 429: retried as a server error | Not asked again in the run. The page step runs (RESUME-DESIGN G1 step 3, with its budgets), then need 'page' with "The site wants to check the browser first", and Open page. No 30 s re-ask. A Retry-After on it sets the site's notBefore | Today's "Start it again from its page" row, with that sentence |
| Retry-After | Not measured | Honoured up to 60 s (IN_RUN_WAIT); above that the run stops | Honoured exactly, per connection and for the whole site, up to 24 h. It never stops the run, and nudges never come before it. If every connection is waiting on it: a 'server' hold, with nextAt the earliest | One connection: nothing. All: "Retrying · in 59 min", "The site had a problem (503). Trying again at 14:05" |
| File or size changed | After an outage no If-Range and no HEAD; it compares 64 overlapping bytes; on a mismatch it starts from zero (with a dialog), then uses one connection. Size changed: ~1,700 requests a second forever | If-Range on every ask; prove() on header-only differences. A new total mid-run is a RangeMismatchError that ends as "The connection was lost." | A new total gets one confirming probe (3.8). The same new total again is R2: the silent restart at 1 MiB or less, otherwise File changed. The old total means a bad edge, retried in the server class. After every hold, the scout proves window 0 before any byte is written. Never a restart above 1 MiB without asking, never a fallback to one connection, never a loop | File changed: Start over with the new file · Keep partial file |
| A 206 that starts at another place | Not measured | 3 attempts, then a step aside, or the run ends | 3 attempts, then the connection leaves; the last one ends the run as today | As today |
| The whole download failing (queue) | Retried every 30 s without limit | G4: 10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min. Fails after 24 h of 5xx. Each try is a new run with Checking | Network and site trouble no longer end a run (the hold). Waits outside a run (after a quit, a crash or sleep, or a fallback) retry every 30 s, never before Retry-After, with no 24 h limit (question 2) | Today's labels |
| Not retried | Not applicable | — | Unchanged. A disk error fails at once, and so does a TLS certificate error. A fresh start refused with nothing saved fails ("The file is no longer there (404).", with Retry) | Failed, as today |

3.4 The hold: a run that waits without ending

When it starts:
- The rule is checked on every failure, and by one timer set to lastByteAt + HOLD_AFTER_MS.
- The hold starts when no connection got a byte for 10 s, and every connection that has a segment or is in standby has failed since the download's last byte.
- An answer that is still open but has brought nothing for 10 s counts as failed only while Services.io.offline is set or the link service says down. Otherwise the 30 s idle timer decides, so a slow server is never cut early.
- The same rule covers the probe during Checking (there lastByteAt is when the check began), runSingle, and streams (3.9).

Its kind, from the connections' latest failures:
1. When every connection's latest failure is R1, each within the last 10 s, and the in-run renewal found nothing, there is no hold. The run ends as Link expired, as today.
2. Otherwise the newest failure across all connections decides:
   - server or refused-start: 'server';
   - cut or network, while Services.io.offline is set, or the link service says down, or a download from another site is failing the same way with nothing receiving anywhere in Deer: 'network';
   - cut or network otherwise: 'site'. The link is up, and only this site fails.
3. A later failure of another kind changes the kind. For example, a network failure after an R1 makes it a hold, never Link expired, so a Wi-Fi drop never starts renewal and never uses up the page-step budget.

Entering it, in this order:
1. Each connection's own controller cancels its ask; the run's controller is not used.
2. The hold awaits every connection's pull() and stream() promise. Every Writer is then closed, and every seg.received is exact.
3. rec.held = {for, since, tries: 0, status?, serverSince?} is set.
4. seal(rec, t, 'hold') runs:
   - it drains the hashing and flushes every file the coverage names;
   - it writes a seal line and sets file.dirty = false;
   - one flushed store save carries both dirty = false and rec.held.
   - The ledger's source is t.provable(), never rec.file.segments, and the ledger stays attached.
5. The connections park, run.hold is set, and the per-run diagnostics maps are trimmed.

While held:
- tick() skips the run: no ledger pump, no timer seal, no activeMs, no periodic save. The ticker stops when only held runs remain, and the hold's own timer drives the scouts.
- view() shows the row paused (3.12), while rec.state stays 'downloading'.
- runningCount() and running() leave it out, so the quit prompt never counts it.
- Each connection keeps its own k, nextAt and Retry-After.

The scout:
- One at a time, on lane 0: probe(signal, store, {once: true}).
  - It asks Range: bytes=0-65535 with If-Range, and runs judge().
  - It compares window 0 with block 0's recorded head hash, or with the .part bytes.
  - It runs prove() when only headers differ.
  - No byte of it is written.
- It takes a site token and a Deer token, and waits for the site's notBefore.
- When it goes:
  - 'network': no scout while offline or with the link known down, except one every SCOUT_DOWN_MS (30 s). 'online', link 'up' or 'changed', or a wake sends one at once.
  - 'site': SCOUT_MS (1 s) after the previous one ended, for the hold's first SCOUT_FAST_FOR (2 min); then at gaps growing by 4 s (4, 8, 12 s ...), like the server class. Link 'up' or 'changed', or a wake, sends one at once.
  - 'server': at the earliest nextAt among the parked connections. Those times come from each connection's own k and Retry-After, which the hold keeps, and never before the site's notBefore. So a site that keeps failing on one spot is asked ever less often, not every 10 s.
- Try now sends one at once. That one ask skips the site's notBefore.

What the scout's answer does:
- It passes, and the hold ends:
  1. file.dirty = true is saved, flushed, before any write.
  2. The ledger's source is set to t.provable() again.
  3. PROOF_GUARD and the renewal Gate's count start again. The connections' k do not.
  4. Connections whose latest failure was a cut or a network failure get nextAt = now, still within the tokens. Server, refused-start and R1 connections keep their own nextAt.
  5. rec.held is cleared.
- 429 or 5xx: the hold becomes or stays 'server', and tries goes up by 1.
- A cut or a network failure: the hold stays, and tries goes up by 1.
- R1: afterRefusal() runs (3.8). If it finds nothing, the run ends as Link expired.
- A challenge: the run ends (3.8).
- ChangedError: it leaves runRanged into downloadTo()'s existing handler: the silent restart at 1 MiB or less, otherwise File changed.

The queue slot:
- A run held for SLOT_RELEASE_MS (30 s) gives up its slot in pump() only when both are true:
  - its hold is 'server' or 'site';
  - another Deer download received bytes in the last 10 s.
- A 'network' hold keeps its slot.
- With a slot given up, pump() may start the next queued row of another site (registrable domain). A queued row from the same site keeps waiting.
- When a run that gave up its slot passes its scout, it continues only if fewer than MAX_ACTIVE downloads run.
  - Otherwise it stays parked, with no new Checking and no scouts, and pump() gives it the next free slot before any queued row.
  - When it gets the slot, it sends one scout again before any write.
- So at most MAX_ACTIVE downloads receive at once, and an outage never starts the queue.

Controls and stops:
- Try now: resume(id, true) gets an early branch, if (run?.hold) { transfer.poke(); return; }.
- Pause: aborts the run with reason 'pause'. The row is plainly paused, and the wait is gone.
- Cancel: as today.
- Sleep: sleep() takes held runs too, into wait 'sleep'.
- Quit: stopped() turns run.hold into rec.wait = {...held, nextAt: 0}. The row continues WAIT_GRACE (5 s) after the next start, through Checking.
- Crash: load() turns a 'downloading' record that has rec.held into the same wait. It checks rec.held before its unclean and suspect branches, as it does rec.trying. The hold sealed it, so inspect() finds a clean seal and nothing is fetched again.

3.5 The nudge (IDM's "re-sent when one of its answers ends")

- When an answer of this download that brought bytes ends (finished, a capped 206, or cut after bytes), each refused-start standby connection may ask once. This does not apply to the connection whose answer ended.
- Its next ask moves to max(now + REFUSED_FIRST_MS, lastAskStart + FLOOR_MS, its Retry-After end, the site's notBefore), if that is earlier than its own nextAt.
- A refusal, or any answer that brought no bytes, nudges nobody.
- A nudged ask leaves the connection's k and its own scheduled ask unchanged. If it is refused, the connection simply waits for its own schedule.
- answerEnded() is called once per answer, from stream()'s finally only.
- Not copied from IDM:
  - its ~10 ms re-asks after about 64 s;
  - its bursts of refusals until one is accepted.
- Expected on the limit503 bench:
  - each standby asks about 8 times on its own schedule in 128 s;
  - plus about one nudged ask per answer end;
  - in all about 100 to 150 refusals, against IDM's 71.

3.6 Per-site limits

Sites:
- A site is the registrable domain (eTLD+1) of an answer's final address. An IP address or localhost is its own site.

Tokens (SiteBudget in retry.ts):
- Each site has a bucket of SITE_RATE 20 a second with a burst of 20, and all of Deer shares one of GLOBAL_RATE 40 a second with a burst of 40.
- Asks after a failure, nudged asks and scouts take one token from each.

notBefore per site:
- It is the latest Retry-After end (at most 24 h) from any 429 or 503 of any download from that site.
- Every ask after a failure, every nudged ask, every scout and every new connection of any download from the site waits for it.
- Try now skips it for one ask.
- A connection's next segment after an answer with progress does not wait.

Connection pool per site:
- This applies when the person set a limit n for the site (3.12).
- All running Deer downloads from that site together keep at most n connections asking.
- A connection that would pass the limit waits without asking ("pooled"). It takes the next free place, first come first served, across downloads.
- TransferEnv.connections() is also min(global setting, n) for each download.

The hint:
- When one download's connections were turned away for SITE_HINT_MS (60 s), the row offers a per-site limit. Turned away means refused at the start (429/503), reset before any byte, or refused with 403 while others received.
- If M connections to that site were accepted at once across all of Deer, view.siteCap = {site, accepted: M}.
- The details then say "This site accepted 2 connections at once", with [Use 2 for this site], which writes the setting.

3.7 The connection loop (ranged.ts)

Removed from fetchSegment() and runRanged():
- ATTEMPTS and backoff() for the cut, network, server, refused-start and R1 classes;
- PROGRESS_RETRY_MS, which becomes AT_ONCE_MS;
- ConnectionRefusedError, StepAsideError, STEP_ASIDE_MS, mayYield and accepted;
- retire(), except for an R1 after the address's expiry time;
- stopsRun(), serverStops(), IN_RUN_WAIT and waitTry.

Kept:
- the progress gate (PROGRESS_MIN, PROGRESS_MS);
- MOVING_MS and othersMoving(), which now only decide whether R1 on one connection means standby, renewal or the end of the run;
- leave(), for 'other' failures and start/end mismatches after 3 tries;
- tick()'s cuts, the 30 s idle timer, CUT_CODES, lanes and the gen bumps on cuts.

```ts
for (;;) {
  if (fatal || stop.signal.aborted) return;
  await hold.parked(conn, stop.signal);                 // at once when there is no hold
  await conn.spot.due(stop.signal);                     // a setTimeout to spot.nextAt; a nudge can bring it earlier
  if (conn.spot.failing) await budget.take(site, stop.signal);   // site and Deer tokens, the site's notBefore
  await pool.enter(site, conn, stop.signal);            // only when the site has a connection limit
  const seg = conn.seg ?? this.claim(owned);            // a standby connection holds no segment
  if (!seg) { pool.leave(site, conn); rouse(); return; }
  const before = seg.received;
  conn.spot.askedAt = Date.now();
  try {
    await this.pull(seg, store, stop.signal, conn.lane); // stream()'s finally calls answerEnded() once
    conn.spot.ok(seg.received - before);
  } catch (err) {
    if (isTickCut(err)) { conn.spot.nextAt = Date.now(); continue; }     // as today: no failure
    let ev = classOf(err, { bytes: seg.received - before, ms: Date.now() - conn.spot.askedAt });
    if (ev === 'fatal' || ev === 'challenge') throw err;                 // the run ends
    if (ev === 'refused-address') ev = await this.afterRefusal(err, conn); // retry | renewed | standby | retire
    if (ev === 'retire' || ev === 'leave') return;
    conn.spot.fail(ev, retryAfterOf(err));                               // nextAt as in 3.1
    if (ev === 'refused-start' || ev === 'refused-address') { owned.delete(seg); conn.seg = null; }
    this.holdCheck();
  } finally {
    pool.leave(site, conn);
  }
}
```

- pull() gains the new-total check (3.8) before stream().
- runSingle() uses the same classes with one connection. Its hold's scout is its next ask. A single stream with no ranges that is cut with nothing saved starts again from 0, as today.
- FileTransfer.sockets keeps the newest SOCKETS_KEPT (256) entries.

3.8 Checking, the probe, proofs and renewal

Checking:
- runFile and runStream keep one inspect() per run start, unchanged.
- Runs now end only on Pause, a quit, sleep, completion, Link expired, File changed, a challenge, or a real failure. So Checking happens once per resume or per Deer start, not once per retry.
- New: a row whose segments already cover the whole file (saved === total) skips the probe. It runs inspect(), openPart(), the join if there is one (4.7), completionCheck, then verify, with no request needed. completionCheck already counts a server it can't reach as "not compared". This also fixes a fully downloaded in-place row that today reads Link expired once its link has expired.

The probe:
- probe() uses the classes, a fresh start included:
  - a network failure no longer gets 3 tries 1 s apart;
  - a 5xx gets 4·k s;
  - a 429 or 503 gets 20 ms, then 4·(k−1) s.
- The hold rule applies to it, so a long refusal shows Retrying, not Checking.
- A hold during the check shows the wait.

A new total mid-run:
- This means a 206 or a 416 whose total differs from state.total.
- One confirming probe follows on lane 0: window 0 plus the total.
- The new total again: ChangedError("was 256 MB, now 257 MB"), which is R2. That gives the silent restart at 1 MiB or less (at most twice in 10 min), otherwise File changed.
- The old total: the odd answer came from a bad edge, and it is retried in the server class.
- No byte of the odd answer is ever written, because the check comes before stream().

proof.ts:
- fetchRange() and fetchWindow() inside a run (spotCheck, prove, Repair's fromServer) use the policy without limit, so they hold with the run.
- The completion check still asks once.
- proveAddress() keeps 3 tries, 1 s apart: a candidate that can't be reached is simply not adopted.

In-run renewal (renew.ts, RESUME-DESIGN 3.0):
- The Gate keeps its per-run budget: at most 1 per 10 s and 3 per run. Its count starts again only when a hold ends.
- A 403 or 404 on one connection while another connection's ask to the same address was accepted within MOVING_MS (10 s) gets no renewal. The address works, so this is a per-connection limit: the connection goes straight to standby.
- A renewal while other connections receive does not set the phase 'renewing', so the row never says "Renewing link" while it is in fact downloading.
- Once expiredAt(asked) is true, an R1 connection retires for the run, as today, and never stands by.
- This replaces RESUME-DESIGN 3.0's "exactly one retry at the same address" with standby without limit, by the owner's decision 2. The one 403 retry after 2 s is still the first step.

A challenge:
- The run ends.
- The page step (RESUME-DESIGN G1 step 3, with its budgets and its Setting) runs when a source page exists. A real browser tab may pass a check that needs no click; Deer never clicks.
- Then the row gets need 'page' with the evidence "The site wants to check the browser first". Today's panel shows that evidence and Open page (panel.ts:656).
- There is no 30 s re-ask.

Removed: waitTry, from FileTransfer, ProofCtx, hls.ts and net.ts.

3.9 Streams and yt-dlp

HLS and DASH (hls.ts):
- fetchPiece(), text() and key() use the classes, with no attempt limit for cut, network, server and refused-start failures.
- A refused-start worker puts its segment back in line and stands by: 20 ms, then 4·(k−1) s, plus a nudge when a segment that brought bytes completes.
- A track no longer fails on a retryable error.
- The hold starts when no segment has been written for 10 s and the head segment's latest fetch failed. Workers idling ahead in wait(500) (hls.ts:1240) count as not receiving.
- The scout is the head segment's fetch. It uses refreshed() for an expired address, and the stream proof (lastHash) when the playlist changed, as today.
- Unchanged:
  - the hedge, lazyProof, and refreshed()'s 5 s limit;
  - a refused playlist with nothing written still fails after 3 asks;
  - a challenge ends the run as for files.

yt-dlp (ytdlp.ts):
- New arguments: --retries infinite --retry-sleep linear=0::4 --retry-sleep fragment:linear=0::4 --socket-timeout 30. These retries run in yt-dlp's own process, so the main thread is untouched.
- --fragment-retries stays at yt-dlp's default (10). yt-dlp retries a fragment on any HTTP error, 403 included, so "infinite" would hide an expired signature from Deer's renewal (Phase 8).
  - After 10 tries (about 3 minutes at 0, 4, 8 ... 36 s), yt-dlp exits.
  - Deer's existing handling then runs: a 403 goes to Link expired and the re-pick; anything else goes to a wait outside the run, retried every 30 s.
- yt-dlp's whole-file retries do not cover 403 or 429, so "like IDM" holds for yt-dlp rows only for 5xx and connection errors.
- ytdlp.ts parses "Retrying (n/inf)" and "Retrying fragment" lines into view.wait ('server' or 'network', by the error text). The row then shows Retrying or Waiting for network instead of 0 B/s. This is engine side, and part of the minimum.

3.10 Outside a run: waits, the queue, Link expired

waits.ts:
- waitNext(tries, now, retryAfter) = now + max(QUEUE_RETRY_MS, min(retryAfter·1000, 24 h)).
- NET_SCHEDULE, NET_EVERY and SERVER_GIVE_UP go (question 2).
- SOON, WAKE_SETTLE, SLEEP_FALLBACK, CONTINUE_AFTER, SUSPECT_TAIL and FRESH_AFTER stay.

Waits outside a run (rec.wait 'network' or 'server') now exist only in three cases:
1. after a quit or a crash: they continue WAIT_GRACE (5 s) after the start, as now;
2. sleep (wait 'sleep');
3. a fallback, when a network or server error still ends a run: the completion check, or a yt-dlp exit. These retry every 30 s and never count down to a failure.

retryWait(), armWaits() and bringWaits() stay. bringWaits() also pokes held 'network' and 'site' runs on 'up', 'changed' and 'online'.

Link expired, the quiet re-ask:
- It is for file rows that:
  - are paused with need 'address' and are not renewing;
  - were not ended by a challenge;
  - are not private, or are private while a private window is open;
  - have a final address whose expiry time is unknown or still ahead.
- One re-ask per site per QUEUE_RETRY_MS (30 s), taking turns over that site's rows. It takes the site's and Deer's tokens and waits for the site's notBefore. So 50 expired rows on one host still make 2 requests a minute.
- It is probe({once: true}) on a scratch copy of the row's FileState, outside any run. It holds no slot, shows no Checking, writes no seal, and does not change the row.
- It passes: the scratch result is adopted, and the row is queued with the warm transfer (this.warm). runFile skips its probe when the transfer was proven within the last 10 s, but still runs inspect().
- ChangedError or a new total: the row becomes File changed, or takes the silent restart at 1 MiB or less, as at a resume.
- A refusal changes nothing. view.nextAt stays the renewal schedule's, so captions and the expiry tests keep their times.

3.11 Main-thread budget

- A failed ask costs makeChannel() (loadInfo, the lane's cookieJarSettings, headers), asyncOpen, onStartRequest, onStopRequest and a rejected promise. The estimate is 0.2-1 ms; it has not been measured.
- IDM's 1,270 asks a second would take 0.25-1.3 s of main thread every second, which freezes the browser.
- Deer's worst case is 40 asks after failures a second across all of Deer: 8-40 ms per second, 1-4% of the main thread.
- No loop polls:
  - every wait is a timer raced with the stop and nudge signals;
  - the hold check rides one timer plus each failure;
  - scouts run one after another;
  - held runs leave tick().
- Spike before building: perf.js's system-timer lag meter at 20, 40, 80 and 320 failed asks a second. If the worst lag is 50 ms or more at 40 a second, raise FLOOR_MS and lower SITE_RATE and GLOBAL_RATE until it is under 50 ms.

3.12 Row, panel and settings

view() in the engine:
- A held run maps to state 'paused', with wait {for, tries, nextAt}, nextAt, status, and phase ''.
- tries is 1 plus the scouts that failed. nextAt is the next scout, or the earliest Retry-After.
- 'server' shows today's "Retrying · in N s" and "The site had a problem (503). Trying again at HH:MM".
- 'network' and 'site' show today's "Waiting for network" and "Continues when the connection is back". Today's panel already maps any wait that is not 'server' to those (panel.ts:659, 1096), so 'site' needs no window change to ship.
- So Try now, Pause, "N waiting", the ring and the quick view work unchanged.

types.ts DownloadView gains two fields:
- retrying: number. The connections in a gap, in standby or pooled.
- siteCap: {site: string; accepted: number} | null (3.6).

Window changes, after the split-view commit (question 11):
- 'site': "Can't reach example.com", with the caption "Deer keeps trying".
- A 429, or a 503 from a connection limit: "The site is limiting downloads (429). Trying again at HH:MM".
- The caption "6 of 8 active · 2 retrying · Resumable".
- The details hint "This site accepted 2 connections at once", with [Use 2 for this site].
- The drive row (4.9), with Retry.
- The Link expired caption may add "Deer checks the link every 30 s".

Settings:
- New pref siteConnections in VitreSettings.sys.ts: {kind: 'json', def: {}}, stored as {"<registrable domain>": n}, with n from 1 to 32.
  - It is matched against the final address's site, then the original's.
  - A running download above a new limit lets its extra connections finish their answers; then they do not ask again.
- Settings › Downloads › Connections: under the existing select comes the list "Connections per site":
  - rows "example.com · 2 connections · Remove";
  - "Add site…" (a host plus a count);
  - the description "Deer keeps no more than this many connections open to these sites, across all downloads. Use it for a site that turns extra connections away."
- No switch for the retry policy itself.

3.13 What stays as it is

- MAX_ACTIVE 2.
- The 30 s idle timer, tick()'s stall and slow cuts (question 1), lanes and gen bumps.
- The room check.
- Sleep, wake, quit, crash and CONTINUE_AFTER.
- The quit prompt, Try now, Pause ends a wait, and Pause all.
- Firefox-mode rows.
- The renewal steps, the page-step budgets and Refresh address.
- Resume safety (RESUME-DESIGN.md), all kept:
  - R1-R7, with the R1 standby of 3.8;
  - window 0 at every resume;
  - If-Range on every ranged ask;
  - prove() on header-only differences;
  - etagUnstable and dateUnstable, with their spot checks;
  - the silent restart at 1 MiB or less, at most twice in 10 min;
  - File changed, with Start over and Keep partial file;
  - Link expired, with every renewal step, budget and schedule;
  - the ledger, the journal and its seals;
  - inspect() at each run start, Repair, and the completion check;
  - disk errors failing at once.
- Added:
  - the rejoin proof (the scout) after every hold;
  - File changed for a new total mid-run, after one confirming probe;
  - a 416 whose bytes */N differs is handled the same way.
- Retried bytes are never mixed:
  - every retried ask writes at its segment's own offset, in that segment's own file under section 4, under the same If-Range;
  - a mismatch, a page or another total is never written, because each is checked before stream().

3.14 Diagnostics and docs

transferInfo().diag:
- adds retry: {refusedStart, server, refusedAddress, cuts, network, other, challenges, nudges, holds, scouts, peakAsksPerSec};
- adds hold: {for, since, tries, nextAt} | null;
- adds lanes[].state ('fetching' | 'gap' | 'standby' | 'pooled' | 'parked') and lanes[].nextAt;
- removes retired and stepAsides.

Docs to update:
- ARCHITECTURE.md, the Downloads section;
- RESUME-DESIGN.md: G4, decision 8 and the R1 retry rule in 3.0, marked as replaced by this design;
- IDM-BENCH.md: "Not copied from IDM" becomes "copied with floors" for hammering, and "copied only where the volume has no sparse files" for joining temp files.

Files:
- New: src/modules/downloads/retry.ts.
- Engine:
  - src/modules/downloads/net.ts, ranged.ts, proof.ts, hls.ts, ytdlp.ts, renew.ts, waits.ts and types.ts;
  - src/modules/VitreDownloads.sys.ts and src/modules/VitreSettings.sys.ts.
- Window, later: src/window/modules/downloads/panel.ts and src/window/modules/settings/pages.ts.

4. HYBRID LAYOUT

4.1 The model: one number per segment

- Segment (ranged.ts:220) gains base?: number.
  - A segment's bytes are in the file that starts at file offset base (missing means 0), at the local offset start − base.
  - The file with base 0 is always ${rec.path}.part.
  - Any other base B is ${rec.path}.parts\${B.toString(16)}.part, in lowercase hex with no padding. For example, 4000000.part starts at 64 MiB.
- The in-place layout is the case where every base is 0. The sparse .part written at file offsets is exactly what Deer does today. On NTFS no segment ever gets a base, so records, journal lines and code paths stay as they are.
- Parts layout (FileState.layout = 'parts'): every new segment gets base = start.
  - This covers plan() and claim()'s new piece (base: cut).
  - release() (ledger.ts) keeps the base of the segment it splits: all three pieces keep it.
  - snapshot(), provable() and settleSegments copy base.
- Invariants of the parts layout:
  - (a) A write never starts past the current end of its file, so there is never a gap and never a zero-fill.
  - (b) The segments of one base are contiguous, and the first starts at that base.
  - (c) Part files never overlap. A steal cuts at cut >= from + MIN_STEAL, and a writer never passes seg.end, so part B's file holds only bytes from [B, next base).
  - Every block and every proof window lies inside one segment (the cuts are block-aligned), so one read of one file covers it.
- Rebase rule. It runs in openPart, parts layout only, after clamping. For each segment, in start order:
  - If received === 0 and start − (base ?? 0) > size(file of base), set base = start (deleted when 0), and truncate a stale file of that name to 0.
  - This happens only when a part got shorter than its claims: a crash, a power cut, or another program.
  - Rebases cascade to the later pieces of the same base, which keeps (a) and (b) true.
- Orphans:
  - A name counts as a part only if it ends in .part and parseInt(stem, 16).toString(16) === stem.
  - In openPart, part files that no segment refers to hold no claimed bytes and are deleted.
  - Anything else in name.parts is left alone. Every removal of the folder (Cancel, removeParts, dropOldParts, the end of the join) deletes part names only, then removes the folder only if it is empty.

4.2 Detection

The volume query:
- A new worker op, volume, in workers/flush.js:
  - GetVolumePathNameW(dir) gives the root: E:\, a mounted folder such as C:\mnt\usb\, \\server\share\, or a subst or mapped drive root.
  - GetVolumeInformationW(root, …) gives the serial, the flags and the file system name.
  - The answer is {ok, root, fs, flags, serial, err, ms}.
- Errors are read through ctypes.winLastError. flush.js's existing ops are fixed the same way, since a declared GetLastError is not reliable under js-ctypes.
- Each query runs in a fresh ChromeWorker of the same script, which is terminated when it times out. A share that hangs for 20-60 s then blocks neither the seal flushes nor the queries for other drives.
- volumeInfo(dir), in the new src/modules/downloads/parts.ts:
  - It times out after VOLUME_TIMEOUT (10 s) and caches answers by lowercased dir for VOLUME_CACHE_MS (60 s). Failures are not cached.
  - It maps the answer to {fs, sparse: !!(flags & 0x40), maxFile, root, serial}.
  - maxFile is 0xFFFFFFFF for FAT, FAT12, FAT16 and FAT32, and 0 (no limit known) otherwise.
  - Errors 3, 15, 21, 53, 67 and 1222 (path, drive or device not found or not ready, network name gone) read as gone.

When the layout is decided:
- In openPart(), for a ranged download of known total, whenever no saved bytes are claimed: a first start, Start over, a silent restart, or a row paused before its first byte.
- That point comes after the reserve (rec.dir exists) and after any "Ask where to save", so it covers whatever folder was chosen.
- The answer is persisted:
  - FileState.layout = 'parts' (missing means in place) and FileState.volume = {fs, serial, root};
  - a journal line {layout: 'parts', t};
  - it reaches the store with the run's first save, because rec.file is the transfer's state.
- A crash before that save is safe: the stored record still has allowFresh and claims nothing.
- Once bytes are saved, the layout never changes, even if the drive is swapped.

| Volume | Layout | Largest file |
|---|---|---|
| Reports sparse files (NTFS, ReFS, most SMB and NAS shares) | In place, if the in-place sequence below confirms it; otherwise parts | No limit |
| exFAT, local or a share | Parts | No limit |
| FAT, FAT12, FAT16, FAT32, local or a share | Parts | 4 GiB − 1 byte |
| Any other file system without the sparse flag | Parts (the owner's rule) | No limit |
| Unknown (a timeout or an error, the drive present) | The in-place sequence decides | No limit |
| gone | The row pauses (4.9) | — |
| No ranges, or the length is unknown | In place, written in order | The check in 4.3 while streaming |

The in-place sequence, on every volume:
1. Create name.part empty.
2. Mark it sparse (FSCTL_SET_SPARSE).
3. Extend it to the total in the worker, with a new op 'extend' (SetFilePointerEx plus SetEndOfFile). This moves the extension off the main thread; today partfile.ts setSize() does it there.
4. Read GetCompressedFileSizeW.

The layout stays in place only if all three hold:
- the mark succeeded;
- the extension took less than EXTEND_SLOW (2 s);
- the space taken is under half the total.

Otherwise:
- The empty .part is truncated to 0, and the layout becomes parts (diag why 'mark' or 'extend').
- The answer is remembered for that volume's serial for the session.
- This catches a Samba share that reports "NTFS" for a USB stick formatted vfat or exFAT behind it.
- On NTFS the result is the same file as today, made in another order.

The mark counts as refused only for ERROR_INVALID_FUNCTION (1), ERROR_NOT_SUPPORTED (50) or ERROR_INVALID_PARAMETER (87). Any other failure stays in place, as today. Such a failure is, for example, an antivirus scanner briefly holding the fresh file with a sharing violation.

Test prefs, read only in parts.ts:
- vitre.test.partLayout = parts | inplace forces a layout.
- vitre.test.volumeInfo = JSON fakes the answer, for example {"fs":"FAT32","flags":0,"serial":1}, {"gone":true} or {"fs":"NTFS","flags":64,"mark":false,"allocated":"total"}.

Diagnostics: diag.layout = {kind, fs, sparse, root, why: 'volume' | 'mark' | 'extend' | 'forced' | 'unknown', ms}.

4.3 The largest file a drive can hold (FAT32)

- volumeInfo runs for every target, in every mode. It is cached.
- A known size above maxFile is refused before any file is made:
  - ranged and single downloads with a Content-Length, at openPart or at runSingle's first answer;
  - yt-dlp formats whose JSON reports filesize.
  - The error is TooBigForDriveError extends DownloadError. The row fails, since nothing was written, with the sentence in 4.10. No range request follows the probe.
- With an unknown length, stream() stops with the same error before the write that would pass maxFile.
- Streams are not refused up front, because their size is an estimate. Their merge's NS_ERROR_FILE_TOO_BIG gets the FAT32 sentence.
- net.ts describeError: /FILE_TOO_BIG/ reads "The file is too big for the drive it is saved to." This covers volumes where detection failed.

4.4 Room

- The filling entries become {key, total, extra, held: () => number}.
  - key is the volume's serial from volumeInfo(dir), asked at openPart for every row, old rows included (the answer is cached).
  - Only when that query fails is the key today's volumeOf(dir).
  - So an old row and a new row on the same drive always count against each other.
- In place: held = heldBytes(path), as today, and extra = 0.
- Parts layout, at openPart:
  - held is the sum of the sizes of name.part and every referenced part (IOUtils.stat, off the main thread); after that, written(s).
  - extra is the join's peak: the largest span of a part other than part 0, max over bases B ≠ 0 of (the last end of B − B). It is 0 with one part. Steals only make spans smaller, so the plan's value is an upper bound.
  - needed = max(0, total − held) + extra.
  - others = Σ over other downloads on the same key of max(0, f.total + f.extra − f.held()).
  - ensureRoom(dir, needed + others), with the 16 MiB margin unchanged.
- Start over's hasRoom uses total + extra.
- diag.room gains extra, for the parts layout only.

4.5 Writing (parts layout)

openPart, in this order:
1. With allowFresh: delete the part files in name.parts and truncate name.part.
2. Decide the layout, then run the size check (4.3).
3. List the folder, and clamp each segment by its own file: received = max(0, min(received, size(file) − (start − base))). A missing file counts as size −1.
4. Rebase, then delete orphans.
5. claimed > total is a ChangedError, as today.
6. Check the room.
7. Make name.parts, and create name.part empty if it is missing. That is a create, never an extend.
8. Register in filling.

There is no setSize(total) and no sparse call.

The rest of writing:
- stream(): new Writer(store.fileOf(seg), seg.start + seg.received − (seg.base ?? 0)).
  - The disk-error cut works on file offsets and is unchanged.
  - Two writers may share one part, for example a released block and its tail. Both write inside the file or at its end.
- A steal (claim()) makes a new part, named by the cut. A tick() cut or a retry reopens the same part at the same local offset.
- Parts count: at most one per block (2048 at worst). In practice it is about one per connection plus the end-game splits; IDM made 9 for 8 connections.

4.6 PartStore, ledger, journal, seals

PartStore, new in parts.ts: new PartStore(recPath, state) gives
- path = ${recPath}.part and dir = ${recPath}.parts;
- fileOf(seg);
- where(from, len): {path, offset} for the segment holding from, or null if the range crosses into another base;
- read(from, len), built on readAt;
- list(), a Map from base to {size, mtime}.
- VitreDownloads builds one per row (partsOf(rec)). It replaces the roughly 20 inline uses of ${rec.path}.part. In place, every lookup gives name.part at the file offset: the same bytes as today.

ledger.ts:
- attach(), use() and verify() take string | Where. A string means one file at file offsets, as for finishRecord and finished.ts.
- hashOne calls hashBlock(w.path, w.offset, len). A block that can't be located counts as failed, which is never a wrong answer.
- A new pause(): no new blocks are started, and it resolves when the reads in flight end. resume() undoes it.
- release() keeps base.
- apply() reads the layout line.

Journal (RESUME-DESIGN.md 5.7):
- A new line {layout: 'parts', t}.
- Seal cov entries become [start, received, base?], with the third element only when it is not 0. Older builds ignore it.
- fromJournals() builds {start, end, received, base}, and sets file.layout from the layout line.

seal():
- The seal job builds its flush list at the moment it computes cov, from the files of every segment in cov.
- It flushes them in one worker message: flush with paths[], which the worker loops over.
- f:1 is written only if every file flushed. So a part opened by a steal between seal() and its job is either flushed or makes the line f:0.
- In place, the list is [name.part], as today.

Proofs:
- compareWindows, proveAddress and renew.ts's Sub.partPath take string | PartReader.
- The reads at byte 0 need no change, because base 0 is name.part: readKind, windowZero, proveAddress's window 0, replaceSingle's saved window, and the hold's scout.
- prove(), spotCheck(), recordFor(), completionCheck() and fromServer() pass the store.

inspect(), parts layout:
- If neither name.part nor the folder exists, the drive check runs first (4.9), then today's "Started over".
- If only some files are missing, only their segments lose their claims, and l.retain() keeps their hashes as expect. History line: "Part of the saved download was moved or deleted · 120 MB fetched again".
- Segments are clamped file by file.
- The mtime rule is applied file by file: a file changed more than MTIME_SLACK after the seal has its own segments rewound and their blocks checked. With one file this is today's rule.
- The dirty and unclean rules work on offsets and are unchanged.

After the join: verify(), the digest check, ledger.verify, fromServer() and completionCheck() run on the single name.part.
- A later 'again' fetches released blocks again in place inside the joined file. That stays within the valid data length, so there is no zero-fill.
- Steals in such a run make new parts, and the next pass joins them.

4.7 The join (after the last byte)

Where: downloadTo() (ranged.ts:879), when some segment has a base other than 0, in this order:
1. runRanged;
2. drain the hashing, always (today only when expect.size);
3. the mismatch check;
4. a full seal (dirty = false);
5. ledger.pause();
6. the join;
7. ledger.resume();
8. completionCheck;
9. verify.

From completionCheck on, everything runs unchanged on name.part.

Hooks:
- TransferEnv gains phase?(p) and checkpoint?(): Promise<void>.
- The engine supplies setPhase(run, 'merging'), which the window already shows as "Saving" (panel.ts, ring.ts, video.ts).
- It also supplies seal(rec, t, 'join'): a seal line with the new bases, plus a flushed store save. There is no flush here, because the copy op already flushed.

Each step, for the parts in ascending order of base B > 0:
1. Require size(name.part) >= B. Otherwise the earlier stretch is short: release it, fetch it again, and join again.
2. Ask the copy worker (a ChromeWorker for this join, ended afterwards) for {op: 'copy', from: part, to: name.part, src, at: B + done, len ≤ JOIN_STEP (8 MiB), flush: lastStep}.
   - It uses ReadFile and WriteFile with a 4 MiB buffer, and opens the source with FILE_FLAG_SEQUENTIAL_SCAN.
   - It refuses a write that starts past the target's end.
   - After the part's last step, it calls FlushFileBuffers on name.part.
   - A part is copied up to n = the last end of B − B. Any stale bytes past its claims are left behind.
3. Set base = 0 on every segment of base B with start <= B + n, and base = start on the others: only released pieces with nothing received.
4. await checkpoint().
5. Delete the part by its exact name, retrying 8 × 500 ms. If it still fails, it becomes an orphan and is deleted later.

At the end: delete the empty folder, and shrink name.part to total if it is longer.

Stops, crashes and cost:
- JOIN_STEP is 8 MiB, so Pause, sleep and quit wait for at most one step. That is about 2 s on a USB 2 stick that reads and writes the same device at about 5 MB/s, within shutdown()'s 5 s.
- Crash safety: every state between steps is a valid parts layout.
  - Crash after the copy, before the checkpoint: the part is still referenced, so the step runs again and writes over the same place from B. Writes at exact offsets make this idempotent.
  - Crash after the checkpoint, before the delete: the part is an orphan and is deleted at the next openPart.
  - Bytes are flushed into name.part before the store says so, and before their part is deleted.
  - Every block was hashed before the join (the drain) and the state was sealed clean, so a crash mid-join gives nothing back to fetch.
- A row stopped during Saving has every byte saved. Its resume skips the probe (3.8): inspect(), then openPart() with nothing to fetch, then the join continues, completionCheck and verify. It needs no network and stores no 'joining' state.
- Pause, quit or sleep stop between steps. The loop always awaits the step in flight, so no handle stays open when stopped() runs.
- Cancel removes name.part, name.part.new and the part files after the seal, then the folder if it is empty.
- A part missing at the join has its segments' claims cleared (retain() gives expect), and the loop fetches it again. Only this case needs the network. A disk error is a DiskError.
- Main thread: one message per 8 MiB (128 per GiB), plus one flushed save and one journal line per part. No bytes enter JS.
- Speed: perf.js D measures the flushed time. IDM's 0.8 s for 1 GiB was probably unflushed, so the threshold is set from the spike's flushed figure.
- Diagnostics: diag.join = {parts, bytes, ms, steps}. Tests read it from hooks.beforePlace.

4.8 Every action, per layout

| Action | In place (NTFS; today) | Parts layout |
|---|---|---|
| Resume | Checking: inspect(), probe with window 0 and If-Range; only the missing ranges are fetched | The same. inspect() and window 0 read name.part (base 0). Each segment writes its own file at its local offset |
| Proofs (prove, spotCheck, completionCheck before the join) | Read the .part at file offsets | Read through PartStore.where(): the file of the segment that holds the window, at the local offset |
| inspect() after a stop or a crash | One file: clamp, the mtime rule, the dirty and unclean rules | File by file. A missing file loses only its segments' claims. If every file is gone: the drive check, then "Started over" |
| Repair of a partial (a released block) | Split, then fetched again in place | The three pieces keep their base. The block is fetched again into the same part at its local offset |
| verify, digest, ledger.verify, fromServer | On the .part | After the join, on the single name.part. 'again' fetches again in place inside the joined file |
| Keep partial file | The .part becomes "<stem> (partial).<ext>", then setSize(bytes), a shrink | First the decision is written and rec.keeping saved, as today. bytes = unbroken(segments). The parts with base < bytes are joined, each step checkpointed, so an interruption leaves a valid row that asks again. Then the same move and shrink, then the part files and the empty folder go. load()'s keeping undo is unchanged |
| Start over | name.part becomes <name>.old.part | name.part and name.parts become .old.part and .old.parts. oldPartFor picks one n free for both, and the folder moves as one unit. taken() also reserves .old.parts. dropOldParts deletes part names, then the folder if it is empty |
| Cancel, Remove (removeParts) | After the seal | Also the part files, then the folder if it is empty |
| A server that stops ranging (replaceSingle) | .new is compared with the .part's first bytes, then replaces it | The same, then the part files and the folder go |
| Show in folder | The .part | The .part, then the folder |
| Naming | uniquePath avoids an existing .part | It also avoids an existing .parts |
| Finished files (Check file, Repair, Restore original) | Unchanged | Unchanged: one file after the join |
| Streams (hls.ts track parts, the ffmpeg merge), yt-dlp | Unchanged | Unchanged. partsOf ignores name.parts: it is a folder, and its name does not match the .part or -FragN pattern |
| After the join: placeFinished, complete() (Safe Browsing reuses verify's sha256), Mark of the Web, stamp, finishRecord | Unchanged | Unchanged: they see only name.part and the final file |

4.9 A drive that is gone or changed

- state.volume is recorded for every new download.
- The check runs:
  - when inspect() finds no saved files at all;
  - when a run ends on a DiskError;
  - when openPart's query says gone;
  - and first in runFile, for a row with need 'drive'.
- What it does: volumeInfo(rec.dir) is asked again.
  - Gone: the row is paused + need {kind: 'drive', evidence: "The drive this download is saved to (E:) isn't connected"}.
  - A different serial: the same, with the "different drive" sentence (4.10).
  - Either way it is never failed. Clear finished cannot drop it, and red stays for real damage (RESUME-DESIGN.md: paused + need when the person must act).
  - Segments, the record and the files are left untouched.
- Until the window change, today's panel shows such a row as paused, with Resume, and the sentence as its history line. Resume queues it, and runFile checks the drive again. With the window change it becomes its own row state, with Retry (question 16).
- A stop whose flush failed keeps file.dirty = true. That covers a disk error, a gone drive, or a .part missing at the seal.
  - The next inspect() then runs the unclean rules: claims above each segment's last hashed block are given back, and blocks hashed in the UNFLUSHED_MARGIN before the last seal are checked.
  - So bytes still in a removed drive's write cache are never trusted.
- Old rows paused on exFAT or FAT32 by 0.1.7 or 0.1.8 have no layout field. They continue in place, as today (question 18).

4.10 Constants and UI text

| Constant | Value |
|---|---|
| FILE_SUPPORTS_SPARSE_FILES | 0x40 |
| FAT_MAX_FILE | 0xFFFFFFFF (4,294,967,295 bytes) |
| VOLUME_TIMEOUT | 10 s |
| VOLUME_CACHE_MS | 60 s |
| EXTEND_SLOW | 2 s |
| JOIN_STEP | 8 MiB |
| COPY_BUFFER | 4 MiB |
| PARTS_SUFFIX | .parts |
| Part name | ${base.toString(16)}.part |
| Part delete retries | 8 × 500 ms |

STORE_VERSION stays 2, and every new field is optional.

Sentences from the engine (src/window is not touched):
- The join: phase 'merging', shown as the existing "Saving".
- Too big for FAT32: "This file is 6.2 GB, and the drive it is saved to (E:, FAT32) can't hold files over 4.29 GB. Choose another folder in Settings › Downloads, then download it again." Both sizes are printed by sizeText, in the same units.
- Drive gone: "The drive this download is saved to (E:) isn't connected. Connect it and press Resume."
- A network folder gone (a \\server\share root): "The network folder (\\server\share) can't be reached. Reconnect it and press Resume."
- Different drive: "E: is now a different drive from the one this download is saved to. Connect that drive and press Resume."
- Too big, when detection failed: "The file is too big for the drive it is saved to."
- History line: "Part of the saved download was moved or deleted · 120 MB fetched again".

4.11 What stays exactly as today on NTFS

- No segment gets a base. The store, the journal and the seal lines are byte for byte the same, apart from file.volume.
- Writers use one .part at file offsets. Seals flush one file. inspect() and the proofs read the same file at the same offsets.
- There is no join.
- The tests keep their numbers (connections.js 1, 10 and 14).
- What does change on NTFS, all with the same result:
  - The sparse .part is made in a new order: empty, marked, then extended in the worker instead of on the main thread.
  - One volume query per fresh start: about 1-5 ms, cached, in its own worker.
- Fallback-only changes that also apply on NTFS:
  - a missing .part on a drive that is gone is no longer "Started over";
  - NS_ERROR_FILE_TOO_BIG gets its own sentence;
  - a stop whose flush failed keeps dirty;
  - a row with every byte saved skips the probe (3.8).

4.12 Files

- New: src/modules/downloads/parts.ts.
- src/modules/downloads/ranged.ts:
  - Segment and FileState;
  - plan(), claim(), openPart(), stream(), snapshot() and provable();
  - downloadTo's join;
  - replaceSingle and verify, through the store;
  - filling and room;
  - the size check.
- src/modules/downloads/ledger.ts: Where, pause and resume, release with base, the layout line, flush with paths.
- src/workers/flush.js: the ops volume, extend and copy; flush with paths; ctypes.winLastError.
- src/modules/downloads/proof.ts and renew.ts: a reader instead of partPath.
- src/modules/downloads/net.ts: TooBigForDriveError, the FILE_TOO_BIG sentence.
- src/modules/downloads/naming.ts: uniquePath.
- src/modules/VitreDownloads.sys.ts:
  - partsOf, inspect, recordFor, seal 'join' and the flush list, the env hooks;
  - keepPartial, startAfresh, oldPartFor, taken, dropOldParts, removeParts;
  - fromJournals, showInFolder;
  - the renewal and proof callers;
  - runFile's drive check, need 'drive', and the dirty rule.
- Docs:
  - ARCHITECTURE.md, the Downloads section;
  - RESUME-DESIGN.md 4.1, 4.2 and 5.7;
  - IDM-BENCH.md, "Not copied from IDM".
- Not touched: src/window/** (until the split-view commit) and spikes/downloader/idm-bench/server.py (another session's edit).

5. TESTS

Rules for every step (RESUME-DESIGN.md 7):
- Run tests/downloads/all.py in full before and after (downloader-fix-care). On NTFS, request counts and diag numbers stay unchanged.
- Run the suites at the same time with distinct --name values, to expose races (flaky-test-repro).
- Test from a worktree, with runtime, node_modules and reference junctioned, and always pass --app build-x.
- Run a second full pass, all.py --layout parts (vitre.test.partLayout=parts), so every suite runs on the parts layout on NTFS. A call site that still reads a missing name.part shows up there as a false File changed ("can't confirm").
- A control test proves that a resume of an unexpired, unchanged download makes the same number of requests as today.

5.1 New tests: retries

- retry.js, new, with no network. It checks the delay table exactly:
  - refused start: 20 ms, then 4, 8, 12, 16 s;
  - server: 4, 8, 12 s;
  - a cut after progress: 10 ms, with no failure counted;
  - a cut after 1 KiB with no progress counts as a failure and gets the floor;
  - the first re-ask of a streak is exempt from the floor, and later asks are at least 250 ms apart;
  - Retry-After wins, up to 24 h;
  - progress resets every count, and a hold keeps them;
  - the site bucket gives at most 20 + 20·T asks, and Deer's at most 40 + 40·T;
  - classOf never puts NS_ERROR_PORT_ACCESS_NOT_ALLOWED, NS_ERROR_REDIRECT_LOOP, NS_ERROR_CORRUPTED_CONTENT or an unknown exception in 'network' or 'cut';
  - cf-mitigated: challenge and a Cloudflare 1020 page are 'challenge', while nginx's default 503 page is 'refused-start'.
  - It proves the timings are the design's, independently of the server.
- connections.js new (15): one part reset before any byte, 40 times.
  - The first next ask comes within 0.1 s.
  - After that, no two asks on that connection are less than 240 ms apart.
  - The row is never paused, and the sha256 matches.
  - It proves the floor replaces IDM's loop with no backoff.
- connections.js new (15b): reset after 1 KiB, 40 times. The same bounds hold, with at most 40 asks after failures in any 1 s for the site. It proves the progress gate still guards the 10 ms path.
- connections.js new (16): a connection-cap knob ported from idm-bench (maxconn=2&limit=503, and again with 429). It checks:
  - never more than 2 bodies at once;
  - refused connections ask again at gaps of about 0.02, 4, 8 and 12 s (within 0.5 s);
  - on one connection, no two refusals less than 240 ms apart, apart from the 20 ms first re-ask;
  - each standby asks at most once per end of an answer that brought bytes, and never right after a refusal;
  - at most 150 refusals in 128 s;
  - after /cap?n=8, at least 6 connections receive within 30 s;
  - it completes and is never paused.
  - It proves refused connections now rejoin, the bounded nudge, and no storm.
- connections.js new (12b): every ask answered 502 after the first 1 MiB.
  - A 'server' hold (Retrying · in N s) starts within 11 s, with asks at 4·k s.
  - When the 502s stop, it continues on the next ask, and it is never Failed.
  - It proves the server hold and its schedule.
- connections.js new (12c): one spot answers 500 for ever, while byte 0 is served.
  - That connection's gaps keep growing across holds (4, 8, 12, 16 ... s).
  - There is at most one seal line per hold, and fewer than 30 requests in 5 minutes.
  - It proves k survives the scout, so there is no 10 s loop.
- connections.js new (17): the /swap size knob (other bytes, 1 MiB longer).
  - Within the next answers after the swap, the row is File changed with the evidence "was 256 MB, now 257 MB".
  - Every segment claims exactly what is in the .part, fewer than 20 requests follow the swap, and no byte of the new file is written.
  - Variant: one answer with a wrong total, then correct again. The confirming probe sees the old total, and the download completes and is never File changed.
  - It proves a changed size ends as File changed, and IDM's size loop is not copied.
- connections.js new (18): a silent swap (same size and validators) during a 15 s outage. The scout's window 0 differs, the row is File changed, and nothing of the new file is written. It proves the rejoin proof after a hold.
- connections.js new (19): Retry-After 120 on one part while the others move.
  - That part is not asked again before 120 s, and no other ask after a failure goes to the site before then.
  - The others continue, the row is never paused, and it completes.
  - It proves per-connection and per-site Retry-After.
- connections.js new (20): two connections refused with 403 while the others receive.
  - No request goes to the original address, and the standby asks come at 2 s, then at 4·k s.
  - The phase is never 'renewing'.
  - It proves the Gate is not spent on a per-connection limit.
- connections.js new (21): a knob that answers 503 with cf-mitigated: challenge, and another that answers 403 with a Cloudflare 1020 page.
  - The run ends within 1 s of the first such answer, as need 'page' with the evidence.
  - No request follows in the next 120 s.
  - It proves challenges are not hammered.
- connections.js new (22): one connection gets 404 (standby), then every connection is reset for 15 s.
  - That is a hold, never Link expired, and no page step starts.
  - It proves the hold's kind comes from the newest failure.
- network.js, new slot case A: two downloads from site A are held on 503 while one from site B receives.
  - After about 30 s, a queued row from site C starts, and a queued row from A does not.
  - When A's scout passes while 2 run, A stays parked and continues when a slot frees, with one scout and no Checking.
- network.js, new slot case B: 6 queued rows from 6 sites, with Services.io.offline set for 5 minutes. No row after the first 2 enters Checking, and at most 2 run when the network returns. It proves an outage never starts the queue.
- network.js, new 'site' case: a local RST outage with the link up and Services.io.offline false.
  - The wait is 'site', shown today as Waiting for network.
  - Scouts come 1 s apart for 2 minutes, then at growing gaps.
- network.js, new tick case:
  - A held run writes exactly one seal line for its hold, and no timer seals.
  - activeMs does not grow while held.
  - The ticker stops when only held runs remain.
- perf.js new case: a 30 s reset storm on 32 connections across 4 downloads from one site. The worst system-timer lag stays under 50 ms, and the site sees at most 20 + 20·T asks after failures. It proves the retry loop does not freeze the main thread.
- settings: with siteConnections {"127.0.0.1": 2}, two rows from that site never have more than 2 connections asking in total. The row action "Use 2 for this site" writes that entry.
- ytdlp.js:
  - The fake yt-dlp's logged arguments include --retries infinite, --retry-sleep linear=0::4, --retry-sleep fragment:linear=0::4 and --socket-timeout 30, and do not include --fragment-retries.
  - A fake "Retrying (3/inf)" line shows wait 'server'.
- ytdlp-real.js:
  - An expiring fragment URL makes yt-dlp exit with HTTP Error 403 within its 10 fragment retries, and the row goes to Link expired.
  - A 403 on a whole-file format is not retried by --retries infinite.
- streams.js and stream-expiry.js:
  - A segment answered 500 four times is retried at 4 s gaps, and the track never fails.
  - A segment server with a 503 cap gets standby re-asks.
  - Every segment reset for 12 s makes a hold, then the download continues.
  - A failing head segment, while the other workers idle ahead, makes a hold within 11 s.
  - 'first' (a playlist 403 with nothing written) is still asked exactly three times, then Failed.
- v-pages.js extended: Pause and Cancel stop a connection within 1.5 s while it is in a gap, in standby, pooled, or in a hold.
- idm-bench rerun (not pass/fail): limit503, outage and swap=size, for IDM and for Deer.
  - Deer's refusals are of the same order as IDM's 71.
  - During the outage Deer sends at most 40 requests in the first second and 20 a second after, against IDM's ~1,270.
  - swap=size ends as File changed, where IDM loops.

5.2 Existing tests that change: retries

Many tests encode the G4 schedule. Their quit, crash and sleep parts are kept word for word, and only the timing assertions change.
- connections.js (2), rewrite: 500 four times on one part.
  - That part is asked again about 4, 8, 12 and 16 s after each 500 (within 0.5 s), each time from another port.
  - No step aside, never paused, exactly 4 refusals and then served, and the sha256 matches.
- connections.js (8), rewrite: 520 four times, with the same checks.
- connections.js (4), tightened: a reset after 2 MiB, three times. Each next ask comes within 0.1 s (was 0.5 s).
- connections.js (9), rewrite: a 404 on one part, twice, while the others receive.
  - There is no request to the original address. That connection asks again after about 4 s and 8 s and is then served.
  - It is never Link expired, and diag.retired is gone.
- connections.js (12), rewrite, with the /outage knob (every answer reset for 12 s):
  - at most 20 + 20·T asks after failures in any T seconds;
  - the wait is 'site' (Waiting for network) by 11 s;
  - transferInfo is present throughout, with no 'checking' phase and no inspect history line;
  - one seal line at the hold;
  - receiving again within 1.5 s after the outage ends, the first ask after the hold being bytes=0-65535 with If-Range;
  - the sha256 matches.
- connections.js (13), rewrite: every connection gets 404.
  - Link expired (need 'address') comes 10-12 s after the last byte, not Failed.
  - The same address is then asked every 30 s (within 1 s), with no 'checking' phase and no new seal line.
  - When the server serves again, the row continues by itself at the next re-ask and completes intact.
- network.js drop, rewrite:
  - Waiting for network within 11 s, while transferInfo stays present;
  - at most one scout a second;
  - Try now asks within 0.2 s;
  - after the drop ends, receiving within 1.5 s, with no Checking;
  - the bytes fetched equal the bytes missing, and the sha256 matches.
- network.js offline, rewrite: with Services.io.offline set, the run holds, and no request reaches the server except at most one per 30 s. Going online, it receives within 1.5 s and completes.
- network.js busy, rewrite: a fresh start answered 503 for 90 s.
  - It reads Retrying and is never Failed.
  - The gaps between asks are about 0.02, 4, 8, 12, 16 and 20 s (within 0.5 s), written as gaps rather than times.
  - "Retrying · in N s" counts down, and it completes intact afterwards.
- network.js long: Retry-After 3600 gives one ask and a view.nextAt about an hour away, with nothing asked in between. Try now completes it.
- network.js alternate, rewrite: a held run whose serverSince is 25 h old keeps Retrying and never fails (question 2).
- network.js pauseall and runs 2-4:
  - A held run reads "1 waiting", and runningCount() never counts it.
  - Pause all makes it plainly paused within 1.5 s.
  - A quit during a hold leaves a wait that continues about 5 s after the start, through one inspect.
  - A kill during a hold does the same, with no suspect tail fetched again.
- network.js fatal, and faults.js: unchanged. A blocked port, a redirect loop and a duplicate Content-Length fail with "The connection was lost." in today's time, and never wait or hold. A disk error fails at once with nothing retried, and so does a TLS certificate error.
- v-pages.js 404 (a fresh link that never worked): unchanged.

5.3 New tests: layout (new tests/downloads/layout.js unless named)

- Detection:
  - The volume op on the profile dir gives NTFS with flag 0x40, a root and a serial.
  - A subst X: drive removed with "subst X: /d" gives gone within VOLUME_TIMEOUT.
  - vitre.test.volumeInfo set to exFAT or FAT32 picks parts.
  - A faked 30 s hang on one dir does not delay a query for another dir.
- The in-place sequence:
  - With a faked {fs: "NTFS", flags: 64, mark: false}, the layout is parts.
  - With the allocated size faked at the total after the extension, the layout is parts.
  - A sharing-violation failure of the mark stays in place.
- Writing: a ranged download with forced parts makes name.part plus name.parts\<hex>.part, one file per planned segment, each named by its start.
  - No write ever starts past a file's end; part sizes are checked against the segments while it runs.
  - With the crawl knob, a steal makes a new part named by its cut.
  - At completion the sha256 matches, the folder and .part.new are gone, and the file is not sparse.
- The FAT32 boundary: a new tests/downloads/server.py route /huge?size=N gives deterministic bytes for any size. With volumeInfo set to FAT32:
  - size 4294967296 fails with the FAT32 sentence; no .part and no .parts are made, and no range request follows the probe;
  - size 4294967295 passes the check and is cancelled at once;
  - a download with no ranges and that Content-Length is refused the same way.
- Room:
  - A fresh 256 MiB download with 8 parts has diag.room.needed = 256 MiB plus an extra of 32 MiB.
  - A second download on the same volume counts what the first still needs, once.
  - A one-connection download has extra 0.
  - An old row with no state.volume and a new row on the same drive count against each other.
- Pause and resume under parts: after a pause, every part's size is at least what its segments claim. The resume asks only for the missing ranges (server log), and the sha256 matches.
- restart.js under parts: a dirty record with zeros written into one part at a segment's local offset. The zeros are found, only that block is fetched again, and the file completes.
- repair.js under parts:
  - Deleting one part during a pause fetches only that part's segments again, with the new history line.
  - Deleting name.part and the folder gives today's "Started over".
  - Bytes flipped in one part more than 5 s after its seal get that part's blocks checked.
  - New: a part shortened or zeroed in its last 8 MiB while the drive was "gone" (faked), then Resume. The damage is caught, because dirty was kept.
- Rebase: truncating a part below the start of a later piece of the same base makes openPart move that piece to a new file named by its start. No gap is ever written, and the sha256 matches.
- Crashing the join:
  - A test hook after the copy of part k, before its checkpoint, then a store reload and resume: the same sha256, and no range requests.
  - A hook after the checkpoint, before the delete: the orphan is deleted at the next openPart.
  - Pause during Saving leaves a paused row, and Resume finishes the join.
  - A quit during Saving with the server off, and again with the link expired: the resume completes the join with zero requests.
- The seal's flush list: a test hook delays the seal job while a steal opens a new part. That seal flushes the new part, or writes f:0.
- engine.js #58, extended: Cancel during Saving leaves no .part, no .parts, no .part.new and no journal. A foreign file put in name.parts survives, and the folder stays for it.
- attach.js, Keep partial under parts: the kept file equals the fixture's prefix up to unbroken(), and name.parts is gone. A crash hook in the middle of the join leaves a row that asks again with a valid layout.
- integrity.js, Start over under parts:
  - name.part and name.parts move to .old.part and .old.parts, or to .old (1).* when those names are taken, and their partsDigest is unchanged.
  - They are dropped when the new file completes, or at once when room is short.
- expiry.js and integrity.js, proofs under parts:
  - A swap during a pause gives File changed, with windows in other parts compared at the right local offsets, and the parts untouched.
  - An unchanged resume makes the same number of requests as in place.
- replaceSingle: a server that stops ranging after a parts run (the norange knob on resume). .new is compared with the first bytes of name.part, then replaces it, and the folder goes.
- repair.js /corrupt-once under parts: after the join, the bad block is fetched again in place in the joined file.
- fromJournals under parts: with the store and .bak deleted, the row is rebuilt with bases from the seals' third element and the layout line, and it resumes from its parts.
- The drive gone: vitre.test.volumeInfo {"gone": true} at resume.
  - The row is paused with need 'drive', not failed, and Clear finished keeps it.
  - With the volume faked back, Resume continues and completes.
- naming: uniquePath skips a name whose .parts folder exists, and taken() reserves .old.parts. ytdlp.js: partsOf ignores name.parts.
- perf.js D, new: the join of 1 GiB in 8 parts on an SSD.
  - The flushed time is recorded, and the threshold is set from it.
  - Main-thread lag stays under 16 ms during the join.
  - Pause during the join returns within one step.
- Optional, on real drives (--volume-dir E:\deer-test on an exFAT stick, --fat32-dir on a FAT32 one):
  - Detection picks parts without the pref.
  - 1 GiB at full speed shows a small writerOpenMaxMs and no lane silent for more than 2 s, and the join time is recorded.
  - On FAT32, 5 GiB is refused and 3 GiB completes.
  - On the owner's NAS, if there is one: the layout chosen, and the join's time.

5.4 Existing tests that change: layout

- New shared helpers for both passes:
  - DL.partsDigest(path) hashes name.part plus the part files in name.parts, sorted.
  - DL.readSaved(path, segments, from, len) reads through the bases.
  - They replace the sha256-of-path+".part" checks in integrity.js, expiry.js, resolve.js and ui.js, and claimsTrue in network.js.
- In-place-only checks, skipped under --layout parts:
  - connections.js 1, the sparse .part;
  - perf.js's sparse cases;
  - connections.js 14, which is adapted instead: under parts, needed = total + extra and held = the file sizes, where in place it is 256 MiB through GetCompressedFileSizeW.

6. RISKS

Retries:
- Sites behind Cloudflare or another WAF may block the IP. The owner accepted this risk. The causes are:
  - standby re-asks without limit;
  - the nudges;
  - a site hold's scouts for hours.
- The mitigations:
  - Retry-After honoured per site;
  - at most 20 asks after failures a second per site;
  - no 10 ms phase, and nudges only after answers that brought bytes;
  - scouts that slow down after 2 minutes;
  - challenges detected and stopped;
  - per-site connection limits.
- Challenge detection covers Cloudflare's marks only. Another WAF's block reads as a server hold. Its gaps grow by 4 s each time: about 200 asks in the first day.
- The main-thread cost of a failed ask is estimated (0.2-1 ms), not measured. The perf spike runs before building, and the constants follow its result.
- Runs now live for hours or days. Guards that were meant per run then span days.
  - PROOF_GUARD and the Gate's count start again when a hold ends, k resets on progress, FileTransfer.sockets is capped, and the diagnostics maps are trimmed at each hold.
  - A per-run counter left out could stop a long download wrongly, or grow without bound.
- A held run shows as paused in view() while rec.state stays 'downloading'. Every engine path that branches on rec.state must handle held runs:
  - resume(id, true), pause(), Pause all;
  - pump(), runningCount();
  - sleep(), shutdown(), load();
  - tick().
  - A missed one would leave a row that ignores Try now, or one that blocks the quit prompt.
- 'network' or 'site' may name the cause wrongly. A router whose Wi-Fi link is up while the internet behind it is down reads as 'site' until a second site fails. That is "Can't reach example.com" with the window change; today both read Waiting for network.
- DNS: every Deer channel has LOAD_BYPASS_CACHE, believed to force a fresh lookup (NS_HTTP_REFRESH_DNS). If that is wrong, a negative DNS cache could delay recovery until it expires. To verify in the spike.
- The Necko codes for "network unreachable" (believed to be CONNECTION_REFUSED) and for a black-holed route (a hang until the 30 s idle timer) are from memory of nsSocketTransport, not checked here. To confirm in the spike.
- The confirming probe adds one request for a new total. On a server whose edges alternate totals, it can still end as File changed. That is correct under R2, but it is a new way for a running download to stop and ask.
- The per-site pool shares connections first come first served. A long download from a limited site can hold every place while a second one waits.
- yt-dlp rows:
  - the fragment retries stay finite, so a long outage on a stream format still exits yt-dlp into a wait outside the run;
  - yt-dlp's own retries do not cover 403 or 429;
  - the "Retrying" lines it prints may change between versions.
- REFUSED_FIRST_MS rests on the owner's 2026-10-21 figure, while the 2026-10-20 log shows no 20 ms re-ask. Read the 10-21 log before building.
- Rewriting the many tests that encode the G4 schedule risks losing coverage of the quit, crash and sleep paths. Those parts are kept word for word.
- The window changes wait for the split-view commit, so the new labels and counts come later than the engine.
- The Link expired re-ask is a new background request pattern from a paused row: one request per site every 30 s, with the person's cookies for that site, until they act.

Layout:
- Join time on slow drives. On a USB 2 stick the join reads and writes the same device, so expect about a minute per GB of "Saving" with a full bar, which can look stuck (question 17).
- Twice the writes on flash. Every part but part 0 is written twice, about (n−1)/n of the file. A network share without sparse support moves the file over the LAN about three times in all.
- A missed call site. With two layouts, every read of saved bytes at an offset other than 0 must go through the PartStore. A missed site reads nothing, and the proof turns that into a false File changed ("can't confirm"), never into mixed bytes. The forced-parts pass of all.py is the guard.
- FAT zero-fill on close. If any code path extends a file with setSize on FAT, the driver fills zeros on close, which can take minutes. Under parts only shrinks and creates are allowed, and the extension runs only in the in-place sequence, after the mark. Review every setSize call.
- Shares that misreport. GetCompressedFileSizeW over SMB may not show whether the server's file is sparse. A share that accepts the mark, extends fast, and is slow anyway is not caught. To measure on a real NAS.
- Long paths. name.parts\<hex>.part adds up to about 26 characters, so names near MAX_PATH may fail where name.part did not. Check Gecko's long-path support; the part names stay unpadded.
- FAT32 timestamps. They have a 2 s granularity and are in local time, so after a daylight-saving change every part may read as "changed by another program". That gives a full local check, which is slow on a stick but never wrong. exFAT stores the UTC offset.
- Antivirus or indexers holding new part files. Deletes during the join may fail; they are retried, and otherwise left as orphans and deleted later.
- More files means more flushes. Each FlushFileBuffers on a USB stick can take hundreds of ms, so seals on such drives get slower.
- Older builds after a downgrade read a parts record as in place. Claims past name.part's size are cleared and fetched again, so bytes stay correct, but the name.parts folder is left behind.
- No power-safe rename or delete on FAT and exFAT. A power cut during the join's metadata updates can need chkdsk. Flushing before each delete limits this, but cannot remove it.
- Keep partial and the finish share one join routine, so a bug there affects both. The crash-hook tests cover both.
- One worker per volume query costs a worker start for each query not in the cache.

7. QUESTIONS FOR THE OWNER

1. Silent and crawling connections. IDM cuts silence only at 30 s and never replaces a crawler. Copy that, or keep Deer's cuts (10 s of silence while the others run; below a quarter of the median for 16 s)?
   - Recommended: keep Deer's cuts. They are not retries, and they cost at most one request per connection per minute. On the bench they were faster: crawl 34.2 s against IDM's 45.3 s, stall 34.3 s against 36.6 s.
2. The 24-hour give-up on site errors (your decision 8 of 2026-10-13). Drop it, since IDM retries without limit?
   - Recommended: drop it. The gaps grow by 4 s each time: about 200 asks in the first day, then fewer than 100 a day, with the gap near 14 minutes after a day.
3. Retry-After, which IDM was never measured with. Honour it exactly, for the connection and for the whole site, up to 24 h?
   - Recommended: yes. It is the server's explicit request, and the strongest protection against the ban risk you accepted.
4. The floors that stand in for IDM's rates:
   - ask again at once, then at most 4 asks a second per connection;
   - at most 20 a second per site, with bursts of 20, and 40 for all of Deer;
   - while a site can't be reached, one scout a second for 2 minutes, then gaps growing by 4 s;
   - while Windows or Firefox says offline, one every 30 s.
   Accept them, or set other numbers?
   - Recommended: accept them. Adjust them only if the main-thread spike finds a lag of 50 ms or more at 40 asks a second.
5. Link expired: besides today's renewal schedule, also re-ask the same address quietly every 30 s, like IDM's queue?
   - Recommended: yes, with these limits:
     - one ask per site per 30 s, taking turns across that site's rows;
     - file rows only, and only while the address's expiry time is unknown or ahead;
     - never after a challenge;
     - private rows only while a private window is open;
     - no Checking and no seal.
6. The queue slot. A run held for 30 s on a site or server problem gives its slot to a queued download from another site, but only while another download is receiving. A run held because the network is gone keeps its slot, and a recovered run continues only into a free slot. Or should held runs never give slots away?
   - Recommended: as written. An outage never starts the queue, and never more than 2 downloads receive at once.
7. Per-site connection limits, like IDM's Exceptions list, enforced across all downloads from the site, plus "Use 2 for this site" on a row whose site turned connections away for a minute?
   - Recommended: both. It is the only control that stops IDM-style asking at a site that bans, and it is off until you set it.
8. Failures that retrying cannot fix stay Failed, and are not retried every 30 s like IDM's queue: a disk error, a TLS certificate, a blocked port, a redirect loop, and a fresh link that never worked.
   - Recommended: keep them Failed with Retry, as today. Asking again cannot fix them, or you must act.
9. yt-dlp: --retries infinite with 4 s steps and --socket-timeout 30, but fragment retries kept at yt-dlp's default of 10? yt-dlp retries fragments even on 403, so "infinite" would hide an expired link from Deer's renewal.
   - Recommended: yes. Know that yt-dlp's own retries do not cover 403 or 429.
10. A new total in the middle of a download: confirm it with one probe before saying File changed, so a single CDN edge that reports a wrong total does not stop the download?
    - Recommended: yes. It is one 64 KiB request, and no byte of the odd answer is written either way.
11. New wording, to ship with the window change:
    - "Can't reach example.com" and "Deer keeps trying", when your network works but one site does not answer (today this reads Waiting for network);
    - "The site is limiting downloads (429). Trying again at HH:MM";
    - "6 of 8 active · 2 retrying";
    - "This site accepted 2 connections at once", with [Use 2 for this site];
    - the drive row of question 16.
    - Recommended: approve them. Until then the engine uses today's labels.
12. Cloudflare's "checking your browser" pages and blocks: stop and show "The site wants to check the browser first" with Open page (after the background page step has had its try), instead of retrying like IDM?
    - Recommended: yes. Asking again can never pass a check. It raises the IP's bot score, and that can spill over to your own tabs on the same site.
13. Where the parts live: beside the target (name.part plus name.parts\), or IDM's way under %APPDATA%?
    - Recommended: beside the target. The room is checked on the drive you chose, which is often the big one when C: is small. Part 0 is never copied, and a one-connection download has nothing to join. The files are visible in Explorer, and Cancel and Start over stay on one drive.
    - IDM's way needs room for the whole file on C: as well, and copies every byte across drives at the end.
14. Network shares that report no sparse support: parts, following your rule, or keep them in place?
    - Recommended: parts, and measure it on your NAS if you have one. The join moves the file over the LAN about three times in all.
15. A file over 4 GB going to a FAT32 drive: refuse it before any byte is written, in every mode where the size is known, and add "Save to another folder…" later, when window code may change?
    - Recommended: yes.
16. A drive that isn't connected at resume, or another drive at the same letter:
    - Recommended: now, the row pauses with "isn't connected" and keeps every byte, and Resume checks again. Later, a wait that continues by itself when the drive comes back; that needs a device-arrival observer and new window wording.
17. The join: after the last byte (your choice, as IDM does), shown as today's "Saving" with a full bar?
    - Recommended: yes. Add a percentage, and joining finished parts early, only after measuring a real USB 2 stick.
18. Rows paused on exFAT or FAT32 by 0.1.7 or 0.1.8, with an in-place .part: let them finish in place, or convert them to parts?
    - Recommended: finish in place. That is correct, only slower, and converting would cost a copy.

8. HOW THE CRITIQUES WERE APPLIED

Blockers:
- The network class took in every retryable failure (both critiques). Now it is exactly classify()'s UNREACHABLE set; every other failure keeps 3 tries and then ends as today, never a hold (3.1; retry.js).
- The nudge fired on every answer end, refusals included, so standbys set each other off at 4 a second (both critiques). Now:
  - a nudge comes only when an answer that brought bytes ends;
  - it comes once per answer, from stream()'s finally;
  - never to the connection whose answer ended;
  - it never changes k, and a nudged refusal leaves the schedule as it was (3.5; test 16).

Majors:
- A local join depended on the network through Checking. A row with every byte saved now skips the probe: inspect, openPart, join, verify, with no request (3.8, 4.7; test: quit during Saving with the server off, or the link expired).
- A 10 ms re-ask after a single byte could loop (both critiques). The progress gate (1 MiB or 5 s) is kept; anything less is a failure, with the floor and tokens (3.1; tests 15b and retry.js).
- The scout reset every count, so one bad spot looped every 10 s. Each connection keeps its k and Retry-After across holds; a server hold's scout is due at the earliest connection's own time; and start/end mismatches are bounded at 3 tries (3.4, 3.1; test 12c).
- tick() kept sealing, saving and counting active time for held runs. tick() now skips them, and the ticker stops when only held runs remain (3.4; network.js tick case).
- The hold sealed while writers still drained, and pointed the ledger at rec.file.segments. The hold now awaits every pull() and stream() before sealing with provable() as the ledger's source, and the source is set to provable() again before any write (3.4).
- The hold's kind let an old R1 turn an outage into Link expired. Link expired now needs every connection's latest failure to be R1 within 10 s; the newest failure decides otherwise (3.4; test 22).
- Slot release let an outage start the whole queue (both critiques). Only 'server' and 'site' holds give up a slot, and only while another download receives. A 'network' hold keeps its slot, a recovered run continues only into a free slot, and Deer has a 40 a second cap (3.4, 3.6; slot cases A and B).
- A gone drive failed the row, so Clear finished could drop the saved bytes. It is now paused with need 'drive', never failed (4.9).
- A gone drive's unflushed bytes could be trusted. A stop whose flush failed keeps dirty = true, so the unclean rules run (4.9; repair.js case).
- The seal's flush list was snapshotted too early. The job builds it from cov when it computes cov, and writes f:1 only if every file flushed (4.6; seal flush-list test).
- yt-dlp's --fragment-retries infinite would loop on an expired 403. Fragment retries stay at the default of 10, with 4 s steps, and "Retrying" lines feed view.wait (3.9; ytdlp.js, ytdlp-real.js).
- "Waiting for network" was shown when only one site failed. There is a 'site' kind, shown with today's label until the window change; 'network' is used only when offline, with the link down, or when several sites fail. Scouts slow down after 2 minutes, and section 1 says once every 30 s while offline (3.4, 3.12, question 11).
- Cloudflare challenges and blocks were hammered. A challenge class stops the run, then the page step, then need 'page', with no 30 s re-ask; Retry-After applies to the whole site (3.1, 3.8; test 21, question 12).
- Connections per site limited only one download. An engine-wide per-site pool enforces it across downloads; the hint reads "accepted 2 connections at once"; and it is also offered for resets and 403s (3.6; settings test).
- The Gate reset after 8 MiB made renewals near-unlimited. The Gate keeps its per-run count and starts again only when a hold ends; a 403 or 404 while the address serves another connection skips renewal; and there is no "Renewing link" while receiving (3.8; test 20).
- setSize before the sparse mark could freeze on a share that misreports. Every volume now creates empty, marks, extends in the worker, and checks the space taken; a slow or non-sparse result switches to parts (4.2; in-place sequence tests).

Minor notes (applied unless marked "left"):
- The R1 standby replaces RESUME-DESIGN 3.0's "exactly one retry", and never runs after the address's expiry time (3.8).
- Formulas against the tests: the first re-ask of a streak is exempt from the floor, the site burst is 20, and the tests use 20 + 20·T (3.1, 3.2).
- FileTransfer.sockets is capped at 256 (3.7).
- rec.held goes in the hold seal's flushed save, and load() checks it before the unclean branch (3.4).
- A silent outage: the hold comes at 10 s only while offline or with the link down; otherwise it comes after up to 30 s, and section 1 says so (3.4).
- The Link expired re-ask is one per site per 30 s, uses tokens, runs on a scratch FileState, and gives File changed on a change; private rows only while a private window is open (3.10). The caption wording is left to the window change.
- The HLS hold counts idle workers as not receiving (3.9).
- The forced-parts pass marks the in-place-only checks (5.4).
- One worker per volume query, and ctypes.winLastError, also fixed in flush.js (4.2).
- The second chance switches to parts only on errors 1, 50 or 87 (4.2).
- The room key is the serial for every row (4.4).
- The join drains and seals first. 8 MiB steps keep Pause within about 2 s, instead of an abort flag (4.7).
- The perf D threshold comes from a flushed measurement (4.7, 5.3).
- The FAT32 refusal covers every mode with a known size; streams get the sentence at the merge (4.3).
- Refused-start failures make a 'server' hold (3.4).
- Retry-After applies per site (3.6). The 429 caption is left to the window change (question 11).
- REFUSED_FIRST_MS against the 10-20 log: left, to check before building (section 2).
- The busy test is written as gaps (5.2).
- Section 1 says the re-asks only help when the site's limit rises.
- Foreign files in name.parts are never deleted (4.1).
- The UI text covers UNC roots, says "Choose another folder in Settings › Downloads", and prints the limit with sizeText (4.10).
