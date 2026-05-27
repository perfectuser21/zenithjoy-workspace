---
skeleton: false
journey_type: agent_remote
---
# Contract DoD — Workstream 4: .github/workflows/kuaishou-e2e.yml 新建

**范围**: 新建 GHA workflow，`workflow_dispatch` 触发，`windows-latest` runner，注入 `KUAISHOU_COOKIES` env（来自 repo secret），分步骤跑 image-dryrun 和 video-dryrun，最终 `upload-artifact` 上传 `screenshots/`（`if: always()` 确保失败也保存截图）
**大小**: S（~80 行，新 YAML）
**依赖**: Workstream 3 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `.github/workflows/kuaishou-e2e.yml` 文件存在
  Test: node -e "require('fs').accessSync('/workspace/.github/workflows/kuaishou-e2e.yml');console.log('OK')"

## BEHAVIOR 条目（内嵌 manual:bash 命令）

- [ ] [BEHAVIOR] workflow 文件含 `windows-latest` runner 配置
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/.github/workflows/kuaishou-e2e.yml'"'"','"'"'utf8'"'"');if(!c.includes('"'"'windows-latest'"'"')){console.error('"'"'FAIL: 缺 windows-latest'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] workflow 文件含 `KUAISHOU_COOKIES` secret 引用（secrets.KUAISHOU_COOKIES 或 env.KUAISHOU_COOKIES）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/.github/workflows/kuaishou-e2e.yml'"'"','"'"'utf8'"'"');if(!c.includes('"'"'KUAISHOU_COOKIES'"'"')){console.error('"'"'FAIL: 缺 KUAISHOU_COOKIES secret'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] workflow 文件含 image-dryrun 脚本执行步骤
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/.github/workflows/kuaishou-e2e.yml'"'"','"'"'utf8'"'"');if(!c.includes('"'"'kuaishou-image-dryrun'"'"')){console.error('"'"'FAIL: 缺 image-dryrun step'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] workflow 文件含 video-dryrun 脚本执行步骤
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/.github/workflows/kuaishou-e2e.yml'"'"','"'"'utf8'"'"');if(!c.includes('"'"'kuaishou-video-dryrun'"'"')){console.error('"'"'FAIL: 缺 video-dryrun step'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] workflow 文件含 `upload-artifact` 步骤（`if: always()` 确保失败也上传截图）
  Test: manual:bash -c 'node -e "const c=require('"'"'fs'"'"').readFileSync('"'"'/workspace/.github/workflows/kuaishou-e2e.yml'"'"','"'"'utf8'"'"');if(!c.includes('"'"'upload-artifact'"'"')){console.error('"'"'FAIL: 缺 upload-artifact'"'"');process.exit(1);}if(!c.includes('"'"'always()'"'"')){console.error('"'"'FAIL: 缺 if: always()'"'"');process.exit(1);}console.log('"'"'OK'"'"')" || exit 1'
  期望: OK

> **假绿自查**：`kuaishou-e2e.yml` 在 WS4 实现前根本不存在 → 所有 BEHAVIOR 命令 `readFileSync` 抛 ENOENT → exit 1 → 全部真红 ✅。`accessSync` 同样 ENOENT ✅。
