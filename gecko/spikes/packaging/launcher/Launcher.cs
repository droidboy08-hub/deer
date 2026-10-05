// Vitre.exe: the launcher a real install ships next to runtime\.
// Build (in-box .NET Framework compiler, no SDK needed):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize+
//       /win32icon:..\dist-files\vitre.ico /out:..\dist\Vitre\Vitre.exe Launcher.cs
//
// What it does:
//   * always passes -profile <Vitre's own profile dir>, so the runtime never looks at
//     %APPDATA%\Mozilla\Firefox\profiles.ini (the user's real Firefox);
//   * does NOT pass -no-remote: Gecko's own remoting then makes Vitre single-instance per profile, and
//     "Vitre.exe <url>" hands the URL to the running instance and exits;
//   * forwards every argument (URLs, -new-window, -private-window, -osint -url ... from the shell).
// VITRE_PROFILE overrides the profile directory (tests); VITRE_APP_INI switches to a renamed
// application.ini (XUL_APP_FILE) if that variant is chosen.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class VitreLauncher
{
    static string Quote(string arg)
    {
        if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return arg;
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

    [STAThread]
    static int Main(string[] args)
    {
        string home = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(home, "runtime", "firefox.exe");
        if (!File.Exists(exe)) return 2;

        string profile = Environment.GetEnvironmentVariable("VITRE_PROFILE");
        if (string.IsNullOrEmpty(profile))
            profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Vitre", "Profile");
        Directory.CreateDirectory(profile);

        // The Windows shell starts a default browser as:  Vitre.exe -osint -url "%1"
        // Gecko accepts -osint only as the FIRST argument followed by exactly one flag and one value
        // (protection against argument injection through crafted URLs). That shape is impossible once
        // -profile is added, so enforce the same rule here and forward the pair without -osint.
        if (args.Length > 0 && (args[0] == "-osint" || args[0] == "--osint" || args[0] == "/osint"))
        {
            if (args.Length != 3 || !args[1].StartsWith("-") || args[2].StartsWith("-")) return 1;
            args = new[] { args[1], args[2] };
        }

        var cmd = new StringBuilder();
        cmd.Append("-profile ").Append(Quote(profile));
        foreach (string a in args) cmd.Append(' ').Append(Quote(a));

        var psi = new ProcessStartInfo(exe, cmd.ToString());
        psi.UseShellExecute = false;
        psi.WorkingDirectory = Path.Combine(home, "runtime");
        string ini = Environment.GetEnvironmentVariable("VITRE_APP_INI");
        if (!string.IsNullOrEmpty(ini)) psi.EnvironmentVariables["XUL_APP_FILE"] = ini;
        // Never let the runtime fall back to safe-mode prompts or the crash reporter UI of Firefox.
        psi.EnvironmentVariables["MOZ_CRASHREPORTER_DISABLE"] = "1";
        using (Process p = Process.Start(psi)) { }
        return 0;
    }
}
