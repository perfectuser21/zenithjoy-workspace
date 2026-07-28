using System.Windows;

namespace ZenithJoy.AgentPanel;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

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
}
