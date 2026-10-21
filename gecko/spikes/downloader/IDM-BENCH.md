# IDM 6.43 compared with Deer's downloader (2026-10-20)

A tester found Deer slow to start big files (a game, not video) and losing speed mid-download where IDM
stayed steady. This records what IDM 6.43 build 12 (the owner's registered copy) was seen doing on a local
bench, what Deer changed, and how both did afterwards. The connection rules themselves are in
`src/modules/downloads/ranged.ts` (top of file and `tick()`); `tests/downloads/connections.js` holds them.

## Bench

`spikes/downloader/idm-bench/`: `server.py` (port 47995, deterministic bytes, a per-connection rate and
fault knobs, a request log with the time each answer started and ended), `bench.py idm|deer <scenario>
"<knobs>"` (one run, metrics from the server's log, sha256 checked), `run_all.py` (every scenario, IDM then
Deer). IDM is driven through its COM API (`IDMan.CIDMLinkTransmitter`, `ICIDMLinkTransmitter2.SendLinkToIDM`
flag 1, via comtypes): `IDMan.exe /d` is ignored while IDM is already running. Deer runs
`tools/run.py --app build-downloads` with `deer_run.js`. Each IDM run leaves a `deer-bench-*` row in IDM's
list. `results-2026-10-20.jsonl` is the run below.

## What IDM does (observed)

- First request is a plain GET with no Range. It keeps about 228 KB of that answer, then splits the largest
  remaining part in half, in two waves: 4 connections at once, 8 by about 1.2-2 s. Parts overlap by 64 bytes.
- A connection is never reused: every part is a new TCP connection (ports = requests in every scenario).
- A 500 on one part: that part is asked again at the same place after 4, 8 and 12 s while the others go on.
- A reset mid-body: asked again at once (0.01 s), no back-off.
- A silent connection is cut at 30 s. A crawling one (16 KB/s among 1 MB/s ones) is never replaced; the
  others finish their parts and split the crawler's remainder, so it keeps a tail to the end.
- A server that allows 2 connections and answers the rest 503: IDM keeps asking (71 refusals in 128 s).
- Joining the temp parts into the file costs about 0.55 s per GB after the last byte (5.25 s for 3 GB
  where Deer took 2.62 s writing in place).

## What was slow in Deer, and what changed

- **Start of a big file.** The .part is sized to the whole file and written at many places; NTFS fills zeros
  from the valid data length up to each write beyond it, inside that write (15 s at 1.5 GB, 47 s at 6 GB on
  a hard disk; about 10 minutes for 70 GB). The .part is now sparse (`FSCTL_SET_SPARSE`, `workers/flush.js`):
  0 s. The finished file is made non-sparse before it is moved into place (Windows will not mount a sparse
  ISO, VHD or VHDX).
- **Speed lost mid-download.** One connection that used up its attempts stopped the whole run (G4 wait).
  It now steps aside (10, 20, 40, 60 s) while another connection received bytes in the last 10 s; a part
  refused with a definite answer (403/404/410 on one connection while others stream) retires that
  connection only; only the last connection reports the refusal.
- **Crawling or silent connections.** Every 2 s each answer's rate is compared with the median of the other
  connections (`tick()`): silent for 10 s, or under a quarter of the median for 16 s with more than 8 s of
  its own part left at its rate, and the part is cut there and asked again on a new connection (another network
  partition). Not while the speed limit or the disk holds it, and not when the whole line is slow.
- **Retry gaps.** A reset or timeout after bytes arrived is asked again after 100 ms with no failure counted
  (it waited 2 s every time). Cloudflare's 520-527 and other 5xx (not 501/505) are retryable per connection.
- **Capped answers.** A 206 shorter than asked (some servers cap each answer) continues from where it ended.

## Results (256 MiB at 1 MB/s per connection unless named; seconds from the first request to done)

| Scenario | Knobs | IDM | Deer | Notes |
|---|---|---|---|---|
| plain | 8 connections | 33.3 | 32.2 | |
| ttfb | 2 s before every answer | 40.3 | 36.1 | IDM: 20 requests (new connection per split) |
| crawl | one part at 16 KB/s | 45.3 | 34.2 | IDM keeps the crawler; Deer cuts it |
| stall | one connection silent after 1 MiB | 36.6 | 34.3 | IDM cuts at 30 s, Deer at 10 s |
| fail | one part 500 four times | 37.1 | 35.1 | |
| reset | one part reset 3 times | 33.1 | 33.2 | |
| limit503 | 2 connections allowed, rest 503 | 128.6 | 128.3 | IDM 71 refusals, Deer 6 |
| expire | 403 for 20 s mid-download | 32.8 | 32.1 | |
| norange | no Range support | 32.1 | 32.3 | one connection each |
| fast | 1 GiB, no rate cap | 1.74 | 1.28 | |
| big | 3 GiB, no rate cap | 5.25 | 2.62 | IDM joins its parts after the last byte |

Every file's sha256 was right. Deer's first request comes about 2 s after launch because `tools/run.py`
starts the browser; the times above start at each app's first request. The bench ran on the first round
of changes (sparse .part, step-aside, the 2 s check); the second round (fast retry, 52x, single-part
refusals, diagnostics in `transferInfo().diag`) is held by `tests/downloads/connections.js`.

## Not copied from IDM

- The first GET without Range (Deer asks bytes=0-0 first, a resume bytes=0-65535: size, range support and
  validators before any connection opens).
- New connection per part (Deer keeps a connection's partition between parts unless it was cut).
- Hammering a server that refuses extra connections (a refused Deer connection leaves; the others go on).
- Joining temp files (Deer writes in place, so nothing is left to do after the last byte).
