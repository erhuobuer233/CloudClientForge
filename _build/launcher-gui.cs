// CloudClientForge（GUI 版）—— 带缓存的自解压启动器
//
// 和生成的客户端用的是同一套思路：首次解包到 %LOCALAPPDATA%\CloudClientForgeDesktop\runtime\<指纹>，
// 之后直接启动（约 1 秒）。
//
// 额外做了一件事：把「启动器所在目录」通过环境变量 CLOUDFORGE_HOME 传给界面。
// 因为界面本身跑在缓存目录里（execPath 指向缓存），它需要知道真正的 forge 根目录在哪
// （forge.ps1 / toolchain 都在那边）。

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("CloudClientForge")]
[assembly: AssemblyProduct("CloudClientForge")]
[assembly: AssemblyDescription("CloudClientForge - build a desktop client from a cloud game web page")]
[assembly: AssemblyVersion(PayloadInfo.Version)]
[assembly: AssemblyFileVersion(PayloadInfo.Version)]

internal static class Launcher
{
    private const string AppExeName = "CloudClientForge.exe";
    private const string PayloadResourceName = "payload.zip";
    private const string MutexName = @"Global\CloudClientForgeLauncher";

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
        }

        string launcherDir = AppDomain.CurrentDomain.BaseDirectory;

        string cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "CloudClientForgeDesktop", "runtime");
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
                        "CloudClientForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            MessageBox.Show("GUI executable not found:\r\n" + appExe,
                "CloudClientForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            // 界面需要真正的 forge 根目录（forge.ps1 / toolchain 在这里）
            psi.EnvironmentVariables["CLOUDFORGE_HOME"] = launcherDir.TrimEnd('\\');
            psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Failed to start CloudClientForge:\r\n\r\n" + ex.Message,
                "CloudClientForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            form.Text = "CloudClientForge";
            form.FormBorderStyle = FormBorderStyle.None;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new Size(470, 128);
            form.BackColor = Color.FromArgb(12, 15, 30);
            form.TopMost = true;

            Label title = new Label();
            title.Text = "CloudClientForge";
            title.ForeColor = Color.FromArgb(235, 238, 255);
            title.Font = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
            title.SetBounds(0, 24, form.ClientSize.Width, 32);
            title.TextAlign = ContentAlignment.MiddleCenter;

            Label hint = new Label();
            hint.Text = "First launch: preparing the runtime (a few seconds).";
            hint.ForeColor = Color.FromArgb(150, 158, 190);
            hint.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular);
            hint.SetBounds(0, 62, form.ClientSize.Width, 32);
            hint.TextAlign = ContentAlignment.MiddleCenter;

            Label foot = new Label();
            foot.Text = "把云游戏网页变成桌面客户端";
            foot.ForeColor = Color.FromArgb(120, 130, 175);
            foot.Font = new Font("Microsoft YaHei UI", 8F, FontStyle.Regular);
            foot.SetBounds(0, 96, form.ClientSize.Width, 20);
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
