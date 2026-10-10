using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Grile Diana")]
[assembly: AssemblyDescription("Launcher pentru aplicația Grile Diana")]
[assembly: AssemblyCompany("Grile Diana")]
[assembly: AssemblyProduct("Grile Diana")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace GrileDiana
{
    internal static class Program
    {
        private const int PreferredPort = 3001;
        private const string MutexName = @"Local\GrileDianaLauncher";
        private static readonly object CleanupLock = new object();

        private static string applicationDirectory;
        private static string applicationUrl;
        private static string portFile;
        private static int serverPort;
        private static Process serverProcess;
        private static NotifyIcon trayIcon;
        private static Icon applicationIcon;
        private static System.Windows.Forms.Timer processTimer;
        private static Mutex singleInstanceMutex;
        private static bool cleanedUp;

        [STAThread]
        private static void Main(string[] arguments)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool selfTest = Array.IndexOf(arguments, "--self-test") >= 0;
            bool ownsMutex;
            string activeMutexName = selfTest
                ? MutexName + "-SelfTest-" + Process.GetCurrentProcess().Id
                : MutexName;
            singleInstanceMutex = new Mutex(true, activeMutexName, out ownsMutex);
            if (!ownsMutex)
            {
                OpenRunningInstance();
                singleInstanceMutex.Dispose();
                return;
            }

            applicationDirectory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

            try
            {
                string nodeExecutable = Path.Combine(applicationDirectory, "runtime", "node.exe");
                string serverScript = Path.Combine(applicationDirectory, "server.js");
                string initialState = Path.Combine(applicationDirectory, "data", "diana-state.json");

                RequireFile(nodeExecutable, "Runtime-ul inclus lipsește din arhivă.");
                RequireFile(serverScript, "Fișierul server.js lipsește din arhivă.");

                string customDataDirectory = Environment.GetEnvironmentVariable("GRILE_DIANA_DATA_DIR");
                string localDataDirectory = string.IsNullOrWhiteSpace(customDataDirectory)
                    ? Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "Grile Diana"
                    )
                    : Path.GetFullPath(customDataDirectory);
                Directory.CreateDirectory(localDataDirectory);
                string stateFile = Path.Combine(localDataDirectory, "diana-state.json");
                portFile = Path.Combine(localDataDirectory, "server-port.txt");

                if (!File.Exists(stateFile) && File.Exists(initialState))
                {
                    File.Copy(initialState, stateFile, false);
                }

                serverPort = IsPortFree(PreferredPort) ? PreferredPort : FindFreePort();
                applicationUrl = "http://127.0.0.1:" + serverPort + "/";
                StartServer(nodeExecutable, serverScript, stateFile);

                if (!WaitUntilReady(TimeSpan.FromSeconds(15)))
                {
                    string detail = serverProcess != null && serverProcess.HasExited
                        ? "Serverul local s-a oprit cu codul " + serverProcess.ExitCode + "."
                        : "Serverul local nu a răspuns în timpul alocat.";
                    throw new InvalidOperationException(detail);
                }

                File.WriteAllText(portFile, serverPort.ToString(), Encoding.ASCII);
                if (selfTest) return;

                ConfigureTrayIcon();
                OpenBrowser();

                Application.ApplicationExit += delegate { Cleanup(); };
                Application.Run();
            }
            catch (Exception error)
            {
                Cleanup();
                MessageBox.Show(
                    "Grile Diana nu a putut porni.\n\n" + error.Message +
                    "\n\nAsigură-te că ai extras întreaga arhivă într-un folder și încearcă din nou.",
                    "Grile Diana",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                Cleanup();
                try { singleInstanceMutex.ReleaseMutex(); } catch (ApplicationException) { }
                singleInstanceMutex.Dispose();
            }
        }

        private static void RequireFile(string path, string message)
        {
            if (!File.Exists(path)) throw new FileNotFoundException(message, path);
        }

        private static void StartServer(string nodeExecutable, string serverScript, string stateFile)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo();
            startInfo.FileName = nodeExecutable;
            startInfo.Arguments = QuoteArgument(serverScript);
            startInfo.WorkingDirectory = applicationDirectory;
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.WindowStyle = ProcessWindowStyle.Hidden;
            startInfo.EnvironmentVariables["PORT"] = serverPort.ToString();
            startInfo.EnvironmentVariables["GRILE_STATE_FILE"] = stateFile;

            serverProcess = Process.Start(startInfo);
            if (serverProcess == null) throw new InvalidOperationException("Serverul local nu a putut fi pornit.");
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static bool WaitUntilReady(TimeSpan timeout)
        {
            Stopwatch stopwatch = Stopwatch.StartNew();
            while (stopwatch.Elapsed < timeout)
            {
                if (serverProcess.HasExited) return false;
                if (IsApplicationReady(applicationUrl)) return true;
                Thread.Sleep(100);
            }
            return false;
        }

        private static bool IsApplicationReady(string baseUrl)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(baseUrl + "api/state");
                request.Method = "GET";
                request.Proxy = null;
                request.Timeout = 350;
                request.ReadWriteTimeout = 350;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    return response.StatusCode == HttpStatusCode.OK &&
                        reader.ReadToEnd().Contains("\"schema\":\"grile-diana-state\"");
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool IsPortFree(int port)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
            finally
            {
                if (listener != null) listener.Stop();
            }
        }

        private static int FindFreePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static void ConfigureTrayIcon()
        {
            applicationIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            MenuItem openItem = new MenuItem("Deschide aplicația", delegate { OpenBrowser(); });
            openItem.DefaultItem = true;
            MenuItem exitItem = new MenuItem("Închide aplicația", delegate { Application.Exit(); });

            trayIcon = new NotifyIcon();
            trayIcon.Icon = applicationIcon ?? SystemIcons.Application;
            trayIcon.Text = "Grile Diana — server local activ";
            trayIcon.ContextMenu = new ContextMenu(new MenuItem[] { openItem, exitItem });
            trayIcon.DoubleClick += delegate { OpenBrowser(); };
            trayIcon.BalloonTipClicked += delegate { OpenBrowser(); };
            trayIcon.Visible = true;
            trayIcon.ShowBalloonTip(
                4000,
                "Grile Diana rulează",
                "Aplicația rămâne activă aici. Click dreapta pe iconiță pentru a o închide.",
                ToolTipIcon.Info
            );

            processTimer = new System.Windows.Forms.Timer();
            processTimer.Interval = 1000;
            processTimer.Tick += delegate
            {
                if (serverProcess != null && serverProcess.HasExited)
                {
                    processTimer.Stop();
                    MessageBox.Show(
                        "Serverul local s-a oprit neașteptat. Redeschide Grile Diana.exe.",
                        "Grile Diana",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Warning
                    );
                    Application.Exit();
                }
            };
            processTimer.Start();
        }

        private static void OpenBrowser()
        {
            if (string.IsNullOrEmpty(applicationUrl)) return;
            ProcessStartInfo browser = new ProcessStartInfo(applicationUrl);
            browser.UseShellExecute = true;
            Process.Start(browser);
        }

        private static void OpenRunningInstance()
        {
            try
            {
                string localDataDirectory = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Grile Diana"
                );
                string existingPortFile = Path.Combine(localDataDirectory, "server-port.txt");

                for (int attempt = 0; attempt < 30; attempt++)
                {
                    if (File.Exists(existingPortFile))
                    {
                        int port;
                        if (int.TryParse(File.ReadAllText(existingPortFile).Trim(), out port))
                        {
                            string url = "http://127.0.0.1:" + port + "/";
                            if (IsApplicationReady(url))
                            {
                                ProcessStartInfo browser = new ProcessStartInfo(url);
                                browser.UseShellExecute = true;
                                Process.Start(browser);
                                return;
                            }
                        }
                    }
                    Thread.Sleep(100);
                }

                MessageBox.Show(
                    "Grile Diana pornește deja. O poți deschide din iconița aflată lângă ceas.",
                    "Grile Diana",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
            catch (Exception error)
            {
                MessageBox.Show("Aplicația rulează deja.\n\n" + error.Message, "Grile Diana");
            }
        }

        private static void Cleanup()
        {
            lock (CleanupLock)
            {
                if (cleanedUp) return;
                cleanedUp = true;

                if (processTimer != null)
                {
                    processTimer.Stop();
                    processTimer.Dispose();
                }

                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }

                if (serverProcess != null)
                {
                    try
                    {
                        if (!serverProcess.HasExited)
                        {
                            serverProcess.Kill();
                            serverProcess.WaitForExit(3000);
                        }
                    }
                    catch { }
                    serverProcess.Dispose();
                }

                if (!string.IsNullOrEmpty(portFile))
                {
                    try
                    {
                        if (File.Exists(portFile) && File.ReadAllText(portFile).Trim() == serverPort.ToString())
                        {
                            File.Delete(portFile);
                        }
                    }
                    catch { }
                }

                if (applicationIcon != null) applicationIcon.Dispose();
            }
        }
    }
}
