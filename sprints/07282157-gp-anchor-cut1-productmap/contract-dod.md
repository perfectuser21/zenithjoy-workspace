---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: GP锚定闭环 刀1（product-map SSOT扩展）

**范围**: product-map.yaml补三条客户线GP+schema扩展(steps/smoke_files数组)+CI校验+GP自身注册+变异测试smoke
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] product-map.schema.json 含 steps/smoke_files 字段定义
  Test: node -e "const s=JSON.parse(require('fs').readFileSync('product-map/product-map.schema.json','utf8')); const gp=s.properties.golden_paths.items.properties; if(!gp.steps||!gp.smoke_files)process.exit(1)"

- [ ] [ARTIFACT] golden-path-f1-anchor-smoke.sh 新建且已登记进 smoke-baseline.txt
  Test: node -e "const fs=require('fs'); if(!fs.existsSync('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh'))process.exit(1); const b=fs.readFileSync('.github/workflows/scripts/smoke-baseline.txt','utf8'); if(!b.includes('golden-path-f1-anchor-smoke.sh'))process.exit(1)"

- [ ] [ARTIFACT] product-map/README.md 准入规则新增第4条(smoke_files存在性硬闸) + 删除customer_app过时占位注释
  Test: node -e "const r=require('fs').readFileSync('product-map/README.md','utf8'); if(!/smoke_files.*(存在|真实)/.test(r))process.exit(1); const y=require('fs').readFileSync('product-map/product-map.yaml','utf8'); if(y.includes('customer_app三条Line待各Sprint批准后补充'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] product-map:validate 对新增GP条目通过schema校验
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && npm run product-map:validate 2>&1 | grep -q "PASS" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] product-map:check 对smoke_files存在性+非空占位正确校验（proven-to-fire：故意造缺失路径必须报错）
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && node -e "const {validateSmokeFiles}=require(\"./scripts/product-map/lib.mjs\"); const r=validateSmokeFiles({golden_paths:[{id:\"test_gp\",smoke_files:[\".github/workflows/scripts/smoke/nonexistent-fake.sh\"]}]}, process.cwd()); if(r.ok||!r.errors.some(e=>e.includes(\"nonexistent-fake.sh\")))process.exit(1); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] gp_anchor_enforcement 自身注册数据正确（status=proposed，smoke_files正确指向）
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && node -e "const yaml=require(\"yaml\"); const fs=require(\"fs\"); const doc=yaml.parse(fs.readFileSync(\"product-map/product-map.yaml\",\"utf8\")); const gp=doc.golden_paths.find(g=>g.id===\"gp_anchor_enforcement\"); if(!gp||gp.status!==\"proposed\"||!gp.smoke_files.includes(\".github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh\"))process.exit(1); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] YAML语法错误报结构化FAIL而非裸堆栈崩溃
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && cp product-map/product-map.yaml /tmp/pm-backup-dod.yaml && node -e "const fs=require(\"fs\"); let c=fs.readFileSync(\"product-map/product-map.yaml\",\"utf8\"); fs.writeFileSync(\"product-map/product-map.yaml\", c.replace(\"apps:\",\"apps:\n   bad:\"))" && OUT=$(npm run product-map:validate 2>&1); cp /tmp/pm-backup-dod.yaml product-map/product-map.yaml; echo "$OUT" | grep -qE "FAIL: YAML syntax error" && echo OK'
  期望: OK

- [ ] [BEHAVIOR] golden-path-f1-anchor-smoke.sh 真跑通过且零网络零DB依赖
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && bash .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh && ! grep -qE "curl|psql|nc |wget" .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 既有回归测试（line01/02/04须无GP的旧断言）已同步改写且全绿
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && npm run test:product-map > /tmp/dod-test-pm.log 2>&1; CODE=$?; cat /tmp/dod-test-pm.log; [ $CODE -eq 0 ] && echo OK || exit 1'
  期望: OK（依 node:test 真实 exit code 判定，不 grep 文本——node:test 成功时输出仍含字面"fail 0"，grep会误判）

- [ ] [BEHAVIOR] ajv版本供应链冒烟断言存在且生效（防未来无关PR被ajv升级误伤）
  Test: manual:bash -c 'cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1 && grep -q "ajv.*compile" scripts/product-map/__tests__/product-map.test.js || exit 1; npm run test:product-map > /dev/null 2>&1 && echo OK || exit 1'
  期望: OK

## E2E 验收
见 contract-draft.md 的 `## E2E 验收` 段（target_environment=local_api，纯bash脚本，本地/CI均可跑）。
