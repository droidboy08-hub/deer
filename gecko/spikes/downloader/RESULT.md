# Spike result: downloader

Verdict: works-with-compromises

## Summary
Vitre's download engine runs on the stock Firefox 157 runtime as system modules with no window and no Node; every capability asked for was proven by a run except the items listed under risks. A 256 MiB file downloaded on 1 to 32 connections had a correct sha256 every time (8 MB/s on one throttled connection, 204.5 MB/s on 32), with main-thread stalls of 2-14 ms.

FINDINGS.md was not written: the Write tool refused it as a report file for subagents. Its full content is in this output (recipe, claims, compromises, risks); the scripts, logs and captures are in the spike folder.

Module layout, Electron file (app\src\main\modules\downloads\) -> Gecko file (gecko\spikes\downloader\engine\):
- net.ts -> VitreNet.sys.mjs (Necko channel + nsIStreamListener, redirect sink, same error classes and retry rules)
- identity.ts -> Identity class in VitreNet.sys.mjs (origin attributes pick the cookie jar; only referrer policy stays ours)
- ranged.ts -> VitreRanged.sys.mjs (same FileState, plan, work stealing, validators; adds snapshot() for crash-safe persistence)
- Node fs positional writes -> VitrePartFile.sys.mjs (new: file stream + pipe + async copier per connection)
- limiter.ts -> VitreLimiter.sys.mjs (unchanged logic; the wait suspends the channel)
- naming.ts -> VitreNaming.sys.mjs (unchanged apart from Buffer and fs calls)
- playlist.ts -> VitrePlaylist.sys.mjs (types stripped mechanically)
- hls.ts -> VitreHls.sys.mjs (reduced port; AES via crypto.subtle)
- ffmpeg.ts -> VitreFfmpeg.sys.mjs (Subprocess.sys.mjs, adds progress)
- media.ts -> VitreMedia.sys.mjs + actors\VitreMediaParent.sys.mjs + actors\VitreMediaChild.sys.mjs
- manager.ts -> VitreDownloads.sys.mjs (queue, persistence, lifecycle; trimmed)
- adoptBrowser / will-download -> VitreTakeover.sys.mjs (Downloads list view)
- store.ts -> IOUtils.writeJSON with tmpPath inside VitreDownloads.sys.mjs
- index.ts ipc channels -> chrome windows import VitreDownloads / VitreMedia directly and subscribe()

Run any variant with: cd gecko; python spikes/downloader/go.py <ranged|engine|restart|takeover|media|hls|lifecycle|h2> [--port N] [--phase X] [--keep-profile] [--url U]. go.py makes the fixtures in %TEMP%\vitre-dl-spike, starts the test server, runs tools/run.py and stops the server. Restart needs phases 1, 2, 3 (2 and 3 with --keep-profile); lifecycle needs --phase refuse or background; takeover needs --url http://127.0.0.1:<port>/page.html?rate=1024.

## Claims
- [proven] Engine lives in system modules outside any window (ChromeUtils.importESModule from a resource:// URL)
  evidence: Every test is an engine/Test*.sys.mjs module; boot scripts only import them. out/lifecycle/log-phasebackground.txt shows the module downloading for 14 s with 0 browser windows open.
- [proven] Ranged multi-connection download of a 256 MiB file, checksum verified, throughput vs single connection
  evidence: boot-ranged.js + engine/TestRanged.sys.mjs; out/ranged/log.txt SUMMARY: 1 conn 32.0 s (8 MB/s), 16 conn 2.1 s (121.9 MB/s), 32 conn 1.25 s (204.5 MB/s), sha OK on all 8 runs; capture out/ranged/ranged-8conn.png shows 8 segments filling.
- [proven] Requests with Range headers through Necko channels: streaming, cancellation, progress
  evidence: engine/VitreNet.sys.mjs (NetUtil.newChannel + JS nsIStreamListener); out/engine/log.txt: pause aborts all connections (server active 0), per-chunk byte counts drive the speed limit.
- [proven] fetch() from system scope compared with channels
  evidence: out/engine/log.txt 'system fetch()' line: status 206, streamed 4.2 MB in 258 chunks, abort worked, but the server saw the default-jar cookie instead of the Cookie header given and no Referer; fetch has no option for container or private jar.
- [proven] Cookies of the right container and private state, and the page's Referer, on every ranged request
  evidence: out/engine/log.txt 'identity' step: default jar, userContextId 3 and private jar each pass; the wrong jar gets 403; cross-origin Referer is origin only and Origin is sent.
- [proven] Writing each segment at its file offset without holding the file in memory or blocking the UI thread
  evidence: engine/VitrePartFile.sys.mjs (nsIFileOutputStream + nsISeekableStream + nsIPipe + NetUtil.asyncCopy, writeFrom in onDataAvailable); out/ranged/log.txt ui-lag column 2-14 ms even at ~2 GB/s unthrottled.
- [partial] More than 6 parallel connections to one host
  evidence: out/ranged/log.txt: with default prefs the engine peaks at 6 (Necko per-host limit); after setting network.http.max-persistent-connections-per-server=32 the server saw 16 and 32 concurrent. Needs a global pref change while downloading.
- [partial] Forcing HTTP/1.1 so each connection is its own TCP stream on HTTP/2 servers
  evidence: boot-h2.js; out/h2/log.txt: allowSpdy=false gave http/1.1 on 3 or 4 of every 4 concurrent requests to mozilla.org, wikipedia.org, example.com; one request per batch was still h2 on mozilla.org and example.com.
- [proven] Pause and resume in session from the segment map
  evidence: out/engine/log.txt 'pauseResume': paused at 102.4 MB, resume fetched exactly 153.6 MB, 9/9 requests carried If-Range, sha OK.
- [proven] Resume after restart from a persisted segment map (after a hard kill and after a normal quit)
  evidence: boot-restart.js phases 1-3; out/restart/log-phase1.txt (taskkill mid-download), log-phase2.txt (store 'paused 202113024/268435456' 255 ms after quit), log-phase3.txt (fetched remaining 24.7%, PASS sha256 matches).
- [proven] Retry after a dropped connection
  evidence: out/engine/log.txt 'retry': 3 responses cut by the server, 3 retries after NS_ERROR_NET_PARTIAL_TRANSFER, bytes fetched equal file size, sha OK.
- [proven] Speed limiting (token bucket)
  evidence: out/engine/log.txt 'speedLimitLong': 256 MB at a 16384 kB/s limit took 15.75 s (1.6% off). Short transfer: 24 MB at 4096 kB/s took 5.26 s (about 14% fast because of the half-second burst).
- [proven] Servers without Range support
  evidence: out/engine/log.txt 'noRange': probe status 200, one request reached the server, one segment, sha OK.
- [proven] Servers that refuse extra connections (503)
  evidence: out/engine/log.txt 'refused': 5 refusals, server peak 2, file completed, sha OK.
- [proven] Redirects keep Range
  evidence: First run showed Necko dropping Range and Accept-Encoding after a 302; after adding the nsIChannelEventSink in VitreNet.sys.mjs, out/engine/log.txt 'redirect': 9 ranged requests after the 302, sha OK.
- [proven] Taking over a Firefox download started by a real click on a link (Content-Disposition), with URL, referrer, cookies and suggested filename
  evidence: boot-takeover.js + engine/VitreTakeover.sys.mjs; out/takeover/log.txt: trusted click, Firefox download cancelled and removed, 8 ranged requests with the page cookie and Referer, saved as 'Quarterly report (final).dat', sha256 ok; capture out/takeover/takeover-1-downloading.png.
- [proven] Take-over of <a download>, Save Link As (saveURL), and leaving data: downloads to Firefox
  evidence: out/takeover/log.txt PASS lines 6-8.
- [proven] Mark of the Web on finished files
  evidence: out/takeover/log.txt: Zone.Identifier read back as '[ZoneTransfer] | ZoneId=3 | HostUrl=...' after mozIDownloadPlatform.maybeWriteDownloadOriginInformation.
- [proven] Ask where to save (nsIFilePicker) and the default folder
  evidence: out/takeover/takeover-3-save-dialog.png shows the native Save dialog on the chosen folder; it returned the expected path. Log shows default folder %USERPROFILE%\Downloads, then the custom one after browser.download.folderList=2 / browser.download.dir.
- [unverified] nsIHelperAppLauncherDialog / nsITransfer component override as the interception point
  evidence: Not tried; the Downloads list view covered every case tested. Types Firefox opens instead of saving (PDF inline, always-ask handlers) were not run.
- [unverified] Take-over from a real private window, and of extension downloads.download()
  evidence: Only the channel-level private cookie jar was run (out/engine/log.txt). No private-window or extension-initiated download was tested.
- [proven] Media detection per tab (video, audio, HLS, DASH) mapped back to the gBrowser tab
  evidence: boot-media.js + engine/VitreMedia.sys.mjs; out/media/log.txt: video seen with size 2471986 from Content-Range, HLS and DASH seen, .ts segment skipped, iframe request attributed with frame address, browserId 11 -> tab 'Media test page'; capture out/media/media-1-tab-a.png.
- [proven] DRM (EME) detection per tab so protected media is excluded
  evidence: out/media/log.txt: 'drm':[['org.w3.clearkey','cdm-created']] reported by both VitreMediaChild and the EncryptedMediaParent tap; other tab not protected; capture out/media/media-2-tab-b-drm.png. Manifest-level DRM (Widevine HLS key, DASH ContentProtection) also PASS.
- [not-possible] JSWindowActor child loaded from the spike folder
  evidence: out/media/log.txt: content process at sandbox level 9 fails with 'Failed to load resource://vitre-boot/...'. Works when the child module is in <profile>\chrome (used by the test) and needs safeForUntrustedWebProcess: true.
- [proven] Running ffmpeg with Subprocess.sys.mjs and reading progress from stderr
  evidence: boot-hls.js + engine/VitreFfmpeg.sys.mjs; out/hls/log.txt: cmd.exe exit code 7 with stdout/stderr, ffmpeg -version, 3 progress reports during an encode, abort kills within 0.8 s, failing run reports exit code and stderr. Used the ffmpeg.exe already on this machine.
- [proven] HLS: parse playlist, fetch segments concurrently into one file, resume, ffmpeg repackaging
  evidence: out/hls/log.txt: 11 of 12 segments fetched after a pause (1 already on disk), server peak concurrency 6, output MP4 24.03 s h264 640x360 + aac; capture out/hls/hls-1-downloading.png.
- [proven] HLS AES-128 decryption and DRM refusal
  evidence: out/hls/log.txt: 6170 TS packets all start with the sync byte, key fetched once; DRM master refused with 'This video is protected and can't be saved.'
- [unverified] HLS fMP4 init segments, separate audio rendition merge, segment racing and spill-to-disk
  evidence: fMP4 and audio-merge code paths exist in engine/VitreHls.sys.mjs but had no fixture; racing, spill, disguised segments and playlist refresh were not ported.
- [proven] JSON store in the profile (IOUtils.writeJSON with tmpPath)
  evidence: out/lifecycle/log-phaserefuse.txt: store has 8 segments and the ETag while downloading, no temp file left behind.
- [proven] Refusing quit with a prompt while downloads run
  evidence: out/lifecycle/log-phaserefuse.txt: last-window close and goQuitApplication both refused via quit-application-requested; capture out/lifecycle/lifecycle-quit-prompt.png shows the Quit / Keep Downloading prompt.
- [proven] Continuing downloads when the last window closes
  evidence: out/lifecycle/log-phasebackground.txt: window destroyed at +22 ms, download finished at about +14 s with 0 windows, sha256 ok, process then exited and wrote the store.
- [proven] Taskbar progress (nsITaskbarProgress)
  evidence: out/lifecycle/lifecycle-taskbar-normal-crop.png and lifecycle-taskbar-paused-crop.png show the progress bar under the runtime's taskbar button in normal and paused colours.
- [unverified] Disk-full and write-error handling, HTTP auth, proxies, cross-site cookie partitioning
  evidence: DiskError path exists in VitrePartFile.sys.mjs but was never triggered; no auth, proxy or cross-site partitioned-cookie run was made.

## Recipe
All paths are under gecko\spikes\downloader\.

MODULES. Register a resource:// substitution for the engine folder; load with ChromeUtils.importESModule. The manager is a module singleton (engine/VitreDownloads.sys.mjs); chrome windows import it and subscribe(). System modules have no setTimeout/setInterval: import from resource://gre/modules/Timer.sys.mjs. AbortController, fetch, crypto.subtle, TextDecoder, URL, atob are available.

REQUEST (engine/VitreNet.sys.mjs).
- Clicked link: NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true, contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD }).
- Media a page's player fetched: loadingPrincipal = content principal of the page with its origin attributes, triggeringPrincipal = system, securityFlags SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL.
- Container: channel.loadInfo.originAttributes = { ...channel.loadInfo.originAttributes, userContextId }. Private: channel.QueryInterface(Ci.nsIPrivateBrowsingChannel).setPrivate(true).
- loadFlags |= LOAD_BYPASS_CACHE | INHIBIT_CACHING | LOAD_BYPASS_SERVICE_WORKER. nsIHttpChannelInternal: channelIsForDownload = true, forceAllowThirdPartyCookie = true, allowSpdy = false, allowHttp3 = false.
- Headers: setRequestHeader("Range" / "If-Range" / "Accept-Encoding": "identity", v, false); in onStartRequest set nsIEncodedChannel.applyConversion = false.
- Cookies, User-Agent, Accept-Language, proxy, certificates are Necko's own.
- Listener: suspend the request in onStartRequest and resolve the head; caller then streams (resume) or destroys. Cancel with request.cancel(Cr.NS_BINDING_ABORTED). Own 30 s idle timer.

WRITE (engine/VitrePartFile.sys.mjs). nsIFileOutputStream.init(file, 0x02 | 0x08, 0o644, 0); QueryInterface(Ci.nsISeekableStream).seek(NS_SEEK_SET, offset); pre-size with seek + setEOF(). nsIPipe.init(true, true, 256 * 1024, 0xffffffff); NetUtil.asyncCopy(pipe.inputStream, fileStream, cb). Per chunk: pipe.outputStream.writeFrom(stream, n). Back-pressure: suspend the channel while pipe.inputStream.available() > 8 MB. Flush: close the pipe output and await the copier. Persist received minus the pipe backlog (FileTransfer.snapshot() in engine/VitreRanged.sys.mjs). IOUtils has no positional write.

PER-HOST CONNECTIONS. Raise network.http.max-persistent-connections-per-server (default 6) while downloads run, clear it when idle (#hostLimit() in engine/VitreDownloads.sys.mjs); it applies live.

TAKE-OVER (engine/VitreTakeover.sys.mjs). Prefs: browser.download.useDownloadDir=true, browser.download.always_ask_before_handling_new_types=false, browser.download.alwaysOpenPanel=false, browser.download.start_downloads_in_tmp_dir=true. (await Downloads.getList(Downloads.ALL)).addView({ onDownloadAdded }); ignore the replay of old downloads before addView resolves. Read download.source.{url, referrerInfo.originalReferrer, isPrivate, userContextId, browsingContextId}, download.target.path, download.contentType. BrowsingContext.get(id).top.embedderElement is the <browser>. Then download.cancel(), removePartialData(), finalize(true), list.remove(download). Leave non-http(s) to Firefox. Finish with mozIDownloadPlatform.maybeWriteDownloadOriginInformation(file, uri, referrerInfo, isPrivate). Default folder: Downloads.getPreferredDownloadsDirectory(); prefs browser.download.folderList (0 desktop, 1 Downloads, 2 custom) and browser.download.dir. Ask where: nsIFilePicker.init(window.browsingContext, title, modeSave), defaultString, displayDirectory, open(cb).

MEDIA (engine/VitreMedia.sys.mjs). Observers on http-on-examine-response, http-on-examine-cached-response, http-on-examine-merged-response. Tab key: channel.loadInfo.browsingContext.top.browserId. Type: loadInfo.externalContentPolicyType (TYPE_MEDIA, TYPE_XMLHTTPREQUEST, TYPE_FETCH...). A TYPE_DOCUMENT response for the tab clears it. Back to the tab: BrowsingContext.getCurrentTopByBrowserId(id).embedderElement then getTabBrowser().getTabForBrowser().

DRM. (a) Wrap EncryptedMediaParent.prototype.receiveMessage from resource:///actors/EncryptedMediaParent.sys.mjs; needs no content code. (b) Own actor: ChromeUtils.registerWindowActor("VitreMedia", { parent, child: { esModuleURI, observers: ["mediakeys-request"], events: { encrypted: { capture: true } } }, allFrames: true, messageManagerGroups: ["browsers"], safeForUntrustedWebProcess: true }). The child module must be in the application folder or <profile>\chrome.

FFMPEG (engine/VitreFfmpeg.sys.mjs). Subprocess.call({ command: absolutePath, arguments, stderr: "pipe" }); loop await proc.stderr.readString() until empty and drain stdout too; await proc.wait(); proc.kill(). Pass -nostdin -progress pipe:2 -nostats and parse out_time_us=. Bundle at <install dir>\ffmpeg\ffmpeg.exe (Services.dirsvc.get("XREExeF", Ci.nsIFile).parent). Bare names: Subprocess.pathSearch(name).

HLS (engine/VitreHls.sys.mjs). Response.bytes() (NetUtil.readInputStream) per segment; crypto.subtle.importKey("raw", key, { name: "AES-CBC" }) + decrypt; in-order appends through Writer(path, -1).

LIFECYCLE (engine/VitreDownloads.sys.mjs). IOUtils.writeJSON(path, data, { tmpPath }). Observer quit-application-requested (subject nsISupportsPRBool, data "lastwindow" for last-window close): set data = true to refuse. Services.startup.enterLastWindowClosingSurvivalArea() while downloads run; exitLastWindowClosingSurvivalArea() when idle. Observer quit-application-granted: pause everything so the survival area is left and the quit proceeds. AsyncShutdown.profileBeforeChange.addBlocker to write the store last. Taskbar: Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar).getTaskbarProgress(window.docShell).setProgressState(Ci.nsITaskbarProgress.STATE_NORMAL, done, total).

GOTCHAS.
1. Headers set with setRequestHeader are not carried over a redirect (Range vanished, Accept-Encoding reverted). Set channel.notificationCallbacks to an nsIChannelEventSink and re-apply on newChannel in asyncOnChannelRedirect.
2. With a system triggering principal Necko trims a same-origin Referer to the origin. Compute the referrer yourself and set it with policy Ci.nsIReferrerInfo.UNSAFE_URL.
3. A suspended channel never delivers onStopRequest after cancel(): resume it as many times as it was suspended. suspend() can throw NS_ERROR_NOT_AVAILABLE on a body-less answer.
4. The pipe's default segment is 4 kB; pass 256 kB.
5. A window's timers are suspended while it shows a modal prompt; use Timer.sys.mjs. Services.prompt.confirmExBC on the chrome window opens a separate MozillaDialogClass window.
6. While the survival area is held, a granted quit waits for it (seen: exit 3.9 s late, after the download completed).
7. goQuitApplication(event) needs an event object.
8. Window.synthesizeMouseEvent(type, x, y, { button, clickCount }, {}) called on content from a frame script makes a trusted click in 157; windowUtils.sendMouseEvent is not used anywhere in 157's source.
9. A cut response body surfaces as NS_ERROR_NET_PARTIAL_TRANSFER; treat as retryable.

## Compromises
1. Necko allows 6 connections per host. The engine raises network.http.max-persistent-connections-per-server while downloads run and clears it afterwards. That pref is global, so page loads to HTTP/1.1 hosts can also open more connections during a download.
2. HTTP/1.1 forcing (allowSpdy=false) is not absolute: on hosts with HTTPS DNS records one request per batch was still answered over h2. A server that only speaks h2/h3 will multiplex everything on one TCP stream.
3. Content-process code (the JSWindowActor child) cannot load from a dev folder under the level-9 content sandbox. The spike copies it into <profile>\chrome; the shipped app must keep it in the application folder. DRM detection also works with no content code by tapping Firefox's EncryptedMedia parent actor.
4. Firefox's download starts first and is then cancelled, so the server sees one extra plain request before Vitre's ranged ones.
5. Take-over skips what belongs to Firefox's Download object: Safe Browsing reputation checks, parental controls, open-when-done. Mark of the Web is restored by calling Firefox's own service.
6. The HLS module is a reduced port: no racing of slow segments, no spill-to-disk, no disguised-segment unwrapping, no playlist refresh. These are plain JS and port as-is.
7. Referrer policy is applied by Vitre, not Necko, because the system triggering principal makes Necko treat every request as cross-origin.
8. FINDINGS.md could not be written (the Write tool rejects report files from subagents); its content is returned here instead.

## Risks
1. Internet Download Manager is installed on this machine and hijacks the runtime because the process is firefox.exe. Requests for /file.bin and /medium.bin came back as 204 No Content without reaching the test server, and IDM opened its own dialogs; it also draws its 'Download video from this page' bar on the window (visible in out/media/*.png). I closed 8 IDM dialogs that named http://127.0.0.1:47811 and answered No on 2 follow-up 'obsolete Firefox integration' boxes; IDM's unrelated 'New version' dialog was left alone. The test server now uses addresses without file extensions, and server/idm_guard.py closes any IDM dialog about the test server after each run. For Vitre, any user with IDM will have the built-in downloader starved until the executable is no longer named firefox.exe; that fix is not verified.
2. Pre-sizing: setting the length is 0-1 ms, but the first write near the end of a fresh 2 GiB file took 1.5 s on the writer thread (52 ms for 256 MiB) while NTFS zero-fills. The UI is unaffected; on a slow disk a multi-gigabyte download stalls for seconds at the start. Sparse files need js-ctypes; one part file per segment is the alternative.
3. Crash consistency relies on the OS cache. A process kill is safe (proven); after a power cut the store may claim bytes the disk never got, as in the Electron engine.
4. Private Gecko APIs are used: nsIHttpChannelInternal, EncryptedMediaParent, Downloads list internals, mozIDownloadPlatform, the survival area. All were grepped from the 157 source and run, but safeForUntrustedWebProcess and synthesizeMouseEvent show such APIs do change.
5. Not verified: a real private window download, cross-site cookie partitioning for page-loaded media, HTTP auth and proxies, types Firefox opens instead of saving (PDF inline, always-ask handlers), extension-initiated downloads, disk-full handling, fMP4 and separate-audio HLS, throughput against a real h2-only CDN.
6. With keepAliveWithoutWindows on, closing the last window leaves a process with no visible UI until downloads finish. That needs a product decision (tray icon or prompt); both mechanisms are proven.
7. Short downloads run slightly over the speed limit (about 14% on a 5 s transfer) because of the half-second burst; long ones were 1.6% off.
8. The lifecycle test screenshots the whole taskbar before cropping. The full-width images, which show every app open on this desktop, were deleted; only crops of the runtime's own button are kept. Rerunning the refuse phase recreates the full images.
9. Test fixtures and throwaway profiles in %TEMP% were deleted at the end; go.py regenerates fixtures, which needs a local ffmpeg for the media and HLS variants (it used %LOCALAPPDATA%\Programs\Monolist\tools\ffmpeg.exe; nothing was downloaded).

## Files
gecko\spikes\downloader\go.py
gecko\spikes\downloader\overlay.js
gecko\spikes\downloader\boot-ranged.js
gecko\spikes\downloader\boot-engine.js
gecko\spikes\downloader\boot-restart.js
gecko\spikes\downloader\boot-takeover.js
gecko\spikes\downloader\boot-media.js
gecko\spikes\downloader\boot-hls.js
gecko\spikes\downloader\boot-lifecycle.js
gecko\spikes\downloader\boot-h2.js
gecko\spikes\downloader\engine\VitreNet.sys.mjs
gecko\spikes\downloader\engine\VitrePartFile.sys.mjs
gecko\spikes\downloader\engine\VitreRanged.sys.mjs
gecko\spikes\downloader\engine\VitreLimiter.sys.mjs
gecko\spikes\downloader\engine\VitreNaming.sys.mjs
gecko\spikes\downloader\engine\VitrePlaylist.sys.mjs
gecko\spikes\downloader\engine\VitreHls.sys.mjs
gecko\spikes\downloader\engine\VitreFfmpeg.sys.mjs
gecko\spikes\downloader\engine\VitreMedia.sys.mjs
gecko\spikes\downloader\engine\actors\VitreMediaParent.sys.mjs
gecko\spikes\downloader\engine\actors\VitreMediaChild.sys.mjs
gecko\spikes\downloader\engine\VitreDownloads.sys.mjs
gecko\spikes\downloader\engine\VitreTakeover.sys.mjs
gecko\spikes\downloader\engine\VitreLog.sys.mjs
gecko\spikes\downloader\engine\SpikeHarness.sys.mjs
gecko\spikes\downloader\engine\TestRanged.sys.mjs
gecko\spikes\downloader\engine\TestEngine.sys.mjs
gecko\spikes\downloader\engine\TestH2.sys.mjs
gecko\spikes\downloader\engine\TestLifecycle.sys.mjs
gecko\spikes\downloader\server\serve.py
gecko\spikes\downloader\server\make_fixtures.py
gecko\spikes\downloader\server\idm_guard.py
gecko\spikes\downloader\server\dialog_helper.py
gecko\spikes\downloader\server\capture_window.py
gecko\spikes\downloader\server\crop_png.py
gecko\spikes\downloader\out\ranged\log.txt
gecko\spikes\downloader\out\ranged\ranged-8conn.png
gecko\spikes\downloader\out\engine\log.txt
gecko\spikes\downloader\out\restart\log-phase1.txt
gecko\spikes\downloader\out\restart\log-phase2.txt
gecko\spikes\downloader\out\restart\log-phase3.txt
gecko\spikes\downloader\out\restart\restart-2-before-quit.png
gecko\spikes\downloader\out\takeover\log.txt
gecko\spikes\downloader\out\takeover\takeover-1-downloading.png
gecko\spikes\downloader\out\takeover\takeover-3-save-dialog.png
gecko\spikes\downloader\out\media\log.txt
gecko\spikes\downloader\out\media\media-1-tab-a.png
gecko\spikes\downloader\out\media\media-2-tab-b-drm.png
gecko\spikes\downloader\out\hls\log.txt
gecko\spikes\downloader\out\hls\hls-1-downloading.png
gecko\spikes\downloader\out\lifecycle\log-phaserefuse.txt
gecko\spikes\downloader\out\lifecycle\log-phasebackground.txt
gecko\spikes\downloader\out\lifecycle\lifecycle-quit-prompt.png
gecko\spikes\downloader\out\lifecycle\lifecycle-taskbar-normal-crop.png
gecko\spikes\downloader\out\lifecycle\lifecycle-taskbar-paused-crop.png
gecko\spikes\downloader\out\h2\log.txt

# Independent verification

## Overall
The spike holds up: every claim marked proven reproduced under my own profile names, and the engine also works against real servers, which the spike never tried (a TLS/HTTP-2 CDN file matching its published sha256, a real 64-segment HLS stream, a real fMP4 stream with separate audio).

Three things change the architecture advice:

- **Connections per host:** the global pref change and HTTP/1.1 forcing are not needed. One network partition per connection (loadInfo.cookieJarSettings) gave 16 and 32 sockets with the pref untouched and 8 of 8 separate sockets on HTTP/2 hosts, with cookies, containers and private jars unaffected. This upgrades claims 7 and 8 from partial to solved per channel.
- **DRM exclusion has a hole:** any download click from a tab wipes that tab's media list and its protected mark while the DRM page is still showing. The fix (key the record by the top document's inner window id) is run and passes.
- **Take-over is more robust than reported:** container tab, private window, second window, PDF, tiny file, one-time link, POST and blob all behave correctly. Extension downloads are taken over too, but the extension is told its download was cancelled and erased, so those are better left to Firefox.

Smaller corrections: the tmp-dir pref does nothing for the partial file (a scratch download folder does); disk write errors are retried and shown as "The connection was lost."; the "2-14 ms" UI-lag figure leaves out 154-234 ms on the first transfer of each run; the child actor can load from the dev folder through a junction in the profile's chrome folder.

Still unverified: proxies, HTTP auth, a real disk-full, power-loss consistency, a second OS launch while windowless (the harness runs with -no-remote), "always ask" handlers, and the HLS features that were not ported.

VERIFY.md was not written: this session's rules forbid subagents from writing report files, so the notes are in this output. The evidence is in gecko\spikes\downloader\verify\ (vgo.py with the variant index, vboot-*.js, vserve.py, lock_region.py, engine\ as a patched copy of the spike's engine, out\<variant>\log.txt and captures). I removed my temp fixtures and profiles; the scripts regenerate them.

## Confirmed
- Claim 1 (engine in system modules, no window): reproduced. verify/out/lifecycle/log-phasebackground.txt shows the module downloading from +112 ms to +14084 ms with 'browser windows open: 0', sha256 ok.
- Claim 2 (256 MiB ranged download, checksum, throughput): reproduced with identical numbers. verify/out/ranged/log.txt SUMMARY: 1 conn 32005 ms (8 MB/s), 16 conn with pref=32 2099 ms (122 MB/s), 32 conn 1252 ms (204.5 MB/s), sha OK on all 8 runs. The server throttles each connection to 8 MB/s, so the scaling is by construction; unthrottled loopback shows no gain (1 conn 1488 MB/s, 8 conn 1790 MB/s). NEW real-world evidence the spike lacked (it only ever moved data from a local plain-HTTP/1.1 server): verify/out/real/log.txt, a 24.6 MB file from cdn.kernel.org over TLS: 1 conn 3.3 MB/s, spike recipe 8 conn 15.2 MB/s, sha256 equals the one kernel.org publishes.
- Claim 3 (Necko channels: Range, streaming, cancel, progress): reproduced, verify/out/engine/log.txt ('pause aborts every connection ... server active transfers: 0').
- Claim 4 (system fetch() comparison): reproduced, verify/out/engine/log.txt 'system fetch()' line: 206, 257 chunks, abort ok, server saw the jar cookie not the given Cookie header, no Referer.
- Claim 5 (cookies of the right container/private jar and Referer): reproduced, verify/out/engine/log.txt 'identity' and 'crossOriginReferrer' steps all PASS; also holds end to end from real tabs (see claim 21 below).
- Claim 6 (segments written at their offset off the main thread): reproduced for the success path (sha OK at ~1.5-1.8 GB/s unthrottled). Caveats are under refuted (ui-lag figure) and recipeCorrections (disk errors).
- Claims 9, 11, 12, 13, 14, 15 (pause/resume, retry, speed limit, no-Range server, 503 refusals, redirect keeps Range): all reproduced, verify/out/engine/log.txt (resume fetched exactly 153.6 MB with 9/9 If-Range; 3 cuts -> 3 retries; 256 MB at 16384 kB/s took 15.76 s, 1.5% off; 24 MB at 4096 kB/s took 5.25 s; noRange 1 request; 5 refusals, peak 2; 9 ranged requests after the 302).
- Claim 10 (resume after hard kill and after normal quit): reproduced, verify/out/restart/log-phase1.txt (taskkill at ~77 MB), log-phase2.txt (loaded paused 92553216, store 'paused 201605120/268435456' 212 ms after quit), log-phase3.txt (PASS sha256 matches). Holds for a process kill; power loss is not covered (no flush to disk, unverified).
- Claims 16 and 17 (take-over of a clicked attachment link, <a download>, saveURL, data: left to Firefox): reproduced, verify/out/takeover/log.txt and takeover-1-downloading.png (8 connections filling 'Quarterly report (final).dat'). Detail: the saveURL case saved as 'medium', not the 'saved-link.dat' the test passed; the name comes from Firefox's own target.
- Claim 18 (Mark of the Web): reproduced, verify/out/takeover/log.txt '[ZoneTransfer] | ZoneId=3 | HostUrl=...'.
- Claim 19 (nsIFilePicker save dialog, default folder): reproduced, verify/out/takeover/takeover-3-save-dialog.png shows the native dialog on the chosen folder with 'asked-name.dat'; returned path matches.
- Claim 22 (media detection per tab) for the cases the spike ran: reproduced, verify/out/media/log.txt and media-1-tab-a.png. The one FAIL in that log is the spike's hard-coded clip size (2471986) against a regenerated fixture (2471577), not an engine fault. Also holds on real pages (verify/out/media2/log.txt: hls.js demo -> 3 playlists; MDN <video> page -> flower.webm and an archive.org mp4 inside cross-origin iframes) and for a background tab in a second window. See refuted for the defect.
- Claim 23 (EME detection) for the case the spike ran (ClearKey): reproduced, verify/out/media/log.txt. Also fires for a Widevine request when no CDM is installed (status 'cdm-not-installed', verify/out/media2/log.txt, media2-1-widevine.png). See refuted for the defect.
- Claim 25 (Subprocess + ffmpeg progress, abort, exit code): reproduced, verify/out/hls/log.txt.
- Claims 26 and 27 (HLS download/resume/ffmpeg repackaging, AES-128, DRM refusal): reproduced, verify/out/hls/log.txt. NEW on a real stream: verify/out/hlsreal/log.txt, 64/64 segments of the mux.dev test stream, 634.63 s MP4, h264+aac, 0 decode errors.
- Claims 29, 30, 32 (JSON store, quit refusal with prompt, taskbar progress): reproduced, verify/out/lifecycle/log-phaserefuse.txt, lifecycle-quit-prompt.png (Quit / Keep Downloading), lifecycle-taskbar-normal-crop.png and -paused-crop.png (progress bar under the button, yellow when paused).
- Claim 31 (download continues after the last window closes, process then exits): reproduced, verify/out/lifecycle/log-phasebackground.txt. NEW: a window can be opened again from the windowless state and the app then does not quit when the download ends (verify/out/lifecycle2/log.txt, 3 PASS).

## Refuted
- Claims 22/23 as a guarantee: 'DRM (EME) detection per tab so protected media is excluded' and 'a TYPE_DOCUMENT response for the tab clears it'
  why: Not robust. A top-level request that turns into a download (Content-Disposition: attachment) is a TYPE_DOCUMENT response but the page stays. verify/vboot-media3.js, verify/out/media3/log.txt: 'media items 5 -> 0' with the page still /media.html, and 'protected true -> false' on the EME page while its <video> still has mediaKeys. After any download click the DRM tab is no longer marked protected, so later media would be offered. Fix proven in verify/out/media3-fixed/log.txt (5 PASS): key the tab record by the top WindowGlobal's innerWindowId instead of clearing on a response.
- Recipe: browser.download.start_downloads_in_tmp_dir=true keeps Firefox's partial file out of the user's folder
  why: False. With the pref set by the module (verify/out/takeover2/log.txt) and set at startup (verify/out/takeover2-tmpdir/log.txt) Firefox's placeholder and '.part' are both in the downloads folder ('...downloads-takeover2\\Quarterly report (final).GTVehVTD.dat.part'). In 157's JS the pref is only read for delete-on-exit of launched files (DownloadCore.sys.mjs:669).
- Summary: 'main-thread stalls of 2-14 ms' (claim 6 evidence)
  why: Understated. The same column shows 234 ms and 161 ms in the spike's own logs (out/ranged/log.txt throttled-1conn, out/engine/log.txt redirect) and 154 ms and 30 ms in my rerun (verify/out/ranged/log.txt). The large values are always the first transfer after startup, so they are probably startup work rather than the engine, but that was not separated; later transfers were 1-30 ms.
- Claim 2 evidence: 'capture ranged-8conn.png shows 8 segments filling'
  why: The capture (verify/out/ranged/ranged-8conn.png, same script) reads '6 connections' with the last two of 8 segments empty: it is taken under default prefs, where Necko holds the download to 6 sockets. The claim itself stands; the caption is wrong.
- Recipe/compromise 2: allowSpdy=false gives each connection its own TCP stream except 'one request per batch' on hosts with HTTPS DNS records
  why: The mechanism is different from what the recipe implies. connectionInfoHashKey (verify/out/probe2/log.txt) shows allowSpdy=false does not key the connection pool at all (only '[!h3]' from allowHttp3=false appears), so the first connection of every pool entry on mozilla.org, example.com and cloudflare.com negotiates h2 and the request rides it (verify/out/lanes/log.txt: 'h2 http/1.1 ...' in every first-contact batch; all 8 h2 when each request has its own entry). wikipedia.org (no HTTPS record) was all http/1.1. 'Partial' is the right label; the switch is not needed once connections have their own pool entry (see improved).

## Improved
- Claim 7 (more than 6 connections per host) - no global pref needed
  finding: Give each connection its own network partition: create an nsICookieJarSettings, initWithURI(https://vitre-lane-<n>.invalid/, isPrivate), assign to channel.loadInfo.cookieJarSettings before asyncOpen (the same assignment DownloadCore.sys.mjs:2711 makes). The pool key becomes '...host:port^partitionKey=(https,vitre-lane-<n>.invalid)', one entry per connection. verify/out/lanes/log.txt with network.http.max-persistent-connections-per-server left at 6: 16 lanes -> server peak 16, 121.9 MB/s; 32 lanes -> peak 32, 204.8 MB/s (no lanes: peak 6, 47.4 MB/s); sha OK; pref has no user value. Cookies are unaffected: default jar, container 3, private jar, wrong-jar 403 and page-as-loading-principal all PASS. The spike's whole engine suite passes on lanes (verify/out/enginelanes/log.txt). Code: verify/engine/VitreNet.sys.mjs (makeChannel 'lane'), verify/engine/VitreRanged.sys.mjs (worker lane index). Trap I hit first: the partition key is the site, so 'lane-3.vitre.invalid' collapses every lane into one partition (first run: server peak 8). Unverified with proxies, HTTP auth and CHIPS-partitioned cookies.
- Claim 8 (one TCP stream per connection on HTTP/2 servers) - forcing HTTP/1.1 is unnecessary
  finding: With lanes every connection has its own pool entry, so each gets its own socket whatever the protocol. verify/out/lanes/log.txt, 8 concurrent ranged requests to mozilla.org, example.com, cloudflare.com, wikipedia.org: 'lanes, HTTP/2 allowed, HTTP/3 off: h2 x8 | distinct sockets 8/8, pool entries 8' on all four (no lanes: 1/8). Real download, verify/out/real/log.txt: 8 lanes over h2 -> 8 sockets, 14.3 MB/s; 16 lanes -> 16 sockets, 20.1 MB/s; sha256 matches the published one. Recommended switches: lane + allowHttp3=false, leave allowSpdy alone. This also covers servers that only speak h2.
- Claim 24 (child actor from the dev folder: reported not-possible)
  finding: Possible for development with a directory junction: mklink /J <profile>\\chrome\\vitre-dev <dev folder>\\actors, map a resource:// substitution to the junction path. The level-9 content sandbox allows it. verify/out/media2/log.txt step 4: content-process import 'junctionInProfileChrome: loaded' while the direct dev-folder URL still fails; verify/out/media2-junction/log.txt: the JSWindowActor child registered from resource://vitre-dev/ reported EME ('by: VitreMediaChild'). Direct loading stays impossible; the shipped app should still keep the file in the application folder (not run).
- Claim 21 (private window and extension downloads: reported unverified)
  finding: Private window, container tab and second window are now proven with real clicks: verify/vboot-takeover2.js, verify/out/takeover2/log.txt. The cookie existed only in the container-2 jar / only in the private jar and every ranged request carried it; isPrivate true; the private download is not written to the store; Firefox's private list is empty. Extension downloads.download(): verify/out/extdl/log.txt - it reaches the list view and is taken over (file arrives), but the extension is told 'interrupted', 'USER_CANCELED' and 'erased'. The source is recognisable (download.source.loadingPrincipal is moz-extension://...), so leave those to Firefox or accept the broken API contract.
- Claim 20 (what Firefox opens instead of saving; other interception points: reported unverified)
  finding: The Downloads list view was enough for every case run (verify/out/takeover2/log.txt section D): PDF attachment taken over (Firefox had launchWhenSucceeded=true; with the take-over the PDF is saved and not opened), inline PDF creates no download, a 2 kB attachment is taken over (server sees 3 requests: Firefox, probe, Vitre), a one-time link is left to Firefox after the probe gets 403 and finishes intact, a POST download (probe 405) and a blob: download are left to Firefox and saved. nsIHelperAppLauncherDialog was not needed. Still unverified: handlers set to 'always ask', HTTP-auth downloads.
- Take-over: keeping Firefox's placeholder and .part out of the user's folder
  finding: Point Firefox's own folder at a scratch folder (browser.download.folderList=2, browser.download.dir=<scratch>) and keep Vitre's save folder as its own setting. verify/out/takeover2-ffdir/log.txt: Firefox wrote in '...-firefox-scratch' (empty afterwards), the user's folder only ever held the finished file. Downloads left to Firefox then land in the scratch folder and must be moved by Vitre (not run).
- Claim 28 (fMP4 HLS and separate audio: reported unverified)
  finding: Works on a real stream. verify/vboot-hlsfmp4.js, verify/out/hlsfmp4/log.txt: Apple's bipbop fMP4 example (EXT-X-MAP init, EXT-X-BYTERANGE, separate AAC rendition): tracks 100/100 and 101/101 segments, byte counts equal the servers' Content-Length (27672619 and 12132238), merged MP4 600.04 s, h264 480x270 + aac, 0 decode errors. Racing, spill-to-disk, disguised segments and playlist refresh remain unported and unverified.
- Claim 33 (failure paths: reported unverified)
  finding: File changed between pause and resume: proven, verify/out/faults-changed/log.txt (If-Range answered 200, restarted from zero, 24.0 MB refetched, sha OK). Disk write error mid-download (byte-range lock on the .part held by another process, verify/lock_region.py): verify/out/faults/log.txt - no hang, no false completion, no leaked live count, and resuming from the kept state gives an intact file. Two defects: the error arrives as NS_ERROR_FAILURE, is retried like a network error (2 retries per connection over ~8 s) and the row text is 'The connection was lost.'; and all 38 MB the running segments had written were discarded (state keeps 0.0 MB). Real disk-full, HTTP auth and proxies remain unverified.

## Recipe corrections
All paths are under gecko\spikes\downloader\verify\. Run anything with: cd gecko; python spikes/downloader/verify/vgo.py <variant> (variants are listed in vgo.py's docstring).

1. PER-HOST CONNECTIONS. Replace the global pref with a lane per connection (engine/VitreNet.sys.mjs, engine/VitreRanged.sys.mjs):
   const cjs = Cc["@mozilla.org/cookieJarSettings;1"].createInstance(Ci.nsICookieJarSettings);
   cjs.initWithURI(Services.io.newURI(`https://vitre-lane-${n}.invalid/`), isPrivate);
   channel.loadInfo.cookieJarSettings = cjs;   // before asyncOpen
   The lane name must be in the registrable domain; check with nsIHttpChannelInternal.connectionInfoHashKey. If the pref is kept anyway: #hostLimit() ends with clearUserPref, which wipes a value the user or a policy set; and with the pref not raised, asking for more workers than 6 only churns (16 workers: 41-42 TCP connections and 54-56 segments for the same 47 MB/s), so clamp workers to the limit.

2. PROTOCOL. With lanes set allowHttp3=false only. allowSpdy=false does not key the pool and the first connection of an entry on hosts with HTTPS DNS records is h2 anyway.

3. TAKE-OVER PREFS. Drop browser.download.start_downloads_in_tmp_dir (it does not move the .part). Use a scratch folder for browser.download.dir if the user's folder must stay clean.

4. TAKE-OVER SCOPE. The adopt step copies only url, referrer, private flag and container. It drops source.authHeader, source.cookieJarSettings and source.adjustChannel (an extension's method/headers/body); the Range probe is what keeps those safe (403/405/HTML -> left to Firefox), so keep the probe before cancel. Skip sources whose loadingPrincipal is moz-extension:// unless breaking the extension's onChanged is acceptable. Firefox's launchWhenSucceeded (PDF opens after saving) is lost. Firefox names duplicates 'name(1).ext', Vitre 'name (1).ext'.

5. MEDIA. Do not clear a tab's record on a TYPE_DOCUMENT response. Store doc = BrowsingContext.getCurrentTopByBrowserId(id).currentWindowGlobal.innerWindowId with the record and drop the record when it differs on read or write (engine/VitreMedia.sys.mjs, switch VITRE_V_MEDIAFIX). The UI still needs its own location-change signal to redraw, since nothing notifies on navigation with this fix.

6. DISK ERRORS. isRetryable() returns true for DiskError and describeError() goes by code, but the writer's failure arrives as NS_ERROR_FAILURE. Classify by class: DiskError is never retried and always reads as a disk problem. By reading only (not run): in #stream, new Writer() sits after this.live++ and outside the try, so an open failure would leak the live count.

7. 157 API. Node.ownerGlobal no longer exists (undefined on a <browser> and a tab; 3 uses left in the whole tree); use documentGlobal or ownerDocument.defaultView. Logged in out/media2/log.txt.

8. DRM. A Widevine request fires 'EMEVideo:CDMMissing', on which stock Firefox fetches the CDM; I blocked that with media.gmp-manager.updateEnabled=false and an unreachable media.gmp-manager.url. Detection does not need the CDM. An unsupported key system (PlayReady here) produces no notification and no mark. The 'encrypted' event path was never exercised by either of us.

9. TEST ARTIFACTS. ../boot-media.js hard-codes the clip size, so it FAILs one check on regenerated fixtures. The original fixture folder %TEMP%\vitre-dl-spike no longer exists.

10. ENVIRONMENT. Internet Download Manager is installed here and hooks firefox.exe: an attachment named '*.pdf' never reached Firefox's download list (earlier takeover2 run, 20 s timeout, idm-guard closed 1 dialog; that log was overwritten when I renamed the file), and its 'Download video from this page' bar is drawn inside the runtime window (out/media/media-1-tab-a.png). While Vitre's process is called firefox.exe, such tools can pre-empt the take-over.