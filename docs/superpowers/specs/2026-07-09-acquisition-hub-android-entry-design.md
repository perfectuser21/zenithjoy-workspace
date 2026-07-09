# 设计：智能获客 Hub 补"下载安卓客户端"入口

## 背景
`/area/acquisition`（侧栏"智能获客"）实际渲染的是 `AcquisitionHubPage.tsx`，只有 4 张卡片（绑抖音小号/采集/看线索/触达记录），没有链接到安卓装机绑定页 `/dashboard/android`（`AndroidDownloadPage.tsx`）。`AreaHubPage.tsx` 里 `AREA_HUBS.acquisition` 配置本有一张同名卡片，但该路由从未指向 `AreaHubPage`，是死代码。真机测试时确认：客户在"智能获客"页面找不到任何入口能装 Agent、绑定安卓手机。

## 改动
在 `apps/dashboard/src/pages/AcquisitionHubPage.tsx` 的 `MODULES` 数组末尾新增一张卡片：

```ts
{
  label: '下载安卓客户端',
  desc: '手机装 Agent，扫码自动绑定，手机端采集。',
  to: '/dashboard/android',
  Icon: Smartphone,
  color: 'text-lime-600',
  bgColor: 'bg-lime-50 dark:bg-lime-900/20',
  borderColor: 'border-lime-200 dark:border-lime-800',
}
```

`Smartphone` 从 `lucide-react` 导入（照抄 `AreaHubPage.tsx` 已有引用）。不改路由、不改后端。

## 测试
新增 `apps/dashboard/e2e/acquisition-android-entry.spec.ts`，参照仓库已有的 `acquisition-ia-redesign.spec.ts` 写法：

1. 访问 `/area/acquisition`，断言页面可见"下载安卓客户端"文字。
2. 点击该卡片，断言 URL 变为包含 `/dashboard/android`。

TDD 顺序：先写此 spec（此时因卡片不存在而失败），再加卡片使其通过。

## 范围
仅新增一张卡片 + 一个 e2e spec。不影响现有 4 张卡片、不改动 `AndroidDownloadPage.tsx`、不涉及后端。
