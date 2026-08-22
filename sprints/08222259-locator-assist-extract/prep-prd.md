# 小改动 PrepPRD：刀A 读取类保底（extract 模式）

## 归属
AI on-call 铺满刀A。锚 line02/keyword_acquisition keep-green。救 26/35 缺抖音号死线索。

## 改什么
- **API**：locator-assist 加 `mode`（locate 默认 / extract）。extract=树→AI 抽取文本
  （buildExtractPrompt 要求 `{"extracted": "值"}`），返回 extractedValue；**不查缓存**
  （读取值每条不同）；截断守卫/fail-open 同 locate。病历表加 mode 列，answer_selector 存 {extracted}。
- **Android**：LocatorAssistClient 加 mode 参数 + parseExtractResponse；DouyinCollectService
  `awaitDouyinIdOnProfile` 轮询穷尽返 null 前，调 extract 求助一次（step=collect_read_douyin_id，
  target="这个人的抖音号"），格式验证闸 `^[a-zA-Z0-9._-]{2,}$` 过则用+verified 回执，不过判 null。
  bump 2.1.38。

## 验收
- [ ] commit-1 RED：service extract 4例/android 3例/接线守卫1例
- [ ] commit-2 转绿+tsc+回归；[ ] smoke 真调 extract 段；[ ] CI 全绿
