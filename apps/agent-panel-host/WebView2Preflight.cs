using Microsoft.Win32;

namespace ZenithJoy.AgentPanel;

/// <summary>
/// WebView2 Runtime 检测 —— 与 services/agent/wechat-rpa/overlay/preflight.py 的
/// _check_webview2() 同款注册表探测法（HKLM+HKCU EdgeUpdate Clients pv 任一非空）。
///
/// 判定点（decisions表，同 line04 overlay 三天死区教训）：Runtime 缺失时的提示
/// 绝不能用 WebView2 本身渲染（自举悖论——渲染依赖本身缺失时提示也显示不出来），
/// 必须用 Win32 原生 MessageBox，零渲染依赖。
/// </summary>
public static class WebView2Preflight
{
    private const string EdgeUpdateClientKey =
        @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    /// <summary>纯逻辑：给定一组"注册表路径→pv 值"的探测结果，判断 Runtime 是否可用。
    /// 抽成纯函数是为了能在非 Windows CI 上做逻辑面单测（真实注册表读取只能在 windows_cloud 跑）。</summary>
    public static bool IsAvailable(IReadOnlyList<string?> probedValues)
    {
        foreach (var pv in probedValues)
        {
            if (!string.IsNullOrEmpty(pv) && pv != "0.0.0.0")
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>真实注册表探测（HKLM WOW6432Node + HKCU），只在 Windows 上有意义。</summary>
    public static bool CheckReal()
    {
        var values = new List<string?>
        {
            ReadPv(Registry.LocalMachine, EdgeUpdateClientKey),
            ReadPv(Registry.CurrentUser, EdgeUpdateClientKey.Replace(@"WOW6432Node\", "")),
        };
        return IsAvailable(values);
    }

    private static string? ReadPv(RegistryKey root, string subKey)
    {
        try
        {
            using var key = root.OpenSubKey(subKey);
            return key?.GetValue("pv") as string;
        }
        catch
        {
            return null; // 读不到=不可用，不抛异常（preflight 绝不能自己崩掉）
        }
    }
}
