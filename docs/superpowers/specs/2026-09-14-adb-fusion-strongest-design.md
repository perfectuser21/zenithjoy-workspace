# 小改动 PrepPRD:ADB 控制器融合升级(Kotlin 教义六刀)+ 采收链完善 + 回流 git

## 改什么
1. `douyin-phone-adb` 控制器(M4/M1 机器上的 zsh,~2300 行)落六刀融合补丁(已在手术台写好并 zsh -n 通过):
   - 刀1: 删除烂死死函数 ui_evidence_retry(零调用者,pause-dump-resume 兜底段被某次补丁的变量提前展开毁成死代码)
   - 刀2: 剪贴板 COPY_STALE 守卫(抄 Kotlin clearClipboardBaseline 教义)——current-video-link 与 commenter-card-link 取链前比对上次成功链接,相同即拒收,杜绝把上一个人的链接写给下一个人
   - 刀3: 触达命令 private-message-send 适配 Lynx——用户结果列表树读不到,改首卡固定比例位轻点+主页抖音号强校验(回填脚本双机实证同款)
   - 刀4: foreground_gate 前台闸(抄 Kotlin NodeAwait.decideGateAction/pickDismissLabel)——插屏白名单[跳过/关闭/稍后/取消/我知道了/以后再说/暂不],「允许」绝不进白名单;open-app/open-video 后必过
   - 刀5: die 三态归因(抄 Kotlin WaitFailure)——failure_class=NO_ROOT/WRONG_FOREGROUND/TARGET_ABSENT,20 个关键 die 点位已标注
   - 刀6: lock-refresh 活锁心跳命令,长采收不再被 TTL 判 stale 抢占
   - 刀7: 先探后睡(抄 Kotlin pollUntilPresent)——open-app/open-video 的盲等改 500ms 步进探测
2. `harvest-keyword.sh`: 接 lock-refresh 心跳(每视频)+ 原爆款作品地址(current-video-link,LEAD 第12列)+ 图文帖过滤(excluded_non_video)
3. `push-leads.js`(网关): 解构吃第11列主页直链/第12列作品地址,写进"抖音昵称/主页链接"与"来源视频"字段
4. **回流 git(修复 F1 违规)**: 上述三件套+refill-profile-links.sh+update-profile-links.js 收进 repo `services/phone-adb-controller/`,配 smoke 守卫

## 为什么改
主理人拍板(0914):"把完善的新版本 ADB 融合原来 RPA 的 Kotlin,做最强版 ADB;Kotlin 将来再补"。控制器 11 万字节长期不在 git(改坏无法回滚,0914 已实证:一段兜底被补丁毁成死代码都无人知晓)。

## 关联上下文
- Journey: line02 客户智能获客 / capability=keyword_acquisition(keep-green)
- Brain task: 587bac1e-8277-4336-a726-6324e29f0571
- 相关历史决策: decisions/match 无冲突;触达机械修复但发送需主理人另批话术/频控(outreach_policy.enabled=false 不变)

## 影响范围
- 机器侧: M4(两 profile)+M1 控制器与采收脚本替换;输出格式向后兼容(新增列在尾部,旧调用方不受影响)
- 表侧: push-leads.js 新列可选,无新列的旧 TSV 照常工作
- 风险: 刀3 改了触达命令的选人方式——但强校验(抖音号不匹配即拒发)保留,安全性零下降;且触达当前无人调用

## 验收标准
- [ ] repo 内 smoke: zsh -n 语法闸 + 关键函数存在性断言(clip_guard/foreground_gate/lock-refresh)+ 烂死模式守卫(grep 检测 '"" -s ""' 类变量展开尸块)
- [ ] 真机 smoke(M4): lock-acquire→lock-refresh→open-app(过闸)→open-video→current-video-link(COPY_STALE 守卫路径)→lock-release 全通
- [ ] CI 全绿

## 设计补充(brainstorming 定稿)

### 落库结构(repo 内新家)
```
services/phone-adb-controller/
├── douyin-phone-adb          # 融合版控制器(zsh, ~2300行, 六刀已落)
├── harvest-keyword.sh        # 采收driver(心跳+作品地址+图文过滤已接)
├── refill-profile-links.sh   # 主页直链回填器
├── push-leads.js             # 飞书写表器(吃11/12列)
├── update-profile-links.js   # 直链回写器
├── README.md                 # 命令表+部署说明(scp到M4/M1的~/.local/bin与~/bin-harvest)
└── smoke.sh                  # 守卫(见下)
```

### 测试策略(四档定档: integration-lite)
纯 zsh/js 运维工件,无单元测试框架接入价值;守卫三层:
1. `zsh -n`/`node --check` 语法闸(每文件)
2. 函数存在性断言: clip_guard_check/clip_guard_record/foreground_gate/FG_DISMISS_LABELS/lock-refresh/failure_class 必须在控制器内
3. **烂死模式守卫**(proven-to-fire): grep 检测 `"" -s ""` 变量展开尸块与 `ui_evidence_retry` 复活——正是 0914 发现的静默腐烂形态,防复发
smoke.sh 进 CI(.github/workflows 挂接或 lint 阶段跑),真机 smoke 在部署后另行执行(M4)。

### 部署流(合并后)
1. scp 控制器→M4/M1 的 ~/.local/bin/douyin-phone-adb(chmod +x)
2. scp harvest/refill→~/bin-harvest/
3. docker cp push-leads.js/update-profile-links.js→网关 /root/.openclaw/
4. 真机 smoke: lock-acquire→lock-refresh→open-app(过闸)→open-video→current-video-link→lock-release
