#!/usr/bin/env bash
# validate-deploy-workflow.sh — 验证 deploy-hk-vps.yml 语法和必要字段
# 用法: bash validate-deploy-workflow.sh [workflow-file]
# 退出码: 0=PASS, 1=FAIL
set -euo pipefail

WORKFLOW="${1:-.github/workflows/deploy-hk-vps.yml}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORKFLOW_PATH="$REPO_ROOT/$WORKFLOW"

PASSED=0
FAILED=0

check() {
  local name="$1" result="$2" expect="$3"
  if [ "$result" = "$expect" ]; then
    echo "  PASS [$name]"
    PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect=$expect got=$result"
    FAILED=$((FAILED+1))
  fi
}

echo "=== validate-deploy-workflow ==="
echo "Target: $WORKFLOW_PATH"
echo ""

# 1. 文件存在
if [ -f "$WORKFLOW_PATH" ]; then
  echo "  PASS [file-exists]"
  PASSED=$((PASSED+1))
else
  echo "  FAIL [file-exists] file not found: $WORKFLOW_PATH"
  FAILED=$((FAILED+1))
  echo ""; echo "TOTAL: passed=$PASSED failed=$FAILED"; exit 1
fi

# 2. YAML 语法合法
set +e
python3 -c "import yaml, sys; yaml.safe_load(open('$WORKFLOW_PATH'))" 2>/tmp/yaml-lint-out.txt
YAML_RC=$?
set -e
if [ $YAML_RC -eq 0 ]; then
  echo "  PASS [yaml-syntax]"
  PASSED=$((PASSED+1))
else
  echo "  FAIL [yaml-syntax]"
  cat /tmp/yaml-lint-out.txt
  FAILED=$((FAILED+1))
fi

# 3. 必须有 push → main 触发器
set +e
HAS_PUSH_MAIN=$(python3 -c "
import yaml
data = yaml.safe_load(open('$WORKFLOW_PATH'))
on = data.get('on', data.get(True, {}))
branches = []
if isinstance(on, dict):
    push = on.get('push', {})
    if isinstance(push, dict):
        branches = push.get('branches', [])
print('yes' if 'main' in branches else 'no')
" 2>/dev/null)
set -e
check "trigger-push-main" "$HAS_PUSH_MAIN" "yes"

# 4. 必须使用 HK_VPS_SSH_KEY secret
set +e
HAS_SSH_KEY=$(grep -q 'HK_VPS_SSH_KEY' "$WORKFLOW_PATH" && echo "yes" || echo "no")
set -e
check "uses-HK_VPS_SSH_KEY" "$HAS_SSH_KEY" "yes"

# 5. 必须使用 HK_VPS_HOST secret
set +e
HAS_HOST=$(grep -q 'HK_VPS_HOST' "$WORKFLOW_PATH" && echo "yes" || echo "no")
set -e
check "uses-HK_VPS_HOST" "$HAS_HOST" "yes"

# 6. 必须有 docker build 步骤
set +e
HAS_DOCKER_BUILD=$(grep -q 'docker build' "$WORKFLOW_PATH" && echo "yes" || echo "no")
set -e
check "has-docker-build" "$HAS_DOCKER_BUILD" "yes"

# 7. 必须有 docker compose up 步骤
set +e
HAS_COMPOSE_UP=$(grep -q 'docker compose' "$WORKFLOW_PATH" && echo "yes" || echo "no")
set -e
check "has-docker-compose-up" "$HAS_COMPOSE_UP" "yes"

# 8. 使用 appleboy/ssh-action
set +e
HAS_SSH_ACTION=$(grep -q 'appleboy/ssh-action' "$WORKFLOW_PATH" && echo "yes" || echo "no")
set -e
check "uses-appleboy-ssh-action" "$HAS_SSH_ACTION" "yes"

# 9. jobs 不为空
set +e
JOB_COUNT=$(python3 -c "
import yaml
data = yaml.safe_load(open('$WORKFLOW_PATH'))
jobs = data.get('jobs', {})
print(len(jobs))
" 2>/dev/null)
set -e
if [ "${JOB_COUNT:-0}" -ge 1 ]; then
  echo "  PASS [has-jobs] count=$JOB_COUNT"
  PASSED=$((PASSED+1))
else
  echo "  FAIL [has-jobs] no jobs defined"
  FAILED=$((FAILED+1))
fi

echo ""
echo "TOTAL: passed=$PASSED failed=$FAILED"

if [ $FAILED -gt 0 ]; then
  echo "STATUS: FAIL"
  exit 1
else
  echo "STATUS: PASS"
  exit 0
fi
