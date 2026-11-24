# Integrity, resume, retries and durable writes

## In one paragraph

Deer never lets a server's headers alone decide that a half-downloaded file is still the same file. Before it adds
new bytes to saved ones, it compares a few 64 KiB "windows" of the saved bytes with the server's bytes at the same
places: this is the **same-file proof**. While it downloads, it hashes the file in blocks of 1 to 64 MiB and keeps the
hashes in an append-only journal in the browser profile (the **block hash record**, or ledger). After a crash, a power
loss, a disk error or another program writing into the file, the record shows exactly which blocks are bad, and only
those are downloaded again. The saved download list never claims a byte that has not reached the file. Every 30 s
(or 256 MiB), and at every stop, Deer **seals** the file: it forces the file's cached data to the physical disk
(FlushFileBuffers), writes a journal line saying what is covered, and saves the list. A "session clean" flag tells a
crash from a normal quit. Failures are retried **like IDM** (the owner's decision of 2026-10-21): a cut connection is
asked again at once, a site error after 4 s, 8 s, 12 s ... without limit, a connection the site turns away steps aside
and asks again later. All of Deer is capped at 150 retries a second, and after 10 s with no byte the first new answer
is proved against the saved bytes before anything is written. When a signed link expires, Deer reads the expiry time
from the link itself, asks the original link and its redirect hops again, proves the new address, and continues under
the same file name. When the file on the site really changed, Deer stops and asks the person (if more than 1 MiB is
saved). At the end it checks the length and any server checksum, compares a few windows if the server gave no strong
validator, clears the sparse mark, renames `.part` to the real name, asks Safe Browsing, writes the Mark of the Web,
and keeps the block record so that "Check file" and "Repair" work later.

## Files

Files of this section (all read in full):

| File | Role | Lines |
|---|---|---|
| `gecko/src/modules/downloads/proof.ts` | The same-file proof: verdicts R1-R7, the choice of 64 KiB windows, fetching and comparing them | 611 |
| `gecko/src/modules/downloads/ledger.ts` | The block hash record (ledger) and its append-only journal; block hashing; seals; flush/sparse calls into the worker | 910 |
| `gecko/src/modules/downloads/partfile.ts` | Writing bytes at their offset off the main thread (`Writer`), knowing which bytes are certainly on disk; reads by offset; room and size helpers | 288 |
| `gecko/src/workers/flush.js` | ChromeWorker with Windows calls: FlushFileBuffers, set/clear sparse, volume info, the part-file copy | 142 |
| `gecko/src/modules/downloads/retry.ts` | The retry policy "like IDM": failure classes, waits, the global 150/s pacer, network-back signal | 186 |
| `gecko/src/modules/downloads/renew.ts` | Renewing an expired address: which addresses to ask, the schedule, adopting a proven address, the in-run single-flight gate | 163 |
| `gecko/src/modules/downloads/expiry.ts` | Reading a signed URL's expiry time from its query parameters | 71 |
| `gecko/src/modules/downloads/attach.ts` | Matching a download started again on its page to a waiting row; "Keep partial file" helpers | 185 |
| `gecko/src/modules/downloads/finished.ts` | Finished files: Check file, Repair, Restore original, site compare for old files, ffmpeg media check | 429 |
| `gecko/src/modules/downloads/reputation.ts` | Safe Browsing (Firefox's application reputation) for files Deer fetched itself; launch prompt for scripts | 144 |
| `gecko/spikes/downloader/RESUME-DESIGN.md` | The approved resume design (2026-10-12, approved 2026-10-13): goals, verdicts, ledger, decisions 1-14 | 817 |
| `gecko/spikes/downloader/verify/engine/VitrePartFile.sys.mjs` | The prototype writer that `partfile.ts` ports (one commit, 5557e72 "Deer 0.1.0") | 135 |

Supporting code read in the parts that use the files above (not in full): `gecko/src/modules/downloads/ranged.ts`
(2138 lines; probe, prove, retry loop, openPart, verify, completion check, room), `gecko/src/modules/downloads/parts.ts`
(314, read in full), `gecko/src/modules/downloads/waits.ts` (71, read in full), `gecko/src/modules/downloads/net.ts`
(error classes, retry helpers), `gecko/src/modules/VitreDownloads.sys.ts` (load, runFile, inspect, seal, finish,
stopped, renewal, Start over, Keep partial, store save), `gecko/src/modules/downloads/hls.ts` (the hedge and the
validator-slip proof only), `gecko/spikes/downloader/IDM-WAY-DESIGN.md` (sections 1-3.10 and 4.1-4.7),
`gecko/spikes/downloader/IDM-BENCH.md`, `gecko/spikes/downloader/RESULT.md` (verifier corrections), and the check
names of `gecko/tests/downloads/*.js`.

## Words used here

- **Range request**: an HTTP request with the header `Range: bytes=A-B`, asking only for bytes A to B (both included).
- **HTTP 206 (Partial Content)**: the answer when the server sends only the range. It carries `Content-Range: bytes A-B/TOTAL`. **HTTP 200** means the server sent the whole file instead (it ignored the Range). **HTTP 416** means the range is outside the file.
- **Validator**: a value the server gives that changes when the file changes. **ETag** is an opaque tag (`"abc"`, strong; `W/"abc"`, weak). **Last-Modified** is a date. Only a strong ETag may be used for ranges (RFC 9110 13.1.5).
- **If-Range**: a header carrying a validator. It means "send me the range only if the file still has this validator; otherwise send the whole file (200)".
- **Digest headers**: `Repr-Digest` / `Digest` (`sha-256=<base64>`) and `Content-MD5`: a checksum of the whole file the server may volunteer.
- **Segment**: one stretch `[start, end)` of the file that one connection fills. `received` is how many bytes from its start are saved. Its **frontier** is `start + received`, the next byte it needs.
- **`.part` file**: the unfinished file on disk, named `<name>.part`.
- **Window**: a stretch of at most 64 KiB of saved bytes that is compared with the server's bytes.
- **Block**: a fixed piece of the file (1 to 64 MiB) whose hash goes into the block hash record.
- **Hash / SHA-256**: a 256-bit fingerprint of bytes; any change gives another value. **FNV-1a**: a tiny, fast, non-cryptographic hash, used here only to pick positions from a download's id.
- **Journal (JSON lines)**: an append-only text file, one JSON object per line.
- **Seal**: Deer's checkpoint: flush the `.part` to the disk, write a journal line with the bytes covered, save the list.
- **Flush (FlushFileBuffers, fsync)**: asking the operating system to write a file's cached data to the physical disk now. Without it, a power loss can lose data the program already "wrote".
- **Dirty**: a mark on a download that says "the `.part` may hold bytes no seal covers".
- **Sparse file**: a file whose never-written regions take no disk space and are never filled with zeros.
- **Valid data length (NTFS)**: how far NTFS has really written a file. A write beyond it makes NTFS write zeros up to it first, inside that write.
- **FAT32 / exFAT**: file systems of USB sticks and SD cards. They have no sparse files. FAT32 cannot hold a file of 4 GiB or more.
- **Signed URL**: an address that carries a signature and an expiry time in its query (S3, Google Cloud, Azure, Akamai, CloudFront).
- **CDN edge**: one of the many servers of a content delivery network; different edges can give different validators for the same bytes.
- **Token bucket**: a rate limiter that refills N tokens a second; each action takes one token.
- **Retry-After**: a server header saying how many seconds (or until which date) to wait.
- **HLS**: HTTP Live Streaming; a video cut into many small files (**segments**) listed in a `.m3u8` playlist. **DASH**: the same idea with an XML manifest (`.mpd`). An **init segment** is the header piece of fragmented MP4 that must come before the media segments. To **remux** is to re-pack audio/video into another container without re-encoding.
- **Mark of the Web**: Windows' `Zone.Identifier` stream on a file, saying it came from the internet.
- **Safe Browsing / application reputation**: the Google service Firefox asks whether a downloaded program is dangerous.
- **eTLD+1**: the registrable domain of a host (`example.co.uk`).
- **KiB / MiB / GiB**: 1,024 / 1,048,576 / 1,073,741,824 bytes.
- **Row**: one download in Deer's downloads panel. Its record is `rec`; its file state is `rec.file` (`FileState`).

---

## 1. Never lose or mix bytes (the "Phase 1" rules)

**What it does**

A resume can never quietly replace saved bytes with a web page, an error page, or another version of the file, and
never mark such a thing "Completed". The worst outcome is a paused row that says why and asks.

**How it works**

1. **Decide first, change later.** `rec.file` *is* the transfer's state object, and the store is saved right after
   the probe (RESUME-DESIGN.md lines 37-39). So `probe()` runs the verdict `judge()` before anything else
   (`gecko/src/modules/downloads/ranged.ts:589`), and `learn()`, which writes total, validators, type and redirect
   chain into the state, runs only after the verdict passed (`ranged.ts:602`, `ranged.ts:617`, `ranged.ts:624`).
   A failed verdict throws without touching the state (`ranged.ts:590-601`).
2. **A resume never forgets segments.** With `resuming`, `learn()` keeps every segment and only fills in fields an
   older record never had (`ranged.ts:744-769`).
3. **The `.part` is emptied only with `allowFresh`.** `FileState.allowFresh` (`ranged.ts:278`) is set only by a first
   start (`FileTransfer.fresh()`, `ranged.ts:484-486`), Start over, a quiet restart (`ranged.ts:876`) or a checksum
   failure (`ranged.ts:1954`). `openPart()` truncates only then (`ranged.ts:986-996`) and clears it once the file is
   set up (`ranged.ts:1022`). It also clamps every segment to the real file size (`ranged.ts:983-985`) and refuses a
   total smaller than what segments already claim: that is another file (`ranged.ts:988-989`).
4. **A whole-file answer goes beside the saved bytes.** When the server stops honouring Range, or a download has no
   ranges, and bytes are already saved, the new answer is written to `<part>.new` by `replaceSingle()`
   (`ranged.ts:1855-1912`):
   ```
   saved = first min(64 KiB, segment0.received) bytes of .part
   res   = the 200 answer
   if res is a page where a file was:            NotTheFileError   (.part untouched)
   if res total known and != stored total:       ChangedError
   stream res into "<part>.new", and while the first saved.length bytes pass:
       if they start like a page and saved does not:  NotTheFileError
       if any byte differs from saved:                ChangedError("its first bytes are different")
   if the answer was shorter than saved:          ChangedError
   if final length != stored total:               ChangedError
   move "<part>.new" over ".part"                  (only now are saved bytes replaced)
   forget the block hashes; adopt the answer's ETag, Last-Modified, digest
   on any error: delete "<part>.new", keep .part as it was
   ```
   A `.new` left by a crashed run is deleted before the next run starts (`gecko/src/modules/VitreDownloads.sys.ts:1573`).
5. **Unknown length stays a single stream.** A download that started without Content-Length is continued by ranges
   only when If-Range or a byte proof says the address gives the same file (`ranged.ts:748-758`), because bytes that
   never arrived would otherwise "complete" the file. `downloadTo()` also forces `ranges = false` for any segment with
   an unknown end (`ranged.ts:915`).
6. **Completion requires every byte.** `verify()` refuses a file if any segment is not complete or the saved bytes do
   not add up to the total ("Some parts of the file didn't arrive."), and if the file's size on disk differs from the
   promised total (`ranged.ts:1923-1929`).
7. **Stored records are made sane at load.** `settleSegments()` turns a record whose segment end is unknown beside a
   known total into an unknown-length single stream, and clamps `received` to each segment's length
   (`VitreDownloads.sys.ts:5308-5315`).

**Why**

RESUME-DESIGN.md section 1 names the two failures that started this work: "An old link that has expired fails for
good, because Resume always goes back to the dead redirect target" and "A link that now answers with a web page can
silently replace a half-downloaded song or video with that page and mark it Completed." The design's first rule is
"never destroy, never mix" (commit 13f9783, "resume phases 1 and 2"). The facts list in RESUME-DESIGN.md (lines 37-39)
shows why the verdict must come first: the old `probe()` called `forget()`, and the emptied segment list was written to
the store before the download even started.

**Edge cases handled**

- A text file Firefox (or a sniff) took for binary still resumes: when the saved type is only a guess, only a page or
  JSON counts as "not the file", never plain text or XML (`proof.ts:189-196`, `net.ts:981-984`).
- An older record whose type came from the row, not from the server, is marked `typeGuessed` (`ranged.ts:272-277`;
  `VitreDownloads.sys.ts` load()); the next real answer replaces the guess (`ranged.ts:762-766`).
- A known total whose resume answer gives `/*` keeps the known total, so the single-stream path still checks the
  length (`ranged.ts:759-761`).
- A download Firefox was moving, continued by Deer (Retry), must have the type Firefox had (`guarded`,
  `ranged.ts:282-286`, `ranged.ts:563`).

**Proven by**

`gecko/tests/downloads/integrity.js` (54 checks when added in 13f9783), for example: "a file swapped during a pause
reads File changed (paused, the person chooses)", "its .part is untouched (sha256) and its bytes still count", "a
'<part>.new' left over from an earlier run is gone", "a known total whose resume answer gives none ('/*') and turns
out shorter: File changed, the .part untouched", and the control "a resume with ranges makes 2 requests, as before".

---

## 2. Failure kinds and where each one ends

**What it does**

Every failure becomes one of a few kinds, and each kind has one row state. "Link expired" and "File changed" are
**paused**, not failed: nothing is lost, and red is kept for real damage (RESUME-DESIGN.md section 1, "State model").

**How it works**

Error classes live in `gecko/src/modules/downloads/net.ts`:

| Class (net.ts) | Means | `classify()` kind (`net.ts:951-967`) |
|---|---|---|
| `NotTheFileError` (`net.ts:129-137`) | A 2xx that is a page/JSON/XML/text where a file was, or a tiny answer where a big file was | `not-file` |
| `AddressRefusedError` (`net.ts:114-123`) | 401, 403, 404, 410, 451 (`REFUSED_STATUS`, `net.ts:107`), a 400 whose body says the signature expired, or a Cloudflare challenge (`hint 'challenge'`) | `refused` |
| `ChangedError` (`net.ts:144-160`) | Another version of the file. `evidence` is the sentence for the row ("was 24 MB, now 23 MB"); `headersOnly` = only headers said so; `candidate` = the new address for Start over | `changed` |
| `ChecksumError` (`net.ts:162-166`) | The finished file does not match the server's checksum | `damaged` |
| `HttpStatusError` 429 or 5xx | Site trouble | `server` |
| `ShortBodyError`, `NetError` with an "unreachable" code (`net.ts` `UNREACHABLE`) | Connection lost / site unreachable | `offline` or `timeout` |
| `DiskError` (`net.ts:85-93`) | Writing failed (disk full, access denied, locked range) | `disk` |
| `TooBigForDriveError` (`net.ts:43`) | A file of 4 GiB or more going to FAT32 | (a `DownloadError`: failed) |

What the engine does with each, in `stopped()` (`VitreDownloads.sys.ts:2508-2610`):

| Kind | Row ends as |
|---|---|
| `refused` / `not-file` with bytes saved | **Link expired**: paused, `need = {kind: 'address'}`, `wait = {for: 'address', tries, nextAt}` (renewal schedule, section 20) |
| `changed` | **File changed**: paused, `need = {kind: 'choice', evidence, candidate}`; or a quiet restart (section 7) |
| `offline` / `timeout` / `server` (only when a run really ended on it) | **Waiting for network** or **Retrying**: paused with `wait` (section 16) |
| pause / quit / sleep | paused (quit: `resumeOnStart`; sleep: `wait 'sleep'`) |
| anything else, `disk`, `damaged`, or `refused` with nothing saved | **Failed** with a plain sentence (`describeError()`) |

Every stop that is not Cancel then seals the block record (section 12): `VitreDownloads.sys.ts:2606-2609`.

**Why**

RESUME-DESIGN.md section 1: a new `waiting` state was rejected because it touches every state check in the window
code; instead `rec.wait` (Deer waits on the world) and `rec.need` (the person must act) were added to paused rows.
`DiskError` is never retried and always reads as a disk problem: the verifier found that the prototype retried disk
errors like network errors and showed "The connection was lost." (`gecko/spikes/downloader/RESULT.md:299`, recipe
correction 6).

**Edge cases handled**

- A Cloudflare challenge goes the refused-address way (Link expired, the page step), never the site-error way, because
  "asking again and again raises the address's bot score" (`net.ts:775-778`, `net.ts:791-796`).
- A 400 is read (first 4 KB) only to tell an expired signature from a real bad request:
  `EXPIRED_BODY = /ExpiredToken|Request has expired|Signature|expired/i` (`net.ts:767`, `net.ts:782-785`).

**Proven by**

`tests/downloads/expiry.js` ("/signed-once gives Link expired: paused, the bytes kept"), `tests/downloads/connections.js`
("every connection refused at once: the row pauses (Link expired), not Failed"; "a challenge on every ask stops the run
as Link expired ..."), `tests/downloads/faults.js` ("it reads as a disk problem, not a network one").

---

## 3. The same-file proof: verdicts R1 to R7

**What it does**

Decides whether an answer (from the download's own address, or from a new address) is still the download's file. A
**proof** in Deer means: the server's bytes at chosen places equal the saved bytes (or their recorded hashes), and
those places together cover enough of the saved data. Headers never decide alone while bytes can be compared.

**How it works**

The rules, strongest first (RESUME-DESIGN.md 2.4; code `proof.ts:198-227` for the own address, `proof.ts:503-611` for
a new address). The first rule that applies decides.

| Rule | Verdict | Test |
|---|---|---|
| **R1** not the file (= the link expired) | refused | A refused status (401/403/404/410/451, an expired-type 400). A 2xx whose type is textual where a binary was saved (`notFile()`, `proof.ts:194-196`). A total under `TINY` = 64 KiB (`proof.ts:31`) where the saved file is over `ASK_ABOVE` = 1 MiB (`proof.ts:29`). First bytes that look like a page (`<` or `{`) where the saved ones do not (`proof.ts:575`, `proof.ts:581`). |
| **R2** changed by size | changed | Both totals known and different. Or the answer's total is smaller than the bytes already saved (for a download whose length was never known) (`proof.ts:216-219`, `proof.ts:553-554`). |
| **R3** server checksum | changed / same | A different whole-file digest of the same algorithm is another file. An equal digest *and* an equal total is SAME (`proof.ts:556-561`). |
| **R4** byte windows | changed / same | 64 KiB windows fetched with Range and **no** If-Range, compared with the saved bytes (or the recorded head hashes). All equal plus equal total = SAME; any different = CHANGED (`compareWindows()`, `proof.ts:471-493`). |
| **R5** same strong ETag on the same host | same | Only together with an equal window 0 (`proof.ts:586-588`). |
| **R6** headers never decide alone | (triggers R4) | A different ETag/Last-Modified, or a 200 to If-Range, only starts a byte comparison (section 6). |
| **R7** unknown | unknown | Nothing could be compared (no ranges, no equal strong ETag or digest, no local bytes). Under 1 MiB saved: taken as a fresh start. Over: handled as changed, with the sentence `UNSURE` = "Deer can't confirm it is the same file" (`proof.ts:42`). |

What "textual" means: `text/html`, `text/plain`, `text/xml`, `application/xhtml+xml`, `application/json`,
`application/xml`, any `+json` / `+xml` type (`net.ts:972-975`). When the saved kind is only a guess, the narrower
`pageLike()` is used: `text/html`, `application/xhtml+xml`, `application/json`, `+json` (`net.ts:981-984`).
`textStart()` looks at the first non-space byte (after an optional UTF-8 BOM, within 64 bytes): `<` or `{`
(`net.ts:987-991`). The saved kind comes from `readKind()` (`proof.ts:178-187`): the server's own Content-Type
(`sure`), else what reading block 0 back said (ledger `onKind`), else a sniff of the first 64 saved bytes (never sure).

Which digests count (`proof.ts:130-151`): `Repr-Digest` or `Digest` with `sha-256`/`sha256`; `Content-MD5` only on a
200 ("Content-MD5 on a 206 describes the one byte, not the file"). For R3 on a 206, only `Repr-Digest` counts, "so a
server that puts a range's digest in Digest never reads as another file" (`proof.ts:143-151`).

`judge()` for the download's own address (resume probe, mid-download), in order (`proof.ts:208-227`):
```
if status is 200/206 and notFile(savedKind, type):  return NotTheFileError
if not resuming:                                    return null
total = answer's file length (Content-Range total for 206, Content-Length for 200)
known = stored total, or bytes saved when the total was never known
if total < 64 KiB and known > 1 MiB:                return NotTheFileError('small')
if both totals known and different:                 return ChangedError("was X, now Y")
if total < bytes saved:                             return ChangedError("now X, but Y were already saved")
if both have a whole-file digest of one alg and they differ: return ChangedError("its checksum is different")
if 200 to an If-Range and the server ranged before: return headersOnly ChangedError (R6)
if 206 and validators differ:                       return headersOnly ChangedError (R6)
return null
```

`proveAddress()` for a **new** address (renewal, "Use another address...", a re-click on the page), `proof.ts:513-611`:
```
ask url once: Range: bytes=0-65535, no If-Range (3 tries, 1 s apart; Necko follows redirects)
non-2xx: refused (AddressRefusedError) or unreachable
record found = {url, finalUrl, redirect chain, etag, lastModified, digest, total, type, ranges, disposition name}
R1, R2 as above (refused / changed)
R3: digest same alg: different -> changed; equal at equal total -> sure
window 0 rides on this answer (a 206 from byte 0, or a 200 = the whole file from its start):
    compare first min(64 KiB, saved at 0) bytes with block 0's recorded head hash, or with the saved bytes
    a page where binary was saved -> refused; different -> changed; equal -> firstSame
R5: sure, or (strong ETag equal and firstSame and same host as before) -> same
R7: the answer is not a 206 with a total -> same only if strong ETag equal and firstSame, else unknown
R4: the other planned windows (section 4) at the new FINAL address
    changed -> changed; a 200 to a window -> same only if strong+firstSame, else unknown
    all compared and equal and enough() -> same, else unknown
```
`proveAddress()` changes nothing. The caller adopts a SAME answer (section 20). A `Found.disposition` (the server's
file name) is kept so that a click on the page that gives "another size and another name" is not taken as the
download's (`proof.ts:93-97`; used by `attach.ts` `realFile()`).

**Why**

RESUME-DESIGN.md 2.4. R6 exists because CDNs and server farms give new validators over the same bytes; R5's same-host
condition because an ETag means nothing across hosts. R1 maps an expired link to "Link expired", never to "changed",
so a dead link never offers to throw saved bytes away. R7's 1 MiB line is the owner's decision 1 (RESUME-DESIGN.md
section 9: "ask whenever more than 1 MiB of verified bytes exists").

**Edge cases handled**

- A 206 whose `Content-Range` start is not the asked start, or a 416, cannot be compared: `unknown`, never `same`
  (`proof.ts:427-444`).
- A 200 to a window means "this address no longer takes ranges": it is handed back unread, so the single-stream path
  can still use it (`proof.ts:439`, `ranged.ts:809`).
- With the record present, a window that is exactly a hashed block's head is compared with the recorded hash, never
  with the local bytes, so local damage is never mistaken for "another file" (`proof.ts:479-485`).
- Repair proves with only the good blocks and never reads local bytes (`Heads.local = false`, `proof.ts:60-61`,
  `proof.ts:572`).
- The design's "an S3-style ETag-as-MD5 only ever counts as evidence for SAME" (RESUME-DESIGN.md 2.4 R3) is not in the
  code I read; digests come only from `Repr-Digest`, `Digest` and `Content-MD5`.

**Proven by**

`tests/downloads/expiry.js`: "/swap with no validators and the same size: File changed, the .part untouched, nothing
mixed", "a wrong address (another file)", "an address that answers with a page says so", "Use another address... with
an address that gives other bytes after its first 64 KiB (same size) says it is a different file; the row is untouched".
`tests/downloads/integrity.js`: "a weak ETag plus a Last-Modified change is caught", "a dropped ETag plus a new
Last-Modified is caught".

---

## 4. Which bytes are compared: the proof windows

**What it does**

Chooses at most 4 windows of at most 64 KiB (about 256 KiB of traffic) that together make a trustworthy comparison,
including the places where a swap is most likely to show.

**How it works**

Constants: `WINDOW = 64 * 1024` (`proof.ts:33`), `BUDGET = 4` windows (`proof.ts:39`), `ATTEMPTS = 3` per window
(`proof.ts:40`).

`windows(segments, seed, heads)` (`proof.ts:251-309`), over the saved stretches (`received > 0`), sorted by start:
```
out = []
1. head of the first stretch: [start, start + min(received, 64 KiB))           -- "block 0"
2. for each UNFINISHED segment, lowest first: the LAST 64 KiB of its saved bytes  -- "the newest bytes"
   (the part not already covered; stop at the first that adds a window)
3. h = FNV-1a-32(download id or "deer"); pick a stretch no window samples yet (else any):
       seg = fresh[h % fresh.length]
       at  = seg.start + floor(((h >>> 12) % 4096) / 4096 * max(0, seg.received - 64 KiB))
       add [at, min(end, at + 64 KiB))                                           -- "seeded"
4. if there are more than 8 segments: head of the median stretch
5. while out.length < 4 and (out.length < 3 or stretches sampled < min(3, stretches)):
       head of the middle stretch not sampled yet, else the first gap no window covers
A window that overlaps an earlier one is cut to its uncovered part, never dropped.
```
`enough(segments, windows)` (`proof.ts:358-365`) says whether equal windows make a proof:
```
true if the windows cover every saved byte
else true only if there are >= 3 windows AND they touch >= min(3, number of stretches) stretches
```
With the block hash record (section 11), `recordWindows()` (`proof.ts:318-350`) picks the same kinds of places but
only at the heads of hashed blocks lying wholly under saved bytes: block 0; the newest hashed block of the lowest
unfinished segment; `all[fnv % all.length]`; the median segment's first hashed block when more than 8 segments;
then fill. A window is `[b*bs, b*bs + min(64 KiB, block length))`. If those windows do not make a proof, Deer falls
back to the local-bytes windows above (`proof.ts:255-263`).

`fetchWindow()` (`proof.ts:422-454`) asks `Range: bytes=from-(to-1)` with no If-Range on connection lane 0; a 416 or a
206 that starts elsewhere returns `null` (cannot compare); a 200 is returned unread; a short body is a
`ShortBodyError` and is retried. Retries: 3 attempts with `backoff()` = 2 s, then 6 s (or the server's Retry-After, at
most 60 s) (`proof.ts:448-452`, `net.ts:859-862`).

`compareWindows()` (`proof.ts:471-493`) returns `same` (with the last 206 answer, so the caller can continue from it),
`changed` (a window differs, or the total differs), `whole` (a 200), or `unknown` (a window could not be compared).

**Why**

- The newest bytes below the lowest frontier "were written last, so they catch a swap in the middle of a download"
  (RESUME-DESIGN.md 2.5).
- The seeded window makes the checked places differ between downloads but stay stable for one download (the same id
  gives the same place). The code and the design only say "one block picked by a seed from rec.id" (RESUME-DESIGN.md
  2.5); the benefit (no fixed spot that a same-size variant could happen to share, and repeatable proofs) is my reading.
- Review of Phase 2: "One window over a download paused early let another file of the same size through"
  (`proof.ts:355-357`); and "a file that changed after its first 64 KiB completed mixed" (`ranged.ts:46-48`). Hence
  "never window 0 alone while other saved bytes were not compared" (`proof.ts:608-609`) and the cut-not-drop rule for
  overlapping windows (`proof.ts:246-249`).
- Review of Phase 5: with hashed blocks in too few stretches (one segment ran ahead), a renewed link of the same file
  read as File changed; hence the fallback from record windows to local windows (`proof.ts:256-262`).

**Edge cases handled**

- A download paused very early (a few KiB in each of 8 segments) still gets 3 windows over 3 stretches.
- A segment holding less than 64 KiB still counts as a stretch.
- Fewer than 3 stretches: `min(3, stretches)` is required, and covering every saved byte is always enough.

**Proven by**

`tests/downloads/expiry.js`: "the early pause left under 64 KiB in every segment (24 of them) and over 1 MiB in all"
then "a file whose bytes changed after its first 64 KiB (same size, a server that ignores If-Range) is File changed:
the windows reach past window 0". `tests/downloads/repair.js`: "the first segment ran ahead: hashed blocks in it only,
while every segment holds bytes" then "its original address mints a new link, proven with windows over every stretch
(not the first segment alone): New link found, never File changed".

---

## 5. The resume probe (window 0 rides on it)

**What it does**

Every resume first asks the server one question that gives, in one request: the status, the length, range support,
the validators, a type check, and the first 64 KiB of the file to compare with the saved start. An unchanged resume
makes no extra request.

**How it works**

`probe()` (`ranged.ts:560-643`):
```
resuming = probed before and bytes saved
if resuming and finalUrl != url and finalUrl's expiry time has passed: renew first (section 20)
head = (1 < total <= 64 KiB) ? total - 1 : 65536      -- a tiny file is asked one byte short
asked = probed ? finalUrl : url
validator = resuming ? ifRange() : ''
Range: resuming ? "bytes=0-(head-1)" : "bytes=0-0"     -- a first start asks one byte
If-Range: validator (when there is one)
on 200/206/416:
    verdict = judge(...)                                -- section 3
    NotTheFileError -> renewal hook (afterRefusal); renewed -> ask again; else throw
    other hard verdict -> throw (state untouched)
    first start -> learn()
    validators of no trust + 206 -> treat as header change (UNSURE)
    windowZero(): compare the answer's first min(64 KiB, saved at 0) bytes with the record's head hash or the .part
    no verdict -> learn(res, trusted = a 206 to If-Range)
    header-only verdict -> prove() other windows (section 6); same -> adopt validators (held()), learn
on refused status or 400 -> refusal(); afterRefusal(): 403 gets ONE retry at the same address; else renewal
other retryable status -> up to 3 attempts, waiting backoff(): 2 s, then 6 s (or Retry-After, at most 60 s)
network error -> up to 3 attempts, 1 s apart
```
`ifRange()` (`ranged.ts:545-549`): a strong ETag; otherwise Last-Modified (no ETag, a weak one, or an ETag no longer
trusted); nothing when Last-Modified is not trusted either.

`windowZero()` (`ranged.ts:666-689`) only compares when the answer is a 206 starting at 0, or a 200 judged by headers
(`whole`), and only if the whole window fits in what was asked. Result: `true` (equal), `false` (could not compare),
`NotTheFileError` (a page where the saved bytes are not one), or `ChangedError("its first bytes are different")`.

`check()` (`ranged.ts:649-656`) wraps `probe()` with the quiet-restart rule (section 7).

**Why**

RESUME-DESIGN.md 2.5: "The resume probe asks Range: bytes=0-65535 with If-Range, instead of bytes=0-0 ... One request
gives the status, headers, sniff and window 0, so there is no extra request." The header comment says it also catches
"a file swapped with no validators at all (same size)" (`ranged.ts:33-35`). Review of Phase 2: "a server may answer a
Range over the whole file with the whole file, a 200 that reads as 'changed'", hence the one-byte-short rule for files
of at most 64 KiB (`ranged.ts:568-571`). A weak ETag is never sent in If-Range (RFC 9110 13.1.5; Phase 1).

**Edge cases handled**

- A 416 on an empty file reads as total 0 (`proof.ts:116`).
- A 200 that carried window 0 cannot be "learned" from (its body was read), so when window 0 was all there was, the
  proof asks again with a plain Range (`ranged.ts:786-788`, `ranged.ts:805-807`).
- A total known before but missing now (`/*`) stays known (`ranged.ts:759-761`).

**Proven by**

`tests/downloads/integrity.js` controls: "a resume with ranges makes 2 requests, as before (the probe, carrying window 0,
then one range from the saved end)", "a resume without ranges makes 1 request". `tests/downloads/expiry.js`: "a 40 KiB
file whose server answers a Range over the whole file with a 200 resumes in 2 requests". `tests/downloads/integrity.js`:
"nothing is fetched after the probe: its answer (a 200 to If-Range) carries window 0, whose bytes differ".

---

## 6. Validators that cannot be trusted (R6)

**What it does**

Some CDNs give a new ETag on every answer, and server farms can differ in both ETag and Last-Modified for the same
bytes. Deer does not call that "File changed". It proves the bytes, adopts the new validators, and after two such slips
in 10 minutes stops trusting that validator and checks bytes at intervals instead.

**How it works**

- Mid-download, `pull()` turns a 200 to If-Range into `headerChange('the site sent the whole file again')`, and a 206
  with other validators into `headerChange('the site gives it another version tag')` (`ranged.ts:1555-1566`). A 200 to
  a plain Range (no validator) is `RangeIgnoredError`: the download falls back to the single stream (`ranged.ts:939-944`).
- `downloadTo()` catches a header-only `ChangedError`, runs `prove()` (`ranged.ts:945-956`). Same file: `held()` adopts
  the validators and the run continues; otherwise quiet restart or File changed.
- `prove()` (`ranged.ts:796-813`): planned windows from `provable()` bytes; at most `PROOF_GUARD = 8` proofs per run
  (`ranged.ts:111`); with nothing saved to compare and at most 1 MiB saved, the answer is taken (R7), counted in its own
  guard (`ranged.ts:801`).
- `held()` (`ranged.ts:823-839`):
  ```
  slipped(ours, theirs) = (both set and different) or (answer was a 200 to an If-Range that carried ours)
  if ETag slipped: retagged = recent times within 10 min + now; if >= 2 -> etagUnstable = true
  if Last-Modified slipped: redated = ...; if >= 2 -> dateUnstable = true
  adopt the answer's ETag and Last-Modified
  ```
  `UNSTABLE_WINDOW = 10 min` (`ranged.ts:113`).
- With `etagUnstable`, If-Range carries Last-Modified; with `dateUnstable` too, nothing (`ranged.ts:545-549`), and
  `validatorsDiffer()` stops comparing them (`proof.ts:158-161`).
- Instead, `spotCheck()` (`ranged.ts:846-865`) compares one window every `SPOT_BYTES = 256 MiB` or `SPOT_MS = 5 min`
  of a run (`ranged.ts:115-116`), rotating through the planned windows. Every connection waits for the one check.
  A different window stops the download (File changed); a window that cannot be compared waits for the next turn.
- A resume with no trusted validator treats a 206 as a header change, so it always compares windows past window 0
  (`ranged.ts:605`).

**Why**

RESUME-DESIGN.md 2.4 R6: "Different ETags with equal windows mean SAME (a new address or another CDN edge) ... Twice
within 10 minutes sets etagUnstable." Review of Phase 2 added `dateUnstable`: "a farm whose backends differ in both
ETag and Last-Modified then sends no If-Range at all (the spot checks remain), instead of proving every other answer
until it gave up" (`ranged.ts:817-822`).

**Edge cases handled**

- A 200 to If-Range counts as a slip of the validator that was *sent*, even if the 200 carries the same value
  (`ranged.ts:828`).
- After a proof, every range carries the new validator (test below).

**Proven by**

`tests/downloads/expiry.js`: "/edge (a new ETag on every answer) completes intact with no restart", "after two proofs
its ETag is no longer trusted: If-Range carries Last-Modified", "a farm whose backends differ in both ETag and
Last-Modified (the same bytes) completes intact: never File changed", "the resume, with no validator to trust, compared
windows of the saved bytes past window 0". `tests/downloads/integrity.js`: "the same bytes under a new ETag
mid-download: proven by the windows (2 to 4), carried on, completed intact".

---

## 7. A file that really changed: restart quietly, or stop and ask

**What it does**

If the file on the site is another version: with little saved (at most 1 MiB), Deer starts again by itself, at most
twice in 10 minutes. With more saved, it stops with the `.part` untouched and the row reads **File changed**, with a
sentence of evidence and two choices: **Start over with the new file** or **Keep partial file**.

**How it works**

- `silentRestart(log, saved)` (`ranged.ts:363-368`): allowed only if `saved <= ASK_ABOVE` (1 MiB) and fewer than
  `SILENT_RESTARTS = 2` restarts in `RESTART_WINDOW = 10 min` (`ranged.ts:104-105`). `restartSilently()`
  (`ranged.ts:871-882`) empties segments and validators, sets `allowFresh`, and forgets the block hashes
  (`ledger.forget('restarted')`).
- A row already in File changed never restarts by itself: Resume there only checks again
  (`transfer.silentRestarts = rec.need?.kind !== 'choice'`, `VitreDownloads.sys.ts:1518`; RESUME-DESIGN.md G3:
  "Resume, or Space, on a changed row runs the proof again, since the server may have gone back to the old file. It
  never restarts.").
- **Start over** (`VitreDownloads.sys.ts:2865-2960`): a `decision` line is written to the journal, flushed, *before*
  anything moves (`ledger.ts:761-764`); the old `.part` is moved to `<name>.old.part` (another free name like
  `<name>.old (1).part` if that exists; a parts-layout folder goes aside too); if the disk has no room for the whole
  new file (`hasRoom(dir, total)` = free >= total + 16 MiB, `ranged.ts:2136-2138`), the old part is deleted at once;
  the old part is deleted when the new file completes (`dropOldParts()` in `complete()`, `VitreDownloads.sys.ts:2314`).
  If the move fails (another program has the file open), nothing is started over and the row says why.
- **Keep partial file** (`VitreDownloads.sys.ts:4182-...`): the bytes saved without a gap from byte 0
  (`unbroken()`, `attach.ts:171-178`) are kept as `"<stem> (partial).<ext>"` (`partialName()`, `attach.ts:181-185`).
  Order: `decision('keep')` flushed, store saved with `rec.keeping = target`, (parts layout: join the parts of the
  unbroken beginning), move `.part` to the target, cut it to the unbroken length (`setSize`), clear the sparse mark
  (not awaited), then complete with Safe Browsing and the Mark of the Web. If Deer crashes between the decision and the
  move, `load()` moves the part back and the row asks again (`VitreDownloads.sys.ts:891-900`).

**Why**

The owner's decisions 1, 2 and 3 of 2026-10-13 (RESUME-DESIGN.md section 9): ask above 1 MiB, otherwise restart at
most twice in 10 minutes; keep `<name>.old.part` until the new file completes (delete at once only when space is
short); Keep partial saves the unbroken beginning, with the caption saying exactly how much. The UI rule "Space never
destroys bytes" (RESUME-DESIGN.md section 6): Space on File changed only moves focus to the first choice. IDM by
contrast "starts again from zero (with a dialog)" on a mismatch and loops forever when the size changed
(IDM-WAY-DESIGN.md section 2).

**Edge cases handled**

- Start over never overwrites an unrelated file that happens to be named `<name>.old.part`.
- A `ChangedError` carries `candidate` (the new version's address), so Start over needs no new lookup
  (`net.ts:151-152`; `stopped()` stores it in `need.candidate`).
- RESUME-DESIGN.md 8 notes the limit: Keep partial on a segmented download keeps only the unbroken beginning, "which
  may be much less than the percentage shown", and an MP4 with its index at the end may not play.

**Proven by**

`tests/downloads/integrity.js`: "Start over never touches another file named <name>.old.part; the old partial goes to
<name>.old (1).part", "Start over keeps the old partial as <name>.old.part while the new file downloads", "the old
partial goes once the new file is complete", "Start over while another program has the saved part open: nothing moved
or emptied". `tests/downloads/expiry.js`: "with under 1 MiB saved the same change starts again by itself and completes
as the new file, never a mix of the two". `tests/downloads/attach.js`: "Keep partial equals the old prefix" (design
list) and the Keep partial checks in `layout.js`.

---

## 8. Server checksums and the completion check

**What it does**

At the end, Deer checks every byte arrived and the file has the promised length. If the server gave a checksum, the
whole file is hashed and compared; a mismatch repairs only the bad blocks. If the server gave **no strong validator and
no checksum**, a few windows are compared with the site before the file counts as complete.

**How it works**

`verify()` (`ranged.ts:1919-1961`):
```
every segment complete and saved == total, else "Some parts of the file didn't arrive."
file size on disk == total, else "The finished file is N bytes; the server promised M."
if a digest was given:
    hex = md5 via nsICryptoHash (md5Hex) or IOUtils.computeHexDigest(sha256)
    if hex != expected and there is a block record and ranges and this is the first round:
        drain the hashing; if a refetched block hashed to another value -> File changed
        bad = blocks whose hash differs from the record
        if bad: release them (section 13) -> 'again' (the run fetches only those)
        else (every block matches its record = the network delivered wrong bytes):
            fromServer(): prove windows; then fetch every block with If-Range into memory,
            hash it, and write it in place only where it differs from the record; hash again
    if still different: forget the segments and hashes, allowFresh, ChecksumError (Failed)
    keep the SHA-256 for Safe Browsing and the finished record
```
`md5Hex()` reads in 4 MiB pieces through `nsICryptoHash` (`ranged.ts:2055-2070`). `fromServer()` is at
`ranged.ts:2000-2022`; a digest mismatch is repaired at most once per run (`digestRounds`, `ranged.ts:456-457`).

`completionCheck()` (`ranged.ts:1974-1992`) runs only when there is no strong, trusted ETag, no digest, the download
used ranges and the total is known:
```
bs = blockSize(total)
blocks = {0, floor(total/3/bs), floor(2*total/3/bs), last}       -- where a 3-segment plan starts, plus the end
windows = first min(64 KiB, bs) of each
compareWindows(..., attempts = 1)
changed -> File changed (nothing renamed); anything else (refused, page, no network, can't compare) -> complete
```

**Why**

RESUME-DESIGN.md 2.5 ("Completion check, when there is no strong validator and no digest") and 4.3 ("Digest mismatch at
the end ... A whole download again happens only as the person's Download again"). Review of Phase 5: "anything it can't
compare (a refused address, a page, no network) lets it complete as before", because "a link valid for one download,
or one that expired with the last byte" must not turn a finished download into Link expired (`ranged.ts:1969-1972`).
MD5 goes through `nsICryptoHash` because "IOUtils rejected md5" (commit 13f9783: "Content-MD5 downloads complete").

**Edge cases handled**

- A Content-MD5 on a 206 is ignored (it would describe the range) (`proof.ts:138`).
- Each completion window is asked once: "an address that refuses is not asked again for a check that can only stop the
  download" (`ranged.ts:1971-1973`).
- After a checksum failure the old block hashes are forgotten: "kept, they made the new bytes read as damaged or
  changed" (`ranged.ts:1951-1955`).

**Proven by**

`tests/downloads/integrity.js`: "Content-MD5 that matches: the download completes", "Content-MD5 that doesn't match:
fails with the checksum sentence". `tests/downloads/repair.js`: "the site sent one byte of block 5 wrong, once" then
"the checksum did not match, every block matched its record, so the blocks were compared with the site and only block 5
replaced", and "a file under 1 MiB with no validators that changed while it downloaded: the completion check sees it,
it starts again by itself".

---

## 9. Writing bytes, and knowing which bytes are really on disk

**What it does**

Each connection writes its bytes at their place in the `.part` without holding the file in memory and without disk
work on the main (UI) thread. At any moment Deer knows a **lower bound** of the bytes that certainly reached the file,
and it only ever saves or hashes those.

**How it works**

`Writer` (`gecko/src/modules/downloads/partfile.ts:168-288`), one per connection:
- its own `nsIFileOutputStream` on the file, seeked to the segment's offset (`partfile.ts:182-189`);
- an `nsIPipe` with `PIPE_SEGMENT = 256 KiB` segments (= the size of each disk write; "the default 4 kB would mean
  25,000 syscalls a second at 100 MB/s", `partfile.ts:20-21`), unlimited length, non-blocking (`partfile.ts:190-192`);
- `NetUtil.asyncCopy` moves pipe -> file on Necko's background threads (`partfile.ts:193-198`). The main thread only
  calls `writeFrom()` from the network stream into the pipe: the bytes never enter JavaScript (`partfile.ts:214-229`).

Counters (`partfile.ts:174-179`, `partfile.ts:247-271`):
```
written  = bytes handed to the writer
backlog  = bytes still waiting in the pipe
drained  = max seen of (written - backlog)        -- left the pipe
failed   = error code of a failed disk write (0 = none)
IN_FLIGHT = 2 * PIPE_SEGMENT = 512 KiB             -- the chunk the copier may be writing right now
settled  = max(0, min(written, drained) - IN_FLIGHT)                     -- safe to READ BACK while running
durable  = max(0, min(written, drained - (failed ? IN_FLIGHT : 0)))      -- certainly in the file (lower bound)
close()  = close the pipe, wait for the copier; on success drained = written; on failure throw DiskError
```
How the transfer uses them (`ranged.ts`):
- `snapshot()` (`ranged.ts:502-511`): the state the store saves: each segment's `received - writer.backlog`, "so a
  crash never leaves a segment claiming bytes that didn't reach the file".
- `provable()` (`ranged.ts:518-526`): the bytes that may be read back while writers run (proof windows, block hashing):
  `received - writer.written + writer.settled`.
- Back-pressure: when a writer's backlog passes `BACKLOG_HIGH = 8 MiB` the network channel is suspended until it is
  below `BACKLOG_LOW = 2 MiB` (`ranged.ts:100-101`, `ranged.ts:1760`).
- Nobody trusts `seg.received` until the writer is closed (`ranged.ts:1769-1771`).
- **Disk error** (`ranged.ts:1772-1781`):
  ```
  seg.received = base + min(seg.received - base, writer.durable)       -- keep only what certainly landed
  with a block record: seg.received = floor((seg.start + seg.received) / bs) * bs - seg.start
                                                                       -- the block holding the failed write is suspect
  then the run stops (DiskError is never retried), sealed
  ```
- `writeAt()` writes a buffer in place and waits until it is in the file (Repair, `fromServer()`;
  `partfile.ts:97-104`). `readAt()` reads by file offset through `placeOf()`, which the parts layout redirects to the
  right part file (`partfile.ts:60-91`).

**Why**

The spike prototype (`gecko/spikes/downloader/verify/engine/VitrePartFile.sys.mjs`, unchanged since 5557e72) had the
pipe-and-copier design but no `durable`: "recipe correction 6: the prototype threw all of it away"
(`partfile.ts:10-12`). The verifier saw a byte-range lock make the prototype retry a disk error as a network error and
discard "all 38 MB the running segments had written (state keeps 0.0 MB)" (`RESULT.md`, claim 33). Review of Phase 5:
after a failed write the copier closes the pipe and its backlog reads 0, so `settled`/`durable` use what had left the
pipe "when last looked at, never what the closed pipe no longer reports" (`partfile.ts:256-261`).

**Edge cases handled**

- `look()` never updates after a failure, because the copier closed the pipe (`partfile.ts:201-211`).
- An open failure is a `DiskError` and never leaks the "live connections" count (`ranged.ts:1704-1710`; the verifier
  had flagged this, RESULT.md line 299).
- A 206 that ends cleanly at its own `Content-Range` end, short of what was asked (hosts that cap each answer), is not
  a failure: the rest is asked next (`ranged.ts:1787-1791`).

**Proven by**

`tests/downloads/faults.js`: "a disk write error stops the download at once", "the bytes that reached the file are
kept", "nothing is retried while the disk refuses", "every block the record hashed matches the .part after the disk
error (no hash of bytes that never reached it)", "only what had not reached the file was fetched again".

---

## 10. The download list: atomic saves, a flushed backup, and a rebuild from journals

**What it does**

The list of downloads (with every segment) is saved so that a crash or power loss never leaves it half-written, a
damaged list falls back to a backup, and if both are lost the rows are rebuilt from the per-download journals.

**How it works**

- `save(flush)` (`VitreDownloads.sys.ts:5113-5126`): `IOUtils.writeJSON(store, data, {tmpPath, flush})` (written to a
  temp file, then moved over the store: atomic). A flushed save also writes the same data, flushed, as `<store>.bak`.
- When: progress saves every `SAVE_EVERY = 2 s` unflushed; a flushed save at least every `FLUSH_EVERY = 30 s` while
  downloads run, on every state change, and at quit (`VitreDownloads.sys.ts:258-261`, `VitreDownloads.sys.ts:4532-4533`).
- Running transfers are saved as `snapshot()`: only bytes certainly on disk (`VitreDownloads.sys.ts:5083-5101`).
  Private downloads are never written (`VitreDownloads.sys.ts:5088`).
- Shape (version 2): `{version: 2, session: {startedAt, clean}, items}` (`STORE_VERSION`, `VitreDownloads.sys.ts:265`).
  The session starts `clean: false` (`VitreDownloads.sys.ts:658`); only `shutdown()`'s last save sets it true
  (`VitreDownloads.sys.ts:5296-5297`). A store that says `clean: false` was left by a crash or power loss
  (`VitreDownloads.sys.ts:835-837`).
- `load()` (`VitreDownloads.sys.ts:801-833`): read the store; if unreadable, read `.bak` and copy it back; a copy that
  cannot be read is moved aside as `<file>.corrupt` before anything is written; if both are lost, `fromJournals()`
  (`VitreDownloads.sys.ts:5042-5080`) makes a row from each journal: header (address, path, length, validators) plus
  its last seal (coverage). Unfinished rows come back paused and **dirty** (so their part is checked before use);
  finished ones (`<id>.done.jsonl`) come back completed with their SHA-256.

**Why**

RESUME-DESIGN.md G4 "Store safety": "Today an unreadable store becomes an empty list, which the next save writes over
the file." Review of Phase 1: the `.bak` is written only on flushed saves, so it is "always the last flushed list,
never one a power loss can catch half-written with the store"; using IOUtils' `backupFile` "on every save rotated it
every 2 s" (`VitreDownloads.sys.ts:5104-5112`). The dirty flag plus the hash record make the unflushed 2-second
progress saves safe (RESUME-DESIGN.md 5.6).

**Edge cases handled**

- A version 1 store (no `session`) is taken as clean; its rows get guessed types (`typeGuessed`).
- A record whose segments claim more than the total is settled to an unknown length (test below).

**Proven by**

`tests/downloads/integrity.js`: "a corrupt store loads from its .bak", "the unreadable list was set aside and the backup
put in its place", "a store and .bak that are both unreadable: the rows come back from their journals, one each", "both
were set aside as .corrupt and the next save wrote over neither", "progress saves rewrite the store but leave its .bak
alone (the last flushed list)".

---

## 11. The block hash record (the "ledger") and its journal

**What it does**

For every one-file download of known length, Deer hashes the `.part` block by block as soon as each block is certainly
on disk, and keeps the hashes in `<profile>/vitre-downloads/<id>.jsonl`. This record finds damage after a crash, a
power loss, a disk error, or another program writing into the file, so only bad blocks are fetched again. It also
serves as the reference for proofs (head hashes), for "Check file" and for "Repair".

**How it works**

*Block size* (`ledger.ts:39-41`, `ledger.ts:77-82`):
```
want = ceil(total / 2048)
bs   = 1 MiB; while bs < want and bs < 64 MiB: bs *= 2
```
So a 1 GiB file uses 1 MiB blocks; 4 GiB uses 2 MiB; 100 GiB uses 64 MiB. (Note: with the 64 MiB cap, a file over
128 GiB has more than 2048 blocks; the comment "never has more than 2048" holds only up to 128 GiB.)
Blocks are aligned to the **file**, not to segments: `plan()` and `claim()` cut segments at multiples of `bs`
(`ranged.ts:888-899`, `ranged.ts:1276-1304`), so each block sits inside one segment. Older unaligned segments still work:
a block counts once it lies wholly inside the union of saved stretches (`coverage()`, `covered()`, `ledger.ts:310-319`,
`ledger.ts:496-507`).

*The hash* (`ledger.ts:125-187`):
```
read the block in CHUNK = 1 MiB pieces (IOUtils.read, off the main thread; the next read starts while this one is digested)
chunkHash[i] = SHA-256(piece i)                   -- crypto.subtle.digest, off the main thread
blockHash h  = first 16 bytes (128 bits) of SHA-256(chunkHash[0] || chunkHash[1] || ...)   -- nsICryptoHash
headHash  w  = SHA-256(first min(64 KiB, block) bytes)   -- the proof's window for this block
```
Reading block 0 back also sniffs whether the download is a page or a file (`onKind`, `ledger.ts:565`).

*When a block is hashed* (`ledger.ts:528-578`):
- `pump()` hashes blocks that newly lie wholly under `provable()` bytes (section 9), at most `AT_ONCE = 2` at a time
  (`ledger.ts:47`). It is called on every `writer.close()` (`ranged.ts:1784`), every 4 MiB streamed (`HASH_EVERY`,
  `ranged.ts:118`, `ranged.ts:1751-1754`) and on the engine's 250 ms tick (`VitreDownloads.sys.ts:4522`).
- While the run takes more than `HOLD_ABOVE = 256 MiB/s` over the last `RATE_WINDOW = 200 ms`, no new block is started
  (`ledger.ts:63-64`, `ledger.ts:510-526`). Hashing may fall behind; it catches up when the run slows, at a stop's
  drain, and from the finished file (section 24).
- A block whose read failed is not tried again until the next `attach()`/`use()` ("never a busy loop",
  `ledger.ts:354-355`).
- An `epoch` counter drops a hash still being computed when the bytes it describes were forgotten or reset
  (`ledger.ts:362-363`, `ledger.ts:560`).

*Released blocks must hash to their old value* (`ledger.ts:335-336`, `ledger.ts:566-573`): when damage is found, the
bad block's old hash moves to `expect`. When its bytes have been fetched again, the new hash must equal the old one.
If not, the file on the site changed: `mismatch` is set, every connection stops (`onMismatch` -> `halt`,
`ranged.ts:1160-1165`), the claims on that block are given back (`ranged.ts:935-938`), and the row reads File changed.

*Releasing a bad block* (`release()`, `ledger.ts:665-689`) splits the segment that holds it into three:
```
[seg.start, a)          received = a - seg.start          (the good part before)
[a, blockEnd)           received = 0                      (the bad block, to fetch again)
[blockEnd, seg.end)     received = what it already had past blockEnd
the old hashes go to expect (a "drop" line); the caller saves the new segment list, flushed, BEFORE fetching
```
*Other operations*: `rewind()` (after a crash: give back what each segment claims above its last contiguous hashed
block, `ledger.ts:695-711`); `newer(since)` (blocks hashed after a time, `ledger.ts:714-716`); `spot()` (section 13);
`retain()` (hashed blocks no longer under the claims go to `expect`); `forget()` (every hash dropped: the `.part` now
holds other bytes); `unhash()` (forget some, keep no expected value).

*The journal* (`Journal`, `ledger.ts:193-307`): append-only JSON lines in `<profile>/vitre-downloads/<id>.jsonl`
(never next to the person's files; RESUME-DESIGN.md decision 9). Line types (`ledger.ts:21-26`):

| Line | Fields | Written when |
|---|---|---|
| header | `{deer: 1, id, path, url, identity, total, bs, ct, name, etag, lm, t}` | a new record (first start, Start over) - flushed at once |
| block | `{b, h, w, a}` (index, 128-bit hash, head hash, when hashed) | each hashed block (queued; appended about every 2 s with the list save, unflushed, `VitreDownloads.sys.ts:4535-4539`; flushed at the next seal) |
| seal | `{cov: [[start, received, base?]...], t, f?}` (`f: 1` = the .part was flushed first) | each seal - flushed |
| drop | `{drop: [b...], why, forget?}` | blocks released (old value kept) or forgotten |
| decision | `{decision: 'restart' or 'keep' or 'repair', t}` | before a person's choice is carried out - flushed |
| repair / repaired | `{repair: [b...], t}` / `{repaired: [b...], t}` | before Repair writes / after - flushed |
| fin | `{fin: sha256, size, mtime, path, t}` | the finished file (in `<id>.done.jsonl`) |

Rules: lines wait in memory and are appended in one write (`flush(durable)`; `durable` = flushed to disk,
`ledger.ts:221-237`). A torn last line (a crash cut it) is skipped when reading, and the next append starts on a new
line (`ledger.ts:196-199`, `ledger.ts:287-306`). A header line starts the record again (Start over appends a new
header, `ledger.ts:401-407`). The journal is compacted (temp file, then a move, flushed) when it grows past twice what
it needs, and always at the finish (`ledger.ts:832-838`). A private download's journal has no path: it stays in memory.
A removed journal is never re-created by a late write, and a new journal at the same path waits for the removal
(`ledger.ts:200-213`, `ledger.ts:269-285`).

*Record for older partial downloads* (`recordFor()`, `VitreDownloads.sys.ts:1669-1720`): a partial download that has
no record yet gets one only after one window other than window 0 matched the site (window 0 was compared by the probe),
"so a part that is already damaged or mixed never becomes the reference". If that window cannot be asked, no record
is made yet and the run goes on.

**Why**

RESUME-DESIGN.md section 4 and decision 10 (owner, 2026-10-13): "block size clamp(pow2ceil(total / 2048), 1 MiB,
64 MiB); SHA-256 cut to 128 bits plus a 64 KiB head hash". Phase 5 spike (b) (quoted in `ledger.ts:16-18`):
`crypto.subtle.digest` "runs off the main thread, 64 MiB in 29 ms with at most 6 ms of main-thread lag, where
nsICryptoHash held it 5 ms per 4 MiB piece". The 128-bit block hash is a hash of chunk hashes, so the 64 small
chunk digests can run off-thread and only the tiny final step uses `nsICryptoHash` ("a few microseconds",
`ledger.ts:138-141`). `HOLD_ABOVE`: "hashing alongside a 2 GB/s local download slowed it by a quarter; below this rate
it costs nothing measurable (perf.js C, 100 MB/s on 4 GiB)" (`ledger.ts:57-62`). The `expect` rule is RESUME-DESIGN.md
4.3: "The new bytes must re-hash to the OLD recorded value; a mismatch is evidence of a change and goes to G3." Commit
31eed88 ("resume phase 5").

**Edge cases handled**

- Hashing never holds the `.part` open at the finish: `quiet()` stops new blocks and waits only for the at most 2 in
  flight, because "its rename at the finish would fail on Windows" (`ledger.ts:475-484`).
- A record whose total or block size no longer fits the file is not used (`inspect()`, `VitreDownloads.sys.ts:1621`)
  and is reset with a new header (`ledger.ts:442-455`).
- Keep partial cut the file shorter: at the finish only blocks whose span is the same under the new length keep their
  hash (`ledger.ts:787-802`).

**Proven by**

`tests/downloads/repair.js`: "a running download keeps its block hash record in the profile (<id>.jsonl), marked
dirty", "its header names the file, its length and 1 MiB blocks; the segments are cut at block boundaries", "the pause
drained the hashing and sealed: every whole block under the claims is hashed, the seal line has the coverage, the dirty
mark is cleared", "a journal whose last line was torn is read without it: every hashed block comes back as it was".
`tests/downloads/perf.js` was extended for throughput (commit 31eed88: "throughput equals the baseline").

---

## 12. Seals and the durable flush (FlushFileBuffers)

**What it does**

A seal is a checkpoint. It makes the `.part`'s cached data reach the physical disk, then writes a journal line saying
exactly which bytes are covered, then saves the list. After a seal that flushed, Deer knows those bytes survive a power
loss.

**How it works**

When (`ledger.ts:48-56`; `VitreDownloads.sys.ts:4518-4528`, `VitreDownloads.sys.ts:2606-2609`, `VitreDownloads.sys.ts:1576-1580`):
- `'timer'`: every `SEAL_EVERY = 30 s` of a run, or every `SEAL_BYTES = 256 MiB`, but the byte trigger never fires
  sooner than `SEAL_MIN_GAP = 5 s` after the last seal; not once every byte is in;
- `'stop'`: every stop that is not Cancel (pause, quit, sleep, disk error, any failure);
- `'final'`: before the final rename.

Steps of `seal()` (`VitreDownloads.sys.ts:1770-1809`), one at a time per row (the next run waits for it):
```
stop:   point the hashing at the exact segments (every writer is closed); drain it; detach
segs  = timer ? transfer.provable() : rec.file.segments
cov   = [[start, received, base?] for each segment with bytes]
at    = now                                   -- taken BEFORE the flush
files = the .part (or every part file in the parts layout)
flushed = (why != 'final') and every flushPart(file) returned true
ledger.sealed(cov, flushed, at): add {cov, t: at, f: 1 if flushed}, flush the journal to disk, maybe compact
stop:   rec.file.dirty = false; rec.file.unflushed = flushed ? undefined : at
not final: save the list, flushed
```
`flushPart(path)` (`ledger.ts:851-853`) asks a ChromeWorker (`gecko/src/workers/flush.js`) with a 15 s timeout. The
worker opens the file with `CreateFileW(path, GENERIC_WRITE, FILE_SHARE_READ|WRITE|DELETE, OPEN_EXISTING, ...)` (the
download's own writers may hold it open) and calls `FlushFileBuffers` (`flush.js:115-138`). If the worker is broken or
too slow, the answer is `false` and the seal says so (`f` missing).

The **dirty** mark: before a run writes its first byte, `rec.file.dirty = true` is saved, flushed
(`VitreDownloads.sys.ts:1563-1570`). Only a clean stop's seal clears it. If the mark is still set at the next start,
the stop was not clean (section 13).

**Why**

RESUME-DESIGN.md section 1: "Durability: correctness does not depend on fsync. If a spike proves FlushFileBuffers works
from JS, seals use it to shorten the re-check window." Phase 5 spike (a) (`ledger.ts:29-31`, `flush.js:5-7`):
"IOUtils' zero-byte append with flush does not reach the disk, 0-2 ms over 256 MiB of dirty pages where
FlushFileBuffers took 65 ms". The flush runs in a worker because js-ctypes on the main thread "would hold it for as
long as the disk takes (hundreds of ms on a hard disk or a USB stick)" (`flush.js:1-2`). The seal time is taken before
the flush: "a block hashed while FlushFileBuffers ran may hold bytes written after the flush started, so it must count
as newer than the seal" (`ledger.ts:746-750`). Review of Phase 5: "above about 1 GB/s every 256 MiB meant a seal ...
back to back, which slowed the download by a quarter" (hence `SEAL_MIN_GAP`); and the final seal neither drains nor
flushes because "above about 700 MB/s they held a finished download at 100% for seconds; the save alone added 15 ms
to every download" (`VitreDownloads.sys.ts:1762-1768`).

**Edge cases handled**

- A seal whose record was dropped meanwhile (Remove, Cancel, Start over) writes nothing more (`ours()`).
- A stop whose flush failed records `unflushed = at`. If that session then ends uncleanly, the row is marked dirty and
  checked as after a crash (`VitreDownloads.sys.ts:880-881`).
- At quit, `shutdown()` waits at most 5 s for runs to stop and 4 s for their seals; "one that does not finish leaves its
  row dirty, which the next start checks" (`VitreDownloads.sys.ts:5290-5295`).
- `flush.js` reads Windows error codes through a declared `GetLastError`, which IDM-WAY-DESIGN.md (line 36) says
  "js-ctypes does not keep reliable"; the `volume` and `copy` ops use `ctypes.winLastError`. Only the error *code* is
  affected, not the ok/failed answer.

**Proven by**

`tests/downloads/repair.js` (seal line, dirty cleared, "seal flushed the .part" logged), `tests/downloads/faults.js` ("the
disk error sealed the download's record: a seal line after it, the dirty mark cleared"), `tests/downloads/network.js`
("a paused row whose last seal could not flush, in the session that ended uncleanly, is marked to be checked as after a
crash").

---

## 13. Crash and power-loss recovery: the check before every resume

**What it does**

Before any resume asks the network, Deer checks the saved part against its record ("Checking the saved part and the
link"). After a crash or power loss it gives back only the bytes it cannot vouch for and re-checks only the blocks that
might be bad; it then fetches only those. A `.part` changed by another program is fully checked.

**How it works**

At start (`load()`, `VitreDownloads.sys.ts:837-881`): if the last session was unclean, rows that were downloading are
paused with `resumeOnStart = true`; a file row with a record and the dirty mark gets `suspect = {bytes: 0}` (the record
decides later); a row **without** a record falls back to the older rule `suspectTail()`: each segment gives back the
last `SUSPECT_TAIL = 8 MiB` (`waits.ts:44-48`, `waits.ts:63-71`, `VitreDownloads.sys.ts:5336-5342`).

`inspect()` (`VitreDownloads.sys.ts:1603-1660`), run by every resume of a file with saved bytes:
```
if the .part is gone: start over (history: "Started over: the saved part was moved or deleted"); drop the record
if no record, or its total / block size no longer fit: return (no record checks)
clamp each segment to the file's real size (each part file's, in the parts layout)
bad = {}
if file.dirty (the last stop was not clean):
    rewind(): each segment keeps only up to the end of its contiguous hashed blocks
    since = seal.t - (seal flushed ? 0 : UNFLUSHED_MARGIN = 2 min)      -- 0 when there is no seal
    bad += blocks hashed after `since` whose hash no longer matches
else if the .part's mtime > seal.t + MTIME_SLACK (5 s):                  -- changed while nothing ran
    rewind(); bad += every hashed block that no longer matches
always (spot check):
    bad += last SPOT_BELOW = 2 hashed blocks below each frontier that no longer match
    bad += SPOT_SEEDED = 2 hashed blocks placed by FNV(id) that no longer match
if a repair line has no repaired line after it: bad += those blocks that no longer match
retain(): hashed blocks no longer under the claims keep their hash as `expect`
release(bad): split segments around bad blocks (section 11)
history line: "Checked after Deer closed unexpectedly · N fetched again" / "The saved part was changed by
              another program · N fetched again" / "N damaged parts in the saved part · N fetched again"
if anything was given back: flush the journal and save the list, BEFORE any fetch
```
Constants: `UNFLUSHED_MARGIN = 2 min` (`ledger.ts:65-69`), `MTIME_SLACK = 5 s` (`ledger.ts:70-71`), `SPOT_BELOW = 2`,
`SPOT_SEEDED = 2` (`ledger.ts:72-74`). `spot()` (`ledger.ts:722-744`) walks down from each frontier to find the last 2
hashed blocks; the second seeded block uses `h = imul(h ^ 0x9e3779b9, 0x01000193)`.

The fetched-again blocks must hash to their old values (section 11). The run then continues normally.

Finished files too: `checkAfterStart()` (`VitreDownloads.sys.ts:5018-5036`), `CONTINUE_AFTER = 10 s` after start,
re-hashes (no network) every file that finished during the unclean session and every file whose Repair a crash cut
short, and keeps a finished record that a crash stopped before it was written.

**Why**

RESUME-DESIGN.md 4.2: "After an unclean session: hashed blocks newer than the last seal are re-hashed; claimed bytes
above a segment's last hashed block are rewound; without a proven fsync, the re-check also covers blocks hashed in the
2 minutes before the last seal. Windows writes dirty cache pages back within seconds; the margin is generous." The
spot check on *every* resume catches damage nobody announced (a disk error while paused, another program). Before
Phase 5 the rule was a blind 8 MiB tail per segment (`waits.ts:43-47`); the record makes it exact ("Phase 5: not 8 MiB a
segment", network.js).

**Edge cases handled**

- A stop whose flush failed in a session that later crashed counts as dirty (section 12).
- A repair cut by a crash is never read as "Changed after download": its own writes moved the mtime, so the record
  decides (`finished.ts:69-72`, `finished.ts:85-87`).
- In the parts layout, the mtime rule takes the newest mtime of all part files (`clampParts()`, `parts.ts:291-309`).

**Proven by**

`tests/downloads/network.js` run 4 (hard kill): "the row that was running comes back paused, marked to continue, with
its marks, its record and its dirty mark", "it completes intact: the corrupted bytes were found and fetched again",
"only what was missing and the damaged blocks below each mark were fetched again (Phase 5: not 8 MiB a segment)", "its
history says so". `tests/downloads/repair.js`: "only block 7 was fetched again: one request for exactly its range",
"its history says another program changed the saved part", "a .part deleted during a pause: it starts over without
asking, saying so". `tests/downloads/restart.js`: "the zeros are caught and fetched again: the file is intact (sha256)",
"the blocks the zeros were in were fetched again, from each segment's start" (the design's simulated power loss:
RESUME-DESIGN.md 8, "A power loss can only be simulated, with zero-filled blocks plus the dirty flag").

---

## 14. Resume after pause, quit, sleep and restart

**What it does**

A pause keeps everything. A quit pauses everything resumable and continues it 10 s after the next start (setting on
by default). A computer going to sleep pauses runs and continues them after the wake. Every resume goes through
"Checking" (section 13, then the probe of section 5).

**How it works**

- **Pause**: the run is aborted with reason `'pause'`; every connection closes its writer first, so counts are exact;
  then the stop seal (`stopped()`, `VitreDownloads.sys.ts:2527-2531`, `VitreDownloads.sys.ts:2606-2609`).
- **Quit** (`shutdown()`, `VitreDownloads.sys.ts:5258-5299`): renewal attempts stop; queued rows and running rows the
  person did not pause get `resumeOnStart`; a run that was asking with nothing coming in is noted as the wait it is
  (`noteStop()`); runs are aborted; wait at most 5 s for them and 4 s for their seals; `session.clean = true`; flushed
  save. At the next start, `continueAfterStart()` (`VitreDownloads.sys.ts:4467-4488`) queues the `resumeOnStart` rows
  `CONTINUE_AFTER = 10 s` after start (`waits.ts:42`) when "Continue unfinished downloads when Deer starts" is on, with
  the history line "Continued after restart". Rows the person paused stay paused. Rows with a wait continue by their
  wait (`WAIT_GRACE = 5 s` after start, `VitreDownloads.sys.ts:268`).
- **Crash**: as a quit (section 13), with the dirty/suspect rules.
- **Sleep** (`sleep()`, `VitreDownloads.sys.ts:4438-4459`): running rows stop with reason `'sleep'`; queued ones too;
  all get `wait = {for: 'sleep', nextAt: now + SLEEP_FALLBACK (1 min)}` (`waits.ts:36-40`). On `wake_notification`,
  `bringWaits('wake')` sets the next try to `WAKE_SETTLE = 10 s` later, or at once on network link-up
  (`VitreDownloads.sys.ts:4414-4431`, `waits.ts:35`). A link "changed" event alone does not end the settle, because
  "Gecko reports one on every wake, before the network is really back".
- **Network back**: every network wait's next try moves to `SOON = 5 s` (`waits.ts:27`). A Link expired row whose
  schedule ran out gets one more attempt, at most once per `RENEW_ON_LINK = 10 min` (`VitreDownloads.sys.ts:276-277`).
- The "Checking" label appears only after `CHECKING_AFTER = 400 ms`, so a fast resume never flickers
  (`VitreDownloads.sys.ts:271-272`).
- Slept time is not active time: a tick counts at most 2 ticks of 250 ms (`VitreDownloads.sys.ts:4498-4499`).

**Why**

RESUME-DESIGN.md G4 and the owner's decision 5 (2026-10-13: continue downloads a quit or a crash stopped, 10 s after
the first window; rows the person paused stay paused). The quit prompt already promised it (RESUME-DESIGN.md
section 1). The 5 s / 4 s limits keep quitting fast; an unfinished seal is caught by the dirty rule.

**Edge cases handled**

- A wait's automatic try that a quit caught on its check comes back as that wait, not as "continue after restart"
  (`rec.trying`, `VitreDownloads.sys.ts:2532-2546`, `VitreDownloads.sys.ts:856-861`).
- A sleep whose wake never comes continues after 1 minute (`SLEEP_FALLBACK`).
- Pause then Resume before the connections stopped: "the last word wins" (`VitreDownloads.sys.ts:2527-2530`).

**Proven by**

`tests/downloads/network.js` runs 2-4: "run 2: both come back with their bytes; the one the quit stopped is marked to
continue, the paused one is not", "the download the quit stopped continues by itself about 10 s after the start
(Continued after restart)", "with the setting off, the download the quit stopped stays paused".
`tests/downloads/restart.js`: "it is paused, with its bytes and segments", "every request after the restart carries
If-Range", "only what was missing was fetched again". `tests/downloads/network.js` also: "checking: in its first 400 ms
a resume shows its dimmed bar at the old percentage, no word yet".

---

## 15. Retrying "like IDM" (the owner's decision of 2026-10-21)

**What it does**

Inside a running multi-connection download, a failing connection never stops the others and Deer never gives up by
itself on network trouble or a site error. A dropped connection is asked again at once; a part the site fails on is
asked again after 4 s, 8 s, 12 s ...; a connection the site turns away (it allows fewer connections) steps aside and
keeps asking. Failures that asking again cannot fix still end the run.

**How it works**

`classOf(err)` (`gecko/src/modules/downloads/retry.ts:40-57`) and the loop in `fetchSegment()`
(`ranged.ts:1316-1459`):

| Class | Errors | Wait before the next ask | What the connection does |
|---|---|---|---|
| `cut` | `ShortBodyError`; Necko `NS_ERROR_NET_RESET`, `NET_INTERRUPT`, `NET_PARTIAL_TRANSFER`, `NET_TIMEOUT`, `NET_TIMEOUT_EXTERNAL` (`CUT_CODES`, `retry.ts:33`) | `AT_ONCE_MS = 10 ms` (`retry.ts:24`). If the answer made progress, no failure is counted | Same segment, without limit (`ranged.ts:1384-1394`) |
| `network` | `NS_ERROR_UNKNOWN_HOST`, `OFFLINE`, `CONNECTION_REFUSED`, `UNKNOWN_PROXY_HOST`, `PROXY_CONNECTION_REFUSED` (`retry.ts:35`) | 10 ms; while Firefox/Windows says offline, at least `OFFLINE_MS = 30 s` or until the network comes back (`retry.ts:27`, `retry.ts:177-186`) | Same segment, without limit |
| `server` | 408, 425, every 5xx except 501, 503, 505 (`retry.ts:53`) | `STEP_MS x k` = 4 s, 8 s, 12 s ... (`retry.ts:25`), k counted per class; or the server's Retry-After if longer, at most `RETRY_AFTER_MAX = 24 h` (`retry.ts:26`, `retry.ts:60-64`) | Same spot, on a **new** connection (`laneGen + 1`), without limit; the others may split its segment meanwhile (`ranged.ts:1395-1404`) |
| `refused-start` | 429, 503 (`retry.ts:52`) | Same 4 s x k gaps, or Retry-After | Gives its segment back and **stands by** (`StandbyError`). It asks again at its time, or at once when any answer of this download that brought bytes ends (the **nudge**), on Try now, or when a connection finds no work left. A nudged ask that is refused again keeps its own schedule and count (`ranged.ts:1405-1412`, `ranged.ts:1219-1242`, `ranged.ts:1493-1498`) |
| `refused-address` | 401/403/404/410/451, an expired 400, a page where the file was | First `afterRefusal()`: a 403 gets **one** retry at the same address after 2 s, only while the link's expiry is unknown or ahead; otherwise the renewal hook (section 20). If nothing is renewed: the server gaps (4 s x k) | Stands by while another connection received bytes in the last `MOVING_MS = 10 s` and the link's expiry has not passed (the host limits connections); otherwise the run ends: **Link expired** (`ranged.ts:1413-1443`) |
| `challenge` | Cloudflare "checking your browser" / block | none | The run ends (Link expired path) |
| `other` | Any other retryable failure: a blocked port, a redirect loop, a 206 at the wrong place (`RangeMismatchError`) | `backoff()`: 2 s, then 6 s; `ATTEMPTS = 3` (`ranged.ts:98`) | Then this connection leaves; the last one ends the run (`ranged.ts:1444-1456`) |
| `fatal` | `AbortedError`, `DiskError`, `ChangedError`, `RangeIgnoredError`, TLS/certificate errors, a malformed URL, any other HTTP status | none | The run ends at once (`ranged.ts:1365`, `ranged.ts:1383`) |

Pseudo-code of one connection (simplified from `ranged.ts:1316-1459`):
```
while segment not complete:
    if validators are not trusted: spotCheck()                       -- section 6
    rejoin()                                                         -- section 16: proof after a quiet stretch
    try pull(segment)                                                -- Range from frontier, If-Range
        if it brought bytes: k = 0, per-class counts = {}
    catch err:
        if tick() cut this answer (stall/slow): ask again now, no failure
        if err brought >= PROGRESS_MIN (1 MiB) or brought bytes for >= PROGRESS_MS (5 s): reset k and counts
        cls = classOf(err)
        cut/network:    k += 1 unless progress; nextAt = now + 10 ms
        server:         k += 1; new connection; nextAt = now + max(4 s * count[server], Retry-After)
        refused-start:  nextAt = now + max(4 s * count, Retry-After) unless this was a nudged ask; stand by
        refused-address: one 403 retry / renewal / stand by / end the run (see table)
        other:          up to 3 attempts (2 s, 6 s), then leave
        fatal/challenge: end the run
        waitToAsk(cls, nextAt - now)                                 -- sleep, then one token of the pacer
```
**The pacer** (`retry.ts:84-142`): every ask that follows a failure takes one token from a token bucket shared by all
of Deer: `GLOBAL_RATE = 150` a second, burst 150 (`retry.ts:28`). Waiters queue in order behind one timer. The clock
is monotonic (`ChromeUtils.now()`).

**Network back** (`retry.ts:147-171`): a signal that fires on `network:offline-status-changed` (not to "offline") and
`network:link-status-changed` ("up" or "changed"); network waits are woken by it.

The **probe** and the proof fetches still use the older rule: 3 attempts; network errors 1 s apart; statuses wait
`backoff()` = 2 s, then 6 s (its third step, 15 s, is never reached with 3 attempts), or Retry-After up to
`IN_RUN_WAIT = 60 s` (`net.ts:856-862`). A 429/5xx whose
Retry-After asks for more than 60 s stops the probe at once, so the row waits at the server's time (`serverStops()`,
`net.ts:871-874`). After the probe's 3 tries the row waits outside a run (section 16). (IDM-WAY-DESIGN.md status line:
"the start's probe still has its 3 tries, then the 30 s waits".)

**Why**

The owner measured IDM 6.43 on 2026-10-20/21 (`gecko/spikes/downloader/IDM-BENCH.md`, IDM-WAY-DESIGN.md section 2):
a reset retried at 0.01 s; a 500 on one part retried at +4, +8, +12 s while others go on; a 503-limited site asked
again on gaps growing by 4 s, plus "re-sent at once whenever one of its own answers ends"; failed queue items every
30 s without limit. The owner chose "exactly like IDM" (commit 4bcd891). What was *not* copied, on purpose
(`retry.ts:12-15`): IDM's endless ~1,700 asks a second when a file's size changed (Deer says File changed); IDM's weak
check after an outage (only 64 overlapping bytes, no If-Range, and a restart from zero on a mismatch; Deer proves a
window first, section 16); asking while Windows says there is no network. The 150/s cap: "Necko itself sends a request
that was reset at once up to 10 times (network.http.request.max-attempts), so in a local outage the server sees about
ten times as many: 150 asks a second come to about IDM's 1,270 a second (measured 2026-10-21; the main thread showed no
lag to speak of up to 800 asks a second)" (`retry.ts:15-18`). Per-class counts: "an outage's thousands of cuts made the
next 503 wait for hours" (`ranged.ts:185-187`). Monotonic clock: "a wall-clock step back stalled every ask"
(`retry.ts:75`). Challenges: asking again "raises the address's bot score" (`net.ts:775-778`).

The design (IDM-WAY-DESIGN.md 3.2) had proposed softer pacing (per-site buckets of 20/s, a global 40/s, a 250 ms floor
per connection, a 20 ms first re-ask of a refused start, and a "hold" with scouts). Its status line says these were
**not built**: the owner chose "Exactly like IDM", the only cap is the 150/s pacer, and the first re-ask of a refused
start is after 4 s "as the 2026-10-20 and 2026-10-21 logs show".

**Edge cases handled**

- A connection already standing by on an address does not spend the run's renewal budget on it again
  (`conn.refusedUrl`, `ranged.ts:1418-1419`).
- With nothing saved yet (or no renewal hook), a retryable refusal (403) still gets its 3 attempts: "a fresh download
  failed at once on a 403 that came before any connection's first byte" (`ranged.ts:1426-1432`).
- Standing-by connections wake when another connection finds no work, so a finished download never sits at 100%
  (`ranged.ts:1152-1159`).
- The decision to leave and the counts that let the next connection decide are one synchronous step: "lanes woken by
  one shared renewal all saw 'others still here' and all left together" (`ranged.ts:1172-1173`).
- A capped 206 continues where it ended with no failure (`ranged.ts:1787-1791`).

**Proven by**

`tests/downloads/connections.js`: "the failing spot was asked again after about 4, 8, 12 ... s (IDM: +4, +8, +12), the
others going on", "... each time on a new connection (another port)", "each reset is followed by the next ask within
0.5 s", "520: asked again on the site error's gaps", "404: that connection stood by", "3 allowed: completed intact,
never paused ... the connections turned away stood by and kept asking", "Retry-After: 12 on one part: that spot is not
asked again before 12 s", "resets then 503s: completed intact within about 4 s of its last 503 (a 503's gap counts only
503s)". Bench: `limit503` scenario, IDM 128.6 s with 71 refusals, Deer 128.3 s (IDM-BENCH.md results table).

---

## 16. Quiet stretches: "Waiting for network" / "Retrying", the rejoin proof, and waits outside a run

**What it does**

When nothing has arrived for 10 s and every connection is failing, the row says "Waiting for network" or "Retrying ·
in N s", but the run keeps going. When the site answers again, Deer first compares one 64 KiB window of the saved bytes
with the site, then continues. Downloads that a quit, a crash or sleep stopped wait outside a run and are tried every
30 s, for ever.

**How it works**

- `retrying()` (`ranged.ts:1511-1522`): `since = max(lastByteAt, runAt)`; if `now - since >= HOLD_AFTER_MS (10 s)`
  (`retry.ts:29-30`) and every live connection failed after `since`, it returns `{for: 'server'` if any connection's
  last failure was server/refused-start/refused-address, else `'network', tries, nextAt, status}`. The row shows it.
- **Try now** = `poke()`: every waiting connection asks at once (`ranged.ts:1500-1505`).
- **Quit** during such a stretch: `noteStop()` keeps it, and the row comes back as that wait (`ranged.ts:1524-1529`,
  `VitreDownloads.sys.ts:2532-2546`).
- `rejoin()` (`ranged.ts:1469-1490`):
  ```
  last = max(lastByteAt, runAt, provedAt)
  if now - last < 10 s or nothing saved: return
  one proof at a time (every connection waits for it):
      w = windows(provable bytes)[0]                -- the first planned window (block 0's head)
      compareWindows([w], attempts = 1)
      changed -> throw ChangedError (File changed); whole -> drop it; unknown -> go on
      provedAt = now
  ```
- **Waits outside a run** (`gecko/src/modules/downloads/waits.ts`): `waitNext() = now + max(QUEUE_RETRY = 30 s,
  Retry-After up to 24 h)` (`waits.ts:25`, `waits.ts:54-57`); `SERVER_GIVE_UP = Infinity` (`waits.ts:29`); the count
  (`wait.tries`) starts again after `FRESH_AFTER = 8 MiB` of progress (`waits.ts:33`) or on Try now. `waitAgain()`
  (`VitreDownloads.sys.ts:2627-2652`) sets them.

**Why**

IDM-WAY-DESIGN.md section 1: "When nothing gets through for 10 s, the download waits without stopping ... When the site
answers again, Deer compares one 64 KiB piece with what is saved and goes on". The rejoin proof is Deer's answer to
IDM's weak outage check: "so a file swapped during an outage is never written into (IDM only compared 64 overlapping
bytes, and started over from zero on a mismatch)" (`ranged.ts:1462-1468`). The quiet stretch counts from the run's
start and from the last proof too: "a stretch before the run's first byte was never proved" and "a proof that passed
with no byte after it covered a second outage" (`ranged.ts:1471-1472`). The 30 s rhythm is IDM's queue (owner's
decision of 2026-10-21, `waits.ts:7-13`); it replaced 10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min, and the
24-hour give-up was dropped because "IDM retries without limit".

**Edge cases handled**

- A wait's automatic try ends its *check* at the first 429/5xx (`waitTry`, `ranged.ts:441-446`), because the wait
  already spaces the tries.
- Note: the engine's header comment (`VitreDownloads.sys.ts:111-118`) and the doc comment of `waitAgain()`
  (`VitreDownloads.sys.ts:2616-2626`) still describe the older 10 s ... 10 min schedule and the 24 h give-up; the code
  in `waits.ts` (30 s flat, never give up) is what runs.

**Proven by**

`tests/downloads/network.js`: "drop: a network that went away reads Waiting for network (paused, wait 'network')
within about 11 s, never Failed, while its run keeps asking (IDM's way)", "Try now keeps the same run asking (no new
Checking)", "when the network is back it continues by itself within about 3 s ... completed intact: only the missing
bytes fetched, after one window proved the saved bytes", "offline: switched offline, a running download reads Waiting
for network". `tests/downloads/connections.js`: "an outage on every connection reads Retrying (paused, wait 'server')
within about 12 s, while its run keeps asking".

---

## 17. Cutting stalled and slow connections ("slow cut")

**What it does**

Every 2 s each answer's speed is compared with the other connections. A connection that went silent, or crawls far
below the others, is cut and asked again at once on a new connection, with no failure counted.

**How it works**

`tick()` every `TICK_MS = 2000` (`ranged.ts:1606-1694`); constants `ranged.ts:136-151`:
```
stall: after the answer's FIRST BODY BYTE, no bytes for STALL_TICKS = 5 ticks (10 s),
       while the others' median >= BUSY_RATE (64 KiB/s) and another lane received bytes in those ticks,
       and this lane was not cut in the last RECUT_GAP (60 s)                      -> cut
slow:  after the first body byte, over SLOW_TICKS = 8 ticks (16 s):
       rate < max(SLOW_FLOOR = 8 KiB/s, SLOW_SHARE = 0.25 x others' median), median >= 64 KiB/s,
       remaining >= RECUT_MIN (256 KiB), remaining/rate >= RECUT_SECS (8 s) and >= 2 x remaining/median,
       not cut in the last 60 s, writer backlog <= 2 MiB                           -> cut
never judged: while a speed limit holds the speed down, or when Deer itself held the answer
              (disk or limit) for more than HELD_SHARE = 50% of a tick
a lone answer is judged against the last busy median for BUSY_MEMORY_MS = 30 s
cut = new connection generation (new socket even on HTTP/2), destroy the answer, mark "recut";
      fetchSegment() asks again at once with no failure
```
**"No slow cut before the body"** (commit e90608e, 2026-10-20): "The slow rule counted the ticks before an answer's
body began, so a late body was cut as slow; it now waits for the first byte, as the stall rule does, and judges only
the ticks since." The samples restart at the first byte (`ranged.ts:1738-1742`).

**Why**

IDM-BENCH.md: a tester saw big files "losing speed mid-download where IDM stayed steady". IDM never replaces a crawling
connection and cuts a silent one only at 30 s; the owner kept Deer's faster cuts (IDM-WAY-DESIGN.md question 1, taken
as recommended). Bench: `crawl` IDM 45.3 s vs Deer 34.2 s; `stall` 36.6 s vs 34.3 s. "A fixed 4 MiB floor kept a
crawler on a 3 MiB segment, which then decided when the whole download ended" (`ranged.ts:125-126`).

**Edge cases handled**

- On a crawling line (TLS records seconds apart) silence is left to the 30 s idle timeout (`IDLE_TIMEOUT_MS`,
  `net.ts:172`), because the stall rule needs other lanes to be receiving.
- An answer that ended no longer counts while its writer drains (`ranged.ts:1767-1768`).
- Per-lane speed windows across answers, so hosts that cap each answer do not blind the rule (`ranged.ts:1619-1627`).

**Proven by**

`tests/downloads/connections.js`: "the crawling connection was cut and asked again", "the silent connection was cut
after about 10 s of silence (the idle timeout took 30 s)", "control: an even 96 KB/s on every connection is never
cut", "a body that starts 16 s after its head is not cut as a stall or as slow".

---

## 18. Aborts that come early are never lost ("early aborts kept")

**What it does**

A Pause or Cancel pressed while Deer is still preparing (sizing the `.part`, marking it sparse) or after the last byte
but before the rename is honoured: the run stops, nothing is placed.

**How it works**

- After `openPart()` (which awaits the sparse call), `downloadTo()` checks `signal.aborted` and stops
  (`ranged.ts:916-918`). `runRanged()` also aborts its own controller at once if the signal was already aborted
  (`ranged.ts:1145`): its abort "relay" was added after the abort fired and would never have heard it.
- After the download and the final seal, `runFile()` checks again before the rename (`VitreDownloads.sys.ts:1582-1584`):
  a Pause leaves the row paused at 100% with every byte saved; a Cancel removes the `.part` and the record.
- Draining the hashing never delays Pause/Cancel: `untilAborted()` (`ranged.ts:2029-2045`).

**Why**

Commit e20b1ca (2026-10-21, "room asked at once, early aborts kept"): "A Pause or Cancel while the .part was readied
stops the run (runRanged never heard an abort that came before it)." Review of Phase 5 for the rename window.

**Edge cases handled**

- Pause then Resume before connections stopped: the row is queued again ("the last word wins").

**Proven by**

`tests/downloads/repair.js`: "Cancel that comes once every byte is in, before the rename, is honoured: cancelled,
nothing placed, the .part and the record gone", "Pause that comes once every byte is in, before the rename, is
honoured: paused with every byte saved, nothing placed", "... Resume then completes it intact".

---

## 19. Expired links: reading the expiry time from the URL

**What it does**

Many download links are signed and stop working at a known time, and that time is written in the link itself. Deer
reads it, so it can renew an expired link *before* asking it (saving several seconds of doomed 403 retries), and so it
never wastes its one same-address 403 retry on a link that is certainly dead.

**How it works**

`expiresAt(url)` (`gecko/src/modules/downloads/expiry.ts:16-52`), case-insensitive parameter names, first match wins:
```
S3 / Google V4:  X-Amz-Date or X-Goog-Date = "20261014T093000Z" (UTC), plus X-Amz-Expires / X-Goog-Expires = seconds (1-9 digits)
                 -> signed + seconds * 1000
Azure SAS:       se = ISO time, only when sig= is present                -> Date.parse(se)
Akamai:          hdnts= or __token__= containing "exp=<9-13 digits>" between "~" separators -> epoch
plain:           Expires (S3 V2, CloudFront), exp, e = 9-13 digits      -> epoch
epoch(v): ms if v > 1e12 else seconds * 1000; accepted only within [now - 1 year, now + 10 years]
0 when nothing reads as such a time
expiredAt(url) = expiresAt(url) > 0 and <= now
```
Used: at resume (`probe()`: renew before the first request when the final address is expired, `ranged.ts:565-567`);
for the one 403 retry (only while the expiry is unknown or ahead, `ranged.ts:702`); for standing by on a refused
address (`ranged.ts:1417`); to skip dead addresses in the renewal list (`renew.ts:83`); and to record
`address.expiresAt` (`ranged.ts:770`, `renew.ts:131`).

**Why**

RESUME-DESIGN.md 3.0: "If that time has passed at resume, Deer renews before its first request. This skips the roughly
8 s of 403 retries." The plausibility window on plain epoch values avoids reading an unrelated `e=5` or an id as a time.
"403 keeps exactly one retry at the same address, because cookies are read live on every request ... and only while the
expiry time is unknown or still in the future."

**Edge cases handled**

- Azure's `se=` is ignored without `sig=` (it could be any parameter).
- Seconds and milliseconds epochs are both accepted.

**Proven by**

`tests/downloads/expiry.js`: "a pause past expiry, then Resume: the original address is asked first, the dead one
never", "control: a resume of an unexpired, unchanged signed download makes 2 requests, as before".

---

## 20. Renewing the link: the original address, the schedule, and adopting a proven address

**What it does**

When the address stopped working (refused, a page instead of the file, or expired), Deer asks the address the download
came from, and every redirect hop recorded on the way, again. The server's redirects lead to a fresh final address.
That answer is proven to be the same file (section 3), then adopted; the download continues where it was, under the
same name. Inside a run this happens once for all connections; outside a run it is retried on a schedule.

**How it works**

- `addresses(recUrl, state, failing)` (`renew.ts:80-87`): `[state.url, recUrl, ...state.chain]`, without duplicates,
  only http(s), never the address that just failed, never one whose expiry time has passed.
- The redirect chain (at most 8 hops, `CHAIN = 8`, `renew.ts:67`) is recorded by the first probe (`learn()`,
  `ranged.ts:742`) and refreshed on resume when present (`ranged.ts:768`).
- `originalAddress()` (`renew.ts:95-103`): each address through `proveAddress()`; the first `same`, `changed` or
  `unknown` decides; refused, page and unreachable lead to the next; `failed` when none gave the file.
- `adopt()` (`renew.ts:122-132`): the old address goes to `address.history` (at most `HISTORY = 5`); `finalUrl`,
  chain, ETag, Last-Modified (and digest, if any) become the new answer's; `url` changes for every kind except
  `'original'` and `'ytdlp'` (so for `'pasted'`, `'page'`, `'link'` and also the page step's `'background'`;
  `renew.ts:126`); segments, total and `.part` are untouched.
- **In a run** (`renewInRun()`, `VitreDownloads.sys.ts:3282-3317`): through a per-run `Gate` (`renew.ts:139-163`):
  single-flight (every connection that hit the dead address waits for the same attempt); within `GAP = 10 s` of the
  last attempt callers get its result again; at most `PER_RUN = 3` attempts per run. A failure is remembered for
  `FORGET_FAILURE = 30 s` per download (`renew.ts:63`, `renewFailed`). SAME: adopted, history "New link found", every
  connection continues at the new address without using up a retry. CHANGED or UNKNOWN: a `ChangedError` with the
  candidate address (File changed). The row reads "Renewing link" meanwhile.
- **Outside a run** (`episode()`, `VitreDownloads.sys.ts:3334-3430`): the same original-address step, then (if
  installed) yt-dlp's formats of the page, then the background page step. `SCHEDULE = [0, 2 min, 13 min, 45 min,
  300 min]` (`renew.ts:58`): attempts at the failure, then 2 min, 15 min, 1 h and 6 h after it. `nextTry(tries)`
  returns 0 once the 6 h attempt has failed: then only on wake, network link-up (at most once per 10 min) or a manual
  action. The count
  (`wait.tries`) is saved with the row, so it survives restarts.
- **Asking the person** (manual fallback): "Refresh address" runs an attempt at once; if that fails and the download
  has a source page, Deer opens the page in a visible tab of the same container and waits 30 minutes for the person to
  start the download again (section 21). "Use another address..." proves a pasted address and says "That address is a
  different file", "answers with a web page", or "Deer couldn't reach that address" (RESUME-DESIGN.md G1).

**Why**

RESUME-DESIGN.md 3.0 and G1: "This fixes 'download?id=' redirectors, release links, share links and CDNs that sign each
request." Single-flight copies the stream code's `refreshed()`; "A failure is remembered for 30 s (REF
HLSDownload.swift:881-889)" - that is, a rule taken from the owner's own Swift code (TitleLess) (renew.ts header). The
schedule is the owner's decision 8 (2026-10-13). "After a SAME verdict, the transfer adopts the new validators before
any connection retries. Otherwise If-Range with the old ETag at a new edge would read as changed."

**Edge cases handled**

- A download whose only address is the expired signed one has nothing to ask (`addresses()` skips it), so it goes
  straight to the manual steps.
- A host that passes the proof but refuses the transfer is not asked every 2 minutes: the schedule carries on
  (`renewTries`, `VitreDownloads.sys.ts:2550-2566`).
- R7 with at most 1 MiB saved starts again from the original address (`VitreDownloads.sys.ts:3404-3415`).

**Proven by**

`tests/downloads/expiry.js`: "expiry during a run on 8 connections: exactly one request to the original address, and
the download completes intact", "nothing was fetched twice: the connections carried on from where they were", "the
attempt that fell due asked the original address once, found nothing, and planned the next 13 minutes on", "after a
restart the Link expired row is back with its attempt schedule", "a fresh signed address pasted into Use another
address attaches: the same row completes intact under its name".

---

## 21. Attaching a download started again on its page (and the "Keep partial" helpers)

**What it does**

When a link cannot be renewed automatically, the person can start the download again on its web page (a click,
Alt+click, Add link, a copied link). Deer recognises it as the waiting row's file, proves it with bytes, and continues
the old row: one row, no "name (1)" file, only the missing ranges fetched.

**How it works**

`score(waiting, start)` (`attach.ts:98-113`) only **nominates** a candidate; the byte proof decides:

| Signal | Points |
|---|---|
| The start happened in the tab Refresh address opened (armed `browserId`) | +5 |
| A name stem in common (file name, server name, last path segment of any address) | +3 |
| The same source page (without `#fragment`) | +2 |
| The same path shape (`scheme://host/path`, no query) as any of the row's addresses | +3 |
| The same site (eTLD+1) | +1 |

`PRE_MATCH = 5` points or more is a pre-match (`attach.ts:24`). A name **stem** is lower case, without extension and
without the " (n)" Deer adds for duplicates; opaque names say nothing: `download, file, index, get, dl, attachment,
media, video, audio`, and any 16+ character hex token, give an empty stem (`attach.ts:61-66`).

`realFile(row, start)` (`attach.ts:158-164`) is stricter: may *other bytes* make the waiting row File changed? Only if
the same page, the same server name when both servers gave one (Content-Disposition), and a real file name in common
(never a script name like `fetch` from `/fetch?id=1` or Drive's `uc`) (`attach.ts:125-144`). Otherwise the new download
is unrelated and gets its own row.

The engine holds the "added" event until the proof (about 0.3-2 s, RESUME-DESIGN.md G1), so the window does not show a
row that would vanish. Hard rules: same private flag and container, one-file mode (RESUME-DESIGN.md 2.1).

`unbroken(segments)` (`attach.ts:171-178`): the bytes saved without a gap from byte 0. `partialName()` (`attach.ts:181-185`):
`song.mp3` -> `song (partial).mp3`.

**Why**

RESUME-DESIGN.md G1 manual fallback, IDM's "Refresh download address". Review of Phase 3: "an unrelated download
behind the same endpoint was swallowed as the waiting row's changed file" (`attach.ts:12-16`), hence `realFile()`'s
rule that an address's last path segment nominates but never names the file.

**Edge cases handled**

- Another container never attaches; private records are never written (attach.js tests).
- A start with no page (Add link, a copied link) can never be "the real file of another version".

**Proven by**

`tests/downloads/attach.js`: "the click on the page is caught and continues the waiting row", "one row: no new record,
no 'added' (no new-row flight), one 'attached' for the old row", "it completed intact under its own name, with no ' (1)'
file", "an unrelated download clicked in the armed tab makes a new row of its own", "the same name over other bytes,
clicked on the page: the old row becomes File changed, no new row".

---

## 22. Sparse `.part`, clearing the mark at the end, and the room check ("room asked at once")

**What it does**

On NTFS the `.part` is sized to the whole file and marked **sparse** before any connection writes, so a connection
writing far into a big file never waits while Windows writes zeros up to that point. At the end the mark is cleared,
so the finished file is an ordinary one. Before writing, Deer checks the disk has room for what is still needed,
counting what other downloads on the same disk still need.

**How it works**

`openPart()` order for a ranged download (`ranged.ts:974-1023`):
```
choose the layout if nothing is claimed yet (section 23)
clamp segments to the .part's real size; refuse claimed > total (another file)
allowFresh and nothing saved: truncate the .part to 0 (its room is given back BEFORE the room is counted)
holds  = bytes of disk the .part takes now = heldBytes(part)  (GetCompressedFileSizeW; 0 if new/emptied)
needed = total - holds        (or total - written when the disk can't tell)
others = for every other ranged download still writing on the same volume: its total - its held bytes
ensureRoom(dir, needed + others)        -- free space must be >= bytes + 16 MiB, else
                                        -- "Not enough space on the disk. X more is needed."
setSize(part, total)                    -- create/extend; no data written
register in `filling` (counted by other downloads' room checks)
sparsePart(part)                        -- worker: DeviceIoControl(FSCTL_SET_SPARSE); 5 s timeout
```
- `heldBytes()` (`partfile.ts:137-166`) calls kernel32 `GetCompressedFileSizeW` through js-ctypes on the main thread:
  "a question about the file's metadata, as freeSpace() is, so it is asked here and at once". `-1` when it cannot tell.
- `freeSpace()` is `nsIFile.diskSpaceAvailable`, or `Infinity` when it will not say (`partfile.ts:128-135`).
- `volumeOf()` groups paths by drive letter or `\\server\share`, also behind `\\?\` and `\\?\UNC\` (`ranged.ts:2102-2106`).
- A single stream with saved bytes needs room for the **whole** new answer (it goes to `<part>.new`,
  `ranged.ts:997`). The parts layout needs `total - written + extra`, where `extra` is the largest part other than
  the first ("the join copies a part before it deletes it", `ranged.ts:1094-1105`).
- `sparsePart()` returns `true`/`false`, or `null` when the worker did not answer in 5 s ("the call still runs when the
  worker reaches it, so the file may yet be sparse", `ledger.ts:855-863`). On FAT/exFAT the call fails and the
  download goes on as before.
- `unsparsePart()` (`ledger.ts:865-871`; `flush.js:128-132`: `FSCTL_SET_SPARSE` with `SetSparse = FALSE`): before the
  finished `.part` is moved into place (5 s timeout); if it did not answer, it is run again on the moved file (60 s
  timeout, not awaited) (`VitreDownloads.sys.ts:2261-2274`). Keep partial clears it after the cut; "Keep file" of a
  Safe-Browsing-blocked file clears it too.

**Why**

Commit 7805625 (2026-10-20, compared with IDM 6.43): "A tester saw big files slow to start". NTFS "writes zeros from
the file's valid data length up to any write beyond it, inside that write, so the connections far into a big file
waited minutes (3.4 s at 35 GB on an NVMe drive; about 7 minutes for 70 GB on a hard disk). A sparse file has no such
fill: 0 s, also for a .part that was sized before it was marked" (`flush.js:8-13`). IDM-BENCH.md gives "15 s at 1.5 GB,
47 s at 6 GB on a hard disk; about 10 minutes for 70 GB" (the two sources differ for 70 GB). Unsparse: "Windows refuses
to mount a sparse ISO, VHD or VHDX" (`flush.js:15-16`). Room: "without this check a download on a full disk dies at 100%"
(`ranged.ts:2124`). Three review rounds: e90608e ("counting the sized .part as reserved let a resume or a second
download run out of room midway"), 5a6cb80 (other downloads' room "was counted twice and could refuse a download that
fits"; "An emptied .part gives its room back before the room is counted"; Keep partial clears the mark after the cut
"so no hole that is about to go is zero-filled"), e20b1ca ("room asked at once": through the flush worker the question
"waited behind other downloads' flushes and was then not known").

**Edge cases handled**

- A `.part` sized by an older run is still marked sparse (no zero-fill even then).
- The worker opens the file with every share mode, because the download's own writers hold it (`flush.js:23-24`).
- Start over keeps the old part only if there is room for the whole new file (`hasRoom`, section 7).

**Proven by**

`tests/downloads/connections.js`: "the .part of a ranged download is sparse", "the finished file is not sparse (Windows
mounts ISO/VHD only when it is not)", "a fresh download needs room for the whole file", "a second download on the same
disk counts the room the first still needs, once", "a resumed sparse .part counts the room it does not hold yet", "a
resumed parts download counts what it has not written, plus its join's largest part". `tests/downloads/attach.js` (per
commit 5a6cb80): the kept file is not sparse, its `.part` was.

---

## 23. Part files on drives without sparse files (FAT32, exFAT)

**What it does**

On a USB stick, SD card or share without sparse files, Deer keeps the download as IDM does: `<name>.part` holds the
part that starts at byte 0, and each other part is its own file `<name>.parts\<start in hex>.part`, each written only
at its end. After the last byte, the parts are added to `<name>.part` in order (the row shows "Saving"). A pause, quit,
crash or power cut at any moment loses nothing.

**How it works**

- Detection (`gecko/src/modules/downloads/parts.ts:81-138`): a separate ChromeWorker per query runs
  `GetVolumePathNameW` + `GetVolumeInformationW` (`flush.js:55-66`); 10 s timeout; answers cached 60 s.
  `sparse = flags & FILE_SUPPORTS_SPARSE_FILES (0x40)`; FAT/FAT12/FAT16/FAT32 have `maxFile = 0xFFFFFFFF`.
  `layoutFor()`: no sparse files -> `'parts'`; unknown (timeout, error) -> in place.
- Decided only when no bytes are claimed (first start, Start over, quiet restart, a row paused before its first
  byte); never changed after (`ranged.ts:976-978`). A file bigger than the drive can hold is refused before anything is
  written: "This file is X, and the drive it is saved to (E:, FAT32) can't hold a file of 4 GB or more. Choose another
  folder ..." (`ranged.ts:1037-1039`).
- Model: `Segment.base` = the start of the part file holding it; local offset = `start - base` (`ranged.ts:234-238`,
  `parts.ts:8-11`). Part file names are strict lowercase hex (`partBase()`, `parts.ts:34-39`), so a foreign file in the
  folder is never taken for a part or deleted. Every read by file offset goes through one registry (`useParts()` ->
  `partfile.ts` `placeOf()`), so proofs, block hashes and checks need not know the layout.
- `openParts()` (`ranged.ts:1056-1111`): clamp each segment by its own file; a piece whose part is shorter than where
  it starts gets a part of its own (never a write past a file's end = never a gap); part files no segment refers to are
  deleted; room check including the join's largest part.
- The join (`joinParts()`, `parts.ts:186-249`; called from `ranged.ts:1118-1138` after the hashing is drained):
  ```
  walk segments from byte 0 while they run on without a hole:
      for a segment in part B (B > 0): copy its bytes to .part at their file offset,
          in JOIN_STEP = 8 MiB steps, via the worker 'copy' op
          (ReadFile/WriteFile, 4 MiB buffer, FILE_FLAG_SEQUENTIAL_SCAN; REFUSES a write that would
           start past the target's end), FlushFileBuffers on the last step of the part
      when part B is copied whole: clear `base` on its segments; checkpoint() = flushed store save;
          then delete the part file (8 tries, 500 ms apart: an antivirus may hold a new file)
  flush the .part if the last copy was not flushed; delete the empty folder
  ```
  Crash safety: a crash after a copy and before the checkpoint copies again (same bytes, same place); a crash after
  the checkpoint and before the delete leaves an orphan the next `openParts()` deletes.
- Seals flush every part file and record each segment's base in `cov`, so a row rebuilt from its journal still knows
  where its bytes are (`VitreDownloads.sys.ts:1786-1793`).

**Why**

The owner's decision of 2026-10-21 (commit 8cc3c05; IDM-WAY-DESIGN.md section 4): on such volumes "writing far into a
file makes Windows fill the gap with zeros first (minutes on a big file)" (`parts.ts:3-5`). IDM measured: 9 part files
for 8 connections, joined after the last byte, 1 GiB in 0.8 s on an SSD; about 0.55 s per GB on the bench.

**Edge cases handled**

- Keep partial joins only the parts of the unbroken beginning (`upTo`, `parts.ts:201`).
- Start over moves the folder aside with the `.part`; Cancel deletes only part names, then the folder if empty.
- "A walk that stopped between two segments of one part left them unflushed, and Keep partial then deleted the part"
  (review) - hence the final flush (`parts.ts:207-209`, `parts.ts:243`).
- Not built (IDM-WAY-DESIGN.md status): a drive that is gone at resume still reads "Started over".

**Proven by**

`tests/downloads/layout.js` (12 checks): "under parts: '<name>.part' plus '<name>.parts\\<start in hex>.part', one per
part but the first", "after the last byte the parts are joined (Saving) and the download completes intact", "paused
under parts: every part holds at least what its segments claim", "a drive that says exFAT (no sparse files) picks the
parts layout by itself", "FAT32: a 4 GiB file is refused before anything is written, saying why", "... one of exactly
4 GiB - 1 is not refused". `all.py --layout parts` runs the other suites on this layout (commit 8cc3c05).

---

## 24. The end of a download: verify, final seal, rename, Safe Browsing, Mark of the Web, record

**What it does**

Turns a complete `.part` into the finished file safely: every byte checked, the name kept (or the next free one),
the file judged by Safe Browsing, marked as coming from the internet, and its fingerprint kept for later checks.

**How it works**

In order (`ranged.ts:910-966`, then `VitreDownloads.sys.ts:1575-1587`, `2261-2274`, `2312-2361`, `2370-2411`):
```
1. downloadTo(): if blocks were released (expect not empty): drain hashing; a mismatch -> File changed
   join the parts (parts layout); completionCheck() (section 8); verify() (length, digest; 'again' loops)
2. ledger.quiet(): no new hashing; wait for the at most 2 blocks being read (they hold the .part open)
3. seal('final'): a seal line with the coverage (no drain, no flush)
4. Pause/Cancel pressed meanwhile? stop here (section 18)
5. placeFinished(): target = rec.path; if "overwrite": remove it; else if it exists: uniquePath -> "name (1).ext"
   unsparse (5 s); IOUtils.move(.part -> target) (failure = DiskError); unsparse the target later if needed
6. complete():
   delete "<name>.old.part" kept by Start over
   for http(s) downloads Deer fetched itself:
       if Safe Browsing would read the file (hashWanted): SHA-256 of the file now (reused below)
       verdict = reputationOf(url, page, referrer policy, path, size, sha256)
       'dangerous' -> delete the file; 'uncommon'/'unwanted' -> move to "<path>.blocked"; row Failed with the reason
   state = completed; finishedAt = now
   Mark of the Web (written again: "a move to another volume may drop the stream")
   stamp(): rec.final = {size, mtime} of the file now        -- the reference for "Changed after download"
   dirty = false; flushed save
7. finishRecord() (in the background):
   wait 1 s, then while any download runs faster than 256 MiB/s (at most 5 min)
   hash the blocks the run had not hashed yet, from the finished file
   whole-file SHA-256 if not known
   if the file's size or mtime changed meanwhile: drop those new hashes, keep nothing
   ledger.finish(): a `fin` line; the journal becomes <id>.done.jsonl; compacted
```
Safe Browsing details (`gecko/src/modules/downloads/reputation.ts`): the query is the one Firefox builds
(`sourceURI`, `referrerInfo`, `fileSize`, raw 32-byte `sha256Hash`, `suggestedFileName`, `signatureInfo: []`,
`redirects: null`; `reputation.ts:98-116`). The hash is sent only for "binary" names and only when the remote lookup
pref is on (`reputation.ts:79-87`); any error returns `'safe'` ("as Firefox: a failed check never blocks",
`reputation.ts:68-71`, `reputation.ts:117-120`). No Authenticode info is passed, so "a signed program is judged as
unsigned" (`reputation.ts:15`). `mayLaunch()` (`reputation.ts:123-144`): opening an executable that is not an `.exe`
(`.bat`, `.cmd`, `.js`, `.vbs`, `.msi`, `.lnk` ...) asks first with Firefox's own prompt; an `.exe` is left to Windows,
which asks because of the Mark of the Web.

Mark of the Web (`gecko/src/modules/downloads/platform.ts:73-86`): `mozIDownloadPlatform.maybeWriteDownloadOriginInformation(file,
url, referrer, isPrivate)`, the call Firefox's own downloads make; the referrer follows the page's referrer policy (a
no-referrer download records no page).

Timestamps: I found no code that sets the finished file's modified time from the server's Last-Modified (searched
`gecko/src` for `setModificationTime`, `lastModifiedTime` writes and similar). Deer only *records* the size and
modified time at the finish (`stamp()`, `VitreDownloads.sys.ts:2427-2430`) and in the `fin` line.

**Why**

`reputation.ts:1-5`: Deer's take-over cancels Firefox's own download "before DownloadCore asks Safe Browsing about it",
so the engine must ask the same service itself. RESUME-DESIGN.md 4.1: "The whole-file SHA-256 is computed once. It is
checked against any server digest and reused for Safe Browsing, which computes one today and throws it away." Review
of Phase 5: the finish no longer waits for the hashing ("above about 700 MB/s it fell behind and held a finished
download at 100% for seconds", `ranged.ts:923-927`), and the finished file's hashing waits while another download is
very fast ("slowed it by up to a half at 1 GB/s", `VitreDownloads.sys.ts:2414-2418`).

**Edge cases handled**

- A name taken meanwhile by another file gets the next free name; a row's own `.old.part` names are reserved
  (`taken()`).
- A file blocked as uncommon can be kept by the person: moved back under a free name, Mark of the Web and stamp written
  (`keep()`, `VitreDownloads.sys.ts:2468-2499`).
- A crash before `finishRecord()` ran: it runs after the next start (`checkAfterStart()`).

**Proven by**

`tests/downloads/safety.js`: "Safe Browsing: a safe file completes, the service was asked with its name, size and
SHA-256", "a dangerous file is deleted and the row fails with the reason", "an uncommon file waits aside as .blocked,
the row can keep it", "Open on a .bat asks first with Firefox's prompt". `tests/downloads/repair.js`: "the finished file
keeps its record as <id>.done.jsonl, with its whole-file SHA-256". `tests/downloads/network.js` run 5: "... with the Mark
of the Web". `tests/downloads/connections.js`: "the finished file is not sparse".

---

## 25. Finished files: Check file, Repair, Restore original

**What it does**

"Check file" re-hashes a finished file against its record (no network). Damaged blocks make the row **Damaged** (red,
with Repair). A file modified after it finished reads **Changed after download** (normal colour, with Restore
original) and is never called damage. **Repair** fetches only the damaged blocks, each checked against the record
before it is written. **Restore original** puts the file back exactly as downloaded, only when the person chooses it.
There are no periodic scans: checks run on demand, after an unclean exit, and for a repair a crash cut short.

**How it works**

`checkFinished()` (`gecko/src/modules/downloads/finished.ts:73-117`):
```
file gone -> missing
mtime > (final.mtime or finishedAt) + MTIME_SLACK (5 s), and not Deer's own cut-short repair -> edited
with a record: re-hash every recorded block; blocks past the file's end are bad too
    no bad block but some blocks were never hashed: compare the whole-file SHA-256 (unlocated damage)
with only a stored SHA-256: compare it
neither: siteCompare() (needs the network; never after a crash)
```
`siteCompare()` for older files with no record (`finished.ts:129-175`): `bs = blockSize(total)`; windows at the heads
of the first, middle and last blocks; at least 2 of 3 must be equal (all, for files of fewer than 3 blocks); then every
block is fetched and compared; when the different blocks reach `LOCAL_SHARE = 5%` of the blocks (`finished.ts:31`), it is
another file, not local damage.

`repairFinished()` (`finished.ts:268-328`), RESUME-DESIGN.md 4.3 steps:
```
1. prove the site with ONLY the good blocks' head hashes, never local bytes (goodHeads(), local = false);
   a refused address or a page goes through the original-address renewal first
2-3. for each bad block: fetch it into memory (at most one block), hash it, compare with the record
     BEFORE writing; another value -> 'changed' (the site has another file): stop, nothing more written
4. before the first write: a durable `repair` journal line
   before EACH write: the file must still have the size and mtime Repair found -> else 'edited', stop
5. writeAt() in place; after all: read every written block back and re-hash it; a `repaired` line
```
Fetch errors map to outcomes: 401/403/404/410/451 or a page -> `expired`; `ChangedError` -> `changed`; else
`unreachable` (`finished.ts:235-251`).

`restoreFinished()` (`finished.ts:344-399`): find every block that no longer matches (reading only); prove the site with
the record's head hashes; fetch each such block, check it, keep it aside in a patch file **in the profile**; only when
everything is in hand and the file is still as found: `repair` line, cut/grow the file to the recorded length, write
the blocks from the patch, read back, `repaired` line. The patch is removed in every case.

`mediaCheck()` (`finished.ts:401-410`): for videos and songs, when ffmpeg is present:
`ffmpeg -v error -i <file> -map 0 -c copy -f null -` (reads only); its complaints are kept on the row.

**Why**

RESUME-DESIGN.md 4.2-4.4 and decision 11 (owner, 2026-10-13): "automatically at completion and after an unclean exit;
otherwise only on Check file. No periodic scans. A file edited after finishing shows 'Changed after download' with
Restore original, never Damaged, and Space never restores it." Reviews of Phase 5: "an edit made meanwhile is never
written over ('edited')" (`finished.ts:17-18`); Restore: "a refused site left the person's file cut" (`finished.ts:20-21`);
siteCompare: "one equal window no longer let the compare go on, and a file of under 20 blocks with one block different
no longer counts as local damage (the 1-block floor is gone)" (`finished.ts:125-127`).

**Edge cases handled**

- What cannot be repaired (RESUME-DESIGN.md 4.4): bytes corrupted over plain HTTP before hashing (they became the
  reference; "TLS protects HTTPS"), a file the server changed, a server without ranges, an expired link with no way to
  renew, yt-dlp outputs, private downloads after their session, and "same-size edits outside every window, on a server
  with no validators and no digest".
- A crash in the middle of Repair: the `repair` line without a `repaired` line makes the next start check those blocks,
  never reading the row as "Changed after download".

**Proven by**

`tests/downloads/repair.js` (70 checks at 31eed88): "Check file finds 1 damaged part: Damaged", "Space repaired it: one
block's range asked for (besides the proof's 64 KiB windows), and sha256 equals the fixture", "the repair wrote its
durable line before writing, and the repaired line after", "the site has another file now: Repair refuses, writes
nothing", "Repair never writes over the person's edit", "after a crash in the middle of a repair, the check finds what it
left damaged (block 20), not Changed after download", "Restore original whose link is refused leaves the person's file
exactly as it was (size and sha256)", "an older finished file with 1 damaged block of 24 (4%): compared with the site, 1
damaged part (local damage)", "an older finished file of 10 blocks with 1 block different (10%, at least 5%): another
file".

---

## 26. Streams: the "hedge" and the proof of a validator slip (HLS/DASH, cross-reference)

Streams are studied in another section; only the two integrity points named in this section's brief are here.

**What it does**

HLS/DASH segments are fetched on parallel connections but written in order. When the next segment to write is overdue
and the connections are idle, a second request **races** it (the hedge); the first answer wins. For "one-file" streams
(HLS byte ranges, DASH SegmentBase), a 200 under another validator is never trusted by itself: the last written piece is
fetched again and must hash to its table line.

**How it works**

- Hedge (`gecko/src/modules/downloads/hls.ts:1231-1240`): `since` = when the head segment's first request started; if it
  is not ready, not hedged yet, and `now - since > max(3000 ms, 2 x avgMs)` (`avgMs` = moving average, new = old x 0.8
  + last x 0.2, `hls.ts:1190`), the idle worker requests the same segment. The first to arrive aborts the others
  (`hls.ts:1189`). A lost race, a stop, or the hedge's own error is "not a failure" (`hls.ts:1207-1208`). A hedge never
  steps aside for other connections (`hls.ts:1182`). Each segment is hedged at most once (`hedged` set).
- Early segments wait in memory up to `SPILL_AFTER = 48 MiB`, then on disk in `<part>.d/` (`hls.ts:182`,
  `hls.ts:1193-1201`).
- Validator slip (`hls.ts:1490-1512`, `hls.ts:1571-1606`): a piece answered under another validator triggers `vouch()`:
  one shared proof per (address, validator) that re-fetches the last written piece without If-Range, decrypts and
  unwraps it, and compares its hash with the segment table line (`proveFile()`). Only after it passes does the slip
  count; after `SLIPS = 2` slips within `SLIP_WINDOW = 10 min` (`hls.ts:199-200`) If-Range carries Last-Modified, and
  after that slips too, nothing.
- **Re-asking after a hedge**: the shared proof runs under the signal of the connection that started it. If a hedge race
  stopped that connection, the proof is aborted; the other connections waiting on it do not fail - they ask again and
  start a new proof under their own signal (`hls.ts:1503-1509`).

**Why**

Commit e20b1ca (2026-10-21): "a one-file stream (HLS byte ranges, DASH SegmentBase) swapped mid-run could write one piece
of the new file. Every connection met the new file's 200, and each counted as a validator slip before the bytes were
compared, so If-Range went to Last-Modified and then to nothing within one swap, and the next answer was written
unchecked. A slip now counts only once the bytes said it is the same file (stream-expiry brswap, 1 in 2 under load
before)."

**Edge cases handled**

- While the resume proof of a track runs beside the download ("lazy proof"), only the next segment is fetched, so a
  changed stream costs one segment (`hls.ts:1163-1166`).

**Proven by**

`tests/downloads/stream-expiry.js` ("brswap", per commit e20b1ca); `tests/downloads/integrity.js`: "an HLS segment
answered with a web page is never written".

---

## Lessons worth copying

Ranked by value for an iOS browser. Each names the Deer mechanism and a hint for Swift.

1. **Prove with bytes, not headers; and make window 0 free.** Ask a resume as `Range: bytes=0-65535` + `If-Range`, and
   compare those 64 KiB with the saved start. An unchanged resume costs no extra request, and a same-size swap with no
   validators is caught (sections 3-5). On iOS: a `URLSessionDataTask` whose delegate gets the response first
   (`didReceive response`), then the first 64 KiB of data; compare with `FileHandle` reads (or a stored SHA-256 from
   CryptoKit).
2. **Decide before you change anything; never truncate saved bytes unless the state says "fresh"; write a whole-file
   replacement beside the old one and swap only when proven** (section 1). This alone prevents "a web page saved as the
   video" and "half old, half new" files.
3. **Persist only what is certainly on disk.** Keep a separate "durable" count per connection and save that, not the
   received count (section 9). On iOS: count bytes as durable only after your `FileHandle.write` returned on the writer
   queue (and after `synchronize()` for seals).
4. **A per-block hash record with head hashes, in an append-only journal.** Blocks aligned to the file; SHA-256 per
   block plus a 64 KiB head hash; torn last line ignored; compaction by temp file + rename (section 11). It turns crash
   recovery, damage repair, the completion check and link-renewal proofs into exact, cheap operations.
5. **Re-fetched blocks must hash to their OLD value.** This is what tells local damage (fixable) from a changed file on
   the site (ask the person) during repair (sections 11, 13, 25).
6. **Dirty mark + seals + an unclean-session flag** (sections 10, 12, 13): set "dirty" (flushed) before the first write;
   a seal = flush the file, then a flushed journal line with the covered ranges; after an unclean end, give back
   what lies above each segment's last hashed block and re-hash blocks newer than the last seal (2 minutes earlier if the
   seal could not flush). Plus a small spot check on *every* resume. On iOS the app is usually killed while suspended
   with no callback, so seal when the scene goes to the background (inside `beginBackgroundTask`) and treat every
   other end as unclean.
7. **Paused "Link expired" / "File changed" instead of Failed, and ask only above 1 MiB** (sections 2, 7). Under 1 MiB
   restart quietly (at most twice in 10 minutes); above, keep the partial untouched and offer Start over (old partial
   kept until the new file completes) or Keep partial (the unbroken beginning). No keypress ever destroys bytes.
8. **Read the expiry from signed URLs, and renew from the original link and its redirect chain** (sections 19, 20):
   single-flight per download, at most 3 per run, failures remembered 30 s, then attempts at +2 min, +15 min, +1 h,
   +6 h. On iOS: record redirect hops in `urlSession(_:task:willPerformHTTPRedirection:newRequest:completionHandler:)`.
9. **Classify failures before retrying** (section 15): cut / unreachable / site error / turned away / refused address /
   challenge / other / fatal, each with its own counter, a "progress resets the counters" gate (1 MiB or 5 s), Retry-After
   honoured, and one global rate cap. Never retry disk errors, TLS errors, or a challenge page.
10. **After a quiet stretch, prove one window before writing again** (section 16). One 64 KiB request protects against a
    file swapped during an outage.
11. **Distrust validators that slip, but count a slip only after the bytes proved it** (sections 6, 26): two slips in
    10 minutes -> stop sending that validator and spot-check a window every 256 MiB or 5 minutes instead.
12. **A completion check when there is no strong validator and no checksum** (section 8): 4 windows (start, 1/3, 2/3,
    end) with one try each; anything that cannot be compared lets the file complete.
13. **A checksum mismatch repairs blocks, not the whole file** (section 8): check blocks locally first; if all match
    their record, compare block by block with the server.
14. **Store safety** (section 10): atomic write, a flushed `.bak` written only on flushed saves, unreadable copies moved
    to `.corrupt`, and rows rebuilt from the per-download journals if both are lost.
15. **Small correctness guards**: honour a Pause/Cancel that came before the run started or after the last byte
    (section 18); check room for what is still needed plus what other downloads still need, with a 16 MiB margin
    (section 22); nominate re-click matches by a score but decide only by bytes (section 21).

## Not worth copying / Windows-only

- **Sparse marking and "unsparse"** (`FSCTL_SET_SPARSE`, section 22): an NTFS zero-fill problem and a Windows rule about
  mounting ISO/VHD files. On APFS, a file extended with `ftruncate`/`FileHandle.truncate(atOffset:)` should not be
  zero-filled on disk (unverified for every iOS version); there is nothing to clear at the end.
- **The parts layout for FAT32/exFAT and the 4 GiB check** (section 23): TitleLess writes into its own app container
  (APFS). It would matter only if downloads were written straight to an external drive picked in the Files app.
- **FlushFileBuffers through js-ctypes in a ChromeWorker, `GetCompressedFileSizeW`, `GetVolumeInformationW`** (sections
  12, 22, 23): Gecko/Windows plumbing. The *idea* (flush off the main thread, record whether the flush happened) is
  portable; the calls are not.
- **Mark of the Web** (`Zone.Identifier`, section 24): Windows-only. iOS apps do not run downloaded executables, so the
  `.bat`/`.lnk` launch prompt (`mayLaunch()`) has no use either.
- **Firefox's application reputation (Safe Browsing for downloads)** (section 24): a Gecko service; I know of no
  equivalent download-reputation API for iOS apps (unverified).
- **IDM's exact rates**: 10 ms re-asks without limit and 150 asks a second suit a desktop on mains power. On a phone,
  keep the classification and the proofs but use a lower global cap and gate "network" retries on the path monitor
  (judgement, not measured).
- **Necko-specific details**: lanes via `cookieJarSettings` partitions, `nsIPipe` + `NetUtil.asyncCopy` writers,
  `crypto.subtle` vs `nsICryptoHash` choices, the `IOUtils` MD5 workaround, the quit prompt and `profileBeforeChange`.
- **The design's unbuilt parts** (IDM-WAY-DESIGN.md status): per-site token buckets, the 250 ms floor, the "hold" with
  scouts, the Link-expired 30 s re-ask - not in the code, so not evidence of anything.
