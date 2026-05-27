---
skeleton: false
journey_type: autonomous
target_environment: windows_cloud
---
# Contract DoD — Workstream 2: .github/workflows/kuaishou-e2e.yml 新建（GHA windows-latest）

**范围**: 新建 `.github/workflows/kuaishou-e2e.yml`，`workflow_dispatch`（可选 schedule），`windows-latest` runner，注入 `KUAISHOU_COOKIES` secret，分步运行 image-dryrun + video-dryrun，传递 SCREENSHOT_DIR，upload screenshots artifact（if: always）
**大小**: S（~60 行新建）
**依赖**: Workstream 1（publish-kuaishou-video-dryrun.cjs 必须存在）

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/kuaishou-e2e.yml` 文件已创建
  Test: node -e "require('fs').accessSync('.github/workflows/kuaishou-e2e.yml'); console.log('OK')"

- [ ] [ARTIFACT] workflow 使用 `windows-latest` runner
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');if(!c.includes('windows-latest'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] workflow 含 `upload-artifact` 步骤（screenshots 上传为可审查证据）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/kuaishou-e2e.yml','utf8');if(!c.includes('upload-artifact'))process.exit(1);console.log('OK')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] workflow 含 `KUAISHOU_COOKIES` secret 引用（schema 字段 — CI 注入 cookie 的核心机制）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"KUAISHOU_COOKIES\")){console.error(\"FAIL: 无 KUAISHOU_COOKIES 引用\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] workflow 含 image-dryrun 脚本调用（keys 完整性 — image + video 两步均有）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"image-dryrun\")){console.error(\"FAIL: 无 image-dryrun 调用\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] workflow 含 video-dryrun 脚本调用（keys 完整性 — 两步 E2E 完整覆盖）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"video-dryrun\")){console.error(\"FAIL: 无 video-dryrun 调用\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] workflow 含 `SCREENSHOT_DIR` 环境变量传递（截图写入路径，WS1 脚本依赖此变量知道截图目标目录）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"SCREENSHOT_DIR\")){console.error(\"FAIL: 无 SCREENSHOT_DIR 环境变量\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — workflow upload-artifact 含 `if: always()` 保证失败时也能审查截图（防止失败时无证据）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"always()\")){console.error(\"FAIL: upload-artifact 缺 if:always()\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
