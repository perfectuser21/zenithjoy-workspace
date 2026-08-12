✖ T1: apps[].lines 精确等于 7 条（line00/01/02/04/05/07/10） (32.55925ms)
✖ T2: line00 精确 3 条非废弃 GP（skill_acceptance 已 deprecated，ability_acceptance 仍 active） (3.55375ms)
✖ T3: 非 deprecated Golden Path 总数精确为 18，按 line 分布精确匹配 (2.556916ms)
✖ T4: line05/07/10 三条新 GP 精确锚定 PRD 指定的既有 smoke 文件 (2.566416ms)
✖ T5: deprecated 集合精确为三个历史 id，原样保留不删除 (2.111541ms)
✔ T6: product-map:generate 重建投影后 digest 与当前 YAML 一致（无漂移） (216.652458ms)
✖ T7: git diff 变更路径全部落在允许前缀内，且不含 Cecelia / 不新建注册脚本 (10.0585ms)
ℹ tests 7
ℹ suites 0
ℹ pass 1
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 367.29575

✖ failing tests:

test at sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:51:1
✖ T1: apps[].lines 精确等于 7 条（line00/01/02/04/05/07/10） (32.55925ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'line00',
      'line01',
      'line02',
      'line04',
  -   'line05',
  -   'line07',
  -   'line10'
    ]
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/task-c2b59b6a/session-6a813b0c/sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:56:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ 'line00', 'line01', 'line02', 'line04' ],
    expected: [
      'line00', 'line01',
      'line02', 'line04',
      'line05', 'line07',
      'line10'
    ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:66:1
✖ T2: line00 精确 3 条非废弃 GP（skill_acceptance 已 deprecated，ability_acceptance 仍 active） (3.55375ms)
  AssertionError [ERR_ASSERTION]: line00 非废弃 GP 须精确为 3 条，实际: ["skill_acceptance","ability_acceptance","line_health","gp_anchor_enforcement"]
  
  4 !== 3
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/task-c2b59b6a/session-6a813b0c/sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:74:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 4,
    expected: 3,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:92:1
✖ T3: 非 deprecated Golden Path 总数精确为 18，按 line 分布精确匹配 (2.556916ms)
  AssertionError [ERR_ASSERTION]: 非 deprecated GP 总数须为 18，实际: 16（["skill_acceptance","ability_acceptance","line_health","gp_anchor_enforcement","customer_first_success","keyword_acquisition","live_acquisition","video_link_acquisition","benchmark_link_acquisition","cs_shared_binding","active_voice_outreach","passive_reception","moments_publish","business_report","moments_interaction","group_operation"]）
  
  16 !== 18
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/task-c2b59b6a/session-6a813b0c/sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js:95:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 16,
    expected: 18,
    operator: 'strictEqual',
