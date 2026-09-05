# 素材上传统一为 COS 直传

> Brain 决策：`10a0b732`（架构）。本文是它的技术展开，不重新论证方向。

## 为什么做

素材现在的路径是 `客户端 → 香港中台 → 广州 COS`。三个问题：

1. **合规**：香港在《个人信息保护法》下属境外。素材从境内出境到香港、再回到境内广州，构成一次数据出境。虽然量级在免手续档（<10万人），但"单独告知并取得单独同意"和"个人信息保护影响评估"是**无论数量多少都必须做**的义务。
2. **慢**：国内客户传国内的桶，却绕了一趟香港。
3. **贵**：几百兆视频全压在香港服务器带宽上。

直传后素材一步不出境，上述义务整个不适用；速度和带宽问题一并消失。

## 已实测的地基（不是推理）

| 断言 | 实测结果 |
|---|---|
| 当前 COS 密钥能签发临时密钥 | ✅ `sts:GetFederationToken` 通过，900 秒有效 |
| 临时密钥写**自己**租户目录 | ✅ HTTP 200 |
| 临时密钥写**别人**租户目录 | ✅ **HTTP 403 拒绝** |
| 临时密钥写桶根目录 | ✅ **HTTP 403 拒绝** |
| 单文件上传的 ETag | ✅ 等于内容 MD5 |
| **分片上传的 ETag** | ❌ **不是内容哈希，且同内容两次上传结果不同** |
| 孤儿分片会真实产生 | ✅ 测试期间产生了 1 个未完成分片任务 |

最后两条直接决定了下面的去重方案和回收方案。

## 架构

### 一条路径，三个入口共用

```
① 客户端 → POST /api/materials/upload-token
     报 文件名 / 大小 / MIME / 拍摄时间
     服务端：凭据反查租户 → 预分配 material_id 与 storage_key
            → 签 15 分钟临时密钥（策略限死 <tenantId>/* 前缀，仅上传类 action）
            → 返回分片大小（服务端统一规定 = 现有 SLICE_THRESHOLD_BYTES，20MB；
            分片大小必须服务端定，因为实测它会改变 ETag 与分片数）

② 客户端 → 广州 COS 直传（大于阈值走分片）        ← 全程境内

③ 客户端 → POST /api/materials/complete
     服务端：HEAD 每个对象，校验存在且 Content-Length 与申报大小一致
            → 一致才落库；不一致 400，绝不写「DB 有记录、COS 没文件」的假数据
```

iPhone 快捷指令、微信小程序、电脑 agent、内部测试**全部走这一条**，没有第二条。

### 为什么第 ③ 步必须 HEAD 校验

不校验就等于让客户端自己宣布"我传好了"。客户端断网、传了 0 字节、或干脆没传却调了 complete，都会在库里留下一条指向空气的素材记录。这类静默失败最难查（见 memory `failure-without-reason-pattern`）。

### 去重：租户 + 文件名 + 大小 + 拍摄时间

**明确不做内容哈希。** 三条路都堵死了：

- **客户端算哈希** → iOS 快捷指令没有哈希动作。一旦让小程序和 agent 算、快捷指令不算，就变成三个入口三套逻辑，"一套方案"当场破产。
- **服务端靠 COS ETag** → 实测否掉：分片 ETag 既不是内容哈希，同一份内容传两次还得到不同值（`35bfaef0…-2` 与 `366f7f65…-2`）。视频走的正是分片。
- **服务端下载回来算** → 几百兆下行流量要付费，且慢。

元数据去重覆盖真实场景：定时任务每小时重扫同一批照片，文件名、大小、拍摄时间三样完全一致，重复上传无害。

**代价（明确接受）**：用户手动改文件名后重传会存两份。这不是数据错误，只是多占空间；存储 0.118 元/GB/月，不值得为它牺牲入口统一性。

### 老端点 `/upload` 必须一起改

现在 `/upload` 用 `hashFile()` 算 SHA-256 进去重键。**若只改新路径不改它，同一张照片走两个入口会得到两个不同的去重键，存两份**——这恰恰是本次要消灭的不一致。

所以 `/upload` 同步改为元数据去重，与直传共用同一个落库函数。

> `materials.content_hash` 列保留但一律为 NULL（列可空，无需迁移）。保留而不删是因为将来若真需要内容去重，可由离线任务回填。代码里注明原因，避免被后人当成遗漏。
>
> 副作用：已有 3 条测试素材的 dedupe_key 是哈希口径的，改口径后它们可能被重传一次。staging 测试数据，可接受。

### 孤儿分片：COS 生命周期规则，不写代码

客户端拿了密钥却没传完，会在桶里留下未完成的分片任务，占空间且不可见。配一条「未完成分片 7 天后自动中止」的生命周期规则（7 天足够覆盖断网重试与跨天续传，又不至于让碎片长期堆积），腾讯云自己回收，零维护代码。

### 同批捎带：改掉全球加速域名

agent 5 处硬编码 `cos.accelerate.myqcloud.com`：

```
services/agent/src/core-upgrader.ts
services/agent/src/module-manager.ts
services/agent/src/handlers/ensure-chrome.ts   （2 处）
services/agent/src/handlers/ensure-ffmpeg.ts
```

国内客户下载国内桶，却走跨境加速通道，又慢又贵——2026-07 账单里"全球加速下行流量_境内到境内"一项 33.28 元。改为 `cos.ap-guangzhou.myqcloud.com` 直连。

## 组件划分

| 单元 | 职责 | 依赖 |
|---|---|---|
| `material-upload.ts`（改） | 纯函数：类型推断、去重键、存储 key。去掉 `contentHash` 分支 | 无 |
| `material-storage.ts`（改） | 存储抽象新增 `issueUploadCredential()` 与 `headObject()`；内存实现同步跟上 | 无 |
| `material-storage-cos.ts`（改） | 上述两方法的 COS/STS 实现 | `cos-nodejs-sdk-v5`、`qcloud-cos-sts`（新增） |
| `material-persist.ts`（新） | 落库：写 materials + contents + content_materials。**直传与老端点共用** | pg |
| `routes/materials.ts`（改） | 三个端点：`/upload-token`、`/complete`、`/upload`（改为调用共用落库） | 以上 |

抽出 `material-persist.ts` 是本次的关键结构变化：落库逻辑现在有两个调用方，留在路由里必然被复制一份，复制就会漂移。

## 错误路径

| 情形 | 行为 |
|---|---|
| 无凭据 / 凭据无效 | 401 |
| 凭据认得出但不可用（吊销/停用/过期/无租户） | 403，与 `worker-agent-auth` 同口径 |
| COS 未配置 | 400 明确报错，**不静默回落假装成功** |
| STS 签发失败 | 500 带真实原因，不吞 |
| complete 时对象不存在 | 400 `OBJECT_NOT_FOUND` |
| complete 时大小对不上 | 400 `SIZE_MISMATCH` |
| 重复 complete 同一批 | 幂等：命中去重返回已有 id，不建第二个作品 |
| 视频与图片混传 | 400，在 `upload-token` 阶段就拒，不等到传完 |

## 测试策略

**逻辑接缝 → CI 单测**（TDD 两段式：commit-1 红、commit-2 绿）

- `material-upload.test.ts`：去重键**不含内容哈希**、同一文件两个入口得同一个键、路径穿越逃不出租户目录
- `material-storage.test.ts`：内存实现的 `headObject`/`issueUploadCredential` 行为；COS 未配置时的明确失败
- `materials.test.ts`：三端点鉴权四档、自报 `tenant_id` 被忽略、complete 大小不符被拒、重复 complete 幂等、混传在 token 阶段被拒
- `agent-cos-endpoint.test.ts`：断言 agent 源码中**不存在** `cos.accelerate` 字样（这是会报红的守卫，不是摆设）

**环境接缝 → 真 API + 真 DB smoke**

`material-direct-upload-smoke.sh`：真调 `/upload-token` → 用返回的临时密钥真传一个小文件到 COS → 真调 `/complete` → 查库断言记录存在且 storage_key 以租户 ID 开头 → **再用同一把密钥尝试写别的租户目录，断言被拒**。

最后那步是本设计的安全命门，必须在真链路上被证明，不能只在单测里断言。无 DB 时明确 SKIP，不假绿。

## 不包含

- iPhone 快捷指令的具体配置（Shortcuts App 里手工配，另行交付）
- 微信小程序上传页
- 安卓端拉素材写相册
- 素材库浏览与混剪
