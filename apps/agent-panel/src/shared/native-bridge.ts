// WebView2 JS↔原生宿主桥接 —— 只在真被 WebView2 宿主加载时 window.chrome.webview 才存在，
// 浏览器/测试环境下安全 no-op（不抛异常，不影响单测）。
declare global {
  interface Window {
    chrome?: { webview?: { postMessage: (msg: unknown) => void } };
  }
}

export function notifyHostExpandToggle(expanded: boolean): void {
  window.chrome?.webview?.postMessage({ type: 'user-toggle-expand', expanded });
}
