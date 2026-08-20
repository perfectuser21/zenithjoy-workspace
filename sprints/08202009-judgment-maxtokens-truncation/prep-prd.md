# Bug PrepPRD：thinking 模型的 reasoning token 吃光输出预算，判定链与评论分档双双假绿

## 症状

同一条黄金路径（line02 关键词获客）上两个 AI 判定环节，各自静默失效了一个多月：

| 环节 | 生产表现 |
|---|---|
| 内容判定（content-judgment）| 184 条视频只有 11 条有转写（6%）；最大一坨 72 条是 `matched \| 无原因 \| 无转写` |
| 评论意向分档（comment-grading）| 404 条评论只有 217 条拿到档位；批量越大越差（1-5 条 66.4% → 8+ 条 44.6%）|

0820 实跑 staging task `bbddb3df`，`judgment_raw` 落库原文是光秃秃一个 `REJECTED\n`（9 字）。

## 根因（一条，两处；实测坐实）

**TOAPIS 的 `max_tokens` 是含 `reasoning_tokens` 的 completion 总预算**，而两处调的都是
thinking 模型。线上给的预算连思考都不够，正文一个字吐不出来。

前人其实撞过同一类坑并记在 `wechat-draft.ts` 头部（「v4-flash 思考走 reasoning_content……
max_tokens=2000 实测足够」），但这条经验没传到这两个服务。

### 实测数据

**content-judgment（gemini-2.5-flash-official，19.6s 中文语音，只改 max_tokens）**

| max_tokens | finish_reason | reasoning | 输出 |
|---|---|---|---|
| 200（线上）| **length** | 189 | `MATCHED\n转` （9 字，正写到「转写：」被砍）|
| 600 | **length** | 577 | 转写砍在「鸡胸肉配西兰花」|
| 2000 | stop | 736 | 判定 + 完整转写（100 字）✅ |

A 组 9 字与真机 `judgment_raw` 的 9 字长度吻合 —— 实验室与现场对上了。

**comment-grading（deepseek-v4-flash）**

| 条件 | finish | reasoning | 结果 |
|---|---|---|---|
| 25 条 @500（线上）| **length** | 500（封顶）| content 空，**0/25** |
| 25 条 @8000 | stop | 932 | 25/25，10.5s |
| 25 条 @500 + `reasoning_effort:'none'` | stop | 无 | **25/25，2.2s** |
| 42 条 @500 + `reasoning_effort:'none'` | stop | 无 | **42/42，2.3s** |

关键：**思考消耗是随机的，不是 N 的函数** —— 同样 8 条评论两次跑分别烧 863 / 213 tokens；
12 条 @2000 连续两次全丢。所以"再加点预算"救不了这一处，只有关掉思考才根治。

## 修法

| 文件 | 模型 | 改动 | 为什么是这个改法 |
|---|---|---|---|
| `content-judgment.ts` | gemini-2.5-flash | `max_tokens 200 → 2000` + 截断守卫 + `markPending` 落 raw | `reasoning_effort:'none'` **gemini 不认**（实测 reasoning 仍 189/577/572），只能给够预算 |
| `comment-grading.ts` | deepseek-v4-flash | 加 `reasoning_effort:'none'` + 截断守卫 | 4 选 1 短文本分类不需要思考链；预算一个字没改就 0/42 → 42/42 |

**截断守卫（两处同款）**：`finish_reason === 'length'` 时不当成功
—— 判定链改判 `pending('truncated_output')` 并落 raw，分档打 error 点名截断。
字段缺失时走正常路径，不误杀。

## 被实测证伪、因此没改的东西

1. ❌「prompt 把转写拼在条件分支尾巴导致模型不输出」→ 线上 prompt 原封不动 + 2000 就能出完整转写
2. ❌「20s 超时太紧」→ 实测最慢 7.4s；`gemini_timeout` 全库只有 2 条，偶发
3. ❌「commander 的 max_tokens=100 也中招」→ 实测 reasoning 仅 25~64、三次全 `finish=stop`，不动
4. ❌「评论要分批」→ 关思考后 42 条不分批就全过，分批是多余复杂度
5. ❌「修好转写会让分档更糟（prompt 变长）」→ 生产数据反向：有转写的视频分档成功率 89.4%，无转写只有 46.7%

> ⚠️ 第 4 条中途一度得出"模型对长列表有 25 条上限"的错误结论，来源是探针脚本的评论池
> 只有 25 条却按 42 条断言。重写自包含探针（带 `assert len(POOL)==42`）后推翻。
> 教训：探针脚本别用字符串补丁层层派生，容易继承上一层的隐含前提。

## 判准影响（关思考的代价，已评估不阻塞）

关思考 vs 开思考基准答案，25 条一致率 **22/25（88%）**，分歧 3 条全是**关思考给得更低**：
`能不能出个一周计划` 精准→感兴趣、`太贵了吧` 精准→其他、`博主身高体重多少` 感兴趣→其他。

偏保守的方向与 `comment-grading.ts` 头部那条已拍板的原则同向
（「宁可漏判高意向客户，不可误判陌生人为高意向去真实打扰」，decision 4e421ae8）。
且现状是 ≥6 条评论的视频**整批 null**——有档位（哪怕偏保守）严格优于没档位。

## 守卫与 proven-to-fire

四个守卫，**逐个变异、亲眼看红**（每个变异精确打红 1 条，还原后 32/32）：

| 变异 | 结果 |
|---|---|
| `JUDGMENT_MAX_TOKENS` 2000→200 | 1 failed ✅ |
| 拆掉判定链截断守卫 | 1 failed ✅ |
| 删掉 `reasoning_effort:'none'` | 1 failed ✅ |
| 拆掉分档截断守卫 | 1 failed ✅ |

守卫种类 = **逻辑接缝**（请求体参数 / 响应分支，纯逻辑），CI test 即可，
不需要运行时自检 —— 这不碰真机也不碰部署环境。

## 取舍声明

截断改判 pending 后这批视频不会自动重判（pending 目前是终态，无重试机制）。
但「诚实标 pending + raw 可诊断」严格优于「静默拿残缺文本写 matched」。
重试机制属于另一刀。

`openrouter.ts` 的共享 LLM 封装同样没查 `finish_reason`（它只处理了 content 为空），
本刀没动它 —— 那条路径服务的是别的功能，留作后续。

## 验收标准

- [x] failing test 先 commit（commit-1，4 failed | 28 passed）
- [x] 修复让 test 变绿（commit-2，32 passed）
- [x] 四个守卫均已变异测试，亲眼见红
- [ ] CI 全绿
- [ ] **真验收**：合并部署 staging 后真跑一条采集，`transcript` 列非空 + 评论 `grade` 非 null
