# The multi-connection engine (IDM-style ranged downloads)

## In one paragraph

Deer downloads one big file over many connections at once, the way Internet Download Manager (IDM) does.
First it sends one small "probe" request (`Range: bytes=0-0`) to learn the file's length, whether the server
can send parts of the file, and the file's version tags. If the server can, and the file is 8 MiB or more,
Deer cuts the file into equal pieces ("segments", aligned to 1 MiB or bigger blocks) and starts all
connections at once (8 by default). Each connection gets its own network partition (a "lane"), so it really
is its own TCP connection, even on HTTP/2 servers. Every answer is checked before any byte is written
(right status, right byte range, same file length, same version tag, not a web page). Bytes go straight into
one pre-sized `.part` file at their own offsets (or, on drives without sparse files, one file per part,
joined at the end). When a connection finishes its piece, it takes half of the biggest piece still running
("work stealing"). Every 2 s Deer compares each connection with the others: a silent one (10 s) or a very
slow one (16 s below a quarter of the others' median) is cut and asked again at once on a new connection.
Failures are retried the IDM way: a cut is asked again at once, a server error after 4 s, 8 s, 12 s ...,
a "too many connections" answer (429/503) makes the connection give its piece back and wait. A token bucket
limits speed by pausing the network stream, and a disk that falls behind pauses it too.

## Words used in this document

- **Range request**: an HTTP request with a header like `Range: bytes=1000-1999`. It asks the server for
  only those bytes of the file (both ends included).
- **HTTP 206 (Partial Content)**: the answer to a Range request when the server honours it. It carries a
  `Content-Range: bytes 1000-1999/5000` header: first byte, last byte, and the whole file's length.
- **HTTP 200**: the normal "here is the whole file" answer. To a Range request it means the server ignored
  the Range.
- **HTTP 416 (Range Not Satisfiable)**: the server cannot give the asked bytes, for example because the file
  is empty (`Content-Range: bytes */0`).
- **Content-Length**: the length of this answer's body in bytes.
- **Validator**: a value that names one version of the file. Two kinds:
  - **ETag**: an opaque tag such as `"abc123"`. A **weak** ETag starts with `W/` and may not be used for ranges
    (RFC 9110 13.1.5).
  - **Last-Modified**: the date the file last changed.
- **If-Range**: a request header carrying a validator. It means "send the bytes I asked for only if the file
  is still this version; otherwise send me the whole file (200)".
- **Segment**: one piece of the file `[start, end)` plus how many of its bytes have arrived (`received`).
- **Block**: a fixed-size unit (1 MiB to 64 MiB) used to align cuts and to hash saved bytes.
- **Lane**: Deer's word for "one connection slot of one download". Each lane gets its own Necko network
  partition, so it gets its own TCP socket.
- **Necko**: Firefox's network library. Deer's requests are Necko "channels".
- **HTTP/2 multiplexing**: on HTTP/2 (h2) a browser normally sends many requests to one host over a single
  TCP connection. Then "8 connections" are really 8 streams inside one connection.
- **Sparse file**: a file whose unwritten regions take no disk space. Writing far into it does not first fill
  the gap with zeros.
- **Zero-fill**: on NTFS without the sparse mark, and on FAT/exFAT, writing at offset X of a new file makes
  Windows write zeros from the old end up to X first. On big files this took minutes.
- **Token bucket**: a rate limiter. Tokens (bytes) refill at the allowed rate; each read spends tokens; when
  the bucket is empty the reader waits.
- **Back-pressure**: slowing the producer (the network) when the consumer (the disk) cannot keep up.
- **Median**: the middle value of a sorted list.
- **Stall**: a connection that receives nothing for a while. **Crawler**: one that receives far less than the
  others.
- **Retry-After**: a server header that says how many seconds (or until which date) to wait before asking again.

## Files

| File | Role | Lines |
|---|---|---|
| `gecko/src/modules/downloads/ranged.ts` | The engine: probe, plan, connections, work stealing, stall/slow cuts, per-connection retries, writing, single-stream fallback, verify | 2138 |
| `gecko/src/modules/downloads/net.ts` | One request = one Necko channel: lanes, headers, redirects, idle timeout, suspend/resume, error classes, status rules | 1009 |
| `gecko/src/modules/downloads/retry.ts` | IDM's retry policy: failure classes, delays, a global pacer (150 asks/s), offline handling (read in full; needed by `fetchSegment()`) | 186 |
| `gecko/src/modules/downloads/partfile.ts` | The `Writer` (pipe + background copier per connection), file sizing, free space, bytes held on disk (read in full) | 288 |
| `gecko/src/modules/downloads/parts.ts` | IDM's "one file per part" layout for drives without sparse files, and the join after the last byte | 314 |
| `gecko/src/modules/downloads/limiter.ts` | The speed limit (token bucket) | 53 |
| `gecko/src/modules/downloads/waits.ts` | Waits outside a run (after a quit, crash, sleep): every 30 s | 71 |
| `gecko/src/modules/downloads/types.ts` | Shapes shared with the UI: `DownloadView` (speed, peak, average, ETA, connections, the 8-cell bar) | 485 |
| `gecko/src/modules/downloads/proof.ts` | Only the parts the engine calls: `totalOf`, `digestOf`, `judge`, `validatorsDiffer`, `windows`, `compareWindows`, constants (611 lines; the same-file proof is another study section) | 611 |
| `gecko/src/modules/downloads/ledger.ts` | Only `blockSize()` and its constants (the hash record is another section) | 910 |
| `gecko/src/modules/VitreDownloads.sys.ts` | Only: `MAX_ACTIVE`, the speed/ETA tick, `env()` (connections, limiters), `view()` | 5573 |
| `gecko/src/shared/settings.ts`, `gecko/src/modules/VitreSettings.sys.ts`, `gecko/src/window/modules/settings/pages.ts` | The "Connections per download" setting: default, allowed range, menu choices | 111 / 269 / — |
| `gecko/spikes/downloader/IDM-WAY-DESIGN.md` | Design of 2026-10-21: retry "exactly like IDM" and the hybrid file layout; what was built and what was not | 1235 |
| `gecko/spikes/downloader/IDM-BENCH.md` | IDM 6.43 vs Deer on a local bench, 2026-10-20 | 86 |
| `gecko/spikes/downloader/RESULT.md` | The first spike (can the engine run on Gecko?) and its independent verification, including the "lanes" discovery | 306 |
| `gecko/spikes/downloader/idm-bench/server.py` | Bench server: deterministic bytes, per-connection rate, fault knobs, request log | 313 |
| `gecko/spikes/downloader/idm-bench/bench.py`, `run_all.py`, `deer_run.js` | Drive IDM (COM API) or Deer for one scenario and measure from the server log | 196 / 69 / 34 |
| `gecko/spikes/downloader/idm-bench/results-2026-10-20.jsonl` | The raw bench results (22 runs, every request logged) | 22 |
| `gecko/spikes/downloader/verify/engine/VitreRanged.sys.mjs` | The verified prototype engine (history only) | 494 |
| `gecko/spikes/downloader/verify/engine/VerifyLanes.sys.mjs` | The test that proved lanes (history only) | 127 |
| `gecko/tests/downloads/connections.js`, `engine.js`, `layout.js` | The tests that hold these rules (headers read; not run) | 323 / 104 / 178 |

Note on origin: the top of `ranged.ts` says the prototype was itself a port of an Electron
`ranged.ts` and of `RangedDownload.swift` (`gecko/src/modules/downloads/ranged.ts:1-3`).

---

## 1. One request = one channel (the request layer)

**What it does**

Every HTTP request of the downloader (probe, segment, proof window) is one call to `open()`. It resolves as
soon as the answer's head (status and headers) arrives. The body waits. The caller looks at the head and then
either reads the body (`stream()`) or drops it (`destroy()`).

**How it works**

- `open(url, identity, extraHeaders, signal, {lane, gen})` builds a channel with `makeChannel()` and starts it
  (`gecko/src/modules/downloads/net.ts:802-825`).
- Headers put on every request by `dress()` (`net.ts:346-367`):
  - `Accept: */*`;
  - `Accept-Encoding: identity` — "Ranges count bytes of the stored file: never let the server compress"
    (`net.ts:358-359`). In `onStartRequest` it also sets `applyConversion = false`, so even a server that
    compresses anyway hands over raw bytes (`net.ts:539-544`);
  - `Origin` for cross-origin media when the identity asks for it (`net.ts:360`);
  - the caller's extra headers (`Range`, `If-Range`) (`net.ts:361`);
  - a Referer computed by Deer (not by Necko) and sent as-is (`net.ts:348-356`).
- Cache: `LOAD_BYPASS_CACHE | INHIBIT_CACHING | LOAD_BYPASS_SERVICE_WORKER` (`net.ts:341`). No downloader
  request reads from or writes to the HTTP cache.
- Redirects: Necko follows them, but Necko does **not** carry headers set by the caller over a redirect.
  So `asyncOnChannelRedirect` runs `dress()` again on each hop's new channel (`net.ts:449-461`):
  - a hop to a non-http(s) address is refused ("The site redirected to an address Deer can't download.");
  - each hop's old address is kept in `chain`, at most `CHAIN_MAX = 8` (`net.ts:174`, `net.ts:455`). A later
    renewal of an expired address asks these again.
- At the head (`onStartRequest`), the channel is **suspended** at once (`net.ts:547`). `Response.stream()`
  resumes it (`net.ts:689-708`). If the head could not be held suspended, early chunks are kept in memory
  (`early`) until someone reads them (`net.ts:556-559`).
- The body consumer runs for every chunk and returns one of (`net.ts:564-592`, `net.ts:684-688`):
  - `undefined` — go on;
  - `{stop: true}` — enough: cancel the channel, resolve the body promise successfully;
  - `{wait: ms}` — the speed limit: suspend the channel for `ms`;
  - `{until: () => boolean}` — disk back-pressure: suspend, and poll the condition every 10 ms.
- Time held for the disk or the speed limit is counted (`held = {disk, limit}`, `net.ts:406-428`). The stall
  detector uses it (section 12).
- Gotcha recorded in the code: a suspended channel never delivers `onStopRequest` after `cancel()`, so
  `cancel()` resumes it as many times as it was suspended (`net.ts:486-504`, `RESULT.md` gotcha 3).
- Each `Response` exposes `status`, final `url`, `chain`, `protocol` ("http/1.1", "h2", "h3"), `headMs`
  (time to head) and `socket` (local and remote address and port), used by tests and diagnostics
  (`net.ts:619-676`).
- Deer never sends a `HEAD` request and never reads `Accept-Ranges` (neither appears in `gecko/src/modules`).
  Range support is learned only from a real 206.

**Why**

- `RESULT.md` "Redirects keep Range": the first spike run showed Necko dropping `Range` and
  `Accept-Encoding` after a 302. After adding the redirect sink, 9 ranged requests after the 302 succeeded.
- Compressed bodies would make byte offsets meaningless, so compression is refused and undone.
- Looking at the head before reading means a wrong answer (a page, the wrong range, another version) is never
  written (see section 9).

**Edge cases handled**

- Redirect to `ftp:`, `data:` etc.: aborted with a readable sentence.
- A body-less answer that already ended: `suspend()` may throw; handled (`net.ts:506-517`, `net.ts:700-704`).
- Server compresses although asked not to: `applyConversion = false` keeps raw bytes.

**Proven by**

- `RESULT.md` claims "Requests with Range headers through Necko channels" and "Redirects keep Range".
- `gecko/tests/downloads/engine.js` section 1: "Referer is the page on every ranged request".

---

## 2. The probe (the first request)

**What it does**

Before any connection opens, Deer asks for the first byte of the file. From that one answer it learns:
the file's length, whether the server sends parts, the version tags, the final address after redirects, the
file name the server suggests, the content type, and any whole-file checksum the server offers.

**How it works**

`FileTransfer.probe()` (`gecko/src/modules/downloads/ranged.ts:560-643`) and `learn()` (`ranged.ts:718-777`).

1. The request goes on **lane 0** (`ranged.ts:580`).
2. Headers:
   - fresh download: `Range: bytes=0-0` (one byte), no If-Range (`ranged.ts:578`);
   - resume: `Range: bytes=0-65535` (one 64 KiB "window", `WINDOW = 64 * 1024`, `proof.ts:33`) plus
     `If-Range` with the stored validator. The 64 KiB are compared with the saved bytes in the same request,
     so an unchanged resume costs no extra request (`ranged.ts:33-35`, `ranged.ts:571`).
   - For a file of at most 64 KiB the resume asks one byte short (`total - 1`), because some servers answer a
     Range over the whole file with a 200 (`ranged.ts:568-571`).
3. Answer 200, 206 or 416: accepted (`ranged.ts:587`). For a fresh download, `learn()` runs:
   - `total = totalOf(res)` (`proof.ts:114-119`):
     - 206 → the total from `Content-Range` (`bytes 0-0/TOTAL`); `*` means unknown (-1);
     - 200 → `Content-Length` (-1 if missing);
     - 416 → 0 only when `Content-Range` says `*/0` (an empty file), else -1.
   - `ranges = (status === 206 && total > 0)` (`ranged.ts:724`). That is the only test of range support.
   - A 200 means the server ignored the Range: **this answer is the whole file**. It is kept, suspended, as
     `pending` and later streamed as the single-stream download, so a no-Range server costs one request, not
     two (`ranged.ts:725-729`, `ranged.ts:1807`).
   - A 206 or 416 is dropped (`res.destroy()`).
   - Stored for a fresh download (`ranged.ts:731-743`): `finalUrl = res.url` (after redirects), `total`,
     `etag`, `lastModified`, `digest` (`digestOf()`: `Repr-Digest`/`Digest` sha-256, or `Content-MD5` only on
     a 200, because on a 206 it describes the one byte, `proof.ts:130-144`), `contentType`,
     `dispositionName` (from `Content-Disposition`), `chain` (redirect hops), and an address record.
   - `Content-Disposition` parsing (`gecko/src/modules/downloads/naming.ts:79-101`): `filename*=` (RFC 5987,
     percent-decoded) wins; else `filename=`, quoted or not; a name whose bytes look like raw UTF-8 sent as
     Latin-1 is re-decoded as UTF-8.
4. All later segment requests go straight to `finalUrl`. The redirect is followed once, at the probe.
5. Failures of the probe itself:
   - network error: up to `ATTEMPTS = 3`, 1 s apart (`ranged.ts:581-586`, `ranged.ts:98`);
   - 401/403/404/410/451 or 400 (`REFUSED_STATUS`, `net.ts:107`): `refusal()` builds the error; with saved
     bytes it goes to the renewal hook (another section); a fresh download retries only statuses in
     `RETRYABLE_STATUS` (403 is one of them, "on a CDN it is usually a token that fresh cookies fix",
     `net.ts:94-95`), with `backoff()` gaps 2 s, 6 s, then 15 s (`net.ts:859-862`);
   - 429 and 5xx: same 3 attempts and backoff, but a `Retry-After` above `IN_RUN_WAIT = 60` s stops at once so
     the row waits outside the run (`net.ts:856`, `net.ts:871-874`, `ranged.ts:639`).
6. A resume also runs `judge()` (`proof.ts:208-228`) **before** changing any state: a web page or JSON where a
   binary file was (the address expired), another total, a tiny answer where a big file was, a different
   checksum, a 200 to If-Range, or other validators. Header-only differences are then decided by comparing
   saved bytes (`prove()`, `ranged.ts:796-813`). This belongs mostly to the resume section; the rule that
   matters here: **the probe never changes the stored segments on a guess**.

**Why**

- IDM's first request is a plain GET without Range; it keeps about 228 KB of that answer and then splits.
  Deer chose not to copy it: "Deer asks bytes=0-0 first, a resume bytes=0-65535: size, range support and
  validators before any connection opens" (`gecko/spikes/downloader/IDM-BENCH.md`, "Not copied from IDM").
- Asking for one byte works on every range server and costs nothing. Asking 64 KiB on resume adds the
  same-file check to the request that was needed anyway (RESUME-DESIGN.md 2.5, quoted at `ranged.ts:33-35`).

**Edge cases handled**

- Server ignores Range (200): one request total; the probe's answer becomes the download.
- Empty file: 416 with `*/0` → total 0 → `download()` returns at once (`ranged.ts:920`).
- 206 with an unknown total (`bytes 0-0/*`): `ranges = false` → single stream.
- 200 without `Content-Length`: total -1 → single stream of unknown length; its length is set when it ends
  (`ranged.ts:1820-1823`).
- Redirect chain recorded for renewal of signed addresses.
- A Cloudflare "checking your browser" page: detected in `refusal()` (`cf-mitigated: challenge`, or
  `Server: cloudflare` + HTML + known markers in the first 4 KiB, `net.ts:790-796`). Inside a run it stops the run
  at once (section 14). At the probe, by reading `ranged.ts:627-641`, a fresh download still makes its up to 3
  attempts (403 and 503 are retryable statuses there); the challenge test runs when the error is built.
- A 400 whose body (first 4 KiB) says the signed address expired (`/ExpiredToken|Request has expired|Signature|expired/i`)
  is treated as "address refused", not as a bad request (`net.ts:767`, `net.ts:782-785`).

**Proven by**

- Bench log (`idm-bench/results-2026-10-20.jsonl`, Deer "plain"): first request `bytes=0-0` (1 byte sent),
  then 8 segment requests 0.05 s later; the first segment reused the probe's socket (same port 14518).
- `RESULT.md` "Servers without Range support": probe status 200, one request reached the server.
- `tests/downloads/engine.js` section 2: the resume's probe is `bytes=0-65535` and is not fetched again.

---

## 3. How many connections

**What it does**

A download uses one connection when the file is small, unknown in size, or the server does not send parts.
Otherwise it uses the "Connections per download" setting, 8 by default.

**How it works**

- `connections()` (`ranged.ts:884-886`):

  ```
  if total >= MIN_SPLIT (8 MiB):  n = clamp(setting, 1, 32)
  else:                           n = 1
  ```
  `MIN_SPLIT = 8 * 1024 * 1024` (`ranged.ts:94-95`): "Below this, connection setup costs more than parallel
  pieces return."
- `runRanged()` runs only when `ranges && total > 0` (`ranged.ts:921`); otherwise one stream.
- The setting:
  - default `connections: 8` (`gecko/src/shared/settings.ts:71`);
  - stored as an int, min 1, max 32 (`gecko/src/modules/VitreSettings.sys.ts:52`);
  - the Settings menu offers 1, 2, 4, 8, 16 (plus the current value if different)
    (`gecko/src/window/modules/settings/pages.ts:507`, `:537`). So **16 is the largest choice in the UI;
    the engine accepts up to 32** (`VitreDownloads.sys.ts:3254`).
- Other modes clamp differently: HLS/DASH segments use at most 16 (`gecko/src/modules/downloads/hls.ts:1161`);
  yt-dlp is passed `-N` of at most 8 (`gecko/src/modules/downloads/ytdlp.ts:936`).
- At most `MAX_ACTIVE = 2` downloads run at once; the rest wait in a queue
  (`gecko/src/modules/VitreDownloads.sys.ts:257`, comment at `:67`).
- The row shows "N of M active": `connections` = answers streaming now (`FileTransfer.live`), `maxConnections`
  = `min(32, setting)` for a ranged file of at least 8 MiB, `min(16, setting)` for a stream, else 1
  (`VitreDownloads.sys.ts:4581-4624`).

**Why**

- The 8 MiB floor and the "parallel pieces return" reasoning are in the comment at `ranged.ts:94`. No
  benchmark for the floor value was found in the files read.
- `RESULT.md`: 1 to 32 connections were measured on a server that throttles each connection to 8 MB/s:
  1 conn 32.0 s (8 MB/s), 16 conn 2.1 s (121.9 MB/s), 32 conn 1.25 s (204.5 MB/s). The verifier notes this
  scaling is "by construction" of the throttled server; unthrottled loopback showed no gain (1 conn 1488 MB/s,
  8 conn 1790 MB/s). On a real CDN (cdn.kernel.org, 24.6 MB over TLS): 1 conn 3.3 MB/s, 8 conn 15.2 MB/s.

**Edge cases handled**

- Unknown total: always 1 connection.
- A file just under 8 MiB with range support: 1 connection, but still resumable by Range.

**Proven by**

- `tests/downloads/engine.js` section 1: "8 connections receive at once", "the view reports 8 connections and
  8 segment fills".

---

## 4. The segment plan

**What it does**

Splits the file into about `n` equal segments. Each cut is on a block boundary.

**How it works**

`plan()` (`ranged.ts:888-899`) and `blockSize()` (`gecko/src/modules/downloads/ledger.ts:77-82`):

```
blockSize(total):            # MIN_BLOCK = 1 MiB, MAX_BLOCK = 64 MiB, MAX_BLOCKS = 2048 (ledger.ts:39-41)
  want = ceil(total / 2048)
  bs = 1 MiB
  while bs < want and bs < 64 MiB: bs = bs * 2
  return bs

plan():
  if segments already exist: keep them            # a resume never re-plans
  if ranges and total > 0:
    bs   = blockSize(total)
    size = ceil(ceil(total / n) / bs) * bs        # equal share, rounded UP to a whole number of blocks
    for start = 0; start < total; start += size:
      push {start, end: min(total, start + size), received: 0}
  else:
    segments = [{start: 0, end: total or -1, received: 0}]
```

Examples (n = 8):

| File | Block | Segment size | Segments planned |
|---|---|---|---|
| 9 MiB | 1 MiB | 2 MiB | 5 (2,2,2,2,1) |
| 10 MiB | 1 MiB | 2 MiB | 5 |
| 100,000,000 B | 1 MiB | 12 MiB | 8 (last one 11,919,616 B) |
| 256 MiB | 1 MiB | 32 MiB | 8 |
| 1 GiB | 1 MiB | 128 MiB | 8 |
| 3 GiB | 2 MiB | 384 MiB | 8 |
| 10 GiB | 8 MiB | 1280 MiB | 8 |

The bench confirms the 256 MiB, 1 GiB and 3 GiB cases (Deer asked `bytes=0-33554431`, `0-134217727`,
`0-402653183`).

**Why**

- Block alignment: "Cut at multiples of the block size, so each block sits inside one segment"
  (`ranged.ts:892`, RESUME-DESIGN.md 4.1). The block hash record (crash recovery, repair) needs each block
  to be written by exactly one segment.
- The prototype split at the exact share (`Math.ceil(s.total / n)`, `verify/engine/VitreRanged.sys.mjs:180-189`).
  Alignment came with the block record in Phase 5 (commit `31eed88`, 2026-10-14).

**Edge cases handled**

- Rounding up can give fewer than `n` segments on small files. The extra connections then split running
  segments at once (section 5).
- Older, unaligned segments from earlier records still work (`ranged.ts:52-53`).

**Proven by**

- Bench request logs (above).

---

## 5. Starting the connections (no ramp)

**What it does**

All `n` connections start together, right after the probe. There is no slow ramp-up.

**How it works**

`runRanged()` (`ranged.ts:1140-1269`):

1. `n = connections()`; `Promise.all` of `n` workers, worker `i` uses lane `i` (`ranged.ts:1257`).
2. Each worker loops (`ranged.ts:1196-1243`):
   ```
   loop:
     if run failed or stopped: return
     seg = claim(owned)            # a free segment, or half of the biggest running one (section 6)
     if no seg: rouse(); return    # nothing left: wake waiting connections, leave for good
     owned.add(seg)
     fetchSegment(seg)             # until the segment is complete (retries inside)
     owned.delete(seg)
     if it was turned away: stand by (section 15), then loop
   ```
3. `claim()` runs synchronously when each worker starts, before any network wait, so the first workers take
   the planned segments in file order and the extra workers immediately split the biggest ones. Example:
   10 MiB, 8 connections: 5 planned segments of 2 MiB; the 6th, 7th and 8th workers each split one 2 MiB
   segment into 1 + 1 MiB. Result: 8 requests at once.
4. A worker that finds no work **leaves for good**. If `n` is larger than the pieces the file allows (for
   example 32 connections on a 20 MiB file → 20 segments of 1 MiB, which can't be split), the extra workers
   leave at once.
5. A ticker runs `tick()` every 2 s for stall/slow checks (`ranged.ts:1255`).
6. The run ends when every worker has returned. If any segment still has bytes left, it fails with the last
   refusal seen, or "Some parts of the file didn't arrive." (`ranged.ts:1266-1268`).

**Why**

- IDM ramps: "4 connections at once, 8 by about 1.2-2 s", each split a new TCP connection
  (`IDM-BENCH.md`). Deer starts all at once after one probe. On the bench with a 2 s delay before every answer
  ("ttfb"), IDM needed 20 requests and 40.3 s; Deer 9 requests and 36.1 s.
- `rouse()` exists because "a finished download sat at 100% while one rested" (`ranged.ts:1152-1153`).

**Edge cases handled**

- More connections than pieces: extra workers leave.
- Pause or Cancel while the `.part` was being prepared: checked before `runRanged()` starts (`ranged.ts:917-918`,
  commit `e20b1ca`: "runRanged never heard an abort that came before it").

**Proven by**

- Bench "plain": Deer 8 concurrent from second 0 (`conc` 8,8,8...), IDM 5 then 8.
- `tests/downloads/engine.js`: "the server saw 8 parallel transfers on 8 sockets", "bytes on the wire = the file
  size (no overlap)".

---

## 6. Work stealing ("dynamic segmentation")

**What it does**

A connection that finishes its piece does not sit idle. It takes the second half of the biggest piece that
another connection is still downloading. Near the end, many connections share the last big piece, so one slow
piece does not decide when the whole file ends.

**How it works**

`claim()` (`ranged.ts:1276-1304`):

```
claim(owned):
  free = first segment (file order) that nobody owns and that has bytes left
  if free: return free

  bs = blockSize(total)
  cutOf(s):                                  # a block-aligned cut near the middle of what is left
    from = s.start + s.received              # first byte not yet received
    mid  = from + floor(remaining(s) / 2)
    down = floor(mid / bs) * bs              # block boundary at or below mid
    order = (mid - down <= bs/2) ? [down, down + bs] : [down + bs, down]   # nearest boundary first
    for c in order:
      if c - from >= MIN_STEAL and s.end - c >= MIN_STEAL: return c
    return -1

  best = none
  for s in owned:                            # segments being fetched now
    if remaining(s) < 2 * MIN_STEAL: skip
    if best and remaining(s) <= remaining(best): skip
    c = cutOf(s); if c < 0: skip
    best = s; cut = c
  if none: return null

  piece = {start: cut, end: best.end, received: 0}   (+ base = cut in the parts layout)
  best.end = cut                                      # the running answer now stops at cut
  insert piece right after best
  return piece
```

Constants: `MIN_STEAL = 1024 * 1024` ("A running segment is only split when both halves would be at least
this big", `ranged.ts:96-97`). So the smallest piece a split makes is 1 MiB, and a segment needs at least
2 MiB left to be split.

How the running connection learns its segment got shorter: its body consumer checks the room left on every
chunk (`ranged.ts:1719-1721`, `ranged.ts:1755-1757`):

```
room = seg.end - seg.start - seg.received     # seg.end may have moved
if room <= 0: STOP
take n = min(count, room) bytes
if remaining(seg) == 0:
  if seg.end == askedEnd: let the answer finish by itself  # keeps the connection alive for reuse
  else: STOP                                               # a split moved the end: cut the answer
```

**Why**

- This is IDM's behaviour: "the others finish their parts and split the crawler's remainder"
  (`IDM-BENCH.md`). Measured on the owner's IDM: "Crawling connection: Never replaced; the others split its
  remainder" (`IDM-WAY-DESIGN.md` section 2).
- Block alignment of the cut: so each hashed block lies in one segment (`ranged.ts:1271-1275`, RESUME-DESIGN
  4.1). The prototype cut at the exact middle (`VitreRanged.sys.mjs:282-294`).
- Asking each request for exactly the segment's end lets HTTP/1.1 keep the connection alive for the next
  segment; only a moved end forces a cut (comment at `ranged.ts:1755-1756`).

**Edge cases handled**

- A segment whose remaining part has no block boundary at least 1 MiB from both ends is not split. On very
  large files (block 64 MiB from 64 GiB up, by `blockSize()`), the end game therefore splits more coarsely.
  (By reading the code; no test for this was found.)
- The parts layout gives the new piece its own file named by its start, so no file is ever written past its
  end (`ranged.ts:1298-1300`).
- The stealing connection asks with the same If-Range validator as all others (section 8).

**Proven by**

- Bench "crawl" (one piece at 16 KB/s): at 32.05 s seven Deer connections each took a 2 MiB piece of the
  remaining segment (`bytes=125829120-134217727`, `bytes=132120576-134217727`, ...), so the end game used every
  connection. IDM also splits this way. Deer's overall lead in that scenario (34.2 s vs 45.3 s) came mostly from
  cutting the crawler at 16 s (section 12), which IDM never does.
- `tests/downloads/layout.js`: "With the crawl knob, a steal makes a new part named by its cut" (design 5.3).

---

## 7. Lanes: one network partition per connection

**What it does**

Each connection of a download is guaranteed its own TCP socket. Without this, Firefox would allow only 6
connections per host, and on HTTP/2 servers it would put all requests on one TCP connection.

**How it works**

`makeChannel()` (`net.ts:330-340`, header comment `net.ts:7-12`):

```
if lane given:
  jar = new nsICookieJarSettings
  jar.initWithURI("https://vitre-lane-<lane>[-<gen>].invalid/", isPrivate)
  channel.loadInfo.cookieJarSettings = jar
  channel.allowHttp3 = false
```

- Necko keys its connection pool by host, port **and partition key**. A new partition key means a new pool
  entry: "its own socket, its own 6-per-host budget, its own HTTP/2 session. No global pref is touched."
  (`net.ts:7-12`).
- The lane name must be in the registrable domain: `vitre-lane-3.invalid`, never `lane-3.vitre.invalid`,
  because the partition key is the *site* (scheme + registrable domain). With the wrong form every lane fell
  into one partition (`net.ts:335-336`; `RESULT.md` "Trap I hit first ... server peak 8").
- `gen` (generation): when `tick()` cuts a silent or slow answer, or a server error is retried, the lane's
  generation goes up, so the next request uses a new partition and therefore a new TCP connection, "even
  where HTTP/2 would reuse the session" (`ranged.ts:1662-1664`, `ranged.ts:1400`, `net.ts:270-278`).
- Unpartitioned cookies are not affected, so the right cookies are still sent (verified for the default jar,
  containers, private jars, `net.ts:10-11`).
- Exception: when the download came from a page whose cookie jar is partitioned for **another site** than the
  file's host, the page's jar is kept and no lane is used, so its partitioned cookies are not lost. Such a
  download then shares the pool like a page's request (`net.ts:254-268`, `net.ts:330-332`).
- HTTP/3 is switched off for lanes; HTTP/2 stays allowed ("recipe correction 2", `net.ts:12`). The reason for
  turning HTTP/3 off is not written in the files I read.
- The probe and all proof windows use lane 0 (`ranged.ts:580`, `proof.ts:384`, `:425`, `:518`).
- Two downloads of the same host both number their lanes from 0, so lane 3 of one and lane 3 of the other
  share a pool entry. (By reading the code; not discussed in the docs I read.)

**Why**

- The first spike raised the global pref `network.http.max-persistent-connections-per-server` to 32 while
  downloads ran, and forced HTTP/1.1 with `allowSpdy = false`. Both were compromises: the pref is global (page
  loads also get more connections), and `allowSpdy = false` "does not key the pool at all", so on hosts with
  HTTPS DNS records the first request still went over h2 (`RESULT.md` Compromises 1-2, Refuted).
- The verifier found lanes instead: with the pref left at 6, 16 lanes gave a server peak of 16 (121.9 MB/s),
  32 lanes 32 (204.8 MB/s); without lanes, peak 6 (47.4 MB/s). On mozilla.org, example.com, cloudflare.com,
  wikipedia.org: "lanes, HTTP/2 allowed, HTTP/3 off: h2 x8 | distinct sockets 8/8" (no lanes: 1/8). On
  cdn.kernel.org over h2: 8 lanes 14.3 MB/s, 16 lanes 20.1 MB/s (`RESULT.md` "Improved", claims 7 and 8).
- Also from the verifier: with the pref not raised, asking for more than 6 workers "only churns (16 workers:
  41-42 TCP connections and 54-56 segments for the same 47 MB/s)" (`RESULT.md` Recipe corrections 1).

**Edge cases handled**

- Private browsing: the lane jar is created with the private flag.
- Cut connection: new generation → guaranteed new socket.
- Page-partitioned cookies: lane dropped, cookies kept.

**Proven by**

- `gecko/spikes/downloader/verify/engine/VerifyLanes.sys.mjs` (local peaks, cookie jars, real h2 hosts).
- `tests/downloads/engine.js`: "no global per-host connection pref is set", "each connection has its own
  socket (lanes)".
- Bench: Deer used 8 ports for 8 connections; IDM opened a new TCP connection for every request (ports =
  requests in every scenario).

---

## 8. Validators and If-Range on every request

**What it does**

Every segment request carries `If-Range`, so if the file on the server changed, the server sends the whole
new file (200) instead of a piece of the new file that would be mixed with bytes of the old one.

**How it works**

- Which validator (`ifRange()`, `ranged.ts:545-549`):
  ```
  if etag and not weak (no "W/") and not etagUnstable: use etag
  elif dateUnstable: use nothing
  else: use lastModified (may be "")
  ```
- Every `pull()` sends `Range: bytes=<from>-<to>` and `If-Range` when there is a validator (`ranged.ts:1534-1536`).
- After the head, `validatorsDiffer()` (`proof.ts:158-161`): the ETag decides when both answers have one
  (strong or weak); otherwise Last-Modified does. A difference throws a "header-only" change
  (`ranged.ts:1566`).
- A 200 to a request with If-Range = "the file changed" (header-only); a 200 to a plain Range = "the server
  stopped ranging" (`RangeIgnoredError`) (`ranged.ts:1555-1561`).
- Header-only changes never decide alone when saved bytes can be compared: `downloadTo()` calls `prove()`,
  which fetches 3-4 windows of 64 KiB **without** If-Range and compares them with the `.part`. Same bytes →
  the new validators are adopted and the download goes on (`ranged.ts:945-956`, `held()` at `ranged.ts:823-839`).
- A validator that "slips" twice within `UNSTABLE_WINDOW = 10 min` (`ranged.ts:113`) is no longer trusted
  (`etagUnstable`, `dateUnstable`). Then one window is compared every `SPOT_BYTES = 256 MiB` or
  `SPOT_MS = 5 min` of a run instead (`ranged.ts:115-116`, `spotCheck()` at `ranged.ts:846-865`).
- Each run may make at most `PROOF_GUARD = 8` byte proofs (`ranged.ts:111`), a guard against loops.

**Why**

- A weak ETag can't be used for ranges (RFC 9110 13.1.5; `ranged.ts:540-543`).
- Load-balanced CDNs give different ETags (or dates) on different edges for the same bytes. Treating that as a
  change would stop good downloads; ignoring it would risk mixing files. Comparing bytes settles it (R6 in
  RESUME-DESIGN.md 2.4).
- The prototype restarted from zero on any 200 to If-Range (`VitreRanged.sys.mjs:108-113`), losing all bytes.
  Phase 1 (commit `13f9783`, 2026-10-14) made "never lose or mix bytes" the rule.

**Edge cases handled**

- No validator at all: no If-Range; then a completion check compares 4 windows (block 0, the blocks at 1/3
  and 2/3, the last block) before the file counts as complete (`completionCheck()`, `ranged.ts:1974-1992`).
- A server farm whose backends differ in both ETag and Last-Modified: no If-Range at all, spot checks remain.
- Commit `e20b1ca`: under load every connection met a swapped file's 200 and each counted as a slip before the
  bytes were compared, so If-Range dropped to nothing within one swap. A slip now counts only once bytes proved
  it is the same file. That fix was in the stream engine (`hls.ts`); in the file engine `held()` is called only
  after `prove()` found the same bytes (`ranged.ts:621-623`, `ranged.ts:951-954`; by reading).

**Proven by**

- `tests/downloads/engine.js` section 2: "every request after the resume carries If-Range".
- `RESULT.md`: "pause and resume ... 9/9 requests carried If-Range"; "File changed between pause and resume:
  If-Range answered 200".

---

## 9. Checking each answer before writing

**What it does**

Each segment answer is checked against what was asked. A wrong answer is dropped before any byte is written.

**How it works**

`pull()` (`ranged.ts:1531-1590`), in order:

1. 200 whose `Content-Type` is a web page/JSON/XML/text while the download is a binary file → "not the file"
   (the address expired) (`ranged.ts:1549-1553`; `notFile()` in `proof.ts:194-196`).
2. 200 when this is not the single whole-file segment → header-only change (with If-Range) or
   `RangeIgnoredError` (`ranged.ts:1554-1561`).
3. Any status other than 200/206 → `refusal()` error with its `Retry-After` (`ranged.ts:1562`).
4. ETag/Last-Modified differ → header-only change (`ranged.ts:1566`).
5. For a 206, parse `Content-Range` (`parseContentRange()`, `net.ts:838-844`) and require
   (`ranged.ts:1567-1572`):
   ```
   cr exists
   cr.start == from                  # starts exactly where asked
   cr.end >= cr.start                # not empty or inverted
   cr.end <= to                      # not past what was asked
   cr.total == state.total (if the server states a total)
   ```
   Otherwise `RangeMismatchError`. `servedEnd = cr.end + 1` is kept: the server may legally send less
   (section 13).
6. Only then `stream()` writes.

**Why**

- "An empty or inverted range (end < start) is a mismatch too (review: it looped with no failure)"
  (`ranged.ts:1569`).
- IDM-WAY-DESIGN 3.13: "a mismatch, a page or another total is never written, because each is checked before
  stream()".

**Edge cases handled**

- A different total mid-download: today a `RangeMismatchError`, class "other": 3 tries, then the connection
  leaves (`ranged.ts:1375`, `ranged.ts:1444-1456`). The design's "one confirming probe for a new total" (section
  3.8) is listed as **not built yet** in the design's status header.
- A page instead of the file mid-run: goes the "refused address" way (renewal, standby or Link expired).

**Proven by**

- `tests/downloads/integrity.js` "a file changed mid-download: the connection drops, the next request finds
  another version" (section header; not run here).

---

## 10. Writing the bytes (one `.part`, positional writes)

**What it does**

Each connection writes its bytes at their own offset in one `.part` file, on a background thread. Bytes never
enter JavaScript memory. When the disk is slower than the network, the network is paused.

**How it works**

- `openPart()` (`ranged.ts:974-1023`):
  - clamps each segment's `received` to what the file really holds (`size - seg.start`), so a short or missing
    `.part` rewinds segments instead of trusting them;
  - empties the file only when `allowFresh` is set (first start, Start over, a silent restart);
  - checks room on the disk (section 11);
  - sizes the file to the full total (`setSize()`, `partfile.ts:115-126`: seek + `setEOF`);
  - marks it sparse **before any connection writes** (`sparsePart()`, a worker calling `FSCTL_SET_SPARSE`),
    "otherwise NTFS fills the gap up to a write far into the file with zeros inside that write, and the
    connections there wait minutes on a big file" (`ranged.ts:1012-1016`).
- `Writer` (`gecko/src/modules/downloads/partfile.ts:168-288`), one per answer:
  - its own file output stream, opened write-only and seeked to `seg.start + seg.received`;
  - an `nsIPipe` with `PIPE_SEGMENT = 256 KiB` segments (default 4 KiB "would mean 25,000 syscalls a second at
    100 MB/s", `partfile.ts:20-21`), drained by `NetUtil.asyncCopy` on Necko's stream-transport threads;
  - `write(stream, count)` moves bytes from the channel's stream straight into the pipe (`writeFrom`), on the
    main thread but without copying into JS (`partfile.ts:214-229`).
- The consumer in `stream()` (`ranged.ts:1718-1762`), per chunk:
  ```
  n = min(count, room)
  writer.write(input, n)
  seg.received += n;  env.onBytes(n)        # progress and network byte count
  record per-lane bytes for tick()
  if segment complete: let it end / STOP (section 6)
  wait = throttle(limiters, n); if wait > 0: return {wait}            # speed limit (section 16)
  if writer.backlog > BACKLOG_HIGH (8 MiB):                           # disk back-pressure
     return {until: writer.backlog < BACKLOG_LOW (2 MiB)}             # polled every 10 ms
  ```
  `BACKLOG_HIGH = 8 MiB`, `BACKLOG_LOW = 2 MiB` (`ranged.ts:99-101`).
- After the answer ends, `writer.close()` waits until every byte is on disk; "Nobody may trust seg.received
  until the writer has put every byte in the file" (`ranged.ts:1769-1772`).
- Disk errors (`DiskError`) are never retried and never shown as network problems (`ranged.ts:10-11`,
  `net.ts:81-92`). After a failed write the segment keeps only the bytes certainly on disk:
  `received = base + min(received - base, writer.durable)`, and with a block record, only up to the start of
  the block holding the failed write (`ranged.ts:1773-1779`). After a failure, `durable` = what had left the
  pipe minus `IN_FLIGHT = 2 * 256 KiB` (the chunk the copier may have been writing) (`partfile.ts:22-28`,
  `:268-271`).
- The finished file is made non-sparse before it is moved into place ("Windows refuses to mount a sparse ISO,
  VHD or VHDX", `gecko/src/workers/flush.js:15-16`).

**Why**

- `RESULT.md` risk 2: "the first write near the end of a fresh 2 GiB file took 1.5 s on the writer thread"
  while NTFS zero-filled. `IDM-BENCH.md`: "15 s at 1.5 GB, 47 s at 6 GB on a hard disk; about 10 minutes for
  70 GB". With the sparse mark: 0 s. `flush.js:8-12`: "3.4 s at 35 GB on an NVMe drive; about 7 minutes for
  70 GB on a hard disk".
- IDM writes temp part files and joins them at the end: "about 0.55 s per GB after the last byte (5.25 s for 3
  GB where Deer took 2.62 s writing in place)" (`IDM-BENCH.md`). Writing in place has nothing to do after the
  last byte.
- The verifier found the prototype threw away all of a segment's bytes on a disk error, and retried disk errors
  as network errors ("recipe correction 6", `RESULT.md`). `durable` and `DiskError` fix both.

**Edge cases handled**

- A `.part` shorter than claimed (crash, another program): segments clamped.
- Claimed bytes past the total → "File changed" (`ranged.ts:988-989`).
- A writer that fails to open: the answer is destroyed, the live count is not leaked (`ranged.ts:1704-1710`;
  the verifier flagged the leak in the prototype).

**Proven by**

- `RESULT.md` claim "Writing each segment at its file offset ... UI lag 2-14 ms" (corrected by the verifier:
  the first transfer after startup showed 154-234 ms).
- `tests/downloads/connections.js` checks 1 and 10 (".part is sparse", "finished file is not sparse").
- `tests/downloads/perf.js` (A network only, B disk only, C engine, D unthrottled).

---

## 11. Room on the disk

**What it does**

Before the first byte, Deer checks that the drive has room for what is still missing, plus 16 MiB, plus what
other running downloads on the same drive still need. Without this, "a download on a full disk dies at 100%"
(`ranged.ts:2124`), because a sparse or pre-sized file reserves no space.

**How it works**

- `ensureRoom(dir, bytes)`: free space (`nsIFile.diskSpaceAvailable`) must be ≥ `bytes + 16 MiB`; otherwise
  "Not enough space on the disk. X more is needed." (`ranged.ts:2125-2133`).
- `needed` for a ranged in-place download = `total - heldBytes(.part)` (`ranged.ts:999-1002`).
  `heldBytes()` asks Windows how much disk the sparse file really holds (`GetCompressedFileSizeW`,
  `partfile.ts:145-166`).
- `stillNeeded()` adds, for every other ranged download on the same volume, `total - held` (`ranged.ts:2112-2122`).
- Parts layout: adds the join's peak, the largest part other than part 0 (`ranged.ts:1094-1105`).

**Why**

Commits `e90608e`, `5a6cb80`, `e20b1ca` (2026-10-20/21) fixed three review findings: counting the sized
`.part` as reserved let a second download run out of room midway; then the room was counted twice; then the
question waited behind other downloads' flushes.

**Edge cases handled**

- A `.part` that is emptied gives its room back before the room is counted.
- `\\?\UNC\server\share` paths count as their share (`volumeOf()`, `ranged.ts:2103-2106`).

**Proven by**

- `tests/downloads/connections.js` check 14 ("a fresh download needs room for the whole file", "a second
  download on the same disk counts the room the first still needs, once").

---

## 12. Stall and slow detection (cutting a bad connection)

**What it does**

Every 2 seconds Deer compares each connection's speed with the others. A connection that went silent, or that
crawls far below the others, is cut and asked again at once on a brand-new connection, from the byte where it
stopped. This is not counted as a failure.

**How it works**

Two layers.

Layer 1, the idle timeout in every request (`net.ts:463-484`): `IDLE_TIMEOUT_MS = 30000` (`net.ts:172`). One
timer per idle period, not per chunk. If 30 s pass with no data, the request fails with
`NS_ERROR_NET_TIMEOUT`. A channel suspended by Deer (speed limit, disk) clears the timer, and `resume()`
restarts it, so Deer's own pauses never count as silence (`net.ts:507-525`).

Layer 2, `tick()` every `TICK_MS = 2000` (`ranged.ts:1606-1694`). Constants (`ranged.ts:136-151`):

| Constant | Value | Meaning |
|---|---|---|
| `TICK_MS` | 2000 ms | how often answers are judged |
| `STALL_TICKS` | 5 | 5 ticks = 10 s of silence |
| `SLOW_TICKS` | 8 | 8 ticks = 16 s window for "slow" |
| `SLOW_SHARE` | 0.25 | slow = below a quarter of the others' median |
| `SLOW_FLOOR` | 8 KiB/s | ... or below this, whichever is higher |
| `BUSY_RATE` | 64 KiB/s | the others must run at least this fast |
| `RECUT_GAP` | 60 s | at most one cut per lane per minute |
| `RECUT_MIN` | 256 KiB | do not cut when less than this is left |
| `RECUT_SECS` | 8 s | do not cut when the rest takes under 8 s at its own speed |
| `HELD_SHARE` | 0.5 | a tick in which Deer held the answer > 50% is not judged |
| `BUSY_MEMORY_MS` | 30 s | a lone answer is judged against the last busy median this long |

```
tick():
  for each streaming answer f: push bytes-this-tick and held-ms-this-tick; keep the last 8
  for each lane: push bytes-this-tick across all its answers; keep the last 8      # "reference speeds"
  if any speed limit was binding within the last 16 s:
     clear all windows; return                      # the limit decides the speeds
  laneRate(l) = sum(last 8 ticks) / 16 s, only if the lane has 8 ticks and got some bytes
  if >= 2 lanes have a rate: busy = {median of all, now}
  others(l) = median of the other lanes' rates, or busy.median if taken < 30 s ago, else 0

  STALL, for each answer f:
    needs: first body byte arrived, >= 5 ticks since, all last 5 ticks = 0 bytes,
           not held > 50% of any of those ticks, lane not cut in the last 60 s,
           others(f.lane) >= 64 KiB/s, and some other lane got bytes in its last 5 ticks
    then cut(f, 'stall')

  SLOW, for each answer f:
    needs: first body byte arrived, >= 8 ticks since, not held, others' median M >= 64 KiB/s,
           own rate r < max(8 KiB/s, 0.25 * M),
           left = bytes left in its segment >= 256 KiB,
           left / r >= 8 s, left / r >= 2 * left / M,
           lane not cut in the last 60 s,
           its writer backlog <= 2 MiB (the disk is not the cause)
    then cut(f, 'slow')

  cut(f): lane generation += 1 (new partition = new TCP connection), mark the segment "recut",
          destroy the answer
```

After the cut, `fetchSegment()` sees `AbortedError` with the recut mark, counts it as `stall` or `slow`, resets
the connection's failure counts, and loops at once (`ranged.ts:1352-1363`). The new request starts at
`seg.start + seg.received`.

**Why**

- Commit `7805625` (2026-10-20): "A tester saw big files slow to start and losing speed mid-download where IDM
  stayed steady." IDM 6.43 "never replaces a crawling connection, measured 2026-10-20; it only times out a
  silent one after 30 s" (`ranged.ts:1602-1603`).
- Owner question 1 in `IDM-WAY-DESIGN.md` section 7 kept Deer's cuts over IDM's way: "They are not retries,
  and they cost at most one request per connection per minute. On the bench they were faster: crawl 34.2 s
  against IDM's 45.3 s, stall 34.3 s against 36.6 s."
- The relative rule replaced an absolute one: "a fixed 4 MiB floor kept a crawler on a 3 MiB segment, which then
  decided when the whole download ended" (`ranged.ts:123-126`).
- Speeds are measured per lane across answers, because "per-answer samples went blind on a host that caps each
  answer, and in the end game" (`ranged.ts:1619-1620`).
- Ticks before the first body byte don't count: "a late body was cut as slow" (commit `e90608e`,
  `ranged.ts:1681-1682`).
- No stall cut on a crawling line: "On a crawling line (TLS records arriving seconds apart) silence is left to
  the idle timeout (review)" (`ranged.ts:1670-1672`) — that is what `BUSY_RATE` guards.

**Edge cases handled**

- Speed limit active: nothing is judged; windows restart when it lets go (`limiter.ts` `binding()`).
- Disk slow: held time and writer backlog exclude the answer.
- Whole line slow (all equal): nobody is below a quarter of the median.
- Last answer alone (others finished): judged against the median remembered for 30 s.
- A body that starts 16 s after its head: never cut.
- Cut only when it pays: enough bytes left and far slower than the median would be.

**Proven by**

- `tests/downloads/connections.js` checks 3 (crawler cut within 26 s, new request picks up where the slow one
  stopped, on another port), 6 (silent connection cut after about 10 s; crawler at 8 KB/s cut), 7 (control:
  an even 96 KB/s is never cut), 11 (late body never cut), 2 (control: even connections never cut).
- Bench "stall": the connection went silent after 1 MiB (about 1 s in). Deer cut it 16.1 s after its request
  started; IDM after 30 s. Bench "crawl": Deer cut the crawler at 16.2 s. Why 16 s and not 10 s: the rule needs
  the *other* lanes' speeds, and `laneRate()` gives a speed only for a full 8-tick (16 s) window
  (`ranged.ts:1647-1650`). So, by reading the code, the earliest stall or slow cut in a run is about 16 s after it
  starts; later in a run a silent connection is cut after 10 s.

---

## 13. Capped answers (servers that send less than asked)

**What it does**

Some servers send at most N bytes per answer, even if you ask for more, with a correct `Content-Range` that
ends early. Deer treats that clean, short 206 as normal and asks for the rest at once.

**How it works**

- `pull()` keeps `servedEnd = cr.end + 1` from the 206's `Content-Range` (`ranged.ts:1563-1572`).
- At the end of `stream()` (`ranged.ts:1787-1792`):
  ```
  if segment not complete:
     if servedEnd > 0 and bytes arrived and seg.start + seg.received == servedEnd: return   # capped: fine
     throw ShortBodyError                                                                 # truly cut
  ```
- `fetchSegment()` then loops and asks for the rest; progress resets the failure counts.

**Why**

Commit `7805625`: "a capped 206 continues where it ended."

**Edge cases handled**

- A capped answer that ends early because the connection broke is still a `ShortBodyError` (a "cut").

**Proven by**

- `tests/downloads/connections.js` check 5: a host capping every answer at 8 MiB; each next ask within 0.5 s,
  no failures, sha256 matches.

---

## 14. Retries per connection (IDM's policy)

**What it does**

When one connection fails, only that connection retries; the others go on. Deer never gives up on network
trouble or server errors; it keeps asking like IDM, with different waits for different kinds of failures.

**How it works**

`fetchSegment()` (`ranged.ts:1316-1459`) with `classOf()` and `delayOf()` (`gecko/src/modules/downloads/retry.ts:40-64`).

Progress gate: an answer "made progress" if it brought `PROGRESS_MIN = 1 MiB`, or brought bytes for at least
`PROGRESS_MS = 5 s` (`ranged.ts:150-151`, `ranged.ts:1366-1373`). Progress resets the connection's failure
counts.

| Class | Which failures | Wait before the next ask | Counted? | Where |
|---|---|---|---|---|
| (tick cut) | `tick()` cut it | none | no | `ranged.ts:1352-1363` |
| `cut` | `NS_ERROR_NET_RESET`, `NET_INTERRUPT`, `NET_PARTIAL_TRANSFER`, `NET_TIMEOUT`, `NET_TIMEOUT_EXTERNAL`, `ShortBodyError` | `AT_ONCE_MS = 10 ms` | only without progress | `retry.ts:24`, `:33`, `ranged.ts:1384-1394` |
| `network` | `UNKNOWN_HOST`, `OFFLINE`, `CONNECTION_REFUSED`, `UNKNOWN_PROXY_HOST`, `PROXY_CONNECTION_REFUSED` | 10 ms; while offline at least `OFFLINE_MS = 30 s`, or at once when the network comes back | only without progress | `retry.ts:27`, `:35`, `:177-186` |
| `server` | 408, 425, 5xx except 501, 503, 505 (Cloudflare 520-527, 530 included) | `STEP_MS × k` = 4 s, 8 s, 12 s ... (k counts this class only), or Retry-After if longer; **new lane generation** | yes | `retry.ts:25`, `:53`, `ranged.ts:1395-1404` |
| `refused-start` | 429, 503 | gives its segment back and stands by `4 s × k` (or Retry-After); asks early when "nudged" | yes | `ranged.ts:1405-1412`, `:1219-1242` |
| `refused-address` | 401, 403, 404, 410, 451, expired 400, a page instead of the file | renewal hook; or stand by (`4 s × k`) while another lane got bytes in the last `MOVING_MS = 10 s`; else the run stops (Link expired) | yes | `ranged.ts:1413-1443` |
| `challenge` | Cloudflare challenge/block | not asked again; run stops | — | `net.ts:775-781`, `ranged.ts:1383` |
| `other` | other retryable Necko errors, `RangeMismatchError` | `backoff()`: 2 s, 6 s; after `ATTEMPTS = 3` the connection leaves if another is still active | yes | `ranged.ts:1444-1456` |
| `fatal` | `DiskError`, `ChangedError`, `RangeIgnoredError`, TLS/certificate errors, abort | none: the whole run stops | — | `ranged.ts:1365`, `:1383` |

- `delayOf(cls, k, retryAfter) = max(own, retryAfter)`, own = 10 ms for cut/network, `4000 × max(1, k)`
  otherwise; Retry-After capped at `RETRY_AFTER_MAX = 24 h` (`retry.ts:26`, `:60-64`).
- Every re-ask after a failure also takes a token from a global **pacer**: at most `GLOBAL_RATE = 150` asks
  per second across all of Deer, burst 150, waiters served in order behind one timer (`retry.ts:28`, `:84-142`).
- A "server" retry goes on a new lane generation: "IDM uses a new one for every ask" (`ranged.ts:1396-1397`).
- While a connection waits on a server error, the others may split its segment (`claim()`).

**Why**

- The owner's decision of 2026-10-21, "exactly like IDM" (commit `4bcd891`; `IDM-WAY-DESIGN.md` header).
  Measured on IDM 6.43: reset retried at 0.01 s; a 500 retried at +4, +8, +12 s while others go on; 503
  refusals retried at gaps growing by 4 s without limit (`IDM-WAY-DESIGN.md` section 2).
- Before: "One connection that used up its attempts stopped the whole run" (`IDM-BENCH.md`).
- The 150/s cap: "Necko itself sends a request that was reset at once up to 10 times
  (network.http.request.max-attempts), so in a local outage the server sees about ten times as many: 150 asks a
  second come to about IDM's 1,270 a second (measured 2026-10-21; the main thread showed no lag to speak of up to
  800 asks a second)" (`retry.ts:15-18`).
- Per-class counts: "an outage's thousands of cuts made the next 503 wait for hours" (`ranged.ts:185-187`).
- Not copied, on purpose: IDM's endless ~1,700 requests/s loop when the file's size changed, and its weak
  check after an outage (64 overlapping bytes, no If-Range) (`retry.ts:12-14`).
- Designed but **not built** (the owner chose "Exactly like IDM" over the softer option): per-site token
  buckets (20/s), a 250 ms per-connection floor, holds with scouts, the 20 ms first re-ask of a refused start,
  per-site connection limits and their setting (`IDM-WAY-DESIGN.md` lines 3-21). Section 1 of that design still
  describes the softer rates; the code follows the header.

**Edge cases handled**

- A cut after real progress is not a failure at all.
- Offline (Windows/Firefox says so): one ask per 30 s, at once on "network back" (`retry.ts:144-171`).
- A failure that can't be fixed by asking (blocked port, redirect loop): 3 tries, then the connection leaves;
  the last one ends the run.
- The wall clock stepping back does not stall asks (the pacer uses a monotonic clock, `retry.ts:75-82`).

**Proven by**

- `tests/downloads/connections.js` checks 2 (500 four times: asked again after about 4, 8, 12, 16 s, each time
  from another port), 4 (reset three times: each next ask within 0.5 s), 8 (520), 12 (outage: Retrying within
  about 12 s, at most about 4 asks each in 30 s), 16 (Retry-After 12 honoured), 17 (challenge stops, no ask more
  than 2 s after the first), 18 (resets then 503s: the 503's gap counts only 503s).
- Bench "fail" and "reset" (first-round code): completed, sha OK.

---

## 15. Servers that limit connections (429/503), standby and the nudge

**What it does**

Some sites allow only 2 or 3 connections per user and answer the rest with 503 or 429. The refused connections
give their piece back to the accepted ones, wait, and try again; they get in when a place comes free.

**How it works**

- A 429/503 throws `StandbyError(ms)` out of `fetchSegment()` (`ranged.ts:1405-1412`). The worker releases its
  segment (`owned.delete`), so others can claim it, and marks itself not active (`ranged.ts:1219-1242`):
  ```
  standby:
    active -= 1
    sleep until conn.nextAt, but wake early on: stop, "wake" (a connection found no work left),
                                                 the nudge, or "Try now"
    active += 1
    loop again: claim() a free or split segment
  ```
- **The nudge**: when an answer that brought bytes ends (done, capped, or cut), `pull()` calls `nudge()`, which
  wakes every standing-by connection to ask once (`ranged.ts:1584-1589`, `ranged.ts:1492-1498`). IDM re-sends
  then, because "a place may have come free at the site".
- A nudged ask that is refused again keeps the connection's own schedule and count ("as IDM's scheduled asks did
  through its bursts", `ranged.ts:1327-1329`, `:1406-1409`).
- A 403 (or 404) on one connection while others still receive is read as a per-connection limit, not an
  expired link: that connection stands by on the same 4 s steps instead of stopping the run
  (`ranged.ts:1413-1441`). The run's renewal budget is not spent twice on the same address (`conn.refusedUrl`).

**Why**

- Bench "limit503" (2 connections allowed): IDM 128.6 s with 71 refusals; Deer (first-round code, which retired
  the refused connections) 128.3 s with 6 refusals. "Under a fixed limit this is not faster" (`IDM-WAY-DESIGN.md`
  section 1). The re-asks matter when the limit rises, e.g. when another download from that site ends.
- IDM's measured behaviour: "Bursts of 7 to 9 refusals within 10 ms came only right after an answer that carried
  data ended ... They never came right after a refusal" (`IDM-WAY-DESIGN.md` lines 29-31). Hence: nudge only
  after an answer that brought bytes.
- The design's critique found a storm: "The nudge fired on every answer end, refusals included, so standbys set
  each other off at 4 a second" (`IDM-WAY-DESIGN.md` section 8, Blockers).

**Edge cases handled**

- All connections refused and nothing comes in for 10 s: the row reads "Retrying" while the run keeps asking
  (section 18).
- A finished download never waits for a resting connection (`rouse()`).
- `Retry-After` on a 429/503 is honoured per connection, up to 24 h.

**Proven by**

- `tests/downloads/connections.js` check 15: a site that allows 3 connections; never more than 3 bodies at once,
  the places kept full, the 5 turned away stood by and kept asking in a bounded number of asks (5 to 80), more
  answers than places, completed intact, never paused.
- Check 9: a 404 on one part mid-run: that connection stood by, the download never paused as "Link expired".

---

## 16. The speed limiter

**What it does**

The person can set a speed limit for all downloads together, and one for each download. Deer keeps under both.

**How it works**

`RateLimiter` (`gecko/src/modules/downloads/limiter.ts:6-46`), a token bucket:

```
take(bytes):                         # called after every chunk, on every connection
  rate = kbps() * 1024               # read on every call: a changed setting applies at once
  if rate <= 0: tokens = 0; return 0
  tokens = min(0.5 * rate, tokens + elapsed_seconds * rate)     # at most half a second of burst
  tokens -= bytes
  if tokens >= 0: return 0
  waitedAt = now
  return ceil(-tokens / rate * 1000)  # ms to wait

throttle(limiters, bytes) = max over limiters of take(bytes)
```

- Two limiters per download: the global one (`settings().speedLimitKBps`, `VitreDownloads.sys.ts:707`) and the
  download's own (`rec.limitKBps`, `VitreDownloads.sys.ts:3250-3253`).
- The wait is applied by suspending the channel for that many ms (`{wait}` verdict, `net.ts:577-581`). "While it
  waits its channel is suspended, so Necko stops reading the socket and TCP back-pressure slows the server
  down" (`limiter.ts:2-4`).
- `binding(ms)`: a limit is set and actually made someone wait in the last `ms`. `tick()` uses
  `binding(16 s)` to stop judging speeds while a limit holds them down; "A limit the line never reaches does not
  count" (`limiter.ts:21-27`, `ranged.ts:1628-1638`).

**Why**

- Same logic as the Electron build ("unchanged in logic", `limiter.ts:1-2`).
- The 0.5 s burst: "so short pauses don't add up to a slower average" (`limiter.ts:38`).

**Edge cases handled**

- Setting changed while running: read on every call.
- Several connections share one bucket: all of them pay from the same tokens.
- Stall/slow cuts are off while the limit binds.

**Proven by**

- `RESULT.md`: 256 MB at a 16384 kB/s limit took 15.75 s (1.6% off); 24 MB at 4096 kB/s took 5.26 s (about 14%
  fast because of the half-second burst). Verified again: 15.76 s and 5.25 s.
- `tests/downloads/engine.js` section 3: 256 MiB at 16 MB/s takes between 14.5 s and 40 s, file intact.

---

## 17. Progress, speed, ETA and the connection bar

**What it does**

The row shows bytes received, speed, peak speed, average speed, time left, "N of M active", and an 8-cell bar
of how full each eighth of the file is.

**How it works**

- `received` = sum of `seg.received` over segments (`ranged.ts:488-496`). `seg.received` grows when bytes are
  handed to the writer (not yet on disk).
- `env.onBytes(n)` adds to `rec.netBytes`, the network byte count (`VitreDownloads.sys.ts:3255-3257`).
- Three views of the same counter, for three purposes:
  - **display**: `seg.received`;
  - **what may be saved to the store** (`snapshot()`, `ranged.ts:502-511`): `received - writer.backlog`, so "a
    crash never leaves a segment claiming bytes that didn't reach the file";
  - **what may be read back** for proofs and hashing (`provable()`, `ranged.ts:518-526`):
    `received - written + settled`, where `settled` leaves out the chunk in flight (`IN_FLIGHT`).
- Speed (`VitreDownloads.sys.ts:4493-4516`), every `TICK = 250 ms` (`:258`):
  ```
  samples.push({t: now, bytes: netBytes})
  drop samples older than 3 s, keeping at least 2
  span = (now - first.t) seconds
  speed = span >= 0.5 ? (netBytes - first.bytes) / span : previous speed
  if downloading and no phase: activeMs += min(now - last, 2 * TICK); peak = max(peak, speed)
  ```
  The `2 * TICK` cap means "Slept time is not active time" (`:4498`).
- `average = netBytes / (activeMs / 1000)` once `activeMs >= 250`; `eta = round(left / speed)` when speed > 0
  (`VitreDownloads.sys.ts:4621-4622`).
- The bar: `fileFills(state, 8)` splits the file into 8 equal stretches and reports each one's fill 0..1 from the
  segments (`ranged.ts:2073-2090`). It clamps at the file's end: "a record claiming more bytes than its total
  looped here forever (review of Phase 1)".
- While a replacement single stream is written to `<part>.new` (section 19), `received` shows the larger of the
  saved bytes and the new stream (`ranged.ts:488-491`).

**Why**

- The three counters come from the spike's recipe ("Persist received minus the pipe backlog", `RESULT.md` WRITE)
  and from Phase 5 reviews (`provable()`, `settled`).

**Edge cases handled**

- Sleep/wake: active time grows at most 0.5 s per tick.
- Re-fetched bytes count in `netBytes` (network speed), not twice in `received`.

**Proven by**

- `tests/downloads/engine.js`: "the view reports 8 connections and 8 segment fills".
- `RESULT.md` "Resume after restart from a persisted segment map (after a hard kill and after a normal quit)".

---

## 18. A quiet stretch: "Retrying" and the proof before writing again

**What it does**

When every connection keeps failing and no byte has arrived for 10 s, the row shows "Waiting for network" or
"Retrying · in N s", while the run keeps asking underneath. When the site answers again, Deer first compares one
saved 64 KiB window with the site before writing any new byte.

**How it works**

- `retrying()` (`ranged.ts:1511-1522`): no byte for `HOLD_AFTER_MS = 10 s` (`retry.ts:30`) and every live
  connection failed since → `{for: 'server' if any server/refused class else 'network', tries, nextAt, status}`.
  The engine maps it to a paused-looking row with a wait; the transfer is not stopped.
- `rejoin()` (`ranged.ts:1469-1490`): before the first ask after such a stretch, one window of saved bytes is
  proved against the address (one check at a time; every connection waits for it). Another file → "File
  changed"; a window that can't be compared lets the run go on.
- `poke()` = "Try now": every waiting connection asks at once (`ranged.ts:1500-1505`).

**Why**

- "so a file swapped during an outage is never written into (IDM only compared 64 overlapping bytes, and
  started over from zero on a mismatch)" (`ranged.ts:1463-1465`).
- The design's "hold with scouts" was not built; instead "every connection keeps asking as IDM's do, the row
  reads Waiting for network or Retrying after 10 s with nothing coming in, and the first answer after such a
  stretch is preceded by a proof of one saved window" (`IDM-WAY-DESIGN.md` lines 14-16).

**Edge cases handled**

- The quiet stretch counts from the last byte, the run's start, or the last proof, whichever is latest
  ("a proof that passed with no byte after it covered a second outage", `ranged.ts:1471-1473`).

**Proven by**

- `tests/downloads/connections.js` check 12; `tests/downloads/network.js` "the network goes away", "the site
  answers 503 for 90 s", "Retry-After: 3600" sections.

---

## 19. Servers that do not honour Range

**What it does**

If the server never sends 206, Deer downloads with one connection, from the start. If a server stops honouring
Range in the middle of a ranged download, Deer switches to one stream without losing the saved bytes until the
new stream proves to be the same file.

**How it works**

- Probe got 200 → `ranges = false`, the probe's own answer is the download (section 2).
- `runSingle()` (`ranged.ts:1801-1838`), nothing saved: write straight into the `.part` from 0. A failure starts
  again from 0 (no Range possible), up to `ATTEMPTS = 3` with `backoff()` 2 s, 6 s.
- Mid-download 200 to a plain Range → `RangeIgnoredError` → `downloadTo()` sets `ranges = false` and goes on
  with the single stream; the segments stay (`ranged.ts:939-944`).
- `replaceSingle()` (`ranged.ts:1855-1912`), when bytes are already saved:
  ```
  saved = first min(received, 64 KiB) bytes of the .part
  res = GET without Range (must be 200)
  if page where a file was: NotTheFileError
  if res total known and != stored total: ChangedError("was X, now Y")
  write the whole answer to "<part>.new", comparing its first bytes with `saved` as they arrive
  if it starts like a page where saved bytes did not: NotTheFileError
  if any byte differs: ChangedError
  at the end: must be at least as long as saved, and the same total
  move "<part>.new" over the .part; adopt its validators and checksum
  any failure: delete "<part>.new", the .part stays untouched
  ```
- A download whose length was never known continues by Range only when If-Range or a byte proof says it is the
  same file; otherwise it stays a single stream ("bytes that never arrived would complete the file",
  `ranged.ts:745-758`, `ranged.ts:913-915`).

**Why**

- RESUME-DESIGN Phase 1, "never lose or mix bytes" (`ranged.ts:13-30`). The prototype simply dropped all
  segments and started over (`VitreRanged.sys.mjs:202-207`).

**Edge cases handled**

- A 200 without Content-Length: length learned at the end.
- A 200 shorter than the saved bytes: "it is shorter than the X saved" (ChangedError).

**Proven by**

- Bench "norange": IDM 32.1 s, Deer 32.3 s, one request each.
- `RESULT.md` "Servers without Range support".
- `IDM-WAY-DESIGN.md` 5.3 lists a replaceSingle test under the parts layout (the norange knob on resume).

---

## 20. The file changes on the server mid-download

**What it does**

If the file on the server is replaced while Deer downloads it, Deer never mixes old and new bytes. With 1 MiB or
less saved, it quietly starts again (at most twice in 10 minutes). With more saved, the row stops and asks the
person (Start over / Keep partial file).

**How it works**

- Signs of a change: a 200 to If-Range, other validators, another total, a different whole-file checksum, other
  bytes in a compared window, a released block that hashes differently.
- `downloadTo()` (`ranged.ts:945-960`):
  ```
  on ChangedError:
    if only headers said so: prove() with saved bytes; same bytes -> adopt new validators, continue
    if restartSilently(): probe again and start from nothing
    else: stop; the row asks
  ```
- `silentRestart()` (`ranged.ts:363-368`): allowed only if saved ≤ `ASK_ABOVE = 1 MiB` (`proof.ts:29`) and fewer
  than `SILENT_RESTARTS = 2` restarts in `RESTART_WINDOW = 10 min` (`ranged.ts:104-105`).
- "every connection closed its writer, so the counts are exact and the .part is as it was" (`ranged.ts:946-947`).

**Why**

- The owner's decision of 2026-10-13 (`ranged.ts:23-24`). Not copied from IDM: its "endless loop when the file's
  size changed" (about 1,700 requests a second, it never finished) and its restart from zero after comparing 64
  bytes (`IDM-WAY-DESIGN.md` section 2).

**Edge cases handled**

- CDN edges with different ETags for the same bytes (R6, section 8).
- A record whose segments claim more than the new total: "now X, but Y were already saved".

**Proven by**

- `RESULT.md` "File changed between pause and resume: If-Range answered 200, restarted from zero, 24.0 MB
  refetched, sha OK" (prototype behaviour); `tests/downloads/integrity.js` sections on swaps.

---

## 21. Completion checks

**What it does**

A download counts as complete only when every segment is complete, the file is exactly the promised size, and
any checksum the server gave matches.

**How it works**

- `verify()` (`ranged.ts:1919-1961`):
  - every segment `start + received == end`, and the sum equals the total ("a stretch that never arrived (zeros
    under a file sized to its total) is never completed, whatever the file's size says");
  - the file size on disk equals the total;
  - a server digest (sha-256 from `Repr-Digest`/`Digest`, or `Content-MD5`): computed over the file (md5 in
    4 MiB pieces). On a mismatch, bad blocks are found through the hash record and fetched again, at most once
    per run; otherwise "The finished file doesn't match the server's checksum."
- `completionCheck()` when there is no strong validator and no digest: 4 windows compared with the site
  (`ranged.ts:1974-1992`). Anything that can't be compared lets the file complete.

**Why**

- A sparse or pre-sized file always "has the right size"; only the segment record tells if all bytes arrived.

**Edge cases handled**

- The address refuses at the very end (a one-use link): the completion check does not fail the file.

**Proven by**

- Every test checks sha256 of the result; `tests/downloads/integrity.js` "Content-MD5" section.

---

## 22. IDM's layout on drives without sparse files (parts + join)

**What it does**

On exFAT, FAT32 and network shares without sparse files, writing far into a file makes Windows zero-fill
first. There, Deer keeps the download as IDM does: one file per part, each written only at its own end, then
joined after the last byte.

**How it works**

- Layout chosen when nothing is claimed yet (`chooseLayout()`, `ranged.ts:1030-1048`): `volumeInfo()` asks
  `GetVolumeInformationW` in its own worker (timeout 10 s, cached 60 s, `parts.ts:76-125`); no sparse flag
  (`0x40`) → parts (`parts.ts:133-138`). FAT has a 4 GiB − 1 file limit: a bigger file is refused before
  anything is written (`ranged.ts:1037-1039`).
- Files: `<name>.part` for the part at byte 0; `<name>.parts/<start in hex>.part` for each other part
  (`parts.ts:24-39`). Each segment has `base` = the start of its file; local offset = `start - base`.
- A steal makes a new part named by its cut (`ranged.ts:1298-1300`).
- Invariants (`IDM-WAY-DESIGN.md` 4.1): a write never starts past its file's end; parts never overlap.
- `openParts()` clamps each segment by its own file and gives a piece a new file if its part got shorter than
  where it starts (crash), deletes orphan part files (`ranged.ts:1056-1111`).
- Join (`joinParts()`, `parts.ts:201-249`): walk from byte 0; copy each part to its place in the `.part` in
  `JOIN_STEP = 8 MiB` steps (`parts.ts:187`) in a worker; flush; clear the segments' `base`; save the state
  (flushed); then delete the part (8 tries × 500 ms, `parts.ts:252-262`). Every state between steps is valid,
  so a pause, quit or crash in the middle loses nothing. The row shows "Saving".

**Why**

- The owner's decision of 2026-10-21 (commit `8cc3c05`; `IDM-WAY-DESIGN.md` section 4). Measured on IDM: 9 part
  files for 8 connections, joined after the last byte (1 GiB in 0.8 s on an SSD).
- Parts live beside the target, not under `%APPDATA%` like IDM, so room is checked on the chosen drive and part 0
  is never copied (owner question 13).

**Edge cases handled**

- A crash after a copy but before the checkpoint: the step runs again (same bytes at the same place).
- A crash after the checkpoint but before the delete: an orphan, deleted at the next start.
- Foreign files in `.parts` are never deleted.

**Proven by**

- `tests/downloads/layout.js` (12 checks) and `all.py --layout parts` (the whole suite on the parts layout).

---

## 23. HTTP/2 vs HTTP/1.1: what changes

**What it does**

Deer gets real parallel TCP connections on both protocols, and keeps connections reusable when it can.

**How it works**

- HTTP/1.1: one request per connection at a time. Firefox allows 6 per host per pool entry. Lanes give each
  connection its own pool entry, so 8, 16 or 32 work without touching the global pref (section 7).
- HTTP/2: without lanes, all requests to one host share one TCP connection. With lanes, each lane has its own
  h2 session, so its own TCP connection.
- HTTP/2 stays allowed; HTTP/3 is off for lanes (`net.ts:365`).
- Each request asks for exactly its segment's end and lets the answer finish by itself, "so the connection is
  kept alive for the next segment" (`ranged.ts:1755-1757`). Only a split forces an early cut. (General HTTP/1.1
  fact, not written in the code: cancelling an answer mid-body closes its TCP connection.)
- A cut for stall/slow, or a server-error retry, bumps the lane generation, so the next request is on a new
  connection even on h2, where Necko would otherwise reuse the same session (`ranged.ts:1663`, `:1400`).
- Each lane's last protocol and time-to-head are kept in diagnostics (`ranged.ts:1546-1547`).

**Why**

- Measured without lanes: 1 of 8 requests got its own socket on h2 hosts; with lanes 8 of 8. Real CDN over h2:
  8 lanes 14.3 MB/s, 16 lanes 20.1 MB/s, one connection 3.3 MB/s (`RESULT.md`).
- Forcing HTTP/1.1 (`allowSpdy = false`) was tried and dropped: it "does not key the pool", and hosts with HTTPS
  DNS records still answered the first request with h2 (`RESULT.md` Refuted, Recipe corrections 2).
- The reason for switching HTTP/3 off is not written in the files read.
- Reusing connections saves a TCP and TLS handshake per segment. On the bench, Deer used 8 or 9 ports for 9 to 20
  requests; IDM used one port per request.

**Edge cases handled**

- Hosts that only speak h2: covered by lanes ("This also covers servers that only speak h2", `RESULT.md`).

**Proven by**

- `VerifyLanes.sys.mjs` `real()` step on mozilla.org, example.com, cloudflare.com, wikipedia.org.

---

## 24. Waits outside a run

**What it does**

When a download was stopped by a quit, a crash, sleep, or a check that could not reach the site, it continues by
itself later.

**How it works**

`gecko/src/modules/downloads/waits.ts`:

- `QUEUE_RETRY = 30 s` between tries of a network or server wait ("IDM's queue rhythm", `waits.ts:24-25`);
  never before the server's Retry-After, at most 24 h (`waits.ts:31`, `:54-57`).
- `SOON = 5 s`: network link-up or wake brings the next try this close (`waits.ts:27`).
- `SERVER_GIVE_UP = Infinity`: a failing server no longer ends a download after 24 h (`waits.ts:28-29`).
- `FRESH_AFTER = 8 MiB`: a run that saved this much more resets the wait's count (`waits.ts:33`).
- `WAKE_SETTLE = 10 s`, `SLEEP_FALLBACK = 1 min`, `CONTINUE_AFTER = 10 s` after the first window opens
  (`waits.ts:35-42`).
- `SUSPECT_TAIL = 8 MiB`: before the block record, after an unclean session each segment gave back its last
  8 MiB to be fetched again (`waits.ts:43-48`, `rewindTails()` `:63-71`).

**Why**

- The owner's decision of 2026-10-21: "it was 10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min" and failed
  after 24 h; now every 30 s without limit (`waits.ts:7-13`).

**Edge cases handled**

- Sleep: the row continues after wake when the network is back, or 10 s after.

**Proven by**

- `tests/downloads/network.js` (sleep and wake, quit, crash runs).

---

## 25. The IDM benchmark (2026-10-20)

**What it does**

A local server measured IDM 6.43 and Deer on the same scenarios, from the server's side.

**How it works**

- `idm-bench/server.py`: port 47995, deterministic bytes by offset (a 1 MiB + 7 random pattern), knobs: `rate`
  (per-connection KB/s), `ttfb`, `slow`, `stall`, `fail`, `reset`, `maxconn` + `limit=503|429|close`,
  `expire`, `norange`, `nolength`, plus `/swap` (silent/dated/size) and `/outage`. Every request is logged with
  arrival, head and end times, port, range, status, bytes sent, outcome.
- `bench.py`: IDM driven through its COM API (`SendLinkToIDM` flag 1); Deer through `tools/run.py` + `deer_run.js`.
  Metrics: total time, requests, distinct ports, max concurrency per second, throughput per second, sha256.

**Results** (256 MiB at 1 MB/s per connection unless named; seconds from first request to done;
`IDM-BENCH.md`, `results-2026-10-20.jsonl`):

| Scenario | IDM | Deer | Note |
|---|---|---|---|
| plain, 8 connections | 33.3 | 32.2 | IDM ramps 5 → 8; Deer 8 from the start |
| ttfb 2 s per answer | 40.3 | 36.1 | IDM 20 requests (new connection per split) |
| crawl (one part 16 KB/s) | 45.3 | 34.2 | IDM keeps the crawler; Deer cuts it |
| stall (silent after 1 MiB) | 36.6 | 34.3 | IDM cuts at 30 s, Deer at 10 s |
| fail (500 four times) | 37.1 | 35.1 | |
| reset (3 resets) | 33.1 | 33.2 | |
| limit503 (2 allowed) | 128.6 | 128.3 | IDM 71 refusals, Deer 6 (first-round code) |
| expire (403 for 20 s) | 32.8 | 32.1 | |
| norange (128 MiB, 4 MB/s) | 32.1 | 32.3 | one connection each |
| fast (1 GiB, no cap) | 1.74 | 1.28 | IDM peaked at 5 connections |
| big (3 GiB, no cap) | 5.25 | 2.62 | IDM joins temp parts after the last byte |

What IDM does, seen in the log:
- First request: plain GET without Range; it reads about 228-240 KB, then cuts the connection.
- Splits the largest remaining part in half, 4 connections at once, 8 by about 1.2-2 s.
- Parts overlap by 64 bytes (e.g. one request ends at 134,342,782, the next starts at 134,342,719).
- Every request is a new TCP connection.
- 500: same spot after 4, 8, 12 s. Reset: at once. Silent: cut at 30 s. Crawler: never replaced.
- 503 cap: keeps asking; bursts of refusals right after a data answer ends.

**Why**

- A tester found Deer slow to start big files and losing speed mid-download (`IDM-BENCH.md`, commit `7805625`).
  The bench led to: the sparse `.part`, the stall/slow cuts, fast retries, capped-206 handling, then (10-21) the
  IDM retry policy and the parts layout.

**Edge cases handled**

- IDM hijacks `firefox.exe` processes on that machine; the bench server avoids file extensions and closes IDM
  dialogs (`RESULT.md` Risks 1).

**Proven by**

- The JSONL file itself (every run sha OK).

---

## 26. History: from the prototype to today

**What it does**

Not a mechanism: this table shows how each rule above grew out of the verified prototype, so the reasons are
easy to find.

**How it works**

| Topic | Prototype (`verify/engine/VitreRanged.sys.mjs`) | Today (`ranged.ts`) | Why it changed |
|---|---|---|---|
| Many connections per host | First spike: global pref raised to 32 while downloading, `allowSpdy=false`; the verify copy added an optional `lanes` switch | Lanes always (own partition per connection) | Global pref affected page loads; h2 still multiplexed (`RESULT.md`) |
| Plan and split | Exact equal share, exact middle | Block-aligned (1-64 MiB), `MIN_STEAL` 1 MiB | Block hash record (Phase 5) |
| 200 to If-Range | Forget all, start over | Prove with saved bytes; adopt validators if same | Never lose bytes (Phase 1) |
| Disk write error | Retried as network; whole answer's bytes discarded | `DiskError`, never retried; durable bytes kept | Recipe correction 6 |
| Refused connections (503) | Step aside for good if never accepted | Stand by, re-ask on 4 s steps and on nudges | Owner decision 2026-10-21 |
| Retries | 3 failures per segment (gaps 2 s, 6 s), a retry with progress resets to 1 | Classes (section 14), unlimited for cut/network/server | IDM measurements |
| Slow/silent connections | Only the 30 s idle timeout | `tick()` cuts after 10 s / 16 s | Bench 2026-10-20 |
| Capped 206 | ShortBodyError | Continue at once | Bench 2026-10-20 |
| Server ignores Range mid-run | Drop segments, start over | Side file `.new`, compare, replace when complete | Phase 1 |
| Room | `ensureRoom(total - size)` | Sparse-aware, counts other downloads | Reviews 10-20/21 |

**Why**

The commit bodies give the reasons: `13f9783` (Phases 1-2, never lose or mix bytes), `31eed88` (Phase 5, block
record), `7805625` (connections that keep up, IDM comparison), `e90608e` / `5a6cb80` / `e20b1ca` (room and review
fixes), `4bcd891` (ask again as IDM does), `8cc3c05` (IDM's part files on drives without sparse files).

**Edge cases handled**

See each section above.

**Proven by**

`RESULT.md` "Independent verification" for the prototype; the tests named in each section for today's code.

---

## Lessons worth copying

Ranked by value for an iOS/iPadOS browser. iOS facts marked "(unverified)" were not checked against Apple
documentation in this study.

1. **Make sure "N connections" are really N TCP connections.** On HTTP/2 a client multiplexes everything to a
   host on one connection, so 8 parallel range requests can share one TCP stream and gain little. Deer gives
   each connection its own pool entry (a lane) and gets 8/8 sockets on h2 hosts. On iOS, the likely equivalent
   is one `URLSession` per lane, since each session keeps its own connection pool (unverified), and bumping to a
   fresh session when a connection is cut. Measure with `URLSessionTaskMetrics` (protocol name, local/remote
   ports).
2. **Work stealing with a minimum piece size.** A finished connection takes the second half of the biggest
   running piece (block-aligned, at least 1 MiB on each side). The running answer is told to stop at the new end.
   No connection sits idle while bytes are left, and the slowest piece is shared out at the end (bench "crawl":
   seven connections each took 2 MiB of the last piece).
3. **Cut stalled and crawling connections relative to the others' median**, not by fixed numbers: silent 10 s
   while others run ≥ 64 KiB/s; or 16 s below max(8 KiB/s, 25% of median) with ≥ 256 KiB and ≥ 8 s left and more
   than 2× the median time. Never judge time the app itself paused (speed limit, disk). Re-ask at once, on a new
   connection, from the last byte; it is not a failure. This is where Deer beat IDM most clearly (crawl 34.2 s vs
   45.3 s; stall 34.3 s vs 36.6 s).
4. **Check every 206 before writing**: start equals asked, end ≤ asked and ≥ start, total unchanged, validators
   unchanged, not an HTML/JSON page where a binary file was. A 200 to If-Range means "changed"; a 200 to a plain
   Range means "stopped ranging".
5. **If-Range on every ranged request, with a strong ETag or else Last-Modified** (never a weak ETag). Let saved
   bytes decide when only headers differ (CDN edges disagree on ETags).
6. **Probe with `bytes=0-0` (fresh) or `bytes=0-65535` + If-Range (resume)**; detect range support only by a real
   206 with a total; if the answer is a 200, reuse it as the download (no second request).
7. **Persist only bytes that are on disk.** Display `received`, but save `received − bytes still queued for
   writing`, and after a write error keep only the proven-written part.
8. **Retry by class, per connection**: cut → at once (if it made progress, not even a failure); 5xx → same spot
   after 4 s × k on a new connection; 429/503 → give the piece back, stand by 4 s × k, re-ask when another answer
   with bytes ends; honour Retry-After; cap all re-asks globally (Deer: 150/s). One failing connection never stops
   the others.
9. **Ask for exactly the segment end**, so the answer ends cleanly and the connection is reusable; only cut when a
   split moved the end. Treat a clean, short 206 (capped host) as normal and continue at once.
10. **Speed limit as a shared token bucket with 0.5 s burst, applied by pausing the stream**, global plus per
    download, and switch off stall detection while it binds.
11. **Disk back-pressure**: pause the network when 8 MiB wait to be written, resume under 2 MiB.
12. **When the server stops ranging mid-download**, write the new full answer to a side file, compare its first
    64 KiB with saved bytes while streaming, and replace only when it is complete and the same length.
13. **One file per part, joined at the end, is a valid layout when in-place writes are expensive or impossible**,
    and the join can be made crash-safe with small steps and a saved state after each part. On iOS this matches
    background `URLSession` download tasks, which each produce their own file (see below).
14. **Check disk room before the first byte** (missing bytes + margin + what other running downloads still need).
15. **After 10 s of total failure, prove one saved window before writing again**, so a file swapped during an
    outage is never written into.

## Not worth copying / Windows-only

- **NTFS sparse marking (`FSCTL_SET_SPARSE`), unsparse before moving, `GetCompressedFileSizeW`, the volume
  query and the FAT32 4 GiB limit**: Windows file-system problems. iOS app storage is APFS, which supports sparse
  files natively (unverified that `FileHandle.truncate(atOffset:)` growth stays sparse; worth a quick test). The
  parts layout's *reason* (zero-fill) does not apply on APFS; its *shape* is still useful for background tasks.
- **Necko details**: suspended channels and `onStopRequest`, re-applying headers in `asyncOnChannelRedirect`,
  `cookieJarSettings` partition tricks, `allowHttp3`, `LOAD_BYPASS_SERVICE_WORKER`, system-principal Referer
  trimming, `applyConversion`. On iOS the problems differ (cookie copying from `WKHTTPCookieStore`, redirects via
  `URLSessionTaskDelegate`), though "set `Accept-Encoding: identity` for range requests" remains a good idea
  (unverified how URLSession treats an explicit value).
- **The pipe + `asyncCopy` writer**: it exists to keep bytes out of Gecko's JS heap and disk I/O off the main
  thread. In Swift, a background actor or serial queue writing with `FileHandle` at offsets does the same.
- **The 150 asks/second main-thread budget** reasoning is Gecko-specific; a global cap on re-asks is still wise
  for politeness and IP bans.
- **IDM's own habits that Deer rejected**: first GET without Range, a new TCP connection for every part, 64-byte
  overlaps, ~1,270 requests/s during an outage, the endless loop on a size change, temp parts in a profile folder.
- **Firefox take-over** (cancel Firefox's download, probe, restart with Deer's engine) and the queue's
  `MAX_ACTIVE = 2`: product choices tied to Firefox; on iOS the equivalent decision point is
  `decidePolicyFor navigationResponse`.
- **js-ctypes workers** for flushing and copying.
