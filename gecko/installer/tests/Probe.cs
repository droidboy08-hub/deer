// Test helper for installer\test.py, tests\lzma_roundtrip.py and tests\migration.py (console). Built with
// Shell.cs, EngineTraces.cs, Lzma.cs, Package.cs and ProfileMigration.cs.
//   probe lnk <file.lnk>     prints target, arguments, working dir, icon and AppUserModelID, one per line
//   probe hash <folder>...   prints Gecko's install hash of each folder spelling
//   probe lzma <in> <out> <size> <lc> <lp> <pb> <x86 0|1>
//                            decodes one raw LZMA1 stream (then the x86 BCJ filter when 1) of <size>
//                            bytes into <out>; exit 2 with the reason when the stream is refused
//   probe unpack <payload.bin> <folder> [threads]
//                            unpacks a Deer package as Setup.cs does; prints files, bytes and seconds
//   probe migrate <folder> [--dev] [--free-mb N]
//                            runs the launchers' profile copy (ProfileMigration.cs) with <folder>, which
//                            must lie inside %TEMP%, as %LOCALAPPDATA%; prints outcome, profile, detail.
//                            --dev: the development launcher's profile (Deer Dev\Profile) instead of the
//                            installed Deer's (Deer\Profile); --free-mb: the free space to assume
//   probe tell <folder> [--dev]
//                            what the installed launcher would tell the person about a copy that keeps
//                            failing (ProfileMigration.TellOnce): "tell=" and the text, once
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Diagnostics;
using System.IO;
using Deer.Setup;

static class Probe
{
    [STAThread]
    static int Main(string[] args)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        if (args.Length >= 2 && args[0] == "lnk")
        {
            ShortcutInfo i = Shortcut.Read(args[1]);
            Console.WriteLine("target=" + i.Target);
            Console.WriteLine("arguments=" + i.Arguments);
            Console.WriteLine("workdir=" + i.WorkingDirectory);
            Console.WriteLine("icon=" + i.IconPath + "," + i.IconIndex);
            Console.WriteLine("description=" + i.Description);
            Console.WriteLine("aumid=" + i.AppUserModelId);
            return 0;
        }
        if (args.Length >= 2 && args[0] == "hash")
        {
            for (int n = 1; n < args.Length; n++) Console.WriteLine(EngineTraces.InstallHash(args[n]) + " " + args[n]);
            return 0;
        }
        if (args.Length == 8 && args[0] == "lzma")
        {
            byte[] input = File.ReadAllBytes(args[1]);
            int size = int.Parse(args[3]);
            var output = new byte[size];
            var watch = Stopwatch.StartNew();
            try
            {
                new LzmaDecoder(int.Parse(args[4]), int.Parse(args[5]), int.Parse(args[6])).Decode(input, input.Length, output, size);
                if (args[7] == "1") BcjX86.Decode(output, size);
            }
            catch (InvalidDataException e)
            {
                Console.WriteLine("refused: " + e.Message);
                return 2;
            }
            File.WriteAllBytes(args[2], output);
            Console.WriteLine("decoded " + size + " bytes in " + watch.Elapsed.TotalSeconds.ToString("0.000") + " s");
            return 0;
        }
        if ((args.Length == 3 || args.Length == 4) && args[0] == "unpack")
        {
            string path = args[1];
            int threads = args.Length == 4 ? int.Parse(args[3]) : Math.Max(1, Math.Min(Environment.ProcessorCount, 8));
            var watch = Stopwatch.StartNew();
            try
            {
                Package p;
                using (Stream s = File.OpenRead(path)) p = Package.Read(s);
                Directory.CreateDirectory(args[2]);
                long done = 0;
                p.Extract(delegate { return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16); }, args[2], threads,
                    delegate (long n) { done = n; });
                Console.WriteLine("unpacked " + p.Files.Count + " files, " + done + " bytes, " + p.Blocks.Count + " blocks, " + threads +
                                  " threads in " + watch.Elapsed.TotalSeconds.ToString("0.000") + " s");
                return 0;
            }
            catch (InvalidDataException e)
            {
                Console.WriteLine("refused: " + e.Message);
                return 2;
            }
        }
        if (args.Length >= 2 && (args[0] == "migrate" || args[0] == "tell"))
        {
            if (!DeerProfileMigration.IsInside(args[1], Path.GetTempPath()))
            {
                Console.WriteLine("refused: " + args[1] + " is not inside %TEMP%");
                return 2;
            }
            bool dev = false;
            for (int i = 2; i < args.Length; i++)
            {
                if (args[i] == "--dev") dev = true;
                else if (args[i] == "--free-mb" && i + 1 < args.Length) DeerProfileMigration.FreeSpaceForTest = long.Parse(args[++i]) << 20;
                else { Console.WriteLine("unknown option " + args[i]); return 1; }
            }
            string local = Path.GetFullPath(args[1]).TrimEnd('\\');
            string target = dev ? DeerProfileMigration.DevProfile(local) : DeerProfileMigration.NewProfile(local);
            if (args[0] == "tell")
            {
                string text = DeerProfileMigration.TellOnce(local, target);
                Console.WriteLine("tell=" + (text == null ? "" : text.Replace("\n", " | ")));
                return 0;
            }
            DeerProfileMigration.Outcome outcome;
            string detail;
            var watch = Stopwatch.StartNew();
            string profile = DeerProfileMigration.Prepare(local, target, out outcome, out detail);
            Console.WriteLine("outcome=" + outcome);
            Console.WriteLine("profile=" + profile);
            Console.WriteLine("detail=" + (detail ?? ""));
            Console.WriteLine("seconds=" + watch.Elapsed.TotalSeconds.ToString("0.000"));
            return 0;
        }
        Console.Error.WriteLine("usage: probe lnk <file> | probe hash <folder>... | probe lzma <in> <out> <size> <lc> <lp> <pb> <x86> | probe unpack <payload> <folder> [threads] | probe migrate <folder> [--dev] [--free-mb N] | probe tell <folder> [--dev]");
        return 1;
    }
}
