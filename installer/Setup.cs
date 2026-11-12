using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WorkClockSetup
{
    class InstallOptions
    {
        public string InstallDir;
        public string DataDir;
        public string MigrateFrom;   // 可为空：从旧数据目录导入
        public bool DesktopShortcut = true;
        public bool StartMenuShortcut = true;
    }

    static class Engine
    {
        public static Stream Res(string name)
        {
            Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
            if (s == null) throw new Exception("安装包已损坏：缺少资源 " + name);
            return s;
        }

        public static void Install(InstallOptions o, Action<int, string> progress)
        {
            string installDir = o.InstallDir;
            string dataDir = o.DataDir;

            progress(0, "正在准备安装目录…");
            Directory.CreateDirectory(installDir);
            if (Util.AnyRunning(installDir))
            {
                progress(0, "正在关闭正在运行的 " + Consts.AppName + "…");
                Util.KillRunning(installDir);
                Thread.Sleep(800);
            }

            // 1. 解压程序文件
            long written = 0;
            long total = 0;
            using (Stream zs = Res("payload.zip"))
            using (var zip = new ZipArchive(zs, ZipArchiveMode.Read))
            {
                foreach (var e in zip.Entries) total += e.Length;
                if (total <= 0) total = 1;
                string root = installDir.TrimEnd('\\') + "\\";
                foreach (var e in zip.Entries)
                {
                    string dest = Path.GetFullPath(Path.Combine(installDir, e.FullName));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    if (string.IsNullOrEmpty(e.Name)) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    e.ExtractToFile(dest, true);
                    written += e.Length;
                    progress((int)(written * 85 / total), "正在复制文件：" + e.FullName);
                }
            }

            // 2. 写入卸载程序
            progress(86, "正在写入卸载程序…");
            using (Stream us = Res("uninstall.exe"))
            using (var fs = File.Create(Path.Combine(installDir, Consts.UninstallerName)))
                us.CopyTo(fs);

            // 3. 数据目录
            progress(88, "正在创建数据目录…");
            Directory.CreateDirectory(dataDir);
            if (Util.IsAdmin()) GrantUsersModify(dataDir);

            if (!string.IsNullOrEmpty(o.MigrateFrom) && Directory.Exists(o.MigrateFrom) && !Util.SamePath(o.MigrateFrom, dataDir))
            {
                progress(90, "正在导入已有数据…");
                MigrateData(o.MigrateFrom, dataDir);
            }

            // 4. 写入配置文件（程序启动时读取 dataDir）
            progress(93, "正在写入配置…");
            string json = "{\r\n  \"dataDir\": \"" + Util.JsonEscape(dataDir) + "\"\r\n}\r\n";
            File.WriteAllText(Path.Combine(installDir, Consts.ConfigName), json, new UTF8Encoding(false));

            // 5. 快捷方式
            progress(95, "正在创建快捷方式…");
            string exe = Path.Combine(installDir, Consts.ExeName);
            try { if (o.StartMenuShortcut) Util.CreateShortcut(Util.StartMenuLnk(), exe, installDir, Consts.AppName); } catch { }
            try { if (o.DesktopShortcut) Util.CreateShortcut(Util.DesktopLnk(), exe, installDir, Consts.AppName); } catch { }

            // 6. 注册表（当前用户：程序和功能 + 安装信息）
            progress(98, "正在注册卸载信息…");
            using (var k = Registry.CurrentUser.CreateSubKey(Consts.UninstKey))
            {
                k.SetValue("DisplayName", Consts.AppName);
                k.SetValue("DisplayVersion", Consts.Version);
                k.SetValue("Publisher", Consts.Publisher);
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", installDir);
                k.SetValue("UninstallString", "\"" + Path.Combine(installDir, Consts.UninstallerName) + "\"");
                k.SetValue("QuietUninstallString", "\"" + Path.Combine(installDir, Consts.UninstallerName) + "\" /S");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(total / 1024), RegistryValueKind.DWord);
            }
            using (var k = Registry.CurrentUser.CreateSubKey(Consts.RegKey))
            {
                k.SetValue("InstallDir", installDir);
                k.SetValue("DataDir", dataDir);
                k.SetValue("Version", Consts.Version);
            }
            progress(100, "安装完成");
        }

        /// <summary>只导入用户数据（data.json / data.bak.json / backups），不复制浏览器缓存。目标已有数据时不覆盖。</summary>
        static void MigrateData(string from, string to)
        {
            string[] files = { "data.json", "data.bak.json" };
            bool targetHasData = File.Exists(Path.Combine(to, "data.json"));
            if (!targetHasData)
            {
                foreach (string f in files)
                {
                    string s = Path.Combine(from, f);
                    if (File.Exists(s)) File.Copy(s, Path.Combine(to, f), true);
                }
            }
            string sb = Path.Combine(from, "backups");
            if (Directory.Exists(sb))
            {
                string tb = Path.Combine(to, "backups");
                Directory.CreateDirectory(tb);
                foreach (string f in Directory.GetFiles(sb))
                {
                    string d = Path.Combine(tb, Path.GetFileName(f));
                    if (!File.Exists(d)) File.Copy(f, d);
                }
            }
        }

        /// <summary>以管理员身份安装到受保护目录时，保证普通用户运行的程序仍能写入数据目录。</summary>
        static void GrantUsersModify(string dir)
        {
            try
            {
                var di = new DirectoryInfo(dir);
                DirectorySecurity sec = di.GetAccessControl();
                var users = new SecurityIdentifier(WellKnownSidType.BuiltinUsersSid, null);
                sec.AddAccessRule(new FileSystemAccessRule(users, FileSystemRights.Modify,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
                di.SetAccessControl(sec);
            }
            catch { }
        }
    }

    // ===================================================================== 向导界面
    class Wizard : Form
    {
        readonly Panel header = new Panel();
        readonly Label title = new Label();
        readonly Label subtitle = new Label();
        readonly Panel body = new Panel();
        readonly Button btnBack = new Button();
        readonly Button btnNext = new Button();
        readonly Button btnCancel = new Button();
        readonly Panel[] pages = new Panel[6];
        int page = 0;
        bool installing = false, finished = false;

        // 控件
        TextBox txtInstall, txtData, txtMigrate;
        RadioButton rbDataDefault, rbDataCustom;
        Button btnBrowseData;
        CheckBox chkMigrate, chkDesktop, chkStartMenu, chkLaunch;
        Button btnBrowseMigrate;
        Label lblSpace, lblDataDefault, lblSummary, lblStatus;
        ProgressBar bar;

        readonly string prevInstall, prevData;
        readonly long requiredBytes;

        static readonly Font UiFont = new Font("Microsoft YaHei UI", 9F);
        static readonly Font TitleFont = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold);

        public Wizard(string presetDir, string presetData)
        {
            prevInstall = Util.RegRead(Consts.RegKey, "InstallDir");
            prevData = Util.RegRead(Consts.RegKey, "DataDir");
            requiredBytes = PayloadSize();

            Text = Consts.AppName + " " + Consts.Version + " 安装程序";
            Font = UiFont;
            AutoScaleMode = AutoScaleMode.Dpi;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(600, 420);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            header.SetBounds(0, 0, 600, 70);
            header.BackColor = Color.White;
            title.SetBounds(20, 12, 560, 26); title.Font = TitleFont;
            subtitle.SetBounds(22, 40, 560, 22); subtitle.ForeColor = Color.DimGray;
            header.Controls.Add(title); header.Controls.Add(subtitle);
            var line = new Label { BorderStyle = BorderStyle.Fixed3D, Bounds = new Rectangle(0, 70, 600, 2) };
            var line2 = new Label { BorderStyle = BorderStyle.Fixed3D, Bounds = new Rectangle(0, 366, 600, 2) };
            body.SetBounds(0, 72, 600, 294);

            btnBack.SetBounds(310, 380, 85, 28); btnBack.Text = "< 上一步";
            btnNext.SetBounds(400, 380, 85, 28); btnNext.Text = "下一步 >";
            btnCancel.SetBounds(500, 380, 85, 28); btnCancel.Text = "取消";
            btnBack.Click += delegate { Go(page - 1); };
            btnNext.Click += delegate { OnNext(); };
            btnCancel.Click += delegate { Close(); };
            AcceptButton = btnNext;

            Controls.AddRange(new Control[] { header, line, body, line2, btnBack, btnNext, btnCancel });

            string defInstall = presetDir ?? prevInstall ??
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WorkClock");
            BuildPages(defInstall, presetData ?? prevData);
            Go(0);
        }

        static long PayloadSize()
        {
            try
            {
                long t = 0;
                using (Stream zs = Engine.Res("payload.zip"))
                using (var zip = new ZipArchive(zs, ZipArchiveMode.Read))
                    foreach (var e in zip.Entries) t += e.Length;
                return t;
            }
            catch { return 380L << 20; }
        }

        Panel NewPage()
        {
            var p = new Panel { Bounds = new Rectangle(0, 0, 600, 294), Visible = false };
            body.Controls.Add(p);
            return p;
        }

        Label Lbl(Panel p, string text, int x, int y, int w, int h)
        {
            var l = new Label { Text = text, Bounds = new Rectangle(x, y, w, h) };
            p.Controls.Add(l);
            return l;
        }

        string DefaultDataDir() { return Path.Combine(Util.NormalizeDir(txtInstall.Text) ?? txtInstall.Text, "data"); }

        void BuildPages(string defInstall, string defData)
        {
            // 0 欢迎
            var p0 = pages[0] = NewPage();
            Lbl(p0, "欢迎使用 " + Consts.AppName + " " + Consts.Version + " 安装向导。\r\n\r\n" +
                "本向导将引导你完成以下设置：\r\n\r\n" +
                "    • 选择程序的安装位置\r\n" +
                "    • 选择本地数据（打卡记录、设置、备份）的存放位置\r\n" +
                "    • 创建快捷方式\r\n\r\n" +
                "建议在继续之前关闭正在运行的 " + Consts.AppName + "。\r\n\r\n点击“下一步”继续。", 30, 20, 540, 260);

            // 1 安装位置
            var p1 = pages[1] = NewPage();
            Lbl(p1, "安装程序将把 " + Consts.AppName + " 安装到下列文件夹。\r\n如需安装到其他位置，请点击“浏览”选择文件夹。", 30, 20, 540, 40);
            Lbl(p1, "安装位置：", 30, 78, 300, 20);
            txtInstall = new TextBox { Bounds = new Rectangle(30, 100, 440, 24), Text = defInstall };
            var b1 = new Button { Text = "浏览...", Bounds = new Rectangle(480, 99, 90, 26) };
            b1.Click += delegate
            {
                string picked = PickFolder("选择安装位置", txtInstall.Text);
                if (picked == null) return;
                string name = Path.GetFileName(picked.TrimEnd('\\'));
                if (name.IndexOf("WorkClock", StringComparison.OrdinalIgnoreCase) < 0 && name.IndexOf(Consts.AppName, StringComparison.Ordinal) < 0)
                    picked = Path.Combine(picked, "WorkClock");
                txtInstall.Text = picked;
            };
            txtInstall.TextChanged += delegate { UpdateSpace(); UpdateDataDefault(); };
            p1.Controls.Add(txtInstall); p1.Controls.Add(b1);
            lblSpace = Lbl(p1, "", 30, 140, 540, 44);

            // 2 数据位置
            var p2 = pages[2] = NewPage();
            Lbl(p2, "请选择本地数据（打卡记录、设置、自动备份等）的存放位置。\r\n卸载程序时可以选择保留这些数据。", 30, 14, 540, 40);
            rbDataDefault = new RadioButton { Text = "与程序放在一起（推荐）", Bounds = new Rectangle(30, 60, 400, 22) };
            lblDataDefault = Lbl(p2, "", 50, 83, 520, 20); lblDataDefault.ForeColor = Color.DimGray;
            rbDataCustom = new RadioButton { Text = "自定义位置：", Bounds = new Rectangle(30, 110, 400, 22) };
            txtData = new TextBox { Bounds = new Rectangle(50, 134, 420, 24) };
            btnBrowseData = new Button { Text = "浏览...", Bounds = new Rectangle(480, 133, 90, 26) };
            btnBrowseData.Click += delegate
            {
                string picked = PickFolder("选择数据存放位置", txtData.Text);
                if (picked != null) txtData.Text = picked;
            };
            rbDataDefault.CheckedChanged += delegate { SyncData(); };
            rbDataCustom.CheckedChanged += delegate { SyncData(); };

            chkMigrate = new CheckBox { Text = "从已有数据目录导入打卡记录（不会覆盖目标位置已有的数据）", Bounds = new Rectangle(30, 182, 540, 22) };
            txtMigrate = new TextBox { Bounds = new Rectangle(50, 206, 420, 24) };
            btnBrowseMigrate = new Button { Text = "浏览...", Bounds = new Rectangle(480, 205, 90, 26) };
            btnBrowseMigrate.Click += delegate
            {
                string picked = PickFolder("选择旧版本的 data 文件夹（内含 data.json）", txtMigrate.Text);
                if (picked != null) txtMigrate.Text = picked;
            };
            chkMigrate.CheckedChanged += delegate { txtMigrate.Enabled = btnBrowseMigrate.Enabled = chkMigrate.Checked; };
            p2.Controls.AddRange(new Control[] { rbDataDefault, rbDataCustom, txtData, btnBrowseData, chkMigrate, txtMigrate, btnBrowseMigrate });
            Lbl(p2, "提示：请选择你有写入权限的位置，例如 D:\\WorkClockData。", 30, 245, 540, 20).ForeColor = Color.DimGray;

            if (!string.IsNullOrEmpty(defData) && !Util.SamePath(defData, Path.Combine(defInstall, "data")))
            {
                rbDataCustom.Checked = true; txtData.Text = defData;
            }
            else
            {
                rbDataDefault.Checked = true;
                txtData.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "WorkClockData");
            }
            chkMigrate.Checked = false;
            txtMigrate.Enabled = btnBrowseMigrate.Enabled = false;

            // 3 选项 + 确认
            var p3 = pages[3] = NewPage();
            chkDesktop = new CheckBox { Text = "创建桌面快捷方式", Bounds = new Rectangle(30, 20, 300, 22), Checked = true };
            chkStartMenu = new CheckBox { Text = "创建开始菜单快捷方式", Bounds = new Rectangle(30, 46, 300, 22), Checked = true };
            p3.Controls.Add(chkDesktop); p3.Controls.Add(chkStartMenu);
            lblSummary = Lbl(p3, "", 30, 84, 540, 200);
            lblSummary.BorderStyle = BorderStyle.FixedSingle;
            lblSummary.Padding = new Padding(8);
            lblSummary.BackColor = Color.White;

            // 4 进度
            var p4 = pages[4] = NewPage();
            lblStatus = Lbl(p4, "", 30, 60, 540, 40);
            bar = new ProgressBar { Bounds = new Rectangle(30, 110, 540, 24), Minimum = 0, Maximum = 100 };
            p4.Controls.Add(bar);

            // 5 完成
            var p5 = pages[5] = NewPage();
            Lbl(p5, "", 30, 30, 540, 120).Name = "finishText";
            chkLaunch = new CheckBox { Text = "立即运行 " + Consts.AppName, Bounds = new Rectangle(30, 160, 300, 22), Checked = true };
            p5.Controls.Add(chkLaunch);

            UpdateSpace(); UpdateDataDefault(); SyncData();
        }

        void SyncData()
        {
            txtData.Enabled = btnBrowseData.Enabled = rbDataCustom.Checked;
        }

        void UpdateDataDefault()
        {
            if (lblDataDefault != null) lblDataDefault.Text = DefaultDataDir();
        }

        void UpdateSpace()
        {
            if (lblSpace == null) return;
            string d = Util.NormalizeDir(txtInstall.Text);
            string s = "所需空间：约 " + Util.FormatSize(requiredBytes);
            if (d != null)
            {
                long free = Util.FreeSpace(d);
                if (free >= 0) s += "\r\n可用空间：" + Util.FormatSize(free);
            }
            lblSpace.Text = s;
        }

        string PickFolder(string desc, string start)
        {
            using (var dlg = new FolderBrowserDialog { Description = desc, ShowNewFolderButton = true })
            {
                try
                {
                    string s = Util.NormalizeDir(start);
                    while (s != null && !Directory.Exists(s)) s = Path.GetDirectoryName(s);
                    if (s != null) dlg.SelectedPath = s;
                }
                catch { }
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.SelectedPath : null;
            }
        }

        string InstallDir() { return Util.NormalizeDir(txtInstall.Text); }
        string DataDir() { return rbDataCustom.Checked ? Util.NormalizeDir(txtData.Text) : Util.NormalizeDir(DefaultDataDir()); }

        static readonly string[] Titles = { "欢迎", "选择安装位置", "选择数据存放位置", "准备安装", "正在安装", "安装完成" };
        static readonly string[] Subs = {
            "安装 " + Consts.AppName + " " + Consts.Version,
            "选择要把 " + Consts.AppName + " 安装到哪个文件夹。",
            "选择打卡记录等本地数据保存到哪个文件夹。",
            "确认设置后点击“安装”开始。",
            "正在安装，请稍候…",
            Consts.AppName + " 已成功安装到你的电脑。"
        };

        void Go(int target)
        {
            if (target < 0 || target >= pages.Length) return;
            page = target;
            for (int i = 0; i < pages.Length; i++) pages[i].Visible = i == page;
            title.Text = Titles[page];
            subtitle.Text = Subs[page];
            btnBack.Enabled = page > 0 && page < 4;
            btnNext.Text = page == 3 ? "安装" : page == 5 ? "完成" : "下一步 >";
            btnNext.Enabled = page != 4;
            btnCancel.Enabled = page < 4;
            if (page == 3) BuildSummary();
        }

        void BuildSummary()
        {
            var sb = new StringBuilder();
            sb.AppendLine("安装位置：");
            sb.AppendLine("    " + InstallDir());
            sb.AppendLine();
            sb.AppendLine("数据存放位置：");
            sb.AppendLine("    " + DataDir());
            if (chkMigrate.Checked)
            {
                sb.AppendLine();
                sb.AppendLine("从以下位置导入已有数据：");
                sb.AppendLine("    " + Util.NormalizeDir(txtMigrate.Text));
            }
            lblSummary.Text = sb.ToString();
        }

        bool Err(string msg) { MessageBox.Show(this, msg, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }

        bool ValidateInstallPage()
        {
            string d = InstallDir();
            if (d == null) return Err("请输入有效的安装位置（完整路径，例如 D:\\Programs\\WorkClock）。");
            if (d.Length <= 3) return Err("不能直接安装到磁盘根目录，请选择或新建一个文件夹。");
            if (Directory.Exists(d) && Directory.GetFileSystemEntries(d).Length > 0 &&
                !File.Exists(Path.Combine(d, Consts.ExeName)))
            {
                if (MessageBox.Show(this, "所选文件夹不为空：\r\n" + d + "\r\n\r\n仍要安装到这里吗？", Text,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return false;
            }
            long free = Util.FreeSpace(d);
            if (free >= 0 && free < requiredBytes) return Err("所选磁盘空间不足，需要约 " + Util.FormatSize(requiredBytes) + "。");
            if (!Util.CanWrite(d))
            {
                if (!Util.IsAdmin())
                {
                    var r = MessageBox.Show(this, "当前用户没有写入该位置的权限：\r\n" + d +
                        "\r\n\r\n是否以管理员身份重新运行安装程序？\r\n（选择“否”可返回并换一个位置）", Text,
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                    if (r == DialogResult.Yes) RelaunchElevated(d);
                    return false;
                }
                return Err("无法写入该位置，请换一个文件夹。");
            }
            return true;
        }

        bool ValidateDataPage()
        {
            string install = InstallDir();
            string d = DataDir();
            if (d == null) return Err("请输入有效的数据存放位置（完整路径）。");
            if (d.Length <= 3) return Err("不能直接使用磁盘根目录存放数据，请选择或新建一个文件夹。");
            if (Util.SamePath(d, install)) return Err("数据目录不能与安装目录相同，请使用子文件夹（如 data）或其他位置。");
            if (!Util.CanWrite(d))
            {
                if (!Util.IsAdmin()) return Err("当前用户无法写入该位置：\r\n" + d + "\r\n\r\n程序运行时需要写入数据，请换一个位置。");
                return Err("无法写入该位置，请换一个文件夹。");
            }
            if (chkMigrate.Checked)
            {
                string m = Util.NormalizeDir(txtMigrate.Text);
                if (m == null || !Directory.Exists(m)) return Err("要导入的数据目录不存在。");
                if (!File.Exists(Path.Combine(m, "data.json")) && !Directory.Exists(Path.Combine(m, "backups")))
                    return Err("所选文件夹中没有找到 data.json，请选择旧版本的 data 文件夹。");
                if (Util.SamePath(m, d)) chkMigrate.Checked = false; // 同一位置，无需导入
            }
            return true;
        }

        void RelaunchElevated(string dir)
        {
            try
            {
                var psi = new ProcessStartInfo(Application.ExecutablePath, "/D=\"" + dir + "\"") { UseShellExecute = true, Verb = "runas" };
                Process.Start(psi);
                finished = true;
                Close();
            }
            catch { /* 用户取消了 UAC */ }
        }

        void OnNext()
        {
            if (page == 1 && !ValidateInstallPage()) return;
            if (page == 2 && !ValidateDataPage()) return;
            if (page == 3) { StartInstall(); return; }
            if (page == 5) { Finish(); return; }
            Go(page + 1);
        }

        void StartInstall()
        {
            var o = new InstallOptions
            {
                InstallDir = InstallDir(),
                DataDir = DataDir(),
                MigrateFrom = chkMigrate.Checked ? Util.NormalizeDir(txtMigrate.Text) : null,
                DesktopShortcut = chkDesktop.Checked,
                StartMenuShortcut = chkStartMenu.Checked
            };
            if (Util.AnyRunning(o.InstallDir) &&
                MessageBox.Show(this, Consts.AppName + " 正在运行，安装程序需要先关闭它。\r\n是否继续？", Text,
                    MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;

            installing = true;
            Go(4);
            var th = new Thread(delegate ()
            {
                try
                {
                    Engine.Install(o, (pct, msg) => BeginInvoke((Action)delegate
                    {
                        bar.Value = Math.Max(0, Math.Min(100, pct));
                        lblStatus.Text = msg.Length > 80 ? msg.Substring(0, 77) + "…" : msg;
                    }));
                    BeginInvoke((Action)delegate
                    {
                        installing = false; finished = true;
                        var ft = pages[5].Controls["finishText"];
                        ft.Text = Consts.AppName + " 已安装完成。\r\n\r\n安装位置：" + o.InstallDir + "\r\n数据位置：" + o.DataDir +
                                  "\r\n\r\n可在“设置 → 应用 → 已安装的应用”中卸载。";
                        Go(5);
                        installedExe = Path.Combine(o.InstallDir, Consts.ExeName);
                    });
                }
                catch (Exception ex)
                {
                    BeginInvoke((Action)delegate
                    {
                        installing = false;
                        MessageBox.Show(this, "安装失败：\r\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                        Go(3);
                    });
                }
            });
            th.IsBackground = true;
            th.Start();
        }

        string installedExe;

        void Finish()
        {
            if (chkLaunch.Checked && installedExe != null)
            {
                try { Process.Start(new ProcessStartInfo(installedExe) { WorkingDirectory = Path.GetDirectoryName(installedExe), UseShellExecute = true }); } catch { }
            }
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (installing) { e.Cancel = true; return; }
            if (!finished && e.CloseReason == CloseReason.UserClosing &&
                MessageBox.Show(this, "确定要退出安装程序吗？", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                e.Cancel = true;
            base.OnFormClosing(e);
        }
    }

    static class Program
    {
        static string Arg(string[] args, string name)
        {
            foreach (string a in args)
                if (a.StartsWith(name + "=", StringComparison.OrdinalIgnoreCase)) return a.Substring(name.Length + 1).Trim('"');
            return null;
        }

        static bool Has(string[] args, string name)
        {
            foreach (string a in args) if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        /// <summary>
        /// 用法：
        ///   WorkClock-Setup.exe                         图形界面安装
        ///   WorkClock-Setup.exe /D=路径 /DATA=路径      预填安装位置 / 数据位置
        ///   WorkClock-Setup.exe /S /D=路径 [/DATA=路径] [/NOSHORTCUT] [/MIGRATE=旧数据目录]  静默安装
        /// </summary>
        [STAThread]
        static int Main(string[] args)
        {
            string dir = Util.NormalizeDir(Arg(args, "/D"));
            string data = Util.NormalizeDir(Arg(args, "/DATA"));

            if (Has(args, "/S"))
            {
                try
                {
                    if (dir == null) dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "WorkClock");
                    var o = new InstallOptions
                    {
                        InstallDir = dir,
                        DataDir = data ?? Path.Combine(dir, "data"),
                        MigrateFrom = Util.NormalizeDir(Arg(args, "/MIGRATE")),
                        DesktopShortcut = !Has(args, "/NOSHORTCUT"),
                        StartMenuShortcut = !Has(args, "/NOSHORTCUT")
                    };
                    Engine.Install(o, (p, m) => { });
                    return 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(ex.ToString());
                    return 1;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new Wizard(dir, data));
            return 0;
        }
    }
}
