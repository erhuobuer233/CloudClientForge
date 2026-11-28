// @@PRODUCT@@ —— 带缓存的自解压启动器（由 CloudClientForge 生成）
//
// 为什么要自己写启动器：
//   electron-builder 的 portable 单文件版每次启动都要把运行环境重新解包到临时目录
//   （约 10 秒以上）。这里改成：
//     · 首次运行：解包一次到 %LOCALAPPDATA%\@@CACHE_ROOT@@\runtime\<payload指纹>（带进度窗）
//     · 之后运行：直接启动已解包好的程序（约 1 秒）
//   仍然只有一个 exe，拷到别的机器/别的目录也能用（那边会重新解包一次）。
//
// 缓存目录名来自 PayloadInfo.Id（由 tools\build-client.ps1 依据 payload.zip 的
// SHA256 自动生成），重新打包后旧缓存自动失效并被清理。
//
// 不要手工调用 csc，直接用打包脚本：
//   powershell -ExecutionPolicy Bypass -File tools\build-client.ps1

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("@@PRODUCT@@")]
[assembly: AssemblyCompany("CloudClientForge")]
[assembly: AssemblyProduct("@@PRODUCT@@")]
[assembly: AssemblyDescription("@@PRODUCT@@ Desktop (cached self-extracting launcher)")]
[assembly: AssemblyVersion(PayloadInfo.Version)]
[assembly: AssemblyFileVersion(PayloadInfo.Version)]

internal static class Launcher
{
    private const string AppExeName = "@@APP_EXE@@";
    private const string PayloadResourceName = "payload.zip";
    private const string MutexName = @"Global\@@MUTEX@@";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
        }
        catch (Exception)
        {
            // 没有图形环境也无所谓，继续走解包/启动流程
        }

        string cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "@@CACHE_ROOT@@", "runtime");
        string runtimeRoot = Path.Combine(cacheRoot, PayloadInfo.Id);
        string appExe = Path.Combine(runtimeRoot, AppExeName);
        string marker = Path.Combine(runtimeRoot, ".ready");

        if (!IsReady(marker, appExe))
        {
            using (Mutex mutex = new Mutex(false, MutexName))
            {
                bool acquired = false;
                try
                {
                    try
                    {
                        acquired = mutex.WaitOne(TimeSpan.FromMinutes(15));
                    }
                    catch (AbandonedMutexException)
                    {
                        acquired = true;
                    }

                    // 双重检查：可能刚被另一个实例解包完
                    if (!IsReady(marker, appExe))
                    {
                        Prepare(cacheRoot, runtimeRoot, marker);
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Failed to prepare the runtime on first launch:\r\n\r\n" + ex.Message +
                        "\r\n\r\nYou can delete the folder below and try again:\r\n" + runtimeRoot,
                        "@@PRODUCT@@", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                finally
                {
                    if (acquired)
                    {
                        try { mutex.ReleaseMutex(); }
                        catch (Exception) { }
                    }
                }
            }
        }

        if (!File.Exists(appExe))
        {
            MessageBox.Show("Client executable not found:\r\n" + appExe,
                "@@PRODUCT@@", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(appExe);
            psi.WorkingDirectory = runtimeRoot;
            psi.UseShellExecute = false;
            if (args != null && args.Length > 0)
            {
                psi.Arguments = JoinArguments(args);
            }
            // 某些开发/自动化环境会传 ELECTRON_RUN_AS_NODE=1，那会让 Electron 以 Node
            // 模式运行（窗口不出现、进程立刻退出）。这里显式清掉，保证正常图形模式。
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Failed to start the client:\r\n\r\n" + ex.Message,
                "@@PRODUCT@@", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        return 0;
    }

    private static bool IsReady(string marker, string appExe)
    {
        return File.Exists(marker) && File.Exists(appExe);
    }

    private static void Prepare(string cacheRoot, string runtimeRoot, string marker)
    {
        Form splash = BuildSplash();
        Exception failure = null;

        Thread worker = new Thread(delegate()
        {
            try
            {
                if (Directory.Exists(runtimeRoot))
                {
                    DeleteDirectory(runtimeRoot);
                }
                Directory.CreateDirectory(runtimeRoot);

                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream raw = asm.GetManifestResourceStream(PayloadResourceName))
                {
                    if (raw == null)
                    {
                        throw new InvalidOperationException("Embedded runtime payload is missing (" + PayloadResourceName + ")");
                    }
                    using (ZipArchive archive = new ZipArchive(raw, ZipArchiveMode.Read))
                    {
                        ZipFileExtensions.ExtractToDirectory(archive, runtimeRoot);
                    }
                }

                File.WriteAllText(marker, DateTime.Now.ToString("o"));

                // 新缓存已经可用，顺手清掉旧 payload 留下的缓存目录，避免一直占着几百 MB
                CleanupOldCaches(cacheRoot, runtimeRoot);
            }
            catch (Exception ex)
            {
                failure = ex;
            }
        });
        worker.IsBackground = true;
        worker.Start();

        if (splash != null)
        {
            try
            {
                splash.Show();
                splash.Refresh();
                while (worker.IsAlive)
                {
                    Application.DoEvents();
                    Thread.Sleep(40);
                }
            }
            finally
            {
                try { splash.Close(); } catch (Exception) { }
                try { splash.Dispose(); } catch (Exception) { }
            }
        }
        else
        {
            worker.Join();
        }

        if (failure != null)
        {
            throw failure;
        }
    }

    /// <summary>删除属于其它 payload 指纹的旧缓存目录（失败不影响使用）。</summary>
    private static void CleanupOldCaches(string cacheRoot, string keep)
    {
        try
        {
            string keepFull = Path.GetFullPath(keep);
            foreach (string dir in Directory.GetDirectories(cacheRoot))
            {
                if (string.Equals(Path.GetFullPath(dir), keepFull, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                try
                {
                    Directory.Delete(dir, true);
                }
                catch (Exception)
                {
                    // 可能正被另一个实例占用，下次启动再清
                }
            }
        }
        catch (Exception)
        {
        }
    }

    private static void DeleteDirectory(string path)
    {
        try
        {
            Directory.Delete(path, true);
        }
        catch (IOException)
        {
            Thread.Sleep(300);
            Directory.Delete(path, true);
        }
        catch (UnauthorizedAccessException)
        {
            Thread.Sleep(300);
            Directory.Delete(path, true);
        }
    }

    private static Form BuildSplash()
    {
        try
        {
            Form form = new Form();
            form.Text = "@@PRODUCT@@";
            form.FormBorderStyle = FormBorderStyle.None;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new Size(480, 138);
            form.BackColor = Color.FromArgb(10, 12, 32);
            form.TopMost = true;

            Label title = new Label();
            title.Text = "@@PRODUCT@@";
            title.ForeColor = Color.FromArgb(235, 238, 248);
            title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
            title.SetBounds(0, 24, form.ClientSize.Width, 32);
            title.TextAlign = ContentAlignment.MiddleCenter;

            Label hint = new Label();
            hint.Text = "First launch: preparing the runtime (a few seconds).\r\nAfter that, startup takes about 1 second.";
            hint.ForeColor = Color.FromArgb(150, 158, 180);
            hint.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular);
            hint.SetBounds(0, 62, form.ClientSize.Width, 48);
            hint.TextAlign = ContentAlignment.MiddleCenter;

            Label foot = new Label();
            foot.Text = "@@SPLASH_FOOT@@";
            foot.ForeColor = Color.FromArgb(110, 120, 160);
            foot.Font = new Font("Microsoft YaHei UI", 8F, FontStyle.Regular);
            foot.SetBounds(0, 108, form.ClientSize.Width, 20);
            foot.TextAlign = ContentAlignment.MiddleCenter;

            form.Controls.Add(title);
            form.Controls.Add(hint);
            form.Controls.Add(foot);
            return form;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static string JoinArguments(string[] args)
    {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < args.Length; i++)
        {
            if (i > 0) sb.Append(' ');
            sb.Append('"').Append(args[i].Replace("\"", "\\\"")).Append('"');
        }
        return sb.ToString();
    }
}
