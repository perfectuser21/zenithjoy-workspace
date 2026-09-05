# 素材上传统一为 COS 直传（预签名 URL）

> Brain 决策：`10a0b732`（架构）。本文是它的技术展开。
>
> **修订记录**：初稿设计为「服务端签发 STS 临时密钥、客户端自己算签名上传」。
> 该方案被否决——**iOS 快捷指令没有计算 HMAC 签名的动作**，用不了临时密钥，
> 三个入口会立刻分裂成两套。改为**服务端签好 URL、客户端裸 PUT**，见下。

## 为什么做

素材现在的路径是 `客户端 → 香港中台 → 广州 COS`。三个问题：

1. **合规**：香港在《个人信息保护法》下属境外。素材从境内出境到香港、再回到境内广州，构成一次数据出境。虽然量级在免手续档（<10 万人），但"单独告知并取得单独同意"和"个人信息保护影响评估"是**无论数量多少都必须履行**的义务。
2. **慢**：国内客户传国内的桶，却绕了一趟香港。
3. **贵**：几百兆视频全压在香港服务器带宽上。

直传后素材一步不出境，上述义务整个不适用；速度和带宽问题一并消失。

## 已实测的地基（不是推理）

| 断言 | 实测结果 |
|---|---|
| 预签名 URL 可被**零签名能力**的客户端直接 PUT | ✅ HTTP 200 |
| 上传后下载回来逐字节比对 | ✅ 内容完全一致 |
| 篡改签名一个字符 | ✅ **HTTP 403** |
| 不带签名裸传 | ✅ **HTTP 403**（桶确为私有） |
| 单文件上传的 ETag | 等于内容 MD5 |
| **分片上传的 ETag** | ❌ **不是内容哈希，且同内容两次上传结果不同**（`35bfaef0…-2` vs `366f7f65…-2`） |
| 孤儿分片会真实产生 | ✅ 测试期间产生了 1 个未完成分片任务 |

后两条决定了去重方案与回收方案；前四条决定了传输方案。

## 架构

### 一条路径，三个入口共用

```
① 客户端 → POST /api/materials/upload-urls
     报 文件名 / 大小 / MIME / 拍摄时间
     服务端：凭据反查租户 → 预分配 material_id 与 storage_key
            → 为每个文件签一个【只对这一个对象路径有效】的 PUT URL（2 小时）
            → 返回 URL 列表 + batch_id

② 客户端 → 直接 PUT 到该 URL                    ← 全程境内，零签名代码

③ 客户端 → POST /api/materials/complete
     服务端：HEAD 每个对象，校验存在且 Content-Length 与申报大小一致
            → 一致才落库；不一致 400，绝不写「DB 有记录、COS 没文件」的假数据
```

### 为什么是预签名 URL，不是临时密钥

统一性是硬约束：三个入口必须跑同一个协议。

| | 临时密钥（STS） | 预签名 URL |
|---|---|---|
| 客户端要算 HMAC 签名 | **要** | 不要 |
| iOS 快捷指令能否实现 | **不能**（无 HMAC 动作） | 能（原生「获取 URL 内容」即可） |
| 客户端手里拿到的东西 | 一把能写整个租户目录的钥匙 | 一个只能写**单个对象**的地址 |
| 跨租户越权 | 靠 STS 策略拦截 | **物理上不可能**——客户端从不持有密钥 |
| 新增依赖 | 需要 `qcloud-cos-sts` | **无** |

预签名 URL 在能力上更弱、因而更安全：作用域是单个 key，不是前缀。

三个入口分别需要的能力，均为其原生能力，无一需要额外 SDK：

| 入口 | 用什么发请求 |
|---|---|
| iOS 快捷指令 | 「获取 URL 内容」动作 ×3 |
| 微信小程序 | `wx.request` + `wx.uploadFile` |
| Windows agent | 普通 HTTP 客户端 |

### 统一走单请求 PUT，不做分片

快捷指令无法把文件切片，小程序的上传也是单请求。若为 Windows agent 单独加分片，协议就分裂了。故**统一单请求 PUT**，上限沿用现有 `MAX_FILE_BYTES`（2GB，远低于 COS 单 PUT 的 5GB 上限）。

代价：超大文件传输中断需从头重传。接受——直连 COS 比绕香港快得多，中断概率本就下降；且分片可在将来作为同一协议的扩展（服务端多签几个 URL）追加，现在不做（YAGNI）。

> 这也顺带绕开了分片 ETag 不确定的问题。

### 为什么第 ③ 步必须 HEAD 校验

不校验就等于让客户端自己宣布"我传好了"。客户端断网、传了 0 字节、或干脆没传却调了 complete，都会在库里留下一条指向空气的素材记录。这类静默失败最难查（见 memory `failure-without-reason-pattern`）。

### 去重：租户 + 文件名 + 大小 + 拍摄时间

**明确不做内容哈希。** 三条路都堵死了：

- **客户端算哈希** → iOS 快捷指令没有哈希动作。让小程序和 agent 算、快捷指令不算，"一套方案"当场破产。
- **服务端靠 COS ETag** → 实测否决：分片 ETag 既非内容哈希，同一内容两次上传还得到不同值。
- **服务端下载回来算** → 几百兆下行流量要付费，且慢。

元数据去重覆盖真实场景：定时任务每小时重扫同一批照片，文件名、大小、拍摄时间三样完全一致，重复上传无害。

**代价（明确接受）**：用户手动改文件名后重传会存两份。这不是数据错误，只是多占空间；存储 0.118 元/GB/月，不值得为它牺牲入口统一性。

### 老端点 `/upload` 必须一起改

现在 `/upload` 用 `hashFile()` 算 SHA-256 进去重键。**若只改新路径不改它，同一张照片走两个入口会得到两个不同的去重键，存两份**——这恰是本次要消灭的不一致。

故 `/upload` 同步改为元数据去重，与直传共用同一个落库函数。

> `materials.content_hash` 列保留但一律为 NULL（列可空，无需迁移）。保留而非删除，是因为将来若真需要内容去重可由离线任务回填。代码里注明原因，避免被后人当成遗漏。
>
> 副作用：已有 3 条测试素材的 dedupe_key 是哈希口径，改口径后可能被重传一次。staging 测试数据，可接受。

### 孤儿对象：COS 生命周期规则，不写代码

客户端拿了 URL 却没传、或传了不调 complete，会在桶里留下无人引用的对象。配一条生命周期规则自动清理，腾讯云自己回收，零维护代码。

同时保留一条「未完成分片 7 天后自动中止」——即便本期不主动分片，SDK 或将来扩展仍可能产生碎片，实测已证明它会真实出现。

### 同批捎带：改掉全球加速域名

agent 5 处硬编码 `cos.accelerate.myqcloud.com`：

```
services/agent/src/core-upgrader.ts
services/agent/src/module-manager.ts
services/agent/src/handlers/ensure-chrome.ts   （2 处）
services/agent/src/handlers/ensure-ffmpeg.ts
```

国内客户下载国内桶，却走跨境加速通道，又慢又贵——2026-07 账单「全球加速下行流量_境内到境内」33.28 元。改为 `cos.ap-guangzhou.myqcloud.com` 直连。

## 身份模型：客户凭据怎么来（拍板 = A 走注册）

上传身份的唯一来源是 `X-Upload-Token`（即 `license_key`）→ `licenses` 表 → `tenant_id`。
**租户永远从凭据反查，绝不信客户端自报**——否则填别人的 ID 就能写进别人的库。

同一租户下无论从哪个入口进来（快捷指令 / 小程序 / Windows agent），素材都落进同一个池子，
因为租户由凭据决定、与入口无关。这也是去重键必须含租户的原因。

**客户获取凭据的正确路径 = 注册流程**，三块现成即通，本期不改任何签发代码：

| 步骤 | 承载 | 状态 |
|---|---|---|
| 注册 → 建 tenant → 回填 `license.tenant_id` | `auth-bridge.ts` | 已通 |
| 登录后查看自己的 key | `routes/account.ts` + `LicensePage.tsx` | 已有 |
| 复制进快捷指令上传 | 本次实现 | 本期 |

### 已知缺口（本期不修，明确记录）

`license.service.ts` 的管理员签发路径**不建 tenant、不写 `tenant_id`**。用它签出来的 key
拿去传素材会得到 403 `NO_TENANT`。当前 280 张 license 中 279 张处于此状态（种子与管理员
签发数据）。

拍板结论：**不通过管理员直接发 key 给客户**——租户本应与账号绑定（还要挂人员、权限、账单），
凭空发一张 key 等于凭空造一个没有主人的租户。若将来产品上确需管理员直发，那是让
`license.service.ts` 签发时一并建租户的另一个改动，不在本期。

### 记录上传者

`materials` 表当前只记 `tenant_id`，不记是谁传的。同一客户下多名员工各自配了快捷指令时，
后端分不清素材来自谁。本期加一列 `uploaded_by_license_id`（迁移 + 落库时写入）——现在加
远比以后回填便宜。

## 组件划分

| 单元 | 职责 | 依赖 |
|---|---|---|
| `material-upload.ts`（改） | 纯函数：类型推断、去重键、存储 key。移除 `contentHash` 分支 | 无 |
| `material-storage.ts`（改） | 抽象新增 `presignPut(key, ttl)` 与 `headObject(key)`；内存实现同步跟上 | 无 |
| `material-storage-cos.ts`（改） | 上述两方法的 COS 实现 | `cos-nodejs-sdk-v5`（已有，**不新增依赖**） |
| `material-persist.ts`（新） | 落库：写 materials + contents + content_materials，含 `uploaded_by_license_id`。**直传与老端点共用** | pg |
| `db/migrations/*_materials_uploader.sql`（新） | `materials` 加 `uploaded_by_license_id` 列 | — |
| `routes/materials.ts`（改） | 三端点：`/upload-urls`、`/complete`、`/upload`（改为调用共用落库） | 以上 |

抽出 `material-persist.ts` 是本次的关键结构变化：落库逻辑现在有两个调用方，留在路由里必然被复制，复制就会漂移。

> 签发实现取向：优先用 SDK 的 `getObjectUrl({ Method: 'PUT', Sign: true, Expires })`。COS 的 URL 签名算法（HMAC-SHA1 + `q-sign-*` 参数）已在本次设计中实测跑通，若 SDK 行为不符预期可直接落地该算法，不构成风险。

## 错误路径

| 情形 | 行为 |
|---|---|
| 无凭据 / 凭据无效 | 401 |
| 凭据认得出但不可用（吊销/停用/过期/无租户） | 403，与 `worker-agent-auth` 同口径 |
| COS 未配置 | 400 明确报错，**不静默回落假装成功** |
| 申报大小超过 `MAX_FILE_BYTES` | 400，在签 URL 阶段就拒，不等传完 |
| 视频与图片混传 | 400，同样在签 URL 阶段拒 |
| complete 时对象不存在 | 400 `OBJECT_NOT_FOUND` |
| complete 时大小对不上 | 400 `SIZE_MISMATCH` |
| 重复 complete 同一批 | 幂等：命中去重返回已有 id，不建第二个作品 |

## 测试策略

**逻辑接缝 → CI 单测**（TDD 两段式：commit-1 红、commit-2 绿）

- `material-upload.test.ts`：去重键**不含内容哈希**；同一文件经两个入口得到**同一个键**；路径穿越逃不出租户目录
- `material-storage.test.ts`：内存实现的 `presignPut`/`headObject` 行为；COS 未配置时明确失败而非静默回落
- `materials.test.ts`：三端点鉴权四档；自报 `tenant_id` 被忽略；超限与混传在签 URL 阶段即被拒；complete 大小不符被拒；重复 complete 幂等
- `agent-cos-endpoint.test.ts`：断言 agent 源码中**不存在** `cos.accelerate` 字样——会真报红的守卫，不是摆设

**环境接缝 → 真 API + 真 DB smoke**

`material-direct-upload-smoke.sh`：真调 `/upload-urls` → **用最朴素的 HTTP PUT（不带任何鉴权头，模拟快捷指令）**把文件传上去 → 真调 `/complete` → 查库断言记录存在且 `storage_key` 以租户 ID 开头 → **再篡改签名重传一次，断言 403**。

最后两步是本设计的命门：「零签名能力的客户端能传成功」和「签名不可篡改」必须在真链路上证明，不能只在单测里断言。无 DB 时明确 SKIP，不假绿。

## 不包含

- iPhone 快捷指令的具体配置（Shortcuts App 里手工配，另行交付）
- 微信小程序上传页
- 安卓端拉素材写相册
- 素材库浏览与混剪
- 分片上传（见上，YAGNI）
