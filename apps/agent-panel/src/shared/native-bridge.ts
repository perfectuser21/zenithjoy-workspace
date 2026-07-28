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
