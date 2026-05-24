---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: install pack + 版本号

**范围**: `build-install-pack.sh` 加入 `cp -r publishers/ $PACK_DIR/publishers/` 逻辑；`package.json` version 1.1.25 → 1.1.26
**大小**: S（约 10 行净改，2 文件）
**依赖**: Workstream 2 完成后

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/package.json` version 字段值为 `"1.1.26"`
  Test: node -e "const v=require('/workspace/services/agent/package.json').version;if(v!=='1.1.26'){console.error('FAIL version='+v);process.exit(1)}"

- [ ] [ARTIFACT] `services/agent/scripts/build-install-pack.sh` 含 `publishers` 字符串（复制逻辑）
  Test: node -e "const s=require('fs').readFileSync('/workspace/services/agent/scripts/build-install-pack.sh','utf8');if(!s.includes('publishers'))process.exit(1)"

- [ ] [ARTIFACT] `sprints/zj-douyin-article-agent-port/tests/ws3/install-pack.test.ts` 文件存在（vitest install-pack 覆盖测试，Round 3 新增，对齐 Test Contract 表格）
  Test: node -e "require('fs').accessSync('/workspace/sprints/zj-douyin-article-agent-port/tests/ws3/install-pack.test.ts')"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `package.json` version 字面值为 "1.1.26"（不是 1.1.25 或其他版本）
  Test: manual:bash -c 'VER=$(node -e "console.log(require(\"/workspace/services/agent/package.json\").version)"); [ "$VER" = "1.1.26" ] || { echo "FAIL: version=$VER 期望 1.1.26"; exit 1; }; echo "OK: version=$VER"'
  期望: OK: version=1.1.26

- [ ] [BEHAVIOR] 旧版本 "1.1.25" 不再是 package.json 的 version 字段值（防止 bump 未实际写入）
  Test: manual:bash -c 'VER=$(node -e "console.log(require(\"/workspace/services/agent/package.json\").version)"); [ "$VER" != "1.1.25" ] || { echo "FAIL: version 仍为 1.1.25，未完成 bump"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] `build-install-pack.sh` 含将 publishers/ 目录整体复制到 pack 目录的命令（cp -r 或 rsync）
  Test: manual:bash -c 'grep -qE "cp -r.*publishers|rsync.*publishers|publishers.*\\\$PACK_DIR" /workspace/services/agent/scripts/build-install-pack.sh || { echo "FAIL: build-install-pack.sh 无 publishers/ 复制逻辑"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] publishers 复制目标路径含 `douyin-publisher`（确保粒度正确，不是只复制顶级 publishers 空目录）
  Test: manual:bash -c 'grep -qE "publishers.*douyin|douyin.*publishers|publishers/" /workspace/services/agent/scripts/build-install-pack.sh || { echo "FAIL: publishers 复制未覆盖 douyin-publisher 子目录"; exit 1; }; echo OK'
  期望: OK，exit 0

- [ ] [BEHAVIOR] error path — 执行脚本后 package.json 版本字段仍为 "1.1.26"（防止 build 步骤意外覆盖版本）
  Test: manual:bash -c 'VER=$(node -e "console.log(require(\"/workspace/services/agent/package.json\").version)"); [ "$VER" = "1.1.26" ] || { echo "FAIL: build 后 version=$VER 不是 1.1.26"; exit 1; }; echo OK'
  期望: OK，exit 0
