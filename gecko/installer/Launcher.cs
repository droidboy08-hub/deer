// Deer.exe: the launcher every shortcut, file association and URL association points at.
// Built by installer\build.py with the .NET Framework compiler that ships with Windows (no SDK):
//   csc /target:winexe /win32icon:<deer icon> /win32manifest:Launcher.manifest Launcher.cs ProfileMigration.cs <generated BuildInfo>
//
// Layout it expects (the release folder = the install folder):
//   <install>\Deer.exe            this program
//   <install>\release.ini         Version= and Build= of this release (written by build.py)
//   <install>\install.ini         the install record (setup writes it); Mode=test marks a test install
//   <install>\engine\deer.exe     the Gecko engine (tools\setup-engine.py: the unbranded build's
//                                 firefox.exe with Deer's identity compiled in)
//   <install>\engine\vitre\       the chrome package (chrome://vitre/), loaded by engine\config.js
//
// What it does, in order:
//   1. Command line. Windows starts a default browser as  Deer.exe -osint -url "<url or file>".
//      Gecko accepts -osint only as the FIRST argument followed by exactly one flag and one value
//      (protection against arguments smuggled in through a crafted link). That shape is impossible
//      once -profile is added in front, so the launcher enforces the same rule itself and forwards
//      the pair without -osint. Any other -osint shape exits with code 1 and starts nothing.
//      Otherwise every argument is forwarded (URLs, files, -private-window, -new-window, ...) except
//      the ones that would make Gecko pick a profile itself: -profile <dir> is taken as Deer's
//      profile override, -P [name], -ProfileManager, -createprofile <x> and -migration are dropped.
//   2. Profile: -profile <dir>, else %DEER_PROFILE%, else %LOCALAPPDATA%\Deer\Profile. Only that
//      default one is copied from the profile of the browser's development name, %LOCALAPPDATA%\Vitre\
//      Profile, when Deer's does not exist yet or is blank (ProfileMigration.cs: a copy, never a move;
//      while a browser runs on the old profile, this start uses the old one and the copy waits for the
//      next; a copy that failed twice is tried once a day, and the person is told once, in a message
//      after the engine started, never for a test install). The development launcher has its own
//      profile (%LOCALAPPDATA%\Deer Dev\Profile): the two never share one.
//      The folder is created with the marker file "vitre-profile" in it (engine\config.js exits at
//      once in a profile without it, so a bare engine\deer.exe can never open a profile Deer did not
//      make).
//      Test installs (install.ini Mode=test, made by setup /testkeys) never use the real folders:
//      DEER_TEST_LOCALAPPDATA (a folder inside %TEMP%) stands in for %LOCALAPPDATA%, and without it
//      the default profile is <the install record's DataDir>\Profile, with no migration.
//   3. Caches: when release.ini's Build differs from the one recorded in <profile>\deer-build (first
//      start after an install or update), -purgecaches is added once.
//   4. Starts engine\deer.exe -profile <profile> [...] and exits. Never -no-remote: Gecko's remoting is
//      keyed by the profile path, so a second launch hands its URL to the running Deer and exits
//      (single instance per profile, no contact with the user's Firefox). The engine is created with
//      no inherited handles (a caller capturing Deer.exe's output is not held until the browser
//      quits) and with the shell's show state and shortcut identity passed on, as Firefox's own
//      launcher process does. Its environment loses ClearEnv (the engine's deer-engine.json
//      identity.launch.clearEnv, which build.py checks against this list): an inherited XUL_APP_FILE
//      would replace the identity compiled into deer.exe, an inherited XRE_PROFILE_PATH or
//      XRE_PROFILE_LOCAL_PATH the profile given with -profile, and an inherited MOZ_NEW_INSTANCE would
//      turn Gecko's remoting off (a second start, a link from another program, would then try to open
//      the profile the running Deer holds instead of handing it the URL).
// The process carries the AppUserModelID "Deer.Browser", the same as the Start menu shortcut and
// Deer's windows, so a pinned Deer and running Deer share one taskbar button.
//
// Exit codes: 0 started (or handed over), 1 rejected -osint shape, 2 engine or chrome package
// missing (a message box says so), 3 any other failure (message box).
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class DeerLauncher
{
    const string AppUserModelId = "Deer.Browser";
    const string ProfileMarker = "vitre-profile"; // the exact name tools\runtime-overlay\config.js checks
    const string PackageDir = "vitre"; // engine\<this> = the chrome package (build.py PACKAGE_DIR; config.js loads it)
    const string BuildStamp = "deer-build";
    // Never passed on to the engine (see 4 above). build.py refuses an engine whose deer-engine.json
    // asks for anything else (other names, arguments or variables).
    public static readonly string[] ClearEnv = { "XUL_APP_FILE", "XRE_PROFILE_PATH", "XRE_PROFILE_LOCAL_PATH", "MOZ_NEW_INSTANCE" };

    // Flags Gecko may receive after -osint (the shell uses -url; the rest are harmless and documented).
    static readonly string[] OsintFlags = { "url", "new-tab", "new-window", "private-window" };

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string appId);

    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr owner, string text, string caption, uint type);

    // STARTUPINFOW with the string members as raw pointers (the marshaller must not free them).
    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfo
    {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern void GetStartupInfoW(out StartupInfo info);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref StartupInfo startup, out ProcessInformation info);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    const int ASFW_ANY = -1;
    const uint MB_ICONERROR = 0x10;
    const uint MB_ICONINFORMATION = 0x40;
    // What the shell tells a program it starts, passed on to the engine as Firefox's own launcher
    // process does: the show state (a shortcut set to "Maximized"), the shortcut it came from
    // (taskbar pinning and jump lists associate the windows with that shortcut) and the
    // launch-feedback cursor flags. Never STARTF_USESTDHANDLES: the engine inherits no handles.
    const int STARTF_FORWARDED = 0x1 /* USESHOWWINDOW */ | 0x40 /* FORCEONFEEDBACK */ | 0x80 /* FORCEOFFFEEDBACK */ |
                                 0x800 /* TITLEISLINKNAME */ | 0x1000 /* TITLEISAPPID */ | 0x2000 /* PREVENTPINNING */;

    // Starts the engine without inheriting any handle: a caller that captures Deer.exe's output (a
    // script, an updater) must see it end when Deer.exe ends, not when the browser quits.
    static void StartEngine(string exe, string arguments)
    {
        StartupInfo mine;
        GetStartupInfoW(out mine);
        var si = new StartupInfo();
        si.cb = Marshal.SizeOf(typeof(StartupInfo));
        si.dwFlags = mine.dwFlags & STARTF_FORWARDED;
        si.wShowWindow = mine.wShowWindow;
        if ((si.dwFlags & (0x800 | 0x1000)) != 0) si.lpTitle = mine.lpTitle;
        var cmd = new StringBuilder(Quote(exe) + " " + arguments);
        ProcessInformation pi;
        if (!CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }

    [STAThread]
    static int Main(string[] argv)
    {
        try { SetCurrentProcessExplicitAppUserModelID(AppUserModelId); } catch (Exception) { }
        try
        {
            return Run(argv);
        }
        catch (Exception e)
        {
            Fail("Deer could not start.\n\n" + e.Message);
            return 3;
        }
    }

    static void Fail(string text)
    {
        MessageBoxW(IntPtr.Zero, text, "Deer", MB_ICONERROR);
    }

    // "-name", "--name" or "/name", case-insensitive, as Gecko's own CheckArg reads flags on Windows.
    static bool IsFlag(string arg, string name)
    {
        string bare;
        if (arg.StartsWith("--")) bare = arg.Substring(2);
        else if (arg.StartsWith("-") || arg.StartsWith("/")) bare = arg.Substring(1);
        else return false;
        return string.Equals(bare, name, StringComparison.OrdinalIgnoreCase);
    }

    static bool LooksLikeFlag(string arg)
    {
        return arg.StartsWith("-") || arg.StartsWith("/");
    }

    // Quote one argument for CreateProcess the way CommandLineToArgvW reads it back.
    static string Quote(string arg)
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

    // key=value from a small ini file; null when the file or the key is missing.
    static string ReadValue(string path, string key)
    {
        try
        {
            if (!File.Exists(path)) return null;
            foreach (string line in File.ReadAllLines(path))
            {
                int eq = line.IndexOf('=');
                if (eq > 0 && string.Equals(line.Substring(0, eq).Trim(), key, StringComparison.OrdinalIgnoreCase))
                    return line.Substring(eq + 1).Trim();
            }
        }
        catch (Exception) { }
        return null;
    }

    static int Run(string[] argv)
    {
        // ---- 1. command line ----
        var args = new List<string>(argv);
        string profile = null;
        if (args.Count > 0 && IsFlag(args[0], "osint"))
        {
            if (args.Count != 3 || args[2].Length == 0 || LooksLikeFlag(args[2])) return 1;
            bool known = false;
            foreach (string f in OsintFlags) if (IsFlag(args[1], f)) known = true;
            if (!known) return 1;
            args = new List<string> { args[1], args[2] };
        }
        else
        {
            var kept = new List<string>();
            for (int i = 0; i < args.Count; i++)
            {
                string a = args[i];
                if (IsFlag(a, "osint")) return 1; // only valid as the first argument
                if (IsFlag(a, "profile"))
                {
                    if (i + 1 < args.Count) profile = args[++i];
                    continue;
                }
                if (IsFlag(a, "P") || IsFlag(a, "createprofile"))
                {
                    if (i + 1 < args.Count && !LooksLikeFlag(args[i + 1])) i++;
                    continue;
                }
                if (IsFlag(a, "ProfileManager") || IsFlag(a, "migration")) continue;
                kept.Add(a);
            }
            args = kept;
        }

        // ---- engine ----
        string home = AppDomain.CurrentDomain.BaseDirectory;
        string engineDir = Path.Combine(home, "engine");
        string exe = Path.Combine(engineDir, "deer.exe");
        if (!File.Exists(exe) || !File.Exists(Path.Combine(engineDir, PackageDir, "chrome.manifest")))
        {
            Fail("Deer can't start because some of its files are missing:\n" + exe +
                 "\n\nInstall Deer again to repair it. Your bookmarks, history and settings are kept.");
            return 2;
        }

        // ---- 2. profile ----
        if (string.IsNullOrEmpty(profile)) profile = Environment.GetEnvironmentVariable("DEER_PROFILE");
        bool oldProfile = false; // this start runs on the old (Vitre) profile: in use, or the copy failed
        string tell = null; // a copy that keeps failing: said once, after the engine started
        bool testInstall = string.Equals(ReadValue(Path.Combine(home, "install.ini"), "Mode"), "test", StringComparison.Ordinal);
        if (string.IsNullOrEmpty(profile))
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (testInstall)
                local = DeerProfileMigration.TestLocalAppData(true);
            if (local == null)
            {
                // A test install without a stand-in folder: its own test data folder, nothing else.
                string data = ReadValue(Path.Combine(home, "install.ini"), "DataDir");
                if (string.IsNullOrEmpty(data) || !DeerProfileMigration.IsInside(data, Path.GetTempPath()))
                    data = Path.Combine(Path.GetTempPath(), @"DeerTest\Data");
                profile = Path.Combine(data, "Profile");
            }
            else
            {
                DeerProfileMigration.Outcome outcome;
                string detail;
                profile = DeerProfileMigration.Prepare(local, out outcome, out detail);
                oldProfile = outcome == DeerProfileMigration.Outcome.InUse || outcome == DeerProfileMigration.Outcome.Failed;
                if (outcome == DeerProfileMigration.Outcome.Failed && !testInstall)
                    tell = DeerProfileMigration.TellOnce(local, DeerProfileMigration.NewProfile(local));
            }
        }
        profile = Path.GetFullPath(profile).TrimEnd('\\');
        Directory.CreateDirectory(profile);
        string marker = Path.Combine(profile, ProfileMarker);
        if (!File.Exists(marker)) File.WriteAllBytes(marker, new byte[0]);

        // ---- 3. first start of a new build on this profile ----
        // (Not recorded in the old profile a start falls back to: the stamp belongs to Deer's own.)
        string build = oldProfile ? null : ReadValue(Path.Combine(home, "release.ini"), "Build");
        string stamp = Path.Combine(profile, BuildStamp);
        bool purge = false;
        if (!string.IsNullOrEmpty(build))
        {
            string last = null;
            try { if (File.Exists(stamp)) last = File.ReadAllText(stamp).Trim(); } catch (Exception) { }
            purge = last != build;
        }

        // ---- 4. start ----
        var cmd = new StringBuilder();
        cmd.Append("-profile ").Append(Quote(profile));
        if (purge) cmd.Append(" -purgecaches");
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));

        // The engine inherits this environment and working directory (Gecko resolves relative file
        // arguments against it). Crash reports would go to Mozilla under Mozilla's name: Deer has no
        // crash server yet.
        Environment.SetEnvironmentVariable("MOZ_CRASHREPORTER_DISABLE", "1");
        foreach (string name in ClearEnv) Environment.SetEnvironmentVariable(name, null);
        Environment.SetEnvironmentVariable("DEER_PROFILE", null);
        Environment.SetEnvironmentVariable("DEER_TEST_LOCALAPPDATA", null);
        // Let the browser (or the instance it hands the URL to) bring its window to the front.
        AllowSetForegroundWindow(ASFW_ANY);
        try
        {
            StartEngine(exe, cmd.ToString());
        }
        catch (Win32Exception e)
        {
            Fail("Deer could not start its engine:\n" + exe + "\n\n" + e.Message);
            return 3;
        }
        if (purge)
        {
            try { File.WriteAllText(stamp, build); } catch (Exception) { }
        }
        if (tell != null) MessageBoxW(IntPtr.Zero, tell, "Deer", MB_ICONINFORMATION);
        return 0;
    }
}
