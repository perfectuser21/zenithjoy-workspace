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
    private static readonly TimeSpan FullscreenPollInterval = TimeSpan.FromSeconds(2);

    private readonly HttpClient _http = new() { Timeout = RpaPollTimeout };
    private readonly DispatcherTimer _rpaPollTimer;
    private readonly DispatcherTimer _fullscreenPollTimer;
    private bool _userWantsExpanded;
    private bool _rpaActive;
    private bool _hasStuck;
    private IntPtr _hwnd;
    // 托盘图标只借 WinForms 的 NotifyIcon 类(WPF没有自己的托盘API)，不引入其它WinForms控件；
    // 全部用完整命名空间限定，避免 System.Windows.MessageBox 与 System.Windows.Forms.MessageBox 撞名。
    private System.Windows.Forms.NotifyIcon? _trayIcon;
    private System.Drawing.Icon? _baseTrayIcon;
    private System.Drawing.Icon? _stuckTrayIcon; // GetHicon()产生的非托管句柄，用完必须显式Dispose不然长期运行泄漏GDI句柄

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;

        _rpaPollTimer = new DispatcherTimer { Interval = RpaPollInterval };
        _rpaPollTimer.Tick += async (_, _) => await PollRpaGuardAsync();

        // PrepPRD Golden Path Step9："客户前台全屏(视频/PPT/游戏)：浮条自动隐藏"——
        // 跟RPA轮询同一节奏，原生独立轮询不依赖网页JS线程健康。
        _fullscreenPollTimer = new DispatcherTimer { Interval = FullscreenPollInterval };
        _fullscreenPollTimer.Tick += (_, _) => UpdateFullscreenSuppression();
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
        _fullscreenPollTimer.Start();
    }

    private const string VirtualHost = "agent-panel.local";

    private void NavigateToPanelContent()
    {
        // 打包时 apps/agent-panel/dist 随 exe 一起分发（同目录 agent-panel-web/index.html）。
        // xian-rog 真机验证实测：<script type="module"> 打包产物直接以 file:// 加载会被
        // Chromium 的模块加载 CORS 限制静默拦截（不触发 window.onerror，也不报 NavigationCompleted
        // 失败——WebView2 认为导航成功，只是脚本从未执行，#root 永远空）。改用
        // SetVirtualHostNameToFolderMapping 把本地目录映射成虚拟域名，微软官方文档推荐的
        // WebView2 加载本地打包网页内容的标准做法，避免这个 CORS 死角。
        // 用 http:// 不用 https://——真机验证实测：https 虚拟host会导致混合内容拦截，
        // 页面无法fetch/EventSource连本地 http://localhost:58432 后端（离线态永远卡死，
        // 即便后端真的在跑）。本地环回本来就没有传输层加密需求，http/http同scheme即可。
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var webRoot = Path.Combine(baseDir, "agent-panel-web");
        if (Directory.Exists(webRoot))
        {
            Web.CoreWebView2.SetVirtualHostNameToFolderMapping(
                VirtualHost, webRoot, Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);
            Web.CoreWebView2.Navigate($"http://{VirtualHost}/index.html");
        }
        else
        {
            Web.CoreWebView2.Navigate("http://localhost:5175");
        }
    }

    // PrepPRD Golden Path Step3："客户按热键(Ctrl+Alt+Z)或点托盘 → 展开"——两条召唤入口都要通，
    // 缺了这个客户热键一失灵/一冲突就彻底叫不出面板了。
    private void SetupTrayIcon()
    {
        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "icon.ico");
        _baseTrayIcon = File.Exists(iconPath)
            ? new System.Drawing.Icon(iconPath)
            : System.Drawing.SystemIcons.Application;

        _trayIcon = new System.Windows.Forms.NotifyIcon
        {
            Icon = _baseTrayIcon,
            Visible = true,
            Text = "作战窗",
        };
        _trayIcon.Click += (_, _) => ToggleExpanded();
    }

    // PrepPRD Golden Path Step9 的 stuck 例外："不弹窗不闪烁，只让托盘图标变红"——
    // 全屏隐藏浮条期间客户唯一能看到的提示就是这个。灯态聚合是网页侧已经在算的数据
    // (渲染灯带颜色的同一份)，宿主收到 light-state-changed 消息后原地画个红点叠加，
    // 不用额外准备一张红色图标资源文件。
    private void UpdateTrayIcon()
    {
        if (_trayIcon is null || _baseTrayIcon is null) return;

        var previousDynamicIcon = _stuckTrayIcon;
        _stuckTrayIcon = _hasStuck ? BuildStuckTrayIcon(_baseTrayIcon) : null;
        _trayIcon.Icon = _hasStuck ? _stuckTrayIcon : _baseTrayIcon;
        previousDynamicIcon?.Dispose(); // GetHicon()句柄，_trayIcon.Icon切走之后才能安全释放
    }

    private static System.Drawing.Icon BuildStuckTrayIcon(System.Drawing.Icon baseIcon)
    {
        using var bmp = baseIcon.ToBitmap();
        using var g = System.Drawing.Graphics.FromImage(bmp);
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        var dotSize = Math.Max(4, bmp.Width / 2);
        g.FillEllipse(System.Drawing.Brushes.Red, bmp.Width - dotSize, bmp.Height - dotSize, dotSize, dotSize);
        return System.Drawing.Icon.FromHandle(bmp.GetHicon());
    }

    // 热键(Ctrl+Alt+Z)/托盘点击是原生发起的展开态切换——只改窗口几何尺寸不够，
    // 网页内部 AgentPanelApp 自己也存了一份 expanded 状态决定渲染什么内容，
    // 不通知网页的话窗口已经变全屏但内容还停在收起态那个6px小灯（xian-rog真机验证实测复现）。
    private void ToggleExpanded()
    {
        _userWantsExpanded = !_userWantsExpanded;
        ApplyWindowMode(PanelWindowState.Resolve(_userWantsExpanded, _rpaActive));
        NotifyWebExpandChanged(_userWantsExpanded);
    }

    private void NotifyWebExpandChanged(bool expanded)
    {
        try
        {
            Web.CoreWebView2?.PostWebMessageAsJson(
                JsonSerializer.Serialize(new { type = "host-expand-changed", expanded }));
        }
        catch
        {
            // WebView2 还没初始化完成时忽略，不崩宿主（旁观者纪律）
        }
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
            else if (type == "light-state-changed")
            {
                _hasStuck = doc.RootElement.GetProperty("hasStuck").GetBoolean();
                UpdateTrayIcon();
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
                ReassertTopmost();
                break;
            case PanelWindowMode.Expanded:
                NativeMethods.ClearRpaGuardStyles(_hwnd);
                Left = screen.Left;
                Top = screen.Top;
                Width = screen.Width;
                Height = screen.Height;
                ReassertTopmost();
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
        UpdateFullscreenSuppression();
    }

    // 真机实测发现：WPF 的 Topmost=true 在已经是 true 时是no-op(依赖属性系统检测值未变
    // 直接跳过底层 SetWindowPos(HWND_TOPMOST) 调用)——窗口z-order从此再也不会被刷新到
    // 最上层。WeChat(非topmost普通窗口)被用户点击激活后，实测WindowFromPoint在本窗口
    // 屏幕坐标范围内返回的是微信句柄，说明本窗口早就跌到微信下面去了，只是Topmost标志位
    // 还是true，Windows并没有真的按这个标志位重新排过序。False→True显式切换强制WPF
    // 真正重新调用SetWindowPos，把窗口插回z-order最顶层。
    private void ReassertTopmost()
    {
        Topmost = false;
        Topmost = true;
        // 真机WindowFromPoint实测：光靠WPF的Topmost属性切换，实测仍然打不过微信这类
        // 普通非topmost窗口的z-order争夺。直接P/Invoke SetWindowPos(HWND_TOPMOST)
        // 是无歧义的最终手段，双保险。
        if (_hwnd != IntPtr.Zero)
        {
            NativeMethods.ForceTopmost(_hwnd);
        }
    }

    // PrepPRD Golden Path Step9："客户前台全屏(视频/PPT/游戏)：浮条自动隐藏；stuck例外——
    // 不弹窗不闪烁，只让托盘图标变红"——只在收起态(浮条)生效，展开态/RPA贴边态不受影响
    // (客户主动展开看板 或 RPA正在跑 都不该被这条规则隐藏掉)。
    private void UpdateFullscreenSuppression()
    {
        var mode = PanelWindowState.Resolve(_userWantsExpanded, _rpaActive);
        if (mode != PanelWindowMode.Collapsed)
        {
            Visibility = Visibility.Visible;
            return;
        }

        var screen = SystemParameters.WorkArea;
        var screenRect = new NativeMethods.RECT
        {
            Left = (int)screen.Left,
            Top = (int)screen.Top,
            Right = (int)screen.Right,
            Bottom = (int)screen.Bottom,
        };
        var suppress = NativeMethods.IsForegroundFullscreen(_hwnd, screenRect);
        Visibility = suppress ? Visibility.Hidden : Visibility.Visible;
        // 收起态浮条常驻期间，客户持续在用微信等其它应用，每次那些应用被激活都可能把
        // 本窗口挤到z-order底下(见ReassertTopmost注释)。这个2秒轮询本来就在跑，顺路
        // 每次都重新抢一次顶层位置，而不是只在ApplyWindowMode状态切换那一刻抢一次。
        if (!suppress)
        {
            ReassertTopmost();
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
        _fullscreenPollTimer.Stop();
        if (_trayIcon is not null)
        {
            _trayIcon.Visible = false; // 不显式隐藏，图标会在托盘里残留到下次鼠标划过才消失
            _trayIcon.Dispose();
        }
        _stuckTrayIcon?.Dispose();
        base.OnClosed(e);
    }
}
