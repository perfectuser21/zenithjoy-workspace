# Red Evidence

- 共享 fixture commit：`0dc4e3c07ff19a0ac95440723986bf3cb78580b2`
- 测试：`partial patch cannot make merged keyword bounds invalid`
- 命令：`cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose`
- 执行时间：2026-08-02 09:26 CST
- exit code：`1`
- 失败原因：`expected 200 to be 400`
- Received：`200`
- Expected：`400`
- 测试文件相对共享 commit：零 diff

该证据在任何生产代码变更前取得。
