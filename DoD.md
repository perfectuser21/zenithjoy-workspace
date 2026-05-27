contract_branch: cp-05272259-ws-46bc46d9-ws1
workstream_index: 1
sprint_dir: sprints/zj-kuaishou-three-mode

# Contract DoD — Workstream 1: publish-kuaishou-video-dryrun.cjs 新建（三模式）

**范围**: 新建 `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`，复用 image-dryrun 三模式框架（KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR + CDP 兜底），导航目标改为 `https://cp.kuaishou.com/article/publish/video`，输出 JSON 只含 4 字段（ok/dryRun/url/title，无 imagesCount），拦截快手视频发布 API（/rest/cp/works/ 等）

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 脚本输出 JSON `ok` 字段值 true
- [ ] [BEHAVIOR] 脚本输出 JSON `dryRun` 字段值 true
- [ ] [BEHAVIOR] 脚本输出 JSON 不含 `imagesCount` 字段（video schema 只有 4 字段）
- [ ] [BEHAVIOR] 禁用字段 result/status/data/payload 不出现在输出 JSON keys
- [ ] [BEHAVIOR] error path — 脚本含登录失败检测（导航后 URL 含 login/passport 时 exit 1）
- [ ] [BEHAVIOR] 输出 JSON 含 url 字段 + title 字段
- [ ] [BEHAVIOR] 脚本含 page.route 拦截快手视频发布 API（/rest/cp/works/）
