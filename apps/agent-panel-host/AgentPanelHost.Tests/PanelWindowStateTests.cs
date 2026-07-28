using ZenithJoy.AgentPanel;
using Xunit;

namespace ZenithJoy.AgentPanel.Tests;

/// <summary>
/// ⚠️ 从未在本环境执行（无 dotnet SDK）——按 TDD 写在实现之前，但未能亲眼看它先红后绿。
/// windows_cloud CI 首次跑通这些用例才是这段逻辑第一次被真正验证。
/// </summary>
public class PanelWindowStateTests
{
    [Fact]
    public void 默认场景_用户未展开_RPA未进行中_收起态()
    {
        Assert.Equal(PanelWindowMode.Collapsed, PanelWindowState.Resolve(userWantsExpanded: false, rpaActive: false));
    }

    [Fact]
    public void 用户展开_RPA未进行中_全屏展开态()
    {
        Assert.Equal(PanelWindowMode.Expanded, PanelWindowState.Resolve(userWantsExpanded: true, rpaActive: false));
    }

    [Fact]
    public void RPA进行中_即使用户想展开_也不给全屏_渲染贴边只读()
    {
        Assert.Equal(PanelWindowMode.RpaMini, PanelWindowState.Resolve(userWantsExpanded: true, rpaActive: true));
    }

    [Fact]
    public void RPA进行中_用户未展开_同样是贴边只读_不是收起态()
    {
        // fail-closed 判定点的窗口力学后果：只要 rpaActive=true，无论用户之前处于什么态，
        // 一律优先渲染 RpaMini，不会漏判成普通 Collapsed。
        Assert.Equal(PanelWindowMode.RpaMini, PanelWindowState.Resolve(userWantsExpanded: false, rpaActive: true));
    }
}
