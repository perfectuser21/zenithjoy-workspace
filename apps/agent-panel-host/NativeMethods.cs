using System.Runtime.InteropServices;

namespace ZenithJoy.AgentPanel;

/// <summary>
/// Win32 P/Invoke —— 全局热键(Ctrl+Alt+Z) + 扩展窗口样式(WS_EX_NOACTIVATE 永不夺焦 /
/// WS_EX_TRANSPARENT 鼠标穿透，RPA贴边态用)。
///
/// ⚠️ 未本地验证：本环境无 Windows/无 .NET SDK，这些 P/Invoke 签名基于标准 Win32 文档，
/// 真实调用行为只能在 windows_cloud CI 首次验证。
/// </summary>
internal static class NativeMethods
{
    public const int WM_HOTKEY = 0x0312;
    public const uint MOD_CONTROL = 0x0002;
    public const uint MOD_ALT = 0x0001;
    public const int HOTKEY_ID_SUMMON = 0x5A50; // 'ZP' 随意选的常量，避开与其它注册冲突

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public const int WS_EX_TRANSPARENT = 0x00000020;
    public const int WS_EX_LAYERED = 0x00080000;

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    /// <summary>叠加(不覆盖)扩展样式位——RPA贴边态用：永不夺焦+鼠标穿透。</summary>
    public static void ApplyRpaGuardStyles(IntPtr hWnd)
    {
        var ex = GetWindowLong(hWnd, GWL_EXSTYLE);
        SetWindowLong(hWnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED);
    }

    /// <summary>清掉 RPA 贴边态的穿透/永不夺焦位，恢复正常可交互窗口（展开/收起态用）。</summary>
    public static void ClearRpaGuardStyles(IntPtr hWnd)
    {
        var ex = GetWindowLong(hWnd, GWL_EXSTYLE);
        SetWindowLong(hWnd, GWL_EXSTYLE, ex & ~(WS_EX_NOACTIVATE | WS_EX_TRANSPARENT));
    }
}
