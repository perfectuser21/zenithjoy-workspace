# PRD — devalue 安全依赖

任务 ddd77603-db31-4b1e-bf8d-b9b2eff2e686，父 fa58ae89-c080-40a3-acf0-2e25f47f5d47。真实CI安全门禁因Astro传递的devalue5.8.1高危拒绝producer及ffmpeg依赖。只将root lock的既有devalue更新官方patched5.9.3，不加直接依赖，不扩大allowlist，不改业务、生产或ffmpeg代码。

GP-Anchor: line02/keyword_acquisition keep-green

官方GHSA-j22f-vq7h-c4qm与GHSA-mcm9-63f2-9j32确认<=5.9.2受影响、5.9.3修复。永久真实Node Buffer输出及实际npm audit验收，保普通显式TypedArray backing语义。
