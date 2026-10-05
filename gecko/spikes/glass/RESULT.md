# Spike result: glass

Verdict: works-with-compromises

## Summary
Liquid glass over live pages is achievable on Gecko 157, but not the way Electron does it. A chrome element in browser.xhtml cannot see the remote page through backdrop-filter at all, and feDisplacementMap does not run in a Gecko backdrop-filter. What works: draw the lens shapes inside the content document as native anonymous content (same WebRender pipeline as the page), and keep tint, rim, shadow, icons and text in the parent chrome layer. Refraction is approximated by a "strip lens" of feOffset strips, which WebRender does run on a backdrop.

Against the Electron look (reference = the real feImage + feDisplacementMap graph applied to a snapshot of the same pixels):
- Tint, 1 px gradient rim, shadow, text, blur and saturation: same CSS, same result.
- Active pill (480x44): at 1x the strip lens is hard to tell from the true lens on stripes, text, lines, grid, gradient and a photo.
- 44 px circles: weaker. The rim bends up/down/left/right instead of radially, so it looks slightly boxy on hard-edged backdrops. It still reads as thick glass.
- The lens drops out between documents on navigation; Electron keeps it.
- Cost has to be rationed: about 0.1 ms per backdrop element and 0.02 ms per feOffset node per composited frame on this fast desktop.

Home: Mica, Mica Alt, Acrylic and a truly see-through window all work once the root background is transparent, but backdrop-filter cannot sample them.

FINDINGS.md was not written: the harness refused the Write call for a report .md file, so the findings are in this output only. All scripts and captures are in the spike folder.

## Claims
- [not-possible] Parent chrome backdrop-filter (blur/saturate/brightness/invert) sampling the remote page
  evidence: boot1-basic.js -> out/boot1/basic-default.png and boot2-diag.js -> out/boot2-diag-default/diag-default.png: tiles over the page show the raw page; the same tiles over chrome-drawn stripes are blurred/inverted. Unchanged with gfx.webrender.layer-compositor=false, gfx.webrender.compositor=false and gfx.webrender.software=true (out/boot2-diag-nolc, -nocomp, -sw).
- [proven] Parent chrome backdrop-filter over a parent-process page (non-remote browser, e.g. about:preferences)
  evidence: boot9-inproc.js -> out/boot9/inproc-preferences.png: invert tile is white over the dark settings page; log shows isRemoteBrowser = false.
- [proven] Content-side lens (document.insertAnonymousContent) with backdrop-filter blur/saturate/brightness/invert sampling the page
  evidence: boot4-content.js -> out/boot4/content-default.png and content-default-scrolled.png: all CSS-function tiles filter the page, pixel-aligned with outlines drawn by the parent layer.
- [proven] Content-side lens stays live during scroll, CSS animation and video playback
  evidence: boot8-live.js -> out/boot8/live-0.png and live-2.png: page auto-scrolls (y=1491 then y=2634), the in-page WebM video (VIDEO 34 then 37) and the stripes show through blur, invert and strip-lens tiles in each capture.
- [proven] Content-side lens on a real site in a sandboxed web content process
  evidence: boot13-web.js -> out/boot13/web-framescript.png and web-framescript-scrolled.png on en.wikipedia.org/wiki/Stained_glass (remoteType webIsolated=https://wikipedia.org); also out/boot7-bar-wiki-clear/bar-clear-strip-image.png.
- [proven] backdrop-filter: url(#svgFilter) with simple primitives (feGaussianBlur, feColorMatrix, feOffset with primitive subregions, feMerge)
  evidence: boot3-url.js -> out/boot3-url-default/url-default.png (parent, over chrome-drawn content) and out/boot4/content-default.png (inside the anonymous shadow root). An external url("data:...svg#f") reference did not render.
- [not-possible] backdrop-filter: url() with feDisplacementMap + feImage (the Electron lens graph)
  evidence: out/boot3-url-default/url-default.png: lens and turbulence tiles show the raw backdrop, while the same graph as a normal `filter` renders (tile FILTER). Forcing prefs: fedisplacementmap alone or feimage alone change nothing (out/boot3-url-disponly, -imgonly); displacement + feturbulence paints the tile solid red (out/boot3-url-dispturb/url-dispturb.png); displacement + feimage blanks the whole window (out/boot3-url-disp/url-disp.png).
- [not-possible] -moz-element() of the remote browser as a pixel source
  evidence: boot9-inproc.js -> out/boot9/inproc-remote-mozelement.png: the element shows only its grey fallback colour.
- [partial] drawSnapshot into a canvas with the true displacement filter
  evidence: boot9-inproc.js log: 0.80 ms mean per call for a 1280x56 strip, about 178 calls/s; out/boot9/inproc-snapshot-loop.png. Pixels are correct but come from main-thread state, so they would trail async scrolling and compositor video; lag itself was not measured. Used to build the reference rows.
- [proven] Strip lens: edge refraction approximated with about 12 feOffset strips, then blur + saturate, as a live backdrop-filter
  evidence: glasslib.js stripLensMarkup; boot7-bar.js rows A vs R in out/boot7-light-strip/zoom-stripes-left.png, zoom-stripes-right.png, zoom-lines.png; boot11-circles.js -> out/boot11-circles-tint/zoom-pills-all.png and out/boot11-circles-raw/zoom-lines.png, zoom-stripes.png. Pills match the true lens closely; circles are four-directional rather than radial.
- [partial] Fine-cell feOffset lens (3-4 px cells, closest to the true lens)
  evidence: boot5-offsetlens.js -> out/boot5-offsetlens-ops512/zoom-pill4.png, zoom-text.png: looks right, but needs gfx.webrender.max-filter-ops-per-chain raised above 64 and costs 15.3 ms (4 px) to 31.6 ms (3 px) of WebRender frame CPU for a 14-shape bar (out/boot6-cells4, out/boot6-cells3, out/boot6-stats-row.png).
- [not-possible] One backdrop element for the whole bar, shaped with clip-path or mask
  evidence: boot10-row.js -> out/boot10-row-ops512/row-ops512.png: every row with clip-path: path() or an SVG mask renders nothing, with CSS filters and with url(); only the unclipped row renders.
- [proven] Active pill, tab circles, plus and window-controls capsule with rim, tint and shadow in light, dark and clear themes over busy and plain pages
  evidence: boot7-bar.js -> out/boot7-light-strip/bar-light-strip-{stripes,text,lines,grid,gradient,white,darkpage}.png, out/boot7-bar-dark-strip/, out/boot7-bar-clear-strip/. Each capture has the Gecko row, a true-lens reference row, a plain-blur row and a no-lens row.
- [proven] Cost of the lens recipes
  evidence: boot6-perf.js, 14 shapes over a page scrolling at 180 Hz, WebRender profiler Frame CPU avg: none 0.6-0.7 ms; plain blur+saturate 2.1 ms; strip on pill+capsule only 2.3 ms; strip on all (168 nodes) 4.9 ms; strip+diagonals (224 nodes) 5.8 ms. Content rAF stayed at 5.56-5.61 ms for all of these. out/boot6-stats-row.png, out/boot6-stats-row2.png, out/boot6-*/log.txt. Other spikes were running, so figures are rough. Idle cost not measured.
- [proven] Page zoom compensation for the content lens
  evidence: boot8-live.js -> out/boot8/live-zoom150.png: with browser.fullZoom = 1.5 and the layer wrapped in a div with CSS zoom 1/1.5, lens shapes line up with the parent outlines.
- [partial] Lens layer stays out of page snapshots (thumbnails, captureVisibleTab)
  evidence: boot8-live.js -> out/boot8/live-snapshot.png: drawSnapshot shows the tile that had its own background tint, but not the blur or invert tiles. So background-free lens elements should be invisible in snapshots; that exact case was not captured separately.
- [partial] JSWindowActor as the content bridge
  evidence: boot14-actor.js -> out/boot14/log.txt: without safeForUntrustedWebProcess: true, getActor throws "doesn't match remote type" for web and file pages. With it, Set succeeds in the file process; in a webIsolated process it times out because the child module sits in the spike folder, outside the app. Not verified with a packaged module.
- [proven] Frame script as the content bridge
  evidence: glasslib.js contentGlass + content-glass.js, used by boot4 to boot13 in file and webIsolated processes. browser.messageManager is replaced on every navigation ("[content] loaded about:blank" lines in out/boot7-light-strip/log.txt), so the bridge listens on window.messageManager.
- [proven] Mica / Mica Alt / Acrylic / transparent window under the chrome layer
  evidence: boot12-mica.js with tools/screencap.py (real screen grabs): out/boot12-off/screen-off-2.png (see-through window), out/boot12-mica/screen-mica-2.png (Mica, (-moz-windows-mica) true), out/boot12-acrylic/screen-acrylic-2.png (blurred desktop), out/boot12-micaalt/screen-micaalt-2.png. PrintWindow captures do not show the backdrop.
- [not-possible] backdrop-filter sampling the Mica/Acrylic/desktop behind the window
  evidence: Same boot12 screen grabs: the blur(12px) and blur(24px) tiles over the transparent area show only their tint; the blur tile over chrome-drawn stripes works.
- [unverified] Pill morph animation kept in step between parent and content
  evidence: Not run. No script animates the lens.
- [unverified] HiDPI, pinch zoom, PDF viewer, error pages, XUL documents
  evidence: Not run. The machine is devicePixelRatio 1; only HTML pages and about:preferences were loaded.

## Recipe
ARCHITECTURE
- Parent chrome layer (HTML in browser.xhtml, position:fixed, z-index max): tint, rim, shadow, icons, text, hit targets. No lens for remote tabs.
- Content lens layer: per glass shape one div, `position:fixed; pointer-events:none; border-radius:R; backdrop-filter:...`, NO background. Created with `const anon = document.insertAnonymousContent(); anon.root.innerHTML = markup` (anon.root is a shadow root; the page cannot see it). The <svg><defs><filter> go in the same root and are referenced as `url(#id)`.
- Non-remote tabs (`browser.isRemoteBrowser === false`: about:preferences, about:support, anything drawn by the chrome layer such as Home): put the same lens div and filter in the parent layer; backdrop-filter works there.

BRIDGE
- Production: `ChromeUtils.registerWindowActor("VitreGlass", { parent:{esModuleURI}, child:{esModuleURI, events:{DOMContentLoaded:{}}}, messageManagerGroups:["browsers"], safeForUntrustedWebProcess:true })`, then `browser.browsingContext.currentWindowGlobal.getActor("VitreGlass").sendQuery("Set", {html})`. `safeForUntrustedWebProcess:true` is mandatory. The child module must ship inside the app; a web content process cannot read it from a loose folder. Actors attach only to window globals created after registration. See GlassChild.sys.mjs / GlassParent.sys.mjs.
- Works today in all process types: `window.messageManager.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(code), true)`. Listen on window.messageManager, send via the current browser.messageManager (it is replaced on each navigation). See glasslib.js contentGlass() and content-glass.js.
- The layer dies with its document: re-send on every DOMContentLoaded.
- Page zoom: wrap the layer in `<div style="zoom:${1/browser.fullZoom}">`.

LENS FILTER (glasslib.js stripLensMarkup(id, w, h, {radius, bezel, scale, blur, saturate, diag:false}))
- Same parameters as app/src/renderer/glass.ts: bezel = min(14, h/3); scale 18 (12 when h <= 36); blur 1.4, 2.4 on the active pill; saturate 1.5; falloff (1-t)^2.2.
- `<filter x=0 y=0 width=W height=H filterUnits=userSpaceOnUse primitiveUnits=userSpaceOnUse color-interpolation-filters=sRGB>`
- Three depth bands (0-2.5, 2.5-5.5, 5.5-9.5 px for a 14 px bezel); M = band mean of profile * scale/2.
- Top band: `<feOffset in=SourceGraphic dy=-M x=0 y=A width=W height=B-A>`; bottom band dy=+M at y=H-B.
- Left/right bands: dx=-M / +M, restricted to y in [0.29*radius, H-0.29*radius].
- `<feMerge>` with SourceGraphic first then every strip; then `<feGaussianBlur stdDeviation=BLUR>`; then `<feColorMatrix type=saturate values=1.5>`.
- 12 nodes per shape. One filter per distinct size.
- Plain variant: `backdrop-filter: blur(1.4px) saturate(1.5)`. Frost for menus/panels: `blur(24px) saturate(1.6)`.
- While a pill morphs use `blur(10px) saturate(1.6)`, then install the strip filter for the final size (same as the Electron CSS).
- Suggested level of detail: strip lens on the active pill, omnibox field, capsule, panels; plain blur+saturate on tab circles unless there are few.

GOTCHAS
- Keep each filter under 64 primitives (gfx.webrender.max-filter-ops-per-chain); over the limit the element silently shows the raw backdrop.
- clip-path and mask on the lens element disable backdrop-filter. Only border-radius clips it.
- Leave gfx.webrender.svg-filter-effects.fedisplacementmap and .feimage alone: together they blank the window.
- feImage, feDisplacementMap, feTurbulence and external data: SVG filter URLs do not work in a backdrop-filter.
- Diagonal cells (diag:true) look blocky on circles; leave them off.

PARENT CSS
- Copy the three theme blocks (--g-tint, --g-rim, --g-shadow, text colours) from app/src/renderer/styles.css unchanged (boot7-bar.js has them).
- Rim: `padding:1px; background:var(--g-rim); mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;`

HOME / WINDOW
- Set `:root, body, #browser, #tabbrowser-tabbox, #tabbrowser-tabpanels { background: transparent !important }` and hide the page browser.
- widget.windows.mica=false: see-through window. =true: Mica. With widget.windows.mica.toplevel-backdrop=2: Acrylic; =3: Mica Alt.
- For glass that refracts the wallpaper, draw the wallpaper image in the chrome layer and use parent backdrop-filter (reading the wallpaper path was not tested).

MEASURING
- `--pref gfx.webrender.debug.profiler=true` puts WebRender frame timings in the capture; ChromeUtils.requestProcInfo() gives per-process CPU.

## Compromises
- No true per-pixel refraction. The strip lens quantises the Electron displacement profile into three steps per side; pills look right, circles bend in four directions instead of radially.
- The lens lives in the content process, so there are two layers to keep in step and a moment with tint and rim only on every navigation.
- Lens detail has to be rationed: the full strip lens on 14 shapes costs about 4.9 ms of WebRender frame CPU per composited frame on this desktop versus 2.1 ms for plain blur. Recommended default is strip lens on the pill, field, capsule and panels, plain blur on circles.
- One element per shape; the single-element bar (clip-path or mask) is not possible.
- Glass over Mica, Acrylic or a transparent window is tint only. To refract the wallpaper on Home it must be drawn as an image in the chrome layer, as in Electron.
- Parent-process pages and Home need a second lens host in the parent layer.
- FINDINGS.md could not be written (the harness blocks report .md files from subagents); the content is in this output.

## Risks
- Animation sync: the 420 ms pill morph must run in both processes; untested. A one-message CSS transition will be a frame or two apart; a shared start time via the Web Animations API is the likely fix.
- Per-document layer: PDF viewer, error pages, view-source, image/SVG documents and XUL documents were not tested. The devtools source says insertAnonymousContent is unsupported in XUL documents.
- Pinch zoom would scale the content lens but not the parent layer; untested.
- HiDPI untested (machine is devicePixelRatio 1).
- Weak CPUs: the cost is CPU in the GPU process (render-task setup per filter node). All numbers are from an RTX 5070 desktop with other spikes running; idle cost was not measured.
- Fixed glass over scrolling content defeats picture caching for the tiles under the bar; heavy pages will cost more than the test page.
- Firefox updates: the approach depends on WebRender's SVG filter graph (gfx.webrender.svg-filter-effects, default on), the 64-primitive limit, and anonymous content. A WebRender feDisplacementMap implementation would allow the true lens; a slicing change could make the content layer unnecessary.
- Snapshots: any background on a lens element shows up in drawSnapshot output (thumbnails, captureVisibleTab). Keep lens elements background-free.
- Actor packaging: the content-side module must be inside the app for sandboxed web processes; only the frame-script route was proven there.
- Side effect seen during runs: Windows showed "Would you like to pin Firefox to your taskbar?" toasts from the runtime (visible in out/boot12-*/screen-*.png). Nothing was clicked. tools/run.py probably needs a pref for it. Those screen grabs also contain whatever else was on the desktop (another app's update dialog, a terminal).
- tools/screencap.py briefly sets the spike's own window topmost to grab it; boot12 also moves the window to the right half of the screen.

## Files
gecko\spikes\glass\glasslib.js
gecko\spikes\glass\content-glass.js
gecko\spikes\glass\GlassChild.sys.mjs
gecko\spikes\glass\GlassParent.sys.mjs
gecko\spikes\glass\page.html
gecko\spikes\glass\boot1-basic.js
gecko\spikes\glass\boot2-diag.js
gecko\spikes\glass\boot3-url.js
gecko\spikes\glass\boot4-content.js
gecko\spikes\glass\boot5-offsetlens.js
gecko\spikes\glass\boot6-perf.js
gecko\spikes\glass\boot7-bar.js
gecko\spikes\glass\boot8-live.js
gecko\spikes\glass\boot9-inproc.js
gecko\spikes\glass\boot10-row.js
gecko\spikes\glass\boot11-circles.js
gecko\spikes\glass\boot12-mica.js
gecko\spikes\glass\boot13-web.js
gecko\spikes\glass\boot14-actor.js
gecko\spikes\glass\tools\variants.py
gecko\spikes\glass\tools\crop.py
gecko\spikes\glass\tools\screencap.py
gecko\spikes\glass\tools\prefscan.py
gecko\spikes\glass\out\boot2-diag-default\diag-default.png
gecko\spikes\glass\out\boot3-url-default\url-default.png
gecko\spikes\glass\out\boot3-url-dispturb\url-dispturb.png
gecko\spikes\glass\out\boot4\content-default.png
gecko\spikes\glass\out\boot6-stats-row2.png
gecko\spikes\glass\out\boot7-light-strip\bar-light-strip-stripes.png
gecko\spikes\glass\out\boot7-light-strip\zoom-stripes-right.png
gecko\spikes\glass\out\boot7-bar-dark-strip\bar-dark-strip-darkpage.png
gecko\spikes\glass\out\boot7-bar-clear-strip\bar-clear-strip-gradient.png
gecko\spikes\glass\out\boot7-bar-wiki-clear\zoom-image.png
gecko\spikes\glass\out\boot8\live-0.png
gecko\spikes\glass\out\boot8\live-2.png
gecko\spikes\glass\out\boot9\inproc-preferences.png
gecko\spikes\glass\out\boot10-row-ops512\row-ops512.png
gecko\spikes\glass\out\boot11-circles-raw\zoom-lines.png
gecko\spikes\glass\out\boot11-circles-tint\zoom-pills-all.png
gecko\spikes\glass\out\boot12-mica\screen-mica-2.png
gecko\spikes\glass\out\boot12-acrylic\screen-acrylic-2.png
gecko\spikes\glass\out\boot12-off\screen-off-2.png
gecko\spikes\glass\out\boot13\web-framescript.png

# Independent verification

## Overall
The spike's working parts all reproduce, but its two most consequential 'not-possible' verdicts are wrong, and its content recipe has a hole.

**What changes**
- **Glass can live entirely in the parent chrome layer.** A surface-creating style on the tab box (`filter: saturate(1.0001)`) makes parent `backdrop-filter` sample the live remote page. This was shown on local pages, Wikipedia, the PDF viewer, error pages, in-process pages, video, a second window, at 1.5x scale and under software WebRender.
- **One backdrop element can serve the whole bar.** The 'clip-path/mask disable backdrop-filter' result was an HTML quoting bug in the test. The single-element row lens gives every shape the strip lens at the cost of plain blur.
- **The content recipe fails on strict-CSP pages and the PDF viewer** as written (inline style attributes are dropped). Applying styles through the CSSOM fixes it.

**What stands**
- True per-pixel refraction is not available: the WebRender shader in this build has no feDisplacementMap or feImage. The strip lens remains the approximation; pills look right, circles bend in four directions.
- Glass over Mica or the desktop is tint only; drawing the wallpaper in the chrome layer works and was tested.

**Decision for you**
The parent recipe is simpler (one document, exact morph sync, no bridge, no dropout on navigation), but page text loses ClearType and becomes greyscale-antialiased. The content recipe keeps ClearType but needs the actor bridge, CSSOM styling, zoom compensation and re-sending per document. CPU cost of the two is about equal on this machine. I would build on the parent recipe and keep the content route as the fallback if greyscale page text is judged unacceptable at 100% scaling; that judgement needs your eyes on out\v2-text-aa.png and a real page.

**Not verified**
- Parent recipe with hardware video overlays or DRM video, on weak integrated GPUs, in DOM fullscreen, and across future Firefox versions.
- Pinch zoom for either recipe.
- Acrylic and Mica Alt were not rerun.

**Housekeeping**
- VERIFY.md was not written: subagent rules here forbid report .md files, so the notes are this output. All scripts and captures are in gecko\spikes\glass\verify\ (v1 to v16, out\).
- v10-actor.js writes two module files into its own throwaway profile in %TEMP%.
- Spike runs are raising Windows 'pin Firefox to your taskbar' prompts on the desktop (visible in out\orig-boot12-mica\screen-mica-2.png); the harness prefs should suppress that.

## Confirmed
- Paths below are relative to gecko\spikes\glass\verify\ (V). Original scripts were rerun under --name glass-verify-* into V\out\boot*, V\out\orig-boot*.
- Claim 1, default behaviour only: with no other styling, a parent chrome element's backdrop-filter shows the raw remote page while the same tile over chrome-drawn stripes is filtered (out\boot1\basic-default.png, out\boot2\diag-default.png, out\orig-boot9\inproc-remote-mozelement.png). The 'not-possible' verdict itself is refuted, see below.
- Claim 2: parent backdrop-filter over an in-process page works (out\orig-boot9\inproc-preferences.png: invert tile is white over dark about:preferences; out\orig-boot9.txt 'isRemoteBrowser = false').
- Claim 3: content-side lens (insertAnonymousContent) samples the page for blur/saturate/brightness/invert, pixel-aligned with parent outlines (out\boot4\content-default.png, content-default-scrolled.png). Extra: it leaves page text ClearType untouched (0 pixels differ from the no-lens capture in the text region outside the tiles).
- Claim 4: content lens is live under auto-scroll, CSS animation and WebM video (out\orig-boot8\montage-live.png = live-0 vs live-2: different scroll position and video frame, both seen through blur/invert/strip tiles).
- Claim 5: content lens on en.wikipedia.org in a webIsolated process (out\orig-boot13\web-framescript.png, web-framescript-scrolled.png; out\orig-boot13.txt 'remoteType webIsolated=https://wikipedia.org').
- Claim 6 (main part): backdrop-filter:url(#filter) with feGaussianBlur, feColorMatrix, feOffset (+subregions), feMerge works in parent and in the anonymous root (out\boot3\url-default.png, out\boot4\zoom-row2.png).
- Claim 7: feDisplacementMap/feImage/feTurbulence cannot run in a backdrop-filter. Reproduced (out\boot3\url-default.png; both prefs on blanks the window: out\orig-boot3-disp\url-disp.png). Now also proven at source level: the cs_svg_filter_node shader text inside gecko\runtime\xul.dll has only '// TODO' for FILTER_DISPLACEMENT_MAP, FILTER_IMAGE, turbulence, lighting, morphology, tile and convolve; only identity/opacity/toAlpha/blend/colorMatrix/componentTransfer/composite/dropShadow/flood/blur/offset are implemented. No pref can change this in Firefox 157.
- Claim 8: -moz-element(#remoteBrowser) paints only the fallback colour (out\orig-boot9\inproc-remote-mozelement.png). No alternative found; not needed any more.
- Claim 9: drawSnapshot cost reproduced: mean 1.24 ms for 480x44, 0.77 ms for 1280x56, about 180 calls/s (out\orig-boot9.txt). Still partial (main-thread pixels).
- Claim 10: strip lens look reproduced. Pills are close to the true lens; circles show flat horizontal bands where the true lens bends lines into arcs (out\v6-row-content\zoom-lines.png, zoom-checker.png; out\orig-boot9-11-montage.png).
- Claim 11: fine-cell lens renders only with gfx.webrender.max-filter-ops-per-chain raised (out\orig-boot5\offsetlens-default.png: 68-node and 104-node pills render). New limit found: shapes with 148+ feOffset nodes do not render even at 512 (see improved: hard cap).
- Claim 13: bar with rim, tint, shadow in light, dark and clear themes over busy and plain pages reproduced (out\orig-boot7-light\, out\orig-boot7-montage.png for dark and clear). Note the evidence captures use 16-node filters (diag on, see log line 'filter nodes per shape 44x44:16'), not the 12-node filter the recipe recommends.
- Claim 14: cost ordering and size reproduced with a different measure (GPU-process CPU, % of one core at 180 Hz, v3-perf.js, out\v3-perf-noprof-*\log.txt): no glass 26-28, plain blur on 14 shapes 43-52, strip on pill+capsule 51-56, strip on all 100-103. That is about 0.018 ms per feOffset node per frame, matching the reported 0.02. Idle cost (was unmeasured): at most 1.4% on a static page for every mode (out\v3-perf-idle-*\log.txt).
- Claim 15: CSS zoom 1/fullZoom compensation lines the content lens up at 150% (out\orig-boot8\live-zoom150.png).
- Claim 16 stays partial: drawSnapshot shows the tinted tile but not the background-free blur/invert tiles (out\orig-boot8\live-snapshot.png).
- Claim 18: frame-script bridge works in file and webIsolated processes and survives navigation (out\orig-boot7-light.txt '[content] ready ...' lines). The markup recipe it carries is broken on strict-CSP pages, see refuted.
- Claim 19: transparent root gives a see-through window with widget.windows.mica=false and Mica with =true, real screen grabs (out\orig-boot12-off\screen-off-2.png, out\orig-boot12-mica\screen-mica-2.png; log '(-moz-windows-mica): true'). Acrylic and Mica Alt variants were not rerun.
- Claim 20: backdrop-filter cannot sample Mica or the desktop behind the window; tiles over the transparent area show tint only while the tile over chrome-drawn stripes blurs (same two screen grabs). This is inherent: DWM composes the backdrop outside WebRender.

## Refuted
- Claim 1 [not-possible]: parent chrome backdrop-filter cannot sample the remote page (and the summary line 'a chrome element in browser.xhtml cannot see the remote page through backdrop-filter at all').
  why: It can. Put any surface-creating style on a common ancestor of the remote <browser> and the glass element and parent backdrop-filter samples the live page: blur, invert, saturate and url(#feOffset strips) all work. Proven with filter:saturate(1.0001) on #tabbrowser-tabbox, .browserStack or body (v2-neutral.js + v2-compare.py: invert tile differs from base by 242/255 for sat, bright, svgid, svgcm, mask, anim, persp, rot, bf, bodysat, tabboxsat; 0 for none). Not working: opacity 0.99-0.999, will-change:opacity, clip-path:inset(0), contain/isolation, a mix-blend-mode child. Full bar in the parent, same DOM as Electron's .glass > .lens: v4-parent.js -> out\v4-light\parent-light-stripes.png, zoom-stripes-left.png; Wikipedia webIsolated: parent-light-wiki-image.png; no dropout on navigation or tab switch: parent-light-nav-during.png, parent-light-tab2-immediately.png; in-process page: parent-light-preferences.png; video + scroll + animation: parent-light-live-1.png; second window: parent-light-window2.png; dark/clear: out\v4-dark, out\v4-clear; software WebRender: out\v4-swwr\zoom.png (layer manager 'WebRender (Software D3D11)'); PDF viewer, neterror, view-source, image and text documents: out\v11-pages-parent\montage.png; wheel scroll and clicks still reach the page: out\v14-input (y 0 -> 510, hash '#clicked', pill click stays in chrome). Reason for the default failure: WebRender puts a tile-cache barrier around the root content pipeline; inside an intermediate surface there is no barrier. Per the CSS spec a filtered ancestor is the Backdrop Root, so this is specified behaviour, not a quirk. Costs are listed under improved.
- Claim 12 [not-possible]: one backdrop element for the whole bar shaped with clip-path or mask ('clip-path and mask on the lens element disable backdrop-filter').
  why: Test bug in boot10-row.js, not a Gecko limit. It interpolated path("...") and url("data:...") into a double-quoted style="..." attribute; the inner quote ends the attribute, so the backdrop-filter declaration after it was never parsed. With single quotes every kind works on a backdrop-filter element, in content and in parent: mask linear-gradient, multi-layer gradient mask, mask:url('data:svg'), mask:url(#svgMask), clip-path inset/circle/polygon/path() union/url(#clipPath), overflow:hidden rounded parent (v5-mask.js -> out\v5-mask-content\mask-content.png, out\v5-mask-parent\mask-parent.png). One element + G.rowLensMarkup shared filter is pixel-equivalent to 13 separate elements (v6-row.js -> out\v6-row-content\zoom-checker.png, zoom-lines.png, same for parent).
- Claim 6 sub-claim and gotcha: 'an external url("data:...svg#f") reference did not render' / 'external data: SVG filter URLs do not work in a backdrop-filter'.
  why: Same quoting bug in boot4-content.js. backdrop-filter:url('data:image/svg+xml,...#f') works in the anonymous content and in the parent, and url(blob:...#f) works in the parent (v16-dataurl.js -> out\v16-dataurl\zoom.png).
- Content-lens recipe as written (claims 3, 5, 18 and GlassChild.sys.mjs): `anon.root.innerHTML = markup` with inline style="" attributes, presented as working on any page.
  why: A page CSP without 'unsafe-inline' in style-src silently drops those style attributes, so the lens divs get no geometry and no backdrop-filter. It fails on the Firefox PDF viewer (viewer.html CSP 'style-src resource: chrome:') and on a strict-CSP test page while set() still returns true (v13-csp.js -> out\v13-csp\montage.png left column; v11-pages.js -> out\v11-pages-content\pages-content-pdf.png). Applying the same styles through the CSSOM (el.style.cssText) works on both (content-glass2.js, right column of the same montage).
- Claim 17 [partial]: JSWindowActor times out in a webIsolated process, 'not verified with a packaged module'.
  why: Now proven. With the two modules copied to <profile>\chrome\vitre\ (sandbox-readable, like the app folder) and served from a resource:// substitution, getActor + sendQuery('Set') succeed in webIsolated (example.com 2.5 ms, Wikipedia 0.5 ms), file and parent processes, and the DOMContentLoaded 'Ready' event reaches the parent (v10-actor.js -> out\v10-actor\log.txt, actor-profile-webIsolatedhtt-wiki.png).
- Compromises: 'lens detail has to be rationed (strip lens only on pill, field, capsule, panels)', 'the lens drops out between documents on navigation', 'parent-process pages and Home need a second lens host'.
  why: None of the three holds once claims 1 and 12 fall. The single-element row lens puts the strip lens on every shape for the cost of plain blur (41-42% vs 100-103% per-shape, plain blur 43-52%; out\v3-perf-noprof-crow, -cstrip, -ccss). With the parent recipe nothing lives in the content document, so there is no dropout and one host serves remote pages, in-process pages and Home.

## Improved
- Whole glass in the parent layer (changes the architecture)
  finding: Recipe: `#tabbrowser-tabbox { filter: saturate(1.0001); }` and the Vitre layer as a child of the tab box (position:fixed; inset:0; pointer-events:none). Then .glass > .lens { backdrop-filter: ... } works exactly as in Electron's styles.css, with lens, tint, rim and face in one element. Evidence: v4-parent.js, out\v4-light, out\v4-dark, out\v4-clear. The trigger is pixel-neutral except for text: saturate(1.0001), perspective, mask, identity SVG filter, opacity animation and backdrop-filter-on-ancestor all give identical output, and stripes/gradient/grid pixels are unchanged (v2-compare.py; gradient check out\v2-neutral-g-*). Avoid filter:opacity(0.9999) (changes more pixels).
- Cost of the parent recipe (the trade-off to decide on)
  finding: 1) Page text loses ClearType and becomes greyscale-antialiased: 21,185 pixels (2.36%) change, all in text rows (out\v2-text-aa.png shows both). gfx.webrender.quality.force-subpixel-aa-where-possible does not restore it (out\v2-neutral-sat-fsub). The content-side lens keeps ClearType. 2) The page is drawn into one intermediate surface, so it loses its own picture-cache slice. Measured GPU-process CPU, % of one core at 180 Hz: Wikipedia auto-scroll none 14-18, surface root alone 24-28, parent row lens 40-44 vs content row lens 42-50, parent strip-all 82-89 vs content 86-93 (out\v3-perf-wiki-*). Test page scroll: root alone 21-22 vs none 26-28. Small in-page animation, no scroll: parent strip-all 48-62 vs content 34-36, row lens equal at about 30 (out\v3-perf-smallanim-*). Idle: about 0 for all. 3) Not verified: hardware video overlays / DRM video inside the surface, weak integrated GPUs, DOM fullscreen.
- One element for the whole tab bar
  finding: clip-path:path('...union...') + G.rowLensMarkup (top/bottom strips shared, 4 cap strips per shape): 58 feOffset nodes for 13 shapes instead of 156, 1 backdrop element instead of 13. GPU-process CPU on the scrolling test page: 41-42% vs 100-103% per-shape, 26-28% with no glass (v3-perf.js modes crow/prow). Limits found: at the default gfx.webrender.max-filter-ops-per-chain=64 a row holds 13 shapes; 19 shapes (82 nodes) silently render the raw backdrop and work with the pref at 256 (out\v6-row-tabs20\zoom.png vs out\v6-row-tabs20-ops256\zoom.png). There is also a hard cap regardless of the pref: 122 feOffset nodes render, 126 do not (out\v6-row-limit-montage.png), consistent with a 256-node graph limit where each feMergeNode counts.
- Claim 21, pill morph in step (was unverified)
  finding: v8-morph.js + v8-measure.py, lens edge vs parent outline during a 600 ms width animation, 8 captures each: parent recipe 0 px in 8/8; content lens with the same CSS animation started in both documents 0 px in 8/8; content lens driven by per-frame messages lags 1-2 px in 5/8 at 180 Hz (would be several px at 60 Hz).
- Claim 22, HiDPI and other document kinds (was unverified)
  finding: devicePixelRatio 1.5 (layout.css.devPixelsPerPx set at runtime, 1920x1200 captures): both recipes scale and align (out\v4-hidpi\zoom-stripes.png, out\orig-boot7-hidpi\zoom-stripes.png). PDF viewer, about:neterror, view-source, standalone image, text/plain, about:blank, about:support: parent recipe works on all (out\v11-pages-parent\montage.png); content recipe works on all except the PDF viewer until styles go through the CSSOM (out\v11-pages-content\montage.png, out\v13-csp\montage.png). Nested scrollers (absolute, fixed, will-change, contain, iframe) work for both (out\v12-scroller-*\montage.png). Pinch zoom still untested.
- Home wallpaper glass (was untested)
  finding: Reading HKCU\Control Panel\Desktop\WallPaper with nsIWindowsRegKey, IOUtils.read -> Blob URL -> background-image in the chrome layer works (5120x2880 JPEG decoded), and parent backdrop-filter refracts and frosts it with no surface root needed (v9-home.js -> out\v9-home\home-wallpaper.png).
- Wide windows
  finding: At 4384 device px wide the surface root leaves the page pixel-identical (0 changed pixels in the stripe band) and a single 4344 px backdrop element still filters (v15-wide.js -> out\v15-wide-root\zoom.png, out\v15-wide-compare-right.png). Firefox's own CSS caps backdrop elements at 4000 px for other hardware, so treat wider elements as unverified elsewhere.
- Frame budget warning
  finding: With the WebRender profiler and GPU time queries on, strip-lens-on-all-shapes dropped frames in both recipes (content rAF mean 7.2-7.9 ms instead of 5.56; out\v3-perf-pstrip\log.txt, out\v3-perf-cstrip\log.txt). Per-shape strip lenses on 14 shapes use the whole 180 Hz budget of the GPU process on this desktop; the row lens does not.

## Recipe corrections
1. ARCHITECTURE line 'No lens for remote tabs in the parent layer' is wrong. Parent-only recipe: `#tabbrowser-tabbox { filter: saturate(1.0001); }`, Vitre layer inside the tab box, `.glass > .lens { backdrop-filter: url(#strip) | blur() saturate() }`. No content layer, bridge, zoom wrapper, re-send on DOMContentLoaded or second host. position:fixed inside the filtered tab box is relative to the tab box. Reference: verify\v4-parent.js.

2. Never interpolate url("...") or path("...") into a style="..." attribute. The inner double quote ends the attribute and everything after it is dropped silently. Use single quotes or set el.style via the CSSOM. This bug produced three wrong conclusions in the spike (clip-path, mask, external filter URL).

3. Content route, if used: do not rely on inline style attributes in anon.root.innerHTML. Apply styles with el.style.cssText / setProperty after insertion (verify\content-glass2.js: data-style -> cssText). Give the <svg> width="0" height="0" attributes instead of a style. The same fix is needed in GlassChild.sys.mjs.

4. GOTCHA 'clip-path and mask disable backdrop-filter; only border-radius clips it' is false. Use one backdrop element per row: `clip-path: path('M... union ...')` + G.rowLensMarkup(id, width, 44, shapes). Reference: verify\v6-row.js, verify\v3-perf.js (modes crow/prow). rowLensMarkup has one blur value for the row (1.8); keep the active pill as its own element if it needs 2.4.

5. Filter size limits are two, not one: (a) gfx.webrender.max-filter-ops-per-chain (default 64) counts primitives: row lens = 6 + 4 per shape + 3, so 13 shapes per element at default; (b) a hard cap of about 122 feOffset strips per filter whatever the pref. Over either limit the element shows the raw backdrop with no error. Either chunk rows at 13 shapes or ship the pref at 256 and chunk at 29.

6. GOTCHA 'external data: SVG filter URLs do not work' is false: url('data:image/svg+xml,...#id') and url(blob:...#id) work in backdrop-filter.

7. Node counts: the recipe says 12 nodes per shape (diag:false) but stripLensMarkup defaults to diag on for radius >= 12 (16 nodes), and the boot7 evidence was captured that way. Pass diag:false explicitly.

8. JSWindowActor: registration as given is right (safeForUntrustedWebProcess:true is mandatory). The child module only has to be in a sandbox-readable place: the app folder or <profile>\chrome\ both work with a resource:// substitution (verify\v10-actor.js).

9. Morph on the content route: start the same CSS transition in both documents with one message; do not send geometry per frame.

10. Harness traps: tools/run.py writes numeric --pref values as numbers, so string prefs such as layout.css.devPixelsPerPx=1.5 are ignored; set them at runtime (verify\v7-hidpi.js). windowUtils.sendMouseEvent does not exist in 157; use window.synthesizeMouseEvent(type, x, y, {button, clickCount}, {}).

11. Unchanged and correct: leave gfx.webrender.svg-filter-effects.fedisplacementmap/.feimage off; strip-lens parameters; theme variables and rim mask CSS; Mica prefs; drawing the wallpaper in the chrome layer for Home.