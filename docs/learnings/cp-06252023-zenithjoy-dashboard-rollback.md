# Learning — HK Dashboard release 隔离 + 回档（补完部署线最后一个危险点）

**Sprint**: 06252023-zenithjoy-dashboard-rollback
**Path**: 部署生命周期 · 蓝绿加固（配套 #885 API 回滚）

## 问题

#885 给 API（mmv:5200）补了人工回滚后，整条部署线只剩 **HK Dashboard** 没有回档：
`promote-dashboard-prod.yml` 是 `cp -r dist/. .../dist/` 原地覆盖、零留存、零回档——前端 promote 炸了回不来。

## 解法（复用 #885 的 sha-keyed 原语，不建平行体系）

1. **deploy-lib.sh +2 个编排函数**（纯目录/软链，可单测）：
   - `dashboard_release_promote <dash_dir> <sha> <built_dist> [keep]`：cp 进 `releases/<sha>/` →
     `atomic_repoint_current` 切 `releases/current` → `_atomic_swap_symlink` 让 `dist → releases/current`
     → `prune_old_releases` 留 5 份。布局 `dist → releases/current → releases/<sha>`（两层软链）。
   - `dashboard_release_rollback <dash_dir> <sha>`：校验 sha 在留存里 → `atomic_repoint_current` 切回。
   底层全是 #885 已有的 `atomic_repoint_current`/`current_release_sha`/`list_releases`/`previous_release`/`prune_old_releases`。
2. **rollback.sh 加 dashboard 路径**：重构成 `rollback.sh [api|dashboard] [<sha>|--list]`，第一个参数是
   `api`/`dashboard` 关键字才切路径，否则按 API（**向后兼容** rollback-prod.yml 的 `rollback.sh`/`<sha>`/`--list`）。
   抽 `_select_target`（挑哪个+校验）两路共用。
3. **promote-dashboard-prod.yml 改 symlink-releases**：build → `dashboard_release_promote` → `docker restart`。
   首次迁移：若 `dist` 还是实体目录，先把当前内容存成 `baseline-<sha>` release 再转软链（不丢现网版本、上线即有回退点）。
4. **rollback-dashboard-prod.yml（新）**：人工放行闸（confirm=ROLLBACK），SSH 进 HK 跑 `rollback.sh dashboard` + restart + 公网验证。

## 踩坑

1. **docker bind-mount 不跟随活体软链切换**：容器 `volumes: .../dist:/usr/share/nginx/html` 在**容器启动时**
   解析软链到真实 inode。活体把 `dist` 软链换指向，已跑的容器挂载不变 → promote/rollback 切完软链**必须
   `docker restart`** 让容器重解析。nginx 不用动（root 就是挂进来的内容）。已在 workflow 和注释里固化。
2. **全角标点紧贴 bash 变量**（#885 同款坑又踩）：`（$built）`/`（$reldir）` 里 `$built` 后接全角 `）`
   触发 unbound/截断，**在 bash 下还会让函数中途夭折导致整个 test 脚本被带崩**（不只是显示乱码）。
   修法：echo 串里 `$VAR` 后接非 ASCII 一律 `${VAR}`。自检：`grep -P '\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]'`。
3. **HK 上 deploy-lib.sh/rollback.sh 哪来的**：HK `/opt/zenithjoy/repo` 每次 `git reset --hard origin/main`，
   所以 lib 和 rollback.sh 都现成在 HK，workflow 直接 `source` / `bash` 它们，无需额外 ship。

## 验证

- `shellcheck rollback.sh deploy-lib.sh deploy-lib.test.sh` 全 OK；3 个 workflow YAML 解析 OK。
- `deploy-lib.test.sh`：**PASSED=82 FAILED=0**，新增：
  - **Case R**（11 例）：dashboard_release_promote/rollback 真跑——promote v1→v2（dist 穿透两层软链解析到 v2 内容）
    → rollback→v1（dist 内容回 v1）→ 空 build 拒绝 → 不存在 release 拒绝 → prune 留 5 删最老。
  - **Case S**（4 例）：`rollback.sh dashboard` 入口——promote v1→v2→rollback→releases/current 回 v1 + dist 内容=v1；
    --list 只读；不存在 sha 报错不切；**API 路径向后兼容**（无关键字仍走 API 调 mock staging_rollback）。
  全程本地临时目录，**绝不碰真 HK、绝不 docker、绝不 ssh**。
- 既有 `staging-promote-smoke.sh` / `staging-promote-workflow-smoke.sh` 仍 rc=0。
