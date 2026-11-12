using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WorkClockSetup
{
    static class Uninstaller
    {
        static bool silent;

        static void Info(string msg, MessageBoxIcon icon = MessageBoxIcon.Information)
        {
            if (!silent) MessageBox.Show(msg, Consts.AppName + " 卸载", MessageBoxButtons.OK, icon);
        }

        [STAThread]
        static int Main(string[] args)
        {
            silent = Array.Exists(args, a => string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase));
            bool purge = Array.Exists(args, a => string.Equals(a, "/PURGE", StringComparison.OrdinalIgnoreCase));
            string from = null;
            foreach (string a in args)
                if (a.StartsWith("/FROM=", StringComparison.OrdinalIgnoreCase)) from = a.Substring(6).Trim('"');

            Application.EnableVisualStyles();
            string self = Application.ExecutablePath;

            // 第一阶段：从安装目录复制自身到临时目录再运行，以便删除安装目录
            if (from == null)
            {
                string installDir = Path.GetDirectoryName(self);
                if (!silent && MessageBox.Show("确定要完全卸载 " + Consts.AppName + " 吗？", Consts.AppName + " 卸载",
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
                string tmp = Path.Combine(Path.GetTempPath(), "WorkClock-Uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
                File.Copy(self, tmp, true);
                string extra = (silent ? " /S" : "") + (purge ? " /PURGE" : "");
                var p = Process.Start(new ProcessStartInfo(tmp, "/FROM=\"" + installDir + "\"" + extra) { UseShellExecute = false });
                if (silent) { p.WaitForExit(); return p.ExitCode; }
                return 0;
            }

            int code = 0;
            try { code = DoUninstall(Util.NormalizeDir(from), purge); }
            catch (Exception ex) { Info("卸载时出错：\r\n" + ex.Message, MessageBoxIcon.Error); code = 2; }

            // 删除临时卸载程序自身
            try
            {
                Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + self + "\"")
                { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
            }
            catch { }
            return code;
        }

        static int DoUninstall(string installDir, bool purge)
        {
            if (installDir == null || !File.Exists(Path.Combine(installDir, Consts.ExeName)))
            {
                Info("未在以下位置找到 " + Consts.AppName + "：\r\n" + installDir, MessageBoxIcon.Warning);
                return 3;
            }
            string dataDir = Util.ReadDataDirFromConfig(installDir) ?? Path.Combine(installDir, "data");

            bool deleteData = purge;
            if (!silent && Directory.Exists(dataDir))
            {
                deleteData = MessageBox.Show("是否同时删除本地数据（打卡记录、设置和备份）？\r\n\r\n数据位置：" + dataDir +
                    "\r\n\r\n选择“否”将保留数据，重新安装后可继续使用。", Consts.AppName + " 卸载",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
            }

            Util.KillRunning(installDir);
            System.Threading.Thread.Sleep(500);

            // 删除程序文件（若数据目录位于安装目录内且需保留，则跳过它）
            DeleteTree(installDir, deleteData ? null : dataDir);
            if (deleteData && Directory.Exists(dataDir))
            {
                try { Directory.Delete(dataDir, true); } catch { }
            }

            try { File.Delete(Util.StartMenuLnk()); } catch { }
            try { File.Delete(Util.DesktopLnk()); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(Consts.UninstKey, false); } catch { }
            try
            {
                if (deleteData) Registry.CurrentUser.DeleteSubKeyTree(Consts.RegKey, false);
                else using (var k = Registry.CurrentUser.CreateSubKey(Consts.RegKey)) { k.DeleteValue("InstallDir", false); }
            }
            catch { }

            Info(Consts.AppName + " 已卸载。" + (deleteData ? "" : "\r\n\r\n本地数据已保留在：\r\n" + dataDir));
            return 0;
        }

        /// <summary>递归删除目录，跳过 keep 目录（及其父目录本身）。</summary>
        static void DeleteTree(string dir, string keep)
        {
            if (!Directory.Exists(dir)) return;
            if (keep != null && Util.SamePath(dir, keep)) return;
            foreach (string f in Directory.GetFiles(dir))
            {
                try { File.SetAttributes(f, FileAttributes.Normal); File.Delete(f); } catch { }
            }
            foreach (string d in Directory.GetDirectories(dir)) DeleteTree(d, keep);
            if (keep == null || !Util.IsUnder(keep, dir))
            {
                try { Directory.Delete(dir, false); } catch { }
            }
        }
    }
}
