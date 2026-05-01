## ZenithJoy Phase 1 Unit Test 技术债补齐（2026-05-01）

### 根本原因

- 46/106 ZenithJoy 功能有 unit test，其余 60/106 零覆盖
- 核心问题是 controller 在模块加载时实例化 service（`const svc = new Service()`），测试里再 `new Service()` 只是第二个实例，spy 全部无效

### 下次预防

- [ ] 新路由上线必须配套 unit test（CI `lint-test-pairing` 已强制）
- [ ] controller 层用 service mock 时，必须用 `vi.hoisted()` 共享 mock 对象，而非在 `beforeEach` 里 `new` 第二个实例
- [ ] credits/admin 路由的 `superAdminGuard` 返回 403（非 401）——不要假设未认证就是 401
- [ ] UUID 校验用 `/^[0-9a-f]{8}-/i` 格式——测试用 `aaaabbbb-cccc-dddd-eeee-ffffffffffff`，避免 `t` 等非 hex 字符
- [ ] 路由有多个 DB 查询时（INSERT + SELECT），mock 要对应多个 `mockResolvedValueOnce`
- [ ] gitleaks 扫描所有 commit 历史——测试中的 token/key 值要加 `// gitleaks:allow` 或预先在 `.gitleaksignore` 登记 fingerprint
- [ ] 新增测试文件必须同时注册到 `test-registry.yaml`（CI `Orphan Test Check` 强制）
