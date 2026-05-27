---
skeleton: false
journey_type: autonomous
target_environment: windows_cloud
---
# Contract DoD — Workstream 3: .github/workflows/kuaishou-e2e.yml 新建

**范围**: 新建 `.github/workflows/kuaishou-e2e.yml`，`workflow_dispatch`（可选 schedule），`windows-latest`，分步运行 image-dryrun + video-dryrun，注入 `KUAISHOU_COOKIES` secret，上传 screenshots artifact
**大小**: S（~60 行新建）
**依赖**: Workstream 2（两个 publisher 脚本均存在后 workflow 才可测）

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

- [ ] [BEHAVIOR] workflow 含 `SCREENSHOT_DIR` 环境变量传递（禁用字段反向 — workflow 不能省略截图目录传递，否则截图写入失败无证据）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"SCREENSHOT_DIR\")){console.error(\"FAIL: 无 SCREENSHOT_DIR 环境变量\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — workflow 含 `if: always()` 保证截图在失败时也上传（evaluator 可审查失败截图）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/kuaishou-e2e.yml\",\"utf8\");if(!c.includes(\"always()\")){console.error(\"FAIL: upload-artifact 缺 if:always()\");process.exit(1);}console.log(\"OK\")"'
  期望: OK
