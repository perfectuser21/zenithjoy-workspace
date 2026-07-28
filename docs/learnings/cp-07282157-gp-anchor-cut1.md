# Learning: `node:test` 成功时输出仍含字面 "fail 0"，grep -qi "fail" 会误判为失败

## 现象

写 DoD/E2E 验证命令时用 `npm run test:product-map 2>&1 | grep -qiE "fail" && exit 1`，
即便测试 10/10 全绿也会误判为失败——因为 `node:test` 的 summary 行本身就打印
`ℹ fail 0`，naive grep "fail" 无差别命中这行文字。

## 洞察

任何以 node:test（甚至部分其他测试框架）为 oracle 的验证命令，判定成败必须用
**真实 exit code**，禁止对文本输出做 `grep -qi "fail"` 这类宽松字符串匹配——
成功态的 summary 文本里天然含有这个词。这是 GAN 合同自查阶段没测出来的假阳性：
Reviewer rubric 检查的是"命令是否可执行/是否有阈值"，没有真跑一遍去验证 oracle
本身在成功场景下是否会误报。

## 建议

1. 合同自查（Step 2b-check）之外，Generator 在 Step 6.5 Contract Self-Verification
   阶段跑通所有 [BEHAVIOR] 命令后，若发现类似"命令逻辑上该过却报错"的情况，第一反应
   应检查 oracle 本身的字符串匹配是否过宽，而不是急着改实现代码。
2. 涉及 node:test / vitest 等测试运行器的 DoD 断言，一律用 `$?` 判定，不 grep 输出文本。
