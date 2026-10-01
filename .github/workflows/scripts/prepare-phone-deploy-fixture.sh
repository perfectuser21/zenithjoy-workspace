#!/usr/bin/env bash
# 仅 CI：真实 Git 对象的私有部署夹具，不改共享 checkout/引用，不连接远端。
set -euo pipefail
SOURCE_ROOT="${1:?source repository required}"
FIXTURE_ROOT="${2:?new private fixture directory required}"
SOURCE_HEAD="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_ORIGIN="$(git -C "$SOURCE_ROOT" remote get-url origin)"
git clone --quiet --shared --no-checkout -- "$SOURCE_ROOT" "$FIXTURE_ROOT"
git -C "$FIXTURE_ROOT" sparse-checkout set --cone services/phone-adb-controller
git -C "$FIXTURE_ROOT" checkout --quiet --detach "$SOURCE_HEAD"
# clone 的 origin 默认是本地源目录；保留原仓库身份，不能给别的仓库伪贴规范 URL。
git -C "$FIXTURE_ROOT" remote set-url origin "$SOURCE_ORIGIN"
# 测试准入只在私有夹具登记；生产 main 的祖先限制保持原样。
git -C "$FIXTURE_ROOT" update-ref refs/remotes/origin/main "$SOURCE_HEAD"
