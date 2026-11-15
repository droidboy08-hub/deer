// Deer's platform layer: everything that differs between Windows and macOS below the UI, one file
// per capability in src/modules/platform/, so each later change edits only its own file. A process
// singleton (window code: b.sys('VitrePlatform') or fx.sysModule; singletons import it by URL).
// Pure words and path rules that every bundle needs (os, isMac, revealLabel...) are in
// src/shared/os.ts instead, which any bundle may import directly.
//
//   VitrePlatform.os             'win' | 'mac' | 'other' (src/shared/os.ts)
//   VitrePlatform.dirs           data, cache and the person's folders          platform/dirs.ts
//   VitrePlatform.objc           the Objective-C bridge, macOS only            platform/objc.ts
//   VitrePlatform.windowNative   window id, window move, system menu           platform/window-native.ts
//   VitrePlatform.progress       taskbar / Dock progress                       platform/progress.ts
//   VitrePlatform.a11y           system accessibility settings                 platform/a11y.ts
//   VitrePlatform.tools          installed tools' names and trust              platform/tools.ts
//   VitrePlatform.wallpaper      the desktop picture (macOS; HEIC via sips)    platform/wallpaper.ts
//
// Windows behaviour is the code that lived in firefox.ts, VitreStartup and VitreSwitcher before the
// macOS port, moved or copied unchanged; every macOS branch sits behind isMac. Each file names the
// Firefox internals it uses at its top.
import { os } from '../shared/os';
import * as a11y from './platform/a11y';
import * as dirs from './platform/dirs';
import * as objc from './platform/objc';
import * as progress from './platform/progress';
import * as tools from './platform/tools';
import * as wallpaper from './platform/wallpaper';
import * as windowNative from './platform/window-native';

declare global {
  interface VitreSysModules {
    VitrePlatform: typeof VitrePlatform;
  }
}

export const VitrePlatform = {
  os,
  dirs,
  objc,
  windowNative,
  progress,
  a11y,
  tools,
  wallpaper,
};
