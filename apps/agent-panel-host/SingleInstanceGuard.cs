using System;
using System.Threading;

namespace ZenithJoy.AgentPanel;

/// <summary>
/// 具名 Mutex 单实例守卫。核心进程(services/agent)的 agent-panel-launcher.ts 目前只按
/// "本进程生命周期内只拉起一次"防重复，跨进程重启(core自升级重启太快/客户手动+核心自动
/// 重复拉起)防不住——这层是最后一道防线：第二个实例 TryAcquire() 返回 false 就该直接退出，
/// 不建窗口，不抢已运行实例的 WebView2 焦点。
/// </summary>
public sealed class SingleInstanceGuard : IDisposable
{
    private readonly Mutex _mutex;
    private bool _owned;

    public SingleInstanceGuard(string name)
    {
        _mutex = new Mutex(initiallyOwned: false, name: $"Global\\{name}");
    }

    public bool TryAcquire()
    {
        try
        {
            _owned = _mutex.WaitOne(TimeSpan.Zero);
        }
        catch (AbandonedMutexException)
        {
            // 上一个持有者崩溃未释放——本实例仍视为成功拿到锁，属正常单实例场景。
            _owned = true;
        }
        return _owned;
    }

    public void Dispose()
    {
        if (_owned)
        {
            _mutex.ReleaseMutex();
            _owned = false;
        }
        _mutex.Dispose();
    }
}
