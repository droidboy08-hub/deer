# 12. The download manager: queue, take-over, naming, sites, persistence

## In one paragraph

Deer's download manager is one object for the whole app (`VitreDownloads`, a "process-wide singleton"). It belongs to no window, so downloads keep going while windows open and close; every window only listens to it and shows the rows of its own privacy. The manager keeps one record per download ("row"), runs at most **two** downloads at once in a strict first-in-first-out queue, and "takes over" the downloads that web pages start inside Firefox: Firefox starts its own download into a hidden scratch folder, Deer asks the server itself in parallel (a 1-byte Range probe), and if the server answers with the file, Deer cancels Firefox's copy and restarts the download in its own multi-connection engine with the same address, referrer, cookie jar, container and private flag. What Deer cannot safely repeat (form POST answers, one-time links, `blob:`/`data:`, extension downloads, "Save Page As") stays with Firefox and is only mirrored in the list. Names come from the server (Content-Disposition, including RFC 5987 `filename*`), else Firefox's suggestion or the address, are fixed for Windows and passed through Firefox's own validator, and are made unique as "name (1).ext" against the disk *and* against other running rows. The list is saved as JSON (atomic write, flushed on every state change, a `.bak` copy, a crash flag), private rows are never written, a quit while something runs is refused with a prompt, and what the quit stopped continues by itself 10 s after the next start. When an address expires the manager also owns the "renewal" steps (original address, yt-dlp, a hidden "page step" tab, the person starting it again on the page), but the byte proof those steps use is another section's subject.

## Files

| File | Lines | Role |
|---|---|---|
| `gecko/src/modules/VitreDownloads.sys.ts` | 5573 | The engine: records, queue, take-over, commands, waits, renewal steps, persistence, quit and private-window guards, the view sent to windows. |
| `gecko/src/modules/downloads/types.ts` | 485 | Shared shapes: `DownloadState`, `NeedKind`, `WaitFor`, `IdentityJSON`, `DownloadView`, `StartOptions`, `DownloadEvent`, page-step job types. |
| `gecko/src/modules/downloads/table.ts` | 389 | A stream's segment table (journal of written HLS/DASH segments), where a resume continues (`mapNext`), re-picking the same quality (`repick`, `matchRep`). |
| `gecko/src/modules/downloads/naming.ts` | 199 | File names: Content-Disposition, address, title, MIME extension, Windows sanitising, Firefox validator, "name (1).ext", categories. |
| `gecko/src/modules/downloads/site.ts` | 22 | `siteKey()`: registrable domain (eTLD+1) without the scheme, for page-step limits. |
| `gecko/src/modules/downloads/sites.ts` | 15 | `ytdlpFirst()`: which pages need yt-dlp (YouTube). |
| `gecko/src/modules/downloads/referrer.ts` | 101 | Referrer policy names and the Referer value a download sends. |
| `gecko/src/modules/downloads/pagestep.ts` | 157 | The background "page step": limits, link scoring, candidate helpers. |
| `gecko/src/modules/downloads/platform.ts` | 158 | Windows services: open, reveal in Explorer, clipboard, Mark of the Web, Save and folder dialogs. |
| `gecko/spikes/downloader/verify/engine/VitreTakeover.sys.mjs` | 147 | The prototype take-over (history: what the product changed). |
| `gecko/spikes/downloader/verify/engine/VitreNaming.sys.mjs` | 142 | The prototype naming (history: the product added Firefox's validator). |
| `gecko/ARCHITECTURE.md` | 1124 | Downloads section (lines 505-813) and "Decisions for the user" → Downloads (lines 1101-1112). |

Read in part, to follow what my files call: `downloads/attach.ts` (185, read fully), `downloads/waits.ts` (71, fully), `downloads/limiter.ts` (53, fully), `downloads/media-url.ts` (6), `downloads/renew.ts` (constants), `downloads/net.ts` (`Identity`, `makeChannel`), `downloads/ranged.ts` (`probe`, `learn`, `connections`, `silentRestart`, `hasRoom`), `downloads/proof.ts` (constants), `gecko/src/window/modules/downloads/index.ts`, `principals.ts`, `system.ts` (fully), `store.ts` (part), `gecko/src/shared/settings.ts` (download settings), `spikes/downloader/RESULT.md`, `spikes/downloader/RESUME-DESIGN.md` (sections 1, 2, 5, 8, 9). Git history before 2026-10-05 is squashed into one commit ("Deer 0.1.0", `5557e72`), so older reasons live only in comments and spike documents.

## Words used in this document

- **Row / record (`Rec`)**: one download in the list, with everything Deer knows about it (`VitreDownloads.sys.ts:316-439`).
- **Run**: one live attempt to move bytes for a row (`Run`, `VitreDownloads.sys.ts:490-520`). A row has at most one run.
- **HTTP Range request**: a request with a header like `Range: bytes=0-0` that asks only part of a file. A server that supports it answers **206 Partial Content**. A server that ignores it answers **200 OK** with the whole file. **416** means "range not satisfiable".
- **ETag / Last-Modified**: values the server sends to identify a version of a file. **If-Range** sends one back: "give me the range only if the file is still this version".
- **Content-Disposition**: a response header that can say "this is an attachment" and give a file name, e.g. `attachment; filename="report.pdf"`. **RFC 5987 / RFC 6266 `filename*`** is its encoded form for non-ASCII names: `filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`.
- **MIME type / Content-Type**: the server's statement of what a file is, e.g. `application/pdf`.
- **HLS**: Apple's streaming format (a `.m3u8` playlist listing small media files). **DASH**: the MPEG equivalent (a `.mpd` manifest). **Segment**: one small media file of a stream. **Init segment**: the header piece some streams need before their segments. **Remux / merge**: joining the downloaded pieces into one MP4 without re-encoding (Deer uses ffmpeg `-c copy`).
- **`.part` file**: the unfinished file on disk ("name.ext.part"); it is renamed to the final name only when complete. **Sparse file**: a file whose unwritten regions take no disk space (NTFS feature).
- **Principal**: Firefox's word for "who is making this request" (a page's origin, or the browser itself = "system principal"). **Cookie jar**: the set of cookies a request may read; **container** (`userContextId`) is a separate cookie jar for the same sites; **private browsing** is a jar that is thrown away when the last private window closes.
- **Site / registrable domain / eTLD+1**: the part of a host name that one owner can register, e.g. `example.co.uk` for `cdn.example.co.uk`. **SameSite cookies** (`Strict`, `Lax`) are cookies a browser does not send when another site starts the request.
- **Referer** (sic) header: the page a request came from. **Referrer policy**: the page's rule for how much of its address to send (`no-referrer`, `origin`, …). **Origin** header: scheme+host+port of the requesting page.
- **Take-over**: Deer cancelling a download Firefox started and doing it with its own engine. **Mirror**: a download Deer leaves to Firefox but still shows in its list.
- **Journal**: an append-only file of JSON lines. **Flush / fsync**: forcing the operating system to write a file to the disk now. **Atomic write**: write to a temporary file, then rename it over the real one, so a crash leaves either the old or the new copy, never half.
- **Mark of the Web**: the Windows `Zone.Identifier` data that marks a file as "from the internet". **Safe Browsing**: Google's file-reputation check Firefox uses.

---

## 1. One engine for the whole app, and what windows see

**What it does**
Downloads continue whatever windows do. Every window shows the same downloads (only those of its own privacy), updates about four times a second, and new rows "fly" from the tab where they started.

**How it works**
- `export const VitreDownloads = new Manager();` (`VitreDownloads.sys.ts:5573`). Window code reaches it with `b.sys('VitreDownloads')`. The public contract is written at the top of the file (`VitreDownloads.sys.ts:6-64`).
- Windows subscribe with `subscribe(fn)` (`:966-971`). Events (`types.ts:335-339`):
  - `added` — a new row, with the tab's `browserId` and the window point it flies from (`origin`); `replaces` names a row id that `start()` returned before its proof said "not that row" (see §17).
  - `attached` — a start again continued an old row (no new row; it flies like `added`).
  - `update` — a batch of changed views.
  - `removed` — ids that left the list.
- A listener that throws never breaks the others (`emit`, `:973-981`).
- `list(isPrivate?)` returns views sorted by `ORDER` then newest first (`:953-955`; `ORDER` at `:282`: downloading/starting 0, queued 1, paused/failed 2, completed/cancelled 3).
- Each window's store keeps only views whose `isPrivate` equals the window's (`gecko/src/window/modules/downloads/store.ts:49-51`, `:84`).
- The view (`DownloadView`, `types.ts:64-184`) is computed in `view()` (`VitreDownloads.sys.ts:4571-4677`) from the record plus the live run. The window never sees `Rec` directly.

**Why**
Downloads are process-wide in Firefox too; tying them to a window would stop them when that window closes. The header says it is a port of the Electron build's `manager.ts` onto the verified Gecko prototype (`:1-4`).

**Edge cases handled**
- A view computed for a completed row checks the disk (`checkDisk`) only when asked (`view(r, true)` in `list()`/`get()`, and in `flush()` only for completed rows, `:4566`), so ticks do not stat files.
- `whenSettled(id)` resolves once a row is no longer `starting`/`queued`/`downloading` (`:994-1002`); shutdown uses it.

**Proven by**
`tests/downloads-verify/v-windows.js` (a download started in one window shows in another; a private window keeps its own list).

---

## 2. The row's state machine

**What it does**
Each row has one of seven states. Extra fields say *why* a paused row is paused and whether Deer will come back to it by itself. The view adds "phases" (Checking, Renewing link, Joining…).

**How it works**

`DownloadState` (`types.ts:6`): `starting | queued | downloading | paused | completed | failed | cancelled`.

Lists used everywhere: `ACTIVE = ['starting','queued','downloading']`, `FINISHED = ['completed','cancelled','failed']` (`VitreDownloads.sys.ts:280-281`). Note that **failed counts as finished** (Clear finished removes it).

| State | Meaning | Entered from |
|---|---|---|
| `starting` | Only for a taken-over Firefox download while Deer's probe runs. | `adopt()` (`:1217`) |
| `queued` | Waiting for one of the two slots. | `newRec()` default (`:1041`); `resume()` (`:2844`); a wait that is due (`retryWait`, `:4395`); `attach()` (`:3795`); Start over (`:2977`); the probe after take-over (`:1282`); `continueAfterStart` (`:4477`) |
| `downloading` | A run exists. Also used for mirrored Firefox downloads. | `launch()` (`:1492`); `mirror()` (`:1354`) |
| `paused` | Stopped with bytes kept. Sub-reasons below. | `pause()`, `stopped()` for pause/quit/sleep/Link expired/File changed/network waits, `load()` at start-up |
| `completed` | The file is in place. | `complete()` (`:2335`), `keep()` (`:2486`) |
| `failed` | Ended with an error, or blocked by Safe Browsing (`rec.blocked`). | `stopped()` (`:2601`), `block()` (`:2457`), `load()` for interrupted Firefox/starting rows (`:853-855`) |
| `cancelled` | Stopped by the person; partial files deleted. | `markCancelled()` (`:2657-2670`) |

Sub-states that live on a **paused** row (`Rec`, `:362-398`; `types.ts:16`, `:25`):
- `need` — the person must act: `'address'` (Link expired), `'choice'` (File changed), `'page'` (start it again from its page). On a **completed** row, `'repair'` (Damaged).
- `wait` — Deer will come back by itself at `wait.nextAt`: `'network'`, `'server'`, `'sleep'`, `'address'` (the next automatic renewal attempt).
- `catcher` — "Waiting for link": armed for 30 minutes after Refresh address opened the page (`CATCH_FOR`, `:270`).
- `trying` — a wait's automatic try whose check has not passed yet (`:375`).
- `resumeOnStart` — a quit or crash stopped it; it continues after the next start (`:406`).
- `hold` — Pause was pressed while the row was still `starting` (`:349`).

Phases (`Run.phase`, `:500`; view `phase`, `types.ts:83`): `''`, `probing` (before the first byte), `checking` (a resume with saved bytes re-checks before fetching; shown only after `CHECKING_AFTER = 400` ms so quick resumes never flicker, `:272`, `:4588`), `renewing`, `merging`, and on completed rows `repairing`.

What the view shows can differ from `rec.state` (`view()`, `:4575-4616`):
- **Pausing**: after Pause, while connections are still closing, the row already reads `paused` (`pausing`, `:4576`), so a quick second press means Resume.
- **Asking**: a ranged run where every connection keeps failing and nothing came in for a while reads as `paused` with a `wait` (Waiting for network / Retrying) although `rec.state` stays `downloading` (`retryingOf()`, `:1018-1022`; `ranged.ts:1511-1522`).
- A completed row whose file was modified after the finish reads "Changed after download", which wins over Damaged (`:4597-4600`).

Pseudo-code of the main transitions:

```
new (start)          -> queued -> [pump] -> downloading
new (Firefox click)  -> starting -> queued | paused(hold) | mirrored downloading | (claimed: no row)
downloading -> completed            (run resolved; complete() passed Safe Browsing)
            -> failed (blocked)     (Safe Browsing verdict not 'safe')
            -> paused               (Pause | quit | sleep | Link expired | File changed | network/server wait)
            -> queued               (Pause then Resume before the connections closed; a silent stream restart)
            -> cancelled            (Cancel)
            -> (removed)            (the "ask where to save" dialog was cancelled: SaveDeclined)
paused   -> queued    (Resume, a due wait, an attach, Start over, continue after restart)
paused   -> completed (Keep partial file)
failed / cancelled -> queued (Retry)
completed -> failed -> queued (Resume when the finished file is gone: "download again" in place)
```

**Why**
RESUME-DESIGN.md section 1 records the choice: no new `'waiting'` state (it would touch every state check in window code) and no "queued + wait" (the quit prompt counts `queued`; `load()` turns queued into paused). Instead two optional fields, `wait` and `need`, on a paused row. "Link expired" and "File changed" are paused, not failed, "nothing is lost, the taskbar stays yellow, and red stays for real damage". An older Deer reads such rows as plain paused.

**Edge cases handled**
- `starting` never survives a restart: it becomes `failed`, "Interrupted when Deer closed." (`:853-855`).
- A row is never both run and renewed: many guards check `this.runs.has(id)`, `this.renewing.has(id)`, `this.deciding.has(id)` (e.g. `:2127`, `:3339`, `:3657`).
- `settle()` resolves `whenSettled` waiters only once the row left `ACTIVE` (`:2650-2655`).
- A row's last 5 history lines (`events`, `:384`; `event()`, `:4340-4342`): every automatic fix leaves one ("New link found", "Continued after restart").
- `attention`: only rows that started needing the person in this session put a dot on the ring (`:4652`).

**Proven by**
`tests/downloads/ui.js` (every row state captured, Space on each never destroys bytes), `tests/downloads/network.js` (Checking after 400 ms, waits).

---

## 3. The queue: two at a time, strict order

**What it does**
At most two downloads move bytes at once. The rest show "queued" with their position (1 = next). Downloads started in the same millisecond still keep the order they were asked in.

**How it works**
- `MAX_ACTIVE = 2` (`VitreDownloads.sys.ts:257`).
- Every time a row is queued it gets `queuedAt = queueStamp()` (`:596-600`):

```
lastQueued = 0
queueStamp():
    lastQueued = max(Date.now(), lastQueued + 1)   // strictly increasing
    return lastQueued
```

- `pump()` (`:1455-1476`):

```
if quitting: return
active  = runs that are NOT Firefox mirrors and whose row is NOT 'starting'
waiting = rows with state 'queued' and no run, sorted by queuedAt
for r in waiting:
    if active >= MAX_ACTIVE: mark r dirty (its queue position may have moved); continue
    launch(r); active++
drop "warm" probe transfers whose row is no longer queued/downloading
```

- `launch(rec)` (`:1478-1507`) makes a run, moves a network/server/sleep wait onto the run (`run.waited`) so its retry count continues, clears `resumeOnStart`, sets `downloading`, starts the ticker, and calls `runFile`, `runStream` or `runYtdlp`. When the job resolves: `complete()` then `pump()`. When it rejects: `stopped()` (which also calls `pump()`).
- `queuePos` in the view is the row's index among queued rows sorted by `queuedAt`, plus 1 (`:4581`, `:4636`).
- Resume puts a row at the **end** (`queuedAt = queueStamp()`, `:2845`). **Try now** (`resume(id, true)`) sets `queuedAt = 1` and launches the row at once, even when two already run (`:2845-2848`).
- `resumeAll` walks the list oldest-first (`[...recs].reverse()`, `:3108-3110`), so the original order is kept. `continueAfterStart` sorts by the old `queuedAt` too (`:4472`).

What does **not** take a slot:
- mirrored Firefox downloads (`!run.firefox`, `:1457`);
- take-over probes (`starting` rows, `:1457`; a probe held for a pre-matched row is not even in `runs`, `:1228`, `holding` at `:669`);
- renewal attempts outside a run (`episode()`, `streamEpisode()`, `ytdlpEpisode()`: "holds no download slot", `:3319-3323`), the background page step, Check file and Repair.

**Why**
The engine rules say "Two downloads run at once; the rest wait their turn (MAX_ACTIVE)" (`:67`), as in the Electron build it ports. Each download already opens up to 32 connections (§26), so two downloads saturate a line. The strictly increasing clock exists so "downloads started in the same millisecond (a batch) still wait in the order they were asked for" (`:592-595`).

**Edge cases handled**
- A waiting row is marked dirty on every pump so its displayed position follows the queue (`:1460-1463`).
- A probe's transfer kept for a taken-over row ("warm") is dropped if the row is paused or cancelled before it runs (`:1468-1474`).
- A ranged run that is "asking" (all connections failing, Waiting for network) still holds its slot; only its *view* says paused (by reading `pump()` and `retryingOf()`; not a documented choice).
- Sleep: rows that wait their turn are paused into a `sleep` wait so nothing starts on the way down (`sleep()`, `:4438-4459`).

**Proven by**
`tests/downloads/ui.js:42` "two run at once, the third waits its turn" (`queuePos === 1`); `tests/downloads-verify/v-rapid.js:88-96` "six started at once … the rest wait in order 1..5".

---

## 4. Starting a download Deer starts itself (`start()`)

**What it does**
The video picker, "Add link", "Download copied link", Alt+click, the right-click menus and the window's `downloads` service all call `start(url, opts)`. It returns the row id at once.

**How it works** (`VitreDownloads.sys.ts:1069-1134`)
1. Only `http(s)` addresses: otherwise `DownloadError('Only web addresses can be downloaded.')` (`:1070`).
2. Mode: `opts.mode` if `hls`/`dash`/`ytdlp`/`file`; otherwise from the address: `.m3u8` → HLS, `.mpd` → DASH, else file (`:1071`; regex `/\.m3u8(\?|#|$)/i`, `/\.mpd(\?|#|$)/i`).
3. DRM rule: if the tab (`opts.browserId`) uses DRM (EME) and the start is a stream, a picked video (`videoKey`) or a media address (`MEDIA_URL = /\.(m3u8|mpd|mp4|m4v|m4s|webm|mov|mkv|m4a|mp3|aac|ts)(\?|#|$)/i`, `media-url.ts:6`), it throws the DRM message, "whoever asks" (`:1072-1074`).
4. Pre-match (§17): for a plain file start with no `videoKey`, no `saveAs`, no `dir`, the start is first scored against rows that wait for a new address. A match returns the **old** row's id and proves the address in the background (`:1082-1093`).
5. Otherwise `startNew()` (`:1102-1134`):
   - `newRec()` (`:1026-1063`): `id` = UUID; `dir = opts.dir || settings.downloadsFolder || Windows Downloads` (`:1028`); `filename = sanitize(opts.filename)` or `sanitize(nameFromUrl(url) || title || 'download')` (`:1036`); `named = !!opts.named` ("the name came from the person and must not be replaced by the server's", `:322-323`); `state 'queued'`; `queuedAt = queueStamp()`; `askWhere = (opts.saveAs ?? settings.askWhereToSave) && !opts.dir` (`:1058`).
   - yt-dlp: needs a format, sets `rec.ytdlp`, name `"<title or video>.<ext>"`, `streamKey 'ytdlp|<page>'` (`:1104-1118`).
   - HLS/DASH: `rec.stream = StreamTransfer.fresh(...)`, `identity.withOrigin = true` (streams send an `Origin` header), name `"<title or streamTitle(url)>.mp4"` or `.m4a` for audio-only (`:1119-1126`).
   - A file with a title (from the picker, or when the address has no extension): `chooseName({url, title})` (`:1127-1129`).
   - `recs.unshift(rec)` (newest first), emit `added`, save flushed, `pump()` (`:1130-1139`).

**Why**
Address-based mode detection matches the Electron build. The DRM rule is repeated in the window service with the same `MEDIA_URL` list "so the two cannot drift apart" (`media-url.ts:1-3`). `named` protects names the person typed or the picker chose from being replaced by the server's name later.

**Edge cases handled**
- A "Save link as…"/"Save video as…" start (`saveAs`) or a start into a chosen folder (`dir`) never attaches to an old row; it always makes its own row with its own dialog (review of Phase 3, `:1079-1081`).
- An explicit `saveAs: false` means "do not ask" even when the setting says ask (`??`, `:1058`).

**Proven by**
`tests/downloads/engine.js`, `tests/downloads/drm.js`, `tests/downloads/attach.js` (sections addlink, endpoint).

---

## 5. Taking over downloads that pages start in Firefox

**What it does**
When you click a download link, an `<a download>` link, or use Firefox's own save paths, the file still lands in Deer's list and downloads with many connections, with the page's cookies and referrer. Firefox's own downloads panel never appears, and Firefox's temporary files never touch your Downloads folder.

**How it works**

*Install* (`installTakeover`, `VitreDownloads.sys.ts:1143-1161`), at every start:
1. Make the scratch folder `<profile>/vitre-download-scratch` (`:758`, `:1144`).
2. Set Firefox prefs (`TAKEOVER_PREFS`, `:285-294`):
   - `browser.download.useDownloadDir = true` and `browser.download.always_ask_before_handling_new_types = false` — never Firefox's "where to save" or "open with" dialogs;
   - `browser.download.alwaysOpenPanel = false`, `browser.download.panel.shown = true` — Firefox's panel never pops open;
   - `browser.download.folderList = 2` and `browser.download.dir = <scratch>` — Firefox's own folder is the scratch folder.
3. `Downloads.getList(Downloads.ALL).addView({onDownloadAdded, onDownloadChanged})`. `addView` first replays old downloads; a `live` flag set after `addView` resolves ignores that replay (`:1152-1160`).

*Adopt* (`adopt(list, download)`, `:1164-1290`), for every new Firefox download:

```
src       = download.source
url       = src.url
target    = download.target.path            // Firefox's own name, in the scratch folder
suggested = filename(target)
ref       = readReferrerInfo(src.referrerInfo)         // page address + referrer policy
bc        = BrowsingContext.get(src.browsingContextId)
browserId = bc.top.browserId                           // which tab
pageUrl   = ref.url || bc.top.currentURI               // the page it came from
crossSite = isHttp(url) && pageUrl && !sameSite(url, pageUrl)
identity  = {pageUrl, userContextId: src.userContextId, isPrivate: src.isPrivate,
             firstParty: !crossSite, pageRules: crossSite, referrerPolicy: ref.policy}

if claimOf(browserId, src.browsingContextId):         // a hidden page-step tab started it (§18)
    drop Firefox's copy; give the address to the page step; return       // no row at all

fromExtension = loadingPrincipal is moz-extension:// or has addonId
inScratch     = parent(target) == scratch (case-insensitive)
rec = newRec(url, {filename: suggested, identity, browserId}); rec.mime = download.contentType
rec.origin = {kind:'takeover'}

if !isHttp(url) or fromExtension or !inScratch:
    rec.origin.reason = 'saved-elsewhere' | 'extension' | 'not-http'
    mirror(rec, download); return                     // §6

match = preMatch(...)                                 // a row waiting for this file? (§17)
rec.state = 'starting'
if !match: add the row now (emit 'added')             // a matched row is held back, no 'added'
run.phase = 'probing'
info = FileTransfer.probe()   // Range: bytes=0-0, while Firefox's own transfer keeps going
if quit: return
if Cancel was pressed: drop Firefox's copy; mark cancelled; return
if !info (probe failed or refused) or (info is text/html and Firefox's type was not html):
    rec.origin.reason = 'needs-request'; mirror(rec, download); return   // leave it to Firefox
if match:
    verdict = proveFor(match, url, identity, ...)      // byte proof against the old row
    if 'same':    drop Firefox's copy; attach to old row; return
    if 'changed': drop Firefox's copy; old row becomes File changed; return
    add the row now
dropFirefox(list, download, target)
rec.file = probe's state; rec.total = its total; rec.mime ||= probe's type
rec.state = rec.hold ? 'paused' : 'queued'; rec.queuedAt = queueStamp()
keep the probe's transfer "warm" for the first run; save flushed; pump()
```

*Drop Firefox's copy* (`dropFirefox`, `:1292-1298`): `download.cancel()`, `removePartialData()`, `finalize(true)`, `list.remove(download)`, then delete the target (Firefox's empty placeholder) — each step ignores errors.

*The probe* is `FileTransfer.probe()` (`ranged.ts:560-647`). For a first probe it sends `Range: bytes=0-0` (`ranged.ts:578`), accepts 200, 206 or 416 (`:587`), and treats 401/403/404/410/451 and 400 as refusals (`:627-637`). A 200 means the server ignored the range; that answer is kept suspended ("pending") as the body of a one-connection download (`ranged.ts:725-729`).

*Warm transfer*: the take-over keeps the probe's `FileTransfer` in `warm` (`:650`, `:1285`) so the first run reuses its identity and counters and does not ask again (`runFile`, `:1513-1514`). Because that state is already `probed` with 0 bytes, `runFile` skips its own check (`:1520`), so **the name stays Firefox's suggestion** (see §10).

**Why**
- The spike proved the take-over on real clicks, `<a download>` and `saveURL`, with cookies and Referer (`spikes/downloader/RESULT.md:59-62`, `:242`).
- The scratch folder: the prototype used `browser.download.start_downloads_in_tmp_dir`, but the verification found that "the tmp-dir pref does nothing for the partial file (a scratch download folder does)" (`RESULT.md:227`, `:255-256`; correction 3 at `:293`; the prototype's pref list at `VitreTakeover.sys.mjs:19-29`). With the scratch folder "the user's folder only ever held the finished file" (`RESULT.md:276`).
- Keep the probe *before* cancelling: the take-over copies only the address, referrer, private flag and container; it drops Firefox's `authHeader`, `cookieJarSettings` and `adjustChannel` (an extension's method/headers/body). "The Range probe is what keeps those safe (403/405/HTML -> left to Firefox), so keep the probe before cancel" (correction 4, `RESULT.md:295`). Verified: a one-time link got 403 at the probe and Firefox finished it intact; a POST download got 405 and was left; a `blob:` was left (`RESULT.md:274`).
- Extensions: taken over, "the extension is told its download was cancelled and erased" (`RESULT.md:225`, `:272`), so `moz-extension` loading principals are left to Firefox (`:73-76` of the header).
- "Saved elsewhere": a download whose target is outside the scratch folder was saved where Firefox was told (Save Page As), so Deer does not move it (`:76-77`).
- The HTML rule: "a probe that fails, or gets a page where Firefox got a file, means the download needs the original request" (`:1223-1224`).
- The cross-site rule is §7.

**Edge cases handled**
- The replay of earlier sessions' Firefox downloads is ignored (`:1154`).
- Cancel during the probe: Firefox's copy is dropped and the row is cancelled (`:1241-1246`). Pause during the probe sets `hold`; the row ends `paused` instead of `queued` (`pause()`, `:2746-2748`; `:1282`). Resume during the probe clears `hold` (`:2810-2814`).
- Quit during the probe: the function returns and nothing else is done (`:1240`).
- A held probe for a pre-matched row is no row's run: it takes no slot and Pause cannot reach it; a quit stops it (`:669`, `:5265-5268`).
- A tiny attachment that Firefox already finished: still taken over; "server sees 3 requests: Firefox, probe, Vitre" (`RESULT.md:274`).
- A PDF that Firefox would have opened after saving (`launchWhenSucceeded`) is saved and not opened (`RESULT.md:274`, correction 4).
- Name formats differ: Firefox names duplicates `name(1).ext`, Deer `name (1).ext` (correction 4).
- Windows-only risk recorded: Internet Download Manager hooks `firefox.exe` and can grab downloads before the take-over sees them (`RESULT.md:307`, Risks 1).
- A test log of every decision (`takeovers`, `:747`; actions "taken over", "left: …", "attached", "changed", "claimed").

**Proven by**
`tests/downloads/takeover.js` (trusted click needing cookie and Referer, `<a download>`, Alt+click, `blob:` mirrored and moved out of scratch, Firefox's list and scratch folder empty afterwards; why each was left is saved); `tests/downloads/crosssite.js`; spike logs `verify/out/takeover/log.txt`, `verify/out/takeover2/log.txt` (container, private window, second window, PDF, tiny file, one-time link, POST, blob — `RESULT.md:225`, `:272-276`).

---

## 6. Mirrored downloads (left to Firefox)

**What it does**
Downloads Deer must not repeat still appear in Deer's list, with progress, pause and resume, and their finished file is moved from the scratch folder to your Downloads folder.

**How it works**
- `mirror(rec, download, alreadyListed)` (`VitreDownloads.sys.ts:1352-1372`): `mode 'browser'`, `state 'downloading'`, `download.tryToKeepPartialData = true` (so Firefox can resume it), a run whose `firefox` field holds the Firefox `Download`.
- `firefoxChanged(download)` (`:1377-1405`), called by the list view on every change:
  - copies `currentBytes`/`totalBytes`;
  - `succeeded` → `placeFirefoxFile()` once (phase `merging` marks it);
  - `canceled` → `paused` if Firefox kept partial data, else `cancelled`;
  - `error` → `failed`, "Couldn’t write to the downloads folder." when `becauseTargetFailed`, else "The download was interrupted.";
  - otherwise `downloading`.
- `placeFirefoxFile()` (`:1408-1451`):
  1. `await download.whenSucceeded()` — Firefox announces success before its own last steps (writing Mark of the Web and permissions). "Moving the file earlier races them and leaves a stray file behind" (`:1411-1414`).
  2. If it is in the scratch folder: either the Save dialog (when `askWhere`; cancel deletes the file and removes the row), or `uniquePath(rec.dir, rec.filename)`; then move.
  3. Remove it from Firefox's list — except an extension's, whose `downloads` API must keep answering (`:1435-1436`).
  4. `complete(rec)` (§13). Safe Browsing is skipped for mode `browser` (Firefox already checked it, `:2316`), but the Mark of the Web is written again because "a move to another volume may drop the stream" (`:2350-2352`).
- Pause: `run.firefox.cancel()` and the row reads paused at once (`:2750-2752`). Resume: `run.firefox.start()` (`:2816-2821`).
- Retry after it ended: Deer **never** fetches it itself. With a page: the row becomes paused with `need 'page'` and the reason from `LEFT_WHY` (`:307-312`), e.g. "the site gives it only to its page’s own request"; without a page it fails with "Start this download again from its page." (`:2823-2839`).
- After a quit or restart, mirrored rows are `failed`, "Interrupted when Deer closed." (`shutdown`, `:5279-5283`; `load`, `:853-855`): "Firefox's own transfers don't survive a restart" (`:852`).

**Why**
Commit `3e7f908` (Phase 3): "Browser-mode rows (one-time links, forms, blob/data, extensions) are never renewed automatically: Retry asks to start them again from their page; the reason Deer left them to Firefox is saved." The resume comment explains: Deer "could only send its address a plain GET with no checks" (`:2823-2827`).

**Edge cases handled**
- `rec.origin.reason` survives restarts so the row can say why it needs its page (`:394-398`).
- A mirrored download counts as 1 connection, maximum 1 (`:4623-4624`).

**Proven by**
`tests/downloads/takeover.js` (blob: mirrored and moved; one-time link and extension reasons saved; Retry asks for the page).

---

## 7. Whose request it is: cookies, principal, referrer and the cross-site rule

**What it does**
A download is sent with the cookies, Referer and container it would have had in Firefox: a link you click on its own site gets that site's cookies; "Download linked file" and Alt+click are fetched like Firefox's "Save Link As"; a download that one site starts on another site does not get the second site's `SameSite=Strict/Lax` cookies.

**How it works**
Every row carries an `IdentityJSON` (`types.ts:30-61`), normalised by the `Identity` class (`net.ts:183-234`):

| Field | Meaning |
|---|---|
| `pageUrl` | The page it came from (only `http(s)` kept). Used for Referer, the list, Safe Browsing, Mark of the Web. |
| `requestPage` | An embedded player's frame address when the server only serves that player; used only for Referer/Origin/loading principal. |
| `userContextId`, `isPrivate` | Container and private jar. |
| `withOrigin` | Send an `Origin` header on cross-origin requests (streams, media a player fetched). |
| `firstParty` | Load like a top-level navigation: system principal, the address's own cookies. Forced false when `principal` is set (`net.ts:203`). |
| `pageRules` | With `firstParty` false: the page is loading **and** triggering principal and third-party cookies are not forced, so Firefox's cross-site cookie rules apply strictly (`net.ts:204`). |
| `principal`, `cookieJarSettings` | The page's own principal and cookie jar, serialised (E10SUtils), for page-derived addresses (Save Link As style). |
| `referrerPolicy` | The page's policy by its W3C name (§8). |

How the channel is built (`makeChannel`, `net.ts:285-367`):

```
page = identity.requestPage || identity.pageUrl
if identity.principal reads back and is not system:      // Save Link As
    channel(loadingPrincipal = triggeringPrincipal = pagePrincipal, TYPE_SAVEAS_DOWNLOAD)
elif identity.principal (does not read):
    throw "Start it again from the page."                  // never fall back to system
elif page and not firstParty:                              // media a page fetched, cross-site take-over
    pagePrincipal = content principal of page in its container/private jar
    channel(loading = pagePrincipal,
            triggering = pageRules ? pagePrincipal : system)
else:                                                      // a clicked same-site link, Add link
    channel(system principal); set userContextId
setPrivate(identity.isPrivate)
page's cookie jar or a per-connection "lane" jar (§ connection lanes, another section)
LOAD_BYPASS_CACHE | INHIBIT_CACHING | LOAD_BYPASS_SERVICE_WORKER
on every request and every redirect hop ("dress"):
    Referer = referrerFor(page, thisURL, policy), sent with UNSAFE_URL policy
    Accept: */*, Accept-Encoding: identity
    Origin = page origin if withOrigin and cross-origin
    channelIsForDownload = true; forceAllowThirdPartyCookie = !pageRules
```

Where each identity comes from:
- **Take-over** (`adopt`, `:1186-1187`): `firstParty = !crossSite`, `pageRules = crossSite`, where `crossSite = http(s) && pageUrl && !sameSite(url, pageUrl)`. `sameSite()` compares `Services.eTLD.getSite()` (scheme + registrable domain), and IP hosts by `scheme://host` (`:571-586`).
- **The window `downloads` service** (`gecko/src/window/modules/downloads/index.ts:140-180`): `pageIdentity()` (`principals.ts:59-78`) reads the caller's triggering principal, referrer info and cookie jar. A content principal → `{firstParty: false, principal, referrerPolicy, cookieJarSettings}`; none or system → `{firstParty: true, referrerPolicy}`. It first runs `checkLoadURIStrWithPrincipal` and refuses an address the page may not load (`principals.ts:65-69`). `blob:`/`data:` go to Firefox's own `saveURL` and come back through the take-over's mirror (`index.ts:159-161`, `:91-94`).
- **A pasted address** ("Use another address…", and a start again with no page): `pastedIdentity()` — first-party, the row's container and private flag, `referrerPolicy 'no-referrer'`, no `Origin` (`:5368-5370`): "the old page is never sent to whatever host the person pastes" (review of Phase 2).
- **Hidden page-step candidates**: `seenIdentity()` — the hidden page's own principal and cookie jar, in the row's container and privacy (`:5511-5514`).
- **Streams** add `withOrigin = true` (`:1125`).

**Why**
- ARCHITECTURE.md "Decisions for the user" → Downloads (`ARCHITECTURE.md:1108-1111`): "Page-derived downloads (Download linked file, Save image as…, Alt+click) are fetched as Firefox's Save Link As fetches them: the page's principal, its referrer policy, third-party cookies allowed; a download another site's page starts and that Deer takes over keeps the integration's stricter cross-site rule."
- The comment in `adopt` (`:1181-1185`): same site or no page → first-party "as Firefox does"; another site → the page is loading principal "so Necko applies the cross-site rules and its SameSite=Strict/Lax cookies are not sent. If the server then refuses or answers with a page, the probe below hands the download back to Firefox."
- The prototype took every take-over as `firstParty: true` (`VitreTakeover.sys.mjs:80-86`); cross-site cookie partitioning was listed as "unverified" in the spike (`RESULT.md:93`). The product added the cross-site rule and `tests/downloads/crosssite.js`.
- Referer must be computed by Deer: "With a system triggering principal Necko trims a same-origin Referer to the origin. Compute the referrer yourself and set it with policy UNSAFE_URL" (gotcha 2, `RESULT.md` recipe; `net.ts:349-354`). Headers set on a channel are lost on redirect, so `dress` runs again on every hop (gotcha 1; `net.ts:341-344`).

**Edge cases handled**
- A stored principal that no longer deserialises never silently becomes the system principal (`net.ts:306-308`).
- Saved records from older builds lack `pageRules`/`principal`; `Identity` fills safe defaults (`types.ts:49`, `:56`; `load()` normalises every identity, `VitreDownloads.sys.ts:910`).
- The page's cookie jar wins over a per-connection lane jar when the lane would move the request into another cookie partition (`net.ts:330-332`).

**Proven by**
`tests/downloads/crosssite.js` ("a download started by another site is taken over by Vitre's engine", "without the site's SameSite=Strict cookie", lines 25-34); `tests/downloads/safety.js` item 4 (page as Referer under the default policy, none for `rel=noreferrer`; Alt+click too); `tests/downloads/resolve.js` "container" (a cookie set in container 1 reaches the server).

---

## 8. Referrer policy (`referrer.ts`)

**What it does**
The Referer a download sends follows the page's rule: a `rel=noreferrer` link sends none; the default sends the full address to the same origin and only the origin to other sites; https → http sends nothing.

**How it works**
- Policy names are the W3C names (`referrer.ts:13`); `''` means the browser default, `strict-origin-when-cross-origin`.
- `readReferrerInfo(info)` (`:36-46`) turns Firefox's `nsIReferrerInfo` into `{url, policy}`; an info that sends nothing reads as `no-referrer`. `policyOf()` maps Firefox's constants (`:48-57`). The name is stored on the identity so a resume after restart uses the same rule.
- `referrerFor(page, target, policy)` (`:70-101`), the spec's "determine request's referrer":

| Policy | Same origin | Cross origin | https→http (downgrade) |
|---|---|---|---|
| `no-referrer` | none | none | none |
| `unsafe-url` | full | full | full |
| `no-referrer-when-downgrade` | full | full | none |
| `origin` | origin | origin | origin |
| `strict-origin` | origin | origin | none |
| `origin-when-cross-origin` | full | origin | origin |
| `same-origin` | full | none | none |
| default / `strict-origin-when-cross-origin` | full | origin | none |

"Full" = the page address without `#fragment` and without user:password (`:74-80`).
- The Mark of the Web records the page under the same policy (`platform.ts:73-86`).

**Why**
The system principal makes Firefox treat every download request as cross-origin, so its own policy code would always trim the Referer. Deer applies the policy itself (`referrer.ts:1-5`; `RESULT.md` Compromise 7).

**Edge cases handled**
- Unknown stored values fall back to the default (`asPolicy`, `:28-30`).
- `same-origin` compares scheme and `hostPort` (`:72`).

**Proven by**
`tests/downloads/safety.js` item 4.

---

## 9. Private-window downloads

**What it does**
A download from a private window is shown only in private windows, is never written to disk lists, uses the private cookie jar, and disappears (cancelled if still running) when the last private window closes, as in Firefox.

**How it works**
- The private flag comes from the Firefox download (`src.isPrivate`, `:1187`) or the window (`store.start` adds `isPrivate: this.b.isPrivate`, `store.ts:158-160`). The channel is set private (`net.ts:328`).
- Never written: `persisted()` filters out private rows (`:5088`). Their hash journal and segment table stay in memory (`recordFor`, `:1714`; `tableOf`, `:1922`).
- Never through yt-dlp (it "would ask the site from outside the private session", `:1900-1908`, `:2247-2254`).
- The background page step runs only in a private window for a private row (`resolverFor`, `:3451-3457`; `pageDue`, `:3447`). The Firefox history entry of a claimed download is not removed for private rows (Firefox keeps none, `:1348`).
- Closing the last private window while private downloads run: see §23. When it closed (`last-pb-context-exited`): every private row is cancelled if unfinished and removed (`:5234-5240`).
- A quit cancels private downloads (they are paused like the others, but never saved, so they are gone; the prompt says "Private ones are cancelled", `system.ts:140-145`).
- Pre-match and attach only consider rows of the same privacy and container (hard rule, `:4049`; RESUME-DESIGN.md 2.1).
- `renewWith()` refuses a pill in another container or privacy (`:3937-3938`).

**Why**
"Private downloads are never written to disk lists and are dropped when the last private window closes (last-pb-context-exited), as Firefox does" (`:197-199`).

**Edge cases handled**
- Firefox's own private-download guard would not ask (Deer took its downloads over), so Deer refuses the close itself (`:5200-5203`).
- Mark of the Web gets `isPrivate` so Firefox's service can treat it as Firefox does (`platform.ts:82`). What exactly Firefox writes for private files I did not check.

**Proven by**
`tests/downloads-verify/v-windows.js` (own list, not in the store file, close prompt, quit with only private downloads); `tests/downloads/takeover.js` (private download not in the store); `tests/downloads/resolve.js` "private"; `tests/downloads/attach.js` "private"; spike `verify/out/takeover2/log.txt` (`RESULT.md:272`: "the private download is not written to the store; Firefox's private list is empty").

---

## 10. File naming

**What it does**
A downloaded file gets the name the server gave, else the name in the address, else (for videos) the page title; with a sensible extension; with characters Windows refuses replaced; and with dangerous Windows names made harmless.

**How it works**

*Where the name is decided:*
- **Deer-started file** (`start()`): `newRec` sets `sanitize(opts.filename)` or `sanitize(nameFromUrl(url) || title || 'download')` (`VitreDownloads.sys.ts:1036`). At the first probe, if the row has no path yet and is not `named`, `runFile` replaces it (`:1530-1533`):

```
rec.filename = chooseName({
    disposition: probe's Content-Disposition,
    url:         probe's final address (after redirects),
    mime:        probe's Content-Type,
    title:       rec.videoKey ? rec.title : '',
    suggested:   rec.filename || nameFromUrl(rec.url)
})
```
- **Taken-over file**: `newRec` gets Firefox's own name from its target path (`:1168`, `:1199`). Firefox already parsed Content-Disposition and applied its own rules. Because the probe already ran in `adopt()`, `runFile` skips the block above (`:1520`), so the name stays Firefox's, passed through Deer's `sanitize()`. (The prototype noted the same: "the name comes from Firefox's own target", `RESULT.md:242`.)
- **Streams**: `"<title or streamTitle(url)>.mp4|.m4a"` (`:1126`); once prepared, the extension is replaced by the transfer's expected one (`:1865`). **yt-dlp**: `"<title or video>.<ext>"` (`:1116`).
- **Save dialog**: the chosen name is final (`named = true`, `:2307`).

*`chooseName`* (`naming.ts:163-173`):

```
name = nameFromDisposition(disposition) || suggested || nameFromUrl(url)
if (name is empty or isOpaque(name)) and title:
    name = title + (extOf(name) ? '.' + extOf(name) : '')
host = hostname(url) || 'download'
return sanitize(withExtension(name || host, mime), fallback = host)
```

*`nameFromDisposition`* (`naming.ts:79-100`):

```
star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i       // RFC 5987: charset'lang'value
if star: try return decodeURIComponent(value without surrounding quotes)  // charset is ignored: UTF-8 assumed
plain = /filename\s*=\s*("((?:\\.|[^"\\])*)"|[^;]+)/i   // quoted (with \-escapes) or token
name = unquoted, backslash escapes removed, trimmed
// Firefox hands header bytes over as Latin-1; many servers send raw UTF-8:
if name has chars in U+0080..U+00FF and none above U+00FF:
    try name = UTF-8 decode(bytes of name)  (fatal: if not valid UTF-8, keep Latin-1)
return name
```

*`nameFromUrl`* (`naming.ts:103-111`): the last non-empty path segment, percent-decoded; `''` on a malformed address or bad `%`.

*`isOpaque`* (`naming.ts:154-160`) — names nobody would choose: base name in `master, index, playlist, video, audio, stream, manifest, hls, main, media, chunklist, videoplayback, download, file`; or `\d{3,4}p` (`720p`), `file N`, `seg-12`/`segment_12`; or 16+ hex characters.

*`withExtension`* (`naming.ts:147-151`): only when the name has **no** extension, add one from a 35-entry MIME table (two MIME types each for zip and rar) (`MIME_EXT`, `naming.ts:25-61`: pdf, zip, 7z, rar, gz, exe, msi, json, epub, doc/docx/xlsx/pptx, txt, csv, html, mp4, webm, mov, mkv, ts, mp3, m4a, aac, ogg, wav, flac, jpg, png, gif, webp, avif, svg). `extOf` accepts 1-10 letters/digits after the last dot (`naming.ts:63-66`).

*`sanitize`* (`naming.ts:130-145`):

```
name = raw with control chars (U+0000-001F, U+007F) and < > : " / \ | ? * replaced by a space
collapse whitespace; trim; strip trailing dots and spaces
if name matches /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i: prefix "_"     // Windows device names
if empty or only dots: fallback ('download', or the host)
name = Firefox validateFileNameForSaving(name, '', SANITIZE_ONLY | DONT_TRUNCATE)
        // .lnk .url .scf .local ... get ".download" appended; bidi overrides -> "_"
if longer than 180: keep the extension, cut the stem to 175 - len(ext)
```
`firefoxSafe()` returns the name unchanged outside Gecko (`naming.ts:120-127`).

*Categories and `streamTitle`* are in §12 and below.
- `streamTitle(url)` (`naming.ts:187-199`): the last useful path part (skipping `master|index|playlist|hls|dash|video|stream|manifest|main|\d+p?` and 16+ hex/dash tokens), with `.m3u8/.mpd` removed; else the host without `www.`.

**Why**
- The prototype naming (`VitreNaming.sys.mjs`) is the same algorithm; the product added `firefoxSafe()` "so Deer's downloads are as safe on disk as Firefox's own" (`naming.ts:6-8`), after "review 2 findings 14, 18, 19, 20, 21" (`tests/downloads/safety.js` header): a server name like `.scf`/`.lnk`/`.url` acts by itself when Explorer lists or opens it, and `"inv\u202efdp.exe"` would display as `invexe.pdf` (`naming.ts:113-119`).
- The Latin-1 → UTF-8 repair: "Necko hands header bytes over as Latin-1; many servers send raw UTF-8" (`naming.ts:93`).
- Opaque names: streams and CDN files are often called `master.m3u8` or `videoplayback`; the page title is better (`naming.ts:153`).

**Edge cases handled**
- `filename*` wins over `filename` when both are present; a broken `%` sequence in `filename*` falls back to `filename`.
- Quoted names with `\"` escapes.
- Names that are only dots, empty, or reserved device names.
- Very long names keep their extension.
- Behaviour I noticed by reading (no test seen):
  - the `filename*` charset is ignored, so an `ISO-8859-1''%E9` name usually fails to decode and falls back to the plain `filename`;
  - RFC 2047 `=?UTF-8?B?…?=` names and percent-encoded plain `filename="%E2%82%AC.txt"` are not decoded;
  - a wrong extension is kept (`report.php` served as `application/pdf` stays `report.php`); only a missing one is added;
  - for a Deer-started download, `suggested` is always non-empty (it is at least `'download'`), so the redirect target's own name (`nameFromUrl(finalUrl)`) is never reached; a link to `https://site/` that redirects to `/files/report.pdf` with no Content-Disposition is named `download.pdf`.

**Proven by**
`tests/downloads/safety.js` item 1 (`.scf`/`.lnk`/`.url` get `.download`, bidi override becomes `_`, whoever names the file); the test server sends `filename*=UTF-8''…` names (`tests/downloads/server.py:404`, `:960`, `:1102`, `:1147`, `:1176`); spike `out/takeover/log.txt` ("saved as 'Quarterly report (final).dat'", `RESULT.md:60`).

---

## 11. Unique names, reserved names and duplicates

**What it does**
A new file never overwrites another: it becomes "name (1).ext", "name (2).ext"… The check also counts files still downloading and partial files kept aside, so two rows never write the same file.

**How it works**
- `uniquePath(dir, name, taken)` (`naming.ts:176-184`):

```
ext  = extOf(name); stem = name without ".ext"
for n in 0..9999:
    candidate = dir / (n == 0 ? name : stem + " (" + n + ")" + (ext ? "." + ext : ""))
    if !taken(candidate) and !exists(candidate) and !exists(candidate + ".part"): return candidate
return dir / (stem + " (" + Date.now() + ")" + ext)
```
- `taken(p, except)` (`VitreDownloads.sys.ts:2293-2297`), case-insensitive (Windows): another row (not `except`) whose `path` is `p` and is not finished, **or** whose `oldParts` contains `p + ".part"` (Start over's kept partial).
- `reserve(rec)` (`:2283-2291`): create the folder (a failure reads as a disk error, `onDisk`, `:607-615`); with `overwrite` (the Save dialog already confirmed replacing) use the exact name; otherwise `uniquePath`, also treating a stream's `.video.part`/`.audio.part` as taken (`streamPartsExist`, `:5568-5571`). The path is reserved **before the first byte** (`runFile`, `:1551-1554`).
- At the finish (`placeFinished`, `:2261-2275`): with `overwrite` delete the target first; otherwise, if something took the name meanwhile, pick the next free one.
- `freePath()` for a stream's merge output (`:2277-2281`).
- Other reserved names:
  - Start over keeps the old partial as `"<name>.old.part"`, else `"<name>.old (n).part"` (n < 1000), else a timestamp (`oldPartFor`, `:3030-3041`); it never takes a name that is another file, another row's, or a parts folder.
  - Keep partial file saves `"<stem> (partial).<ext>"` (`attach.ts:181-185`), made unique.
  - A blocked file waits as `"<path>.blocked"` (`block`, `:2448`); Keep file moves it to a unique name (`keep`, `:2472`).
  - A yt-dlp row whose new format needs another file type is renamed `"<stem>.<ext>"` or the next free name (`setAsideYtdlp`, `:2071-2075`).

**Why**
Windows file names are case-insensitive, hence the lower-case comparison. Reserving at start (not at the end) is what lets a later row see the earlier one's name as taken. The `.part` check stops a new download from colliding with an unfinished file that another program (or an earlier Deer) left.

**Edge cases handled**
- Attaching a start again to an old row keeps the old path, so no "(1)" copy is ever made (`attach()` comment, `:3775-3776`; commit `3e7f908`).
- `extOf` sees only the last extension: `archive.tar.gz` becomes `archive.tar (1).gz` (by reading `naming.ts:176-182`).

**Proven by**
`tests/downloads/attach.js:196`, `:216` ("completed intact under its own name, with no ' (1)' file"); `attach.js:302-321` (Keep partial name).

---

## 12. Categories (no category folders)

**What it does**
Each row has a category for the panel's filters and its small label: video, music, documents, compressed, programs, images, other.

**How it works**
`categoryOf(name, mime)` (`naming.ts:68-76`): first the extension table `EXT` (`naming.ts:15-23`; e.g. programs = exe, msi, msix, appx, bat, cmd, ps1, iso, img, vhd, vhdx, apk, dmg, jar), then the MIME prefix (`video/`, `audio/`, `image/`), else `other`. The view recomputes it from `filename` and `mime` (`VitreDownloads.sys.ts:4614`). The panel filters by it (`panel.ts:384`, `:440`).

There are **no per-category folders**: the folder is always `opts.dir || settings.downloadsFolder || Windows Downloads` (`:1028`). This differs from IDM, which sorts categories into folders.

**Why**
Not recorded. Categories also decide whether yt-dlp may renew a page media file (`ytdlpDue`, `:2256`: video or music) and whether Check file runs ffmpeg (`:4716`).

**Edge cases handled**
A name without extension still gets a category from the MIME type.

**Proven by**
`tests/downloads/ui.js` (panel filter captured).

---

## 13. Where a file goes, "Ask where to save", and finishing

**What it does**
Files go to the Downloads folder in Settings (Windows Downloads by default). With "Ask where to save each file" on, or with "Save link as…", the Windows Save dialog opens once, before anything is written. A finished file is renamed from `.part`, checked by Safe Browsing, marked as from the internet, and recorded.

**How it works**
- `confirmPath(rec)` (`VitreDownloads.sys.ts:2300-2310`), called after the probe and before `reserve` (`:1551-1553`, `:1866`, `:1945`): if `askWhere`, clear it (ask only once), open `platform.pickSavePath()` on the tab's window (`windowFor(browserId)`, `:632-642`). Cancel → `false` → `throw new SaveDeclined()` → `stopped()` removes the row entirely (`:2514-2518`). OK → `dir`, `filename` from the chosen path, `named = true`, `overwrite = true`.
- The dialog (`platform.ts:89-116`): `nsIFilePicker` save mode, default name, a filter for its extension plus "All files", starting folder; `returnOK` or `returnReplace` give the path.
- For mirrored Firefox downloads, the dialog opens when the file is finished, and cancel deletes the file and removes the row (`:1417-1426`).
- `placeFinished(rec, part)` (`:2261-2275`): clear the sparse flag (Windows refuses to mount a sparse ISO/VHD), move `.part` to the final name (unique again if needed).
- `complete(rec)` (`:2312-2361`):

```
drop Start over's old partials (the new file is complete)
if engine-fetched http(s) file (not mode 'browser'):
    sha256 = once, only if Safe Browsing will need it (hashWanted)
    verdict = reputationOf({url, pageUrl, referrer policy, path, size, sha256})
    if row removed or cancelled meanwhile: return
    if verdict != 'safe': block(rec, verdict); return     // dangerous: delete; uncommon/unwanted: ".blocked"
state = completed; finishedAt = now; clear error/need/catcher/resumeOnStart/suspect/trying
stream merge markers cleared; total = received = size on disk
Mark of the Web (Firefox's mozIDownloadPlatform.maybeWriteDownloadOriginInformation)
stamp size + mtime (later changes read as "Changed after download")
settle, save flushed
in the background: finishRecord() (whole-file SHA-256 and the block record, after the download queue calms down)
```
- `block()` (`:2443-2465`): dangerous → delete; uncommon/unwanted → move to `.blocked` (or delete if the move fails); the row fails with one of three sentences (`BLOCKED`, `:484-488`). `keep()` (`:2468-2499`) gives the file its name, note "Kept although Safe Browsing warned about it.", Mark of the Web again.
- `open(id)` (`:3121-3134`): refuses if not completed or missing; an executable that is not `.exe` asks first (Firefox's prompt, `mayLaunch`).
- `showInFolder` (`:3136-3144`): the file, else its `.part` (or a stream's first track part), else the folder.

**Why**
"'Ask where to save each file': the Windows save dialog, once, before the first byte is written" (`:2299`). The take-over prefs keep Firefox from asking itself (§5). Safe Browsing and Mark of the Web are re-done by Deer because "Take-over skips what belongs to Firefox's Download object: Safe Browsing reputation checks…" (`RESULT.md` Compromise 5).

**Edge cases handled**
- A dialog cancelled means the download never happened: the row is removed, not failed.
- A missing window for the dialog falls back to the most recent browser window (`windowFor`).
- A Pause or Cancel that arrives while the run finishes stops it before the rename (`:1581-1584`).
- A file moved or deleted after completion shows `missing` (`diskState`, `:5391-5399`).

**Proven by**
`tests/downloads/safety.js` items 2-3; spike `takeover-3-save-dialog.png` (`RESULT.md:66`, `:244`); `tests/downloads/takeover.js` (Mark of the Web on finished files).

---

## 14. The person's commands and their careful edges

**What it does**
Pause, Resume/Retry, Try now, Cancel, Remove from list, Clear finished, Pause all, Resume all, per-download speed limit, Download again, Copy address. Each command behaves sensibly whatever the row is doing at that moment.

**How it works**
- **Pause** (`pause`, `:2734-2774`): always clears `resumeOnStart` (the person's pause survives a restart).
  - queued → paused; ends a wait; drops a warm probe.
  - starting → `hold = true` (the take-over ends paused).
  - downloading (Deer) → `run.reason = 'pause'`, abort; the view reads paused at once. Mirrored → Firefox `cancel()`.
  - paused with a wait or a renewal running → stop the renewal, drop the wait (the row keeps its `need`).
- **Resume** (`resume(id, now)`, `:2776-2851`):
  - refused while Start over writes its decision (`deciding`).
  - a ranged run that is "asking" → `poke()`: every waiting connection asks now (Try now).
  - any manual action stops a scheduled renewal and resets its counters (`renewFailed`, `renewTries`, `wait`, `ytdlpSaid`).
  - completed + file still there → nothing; file gone → rewind and download again in place.
  - Pause then Resume before the connections closed → `run.resumeAfter = true`; `stopped()` queues it again ("the last word wins", `:2527-2530`).
  - mirrored → Firefox `start()`, or `need 'page'` (§6).
  - paused/failed/cancelled/queued → queued (a blocked row's quarantine file is deleted first so it is fetched and checked again).
  - `now = true` (Try now) → front of the queue and launch at once.
- **Cancel** (`cancel`, `:3043-3062`): a run → `reason 'cancel'` + abort (mirrored: drop Firefox's copy). No run → `markCancelled()` (`:2657-2670`): clear need/wait/catcher, stop renewals, delete partial files (`removeParts`, `:2695-2730`: `.part`, a stream's track parts, `.merge.part`, `.keep.part`, spill folders, `.part.new`, old partials; a yt-dlp row only its own parts), `rewind()` (`:2673-2692`: no partial file, no path, no counters).
- **Remove** (`remove`, `:3065-3072`): cancel if unfinished, delete a `.blocked` file, remove the row and its journals — **never the finished file**.
- **Clear finished** (`:3089-3101`): removes completed, cancelled **and failed** rows of the given privacy.
- **Pause all / Resume all** (`:3104-3110`): per privacy; Pause all also reaches rows in an automatic wait.
- **Speed limit** (`setLimit`, `:3112-3118`): `limitKBps = max(0, round(kbps))`, saved (not flushed).
- **Download again** (`downloadAgain`, `:4997-5012`): a new row with the same address, name (`named`), page and identity.
- **Copy address / clipboard** (`:3150-3157`; `platform.ts:64-67`: only one `http(s)` address under 4096 characters).

**Why**
Comments name each case: "It reads as paused at once (view()), so a quick second press means Resume" (`:2758`); "The person paused it: it stays paused over a restart" (`:2738`); "A manual action: an attempt of the schedule gives way, and the count starts again" (`:2786-2787`).

**Edge cases handled**
- Cancel during a pause still closing: `if (run.reason === 'cancel') return;` in pause (`:2754`).
- Remove keeps the finished file; Cancel only ever deletes Deer's own unfinished files ("Deer's own unfinished files, never the finished one", `:2694`).
- A yt-dlp Cancel never deletes another row's parts of the same video (`:2697-2711`).
- `removeSoon()` retries a delete 4 times, 500 ms apart, while a scan or hash read holds the file (`:5402-5411`).

**Proven by**
`tests/downloads/engine.js` (pause/resume, speed limit), `tests/downloads/ui.js`, `tests/downloads-verify/v-rapid.js`, `v-keys.js`.

---

## 15. How a run ends: one classification (`stopped()`)

**What it does**
Whatever stops a run, the row ends in a state that loses nothing: paused with a reason, waiting to retry by itself, or failed with a plain sentence.

**How it works** (`stopped(rec, run, err)`, `VitreDownloads.sys.ts:2508-2614`). `classify(err)` (net.ts) gives `{kind, status}`. In order:

| Condition | Result |
|---|---|
| `SaveDeclined` | row removed |
| Pause, then Resume came before it stopped | `queued` again |
| Pause | `paused` |
| Quit | `paused`; a wait's try or an "asking" run keeps its wait; otherwise `resumeOnStart` was set by shutdown |
| Sleep | `paused`, `wait 'sleep'`, `nextAt = now + SLEEP_FALLBACK (1 min)` |
| Cancel (or an abort with no reason) | `cancelled` |
| `refused` or `not-file` with bytes saved (file, stream, yt-dlp) | `paused`, `need 'address'` (Link expired), `wait 'address'` with the renewal schedule; the page step may run at once (`step 'page'`) |
| `changed`, stream, ≤ 1 MiB saved, ≤ 2 silent restarts in 10 min | restart the stream by itself (`restartStream`, `:3745-3760`) |
| `changed` | `paused`, `need 'choice'` (File changed), with the other version kept for Start over |
| `offline`/`timeout`/`server`, file or stream | `paused`, `wait 'network'` or `'server'` (`waitAgain`, `:2627-2648`) |
| anything else | `failed` with `describeError(err)`; "Start this download again from its page." for a guarded not-file |

Then: a seal of the hash record for any stop but Cancel; `touch`, `settle`, flushed save, `pump()` (`:2605-2613`).

**Why**
RESUME-DESIGN.md's rule "never destroy, never mix" (section 1): an address that refuses or answers with a page must never replace the half-downloaded file or complete it. The classification makes that one place.

**Edge cases handled**
- A run that saved bytes resets `renewTries` (`:2522`).
- A renewal that attached an address but whose run fails before saving a byte continues the old schedule instead of restarting it, so a host that "passes the proof but refuses the transfer" still runs out of attempts (`:2550-2565`; review of Phase 2).
- The "asking" state is read when the stop was *asked* (`atStop`, `:2509-2512`), because after the connections left it would never look like a wait.

**Proven by**
`tests/downloads/network.js` (fatal failures still fail; waits), `tests/downloads/expiry.js`, `tests/downloads/attach.js`.

---

## 16. Waits that continue by themselves, and the single wait timer

**What it does**
Rows waiting for the network, a busy server, the end of sleep, or the next attempt to renew a link show "Waiting for network", "Retrying · in 40 s", "next try 14:05", and continue on their own. Pause ends the wait; Try now acts at once.

**How it works**
- One timer for the earliest `wait.nextAt` among paused rows and the earliest end of a "Waiting for link" (`armWaits`, `:4349-4380`). It is re-armed on every save. Delay = `max(0, nextAt - now, loadedAt + WAIT_GRACE - now)`, capped at 2^31-1 ms; `WAIT_GRACE = 5000` ms so attempts that fell due while Deer was closed wait 5 s after start (`:268`). When it fires (with 50 ms slack): an expired catcher ends; an `address` wait runs `episode()` (§17/§18); other waits run `retryWait()`.
- `retryWait` (`:4388-4403`): while Firefox is offline a network wait only counts the try; otherwise the row is queued (it goes through Checking).
- `waitAgain` (`:2627-2648`) decides the next try with `waitNext()` (`waits.ts:54-57`): **30 s** (`QUEUE_RETRY`, `waits.ts:25`), never before `Retry-After` (capped at 24 h, `waits.ts:31`). The count goes on across runs (network and server failures share it) unless the run saved `FRESH_AFTER = 8 MiB` more (`waits.ts:33`). `SERVER_GIVE_UP = Infinity` (`waits.ts:29`): a server wait no longer fails by itself.
- `bringWaits(cause)` (`:4414-4431`) on Firefox online, network link up/changed, or wake: network waits → `now + SOON (5 s)` (`waits.ts:27`); sleep waits → `now + WAKE_SETTLE (10 s)` after wake, or at once on link-up (`waits.ts:35`); an exhausted Link-expired schedule gets one more attempt, at most once per `RENEW_ON_LINK = 10 min` (`:277`).
- `sleep()` (`:4438-4459`) on `sleep_notification`: queued rows pause into a sleep wait; running ones stop with reason `sleep`.
- The renewal schedule for Link expired (`renew.ts:58`, `:70-72`): `SCHEDULE = [0, 2 min, 13 min, 45 min, 300 min]` between attempts, i.e. about 2 min, 15 min, 1 h and 6 h after the failure; after the 4th, none planned (only wake, link-up or a manual action).
- Waits never hold a quit back (`runningCount`, `:988-991`; `running()`, `:5327-5329`).

**Why**
Owner decision 8 (RESUME-DESIGN.md section 9): never give up while offline; link attempts at 0, 2 min, 15 min, 1 h, 6 h. Commit `4bcd891` (2026-10-21, "ask again as IDM does", the owner's decision): waits outside a run "try every 30 s and never give up after 24 h", matching IDM 6.43's queue.

**Edge cases handled**
- Slept time is not counted as active time: a tick counts at most two ticks (`:4498-4499`).
- A sleep whose wake never came continues after 1 min (`SLEEP_FALLBACK`, `waits.ts:40`).
- **Stale documents**: the engine header (`VitreDownloads.sys.ts:111-125`) and ARCHITECTURE.md (`:612-617`) still describe the older schedule (10 s, 30 s, 1 min, 2 min, 5 min, then every 10 min; give up after 24 h). The code (`waits.ts:24-29`) says 30 s and never. The code is the truth.

**Proven by**
`tests/downloads/network.js` (drop, offline, busy, long Retry-After, alternate 503/drops "one count … each next try 30 s later … 24 h after the first 503 it still keeps trying", fatal, sleep/wake).

---

## 17. Starting it again on its page: pre-match, attach, Refresh address

**What it does**
When a download's link expired ("Link expired"), you can start it again on its web page (click, Alt+click, Add link, copied link). Deer recognises it, proves it is the same file by its bytes, and continues the old row from where it stopped: one row, no "(1)" copy, only the missing bytes fetched. "Refresh address" tries to renew the link at once and, if that fails, opens the page and waits 30 minutes for you to click it ("Waiting for link").

**How it works**
- Rows that may be continued (`waitsForAddress`, `:4034-4036`): paused one-file rows with a probed file and a path, needing an address or a page, or with an address wait, or armed; not running, not being proven, not deciding.
- Score (`preMatch`, `:4043-4058`; `attach.ts:98-113`), only for rows of the same privacy and container:

| Signal | Points |
|---|---|
| started in the tab Refresh address opened (armed, within 30 min) | +5 |
| a name stem in common (lower case, no extension, no " (n)", never opaque names like download/file/index/get/dl/attachment/media/video/audio or 16+ hex) | +3 |
| the same page (without `#fragment`) | +2 |
| the same path shape (origin + path, no query) as any of the row's addresses (own, final, redirect hops, replaced ones) | +3 |
| the same site as the row's address | +1 |

`PRE_MATCH = 5` or more, best score wins (`attach.ts:24`).
- On a pre-match, nothing is shown yet (the take-over holds `added`; `start()` returns the old id). `proveFor()` (`:4071-4101`) runs the byte proof with the start's own identity (another section explains the proof). A start with no page is asked as a pasted address (`pastedIdentity`), and the row keeps its page.
  - `same` → `attach()` (`:3780-3801`): adopt the address (and the start's identity), clear need/wait/catcher, queue, emit `attached` so it flies from the tab, history "Continued from its page".
  - `changed` only for the "real file" (`realFile`, `attach.ts:158-164`: same page, same server name when both gave one, and a name in common that is not a script's name like `fetch` from `/fetch?id=`) → `changedFor()` (`:4137-4166`): File changed with that address kept for Start over, or with ≤ 1 MiB saved (`ASK_ABOVE`, `proof.ts:29`) and ≤ 2 restarts in 10 min, Start over at once.
  - anything else → today's path: a new row, whose `added` carries `replaces = oldId` so Add link selects the new row (`attachStart`, `:4108-4125`).
- Refresh address (`refreshAddress`, `:3869-3894`): run one renewal attempt now (counts reset); results `renewed`, `changed`, `page` (the window opens the page in a foreground tab of the row's container, then calls `arm(id, browserId)`, `:3903-3909`), `none`, `busy`.
- `openPage()` (`:4017-4023`) and `stopWaiting()` (`:3912-3918`). The catcher is dropped at restart (browserIds belong to one session, `:887-888`).

**Why**
RESUME-DESIGN.md decision 4: attach only to rows that need an address or were armed, "always silent, always with the byte proof". Commit `3e7f908`. `realFile` exists because "an unrelated download behind the same endpoint was swallowed as the waiting row's changed file" (`attach.ts:12-16`, review of Phase 3).

**Edge cases handled**
- A start again during a scheduled renewal wins (the attempt gives way) — before this, it "became 'name (1)' and downloaded the whole file again" (`:4026-4031`).
- A start in another container never continues a row (`attach.js` "container").
- Closing the armed tab does not stop the wait (`:3897-3900`).
- Keep partial file (File changed's other choice) saves the unbroken beginning from byte 0 (`unbroken`, `attach.ts:171-178`) as "(partial)"; the new name is saved (flushed) before the move, and `load()` undoes a move cut short (`:891-899`, `:4182-4276`).

**Proven by**
`tests/downloads/attach.js` (click, alt, addlink, other, changed, keep, container, renew, private, othername, endpoint).

---

## 18. The background "page step" (`pagestep.ts`)

**What it does**
When a download's link expired and the cheaper steps found nothing, Deer opens the download's web page **out of sight**, in its container, muted and kept out of history, looks at what the page offers, and tries those addresses. If one is proven to be the same file, the download continues; the row only shows "Renewing link". Deer never clicks, submits forms, signs in or touches a CAPTCHA.

**How it works**
- Order of renewal steps for a one-file row (`episode`, `:3334-3433`): (1) the original address and its recorded redirect hops; (2) yt-dlp's formats of the page, for page media files (`ytdlpStep`, `:2221-2244`); (3) the page step (`pageStep`, `:3555-3608`). Streams have their own steps and use the page step through `pageStreams` (`:3618-3645`).
- When it may run (`pageDue`, `:3442-3448`): setting `renewFromPage` on (default), an `http(s)` page, a probed file row with a path or a stream with tracks, not opened for this row in the last 30 min (`PER_ROW`, `pagestep.ts:40`; `rec.pageAt` is saved so a restart does not reopen sooner), and a window of the row's privacy registered a resolver.
- Limits (`pagestep.ts:33-49`): `LOAD_MS = 30 s` to load, `COLLECT_MS = 10 s` to collect; `PER_SITE = 6` pages per site per `SITE_WINDOW = 1 h` (`Budget`, `pagestep.ts:58-82`; in memory; the 7th waits until the oldest leaves the hour); **one page at a time** (`pageTurn` chain, `:3471-3475`); a guard timer of 55 s (`LOAD_MS + COLLECT_MS + 15000`, `:3501`).
- `visitPage` (`:3466-3541`): registers a **claim** for the hidden tab (by `browserId` and by every browsing context attached under it, `watchContexts`, `:3322-3336`); while open, any download the page starts by itself is caught in `adopt()` before a row is made (`claimed`, `:1344-1349`), Firefox's copy is dropped and its history visit removed (`forgetDownloadVisit`, `:5523-5536`, now and 3 s and 10 s later); late arrivals are still claimed for `CLAIM_GRACE = 5 s` (`:554`). The hidden page gets no saved logins (`keepLoginsFrom`, `:5548-5566`, answers `PasswordManager:findLogins` with nothing for a claimed tab).
- Collecting stops early (`enough`, `:3562`) at a claimed download, media whose byte size equals the file's, or a link scoring `STRONG = 7`.
- Candidates, each proven, in this order (`:3578-3584`): what the page started by itself; the row's own address again ("the page load may have set the cookie its host checks"); the page's links scored by `pickLinks` (`pagestep.ts:96-128`: same path shape +4, same name +3, link text names the file or says "download" +1, same site +1; top `TOP_LINKS = 5` with at least `MIN_SCORE = 3`); media of exactly the file's size (`sameSizeMedia`); the main video. If the page landed on another site, only the first two.
- Verdict: the first SAME wins anywhere; otherwise the "real file over other bytes" by rank (own address 0, claimed 1, link/media/video 2), and rank 2 always asks (never a silent start over); otherwise `none`, with `signIn` when the page landed elsewhere or showed a password field → the row asks for its page: "The page may need you to sign in" (`SIGN_IN`, `pagestep.ts:49`; `:3429`).
- Site for the limits is `siteKey()` (`site.ts:11-22`): registrable domain **without** scheme (an IP or single label: its host).

**Why**
RESUME-DESIGN.md decision 6 (owner, 2026-10-13): automatic first, on by default with a Settings switch, with exactly these budgets. Decision 7: keep visits out of history. Commit `52b75cf`. `siteKey` drops the scheme because "a page the site or HTTPS-First moved from http to https was 'another site'" (review of Phase 7, `site.ts:4-10`). Every candidate is proven before deciding because "a 64-bit installer above the 32-bit one" made the row File changed (`:3585-3589`).

**Edge cases handled**
- A frame added and removed at once to start a download is still claimed (`watchContexts` comment, `:3313-3321`).
- A window closing ends its step at once (`setResolver(win, null)`, `:5143-5151`).
- A private row only in a private window; never in a normal one.
- The window half (hidden tab, muted, pop-ups refused, history off, closed-tab list untouched, related-tab order kept) is described in ARCHITECTURE.md `:741-776` (`gecko/src/window/modules/downloads/resolver.ts`, not in my file list).

**Proven by**
`tests/downloads/resolve.js` (renew, history, auto, click, login, elsewhere, container, off, budget, private, stream, twin, stream2, quiet, popup, iframe, close, order); spike `spikes/downloader/boot-pagestep.js` (no history visit on 9 real sites, ARCHITECTURE.md `:747-748`).

---

## 19. Per-site rules (`site.ts`, `sites.ts`, and the few others)

**What it does**
Almost everything is generic. A handful of sites get special treatment.

**How it works**
- **YouTube → yt-dlp.** `ytdlpFirst(pageUrl)` (`sites.ts:5-15`): host (without `www.`, `m.`, `music.`) is `youtu.be` with a path, or `youtube.com`/`youtube-nocookie.com` with a path starting `/watch`, `/shorts/`, `/live/`, `/embed/`. Used by the picker (`media.ts:353-358`: offer only through yt-dlp, "Saving videos from this site needs yt-dlp." when it is missing) and by the window's download mark (`video.ts:823`, `:858`, `:932`).
- **Terms reminder.** On the first download from each of `youtube.com, youtu.be, googlevideo.com, facebook.com, fbcdn.net, instagram.com, tiktok.com, x.com, twitter.com, vimeo.com, twitch.tv, reddit.com, dailymotion.com, soundcloud.com, netflix.com`, the picker shows "Check that the site’s terms allow saving its videos." once per host (`video.ts:58-72`, pref `vitre.downloads.termsSeen`).
- **Cloudflare challenge** (net.ts, not my file): an answer with `cf-mitigated: challenge`, or a 403/429/503 whose `Server` header says cloudflare, whose type is HTML and whose first 4 KB match challenge markers (`cf-chl`, `challenge-platform`, "Just a moment...", "Attention Required!", `error code: 10xx`…), is treated as a refused address (Link expired, then the page step), "never asked again and again", because asking again "raises the address's bot score" (`net.ts:775-797`; ARCHITECTURE.md `:544-545`).
- **Embedded players** whose server refuses the tab's page are asked again as the player's frame (`Identity.requestPage`; `media.ts` offer(), ARCHITECTURE.md `:508-511`).
- **Site counting** for the page step and the yt-dlp lookup budget (`siteKey`, `site.ts:11-22`; `ytdlpSites`, `:741`).
- There is **no** Dailymotion, Vimeo or other extractor in the engine beyond yt-dlp.

**Why**
`sites.ts:1-2`: "their traffic has nothing downloadable (YouTube streams through SABR/UMP POST requests)". The terms list is a courtesy reminder (`video.ts:58`).

**Edge cases handled**
`ytdlpFirst` is pure (no Gecko services) so the window bundle can import it too.

**Proven by**
`tests/downloads/ytdlp.js`, `tests/downloads/ui.js` (the one-line terms notice), `tests/downloads/embed.js`, `tests/downloads/connections.js` (challenge knobs, per commit `4bcd891`).

---

## 20. Persistence of the list

**What it does**
The list, with every segment's progress, survives restarts, crashes and even a lost or damaged list file.

**How it works**
- Files in the profile: the store `vitre-downloads.json` (`:757`), its temp `.tmp`, the backup `.bak` (+ `.bak.tmp`), a damaged copy set aside as `.corrupt`; per-download journals in `vitre-downloads/` (`<id>.jsonl`, `<id>.done.jsonl`, `<id>.stream.jsonl`, `<id>.restore`).
- Shape, version 2 (`STORE_VERSION`, `:266`; `persisted`, `:5083-5103`): `{version: 2, session: {startedAt, clean}, items: Rec[]}`. Private rows are left out. A running transfer is saved as its **snapshot**, "what is certainly on disk, not what is still in a pipe" (`:5091-5099`).
- `save(flush)` (`:5113-5127`):

```
data = persisted()
chain after the previous save (saves never overlap):
    IOUtils.writeJSON(store, data, {tmpPath: store + '.tmp', flush})   // atomic
    if flush: IOUtils.writeJSON(store + '.bak', data, {tmpPath: store + '.bak.tmp', flush: true})
re-arm the wait timer
```
- When: `save(true)` on every state change (dozens of call sites; e.g. `added`, `stopped`, `complete`); while runs exist, every `SAVE_EVERY = 2 s` unflushed, and flushed at least every `FLUSH_EVERY = 30 s` (`:259-261`, `:4533-4534`).
- `load()` (`:801-913`):

```
for path in [store, store.bak]:
    try saved = readJSON(path) with an items array
    if ok: if it was the .bak, copy it over the store; break
    if the file exists but is unreadable: move it to path + '.corrupt'
if nothing: rebuild rows from the journals (fromJournals, :5042-5079)
unclean = saved.session.clean === false          // version 1 stores count as clean
for each item (needs id and an http url string):
    v1 file records: contentType = mime, typeGuessed = true
    settleSegments (no segment claims more than its length; an unknown end means unknown total)
    if state in ACTIVE:
        Firefox-mirrored or 'starting' -> failed, "Interrupted when Deer closed."
        a wait's try that was on its check -> paused, wait due now
        else -> paused; if unclean: resumeOnStart = true and mark the bytes to re-check
    clear trying, hold, catcher; finish or undo a Keep-partial move; check a stream merge cut short
    keep only valid waits (a wait not due on a paused row is made due now, except address waits)
    normalise identity
```
- `init()` writes the store at once with `clean: false`, flushed (`:767-769`); `shutdown()` writes `clean: true` last (`:5296-5297`). So a store that says `clean: false` was left by a crash or power loss.

**Why**
Commit `13f9783` (Phase 1): "Store version 2 with a flushed .bak; a damaged store loads its backup." RESUME-DESIGN.md 5.6. The `.bak` is written only on flushed saves "so the .bak is always the last flushed list, never one a power loss can catch half-written with the store (review of Phase 1: backupFile on every save rotated it every 2 s)" (`:5106-5112`). Setting the unreadable copy aside follows Firefox's `JSONFile` so "when both are unreadable, neither is ever overwritten by the empty list the next save writes" (`:802-806`). Rebuild from journals: RESUME-DESIGN.md 5.7, commit `31eed88`.

**Edge cases handled**
- Saves are serialised through one promise chain; a failure is logged, never thrown (`:5119-5124`).
- Records with a missing id or a non-string url are skipped (`:842`).
- A segment with an unknown end beside a known total (which "cut the .part and looped fileFills() forever") is repaired (`settleSegments`, `:5303-5315`).

**Proven by**
`tests/downloads/restart.js`, `tests/downloads-verify/v-restore.js`, `tests/downloads/network.js` (hard kills), `tests/downloads/repair.js` (rows rebuilt from journals, per ARCHITECTURE.md `:686-687`).

---

## 21. Start-up and "Continue unfinished downloads when Deer starts"

**What it does**
After a restart, downloads that the quit (or a crash) stopped continue by themselves 10 s after the first window opens. Downloads you paused stay paused. Waiting rows continue on their own schedule.

**How it works** (`init`, `:753-799`)
1. Paths; make the journal folder; `load()`.
2. Point every "parts layout" row's reads at its parts (`placeReads`, `:764`).
3. Install quit/private/network/sleep observers (`installLifecycle`).
4. Save flushed with `clean: false`.
5. Arm the wait timer.
6. Finish stream merges a crash cut short after ffmpeg had finished (`joined`, `:773-777`; `mergeLeft`, `:925-949`).
7. After `CONTINUE_AFTER = 10 s` (`waits.ts:42`): `continueAfterStart()` (`:4467-4486`) — for each row with `resumeOnStart`, in old queue order: clear the mark; if the setting `continueDownloadsOnStart` is on and the row is a plain paused row (no need, no wait, not mirrored, not busy), queue it with history "Continued after restart".
8. After 10 s too: `checkAfterStart()` (`:5018-5035`) — after an unclean session, check (hash only, no network) the files finished in it, and any repair a crash cut short; record finished files whose record was never kept.
9. Install the media watch, the settings listener, the take-over.

Who gets `resumeOnStart`: shutdown marks queued rows and running rows unless the person was pausing or cancelling them (`:5274`, `:5284`); `load()` marks running rows after an unclean session (`:866`).

**Why**
RESUME-DESIGN.md decision 5 (owner, 2026-10-13): "on by default, 10 s after the first window, only for downloads a quit or a crash stopped. Rows the person paused stay paused. Waiting rows always continue." Commit `ccd71a9` (Phase 4) added the setting (`gecko/src/shared/settings.ts:35-40`, default `true`).

**Edge cases handled**
- The marks are cleared whatever the setting says, so turning it on later does not resurrect old rows (`:4465-4466`).
- Attempts that fell due while Deer was closed wait `WAIT_GRACE = 5 s` (`:268`).

**Proven by**
`tests/downloads-verify/v-restore.js` ("what the quit stopped … continuing by itself 10 s after the start … the one the person paused staying paused"), `tests/downloads/network.js`.

---

## 22. The quit prompt and shutdown

**What it does**
Quitting, closing the last window or restarting while downloads run is refused once and a small dialog asks: "Keep downloading" (default) or "Quit"/"Restart". If you go ahead, everything pauses where it is and continues next time.

**How it works**
- `quit-application-requested` observer (`:5183-5199`):

```
cancel = subject as nsISupportsPRBool
priv  = privateConfirmed ? 0 : privateRunning()
count = runningCount() - (privateConfirmed ? privateRunning() : 0)
if cancel.data (someone already refused) or count <= 0 or quitConfirmed or quitting: return
kind = data == 'lastwindow' ? 'lastwindow' : data contains 'restart' ? 'restart' : 'quit'
prompt = the most recent window's, else any registered
if no prompt: return                  // nothing can ask: the quit goes ahead
cancel.data = true                    // refuse this quit
setTimeout(prompt(kind, count, priv), 0)
```
- `runningCount()` counts rows that are starting, queued or downloading, but not a wait's try on its check, not a queued row that is really a wait, and not a run that is "asking" (`:988-991`, `:5327-5329`). Waits never hold a quit back.
- The window's prompt (`gecko/src/window/modules/downloads/system.ts:157-221`): a 400 px frosted dialog at layer z 55, leaves element full screen first, closes menus and the switcher; Tab moves between the two buttons; Esc and a click outside mean "Keep downloading". Wording (`promptCopy`, `system.ts:127-148`): "A download is still running" / "N downloads are still running"; "If you quit now, it pauses and continues from where it stopped the next time you open Deer." (with the continue setting off: "it pauses. Resume it from Downloads …"); private ones "are cancelled". "Quit" calls `confirmQuit()` — the next quit request passes for 10 s (`:5154-5159`) — and repeats the original action (`proceed`, `system.ts:109-120`; a restart may be the updater's).
- `quit-application-granted` → `quitting = true`, `shutdown()` (`:5227-5230`); also `AsyncShutdown.profileBeforeChange` blocker (`:5232`) "whatever happens, the list … is on disk before the profile closes".
- `shutdown()` (`:5258-5300`), once:

```
quitting = true
stop every renewal attempt; stop held take-over probes
cancel the continue timer
queued rows (no run) -> resumeOnStart = true
for each run:
    Firefox mirror -> failed, "Interrupted when Deer closed."
    else: resumeOnStart unless cancelling or pausing; note an "asking" run's wait; reason 'quit'; abort
wait up to 5 s for those runs to settle
wait up to 4 s for their hash-record seals
abort Repair/Restore in progress
session.clean = true; save flushed
```

**Why**
The engine rules (`:126-135`). The prototype recipe used `quit-application-requested` with the PRBool to refuse, `quit-application-granted` to pause, and `profileBeforeChange` to write last (`RESULT.md` recipe LIFECYCLE). It also used Firefox's "last window closing survival area"; the product does not (by reading: no `enterLastWindowClosingSurvivalArea` in the engine) — gotcha 6 noted that holding it delayed a granted quit by 3.9 s.

**Edge cases handled**
- Firefox's own private-download guard would not fire (Deer took the downloads), so Deer asks.
- Private downloads the person already agreed to cancel do not count again (`privateConfirmed`).
- In element full screen the prompt would be invisible and the quit silently refused, so it leaves full screen first (`system.ts:174-175`).
- A seal that does not finish in 4 s leaves the row "dirty", and the next start checks it (`:5292-5293`).

**Proven by**
`tests/downloads/restart.js` ("Exit is refused with Vitre's prompt ('Keep downloading' keeps it going); a restart is confirmed from the prompt, the download is paused where it was and its segments written"); `tests/downloads-verify/v-windows.js` (quit with only private downloads says they are cancelled).

---

## 23. The private-window close prompt

**What it does**
Closing the last private window while a private download runs asks first: "Keep downloading" or "Cancel downloads and close".

**How it works**
- `last-pb-context-exiting` observer (`:5204-5225`): if private rows are running and not yet confirmed, refuse (`cancel.data = true`) and ask the most recent private window's prompt (kind `'private'`, `count`, `count`).
- Wording (`system.ts:129-135`): "A private download is still running" / "If you close this window, it is cancelled. Private downloads can’t continue later." Button "Cancel download and close".
- `confirmPrivateClose()` (`:5167-5173`): cancel every unfinished private row now; the next close passes for 10 s.
- `last-pb-context-exited` (`:5234-5240`): cancel and remove every private row.

**Why**
"as Firefox cancels its own private downloads there" (`:5164-5166`); Firefox's own question would not come because its list is empty (`:5200-5203`).

**Edge cases handled**
A quit later in the same 10 s does not count those private rows again (`:5187-5188`).

**Proven by**
`tests/downloads-verify/v-windows.js` (both buttons).

---

## 24. How settings feed the engine

**What it does**
Changes in Settings › Downloads apply without restarting.

**How it works**
- `settings()` reads `VitreSettings.get()` once and caches it; any change clears the cache (`:621-629`, `:788-791`). Reason: "the speed limit is asked for on every chunk of every connection: reading every vitre.* pref each time would cost the main thread" (`:621-624`).
- Defaults (`gecko/src/shared/settings.ts:69-75`) and limits (`VitreSettings.sys.ts:50-56`):

| Setting | Default | Used at |
|---|---|---|
| `downloadsFolder` | `''` = Windows Downloads | new rows (`:1028`), Open folder (`:3147`) |
| `askWhereToSave` | `false` | new rows (`:1058`) |
| `connections` | `8`, min 1, max 32 | `env().connections()` (`:3254`), read when a run starts (`ranged.ts:1147`); files under 8 MiB use 1 (`MIN_SPLIT`, `ranged.ts:95`, `:884-886`); streams at most 16 (`hls.ts:1161`) |
| `speedLimitKBps` | `0` = none | the global limiter, read on every chunk (`:707`) |
| `continueDownloadsOnStart` | `true` | `continueAfterStart` (`:4470`); the quit prompt's wording |
| `renewFromPage` | `true` | `pageDue` (`:3443`) |
| `ffmpegPath` | `''` | `ffmpeg()` (`:3159-3162`); a change forgets the cached ffmpeg (`:790`) |

- Firefox's own download prefs are overwritten at each start by the take-over (§5).
- Per row: `limitKBps` (`setLimit`), `dir` and `saveAs` from `StartOptions`.

**Why**
See the cache comment above.

**Edge cases handled**
`connections` is clamped twice (settings min/max and `Math.max(1, Math.min(32, …))`, `:3254`, `:4583`).

**Proven by**
`tests/downloads/engine.js` (speed limit); `tests/downloads/connections.js`.

---

## 25. Speed limits

**What it does**
A global limit for all downloads and a per-download limit; both apply at once when changed.

**How it works** (`limiter.ts`)
- One token bucket per limit (`RateLimiter`, `:6-46`). `take(bytes)`:

```
rate = kbps() * 1024            // read every call
if rate <= 0: reset; return 0
tokens = min(rate * 0.5, tokens + elapsed * rate)   // half a second of burst
tokens -= bytes
return tokens >= 0 ? 0 : ceil(-tokens / rate * 1000) ms
```
- Each transfer gets `[global, own]` (`VitreDownloads.sys.ts:3250-3253`); `throttle()` waits for the longest (`limiter.ts:49-53`); used per chunk in files (`ranged.ts:1758`) and streams (`hls.ts:1529`).
- While a transfer waits, its channel is suspended, so Firefox stops reading the socket and TCP slows the server (`limiter.ts:1-4`).
- `binding(ms)` tells the connection manager the limit is holding speed down, so it does not cut "slow" connections (`limiter.ts:21-27`).

**Why**
Port of the Electron limiter, "unchanged in logic" (`limiter.ts:1-2`). The 0.5 s burst: "so short pauses don't add up to a slower average" (`:38`).

**Edge cases handled**
A limit the line never reaches does not count as binding.

**Proven by**
`tests/downloads/engine.js` ("the speed limit").

---

## 26. Progress, speed, ETA and the event stream

**What it does**
Rows show speed, average, peak, time left, live connections and an eight-stretch bar.

**How it works**
- A 250 ms ticker (`TICK`, `:258`) runs only while runs exist (`ensureTicker`, `:4488-4491`; stops at `:4542-4545`).
- `tick()` (`:4493-4546`): speed = bytes over the last ~3 s of samples (needs ≥ 0.5 s span; network bytes `netBytes`, not file bytes); `activeMs` grows by at most two ticks per tick (slept time is not counted); peak speed; seals for the hash record; dirty rows flushed as one `update` event; a progress save every 2 s.
- `touch()` → `flushSoon()` emits at most one batched `update` per 60 ms (`:4548-4569`).
- View fields (`:4607-4676`): `average = netBytes / activeMs`, `eta = round(left / speed)`, `connections` live count, `maxConnections` (1 for mirrored and yt-dlp; for a stream or a ranged file of ≥ 8 MiB: `min(stream ? 16 : 32, setting)`), `resumable`, `segments` (eight fills).
- Mirrored rows read Firefox's `currentBytes` and `speed`.

**Why**
"One event per change batch (about four a second while downloading)" (`types.ts:328-334`).

**Edge cases handled**
A stream's or yt-dlp's total is an estimate until known (`:4578`).

**Proven by**
`tests/downloads/ui.js`, `tests/downloads-verify/v-measure.js`.

---

## 27. A stream's segment table (`table.ts`)

**What it does**
For HLS/DASH downloads, Deer remembers every segment it wrote, so a resume continues at the right segment even if the playlist was renumbered, re-cut or re-signed, and so damage can be found and fixed per segment.

**How it works**
- Journal `<profile>/vitre-downloads/<id>.stream.jsonl` (memory only for private rows; `VitreDownloads.sys.ts:1911-1928`). Lines (`table.ts:4-14`):
  - header per track `{deer:1, stream:1, k, seq0, count, durHash, init, keys, rung, t}` (`keep:1` when a renewal continues the same lines, `retarget`, `:141-148`);
  - segment `{k, i, seq, off, len, h, d}` — track, place among written segments, media sequence, byte offset and length in the track's `.part`, hash, EXTINF duration;
  - `{k, cut}` drops lines from a place on; `{k, init}` sets the init hash.
- Hash: SHA-256 cut to 128 bits, of the bytes **as written** (decrypted and unwrapped) (`segmentHash`, `:59-62`). `durHash`: 32-bit FNV-1a of the durations (`:65-70`) to notice a re-cut playlist. `keysOf`: up to 8 key URLs (`:73-75`).
- A torn last line is ignored; compaction when the journal grows past twice what its live lines need plus 4 KiB (`flush`, `:199-209`).
- `mapNext(track, playlist)` (`:237-255`):

```
if nothing written: return 0
if playlist's first seq == seq0 recorded and nextSeq known:
    k = index of nextSeq (or end)
    if cumulative duration up to k is within max(0.05 s, 0.1% of written secs) of written secs
       and the duration before k equals the last written duration (± 0.05 s): return k
for k in 1..len:                         // by time
    sum += duration[k-1]; stop if sum > secs + 0.05
    if |sum - secs| <= 0.05 and neighbour duration agrees: return k
return -1                                 // does not line up: not the same stream
```
Never by position.
- `repick(master, rung, audioOnly, oldVariant)` (`:313-336`): HLS — audio-only by nearest bandwidth; else same height + same codecs (nearest bandwidth), else same height within 10 % bandwidth (`BANDWIDTH_SLACK`, `:56`), else (height only) the richest of that height; else the variant at the old path shape. Audio rendition by GROUP-ID, language, name (`audioOf`, `:365-375`; `strict` refuses a different language).
- `matchRep(mpd, id, rung, kind)` (`:381-389`): DASH — by id, else kind/mime/codecs prefix/height (language for audio), nearest bandwidth.
- `TIME_SLACK = 0.05 s`, `DURATION_SLACK = 1 s` (`:52-54`).

**Why**
`table.ts:15-18`: "hls.ts before Phase 6 counted segments, so a renumbered or re-cut playlist mixed bytes". Commit `6c03bb8`. A strict audio match because "the default rendition was taken silently, so a sound track not yet started continued in another language" (`:362-363`).

**Edge cases handled**
- Renamed DASH representation ids no longer end the download (`table.ts:23-24`).
- An audio-only download of a master's own audio rendition can renew (review of Phase 6, `:300-303`, `:338-358`).

**Proven by**
`tests/downloads/stream-expiry.js`, `tests/downloads/streams.js`.

---

## 28. Platform services (`platform.ts`)

**What it does**
Open a file, show it in Explorer, open the folder, copy/read the clipboard, write the Mark of the Web, show Save/folder/program pickers.

**How it works**
Each Windows service is one small function (`platform.ts:1-9`): `nsIFile.launch()`/`reveal()` (`:13-42`; `openFolder` creates a missing folder first), `nsIClipboardHelper` and `nsITransferable` (`:44-67`), `mozIDownloadPlatform.maybeWriteDownloadOriginInformation` with the page under its referrer policy (`:73-86`), `nsIFilePicker` (`:89-158`; Save offers the file's own extension filter first).

**Why**
"each Firefox internal is behind one small function with its source" — the same call Firefox's own downloads use, so Windows SmartScreen and Office see Deer's files as Firefox's (`platform.ts:69-72`).

**Edge cases handled**
A failed Mark of the Web is logged, never fatal (`:83-85`). A folder that does not exist is ignored by the pickers.

**Proven by**
Spike `out/takeover/log.txt` ("Zone.Identifier read back as '[ZoneTransfer] | ZoneId=3 | HostUrl=…'", `RESULT.md:64`, `:243`); `tests/downloads/takeover.js`, `tests/downloads/attach.js` (kept file has the Mark of the Web).

---

## Lessons worth copying

Ranked by value for an iOS/iPadOS browser.

1. **Paused, not failed, with a reason field.** Keep the state list small (`queued`, `downloading`, `paused`, `completed`, `failed`, `cancelled`) and put *why* on two optional fields: `need` (the person must act: link expired, file changed, open the page) and `wait` (the app will act by itself at `nextAt`: network, server, sleep, next renewal). Nothing with saved bytes ever becomes `failed` because of an expired link or a busy server. One timer serves the earliest `nextAt`.
2. **Never trust a resumed answer that is a web page.** A 2xx `text/html` (or JSON) answer where a binary was expected, or 401/403/404/410/451, means "the link expired", never "here is your file". This single rule stops a half-downloaded video from silently becoming a login page marked Completed.
3. **Take over browser downloads with a parallel probe, keep a fallback.** Let the web view's own download start, ask the server yourself (`Range: bytes=0-0`) at the same time; only if your probe gets the file (200/206/416, not HTML when the browser did not get HTML) cancel the web view's copy and run it in your multi-connection engine. POST answers, one-time links, `blob:`/`data:` and anything your probe cannot get stay with the browser's own download and are only mirrored in the list. The probe is what makes the take-over safe.
4. **Same-site vs cross-site identity.** A download a page starts on its own site gets that site's cookies; one a page starts on *another* site must not get that site's `SameSite=Strict/Lax` cookies; a "Save link as" uses the page's identity and referrer policy. Store the identity on the row so a resume after restart sends the same cookies and Referer. Compute the Referer yourself from the page's referrer policy (the 8-row table in §8).
5. **Persist like a database, cheaply.** Atomic JSON writes (temp + rename), flushed on every state change and at least every 30 s, a `.bak` written only on flushed saves, unreadable copies moved aside (never overwritten by an empty list), a `session.clean` flag written false at start and true only at a clean exit, and a snapshot of "bytes certainly on disk" (not bytes in flight). Private rows are never written.
6. **Distinguish "the person paused it" from "the system stopped it".** `resumeOnStart` is set only by quit/crash; the person's Pause clears it. After launch, continue only the system-stopped rows (after a short grace, 10 s), with a setting. Waits always continue.
7. **Strict queue order.** Two at a time, a strictly increasing queue stamp (`max(now, last+1)`), Resume goes to the back, Try now jumps the queue. Background work (renewals, page scans, checks) never holds a slot.
8. **Name pipeline with a security pass.** Content-Disposition (`filename*` first, Latin-1→UTF-8 repair) → browser's suggestion → address → page title for opaque names (`master`, `index`, `videoplayback`, hex tokens) → add an extension from the MIME type only when missing → sanitize → make bidi-override characters harmless → cap length keeping the extension. Watch the gaps Deer leaves (charset of `filename*` ignored; redirect target's name never used for its own downloads; `.tar.gz` duplicates).
9. **Reserve the final name at start, case-insensitively, against other rows too.** "name (1).ext" must consider files on disk, their `.part`, other running rows' paths and kept-aside partials. Attaching a re-click to an old row must reuse its path, never make "(1)".
10. **Re-clicks continue the old row.** When a link expired, a new start of the same file (score: same tab +5, same name stem +3, same path shape +3, same page +2, same site +1; threshold 5; same privacy and container only) is proven by bytes and continues the old row instead of downloading again.
11. **Commands that never race.** Pause shows paused instantly; Resume during a still-closing pause re-queues ("last word wins"); Pause during the take-over probe holds; Cancel deletes only the app's own unfinished files; Remove never deletes the finished file.
12. **A quit/leave guard that counts the right things.** Count running and queued rows, not waits. Show what will happen in plain words ("it pauses and continues…"; "private ones are cancelled").
13. **Every automatic fix leaves a history line** (last 5 kept), and only rows that started needing the person *this session* raise an attention dot.
14. **Background renewal budgets**: one hidden page at a time, 6 per site per hour, once per download per 30 min, 30 s load + 10 s collect, never click/submit/sign in, and only nominate candidates that the byte proof must accept.

## Not worth copying / Windows-only

- **The Firefox take-over plumbing** (`TAKEOVER_PREFS`, the scratch folder, `Downloads.getList().addView`, `cancel/removePartialData/finalize/list.remove`, `whenSucceeded`, the `live` replay flag, extension `moz-extension` detection, "saved elsewhere"): all Gecko-specific. On iOS the equivalent decision point is `WKNavigationDelegate` (`decidePolicyFor navigationResponse` / `navigationAction`) and `WKDownload`; the *idea* (probe, then take over or fall back) is what transfers.
- **Principals, cookie-jar settings, `TYPE_SAVEAS_DOWNLOAD`, `forceAllowThirdPartyCookie`, connection "lanes"**: Gecko network internals. On iOS you copy cookies and headers into `URLRequest` yourself.
- **Mark of the Web, Safe Browsing via Firefox, `.scf/.lnk/.url` renaming, Windows device names (`CON`, `PRN`, `COM1`…), `<>:"/\|?*`, sparse-file clearing before mounting ISO/VHD, FAT32 4 GiB limit, IDM hooking `firefox.exe`**: Windows-only concerns. On iOS only `/` and `:` and a leading `.` matter in names, plus the 255-byte name limit (verify for your file system).
- **Quit-application observers, `profileBeforeChange`, the last-window prompt, taskbar progress**: desktop app life cycle. iOS has no "quit": the analogues are scene background/termination and background execution, where you cannot show a prompt.
- **yt-dlp, Deno, ffmpeg installation from GitHub, YouTube via yt-dlp**: not possible inside an App Store app (no bundled interpreters that download and run code; YouTube's terms). Keep only the idea "some sites have nothing downloadable in their traffic: say so instead of offering nothing".
- **Native Save dialog / "Ask where to save" / per-folder downloads**: TitleLess stores into an encrypted vault; a folder picker matters only for export (`UIDocumentPickerViewController`), not for the download itself.
- **Hiding login autofill from the hidden page (`LoginManagerParent` patch) and removing Places history**: Firefox internals; on iOS a non-displayed `WKWebView` does not autofill passwords by itself, and history is your own code.
- **The claim registry's browsing-context tracking**: Gecko frame model; a hidden `WKWebView` has its own navigation delegate, so its downloads are already separate.
