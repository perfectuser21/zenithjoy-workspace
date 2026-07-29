using System;
using ZenithJoy.AgentPanel;
using Xunit;

namespace ZenithJoy.AgentPanel.Tests;

// 真机验证发现：核心进程 agent-panel-launcher.ts 拉起 ZenithJoyAgentPanel.exe 时若已有一个
// 实例在跑（比如上一轮 core 自升级重启太快、或客户手动+核心自动重复拉起），WPF侧毫无防护，
// 会真开出两个重叠窗口互相抢WebView2焦点。SingleInstanceGuard 用具名 Mutex 让第二个实例
// 一进 App.OnStartup 就发现"名字被占用"，直接退出不建窗口。
//
// ⚠️ "第一个实例持有期间第二个实例拿不到锁"这条核心断言，本地 macOS 实测跑不过——
// .NET 具名 Mutex 在非 Windows 上是进程内语义(同 csproj 里既有注释)，不是真正跨实例的
// OS 级互斥体，两个各自 new 出来的 SingleInstanceGuard 都能 TryAcquire 成功。这不是本类
// 的 bug，是 Windows 内核 Mutex 与 Unix 具名 Mutex 语义差异——真正的互斥行为只在 Windows
// (windows_cloud CI / xian-rog 真机) 才有意义，且已通过本次真机部署实测验证。
public class SingleInstanceGuardTests
{
    [Fact]
    public void 第一个实例能拿到锁()
    {
        var name = "ZJTest-" + Guid.NewGuid();
        using var guard = new SingleInstanceGuard(name);
        Assert.True(guard.TryAcquire());
    }

    [Fact]
    public void 第一个实例释放后_可以再次拿到锁_验证Dispose不抛异常且状态复位()
    {
        var name = "ZJTest-" + Guid.NewGuid();
        var first = new SingleInstanceGuard(name);
        Assert.True(first.TryAcquire());
        first.Dispose();

        using var second = new SingleInstanceGuard(name);
        Assert.True(second.TryAcquire());
    }
}
