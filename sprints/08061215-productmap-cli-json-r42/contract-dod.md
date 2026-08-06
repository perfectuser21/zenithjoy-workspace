---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — product-map CLI `check --json`

**范围**: 仅 `scripts/product-map/` CLI 与单测；不改产品分类数据或其他子命令。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/product-map/cli.mjs` 实现 `check --json`，测试位于既有 product-map 测试目录或本 Sprint 合同测试对应位置。
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('scripts/product-map/cli.mjs','utf8');if(!c.includes('--json'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: check --json 成功时输出严格 schema
  动作: 在当前有效 product-map 上执行 `node scripts/product-map/cli.mjs check --json`
  预期观察: stdout 仅有一个对象，ok=true、errors=[]，退出 0
  等待预算: 10s
  留证: 命令 stdout 与 exit code
  Test: manual:bash -c 'OUT=$(timeout 10s node scripts/product-map/cli.mjs check --json); CODE=$?; [ "$CODE" -eq 0 ] && printf "%s" "$OUT" | jq -e '\''keys==["errors","ok"] and .ok==true and .errors==[]'\'''

- [ ] [BEHAVIOR] [L2] B-02: product-map.json 缺失时仍输出合法失败 JSON
  动作: 在隔离临时仓库副本移除生成 JSON 后执行 check --json
  预期观察: stdout 为 ok=false 与非空 string[] errors，退出非 0
  等待预算: 10s
  留证: 临时副本命令 stdout、stderr 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; mkdir -p "$D/scripts"; cp -R scripts/product-map "$D/scripts/"; cp -R product-map "$D/"; rm "$D/product-map/generated/product-map.json"; set +e; OUT=$(node "$D/scripts/product-map/cli.mjs" check --json 2>"$D/err"); CODE=$?; set -e; [ "$CODE" -ne 0 ] && [ ! -s "$D/err" ] && printf "%s" "$OUT" | jq -e '\''keys==["errors","ok"] and .ok==false and (.errors|length)>0 and all(.errors[]; type=="string")'\'''

- [ ] [BEHAVIOR] [L2] B-03: product-map.json 不可解析时仍输出合法失败 JSON
  动作: 在隔离临时仓库副本写入坏 JSON 后执行 check --json
  预期观察: 无裸堆栈污染 stdout；ok=false、errors 含解析原因，退出非 0
  等待预算: 10s
  留证: 临时副本命令 stdout、stderr 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; mkdir -p "$D/scripts"; cp -R scripts/product-map "$D/scripts/"; cp -R product-map "$D/"; printf "{bad-json\n" > "$D/product-map/generated/product-map.json"; set +e; OUT=$(node "$D/scripts/product-map/cli.mjs" check --json 2>"$D/err"); CODE=$?; set -e; [ "$CODE" -ne 0 ] && [ ! -s "$D/err" ] && printf "%s" "$OUT" | jq -e '\''keys==["errors","ok"] and .ok==false and (.errors|length)>0 and all(.errors[]; type=="string")'\'''

- [ ] [BEHAVIOR] [L2] B-04: --json 与额外既有参数并存不互相干扰
  动作: 执行 `check --json --unused-existing-compatible`
  预期观察: JSON schema、检查结果与退出码同单独 `--json`
  等待预算: 10s
  留证: 两次命令 stdout 与 exit code
  Test: manual:bash -c 'A=$(node scripts/product-map/cli.mjs check --json); AC=$?; B=$(node scripts/product-map/cli.mjs check --json --unused-existing-compatible); BC=$?; [ "$AC" -eq "$BC" ] && [ "$A" = "$B" ] && printf "%s" "$B" | jq -e '\''.ok==true and .errors==[]'\'''

- [ ] [BEHAVIOR] [L2] B-05: 不带 --json 的成功输出逐字零回归
  动作: 分别运行冻结 base SHA CLI 与候选 CLI 的无参数 check
  预期观察: stdout、stderr 与 exit code逐字一致
  等待预算: 10s
  留证: cmp 结果与两个 exit code
  Test: manual:bash -c 'B=scripts/product-map/.base-cli.mjs; D=$(mktemp -d); trap '\''rm -f "$B"; rm -rf "$D"'\'' EXIT; git show 1c0df82311dc685cb44f497a13b4b295b0fcf4d9:scripts/product-map/cli.mjs > "$B"; set +e; node "$B" check >"$D/a" 2>"$D/ae"; A=$?; node scripts/product-map/cli.mjs check >"$D/b" 2>"$D/be"; C=$?; set -e; [ "$A" -eq "$C" ] && cmp "$D/a" "$D/b" && cmp "$D/ae" "$D/be"'

- [ ] [BEHAVIOR] [L2] B-06: 多个检查问题同时存在时 errors 逐项表达
  动作: 在隔离副本中同时制造 digest 漂移与两个 smoke_files 缺失，再执行 check --json
  预期观察: stdout 单个 JSON 中至少三条 error 分别指出 digest 与两个具体缺失路径，退出非 0
  等待预算: 10s
  留证: JSON stdout、空 stderr 与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; mkdir -p "$D/scripts"; cp -R scripts/product-map "$D/scripts/"; cp -R product-map "$D/"; sed -i '\''0,/\.github\/workflows\/scripts\/smoke\/golden-path-f1-anchor-smoke\.sh/s//harness-missing-one.sh/'\'' "$D/product-map/product-map.yaml"; sed -i '\''0,/\.github\/workflows\/scripts\/smoke\/golden-path-1-smoke\.sh/s//harness-missing-two.sh/'\'' "$D/product-map/product-map.yaml"; set +e; OUT=$(cd "$D" && node scripts/product-map/cli.mjs check --json 2>err); CODE=$?; set -e; [ "$CODE" -ne 0 ] && [ ! -s "$D/err" ] && printf "%s" "$OUT" | jq -e '\''keys==["errors","ok"] and .ok==false and (.errors|length)>=3 and any(.errors[]; test("digest";"i")) and any(.errors[]; contains("harness-missing-one.sh")) and any(.errors[]; contains("harness-missing-two.sh"))'\'''

- [ ] [BEHAVIOR] [L2] B-07: 不带 --json 的失败输出与退出码逐字零回归
  动作: 在两个隔离副本制造相同 digest 漂移，分别运行合同锚 CLI 与候选 CLI 的文本 check
  预期观察: 两者均失败，stdout、stderr 和 exit code 逐字一致
  等待预算: 10s
  留证: 两组输出 cmp 结果与 exit code
  Test: manual:bash -c 'D=$(mktemp -d); trap '\''rm -rf "$D"'\'' EXIT; for R in base new; do mkdir -p "$D/$R/scripts"; cp -R scripts/product-map "$D/$R/scripts/"; cp -R product-map "$D/$R/"; done; git show 1c0df82311dc685cb44f497a13b4b295b0fcf4d9:scripts/product-map/cli.mjs > "$D/base/scripts/product-map/cli.mjs"; node -e '\''const fs=require("fs");for(const r of process.argv.slice(1)){const p=r+"/product-map/generated/product-map.json";const j=JSON.parse(fs.readFileSync(p));j.digest="00000000"+j.digest.slice(8);fs.writeFileSync(p,JSON.stringify(j))}'\'' "$D/base" "$D/new"; set +e; (cd "$D/base" && node scripts/product-map/cli.mjs check)>"$D/a" 2>"$D/ae"; A=$?; (cd "$D/new" && node scripts/product-map/cli.mjs check)>"$D/b" 2>"$D/be"; B=$?; set -e; [ "$A" -ne 0 ] && [ "$A" -eq "$B" ] && cmp "$D/a" "$D/b" && cmp "$D/ae" "$D/be"'

- [ ] [BEHAVIOR] [L2] INV-01: 产品分类投影无漂移
  动作: 执行仓库 SSOT 分类合同检查
  预期观察: 现有文本模式返回 PASS 且退出 0
  等待预算: 10s
  留证: npm 命令输出与 exit code
  Test: manual:bash -c 'timeout 10s npm run product-map:check | grep -q "PASS: no drift"'

## Invariant 映射

- PRD 中与 watchdog、relay、PR 冲突、Brain DB、RPA、租户、凭据、定时扫描、部署及 headed session 有关的 area 铁律：N/A，本 Sprint 仅改无网络、无 DB、无状态的本地 CLI 输出格式。
- 与本 Sprint 直接相关的铁律已覆盖：真实进程 exit code（B-01~B-05）、目标解释器真实启动（全部 B 条目）、`node:test` 既有风格、精确测试路径、product-map SSOT 不漂移（INV-01）。
- 禁止改变分类事实：通过范围边界、GP-Anchor `none(config)` 与 INV-01 执法。
