// The payload Deer-Setup.exe carries (resource "payload.bin"), written by installer\build.py
// (make_payload) and unpacked here. C# 5; shared with the test probe (tests\Probe.cs).
//
// Layout:
//   "DEERPKG1"                  8 bytes
//   manifest length             uint32, little-endian
//   manifest                    UTF-8 text, one record per line, fields separated by tabs:
//     deer-package <TAB> 1                                      first line
//     dir   <path>                                              an empty folder
//     file  <size> <last write time, FILETIME UTC> <path>       in stream order
//     block <filter> <lc> <lp> <pb> <packed> <unpacked> <crc32> in stream order
//   the blocks' packed bytes, one after the other
// The files' bytes, in "file" order, form one stream; that stream is cut into blocks (16 MB by
// default), each compressed on its own as raw LZMA1 ("lzma"), the .exe/.dll part first through the
// x86 BCJ filter ("x86+lzma"). Independent blocks let several threads decode at once, and each block
// carries the CRC-32 of its decoded bytes. Paths use "/" and are relative to the install folder.
// The whole resource is covered by the SHA-256 in payload.ini, checked before anything is unpacked.
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

namespace Deer.Setup
{
    sealed class PackageFile
    {
        public string Path;
        public long Size;
        public long FileTime;
    }

    sealed class PackageBlock
    {
        public bool X86;
        public int Lc, Lp, Pb, Unpacked;
        public long Offset, Packed;
        public uint Crc;
    }

    sealed class Package
    {
        public const string Magic = "DEERPKG1";
        public const int MaxBlock = 256 << 20;

        public readonly List<string> Dirs = new List<string>();
        public readonly List<PackageFile> Files = new List<PackageFile>();
        public readonly List<PackageBlock> Blocks = new List<PackageBlock>();
        public long DataStart, TotalUnpacked, TotalPacked;

        static InvalidDataException Bad(string what)
        {
            return new InvalidDataException("The package is damaged (" + what + ").");
        }

        static void ReadExactly(Stream s, byte[] buffer, int count)
        {
            int done = 0;
            while (done < count)
            {
                int n = s.Read(buffer, done, count - done);
                if (n <= 0) throw Bad("unexpected end");
                done += n;
            }
        }

        // A relative path with "/" separators and no ".", "..", empty, rooted or drive parts.
        public static string CheckPath(string path)
        {
            if (string.IsNullOrEmpty(path) || path.IndexOf('\\') >= 0) throw Bad("invalid path " + path);
            foreach (string part in path.Split('/'))
            {
                if (part.Length == 0 || part == "." || part == ".." || part.IndexOf(':') >= 0 || part.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) >= 0)
                    throw Bad("invalid path " + path);
            }
            return path.Replace('/', '\\');
        }

        static long Number(string text, long max)
        {
            long v;
            if (!long.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out v) || v < 0 || v > max) throw Bad("invalid number " + text);
            return v;
        }

        public static Package Read(Stream s)
        {
            var p = new Package();
            var head = new byte[12];
            ReadExactly(s, head, 12);
            if (Encoding.ASCII.GetString(head, 0, 8) != Magic) throw Bad("not a Deer package");
            int length = BitConverter.ToInt32(head, 8);
            if (length <= 0 || length > (16 << 20)) throw Bad("manifest size");
            var text = new byte[length];
            ReadExactly(s, text, length);
            p.DataStart = 12 + length;
            string[] lines = new UTF8Encoding(false, true).GetString(text).Split('\n');
            if (lines[0] != "deer-package\t1") throw Bad("unknown package version");
            long offset = 0;
            for (int i = 1; i < lines.Length; i++)
            {
                if (lines[i].Length == 0) continue;
                string[] f = lines[i].Split('\t');
                if (f[0] == "dir" && f.Length == 2) p.Dirs.Add(CheckPath(f[1]));
                else if (f[0] == "file" && f.Length == 4)
                {
                    var e = new PackageFile { Size = Number(f[1], long.MaxValue / 4), FileTime = Number(f[2], long.MaxValue / 4), Path = CheckPath(f[3]) };
                    p.Files.Add(e);
                    p.TotalUnpacked += e.Size;
                }
                else if (f[0] == "block" && f.Length == 8)
                {
                    if (f[1] != "lzma" && f[1] != "x86+lzma") throw Bad("unknown filter " + f[1]);
                    uint crc;
                    if (!uint.TryParse(f[7], NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out crc)) throw Bad("invalid CRC " + f[7]);
                    var b = new PackageBlock
                    {
                        X86 = f[1] == "x86+lzma",
                        Lc = (int)Number(f[2], 8), Lp = (int)Number(f[3], 4), Pb = (int)Number(f[4], 4),
                        Packed = Number(f[5], MaxBlock + (MaxBlock >> 4) + 65536),
                        Unpacked = (int)Number(f[6], MaxBlock),
                        Crc = crc,
                        Offset = offset,
                    };
                    offset += b.Packed;
                    p.Blocks.Add(b);
                }
                else throw Bad("unknown record " + f[0]);
            }
            p.TotalPacked = offset;
            long unpacked = 0;
            foreach (PackageBlock b in p.Blocks) unpacked += b.Unpacked;
            if (unpacked != p.TotalUnpacked) throw Bad("the blocks do not hold the files");
            if (s.CanSeek && s.Length != p.DataStart + p.TotalPacked) throw Bad("size");
            return p;
        }

        // ---- unpacking ----

        sealed class Run
        {
            public readonly object Gate = new object();
            public byte[][] Done;
            public readonly Stack<byte[]> Pool = new Stack<byte[]>();
            public int Next, Written;
            public Exception Error;
            public bool Stop;
        }

        // Unpacks every file and empty folder into `dest` (which must exist and should be empty: files
        // are created, never overwritten). `open` returns a new stream over the whole package, one per
        // decoding thread. `progress` is called on this thread with the bytes written so far.
        public void Extract(Func<Stream> open, string dest, int threads, Action<long> progress)
        {
            foreach (string d in Dirs) Directory.CreateDirectory(System.IO.Path.Combine(dest, d));
            int workers = Math.Max(1, Math.Min(threads, Blocks.Count));
            int ahead = workers + 2; // decoded blocks waiting for the writer, at most
            var run = new Run();
            run.Done = new byte[Blocks.Count][];
            var pool = new List<Thread>();
            for (int w = 0; w < workers; w++)
            {
                var t = new Thread(delegate () { Work(run, open, ahead); });
                t.IsBackground = true;
                t.Name = "Deer package decoder";
                t.Start();
                pool.Add(t);
            }
            try
            {
                Write(run, dest, progress);
            }
            finally
            {
                lock (run.Gate)
                {
                    run.Stop = true;
                    Monitor.PulseAll(run.Gate);
                }
                foreach (Thread t in pool) t.Join();
            }
        }

        void Work(Run run, Func<Stream> open, int ahead)
        {
            try
            {
                long largestPacked = 0;
                int largestUnpacked = 0;
                foreach (PackageBlock x in Blocks)
                {
                    largestPacked = Math.Max(largestPacked, x.Packed);
                    largestUnpacked = Math.Max(largestUnpacked, x.Unpacked);
                }
                var packed = new byte[largestPacked];
                using (Stream s = open())
                {
                    while (true)
                    {
                        int i;
                        byte[] output;
                        lock (run.Gate)
                        {
                            while (!run.Stop && run.Error == null && run.Next < Blocks.Count && run.Next - run.Written >= ahead) Monitor.Wait(run.Gate);
                            if (run.Stop || run.Error != null || run.Next >= Blocks.Count) return;
                            i = run.Next++;
                            output = run.Pool.Count > 0 ? run.Pool.Pop() : null;
                        }
                        PackageBlock b = Blocks[i];
                        if (output == null) output = new byte[largestUnpacked];
                        s.Position = DataStart + b.Offset;
                        ReadExactly(s, packed, (int)b.Packed);
                        new LzmaDecoder(b.Lc, b.Lp, b.Pb).Decode(packed, (int)b.Packed, output, b.Unpacked);
                        if (b.X86) BcjX86.Decode(output, b.Unpacked);
                        if (Crc32.Compute(output, b.Unpacked) != b.Crc) throw Bad("block " + i + " checksum");
                        lock (run.Gate)
                        {
                            run.Done[i] = output;
                            Monitor.PulseAll(run.Gate);
                        }
                    }
                }
            }
            catch (Exception e)
            {
                lock (run.Gate)
                {
                    if (run.Error == null) run.Error = e;
                    Monitor.PulseAll(run.Gate);
                }
            }
        }

        void Write(Run run, string dest, Action<long> progress)
        {
            int file = -1;
            FileStream current = null;
            string currentPath = null;
            long left = 0, written = 0;
            try
            {
                for (int i = 0; i < Blocks.Count; i++)
                {
                    byte[] data;
                    lock (run.Gate)
                    {
                        while (run.Done[i] == null && run.Error == null) Monitor.Wait(run.Gate);
                        if (run.Error != null)
                        {
                            if (run.Error is InvalidDataException) throw new InvalidDataException(run.Error.Message, run.Error);
                            throw new IOException("Unpacking failed: " + run.Error.Message, run.Error);
                        }
                        data = run.Done[i];
                        run.Done[i] = null;
                    }
                    int length = Blocks[i].Unpacked, at = 0;
                    while (at < length)
                    {
                        while (left == 0)
                        {
                            Close(ref current, currentPath, Files, file);
                            file++;
                            if (file >= Files.Count) throw Bad("more data than files");
                            currentPath = Open(dest, Files[file], out current);
                            left = Files[file].Size;
                        }
                        int n = (int)Math.Min(left, length - at);
                        current.Write(data, at, n);
                        at += n;
                        left -= n;
                        written += n;
                        progress(written);
                    }
                    lock (run.Gate)
                    {
                        run.Pool.Push(data);
                        run.Written = i + 1;
                        Monitor.PulseAll(run.Gate);
                    }
                }
                if (left != 0) throw Bad("a file is cut short");
                Close(ref current, currentPath, Files, file);
                for (file++; file < Files.Count; file++)
                {
                    if (Files[file].Size != 0) throw Bad("files without data");
                    FileStream empty;
                    string path = Open(dest, Files[file], out empty);
                    Close(ref empty, path, Files, file);
                }
            }
            finally
            {
                if (current != null) current.Dispose();
            }
        }

        static string Open(string dest, PackageFile f, out FileStream stream)
        {
            string path = System.IO.Path.Combine(dest, f.Path);
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16);
            if (f.Size > (1 << 20)) stream.SetLength(f.Size); // one allocation for a big file
            return path;
        }

        static void Close(ref FileStream stream, string path, List<PackageFile> files, int index)
        {
            if (stream == null) return;
            stream.Dispose();
            stream = null;
            File.SetLastWriteTimeUtc(path, DateTime.FromFileTimeUtc(files[index].FileTime));
        }
    }
}
