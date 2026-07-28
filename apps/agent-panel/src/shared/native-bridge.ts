// WebView2 JS↔原生宿主桥接 —— 只在真被 WebView2 宿主加载时 window.chrome.webview 才存在，
// 浏览器/测试环境下安全 no-op（不抛异常，不影响单测）。
declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage: (msg: unknown) => void;
        addEventListener: (type: 'message', handler: (ev: { data: unknown }) => void) => void;
      };
    };
  }
}

export function notifyHostExpandToggle(expanded: boolean): void {
  window.chrome?.webview?.postMessage({ type: 'user-toggle-expand', expanded });
}

// xian-rog 真机验证实测：热键(Ctrl+Alt+Z)/托盘点击只改了原生窗口几何尺寸(MainWindow.xaml.cs
// ToggleExpanded)，网页内部 expanded 状态从未收到通知——按热键后窗口变全屏，但内容仍渲染成
// 收起态那个6px小灯，客户看到一个几乎全白的全屏窗口，不是预期的Warroom看板。
// 原生侧对应改动：ToggleExpanded() 需 PostWebMessageAsJson({type:"host-expand-changed",expanded})。
export function onHostExpandChanged(callback: (expanded: boolean) => void): void {
  window.chrome?.webview?.addEventListener?.('message', (ev) => {
    const data = ev.data as { type?: string; expanded?: boolean } | null;
    if (data?.type === 'host-expand-changed') {
      callback(Boolean(data.expanded));
    }
  });
}

// PrepPRD Golden Path Step9："客户前台全屏(视频/PPT/游戏)：浮条自动隐藏；stuck例外——
// 不弹窗不闪烁，只让托盘图标变红"。宿主要知道有没有 stuck 才能决定托盘图标颜色，
// 灯态聚合逻辑网页侧已经在算(渲染灯带颜色就是这个数据)，不在原生C#侧重复实现一遍。
export function notifyHostLightState(hasStuck: boolean): void {
  window.chrome?.webview?.postMessage({ type: 'light-state-changed', hasStuck });
}
