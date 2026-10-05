// The setup and uninstall wizards (Windows Forms, .NET Framework 4.8, C# 5). Plain system look:
// white page, Deer's icon and a title, one short paragraph per step, the buttons in a grey bar.
// All the work is in Setup.cs; these forms only ask, show progress and report.
// SPDX-License-Identifier: MPL-2.0
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace Deer.Setup
{
    class Wizard : Form
    {
        public int ExitCode = Exit.Cancelled;
        protected readonly float S;
        protected readonly Label TitleLabel, SubtitleLabel;
        protected readonly Panel Body;
        protected readonly Button Primary, Secondary;
        protected readonly Font BaseFont, TitleFont, SmallFont;
        protected static readonly Color Muted = Color.FromArgb(0x5C, 0x5C, 0x5C);
        protected static readonly Color Warn = Color.FromArgb(0xA4, 0x26, 0x2C);
        protected bool Busy;
        ProgressBar progress;
        Label status;
        int lastPercent = -1;

        protected int Px(float v) { return (int)Math.Round(v * S); }

        static Font MakeFont(string family, float size, FontStyle style)
        {
            try
            {
                var f = new Font(family, size, style);
                if (string.Equals(f.Name, family, StringComparison.OrdinalIgnoreCase)) return f;
                f.Dispose();
            }
            catch (Exception) { }
            return null;
        }

        // The logo, drawn from the icon's smallest frame that is at least `size` pixels. Icon.ToBitmap
        // cannot decode PNG-compressed frames (it draws noise), so PNG frames are decoded as images.
        public static Bitmap LoadLogo(int size)
        {
            byte[] ico;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("deer.ico"))
            {
                if (s == null) return Icon.ExtractAssociatedIcon(Application.ExecutablePath).ToBitmap();
                ico = new byte[s.Length];
                s.Read(ico, 0, ico.Length);
            }
            int count = BitConverter.ToUInt16(ico, 4), pick = -1, pickSize = 0;
            for (int i = 0; i < count; i++)
            {
                int w = ico[6 + 16 * i] == 0 ? 256 : ico[6 + 16 * i];
                bool better = pick < 0 || (pickSize < size ? w > pickSize : (w >= size && w < pickSize));
                if (better) { pick = i; pickSize = w; }
            }
            int length = BitConverter.ToInt32(ico, 6 + 16 * pick + 8), offset = BitConverter.ToInt32(ico, 6 + 16 * pick + 12);
            Image frame;
            bool png = ico[offset] == 0x89 && ico[offset + 1] == (byte)'P' && ico[offset + 2] == (byte)'N' && ico[offset + 3] == (byte)'G';
            if (png) frame = Image.FromStream(new MemoryStream(ico, offset, length));
            else using (Icon icon = new Icon(new MemoryStream(ico), new Size(size, size))) frame = icon.ToBitmap();
            var bmp = new Bitmap(size, size);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.DrawImage(frame, new Rectangle(0, 0, size, size));
            }
            frame.Dispose();
            return bmp;
        }

        public static Icon LoadIcon(int size)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("deer.ico"))
            {
                if (s != null) return new Icon(s, new Size(size, size));
            }
            return Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }

        public Wizard(string caption)
        {
            using (Graphics g = CreateGraphics()) S = Math.Max(1f, g.DpiX / 96f);
            AutoScaleMode = AutoScaleMode.None;
            BaseFont = MakeFont("Segoe UI", 9f, FontStyle.Regular) ?? SystemFonts.MessageBoxFont;
            SmallFont = MakeFont("Segoe UI", 8.25f, FontStyle.Regular) ?? BaseFont;
            TitleFont = MakeFont("Segoe UI Semibold", 14.25f, FontStyle.Regular) ?? new Font(BaseFont.FontFamily, 14.25f, FontStyle.Bold);
            Font = BaseFont;
            Text = caption;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = SystemColors.Window;
            ClientSize = new Size(Px(540), Px(412));
            try { Icon = LoadIcon(Px(32)); } catch (Exception) { }

            var logo = new PictureBox();
            logo.SizeMode = PictureBoxSizeMode.Normal;
            logo.Bounds = new Rectangle(Px(28), Px(26), Px(48), Px(48));
            try { logo.Image = LoadLogo(Px(48)); } catch (Exception e) { Log.Line("logo: " + e.Message); }

            TitleLabel = new Label();
            TitleLabel.Font = TitleFont;
            TitleLabel.AutoSize = false;
            TitleLabel.UseMnemonic = false;
            TitleLabel.Bounds = new Rectangle(Px(90), Px(24), Px(420), Px(32));

            SubtitleLabel = new Label();
            SubtitleLabel.ForeColor = Muted;
            SubtitleLabel.AutoSize = false;
            SubtitleLabel.UseMnemonic = false;
            SubtitleLabel.Bounds = new Rectangle(Px(91), Px(56), Px(420), Px(20));

            var bar = new Panel();
            bar.Dock = DockStyle.Bottom;
            bar.Height = Px(58);
            bar.BackColor = SystemColors.Control;
            var line = new Panel();
            line.Dock = DockStyle.Top;
            line.Height = 1;
            line.BackColor = Color.FromArgb(0xDF, 0xDF, 0xDF);
            bar.Controls.Add(line);

            Primary = new Button();
            Primary.Size = new Size(Px(104), Px(30));
            Primary.Location = new Point(ClientSize.Width - Px(28) - Primary.Width, Px(14));
            Primary.UseMnemonic = false;
            Primary.FlatStyle = FlatStyle.System;
            Secondary = new Button();
            Secondary.Size = Primary.Size;
            Secondary.Location = new Point(Primary.Left - Px(8) - Secondary.Width, Primary.Top);
            Secondary.UseMnemonic = false;
            Secondary.FlatStyle = FlatStyle.System;
            bar.Controls.Add(Primary);
            bar.Controls.Add(Secondary);

            Body = new Panel();
            Body.Bounds = new Rectangle(Px(28), Px(98), ClientSize.Width - Px(56), ClientSize.Height - bar.Height - Px(98) - Px(8));

            Controls.Add(Body);
            Controls.Add(logo);
            Controls.Add(TitleLabel);
            Controls.Add(SubtitleLabel);
            Controls.Add(bar);
            AcceptButton = Primary;
            FormClosing += delegate (object sender, FormClosingEventArgs e) { if (Busy) e.Cancel = true; };
        }

        protected void ClearBody()
        {
            var old = new List<Control>();
            foreach (Control c in Body.Controls) old.Add(c);
            Body.Controls.Clear();
            foreach (Control c in old) c.Dispose();
            progress = null;
            status = null;
        }

        // A wrapped paragraph at y (pixels); returns the y below it.
        protected int Paragraph(string text, int y, Color color, Font font = null)
        {
            font = font ?? BaseFont;
            Size need = TextRenderer.MeasureText(text, font, new Size(Body.Width, int.MaxValue), TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            var l = new Label();
            l.Text = text;
            l.UseMnemonic = false;
            l.AutoSize = false;
            l.Font = font;
            l.ForeColor = color;
            l.Location = new Point(0, y);
            l.Size = new Size(Body.Width, need.Height + Px(2));
            Body.Controls.Add(l);
            return y + l.Height;
        }

        protected void SetButtons(string primary, string secondary)
        {
            Primary.Text = primary ?? "";
            Primary.Visible = primary != null;
            Primary.Enabled = true;
            Secondary.Text = secondary ?? "";
            Secondary.Visible = secondary != null;
            Secondary.Enabled = true;
            CancelButton = secondary != null ? Secondary : (primary != null ? Primary : null);
            // Keyboard focus on the default button, never in a text field (where a stray key would
            // replace the selected install path).
            if (primary != null) ActiveControl = Primary;
        }

        protected void ShowProgress(string title)
        {
            ClearBody();
            TitleLabel.Text = title;
            status = new Label();
            status.AutoSize = false;
            status.UseMnemonic = false;
            status.Location = new Point(0, Px(8));
            status.Size = new Size(Body.Width, Px(22));
            status.Text = "Preparing";
            progress = new ProgressBar();
            progress.Location = new Point(0, Px(36));
            progress.Size = new Size(Body.Width, Px(16));
            progress.Maximum = 1000;
            Body.Controls.Add(status);
            Body.Controls.Add(progress);
            SetButtons(null, "Cancel");
            Secondary.Enabled = false;
            lastPercent = -1;
        }

        // Called from the worker thread.
        protected void Report(string text, double fraction)
        {
            int permille = (int)Math.Round(Math.Max(0, Math.Min(1, fraction)) * 1000);
            if (text == null && permille / 5 == lastPercent / 5) return;
            lastPercent = permille;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (progress != null) progress.Value = permille;
                    if (status != null && text != null) status.Text = text;
                });
            }
            catch (InvalidOperationException) { }
        }

        protected void RunWorker(Action work, Action done, Action<Exception> failed)
        {
            Busy = true;
            var thread = new Thread(delegate ()
            {
                Exception error = null;
                try { work(); }
                catch (Exception e) { error = e; }
                BeginInvoke((MethodInvoker)delegate
                {
                    Busy = false;
                    if (error == null) done();
                    else failed(error);
                });
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();
        }

        protected bool WaitUntilClosed(string installDir)
        {
            while (true)
            {
                List<string> running = Processes.RunningFrom(installDir);
                if (running.Count == 0) return true;
                Log.Line("Deer is running: " + string.Join(", ", running.ToArray()));
                DialogResult r = MessageBox.Show(this, "Deer is running. Close all Deer windows, then click Retry.", Text,
                    MessageBoxButtons.RetryCancel, MessageBoxIcon.Information);
                if (r != DialogResult.Retry) return false;
            }
        }
    }

    // ---- install ----------------------------------------------------------------------------------------

    class InstallForm : Wizard
    {
        readonly Options o;
        Target t;
        string page;
        TextBox dirBox;
        CheckBox desktopBox, startBox;
        RadioButton userBox, allBox;
        bool updating;

        [DllImport("user32.dll")]
        static extern IntPtr SendMessageW(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        public InstallForm(Options options, Target target) : base("Deer Setup")
        {
            o = options;
            t = target;
            Primary.Click += OnPrimary;
            Secondary.Click += OnSecondary;
            SetupException blocker = Program.InstallBlocker(t, o.AllowDowngrade);
            if (blocker != null && blocker.Code != Exit.FolderNotUsable) ShowError(blocker.Message, blocker.Code, false);
            else ShowOptions();
        }

        bool Machine { get { return allBox != null ? allBox.Checked : t.Machine; } }

        // Windows' shield on the button when the next step asks for administrator permission.
        void UpdateShield()
        {
            bool shield = page == "options" && Machine && !t.Test && !Installer.IsElevated();
            try { SendMessageW(Primary.Handle, 0x160C /* BCM_SETSHIELD */, IntPtr.Zero, shield ? (IntPtr)1 : IntPtr.Zero); } catch (Exception) { }
        }

        RadioButton Choice(string text, int y, bool on)
        {
            var r = new RadioButton();
            r.Text = text;
            r.FlatStyle = FlatStyle.System;
            r.AutoSize = true;
            r.Location = new Point(0, y);
            r.Checked = on;
            r.UseMnemonic = false;
            Body.Controls.Add(r);
            return r;
        }

        void ShowOptions()
        {
            page = "options";
            ClearBody();
            userBox = allBox = null;
            dirBox = null;
            InstallRecord prev = InstallRecord.Read(t.InstallDir);
            int cmp = prev == null ? 1 : Installer.CompareVersions(BuildInfo.Version, prev.Version);
            updating = prev != null;
            TitleLabel.Text = prev == null ? "Install Deer" : cmp > 0 ? "Update Deer" : "Reinstall Deer";
            SubtitleLabel.Text = "Version " + BuildInfo.Version + (t.Test ? "  ·  test mode" : "");
            int y = 0;
            if (prev == null)
            {
                y = Paragraph("Install for", y, Muted);
                y += Px(2);
                userBox = Choice("Just for me (no administrator permission needed)", y, !t.Machine);
                y += userBox.PreferredSize.Height + Px(4);
                allBox = Choice("All users of this computer (needs administrator permission)", y, t.Machine);
                y += allBox.PreferredSize.Height;
                EventHandler changed = delegate
                {
                    // A test install stays in the folder the test chose; otherwise each choice has its folder.
                    if (!t.Test && dirBox != null)
                    {
                        string other = Target.DefaultInstallDir(false, !Machine);
                        if (Paths.Same(dirBox.Text, other) || dirBox.Text.Trim().Length == 0) dirBox.Text = Target.DefaultInstallDir(false, Machine);
                    }
                    UpdateShield();
                };
                userBox.CheckedChanged += changed;
                allBox.CheckedChanged += changed;
            }
            else if (cmp > 0)
                y = Paragraph("Deer " + prev.Version + " is installed in this folder and will be updated to " + BuildInfo.Version +
                              ". Your bookmarks, history and settings are kept.", y, ForeColor);
            else
                y = Paragraph("Deer " + prev.Version + " is installed in this folder. Setup will install it again. " +
                              "Your bookmarks, history and settings are kept.", y, ForeColor);
            if (prev != null)
            {
                y += Px(6);
                y = Paragraph(prev.Machine ? "Installed for all users of this computer." : "Installed for your Windows account only.", y, Muted);
            }
            y += Px(14);
            y = Paragraph("Install folder", y, Muted);
            y += Px(3);
            dirBox = new TextBox();
            dirBox.Text = t.InstallDir;
            dirBox.Location = new Point(0, y);
            dirBox.Width = Body.Width - Px(112);
            dirBox.ReadOnly = prev != null || t.Test; // an update stays where it is; a test install where the test put it
            var browse = new Button();
            browse.Text = "Browse…";
            browse.FlatStyle = FlatStyle.System;
            browse.Size = new Size(Px(104), dirBox.Height + 2);
            browse.Location = new Point(Body.Width - browse.Width, y - 1);
            browse.Enabled = prev == null && !t.Test;
            browse.Click += delegate
            {
                using (var dlg = new FolderBrowserDialog())
                {
                    dlg.Description = "Choose the folder Deer is installed in. Setup creates a \"Deer\" folder inside it.";
                    dlg.ShowNewFolderButton = true;
                    if (dlg.ShowDialog(this) == DialogResult.OK) dirBox.Text = Path.Combine(dlg.SelectedPath, "Deer");
                }
            };
            Body.Controls.Add(dirBox);
            Body.Controls.Add(browse);
            y += dirBox.Height + Px(16);
            desktopBox = new CheckBox();
            desktopBox.Text = "Create a desktop shortcut";
            desktopBox.FlatStyle = FlatStyle.System;
            desktopBox.AutoSize = true;
            desktopBox.Location = new Point(0, y);
            desktopBox.Checked = o.Desktop.HasValue ? o.Desktop.Value
                : prev == null || (!string.IsNullOrEmpty(prev.DesktopShortcut) && File.Exists(prev.DesktopShortcut));
            Body.Controls.Add(desktopBox);
            y += desktopBox.PreferredSize.Height + Px(12);
            if (BuildInfo.DevEngine)
                y = Paragraph("Local test build: it contains the branded Firefox engine and must not be distributed.", y, Warn, SmallFont) + Px(4);
            if (t.Test)
                y = Paragraph("Test mode: registry entries go under HKCU\\" + Target.TestRoot + " (all users: HKCU\\" + Target.TestMachineRoot +
                              ") and shortcuts into a test folder; no administrator permission is asked for.", y, Muted, SmallFont);
            SetButtons(prev == null ? "Install" : cmp > 0 ? "Update" : "Reinstall", "Cancel");
            UpdateShield();
        }

        void OnSecondary(object sender, EventArgs e)
        {
            if (page == "options") { ExitCode = Exit.Cancelled; Close(); }
        }

        void OnPrimary(object sender, EventArgs e)
        {
            if (page == "options") StartInstall();
            else if (page == "done") Finish();
            else Close();
        }

        static string Describe(int code)
        {
            switch (code)
            {
                case Exit.DeerRunning: return "Deer is running. Close all Deer windows, then run setup again.";
                case Exit.SetupRunning: return "Another Deer setup is running.";
                case Exit.PayloadBad: return "This setup program is damaged. Download it again.";
                case Exit.Downgrade: return "A newer version of Deer is already installed.";
                case Exit.FolderNotUsable: return "This install folder can't be used.";
                case Exit.NeedsAdmin: return "Installing Deer for all users needs administrator permission.";
                default: return "Setup failed (code " + code + "). The log is in " + (Log.File ?? "%TEMP%") + ".";
            }
        }

        void StartInstall()
        {
            Target nt;
            bool machine = Machine;
            if (!Installer.IsAbsoluteLocal(dirBox.Text))
            {
                MessageBox.Show(this, "Enter the full path of a folder, for example " + Target.DefaultInstallDir(false, machine) + ".", Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try { nt = Target.For(o.TestKeys, machine, dirBox.Text, o.ShortcutDir, o.DataDir); }
            catch (Exception)
            {
                MessageBox.Show(this, "This is not a valid folder path.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            SetupException blocker = Program.InstallBlocker(nt, o.AllowDowngrade);
            if (blocker != null)
            {
                if (blocker.Code == Exit.FolderNotUsable)
                {
                    MessageBox.Show(this, blocker.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                ShowError(blocker.Message, blocker.Code, false);
                return;
            }
            if (!WaitUntilClosed(nt.InstallDir)) return;
            t = nt;
            bool desktop = desktopBox.Checked;
            page = "progress";
            ShowProgress(updating ? "Updating Deer" : "Installing Deer");
            UpdateShield();
            Action<Exception> failed = delegate (Exception err)
            {
                Log.Line("install failed: " + err);
                var se = err as SetupException;
                if (se != null && se.Code == Exit.NeedsAdmin)
                {
                    // The UAC prompt was declined: back to the choice.
                    Program.RetakeGate();
                    MessageBox.Show(this, "Deer was not installed. Installing it for all users needs administrator permission; " +
                                          "\"Just for me\" needs none.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    ShowOptions();
                    return;
                }
                // "Nothing was installed" / "the previous version is still in place" holds only when the
                // failure came before the new files were swapped in; otherwise the message says what to do.
                ShowError(se != null ? se.Message : err.Message, se != null ? se.Code : Exit.Failed, se == null || !se.FilesInPlace);
            };
            if (Elevation.Needed(o, t))
            {
                // All users: an elevated copy of this program installs (UAC prompt; in test mode a plain
                // child), this window shows its progress and then starts Deer as the person.
                var args = new List<string> { "/S", "/allusers", "/installdir:" + t.InstallDir, desktop ? "/desktop" : "/nodesktop", "/elevated" };
                if (o.AllowDowngrade) args.Add("/allowdowngrade");
                Elevation.AddTestArgs(o, args);
                Elevation.AddLog(args);
                Program.ReleaseGate(); // on this thread, which took it; the elevated copy takes it over
                Report(t.Test ? "Installing for all users" : "Waiting for administrator permission", 0);
                RunWorker(delegate
                {
                    int code = Elevation.Run(t.Test, args, true, Report);
                    if (code != Exit.Ok) throw new SetupException(code, Describe(code));
                }, ShowDone, failed);
                return;
            }
            RunWorker(delegate { Installer.Run(t, desktop, Report); }, ShowDone, failed);
        }

        void ShowDone()
        {
            page = "done";
            ExitCode = Exit.Ok;
            ClearBody();
            TitleLabel.Text = updating ? "Deer is updated" : "Deer is installed";
            int y = Paragraph("Deer opens links from other apps once it is your default browser. Windows lets you choose that in Settings.", 0, ForeColor);
            y += Px(12);
            var defaults = new Button();
            defaults.Text = "Make Deer your default browser…";
            defaults.FlatStyle = FlatStyle.System;
            defaults.AutoSize = true;
            defaults.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            defaults.Padding = new Padding(Px(8), Px(3), Px(8), Px(3));
            defaults.Location = new Point(0, y);
            defaults.Enabled = !t.Test;
            defaults.Click += delegate
            {
                try { Installer.OpenDefaultApps(); }
                catch (Exception ex) { MessageBox.Show(this, "Windows Settings could not be opened:\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            };
            Body.Controls.Add(defaults);
            y += defaults.PreferredSize.Height + Px(16);
            if (t.Test)
                y = Paragraph("Test mode: Deer is registered under the test keys only, so Settings is not offered.", y, Muted, SmallFont) + Px(8);
            startBox = new CheckBox();
            startBox.Text = "Start Deer now";
            startBox.FlatStyle = FlatStyle.System;
            startBox.AutoSize = true;
            startBox.Location = new Point(0, y);
            startBox.Checked = !t.Test;
            Body.Controls.Add(startBox);
            SetButtons("Finish", null);
        }

        void Finish()
        {
            if (startBox != null && startBox.Checked)
            {
                try { Installer.StartDeer(t); Log.Line("started Deer"); }
                catch (Exception ex) { MessageBox.Show(this, "Deer could not be started:\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            }
            Close();
        }

        void ShowError(string message, int code, bool attempted)
        {
            page = "error";
            ExitCode = code;
            ClearBody();
            TitleLabel.Text = code == Exit.Downgrade ? "A newer Deer is installed" : "Deer couldn't be installed";
            SubtitleLabel.Text = "Version " + BuildInfo.Version;
            int y = Paragraph(message, 0, ForeColor);
            if (attempted)
            {
                y += Px(10);
                Paragraph(updating ? "The version that was installed before is still in place." : "Nothing was installed.", y, Muted);
            }
            SetButtons("Close", null);
        }
    }

    // ---- uninstall -----------------------------------------------------------------------------------------

    class UninstallForm : Wizard
    {
        readonly Target t;
        readonly InstallRecord rec;
        string page;
        CheckBox dataBox;
        bool removeData;

        public UninstallForm(Options options, Target target, InstallRecord record) : base("Uninstall Deer")
        {
            t = target;
            rec = record;
            Primary.Click += OnPrimary;
            Secondary.Click += delegate { if (page == "confirm") { ExitCode = Exit.Cancelled; Close(); } };
            removeData = options.RemoveData;
            ShowConfirm();
        }

        void ShowConfirm()
        {
            page = "confirm";
            ClearBody();
            TitleLabel.Text = "Uninstall Deer";
            SubtitleLabel.Text = "Version " + rec.Version + (t.Test ? "  ·  test mode" : "");
            int y = Paragraph(t.Machine ? "Deer will be removed from this computer for all users: the program, its shortcuts and its registration as a browser."
                                        : "Deer will be removed from this computer: the program, its shortcuts and its registration as a browser.", 0, ForeColor);
            y += Px(16);
            dataBox = new CheckBox();
            dataBox.Text = "Also delete my Deer data: bookmarks, history, saved passwords, cookies and settings";
            dataBox.AutoSize = false;
            dataBox.FlatStyle = FlatStyle.System;
            dataBox.TextAlign = ContentAlignment.TopLeft;
            Size need = TextRenderer.MeasureText(dataBox.Text, BaseFont, new Size(Body.Width - Px(20), int.MaxValue), TextFormatFlags.WordBreak);
            dataBox.Size = new Size(Body.Width, need.Height + Px(6));
            dataBox.Location = new Point(0, y);
            dataBox.Checked = removeData;
            dataBox.Enabled = !string.IsNullOrEmpty(t.DataDir);
            Body.Controls.Add(dataBox);
            y += dataBox.Height + Px(4);
            if (!string.IsNullOrEmpty(t.DataDir))
                y = Paragraph("Your data is in " + t.DataDir + ". It is kept unless you tick the box." +
                              (t.Machine ? " Other people's Deer data on this computer is kept either way." : ""), y, Muted, SmallFont);
            SetButtons("Uninstall", "Cancel");
        }

        void OnPrimary(object sender, EventArgs e)
        {
            if (page != "confirm") { Close(); return; }
            if (!WaitUntilClosed(t.InstallDir)) return;
            removeData = dataBox.Checked;
            page = "progress";
            ShowProgress("Uninstalling Deer");
            RunWorker(delegate { Uninstaller.Run(t, rec, removeData, Report); }, delegate { ShowDone(null); }, delegate (Exception err)
            {
                Log.Line("uninstall: " + err);
                ShowDone(err);
            });
        }

        void ShowDone(Exception err)
        {
            page = "done";
            ClearBody();
            var se = err as SetupException;
            ExitCode = err == null ? Exit.Ok : se != null ? se.Code : Exit.Failed;
            TitleLabel.Text = err == null ? "Deer is uninstalled" : "Deer is uninstalled, with problems";
            int y = 0;
            if (err != null) y = Paragraph(err.Message, y, ForeColor) + Px(10);
            if (removeData) Paragraph("Your Deer data was deleted.", y, ForeColor);
            else if (!string.IsNullOrEmpty(t.DataDir))
                Paragraph("Your Deer data was kept in " + t.DataDir + ". If you install Deer again, it picks up where you left off.", y, ForeColor);
            SetButtons("Close", null);
        }
    }
}
