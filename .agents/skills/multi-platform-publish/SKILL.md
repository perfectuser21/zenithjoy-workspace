---
name: multi-platform-publish
description: 用 Codex 执行 ZenithJoy 九平台发布；按平台、图文、视频、长文或想法选择已有手机手册、浏览器脚本或公众号 API。用于发布任务、发布队列和迁移后的发布检查。
---

# 九平台发布

用已有发布资产完成指定账号的一次发布，保留证据并回写任务。源代码存在、路由检查通过和真实发布成功是三种不同状态。

## 选择准确的发布分支

先确定平台、成品类型、账号、素材和执行通道。沿用任务或当前会话已有的信息；只追问会改变实际发布动作的缺项。

用户已授权自行制作素材并真实发布时，直接制作符合平台要求的简单内容；从现有可用账号与设备中选择并核对账号身份，自动登记验收任务。不要再要求用户提供素材或测试任务 id。验收可使用平台的私密可见性，并在回执明确说明。

- 图文、多图、长图片成品用 `image`；已经渲染的视频文件用 `video`；平台原生长文编辑器用 `article`；知乎想法用 `idea`。
- “长图文”通常指图片成品，不自动当成长文；“图文短视频”未说明成品时先核对是图片还是视频，不代用户转换内容。
- 一份 skill 可包含多个发布分支；手机、浏览器、API 是执行通道，不能按通道重复统计同一内容分支。

先用本 skill 的只读脚本列清单或定位源文件：

```bash
python3 scripts/publish_catalog.py list
python3 scripts/publish_catalog.py plan --platform douyin --type article --channel browser
python3 scripts/publish_catalog.py plan --platform wechat --type article --channel api
```

命令路径相对本 skill 目录。脚本只输出计划，**不执行发布**。输出的 `entrypoint`、`instructions` 和 `warnings` 是需要读取的真实源文件与缺口；不支持的通道显式失败。详情见 [内容分支清单](references/publishing-matrix.md)。

默认从当前仓库定位脚本，从相邻 `zenithjoy-skills` 或已安装的 `~/.agents/skills` 定位手册。跨目录部署时可分别设置 `ZENITHJOY_WORKSPACE_ROOT` 和 `ZENITHJOY_SKILLS_ROOT`；覆盖仓库路径不会自动改变手册路径。CI 使用路由文件夹具验证索引，真实源路径与真实发布分别在执行环境验收。

## 执行

任务已有 Brain id 就沿用；否则自动登记任务并认领，再执行，不要求用户手动填表或先定整条流程。Brain 地址沿用环境 `BRAIN_URL`，未设时用 `http://100.79.41.61:5221`。完成后回写事实、证据、actor 和交接。

读取计划返回的文件，并核对源脚本真实 CLI、输入字段、运行宿主、依赖和账号状态。旧 skill 中的 `packages/workflows/skills`、Windows 路径或旧设备坐标可能过时，不能照抄执行；实际脚本接口与现场设备状态为准。

- **手机**：加载仓库 `android-publish/SKILL.md` 和本平台独立手册。经目标设备现成控制器执行；按现场 profile 获取锁、核对账号、加载素材、逐步截图与控件树核验，收尾释放锁并回读。不能把只有视频步骤的手册套在图片或长文上；计划无匹配手册时先报缺项，保留现有任务。

  素材上传后必须确认 MediaStore 已索引。`/sdcard` 与 `/storage/emulated/0` 是同一文件的别名时，媒体库 `_data` 可能只存真实路径；读回应查询解析后的路径，不能因别名查不到就认定上传失败。以控制器当前实现及回归测试为准。
- **浏览器**：读取 `services/agent/publishers/<平台>-publisher/` 对应脚本，按其 CLI 组装输入。不要通过旧 handler 调用没有接通的类型，也不要为缺 dryrun 的视频或文章借用图文 dryrun。需要模块时先检查执行机 `node_modules` 与 `playwright-core` / `ws`，不能凭有文件就声称可运行。
- **公众号 API**：图文长文可走 `apps/api/scripts/wechat-mp-freepublish.py`；当前代码走群发，草稿、freepublish 链接、推送粉丝三种结果分开说明。凭据从 1Password 获取，按既有规矩放 `~/.credentials`，不写任务、参数或输出。先读源码的真实限制，核对任务要求的发布模式；不把建草稿当成已发布。

用 Codex 可用的 shell 工具执行命令；Markdown/代码用文件读取，截图用图像查看工具。旧手册的 `Bash` / `Read` 是工具角色，不是要求启动 Claude Code。无需再调用 `claude -p`。

迁移或清单检查没有给定已授权内容和账号时，仅做读取与本地验证；不自行取队列真发。真实发布任务的现有授权持续有效，不重复确认。

## 判定与回执

对外发布动作一次执行，不因超时或看不到返回就重复提交。保留页面/接口原始证据；结果不确定时标待核实。

- 手机回账号作品列表核对新内容、时间、可见性，保留截图；发布按钮已点不是完成。
- 浏览器回管理页或作品链接核对实际作品；退出码 0、mock 和 dryrun 都不能证明发布成功。
- 公众号群发先拿 `msg_id`，再读回 `SEND_SUCCESS`；仅有 `media_id` 是草稿。源码若返回 `SENDING` 仍以 0 退出，也不能报成功。

结果输出简体中文，短表列出平台、类型、通道、任务 id、实际结果和证据位置。准确区分源文件已找到、Codex 静态适配完成、真机验证通过。
