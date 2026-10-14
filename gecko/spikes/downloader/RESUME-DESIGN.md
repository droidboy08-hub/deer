# Downloader resume system: design (2026-10-12)

Status: APPROVED by the owner on 2026-10-13, all recommendations as written: build in phase order starting with Phase 1; background page step on by default with a Settings switch (decision 6); continue downloads a quit or crash stopped when Deer starts (decision 5); Start over keeps <name>.old.part until the new file completes (decision 2). The other decisions take the recommendation. Made by a design run (four readers mapped the code, three designers, one synthesis). Paths are relative to gecko/.

1. SUMMARY

Deer already resumes well when nothing has changed. It splits a download into segments, sends If-Range on every request, and its store only claims bytes that have reached the disk. It fails in exactly the cases the owner cares about:
- An old link that has expired fails for good, because Resume always goes back to the dead redirect target.
- A link that now answers with a web page can silently replace a half-downloaded song or video with that page and mark it Completed.

This design fixes that first ("never destroy, never mix"). Then it gives every download a way to prove that a new answer is the same file, by comparing a few 64 KiB windows of bytes already downloaded rather than trusting headers. With that proof in place, Deer gets new addresses by itself, cheapest first: the original link, the stream's master playlist, yt-dlp, and finally the source page opened out of sight. When all of them fail, the row says "Link expired". "Refresh address" then lets the person start the download again on the page, and Deer attaches that new start to the old row instead of making "name (1)". When the file really changed on the site, Deer stops, keeps the old partial file untouched, and asks: start over, or keep the partial file. Lost network, sleep and restarts become waits that continue by themselves. A hash record per block, kept in the profile, finds damage after crashes or disk errors, and only the bad blocks are downloaded again. Everything ships in phases; each phase is fallback-only and is checked by the full download test suite before and after.

Paths are relative to C:\Users\Droid\Desktop\Windows Browser Project\gecko:
- Engine files are in src/modules/downloads/ (ranged.ts, net.ts, hls.ts, partfile.ts, media.ts, ytdlp.ts, types.ts), plus src/modules/VitreDownloads.sys.ts.
- Window files are in src/window/modules/downloads/ (panel.ts, ring.ts, store.ts, video.ts, system.ts, format.ts, principals.ts, index.ts), plus src/window/browser.ts, src/window/firefox.ts and src/window/modules/peek/gecko.ts.
- REF means reference/titleless-downloader/Sources.

Where the three designs disagreed, and what this design picks:
- State model. The download state list stays as it is (types.ts:6). Two new fields are added: rec.wait (Deer is waiting on the world) and rec.need (the person must act). Such rows sit in 'paused'.
  - Rejected: a new 'waiting' state. It touches every state check in the window code.
  - Rejected: queued+wait. runningCount counts 'queued' for the quit prompt (VitreDownloads.sys.ts:102, 375-377), and load() turns queued into paused (VitreDownloads.sys.ts:334).
  - An older Deer build reads these rows as plain paused.
- "Link expired" and "File changed" are paused, not failed. Nothing is lost, the taskbar stays yellow, and red stays for real damage.
- Where the hash records live: in the profile, using an append-only journal format.
- How bytes are compared:
  - Once the block hash record exists, the hashes it recorded at write time are the reference.
  - Before that (older downloads, early phases), Deer reads the matching bytes from the local .part file.
- When to ask about a changed file: only when more than 1 MiB of verified bytes exists.
- Order of renewal steps: original address, master playlist, yt-dlp, source page, then the person. The cheap and invisible steps come first.
- Background page step: on by default, with budgets and a Settings switch, because the owner asked for "automatic first". The alternative "only when the person pressed something" is listed under Decisions.
- Continuing after a restart: on by default for downloads the quit or a crash stopped, behind a setting. The quit prompt already promises this (system.ts:138).
- Durability: correctness does not depend on fsync. If a spike proves FlushFileBuffers works from JS, seals use it to shorten the re-check window.
- "Start over": the old partial is kept as "<name>.old.part" until the new download completes, unless disk space is short.
- What a re-click or pasted address may attach to: rows that need an address, or rows armed by Refresh address. Attaching to any paused row is listed under Decisions.

Facts checked while merging (beyond the maps):
- rec.file is the same object as transfer.state (VitreDownloads.sys.ts:737), and runFile saves the store right after the probe (VitreDownloads.sys.ts:754).
  - So when probe() calls forget() (ranged.ts:146-151, 200-207), the emptied segment list is written to the store before download() or openPart() run.
  - The loss happens at the probe, not only at the truncate. Phase 1 must reach a verdict before it changes any state.
- The 250 ms ticker stops when nothing runs (VitreDownloads.sys.ts:1334-1337). Rows that wait need their own timer.
- IOUtils.writeJSON accepts a backupFile option in this Firefox build:
  - The bundled JSONFile passes it (reference/omni/gre/modules/JSONFile.sys.mjs:121, 426-429) and restores from it on a bad read (:252-257).
  - No bundled JS uses a flush option, so flush stays a spike.
- Hidden tabs and containers:
  - openHidden passes principals only when a triggeringPrincipal is given (browser.ts:886-890).
  - Without one, fx.addTab calls addTrustedTab with no container (firefox.ts:66-68). With one, userContextId is passed (firefox.ts:69-76).
  - So the page resolver must always pass a content principal plus userContextId.
- The md5 check:
  - A TypeError is never retried (net.ts:676) and ends as "The connection was lost." (net.ts:700). That is what a rejected 'md5' in IOUtils.computeHexDigest (ranged.ts:481) would produce.
  - The list of algorithms IOUtils accepts could not be checked locally.
  - Moving md5 to nsICryptoHash, as reputation.ts:34-35 already does for SHA-256, removes the question.

2. HOW A DOWNLOAD IS IDENTIFIED AND PROVEN TO BE THE SAME FILE

2.1 Hard rules, never crossed
- The private flag and container (isPrivate, userContextId; IdentityJSON types.ts:11-42) must be equal.
- The mode family must be equal (file with file, stream with stream).
- Private downloads exist only within their session; they are never written (VitreDownloads.sys.ts:1420).

2.2 Nominators: they only pick candidates and never prove anything
- Source page (pageUrl without the fragment).
- Site (eTLD+1, the sameSite helper at VitreDownloads.sys.ts:194-208).
- Name stem: the server's name, dispositionName, and the filename without the " (n)" that uniquePath adds (naming.ts:176-184), plus nameFromUrl.
- Total size.
- Path shape: origin plus path without the query, for url, every recorded redirect hop, and finalUrl.
- For streams: quality, height, duration and the stable streamKey.
- The armed tab's browserId.

2.3 Recorded at the first probe, as proof inputs
- total, contentType, kind (sniffed from the first bytes), dispositionName, ETag (strong or weak), Last-Modified and server digests.
- The block hash record with a 64 KiB head hash per block (section 4). Until it exists, the local .part bytes stand in for it.

2.4 Verdicts, in order of strength (the first rule that applies decides)

R1, NOT THE FILE. This means the address expired. It is never read as "changed". Any of:
- Status 401, 403, 404, 410 or 451.
- Status 400 with an expiry-type body (S3, GCS or Azure XML; "ExpiredToken", "Request has expired", "Signature").
- A 2xx answer whose Content-Type is text/html, xhtml, json, text/plain or xml, or whose first bytes sniff as "<!doctype", "<html", "<?xml" or "{", when the stored kind is not of that class.
- A total under 64 KiB when the stored total is over 1 MiB.

R2, CHANGED BY SIZE. Both totals are known and they differ.
- For a candidate found on a page or from a click, a different dispositionName too means "not ours". That candidate is ignored and the search goes on.

R3, SERVER CHECKSUM.
- An equal digest of the same algorithm (sha256, sha512 or md5) plus an equal total means SAME.
- A different digest of the same algorithm means CHANGED.
- An S3-style ETag-as-MD5 only ever counts as evidence for SAME, never against it.

R4, BYTE WINDOWS. Deer fetches 64 KiB windows with Range and no If-Range, and compares them.
- With a hash record: the window's SHA-256 against the head hash recorded for that block.
- Without one: against the local bytes, read through a new partfile readAt() (IOUtils.read with an offset, as reputation.ts:37 does).
- All windows equal plus an equal total means SAME. Any window different means CHANGED.

R5, SAME STRONG ETAG on the same host is a fast path. Even then, the window at byte 0 must match.

R6, HEADERS NEVER DECIDE ALONE when bytes can be compared. A different ETag or Last-Modified, or an If-Range answered with 200, only triggers R4.
- Different ETags with equal windows mean SAME (a new address or another CDN edge). The new validators are adopted.
- Twice within 10 minutes sets etagUnstable. If-Range then uses Last-Modified or nothing, and one window is checked every 256 MiB or 5 minutes.

R7, UNKNOWN. The windows cannot be fetched (the server refuses ranges) and there is no equal strong ETag or digest, or there are no local bytes to compare.
- Under 1 MiB downloaded: accepted as a fresh start, because nothing is at stake.
- Otherwise: handled as CHANGED, with the sentence "Deer can't confirm it is the same file."

2.5 Which windows, and when the proof runs
- Ordinary resume at the same address: one window, at byte 0, carried by the probe itself.
  - The resume probe asks Range: bytes=0-65535 with If-Range, instead of bytes=0-0 (ranged.ts:136).
  - One request gives the status, headers, sniff and window 0, so there is no extra request.
- New address, any header difference, or after an unclean exit: 3 or 4 windows.
  - Block 0.
  - The newest hashed block below the lowest unfinished frontier. It was written last, so it catches a swap in the middle of a download.
  - One block picked by a seed from rec.id.
  - The median block when there are more than 8 segments.
- Completion check, when there is no strong validator and no digest: the first block of up to 3 original segments, plus the last block.
- Budget: about 256 KiB per candidate.

2.6 Streams: streamProof(track, newPlaylist)
- The duration is within 1 s.
- The "done" position maps to the new list:
  - by media sequence (nextSeq) when the MEDIA-SEQUENCE base is consistent;
  - otherwise by time: the cumulative EXTINF must be within 0.05 s of track.secs (hls.ts:161), and the neighbouring durations must agree.
- The init segment re-hashes to initHash.
- The last written segment, fetched again, decrypted and unwrapped, hashes to its table entry (lastHash).
- Key URLs may change.
- DASH: representations match by id first, then by kind, mime, codecs prefix, height and nearest bandwidth.

2.7 yt-dlp
yt-dlp's reported filesize for the same format must equal the recorded one; otherwise CHANGED. Today --continue resumes with no validator (ytdlp.ts:308).

3. THE FIVE GOALS

3.0 Shared machinery (used by every goal)

Errors and classification (net.ts):
- AddressRefusedError(status, hint), NotTheFileError(contentType, kind) and ChangedError(evidence), next to DownloadError (net.ts:40-89). ChangedError replaces the private ResourceChangedError (ranged.ts:29).
- Response.head(n), next to bytes() (net.ts:571-591), because bytes() throws once over its maximum (net.ts:578).
- classify(err), next to describeError (net.ts:688). It returns offline | timeout | server | refused | not-file | changed | unknown | disk | damaged | fatal, plus the status. Today's sentences (net.ts:679-700) stay as captions.

stopped() (VitreDownloads.sys.ts:948-971) uses classify():

| Kind | What happens |
|---|---|
| offline, timeout | paused + wait 'network' |
| 5xx, 429 | paused + wait 'server' |
| refused, not-file | a renewal attempt runs, then paused + need 'address' |
| changed, unknown | paused + need 'choice' |
| damaged | repair, or paused + need 'repair' |
| disk | failed, as today, after a seal |
| anything else | failed, as today |

The renewal hook:
- TransferEnv.renew(why), returning Promise<{url, finalUrl, identity?, validators} | null>, replaces the unused synchronous hooks refreshIdentity and onRetry (ranged.ts:66-74).
- It is called where refreshIdentity is called today (ranged.ts:156, 354, 466; hls.ts:534, 603).
- Manager.env() supplies it (VitreDownloads.sys.ts:1289-1299). A new src/modules/downloads/renew.ts owns it.

In-run renewal:
- Single-flight per download, copying refreshed() (hls.ts:637-656).
- At most one per 10 s, and at most 3 per run.
- A failure is remembered for 30 s (REF HLSDownload.swift:881-889).
- Only the cheap steps run here: the original address and the master playlist.
- A new address does not use up an attempt (hls.ts:536-539).
- After a SAME verdict, the transfer adopts the new validators before any connection retries. Otherwise If-Range with the old ETag at a new edge would read as changed (ranged.ts:370-373, 380).

Renewal attempts outside a run:
- Renewer.episode(rec) runs the full list of steps outside the queue, so it holds no download slot. pump() (VitreDownloads.sys.ts:691-712) is unchanged; REF frees the slot the same way (Downloads.swift:1325-1327).
- Schedule: at the failure, then +2 min, +15 min, +1 h and +6 h. After that, only on wake, on network link-up, or on a manual action.
- The count is kept in rec.wait.tries, so it survives restarts. It resets on any manual action and on a successful attach.

Timers: one setTimeout for the earliest wait.nextAt, re-armed at load and on every change. The ticker cannot be used because it stops when nothing runs (VitreDownloads.sys.ts:1334-1337).

expiry.ts reads an expiry time from the URL:
- X-Amz-Date plus X-Amz-Expires; Expires, exp or e epoch values within [now − 1 year, now + 10 years]; Azure se=; X-Goog-Date plus X-Goog-Expires; Akamai hdnts exp=.
- If that time has passed at resume, Deer renews before its first request. This skips the roughly 8 s of 403 retries (ranged.ts:153-157; net.ts:655-658).
- 403 keeps exactly one retry at the same address, because cookies are read live on every request (net.ts:3-5), and only while the expiry time is unknown or still in the future.
- 401 joins the renewal path. Today the 401 refresh lines are dead code, because 401 is not retryable (net.ts:92; ranged.ts:155-156).

G1. Expired file links

Detection:
- R1 at the probe (ranged.ts:131-159), at any range request (pull 361-390, fetchSegment 340-359), or in the single stream (runSingle 441-471).
- A page principal that no longer deserializes (net.ts:223-225) is classed 'identity'. Only the page step or a click can supply a new one (principals.ts:59-78).
- The URL's expiry time has passed.

Automatic steps:
1. Original address.
   - Probe rec.url / file.url and each recorded redirect hop, without If-Range. Necko follows redirects and re-sends the headers on each hop (net.ts:262-263, 332-343). Response.url gives the new final address (net.ts:505).
   - Skipped when url equals finalUrl and its expiry time has passed.
   - This fixes "download?id=" redirectors, release links, share links and CDNs that sign each request.
2. yt-dlp, only for page media files, and only when yt-dlp is installed.
   - formatsOf(pageUrl), built on probe's -J run (ytdlp.ts:189-190).
   - Only https formats whose filesize equals total are judged. No cookies are passed (ytdlp.ts:19).
3. Source page out of sight (phase 7, behind a Setting).
   - A hidden, muted tab loads identity.pageUrl (or requestPage) in the download's container.
   - Candidates:
     - rec.url again, because the page load may have set the cookie the host checks;
     - page links, scored (same path shape +4, same name +3, anchor text +1, same site +1); the top 5 scoring 3 or more are probed;
     - MediaWatch items under the hidden tab's browserId whose bytes equal total (media.ts:200-251, 300-304);
     - 'downloads:main-video' (src/actors/page/downloads.ts:347);
     - any Firefox download the page starts by itself (the claim registry, 3.0 below).
   - Deer never clicks, submits a form, logs in or touches a CAPTCHA.
   - If the page lands on another site or shows a password field, the row gets need 'page' ("The page may need you to sign in.").
4. Every candidate goes through the proof.
   - SAME: attach.
   - NOT THE FILE, or "not ours": next candidate.
   - CHANGED for the real file (same name and page, different bytes): goal 3.

Manual fallback (IDM's "Refresh download address"):

Refresh address, the row's primary verb:
- It runs a renewal attempt at once; the row shows "Renewing link".
- If that fails and a source page exists, Deer opens the page in a visible foreground tab, in the download's container. A private download opens in its private window (store.ts:31-33).
- Deer arms rec.catcher {until: +30 min, browserId}, and the row shows "Waiting for link".
- The pill note (video.ts:735-766) shows "Start song.mp3 again on this page. Deer continues from 62%." with [Stop waiting].
- Closing that tab does not cancel; the person may sign in in another tab first.

Catching a re-click in adopt() (VitreDownloads.sys.ts:495-577):
- Right after browserId is known (VitreDownloads.sys.ts:510), Deer checks the claim registry for hidden tabs.
- Then preMatch() looks for records that need an address, are armed, or wait for an address, with the same private flag, container and mode 'file'.
  - Score: armed browserId +5, same name stem +3, same page +2, same path shape +3, same site +1. A score of 5 or more is a pre-match.
- With a pre-match, the 'added' event (VitreDownloads.sys.ts:533-534) is held until the probe (VitreDownloads.sys.ts:541-547) and the proof finish, about 0.3-2 s. So the window does not fly a row that will vanish (video.ts:164-180).
- Outcomes:
  - SAME: dropFirefox (VitreDownloads.sys.ts:579-585), attach, and a new 'attached' event that flies from the tab like 'added'. The pill note says "Continuing song.mp3 from 62%".
  - CHANGED: Firefox's copy is dropped and the old row becomes File changed, with the new address kept as the Start over candidate.
  - No match: today's path, with the row added late.

Catching a re-click in start() (VitreDownloads.sys.ts:440-465):
- This covers the menus, Alt+click, Add link, Download copied link and the downloads service (index.ts:134-174).
- Only when candidates exist and the download is an http(s) file: preMatch runs synchronously. On a match no new record is made: Deer probes, proves, attaches and returns the old id (Add link selects it, panel.ts:776).
- Otherwise start() is unchanged.

Use another address… (row menu):
- An inline field opens in the details, reusing the Add link form styles (panel.ts:257-261) and its Esc handling (panel.ts:302-306).
- It calls engine.setAddress(id, url): probe, proof, then attach. Otherwise the note says one of:
  - "That address is a different file (12 MB; this download is 1.2 GB)." with [Use it and start over];
  - "That address answers with a web page, not the file.";
  - "Deer couldn't reach that address."

attach(rec, fresh):
- The old url is pushed to address.history (at most 5).
- New values are set for rec.url, file.url, file.finalUrl, the validators and identity:
  - for clicks, the principal and cookie jar come from pageIdentity (principals.ts:59-78);
  - for hidden pages, from the page's documentPrincipal, as Alt+click gets it through fx.frameLoadData (video.ts:309-317).
- need, wait and catcher are cleared, and the row is queued.
- path, segments and the .part are untouched, so taken() and uniquePath never produce " (1)" (VitreDownloads.sys.ts:837-840; naming.ts:176-184).

Browser-mode rows (mirrored POST forms, one-time links, blob:/data:, extension downloads; VitreDownloads.sys.ts:526-561):
- Never renewed automatically.
- Retry no longer switches them to a plain GET of rec.url with no checks (VitreDownloads.sys.ts:1091-1094). They get need 'page' and Open page.
- The reason Deer left the download to Firefox is saved on the record; today it lives only in memory (VitreDownloads.sys.ts:288, 527, 558).

What the person sees:
- Checking, then Renewing link, then either the download continues (history line "New link found today, 13:02"), or Link expired.
- The Link expired caption reads "The link stopped working (403) · 62% is saved · next try 14:05".

G2. Expired stream links (HLS, DASH)

Detection:
- A track playlist answering 401/403/404/410, or answering with something that is not a playlist (text() hls.ts:591-607; prepare hls.ts:190; refreshed hls.ts:646).
- A refused DASH manifest (hls.ts:195).
- A segment answering 401/403/404/410, or not being media (fetchPiece hls.ts:518-546). Today only 401 and 403 are handled, at hls.ts:530.
- A key answering 401/403 (key() hls.ts:610-630).
- Segment sniff, new:
  - TS sync byte 0x47 at offsets 0 and 188;
  - mp4 boxes ftyp, styp, moof, sidx, emsg, prft, mdat;
  - WebM EBML or Cluster;
  - ADTS or ID3.
  - An html or json Content-Type, or a first byte of '<' or '{', is NotTheFile. Today any 2xx body is written (hls.ts:550-586).

Automatic steps:
1. The same media playlist (today's refreshed(), hls.ts:637-656).
   - Key failures use it too.
   - A segment takes the fresh key URL even when its own address did not change. This fixes the check at hls.ts:536.
2. The master playlist or manifest.
   - resolved is reset and sourceUrl is read again.
   - The same rung is picked by its stored fingerprint: audioOnly, then height plus codecs, then the nearest bandwidth within ±10%. Audio is picked by GROUP-ID, language and name (parseMaster/ladder/audioFor, playlist.ts:127-184).
   - Today the master is never read again once resolved (hls.ts:168). When the picker hands over a variantUrl, the master is not read at all, so bandwidth stays 0 (hls.ts:169-182).
   - DASH: representation id first (hls.ts:213-216), then attributes, so renamed ids no longer fail with "The stream changed" (hls.ts:216).
3. yt-dlp: a format's manifest_url for the same height.
4. The source page: MediaWatch hls or dash items under the hidden tab, ranked by rankStreams (media.ts:87-93).
   - They are described fresh, skipping the 60 s cache (media.ts:461-462, 509-510).
   - The duration must be within 1 s, the path shape or host must match, and the stream must not be protected (media.ts:294-297).
   - Then the rung is picked again as in step 2.

Every new playlist goes through streamProof (2.6):
- On SAME, the track URLs are replaced and the download continues at nextSeq, by sequence and never by position. This replaces the silent reset at hls.ts:158 and the positional counter at hls.ts:345.
- A resume where every segment is already downloaded skips prepare() and goes straight to the merge. An expired playlist then cannot block bytes already on disk (VitreDownloads.sys.ts:768-780).

Manual fallback:
- Refresh address opens the page.
- The pill finds the old row through a stable streamKey: the page's origin plus path, the rounded duration and the title. yt-dlp keeps 'ytdlp|webpage_url' (ytdlp.ts:203).
- Today's videoKey depends on the tab's session and the signed URL (media.ts:346; store.ts:68-73; video.ts:394-402), so the old row is never found.
- The pill shows a new "Continue · 62%" face (video.ts:1036-1063). Pressing it calls engine.renewWith(id, option) with the same quality.
- If that quality is gone, the picker shows "1080p is no longer offered". Picking another quality turns the row into File changed.

What the person sees: the same states as for G1.

G3. The file changed on the server

Detection:
- Rules R2-R6.
- During a download, ChangedError: a validator mismatch, or a 200 answer to a range request when a validator was sent (pull, ranged.ts:370-384).
- Streams: streamProof fails.
- yt-dlp: the size differs.
- The completion check (2.5).

Automatic:
- Under 1 MiB of verified bytes: restart silently, at most 2 times in 10 minutes, then ask.
- Otherwise:
  - Stop. The .part and its hash record are left untouched.
  - The row becomes paused + need 'choice', with evidence, for example "was 512 MB, now 498 MB; 210 MB were downloaded from the old file".
  - The new address is kept in need.candidate, so Start over needs no new lookup.
- Resume, or Space, on a changed row runs the proof again, since the server may have gone back to the old file. It never restarts. So resumeAll (VitreDownloads.sys.ts:1159-1161) can never bypass the decision.

Removed:
- forget() followed by a second probe (ranged.ts:146-151).
- learn() clearing the segments on resume (ranged.ts:184-193).
- The silent restart on a change, and the persisted lifetime limit of 2 restarts (ranged.ts:246-252).
- The truncate in openPart. It now happens only when allowFresh is set, by a first start or by Start over (ranged.ts:261-274).
- In runSingle, when old bytes exist, the new answer is written into "<part>.new". Its first blocks are compared, and the files are swapped only on SAME (ranged.ts:441-471).
- The segment-count reset at hls.ts:158 becomes the proof.

Manual choices:
- Start over with the new file.
  - A decision line is written durably first.
  - The old part becomes "<name>.old.part". It is deleted when the new file completes, or at once if ensureRoom fails (ranged.ts:531-539).
  - The hash record is reset, allowFresh is set, and rewind (VitreDownloads.sys.ts:991-1003) queues the row with the stored address.
  - The name is kept, because a row's own path is excluded in taken() (VitreDownloads.sys.ts:837-840).
- Keep partial file.
  - Files: the unbroken beginning from byte 0 becomes "<stem> (partial).<ext>".
  - Streams: the written segments are merged with ffmpeg, cut to the shorter track.
  - The row becomes completed with a note. Safe Browsing and the Mark of the Web run as usual (complete, VitreDownloads.sys.ts:855-885).

What the person sees: "File changed", an evidence caption, two buttons, and a line saying exactly what each button deletes or keeps.

G4. Restarts, sleep and lost internet, even days later

Detection:
- classify() (3.0).
- New observers in installLifecycle (VitreDownloads.sys.ts:1481-1542): network:offline-status-changed, network:link-status-changed, sleep_notification and wake_notification. None exist under src/modules today.
- A session.clean flag in the store.

Automatic:
- Network errors become paused + wait 'network'. This covers UNKNOWN_HOST, OFFLINE, NET_TIMEOUT, NET_RESET, CONNECTION_REFUSED, NET_INTERRUPT, and ShortBodyError once a segment's budget is used up.
  - Retries come at 10 s, 30 s, 1 min, 2 min and 5 min, then every 10 min.
  - It never fails on its own. Network link-up or wake moves the next try to 5 s later.
  - Today 3 attempts with 2 s and 6 s waits fail the whole download (ranged.ts:22; net.ts:655-658).
- When a connection runs out of attempts on a network error, the whole run stops cleanly into the wait. Each connection closes its writer first, so every count stays exact (ranged.ts:424-435).
- 5xx and 429 become wait 'server'. Retry-After is honoured, the same schedule applies, and after 24 h the row fails with today's sentence.
- The retry budget is kept in wait.tries and resets after 8 MiB of progress, as ranged.ts:351 already does per segment.
- Sleep: running transfers pause with reason 'sleep' (and a seal) into wait 'sleep'. On wake, after link-up or 10 s, they queue again through Checking. A signed link that expired during sleep then follows G1 by itself.
- Quit: shutdown() (VitreDownloads.sys.ts:1547-1568) marks the records it stopped with resumeOnStart.
  - At the next start, 10 s after the first window opens, if "Continue unfinished downloads when Deer starts" is on (the default), they queue again through Checking.
  - Downloads the person paused stay paused.
- Crash detection:
  - At startup the store saves session {clean: false}, flushed. shutdown's final save sets clean: true.
  - After an unclean session, records that were running are marked suspect.
  - Before phase 5, Deer downloads again the last 8 MiB below each segment's mark. From phase 5, the hash rules in section 4 decide.
- Slept time no longer counts as active time: tick caps dt at 2 × TICK (VitreDownloads.sys.ts:1311-1328).
- The merge crash window:
  - The 'merging' phase and the output path are saved, flushed, before ffmpeg runs (VitreDownloads.sys.ts:778-784; hls.ts:272-308).
  - On load: if the output exists and the parts are gone, Deer checks it and completes. If the parts exist, it merges again. If neither exists, the row is damaged.
- Store safety:
  - Saves are flushed on state changes and every 30 s. A .bak copy is kept through backupFile.
  - load() falls back to the .bak. Today an unreadable store becomes an empty list, which the next save writes over the file (VitreDownloads.sys.ts:322-326).

Manual: Try now (resume(id, true), VitreDownloads.sys.ts:1100-1103) on any waiting row. Pause clears the wait and the row becomes plainly paused.

What the person sees:
- "Waiting for network".
- "Retrying · in 40 s".
- History lines such as "Continued after restart, 09:01" and "Checked after Deer closed unexpectedly · 2 MB fetched again".

G5. Damaged downloads: see section 4.

4. DAMAGED-FILE REPAIR PLAN (GOAL 5)

4.1 What is recorded while downloading

The block hash record (new src/modules/downloads/ledger.ts):
- Block size bs = clamp(pow2ceil(total / 2048), 1 MiB, 64 MiB), so a file never has more than 2048 blocks.
- Blocks are aligned to the file, not to segments. plan() (ranged.ts:218-227) and claim() (ranged.ts:320-332) round their cut points to multiples of bs, so each block sits inside one segment. Older, unaligned segments still work: coverage is the union of [start, start + received).

When a block is hashed:
- Once it lies wholly under durable coverage, meaning snapshot() minus what is still waiting in a writer's pipe (ranged.ts:106-115).
- This is checked on each writer.close() (ranged.ts:428) and on a timer.
- At most 2 blocks are hashed at once. Hashing may fall behind; it catches up at pause, at the finish and at each seal.

How a block is hashed:
- IOUtils.read(path, {offset, maxBytes}) reads it in 1 MiB chunks. IOUtils does the reading off the main thread; reputation.ts:37 already uses this form.
- Each chunk goes through crypto.subtle.digest('SHA-256'), already used in this module (hls.ts:618, 709).
- Block hash = SHA-256 of the chunk hashes, cut to 128 bits.
- Head hash = SHA-256 of the block's first 64 KiB. These are the windows the proof compares.
- If the spike shows subtle.digest blocking the main thread, the fallback is nsICryptoHash in 4 MiB pieces (reputation.ts:33-46).
- Reading block 0 back also sets kind by sniffing the first bytes (REF DownloadVerifier.swift:48-104; hls.ts:731-737).

Seals:
- When: at pause, quit, sleep, a disk error and before the final rename, and every 30 s or 256 MiB.
- Steps, in order:
  1. FlushFileBuffers on the .part, if the spike proves a way (an IOUtils zero-byte append with flush, or js-ctypes CreateFileW plus FlushFileBuffers);
  2. a seal line with the coverage, flushed;
  3. a flushed store save.
- A clean stop drains the hashing, seals, and clears file.dirty.

Streams:
- After mark(), the in-order write loop (hls.ts:476-483) records one table line per segment: {i, seq, off, len, h, d}.
- The segment bytes already pass through JS (hls.ts:476), so hashing costs no extra read.
- The table also records initHash, the key URLs and the rung.

Finished files:
- At complete() (VitreDownloads.sys.ts:855-885) the record is kept as <profile>/vitre-downloads/<id>.done.jsonl.
- The whole-file SHA-256 is computed once. It is checked against any server digest and reused for Safe Browsing, which computes one today and throws it away (reputation.ts:33-46, 64).

4.2 How damage is found
- Every resume: re-hash the last 2 hashed blocks below each frontier, plus 2 hashed blocks picked by a seed.
- The .part's modified time is more than 5 s later than the last seal while the download was not running: full local check ("changed by another program").
- After an unclean session:
  - Hashed blocks newer than the last seal are re-hashed.
  - Claimed bytes above a segment's last hashed block are rewound.
  - Without a proven fsync, the re-check also covers blocks hashed in the 2 minutes before the last seal. Windows writes dirty cache pages back within seconds; the margin is generous.
- A missing .part:
  - The download starts over with a history line, "Started over: the saved part was moved or deleted". Today this is silent (ranged.ts:264).
  - Nothing is left to protect, so Deer does not ask.
- A short .part: only the lost tail, as today (ranged.ts:263-265).
- A disk error: Writer.durable is kept (ranged.ts:431), and the block that contains the failed write is marked suspect.
- A server digest mismatch at the end (ranged.ts:480-486): the blocks are checked locally first.
- The completion check (2.5).
- Finished files: checked automatically at completion and after an unclean exit. Otherwise only on demand, with Check file. There are no periodic scans.
  - A modified time later than finishedAt is shown as "Changed after download", not as damage.
- Media check, when ffmpeg is present:
  - `ffmpeg -v error -i f -map 0 -c copy -f null -`, which only reads the file.
  - runFfmpeg must also return its stderr tail on success (ffmpeg.ts:110-120).
  - Stream output duration must match the playlist within ±2% or 2 s (REF HLSDownload.swift:1507-1590).

4.3 What is repaired, and how

Partial download:
- Each bad block is released by splitting its segment into three parts: [start, bad) fully received, [bad, badEnd) with received 0, and the rest with its prefix.
- The split is saved, flushed, before anything is fetched.
- The block is fetched again through the normal range request with If-Range. The new bytes must re-hash to the OLD recorded value; a mismatch is evidence of a change and goes to G3.

Digest mismatch at the end:
- No more segments = [] (ranged.ts:483). The blocks are checked locally and the bad ones fetched again.
- If every local block matches the record, the network delivered wrong bytes (plain HTTP). Deer runs the proof, then compares with the server block by block and replaces the blocks that differ.
- A whole download again happens only as the person's Download again.

Finished file (Repair):
1. Run the proof, using only the good blocks as windows.
2. Fetch each bad block into memory, at most bs (Response.bytes, net.ts:571-591).
3. Check it against the record BEFORE writing.
4. Write a durable repair line to the journal, so a crash in the middle re-checks those blocks.
5. Write the block in place with Writer(path, offset) (partfile.ts:99-106, writeBytes 149-162).
- If the server's version differs, Repair refuses and offers Download again.
- If the link has expired, Repair goes through G1 first.

Older finished files with no record:
- A stored digest is checked.
- Otherwise, once 2 of 3 windows match the server, the file is compared block by block.
- Under 5% of blocks different counts as local damage and is repaired. More counts as a changed file, and Deer asks.

Streams:
- In a partial track, the file is cut at the end of the last good segment, instead of starting the track again from zero (replaces hls.ts:436-439).
- A damaged middle segment is fetched again, checked against its table hash, and written back at the same offset and length.
- A finished merged file is repaired by running the stream download again, checking every segment against the old table, merging, and replacing the file. Re-muxing means its bytes cannot be traced back to segments.

4.4 What cannot be repaired
- Bytes that arrived corrupted over plain HTTP before hashing, when the server sent no digest. The record keeps them as the truth; TLS protects HTTPS.
- A file the server has changed: only Start over.
- A server without ranges: any damage means the whole file again.
- An expired link with no way to renew it: the repair waits for an address.
- yt-dlp outputs. There is no block record (only existence is checked today, ytdlp.ts:345). A whole-file hash can detect later damage; repair means downloading again.
- Private downloads after their session ends.
- A file the person edited (for example with a tag editor). It is never "repaired" silently; Restore original runs only when chosen.
- Same-size edits outside every window, on a server with no validators and no digest. Only a full comparison finds these.

5. DATA AND STORAGE CHANGES

5.1 Rec (VitreDownloads.sys.ts:121-163). All new fields are optional.
- wait?: {for: 'network' | 'server' | 'sleep' | 'address', since, nextAt, tries, status?, step?}. The state stays 'paused'.
- need?: {kind: 'address' | 'choice' | 'repair' | 'page', since, status?, evidence?, candidate?: {url, finalUrl, identity, total, etag, lastModified, contentType}}.
- catcher?: {until, browserId?}.
- events?: string[]. The last 5 history lines, with times.
- resumeOnStart?, suspect?.
- origin?: {kind: 'takeover' | 'service' | 'picker' | 'addlink' | 'copied' | 'ytdlp', reason?, serverName?}.
- streamKey?.
- check?: {at, ok, badBlocks, badBytes, edited}.
- sha256?.
- journal? (the journal file's path).

5.2 FileState (ranged.ts:44-55; defaults in fresh(), ranged.ts:94-96)
- contentType, dispositionName, kind.
- digests: [{alg, value, src}]. This replaces digest, which is migrated into it.
- etagUnstable.
- chain: string[], at most 8 redirect hops. They are recorded in the redirect handler (net.ts:332-343) and exposed on Response next to url (net.ts:505).
- address: {obtainedAt, lastOkAt, expiresAt, history: [{url, finalUrl, at, how}] (at most 5)}.
- allowFresh.
- dirty.
- restarts is kept only as a guard against loops, and a decision resets it.

5.3 StreamState and StreamTrack (hls.ts:31-61)
- rung: {height, width, bandwidth, average, codecs, audioGroup, audioLang, audioName}, or for DASH {id, kind, mime, codecs, height, bandwidth}. It is filled in prepareHls / prepareDash (hls.ts:166-219), and passed from the picker through StartOptions (types.ts:96-127; VideoOption.height is at types.ts:165).
- phase 'merging' and mergeOut.
- Per track: nextSeq, initHash, lastHash, pathShape, keyUrls.

5.4 YtdlpState (ytdlp.ts:259-266): height, fps, filesize.

5.5 DownloadView (types.ts:45-94)
- wait, need, nextAt.
- phase gains 'checking' | 'renewing' | 'repairing'.
- history, canRenew, armed, keep {bytes, secs}, status, check.
- pageUrl already exists (types.ts:48).

5.6 Store version 2 (STORE_VERSION at VitreDownloads.sys.ts:101; persisted() and save() at VitreDownloads.sys.ts:1416-1444)
- Shape: {version: 2, session: {startedAt, clean}, items}.
- writeJSON keeps tmpPath and adds backupFile (.bak).
- flush: true on state changes, at quit and every 30 s. The 2 s progress saves stay unflushed; the dirty flag and the re-check rules make that safe.

5.7 Journal: <profile>/vitre-downloads/<id>.jsonl (append-only JSON lines; a torn last line is ignored)
- header {deer: 1, id, path, url, identity, total, bs, ct, name, etag, lm}
- block {b, h, a}
- seal {cov: [[start, received]...], t}
- drop {drop: [b...]}
- decision {restart | keep | repair, t}
- repair {blocks, t}
- Streams: header {seq0, count, durHash, init, keys, rung}, plus seg lines {i, seq, off, len, h, d}.

Rules:
- The journal is compacted (tmp file, then rename) when it grows past twice its live size.
- Private downloads keep it in memory only.
- It lives in the profile, never next to the person's files.
- It is removed with the row. removeParts (VitreDownloads.sys.ts:1006-1017) also removes "<name>.old.part", "<part>.new" and the "<part>.d" spill folder, which is left behind today (VitreDownloads.sys.ts:1014-1016).
- If the store and its .bak are both lost, records are rebuilt from the journal headers and their last seal.

5.8 Migrating existing downloads (load(), VitreDownloads.sys.ts:320-341)
- Version 1 files load. Defaults:
  - file.contentType = rec.mime; kind from rec.mime; digests from digest; chain = [];
  - address.obtainedAt = startedAt; expiresAt read from finalUrl;
  - rung.height read from rec.quality (for example "1080p");
  - nextSeq = -1, meaning segments are mapped by time.
- Partial downloads with no record: on the first resume the record is built from the local bytes as they are, but only after 2 windows match the server. A part that is already damaged or mixed is caught before it becomes the reference.
- Completed version 1 rows: Check file uses the "older finished files" path in 4.3.

6. UI STATES AND WORDING

Rules:
- One row per download, for its whole life.
- No dialogs.
- Space never destroys bytes.
- Red (#ff99a4 dark, #c42b1c light; css.ts:84, 92, 334) only for Damaged and real failures.
- Every automatic fix leaves one history line in the details note slot (panel.ts:594-595).
- The panel's existing plain verbs are kept.

States:
- Checking (phase 'checking').
  - Shown only after 400 ms, so a quick resume does not flicker. The bar stays dimmed at its old percentage.
  - Caption: "Checking the saved part and the link".
- Renewing link (phase 'renewing').
  - Caption: "The link stopped working (403). Looking for a new one".
  - Pause cancels the attempt and keeps the bytes.
- Link expired (paused + need 'address').
  - Link glyph (icons.ts:39), normal colour.
  - Primary: Refresh address.
  - Caption: "The link stopped working (403) · 62% is saved · next try 14:05".
  - Details: Refresh address · Use another address… · Open page · Show in folder · Cancel (danger style).
- Waiting for link (paused + need 'address' + catcher).
  - Sub-line: "Start it again on tideline.fm".
  - Primary: Open page.
  - Details: Open page · Stop waiting · Use another address… · Cancel.
- File changed (paused + need 'choice').
  - Caption: "The file on the site is different from the one being downloaded. 62% of the old one is saved."
  - Buttons: Start over with the new file (danger outline, css.ts:125) · Keep partial file · Show in folder.
  - Explanation line: "Keep partial saves the first 41 MB as song (partial).mp3" (for streams: "Keeps 2:41 of 4:05").
  - Primary and Space: "Choose…", which only moves focus to the first choice.
- Waiting for network (paused + wait 'network').
  - Speed and time show "—".
  - Caption: "Continues when the connection is back".
  - Primary: Try now.
- Retrying (paused + wait 'server').
  - "Retrying · in 40 s".
  - Caption: "The site had a problem (503). Trying again at 13:04".
  - Primary: Try now.
- Repairing (phase 'repairing').
  - Caption: "Fetching 3 damaged parts again (6 MB)".
- Damaged (completed + need 'repair').
  - Error colour. The 8-block bar shows the damaged stretches as empty (fileFills, ranged.ts:499-514).
  - Actions: Repair · Open anyway · Show in folder · Remove from list. Space means Repair.
- Changed after download (completed, modified after finishing).
  - Normal colour.
  - Caption: "This file was changed on 14 Oct, 09:12".
  - Action: Restore original. Space only focuses it.
- Start it again from its page (need 'page'), for browser-mode rows: Open page.
- Completed rows gain Check file (access key H).

Around the rows:
- The toolbar summary gains "N need attention" (panel.ts:434-452).
- The ring shows an 8 px dot for rows that start needing the person during this session. Its aria-label becomes "Downloads, 1 needs attention". Rows that already needed attention at startup do not raise it.
- "From page" becomes a button (panel.ts:604).
- The "Resumable" caption (panel.ts:584-589) shows only when the proof can run.
- The pill gains a note (video.ts:735-766) and a "Continue" face.

Accessibility:
- Row aria-label: "song.mp3, Link expired, 62 percent saved" (panel.ts:537).
- A polite live region announces only changes that need the person, plus the result of an attach or a repair.
- Choice buttons are described by their caption (aria-describedby).
- The address field is labelled "New address for song.mp3".
- Every menu item has an access key unique within its menu.
- Motion is unchanged (ring.ts:124-127).

Wiring:
- panel.ts: statusOf, primaryOf, rowState, detailActions and rowMenu (panel.ts:709-729, 781-816).
- Quick view: ring.ts:331-340, 370-379.
- store.ts: Command (store.ts:11), primary() (store.ts:138-144) and run() (store.ts:118-131) gain refresh-address, stop-waiting, use-address, open-page, start-over, keep-partial, check and repair.
- isActive (format.ts:98) also counts waiting rows, so the ring stays shown. runningCount (VitreDownloads.sys.ts:375-377) does not, so waits never block quitting.

7. PHASES

Rules for every phase:
- Run the full tests/downloads/all.py before and after (downloader-fix-care).
- Also run the suites at the same time with distinct --name values, to expose races (flaky-test-repro).
- Test from a worktree with runtime, node_modules and reference junctioned, and always pass --app build-x (worktree-test-setup).
- New behaviour runs only after today's path has failed or would destroy data.
- A control test proves that a resume of an unexpired, unchanged download makes the same number of requests as today.

Phase 0. Design boards (the owner's rule: design before code)
- A DownloadStates artboard in design/canvas/project, dark and light: every state above, the Link expired, File changed and Damaged details, the address field, quick view rows, the ring dot, the pill note and the Continue face.
- Check with design/tools/dccheck.py. The owner signs off the wording.

Phase 1. Never lose or mix bytes
- ranged.ts:
  - probe() decides before it changes any state: no forget() and no second probe. This matters because rec.file is transfer.state and is saved at VitreDownloads.sys.ts:754.
  - learn() never resets on resume.
  - A change mid-download stops the download.
  - openPart() truncates only with allowFresh.
  - runSingle writes into ".new".
  - ifRange: a weak ETag falls back to Last-Modified (ranged.ts:126).
  - validatorsDiffer: a missing new ETag compares Last-Modified (ranged.ts:210).
  - md5 goes through nsICryptoHash (ranged.ts:481).
  - The first probe records contentType and dispositionName.
- net.ts: the three error classes, Response.head and classify.
- hls.ts: the NotTheFile guard in fetchBytes; the count change at hls.ts:158 now asks.
- VitreDownloads.sys.ts:
  - stopped() sets need 'address' or 'choice';
  - the browser-to-file switch is guarded (VitreDownloads.sys.ts:1091-1094);
  - store version 2 with .bak and flushed state saves.
- Minimal UI: Link expired (Retry, Copy address) and File changed (Start over).
- server.py routes:
  - /expire/<f>?after=N&how=403|410|html200|302html|403xml
  - /swap/<f>?val=etag|lm|weak|none (same size, other bytes after a flag)
  - /md5/<f>?good=0|1
- New tests/downloads/integrity.js:
  - after a swap during a pause, the row is File changed, the .part's sha256 is unchanged, and no range request follows the probe (server log);
  - html200 and 302html are never completed, and the .part stays intact;
  - 403xml and 410 give Link expired with the data kept;
  - a weak ETag plus a Last-Modified change, and a dropped ETag plus a new Last-Modified, are both caught;
  - a good md5 completes and a bad one fails with the checksum sentence;
  - an HLS segment answered with html200 is never written;
  - a corrupt store loads from the .bak.
- Existing checks still pass: engine.js:84-86 and restart.js:75-76.

Phase 2. Same-file proof, automatic renewal from the original address, "Use another address"
- New files: proof.ts (judge, with local windows through partfile readAt()), expiry.ts, renew.ts (the in-run hook, the original-address step, and the attempt schedule).
- wait and need with their timers; redirect-hop capture; setAddress and its field.
- The resume probe asks bytes=0-65535.
- View fields; "Renewing link" and "next try".
- server.py routes:
  - /sign/<f>, a 302 to /signed/<tok>/<f> that is valid for T seconds or N requests;
  - /signed-once/<f>, where the original address expires too;
  - /edge/<f>, a new ETag on every request over the same bytes.
- New tests/downloads/expiry.js:
  - a pause past expiry, then Resume: continues from its segments, only the missing ranges are fetched, sha256 matches;
  - expiry during a run with 8 connections: exactly one request to the original address;
  - /edge completes with no restart;
  - /swap with no validators and the same size gives File changed, with no mixed bytes;
  - /signed-once gives Link expired; a fresh signed URL pasted into Use another address attaches; a wrong URL gives "different file";
  - the attempt schedule survives a restart;
  - a version 2 store read by version 1 rules gives paused (a JSON assert);
  - the control test above.

Phase 3. Refresh address, attach, Keep partial
- Engine: arm, refreshAddress, stopWaiting, preMatch and attach in adopt() and start(); the held 'added' event; the 'attached' event; decide().
- Window: wiring in panel.ts, ring.ts, store.ts and video.ts; the pill note; From page as a button; the ring dot.
- New tests/downloads/attach.js, with takeover.js extended:
  - click, pause, expiry, Refresh address, then a click on the page: one row, Firefox's copy gone from the scratch folder, no " (1)" file, only the missing ranges fetched, no new-row flight;
  - Alt+click and Add link attach;
  - an unrelated download makes a new row while the old one keeps waiting;
  - the same name with different bytes gives File changed and no new row;
  - another container never attaches;
  - private records are never written;
  - Keep partial equals the old prefix;
  - Start over keeps .old.part until the new file is done.
- ui.js: wording, aria labels, Space never destroys, access keys unique.

Phase 4. Network, sleep, restarts
- The observers; waits with their schedules; resumeOnStart and its Setting; the clean-session flag and suspect tail refetch (8 MiB); the activeMs cap; the persisted merging phase.
- New tests/downloads/network.js:
  - /drop?for=60: Waiting for network, then the download completes with its segments intact;
  - Services.io.offline switched off and on;
  - 503 for 90 s: no Failed;
  - sleep and wake through Services.obs.notifyObservers;
  - after a restart, rows the quit stopped continue and rows the person paused stay paused (update v-restore.js:55-56);
  - a hard kill: the suspect tail is fetched again;
  - a test hook between the merge and the save: completes without downloading again.

Phase 5. Block hash record, crash recovery, Check and Repair
- Spikes first:
  - FlushFileBuffers through an IOUtils flush or js-ctypes, measured with Process Monitor;
  - whether subtle.digest runs off the main thread.
- Then: ledger.ts; block-aligned plan() and claim(); seals; the unclean-session rules; spot checks; local repair; digest mismatch limited to the bad blocks; the completion check; finished-file records; Check file, Repair, Restore original and Changed after download; the ffmpeg check; proof windows taken from the record.
- server.py route: /corrupt-once/<f>, one block wrong once, with Repr-Digest.
- New tests/downloads/repair.js, with faults.js and restart.js extended:
  - bytes flipped in block k during a pause: only block k is fetched again;
  - the dirty flag plus 3 MiB of zeros under the claims: caught and fetched again;
  - /corrupt-once: only that block is fetched again;
  - a flipped byte in a finished file: Check finds 1 block, Repair fetches 1 range, sha256 equals the fixture;
  - the server changed: Repair refuses;
  - a file edited after finishing: "Changed after download";
  - perf.js within 10% of its baseline.

Phase 6. Streams (can run in parallel once phase 2 is done)
- Segment table, sniff, nextSeq mapping, streamProof, master re-pick, DASH attributes, If-Range on one-file pieces (hls.ts:223, 549), key refresh, cutting to the last good segment, ffmpeg diagnostics and duration check, stream Keep partial, streamKey with the pill's Continue and renewWith, and skipping prepare() when every segment is done.
- server.py routes: /vod-sign/ (a stable master with expiring variant and segment tokens), /vod-reenc/ (same count, different bytes), /dash-rename/ (new representation ids), /vod-html/ (one segment answers html200).
- Tests in streams.js and a new stream-expiry.js:
  - a variant token expires during a pause: the master is read again and the download continues at nextSeq with nothing fetched twice;
  - /vod-reenc gives File changed;
  - /dash-rename continues;
  - an HTML segment is never written;
  - a damaged middle segment: only that segment is fetched again;
  - Continue on the pill of a re-opened page works;
  - the existing /token test still passes.

Phase 7. Background page resolver
- Spike first, on 5-10 real sites: does a hidden, muted, kept-active tab fetch its media without playing? Does the load add a history (Places) visit, and can that be avoided?
- Engine: setResolver(win, fn), on the setQuitPrompt pattern (VitreDownloads.sys.ts:1449-1452); the claim registry at the top of adopt(); the limits; the Setting.
- Window: a new resolver.ts that calls openHidden with a content principal and userContextId, setMuted (peek/gecko.ts:191) and keepActive (peek/gecko.ts:24), then removeQuietly (peek/gecko.ts:49) and forgetClosedMarked (peek/gecko.ts:65).
- A read-only 'downloads:links' page query (src/actors/page/downloads.ts:334).
- server.py routes: /page/<id>.html (a fresh signed link on every load; variants that start the download by themselves, need a click, or show a login form), plus a cookie route scoped to one container.
- New tests/downloads/resolve.js:
  - renewed within 30 s, with b.tabs unchanged, no flight, the hidden tab gone and the closed-tab list unchanged;
  - the container's cookie reaches the server;
  - a page that needs a click falls back within 45 s and is never clicked;
  - a page that starts the download by itself is claimed, with no row;
  - a login page gives "may need you to sign in";
  - the 7th expiry on one site within an hour waits;
  - private downloads resolve only while a private window is open, and nothing is written.

Phase 8. yt-dlp
- Re-pick by height, ext and audioOnly when the format is gone; compare filesize; remove the old format's parts after success; optional formatsOf for page media files.
- Tests: fake_ytdlp.py drops a format id and it is re-picked; an argument assert that no cookies are passed; ytdlp-real.js checks the part naming, which is inferred today from ytdlpParts (ytdlp.ts:283).

8. RISKS AND LIMITS

Can never work:
- One-time links and POST-only downloads (form submissions). Deer never re-sends a POST. These rows are manual only and start from zero.
- DRM (refused at media.ts:294-297 and hls.ts:154) and live streams (hls.ts:155, 199).
- Pages behind a login, a countdown, a button or a CAPTCHA. The automatic page step cannot pass them and must not try; they fall back to the manual path.
- Downloads with no source page (Add link, a blank tab: net.ts:120). They renew only through the original redirect or a pasted address.
- Private downloads after their session ends (VitreDownloads.sys.ts:1420, 1535-1541).
- Signed URLs tied to an IP address or User-Agent from yt-dlp. They may refuse Necko.
- Continuing on a server that refuses ranges. Only a safe restart is possible there.

Limits and risks:
- The proof is probabilistic when there is no digest. A same-size edit outside every window is missed.
- Watermarked or personalised files (per-user tags, stamped PDFs) never prove SAME, so Deer asks every time. That is honest but can be annoying.
- Over plain HTTP, corruption that happens before hashing becomes the reference.
- fsync from JS is unproven. FlushFileBuffers can take hundreds of ms on a hard disk or USB stick, so the seal interval must be adjustable. A power loss can only be simulated, with zero-filled blocks plus the dirty flag.
- Hashing reads every block back, mostly from the OS cache. If subtle.digest runs on the main thread, it costs CPU there. perf.js and the way segments split must be re-measured after block alignment.
- The window checks add 1-3 small requests on a new address. Hosts that limit requests per link may refuse. Combining the probe with window 0 keeps an ordinary resume at today's request count.
- Background pages:
  - autoplay in hidden tabs is not verified;
  - the load probably adds a history (Places) visit and runs the site's analytics;
  - repeated visits can trigger rate limits or CAPTCHAs that then hit the person's own browsing;
  - pageUrl is sometimes a search page or webmail, where nothing is found and the step times out.
- False attach: album tracks or episodes of the same size from the same host. The byte proof is required whenever bytes exist. A candidate on a server without ranges needs an equal strong ETag or digest.
- Downgrade: an older Deer build would treat a File changed row as paused, and its Resume still has the destructive code.
- Phases 1, 5 and 6 change the busiest code (pull, stream, runTrack). Races are likely, so the suites must also run at the same time.
- adopt() gets slower only when some record is waiting for an address in the same container.
- Keep partial on a segmented download keeps only the unbroken beginning, which may be much less than the percentage shown. An MP4 whose index sits at the end may not play.

9. DECISIONS FOR THE OWNER

1. When does a changed file ask instead of restarting?
   - Recommendation: ask whenever more than 1 MiB of verified bytes exists. Below that, restart silently, at most twice in 10 minutes.
2. Start over: what happens to the old partial?
   - Recommendation: keep it as "<name>.old.part" until the new file completes. Delete it at once only when disk space is short.
   - Alternative: always delete at once.
3. What does Keep partial file save?
   - Recommendation: the unbroken beginning, as "<stem> (partial).<ext>", with the caption saying exactly how much. Streams save the written segments, merged.
   - Alternative: the whole .part with zero-filled gaps.
4. Which rows may a click on the page or a pasted address attach to?
   - Recommendation: rows that need an address, and rows armed by Refresh address. Always silent, always with the byte proof.
   - Alternative: any paused row the bytes prove is the same, with "Keep separate" in the note.
5. Continue unfinished downloads when Deer starts?
   - Recommendation: on by default, 10 s after the first window, only for downloads a quit or a crash stopped. Rows the person paused stay paused. Waiting rows always continue.
   - This changes tests/downloads-verify/v-restore.js:55-56.
6. Re-open the source page in the background automatically?
   - Recommendation: on by default, with a Settings switch, the visible status "Renewing link", one hidden page at a time, at most 6 per site per hour, at most once per download per 30 minutes, 30 s to load plus 10 s to collect, and private downloads only while a private window is open.
   - Alternative: only after the person presses Resume, Retry or Refresh address.
7. Keep background page visits out of history?
   - Recommendation: yes, if the phase 7 spike finds a reliable way. Otherwise say so in the setting's description.
8. When does Deer give up?
   - Recommendation: never automatically while offline.
   - Server errors: after 24 h.
   - Expired links: automatic attempts at 0, 2 min, 15 min, 1 h and 6 h, then only on wake, network link-up or a manual action. The row shows Link expired from the first failure.
9. Where do the hash records live?
   - Recommendation: in the profile, at <profile>/vitre-downloads/<id>.jsonl, never next to the person's files.
10. Block size, hash and seal frequency.
    - Recommendation: block size clamp(pow2ceil(total / 2048), 1 MiB, 64 MiB); SHA-256 cut to 128 bits plus a 64 KiB head hash; a seal every 30 s or 256 MiB and at pause, quit, sleep, a disk error and the final rename.
11. When are finished files checked?
    - Recommendation: automatically at completion and after an unclean exit; otherwise only on Check file. No periodic scans.
    - A file edited after finishing shows "Changed after download" with Restore original, never Damaged, and Space never restores it.
12. Wording.
    - Recommendation: approve the labels Checking, Renewing link, Link expired, Waiting for link, File changed, Waiting for network, Retrying, Repairing, Damaged and Changed after download.
    - And the buttons Refresh address, Use another address…, Open page, Stop waiting, Start over with the new file, Keep partial file, Check file, Repair and Restore original.
13. A dot on the downloads ring instead of any dialog?
    - Recommendation: yes. It is only for rows that start needing the person during the session.
14. Cookies for yt-dlp?
    - Recommendation: keep none (ytdlp.ts:19). Videos that need sign-in then renew only through the pill on the page.