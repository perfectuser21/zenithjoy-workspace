# 定时发送实现计划（TDD 两 commit）

Spec：`2026-09-10-scheduled-publish-design.md`。worktree：本目录，分支 cp-09100824-scheduled-publish。

## commit-1（test，先红）
1. `apps/api/src/services/__tests__/notion-orchestrator.test.ts` +4 例（未到点不派/到点派+镜像UPDATE/无定时立即派/坏日期fail-closed）
2. `apps/api/src/services/__tests__/feishu-orchestrator.test.ts` +4 例同构（毫秒时间戳）
3. `apps/api/src/routes/__tests__/publish-dispatch.test.ts` +2 例（PATCH scheduled_at 合法/非法400）
4. 跑 vitest 确认新例全红、旧例全绿，commit `test: 定时发送契约——…`

## commit-2（impl，转绿）
1. migration `apps/api/db/migrations/20260910_083000_contents_scheduled_at.sql`
2. `notion-orchestrator.ts`：NotionProperty 加 date 形态 + parseScheduledAt + pullFireRows 定时闸 + 回写 UPDATE 镜像 scheduled_at
3. `feishu-orchestrator.ts` 同构
4. `publish-dispatch.ts`：PATCH 第4个 if + GET SELECT/响应补列
5. smoke `notion-orchestrator-selfcheck-smoke.sh` 加 scheduled_at 列存在关卡
6. test-registry.yaml 三条 note 补定时语义
7. vitest 全绿 + eslint + tsc，commit `feat: 作品定时发送…`
