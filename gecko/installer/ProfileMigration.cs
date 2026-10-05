// The move from Vitre to Deer: the browser was developed under the name Vitre, with its profile in
// %LOCALAPPDATA%\Vitre\Profile (marked by the file "vitre-profile"). On the first start of Deer, that
// old profile is copied to Deer's place. Compiled into both launchers, each with its own place:
//   the installed Deer.exe (installer\Launcher.cs, by installer\build.py)    %LOCALAPPDATA%\Deer\Profile
//   the development launcher (launcher\Launcher.cs, tools\build-launcher.mjs) %LOCALAPPDATA%\Deer Dev\Profile
// The two never share a profile: they run different engines (the development runtime keeps Mozilla's
// remoting name, the release engine is "deer", and an updated release engine may be newer than the
// development runtime), and the uninstaller's "delete my data" deletes %LOCALAPPDATA%\Deer only.
// Both copy from the same old profile, each once. Only a start on the default profile migrates; a
// profile given with -profile or DEER_PROFILE never does.
//
// Rules:
//   * Only when the new profile folder does not exist yet, or holds nothing but what a launcher writes
//     itself (the "vitre-profile" marker, the "deer-build" stamp: a profile no browser ever ran on),
//     and the old one exists with its marker. The old profile is copied, never moved, renamed or
//     changed (apart from the lock below).
//   * The copy goes into <new>.migrating-<process id> and is renamed to the new profile only once it is
//     complete, so a crash or a power cut leaves no half profile; the next start deletes such a
//     leftover and copies again.
//   * During the copy the old profile is locked exactly as Gecko locks a profile it runs on
//     (parent.lock opened with no sharing, deleted when closed). When that lock can't be taken, a
//     browser is running on the old profile: nothing is copied, this start uses the old profile (a
//     running development build then gets the window or the URL through Gecko's remoting) and the copy
//     is tried again on the next start. A stale parent.lock left by a crash is taken and removed, as
//     Gecko itself does on its next start.
//   * Not copied: the lock files (parent.lock, lock, .parentlock) and the two caches Gecko rebuilds by
//     itself (cache2, startupCache, both at the top of the profile). Junctions and links are not
//     followed. Paths of any length are copied (\\?\ paths through Win32), so a deep storage folder can
//     never make the copy fail on every start.
//   * Free space first: what is to be copied is measured, and the copy is not started when the drive
//     has less free than that plus 256 MB (it fails with that reason).
//   * One migration at a time (the mutex Local\Deer.ProfileMigration): a second launcher started
//     meanwhile waits for the first (at most 10 minutes), then finds the new profile in place.
//   * When the copy fails (disk full, an unreadable file), the partial copy is deleted and this start
//     uses the old profile. Each failure is recorded next to the new profile (<new>.copy-failed: the
//     count, the time and the reason). The start after the first failure tries again; after two or
//     more, at most one attempt a day. A success removes the record. No window: a launcher that wants
//     to tell the person asks TellOnce, which answers once per record.
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class DeerProfileMigration
{
    public const string OldMarker = "vitre-profile";
    public const string BuildStamp = "deer-build";
    public const string TempSuffix = ".migrating-";
    public const string FailedSuffix = ".copy-failed";
    const string GateName = @"Local\Deer.ProfileMigration";
    const long FreeMargin = 256L * 1024 * 1024;
    static readonly string[] SkippedFiles = { "parent.lock", "lock", ".parentlock" };
    static readonly string[] SkippedFolders = { "cache2", "startupCache" };
    // What a launcher writes into a profile folder by itself (a folder holding only these is "blank").
    static readonly string[] LauncherFiles = { OldMarker, BuildStamp };

    // Tests (installer\tests\Probe.cs): the free space to assume, in bytes (-1: the drive's).
    public static long FreeSpaceForTest = -1;

    public enum Outcome { None, Copied, InUse, Failed }

    public static string OldProfile(string localAppData) { return Path.Combine(Path.Combine(localAppData, "Vitre"), "Profile"); }
    public static string NewProfile(string localAppData) { return Path.Combine(Path.Combine(localAppData, "Deer"), "Profile"); }
    public static string DevProfile(string localAppData) { return Path.Combine(Path.Combine(localAppData, "Deer Dev"), "Profile"); }

    // True when `path` lies inside `folder` (both made absolute; case ignored).
    public static bool IsInside(string path, string folder)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(folder)) return false;
        try
        {
            string p = Path.GetFullPath(path).TrimEnd('\\'), f = Path.GetFullPath(folder).TrimEnd('\\') + "\\";
            return p.StartsWith(f, StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception) { return false; }
    }

    // The %LOCALAPPDATA% a test may put in place of the real one (DEER_TEST_LOCALAPPDATA): honoured only
    // when the caller says it runs in test mode and the folder lies inside %TEMP%. Null otherwise.
    public static string TestLocalAppData(bool testMode)
    {
        if (!testMode) return null;
        string v = Environment.GetEnvironmentVariable("DEER_TEST_LOCALAPPDATA");
        if (string.IsNullOrEmpty(v) || !IsInside(v, Path.GetTempPath())) return null;
        return Path.GetFullPath(v).TrimEnd('\\');
    }

    // The installed Deer's default profile under `localAppData`, copied from the old one first when it applies.
    public static string Prepare(string localAppData, out Outcome outcome, out string detail)
    {
        return Prepare(localAppData, NewProfile(localAppData), out outcome, out detail);
    }

    // The profile `target` (NewProfile or DevProfile of `localAppData`), copied from the old one first
    // when it applies. Returns the profile folder this start must use: `target`, or the old one (in use,
    // the copy failed, or it waits after failing).
    public static string Prepare(string localAppData, string target, out Outcome outcome, out string detail)
    {
        localAppData = Path.GetFullPath(localAppData).TrimEnd('\\');
        target = Path.GetFullPath(target).TrimEnd('\\');
        string old = OldProfile(localAppData);
        outcome = Outcome.None;
        detail = null;
        if (!Wanted(target, old)) return target;

        Mutex gate = null;
        bool owned = false;
        try
        {
            try
            {
                gate = new Mutex(false, GateName);
                owned = gate.WaitOne(TimeSpan.FromMinutes(10));
            }
            catch (AbandonedMutexException) { owned = true; }
            catch (Exception) { gate = null; } // no mutex to be had: go on alone
            if (gate != null && !owned)
            {
                outcome = Outcome.InUse;
                detail = "another start has been copying the profile for 10 minutes";
                return old;
            }
            // The launcher that held the mutex may have done it already.
            if (!Wanted(target, old)) return target;
            RemoveLeftovers(target);

            Failure last = Failure.Read(target);
            if (last != null && last.Count >= 2 && DateTime.UtcNow < last.When.AddDays(1))
            {
                outcome = Outcome.Failed;
                detail = "not tried again before " + last.When.AddDays(1).ToString("u", CultureInfo.InvariantCulture) + " (the copy failed " +
                         last.Count + " times; last: " + last.Reason + ")";
                return old;
            }

            FileStream profileLock;
            try
            {
                profileLock = new FileStream(Path.Combine(old, "parent.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1,
                                             FileOptions.DeleteOnClose);
            }
            catch (Exception e)
            {
                outcome = Outcome.InUse;
                detail = e.Message;
                return old;
            }
            using (profileLock)
            {
                string temp = target + TempSuffix + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture);
                try
                {
                    string parent = Path.GetDirectoryName(target);
                    Directory.CreateDirectory(parent);
                    long need = Measure(old, true);
                    long free = FreeSpaceForTest >= 0 ? FreeSpaceForTest : Win32.FreeSpace(parent);
                    if (free >= 0 && free < need + FreeMargin)
                        throw new IOException(string.Format(CultureInfo.InvariantCulture, "not enough free space: the copy needs {0} MB and {1} MB are free",
                                                            (need + FreeMargin + (1 << 20) - 1) >> 20, free >> 20));
                    if (Directory.Exists(target)) ClearBlank(target); // a blank profile no browser ran on (see Wanted)
                    Win32.CreateDirectory(temp);
                    CopyTree(old, temp, true);
                    Win32.Move(temp, target);
                    Failure.Clear(target);
                    outcome = Outcome.Copied;
                    return target;
                }
                catch (Exception e)
                {
                    try { if (Directory.Exists(temp)) Win32.DeleteTree(temp); } catch (Exception) { }
                    Failure.Add(target, e.Message);
                    outcome = Outcome.Failed;
                    detail = e.Message;
                    return old;
                }
            }
        }
        finally
        {
            if (owned) { try { gate.ReleaseMutex(); } catch (Exception) { } }
            if (gate != null) gate.Dispose();
        }
    }

    // The copy applies: the old profile is there with its marker, and the new one is absent or blank.
    static bool Wanted(string target, string old)
    {
        return File.Exists(Path.Combine(old, OldMarker)) && (!Directory.Exists(target) || IsBlank(target));
    }

    // A profile folder holding only what a launcher writes itself: no browser ever ran on it.
    public static bool IsBlank(string dir)
    {
        try
        {
            foreach (Win32.Entry e in Win32.List(dir))
            {
                if ((e.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) return false;
                if (Array.IndexOf(LauncherFiles, e.Name.ToLowerInvariant()) < 0) return false;
            }
            return true;
        }
        catch (Exception) { return false; }
    }

    static void ClearBlank(string dir)
    {
        if (!IsBlank(dir)) throw new IOException(dir + " is no longer empty");
        foreach (Win32.Entry e in Win32.List(dir)) Win32.DeleteFile(Path.Combine(dir, e.Name));
        Win32.RemoveDirectory(dir);
    }

    // What a launcher may tell the person about a copy that keeps failing (`target`'s record, failed at
    // least twice), once per record: the text the first time it is asked, null afterwards and otherwise.
    public static string TellOnce(string localAppData, string target)
    {
        Failure f = Failure.Read(target);
        if (f == null || f.Count < 2 || f.Told) return null;
        f.Told = true;
        f.Write(target);
        return "Deer couldn't copy your browsing data from\n" + OldProfile(Path.GetFullPath(localAppData).TrimEnd('\\')) + "\n\n" + f.Reason +
               "\n\nDeer uses it where it is for now and tries again once a day.";
    }

    // <target>.copy-failed: "count=", "last=" (UTC, ISO 8601), "reason=", "told=" lines.
    public class Failure
    {
        public int Count;
        public DateTime When;
        public string Reason = "";
        public bool Told;

        public static string PathOf(string target) { return target.TrimEnd('\\') + FailedSuffix; }

        public static Failure Read(string target)
        {
            try
            {
                string path = PathOf(target);
                if (!File.Exists(path)) return null;
                var f = new Failure();
                foreach (string line in File.ReadAllLines(path))
                {
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string k = line.Substring(0, eq).Trim(), v = line.Substring(eq + 1).Trim();
                    if (k == "count") int.TryParse(v, NumberStyles.Integer, CultureInfo.InvariantCulture, out f.Count);
                    else if (k == "last") DateTime.TryParse(v, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out f.When);
                    else if (k == "reason") f.Reason = v;
                    else if (k == "told") f.Told = v == "1";
                }
                return f;
            }
            catch (Exception) { return null; }
        }

        public void Write(string target)
        {
            try
            {
                File.WriteAllText(PathOf(target), "count=" + Count.ToString(CultureInfo.InvariantCulture) + "\r\nlast=" +
                                  When.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture) + "\r\nreason=" +
                                  (Reason ?? "").Replace('\r', ' ').Replace('\n', ' ') + "\r\ntold=" + (Told ? "1" : "0") + "\r\n", new UTF8Encoding(false));
            }
            catch (Exception) { } // not fatal: the next start tries again
        }

        public static void Add(string target, string reason)
        {
            Failure f = Read(target) ?? new Failure();
            f.Count++;
            f.When = DateTime.UtcNow;
            f.Reason = reason;
            f.Write(target);
        }

        public static void Clear(string target)
        {
            try { File.Delete(PathOf(target)); } catch (Exception) { }
        }
    }

    // Copies left by a start that crashed or lost power half way (only ever called under the mutex).
    static void RemoveLeftovers(string target)
    {
        string parent = Path.GetDirectoryName(target);
        if (!Directory.Exists(parent)) return;
        foreach (string dir in Directory.GetDirectories(parent, Path.GetFileName(target) + TempSuffix + "*"))
        {
            try { Win32.DeleteTree(dir); } catch (Exception) { }
        }
    }

    static bool Skipped(string[] list, string name)
    {
        foreach (string s in list) if (string.Equals(s, name, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // The bytes CopyTree copies.
    static long Measure(string from, bool top)
    {
        long sum = 0;
        foreach (Win32.Entry e in Win32.List(from))
        {
            if ((e.Attributes & FileAttributes.ReparsePoint) != 0) continue;
            if ((e.Attributes & FileAttributes.Directory) != 0)
            {
                if (top && Skipped(SkippedFolders, e.Name)) continue;
                sum += Measure(Path.Combine(from, e.Name), false);
            }
            else if (!(top && Skipped(SkippedFiles, e.Name))) sum += e.Size;
        }
        return sum;
    }

    static void CopyTree(string from, string to, bool top)
    {
        foreach (Win32.Entry e in Win32.List(from))
        {
            if ((e.Attributes & FileAttributes.ReparsePoint) != 0) continue; // junctions and links: not followed
            string src = Path.Combine(from, e.Name), dst = Path.Combine(to, e.Name);
            if ((e.Attributes & FileAttributes.Directory) != 0)
            {
                if (top && Skipped(SkippedFolders, e.Name)) continue;
                Win32.CreateDirectory(dst);
                CopyTree(src, dst, false);
            }
            else
            {
                if (top && Skipped(SkippedFiles, e.Name)) continue;
                Win32.CopyFile(src, dst);
            }
        }
    }

    // File operations on \\?\ paths (no MAX_PATH limit, whatever the .NET Framework's path rules).
    public static class Win32
    {
        // WIN32_FIND_DATAW (each FILETIME as two DWORDs: the structure is 4-byte aligned).
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct FindData
        {
            public uint Attributes;
            public uint CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh;
            public uint SizeHigh, SizeLow, Reserved0, Reserved1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)] public string ShortName;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr FindFirstFileExW(string name, int infoLevel, out FindData data, int searchOp, IntPtr filter, int flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool FindNextFileW(IntPtr find, out FindData data);

        [DllImport("kernel32.dll")]
        static extern bool FindClose(IntPtr find);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CopyFileW(string from, string to, bool failIfExists);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateDirectoryW(string path, IntPtr security);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool RemoveDirectoryW(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool DeleteFileW(string path);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool SetFileAttributesW(string path, uint attributes);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool MoveFileExW(string from, string to, int flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool GetDiskFreeSpaceExW(string folder, out ulong freeToCaller, out ulong total, out ulong totalFree);

        public struct Entry
        {
            public string Name;
            public FileAttributes Attributes;
            public long Size;
        }

        // Every path here is absolute and normalised (a GetFullPath'd root plus plain names), so it only
        // needs the prefix; GetFullPath itself would refuse a path over MAX_PATH.
        static string Long(string path)
        {
            if (path.StartsWith(@"\\?\")) return path;
            if (path.StartsWith(@"\\")) return @"\\?\UNC\" + path.Substring(2);
            return @"\\?\" + path;
        }

        static Exception Error(string what, string path)
        {
            int code = Marshal.GetLastWin32Error();
            return new IOException(what + " " + path + ": " + new Win32Exception(code).Message, code);
        }

        public static List<Entry> List(string dir)
        {
            var list = new List<Entry>();
            FindData d;
            // FindExInfoBasic (no 8.3 names), FIND_FIRST_EX_LARGE_FETCH
            IntPtr h = FindFirstFileExW(Long(dir) + "\\*", 1, out d, 0, IntPtr.Zero, 2);
            if (h == new IntPtr(-1))
            {
                if (Marshal.GetLastWin32Error() == 2 /* ERROR_FILE_NOT_FOUND: empty */) return list;
                throw Error("cannot list", dir);
            }
            try
            {
                do
                {
                    if (d.Name == "." || d.Name == "..") continue;
                    list.Add(new Entry { Name = d.Name, Attributes = (FileAttributes)d.Attributes, Size = ((long)d.SizeHigh << 32) | d.SizeLow });
                } while (FindNextFileW(h, out d));
                if (Marshal.GetLastWin32Error() != 18 /* ERROR_NO_MORE_FILES */) throw Error("cannot list", dir);
            }
            finally { FindClose(h); }
            return list;
        }

        // Bytes free to this account on the drive of `folder` (an existing folder); -1 when unknown.
        public static long FreeSpace(string folder)
        {
            ulong free, total, totalFree;
            if (!GetDiskFreeSpaceExW(folder.TrimEnd('\\') + "\\", out free, out total, out totalFree)) return -1;
            return free > long.MaxValue ? long.MaxValue : (long)free;
        }

        public static void CopyFile(string from, string to)
        {
            if (!CopyFileW(Long(from), Long(to), true)) throw Error("cannot copy", from);
        }

        // The parent must exist (the copy creates folders top down).
        public static void CreateDirectory(string path)
        {
            if (!CreateDirectoryW(Long(path), IntPtr.Zero)) throw Error("cannot create", path);
        }

        public static void Move(string from, string to)
        {
            if (!MoveFileExW(Long(from), Long(to), 0)) throw Error("cannot rename", from);
        }

        public static void DeleteFile(string path)
        {
            SetFileAttributesW(Long(path), 0x80 /* NORMAL */);
            if (!DeleteFileW(Long(path))) throw Error("cannot delete", path);
        }

        public static void RemoveDirectory(string path)
        {
            if (!RemoveDirectoryW(Long(path))) throw Error("cannot delete", path);
        }

        public static void DeleteTree(string dir)
        {
            foreach (Entry e in List(dir))
            {
                string p = Path.Combine(dir, e.Name);
                if ((e.Attributes & FileAttributes.Directory) != 0 && (e.Attributes & FileAttributes.ReparsePoint) == 0)
                {
                    DeleteTree(p);
                    continue;
                }
                SetFileAttributesW(Long(p), 0x80 /* NORMAL */);
                bool ok = (e.Attributes & FileAttributes.Directory) != 0 ? RemoveDirectoryW(Long(p)) : DeleteFileW(Long(p));
                if (!ok) throw Error("cannot delete", p);
            }
            if (!RemoveDirectoryW(Long(dir))) throw Error("cannot delete", dir);
        }
    }
}
