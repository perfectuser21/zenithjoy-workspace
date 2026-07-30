-- 生产 license 校验闸门 P0 修复（Brain issue 88d15763）
--
-- 背景：测试租户 455a8ca9-5f63-4286-83ce-c5cca04cfd58（tenants.name='ZenithJoy内部）
-- 的测试 license ZJ-F-K3MYP4VR 在生产库 zenithjoy 和 staging 库 zenithjoy_staging 里
-- 各自播种了一份（id 不同、tier 不同）。license_key 命名格式（ZJ-{tier}-{8位}）与真实
-- 客户 license 完全一致，registerAgent() 无法从 key 本身分辨"这是不是测试用"——一台
-- 配置错误、心跳误连到生产的测试设备，拿这个 license 走标准 /api/agent/register
-- 也会"注册成功"，没有任何信号能让人发现连错了环境。
--
-- 本列给 license 行显式打"测试用途"标记，供 registerAgent() 在生产环境
-- （NODE_ENV=production）直接拒绝 is_test=true 的 license 注册。

ALTER TABLE zenithjoy.licenses
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_licenses_is_test
  ON zenithjoy.licenses(is_test)
  WHERE is_test = true;
