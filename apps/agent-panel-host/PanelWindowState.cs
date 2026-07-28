namespace ZenithJoy.AgentPanel;

public enum PanelWindowMode
{
    /// <summary>收起态：屏幕边缘细灯带</summary>
    Collapsed,
    /// <summary>展开态(默认场景)：真全屏</summary>
    Expanded,
    /// <summary>展开态+RPA进行中：不给全屏，退让对角贴边只读穿透</summary>
    RpaMini,
}

/// <summary>
/// 纯状态转换逻辑（不碰任何 WPF/Win32 API，可独立单测）。
/// PrepPRD 判定点：
///   - desktop-lease-broker 失联 → fail-closed，rpaActive 视为 true（由调用方传入，
///     本类不重新实现 fail-closed 判定，那层在 web 内容的 useRpaGuard 已经做了，
///     宿主只负责"rpaActive=true 时不给全屏"这条窗口力学规则）。
///   - 展开态期间 RPA 突然开始 → 立即抢占式收起为贴边态，不等用户手动收起
///     （即：rpaActive 优先级高于 userWantsExpanded，任何时候都覆盖）。
/// </summary>
public static class PanelWindowState
{
    public static PanelWindowMode Resolve(bool userWantsExpanded, bool rpaActive)
    {
        if (rpaActive)
        {
            return PanelWindowMode.RpaMini; // 最高优先级，无论用户当前展开与否
        }
        return userWantsExpanded ? PanelWindowMode.Expanded : PanelWindowMode.Collapsed;
    }
}
