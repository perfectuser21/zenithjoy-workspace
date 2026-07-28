=== product-map.test.js ===
file:///Users/administrator/worktrees/zenithjoy/session-b08db3c1/scripts/product-map/__tests__/product-map.test.js:17
  validateSmokeFiles,
  ^^^^^^^^^^^^^^^^^^
SyntaxError: The requested module '../lib.mjs' does not provide an export named 'validateSmokeFiles'
    at #asyncInstantiate (node:internal/modules/esm/module_job:319:21)
    at async ModuleJob.run (node:internal/modules/esm/module_job:422:5)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:639:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v25.8.0
✖ scripts/product-map/__tests__/product-map.test.js (58.823541ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 63.361875

✖ failing tests:

test at scripts/product-map/__tests__/product-map.test.js:1:1
✖ scripts/product-map/__tests__/product-map.test.js (58.823541ms)
  'test failed'
=== contract.test.js ===
▶ BEHAVIOR-01: 产品分类结构解析
  ✔ loadAndValidateProductMap 返回 { map, errors } 结构 (42.573084ms)
  ✔ 精确解析两个 App: customer_app 和 staff_app (1.482459ms)
  ✔ customer_app 拥有 line01/line02/line04；staff_app 拥有 line00 (0.810125ms)
  ✔ 负向: 缺失 apps 字段时 errors 非空 (0.104542ms)
✔ BEHAVIOR-01: 产品分类结构解析 (45.958791ms)
▶ BEHAVIOR-02: 种子分类精确性
  ✖ staff_app/line00 精确含 3 个 GP（含 ability_acceptance=proposed） (1.303ms)
  ✖ 分类语义核查: 与 PRD 期望 JSON 精确一致 (1.275416ms)
  ✖ Line 01/02/04 各精确含 1 条 Golden Path 条目（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定） (0.733292ms)
✖ BEHAVIOR-02: 种子分类精确性 (3.39875ms)
▶ BEHAVIOR-03: Surface 与 Edition 类型隔离
  ✔ surfaces 精确为 [web, api, android, windows] (0.516291ms)
  ✔ editions 精确为 [personal_wechat, wecom] (0.433833ms)
  ✔ surface 和 edition 集合不重叠 (0.455625ms)
✔ BEHAVIOR-03: Surface 与 Edition 类型隔离 (1.488083ms)
▶ BEHAVIOR-04/05: 交叉引用关系校验
  ✔ validateRelations: 有效 map 返回空错误数组 (0.538375ms)
  ✔ 负向: GP app_id=missing_app → 报 references unknown app (0.368417ms)
  ✔ 负向: required_surfaces=["mobile"] → 报 references unknown surface (0.576625ms)
  ✔ 负向: 重复 GP id → 报 duplicate (0.389125ms)
✔ BEHAVIOR-04/05: 交叉引用关系校验 (1.928709ms)
▶ BEHAVIOR-06: 确定性投影生成
  ✔ generated/product-map.json 存在且为合法 JSON (0.131416ms)
  ✔ generated/product-map.md 存在 (0.023208ms)
  ✔ JSON 和 MD 含相同 digest (0.060083ms)
✔ BEHAVIOR-06: 确定性投影生成 (0.250625ms)
▶ BEHAVIOR-07: 漂移检测（check 子命令）
  ✔ cli.mjs check 子命令存在 (0.050791ms)
✔ BEHAVIOR-07: 漂移检测（check 子命令） (0.078042ms)
▶ BEHAVIOR-08: Provider Bootstrap 无手写分类
  ✔ AGENTS.md 不含手写分类词汇 (0.076791ms)
  ✔ .claude/CLAUDE.md 不含手写分类词汇 (0.049917ms)
  ✔ DEFINITION.md 不含手写分类词汇 (0.038875ms)
  ✔ 负向: assertBootstrapParity 检测 customer_app 注入 (0.476958ms)
  ✔ 三个 bootstrap 文件均含 npm run product-map:check 指令 (0.076333ms)
✔ BEHAVIOR-08: Provider Bootstrap 无手写分类 (0.768125ms)
▶ BEHAVIOR-09: 贡献者文档断言
  ✔ README.md 存在 (0.037667ms)
  ✔ README 含所有权信息 (0.093166ms)
  ✔ README 含变更工作流 7 个步骤 (0.048209ms)
  ✔ README 含 GP 准入规则 3 个必要条件 (0.057709ms)
  ✔ README 明确区分 Surface vs Line (0.062ms)
  ✔ README 明确区分 Edition vs Line (0.049ms)
  ✔ README 含生成投影路径引用 (0.04525ms)
  ✔ README 含 npm 脚本引用 (0.044042ms)
✔ BEHAVIOR-09: 贡献者文档断言 (0.486375ms)
▶ BEHAVIOR-10: CI L2 Job 配置
  ✔ ci-l2-consistency.yml 含 product-map-contract Job (0.059625ms)
  ✔ product-map-contract Job 无 paths 过滤器 (0.069166ms)
  ✔ product-map-contract Job 含三条必要命令 (0.058042ms)
  ✔ product-map-contract Job timeout-minutes 为 5 (0.057042ms)
  ✔ l2-passed 的 needs 包含 product-map-contract (0.042834ms)
  ✔ l2-passed FAILED 判断块含 product-map-contract result 检查 (0.069292ms)
✔ BEHAVIOR-10: CI L2 Job 配置 (0.393709ms)
▶ BEHAVIOR-11: test-registry.yaml 注册
  ✔ test-registry.yaml 含 product-map-contract 条目 (0.506834ms)
  ✔ product-map-contract 条目 type=unit, ci=L2, status=active (0.4615ms)
  ✔ test-registry.yaml updated 字段为 2026-07-28 (0.378708ms)
  ✔ product-map-contract path 指向正确测试文件 (0.41175ms)
✔ BEHAVIOR-11: test-registry.yaml 注册 (1.794042ms)
▶ BEHAVIOR-12: 范围边界守卫
  ✔ 不含数据库迁移文件新增 (0.118208ms)
  ✖ product-map.yaml 的 line01/02/04 各含 1 条已注册 GP（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定） (0.454959ms)
  ✔ package.json 含 4 个 product-map npm scripts (0.079ms)
  ✔ lib.mjs 导出 5 个必要函数 (0.040958ms)
✖ BEHAVIOR-12: 范围边界守卫 (0.732375ms)
ℹ tests 45
ℹ suites 11
ℹ pass 41
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 131.893583

✖ failing tests:

test at sprints/07280933-product-map-ssot-claude/tests/contract.test.js:87:3
✖ staff_app/line00 精确含 3 个 GP（含 ability_acceptance=proposed） (1.303ms)
  AssertionError [ERR_ASSERTION]: ability_acceptance status 须为 proposed，实际: active
  + actual - expected
  
  + 'active'
  - 'proposed'
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/zenithjoy/session-b08db3c1/sprints/07280933-product-map-ssot-claude/tests/contract.test.js:94:12)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Promise.all (index 0)
      at async Suite.run (node:internal/test_runner/test:1619:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 'active',
    expected: 'proposed',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at sprints/07280933-product-map-ssot-claude/tests/contract.test.js:97:3
✖ 分类语义核查: 与 PRD 期望 JSON 精确一致 (1.275416ms)
  AssertionError [ERR_ASSERTION]: 分类语义不符
  期望: {
    "apps": [
      [
        "customer_app",
        [
          "line01",
          "line02",
          "line04"
        ]
      ],
      [
        "staff_app",
        [
          "line00"
        ]
      ]
    ],
    "gps": [
      [
        "staff_app",
        "line00",
        "skill_acceptance",
        "active"
      ],
      [
        "staff_app",
        "line00",
        "ability_acceptance",
        "proposed"
      ],
      [
        "staff_app",
        "line00",
        "line_health",
        "active"
      ]
    ],
    "surfaces": [
      "web",
      "api",
      "android",
      "windows"
    ],
    "editions": [
      "personal_wechat",
      "wecom"
    ]
  }
  实际: {
    "apps": [
      [
        "customer_app",
        [
          "line01",
          "line02",
          "line04"
        ]
      ],
      [
        "staff_app",
        [
          "line00"
        ]
      ]
    ],
    "gps": [
      [
        "staff_app",
        "line00",
        "skill_acceptance",
        "active"
      ],
      [
        "staff_app",
        "line00",
        "ability_acceptance",
        "active"
      ],
      [
        "staff_app",
        "line00",
        "line_health",
        "active"
      ]
    ],
    "surfaces": [
      "web",
      "api",
      "android",
      "windows"
    ],
    "editions": [
      "personal_wechat",
      "wecom"
    ]
  }
  + actual - expected
  ... Skipped lines
  
    {
      apps: [
        [
          'customer_app',
          [
  ...
          'ability_acceptance',
  +       'active'
  -       'proposed'
        ],
        [
          'staff_app',
          'line00',
          'line_health',
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/zenithjoy/session-b08db3c1/sprints/07280933-product-map-ssot-claude/tests/contract.test.js:117:12)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: { apps: [ [Array], [Array] ], gps: [ [Array], [Array], [Array] ], surfaces: [ 'web', 'api', 'android', 'windows' ], editions: [ 'personal_wechat', 'wecom' ] },
    expected: { apps: [ [Array], [Array] ], gps: [ [Array], [Array], [Array] ], surfaces: [ 'web', 'api', 'android', 'windows' ], editions: [ 'personal_wechat', 'wecom' ] },
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at sprints/07280933-product-map-ssot-claude/tests/contract.test.js:124:3
✖ Line 01/02/04 各精确含 1 条 Golden Path 条目（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定） (0.733292ms)
  AssertionError [ERR_ASSERTION]: 实际: []
  + actual - expected
  
  + []
  - [
  -   'line01/customer_first_success',
  -   'line02/customer_smart_acquisition',
  -   'line04/customer_private_ai'
  - ]
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/zenithjoy/session-b08db3c1/sprints/07280933-product-map-ssot-claude/tests/contract.test.js:130:12)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [],
    expected: [ 'line01/customer_first_success', 'line02/customer_smart_acquisition', 'line04/customer_private_ai' ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at sprints/07280933-product-map-ssot-claude/tests/contract.test.js:478:3
✖ product-map.yaml 的 line01/02/04 各含 1 条已注册 GP（GP锚定闭环刀1新增，取代本历史断言原有的"须无GP"约定） (0.454959ms)
  AssertionError [ERR_ASSERTION]: customer_app Line 01/02/04 须各含1条GP共3条，实际: []
  
  0 !== 3
  
      at TestContext.<anonymous> (file:///Users/administrator/worktrees/zenithjoy/session-b08db3c1/sprints/07280933-product-map-ssot-claude/tests/contract.test.js:485:12)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Suite.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 3,
    operator: 'strictEqual',
    diff: 'simple'
  }
