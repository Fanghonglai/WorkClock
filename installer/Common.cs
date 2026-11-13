using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;

namespace WorkClockSetup
{
    static class Consts
    {
        public const string AppName = "工时打卡";
        public const string ExeName = "工时打卡.exe";
        public const string ProcName = "工时打卡";
        public const string Version = "1.0.5";
        public const string Publisher = "Fanghonglai";
        public const string RegKey = @"Software\WorkClock";
        public const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\WorkClock";
        public const string ConfigName = "workclock.config.json";
        public const string UninstallerName = "Uninstall.exe";
    }

    static class Util
    {
        public static bool IsAdmin()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); }
            catch { return false; }
        }

        public static string NormalizeDir(string p)
        {
            if (string.IsNullOrWhiteSpace(p)) return null;
            p = Environment.ExpandEnvironmentVariables(p.Trim().Trim('"'));
            try
            {
                if (!Path.IsPathRooted(p)) return null;
                string full = Path.GetFullPath(p);
                if (full.Length > 3) full = full.TrimEnd('\\', '/');
                return full;
            }
            catch { return null; }
        }

        public static bool SamePath(string a, string b)
        {
            if (a == null || b == null) return false;
            return string.Equals(a.TrimEnd('\\'), b.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsUnder(string child, string parent)
        {
            if (child == null || parent == null) return false;
            string c = child.TrimEnd('\\') + "\\";
            string p = parent.TrimEnd('\\') + "\\";
            return c.StartsWith(p, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>检测目录是否可写（必要时创建目录）。</summary>
        public static bool CanWrite(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                string probe = Path.Combine(dir, ".wc_write_test_" + Guid.NewGuid().ToString("N"));
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return true;
            }
            catch { return false; }
        }

        public static string JsonEscape(string s)
        {
            var sb = new StringBuilder();
            foreach (char ch in s)
            {
                switch (ch)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < 0x20) sb.AppendFormat("\\u{0:x4}", (int)ch); else sb.Append(ch);
                        break;
                }
            }
            return sb.ToString();
        }

        /// <summary>从 workclock.config.json 中读取 dataDir（简单解析，无需 JSON 库）。</summary>
        public static string ReadDataDirFromConfig(string installDir)
        {
            try
            {
                string f = Path.Combine(installDir, Consts.ConfigName);
                if (!File.Exists(f)) return null;
                string t = File.ReadAllText(f, Encoding.UTF8);
                int k = t.IndexOf("\"dataDir\"", StringComparison.Ordinal);
                if (k < 0) return null;
                int colon = t.IndexOf(':', k);
                int q1 = t.IndexOf('"', colon + 1);
                if (q1 < 0) return null;
                var sb = new StringBuilder();
                for (int i = q1 + 1; i < t.Length; i++)
                {
                    char ch = t[i];
                    if (ch == '\\' && i + 1 < t.Length)
                    {
                        char n = t[++i];
                        if (n == 'u' && i + 4 < t.Length) { sb.Append((char)Convert.ToInt32(t.Substring(i + 1, 4), 16)); i += 4; }
                        else if (n == 'n') sb.Append('\n');
                        else if (n == 't') sb.Append('\t');
                        else if (n == 'r') sb.Append('\r');
                        else sb.Append(n);
                    }
                    else if (ch == '"') break;
                    else sb.Append(ch);
                }
                string v = sb.ToString();
                if (!Path.IsPathRooted(v)) v = Path.GetFullPath(Path.Combine(installDir, v));
                return v;
            }
            catch { return null; }
        }

        public static string RegRead(string key, string name)
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(key))
                {
                    if (k == null) return null;
                    return k.GetValue(name) as string;
                }
            }
            catch { return null; }
        }

        /// <summary>结束安装目录中正在运行的程序进程。</summary>
        public static int KillRunning(string installDir)
        {
            int n = 0;
            foreach (var p in Process.GetProcessesByName(Consts.ProcName))
            {
                try
                {
                    string file = p.MainModule.FileName;
                    if (installDir == null || IsUnder(file, installDir))
                    {
                        p.Kill();
                        p.WaitForExit(5000);
                        n++;
                    }
                }
                catch { }
            }
            return n;
        }

        public static bool AnyRunning(string installDir)
        {
            foreach (var p in Process.GetProcessesByName(Consts.ProcName))
            {
                try { if (installDir == null || IsUnder(p.MainModule.FileName, installDir)) return true; }
                catch { }
            }
            return false;
        }

        public static void CreateShortcut(string lnkPath, string target, string workDir, string desc)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { workDir });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { desc });
            st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        public static string StartMenuLnk() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Consts.AppName + ".lnk"); }
        public static string DesktopLnk() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Consts.AppName + ".lnk"); }

        public static string FormatSize(long bytes)
        {
            if (bytes >= 1L << 30) return (bytes / (double)(1L << 30)).ToString("0.0") + " GB";
            return (bytes / (double)(1L << 20)).ToString("0") + " MB";
        }

        public static long FreeSpace(string path)
        {
            try { return new DriveInfo(Path.GetPathRoot(path)).AvailableFreeSpace; } catch { return -1; }
        }
    }
}
