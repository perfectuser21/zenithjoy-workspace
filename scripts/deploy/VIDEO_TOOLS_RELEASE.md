# 视频工具与员工私人画布发布

普通员工使用 Wan、超分、Aidge 和画布，不需要超管。超管名单不负责开通模型服务或分配画布。
画布必须每人独立容器、私有网络、数据卷和服务 token；API 按真实登录 user.id 选实例，不能多人共用实例。

## 准备私有名册

只由已获授权的发布者从 1Password 取模型凭据、创建并保存每人的独立服务 token。
不要从 staging 的 `.env` 复制到生产，不要重置用户密码或伪造会话。

| 文件 | 用途 |
|---|---|
| `/opt/zenithjoy/staging-api/video-tools-roster.json` | 真实测试员工身份；仅 staging 开通 |
| `/opt/zenithjoy/prod-api/video-tools-roster.json` | 明确获准的真实生产员工身份；必须已在生产员工名单 |

文件必须为 root 所有、600、非链接、规范绝对路径。结构：

```json
{
  "schema_version": 1,
  "environment": "staging",
  "source_commit": "本次候选完整40位SHA",
  "origin": "https://staging-autopilot.zenjoymedia.media",
  "providers": {
    "DASHSCOPE_API_KEY": "从1Password取",
    "ALIYUN_ACCESS_KEY_ID": "从1Password取",
    "ALIYUN_ACCESS_KEY_SECRET": "从1Password取"
  },
  "users": [{"id": "目标环境真实user.id", "email": "员工邮箱小写", "token": "独立服务token至少32字符"}]
}
```

生产用 `environment=production` 和 `origin=https://zenithjoy.tech`。如确实需要专用工作空间或出站代理，
可在 providers 显式填写 `DASHSCOPE_BASE_URL`、`DASHSCOPE_WORKSPACE_ID`、`ALI_VIDEO_HTTPS_PROXY`。
生产不会更改 STAFF_EMAILS 或超管名单；staging 只将名册中的真实测试账号加入当前员工名单，
同时保留现有 staging 测试账号的实例、token 和网络。所有生成配置均为 600，不打印内容。

## 固定候选与验收

1. 正常 PR、CI、合并。通过 `deploy-staging-hk.yml` 手动启用 `video_tools=true` 部署同 SHA。
   它先执行原单人画布 staging 发布，核实其镜像 receipt 和 revision，再为名册测试员工准备独立实例。
   API 同版本部署通过固定 overlay 激活配置；不直接改现役 `.env`。
2. 通过真实邮箱登录验收测试员工：Wan/超分生成真实结果、Aidge 访问与业务、画布加载和工作流执行；
   独立读回结果，核对实例隔离、无权限账号和故障提示。配置就绪不等于模型调用成功。
3. 将实际证据写入现有 Brain 冻结发布验收规程。未完成的验收不得填通过。
4. 正常 `promote-prod-hk.yml` 输入同 SHA、真实 `acceptance_run_key`、`confirm=PROMOTE`、`video_tools=true`。
   现有 release-admission 先核同 SHA staging 和 Brain 验收；通过后才准备生产实例。
   生产只复用同 SHA staging 验过的不可变 ComfyUI image ID，绝不生产重建或用 latest。
5. HK API 正式发布器将每版本私有 overlay 纳入保留的 image 配置，启用后再次读取 API 实际环境、
   每人实例 image/健康/卷/token/网络成员。任一不符则正常恢复原 API。
   最后仍须真实用户登录并实际操作，三人未实测就逐人列未证明项。

## 失败、回退与保留

`prepare` 失败不会切换 API；已生成的实例、卷和私有工件保留现场，不伪报通过。
正式 API 回退复用旧 release 的镜像与已绑定 overlay，不重建、不覆盖旧 token。
后续普通 API 发布即使 `video_tools=false`，也从已验证前驱冻结复制私有配置，并在新 API release 中
记录继承来源；API SHA 与 ComfyUI 原始 SHA 分开读回，不把原画布镜像冒充新构建。
旧版没有视频配置时，回退即恢复原没有视频配置的状态；新准备的容器不等于对用户已开通。

同 SHA 的名册或秘密不可覆盖；已保留的生产版本不能事后偷偷补配置，需新候选重新验收。
生产准备器只支持首次开通。已有生产画布时，不允许借本入口升级 ComfyUI 版本，也不允许先手动停旧
再发布；旧实例暂停/恢复、队列交接与 API 整体恢复事务尚不在本次入口中。普通 API 更新使用上述继承。
staging 的同身份测试实例替换只允许独立核验旧实例所有权、token、数据卷并确认其已经停止的维护交接，
不自动杀旧实例，不用一次空队列读数声称安全停止。其它员工原映射和数据保持。
另一运行中的画布若还持有同一员工数据卷，准备器拒绝，不能挂同一个活动卷或丢弃任务。
生产容器没有 host 端口，只通过员工专用桥与 API 通信；出现意外网络成员或未知容器所有权即拒绝。

## 真实浏览器验收

`apps/dashboard/e2e/video-tools-live.spec.ts` 不模拟会话、API 或模型结果。只有发布者明确授权真实验收后才运行：

```bash
cd apps/dashboard
ZJ_VIDEO_LIVE=true \
ZJ_VIDEO_CREDENTIALS_FILE="$HOME/.credentials/zenithjoy-staging-verification.json" \
npx playwright test e2e/video-tools-live.spec.ts --project=chromium
```

凭据文件必须从 1Password 专用测试账号刷新，归本人所有、600，字段为 `username` 与 `password`。
测试固定只向正式 staging 域名登录；不会尝试员工密码，不自动重试任务提交。
其中两项会产生模型费用：一次两秒480P无声 Wan，以及一段测试当场合成的两秒480×480视频超分。
它核实真实工作流节点、刷新后的同一任务ID、下载视频的尺寸/时长/声音和 SHA256，证据在 Playwright 输出目录。
未设置 `ZJ_VIDEO_LIVE=true` 时明确跳过；`--list`、跳过或只跑配置检查都不能记为业务通过。
