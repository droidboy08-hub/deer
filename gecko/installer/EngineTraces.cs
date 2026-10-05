// What the Gecko engine writes outside Deer's folders by itself, keyed to the folder it runs from,
// and how the uninstaller removes exactly those entries (nothing that belongs to another install).
//
// Seen on this machine after runs of the engine from a given folder <engine>:
//   HKCU\Software\Mozilla\Firefox\Launcher                 values "<engine>\<exe>|Image", "|Launcher", "|Browser", ...
//   HKCU\Software\Mozilla\Firefox\DllPrefetchExperiment    value  "<engine>\<exe>"
//   HKCU\Software\Mozilla\Firefox\PreXULSkeletonUISettings values "<engine>\<exe>|..." (when the skeleton UI is on)
//   HKCU\Software\Mozilla\Firefox\Default Browser Agent    values "<engine>|DisableTelemetry", "<engine>|AppLastRunTime", ...
//   HKCU\Software\Mozilla\Firefox\TaskBarIDs               value  "<engine>" (written by Firefox's own installer only)
//   HKCU\Software\Mozilla\Firefox\Installer\<hash>         key
//   %ProgramData%\Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38\updates\<hash>\   folder
//   %ProgramData%\Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38\UpdateLock-<hash> file
//   %ProgramData%\Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38\profile_count_<hash>.json
// and, the first time the engine sets up Windows toast notifications (widget/windows/ToastNotification.cpp
// RegisterRuntimeAumid; xul.dll of both the branded and the unbranded 157 build carries
// "FirefoxPortableToast-"; seen on this machine for gecko\runtime with DisplayName "Vitre"):
//   HKCU\Software\Classes\AppUserModelId\FirefoxPortableToast-<hash>   DisplayName, IconUri (<engine>\browser\
//                                                                       VisualElements\...), CustomActivator {clsid}
//   HKCU\Software\Classes\CLSID\{clsid}\InprocServer32                 <engine>\notificationserver.dll
//   HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<that AUMID>  (Windows, once a toast showed)
// <hash> is Gecko's install hash: CityHash64 (v1.0.x, as vendored in mozilla-central) of the engine
// folder's path in UTF-16LE, printed as upper-case hex without padding
// (toolkit/mozapps/update/common/commonupdatedir.cpp GetInstallHash). Checked against the hashes of
// seven known folders, including 308046B0AF4A39CB for C:\Program Files\Mozilla Firefox.
// "Mozilla\Firefox" and the ProgramData GUID are compile-time names of the engine (MOZ_APP_VENDOR,
// MOZ_APP_BASENAME), the same for the unbranded build; the names in the engine's application.ini are
// cleaned as well in case a later engine changes its identity.
// A Deer engine with Deer's own identity (tools/setup-engine.py step 8: IDENTITY and COMPILED_NAMES;
// the full list is traces() in tests/engine/identity.py) writes the same entries under Deer's names,
// and they are removed the same way: HKCU\Software\Deer\EngineData\{Launcher, DllPrefetchExperiment,
// PreXULSkeletonUISettings, Default Browser Agent}, HKCU\Software\Deer\firefox\Installer\<hash> (and
// <Vendor>\<Name> from application.ini), %ProgramData%\Deer-Engine-1de4eec8-1241-4177-a864-e594fb38\...,
// the AUMID DeerAppPortableToast-<hash>, and %APPDATA%\Deer\EngineData\blocklist-<...> (the stock
// identity's under %APPDATA%\Mozilla\Firefox; the file the "<exe>|Blocklist" value names is read before
// that value goes). Also, for both identities:
//   %TEMP%\MozillaBackgroundTask-<hash>-*      a background task's throwaway profile, left only when the
//                                              task was killed (the vendor literal stays "Mozilla")
// and, under Deer's names only (folders every Deer engine of this account shares, so only what is
// empty, stale or named after this install goes):
//   %LOCALAPPDATA%\Deer\EngineData\SkeletonUILock-*   left only by a crash while the skeleton UI showed
//   %APPDATA%\Deer\installs.ini [<hash>], profiles.ini [Install<hash>] and the profile that section
//       names, when Deer never used it (no "vitre-profile" marker) and no other install names it, with its
//       local half in %LOCALAPPDATA%\Deer\Profiles: what a bare double-click on engine\deer.exe leaves
//       (Gecko makes a profile before config.js refuses it)
//   the empty folders Gecko makes at every start: %APPDATA%\Deer\Profiles, %LOCALAPPDATA%\Deer\Profiles,
//       then %APPDATA%\Deer\EngineData, %LOCALAPPDATA%\Deer\EngineData, %APPDATA%\Deer and
//       %LOCALAPPDATA%\Deer (never while it holds anything: Deer's real profile is %LOCALAPPDATA%\Deer\Profile)
//   %TEMP%\deerapp-temp-files when empty (files opened with another program; Gecko empties it at exit)
//   empty keys under HKCU\Software\Deer, bottom up.
// Keys and folders under Mozilla's names are shared with an installed Firefox and only lose this
// install's values. A test install (setup /testkeys) passes Roots.ForTest(): the shared folders are then
// the stand-ins DEER_TEST_APPDATA, DEER_TEST_LOCALAPPDATA and DEER_TEST_TEMP (inside %TEMP%), and a part
// without its stand-in is skipped, so a test never changes the person's own %APPDATA% / %LOCALAPPDATA%
// folders; entries named after the test install's own folder or hash are removed wherever they are.
//
// The CityHash64 functions below are a C# port of CityHash v1.0.x (city.cpp as vendored in Mozilla's
// source, other-licenses/nsis/Contrib/CityHash/cityhash/), used under its MIT licence:
//
//   Copyright (c) 2011 Google, Inc.
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy
//   of this software and associated documentation files (the "Software"), to deal
//   in the Software without restriction, including without limitation the rights
//   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//   copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
//   THE SOFTWARE.
//
//   CityHash Version 1, by Geoff Pike and Jyrki Alakuijala
//
// SPDX-License-Identifier: MPL-2.0 AND MIT
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Microsoft.Win32;

namespace Deer.Setup
{
    static class EngineTraces
    {
        const string UpdateRoot = "Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38";
        const string DeerUpdateRoot = "Deer-Engine-1de4eec8-1241-4177-a864-e594fb38"; // Deer's identity (setup-engine.py)
        const string DeerVendor = "Deer";

        // ---- CityHash64 v1.0.x ----
        const ulong K0 = 0xc3a5c85c97cb3127UL, K1 = 0xb492b66fbe98f273UL, K2 = 0x9ae16a3b2f90404fUL, K3 = 0xc949d7c7509e6557UL;

        static ulong F64(byte[] s, int i) { return BitConverter.ToUInt64(s, i); }
        static ulong F32(byte[] s, int i) { return BitConverter.ToUInt32(s, i); }
        static ulong Rot(ulong v, int s) { return s == 0 ? v : (v >> s) | (v << (64 - s)); }
        static ulong RotAtLeast1(ulong v, int s) { return (v >> s) | (v << (64 - s)); }
        static ulong ShiftMix(ulong v) { return v ^ (v >> 47); }

        static ulong Hash16(ulong u, ulong v)
        {
            const ulong kMul = 0x9ddfea08eb382d69UL;
            ulong a = (u ^ v) * kMul;
            a ^= a >> 47;
            ulong b = (v ^ a) * kMul;
            b ^= b >> 47;
            return b * kMul;
        }

        static ulong Len0to16(byte[] s, int n)
        {
            if (n > 8)
            {
                ulong a = F64(s, 0), b = F64(s, n - 8);
                return Hash16(a, RotAtLeast1(b + (ulong)n, n)) ^ b;
            }
            if (n >= 4)
            {
                ulong a = F32(s, 0);
                return Hash16((ulong)n + (a << 3), F32(s, n - 4));
            }
            if (n > 0)
            {
                uint a = s[0], b = s[n >> 1], c = s[n - 1];
                uint y = a + (b << 8);
                uint z = (uint)n + (c << 2);
                return ShiftMix(y * K2 ^ z * K3) * K2;
            }
            return K2;
        }

        static ulong Len17to32(byte[] s, int n)
        {
            ulong a = F64(s, 0) * K1;
            ulong b = F64(s, 8);
            ulong c = F64(s, n - 8) * K2;
            ulong d = F64(s, n - 16) * K0;
            return Hash16(Rot(a - b, 43) + Rot(c, 30) + d, a + Rot(b ^ K3, 20) - c + (ulong)n);
        }

        static ulong Len33to64(byte[] s, int n)
        {
            ulong z = F64(s, 24);
            ulong a = F64(s, 0) + ((ulong)n + F64(s, n - 16)) * K0;
            ulong b = Rot(a + z, 52);
            ulong c = Rot(a, 37);
            a += F64(s, 8);
            c += Rot(a, 7);
            a += F64(s, 16);
            ulong vf = a + z;
            ulong vs = b + Rot(a, 31) + c;
            a = F64(s, 16) + F64(s, n - 32);
            z = F64(s, n - 8);
            b = Rot(a + z, 52);
            c = Rot(a, 37);
            a += F64(s, n - 24);
            c += Rot(a, 7);
            a += F64(s, n - 16);
            ulong wf = a + z;
            ulong ws = b + Rot(a, 31) + c;
            ulong r = ShiftMix((vf + ws) * K2 + (wf + vs) * K0);
            return ShiftMix(r * K0 + vs) * K2;
        }

        static void Weak32(byte[] s, int i, ulong a, ulong b, out ulong first, out ulong second)
        {
            ulong w = F64(s, i), x = F64(s, i + 8), y = F64(s, i + 16), z = F64(s, i + 24);
            a += w;
            b = Rot(b + a + z, 21);
            ulong c = a;
            a += x;
            a += y;
            b += Rot(a, 44);
            first = a + z;
            second = b + c;
        }

        public static ulong CityHash64(byte[] s)
        {
            int n = s.Length;
            if (n <= 32) return n <= 16 ? Len0to16(s, n) : Len17to32(s, n);
            if (n <= 64) return Len33to64(s, n);
            ulong x = F64(s, 0);
            ulong y = F64(s, n - 16) ^ K1;
            ulong z = F64(s, n - 56) ^ K0;
            ulong v1, v2, w1, w2;
            Weak32(s, n - 64, (ulong)n, y, out v1, out v2);
            Weak32(s, n - 32, (ulong)n * K1, K0, out w1, out w2);
            z += ShiftMix(v2) * K1;
            x = Rot(z + x, 39) * K1;
            y = Rot(y, 33) * K1;
            int len = (n - 1) & ~63;
            int i = 0;
            do
            {
                x = Rot(x + y + v1 + F64(s, i + 16), 37) * K1;
                y = Rot(y + v2 + F64(s, i + 48), 42) * K1;
                x ^= w2;
                y ^= v1;
                z = Rot(z ^ w1, 33);
                Weak32(s, i, v2 * K1, x + w1, out v1, out v2);
                Weak32(s, i + 32, z + w2, y, out w1, out w2);
                ulong t = z; z = x; x = t;
                i += 64;
                len -= 64;
            } while (len != 0);
            return Hash16(Hash16(v1, w1) + ShiftMix(y) * K1 + z, Hash16(v2, w2) + x);
        }

        public static string InstallHash(string engineDir)
        {
            return CityHash64(Encoding.Unicode.GetBytes(engineDir)).ToString("X");
        }

        // ---- cleanup ----

        // The spellings of the engine folder Gecko may have used. Call while the folder still exists.
        public static List<string> Spellings(string engineDir)
        {
            var list = new List<string>();
            Action<string> add = delegate (string p)
            {
                if (string.IsNullOrEmpty(p)) return;
                p = p.TrimEnd('\\');
                foreach (string q in list) if (string.Equals(q, p, StringComparison.Ordinal)) return;
                list.Add(p);
            };
            add(engineDir);
            try { add(Paths.Full(engineDir)); } catch (Exception) { }
            try { add(Paths.Long(engineDir)); } catch (Exception) { }
            try { add(Paths.Final(engineDir)); } catch (Exception) { }
            return list;
        }

        static List<string[]> Identities(string engineDir)
        {
            var ids = new List<string[]> { new[] { "Mozilla", "Firefox" }, new[] { DeerVendor, "EngineData" }, new[] { DeerVendor, "Firefox" } };
            try
            {
                string ini = Path.Combine(engineDir, "application.ini");
                if (File.Exists(ini))
                {
                    string vendor = null, name = null;
                    bool app = false;
                    foreach (string raw in File.ReadAllLines(ini))
                    {
                        string line = raw.Trim();
                        if (line.StartsWith("[")) { app = line == "[App]"; continue; }
                        if (!app) continue;
                        if (line.StartsWith("Vendor=")) vendor = line.Substring(7).Trim();
                        if (line.StartsWith("Name=")) name = line.Substring(5).Trim();
                    }
                    bool known = false;
                    foreach (string[] id in ids)
                        if (string.Equals(id[0], vendor, StringComparison.OrdinalIgnoreCase) && string.Equals(id[1], name, StringComparison.OrdinalIgnoreCase)) known = true;
                    if (!string.IsNullOrEmpty(vendor) && !string.IsNullOrEmpty(name) && vendor.IndexOfAny(new[] { '\\', '/', '.' }) < 0 &&
                        name.IndexOfAny(new[] { '\\', '/', '.' }) < 0 && !known)
                        ids.Add(new[] { vendor, name });
                }
            }
            catch (Exception) { }
            return ids;
        }

        public class Plan
        {
            public List<string> Dirs;
            public List<string[]> Ids;
        }

        // The account folders the shared Deer folders are looked for in. Null: that part is skipped.
        public class Roots
        {
            public string AppData, LocalAppData, Temp;
            public bool Test;

            public static Roots Real()
            {
                var r = new Roots();
                r.AppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                r.LocalAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                r.Temp = Path.GetTempPath().TrimEnd('\\');
                return r;
            }

            // A test install: only the stand-ins the test names, each a folder inside %TEMP%.
            public static Roots ForTest()
            {
                var r = new Roots();
                r.Test = true;
                r.AppData = StandIn("DEER_TEST_APPDATA");
                r.LocalAppData = StandIn("DEER_TEST_LOCALAPPDATA");
                r.Temp = StandIn("DEER_TEST_TEMP");
                return r;
            }

            static string StandIn(string name)
            {
                string v = Environment.GetEnvironmentVariable(name);
                if (string.IsNullOrEmpty(v) || !Paths.IsInside(v, Path.GetTempPath())) return null;
                return Paths.Full(v);
            }

            public string Describe()
            {
                return (Test ? "test stand-ins " : "") + "APPDATA=" + (AppData ?? "(skipped)") + " LOCALAPPDATA=" + (LocalAppData ?? "(skipped)") +
                       " TEMP=" + (Temp ?? "(skipped)");
            }
        }

        public static Plan Prepare(string engineDir)
        {
            var plan = new Plan();
            plan.Dirs = Spellings(engineDir);
            plan.Ids = Identities(engineDir);
            return plan;
        }

        static int DeleteValues(string keyPath, Func<string, bool> match, Action<string> log)
        {
            int n = 0;
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(keyPath, true))
            {
                if (k == null) return 0;
                foreach (string name in k.GetValueNames())
                {
                    if (!match(name)) continue;
                    k.DeleteValue(name, false);
                    log("  removed HKCU\\" + keyPath + " : " + name);
                    n++;
                }
            }
            return n;
        }

        const string AumidRoot = @"Software\Classes\AppUserModelId";
        const string ClsidRoot = @"Software\Classes\CLSID";
        const string NotificationSettings = @"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

        // True when a registry path value (optionally quoted, optionally followed by arguments) names a
        // file inside one of the engine folder's spellings.
        static bool InsideEngine(Plan plan, string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            string v = value.Trim();
            if (v.StartsWith("\""))
            {
                int end = v.IndexOf('"', 1);
                v = end > 0 ? v.Substring(1, end - 1) : v.Trim('"');
            }
            foreach (string d in plan.Dirs)
                if (v.StartsWith(d + "\\", StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static string ValueOf(string keyPath, string name)
        {
            using (RegistryKey k = Registry.CurrentUser.OpenSubKey(keyPath))
                return k == null ? null : k.GetValue(name) as string;
        }

        static void DeleteKey(string path, Action<string> log)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(path))
                {
                    if (k == null) return;
                }
                Registry.CurrentUser.DeleteSubKeyTree(path, false);
                log("  removed HKCU\\" + path);
            }
            catch (Exception e)
            {
                log("  could not remove HKCU\\" + path + ": " + e.Message);
            }
        }

        // The engine's toast-notification registration (see the header): the AUMID keys named after one
        // of the engine folder's install hashes (kept if their icon points anywhere else), Windows' own
        // notification settings for those AUMIDs, and every per-user COM class whose server DLL lies in
        // the engine folder (the AUMID's CustomActivator; HKCU's CLSID table is small).
        static void RemoveToastRegistration(Plan plan, List<string> hashes, Action<string> log)
        {
            try
            {
                var aumids = new List<string>();
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(AumidRoot))
                {
                    if (k != null)
                    {
                        foreach (string name in k.GetSubKeyNames())
                        {
                            foreach (string h in hashes)
                            {
                                if (name.EndsWith("Toast-" + h, StringComparison.OrdinalIgnoreCase)) { aumids.Add(name); break; }
                            }
                        }
                    }
                }
                foreach (string name in aumids)
                {
                    string key = AumidRoot + "\\" + name;
                    string icon = ValueOf(key, "IconUri");
                    if (!string.IsNullOrEmpty(icon) && !InsideEngine(plan, icon))
                    {
                        log("  kept HKCU\\" + key + ": its icon is not in Deer's engine folder (" + icon + ")");
                        continue;
                    }
                    DeleteKey(key, log);
                    DeleteKey(NotificationSettings + "\\" + name, log);
                }
                var classes = new List<string>();
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(ClsidRoot))
                {
                    if (k != null) classes.AddRange(k.GetSubKeyNames());
                }
                foreach (string clsid in classes)
                {
                    string key = ClsidRoot + "\\" + clsid;
                    if (InsideEngine(plan, ValueOf(key + "\\InprocServer32", "")) || InsideEngine(plan, ValueOf(key + "\\LocalServer32", "")))
                        DeleteKey(key, log);
                }
            }
            catch (Exception e)
            {
                log("  toast registration cleanup failed: " + e.Message);
            }
        }

        // The file a "<engine>\<exe>|Blocklist" value names (the launcher process's third-party-module
        // blocklist), read before the value is deleted. Removed only inside one of `homes`.
        static void RemoveBlocklistFiles(string keyPath, string dir, List<string> homes, Action<string> log)
        {
            try
            {
                var files = new List<string>();
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(keyPath))
                {
                    if (k == null) return;
                    foreach (string name in k.GetValueNames())
                    {
                        if (!name.StartsWith(dir + "\\", StringComparison.OrdinalIgnoreCase) || !name.EndsWith("|Blocklist", StringComparison.OrdinalIgnoreCase)) continue;
                        string file = k.GetValue(name) as string;
                        if (!string.IsNullOrEmpty(file)) files.Add(file);
                    }
                }
                foreach (string file in files)
                {
                    bool home = false;
                    foreach (string h in homes) if (!string.IsNullOrEmpty(h) && Paths.IsInside(file, h)) home = true;
                    if (!home) { log("  kept " + file + ": not in an engine data folder"); continue; }
                    if (File.Exists(file)) { File.Delete(file); log("  removed " + file); }
                }
            }
            catch (Exception e)
            {
                log("  blocklist file cleanup under HKCU\\" + keyPath + " failed: " + e.Message);
            }
        }

        public static void Remove(Plan plan, Action<string> log)
        {
            Remove(plan, log, Roots.Real());
        }

        public static void Remove(Plan plan, Action<string> log, Roots roots)
        {
            var hashes = new List<string>();
            foreach (string d in plan.Dirs)
            {
                string h = InstallHash(d);
                if (!hashes.Contains(h)) hashes.Add(h);
            }
            log("engine traces: folder spellings " + string.Join(" | ", plan.Dirs.ToArray()) + "; install hashes " + string.Join(", ", hashes.ToArray()) +
                "; " + roots.Describe());
            string realAppData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

            foreach (string[] id in plan.Ids)
            {
                string root = "Software\\" + id[0] + "\\" + id[1];
                // Where this identity's blocklist file may be: its compiled data folder under %APPDATA%
                // (and under the test stand-in).
                var homes = new List<string> { Path.Combine(Path.Combine(realAppData, id[0]), id[1]) };
                if (roots.AppData != null) homes.Add(Path.Combine(Path.Combine(roots.AppData, id[0]), id[1]));
                foreach (string dir in plan.Dirs)
                {
                    RemoveBlocklistFiles(root + "\\Launcher", dir, homes, log);
                    string inside = dir + "\\", piped = dir + "|";
                    Func<string, bool> underDir = delegate (string name) { return name.StartsWith(inside, StringComparison.OrdinalIgnoreCase); };
                    try
                    {
                        DeleteValues(root + "\\Launcher", underDir, log);
                        DeleteValues(root + "\\DllPrefetchExperiment", underDir, log);
                        DeleteValues(root + "\\PreXULSkeletonUISettings", underDir, log);
                        DeleteValues(root + "\\Default Browser Agent", delegate (string name) { return name.StartsWith(piped, StringComparison.OrdinalIgnoreCase); }, log);
                        DeleteValues(root + "\\TaskBarIDs", delegate (string name) { return string.Equals(name, dir, StringComparison.OrdinalIgnoreCase); }, log);
                    }
                    catch (Exception e)
                    {
                        log("  registry cleanup under HKCU\\" + root + " failed: " + e.Message);
                    }
                }
                foreach (string h in hashes)
                {
                    string key = root + "\\Installer\\" + h;
                    try
                    {
                        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(key))
                        {
                            if (k == null) continue;
                        }
                        Registry.CurrentUser.DeleteSubKeyTree(key, false);
                        log("  removed HKCU\\" + key);
                    }
                    catch (Exception e)
                    {
                        log("  could not remove HKCU\\" + key + ": " + e.Message);
                    }
                }
            }

            RemoveToastRegistration(plan, hashes, log);

            // Files named after the install hash under the identity's %APPDATA% folder (the launcher
            // process's third-party-module blocklist, the skeleton UI's lock): named after this install,
            // so removed from the real folder and the test stand-in alike.
            var appDatas = new List<string> { realAppData };
            if (roots.AppData != null && !Paths.Same(roots.AppData, realAppData)) appDatas.Add(roots.AppData);
            foreach (string appData in appDatas)
            {
                foreach (string[] id in plan.Ids)
                {
                    string folder = Path.Combine(Path.Combine(appData, id[0]), id[1]);
                    foreach (string h in hashes)
                    {
                        foreach (string f in new[] { "blocklist-" + h, "SkeletonUILock-" + h })
                        {
                            string path = Path.Combine(folder, f);
                            try { if (File.Exists(path)) { File.Delete(path); log("  removed " + path); } }
                            catch (Exception e) { log("  could not remove " + path + ": " + e.Message); }
                        }
                    }
                }
            }

            foreach (string root in new[] { UpdateRoot, DeerUpdateRoot })
            {
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), root);
                foreach (string h in hashes)
                {
                    try
                    {
                        string updates = Path.Combine(Path.Combine(data, "updates"), h);
                        if (Directory.Exists(updates)) { Directory.Delete(updates, true); log("  removed " + updates); }
                        foreach (string f in new[] { "UpdateLock-" + h, "profile_count_" + h + ".json" })
                        {
                            string path = Path.Combine(data, f);
                            if (File.Exists(path)) { File.Delete(path); log("  removed " + path); }
                        }
                    }
                    catch (Exception e)
                    {
                        log("  could not remove the engine's update data for " + h + ": " + e.Message);
                    }
                }
            }

            // A background task's throwaway profile, named after the install hash (Gecko's
            // "%sBackgroundTask-%s-%s" with the literal vendor "Mozilla", whatever the identity).
            var temps = new List<string> { Path.GetTempPath().TrimEnd('\\') };
            if (roots.Temp != null && !Paths.Same(roots.Temp, temps[0])) temps.Add(roots.Temp);
            foreach (string temp in temps)
            {
                foreach (string h in hashes)
                {
                    try
                    {
                        if (!Directory.Exists(temp)) continue;
                        foreach (string dir in Directory.GetDirectories(temp, "MozillaBackgroundTask-" + h + "-*"))
                        {
                            try { Directory.Delete(dir, true); log("  removed " + dir); }
                            catch (Exception e) { log("  could not remove " + dir + ": " + e.Message); }
                        }
                    }
                    catch (Exception e) { log("  background task folders in " + temp + ": " + e.Message); }
                }
            }

            // Deer's shared folders (every Deer engine of this account uses them): what a bare start of
            // this install left, stale skeleton UI locks, then whatever is empty.
            string appDeer = roots.AppData == null ? null : Path.Combine(roots.AppData, DeerVendor);
            string localDeer = roots.LocalAppData == null ? null : Path.Combine(roots.LocalAppData, DeerVendor);
            if (appDeer != null) RemoveBareStartProfiles(appDeer, localDeer, hashes, log);
            if (localDeer != null)
            {
                string skeleton = Path.Combine(localDeer, "EngineData");
                try
                {
                    if (Directory.Exists(skeleton))
                    {
                        foreach (string f in Directory.GetFiles(skeleton, "SkeletonUILock-*"))
                        {
                            try { File.Delete(f); log("  removed " + f); }
                            catch (Exception e) { log("  could not remove " + f + ": " + e.Message); }
                        }
                    }
                }
                catch (Exception e) { log("  skeleton UI locks in " + skeleton + ": " + e.Message); }
                PruneDir(skeleton, log);
                PruneDir(Path.Combine(localDeer, "Profiles"), log);
            }
            if (appDeer != null)
            {
                foreach (string[] id in plan.Ids)
                {
                    if (string.Equals(id[0], DeerVendor, StringComparison.OrdinalIgnoreCase)) PruneDir(Path.Combine(appDeer, id[1]), log);
                }
                PruneDir(Path.Combine(appDeer, "Profiles"), log);
                PruneDir(appDeer, log);
            }
            if (localDeer != null) PruneDir(localDeer, log); // only when empty: it holds Deer's real Profile
            if (roots.Temp != null) PruneDir(Path.Combine(roots.Temp, "deerapp-temp-files"), log);
            if (roots.Test && (roots.AppData == null || roots.LocalAppData == null || roots.Temp == null))
                log("  test install: shared folders without a stand-in (DEER_TEST_APPDATA / _LOCALAPPDATA / _TEMP) were not looked at");

            // Empty keys under Deer's own registry names, bottom up (Mozilla's are Firefox's as well).
            PruneTree("Software\\" + DeerVendor, log);
            string deerData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), DeerUpdateRoot);
            PruneDir(Path.Combine(deerData, "updates"), log);
            PruneDir(deerData, log);
        }

        // ---- what a bare start of engine\deer.exe leaves in %APPDATA%\Deer ----

        // An ini file as [section name, its lines] in order; the lines before the first section under "".
        static List<KeyValuePair<string, List<string>>> ReadSections(string path)
        {
            var list = new List<KeyValuePair<string, List<string>>>();
            var cur = new KeyValuePair<string, List<string>>("", new List<string>());
            list.Add(cur);
            foreach (string raw in File.ReadAllLines(path))
            {
                string line = raw.Trim();
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    cur = new KeyValuePair<string, List<string>>(line.Substring(1, line.Length - 2).Trim(), new List<string>());
                    list.Add(cur);
                }
                else cur.Value.Add(raw);
            }
            return list;
        }

        static string SectionValue(List<string> lines, string key)
        {
            foreach (string raw in lines)
            {
                int eq = raw.IndexOf('=');
                if (eq > 0 && string.Equals(raw.Substring(0, eq).Trim(), key, StringComparison.OrdinalIgnoreCase)) return raw.Substring(eq + 1).Trim();
            }
            return null;
        }

        static void WriteSections(string path, List<KeyValuePair<string, List<string>>> sections)
        {
            var sb = new StringBuilder();
            foreach (KeyValuePair<string, List<string>> s in sections)
            {
                if (s.Key.Length > 0) sb.Append('[').Append(s.Key).Append("]\r\n");
                foreach (string l in s.Value) sb.Append(l).Append("\r\n");
            }
            string tmp = path + ".deer-uninstall";
            File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
            File.Copy(tmp, path, true);
            File.Delete(tmp);
        }

        // Nothing but [General] (and blank lines) is left.
        static bool OnlyGeneral(List<KeyValuePair<string, List<string>>> sections)
        {
            foreach (KeyValuePair<string, List<string>> s in sections)
            {
                if (s.Key.Length == 0)
                {
                    foreach (string l in s.Value) if (l.Trim().Length > 0) return false;
                    continue;
                }
                if (!string.Equals(s.Key, "General", StringComparison.OrdinalIgnoreCase)) return false;
            }
            return true;
        }

        static bool IsHashSection(string name, string prefix, List<string> hashes)
        {
            foreach (string h in hashes) if (string.Equals(name, prefix + h, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        // installs.ini [<hash>] and profiles.ini [Install<hash>] of this install, and the profile such a
        // section names: Gecko made it on a bare start (Deer always passes -profile, and config.js refuses
        // a profile without the "vitre-profile" marker, so Deer never used it). Kept when it carries the
        // marker or another install's section names it. Profile<n> sections are numbered again from 0
        // (Gecko stops reading at the first gap).
        static void RemoveBareStartProfiles(string appDeer, string localDeer, List<string> hashes, Action<string> log)
        {
            string installs = Path.Combine(appDeer, "installs.ini");
            try
            {
                if (File.Exists(installs))
                {
                    var sections = ReadSections(installs);
                    int n = sections.RemoveAll(delegate (KeyValuePair<string, List<string>> s) { return IsHashSection(s.Key, "", hashes); });
                    if (n > 0)
                    {
                        bool empty = true;
                        foreach (KeyValuePair<string, List<string>> s in sections) if (s.Key.Length > 0) empty = false;
                        if (empty) { File.Delete(installs); log("  removed " + installs + " (it named only this install)"); }
                        else { WriteSections(installs, sections); log("  removed this install's section from " + installs); }
                    }
                }
            }
            catch (Exception e) { log("  could not clean " + installs + ": " + e.Message); }

            string profiles = Path.Combine(appDeer, "profiles.ini");
            try
            {
                if (!File.Exists(profiles)) return;
                var sections = ReadSections(profiles);
                var named = new List<string>();
                foreach (KeyValuePair<string, List<string>> s in sections)
                {
                    if (!IsHashSection(s.Key, "Install", hashes)) continue;
                    string def = SectionValue(s.Value, "Default");
                    if (!string.IsNullOrEmpty(def)) named.Add(def);
                }
                int removed = sections.RemoveAll(delegate (KeyValuePair<string, List<string>> s) { return IsHashSection(s.Key, "Install", hashes); });
                if (removed == 0) return;
                log("  removed this install's section from " + profiles);
                foreach (string def in named)
                {
                    bool stillNamed = false;
                    foreach (KeyValuePair<string, List<string>> s in sections)
                    {
                        if (s.Key.StartsWith("Install", StringComparison.OrdinalIgnoreCase) &&
                            string.Equals(SectionValue(s.Value, "Default"), def, StringComparison.OrdinalIgnoreCase)) stillNamed = true;
                    }
                    // Only a relative "Profiles/<name>" that Gecko made, one level down.
                    string rel = def.Replace('/', '\\');
                    string name = rel.StartsWith("Profiles\\", StringComparison.OrdinalIgnoreCase) ? rel.Substring(9) : null;
                    if (stillNamed || string.IsNullOrEmpty(name) || name.IndexOfAny(new[] { '\\', ':' }) >= 0 || name == "." || name == "..")
                    {
                        log("  kept the profile " + def + (stillNamed ? ": another install uses it" : ": not a profile Gecko made in Profiles"));
                        continue;
                    }
                    string roaming = Path.Combine(Path.Combine(appDeer, "Profiles"), name);
                    if (File.Exists(Path.Combine(roaming, "vitre-profile")))
                    {
                        log("  kept the profile " + roaming + ": Deer used it");
                        continue;
                    }
                    int at = sections.FindIndex(delegate (KeyValuePair<string, List<string>> s)
                    {
                        return s.Key.StartsWith("Profile", StringComparison.OrdinalIgnoreCase) && SectionValue(s.Value, "IsRelative") == "1" &&
                               string.Equals((SectionValue(s.Value, "Path") ?? "").Replace('/', '\\'), rel, StringComparison.OrdinalIgnoreCase);
                    });
                    if (at >= 0) sections.RemoveAt(at);
                    if (Directory.Exists(roaming)) { Directory.Delete(roaming, true); log("  removed " + roaming); }
                    if (localDeer != null)
                    {
                        string local = Path.Combine(Path.Combine(localDeer, "Profiles"), name);
                        if (Directory.Exists(local)) { Directory.Delete(local, true); log("  removed " + local); }
                    }
                }
                // Profile<n> again from 0, in their order.
                int next = 0;
                for (int i = 0; i < sections.Count; i++)
                {
                    string key = sections[i].Key;
                    int number;
                    if (key.StartsWith("Profile", StringComparison.OrdinalIgnoreCase) && int.TryParse(key.Substring(7), out number))
                        sections[i] = new KeyValuePair<string, List<string>>("Profile" + (next++).ToString(), sections[i].Value);
                }
                if (OnlyGeneral(sections)) { File.Delete(profiles); log("  removed " + profiles + " (nothing left in it)"); }
                else WriteSections(profiles, sections);
            }
            catch (Exception e) { log("  could not clean " + profiles + ": " + e.Message); }
        }

        // Deletes the empty keys under (and including) `path`, bottom up.
        static void PruneTree(string path, Action<string> log)
        {
            try
            {
                string[] subs;
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(path))
                {
                    if (k == null) return;
                    subs = k.GetSubKeyNames();
                }
                foreach (string sub in subs) PruneTree(path + "\\" + sub, log);
                PruneKey(path, log);
            }
            catch (Exception e)
            {
                log("  could not prune HKCU\\" + path + ": " + e.Message);
            }
        }

        static void PruneKey(string path, Action<string> log)
        {
            try
            {
                using (RegistryKey k = Registry.CurrentUser.OpenSubKey(path))
                {
                    if (k == null || k.SubKeyCount > 0 || k.ValueCount > 0) return;
                }
                Registry.CurrentUser.DeleteSubKey(path, false);
                log("  removed empty HKCU\\" + path);
            }
            catch (Exception e)
            {
                log("  could not remove HKCU\\" + path + ": " + e.Message);
            }
        }

        static void PruneDir(string dir, Action<string> log)
        {
            try
            {
                if (!Directory.Exists(dir) || Directory.GetFileSystemEntries(dir).Length > 0) return;
                Directory.Delete(dir);
                log("  removed empty " + dir);
            }
            catch (Exception e)
            {
                log("  could not remove " + dir + ": " + e.Message);
            }
        }
    }
}
