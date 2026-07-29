using System.Windows;
// UseWindowsForms=true 会给整个项目注入 global using System.Windows.Forms，
// MessageBox/MessageBoxButton/MessageBoxImage 在两个命名空间都存在同名类型，
// 用别名钉死指向 WPF 版本，避免 CS0104。
using MessageBox = System.Windows.MessageBox;
using MessageBoxButton = System.Windows.MessageBoxButton;
using MessageBoxImage = System.Windows.MessageBoxImage;

namespace ZenithJoy.AgentPanel;

// UseWindowsForms=true(为借NotifyIcon)后 Application 在 System.Windows 与
// System.Windows.Forms 间产生歧义，必须显式限定为 WPF 的 Application。
public partial class App : System.Windows.Application
{
    private SingleInstanceGuard? _instanceGuard;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // 单实例守卫：核心进程(agent-panel-launcher.ts)一旦重复拉起，第二个实例在这里
        // 直接退出，不建窗口，不抢已运行实例的 WebView2 焦点。
        _instanceGuard = new SingleInstanceGuard("ZenithJoyAgentPanel");
        if (!_instanceGuard.TryAcquire())
        {
            Shutdown(0);
            return;
        }

        // 判定点：WebView2 Runtime 缺失时的提示不用 WebView2 渲染（自举悖论），
        // 用 Win32 原生 MessageBox——这一步必须在任何 WPF 窗口/WebView2 控件创建之前完成。
        if (!WebView2Preflight.CheckReal())
        {
            MessageBox.Show(
                "作战窗需要 WebView2 Runtime 才能显示。请安装后重新打开客户端。",
                "作战窗 · 组件缺失",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "https://developer.microsoft.com/microsoft-edge/webview2/",
                UseShellExecute = true,
            };
            try { System.Diagnostics.Process.Start(psi); } catch { /* 打不开浏览器也不阻塞退出 */ }
            Shutdown(1);
            return;
        }

        var window = new MainWindow();
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _instanceGuard?.Dispose();
        base.OnExit(e);
    }
}
