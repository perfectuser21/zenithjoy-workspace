# Learning — 生产 API 人工回滚入口 rollback.sh（补 blue-green 缺的"人手点回滚"）

**Sprint**: 06251825-zenithjoy-manual-rollback
**Path**: 部署生命周期 · 蓝绿加固（配套 #866~#884）

## 问题

接到的 brief 要"前端 deploy-hk.sh 改 symlink-releases + 统一 rollback.sh + vN tag + .production-release"。
但先读 repo 现状（先怀疑再证明）发现 brief 前提与现状严重不符：

1. **拓扑写错**：brief 说"生产在 HK"。同日 handoff（已标注"已纠正"）写的是 **API 生产=mmv:5200 本机**，
   只有 **Dashboard 在 HK**。deploy-hk.sh 早已是 legacy。
2. **绝大部分已做完并合进 main**：release 隔离（`releases/<sha>/`+`current` 软链）、原子重指、留存5份、
   蓝绿编排 + 两条失败路径自动回滚、人工 promote 闸（`promote-prod.yml`/`promote-dashboard-prod.yml`）
   —— 全在 `deploy-lib.sh` + 一堆 workflow 里（#866~#884）。
3. brief 的 `prod-zenithjoy-vN` git tag + `.production-release` 文件与现有 **sha-keyed** 系统冲突，
   硬塞 = 建平行系统（违反"复用已集成系统/加厚先减肥"）。

唯一**真缺口**：回滚只有 `blue_green_deploy` 内部 promote 失败时的【自动】回滚（anchor 来自实时 `/version`），
**没有给人手动调用的入口**（promote 几小时后才发现要回退时无命令、也没有"上一个 release 是谁/指定 sha 在不在留存"判定）。

## 解法（选项 A，lead 拍板）

放弃 vN tag/.production-release，只补人工回滚入口，**复用现有原语不重写**：

- `deploy-lib.sh` 加两个纯函数：`list_releases`（mtime 新→旧、排除 current/staging 软链，与 `prune_old_releases` 同口径）
  + `previous_release`（current 之后紧邻的更旧一个；current 最老→空）。
- 仓库根 `rollback.sh`：无参=退到 `previous_release`；带 sha=校验在留存 release 目录里（不在→报错退出）；
  `--list` 只读列出。选定目标后直接调现有 `staging_rollback`（原子重指 current + 重启 + health + 版本断言）。
- `rollback-prod.yml`：人工放行闸（workflow_dispatch + confirm=`ROLLBACK`），SSH 进 mmv 跑同一个 `rollback.sh`，风格抄 `promote-prod.yml`。
- Dashboard(HK) **不做**：promote-dashboard-prod.yml 是 `cp -r dist` 原地覆盖、零留存，无可回退版本 —— 要先上 symlink-releases（独立任务）。诚实标注，不冒充能回滚。

## 踩坑

1. **`$RELROOT）`** 全角标点紧贴 bash 变量：`$RELROOT` 后接全角 `）` 触发 `unbound variable`（首字节 `\xef` 被并进变量名）。
   修法：echo 串里所有 `$VAR` 后接非 ASCII 的一律 `${VAR}`。`grep -P '\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]'` 自检。
2. **测试在 errexit 下跑**：`deploy-lib.test.sh` 早段有 `set -e 2>/dev/null||true`，到我的 Case Q 仍生效；
   `rollback.sh` 报错分支 `exit 1` 会连累测试脚本一起退（trace 停在 `bash rollback.sh` 那行）。
   修法：Q 块前 `set +e`、块末 `set -e`（与本文件 sha/kill_port 段同款）。

## 验证

- `shellcheck rollback.sh deploy-lib.sh deploy-lib.test.sh` 全 OK。
- `deploy-lib.test.sh`：PASSED=63 FAILED=0（新增 P=list/previous 5 例 + Q=rollback 入口 5 例）。
  Q 用注入 mock `staging_rollback` 的 stub lib，在本地临时目录 **promote v1→v2→rollback→断言回 v1**，绝不碰真 :5200/HK。
- 既有 `staging-promote-smoke.sh` / `staging-promote-workflow-smoke.sh` 仍 rc=0（我对 lib 的新增没破坏现有路径）。
