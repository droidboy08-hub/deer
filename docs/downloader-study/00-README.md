# Deer downloader study

## What this is

A read-only study of the download system in **Deer**, the owner's Windows web browser (a TypeScript layer on
Mozilla's Firefox 157 engine; "Vitre" in the code). Deer's downloader was modelled on Internet Download Manager
(IDM): many connections per file, pause and resume, retries, a speed limit, categories, and a video downloader
(HLS, DASH, direct files, and yt-dlp + ffmpeg for sites such as YouTube).

The study pulls out how it works, the algorithms, the exact numbers, the edge cases it handles, and **why** (bugs
found, owner decisions, commit messages, design documents). The goal is to bring the same quality to **TitleLess**,
the owner's iOS/iPadOS browser.

- Written on 2026-10-29 from the Deer repository, branch `macos-port` (last commit at the time: `8e80350`).
- Deer's code is cited as `path:line`, relative to the Deer repository root (for example
  `gecko/src/modules/downloads/ranged.ts:120`).
- TitleLess's code was **not** read. What the study says about TitleLess comes only from TitleLess's own downloader
  audit summary.
- Nothing in Deer was changed or run to write this.

## Who it is for

- **The owner**, to decide what to build in TitleLess and in which order.
- **A coding agent** (for example Claude Code) working in the TitleLess repository, as the reference for each change.
- **A reviewer**, to check a TitleLess change against the behaviour Deer proved with tests.

## Reading order

1. **[01-overview.md](01-overview.md)**: the map, the life of one download and of one video download, the key
   numbers, and the glossary (every term used in the study).
2. **[40-ios-port-guide.md](40-ios-port-guide.md)**: the comparison with TitleLess, the iOS facts, 25 ranked
   improvements, what not to port, and the order of work. Its iOS facts were checked against Apple's documentation
   on 2026-10-29; the sources and what changed are in its
   [Verification notes](40-ios-port-guide.md#verification-notes).
3. The section files, when you work on one area. Each improvement in the guide links to the exact sections it needs.

## The files

| File | One line |
|---|---|
| [00-README.md](00-README.md) | This index. |
| [01-overview.md](01-overview.md) | How Deer downloads end to end: architecture map, walk-throughs for a file and a video, numbers at a glance, glossary. |
| [10-multi-connection-engine.md](10-multi-connection-engine.md) | The IDM-style engine: probe, connection count, block-aligned plan, lanes, work stealing, stall and slow cuts, per-connection retries, writing, speed limit, the IDM benchmark. |
| [11-integrity-resume-retry.md](11-integrity-resume-retry.md) | "Never lose or mix bytes": the same-file proof (R1-R7), proof windows, the block hash record, seals, crash recovery, retries like IDM, link expiry and renewal, Check file and Repair. |
| [12-download-manager.md](12-download-manager.md) | The manager: row states (`need`, `wait`), the queue, take-over of browser downloads, request identity, referrer policy, naming, persistence, restart and quit rules, the hidden page step. |
| [20-video-detection.md](20-video-detection.md) | Finding the video: the network eye, the page eye, per-document records, reject rules, ranking playlists, DRM and live detection, the quality ladder, embedded players, and 17 rules for TitleLess. |
| [21-hls-dash-engine.md](21-hls-dash-engine.md) | Downloading HLS and DASH: parsing, quality fingerprint, parallel fetch with in-order writing, hedging, AES-128, sniffing, refreshing expired segments, the segment table, resume proof, joining, length check. |
| [22-ytdlp-ffmpeg.md](22-ytdlp-ffmpeg.md) | yt-dlp, Deno and ffmpeg: when they are used, format selection, codec/container rules, the resume check, installers; and why none of it can run in an App Store app. |
| [30-ux-tests-history.md](30-ux-tests-history.md) | The download UI and its wording, the test suite as a checklist of about 110 scenarios (IDs A1-H11), how to turn it into XCTest, and the dated history of decisions. |
| [40-ios-port-guide.md](40-ios-port-guide.md) | The practical guide for TitleLess: what it has vs Deer, iOS ground rules (fact-checked, with sources), 25 ranked improvements with Swift designs and acceptance tests, what not to port, milestones. |
| [90-verification-deer.md](90-verification-deer.md) | The fact-check of the Deer side (files 01 to 30) against Deer's code: how it was checked, every claim checked, what was fixed. The iOS side's check is at the end of the guide. |

## Markers used in the study

- **(unverified)**: an iOS fact or a guess that no primary source confirmed (Apple's documentation, WWDC pages, the
  App Review Guidelines, Apple engineers' forum answers) and that was not tried on a device. Check it before relying
  on it. The iOS ground rules in the guide (its section b) were checked on 2026-10-29 and take precedence over iOS
  remarks in the section files: some of those (in `01-overview.md`, `20-video-detection.md`,
  `21-hls-dash-engine.md`) were written before the check and still call things unverified that are now confirmed.
- **Not described**: TitleLess's audit summary says nothing about it. It does not mean TitleLess lacks it.
- **"by reading the code"**: a section writer's own reading, not stated in a comment, commit or test.
- **Deer word**: a name Deer's code or this study made up (lane, seal, nudge, rung ...). See the
  [glossary](01-overview.md#6-glossary).
- **Checklist IDs** (A1, B2, C1 ... H11): scenarios from Deer's test suite, listed in
  [30-ux-tests-history.md](30-ux-tests-history.md#mechanism-20-the-test-suite-as-a-checklist). The guide uses them as
  acceptance tests.

## How to use it with Claude Code in the TitleLess project

1. **Copy the folder** into the TitleLess repository, for example:

   ```
   cp -R "/Users/droid/Documents/Projects/Deer browser/docs/downloader-study" <TitleLess repo>/docs/downloader-study
   ```

   The section files cite Deer paths such as `gecko/src/modules/downloads/ranged.ts:120`. Those files do not exist
   in TitleLess; that is expected. Keep a note of where the Deer repository is, in case an agent needs to read the
   cited code.

2. **Copy Deer's test server** for the XCTest harness (improvement 5). It is plain Python with no Windows code:
   `gecko/tests/downloads/server.py` and `gecko/tests/downloads/fixtures.py` from the Deer repository (and, if you
   want the extra edge cases and the IDM bench knobs, `gecko/tests/downloads-verify/vserve.py` and
   `gecko/spikes/downloader/idm-bench/server.py`). `fixtures.py` needs ffmpeg on the Mac to make the stream fixtures.

3. **Point the agent at the guide.** A line like this in TitleLess's `CLAUDE.md` works:

   > Downloader work follows `docs/downloader-study/40-ios-port-guide.md`. Before changing `Downloads.swift`,
   > `RangedDownload.swift`, `HLSDownload.swift`, `TSRemuxer.swift`, `WebViewConfiguration.swift` or
   > `MediaControls.swift`, read the guide's item for the change and the section files it links. Facts marked
   > "(unverified)" must be checked against Apple's documentation before they are relied on.

4. **Work one improvement at a time**, in the milestone order of the guide (section e). Good prompts:

   - "Read item 1 of `docs/downloader-study/40-ios-port-guide.md` and the sections it links. Then read
     `RangedDownload.swift` and `HLSDownload.swift` and tell me what TitleLess already does. Then implement what is
     missing, with an XCTest for checklist items D1 and D3 against the local test server."
   - "Before building item 19, check whether `HLSDownload.swift` already races overdue segments and spills to disk.
     Deer's comments say those ideas came from it."
   - "For item 21, list every '(unverified)' iOS fact it depends on (the guide's Verification notes list them),
     write a small device test for each (for example: does a background download task with a `Range` header save
     only the 206 body?), and write the answers back into section b of the guide."

5. **Keep the control test green.** Checklist item C1 (an unchanged resume makes exactly the same requests as before)
   must pass after every change, so safety features never quietly cost bandwidth.

6. **Update the study when TitleLess changes.** When an item is built, mark it in the guide's comparison table
   (section a), so the next session starts from the truth.
