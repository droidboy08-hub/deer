// Deer-Setup.exe and Uninstall.exe: Deer's installer and uninstaller (one program).
// Built by installer\build.py with the .NET Framework 4.8 compiler (C# 5). Deer-Setup.exe carries the
// release folder as the embedded resource "payload.bin" (a Deer package, see Package.cs; + "payload.ini":
// version, size, SHA-256); Uninstall.exe is the same program compiled without a payload, copied into the
// install folder.
//
// Two kinds of install (as Vivaldi offers them):
//   just for me (default)  %LOCALAPPDATA%\Programs\Deer, HKCU, the person's own Start menu; no
//                          administrator permission
//   all users (/allusers)  %ProgramFiles%\Deer, HKLM, the common Start menu and desktop; setup starts
//                          itself again with administrator rights (UAC) once the person has chosen it
//                          (the wizard keeps its window and shows the elevated copy's progress), and so
//                          does the uninstaller of such an install. Deer's data stays per person
//                          (%LOCALAPPDATA%\Deer of each Windows account).
//
// Command line (case-insensitive; "/x" or "-x"; values as /name:value):
//   (none)                 install with the wizard (Uninstall.exe: uninstall with the wizard)
//   /S, /silent            no window at all; the exit code says what happened (below)
//   /allusers              install for all users (silent: asks for administrator permission when the
//                          process does not have it; run it from an elevated process to avoid the prompt)
//   /installdir:<dir>      where to install; default: the folder of an existing install, else
//                          %LOCALAPPDATA%\Programs\Deer (just for me) or %ProgramFiles%\Deer (all users)
//   /desktop, /nodesktop   desktop shortcut (wizard default: on; silent default: keep what an existing
//                          install had, else off)
//   /launch                start Deer when the install is done
//   /wait:<seconds>        if Deer is running, wait that long for it to close instead of refusing
//   /update                Deer's updater: silent; installs this version over the install in /installdir
//                          (default: the registered one, just-for-me first) and keeps everything else
//                          (folder, kind of install, desktop shortcut, the person's data). If Deer is
//                          running it waits for it to close (/wait, default 600 s), and starts it again
//                          afterwards (unless /norestart). With /launch it starts Deer afterwards in any
//                          case: what the updater's "restart to update" passes, since the browser may
//                          have quit before setup looked; that includes every way the update can stop
//                          early (another setup, a damaged or changed setup file, a newer version
//                          installed, not installed there for this mode, ...: Deer.exe of the install,
//                          when there is one and no Deer runs from it), but not exit 3 (Deer still
//                          running). Exit 10 when Deer is not installed, 6 when the installed version is
//                          newer; the same version is installed again (a repair), except right after
//                          waiting for another setup that installed it meanwhile. While another setup or
//                          uninstaller runs, /update waits for it (up to /wait) instead of exiting 9 at
//                          once. An all-users install asks for administrator permission (UAC) to update.
//   /sha256:<hex>          with /update (Deer's updater passes it): the SHA-256 Deer checked this setup
//                          file against. Setup hashes the file it runs from and refuses with exit 4
//                          when it differs; until setup ends that file stays open with read sharing
//                          only, so nothing can change, rename or replace it, and the elevated copy an
//                          all-users update starts from it (UAC) is the file Deer checked
//   /norestart             with /update: do not start Deer again afterwards
//   /allowdowngrade        install over a newer version
//   /uninstall             uninstall (what Uninstall.exe does without it)
//   /removedata            uninstall: also delete the data folder (default: keep it; for an all-users
//                          install: the data of the person who runs the uninstaller)
//   /log:<file>            append the log there (default %TEMP%\Deer-Setup.log / Deer-Uninstall.log)
// Test mode, for automated tests on a developer machine (never touches the real registrations):
//   /testkeys              every registry entry goes under HKCU\Software\DeerTest\... (all users:
//                          HKCU\Software\DeerTestMachine\..., standing in for HKLM\Software) instead of
//                          HKCU\Software\...; Explorer is not notified; Settings is never opened; the
//                          all-users step that needs administrator rights runs as a plain child process
//                          (the same code, no UAC prompt), since the test folders and keys need none
//   /shortcutdir:<dir>     test mode: "Start Menu\Programs" and "Desktop" are created under <dir>
//                          ("All Users\Start Menu\Programs" and "All Users\Desktop" for all users)
//                          (default %TEMP%\DeerTest\Shortcuts)
//   /datadir:<dir>         test mode: the data folder the uninstaller offers to delete, and the
//                          profile any Deer started by setup uses (<dir>\Profile); inside %TEMP%
//                          (default %TEMP%\DeerTest\Data)
//   environment            DEER_TEST_APPDATA, DEER_TEST_LOCALAPPDATA, DEER_TEST_TEMP (folders inside
//                          %TEMP%): what the uninstaller of a test install looks at in place of the
//                          person's %APPDATA%, %LOCALAPPDATA% and %TEMP% for Deer's shared engine folders
//                          (EngineTraces.cs; a folder without its stand-in is left alone), and
//                          DEER_TEST_LOCALAPPDATA what the installed Deer.exe of a test install uses for
//                          its default profile and the profile copy (Launcher.cs)
// Internal (between setup and its elevated copy): /elevated, /progress:<file>, /userdata:<dir>.
// The mode is recorded in <install>\install.ini, so the installed Uninstall.exe removes a test
// install from the test keys and test folders without being told again.
//
// Exit codes: 0 done, 1 bad arguments, 2 cancelled, 3 Deer is running, 4 payload missing or damaged,
// 5 failed (before the new files are swapped in, the previous state is restored; after that, when a
// shortcut or registry write fails, the files stay, the log says so, and running setup again completes
// the install), 6 a newer version is installed, 7 unsupported Windows, 8 the folder can't be used,
// 9 another setup is running, 10 Deer is not installed, 11 administrator permission was refused or is
// missing (all users).
// The log's last line is "RESULT <code>".
//
// What an install writes (just for me: HKCU; all users: HKLM; test mode: the same under the test roots):
//   files    <install>\Deer.exe, Uninstall.exe, release.ini, deer-version.json, LICENSE.txt,
//            THIRD-PARTY-NOTICES.txt, engine\..., install.ini (the record)
// What the uninstaller removes besides: those files, links and keys (only the ones that point at this
// install), the data folder with /removedata, and the engine's own traces of this install outside its
// folder (EngineTraces.cs: registry values and keys named after the engine folder or its install hash,
// %ProgramData%, %TEMP%, and Deer's shared engine folders once empty).
//   links    Start menu "Deer.lnk" (AppUserModelID Deer.Browser); desktop "Deer.lnk" if chosen
//   <hive>\Software\Microsoft\Windows\CurrentVersion\Uninstall\Deer      Apps & features entry
//   <hive>\Software\Clients\StartMenuInternet\Deer (+ Capabilities)     browser registration
//   <hive>\Software\RegisteredApplications : Deer                        -> the Capabilities key
//   <hive>\Software\Classes\DeerHTML, DeerPDF, DeerURL                   ProgIDs: Deer.exe -osint -url "%1"
//   <hive>\Software\Classes\<.ext>\OpenWithProgids : DeerHTML / DeerPDF  "Open with" entries
//   <hive>\Software\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe  "deer" in Run / Start
// Windows decides the default browser itself: setup offers ms-settings:defaultapps at the end.
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Deer.Setup
{
    static class Exit
    {
        public const int Ok = 0, BadArguments = 1, Cancelled = 2, DeerRunning = 3, PayloadBad = 4, Failed = 5,
            Downgrade = 6, Unsupported = 7, FolderNotUsable = 8, SetupRunning = 9, NotInstalled = 10, NeedsAdmin = 11;
    }

    class SetupException : Exception
    {
        public readonly int Code;
        // The new files are in place and a later step (record, shortcuts, registration) failed: nothing
        // was rolled back, and running setup again completes the install.
        public bool FilesInPlace;
        public SetupException(int code, string message) : base(message) { Code = code; }
    }

    // ---- log ----------------------------------------------------------------------------------------

    static class Log
    {
        static readonly object Gate = new object();
        static string file;

        public static string File { get { return file; } }

        public static void Open(string requested, string defaultName)
        {
            try
            {
                if (!string.IsNullOrEmpty(requested))
                {
                    file = Paths.Full(requested);
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                }
                else
                {
                    file = Path.Combine(Path.GetTempPath(), defaultName);
                    System.IO.File.WriteAllText(file, "");
                }
            }
            catch (Exception)
            {
                file = null;
            }
        }

        public static void Line(string text)
        {
            lock (Gate)
            {
                if (file == null) return;
                // An elevated copy of setup may append to the same file: retry briefly on a sharing clash.
                for (int i = 0; i < 20; i++)
                {
                    try
                    {
                        System.IO.File.AppendAllText(file, DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + text + Environment.NewLine);
                        return;
                    }
                    catch (IOException) { Thread.Sleep(15); }
                    catch (Exception) { return; }
                }
            }
        }
    }

    // ---- options ------------------------------------------------------------------------------------

    class Options
    {
        public bool Silent, Uninstall, Launch, TestKeys, RemoveData, AllowDowngrade, AllUsers, Update, NoRestart, Elevated;
        public bool? Desktop;
        public string InstallDir, ShortcutDir, DataDir, LogFile, ProgressFile, UserData, Sha256;
        public int WaitSeconds = -1; // -1: not given

        static readonly string[] WithValue = { "installdir", "shortcutdir", "datadir", "log", "progress", "userdata", "sha256" };

        public static Options Parse(string[] args, out string error)
        {
            var o = new Options();
            error = null;
            foreach (string raw in args)
            {
                string a = raw.Trim();
                if (a.Length < 2 || (a[0] != '/' && a[0] != '-'))
                {
                    error = "Unknown argument: " + raw;
                    return null;
                }
                string body = a.TrimStart('/', '-');
                string name = body, value = null;
                int colon = body.IndexOf(':');
                if (colon > 0) { name = body.Substring(0, colon); value = body.Substring(colon + 1).Trim('"'); }
                string key = name.ToLowerInvariant();
                switch (key)
                {
                    case "s": case "silent": o.Silent = true; break;
                    case "uninstall": o.Uninstall = true; break;
                    case "launch": o.Launch = true; break;
                    case "testkeys": o.TestKeys = true; break;
                    case "removedata": o.RemoveData = true; break;
                    case "allowdowngrade": o.AllowDowngrade = true; break;
                    case "allusers": o.AllUsers = true; break;
                    case "update": o.Update = true; o.Silent = true; break;
                    case "norestart": o.NoRestart = true; break;
                    case "elevated": o.Elevated = true; break;
                    case "desktop": o.Desktop = true; break;
                    case "nodesktop": o.Desktop = false; break;
                    case "installdir": o.InstallDir = value; break;
                    case "shortcutdir": o.ShortcutDir = value; break;
                    case "datadir": o.DataDir = value; break;
                    case "log": o.LogFile = value; break;
                    case "progress": o.ProgressFile = value; break;
                    case "userdata": o.UserData = value; break;
                    case "sha256":
                        if (value == null || !Regex.IsMatch(value, "^[0-9a-fA-F]{64}$")) { error = "Bad /sha256 value: " + raw; return null; }
                        o.Sha256 = value.ToLowerInvariant();
                        break;
                    case "wait":
                        if (!int.TryParse(value, out o.WaitSeconds) || o.WaitSeconds < 0) { error = "Bad /wait value: " + raw; return null; }
                        break;
                    default:
                        error = "Unknown argument: " + raw;
                        return null;
                }
                if (Array.IndexOf(WithValue, key) >= 0 && string.IsNullOrEmpty(value))
                {
                    error = "Missing value: " + raw;
                    return null;
                }
            }
            if (!o.TestKeys && (o.ShortcutDir != null || o.DataDir != null))
            {
                error = "/shortcutdir and /datadir are test options: use them with /testkeys.";
                return null;
            }
            if ((o.ProgressFile != null || o.UserData != null) && !o.Elevated)
            {
                error = "/progress and /userdata are used only between setup and its elevated copy.";
                return null;
            }
            if (o.Update && o.Uninstall)
            {
                error = "/update and /uninstall exclude each other.";
                return null;
            }
            if (o.Sha256 != null && !o.Update)
            {
                error = "/sha256 is used with /update.";
                return null;
            }
            return o;
        }
    }

    // ---- payload ------------------------------------------------------------------------------------

    static class Payload
    {
        static Dictionary<string, string> info;
        static bool loaded;

        static Dictionary<string, string> Info
        {
            get
            {
                if (loaded) return info;
                loaded = true;
                using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.ini"))
                {
                    if (s == null) return null;
                    using (var r = new StreamReader(s, Encoding.UTF8)) info = Ini.Parse(r.ReadToEnd());
                }
                return info;
            }
        }

        public static bool Present
        {
            get
            {
                if (Info == null) return false;
                using (Stream s = Open()) return s != null;
            }
        }

        public static string Get(string key)
        {
            string v;
            return Info != null && Info.TryGetValue(key, out v) ? v : "";
        }

        public static long GetLong(string key)
        {
            long v;
            return long.TryParse(Get(key), out v) ? v : 0;
        }

        // A new stream over the package each time (one per decoding thread); the image is mapped, so
        // this reads straight from the file.
        public static Stream Open()
        {
            return Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.bin");
        }
    }

    // ---- small ini files ------------------------------------------------------------------------------

    static class Ini
    {
        public static Dictionary<string, string> Parse(string text)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (string raw in text.Split('\n'))
            {
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '[' || line[0] == '#') continue;
                int eq = line.IndexOf('=');
                if (eq > 0) d[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return d;
        }

        public static Dictionary<string, string> Read(string path)
        {
            try { return System.IO.File.Exists(path) ? Parse(System.IO.File.ReadAllText(path)) : null; }
            catch (Exception) { return null; }
        }
    }

    // ---- the install record (<install>\install.ini) ---------------------------------------------------

    class InstallRecord
    {
        public const string FileName = "install.ini";
        public string Version = "", Build = "", Mode = "user", RegistryRoot = "Software", StartMenuShortcut = "", DesktopShortcut = "", DataDir = "";
        public bool Machine; // installed for all users
        public List<string> Files = new List<string>();

        public bool IsTest { get { return Mode == "test"; } }

        public static InstallRecord Read(string installDir)
        {
            if (string.IsNullOrEmpty(installDir)) return null;
            Dictionary<string, string> d;
            try { d = Ini.Read(Path.Combine(installDir, FileName)); }
            catch (Exception) { return null; }
            if (d == null) return null;
            var r = new InstallRecord();
            string v;
            if (d.TryGetValue("Version", out v)) r.Version = v;
            if (d.TryGetValue("Build", out v)) r.Build = v;
            if (d.TryGetValue("Mode", out v)) r.Mode = v == "test" ? "test" : "user";
            if (d.TryGetValue("Scope", out v)) r.Machine = v == "machine";
            if (d.TryGetValue("StartMenuShortcut", out v)) r.StartMenuShortcut = v;
            if (d.TryGetValue("DesktopShortcut", out v)) r.DesktopShortcut = v;
            if (d.TryGetValue("DataDir", out v)) r.DataDir = v;
            if (d.TryGetValue("Files", out v))
            {
                foreach (string f in v.Split('|'))
                    if (Target.IsPlainName(f)) r.Files.Add(f);
            }
            // The registry root is one of the known values, whatever the file says.
            r.RegistryRoot = Target.RootFor(r.IsTest, r.Machine);
            return r;
        }

        public void Write(string installDir)
        {
            var sb = new StringBuilder();
            sb.Append("; Written by Deer Setup. The uninstaller reads it: do not edit.\r\n[Deer]\r\n");
            sb.Append("Version=").Append(Version).Append("\r\n");
            sb.Append("Build=").Append(Build).Append("\r\n");
            sb.Append("Mode=").Append(Mode).Append("\r\n");
            sb.Append("Scope=").Append(Machine ? "machine" : "user").Append("\r\n");
            sb.Append("RegistryRoot=").Append(RegistryRoot).Append("\r\n");
            sb.Append("StartMenuShortcut=").Append(StartMenuShortcut).Append("\r\n");
            sb.Append("DesktopShortcut=").Append(DesktopShortcut).Append("\r\n");
            sb.Append("DataDir=").Append(DataDir).Append("\r\n");
            sb.Append("Files=").Append(string.Join("|", Files.ToArray())).Append("\r\n");
            sb.Append("InstalledOn=").Append(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)).Append("\r\n");
            string path = Path.Combine(installDir, FileName);
            string tmp = path + ".tmp";
            System.IO.File.WriteAllText(tmp, sb.ToString(), new UTF8Encoding(false));
            if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
            System.IO.File.Move(tmp, path);
        }
    }

    // ---- where everything goes ----------------------------------------------------------------------

    class Target
    {
        public const string RealRoot = "Software";
        public const string TestRoot = @"Software\DeerTest";
        public const string TestMachineRoot = @"Software\DeerTestMachine"; // stands in for HKLM\Software in test mode
        public const string AppUserModelId = "Deer.Browser";
        public const string AppName = "Deer";

        public bool Test, Machine;
        public string RegRoot, InstallDir, StartMenuLnk, DesktopLnk, DataDir;

        public string Exe { get { return Path.Combine(InstallDir, "Deer.exe"); } }
        public string Uninstaller { get { return Path.Combine(InstallDir, "Uninstall.exe"); } }
        public string EngineDir { get { return Path.Combine(InstallDir, "engine"); } }

        // HKLM (64-bit view: Deer is a 64-bit program) for a real all-users install, else HKCU.
        public RegistryKey Hive { get { return HiveFor(Test, Machine); } }
        public string HiveName { get { return Machine && !Test ? "HKLM" : "HKCU"; } }
        public string ScopeText { get { return Machine ? "all users" : "just for me"; } }

        static RegistryKey machineHive;

        public static RegistryKey HiveFor(bool test, bool machine)
        {
            if (!machine || test) return Registry.CurrentUser;
            return machineHive ?? (machineHive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64));
        }

        public static string RootFor(bool test, bool machine)
        {
            return test ? (machine ? TestMachineRoot : TestRoot) : RealRoot;
        }

        public static bool IsPlainName(string name)
        {
            return !string.IsNullOrEmpty(name) && name.IndexOfAny(new[] { '\\', '/', ':' }) < 0 && name != "." && name != ".." &&
                   name.IndexOfAny(Path.GetInvalidFileNameChars()) < 0;
        }

        static string TestBase { get { return Path.Combine(Path.GetTempPath(), "DeerTest"); } }

        // C:\Program Files (the 64-bit one, also from a 32-bit process).
        public static string ProgramFiles
        {
            get
            {
                string p = Environment.GetEnvironmentVariable("ProgramW6432");
                return string.IsNullOrEmpty(p) ? Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) : p;
            }
        }

        public static string DefaultInstallDir(bool test, bool machine)
        {
            if (test) return Path.Combine(TestBase, machine ? @"ProgramFiles\Deer" : @"Programs\Deer");
            if (machine) return Path.Combine(ProgramFiles, "Deer");
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Deer");
        }

        public static string RealDataDir
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Deer"); }
        }

        // Test data must live under %TEMP%: the uninstaller may delete it.
        public static bool IsUsableTestDataDir(string dir)
        {
            return !string.IsNullOrEmpty(dir) && Paths.IsInside(dir, Path.GetTempPath());
        }

        // A person's Deer data folder as the uninstaller of an all-users install is told it by the
        // unelevated copy that started it (/userdata): "<drive>:\...\AppData\Local\Deer", nothing else.
        public static bool IsUserDataDir(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Installer.IsAbsoluteLocal(dir)) return false;
            string full;
            try { full = Paths.Full(dir); }
            catch (Exception) { return false; }
            return full.EndsWith(@"\AppData\Local\Deer", StringComparison.OrdinalIgnoreCase) && full.IndexOf(@"\..\", StringComparison.Ordinal) < 0;
        }

        // The InstallLocation of the registered install of this kind, when its record is still there.
        public static string RegisteredInstallDir(bool test, bool machine)
        {
            try
            {
                using (RegistryKey k = HiveFor(test, machine).OpenSubKey(RootFor(test, machine) + Registration.UninstallKey))
                {
                    if (k == null) return null;
                    string dir = k.GetValue("InstallLocation") as string;
                    if (string.IsNullOrEmpty(dir)) return null;
                    return System.IO.File.Exists(Path.Combine(dir, InstallRecord.FileName)) ? dir : null;
                }
            }
            catch (Exception) { return null; }
        }

        public static Target For(bool test, bool machine, string installDir, string shortcutDir, string dataDir)
        {
            var t = new Target();
            t.Test = test;
            t.Machine = machine;
            t.RegRoot = RootFor(test, machine);
            t.InstallDir = Paths.Full(installDir);
            if (test)
            {
                string links = Paths.Full(string.IsNullOrEmpty(shortcutDir) ? Path.Combine(TestBase, "Shortcuts") : shortcutDir);
                if (machine) links = Path.Combine(links, "All Users");
                t.StartMenuLnk = Path.Combine(links, @"Start Menu\Programs\Deer.lnk");
                t.DesktopLnk = Path.Combine(links, @"Desktop\Deer.lnk");
                t.DataDir = Paths.Full(string.IsNullOrEmpty(dataDir) ? Path.Combine(TestBase, "Data") : dataDir);
            }
            else
            {
                t.StartMenuLnk = Path.Combine(Environment.GetFolderPath(machine ? Environment.SpecialFolder.CommonPrograms : Environment.SpecialFolder.Programs), "Deer.lnk");
                t.DesktopLnk = Path.Combine(Environment.GetFolderPath(machine ? Environment.SpecialFolder.CommonDesktopDirectory : Environment.SpecialFolder.DesktopDirectory), "Deer.lnk");
                t.DataDir = RealDataDir;
            }
            return t;
        }

        // The install's own record decides its test folders (an update or uninstall is not told again).
        public void UseRecord(InstallRecord rec)
        {
            if (rec == null || !Test) return;
            if (!string.IsNullOrEmpty(rec.StartMenuShortcut)) StartMenuLnk = rec.StartMenuShortcut;
            if (!string.IsNullOrEmpty(rec.DesktopShortcut)) DesktopLnk = rec.DesktopShortcut;
            DataDir = IsUsableTestDataDir(rec.DataDir) ? Paths.Full(rec.DataDir) : "";
        }

        // Arguments every shortcut and every Deer started by setup carries: none for real installs; a
        // test install's Deer always runs on the test profile, never on %LOCALAPPDATA%\Deer.
        public string LaunchArguments
        {
            get { return Test ? "-profile \"" + Path.Combine(DataDir, "Profile") + "\"" : ""; }
        }
    }

    // ---- registry ---------------------------------------------------------------------------------------

    class Registration
    {
        public const string UninstallKey = @"\Microsoft\Windows\CurrentVersion\Uninstall\Deer";
        const string ClientKey = @"\Clients\StartMenuInternet\Deer";
        const string AppPathKey = @"\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe";
        const string Description = "Deer is a web browser for Windows.";

        // File types: the set Firefox registers. Schemes: the two a browser must own.
        public static readonly string[] HtmlTypes = { ".htm", ".html", ".shtml", ".xht", ".xhtml", ".svg", ".webp", ".avif" };
        public static readonly string[] PdfTypes = { ".pdf" };
        public static readonly string[] Schemes = { "http", "https" };
        public static readonly string[] ProgIds = { "DeerHTML", "DeerPDF", "DeerURL" };

        readonly Target t;
        readonly RegistryKey hive;
        public Registration(Target target) { t = target; hive = target.Hive; }

        string Root(string sub) { return t.RegRoot + sub; }

        RegistryKey Create(string path) { return hive.CreateSubKey(path); }

        string OpenCommand { get { return "\"" + t.Exe + "\" -osint -url \"%1\""; } }
        string Icon { get { return t.Exe + ",0"; } }

        void WriteProgId(string progId, string typeName, bool isUrl)
        {
            string key = Root(@"\Classes\" + progId);
            using (RegistryKey k = Create(key))
            {
                k.SetValue("", typeName);
                k.SetValue("FriendlyTypeName", typeName);
                k.SetValue("AppUserModelId", Target.AppUserModelId);
                if (isUrl)
                {
                    k.SetValue("URL Protocol", "");
                    k.SetValue("EditFlags", 2, RegistryValueKind.DWord);
                }
            }
            using (RegistryKey k = Create(key + @"\Application"))
            {
                k.SetValue("AppUserModelId", Target.AppUserModelId);
                k.SetValue("ApplicationIcon", Icon);
                k.SetValue("ApplicationName", Target.AppName);
                k.SetValue("ApplicationDescription", Description);
                k.SetValue("ApplicationCompany", BuildInfo.Publisher);
            }
            using (RegistryKey k = Create(key + @"\DefaultIcon")) k.SetValue("", Icon);
            using (RegistryKey k = Create(key + @"\shell\open\command")) k.SetValue("", OpenCommand);
        }

        public void Write(long sizeBytes)
        {
            WriteProgId("DeerHTML", "Deer HTML Document", false);
            WriteProgId("DeerPDF", "Deer PDF Document", false);
            WriteProgId("DeerURL", "Deer URL", true);
            foreach (string ext in HtmlTypes)
                using (RegistryKey k = Create(Root(@"\Classes\" + ext + @"\OpenWithProgids"))) k.SetValue("DeerHTML", new byte[0], RegistryValueKind.None);
            foreach (string ext in PdfTypes)
                using (RegistryKey k = Create(Root(@"\Classes\" + ext + @"\OpenWithProgids"))) k.SetValue("DeerPDF", new byte[0], RegistryValueKind.None);

            string client = Root(ClientKey);
            using (RegistryKey k = Create(client)) k.SetValue("", Target.AppName);
            using (RegistryKey k = Create(client + @"\DefaultIcon")) k.SetValue("", Icon);
            using (RegistryKey k = Create(client + @"\shell\open\command")) k.SetValue("", "\"" + t.Exe + "\"");
            using (RegistryKey k = Create(client + @"\Capabilities"))
            {
                k.SetValue("ApplicationName", Target.AppName);
                k.SetValue("ApplicationDescription", Description);
                k.SetValue("ApplicationIcon", Icon);
            }
            using (RegistryKey k = Create(client + @"\Capabilities\StartMenu")) k.SetValue("StartMenuInternet", Target.AppName);
            using (RegistryKey k = Create(client + @"\Capabilities\FileAssociations"))
            {
                foreach (string ext in HtmlTypes) k.SetValue(ext, "DeerHTML");
                foreach (string ext in PdfTypes) k.SetValue(ext, "DeerPDF");
            }
            using (RegistryKey k = Create(client + @"\Capabilities\URLAssociations"))
                foreach (string s in Schemes) k.SetValue(s, "DeerURL");
            using (RegistryKey k = Create(Root(@"\RegisteredApplications")))
                k.SetValue(Target.AppName, t.RegRoot + ClientKey + @"\Capabilities");

            using (RegistryKey k = Create(Root(AppPathKey)))
            {
                k.SetValue("", t.Exe);
                k.SetValue("Path", t.InstallDir);
            }

            Version v;
            if (!System.Version.TryParse(BuildInfo.Version, out v)) v = new Version(0, 0);
            using (RegistryKey k = Create(Root(UninstallKey)))
            {
                k.SetValue("DisplayName", Target.AppName);
                k.SetValue("DisplayVersion", BuildInfo.Version);
                k.SetValue("Publisher", BuildInfo.Publisher);
                k.SetValue("DisplayIcon", Icon);
                k.SetValue("InstallLocation", t.InstallDir);
                k.SetValue("UninstallString", "\"" + t.Uninstaller + "\"");
                k.SetValue("QuietUninstallString", "\"" + t.Uninstaller + "\" /S");
                k.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, sizeBytes / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                k.SetValue("VersionMajor", v.Major, RegistryValueKind.DWord);
                k.SetValue("VersionMinor", v.Minor, RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("Comments", Description);
                if (!string.IsNullOrEmpty(BuildInfo.Url))
                {
                    k.SetValue("URLInfoAbout", BuildInfo.Url);
                    k.SetValue("HelpLink", BuildInfo.Url);
                    k.SetValue("URLUpdateInfo", BuildInfo.Url + "/releases");
                }
            }
        }

        // ---- removal: only what points at this install ----

        string DefaultValue(string path)
        {
            using (RegistryKey k = hive.OpenSubKey(path))
                return k == null ? null : k.GetValue("") as string;
        }

        bool PointsHere(string commandOrPath)
        {
            return commandOrPath != null && commandOrPath.IndexOf(t.InstallDir + "\\", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        bool Exists(string path)
        {
            using (RegistryKey k = hive.OpenSubKey(path)) return k != null;
        }

        void DeleteTree(string path, Action<string> log)
        {
            if (!Exists(path)) return;
            hive.DeleteSubKeyTree(path, false);
            log("  removed " + t.HiveName + "\\" + path);
        }

        void DeleteValue(string keyPath, string name, Action<string> log)
        {
            using (RegistryKey k = hive.OpenSubKey(keyPath, true))
            {
                if (k == null || Array.IndexOf(k.GetValueNames(), name) < 0) return;
                k.DeleteValue(name, false);
                log("  removed " + t.HiveName + "\\" + keyPath + " : " + name);
            }
        }

        // Deletes `path` and then its parents up to (not including) `stop` while they are empty.
        void PruneEmpty(string path, string stop, Action<string> log)
        {
            while (path.Length > stop.Length && path.StartsWith(stop + "\\", StringComparison.OrdinalIgnoreCase))
            {
                using (RegistryKey k = hive.OpenSubKey(path))
                {
                    if (k == null) { path = path.Substring(0, path.LastIndexOf('\\')); continue; }
                    if (k.SubKeyCount > 0 || k.ValueCount > 0) return;
                }
                hive.DeleteSubKey(path, false);
                log("  removed empty " + t.HiveName + "\\" + path);
                path = path.Substring(0, path.LastIndexOf('\\'));
            }
        }

        public void Remove(Action<string> log)
        {
            string client = Root(ClientKey);
            bool ours = !Exists(client) || PointsHere(DefaultValue(client + @"\shell\open\command"));
            if (ours)
            {
                DeleteTree(client, log);
                DeleteValue(Root(@"\RegisteredApplications"), Target.AppName, log);
            }
            else log("  kept " + t.HiveName + "\\" + client + ": it belongs to another Deer install");

            foreach (string progId in ProgIds)
            {
                string key = Root(@"\Classes\" + progId);
                if (!Exists(key)) continue;
                if (PointsHere(DefaultValue(key + @"\shell\open\command"))) DeleteTree(key, log);
                else log("  kept " + t.HiveName + "\\" + key + ": it belongs to another Deer install");
            }
            var types = new List<string>(HtmlTypes);
            types.AddRange(PdfTypes);
            foreach (string ext in types)
            {
                string key = Root(@"\Classes\" + ext + @"\OpenWithProgids");
                foreach (string progId in new[] { "DeerHTML", "DeerPDF" })
                {
                    if (Exists(Root(@"\Classes\" + progId))) continue; // still registered by another install
                    DeleteValue(key, progId, log);
                }
                PruneEmpty(key, Root(@"\Classes"), log);
            }
            // Windows' own "Open with > Choose another app" entry for Deer.exe, if the user made one.
            string apps = Root(@"\Classes\Applications\Deer.exe");
            if (PointsHere(DefaultValue(apps + @"\shell\open\command"))) DeleteTree(apps, log);

            if (PointsHere(DefaultValue(Root(AppPathKey)))) DeleteTree(Root(AppPathKey), log);

            bool entryOurs = false;
            using (RegistryKey k = hive.OpenSubKey(Root(UninstallKey)))
            {
                if (k != null)
                {
                    string loc = k.GetValue("InstallLocation") as string;
                    entryOurs = Paths.Same(loc, t.InstallDir);
                    if (!entryOurs) log("  kept " + t.HiveName + "\\" + Root(UninstallKey) + ": it belongs to the install in " + loc);
                }
            }
            if (entryOurs) DeleteTree(Root(UninstallKey), log);

            if (t.Test)
            {
                // The whole test root is Deer's: prune every key the install left empty, then the root.
                PruneTree(t.RegRoot, log);
            }
        }

        bool PruneTree(string path, Action<string> log)
        {
            using (RegistryKey k = hive.OpenSubKey(path))
            {
                if (k == null) return true;
                foreach (string sub in k.GetSubKeyNames()) PruneTree(path + "\\" + sub, log);
            }
            using (RegistryKey k = hive.OpenSubKey(path))
            {
                if (k.SubKeyCount > 0 || k.ValueCount > 0) return false;
            }
            hive.DeleteSubKey(path, false);
            log("  removed empty " + t.HiveName + "\\" + path);
            return true;
        }
    }

    // ---- file operations with retries (antivirus and the search indexer hold new files briefly) ---------

    static class Fs
    {
        public static bool Exists(string path) { return File.Exists(path) || Directory.Exists(path); }

        static void Retry(Action action)
        {
            for (int i = 0; ; i++)
            {
                try { action(); return; }
                catch (IOException) { if (i >= 20) throw; }
                catch (UnauthorizedAccessException) { if (i >= 20) throw; }
                Thread.Sleep(250);
            }
        }

        public static void Move(string from, string to)
        {
            Retry(delegate
            {
                if (Directory.Exists(from)) Directory.Move(from, to);
                else File.Move(from, to);
            });
        }

        static void ClearReadOnly(string path)
        {
            try
            {
                if (File.Exists(path)) { File.SetAttributes(path, FileAttributes.Normal); return; }
                foreach (string f in Directory.GetFiles(path, "*", SearchOption.AllDirectories))
                {
                    if ((File.GetAttributes(f) & FileAttributes.ReadOnly) != 0) File.SetAttributes(f, FileAttributes.Normal);
                }
            }
            catch (Exception) { }
        }

        public static void Delete(string path)
        {
            if (!Exists(path)) return;
            bool cleared = false;
            Retry(delegate
            {
                try
                {
                    if (Directory.Exists(path)) Directory.Delete(path, true);
                    else if (File.Exists(path)) File.Delete(path);
                }
                catch (UnauthorizedAccessException)
                {
                    if (cleared) throw;
                    cleared = true;
                    ClearReadOnly(path);
                    throw;
                }
            });
        }

        public static bool IsEmptyDir(string dir)
        {
            return Directory.Exists(dir) && Directory.GetFileSystemEntries(dir).Length == 0;
        }
    }

    // ---- install ------------------------------------------------------------------------------------------

    static class Installer
    {
        public const string Staging = ".deer-new";
        public const string Old = ".deer-old";
        // Decoding threads: blocks are 16 MB, so each thread holds about 20 MB at a time.
        static int Threads { get { return Math.Max(1, Math.Min(Environment.ProcessorCount, 6)); } }

        public static string PayloadVersion { get { return Payload.Get("Version"); } }

        public static int CompareVersions(string a, string b)
        {
            Version va, vb;
            if (System.Version.TryParse(a, out va) && System.Version.TryParse(b, out vb)) return va.CompareTo(vb);
            return string.CompareOrdinal(a, b);
        }

        // A full local path ("C:\..."): a relative one would be resolved against whatever the current
        // directory happens to be.
        public static bool IsAbsoluteLocal(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return false;
            string d = Environment.ExpandEnvironmentVariables(dir.Trim().Trim('"'));
            return d.Length >= 3 && char.IsLetter(d[0]) && d[1] == ':' && (d[2] == '\\' || d[2] == '/');
        }

        // Why `t.InstallDir` cannot hold Deer (null when it can): a new or empty folder, or an existing
        // Deer install of the same kind.
        public static string FolderProblem(Target t)
        {
            string dir = t.InstallDir;
            if (!IsAbsoluteLocal(dir)) return "Enter the full path of a folder, for example " + Target.DefaultInstallDir(false, t.Machine) + ".";
            string full;
            try { full = Paths.Full(dir); }
            catch (Exception) { return "This is not a valid folder path."; }
            if (string.Equals(Path.GetPathRoot(full).TrimEnd('\\'), full, StringComparison.OrdinalIgnoreCase))
                return "Deer can't be installed at the root of a drive. Choose a folder.";
            if (full.StartsWith(@"\\")) return "Deer must be installed on a local drive.";
            // An install every account runs must sit where only administrators can change it.
            if (t.Machine && !t.Test && !Paths.IsInside(full, Target.ProgramFiles))
                return "When Deer is installed for all users, it goes into a folder inside " + Target.ProgramFiles +
                       ", which only administrators can change. For example " + Target.DefaultInstallDir(false, true) + ".";
            // This program runs with the .NET Framework's classic path limits (folders under 248
            // characters, files under 260), and so does much of Windows: the deepest file of the
            // package, inside the staging folder, must fit.
            long deepest = Payload.GetLong("LongestPath");
            if (deepest <= 0) deepest = 80;
            if (full.Length + 1 + Staging.Length + 1 + deepest >= 248)
                return "This folder path is too long. Choose a shorter one, for example " + Target.DefaultInstallDir(false, t.Machine) + ".";
            if (File.Exists(full)) return "A file with this name already exists.";
            string registered = Target.RegisteredInstallDir(t.Test, t.Machine);
            if (registered != null && !Paths.Same(registered, full))
                return "Deer is already installed " + (t.Machine ? "for all users" : "for your account") + " in " + registered + ". Uninstall it first, or update it there.";
            if (!Directory.Exists(full)) return null;
            if (File.Exists(Path.Combine(full, InstallRecord.FileName))) return null;
            foreach (string e in Directory.GetFileSystemEntries(full))
            {
                string name = Path.GetFileName(e);
                if (name != Staging && name != Old) return "This folder is not empty. Choose an empty folder or a new one.";
            }
            return null;
        }

        static HashAlgorithm NewSha256()
        {
            try { return new SHA256Cng(); } // much faster than SHA256Managed on .NET Framework
            catch (Exception) { return SHA256.Create(); }
        }

        public static void VerifyPayload(Action<string, double> report)
        {
            report("Checking the package", 0);
            string expected = Payload.Get("Sha256").ToLowerInvariant();
            using (Stream s = Payload.Open())
            using (HashAlgorithm sha = NewSha256())
            {
                if (s == null) throw new SetupException(Exit.PayloadBad, "This setup program does not contain Deer. Download it again.");
                var buf = new byte[1 << 20];
                long done = 0, total = Math.Max(1, s.Length);
                int n;
                while ((n = s.Read(buf, 0, buf.Length)) > 0)
                {
                    sha.TransformBlock(buf, 0, n, null, 0);
                    done += n;
                    report(null, 0.05 * done / total);
                }
                sha.TransformFinalBlock(buf, 0, 0);
                string actual = BitConverter.ToString(sha.Hash).Replace("-", "").ToLowerInvariant();
                if (actual != expected)
                    throw new SetupException(Exit.PayloadBad, "This setup program is damaged (checksum mismatch). Download it again.");
            }
        }

        static void Extract(string staging, Action<string, double> report)
        {
            report("Copying files", 0.05);
            try
            {
                Package p;
                using (Stream s = Payload.Open()) p = Package.Read(s);
                double total = Math.Max(1, p.TotalUnpacked);
                p.Extract(Payload.Open, staging, Threads, delegate (long done) { report(null, 0.05 + 0.80 * done / total); });
            }
            catch (InvalidDataException e)
            {
                throw new SetupException(Exit.PayloadBad, "This setup program is damaged (" + e.Message + "). Download it again.");
            }
        }

        static List<string> TopLevel(string dir)
        {
            var names = new List<string>();
            foreach (string e in Directory.GetFileSystemEntries(dir)) names.Add(Path.GetFileName(e));
            names.Sort(StringComparer.OrdinalIgnoreCase);
            return names;
        }

        // Puts the staged files in place. Everything that was there is moved aside first, so a failure
        // at any point puts the previous install back as it was.
        static void Commit(string installDir, List<string> incoming, List<string> previous, Action<string> log)
        {
            string staging = Path.Combine(installDir, Staging), old = Path.Combine(installDir, Old);
            Fs.Delete(old);
            Directory.CreateDirectory(old);
            var aside = new List<string>();
            var placed = new List<string>();
            var replace = new List<string>(incoming);
            foreach (string p in previous) if (!replace.Contains(p)) replace.Add(p);
            try
            {
                foreach (string name in replace)
                {
                    string cur = Path.Combine(installDir, name);
                    if (!Fs.Exists(cur)) continue;
                    Fs.Move(cur, Path.Combine(old, name));
                    aside.Add(name);
                }
                foreach (string name in incoming)
                {
                    Fs.Move(Path.Combine(staging, name), Path.Combine(installDir, name));
                    placed.Add(name);
                }
            }
            catch (Exception e)
            {
                log("commit failed (" + e.Message + "): restoring the previous files");
                foreach (string name in placed)
                {
                    try { Fs.Move(Path.Combine(installDir, name), Path.Combine(staging, name)); } catch (Exception x) { log("  restore: " + x.Message); }
                }
                foreach (string name in aside)
                {
                    try { Fs.Move(Path.Combine(old, name), Path.Combine(installDir, name)); } catch (Exception x) { log("  restore: " + x.Message); }
                }
                throw;
            }
        }

        static void CheckSpace(string installDir)
        {
            try
            {
                long need = Payload.GetLong("Unpacked") + (64L << 20);
                var drive = new DriveInfo(Path.GetPathRoot(installDir));
                if (drive.AvailableFreeSpace < need)
                    throw new SetupException(Exit.Failed, string.Format(CultureInfo.InvariantCulture,
                        "There is not enough free space on {0}: Deer needs {1:0} MB, {2:0} MB are free.",
                        drive.Name, need / 1048576.0, drive.AvailableFreeSpace / 1048576.0));
            }
            catch (SetupException) { throw; }
            catch (Exception) { }
        }

        static void MakeShortcut(Target t, string path)
        {
            Shortcut.Create(path, t.Exe, t.LaunchArguments, t.InstallDir, t.Exe, 0, "Browse the web with Deer", Target.AppUserModelId);
        }

        public static void Run(Target t, bool desktop, Action<string, double> report)
        {
            Action<string> log = Log.Line;
            InstallRecord previous = InstallRecord.Read(t.InstallDir);
            log("install " + BuildInfo.Version + " (" + Payload.Get("Build") + ") " + t.ScopeText + " into " + t.InstallDir +
                (t.Test ? " [test mode, registry HKCU\\" + t.RegRoot + "]" : " [registry " + t.HiveName + "\\" + t.RegRoot + "]") +
                (previous != null ? ", replacing " + previous.Version : ""));

            var watch = Stopwatch.StartNew();
            VerifyPayload(report);
            CheckSpace(t.InstallDir);

            bool created = !Directory.Exists(t.InstallDir);
            Directory.CreateDirectory(t.InstallDir);
            string staging = Path.Combine(t.InstallDir, Staging);
            try
            {
                Fs.Delete(staging);
                Directory.CreateDirectory(staging);
                Extract(staging, report);
                log("unpacked in " + watch.Elapsed.TotalSeconds.ToString("0.00", CultureInfo.InvariantCulture) + " s (" + Threads + " threads)");
                List<string> incoming = TopLevel(staging);
                if (!incoming.Contains("Deer.exe") || !incoming.Contains("engine"))
                    throw new SetupException(Exit.PayloadBad, "The package is incomplete (no Deer.exe or engine folder).");

                report("Installing", 0.86);
                Commit(t.InstallDir, incoming, previous != null ? previous.Files : new List<string>(), log);
                log("files in place: " + string.Join(", ", incoming.ToArray()));

                report("Cleaning up", 0.90);
                try { Fs.Delete(Path.Combine(t.InstallDir, Old)); } catch (Exception e) { log("could not remove the previous files yet: " + e.Message); }
                try { Fs.Delete(staging); } catch (Exception e) { log("could not remove the staging folder: " + e.Message); }

                try
                {
                    Finish(t, desktop, previous, incoming, report, log);
                }
                catch (Exception e)
                {
                    log("files are in place, but a later step failed: " + e);
                    var se = new SetupException(Exit.Failed, "Deer's files are installed, but setup could not finish (" + e.Message +
                                                             "). Run setup again to complete the install.");
                    se.FilesInPlace = true;
                    throw se;
                }
                log("install done in " + watch.Elapsed.TotalSeconds.ToString("0.00", CultureInfo.InvariantCulture) + " s");
                report("Done", 1.0);
            }
            catch (Exception)
            {
                try { Fs.Delete(staging); } catch (Exception) { }
                if (created)
                {
                    try { if (Fs.IsEmptyDir(t.InstallDir)) Directory.Delete(t.InstallDir); } catch (Exception) { }
                }
                throw;
            }
        }

        // What follows the file swap: the install record, the shortcuts and the registration.
        static void Finish(Target t, bool desktop, InstallRecord previous, List<string> incoming, Action<string, double> report, Action<string> log)
        {
            var record = new InstallRecord();
            record.Version = BuildInfo.Version;
            record.Build = Payload.Get("Build");
            record.Mode = t.Test ? "test" : "user";
            record.Machine = t.Machine;
            record.RegistryRoot = t.RegRoot;
            record.StartMenuShortcut = t.StartMenuLnk;
            record.DesktopShortcut = desktop ? t.DesktopLnk : "";
            record.DataDir = t.Machine && !t.Test ? "" : t.DataDir; // all users: each person's own %LOCALAPPDATA%\Deer
            record.Files = incoming;
            record.Write(t.InstallDir);

            report("Creating shortcuts", 0.93);
            MakeShortcut(t, t.StartMenuLnk);
            log("shortcut " + t.StartMenuLnk);
            if (desktop)
            {
                MakeShortcut(t, t.DesktopLnk);
                log("shortcut " + t.DesktopLnk);
            }
            else if (previous != null && !string.IsNullOrEmpty(previous.DesktopShortcut))
            {
                log("desktop shortcut " + Shortcut.RemoveIfPointsAt(previous.DesktopShortcut, t.Exe) + ": " + previous.DesktopShortcut);
            }

            report("Registering Deer as a browser", 0.96);
            new Registration(t).Write(Paths.FolderSize(t.InstallDir));
            log("registered under " + t.HiveName + "\\" + t.RegRoot);
            if (!t.Test) ShellNotify.AssociationsChanged();
        }

        public static bool IsElevated()
        {
            try
            {
                using (WindowsIdentity id = WindowsIdentity.GetCurrent())
                    return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch (Exception) { return false; }
        }

        public static void StartDeer(Target t)
        {
            if (!t.Test && IsElevated())
            {
                // An elevated setup must not start an elevated browser: let Explorer start it as the user.
                Native.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), "\"" + t.Exe + "\"", null, false);
                return;
            }
            Native.Start(t.Exe, t.LaunchArguments, Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), false);
        }

        public static void OpenDefaultApps()
        {
            // Windows 11 opens Deer's own page with registeredAppUser; older builds ignore the query.
            try { Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=" + Target.AppName) { UseShellExecute = true }); }
            catch (Exception) { Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true }); }
        }
    }

    // ---- uninstall --------------------------------------------------------------------------------------

    static class Uninstaller
    {
        public static readonly string[] DefaultFiles = { "Deer.exe", "Uninstall.exe", "release.ini", "deer-version.json", "engine", "LICENSE.txt",
                                                         "THIRD-PARTY-NOTICES.txt" };

        public static string SelfPath { get { return Assembly.GetExecutingAssembly().Location; } }

        // True when Uninstall.exe runs from inside the folder it removes: it is deleted after it exits.
        public static bool SelfInside(Target t) { return Paths.IsInside(SelfPath, t.InstallDir); }

        public static void Run(Target t, InstallRecord rec, bool removeData, Action<string, double> report)
        {
            Action<string> log = Log.Line;
            log("uninstall " + (rec != null ? rec.Version : "(no record)") + " (" + t.ScopeText + ") from " + t.InstallDir +
                (t.Test ? " [test mode, registry HKCU\\" + t.RegRoot + "]" : " [registry " + t.HiveName + "\\" + t.RegRoot + "]") +
                (removeData ? ", deleting the data folder " + t.DataDir : ", keeping the data folder " + t.DataDir));

            EngineTraces.Plan traces = Directory.Exists(t.EngineDir) ? EngineTraces.Prepare(t.EngineDir) : null;

            report("Removing shortcuts", 0.05);
            var links = new List<string> { t.StartMenuLnk, t.DesktopLnk };
            if (rec != null)
            {
                if (!links.Contains(rec.StartMenuShortcut)) links.Add(rec.StartMenuShortcut);
                if (!links.Contains(rec.DesktopShortcut)) links.Add(rec.DesktopShortcut);
            }
            foreach (string l in links)
            {
                if (string.IsNullOrEmpty(l)) continue;
                log("shortcut " + l + ": " + Shortcut.RemoveIfPointsAt(l, t.Exe));
            }

            report("Removing Deer's registration", 0.15);
            new Registration(t).Remove(log);
            if (!t.Test) ShellNotify.AssociationsChanged();

            EngineTraces.Roots roots = t.Test ? EngineTraces.Roots.ForTest() : EngineTraces.Roots.Real();
            // Deer's updater's downloads (before the engine traces: those remove %LOCALAPPDATA%\Deer
            // once it is empty). The person's own folder: for an all-users install the one /userdata named.
            string deerLocal = t.Test ? (roots.LocalAppData == null ? null : Path.Combine(roots.LocalAppData, "Deer"))
                : (Paths.Same(t.DataDir, Target.RealDataDir) || Target.IsUserDataDir(t.DataDir) ? t.DataDir : null);
            RemoveStagedUpdates(deerLocal, log);
            if (traces != null)
            {
                // The engine's per-folder entries in this person's HKCU (and ProgramData). For an
                // all-users install, other accounts that ran Deer keep theirs (HKCU of each account).
                report("Removing the engine's settings", 0.25);
                EngineTraces.Remove(traces, log, roots);
            }

            report("Removing files", 0.35);
            var files = rec != null && rec.Files.Count > 0 ? new List<string>(rec.Files) : new List<string>(DefaultFiles);
            files.Add(InstallRecord.FileName);
            files.Add(Installer.Staging);
            files.Add(Installer.Old);
            string self = SelfPath;
            var failed = new List<string>();
            for (int i = 0; i < files.Count; i++)
            {
                string path = Path.Combine(t.InstallDir, files[i]);
                if (Paths.Same(path, self)) continue; // deleted after this process exits
                try { Fs.Delete(path); }
                catch (Exception e) { failed.Add(path); log("could not delete " + path + ": " + e.Message); }
                report(null, 0.35 + 0.45 * (i + 1) / files.Count);
            }
            try
            {
                if (Fs.IsEmptyDir(t.InstallDir)) { Directory.Delete(t.InstallDir); log("removed " + t.InstallDir); }
                else if (Directory.Exists(t.InstallDir) && !SelfInside(t)) log("kept " + t.InstallDir + ": it holds files Deer did not install");
            }
            catch (Exception e) { log("could not remove " + t.InstallDir + ": " + e.Message); }

            if (removeData)
            {
                report("Deleting your Deer data", 0.85);
                bool allowed = t.Test ? Target.IsUsableTestDataDir(t.DataDir)
                    : Paths.Same(t.DataDir, Target.RealDataDir) || (t.Machine && Target.IsUserDataDir(t.DataDir));
                if (!allowed) log("data folder " + t.DataDir + " not deleted: not Deer's data folder");
                else
                {
                    try { Fs.Delete(t.DataDir); log("removed " + t.DataDir); }
                    catch (Exception e) { failed.Add(t.DataDir); log("could not delete " + t.DataDir + ": " + e.Message); }
                }
            }
            report("Done", 1.0);
            if (failed.Count > 0)
                throw new SetupException(Exit.Failed, "Deer was uninstalled, but some files could not be deleted:\n" + string.Join("\n", failed.ToArray()));
        }

        // What Deer's updater (src/modules/VitreUpdater.sys.ts) keeps in <deerLocal>\updates: downloaded
        // setups (Deer-Setup-<version>.exe, .exe.part, .json) and setup.log. Other files stay; the folder
        // goes when that leaves it empty. A folder that is a link is left alone. Other accounts' folders
        // (an all-users install) are not looked at.
        static void RemoveStagedUpdates(string deerLocal, Action<string> log)
        {
            if (string.IsNullOrEmpty(deerLocal)) return;
            string dir = Path.Combine(deerLocal, "updates");
            try
            {
                if (!Directory.Exists(dir)) return;
                if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0)
                {
                    log("left " + dir + " alone: it is a link");
                    return;
                }
                foreach (string f in Directory.GetFiles(dir))
                {
                    string name = Path.GetFileName(f);
                    if (!string.Equals(name, "setup.log", StringComparison.OrdinalIgnoreCase) &&
                        !Regex.IsMatch(name, @"^Deer-Setup-.+\.(exe|exe\.part|json)$", RegexOptions.IgnoreCase)) continue;
                    try
                    {
                        File.SetAttributes(f, FileAttributes.Normal);
                        File.Delete(f);
                        log("removed " + f);
                    }
                    catch (Exception e) { log("could not remove " + f + ": " + e.Message); }
                }
                if (Fs.IsEmptyDir(dir)) { Directory.Delete(dir); log("removed " + dir); }
            }
            catch (Exception e) { log("Deer's downloaded updates in " + dir + ": " + e.Message); }
        }

        // Uninstall.exe cannot delete itself while it runs: a hidden cmd.exe does it a moment after it
        // exits, then removes the folder if that left it empty (rd without /s: files a user put there
        // stay). A deleted file can stay "delete pending" while a scanner still holds it open, which
        // keeps the folder non-empty for a moment, so both steps are tried three times (after about 2,
        // 4 and 9 s). The paths reach cmd through environment variables, so no character in them is
        // ever parsed as part of a command (/v:off: a "!" in a path stays literal even when the user's
        // registry turns delayed expansion on). For an all-users install the elevated uninstaller does
        // this, and the unelevated copy that started it (and waits for it) exits at the same moment.
        public static void ScheduleSelfDelete(Target t)
        {
            string self = SelfPath;
            const string attempt = "del /f /q \"%DEER_UNINSTALL_EXE%\" >nul 2>&1 & rd \"%DEER_UNINSTALL_DIR%\" >nul 2>&1";
            const string again = " & if exist \"%DEER_UNINSTALL_DIR%\" (ping -n {0} 127.0.0.1 >nul & " + attempt + ")";
            string script = "/d /v:off /c ping -n 3 127.0.0.1 >nul & " + attempt + string.Format(again, 3) + string.Format(again, 6);
            Environment.SetEnvironmentVariable("DEER_UNINSTALL_EXE", self);
            Environment.SetEnvironmentVariable("DEER_UNINSTALL_DIR", t.InstallDir);
            Native.Start(Path.Combine(Environment.SystemDirectory, "cmd.exe"), script, Path.GetTempPath(), true);
            Log.Line("scheduled the removal of " + self + " and of the folder if empty");
        }
    }

    // ---- the elevated copy (all users) ---------------------------------------------------------------------

    // Progress of an elevated copy of setup, for the wizard that started it: a small file the copy
    // rewrites ("<permille> TAB <status>"; at the end "done TAB <code> TAB <message>"). The wizard creates
    // it under %TEMP% with a random name and the copy only ever opens an existing file of that exact
    // form, so an elevated copy can't be made to write anywhere else.
    sealed class ProgressFile
    {
        static readonly Regex Name = new Regex(@"^Deer-Setup-[0-9a-f]{32}\.progress$");
        readonly string path;
        string status = "";
        int lastPermille = -1;
        DateTime lastWrite = DateTime.MinValue;

        ProgressFile(string path) { this.path = path; }

        public static string Create()
        {
            string p = Path.Combine(Path.GetTempPath(), "Deer-Setup-" + Guid.NewGuid().ToString("N") + ".progress");
            File.WriteAllText(p, "");
            return p;
        }

        public static ProgressFile Open(string path)
        {
            if (string.IsNullOrEmpty(path) || !Name.IsMatch(Path.GetFileName(path)) || !File.Exists(path)) return null;
            return new ProgressFile(path);
        }

        void Write(string text)
        {
            for (int i = 0; i < 10; i++)
            {
                try
                {
                    using (var f = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
                    {
                        byte[] b = Encoding.UTF8.GetBytes(text);
                        f.Write(b, 0, b.Length);
                        f.SetLength(b.Length);
                    }
                    return;
                }
                catch (IOException) { Thread.Sleep(20); }
                catch (Exception) { return; }
            }
        }

        public void Report(string text, double fraction)
        {
            if (text != null) status = text;
            int permille = (int)Math.Round(Math.Max(0, Math.Min(1, fraction)) * 1000);
            if (text == null && (permille == lastPermille || (DateTime.UtcNow - lastWrite).TotalMilliseconds < 100)) return;
            lastPermille = permille;
            lastWrite = DateTime.UtcNow;
            Write(permille.ToString(CultureInfo.InvariantCulture) + "\t" + status.Replace('\t', ' ').Replace('\n', ' '));
        }

        public void Done(int code, string message, bool filesInPlace)
        {
            Write("done\t" + code.ToString(CultureInfo.InvariantCulture) + "\t" + (filesInPlace ? "1" : "0") + "\t" +
                  (message ?? "").Replace('\t', ' ').Replace("\r", "").Replace('\n', '\u2028'));
        }

        // (permille or -1, status, exit code or -1, whether the new files are in place, message) as last written.
        public static void Read(string path, out int permille, out string status, out int code, out bool filesInPlace, out string message)
        {
            permille = -1; code = -1; status = null; message = null; filesInPlace = false;
            string text;
            try
            {
                using (var f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var r = new StreamReader(f, Encoding.UTF8)) text = r.ReadToEnd();
            }
            catch (Exception) { return; }
            string[] parts = text.Split('\t');
            if (parts.Length >= 4 && parts[0] == "done" && int.TryParse(parts[1], out code))
            {
                filesInPlace = parts[2] == "1";
                message = parts[3].Replace('\u2028', '\n');
                return;
            }
            code = -1;
            if (parts.Length == 2 && int.TryParse(parts[0], out permille)) status = parts[1];
            else permille = -1;
        }
    }

    static class Elevation
    {
        public const int ErrorCancelled = 1223; // the person said No to the UAC prompt

        // Whether the work for target t must happen in an elevated copy of this program: an all-users
        // install without administrator rights. In test mode the copy always runs (the "elevated" step,
        // exercised as a plain child process), unless this already is that copy.
        public static bool Needed(Options o, Target t)
        {
            if (!t.Machine || o.Elevated) return false;
            return t.Test || !Installer.IsElevated();
        }

        // One argument for CreateProcess / ShellExecute, quoted the way CommandLineToArgvW reads it back.
        public static string Quote(string arg)
        {
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;
            var sb = new StringBuilder("\"");
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"') { sb.Append('\\', backslashes * 2 + 1); sb.Append('"'); backslashes = 0; continue; }
                sb.Append('\\', backslashes); backslashes = 0; sb.Append(c);
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        // Starts this program again with `args`: through UAC ("runas"), or in test mode as a plain child.
        // With `wait`, waits for it and returns its exit code, passing its progress file on to `report`;
        // without, returns 0 once it started. Exit.NeedsAdmin when the UAC prompt is declined.
        public static int Run(bool test, List<string> args, bool wait, Action<string, double> report)
        {
            string progress = null;
            if (wait && report != null)
            {
                progress = ProgressFile.Create();
                args.Add("/progress:" + progress);
            }
            var line = new StringBuilder();
            foreach (string a in args) line.Append(line.Length > 0 ? " " : "").Append(Quote(a));
            string self = Uninstaller.SelfPath;
            Log.Line((test ? "test mode: starting the administrator step as a plain child process (no UAC): " : "asking for administrator permission (UAC) to run: ") +
                     Path.GetFileName(self) + " " + line);
            Program.ReleaseGate(); // the elevated copy takes the "one setup at a time" mutex over
            try
            {
                Process p;
                try
                {
                    var psi = new ProcessStartInfo(self, line.ToString());
                    psi.WorkingDirectory = Path.GetTempPath();
                    if (test) psi.UseShellExecute = false;
                    else
                    {
                        psi.UseShellExecute = true;
                        psi.Verb = "runas";
                    }
                    p = Process.Start(psi);
                    if (p == null) throw new SetupException(Exit.Failed, "Setup could not start its administrator step.");
                }
                catch (Win32Exception e)
                {
                    if (e.NativeErrorCode == ErrorCancelled)
                    {
                        Log.Line("administrator permission was declined");
                        return Exit.NeedsAdmin;
                    }
                    throw;
                }
                using (p)
                {
                    if (!wait) return Exit.Ok;
                    int last = -2;
                    string lastStatus = null;
                    while (!p.WaitForExit(150))
                    {
                        if (progress == null) continue;
                        int permille, code;
                        bool inPlace;
                        string status, message;
                        ProgressFile.Read(progress, out permille, out status, out code, out inPlace, out message);
                        if (permille >= 0 && permille != last)
                        {
                            last = permille;
                            // The status only when it changed: a silent run logs every status it is given.
                            report(status == lastStatus ? null : status, permille / 1000.0);
                            lastStatus = status;
                        }
                    }
                    p.WaitForExit();
                    int exit = p.ExitCode;
                    Log.Line("the administrator step ended with " + exit);
                    if (progress != null && exit != Exit.Ok)
                    {
                        int permille, code;
                        bool inPlace;
                        string status, message;
                        ProgressFile.Read(progress, out permille, out status, out code, out inPlace, out message);
                        if (!string.IsNullOrEmpty(message)) throw new SetupException(exit, message) { FilesInPlace = inPlace };
                    }
                    return exit;
                }
            }
            finally
            {
                if (progress != null) { try { File.Delete(progress); } catch (Exception) { } }
            }
        }

        // The arguments a test-mode run passes on to its elevated copy.
        public static void AddTestArgs(Options o, List<string> args)
        {
            if (!o.TestKeys) return;
            args.Add("/testkeys");
            if (o.ShortcutDir != null) args.Add("/shortcutdir:" + o.ShortcutDir);
            if (o.DataDir != null) args.Add("/datadir:" + o.DataDir);
        }

        public static void AddLog(List<string> args)
        {
            if (Log.File != null) args.Add("/log:" + Log.File); // the copy appends to this run's log
        }
    }

    // ---- entry ----------------------------------------------------------------------------------------

    static class Program
    {
        public const string GateName = @"Local\Deer.Setup";
        static Mutex gate;
        static bool gateOwned;
        // /update waited for another setup to finish before it could run.
        static bool waitedForSetup;
        // Deer was started by this run (Launch).
        static bool launched;
        // Set when an install failed after its files were swapped in (an elevated copy reports it).
        static bool filesInPlace;

        // After an elevated step that did not run (UAC declined), the wizard holds the mutex again.
        public static void RetakeGate()
        {
            if (gate == null || gateOwned) return;
            try { gateOwned = gate.WaitOne(0); }
            catch (AbandonedMutexException) { gateOwned = true; }
            catch (Exception) { }
        }

        // The "one setup at a time" mutex, or null when this run may not open the one that exists (then
        // another setup holds it: see below). A named mutex's default DACL names only the account and
        // logon session that created it, so an elevated copy that UAC starts under ANOTHER account (a
        // standard user typing an administrator's password) could not open it and died with an
        // unhandled UnauthorizedAccessException. Administrators get the two rights WaitOne and
        // ReleaseMutex need (.NET opens an existing mutex with just those when full access is denied).
        // The reverse case, a gate made by such an elevated copy while the person starts setup again,
        // is "another setup is running".
        static Mutex OpenGate()
        {
            try
            {
                var security = new MutexSecurity();
                using (WindowsIdentity me = WindowsIdentity.GetCurrent())
                    security.AddAccessRule(new MutexAccessRule(me.User, MutexRights.FullControl, AccessControlType.Allow));
                security.AddAccessRule(new MutexAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
                                                           MutexRights.Synchronize | MutexRights.Modify, AccessControlType.Allow));
                bool created;
                return new Mutex(false, GateName, out created, security);
            }
            catch (Exception e)
            {
                Log.Line("the setup mutex " + GateName + " cannot be opened: " + e.Message);
                return null;
            }
        }

        // "One setup at a time". Released when an elevated copy takes over (it waits for the mutex).
        public static void ReleaseGate()
        {
            if (gate != null && gateOwned)
            {
                try { gate.ReleaseMutex(); } catch (Exception) { }
                gateOwned = false;
            }
        }

        static bool HasSilentFlag(string[] argv)
        {
            foreach (string a in argv)
            {
                string s = a.Trim().TrimStart('/', '-').ToLowerInvariant();
                if (s == "s" || s == "silent" || s == "update") return true;
            }
            return false;
        }

        public static void Message(string text, MessageBoxIcon icon)
        {
            MessageBox.Show(text, "Deer Setup", MessageBoxButtons.OK, icon);
        }

        [STAThread]
        static int Main(string[] argv)
        {
            string error;
            Options o = Options.Parse(argv, out error);
            bool uninstall = o != null && (o.Uninstall || (!Payload.Present && !o.Update));
            Log.Open(o != null ? o.LogFile : null, uninstall ? "Deer-Uninstall.log" : "Deer-Setup.log");
            Log.Line((uninstall ? "Deer uninstaller " : "Deer setup ") + BuildInfo.Version + " (" + BuildInfo.Build + ") args: " + string.Join(" ", argv) +
                     (Installer.IsElevated() ? " [administrator]" : ""));
            if (!(o != null && o.Silent)) { Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); }
            if (o == null)
            {
                Log.Line(error);
                Log.Line("RESULT " + Exit.BadArguments);
                if (!HasSilentFlag(argv)) Message(error + "\n\nSee the top of Setup.cs for the options.", MessageBoxIcon.Error);
                return Exit.BadArguments;
            }

            int code;
            Target done = null;
            ProgressFile progress = o.Elevated ? ProgressFile.Open(o.ProgressFile) : null;
            gate = OpenGate();
            using (gate) // a null gate is never owned: "another setup is running"
            {
                try
                {
                    // The elevated copy waits for the run that started it to hand the mutex over.
                    gateOwned = gate != null && gate.WaitOne(o.Elevated ? 30000 : 0);
                }
                catch (AbandonedMutexException) { gateOwned = true; }
                if (!gateOwned && gate != null && o.Update && !o.Elevated)
                {
                    // Deer's updater (Deer has just quit for it): wait for the other setup, as for Deer.
                    int seconds = o.WaitSeconds >= 0 ? o.WaitSeconds : 600;
                    Log.Line("another Deer setup or uninstaller is running; waiting up to " + seconds + " s for it to finish");
                    try { gateOwned = gate.WaitOne(TimeSpan.FromSeconds(seconds)); }
                    catch (AbandonedMutexException) { gateOwned = true; }
                    waitedForSetup = gateOwned;
                }
                if (!gateOwned)
                {
                    Log.Line("another Deer setup or uninstaller is running");
                    if (!o.Silent) Message("Deer Setup is already running.", MessageBoxIcon.Information);
                    if (progress != null) progress.Done(Exit.SetupRunning, "Deer Setup is already running.", false);
                    RelaunchAfterUpdate(o, Exit.SetupRunning);
                    Log.Line("RESULT " + Exit.SetupRunning);
                    return Exit.SetupRunning;
                }
                string message = null;
                try
                {
                    code = uninstall ? UninstallMain(o, out done) : InstallMain(o, progress, out message);
                }
                catch (Exception e)
                {
                    Log.Line("unexpected error: " + e);
                    if (!o.Silent) Message("Something went wrong:\n\n" + e.Message, MessageBoxIcon.Error);
                    code = Exit.Failed;
                    message = e.Message;
                }
                finally
                {
                    ReleaseGate();
                }
                if (progress != null) progress.Done(code, message, filesInPlace);
            }
            if (done != null && Uninstaller.SelfInside(done))
            {
                try { Uninstaller.ScheduleSelfDelete(done); } catch (Exception e) { Log.Line("could not schedule self-removal: " + e.Message); }
            }
            RelaunchAfterUpdate(o, code);
            Log.Line("RESULT " + code);
            return code;
        }

        // "Restart to update" (/update /launch) closed Deer before setup ran: whatever stopped the update
        // early, Deer is started again as it was (the install's Deer.exe, when it is installed there in
        // this mode and no Deer runs from it). Not after exit 3 (Deer still running) or when this run
        // started Deer already.
        static void RelaunchAfterUpdate(Options o, int code)
        {
            if (!o.Update || !o.Launch || o.Elevated || launched || code == Exit.Ok || code == Exit.DeerRunning) return;
            try
            {
                string dir = o.InstallDir;
                if (string.IsNullOrEmpty(dir)) dir = Target.RegisteredInstallDir(o.TestKeys, false) ?? Target.RegisteredInstallDir(o.TestKeys, true);
                if (string.IsNullOrEmpty(dir) || !Installer.IsAbsoluteLocal(dir)) return;
                InstallRecord rec = InstallRecord.Read(Paths.Full(dir));
                // Nothing installed there; or a test run against a normal install (never started).
                if (rec == null || rec.IsTest != o.TestKeys) return;
                Target t = Target.For(rec.IsTest, rec.Machine, dir, o.ShortcutDir, o.DataDir);
                t.UseRecord(rec);
                if (!File.Exists(t.Exe) || Processes.RunningFrom(t.InstallDir).Count > 0) return;
                Log.Line("the update stopped early (" + code + "): starting Deer again as it was");
                Launch(t);
            }
            catch (Exception e)
            {
                Log.Line("could not start Deer again: " + e.Message);
            }
        }

        // Waits up to `seconds` for every process running from `dir` to exit; returns those still running.
        static List<string> WaitForExit(string dir, int seconds)
        {
            DateTime until = DateTime.UtcNow.AddSeconds(seconds);
            List<string> running = Processes.RunningFrom(dir);
            if (running.Count > 0 && seconds > 0) Log.Line("Deer is running; waiting up to " + seconds + " s for it to close");
            while (running.Count > 0 && DateTime.UtcNow < until)
            {
                Thread.Sleep(500);
                running = Processes.RunningFrom(dir);
            }
            return running;
        }

        // ---- install ----

        static int InstallMain(Options o, ProgressFile progress, out string message)
        {
            message = null;
            if (!Environment.Is64BitOperatingSystem || Environment.OSVersion.Version.Major < 10)
            {
                Log.Line("unsupported Windows " + Environment.OSVersion);
                if (!o.Silent) Message("Deer needs 64-bit Windows 10 or Windows 11.", MessageBoxIcon.Error);
                return Exit.Unsupported;
            }
            if (o.TestKeys && o.DataDir != null && !Target.IsUsableTestDataDir(o.DataDir))
            {
                Log.Line("test data folder must be inside %TEMP%: " + o.DataDir);
                return Exit.BadArguments;
            }
            if (!string.IsNullOrEmpty(o.InstallDir) && !Installer.IsAbsoluteLocal(o.InstallDir))
            {
                Log.Line("/installdir must be a full path: " + o.InstallDir);
                if (!o.Silent) Message("The install folder must be a full path, such as " + Target.DefaultInstallDir(false, o.AllUsers) + ".", MessageBoxIcon.Error);
                return Exit.FolderNotUsable;
            }
            if (o.Update) return UpdateMain(o, progress, out message);

            // Which folder and which kind of install: an existing install keeps both.
            string dir = o.InstallDir;
            bool machine = o.AllUsers;
            if (!string.IsNullOrEmpty(dir))
            {
                InstallRecord there = InstallRecord.Read(Paths.Full(dir));
                if (there != null && !o.AllUsers) machine = there.Machine;
            }
            else
            {
                string user = Target.RegisteredInstallDir(o.TestKeys, false), all = Target.RegisteredInstallDir(o.TestKeys, true);
                if (o.AllUsers) dir = all;
                else if (user != null) dir = user;
                else if (all != null) { dir = all; machine = true; }
                if (string.IsNullOrEmpty(dir)) dir = Target.DefaultInstallDir(o.TestKeys, machine);
            }
            Target t;
            try { t = Target.For(o.TestKeys, machine, dir, o.ShortcutDir, o.DataDir); }
            catch (Exception e)
            {
                Log.Line("bad install folder " + dir + ": " + e.Message);
                if (!o.Silent) Message("This install folder can't be used:\n" + dir, MessageBoxIcon.Error);
                return Exit.FolderNotUsable;
            }

            if (o.Silent)
            {
                int code = SilentInstall(o, t, progress, out message);
                return code;
            }

            var form = new InstallForm(o, t);
            Application.Run(form);
            return form.ExitCode;
        }

        // Shared by the silent path and the wizard: what would stop an install into t.InstallDir.
        public static SetupException InstallBlocker(Target t, bool allowDowngrade)
        {
            if (!Payload.Present) return new SetupException(Exit.PayloadBad, "This setup program does not contain Deer. Download it again.");
            string other = Target.RegisteredInstallDir(t.Test, !t.Machine);
            if (other != null && !Paths.Same(other, t.InstallDir))
                return new SetupException(Exit.FolderNotUsable, "Deer is already installed " + (t.Machine ? "for your account only" : "for all users") + " in " + other +
                                                                ". Uninstall it first to install it " + (t.Machine ? "for all users." : "just for you."));
            string problem = Installer.FolderProblem(t);
            if (problem != null) return new SetupException(Exit.FolderNotUsable, problem);
            if (t.Test && !Paths.IsInside(t.InstallDir, Path.GetTempPath()))
                return new SetupException(Exit.FolderNotUsable, "Test installs go inside %TEMP%: " + t.InstallDir);
            InstallRecord previous = InstallRecord.Read(t.InstallDir);
            if (previous != null && previous.IsTest != t.Test)
                return new SetupException(Exit.FolderNotUsable, "This folder holds a Deer installed " + (previous.IsTest ? "in test mode" : "normally") + ". Uninstall it first.");
            if (previous != null && previous.Machine != t.Machine)
                return new SetupException(Exit.FolderNotUsable, "This folder holds a Deer installed " + (previous.Machine ? "for all users" : "for one account") + ". Uninstall it first.");
            if (previous != null && !allowDowngrade && Installer.CompareVersions(previous.Version, BuildInfo.Version) > 0)
                return new SetupException(Exit.Downgrade, "A newer version of Deer (" + previous.Version + ") is already installed.");
            return null;
        }

        static Action<string, double> SilentReport(ProgressFile progress)
        {
            return delegate (string status, double fraction)
            {
                if (status != null) Log.Line("[" + (int)(fraction * 100) + "%] " + status);
                if (progress != null) progress.Report(status, fraction);
            };
        }

        static int SilentInstall(Options o, Target t, ProgressFile progress, out string message)
        {
            message = null;
            SetupException blocker = InstallBlocker(t, o.AllowDowngrade);
            if (blocker != null)
            {
                Log.Line("cannot install: " + blocker.Message);
                message = blocker.Message;
                return blocker.Code;
            }
            InstallRecord previous = InstallRecord.Read(t.InstallDir);
            bool desktop = o.Desktop.HasValue ? o.Desktop.Value
                : previous != null && !string.IsNullOrEmpty(previous.DesktopShortcut) && File.Exists(previous.DesktopShortcut);

            if (Elevation.Needed(o, t))
            {
                // All users: the same install, run by an elevated copy; this run starts Deer afterwards.
                var args = new List<string> { "/S", "/allusers", "/installdir:" + t.InstallDir, desktop ? "/desktop" : "/nodesktop", "/elevated" };
                if (o.AllowDowngrade) args.Add("/allowdowngrade");
                if (o.WaitSeconds >= 0) args.Add("/wait:" + o.WaitSeconds);
                Elevation.AddTestArgs(o, args);
                Elevation.AddLog(args);
                int code;
                try { code = Elevation.Run(t.Test, args, true, SilentReport(progress)); }
                catch (SetupException e) { message = e.Message; return e.Code; }
                if (code == Exit.Ok && o.Launch) Launch(t);
                return code;
            }
            if (t.Machine && !t.Test && !Installer.IsElevated())
            {
                message = "Installing Deer for all users needs administrator permission.";
                Log.Line(message);
                return Exit.NeedsAdmin;
            }

            List<string> running = WaitForExit(t.InstallDir, Math.Max(0, o.WaitSeconds));
            if (running.Count > 0)
            {
                Log.Line("Deer is running: " + string.Join(", ", running.ToArray()));
                message = "Deer is running. Close it and run setup again.";
                return Exit.DeerRunning;
            }
            try
            {
                Installer.Run(t, desktop, SilentReport(progress));
            }
            catch (SetupException e)
            {
                Log.Line("install failed: " + e.Message);
                message = e.Message;
                filesInPlace = e.FilesInPlace;
                return e.Code;
            }
            catch (Exception e)
            {
                Log.Line("install failed: " + e);
                message = e.Message;
                return Exit.Failed;
            }
            if (o.Launch) Launch(t);
            return Exit.Ok;
        }

        static void Launch(Target t)
        {
            launched = true;
            try { Installer.StartDeer(t); Log.Line("started Deer"); }
            catch (Exception e) { Log.Line("could not start Deer: " + e.Message); }
        }

        // ---- update (Deer's updater runs Deer-Setup.exe /update) ----

        static int UpdateMain(Options o, ProgressFile progress, out string message)
        {
            message = null;
            FileStream self = null;
            if (o.Sha256 != null && !o.Elevated) // the elevated copy runs from the file this run holds
            {
                self = HoldSelf(o.Sha256, out message);
                if (self == null)
                {
                    Log.Line(message);
                    return Exit.PayloadBad;
                }
            }
            using (self) return Update(o, progress, out message);
        }

        // The file this program runs from, checked against the SHA-256 Deer's updater checked it against
        // (/sha256) and held open with read sharing only until this run ends: nothing can write, rename
        // or delete it meanwhile, so nothing can be put in its place (a running program's file can be
        // renamed). Null with the reason when it cannot be held or is not that file.
        static FileStream HoldSelf(string want, out string problem)
        {
            problem = null;
            string path = Uninstaller.SelfPath;
            FileStream f;
            try { f = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read); }
            catch (Exception e)
            {
                problem = "Setup could not hold its own file " + path + " (" + e.Message + "): not updated.";
                return null;
            }
            try
            {
                string got;
                using (SHA256 sha = SHA256.Create()) got = BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
                if (got != want)
                {
                    f.Dispose();
                    problem = "This setup program is not the file Deer checked (SHA-256 " + got + ", Deer checked " + want + "): not updated.";
                    return null;
                }
            }
            catch (Exception e)
            {
                f.Dispose();
                problem = "Setup could not read its own file " + path + " (" + e.Message + "): not updated.";
                return null;
            }
            Log.Line("this setup file has the SHA-256 Deer checked; it stays held until setup ends");
            return f;
        }

        static int Update(Options o, ProgressFile progress, out string message)
        {
            message = null;
            if (!Payload.Present)
            {
                message = "This program does not contain Deer: run Deer-Setup.exe /update.";
                Log.Line(message);
                return Exit.PayloadBad;
            }
            string dir = o.InstallDir;
            if (string.IsNullOrEmpty(dir)) dir = Target.RegisteredInstallDir(o.TestKeys, false) ?? Target.RegisteredInstallDir(o.TestKeys, true);
            InstallRecord rec = InstallRecord.Read(string.IsNullOrEmpty(dir) ? null : Paths.Full(dir));
            if (rec == null)
            {
                message = "Deer is not installed" + (string.IsNullOrEmpty(dir) ? "" : " in " + dir) + ": nothing to update.";
                Log.Line(message);
                return Exit.NotInstalled;
            }
            if (rec.IsTest != o.TestKeys)
            {
                message = rec.IsTest ? "This is a test install: update it with /testkeys." : "/testkeys was given, but " + dir + " holds a normal install.";
                Log.Line(message);
                return Exit.BadArguments;
            }
            Target t = Target.For(rec.IsTest, rec.Machine, dir, o.ShortcutDir, o.DataDir);
            t.UseRecord(rec);
            int cmp = Installer.CompareVersions(BuildInfo.Version, rec.Version);
            Log.Line("update " + rec.Version + " -> " + BuildInfo.Version + " (" + t.ScopeText + ") in " + t.InstallDir);
            if (cmp < 0 && !o.AllowDowngrade)
            {
                message = "A newer version of Deer (" + rec.Version + ") is already installed.";
                Log.Line(message);
                return Exit.Downgrade;
            }
            bool wasRunning = Processes.RunningFrom(t.InstallDir).Count > 0;
            bool restart = o.Launch || (wasRunning && !o.NoRestart);
            if (cmp == 0 && waitedForSetup)
            {
                // The setup this run waited for installed this very version (another Deer profile applying
                // the same update): nothing to do but start Deer again.
                Log.Line("the setup this run waited for installed " + rec.Version + " already: nothing to install");
                if (restart && !wasRunning && File.Exists(t.Exe)) Launch(t);
                return Exit.Ok;
            }
            if (cmp == 0) Log.Line("the same version is installed: installing it again");
            bool desktop = !string.IsNullOrEmpty(rec.DesktopShortcut) && File.Exists(rec.DesktopShortcut);
            int wait = o.WaitSeconds >= 0 ? o.WaitSeconds : 600;
            if (wasRunning) Log.Line("Deer is running" + (restart ? "; it is started again after the update" : ""));

            int code;
            if (Elevation.Needed(o, t))
            {
                // All users: the elevated copy waits for Deer to close and installs; this run, as the
                // person, starts Deer again.
                var args = new List<string> { "/update", "/norestart", "/installdir:" + t.InstallDir, "/wait:" + wait, "/elevated" };
                if (o.AllowDowngrade) args.Add("/allowdowngrade");
                Elevation.AddTestArgs(o, args);
                Elevation.AddLog(args);
                try { code = Elevation.Run(t.Test, args, true, SilentReport(progress)); }
                catch (SetupException e) { message = e.Message; code = e.Code; }
            }
            else if (t.Machine && !t.Test && !Installer.IsElevated())
            {
                message = "Updating Deer for all users needs administrator permission.";
                Log.Line(message);
                return Exit.NeedsAdmin;
            }
            else
            {
                List<string> running = WaitForExit(t.InstallDir, wait);
                if (running.Count > 0)
                {
                    message = "Deer did not close within " + wait + " s: not updated.";
                    Log.Line(message + " Still running: " + string.Join(", ", running.ToArray()));
                    return Exit.DeerRunning;
                }
                try
                {
                    Installer.Run(t, desktop, SilentReport(progress));
                    code = Exit.Ok;
                }
                catch (SetupException e)
                {
                    Log.Line("update failed: " + e.Message);
                    message = e.Message;
                    filesInPlace = e.FilesInPlace;
                    code = e.Code;
                }
                catch (Exception e)
                {
                    Log.Line("update failed: " + e);
                    message = e.Message;
                    code = Exit.Failed;
                }
            }
            // Deer was running when the update began: start it again, the new version or, when the update
            // failed, the one still in place (the person is put back where they were). Not when it is
            // still running (the update waited in vain).
            if (restart && code != Exit.DeerRunning && File.Exists(t.Exe)) Launch(t);
            return code;
        }

        // ---- uninstall ----

        static int UninstallMain(Options o, out Target target)
        {
            target = null;
            string selfDir = Path.GetDirectoryName(Uninstaller.SelfPath);
            InstallRecord rec = null;
            string dir = o.InstallDir;
            if (!string.IsNullOrEmpty(dir) && !Installer.IsAbsoluteLocal(dir))
            {
                Log.Line("/installdir must be a full path: " + dir);
                return Exit.BadArguments;
            }
            if (string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(selfDir, InstallRecord.FileName))) dir = selfDir;
            if (string.IsNullOrEmpty(dir)) dir = Target.RegisteredInstallDir(o.TestKeys, false) ?? Target.RegisteredInstallDir(o.TestKeys, true);
            if (!string.IsNullOrEmpty(dir)) rec = InstallRecord.Read(dir);
            if (rec == null)
            {
                Log.Line("Deer is not installed" + (string.IsNullOrEmpty(dir) ? "" : " in " + dir));
                if (!o.Silent) Message("Deer is not installed" + (string.IsNullOrEmpty(dir) ? "." : " in " + dir + "."), MessageBoxIcon.Information);
                return Exit.NotInstalled;
            }
            if (o.TestKeys && !rec.IsTest)
            {
                // A test run must never remove a real install.
                Log.Line("/testkeys was given, but " + dir + " holds a normal install: nothing removed");
                return Exit.BadArguments;
            }
            // Leave the folder that is about to be deleted.
            try { Directory.SetCurrentDirectory(Path.GetTempPath()); } catch (Exception) { }

            Target t = Target.For(rec.IsTest, rec.Machine, dir, null, null);
            t.UseRecord(rec); // a test install is removed from the test keys and test folders it recorded

            if (Elevation.Needed(o, t))
            {
                // All users: the uninstaller runs with administrator rights from the start (as most
                // uninstallers of all-users programs do). The data the person may delete is theirs,
                // so this run tells the elevated copy which folder that is.
                var args = new List<string> { "/uninstall", "/installdir:" + Paths.Full(dir), "/elevated" };
                if (o.Silent) args.Add("/S");
                if (o.RemoveData) args.Add("/removedata");
                if (o.WaitSeconds >= 0) args.Add("/wait:" + o.WaitSeconds);
                if (!t.Test) args.Add("/userdata:" + Target.RealDataDir);
                if (t.Test) args.Add("/testkeys");
                Elevation.AddLog(args);
                int code;
                try { code = Elevation.Run(t.Test, args, o.Silent, null); }
                catch (SetupException e) { code = e.Code; }
                if (code == Exit.NeedsAdmin && !o.Silent) Message("Deer was not uninstalled: removing it for all users needs administrator permission.", MessageBoxIcon.Information);
                return code; // the elevated copy removes this program too (it waits for this run to end)
            }
            if (t.Machine && !t.Test && !Installer.IsElevated())
            {
                Log.Line("uninstalling Deer for all users needs administrator permission");
                return Exit.NeedsAdmin;
            }
            if (t.Machine && !t.Test && o.UserData != null)
            {
                if (Target.IsUserDataDir(o.UserData)) t.DataDir = Paths.Full(o.UserData);
                else Log.Line("ignored /userdata " + o.UserData + ": not a Deer data folder");
            }
            target = t;

            if (o.Silent)
            {
                List<string> running = WaitForExit(t.InstallDir, Math.Max(0, o.WaitSeconds));
                if (running.Count > 0)
                {
                    Log.Line("Deer is running: " + string.Join(", ", running.ToArray()));
                    target = null;
                    return Exit.DeerRunning;
                }
                try
                {
                    Uninstaller.Run(t, rec, o.RemoveData, delegate (string status, double fraction)
                    {
                        if (status != null) Log.Line("[" + (int)(fraction * 100) + "%] " + status);
                    });
                    return Exit.Ok;
                }
                catch (SetupException e)
                {
                    Log.Line(e.Message);
                    return e.Code;
                }
            }

            var form = new UninstallForm(o, t, rec);
            Application.Run(form);
            if (form.ExitCode != Exit.Ok && form.ExitCode != Exit.Failed) target = null;
            return form.ExitCode;
        }
    }
}
