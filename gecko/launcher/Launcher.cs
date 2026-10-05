// Deer.exe, the development launcher: starts the development runtime (gecko\runtime, a byte copy of the
// branded Firefox named vitre.exe) with the chrome package built from gecko\src. Built with the in-box
// .NET Framework compiler (no SDK needed):
//   node tools/build-launcher.mjs
//   (csc /target:winexe /win32icon:<the gold Deer icon> /out:launcher\Deer.exe launcher\Launcher.cs installer\ProfileMigration.cs)
// launcher\Deer.cmd runs it from a console or a script (and builds it when it is missing).
// The installed Deer has its own launcher: installer\Launcher.cs.
//
// What it does:
//   * finds the runtime: <folder of Deer.exe>\runtime, or ..\runtime (the development tree);
//   * profile: -profile <dir>, else %DEER_PROFILE%, else %VITRE_PROFILE% (the name older test scripts
//     set), else %LOCALAPPDATA%\Deer Dev\Profile: the development profile, never the installed Deer's
//     %LOCALAPPDATA%\Deer\Profile (the development runtime keeps Mozilla's remoting name and may be
//     older than an updated release engine, so the two must not share a profile; and an uninstall
//     that deletes Deer's data leaves it alone). Only that default one is copied first from the
//     profile the development build used under the name Vitre, %LOCALAPPDATA%\Vitre\Profile, when it
//     does not exist yet or is blank (installer\ProfileMigration.cs: a copy, never a move; while a
//     browser runs on the old profile, this start uses the old one, so the running browser gets the
//     window or the URL, and the copy waits for the next start; silent, the reasons of a failed copy
//     are in %LOCALAPPDATA%\Deer Dev\Profile.copy-failed). DEER_TEST_LOCALAPPDATA, a folder inside
//     %TEMP%, stands in for %LOCALAPPDATA% (tests);
//   * creates the profile folder and the marker file "vitre-profile" in it (runtime\config.js refuses
//     to run in a profile without the marker);
//   * starts runtime\vitre.exe -profile <profile> plus every argument it was given. Always -profile, so
//     the runtime never looks at %APPDATA%\Mozilla\Firefox (the user's real Firefox). Arguments that
//     would make Gecko pick a profile itself are dropped (-P [name], -ProfileManager, -createprofile
//     <x>, -migration; -profile <dir> is taken as the profile);
//   * never passes -no-remote: Gecko's own remoting is keyed by profile path, so a second launch hands
//     its URL to the running instance and exits (single instance, URL hand-off);
//   * removes XUL_APP_FILE, XRE_PROFILE_PATH and XRE_PROFILE_LOCAL_PATH from the runtime's environment
//     (Gecko prefers them to the application and the -profile given here), and MOZ_NEW_INSTANCE (it turns
//     Gecko's remoting off: a second start would not hand its URL over).
// Exit codes: 0 started, 1 bad -osint shape, 2 runtime or package missing, 3 any other failure.
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class DeerDevLauncher
{
    static readonly string[] ClearEnv = { "XUL_APP_FILE", "XRE_PROFILE_PATH", "XRE_PROFILE_LOCAL_PATH", "MOZ_NEW_INSTANCE" };
    static readonly string[] OsintFlags = { "url", "new-tab", "new-window", "private-window" };

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

    // "-name", "--name" or "/name", case-insensitive, as Gecko reads flags on Windows.
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

    [STAThread]
    static int Main(string[] argv)
    {
        try
        {
            return Run(argv);
        }
        catch (Exception)
        {
            return 3;
        }
    }

    static int Run(string[] argv)
    {
        string home = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(home, "runtime");
        if (!File.Exists(Path.Combine(runtime, "vitre.exe")))
            runtime = Path.GetFullPath(Path.Combine(home, "..", "runtime"));
        string exe = Path.Combine(runtime, "vitre.exe");
        if (!File.Exists(exe) || !File.Exists(Path.Combine(runtime, "vitre", "chrome.manifest"))) return 2;

        // The Windows shell starts a default browser as:  Deer.exe -osint -url "%1"
        // Gecko accepts -osint only as the FIRST argument followed by exactly one flag and one value
        // (protection against argument injection through crafted URLs). That shape is impossible once
        // -profile is added, so enforce the same rule here and forward the pair without -osint.
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

        if (string.IsNullOrEmpty(profile)) profile = Environment.GetEnvironmentVariable("DEER_PROFILE");
        if (string.IsNullOrEmpty(profile)) profile = Environment.GetEnvironmentVariable("VITRE_PROFILE");
        if (string.IsNullOrEmpty(profile))
        {
            string local = DeerProfileMigration.TestLocalAppData(true) ??
                           Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            DeerProfileMigration.Outcome outcome;
            string detail;
            profile = DeerProfileMigration.Prepare(local, DeerProfileMigration.DevProfile(local), out outcome, out detail);
        }
        profile = Path.GetFullPath(profile).TrimEnd('\\');
        Directory.CreateDirectory(profile);
        string marker = Path.Combine(profile, DeerProfileMigration.OldMarker);
        if (!File.Exists(marker)) File.WriteAllBytes(marker, new byte[0]);

        var cmd = new StringBuilder();
        cmd.Append("-profile ").Append(Quote(profile));
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));

        // The runtime inherits this environment and working directory (Gecko resolves relative file
        // arguments against it). Never Firefox's crash reporter UI.
        Environment.SetEnvironmentVariable("MOZ_CRASHREPORTER_DISABLE", "1");
        foreach (string name in ClearEnv) Environment.SetEnvironmentVariable(name, null);
        foreach (string name in new[] { "DEER_PROFILE", "VITRE_PROFILE", "DEER_TEST_LOCALAPPDATA" }) Environment.SetEnvironmentVariable(name, null);
        StartRuntime(exe, cmd.ToString());
        return 0;
    }

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

    // Starts the runtime without inheriting any handle (a script capturing Deer.exe's output is not held
    // until the browser quits), with the shell's show state and shortcut identity passed on.
    static void StartRuntime(string exe, string arguments)
    {
        const int forwarded = 0x1 | 0x40 | 0x80 | 0x800 | 0x1000 | 0x2000; // USESHOWWINDOW, FORCEON/OFFFEEDBACK, TITLEISLINKNAME, TITLEISAPPID, PREVENTPINNING
        StartupInfo mine;
        GetStartupInfoW(out mine);
        var si = new StartupInfo();
        si.cb = Marshal.SizeOf(typeof(StartupInfo));
        si.dwFlags = mine.dwFlags & forwarded;
        si.wShowWindow = mine.wShowWindow;
        if ((si.dwFlags & (0x800 | 0x1000)) != 0) si.lpTitle = mine.lpTitle;
        var cmd = new StringBuilder(Quote(exe) + " " + arguments);
        ProcessInformation pi;
        if (!CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
    }
}
