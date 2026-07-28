using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;

namespace ZenithJoy.AgentPanel;

/// <summary>
/// 作战窗主窗口 —— 只做窗口力学(定位/尺寸/WS_EX标志/热键)，业务状态渲染全部交给
/// apps/agent-panel 已构建的网页内容(它自己订阅本地SSE+已实现三态UI)。
///
/// RPA fail-closed 判定在本类原生独立轮询(不依赖网页JS线程健康——安全关键属性，
/// 双保险优于单一信任web bridge消息)。
/// </summary>
public partial class MainWindow : Window
{
    private const string AgentLocalBase = "http://localhost:58432";
    private static readonly TimeSpan RpaPollInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan RpaPollTimeout = TimeSpan.FromSeconds(3);

    private readonly HttpClient _http = new() { Timeout = RpaPollTimeout };
    private readonly DispatcherTimer _rpaPollTimer;
    private bool _userWantsExpanded;
    private bool _rpaActive;
    private IntPtr _hwnd;
    // 托盘图标只借 WinForms 的 NotifyIcon 类(WPF没有自己的托盘API)，不引入其它WinForms控件；
    // 全部用完整命名空间限定，避免 System.Windows.MessageBox 与 System.Windows.Forms.MessageBox 撞名。
    private System.Windows.Forms.NotifyIcon? _trayIcon;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;

        _rpaPollTimer = new DispatcherTimer { Interval = RpaPollInterval };
        _rpaPollTimer.Tick += async (_, _) => await PollRpaGuardAsync();
    }

    private async void OnLoaded(object? sender, RoutedEventArgs e)
    {
        _hwnd = new WindowInteropHelper(this).Handle;
        HwndSource.FromHwnd(_hwnd)!.AddHook(WndProc);
        NativeMethods.RegisterHotKey(
            _hwnd, NativeMethods.HOTKEY_ID_SUMMON,
            NativeMethods.MOD_CONTROL | NativeMethods.MOD_ALT, NativeMethods.VK_Z);
        SetupTrayIcon();

        await Web.EnsureCoreWebView2Async();
        Web.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
        NavigateToPanelContent();

        ApplyWindowMode(PanelWindowState.Resolve(_userWantsExpanded, _rpaActive));
        _rpaPollTimer.Start();
    }

    private void NavigateToPanelContent()
    {
        // 打包时 apps/agent-panel/dist 随 exe 一起分发（同目录 agent-panel-web/index.html），
        // 与 line04 的 python-embedded 打包同一套思路——不依赖开发服务器。
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var indexPath = Path.Combine(baseDir, "agent-panel-web", "index.html");
        Web.CoreWebView2.Navigate(File.Exists(indexPath) ? new Uri(indexPath).AbsoluteUri : "http://localhost:5175");
    }

    // PrepPRD Golden Path Step3："客户按热键(Ctrl+Alt+Z)或点托盘 → 展开"——两条召唤入口都要通，
    // 缺了这个客户热键一失灵/一冲突就彻底叫不出面板了。
    private void SetupTrayIcon()
    {
        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
        var icon = File.Exists(iconPath)
            ? new System.Drawing.Icon(iconPath)
            : System.Drawing.SystemIcons.Application;

        _trayIcon = new System.Windows.Forms.NotifyIcon
        {
            Icon = icon,
            Visible = true,
            Text = "作战窗",
        };
        _trayIcon.Click += (_, _) => ToggleExpanded();
    }

    private void ToggleExpanded()
    {
        _userWantsExpanded = !_userWantsExpanded;
        ApplyWindowMode(PanelWindowState.Resolve(_userWantsExpanded, _rpaActive));
    }

    private void OnWebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var type = doc.RootElement.GetProperty("type").GetString();
            if (type == "user-toggle-expand")
            {
                _userWantsExpanded = doc.RootElement.GetProperty("expanded").GetBoolean();
                ApplyWindowMode(PanelWindowState.Resolve(_userWantsExpanded, _rpaActive));
            }
        }
        catch
        {
            // 坏消息帧跳过，不崩宿主（旁观者纪律）
        }
    }

    private async Task PollRpaGuardAsync()
    {
        bool held;
        try
        {
            var resp = await _http.GetAsync($"{AgentLocalBase}/api/agent/desktop-lease-broker/status");
            if (!resp.IsSuccessStatusCode)
            {
                held = true; // fail-closed
            }
            else
            {
                using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
                held = doc.RootElement.TryGetProperty("held", out var h) && h.GetBoolean();
            }
        }
        catch
        {
            held = true; // 超时/网络异常 → fail-closed
        }

        if (held != _rpaActive)
        {
            _rpaActive = held;
            ApplyWindowMode(PanelWindowState.Resolve(_userWantsExpanded, _rpaActive));
        }
    }

    private void ApplyWindowMode(PanelWindowMode mode)
    {
        var screen = SystemParameters.WorkArea;
        switch (mode)
        {
            case PanelWindowMode.Collapsed:
                NativeMethods.ClearRpaGuardStyles(_hwnd);
                Left = screen.Right - 8;
                Top = screen.Top + 12;
                Width = 8;
                Height = screen.Height - 60;
                Topmost = true;
                break;
            case PanelWindowMode.Expanded:
                NativeMethods.ClearRpaGuardStyles(_hwnd);
                Left = screen.Left;
                Top = screen.Top;
                Width = screen.Width;
                Height = screen.Height;
                Topmost = true;
                break;
            case PanelWindowMode.RpaMini:
                // 判定点：展开态期间 RPA 突然开始 → 立即抢占式收起为贴边态，不等用户手动收起
                Left = screen.Right - 246;
                Top = screen.Bottom - 220;
                Width = 230;
                Height = 200;
                NativeMethods.ApplyRpaGuardStyles(_hwnd); // 永不夺焦 + 鼠标穿透
                break;
        }
    }

    private nint WndProc(nint hwnd, int msg, nint wParam, nint lParam, ref bool handled)
    {
        if (msg == NativeMethods.WM_HOTKEY && wParam.ToInt32() == NativeMethods.HOTKEY_ID_SUMMON)
        {
            ToggleExpanded();
            handled = true;
        }
        return IntPtr.Zero;
    }

    protected override void OnClosed(EventArgs e)
    {
        NativeMethods.UnregisterHotKey(_hwnd, NativeMethods.HOTKEY_ID_SUMMON);
        _rpaPollTimer.Stop();
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false; // 不显式隐藏，图标会在托盘里残留到下次鼠标划过才消失
            _trayIcon.Dispose();
        }
        base.OnClosed(e);
    }
}
