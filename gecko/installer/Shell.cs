// Windows plumbing shared by Deer's setup/uninstaller (Setup.cs) and the test probe (tests\Probe.cs):
// shortcuts carrying an AppUserModelID, processes running from a folder, shell notifications.
// C# 5 (the compiler that ships with the .NET Framework 4.8).
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Deer.Setup
{
    // ---- shortcuts (.lnk) -----------------------------------------------------------------------

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class CShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    struct PropertyKey
    {
        public Guid fmtid;
        public uint pid;
        public PropertyKey(Guid f, uint p) { fmtid = f; pid = p; }
    }

    // PROPVARIANT: 16 bytes on x86, 24 on x64; only VT_LPWSTR is used here.
    [StructLayout(LayoutKind.Sequential)]
    struct PropVariant
    {
        public ushort vt;
        public ushort r1, r2, r3;
        public IntPtr p;
        public IntPtr p2;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out uint cProps);
        [PreserveSig] int GetAt(uint iProp, out PropertyKey pkey);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant pv);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant pv);
        [PreserveSig] int Commit();
    }

    class ShortcutInfo
    {
        public string Target = "", Arguments = "", WorkingDirectory = "", IconPath = "", Description = "", AppUserModelId = "";
        public int IconIndex;
    }

    static class Shortcut
    {
        // PKEY_AppUserModel_ID
        static readonly Guid AppModelFmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
        const ushort VT_LPWSTR = 31;

        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant pv);

        public static void Create(string path, string target, string arguments, string workingDir, string iconPath, int iconIndex, string description, string appUserModelId)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                link.SetPath(target);
                link.SetArguments(arguments ?? "");
                link.SetWorkingDirectory(workingDir ?? "");
                link.SetIconLocation(iconPath, iconIndex);
                link.SetDescription(description ?? "");
                if (!string.IsNullOrEmpty(appUserModelId))
                {
                    var store = (IPropertyStore)link;
                    var key = new PropertyKey(AppModelFmt, 5);
                    var pv = new PropVariant();
                    pv.vt = VT_LPWSTR;
                    pv.p = Marshal.StringToCoTaskMemUni(appUserModelId);
                    try
                    {
                        Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref pv));
                        Marshal.ThrowExceptionForHR(store.Commit());
                    }
                    finally
                    {
                        PropVariantClear(ref pv);
                    }
                }
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                ((IPersistFile)link).Save(path, true);
            }
            finally
            {
                Marshal.ReleaseComObject(link);
            }
        }

        public static ShortcutInfo Read(string path)
        {
            var link = (IShellLinkW)new CShellLink();
            try
            {
                ((IPersistFile)link).Load(path, 0); // STGM_READ
                var info = new ShortcutInfo();
                var sb = new StringBuilder(1024);
                link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0x4); // SLGP_RAWPATH
                info.Target = sb.ToString();
                sb.Length = 0; link.GetArguments(sb, sb.Capacity); info.Arguments = sb.ToString();
                sb.Length = 0; link.GetWorkingDirectory(sb, sb.Capacity); info.WorkingDirectory = sb.ToString();
                sb.Length = 0; link.GetDescription(sb, sb.Capacity); info.Description = sb.ToString();
                int index;
                sb.Length = 0; link.GetIconLocation(sb, sb.Capacity, out index); info.IconPath = sb.ToString(); info.IconIndex = index;
                var store = (IPropertyStore)link;
                var key = new PropertyKey(AppModelFmt, 5);
                PropVariant pv;
                if (store.GetValue(ref key, out pv) >= 0)
                {
                    if (pv.vt == VT_LPWSTR && pv.p != IntPtr.Zero) info.AppUserModelId = Marshal.PtrToStringUni(pv.p);
                    PropVariantClear(ref pv);
                }
                return info;
            }
            finally
            {
                Marshal.ReleaseComObject(link);
            }
        }

        // Deletes the shortcut only when it points at `target` (so a user's own shortcut of the same
        // name, or one retargeted elsewhere, is left alone). Returns what happened, for the log.
        public static string RemoveIfPointsAt(string path, string target)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return "absent";
            ShortcutInfo info;
            try { info = Read(path); }
            catch (Exception e) { return "kept (unreadable: " + e.Message + ")"; }
            if (!Paths.Same(info.Target, target)) return "kept (points at " + info.Target + ")";
            File.Delete(path);
            return "removed";
        }
    }

    // ---- paths ------------------------------------------------------------------------------------

    static class Paths
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern int GetLongPathNameW(string shortPath, StringBuilder longPath, int cch);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern int GetFinalPathNameByHandleW(IntPtr file, StringBuilder path, int cch, uint flags);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        public static string Full(string path)
        {
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'))).TrimEnd('\\');
        }

        public static bool Same(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            try { return string.Equals(Full(a), Full(b), StringComparison.OrdinalIgnoreCase); }
            catch (Exception) { return false; }
        }

        public static bool IsInside(string path, string folder)
        {
            try
            {
                string p = Full(path), f = Full(folder) + "\\";
                return p.StartsWith(f, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception) { return false; }
        }

        public static string Long(string path)
        {
            var sb = new StringBuilder(1024);
            int n = GetLongPathNameW(path, sb, sb.Capacity);
            return n > 0 && n < sb.Capacity ? sb.ToString() : path;
        }

        // The path as the file system spells it (case, 8.3 names and junctions resolved): what Gecko
        // hashes for its per-install data (WinUtils::ResolveJunctionPointsAndSymLinks).
        public static string Final(string dir)
        {
            IntPtr h = CreateFileW(dir, 0, 7, IntPtr.Zero, 3 /* OPEN_EXISTING */, 0x02000000 /* BACKUP_SEMANTICS */, IntPtr.Zero);
            if (h == new IntPtr(-1)) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int n = GetFinalPathNameByHandleW(h, sb, sb.Capacity, 0);
                if (n <= 0 || n >= sb.Capacity) return null;
                string s = sb.ToString();
                if (s.StartsWith(@"\\?\UNC\")) s = @"\\" + s.Substring(8);
                else if (s.StartsWith(@"\\?\")) s = s.Substring(4);
                return s;
            }
            finally
            {
                CloseHandle(h);
            }
        }

        public static long FolderSize(string dir)
        {
            long total = 0;
            if (!Directory.Exists(dir)) return 0;
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch (Exception) { }
            }
            return total;
        }
    }

    // ---- processes ------------------------------------------------------------------------------

    static class Processes
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref int size);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        static string ImageOf(IntPtr h)
        {
            var sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageNameW(h, 0, sb, ref size) ? sb.ToString() : null;
        }

        // Processes (other than this one) whose program file lies inside `folder`: "path (pid)". Copies of
        // this very program are left out too: the uninstaller of an all-users install runs from inside
        // the folder and waits there for its elevated copy, which must not take it for a running Deer.
        public static List<string> RunningFrom(string folder)
        {
            var found = new List<string>();
            var prefixes = new List<string>();
            try
            {
                prefixes.Add(Paths.Full(folder) + "\\");
                string longForm = Paths.Long(Paths.Full(folder)) + "\\";
                if (!prefixes.Contains(longForm)) prefixes.Add(longForm);
            }
            catch (Exception) { return found; }
            int self = Process.GetCurrentProcess().Id;
            string selfImage = null;
            IntPtr me = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, self);
            if (me != IntPtr.Zero)
            {
                try { selfImage = ImageOf(me); }
                finally { CloseHandle(me); }
            }
            foreach (Process p in Process.GetProcesses())
            {
                using (p)
                {
                    if (p.Id == self || p.Id == 0 || p.Id == 4) continue;
                    IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, p.Id);
                    if (h == IntPtr.Zero) continue;
                    try
                    {
                        string image = ImageOf(h);
                        if (image == null) continue;
                        if (selfImage != null && string.Equals(image, selfImage, StringComparison.OrdinalIgnoreCase)) continue;
                        foreach (string prefix in prefixes)
                        {
                            if (image.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                            {
                                found.Add(image + " (" + p.Id + ")");
                                break;
                            }
                        }
                    }
                    finally
                    {
                        CloseHandle(h);
                    }
                }
            }
            return found;
        }
    }

    // ---- starting programs without handing them our handles ----------------------------------------

    static class Native
    {
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

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes,
            bool inheritHandles, uint flags, IntPtr environment, string currentDirectory, ref StartupInfo startup, out ProcessInformation info);

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);

        // Process.Start always lets the child inherit this process's inheritable handles (a caller's
        // output pipes among them), which would keep a script that runs setup waiting for as long as
        // the child lives. This starts `exe` with none. The environment is this process's.
        public static void Start(string exe, string arguments, string workingDir, bool noWindow)
        {
            var si = new StartupInfo();
            si.cb = Marshal.SizeOf(typeof(StartupInfo));
            if (noWindow) { si.dwFlags = 0x1; si.wShowWindow = 0; } // STARTF_USESHOWWINDOW, SW_HIDE
            var cmd = new StringBuilder("\"" + exe + "\"" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments));
            ProcessInformation pi;
            uint flags = noWindow ? 0x08000000u /* CREATE_NO_WINDOW */ : 0u;
            if (!CreateProcessW(exe, cmd, IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, workingDir, ref si, out pi))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            CloseHandle(pi.hThread);
            CloseHandle(pi.hProcess);
        }
    }

    // ---- shell ------------------------------------------------------------------------------------

    static class ShellNotify
    {
        [DllImport("shell32.dll")]
        static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

        // Tells Explorer and the Settings app that file and URL associations changed.
        public static void AssociationsChanged()
        {
            SHChangeNotify(0x08000000 /* SHCNE_ASSOCCHANGED */, 0x1000 /* SHCNF_FLUSH */, IntPtr.Zero, IntPtr.Zero);
        }
    }
}
