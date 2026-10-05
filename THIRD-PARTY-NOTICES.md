# Third-party notices

Deer's own code is licensed under the Mozilla Public License 2.0 (see [LICENSE](LICENSE)). This file
lists the software by others that Deer's releases contain or that Deer downloads at your request,
with its licence and where to get its source.

**Deer is an independent project. It is not affiliated with, endorsed by or sponsored by Mozilla.**
Firefox and the Firefox logos are trademarks of the Mozilla Foundation. Deer does not use them as its
name or logo, and its releases are built on Mozilla's unbranded build, which carries neither.

## Mozilla's browser engine (Gecko)

Included in releases, in the `engine` folder. It is not part of this repository.

| | |
|---|---|
| What | Mozilla's unbranded Firefox 157.0 build for 64-bit Windows (`win64-add-on-devel`, opt), build ID 20260924084938 |
| Licence | [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/) |
| Source | `mozilla-release` revision `8eb25af4acf031ab1e06abf1a912275083c820ed` (Firefox 157.0): <https://hg.mozilla.org/releases/mozilla-release/rev/8eb25af4acf031ab1e06abf1a912275083c820ed> |
| Download and checksum | [docs/BUILDING.md](docs/BUILDING.md#the-engine) |

Parts of the engine are under other licences, among them LGPL-licensed media libraries and Microsoft
runtime libraries that Mozilla redistributes with its build. The engine lists its components and
their licence texts on its `about:license` page (type `about:license` in Deer's address field). The
LGPL-licensed libraries (FFmpeg's decoders in `media/ffvpx`, `media/libsoundtouch`, `gfx/graphite2`)
are built from source that is part of the same Mozilla revision; a few other components, such as
ONNX Runtime and the DirectX Shader Compiler, come from their own projects, and `about:license`
lists them with their licences.

Deer does not change any of Mozilla's source code. A release takes Mozilla's build as published,
renames the program to `deer.exe`, gives `deer.exe` Deer's icon, puts Deer's name in the version
information of `deer.exe` and `plugin-container.exe` (product, description and company; Mozilla's
copyright line stays), replaces a few names compiled into `deer.exe`, `xul.dll` and `mozglue.dll`
with Deer's names of the same length (the program's name and vendor, its data folders and registry
keys, so that Deer keeps its data apart from an installed Firefox), adds Deer's own files (the chrome package in the `vitre` folder, the
`config.js` loader, default preferences, policies, the window icon and a small placeholder program
named `firefox.exe` that the engine's media plug-ins look for) and leaves out some of Mozilla's
helper programs (updater, crash reporter, telemetry sender and others). The scripts that do this are
[gecko/tools/setup-engine.py](gecko/tools/setup-engine.py) and
[gecko/installer/build.py](gecko/installer/build.py).

## CityHash

Included in releases, in `Deer-Setup.exe` and `Uninstall.exe`.
[gecko/installer/EngineTraces.cs](gecko/installer/EngineTraces.cs) contains a C# port of CityHash64
(CityHash version 1.0.x, as vendored in Mozilla's source under
`other-licenses/nsis/Contrib/CityHash/cityhash/`). The uninstaller uses it to compute the engine's
install hash, so it removes exactly the registry entries and folders the engine created for Deer's
installation. Original project: <https://github.com/google/cityhash>.

```
Copyright (c) 2011 Google, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

CityHash Version 1, by Geoff Pike and Jyrki Alakuijala
```

## Tools Deer downloads only on request

These programs are not part of Deer, its repository or its releases. Deer downloads one only when you
ask for it in Settings > Video downloads, fetches it from its publisher's GitHub releases, and
installs it only if it matches the SHA-256 that the publisher lists for that release, in
`%LOCALAPPDATA%\Deer\ffmpeg` or `%LOCALAPPDATA%\Deer\tools`. Each keeps its own licence.

| Tool | Used for | Downloaded from | Licence | Source |
|---|---|---|---|---|
| FFmpeg | joining HLS and DASH streams into one file | the `win64-lgpl-shared` build of [BtbN's FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases), the Windows build that ffmpeg.org links to | LGPL (the build's `LICENSE.txt`, which Deer keeps next to `ffmpeg.exe`, states the version); [FFmpeg's legal page](https://ffmpeg.org/legal.html) | <https://ffmpeg.org/download.html>, and BtbN's build scripts at <https://github.com/BtbN/FFmpeg-Builds> |
| yt-dlp | "Download this video" on sites such as YouTube | [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) (`yt-dlp.exe`) | [The Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE) | <https://github.com/yt-dlp/yt-dlp> |
| Deno | the JavaScript runtime yt-dlp needs for some sites | [Deno releases](https://github.com/denoland/deno/releases) (`deno-x86_64-pc-windows-msvc.zip`) | [MIT](https://github.com/denoland/deno/blob/main/LICENSE.md) | <https://github.com/denoland/deno> |

## Add-ons

Add-ons you install from addons.mozilla.org are not part of Deer and keep their authors' licences.
Deer bundles none.

## Build tools (not distributed)

`npm ci` installs the build tools listed in `gecko/package.json`: esbuild (MIT) and TypeScript
(Apache 2.0). They turn Deer's source into the chrome package and are not part of the repository or
of a release. The earlier Electron build in `app/` (kept as a design reference, never released)
installs its own npm packages, among them Electron (MIT) and, for one experiment in `app/spike-ext/`,
electron-chrome-extensions (dual-licensed by its author: GPL 3.0 or a patron licence).
