---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: GP锚定闭环 刀2（lint-gp-anchor.sh CI硬闸）

**范围**: 新写lint-gp-anchor.sh+挂进ci-l1-process.yml三处挂载+PR模板+设计文档字段名修正+追加断言进golden-path-f1-anchor-smoke.sh
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] lint-gp-anchor.sh 新建
  Test: node -e "if(!require('fs').existsSync('.github/workflows/scripts/lint-gp-anchor.sh'))process.exit(1)"

- [ ] [ARTIFACT] .github/pull_request_template.md 新建且含GP-Anchor提示
  Test: node -e "const c=require('fs').readFileSync('.github/pull_request_template.md','utf8'); if(!c.includes('GP-Anchor'))process.exit(1)"

- [ ] [ARTIFACT] 设计文档字段名bug修正(smoke_file→smoke_files)
  Test: node -e "const c=require('fs').readFileSync('docs/superpowers/specs/2026-07-28-gp-anchor-enforcement-design.md','utf8'); if(!c.includes('smoke_files'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] 无GP-Anchor行判红(GP-ANCHOR-MISSING)
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY="" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-a1.log 2>&1; CODE=$?; grep -q "GP-ANCHOR-MISSING" /tmp/dod-a1.log && [ $CODE -ne 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 多行GP-Anchor声明判红(GP-ANCHOR-MULTIPLE)
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY=$'"'"'GP-Anchor: a\nGP-Anchor: b'"'"' bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-a2.log 2>&1; CODE=$?; grep -q "GP-ANCHOR-MULTIPLE" /tmp/dod-a2.log && [ $CODE -ne 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 不存在的line/gp id判红(GP-ANCHOR-ID-NOTFOUND)且报错含line级简表
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY="GP-Anchor: line99/nonexistent_gp#step1" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-a3.log 2>&1; CODE=$?; grep -q "GP-ANCHOR-ID-NOTFOUND" /tmp/dod-a3.log && [ $CODE -ne 0 ] && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 推进类diff触碰校验：本刀自身PR声明推进gp_anchor_enforcement必须判绿(自举验收)
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY="GP-Anchor: line00/gp_anchor_enforcement#step2" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-b1.log 2>&1 && echo OK || { cat /tmp/dod-b1.log; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] keep-green声明只校验id存在不查diff
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY="GP-Anchor: line01/customer_first_success keep-green" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-b2.log 2>&1 && echo OK || { cat /tmp/dod-b2.log; exit 1; }'
  期望: OK

- [ ] [BEHAVIOR] none(白名单类别)放行，none(白名单外类别)判红
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && PR_BODY="GP-Anchor: none(docs)" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /dev/null 2>&1 || exit 1; PR_BODY="GP-Anchor: none(unknown_cat)" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/dod-b3.log 2>&1 && exit 1; grep -q "GP-ANCHOR" /tmp/dod-b3.log && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] ci-l1-process.yml三处挂载全部到位(job定义+needs+if判断块)
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && grep -q "^  lint-gp-anchor:" .github/workflows/ci-l1-process.yml && grep -q "lint-gp-anchor\]" .github/workflows/ci-l1-process.yml && grep -q "needs.lint-gp-anchor.result" .github/workflows/ci-l1-process.yml && echo OK || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 未新建平行smoke文件(golden-path-f1-anchor-smoke.sh追加断言而非另起新文件)
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && N=$(find .github/workflows/scripts/smoke -iname "*anchor*" | wc -l | tr -d " "); [ "$N" -eq 1 ] && echo OK || exit 1'
  期望: OK

## E2E 验收
见 contract-draft.md 的 `## E2E 验收` 段（target_environment=local_api，纯bash脚本，本地/CI均可跑）。
