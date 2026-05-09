# Sprint 2.1f Prod-Readiness — Evidence

**Date:** 2026-05-09
**Branch:** cp-05091537-sprint-2-1f-prod-readiness
**Spec:** docs/superpowers/specs/2026-05-09-sprint-2-1f-prod-readiness-design.md
**Plan:** docs/superpowers/plans/2026-05-09-sprint-2-1f-prod-readiness.md

## Build install pack v1.0.1

- Path: `services/agent/dist-installpack/zenithjoy-agent-v1.0.1.tar.gz`
- Size: 22641585 bytes (22M)
- sha256: `2f3eaf9f2d1025f2739d5860d52f57723603fdc30352fe13e6cf94e1ab67bdbb`
- Build time: 2026-05-09T08:15:37Z
- Tar contents (5 files):
  ```
  zenithjoy-agent-v1.0.1/README-1分钟跑通.txt
  zenithjoy-agent-v1.0.1/uninstall.bat
  zenithjoy-agent-v1.0.1/start.bat
  zenithjoy-agent-v1.0.1/.env.template
  zenithjoy-agent-v1.0.1/zenithjoy-agent.exe
  ```

## HK rsync

- Time: 2026-05-09T08:18Z
- Path: `hk-vps:/opt/zenithjoy/autopilot-dashboard/dist/download/`
- Files synced: zenithjoy-agent-v1.0.1.tar.gz, zenithjoy-agent-v1.0.1.tar.gz.sha256, manifest.json
- HK ls 输出:
  ```
  -rw-r--r-- 1 501 staff 226 May  9 16:15 manifest.json
  -rw-r--r-- 1 501 staff 22M May  9 16:15 zenithjoy-agent-v1.0.1.tar.gz
  -rw-r--r-- 1 501 staff 113 May  9 16:15 zenithjoy-agent-v1.0.1.tar.gz.sha256
  ```
- HK manifest:
  ```json
  {
    "version": "1.0.1",
    "sha256": "2f3eaf9f2d1025f2739d5860d52f57723603fdc30352fe13e6cf94e1ab67bdbb",
    "download_url": "/download/zenithjoy-agent-v1.0.1.tar.gz",
    "size": 22641585,
    "build_time": "2026-05-09T08:15:37Z"
  }
  ```

## HK container restart

```
autopilot-dashboard          Up 23 seconds (health: starting)
autopilot-dev                Up 11 seconds
autopilot-prod               Up 12 seconds
```

## Public download endpoint (cloudflare → hk nginx)

```
$ curl -sI "https://autopilot.zenjoymedia.media/download/zenithjoy-agent-v1.0.1.tar.gz?cb=$(date +%s)"
HTTP/2 200
date: Sat, 09 May 2026 08:21:08 GMT
content-type: application/octet-stream
content-length: 22641585
accept-ranges: bytes
cache-control: public, max-age=14400
etag: "69feed29-1597bb1"
last-modified: Sat, 09 May 2026 08:15:37 GMT
server: cloudflare
cf-cache-status: MISS
```

## Server-side license-burn endpoint 验证

走 vitest（不走 mac 真 cookie，因为 dashboard better-auth session 在 mac 不易构造，且 mac 没 chrome:19222 / 没 windows）：

```
$ npx vitest run src/routes/__tests__/agent-install-pack.test.ts
✓ src/routes/__tests__/agent-install-pack.test.ts (6 tests) 282ms
Test Files  1 passed (1)
     Tests  6 passed (6)
```

6/6 GREEN — 证明 `/api/agent/install-pack/download` 行为：
- 鉴权：未登录 → 401
- 鉴权：已登录无 license → 404
- license 烧入：把 zip 里 .env.template 的占位替换为真 license，content-disposition 含 v1.0.1 文件名
- license 状态机：成功烧 license → DB 标记 burned

## 9 件 fix 验收

| Fix | 状态 | Evidence |
|---|---|---|
| 1 LICENSE_HMAC_SECRET | ✅ | mac 5200 register curl 不再 500（commit 49a5577 backend 修） |
| 2 normalize migration | ✅ | psql NOTICE: All licenses 符合 base32 char set（migration 20260509_120200） |
| 3 LICENSE_KEY_PATTERN [A-Z0-9] | ✅ | vitest license.service.test.ts 8/8 GREEN（含 0/1/4/8 hex 边界） |
| 4 gen_base32_chars | ✅ | psql `SELECT gen_base32_chars(8)` 输出真 K282PLBU 风格 |
| 5 start.bat 编码 ASCII LF 无 BOM | ✅ | hexdump 第一字节 40 / file ASCII / 内含 `chcp 65001` |
| 6 envOrConfig | ✅ | vitest load-config.test.ts 3/3 GREEN |
| 7 install-pack download 烧 license | ✅ | vitest agent-install-pack.test.ts 6/6 GREEN |
| 8 start.bat 预检 license | ✅ | start.bat Step 4 line 22-43 含 license precheck |
| 9 uninstall.bat | ✅ | hexdump 40 / file ASCII / 4 件清理（kill exe + del 进程残留 + del .env + del 配置目录） |

## Lead 真机自验占位（xian-rog Windows）

Sprint 2.1f 端到端的最终判断在同事电脑真跑一次：

- [ ] 跑 uninstall.bat 清干净状态（如果之前装过 v1.0.0）
- [ ] dashboard 重新下载 v1.0.1 install pack（验证 .env 含真 license，不是占位）
- [ ] 解压 + 双击 start.bat（验证 chcp 65001 中文不乱码 + license precheck OK）
- [ ] 截图：start.bat console 输出 `license precheck OK`
- [ ] 截图：agent 系统托盘绿灯
- [ ] 截图：dashboard agents 列表显示 online 绿点
- [ ] 截图：dryrun 发布 1 条抖音内容回执

如同事 e2e 通 → sprint 2.1f 端到端 ✅
如同事 e2e 不通 → 在本文件追加截图 + 找到的新问题，告诉 controller 跟进。

（截图待 Lead 自验完毕后用 `git add docs/evidence/sprint-2-1f-prod-readiness.md && git commit -m "docs(evidence): sprint 2.1f xian-rog 自验截图"` 单独 commit，属于 ship 阶段。）
